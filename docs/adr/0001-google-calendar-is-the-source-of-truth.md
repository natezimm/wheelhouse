# 0001. Google Calendar is the source of truth, with a local cache

**Status:** Accepted, October 2026

## Context

Families already keep their events in Google Calendar and edit them from Google's own apps, school feeds and invitations. A wall display has to show those events within minutes, keep working when Google is slow, and let anyone at the wall add or move an event without a second copy drifting out of step. Google's API is rate limited, and reading every calendar on every screen load would be slow and would leak quota across families.

## Decision

Google stays the only place an event lives. The API keeps a per-family cache of expanded occurrences (`EventInstance`) and reads only from it.

- **Reads.** `CalendarSync` asks each calendar what changed since its sync token every two minutes, and does a full read of 90 days back and 400 ahead only when Google says the token is stale (410) or once a day as the window moves. Screens are told which days the window holds, so a day outside it reads "Not synced this far" rather than empty.
- **Writes go to Google first.** [`EventEndpoints`](../../src/Wheelhouse.Api/Calendar/EventEndpoints.cs) sends each change with the cached etag in `If-Match`, then stores what Google returns. Google's 412 becomes a 409 carrying Google's current version, which the screens show instead of the edit.
- **Wheelhouse-only fields ride in Google.** Who an event is for and whether it counts down are private extended properties, so they survive a round trip through other Google apps without showing there.
- All Google calls go through `IGoogleCalendar`, so the tests use a fake, and a separate on-demand job checks the real API against a test account.

## Consequences

- Nothing a family enters in Wheelhouse can be lost if Wheelhouse goes away; it is all in their Google account.
- Edits made in Google's own apps appear on the wall within about two minutes, not instantly.
- Every write costs a Google round trip. The screens hide that with optimistic overlays ([0003](0003-per-family-change-numbers.md)) and retry creates idempotently: a client's `creationId` maps to one deterministic Google event id ([`EventIdentity`](../../src/Wheelhouse.Api/Calendar/EventIdentity.cs)).
- Repeating events follow Google's model: one occurrence, the whole series, or this-and-following, which splits a series with `UNTIL` and inserts the new one first so a failure shows events twice rather than losing them.
