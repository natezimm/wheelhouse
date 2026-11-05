# Security and threat model

What Wheelhouse protects, from whom, how, and where it knowingly accepts a risk. [ADR 0012](adr/0012-threat-model-and-security-tradeoffs.md) records why the main tradeoffs were made; this page is the working copy to keep current. A change that adds a way in (an open endpoint, a new secret, a new outside service, a new kind of sign-in) updates this page in the same pull request.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## What is worth protecting

| Asset | Where it lives | Worst case if lost |
| --- | --- | --- |
| The family's calendar: events, notes, places, who goes where | Google Calendar; a cache in PostgreSQL | Someone learns where the children are and when the house is empty |
| The shared Google account's refresh token | `GoogleConnection`, encrypted with Data Protection | Read and write access to every calendar on that account, outside Wheelhouse, until revoked in Google |
| Sign-in cookies (parents and walls) | Each browser; signed and encrypted with Data Protection | Acting as that parent or wall until the cookie is revoked |
| Data Protection keys | The instance's `keys` volume, and each nightly backup | Decrypting the refresh token and forging any cookie for that instance |
| The VAPID private key | `PushKeys`, encrypted with Data Protection | Sending notifications to the family's subscribed phones |
| Push subscriptions | `ReminderSubscriptions` | A phone's push endpoint and keys; with the VAPID key, unwanted notifications |
| Instance secrets: database password, Google OAuth client secret, parent email list | The instance's `.env` on the server, and each nightly backup | Combined with server access, everything above |
| Deploy access | GitHub secrets `GCP_SSH_KEY` and friends | Running anything on the server |

The demo holds none of this: its families are fictional, it never calls Google, and every copy is deleted within the hour after it expires.

## Who might attack, and what they can reach

- **Anyone on the internet.** They can reach `/health`, `/robots.txt`, `/api/session`, the demo's `/api/demo/visit`, the start of Google sign-in and the display's two pairing endpoints. Everything else needs a cookie (`AccessTests` fails if that list grows).
- **A demo visitor.** A parent of their own throwaway copy, on the demo instance only. A demo cookie is meaningless to a family instance, which has its own Data Protection keys.
- **Another site under the same registrable domain.** The demo and the family instance are siblings (`demo.example.com`, `home.example.com`), so the browser treats them as one *site* for `SameSite`. A script on a sibling can make the browser send the family cookie along with requests it starts.
- **Someone in the house, or a guest.** They can touch the wall, which is signed in for a year.
- **A thief of a phone or a backup.** They hold a parent's cookie, or a copy of the database, keys and `.env`.
- **A compromised dependency or workflow.** An npm or NuGet package, a container base image or a GitHub Action that runs with the build's or the server's access.

Out of scope: Google itself, a compromised server operating system, and a parent who means the family harm (a parent can already see and change everything).

## Sign-in: a parent's Google account versus a wall's cookie

Everyone holds the same kind of cookie (`wheelhouse`, encrypted and HTTP-only, `SameSite=Lax`, `Secure` over HTTPS) carrying their family's id. How it is issued, and what it allows, differs.

**A parent** signs in with Google (`ParentSignIn`). Only verified addresses on `WHEELHOUSE_PARENT_EMAILS` get in; the Google account is linked by its subject id, so a later change of address in Google does not hand the account to someone else. The cookie lasts 14 days and slides, and every request checks that the account is still linked to a parent on the list, so removing someone signs them out at once. Google does the password, the second factor and the suspicious-login checks; Wheelhouse stores no password.

**A wall** has no keyboard worth typing a password on and no Google account of its own, so it pairs: it shows a 6-digit code, a parent types it on their phone, and the wall collects a cookie that names its device row. That cookie lasts a year and slides, and every request checks that the device row still exists and touches its `LastSeenAt`, so a parent removing the wall in Settings signs it out on its next request.

| | Parent | Wall |
| --- | --- | --- |
| Proves who it is with | Google (password, 2FA) | Possession of the cookie |
| Lifetime | 14 days, sliding | 365 days, sliding |
| Revoked by | Removing the member or the address from the list | Removing the display in Settings |
| Can | Everything | Read the calendar (private events only as "Busy"), add, move and delete non-private events, set countdowns |
| Cannot | | Settings, members, Google connection, pairing, private events, reminders |

The tradeoff: a wall's cookie is a bearer token with write access to the calendar for a year. Anyone who can open the wall's browser profile can copy it. We accept that because the wall is in the family's kitchen, because what it can do is what anyone standing at the wall can do anyway, and because removal is immediate. What a stolen wall cookie cannot do is the damage that matters most: it cannot read private events, see the Google token, change who is a parent or pair another device.

**Pairing codes** are six random digits (`RandomNumberGenerator`) that work for 10 minutes. Guessing one is useless without being a parent of a family, since only a parent can claim a code (`POST /api/devices`), and claiming is limited to 10 tries a minute per address. On the demo anyone can be a parent of a copy, so a demo visitor could in principle claim another demo visitor's wall: with at most 1000 codes waiting, 10 guesses a minute find one about once every 100 minutes, and the prize is a fictional family. The wall's side polls with a random pairing id that only it was given.

