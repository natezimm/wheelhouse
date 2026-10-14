# Deploying Wheelhouse

One server can run any number of Wheelhouse instances, for example a public demo and a family's private one. Each instance is a folder under `~/wheelhouse` with its own `.env`, database and domain. Instances share only the image version.

Pushing a version tag runs the tests, publishes the images to GitHub Container Registry, and moves every instance on the server to that version.

## Once per server

1. Install Docker with the Compose plugin, and make sure the deploy user can run `docker ps` without `sudo`.
2. Add three secrets to the GitHub repository: `GCP_HOST` (the server's address), `GCP_USER` (the deploy user) and `GCP_SSH_KEY` (a private key that user accepts).

The server needs no registry credentials of its own. Each release signs it in with a short-lived token and signs it out afterwards.

## Once per instance

Pick a name (`demo` below), a domain, a loopback port no other instance uses, and a mode:

- `Demo` gives every visitor their own private copy of a fictional family, with no sign-in, and deletes each copy after a day.
- `Family` is private. Nothing is readable without signing in.

1. Point the domain's DNS `A` record at the server.
2. Create the instance folder and its `.env`. The file holds the database password, so it is readable only by you.

   ```bash
   mkdir -p ~/wheelhouse/demo
   ```

   ```bash
   (umask 077; printf 'WHEELHOUSE_MODE=Demo\nWHEELHOUSE_HTTP_PORT=8610\nWHEELHOUSE_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > ~/wheelhouse/demo/.env)
   ```

3. Give the server's nginx a site for the domain. Start from [`nginx/site.conf.example`](nginx/site.conf.example), replacing the domain and port, then enable it and add HTTPS:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

   ```bash
   sudo certbot --nginx -d wheelhouse.example.com
   ```

4. For a `Family` instance, set up [Google sign-in](#google-sign-in). Until it is, nobody can sign in.

The instance starts on the next release.

## Google sign-in

Parents sign in to a family instance with their own Google accounts. Google is used only to say who they are; nothing else is read from their accounts. The demo never calls Google.

Once, in the [Google Cloud console](https://console.cloud.google.com/), in a project of your choosing:

1. Under **Google Auth Platform**, configure the consent screen: an **External** app with the instance's name and your support email. The only scopes it needs are `openid`, `email` and `profile`, which need no Google review.
2. **Publish** the app (Audience → Publish app) so it is "In production". In Testing mode Google expires each sign-in after 7 days.
3. Under **Clients**, create an OAuth client of type **Web application**. Add `https://<the instance's domain>/api/auth/google/callback` as an authorized redirect URI. Add `http://localhost:8080/api/auth/google/callback` too if you want to try sign-in locally.

Then add the client and the parents' addresses to the instance's `.env`. Only the addresses listed can sign in, and removing one signs that parent out on their next request.

```
WHEELHOUSE_GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
WHEELHOUSE_GOOGLE_CLIENT_SECRET=<client secret>
WHEELHOUSE_PARENT_EMAILS=<first parent's address>,<second parent's address>
```

The first parent to sign in creates the family, in their phone's time zone, with themselves as its first parent; rename it in Settings. If they add the other parent in Settings under the name on that parent's Google account, the other parent's first sign-in takes over that member instead of adding a second one.

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
