using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class OptimisticCalendarTests(ApiFactory factory)
{
    private static readonly DateOnly Day = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(2);

    private static async Task<CalendarResponse> CalendarOf(HttpClient client) =>
        (await client.GetFromJsonAsync<CalendarResponse>($"/api/calendar?from={Day:yyyy-MM-dd}&to={Day.AddDays(20):yyyy-MM-dd}", ApiFactory.Json))!;

    private static async Task<EventResponse> Add(HttpClient client, EventRequest request)
    {
        var response = await client.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
    }

    [Theory]
    [InlineData(EventRepeat.Never)]
    [InlineData(EventRepeat.Weekly)]
    public async Task Concurrent_retries_create_once_and_advance_the_revision_once(EventRepeat repeat)
    {
        using var visitor = await factory.DemoVisitorAsync();
        var before = await CalendarOf(visitor);
        var creationId = Guid.NewGuid();
        var request = new EventRequest(before.Calendars[0].Id, "Optimistic retry test", null, true, Day, null, Day.AddDays(1), null, repeat, creationId);
        var results = await Task.WhenAll(Add(visitor, request), Add(visitor, request));
        Assert.Equal(results[0].Id, results[1].Id);
        Assert.All(results, e => Assert.Equal(creationId, e.CreationId));
        var after = await CalendarOf(visitor);
        Assert.Equal(before.ChangeNumber + 1, after.ChangeNumber);
        var events = after.Events.Where(e => e.CreationId == creationId).ToList();
        Assert.Equal(repeat == EventRepeat.Never ? 1 : 3, events.Count);
        if (repeat != EventRepeat.Never)
        {
            var seriesId = results[0].SeriesId;
            Assert.NotNull(seriesId);
            Assert.All(events, e => Assert.Equal(seriesId, e.SeriesId));
        }
        Assert.Equal(after.ChangeNumber, (await CalendarOf(visitor)).ChangeNumber);
    }

    [Fact]
    public async Task Creation_keys_are_scoped_to_the_authenticated_family()
    {
        using var first = await factory.DemoVisitorAsync();
        using var second = await factory.DemoVisitorAsync();
        var id = Guid.NewGuid();
        var a = await CalendarOf(first);
        var b = await CalendarOf(second);
        EventRequest Request(Guid calendar) => new(calendar, "Private retry", null, true, Day, null, Day.AddDays(1), null, CreationId: id);
        var one = await Add(first, Request(a.Calendars[0].Id));
        var two = await Add(second, Request(b.Calendars[0].Id));
        Assert.NotEqual(one.Id, two.Id);
        Assert.DoesNotContain((await CalendarOf(first)).Events, e => e.Id == two.Id);
        Assert.DoesNotContain((await CalendarOf(second)).Events, e => e.Id == one.Id);
    }

    [Theory]
    [InlineData(EventRepeat.Never)]
    [InlineData(EventRepeat.Weekly)]
    public async Task A_retry_after_google_succeeded_but_the_cache_was_lost_reuses_the_original_event(EventRepeat repeat)
    {
        await using var family = await GoogleFamily.StartAsync(factory,
            new Wheelhouse.Api.Auth.GoogleIdentity("optimistic-parent", "optimistic@example.com", true, "Alex", "Alex Rivera"));
        await GoogleFamily.ConnectAsync(family.Parent);
        (await family.Parent.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest([new CalendarChoiceRequest("alex-cal", null)]), ApiFactory.Json)).EnsureSuccessStatusCode();
        var calendar = (await CalendarOf(family.Parent)).Calendars.First(c => c.CanWrite);
        var request = new EventRequest(calendar.Id, "Lost response test", null, true, Day, null, Day.AddDays(1), null, repeat, Guid.NewGuid());
        var added = await Add(family.Parent, request);
        var familyId = (await family.FamilyAsync()).Id;
        // Simulate loss of the cache transaction after Google's durable insert.
        await using (var db = factory.DbContextFor(familyId))
        {
            var rows = await db.EventInstances.Where(e => e.CalendarSourceId == calendar.Id).ToListAsync();
            db.EventInstances.RemoveRange(rows);
            await db.SaveChangesAsync();
        }
        var replay = await Add(family.Parent, request);
        Assert.Equal(added.CreationId, replay.CreationId);
        Assert.Single(family.Google.Writes, w => w.Change == "insert");
        var after = await CalendarOf(family.Parent);
        Assert.Equal(repeat == EventRepeat.Never ? 1 : 3, after.Events.Count(e => e.CreationId == added.CreationId));
    }

    [Fact]
    public async Task A_refused_create_still_commits_the_google_reconnect_status()
    {
        await using var family = await GoogleFamily.StartAsync(factory,
            new Wheelhouse.Api.Auth.GoogleIdentity("revoked-optimistic-parent", "revoked-optimistic@example.com", true, "Alex", "Alex Rivera"));
        await GoogleFamily.ConnectAsync(family.Parent);
        (await family.Parent.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest([new CalendarChoiceRequest("alex-cal", null)]), ApiFactory.Json)).EnsureSuccessStatusCode();
        var calendar = (await CalendarOf(family.Parent)).Calendars.First();
        family.Google.Revoked = true;
        var request = new EventRequest(calendar.Id, "Refused create", null, true, Day, null, Day.AddDays(1), null, CreationId: Guid.NewGuid());
        var response = await family.Parent.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.True((await CalendarOf(family.Parent)).NeedsReconnect);
        Assert.Empty(family.Google.Writes);
    }

    [Fact]
    public async Task A_series_keeps_its_opaque_identifier_when_moved_to_another_calendar()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var calendars = (await CalendarOf(visitor)).Calendars;
        var request = new EventRequest(calendars[0].Id, "Stable series test", null, true, Day, null, Day.AddDays(1), null, EventRepeat.Weekly, Guid.NewGuid());
        var added = await Add(visitor, request);
        var response = await visitor.PutAsJsonAsync($"/api/calendar/events/{added.Id}?series=true", request with { CalendarId = calendars[1].Id }, ApiFactory.Json);
        response.EnsureSuccessStatusCode();
        var changed = (await response.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
        Assert.NotNull(added.SeriesId);
        Assert.Equal(added.SeriesId, changed.SeriesId);
        Assert.Equal(added.CreationId, changed.CreationId);
        Assert.DoesNotContain("_", changed.SeriesId!);
        Assert.All((await CalendarOf(visitor)).Events.Where(e => e.CreationId == added.CreationId), e => Assert.Equal(changed.SeriesId, e.SeriesId));
    }
}
