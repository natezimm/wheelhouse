import { test, expect } from '@playwright/test';

const family = {
  id: 'family', name: 'The Marlowes', timeZone: 'America/New_York', weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00', nightModeTo: '06:00:00', units: 'Imperial', latitude: null, longitude: null,
  members: [{ id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' }],
};
const calendars = [{ id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true }];
const at = (id, title, startsAt, endsAt) => ({
  id, calendarId: 'c3', memberId: 'm3', memberIds: [], title, location: null, allDay: false, startsAt, endsAt,
  startDate: null, endDate: null, recurring: false, seriesId: null, creationId: null,
});
// In New York. Monday: a 15-minute event with a long one straight after it, and free time before.
// Tuesday: three 15-minute events back to back, with a long one before and after.
const events = [
  at('a', 'Pickup', '2026-10-12T19:00:00Z', '2026-10-12T19:15:00Z'),
  at('b', 'Swim', '2026-10-12T19:15:00Z', '2026-10-12T20:30:00Z'),
  at('c', 'Lunch', '2026-10-13T16:00:00Z', '2026-10-13T17:00:00Z'),
  at('d', 'Call', '2026-10-13T17:00:00Z', '2026-10-13T17:15:00Z'),
  at('e', 'Email', '2026-10-13T17:15:00Z', '2026-10-13T17:30:00Z'),
  at('f', 'Drive', '2026-10-13T17:30:00Z', '2026-10-13T17:45:00Z'),
  at('g', 'Piano', '2026-10-13T17:45:00Z', '2026-10-13T19:00:00Z'),
];

/** Where a finger can land on an event: the box of its touch area, which may be taller than the event. */
const touch = (event) =>
  event.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const area = getComputedStyle(el, '::after');
    const top = box.top + parseFloat(area.top);
    return { top, bottom: top + parseFloat(area.height), drawnTop: box.top, drawnBottom: box.bottom };
  });

test('a short wall event with no room below takes a finger from the free time above, never over a neighbour', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'the wall');
  await page.clock.install({ time: new Date('2026-10-12T13:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      json:
        path === '/api/session'
          ? { mode: 'Demo', signedIn: true, canSignIn: false }
          : path === '/api/family'
            ? family
            : path === '/api/calendar'
              ? { calendars, events, changeNumber: 1, needsReconnect: false }
              : {},
    });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto('/wall');
  const event = (title) => page.locator('app-week-view .event', { hasText: title });
  await expect(event('Pickup')).toBeVisible();

  // Pickup is drawn under 56 px tall and Swim starts as it ends, so its target grows upward to 56 px.
  const pickup = await touch(event('Pickup'));
  expect(pickup.drawnBottom - pickup.drawnTop).toBeLessThan(56);
  expect(pickup.bottom - pickup.top).toBeGreaterThanOrEqual(56);
  expect(pickup.top).toBeLessThan(pickup.drawnTop);
  // It takes nothing below: its target ends where the event is drawn to end.
  expect(pickup.bottom).toBeLessThanOrEqual(pickup.drawnBottom + 1);

  // A tap in that free time just above Pickup opens Pickup.
  const box = await event('Pickup').boundingBox();
  await page.mouse.click(box.x + box.width / 2, pickup.top + 4);
  await expect(page.getByRole('dialog', { name: 'Pickup' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Packed between other events there is no free time to take: each target stays the event as drawn.
  for (const title of ['Call', 'Email', 'Drive']) {
    const packed = await touch(event(title));
    expect(packed.top, title).toBeGreaterThanOrEqual(packed.drawnTop - 1);
    expect(packed.bottom, title).toBeLessThanOrEqual(packed.drawnBottom + 1);
  }
  await page.screenshot({ path: testInfo.outputPath('wall-touch.png') });
});
