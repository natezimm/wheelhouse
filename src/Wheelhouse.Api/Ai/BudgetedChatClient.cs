using System.Net;
using Anthropic.Exceptions;
using Microsoft.Extensions.AI;
using Wheelhouse.Api.Diagnostics;

namespace Wheelhouse.Api.Ai;

/// <summary>
/// Sits just outside the model, inside the tool loop, so every call to Anthropic, each step of a loop
/// included, passes the breaker and the day's budget first and is charged its usage after. Any failure
/// of the model becomes an <see cref="AiUnavailableException"/>, so endpoints answer one way to all of
/// them. Nothing here logs or tags a prompt, an answer or a family's text (AGENTS.md).
/// </summary>
public sealed class BudgetedChatClient(
    IChatClient model,
    IServiceScopeFactory scopes,
    AiBreaker breaker,
    AiHealth health,
    ILogger<BudgetedChatClient> logger) : DelegatingChatClient(model)
{
    /// <summary>How long the screens are told to wait after a failure that is not the budget or the breaker.</summary>
    public static readonly TimeSpan RetryFailedAfter = TimeSpan.FromSeconds(30);

    public override async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        if (breaker.Remaining() is { } left)
        {
            Count("breaker_open");
            throw new AiUnavailableException(AiUnavailableReason.Refused, left);
        }

        await using var scope = scopes.CreateAsyncScope();
        var budget = scope.ServiceProvider.GetRequiredService<AiBudget>();
        if (!await budget.HasRoomAsync(cancellationToken))
        {
            health.BudgetSpent();
            Count("over_budget");
            throw new AiUnavailableException(AiUnavailableReason.Budget, budget.UntilTomorrow());
        }

        ChatResponse response;
        try
        {
            response = await base.GetResponseAsync(messages, options, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is not AiUnavailableException)
        {
            health.Failed();
            if (IsRefusal(exception))
            {
                breaker.Trip();
                Count("refused");
                logger.LogError("Anthropic refused the key or its credit ({Status}); AI calls stop for {Minutes} minutes",
                    (exception as AnthropicApiException)?.StatusCode, AiBreaker.OpenFor.TotalMinutes);
                throw new AiUnavailableException(AiUnavailableReason.Refused, AiBreaker.OpenFor, exception);
            }

            Count("failed");
            // The type and status only: an error's message can quote the request.
            logger.LogWarning("The model call failed with {Error} ({Status})",
                exception.GetType().Name, (exception as AnthropicApiException)?.StatusCode);
            throw new AiUnavailableException(AiUnavailableReason.Failed, RetryFailedAfter, exception);
        }

        var units = AiBudget.UnitsOf(response.Usage);
        // Charged even if the caller has gone, since Anthropic has already counted it.
        await budget.ChargeAsync(units, CancellationToken.None);
        health.Answered();
        Count("answered");
        WheelhouseTelemetry.AiUnits.Add(units);
        return response;
    }

    public override IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("The AI features answer whole responses; streaming is not used (ADR 0014).");

    /// <summary>A refused key or credit: 401, 403, 402, or a 400 that says the credit balance is too low.</summary>
    public static bool IsRefusal(Exception exception) => exception is AnthropicApiException api && (
        api.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.PaymentRequired
        || (api.StatusCode == HttpStatusCode.BadRequest
            && api.ResponseBody.Contains("credit balance", StringComparison.OrdinalIgnoreCase)));

    private static void Count(string outcome) =>
        WheelhouseTelemetry.AiCalls.Add(1, new KeyValuePair<string, object?>("outcome", outcome));
}
