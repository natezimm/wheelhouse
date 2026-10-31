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
  members: [{ id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' }],
};
const calendars = [{ id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true }];
// Monday October 12, in New York: swim 5:30-6:15 PM.
const swim = {
  id: 'swim', calendarId: 'c3', memberId: 'm3', title: 'Swim lesson', location: null, allDay: false,
  startsAt: '2026-10-12T21:30:00Z', endsAt: '2026-10-12T22:15:00Z', startDate: null, endDate: null,
  recurring: false, seriesId: null, creationId: null,
};

/** The family above with its live connection down; a change to an event is held and recorded. */
async function stub(page) {
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
        ? { mode: 'Demo', signedIn: true, canSignIn: false }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events: [swim], changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  return writes;
}

// The phone's sheet uses the browser's own time fields; this is the dialog the wall and a desktop window share.
for (const where of ['wall', 'desktop']) {
  test(`times can be typed in the ${where} editor as well as stepped`, async ({ page }, testInfo) => {
    test.skip((testInfo.project.name === 'wall') !== (where === 'wall'), 'one layout per project');
    if (where === 'desktop') {
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    const writes = await stub(page);
    await page.goto(where === 'wall' ? '/wall' : '/');
    await page.locator('app-week-view .event', { hasText: 'Swim lesson' }).click();
    await page.getByRole('dialog', { name: 'Swim lesson' }).getByRole('button', { name: 'Edit event', exact: true }).click();
    const editor = page.locator('app-event-dialog form');
    const start = editor.getByRole('textbox', { name: 'Start time' });
    const end = editor.getByRole('textbox', { name: /^End time/ });
    await expect(start).toHaveValue('5:30 PM');

    await start.fill('4pm');
    await start.press('Tab');
    await expect(start).toHaveValue('4:00 PM');
    await expect(end).toHaveValue('4:45 PM');
    await end.fill('5:30');
    await end.press('Enter');
    await expect(end).toHaveValue('5:30 PM');
    await editor.getByRole('button', { name: 'Start later', exact: true }).click();
    await expect(start).toHaveValue('4:15 PM');
    await expect(end).toHaveValue('5:45 PM');

    await start.fill('later');
    await start.press('Tab');
    await expect(start).toHaveValue('4:15 PM');
    await expect(editor.getByRole('alert')).toHaveText('Type a time such as 3:30 PM or 15:30.');
    await start.focus();
    await page.keyboard.press('ArrowDown');
    await expect(start).toHaveValue('4:00 PM');
    await expect(editor.getByRole('alert')).toHaveCount(0);
    // The widest times still fit their fields.
    await end.fill('11:45pm');
    await end.press('Tab');
    await expect(end).toHaveValue('11:45 PM');
    for (const field of [start, end]) {
      expect(await field.evaluate((input) => input.scrollWidth <= input.clientWidth)).toBe(true);
    }

    if (where === 'wall') {
      for (const name of ['Start earlier', 'Start later']) {
        expect((await editor.getByRole('button', { name, exact: true }).boundingBox()).width).toBeGreaterThanOrEqual(56);
      }
    }
    await editor.getByRole('group', { name: 'When' }).screenshot({ path: testInfo.outputPath(`${where}-times.png`) });
    await page.screenshot({ path: testInfo.outputPath(`${where}-editor.png`) });

    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body).toMatchObject({ startDate: '2026-10-12', startTime: '16:00:00', endDate: '2026-10-12', endTime: '23:45:00' });
  });
}
