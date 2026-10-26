namespace Wheelhouse.Api.Calendar;

/// <summary>
/// The calendars a family shows, and their events in the range that was asked for.
/// <paramref name="NeedsReconnect"/> says Google stopped accepting the family's connection, so
/// the events have stopped updating until a parent connects again.
/// <paramref name="ChangeNumber"/> identifies the complete committed calendar snapshot,
/// across all date ranges. A later number means the client should read its days again.
/// </summary>
public sealed record CalendarResponse(
    IReadOnlyList<CalendarSourceResponse> Calendars,
    IReadOnlyList<EventResponse> Events,
    bool NeedsReconnect,
    long ChangeNumber);

/// <summary><paramref name="CanWrite"/> says whether the screens can add and change events in it.</summary>
public sealed record CalendarSourceResponse(Guid Id, string Name, Guid? MemberId, bool CanWrite)
{
    public static CalendarSourceResponse From(CalendarSource source) => new(source.Id, source.Name, source.MemberId, source.CanWrite);
}

/// <summary>
/// A timed event carries <paramref name="StartsAt"/> and <paramref name="EndsAt"/>; an all-day
/// event carries <paramref name="StartDate"/> and an exclusive <paramref name="EndDate"/>.
/// <paramref name="Recurring"/> marks one occurrence of a repeating event. The event is for
/// its calendar's owner (<paramref name="MemberId"/>) and <paramref name="MemberIds"/>.
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
    bool Recurring,
    string? SeriesId = null,
    Guid? CreationId = null,
    string? Description = null,
    string? Recurrence = null,
    IReadOnlyList<Guid>? MemberIds = null)
{
    public static EventResponse From(EventInstance e, CalendarSource source) => new(
        e.Id, source.Id, source.MemberId, e.Title, e.Location, e.StartDate != null, e.StartsAt, e.EndsAt, e.StartDate, e.EndDate,
        e.RecurringEventId != null, EventIdentity.Series(e), EventIdentity.Creation(e), e.Description, e.Recurrence,
        e.MemberIds.Where(id => id != source.MemberId).ToList());
}

/// <summary>
/// An event as a screen sets it, in the family's own days and clock. A timed event runs from
/// <paramref name="StartTime"/> on <paramref name="StartDate"/> to <paramref name="EndTime"/> on
/// <paramref name="EndDate"/>; an all-day one has no times, and its <paramref name="EndDate"/> is
/// exclusive, as in <see cref="EventResponse"/>. <paramref name="Recurrence"/>, a rule such as
/// <c>RRULE:FREQ=WEEKLY;BYDAY=TU,TH</c> (<see cref="RepeatRules"/>), or else the simpler
/// <paramref name="Repeat"/>, makes a new event, or a change to one that does not repeat yet, the
/// first of a series, and with a change to a whole series gives it that rule. Left out, a change
/// to an event that already repeats leaves its rule as it is. <paramref name="MemberIds"/> are the
/// members it is for besides its calendar's owner; left out, a change leaves them as they are.
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
    EventRepeat Repeat = EventRepeat.Never,
    Guid? CreationId = null,
    string? Description = null,
    string? Recurrence = null,
    IReadOnlyList<Guid>? MemberIds = null);
