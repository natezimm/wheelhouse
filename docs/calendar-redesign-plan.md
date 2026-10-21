# Wheelhouse calendar redesign plan

Created October 21, 2026. Status: proposed implementation plan; no redesign is implemented by this document. Repository baseline: `8f1d7f0bb9bc7a86ba0c51c65eb716d879273d96`.

## Product decision

Wheelhouse becomes a calendar-first application. Its desktop and wall experience takes its visual direction from the supplied Skylight reference: a compact header, narrow navigation, member colors, a white calendar surface, subtle rules and pastel event blocks positioned on a shared time grid. Keep Wheelhouse's own name and visual identity.

The reference's hourly layout is called Schedule in Skylight. Wheelhouse will call its seven-day hourly layout **Week**. The initial view choices are **Day, Week and Month**; a separate Schedule choice would duplicate Week's purpose at this stage.

Desktop and wall default to Week. A phone defaults to a compact Day agenda. Remember the user's last selected view on that device, separately for phone, desktop and explicit wall contexts. Chores, shared lists/to-dos, groceries, meals, recipes and meal-to-grocery workflows are future features, outside the active calendar experience.

Build and review the plan in order. Approval of this document authorizes planning; the first deliverable is a populated visual design for review before UI implementation begins.

## Current evidence and constraints

- [`phone/calendar.ts`](../web/src/app/phone/calendar.ts) is a compact month date picker followed by a selected-day agenda. Stretching it to desktop width creates large empty spaces and excessively wide agenda rows.
- [`wall/week-view.ts`](../web/src/app/wall/week-view.ts) currently stacks events inside seven independent day columns. It is not an hourly time grid; CSS restyling alone will not produce the target layout.
- [`wall/day-view.ts`](../web/src/app/wall/day-view.ts), [`wall/month-view.ts`](../web/src/app/wall/month-view.ts) and the existing calendar navigation/editor components contain reusable behavior. Audit them before deciding which presentation components to replace.
- [`app.routes.ts`](../web/src/app/app.routes.ts), phone Today, navigation and wall chrome still expose household features at this baseline. Coordinate with any separate calendar-first retirement work instead of duplicating or reverting it.
- [`wall/wall-shell.ts`](../web/src/app/wall/wall-shell.ts) has a two-minute return-to-this-week behavior. That conflicts with remembering a user's chosen Day/Month view and must be revised deliberately.
- [`deploy/smoke.mjs`](../deploy/smoke.mjs) currently expects household navigation, including Meals. Scope retirement must update the smoke script and its fixtures in the same PR or a valid calendar-only release will fail.
- Preserve the Angular stores, Google Calendar integration, family isolation, pairing, optimistic saves, conflict handling and live recovery. This is primarily a presentation/navigation change, not a replacement calendar backend.
- Use the family's time zone and configured week start everywhere. Wall targets remain at least 56 px; phone controls remain at least 44 px. No new paid service or hosting component is required.

## Target experience

### Desktop and wall

The calendar occupies the available viewport height. At 1920 × 1080, the header and controls should normally fit in approximately 150 px above the grid, with no permanent status/footer bar competing with the calendar. Treat this as a visual acceptance target, not a fixed height that clips text or accessibility zoom.

The compact header contains the family name, local date/time and optional weather. The calendar toolbar contains Today, previous/next, a readable date range, Day/Week/Month and Add event. Member filters appear as a compact adjacent row or group. Connection health occupies a small quiet indicator; reconnection and failed-refresh actions expand only when needed.

Desktop navigation contains Calendar and Settings. Phone navigation is similarly calendar-focused, with a clear Settings entry and no household tabs. The explicit wall route uses minimal kiosk chrome. A paired wall's settings access is limited to permitted display/pairing controls; Google connection and family administration retain their existing parent-only authorization.

Use a neutral outer surface, white grid, fine separators and member-colored pastel event fills with dark readable text. Member color must remain consistent across filters, events and details. Color is supplemented with names/initials. Avoid oversized pills, a giant month heading or a floating action button that covers events on a wide screen.

