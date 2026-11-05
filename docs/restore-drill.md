# Restore drill

A backup nobody has restored is a hope, not a backup. This page says how much Wheelhouse can lose and how long it can be down, and gives the drill that proves the nightly backups meet that: about ten minutes, once a quarter and after any change to how backups are made. Why the backups work the way they do is in [ADR 0009](adr/0009-nightly-dumps-to-an-add-only-bucket.md); setting them up and the real restore are in [deploy/README.md](../deploy/README.md#nightly-off-server-backups).

## What is at stake

Google Calendar holds the events, so most of what a family sees cannot be lost with the server ([ADR 0001](adr/0001-google-calendar-is-the-source-of-truth.md)). An edit made in Wheelhouse goes to Google before the cache, and the people an event is for, its countdown and its reminder time are kept on the Google event too. After a restore, the next sync brings the cache up to date with Google.

What only Wheelhouse's database holds, and so what a restore brings back:

| Data | Lost without a backup means |
| --- | --- |
| The family, its members, colors, pictures, theme, night mode, place and time zone | Setting the family up again by hand |
| Which Google calendars show and whose each is | Choosing them again in Settings |
| Parents' linked Google accounts | Each parent signs in again (the first one recreates the family) |
| Paired wall displays | Pairing each display again with a new code |
| The shared Google account's refresh token, encrypted with the Data Protection keys | A parent connecting the calendar again |
| Reminder subscriptions and the reminder signing key | Every phone turning reminders on again |

The Data Protection keys matter as much as the database: they decrypt the refresh token and the reminder key, and they sign every phone's and wall's cookie. A database restored without its keys works, but everyone signs in, connects and pairs again.

## Objectives

| | Target | Where it comes from |
| --- | --- | --- |
| **RPO**, changes that can be lost | 24 hours of Wheelhouse-only settings; no calendar events | One backup a night at about 10:00 UTC. A release also snapshots on the server, so while the server survives, the newer of the two counts. Events come back from Google. |
| **RTO**, one instance broken, server fine | 30 minutes | `restore.sh` from a release snapshot or a downloaded nightly backup takes a few minutes; the rest is reading the logs and deciding. |
| **RTO**, server lost | 4 hours | A new VM, its setup, DNS and HTTPS are manual steps ([On a new server](../deploy/README.md#restore-from-the-bucket)); the restore itself is minutes. |
| **Detection** of backups that stopped | 2 days | Each release warns when no nightly backup has succeeded for two days. |
| **Retention** | 30 days in the bucket, 14 days of release snapshots on the server | The bucket's lifecycle rule and `storage-policy.json`. |

During an outage the family still has every event in Google Calendar on their phones, which is why hours rather than minutes are acceptable for losing the server. The drill measures the parts it can: how old the newest backup is (the real RPO that night) and how long a restore takes (the floor of the RTO).

## What the drill proves

[`deploy/restore-drill.sh`](../deploy/restore-drill.sh) restores a backup beside the live instance, never over it:

1. The archive holds one instance folder with its `COMPLETE` marker, and every file matches `SHA256SUMS`.
2. The dump restores into a scratch PostgreSQL of the version the backup ran on, with `--exit-on-error`.
3. Every table's exact row count, beside the live instance's when the drill runs on its server. Live is ahead by whatever changed since the backup, so expect small differences in `EventInstances`, `SentReminders` and `Devices`, not in `Families` or `Members`. A family instance's backup must hold a family.
4. Each encrypted secret in the database (the Google refresh token, the reminder key) names a key that is in the backup's `keys.tar`. Data Protection writes the id of the key it used into every secret, so this shows the keys can decrypt them without decrypting anything.
5. The backup's own API image starts on the scratch database with the backup's keys and settings, applies any migrations, and answers `/health` with Healthy or Degraded. Degraded is fine here: the scratch copy cannot reach Google.

The scratch database and API sit on an internal Docker network with no route out, and the API's calendar sync, reminders and live updates are switched off, so the copy can neither call Google with the family's token nor send a reminder to anyone's phone. The drill removes its containers, network and unpacked files when it ends, passed or failed, and never stops, writes to or restores over the live instance; it only asks the live database to count rows, in a read-only transaction. It takes the operations lock, so it waits out of a release's way.

CI runs the same drill on every pull request, against a backup of the `stack` job's demo in the nightly layout, so a change that breaks restoring fails before it merges.

## Run the drill

The server can only add to the bucket, so the backup is downloaded from Cloud Shell and copied to the server. In [Cloud Shell](https://shell.cloud.google.com), with the same names as in the setup:

```bash
BUCKET=<project id>-wheelhouse-backups
VM=<server's VM name>
ZONE=<server's zone, such as us-central1-a>
INSTANCE=family
gcloud storage ls -l "gs://$BUCKET/$INSTANCE/" | sort -k 2 | tail -n 3
```

The newest archive should be from this morning. Note its time (the RPO tonight is how old it is), then:

```bash
STAMP=<UTC time from the list, such as 20261105T100012Z>
gcloud storage cp "gs://$BUCKET/$INSTANCE/$STAMP.tar" .
gcloud compute scp "$STAMP.tar" "$VM:~/" --zone "$ZONE"
rm "$STAMP.tar"
gcloud compute ssh "$VM" --zone "$ZONE"
```

On the server:

```bash
bash ~/wheelhouse/restore-drill.sh ~/<UTC time>.tar
rm ~/<UTC time>.tar
```

`restore-drill.sh` reaches the server with each release. If it is not there yet, copy it from a checkout first: `scp deploy/restore-drill.sh <server>:wheelhouse/`.

The API image of the backup's release is normally still on the server, since cleanup keeps every image a retained backup names. If the drill says it cannot pull it, sign in with a GitHub token that has only `read:packages`, run it again, then sign out and delete the token:

```bash
docker login ghcr.io --username <GitHub user>
bash ~/wheelhouse/restore-drill.sh ~/<UTC time>.tar
docker logout ghcr.io
```

`--database-only` skips starting the API, for a quick check of a backup whose image is gone.

Run it for the demo too (`INSTANCE=demo`) now and then; it is the same script.

### It passed when

- It ends with `Drill passed in …s`.
- `Families` and `Members` match live, and the other counts are close.
- Each secret's key `is in the backup`.
- `/health` says Healthy or Degraded.

Add a line to the log below with the backup's age and the time the drill took.

### If it fails

Nothing live has changed. Keep the archive in the bucket (it expires on its own after 30 days), and look at the step that failed: a checksum or archive error means the upload or the copy is damaged, so try the previous night's backup and the transfer again; a restore or health error means the backups need fixing before they can be trusted, which is worth a release hold until it is understood.

## Rehearse losing the server

The drill on the server proves the backup restores. To prove it restores without that server, run the same script in Cloud Shell, which has Docker: download the archive as above, copy `restore-drill.sh` there, sign Docker in to `ghcr.io` as above (the server's images are not there), and run `bash restore-drill.sh <UTC time>.tar`. It shows no live column. Cloud Shell's home folder persists, so delete the archive, `docker logout ghcr.io` and delete the token afterwards. The rest of a new server (VM, DNS, HTTPS) is in [On a new server](../deploy/README.md#restore-from-the-bucket).

## Drill log

| Date | Instance | Backup age | Took | Result | By |
| --- | --- | --- | --- | --- | --- |
| 2026-11-05 | family | 8 h (10:08 UTC backup, drilled 17:55 UTC) | 59 s | Passed: counts match live, Google token's key present, `/health` Degraded (no Google from the scratch copy) | Nathan |
