using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Tests;

/// <summary>The repeat rules a screen can set, read, written and expanded as Google expands them.</summary>
public sealed class RepeatRulesTests
{
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

    private static List<DateOnly> Days(string rule, DateOnly first, DateOnly through) =>
        [.. RepeatRules.Days(first, RepeatRules.Parse(rule, Zone)!, through)];

    [Theory]
    [InlineData("RRULE:FREQ=DAILY")]
    [InlineData("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR")]
    [InlineData("RRULE:FREQ=MONTHLY;BYDAY=2TU")]
    [InlineData("RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=6")]
    [InlineData("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1")]
    [InlineData("RRULE:FREQ=YEARLY;INTERVAL=3")]
    [InlineData("RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=4;UNTIL=20300101")]
    public void A_rule_a_screen_sets_is_written_back_as_it_was(string rule) =>
        Assert.Equal(rule, RepeatRules.Format(RepeatRules.Parse(rule, Zone)!, allDay: true, Zone));

    [Theory]
    [InlineData("RRULE:FREQ=HOURLY")]
    [InlineData("RRULE:FREQ=WEEKLY;BYSETPOS=1")]
    [InlineData("RRULE:FREQ=WEEKLY;INTERVAL=0")]
    [InlineData("RRULE:FREQ=WEEKLY;BYDAY=2TU")]
    [InlineData("RRULE:FREQ=MONTHLY;BYDAY=TU,TH")]
    [InlineData("RRULE:FREQ=MONTHLY;BYDAY=5TU")]
    [InlineData("RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15")]
    [InlineData("RRULE:FREQ=DAILY;COUNT=3;UNTIL=20270101")]
    [InlineData("RRULE:FREQ=DAILY;COUNT=1000")]
    [InlineData("RRULE:FREQ=YEARLY;BYMONTHDAY=4")]
    [InlineData("RRULE:FREQ=MONTHLY;BYMONTH=3;BYMONTHDAY=4")]
    [InlineData("FREQ=WEEKLY;WKST=SU")]
    public void A_rule_no_screen_offers_is_not_read(string rule) => Assert.Null(RepeatRules.Parse(rule, Zone));

    [Fact]
    public void A_timed_series_ends_at_the_end_of_the_familys_last_day()
    {
        var rule = RepeatRules.Parse("RRULE:FREQ=WEEKLY;UNTIL=20270115", Zone)!;

        Assert.Equal("RRULE:FREQ=WEEKLY;UNTIL=20270116T055959Z", RepeatRules.Format(rule, allDay: false, Zone));
        // Google's own instant is read back as that same day.
        Assert.Equal(new DateOnly(2027, 1, 15), RepeatRules.Parse("RRULE:FREQ=WEEKLY;UNTIL=20270116T055959Z", Zone)!.Until);
    }

    [Fact]
    public void Every_other_week_on_chosen_days_counts_from_the_first_events_week()
    {
        // Wednesday, January 6, 2027.
        Assert.Equal(
            [new(2027, 1, 6), new(2027, 1, 8), new(2027, 1, 18), new(2027, 1, 20), new(2027, 1, 22)],
            Days("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR", new(2027, 1, 6), new(2027, 1, 31)).Take(5).ToList());
    }

    [Fact]
    public void A_monthly_rule_repeats_on_a_weekdays_place_in_the_month_or_the_last_day()
    {
        Assert.Equal([new(2027, 1, 12), new(2027, 2, 9), new(2027, 3, 9)],
            Days("RRULE:FREQ=MONTHLY;BYDAY=2TU", new(2027, 1, 12), new(2027, 3, 31)));
        Assert.Equal([new(2027, 1, 29), new(2027, 2, 26), new(2027, 3, 26), new(2027, 4, 30)],
            Days("RRULE:FREQ=MONTHLY;BYDAY=-1FR", new(2027, 1, 29), new(2027, 4, 30)));
        Assert.Equal([new(2027, 1, 31), new(2027, 2, 28), new(2027, 3, 31)],
            Days("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1", new(2027, 1, 31), new(2027, 3, 31)));
    }

    [Fact]
    public void A_yearly_event_on_the_29th_of_february_waits_for_leap_years()
    {
        Assert.Equal([new(2028, 2, 29), new(2032, 2, 29)], Days("RRULE:FREQ=YEARLY", new(2028, 2, 29), new(2033, 1, 1)));
        Assert.Equal([new(2028, 2, 29), new(2032, 2, 29)], Days("RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", new(2028, 2, 29), new(2033, 1, 1)));
    }

    [Fact]
    public void A_count_includes_the_first_event_and_an_end_day_is_the_last_it_may_fall_on()
    {
        Assert.Equal([new(2027, 1, 4), new(2027, 1, 5), new(2027, 1, 6)], Days("RRULE:FREQ=DAILY;COUNT=3", new(2027, 1, 4), new(2027, 12, 31)));
        Assert.Equal([new(2027, 1, 4), new(2027, 1, 11)], Days("RRULE:FREQ=WEEKLY;UNTIL=20270117", new(2027, 1, 4), new(2027, 12, 31)));
        // The first event counts even when the chosen weekdays leave its own day out, as in Google.
        Assert.Equal([new(2027, 1, 4), new(2027, 1, 5)], Days("RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2", new(2027, 1, 4), new(2027, 12, 31)));
    }
}
