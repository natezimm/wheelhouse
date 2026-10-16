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
