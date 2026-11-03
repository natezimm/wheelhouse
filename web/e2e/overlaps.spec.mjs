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
    { id: 'm2', displayName: 'Tess', initial: 'T', role: 'Parent', color: '#B85A14' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c2', name: 'Tess', memberId: 'm2', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
];
const at = (id, calendarId, memberId, title, startsAt, endsAt) => ({
  id, calendarId, memberId, memberIds: [], title, location: null, allDay: false, startsAt, endsAt,
  startDate: null, endDate: null, recurring: false, seriesId: null, creationId: null,
});
// Monday October 12 in New York: three events overlap from 2 to 3 PM; on Wednesday four overlap.
const events = [
  at('a', 'c1', 'm1', 'Dentist', '2026-10-12T18:00:00Z', '2026-10-12T19:00:00Z'),
  at('b', 'c2', 'm2', 'Call', '2026-10-12T18:00:00Z', '2026-10-12T19:00:00Z'),
  at('c', 'c3', 'm3', 'Piano', '2026-10-12T18:15:00Z', '2026-10-12T19:00:00Z'),
  at('d', 'c1', 'm1', 'Errands', '2026-10-14T18:00:00Z', '2026-10-14T19:00:00Z'),
  at('e', 'c2', 'm2', 'Review', '2026-10-14T18:00:00Z', '2026-10-14T19:00:00Z'),
  at('f', 'c3', 'm3', 'Chess', '2026-10-14T18:00:00Z', '2026-10-14T19:00:00Z'),
  at('g', 'c3', 'm3', 'Snack', '2026-10-14T18:30:00Z', '2026-10-14T19:00:00Z'),
];

async function stub(page) {
  await page.addInitScript(() => localStorage.setItem('wheelhouse.welcome.v1', '1'));
  await page.clock.install({ time: new Date('2026-10-12T13:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
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
}

test('a wide Week day puts three overlapping events side by side, a narrow one folds the third into a stack', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'The phone lists Week as rows.');
  await stub(page);
  await page.goto('/wall');

  const week = page.locator('app-week-view');
  for (const title of ['Dentist', 'Call', 'Piano', 'Chess', 'Errands']) {
    await expect(week.locator('.event', { hasText: title })).toBeVisible();
  }
  // Four at once still fold: two shown and a "+2" stack beside them.
  await expect(week.locator('.more')).toHaveCount(1);
  await expect(week.locator('.more')).toHaveText('+2');
  const widths = await week.locator('.event', { hasText: /Dentist|Call|Piano/ }).evaluateAll((all) => all.map((e) => e.getBoundingClientRect().width));
  expect(widths).toHaveLength(3);
  await page.screenshot({ path: testInfo.outputPath('wall-week.png') });

  // A smaller desktop window keeps two side by side.
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Week' }).click();
  const desktop = page.locator('app-week-view');
  await expect(desktop.locator('.event', { hasText: 'Call' })).toBeVisible();
  await expect(desktop.locator('.event', { hasText: 'Dentist' })).toHaveCount(0);
  await expect(desktop.locator('.event', { hasText: 'Piano' })).toHaveCount(0);
  await expect(desktop.locator('.more')).toHaveText(['+2', '+3']);
  await page.screenshot({ path: testInfo.outputPath('desktop-week.png') });
});
