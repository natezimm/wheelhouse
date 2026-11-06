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

test('the phone editor picks days on the same calendar and times on the same wheels as the wall', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the phone sheet only');
  await stub(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add event' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'New event' });
  const starts = sheet.getByRole('button', { name: /^Starts, / });
  const startTime = sheet.getByRole('button', { name: /^Start time, / });
  const endTime = sheet.getByRole('button', { name: /^End time, / });
  await expect(starts).toHaveText('Mon, Oct 12');
  await expect(startTime).toHaveText('3:30 pm');
  await expect(sheet.locator('input[type=date], input[type=time]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('phone-pickers.png') });

  // A tap anywhere on the field opens a month calendar that fits the phone, with 44 px days.
  const field = sheet.locator('.picker').first();
  const box = await field.boundingBox();
  await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
  const month = page.getByRole('dialog', { name: 'Starts', exact: true });
  await expect(month.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  const pop = await month.boundingBox();
  expect(pop.x).toBeGreaterThanOrEqual(0);
  expect(pop.x + pop.width).toBeLessThanOrEqual(390);
  const day = await month.getByRole('button', { name: 'Wednesday, October 14, 2026' }).boundingBox();
  expect(Math.min(day.width, day.height)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('phone-calendar.png') });
  await month.getByRole('button', { name: 'Wednesday, October 14, 2026' }).click();
  await expect(starts).toHaveText('Wed, Oct 14');
  await expect(sheet.getByRole('button', { name: /^Ends, / })).toHaveText('Wed, Oct 14');

  // Times on wheels: a new start keeps the length.
  await startTime.click();
  const wheels = page.getByRole('dialog', { name: 'Start time', exact: true });
  await wheels.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '4', exact: true }).click();
  await wheels.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: '00', exact: true }).click();
  await expect(startTime).toHaveText('4:00 pm');
  await expect(endTime).toHaveText('5:00 pm');
  await page.screenshot({ path: testInfo.outputPath('phone-wheels.png') });
  await wheels.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(wheels).toHaveCount(0);
  await expect(sheet).toBeVisible();
});
