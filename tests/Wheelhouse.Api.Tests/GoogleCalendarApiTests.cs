using System.Net;
using System.Text;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Tests;

/// <summary>The real Google client, talking to a stand-in for Google's HTTP endpoints.</summary>
public sealed class GoogleCalendarApiTests
{
    private static GoogleCalendarApi ApiOver(Func<HttpRequestMessage, string, (HttpStatusCode, string)> google, List<string>? sent = null) =>
        new(
            new HttpClient(new StandIn(google, sent ?? [])),
            Options.Create(new GoogleSignInOptions { ClientId = "client", ClientSecret = "secret" }));

    /// <summary>An ID token as Google sends it: header, claims and signature, base64url-encoded.</summary>
    private static string IdToken(string claims) =>
        $"e30.{Convert.ToBase64String(Encoding.UTF8.GetBytes(claims)).TrimEnd('=').Replace('+', '-').Replace('/', '_')}.sig";

    [Fact]
    public async Task A_code_becomes_a_refresh_token_for_the_account_it_names()
    {
        var sent = new List<string>();
        var api = ApiOver((_, _) => (HttpStatusCode.OK,
            $$"""{"access_token":"a","refresh_token":"r","id_token":"{{IdToken("""{"email":"family.calendars@example.com"}""")}}","scope":"openid email https://www.googleapis.com/auth/calendar"}"""), sent);

        var grant = await api.ExchangeCodeAsync("the-code", "https://example.com/api/calendar/google/callback", CancellationToken.None);

        Assert.Equal(new GoogleGrant("r", "family.calendars@example.com", "openid email https://www.googleapis.com/auth/calendar"), grant);
        var form = Assert.Single(sent);
        Assert.Contains("grant_type=authorization_code", form);
        Assert.Contains("code=the-code", form);
        Assert.Contains("client_secret=secret", form);
    }

    [Fact]
    public async Task The_calendar_list_is_read_page_by_page_with_a_fresh_access_token()
    {
        var api = ApiOver((request, _) => request.RequestUri!.AbsoluteUri switch
        {
            GoogleCalendarApi.TokenEndpoint => (HttpStatusCode.OK, """{"access_token":"fresh"}"""),
            var url when url.Contains("pageToken=next") => (HttpStatusCode.OK,
                """{"items":[{"id":"kid","summary":"Kid","accessRole":"reader"}]}"""),
            _ when request.Headers.Authorization?.Parameter == "fresh" => (HttpStatusCode.OK,
                """{"items":[{"id":"me@example.com","summary":"me@example.com","summaryOverride":"Family","backgroundColor":"#9fc6e7","accessRole":"owner","primary":true}],"nextPageToken":"next"}"""),
            _ => (HttpStatusCode.Unauthorized, "{}"),
        });

        var calendars = await api.ListCalendarsAsync("refresh", CancellationToken.None);

        Assert.Equal(
            [
                new GoogleCalendarEntry("me@example.com", "Family", "#9fc6e7", CanWrite: true, Primary: true),
                new GoogleCalendarEntry("kid", "Kid", null, CanWrite: false, Primary: false),
            ],
            calendars);
    }

    [Fact]
    public async Task An_invalid_grant_means_the_connection_was_revoked()
    {
        var api = ApiOver((_, _) => (HttpStatusCode.BadRequest, """{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"""));

        await Assert.ThrowsAsync<GoogleGrantRevokedException>(() => api.ListCalendarsAsync("refresh", CancellationToken.None));
    }

