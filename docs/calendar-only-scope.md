# Calendar-only scope and data retention

**Status:** calendar-first simplification, October 2026.

## Active capabilities

- Phone Today and Calendar, wall Day/Week/Month, family/member and display settings.
- Google Calendar connection, event create/edit/delete, optimistic writes, calendar SignalR, reconnection, synchronization and weather.
- Separate, date-relative calendar-only fictional demo copies.

## Deferred backlog

- Chores, recurring chores and to-dos.
- Named shared lists and grocery shopping.
- Meal planning, saved recipes, and meals-to-groceries.

Keep the previous feature specifications and the historical roadmap in [archive/](archive/) for future design decisions. They are not deployed promises.

## Retired now

- Remove all phone and wall routes, buttons, pages, stores, and unit/browser tests specific to deferred features.
- Remove old household REST handlers, household SignalR endpoints/background polling, related client startup, and cross-cutting disconnect/publish hooks.
- Remove deferred-feature demo data and avoid creating grocery lists automatically for new families.
- Update smoke checks to require the calendar rather than obsolete sections.

## Non-destructive migration policy

Existing PostgreSQL records **must not be deleted**. Retain historical EF Core domain entities, DbSets, navigation properties, tracking metadata, model snapshot, and every migration for now. This keeps the runtime model consistent with the deployed schema and maintains demo-copy cascade cleanup. These persistence-only definitions do not mean the deferred features are usable. Do **not** scaffold or apply a drop-table migration in this scope. A future data-retention plan can explicitly decide whether to archive/export and safely remove unused tables.

## Next

Follow the Skylight-inspired [calendar redesign plan](archive/calendar-redesign-plan.md) separately: weekly-first wall, clear Day/Week/Month navigation, responsive phone agenda and polished event workflows. Keep schema cleanup out of that visual PR.
