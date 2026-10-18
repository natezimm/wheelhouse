using Wheelhouse.Api.Chores;

namespace Wheelhouse.Api.Tests;

public sealed class ChoreScheduleTests
{
    [Theory]
    [InlineData("2026-03-08T04:59:00Z", "2026-03-07")]
    [InlineData("2026-03-08T05:00:00Z", "2026-03-08")]
    [InlineData("2026-03-08T06:59:00Z", "2026-03-08")]
    [InlineData("2026-03-08T07:01:00Z", "2026-03-08")]
    [InlineData("2026-11-01T05:30:00Z", "2026-11-01")]
    [InlineData("2026-11-01T06:30:00Z", "2026-11-01")]
    public void Household_dates_are_stable_through_midnight_and_both_DST_transitions(string instant, string day) =>
        Assert.Equal(DateOnly.Parse(day), ChoreOccurrences.Today("America/New_York", DateTimeOffset.Parse(instant)));

    [Theory]
    [InlineData("2026-10-19", true)]
    [InlineData("2026-10-21", true)]
    [InlineData("2026-10-20", false)]
    [InlineData("2026-10-26", false)]
    [InlineData("2026-11-02", true)]
    [InlineData("2026-11-04", true)]
    [InlineData("2026-11-16", false)]
    public void Every_two_weeks_uses_selected_days_and_an_inclusive_end_date(string day, bool expected)
    {
        var plan = new ChorePlan { FamilyId = Guid.NewGuid(), ChoreId = Guid.NewGuid(), Title = "Bins", Frequency = "Weekly",
            StartsOn = new(2026, 10, 19), EffectiveFrom = new(2026, 10, 19), EndsOn = new(2026, 11, 4),
            IntervalWeeks = 2, WeekdaysMask = (1 << 1) | (1 << 3) };
        Assert.Equal(expected, ChoreOccurrences.Scheduled(plan, DateOnly.Parse(day)));
    }

    [Fact]
    public void A_weekly_anchor_midweek_does_not_include_an_earlier_selected_day()
    {
        var plan = new ChorePlan { Title = "Work", Frequency = "Weekly", StartsOn = new(2026, 10, 21),
            EffectiveFrom = new(2026, 10, 21), IntervalWeeks = 2, WeekdaysMask = (1 << 1) | (1 << 3) };
        Assert.False(ChoreOccurrences.Scheduled(plan, new(2026, 10, 19)));
        Assert.True(ChoreOccurrences.Scheduled(plan, new(2026, 10, 21)));
        Assert.False(ChoreOccurrences.Scheduled(plan, new(2026, 10, 26)));
        Assert.True(ChoreOccurrences.Scheduled(plan, new(2026, 11, 2)));
    }
}
