# Wheelhouse calendar redesign plan

Created October 21, 2026; reviewed against the code and given a visual direction on October 22, 2026. Status: milestone 0 (visual direction) has mockups awaiting review; no redesign is implemented yet. Repository baseline: `18e4afb` (after the calendar-only cleanup in PR #39).

## Product decision

Wheelhouse is a calendar-first application. Its wall and desktop experience takes its visual direction from Skylight: a compact header, a white calendar surface with fine rules, member colors everywhere, and pastel event blocks positioned on a shared time grid. Skylight is inspiration, not a specification; Wheelhouse keeps its own name, fonts and warm neutral ground.

The initial view choices are **Day, Week and Month**. The wall and desktop default to Week. A phone defaults to a Day agenda, which also replaces the separate phone Today screen. Remember the user's last selected view on that device, separately for phone, desktop and wall contexts. Chores, shared lists/to-dos, groceries, meals and recipes stay out of the calendar experience (see [calendar-only scope](calendar-only-scope.md)).

**Aesthetics are the priority of this redesign.** Functional behavior that exists today must keep working, but a milestone is not done until its screens look like the approved mockups with real data at the reviewed sizes.

## Approved reference

The visual direction is the **Wheelhouse calendar redesign** design canvas: https://claude.ai/artifact/QLSDD2oc1RkfxGNLgaEmTE. It is private to the owner; implementers ask for access or screenshots. It holds:

| Board | What it fixes |
| --- | --- |
| Wall · Week (default) | Header, toolbar, member filter, Week grid, all-day lanes, overlaps, now line. Its Tweaks switch the connection states and open an event's details. |
| Wall · Week, event details open | The details drawer, including the read-only variant. |
| Wall · Day | A column per person on the same hour grid. |
| Wall · Month | Full-height month with spanning bars, timed lines and "+N more". |
| Desktop browser · Week | `/` on a laptop: narrow rail, compact toolbar, scrolling grid. |
| Wall · Week, reconnecting | Reconnecting, refresh-failed and Google-reconnect pills. |
| Phone · Day, Week, Month, details, states | The phone agenda, week agenda, compact month, details sheet, empty day and failed refresh. |
| Theme · Retro, Classic, Bold | The wall Week in the Groovy, Crisp and Bold themes (see Themes). |

Where this document and the canvas disagree about appearance, the canvas wins; where they disagree about behavior, this document wins. Record any change agreed during implementation here and on the canvas.

## Current code, reviewed October 22

- The calendar-only cleanup (PR #39) is done: routes, navigation, smoke checks and demo seeds no longer expose household features. Milestone 1 no longer needs to retire them; it only verifies that nothing returns.
- [`wall/week-view.ts`](../web/src/app/wall/week-view.ts) stacks event cards inside seven independent day columns with no hour grid. It must be replaced, not restyled.
- [`wall/day-view.ts`](../web/src/app/wall/day-view.ts) already draws an hour grid with a column per person, all-day events on top, side-by-side overlaps and a now line, and grows its hour range to fit early or late events. Its positioning code is the starting point for the shared grid engine.
- [`wall/month-view.ts`](../web/src/app/wall/month-view.ts) shows up to three titles per day with dots and "+N more", but no times and no bars for multi-day events.
- [`wall/wall-shell.ts`](../web/src/app/wall/wall-shell.ts) spends about 150 px on a 52 px date heading and a footer that holds status, demo pairing and Add event. Its idle timer resets to Week after two minutes and discards an open editor (`editing.set(null)`), which this plan forbids.
- Tapping an event opens the editor directly on both layouts. There is no read-only details view, so read-only events (the school district calendar) are disabled buttons that cannot be inspected.
- The phone has two tabs: Today ([`phone/phone-shell.ts`](../web/src/app/phone/phone-shell.ts) with [`today-events.ts`](../web/src/app/phone/today-events.ts)) and Calendar ([`phone/calendar.ts`](../web/src/app/phone/calendar.ts), a month picker with a dot per person and the chosen day's agenda). There is no desktop layout: a laptop browser gets the phone layout stretched across the screen.
- The wall has no settings by design ([AGENTS.md](../AGENTS.md)). That stays: this plan does not add settings, even display-only ones, to the wall.
- Member colors are saturated (`MEMBER_COLORS`, demo seeds use similar shades). White initials on the brighter ones, such as amber, fall below 4.5:1. The redesign derives a darker shade for avatars and time labels instead of changing stored colors.
- `Family.nightModeFrom/To` are settable but nothing uses them yet. The Night theme (see Themes) will; dimming the wall to a clock stays outside this redesign.
- [`deploy/smoke.mjs`](../deploy/smoke.mjs) expects a "Today" heading, a two-link Sections nav and `/calendar` rendering `app-phone-calendar .month`. Milestone 1 must update it with the new phone entry and navigation.
- Preserve the Angular stores, Google Calendar integration, family isolation, pairing, optimistic saves, conflict handling and live recovery. This is a presentation and navigation change, not a new calendar backend. No API change is expected for the redesign itself; the one candidate (repeat rule and notes in details) is deferred, see Event details.

## Visual system

Add these as design tokens in [`styles.css`](../web/src/styles.css) next to the existing ones, and use them instead of raw values. Values come from the canvas.

- **Surfaces.** Ground `#F4F2EE`; calendar surface white, 28 px radius on the wall (22 px desktop, 20 px phone cards) with a faint shadow; rules `#ECE9E3` between days and `#EFECE7` for hour lines; today's column and header tinted `#FBFAF7`.
- **Text.** Ink `#1F2328`; secondary `#5F646B`; hour labels and day names `#6B7077` (at least 4.5:1 on white). Outfit for the clock, headings and date numbers; Figtree for everything else.
- **Member color.** For a member color `c`: event fill `color-mix(c 17%, white)` with a 1 px inset ring at 26%; filter chips at 15%; avatars, time labels and dots use `color-mix(c 72%, black)` so white initials and small text pass contrast. Event titles are always ink. Every event shows its owner's initial or name as well as color. The whole-family calendar uses the existing `FAMILY_COLOR`.
- **Accents.** The primary action (Add event, Edit event) and the selected day number are ink-filled. The now line and its time label are coral `#E5484D`. Live is a small green dot (`#1F9D6B`). Problems are pills: amber for reconnecting, red for a failed refresh, neutral for Google needing reconnection.
- **Controls.** The view switch is a segmented control on a `#E8E5DF` track with a raised white selected segment, not an ink pill. Wall controls are at least 56 px; desktop 44 px; phone 44 px.

These values are the **Daylight** theme. Write every color, font, radius, border and shadow above as a token from the start, so the other themes below only swap values.

## Themes

The family can choose one of four looks, and a fifth turns on at night. All themes share the same layouts, sizes, behavior and touch targets; only tokens change. Themes are named for how they feel, never for the product that inspired them.

| Theme | Look | Canvas board | Tokens it sets |
| --- | --- | --- | --- |
| **Daylight** (default) | Soft and airy: warm off-white ground, white card, pastel events with a fine ring | Wall · Week (default) | As in Visual system |
| **Groovy** | Warm 70s paper: cream ground, ink outlines, hard offset shadows, three-stripe band under the header | Theme · Retro | Ground `#F3E7D3`, card `#FFF8EC`, ink `#2B1D14`, accents orange `#D9622B`, mustard `#E3A72F`, teal `#2F7F7A`; Fraunces display and DM Sans body; events are a 38% member fill with a 2 px ink border and 3 px offset shadow |
| **Crisp** | Clean office calendar: white page, a calendar list with checkboxes on the side, solid event blocks with white text | Theme · Classic | White ground, rules `#DADCE0`, text `#3C4043`, today blue `#1A73E8`, now line `#EA4335`; Roboto and Roboto Flex; events are the member color darkened 16% with white text and 6 px corners |
| **Bold** | Brutalist, from the author's Sudoku app: black outlines, yellow highlights, mono times | Theme · Bold | Ground `#EFEFE6`, white card, ink `#000000`, yellow `#FFDB3B`, lime `#C2FF66`, mint `#3BFF9D`; Space Grotesk and IBM Plex Mono; 2 px black borders, 4 to 6 px corners, 3 px event and 8 px card offset shadows |
| **Night** (automatic) | Dark version of the chosen theme's layout, low glare for a dark room | To be drawn before milestone 5 | Dark ground and card, dimmed member fills, the same accents at lower brightness |

- **Choosing.** The theme is a family setting, so the wall and every phone match. A parent picks it in Settings with a live preview card per theme. This needs a `Theme` column on `Family` (migration) and the field in the family settings API; default Daylight. Each device also follows the family setting without a reload when it changes, through the existing family refresh.
- **Night.** Between `nightModeFrom` and `nightModeTo` (already family settings) every device switches to Night, on the family clock, and back in the morning. A family setting turns automatic Night off. Dimming the wall to a clock remains separate, deferred work.
- **Mechanics.** `<html data-theme="daylight|groovy|crisp|bold">` plus `data-night` selects token sets in `styles.css`. Components never use raw colors, fonts or shadows. Load only the active theme's fonts. Member colors stay recognizable in every theme: a theme may change how a color is rendered (pastel, flat, solid) but never the hue.
- **Accessibility.** Every theme meets the same contrast rules for text, initials and time labels on its event fills, verified per theme and member color. `prefers-reduced-motion` and focus outlines work in every theme.

## Target experience

### Wall (`/wall`, 1920 × 1080)

The calendar fills the screen with no footer. From the top:

1. **Header, about 72 px:** the time large (64 px Outfit) with the weekday, date and family name beside it; the member filter chips centered; weather on the right. On the demo, "Pair with a phone" and the demo notice sit as a quiet pill at the right of the header.
2. **Toolbar, 56 px:** Today, previous/next, the range ("October 19 – 25 2026"), the connection indicator in the middle, then Day/Week/Month and Add event. Save feedback (the existing `CalendarSaveStatus`) appears as a toast over the bottom of the grid, not a footer.
3. **Calendar card:** fills the rest, about 870 px.

Connection: a small "Live" dot when the subscription is up. Reconnecting, a failed refresh and Google needing reconnection each replace it with a pill that says what is shown ("showing 4:32 PM") and, where useful, one action (Resync now, Try again), 56 px tall on the wall like every wall control. Google reconnection on the wall says a parent can fix it from Settings on their phone; it has no link because the wall has no settings. The server-health line is only a fallback before the live subscription exists, shown in the same slot.

### Week: the default wall and desktop view

- Seven aligned day columns and a shared hour gutter. Day headings read "THU 22", with today's number in an ink circle and today's column faintly tinted.
- **Hour range.** The wall shows the family's waking hours without scrolling: 7 AM–9 PM by default (about 50 px an hour), extended to cover the earliest start and latest end of the visible week's timed events. If that makes hours shorter than 36 px, the wall scrolls instead, opening at the current hour. Desktop always scrolls at 48 px an hour and opens about an hour before now (or the first event on another week). Background refreshes and live updates never move the scroll position.
- **All-day lane** above the grid: multi-day events are one bar spanning their days, using the existing exclusive end dates. Show up to two lanes; beyond that a "+N" control in the lane opens the day's details rather than hiding events.
- **Timed events** are positioned by local start and end and keep their real duration. A block shows its start time, owner initial and title (up to as many lines as fit). Blocks under 44 px tall show one line: start time and title. Overlaps sit side by side within their collision group with stable ordering; adjacent events do not count as overlapping. More than three side-by-side columns collapse the extras into a "+N" block that opens the Day view for that day.
- **Touch.** A block's visual size never changes its saved duration. On the wall, a block shorter than 56 px still gets a 56 px hit area where it has free space below it; inside a dense cluster, any tap opens details for the event under the finger, from which the others are reachable.
- Overnight timed events are split into per-day segments with one identity for editing, clipped at the visible range.
- The now line, coral with a dot and a time label in the gutter, appears only on today's column, from the family clock.
- Tapping empty grid space starts a new event at that half hour; Add event starts one at the next half hour on the focused day. Keyboard users reach the same action from Add event.

### Event details

Tapping an event opens **details first**, then Edit opens the existing editor (`EventDialog` on the wall, `EventSheet` on the phone). Details show the owner, a tinted block with the day, title and time, then location, whether it repeats, and the calendar name, then Edit event and Delete. The cache and API carry a `recurring` flag but not the repeat rule or Google's description, so the details say "Repeats" rather than "Every 6 weeks" and show no notes. Showing the rule and notes needs `EventInstance`, sync, `EventResponse` and tests to carry them, and is deferred until after the redesign; the canvas's "Every 6 weeks" and notes rows show that later state. A read-only event shows the same details with a note that its calendar can be shown but not changed, so read-only events are no longer dead buttons. On the wall and desktop, details are a drawer from the right (560 px wall, about 420 px desktop) over a light scrim; on the phone, a bottom sheet. A pending event's details show its save state and disable Edit and Delete, as the editors do now.

### Day

- **Wall and desktop:** a column per person (members, then Family), each headed by avatar, name and how many events they have that day, on the same hour grid and all-day rules as Week. This is the current Day view's structure, restyled. A person whose filter chip is off has no column.
- **Phone:** the default screen, described below.

Today changes the focus date without changing the view. A valid empty day says so plainly ("Nothing planned for Tuesday"); a loading or failed first load is never shown as an empty day.

### Month

- **Wall and desktop:** the month fills the card in five or six rows as the month needs, starting on the family's week start. Multi-day and all-day events are tinted bars spanning their days. Timed events are one line each: owner dot, short time ("3:30p"), title. A cell shows what fits (about four lines at 1080 px) and then "+N more". Tapping a day or "+N more" opens that day in Day view. Today's number is in an ink circle and its cell is tinted.
- **Phone:** a compact month card (a dot per busy person per day, up to three) above the selected day's agenda, with "Open day" to switch to Day. Selecting a day keeps the Month view.

### Phone (`/`, 390 px wide, readable at 320 px)

- `/` opens the calendar in the remembered view, Day by default. `/calendar` keeps working as an alias for the same screen. The Today tab and `PhoneShell`'s Today content are retired into Day: weather moves into the Day header's subtitle and "up next" is the now line.
- Bottom navigation has two tabs: Calendar and Settings. Add event is a 44 px ink button in the header, not a floating button.
- **Day:** header ("Today" or the date, with the weekday, date and weather above it), previous/next and Add; the Day/Week/Month switch; a week strip of seven days with the focused day ink-filled and a dot on busy days; the member chips in one scrolling row; then the agenda: all-day events, then timed events in order with start and end on the left and a tinted card with title, owner and location. On today, events that ended before the last hour collapse behind "N earlier events", and a coral now line sits between past and upcoming events.
- **Week:** a vertical agenda of the week grouped by day in white cards, today outlined, rather than a squeezed seven-column grid. It opens scrolled to yesterday so today is in view.
- **Month:** as above.
- Failed refreshes show a red banner with Try again above the view switch; reconnecting shows an amber one with Resync now; both keep the last good data on screen.

### Desktop browser (`/`, 768 px and wider)

The same calendar screen as the phone route, laid out for a wide window: a 76 px left rail (Wheelhouse mark, Calendar, Settings) replaces the bottom tabs; the toolbar puts Today, arrows, range and the Live dot on the left, and member avatars, weather, the view switch and Add event on the right. The Week grid scrolls as described above. Week is the default from 768 px; Day from below it. The layout changes with the window width, without a route change, and keeps the selected date, filters, open details or draft and pending operations. The view also stays as it is when the window crosses 768 px during a visit, so resizing never swaps the screen out from under someone; the new context's remembered view applies only on the next load. A view chosen after crossing is saved for the context the window is now in.

### Preferences and idle return

| Context | Chosen by | Default view |
| --- | --- | --- |
| Phone | `/` below 768 px wide | Day |
| Desktop | `/` at 768 px and wider | Week |
| Wall | `/wall` | Week |

Store only the view, per context, in `localStorage` under a versioned key (for example `wheelhouse.calendar.view.v1` holding `{ phone, desktop, wall }`), validated on read. Missing, corrupt or unavailable storage falls back to the default. Never store event data, drafts, dates or anything family-specific. A family switch still resets filters and drafts as today.

**Wall idle return.** Two minutes after the last touch, the wall keeps its view but returns focus to the current day, week or month and scrolls the grid to the current hour. It closes event details. It closes an editor only if nothing in it has changed; an editor with changes, or any pending or uncertain save, stays as it is. This replaces the current reset to Week.

## Existing calendar behavior that must survive

- Add, edit and delete; all-day and timed events; one occurrence or the whole series; read-only calendars.
- Optimistic previews, disabled duplicate saves, clear save state, uncertain-result checks and stale-edit conflicts. A layout or view switch never loses a draft or repeats a write.
- Live updates and Resync now preserve date, view, filters, scroll and drafts. Google reauthorization stays a separate message.
- Initial loading, valid empty, failed initial load, stale-but-readable data, disconnected, saving, uncertain, conflict, denied access and expired demo states each have a deliberate presentation.
- Daylight-saving gaps and overlaps, month and year boundaries and household midnight work. Never use browser-zone `Date` arithmetic to place household events.
- Weather failure is quiet. Keyboard focus, visible focus styles, accessible event names, contrast and browser zoom remain usable.

## Implementation sequence

Each milestone is reviewable on its own, with phone and wall/desktop screenshots in its PR compared against the canvas. Do not deploy an unfinished visual shell because its tests pass.

### 0. Visual direction

Mockups for the wall (Week, details, Day, Month, connection states), the desktop Week and the phone (Day, Week, Month, details, empty and failed states) are on the canvas linked above, populated with fictional demo data.

**Done when:** the owner has reviewed the canvas and any requested changes are made there and recorded here.

### 1. Shell, entry points and preferences

Add the visual tokens. Rebuild the wall shell with the new header and toolbar, no footer, connection pills and the save toast. Make `/` the phone/desktop calendar screen (responsive at 768 px, rail on desktop, two-tab nav on phone), keep `/calendar` as an alias, and retire the Today screen into it. Add per-context view memory and the new idle return. Existing view components can render inside the new chrome until they are replaced. Update `deploy/smoke.mjs` and its fixtures for the new heading and navigation, and the README.

**Done when:** first wall and desktop visits show Week, a first phone visit shows Day, remembered views survive a reload, direct links, sign-in and pairing work, idle return keeps the view and any edited draft, and the smoke checks pass.

### 2. Shared grid engine and Week

Build a pure, unit-tested projection of events into family-local day segments, collision groups and positions, starting from the Day view's code and `core/days.ts`. Build Week on it to match the canvas, including all-day lanes, short and dense events, the now line and stable scrolling. Add the details drawer and sheet, wire Edit to the existing editors, and add tap-to-create on empty slots. Keep one `CalendarStore` and one range owner per screen.

**Done when:** the populated Week matches the canvas at 1920 × 1080 and 1440 × 900; overlaps, overnight and all-day events render correctly; details and edits work for writable and read-only events; recovery still works.

### 3. Day, Month and the phone views

Rebuild wall/desktop Day on the engine, the full-height Month with bars and "+N more", and the phone Day agenda, Week agenda and compact Month.

**Done when:** switching views keeps the focus date and filters; Today works everywhere; every month fits; phone screens have no horizontal overflow at 320 px; details and edits work on every view.

### 4. Recovery, accessibility and visual hardening

Exercise each screen through reconnects, failed reads, uncertain writes, conflicts, viewport changes and household midnight. Check keyboard access, touch sizes, contrast, zoom, long titles and busy days.

**Done when:** the validation matrix passes and reviewed screenshots show no clipped controls, hidden events, false empty states or lost drafts.

### 5. Themes

Draw Night on the canvas first. Add the Groovy, Crisp, Bold and Night token sets, the family `Theme` setting with its migration and API field, the Settings picker with previews, automatic Night on the family clock, and per-theme font loading.

**Done when:** every view on wall, desktop and phone matches its theme board in all four themes, Night switches on and off at the family's night hours on every device, a theme change reaches a paired wall without a reload, and contrast passes for every member color in every theme.

### 6. Release

Run CI, review rendered screenshots, then release a version. After deploying, check a fresh demo visit, Week and Month with events, view memory, an edit and reload, and reconnect recovery; check the private instance's signed-out screen; a parent checks real Google sign-in and calendars.

**Done when:** the live demo matches the canvas in every theme, the deployed version is verified and calendar interactions work.

## Validation matrix

| Area | Evidence required |
| --- | --- |
| Grid projection | Unit cases for overlap chains, touching boundaries, short events, more than three overlaps, overnight splits, all-day exclusive ends, range clipping, hour-range growth and stable ordering |
| Dates and time | Household zone differs from browser zone; Sunday and Monday week starts; DST forward and back; midnight; month and year transitions |
| View preferences | New-device defaults per context, stored view, invalid or unavailable storage, crossing 768 px, idle return with and without an edited draft, family reset |
| Editing and recovery | Details for writable and read-only events; add, edit, delete; occurrence and series; optimistic state; lost response; conflict; reconnect and resync with an open draft |
| Visuals | Screenshots compared with the canvas at 1920 × 1080, 1440 × 900, 1024 × 768, 390 × 844 and 320 × 568; busy and empty calendars; long titles; zoom |
| State accuracy | Loading or failure never claims no events; stale data says what time it shows; disconnected and Google reauthorization stay separate |
| Themes | Screenshots of Week, Day, Month and phone Day in each theme; Night switching across the family's night hours in a zone that differs from the browser's; contrast per member color per theme; theme change reaching another signed-in device; reduced motion |
| Release | Updated smoke checks; fresh demo data shown; private instance denies anonymous access; deployed version checked |

Use the repository's commands: `npm run build`, `npm test -- --watch=false`, `npm run test:e2e`, and `dotnet test` when CI requires it. Unit tests alone do not prove the visual result.

## Deferred

Household features stay in the [household roadmap](household-roadmap.md). Also deferred: drag-and-drop and resizing, other view modes, dimming the wall to a clock at night, offline write queues, child accounts and new integrations.

## Progress record

| Milestone | Status | Evidence |
| --- | --- | --- |
| 0. Visual direction | In review | Canvas linked under Approved reference, October 22, 2026 |
| 1. Shell and preferences | Planned | Household retirement already done in PR #39 |
| 2. Grid engine and Week | Planned | |
| 3. Day, Month, phone | Planned | |
| 4. Hardening | Planned | |
| 5. Themes | Planned | Groovy, Crisp and Bold drawn on the canvas; Night still to draw |
| 6. Release | Planned | |

Update this record with merged PR links and screenshots after each milestone. An open PR or a passing build does not complete a milestone.
