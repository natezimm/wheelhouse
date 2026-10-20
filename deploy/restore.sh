#!/usr/bin/env bash
# Explicit disaster recovery: replaces one instance with its pre-release snapshot.
set -euo pipefail
umask 077
unset WHEELHOUSE_VERSION
root="${WHEELHOUSE_ROOT:-$HOME/wheelhouse}"
name="${1:?usage: restore.sh <instance> <backup-directory> --confirm-data-loss}"
backup="${2:?backup-directory required}"
[[ "${3:-}" == --confirm-data-loss ]] || { echo 'Restore discards writes since the snapshot. Supply --confirm-data-loss after review.' >&2; exit 1; }
[[ "$name" =~ ^[a-zA-Z0-9_-]+$ && -f "$backup/COMPLETE" ]] || { echo 'Invalid instance or incomplete backup' >&2; exit 1; }
[[ "$(basename "$backup")" == "$name" ]] || { echo 'Backup belongs to another instance' >&2; exit 1; }
exec 9>"$root/operations.lock"
flock -n 9 || { echo 'Another deployment or restore is running' >&2; exit 1; }
(cd "$backup"; sha256sum --check --quiet SHA256SUMS)
dir="$root/$name"
[[ -f "$dir/.env" && -f "$backup/keys.tar" ]] || { echo 'Missing instance or keys' >&2; exit 1; }
compose=(docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$backup/instance.env" --file "$backup/compose.yaml")
quiesced=false
finish() {
  status=$?
  if ((status != 0)) && [[ "$quiesced" == true ]]; then
    "${compose[@]}" stop web api || true
    echo 'Restore failed; writers are stopped. Keep this snapshot and resolve recovery before restarting.' >&2
  fi
  exit "$status"
}
trap finish EXIT
# Pull the old images before interrupting the instance. Never start an old API on the new schema.
"${compose[@]}" pull --quiet
quiesced=true
"${compose[@]}" stop web api
"${compose[@]}" up -d --wait --wait-timeout 120 db
"${compose[@]}" exec -T db dropdb -U wheelhouse --force --if-exists wheelhouse
"${compose[@]}" exec -T db createdb -U wheelhouse wheelhouse
"${compose[@]}" exec -T db pg_restore -U wheelhouse -d wheelhouse --exit-on-error --no-owner --no-acl < "$backup/database.dump"
"${compose[@]}" create --no-deps api
api="$("${compose[@]}" ps -a -q api)"
[[ -n "$api" ]] || { echo 'Missing recovery API container' >&2; exit 1; }
docker cp -a - "$api:/home/app/.aspnet/DataProtection-Keys" < "$backup/keys.tar"
# Keep a per-instance copy: other instances can remain on a different release.
cp "$backup/compose.yaml" "$dir/recovery-compose.yaml"
cp "$backup/instance.env" "$dir/.env"
compose=(docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$dir/.env" --file "$dir/recovery-compose.yaml")
"${compose[@]}" up --detach --remove-orphans --wait --wait-timeout 120
port="$(sed -n 's/^WHEELHOUSE_HTTP_PORT=//p' "$dir/.env" | tail -n 1)"
curl --fail --silent --show-error --output /dev/null "http://127.0.0.1:$port/health"
quiesced=false
echo "Restored $name. Use $dir/recovery-compose.yaml for manual Compose commands until the next release."
