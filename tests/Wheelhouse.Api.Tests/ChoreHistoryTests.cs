using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Wheelhouse.Api.Chores;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ChoreHistoryTests(ApiFactory factory)
{
    private sealed class Clock(string instant) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.Parse(instant);
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed record Scenario(WebApplicationFactory<Program> Host, HttpClient Client, Clock Clock, FamilyResponse Family) : IAsyncDisposable
    {
        public DateOnly Today => ChoreOccurrences.Today(Family.TimeZone, Clock.Now);
        public async ValueTask DisposeAsync() { Client.Dispose(); await Host.DisposeAsync(); }
    }
    private async Task<Scenario> Start(string instant = "2030-11-03T05:30:00Z")
    {
        var clock = new Clock(instant);
        var host = factory.Demo.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<TimeProvider>(clock);
            foreach (var descriptor in services.Where(d => d.ServiceType == typeof(IHostedService)
                && d.ImplementationType?.Name == "DemoCleanupService").ToArray()) services.Remove(descriptor);
        }));
        var client = host.CreateClient();
        (await client.PostAsync("/api/demo/visit", null)).EnsureSuccessStatusCode();
        return new(host, client, clock, (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!);
    }
    private static Task<ChoresResponse?> Read(Scenario app, DateOnly from, DateOnly to) =>
        app.Client.GetFromJsonAsync<ChoresResponse>($"/api/chores/history?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}");
    private static async Task<ChoreResponse> Add(Scenario app, DateOnly day, ChoreRepeat? repeat = null, Guid? member = null)
    {
        var result = await app.Client.PostAsJsonAsync($"/api/chores?date={app.Today:yyyy-MM-dd}",
            new CreateChore(Guid.NewGuid(), "History example", null, member, day, repeat));
        result.EnsureSuccessStatusCode();
        return (await result.Content.ReadFromJsonAsync<ChoreResponse>())!;
    }
    private static async Task<ChoreResponse> Complete(Scenario app, ChoreResponse chore, bool done)
    {
        var result = await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}/completion?date={chore.DueDate:yyyy-MM-dd}", new CompleteChore(chore.Version, done));
        result.EnsureSuccessStatusCode(); return (await result.Content.ReadFromJsonAsync<ChoreResponse>())!;
    }

    [Theory]
    [InlineData("2030-03-10T04:30:00Z")]
    [InlineData("2030-03-10T07:30:00Z")]
    [InlineData("2030-11-03T05:30:00Z")]
    [InlineData("2030-11-03T06:30:00Z")]
    public async Task History_projects_independent_household_dates_across_midnight_and_DST_without_writes(string instant)
    {
        await using var app = await Start(instant);
        var start = app.Today.AddDays(-3);
        var chore = await Add(app, start, new("Daily"));
        var history = (await Read(app, start, app.Today.AddDays(1)))!;
        var rows = history.Chores.Where(c => c.Id == chore.Id).ToArray();
        Assert.Equal(4, rows.Length);
        Assert.Equal(4, rows.Select(c => c.OccurrenceId).Distinct().Count());
        Assert.All(rows.Where(c => c.DueDate < app.Today), c => Assert.True(c.Missed));
        var yesterday = rows.Single(c => c.DueDate == app.Today.AddDays(-1));
        var completed = await Complete(app, yesterday, true);
        await Complete(app, rows.Single(c => c.DueDate == app.Today), true);
        history = (await Read(app, start, app.Today.AddDays(1)))!;
        Assert.Equal(completed.CompletedAt, history.Chores.Single(c => c.Id == chore.Id && c.DueDate == yesterday.DueDate).CompletedAt);
        await Complete(app, completed, false);
        var before = (await Read(app, start, app.Today.AddDays(1)))!;
        var again = (await Read(app, start, app.Today.AddDays(1)))!;
        Assert.Equal(before.ChangeNumber, again.ChangeNumber);
        Assert.NotNull(again.Chores.Single(c => c.Id == chore.Id && c.DueDate == app.Today).CompletedAt);
        Assert.Null(again.Chores.Single(c => c.Id == chore.Id && c.DueDate == yesterday.DueDate).CompletedAt);
        await using var db = factory.DbContextFor(app.Family.Id);
        Assert.Equal(2, await db.ChoreCompletions.CountAsync(c => c.ChoreId == chore.Id));
    }

    [Fact]
    public async Task History_retains_archived_one_time_work_and_removed_assignees_with_completion_dates()
    {
        await using var app = await Start();
        var member = app.Family.Members.Last().Id;
        var chore = await Add(app, app.Today.AddDays(-2), member: member);
        var done = await Complete(app, chore, true);
        (await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}/archive", new ArchiveChore(done.Version))).EnsureSuccessStatusCode();
        (await app.Client.DeleteAsync($"/api/family/members/{member}")).EnsureSuccessStatusCode();
        var history = (await Read(app, app.Today.AddDays(-3), app.Today.AddDays(1)))!;
        var row = Assert.Single(history.Chores, c => c.Id == chore.Id);
        Assert.True(row.Archived); Assert.Null(row.MemberId);
        Assert.Equal(done.CompletedAt, row.CompletedAt); Assert.Equal(chore.DueDate, row.DueDate);
        Assert.DoesNotContain((await Read(app, app.Today, app.Today.AddDays(1)))!.Chores, c => c.Id == chore.Id);
        var daily = (await app.Client.GetFromJsonAsync<ChoresResponse>($"/api/chores?date={app.Today:yyyy-MM-dd}"))!;
        Assert.DoesNotContain(daily.Chores, c => c.Id == chore.Id);
    }

    [Fact]
    public async Task Stopped_repeats_keep_earlier_history_and_end_at_the_stop_date()
    {
        await using var app = await Start();
        var today = app.Today;
        var chore = await Add(app, today.AddDays(-3), new("Daily"));
        (await app.Client.PutAsJsonAsync($"/api/chores/{chore.Id}/archive", new ArchiveChore(chore.DefinitionVersion!.Value))).EnsureSuccessStatusCode();
        var rows = (await Read(app, today.AddDays(-3), today.AddDays(1)))!.Chores.Where(c => c.Id == chore.Id).ToArray();
        Assert.Equal(4, rows.Length);
        Assert.All(rows, c => Assert.True(c.SeriesArchived));
        // Model a definition stopped earlier, while keeping the demo cookie's clock stable.
        await using (var db = factory.DbContextFor(app.Family.Id))
        {
            var row = await db.Chores.SingleAsync(c => c.Id == chore.Id);
            row.ArchivedFrom = today.AddDays(-1);
            await db.SaveChangesAsync();
        }
        var stopped = (await Read(app, today.AddDays(-3), today.AddDays(1)))!.Chores.Where(c => c.Id == chore.Id).ToArray();
        Assert.Equal(2, stopped.Length); Assert.All(stopped, c => Assert.True(c.DueDate < today.AddDays(-1)));
        var past = stopped.Last();
        await Complete(app, past, true);
        Assert.NotNull((await Read(app, past.DueDate, past.DueDate.AddDays(1)))!.Chores.Single(c => c.Id == chore.Id).CompletedAt);
    }

    [Fact]
    public async Task History_is_family_private_and_a_paired_wall_can_read_it_without_management_access()
    {
        await using var app = await Start();
        var chore = await Add(app, app.Today);
        using var stranger = app.Host.CreateClient();
        var url = $"/api/chores/history?from={app.Today:yyyy-MM-dd}&to={app.Today.AddDays(1):yyyy-MM-dd}";
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync(url)).StatusCode);
        using var other = app.Host.CreateClient();
        (await other.PostAsync("/api/demo/visit", null)).EnsureSuccessStatusCode();
        Assert.DoesNotContain((await other.GetFromJsonAsync<ChoresResponse>(url))!.Chores, c => c.Id == chore.Id);
        using var wall = app.Host.CreateClient();
        var code = (await (await wall.PostAsync("/api/pairing", null)).Content.ReadFromJsonAsync<PairingResponse>())!;
        (await app.Client.PostAsJsonAsync("/api/devices", new PairDisplayRequest(code.Code, "Kitchen history"))).EnsureSuccessStatusCode();
        (await wall.PostAsync($"/api/pairing/{code.Id}/finish", null)).EnsureSuccessStatusCode();
        var history = (await wall.GetFromJsonAsync<ChoresResponse>(url))!;
        Assert.False(history.CanManage); Assert.Contains(history.Chores, c => c.Id == chore.Id);
    }

    [Fact]
    public async Task History_rejects_unbounded_reversed_empty_and_future_ranges()
    {
        await using var app = await Start();
        foreach (var (from, to) in new[] { (app.Today, app.Today), (app.Today, app.Today.AddDays(-1)),
            (app.Today.AddDays(-31), app.Today.AddDays(1)), (app.Today, app.Today.AddDays(2)) })
            Assert.Equal(HttpStatusCode.BadRequest, (await app.Client.GetAsync($"/api/chores/history?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}")).StatusCode);
        Assert.NotNull(await Read(app, app.Today.AddDays(-30), app.Today.AddDays(1)));
    }
}
