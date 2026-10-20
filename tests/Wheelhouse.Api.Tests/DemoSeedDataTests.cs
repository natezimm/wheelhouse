using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;
using Wheelhouse.Api.Meals;

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
    public void Every_start_day_has_a_cohesive_independent_graph_with_today_and_tomorrow_meals(int offset)
    {
        // 00:15 household time: catches seeded morning timestamps in the future as well.
        var created = DateTimeOffset.Parse("2026-10-19T04:15:00Z").AddDays(offset);
        var anchor = new DemoDateAnchor(created, DemoSeedData.DefaultTimeZoneId);
        var id = Guid.NewGuid();
        var family = DemoFamily.Create(id, created + DemoCopies.Lifetime);
        Assert.Equal(id, family.Id);
        Assert.Equal(created + DemoCopies.Lifetime, family.ExpiresAt);
        Assert.Equal(["Clara", "Julian", "Milo", "Nora"], family.Members.Select(m => m.DisplayName));
        Assert.Equal([MemberRole.Parent, MemberRole.Parent, MemberRole.Kid, MemberRole.Kid], family.Members.Select(m => m.Role));
        Assert.Equal(6, family.Calendars.Count);
        Assert.False(family.Calendars.Single(c => c.Name == "Maplewood School District").CanWrite);
        Assert.Equal(["Breakfast", "Dinner", "Lunch"], family.Meals.Where(m => m.Date == anchor.Today).Select(m => m.Slot).Order());
        Assert.NotNull(family.Meals.Single(m => m.Date == anchor.Today.AddDays(1) && m.Slot == "Dinner").RecipeData);
        Assert.Equal(7, family.Meals.Count(m => m.Date >= anchor.StartOfWeek(anchor.Today)
            && m.Date < anchor.StartOfWeek(anchor.Today).AddDays(7) && m.Slot == "Dinner"));
        Assert.Contains(family.Meals, m => m.Date < anchor.StartOfWeek(anchor.Today) && m.RecipeData is not null
            && family.Recipes.Single(r => r.Id == RecipeJson.Read<RecipeSnapshot>(m.RecipeData).Id).Archived);
        Assert.Equal(5, family.Recipes.Count);
        Assert.All(family.Recipes, r => Assert.All(RecipeJson.Read<RecipeContent>(r.Content).Ingredients,
            i => Assert.True((i.Quantity is null) != (i.QuantityText is null))));

        var grocery = family.Lists.Single(l => l.IsGrocery);
        Assert.Equal(GroceryList.DefaultCategories, grocery.Categories.Select(c => c.Name));
        Assert.All(grocery.Categories, c => Assert.Contains(grocery.Items, i => i.CategoryId == c.Id));
        Assert.Contains(grocery.Items, i => i.Checked);
        var dinner = family.Meals.Single(m => m.Date == anchor.Today && m.Slot == "Dinner");
        var snapshot = RecipeJson.Read<RecipeSnapshot>(dinner.RecipeData!);
        var sources = grocery.Items.SelectMany(i => i.Contributions).ToArray();
        Assert.Equal(5, sources.Length);
        Assert.All(sources, source =>
        {
            Assert.Equal(GrocerySources.Key(dinner), source.SnapshotKey);
            var ingredient = snapshot.Content.Ingredients.Single(i => i.Id == source.IngredientId);
            var origin = RecipeJson.Read<GroceryOrigin>(source.SourceData);
            Assert.Equal(snapshot.Id, origin.RecipeId);
            Assert.Equal(snapshot.Version, origin.RecipeVersion);
            Assert.Equal(ingredient.Name, origin.IngredientName);
            Assert.Equal(ingredient.Quantity, origin.Quantity);
        });
        var receipt = RecipeJson.Read<GroceryBatchResponse>(Assert.Single(family.GroceryBatches).Result);
        Assert.Equal(5, receipt.IngredientCount);
        Assert.Equal(grocery.Items.Where(i => i.Contributions.Count > 0).Select(i => i.Id).Order(), receipt.ItemIds.Order());
        Assert.True(receipt.AddedAt <= created);

        var daily = family.Chores.Single(c => c.Title == "Brush teeth & make bed");
        Assert.True(ChoreOccurrences.Response(daily, anchor.Today.AddDays(-2), anchor.Today).Missed);
        Assert.NotNull(ChoreOccurrences.Response(daily, anchor.Today.AddDays(-1), anchor.Today).CompletedAt);
        Assert.Null(ChoreOccurrences.Response(daily, anchor.Today, anchor.Today).CompletedAt);
        Assert.Contains(family.Chores, c => c.Archived && c.CompletedAt is not null);
        Assert.All(family.Chores.SelectMany(c => c.Completions), c => Assert.True(c.CompletedAt <= created));
        var lunch = family.Chores.Single(c => c.Title == "Empty school lunch bag & ice pack").Plans.Single();
        Assert.Equal([1, 2, 3, 4, 5], lunch.Repeat().Weekdays!);
        var fortnight = family.Chores.Single(c => c.Title.Contains("Barnaby")).Plans.Single();
        var saturday = anchor.StartOfWeek(fortnight.StartsOn).AddDays(5);
        Assert.True(ChoreOccurrences.Scheduled(fortnight, saturday));
        Assert.False(ChoreOccurrences.Scheduled(fortnight, saturday.AddDays(7)));
        Assert.True(ChoreOccurrences.Scheduled(fortnight, saturday.AddDays(14)));

        IFamilyOwned[] owned = [..family.Members, ..family.Devices, ..family.Calendars,
            ..family.Calendars.SelectMany(c => c.Events), ..family.Chores,
            ..family.Chores.SelectMany(c => c.Plans), ..family.Chores.SelectMany(c => c.Completions),
            ..family.Recipes, ..family.Meals, ..family.Lists, ..family.Lists.SelectMany(l => l.Items),
            ..grocery.Categories, ..sources, ..family.GroceryBatches];
        Assert.All(owned, row => Assert.Equal(id, row.FamilyId));
        var other = DemoFamily.Create(Guid.NewGuid(), created + DemoCopies.Lifetime);
        Assert.Empty(family.Members.Select(m => m.Id).Intersect(other.Members.Select(m => m.Id)));
        Assert.Empty(family.Recipes.Select(r => r.Id).Intersect(other.Recipes.Select(r => r.Id)));
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
            Assert.InRange(DateOnly.FromDateTime(start.DateTime).DayNumber - seed.AnchorDate.DayNumber, -14, 42);
        });
        Assert.Equal(2, soccer.Select(e => TimeZoneInfo.ConvertTime(e.StartUtc!.Value, anchor.TimeZone).Offset).Distinct().Count());
        Assert.All(seed.Events.Where(e => e.IsAllDay), e =>
        {
            Assert.True(e.EndDateExclusive > e.StartDate);
            Assert.Null(e.StartUtc); Assert.Null(e.EndUtc);
        });
    }
}
