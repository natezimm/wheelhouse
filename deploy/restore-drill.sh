#!/usr/bin/env bash
# Restore drill: prove a backup can be restored without touching the instance it came from.
# It restores the backup into a scratch PostgreSQL, counts its rows (beside the live instance's
# when it runs on this server), checks that the backup's Data Protection keys can decrypt the
# secrets in its database, and starts the backup's own API on it and asks /health.
# The scratch containers sit on an internal Docker network with no way out, so the scratch API
# can neither call Google nor send reminders. Everything it made is removed when it finishes.
# See docs/restore-drill.md.
set -euo pipefail
umask 077
started=$SECONDS
root="${WHEELHOUSE_ROOT:-$HOME/wheelhouse}"
usage='usage: restore-drill.sh <backup.tar | backup-directory> [--database-only]'
source="${1:?$usage}"
api_check=true
case "${2:-}" in
  '') ;;
  --database-only) api_check=false ;;
  *) echo "$usage" >&2; exit 2 ;;
esac
[[ -e "$source" ]] || { echo "No such backup: $source" >&2; exit 1; }
read_value() { sed -n "s/^$2=//p" "$1" | tail -n 1; }
step() { printf '\n== %s (%ss)\n' "$1" "$((SECONDS - started))"; }

# A drill is light, but it should not compete with a release or restore for memory and disk.
if [[ -d "$root" ]]; then
  exec 9>"$root/operations.lock"
  flock -n 9 || { echo 'A deployment or restore is running; try the drill again afterwards' >&2; exit 1; }
fi