    [Fact]
    public async Task Events_in_a_window_come_back_one_per_occurrence_page_by_page()
    {
        var asked = new List<string>();
        var api = ApiOver((request, _) =>
        {
            var url = request.RequestUri!.AbsoluteUri;
            asked.Add(url);
            return url.Contains("pageToken=2")
                ? (HttpStatusCode.OK, """{"items":[{"id":"trip","status":"confirmed","summary":" Field trip ","start":{"date":"2026-10-20"},"end":{"date":"2026-10-21"}}]}""")
                : (HttpStatusCode.OK, """
                    {"items":[
                      {"id":"swim_20261016T220000Z","status":"confirmed","summary":"Swim","location":"Pool","recurringEventId":"swim","start":{"dateTime":"2026-10-16T15:00:00-07:00"},"end":{"dateTime":"2026-10-16T16:00:00-07:00"}},
                      {"id":"private","status":"confirmed","start":{"dateTime":"2026-10-17T09:00:00Z"},"end":{"dateTime":"2026-10-17T10:00:00Z"}},
                      {"id":"called-off","status":"cancelled","summary":"Called off","start":{"date":"2026-10-18"},"end":{"date":"2026-10-19"}}
                    ],"nextPageToken":"2"}
                    """);
        });

        var events = await api.ListEventsAsync("access", "alex@group.calendar.google.com",
            new DateTimeOffset(2026, 9, 16, 0, 0, 0, TimeSpan.Zero), new DateTimeOffset(2027, 4, 14, 0, 0, 0, TimeSpan.Zero), CancellationToken.None);

        Assert.Equal(
            [
                new GoogleEvent("swim_20261016T220000Z", "swim", "Swim", "Pool",
                    new DateTimeOffset(2026, 10, 16, 22, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 10, 16, 23, 0, 0, TimeSpan.Zero), null, null),
                new GoogleEvent("private", null, "Busy", null,
                    new DateTimeOffset(2026, 10, 17, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 10, 17, 10, 0, 0, TimeSpan.Zero), null, null),
                new GoogleEvent("trip", null, "Field trip", null, null, null, new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 21)),
            ],
            events);
        Assert.StartsWith($"{GoogleCalendarApi.CalendarApi}calendars/alex%40group.calendar.google.com/events?", asked[0]);
        Assert.Contains("singleEvents=true", asked[0]);
        Assert.Contains("timeMin=2026-09-16T00%3A00%3A00Z", asked[0]);
    }

    [Fact]
    public async Task Asking_what_changed_reads_every_page_and_returns_the_next_sync_token()
    {
        var asked = new List<string>();
        var api = ApiOver((request, _) =>
        {
            var url = request.RequestUri!.AbsoluteUri;
            asked.Add(url);
            return url.Contains("pageToken=2")
                ? (HttpStatusCode.OK, """{"items":[],"nextSyncToken":"after"}""")
                : (HttpStatusCode.OK, """{"items":[{"id":"swim","status":"cancelled"}],"nextPageToken":"2"}""");
        });

        var changes = await api.ListChangesAsync("access", "alex-cal", "before", CancellationToken.None);

        Assert.Equal(new GoogleChanges(Changed: true, "after"), changes);
        Assert.All(asked, url => Assert.Contains("syncToken=before", url));
    }

    [Fact]
    public async Task No_items_since_the_sync_token_means_nothing_changed()
    {
        var api = ApiOver((_, _) => (HttpStatusCode.OK, """{"items":[],"nextSyncToken":"same"}"""));

        Assert.Equal(new GoogleChanges(Changed: false, "same"), await api.ListChangesAsync("access", "alex-cal", "before", CancellationToken.None));
    }

    [Fact]
    public async Task Google_answering_gone_or_not_found_is_told_apart()
    {
        var expired = ApiOver((_, _) => (HttpStatusCode.Gone, """{"error":{"code":410}}"""));
        var missing = ApiOver((_, _) => (HttpStatusCode.NotFound, """{"error":{"code":404}}"""));

        await Assert.ThrowsAsync<GoogleSyncTokenExpiredException>(() => expired.ListChangesAsync("access", "alex-cal", "old", CancellationToken.None));
        await Assert.ThrowsAsync<GoogleCalendarGoneException>(() => missing.ListChangesAsync("access", "alex-cal", null, CancellationToken.None));
    }

    [Fact]
    public async Task A_change_names_the_version_it_was_made_to_and_clears_the_other_kind_of_time()
    {
        var sent = new List<string>();
        HttpRequestMessage? patch = null;
        var api = ApiOver((request, _) =>
        {
            patch = request;
            return (HttpStatusCode.OK, """{"id":"trip","etag":"\"2\"","status":"confirmed","summary":"Field trip","start":{"date":"2026-10-20"},"end":{"date":"2026-10-22"}}""");
        }, sent);
        var draft = new GoogleEventDraft("Field trip", null, null, null, new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 22), "America/New_York");

        var stored = await api.PatchEventAsync("access", "kid-cal", "trip", "\"1\"", draft, CancellationToken.None);

        Assert.Equal(HttpMethod.Patch, patch!.Method);
        Assert.Equal($"{GoogleCalendarApi.CalendarApi}calendars/kid-cal/events/trip", patch.RequestUri!.AbsoluteUri);
        Assert.Equal("\"1\"", Assert.Single(patch.Headers.GetValues("If-Match")));
        Assert.Contains("\"start\":{\"date\":\"2026-10-20\",\"dateTime\":null,\"timeZone\":null}", Assert.Single(sent));
        Assert.Equal(new GoogleEvent("trip", null, "Field trip", null, null, null, new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 22), "\"2\""), stored);
    }

    [Fact]
    public async Task Google_refusing_a_stale_change_or_missing_the_event_is_told_apart()
    {
        var draft = new GoogleEventDraft("Swim", null, DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch.AddHours(1), null, null, "UTC");
        var stale = ApiOver((_, _) => (HttpStatusCode.PreconditionFailed, """{"error":{"code":412}}"""));
        var deleted = ApiOver((_, _) => (HttpStatusCode.Gone, """{"error":{"code":410}}"""));

        await Assert.ThrowsAsync<GoogleEventChangedException>(() => stale.PatchEventAsync("access", "cal", "swim", "\"1\"", draft, CancellationToken.None));
        await Assert.ThrowsAsync<GoogleEventGoneException>(() => deleted.PatchEventAsync("access", "cal", "swim", "\"1\"", draft, CancellationToken.None));
        Assert.Null(await deleted.GetEventAsync("access", "cal", "swim", CancellationToken.None));
        // Deleting what is already gone counts as done.
        await deleted.DeleteEventAsync("access", "cal", "swim", "\"1\"", CancellationToken.None);
    }

    private sealed class StandIn(Func<HttpRequestMessage, string, (HttpStatusCode, string)> google, List<string> sent) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            if (body.Length > 0)
            {
                sent.Add(body);
            }

            var (status, json) = google(request, body);
            return new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        }
    }
}
