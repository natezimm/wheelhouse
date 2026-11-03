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
    { id: 'm4', displayName: 'Josephine', initial: 'J', role: 'Kid', color: '#8A4FBF' },
    { id: 'm5', displayName: 'Bartholomew', initial: 'B', role: 'Kid', color: '#B8326B' },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c2', name: 'Tess', memberId: 'm2', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
  { id: 'c4', name: 'Josephine', memberId: 'm4', canWrite: true },
  { id: 'c5', name: 'Bartholomew', memberId: 'm5', canWrite: true },
  { id: 'c6', name: 'Family', memberId: null, canWrite: true },
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
            ? { calendars, events: [], changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
}

test('the phone’s people chips fade at the edge that has more to show', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The wall’s chips wrap instead.');
  await stub(page);
  await page.goto('/');

  const chips = page.locator('app-phone-day app-calendar-filter');
  await expect(chips.getByRole('button', { name: /Bartholomew/ })).toBeAttached();
  await expect(chips).toHaveAttribute('data-fade', 'end');
  await page.screenshot({ path: testInfo.outputPath('chips-start.png') });

  await chips.evaluate((row) => row.scrollBy({ left: 60 }));
  await expect(chips).toHaveAttribute('data-fade', 'both');

  await chips.evaluate((row) => row.scrollTo({ left: row.scrollWidth }));
  await expect(chips).toHaveAttribute('data-fade', 'start');
  await page.screenshot({ path: testInfo.outputPath('chips-end.png') });
});
