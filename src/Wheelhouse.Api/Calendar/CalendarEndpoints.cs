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
