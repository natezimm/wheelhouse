import { test, expect } from '@playwright/test';

const family = {
  id: 'family', name: 'The Marlowes', timeZone: 'America/New_York', weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00', nightModeTo: '06:00:00', units: 'Imperial', latitude: null, longitude: null,
  members: [
    { id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4' },
    { id: 'm2', displayName: 'Tess', initial: 'T', role: 'Parent', color: '#B85A14' },
    { id: 'm3', displayName: 'Milo', initial: 'M', role: 'Kid', color: '#137A6D' },
  ],
};
const day = '2026-11-01';
const initial = [
  { id: 'c1', creationId: 'a1', title: 'Set the table', notes: 'Plates, cups and napkins for dinner.', memberId: 'm3', dueDate: day, completedAt: null, archived: false, version: 'v1' },
  { id: 'c2', creationId: 'a2', title: 'Water the plants', notes: null, memberId: null, dueDate: '2026-10-31', completedAt: null, archived: false, version: 'v1' },
  { id: 'c3', creationId: 'a3', title: 'Put laundry away', notes: null, memberId: 'm2', dueDate: day, completedAt: '2026-11-01T13:00:00Z', archived: false, version: 'v2' },
];

function server() {
  const state = { revision: 1, items: structuredClone(initial), sockets: [], hold: false, held: null, failRead: false,
    failWrite: false, commitThenFail: false, posts: 0 };
  state.notify = () => { for (const socket of state.sockets) {
    try { socket.send(JSON.stringify({ type: 1, target: 'HouseholdChanged', arguments: [{ domain: 'chores', changeNumber: state.revision }] }) + '\x1e'); } catch {}
  } };
  state.connect = async page => {
    await page.clock.install({ time: new Date('2026-11-01T15:00:00Z') });
    await page.route('**/api/**', async route => {
      const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
      if (path === '/api/chores' && req.method() === 'GET') {
        if (state.failRead) return route.fulfill({ status: 503 });
        const date = url.searchParams.get('date');
        return route.fulfill({ json: { changeNumber: state.revision, chores: state.items.filter(c => !c.archived &&
          (c.dueDate === date || c.dueDate < date && !c.completedAt)) } });
      }
      if (path.startsWith('/api/chores') && req.method() === 'GET') {
        const id = path.split('/').at(-1); const item = state.items.find(c => path.includes('/creation/') ? c.creationId === id : c.id === id);
        return route.fulfill(item ? { json: item } : { status: 404 });
      }
      if (path.startsWith('/api/chores') && req.method() !== 'GET') {
        if (state.hold) { state.hold = false; state.held = route; return; }
        if (state.failWrite) return route.fulfill({ status: 403 });
        const body = req.postDataJSON(); let item;
        if (req.method() === 'POST') {
          state.posts++;
          item = { ...body, id: 'new-' + state.posts, version: 'new-v1', completedAt: null, archived: false };
          state.items.push(item);
        } else {
          item = state.items.find(c => c.id === path.split('/')[3]);
          if (path.endsWith('/completion')) item.completedAt = body.completed ? '2026-11-01T15:00:00Z' : null;
          else if (path.endsWith('/archive')) item.archived = true;
          else Object.assign(item, body);
          item.version = 'v' + (state.revision + 1);
        }
        state.revision++; state.notify();
        if (state.commitThenFail) { state.commitThenFail = false; return route.fulfill({ status: 503 }); }
        return route.fulfill({ json: item });
      }
      if (path === '/api/weather') return route.fulfill({ status: 204 });
      return route.fulfill({ json: path === '/api/session' ? { mode: 'Family', signedIn: true, canSignIn: true }
        : path === '/api/family' ? family : path === '/api/calendar' ? { calendars: [], events: [], changeNumber: 0, needsReconnect: false } : {} });
    });
    await page.route('**/health', route => route.fulfill({ body: 'Healthy' }));
    await page.route('**/hubs/*/negotiate*', route => route.fulfill({ json: { negotiateVersion: 1, connectionId: 'connection', connectionToken: 'token', availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text'] }] } }));
    await page.routeWebSocket('**/hubs/*', socket => {
      const household = socket.url().includes('/household');
      if (household) state.sockets.push(socket);
      socket.onMessage(message => { if (String(message).includes('"protocol"')) {
        socket.send('{}\x1e'); if (household) state.notify();
      } });
    });
  };
  return state;
}

test('complete, reject and safely reconcile chores at wall and phone sizes', async ({ page }, info) => {
  const wall = info.project.name === 'wall'; const state = server(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await state.connect(page); await page.goto(wall ? '/wall/chores' : '/chores');
  await expect(page.getByRole('heading', { name: 'Chores', exact: true })).toBeVisible();
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
  const complete = page.getByRole('button', { name: 'Complete Set the table', exact: true });
  expect((await complete.boundingBox()).height).toBeGreaterThanOrEqual(wall ? 56 : 44);
  if (wall) await expect(page.getByRole('button', { name: 'Add chore', exact: true })).toHaveCount(0);
  state.hold = true; await complete.click(); await expect.poll(() => !!state.held).toBe(true);
  await expect(page.locator('.save-status')).toContainText('saving');
  await expect(page.locator('.day-heading')).toContainText('2 done');
  await page.screenshot({ path: info.outputPath('chores-pending.png'), fullPage: true });
  await state.held.fulfill({ status: 403 });
  await expect(complete).toBeEnabled(); await expect(page.locator('.day-heading')).toContainText('1 done');
  state.commitThenFail = true; await complete.click();
  await expect(page.getByRole('button', { name: 'Check save', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check save', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveCount(0);
  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Reopen Set the table', exact: true }).click();
  await expect(complete).toBeEnabled();
  state.failRead = true; await page.getByRole('button', { name: 'Resync now', exact: true }).click();
  await expect(page.getByText('Chores could not be refreshed.', { exact: false })).toBeVisible();
  await expect(complete).toBeVisible();
  state.failRead = false; await page.getByRole('button', { name: 'Resync now', exact: true }).click();
  await expect(page.getByText('Chores could not be refreshed.', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('chores-ready.png'), fullPage: true });
});

test('phone creation reaches another wall and preserves its draft during reconnect', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'The phone is the parent management screen.');
  const state = server(); await state.connect(page); await page.goto('/chores');
  const wall = await context.newPage(); await wall.setViewportSize({ width: 1920, height: 1080 });
  await state.connect(wall); await wall.goto('/wall/chores');
  await page.getByRole('button', { name: 'Add chore', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Title', { exact: true }).fill('Walk the dog');
  await editor.getByLabel('Assigned to').selectOption({ label: 'Ben' });
  state.sockets[0].close({ code: 1011, reason: 'Offline' });
  await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Live updates', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Walk the dog');
  state.commitThenFail = true; await editor.getByRole('button', { name: 'Save chore', exact: true }).click();
  await expect(editor.getByLabel('Title', { exact: true })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Check save', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chore-editor-uncertain.png'), fullPage: true });
  await editor.getByRole('button', { name: 'Check save', exact: true }).click();
  await expect(editor).toHaveCount(0); expect(state.posts).toBe(1);
  await expect(wall.getByRole('button', { name: 'Complete Walk the dog', exact: true })).toBeVisible();
  await wall.getByRole('button', { name: 'Complete Walk the dog', exact: true }).click();
  await expect(page.locator('.day-heading')).toContainText('2 done');
  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Edit Walk the dog', exact: true }).click();
  await editor.getByRole('button', { name: 'Archive chore', exact: true }).click();
  await editor.getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Walk the dog', exact: true })).toHaveCount(0);
  await wall.screenshot({ path: info.outputPath('chores-wall-synced.png'), fullPage: true });
});
