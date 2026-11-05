using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Data;
using Wheelhouse.Api.Health;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Google failing in each way the sync has to live through: asking to slow down, refusing the
/// connection, failing for one calendar of several, failing part way through a read, and the
/// worker missing passes for days. In every case the cache keeps whole answers only, the screens
/// keep showing what they had, and the next pass that works catches up.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class GoogleFailureTests(ApiFactory factory)
{
    private static readonly GoogleIdentity Alex = new("google-alex", "alex@example.com", EmailVerified: true, "Alex", "Alex Rivera");

    private static readonly DateTimeOffset Soon = new(DateTimeOffset.UtcNow.Date.AddDays(2).AddHours(15), TimeSpan.Zero);

    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static GoogleEvent Timed(string id, string title, DateTimeOffset startsAt, string? series = null) =>
        new(id, series, title, Location: null, startsAt, startsAt.AddHours(1), null, null);

    private static HttpRequestException ServerError() => new("Google answered 500.", null, HttpStatusCode.InternalServerError);

    private static HttpRequestException Unauthorized() => new("Google answered 401.", null, HttpStatusCode.Unauthorized);

    /// <summary>A family connected to Google showing Alex's calendar and the family calendar, each with an event, synced once.</summary>
    private async Task<GoogleFamily> SyncedAsync(TimeProvider? time = null)
    {
        var family = await GoogleFamily.StartAsync(factory, Alex);
        await GoogleFamily.ConnectAsync(family.Parent);
        var alex = (await family.FamilyAsync()).Members.Single().Id;
        (await family.Parent.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest(
        [
            new CalendarChoiceRequest("alex-cal", alex),
            new CalendarChoiceRequest("family-cal", null),
        ]), ApiFactory.Json)).EnsureSuccessStatusCode();
        family.Google.Put("alex-cal", Timed("swim", "Swim practice", Soon));
        family.Google.Put("family-cal", Timed("dinner", "Family dinner", Soon.AddHours(3)));
        Assert.True(await family.SyncAsync(time));
        return family;
    }

    private static async Task<CalendarResponse> CalendarOf(HttpClient client) =>
        (await client.GetFromJsonAsync<CalendarResponse>(
            $"/api/calendar?from={Today.AddDays(-1):yyyy-MM-dd}&to={Today.AddDays(8):yyyy-MM-dd}", ApiFactory.Json))!;

    private static async Task<string[]> TitlesOf(GoogleFamily family) =>
        [.. (await CalendarOf(family.Parent)).Events.Select(e => e.Title).Order()];

    /// <summary>Each chosen calendar's sync token and last sync, as the database has them.</summary>
    private static async Task<Dictionary<string, (string? SyncToken, DateTimeOffset? LastSyncedAt)>> SourcesOf(GoogleFamily family)
    {
        var familyId = (await family.FamilyAsync()).Id;
        await using var scope = family.WithFake.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>();
        return await db.CalendarSources.IgnoreQueryFilters().Where(s => s.FamilyId == familyId)
            .ToDictionaryAsync(s => s.GoogleCalendarId, s => (s.SyncToken, s.LastSyncedAt));
    }

    private static async Task<string> CalendarHealthOf(GoogleFamily family)
    {
        using var client = family.WithFake.CreateClient();
        var response = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<HealthResponse>())!.Checks["calendar"];
    }

    [Fact]
    public async Task Google_asking_to_slow_down_stops_the_pass_and_keeps_every_cached_event()
    {
        await using var family = await SyncedAsync();
        family.Google.Put("alex-cal", Timed("swim", "Swim meet", Soon));
        family.Google.Put("family-cal", Timed("movie", "Movie night", Soon.AddDays(1)));
        var before = await SourcesOf(family);
        family.Google.Calls.Clear();
        family.Google.Faults.Add(("changes", "alex-cal", new GoogleRateLimitedException(TimeSpan.FromMinutes(5))));

        var refused = await Assert.ThrowsAsync<GoogleRateLimitedException>(() => family.SyncAsync());

        Assert.Equal(TimeSpan.FromMinutes(5), refused.RetryAfter);
        Assert.Equal(["Family dinner", "Swim practice"], await TitlesOf(family));
        // The other calendar would be refused too, so it is not asked; neither calendar's sync token moves.
        Assert.DoesNotContain(family.Google.Calls, call => call.CalendarId == "family-cal");
        Assert.Equal(before, await SourcesOf(family));

        Assert.True(await family.SyncAsync());
        Assert.Equal(["Family dinner", "Movie night", "Swim meet"], await TitlesOf(family));
    }

    [Fact]
    public async Task One_calendar_failing_does_not_hold_up_the_others_and_catches_up_next_pass()
    {
        await using var family = await SyncedAsync();
        family.Google.Put("alex-cal", Timed("swim", "Swim meet", Soon));
        family.Google.Put("family-cal", Timed("movie", "Movie night", Soon.AddDays(1)));
        var before = await SourcesOf(family);
        // Alex's calendar comes first and fails; the family calendar after it still syncs.
        family.Google.Faults.Add(("list", "alex-cal", ServerError()));

        var failed = await Assert.ThrowsAsync<HttpRequestException>(() => family.SyncAsync());

        Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        Assert.Equal(["Family dinner", "Movie night", "Swim practice"], await TitlesOf(family));
        var after = await SourcesOf(family);
        Assert.Equal(before["alex-cal"], after["alex-cal"]);
        Assert.NotEqual(before["family-cal"].SyncToken, after["family-cal"].SyncToken);

        Assert.True(await family.SyncAsync());
        Assert.Equal(["Family dinner", "Movie night", "Swim meet"], await TitlesOf(family));
    }

    [Fact]
    public async Task Several_calendars_failing_are_all_reported()
    {
        await using var family = await SyncedAsync();
        family.Google.Put("alex-cal", Timed("swim", "Swim meet", Soon));
        family.Google.Put("family-cal", Timed("movie", "Movie night", Soon.AddDays(1)));
        family.Google.Faults.Add(("changes", "alex-cal", ServerError()));
        family.Google.Faults.Add(("list", "family-cal", new TaskCanceledException("Google took longer than 20 seconds.")));

        var failed = await Assert.ThrowsAsync<AggregateException>(() => family.SyncAsync());

        Assert.Equal(2, failed.InnerExceptions.Count);
        Assert.Equal(["Family dinner", "Swim practice"], await TitlesOf(family));
    }

    [Fact]
    public async Task A_read_that_fails_part_way_leaves_the_calendar_as_it_was_and_is_read_again()
    {
        await using var family = await SyncedAsync();
        // The events are read, but asking for the new series' rule fails: nothing half-read is kept.
        family.Google.PutSeries("alex-cal", Timed("piano", "Piano lesson", Soon.AddHours(5)), "RRULE:FREQ=WEEKLY", "UTC");
        family.Google.Remove("alex-cal", "swim");
        var before = await SourcesOf(family);
        var changeNumber = (await CalendarOf(family.Parent)).ChangeNumber;
        family.Google.Faults.Add(("get", "alex-cal", ServerError()));

        await Assert.ThrowsAsync<HttpRequestException>(() => family.SyncAsync());

        var calendar = await CalendarOf(family.Parent);
        Assert.Equal(["Family dinner", "Swim practice"], calendar.Events.Select(e => e.Title).Order());
        Assert.Equal(changeNumber, calendar.ChangeNumber);
        Assert.Equal(before["alex-cal"], (await SourcesOf(family))["alex-cal"]);

        Assert.True(await family.SyncAsync());
        var caughtUp = await CalendarOf(family.Parent);
        Assert.Equal(["Family dinner", "Piano lesson"], caughtUp.Events.Select(e => e.Title).Order());
        Assert.Equal("RRULE:FREQ=WEEKLY", caughtUp.Events.Single(e => e.Title == "Piano lesson").Recurrence);
    }

    [Fact]
    public async Task Google_unreachable_for_a_token_is_tried_again_and_never_asks_a_parent_to_reconnect()
    {
        await using var family = await SyncedAsync();
        family.Google.Faults.Add(("token", null, new HttpRequestException("No route to Google.")));

        await Assert.ThrowsAsync<HttpRequestException>(() => family.SyncAsync());

        var calendar = await CalendarOf(family.Parent);
        Assert.False(calendar.NeedsReconnect);
        Assert.Equal(["Family dinner", "Swim practice"], calendar.Events.Select(e => e.Title).Order());
        Assert.True(await family.SyncAsync());
    }

    [Fact]
    public async Task An_access_token_refused_part_way_stops_the_pass_and_the_next_pass_learns_the_grant_was_revoked()
    {
        await using var family = await SyncedAsync();
        family.Google.Put("family-cal", Timed("movie", "Movie night", Soon.AddDays(1)));
        family.Google.Calls.Clear();
        // The grant is revoked in Google while the pass runs: the token it got first stops working.
        family.Google.Faults.Add(("changes", "alex-cal", Unauthorized()));

        var refused = await Assert.ThrowsAsync<HttpRequestException>(() => family.SyncAsync());

        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
        Assert.DoesNotContain(family.Google.Calls, call => call.CalendarId == "family-cal");
        Assert.False((await CalendarOf(family.Parent)).NeedsReconnect);

        family.Google.Revoked = true;
        Assert.False(await family.SyncAsync());
        var calendar = await CalendarOf(family.Parent);
        Assert.True(calendar.NeedsReconnect);
        Assert.Equal(["Family dinner", "Swim practice"], calendar.Events.Select(e => e.Title).Order());

        // Once a parent connects again, the first pass brings in what changed meanwhile.
        family.Google.Revoked = false;
        Assert.Equal(HttpStatusCode.Redirect, (await GoogleFamily.ConnectAsync(family.Parent, code: "again")).StatusCode);
        Assert.True(await family.SyncAsync());
        calendar = await CalendarOf(family.Parent);
        Assert.False(calendar.NeedsReconnect);
        Assert.Equal(["Family dinner", "Movie night", "Swim practice"], calendar.Events.Select(e => e.Title).Order());
    }

    [Fact]
    public async Task After_days_without_a_pass_one_pass_catches_up_and_health_said_so_meanwhile()
    {
        var then = DateTimeOffset.UtcNow - TimeSpan.FromDays(10);
        await using var family = await SyncedAsync(new FixedTime(then));
        Assert.Equal("Degraded", await CalendarHealthOf(family));
        // While no pass ran, Google changed things and let the old sync token lapse.
        family.Google.Expired.Add(family.Google.SyncTokenOf("alex-cal"));
        family.Google.Remove("alex-cal", "swim");
        family.Google.Put("alex-cal", Timed("dentist", "Dentist", Soon.AddDays(1)));
        family.Google.Listed.Clear();

        Assert.True(await family.SyncAsync());

        Assert.Equal(["Dentist", "Family dinner"], await TitlesOf(family));
        // Both calendars were read in full for a window around today, not around the last pass.
        Assert.Equal(["alex-cal", "family-cal"], family.Google.Listed.Select(l => l.CalendarId).Order());
        Assert.All(family.Google.Listed, listed =>
            Assert.InRange(DateTimeOffset.UtcNow - CalendarSync.Behind - listed.From, TimeSpan.FromMinutes(-1), TimeSpan.FromMinutes(1)));
        Assert.Equal("Healthy", await CalendarHealthOf(family));
    }

    [Fact]
    public async Task A_calendar_that_never_synced_is_reported_once_the_connection_is_old_enough()
    {
        await using var family = await GoogleFamily.StartAsync(factory, Alex);
        await GoogleFamily.ConnectAsync(family.Parent);
        (await family.Parent.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest(
            [new CalendarChoiceRequest("family-cal", null)]), ApiFactory.Json)).EnsureSuccessStatusCode();
        Assert.Equal("Healthy", await CalendarHealthOf(family));

        var familyId = (await family.FamilyAsync()).Id;
        await using (var scope = family.WithFake.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<WheelhouseDbContext>();
            await db.GoogleConnections.IgnoreQueryFilters().Where(c => c.FamilyId == familyId)
                .ExecuteUpdateAsync(c => c.SetProperty(x => x.ConnectedAt, DateTimeOffset.UtcNow - TimeSpan.FromHours(1)));
        }

        Assert.Equal("Degraded", await CalendarHealthOf(family));
        Assert.True(await family.SyncAsync());
        Assert.Equal("Healthy", await CalendarHealthOf(family));
    }

    [Fact]
    public async Task A_change_google_refuses_for_quota_keeps_the_calendar_writable()
    {
        await using var family = await SyncedAsync();
        var swim = (await CalendarOf(family.Parent)).Events.Single(e => e.Title == "Swim practice");
        var day = DateOnly.FromDateTime(Soon.UtcDateTime);
        family.Google.Faults.Add(("patch", "alex-cal", new GoogleRateLimitedException(null)));

        var refused = await family.Parent.PutAsJsonAsync($"/api/calendar/events/{swim.Id}",
            new EventRequest(swim.CalendarId, "Swim meet", null, false, day, new(15, 0), day, new(16, 0)), ApiFactory.Json);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
        var calendar = await CalendarOf(family.Parent);
        Assert.True(calendar.Calendars.Single(c => c.Id == swim.CalendarId).CanWrite);
        Assert.Equal(swim.Title, calendar.Events.Single(e => e.Id == swim.Id).Title);

        var saved = await family.Parent.PutAsJsonAsync($"/api/calendar/events/{swim.Id}",
            new EventRequest(swim.CalendarId, "Swim meet", null, false, day, new(15, 0), day, new(16, 0)), ApiFactory.Json);
        saved.EnsureSuccessStatusCode();
    }

    [Fact]
    public void Each_failure_in_a_row_doubles_the_wait_and_google_is_never_asked_sooner_than_it_said()
    {
        var time = new FixedTime(DateTimeOffset.UtcNow);
        var interval = TimeSpan.FromMinutes(2);
        var backoff = new CalendarSyncBackoff(time, Options.Create(new CalendarSyncOptions { Interval = interval }));
        var family = Guid.NewGuid();
        var other = Guid.NewGuid();

        Assert.False(backoff.IsWaiting(family));
        backoff.Failed(family, new HttpRequestException("Google answered 500."));
        Assert.Equal(time.Now + interval, backoff.NotBefore(family));
        backoff.Failed(family, new HttpRequestException("Google answered 500."));
        Assert.Equal(time.Now + 2 * interval, backoff.NotBefore(family));
        Assert.True(backoff.IsWaiting(family));
        Assert.False(backoff.IsWaiting(other));

        // Google asking to slow down doubles it once more, and what Google asked for wins when longer.
        backoff.Failed(family, new GoogleRateLimitedException(null));
        Assert.Equal(time.Now + 8 * interval, backoff.NotBefore(family));
        backoff.Failed(other, new GoogleRateLimitedException(TimeSpan.FromMinutes(20)));
        Assert.Equal(time.Now + TimeSpan.FromMinutes(20), backoff.NotBefore(other));

        for (var i = 0; i < 20; i++)
        {
            backoff.Failed(family, new HttpRequestException("Google answered 500."));
        }

        Assert.Equal(time.Now + CalendarSyncBackoff.Longest, backoff.NotBefore(family));
        time.Now += CalendarSyncBackoff.Longest;
        Assert.False(backoff.IsWaiting(family));

        backoff.Succeeded(family);
        Assert.Null(backoff.NotBefore(family));
        backoff.Failed(family, new HttpRequestException("Google answered 500."));
        Assert.Equal(time.Now + interval, backoff.NotBefore(family));
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }
}
