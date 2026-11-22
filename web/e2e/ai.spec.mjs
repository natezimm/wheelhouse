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

// Nora's game on Saturday, November 7, 11 AM to 12:15 PM in New York.
const game = {
  id: 'game', calendarId: 'nora-cal', memberId: 'm4', title: 'U10 Rec Soccer vs. South Orange', location: 'Memorial Park Field 2',
  allDay: false, startsAt: '2026-11-07T16:00:00Z', endsAt: '2026-11-07T17:15:00Z', startDate: null, endDate: null, recurring: false,
};
// What Ask answers "When are we all free Saturday afternoon?" with.
const freeSaturday = {
  kind: 'free',
  sentence: 'Everyone is free 12:15–6 pm on Saturday, after Nora’s game.',
  slots: [{ start: '2026-11-07T17:15:00Z', end: '2026-11-07T23:00:00Z', memberIds: [] }],
  events: [game],
  changeNumber: 1,
  notCached: [],
};

/**
 * The family above on Wednesday, November 4, 2026, its live connection down. <code>describe</code> is
 * how /api/ai/describe answers; writes are recorded and accepted.
 */
async function stub(page, { ai = true, describe = { status: 200, json: soccer }, ask = { status: 200, json: freeSaturday } } = {}) {
  const posted = [];
  const described = [];
  const asked = [];
  await page.clock.install({ time: new Date('2026-11-04T14:00:00Z') });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/ai/describe') {
      described.push(route.request().postDataJSON());
      return route.fulfill(describe);
    }
    if (url.pathname === '/api/ai/ask') {
      asked.push(route.request().postDataJSON());
      return route.fulfill(ask);
    }
    if (url.pathname === '/api/calendar/events' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posted.push(body);
      return route.fulfill({ status: 201, json: { id: 'new', calendarId: body.calendarId, memberId: 'm4', title: body.title, location: body.location, allDay: false, startsAt: '2026-11-10T22:15:00Z', endsAt: '2026-11-10T23:15:00Z', startDate: null, endDate: null, recurring: true } });
    }
    const body =
      url.pathname === '/api/session'
        ? { mode: 'Demo', signedIn: true, canSignIn: false, ai: { describe: ai, ask: ai } }
        : url.pathname === '/api/family'
          ? family
          : url.pathname === '/api/calendar'
            ? { calendars, events: [], changeNumber: 1, needsReconnect: false }
            : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  return { posted, described, asked };
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

/** Opens Ask: on the phone from Search's "Ask instead", on a desktop from the rail. */
async function openAsk(page, where) {
  if (where === 'desktop') {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.addInitScript(() => localStorage.setItem('wheelhouse.welcome.v1', 'closed'));
  await page.goto('/');
  if (where === 'desktop') {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Ask' }).click();
  } else {
    await page.getByRole('button', { name: 'Search events' }).click();
    await page.getByRole('dialog', { name: 'Search events' }).getByRole('button', { name: /Ask instead/ }).click();
  }
  const panel = page.getByRole('dialog', { name: 'Ask the calendar' });
  await expect(panel).toBeVisible();
  return panel;
}

for (const where of ['phone', 'desktop']) {
  test(`Ask answers on the ${where} from the server's free time, and Add event opens the editor there`, async ({ page }, testInfo) => {
    test.skip((testInfo.project.name === 'phone') !== (where === 'phone'), 'one layout per project');
    const { asked, posted } = await stub(page);
    const panel = await openAsk(page, where);

    await expect(panel.getByRole('group', { name: 'Try asking' }).getByRole('button')).toHaveCount(3);
    await expect(panel).toContainText('Read from your calendar only. Nothing changes until you save.');
    await page.screenshot({ path: testInfo.outputPath(`${where}-ask-open.png`) });
    await panel.getByRole('button', { name: 'When are we all free Saturday afternoon?' }).click();

    await expect(panel.getByRole('status')).toHaveText('Everyone is free 12:15–6 pm on Saturday, after Nora’s game.');
    expect(asked).toEqual([{ question: 'When are we all free Saturday afternoon?' }]);
    await expect(panel.getByRole('list', { name: 'Free times' })).toContainText('12:15 – 6 pm');
    await expect(panel.getByRole('list', { name: 'Events in the answer' })).toContainText('U10 Rec Soccer vs. South Orange');
    await page.screenshot({ path: testInfo.outputPath(`${where}-ask-answer.png`), fullPage: true });

    await panel.getByRole('button', { name: 'Add event at 12:15 pm' }).click();
    const editor = page.getByRole('dialog', { name: 'New event' });
    await expect(editor).toBeVisible();
    await expect(panel).toHaveCount(0);
    await editor.getByRole('textbox', { name: /^Title$/i }).fill('Bike ride');
    await editor.getByRole('button', { name: /^Save( event)?$/ }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ title: 'Bike ride', startDate: '2026-11-07', startTime: '12:15:00' });
  });

  test(`Open Saturday on the ${where} shows the day the answer is about`, async ({ page }, testInfo) => {
    test.skip((testInfo.project.name === 'phone') !== (where === 'phone'), 'one layout per project');
    await stub(page);
    const panel = await openAsk(page, where);
    await panel.getByRole('textbox', { name: 'Your question' }).fill('When are we all free Saturday afternoon?');
    await panel.getByRole('textbox', { name: 'Your question' }).press('Enter');
    await panel.getByRole('button', { name: 'Open Saturday' }).click();

    await expect(panel).toHaveCount(0);
    if (where === 'phone') {
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Saturday');
    } else {
      await expect(page.locator('app-calendar-toolbar')).toContainText('Nov');
    }
  });
}

test('the A key opens Ask on a desktop, and its answers that cannot help offer Search', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'one run is enough');
  await stub(page, { ask: { status: 200, json: { ...freeSaturday, kind: 'none', sentence: 'Nothing on the calendar for that.', slots: [], events: [] } } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('wheelhouse.welcome.v1', 'closed'));
  await page.goto('/');
  await expect(page.locator('app-calendar-toolbar')).toBeVisible();
  await page.keyboard.press('a');
  const panel = page.getByRole('dialog', { name: 'Ask the calendar' });
  await panel.getByRole('textbox', { name: 'Your question' }).fill('When is karate?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();

  await expect(panel.getByRole('status')).toHaveText('Nothing on the calendar for that.');
  await panel.getByRole('button', { name: 'Search instead' }).click();
  await expect(page.getByRole('dialog', { name: 'Search events' })).toBeVisible();
});

test('a refused or failed question says so in fixed words', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the phone only');
  await stub(page, { ask: { status: 200, json: { ...freeSaturday, kind: 'offTopic', sentence: "I can't change the calendar. Add event opens the editor.", slots: [], events: [] } } });
  const panel = await openAsk(page, 'phone');
  await panel.getByRole('textbox', { name: 'Your question' }).fill('Delete swim lessons');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();

  await expect(panel.getByRole('status')).toHaveText("I can't change the calendar. Add event opens the editor.");
  await expect(panel.getByRole('button', { name: /Add event at|Open|Search instead/ })).toHaveCount(0);
});

test('an instance with the AI features off offers no Ask anywhere', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'one run is enough');
  await stub(page, { ai: false });
  await page.addInitScript(() => localStorage.setItem('wheelhouse.welcome.v1', 'closed'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Search events' }).click();
  await expect(page.getByRole('dialog', { name: 'Search events' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ask instead/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Ask' })).toHaveCount(0);
  await page.locator('main').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('a');
  await expect(page.getByRole('dialog', { name: 'Ask the calendar' })).toHaveCount(0);
});
