#!/usr/bin/env bash
# Back up every instance before allowing the new API to apply migrations.
set -euo pipefail
umask 077
unset WHEELHOUSE_VERSION
version="${1:?usage: deploy.sh <version>}"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo 'Invalid release version' >&2; exit 1; }
root="${WHEELHOUSE_ROOT:-$HOME/wheelhouse}"
candidate="${WHEELHOUSE_COMPOSE:-$root/compose.yaml}"
exec 9>"$root/operations.lock"
flock -n 9 || { echo 'Another deployment or restore is running' >&2; exit 1; }
read_value() { sed -n "s/^$2=//p" "$1" | tail -n 1; }
shopt -s nullglob
env_files=("$root"/*/.env)
((${#env_files[@]})) || { echo 'No instances configured' >&2; exit 1; }
# Release snapshots stay on this server; only the nightly backup leaves it.
if [[ ! -f "$root/backup.env" ]]; then
  echo 'Warning: off-server backups are not configured. See "Nightly off-server backups" in deploy/README.md.' >&2
elif [[ -z "$(find "$root/offsite-backup.last" -mmin -2880 2>/dev/null)" ]]; then
  echo 'Warning: no off-server backup has succeeded in the last two days. Check wheelhouse-backup.service.' >&2
fi
run="$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$version-$$"
mkdir -p "$run"
echo "Recovery files: $run"
declare -a stopped=()
declare -A attempted=()
phase=backup
restart_on_backup_failure() {
  status=$?
  if ((status != 0)); then
    for dir in "${stopped[@]}"; do
      name="$(basename "$dir")"
      # Untouched instances can safely resume their old image/schema. An API that
      # may have migrated must only be recovered with its database snapshot.
      [[ -z "${attempted[$name]:-}" ]] || continue
      old="$(read_value "$dir/.env" WHEELHOUSE_VERSION)"
      WHEELHOUSE_VERSION="${old:-$version}" docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$dir/.env" --file "$run/$name/compose.yaml" up -d api web || true
    done
  fi
  exit "$status"
}
trap restart_on_backup_failure EXIT

# Reserve twice the current database sizes for dump overhead, plus the policy's
# fixed free-space floor. Check again after pulls, before any writer is stopped.
backup_bytes=0
for env_file in "${env_files[@]}"; do
  dir="$(dirname "$env_file")"; name="$(basename "$dir")"
  old="$(read_value "$env_file" WHEELHOUSE_VERSION)"
  old_compose="$root/compose.yaml"
  [[ ! -f "$dir/recovery-compose.yaml" ]] || old_compose="$dir/recovery-compose.yaml"
  [[ -f "$old_compose" ]] || old_compose="$candidate"
  compose=(docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$env_file" --file "$old_compose")
  db="$(WHEELHOUSE_VERSION="${old:-$version}" "${compose[@]}" ps -a -q db)"
  if [[ -n "$db" ]]; then
    size="$(WHEELHOUSE_VERSION="${old:-$version}" "${compose[@]}" exec -T db psql -U wheelhouse -d wheelhouse -Atc "SELECT pg_database_size('wheelhouse')")"
    [[ "$size" =~ ^[0-9]+$ ]] || { echo 'Cannot estimate backup size' >&2; exit 1; }
    backup_bytes=$((backup_bytes + size * 2))
  fi
  backup_bytes=$((backup_bytes + 67108864))
done
python3 "$(dirname "$0")/storage.py" check --backup-bytes "$backup_bytes"

# Pull everything first. A registry failure must not interrupt a running instance.
for env_file in "${env_files[@]}"; do
  dir="$(dirname "$env_file")"; name="$(basename "$dir")"
  WHEELHOUSE_VERSION="$version" docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$env_file" --file "$candidate" pull --quiet
done
python3 "$(dirname "$0")/storage.py" check --backup-bytes "$backup_bytes"

for env_file in "${env_files[@]}"; do
  dir="$(dirname "$env_file")"; name="$(basename "$dir")"; backup="$run/$name"
  mkdir -p "$backup"
  cp "$env_file" "$backup/instance.env"
  # First deployments have no old compose file or database to restore.
  old="$(read_value "$env_file" WHEELHOUSE_VERSION)"
  active="${old:-$version}"
  old_compose="$root/compose.yaml"
  [[ ! -f "$dir/recovery-compose.yaml" ]] || old_compose="$dir/recovery-compose.yaml"
  [[ -f "$old_compose" ]] || old_compose="$candidate"
  cp "$old_compose" "$backup/compose.yaml"
  compose=(docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$env_file" --file "$old_compose")
  db="$(WHEELHOUSE_VERSION="$active" "${compose[@]}" ps -a -q db)"
  if [[ -n "$db" ]]; then
    [[ -n "$old" ]] || { echo "Missing previous version for $name" >&2; exit 1; }
    # Quiesce HTTP and background writers; keep them stopped until every backup passes.
    stopped+=("$dir")
    WHEELHOUSE_VERSION="$active" "${compose[@]}" stop web api
    WHEELHOUSE_VERSION="$active" "${compose[@]}" exec -T db pg_dump -U wheelhouse -d wheelhouse -Fc --no-owner --no-acl > "$backup/database.dump.partial"
    WHEELHOUSE_VERSION="$active" "${compose[@]}" exec -T db pg_restore --list < "$backup/database.dump.partial" > /dev/null
    mv "$backup/database.dump.partial" "$backup/database.dump"
    api="$(WHEELHOUSE_VERSION="$active" "${compose[@]}" ps -a -q api)"
    [[ -n "$api" ]] || { echo "Missing API container for $name" >&2; exit 1; }
    # Stream a tar archive: preserve container UID/GID without chown on the VM.
    docker cp "$api:/home/app/.aspnet/DataProtection-Keys/." - > "$backup/keys.tar"
    tar -tf "$backup/keys.tar" > /dev/null
    (cd "$backup"; find . -type f ! -name SHA256SUMS ! -name COMPLETE -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
    touch "$backup/COMPLETE"
  else
    touch "$backup/FIRST_DEPLOY"
  fi
done

# No migration has run until every existing instance has a verified backup.
phase=deploy
cp "$candidate" "$root/compose.yaml.new"
mv "$root/compose.yaml.new" "$root/compose.yaml"
: > "$run/instances.tsv"
for env_file in "${env_files[@]}"; do
  dir="$(dirname "$env_file")"; name="$(basename "$dir")"
  echo "Deploying $name -> $version"
  { sed '/^WHEELHOUSE_VERSION=/d' "$env_file"; echo "WHEELHOUSE_VERSION=$version"; } > "$env_file.new"
  mv "$env_file.new" "$env_file"
  attempted[$name]=true
  compose=(docker compose --project-name "wheelhouse-$name" --project-directory "$dir" --env-file "$env_file" --file "$root/compose.yaml")
  if ! "${compose[@]}" up --detach --remove-orphans --wait --wait-timeout 120; then
    "${compose[@]}" stop web api || true
    echo "Startup failed for $name. Writers stopped; restore from $run/$name using restore.sh." >&2
    exit 1
  fi
  port="$(read_value "$env_file" WHEELHOUSE_HTTP_PORT)"
  mode="$(read_value "$env_file" WHEELHOUSE_MODE)"
  [[ "$port" =~ ^[0-9]+$ && ( "$mode" == Demo || "$mode" == Family ) ]] || { echo 'Invalid smoke configuration' >&2; exit 1; }
  healthy=false
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error --output /dev/null "http://127.0.0.1:$port/health" 2>/dev/null; then healthy=true; break; fi
    sleep 2
  done
  if [[ "$healthy" != true ]]; then
    "${compose[@]}" stop web api || true
    echo "Health failed for $name. Writers stopped; restore from $run/$name using restore.sh." >&2
    exit 1
  fi
  printf '%s\t%s\t%s\n' "$name" "$port" "$mode" >> "$run/instances.tsv"
  rm -f "$dir/recovery-compose.yaml"
done
cp "$run/instances.tsv" "$root/release-smoke.tsv"
echo 'Health checks passed. Browser smoke checks must pass before the release is complete.'
# Keep previous images and all backups for explicit migration-safe recovery.
