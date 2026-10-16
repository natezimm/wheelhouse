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

    /// <summary>When its events in the cache were last brought up to date.</summary>
    public DateTimeOffset? LastSyncedAt { get; set; }

    public List<EventInstance> Events { get; } = [];
}
