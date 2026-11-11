# 0013. OpenTelemetry, sent straight to a free hosted backend

**Status:** Accepted, November 2026

## Context

Wheelhouse already writes one JSON log line per request and has a detailed `/health` with uptime alerts (ADR 0010). What it could not show was where a slow request spent its time, how a sync pass went family by family, or how often Google throttled it. It shares a small VM with other sites, so whatever collects that has to add little memory and should cost nothing.

## Decision

- Instrument with OpenTelemetry: ASP.NET Core, SignalR's connection meter, HttpClient, Npgsql and the .NET runtime, plus Wheelhouse's own `ActivitySource` and `Meter` (`Diagnostics/Telemetry.cs`) for sync passes, Google throttling, reminder pushes and client errors.
- Export over OTLP from the API straight to Grafana Cloud's free tier. No collector, Prometheus, Loki or Jaeger runs on the VM.
- Turn it on per instance with the standard `OTEL_EXPORTER_OTLP_ENDPOINT` variable, and register nothing without it, so the tests and a fresh clone need nothing extra. A local Compose profile runs the Aspire dashboard instead.
- Sample a quarter of requests, decided on the server whatever a browser's `traceparent` asks. Leave `/health` and `/hubs` out of traces, and keep only the host of outbound calls.

## Consequences

- Grafana Cloud becomes an outside service that holds ids and SQL text for 14 days when an instance turns it on (docs/security.md); the family instance can stay off.
- About 26 MB more per API with it on (measured on Know Ball, the same stack), inside the 160 MB limit.
- Exports are batched, so a crash can lose its last few seconds of telemetry. Switching backends is a change of two variables.
