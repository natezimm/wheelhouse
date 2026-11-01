# 0004. The public demo gives each visitor a copy that expires

**Status:** Accepted, October 2026

## Context

The demo is how most people will see Wheelhouse, and it should let them do everything: add, drag, delete and repeat events, pair a wall with a phone, change the theme. A single shared demo family would be vandalized or confusing within a day. Asking a visitor to sign in would turn most of them away, and the demo must never touch a real Google account.

## Decision

The same image runs as either a `Family` instance or a `Demo` instance (`Wheelhouse:Mode`). `Family` is the default, so a missing setting can never expose a real family.

On a demo instance, `POST /api/demo/visit` makes a private copy of the fictional Marlowe family and signs the visitor in to it as a parent. A copy is an ordinary family row with `ExpiresAt` set 24 hours ahead ([`DemoCopies`](../../src/Wheelhouse.Api/Demo/DemoCopies.cs)). Its events are seeded relative to the moment it is made, in America/New_York, so "today" always has something on it. Edits go straight to the copy's cache, which expands repeating events itself; the demo never calls Google.

A cleanup service deletes expired copies. When the demo holds `MaxDemoCopies`, a newcomer's copy replaces the oldest instead of turning the visitor away; copies are admitted one at a time under a PostgreSQL advisory lock, so newcomers arriving together cannot overshoot the limit.

Each copy holds at most `MaxDemoEvents` events, counting every occurrence of a series, and a repeating event must start within the last 90 days, the same days Google's sync window keeps, so one request expands at most about 490 occurrences.

## Consequences

- Visitors can change anything, and only they see it.
- Real families are safe from cleanup by construction: they have no `ExpiresAt`.
- The demo exercises the same endpoints, family scoping and live notifications as a real family, and the CI `stack` job and every release browser-check it.
- Demo writes skip Google, so the Google path is covered by the fake in the tests and by the on-demand live Google check instead.
- Storage is bounded, though not small: at most `MaxDemoCopies` copies of at most `MaxDemoEvents` events each. Rate limits bound how often a visitor writes and how many copies one address makes; these limits bound how much each write and each copy can hold. Each container's log is capped too (`deploy/compose.yaml`).
