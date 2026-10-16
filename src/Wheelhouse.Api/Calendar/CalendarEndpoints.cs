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
        CancellationToken cancellationToken)
    {
        if (to <= from || to.DayNumber - from.DayNumber > MaxDays)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["to"] = [$"Ask for between 1 and {MaxDays} days."],
            });
        }

        var timeZoneId = await db.Families.Select(family => family.TimeZone).SingleOrDefaultAsync(cancellationToken);
        if (timeZoneId is null)
        {
            return TypedResults.NotFound();
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
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
            .Join(db.CalendarSources, e => e.CalendarSourceId, source => source.Id, (e, source) => new EventResponse(
                e.Id, source.Id, source.MemberId, e.Title, e.Location, e.StartDate != null, e.StartsAt, e.EndsAt, e.StartDate, e.EndDate))
            .ToListAsync(cancellationToken);

        // All-day events first on each day, then by start time.
        var ordered = events
            .OrderBy(e => e.AllDay ? StartOfDay(e.StartDate!.Value, zone) : e.StartsAt!.Value)
            .ThenBy(e => e.AllDay ? 0 : 1)
            .ThenBy(e => e.Title, StringComparer.Ordinal)
            .ToList();

        var needsReconnect = await db.GoogleConnections.AnyAsync(c => c.Status == GoogleConnectionStatus.NeedsReauth, cancellationToken);

        return TypedResults.Ok(new CalendarResponse(calendars, ordered, needsReconnect));
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
