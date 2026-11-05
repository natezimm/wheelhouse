# Runbook

What to do when an instance misbehaves. Every instance runs on the one VM as the Compose project `wheelhouse-<name>` in `~/wheelhouse/<name>/` (see [deploy/README.md](../deploy/README.md)); below, `family` stands for the instance's name and `home.example.com` for its domain. The alerts that link here come from [`deploy/monitoring.sh`](../deploy/monitoring.sh).

## First look

1. **Health.** `curl -s https://home.example.com/health | python3 -m json.tool`. `status` is Healthy, Degraded (works, but something needs attention) or Unhealthy (503). `checks` names each part; `details` says why one is not Healthy (`description`) and what it measured (`data`): for `calendar`, `lastPassAgeSeconds` (the worker's last pass over every family), `oldestSyncAgeSeconds` (the calendar furthest behind Google) and `needsReconnect`; for `weather`, when Open-Meteo last answered and last failed. `version` is the running release and `startedAt` when the API last started, so a recent time you did not cause means it restarted.
2. **Containers.** On the VM, define this for the instance first. It names the instance's own Compose file, folder and `.env` (which holds its version) as releases do, and takes the restored configuration while one is in place, so a command never picks up the newer `~/wheelhouse/compose.yaml` over a restore:

   ```bash
   i=~/wheelhouse/family
   wh() { docker compose -p "wheelhouse-$(basename "$i")" --project-directory "$i" --env-file "$i/.env" \
     -f "$([[ -f "$i/recovery-compose.yaml" ]] && echo "$i/recovery-compose.yaml" || echo ~/wheelhouse/compose.yaml)" "$@"; }
   ```

   Then `wh ps`. All three (`db`, `api`, `web`) should be `running`; `restarting` means it keeps crashing.
3. **Logs.** The API writes one JSON object per line. Each request that changed something, was refused, was slow (over 2 s) or failed (Warning for a 503, Error for other 5xx) leaves a line from `Wheelhouse.Requests` with its method, path, status, time, family and device or account id; every line written during a request carries its `RequestId`.

   ```bash
   wh logs --since 1h --no-log-prefix api | grep -v '"LogLevel":"Information"'
   # With jq (sudo apt-get install jq): only errors, short.
   wh logs --since 1h --no-log-prefix api | jq -c 'select(.LogLevel=="Error") | [.Timestamp, .Category, .Message]'
   ```

   Errors a screen hit come from `Wheelhouse.ClientErrors`. To log every request, routine reads too, add `Logging__LogLevel__Wheelhouse.Requests=Debug` to the `api` service's environment for a while. The server's nginx keeps its own record in `/var/log/nginx/access.log` (status 499 means the browser gave up waiting).

## Site down

The **is down** alert: `/health` has not answered 2xx from two regions for 5 minutes.

- **Nothing answers at all** (connection refused or timed out): the VM is stopped or nginx is down. Check the VM in the Google Cloud console and start it; on the VM, `sudo systemctl status nginx` and `sudo nginx -t`.
- **502 or 504 from nginx:** the instance's `web` container is down. `wh ps`, then `wh up -d` if it does not start on its own (the containers restart themselves after a reboot).
- **503 with `"database":"Unhealthy"`:** the database is unreachable. `wh logs --tail 50 db`. A full disk is the usual cause (see below).
- **API restarting:** its last log lines say why. A failed migration at startup exits the process; roll back with the release snapshot (deploy/README.md, "Restore one instance") rather than starting an older image on a migrated database.
- **Out of memory:** the API is capped at 160 MB. `docker inspect -f '{{.State.OOMKilled}}' wheelhouse-family-api-1` says whether it was killed for it; raise `mem_limit` in `deploy/compose.yaml` if it keeps happening.

## Calendar behind Google

The **calendar is behind Google** alert: `/health`'s `calendar` check has not been Healthy for 15 minutes. Its `description` says which case:

- **"needs connecting again":** Google refused the stored token (password changed, access removed, or the OAuth app was left in Testing for 7 days). A parent opens Settings > Calendars on their phone and taps **Connect again**. The wall shows a notice meanwhile.
- **"A calendar has not synced":** one calendar keeps failing or the shared account can no longer see it. Check that calendar is still shared to the account in Google Calendar, then under Settings > Calendars > **Choose calendars** pick it again or drop it. The API's log names the family and calendar.
- **"The calendar worker has not finished a pass":** the sync loop is stuck or stopped. `wh restart api`; if it comes back, look for what hung in the log before the restart.
- **"Google asked Wheelhouse to slow down":** Google rate-limited the account. The worker backs off by itself (doubling up to 30 minutes, never sooner than Google asked) and clears once a sync works; nothing to do unless it lasts hours, when the Calendar API's quota page in the Google Cloud console shows why.
- **"The last calendar sync failed":** look for `Could not sync the calendars of family` in the log. A Google outage clears by itself; a 403 for quota or a disabled Calendar API needs the Google Cloud console (APIs & Services).

## Certificate expiring

The **certificate expires soon** alert: the HTTPS certificate expires within 14 days, so certbot's automatic renewal has stopped. On the VM, `sudo certbot renew --dry-run` shows why (usually the domain's DNS no longer points at the VM, or port 80 is blocked), then `sudo certbot renew` and `sudo systemctl reload nginx`.

## Other problems

| Symptom | Cause and fix |
| --- | --- |
| No weather on the screens; `weather` Degraded | Open-Meteo did not answer, which happens from the VM for a while at times. It retries every 2 minutes on its own; nothing to do unless it lasts a day. |
| A wall or phone stops updating | Its live connection dropped; it recovers within 30 seconds by itself. If it does not, tap the connection pill's **Resync now**, or reload. A paired wall that says it is signed out was removed in Settings: pair it again. |
| A release failed | The Actions run's log names the step. Before migrating it stopped nothing for long; after, it prints the snapshot to restore. deploy/README.md, "Backups and release recovery". |
| Disk full | `df -h`, then `python3 ~/wheelhouse/storage.py cleanup` and `docker image prune` (never `docker volume prune`). Container logs are capped at 30 MB each. |
| Release warns no off-server backup for two days | `systemctl status wheelhouse-backup.service` and `journalctl -u wheelhouse-backup.service -n 50`. deploy/README.md, "Nightly off-server backups". |
| Reminders stop arriving | Settings > Reminders > Send a test on that phone. An iPhone takes them only from the Home Screen app. A log line for a 404 or 410 from the push service means the browser dropped the subscription: turn reminders on again. |
| A parent cannot sign in | Their address must be in `WHEELHOUSE_PARENT_EMAILS` in the instance's `.env`, and a browser that was paired as a display has to sign out (or drop the `wheelhouse` cookie) first. |
| The demo says it is busy | Too many new copies from one address (429), or the check-in failed: nginx shows 499 or 5xx for `/api/demo/visit`. A full demo replaces its oldest copy, so it never turns visitors away for that. |
