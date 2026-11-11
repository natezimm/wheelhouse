#!/usr/bin/env python3
"""Migrate a Compose PostgreSQL 17 database into a separate PostgreSQL 18 volume.

The old volume is retained. Run during a maintenance window, with host-side
writers stopped. Backups and the rollback Compose file contain private data.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

VOLUME_VARIABLE = "WHEELHOUSE_DB_VOLUME"
DEFAULT_COMPOSE = "compose.yaml"
TARGET_IMAGE = "postgres:18.6-bookworm"
COUNTS = """SELECT table_name, (xpath('/row/c/text()', query_to_xml(
format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
false, true, '')))[1]::text FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"""


def run(*args, **kwargs):
    result = subprocess.run([str(a) for a in args], stderr=subprocess.PIPE,
                            **({"stdout": subprocess.PIPE} | kwargs))
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.decode()[:500]}")
    return result.stdout


def wait(container, user, database):
    for _ in range(90):
        result = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1",
                                 "-U", user, "-d", database], capture_output=True)
        if result.returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError("PostgreSQL did not become ready")


def migrate(args):
    root = args.directory.resolve()
    env_file = root / ".env"
    compose = ["docker", "compose", "--project-directory", str(root)]
    if args.project_name:
        compose += ["--project-name", args.project_name]
    compose += ["--file", str((root / args.compose_file).resolve())]
    config = json.loads(run(*compose, "config", "--format", "json"))
    project = config["name"]
    source = run(*compose, "ps", "--all", "--quiet", "db").decode().strip()
    if args.require_current:
        if not source:
            return  # A first deployment has no database to migrate.
        current = json.loads(run("docker", "inspect", source))[0]
        if not current["Config"]["Image"].startswith("postgres:18."):
            raise RuntimeError("Migrate this instance with upgrade-postgres.py before deploying PostgreSQL 18")
        return
    if not source or "\n" in source:
        raise RuntimeError("Expected one existing db container; start the old PostgreSQL 17 stack first")
    info = json.loads(run("docker", "inspect", source))[0]
    mounts = [m for m in info["Mounts"] if m["Type"] == "volume"
              and m["Destination"] in ("/var/lib/postgresql/data", "/var/lib/postgresql")]
    if len(mounts) != 1:
        raise RuntimeError("Expected one named PostgreSQL data volume")
    original = mounts[0]["Name"]
    target = args.target_volume or original + "-pg18"
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", target) or target == original:
        raise RuntimeError("Choose a separate, valid target volume name")
    if not info["Config"]["Image"].startswith("postgres:17"):
        raise RuntimeError("Only a PostgreSQL 17 source is supported; this database may already be upgraded")
    print(f"{project}: {original} -> {target} ({TARGET_IMAGE})", flush=True)
    if args.check:
        return
    exists = subprocess.run(["docker", "volume", "inspect", target], capture_output=True)
    if exists.returncode == 0:
        raise RuntimeError("Target volume already exists; choose a fresh --target-volume")
    source_env = dict(v.split("=", 1) for v in info["Config"]["Env"] if "=" in v)
    user = source_env.get("POSTGRES_USER", "postgres")
    database = source_env.get("POSTGRES_DB", user)
    password = source_env.get("POSTGRES_PASSWORD")
    if not password:
        raise RuntimeError("Expected password authentication configured by POSTGRES_PASSWORD")
    expected = config["services"]["db"].get("environment", {})
    if expected.get("POSTGRES_USER", "postgres") != user or expected.get("POSTGRES_DB", user) != database:
        raise RuntimeError("Compose's database/user differ from the source container")
    if expected.get("POSTGRES_PASSWORD") != password:
        raise RuntimeError("Compose's database password differs from the source container")
    # Resolve a recovery file to the actual old volume, mount and image. It works
    # even after the repository's Compose file has been changed to PostgreSQL 18.
    recovery = json.loads(json.dumps(config))
    db = recovery["services"]["db"]
    data_mount = next(m for m in db["volumes"] if m["type"] == "volume"
                      and m["target"] == "/var/lib/postgresql")
    recovery["volumes"][data_mount["source"]]["name"] = original
    data_mount["target"] = mounts[0]["Destination"]
    db["image"] = info["Config"]["Image"]
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    backup = root / ".postgres-upgrade-backups" / stamp
    backup.mkdir(parents=True, mode=0o700)
    (backup / "rollback-compose.json").write_text(json.dumps(recovery, indent=2) + "\n")
    original_env = env_file.read_bytes() if env_file.exists() else None
    if original_env is not None:
        (backup / "instance.env").write_bytes(original_env)
    scratch = "postgres18-upgrade-" + uuid.uuid4().hex[:12]
    writers = []
    cutover = False
    successful = False
    try:
        run("docker", "pull", TARGET_IMAGE)
        run("docker", "start", source)
        wait(source, user, database)
        # Only stop this project's currently running writers. Other stacks and
        # previously stopped services stay untouched.
        ids = run("docker", "ps", "--quiet", "--filter", f"label=com.docker.compose.project={project}").decode().split()
        writers = [i for i in ids if not source.startswith(i)]
        run("docker", "volume", "create", target)
        run("docker", "run", "--detach", "--name", scratch, "--network", "none",
            "--env", f"POSTGRES_USER={user}", "--env", f"POSTGRES_DB={database}",
            "--env", "POSTGRES_PASSWORD", "--volume", f"{target}:/var/lib/postgresql",
            TARGET_IMAGE, env=os.environ | {"POSTGRES_PASSWORD": password})
        wait(scratch, user, database)
        if writers:
            run("docker", "stop", *writers)

        def sql(container, statement):
            return run("docker", "exec", container, "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
                       "-U", user, "-d", database, "-c", statement)

        before = sql(source, COUNTS)
        (backup / "table-counts.tsv").write_bytes(before)
        dump = backup / "database.dump"
        with dump.open("wb") as out:
            run("docker", "exec", source, "pg_dump", "-U", user, "-d", database,
                "--format=custom", "--no-owner", "--no-acl", stdout=out)
        digest = hashlib.sha256(dump.read_bytes()).hexdigest()
        (backup / "SHA256SUMS").write_text(f"{digest}  database.dump\n")
        with dump.open("rb") as source_dump:
            run("docker", "exec", "--interactive", scratch, "pg_restore", "-U", user,
                "-d", database, "--exit-on-error", "--no-owner", "--no-acl", stdin=source_dump)
        if sql(scratch, COUNTS) != before:
            raise RuntimeError("Restored table counts differ from the source; refusing cutover")
        sql(scratch, "ANALYZE")
        run("docker", "stop", scratch)
        # Persist the selected new volume only after the dump has restored and
        # every public table's row count matches. Retain the original volume.
        lines = (original_env or b"").decode().splitlines()
        lines = [line for line in lines if not line.startswith(VOLUME_VARIABLE + "=")]
        replacement = env_file.with_name(".env.postgres-upgrade")
        replacement.write_text("\n".join(lines + [f"{VOLUME_VARIABLE}={target}"]) + "\n")
        replacement.replace(env_file)
        cutover = True
        upgraded_env = os.environ | {VOLUME_VARIABLE: target}
        run(*compose, "up", "--detach", "--no-deps", "db", env=upgraded_env)
        current = run(*compose, "ps", "--quiet", "db", env=upgraded_env).decode().strip()
        wait(current, user, database)
        if not sql(current, "SHOW server_version").startswith(b"18.") or sql(current, COUNTS) != before:
            raise RuntimeError("Post-cutover version or table counts did not match")
        successful = True
        (backup / "COMPLETE").touch()
        # Once writers may run, rolling back to the old volume could discard
        # accepted writes. A writer-start failure therefore leaves the verified
        # PostgreSQL 18 database in place for recovery.
        if writers:
            run("docker", "start", *writers)
        print(f"Upgraded to PostgreSQL 18; row counts verified. Backup: {backup}", flush=True)
        print(f"Original PostgreSQL 17 volume retained: {original}", flush=True)
    finally:
        # A failed cutover restores the old volume and configuration before any
        # writer can resume. Never automatically roll back after success.
        if not successful:
            if cutover:
                if original_env is None:
                    env_file.unlink(missing_ok=True)
                else:
                    env_file.write_bytes(original_env)
                run("docker", "compose", "--project-name", project, "--project-directory", root,
                    "--file", backup / "rollback-compose.json", "up", "--detach", "--no-deps", "db")
            if writers:
                run("docker", "start", *writers)
        subprocess.run(["docker", "rm", "--force", "--volumes", scratch], capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path.cwd())
    parser.add_argument("--compose-file", default=DEFAULT_COMPOSE)
    parser.add_argument("--project-name")
    parser.add_argument("--target-volume")
    parser.add_argument("--check", action="store_true", help="Inspect the source without changing anything")
    parser.add_argument("--require-current", action="store_true", help="Refuse deployment over an unmigrated database")
    parser.add_argument("--operations-lock", type=Path, help="Share the deployment/backup operations lock")
    args = parser.parse_args()
    os.umask(0o077)
    with (args.operations_lock or args.directory / ".postgres-upgrade.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        migrate(args)


if __name__ == "__main__":
    main()
