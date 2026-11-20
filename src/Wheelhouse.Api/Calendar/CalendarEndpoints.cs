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
        CalendarReader reader,
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

        return await reader.ReadAsync(from, to, user.IsDisplay(), cancellationToken) is { } calendar
            ? TypedResults.Ok(calendar)
            : TypedResults.NotFound();
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
    /// series (<see cref="CalendarReader.SearchAsync"/>).
    /// </summary>
    private static async Task<Results<Ok<SearchResponse>, ValidationProblem, NotFound>> Search(
        string? q,
        DateOnly from,
        CalendarReader reader,
        ClaimsPrincipal user,
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

        return await reader.SearchAsync(text, from, user.IsDisplay(), cancellationToken) is { } found
            ? TypedResults.Ok(found)
            : TypedResults.NotFound();
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
