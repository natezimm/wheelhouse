import {test,expect} from '@playwright/test';

// Transport stubs exercise the real Angular stores/SignalR handshake. API tests cover PostgreSQL transactions.
function server(){
  const family={id:'grocery-family',name:'The Marlowes',timeZone:'America/New_York',weekStartsOn:'Monday',members:[],units:'Metric',
    nightModeFrom:'22:00:00',nightModeTo:'06:00:00',latitude:null,longitude:null};
  const grocery={id:'grocery',creationId:'grocery',name:'Grocery',isGrocery:true,archived:false,version:'g1',
    categories:[{id:'other',name:'Other',isOther:true}],items:[
      {id:'pasta',creationId:'pasta',text:'Pasta',quantity:'2',unit:'g',notes:null,categoryId:'other',checked:false,deleted:false,sortOrder:0,version:'p1',sources:[]},
      {id:'boxes',creationId:'boxes',text:'Pasta',quantity:'3',unit:'boxes',notes:null,categoryId:'other',checked:false,deleted:false,sortOrder:1,version:'b1',sources:[]}]};
  const state={grocery,revision:1,sockets:[],receipts:new Map(),counts:new Map([['2026-11-02Dinnerpasta',1]]),blocked:false,lose:false,fail:false,empty:false};
  const meals=()=>state.empty?[]:[
    ...['2026-11-02','2026-11-03'].map((date,i)=>({date,slot:'Dinner',title:'Tomato pasta',version:'meal'+i,snapshotKey:'a'.repeat(64),servings:i?4:6,
      ingredients:[{id:'pasta',name:'Pasta',quantity:i?400:600,quantityText:null,unit:'g',previousCount:state.counts.get(date+'Dinnerpasta')??0},
        {id:'salt',name:'Salt',quantity:null,quantityText:'to taste',unit:null,previousCount:state.counts.get(date+'Dinnersalt')??0}]})),
    {date:'2026-11-02',slot:'Lunch',title:'Sandwiches',version:'free',snapshotKey:null,servings:null,ingredients:[]}];
  const preview=(from,to)=>({from,to,mealsChangeNumber:state.revision,listsChangeNumber:state.revision,grocery,meals:from==='2026-11-02'?meals():[]});
  state.notify=()=>{for(const s of state.sockets)for(const domain of ['meals','lists'])try{s.send(JSON.stringify({type:1,target:'HouseholdChanged',arguments:[{domain,changeNumber:state.revision}]})+'\x1e');}catch{}};
  state.connect=async page=>{
    await page.clock.install({time:new Date('2026-11-02T16:00:00Z')});
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),path=url.pathname;
      if(path==='/api/meals/groceries'&&req.method()==='GET'){
        if(state.fail)return route.fulfill({status:503});return route.fulfill({json:preview(url.searchParams.get('from'),url.searchParams.get('to'))});
      }
      if(path==='/api/meals/groceries'&&req.method()==='POST'){
        const b=req.postDataJSON(),fingerprint=JSON.stringify(b),receipt=state.receipts.get(b.commandId);
        if(receipt&&receipt.fingerprint!==fingerprint)return route.fulfill({status:409,json:{}});
        if(!receipt){
          if(b.items.some(i=>{const count=state.counts.get(i.date+i.slot+i.ingredientId)??0,target=grocery.items.find(t=>t.id===i.targetItemId);
            return count!==i.previousCount||count&&!i.allowAdditional||i.targetItemId&&(!target||target.checked||target.version!==i.targetVersion);
          }))return route.fulfill({status:409,json:{}});
          const groups=new Map(),ids=new Set();state.revision++;
          for(const line of b.items){
            const source=meals().find(m=>m.date===line.date&&m.slot===line.slot),ingredient=source.ingredients.find(i=>i.id===line.ingredientId);
            const k=line.targetItemId||(b.combineNew&&line.quantity!==null?ingredient.name+ingredient.unit:Math.random().toString());
            let item=groups.get(k)||grocery.items.find(t=>t.id===line.targetItemId);
            if(!item){item={id:'new'+state.revision+groups.size,creationId:'created'+state.revision+groups.size,text:ingredient.name,
              quantity:line.quantity===null?line.quantityText:'0',unit:ingredient.unit,notes:null,categoryId:'other',checked:false,deleted:false,sortOrder:grocery.items.length,version:'i'+state.revision,sources:[]};grocery.items.push(item);}
            if(line.quantity!==null)item.quantity=String(Number(item.quantity)+line.quantity);item.version='v'+state.revision;
            item.sources.push({batchId:b.commandId,date:line.date,slot:line.slot,mealTitle:source.title,ingredientName:ingredient.name,
              recipeId:'recipe',recipeVersion:'recipe1',servings:source.servings,quantity:line.quantity,quantityText:line.quantityText,unit:ingredient.unit});
            groups.set(k,item);ids.add(item.id);const sourceKey=line.date+line.slot+line.ingredientId;state.counts.set(sourceKey,(state.counts.get(sourceKey)??0)+1);
          }
          const result={id:b.commandId,addedAt:'2026-11-02T16:00:00Z',ingredientCount:b.items.length,itemIds:[...ids]};
          state.receipts.set(b.commandId,{fingerprint,result});state.notify();
        }
        if(state.lose){state.lose=false;return route.fulfill({status:503});}
        return route.fulfill({json:state.receipts.get(b.commandId).result});
      }
      if(path==='/api/lists')return route.fulfill({json:{changeNumber:state.revision,lists:[grocery]}});
      if(path==='/api/weather')return route.fulfill({status:204});
      return route.fulfill({json:path==='/api/session'?{mode:'Family',signedIn:true,canSignIn:true}:path==='/api/family'?family
        :path==='/api/calendar'?{calendars:[],events:[],changeNumber:0,needsReconnect:false}:path==='/api/chores'?{chores:[],changeNumber:0,canManage:true}:{}});
    });
    await page.route('**/health',r=>r.fulfill({body:'Healthy'}));
    await page.route('**/hubs/*/negotiate*',r=>r.fulfill({json:{negotiateVersion:1,connectionId:'c',connectionToken:'t',availableTransports:[{transport:'WebSockets',transferFormats:['Text']}]}}));
    await page.routeWebSocket('**/hubs/*',socket=>{
      const household=socket.url().includes('/household');if(household&&state.blocked){socket.close();return;}if(household)state.sockets.push(socket);
      socket.onMessage(m=>{if(String(m).includes('"protocol"')){socket.send('{}\x1e');if(household)state.notify();}});
    });
  };return state;
}
const include=(page,name,date)=>page.getByRole('checkbox',{name:'Include '+name+' for '+date+' Dinner',exact:true});
test('phone reviews merges, preserves reconnect drafts, checks a lost batch and wall receives provenance',async({page,context},info)=>{
  test.skip(info.project.name!=='phone','One shared phone/wall scenario.');test.setTimeout(60000);
  const state=server(),errors=[];page.on('pageerror',e=>errors.push(e.message));await state.connect(page);await page.goto('/meals/groceries?from=2026-11-02');
  await expect(page.getByText('Live updates',{exact:true})).toBeVisible();
  await expect(include(page,'Pasta','2026-11-02')).not.toBeChecked();await expect(page.getByText(/This is a free-text meal/)).toBeVisible();
  const salt=include(page,'Salt','2026-11-02');await salt.focus();await page.keyboard.press('Space');
  const qty=page.getByRole('spinbutton',{name:'Quantity for Pasta on 2026-11-03 Dinner',exact:true});await qty.fill('300');
  const destination=page.getByRole('combobox',{name:'Destination for Pasta on 2026-11-03 Dinner',exact:true});await destination.selectOption('pasta');
  await expect(destination.getByRole('option',{name:/boxes/})).toHaveCount(0);
  state.blocked=true;for(const socket of state.sockets)socket.close();await expect(page.getByText('Reconnecting',{exact:true})).toBeVisible();
  await expect(qty).toHaveValue('300');state.blocked=false;await expect(page.getByText('Live updates',{exact:true})).toBeVisible({timeout:10000});
  await expect(qty).toHaveValue('300');await expect(destination).toHaveValue('pasta');
  await page.screenshot({path:info.outputPath('groceries-preview.png'),fullPage:true});
  await page.getByRole('button',{name:'Review addition…',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('302');
  state.grocery.items[0].checked=true;state.grocery.items[0].version='checked';state.revision++;state.notify();
  await page.getByRole('button',{name:'Add groceries',exact:true}).click();await expect(page.getByRole('button',{name:'Review latest',exact:true})).toBeVisible();
  expect(state.receipts.size).toBe(0);await expect(qty).toHaveValue('300');await page.screenshot({path:info.outputPath('groceries-conflict.png'),fullPage:true});
  await page.getByRole('button',{name:'Review latest',exact:true}).click();await expect(qty).toHaveValue('400');
  await include(page,'Pasta','2026-11-02').check();await page.getByRole('checkbox',{name:'Buy this ingredient again',exact:true}).check();
  await page.getByRole('checkbox',{name:'Combine matching selected ingredients into new items',exact:true}).check();
  await page.getByRole('button',{name:'Review addition…',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('1000 g');
  await page.screenshot({path:info.outputPath('groceries-confirmation.png'),fullPage:true});state.lose=true;
  await page.getByRole('button',{name:'Add groceries',exact:true}).click();await expect(page.getByRole('button',{name:'Check grocery save',exact:true})).toBeVisible();
  const wall=await context.newPage();await wall.setViewportSize({width:1920,height:1080});await state.connect(wall);await wall.goto('/wall/lists');
  await expect(wall.getByText('1000 g',{exact:true})).toBeVisible();
  await page.reload(); // A hard reload intentionally drops in-memory intent; source counts still prevent a new duplicate batch.
  await expect(include(page,'Pasta','2026-11-02')).not.toBeChecked();
  expect(state.receipts.size).toBe(1);
  // Exercise immutable receipt reconciliation without a reload using a deliberate additional purchase.
  await include(page,'Salt','2026-11-02').check();await page.getByRole('checkbox',{name:'Buy this ingredient again',exact:true}).check();
  await page.getByRole('button',{name:'Review addition…',exact:true}).click();state.lose=true;
  await page.getByRole('button',{name:'Add groceries',exact:true}).click();await page.getByRole('button',{name:'Check grocery save',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Groceries added',exact:true})).toBeVisible();expect(state.receipts.size).toBe(2);
  const generated=wall.locator('article').filter({has:wall.getByText('1000 g',{exact:true})}),details=generated.locator('summary');
  await details.click();await expect(generated.getByText(/2026-11-03 · Dinner · Tomato pasta/)).toBeVisible();
  expect((await details.boundingBox()).height).toBeGreaterThanOrEqual(56);
  await wall.screenshot({path:info.outputPath('groceries-wall-sources.png'),fullPage:true});
  await page.getByRole('button',{name:'Review this week again',exact:true}).click();await expect(page.getByText('0 ingredients selected (up to 500).')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  expect(await wall.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('groceries-purchased.png'),fullPage:true});
});
test('phone retries unavailable previews and explains an empty week',async({page},info)=>{
  test.skip(info.project.name!=='phone','Phone generation only.');const state=server();state.fail=true;await state.connect(page);await page.goto('/meals/groceries?from=2026-11-02');
  await expect(page.getByText('Could not refresh the preview. Your review is kept.')).toBeVisible();state.fail=false;state.empty=true;
  await page.getByRole('button',{name:'Retry preview',exact:true}).click();await expect(page.getByText(/No meals planned this week/)).toBeVisible();
  expect(state.receipts.size).toBe(0);await page.screenshot({path:info.outputPath('groceries-empty.png'),fullPage:true});
});
