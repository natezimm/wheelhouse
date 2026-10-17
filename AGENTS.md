# AGENTS.md

Guidance for coding agents working in this repository. The README covers what Wheelhouse is and how to run it; this file covers what you need to change it safely.

## Commands

Run these from the repository root unless a line says otherwise.

| Task | Command |
| --- | --- |
| Build the API and tests | `dotnet build` |
| API tests (Docker must be running) | `dotnet test` |
| One API test class | `dotnet test --filter "FullyQualifiedName~FamilyTests"` |
| One API test | `dotnet test --filter "DisplayName~A_family_sees_only_its_own_rows"` |
| Web tests, in `web/` | `npm test -- --watch=false` |
| One web spec file, in `web/` | `npm test -- --watch=false --include src/app/core/family.spec.ts` |
| Web tests by name, in `web/` | `npm test -- --watch=false --filter "is private"` |
| Web production build, in `web/` | `npm run build` |
| Whole app at http://localhost:8080 | `docker compose up --build -d` |
| Database only, for running from source | `docker compose up db -d` |
| API from source, port 5080 | `dotnet run --project src/Wheelhouse.Api` |
| Web dev server, port 4200, in `web/` | `npm start` |
| New migration | `dotnet tool restore`, then `dotnet ef migrations add <Name> --project src/Wheelhouse.Api --output-dir Data/Migrations` |

There is no linter. Prettier settings live in `web/.prettierrc` but are not enforced, and some files do not match them, so do not reformat files you are not otherwise changing.

The API tests start their own PostgreSQL with Testcontainers. They never use the Compose database.

## Architecture

**One web app, two layouts.** `web/` is a single Angular app. `/wall` is the wall display (a 1920 × 1080 touch screen in kiosk mode) and `/` is the phone layout. Both talk only to the API. Settings live only on the phone, under `/settings`; the wall has none. State lives in root-provided stores under `web/src/app/core/` that expose read-only signals; components are standalone, the app is zoneless, and small components keep their template and styles inline.

**API by feature.** `src/Wheelhouse.Api/` is ASP.NET Core minimal APIs in feature folders (`Families`, `Demo`, `Auth`, `Devices`, `Calendar`, `Weather`, `Sessions`, `Health`). Each feature exposes a `MapX()` extension that `Program.cs` calls.

**Instance mode.** The same image runs as two kinds of instance, chosen by `Wheelhouse:Mode` (`WHEELHOUSE_MODE` in a deployed instance's `.env`):

- `Family` is a real family's private instance. Nothing is readable without signing in. It is the default when the setting is missing, and it must stay the default.
- `Demo` is the public demo. Each visitor gets a private copy of a fictional family (`Demo/DemoCopies`) and is signed in to it as a parent. A copy is a family row with `ExpiresAt` set, deleted an hour or less after it expires. A real family has no `ExpiresAt`, so cleanup can never delete one.

Local development and `docker compose up` run as `Demo`.

**Family scoping.** Every table that holds a family's data implements `IFamilyOwned`. `WheelhouseDbContext` gives each of those a query filter on `CurrentFamilyId`, which comes from the signed-in principal's `wheelhouse:family` claim through `ICurrentFamily`. Outside a request there is no current family and filtered queries return nothing. Code that runs without a request, such as the demo seeder, must opt out with `IgnoreQueryFilters()` on purpose.

**Authorization.** Everyone is authenticated by one encrypted cookie that carries their family's id. On a demo instance `POST /api/demo/visit` issues it; that endpoint is the only sign-in without an account and answers 404 on a family instance. The web app calls it in an app initializer, so the cookie exists before any screen loads data. On a family instance a parent signs in with Google: `GET /api/auth/google` sends the browser to Google, which returns it to `/api/auth/google/callback`, where `ParentSignIn` admits only verified addresses listed in `Wheelhouse:ParentEmails` and links each Google account (`UserAccount`, by Google's subject id) to a parent member. The first parent to sign in creates the family. A parent's cookie also carries their account id and is re-checked on every request, so removing them from the family or from the list signs them out. Google is used for identity only here; Calendar access is a separate connection (see Calendar). A wall display signs in by pairing (`Devices/Pairing`): it asks `POST /api/pairing` for a 6-digit code, a parent enters the code on their phone (`POST /api/devices`), and the display's next `POST /api/pairing/{id}/finish` gives it the same cookie, carrying its device id instead of an account. The cookie lasts a year and slides; each request re-checks the device row and updates its `LastSeenAt`, so a parent removing the display from Settings signs it out at once. A display reads the family but is not a parent. On the demo, a wall starts with its own copy and its "Pair with a phone" button joins the phone's copy. The demo never calls Google. Endpoints require the `Family` policy (anyone signed in to a family) or the `Parent` policy. `Family` is also the fallback, so an endpoint that names no policy still needs a sign-in; anything only a parent may do needs `RequireAuthorization(Policies.Parent)`. Only `/health`, `/api/session`, `/api/demo/visit`, `/api/auth/google` and the display's two pairing endpoints are open, through `AllowAnonymous()`, and `AccessTests` fails if that list changes.

