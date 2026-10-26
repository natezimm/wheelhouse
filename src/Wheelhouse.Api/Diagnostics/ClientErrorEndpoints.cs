using System.Security.Claims;
using Wheelhouse.Api.Auth;

namespace Wheelhouse.Api.Diagnostics;

public static class ClientErrorEndpoints
{
    /// <summary>The longest message kept; a browser's message is rarely longer.</summary>
    public const int MaxMessage = 1000;

    /// <summary>The longest stack trace kept, enough for the frames that matter.</summary>
    public const int MaxStack = 4000;

    /// <summary>
    /// A screen reports an error it hit, so a wall that has run for a week with nobody watching
    /// its console can still say what went wrong. It goes to the API's log with the family and
    /// device or account, and nowhere else. Anyone signed in to a family may report; the general
    /// change limits cap how often.
    /// </summary>
    public static IEndpointRouteBuilder MapClientErrors(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/client-errors", (ClientErrorRequest request, ClaimsPrincipal user, ILoggerFactory loggers) =>
        {
            var logger = loggers.CreateLogger("Wheelhouse.ClientErrors");
            logger.LogWarning(
                "Client error on {Page} ({Layout}) for family {FamilyId}, {Who}: {Message}\n{Stack}",
                Clip(request.Page, 200),
                Clip(request.Layout, 20),
                user.FindFirstValue(WheelhouseClaims.Family),
                Who(user),
                Clip(request.Message, MaxMessage),
                Clip(request.Stack, MaxStack));
            return TypedResults.NoContent();
        }).RequireAuthorization(Policies.Family);

        return app;
    }

    /// <summary>Which display or parent it was; a demo visitor is neither.</summary>
    private static string Who(ClaimsPrincipal user) =>
        user.FindFirstValue(WheelhouseClaims.Device) is { } device ? $"device {device}"
        : user.FindFirstValue(WheelhouseClaims.Account) is { } account ? $"account {account}"
        : "a visitor";

    /// <summary>Keeps one line short, without the newlines that could forge another log line.</summary>
    private static string Clip(string? text, int max)
    {
        if (string.IsNullOrEmpty(text))
        {
            return "";
        }

        var clipped = text.Length > max ? text[..max] : text;
        return max == MaxStack ? clipped.Replace("\r", "") : clipped.ReplaceLineEndings(" ");
    }
}

/// <summary>What a screen knows about an error: its message and stack, the page it was on, and wall, desktop or phone.</summary>
public sealed record ClientErrorRequest(string? Message, string? Stack, string? Page, string? Layout);
