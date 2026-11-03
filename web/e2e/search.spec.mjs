import { test, expect } from '@playwright/test';

const family = {
  id: 'family',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00',
  nightModeTo: '06:00:00',
  units: 'Imperial',
  latitude: 41.9,
  longitude: -73.97,
  theme: 'Daylight',
  nightMode: 'AtNight',
  members: [
    { id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4' },
    { id: 'm2', displayName: 'Ada', initial: 'A', role: 'Parent', color: '#B3261E' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c2', name: 'Ada', memberId: 'm2', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
];
const event = (id, calendarId, memberId, title, startsAt, endsAt, extra = {}) => ({
  id,
  calendarId,
  memberId,
  title,
  location: null,
  allDay: false,
  startsAt,
  endsAt,
  startDate: null,
  endDate: null,
  recurring: false,
  seriesId: null,
  creationId: null,
  ...extra,
});
// Monday October 12 in New York.
const events = [
  event('trash', 'c1', null, 'Trash & recycling', null, null, { allDay: true, startDate: '2026-10-12', endDate: '2026-10-13' }),
  event('dentist', 'c1', 'm1', 'Dentist', '2026-10-12T19:00:00Z', '2026-10-12T20:00:00Z'),
  event('swim', 'c3', 'm3', 'Swim lesson', '2026-10-12T20:30:00Z', '2026-10-12T21:45:00Z'),
  event('dinner', 'c2', 'm2', 'Dinner with the Okafors', '2026-10-12T23:00:00Z', '2026-10-13T00:30:00Z', { memberIds: ['m1', 'm3'] }),
  event('book', 'c2', 'm2', 'Book club', '2026-10-13T00:30:00Z', '2026-10-13T02:00:00Z'),
  event('piano', 'c3', 'm3', 'Piano', '2026-10-13T14:00:00Z', '2026-10-13T15:00:00Z'),
];
const countdowns = [
  event('cabin', 'c1', null, 'Cabin weekend', null, null, { allDay: true, startDate: '2026-10-23', endDate: '2026-10-26', countdown: true }),
  event('party', 'c3', 'm3', 'Milo’s party', null, null, { allDay: true, startDate: '2026-11-14', endDate: '2026-11-15', countdown: true }),
];
const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((date, i) => ({
  date,
  description: i === 2 ? 'Rain' : i === 3 ? 'Partly cloudy' : 'Clear',
  icon: i === 2 ? 'Rain' : i === 3 ? 'PartlyCloudy' : 'Sun',
  high: 64 - i,
  low: 47 - i,
}));
const weather = { temperature: 61, description: 'Clear', icon: 'Sun', high: 64, low: 47, unit: 'F', days };


const found = [
  event('swim2', 'c3', 'm3', 'Swim lesson', '2026-10-14T20:30:00Z', '2026-10-14T21:45:00Z', { recurring: true, location: 'Riverside Rec Center' }),
  event('swimmeet', 'c3', 'm3', 'Swim meet', null, null, { allDay: true, startDate: '2026-10-24', endDate: '2026-10-25', location: 'Westfield High pool' }),
  event('swimsuit', 'c2', 'm2', 'Buy Milo a swimsuit', '2026-09-30T22:00:00Z', '2026-09-30T22:30:00Z'),
];

async function stub(page, layout) {
  await page.clock.install({ time: new Date('2026-10-12T20:40:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Family', signedIn: true, canSignIn: true }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar/search'
            ? url.searchParams.get('q').toLowerCase().startsWith('swim') ? { events: found, total: 3 } : { events: [], total: 0 }
            : url.pathname === '/api/calendar'
              ? { calendars, events: [...events, ...(url.searchParams.get('from') <= '2026-10-14' && url.searchParams.get('to') > '2026-10-14' ? [found[0]] : [])], changeNumber: 1, needsReconnect: false }
              : url.pathname === '/api/calendar/countdowns'
                ? []
                : url.pathname === '/api/weather'
                  ? weather
                  : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  if (layout === 'desktop') await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
}

for (const layout of ['phone', 'desktop']) {
  test(`search finds events and opens one on its day on the ${layout}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'Search is on the phone and the desktop, not the wall.');
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await stub(page, layout);

    if (layout === 'desktop') {
      await expect(page.locator('app-week-view')).toBeVisible();
      await page.keyboard.press('/');
    } else {
      // Search and Settings fit beside the view switch on the narrowest phone.
      await page.setViewportSize({ width: 320, height: 640 });
      await expect(page.getByRole('button', { name: 'Month', exact: true })).toBeVisible();
      const settings = await page.getByRole('link', { name: 'Settings' }).boundingBox();
      expect(settings.x + settings.width).toBeLessThanOrEqual(320 - 16);
      await page.locator('.switch-bar').screenshot({ path: testInfo.outputPath('switch-320.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      const open = page.getByRole('button', { name: 'Search events' });
      expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await open.click();
    }
    const search = page.getByRole('dialog', { name: 'Search events' });
    await expect(search.getByRole('searchbox')).toBeFocused();
    await page.keyboard.type('swim');
    await expect(search.getByRole('heading')).toHaveText(['Coming up', 'Earlier']);
    await expect(search.locator('.row .title')).toHaveText(['Swim lesson', 'Swim meet', 'Buy Milo a swimsuit']);
    await expect(search.locator('.row').first()).toContainText('Repeats');
    for (const row of await search.locator('.row').all()) expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`search-${layout}.png`) });

    await search.locator('.row').first().click();
    await expect(search).toBeHidden();
    const details = page.locator('app-event-details');
    await expect(details.getByRole('heading', { name: 'Swim lesson' })).toBeVisible();
    if (layout === 'phone') await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Nothing found says so.
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    if (layout === 'desktop') await page.keyboard.press('/');
    else await page.getByRole('button', { name: 'Search events' }).click();
    await expect(search.getByRole('searchbox')).toBeFocused();
    await page.keyboard.type('zzz');
    await expect(search.getByRole('status')).toHaveText('No events match “zzz”.');
    await page.keyboard.press('Escape');
    await expect(search).toBeHidden();
    expect(errors).toEqual([]);
  });
}
