using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Wheelhouse.Api.Ai;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// The model, for the tests, as <see cref="FakeGoogle"/> is Google: it answers from <see cref="Answer"/>
/// (or with <see cref="Reply"/>'s text) and records what each call was sent. A
/// <see cref="FunctionCallContent"/> in an answer makes the real tool loop call that tool, so the tests
/// run the pipeline the endpoints use, budget and breaker included. Nothing is ever sent to Anthropic.
/// </summary>
public sealed class FakeChatClient : IChatClient
{
    /// <summary>Usage each answer carries unless <see cref="Answer"/> sets its own.</summary>
    public UsageDetails Usage { get; set; } = new() { InputTokenCount = 100, OutputTokenCount = 20 };

    /// <summary>The text answered when <see cref="Answer"/> is not set.</summary>
    public string Reply { get; set; } = "{}";

    /// <summary>Answers one call, given what it was sent; null answers <see cref="Reply"/>.</summary>
    public Func<IReadOnlyList<ChatMessage>, ChatOptions?, ChatResponse>? Answer { get; set; }

    /// <summary>Thrown by the next call instead of answering, then cleared.</summary>
    public Exception? Fault { get; set; }

    /// <summary>Every call: the messages and options it was sent.</summary>
    public ConcurrentQueue<(IReadOnlyList<ChatMessage> Messages, ChatOptions? Options)> Calls { get; } = new();

    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
    {
        var sent = messages.ToList();
        Calls.Enqueue((sent, options));
        if (Fault is { } fault)
        {
            Fault = null;
            throw fault;
        }

        var response = Answer?.Invoke(sent, options) ?? new ChatResponse(new ChatMessage(ChatRole.Assistant, Reply));
        // A copy each time: the tool loop adds each answer's usage into the first one's.
        response.Usage ??= new UsageDetails { InputTokenCount = Usage.InputTokenCount, OutputTokenCount = Usage.OutputTokenCount };
        return Task.FromResult(response);
    }

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    public object? GetService(Type serviceType, object? serviceKey = null) => serviceType.IsInstanceOfType(this) ? this : null;

    public void Dispose()
    {
    }
}

public static class FakeChatClientHosts
{
    /// <summary>
    /// A host with the AI features on and <paramref name="model"/> in place of Anthropic, in
    /// <paramref name="mode"/> (the demo, unless a test needs a family instance), with any other
    /// <paramref name="settings"/> on top.
    /// </summary>
    public static WebApplicationFactory<Program> WithAi(
        this ApiFactory factory,
        FakeChatClient model,
        InstanceMode mode = InstanceMode.Demo,
        params (string Key, string Value)[] settings) =>
        factory.InMode(mode).WithWebHostBuilder(builder =>
        {
            builder
                .UseSetting("Ai:Enabled", true)
                .UseSetting("Ai:AnthropicApiKey", "test-key");
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureTestServices(services => services.AddKeyedSingleton<IChatClient>(AiSetup.ModelKey, model));
        });
}
