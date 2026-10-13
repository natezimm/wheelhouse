#!/usr/bin/env bash
# Runs on the server. Moves every Wheelhouse instance to one image version:
#
#   deploy.sh v0.1.0
#
# An instance is any folder under ~/wheelhouse that holds a .env. The release workflow
# copies this script and compose.yaml to ~/wheelhouse before calling it.
set -euo pipefail
umask 077

version="${1:?usage: deploy.sh <version>, for example v0.1.0}"
if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "Not a release version: $version" >&2
  exit 1
fi

root="${WHEELHOUSE_ROOT:-$HOME/wheelhouse}"

shopt -s nullglob
env_files=("$root"/*/.env)
if (( ${#env_files[@]} == 0 )); then
  echo "No instances under $root. Create one first: see deploy/README.md." >&2
  exit 1
fi

for env_file in "${env_files[@]}"; do
  dir="$(dirname "$env_file")"
  name="$(basename "$dir")"
  echo "== $name -> $version"

  # Record the version in .env, so a later manual `docker compose up` starts the same one.
  { grep -v '^WHEELHOUSE_VERSION=' "$env_file" || true; echo "WHEELHOUSE_VERSION=$version"; } > "$env_file.new"
  mv "$env_file.new" "$env_file"

  compose=(docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$env_file" --file "$root/compose.yaml")
  "${compose[@]}" pull --quiet
  "${compose[@]}" up --detach --remove-orphans --wait

  port="$(grep '^WHEELHOUSE_HTTP_PORT=' "$env_file" | cut -d= -f2)"
  healthy=false
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error --output /dev/null "http://127.0.0.1:$port/health" 2>/dev/null; then
      healthy=true
      break
    fi
    sleep 2
  done
  if [[ "$healthy" != true ]]; then
    echo "   $name did not report healthy on port $port" >&2
    "${compose[@]}" ps >&2
    exit 1
  fi
  echo "   healthy"
done

docker image prune --force > /dev/null
