# 0005. Calendar-first scope keeps the legacy tables

**Status:** Accepted, October 2026

## Context

Wheelhouse once had chores, shared lists, groceries, meals and recipes alongside the calendar. Each half-finished feature spread the wall and phone thin, and the calendar, which the family uses every day, needed a full redesign. Those features also left tables and real records in deployed databases.

## Decision

Wheelhouse is calendar-first. The deferred features' routes, endpoints, SignalR transport, demo data and tests were removed, and their designs moved to [`docs/archive/`](../archive/).

Their EF Core entities, relationships, migrations and model snapshot stay, as persistence shapes only. No migration drops or alters those tables as part of calendar work. Removing them needs its own decision about archiving or deleting the data.

See [calendar-only scope](../calendar-only-scope.md) for the full list.

## Consequences

- The app is smaller and every screen is about the calendar.
- No family loses data, and the runtime model still matches the deployed schema, so demo-copy cascades keep working.
- The code carries entity types (`Chore`, `HouseholdList`, `Recipe` and others) with no behavior. The project rules say not to add any.
- Bringing a feature back starts from a new feature decision and the archived design, not from the old code.
