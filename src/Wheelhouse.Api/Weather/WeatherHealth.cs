using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Wheelhouse.Api.Weather;

/// <summary>
/// The weather's part of <c>/health</c>: degraded while Open-Meteo's last answer was a failure, when
/// the screens leave the weather out. That is only ever degraded, never unhealthy: the calendar works
/// without it, and Open-Meteo is sometimes slow from the server for a while. Nothing is asked of
/// Open-Meteo here; the check reports what the screens' last requests found.
/// </summary>
public sealed class WeatherHealth(TimeProvider time) : IHealthCheck
{
    private long _lastAnswer;
    private long _lastFailure;

    public void Answered() => Interlocked.Exchange(ref _lastAnswer, time.GetUtcNow().UtcTicks);

    public void Failed() => Interlocked.Exchange(ref _lastFailure, time.GetUtcNow().UtcTicks);

    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var answer = Interlocked.Read(ref _lastAnswer);
        var failure = Interlocked.Read(ref _lastFailure);
        var data = new Dictionary<string, object>();
        if (answer > 0)
        {
            data["lastAnswerAt"] = new DateTimeOffset(answer, TimeSpan.Zero);
        }

        if (failure > 0)
        {
            data["lastFailureAt"] = new DateTimeOffset(failure, TimeSpan.Zero);
        }

        return Task.FromResult(failure > answer
            ? HealthCheckResult.Degraded("Open-Meteo did not answer the last request, so the screens leave the weather out.", data: data)
            : HealthCheckResult.Healthy(data: data));
    }
}
