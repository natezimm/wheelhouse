using System.Data;
using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Calendar;

public static class CalendarEndpoints
{
    /// <summary>The longest range one request can ask for: a month view, with the days around it.</summary>
    public const int MaxDays = 42;

    /// <summary>Anyone in the family can read the calendar, the wall included.</summary>
    public static IEndpointRouteBuilder MapCalendar(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/calendar", GetCalendar).RequireAuthorization(Policies.Family);
        app.MapGet("/api/calendar/countdowns", GetCountdowns).RequireAuthorization(Policies.Family);
        app.MapGet("/api/calendar/search", Search).RequireAuthorization(Policies.Family);

        return app;
    }

    /// <summary>
    /// The events that overlap the family's local days from <paramref name="from"/> up to, but not
    /// including, <paramref name="to"/>. The days are the family's, in its own time zone, so a
    /// phone in another zone still sees the family's day.
    /// </summary>
    private static async Task<Results<Ok<CalendarResponse>, ValidationProblem, NotFound>> GetCalendar(
        DateOnly from,
        DateOnly to,
        WheelhouseDbContext db,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        if (to <= from || to.DayNumber - from.DayNumber > MaxDays)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["to"] = [$"Ask for between 1 and {MaxDays} days."],
            });
        }

        // These are several queries. PostgreSQL's repeatable-read snapshot keeps the revision,
        // calendars, occurrences and reconnect flag together even if a writer commits between them.
        await using var snapshot = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        var family = await db.Families.AsNoTracking()
            .Select(f => new { f.TimeZone, f.CalendarChangeNumber }).SingleOrDefaultAsync(cancellationToken);
        if (family is null)
        {
            return TypedResults.NotFound();
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        var fromUtc = StartOfDay(from, zone);
        var toUtc = StartOfDay(to, zone);

        var calendars = await db.CalendarSources
            .AsNoTracking()
            .OrderBy(source => source.Name)
            .Select(source => CalendarSourceResponse.From(source))
            .ToListAsync(cancellationToken);

        var events = await db.EventInstances
            .AsNoTracking()
            .Where(e => (e.StartDate != null && e.StartDate < to && e.EndDate > from)
                || (e.StartsAt != null && e.StartsAt < toUtc && e.EndsAt > fromUtc))
            .Join(db.CalendarSources, e => e.CalendarSourceId, source => source.Id, (e, source) => new { Event = e, Source = source })
            .ToListAsync(cancellationToken);
        // A paired display hangs where visitors see it, so a private event shows only as busy.
        var display = user.IsDisplay();
        var responses = events.Select(e => EventResponse.From(e.Event, e.Source).For(display));

        // All-day events first on each day, then by start time.
        var ordered = responses
            .OrderBy(e => e.AllDay ? StartOfDay(e.StartDate!.Value, zone) : e.StartsAt!.Value)
            .ThenBy(e => e.AllDay ? 0 : 1)
            .ThenBy(e => e.Title, StringComparer.Ordinal)
            .ToList();

        var needsReconnect = await db.GoogleConnections.AnyAsync(c => c.Status == GoogleConnectionStatus.NeedsReauth, cancellationToken);

        // Only Google calendars have a window; a demo copy's cache is all there is.
        var listedAt = await db.CalendarSources
            .Where(source => source.ListedAt != null)
            .Select(source => source.ListedAt!.Value)
            .ToListAsync(cancellationToken);
        var window = CalendarSync.Window(listedAt, zone);

        await snapshot.CommitAsync(cancellationToken);
        return TypedResults.Ok(new CalendarResponse(
            calendars, ordered, needsReconnect, family.CalendarChangeNumber, window?.From, window?.To));
    }

    /// <summary>How many countdowns the wall shows at once.</summary>
    public const int MaxCountdowns = 3;

    /// <summary>
    /// The next few events marked to count down to that start on or after the family's day
    /// <paramref name="from"/>, soonest first, one per series. A paired display never sees a private
    /// one, since a countdown names the event.
    /// </summary>
    private static async Task<Results<Ok<List<EventResponse>>, NotFound>> GetCountdowns(
        DateOnly from,
        WheelhouseDbContext db,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var timeZone = await db.Families.AsNoTracking().Select(f => f.TimeZone).SingleOrDefaultAsync(cancellationToken);
        if (timeZone is null)
        {
            return TypedResults.NotFound();
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var fromUtc = StartOfDay(from, zone);
        var display = user.IsDisplay();
        var marked = await db.EventInstances
            .AsNoTracking()
            .Where(e => e.Countdown && (!display || !e.IsPrivate)
                && ((e.StartDate != null && e.StartDate >= from) || (e.StartsAt != null && e.StartsAt >= fromUtc)))
            .Join(db.CalendarSources, e => e.CalendarSourceId, source => source.Id, (e, source) => new { Event = e, Source = source })
            .ToListAsync(cancellationToken);

        var next = marked
            .Select(e => new { e.Event, Response = EventResponse.From(e.Event, e.Source), Starts = e.Event.StartsAt ?? StartOfDay(e.Event.StartDate!.Value, zone) })
            .GroupBy(e => (e.Event.CalendarSourceId, e.Event.RecurringEventId ?? e.Event.GoogleEventId))
            .Select(series => series.MinBy(e => e.Starts)!)
            .OrderBy(e => e.Starts)
            .ThenBy(e => e.Response.Title, StringComparer.Ordinal)
            .Take(MaxCountdowns)
            .Select(e => e.Response)
            .ToList();
        return TypedResults.Ok(next);
    }

    /// <summary>The most events one search answers with.</summary>
    public const int MaxSearchResults = 30;

    /// <summary>The longest search text, in characters.</summary>
    public const int MaxSearchLength = 100;

    /// <summary>
    /// The family's events whose title or place holds <paramref name="q"/>, ignoring case, one per
    /// series: the series' next occurrence from the family's day <paramref name="from"/>, or its
    /// latest one when they are all past. Upcoming events come first, soonest first, then past
    /// ones, latest first. A paired display never finds a private event, since searching for its
    /// title would tell what it is.
    /// </summary>
    /// <remarks>
    /// The cache holds only the sync window, so on a family instance Google is also searched before
    /// and after it, and any time is found. Those events are not cached and come back in
    /// <see cref="SearchResponse.NotCached"/>; a screen shows them but cannot change them. When
    /// Google cannot be asked, the window's events still come back, with
    /// <see cref="SearchResponse.Complete"/> false.
    /// </remarks>
    private static async Task<Results<Ok<SearchResponse>, ValidationProblem, NotFound>> Search(
        string? q,
        DateOnly from,
        WheelhouseDbContext db,
        ClaimsPrincipal user,
        IGoogleCalendar google,
        GoogleTokens tokens,
        ILoggerFactory loggers,
        CancellationToken cancellationToken)
    {
        var text = q?.Trim() ?? "";
        if (text.Length is 0 or > MaxSearchLength)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["q"] = [$"Search for 1 to {MaxSearchLength} characters."],
            });
        }

        var timeZone = await db.Families.AsNoTracking().Select(f => f.TimeZone).SingleOrDefaultAsync(cancellationToken);
        if (timeZone is null)
        {
            return TypedResults.NotFound();
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var fromUtc = StartOfDay(from, zone);
        // LIKE's own characters are matched as themselves.
        var pattern = "%" + text.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_") + "%";
        var display = user.IsDisplay();
        var found = await db.EventInstances
            .AsNoTracking()
            .Where(e => (!display || !e.IsPrivate)
                && (EF.Functions.ILike(e.Title, pattern, @"\") || (e.Location != null && EF.Functions.ILike(e.Location, pattern, @"\"))))
            .Join(db.CalendarSources, e => e.CalendarSourceId, source => source.Id, (e, source) => new Hit(e, source, false))
            .ToListAsync(cancellationToken);

        var (beyond, complete) = await SearchGoogleAsync(text, display, zone, db, google, tokens, loggers, cancellationToken);
        // The cache is the newer word on anything it holds, and any series it holds has its nearest occurrences there.
        var cachedSeries = found.Select(SeriesKey).ToHashSet();
        found.AddRange(beyond.Where(hit => !cachedSeries.Contains(SeriesKey(hit))));

        var series = found
            .Select(e => new { Hit = e, Starts = e.Event.StartsAt ?? StartOfDay(e.Event.StartDate!.Value, zone), Ends = e.Event.EndsAt ?? StartOfDay(e.Event.EndDate!.Value, zone) })
            .GroupBy(e => SeriesKey(e.Hit))
            .Select(occurrences =>
                occurrences.Where(e => e.Ends > fromUtc).MinBy(e => e.Starts) is { } next
                    ? (Event: next, Upcoming: true)
                    : (Event: occurrences.MaxBy(e => e.Starts)!, Upcoming: false))
            .ToList();

        var upcoming = series.Where(s => s.Upcoming).OrderBy(s => s.Event.Starts).ThenBy(s => s.Event.Hit.Event.Title, StringComparer.Ordinal);
        var past = series.Where(s => !s.Upcoming).OrderByDescending(s => s.Event.Starts).ThenBy(s => s.Event.Hit.Event.Title, StringComparer.Ordinal);
        var shown = upcoming.Concat(past).Take(MaxSearchResults).Select(s => s.Event.Hit).ToList();
        var events = shown.Select(hit => EventResponse.From(hit.Event, hit.Source)).ToList();
        var notCached = shown.Where(hit => hit.NotCached).Select(hit => hit.Event.Id).ToList();
        return TypedResults.Ok(new SearchResponse(events, series.Count, notCached, complete));
    }

    /// <summary>One occurrence a search found, from the cache or, when <paramref name="NotCached"/>, from Google beyond the sync window.</summary>
    private sealed record Hit(EventInstance Event, CalendarSource Source, bool NotCached);

    private static (Guid, string) SeriesKey(Hit hit) => (hit.Source.Id, hit.Event.RecurringEventId ?? hit.Event.GoogleEventId);

    /// <summary>
    /// Google's occurrences matching <paramref name="text"/> before and after the sync window, of
    /// the family's Google calendars, as uncached rows with ids of their own. None on the demo or
    /// without a working connection; false when Google could not be asked about all of them.
    /// </summary>
    private static async Task<(List<Hit> Hits, bool Complete)> SearchGoogleAsync(
        string text,
        bool display,
        TimeZoneInfo zone,
        WheelhouseDbContext db,
        IGoogleCalendar google,
        GoogleTokens tokens,
        ILoggerFactory loggers,
        CancellationToken cancellationToken)
    {
        var sources = await db.CalendarSources.AsNoTracking().Where(source => source.ListedAt != null).ToListAsync(cancellationToken);
        if (CalendarSync.Window(sources.Select(source => source.ListedAt!.Value), zone) is not { } window)
        {
            return ([], true);
        }

        var connection = await db.GoogleConnections.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        if (connection is not { Status: GoogleConnectionStatus.Connected })
        {
            return ([], false);
        }

        var logger = loggers.CreateLogger(typeof(CalendarEndpoints));
        var hits = new List<Hit>();
        var complete = true;
        try
        {
            var accessToken = await google.AccessTokenAsync(tokens.Unprotect(connection.EncryptedRefreshToken), cancellationToken);
            var windowFrom = StartOfDay(window.From, zone);
            var windowTo = StartOfDay(window.To, zone);
            var asks = sources.SelectMany(source => SearchRanges(windowFrom, windowTo)
                .Select(range => (Source: source, Search: google.SearchEventsAsync(accessToken, source.GoogleCalendarId, text, range.From, range.To, cancellationToken))))
                .ToList();
            foreach (var (source, search) in asks)
            {
                try
                {
                    var found = await search;
                    if (found.Truncated)
                    {
                        // Some of what matched was not read, so the answer may miss events.
                        complete = false;
                    }

                    foreach (var googleEvent in found.Events)
                    {
                        var row = new EventInstance { Id = Guid.CreateVersion7(), FamilyId = source.FamilyId, CalendarSourceId = source.Id, GoogleEventId = googleEvent.Id, Title = "" };
                        CalendarSync.CopyTo(row, googleEvent);
                        if (Matches(row, text) && (!display || !row.IsPrivate))
                        {
                            hits.Add(new Hit(row, source, true));
                        }
                    }
                }
                catch (Exception exception) when (exception is GoogleCalendarGoneException or HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
                {
                    logger.LogWarning(exception, "Google could not search calendar {CalendarSourceId}", source.Id);
                    complete = false;
                }
            }
        }
        catch (Exception exception) when (exception is GoogleGrantRevokedException or System.Security.Cryptography.CryptographicException or HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            // The sync marks a refused grant for a parent to reconnect; a search only goes without.
            logger.LogWarning(exception, "Google could not be asked to search");
            complete = false;
        }

        // An occurrence the window reaches into is in the cache already.
        var windowStart = StartOfDay(window.From, zone);
        var windowEnd = StartOfDay(window.To, zone);
        hits.RemoveAll(hit => Ends(hit.Event, zone) > windowStart && Starts(hit.Event, zone) < windowEnd);
        return (hits, complete);
    }

    /// <summary>
    /// The times Google is searched beyond the window: everything after it, read soonest first, and
    /// the past in spans that grow going back. Google reads each span oldest first and stops at
    /// <see cref="GoogleCalendarApi.MaxSearchOccurrences"/>, so a long daily series is read from the
    /// span nearest the window too, and its latest occurrence is found there rather than lost behind
    /// its earliest ones.
    /// </summary>
    private static IEnumerable<(DateTimeOffset? From, DateTimeOffset? To)> SearchRanges(DateTimeOffset windowFrom, DateTimeOffset windowTo)
    {
        yield return (windowTo, null);
        var to = windowFrom;
        foreach (var years in new[] { 1, 3, 7 })
        {
            var from = windowFrom.AddYears(-years);
            yield return (from, to);
            to = from;
        }

        yield return (null, to);
    }

    private static DateTimeOffset Starts(EventInstance e, TimeZoneInfo zone) => e.StartsAt ?? StartOfDay(e.StartDate!.Value, zone);

    private static DateTimeOffset Ends(EventInstance e, TimeZoneInfo zone) => e.EndsAt ?? StartOfDay(e.EndDate!.Value, zone);

    /// <summary>Whether the title or place holds <paramref name="text"/>, ignoring case, as the cache's search matches.</summary>
    private static bool Matches(EventInstance e, string text) =>
        e.Title.Contains(text, StringComparison.OrdinalIgnoreCase) || e.Location?.Contains(text, StringComparison.OrdinalIgnoreCase) == true;

    /// <summary>The instant a local day begins in <paramref name="zone"/>, as UTC.</summary>
    public static DateTimeOffset StartOfDay(DateOnly day, TimeZoneInfo zone) => At(day, TimeOnly.MinValue, zone);

    /// <summary>
    /// The instant a local date and time happens in <paramref name="zone"/>, as UTC. A time
    /// skipped by a daylight-saving change counts as the moment after the gap.
    /// </summary>
    public static DateTimeOffset At(DateOnly day, TimeOnly time, TimeZoneInfo zone)
    {
        var local = day.ToDateTime(time, DateTimeKind.Unspecified);
        while (zone.IsInvalidTime(local))
        {
            local = local.AddMinutes(30);
        }

        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, zone), TimeSpan.Zero);
    }
}
