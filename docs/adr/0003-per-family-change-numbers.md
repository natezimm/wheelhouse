# 0003. Per-family change numbers drive live updates

**Status:** Accepted, October 2026

## Context

A wall, two phones and a desktop can all show the same family at once. When one of them saves, or the Google sync finds a change, the others should update within a second or two. Pushing event data over the socket would duplicate the read path's privacy rules (a paired display sees private events only as busy), and pushing on save would miss changes made by the sync worker, by another process, or in a transaction that later rolls back.

## Decision

`Family` has a durable `bigint` change number. `WheelhouseDbContext.SaveChanges` advances it once per affected family, directly in PostgreSQL and in the same transaction as any visible calendar change ([`WheelhouseDbContext.CalendarChanges.cs`](../../src/Wheelhouse.Api/Data/WheelhouseDbContext.CalendarChanges.cs)). Etag-only updates and sync bookkeeping do not advance it.

[`CalendarLiveService`](../../src/Wheelhouse.Api/Calendar/CalendarLiveService.cs) reads committed numbers for subscribed families once a second and sends `CalendarChanged({ changeNumber })` over SignalR. The message carries no event data; clients read their visible days through `GET /api/calendar`, which returns the number from the same repeatable-read snapshot as the events.

On the client, [`CalendarStore`](../../web/src/app/core/calendar.ts) tracks the revision of its accepted snapshot separately from the highest notification, so duplicates do nothing, bursts coalesce into one read, and a snapshot can never move the screen backward.

## Consequences

- Only committed state is ever announced, whoever committed it.
- One read path enforces privacy and permissions; the socket cannot leak an event.
- Missed notifications are harmless: a 30-second recovery check and reconnects compare numbers and catch up.
- The publisher polls the database once a second, but only for families with an open connection, and does nothing when nobody is subscribed.
- A tracked `Family` entity can hold a stale number, so code reads it through an untracked query.
