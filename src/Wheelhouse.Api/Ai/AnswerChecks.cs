using System.ComponentModel;
using System.Globalization;
using System.Text.RegularExpressions;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Ai;

/// <summary>What the model answers a question with: a kind, a sentence and the aliases it cites.</summary>
public sealed record AskAnswerOutput(
    [property: Description("free, events, none, outsideWindow, change or offTopic.")] string? Kind,
    [property: Description("One short sentence answering the question, with 12-hour times like \"1:30–4 pm\".")] string? Sentence,
    [property: Description("Aliases (e1, e2...) of the events the answer is about, and only those.")] IReadOnlyList<string>? Events,
    [property: Description("Aliases (s1, s2...) of the free times the answer gives.")] IReadOnlyList<string>? Slots);

/// <summary>A free time on the answer card, for <paramref name="MemberIds"/> (none for everyone).</summary>
public sealed record AskSlot(DateTimeOffset Start, DateTimeOffset End, IReadOnlyList<Guid> MemberIds);

/// <summary>
/// The answer card. <paramref name="Kind"/> is one of <see cref="AskKinds"/>; the slots and events come
/// from the server's own data, never the model's text. <paramref name="ChangeNumber"/> is the calendar's
/// when the question was asked, so a screen can say the answer is out of date. <paramref name="NotCached"/>
/// names events search found beyond the sync window, which details show without Edit or Delete.
/// </summary>
public sealed record AskResponse(
    string Kind,
    string Sentence,
    IReadOnlyList<AskSlot> Slots,
    IReadOnlyList<EventResponse> Events,
    long ChangeNumber,
    DateOnly? SyncedFrom,
    DateOnly? SyncedTo,
    IReadOnlyList<Guid> NotCached);

public sealed record AskRequest(string? Question);

public static class AskKinds
{
    public const string Free = "free";
    public const string Events = "events";
    public const string None = "none";
    public const string OutsideWindow = "outsideWindow";
    public const string OffTopic = "offTopic";
    public const string Unknown = "unknown";
}

/// <summary>
/// Holds the model's answer to what the tools really showed it. An answer citing an event or a free
/// time no tool returned is not trusted at all. A sentence naming a time, weekday or date that none of
/// what it cites (or, when nothing was found, none of the days asked about) has is replaced by one
/// written here from the same data, so a wrong sentence costs wording, never correctness.
/// </summary>
public static class AnswerChecks
{
    public const int MaxSentence = 300;

    public const string OffTopicSentence = "I can only answer questions about your calendar.";

    public const string ChangeSentence = "I can't change the calendar. Add event opens the editor.";

    public const string UnknownSentence = "I couldn't answer that from the calendar.";

    public const string NoneSentence = "Nothing on the calendar for that.";

    public static AskResponse Check(AskAnswerOutput? output, CalendarTools tools, AskContext context)
    {
        var kind = output?.Kind?.Trim();
        switch (kind)
        {
            case "offTopic":
                return Answer(context, AskKinds.OffTopic, OffTopicSentence);
            case "change":
                return Answer(context, AskKinds.OffTopic, ChangeSentence);
            case "outsideWindow":
                return Answer(context, AskKinds.OutsideWindow, OutsideSentence(context));
            case "free" or "events" or "none":
                break;
            default:
                return Answer(context, AskKinds.Unknown, UnknownSentence);
        }

        var cited = new List<ShownEvent>();
        foreach (var alias in (output!.Events ?? []).Select(a => a?.Trim() ?? "").Distinct())
        {
            if (!tools.Events.TryGetValue(alias, out var shown))
            {
                return Answer(context, AskKinds.Unknown, UnknownSentence);
            }

            cited.Add(shown);
        }

        var slots = new List<ShownSlot>();
        foreach (var alias in (output.Slots ?? []).Select(a => a?.Trim() ?? "").Distinct())
        {
            if (!tools.Slots.TryGetValue(alias, out var slot))
            {
                return Answer(context, AskKinds.Unknown, UnknownSentence);
            }

            slots.Add(slot);
        }

        if (kind == "free" && slots.Count == 0)
        {
            return Answer(context, AskKinds.Unknown, UnknownSentence);
        }

        if (kind == "events" && cited.Count == 0)
        {
            kind = "none";
        }

        if (kind == "none")
        {
            // Nothing was found, so there is nothing to cite, and the sentence may name only the days asked about.
            cited.Clear();
            slots.Clear();
        }

        cited = [.. cited.OrderBy(e => e.Start).ThenBy(e => e.Event.AllDay ? 0 : 1)];
        slots = [.. slots.OrderBy(s => s.Slot.Start)];
        var sentence = Fits(output.Sentence, cited, slots, tools, context)
            ? OneLine(output.Sentence!)
            : Template(kind, cited, slots, context);

        return new AskResponse(
            kind,
            sentence,
            [.. slots.Select(s => new AskSlot(s.Slot.Start, s.Slot.End, s.People))],
            [.. cited.Select(e => e.Event)],
            context.ChangeNumber,
            context.SyncedFrom,
            context.SyncedTo,
            [.. cited.Where(e => e.NotCached).Select(e => e.Event.Id)]);
    }

