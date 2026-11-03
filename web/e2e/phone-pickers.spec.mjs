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
  members: [{ id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' }],
};

/** The family above at 3:22 PM on Monday October 12 in New York, with nothing planned. */
async function stub(page) {
  await page.clock.install({ time: new Date('2026-10-12T19:22:00Z') });
  await page.addInitScript(() => localStorage.setItem('wheelhouse.welcome.v1', 'seen'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : path === '/api/family'
          ? family
          : path === '/api/calendar'
            ? { calendars: [{ id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true }], events: [], changeNumber: 1, needsReconnect: false }
            : path === '/api/calendar/countdowns'
              ? []
              : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
}

test('the phone editor writes dates and times as the app does, over the phone’s own pickers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the phone sheet only');
  await stub(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add event' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'New event' });
  const starts = sheet.locator('.picker').nth(0);
  const startTime = sheet.locator('.picker').nth(1);
  await expect(starts.locator('.face')).toHaveText('Mon, Oct 12');
  await expect(startTime.locator('.face')).toHaveText(/^3:30 pm$/i);
  await page.screenshot({ path: testInfo.outputPath('phone-pickers.png') });

  // The browser's own input lies over each face, labelled, and choosing in it changes the face.
  await sheet.getByLabel('Start time').fill('16:00');
  await expect(startTime.locator('.face')).toHaveText(/^4:00 pm$/i);
  await sheet.getByLabel('Starts').fill('2026-10-14');
  await expect(starts.locator('.face')).toHaveText('Wed, Oct 14');
});
