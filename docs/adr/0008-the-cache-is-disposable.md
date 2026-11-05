# 0008. Google is the source of truth; the cache is disposable

**Status:** Accepted, November 2026. Builds on [0001](0001-google-calendar-is-the-source-of-truth.md), which chose the cache; this record says what the cache may and may not be trusted with, and how sync behaves when Google fails.

## Context

[0001](0001-google-calendar-is-the-source-of-truth.md) put every event in Google and gave the API a cache of expanded occurrences (`EventInstance`) to read from. That left open what happens when the two disagree, and how the sync behaves on a bad day: Google answering 429 or a quota 403, a parent revoking the grant in their Google account, Google failing for one calendar of several, a read failing half way through, or the server being off for days and missing every pass in between.

A review of those paths found three real faults. A quota 403 was read as "the calendar is no longer shared", so a busy moment during a save marked the calendar read-only until a parent chose it again. One calendar failing ended the family's pass, so its other calendars waited for the next one. And a calendar that had never synced, because Google refused it from the start, never counted as stale, so health stayed green.

## Decision

**The cache holds nothing Google does not.** Every field a screen shows, including Wheelhouse's own (who an event is for, countdowns, reminder times), lives in Google ([0001](0001-google-calendar-is-the-source-of-truth.md), [0007](0007-event-reminder-time-in-googles-field.md)). The cache can be emptied at any time and a full read rebuilds it; nothing is migrated out of it, backed up for its own sake, or reconciled against it. Only bookkeeping (sync tokens, `ListedAt`, `LastSyncedAt`) is the cache's own, and losing it costs one full read.

**A read is kept whole or not at all.** `CalendarSync` asks Google first and changes the cache only after every page, and every series' rule, has arrived. Any failure before then leaves the calendar's rows, sync token and `LastSyncedAt` as they were, so the next pass asks the same question again. A screen's save that commits while Google is being read wins, as [0003](0003-per-family-change-numbers.md) describes.

**Failures are sorted by who else they affect.**

| Google answers | Means | What the sync does |
| --- | --- | --- |
| 429, or 403 with a `usageLimits` reason | Slow down; nothing was done | `GoogleRateLimitHandler` retries twice, waiting what Google asked (at most 4 s at once). Still refused, it throws `GoogleRateLimitedException`, an `HttpRequestException`, so a save answers 503 "Google is busy" and the calendar stays writable. The pass stops at once, since every other calendar would be refused too, and the worker waits before asking for the family again. |
| `invalid_grant` from the token endpoint | The grant was revoked or expired | The connection becomes `NeedsReauth`; screens say so and Settings asks a parent to connect again. The cache keeps showing what it had. |
| 401 on a calendar call | The access token stopped working mid-pass | The pass stops; the next one asks for a new token and learns then whether the grant itself is gone. |
| 403 or 404 otherwise | The calendar is no longer shared | It keeps its events and is skipped; health turns Degraded until a parent removes or re-chooses it. |
| 410 | The sync token lapsed | The calendar is read in full. |
| 5xx, a timeout, a dropped connection, a body that cannot be read | Google failed this time | That calendar keeps what it had and the family's other calendars go on; the failure is reported after them. |
| The token endpoint unreachable | Google failed this time | The pass is tried again later. It never marks the connection as needing a parent. |

**The worker backs off per family.** A family whose pass failed is skipped for one interval, then twice that for each failure in a row, up to 30 minutes, and never sooner than a `Retry-After` Google sent; quota refusals start one step further on. A pass that works resets it. A parent connecting or choosing calendars syncs that family at once whatever its wait. Each family gets its own `DbContext`, so nothing one family's failure left tracked can be saved with the next.

**Health tells a parent-sized problem from a passing one.** The `calendar` check is Degraded while a connection needs reconnecting, while any calendar has gone `StaleAfter` (ten minutes or five passes) without a sync, counting a calendar that never synced from when the account was connected, or while the last pass failed or a family is waiting out a backoff. It never fails `/health`, so a Google outage never fails a deploy.

**Poll gaps need no special case.** After days without a pass, the first one finds either a sync token that still works or a 410, and either way, because `ListedAt` is more than a day old, reads each calendar in full for a window around today. Until then screens show the old cache and "Synced through …", and health shows the calendars as stale.

## Alternatives considered

**Push instead of polling.** Google can call a webhook when a calendar changes (`events.watch`). It would bring edits made in Google's own apps to the wall in seconds rather than up to two minutes. It needs a public HTTPS address verified with Google for every family instance, channels that expire within a week or so and must be renewed, and a fallback poll anyway, because Google does not promise delivery and says to keep syncing. The notifications carry no events, so the sync-token read stays the same. For one family's calendar, two minutes is acceptable and polling with sync tokens costs one small request per calendar per pass. Push can be added later on top of the same sync, as a trigger for it.

**Live reads instead of a cache.** Reading Google on every screen load would make the cache question disappear, but a wall refreshes all day, every screen load would cost several Google requests, a Google outage would blank the wall instead of leaving it a few minutes behind, expanding long series on every read is slow, and paired displays must never see a private event's details, which is easier to enforce on rows the API already holds. Search is the one place that does read Google live, for times outside the window, and it says so when Google cannot be asked.

**A cache that is the record.** Keeping Wheelhouse-only fields in the database rather than in Google would avoid a few round trips but make the cache impossible to throw away, add a second place for edits to drift, and lose those fields if a family stops using Wheelhouse. Every such field so far has fitted in Google's own fields or a private extended property.

**Retrying harder inside a call.** Waiting longer inside one request would hide more rate limits, but a screen is waiting on saves, and the client gives up after 20 seconds. Short retries inside the call and longer waits between passes keep both bounded.

## Consequences

- An outage or a quota storm leaves every screen showing the last good cache, saying how far it is synced, and offering "Check save" for a save Google did not answer; nothing in the cache is lost or half-written.
- A quota refusal never changes a calendar's settings. Only Google saying the account has no access does, and that is the one case a parent has to fix.
- Recovery is the normal path: the next working pass catches up, so there is no repair job and nothing to replay.
- Events edited in Google can take up to two minutes to show, longer while a family is backing off. Edits made from the wall and phones show at once through their own saves.
- The fake in the tests (`FakeGoogle.Faults`) can fail any call the sync makes, and `GoogleFailureTests` and `GoogleRateLimitTests` cover each row of the table above. The live check (`LiveGoogleTests`) still runs only on demand.
