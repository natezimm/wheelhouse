using System.Security.Claims;
using System.Threading.RateLimiting;

namespace Wheelhouse.Api.Auth;

/// <summary>
/// A ceiling on every request, so one script cannot flood the API or the family's Google
/// calendar through it. A signed-in family counts as one, its phones and wall together; anyone
/// else counts by address. The pairing and demo endpoints keep their own, tighter limits.
/// </summary>
public static class RateLimits
{
    /// <summary>Requests a minute. A wall and a few phones use a small part of it.</summary>
    public const int RequestsPerMinute = 600;

    /// <summary>Changes a minute: anything but GET, HEAD and OPTIONS.</summary>
    public const int ChangesPerMinute = 120;

    public static IServiceCollection AddRateLimits(this IServiceCollection services) => services.AddRateLimiter(options =>
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.OnRejected = (context, _) =>
        {
            context.HttpContext.Response.Headers.RetryAfter = "60";
            return ValueTask.CompletedTask;
        };
        options.GlobalLimiter = PartitionedRateLimiter.CreateChained(
            PartitionedRateLimiter.Create<HttpContext, string>(http => PerMinute(Caller(http), RequestsPerMinute)),
            PartitionedRateLimiter.Create<HttpContext, string>(http => IsChange(http.Request.Method)
                ? PerMinute(Caller(http), ChangesPerMinute)
                : RateLimitPartition.GetNoLimiter("")));
    });

    /// <summary>The family for someone signed in, otherwise the address. The tests' requests have neither.</summary>
    private static string Caller(HttpContext http) =>
        http.User.FindFirstValue(WheelhouseClaims.Family) is { } family
            ? $"family:{family}"
            : http.Connection.RemoteIpAddress is { } address ? $"address:{address}" : "";

    private static RateLimitPartition<string> PerMinute(string caller, int permits) => caller.Length == 0
        ? RateLimitPartition.GetNoLimiter(caller)
        : RateLimitPartition.GetFixedWindowLimiter(caller, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = TimeSpan.FromMinutes(1),
        });

    private static bool IsChange(string method) =>
        !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method));
}
