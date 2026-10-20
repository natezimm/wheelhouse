import {test,expect} from '@playwright/test';

// HTTP and real SignalR handshake transports are mocked; PostgreSQL behavior is tested by the API suite.
function server() {
  const family={id:'recipe-family',name:'The Marlowes',timeZone:'America/New_York',weekStartsOn:'Monday',members:[],
    nightModeFrom:'22:00:00',nightModeTo:'06:00:00',units:'Metric',latitude:null,longitude:null};
  const recipe={id:'r1',version:'r1v1',archived:false,content:{title:'Tomato pasta',defaultServings:4,
    ingredients:[{id:'i1',name:'Pasta',quantity:400,quantityText:null,unit:'g'},{id:'i2',name:'Salt',quantity:null,quantityText:'to taste',unit:null}],
    steps:['Cook pasta.','Season and serve.'],sourceUrl:'https://example.com/pasta',notes:'A family favorite.'}};
  const state={recipes:[recipe],rows:new Map(),revision:1,receipts:new Map(),sockets:[],blocked:false,lose:false};
  const add=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
  const snapshot=(from,to)=>({from,to,changeNumber:state.revision,meals:Array.from({length:(Date.parse(to)-Date.parse(from))/86400000},(_,i)=>add(from,i))
    .flatMap(date=>['Breakfast','Lunch','Dinner'].map(slot=>state.rows.get(date+slot)??{date,slot,title:null,notes:null,version:null,recipe:null,servings:null}))});
  const recipes=()=>({changeNumber:state.revision,canManage:true,recipes:state.recipes});
  state.notify=()=>{for(const socket of state.sockets)try{socket.send(JSON.stringify({type:1,target:'HouseholdChanged',arguments:[{domain:'meals',changeNumber:state.revision}]})+'\x1e');}catch{}};
  state.connect=async page=>{
    await page.clock.install({time:new Date('2026-11-02T16:00:00Z')});
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),path=url.pathname;
      if(path==='/api/recipes'&&req.method()==='GET')return route.fulfill({json:recipes()});
      if(path==='/api/meals'&&req.method()==='GET')return route.fulfill({json:snapshot(url.searchParams.get('from'),url.searchParams.get('to'))});
      if(req.method()==='PUT'&&(path.startsWith('/api/recipes/')||path.startsWith('/api/meals/'))){
        const b=req.postDataJSON(),fingerprint=JSON.stringify(b),receipt=state.receipts.get(b.commandId);
        if(receipt&&receipt!==fingerprint)return route.fulfill({status:409,json:{}});
        if(!receipt){
          if(path.startsWith('/api/recipes/')){
            const id=path.split('/')[3],old=state.recipes.find(r=>r.id===id);
            if((old?.version??null)!==b.version)return route.fulfill({status:409,json:{}});
            state.revision++;state.recipes=state.recipes.filter(r=>r.id!==id);
            state.recipes.push({id,version:'rv'+state.revision,archived:b.archived,content:structuredClone(b.content)});
          }else{
            const [, , ,date,slot]=path.split('/'),old=state.rows.get(date+slot);
            if((old?.version??null)!==b.version)return route.fulfill({status:409,json:{}});
            let selected=old?.recipe??null;
            if(b.recipe){const current=state.recipes.find(r=>r.id===b.recipe.id);
              if(!current||current.archived||current.version!==b.recipe.version)return route.fulfill({status:409,json:{}});
              selected={id:current.id,version:current.version,content:structuredClone(current.content)};
            }
            if(b.removeRecipe||!b.title)selected=null;
            state.revision++;
            state.rows.set(date+slot,{date,slot,title:selected?selected.content.title:b.title,notes:b.notes,version:'mv'+state.revision,
              recipe:selected,servings:selected?(b.servings??old?.servings??selected.content.defaultServings):null});
          }
          state.receipts.set(b.commandId,fingerprint);state.notify();
        }
        if(state.lose){state.lose=false;return route.fulfill({status:503});}
        return route.fulfill({json:path.startsWith('/api/recipes/')?recipes():snapshot(path.split('/')[3],add(path.split('/')[3],1))});
      }
      if(path==='/api/weather')return route.fulfill({status:204});
      return route.fulfill({json:path==='/api/session'?{mode:'Family',signedIn:true,canSignIn:true}:path==='/api/family'?family
        :path==='/api/calendar'?{calendars:[],events:[],changeNumber:0,needsReconnect:false}
        :path==='/api/chores'?{chores:[],changeNumber:0,canManage:true}:{}});
    });
    await page.route('**/health',r=>r.fulfill({body:'Healthy'}));
    await page.route('**/hubs/*/negotiate*',r=>r.fulfill({json:{negotiateVersion:1,connectionId:'c',connectionToken:'t',availableTransports:[{transport:'WebSockets',transferFormats:['Text']}]}}));
    await page.routeWebSocket('**/hubs/*',socket=>{
      const household=socket.url().includes('/household');if(household&&state.blocked){socket.close();return;}
      if(household)state.sockets.push(socket);
      socket.onMessage(message=>{if(String(message).includes('"protocol"')){socket.send('{}\x1e');if(household)state.notify();}});
    });
  };
  return state;
}
const dinner=page=>page.getByRole('button',{name:'Edit 2026-11-02 Dinner',exact:true});
const dialog=page=>page.getByRole('dialog');
test('choose, scale and read a saved recipe through library edit and archive on phone and wall',async({page},info)=>{
  const state=server(),wall=info.project.name==='wall',errors=[];page.on('pageerror',e=>errors.push(e.message));
  await state.connect(page);await page.goto(wall?'/wall/meals':'/meals');
  await dinner(page).focus();await page.keyboard.press('Enter');await dialog(page).getByRole('button',{name:'Choose recipe…',exact:true}).click();
  await dialog(page).getByRole('button',{name:/Tomato pasta Serves/}).click();
  await dialog(page).getByLabel('Servings',{exact:true}).fill('6');
  await expect(dialog(page)).toContainText('600 g');await expect(dialog(page)).toContainText('to taste');
  await page.screenshot({path:info.outputPath('recipe-selection.png'),fullPage:true});
  await dialog(page).getByRole('button',{name:'Use this recipe',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Save meal',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
  expect(state.recipes[0].content.ingredients[0].quantity).toBe(400);
  state.recipes[0]={...state.recipes[0],version:'edited',content:{...state.recipes[0].content,title:'New tomato pasta',steps:['A new method.']}};state.revision++;state.notify();
  await dinner(page).click();await expect(dialog(page).getByLabel('Meal title',{exact:true})).toHaveValue('Tomato pasta');
  await expect(dialog(page)).toContainText('Cook pasta.');
  await dialog(page).getByRole('button',{name:'Choose / refresh recipe…',exact:true}).click();
  await dialog(page).getByRole('button',{name:/New tomato pasta Serves/}).click();await dialog(page).getByRole('button',{name:'Use this recipe',exact:true}).click();
  await expect(dialog(page)).toContainText('A new method.');
  await dialog(page).getByRole('button',{name:'Save meal',exact:true}).click();await expect(dialog(page)).toHaveCount(0);
  state.recipes[0]={...state.recipes[0],archived:true,version:'archived'};state.revision++;state.notify();
  await dinner(page).click();await dialog(page).getByLabel('Servings',{exact:true}).fill('2');await expect(dialog(page)).toContainText('200 g');
  state.blocked=true;for(const s of state.sockets)s.close();await expect(page.getByText('Reconnecting',{exact:true})).toBeVisible();
  await expect(dialog(page).getByLabel('Servings',{exact:true})).toHaveValue('2');state.blocked=false;
  await expect(page.getByText('Live updates',{exact:true})).toBeVisible({timeout:10000});
  await page.screenshot({path:info.outputPath('recipe-saved-detail.png'),fullPage:true});
  await dialog(page).getByRole('button',{name:'Save meal',exact:true}).click();await expect(dinner(page)).toContainText('2 servings');
  await page.getByRole('link',{name:'Recipe library',exact:true}).click();await expect(page.getByRole('button',{name:/New tomato pasta Serves/})).toHaveCount(0);
  await page.getByLabel('Show archived recipes').check();await page.getByRole('button',{name:/New tomato pasta Serves/}).click();
  await expect(page.getByText('Archived recipe. Saved meals keep their contents.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  for(const button of await page.locator('button:visible').all())expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(wall?56:44);
  if(wall)await expect(page.getByRole('button',{name:'Edit recipe',exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('recipe-archived.png'),fullPage:true});expect(errors).toEqual([]);
});
test('phone creates a recipe, preserves a stale draft, checks a lost save and archives explicitly',async({page},info)=>{
  test.skip(info.project.name!=='phone','Recipe management is phone-only.');test.setTimeout(60000);
  const state=server();await state.connect(page);await page.goto('/recipes');await page.getByRole('button',{name:'New recipe',exact:true}).click();
  await page.getByLabel('Recipe title',{exact:true}).fill('Vegetable soup');
  await page.getByLabel('Ingredient name',{exact:true}).fill('Carrots');
  await page.getByLabel('Numeric quantity',{exact:true}).fill('2.5');
  await page.getByLabel('Unit',{exact:true}).fill('cups');
  await page.getByRole('button',{name:'Add ingredient',exact:true}).click();
  const salt=page.getByRole('region',{name:'Ingredient 2'});await salt.getByLabel('Ingredient name').fill('Salt');await salt.getByLabel('Text quantity').fill('to taste');
  await page.getByLabel('Preparation steps (one per line)').fill('Chop vegetables.\nSimmer and season.');
  state.lose=true;await page.getByRole('button',{name:'Save recipe',exact:true}).click();await expect(page.getByText('Recipe save not confirmed')).toBeVisible();
  await page.getByRole('button',{name:'Close editor',exact:true}).click();await page.getByRole('button',{name:'Check recipe save',exact:true}).click();
  await expect(page.getByRole('button',{name:/Vegetable soup Serves/})).toHaveCount(1);expect(state.recipes.filter(r=>r.content.title==='Vegetable soup')).toHaveLength(1);
  await page.getByRole('button',{name:/Vegetable soup Serves/}).click();await page.getByRole('button',{name:'Edit recipe',exact:true}).click();
  await page.getByLabel('Recipe title',{exact:true}).fill('My soup draft');
  const row=state.recipes.find(r=>r.content.title==='Vegetable soup');row.version='another-device';row.content.notes='Other device notes';state.revision++;state.notify();
  await page.getByRole('button',{name:'Save recipe',exact:true}).click();await expect(page.getByRole('button',{name:'Review latest recipe',exact:true})).toBeVisible();
  await expect(page.getByLabel('Recipe title',{exact:true})).toHaveValue('My soup draft');
  await page.getByRole('button',{name:'Review latest recipe',exact:true}).click();await page.getByRole('button',{name:'Save recipe',exact:true}).click();
  await page.getByRole('button',{name:/My soup draft Serves/}).click();await page.getByRole('button',{name:'Edit recipe',exact:true}).click();
  await page.getByRole('button',{name:'Archive recipe…',exact:true}).click();await expect(page.getByText('Archive “My soup draft”? Saved meal plans keep their recipe contents.')).toBeVisible();
  await page.screenshot({path:info.outputPath('recipe-archive-confirmation.png'),fullPage:true});
  await page.getByRole('button',{name:'Archive recipe',exact:true}).click();await expect(page.getByRole('button',{name:/My soup draft Serves/})).toHaveCount(0);
  expect(state.recipes.find(r=>r.content.title==='My soup draft').archived).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
