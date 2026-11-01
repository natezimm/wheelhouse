using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Health;

namespace Wheelhouse.Api.Tests;

/// <summary>Keeping the cached events in step with the family's Google calendars, against <see cref="FakeGoogle"/>.</summary>
[Collection(ApiCollection.Name)]
public sealed class CalendarSyncTests(ApiFactory factory)
{
    private static readonly GoogleIdentity Alex = new("google-alex", "alex@example.com", EmailVerified: true, "Alex", "Alex Rivera");

    private static readonly DateTimeOffset Soon = new(DateTimeOffset.UtcNow.Date.AddDays(2).AddHours(15), TimeSpan.Zero);

    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static GoogleEvent Timed(string id, string title, DateTimeOffset startsAt, string? series = null) =>
        new(id, series, title, Location: null, startsAt, startsAt.AddHours(1), null, null);

    private static GoogleEvent AllDay(string id, string title, DateOnly day) =>
        new(id, null, title, Location: null, null, null, day, day.AddDays(1));

    /// <summary>A family connected to Google, showing Alex's calendar as Alex's and the family calendar as everyone's.</summary>
    private async Task<GoogleFamily> ConnectedAsync(bool syncWorker = false)
    {
        var family = await GoogleFamily.StartAsync(factory, Alex, syncWorker);
        await GoogleFamily.ConnectAsync(family.Parent);
        var alex = (await family.FamilyAsync()).Members.Single().Id;
        (await family.Parent.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest(
        [
            new CalendarChoiceRequest("alex-cal", alex),
            new CalendarChoiceRequest("family-cal", null),
        ]), ApiFactory.Json)).EnsureSuccessStatusCode();
        return family;
    }

    /// <summary>The next week or so of the family's calendar, as the screens read it.</summary>
    private static async Task<CalendarResponse> CalendarOf(HttpClient client) =>
        (await client.GetFromJsonAsync<CalendarResponse>(
            $"/api/calendar?from={Today.AddDays(-1):yyyy-MM-dd}&to={Today.AddDays(8):yyyy-MM-dd}", ApiFactory.Json))!;

    [Fact]
    public async Task The_first_sync_brings_in_each_calendars_events_as_its_owners()
    {
        await using var family = await ConnectedAsync();
        family.Google.Put("alex-cal", Timed("swim_1", "Swim practice", Soon, series: "swim"));
        family.Google.Put("family-cal", AllDay("fair", "County fair", Today.AddDays(3)));
        family.Google.Put("holidays", AllDay("not-shown", "A calendar nobody chose", Today.AddDays(3)));

        Assert.True(await family.SyncAsync());

        var calendar = await CalendarOf(family.Parent);
        var alex = (await family.FamilyAsync()).Members.Single().Id;
        Assert.Equal(
            [("Swim practice", (Guid?)alex, false), ("County fair", null, true)],
            calendar.Events.Select(e => (e.Title, e.MemberId, e.AllDay)).OrderBy(e => e.AllDay));
        Assert.Equal(Soon, calendar.Events.Single(e => !e.AllDay).StartsAt);
        Assert.False(calendar.NeedsReconnect);

        var (_, from, to) = family.Google.Listed.First();
        Assert.InRange(DateTimeOffset.UtcNow - from, CalendarSync.Behind - TimeSpan.FromMinutes(1), CalendarSync.Behind + TimeSpan.FromMinutes(1));
        Assert.Equal(CalendarSync.Behind + CalendarSync.Ahead, to - from);
    }

    [Fact]
    public async Task The_calendar_says_which_days_the_sync_window_holds()
    {
        await using var family = await ConnectedAsync();
        Assert.Null((await CalendarOf(family.Parent)).SyncedTo);

        await family.SyncAsync();

        // The family's zone is UTC here; the partly read first day is left out.
        var calendar = await CalendarOf(family.Parent);
        Assert.Equal(Today.AddDays(-CalendarSync.Behind.Days + 1), calendar.SyncedFrom);
        Assert.Equal(Today.AddDays(CalendarSync.Ahead.Days), calendar.SyncedTo);
    }

    [Fact]
    public void The_window_is_the_days_every_calendar_has_read_in_the_familys_zone()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        var early = new DateTimeOffset(2026, 3, 1, 3, 0, 0, TimeSpan.Zero); // Feb 28, 10 PM in New York
        var late = early.AddDays(2);

        var window = CalendarSync.Window([late, early], zone)!.Value;

        Assert.Equal(DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(late - CalendarSync.Behind, zone).DateTime).AddDays(1), window.From);
        Assert.Equal(DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(early + CalendarSync.Ahead, zone).DateTime), window.To);
        Assert.Null(CalendarSync.Window([], zone));
    }

    [Fact]
    public async Task Changes_made_in_google_reach_the_screens_on_the_next_sync()
    {
        await using var family = await ConnectedAsync();
        family.Google.Put("alex-cal", Timed("swim", "Swim practice", Soon));
        family.Google.Put("alex-cal", Timed("dentist", "Dentist", Soon.AddDays(1)));
        await family.SyncAsync();
        var before = await CalendarOf(family.Parent);

        family.Google.Put("alex-cal", Timed("swim", "Swim meet", Soon.AddHours(1)));
        family.Google.Remove("alex-cal", "dentist");
        family.Google.Put("alex-cal", AllDay("trip", "Field trip", Today.AddDays(4)));
        await family.SyncAsync();
        var after = await CalendarOf(family.Parent);

        Assert.Equal(["Field trip", "Swim meet"], after.Events.Select(e => e.Title).Order());
        var swim = after.Events.Single(e => e.Title == "Swim meet");
        Assert.Equal(Soon.AddHours(1), swim.StartsAt);
        // An event that changed keeps its row.
        Assert.Equal(before.Events.Single(e => e.Title == "Swim practice").Id, swim.Id);
    }

    [Fact]
    public async Task A_calendar_with_no_changes_is_not_read_again_until_its_window_has_moved_a_day()
    {
        await using var family = await ConnectedAsync();
        var time = new ManualTime(DateTimeOffset.UtcNow);

        await family.SyncAsync(time);
        var afterFirst = family.Google.Listed.Count;
        time.Advance(TimeSpan.FromHours(2));
        await family.SyncAsync(time);
        var afterQuiet = family.Google.Listed.Count;
        time.Advance(CalendarSync.ListEvery);
        await family.SyncAsync(time);

        Assert.Equal(2, afterFirst);
        Assert.Equal(afterFirst, afterQuiet);
        Assert.Equal(afterFirst + 2, family.Google.Listed.Count);
    }

    [Fact]
    public async Task When_google_invalidates_a_sync_token_the_calendar_is_read_in_full()
    {
        await using var family = await ConnectedAsync();
        await family.SyncAsync();
        family.Google.Expired.Add(family.Google.SyncTokenOf("alex-cal"));
        family.Google.Put("alex-cal", Timed("swim", "Swim practice", Soon));

        Assert.True(await family.SyncAsync());

        Assert.Equal(["Swim practice"], (await CalendarOf(family.Parent)).Events.Select(e => e.Title));
    }

    [Fact]
    public async Task A_refused_grant_keeps_the_events_and_tells_the_screens_to_ask_a_parent_to_reconnect()
    {
        await using var family = await ConnectedAsync();
        family.Google.Put("alex-cal", Timed("swim", "Swim practice", Soon));
        await family.SyncAsync();
        family.Google.Revoked = true;

        Assert.False(await family.SyncAsync());

        var calendar = await CalendarOf(family.Parent);
        Assert.True(calendar.NeedsReconnect);
        Assert.Equal(["Swim practice"], calendar.Events.Select(e => e.Title));
        var connection = await family.Parent.GetFromJsonAsync<GoogleConnectionResponse>("/api/calendar/google", ApiFactory.Json);
        Assert.Equal(GoogleConnectionStatus.NeedsReauth, connection!.Status);
    }

    private static async Task<HealthResponse> HealthOf(GoogleFamily family)
    {
        using var client = family.WithFake.CreateClient();
        var response = await client.GetAsync("/health");
        // Degraded still serves; only a broken API answers 503.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<HealthResponse>())!;
    }

    [Fact]
    public async Task Health_stays_degraded_while_a_connection_needs_reconnecting()
    {
        await using var family = await ConnectedAsync();
        await family.SyncAsync();
        Assert.Equal("Healthy", (await HealthOf(family)).Checks["calendar"]);
        family.Google.Revoked = true;

        await family.SyncAsync();
        // Later passes skip the connection, which must not make it look fixed.
        await family.SyncAsync();

        var health = await HealthOf(family);
        Assert.Equal(("Degraded", "Degraded"), (health.Status, health.Checks["calendar"]));
    }

    [Fact]
    public async Task Health_says_so_when_a_calendar_has_stopped_syncing()
    {
        await using var family = await ConnectedAsync();
        await family.SyncAsync(new ManualTime(DateTimeOffset.UtcNow - TimeSpan.FromHours(1)));
        family.Google.Gone.Add("alex-cal");

        // The other calendar syncs, but Alex's keeps its old sync time.
        Assert.True(await family.SyncAsync());

        Assert.Equal("Degraded", (await HealthOf(family)).Checks["calendar"]);
        family.Google.Gone.Clear();
        await family.SyncAsync();
        Assert.Equal("Healthy", (await HealthOf(family)).Checks["calendar"]);
    }

    [Fact]
    public async Task A_calendar_the_account_can_no_longer_see_does_not_stop_the_others()
    {
        await using var family = await ConnectedAsync();
        family.Google.Put("alex-cal", Timed("swim", "Swim practice", Soon));
        family.Google.Put("family-cal", AllDay("fair", "County fair", Today.AddDays(3)));
        family.Google.Gone.Add("alex-cal");

        Assert.True(await family.SyncAsync());

        Assert.Equal(["County fair"], (await CalendarOf(family.Parent)).Events.Select(e => e.Title));
    }

    [Fact]
    public async Task Choosing_calendars_asks_for_a_sync_straight_away()
    {
        await using var family = await ConnectedAsync();
        var trigger = family.WithFake.Services.GetRequiredService<CalendarSyncTrigger>();

        // Connecting asked once, and saving the choices once more.
        var familyId = (await family.FamilyAsync()).Id;
        Assert.Equal(familyId, await trigger.WaitAsync(TimeSpan.FromSeconds(5), TimeProvider.System, CancellationToken.None));
        Assert.Equal(familyId, await trigger.WaitAsync(TimeSpan.FromSeconds(5), TimeProvider.System, CancellationToken.None));
        Assert.Null(await trigger.WaitAsync(TimeSpan.FromMilliseconds(50), TimeProvider.System, CancellationToken.None));
    }

    [Fact]
    public async Task On_a_family_instance_the_worker_syncs_as_soon_as_calendars_are_chosen()
    {
        await using var family = await ConnectedAsync(syncWorker: true);
        family.Google.Put("alex-cal", Timed("swim", "Swim practice", Soon));
        // The change is the fake's own, so ask again rather than wait out the interval.
        family.WithFake.Services.GetRequiredService<CalendarSyncTrigger>().SyncSoon((await family.FamilyAsync()).Id);

        var shown = false;
        for (var attempt = 0; attempt < 50 && !shown; attempt++)
        {
            await Task.Delay(100);
            shown = (await CalendarOf(family.Parent)).Events.Any(e => e.Title == "Swim practice");
        }

        Assert.True(shown);
    }

    [Fact]
    public async Task Only_visible_sync_changes_advance_the_calendar_number()
    {
        await using var family = await ConnectedAsync();
        var before = (await CalendarOf(family.Parent)).ChangeNumber;
        var time = new ManualTime(DateTimeOffset.UtcNow);
        await family.SyncAsync(time);
        Assert.Equal(before, (await CalendarOf(family.Parent)).ChangeNumber);

        var swim = Timed("swim", "Swim practice", Soon);
        family.Google.Put("alex-cal", swim);
        await family.SyncAsync(time);
        Assert.Equal(before + 1, (await CalendarOf(family.Parent)).ChangeNumber);

        await family.SyncAsync(time);
        // A new Google etag with the same event fields is only bookkeeping, too.
        family.Google.Put("alex-cal", swim);
        await family.SyncAsync(time);
        time.Advance(CalendarSync.ListEvery);
        await family.SyncAsync(time);
        Assert.Equal(before + 1, (await CalendarOf(family.Parent)).ChangeNumber);

        family.Google.Put("alex-cal", swim with { Title = "Swim meet" });
        await family.SyncAsync(time);
        Assert.Equal(before + 2, (await CalendarOf(family.Parent)).ChangeNumber);
        family.Google.Remove("alex-cal", "swim");
        await family.SyncAsync(time);
        Assert.Equal(before + 3, (await CalendarOf(family.Parent)).ChangeNumber);

        family.Google.Revoked = true;
        Assert.False(await family.SyncAsync(time));
        var revoked = await CalendarOf(family.Parent);
        Assert.Equal(before + 4, revoked.ChangeNumber);
        Assert.True(revoked.NeedsReconnect);
        Assert.False(await family.SyncAsync(time));
        Assert.Equal(revoked.ChangeNumber, (await CalendarOf(family.Parent)).ChangeNumber);
    }

    [Fact]
    public async Task The_demo_never_needs_reconnecting()
    {
        using var visitor = await factory.DemoVisitorAsync();

        Assert.False((await CalendarOf(visitor)).NeedsReconnect);
    }

    private sealed class ManualTime(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;
    }
}
