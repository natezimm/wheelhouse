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
  members: [
    { id: 'm2', displayName: 'Ivy', initial: 'I', role: 'Kid', color: '#B4387A' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
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

const piano = { ...swim, id: 'piano', calendarId: 'c2', memberId: 'm2', title: 'Piano', location: null, startsAt: '2026-10-12T19:00:00Z', endsAt: '2026-10-12T20:00:00Z' };

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
            ? {
                calendars: [
                  { id: 'c2', name: 'Ivy', memberId: 'm2', canWrite: true },
                  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
                ],
                events: [piano, swim],
                changeNumber: 1,
                needsReconnect: false,
              }
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
  for (const button of await welcome.getByRole('button').all()) {
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('welcome.png') });

  // It steps aside while an event's details are open, so it never covers their buttons.
  await page.getByRole('button', { name: /Swim lesson/ }).first().click();
  await expect(welcome).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(welcome).toBeVisible();

  await welcome.getByRole('button', { name: 'Explore on my own' }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(page.locator('app-calendar-home')).toContainText('Swim lesson');
  await expect(page.getByRole('region', { name: 'Meet the Marlowes' })).toHaveCount(0);
});

test('the tour lights up one part of the calendar at a time', async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === 'wall';
  if (desktop) await page.setViewportSize({ width: 1440, height: 900 });
  await stub(page);
  await page.goto('/');
  await page.getByRole('region', { name: 'Meet the Marlowes' }).getByRole('button', { name: /Take the tour/ }).click();
  const tour = page.getByRole('dialog');
  const hole = page.locator('app-demo-tour .hole');
  /** The light sits over the part named, once it has glided there. */
  const lights = async (part) => {
    await expect(async () => {
      const lit = await hole.boundingBox();
      const box = await part.boundingBox();
      expect(lit.x).toBeLessThanOrEqual(box.x + 1);
      expect(lit.y).toBeLessThanOrEqual(box.y + 1);
      expect(lit.x + lit.width).toBeGreaterThanOrEqual(box.x + box.width - 1);
      expect(lit.y + lit.height).toBeGreaterThanOrEqual(box.y + box.height - 1);
    }).toPass({ timeout: 3000 });
  };
  const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: testInfo.outputPath(`tour-${name}.png`) });
  };

  await expect(tour).toContainText('1 of 5');
  await expect(tour.getByRole('heading')).toHaveText('Three ways to see it');
  await expect(tour.getByRole('button', { name: 'Next' })).toBeFocused();
  await lights(page.getByRole('group', { name: 'View' }));
  await shot('1-views');

  await page.keyboard.press('ArrowRight');
  await expect(tour.getByRole('heading')).toHaveText('Everyone has a color');
  await lights(page.locator('main app-calendar-filter').first());
  await shot('2-people');

  await tour.getByRole('button', { name: 'Next' }).click();
  if (desktop) {
    await expect(tour.getByRole('heading')).toHaveText('Drag to move it');
    await expect(page.locator('.drag-ghost')).toHaveCount(1, { timeout: 3000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath('tour-3-drag.png') });
  } else {
    await expect(tour.getByRole('heading')).toHaveText('Tap for the details');
    await lights(page.locator('app-agenda-list li.event').first());
    await shot('3-details');
    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour.getByRole('heading')).toHaveText('Add one in seconds');
    await lights(page.getByRole('button', { name: 'Add event' }));
    await shot('4-add');
  }

  // Back goes back, and the calendar behind could not be clicked meanwhile.
  await tour.getByRole('button', { name: 'Back' }).click();
  await expect(tour.getByRole('heading')).not.toHaveText('Make it yours');
  await tour.getByRole('button', { name: 'Next' }).click();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByRole('heading')).toHaveText('Make it yours');
  await tour.getByRole('button', { name: 'Bold' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'bold');
  await shot(desktop ? '4-looks' : '5-looks');
  await tour.getByRole('button', { name: 'Daylight' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight');

  if (desktop) {
    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour.getByRole('heading')).toHaveText('And on the kitchen wall');
    await expect(tour.getByRole('link', { name: 'Open the wall' })).toHaveAttribute('href', '/wall');
    await shot('5-wall');
    // On a short screen, such as a phone on its side, the card scrolls rather than losing its buttons.
    await page.setViewportSize({ width: 844, height: 390 });
    const open = tour.getByRole('link', { name: 'Open the wall' });
    // The card glides to its new place after the resize, so measure once it has settled.
    await expect(async () => {
      await open.scrollIntoViewIfNeeded();
      const box = await open.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(390);
    }).toPass({ timeout: 3000 });
    await expect(open).toBeInViewport();
  } else {
    await expect(tour.getByRole('button', { name: 'Done' })).toBeVisible();
  }
  await expect(page.locator('.drag-ghost')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
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
