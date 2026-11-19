using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Anthropic.Exceptions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Ai;
using Wheelhouse.Api.Auth;
using Wheelhouse.Api.Health;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Tests;

/// <summary>
/// The AI features' plumbing, before any endpoint uses it: off unless switched on, every call to the
/// model charged to the instance's day, the day's ceiling held, a refused key stopping calls for a while,
/// and the AI endpoints' own rate limits.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class AiPlumbingTests(ApiFactory factory)
{
    private static readonly ChatMessage[] Question = [new(ChatRole.User, "When is the dentist?")];

    private static async Task<long> SpentAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AiBudget>().SpentAsync(CancellationToken.None);
    }

    private static async Task<string> AiHealthAsync(HttpClient client)
    {
        var body = (await client.GetFromJsonAsync<HealthResponse>("/health"))!;
        return body.Checks["ai"];
    }

    [Fact]
    public async Task The_ai_features_are_off_unless_switched_on_with_a_key()
    {
        Assert.False(factory.Services.GetRequiredService<IOptions<AiOptions>>().Value.IsAvailable);
        Assert.False(factory.Demo.Services.GetRequiredService<IOptions<AiOptions>>().Value.IsAvailable);

        // Switched on without a key is still off, and no Anthropic client is ever made.
        await using var keyless = factory.Demo.WithWebHostBuilder(builder => builder.UseSetting("Ai:Enabled", true));
        Assert.False(keyless.Services.GetRequiredService<IOptions<AiOptions>>().Value.IsAvailable);
        var model = keyless.Services.GetRequiredKeyedService<IChatClient>(AiSetup.ModelKey);
        Assert.Null(model.GetService<ChatClientMetadata>());
        await Assert.ThrowsAsync<AiUnavailableException>(() => model.GetResponseAsync(Question));
        Assert.Throws<AiUnavailableException>(() => model.GetStreamingResponseAsync(Question));

        using var client = factory.CreateClient();
        Assert.Equal("Healthy", await AiHealthAsync(client));
    }

    [Fact]
    public async Task A_configured_instance_makes_an_anthropic_client_for_the_model()
    {
        await using var host = factory.Demo.WithWebHostBuilder(builder => builder
            .UseSetting("Ai:Enabled", true)
            .UseSetting("Ai:AnthropicApiKey", "test-key"));

        var model = host.Services.GetRequiredKeyedService<IChatClient>(AiSetup.ModelKey);

        Assert.Equal("claude-haiku-5-5", model.GetService<ChatClientMetadata>()?.DefaultModelId);
        Assert.NotNull(host.Services.GetRequiredService<IChatClient>().GetService<FunctionInvokingChatClient>());
    }

    [Fact]
    public async Task Each_answer_is_charged_input_plus_five_times_output_to_the_day()
    {
        var model = new FakeChatClient { Usage = new() { InputTokenCount = 300, OutputTokenCount = 40 } };
        await using var host = factory.WithAi(model);
        var before = await SpentAsync(host.Services);

        var response = await host.Services.GetRequiredService<IChatClient>().GetResponseAsync(Question);

        Assert.Equal("{}", response.Text);
        Assert.Equal(before + 300 + 5 * 40, await SpentAsync(host.Services));
        using var client = host.CreateClient();
        Assert.Equal("Healthy", await AiHealthAsync(client));
    }

    [Fact]
    public async Task An_answer_without_usage_is_still_charged()
    {
        Assert.Equal(AiOptions.UnknownUsageUnits, AiBudget.UnitsOf(null));
        Assert.Equal(AiOptions.UnknownUsageUnits, AiBudget.UnitsOf(new UsageDetails { InputTokenCount = 10 }));
        Assert.Equal(110, AiBudget.UnitsOf(new UsageDetails { InputTokenCount = 10, OutputTokenCount = 20 }));
    }

    [Fact]
    public async Task Every_step_of_a_tool_loop_is_charged()
    {
        var model = new FakeChatClient();
        model.Answer = (messages, _) => messages.Any(m => m.Contents.OfType<FunctionResultContent>().Any())
            ? new ChatResponse(new ChatMessage(ChatRole.Assistant, "Thursday at 3."))
            : new ChatResponse(new ChatMessage(ChatRole.Assistant, [new FunctionCallContent("call-1", "lookup")]));
        await using var host = factory.WithAi(model);
        var before = await SpentAsync(host.Services);
        var looked = 0;

        var response = await host.Services.GetRequiredService<IChatClient>().GetResponseAsync(Question,
            new ChatOptions { Tools = [AIFunctionFactory.Create(() => ++looked, "lookup")] });

        Assert.Equal("Thursday at 3.", response.Text);
        Assert.Equal(1, looked);
        Assert.Equal(2, model.Calls.Count);
        Assert.Equal(before + 2 * (100 + 5 * 20), await SpentAsync(host.Services));
    }

    [Fact]
    public async Task A_spent_day_stops_calls_until_midnight_utc()
    {
        var model = new FakeChatClient();
        await using var host = factory.WithAi(model, settings: ("Ai:DailyUnits", "1"));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<AiBudget>().ChargeAsync(1, CancellationToken.None);
        }

        var refused = await Assert.ThrowsAsync<AiUnavailableException>(() =>
            host.Services.GetRequiredService<IChatClient>().GetResponseAsync(Question));

        Assert.Equal(AiUnavailableReason.Budget, refused.Reason);
        Assert.InRange(refused.RetryAfter, TimeSpan.Zero, TimeSpan.FromDays(1));
        Assert.Empty(model.Calls);
        using var client = host.CreateClient();
        Assert.Equal("Degraded", await AiHealthAsync(client));
    }

    public static TheoryData<int, string> Refusals => new()
    {
        { 401, "" },
        { 403, "" },
        { 402, "" },
        { 400, """{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}""" },
    };

    [Theory]
    [MemberData(nameof(Refusals))]
    public async Task A_refused_key_or_credit_stops_calls_for_ten_minutes(int status, string body)
    {
        var model = new FakeChatClient { Fault = new AnthropicApiException("refused") { StatusCode = (HttpStatusCode)status, ResponseBody = body } };
        await using var host = factory.WithAi(model);
        var chat = host.Services.GetRequiredService<IChatClient>();

        var first = await Assert.ThrowsAsync<AiUnavailableException>(() => chat.GetResponseAsync(Question));
        var second = await Assert.ThrowsAsync<AiUnavailableException>(() => chat.GetResponseAsync(Question));

        Assert.Equal(AiUnavailableReason.Refused, first.Reason);
        Assert.Equal(AiBreaker.OpenFor, first.RetryAfter);
        Assert.Equal(AiUnavailableReason.Refused, second.Reason);
        Assert.Single(model.Calls);
        using var client = host.CreateClient();
        Assert.Equal("Degraded", await AiHealthAsync(client));
    }

    [Fact]
    public async Task Other_failures_leave_the_breaker_closed()
    {
        var model = new FakeChatClient { Fault = new AnthropicApiException("bad") { StatusCode = HttpStatusCode.BadRequest, ResponseBody = "{}" } };
        await using var host = factory.WithAi(model);
        var chat = host.Services.GetRequiredService<IChatClient>();
        using var client = host.CreateClient();

        var failed = await Assert.ThrowsAsync<AiUnavailableException>(() => chat.GetResponseAsync(Question));
        Assert.Equal(AiUnavailableReason.Failed, failed.Reason);
        Assert.Equal(BudgetedChatClient.RetryFailedAfter, failed.RetryAfter);
        Assert.Equal("Degraded", await AiHealthAsync(client));

        model.Fault = new TimeoutException();
        Assert.Equal(AiUnavailableReason.Failed, (await Assert.ThrowsAsync<AiUnavailableException>(() => chat.GetResponseAsync(Question))).Reason);

        await chat.GetResponseAsync(Question);
        Assert.Equal(3, model.Calls.Count);
        Assert.Equal("Healthy", await AiHealthAsync(client));
    }

    [Fact]
    public async Task A_cancelled_request_is_not_counted_as_a_failure()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        var model = new FakeChatClient { Fault = new OperationCanceledException(cancelled.Token) };
        await using var host = factory.WithAi(model);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            host.Services.GetRequiredService<IChatClient>().GetResponseAsync(Question, cancellationToken: cancelled.Token));

        using var client = host.CreateClient();
        Assert.Equal("Healthy", await AiHealthAsync(client));
    }

    [Fact]
    public async Task Streaming_is_not_offered()
    {
        await using var host = factory.WithAi(new FakeChatClient());
        var chat = host.Services.GetRequiredService<IChatClient>();

        await Assert.ThrowsAsync<NotSupportedException>(async () =>
        {
            await foreach (var _ in chat.GetStreamingResponseAsync(Question))
            {
            }
        });
    }

    private static HttpContext Caller(string family, string? address = null)
    {
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(WheelhouseClaims.Family, family)], "test")),
        };
        http.Connection.RemoteIpAddress = address is null ? null : IPAddress.Parse(address);
        return http;
    }

    [Fact]
    public void A_caller_gets_six_questions_a_minute()
    {
        using var limits = new AiLimits(Options.Create(new InstanceOptions { Mode = InstanceMode.Family }));
        var family = Caller("a");

        for (var i = 0; i < AiLimits.PerMinute; i++)
        {
            using var lease = limits.Acquire(family);
            Assert.True(lease.IsAcquired);
        }

        using (var seventh = limits.Acquire(family))
        {
            Assert.False(seventh.IsAcquired);
        }

        using var other = limits.Acquire(Caller("b"));
        Assert.True(other.IsAcquired);
    }

    [Fact]
    public void A_caller_has_one_question_in_flight_and_the_instance_four()
    {
        using var limits = new AiLimits(Options.Create(new InstanceOptions { Mode = InstanceMode.Family }));

        using (var first = limits.Acquire(Caller("a")))
        {
            Assert.True(first.IsAcquired);
            using var second = limits.Acquire(Caller("a"));
            Assert.False(second.IsAcquired);
        }

        var held = Enumerable.Range(0, AiLimits.InFlightPerInstance).Select(i => limits.Acquire(Caller($"f{i}"))).ToList();
        Assert.All(held, lease => Assert.True(lease.IsAcquired));
        using (var fifth = limits.Acquire(Caller("f9")))
        {
            Assert.False(fifth.IsAcquired);
        }

        held.ForEach(lease => lease.Dispose());
        using var after = limits.Acquire(Caller("f9"));
        Assert.True(after.IsAcquired);
    }

    [Fact]
    public void On_the_demo_a_caller_is_their_address()
    {
        Assert.Equal("address:203.0.113.7", AiLimits.Caller(Caller("a", "203.0.113.7"), InstanceMode.Demo));
        Assert.Equal("family:a", AiLimits.Caller(Caller("a"), InstanceMode.Demo));
        Assert.Equal("family:a", AiLimits.Caller(Caller("a", "203.0.113.7"), InstanceMode.Family));
    }
}
