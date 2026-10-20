import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture,TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock } from '../core/clock';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';
import { MealGroceriesStore } from '../core/meal-groceries';
import { groceryPreview } from '../testing/meal-groceries';
import { marlowes } from '../testing/marlowes';
import { MealGroceriesPage } from './meal-groceries-page';

describe('Meal groceries review',()=>{
  let fixture:ComponentFixture<MealGroceriesPage>,page:HTMLElement,http:HttpTestingController;
  const family=signal(marlowes);
  const button=(name:string)=>[...page.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name)!;
  const read=()=>http.expectOne(r=>r.url==='/api/meals/groceries'&&r.method==='GET');
  const quantity=()=>page.querySelector<HTMLInputElement>('[aria-label="Quantity for Pasta on 2026-11-02 Dinner"]')!;
  beforeEach(()=>{
    Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
    family.set(marlowes);TestBed.configureTestingModule({imports:[MealGroceriesPage],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([]),
      {provide:Clock,useValue:{now:signal(new Date('2026-11-02T16:00:00Z'))}},
      {provide:FamilyStore,useValue:{family,state:signal({status:'ready',family:marlowes}),load:vi.fn()}},
      {provide:HouseholdLive,useValue:{state:signal('connected'),resync:vi.fn()}}]});
    http=TestBed.inject(HttpTestingController);fixture=TestBed.createComponent(MealGroceriesPage);page=fixture.nativeElement;
    fixture.detectChanges();read().flush(groceryPreview());fixture.detectChanges();
  });
  afterEach(()=>{http.verify();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');});
  it('preserves edited quantities and merge choices through recovery and requires reviewing after a stale refusal',async()=>{
    quantity().value='450';quantity().dispatchEvent(new Event('input'));await fixture.whenStable();
    const target=page.querySelector<HTMLSelectElement>('select')!;target.value='pasta';target.dispatchEvent(new Event('change'));await fixture.whenStable();
    family.set({...marlowes});TestBed.inject(MealGroceriesStore).refresh();const newer=groceryPreview(2);newer.grocery.items[0].version='p2';newer.grocery.items[0].quantity='5';
    read().flush(newer);await fixture.whenStable();expect(quantity().value).toBe('450');expect(target.value).toBe('pasta');
    button('Review addition…').click();await fixture.whenStable();expect(page.querySelector('dialog')!.textContent).toContain('452');
    button('Add groceries').click();const write=http.expectOne(r=>r.method==='POST');expect(write.request.body.items[0]).toMatchObject({quantity:450,targetVersion:'p1'});
    write.flush({}, {status:409,statusText:'Conflict'});await Promise.resolve();await Promise.resolve();read().flush(newer);await fixture.whenStable();
    expect(button('Review addition…').disabled).toBe(true);expect(quantity().value).toBe('450');
    button('Review latest').click();await fixture.whenStable();expect(quantity().value).toBe('600');expect(page.querySelector<HTMLSelectElement>('select')!.value).toBe('');
  });
  it('defaults previous ingredients off, requires explicit additional purchase and explains free-text meals',async()=>{
    const p=groceryPreview(2);p.meals[0].ingredients[0].previousCount=1;
    TestBed.inject(MealGroceriesStore).refresh();read().flush(p);await fixture.whenStable();button('Review latest').click();await fixture.whenStable();
    const checkbox=page.querySelector<HTMLInputElement>('[aria-label="Include Pasta for 2026-11-02 Dinner"]')!;
    expect(checkbox.checked).toBe(false);expect(page.textContent).toContain('This is a free-text meal');
    checkbox.click();await fixture.whenStable();expect(button('Review addition…').disabled).toBe(true);
    const again=[...page.querySelectorAll('label')].find(l=>l.textContent?.includes('Buy this ingredient again'))!.querySelector<HTMLInputElement>('input')!;
    again.click();await fixture.whenStable();expect(button('Review addition…').disabled).toBe(false);
  });
});
