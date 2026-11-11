# PostgreSQL 17 → 18

The stacks and integration tests use `postgres:18.6-bookworm`. Major PostgreSQL
versions require dump/restore. The Docker image for 18 mounts its volume at
`/var/lib/postgresql` and stores data under `18/docker`. The default volume name
remains the project's existing `db-data`, so starting over unmigrated 17 data
fails instead of silently opening an empty database. `WHEELHOUSE_DB_VOLUME`
selects the migrated volume.

## Local migration

Stop host-side API processes first. From the repository root, with the old
database container still present:

```sh
python3 deploy/upgrade-postgres.py --check
python3 deploy/upgrade-postgres.py
```

The command initializes a new volume, stops this project's running writers,
dumps and restores the database, compares every public table's row count, and
only then updates `.env` and replaces the database container. It checks version
and counts again before restarting the writers that were running. The original
volume and existing Data Protection keys are retained. A failed cutover rolls
back the database and `.env` before writers restart.

Private snapshots live in `.postgres-upgrade-backups/<timestamp>/`: the database
dump, SHA-256 digest, table counts, original `.env` when present, and a resolved
`rollback-compose.json`. Keep them private and copy the verified snapshot off
the machine. A failed attempt's new volume is retained for inspection; retry
with a fresh `--target-volume <name>`.

## Server migration before the next release

Schedule maintenance and suspend releases. Take and verify the normal complete
instance backups, including Data Protection keys. Copy `upgrade-postgres.py`
and the new production Compose file to `~/wheelhouse/upgrade-postgres.py` and
`~/wheelhouse/compose.pg18.yaml`, retaining the active shared Compose file.
Run for each instance, replacing `demo` with its directory/name:

```sh
python3 ~/wheelhouse/upgrade-postgres.py \
  --directory ~/wheelhouse/demo \
  --compose-file ~/wheelhouse/compose.pg18.yaml \
  --project-name wheelhouse-demo \
  --operations-lock ~/wheelhouse/operations.lock
```

The operations lock prevents overlapping deployment, backup or restore. Check
`/health` and the calendar after each cutover. After **every existing instance**
has migrated, install `compose.pg18.yaml` as `~/wheelhouse/compose.yaml`. Remove
an older per-instance `recovery-compose.yaml` only after that instance's checks
pass, so subsequent snapshots name the matching PostgreSQL 18 image and volume.
Take fresh complete backups and resume releases. Deployment refuses PostgreSQL
17 before stopping writers.

Manual rollback after a successful cutover requires stopping writers and using
the saved `rollback-compose.json` and original `.env`. It returns to data as of
the upgrade; reconcile subsequent writes first. Retain the 17 volume until
application and backup/restore checks pass.

## Rehearsal

`python3 deploy/test-postgres-upgrade.py` checks successful migration of data,
JSON, foreign keys and a view, a deliberately failed cutover, and writer restart
using disposable Docker resources. CI runs it in the stack job. Keep both scripts
aligned with their copies in Know Ball.
