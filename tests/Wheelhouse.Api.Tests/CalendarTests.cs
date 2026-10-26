using System.Net;
using System.Net.Http.Json;
using Wheelhouse.Api.Calendar;
using Wheelhouse.Api.Families;

namespace Wheelhouse.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class CalendarTests(ApiFactory factory)
{
    private static readonly TimeZoneInfo NewYork = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    private static DateOnly TodayInNewYork() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, NewYork).DateTime);

    [Fact]
    public async Task A_demo_visitor_sees_a_calendar_for_each_person_and_one_for_the_family()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var family = await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json);
        var today = TodayInNewYork();

        var calendar = await GetCalendarAsync(visitor, today, today.AddDays(1));

        var owners = calendar.Calendars.ToDictionary(source => source.Name, source => source.MemberId);
        Assert.Equal(["Clara", "Julian", "Maplewood School District", "Marlowe Household", "Milo — School & Sports", "Nora — Activities"], owners.Keys);
        Assert.Equal(family!.Members.Single(member => member.DisplayName == "Milo").Id, owners["Milo — School & Sports"]);
        Assert.Null(owners["Marlowe Household"]);
        Assert.False(calendar.Calendars.Single(c => c.Name == "Maplewood School District").CanWrite);
        // A demo copy is never read from Google, so it has no window to run out of.
        Assert.Null(calendar.SyncedFrom);
        Assert.Null(calendar.SyncedTo);
    }

    [Fact]
    public async Task The_demo_seeds_a_busy_today_and_a_weekly_rhythm_without_calling_google()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var today = TodayInNewYork();

        var todays = await GetCalendarAsync(visitor, today, today.AddDays(1));
        var month = await GetCalendarAsync(visitor, today, today.AddDays(28));

        Assert.Contains(todays.Events, e => e.Title == "Product architecture sync" && !e.AllDay);
        var trip = Assert.Single(month.Events, e => e.Title == "Catskills Cabin Weekend");
        Assert.True(trip.AllDay);
        Assert.Equal(trip.StartDate!.Value.AddDays(2), trip.EndDate);
        // Four weeks hold eight Tue/Thu practices and four Wednesday trash nights.
        Assert.Equal(8, month.Events.Count(e => e.Title == "Soccer practice"));
        Assert.Equal(4, month.Events.Count(e => e.Title == "Roll trash & recycling barrels to curb"));
        Assert.All(todays.Events.Where(e => !e.AllDay), e => Assert.True(e.EndsAt > e.StartsAt));
    }

    [Fact]
    public async Task Events_are_found_by_the_familys_own_days_with_all_day_ends_exclusive()
    {
        using var visitor = await factory.DemoVisitorAsync();
        var family = await visitor.GetFromJsonAsync<FamilyResponse>("/api/family", ApiFactory.Json);
        var day = new DateOnly(2027, 3, 10);
        await using (var asFamily = factory.DbContextFor(family!.Id))
        {
            var source = new CalendarSource { Id = Guid.NewGuid(), FamilyId = family.Id, GoogleCalendarId = "test", Name = "Test" };
            // 11:30 PM in New York is already the next day in UTC.
            var lateStart = CalendarEndpoints.At(day, new TimeOnly(23, 30), NewYork);
            source.Events.Add(Timed(source, "Late show", lateStart, lateStart.AddMinutes(20)));
            source.Events.Add(AllDay(source, "One day", day, day.AddDays(1)));
            asFamily.CalendarSources.Add(source);
            await asFamily.SaveChangesAsync();
        }

        var thatDay = await GetCalendarAsync(visitor, day, day.AddDays(1));
        var nextDay = await GetCalendarAsync(visitor, day.AddDays(1), day.AddDays(2));

        Assert.Equal(["One day", "Late show"], thatDay.Events.Where(e => IsTest(thatDay, e)).Select(e => e.Title));
        Assert.DoesNotContain(nextDay.Events, e => IsTest(nextDay, e));
    }

    [Fact]
    public async Task A_family_sees_only_its_own_calendars()
    {
        using var visitor = await factory.DemoVisitorAsync();
        using var other = await factory.DemoVisitorAsync();
        var today = TodayInNewYork();

        var mine = await GetCalendarAsync(visitor, today, today.AddDays(7));
        var theirs = await GetCalendarAsync(other, today, today.AddDays(7));

        Assert.Empty(mine.Calendars.Select(c => c.Id).Intersect(theirs.Calendars.Select(c => c.Id)));
        Assert.All(mine.Events, e => Assert.Contains(mine.Calendars, c => c.Id == e.CalendarId));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(CalendarEndpoints.MaxDays + 1)]
    public async Task A_range_must_be_between_one_day_and_a_months_view(int days)
    {
        using var visitor = await factory.DemoVisitorAsync();
        var from = new DateOnly(2027, 1, 1);

        var response = await visitor.GetAsync($"/api/calendar?from={from:yyyy-MM-dd}&to={from.AddDays(days):yyyy-MM-dd}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_family_instance_answers_401_to_anyone_not_signed_in()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/calendar?from=2027-01-01&to=2027-01-02");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static bool IsTest(CalendarResponse calendar, EventResponse e) =>
        calendar.Calendars.Single(c => c.Id == e.CalendarId).Name == "Test";

    private static async Task<CalendarResponse> GetCalendarAsync(HttpClient client, DateOnly from, DateOnly to) =>
        (await client.GetFromJsonAsync<CalendarResponse>($"/api/calendar?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}", ApiFactory.Json))!;

    private static EventInstance Timed(CalendarSource source, string title, DateTimeOffset start, DateTimeOffset end) => new()
    {
        Id = Guid.NewGuid(), FamilyId = source.FamilyId, CalendarSourceId = source.Id, GoogleEventId = title, Title = title,
        StartsAt = start, EndsAt = end,
    };

    private static EventInstance AllDay(CalendarSource source, string title, DateOnly start, DateOnly end) => new()
    {
        Id = Guid.NewGuid(), FamilyId = source.FamilyId, CalendarSourceId = source.Id, GoogleEventId = title, Title = title,
        StartDate = start, EndDate = end,
    };
}
