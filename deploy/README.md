# Deploying Wheelhouse

One server can run any number of Wheelhouse instances, for example a public demo and a family's private one. Each instance is a folder under `~/wheelhouse` with its own `.env`, database and domain. Instances share only the image version.

Pushing a version tag runs the tests, publishes the images to GitHub Container Registry, and moves every instance on the server to that version.

## Once per server

1. Install Docker with the Compose plugin, and make sure the deploy user can run `docker ps` without `sudo`.
2. Add three secrets to the GitHub repository: `GCP_HOST` (the server's address), `GCP_USER` (the deploy user) and `GCP_SSH_KEY` (a private key that user accepts).

The server needs no registry credentials of its own. Each release signs it in with a short-lived token and signs it out afterwards.

## Once per instance

Pick a name (`demo` below), a domain, and a loopback port no other instance uses.

1. Point the domain's DNS `A` record at the server.
2. Create the instance folder and its `.env`. The file holds the database password, so it is readable only by you.

   ```bash
   mkdir -p ~/wheelhouse/demo
   ```

   ```bash
   (umask 077; printf 'WHEELHOUSE_HTTP_PORT=8610\nWHEELHOUSE_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > ~/wheelhouse/demo/.env)
   ```

3. Give the server's nginx a site for the domain. Start from [`nginx/site.conf.example`](nginx/site.conf.example), replacing the domain and port, then enable it and add HTTPS:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

   ```bash
   sudo certbot --nginx -d wheelhouse.example.com
   ```

The instance starts on the next release.

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
