import { test, expect } from '@playwright/test';

const family = { id:'family', name:'The Marlowes', timeZone:'America/New_York', weekStartsOn:'Monday',
  nightModeFrom:'22:00:00', nightModeTo:'06:00:00', units:'Imperial', latitude:null, longitude:null,
  members:[{ id:'m1', displayName:'Ben', initial:'B', role:'Parent', color:'#2F5FC4' }] };
const initial = [{ id:'l1', creationId:'lc1', name:'Errands', archived:false, version:'lv1', items:[
  { id:'i1', creationId:'ic1', text:'Return library books', notes:'Leave them by the door', checked:false, deleted:false, sortOrder:0, version:'iv1' },
  { id:'i2', creationId:'ic2', text:'Pick up bike lights', notes:null, checked:false, deleted:false, sortOrder:1, version:'iv2' },
  { id:'i3', creationId:'ic3', text:'Post birthday card', notes:null, checked:true, deleted:false, sortOrder:2, version:'iv3' },
] }, { id:'l2', creationId:'lc2', name:'Weekend packing', archived:false, version:'lv2', items:[] }];

// Real SignalR browser handshake and mocked HTTP/WebSocket transports, shared by two pages.
function server(grocery = false) {
  const lists = structuredClone(initial);
  if (grocery) lists.unshift({ id:'g', creationId:'gc', name:'Grocery', isGrocery:true, archived:false, version:'gv1',
    categories:[{ id:'produce', name:'Produce', isOther:false }, { id:'dairy', name:'Dairy', isOther:false }, { id:'other', name:'Other', isOther:true }],
    items:[{ ...lists[0].items[0], id:'apples', creationId:'ac', text:'Apples', notes:null, quantity:'6', unit:null, categoryId:'produce' },
      { ...lists[0].items[1], id:'milk', creationId:'mc', text:'Milk', quantity:'1', unit:'carton', categoryId:'dairy' },
      { ...lists[0].items[2], id:'bread', creationId:'bc', text:'Bread', categoryId:'other' }] });
  const state = { lists, revision:1, sockets:[], blocked:false, failRead:false,
    failWrite:false, commitThenFail:false, hold:false, held:null, posts:0, clears:0 };
  const snapshot = () => ({ changeNumber:state.revision, lists:state.lists.map(l => ({ ...l, items:l.items.filter(i => !i.deleted).sort((a,b) => a.sortOrder-b.sortOrder) })) });
  state.notify = () => { for (const socket of state.sockets) { try {
    socket.send(JSON.stringify({ type:1, target:'HouseholdChanged', arguments:[{ domain:'lists', changeNumber:state.revision }] })+'\x1e');
  } catch {} } };
  state.connect = async page => {
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path === '/api/lists' && req.method() === 'GET') return route.fulfill(state.failRead ? { status:503 } : { json:snapshot() });
      if (path.startsWith('/api/lists') && req.method() !== 'GET') {
        if (state.hold) { state.hold=false; state.held=route; return; }
        if (state.failWrite) return route.fulfill({ status:403 });
        const body = req.postDataJSON(), ids = path.split('/'); let list = state.lists.find(l => l.id === ids[3]);
        if (path === '/api/lists') {
          state.posts++; list = state.lists.find(l => l.creationId === body.creationId);
          if (!list) state.lists.push({ id:'list-'+state.revision, creationId:body.creationId, name:body.name.trim(), archived:false, version:'v'+state.revision, items:[] });
        } else if (req.method() === 'POST') {
          state.posts++;
          if (!list.items.some(i => i.creationId === body.creationId)) list.items.push({ id:'item-'+state.revision, creationId:body.creationId,
            text:body.text.trim(), notes:body.notes, quantity:body.quantity, unit:body.unit, categoryId:body.categoryId,
            checked:false, deleted:false, sortOrder:list.items.length, version:'v'+state.revision });
        } else if (path.endsWith('/clear-checked')) {
          if (body.items.some(r => !list.items.some(i => i.id === r.id && (i.deleted || i.checked && i.version === r.version)))) return route.fulfill({ status:409, json:list });
          state.clears++;
          for (const reviewed of body.items) list.items.find(i => i.id === reviewed.id).deleted = true;
        } else if (path.endsWith('/categories')) {
          if (body.version !== list.version) return route.fulfill({ status:409, json:list });
          list.categories = body.categories.map(c => ({ ...c, isOther:c.id === 'other' }));
          for (const item of list.items) if (!list.categories.some(c => c.id === item.categoryId)) { item.categoryId='other'; item.version='v'+(state.revision+1); }
        } else if (path.endsWith('/archive')) list.archived=true;
        else if (ids.length === 4) list.name=body.name.trim();
        else {
          const item = list.items.find(i => i.id === ids[5]);
          if (path.endsWith('/checked')) item.checked=body.checked;
          else if (path.endsWith('/delete')) item.deleted=true;
          else if (path.endsWith('/move')) {
            const rows = list.items.filter(i => !i.deleted && i.checked===item.checked && (!list.isGrocery || i.categoryId===item.categoryId)).sort((a,b) => a.sortOrder-b.sortOrder);
            const other = rows[rows.indexOf(item)+body.direction];
            if (other) [item.sortOrder, other.sortOrder]=[other.sortOrder,item.sortOrder];
          } else { item.text=body.text.trim(); item.notes=body.notes; item.quantity=body.quantity; item.unit=body.unit; item.categoryId=body.categoryId; }
          item.version='v'+(state.revision+1);
        }
        state.revision++; if (list) list.version='lv'+state.revision; state.notify();
        if (state.commitThenFail) { state.commitThenFail=false; return route.fulfill({ status:503 }); }
        return route.fulfill({ json:snapshot() });
      }
      if (path === '/api/weather') return route.fulfill({ status:204 });
      return route.fulfill({ json:path === '/api/session' ? { mode:'Family', signedIn:true, canSignIn:true }
        : path === '/api/family' ? family : path === '/api/calendar' ? { calendars:[], events:[], changeNumber:0, needsReconnect:false } : {} });
    });
    await page.route('**/health', route => route.fulfill({ body:'Healthy' }));
    await page.route('**/hubs/*/negotiate*', route => route.fulfill({ json:{ negotiateVersion:1, connectionId:'connection', connectionToken:'token', availableTransports:[{ transport:'WebSockets', transferFormats:['Text'] }] } }));
    await page.routeWebSocket('**/hubs/*', socket => {
      const household = socket.url().includes('/household');
      if (household && state.blocked) { socket.close(); return; }
      if (household) state.sockets.push(socket);
      socket.onMessage(message => { if (String(message).includes('"protocol"')) { socket.send('{}\x1e'); if (household) state.notify(); } });
    });
  };
  return state;
}

