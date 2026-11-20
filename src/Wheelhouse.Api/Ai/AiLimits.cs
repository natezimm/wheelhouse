using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Ai;

/// <summary>
/// The AI endpoints' own limits, well under the API's general ones because each request costs money:
/// six a minute and forty an hour per caller, one in flight per caller and four for the instance.
/// A caller is the family, except on the demo, where every visitor is their own family and the
/// address is what one person keeps (the family when a request has no address, as the tests' do).
/// </summary>
public sealed class AiLimits(IOptions<InstanceOptions> instance) : IDisposable
{
    public const int PerMinute = 6;
    public const int PerHour = 40;
    public const int InFlightPerCaller = 1;
    public const int InFlightPerInstance = 4;

    private readonly PartitionedRateLimiter<HttpContext> _limiter = PartitionedRateLimiter.CreateChained(
        PartitionedRateLimiter.Create<HttpContext, string>(http => RateLimitPartition.GetFixedWindowLimiter(
            Caller(http, instance.Value.Mode),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = PerMinute, Window = TimeSpan.FromMinutes(1) })),
        PartitionedRateLimiter.Create<HttpContext, string>(http => RateLimitPartition.GetSlidingWindowLimiter(
            Caller(http, instance.Value.Mode),
            _ => new SlidingWindowRateLimiterOptions { PermitLimit = PerHour, Window = TimeSpan.FromHours(1), SegmentsPerWindow = 6 })),
        PartitionedRateLimiter.Create<HttpContext, string>(http => RateLimitPartition.GetConcurrencyLimiter(
            Caller(http, instance.Value.Mode),
            _ => new ConcurrencyLimiterOptions { PermitLimit = InFlightPerCaller, QueueLimit = 0 })),
        PartitionedRateLimiter.Create<HttpContext, string>(_ => RateLimitPartition.GetConcurrencyLimiter(
            "instance",
            _ => new ConcurrencyLimiterOptions { PermitLimit = InFlightPerInstance, QueueLimit = 0 })));

    public static string Caller(HttpContext http, InstanceMode mode) =>
        mode == InstanceMode.Demo && http.Connection.RemoteIpAddress is { } address
            ? $"address:{address}"
            : $"family:{http.User.FindFirstValue(WheelhouseClaims.Family)}";

    /// <summary>A lease to hold for the whole request; check <see cref="RateLimitLease.IsAcquired"/>.</summary>
    public RateLimitLease Acquire(HttpContext http) => _limiter.AttemptAcquire(http);

    public void Dispose() => _limiter.Dispose();
}
