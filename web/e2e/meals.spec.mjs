import { test, expect } from '@playwright/test';

const kinds=['Breakfast','Lunch','Dinner'], week='2026-11-02';
const add=(day,n) => new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
const family={ id:'meal-family', name:'The Marlowes', timeZone:'America/New_York', weekStartsOn:'Monday',
  nightModeFrom:'22:00:00', nightModeTo:'06:00:00', units:'Imperial', latitude:null, longitude:null,
  members:[{ id:'m1', displayName:'Ben', initial:'B', role:'Parent', color:'#2F5FC4' }] };

// Real SignalR handshake; HTTP and WebSocket transport are mocked across both pages.
function server() {
  const state={ rows:new Map(), receipts:new Map(), revision:1, sockets:[], blocked:false, lose:false, applied:0, calendarWrites:0 };
  const key=(date,slot)=>date+'/'+slot;
  for(const [date,slot,title] of [['2026-10-26','Dinner','Soup'],['2026-10-27','Dinner','Tacos'],['2026-10-28','Lunch','Salad'],
    ['2026-11-01','Dinner','Sunday roast'],[week,'Dinner','Pasta']]) state.rows.set(key(date,slot),{date,slot,title,notes:null,version:'v-'+date+slot});
  const row=(date,slot)=>state.rows.get(key(date,slot)) ?? { date,slot,title:null,notes:null,version:null };
  const snapshot=(from,to)=>{
    const meals=[]; for(let date=from;date<to;date=add(date,1)) for(const slot of kinds) meals.push({...row(date,slot)});
    return {from,to,changeNumber:state.revision,meals};
  };
  state.notify=()=>{for(const socket of state.sockets) {try{socket.send(JSON.stringify({type:1,target:'HouseholdChanged',arguments:[{domain:'meals',changeNumber:state.revision}]})+'\x1e');}catch{}}};
  state.connect=async(page,time='2026-11-02T16:00:00Z')=>{
    await page.clock.install({time:new Date(time)});
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),path=url.pathname;
      if(path.startsWith('/api/calendar') && req.method()!=='GET') state.calendarWrites++;
      if(path==='/api/meals' && req.method()==='GET') return route.fulfill({json:snapshot(url.searchParams.get('from'),url.searchParams.get('to'))});
      if(path.startsWith('/api/meals/') && req.method()!=='GET') {
        const body=req.postDataJSON(),copy=path.endsWith('/copy'),parts=path.split('/');
        const from=copy?body.targetFrom:parts[3],to=add(from,copy?7:1),fingerprint=JSON.stringify(body);
        const receipt=state.receipts.get(body.commandId);
        if(receipt && receipt!==fingerprint) return route.fulfill({status:409,json:{message:'Save ID reused'}});
        if(!receipt) {
          const changes=copy?body.items.map(i=>{const source=row(i.date,i.slot),date=add(body.targetFrom,Math.round((Date.parse(i.date)-Date.parse(body.sourceFrom))/86400000));return {source,target:row(date,i.slot),sourceVersion:i.sourceVersion,targetVersion:i.targetVersion};})
            :[{source:{title:body.title?.trim()||null,notes:body.notes?.trim()||null},target:row(parts[3],parts[4]),targetVersion:body.version}];
          if(changes.some(c=>c.target.version!==c.targetVersion || copy && (!c.source.title || c.source.version!==c.sourceVersion))) return route.fulfill({status:409,json:{message:'Meals changed'}});
          if(changes.some(c=>c.target.title!==c.source.title || c.target.notes!==c.source.notes)) {
            state.revision++;state.applied++;
            for(const c of changes) state.rows.set(key(c.target.date,c.target.slot),{...c.target,title:c.source.title,notes:c.source.notes,version:'v'+state.revision+c.target.date+c.target.slot});
          }
          state.receipts.set(body.commandId,fingerprint);state.notify();
        }
        if(state.lose){state.lose=false;return route.fulfill({status:503});}
        return route.fulfill({json:snapshot(from,to)});
      }
      if(path==='/api/weather') return route.fulfill({status:204});
      return route.fulfill({json:path==='/api/session'?{mode:'Family',signedIn:true,canSignIn:true}
        :path==='/api/family'?family:path==='/api/calendar'?{calendars:[],events:[],changeNumber:0,needsReconnect:false}
        :path==='/api/chores'?{chores:[],changeNumber:0,canManage:true}:{}});
    });
    await page.route('**/health',route=>route.fulfill({body:'Healthy'}));
    await page.route('**/hubs/*/negotiate*',route=>route.fulfill({json:{negotiateVersion:1,connectionId:'connection',connectionToken:'token',availableTransports:[{transport:'WebSockets',transferFormats:['Text']}]}}));
    await page.routeWebSocket('**/hubs/*',socket=>{
      const household=socket.url().includes('/household');
      if(household && state.blocked){socket.close();return;} if(household)state.sockets.push(socket);
      socket.onMessage(message=>{if(String(message).includes('"protocol"')){socket.send('{}\x1e');if(household)state.notify();}});
    });
  };
  return state;
}
const slot=(page,date,kind)=>page.getByRole('button',{name:'Edit '+date+' '+kind,exact:true});
const dialog=page=>page.getByRole('dialog');
async function edit(page,date,kind,title) {
  await slot(page,date,kind).click(); await dialog(page).getByLabel('Meal title',{exact:true}).fill(title);
  await dialog(page).getByRole('button',{name:'Save meal',exact:true}).click(); await expect(dialog(page)).toHaveCount(0);
}

