using System.Diagnostics;
using System.Threading.Channels;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Instance;
using Wheelhouse.Api.Diagnostics;

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
/// <see cref="StaleAfter"/>, or has never synced that long after the account was connected
/// (Google no longer shows it to the account, or every pass fails), while the worker has not
/// finished a pass for as long (it is stuck or has stopped), or when the last pass failed. The
/// first two are read from the database on each check, so they hold across passes: a pass skips a
/// connection that needs reconnecting and a calendar Google no longer has, and so cannot clear them
/// by succeeding at everything else. Its data says how old the last pass and the stalest calendar
/// are, so an alert or a person can see how far behind Google it is.
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
        // A calendar that has never synced counts from when the account was connected, so one that fails from the start is noticed too.
        var synced = db.CalendarSources.IgnoreQueryFilters()
            .Join(connections.Where(c => c.Status == GoogleConnectionStatus.Connected), s => s.FamilyId, c => c.FamilyId, (s, c) => s.LastSyncedAt ?? c.ConnectedAt);
        var calendars = await synced.CountAsync(cancellationToken);
        var stalest = calendars > 0 ? await synced.MinAsync(cancellationToken) : (DateTimeOffset?)null;
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

/// <summary>
/// How long a family whose sync failed waits before the worker asks Google for it again. Each
/// failure in a row doubles the wait, from one interval up to <see cref="Longest"/>, and Google
/// asking to slow down doubles it once more and is never asked sooner than it said; a sync that
/// works starts again from nothing. A family a parent asks for now (connecting, choosing
/// calendars) is synced whatever its wait.
/// </summary>
public sealed class CalendarSyncBackoff(TimeProvider time, IOptions<CalendarSyncOptions> options)
{
    public static readonly TimeSpan Longest = TimeSpan.FromMinutes(30);

    private readonly Dictionary<Guid, (int Failures, DateTimeOffset NotBefore)> _waiting = [];

    /// <summary>Whether the family is still waiting out its last failure.</summary>
    public bool IsWaiting(Guid familyId) =>
        _waiting.TryGetValue(familyId, out var wait) && time.GetUtcNow() < wait.NotBefore;

    /// <summary>When the family will next be asked for, or null when it is not waiting.</summary>
    public DateTimeOffset? NotBefore(Guid familyId) => _waiting.TryGetValue(familyId, out var wait) ? wait.NotBefore : null;

    public void Succeeded(Guid familyId) => _waiting.Remove(familyId);

    public void Failed(Guid familyId, Exception exception)
    {
        var failures = (_waiting.TryGetValue(familyId, out var wait) ? wait.Failures : 0) + 1;
        var limited = exception as GoogleRateLimitedException;
        var doublings = Math.Min(failures - 1 + (limited is null ? 0 : 1), 10);
        var delay = TimeSpan.FromTicks(Math.Min(Longest.Ticks, options.Value.Interval.Ticks << doublings));
        if (limited?.RetryAfter is { } asked && asked > delay)
        {
            delay = asked;
        }

        _waiting[familyId] = (failures, time.GetUtcNow() + delay);
    }
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
    private readonly CalendarSyncBackoff _backoff = new(time, options);

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

    /// <summary>Syncs <paramref name="families"/>, asked for by a parent, or every connected family that is not waiting out a failure when null.</summary>
    private async Task SyncAsync(IReadOnlyList<Guid>? families, CancellationToken stoppingToken)
    {
        // A pass has no request around it, so it starts its own trace; Google's calls and the cache's SQL hang off it.
        using var pass = WheelhouseTelemetry.Source.StartActivity("wheelhouse.calendar.sync");
        pass?.SetTag("wheelhouse.sync.asked", families is not null);
        var started = time.GetTimestamp();
        try
        {
            await SyncFamiliesAsync(families, stoppingToken);
        }
        finally
        {
            WheelhouseTelemetry.SyncDuration.Record(time.GetElapsedTime(started).TotalSeconds,
                new KeyValuePair<string, object?>("wheelhouse.sync.asked", families is not null));
        }
    }

    private async Task SyncFamiliesAsync(IReadOnlyList<Guid>? families, CancellationToken stoppingToken)
    {
        string? problem = null;
        try
        {
            IReadOnlyList<Guid> due;
            if (families is null)
            {
                await using var scope = scopes.CreateAsyncScope();
                var connected = await scope.ServiceProvider.GetRequiredService<CalendarSync>().ConnectedFamiliesAsync(stoppingToken);
                due = connected.Where(familyId => !_backoff.IsWaiting(familyId)).ToList();
                if (due.Count < connected.Count)
                {
                    // A family still waiting has not synced since it failed.
                    problem = "A calendar sync failed and is waiting before it asks Google again.";
                }
            }
            else
            {
                due = families;
            }

            foreach (var familyId in due)
            {
                // Each family gets its own context, so nothing one family's failure left tracked is saved with the next.
                await using var scope = scopes.CreateAsyncScope();
                var sync = scope.ServiceProvider.GetRequiredService<CalendarSync>();
                using var activity = WheelhouseTelemetry.Source.StartActivity("wheelhouse.calendar.sync.family");
                activity?.SetTag("wheelhouse.family_id", familyId);
                try
                {
                    var connected = await sync.SyncFamilyAsync(familyId, stoppingToken);
                    if (!connected)
                    {
                        problem = "A family's Google connection needs connecting again.";
                    }

                    _backoff.Succeeded(familyId);
                    Count(connected ? "synced" : "needs_reconnect");
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                {
                    // One family's failure must not hold up the others: log it and wait before asking Google again.
                    _backoff.Failed(familyId, exception);
                    activity?.SetStatus(ActivityStatusCode.Error, exception.GetType().Name);
                    Count(exception is GoogleRateLimitedException ? "rate_limited" : "failed");
                    logger.LogError(exception, "Could not sync the calendars of family {FamilyId}; trying again after {NotBefore}", familyId, _backoff.NotBefore(familyId));
                    problem = exception is GoogleRateLimitedException
                        ? "Google asked Wheelhouse to slow down; the calendar sync is waiting."
                        : "The last calendar sync failed.";
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

    private static void Count(string outcome) =>
        WheelhouseTelemetry.FamilySyncs.Add(1, new KeyValuePair<string, object?>("wheelhouse.outcome", outcome));
}
