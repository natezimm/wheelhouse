namespace Wheelhouse.Api.Calendar;

/// <summary>
/// The calendars a family shows, and their events in the range that was asked for.
/// <paramref name="NeedsReconnect"/> says Google stopped accepting the family's connection, so
/// the events have stopped updating until a parent connects again.
/// </summary>
public sealed record CalendarResponse(
    IReadOnlyList<CalendarSourceResponse> Calendars,
    IReadOnlyList<EventResponse> Events,
    bool NeedsReconnect);

public sealed record CalendarSourceResponse(Guid Id, string Name, Guid? MemberId)
{
    public static CalendarSourceResponse From(CalendarSource source) => new(source.Id, source.Name, source.MemberId);
}

/// <summary>
/// A timed event carries <paramref name="StartsAt"/> and <paramref name="EndsAt"/>; an all-day
/// event carries <paramref name="StartDate"/> and an exclusive <paramref name="EndDate"/>.
/// </summary>
public sealed record EventResponse(
    Guid Id,
    Guid CalendarId,
    Guid? MemberId,
    string Title,
    string? Location,
    bool AllDay,
    DateTimeOffset? StartsAt,
    DateTimeOffset? EndsAt,
    DateOnly? StartDate,
    DateOnly? EndDate);
