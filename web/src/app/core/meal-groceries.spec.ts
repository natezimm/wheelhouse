import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GroceryChoice,MealGroceriesStore,compatibleIngredient,numericQuantity } from './meal-groceries';
import { groceryPreview } from '../testing/meal-groceries';
const choice=():GroceryChoice=>({date:'2026-11-02',slot:'Dinner',mealVersion:'meal1',snapshotKey:'a'.repeat(64),ingredientId:'i1',quantity:600,
  quantityText:null,previousCount:0,allowAdditional:false,targetItemId:'pasta',targetVersion:'p1'});
describe('MealGroceriesStore',()=>{
  let store:MealGroceriesStore;let http:HttpTestingController;
  const read=()=>http.expectOne(r=>r.url==='/api/meals/groceries'&&r.method==='GET');
  beforeEach(()=>{TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});store=TestBed.inject(MealGroceriesStore);http=TestBed.inject(HttpTestingController);});
  afterEach(()=>http.verify());
  function load(){store.select('2026-11-02','2026-11-09');read().flush(groceryPreview());}
  it('only offers exact numeric compatible unchecked items and does not parse quantity text or convert units',()=>{
    const p=groceryPreview(),line=p.meals[0].ingredients[0],item=p.grocery.items[0];
    expect(compatibleIngredient({...line,name:' pasta ',unit:' G '},item)).toBe(true);
    expect(compatibleIngredient({...line,unit:'kg'},item)).toBe(false);
    expect(compatibleIngredient(line,{...item,checked:true})).toBe(false);
    expect(compatibleIngredient({...line,quantity:null,quantityText:'2'},item)).toBe(false);
    for(const text of ['1,000','1e3','to taste','-1'])expect(numericQuantity(text)).toBeNull();
    expect(numericQuantity('0')).toBe(0);
  });
  it('coalesces both revision domains and ignores old range responses while preserving submitted intent',async()=>{
    load();const item=choice(),task=store.add(groceryPreview(),[item],false),write=http.expectOne(r=>r.method==='POST');
    item.quantity=999;expect(write.request.body.items[0].quantity).toBe(600);
    store.changed('meals',3);store.changed('lists',4);const s=groceryPreview(3);s.listsChangeNumber=4;read().flush(s);read().flush(s);
    expect(store.pending()?.body.items[0].quantity).toBe(600);
    write.flush({}, {status:409,statusText:'Conflict'});expect(await task).toBe(false);read().flush(s);
    expect(store.error()).toContain('Review latest');expect(store.pending()).toBeNull();
    store.refresh();const old=read();store.select('2026-11-09','2026-11-16');read().flush(groceryPreview(4,'2026-11-09'));
    old.flush(groceryPreview(99));expect(store.snapshot()?.from).toBe('2026-11-09');
  });
  it('checks original source range and retries the exact receipt after navigation and a lost response',async()=>{
    load();const task=store.add(groceryPreview(),[choice()],true);const write=http.expectOne(r=>r.method==='POST'),body=write.request.body;
    write.flush({}, {status:503,statusText:'Lost'});expect(await task).toBe(false);
    store.select('2026-11-09','2026-11-16');read().flush(groceryPreview(2,'2026-11-09'));
    const check=store.retry();const checkRead=read();expect(checkRead.request.params.get('from')).toBe('2026-11-02');checkRead.flush(groceryPreview(3));
    await Promise.resolve();await Promise.resolve();const retry=http.expectOne(r=>r.method==='POST');expect(retry.request.body).toEqual(body);
    retry.flush({id:body.commandId,ingredientCount:1,itemIds:['pasta'],addedAt:'2026-11-02T16:00:00Z'});expect(await check).toBe(true);
    read().flush(groceryPreview(3,'2026-11-09'));expect(store.pending()).toBeNull();expect(store.result()?.id).toBe(body.commandId);
  });
  it('clears family state and ignores late writes and reads, retaining accepted data on failed refresh',async()=>{
    load();const task=store.add(groceryPreview(),[choice()],false),write=http.expectOne(r=>r.method==='POST');store.refresh();const old=read();
    store.reset();store.select('2026-11-02','2026-11-09');read().flush(groceryPreview(2));
    write.flush({id:write.request.body.commandId,ingredientCount:1,itemIds:['old'],addedAt:'now'});old.flush(groceryPreview(99));
    expect(await task).toBe(false);expect(store.result()).toBeNull();store.refresh();read().flush({}, {status:503,statusText:'Offline'});
    expect(store.snapshot()?.mealsChangeNumber).toBe(2);expect(store.refreshFailed()).toBe(true);
  });
});
