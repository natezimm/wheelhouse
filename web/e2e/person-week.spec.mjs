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
    { id: 'm4', displayName: 'Josephine', initial: 'J', role: 'Kid', color: '#7C3AED' },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c2', name: 'Ada', memberId: 'm2', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
  { id: 'c4', name: 'Josephine', memberId: 'm4', canWrite: true },
  { id: 'cf', name: 'Family', memberId: null, canWrite: true },
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
  event('trash', 'cf', null, 'Trash & recycling', null, null, { allDay: true, startDate: '2026-10-12', endDate: '2026-10-13' }),
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


async function stub(page) {
  await page.clock.install({ time: new Date('2026-10-12T15:40:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Family', signedIn: true, canSignIn: false, isDisplay: true }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events, changeNumber: 1, needsReconnect: false }
            : url.pathname === '/api/calendar/countdowns'
              ? []
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

test('a chip on the wall shows that person’s week, and Everyone brings the rest back', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'The wall’s chips.');
  await stub(page);
  const chips = page.getByRole('group', { name: 'Show calendars for' });
  const titles = page.locator('app-week-view button.event .title');
  await expect(titles).toHaveCount(5);

  await chips.getByRole('button', { name: 'Milo' }).click();
  await expect(titles).toHaveText(['Swim lesson', 'Dinner with the Okafors', 'Piano']);
  const everyone = chips.getByRole('button', { name: 'Everyone' });
  await expect(everyone).toBeVisible();
  // Five chips and Everyone stay on one 56 px row in the header.
  expect((await everyone.boundingBox()).height).toBeGreaterThanOrEqual(56);
  expect((await chips.boundingBox()).height).toBeLessThanOrEqual(72);
  await page.screenshot({ path: testInfo.outputPath('milo-week.png') });

  await everyone.click();
  await expect(titles).toHaveCount(5);
  await expect(everyone).toBeHidden();
});
