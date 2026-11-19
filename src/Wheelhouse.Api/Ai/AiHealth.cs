using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;

namespace Wheelhouse.Api.Ai;

/// <summary>
/// The AI features' part of <c>/health</c>: degraded while the breaker is open, while the day's budget
/// is spent, or when the model's last call failed. Never unhealthy: the calendar works without it, and
/// the screens offer the plain form instead. Nothing is sent to Anthropic here; the check reports what
/// the last requests found (docs/runbook.md#ai-degraded).
/// </summary>
public sealed class AiHealth(TimeProvider time, AiBreaker breaker, IOptionsMonitor<AiOptions> options) : IHealthCheck
{
    private long _lastAnswer;
    private long _lastFailure;
    private long _budgetSpentOn;

    public void Answered() => Interlocked.Exchange(ref _lastAnswer, time.GetUtcNow().UtcTicks);

    public void Failed() => Interlocked.Exchange(ref _lastFailure, time.GetUtcNow().UtcTicks);

    public void BudgetSpent() => Interlocked.Exchange(ref _budgetSpentOn, Today().DayNumber);

    private DateOnly Today() => DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);

    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var data = new Dictionary<string, object> { ["enabled"] = options.CurrentValue.IsAvailable };
        if (!options.CurrentValue.IsAvailable)
        {
            return Task.FromResult(HealthCheckResult.Healthy("The AI features are off on this instance.", data));
        }

        var answer = Interlocked.Read(ref _lastAnswer);
        var failure = Interlocked.Read(ref _lastFailure);
        if (answer > 0)
        {
            data["lastAnswerAt"] = new DateTimeOffset(answer, TimeSpan.Zero);
        }

        if (failure > 0)
        {
            data["lastFailureAt"] = new DateTimeOffset(failure, TimeSpan.Zero);
        }

        if (breaker.Remaining() is { } left)
        {
            data["breakerSeconds"] = (int)Math.Ceiling(left.TotalSeconds);
            return Task.FromResult(HealthCheckResult.Degraded("Anthropic refused the key or its credit, so nothing is sent for a while.", data: data));
        }

        if (Interlocked.Read(ref _budgetSpentOn) == Today().DayNumber)
        {
            return Task.FromResult(HealthCheckResult.Degraded("Today's AI budget is spent, so the AI features are paused until midnight UTC.", data: data));
        }

        return Task.FromResult(failure > answer
            ? HealthCheckResult.Degraded("The model's last call failed, so the screens offer the plain form.", data: data)
            : HealthCheckResult.Healthy(data: data));
    }
}
