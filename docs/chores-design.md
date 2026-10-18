# One-time chores (4.1)

Implementation design for the first chores increment of [the household roadmap](household-roadmap.md).

## Screens and navigation

- Phone `/chores`: Today/Calendar/Chores bottom navigation; header with a parent-only Add chore button; previous/date/next/Today controls; live connection and resync; overdue work; one card per member plus Household; a collapsed Completed section. Parent editing uses a native modal dialog with title, notes, assignment, due date and an explicit archive confirmation.
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

Dates are household-local calendar dates, not browser-zone instants. A completed overdue chore is available on its original due date, which the date control can reopen. Recurrence, history browsing and Today summaries belong to later increments.

## Verification

API coverage exercises desired-state retries, concurrent creates, conflicting stale commands, authorization, cross-family IDs/assignment, removed members, demo dates/cleanup, transaction rollback, SignalR isolation, origin checks, revocation and the worker. Web coverage exercises projections, stale reads, range changes, uncertain saves, family reset and connection lifecycle. Browser checks use stubbed HTTP/WebSocket messages at both target sizes, including a two-page phone/wall workflow; these complement the real PostgreSQL/SignalR integration tests.
