using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Families;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class RepeatingChoreTests(ApiFactory factory)
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.Parse("2030-03-10T15:00:00Z");
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed record Scenario(WebApplicationFactory<Program> Host, HttpClient Client, Clock Clock, FamilyResponse Family) : IAsyncDisposable
    {
        public DateOnly Today => ChoreOccurrences.Today(Family.TimeZone, Clock.Now);
        public async ValueTask DisposeAsync() { Client.Dispose(); await Host.DisposeAsync(); }
    }
    private async Task<Scenario> Start(string? instant = null)
    {
        var clock = new Clock(); if (instant is not null) clock.Now = DateTimeOffset.Parse(instant);
        var host = factory.InMode(InstanceMode.Demo).WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<TimeProvider>(clock);
            // This clock is intentionally in the future; do not expire unrelated tests' copies.
            foreach (var descriptor in services.Where(d => d.ServiceType == typeof(IHostedService)
                && d.ImplementationType?.Name == "DemoCleanupService").ToArray()) services.Remove(descriptor);
        }));
        var client = host.CreateClient();
        (await client.PostAsync("/api/demo/visit", null)).EnsureSuccessStatusCode();
        return new(host, client, clock, (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!);
    }
    private static async Task<ChoreResponse> Add(Scenario app, ChoreRepeat? repeat = null, Guid? creationId = null, Guid? member = null)
    {
        var response = await app.Client.PostAsJsonAsync($"/api/chores?date={app.Today:yyyy-MM-dd}",
            new CreateChore(creationId ?? Guid.NewGuid(), "Brush teeth", null, member, app.Today.AddDays(-14), repeat ?? new("Daily")));
        response.EnsureSuccessStatusCode(); return (await response.Content.ReadFromJsonAsync<ChoreResponse>())!;
    }
    private static Task<ChoresResponse?> Read(Scenario app, DateOnly day) =>
        app.Client.GetFromJsonAsync<ChoresResponse>($"/api/chores?date={day:yyyy-MM-dd}");
    private static Task<ChoreResponse?> Get(Scenario app, Guid id, DateOnly day) =>
        app.Client.GetFromJsonAsync<ChoreResponse>($"/api/chores/{id}?date={day:yyyy-MM-dd}");
    private static async Task<ChoreResponse> Complete(Scenario app, ChoreResponse chore, bool completed)
    {
        var response = await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}/completion?date={chore.DueDate:yyyy-MM-dd}", new CompleteChore(chore.Version, completed));
        response.EnsureSuccessStatusCode(); return (await response.Content.ReadFromJsonAsync<ChoreResponse>())!;
    }

    [Fact]
    public async Task Dates_have_stable_independent_completions_and_reads_create_no_occurrence_rows()
    {
        await using var app = await Start(); var today = app.Today; var chore = await Add(app);
        var past = (await Get(app, chore.Id, today.AddDays(-1)))!;
        Assert.NotEqual(chore.OccurrenceId, past.OccurrenceId); Assert.True(past.Missed);
        await using var db = factory.DbContextFor(app.Family.Id);
        Assert.Empty(await db.ChoreCompletions.Where(c => c.ChoreId == chore.Id).ToArrayAsync());
        var repeatRead = (await Get(app, chore.Id, today))!;
        Assert.Equal(chore.OccurrenceId, repeatRead.OccurrenceId); Assert.Equal(chore.Version, repeatRead.Version);
        var pastDone = await Complete(app, past, true); var todayDone = await Complete(app, chore, true);
        await Complete(app, pastDone, false);
        Assert.NotNull((await Get(app, chore.Id, today))!.CompletedAt);
        Assert.Null((await Get(app, chore.Id, past.DueDate))!.CompletedAt);
        Assert.Null((await Get(app, chore.Id, today.AddDays(1)))!.CompletedAt);
        Assert.Equal(todayDone.DefinitionVersion, (await Get(app, chore.Id, today))!.DefinitionVersion);
        Assert.Equal(2, await db.ChoreCompletions.CountAsync(c => c.ChoreId == chore.Id));
        Assert.Single((await Read(app, today))!.Chores, c => c.Id == chore.Id);
        Assert.DoesNotContain((await Read(app, today))!.Chores, c => c.Id == chore.Id && c.DueDate < today);
    }

    [Fact]
    public async Task Schedule_edits_start_tomorrow_and_preserve_old_titles_assignees_and_completions()
    {
        await using var app = await Start(); var today = app.Today;
        var chore = await Add(app, member: app.Family.Members[0].Id);
        var past = await Complete(app, (await Get(app, chore.Id, today.AddDays(-1)))!, true);
        var edit = new EditChore(chore.DefinitionVersion!.Value, "Evening tidy", "New instructions", app.Family.Members[1].Id,
            today.AddDays(-14), new("Daily"));
        var result = await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}?date={today:yyyy-MM-dd}", edit);
        result.EnsureSuccessStatusCode(); var response = (await result.Content.ReadFromJsonAsync<ChoreResponse>())!;
        Assert.Equal("Brush teeth", response.Title); Assert.Equal("Evening tidy", response.EditDraft!.Title);
        Assert.Equal(today.AddDays(1), response.NextChangeDate);
        var yesterday = (await Get(app, chore.Id, today.AddDays(-1)))!;
        Assert.Equal(past.CompletedAt, yesterday.CompletedAt); Assert.Equal(past.Title, yesterday.Title); Assert.Equal(past.MemberId, yesterday.MemberId);
        var tomorrow = (await Get(app, chore.Id, today.AddDays(1)))!;
        Assert.Equal("Evening tidy", tomorrow.Title); Assert.Equal(app.Family.Members[1].Id, tomorrow.MemberId);
        // Another edit that day replaces only tomorrow's pending plan, never today's plan.
        (await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}", edit with { Version = response.DefinitionVersion!.Value, Title = "Final title" })).EnsureSuccessStatusCode();
        Assert.Equal("Final title", (await Get(app, chore.Id, today.AddDays(1)))!.Title);
        Assert.Equal("Brush teeth", (await Get(app, chore.Id, today))!.Title);
        await using var db = factory.DbContextFor(app.Family.Id);
        Assert.Equal(2, await db.ChorePlans.CountAsync(p => p.ChoreId == chore.Id));
        Assert.Equal(HttpStatusCode.Conflict, (await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}", edit)).StatusCode);
    }

    [Fact]
    public async Task An_archived_schedule_stops_tomorrow_but_its_past_can_still_be_reopened()
    {
        await using var app = await Start(); var chore = await Add(app);
        var past = await Complete(app, (await Get(app, chore.Id, app.Today.AddDays(-1)))!, true);
        var response = await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}/archive?date={app.Today:yyyy-MM-dd}", new ArchiveChore(chore.DefinitionVersion!.Value));
        response.EnsureSuccessStatusCode(); var archived = (await response.Content.ReadFromJsonAsync<ChoreResponse>())!;
        Assert.True(archived.SeriesArchived); Assert.False(archived.Archived); Assert.Equal(app.Today.AddDays(1), archived.StopsOn);
        Assert.Contains((await Read(app, app.Today))!.Chores, c => c.Id == chore.Id);
        Assert.DoesNotContain((await Read(app, app.Today.AddDays(1)))!.Chores, c => c.Id == chore.Id);
        await Complete(app, past, false);
        Assert.True((await Get(app, chore.Id, past.DueDate))!.Missed);
    }

    [Fact]
    public async Task Concurrent_retries_create_one_completion_and_stale_reopen_cannot_undo_it()
    {
        await using var app = await Start(); var chore = await Add(app);
        var before = (await Read(app, app.Today))!.ChangeNumber;
        var url = $"/api/chores/{chore.Id}/completion?date={app.Today:yyyy-MM-dd}";
        var responses = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => app.Client.PutAsJsonAsync(url, new CompleteChore(chore.Version, true))));
        Assert.All(responses, r => Assert.True(r.IsSuccessStatusCode));
        var done = await Task.WhenAll(responses.Select(async r => (await r.Content.ReadFromJsonAsync<ChoreResponse>())!));
        Assert.Single(done.Select(c => c.CompletedAt).Distinct());
        Assert.Equal(before + 1, (await Read(app, app.Today))!.ChangeNumber);
        Assert.Equal(HttpStatusCode.Conflict, (await app.Client.PutAsJsonAsync(url, new CompleteChore(chore.Version, false))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}/completion", new CompleteChore(chore.Version, false))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}/completion?date={app.Today.AddDays(1):yyyy-MM-dd}", new CompleteChore(chore.Version, true))).StatusCode);
    }

    [Fact]
    public async Task Creation_retries_and_member_removal_keep_repeating_history_and_family_isolation()
    {
        await using var app = await Start(); var key = Guid.NewGuid(); var member = app.Family.Members.Last().Id;
        var chore = await Add(app, creationId: key, member: member);
        Assert.Equal(chore.Id, (await Add(app, creationId: key, member: member)).Id);
        var done = await Complete(app, chore, true);
        (await app.Client.DeleteAsync($"/api/family/members/{member}")).EnsureSuccessStatusCode();
        var current = (await Get(app, chore.Id, app.Today))!;
        Assert.Null(current.MemberId); Assert.Null(current.EditDraft!.MemberId); Assert.Equal(done.CompletedAt, current.CompletedAt);
        Assert.Null((await Get(app, chore.Id, app.Today.AddDays(1)))!.MemberId);
        using var other = app.Host.CreateClient(); (await other.PostAsync("/api/demo/visit", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/chores/{chore.Id}?date={app.Today:yyyy-MM-dd}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"/api/chores/{chore.Id}/completion?date={app.Today:yyyy-MM-dd}", new CompleteChore(current.Version, false))).StatusCode);
        await using var unscoped = factory.DbContextFor(null);
        Assert.Empty(await unscoped.ChorePlans.ToArrayAsync()); Assert.Empty(await unscoped.ChoreCompletions.ToArrayAsync());
    }

    [Fact]
    public async Task Reads_cross_family_midnight_and_DST_without_materializing_or_duplicating_dates()
    {
        await using var app = await Start("2030-03-10T04:55:00Z"); var beforeMidnight = app.Today; var chore = await Add(app);
        var old = await Complete(app, chore, true);
        app.Clock.Now = DateTimeOffset.Parse("2030-03-10T05:05:00Z"); var today = app.Today;
        Assert.Equal(beforeMidnight.AddDays(1), today);
        Assert.Null((await Get(app, chore.Id, today))!.CompletedAt);
        var first = (await Get(app, chore.Id, today))!;
        app.Clock.Now = DateTimeOffset.Parse("2030-03-10T07:05:00Z");
        Assert.Equal(first.OccurrenceId, (await Get(app, chore.Id, app.Today))!.OccurrenceId);
        Assert.Equal(old.CompletedAt, (await Get(app, chore.Id, beforeMidnight))!.CompletedAt);
        await using var db = factory.DbContextFor(app.Family.Id);
        Assert.Single(await db.ChoreCompletions.Where(c => c.ChoreId == chore.Id).ToArrayAsync());
    }

    [Theory]
    [InlineData("Monthly", 1, 1)]
    [InlineData("Weekly", 0, 1)]
    [InlineData("Weekly", 53, 1)]
    [InlineData("Weekly", 1, 8)]
    [InlineData("Daily", 2, 1)]
    public async Task Invalid_schedules_are_refused_without_creating_rows(string frequency, int interval, int weekday)
    {
        await using var app = await Start();
        var request = new CreateChore(Guid.NewGuid(), "Invalid", null, null, app.Today, new(frequency, interval, [weekday]));
        Assert.Equal(HttpStatusCode.BadRequest, (await app.Client.PostAsJsonAsync("/api/chores", request)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await app.Client.PostAsJsonAsync("/api/chores", request with { Repeat = new("Weekly", 1, []) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await app.Client.PostAsJsonAsync("/api/chores", request with { Repeat = new("Daily", 1, [], app.Today.AddDays(-1)) })).StatusCode);
    }
}
