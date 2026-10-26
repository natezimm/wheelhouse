using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// A test that runs only against the real Google Calendar, with a test account's credentials in
/// the environment (see docs/live-google-check.md). Without them it is skipped, so local runs and
/// pull requests never call Google.
/// </summary>
public sealed class LiveGoogleFactAttribute : FactAttribute
{
    public static readonly string? ClientId = Environment.GetEnvironmentVariable("LIVE_GOOGLE_CLIENT_ID");
    public static readonly string? ClientSecret = Environment.GetEnvironmentVariable("LIVE_GOOGLE_CLIENT_SECRET");
    public static readonly string? RefreshToken = Environment.GetEnvironmentVariable("LIVE_GOOGLE_REFRESH_TOKEN");
    public static readonly string? CalendarId = Environment.GetEnvironmentVariable("LIVE_GOOGLE_CALENDAR_ID");

    public LiveGoogleFactAttribute()
    {
        if (new[] { ClientId, ClientSecret, RefreshToken, CalendarId }.Any(string.IsNullOrWhiteSpace))
        {
            Skip = "Set LIVE_GOOGLE_CLIENT_ID, LIVE_GOOGLE_CLIENT_SECRET, LIVE_GOOGLE_REFRESH_TOKEN and LIVE_GOOGLE_CALENDAR_ID to run.";
        }
    }
}

/// <summary>
/// The real Google client against a test account's calendar, to catch Google changing what the
/// fakes assume: etags, hidden tags, visibility, repeat rules, sync tokens and explicit ids. Each
/// test cleans up after itself, and anything left by a failed run is deleted by the next one.
/// </summary>
[Trait("Category", "LiveGoogle")]
public sealed class LiveGoogleTests : IAsyncLifetime
{
    private const string Marker = "Wheelhouse live check";
    private const string Zone = "America/New_York";

    private readonly GoogleCalendarApi google = new(
        new HttpClient { Timeout = TimeSpan.FromSeconds(30) },
        Options.Create(new GoogleSignInOptions { ClientId = LiveGoogleFactAttribute.ClientId, ClientSecret = LiveGoogleFactAttribute.ClientSecret }));

    private string token = "";

    private static string Calendar => LiveGoogleFactAttribute.CalendarId!;

    /// <summary>
    /// 10 AM in New York, <paramref name="days"/> after a day three weeks out, so a run never
    /// touches today's events. Google keeps a series at the same wall-clock time across a change of
    /// clocks, so later occurrences are found the same way.
    /// </summary>
    private static DateTimeOffset At(int days) => TimeZoneInfo.ConvertTimeToUtc(
        DateTime.SpecifyKind(DateTime.UtcNow.Date.AddDays(21 + days).AddHours(10), DateTimeKind.Unspecified),
        TimeZoneInfo.FindSystemTimeZoneById(Zone));

    private static readonly DateTimeOffset Start = At(0);

    public async Task InitializeAsync()
    {
        if (string.IsNullOrWhiteSpace(LiveGoogleFactAttribute.RefreshToken)) return;
        token = await google.AccessTokenAsync(LiveGoogleFactAttribute.RefreshToken, CancellationToken.None);
        await DeleteLeftoversAsync();
    }

    public Task DisposeAsync() => string.IsNullOrEmpty(token) ? Task.CompletedTask : DeleteLeftoversAsync();

    private async Task DeleteLeftoversAsync()
    {
        var events = await google.ListEventsAsync(token, Calendar, Start.AddDays(-30), Start.AddDays(60), CancellationToken.None);
        foreach (var id in events.Where(e => e.Title.StartsWith(Marker)).Select(e => e.RecurringEventId ?? e.Id).Distinct())
        {
            await google.DeleteEventAsync(token, Calendar, id, null, CancellationToken.None);
        }
    }

    private static GoogleEventDraft Draft(string title, DateTimeOffset startsAt, string? recurrence = null) =>
        new($"{Marker}: {title}", "Library", startsAt, startsAt.AddHours(1), null, null, Zone, recurrence);

