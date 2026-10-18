# Chores (4.1 and 4.2)

Implementation design for the chores increments of [the household roadmap](household-roadmap.md). One-time chores shipped in PR #26; repeating chores extend the same screens and recovery contract.

## Screens and navigation

- Phone `/chores`: Today/Calendar/Chores bottom navigation; header with a parent-only Add chore button; previous/date/next/Today controls; live connection and resync; overdue work; cards for members/Household with due work; a collapsed Completed section. Empty member cards are omitted on the phone so active chores appear before empty space. Parent editing uses a native modal dialog with title, notes, assignment, due date and an explicit archive confirmation.
- Wall `/wall/chores`: a Chores link from the calendar footer and a Calendar return link; the same date controls and chore content in member columns, with 56 px targets. The wall completes/reopens work; definition management stays on the phone.
- Phone controls are at least 44 px. Use existing design tokens, member colors and derived layout styles. Keyboard users can reach every action; native dialog behavior contains focus and Escape cannot dismiss an actively saving command.

## States

| State | Screen behavior |
| --- | --- |
| Initial read | Loading chores; retry offered if it fails. |
| Empty date | Household/member cards explain there is no work; a parent can add a chore. |
| Saving | Immediate pending projection; affected chore and submitted editor are locked; unrelated chores remain usable. |
| Definite refusal | Remove only that pending operation, retain editor draft and explain the failure. |
| Conflict | Refresh authoritative chores and retain the draft. Reload chore explicitly replaces it with current values. |
| Uncertain write | Retain the exact command and show Check save. Read its target first, then retry the original key/version only if needed. Closing an uncertain editor retains a global recovery action. |
| Background read failure | Keep confirmed data and pending intent; expose Resync now. |
| Socket loss | Reconnecting; recover current date on reconnect/online/visible-tab resume and through a 30-second fallback. Date and editor draft remain intact. |
| Family/access change | Clear feature data and pending intent, ignore late callbacks and close the old editor/subscription. |

## Contracts

`Chore` stores family ID, immutable creation ID and normalized initial request, current title/notes/member/date, completion instant, archive state and concurrency version. A family has a separate durable `ChoresChangeNumber`. The snapshot also returns `canManage` from the authenticated parent's role: a signed-in device does not gain management controls by visiting the phone route. Deleting a member clears assignment through the database while preserving completion history; deleting a family cascades chores.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/chores?date=YYYY-MM-DD` | Family | Snapshot of the requested due date and earlier incomplete chores, with matching committed revision. |
| `GET /api/chores/{id}` | Family | Read current state, including an archived chore, for recovery. |
| `GET /api/chores/creation/{creationId}` | Family | Reconcile a lost create response. |
| `POST /api/chores` | Parent | Create with family-scoped creation ID; exact normalized retries return the existing row. |
| `PUT /api/chores/{id}` | Parent | Edit with expected version; conflicting stale edits return 409. |
| `PUT /api/chores/{id}/completion` | Family | Set completed true/false with expected version; an already-satisfied request is a no-op. |
| `PUT /api/chores/{id}/archive` | Parent | Archive with expected version; repeats are no-ops. |
| `/hubs/household` | Family | Server-only `HouseholdChanged({ domain: 'chores', changeNumber })` hints; never accepts a client-selected family. |

Writes serialize within a family transaction. Data changes and the chores revision commit together through the shared save boundary, including outer transactions and member deletion. Snapshot reads use repeatable read. The household publisher reads committed revisions, revalidates access and retries failed sends; calendar subscription behavior remains intact.

Dates are household-local calendar dates, not browser-zone instants. A completed overdue chore is available on its original due date, which the date control can reopen. A dedicated history browser and Today summaries belong to 4.3.

## Repeating chores (4.2)

The parent editor adds Repeat (Does not repeat / Every day / Selected weekdays and weeks), a schedule start, every-N-weeks interval (1–52), weekday checkboxes and an optional inclusive end date. A new schedule uses its chosen start. Existing repeating definitions change from tomorrow in the family's zone; the editor explains that today and earlier dates retain their saved schedule. One-time chores remain one-time after creation; a parent creates a separate definition to switch kinds.

Both layouts show a readable repeat rule, future-change/stop dates and a Missed label on incomplete past occurrences. Only the chosen date's repeats appear; missed daily chores never accumulate in today's overdue section. Date navigation can complete/reopen a past occurrence independently. Future repeating occurrences are readable but cannot be completed early, so future schedule edits cannot invalidate completed future work. One-time chores retain their existing behavior.

`ChorePlan` stores dated versions of title, notes, assignee, start/end and recurrence rule. The latest plan effective on the requested date wins. Weekly intervals anchor to the Monday of the start date's week; days before the start are excluded. The family's calendar display preference does not change that anchor. Re-editing on the same day replaces only tomorrow's pending plan and supersedes later future plans; earlier plans stay intact. Archiving stops repeats tomorrow, leaving earlier occurrences readable and reopenable. Removing an assignee moves work to Household while retaining completion timestamps.

`ChoreCompletion` has the unique key `(ChoreId, DueDate)`, its own version and an optional completion instant. Reads project one bounded requested day, without creating rows or using a midnight job. An occurrence's identity is definition ID plus family-local due date. An untouched occurrence's version derives from its plan and date. Definition edits/archives use `definitionVersion`; completion never changes another day's version or the definition's edit version.

Existing chore endpoints accept optional `?date=YYYY-MM-DD` to return the occurrence being viewed; repeating completion requires an explicit date. Create/edit add `repeat: { frequency: 'Daily' | 'Weekly', intervalWeeks, weekdays: [0..6], endsOn }`, with `dueDate` meaning schedule start. Responses add `repeat`, `occurrenceId`, `definitionVersion`, latest `editDraft`, `visible`, `missed`, `seriesArchived`, `nextChangeDate` and `stopsOn`. Recovery reads may return `visible: false` when the definition exists but is not due that day; snapshots omit it. Original one-time request bodies and creation fingerprints stay compatible.

Pending completion locks and recovery identify the original date after navigation. Schedule operations lock the definition and preserve today's content. A stale edit retains the server conflict response so Reload chore can recover a definition even if the formerly viewed future occurrence disappeared. Plans and completions share the existing committed chores revision and household connection; there is no new hub or scheduler.

Fictional seeds include daily brushing, selected-weekday lunch bags and fortnightly dog blankets. Tests cover both DST transitions and family midnight, independent completions, inclusive ends, weekly anchors, reads without writes, future edits/archives, retries, conflicts, removed members and family scoping. Browser fixtures stub projections; PostgreSQL integration tests separately verify server behavior.

## Verification

API coverage exercises desired-state retries, concurrent creates, conflicting stale commands, authorization, cross-family IDs/assignment, removed members, demo dates/cleanup, transaction rollback, SignalR isolation, origin checks, revocation and the worker. Web coverage exercises projections, stale reads, range changes, uncertain saves, family reset and connection lifecycle. Browser checks use stubbed HTTP/WebSocket messages at both target sizes, including a two-page phone/wall workflow; these complement the real PostgreSQL/SignalR integration tests.
