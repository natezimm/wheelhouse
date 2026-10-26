namespace Wheelhouse.Api.Calendar;

/// <summary>How often an event repeats, as the Repeat row of a new event, or of one that does not repeat yet, offers it.</summary>
public enum EventRepeat
{
    Never,
    Daily,
    Weekly,
    Monthly,
}

/// <summary>
/// Repeating events, which Google keeps as one series and expands into occurrences. A change to
/// a whole series from a screen keeps every occurrence on its own day: it changes the title,
/// place, times and length, and can move the series to another calendar, but moving a series to
/// other days means rewriting its rule, which is left to Google Calendar.
/// </summary>
public static class EventSeries
{
    /// <summary>The rule Google is given for a new series (RFC 5545), or null for a one-off event.</summary>
    public static string? RuleFor(EventRepeat repeat) => repeat switch
    {
        EventRepeat.Daily => "RRULE:FREQ=DAILY",
        EventRepeat.Weekly => "RRULE:FREQ=WEEKLY",
        EventRepeat.Monthly => "RRULE:FREQ=MONTHLY",
        _ => null,
    };

    /// <summary>
    /// A new series' occurrences, from its first event, up to <paramref name="until"/>, as Google would expand them, for
    /// the demo, which never calls Google. A monthly event on the 31st skips the shorter months, as
    /// the rule does.
    /// </summary>
    public static IEnumerable<GoogleEvent> Occurrences(
        GoogleEventDraft draft, EventRepeat repeat, string seriesId, DateOnly until, TimeZoneInfo zone)
    {
        var first = draft.StartDate ?? DayOf(draft.StartsAt!.Value, zone);
        for (var n = 0; ; n++)
        {
            DateOnly date;
            if (repeat == EventRepeat.Monthly)
            {
                var month = first.AddDays(1 - first.Day).AddMonths(n);
                if (first.Day > DateTime.DaysInMonth(month.Year, month.Month))
                {
                    continue;
                }

                date = month.AddDays(first.Day - 1);
            }
            else
            {
                date = first.AddDays(n * (repeat == EventRepeat.Daily ? 1 : 7));
            }

            // The first occurrence is there however far ahead it is.
            if (date > until && date != first)
            {
                yield break;
            }

            var id = $"{seriesId}_{date:yyyyMMdd}";
            if (draft.StartDate is { } startDate)
            {
                yield return new GoogleEvent(id, seriesId, draft.Title, draft.Location, null, null,
                    date, date.AddDays(draft.EndDate!.Value.DayNumber - startDate.DayNumber), null, draft.Description, draft.Recurrence);
            }
            else
            {
                var startsAt = CalendarEndpoints.At(date, TimeOf(draft.StartsAt!.Value, zone), zone);
                yield return new GoogleEvent(id, seriesId, draft.Title, draft.Location,
                    startsAt, startsAt + (draft.EndsAt!.Value - draft.StartsAt.Value), null, null, null, draft.Description, draft.Recurrence);
            }
        }
    }

    /// <summary>
    /// What is wrong with changing a whole series to <paramref name="request"/> from its occurrence
    /// <paramref name="row"/>, or null when nothing is.
    /// </summary>
    public static Dictionary<string, string[]>? Errors(EventInstance row, EventRequest request, TimeZoneInfo zone)
    {
        if (request.AllDay != row.IsAllDay)
        {
            return new() { ["allDay"] = ["A whole series stays all day or timed. Change only this event, or the series in Google Calendar."] };
        }

        return request.StartDate != DayOf(row, zone)
            ? new() { ["startDate"] = ["Every event in a series keeps its day. Change only this event to move it."] }
            : null;
    }

    /// <summary>
    /// The series' first event, Google's <paramref name="master"/>, changed as an occurrence of it
    /// was: same day, the occurrence's new times and length.
    /// </summary>
    public static GoogleEventDraft MasterDraft(GoogleEvent master, GoogleEventDraft draft, TimeZoneInfo zone)
    {
        if (draft.StartDate is { } startDate)
        {
            var first = master.StartDate ?? DayOf(master.StartsAt!.Value, zone);
            return draft with { StartDate = first, EndDate = first.AddDays(draft.EndDate!.Value.DayNumber - startDate.DayNumber) };
        }

        var day = master.StartDate ?? DayOf(master.StartsAt!.Value, zone);
        var startsAt = CalendarEndpoints.At(day, TimeOf(draft.StartsAt!.Value, zone), zone);
        return draft with { StartsAt = startsAt, EndsAt = startsAt + (draft.EndsAt!.Value - draft.StartsAt.Value) };
    }

    /// <summary>
    /// Changes cached occurrences of a series as Google changes them for a change to the whole
    /// series: the demo's only copy, and on a family instance a stand-in until the next sync.
    /// </summary>
    public static void Apply(IEnumerable<EventInstance> rows, GoogleEventDraft draft, TimeZoneInfo zone)
    {
        foreach (var row in rows)
        {
            var day = DayOf(row, zone);
            var occurrence = MasterDraft(new GoogleEvent("", null, "", null, null, null, day, day), draft, zone);
            CalendarSync.CopyTo(row, new GoogleEvent(row.GoogleEventId, row.RecurringEventId, occurrence.Title, occurrence.Location,
                occurrence.StartsAt, occurrence.EndsAt, occurrence.StartDate, occurrence.EndDate, row.ETag,
                draft.Description ?? row.Description, row.Recurrence));
        }
    }

    /// <summary>The family's day an occurrence starts on.</summary>
    public static DateOnly DayOf(EventInstance row, TimeZoneInfo zone) => row.StartDate ?? DayOf(row.StartsAt!.Value, zone);

    private static DateOnly DayOf(DateTimeOffset instant, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);

    private static TimeOnly TimeOf(DateTimeOffset instant, TimeZoneInfo zone) =>
        TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);
}
