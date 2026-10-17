using System.Net;
using System.Net.Http.Json;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Devices;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// Adding, changing and deleting events from a screen. On the demo the changes stay in the
/// visitor's copy; on a family instance they are written to Google, here <see cref="FakeGoogle"/>.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class EventTests(ApiFactory factory)
{
    private static readonly GoogleIdentity Alex = new("google-alex", "alex@example.com", EmailVerified: true, "Alex", "Alex Rivera");

    private static readonly DateOnly Day = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(3);

    private static EventRequest Timed(Guid calendarId, string title, TimeOnly start, TimeOnly end, string? location = null) =>
        new(calendarId, title, location, AllDay: false, Day, start, Day, end);

    private static EventRequest AllDay(Guid calendarId, string title, DateOnly first, int days) =>
        new(calendarId, title, null, AllDay: true, first, null, first.AddDays(days), null);

    private static async Task<CalendarResponse> CalendarOf(HttpClient client, DateOnly from, int days = 7) =>
        (await client.GetFromJsonAsync<CalendarResponse>($"/api/calendar?from={from:yyyy-MM-dd}&to={from.AddDays(days):yyyy-MM-dd}", ApiFactory.Json))!;

    private static async Task<FamilyResponse> FamilyOf(HttpClient client) =>
        (await client.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json))!;

    private static async Task<Guid> CalendarIdAsync(HttpClient client, string name) =>
        (await CalendarOf(client, Day, 1)).Calendars.Single(c => c.Name == name).Id;

    private static async Task<EventResponse> AddAsync(HttpClient client, EventRequest request)
    {
        var response = await client.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
    }

    private static Task<HttpResponseMessage> ChangeAsync(HttpClient client, Guid id, EventRequest request, bool series = false) =>
        client.PutAsJsonAsync($"/api/calendar/events/{id}{(series ? "?series=true" : "")}", request, ApiFactory.Json);

    /// <summary>The day and clock an occurrence starts at, in the family's zone.</summary>
    private static (DateOnly Day, TimeOnly Time) Local(EventResponse e, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTime(e.StartsAt!.Value, zone).DateTime;
        return (DateOnly.FromDateTime(local), TimeOnly.FromDateTime(local));
    }

    [Fact]
    public async Task A_visitor_adds_an_event_at_the_familys_own_time()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var family = await FamilyOf(visitor);
        var milos = await CalendarIdAsync(visitor, "Milo");
        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);

        var added = await AddAsync(visitor, Timed(milos, "  Parent & tot swim ", new(17, 30), new(18, 15), "Riverside Rec Center"));

        Assert.Equal("Parent & tot swim", added.Title);
        Assert.Equal(CalendarEndpoints.At(Day, new TimeOnly(17, 30), zone), added.StartsAt);
        Assert.Equal(CalendarEndpoints.At(Day, new TimeOnly(18, 15), zone), added.EndsAt);
        Assert.Equal(family.Members.Single(m => m.DisplayName == "Milo").Id, added.MemberId);
        Assert.False(added.Recurring);
        Assert.Contains((await CalendarOf(visitor, Day, 1)).Events, e => e.Id == added.Id && e.Location == "Riverside Rec Center");
    }

    [Fact]
    public async Task An_all_day_event_ends_the_day_after_its_last()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var everyone = await CalendarIdAsync(visitor, "Family");

        var added = await AddAsync(visitor, AllDay(everyone, "Camping", Day, days: 2));

        Assert.True(added.AllDay);
        Assert.Equal((Day, Day.AddDays(2)), (added.StartDate!.Value, added.EndDate!.Value));
        Assert.Contains((await CalendarOf(visitor, Day.AddDays(1), 1)).Events, e => e.Id == added.Id);
        Assert.DoesNotContain((await CalendarOf(visitor, Day.AddDays(2), 1)).Events, e => e.Id == added.Id);
    }

    [Fact]
    public async Task Changing_an_event_can_give_it_to_someone_else_and_deleting_removes_it()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var bens = await CalendarIdAsync(visitor, "Ben");
        var tesss = await CalendarIdAsync(visitor, "Tess");
        var added = await AddAsync(visitor, Timed(bens, "Haircut", new(9, 0), new(9, 30)));

        var changed = await ChangeAsync(visitor, added.Id, AllDay(tesss, "Haircut day", Day, days: 1));

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var shown = Assert.Single((await CalendarOf(visitor, Day, 1)).Events, e => e.Id == added.Id);
        Assert.Equal(("Haircut day", tesss, true, (DateTimeOffset?)null), (shown.Title, shown.CalendarId, shown.AllDay, shown.StartsAt));

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{added.Id}")).StatusCode);
        Assert.DoesNotContain((await CalendarOf(visitor, Day, 1)).Events, e => e.Id == added.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.DeleteAsync($"/api/calendar/events/{added.Id}")).StatusCode);
    }

    [Fact]
    public async Task One_occurrence_of_a_repeating_event_changes_on_its_own_and_stays_in_its_calendar()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var lessons = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Swim lesson").ToList();
        var first = lessons[0];
        Assert.True(first.Recurring);
        var family = await FamilyOf(visitor);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(first.StartsAt!.Value, zone).DateTime);
        var request = new EventRequest(first.CalendarId, "Swim lesson (pool closed)", null, false, date, new(16, 0), date, new(16, 45));

        Assert.Equal(HttpStatusCode.OK, (await ChangeAsync(visitor, first.Id, request)).StatusCode);
        var moved = await ChangeAsync(visitor, first.Id, request with { CalendarId = await CalendarIdAsync(visitor, "Ben") });

        Assert.Equal(HttpStatusCode.BadRequest, moved.StatusCode);
        var after = (await CalendarOf(visitor, Day, 21)).Events;
        Assert.Equal("Swim lesson (pool closed)", after.Single(e => e.Id == first.Id).Title);
        Assert.All(lessons.Skip(1), lesson => Assert.Equal("Swim lesson", after.Single(e => e.Id == lesson.Id).Title));
    }

    [Theory]
    [InlineData(" ", 9, 10, false)]
    [InlineData("Backwards", 10, 9, false)]
    [InlineData("No length", 10, 10, false)]
    [InlineData("Ends before it starts", 0, 0, true)]
    public async Task An_event_needs_a_title_and_to_end_after_it_starts(string title, int startHour, int endHour, bool allDay)
    {
        using var visitor = await factory.DemoVisitorAsync();
        var bens = await CalendarIdAsync(visitor, "Ben");
        var request = allDay
            ? new EventRequest(bens, title, null, true, Day, null, Day, null)
            : Timed(bens, title, new(startHour, 0), new(endHour, 0));

        var response = await visitor.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_family_cannot_add_to_or_change_another_familys_calendar()
    {
        using var visitor = await factory.DemoVisitorAsync();
        using var other = await factory.DemoVisitorAsync();
        var theirs = await AddAsync(other, Timed(await CalendarIdAsync(other, "Ben"), "Private", new(9, 0), new(10, 0)));

        var added = await visitor.PostAsJsonAsync("/api/calendar/events", Timed(theirs.CalendarId, "Sneaky", new(9, 0), new(10, 0)), ApiFactory.Json);
        var changed = await ChangeAsync(visitor, theirs.Id, Timed(await CalendarIdAsync(visitor, "Ben"), "Sneaky", new(9, 0), new(10, 0)));
        var deleted = await visitor.DeleteAsync($"/api/calendar/events/{theirs.Id}");

        Assert.Equal((HttpStatusCode.BadRequest, HttpStatusCode.NotFound, HttpStatusCode.NotFound), (added.StatusCode, changed.StatusCode, deleted.StatusCode));
        Assert.Equal("Private", (await CalendarOf(other, Day, 1)).Events.Single(e => e.Id == theirs.Id).Title);
    }

    [Fact]
    public async Task A_paired_wall_can_add_events_and_a_stranger_cannot()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var wall = factory.Demo.CreateClient();
        var pairing = (await (await wall.PostAsync("/api/pairing", null)).Content.ReadFromJsonAsync<PairingResponse>(ApiFactory.Json))!;
        await parent.PostAsJsonAsync("/api/devices", new PairDisplayRequest(pairing.Code, "Kitchen"), ApiFactory.Json);
        await wall.PostAsync($"/api/pairing/{pairing.Id}/finish", null);
        using var stranger = factory.Demo.CreateClient();
        var request = Timed(await CalendarIdAsync(parent, "Family"), "Added on the wall", new(12, 0), new(13, 0));

        var added = await AddAsync(wall, request);
        var refused = await stranger.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);

        Assert.Contains((await CalendarOf(parent, Day, 1)).Events, e => e.Id == added.Id);
        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
    }

    /// <summary>A family connected to Google, showing Alex's calendar as Alex's, the family calendar as everyone's, and the holidays.</summary>
    private async Task<GoogleFamily> ConnectedAsync()
    {
        var family = await GoogleFamily.StartAsync(factory, Alex);
        await GoogleFamily.ConnectAsync(family.Parent);
        var alex = (await family.FamilyAsync()).Members.Single().Id;
        (await family.Parent.PutAsJsonAsync("/api/calendar/sources", new CalendarChoicesRequest(
        [
            new CalendarChoiceRequest("alex-cal", alex),
            new CalendarChoiceRequest("family-cal", null),
            new CalendarChoiceRequest("holidays", null),
        ]), ApiFactory.Json)).EnsureSuccessStatusCode();
        return family;
    }

    /// <summary>An event already in Google, synced into the cache, as the screens see it.</summary>
    private static async Task<EventResponse> SyncedAsync(GoogleFamily family, string calendarId, string eventId, string title)
    {
        var startsAt = new DateTimeOffset(Day.ToDateTime(new TimeOnly(15, 0)), TimeSpan.Zero);
        family.Google.Put(calendarId, new GoogleEvent(eventId, null, title, null, startsAt, startsAt.AddHours(1), null, null));
        await family.SyncAsync();
        return (await CalendarOf(family.Parent, Day.AddDays(-1), 3)).Events.Single(e => e.Title == title);
    }

    [Fact]
    public async Task An_event_added_on_a_screen_is_written_to_google_and_shows_at_once()
    {
        await using var family = await ConnectedAsync();
        var calendar = await CalendarOf(family.Parent, Day, 1);
        Assert.False(calendar.Calendars.Single(c => c.Name == "Holidays").CanWrite);
        var alexs = calendar.Calendars.Single(c => c.Name == "Alex").Id;

        var added = await AddAsync(family.Parent, Timed(alexs, "Swim meet", new(10, 0), new(11, 0), "Pool"));

        var (change, calendarId, eventId, _) = Assert.Single(family.Google.Writes);
        Assert.Equal(("insert", "alex-cal"), (change, calendarId));
        var stored = family.Google.Find("alex-cal", eventId)!;
        Assert.Equal(("Swim meet", "Pool", added.StartsAt), (stored.Title, stored.Location, stored.StartsAt));
        Assert.Contains((await CalendarOf(family.Parent, Day, 1)).Events, e => e.Id == added.Id);

        // The next sync finds the same event, not a second one.
        await family.SyncAsync();
        Assert.Single((await CalendarOf(family.Parent, Day, 1)).Events, e => e.Title == "Swim meet");
    }

    [Fact]
    public async Task A_change_is_sent_with_the_version_it_was_made_to_and_can_move_the_event()
    {
        await using var family = await ConnectedAsync();
        var synced = await SyncedAsync(family, "alex-cal", "dentist", "Dentist");
        var etag = family.Google.Find("alex-cal", "dentist")!.ETag;
        var everyone = await CalendarIdAsync(family.Parent, "Family");

        var first = await ChangeAsync(family.Parent, synced.Id, Timed(synced.CalendarId, "Dentist, Dr. Hale", new(9, 0), new(10, 0)));
        var second = await ChangeAsync(family.Parent, synced.Id, Timed(everyone, "Dentist, Dr. Hale", new(9, 0), new(10, 0)));

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (first.StatusCode, second.StatusCode));
        Assert.Equal(("patch", etag), (family.Google.Writes[0].Change, family.Google.Writes[0].IfMatch));
        // The second change sends the version Google returned for the first.
        Assert.NotEqual(etag, family.Google.Writes[1].IfMatch);
        Assert.Equal(["patch", "patch", "move"], family.Google.Writes.Select(w => w.Change));
        Assert.Null(family.Google.Find("alex-cal", "dentist"));
        Assert.Equal("Dentist, Dr. Hale", family.Google.Find("family-cal", "dentist")!.Title);
        Assert.Equal(everyone, (await CalendarOf(family.Parent, Day, 1)).Events.Single(e => e.Id == synced.Id).CalendarId);
    }

    [Fact]
    public async Task A_change_made_in_google_first_is_shown_instead_of_overwritten()
    {
        await using var family = await ConnectedAsync();
        var synced = await SyncedAsync(family, "alex-cal", "swim", "Swim");
        var startsAt = synced.StartsAt!.Value;
        family.Google.Put("alex-cal", new GoogleEvent("swim", null, "Swim, moved indoors", null, startsAt, startsAt.AddHours(1), null, null));
        var before = (await CalendarOf(family.Parent, Day)).ChangeNumber;

        var changed = await ChangeAsync(family.Parent, synced.Id, Timed(synced.CalendarId, "Swim, cancelled", new(9, 0), new(10, 0)));

        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        Assert.Equal("Swim, moved indoors", (await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!.Title);
        Assert.Equal("Swim, moved indoors", family.Google.Find("alex-cal", "swim")!.Title);
        Assert.Equal(before + 1, (await CalendarOf(family.Parent, Day)).ChangeNumber);
        // The cache now holds Google's version, so a delete after seeing it goes through.
        var deleted = await family.Parent.DeleteAsync($"/api/calendar/events/{synced.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Null(family.Google.Find("alex-cal", "swim"));
    }

    [Fact]
    public async Task An_event_deleted_in_google_first_is_gone_from_the_screens_too()
    {
        await using var family = await ConnectedAsync();
        var synced = await SyncedAsync(family, "alex-cal", "party", "Party");
        family.Google.Remove("alex-cal", "party");
        var before = (await CalendarOf(family.Parent, Day)).ChangeNumber;

        var changed = await ChangeAsync(family.Parent, synced.Id, Timed(synced.CalendarId, "Party!", new(9, 0), new(10, 0)));

        Assert.Equal(HttpStatusCode.NotFound, changed.StatusCode);
        Assert.DoesNotContain((await CalendarOf(family.Parent, Day.AddDays(-1), 3)).Events, e => e.Id == synced.Id);
        Assert.Equal(before + 1, (await CalendarOf(family.Parent, Day)).ChangeNumber);
    }

    [Fact]
    public async Task Google_refusing_the_calendar_or_the_connection_is_explained_and_remembered()
    {
        await using var family = await ConnectedAsync();
        var calendars = (await CalendarOf(family.Parent, Day, 1)).Calendars;
        var request = Timed(calendars.Single(c => c.Name == "Alex").Id, "Lunch", new(12, 0), new(13, 0));

        var readOnly = await family.Parent.PostAsJsonAsync("/api/calendar/events", request with { CalendarId = calendars.Single(c => c.Name == "Holidays").Id }, ApiFactory.Json);
        family.Google.Gone.Add("alex-cal");
        var unshared = await family.Parent.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);
        family.Google.Gone.Clear();
        var stillRefused = await family.Parent.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);
        family.Google.Revoked = true;
        var revoked = await family.Parent.PostAsJsonAsync("/api/calendar/events", request with { CalendarId = calendars.Single(c => c.Name == "Family").Id }, ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, readOnly.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, unshared.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, stillRefused.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, revoked.StatusCode);
        Assert.Empty(family.Google.Writes);
        Assert.True((await CalendarOf(family.Parent, Day, 1)).NeedsReconnect);
    }

    [Fact]
    public async Task A_new_weekly_event_repeats_and_a_change_to_all_events_keeps_each_on_its_day()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var zone = TimeZoneInfo.FindSystemTimeZoneById((await FamilyOf(visitor)).TimeZone);
        var milos = await CalendarIdAsync(visitor, "Milo");
        var tesss = await CalendarIdAsync(visitor, "Tess");

        var first = await AddAsync(visitor, Timed(milos, "Art class", new(17, 30), new(18, 15)) with { Repeat = EventRepeat.Weekly });

        Assert.True(first.Recurring);
        var classes = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Art class").ToList();
        Assert.Equal([Day, Day.AddDays(7), Day.AddDays(14)], classes.Select(e => Local(e, zone).Day));
        Assert.Equal(first.Id, classes[0].Id);

        var second = classes[1];
        var day = Local(second, zone).Day;
        var changed = await ChangeAsync(visitor, second.Id,
            new EventRequest(tesss, "Art class with Tess", "Studio B", false, day, new(18, 0), day, new(19, 30)), series: true);

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(second.Id, (await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!.Id);
        var after = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Art class with Tess").ToList();
        Assert.Equal([Day, Day.AddDays(7), Day.AddDays(14)], after.Select(e => Local(e, zone).Day));
        Assert.All(after, e =>
        {
            Assert.Equal((new TimeOnly(18, 0), TimeSpan.FromMinutes(90), tesss, "Studio B"), (Local(e, zone).Time, e.EndsAt - e.StartsAt, e.CalendarId, e.Location));
        });

        // A series keeps its days; one event of it can still move on its own.
        var moved = await ChangeAsync(visitor, second.Id,
            new EventRequest(tesss, "Art class", null, false, day.AddDays(1), new(18, 0), day.AddDays(1), new(19, 0)), series: true);
        Assert.Equal(HttpStatusCode.BadRequest, moved.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{second.Id}?series=true")).StatusCode);
        Assert.DoesNotContain((await CalendarOf(visitor, Day, 21)).Events, e => e.Title.StartsWith("Art class"));
    }

    [Fact]
    public async Task Deleting_one_event_of_a_series_leaves_the_rest()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var lessons = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Swim lesson").ToList();

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{lessons[0].Id}")).StatusCode);

        Assert.Equal(lessons.Skip(1).Select(e => e.Id), (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Swim lesson").Select(e => e.Id));
    }

    [Fact]
    public void A_monthly_event_on_the_31st_skips_the_shorter_months_and_a_daily_one_keeps_its_length()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        var startsAt = CalendarEndpoints.At(new DateOnly(2027, 1, 31), new TimeOnly(19, 0), zone);
        var draft = new GoogleEventDraft("Book club", null, startsAt, startsAt.AddHours(2), null, null, zone.Id);

        var monthly = EventSeries.Occurrences(draft, EventRepeat.Monthly, "s", new DateOnly(2027, 6, 30), zone).ToList();
        var daily = EventSeries.Occurrences(draft with { StartsAt = null, EndsAt = null, StartDate = new(2027, 3, 13), EndDate = new(2027, 3, 15) },
            EventRepeat.Daily, "d", new DateOnly(2027, 3, 15), zone).ToList();

        Assert.Equal(["s_20270131", "s_20270331", "s_20270531"], monthly.Select(e => e.Id));
        // Across the change to summer time the clock stays at 7 PM.
        Assert.Equal(new TimeOnly(19, 0), TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(monthly[1].StartsAt!.Value, zone).DateTime));
        Assert.Equal([(new DateOnly(2027, 3, 13), new DateOnly(2027, 3, 15)), (new(2027, 3, 14), new(2027, 3, 16)), (new(2027, 3, 15), new(2027, 3, 17))],
            daily.Select(e => (e.StartDate!.Value, e.EndDate!.Value)));
    }

    /// <summary>A weekly series in Alex's Google calendar, from <see cref="Day"/> at 3 PM, synced into the cache.</summary>
    private static async Task<List<EventResponse>> SyncedSeriesAsync(GoogleFamily family, string title)
    {
        var startsAt = new DateTimeOffset(Day.ToDateTime(new TimeOnly(15, 0)), TimeSpan.Zero);
        family.Google.PutSeries("alex-cal", new GoogleEvent("practice", null, title, null, startsAt, startsAt.AddHours(1), null, null), "RRULE:FREQ=WEEKLY", "UTC");
        await family.SyncAsync();
        return [.. (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title == title)];
    }

    [Fact]
    public async Task A_new_series_is_written_to_google_with_its_rule_and_every_event_shows_at_once()
    {
        await using var family = await ConnectedAsync();
        var alexs = await CalendarIdAsync(family.Parent, "Alex");

        var added = await AddAsync(family.Parent, AllDay(alexs, "Trash day", Day, days: 1) with { Repeat = EventRepeat.Weekly });

        var (change, _, seriesId, _) = Assert.Single(family.Google.Writes);
        Assert.Equal("insert", change);
        Assert.Equal("RRULE:FREQ=WEEKLY", family.Google.RuleOf(seriesId));
        var shown = (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title == "Trash day").ToList();
        Assert.Equal([Day, Day.AddDays(7), Day.AddDays(14)], shown.Select(e => e.StartDate!.Value));
        Assert.All(shown, e => Assert.True(e.Recurring));
        Assert.Equal(added.Id, shown[0].Id);

        await family.SyncAsync();
        Assert.Equal(shown.Select(e => e.Id), (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title == "Trash day").Select(e => e.Id));
    }

    [Fact]
    public async Task A_change_to_all_events_changes_the_series_in_google_and_can_move_it()
    {
        await using var family = await ConnectedAsync();
        var practices = await SyncedSeriesAsync(family, "Practice");
        var etag = family.Google.Find("alex-cal", "practice")!.ETag;
        var everyone = await CalendarIdAsync(family.Parent, "Family");
        var second = practices[1];
        var day = Local(second, TimeZoneInfo.Utc).Day;

        var changed = await ChangeAsync(family.Parent, second.Id,
            new EventRequest(second.CalendarId, "Practice, new field", null, false, day, new(9, 0), day, new(10, 30)), series: true);

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(("patch", "practice", etag), (family.Google.Writes[0].Change, family.Google.Writes[0].EventId, family.Google.Writes[0].IfMatch));
        var master = family.Google.Find("alex-cal", "practice")!;
        Assert.Equal((Day, new TimeOnly(9, 0), TimeSpan.FromMinutes(90)), (Local(Response(master), TimeZoneInfo.Utc).Day, Local(Response(master), TimeZoneInfo.Utc).Time, master.EndsAt - master.StartsAt));
        Assert.Equal(day, Local((await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!, TimeZoneInfo.Utc).Day);
        var after = (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title == "Practice, new field").ToList();
        Assert.Equal([Day, Day.AddDays(7), Day.AddDays(14)], after.Select(e => Local(e, TimeZoneInfo.Utc).Day));
        Assert.All(after, e => Assert.Equal(new TimeOnly(9, 0), Local(e, TimeZoneInfo.Utc).Time));

        // The cache took Google's new versions, so changing one event next is not refused.
        var alone = await ChangeAsync(family.Parent, after[2].Id,
            new EventRequest(second.CalendarId, "Practice, away game", null, false, Day.AddDays(14), new(9, 0), Day.AddDays(14), new(11, 0)));
        Assert.Equal(HttpStatusCode.OK, alone.StatusCode);

        var moved = await ChangeAsync(family.Parent, after[0].Id,
            new EventRequest(everyone, "Practice, new field", null, false, Day, new(9, 0), Day, new(10, 30)), series: true);

        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        Assert.Equal("move", family.Google.Writes[^1].Change);
        var inFamily = (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title.StartsWith("Practice")).ToList();
        Assert.Equal(3, inFamily.Count);
        Assert.All(inFamily, e => Assert.Equal(everyone, e.CalendarId));
    }

    [Fact]
    public async Task A_series_changed_in_google_first_is_shown_and_deleting_all_events_deletes_the_series()
    {
        await using var family = await ConnectedAsync();
        var practices = await SyncedSeriesAsync(family, "Practice");
        var startsAt = practices[0].StartsAt!.Value;
        family.Google.PutSeries("alex-cal", new GoogleEvent("practice", null, "Practice, moved indoors", null, startsAt, startsAt.AddHours(1), null, null), "RRULE:FREQ=WEEKLY", "UTC");
        var day = Local(practices[1], TimeZoneInfo.Utc).Day;

        var changed = await ChangeAsync(family.Parent, practices[1].Id,
            new EventRequest(practices[1].CalendarId, "Practice, cancelled", null, false, day, new(15, 0), day, new(16, 0)), series: true);

        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        Assert.Equal("Practice, moved indoors", (await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!.Title);
        Assert.Empty(family.Google.Writes);

        var deleted = await family.Parent.DeleteAsync($"/api/calendar/events/{practices[1].Id}?series=true");

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Equal(("delete", "practice"), (family.Google.Writes[^1].Change, family.Google.Writes[^1].EventId));
        Assert.Null(family.Google.Find("alex-cal", "practice"));
        Assert.DoesNotContain((await CalendarOf(family.Parent, Day, 21)).Events, e => e.Title.StartsWith("Practice"));
    }

    private static EventResponse Response(GoogleEvent e) =>
        new(Guid.Empty, Guid.Empty, null, e.Title, e.Location, false, e.StartsAt, e.EndsAt, null, null, true);
}
