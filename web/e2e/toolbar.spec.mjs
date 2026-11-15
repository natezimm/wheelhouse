import { test, expect } from '@playwright/test';

const members = ['Ben', 'Milo', 'Priya', 'Sam', 'Juniper'].map((name, i) => ({
  id: `m${i}`, displayName: name, initial: name[0], role: i < 2 ? 'Parent' : 'Kid',
  color: ['#137A6D', '#2B4C9B', '#A23B72', '#B5651D', '#5B3FA0'][i],
}));
const family = {
  id: 'family', name: 'The Marlowes', timeZone: 'America/New_York', weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00', nightModeTo: '06:00:00', units: 'Imperial', latitude: null, longitude: null, members,
};
const calendars = members.map((member, i) => ({ id: `c${i}`, name: member.displayName, memberId: member.id, canWrite: true }));

/** A family of five with its live connection up, so the toolbar shows what it does on a good day. */
async function stub(page, now) {
  await page.clock.install({ time: new Date(now) });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      json:
        path === '/api/session'
          ? { mode: 'Demo', signedIn: true, canSignIn: false }
          : path === '/api/family'
            ? family
            : path === '/api/calendar'
              ? { calendars, events: [], changeNumber: 1, needsReconnect: false }
              : {},
    });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/calendar/negotiate*', (route) =>
    route.fulfill({ json: { negotiateVersion: 1, connectionId: 'c', connectionToken: 't', availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text'] }] } }),
  );
  await page.routeWebSocket('**/hubs/calendar*', (socket) => {
    socket.onMessage((message) => {
      if (String(message).includes('"protocol"')) {
        socket.send('{}\x1e');
        socket.send(JSON.stringify({ type: 1, target: 'CalendarChanged', arguments: [{ changeNumber: 1 }] }) + '\x1e');
      }
    });
  });
}

// A week inside one month, and one that crosses two months and so has the longest title there is.
for (const [week, now] of [['a week in one month', '2026-10-12T15:22:00Z'], ['a week across two months', '2026-11-30T15:22:00Z']]) {
  test(`a desktop window from 1024 px keeps the toolbar on one line in ${week}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'wall', 'the desktop window');
    await page.setViewportSize({ width: 1280, height: 800 });
    await stub(page, now);
    await page.goto('/');
    const toolbar = page.locator('app-calendar-toolbar');
    await expect(page.locator('app-calendar-connection .state').first()).toBeVisible();

    for (const width of [1024, 1100, 1180, 1181, 1240, 1241, 1280, 1319, 1320, 1366, 1439, 1440, 1600]) {
      await page.setViewportSize({ width, height: 800 });
      // One line of 44 px controls; a second line would make it about 100 px.
      await expect.poll(async () => (await toolbar.boundingBox()).height, { message: `${width} px` }).toBeLessThan(60);
      for (const control of [
        toolbar.getByRole('button', { name: 'Today', exact: true }),
        toolbar.getByRole('heading'),
        toolbar.getByRole('group', { name: 'View' }),
        toolbar.getByRole('button', { name: 'Add event' }),
      ]) {
        await expect(control, `${width} px`).toBeInViewport({ ratio: 1 });
      }
    }

    // A laptop keeps Add event's words; only the title is said briefly.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(toolbar.locator('.add .label')).toBeInViewport();
    // From 1320 px the year is in sight again.
    await page.setViewportSize({ width: 1366, height: 800 });
    await expect(toolbar.getByRole('heading')).toContainText('2026');
    expect((await toolbar.locator('.year').boundingBox()).width).toBeGreaterThan(20);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: testInfo.outputPath('toolbar-1280.png'), clip: { x: 0, y: 0, width: 1280, height: 140 } });
  });
}