test('weekly meal slots retain drafts through reconnect and support keyboard entry at both sizes',async({page},info)=>{
  const state=server(),wall=info.project.name==='wall',errors=[];page.on('pageerror',e=>errors.push(e.message));
  await state.connect(page);await page.goto(wall?'/wall/meals':'/meals');
  await expect(page.getByText('Live updates',{exact:true})).toBeVisible();
  await expect(page.locator('.meal')).toHaveCount(21);
  expect((await slot(page,week,'Dinner').boundingBox()).height).toBeGreaterThanOrEqual(wall?56:44);
  await slot(page,'2026-11-03','Breakfast').focus();await page.keyboard.press('Enter');
  await dialog(page).getByLabel('Meal title',{exact:true}).fill('Oatmeal and berries');
  await dialog(page).getByLabel('Notes',{exact:true}).fill('Keep this meal draft');
  state.blocked=true;for(const socket of state.sockets)socket.close();
  await expect(page.getByText('Reconnecting',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('meals-reconnecting.png'),fullPage:true});
  state.blocked=false;await expect(page.getByText('Live updates',{exact:true})).toBeVisible({timeout:10000});
  await expect(dialog(page).getByLabel('Meal title',{exact:true})).toHaveValue('Oatmeal and berries');
  await dialog(page).getByRole('button',{name:'Save meal',exact:true}).click();
  await expect(slot(page,'2026-11-03','Breakfast')).toContainText('Oatmeal and berries');
  await page.getByRole('button',{name:'Next week',exact:true}).click();await expect(slot(page,'2026-11-09','Dinner')).toContainText('Not planned');
  await page.getByRole('button',{name:'Previous week',exact:true}).click();await expect(slot(page,'2026-11-03','Breakfast')).toContainText('Oatmeal and berries');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('meals-week.png'),fullPage:true});
});

