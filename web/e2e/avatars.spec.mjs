import { test, expect } from '@playwright/test';

const family = {
  id: 'family',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00',
  nightModeTo: '06:00:00',
  theme: 'Daylight',
  nightMode: 'Off',
  units: 'Imperial',
  latitude: null,
  longitude: null,
  members: [
    { id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4', avatar: 'fox' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D', avatar: null },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
];
const event = (id, calendarId, memberId, title, startsAt, endsAt) => ({
  id, calendarId, memberId, title, location: null, allDay: false, startsAt, endsAt,
  startDate: null, endDate: null, recurring: false, seriesId: null, creationId: null,
});
const events = [
  event('run', 'c1', 'm1', 'Long run', '2026-10-12T15:00:00Z', '2026-10-12T17:00:00Z'),
  event('swim', 'c3', 'm3', 'Swim lesson', '2026-10-12T21:30:00Z', '2026-10-12T22:15:00Z'),
];

test('a member with a picture shows it wherever their initial would be, and the rest keep their initial', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-12T14:00:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    const body =
      url === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url === '/api/family'
          ? family
          : url === '/api/calendar'
            ? { calendars, events, changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto(info.project.name === 'wall' ? '/wall' : '/');

  const ben = page.locator('img[src="/avatars/fox.svg"]');
  // The filter chip and the event's mark, at least.
  await expect.poll(() => ben.count()).toBeGreaterThanOrEqual(2);
  for (const image of await ben.all()) {
    await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  await expect(page.locator('img[src^="/avatars/"]:not([src="/avatars/fox.svg"])')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Milo/ }).first()).toContainText('M');
});
