import { test, expect } from '@playwright/test';

// The demo family lives in New York; its days and clock are the ones the screens show.
const zone = 'America/New_York';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());

/** Opens the screen, which makes this browser's own demo copy, and waits for its calendar. */
async function open(page, wall) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/calendar' && r.ok());
  await page.goto(wall ? '/wall' : '/');
  await loaded;
  return errors;
}

/** The copy's events for today and the week after, read straight from the API with this browser's cookie. */
async function calendar(page, days = 8) {
  const to = new Date(`${today}T12:00:00Z`);
  to.setUTCDate(to.getUTCDate() + days);
  const response = await page.request.get(`/api/calendar?from=${today}&to=${to.toISOString().slice(0, 10)}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/**
 * Adds an event at 1 PM today through the API, as the setup for a check of the screens. No demo
 * event overlaps that hour on any day, so Week never folds it into "+N" (at 10 AM on a Saturday
 * it would be a third beside the farmers market and the morning's other event).
 */
async function addAt1(page, title, repeat = 'Never') {
  const { calendars } = await calendar(page);
  const writable = calendars.find((c) => c.canWrite && c.memberId);
  const response = await page.request.post('/api/calendar/events', {
    data: {
      calendarId: writable.id, title, location: null, allDay: false,
      startDate: today, startTime: '13:00:00', endDate: today, endTime: '14:00:00', repeat,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

const saved = (page) => expect(page.locator('app-calendar-save-status .saving')).toHaveCount(0, { timeout: 20_000 });

test('an event added on the screen is saved, survives a reload and can be deleted', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const errors = await open(page, wall);
  const title = `Stack check ${testInfo.project.name}`;

  await page.getByRole('button', { name: 'Add event', exact: true }).first().click();
  const editor = page.locator(wall ? 'app-event-dialog' : 'app-event-sheet');
  await editor.locator('input[type=text]').first().fill(title);
  await editor.getByRole('button', { name: wall ? 'Save event' : 'Save', exact: true }).click();
  await saved(page);
  expect((await calendar(page)).events.map((e) => e.title)).toContain(title);

  await page.reload();
  const event = page.getByRole('button', { name: new RegExp(title) }).first();
  await expect(event).toBeVisible();
  await event.click();
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'Delete', exact: true }).click();
  await editor.getByRole('button', { name: 'Delete event', exact: true }).click();
  await saved(page);
  await expect.poll(async () => (await calendar(page)).events.map((e) => e.title)).not.toContain(title);
  expect(errors).toEqual([]);
});

test('dragging an event on the wall moves it, and the move is saved', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'Dragging is for the wall and desktop grids');
  const errors = await open(page, true);
  const added = await addAt1(page, 'Stack drag check');
  await page.reload();

  const grid = page.locator('app-week-view app-hour-grid');
  const hour = parseFloat(await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--hour')));
  const event = page.locator('app-week-view button.event', { hasText: 'Stack drag check' });
  await event.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = await event.boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 12) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + hour, { steps: 8 });
  await page.mouse.up();
  await saved(page);

  await expect.poll(async () => Date.parse((await calendar(page)).events.find((e) => e.title === 'Stack drag check')?.startsAt))
    .toBe(Date.parse(added.startsAt) + 3_600_000);
  expect(errors).toEqual([]);
});

test('renaming all events of a series on the phone renames every one', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'One layout is enough for the series write');
  const errors = await open(page, false);
  await addAt1(page, 'Stack series check', 'Weekly');
  await page.reload();

  // Today's events that ended over an hour ago fold behind "N earlier events" on the phone.
  const series = page.getByRole('button', { name: /Stack series check/ }).first();
  const earlier = page.getByRole('button', { name: /earlier event/ });
  await expect(series.or(earlier)).toBeVisible();
  if (await earlier.isVisible()) await earlier.click();
  await series.click();
  await page.getByRole('dialog', { name: 'Stack series check' }).getByRole('button', { name: 'Edit event', exact: true }).click();
  const sheet = page.locator('app-event-sheet');
  await sheet.getByLabel('Change').selectOption('all');
  await sheet.locator('input[type=text]').first().fill('Stack series renamed');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(page);

  await expect.poll(async () => {
    const titles = (await calendar(page, 15)).events.map((e) => e.title);
    return { renamed: titles.filter((t) => t === 'Stack series renamed').length, old: titles.filter((t) => t === 'Stack series check').length };
  }).toEqual({ renamed: 3, old: 0 });
  expect(errors).toEqual([]);
});