### Week: primary desktop/wall view

- Show seven aligned day columns, a shared hourly gutter and one coordinated vertical scroll area. Keep day headings and time labels aligned while scrolling.
- Position timed events by local start/end time. Preserve duration information, show the event title and readable time, and expose owner/calendar and location in details.
- Put all-day events in a separate row above the timed grid. All-day ranges use the existing exclusive end-date semantics. Multi-day events must remain reachable when the row overflows; show an explicit expansion control rather than hiding events.
- Lay out overlaps side by side within a collision group, with stable ordering. Adjacent events should not falsely collide. Handle dense clusters and short events without silently obscuring another event; provide a readable day agenda/overflow interaction with full-size touch targets. Any minimum visual card size must not change the saved event duration.
- Split overnight timed events into the visible local-day segments while preserving one event identity for editing. Clip at the visible range and distinguish continuation across a boundary.
- Highlight today and draw a current-time indicator only on the corresponding day. Derive both from the household clock, not the browser's local zone.
- On initial entry/Today, reveal the current or relevant daytime hours. Keep earlier/later hours accessible. Background refreshes and live notifications must not repeatedly jump the scroll position.
- A new timed event can start from Add event or an explicit empty-slot action. Choosing an empty slot pre-fills its date/time. Keyboard and touch users have a clear equivalent action.

### Day

Desktop/wall Day uses the same time-grid rules with more space for event details and overlapping events. Phone Day is a compact chronological agenda with an all-day section, date navigation, member filters and Add event. It must be comfortable at 390 px and readable at 320 px.

Today means the household's current day. It changes the focus date without changing the selected view. A valid empty day has an intentional empty message; loading/failure must never be presented as "No events."

### Month

Desktop/wall Month fills the available calendar area with clearly separated day cells and pastel event summaries containing titles and useful times. Use five or six rows as required by the actual month; respect the family's week start. Overflow shows a count and opens the selected day's agenda; it never silently drops events.

Phone Month remains a compact date selector plus a width-constrained selected-day agenda. Selecting a day preserves the chosen month view. An explicit Day action can open that day's fuller view. No desktop screen should render only an enlarged field of date numbers and dots.

### Responsive behavior and preferences

| Context | Initial view | Main layout | Navigation |
| --- | --- | --- | --- |
| Phone, below 768 px | Day agenda | Single column; compact Month; explicit Week remains usable with labeled horizontal day scrolling if needed | Calendar controls and Settings; no household tabs |
| Tablet, 768–1199 px | Week | Compact toolbar; seven days where readable; reduce chrome before shrinking event text | Compact calendar navigation |
| Desktop, 1200 px and above | Week | Full seven-day time grid; event-detail panel when room permits | Narrow Calendar/Settings rail |
| Explicit `/wall` route | Week | Kiosk presentation with large touch controls and the same grid engine | Minimal wall-safe controls |

Persist only presentation preferences, such as view enum, using validated/versioned local storage. Do not persist event contents, drafts, authentication or stale date ranges as part of view memory. Missing, corrupt or unavailable storage falls back safely.

Changing viewport size must preserve an open draft, selected date, filters and pending operations. Restore the preference for the destination context without causing routing loops or duplicate active calendar reads. Phone defaults and explicit user choices must remain usable in landscape. Family changes reset drafts and member filters as they do today; presentation preferences must not leak family data.

The wall's idle return may move an inactive display to the current day/week range within its selected view. It must not force Month/Day back to Week, interrupt an editor or discard a pending save. The visual-design milestone will specify the idle behavior before implementation.

## Existing calendar behavior that must survive

