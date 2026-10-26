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
  members: [{ id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4' }],
};
const calendars = [{ id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true }];

/** A family whose Google calendars are kept only from Oct 13, so the days on screen reach past them. */
async function stub(page, wall, synced) {
  await page.clock.install({ time: new Date('2026-10-12T15:00:00Z') });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/api/session'
        ? { mode: 'Family', signedIn: true, canSignIn: true }
        : path === '/api/family'
          ? family
          : path === '/api/calendar'
            ? { calendars, events: [], changeNumber: 1, needsReconnect: false, ...synced }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto(wall ? '/wall' : '/');
}

test('days past what is kept say so instead of looking empty', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await stub(page, wall, { syncedFrom: '2026-10-13', syncedTo: '2026-12-01' });

  const notice = page.getByText('Synced from Oct 13, 2026');
  await expect(notice).toBeVisible();
  // The first day on screen is not kept, so it is not called empty either.
  if (!wall) await expect(page.getByRole('heading', { name: 'Not synced this far back' })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({ path: testInfo.outputPath('outside-sync.png') });
  expect(errors).toEqual([]);
});

test('days inside what is kept show no notice', async ({ page }, testInfo) => {
  await stub(page, testInfo.project.name === 'wall', { syncedFrom: '2026-07-15', syncedTo: '2027-11-17' });
  await expect(page.getByText(/Couldn't|Loading/)).toHaveCount(0);
  await expect(page.getByText(/Synced (from|through)/)).toHaveCount(0);
});
