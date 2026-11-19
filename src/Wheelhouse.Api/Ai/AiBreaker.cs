namespace Wheelhouse.Api.Ai;

/// <summary>
/// Stops calls to Anthropic for a while after it refuses the key (401, 403) or the account's credit
/// (402, or a 400 that says the credit is too low), so a revoked key or an empty account is not asked
/// again on every request. Every other failure leaves it closed.
/// </summary>
public sealed class AiBreaker(TimeProvider time)
{
    /// <summary>How long a refusal keeps the breaker open.</summary>
    public static readonly TimeSpan OpenFor = TimeSpan.FromMinutes(10);

    private long _openUntil;

    public void Trip() => Interlocked.Exchange(ref _openUntil, (time.GetUtcNow() + OpenFor).UtcTicks);

    /// <summary>How long is left, or null when calls may go.</summary>
    public TimeSpan? Remaining()
    {
        var until = Interlocked.Read(ref _openUntil);
        var left = new DateTimeOffset(until, TimeSpan.Zero) - time.GetUtcNow();
        return until > 0 && left > TimeSpan.Zero ? left : null;
    }
}
