using System.Globalization;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// The repeat rules the screens offer, as RFC 5545 reads them. <paramref name="Days"/> are the
/// weekdays of a weekly rule; a monthly rule repeats on <paramref name="MonthDay"/> (-1 for the
/// last day) or on the <paramref name="Position"/>th <paramref name="Weekday"/> (-1 for the last),
/// and a yearly one on <paramref name="MonthDay"/> of <paramref name="Month"/>; otherwise either
/// repeats on its first event's date. A rule ends after <paramref name="Count"/> events, the
/// first included, or on <paramref name="Until"/>, a day in the family's zone, or never.
/// </summary>
public sealed record RepeatRule(
    string Frequency,
    int Interval,
    IReadOnlyList<DayOfWeek> Days,
    int? MonthDay,
    int? Position,
    DayOfWeek? Weekday,
    int? Month,
    int? Count,
    DateOnly? Until);

/// <summary>
/// Reading, writing and expanding repeat rules. Only the part of RFC 5545 a screen can set is
/// understood: every N days, weeks on chosen weekdays, months on a date or a weekday's place in the
/// month, or years, ending never, on a day or after a number of events. Google expands a series
/// from its first event, which always counts as an occurrence, and so does <see cref="Days"/>.
/// </summary>
public static class RepeatRules
{
    public const int MaxInterval = 99;

    public const int MaxCount = 999;

    private static readonly string[] Frequencies = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

    private static readonly string[] WeekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

