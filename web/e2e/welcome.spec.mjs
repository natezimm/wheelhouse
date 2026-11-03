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
  theme: 'Daylight',
  nightMode: 'Off',
  members: [{ id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' }],
};
const swim = {
  id: 'swim',
  calendarId: 'c3',
  memberId: 'm3',
  title: 'Swim lesson',
  location: 'Riverside Rec Center',
  allDay: false,
  startsAt: '2026-10-12T21:30:00Z',
  endsAt: '2026-10-12T22:15:00Z',
  startDate: null,
  endDate: null,
  recurring: false,
  seriesId: null,
  creationId: null,
};

/** A demo (or family) instance at 3:22 PM on Monday October 12 in New York. */
async function stub(page, mode = 'Demo') {
  await page.clock.install({ time: new Date('2026-10-12T19:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/family/theme') {
      Object.assign(family, route.request().postDataJSON());
      await route.fulfill({ status: 200, json: family });
      return;
    }
    const body =
      path === '/api/session'
        ? { mode, signedIn: true, canSignIn: mode === 'Family' }
        : path === '/api/family'
          ? family
          : path === '/api/calendar'
            ? { calendars: [{ id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true }], events: [swim], changeNumber: 1, needsReconnect: false }
            : path === '/api/calendar/countdowns'
              ? []
              : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
}

test('a first demo visit is welcomed once, and the welcome stays closed', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'wall') await page.setViewportSize({ width: 1280, height: 800 });
  await stub(page);
  await page.goto('/');
  const welcome = page.getByRole('region', { name: 'Meet the Marlowes' });
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole('link', { name: /Open the wall display/ })).toHaveAttribute('href', '/wall');
  // Each look is a finger-sized swatch, and a tap puts it on the calendar behind the card.
  const looks = welcome.getByRole('group', { name: 'Try a look' });
  for (const button of await looks.getByRole('button').all()) {
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await expect(looks.getByRole('button', { name: 'Daylight' })).toHaveAttribute('aria-pressed', 'true');
  await looks.getByRole('button', { name: 'Groovy' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'groovy');
  await expect(looks.getByRole('button', { name: 'Groovy' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('welcome-groovy.png') });
  await looks.getByRole('button', { name: 'Daylight' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight');

  // On a desktop window, Show me plays a drag on a real event without saving it.
  if (testInfo.project.name === 'wall') {
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Week' }).click();
    await welcome.getByRole('button', { name: 'Show me' }).click();
    await expect(page.locator('.welcome-ghost')).toHaveCount(1);
    await page.waitForTimeout(900);
    await page.screenshot({ path: testInfo.outputPath('welcome-drag.png') });
    await expect(page.locator('.welcome-ghost')).toHaveCount(0, { timeout: 4000 });
  } else {
    await expect(welcome.getByRole('button', { name: 'Show me' })).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath('welcome.png') });

  // It steps aside while an event's details are open, so it never covers their buttons.
  await page.getByRole('button', { name: /Swim lesson/ }).first().click();
  await expect(welcome).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(welcome).toBeVisible();

  await welcome.getByRole('button', { name: 'Start exploring' }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(page.locator('app-calendar-home')).toContainText('Swim lesson');
  await expect(page.getByRole('region', { name: 'Meet the Marlowes' })).toHaveCount(0);
});

test('a family instance never shows the welcome', async ({ page }) => {
  await stub(page, 'Family');
  await page.goto('/');
  await expect(page.locator('app-calendar-home')).toContainText('Swim lesson');
  await expect(page.getByRole('region', { name: 'Meet the Marlowes' })).toHaveCount(0);
});

test('the wall never shows the welcome', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'the wall layout only');
  await stub(page);
  await page.goto('/wall');
  await expect(page.locator('app-wall-shell')).toContainText('Swim lesson');
  await expect(page.getByRole('region', { name: 'Meet the Marlowes' })).toHaveCount(0);
});
