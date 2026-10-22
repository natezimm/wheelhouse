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
const event = (id, calendarId, memberId, title, startsAt, endsAt, location = null) => ({
  id,
  calendarId,
  memberId,
  title,
  location,
  allDay: false,
  startsAt,
  endsAt,
  startDate: null,
  endDate: null,
  recurring: false,
  seriesId: null,
  creationId: null,
});
const events = [
  event('swim', 'c3', 'm3', 'Swim lesson', '2026-10-12T21:30:00Z', '2026-10-12T22:15:00Z', 'Pool'),
  event('pickup', 'c1', 'm1', 'Pick up Milo', '2026-10-12T21:45:00Z', '2026-10-12T22:00:00Z'),
  {
    ...event('spirit', 'c9', null, 'Spirit Day', null, null),
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: '2026-10-12',
    endDate: '2026-10-13',
  },
];

test('an event opens its details first, with finger-sized controls, then the editor', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-12T21:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : path === '/api/family'
          ? family
          : path === '/api/calendar'
            ? { calendars, events, changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto(wall ? '/wall' : '/');

  const target = wall ? 56 : 44;
  if (wall) {
    // Overlapping events sit side by side; a 15-minute one still takes a finger.
    const swim = page.locator('app-week-view .event', { hasText: 'Swim lesson' });
    const pickup = page.locator('app-week-view .event', { hasText: 'Pick up Milo' });
    const [a, b] = [await swim.boundingBox(), await pickup.boundingBox()];
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    const reach = await pickup.evaluate((el) => parseFloat(getComputedStyle(el, '::after').height));
    expect(reach).toBeGreaterThanOrEqual(target);
    // So does an all-day bar, through half the gap above and below it.
    const bar = page.locator('app-week-view .bar', { hasText: 'Spirit Day' });
    expect(await bar.evaluate((el) => parseFloat(getComputedStyle(el, '::after').height))).toBeGreaterThanOrEqual(target);
    await swim.click();
  } else {
    await page.locator('app-agenda-list li.event button', { hasText: 'Swim lesson' }).click();
  }

  const details = page.getByRole('dialog', { name: 'Swim lesson' });
  await expect(details).toContainText('Pool');
  await expect(details).toContainText('5:30 – 6:15 PM');
  await expect(page.locator(wall ? 'app-event-dialog' : 'app-event-sheet')).toHaveCount(0);
  for (const name of ['Close', 'Edit event', 'Delete']) {
    const box = await details.getByRole('button', { name, exact: true }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(target);
  }
  await page.screenshot({ path: testInfo.outputPath('details.png') });

  await details.getByRole('button', { name: 'Edit event', exact: true }).click();
  await expect(page.locator(wall ? 'app-event-dialog' : 'app-event-sheet')).toHaveCount(1);
  await expect(details).toHaveCount(0);
  await page.locator(wall ? 'app-event-dialog' : 'app-event-sheet').getByRole('button', { name: 'Cancel', exact: true }).click();

  // A read-only event is no longer a dead button: it says why it cannot be changed.
  await page.getByRole('button', { name: /Spirit Day/ }).first().click();
  const readOnly = page.getByRole('dialog', { name: 'Spirit Day' });
  await expect(readOnly).toContainText('can show but not change');
  await expect(readOnly.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(readOnly).toHaveCount(0);
  expect(errors).toEqual([]);
});
