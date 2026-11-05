# 0009. Nightly dumps to a bucket the server can only add to

**Status:** Accepted, November 2026

## Context

Wheelhouse runs every instance, the public demo and a family's private one, on one small Google Cloud VM, each with its own PostgreSQL in Docker. Each release has always snapshotted every instance on the server before migrating, which covers a bad release but not losing the server, its disk or its project.

Google Calendar holds the events ([ADR 0001](0001-google-calendar-is-the-source-of-truth.md)), so what is at risk is what only Wheelhouse knows: the family and its members, their colors and pictures, the theme, which calendars show, the parents' linked accounts, paired walls, reminder subscriptions, and the shared Google account's refresh token. All of it changes rarely, and losing a day of it costs minutes of setting things again. Losing all of it, or the Data Protection keys that decrypt the token and sign every device's cookie, costs re-pairing every wall and re-connecting the calendar.

The server is also the most exposed part. Whatever backs it up must survive the server being compromised, not just failing.

The options weighed:

- **Disk snapshots of the VM.** One click, whole machine. But they live in the same project the server's account can reach, restore all instances at once to one moment, and copy a running PostgreSQL's files rather than a consistent dump.
- **A managed database** (Cloud SQL) with point-in-time recovery. Minutes of RPO, but about the price of the whole VM again per instance, and the Data Protection keys and `.env` would still need their own backup.
- **Continuous archiving** (WAL shipping with a tool such as pgBackRest or WAL-G). Seconds of RPO, but another daemon, its own retention and encryption, and a much harder restore to rehearse, for data that changes a few times a week.
- **A nightly logical dump per instance, with its keys and settings, uploaded to Cloud Storage.**

## Decision

Every night `nightly-backup.sh` (a systemd timer installed by each release) takes, per instance, a custom-format `pg_dump`, the Data Protection keys, the `.env` and the Compose file, in the same layout as a release snapshot with checksums and a `COMPLETE` marker, and uploads it as one archive to a private bucket.

- **Add-only.** The VM's own service account has only `storage.objectCreator` on the bucket, and every upload says `ifGenerationMatch=0`. The server cannot read, replace or delete any backup, so whoever takes it over cannot destroy the history or read the other nights. Reading a backup takes a person signed in to Google Cloud.
- **One format for every restore.** A nightly archive unpacks to exactly what `restore.sh` restores from a release snapshot, so there is one restore procedure and one script to trust.
- **Keys with the data.** The keys travel beside the dump. Without them a restore keeps the data but loses the Google connection, the reminder key and every signed-in device.
- **Writers keep running.** `pg_dump` reads one consistent snapshot, so the nightly backup needs no maintenance window, unlike a release's.
- **Expiry in the bucket.** A lifecycle rule deletes backups after 30 days, which the add-only server could not do itself.
- **Proved by a drill.** `restore-drill.sh` restores a backup beside the live instance and checks counts, keys and health ([restore drill](../restore-drill.md)), and CI runs it on every pull request.

## Consequences

- RPO is up to a day for Wheelhouse-only settings, and nothing for events, which come back from Google. That suits data a family changes a few times a week.
- RTO for a lost server is hours, mostly manual setup of a new VM, DNS and HTTPS; the family meanwhile has every event in Google Calendar. Automating the server's setup would shorten it and is not worth it for one server.
- The bucket holds credentials: each archive has the `.env` (database password, Google client secret, parent list) and the keys that decrypt the refresh token. It stays private with uniform access and public access prevention, and is encrypted at rest by Google but not by a key of ours. Encrypting archives with a key kept off the server would protect them from someone who can read the bucket, at the cost of one more secret to lose; not done yet.
- The bucket lives in the same Google Cloud project and account as the server. It survives the VM, its disk and a compromised server, but not losing the project or the Google account. A copy elsewhere would cover that.
- A backup that silently stops would go unnoticed until needed, so each release warns after two days without one. There is no alert between releases.
- Restoring needs the backup's release images, which are private on GitHub's registry; the server keeps those that retained snapshots name, and otherwise a `read:packages` token signs it in for the restore.
