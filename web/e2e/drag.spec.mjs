import { test, expect } from '@playwright/test';

const family = {
  id: 'family',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00',
  nightModeTo: '06:00:00',
  units: 'Imperial',
  latitude: null,
  longitude: null,
  members: [
    { id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
  { id: 'c9', name: 'School district', memberId: null, canWrite: false },
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
// Monday October 12, in New York: swim 5:30-6:15 PM, piano 10-11 AM every Wednesday, a read-only assembly 1-2 PM.
const events = [
  event('swim', 'c3', 'm3', 'Swim lesson', '2026-10-12T21:30:00Z', '2026-10-12T22:15:00Z'),
  event('piano', 'c1', 'm1', 'Piano', '2026-10-14T14:00:00Z', '2026-10-14T15:00:00Z', { recurring: true, seriesId: 'piano-series' }),
  event('assembly', 'c9', null, 'Assembly', '2026-10-13T17:00:00Z', '2026-10-13T18:00:00Z'),
];

/**
 * The family above with its live connection down. Changes to events are held, so the test can
 * see the move before the server answers, and recorded with their query.
 */
async function stub(page, wall) {
  const writes = [];
  await page.clock.install({ time: new Date('2026-10-12T15:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/calendar/events/')) {
      writes.push({ route, method: route.request().method(), path: url.pathname, series: url.searchParams.get('series'), body: route.request().postDataJSON() });
      return;
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events, changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  if (!wall) {
    // The phone lists its events; dragging is for the hour grids of the wall and a desktop window.
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await page.goto(wall ? '/wall' : '/');
  return writes;
}

/** How tall an hour is on the grid, and the box of each day's column. */
async function geometry(page) {
  const grid = page.locator('app-week-view app-hour-grid');
  const hour = parseFloat(await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--hour')));
  const columns = await grid.locator('.column').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  return { hour, columns };
}

const center = (box) => ({ x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 12) });

test('dragging an event moves it to another day and time, keeping its length', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const writes = await stub(page, wall);
  const swim = page.locator('app-week-view button.event', { hasText: 'Swim lesson' });
  await swim.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const { hour, columns } = await geometry(page);
  const from = center(await swim.boundingBox());

  // A tiny wobble is still a tap, and opens the details.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 2);
  await page.mouse.up();
  const details = page.getByRole('dialog', { name: 'Swim lesson' });
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);

  // Down an hour and a day across: Tuesday 6:30 to 7:15 PM.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + columns[1].x - columns[0].x, from.y + hour, { steps: 8 });
  const preview = page.locator('app-week-view .preview');
  await expect(preview).toContainText('6:30 PM – 7:15 PM');
  await expect(swim).toHaveClass(/lifted/);
  const box = await preview.boundingBox();
  expect(Math.abs(box.x - columns[1].x)).toBeLessThan(8);
  await page.screenshot({ path: testInfo.outputPath('dragging.png') });
  await page.mouse.up();

  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ method: 'PUT', path: '/api/calendar/events/swim', series: null });
  expect(writes[0].body).toMatchObject({ calendarId: 'c3', startDate: '2026-10-13', startTime: '18:30:00', endDate: '2026-10-13', endTime: '19:15:00' });
  // The move shows at once, saving, without opening the details.
  await expect(page.getByRole('dialog', { name: 'Swim lesson' })).toHaveCount(0);
  const moved = page.locator('app-week-view button.event', { hasText: 'Swim lesson' });
  await expect(moved).toHaveClass(/calendar-pending/);
  expect(Math.abs((await moved.boundingBox()).x - columns[1].x)).toBeLessThan(8);
  await expect(page.locator('app-calendar-save-status')).toContainText('Saving calendar');

  // The server refuses: the event goes back and the screen says why.
  await writes[0].route.fulfill({ status: 400, json: { title: 'Bad request' } });
  await expect(page.locator('app-calendar-save-status')).toContainText("This event can't be saved.");
  expect(Math.abs((await swim.boundingBox()).x - columns[0].x)).toBeLessThan(8);
  expect(errors).toEqual([]);
});

test('a repeating event asks whether to move it alone or the whole series, and Escape lets go', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const writes = await stub(page, wall);
  const piano = page.locator('app-week-view button.event', { hasText: 'Piano' });
  await piano.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const { hour, columns } = await geometry(page);
  let from = center(await piano.boundingBox());

  // Escape while dragging puts it back and saves nothing.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + hour, { steps: 6 });
  await expect(page.locator('app-week-view .preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('app-week-view .preview')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Half an hour later the same day: this event or all of them.
  from = center(await piano.boundingBox());
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + hour / 2, { steps: 6 });
  await page.mouse.up();
  const chooser = page.getByRole('dialog', { name: 'Move a repeating event' });
  await expect(chooser).toContainText('10:30 AM');
  await expect(chooser.getByRole('button', { name: 'This event' })).toBeFocused();
  for (const name of ['This event', 'All events', 'Cancel']) {
    expect((await chooser.getByRole('button', { name }).boundingBox()).height).toBeGreaterThanOrEqual(wall ? 56 : 44);
  }
  await page.screenshot({ path: testInfo.outputPath('repeating.png') });
  await chooser.getByRole('button', { name: 'All events' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ path: '/api/calendar/events/piano', series: 'true' });
  expect(writes[0].body).toMatchObject({ startDate: '2026-10-14', startTime: '10:30:00', endTime: '11:30:00' });
  await writes[0].route.fulfill({ status: 200, json: { ...events[1], startsAt: '2026-10-14T14:30:00Z', endsAt: '2026-10-14T15:30:00Z' } });
  await expect(page.locator('app-calendar-save-status')).toHaveCount(1);

  // To another day a whole series cannot follow, since each event keeps its own day.
  const again = center(await piano.boundingBox());
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(again.x + columns[3].x - columns[2].x, again.y, { steps: 6 });
  await page.mouse.up();
  await expect(chooser.getByRole('button', { name: 'This event' })).toBeVisible();
  await expect(chooser.getByRole('button', { name: 'All events' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(chooser).toHaveCount(0);
  expect(writes.length).toBe(1);
});

test('a read-only event stays put, and a finger picks an event up by holding it', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const writes = await stub(page, wall);
  const assembly = page.locator('app-week-view button.event', { hasText: 'Assembly' });
  await assembly.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const { hour } = await geometry(page);
  const a = center(await assembly.boundingBox());
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y + hour, { steps: 6 });
  await expect(page.locator('app-week-view .preview')).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.press('Escape');

  const swim = page.locator('app-week-view button.event', { hasText: 'Swim lesson' });
  await swim.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const s = center(await swim.boundingBox());
  const touch = (type, x, y) =>
    swim.dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true });

  // A finger that slides at once is scrolling, not dragging.
  await touch('pointerdown', s.x, s.y);
  await touch('pointermove', s.x, s.y + 30);
  await page.clock.runFor(500);
  await expect(page.locator('app-week-view .preview')).toHaveCount(0);
  await touch('pointerup', s.x, s.y + 30);

  // Held still, it lifts the event, which then follows the finger.
  await touch('pointerdown', s.x, s.y);
  await page.clock.runFor(400);
  await expect(page.locator('app-week-view .preview')).toContainText('5:30 PM – 6:15 PM');
  await touch('pointermove', s.x, s.y - hour);
  await expect(page.locator('app-week-view .preview')).toContainText('4:30 PM – 5:15 PM');
  await touch('pointerup', s.x, s.y - hour);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ startDate: '2026-10-12', startTime: '16:30:00', endTime: '17:15:00' });
});

test('on Day an event moves in time and stays in its person’s column', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const writes = await stub(page, wall);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Day' }).click();
  const swim = page.locator('app-day-view button.event', { hasText: 'Swim lesson' });
  await swim.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const grid = page.locator('app-day-view app-hour-grid');
  const hour = parseFloat(await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--hour')));
  const box = await swim.boundingBox();
  const from = center(box);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Across into Ben's column and an hour and a quarter earlier.
  await page.mouse.move(from.x - box.width, from.y - hour * 1.25, { steps: 8 });
  const preview = page.locator('app-day-view .preview');
  await expect(preview).toContainText('4:15 PM – 5:00 PM');
  expect(Math.abs((await preview.boundingBox()).x - box.x)).toBeLessThan(8);
  await page.screenshot({ path: testInfo.outputPath('day.png') });
  await page.mouse.up();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ calendarId: 'c3', startDate: '2026-10-12', startTime: '16:15:00', endTime: '17:00:00' });
});
