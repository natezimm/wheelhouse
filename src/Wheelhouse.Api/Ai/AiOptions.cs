namespace Wheelhouse.Api.Ai;

/// <summary>
/// The AI features' settings, under <c>Ai</c> (<c>Ai__Enabled</c> and <c>Ai__AnthropicApiKey</c> in a
/// deployed instance, from <c>WHEELHOUSE_AI_ENABLED</c> and <c>WHEELHOUSE_ANTHROPIC_API_KEY</c>). They are
/// off unless both are set, so a family instance that never asks for them never sends anything to
/// Anthropic. See ADR 0014.
/// </summary>
public sealed class AiOptions
{
    public const string Section = "Ai";

    /// <summary>The kill switch. False (the default) makes the AI endpoints answer 404.</summary>
    public bool Enabled { get; set; }

    /// <summary>The instance's own Anthropic key, on an account with prepaid credit and auto-reload off.</summary>
    public string? AnthropicApiKey { get; set; }

    /// <summary>The model every request asks for.</summary>
    public string Model { get; set; } = "claude-haiku-5-5";

    /// <summary>
    /// Budget units a UTC day may spend: input tokens plus <see cref="OutputWeight"/> times output
    /// tokens, Haiku's price ratio. Two million is about 20 cents a day at most.
    /// </summary>
    public long DailyUnits { get; set; } = 2_000_000;

    /// <summary>How long one call to the model may take, its single retry not included.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(20);

    /// <summary>Output tokens cost five times input tokens on Haiku.</summary>
    public const int OutputWeight = 5;

    /// <summary>What a call is charged when the answer carries no usage, so a gap never makes calls free.</summary>
    public const long UnknownUsageUnits = 10_000;

    /// <summary>Whether this instance offers the AI features at all.</summary>
    public bool IsAvailable => Enabled && !string.IsNullOrWhiteSpace(AnthropicApiKey);
}
