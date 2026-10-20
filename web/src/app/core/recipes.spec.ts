import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Recipe, RecipesSnapshot, RecipesStore, ingredientQuantity } from './recipes';

const recipe = (): Recipe => ({id:'r1',version:'v1',archived:false,content:{title:'Pasta',defaultServings:4,
  ingredients:[{id:'i1',name:'Pasta',quantity:400,quantityText:null,unit:'g'},{id:'i2',name:'Salt',quantity:null,quantityText:'to taste',unit:null}],
  steps:['Cook pasta'],sourceUrl:null,notes:null}});
const snapshot = (revision=1, row=recipe()): RecipesSnapshot => ({changeNumber:revision,recipes:[row],canManage:true});
describe('RecipesStore',() => {
  let store: RecipesStore; let http: HttpTestingController;
  const read = () => http.expectOne(r => r.method === 'GET' && r.url === '/api/recipes');
  beforeEach(() => { TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]}); store=TestBed.inject(RecipesStore); http=TestBed.inject(HttpTestingController); });
  afterEach(() => http.verify());
  const load = () => { store.activate(); read().flush(snapshot()); };
  it('scales only numeric quantities, including zero, without changing the recipe',() => {
    const r=recipe(); expect(ingredientQuantity(r.content.ingredients[0],6,4)).toBe('600');
    expect(ingredientQuantity(r.content.ingredients[1],6,4)).toBe('to taste');
    expect(ingredientQuantity({...r.content.ingredients[0],quantity:0},6,4)).toBe('0');
    expect(r.content.ingredients[0].quantity).toBe(400);
  });
  it('stays inactive until opened, coalesces hints and preserves frozen pending drafts through refresh',async() => {
    store.changed(1); store.refresh(); http.expectNone('/api/recipes'); load();
    const draft=recipe().content; draft.title='Soup'; const task=store.save('r1','v1',false,draft);
    const write=http.expectOne(r=>r.method==='PUT'); draft.title='Changed local';
    store.changed(3); store.changed(4); read().flush(snapshot(3)); read().flush(snapshot(4));
    expect(store.recipes()[0].content.title).toBe('Soup'); expect(write.request.body.content.title).toBe('Soup');
    write.flush({}, {status:409,statusText:'Conflict'}); expect(await task).toBe(false); read().flush(snapshot(4));
    expect(store.recipes()[0].content.title).toBe('Pasta'); expect(store.error()).toContain('another device');
    store.changed(4); http.expectNone('/api/recipes');
  });
  it('checks and reuses the exact command after a lost response without reapplying local content',async() => {
    load(); const task=store.save('r1','v1',true,recipe().content); const write=http.expectOne(r=>r.method==='PUT'), body=write.request.body;
    write.flush({}, {status:503,statusText:'Lost'}); expect(await task).toBe(false);
    expect(store.pending()[0].uncertain).toBe(true); const retry=store.retry(store.pending()[0].key);
    read().flush(snapshot(3,{...recipe(),version:'newer',content:{...recipe().content,title:'Newer edit'}}));
    await Promise.resolve(); await Promise.resolve();
    const repeated=http.expectOne(r=>r.method==='PUT'); expect(repeated.request.body).toEqual(body);
    repeated.flush(snapshot(3,{...recipe(),version:'newer',content:{...recipe().content,title:'Newer edit'}})); expect(await retry).toBe(true);
    read().flush(snapshot(3,{...recipe(),version:'newer',content:{...recipe().content,title:'Newer edit'}}));
    expect(store.recipes()[0].content.title).toBe('Newer edit'); expect(store.pending()).toHaveLength(0);
  });
  it('rejects backwards reads and ignores all late replies after changing family',async() => {
    load(); const task=store.save('r1','v1',false,recipe().content), write=http.expectOne(r=>r.method==='PUT');
    store.refresh(); const old=read(); store.reset(); store.activate(); read().flush(snapshot(2));
    write.flush(snapshot(99)); old.flush(snapshot(99)); expect(await task).toBe(false);
    expect(store.pending()).toHaveLength(0); store.refresh(); read().flush(snapshot(1)); expect(store.refreshFailed()).toBe(true);
    expect(store.recipes()[0].content.title).toBe('Pasta');
  });
});
