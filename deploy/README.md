# Deploying Wheelhouse

One server can run any number of Wheelhouse instances, for example a public demo and a family's private one. Each instance is a folder under `~/wheelhouse` with its own `.env`, database and domain. Instances share only the image version.

Pushing a version tag runs the tests, publishes the images to GitHub Container Registry, and moves every instance on the server to that version.

## Once per server

1. Install Docker with the Compose plugin, and make sure the deploy user can run `docker ps` without `sudo`.
2. Add four secrets to the GitHub repository: `GCP_HOST` (the server's address), `GCP_USER` (the deploy user), `GCP_SSH_KEY` (a private key that user accepts) and `GCP_KNOWN_HOSTS` (the server's host key as a `known_hosts` line, such as `203.0.113.10 ssh-ed25519 AAAA...`, for the same address as `GCP_HOST`). The deploy refuses to connect to a server whose host key does not match.

The server needs no registry credentials of its own. Each release signs it in with a short-lived token and signs it out afterwards.

## Once per instance

Pick a name (`demo` below), a domain and a mode:

- `Demo` gives every visitor their own private copy of a fictional family, with no sign-in, and deletes each copy after a day.
- `Family` is private. Nothing is readable without signing in.

1. Point the domain's DNS `A` record at the server.
2. From a checkout of this repository, create the instance on the server. [`new-instance.sh`](new-instance.sh) makes the instance's folder and its `.env` (readable only by you, since it holds a fresh database password), picks a loopback port no other instance uses, and gives the server's nginx a site for the domain. It uses `sudo` for nginx, so the server's user needs to run `sudo` without a password, as a Google Cloud VM's does.

   ```bash
   ssh <server> 'bash -s' -- demo wheelhouse.example.com Demo < deploy/new-instance.sh
   ```

3. Once the domain points at the server, add HTTPS on the server:

   ```bash
   sudo certbot --nginx -d wheelhouse.example.com
   ```

