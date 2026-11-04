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
const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((date, i) => ({
  date,
  description: i === 2 ? 'Rain' : i === 3 ? 'Partly cloudy' : 'Clear',
  icon: i === 2 ? 'Rain' : i === 3 ? 'PartlyCloudy' : 'Sun',
  high: 64 - i,
  low: 47 - i,
}));
const weather = { temperature: 61, description: 'Clear', icon: 'Sun', high: 64, low: 47, unit: 'F', days };



/** Stands in for the browser's push service, which a headless browser cannot reach. */
function fakePush() {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e';
  const subscription = {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'BKeyFromTheBrowser', auth: 'secret' } }),
    unsubscribe: async () => {
      window.__subscription = null;
      return true;
    },
  };
  window.__subscription = null;
  PushManager.prototype.getSubscription = async () => window.__subscription;
  PushManager.prototype.subscribe = async (options) => {
    window.__serverKey = new Uint8Array(options.applicationServerKey).length;
    return (window.__subscription = subscription);
  };
}

async function stub(page, saved) {
  await page.clock.install({ time: new Date('2026-10-12T20:40:00Z') });
  await page.context().grantPermissions(['notifications']);
  await page.addInitScript(fakePush);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/reminders')) {
      saved.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
      const key = 'B' + 'A'.repeat(86);
      if (url.pathname === '/api/reminders/key') return route.fulfill({ json: { publicKey: key } });
      if (url.pathname === '/api/reminders') return route.fulfill({ json: { leadMinutes: request.postDataJSON().leadMinutes, memberIds: request.postDataJSON().memberIds } });
      return route.fulfill({ status: 204 });
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Family', signedIn: true, canSignIn: true }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/devices'
            ? []
            : url.pathname === '/api/calendar/google'
              ? { canConnect: true, email: null, status: null }
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
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Reminders are set from the phone.');
});

test('a phone turns reminders on from Settings, sends itself a test and turns them off', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const saved = [];
  await stub(page, saved);
  await page.goto('/settings');

  const card = page.locator('app-reminder-settings');
  await expect(card.getByText('Get a notification on this phone before events start.')).toBeVisible();
  await card.getByRole('combobox', { name: 'How early' }).selectOption('30');
  await card.getByRole('button', { name: 'Milo' }).click();
  await expect(card.getByRole('button', { name: 'Milo' })).toHaveAttribute('aria-pressed', 'false');
  for (const chip of await card.locator('.person').all()) expect((await chip.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await card.getByRole('button', { name: 'Turn on reminders' }).click();

  await expect(card.getByText('This phone is reminded 30 min before events start.')).toBeVisible();
  await expect(card.getByRole('status')).toHaveText('Reminders are on. Send a test to see one.');
  expect(await page.evaluate(() => window.__serverKey)).toBe(65);
  expect(saved.find((s) => s.path === '/api/reminders').body).toEqual({
    endpoint: 'https://fcm.googleapis.com/fcm/send/e2e',
    p256dh: 'BKeyFromTheBrowser',
    auth: 'secret',
    leadMinutes: 30,
    memberIds: ['m1', 'm2'],
  });
  // The service worker that shows the reminders is in charge of the page.
  expect(await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active?.scriptURL))).toMatch(/\/push-worker\.js$/);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: testInfo.outputPath('reminders-on.png') });

  await card.getByRole('button', { name: 'Send a test' }).click();
  await expect(card.getByRole('status')).toHaveText('Sent. It should show on this phone in a moment.');
  expect(saved.at(-1)).toEqual({ path: '/api/reminders/test', method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e' } });

  await card.getByRole('button', { name: 'Turn off' }).click();
  await expect(card.getByRole('button', { name: 'Turn on reminders' })).toBeVisible();
  expect(saved.at(-1).path).toBe('/api/reminders/remove');
  expect(await page.evaluate(() => window.__subscription)).toBeNull();
  expect(errors).toEqual([]);
});

test('a reminder shows as a notification, and tapping one opens its event on its day', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await stub(page, []);
  await page.goto('/settings');
  await page.locator('app-reminder-settings').getByRole('button', { name: 'Turn on reminders' }).click();
  await expect(page.getByText('This phone is reminded 15 min before events start.')).toBeVisible();

  // Deliver a push to the service worker as the push service would.
  const cdp = await page.context().newCDPSession(page);
  const registration = new Promise((resolve) =>
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const found = registrations.find((r) => r.scopeURL.endsWith('/') && !r.isDeleted);
      if (found) resolve(found.registrationId);
    }),
  );
  await cdp.send('ServiceWorker.enable');
  const message = { title: 'Piano', body: 'In 15 min · 10 am', url: '/?day=2026-10-13&event=piano', tag: 'piano' };
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(page.url()).origin,
    registrationId: await registration,
    data: JSON.stringify(message),
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((n) => n.map((x) => [x.title, x.body, x.data.url]))))
    .toEqual([['Piano', 'In 15 min · 10 am', '/?day=2026-10-13&event=piano']]);

  // The worker opens the reminder's address; the calendar shows the event on its day.
  await page.goto(message.url);
  await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('app-event-details').getByRole('heading', { name: 'Piano' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.screenshot({ path: testInfo.outputPath('reminder-opened.png') });
  expect(errors).toEqual([]);
});