**Calendar.** Google Calendar is the source of truth for events; the API keeps a cache of it. `CalendarSource` is one Google calendar the family shows, owned by a member or, with no member, by the whole family, and `EventInstance` is one occurrence of an event, as Google expands recurring ones. A timed event is stored as UTC instants, an all-day one as dates with an exclusive end, as Google does. `GET /api/calendar?from=&to=` takes the family's own days, in its time zone, and the web app turns instants into days with `core/days.ts` rather than the browser's zone. The demo seeds a copy's calendars in `Demo/DemoCalendar`, relative to the day the copy is made, and never calls Google. Anyone signed in to the family, a paired wall included, adds, changes and deletes events through `/api/calendar/events` (`EventEndpoints`): each change goes to Google first with the cached occurrence's etag in `If-Match`, then the cache takes what Google stored. Google's 412 answers 409 with Google's current version, which the screens show instead; a change to one occurrence of a repeating event changes only that occurrence. A new event can repeat daily, weekly or monthly (`EventRepeat`, sent to Google as an RRULE), and `?series=true` on a change or delete applies to the whole series (`EventSeries`): Google's series is patched through its first event, every occurrence keeps its own day, and the calendar is read again at once because Google gives the occurrences new versions and often new ids. On the demo the change goes straight to the copy's cache, which expands a new series itself. A calendar the shared account cannot write to (`CanWrite`) is shown but takes no changes.

**Google connection.** A family's calendars come from one shared Google account, not from the parents' own. A parent connects it from Settings: `GET /api/calendar/google/connect` sends the browser to Google's consent screen for Calendar with offline access, and `/api/calendar/google/callback` stores the refresh token in `GoogleConnection`, encrypted with Data Protection (`GoogleTokens`), whose keys live on their own volume. The consent's `state` is signed and names the family, so a code cannot be attached to another family. `GET`/`PUT /api/calendar/sources` list the account's calendars and choose which show and whose each is; without a connection (the demo) they list the calendars the family already has. Google's `invalid_grant` marks the connection `NeedsReauth`; Settings asks a parent to connect again, and `GET /api/calendar` says `needsReconnect` so the wall shows a notice. On a family instance `CalendarSyncService` syncs every connected family every two minutes (`CalendarSync:Interval`), and at once after a parent connects or chooses calendars (`CalendarSyncTrigger`). `CalendarSync` asks each calendar what changed since its sync token and only then, or once a day as the window moves, reads its events from 30 days back to 180 ahead and replaces the cache; Google's 410 for an old token means a full read. The `calendar` health check turns `Degraded` when a pass fails or a connection needs reconnecting. The wall reads the calendar every 30 seconds, so a change in Google shows within about three minutes. The tests turn the worker off and run `CalendarSync` themselves. All Google calls go through `IGoogleCalendar`; `GoogleCalendarApi` is plain HTTP to Google's REST endpoints, and the tests replace it with a fake. `/privacy` is the page Google asks for before the OAuth app can be published.

**Weather.** `GET /api/weather` is today's weather where the family lives, from Open-Meteo (no key), cached for 30 minutes per place, so demo visitors share one forecast. A parent sets the place from their phone in Settings (`PUT /api/family/location`), kept to two decimal places. With no place it answers 204, and 503 when Open-Meteo cannot be reached; the screens then leave the weather out. Tests replace Open-Meteo's handler and never call it.

**Startup.** `PrepareDatabaseAsync` applies migrations before the API takes requests. If the database cannot be reached the process exits and the container's restart policy retries.

**Configuration is read late.** Read settings inside a DI factory or through `IOptions`, not from `builder.Configuration` while registering services. The integration tests add their overrides in a way that only takes effect once the host is built, so an early read sees the wrong database or mode.

**Deploy.** Pushing a `v*` tag runs `release.yml`: tests, images to GitHub Container Registry, then `deploy/deploy.sh` on the server, which moves every instance under `~/wheelhouse/*/` to that version. Each instance is its own Compose project from `deploy/compose.yaml` with its own database, network and secrets. `deploy/new-instance.sh` creates an instance's folder, `.env` and nginx site on the server; `deploy.sh` warns about a family instance whose Google sign-in is not filled in. The server's nginx terminates HTTPS and forwards to the instance's web container on a loopback port; that container serves the Angular build and forwards `/api`, `/hubs` and `/health` to the API. The API reads `X-Forwarded-Proto` and `X-Forwarded-For` from the server's nginx, so it knows a visitor came over HTTPS and marks the sign-in cookie `Secure`.

**Look and feel.** Colors and fonts are design tokens in `web/src/styles.css`, taken from the mockups, alongside the shared classes the phone's forms use (`card`, `field`, `button`). A member's color identifies them everywhere; tints are derived from it with `color-mix` rather than stored.

## Project rules

- **This repository will be made public.** Never commit a real family's names, email addresses, the family instance's domain, or anything from a server's `.env`. Demo data is fictional and stays that way.
- **Every feature ships with its demo seed data** (built in `Demo/DemoFamily`) and a minimal phone screen alongside the wall view.
- **Touch targets** are at least 56 px on the wall and 44 px on the phone.
- **A store changes only after the server accepts.** `FamilyStore` sends each change, then updates its signal from the response, so a refused change never shows on screen.
- **API tests run against real PostgreSQL** through `ApiFactory`. The `api` collection shares one container. `DemoVisitorAsync()` gives a client signed in as a parent of its own fresh copy of the demo family, which is how a test acts as a parent without touching another test's data. `DbContextFor(familyId)` reads and writes as a given family. Each test must pass when run alone.
- **Changes reach `main` through pull requests.** CI runs on pull requests and on `main`.
