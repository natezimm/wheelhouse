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
