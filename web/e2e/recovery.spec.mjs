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
  members: [
    { id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
};
const calendars = family.members.map((m) => ({
  id: 'c' + m.id,
  name: m.displayName,
  memberId: m.id,
  canWrite: true,
}));

async function serverFor(page) {
  const server = {
    online: true,
    revision: 1,
    fail: false,
    hold: false,
    held: null,
    socket: null,
    range: '',
    googleRequests: 0,
  };
  const snapshot = () => ({
    calendars,
    changeNumber: server.revision,
    needsReconnect: true,
    events: [
      {
        id: 'today',
        calendarId: 'cm3',
        memberId: 'm3',
        title: 'Swim lesson',
        location: null,
        allDay: false,
        startsAt: '2026-10-12T21:30:00Z',
        endsAt: '2026-10-12T22:15:00Z',
        startDate: null,
        endDate: null,
        recurring: false,
      },
      {
        id: 'tomorrow',
        calendarId: 'cm3',
        memberId: 'm3',
        title: server.revision === 1 ? 'Piano' : 'Updated from server',
        location: null,
        allDay: true,
        startDate: '2026-10-13',
        endDate: '2026-10-14',
        startsAt: null,
        endsAt: null,
        recurring: false,
      },
    ],
  });
  await page.clock.install({ time: new Date('2026-10-12T21:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/google')) server.googleRequests++;
    if (url.pathname === '/api/calendar') {
      server.range = url.search;
      if (server.hold) {
        server.hold = false;
        server.held = route;
        return;
      }
      if (server.fail) {
        await route.fulfill({ status: 503, body: 'Offline' });
        return;
      }
      await route.fulfill({ json: snapshot() });
      return;
    }
    await route.fulfill({
      json:
        url.pathname === '/api/session'
          ? { mode: 'Demo', signedIn: true, canSignIn: false }
          : url.pathname === '/api/family'
            ? family
            : {},
    });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/calendar/negotiate*', (route) =>
    server.online
      ? route.fulfill({
          json: {
            negotiateVersion: 1,
            connectionId: 'connection',
            connectionToken: 'token',
            availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text'] }],
          },
        })
      : route.fulfill({ status: 503, body: 'Offline' }),
  );
  await page.routeWebSocket('**/hubs/calendar*', (socket) => {
    server.socket = socket;
    socket.onMessage((message) => {
      if (String(message).includes('"protocol"')) {
        socket.send('{}\x1e');
        socket.send(
          JSON.stringify({
            type: 1,
            target: 'CalendarChanged',
            arguments: [{ changeNumber: server.revision }],
          }) + '\x1e',
        );
      }
    });
  });
  return server;
}

test('recovery preserves calendar view, filters and an open draft', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const server = await serverFor(page);
  await page.goto(wall ? '/wall' : '/calendar');
  const controls = page.locator('app-calendar-connection');
  const live = controls.locator('.state').first();
  const reconnecting = controls.locator('.pill.reconnecting');
  await expect(live).toHaveText('Live');
  if (wall) {
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page.getByRole('button', { name: 'Next day', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Tuesday, October 13', exact: true }).click();
  }
  const ben = page
    .getByRole('group', { name: 'Show calendars for' })
    .getByRole('button', { name: 'Ben', exact: true });
  await ben.click();
  await expect(ben).toHaveAttribute('aria-pressed', 'false');
  const heading = page.locator(wall ? 'app-calendar-toolbar h1' : 'app-calendar-home main > header h1');
  const selected = await heading.textContent();
  if (wall) await expect(controls.getByRole('button', { name: 'Resync now', exact: true })).toBeEnabled();
  const range = server.range;

  server.online = false;
  server.socket.close({ code: 1011, reason: 'Connection lost' });
  await expect(reconnecting).toContainText('Reconnecting · showing');
  // Upstream Google reauthorization remains a different notice from the dropped live socket.
  await expect(controls.locator('.reconnect')).toContainText('Google Calendar needs reconnecting');
  server.fail = true;
  server.hold = true;
  await controls.getByRole('button', { name: 'Resync now', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Resyncing…', exact: true })).toBeDisabled();
  await expect.poll(() => !!server.held).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('resyncing.png'), fullPage: true });
  await server.held.fulfill({ status: 503, body: 'Offline' });
  await expect(controls.locator('.failure')).toContainText("Couldn't refresh · showing");
  await expect(heading).toHaveText(selected);
  await expect(ben).toHaveAttribute('aria-pressed', 'false');
  const tryAgain = controls.getByRole('button', { name: 'Try again', exact: true });
  const bounds = await tryAgain.boundingBox();
  expect(bounds.height).toBeGreaterThanOrEqual(wall ? 56 : 44);
  await page.screenshot({ path: testInfo.outputPath('failed.png'), fullPage: true });

  server.fail = false;
  server.online = true;
  server.revision = 2;
  await tryAgain.click();
  await expect(live).toHaveText('Live');
  if (wall) await expect(controls.getByRole('button', { name: 'Resync now', exact: true })).toBeEnabled();
  await expect(controls.locator('.failure')).toHaveCount(0);
  await expect(heading).toHaveText(selected);
  await expect(ben).toHaveAttribute('aria-pressed', 'false');
  expect(server.range).toBe(range);
  await expect(page.getByText('Updated from server', { exact: true })).toBeVisible();
  if (wall)
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('recovered.png'), fullPage: true });

  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  const editor = page.locator(wall ? 'app-event-dialog' : 'app-event-sheet');
  const title = editor.locator('input[type=text]').first();
  await title.fill('Keep this draft');
  server.online = false;
  server.socket.close({ code: 1011, reason: 'Connection lost with an open draft' });
  await expect(reconnecting).toContainText('Reconnecting');
  server.online = true;
  server.revision = 3;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(live).toHaveText('Live');
  await expect(title).toHaveValue('Keep this draft');
  await expect(heading).toHaveText(selected);
  await expect(ben).toHaveAttribute('aria-pressed', 'false');
  expect(server.googleRequests).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('draft-preserved.png'), fullPage: true });
});

test('the phone day offers the same recovery controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The day opens first on the phone layout.');
  const server = await serverFor(page);
  await page.goto('/');
  const controls = page.locator('app-calendar-connection');
  await expect(controls.locator('.state').first()).toHaveText('Live');
  server.online = false;
  server.socket.close({ code: 1011, reason: 'Connection lost' });
  await expect(controls.locator('.pill.reconnecting')).toContainText('Reconnecting');
  server.online = true;
  await controls.getByRole('button', { name: 'Resync now', exact: true }).click();
  await expect(controls.locator('.state').first()).toHaveText('Live');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(server.googleRequests).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('day-recovery.png'), fullPage: true });
});
