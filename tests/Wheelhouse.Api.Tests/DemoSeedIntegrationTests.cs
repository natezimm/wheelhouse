using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;
using Wheelhouse.Api.Meals;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class DemoSeedIntegrationTests(ApiFactory factory)
{
    [Fact]
    public async Task New_visitors_can_read_history_archived_snapshots_and_prior_grocery_purchases_without_writes()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var family = (await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        await using var db = factory.DbContextFor(family.Id);
        var stored = await db.Families.AsNoTracking().SingleAsync();
        var created = stored.ExpiresAt!.Value - DemoCopies.Lifetime;
        var today = ChoreOccurrences.Today(stored.TimeZone, created);
        var monday = new DemoDateAnchor(created, stored.TimeZone).StartOfWeek(today);
        Assert.Equal(1, stored.CalendarChangeNumber);
        Assert.Equal(1, stored.ChoresChangeNumber);
        Assert.Equal(1, stored.ListsChangeNumber);
        Assert.Equal(1, stored.MealsChangeNumber);

        var preview = (await visitor.GetFromJsonAsync<GroceryPreview>($"/api/meals/groceries?from={today:yyyy-MM-dd}&to={today.AddDays(1):yyyy-MM-dd}"))!;
        var dinner = preview.Meals.Single(m => m.Slot == "Dinner");
        Assert.Equal("Black Bean & Sweet Potato Tacos", dinner.Title);
        Assert.Equal(5, dinner.Ingredients.Count(i => i.PreviousCount == 1));
        var remaining = Assert.Single(dinner.Ingredients, i => i.PreviousCount == 0);
        Assert.Equal("to taste", remaining.QuantityText);
        Assert.Equal(5, preview.Grocery.Items.SelectMany(i => i.Sources!).Count());
        Assert.Equal(6, preview.Grocery.Categories!.Length);

        var history = (await visitor.GetFromJsonAsync<ChoresResponse>($"/api/chores/history?from={today.AddDays(-30):yyyy-MM-dd}&to={today.AddDays(1):yyyy-MM-dd}"))!;
        Assert.Contains(history.Chores, c => c.Title == "Brush teeth & make bed" && c.DueDate == today.AddDays(-2) && c.Missed);
        Assert.Contains(history.Chores, c => c.Title == "Brush teeth & make bed" && c.DueDate == today.AddDays(-1) && c.CompletedAt != null);
        Assert.Contains(history.Chores, c => c.Archived && c.CompletedAt != null);
        var current = (await visitor.GetFromJsonAsync<ChoresResponse>($"/api/chores?date={today:yyyy-MM-dd}"))!;
        Assert.Contains(current.Chores, c => c.Repeat == null && c.DueDate < today && c.CompletedAt == null);
        Assert.DoesNotContain(current.Chores, c => c.Repeat != null && c.DueDate < today);
        Assert.DoesNotContain(current.Chores, c => c.Archived);

        var previous = (await visitor.GetFromJsonAsync<MealsResponse>($"/api/meals?from={monday.AddDays(-7):yyyy-MM-dd}&to={monday:yyyy-MM-dd}"))!;
        var archived = await db.Recipes.SingleAsync(r => r.Archived);
        Assert.Contains(previous.Meals, m => m.Recipe?.Id == archived.Id);
        Assert.Equal(5, (await visitor.GetFromJsonAsync<RecipesResponse>("/api/recipes"))!.Recipes.Length);
        var after = await db.Families.AsNoTracking().SingleAsync();
        Assert.Equal(stored.CalendarChangeNumber, after.CalendarChangeNumber);
        Assert.Equal(stored.ChoresChangeNumber, after.ChoresChangeNumber);
        Assert.Equal(stored.ListsChangeNumber, after.ListsChangeNumber);
        Assert.Equal(stored.MealsChangeNumber, after.MealsChangeNumber);

        var district = await db.CalendarSources.SingleAsync(c => !c.CanWrite);
        var denied = await visitor.PostAsJsonAsync("/api/calendar/events",
            new EventRequest(district.Id, "Not writable", null, true, today, null, today.AddDays(1), null), ApiFactory.Json);
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        var grocery = preview.Grocery;
        Assert.Equal(HttpStatusCode.Conflict, (await visitor.PutAsJsonAsync($"/api/lists/{grocery.Id}/archive", new ListVersion(grocery.Version))).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_copy_cascades_every_new_seed_domain_and_preserves_another_visitors_copy()
    {
        using var first = await factory.DemoVisitorAsync();
        using var second = await factory.DemoVisitorAsync();
        var firstId = (await first.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!.Id;
        var secondId = (await second.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!.Id;
        await using var db = factory.DbContextFor(firstId);
        Assert.Equal(5, await db.GroceryContributions.CountAsync());
        Assert.Single(await db.GroceryBatches.ToArrayAsync());
        Assert.Equal(4, await db.ChorePlans.CountAsync());
        Assert.Equal(4, await db.ChoreCompletions.CountAsync());
        await db.Families.Where(f => f.Id == firstId).ExecuteDeleteAsync();
        Assert.Empty(await db.Members.ToArrayAsync());
        Assert.Empty(await db.CalendarSources.ToArrayAsync());
        Assert.Empty(await db.EventInstances.ToArrayAsync());
        Assert.Empty(await db.Chores.ToArrayAsync());
        Assert.Empty(await db.ChorePlans.ToArrayAsync());
        Assert.Empty(await db.ChoreCompletions.ToArrayAsync());
        Assert.Empty(await db.HouseholdLists.ToArrayAsync());
        Assert.Empty(await db.ListItems.ToArrayAsync());
        Assert.Empty(await db.GroceryCategories.ToArrayAsync());
        Assert.Empty(await db.MealSlots.ToArrayAsync());
        Assert.Empty(await db.Recipes.ToArrayAsync());
        Assert.Empty(await db.GroceryContributions.ToArrayAsync());
        Assert.Empty(await db.GroceryBatches.ToArrayAsync());
        await using var other = factory.DbContextFor(secondId);
        Assert.Equal(4, await other.Members.CountAsync());
        Assert.Equal(5, await other.GroceryContributions.CountAsync());
    }
}
