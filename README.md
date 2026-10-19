# Wheelhouse

Wheelhouse is a family command center: a wall-mounted touch display and a phone web app that share one live family view of Google Calendar events, chores, to-dos, and the week's meals with a grocery list.

This is early work. So far the wall shows the family's Google calendars by day, week or month in each person's color with today's weather, the phone shows today and the month, and both add, change and delete events, which are written to Google Calendar. The app runs either as a private family instance, where parents sign in with Google and connect the family's Google account, or as a public demo with a fictional family that never calls Google. Wall and phone receive live calendar updates and recover missed changes after reconnecting. Edits appear immediately while saving, and uncertain saves can be checked safely. Wall, Today and phone Calendar show live connection status and a Resync now action that refreshes their current days without losing filters or drafts. Google reauthorization is shown separately; resync does not force a new Google import. One-time and repeating chores are shared across wall and phone; lists and meals arrive in later increments.

## Roadmap

Chores are available on the phone at `/chores` and on the wall at `/wall/chores`. Parents add, assign, edit and archive chores on their phone; either layout completes and reopens them. Repeats support daily or selected weekdays every 1–52 weeks, with an optional end date. Each dated occurrence completes independently. Schedule edits and stops take effect tomorrow, preserving today and earlier history; missed repeats stay on their own date. Chores update live and retain pending saves during recovery. Phone Today summarizes due and overdue chores with quick completion controls. Both chores layouts have member/status filters, daily progress and a history view for up to 31 due dates, including archived work and household-zone completion timestamps. Shared lists and meals follow in the roadmap below.

The [chores, lists and meals roadmap](docs/household-roadmap.md) records merged increments, current work, completion criteria and deferred features.

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

