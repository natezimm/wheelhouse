using Wheelhouse.Api.Demo;

namespace Wheelhouse.Api.Tests;

public sealed class NightlyScheduleTests
{
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
    private static readonly TimeOnly HalfPastThree = new(3, 30);

    [Theory]
    // 1:00 AM local, before tonight's run: 3:30 AM the same day (UTC-4 in October).
    [InlineData("2026-10-13T05:00:00Z", "2026-10-13T07:30:00Z")]
    // 8:00 AM local, after it: tomorrow.
    [InlineData("2026-10-13T12:00:00Z", "2026-10-14T07:30:00Z")]
    // Exactly at the run time: the next one is tomorrow, not now.
    [InlineData("2026-10-13T07:30:00Z", "2026-10-14T07:30:00Z")]
    // The day clocks fall back: the next 3:30 AM is in standard time (UTC-5).
    [InlineData("2026-11-01T12:00:00Z", "2026-11-02T08:30:00Z")]
    public void Next_run_is_the_next_time_the_local_clock_reads_the_run_time(string now, string expected)
    {
        var next = NightlySchedule.NextRun(DateTimeOffset.Parse(now), NewYork, HalfPastThree);

        Assert.Equal(DateTimeOffset.Parse(expected), next);
    }

    [Fact]
    public void A_run_time_inside_the_spring_forward_gap_runs_right_after_it()
    {
        // On 2026-03-08 in New York, 2:00 AM jumps to 3:00 AM, so 2:30 AM never happens.
        var midnight = DateTimeOffset.Parse("2026-03-08T05:00:00Z");

        var next = NightlySchedule.NextRun(midnight, NewYork, new TimeOnly(2, 30));

        Assert.Equal(DateTimeOffset.Parse("2026-03-08T07:00:00Z"), next);
    }
}
