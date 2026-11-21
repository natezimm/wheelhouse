using Anthropic;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;

namespace Wheelhouse.Api.Ai;

public static class AiSetup
{
    /// <summary>The key of the model itself in DI; the tests put a fake there.</summary>
    public const string ModelKey = "ai-model";

    /// <summary>Calls the tool loop may make for one question before it gives up.</summary>
    public const int MaxToolRounds = 4;

    /// <summary>
    /// Registers the AI features' services. <see cref="IChatClient"/> is the pipeline the endpoints use:
    /// the tool loop, then <see cref="BudgetedChatClient"/>, then the model. The model is made on first
    /// use, from settings read then (AGENTS.md, "Configuration is read late"), and only when the
    /// features are on, so an instance without a key never makes an Anthropic client at all.
    /// </summary>
    public static IServiceCollection AddAi(this IServiceCollection services)
    {
        services.AddOptions<AiOptions>().BindConfiguration(AiOptions.Section);
        services.AddSingleton<AiBreaker>();
        services.AddSingleton<AiHealth>();
        services.AddSingleton<AiLimits>();
        services.AddScoped<AiBudget>();
        services.AddScoped<DescribeEvent>();
        services.AddScoped<AskCalendar>();

        services.AddKeyedSingleton<IChatClient>(ModelKey, (provider, _) =>
        {
            var options = provider.GetRequiredService<IOptions<AiOptions>>().Value;
            if (!options.IsAvailable)
            {
                return new NoModel();
            }

            // The SDK's own HttpClient: one retry for a dropped connection, a 429 or a 5xx, and a short
            // timeout, since a parent is waiting on a screen.
            var client = new AnthropicClient
            {
                ApiKey = options.AnthropicApiKey,
                MaxRetries = 1,
                Timeout = options.Timeout,
            };
            return client.AsIChatClient(options.Model);
        });

        services.AddSingleton(provider => new ChatClientBuilder(provider.GetRequiredKeyedService<IChatClient>(ModelKey))
            // No logger, so no log level can ever put the tools' arguments or results, which hold event titles, in the log.
            .UseFunctionInvocation(Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance, loop =>
            {
                loop.MaximumIterationsPerRequest = MaxToolRounds;
                // A tool's exception text never reaches the model, or the screens.
                loop.IncludeDetailedErrors = false;
            })
            .Use((inner, services) => new BudgetedChatClient(
                inner,
                services.GetRequiredService<IServiceScopeFactory>(),
                services.GetRequiredService<AiBreaker>(),
                services.GetRequiredService<AiHealth>(),
                services.GetRequiredService<ILogger<BudgetedChatClient>>()))
            .Build(provider));

        return services;
    }

    /// <summary>The model on an instance with the features off: never asked, since the endpoints answer 404 first.</summary>
    private sealed class NoModel : IChatClient
    {
        public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
            throw new AiUnavailableException(AiUnavailableReason.Failed, BudgetedChatClient.RetryFailedAfter);

        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
            throw new AiUnavailableException(AiUnavailableReason.Failed, BudgetedChatClient.RetryFailedAfter);

        public object? GetService(Type serviceType, object? serviceKey = null) => null;

        public void Dispose()
        {
        }
    }
}