test('two devices review stale edits, receipted clears and occupied week-copy choices',async({page,context},info)=>{
  test.skip(info.project.name!=='phone','One two-device scenario is enough.');test.setTimeout(60000);
  const state=server();await state.connect(page);await page.goto('/meals');
  const wall=await context.newPage();await wall.setViewportSize({width:1920,height:1080});await state.connect(wall);await wall.goto('/wall/meals');
  await slot(page,week,'Dinner').click();await dialog(page).getByLabel('Meal title',{exact:true}).fill('My soup');
  await edit(wall,week,'Dinner','Tacos');
  await dialog(page).getByRole('button',{name:'Save meal',exact:true}).click();
  await expect(dialog(page)).toContainText('Latest meal: Tacos');await expect(dialog(page).getByLabel('Meal title',{exact:true})).toHaveValue('My soup');
  await dialog(page).getByRole('button',{name:'Review latest',exact:true}).click();await dialog(page).getByRole('button',{name:'Save meal',exact:true}).click();
  await expect(slot(wall,week,'Dinner')).toContainText('My soup');
  await slot(page,week,'Dinner').click();await dialog(page).getByRole('button',{name:'Clear this meal…',exact:true}).click();
  await expect(dialog(page)).toContainText('Clear “My soup”');await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(slot(page,week,'Dinner')).toContainText('My soup');
  await slot(page,week,'Dinner').click();await dialog(page).getByRole('button',{name:'Clear this meal…',exact:true}).click();
  state.lose=true;await dialog(page).getByRole('button',{name:'Clear meal',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check save',exact:true})).toBeVisible();await dialog(page).getByRole('button',{name:'Close',exact:true}).click();
  await expect(slot(wall,week,'Dinner')).toContainText('Not planned');await edit(wall,week,'Dinner','Chicken');
  const applied=state.applied;await page.getByRole('button',{name:'Check save',exact:true}).click();
  await expect(page.locator('.save-status')).toHaveCount(0);await expect(slot(page,week,'Dinner')).toContainText('Chicken');expect(state.applied).toBe(applied);
  await page.getByRole('button',{name:'Copy previous week…',exact:true}).click();
  const occupied=dialog(page).locator('.copy-row').filter({hasText:'Replace: Chicken'}).locator('input');
  await expect(occupied).not.toBeChecked();await occupied.check();
  await edit(wall,'2026-11-03','Dinner','New Tuesday');
  await dialog(page).getByRole('button',{name:'Copy selected meals',exact:true}).click();
  await expect(dialog(page).getByRole('button',{name:'Review latest',exact:true})).toBeVisible();
  expect(state.rows.get(week+'/Dinner').title).toBe('Chicken');expect(state.rows.has('2026-11-04/Lunch')).toBe(false);
  await page.screenshot({path:info.outputPath('meals-copy-conflict.png'),fullPage:true});
  await dialog(page).getByRole('button',{name:'Review latest',exact:true}).click();
  await expect(dialog(page).locator('.copy-row')).toHaveCount(4); // Includes the previous Sunday's roast.
  await dialog(page).locator('.copy-row').filter({hasText:'Replace: Chicken'}).locator('input').check();
  await page.screenshot({path:info.outputPath('meals-copy-preview.png'),fullPage:true});
  await dialog(page).getByRole('button',{name:'Copy selected meals',exact:true}).click();
  await expect(slot(page,week,'Dinner')).toContainText('Soup');await expect(slot(wall,week,'Dinner')).toContainText('Soup');
  await expect(slot(page,'2026-11-03','Dinner')).toContainText('New Tuesday');await expect(slot(page,'2026-11-04','Lunch')).toContainText('Salad');
  expect(state.rows.get('2026-10-26/Dinner').title).toBe('Soup');
  await page.screenshot({path:info.outputPath('meals-copied.png'),fullPage:true});
});

test('Today meals use household dates across DST midnight without creating calendar events',async({page},info)=>{
  test.skip(info.project.name!=='phone','Today is a phone screen.');
  const state=server();await state.connect(page,'2026-11-02T04:59:00Z');await page.goto('/');
  const summary=page.getByRole('region',{name:"Today's meals",exact:true});
  await expect(summary).toContainText('Sunday roast');await page.clock.fastForward(60000);
  await expect(summary).toContainText('Pasta');await expect(summary).not.toContainText('Sunday roast');
  await expect(summary.getByRole('link',{name:'Plan the week →',exact:true})).toBeVisible();
  expect(state.calendarWrites).toBe(0);
  await page.screenshot({path:info.outputPath('meals-today.png'),fullPage:true});
});
