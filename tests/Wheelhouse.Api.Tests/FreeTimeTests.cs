using Wheelhouse.Api.Ai;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Tests;

/// <summary>The free-time arithmetic Ask's answers rest on. No database, no model.</summary>
public sealed class FreeTimeTests
{
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    private static readonly Guid Clara = Guid.NewGuid();
    private static readonly Guid Milo = Guid.NewGuid();
    private static readonly Guid Nora = Guid.NewGuid();

    private static readonly HashSet<Guid> Everyone = [Clara, Milo, Nora];

    // Saturday, November 7, 2026.
    private static readonly DateOnly Saturday = new(2026, 11, 7);

    private static DateTimeOffset At(int hour, int minute = 0, DateOnly? day = null) =>
        CalendarEndpoints.At(day ?? Saturday, new TimeOnly(hour, minute), NewYork);

    private static BusyTime Busy(int fromHour, int fromMinute, int toHour, int toMinute, params Guid[] people) =>
        new(At(fromHour, fromMinute), At(toHour, toMinute), people);

    private static IReadOnlyList<FreeSlot> Find(IEnumerable<BusyTime> busy, HashSet<Guid>? people = null, int fromHour = 12, int toHour = 18, int minutes = 30) =>
        FreeTime.Find(busy, people ?? Everyone, At(fromHour), At(toHour), TimeSpan.FromMinutes(minutes));

    [Fact]
    public void The_gaps_between_everyone_s_events_are_free()
    {
        var free = Find([Busy(11, 0, 13, 30, Nora), Busy(16, 0, 17, 0, Milo)]);

        Assert.Equal([new FreeSlot(At(13, 30), At(16, 0)), new FreeSlot(At(17, 0), At(18, 0))], free);
    }

    [Fact]
    public void Overlapping_events_take_their_combined_time()
    {
        var free = Find([Busy(12, 0, 14, 0, Clara), Busy(13, 0, 15, 0, Milo), Busy(13, 30, 14, 0, Nora)]);

        Assert.Equal([new FreeSlot(At(15, 0), At(18, 0))], free);
    }

    [Fact]
    public void Only_the_people_asked_about_count()
    {
        var busy = new[] { Busy(12, 0, 15, 0, Milo), Busy(16, 0, 17, 0, Nora) };

        Assert.Equal([new FreeSlot(At(12, 0), At(16, 0)), new FreeSlot(At(17, 0), At(18, 0))], Find(busy, [Nora, Clara]));
        Assert.Equal([new FreeSlot(At(15, 0), At(16, 0)), new FreeSlot(At(17, 0), At(18, 0))], Find(busy));
    }

    [Fact]
    public void An_event_for_nobody_in_particular_takes_everyone()
    {
        Assert.Equal([new FreeSlot(At(14, 0), At(18, 0))], Find([Busy(12, 0, 14, 0)], [Clara]));
    }

    [Fact]
    public void A_gap_shorter_than_asked_is_not_free_time()
    {
        var free = Find([Busy(12, 0, 13, 0, Clara), Busy(13, 20, 18, 0, Clara)]);

        Assert.Empty(free);
        Assert.Single(Find([Busy(12, 0, 13, 0, Clara), Busy(13, 20, 18, 0, Clara)], minutes: 15));
    }

    [Fact]
    public void Events_outside_the_range_or_spilling_into_it_are_clipped()
    {
        var free = Find([Busy(9, 0, 12, 30, Clara), Busy(17, 30, 20, 0, Milo)]);

        Assert.Equal([new FreeSlot(At(12, 30), At(17, 30))], free);
        Assert.Equal([new FreeSlot(At(12, 0), At(18, 0))], Find([Busy(8, 0, 9, 0, Clara)]));
    }

    [Fact]
    public void A_day_that_springs_forward_is_an_hour_short()
    {
        var day = new DateOnly(2027, 3, 14);
        var free = FreeTime.Find([], Everyone, At(0, 0, day), CalendarEndpoints.StartOfDay(day.AddDays(1), NewYork), TimeSpan.FromMinutes(30));

        var slot = Assert.Single(free);
        Assert.Equal(TimeSpan.FromHours(23), slot.End - slot.Start);
    }
}
