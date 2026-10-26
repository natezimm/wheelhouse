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
// Monday October 12, in New York: swim 5:30-6:15 PM, once.
const swim = {
  id: 'swim', calendarId: 'c3', memberId: 'm3', title: 'Swim lesson', location: null, allDay: false,
  startsAt: '2026-10-12T21:30:00Z', endsAt: '2026-10-12T22:15:00Z', startDate: null, endDate: null,
  recurring: false, seriesId: null, creationId: null,
};
// Piano every Wednesday, 10-11 AM.
const piano = {
  ...swim, id: 'piano', calendarId: 'c1', memberId: 'm1', title: 'Piano',
  startsAt: '2026-10-14T14:00:00Z', endsAt: '2026-10-14T15:00:00Z',
  recurring: true, seriesId: 'piano-series', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=WE',
};

/** The family above with its live connection down; a change to an event is held and recorded. */
async function stub(page) {
  const writes = [];
  await page.clock.install({ time: new Date('2026-10-12T15:22:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/calendar/events/')) {
      writes.push({ route, query: url.search, body: route.request().postDataJSON() });
      return;
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events: [swim, piano], changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  return writes;
}

test('a custom repeat is set by touch, fits the screen and shows every event at once', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const writes = await stub(page);
  await page.goto(wall ? '/wall' : '/');
  await (wall
    ? page.locator('app-week-view .event', { hasText: 'Swim lesson' })
    : page.locator('app-agenda-list li.event button', { hasText: 'Swim lesson' })).click();
  await page.getByRole('dialog', { name: 'Swim lesson' }).getByRole('button', { name: 'Edit event', exact: true }).click();
  const editor = page.locator(wall ? 'app-event-dialog form' : 'app-event-sheet form');

  if (wall) {
    await editor.getByRole('button', { name: 'Custom', exact: true }).click();
  } else {
    await editor.getByLabel('Repeat', { exact: true }).selectOption('custom');
  }
  const custom = editor.getByRole('group', { name: 'Custom repeat' });
  await custom.getByRole('button', { name: 'More', exact: true }).click();
  await custom.getByRole('button', { name: 'Wednesday' }).click();
  await custom.getByRole('button', { name: 'After' }).click();

  await page.screenshot({ path: testInfo.outputPath('custom-repeat.png'), fullPage: true });
  // Every control is a comfortable touch target: 56 px on the wall, 44 px on the phone.
  const least = wall ? 56 : 44;
  for (const name of ['Fewer', 'More', 'Monday', 'Wednesday', 'After', 'More times', ...(wall ? ['weeks'] : [])]) {
    const box = await custom.getByRole('button', { name, exact: true }).boundingBox();
    expect(Math.min(box.width, box.height), name).toBeGreaterThanOrEqual(least);
  }
  if (wall) {
    expect((await editor.getByRole('button', { name: 'Weekly', exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(least);
    await expect(editor.locator('app-repeat-picker .said')).toHaveText('Every 2 weeks on Monday and Wednesday, 10 times');
    // The dialog stays on the screen, scrolling inside itself if it must.
    const box = await editor.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(1080);
  } else {
    await expect(editor.getByLabel('Repeat', { exact: true })).toHaveValue('custom');
    expect((await custom.getByLabel('Unit').boundingBox()).height).toBeGreaterThanOrEqual(least);
  }

  await editor.getByRole('button', { name: wall ? 'Save changes' : 'Save', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ recurrence: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10' });

  // While the save is held, the new series shows on the days its rule names.
  if (wall) {
    await expect(page.locator('app-week-view .event', { hasText: 'Swim lesson' })).toHaveCount(2);
  } else {
    await expect(page.locator('app-agenda-list li.event', { hasText: 'Swim lesson' }).first()).toBeVisible();
  }
});

test('this and following changes an event and every later one, with the repeat shown for them', async ({ page }, testInfo) => {
  const wall = testInfo.project.name === 'wall';
  const writes = await stub(page);
  await page.goto(wall ? '/wall' : '/');
  if (!wall) {
    await page.getByRole('button', { name: 'Wednesday, October 14' }).click();
  }
  await (wall
    ? page.locator('app-week-view .event', { hasText: 'Piano' })
    : page.locator('app-agenda-list li.event button', { hasText: 'Piano' })).click();
  await expect(page.getByRole('dialog', { name: 'Piano' })).toContainText('Every week on Wednesday');
  await page.getByRole('dialog', { name: 'Piano' }).getByRole('button', { name: 'Edit event', exact: true }).click();
  const editor = page.locator(wall ? 'app-event-dialog form' : 'app-event-sheet form');

  if (wall) {
    const choice = editor.getByRole('button', { name: 'This and following', exact: true });
    expect((await choice.boundingBox()).height).toBeGreaterThanOrEqual(56);
    await choice.click();
    await expect(editor.getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await editor.getByRole('button', { name: 'Start later', exact: true }).click();
  } else {
    await editor.getByLabel('Change').selectOption('following');
    await expect(editor.getByLabel('Repeat', { exact: true })).toHaveValue('weekly');
    await editor.locator('input[type="time"]').first().fill('10:15');
  }
  await page.screenshot({ path: testInfo.outputPath('this-and-following.png'), fullPage: true });

  await editor.getByRole('button', { name: wall ? 'Save changes' : 'Save', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].query).toBe('?following=true');
  expect(writes[0].body).toMatchObject({ startDate: '2026-10-14', startTime: '10:15:00' });
  expect(writes[0].body).not.toHaveProperty('recurrence');
});
