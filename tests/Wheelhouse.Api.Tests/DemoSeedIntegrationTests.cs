using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class DemoSeedIntegrationTests(ApiFactory factory)
{
    [Fact]
    public async Task New_visitors_have_calendar_events_without_old_household_records()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var family = (await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        await using var db = factory.DbContextFor(family.Id);
        var stored = await db.Families.AsNoTracking().SingleAsync();
        Assert.Equal(1, stored.CalendarChangeNumber);
        Assert.Equal(0, stored.ChoresChangeNumber);
        Assert.Equal(0, stored.ListsChangeNumber);
        Assert.Equal(0, stored.MealsChangeNumber);
        Assert.Equal(6, await db.CalendarSources.CountAsync());
        Assert.True(await db.EventInstances.AnyAsync());
        Assert.Empty(await db.Chores.ToArrayAsync());
        Assert.Empty(await db.HouseholdLists.ToArrayAsync());
        Assert.Empty(await db.ListItems.ToArrayAsync());
        Assert.Empty(await db.MealSlots.ToArrayAsync());
        Assert.Empty(await db.Recipes.ToArrayAsync());
        Assert.Empty(await db.GroceryBatches.ToArrayAsync());

        var today = new DemoDateAnchor(stored.ExpiresAt!.Value - DemoCopies.Lifetime, stored.TimeZone).Today;
        var district = await db.CalendarSources.SingleAsync(c => !c.CanWrite);
        var denied = await visitor.PostAsJsonAsync("/api/calendar/events",
            new EventRequest(district.Id, "Not writable", null, true, today, null, today.AddDays(1), null), ApiFactory.Json);
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
    }

    [Theory]
    [InlineData("/api/chores")]
    [InlineData("/api/chores/history")]
    [InlineData("/api/lists")]
    [InlineData("/api/meals")]
    [InlineData("/api/recipes")]
    [InlineData("/api/meals/groceries")]
    public async Task Deferred_household_routes_are_gone(string route)
    {
        using var visitor = await factory.DemoVisitorAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.GetAsync(route)).StatusCode);
    }

    [Fact]
    public async Task Removing_demo_copy_cascades_calendar_without_affecting_another_visitor()
    {
        using var first = await factory.DemoVisitorAsync();
        using var second = await factory.DemoVisitorAsync();
        var firstId = (await first.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!.Id;
        var secondId = (await second.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!.Id;
        await using var db = factory.DbContextFor(firstId);
        await db.Families.Where(f => f.Id == firstId).ExecuteDeleteAsync();
        Assert.Empty(await db.Members.ToArrayAsync());
        Assert.Empty(await db.CalendarSources.ToArrayAsync());
        Assert.Empty(await db.EventInstances.ToArrayAsync());
        await using var other = factory.DbContextFor(secondId);
        Assert.Equal(4, await other.Members.CountAsync());
        Assert.True(await other.EventInstances.AnyAsync());
    }
}
