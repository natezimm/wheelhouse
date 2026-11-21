using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Auth;

namespace Wheelhouse.Api.Ai;

/// <summary>
/// The AI endpoints. Both are POST although neither changes anything, so the Origin check covers them,
/// they count as changes against the general limit, and no question ends up in a URL. Only a parent
/// may ask: a paired wall cannot type, and its year-long cookie should not be able to spend money.
/// </summary>
public static class AiEndpoints
{
    public static IEndpointRouteBuilder MapAi(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/ai/describe", Describe).RequireAuthorization(Policies.Parent).RequireAi();
        app.MapPost("/api/ai/ask", Ask).RequireAuthorization(Policies.Parent).RequireAi();
        return app;
    }

    private static async Task<Results<Ok<EventDraftResponse>, ValidationProblem, NotFound>> Describe(
        DescribeRequest request, DescribeEvent describe, CancellationToken cancellationToken)
    {
        var text = request.Text?.Trim() ?? "";
        if (text.Length is 0 or > DescribeEvent.MaxText)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["text"] = [$"Describe the event in 1 to {DescribeEvent.MaxText} characters."],
            });
        }

        return await describe.DescribeAsync(text, cancellationToken) is { } draft
            ? TypedResults.Ok(draft)
            : TypedResults.NotFound();
    }

    private static async Task<Results<Ok<AskResponse>, ValidationProblem, NotFound>> Ask(
        AskRequest request, AskCalendar ask, CancellationToken cancellationToken)
    {
        var question = request.Question?.Trim() ?? "";
        if (question.Length is 0 or > AskCalendar.MaxQuestion)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["question"] = [$"Ask in 1 to {AskCalendar.MaxQuestion} characters."],
            });
        }

        return await ask.AskAsync(question, cancellationToken) is { } answer
            ? TypedResults.Ok(answer)
            : TypedResults.NotFound();
    }
}

public static class AiEndpointFilters
{
    /// <summary>
    /// Holds an <see cref="AiLimits"/> lease for the endpoint's whole run, answering 429 with
    /// Retry-After when the caller has used theirs, or 404 while the AI features are off.
    /// </summary>
    public static RouteHandlerBuilder RequireAi(this RouteHandlerBuilder endpoint) => endpoint.AddEndpointFilter(async (context, next) =>
    {
        var http = context.HttpContext;
        if (!http.RequestServices.GetRequiredService<IOptionsMonitor<AiOptions>>().CurrentValue.IsAvailable)
        {
            return TypedResults.NotFound();
        }

        using var lease = http.RequestServices.GetRequiredService<AiLimits>().Acquire(http);
        if (!lease.IsAcquired)
        {
            http.Response.Headers.RetryAfter = lease.TryGetMetadata(MetadataName.RetryAfter, out var after)
                ? ((int)Math.Ceiling(after.TotalSeconds)).ToString()
                : "10";
            return TypedResults.Problem(
                title: "Too many questions for now. Try again in a minute.",
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        try
        {
            return await next(context);
        }
        catch (AiUnavailableException unavailable)
        {
            http.Response.Headers.RetryAfter = ((int)Math.Ceiling(unavailable.RetryAfter.TotalSeconds)).ToString();
            return TypedResults.Problem(
                title: unavailable.Reason == AiUnavailableReason.Budget
                    ? "The assistant has done its share for today. Try again tomorrow."
                    : "The assistant is not answering right now. Try again in a moment.",
                statusCode: StatusCodes.Status503ServiceUnavailable,
                extensions: new Dictionary<string, object?> { ["reason"] = unavailable.Reason.ToString() });
        }
    });
}
