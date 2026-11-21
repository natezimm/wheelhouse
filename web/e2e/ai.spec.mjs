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
    { id: 'm1', displayName: 'Clara', initial: 'C', role: 'Parent', color: '#2563eb' },
    { id: 'm4', displayName: 'Nora', initial: 'N', role: 'Kid', color: '#db2777' },
  ],
};
const calendars = [
  { id: 'family-cal', name: 'Marlowe Household', memberId: null, canWrite: true },
  { id: 'nora-cal', name: 'Nora — Activities', memberId: 'm4', canWrite: true },
];
// What Describe it reads from "Nora soccer every Tuesday 5:15 to 6:15 at Riverside Park until June".
const soccer = {
  calendarId: 'nora-cal', title: 'Soccer', location: 'Riverside Park', allDay: false,
  startDate: '2026-11-10', startTime: '17:15:00', endDate: '2026-11-10', endTime: '18:15:00',
  recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270602T035959Z', memberIds: [], unclear: [],
};

/**
 * The family above on Wednesday, November 4, 2026, its live connection down. <code>describe</code> is
 * how /api/ai/describe answers; writes are recorded and accepted.
 */
async function stub(page, { ai = true, describe = { status: 200, json: soccer } } = {}) {
  const posted = [];
  const described = [];
  await page.clock.install({ time: new Date('2026-11-04T14:00:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/ai/describe') {
      described.push(route.request().postDataJSON());
      return route.fulfill(describe);
    }
    if (url.pathname === '/api/calendar/events' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posted.push(body);
      return route.fulfill({ status: 201, json: { id: 'new', calendarId: body.calendarId, memberId: 'm4', title: body.title, location: body.location, allDay: false, startsAt: '2026-11-10T22:15:00Z', endsAt: '2026-11-10T23:15:00Z', startDate: null, endDate: null, recurring: true } });
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false, ai: { describe: ai, ask: false } }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events: [], changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  return { posted, described };
}

/** Opens a new event on the phone or in a desktop window, and gives back its editor. */
async function newEvent(page, where) {
  if (where === 'desktop') {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.addInitScript(() => localStorage.setItem('wheelhouse.welcome.v1', 'closed'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add event', exact: true }).first().click();
  return page.getByRole('dialog', { name: 'New event' });
}

for (const where of ['phone', 'desktop']) {
  test(`Describe it fills the ${where}'s new event, and Save sends it like any other`, async ({ page }, testInfo) => {
    test.skip((testInfo.project.name === 'phone') !== (where === 'phone'), 'one layout per project');
    const { posted, described } = await stub(page);
    const editor = await newEvent(page, where);

    const card = editor.locator('app-describe-card');
    await expect(card.getByRole('textbox', { name: 'Describe it' })).toBeVisible();
    // The demo offers the Marlowes' own examples; one fills the box and asks.
    await expect(card.getByRole('group', { name: 'Try an example' }).getByRole('button')).toHaveCount(3);
    await card.getByRole('textbox', { name: 'Describe it' }).fill('Nora soccer every Tuesday 5:15 to 6:15 at Riverside Park until June');
    await page.screenshot({ path: testInfo.outputPath(`${where}-describe-typed.png`) });
    await card.getByRole('button', { name: 'Fill in' }).click();

    await expect(card).toContainText('Filled in from your words. Check it, then Save.');
    expect(described).toEqual([{ text: 'Nora soccer every Tuesday 5:15 to 6:15 at Riverside Park until June' }]);
    await expect(editor.getByRole('textbox', { name: /^Title$/i })).toHaveValue('Soccer');
    await expect(editor.getByRole('textbox', { name: /^Location$/i })).toHaveValue('Riverside Park');
    await expect(editor.getByRole('button', { name: /^Start time, / }).or(editor.getByRole('button', { name: /^Start time/ })).first()).toContainText('5:15');
    await page.screenshot({ path: testInfo.outputPath(`${where}-describe-filled.png`), fullPage: true });

    await editor.getByRole('button', { name: /^Save( event)?$/ }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({
      calendarId: 'nora-cal', title: 'Soccer', location: 'Riverside Park', allDay: false,
      startDate: '2026-11-10', startTime: '17:15:00', endDate: '2026-11-10', endTime: '18:15:00',
    });
    expect(posted[0].recurrence).toContain('FREQ=WEEKLY;BYDAY=TU');
  });

  test(`when the assistant cannot help, the ${where}'s form still works`, async ({ page }, testInfo) => {
    test.skip((testInfo.project.name === 'phone') !== (where === 'phone'), 'one layout per project');
    const { posted } = await stub(page, { describe: { status: 503, json: { reason: 'Failed' } } });
    const editor = await newEvent(page, where);

    await editor.getByRole('textbox', { name: 'Describe it' }).fill('lunch with Clara');
    await editor.getByRole('textbox', { name: 'Describe it' }).press('Enter');
    await expect(editor.locator('app-describe-card')).toContainText("Couldn't fill it in just now. Fill in the form yourself");
    await expect(editor.getByRole('textbox', { name: /^Title$/i })).toHaveValue('');

    await editor.getByRole('textbox', { name: /^Title$/i }).fill('Lunch');
    await editor.getByRole('button', { name: /^Save( event)?$/ }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].title).toBe('Lunch');
  });
}

test('the wall, which has no keyboard, never offers Describe it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wall', 'the wall only');
  await stub(page);
  await page.goto('/wall');
  await page.getByRole('button', { name: 'Add event' }).first().click();
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await expect(page.locator('app-describe-card')).toHaveCount(0);
});

test('an instance with the AI features off shows no Describe it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the phone only');
  await stub(page, { ai: false });
  const editor = await newEvent(page, 'phone');
  await expect(editor).toBeVisible();
  await expect(page.locator('app-describe-card')).toHaveCount(0);
});
