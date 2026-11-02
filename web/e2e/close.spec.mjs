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
    { id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
];

/** The family above with no events, its live connection down so nothing refreshes under the test. */
async function stub(page, path, look = {}) {
  await page.clock.install({ time: new Date('2026-10-12T16:00:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    const body =
      url === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url === '/api/family'
          ? { ...family, ...look }
          : url === '/api/calendar'
            ? { calendars, events: [], changeNumber: 1, needsReconnect: false }
            : url === '/api/displays' || url === '/api/calendar/countdowns'
              ? []
              : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto(path);
}

/** The control sits in its header's top-right corner and takes a finger. */
async function inTopRight(control, header, target) {
  const [box, row] = [await control.boundingBox(), await header.boundingBox()];
  expect(box.height).toBeGreaterThanOrEqual(target);
  expect(box.width).toBeGreaterThanOrEqual(target);
  expect(Math.abs(box.x + box.width - (row.x + row.width))).toBeLessThanOrEqual(1);
  expect(box.y - row.y).toBeLessThanOrEqual(8);
}

test('New event closes from an X in its top-right corner, as its details do', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  await stub(page, wall ? '/wall' : '/');
  await page.getByRole('button', { name: 'Add event' }).first().click();

  const editor = page.getByRole('dialog', { name: 'New event' });
  const close = editor.getByRole('button', { name: 'Close', exact: true });
  await inTopRight(close, editor.locator(wall ? '.top' : 'header'), wall ? 56 : 44);
  await close.click();
  await expect(editor).toHaveCount(0);

  // Escape still closes it too.
  await page.getByRole('button', { name: 'Add event' }).first().click();
  await expect(editor).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

test('Settings closes to the calendar from an X in its top-right corner', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'wall', 'Settings live only on the phone.');
  await stub(page, '/');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await expect(page.getByRole('link', { name: 'Back to the calendar' })).toHaveCount(0);
  const close = page.getByRole('link', { name: 'Close Settings' });
  await inTopRight(close, page.locator('app-settings > header'), 44);
  await close.click();
  await expect(page).not.toHaveURL(/settings/);
  await expect(page.getByRole('button', { name: 'Add event' }).first()).toBeVisible();
});
