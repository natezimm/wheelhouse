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
// Monday October 12, in New York: a private dinner 7-9 PM on Ben's calendar.
const dinner = {
  id: 'dinner', calendarId: 'c1', memberId: 'm1', memberIds: [], title: 'Anniversary dinner', location: 'Le Petit Jardin', allDay: false,
  startsAt: '2026-10-12T23:00:00Z', endsAt: '2026-10-13T01:00:00Z', startDate: null, endDate: null,
  recurring: false, seriesId: null, creationId: null, description: 'Babysitter until 10', private: true,
};
const swim = {
  ...dinner, id: 'swim', calendarId: 'c3', memberId: 'm3', title: 'Swim', location: null, description: null, private: false,
  startsAt: '2026-10-12T21:30:00Z', endsAt: '2026-10-12T22:15:00Z',
};
const busy = { ...dinner, title: 'Busy', location: null, description: null, hidden: true };

/** The family above, seen by a paired display or by a parent; a change to an event is held and recorded. */
async function stub(page, display) {
  const writes = [];
  await page.clock.install({ time: new Date('2026-10-12T15:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/calendar/events/')) {
      writes.push({ route, body: route.request().postDataJSON() });
      return;
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false, isDisplay: display }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events: [display ? busy : dinner, swim], changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  return writes;
}

test('a display shows a private event only as busy and offers no way to change it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'A paired display is a wall.');
  await stub(page, true);
  await page.goto('/wall');
  await expect(page.locator('app-week-view')).not.toContainText('Anniversary dinner');
  await page.locator('app-week-view .event', { hasText: 'Busy' }).click();
  const details = page.getByRole('dialog', { name: 'Busy' });
  await expect(details).toContainText('Private event');
  await expect(details).not.toContainText('Le Petit Jardin');
  await expect(details.getByRole('button', { name: 'Edit event' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('display-details.png') });
});

test('a parent sees a private event in full and can make another one private', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const writes = await stub(page, false);
  await page.goto(wall ? '/wall' : '/');
  const open = (title) => (wall
    ? page.locator('app-week-view .event', { hasText: title })
    : page.locator('app-agenda-list li.event button', { hasText: title })).click();

  await open('Anniversary dinner');
  const details = page.getByRole('dialog', { name: 'Anniversary dinner' });
  await expect(details).toContainText('wall displays show it as busy');
  await page.screenshot({ path: testInfo.outputPath('parent-details.png') });
  await details.getByRole('button', { name: 'Close', exact: true }).click();

  await open('Swim');
  await page.getByRole('dialog', { name: 'Swim' }).getByRole('button', { name: 'Edit event', exact: true }).click();
  const editor = page.locator(wall ? 'app-event-dialog form' : 'app-event-sheet form');
  const box = editor.getByRole('checkbox', { name: /Private/ });
  await box.check();
  await page.screenshot({ path: testInfo.outputPath('editor.png') });
  await editor.getByRole('button', { name: wall ? 'Save changes' : 'Save', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.private).toBe(true);
  await writes[0].route.fulfill({ status: 200, json: { ...swim, private: true } });
});
