using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Wheelhouse.Api.Instance;

namespace Wheelhouse.Api.Health;

public static class HealthEndpoints
{
    /// <summary>
    /// Maps <c>/health</c>: 200 while the API can serve (Healthy, or Degraded when Google's side
    /// or the weather needs attention), 503 when it cannot (Unhealthy, such as the database gone).
    /// A deploy waits for 200, so a Google outage never fails a release or restarts the app; an
    /// uptime monitor watches the body, which names each check's status and, under
    /// <c>details</c>, what it found (how long ago the calendar last synced, for one), without
    /// exposing exception details or anything of a family's. See docs/runbook.md.
    /// </summary>
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder app)
    {
        var started = app.ServiceProvider.GetRequiredService<TimeProvider>().GetUtcNow();
        app.MapHealthChecks("/health", new HealthCheckOptions
            {
                ResponseWriter = (context, report) => WriteAsync(context, report, started),
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

    private static Task WriteAsync(HttpContext context, HealthReport report, DateTimeOffset started)
    {
        var instance = context.RequestServices.GetRequiredService<IOptions<InstanceOptions>>().Value;
        context.Response.Headers.CacheControl = "no-store";
        return context.Response.WriteAsJsonAsync(new HealthResponse(
            report.Status.ToString(),
            report.Entries.ToDictionary(entry => entry.Key, entry => entry.Value.Status.ToString()),
            instance.Version,
            started,
            report.Entries.ToDictionary(entry => entry.Key, entry => new HealthCheckDetail(
                entry.Value.Status.ToString(),
                // A check that threw has the exception's message as its description, which can
                // name internal addresses; its log line keeps that, the public answer does not.
                entry.Value.Exception is null ? entry.Value.Description : null,
                (long)entry.Value.Duration.TotalMilliseconds,
                entry.Value.Data.Count > 0 ? entry.Value.Data : null))));
    }
}

/// <summary>
/// The overall status and each check's status by name, kept as they were for monitors that read
/// them, then the release, when this process started, and each check's details.
/// </summary>
public sealed record HealthResponse(
    string Status,
    IReadOnlyDictionary<string, string> Checks,
    string? Version = null,
    DateTimeOffset? StartedAt = null,
    IReadOnlyDictionary<string, HealthCheckDetail>? Details = null);

/// <summary>One check: its status, why it is not healthy, how long it took, and what it measured.</summary>
public sealed record HealthCheckDetail(
    string Status,
    string? Description,
    long DurationMs,
    IReadOnlyDictionary<string, object>? Data);
