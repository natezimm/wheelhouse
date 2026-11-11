using System.Diagnostics;
using System.Diagnostics.Metrics;
using OpenTelemetry;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace Wheelhouse.Api.Diagnostics;

/// <summary>
/// Wheelhouse's own traces and metrics, beside what ASP.NET Core, SignalR, HttpClient and Npgsql report.
/// They are base-library objects: with no exporter configured nothing listens and they cost almost nothing.
/// No tag or attribute holds a name, an address, an event's title or a query string (AGENTS.md); family,
/// device and account ids are the most a span names, as the request log does.
/// </summary>
public static class WheelhouseTelemetry
{
    public const string Name = "Wheelhouse";

    public static readonly ActivitySource Source = new(Name);

    private static readonly Meter Meter = new(Name);

    /// <summary>Families synced with Google, tagged with how each went.</summary>
    public static readonly Counter<long> FamilySyncs =
        Meter.CreateCounter<long>("wheelhouse.calendar.sync.families", "{family}", "Families synced with Google, by outcome.");

    /// <summary>How long a whole sync pass took.</summary>
    public static readonly Histogram<double> SyncDuration =
        Meter.CreateHistogram<double>("wheelhouse.calendar.sync.duration", "s", "How long a calendar sync pass took.");

    /// <summary>Google's quota refusals, tagged with whether the handler retried or gave up.</summary>
    public static readonly Counter<long> GoogleThrottled =
        Meter.CreateCounter<long>("wheelhouse.google.throttled", "{response}", "Google quota refusals, retried or given up.");

    /// <summary>Reminders pushed to browsers, tagged with the push service's answer.</summary>
    public static readonly Counter<long> Reminders =
        Meter.CreateCounter<long>("wheelhouse.reminders", "{reminder}", "Reminder pushes, by outcome.");

    /// <summary>Errors browsers reported through /api/client-errors.</summary>
    public static readonly Counter<long> ClientErrors =
        Meter.CreateCounter<long>("wheelhouse.client_errors", "{error}", "Errors reported by browsers.");
}

/// <summary>
/// Sends traces, metrics and logs over OTLP when <c>OTEL_EXPORTER_OTLP_ENDPOINT</c> is set, and registers
/// nothing when it is not, so the tests and a fresh clone need no collector. See docs/observability.md and
/// ADR 0011.
/// </summary>
public static class TelemetrySetup
{
    public const string EndpointVariable = "OTEL_EXPORTER_OTLP_ENDPOINT";

    /// <summary>The share of requests traced, unless <c>Telemetry:TraceSampleRatio</c> says otherwise.</summary>
    public const double DefaultTraceSampleRatio = 0.25;

    /// <summary>
    /// The endpoint is read from the process environment, not from configuration: it is an
    /// OpenTelemetry variable the exporter reads the same way, and the tests' configuration, which
    /// only arrives once the host is built, never sets it (AGENTS.md, "Configuration is read late").
    /// </summary>
    public static bool AddTelemetry(this WebApplicationBuilder builder, string? endpoint = null)
    {
        endpoint ??= Environment.GetEnvironmentVariable(EndpointVariable);
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            return false;
        }

        builder.Logging.AddOpenTelemetry(logs =>
        {
            logs.IncludeScopes = true;
            logs.IncludeFormattedMessage = true;
        });

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(resource => resource.AddService("wheelhouse"))
            .WithTracing(tracing => tracing
                .SetSampler(services =>
                {
                    // Read when the provider is built, so it is the configuration the host ended up with.
                    var ratio = services.GetRequiredService<IConfiguration>().GetValue("Telemetry:TraceSampleRatio", DefaultTraceSampleRatio);
                    var sampler = new TraceIdRatioBasedSampler(ratio);
                    // The server decides: a browser's traceparent cannot make every request traced.
                    return new ParentBasedSampler(sampler, remoteParentSampled: sampler, remoteParentNotSampled: sampler);
                })
                .AddSource(WheelhouseTelemetry.Name)
                .AddSource("Npgsql")
                // /health is the uptime checks, and a /hubs request is a socket that stays open for hours.
                .AddAspNetCoreInstrumentation(o => o.Filter = context =>
                    !context.Request.Path.StartsWithSegments("/health") && !context.Request.Path.StartsWithSegments("/hubs"))
                .AddHttpClientInstrumentation(o => o.EnrichWithHttpRequestMessage = (activity, request) =>
                {
                    // Google's paths name calendars by their address and a push endpoint's path is the
                    // browser's subscription, so outbound spans keep only the host.
                    if (request.RequestUri is { } uri)
                    {
                        activity.SetTag("url.full", $"{uri.Scheme}://{uri.Host}");
                    }
                }))
            .WithMetrics(metrics => metrics
                .AddMeter(WheelhouseTelemetry.Name)
                .AddMeter("Npgsql")
                .AddMeter("Microsoft.AspNetCore.Http.Connections")
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation())
            .WithLogging()
            .UseOtlpExporter();
        return true;
    }
}
