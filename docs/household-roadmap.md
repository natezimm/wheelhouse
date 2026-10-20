# Chores, lists and meals roadmap

Created October 18, 2026. Roadmap agreed through PR #25. Status: 4.1 merged in [PR #26](https://github.com/natezimm/wheelhouse/pull/26); 4.2 merged in [PR #27](https://github.com/natezimm/wheelhouse/pull/27); 4.3 merged in [PR #29](https://github.com/natezimm/wheelhouse/pull/29); 5.1 merged in [PR #30](https://github.com/natezimm/wheelhouse/pull/30); 5.2 merged in [PR #31](https://github.com/natezimm/wheelhouse/pull/31); 6.1 merged in [PR #32](https://github.com/natezimm/wheelhouse/pull/32).

The 4.1–4.3 layout, states and API contracts are documented in [chores-design.md](chores-design.md). The 5.1 design is in [lists-design.md](lists-design.md), 5.2 in [grocery-design.md](grocery-design.md), and 6.1 in [meals-design.md](meals-design.md). An open PR does not mark an increment shipped.

This is a new plan requested after calendar live updates shipped in PR #24. The milestone numbers below are proposed continuations, not a recovered historical roadmap. Calendar Milestone 3 part 2 is complete. Nothing in this document is implemented merely because it is described here.

## Product direction

Make Wheelhouse useful for the family's daily work: see what needs doing, check it off, keep shared lists, and decide what to eat. The wall favors quick scanning and large touch controls; the phone supports entry, editing and planning. Existing member colors, typography and design tokens carry through all three features.

Build in this order: chores, lists, meals. Lists establish the grocery destination before meals generate ingredients. Each increment delivers a usable vertical slice with API, wall, phone, fictional demo data and appropriate tests. Do not accumulate several API-only PRs before showing a working feature.

Before implementing each first screen, document its layout and states in that feature's PR using the existing design system: normal, empty, loading, saving, failed and reconnecting. Review rendered wall and phone screens as part of that PR. These are new designs under this plan; no unseen external mockup is presumed to exist.

## Sequence

| Milestone | Increment | Reviewable result |
| --- | --- | --- |
| 4: Chores | 4.1 One-time chores | Parents create assigned chores; wall and phone complete and reopen them, with live updates. |
| | 4.2 Repeating chores | Daily, selected-weekday and weekly chores produce independent dated occurrences. |
| | 4.3 Daily overview | Today surfaces due chores; filters, history and overdue handling make daily use practical. |
| 5: Lists | 5.1 Shared checklists | Family creates named lists and adds, edits, checks and reopens items on both layouts. |
| | 5.2 Grocery workflow | A dedicated grocery list supports quantities, categories, ordering and clearing checked items. |
| 6: Meals | 6.1 Weekly meal plan | Family plans breakfast, lunch and dinner using free-text meals, with today's meals on Today. |
| | 6.2 Saved recipes | Parents save reusable recipes with ingredients, servings and instructions and place them on the plan. |
| | 6.3 Meals to groceries | Preview selected meals' ingredients and add them to the grocery list safely without duplicate retries. |

Each row is a target increment, not a promise that it fits one PR. If split, record the narrower scope and remaining work here. All rows start unimplemented; mark completion only with merged PR links.

## Shared behavior and engineering

- PostgreSQL is authoritative for chores, lists and meals. They do not sync to Google Calendar. Keep the existing calendar contract and recovery behavior working.
- Use feature folders and family-owned entities with the existing query filters. Every relationship must be validated within the authenticated family, including assignees, recipes and grocery destinations. Cross-family IDs must never disclose or mutate data.
- Parents manage chore definitions, assignment and recipes. Anyone authenticated to the family, including a paired wall, may complete/reopen chores, manage shared lists and plan meals. A wall is a household device, not a child's verified identity; show completion time, not an invented person who completed it. No child accounts or PINs in these milestones.
- Root Angular stores expose read-only signals. Keep confirmed data separate from pending operations. A definite failure restores only the refused operation and preserves drafts; an uncertain response offers reconciliation before retry. A family switch clears all feature state and ignores late responses.
- Deliver cross-device refresh with 4.1. Add an authenticated `/hubs/household` subscription for these three domains, reusing the calendar's family isolation, origin checks and access-revocation patterns. Keep `/hubs/calendar` intact initially. This deliberately allows two shared connections per browser rather than risking a calendar protocol migration in the first chores increment.
- Use durable per-family revisions for each new domain and publish only committed changes. Household notifications identify the changed domain and revision, without sending household contents. Each domain snapshot returns a matching revision; clients coalesce reads, ignore stale responses and recover on reconnect, visibility/online changes and a bounded fallback poll. Create only the chores implementation in 4.1; add lists and meals when their features ship, without building an unused generic framework first.
- Reuse connection and save-feedback presentation where appropriate, but keep domain recovery accurate. Household resync must refresh active household views and must not imply a Google import. Stop subscriptions on sign-out, access revocation and family changes.
- Commands set desired state (`completed: true/false`, `checked: true/false`), never blind toggle. Version mutable records; stale edits return a conflict with current state rather than overwriting another device. Create commands use family-scoped operation IDs; a retry returns the original result, while reusing a key with a different request is rejected. A repeated desired-state request that is already satisfied is a no-op.
- Use the family's time zone for dates and deadlines. Store local dates for all-day chores and meal slots, UTC instants for completion times, and never infer household dates from the browser's zone.
- Feature data participates in demo-copy seeding, expiry and family deletion. Demo content is fictional. No extra paid APIs, workers or hosting services are needed.
- Online writes only for this release. Keep readable confirmed data during a disconnect and explain failed/uncertain saves. Persistent offline write queues, notifications and new deployments are separate work.

