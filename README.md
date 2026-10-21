# Wheelhouse

Wheelhouse is a **calendar-first family command center**: a wall-mounted touch calendar and a companion phone app for the family's Google Calendar events.

The calendar is the only active household planning feature. On the wall, families can browse Day, Week and Month, view members' color-coded calendars and local weather, and add, edit or delete Google Calendar events. On the phone, Today and Calendar provide the companion view and Settings manages members, calendars and paired displays. Real-time SignalR updates, reconnection and conflict-safe event editing remain supported.

The fictional Marlowe family demo generates private, date-relative calendar data, including recurring appointments and school events. Each visitor has a separate 24-hour copy; demo activity never calls Google.

**Deferred, not deployed:** chores, to-dos/shared lists, grocery lists, meals and recipes are future features. Previous work is preserved in [the household roadmap](docs/household-roadmap.md) and Git history. Their historical EF Core tables and migrations are retained for compatibility and existing user data, but the application no longer exposes their pages, APIs, live connections or demo records. See [calendar-only scope](docs/calendar-only-scope.md) for implementation and data-retention decisions.

## Layout

| Path | What it holds |
| --- | --- |
| `src/Wheelhouse.Api/` | ASP.NET Core 10 API, EF Core with PostgreSQL |
| `tests/Wheelhouse.Api.Tests/` | xUnit integration tests against a real PostgreSQL from Testcontainers |
| `web/` | Angular 22 app: `/wall` for the wall display, `/` for phones |
| `compose.yaml` | Local stack: database, API and web |
| `deploy/` | Production stack, the server-side deploy script and [how to deploy](deploy/README.md) |
| `.github/workflows/` | CI on pull requests and on `main`; a version tag publishes images and deploys |

## Run it

You need Docker with Compose.

```bash
docker compose up --build -d
```

Open http://localhost:8080 for the phone layout and http://localhost:8080/wall for the wall display. Locally the app runs as the demo, so you get your own copy of the fictional Marlowe family without signing in. Change anything you like: only your browser sees it, and it is cleared after a day. `http://localhost:8080/health` reports whether the API can reach its database.

New demo copies start with Clara, Julian, Milo and Nora in Maplewood, NJ. `Demo/DemoSeedData.cs` builds their calendars and events relative to the copy's creation instant in America/New_York. `DemoSeedAdapter` maps the calendar dataset to the existing EF entities. The school district calendar is read-only. Dates handle New York DST gaps and overlaps. This needs no migration and never reseeds an existing visitor's edits or a private family. A new visitor (or an expired copy) gets fresh relative dates; the existing 24-hour lifetime and cleanup remain unchanged.

```bash
docker compose down
```

`down` keeps the database volume. Add `--volumes` to delete it.

To try a private family instance with Google sign-in instead, create a Google OAuth client as [deploy/README.md](deploy/README.md#google-sign-in) describes, with `http://localhost:8080/api/auth/google/callback` as a redirect URI, and start the app with these set in your shell or in a `.env` file next to `compose.yaml` (never committed):

```
WHEELHOUSE_MODE=Family
WHEELHOUSE_GOOGLE_CLIENT_ID=<client id>
WHEELHOUSE_GOOGLE_CLIENT_SECRET=<client secret>
WHEELHOUSE_PARENT_EMAILS=<your address>
```

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


