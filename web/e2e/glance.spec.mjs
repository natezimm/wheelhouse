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

/** Waits for the glance to finish fading in. */
const settled = (glance) => glance.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

async function stub(page, time) {
  await page.clock.install({ time: new Date(time) });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events, changeNumber: 1, needsReconnect: false }
            : url.pathname === '/api/calendar/countdowns'
              ? countdowns
              : url.pathname === '/api/weather'
                ? weather
                : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto('/wall');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'The glance is the wall’s.');
});

test('left alone, the wall shows today at a glance, and a touch brings the calendar back', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // 4:40 pm: the dentist is over and swim is under way.
  await stub(page, '2026-10-12T20:40:00Z');
  await expect(page.locator('app-week-view button.event', { hasText: 'Dentist' })).toBeVisible();

  await page.clock.runFor(10 * 60_000);
  const glance = page.getByRole('dialog', { name: 'Today at a glance' });
  await expect(glance).toBeVisible();
  await expect(glance.getByRole('heading')).toHaveText('Still to come today');
  await expect(glance.locator('.events li .title')).toHaveText(['Trash & recycling', 'Swim lesson', 'Dinner with the Okafors', 'Book club']);
  await expect(glance.locator('.underway')).toContainText('Now');
  await expect(glance.getByRole('list', { name: 'The next few days' }).getByRole('listitem')).toHaveCount(4);
  await expect(glance.getByRole('list', { name: 'Counting down to' }).getByRole('listitem')).toHaveCount(2);
  // Everything fits the screen without scrolling.
  const box = await glance.locator('.glance').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(1080);
  await settled(glance);
  await page.screenshot({ path: testInfo.outputPath('glance.png') });

  await page.mouse.click(960, 540);
  await expect(glance).toBeHidden();
  await expect(page.locator('app-week-view button.event', { hasText: 'Dentist' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('at night the glance is dark and dim, with only the clock and what is next', async ({ page }, testInfo) => {
  // 11:15 pm: today is done, so it looks to tomorrow's piano.
  await stub(page, '2026-10-13T03:15:00Z');
  await page.getByRole('button', { name: 'Show today at a glance' }).click();
  const glance = page.getByRole('dialog', { name: 'Today at a glance' });
  await expect(glance).toHaveAttribute('data-night', '');
  await expect(glance.getByRole('heading')).toHaveText('Tomorrow');
  await expect(glance.locator('.events li .title')).toHaveText(['Piano']);
  await expect(glance.getByRole('list', { name: 'The next few days' })).toHaveCount(0);
  await settled(glance);
  await page.screenshot({ path: testInfo.outputPath('glance-night.png') });

  await page.keyboard.press('Escape');
  await expect(glance).toBeHidden();
});
