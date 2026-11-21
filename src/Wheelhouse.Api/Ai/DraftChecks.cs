using System.Globalization;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Ai;

/// <summary>
/// Turns what the model filled in into a draft the editor can show, trusting none of it: dates are
/// parsed and held to sensible days, a time skipped by a clock change moves past the gap, a missing or
/// backward end becomes an hour after the start, a repeat rule must be one the screens offer and fall
/// on the start's weekday, and people and calendars must be the family's own. Whatever was guessed is
/// named in <see cref="EventDraftResponse.Unclear"/>.
/// </summary>
public static class DraftChecks
{
    public const int MaxTitle = 200;
    public const int MaxLocation = 200;

    /// <summary>How far ahead a draft may start when the family has no sync window, as on the demo.</summary>
    public const int MaxDaysAhead = 400;

    public static readonly TimeOnly DefaultStart = new(9, 0);

    public static EventDraftResponse Check(EventDraftOutput? output, string text, DraftContext context)
    {
        var unclear = new List<string>();
        var today = context.Today;

        var title = Trim(output?.Title, MaxTitle);
        if (title is null)
        {
            title = Trim(text, MaxTitle) ?? "New event";
            unclear.Add("title");
        }

        var location = Trim(output?.Location, MaxLocation);
        var allDay = output?.AllDay ?? false;

        var start = Date(output?.StartDate);
        var latest = context.SyncedTo?.AddDays(-1) ?? today.AddDays(MaxDaysAhead);
        if (start is not { } day || day < today.AddDays(-1) || day > latest)
        {
            start = today;
            unclear.Add("day");
        }

        var startDay = start.Value;

        var rule = RepeatRules.Parse(output?.Recurrence, context.Zone);
        if (output?.Recurrence is { Length: > 0 } && rule is null)
        {
            unclear.Add("repeat");
        }

        // A weekly rule's first event is on one of its weekdays: "soccer every Tuesday" starts on a Tuesday.
        if (rule is { Frequency: "WEEKLY", Days.Count: > 0 } && !rule.Days.Contains(startDay.DayOfWeek))
        {
            var moved = startDay;
            while (!rule.Days.Contains(moved.DayOfWeek))
            {
                moved = moved.AddDays(1);
            }

            startDay = moved;
            Add(unclear, "day");
        }

        if (rule?.Until is { } until && until < startDay)
        {
            rule = rule with { Until = null };
            Add(unclear, "repeat");
        }

        if (Weekday(output?.Weekday) is { } named && named != startDay.DayOfWeek)
        {
            unclear.Add("weekday");
        }

        DateOnly endDay;
        TimeOnly? startTime = null, endTime = null;
        if (allDay)
        {
            endDay = Date(output?.EndDate) is { } end && end > startDay && end <= startDay.AddDays(31) ? end : startDay.AddDays(1);
        }
        else
        {
            var time = Time(output?.StartTime);
            if (time is null)
            {
                time = DefaultStart;
                unclear.Add("time");
            }

            // A time the clocks skip (2:30 on the spring-forward night) becomes the first minute after the gap.
            var local = startDay.ToDateTime(time.Value);
            if (context.Zone.IsInvalidTime(local))
            {
                while (context.Zone.IsInvalidTime(local))
                {
                    local = local.AddMinutes(1);
                }

                Add(unclear, "time");
            }

            startDay = DateOnly.FromDateTime(local);
            startTime = TimeOnly.FromDateTime(local);
            var begins = local;

            DateTime? ends = Time(output?.EndTime) is { } endClock
                ? (Date(output?.EndDate) ?? startDay).ToDateTime(endClock)
                : null;
            // "3 to 1" without a date means it runs past midnight.
            if (ends is { } e && e <= begins && output?.EndDate is null && e.AddDays(1) > begins)
            {
                ends = e.AddDays(1);
            }

            if (ends is not { } finish || finish <= begins || finish > begins.AddDays(7))
            {
                if (ends is not null)
                {
                    unclear.Add("end");
                }

                finish = begins.AddHours(1);
            }

            endDay = DateOnly.FromDateTime(finish);
            endTime = TimeOnly.FromDateTime(finish);
        }

        var recurrence = rule is null ? null : RepeatRules.Format(rule, allDay, context.Zone);

        var people = new List<Guid>();
        foreach (var alias in output?.People ?? [])
        {
            if (context.Members.FirstOrDefault(m => string.Equals(m.Alias, alias?.Trim(), StringComparison.OrdinalIgnoreCase)) is { } member)
            {
                if (!people.Contains(member.Id))
                {
                    people.Add(member.Id);
                }
            }
            else
            {
                Add(unclear, "people");
            }
        }

        var calendar = Calendar(people, context.Calendars);
        var others = people.Where(id => id != calendar?.MemberId).ToList();

        return new EventDraftResponse(
            calendar?.Id, title, location, allDay, startDay, startTime, endDay, endTime, recurrence, others, unclear);
    }

    /// <summary>
    /// The calendar of the one person named, when they have one that takes new events; otherwise the
    /// family's own (a calendar with no owner), otherwise the first that takes new events.
    /// </summary>
    public static DraftCalendar? Calendar(IReadOnlyList<Guid> people, IReadOnlyList<DraftCalendar> calendars)
    {
        var writable = calendars.Where(c => c.CanWrite).ToList();
        if (people.Count == 1 && writable.FirstOrDefault(c => c.MemberId == people[0]) is { } own)
        {
            return own;
        }

        return writable.FirstOrDefault(c => c.MemberId is null) ?? writable.FirstOrDefault();
    }

    private static void Add(List<string> unclear, string field)
    {
        if (!unclear.Contains(field))
        {
            unclear.Add(field);
        }
    }

    private static string? Trim(string? text, int max)
    {
        var trimmed = text?.ReplaceLineEndings(" ").Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed.Length <= max ? trimmed : trimmed[..max].TrimEnd();
    }

    private static DateOnly? Date(string? text) =>
        DateOnly.TryParseExact(text?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day) ? day : null;

    private static TimeOnly? Time(string? text) =>
        TimeOnly.TryParseExact(text?.Trim(), ["HH:mm", "H:mm", "HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var time) ? time : null;

    private static DayOfWeek? Weekday(string? text) =>
        Enum.TryParse<DayOfWeek>(text?.Trim(), ignoreCase: true, out var day) && Enum.IsDefined(day) && !int.TryParse(text, out _) ? day : null;
}