    [LiveGoogleFact]
    public async Task An_event_keeps_its_notes_people_and_privacy_and_refuses_a_stale_etag()
    {
        var people = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var added = await google.InsertEventAsync(token, Calendar,
            Draft("story time", Start) with { Description = "Bring <b>library cards</b>", MemberIds = people, Private = true },
            CancellationToken.None);

        var read = await google.GetEventAsync(token, Calendar, added.Id, CancellationToken.None);
        Assert.NotNull(read);
        Assert.Equal(Start, read.StartsAt);
        Assert.Equal("Library", read.Location);
        Assert.Equal("Bring <b>library cards</b>", read.Description);
        Assert.Equal(people, read.MemberIds);
        Assert.True(read.Private);

        // A patch that names none of them leaves notes, people and privacy as they were.
        var moved = await google.PatchEventAsync(token, Calendar, added.Id, read.ETag, Draft("story time", Start.AddHours(2)), CancellationToken.None);
        Assert.Equal(Start.AddHours(2), moved.StartsAt);
        Assert.Equal("Bring <b>library cards</b>", moved.Description);
        Assert.Equal(people, moved.MemberIds);
        Assert.True(moved.Private);
        Assert.NotEqual(read.ETag, moved.ETag);

        // The version the screen was editing is gone, so Google refuses a change or delete made with it.
        await Assert.ThrowsAsync<GoogleEventChangedException>(() =>
            google.PatchEventAsync(token, Calendar, added.Id, read.ETag, Draft("story time", Start), CancellationToken.None));
        await Assert.ThrowsAsync<GoogleEventChangedException>(() =>
            google.DeleteEventAsync(token, Calendar, added.Id, read.ETag, CancellationToken.None));

        // An empty tag clears the people, and privacy can be turned off.
        var cleared = await google.PatchEventAsync(token, Calendar, added.Id, moved.ETag,
            Draft("story time", Start.AddHours(2)) with { MemberIds = [], Private = false }, CancellationToken.None);
        Assert.Null(cleared.MemberIds);
        Assert.False(cleared.Private);

        await google.DeleteEventAsync(token, Calendar, added.Id, cleared.ETag, CancellationToken.None);
        Assert.Null(await google.GetEventAsync(token, Calendar, added.Id, CancellationToken.None));
        // Deleting again counts as done.
        await google.DeleteEventAsync(token, Calendar, added.Id, null, CancellationToken.None);
    }

    [LiveGoogleFact]
    public async Task An_all_day_event_has_an_exclusive_end_and_can_become_timed()
    {
        var day = DateOnly.FromDateTime(DateTime.UtcNow.Date.AddDays(22));
        var added = await google.InsertEventAsync(token, Calendar,
            new GoogleEventDraft($"{Marker}: field trip", null, null, null, day, day.AddDays(2), Zone), CancellationToken.None);
        Assert.Equal((day, day.AddDays(2)), (added.StartDate!.Value, added.EndDate!.Value));
        Assert.Null(added.StartsAt);

        var timed = await google.PatchEventAsync(token, Calendar, added.Id, added.ETag, Draft("field trip", Start), CancellationToken.None);
        Assert.Equal(Start, timed.StartsAt);
        Assert.Null(timed.StartDate);

        await google.DeleteEventAsync(token, Calendar, added.Id, null, CancellationToken.None);
    }

