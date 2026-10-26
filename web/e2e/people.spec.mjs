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
const calendars = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c2', name: 'Tess', memberId: 'm2', canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
];
// Monday October 12, in New York: haircuts 10 AM to noon on Ben's calendar, for Milo too.
const haircuts = {
  id: 'haircuts', calendarId: 'c1', memberId: 'm1', memberIds: ['m3'], title: 'Haircuts', location: null, allDay: false,
  startsAt: '2026-10-12T14:00:00Z', endsAt: '2026-10-12T16:00:00Z', startDate: null, endDate: null,
  recurring: false, seriesId: null, creationId: null,
};
const swim = {
  ...haircuts, id: 'swim', calendarId: 'c2', memberId: 'm2', memberIds: [], title: 'Swim',
  startsAt: '2026-10-12T21:30:00Z', endsAt: '2026-10-12T22:15:00Z',
};

/** The family above with its live connection down; a change to an event is held and recorded. */
async function stub(page) {
  const writes = [];
  await page.clock.install({ time: new Date('2026-10-12T13:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/calendar/events/')) {
      writes.push({ route, body: route.request().postDataJSON() });
      return;
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events: [haircuts, swim], changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  return writes;
}

test('an event for two people names both, shows in each one’s day and takes another person by touch', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const writes = await stub(page);
  await page.goto(wall ? '/wall' : '/');

  if (wall) {
    const block = page.locator('app-week-view .event', { hasText: 'Haircuts' });
    await expect(block.locator('.mark')).toHaveCount(2);
    await expect(block).toHaveAttribute('aria-label', /Ben and Milo/);
    await page.screenshot({ path: testInfo.outputPath('week.png') });
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Day' }).click();
    await expect(page.locator('app-day-view button.event', { hasText: 'Haircuts' })).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('day.png') });
    await page.locator('app-day-view button.event', { hasText: 'Haircuts' }).first().click();
  } else {
    await page.locator('app-agenda-list li.event button', { hasText: 'Haircuts' }).click();
  }

  const details = page.getByRole('dialog', { name: 'Haircuts' });
  await expect(details).toContainText('Ben and Milo');
  await page.screenshot({ path: testInfo.outputPath('details.png') });
  await details.getByRole('button', { name: 'Edit event', exact: true }).click();

  const editor = page.locator(wall ? 'app-event-dialog form' : 'app-event-sheet form');
  const who = editor.getByRole('group', { name: wall ? 'WHO' : 'Who' });
  await expect(who.getByRole('button', { name: 'Ben, owner of the calendar' })).toBeDisabled();
  await expect(who.getByRole('button', { name: 'Milo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await who.getByRole('button', { name: 'Tess', exact: true }).click();
  await expect(who.getByRole('button', { name: 'Tess', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const button of await who.getByRole('button').all()) {
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(wall ? 56 : 44);
  }
  await who.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('editor.png') });

  await editor.getByRole('button', { name: wall ? 'Save changes' : 'Save', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.memberIds).toEqual(['m3', 'm2']);
  await writes[0].route.fulfill({ status: 200, json: { ...haircuts, memberIds: ['m3', 'm2'] } });
});
