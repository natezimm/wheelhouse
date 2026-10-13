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

**One web app, two layouts.** `web/` is a single Angular app. `/wall` is the wall display (a 1920 × 1080 touch screen in kiosk mode) and `/` is the phone layout. Both talk only to the API. State lives in root-provided stores under `web/src/app/core/` that expose read-only signals; components are standalone, the app is zoneless, and small components keep their template and styles inline.

**API by feature.** `src/Wheelhouse.Api/` is ASP.NET Core minimal APIs in feature folders (`Families`, `Demo`, `Auth`, `Sessions`, `Health`). Each feature exposes a `MapX()` extension that `Program.cs` calls.

**Instance mode.** The same image runs as two kinds of instance, chosen by `Wheelhouse:Mode` (`WHEELHOUSE_MODE` in a deployed instance's `.env`):

- `Family` is a real family's private instance. Nothing is readable without signing in. It is the default when the setting is missing, and it must stay the default.
- `Demo` is the public demo. `DemoAuthenticationHandler` signs every visitor in as a parent of a fictional family, which is seeded at startup and reset every night.

Local development and `docker compose up` run as `Demo`.

**Family scoping.** Every table that holds a family's data implements `IFamilyOwned`. `WheelhouseDbContext` gives each of those a query filter on `CurrentFamilyId`, which comes from the signed-in principal's `wheelhouse:family` claim through `ICurrentFamily`. Outside a request there is no current family and filtered queries return nothing. Code that runs without a request, such as the demo seeder, must opt out with `IgnoreQueryFilters()` on purpose.

**Authorization.** A policy scheme picks demo or cookie authentication per request from the instance mode. Endpoints require the `Family` policy (anyone signed in to a family) or the `Parent` policy. Only `/health` and `/api/session` are open; a new endpoint needs `RequireAuthorization(...)`.

**Startup.** `PrepareDatabaseAsync` applies migrations before the API takes requests, then seeds the demo family on a demo instance. If the database cannot be reached the process exits and the container's restart policy retries.

**Configuration is read late.** Read settings inside a DI factory or through `IOptions`, not from `builder.Configuration` while registering services. The integration tests add their overrides in a way that only takes effect once the host is built, so an early read sees the wrong database or mode.

**Deploy.** Pushing a `v*` tag runs `release.yml`: tests, images to GitHub Container Registry, then `deploy/deploy.sh` on the server, which moves every instance under `~/wheelhouse/*/` to that version. Each instance is its own Compose project from `deploy/compose.yaml` with its own database, network and secrets. The server's nginx terminates HTTPS and forwards to the instance's web container on a loopback port; that container serves the Angular build and forwards `/api`, `/hubs` and `/health` to the API.

**Look and feel.** Colors and fonts are design tokens in `web/src/styles.css`, taken from the mockups. A member's color identifies them everywhere; tints are derived from it with `color-mix` rather than stored.

## Project rules

- **This repository will be made public.** Never commit a real family's names, email addresses, the family instance's domain, or anything from a server's `.env`. Demo data is fictional and stays that way.
- **Every feature ships with its demo seed data** (see `Demo/`) and a minimal phone screen alongside the wall view.
- **Touch targets** are at least 56 px on the wall and 44 px on the phone.
- **API tests run against real PostgreSQL** through `ApiFactory`. The `api` collection shares one container. `InMode(InstanceMode.Demo)` gives a host in another mode, and `DbContextFor(familyId)` reads and writes as a given family. Each test must pass when run alone.
- **Changes reach `main` through pull requests.** CI runs on pull requests and on `main`.
