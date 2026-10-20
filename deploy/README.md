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
before the release is live. Reload each site afterwards, and verify Today, Calendar,
Chores, Lists and Meals; open `/wall` for the wall layout. A private family instance
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
are retained; review disk space and remove old copies deliberately after confirming
a good release. These local snapshots do not replace off-server disaster-recovery backups.

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

## Post-deployment browser smoke checks

The release runner installs Chromium and reaches every deployed instance through a
short-lived SSH loopback tunnel. No public domain names or new secrets are required.
This checks the application behind nginx; it does not check public DNS, certificates
or the server's external nginx routing.

- Demo: checks Today content, phone navigation to Calendar/Chores/Lists/Meals, then
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