    [LiveGoogleFact]
    public async Task A_series_expands_its_rule_and_this_and_following_splits_it()
    {
        var series = await google.InsertEventAsync(token, Calendar,
            Draft("swim lessons", Start, "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4"), CancellationToken.None);
        Assert.Equal("RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4", series.Recurrence);

        var occurrences = await OccurrencesAsync(series.Id);
        Assert.Equal(new[] { At(0), At(14), At(28), At(42) }, occurrences.Select(o => o.StartsAt!.Value));
        Assert.All(occurrences, o => Assert.Equal(series.Id, o.RecurringEventId));

        // This and following: the old series ends before the second occurrence and a new one starts there.
        var until = At(14).AddSeconds(-1).UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'");
        await google.PatchEventAsync(token, Calendar, series.Id, series.ETag,
            Draft("swim lessons", Start, $"RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL={until}"), CancellationToken.None);
        var following = await google.InsertEventAsync(token, Calendar,
            Draft("swim lessons (new pool)", At(14), "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3"), CancellationToken.None);

        Assert.Equal(new[] { At(0) }, (await OccurrencesAsync(series.Id)).Select(o => o.StartsAt!.Value));
        var newPool = await OccurrencesAsync(following.Id);
        Assert.Equal(new[] { At(14), At(28), At(42) }, newPool.Select(o => o.StartsAt!.Value));

        // One occurrence changes alone, and stays part of its series.
        var moved = await google.PatchEventAsync(token, Calendar, newPool[1].Id, newPool[1].ETag,
            Draft("swim lessons (new pool)", At(28).AddHours(1)), CancellationToken.None);
        Assert.Equal(following.Id, moved.RecurringEventId);
        Assert.Equal(new[] { At(14), At(28).AddHours(1), At(42) }, (await OccurrencesAsync(following.Id)).Select(o => o.StartsAt!.Value));

        // Deleting one occurrence leaves the rest of its series.
        await google.DeleteEventAsync(token, Calendar, newPool[2].Id, newPool[2].ETag, CancellationToken.None);
        Assert.Equal(2, (await OccurrencesAsync(following.Id)).Count);

        await google.DeleteEventAsync(token, Calendar, series.Id, null, CancellationToken.None);
        await google.DeleteEventAsync(token, Calendar, following.Id, null, CancellationToken.None);
        Assert.Empty(await OccurrencesAsync(following.Id));
    }

    [LiveGoogleFact]
    public async Task A_sync_token_says_when_the_calendar_changed()
    {
        var first = await google.ListChangesAsync(token, Calendar, null, CancellationToken.None);
        var quiet = await google.ListChangesAsync(token, Calendar, first.NextSyncToken, CancellationToken.None);
        Assert.False(quiet.Changed);

        var added = await google.InsertEventAsync(token, Calendar, Draft("dentist", Start), CancellationToken.None);
        var after = await google.ListChangesAsync(token, Calendar, quiet.NextSyncToken, CancellationToken.None);
        Assert.True(after.Changed);

        await google.DeleteEventAsync(token, Calendar, added.Id, null, CancellationToken.None);
        Assert.True((await google.ListChangesAsync(token, Calendar, after.NextSyncToken, CancellationToken.None)).Changed);
    }

    [LiveGoogleFact]
    public async Task A_retried_create_with_the_same_id_returns_the_first_event()
    {
        var id = EventIdentity.ForCreation(Guid.NewGuid(), Guid.NewGuid());
        var added = await google.InsertEventAsync(token, Calendar, Draft("bake sale", Start) with { Id = id }, CancellationToken.None);
        Assert.Equal(id, added.Id);

        // Google answers 409 for the id it already has, and the client reads that event back.
        var retried = await google.InsertEventAsync(token, Calendar, Draft("bake sale", Start) with { Id = id }, CancellationToken.None);
        Assert.Equal(added with { ETag = retried.ETag }, retried);
        Assert.Single(await google.ListEventsAsync(token, Calendar, Start.AddHours(-1), Start.AddHours(2), CancellationToken.None),
            e => e.Id == id);

        await google.DeleteEventAsync(token, Calendar, id, null, CancellationToken.None);
    }

    private async Task<List<GoogleEvent>> OccurrencesAsync(string seriesId) =>
        (await google.ListEventsAsync(token, Calendar, Start.AddDays(-1), Start.AddDays(60), CancellationToken.None))
            .Where(e => e.RecurringEventId == seriesId)
            .OrderBy(e => e.StartsAt)
            .ToList();
}