4. For a `Family` instance, set up [Google sign-in](#google-sign-in). Until it is, nobody can sign in, and each release says so.

The instance starts on the next release. To start it without a new version, open the latest **Release** run under the repository's Actions and choose **Re-run all jobs**.

## Google sign-in

Parents sign in to a family instance with their own Google accounts. Google is used only to say who they are; nothing else is read from their accounts. The family's calendars come from one shared Google account that a parent connects afterwards (see [Google Calendar](#google-calendar)). The demo never calls Google.

Once, in the [Google Cloud console](https://console.cloud.google.com/), in a project of your choosing:

1. Under **Google Auth Platform**, configure the consent screen: an **External** app with the instance's name and your support email. The only scopes it needs are `openid`, `email` and `profile`, which need no Google review.
2. Add each parent's Google address and the shared calendar account under **Audience → Test users** while the app is in **Testing**. Testing expires Google's grants after 7 days, which is fine for sign-in but not for the Calendar connection, so publish the app once Calendar is set up (see [Google Calendar](#google-calendar)).
3. Under **Clients**, create an OAuth client of type **Web application**. Add `https://<the instance's domain>/api/auth/google/callback` and `https://<the instance's domain>/api/calendar/google/callback` as authorized redirect URIs. Add the same two paths on `http://localhost:8080` too if you want to try them locally.

Then fill in the client and the parents' addresses in the instance's `.env` on the server (`~/wheelhouse/<name>/.env`), and re-run the latest release to apply them. Only the addresses listed can sign in, and removing one signs that parent out on their next request.

```
WHEELHOUSE_GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
WHEELHOUSE_GOOGLE_CLIENT_SECRET=<client secret>
WHEELHOUSE_PARENT_EMAILS=<first parent's address>,<second parent's address>
```

The first parent to sign in creates the family, in their phone's time zone, with themselves as its first parent; rename it in Settings. If they add the other parent in Settings under the name on that parent's Google account, the other parent's first sign-in takes over that member instead of adding a second one.

## Google Calendar

The family's calendars live in one shared Google account, with a calendar for each person or type, each shared to both parents' own accounts with edit rights. Wheelhouse keeps one refresh token for that account, encrypted, so it can read the calendars with nobody signed in.

Once, in the same Google Cloud project as sign-in:

1. Under **APIs & Services → Library**, enable the **Google Calendar API**.
2. Under **Google Auth Platform → Data Access**, add the scope `https://www.googleapis.com/auth/calendar`.
3. Under **Branding**, set the app's home page to `https://<the instance's domain>/` and its privacy policy to `https://<the instance's domain>/privacy`.
4. Under **Audience**, **Publish app**. In Testing, Google expires the Calendar grant after 7 days and the wall stops updating. A published app that asks for Calendar access but has not been verified by Google shows a warning on its consent screen and is limited to 100 accounts, which a family never reaches. To go on past the warning, choose **Advanced**, then the link to continue.

Then, signed in as a parent, open **Settings → Calendars → Connect Google Calendar** on a phone, pick the shared account, and allow calendar access. Choose which calendars show and whose each one is. If Google later stops accepting the connection (its password changed, or access was removed in the account), Settings says so and offers to connect again.

## Change an instance's domain

An instance can start on one domain, such as a subdomain, and move to another later. Keep the old domain working until everyone has moved.

1. Point the new domain's DNS `A` record at the server.
2. On the server, add the new name next to the old one in the instance's nginx site, then extend its certificate to cover both:

   ```bash
   sudo sed -i 's/server_name old.example.com;/server_name old.example.com new.example.com;/' /etc/nginx/sites-available/old.example.com
   ```

   ```bash
   sudo certbot --nginx --expand -d old.example.com -d new.example.com
   ```

3. On a `Family` instance, add `https://<new domain>/api/auth/google/callback` and `https://<new domain>/api/calendar/google/callback` to the Google OAuth client's authorized redirect URIs, and point the app's home page and privacy policy at the new domain.
4. The sign-in cookie belongs to the domain it was issued on, so nothing carries over. Each parent signs in again at the new address, and each wall display is removed in Settings, pointed at the new address and paired again. The family's data stays as it was.

Nothing in the instance's `.env` names its domain, so no release is needed.

## Release

### From GitHub (recommended)

After merging the release controls into `main`, open **Actions → Release → Run workflow**.
Choose branch **main** and enter a new version such as **v0.2.0**. The run tests that exact
commit, creates its tag, builds both images and deploys every configured instance.
The version must match `vMAJOR.MINOR.PATCH`, optionally with a prerelease suffix.
Existing tags are never moved; choose a new version if a tag belongs to another commit.

The first catch-up release is `v0.2.0`; it includes the calendar, live updates, chores,
lists, grocery and weekly meal plan features merged since `v0.1.1`.
Merging a PR alone still does not deploy. Use another version for each later release.
A tag created by the workflow token does not start a second tag-triggered run: the
manual run performs the complete release itself. Re-run a failed run to retry its
original commit; starting a new run on a changed main needs a new version.

Watch the test, prepare, images and deploy jobs. The deploy job also runs browser smoke checks. The deploy job must finish successfully
before the release is live. Reload each site afterwards, and verify Today and Calendar; open `/wall` for the wall layout. A private family instance
still requires Google sign-in and a calendar connection for real events.

### From a local checkout

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

The release fails, and says which instance, if any instance's `/health` does not answer within a minute.

## Look at an instance

Run these on the server.

```bash
docker compose --project-name wheelhouse-demo ps
```

```bash
docker compose --project-name wheelhouse-demo logs --tail 100 api
```

## Backups and release recovery

Before any new API starts, the server pulls the candidate images, stops each existing
instance's web/API writers, and saves a custom-format PostgreSQL dump, Data Protection
keys (with ownership), its previous Compose file and its complete environment.
All existing instances must finish backup and archive validation before any migration
can run. This causes a short maintenance window. PostgreSQL stays running.
A failed backup resumes the old services without applying migrations.

The release log prints a recovery directory under `~/wheelhouse/backups/`. Each instance
has a subfolder with checksums and a `COMPLETE` marker. A first deployment without an
existing database has `FIRST_DEPLOY` instead and is not restorable.
These files contain credentials and family data: permissions are private, they stay on
the server, and they are never uploaded as Actions artifacts. Backups and old images
are subject to the retention policy below. These local snapshots do not survive losing
the server; [nightly off-server backups](#nightly-off-server-backups) do.

A startup or health failure stops the affected API/web so migration retries cannot
continue. Instances that have not yet attempted migration resume their old versions.
Instances already successfully updated remain updated. The release fails and identifies
the snapshot to use. A browser smoke failure also fails the release, while leaving
healthy services available for investigation.

### Restore one instance

Do not simply restart an older image on a migrated database. Review the printed
snapshot path and stop family use of the instance first. Restoring deliberately
discards all database writes made after that snapshot, including changes written
through Google sync. Google itself is not rolled back. Its current calendar state is
imported again after reconnect/sync.

On the server, substitute the instance name and its matching snapshot directory:

```bash
bash ~/wheelhouse/restore.sh demo ~/wheelhouse/backups/<run>/demo --confirm-data-loss
```

The command verifies the checksums, pulls the old images before stopping services,
recreates that instance's database from the dump, restores its encryption keys and
environment, then starts the old version and checks health. It holds the same operations
lock as deployment. A failed restore leaves writers stopped until recovery is resolved.
It never drops another instance's database or deletes a Docker volume.
Use the restored instance's `recovery-compose.yaml` for manual Compose commands until
the next release; deployment automatically preserves that file in its next snapshot.
Run the browser check again and manually verify private sign-in/calendar access.

Automatic database restoration is intentionally excluded: it could silently erase new
family edits or compound a partial migration. Recovery always requires the explicit
`--confirm-data-loss` flag.

## Nightly off-server backups

Every night at about 10:00 UTC, `wheelhouse-backup.timer` dumps each running instance's
database with `pg_dump`, takes its Data Protection keys (without them the stored Google
Calendar connection cannot be read), its `.env` and its Compose file, and uploads one
archive per instance to a private Cloud Storage bucket as `<instance>/<UTC time>.tar`.
Nothing stops: `pg_dump` reads one consistent snapshot while the instance keeps running.
It waits for a release or restore that holds the operations lock, and one failed
instance does not stop the others from being backed up.

The server can only add objects to the bucket. It cannot read, replace or delete a
backup, so a compromised server cannot reach old backups or destroy them. A lifecycle
rule on the bucket deletes backups after 30 days. Each archive holds family data and
credentials, so keep the bucket private.

Each release installs the timer, and warns in its log while backups are not set up or
when none has succeeded for two days.

### Set it up once

Run these in [Cloud Shell](https://console.cloud.google.com/?cloudshell=true), in the
project that holds the server. Fill in the first three lines: the bucket name must be
unique across all of Cloud Storage, and the region should be the server's, so uploads
cost nothing.

```bash
BUCKET=<project id>-wheelhouse-backups
VM=<server's VM name>
ZONE=<server's zone, such as us-central1-a>
```

```bash
PROJECT="$(gcloud config get-value project)"
REGION="${ZONE%-*}"
ACCOUNT="wheelhouse-backup@$PROJECT.iam.gserviceaccount.com"
gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > lifecycle.json
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file=lifecycle.json
gcloud iam service-accounts create wheelhouse-backup --display-name="Wheelhouse backups"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$ACCOUNT" --role=roles/storage.objectCreator
```

The server uploads as its VM's service account. Check which one it has now:

```bash
gcloud compute instances describe "$VM" --zone="$ZONE" --format='value(serviceAccounts[].email,serviceAccounts[].scopes)'
```

Give it the new account instead. This stops the VM for about a minute, so every site on
it is briefly down; its static address stays the same. If anything else on the VM used
the old account, such as the Ops Agent, grant the new account those roles too (for the
Ops Agent, `roles/logging.logWriter` and `roles/monitoring.metricWriter`).

```bash
gcloud compute instances stop "$VM" --zone="$ZONE"
gcloud compute instances set-service-account "$VM" --zone="$ZONE" --service-account="$ACCOUNT" --scopes=cloud-platform
gcloud compute instances start "$VM" --zone="$ZONE"
```

The broad scope is safe here: the new account's only permission is adding objects to
this one bucket.

Then, on the server, name the bucket:

```bash
echo 'WHEELHOUSE_BACKUP_BUCKET=<bucket>' > ~/wheelhouse/backup.env
```

The next release installs the backup script and timer. After it, take the first backup
at once and check that it reached the bucket:

```bash
sudo systemctl start wheelhouse-backup.service
sudo journalctl -u wheelhouse-backup.service --no-pager -n 20
```

```bash
gcloud storage ls "gs://$BUCKET/*/"
```

### Restore from the bucket

Restoring discards every change made after the backup, as with
[a release snapshot](#restore-one-instance). From Cloud Shell or any machine signed in to
Google Cloud as you, download the backup you want and copy it to the server:

```bash
gcloud storage ls "gs://$BUCKET/family/"
gcloud storage cp "gs://$BUCKET/family/<UTC time>.tar" .
scp "<UTC time>.tar" <server>:
```

On the server, unpack it. It makes a folder named after the instance, which `restore.sh`
checks:

```bash
mkdir -p ~/restore && tar -xf ~/"<UTC time>.tar" -C ~/restore
```

The images are private, and the server only signs in to the registry during a release.
Create a GitHub [personal access token (classic)](https://github.com/settings/tokens/new)
with only `read:packages`, sign the server in with it, restore, then sign out:

```bash
docker login ghcr.io --username <GitHub user>
bash ~/wheelhouse/restore.sh family ~/restore/family --confirm-data-loss
docker logout ghcr.io
```

Delete `~/restore` and the downloaded archive afterwards, and the token on GitHub.

**On a new server**, set it up as in [Once per server](#once-per-server) and point the
domain at it, then copy the operations scripts across from a checkout of the release the
backup came from, and create the instance under the same name before restoring it:

```bash
ssh <server> 'mkdir -p ~/wheelhouse'
scp deploy/restore.sh <server>:wheelhouse/
ssh <server> 'bash -s' -- family family.example.com Family < deploy/new-instance.sh
```

Restore before the first release on the new server. The backup's `.env` brings back the
original database password, Google client and parents, and a database a release had
already created would have a different password. `new-instance.sh` prints the port it
gave the site; if the backup's port (`grep WHEELHOUSE_HTTP_PORT ~/restore/family/instance.env`)
differs, change `proxy_pass` to it in `/etc/nginx/sites-available/<domain>` and run
`sudo systemctl reload nginx`. Then add HTTPS with `certbot` as for a
new instance, run `restore.sh` as above, and re-run the latest release so the timers and
scripts are installed again. Phones and the wall stay signed in, because the keys that
sign their cookies are part of the backup.

## Post-deployment browser smoke checks

The release runner installs Chromium and reaches every deployed instance through a
short-lived SSH loopback tunnel. No public domain names or new secrets are required.
This checks the application behind nginx; it does not check public DNS, certificates
or the server's external nginx routing.

- Demo: checks Today content, phone navigation to Calendar, then
  verifies that an event returned by the real demo API appears in the wall layout.
  The visitor gets a separate expiring demo copy; existing visitors are untouched.
- Family: checks health, private mode, denied anonymous family access and the Google
  sign-in screen in a fresh browser. It never signs in or reads private family content.
- Runtime errors and core API server errors fail the check. Only successful fictional
  demo wall screenshots are retained for seven days; no private screenshots, browser
  traces or response bodies are uploaded.

A release is successful only after the browser checks pass. To run a check manually
from a machine with this checkout, install `web/` dependencies and Playwright Chromium,
open an SSH tunnel to the instance's loopback port, then run:

```bash
SMOKE_URL=http://127.0.0.1:18080 SMOKE_MODE=Demo node deploy/smoke.mjs
```

Use `Family` for a private instance. An authenticated private-family smoke check is
outside this workflow; verify real sign-in and Google Calendar access yourself.

## Check release tooling

```bash
python3 -m unittest discover -s deploy -p 'test_*.py' -v
node --test deploy/test-smoke.mjs
```

The operations tests exercise the real Bash scripts against disposable command
doubles, including failure ordering, integrity checks and restore sequencing.
The browser harness runs the real smoke script against small HTTP fixtures to verify
both success and rejection of missing content; the release itself uses the live API.

## Storage limits and backup expiration

The next release installs `wheelhouse-storage.timer` on the VM using the deploy user's
existing passwordless sudo access. It runs daily (with up to 15 minutes of jitter),
including after reboot, as that user rather than root. Cleanup also runs after a
successful release's browser checks. No cron installation is needed. If timer
installation fails, the release stops before interrupting services.

Defaults:

- Backups become eligible for permanent removal **14 days after the UTC creation time
  in their directory name**, and are removed by the next cleanup. This applies to
  successful, failed and incomplete release snapshots, even the newest/last snapshot.
  Recovery beyond that window requires a separately retained/off-server backup.
- Before pulling images and again before stopping any writer, deployment requires
  **2 GiB free plus twice the current database sizes and 64 MiB per instance**.
  It refuses deployment if that reserve is unavailable. It never expands the disk or
  buys storage automatically; image-pull failure also aborts before stopping services.
- Image cleanup removes only versioned `wheelhouse-api`/`wheelhouse-web` image tags
  unused by all containers (including stopped containers), current instance versions
  and every retained backup. It never force-removes images, prunes volumes or touches
  another application's images.

Cleanup shares deployment/recovery's lock and defers while either is running. Unknown
backup-directory names and symlinked directories are left untouched. Daily cleanup
does not create backups and never touches the off-server bucket, whose own lifecycle rule
expires nightly backups.

To change the limits, create/edit `~/wheelhouse/storage-policy.json` on the VM:

```json
{
  "retention_days": 14,
  "minimum_free_gib": 2
}
```

Both values must be positive integers. A shorter retention window reduces recovery
history. Changes take effect on the next cleanup/preflight without a new release.

Inspect the timer or run cleanup immediately:

```bash
systemctl status wheelhouse-storage.timer
sudo journalctl -u wheelhouse-storage.service --no-pager -n 30
python3 ~/wheelhouse/storage.py cleanup
```

If the free-space guard blocks a release, run cleanup, inspect `df -h` and
`docker system df`, then retry. If stopped containers protect obsolete images,
review and remove those specific obsolete containers yourself; cleanup deliberately
keeps their images. Backups created within the retention window are not deleted just
to force a release through.