## Milestone 4: Chores

### 4.1 One-time chores — merged in PR #26

Parents create, edit and archive a chore with a title, optional notes, an optional assigned member and a due date. An unassigned chore belongs to the household. The initial model is `Chore` plus versioned completion state; recurrence is introduced separately in 4.2.

Wall: a Chores view groups active chores by member and Household, with a date selector, overdue section and large complete/reopen controls. Phone: a Chores route lists the same work and provides a parent-only editor. Completed items remain available in a collapsed section so an accidental completion is easy to undo. Archiving removes a definition from active work while retaining its history.

Suggested API shape: `GET /api/chores?date=`, parent-only create/update/archive under `/api/chores`, and a family-authorized desired-state completion command. Responses include entity versions and the chores snapshot revision. Final endpoint names belong in the implementation PR.

Done when:

- A parent creates a chore on the phone and a paired wall receives it without a reload; completing it on the wall updates the phone.
- Definite failure rolls back the relevant pending change; a lost response can be checked/retried without duplicate creation or an inverted completion.
- Two-device stale edits surface a conflict. Removed assignees become Household chores without deleting their history.
- Unauthenticated users and other families cannot read or change the chore. A wall cannot create, reassign or archive definitions.
- Fictional seeds show assigned, household, completed and overdue examples. Both layouts have useful empty/error states and accessible controls.

### 4.2 Repeating chores

Add daily, selected-weekday and every-N-weeks schedules with a start date and optional end date. Keep an occurrence's identity stable as definition ID plus family-local due date; enforce uniqueness. A day's completion never completes the next occurrence. Materialize or project occurrences for a bounded requested range without a midnight scheduler.

Recurring changes apply to future dates, preserving earlier completions. A new schedule takes effect tomorrow in the family zone; today's occurrence stays stable. Archiving stops future work while preserving history. A removed member leaves future chores unassigned.

Missed recurring occurrences appear as missed history; the active view shows the current occurrence instead of an endless accumulated backlog. One-time overdue chores remain active until completed or archived. Monthly recurrence, automatic assignment rotation and dependencies are deferred.

Done when family-zone midnight and DST tests prove stable dates, repeated reads never duplicate occurrences, and completing or reopening a past date leaves other dates unchanged. Phone editing explains when schedule changes take effect.

### 4.3 Daily overview and history — merged in PR #29

Add a compact chores section to phone Today, showing due/completed counts and outstanding work. Add member/status filters and a bounded history view with completion dates. Wall Chores shows progress per member without rewards or leaderboards. Preserve chosen date and filters through recovery.

Done when the full daily loop works on both layouts: see due work, complete it, reopen a mistake, inspect yesterday, and return to today. Include timezone rollover, archived definitions and removed assignees in validation.

## Milestone 5: Lists

### 5.1 Shared checklists — merged in PR #30

Add `HouseholdList` and `ListItem`: name, item text, optional notes, checked state, explicit sort order and versions. Support named lists such as Errands, Packing and Household to-dos. Lists are shared across the family; personal/private lists and assignment are deferred.

Phone: choose a list, quick-add an item, edit, check/reopen, reorder and archive a list. Wall: choose a list and perform the same everyday actions with touch controls. Provide move-up/down actions so ordering does not require dragging. Checked items collapse below active items. Deleting an item requires an explicit action; archiving a list preserves its items.

Done when two devices can add different items concurrently without losing either, stale edits are handled, checking is idempotent, ordering remains deterministic, and reconnecting restores the accepted list without clearing a draft. Include isolation and demo-copy cleanup tests.

### 5.2 Grocery workflow — merged in PR #31

