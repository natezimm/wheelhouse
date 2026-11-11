# Observability

Wheelhouse has three layers: JSON logs on the console (always), `/health` with Cloud Monitoring alerts
([ADR 0010](adr/0010-alerts-from-cloud-monitoring-uptime-checks.md), [runbook](runbook.md)), and, when an
instance is told where to send them, OpenTelemetry traces, metrics and logs
([ADR 0013](adr/0013-opentelemetry-without-a-collector.md)). This page is about the last.

## What is collected

| Signal | Source | Examples |
| --- | --- | --- |
| Traces | ASP.NET Core, HttpClient, Npgsql, `WheelhouseTelemetry.Source` | a calendar read and its SQL; an event change and its call to Google; a sync pass (`wheelhouse.calendar.sync`) with one `wheelhouse.calendar.sync.family` span per family |
| Metrics | ASP.NET Core, SignalR connections, HttpClient, .NET runtime, Npgsql, `WheelhouseTelemetry` | request duration and status, open live connections, GC and heap, the counters below |
| Logs | Every `ILogger` call with its scopes | the request lines from `Wheelhouse.Requests`, each carrying its trace id |

Wheelhouse's own metrics ([`Diagnostics/Telemetry.cs`](../src/Wheelhouse.Api/Diagnostics/Telemetry.cs)):

| Metric | Type | Tags |
| --- | --- | --- |
| `wheelhouse.calendar.sync.families` | counter | `wheelhouse.outcome`: synced, needs_reconnect, rate_limited, failed |
| `wheelhouse.calendar.sync.duration` | histogram, seconds | `wheelhouse.sync.asked` (a parent's change asked for it) |
| `wheelhouse.google.throttled` | counter | `wheelhouse.outcome`: retried, gave_up |
| `wheelhouse.reminders` | counter | `wheelhouse.outcome`: sent, gone, failed |
| `wheelhouse.client_errors` | counter | `wheelhouse.layout`: wall, desktop, phone, other |

What never leaves: names, addresses, event titles and notes, query strings, and the paths of outbound calls
(Google's name a calendar by its address; a push endpoint's is the browser's subscription). See
[security](security.md#logs-and-health). `/health` and `/hubs` are left out of traces.

## Sampling

`Telemetry:TraceSampleRatio` (default 0.25) is the share of requests traced. The web app sends a W3C
`traceparent` on each API call and logs the trace id to the console when one fails (`core/trace-context.ts`),
so a failure seen on a screen can be found on the server. The server keeps its own ratio whatever the header
says. Metrics and logs are not sampled.

## Turning it on for an instance

Grafana Cloud's free tier holds 10,000 metric series and 50 GB each of logs and traces a month, for 14 days.

1. In Grafana Cloud, **Connections → Add new connection → OpenTelemetry (OTLP)**: create a token, and note the
   endpoint and the `Authorization=Basic …` header it shows.
2. Add both to the instance's `.env` on the server (the demo's is enough to show it):

   ```sh
   OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 of instance id:token>
   ```

3. Apply it with the instance's Compose command (`wh up -d api`, as the [runbook](runbook.md#first-look) defines `wh`).
   The instance's mode and release become `deployment.environment.name` and `service.version`.
4. Import [dashboards/wheelhouse.json](dashboards/wheelhouse.json) under **Dashboards → New → Import**.

Removing the two lines and applying again turns it off.

## On a laptop

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://dashboard:18890 docker compose --profile telemetry up --build -d
```

The app is at <http://localhost:8080> and the .NET Aspire dashboard at <http://localhost:18888>; it keeps
everything in memory and needs no account. Locally every request is traced.
