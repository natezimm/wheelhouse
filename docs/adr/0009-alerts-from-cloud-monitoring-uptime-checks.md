# 0009. Alerts come from Cloud Monitoring uptime checks of /health

**Status:** Accepted, November 2026

## Context

Wheelhouse runs on one small Google Cloud VM, with the demo and the family's instance side by side. Until now nothing told anyone when an instance stopped answering, when the calendar fell behind Google (an expired Google connection, a calendar the account lost, a stuck sync worker), or when HTTPS renewal stopped; the family would notice first. `/health` already knew most of this, but only a release's deploy step read it.

The options were a watcher on the VM itself (a systemd timer that curls `/health` and sends mail or a push), a third-party uptime service, or Google Cloud Monitoring's uptime checks in the project that already holds the VM.

## Decision

Cloud Monitoring uptime checks read each instance's public `https://<domain>/health` every 5 minutes from several regions, and alert policies email the owner (`deploy/monitoring.sh`):

- **Down:** not 2xx from more than one region for 5 minutes.
- **Calendar behind Google:** the body's `"calendar":"Healthy"` missing from more than one region for 15 minutes, which outlasts a single failed pass.
- **Certificate expiring:** under 14 days left.

`/health` grew what a person needs once an alert fires: each check's description and measurements (the last sync pass's age, the stalest calendar's age, how many connections need reconnecting), the running version and when the API started, plus a `weather` check. It stays public and says nothing of any family's. Each alert links to a section of [docs/runbook.md](../runbook.md).

## Consequences

- An alert still fires when the VM, its network or nginx is down, which a watcher on the VM could not report, and there is no mail server or third-party account to keep.
- The checks see what a visitor sees: DNS, HTTPS, nginx, the web container and the API together.
- Setup is a script run once in Cloud Shell rather than part of each release; a new instance needs it run again with its domain.
- Off-server backups are not watched this way: each release still warns when none has succeeded for two days.
- The demo gets the same checks; its calendar check is always Healthy, since it never syncs with Google.
