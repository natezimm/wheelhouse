#!/usr/bin/env bash
# Nightly off-server backup: dump every instance and upload it to a Cloud Storage bucket.
# Writers keep running; pg_dump reads one consistent snapshot. The VM can only create
# objects in the bucket, so it can neither read old backups nor delete them.
set -euo pipefail
umask 077
unset WHEELHOUSE_VERSION
root="${WHEELHOUSE_ROOT:-$HOME/wheelhouse}"
read_value() { sed -n "s/^$2=//p" "$1" | tail -n 1; }
config="$root/backup.env"
if [[ ! -f "$config" ]]; then
  echo "Off-server backups are not configured: $config is missing. See deploy/README.md." >&2
  exit 0
fi
bucket="$(read_value "$config" WHEELHOUSE_BACKUP_BUCKET)"
[[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || { echo 'Invalid WHEELHOUSE_BACKUP_BUCKET' >&2; exit 1; }
# A release or restore makes its own snapshot; wait for it rather than dump mid-migration.
exec 9>"$root/operations.lock"
flock -w 1800 9 || { echo 'A deployment or restore held the lock for 30 minutes' >&2; exit 1; }
shopt -s nullglob
env_files=("$root"/*/.env)
((${#env_files[@]})) || { echo 'No instances configured' >&2; exit 1; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d "$root/.nightly-XXXXXX")"
trap 'rm -rf "$work"' EXIT

# The VM's service account token comes from the metadata server and never reaches argv or logs.
token="$(curl --fail --silent --show-error --header 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
upload() {
  # ifGenerationMatch=0 never replaces an existing object.
  printf 'Authorization: Bearer %s\n' "$token" | curl --fail --silent --show-error --output /dev/null \
    --header @- --header 'Content-Type: application/x-tar' --data-binary "@$1" \
    "https://storage.googleapis.com/upload/storage/v1/b/$bucket/o?uploadType=media&ifGenerationMatch=0&name=${2//\//%2F}"
}

backup_instance() {
  local name="$1" env_file="$2" compose_file="$3" api="$4" backup="$work/$1"
  local compose=(docker compose --project-name "wheelhouse-$name" --project-directory "$root/$name" --env-file "$env_file" --file "$compose_file")
  # Same layout as a release snapshot, so restore.sh restores either.
  mkdir -p "$backup" || return 1
  cp "$env_file" "$backup/instance.env" || return 1
  cp "$compose_file" "$backup/compose.yaml" || return 1
  "${compose[@]}" exec -T db pg_dump -U wheelhouse -d wheelhouse -Fc --no-owner --no-acl > "$backup/database.dump" || return 1
  "${compose[@]}" exec -T db pg_restore --list < "$backup/database.dump" > /dev/null || return 1
  docker cp "$api:/home/app/.aspnet/DataProtection-Keys/." - > "$backup/keys.tar" || return 1
  tar -tf "$backup/keys.tar" > /dev/null || return 1
  (cd "$backup" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS) || return 1
  touch "$backup/COMPLETE" || return 1
  tar -cf "$work/$name.tar" -C "$work" "$name" || return 1
  upload "$work/$name.tar" "$name/$stamp.tar"
}

# One instance failing must not cost the others their backup.
uploaded=0; failed=0
for env_file in "${env_files[@]}"; do
  dir="$(dirname "$env_file")"; name="$(basename "$dir")"
  [[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || continue
  compose_file="$root/compose.yaml"
  [[ ! -f "$dir/recovery-compose.yaml" ]] || compose_file="$dir/recovery-compose.yaml"
  compose=(docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$env_file" --file "$compose_file")
  db="$("${compose[@]}" ps -q db)"
  api="$("${compose[@]}" ps -a -q api)"
  if [[ -z "$db" || -z "$api" ]]; then
    echo "Skipping $name: it is not running" >&2
    continue
  fi
  if backup_instance "$name" "$env_file" "$compose_file" "$api"; then
    echo "Uploaded $name/$stamp.tar"
    uploaded=$((uploaded + 1))
  else
    echo "Backup of $name failed" >&2
    failed=$((failed + 1))
  fi
done
((failed == 0)) || exit 1
((uploaded)) || { echo 'No instance was backed up' >&2; exit 1; }
# deploy.sh warns when this file is missing or old.
date -u +%Y-%m-%dT%H:%M:%SZ > "$root/offsite-backup.last"