    /// <summary>
    /// The rule a text such as <c>RRULE:FREQ=WEEKLY;BYDAY=TU,TH</c> holds, or null when it is not
    /// one the screens offer. An <c>UNTIL</c> given as an instant is read as the family's day it falls on.
    /// </summary>
    public static RepeatRule? Parse(string? text, TimeZoneInfo zone)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var body = text.Trim();
        if (body.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase))
        {
            body = body[6..];
        }

        var parts = new Dictionary<string, string>();
        foreach (var part in body.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            if (pair.Length != 2 || !parts.TryAdd(pair[0].Trim().ToUpperInvariant(), pair[1].Trim().ToUpperInvariant()))
            {
                return null;
            }
        }

        if (!parts.TryGetValue("FREQ", out var frequency) || !Frequencies.Contains(frequency)
            || parts.Keys.Any(key => key is not ("FREQ" or "INTERVAL" or "BYDAY" or "BYMONTH" or "BYMONTHDAY" or "COUNT" or "UNTIL" or "WKST"))
            || (parts.TryGetValue("WKST", out var weekStart) && weekStart != "MO"))
        {
            return null;
        }

        var interval = 1;
        if (parts.TryGetValue("INTERVAL", out var intervalText) && (!int.TryParse(intervalText, NumberStyles.None, CultureInfo.InvariantCulture, out interval)
            || interval is < 1 or > MaxInterval))
        {
            return null;
        }

        List<DayOfWeek> days = [];
        int? monthDay = null, position = null;
        DayOfWeek? weekday = null;
        if (parts.TryGetValue("BYDAY", out var byDay))
        {
            var codes = byDay.Split(',');
            if (frequency == "WEEKLY")
            {
                foreach (var code in codes)
                {
                    var index = Array.IndexOf(WeekdayCodes, code);
                    if (index < 0 || days.Contains((DayOfWeek)index))
                    {
                        return null;
                    }

                    days.Add((DayOfWeek)index);
                }
            }
            else if (frequency == "MONTHLY" && codes.Length == 1 && codes[0].Length >= 3
                && int.TryParse(codes[0][..^2], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var n) && n is >= 1 and <= 4 or -1
                && Array.IndexOf(WeekdayCodes, codes[0][^2..]) is var found and >= 0)
            {
                position = n;
                weekday = (DayOfWeek)found;
            }
            else
            {
                return null;
            }
        }

        if (parts.TryGetValue("BYMONTHDAY", out var byMonthDay))
        {
            if (frequency is not ("MONTHLY" or "YEARLY") || position is not null
                || !int.TryParse(byMonthDay, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var day) || day is not (>= 1 and <= 31 or -1))
            {
                return null;
            }

            monthDay = day;
        }

        // A yearly rule names its month and date together, or neither.
        int? month = null;
        if (parts.TryGetValue("BYMONTH", out var byMonth))
        {
            if (frequency != "YEARLY" || monthDay is not (>= 1 and <= 31)
                || !int.TryParse(byMonth, NumberStyles.None, CultureInfo.InvariantCulture, out var m) || m is < 1 or > 12)
            {
                return null;
            }

            month = m;
        }
        else if (frequency == "YEARLY" && monthDay is not null)
        {
            return null;
        }

        int? count = null;
        if (parts.TryGetValue("COUNT", out var countText))
        {
            if (!int.TryParse(countText, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n is < 1 or > MaxCount)
            {
                return null;
            }

            count = n;
        }

        DateOnly? until = null;
        if (parts.TryGetValue("UNTIL", out var untilText))
        {
            if (count is not null || UntilDay(untilText, zone) is not { } day)
            {
                return null;
            }

            until = day;
        }

        return new RepeatRule(frequency, interval, days, monthDay, position, weekday, month, count, until);
    }

    /// <summary>
    /// The rule as Google is given it. Google wants the end of a timed series as an instant, so it is
    /// the end of the family's last day; an all-day series ends on a date.
    /// </summary>
    public static string Format(RepeatRule rule, bool allDay, TimeZoneInfo zone)
    {
        var text = $"RRULE:FREQ={rule.Frequency}";
        if (rule.Interval > 1)
        {
            text += $";INTERVAL={rule.Interval}";
        }

        if (rule.Frequency == "WEEKLY" && rule.Days.Count > 0)
        {
            text += ";BYDAY=" + string.Join(',', rule.Days.OrderBy(d => ((int)d + 6) % 7).Select(d => WeekdayCodes[(int)d]));
        }

        if (rule.Position is { } position)
        {
            text += $";BYDAY={position}{WeekdayCodes[(int)rule.Weekday!]}";
        }

        if (rule.Month is { } month)
        {
            text += $";BYMONTH={month}";
        }

        if (rule.MonthDay is { } monthDay)
        {
            text += $";BYMONTHDAY={monthDay}";
        }

        if (rule.Count is { } count)
        {
            text += $";COUNT={count}";
        }
        else if (rule.Until is { } until)
        {
            text += allDay
                ? $";UNTIL={until:yyyyMMdd}"
                : $";UNTIL={CalendarEndpoints.At(until, new TimeOnly(23, 59, 59), zone).UtcDateTime:yyyyMMdd'T'HHmmss'Z'}";
        }

        return text;
    }

    /// <summary>
    /// The days a series starting on <paramref name="first"/> falls on, up to and including
    /// <paramref name="through"/>. The first event is always one, however far ahead.
    /// </summary>
    public static IEnumerable<DateOnly> Days(DateOnly first, RepeatRule rule, DateOnly through)
    {
        yield return first;
        var last = rule.Until is { } until && until < through ? until : through;
        var count = 1;
        foreach (var day in Candidates(first, rule))
        {
            if (rule.Count is { } most && count >= most)
            {
                yield break;
            }

            if (day <= first)
            {
                continue;
            }

            if (day > last)
            {
                yield break;
            }

            count++;
            yield return day;
        }
    }

    /// <summary>The days the rule names, in order, from the period of <paramref name="first"/> on.</summary>
    private static IEnumerable<DateOnly> Candidates(DateOnly first, RepeatRule rule)
    {
        switch (rule.Frequency)
        {
            case "DAILY":
                for (var k = 0; ; k++)
                {
                    yield return first.AddDays(k * rule.Interval);
                }

            case "WEEKLY":
                var monday = first.AddDays(-(((int)first.DayOfWeek + 6) % 7));
                var offsets = (rule.Days.Count > 0 ? rule.Days : [first.DayOfWeek]).Select(d => ((int)d + 6) % 7).Order().ToList();
                for (var k = 0; ; k++)
                {
                    foreach (var offset in offsets)
                    {
                        yield return monday.AddDays(7 * k * rule.Interval + offset);
                    }
                }

            case "MONTHLY":
                var month = new DateOnly(first.Year, first.Month, 1);
                for (var k = 0; ; k++)
                {
                    var start = month.AddMonths(k * rule.Interval);
                    var length = DateTime.DaysInMonth(start.Year, start.Month);
                    if (rule.Position is { } position)
                    {
                        var firstOfKind = start.AddDays(((int)rule.Weekday! - (int)start.DayOfWeek + 7) % 7);
                        var day = position == -1
                            ? firstOfKind.AddDays(7 * ((length - firstOfKind.Day) / 7))
                            : firstOfKind.AddDays(7 * (position - 1));
                        yield return day;
                    }
                    else
                    {
                        var date = rule.MonthDay ?? first.Day;
                        if (date == -1)
                        {
                            yield return start.AddDays(length - 1);
                        }
                        else if (date <= length)
                        {
                            yield return start.AddDays(date - 1);
                        }
                    }
                }

            default:
                var (inMonth, onDay) = (rule.Month ?? first.Month, rule.MonthDay ?? first.Day);
                for (var k = 0; ; k++)
                {
                    var year = first.Year + k * rule.Interval;
                    if (onDay <= DateTime.DaysInMonth(year, inMonth))
                    {
                        yield return new DateOnly(year, inMonth, onDay);
                    }
                }
        }
    }

    private static DateOnly? UntilDay(string text, TimeZoneInfo zone)
    {
        if (DateOnly.TryParseExact(text, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return date;
        }

        if (DateTime.TryParseExact(text, "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var instant))
        {
            return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(instant, zone));
        }

        return DateTime.TryParseExact(text, "yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var local)
            ? DateOnly.FromDateTime(local)
            : null;
    }
}
