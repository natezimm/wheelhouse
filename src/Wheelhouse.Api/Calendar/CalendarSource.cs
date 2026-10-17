using Wheelhouse.Api.Data;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// One Google calendar the family shows. The family's shared Google account owns one calendar
/// per person or type; each row says whose it is, which decides the color its events take.
/// </summary>
public sealed class CalendarSource : IFamilyOwned
{
    public Guid Id { get; set; }

    public Guid FamilyId { get; set; }

    /// <summary>The calendar's id in Google. Demo calendars have made-up ids and never reach Google.</summary>
    public required string GoogleCalendarId { get; set; }

    /// <summary>The calendar's name, as Google has it.</summary>
    public required string Name { get; set; }

    /// <summary>Whose calendar it is. Null means it is the whole family's.</summary>
    public Guid? MemberId { get; set; }

    /// <summary>
    /// Whether the shared account may add and change events in it, as Google's calendar list
    /// says. Read-only calendars, such as a holidays calendar, are shown but never offered for a
    /// new event. Demo calendars are writable; their changes stay in the cache.
    /// </summary>
    public bool CanWrite { get; set; } = true;

    /// <summary>When its events in the cache were last brought up to date.</summary>
    public DateTimeOffset? LastSyncedAt { get; set; }

    /// <summary>
    /// Google's token for asking what changed since the last sync. Null before the first sync,
    /// and for demo calendars.
    /// </summary>
    public string? SyncToken { get; set; }

    /// <summary>
    /// When the cached window of events was last read from Google in full. The window moves with
    /// the days, so it is read again at least once a day even when nothing changed.
    /// </summary>
    public DateTimeOffset? ListedAt { get; set; }

    public List<EventInstance> Events { get; } = [];
}