Seed one protected Grocery list per family and enforce its uniqueness; it cannot be archived. Add optional quantity and unit text and a small configurable category set, initially Produce, Dairy, Meat & fish, Pantry, Frozen and Other. Manual entry remains fast: item text alone is valid.

Group grocery items by category and support checking while shopping. Clear checked items requires a confirmation showing the count; the command targets the reviewed IDs/versions so an item another device reopened is not silently deleted. Manually entered similar items remain separate unless the user explicitly combines them.

Done when list ordering, category editing and clearing are safe under concurrent changes, and the grocery list remains usable without any meal or recipe data.

## Milestone 6: Meals

### 6.1 Weekly meal plan — merged in PR #32

Add a week view with breakfast, lunch and dinner slots for each family-local date. Each slot may hold one free-text meal with optional notes. Empty slots are normal; defaults can emphasize dinner without hiding other slots. Snacks are a later extension.

Phone: navigate weeks, edit/clear slots and copy a previous week after reviewing overwrite choices. Wall: show the same week and allow quick slot editing. Phone Today shows today's planned meals. Keep meals visually separate from Google events; do not create duplicate calendar events.

Done when both layouts agree on dates across time zones, concurrent edits to the same slot cannot overwrite silently, clearing is explicit, and copying a week preserves the original while handling occupied destination slots deliberately.

### 6.2 Saved recipes — merged in [PR #34](https://github.com/natezimm/wheelhouse/pull/34)

Add a household recipe library with title, default servings, ingredient lines, preparation steps, optional source URL and notes. Ingredients have a name, optional decimal quantity and optional unit; free-text quantities such as “to taste” are supported without pretending they can be scaled numerically. No scraper or external recipe API is required.

Parents create/edit/archive recipes on the phone. Everyone in the family may read them, choose them for a meal slot and set that slot's serving count. Wall offers recipe selection and a readable detail view. Existing planned slots keep their saved title and ingredient snapshot when a recipe changes or is archived; replacing/refreshed recipe content is explicit.

Done when recipes can be reused and scaled without changing the original, free-text ingredients survive intact, archived recipes remain understandable on past plans, and all recipe references are scoped to the family.

### 6.3 Generate groceries from meals — in implementation in [PR #35](https://github.com/natezimm/wheelhouse/pull/35)

From the phone, select days/meals and preview their ingredient snapshots at each slot's servings. Let the user deselect pantry items, edit quantities and choose whether to combine an ingredient with an existing unchecked grocery item. Free-text meals explain that ingredients must be entered manually. Wall continues to show the resulting shared grocery list.

Combine only exact normalized names with the same normalized unit and numeric quantities; keep other lines separate. Never convert units or infer equivalents. Preserve source meal/ingredient references for explanation. Adding groceries is a snapshot operation: later meal edits do not silently rewrite a shopping list already in use.

Submit the selected batch atomically with an operation ID. A retry must return the same batch. Reopening the same source meal snapshot shows which ingredients were already added, so a new request cannot silently double-add them; an intentional additional purchase requires an explicit action. Replacing a meal never removes previously purchased or checked items automatically.

Done when scaled totals are correct, incompatible units stay separate, reviewed merges detect concurrent edits, retries do not duplicate groceries, and changed meals prompt a new preview instead of silently changing shopping data.

## Validation and completion rules

Each implementation PR updates this roadmap with its merged link and remaining scope. Use unprefixed branch names and no generated co-author attribution. PRs remain unmerged for review.

- Run appropriate PostgreSQL integration tests for migrations, family isolation, role permissions, idempotency, concurrency, revision publication and demo lifecycle.
- Run focused web tests and the production build. Cover confirmed/pending separation, stale reads, family changes, errors and uncertain saves.
- Add browser coverage for the increment's primary wall/phone interaction, reconnect recovery and keyboard access. Verify wall at 1920 × 1080 and phone at 390 × 844, with minimum 56 px / 44 px touch targets and no horizontal overflow. Review screenshots; do not claim a real backend browser test if APIs are stubbed.
- Preserve existing calendar tests and behavior. New household revision or hub plumbing must not weaken calendar authorization, revocation or recovery.
- Update README and AGENTS when behavior actually ships. Planning text alone must not claim that a feature exists. A release/deployment is separate from merging implementation.

## Later possibilities

Rewards/points, allowances, chore rotation, child-specific sign-in, reminders, private lists, recipe imports, nutrition data, AI meal planning, pantry inventory, offline mutation queues and automatic unit conversion are outside these milestones. Add them only through a separate scoped decision after the core workflows work.

## Immediate next action

Complete **6.3: Generate groceries from meals**. Preview, batching, source tracking and screen states are in [meal-groceries-design.md](meal-groceries-design.md). This completes the currently agreed chores/lists/meals sequence; further features need a new scoped plan.

