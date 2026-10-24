import { test, expect } from '@playwright/test';

const family = {
  id: 'family',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00',
  nightModeTo: '06:00:00',
  theme: 'Daylight',
  nightMode: 'AtNight',
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
const events = [
  {
    id: 'swim',
    calendarId: 'c3',
    memberId: 'm3',
    title: 'Swim lesson',
    location: 'Pool',
    allDay: false,
    startsAt: '2026-10-12T21:30:00Z',
    endsAt: '2026-10-12T22:15:00Z',
    startDate: null,
    endDate: null,
    recurring: false,
    seriesId: null,
    creationId: null,
  },
];

/** A family whose theme the test can change, as a parent would on their phone, with the live connection down. */
async function stub(page, at, path) {
  const current = { ...family };
  await page.clock.install({ time: new Date(at) });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    const body =
      url === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url === '/api/family'
          ? current
          : url === '/api/calendar'
            ? { calendars, events, changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  // Fonts are not what these checks are about; the fallbacks keep them quick and offline.
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  return current;
}

const html = (page) => page.locator('html');
const ground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('a theme chosen on a phone reaches the wall without a reload', async ({ page }, info) => {
  test.skip(info.project.name !== 'wall', 'The wall is the screen nobody touches.');
  // 5:22 PM in New York: daytime.
  const current = await stub(page, '2026-10-12T21:22:00Z', '/wall');
  await expect(html(page)).toHaveAttribute('data-theme', 'daylight');
  await expect(html(page)).not.toHaveAttribute('data-night', '');
  await page.evaluate(() => (window.stillHere = true));

  current.theme = 'Groovy';
  await page.clock.runFor(31_000);

  await expect(html(page)).toHaveAttribute('data-theme', 'groovy');
  expect(await ground(page)).toBe('rgb(243, 231, 211)');
  const card = page.getByRole('region', { name: 'Calendar' });
  await expect(card).toHaveCSS('border-top-width', '2px');
  // The page never reloaded.
  expect(await page.evaluate(() => window.stillHere)).toBe(true);
});

test.describe('in a browser whose zone is not the family’s', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  test('Night mode turns on the theme’s dark look at the family’s night hours on its own clock, and off in the morning', async ({ page }) => {
    // 9:59:30 PM in New York, 10:59:30 AM in Tokyo.
    const current = await stub(page, '2026-10-13T01:59:30Z', '/');
    current.theme = 'Bold';
    await page.clock.runFor(31_000);
    await expect(html(page)).toHaveAttribute('data-theme', 'bold');
    await expect(html(page)).toHaveAttribute('data-night', '');
    // Bold's own dark look: its charcoal ground and its black outlines turned white.
    expect(await ground(page)).toBe('rgb(38, 38, 38)');
    await expect(page.locator('app-calendar-filter button').first()).toHaveCSS('border-top-color', 'rgb(245, 245, 240)');

    // 6:00 AM in New York.
    await page.clock.setSystemTime(new Date('2026-10-13T10:00:05Z'));
    await page.clock.runFor(2_000);
    await expect(html(page)).not.toHaveAttribute('data-night', '');
    expect(await ground(page)).toBe('rgb(239, 239, 230)');
  });
});

for (const [theme, nightMode] of ['Daylight', 'Groovy', 'Classic', 'Bold'].flatMap((t) => [[t, 'Off'], [t, 'Always']])) {
  test(`${theme}${nightMode === 'Always' ? ' at night' : ''} keeps every control finger-sized`, async ({ page }, info) => {
    const wall = info.project.name === 'wall';
    const current = await stub(page, '2026-10-12T21:22:00Z', wall ? '/wall' : '/');
    current.theme = theme;
    current.nightMode = nightMode;
    await page.clock.runFor(31_000);
    await expect(html(page)).toHaveAttribute('data-theme', theme.toLowerCase());
    if (nightMode === 'Always') await expect(html(page)).toHaveAttribute('data-night', '');

    const smallest = wall ? 56 : 44;
    const controls = wall
      ? page.locator('app-calendar-toolbar button, app-calendar-filter button')
      : page.locator('header button, .view-switch button, app-calendar-filter button');
    const sizes = await controls.evaluateAll((buttons) =>
      buttons.filter((b) => b.offsetParent).map((b) => [b.textContent.trim() || b.getAttribute('aria-label'), b.getBoundingClientRect().height]),
    );
    expect(sizes.length).toBeGreaterThan(4);
    for (const [name, height] of sizes) expect(height, `${name} in ${theme}`).toBeGreaterThanOrEqual(smallest);
  });
}
