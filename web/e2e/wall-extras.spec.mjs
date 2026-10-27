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
  members: [
    { id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
};
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
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
// Monday October 12 at 5:22 PM in New York: swim starts in 8 minutes, piano tomorrow at 10.
const events = [
  event('swim', 'c3', 'm3', 'Swim lesson', '2026-10-12T21:30:00Z', '2026-10-12T22:15:00Z'),
  event('piano', 'c1', 'm1', 'Piano', '2026-10-13T14:00:00Z', '2026-10-13T15:00:00Z'),
];
const countdowns = [
  event('cabin', 'c1', null, 'Cabin weekend', null, null, { allDay: true, startDate: '2026-10-23', endDate: '2026-10-26', countdown: true }),
  event('party', 'c3', 'm3', 'Milo’s party', null, null, { allDay: true, startDate: '2026-11-14', endDate: '2026-11-15', countdown: true }),
];
const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((date, i) => ({
  date,
  description: i === 1 ? 'Rain' : 'Clear',
  icon: i === 1 ? 'Rain' : 'Sun',
  high: 60 + i,
  low: 45 + i,
}));
const weather = { temperature: 58, description: 'Clear', icon: 'Moon', high: 60, low: 45, unit: 'F', days };

/** The family above with its live connection down. Changes to events are held and recorded. */
async function stub(page, layout) {
  const writes = [];
  await page.clock.install({ time: new Date('2026-10-12T21:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/calendar/events/')) {
      writes.push({ route, path: url.pathname, body: route.request().postDataJSON() });
      return;
    }
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
  if (layout === 'desktop') await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(layout === 'wall' ? '/wall' : '/');
  return writes;
}

test('the week shows each day’s forecast, the wall rings an event about to start, and both count down', async ({ page }, testInfo) => {
  const layout = testInfo.project.name === 'wall' ? 'wall' : 'phone';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await stub(page, layout);

  const strip = page.getByRole('list', { name: 'Counting down to' });
  await expect(strip.getByRole('listitem')).toHaveCount(2);
  await expect(strip.getByRole('listitem').first()).toHaveAttribute('aria-label', 'Cabin weekend, in 11 days');
  await expect(strip).toContainText('Milo’s party');
  await expect(strip).toContainText('33 days');

  if (layout === 'wall') {
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    const swim = page.locator('app-week-view button.event', { hasText: 'Swim lesson' });
    await expect(swim).toHaveClass(/soon/);
    await expect(swim).toContainText('In 8 min');
    await expect(page.locator('app-week-view button.event', { hasText: 'Piano' })).not.toHaveClass(/soon/);
    await expect(page.locator('app-week-view').getByLabel('Rain, high 61°, low 46°')).toBeVisible();
    // The countdowns share the toolbar without pushing its buttons off the screen.
    // and give way to a connection problem's action rather than covering it.
    const resync = await page.getByRole('button', { name: 'Resync now' }).boundingBox();
    expect(resync.x + resync.width).toBeLessThanOrEqual((await strip.boundingBox()).x);
    expect((await page.getByRole('button', { name: 'Add event' }).boundingBox()).x + 10).toBeLessThan(1920);
    await page.screenshot({ path: testInfo.outputPath('week.png') });

    // The editor marks an event to count down to beside its other choices.
    await page.getByRole('button', { name: 'Add event' }).click();
    const countDown = page.getByRole('dialog').getByText('Count down');
    await expect(countDown).toBeVisible();
    expect((await countDown.boundingBox()).x + 10).toBeLessThan(1920);
    await page.screenshot({ path: testInfo.outputPath('editor.png') });
    await page.keyboard.press('Escape');
  } else {
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page.getByLabel('Rain, high 61°, low 46°')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('week.png') });
  }
  expect(errors).toEqual([]);
});

for (const layout of ['wall', 'desktop']) {
  test(`pulling an event’s bottom edge changes when it ends on the ${layout}`, async ({ page }, testInfo) => {
    test.skip((testInfo.project.name === 'wall') !== (layout === 'wall'), 'one layout per project');
    const writes = await stub(page, layout);
    if (layout === 'wall') await page.getByRole('button', { name: 'Week', exact: true }).click();
    const grid = page.locator('app-week-view app-hour-grid');
    const swim = grid.locator('button.event', { hasText: 'Swim lesson' });
    await swim.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const hour = parseFloat(await grid.evaluate((el) => getComputedStyle(el).getPropertyValue('--hour')));
    const edge = await swim.locator('.resize').boundingBox();
    const from = { x: edge.x + edge.width / 2, y: edge.y + edge.height / 2 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + hour * 0.75, { steps: 8 });
    const preview = page.locator('app-week-view .preview');
    await expect(preview).toContainText('5:30 PM – 7:00 PM');
    await page.screenshot({ path: testInfo.outputPath('resize.png') });
    await page.mouse.up();

    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].path).toBe('/api/calendar/events/swim');
    expect(writes[0].body).toMatchObject({ startDate: '2026-10-12', startTime: '17:30:00', endDate: '2026-10-12', endTime: '19:00:00' });
    // Pulling the edge never opens the details.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await writes[0].route.fulfill({ status: 200, json: { ...events[0], endsAt: '2026-10-12T23:00:00Z' } });

    // It cannot end before a quarter hour after it starts.
    const again = await swim.locator('.resize').boundingBox();
    await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
    await page.mouse.down();
    await page.mouse.move(again.x + again.width / 2, again.y - hour * 3, { steps: 8 });
    await expect(preview).toContainText('5:30 PM – 5:45 PM');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(writes.length).toBe(1);
  });
}
