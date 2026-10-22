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
    { id: 'm2', displayName: 'Tess', initial: 'T', role: 'Parent', color: '#B85A14' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
};
const calendars = family.members.map((m, i) => ({
  id: 'c' + (i + 1),
  name: m.displayName,
  memberId: m.id,
  canWrite: true,
}));
const original = {
  id: 'event',
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
};

test('optimistic save, rollback and draft preservation', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-12T21:22:00Z') });
  let held;
  let stored;
  let posts = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/calendar/events' && route.request().method() === 'POST') {
      posts++;
      held = route;
      return;
    }
    const body =
      path === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : path === '/api/family'
          ? family
          : path === '/api/calendar'
            ? {
                calendars,
                events: stored ? [original, stored] : [original],
                changeNumber: stored ? 2 : 1,
                needsReconnect: false,
              }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  await page.goto(wall ? '/wall' : '/calendar');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  const editor = page.locator(wall ? 'app-event-dialog' : 'app-event-sheet');
  const title = editor.locator('input[type=text]').first();
  await title.fill('Optimistic QA event');
  const save = () =>
    editor.getByRole('button', { name: wall ? 'Save event' : 'Save', exact: true }).click();
  await save();
  await expect(page.locator('app-calendar-save-status')).toContainText('Saving calendar');
  const rendered = page
    .locator(wall ? 'app-week-view .title' : 'app-agenda-list .title')
    .filter({ hasText: 'Optimistic QA event' });
  await expect(rendered).toHaveCount(1);
  await expect(title).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('pending.png'), fullPage: true });
  await expect.poll(() => !!held).toBe(true);
  await held.fulfill({
    status: 400,
    json: { errors: { title: ['Please choose a different title.'] } },
  });
  await expect(editor.getByRole('alert')).toContainText('Please choose a different title');
  await expect(title).toHaveValue('Optimistic QA event');
  await expect(rendered).toHaveCount(0);
  await expect(title).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('refused.png'), fullPage: true });
  // A lost HTTP response can follow a successful commit. Check the snapshot without inserting again.
  await save();
  await expect.poll(() => posts).toBe(2);
  const request = held.request().postDataJSON();
  stored = {
    ...original,
    id: 'new-event',
    calendarId: request.calendarId,
    memberId: 'm1',
    title: request.title,
    location: null,
    startsAt: '2026-10-12T22:00:00Z',
    endsAt: '2026-10-12T23:00:00Z',
    creationId: request.creationId,
  };
  await held.abort('failed');
  await expect(editor.getByRole('button', { name: 'Check save', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Check save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(rendered).toHaveCount(1);
  expect(posts).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('reconciled.png'), fullPage: true });
});
