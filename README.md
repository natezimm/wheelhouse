# Wheelhouse

Wheelhouse is a family command center: a wall-mounted touch display and a phone web app that share one live family view of Google Calendar events, chores, to-dos, and the week's meals with a grocery list.

This is early work. So far the wall and phone layouts show the family's members in their colors, and the app runs either as a private family instance or as a public demo with a fictional family. Sign-in, calendar, chores, lists and meals arrive in later milestones.

## Layout

| Path | What it holds |
| --- | --- |
| `src/Wheelhouse.Api/` | ASP.NET Core 10 API, EF Core with PostgreSQL |
| `tests/Wheelhouse.Api.Tests/` | xUnit integration tests against a real PostgreSQL from Testcontainers |
| `web/` | Angular 22 app: `/wall` for the wall display, `/` for phones |
| `compose.yaml` | Local stack: database, API and web |
| `deploy/` | Production stack, the server-side deploy script and [how to deploy](deploy/README.md) |
| `.github/workflows/` | CI on every push; a version tag publishes images and deploys |

## Run it

You need Docker with Compose.

```bash
docker compose up --build -d
```

Open http://localhost:8080 for the phone layout and http://localhost:8080/wall for the wall display. Locally the app runs as the demo, so you get your own copy of the fictional Marlowe family without signing in. Change anything you like: only your browser sees it, and it is cleared after a day. `http://localhost:8080/health` reports whether the API can reach its database.

```bash
docker compose down
```

`down` keeps the database volume. Add `--volumes` to delete it.

## Develop

You need the .NET 10 SDK and Node 24 or later. Start only the database in Docker, then run the API and the web app from source.

```bash
docker compose up db -d
dotnet run --project src/Wheelhouse.Api
```

In a second terminal:

```bash
cd web
npm ci
npm start
```

Open http://localhost:4200. The dev server forwards `/api`, `/hubs` and `/health` to the API on port 5080.

To use other ports or another database password locally, set `WHEELHOUSE_HTTP_PORT`, `WHEELHOUSE_DB_PORT` or `WHEELHOUSE_DB_PASSWORD` before `docker compose up`. If you change the password, set `ConnectionStrings__Wheelhouse` to match when you run the API from source.

## Test

```bash
dotnet test
```

The API tests start their own PostgreSQL container, so Docker must be running.

```bash
cd web
npm test -- --watch=false
```

## Secrets

Nothing secret belongs in this repository. The only password in it is the local development database default, which exists only on your machine. Real credentials live in the server's environment, outside git.