- Add, edit and delete; all-day/timed events; recurring occurrence versus whole-series choices; read-only source calendars.
- Distinct event-detail and edit actions. Desktop uses a side panel when space allows; phones use a sheet/dialog. Pairing and permissions continue to govern which actions are available.
- Optimistic previews, disabled duplicate saves, clear save state, uncertain-response reconciliation and stale-edit conflicts. A layout switch must not silently lose a draft or issue a duplicate mutation.
- Live updates and Resync now preserve date, view, filters, scroll and drafts. Google reauthorization remains a separate message with an appropriate parent Settings link.
- Initial loading, valid empty, failed initial load, stale-but-readable data, disconnected, saving, uncertain, conflict, denied access and expired demo states receive explicit presentations.
- Daylight-saving gaps/overlaps, month/year boundaries and household midnight are supported. During a repeated clock hour, the grid/detail representation must distinguish actual instants; during a missing hour it must not invent an editable valid time. Do not use browser-zone `Date` arithmetic to position household events.
- Quiet weather failure does not block the calendar. Keyboard focus, visible focus styles, accessible event names, appropriate contrast and browser zoom remain usable.

## Implementation sequence

Each milestone is a reviewable result. Keep implementation PRs small enough to review, and include populated phone and wall/desktop evidence. Do not deploy an unfinished visual shell merely because its functional tests pass.

### 0. Visual design and acceptance baseline

Create one focused design direction from the supplied reference, using fictional seeded events: desktop/wall Week first, then the phone Day agenda and desktop Month. Show populated, busy/overlapping and failure states. Establish typography, spacing, event colors, header/rail proportions and event-detail behavior.

Review at 1920 × 1080, 1440 × 900, 1024 × 768, 390 × 844 and 320 × 568. Check a 15-inch landscape display or equivalent physical-size simulation; pixel dimensions alone do not establish at-a-distance readability. Include an agreed idle-return rule.

**Done when:** the user has reviewed the populated Week direction and the companion phone/Month layouts. Record the approved reference and any changes in the implementation PR. No new calendar UI code is required in this milestone.

### 1. Calendar-first scope, entry points and shell

Complete or verify retirement of household features from active routes, navigation, Today sections, seeds and active client subscriptions. Coordinate with existing retirement work. Preserve existing stored household data and migration history; destructive schema/data removal requires its own reviewed decision. Keep the household design documents as future-feature references and update their roadmap status without erasing history.

Make `/` and `/calendar` consistent calendar entry points for desktop and phone; retain `/wall` for explicit kiosk use. Introduce the agreed compact chrome and shared view/focus ownership, keeping existing functional calendar rendering until the replacement is ready. Add device-context view persistence and revise idle return. Update README and repository guidance for the calendar-first direction.

Update release smoke checks and their fixture tests to expect Calendar/Settings, calendar data and rendered events rather than household tabs. Do not remove calendar write/recovery coverage while retiring unrelated tests.

**Done when:** first desktop/wall entry selects Week, first phone entry selects Day, remembered choices survive reload, direct links work, sign-in/pairing still work, and the active UI exposes no household sections. The calendar-first smoke contract passes.

### 2. Shared time-grid engine and polished Week

Build a pure, testable projection of calendar events into household-local day segments, overlap groups and positions. Reuse the existing date helpers and stores. Make the shared Week grid match the approved design, including all-day layout, short/dense events, today/current-time markers and stable scrolling.

Connect event details/editing and Add event to the existing write flows in the same vertical slice. Keep navigation and presentation outside the backend cache/write logic. Avoid adding a second independent CalendarStore or concurrent range owners for the same screen.

**Done when:** the populated seven-day grid is visually approved at wall and desktop sizes; overlaps, overnight and all-day events render correctly; event writes and recovery remain functional; no event is available only through an inaccessible tiny target.

### 3. Day, Month and phone calendar completion

Reuse the grid engine for desktop/wall Day. Complete the phone Day agenda, compact Month and readable explicit Week behavior. Replace desktop Month's date-picker appearance with the approved full month grid and explicit overflow handling.

