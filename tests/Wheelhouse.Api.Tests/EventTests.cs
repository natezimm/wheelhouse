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
        var milos = await CalendarIdAsync(visitor, "Milo — School & Sports");
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
        var everyone = await CalendarIdAsync(visitor, "Marlowe Household");

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
        var claras = await CalendarIdAsync(visitor, "Clara");
        var julians = await CalendarIdAsync(visitor, "Julian");
        var added = await AddAsync(visitor, Timed(claras, "Haircut", new(9, 0), new(9, 30)));

        var changed = await ChangeAsync(visitor, added.Id, AllDay(julians, "Haircut day", Day, days: 1));

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var shown = Assert.Single((await CalendarOf(visitor, Day, 1)).Events, e => e.Id == added.Id);
        Assert.Equal(("Haircut day", julians, true, (DateTimeOffset?)null), (shown.Title, shown.CalendarId, shown.AllDay, shown.StartsAt));

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{added.Id}")).StatusCode);
        Assert.DoesNotContain((await CalendarOf(visitor, Day, 1)).Events, e => e.Id == added.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.DeleteAsync($"/api/calendar/events/{added.Id}")).StatusCode);
    }

    [Fact]
    public async Task One_occurrence_of_a_repeating_event_changes_on_its_own_and_stays_in_its_calendar()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var lessons = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Soccer practice").ToList();
        var first = lessons[0];
        Assert.True(first.Recurring);
        var family = await FamilyOf(visitor);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(first.StartsAt!.Value, zone).DateTime);
        var request = new EventRequest(first.CalendarId, "Soccer practice (field closed)", null, false, date, new(16, 0), date, new(16, 45));

        Assert.Equal(HttpStatusCode.OK, (await ChangeAsync(visitor, first.Id, request)).StatusCode);
        var moved = await ChangeAsync(visitor, first.Id, request with { CalendarId = await CalendarIdAsync(visitor, "Clara") });

        Assert.Equal(HttpStatusCode.BadRequest, moved.StatusCode);
        var after = (await CalendarOf(visitor, Day, 21)).Events;
        Assert.Equal("Soccer practice (field closed)", after.Single(e => e.Id == first.Id).Title);
        Assert.All(lessons.Skip(1), lesson => Assert.Equal("Soccer practice", after.Single(e => e.Id == lesson.Id).Title));
    }

    [Theory]
    [InlineData(" ", 9, 10, false)]
    [InlineData("Backwards", 10, 9, false)]
    [InlineData("No length", 10, 10, false)]
    [InlineData("Ends before it starts", 0, 0, true)]
    public async Task An_event_needs_a_title_and_to_end_after_it_starts(string title, int startHour, int endHour, bool allDay)
    {
        using var visitor = await factory.DemoVisitorAsync();
        var claras = await CalendarIdAsync(visitor, "Clara");
        var request = allDay
            ? new EventRequest(claras, title, null, true, Day, null, Day, null)
            : Timed(claras, title, new(startHour, 0), new(endHour, 0));

        var response = await visitor.PostAsJsonAsync("/api/calendar/events", request, ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_event_lasts_five_years_at_most()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var claras = await CalendarIdAsync(visitor, "Clara");

        var typo = await visitor.PostAsJsonAsync(
            "/api/calendar/events", new EventRequest(claras, "Trip", null, true, Day, null, Day.AddYears(36), null), ApiFactory.Json);
        var schoolYear = await visitor.PostAsJsonAsync(
            "/api/calendar/events", new EventRequest(claras, "School year", null, true, Day, null, Day.AddMonths(10), null), ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, typo.StatusCode);
        Assert.Equal(HttpStatusCode.Created, schoolYear.StatusCode);
    }

    [Fact]
    public async Task A_family_cannot_add_to_or_change_another_familys_calendar()
    {
        using var visitor = await factory.DemoVisitorAsync();
        using var other = await factory.DemoVisitorAsync();
        var theirs = await AddAsync(other, Timed(await CalendarIdAsync(other, "Clara"), "Private", new(9, 0), new(10, 0)));

        var added = await visitor.PostAsJsonAsync("/api/calendar/events", Timed(theirs.CalendarId, "Sneaky", new(9, 0), new(10, 0)), ApiFactory.Json);
        var changed = await ChangeAsync(visitor, theirs.Id, Timed(await CalendarIdAsync(visitor, "Clara"), "Sneaky", new(9, 0), new(10, 0)));
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
        var request = Timed(await CalendarIdAsync(parent, "Marlowe Household"), "Added on the wall", new(12, 0), new(13, 0));

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
        var milos = await CalendarIdAsync(visitor, "Milo — School & Sports");
        var julians = await CalendarIdAsync(visitor, "Julian");

        var first = await AddAsync(visitor, Timed(milos, "Art class", new(17, 30), new(18, 15)) with { Repeat = EventRepeat.Weekly });

        Assert.True(first.Recurring);
        var classes = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Art class").ToList();
        Assert.Equal([Day, Day.AddDays(7), Day.AddDays(14)], classes.Select(e => Local(e, zone).Day));
        Assert.Equal(first.Id, classes[0].Id);

        var second = classes[1];
        var day = Local(second, zone).Day;
        var changed = await ChangeAsync(visitor, second.Id,
            new EventRequest(julians, "Art class with Julian", "Studio B", false, day, new(18, 0), day, new(19, 30)), series: true);

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(second.Id, (await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!.Id);
        var after = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Art class with Julian").ToList();
        Assert.Equal([Day, Day.AddDays(7), Day.AddDays(14)], after.Select(e => Local(e, zone).Day));
        Assert.All(after, e =>
        {
            Assert.Equal((new TimeOnly(18, 0), TimeSpan.FromMinutes(90), julians, "Studio B"), (Local(e, zone).Time, e.EndsAt - e.StartsAt, e.CalendarId, e.Location));
        });

        // A series keeps its days; one event of it can still move on its own.
        var moved = await ChangeAsync(visitor, second.Id,
            new EventRequest(julians, "Art class", null, false, day.AddDays(1), new(18, 0), day.AddDays(1), new(19, 0)), series: true);
        Assert.Equal(HttpStatusCode.BadRequest, moved.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{second.Id}?series=true")).StatusCode);
        Assert.DoesNotContain((await CalendarOf(visitor, Day, 21)).Events, e => e.Title.StartsWith("Art class"));
    }

    [Fact]
    public async Task A_visitor_makes_an_event_repeat_and_it_keeps_its_place_as_the_first_of_the_series()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var zone = TimeZoneInfo.FindSystemTimeZoneById((await FamilyOf(visitor)).TimeZone);
        var milos = await CalendarIdAsync(visitor, "Milo — School & Sports");
        var julians = await CalendarIdAsync(visitor, "Julian");
        var added = await AddAsync(visitor, Timed(milos, "Piano", new(16, 0), new(16, 45)) with { CreationId = Guid.NewGuid(), Description = "Bring the blue book" });

        // The request leaves the notes out, as the editors do when they are unchanged.
        var changed = await ChangeAsync(visitor, added.Id, Timed(julians, "Piano lesson", new(16, 30), new(17, 15)) with { Repeat = EventRepeat.Weekly });

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var answer = (await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
        Assert.Equal((added.Id, true, added.CreationId), (answer.Id, answer.Recurring, answer.CreationId));
        var lessons = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Piano lesson").ToList();
        Assert.Equal([Day, Day.AddDays(7), Day.AddDays(14)], lessons.Select(e => Local(e, zone).Day));
        Assert.Equal(added.Id, lessons[0].Id);
        Assert.All(lessons, e => Assert.Equal((true, answer.SeriesId, julians, new TimeOnly(16, 30), "Bring the blue book"),
            (e.Recurring, e.SeriesId, e.CalendarId, Local(e, zone).Time, e.Description)));
        Assert.DoesNotContain((await CalendarOf(visitor, Day, 21)).Events, e => e.Title == "Piano");

        // An event that already repeats keeps its rule.
        var again = await ChangeAsync(visitor, lessons[1].Id,
            Timed(julians, "Piano lesson", new(17, 0), new(17, 45)) with { StartDate = Day.AddDays(7), EndDate = Day.AddDays(7), Repeat = EventRepeat.Daily });
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(3, (await CalendarOf(visitor, Day, 21)).Events.Count(e => e.Title == "Piano lesson"));
        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{lessons[1].Id}?series=true")).StatusCode);
        Assert.DoesNotContain((await CalendarOf(visitor, Day, 21)).Events, e => e.Title == "Piano lesson");
    }

    [Fact]
    public async Task Deleting_one_event_of_a_series_leaves_the_rest()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var lessons = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Soccer practice").ToList();

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{lessons[0].Id}")).StatusCode);

        Assert.Equal(lessons.Skip(1).Select(e => e.Id), (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Soccer practice").Select(e => e.Id));
    }

    [Fact]
    public void A_monthly_event_on_the_31st_skips_the_shorter_months_and_a_daily_one_keeps_its_length()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        var startsAt = CalendarEndpoints.At(new DateOnly(2027, 1, 31), new TimeOnly(19, 0), zone);
        var draft = new GoogleEventDraft("Book club", null, startsAt, startsAt.AddHours(2), null, null, zone.Id);

        var monthly = EventSeries.Occurrences(draft with { Recurrence = "RRULE:FREQ=MONTHLY" }, "s", new DateOnly(2027, 6, 30), zone).ToList();
        var daily = EventSeries.Occurrences(draft with { StartsAt = null, EndsAt = null, StartDate = new(2027, 3, 13), EndDate = new(2027, 3, 15), Recurrence = "RRULE:FREQ=DAILY" },
            "d", new DateOnly(2027, 3, 15), zone).ToList();

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
    public async Task Making_an_event_repeat_gives_it_a_rule_in_google_and_every_event_shows_at_once()
    {
        await using var family = await ConnectedAsync();
        var synced = await SyncedAsync(family, "alex-cal", "swim", "Swim");
        var etag = family.Google.Find("alex-cal", "swim")!.ETag;
        var everyone = await CalendarIdAsync(family.Parent, "Family");

        var changed = await ChangeAsync(family.Parent, synced.Id, Timed(everyone, "Swim team", new(15, 0), new(16, 0)) with { Repeat = EventRepeat.Weekly });

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(["patch", "move"], family.Google.Writes.Select(w => w.Change));
        Assert.Equal(("swim", etag), (family.Google.Writes[0].EventId, family.Google.Writes[0].IfMatch));
        Assert.Equal("RRULE:FREQ=WEEKLY", family.Google.RuleOf("swim"));
        var answer = (await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
        Assert.Equal((Day, true, everyone), (Local(answer, TimeZoneInfo.Utc).Day, answer.Recurring, answer.CalendarId));
        var shown = (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title == "Swim team").ToList();
        Assert.Equal([Day, Day.AddDays(7), Day.AddDays(14)], shown.Select(e => Local(e, TimeZoneInfo.Utc).Day));
        Assert.All(shown, e => Assert.Equal((true, everyone), (e.Recurring, e.CalendarId)));
        Assert.Equal(answer.Id, shown[0].Id);
        Assert.DoesNotContain((await CalendarOf(family.Parent, Day, 21)).Events, e => e.Title == "Swim");

        // The next sync finds the same events, not a second series.
        await family.SyncAsync();
        Assert.Equal(shown.Select(e => e.Id), (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title == "Swim team").Select(e => e.Id));
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

    [Fact]
    public async Task The_sync_brings_in_an_events_notes_and_its_series_rule()
    {
        await using var family = await ConnectedAsync();
        var startsAt = new DateTimeOffset(Day.ToDateTime(new TimeOnly(15, 0)), TimeSpan.Zero);
        family.Google.PutSeries("alex-cal", new GoogleEvent("lesson", null, "Piano", null, startsAt, startsAt.AddHours(1), null, null,
            Description: "Bring the <b>blue</b> book"), "RRULE:FREQ=WEEKLY", "UTC");

        await family.SyncAsync();

        var lessons = (await CalendarOf(family.Parent, Day, 14)).Events.Where(e => e.Title == "Piano").ToList();
        Assert.Equal(2, lessons.Count);
        Assert.All(lessons, e => Assert.Equal(("Bring the <b>blue</b> book", "RRULE:FREQ=WEEKLY"), (e.Description, e.Recurrence)));
    }

    [Fact]
    public async Task A_change_leaves_notes_it_does_not_send_and_sets_or_clears_those_it_does()
    {
        await using var family = await ConnectedAsync();
        var startsAt = new DateTimeOffset(Day.ToDateTime(new TimeOnly(9, 0)), TimeSpan.Zero);
        family.Google.Put("alex-cal", new GoogleEvent("dentist", null, "Dentist", null, startsAt, startsAt.AddHours(1), null, null,
            Description: "<a href=\"https://example.com\">Directions</a>"));
        await family.SyncAsync();
        var dentist = (await CalendarOf(family.Parent, Day, 1)).Events.Single(e => e.Title == "Dentist");
        var request = Timed(dentist.CalendarId, "Dentist, moved", new(10, 0), new(11, 0));

        (await ChangeAsync(family.Parent, dentist.Id, request)).EnsureSuccessStatusCode();
        Assert.Equal("<a href=\"https://example.com\">Directions</a>", family.Google.Find("alex-cal", "dentist")!.Description);

        (await ChangeAsync(family.Parent, dentist.Id, request with { Description = "  Ask about the retainer  " })).EnsureSuccessStatusCode();
        Assert.Equal("Ask about the retainer", (await CalendarOf(family.Parent, Day, 1)).Events.Single(e => e.Id == dentist.Id).Description);

        (await ChangeAsync(family.Parent, dentist.Id, request with { Description = "" })).EnsureSuccessStatusCode();
        Assert.Null((await CalendarOf(family.Parent, Day, 1)).Events.Single(e => e.Id == dentist.Id).Description);
        Assert.Null(family.Google.Find("alex-cal", "dentist")!.Description);
    }

    [Fact]
    public async Task An_event_can_be_for_more_people_than_its_calendars_owner()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var members = (await FamilyOf(visitor)).Members;
        var (clara, nora) = (members.Single(m => m.DisplayName == "Clara").Id, members.Single(m => m.DisplayName == "Nora").Id);
        var claras = await CalendarIdAsync(visitor, "Clara");
        Assert.Contains((await CalendarOf(visitor, Day.AddDays(-7), 21)).Events, e => e.MemberIds is { Count: > 0 });

        // The calendar's owner is the event's already, so naming her again changes nothing.
        var added = await AddAsync(visitor, Timed(claras, "Haircuts", new(10, 0), new(11, 0)) with { MemberIds = [nora, clara, nora] });
        Assert.Equal(clara, added.MemberId);
        Assert.Equal([nora], added.MemberIds!);

        var request = Timed(claras, "Haircuts, both", new(10, 30), new(11, 30));
        (await ChangeAsync(visitor, added.Id, request)).EnsureSuccessStatusCode();
        Assert.Equal([nora], (await CalendarOf(visitor, Day, 1)).Events.Single(e => e.Id == added.Id).MemberIds!);

        (await ChangeAsync(visitor, added.Id, request with { MemberIds = [] })).EnsureSuccessStatusCode();
        Assert.Empty((await CalendarOf(visitor, Day, 1)).Events.Single(e => e.Id == added.Id).MemberIds!);

        var stranger = await ChangeAsync(visitor, added.Id, request with { MemberIds = [Guid.NewGuid()] });
        Assert.Equal(HttpStatusCode.BadRequest, stranger.StatusCode);
        Assert.Contains("memberIds", await stranger.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_people_of_an_event_are_kept_in_google_and_read_back_by_a_sync()
    {
        await using var family = await ConnectedAsync();
        var alex = (await family.FamilyAsync()).Members.Single().Id;
        var everyone = (await CalendarOf(family.Parent, Day, 1)).Calendars.Single(c => c.MemberId is null && c.CanWrite).Id;

        var added = await AddAsync(family.Parent, Timed(everyone, "Recital", new(18, 0), new(19, 0)) with { MemberIds = [alex] });
        Assert.Equal([alex], added.MemberIds!);
        var stored = family.Google.Occurrences("family-cal", DateTimeOffset.MinValue, DateTimeOffset.MaxValue).Single(e => e.Title == "Recital");
        Assert.Equal([alex], stored.MemberIds!);

        family.Google.Put("family-cal", stored with { MemberIds = [], ETag = "\"2\"" });
        await family.SyncAsync();
        Assert.Empty((await CalendarOf(family.Parent, Day, 1)).Events.Single(e => e.Title == "Recital").MemberIds!);
    }

    /// <summary>A wall display paired with <paramref name="parent"/>'s family.</summary>
    private async Task<HttpClient> PairedDisplayAsync(HttpClient parent)
    {
        var display = factory.Demo.CreateClient();
        var pairing = (await (await display.PostAsync("/api/pairing", content: null)).Content.ReadFromJsonAsync<PairingResponse>(ApiFactory.Json))!;
        (await parent.PostAsJsonAsync("/api/devices", new PairDisplayRequest(pairing.Code, "Kitchen"), ApiFactory.Json)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await display.PostAsync($"/api/pairing/{pairing.Id}/finish", content: null)).StatusCode);
        return display;
    }

    [Fact]
    public async Task A_display_shows_a_private_event_only_as_busy_and_cannot_change_it()
    {
        using var parent = await factory.DemoVisitorAsync();
        using var display = await PairedDisplayAsync(parent);
        var shown = (await CalendarOf(parent, Day.AddDays(-3), 14)).Events.Single(e => e.Private);
        Assert.Equal(("Anniversary dinner reservation", false), (shown.Title, shown.Hidden));

        var busy = (await CalendarOf(display, Day.AddDays(-3), 14)).Events.Single(e => e.Id == shown.Id);
        Assert.Equal(("Busy", (string?)null, (string?)null, true, true), (busy.Title, busy.Location, busy.Description, busy.Private, busy.Hidden));
        Assert.Equal((shown.StartsAt, shown.EndsAt, shown.MemberId), (busy.StartsAt, busy.EndsAt, busy.MemberId));
        Assert.DoesNotContain((await CalendarOf(display, Day.AddDays(-3), 14)).Events, e => e.Title == "Anniversary dinner reservation");

        var day = DateOnly.FromDateTime(shown.StartsAt!.Value.UtcDateTime);
        var change = await ChangeAsync(display, shown.Id, Timed(shown.CalendarId, "Busy", new(10, 0), new(11, 0)) with { StartDate = day, EndDate = day });
        Assert.Equal(HttpStatusCode.Forbidden, change.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await display.DeleteAsync($"/api/calendar/events/{shown.Id}")).StatusCode);
        Assert.Equal("Anniversary dinner reservation", (await CalendarOf(parent, Day.AddDays(-3), 14)).Events.Single(e => e.Id == shown.Id).Title);

        // Only a parent makes an event private; a display's say is ignored.
        var claras = await CalendarIdAsync(parent, "Clara");
        var added = await AddAsync(display, Timed(claras, "Groceries", new(9, 0), new(10, 0)) with { Private = true });
        Assert.False(added.Private);
        (await ChangeAsync(parent, added.Id, Timed(claras, "Groceries", new(9, 0), new(10, 0)) with { Private = true })).EnsureSuccessStatusCode();
        Assert.True((await CalendarOf(parent, Day, 1)).Events.Single(e => e.Id == added.Id).Private);
        Assert.Equal("Busy", (await CalendarOf(display, Day, 1)).Events.Single(e => e.Id == added.Id).Title);
    }

    [Fact]
    public async Task Privacy_is_google_s_visibility_and_a_change_leaves_it_unless_it_says()
    {
        await using var family = await ConnectedAsync();
        var startsAt = new DateTimeOffset(Day.ToDateTime(new TimeOnly(9, 0)), TimeSpan.Zero);
        family.Google.Put("alex-cal", new GoogleEvent("therapy", null, "Therapy", null, startsAt, startsAt.AddHours(1), null, null, Private: true));
        await family.SyncAsync();
        var therapy = (await CalendarOf(family.Parent, Day, 1)).Events.Single(e => e.Title == "Therapy");
        Assert.True(therapy.Private);

        var request = Timed(therapy.CalendarId, "Therapy", new(10, 0), new(11, 0));
        (await ChangeAsync(family.Parent, therapy.Id, request)).EnsureSuccessStatusCode();
        Assert.True(family.Google.Find("alex-cal", "therapy")!.Private);
        (await ChangeAsync(family.Parent, therapy.Id, request with { Private = false })).EnsureSuccessStatusCode();
        Assert.False(family.Google.Find("alex-cal", "therapy")!.Private);
        Assert.False((await CalendarOf(family.Parent, Day, 1)).Events.Single(e => e.Id == therapy.Id).Private);
    }

    [Fact]
    public async Task The_demo_has_notes_and_rules_and_keeps_notes_a_visitor_writes()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var noras = await CalendarIdAsync(visitor, "Nora — Activities");
        var soccer = (await CalendarOf(visitor, Day.AddDays(-7), 14)).Events.First(e => e.Title == "Soccer practice");
        Assert.Equal("RRULE:FREQ=WEEKLY;BYDAY=TU,TH", soccer.Recurrence);
        Assert.NotNull(soccer.Description);

        var added = await AddAsync(visitor, Timed(noras, "Recital", new(18, 0), new(19, 0)) with { Description = "Arrive by 5:30" });
        Assert.Equal("Arrive by 5:30", added.Description);
        var tooLong = await visitor.PostAsJsonAsync("/api/calendar/events",
            Timed(noras, "Recital", new(18, 0), new(19, 0)) with { Description = new string('x', EventEndpoints.MaxDescription + 1) }, ApiFactory.Json);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
    }

    [Fact]
    public async Task A_new_demo_series_carries_its_rule()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var noras = await CalendarIdAsync(visitor, "Nora — Activities");

        var added = await AddAsync(visitor, Timed(noras, "Swim", new(16, 0), new(17, 0)) with { Repeat = EventRepeat.Monthly });

        Assert.Equal("RRULE:FREQ=MONTHLY", added.Recurrence);
    }

    [Fact]
    public async Task A_demo_series_takes_a_fuller_rule_and_ends_after_its_count()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var noras = await CalendarIdAsync(visitor, "Nora — Activities");
        var family = await FamilyOf(visitor);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(family.TimeZone);
        var monday = Day.AddDays(((int)DayOfWeek.Monday - (int)Day.DayOfWeek + 7) % 7);

        var added = await AddAsync(visitor, Timed(noras, "Tutoring", new(16, 0), new(17, 0)) with
        {
            StartDate = monday, EndDate = monday, Recurrence = "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO;COUNT=4",
        });

        Assert.Equal("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4", added.Recurrence);
        var shown = (await CalendarOf(visitor, monday, 40)).Events.Where(e => e.Title == "Tutoring").ToList();
        Assert.Equal([monday, monday.AddDays(2), monday.AddDays(14), monday.AddDays(16)], shown.Select(e => Local(e, zone).Day));
        Assert.All(shown, e => Assert.Equal(new TimeOnly(16, 0), Local(e, zone).Time));
    }

    [Theory]
    [InlineData("RRULE:FREQ=HOURLY")]
    [InlineData("RRULE:FREQ=WEEKLY;BYSETPOS=2")]
    [InlineData("RRULE:FREQ=DAILY;UNTIL=20000101")]
    public async Task A_rule_the_screens_do_not_offer_or_that_ends_before_it_starts_is_refused(string rule)
    {
        using var visitor = await factory.DemoVisitorAsync();
        var noras = await CalendarIdAsync(visitor, "Nora — Activities");

        var response = await visitor.PostAsJsonAsync("/api/calendar/events", Timed(noras, "Swim", new(16, 0), new(17, 0)) with { Recurrence = rule }, ApiFactory.Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("recurrence", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_new_rule_for_a_demo_series_repeats_it_again_from_its_first_event()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var noras = await CalendarIdAsync(visitor, "Nora — Activities");
        var zone = TimeZoneInfo.FindSystemTimeZoneById((await FamilyOf(visitor)).TimeZone);
        var added = await AddAsync(visitor, Timed(noras, "Reading", new(19, 0), new(19, 30)) with { Repeat = EventRepeat.Weekly, Description = "Chapter 4" });

        // The notes are left out, so the new events of the series take the series' notes.
        var changed = await ChangeAsync(visitor, added.Id, Timed(noras, "Reading", new(19, 0), new(19, 30)) with { Recurrence = "RRULE:FREQ=DAILY;COUNT=3" }, series: true);

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var answer = (await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
        Assert.Equal((added.Id, "RRULE:FREQ=DAILY;COUNT=3"), (answer.Id, answer.Recurrence));
        var shown = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Reading").ToList();
        Assert.Equal([Day, Day.AddDays(1), Day.AddDays(2)], shown.Select(e => Local(e, zone).Day));
        Assert.All(shown, e => Assert.Equal(("RRULE:FREQ=DAILY;COUNT=3", "Chapter 4"), (e.Recurrence, e.Description)));
    }

    [Fact]
    public async Task A_new_rule_for_a_series_is_written_to_its_first_event_in_google()
    {
        await using var family = await ConnectedAsync();
        var practices = await SyncedSeriesAsync(family, "Practice");
        var second = practices[1];
        var day = Local(second, TimeZoneInfo.Utc).Day;

        var changed = await ChangeAsync(family.Parent, second.Id,
            new EventRequest(second.CalendarId, "Practice", null, false, day, new(15, 0), day, new(16, 0), Recurrence: "RRULE:FREQ=WEEKLY;INTERVAL=2"), series: true);

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(("patch", "practice"), (family.Google.Writes[0].Change, family.Google.Writes[0].EventId));
        Assert.Equal("RRULE:FREQ=WEEKLY;INTERVAL=2", family.Google.RuleOf("practice"));
        var after = (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title == "Practice").ToList();
        Assert.Equal([Day, Day.AddDays(14)], after.Select(e => Local(e, TimeZoneInfo.Utc).Day));
        Assert.All(after, e => Assert.Equal("RRULE:FREQ=WEEKLY;INTERVAL=2", e.Recurrence));
        // The day on screen fell out of the series, so the answer is its first event.
        Assert.Equal(Day, Local((await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!, TimeZoneInfo.Utc).Day);
    }

    [Fact]
    public async Task A_rule_sent_with_a_change_to_one_event_of_a_series_leaves_the_rule_alone()
    {
        await using var family = await ConnectedAsync();
        var practices = await SyncedSeriesAsync(family, "Practice");
        var day = Local(practices[1], TimeZoneInfo.Utc).Day;

        var changed = await ChangeAsync(family.Parent, practices[1].Id,
            new EventRequest(practices[1].CalendarId, "Practice, late", null, false, day, new(17, 0), day, new(18, 0), Recurrence: "RRULE:FREQ=DAILY"));

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal("RRULE:FREQ=WEEKLY", family.Google.RuleOf("practice"));
    }

    private static Task<HttpResponseMessage> ChangeFollowingAsync(HttpClient client, Guid id, EventRequest request) =>
        client.PutAsJsonAsync($"/api/calendar/events/{id}?following=true", request, ApiFactory.Json);

    [Fact]
    public async Task Changing_a_demo_event_and_those_after_it_starts_a_new_series_with_the_count_left()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var noras = await CalendarIdAsync(visitor, "Nora — Activities");
        var zone = TimeZoneInfo.FindSystemTimeZoneById((await FamilyOf(visitor)).TimeZone);
        await AddAsync(visitor, Timed(noras, "Ballet", new(16, 0), new(17, 0)) with { Recurrence = "RRULE:FREQ=WEEKLY;COUNT=4", Description = "Bring water" });
        var ballet = (await CalendarOf(visitor, Day, 28)).Events.Where(e => e.Title == "Ballet").ToList();
        var third = Day.AddDays(14);

        var changed = await ChangeFollowingAsync(visitor, ballet[2].Id, Timed(noras, "Ballet, new studio", new(17, 0), new(18, 0)) with { StartDate = third, EndDate = third });

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var answer = (await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!;
        Assert.Equal((third, new TimeOnly(17, 0), "RRULE:FREQ=WEEKLY;COUNT=2"), (Local(answer, zone).Day, Local(answer, zone).Time, answer.Recurrence));
        var shown = (await CalendarOf(visitor, Day, 28)).Events.Where(e => e.Title.StartsWith("Ballet")).ToList();
        Assert.Equal([("Ballet", Day), ("Ballet", Day.AddDays(7)), ("Ballet, new studio", third), ("Ballet, new studio", Day.AddDays(21))],
            shown.Select(e => (e.Title, Local(e, zone).Day)));
        Assert.All(shown.Take(2), e => Assert.StartsWith("RRULE:FREQ=WEEKLY;UNTIL=", e.Recurrence));
        Assert.NotEqual(shown[0].SeriesId, shown[2].SeriesId);
        Assert.Equal(shown[2].SeriesId, shown[3].SeriesId);
        Assert.All(shown, e => Assert.Equal("Bring water", e.Description));
    }

    [Fact]
    public async Task Deleting_a_demo_event_and_those_after_it_ends_the_series_and_the_first_event_means_all()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var noras = await CalendarIdAsync(visitor, "Nora — Activities");
        await AddAsync(visitor, AllDay(noras, "Library books due", Day, days: 1) with { Repeat = EventRepeat.Weekly });
        var due = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title == "Library books due").ToList();

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{due[1].Id}?following=true")).StatusCode);

        var left = Assert.Single((await CalendarOf(visitor, Day, 28)).Events, e => e.Title == "Library books due");
        Assert.Equal((due[0].Id, $"RRULE:FREQ=WEEKLY;UNTIL={Day.AddDays(6):yyyyMMdd}"), (left.Id, left.Recurrence));

        Assert.Equal(HttpStatusCode.NoContent, (await visitor.DeleteAsync($"/api/calendar/events/{left.Id}?following=true")).StatusCode);
        Assert.DoesNotContain((await CalendarOf(visitor, Day, 28)).Events, e => e.Title == "Library books due");
    }

    [Fact]
    public async Task Changing_the_first_event_and_those_after_it_changes_the_whole_series()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var noras = await CalendarIdAsync(visitor, "Nora — Activities");
        var added = await AddAsync(visitor, Timed(noras, "Chess", new(16, 0), new(17, 0)) with { Repeat = EventRepeat.Weekly });
        var seriesId = added.SeriesId;

        var changed = await ChangeFollowingAsync(visitor, added.Id, Timed(noras, "Chess club", new(16, 0), new(17, 0)));

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var shown = (await CalendarOf(visitor, Day, 21)).Events.Where(e => e.Title.StartsWith("Chess")).ToList();
        Assert.Equal(3, shown.Count);
        Assert.All(shown, e => Assert.Equal(("Chess club", seriesId), (e.Title, e.SeriesId)));
    }

    [Fact]
    public async Task Changing_an_event_and_those_after_it_in_google_ends_the_series_and_starts_another()
    {
        await using var family = await ConnectedAsync();
        var practices = await SyncedSeriesAsync(family, "Practice");
        var second = practices[1];
        var day = Local(second, TimeZoneInfo.Utc).Day;

        var changed = await ChangeFollowingAsync(family.Parent, second.Id,
            new EventRequest(second.CalendarId, "Practice, new field", null, false, day, new(9, 0), day, new(10, 0)));

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(["insert", "patch"], family.Google.Writes.Select(w => w.Change));
        Assert.Equal("practice", family.Google.Writes[1].EventId);
        Assert.StartsWith("RRULE:FREQ=WEEKLY;UNTIL=", family.Google.RuleOf("practice"));
        Assert.Equal("RRULE:FREQ=WEEKLY", family.Google.RuleOf(family.Google.Writes[0].EventId));
        var shown = (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title.StartsWith("Practice")).ToList();
        Assert.Equal([("Practice", Day, new TimeOnly(15, 0)), ("Practice, new field", day, new TimeOnly(9, 0)), ("Practice, new field", day.AddDays(7), new TimeOnly(9, 0))],
            shown.Select(e => (e.Title, Local(e, TimeZoneInfo.Utc).Day, Local(e, TimeZoneInfo.Utc).Time)));
        Assert.Equal(day, Local((await changed.Content.ReadFromJsonAsync<EventResponse>(ApiFactory.Json))!, TimeZoneInfo.Utc).Day);

        // The next sync finds the same events.
        await family.SyncAsync();
        Assert.Equal(shown.Select(e => e.Id), (await CalendarOf(family.Parent, Day, 21)).Events.Where(e => e.Title.StartsWith("Practice")).Select(e => e.Id));
    }

    [Fact]
    public async Task Deleting_an_event_and_those_after_it_in_google_ends_the_series()
    {
        await using var family = await ConnectedAsync();
        var practices = await SyncedSeriesAsync(family, "Practice");

        var deleted = await family.Parent.DeleteAsync($"/api/calendar/events/{practices[1].Id}?following=true");

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Equal(["patch"], family.Google.Writes.Select(w => w.Change));
        Assert.StartsWith("RRULE:FREQ=WEEKLY;UNTIL=", family.Google.RuleOf("practice"));
        var left = Assert.Single((await CalendarOf(family.Parent, Day, 21)).Events, e => e.Title == "Practice");
        Assert.Equal(practices[0].Id, left.Id);
        await family.SyncAsync();
        Assert.Single((await CalendarOf(family.Parent, Day, 21)).Events, e => e.Title == "Practice");
    }
}
