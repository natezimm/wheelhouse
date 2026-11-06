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

/** Scrolls one of a time's wheels to a row, as a finger or a mouse wheel does, and waits for it to settle. */
async function turn(wheel, label) {
  await wheel.getByRole('option', { name: label, exact: true }).evaluate((option) => {
    option.parentElement.scrollTo({ top: option.offsetTop - option.parentElement.clientHeight / 2 + option.offsetHeight / 2 });
  });
  await expect(wheel.getByRole('option', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
}

// The phone's sheet uses the browser's own pickers; this is the dialog the wall and a desktop window share.
for (const where of ['wall', 'desktop']) {
  test(`the ${where} editor picks days on a calendar and times on wheels, with nothing to type`, async ({ page }, testInfo) => {
    test.skip((testInfo.project.name === 'wall') !== (where === 'wall'), 'one layout per project');
    if (where === 'desktop') {
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    const writes = await stub(page);
    await page.goto(where === 'wall' ? '/wall' : '/');
    await page.locator('app-week-view .event', { hasText: 'Swim lesson' }).click();
    await page.getByRole('dialog', { name: 'Swim lesson' }).getByRole('button', { name: 'Edit event', exact: true }).click();
    const editor = page.locator('app-event-dialog [role=dialog]').first();
    await expect(editor.getByRole('textbox')).toHaveCount(3); // the title, place and notes: nothing for days or times
    const start = editor.getByRole('button', { name: /^Start time, / });
    const end = editor.getByRole('button', { name: /^End time/ });
    await expect(start).toHaveText('5:30 pm');

    // The day opens a month calendar, which picks a day and closes.
    await editor.getByRole('button', { name: 'Day, Monday, October 12, 2026' }).click();
    const month = page.getByRole('dialog', { name: 'Day', exact: true });
    await expect(month.getByRole('grid', { name: 'October 2026' })).toBeVisible();
    await expect(month.getByRole('button', { name: 'Monday, October 12, 2026' })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`${where}-calendar.png`) });
    await month.getByRole('button', { name: 'Wednesday, October 14, 2026' }).click();
    await expect(month).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Day, Wednesday, October 14, 2026' })).toHaveText('Wed, Oct 14');
    // And by keyboard: an arrow moves a day, Enter takes it.
    await editor.getByRole('button', { name: /^Day, / }).click();
    await expect(month.getByRole('button', { name: 'Wednesday, October 14, 2026' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(month.getByRole('button', { name: 'Tuesday, October 13, 2026' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(editor.getByRole('button', { name: /^Day, / })).toHaveText('Tue, Oct 13');

    // The start opens wheels; scrolling one takes the time under the band, keeping the length.
    await start.click();
    const wheels = page.getByRole('dialog', { name: 'Start time', exact: true });
    await expect(wheels).toBeVisible();
    await turn(wheels.getByRole('listbox', { name: 'Hour' }), '4');
    await expect(start).toHaveText('4:30 pm');
    await expect(end).toHaveText('5:15 pm');
    await turn(wheels.getByRole('listbox', { name: 'Minute' }), '00');
    await expect(start).toHaveText('4:00 pm');
    await page.screenshot({ path: testInfo.outputPath(`${where}-wheels.png`) });
    // A tap on a time takes it too, and the arrow keys step a wheel.
    await wheels.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: '15', exact: true }).click();
    await expect(start).toHaveText('4:15 pm');
    await wheels.getByRole('listbox', { name: 'Minute' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(start).toHaveText('4:10 pm');
    await page.keyboard.press('Escape');
    await expect(wheels).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(start).toBeFocused();
    await editor.getByRole('button', { name: 'Start later', exact: true }).click();
    await expect(start).toHaveText('4:25 pm');

    // An end before the start is the next day, named under the time.
    await end.click();
    const endWheels = page.getByRole('dialog', { name: /^End time/ });
    await turn(endWheels.getByRole('listbox', { name: 'am or pm' }), 'am');
    await turn(endWheels.getByRole('listbox', { name: 'Hour' }), '1');
    await turn(endWheels.getByRole('listbox', { name: 'Minute' }), '00');
    await endWheels.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'End time, Wed, Oct 14, 1:00 am' })).toBeVisible();

    if (where === 'wall') {
      for (const name of ['Start earlier', 'Start later']) {
        expect((await editor.getByRole('button', { name, exact: true }).boundingBox()).width).toBeGreaterThanOrEqual(56);
      }
      for (const field of [start, end]) {
        expect((await field.boundingBox()).height).toBeGreaterThanOrEqual(56);
      }
    }
    await editor.getByRole('group', { name: 'When' }).screenshot({ path: testInfo.outputPath(`${where}-times.png`) });

    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body).toMatchObject({ startDate: '2026-10-13', startTime: '16:25:00', endDate: '2026-10-14', endTime: '01:00:00' });
  });
}
