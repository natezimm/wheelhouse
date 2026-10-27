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
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
];
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

/** The family above at 3:22 PM on Monday October 12 in New York, with its live connection down. */
async function stub(page, layout) {
  const posts = [];
  await page.clock.install({ time: new Date('2026-10-12T19:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/calendar/events') {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, json: { ...swim, id: 'copy', startsAt: '2026-10-13T21:30:00Z', endsAt: '2026-10-13T22:15:00Z' } });
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events: [swim], changeNumber: 1, needsReconnect: false }
            : url.pathname === '/api/calendar/countdowns'
              ? []
              : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  if (layout === 'desktop') await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(layout === 'wall' ? '/wall' : '/');
  return posts;
}

for (const layout of ['wall', 'desktop', 'phone']) {
  test(`Duplicate sits beside Edit and Delete, finger-sized, on the ${layout}`, async ({ page }, testInfo) => {
    test.skip((testInfo.project.name === 'wall') !== (layout === 'wall'), 'one layout per project');
    const posts = await stub(page, layout);
    await page.getByRole('button', { name: /^Swim lesson/ }).first().click();
    const details = page.getByRole('dialog', { name: 'Swim lesson' });
    const buttons = ['Edit event', 'Duplicate', 'Delete'].map((name) => details.getByRole('button', { name, exact: true }));
    const panel = await details.boundingBox();
    for (const button of buttons) {
      const box = await button.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(layout === 'wall' ? 56 : 44);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
    }
    await page.screenshot({ path: testInfo.outputPath('details.png') });

    await buttons[1].click();
    const editor = page.getByRole('dialog', { name: 'New event' });
    await expect(editor.getByLabel('Title')).toHaveValue('Swim lesson');
    await editor.getByRole('button', { name: layout === 'phone' ? 'Save' : 'Save event', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ calendarId: 'c3', title: 'Swim lesson', location: 'Riverside Rec Center', startTime: '17:30:00' });
  });
}

test('a desktop window lists its shortcuts with ?', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'desktop only');
  await stub(page, 'desktop');
  await expect(page.locator('app-week-view')).toBeVisible();
  await page.keyboard.press('Shift+Slash');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toContainText('Go to today');
  await page.screenshot({ path: testInfo.outputPath('shortcuts.png') });
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await page.keyboard.press('m');
  await expect(page.locator('app-month-view')).toBeVisible();
});
