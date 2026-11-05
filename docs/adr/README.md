# Architecture decision records

Short records of the choices that shape Wheelhouse: the context at the time, what was decided, and what it costs. A new record gets the next number; a record that no longer holds is marked superseded rather than deleted.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-google-calendar-is-the-source-of-truth.md) | Google Calendar is the source of truth, with a local cache | Accepted |
| [0002](0002-family-scoping-in-the-db-context.md) | Family scoping by query filter in the DbContext | Accepted |
| [0003](0003-per-family-change-numbers.md) | Per-family change numbers drive live updates | Accepted |
| [0004](0004-demo-copies-that-expire.md) | The public demo gives each visitor a copy that expires | Accepted |
| [0005](0005-calendar-first-scope-keeps-legacy-tables.md) | Calendar-first scope keeps the legacy tables | Accepted |
| [0006](0006-reminders-by-web-push.md) | Reminders by Web Push, with no third-party service | Accepted |
| [0007](0007-event-reminder-time-in-googles-field.md) | An event's own reminder time lives in Google's reminders field | Accepted |
| [0008](0008-the-cache-is-disposable.md) | Google is the source of truth; the cache is disposable, and sync survives Google failing | Accepted |