suffix="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
net="wheelhouse-drill-$suffix"
db="$net-db"
api="$net-api"
base="${TMPDIR:-/tmp}"
[[ ! -d "$root" ]] || base="$root"
scratch="$(mktemp -d "$base/.drill-XXXXXX")"
cleanup() {
  status=$?
  docker rm --force --volumes "$api" "$db" > /dev/null 2>&1 || true
  docker network rm "$net" > /dev/null 2>&1 || true
  # The unpacked backup holds family data and credentials.
  rm -rf "$scratch"
  if ((status == 0)); then
    printf '\nDrill passed in %ss. Scratch containers and files are removed.\n' "$((SECONDS - started))"
  else
    printf '\nDRILL FAILED (exit %s) after %ss. Scratch containers and files are removed.\n' "$status" "$((SECONDS - started))" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

step 'Checking the backup'
if [[ -d "$source" ]]; then
  backup="$(cd "$source" && pwd)"
else
  # A nightly archive holds one folder named after its instance.
  mkdir "$scratch/unpacked"
  tar -xf "$source" -C "$scratch/unpacked" --no-same-owner
  entries=("$scratch/unpacked"/*)
  ((${#entries[@]} == 1)) && [[ -d "${entries[0]}" ]] || { echo 'The archive should hold exactly one instance folder' >&2; exit 1; }
  backup="${entries[0]}"
fi
name="$(basename "$backup")"
[[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Unexpected instance name: $name" >&2; exit 1; }
[[ -f "$backup/COMPLETE" ]] || { echo 'Incomplete backup: no COMPLETE marker' >&2; exit 1; }
for file in SHA256SUMS database.dump keys.tar instance.env compose.yaml; do
  [[ -f "$backup/$file" ]] || { echo "Backup is missing $file" >&2; exit 1; }
done
(cd "$backup" && sha256sum --check --quiet SHA256SUMS)
mode="$(read_value "$backup/instance.env" WHEELHOUSE_MODE)"
version="$(read_value "$backup/instance.env" WHEELHOUSE_VERSION)"
postgres="$(sed -n 's/^ *image: *\(postgres:[^ ]*\) *$/\1/p' "$backup/compose.yaml" | head -n 1)"
[[ -n "$postgres" ]] || { echo "No PostgreSQL image in the backup's compose.yaml" >&2; exit 1; }
echo "Instance $name ($mode), release ${version:-unknown}, $postgres"
echo 'Checksums match.'

step 'Starting a scratch PostgreSQL'
docker network create --internal "$net" > /dev/null
password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
docker run --detach --name "$db" --network "$net" --memory 256m \
  --env POSTGRES_USER=wheelhouse --env POSTGRES_DB=wheelhouse --env "POSTGRES_PASSWORD=$password" \
  "$postgres" postgres -c shared_buffers=32MB > /dev/null
# initdb's temporary server accepts Unix sockets before setup is complete.
# TCP readiness waits for the final server, avoiding its bootstrap restart.
for _ in $(seq 60); do
  docker exec "$db" pg_isready --quiet --host 127.0.0.1 -U wheelhouse -d wheelhouse && break
  sleep 1
done
docker exec "$db" pg_isready --quiet --host 127.0.0.1 -U wheelhouse -d wheelhouse || { echo 'Scratch PostgreSQL did not start' >&2; exit 1; }

step 'Restoring the dump'
restore_from=$SECONDS
created="$(docker exec -i "$db" pg_restore --list < "$backup/database.dump" | sed -n 's/^;[[:space:]]*Archive created at //p')"
docker exec -i "$db" pg_restore -U wheelhouse -d wheelhouse --exit-on-error --no-owner --no-acl < "$backup/database.dump"
echo "Dump taken $created; restored in $((SECONDS - restore_from))s."

sql() { docker exec "$db" psql -U wheelhouse -d wheelhouse --no-psqlrc -At -v ON_ERROR_STOP=1 -c "$1"; }
# Exact row counts for every table, in one query.
count_query="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"

step 'Counting rows'
sql "$count_query" | tr '|' '\t' > "$scratch/backup-counts.tsv"
live_note=''
live_dir="$root/$name"
if [[ -f "$live_dir/.env" ]]; then
  live_compose="$root/compose.yaml"
  [[ ! -f "$live_dir/recovery-compose.yaml" ]] || live_compose="$live_dir/recovery-compose.yaml"
  live=(docker compose --project-name "wheelhouse-$name" --project-directory "$live_dir" --env-file "$live_dir/.env" --file "$live_compose")
  # Read-only: the live database is only ever asked to count.
  if [[ -n "$("${live[@]}" ps -q db 2> /dev/null)" ]] \
    && "${live[@]}" exec -T --env PGOPTIONS='-c default_transaction_read_only=on' db \
      psql -U wheelhouse -d wheelhouse --no-psqlrc -At -v ON_ERROR_STOP=1 -c "$count_query" 2> /dev/null | tr '|' '\t' > "$scratch/live-counts.tsv"; then
    live_note="Live is the running $name instance now, so it is ahead by whatever changed since the backup."
  else
    rm -f "$scratch/live-counts.tsv"
  fi
fi
python3 - "$scratch/backup-counts.tsv" "$scratch/live-counts.tsv" <<'PY'
import sys
from pathlib import Path
def read(path):
    p = Path(path)
    return dict(line.split('\t') for line in p.read_text().splitlines() if line) if p.exists() else None
backup, live = read(sys.argv[1]), read(sys.argv[2])
tables = sorted(set(backup) | set(live or {}))
width = max(len(t) for t in tables)
print(f"{'Table':<{width}}  {'Backup':>8}" + (f"  {'Live':>8}" if live is not None else ''))
for t in tables:
    line = f"{t:<{width}}  {backup.get(t, '-'):>8}"
    if live is not None:
        line += f"  {live.get(t, '-'):>8}"
    print(line)
PY
[[ -z "$live_note" ]] || echo "$live_note"
migration="$(sql 'SELECT max("MigrationId") FROM "__EFMigrationsHistory"')"
[[ -n "$migration" ]] || { echo 'No migrations recorded: the dump holds no Wheelhouse schema' >&2; exit 1; }
echo "Latest migration: $migration"
families="$(awk -F'\t' '$1 == "Families" { print $2 }' "$scratch/backup-counts.tsv")"
if [[ "$mode" == Family ]] && ((${families:-0} < 1)); then
  echo 'A family instance backup holds no family' >&2
  exit 1
fi

step 'Checking the encryption keys'
mkdir "$scratch/keys"
tar -xf "$backup/keys.tar" -C "$scratch/keys" --no-same-owner
# An older backup can predate a table, so ask only those it has.
secrets() { [[ -z "$(sql "SELECT to_regclass('\"$2\"')")" ]] || sql "SELECT \$\$$1\$\$, \"$3\" FROM \"$2\""; }
{
  secrets 'Google connection' GoogleConnections EncryptedRefreshToken
  secrets 'Reminder signing key' PushKeys EncryptedPrivateKey
} > "$scratch/secrets.txt"
# Data Protection writes a magic header and then the id of the key it used, so each secret
# names the key that decrypts it. Without that key the Google connection is lost.
python3 - "$scratch/keys" "$scratch/secrets.txt" <<'PY'
import base64, re, sys, uuid
from pathlib import Path
keys = {m[1].lower() for p in Path(sys.argv[1]).rglob('key-*.xml') if (m := re.fullmatch(r'key-([0-9a-fA-F-]{36})\.xml', p.name))}
revoked = [p.name for p in Path(sys.argv[1]).rglob('revocation-*.xml')]
print(f"{len(keys)} key(s) in the backup" + (f", revocations: {', '.join(revoked)}" if revoked else ''))
if not keys:
    sys.exit('The backup has no Data Protection keys')
missing = 0
lines = [l for l in Path(sys.argv[2]).read_text().splitlines() if l]
for line in lines:
    label, value = line.split('|', 1)
    raw = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    if raw[:4] != bytes.fromhex('09f0c9f0'):
        print(f"{label}: not a Data Protection payload")
        missing += 1
        continue
    key = str(uuid.UUID(bytes_le=raw[4:20]))
    found = key in keys
    missing += not found
    print(f"{label}: key {key} {'is in the backup' if found else 'is MISSING'}")
if not lines:
    print('No encrypted secrets in the database (no Google connection and no reminder key yet).')
sys.exit(1 if missing else 0)
PY

if [[ "$api_check" == true ]]; then
  step "Starting the backup's API on the scratch database"
  [[ -n "$version" ]] || { echo 'The backup does not name its release' >&2; exit 1; }
  image="ghcr.io/natezimm/wheelhouse-api:$version"
  if ! docker image inspect "$image" > /dev/null 2>&1; then
    docker pull --quiet "$image" > /dev/null || {
      echo "Cannot pull $image. Sign in with 'docker login ghcr.io' (a read:packages token) and run the drill again, or add --database-only." >&2
      exit 1
    }
  fi
  # The same settings as the instance, with every background worker that talks to the
  # outside turned off. The internal network blocks them as well.
  docker create --name "$api" --network "$net" --memory 160m \
    --env "ConnectionStrings__Wheelhouse=Host=$db;Port=5432;Database=wheelhouse;Username=wheelhouse;Password=$password;GSS Encryption Mode=Disable" \
    --env "Wheelhouse__Mode=$mode" \
    --env "Wheelhouse__ParentEmails=$(read_value "$backup/instance.env" WHEELHOUSE_PARENT_EMAILS)" \
    --env "Google__ClientId=$(read_value "$backup/instance.env" WHEELHOUSE_GOOGLE_CLIENT_ID)" \
    --env "Google__ClientSecret=$(read_value "$backup/instance.env" WHEELHOUSE_GOOGLE_CLIENT_SECRET)" \
    --env CalendarSync__Enabled=false --env CalendarLive__Enabled=false --env Reminders__Enabled=false \
    --env DOTNET_gcServer=0 \
    "$image" > /dev/null
  docker cp -a - "$api:/home/app/.aspnet/DataProtection-Keys" < "$backup/keys.tar"
  docker start "$api" > /dev/null
  address="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$api")"
  health=''
  for _ in $(seq 90); do
    health="$(curl --silent --max-time 3 "http://$address:8080/health" || true)"
    [[ "$health" == *'"status":"Healthy"'* || "$health" == *'"status":"Degraded"'* ]] && break
    [[ "$(docker inspect --format '{{.State.Running}}' "$api")" == true ]] || break
    sleep 1
  done
  if [[ "$health" != *'"status":"Healthy"'* && "$health" != *'"status":"Degraded"'* ]]; then
    echo "The API did not become healthy. Last answer: ${health:-none}. Its log:" >&2
    docker logs --tail 40 "$api" >&2 || true
    exit 1
  fi
  echo "/health: $health"
  # Degraded is expected here: the scratch copy cannot reach Google, so a family's calendar looks stale.
  if docker logs "$api" 2>&1 | grep -q 'Creating key'; then
    echo 'Note: the API made a new key on start, so every key in the backup has expired. Old secrets still decrypt with them.'
  fi
fi

step 'Summary'
echo "Backup of $name from $created"
[[ "$api_check" == true ]] || echo "The API was not started (--database-only)."
echo "Restored and verified in $((SECONDS - started))s on $(hostname)"
