using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// One occurrence of an event, cached from Google Calendar, which stays the source of truth.
/// Google expands recurring events, so a weekly event is one row per week, each pointing at
/// its series through <see cref="RecurringEventId"/>.
/// </summary>
/// <remarks>
/// A timed event has <see cref="StartsAt"/> and <see cref="EndsAt"/>, stored as UTC instants. An
/// all-day event has <see cref="StartDate"/> and <see cref="EndDate"/> instead, with the end
/// exclusive, as Google does: a one-day event on the 12th ends on the 13th.
/// </remarks>
public sealed class EventInstance : IFamilyOwned
{
    public Guid Id { get; set; }

    public Guid FamilyId { get; set; }

    public Guid CalendarSourceId { get; set; }

    public required string GoogleEventId { get; set; }

    /// <summary>The series this occurrence belongs to, or null for a one-off event.</summary>
    public string? RecurringEventId { get; set; }

    /// <summary>
    /// Google's version of the occurrence, sent back in <c>If-Match</c> when it is changed, so a
    /// change made elsewhere first is noticed rather than overwritten. Null for demo events.
    /// </summary>
    public string? ETag { get; set; }

    public required string Title { get; set; }

    public string? Location { get; set; }

    public DateTimeOffset? StartsAt { get; set; }

    public DateTimeOffset? EndsAt { get; set; }

    public DateOnly? StartDate { get; set; }

    public DateOnly? EndDate { get; set; }

    /// <summary>The longest notes the cache keeps.</summary>
    public const int MaxDescription = 8192;

    /// <summary>The event's notes, as Google has them, which may hold HTML.</summary>
    public string? Description { get; set; }

    /// <summary>Its series' repeat rule (RFC 5545), on every cached occurrence of the series; null for a one-off.</summary>
    public string? Recurrence { get; set; }

    /// <summary>
    /// The members the event is for besides its calendar's owner, kept in a hidden tag on the Google
    /// event (<see cref="GoogleCalendarApi.MembersKey"/>), so other Google Calendar apps never show it.
    /// </summary>
    public List<Guid> MemberIds { get; set; } = [];

    /// <summary>
    /// Google's visibility is private (or confidential): a paired display shows only that the time
    /// is busy, and only a parent can change it.
    /// </summary>
    public bool IsPrivate { get; set; }

    /// <summary>
    /// The wall counts down the days to it, kept in a hidden tag on the Google event
    /// (<see cref="GoogleCalendarApi.CountdownKey"/>).
    /// </summary>
    public bool Countdown { get; set; }

    public bool IsAllDay => StartDate is not null;
}
