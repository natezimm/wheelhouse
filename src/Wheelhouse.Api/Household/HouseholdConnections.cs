using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Household;

/// <summary>
/// Active subscriptions on this API process. Joining, publishing and revoking are serialized
/// so a new connection cannot receive an older initial number after a newer notification.
/// No request-scoped DbContext or hub instance is kept beyond its request.
/// </summary>
public sealed class HouseholdConnections(
    IHubContext<HouseholdHub, IHouseholdClient> hub,
    IServiceScopeFactory scopes,
    IOptionsMonitor<InstanceOptions> instance,
    TimeProvider time,
    ILogger<HouseholdConnections> logger)
{
    private readonly SemaphoreSlim _gate = new(1);
    private readonly Dictionary<string, Subscription> _subscriptions = [];

    internal async Task<bool> AddAsync(HubCallerContext context, CancellationToken cancellationToken)
    {
        var identity = IdentityOf(context.User);
        if (identity is null)
        {
            return false;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>();
            var family = await FamilyAsync(db, identity.FamilyId, cancellationToken);
            if (!await AllowedAsync(db, identity, family, cancellationToken))
            {
                return false;
            }

            var subscription = new Subscription(context.ConnectionId, identity, context.Abort, family!.ChangeNumber, family.ListsChangeNumber, family.MealsChangeNumber);
            await hub.Groups.AddToGroupAsync(subscription.Id, Group(identity.FamilyId), cancellationToken);
            _subscriptions.Add(subscription.Id, subscription);
            try
            {
                await hub.Clients.Client(subscription.Id).HouseholdChanged(new HouseholdChanged("chores", family.ChangeNumber));
                await hub.Clients.Client(subscription.Id).HouseholdChanged(new HouseholdChanged("lists", family.ListsChangeNumber));
                await hub.Clients.Client(subscription.Id).HouseholdChanged(new HouseholdChanged("meals", family.MealsChangeNumber));
            }
            catch
            {
                await CloseAsync(subscription);
                throw;
            }

            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    internal async Task RemoveAsync(string connectionId)
    {
        await _gate.WaitAsync();
        try
        {
            // SignalR removes a disconnected connection's group membership itself.
            _subscriptions.Remove(connectionId);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Reads only committed versions, so explicit outer transactions and rollbacks work too.
    /// An unsuccessful send is retried on the next pass. Several commits may be coalesced into
    /// one notification: the client recovers by reading a full snapshot, not replaying deltas.
    /// </summary>
    public async Task PublishAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            foreach (var group in _subscriptions.Values.GroupBy(s => s.Identity.FamilyId).ToList())
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    var db = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>();
                    var family = await FamilyAsync(db, group.Key, cancellationToken);
                    var allowed = new List<Subscription>();
                    foreach (var subscription in group)
                    {
                        // SignalR keeps the original principal for the life of a WebSocket.
                        // Revalidate even when the number has not changed, and before any send.
                        if (await AllowedAsync(db, subscription.Identity, family, cancellationToken))
                        {
                            allowed.Add(subscription);
                        }
                        else
                        {
                            await CloseAsync(subscription);
                        }
                    }

                    if (family is not null && allowed.Any(s => s.LastSent < family.ChangeNumber))
                    {
                        await hub.Clients.Group(Group(group.Key)).HouseholdChanged(new HouseholdChanged("chores", family.ChangeNumber));
                        foreach (var subscription in allowed)
                        {
                            subscription.LastSent = family.ChangeNumber;
                        }
                    }
                    if (family is not null && allowed.Any(s => s.ListsLastSent < family.ListsChangeNumber))
                    {
                        await hub.Clients.Group(Group(group.Key)).HouseholdChanged(new HouseholdChanged("lists", family.ListsChangeNumber));
                        foreach (var subscription in allowed) subscription.ListsLastSent = family.ListsChangeNumber;
                    }
                    if (family is not null && allowed.Any(s => s.MealsLastSent < family.MealsChangeNumber))
                    {
                        await hub.Clients.Group(Group(group.Key)).HouseholdChanged(new HouseholdChanged("meals", family.MealsChangeNumber));
                        foreach (var subscription in allowed) subscription.MealsLastSent = family.MealsChangeNumber;
                    }
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    // A failed read must not send data using a stale authorization decision.
                    // Keep LastSent unchanged so a later pass can recover a failed notification.
                    logger.LogWarning(exception, "Could not publish the household of family {FamilyId}", group.Key);
                }
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Stops existing sockets when this sign-in ends or is replaced by pairing.</summary>
    public Task DisconnectAsync(ClaimsPrincipal user) => CloseWhereAsync(s => IdentityOf(user) is { } identity && s.Identity == identity);

    public Task DisconnectDeviceAsync(Guid deviceId) => CloseWhereAsync(s => s.Identity.DeviceId == deviceId);

    private async Task CloseWhereAsync(Func<Subscription, bool> predicate)
    {
        await _gate.WaitAsync();
        try
        {
            foreach (var subscription in _subscriptions.Values.Where(predicate).ToList())
            {
                await CloseAsync(subscription);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task CloseAsync(Subscription subscription)
    {
        _subscriptions.Remove(subscription.Id);
        try
        {
            await hub.Groups.RemoveFromGroupAsync(subscription.Id, Group(subscription.Identity.FamilyId));
        }
        finally
        {
            subscription.Abort();
        }
    }

    private static Task<FamilyVersion?> FamilyAsync(WheelhouseDbContext db, Guid familyId, CancellationToken cancellationToken) =>
        db.Families.IgnoreQueryFilters().AsNoTracking().Where(f => f.Id == familyId)
            .Select(f => new FamilyVersion(f.ChoresChangeNumber, f.ListsChangeNumber, f.MealsChangeNumber, f.ExpiresAt)).SingleOrDefaultAsync(cancellationToken);

    private async Task<bool> AllowedAsync(WheelhouseDbContext db, Identity identity, FamilyVersion? family, CancellationToken cancellationToken)
    {
        var mode = instance.CurrentValue;
        if (family is null || family.ExpiresAt <= time.GetUtcNow()
            || (mode.Mode == InstanceMode.Demo) != (family.ExpiresAt is not null))
        {
            return false;
        }

        if (identity.DeviceId is { } device)
        {
            return await db.Devices.IgnoreQueryFilters().AnyAsync(d => d.Id == device && d.FamilyId == identity.FamilyId, cancellationToken);
        }

        if (identity.AccountId is { } account)
        {
            if (mode.Mode != InstanceMode.Family)
            {
                return false;
            }

            var email = await db.UserAccounts.IgnoreQueryFilters()
                .Where(a => a.Id == account && a.FamilyId == identity.FamilyId && a.Member.Role == MemberRole.Parent)
                .Select(a => a.Email).SingleOrDefaultAsync(cancellationToken);
            return email is not null && mode.IsParentEmail(email);
        }

        return mode.Mode == InstanceMode.Demo;
    }

    private static Identity? IdentityOf(ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true
            || !Guid.TryParse(user.FindFirstValue(WheelhouseClaims.Family), out var familyId))
        {
            return null;
        }

        var account = user.FindFirstValue(WheelhouseClaims.Account);
        var device = user.FindFirstValue(WheelhouseClaims.Device);
        var role = user.FindFirstValue(WheelhouseClaims.Role);
        if (device is not null)
        {
            return account is null && role == Roles.Device && Guid.TryParse(device, out var deviceId)
                ? new Identity(familyId, null, deviceId) : null;
        }

        return role != Roles.Parent ? null : account is null ? new Identity(familyId, null, null)
            : Guid.TryParse(account, out var accountId) ? new Identity(familyId, accountId, null) : null;
    }

    private static string Group(Guid familyId) => $"household:{familyId:N}";

    private sealed record Identity(Guid FamilyId, Guid? AccountId, Guid? DeviceId);
    private sealed record FamilyVersion(long ChangeNumber, long ListsChangeNumber, long MealsChangeNumber, DateTimeOffset? ExpiresAt);
    private sealed class Subscription(string id, Identity identity, Action abort, long lastSent, long listsLastSent, long mealsLastSent)
    {
        public string Id { get; } = id;
        public Identity Identity { get; } = identity;
        public Action Abort { get; } = abort;
        public long LastSent { get; set; } = lastSent;
        public long ListsLastSent { get; set; } = listsLastSent;
        public long MealsLastSent { get; set; } = mealsLastSent;
    }
}

