using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Calendar;

namespace Wheelhouse.Api.Tests;

/// <summary>The real Google client refused for quota, through <see cref="GoogleRateLimitHandler"/> as the API sends its calls.</summary>
public sealed class GoogleRateLimitTests
{
    private const string Trip = """{"id":"trip","etag":"\"2\"","status":"confirmed","summary":"Field trip","start":{"date":"2026-10-20"},"end":{"date":"2026-10-21"}}""";

    private const string RateLimited = """{"error":{"errors":[{"domain":"usageLimits","reason":"rateLimitExceeded","message":"Rate Limit Exceeded"}],"code":403,"message":"Rate Limit Exceeded"}}""";

    private const string UserRateLimited = """{"error":{"errors":[{"domain":"global","reason":"userRateLimitExceeded"}],"code":403}}""";

    private const string NoAccess = """{"error":{"errors":[{"domain":"global","reason":"forbidden","message":"Forbidden"}],"code":403,"message":"Forbidden"}}""";

    private static readonly GoogleEventDraft Draft =
        new("Field trip", null, null, null, new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 21), "America/New_York");

    /// <summary>The client over a handler that answers each call with the next of <paramref name="answers"/>.</summary>
    private static (GoogleCalendarApi Api, Google Google, WaitingTime Time) Over(bool withHandler, params HttpResponseMessage[] answers)
    {
        var google = new Google(answers);
        var time = new WaitingTime();
        HttpMessageHandler handler = withHandler ? new GoogleRateLimitHandler(time) { InnerHandler = google } : google;
        var api = new GoogleCalendarApi(new HttpClient(handler), Options.Create(new GoogleSignInOptions { ClientId = "client", ClientSecret = "secret" }));
        return (api, google, time);
    }

    private static HttpResponseMessage Answer(HttpStatusCode status, string json, TimeSpan? retryAfter = null)
    {
        var response = new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        if (retryAfter is { } wait)
        {
            response.Headers.RetryAfter = new RetryConditionHeaderValue(wait);
        }

        return response;
    }

    [Fact]
    public async Task A_change_refused_for_quota_is_sent_again_whole_after_the_wait_google_asked_for()
    {
        var (api, google, time) = Over(true,
            Answer(HttpStatusCode.TooManyRequests, "{}", retryAfter: TimeSpan.FromSeconds(3)),
            Answer(HttpStatusCode.Forbidden, UserRateLimited),
            Answer(HttpStatusCode.OK, Trip));

        var stored = await api.PatchEventAsync("access", "kid-cal", "trip", "\"1\"", Draft, CancellationToken.None);

        Assert.Equal("\"2\"", stored.ETag);
        // Google's own wait first, then twice the first wait of the handler's own.
        Assert.Equal([TimeSpan.FromSeconds(3), GoogleRateLimitHandler.FirstWait * 2], time.Waits);
        Assert.Equal(3, google.Bodies.Count);
        Assert.All(google.Bodies, body => Assert.Equal(google.Bodies[0], body));
        Assert.Contains("Field trip", google.Bodies[0]);
    }

    [Fact]
    public async Task Still_refused_after_the_retries_it_is_a_rate_limit_and_never_a_calendar_gone()
    {
        var (api, google, _) = Over(true,
            Answer(HttpStatusCode.Forbidden, RateLimited),
            Answer(HttpStatusCode.Forbidden, RateLimited),
            Answer(HttpStatusCode.Forbidden, RateLimited));

        await Assert.ThrowsAsync<GoogleRateLimitedException>(() => api.PatchEventAsync("access", "kid-cal", "trip", null, Draft, CancellationToken.None));

        Assert.Equal(1 + GoogleRateLimitHandler.Retries, google.Bodies.Count);
    }

    [Fact]
    public async Task A_longer_wait_than_a_screen_should_sit_through_is_handed_back_at_once()
    {
        var (api, google, time) = Over(true, Answer(HttpStatusCode.TooManyRequests, "{}", retryAfter: TimeSpan.FromMinutes(2)));

        var refused = await Assert.ThrowsAsync<GoogleRateLimitedException>(() =>
            api.ListChangesAsync("access", "kid-cal", "token", CancellationToken.None));

        Assert.Equal(TimeSpan.FromMinutes(2), refused.RetryAfter);
        Assert.Single(google.Bodies);
        Assert.Empty(time.Waits);
    }

    [Fact]
    public async Task A_refusal_that_is_not_about_quota_is_not_retried_and_still_means_no_access()
    {
        var (api, google, _) = Over(true, Answer(HttpStatusCode.Forbidden, NoAccess));

        await Assert.ThrowsAsync<GoogleCalendarGoneException>(() => api.ListChangesAsync("access", "kid-cal", "token", CancellationToken.None));

        Assert.Single(google.Bodies);
    }

    [Fact]
    public async Task Without_the_handler_the_client_still_reads_a_quota_refusal_as_one()
    {
        var (writes, _, _) = Over(false, Answer(HttpStatusCode.Forbidden, RateLimited));
        var (reads, _, _) = Over(false, Answer(HttpStatusCode.Forbidden, UserRateLimited));

        await Assert.ThrowsAsync<GoogleRateLimitedException>(() => writes.PatchEventAsync("access", "kid-cal", "trip", null, Draft, CancellationToken.None));
        await Assert.ThrowsAsync<GoogleRateLimitedException>(() => reads.ListEventsAsync(
            "access", "kid-cal", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddDays(1), CancellationToken.None));
    }

    [Fact]
    public async Task The_token_endpoint_refusing_for_quota_is_retried_too()
    {
        var (api, google, _) = Over(true,
            Answer(HttpStatusCode.TooManyRequests, "{}", retryAfter: TimeSpan.Zero),
            Answer(HttpStatusCode.OK, """{"access_token":"fresh"}"""));

        Assert.Equal("fresh", await api.AccessTokenAsync("refresh", CancellationToken.None));
        Assert.Equal(2, google.Bodies.Count);
        Assert.All(google.Bodies, body => Assert.Contains("grant_type=refresh_token", body));
    }

    /// <summary>Google, answering in turn, keeping each request's body as it arrived.</summary>
    private sealed class Google(HttpResponseMessage[] answers) : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));
            return answers[Bodies.Count - 1];
        }
    }

    /// <summary>A clock whose waits end at once, keeping how long each was.</summary>
    private sealed class WaitingTime : TimeProvider
    {
        public List<TimeSpan> Waits { get; } = [];

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            Waits.Add(dueTime);
            return System.CreateTimer(callback, state, TimeSpan.Zero, period);
        }
    }
}