    private static AskResponse Answer(AskContext context, string kind, string sentence) =>
        new(kind, sentence, [], [], context.ChangeNumber, context.SyncedFrom, context.SyncedTo, []);

    public static string OutsideSentence(AskContext context) =>
        context.SyncedTo is { } to
            ? string.Create(CultureInfo.InvariantCulture, $"That's past what's synced (through {to.AddDays(-1):MMM d}).")
            : "That's further than the calendar reaches.";

    /// <summary>
    /// Whether every time, weekday and date the sentence names belongs to something it cites, or, with
    /// nothing cited, to the days and times the tools were asked about.
    /// </summary>
    public static bool Fits(string? sentence, IReadOnlyList<ShownEvent> cited, IReadOnlyList<ShownSlot> slots, CalendarTools tools, AskContext context)
    {
        if (string.IsNullOrWhiteSpace(sentence) || sentence.Length > MaxSentence)
        {
            return false;
        }

        var spans = cited.Select(e => (e.Start, e.End, e.Event.AllDay))
            .Concat(slots.Select(s => (s.Slot.Start, s.Slot.End, AllDay: false)))
            .ToList();

        var days = new HashSet<DateOnly>();
        var times = new HashSet<(int Hour, int Minute)>();
        foreach (var (start, end, allDay) in spans)
        {
            var localStart = TimeZoneInfo.ConvertTime(start, context.Zone).DateTime;
            var localEnd = TimeZoneInfo.ConvertTime(end, context.Zone).DateTime;
            var last = DateOnly.FromDateTime(allDay || localEnd.TimeOfDay == TimeSpan.Zero ? localEnd.AddDays(-1) : localEnd);
            for (var day = DateOnly.FromDateTime(localStart); day <= last; day = day.AddDays(1))
            {
                days.Add(day);
            }

            if (!allDay)
            {
                times.Add(Twelve(localStart.Hour, localStart.Minute));
                times.Add(Twelve(localEnd.Hour, localEnd.Minute));
            }
        }

        if (spans.Count == 0)
        {
            days.UnionWith(tools.AskedDays);
            times.UnionWith(tools.AskedTimes.Select(t => Twelve(t.Hour, t.Minute)));
        }

        // "Today" and "tomorrow" name days too.
        if (TodayWordPattern.IsMatch(sentence) && !days.Contains(context.Today))
        {
            return false;
        }

        if (TomorrowWordPattern.IsMatch(sentence) && !days.Contains(context.Today.AddDays(1)))
        {
            return false;
        }

        foreach (Match match in ClockTimePattern.Matches(sentence))
        {
            var hour = int.Parse(match.Groups["h"].Value, CultureInfo.InvariantCulture);
            var minute = match.Groups["m"].Success ? int.Parse(match.Groups["m"].Value, CultureInfo.InvariantCulture) : 0;
            if (hour > 23 || !times.Contains(Twelve(hour, minute)))
            {
                return false;
            }
        }

        if (NoonPattern.IsMatch(sentence) && !times.Contains(Twelve(12, 0)))
        {
            return false;
        }

        if (MidnightPattern.IsMatch(sentence) && !times.Contains(Twelve(0, 0)))
        {
            return false;
        }

        foreach (Match match in WeekdayPattern.Matches(sentence))
        {
            var weekday = Enum.Parse<DayOfWeek>(match.Value, ignoreCase: true);
            if (!days.Any(d => d.DayOfWeek == weekday))
            {
                return false;
            }
        }

        foreach (Match match in MonthDayPattern.Matches(sentence))
        {
            var month = Array.FindIndex(Months, m => match.Groups["month"].Value.StartsWith(m, StringComparison.OrdinalIgnoreCase)) + 1;
            var day = int.Parse(match.Groups["day"].Value, CultureInfo.InvariantCulture);
            if (!days.Any(d => d.Month == month && d.Day == day))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>The sentence written here from the answer's own data, for when the model's cannot be trusted.</summary>
    public static string Template(string kind, IReadOnlyList<ShownEvent> cited, IReadOnlyList<ShownSlot> slots, AskContext context)
    {
        switch (kind)
        {
            case "free":
                var people = slots[0].People;
                var who = people.Count == 0 || people.Count == context.Members.Count
                    ? "Everyone is"
                    : Names(context.Members.Where(m => people.Contains(m.Id)).Select(m => m.Name).ToList()) + (people.Count == 1 ? " is" : " are");
                var shown = slots.Take(3).Select(s => $"{Range(s.Slot.Start, s.Slot.End, context.Zone)} on {Day(s.Slot.Start, context.Zone)}").ToList();
                return $"{who} free {Names(shown)}.";
            case "events":
                var first = cited[0];
                var when = first.Event.AllDay
                    ? $"on {Day(first.Start, context.Zone)}"
                    : $"on {Day(first.Start, context.Zone)} at {Clock(first.Start, context.Zone)}";
                var title = OneLine(first.Event.Title);
                return cited.Count == 1
                    ? $"{title} is {when}."
                    : $"{cited.Count} events, starting with {title} {when}.";
            default:
                return NoneSentence;
        }
    }

    private static string Names(IReadOnlyList<string> names) => names.Count switch
    {
        0 => "",
        1 => names[0],
        _ => string.Join(", ", names.Take(names.Count - 1)) + " and " + names[^1],
    };

    /// <summary>"Saturday, Nov 7".</summary>
    private static string Day(DateTimeOffset instant, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(instant, zone).ToString("dddd, MMM d", CultureInfo.InvariantCulture);

    /// <summary>"4 pm", "1:30 pm".</summary>
    public static string Clock(DateTimeOffset instant, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTime(instant, zone);
        return $"{Hour(local)} {(local.Hour < 12 ? "am" : "pm")}";
    }

    /// <summary>"1:30–4 pm", "11:30 am–1 pm".</summary>
    public static string Range(DateTimeOffset start, DateTimeOffset end, TimeZoneInfo zone)
    {
        var from = TimeZoneInfo.ConvertTime(start, zone);
        var to = TimeZoneInfo.ConvertTime(end, zone);
        return (from.Hour < 12) == (to.Hour < 12) && to.Date == from.Date
            ? $"{Hour(from)}–{Clock(end, zone)}"
            : $"{Clock(start, zone)}–{Clock(end, zone)}";
    }

    private static string Hour(DateTimeOffset local)
    {
        var hour = local.Hour % 12 == 0 ? 12 : local.Hour % 12;
        return local.Minute == 0
            ? hour.ToString(CultureInfo.InvariantCulture)
            : string.Create(CultureInfo.InvariantCulture, $"{hour}:{local.Minute:00}");
    }

    private static (int, int) Twelve(int hour, int minute) => (hour % 12, minute);

    private static string OneLine(string text) => text.ReplaceLineEndings(" ").Trim();

    private static readonly string[] Months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

    /// <summary>A clock time: "1:30", "13:30", "4 pm", "4pm", "4 p.m.". A bare number is not one.</summary>
    private static readonly Regex ClockTimePattern = new(@"\b(?<h>\d{1,2})(?::(?<m>[0-5]\d)\s*(?:[ap]\.?m\b\.?)?|\s*(?:[ap]\.?m\b\.?))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex NoonPattern = new(@"\bnoon\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex MidnightPattern = new(@"\bmidnight\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex TodayWordPattern = new(@"\btoday\b|\btonight\b|\bthis (?:morning|afternoon|evening)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex TomorrowWordPattern = new(@"\btomorrow\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex WeekdayPattern = new(@"\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex MonthDayPattern = new(@"\b(?<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?<day>\d{1,2})\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
}
