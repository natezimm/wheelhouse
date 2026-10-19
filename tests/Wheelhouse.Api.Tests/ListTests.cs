using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Lists;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ListTests(ApiFactory factory)
{
    private static async Task<ListsResponse> Read(HttpClient client) => (await client.GetFromJsonAsync<ListsResponse>("/api/lists"))!;
    private static async Task<ListsResponse> Put(HttpClient client, string url, object body)
    {
        var response = await client.PutAsJsonAsync(url, body); response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ListsResponse>())!;
    }
    private static async Task<HouseholdListResponse> Create(HttpClient client, string name = "Trip packing")
    {
        var request = new CreateList(Guid.NewGuid(), name);
        var response = await client.PostAsJsonAsync("/api/lists", request); response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ListsResponse>())!.Lists.Single(l => l.CreationId == request.CreationId);
    }
    private static async Task<HouseholdListResponse> Add(HttpClient client, HouseholdListResponse list, string text = "Rain jackets")
    {
        var response = await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", new CreateListItem(Guid.NewGuid(), text, "For everyone"));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<ListsResponse>())!.Lists.Single(l => l.Id == list.Id);
    }

    [Fact]
    public async Task Complete_list_lifecycle_preserves_archived_contents_and_only_advances_lists_revision()
    {
        using var client = await factory.DemoVisitorAsync();
        var family = (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        await using var db = factory.DbContextFor(family.Id);
        var calendar = await db.Families.Select(f => f.CalendarChangeNumber).SingleAsync();
        var chores = await db.Families.Select(f => f.ChoresChangeNumber).SingleAsync();
        var before = (await Read(client)).ChangeNumber;
        var list = await Create(client);
        list = await Add(client, list);
        var item = list.Items.Single();
        list = (await Put(client, $"/api/lists/{list.Id}/items/{item.Id}", new EditListItem(item.Version, "  Jackets  ", "  Waterproof  "))).Lists.Single(l => l.Id == list.Id);
        item = list.Items.Single(); Assert.Equal("Jackets", item.Text); Assert.Equal("Waterproof", item.Notes);
        list = (await Put(client, $"/api/lists/{list.Id}/items/{item.Id}/checked", new CheckListItem(item.Version, true))).Lists.Single(l => l.Id == list.Id);
        Assert.True(list.Items.Single().Checked);
        var checkedRevision = (await Read(client)).ChangeNumber;
        await Put(client, $"/api/lists/{list.Id}/items/{item.Id}/checked", new CheckListItem(item.Version, true));
        Assert.Equal(checkedRevision, (await Read(client)).ChangeNumber);
        item = list.Items.Single();
        list = (await Put(client, $"/api/lists/{list.Id}/items/{item.Id}/checked", new CheckListItem(item.Version, false))).Lists.Single(l => l.Id == list.Id);
        list = (await Put(client, $"/api/lists/{list.Id}", new RenameList(list.Version, "Holiday"))).Lists.Single(l => l.Id == list.Id);
        list = (await Put(client, $"/api/lists/{list.Id}/archive", new ListVersion(list.Version))).Lists.Single(l => l.Id == list.Id);
        Assert.True(list.Archived); Assert.Single(list.Items);
        Assert.Equal(before + 7, (await Read(client)).ChangeNumber);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", new CreateListItem(Guid.NewGuid(), "No", null))).StatusCode);
        Assert.Equal(calendar, await db.Families.Select(f => f.CalendarChangeNumber).SingleAsync());
        Assert.Equal(chores, await db.Families.Select(f => f.ChoresChangeNumber).SingleAsync());
    }

    [Fact]
    public async Task Concurrent_distinct_additions_survive_and_duplicate_creates_and_deletes_do_not_resurrect()
    {
        using var client = await factory.DemoVisitorAsync();
        var key = Guid.NewGuid(); var body = new CreateList(key, "Concurrent");
        var creates = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => client.PostAsJsonAsync("/api/lists", body)));
        Assert.All(creates, r => Assert.True(r.IsSuccessStatusCode));
        var list = (await Read(client)).Lists.Single(l => l.CreationId == key);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/lists", body with { Name = "Different" })).StatusCode);
        var adds = await Task.WhenAll(Enumerable.Range(0, 4).Select(n => client.PostAsJsonAsync($"/api/lists/{list.Id}/items", new CreateListItem(Guid.NewGuid(), $"Item {n}", null))));
        Assert.All(adds, r => Assert.True(r.IsSuccessStatusCode));
        list = (await Read(client)).Lists.Single(l => l.Id == list.Id);
        Assert.Equal(4, list.Items.Length); Assert.Equal(4, list.Items.Select(i => i.SortOrder).Distinct().Count());
        var request = new CreateListItem(Guid.NewGuid(), "Unique item", null);
        var before = (await Read(client)).ChangeNumber;
        var duplicates = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => client.PostAsJsonAsync($"/api/lists/{list.Id}/items", request)));
        Assert.All(duplicates, r => Assert.True(r.IsSuccessStatusCode));
        Assert.Equal(before + 1, (await Read(client)).ChangeNumber);
        list = (await Read(client)).Lists.Single(l => l.Id == list.Id);
        var item = list.Items.Single(i => i.CreationId == request.CreationId);
        await Put(client, $"/api/lists/{list.Id}/items/{item.Id}/delete", new ListVersion(item.Version));
        var deletedRevision = (await Read(client)).ChangeNumber;
        await Put(client, $"/api/lists/{list.Id}/items/{item.Id}/delete", new ListVersion(item.Version));
        (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", request)).EnsureSuccessStatusCode();
        Assert.Equal(deletedRevision, (await Read(client)).ChangeNumber);
        Assert.DoesNotContain((await Read(client)).Lists.Single(l => l.Id == list.Id).Items, i => i.Id == item.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", request with { Text = "Changed" })).StatusCode);
    }

    [Fact]
    public async Task Stale_edits_and_reorders_conflict_without_losing_other_device_changes()
    {
        using var client = await factory.DemoVisitorAsync();
        var list = await Add(client, await Create(client), "First"); list = await Add(client, list, "Second");
        var old = list; var first = list.Items[0]; var second = list.Items[1];
        list = (await Put(client, $"/api/lists/{list.Id}/items/{second.Id}/move", new MoveListItem(second.Version, list.Version, -1))).Lists.Single(l => l.Id == list.Id);
        Assert.Equal(second.Id, list.Items[0].Id);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/items/{second.Id}/move", new MoveListItem(second.Version, old.Version, -1))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/lists/{list.Id}/items/{first.Id}", new EditListItem(first.Version, "Stale", null))).StatusCode);
        var current = list.Items.Single(i => i.Id == first.Id);
        await Put(client, $"/api/lists/{list.Id}/items/{first.Id}", new EditListItem(current.Version, "Current", null));
        Assert.Equal("Current", (await Read(client)).Lists.Single(l => l.Id == list.Id).Items.Single(i => i.Id == first.Id).Text);
    }

    [Fact]
    public async Task A_paired_wall_manages_lists_but_strangers_and_other_families_cannot()
    {
        using var parent = await factory.DemoVisitorAsync(); using var other = await factory.DemoVisitorAsync();
        using var stranger = factory.Demo.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync("/api/lists")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.PostAsJsonAsync("/api/lists", new CreateList(Guid.NewGuid(), "No"))).StatusCode);
        var list = await Add(parent, await Create(parent)); var item = list.Items.Single();
        Assert.DoesNotContain((await Read(other)).Lists, l => l.Id == list.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"/api/lists/{list.Id}", new RenameList(list.Version, "No"))).StatusCode);
        var otherList = await Create(other);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"/api/lists/{otherList.Id}/items/{item.Id}/checked", new CheckListItem(item.Version, true))).StatusCode);
        using var wall = factory.Demo.CreateClient();
        var pairing = (await (await wall.PostAsync("/api/pairing", null)).Content.ReadFromJsonAsync<PairingResponse>())!;
        (await parent.PostAsJsonAsync("/api/devices", new PairDisplayRequest(pairing.Code, "Lists wall"))).EnsureSuccessStatusCode();
        (await wall.PostAsync($"/api/pairing/{pairing.Id}/finish", null)).EnsureSuccessStatusCode();
        var wallList = await Add(wall, await Create(wall, "Wall errands"));
        await Put(wall, $"/api/lists/{wallList.Id}/archive", new ListVersion(wallList.Version));
        Assert.Contains((await Read(parent)).Lists, l => l.Id == wallList.Id && l.Archived);
    }

    [Fact]
    public async Task Rollbacks_restore_revision_and_demo_cleanup_cascades_items_and_tombstones()
    {
        using var client = await factory.DemoVisitorAsync();
        var family = (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        var before = (await Read(client)).ChangeNumber;
        await using (var db = factory.DbContextFor(family.Id))
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            (await db.ListItems.FirstAsync()).Text = "Rollback"; await db.SaveChangesAsync();
            Assert.Equal(before + 1, await db.Families.Select(f => f.ListsChangeNumber).SingleAsync());
            await tx.RollbackAsync();
        }
        Assert.Equal(before, (await Read(client)).ChangeNumber);
        await using var unscoped = factory.DbContextFor(null);
        Assert.Empty(await unscoped.HouseholdLists.ToArrayAsync()); Assert.Empty(await unscoped.ListItems.ToArrayAsync());
        var seed = DemoFamily.Create(Guid.NewGuid(), DateTimeOffset.UtcNow.AddDays(-1));
        Assert.Equal(3, seed.Lists.Count); Assert.Contains(seed.Lists.SelectMany(l => l.Items), i => i.Checked);
        unscoped.Families.Add(seed); await unscoped.SaveChangesAsync();
        await unscoped.Families.IgnoreQueryFilters().Where(f => f.Id == seed.Id).ExecuteDeleteAsync();
        Assert.Empty(await unscoped.HouseholdLists.IgnoreQueryFilters().Where(l => l.FamilyId == seed.Id).ToArrayAsync());
        Assert.Empty(await unscoped.ListItems.IgnoreQueryFilters().Where(i => i.FamilyId == seed.Id).ToArrayAsync());
    }

    [Fact]
    public async Task Invalid_names_items_and_operation_ids_are_refused()
    {
        using var client = await factory.DemoVisitorAsync(); var list = await Create(client);
        foreach (var name in new[] { "", "  ", new string('x', 101) })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/lists", new CreateList(Guid.NewGuid(), name))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/lists", new CreateList(Guid.Empty, "No key"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", new CreateListItem(Guid.NewGuid(), " ", null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/lists/{list.Id}/items", new CreateListItem(Guid.NewGuid(), "Long notes", new string('x', 2001)))).StatusCode);
    }
}
