using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Demo;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ChoreTests(ApiFactory factory)
{
    private static readonly DateOnly Day = new(2026, 11, 1);
    private static Task<ChoresResponse?> Read(HttpClient client, DateOnly? day = null) =>
        client.GetFromJsonAsync<ChoresResponse>($"/api/chores?date={day ?? Day:yyyy-MM-dd}", ApiFactory.Json);
    private static async Task<ChoreResponse> Add(HttpClient client, string title = "Feed the fish", Guid? member = null)
    {
        var response = await client.PostAsJsonAsync("/api/chores", new CreateChore(Guid.NewGuid(), title, null, member, Day));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ChoreResponse>())!;
    }

    [Fact]
    public async Task Parent_creates_edits_completes_reopens_and_archives_with_durable_revisions()
    {
        using var client = await factory.DemoVisitorAsync();
        var before = (await Read(client))!.ChangeNumber;
        var chore = await Add(client);
        Assert.Equal(before + 1, (await Read(client))!.ChangeNumber);
        var edited = await client.PutAsJsonAsync($"/api/chores/{chore.Id}", new EditChore(chore.Version, "Clean the bowl", "Fresh water", null, Day));
        chore = (await edited.Content.ReadFromJsonAsync<ChoreResponse>())!;
        Assert.Equal("Clean the bowl", chore.Title);
        var done = await client.PutAsJsonAsync($"/api/chores/{chore.Id}/completion", new CompleteChore(chore.Version, true));
        chore = (await done.Content.ReadFromJsonAsync<ChoreResponse>())!;
        Assert.NotNull(chore.CompletedAt);
        var reopened = await client.PutAsJsonAsync($"/api/chores/{chore.Id}/completion", new CompleteChore(chore.Version, false));
        chore = (await reopened.Content.ReadFromJsonAsync<ChoreResponse>())!;
        Assert.Null(chore.CompletedAt);
        (await client.PutAsJsonAsync($"/api/chores/{chore.Id}/archive", new ArchiveChore(chore.Version))).EnsureSuccessStatusCode();
        Assert.DoesNotContain((await Read(client))!.Chores, c => c.Id == chore.Id);
        var archived = (await client.GetFromJsonAsync<ChoreResponse>($"/api/chores/{chore.Id}"))!;
        Assert.True(archived.Archived);
        Assert.Equal(before + 5, (await Read(client))!.ChangeNumber);
    }

    [Fact]
    public async Task Concurrent_duplicate_creates_are_one_chore_and_key_reuse_with_different_content_conflicts()
    {
        using var client = await factory.DemoVisitorAsync();
        var before = (await Read(client))!.ChangeNumber;
        var request = new CreateChore(Guid.NewGuid(), "  Feed the fish  ", "  Small scoop  ", null, Day);
        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => client.PostAsJsonAsync("/api/chores", request)));
        Assert.All(responses, r => Assert.True(r.IsSuccessStatusCode));
        var results = await Task.WhenAll(responses.Select(async r => (await r.Content.ReadFromJsonAsync<ChoreResponse>())!));
        Assert.Single(results.Select(c => c.Id).Distinct());
        Assert.Equal("Feed the fish", results[0].Title);
        Assert.Equal(before + 1, (await Read(client))!.ChangeNumber);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/chores", request with { Title = "Different" })).StatusCode);
        Assert.Equal(results[0].Id, (await client.GetFromJsonAsync<ChoreResponse>($"/api/chores/creation/{request.CreationId}"))!.Id);
    }

    [Fact]
    public async Task Completion_is_desired_state_and_stale_conflicting_commands_do_not_overwrite()
    {
        using var client = await factory.DemoVisitorAsync();
        var original = await Add(client);
        var request = new CompleteChore(original.Version, true);
        var responses = await Task.WhenAll(client.PutAsJsonAsync($"/api/chores/{original.Id}/completion", request),
            client.PutAsJsonAsync($"/api/chores/{original.Id}/completion", request));
        Assert.All(responses, r => Assert.True(r.IsSuccessStatusCode));
        var completed = (await responses[0].Content.ReadFromJsonAsync<ChoreResponse>())!;
        var revision = (await Read(client))!.ChangeNumber;
        var duplicate = await client.PutAsJsonAsync($"/api/chores/{original.Id}/completion", request);
        Assert.Equal(completed.CompletedAt, (await duplicate.Content.ReadFromJsonAsync<ChoreResponse>())!.CompletedAt);
        Assert.Equal(revision, (await Read(client))!.ChangeNumber);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/chores/{original.Id}/completion", new CompleteChore(original.Version, false))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/chores/{original.Id}", new EditChore(original.Version, "Lost update", null, null, Day))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync($"/api/chores/{original.Id}/archive", new ArchiveChore(original.Version))).StatusCode);
    }

    [Fact]
    public async Task Families_cannot_read_mutate_or_assign_another_familys_records_and_creation_keys_are_scoped()
    {
        using var first = await factory.DemoVisitorAsync();
        using var second = await factory.DemoVisitorAsync();
        var chore = await Add(first);
        var other = (await second.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        Assert.Equal(HttpStatusCode.NotFound, (await second.GetAsync($"/api/chores/{chore.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await second.GetAsync($"/api/chores/creation/{chore.CreationId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await second.PutAsJsonAsync($"/api/chores/{chore.Id}/completion", new CompleteChore(chore.Version, true))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await first.PostAsJsonAsync("/api/chores", new CreateChore(Guid.NewGuid(), "Wrong member", null, other.Members[0].Id, Day))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await first.PutAsJsonAsync($"/api/chores/{chore.Id}", new EditChore(chore.Version, chore.Title, null, other.Members[0].Id, Day))).StatusCode);
        (await second.PostAsJsonAsync("/api/chores", new CreateChore(chore.CreationId, "Independent", null, null, Day))).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task A_paired_wall_can_complete_but_cannot_manage_chore_definitions()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var wall = factory.Demo.CreateClient();
        var code = (await (await wall.PostAsync("/api/pairing", null)).Content.ReadFromJsonAsync<PairingResponse>())!;
        (await parent.PostAsJsonAsync("/api/devices", new PairDisplayRequest(code.Code, "Kitchen"))).EnsureSuccessStatusCode();
        (await wall.PostAsync($"/api/pairing/{code.Id}/finish", null)).EnsureSuccessStatusCode();
        var chore = await Add(parent);
        Assert.Contains((await Read(wall))!.Chores, c => c.Id == chore.Id);
        (await wall.PutAsJsonAsync($"/api/chores/{chore.Id}/completion", new CompleteChore(chore.Version, true))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await wall.PostAsJsonAsync("/api/chores", new CreateChore(Guid.NewGuid(), "No", null, null, Day))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await wall.PutAsJsonAsync($"/api/chores/{chore.Id}", new EditChore(chore.Version, "No", null, null, Day))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await wall.PutAsJsonAsync($"/api/chores/{chore.Id}/archive", new ArchiveChore(chore.Version))).StatusCode);
    }

    [Fact]
    public async Task Removed_assignees_become_household_work_without_losing_completion_history()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = (await parent.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        var member = family.Members.Last();
        var chore = await Add(parent, member: member.Id);
        var done = await parent.PutAsJsonAsync($"/api/chores/{chore.Id}/completion", new CompleteChore(chore.Version, true));
        var completed = (await done.Content.ReadFromJsonAsync<ChoreResponse>())!;
        var before = (await Read(parent))!.ChangeNumber;
        (await parent.DeleteAsync($"/api/family/members/{member.Id}")).EnsureSuccessStatusCode();
        var current = (await parent.GetFromJsonAsync<ChoreResponse>($"/api/chores/{chore.Id}"))!;
        Assert.Null(current.MemberId);
        Assert.Equal(completed.CompletedAt, current.CompletedAt);
        Assert.Equal(before + 1, (await Read(parent))!.ChangeNumber);
    }

    [Fact]
    public async Task Due_dates_are_household_dates_and_overdue_work_remains_actionable_until_completed()
    {
        using var parent = await factory.DemoVisitorAsync();
        var chore = await Add(parent);
        Assert.DoesNotContain((await Read(parent, Day.AddDays(-1)))!.Chores, c => c.Id == chore.Id);
        Assert.Contains((await Read(parent, Day.AddDays(1)))!.Chores, c => c.Id == chore.Id);
        (await parent.PutAsJsonAsync($"/api/chores/{chore.Id}/completion", new CompleteChore(chore.Version, true))).EnsureSuccessStatusCode();
        Assert.DoesNotContain((await Read(parent, Day.AddDays(1)))!.Chores, c => c.Id == chore.Id);
        Assert.Contains((await Read(parent))!.Chores, c => c.Id == chore.Id && c.CompletedAt != null);
    }

    [Fact]
    public async Task Outer_rollback_does_not_advance_chore_or_calendar_revision_and_no_family_context_reads_nothing()
    {
        using var parent = await factory.DemoVisitorAsync();
        var family = (await parent.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;
        var chore = await Add(parent);
        var before = (await Read(parent))!.ChangeNumber;
        await using (var db = factory.DbContextFor(family.Id))
        {
            var calendarBefore = await db.Families.Select(f => f.CalendarChangeNumber).SingleAsync();
            await using var tx = await db.Database.BeginTransactionAsync();
            var row = await db.Chores.SingleAsync(c => c.Id == chore.Id);
            row.Title = "Rolled back";
            await db.SaveChangesAsync();
            Assert.Equal(before + 1, await db.Families.AsNoTracking().Select(f => f.ChoresChangeNumber).SingleAsync());
            Assert.Equal(calendarBefore, await db.Families.AsNoTracking().Select(f => f.CalendarChangeNumber).SingleAsync());
            await tx.RollbackAsync();
        }
        Assert.Equal(before, (await Read(parent))!.ChangeNumber);
        Assert.Equal(chore.Title, (await parent.GetFromJsonAsync<ChoreResponse>($"/api/chores/{chore.Id}"))!.Title);
        await using var unscoped = factory.DbContextFor(null);
        Assert.Empty(await unscoped.Chores.ToArrayAsync());
    }

    [Fact]
    public async Task Demo_seeds_are_fictional_relative_to_family_day_and_expiry_cascades_chores()
    {
        var created = DateTimeOffset.Parse("2026-11-01T03:30:00Z");
        var seed = DemoFamily.Create(Guid.NewGuid(), created + DemoCopies.Lifetime);
        Assert.Contains(seed.Chores, c => c.DueDate == new DateOnly(2026, 10, 31));
        Assert.Contains(seed.Chores, c => c.MemberId == null);
        Assert.Contains(seed.Chores, c => c.CompletedAt != null);
        await using var db = factory.DbContextFor(null);
        db.Families.Add(seed);
        await db.SaveChangesAsync();
        Assert.NotEmpty(await db.Chores.IgnoreQueryFilters().Where(c => c.FamilyId == seed.Id).ToArrayAsync());
        await db.Families.IgnoreQueryFilters().Where(f => f.Id == seed.Id).ExecuteDeleteAsync();
        Assert.Empty(await db.Chores.IgnoreQueryFilters().Where(c => c.FamilyId == seed.Id).ToArrayAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Invalid_drafts_and_unsigned_reads_are_refused(string title)
    {
        using var parent = await factory.DemoVisitorAsync();
        using var stranger = factory.Demo.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync($"/api/chores?date={Day:yyyy-MM-dd}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await parent.PostAsJsonAsync("/api/chores", new CreateChore(Guid.NewGuid(), title, null, null, Day))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await parent.PostAsJsonAsync("/api/chores", new CreateChore(Guid.Empty, "Missing key", null, null, Day))).StatusCode);
    }
}
