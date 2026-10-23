using Wheelhouse.Api.Data;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

public sealed class DemoSeedDataTests
{
    [Theory]
    [InlineData("2026-03-08T04:30:00Z", "2026-03-07")]
    [InlineData("2026-03-08T07:30:00Z", "2026-03-08")]
    [InlineData("2026-11-01T05:30:00Z", "2026-11-01")]
    [InlineData("2026-11-01T06:30:00Z", "2026-11-01")]
    public void Anchor_uses_the_household_date_not_the_UTC_date(string instant, string expected)
    {
        var anchor = new DemoDateAnchor(DateTimeOffset.Parse(instant), DemoSeedData.DefaultTimeZoneId);
        Assert.Equal(DateOnly.Parse(expected), anchor.Today);
        Assert.Equal(DayOfWeek.Monday, anchor.StartOfWeek(anchor.Today).DayOfWeek);
        Assert.InRange(anchor.NextWeekday(anchor.Today.DayOfWeek).DayNumber - anchor.Today.DayNumber, 1, 7);
    }

    [Fact]
    public void Local_times_shift_across_the_spring_gap_and_choose_standard_time_in_the_fall_overlap()
    {
        var anchor = new DemoDateAnchor(DateTimeOffset.Parse("2026-01-01T12:00:00Z"), DemoSeedData.DefaultTimeZoneId);
        Assert.Equal(DateTimeOffset.Parse("2026-03-08T07:30:00Z"), anchor.AtLocalTime(new(2026, 3, 8), 2, 30));
        Assert.Equal(DateTimeOffset.Parse("2026-11-01T06:30:00Z"), anchor.AtLocalTime(new(2026, 11, 1), 1, 30));
    }

    [Theory]
    [InlineData(0)] [InlineData(1)] [InlineData(2)] [InlineData(3)]
    [InlineData(4)] [InlineData(5)] [InlineData(6)]
    public void Every_start_day_has_independent_calendar_events_only(int offset)
    {
        var created = DateTimeOffset.Parse("2026-10-19T04:15:00Z").AddDays(offset);
        var id = Guid.NewGuid();
        var family = DemoFamily.Create(id, created + DemoCopies.Lifetime);

        Assert.Equal(id, family.Id);
        Assert.Equal(created + DemoCopies.Lifetime, family.ExpiresAt);
        Assert.Equal(["Clara", "Julian", "Milo", "Nora"], family.Members.Select(m => m.DisplayName));
        Assert.Equal([MemberRole.Parent, MemberRole.Parent, MemberRole.Kid, MemberRole.Kid], family.Members.Select(m => m.Role));
        Assert.Equal(6, family.Calendars.Count);
        Assert.False(family.Calendars.Single(c => c.Name == "Maplewood School District").CanWrite);
        Assert.Contains(family.Calendars.SelectMany(c => c.Events), e => e.Title == "Product architecture sync");

        // Legacy tables remain, but the demo creates no deferred household records.
        Assert.Empty(family.Chores);
        Assert.Empty(family.Lists);
        Assert.Empty(family.Meals);
        Assert.Empty(family.Recipes);
        Assert.Empty(family.GroceryBatches);

        IFamilyOwned[] owned = [..family.Members, ..family.Devices, ..family.Calendars,
            ..family.Calendars.SelectMany(c => c.Events)];
        Assert.All(owned, row => Assert.Equal(id, row.FamilyId));
        var other = DemoFamily.Create(Guid.NewGuid(), created + DemoCopies.Lifetime);
        Assert.Empty(family.Members.Select(m => m.Id).Intersect(other.Members.Select(m => m.Id)));
    }

    [Theory]
    [InlineData("2026-03-01T12:00:00Z")]
    [InlineData("2026-10-26T12:00:00Z")]
    public void Expanded_series_keep_local_times_through_DST_and_all_day_ends_stay_exclusive(string instant)
    {
        var now = DateTimeOffset.Parse(instant);
        var seed = DemoSeedData.Build(now);
        var anchor = new DemoDateAnchor(now, seed.Family.TimeZoneId);
        var soccer = seed.Events.Where(e => e.Title == "Soccer practice").ToArray();
        Assert.Single(soccer.Select(e => e.SeriesId).Distinct());
        Assert.All(soccer, e =>
        {
            var start = TimeZoneInfo.ConvertTime(e.StartUtc!.Value, anchor.TimeZone);
            Assert.Contains(start.DayOfWeek, new[] { DayOfWeek.Tuesday, DayOfWeek.Thursday });
            Assert.Equal(new TimeOnly(17, 15), TimeOnly.FromDateTime(start.DateTime));
            Assert.Equal(TimeSpan.FromMinutes(75), e.EndUtc - e.StartUtc);
            Assert.InRange(DateOnly.FromDateTime(start.DateTime).DayNumber - seed.AnchorDate.DayNumber, -42, 42);
        });
        Assert.Equal(2, soccer.Select(e => TimeZoneInfo.ConvertTime(e.StartUtc!.Value, anchor.TimeZone).Offset).Distinct().Count());
        Assert.All(seed.Events.Where(e => e.IsAllDay), e =>
        {
            Assert.True(e.EndDateExclusive > e.StartDate);
            Assert.Null(e.StartUtc); Assert.Null(e.EndUtc);
        });
    }
}
