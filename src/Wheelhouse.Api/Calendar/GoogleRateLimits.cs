using System.Net;
using System.Text.Json;

namespace Wheelhouse.Api.Calendar;

/// <summary>
/// Google refused a call for quota: 429, or 403 with a <c>usageLimits</c> reason, as Calendar
/// sends for <c>rateLimitExceeded</c> and <c>userRateLimitExceeded</c>
/// (https://developers.google.com/calendar/api/guides/errors). Nothing was done, so the call can
/// be made again later. It is an <see cref="HttpRequestException"/>, so every caller that treats
/// Google as unreachable for a moment treats this the same way, and never as a calendar gone.
/// </summary>
public sealed class GoogleRateLimitedException(TimeSpan? retryAfter)
    : HttpRequestException("Google asked Wheelhouse to slow down.", null, HttpStatusCode.TooManyRequests)
{
    /// <summary>How long Google asked to wait, when it said.</summary>
    public TimeSpan? RetryAfter { get; } = retryAfter;
}

/// <summary>
/// Sits in front of every call to Google. A call refused for quota is tried again after a short
/// wait, at most <see cref="Retries"/> times and never waiting longer than <see cref="LongestWait"/>
/// at once, since a screen may be waiting on it; when Google still refuses, or asks for a longer
/// wait, the call throws <see cref="GoogleRateLimitedException"/> and the caller backs off.
/// </summary>
public sealed class GoogleRateLimitHandler(TimeProvider time) : DelegatingHandler
{
    public const int Retries = 2;

    public static readonly TimeSpan LongestWait = TimeSpan.FromSeconds(4);

    /// <summary>The first wait when Google does not say; each retry doubles it.</summary>
    public static readonly TimeSpan FirstWait = TimeSpan.FromSeconds(1);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            var response = await base.SendAsync(request, cancellationToken);
            if (!await IsRateLimitedAsync(response, cancellationToken))
            {
                return response;
            }

            var asked = RetryAfter(response);
            response.Dispose();
            var wait = asked ?? FirstWait * Math.Pow(2, attempt);
            if (attempt >= Retries || wait > LongestWait)
            {
                throw new GoogleRateLimitedException(asked);
            }

            // A request's content is buffered, so it can be sent again; nothing was done the first time.
            await Task.Delay(wait, time, cancellationToken);
        }
    }

    /// <summary>Whether Google refused for quota. A 403 for anything else (no access) is left for the caller.</summary>
    public static async Task<bool> IsRateLimitedAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            return true;
        }

        if (response.StatusCode != HttpStatusCode.Forbidden)
        {
            return false;
        }

        // Read into a buffer, so the caller can still read the body when it is some other 403.
        await response.Content.LoadIntoBufferAsync(cancellationToken);
        try
        {
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            return body.RootElement.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.Object
                && error.TryGetProperty("errors", out var errors)
                && errors.ValueKind == JsonValueKind.Array
                && errors.EnumerateArray().Any(e =>
                    e.ValueKind == JsonValueKind.Object
                    && (Text(e, "domain") == "usageLimits"
                        || Text(e, "reason") is "rateLimitExceeded" or "userRateLimitExceeded" or "quotaExceeded" or "dailyLimitExceeded"));
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private TimeSpan? RetryAfter(HttpResponseMessage response) =>
        response.Headers.RetryAfter switch
        {
            { Delta: { } delta } => delta,
            { Date: { } date } => date - time.GetUtcNow() is var left && left > TimeSpan.Zero ? left : TimeSpan.Zero,
            _ => null,
        };
}
