using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class GroceryTests(ApiFactory factory)
{
    private static async Task<ListsResponse> Read(HttpClient client) => (await client.GetFromJsonAsync<ListsResponse>("/api/lists"))!;
    private static async Task<HouseholdListResponse> Grocery(HttpClient client) => (await Read(client)).Lists.Single(l => l.IsGrocery);
    private static async Task<HouseholdListResponse> Put(HttpClient client, HouseholdListResponse list, string suffix, object body)
    {
        var response = await client.PutAsJsonAsync($"/api/lists/{list.Id}{suffix}", body);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<ListsResponse>())!.Lists.Single(l => l.Id == list.Id);
    }

    [Fact]
    public async Task First_real_family_sign_in_creates_an_empty_protected_grocery()
    {
        using var instance = factory.NewFamilyInstance("alex@example.com");
        using var client = await ApiFactory.ParentAsync(instance, new GoogleIdentity("grocery-alex", "alex@example.com", true, "Alex", "Alex Rivera"));
        var list = await Grocery(client); Assert.Empty(list.Items); Assert.Equal(6, list.Categories!.Length);
        Assert.Single((await Read(client)).Lists);
    }

    [Fact]
    public async Task Migration_backfills_existing_families_without_repurposing_an_ordinary_grocery_list()
    {
        await using var shared = factory.DbContextFor(null);
        var connection = new NpgsqlConnectionStringBuilder(shared.Database.GetConnectionString()) { Database = "grocery_upgrade_" + Guid.NewGuid().ToString("N") };
        var familyId = Guid.NewGuid(); var ordinaryId = Guid.NewGuid();
        await using var db = new WheelhouseDbContext(new DbContextOptionsBuilder<WheelhouseDbContext>().UseNpgsql(connection.ConnectionString).Options, new FixedFamily(familyId));
        try
        {
            await db.GetService<IMigrator>().MigrateAsync("20261019125423_AddSharedLists");
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "Families" ("Id", "Name", "TimeZone", "WeekStartsOn", "NightModeFrom", "NightModeTo", "Units", "CalendarChangeNumber", "ChoresChangeNumber", "ListsChangeNumber")
                VALUES ({familyId}, 'Test household', 'UTC', 'Monday', '22:00', '06:00', 'Metric', 0, 0, 4);
                INSERT INTO "HouseholdLists" ("Id", "FamilyId", "CreationId", "CreationRequest", "Name", "Archived", "Version")
                VALUES ({ordinaryId}, {familyId}, {Guid.NewGuid()}, 'Grocery', 'Grocery', FALSE, {Guid.NewGuid()});
                """);
            await db.GetService<IMigrator>().MigrateAsync();
            Assert.Equal(2, await db.HouseholdLists.CountAsync());
            Assert.False((await db.HouseholdLists.SingleAsync(l => l.Id == ordinaryId)).IsGrocery);
            Assert.Equal(6, await db.GroceryCategories.CountAsync());
            Assert.Equal(5, await db.Families.Select(f => f.ListsChangeNumber).SingleAsync());
        }
        finally { await db.Database.EnsureDeletedAsync(); }
    }

    private sealed record FixedFamily(Guid? Id) : ICurrentFamily;

    [Fact]
    public async Task Grocery_is_protected_and_unique_with_six_scoped_categories()
    {
        using var client = await factory.DemoVisitorAsync(); var list = await Grocery(client);
        Assert.Equal("Grocery", list.Name);
        Assert.Equal(new[] { "Produce", "Dairy", "Meat & fish", "Pantry", "Frozen", "Other" }, list.Categories!.Select(c => c.Name));
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/lists/{list.Id}", new RenameList(list.Version, "Shopping"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/archive", new ListVersion(list.Version))).StatusCode);
        var family = (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        await using var db = factory.DbContextFor(family.Id);
        db.HouseholdLists.Add(GroceryList.Create(family.Id));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        await using var unscoped = factory.DbContextFor(null);
        Assert.Empty(await unscoped.GroceryCategories.ToArrayAsync());
    }

    [Fact]
    public async Task Quantities_are_optional_trimmed_and_idempotent_without_merging_names()
    {
        using var client = await factory.DemoVisitorAsync(); var list = await Grocery(client);
        var request = new CreateListItem(Guid.NewGuid(), "  Rice  ", null, " 2 ", " bags ", list.Categories!.First().Id);
        var replies = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => client.PostAsJsonAsync($"/api/lists/{list.Id}/items", request)));
        Assert.All(replies, r => Assert.True(r.IsSuccessStatusCode));
        list = await Grocery(client); var item = list.Items.Single(i => i.CreationId == request.CreationId);
        Assert.Equal("Rice", item.Text); Assert.Equal("2", item.Quantity); Assert.Equal("bags", item.Unit);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", request with { Quantity = "3" })).StatusCode);
        (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", new CreateListItem(Guid.NewGuid(), "Rice", null))).EnsureSuccessStatusCode();
        list = await Grocery(client); Assert.Equal(2, list.Items.Count(i => i.Text == "Rice"));
        var plain = list.Items.Single(i => i.Text == "Rice" && i.Id != item.Id);
        Assert.Null(plain.Quantity); Assert.Null(plain.Unit); Assert.Equal(list.Categories!.Single(c => c.IsOther).Id, plain.CategoryId);
        list = await Put(client, list, $"/items/{item.Id}", new EditListItem(item.Version, "Rice", null, "3", "bags", item.CategoryId));
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/items/{item.Id}", new EditListItem(item.Version, "Stale", null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", request with { CreationId = Guid.NewGuid(), Quantity = new string('x', 101) })).StatusCode);
    }

    [Fact]
    public async Task Clear_is_atomic_rejects_reopened_or_edited_items_and_keeps_new_checks()
    {
        using var client = await factory.DemoVisitorAsync(); var list = await Grocery(client);
        var first = list.Items.First(i => !i.Checked); var second = list.Items.Last(i => !i.Checked);
        list = await Put(client, list, $"/items/{first.Id}/checked", new CheckListItem(first.Version, true));
        var reviewed = list.Items.Where(i => i.Checked).Select(i => new ReviewedItem(i.Id, i.Version)).ToArray();
        first = list.Items.Single(i => i.Id == first.Id);
        list = await Put(client, list, $"/items/{first.Id}/checked", new CheckListItem(first.Version, false));
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/clear-checked", new ClearCheckedItems(reviewed))).StatusCode);
        list = await Grocery(client);
        Assert.All(reviewed, r => Assert.Contains(list.Items, i => i.Id == r.Id));
        first = list.Items.Single(i => i.Id == first.Id);
        list = await Put(client, list, $"/items/{first.Id}/checked", new CheckListItem(first.Version, true));
        reviewed = list.Items.Where(i => i.Checked).Select(i => new ReviewedItem(i.Id, i.Version)).ToArray();
        first = list.Items.Single(i => i.Id == first.Id);
        list = await Put(client, list, $"/items/{first.Id}", new EditListItem(first.Version, "Changed while checked", null, "5", null, first.CategoryId));
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/clear-checked", new ClearCheckedItems(reviewed))).StatusCode);
        list = await Grocery(client); Assert.All(reviewed, r => Assert.Contains(list.Items, i => i.Id == r.Id));
        reviewed = list.Items.Where(i => i.Checked).Select(i => new ReviewedItem(i.Id, i.Version)).ToArray();
        second = list.Items.Single(i => i.Id == second.Id);
        list = await Put(client, list, $"/items/{second.Id}/checked", new CheckListItem(second.Version, true));
        list = await Put(client, list, "/clear-checked", new ClearCheckedItems(reviewed));
        Assert.All(reviewed, r => Assert.DoesNotContain(list.Items, i => i.Id == r.Id));
        Assert.Contains(list.Items, i => i.Id == second.Id && i.Checked);
        var revision = (await Read(client)).ChangeNumber;
        await Put(client, list, "/clear-checked", new ClearCheckedItems(reviewed));
        Assert.Equal(revision, (await Read(client)).ChangeNumber);
    }

    [Fact]
    public async Task Category_configuration_remaps_removed_items_and_guards_concurrent_changes()
    {
        using var client = await factory.DemoVisitorAsync(); var list = await Grocery(client); var old = list;
        var removed = list.Categories!.First(); var affected = list.Items.Where(i => i.CategoryId == removed.Id).ToArray();
        var drafts = list.Categories!.Skip(1).Select(c => new CategoryDraft(c.Id, c.Name)).ToList();
        drafts.Insert(0, new CategoryDraft(Guid.NewGuid(), "Bakery"));
        var body = new EditCategories(list.Version, drafts.ToArray());
        list = await Put(client, list, "/categories", body);
        Assert.Equal("Bakery", list.Categories![0].Name);
        foreach (var item in affected)
        {
            var current = list.Items.Single(i => i.Id == item.Id);
            Assert.Equal(list.Categories.Single(c => c.IsOther).Id, current.CategoryId); Assert.NotEqual(item.Version, current.Version);
        }
        var revision = (await Read(client)).ChangeNumber;
        await Put(client, list, "/categories", body); Assert.Equal(revision, (await Read(client)).ChangeNumber);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/categories", new EditCategories(old.Version, old.Categories!.Select(c => new CategoryDraft(c.Id, c.Name)).ToArray()))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/categories", new EditCategories(list.Version, drafts.SkipLast(1).ToArray()))).StatusCode);
        var duplicate = drafts.ToArray(); duplicate[0] = duplicate[0] with { Name = duplicate[1].Name.ToUpperInvariant() };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/categories", new EditCategories(list.Version, duplicate))).StatusCode);
    }

    [Fact]
    public async Task Foreign_category_and_clear_ids_do_not_cross_family_boundaries()
    {
        using var client = await factory.DemoVisitorAsync(); using var other = await factory.DemoVisitorAsync();
        var list = await Grocery(client); var foreign = await Grocery(other);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", new CreateListItem(Guid.NewGuid(), "No", null, null, null, foreign.Categories![0].Id))).StatusCode);
        var drafts = list.Categories!.Select(c => new CategoryDraft(c.Id, c.Name)).ToList(); drafts.Insert(0, new CategoryDraft(foreign.Categories![0].Id, "Foreign"));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/categories", new EditCategories(list.Version, drafts.ToArray()))).StatusCode);
        var item = foreign.Items.First(i => i.Checked);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/clear-checked", new ClearCheckedItems([new(item.Id, item.Version)]))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"/api/lists/{list.Id}/clear-checked", new ClearCheckedItems([new(item.Id, item.Version)]))).StatusCode);
    }

    [Fact]
    public async Task Category_revision_rolls_back_with_the_category_and_moves_stay_in_their_group()
    {
        using var client = await factory.DemoVisitorAsync(); var list = await Grocery(client);
        var before = (await Read(client)).ChangeNumber;
        var family = (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        await using (var db = factory.DbContextFor(family.Id))
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            (await db.GroceryCategories.FirstAsync()).Name = "Rollback category"; await db.SaveChangesAsync();
            Assert.Equal(before + 1, await db.Families.Select(f => f.ListsChangeNumber).SingleAsync());
            await tx.RollbackAsync();
        }
        Assert.Equal(before, (await Read(client)).ChangeNumber);
        Assert.DoesNotContain((await Grocery(client)).Categories!, c => c.Name == "Rollback category");
        var apple = list.Items.Single(i => i.Text == "Apples");
        await Put(client, list, $"/items/{apple.Id}/move", new MoveListItem(apple.Version, list.Version, 1));
        Assert.Equal(before, (await Read(client)).ChangeNumber);
    }
}