**Done when:** switching Day/Week/Month preserves the intended focus date and filters; Today works consistently; all months fit correctly; phone screens avoid horizontal page overflow and stretched desktop layouts; phone/wall event details and edits remain available.

### 4. Recovery, accessibility and visual hardening

Exercise the complete screen through reconnects, failed reads, uncertain writes, conflicts, route/viewport changes and household midnight. Correct misleading empty states and ensure quiet connection controls expand when action is necessary. Verify keyboard access, touch sizes, contrast, zoom, text wrapping and long titles.

**Done when:** the state matrix below passes and reviewed screenshots show no clipped controls, obscured events, accidental empty states or draft loss. Fix relevant failures rather than weakening assertions or adding blanket retries.

### 5. Release validation and calendar-first launch

Run the required CI checks. Review actual rendered desktop/wall and phone screenshots in addition to test results. Create a versioned release only after the redesign is merged and ready; retain the existing backup, restoration, disk-space and retention protections.

Post-deploy: test a fresh fictional demo visit, actual event rendering on Week and Month, view memory, a calendar mutation and reload, and reconnect recovery. Verify the private instance's signed-out screen separately; an authorized parent manually verifies real Google sign-in/calendar access. Check public HTTPS URLs as well as SSH-loopback smoke checks.

**Done when:** the live demo visibly matches the approved direction, the deployed version is verified, calendar data and interactions work, and there are no active household navigation entries. Merging a PR alone does not mean this milestone is complete.

## Validation matrix

| Area | Evidence required |
| --- | --- |
| Layout projection | Unit cases for overlap chains, touching boundaries, short events, overnight splits, all-day exclusive ends, range clipping and stable ordering |
| Dates and time | Household zone differs from browser zone; Sunday/Monday week starts; DST forward/back; midnight; month/year transitions |
| View preferences | New device defaults, stored view, invalid/unavailable storage, phone/desktop context changes, idle return and family reset |
| Editing/recovery | Add/edit/delete; occurrence/series; read-only calendars; optimistic state; lost response; conflict; reconnect/resync with an open draft |
| Responsive visuals | Reviewed screenshots at the five target sizes; busy and empty calendars; long titles; overflow; zoom; accessible touch/keyboard actions |
| State accuracy | Loading/failure never claims no events; stale data remains distinguishable; disconnected and Google reauthorization actions stay separate |
| Release | Updated real-browser smoke and fixtures; fresh demo data shown; private access remains denied anonymously; public URLs and deployed version checked |

Use the repository's current commands: `npm run build`, `npm test -- --watch=false`, `npm run test:e2e`, and `dotnet test` when API changes are made or required by CI. API tests need Docker and real Testcontainers PostgreSQL. Unit tests alone are insufficient proof of the visual result.

## Definition of done and deferred work

The redesign is complete when a fresh desktop/wall visit opens the approved seven-day hourly calendar, a fresh phone opens a compact agenda, Day/Week/Month are coherent, view choices are remembered, and real calendar workflows/recovery work at the reviewed sizes. The calendar must look complete with data, not merely pass a server health check.

Future work remains in the household roadmap: chores, lists/to-dos, grocery categories, meal planning, recipes and meal-to-grocery generation. Also defer drag-and-drop/resizing, extra calendar view modes, offline mutation queues, child accounts and unrelated integrations unless separately agreed. These are not prerequisites for a polished calendar-first release.

## Progress record

| Milestone | Status | Evidence |
| --- | --- | --- |
| 0. Visual direction | Planned | Awaiting populated designs and user review |
| 1. Calendar-first shell | Planned | No implementation PR yet; reconcile separate retirement work first |
| 2. Week time grid | Planned | No implementation PR yet |
| 3. Other views and phone | Planned | No implementation PR yet |
| 4. Hardening | Planned | No implementation PR yet |
| 5. Live release | Planned | No release under this plan yet |

Update this record with merged PR links and visual/test evidence after each milestone. An open PR or a successful build does not mark a milestone complete.
