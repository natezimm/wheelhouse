using System.Data;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// The one way the calendar is read: the screens' <c>GET /api/calendar</c> and search, and
/// anything else that answers from the calendar, such as Ask. It reads through the request's
/// <see cref="WheelhouseDbContext"/>, so the family query filter decides whose events these are,
/// and a paired display (<c>display</c>) gets a private event only as busy, or not at all.
/// </summary>
public sealed class CalendarReader(
    WheelhouseDbContext db,
    IGoogleCalendar google,
    GoogleTokens tokens,
    ILogger<CalendarReader> logger)
{
    /// <summary>
    /// The events that overlap the family's local days from <paramref name="from"/> up to, but not
    /// including, <paramref name="to"/>, or null when there is no family. The days are the family's,
    /// in its own time zone, so a phone in another zone still sees the family's day.
    /// </summary>
    public async Task<CalendarResponse?> ReadAsync(DateOnly from, DateOnly to, bool display, CancellationToken cancellationToken)
    {
        // These are several queries. PostgreSQL's repeatable-read snapshot keeps the revision,
        // calendars, occurrences and reconnect flag together even if a writer commits between them.
        await using var snapshot = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        var family = await db.Families.AsNoTracking()
            .Select(f => new { f.TimeZone, f.CalendarChangeNumber }).SingleOrDefaultAsync(cancellationToken);
        if (family is null)
        {
            return null;
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        var fromUtc = CalendarEndpoints.StartOfDay(from, zone);
        var toUtc = CalendarEndpoints.StartOfDay(to, zone);

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
        var responses = events.Select(e => EventResponse.From(e.Event, e.Source).For(display));

        // All-day events first on each day, then by start time.
        var ordered = responses
            .OrderBy(e => e.AllDay ? CalendarEndpoints.StartOfDay(e.StartDate!.Value, zone) : e.StartsAt!.Value)
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
        return new CalendarResponse(calendars, ordered, needsReconnect, family.CalendarChangeNumber, window?.From, window?.To);
    }

    /// <summary>
    /// The family's events whose title or place holds <paramref name="text"/>, ignoring case, one per
    /// series: the series' next occurrence from the family's day <paramref name="from"/>, or its
    /// latest one when they are all past. Upcoming events come first, soonest first, then past
    /// ones, latest first. A paired display never finds a private event, since searching for its
    /// title would tell what it is. Null when there is no family.
    /// </summary>
    /// <remarks>
    /// The cache holds only the sync window, so on a family instance Google is also searched before
    /// and after it, and any time is found. Those events are not cached and come back in
    /// <see cref="SearchResponse.NotCached"/>; a screen shows them but cannot change them. When
    /// Google cannot be asked, the window's events still come back, with
    /// <see cref="SearchResponse.Complete"/> false.
    /// </remarks>
    public async Task<SearchResponse?> SearchAsync(string text, DateOnly from, bool display, CancellationToken cancellationToken)
    {
        var timeZone = await db.Families.AsNoTracking().Select(f => f.TimeZone).SingleOrDefaultAsync(cancellationToken);
        if (timeZone is null)
        {
            return null;
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var fromUtc = CalendarEndpoints.StartOfDay(from, zone);
        // LIKE's own characters are matched as themselves.
        var pattern = "%" + text.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_") + "%";
        var found = await db.EventInstances
            .AsNoTracking()
            .Where(e => (!display || !e.IsPrivate)
                && (EF.Functions.ILike(e.Title, pattern, @"\") || (e.Location != null && EF.Functions.ILike(e.Location, pattern, @"\"))))
            .Join(db.CalendarSources, e => e.CalendarSourceId, source => source.Id, (e, source) => new Hit(e, source, false))
            .ToListAsync(cancellationToken);

        var (beyond, complete) = await SearchGoogleAsync(text, display, zone, cancellationToken);
        // The cache is the newer word on anything it holds, and any series it holds has its nearest occurrences there.
        var cachedSeries = found.Select(SeriesKey).ToHashSet();
        found.AddRange(beyond.Where(hit => !cachedSeries.Contains(SeriesKey(hit))));

        var series = found
            .Select(e => new { Hit = e, Starts = Starts(e.Event, zone), Ends = Ends(e.Event, zone) })
            .GroupBy(e => SeriesKey(e.Hit))
            .Select(occurrences =>
                occurrences.Where(e => e.Ends > fromUtc).MinBy(e => e.Starts) is { } next
                    ? (Event: next, Upcoming: true)
                    : (Event: occurrences.MaxBy(e => e.Starts)!, Upcoming: false))
            .ToList();

        var upcoming = series.Where(s => s.Upcoming).OrderBy(s => s.Event.Starts).ThenBy(s => s.Event.Hit.Event.Title, StringComparer.Ordinal);
        var past = series.Where(s => !s.Upcoming).OrderByDescending(s => s.Event.Starts).ThenBy(s => s.Event.Hit.Event.Title, StringComparer.Ordinal);
        var shown = upcoming.Concat(past).Take(CalendarEndpoints.MaxSearchResults).Select(s => s.Event.Hit).ToList();
        var events = shown.Select(hit => EventResponse.From(hit.Event, hit.Source)).ToList();
        var notCached = shown.Where(hit => hit.NotCached).Select(hit => hit.Event.Id).ToList();
        return new SearchResponse(events, series.Count, notCached, complete);
    }

    /// <summary>One occurrence a search found, from the cache or, when <paramref name="NotCached"/>, from Google beyond the sync window.</summary>
    private sealed record Hit(EventInstance Event, CalendarSource Source, bool NotCached);

    private static (Guid, string) SeriesKey(Hit hit) => (hit.Source.Id, hit.Event.RecurringEventId ?? hit.Event.GoogleEventId);

    /// <summary>
    /// Google's occurrences matching <paramref name="text"/> before and after the sync window, of
    /// the family's Google calendars, as uncached rows with ids of their own. None on the demo or
    /// without a working connection; false when Google could not be asked about all of them.
    /// </summary>
    private async Task<(List<Hit> Hits, bool Complete)> SearchGoogleAsync(string text, bool display, TimeZoneInfo zone, CancellationToken cancellationToken)
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

        var hits = new List<Hit>();
        var complete = true;
        try
        {
            var accessToken = await google.AccessTokenAsync(tokens.Unprotect(connection.EncryptedRefreshToken), cancellationToken);
            var windowFrom = CalendarEndpoints.StartOfDay(window.From, zone);
            var windowTo = CalendarEndpoints.StartOfDay(window.To, zone);
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
        var windowStart = CalendarEndpoints.StartOfDay(window.From, zone);
        var windowEnd = CalendarEndpoints.StartOfDay(window.To, zone);
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

    /// <summary>When an occurrence starts, an all-day one at the start of its first day in <paramref name="zone"/>.</summary>
    public static DateTimeOffset Starts(EventInstance e, TimeZoneInfo zone) => e.StartsAt ?? CalendarEndpoints.StartOfDay(e.StartDate!.Value, zone);

    /// <summary>When an occurrence ends, an all-day one at the start of the day after its last.</summary>
    public static DateTimeOffset Ends(EventInstance e, TimeZoneInfo zone) => e.EndsAt ?? CalendarEndpoints.StartOfDay(e.EndDate!.Value, zone);

    /// <summary>Whether the title or place holds <paramref name="text"/>, ignoring case, as the cache's search matches.</summary>
    private static bool Matches(EventInstance e, string text) =>
        e.Title.Contains(text, StringComparison.OrdinalIgnoreCase) || e.Location?.Contains(text, StringComparison.OrdinalIgnoreCase) == true;
}
