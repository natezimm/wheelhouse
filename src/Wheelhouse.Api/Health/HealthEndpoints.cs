using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Wheelhouse.Api.Health;

public static class HealthEndpoints
{
    /// <summary>
    /// Maps <c>/health</c>: 200 while the API can serve (Healthy, or Degraded when Google's side
    /// needs attention), 503 when it cannot (Unhealthy, such as the database gone). A deploy waits
    /// for 200, so a Google outage never fails a release or restarts the app; an uptime monitor
    /// watches the body's status, which names each check, without exposing exception details.
    /// </summary>
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder app)
    {
        app.MapHealthChecks("/health", new HealthCheckOptions
            {
                ResponseWriter = WriteAsync,
                ResultStatusCodes =
                {
                    [HealthStatus.Healthy] = StatusCodes.Status200OK,
                    [HealthStatus.Degraded] = StatusCodes.Status200OK,
                    [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable,
                },
            })
            .AllowAnonymous();
        return app;
    }

    private static Task WriteAsync(HttpContext context, HealthReport report) =>
        context.Response.WriteAsJsonAsync(new HealthResponse(
            report.Status.ToString(),
            report.Entries.ToDictionary(entry => entry.Key, entry => entry.Value.Status.ToString())));
}

public sealed record HealthResponse(string Status, IReadOnlyDictionary<string, string> Checks);