## Cross-site requests: SameSite and the Origin check

`SameSite=Lax` keeps the cookie off cross-*site* POST, PUT and DELETE. It does not help against a sibling subdomain, which is the same site. So `Auth/SameOrigin` refuses (403) any change (any method but GET, HEAD and OPTIONS) and every `/hubs` request whose `Origin` is present and is not exactly this instance's scheme, host and port, after forwarded headers. An `Origin: null` (sandboxed frames, some redirects) is refused too.

Requests with no `Origin` at all are let through, because every current browser sends one on a cross-origin POST and on a WebSocket handshake, and scripts and health checks send none; those still need a valid cookie. GET endpoints change nothing a visitor chose, which is what makes leaving them unchecked safe: keep it that way. The two that store something are OAuth callbacks (`/api/auth/google/callback` and `/api/calendar/google/callback`), and each is bound to its own round trip: the sign-in by the OAuth handler's correlation cookie and `state`, the Calendar connection by a signed `state` that names the family.

The tradeoff is that this leans on browsers always sending `Origin` on cross-origin changes. An anti-forgery token would not, but would mean a token round trip for every screen and for the SignalR handshake. We chose the header check, plus the rule that GET never changes anything.

## Rate limits

Every request counts against `Auth/RateLimits`: 600 a minute and 120 changes a minute, per signed-in family (its phones and walls together) or per address for anyone else. Asking for pairing codes (10 per 10 minutes per address), guessing them (10 a minute) and making demo copies (20 an hour per address) have their own, tighter limits. The limiter runs after authentication and before authorization, so a refused request still counts, and a family's partition comes from its encrypted cookie, which cannot be forged to drain another family's allowance.

The address is the visitor's own: the server's nginx appends it to `X-Forwarded-For`, the web container passes the header through, and the API takes only the last entry, so a visitor who sends their own `X-Forwarded-For` cannot pose as someone else. The API is reachable only from the web container, and the web container only on the server's loopback.

Tradeoffs: fixed one-minute windows allow up to twice the limit across a window boundary, and limits are kept in memory, so a restart resets them. Both are fine for a single small server. The limits protect the server and the family's Google quota, not against a determined, distributed attacker, which is out of scope for one VM.

## Google tokens

The family's calendars come from one shared Google account, connected once by a parent. Its refresh token is encrypted with Data Protection (`GoogleTokens`, purpose `Wheelhouse.Calendar.GoogleRefreshToken`) before it is stored, so a copy of the database alone does not reveal it. Access tokens live only in memory. The consent round trip's `state` is time-limited (15 minutes) and names the family, so a code obtained for one family cannot be attached to another. Google's `invalid_grant` marks the connection as needing a reconnect instead of retrying.

The scope is the full `https://www.googleapis.com/auth/calendar`, because Wheelhouse lists the account's calendars and writes to them. Narrower scopes (`calendar.events` plus `calendar.calendarlist.readonly`) would do the same job and are listed below as a follow-up; changing them needs every family to connect again.

Sign-in with Google is separate and asks only for the basic profile and email. Its client secret is in `.env`.

## Data Protection keys

ASP.NET Core Data Protection keys sign and encrypt the cookies, the refresh token, the consent state and the VAPID private key. They live on their own Docker volume (`keys`), not in the database, and rotate every 90 days (old keys keep decrypting).

On disk the keys are not encrypted themselves (ASP.NET logs "No XML encryptor configured"). Encrypting them would need a key from somewhere else on the same server, such as `.env`, which gains little. What the separate volume buys is that a database dump alone (a leaked `pg_dump`, a support copy) decrypts nothing. It does not buy that for the nightly backups: each backup archive holds the dump, the keys and the `.env` together, because a restore needs all three. The backup bucket is therefore as sensitive as the server. That is why the VM's service account can only add to it, never read or delete ([ADR 0009](adr/0009-nightly-dumps-to-an-add-only-bucket.md)), and only the project owner can read it.

## Push keys and subscriptions

The instance makes its own VAPID key pair on first use and keeps it in `PushKeys`, its private half encrypted with Data Protection (`VapidKeys`). There is nothing to configure and nothing to leak from `.env`. Each reminder is encrypted for the receiving browser (RFC 8291), so the push service sees only ciphertext, and signed with the VAPID key (RFC 8292).

A subscription's endpoint is a URL the browser gives us. `WebPush.IsPushEndpoint` accepts only HTTPS on the default port at the browser makers' push hosts (Google, Mozilla, Apple, Microsoft), so a subscription cannot make the server call an internal address or anywhere else. A 404 or 410 forgets the subscription. Subscriptions belong to a browser, not a person, are never given to displays, and are dropped when the browser can no longer read the family (a parent removed, a demo copy expired).

## The web app and its headers

