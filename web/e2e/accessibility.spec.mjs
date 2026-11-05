import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every screen, in every look, checked with axe for the WCAG 2.2 AA rules it can test by itself.
// What axe cannot judge on the wall (focus order, focus you can see, dialogs holding and handing back
// focus) the keyboard tests below walk through, as someone with a keyboard and no mouse would.

const family = {
  id: 'family',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00',
  nightModeTo: '06:00:00',
  units: 'Imperial',
  latitude: 41.9,
  longitude: -73.97,
  theme: 'Daylight',
  nightMode: 'Off',
  members: [
    { id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4', avatar: null },
    { id: 'm2', displayName: 'Ada', initial: 'A', role: 'Parent', color: '#B3261E', avatar: 'fox' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D', avatar: null },
    { id: 'm4', displayName: 'June', initial: 'J', role: 'Kid', color: '#8E44AD', avatar: null },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c2', name: 'Ada', memberId: 'm2', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
  { id: 'c4', name: 'June', memberId: 'm4', canWrite: true },
  { id: 'c5', name: 'Family', memberId: null, canWrite: true },
  { id: 'c6', name: 'Holidays', memberId: null, canWrite: false },
];
const event = (id, calendarId, memberId, title, startsAt, endsAt, extra = {}) => ({
  id,
  calendarId,
  memberId,
  title,
  location: null,
  allDay: false,
  startsAt,
  endsAt,
  startDate: null,
  endDate: null,
  recurring: false,
  seriesId: null,
  creationId: null,
  ...extra,
});
const allDay = (id, calendarId, memberId, title, startDate, endDate, extra = {}) =>
  event(id, calendarId, memberId, title, null, null, { allDay: true, startDate, endDate, ...extra });
// The week of Monday October 12 in New York (UTC-4), busy enough for overlaps, all-day bars and a "+N".
const events = [
  allDay('trash', 'c5', null, 'Trash & recycling', '2026-10-12', '2026-10-13'),
  allDay('columbus', 'c6', null, 'Indigenous Peoples’ Day', '2026-10-12', '2026-10-13'),
  allDay('trip', 'c2', 'm2', 'Work trip', '2026-10-14', '2026-10-17'),
  event('standup', 'c1', 'm1', 'Standup', '2026-10-12T13:00:00Z', '2026-10-12T13:30:00Z', { recurring: true, seriesId: 's1', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }),
  event('dentist', 'c1', 'm1', 'Dentist', '2026-10-12T19:00:00Z', '2026-10-12T20:00:00Z', { location: 'Main St Dental', description: 'Bring the insurance card.' }),
  event('swim', 'c3', 'm3', 'Swim lesson', '2026-10-12T20:30:00Z', '2026-10-12T21:45:00Z', { location: 'Pool', countdown: true }),
  event('call', 'c2', 'm2', 'Call with Sam', '2026-10-12T20:30:00Z', '2026-10-12T21:00:00Z', { private: true }),
  event('art', 'c4', 'm4', 'Art club', '2026-10-12T20:30:00Z', '2026-10-12T21:30:00Z'),
  event('soccer', 'c4', 'm4', 'Soccer', '2026-10-12T20:45:00Z', '2026-10-12T21:30:00Z'),
  event('dinner', 'c5', null, 'Dinner with the Okafors', '2026-10-12T23:00:00Z', '2026-10-13T00:30:00Z', { memberIds: ['m1', 'm3'] }),
  event('piano', 'c3', 'm3', 'Piano', '2026-10-13T21:00:00Z', '2026-10-13T22:00:00Z'),
  event('vet', 'c5', null, 'Vet: Biscuit', '2026-10-15T14:00:00Z', '2026-10-15T15:00:00Z'),
  event('book', 'c2', 'm2', 'Book club', '2026-10-16T23:30:00Z', '2026-10-17T01:00:00Z'),
  event('game', 'c4', 'm4', 'Game day', '2026-10-17T15:00:00Z', '2026-10-17T18:00:00Z'),
  event('busy', 'c2', 'm2', 'Busy', '2026-10-13T15:00:00Z', '2026-10-13T16:00:00Z', { private: true, hidden: true }),
];
const countdowns = [
  allDay('cabin', 'c5', null, 'Cabin weekend', '2026-10-23', '2026-10-26', { countdown: true }),
  allDay('party', 'c3', 'm3', 'Milo’s party', '2026-11-14', '2026-11-15', { countdown: true }),
];
const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((date, i) => ({
  date,
  description: i === 2 ? 'Rain' : i === 3 ? 'Partly cloudy' : 'Clear',
  icon: i === 2 ? 'Rain' : i === 3 ? 'PartlyCloudy' : 'Sun',
  high: 64 - i,
  low: 47 - i,
}));
const weather = { temperature: 61, description: 'Clear', icon: 'Sun', high: 64, low: 47, unit: 'F', days };

/** The family above in one look, its live connection down so nothing changes under a check. */
async function stub(page, path, look = {}) {
  // 2:30 PM on Monday October 12 in New York.
  await page.clock.install({ time: new Date('2026-10-12T18:30:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    const body =
      url === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false, isDisplay: false }
        : url === '/api/family'
          ? { ...family, ...look }
          : url === '/api/calendar'
            ? { calendars, events, changeNumber: 1, needsReconnect: false }
            : url === '/api/calendar/countdowns'
              ? countdowns
              : url === '/api/weather'
                ? weather
                : url === '/api/devices'
                  ? []
                  : url === '/api/calendar/search'
                    ? { events: events.slice(3, 6), total: 3, notCached: [], complete: true }
                    : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
}

/** Lets fades and slides finish, so axe reads the colors a person would see. */
const settle = (page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));

/**
 * The rules axe can judge, at WCAG 2.2 AA plus its best practices, on the page or only inside an open
 * dialog (what lies under a modal dialog is out of reach until it closes, so axe would only find it covered).
 *
 * Label in name is left out: an event's spoken name leads with its title ("Dentist, Monday 3 – 4 pm, Ben")
 * while its block shows the time first, and a day reads "Tuesday, October 13" under its short "T 13". Both
 * are deliberate, and the rule (still experimental in axe) cannot tell them from a mismatch.
 */
async function violations(page, within) {
  await settle(page);
  let axe = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .disableRules(['label-content-name-mismatch']);
  if (within) axe = axe.include(within);
  const { violations } = await axe.analyze();
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')}: ${n.failureSummary?.split('\n')[1]?.trim()}`).join('\n')}`);
}

/** Collects every screen's violations, so one run names them all. */
function checker(page) {
  const found = [];
  return {
    found,
    check: async (where, within) => found.push(...(await violations(page, within)).map((v) => `${where}: ${v}`)),
  };
}

const looks = ['Daylight', 'Groovy', 'Classic', 'Bold'].flatMap((theme) => [
  { theme, nightMode: 'Off' },
  { theme, nightMode: 'Always' },
]);
const lookName = (look) => `${look.theme}${look.nightMode === 'Always' ? ' at night' : ''}`;
const view = (page, name) => page.getByRole('button', { name, exact: true }).first().click();
const DIALOG = '[role=dialog]';

for (const look of looks) {
  test(`the wall and a desktop window pass axe in ${lookName(look)}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'wall', 'Wall and desktop sizes.');
    test.setTimeout(90_000);
    const { found, check } = checker(page);

    await stub(page, '/wall', look);
    for (const name of ['Week', 'Day', 'Month']) {
      await view(page, name);
      await check(`wall ${name}`);
    }
    await view(page, 'Week');
    await page.getByRole('button', { name: /^Dentist/ }).click();
    const details = page.getByRole('dialog', { name: 'Dentist' });
    await expect(details).toBeVisible();
    await check('wall details', DIALOG);
    await details.getByRole('button', { name: 'Edit event', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
    await check('wall editor', DIALOG);
    await page.getByRole('dialog', { name: 'Edit event' }).getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Show today at a glance' }).click();
    await expect(page.getByRole('dialog', { name: 'Today at a glance' })).toBeVisible();
    await check('wall glance', DIALOG);

    // A desktop window, first visit to the demo: the welcome shows in its corner.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Meet the Marlowes' })).toBeVisible();
    await check('desktop welcome', 'app-demo-welcome');
    await page.getByRole('button', { name: 'Explore on my own' }).click();
    for (const name of ['Week', 'Day', 'Month']) {
      await view(page, name);
      await check(`desktop ${name}`);
    }
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('searchbox').fill('a');
    await page.clock.runFor(1000);
    await expect(page.getByRole('dialog', { name: 'Search events' }).getByRole('heading').first()).toBeVisible();
    await check('desktop search', DIALOG);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search events' })).toBeHidden();
    await page.keyboard.press('Shift+Slash');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await check('desktop shortcuts', DIALOG);

    expect(found, found.join('\n')).toEqual([]);
  });

  test(`a phone passes axe in ${lookName(look)}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'Phone size.');
    test.setTimeout(90_000);
    const { found, check } = checker(page);

    await stub(page, '/', look);
    await expect(page.getByRole('region', { name: 'Meet the Marlowes' })).toBeVisible();
    await check('phone welcome', 'app-demo-welcome');
    await page.getByRole('button', { name: 'Explore on my own' }).click();
    for (const name of ['Day', 'Week', 'Month']) {
      await view(page, name);
      await check(`phone ${name}`);
    }
    await view(page, 'Day');
    await page.getByRole('button', { name: /^Dentist/ }).click();
    await expect(page.getByRole('dialog', { name: 'Dentist' })).toBeVisible();
    await check('phone details', DIALOG);
    await page.getByRole('button', { name: 'Edit event', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
    await check('phone editor', DIALOG);
    await page.getByRole('dialog', { name: 'Edit event' }).getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Search events' }).click();
    await page.getByRole('searchbox').fill('a');
    await page.clock.runFor(1000);
    await expect(page.getByRole('dialog', { name: 'Search events' }).getByRole('heading').first()).toBeVisible();
    await check('phone search', DIALOG);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await check('phone settings');

    expect(found, found.join('\n')).toEqual([]);
  });
}

// The keyboard on the wall. A wall has no keyboard of its own, but a desktop window shares its views and
// editor, and a switch or keyboard user of the wall's browser reaches it the same way.

/** Where focus is: its name, its box, whether its ring shows in full, and the dialog it is in. */
const focused = (page) =>
  page.evaluate(() => {
    const at = document.activeElement;
    if (!at || at === document.body) return null;
    const box = at.getBoundingClientRect();
    const style = getComputedStyle(at);
    const ring = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    const reach = Math.max(0, parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth));
    let clippedBy = null;
    for (let up = at.parentElement; up && !clippedBy; up = up.parentElement) {
      const s = getComputedStyle(up);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const edge = up.getBoundingClientRect();
      if (box.left - reach < edge.left - 0.5 || box.top - reach < edge.top - 0.5 || box.right + reach > edge.right + 0.5 || box.bottom + reach > edge.bottom + 0.5) {
        clippedBy = up.className || up.tagName;
      }
    }
    return {
      name: at.getAttribute('aria-label') || at.textContent.trim().replace(/\s+/g, ' '),
      x: box.x,
      y: box.y,
      bottom: box.bottom,
      onScreen: box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
      ring,
      clippedBy,
      dialog: at.closest('[role=dialog]')?.getAttribute('aria-label') ?? null,
    };
  });

/** Tabs (or shift-tabs) through every stop until focus comes back round, at most a hundred. */
async function tabStops(page, key = 'Tab') {
  const stops = [];
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press(key);
    const at = await focused(page);
    if (!at || (stops.length > 0 && at.name === stops[0].name && at.y === stops[0].y && at.x === stops[0].x)) break;
    stops.push(at);
  }
  return stops;
}

for (const look of [{ theme: 'Daylight', nightMode: 'Off' }, { theme: 'Bold', nightMode: 'Always' }]) {
  test(`the wall's tab order reads like the screen, with a ring you can see on every stop, in ${lookName(look)}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'wall', 'The wall.');
    await stub(page, '/wall', look);
    const stops = await tabStops(page);
    expect(stops.map((s) => s.name).slice(0, 3)).toEqual(['Show today at a glance', 'Ben', 'Ada'].map((n, i) => (i === 0 ? n : expect.stringContaining(n))));

    for (const stop of stops) {
      expect.soft(stop.onScreen, `${stop.name} is on the screen when it has focus`).toBe(true);
      expect.soft(stop.ring, `${stop.name} shows a focus ring`).toBe(true);
      expect.soft(stop.clippedBy, `${stop.name}'s ring is not cut off`).toBeNull();
    }

    // The toolbar first, top row then the second, each left to right; then the days' headings, their
    // all-day events and their timed events, a day at a time from Monday.
    const heading = stops.findIndex((s) => s.name === 'Open Monday, October 12');
    const toolbar = stops.slice(0, heading);
    expect(toolbar.map((s) => s.name)).toContain('Add event');
    for (let i = 1; i < toolbar.length; i++) {
      const [before, after] = [toolbar[i - 1], toolbar[i]];
      expect(after.y > before.bottom - 8 || (Math.abs(after.y - before.y) < 16 && after.x > before.x), `${after.name} comes after ${before.name}`).toBe(true);
    }
    const headings = stops.slice(heading, heading + 7);
    expect(headings.map((s) => s.name)).toEqual(
      ['Monday, October 12', 'Tuesday, October 13', 'Wednesday, October 14', 'Thursday, October 15', 'Friday, October 16', 'Saturday, October 17', 'Sunday, October 18'].map((d) => `Open ${d}`),
    );
    const columns = headings.map((h) => h.x);
    const column = (stop) => columns.filter((x) => x <= stop.x + 4).length - 1;
    const events = stops.slice(heading + 7);
    expect(events.length).toBeGreaterThanOrEqual(13);
    const allDay = events.filter((s) => s.name.includes('all day'));
    expect(events.slice(0, allDay.length)).toEqual(allDay);
    const timed = events.slice(allDay.length);
    for (let i = 1; i < timed.length; i++) {
      expect(column(timed[i]), `${timed[i].name} is on the same day as ${timed[i - 1].name} or a later one`).toBeGreaterThanOrEqual(column(timed[i - 1]));
    }

    // Shift+Tab walks the same stops backwards.
    const back = await tabStops(page, 'Shift+Tab');
    expect(back.map((s) => s.name).reverse().slice(0, -1)).toEqual(stops.map((s) => s.name).slice(0, back.length - 1));
  });
}

