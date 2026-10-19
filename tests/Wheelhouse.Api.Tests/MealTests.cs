using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Meals;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class MealTests(ApiFactory factory)
{
    private static readonly DateOnly Day = new(2030, 1, 7);
    private static async Task<MealsResponse> Read(HttpClient client, DateOnly? from = null, int days = 7)
    {
        var start = from ?? Day;
        return (await client.GetFromJsonAsync<MealsResponse>($"/api/meals?from={start:yyyy-MM-dd}&to={start.AddDays(days):yyyy-MM-dd}"))!;
    }
    private static async Task<MealResponse> Save(HttpClient client, DateOnly date, string slot, string? title, Guid? version = null, string? notes = null)
    {
        var response = await client.PutAsJsonAsync($"/api/meals/{date:yyyy-MM-dd}/{slot}", new SaveMeal(Guid.NewGuid(), version, title, notes));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<MealsResponse>())!.Meals.Single(m => m.Date == date && m.Slot == slot);
    }
    private static async Task<FamilyResponse> Family(HttpClient client) => (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    [Fact]
    public async Task Empty_reads_do_not_materialize_slots_and_same_slot_edits_cannot_silently_overwrite()
    {
        using var client = await factory.DemoVisitorAsync(); var family = await Family(client);
        await using var db = factory.DbContextFor(family.Id);
        var count = await db.MealSlots.CountAsync(); var initial = await Read(client);
        Assert.Equal(21, initial.Meals.Length); Assert.All(initial.Meals, m => Assert.Null(m.Title));
        Assert.Equal(count, await db.MealSlots.CountAsync()); Assert.Equal(initial.ChangeNumber, (await Read(client)).ChangeNumber);
        var first = await Save(client, Day, "Dinner", "  Pasta  ", notes:"  With vegetables  ");
        Assert.Equal("Pasta", first.Title); Assert.Equal("With vegetables", first.Notes);
        var competing = await Task.WhenAll(new[] { "Soup", "Tacos" }.Select(title =>
            client.PutAsJsonAsync($"/api/meals/{Day:yyyy-MM-dd}/Dinner", new SaveMeal(Guid.NewGuid(), first.Version, title, null))));
        Assert.Single(competing, r => r.IsSuccessStatusCode); Assert.Single(competing, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(initial.ChangeNumber + 2, (await Read(client)).ChangeNumber);
        Assert.Equal(count + 1, await db.MealSlots.CountAsync());
    }

    [Fact]
    public async Task Receipted_retries_never_reapply_old_intent_and_clear_retains_an_ABA_guard()
    {
        using var client = await factory.DemoVisitorAsync(); var initial = await Read(client);
        var request = new SaveMeal(Guid.NewGuid(), null, "Pasta", null); var url = $"/api/meals/{Day:yyyy-MM-dd}/Dinner";
        var replies = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => client.PutAsJsonAsync(url, request)));
        Assert.All(replies, r => Assert.True(r.IsSuccessStatusCode));
        Assert.Equal(initial.ChangeNumber + 1, (await Read(client)).ChangeNumber);
        var first = (await Read(client)).Meals.Single(m => m.Date == Day && m.Slot == "Dinner");
        var cleared = await Save(client, Day, "Dinner", null, first.Version); Assert.Null(cleared.Title); Assert.NotNull(cleared.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync(url, new SaveMeal(Guid.NewGuid(), null, "Stale empty editor", null))).StatusCode);
        var newer = await Save(client, Day, "Dinner", "Newer meal", cleared.Version);
        var revision = (await Read(client)).ChangeNumber;
        (await client.PutAsJsonAsync(url, request)).EnsureSuccessStatusCode();
        Assert.Equal(revision, (await Read(client)).ChangeNumber);
        Assert.Equal("Newer meal", (await Read(client)).Meals.Single(m => m.Date == Day && m.Slot == "Dinner").Title);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync(url, request with { Title = "Reused ID" })).StatusCode);
        await Save(client, Day, "Dinner", newer.Title, newer.Version);
        Assert.Equal(revision, (await Read(client)).ChangeNumber);
    }

    [Fact]
    public async Task Copy_is_reviewed_atomic_keeps_unselected_destinations_and_preserves_the_source()
    {
        using var client = await factory.DemoVisitorAsync(); var target = Day.AddDays(7);
        var dinner = await Save(client, Day, "Dinner", "Pasta", notes:"Sauce on the side");
        var lunch = await Save(client, Day, "Lunch", "Sandwiches");
        var occupied = await Save(client, target, "Dinner", "Keep this dinner");
        var initial = await Read(client, target);
        var body = new CopyMeals(Guid.NewGuid(), Day, target, [new(Day, "Lunch", lunch.Version!.Value, null)]);
        (await client.PostAsJsonAsync("/api/meals/copy", body)).EnsureSuccessStatusCode();
        var after = await Read(client, target);
        Assert.Equal("Keep this dinner", after.Meals.Single(m => m.Date == target && m.Slot == "Dinner").Title);
        Assert.Equal("Sandwiches", after.Meals.Single(m => m.Date == target && m.Slot == "Lunch").Title);
        var overwrite = new CopyMeals(Guid.NewGuid(), Day, target, [new(Day, "Dinner", dinner.Version!.Value, occupied.Version)]);
        (await client.PostAsJsonAsync("/api/meals/copy", overwrite)).EnsureSuccessStatusCode();
        after = await Read(client, target); Assert.Equal(initial.ChangeNumber + 2, after.ChangeNumber);
        var copied = after.Meals.Single(m => m.Date == target && m.Slot == "Dinner");
        Assert.Equal("Pasta", copied.Title); Assert.Equal("Sauce on the side", copied.Notes);
        Assert.Equal(dinner, (await Read(client)).Meals.Single(m => m.Date == Day && m.Slot == "Dinner"));
        await Save(client, target, "Dinner", "Later edit", copied.Version);
        var revision = (await Read(client)).ChangeNumber;
        (await client.PostAsJsonAsync("/api/meals/copy", overwrite)).EnsureSuccessStatusCode();
        Assert.Equal(revision, (await Read(client)).ChangeNumber);
        Assert.Equal("Later edit", (await Read(client, target)).Meals.Single(m => m.Date == target && m.Slot == "Dinner").Title);
    }

    [Fact]
    public async Task Any_changed_source_or_occupied_target_refuses_the_entire_copy()
    {
        using var client = await factory.DemoVisitorAsync(); var target = Day.AddDays(7);
        var dinner = await Save(client, Day, "Dinner", "Pasta"); var lunch = await Save(client, Day, "Lunch", "Soup");
        var body = new CopyMeals(Guid.NewGuid(), Day, target, [new(Day, "Dinner", dinner.Version!.Value, null), new(Day, "Lunch", lunch.Version!.Value, null)]);
        var occupied = await Save(client, target, "Dinner", "Other device");
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/meals/copy", body)).StatusCode);
        Assert.Null((await Read(client, target)).Meals.Single(m => m.Date == target && m.Slot == "Lunch").Title);
        body = body with { Items = [new(Day, "Dinner", dinner.Version!.Value, occupied.Version), new(Day, "Lunch", lunch.Version!.Value, null)] };
        await Save(client, Day, "Lunch", "Changed source", lunch.Version);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/meals/copy", body)).StatusCode);
        Assert.Equal("Other device", (await Read(client, target)).Meals.Single(m => m.Date == target && m.Slot == "Dinner").Title);
        Assert.Null((await Read(client, target)).Meals.Single(m => m.Date == target && m.Slot == "Lunch").Title);
    }

    [Fact]
    public async Task Family_scoping_applies_to_versions_receipts_and_paired_wall_writes()
    {
        using var parent = await factory.DemoVisitorAsync(); using var other = await factory.DemoVisitorAsync(); using var stranger = factory.Demo.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync($"/api/meals?from={Day:yyyy-MM-dd}&to={Day.AddDays(7):yyyy-MM-dd}")).StatusCode);
        var meal = await Save(parent, Day, "Dinner", "Private meal");
        Assert.All((await Read(other)).Meals, m => Assert.Null(m.Title));
        Assert.Equal(HttpStatusCode.Conflict, (await other.PutAsJsonAsync($"/api/meals/{Day:yyyy-MM-dd}/Dinner", new SaveMeal(Guid.NewGuid(), meal.Version, "No", null))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await other.PostAsJsonAsync("/api/meals/copy",
            new CopyMeals(Guid.NewGuid(), Day, Day.AddDays(7), [new(Day, "Dinner", meal.Version!.Value, null)]))).StatusCode);
        var command = new SaveMeal(Guid.NewGuid(), null, "Same key", null);
        (await parent.PutAsJsonAsync($"/api/meals/{Day:yyyy-MM-dd}/Lunch", command)).EnsureSuccessStatusCode();
        (await other.PutAsJsonAsync($"/api/meals/{Day:yyyy-MM-dd}/Lunch", command)).EnsureSuccessStatusCode();
        using var wall = factory.Demo.CreateClient();
        var pairing = (await (await wall.PostAsync("/api/pairing", null)).Content.ReadFromJsonAsync<PairingResponse>())!;
        (await parent.PostAsJsonAsync("/api/devices", new PairDisplayRequest(pairing.Code, "Meal wall"))).EnsureSuccessStatusCode();
        (await wall.PostAsync($"/api/pairing/{pairing.Id}/finish", null)).EnsureSuccessStatusCode();
        await Save(wall, Day, "Dinner", "Wall dinner", meal.Version);
        Assert.Equal("Wall dinner", (await Read(parent)).Meals.Single(m => m.Date == Day && m.Slot == "Dinner").Title);
    }

    [Fact]
    public async Task Meal_revisions_are_independent_atomic_and_cleanup_cascades_receipts_and_slots()
    {
        using var client = await factory.DemoVisitorAsync(); var family = await Family(client);
        await using var db = factory.DbContextFor(family.Id);
        var before = await db.Families.Select(f => new { f.CalendarChangeNumber, f.ChoresChangeNumber, f.ListsChangeNumber, f.MealsChangeNumber }).SingleAsync();
        await Save(client, Day, "Dinner", "Meal only");
        var after = await db.Families.Select(f => new { f.CalendarChangeNumber, f.ChoresChangeNumber, f.ListsChangeNumber, f.MealsChangeNumber }).SingleAsync();
        Assert.Equal(before.CalendarChangeNumber, after.CalendarChangeNumber); Assert.Equal(before.ChoresChangeNumber, after.ChoresChangeNumber);
        Assert.Equal(before.ListsChangeNumber, after.ListsChangeNumber); Assert.Equal(before.MealsChangeNumber + 1, after.MealsChangeNumber);
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            (await db.MealSlots.FirstAsync()).Title = "Rollback"; await db.SaveChangesAsync();
            Assert.Equal(after.MealsChangeNumber + 1, await db.Families.Select(f => f.MealsChangeNumber).SingleAsync());
            await tx.RollbackAsync();
        }
        Assert.Equal(after.MealsChangeNumber, (await Read(client)).ChangeNumber);
        await using var unscoped = factory.DbContextFor(null);
        Assert.Empty(await unscoped.MealSlots.ToArrayAsync()); Assert.Empty(await unscoped.MealCommands.ToArrayAsync());
        var seed = DemoFamily.Create(Guid.NewGuid(), DateTimeOffset.UtcNow.AddDays(-1));
        seed.Meals.Add(new MealSlot { Id = Guid.NewGuid(), FamilyId = seed.Id, Date = Day, Slot = "Lunch", Title = "Cleanup" });
        unscoped.Families.Add(seed); unscoped.MealCommands.Add(new MealCommand { Id = Guid.NewGuid(), FamilyId = seed.Id, Request = "cleanup" }); await unscoped.SaveChangesAsync();
        await unscoped.Families.IgnoreQueryFilters().Where(f => f.Id == seed.Id).ExecuteDeleteAsync();
        Assert.Empty(await unscoped.MealSlots.IgnoreQueryFilters().Where(m => m.FamilyId == seed.Id).ToArrayAsync());
        Assert.Empty(await unscoped.MealCommands.IgnoreQueryFilters().Where(m => m.FamilyId == seed.Id).ToArrayAsync());
    }

    [Fact]
    public async Task Dates_remain_local_across_DST_and_invalid_ranges_slots_and_copies_are_refused()
    {
        using var client = await factory.DemoVisitorAsync(); var date = new DateOnly(2026, 11, 1);
        var snapshot = await Read(client, date, 2);
        Assert.Equal(new[] { date, date.AddDays(1) }, snapshot.Meals.Select(m => m.Date).Distinct());
        foreach (var url in new[] { "/api/meals?from=2030-01-01&to=2030-01-01", "/api/meals?from=2030-01-01&to=2030-02-01", "/api/meals?from=bad&to=2030-02-01" })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/meals/{Day:yyyy-MM-dd}/Snack", new SaveMeal(Guid.NewGuid(), null, "No", null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/meals/{Day:yyyy-MM-dd}/Dinner", new SaveMeal(Guid.Empty, null, "No", null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/meals/{Day:yyyy-MM-dd}/Dinner", new SaveMeal(Guid.NewGuid(), null, new string('x', 201), null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/meals/copy", new CopyMeals(Guid.NewGuid(), Day, Day, []))).StatusCode);
    }
}