The web container's nginx sends a Content-Security-Policy that allows scripts only from the site itself, plus `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and HSTS. Angular escapes what it renders, and event notes (which Google may store as HTML) are shown as text (`core/notes.ts`), never as HTML. `style-src` allows `'unsafe-inline'`, which Angular's component styles need; it does not allow scripts. HSTS leaves out `includeSubDomains` on purpose, so it cannot break other sites on the same domain.

The cookie is marked `Secure` whenever the request came over HTTPS, which the server's nginx says in `X-Forwarded-Proto`; `deploy/new-instance.sh` has certbot redirect plain HTTP to HTTPS so a family is never on HTTP.

## Logs and health

Logs never hold names, addresses, event titles or query strings (`Diagnostics/RequestLogging`). Client error reports are clipped and stripped of line breaks, so a screen cannot forge a log line. `/health` is public, so it holds ages, counts and the running version, never a family's ids.

## Delivery and dependencies

- Changes reach `main` only through pull requests, which run CI. Pull requests from forks get no secrets, and no workflow uses `pull_request_target`.
- Deploy secrets (`GCP_SSH_KEY`, `GCP_HOST`, `GCP_USER`, `GCP_KNOWN_HOSTS`) are used only by `release.yml` on `main` or a manual run. The server's host key is pinned in `GCP_KNOWN_HOSTS`.
- Container images are built in CI and pushed to GitHub Container Registry; the server only pulls them.
- Dependabot (`.github/dependabot.yml`) proposes monthly, grouped updates for npm, NuGet, Actions and the Dockerfiles.

### Security scanning

`.github/workflows/security.yml` runs on every pull request, on each push to `main` and every Monday:

| Job | What it finds | When it fails |
| --- | --- | --- |
| `CodeQL (csharp)`, `(javascript-typescript)`, `(actions)` | Injection, unsafe redirects, weak cookie or crypto settings, workflow script injection, with the `security-extended` queries | Alerts appear under the repository's Security tab and on the pull request; GitHub's code scanning check fails a pull request that adds a high or critical security alert (its default threshold) |
| `dependency-review` | A pull request that adds or upgrades to a dependency with a high or critical advisory | That pull request |
| `audit` | Any NuGet package (direct or transitive) or shipped npm package with a high or critical advisory in today's database | Any run, including the Monday one, so an advisory against an untouched dependency is noticed within a week |

It is separate from `ci.yml` on purpose: a release does not wait on it, so a newly published advisory flags pull requests without stopping a fix that is already tested from shipping. When `audit` fails, update the package (or wait for Dependabot's next run if no fixed version exists yet, and note it here). When CodeQL raises an alert that is a false positive, dismiss it in the Security tab with the reason, rather than suppressing the query.

## Findings and follow-ups

From the review that wrote this page (November 2026). Nothing found was exploitable from outside without a cookie.

**Fixed with this page**

- `deploy/new-instance.sh` and `deploy/README.md` now pass `--redirect` to certbot, so a new instance always sends plain HTTP to HTTPS rather than depending on certbot's prompt.

**Open, accepted for now**

| Finding | Risk | Why not now |
| --- | --- | --- |
| Google Calendar scope is the full `calendar` scope | A stolen refresh token can do anything to the shared account's calendars, including ones the family does not show | `calendar.events` plus `calendar.calendarlist.readonly` would work, but every family has to connect again; do it with the next release that needs a reconnect anyway |
| The cookie is named `wheelhouse`, not `__Host-wheelhouse` | A sibling subdomain could set a cookie of the same name for the parent domain. It cannot forge a valid one (other instances have other keys), so the effect is at most signing someone out | Renaming signs everyone out and every wall would have to pair again |
| Backups hold the dump, the Data Protection keys and `.env` together | Whoever can read the bucket can read everything | A restore needs all three; the bucket is add-only from the VM and readable only by the project owner |
| Data Protection keys are unencrypted on their volume | Root on the server reads them | Root on the server can read everything anyway |
| A wall's cookie is a year-long bearer token with write access | Copying it from the wall's browser lets someone edit non-private events until the wall is removed | By design; see the sign-in section |
| `release.yml`'s deploy secrets are repository secrets, not a protected environment | Anyone with write access could run the workflow from another branch and deploy it | Only the owner has write access. Moving the secrets to a `production` environment limited to `main` is a cheap step when a second person gets access |
| Demo walls' pairing codes can be guessed by another demo visitor | Joining a stranger's fictional demo family | Fictional data, rate limited, expires within the hour |

## Repository settings to keep on

These live in GitHub's settings rather than in files, so they are listed here:

- **Code security**: the dependency graph (the `dependency-review` job fails without it), Dependabot alerts and Dependabot security updates, secret scanning and push protection, and private vulnerability reporting (which SECURITY.md points to).
- **Branch protection on `main`**: require a pull request and the `CI` checks (`api`, `web`, `stack`); adding the `Security` jobs as required checks is optional, since a fresh advisory would then block unrelated pull requests until it is fixed.