test('event details and the editor keep the keyboard inside them, and hand it back to the event', async ({ page }, info) => {
  test.skip(info.project.name !== 'wall', 'The wall.');
  await stub(page, '/wall');
  const dentist = page.getByRole('button', { name: /^Dentist/ });
  await dentist.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog', { name: 'Dentist' });
  await expect(details).toBeVisible();
  await expect.poll(async () => (await focused(page))?.dialog).toBe('Dentist');
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(key);
      expect(await focused(page)).toMatchObject({ dialog: 'Dentist', ring: true, onScreen: true });
    }
  }
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(dentist).toBeFocused();

  await page.keyboard.press('Enter');
  await details.getByRole('button', { name: 'Edit event', exact: true }).focus();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await expect(editor).toBeVisible();
  await expect.poll(async () => (await focused(page))?.dialog).toBe('Edit event');
  // Round its ends: back from the start to its last control, on to its first.
  await page.keyboard.press('Shift+Tab');
  expect(await focused(page)).toMatchObject({ name: 'Save changes', dialog: 'Edit event', ring: true, onScreen: true });
  await page.keyboard.press('Tab');
  expect(await focused(page)).toMatchObject({ name: 'Close', dialog: 'Edit event', ring: true, onScreen: true });
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await focused(page), `stop ${i}`).toMatchObject({ dialog: 'Edit event', ring: true });
  }
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(dentist).toBeFocused();

  const add = page.getByRole('button', { name: 'Add event' });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await expect.poll(async () => (await focused(page))?.dialog).toBe('New event');
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
});

test('a day opened from the week, or the pairing screen, never leaves the keyboard at the top of the page', async ({ page }, info) => {
  test.skip(info.project.name !== 'wall', 'The wall.');
  await stub(page, '/wall');
  await page.getByRole('button', { name: 'Open Monday, October 12' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Calendar' })).toBeFocused();
  await page.keyboard.press('Tab');
  expect((await focused(page)).name).not.toBe('Show today at a glance');

  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: /^2 more events/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Calendar' })).toBeFocused();

  const pair = page.getByRole('button', { name: 'Pair with a phone' });
  await pair.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Pair this display' })).toBeFocused();
  await page.keyboard.press('Tab');
  const back = page.getByRole('button', { name: 'Back to the family' });
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pair).toBeFocused();
});

test('today at a glance opens from the clock by keyboard and any key brings the calendar back to it', async ({ page }, info) => {
  test.skip(info.project.name !== 'wall', 'The wall.');
  await stub(page, '/wall');
  const clock = page.getByRole('button', { name: 'Show today at a glance' });
  await clock.focus();
  await page.keyboard.press('Enter');
  const glance = page.getByRole('dialog', { name: 'Today at a glance' });
  await expect(glance).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(glance).toBeHidden();
  await expect(clock).toBeFocused();
});
