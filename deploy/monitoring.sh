#!/usr/bin/env bash
# Sets up alerts for Wheelhouse instances with Google Cloud Monitoring, from outside the server, so
# they still fire when the whole VM is gone. Run it in Cloud Shell, in the project that holds the
# server, with the address to email and each instance's domain:
#
#   bash deploy/monitoring.sh you@example.com wheelhouse.example.com home.example.com
#
# For each domain it makes two uptime checks of https://<domain>/health, every 5 minutes from
# several regions, and three alert policies that email the address:
#   - down:      /health does not answer 2xx (the VM, nginx, the web or API container, or the database).
#   - calendar:  /health's calendar check is not Healthy for 15 minutes (Google needs reconnecting,
#                a calendar or the whole worker has stopped syncing, or passes keep failing).
#   - TLS:       the HTTPS certificate expires within 14 days (certbot's renewal has stopped).
# Running it again changes nothing that already exists. docs/runbook.md says what to do for each.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo 'Usage: monitoring.sh <alert email> <domain> [<domain>...]' >&2
  exit 1
fi
email="$1"
shift
[[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+$ ]] || { echo "Not an email address: $email" >&2; exit 1; }
for host in "$@"; do
  [[ "$host" =~ ^[a-z0-9.-]+$ ]] || { echo "Not a domain: $host" >&2; exit 1; }
done

project="${CLOUDSDK_CORE_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
[[ -n "$project" ]] || { echo 'Choose the project first: gcloud config set project <project id>' >&2; exit 1; }
runbook='https://github.com/natezimm/wheelhouse/blob/main/docs/runbook.md'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gcloud services enable monitoring.googleapis.com --project "$project"

channel="$(gcloud beta monitoring channels list --project "$project" \
  --filter="type=\"email\" AND labels.email_address=\"$email\"" --format='value(name)' | head -n1)"
if [[ -z "$channel" ]]; then
  channel="$(gcloud beta monitoring channels create --project "$project" \
    --display-name="Wheelhouse alerts ($email)" --type=email \
    --channel-labels="email_address=$email" --format='value(name)')"
  echo "Created the email channel. Google may email $email to confirm it."
fi

# Prints the id of the uptime check with this display name, making it first if there is none.
uptime_check() {
  local name="$1" host="$2"
  shift 2
  local existing
  existing="$(gcloud monitoring uptime list-configs --project "$project" \
    --filter="displayName=\"$name\"" --format='value(name)' | head -n1)"
  if [[ -z "$existing" ]]; then
    existing="$(gcloud monitoring uptime create "$name" --project "$project" \
      --resource-type=uptime-url --resource-labels="host=$host,project_id=$project" \
      --protocol=https --port=443 --path=/health --validate-ssl=true \
      --period=5 --timeout=10 "$@" --format='value(name)')"
    echo "Created uptime check: $name" >&2
  fi
  basename "$existing"
}

# Makes an alert policy with this display name unless one exists. The condition is a JSON object.
policy() {
  local name="$1" condition="$2" docs="$3"
  if [[ -n "$(gcloud monitoring policies list --project "$project" \
    --filter="displayName=\"$name\"" --format='value(name)' | head -n1)" ]]; then
    return
  fi
  python3 - "$name" "$condition" "$docs" "$channel" > "$work/policy.json" <<'PY'
import json, sys
name, condition, docs, channel = sys.argv[1:]
print(json.dumps({
    'displayName': name,
    'combiner': 'OR',
    'conditions': [json.loads(condition)],
    'notificationChannels': [channel],
    'alertStrategy': {'autoClose': '1800s'},
    'documentation': {'mimeType': 'text/markdown', 'content': docs},
}))
PY
  gcloud monitoring policies create --project "$project" --policy-from-file="$work/policy.json" >/dev/null
  echo "Created alert policy: $name"
}

# Failing from more than one region for the duration, the way Google's own uptime alerts count:
# one region's bad minute is the network, not the server.
failing() {
  local name="$1" check="$2" duration="$3"
  python3 - "$name" "$check" "$duration" <<'PY'
import json, sys
name, check, duration = sys.argv[1:]
print(json.dumps({
    'displayName': name,
    'conditionThreshold': {
        'filter': 'metric.type="monitoring.googleapis.com/uptime_check/check_passed" '
                  f'AND resource.type="uptime_url" AND metric.label.check_id="{check}"',
        'aggregations': [{
            'alignmentPeriod': '1200s',
            'perSeriesAligner': 'ALIGN_NEXT_OLDER',
            'crossSeriesReducer': 'REDUCE_COUNT_FALSE',
            'groupByFields': ['resource.label.host'],
        }],
        'comparison': 'COMPARISON_GT',
        'thresholdValue': 1,
        'duration': duration,
        'trigger': {'count': 1},
    },
}))
PY
}

expiring() {
  local name="$1" check="$2"
  python3 - "$name" "$check" <<'PY'
import json, sys
name, check = sys.argv[1:]
print(json.dumps({
    'displayName': name,
    'conditionThreshold': {
        'filter': 'metric.type="monitoring.googleapis.com/uptime_check/time_until_ssl_cert_expires" '
                  f'AND resource.type="uptime_url" AND metric.label.check_id="{check}"',
        'aggregations': [{
            'alignmentPeriod': '1200s',
            'perSeriesAligner': 'ALIGN_NEXT_OLDER',
            'crossSeriesReducer': 'REDUCE_MIN',
            'groupByFields': ['resource.label.host'],
        }],
        'comparison': 'COMPARISON_LT',
        'thresholdValue': 14,
        'duration': '600s',
        'trigger': {'count': 1},
    },
}))
PY
}

for host in "$@"; do
  up="$(uptime_check "Wheelhouse $host up" "$host" --status-classes=2xx)"
  # The body names each check's status; this text appears only when the calendar's is Healthy.
  calendar="$(uptime_check "Wheelhouse $host calendar" "$host" --status-classes=2xx \
    --matcher-type=contains-string --matcher-content='"calendar":"Healthy"')"

  policy "Wheelhouse $host is down" "$(failing "/health not answering" "$up" 300s)" \
    "https://$host/health has not answered 200 for 5 minutes. See [Site down]($runbook#site-down)."
  policy "Wheelhouse $host calendar is behind Google" "$(failing "calendar not Healthy" "$calendar" 900s)" \
    "/health's calendar check has not been Healthy for 15 minutes. Its \`details.calendar\` says why. See [Calendar behind Google]($runbook#calendar-behind-google)."
  policy "Wheelhouse $host certificate expires soon" "$(expiring "certificate expires in under 14 days" "$up")" \
    "The HTTPS certificate for $host expires within 14 days, so certbot's renewal has stopped. See [Certificate expiring]($runbook#certificate-expiring)."
done

echo "Alerts for $* email $email. Google lists them under Monitoring > Alerting."
