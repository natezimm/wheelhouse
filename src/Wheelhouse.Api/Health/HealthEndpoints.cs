using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Wheelhouse.Api.Health;

public static class HealthEndpoints
{
    /// <summary>
    /// Maps <c>/health</c>: 200 when every check passes, 503 otherwise. The body names each
    /// check so an uptime monitor's alert says what broke, without exposing exception details.
    /// </summary>
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder app)
    {
        app.MapHealthChecks("/health", new HealthCheckOptions { ResponseWriter = WriteAsync });
        return app;
    }

    private static Task WriteAsync(HttpContext context, HealthReport report) =>
        context.Response.WriteAsJsonAsync(new HealthResponse(
            report.Status.ToString(),
            report.Entries.ToDictionary(entry => entry.Key, entry => entry.Value.Status.ToString())));
}

public sealed record HealthResponse(string Status, IReadOnlyDictionary<string, string> Checks);
