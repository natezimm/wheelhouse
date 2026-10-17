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

/// <summary><paramref name="CanWrite"/> says whether the screens can add and change events in it.</summary>
public sealed record CalendarSourceResponse(Guid Id, string Name, Guid? MemberId, bool CanWrite)
{
    public static CalendarSourceResponse From(CalendarSource source) => new(source.Id, source.Name, source.MemberId, source.CanWrite);
}

/// <summary>
/// A timed event carries <paramref name="StartsAt"/> and <paramref name="EndsAt"/>; an all-day
/// event carries <paramref name="StartDate"/> and an exclusive <paramref name="EndDate"/>.
/// <paramref name="Recurring"/> marks one occurrence of a repeating event.
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
    DateOnly? EndDate,
    bool Recurring)
{
    public static EventResponse From(EventInstance e, CalendarSource source) => new(
        e.Id, source.Id, source.MemberId, e.Title, e.Location, e.StartDate != null, e.StartsAt, e.EndsAt, e.StartDate, e.EndDate,
        e.RecurringEventId != null);
}

/// <summary>
/// An event as a screen sets it, in the family's own days and clock. A timed event runs from
/// <paramref name="StartTime"/> on <paramref name="StartDate"/> to <paramref name="EndTime"/> on
/// <paramref name="EndDate"/>; an all-day one has no times, and its <paramref name="EndDate"/> is
/// exclusive, as in <see cref="EventResponse"/>. <paramref name="Repeat"/> makes a new event a
/// series; a change to an existing event leaves how it repeats as it is.
/// </summary>
public sealed record EventRequest(
    Guid CalendarId,
    string? Title,
    string? Location,
    bool AllDay,
    DateOnly StartDate,
    TimeOnly? StartTime,
    DateOnly EndDate,
    TimeOnly? EndTime,
    EventRepeat Repeat = EventRepeat.Never);
