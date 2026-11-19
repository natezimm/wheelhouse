namespace Wheelhouse.Api.Ai;

/// <summary>
/// The model cannot be asked now: the day's budget is spent, the breaker is open after Anthropic
/// refused the key or its credit, or the call failed or took too long. Endpoints answer 503 with
/// <see cref="RetryAfter"/>, and the screens say to try again later or fill the form by hand.
/// </summary>
public sealed class AiUnavailableException(AiUnavailableReason reason, TimeSpan retryAfter, Exception? inner = null)
    : Exception($"The model is unavailable: {reason}.", inner)
{
    public AiUnavailableReason Reason { get; } = reason;

    public TimeSpan RetryAfter { get; } = retryAfter;
}

public enum AiUnavailableReason
{
    /// <summary>Today's budget units are spent.</summary>
    Budget,

    /// <summary>Anthropic refused the key or the account's credit; nothing is sent for a while.</summary>
    Refused,

    /// <summary>The call failed, was overloaded or timed out.</summary>
    Failed,
}