test('grocery groups, optional fields and category configuration survive recovery at both sizes', async ({ page }, info) => {
  const wall = info.project.name === 'wall', state = server(true), errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await state.connect(page); await page.goto(wall ? '/wall/lists' : '/lists');
  await expect(page.getByRole('heading', { name:'Grocery', exact:true })).toBeVisible();
  await expect(page.getByRole('region', { name:'Produce', exact:true }).getByRole('heading', { name:'Apples', exact:true })).toBeVisible();
  await expect(page.getByRole('button', { name:'Archive list', exact:true })).toHaveCount(0);
  const check = page.getByRole('button', { name:'Check Apples', exact:true });
  expect((await check.boundingBox()).height).toBeGreaterThanOrEqual(wall ? 56 : 44);
  await page.getByLabel('Add an item', { exact:true }).fill('Something for lunch');
  await page.getByLabel('Add an item', { exact:true }).press('Enter');
  await expect(page.getByRole('region', { name:'Other', exact:true }).getByRole('heading', { name:'Something for lunch', exact:true })).toBeVisible();
  await page.getByRole('button', { name:'Edit Apples', exact:true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Quantity', { exact:true }).fill('2'); await dialog.getByLabel('Unit', { exact:true }).fill('bags');
  state.blocked=true; for (const socket of state.sockets) socket.close();
  await expect(page.getByText('Reconnecting', { exact:true })).toBeVisible(); state.blocked=false;
  await expect(page.getByText('Live updates', { exact:true })).toBeVisible({ timeout:10_000 });
  await expect(dialog.getByLabel('Quantity', { exact:true })).toHaveValue('2');
  await page.screenshot({ path:info.outputPath('grocery-edit.png'), fullPage:true });
  await dialog.getByRole('button', { name:'Save', exact:true }).click();
  await expect(page.locator('.item').filter({ has:page.getByRole('heading', { name:'Apples', exact:true }) })).toContainText('2 bags');
  await page.getByRole('button', { name:'Manage categories', exact:true }).click();
  await dialog.getByRole('button', { name:'Add category', exact:true }).click();
  await dialog.getByLabel('Category 3', { exact:true }).fill('Bakery');
  await dialog.getByRole('button', { name:'Move up category Bakery', exact:true }).click();
  await dialog.getByRole('button', { name:'Remove category Produce', exact:true }).click();
  await dialog.getByRole('button', { name:'Save', exact:true }).click();
  await expect(page.getByRole('region', { name:'Other', exact:true }).getByRole('heading', { name:'Apples', exact:true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]); await page.screenshot({ path:info.outputPath('grocery-ready.png'), fullPage:true });
});

test('reviewed grocery clear refuses reopened items and reconciles a lost response across devices', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'One two-device scenario is enough.');
  const state=server(true); await state.connect(page); await page.goto('/lists');
  const wall=await context.newPage(); await wall.setViewportSize({ width:1920, height:1080 }); await state.connect(wall); await wall.goto('/wall/lists');
  await page.getByRole('button', { name:'Clear checked (1)', exact:true }).click();
  await wall.locator('details.checked summary').click();
  await wall.getByRole('button', { name:'Reopen Bread', exact:true }).click();
  const dialog=page.getByRole('dialog'); await expect(dialog).toContainText('Bread');
  await dialog.getByRole('button', { name:'Clear checked items', exact:true }).click();
  await expect(dialog.getByRole('button', { name:'Review latest', exact:true })).toBeVisible();
  expect(state.lists[0].items.filter(i => i.deleted)).toHaveLength(0);
  await page.screenshot({ path:info.outputPath('grocery-clear-conflict.png'), fullPage:true });
  await dialog.getByRole('button', { name:'Cancel', exact:true }).click();
  await page.getByRole('button', { name:'Check Apples', exact:true }).click();
  await page.getByRole('button', { name:'Clear checked (1)', exact:true }).click();
  await wall.getByRole('button', { name:'Check Milk', exact:true }).click();
  await expect(dialog).toContainText('Apples'); await expect(dialog).not.toContainText('Milk');
  state.commitThenFail=true;
  await dialog.getByRole('button', { name:'Clear checked items', exact:true }).click();
  await expect(page.getByRole('button', { name:'Check save', exact:true })).toBeVisible();
  await dialog.getByRole('button', { name:'Close', exact:true }).click();
  await page.getByRole('button', { name:'Check save', exact:true }).click();
  await expect(page.locator('.save-status')).toHaveCount(0); expect(state.clears).toBe(1);
  await page.locator('details.checked summary').click();
  await expect(page.getByRole('button', { name:'Reopen Milk', exact:true })).toBeVisible();
  await expect(wall.getByRole('button', { name:'Reopen Milk', exact:true })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Apples', exact:true })).toHaveCount(0);
  await expect(wall.getByRole('heading', { name:'Apples', exact:true })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Check Bread', exact:true })).toBeVisible();
  await page.screenshot({ path:info.outputPath('grocery-cleared.png'), fullPage:true });
});

test('shared list actions, uncertain saves and recovery preserve drafts at both sizes', async ({ page }, info) => {
  const wall = info.project.name === 'wall', state = server(), errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await state.connect(page); await page.goto(wall ? '/wall/lists' : '/lists');
  await expect(page.getByText('Live updates', { exact:true })).toBeVisible();
  const check = page.getByRole('button', { name:'Check Return library books', exact:true });
  expect((await check.boundingBox()).height).toBeGreaterThanOrEqual(wall ? 56 : 44);
  const input = page.getByLabel('Add an item', { exact:true });
  await input.fill('Bring an umbrella'); state.commitThenFail=true;
  await page.getByRole('button', { name:'Add item', exact:true }).click();
  await expect(page.getByRole('button', { name:'Check save', exact:true })).toBeVisible();
  await page.getByRole('button', { name:'Check save', exact:true }).click();
  await expect(page.locator('.save-status')).toHaveCount(0); expect(state.posts).toBe(1);
  await expect(input).toHaveValue('');
  await check.click(); await page.locator('summary').click();
  await page.getByRole('button', { name:'Reopen Return library books', exact:true }).click();
  await expect(check).toBeEnabled();
  await page.getByRole('button', { name:'Move up Bring an umbrella', exact:true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.items h3').nth(1)).toHaveText('Bring an umbrella');
  await page.getByRole('button', { name:'Edit Return library books', exact:true }).click();
  await page.getByLabel('Notes', { exact:true }).fill('Keep this draft');
  state.blocked=true; for (const socket of state.sockets) socket.close();
  await expect(page.getByText('Reconnecting', { exact:true })).toBeVisible();
  await page.screenshot({ path:info.outputPath('lists-reconnecting-draft.png'), fullPage:true });
  state.blocked=false;
  await expect(page.getByText('Live updates', { exact:true })).toBeVisible({ timeout:10_000 });
  await expect(page.getByLabel('Notes', { exact:true })).toHaveValue('Keep this draft');
  state.failRead=true;
  await page.getByRole('button', { name:'Cancel', exact:true }).click();
  await page.getByRole('button', { name:'Resync now', exact:true }).click();
  await expect(page.getByText('Could not refresh lists.', { exact:false })).toBeVisible();
  state.failRead=false; await page.getByRole('button', { name:'Resync now', exact:true }).click();
  await expect(page.getByText('Could not refresh lists.', { exact:false })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Errands 3 remaining', exact:true })).toBeVisible();
  state.failWrite=true;
  await page.getByRole('button', { name:'Edit Return library books', exact:true }).click();
  await page.getByLabel('Item text', { exact:true }).fill('Preserved after failure');
  await page.getByRole('button', { name:'Save', exact:true }).click();
  await expect(page.getByLabel('Item text', { exact:true })).toHaveValue('Preserved after failure');
  await expect(page.getByRole('button', { name:'Save', exact:true })).toBeEnabled();
  await page.getByRole('button', { name:'Cancel', exact:true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path:info.outputPath('lists-ready.png'), fullPage:true });
});

test('phone and wall share creation, edits, checked state, explicit deletion and archived contents', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'One two-device scenario is enough.');
  const state=server(); await state.connect(page); await page.goto('/lists');
  const wall=await context.newPage(); await wall.setViewportSize({ width:1920, height:1080 }); await state.connect(wall); await wall.goto('/wall/lists');
  await page.getByRole('button', { name:'New list', exact:true }).click();
  await page.getByLabel('List name', { exact:true }).fill('Beach day'); await page.getByRole('button', { name:'Save', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Beach day', exact:true })).toBeVisible();
  await wall.getByRole('button', { name:'Beach day 0 remaining', exact:true }).click();
  await page.getByLabel('Add an item', { exact:true }).fill('Towels'); await page.getByRole('button', { name:'Add item', exact:true }).click();
  await wall.getByRole('button', { name:'Check Towels', exact:true }).click();
  await expect(page.locator('summary')).toHaveText('Checked (1)');
  await page.locator('summary').click(); await page.getByRole('button', { name:'Reopen Towels', exact:true }).click();
  await page.getByRole('button', { name:'Rename', exact:true }).click(); await page.getByLabel('List name', { exact:true }).fill('Beach packing'); await page.getByRole('button', { name:'Save', exact:true }).click();
  await expect(wall.getByRole('heading', { name:'Beach packing', exact:true })).toBeVisible();
  await page.getByRole('button', { name:'Delete Towels', exact:true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name:'Cancel', exact:true }).click();
  await page.getByRole('button', { name:'Delete Towels', exact:true }).click(); await page.getByRole('button', { name:'Delete item', exact:true }).click();
  await expect(wall.getByRole('heading', { name:'Towels', exact:true })).toHaveCount(0);
  await page.getByLabel('Add an item', { exact:true }).fill('Sunscreen'); await page.getByRole('button', { name:'Add item', exact:true }).click();
  await page.getByRole('button', { name:'Archive list', exact:true }).click(); await page.getByRole('dialog').getByRole('button', { name:'Archive list', exact:true }).click();
  await page.getByRole('button', { name:'Archived lists', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Sunscreen', exact:true })).toBeVisible();
  await expect(page.getByRole('button', { name:'Check Sunscreen', exact:true })).toBeDisabled();
  await page.screenshot({ path:info.outputPath('lists-archived.png'), fullPage:true });
});
