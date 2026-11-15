import { test, expect } from '@playwright/test';

// A demo visitor's copy lasts a day and can make room for newer visitors. A tab left open past
// that used to say "This Wheelhouse is private." with no way on; now it checks in again and
// shows the visitor a fresh copy, on the phone, a desktop window and the wall alike.

const family = (id, name) => ({
  id,
  name,
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
});

const swim = (title) => ({
  id: `swim-${title}`,
  calendarId: 'c3',
  memberId: 'm3',
  title,
  location: null,
  allDay: false,
  startsAt: '2026-10-12T21:30:00Z',
  endsAt: '2026-10-12T22:15:00Z',
  startDate: null,
  endDate: null,
  recurring: false,
  seriesId: null,
  creationId: null,
});

/** A demo at 3:22 PM on Monday October 12 in New York whose visitor's copy is gone once `expired` is set. */
async function stub(page) {
  const state = { expired: false, visits: 0, copy: 'old' };
  await page.addInitScript(() => localStorage.setItem('wheelhouse.welcome.v1', 'seen'));
  await page.clock.install({ time: new Date('2026-10-12T19:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/demo/visit') {
      state.visits++;
      if (state.expired) {
        state.expired = false;
        state.copy = 'fresh';
      }
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === '/api/session') {
      await route.fulfill({ status: 200, json: { mode: 'Demo', signedIn: !state.expired, canSignIn: false } });
      return;
    }
    if (state.expired) {
      await route.fulfill({ status: 401 });
      return;
    }
    const body =
      path === '/api/family'
        ? family(state.copy, state.copy === 'old' ? 'The Old Copy' : 'The Fresh Copy')
        : path === '/api/calendar'
          ? {
              calendars: [{ id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true }],
              events: [swim(state.copy === 'old' ? 'Old swim' : 'Fresh swim')],
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
  return state;
}

for (const path of ['/', '/wall']) {
  test(`a demo visitor whose copy is gone gets a fresh one at ${path}`, async ({ page }, testInfo) => {
    if (path === '/wall' && testInfo.project.name !== 'wall') test.skip();
    const state = await stub(page);
    await page.goto(path);
    await expect(page.getByRole('button', { name: /Old swim/ }).first()).toBeVisible();

    state.expired = true;
    // The shared 30-second check finds the sign-in gone.
    await page.clock.runFor(31_000);

    await expect(page.getByRole('button', { name: /Fresh swim/ }).first()).toBeVisible();
    await expect(page.getByText('This Wheelhouse is private.')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Pair this display/i })).toHaveCount(0);
    expect(state.visits).toBe(2);
    await page.screenshot({ path: testInfo.outputPath('rejoined.png') });
  });
}
