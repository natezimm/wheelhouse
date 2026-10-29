#!/usr/bin/env bash
# Runs on the release runner: moves one kind of instance to the release, then checks each in a browser.
# Needs the runner's `server` SSH host, VERSION, REGISTRY_USER and REGISTRY_TOKEN.
set -euo pipefail
mode="${1:?usage: release-phase.sh <Demo|Family>}"
[[ "$mode" == Demo || "$mode" == Family ]] || { echo 'Mode must be Demo or Family' >&2; exit 1; }
: "${VERSION:?}" "${REGISTRY_USER:?}" "${REGISTRY_TOKEN:?}"

# The images are private, so the server signs in to the registry with the job's short-lived
# token for the length of the deploy and signs out again afterwards.
printf '%s' "$REGISTRY_TOKEN" | ssh server "docker login ghcr.io --username '$REGISTRY_USER' --password-stdin"
ssh server "WHEELHOUSE_COMPOSE=\$HOME/wheelhouse/compose.candidate.yaml bash ~/wheelhouse/deploy.sh '$VERSION' '$mode'; status=\$?; docker logout ghcr.io; exit \$status"

instances="${RUNNER_TEMP:-/tmp}/instances-$mode.tsv"
ssh server 'cat ~/wheelhouse/release-smoke.tsv' > "$instances"
index=0
while IFS=$'\t' read -r name port instance_mode; do
  [[ "$port" =~ ^[0-9]+$ && "$instance_mode" == "$mode" ]]
  index=$((index + 1))
  control="${RUNNER_TEMP:-/tmp}/wheelhouse-smoke-$mode-$index"
  ssh -M -S "$control" -fNT -o ExitOnForwardFailure=yes -L "127.0.0.1:18080:127.0.0.1:$port" server
  trap 'ssh -S "$control" -O exit server 2>/dev/null || true' EXIT
  SMOKE_URL=http://127.0.0.1:18080 SMOKE_MODE="$mode" SMOKE_INDEX="$mode-$index" node deploy/smoke.mjs
  ssh -S "$control" -O exit server
  trap - EXIT
done < "$instances"
# Family instances only move after a demo has taken the release and passed its browser check.
[[ "$mode" == Family || "$index" -gt 0 ]] || { echo '::error::No demo instance was deployed and checked.' >&2; exit 1; }
echo "$mode instances deployed and checked: $index" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
