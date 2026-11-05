using System.Threading.Channels;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Calendar;

public sealed class CalendarSyncOptions
{
    public const string Section = "CalendarSync";

    /// <summary>The tests turn the worker off and run <see cref="CalendarSync"/> themselves.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>How often every connected family is synced. An event added in Google shows within about this long.</summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromMinutes(2);
}

/// <summary>
/// Asks the worker to sync one family now rather than at the next pass: after a parent connects
/// Google or changes which calendars show, so their events appear while the parent is looking.
/// </summary>
public sealed class CalendarSyncTrigger
{
    private readonly Channel<Guid> _families = Channel.CreateUnbounded<Guid>();

    public void SyncSoon(Guid familyId) => _families.Writer.TryWrite(familyId);

    /// <summary>The next family asked for, or null when <paramref name="timeout"/> passes first.</summary>
    public async Task<Guid?> WaitAsync(TimeSpan timeout, TimeProvider time, CancellationToken cancellationToken)
    {
        using var expiry = new CancellationTokenSource(timeout, time);
        using var either = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, expiry.Token);
        try
        {
            return await _families.Reader.ReadAsync(either.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null;
        }
    }
}

/// <summary>
/// The calendar's part of <c>/health</c>: degraded while a family's Google connection needs a
/// parent to connect it again, while a connected family's calendar has not synced for
/// <see cref="StaleAfter"/> (Google no longer shows it to the account, or every pass fails), while
/// the worker has not finished a pass for as long (it is stuck or has stopped), or when the last
/// pass failed. The first two are read from the database on each check, so they hold across
/// passes: a pass skips a connection that needs reconnecting and a calendar Google no longer has,
/// and so cannot clear them by succeeding at everything else. Its data says how old the last pass
/// and the stalest calendar are, so an alert or a person can see how far behind Google it is.
/// </summary>
public sealed class CalendarSyncHealth(
    IServiceScopeFactory scopes,
    TimeProvider time,
    IOptions<CalendarSyncOptions> options,
    IOptions<InstanceOptions> instance) : IHealthCheck
{
    private readonly DateTimeOffset _started = time.GetUtcNow();
    private volatile string? _problem;
    private long _lastPass;

    /// <summary>How long a calendar may go without a sync before health says so: several missed passes, never under ten minutes.</summary>
    public TimeSpan StaleAfter => TimeSpan.FromTicks(Math.Max(TimeSpan.FromMinutes(10).Ticks, 5 * options.Value.Interval.Ticks));

    /// <summary>Whether the worker syncs with Google here: only on a family instance, and not in the tests.</summary>
    public bool Syncs => instance.Value.Mode == InstanceMode.Family && options.Value.Enabled;

    public void Report(string? problem) => _problem = problem;

    /// <summary>The worker finished a pass over every connected family, whether or not each one synced.</summary>
    public void Passed() => Interlocked.Exchange(ref _lastPass, time.GetUtcNow().UtcTicks);

    private DateTimeOffset? LastPass => Interlocked.Read(ref _lastPass) is var ticks and > 0
        ? new DateTimeOffset(ticks, TimeSpan.Zero)
        : null;

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>();
        var now = time.GetUtcNow();
        var staleBefore = now - StaleAfter;

        // No request, so no current family: every query names what it reads across families.
        var connections = db.GoogleConnections.IgnoreQueryFilters();
        var needsReconnect = await connections.CountAsync(c => c.Status == GoogleConnectionStatus.NeedsReauth, cancellationToken);
        var connected = connections.Where(c => c.Status == GoogleConnectionStatus.Connected).Select(c => c.FamilyId);
        var synced = db.CalendarSources.IgnoreQueryFilters()
            .Where(s => connected.Contains(s.FamilyId) && s.LastSyncedAt != null);
        var calendars = await synced.CountAsync(cancellationToken);
        var stalest = await synced.MinAsync(s => s.LastSyncedAt, cancellationToken);
        var lastPass = LastPass;

        // Ages in whole seconds and no family's ids, since anyone may read /health.
        var data = new Dictionary<string, object>
        {
            ["syncsGoogle"] = Syncs,
            ["staleAfterSeconds"] = (long)StaleAfter.TotalSeconds,
            ["calendars"] = calendars,
            ["needsReconnect"] = needsReconnect,
        };
        if (lastPass is { } pass)
        {
            data["lastPassAt"] = pass;
            data["lastPassAgeSeconds"] = SecondsBetween(pass, now);
        }

        if (stalest is { } oldest)
        {
            data["oldestSyncAt"] = oldest;
            data["oldestSyncAgeSeconds"] = SecondsBetween(oldest, now);
        }

        if (Syncs && (lastPass ?? _started) < staleBefore)
        {
            return HealthCheckResult.Degraded($"The calendar worker has not finished a pass for over {StaleAfter.TotalMinutes:0} minutes.", data: data);
        }

        if (needsReconnect > 0)
        {
            return HealthCheckResult.Degraded("A family's Google connection needs connecting again.", data: data);
        }

        if (stalest < staleBefore)
        {
            return HealthCheckResult.Degraded($"A calendar has not synced for over {StaleAfter.TotalMinutes:0} minutes.", data: data);
        }

        return _problem is { } problem ? HealthCheckResult.Degraded(problem, data: data) : HealthCheckResult.Healthy(data: data);
    }

    private static long SecondsBetween(DateTimeOffset then, DateTimeOffset now) => Math.Max(0, (long)(now - then).TotalSeconds);
}

/// <summary>On a family instance, keeps every connected family's calendar in sync with Google. Does nothing on the demo.</summary>
internal sealed class CalendarSyncService(
    IServiceScopeFactory scopes,
    CalendarSyncTrigger trigger,
    CalendarSyncHealth health,
    IOptions<InstanceOptions> instance,
    IOptions<CalendarSyncOptions> options,
    TimeProvider time,
    ILogger<CalendarSyncService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (instance.Value.Mode != InstanceMode.Family || !options.Value.Enabled)
        {
            return;
        }

        Guid? asked = null;
        while (!stoppingToken.IsCancellationRequested)
        {
            await SyncAsync(asked is { } familyId ? [familyId] : null, stoppingToken);
            asked = await trigger.WaitAsync(options.Value.Interval, time, stoppingToken);
        }
    }

    /// <summary>Syncs <paramref name="families"/>, or every connected family when null.</summary>
    private async Task SyncAsync(IReadOnlyList<Guid>? families, CancellationToken stoppingToken)
    {
        string? problem = null;
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var sync = scope.ServiceProvider.GetRequiredService<CalendarSync>();
            foreach (var familyId in families ?? await sync.ConnectedFamiliesAsync(stoppingToken))
            {
                try
                {
                    if (!await sync.SyncFamilyAsync(familyId, stoppingToken))
                    {
                        problem = "A family's Google connection needs connecting again.";
                    }
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                {
                    // One family's failure must not hold up the others: log it and try again next pass.
                    logger.LogError(exception, "Could not sync the calendars of family {FamilyId}", familyId);
                    problem = "The last calendar sync failed.";
                }
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
        {
            logger.LogError(exception, "Could not start a calendar sync");
            problem = "The last calendar sync failed.";
        }

        // A sync of one family says nothing about the others, so only a full pass clears a problem.
        if (families is null || problem is not null)
        {
            health.Report(problem);
        }

        if (families is null)
        {
            health.Passed();
        }
    }
}
