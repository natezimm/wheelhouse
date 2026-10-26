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
// Monday October 12, in New York: swim 5:30-6:15 PM, with notes.
const swim = {
  id: 'swim', calendarId: 'c3', memberId: 'm3', memberIds: [], title: 'Swim lesson', location: 'Rec Center', allDay: false,
  startsAt: '2026-10-12T21:30:00Z', endsAt: '2026-10-12T22:15:00Z', startDate: null, endDate: null,
  recurring: false, seriesId: null, creationId: null, description: 'Bring goggles', private: false,
};

/** A family whose calendar keeps what the screens write, as the demo does. */
async function stub(page) {
  let events = [swim];
  let changeNumber = 1;
  const writes = [];
  await page.clock.install({ time: new Date('2026-10-12T15:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/calendar/events')) {
      const body = request.postDataJSON();
      writes.push({ method: request.method(), body });
      changeNumber++;
      if (request.method() === 'DELETE') {
        events = events.filter((e) => !url.pathname.endsWith(e.id));
        return route.fulfill({ status: 204 });
      }
      const back = { ...swim, id: 'swim-again', creationId: body.creationId ?? null, title: body.title, location: body.location, description: body.description || null };
      events = [...events, back];
      return route.fulfill({ status: 201, json: back });
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events, changeNumber, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  return writes;
}

test('a deleted event comes back with Undo', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const writes = await stub(page);
  await page.goto(wall ? '/wall' : '/');
  const event = (title) => wall
    ? page.locator('app-week-view .event', { hasText: title })
    : page.locator('app-agenda-list li.event button', { hasText: title });

  await event('Swim lesson').click();
  await page.getByRole('dialog', { name: 'Swim lesson' }).getByRole('button', { name: 'Delete', exact: true }).click();
  const editor = page.locator(wall ? 'app-event-dialog form' : 'app-event-sheet form');
  await editor.getByRole('button', { name: 'Delete event', exact: true }).click();
  await expect(event('Swim lesson')).toHaveCount(0);

  const toast = page.locator('app-calendar-save-status').getByRole('status');
  await expect(toast).toContainText('Event deleted');
  const undo = toast.getByRole('button', { name: 'Undo' });
  expect((await undo.boundingBox()).height).toBeGreaterThanOrEqual(wall ? 56 : 44);
  await page.screenshot({ path: testInfo.outputPath('undo.png') });
  await undo.click();

  await expect(event('Swim lesson')).toHaveCount(1);
  const post = writes.find((w) => w.method === 'POST');
  expect(post.body).toMatchObject({ title: 'Swim lesson', location: 'Rec Center', description: 'Bring goggles', startTime: '17:30:00', endTime: '18:15:00' });
  await expect(page.locator('app-calendar-save-status')).not.toContainText('Event deleted');
});
