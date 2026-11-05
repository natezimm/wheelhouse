# 0011. A written threat model, and the security tradeoffs it accepts

**Status:** Accepted, November 2026

## Context

Wheelhouse holds a family's whereabouts and a token that can write to their Google calendars, and it is about to be a public repository. Its defenses grew one pull request at a time: closed-by-default endpoints, Google sign-in with an allowlist, wall pairing, an Origin check, rate limits, encrypted tokens and push keys. Nothing said in one place what they defend against, which risks were left on purpose, or how a reviewer could tell whether a new change weakened them. Nothing scanned the code, and dependency updates arrived monthly without anyone checking them against known advisories.

## Decision

[docs/security.md](../security.md) is the threat model: the assets, who might attack and what they can reach, how each defense works, and a table of open findings with why each is accepted for now. A change that opens a way in updates it in the same pull request.

The tradeoffs it records:

- **Two kinds of sign-in on one cookie.** Parents prove who they are with Google (14-day sliding cookie, re-checked on every request); walls pair with a 6-digit code and then hold a year-long cookie, re-checked against their device row on every request. A wall's cookie is a bearer token with write access to non-private events. We accept that because removing a wall is immediate and what it allows is what anyone at the wall can do anyway.
- **Origin check instead of anti-forgery tokens.** `SameSite=Lax` does not separate sibling subdomains, so changes and `/hubs` require a matching `Origin` when one is sent, and GET never changes anything a visitor chose. This leans on browsers always sending `Origin` on cross-origin changes, which they do, and saves a token round trip on every screen and the SignalR handshake.
- **In-memory, fixed-window rate limits** per family or address. Good enough for one small server and the family's Google quota; not a defense against a distributed attack.
- **Data Protection keys on their own volume, unencrypted on disk.** A database dump alone decrypts nothing. Backups hold the dump, keys and `.env` together because a restore needs them, so the add-only bucket is as sensitive as the server.
- **Full Google Calendar scope**, kept until a release that needs every family to reconnect anyway.

Scanning runs in its own workflow, `.github/workflows/security.yml`: CodeQL with the `security-extended` queries for C#, TypeScript and the workflows; GitHub's dependency review on pull requests; and an audit of NuGet and shipped npm packages for high or critical advisories, weekly as well as on each change. It is separate from `ci.yml` so a newly published advisory flags pull requests without holding a release that is already tested.

## Consequences

- A reviewer has one page to check a change against, and the accepted risks are written down rather than rediscovered.
- CodeQL and the dependency review are free because the repository is public; if it ever goes private they need GitHub Code Security, and the workflow would have to drop them.
- An advisory against an untouched dependency turns the Monday run and new pull requests red until someone updates it. That is the point, but it means the occasional red pull request has nothing to do with its own change.
- Some protections live in GitHub's settings (Dependabot alerts, secret scanning, private vulnerability reporting, branch protection), which no file enforces; the threat model lists them.
