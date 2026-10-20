import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock } from '../core/clock';
import { addDays, daysBetween } from '../core/days';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';
import { MEAL_SLOTS, MealsSnapshot, MealsStore } from '../core/meals';
import { marlowes } from '../testing/marlowes';
import { MealsPage } from './meals-page';

const week = '2026-11-02';
function snapshot(from = week, revision = 1) {
  return { from, to:addDays(from, 7), changeNumber:revision, meals:daysBetween(from, addDays(from, 7)).flatMap(date =>
    MEAL_SLOTS.map(slot => ({ date, slot, title:slot === 'Dinner' ? 'Pasta' : null, notes:null, version:slot === 'Dinner' ? date + slot : null }))) };
}
describe('Meal plan screen', () => {
  let fixture: ComponentFixture<MealsPage>; let page: HTMLElement; let http: HttpTestingController;
  const button = (name: string) => [...page.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === name || b.textContent?.trim() === name)!;
  const read = () => http.expectOne(r => r.url === '/api/meals' && r.method === 'GET');
  const type = async (name: string, value: string) => { const input = page.querySelector<HTMLInputElement>('[name=' + name + ']')!; input.value=value; input.dispatchEvent(new Event('input')); await fixture.whenStable(); };
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable:true, value:function(this: HTMLDialogElement) { this.open=true; } });
    TestBed.configureTestingModule({ imports:[MealsPage], providers:[provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide:Clock, useValue:{ now:signal(new Date('2026-11-02T16:00:00Z')) } },
      { provide:FamilyStore, useValue:{ load:vi.fn(), family:signal(marlowes), state:signal({ status:'ready', family:marlowes }) } },
      { provide:HouseholdLive, useValue:{ state:signal('connected'), resync:vi.fn() } }] });
    http = TestBed.inject(HttpTestingController); fixture=TestBed.createComponent(MealsPage); page=fixture.nativeElement;
    fixture.detectChanges(); read().flush(snapshot()); fixture.detectChanges();
  });
  afterEach(() => { http.verify(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); });
  it('preserves a draft through live refresh and requires review after a stale refusal', async () => {
    button('Edit ' + week + ' Dinner').click(); await fixture.whenStable(); await type('title', 'My soup'); await type('notes', 'Keep draft');
    TestBed.inject(MealsStore).refresh(); const newer=snapshot(week, 2); newer.meals[2].title='Other device'; newer.meals[2].version='new-version';
    read().flush(newer); await fixture.whenStable(); expect(page.querySelector<HTMLInputElement>('[name=title]')!.value).toBe('My soup');
    button('Save meal').click(); await Promise.resolve();
    const write = http.expectOne('/api/meals/' + week + '/Dinner'); expect(write.request.body.version).toBe(week + 'Dinner');
    write.flush({}, { status:409, statusText:'Conflict' }); await Promise.resolve(); await Promise.resolve();
    read().flush(newer); await fixture.whenStable();
    expect(page.querySelector('dialog')!.textContent).toContain('Latest meal: Other device'); expect(button('Save meal').disabled).toBe(true);
    button('Review latest').click(); await fixture.whenStable(); expect(page.querySelector<HTMLInputElement>('[name=title]')!.value).toBe('My soup');
    expect(button('Save meal').disabled).toBe(false);
    expect(page.querySelector('dialog')!.textContent).not.toContain('another device');
  });
  it('requires a separate clear confirmation and retains reviewed slot identity', async () => {
    button('Edit ' + week + ' Dinner').click(); await fixture.whenStable(); button('Clear this meal…').click(); await fixture.whenStable();
    expect(page.querySelector('dialog')!.textContent).toContain('Clear “Pasta”'); http.expectNone(r => r.method === 'PUT');
    button('Clear meal').click(); const write = http.expectOne('/api/meals/' + week + '/Dinner');
    expect(write.request.body).toMatchObject({ version:week + 'Dinner', title:null, notes:null });
    write.flush({}, { status:403, statusText:'Forbidden' }); await Promise.resolve(); await Promise.resolve(); read().flush(snapshot()); await fixture.whenStable();
    expect(page.querySelector('dialog')!.textContent).toContain('Clear “Pasta”');
  });
  it('scales saved contents without selecting the mutable recipe and detaches only explicitly', async () => {
    const s: MealsSnapshot = snapshot(week,2);
    s.meals[2] = {...s.meals[2],servings:6,recipe:{id:'recipe',version:'original-recipe',content:{title:'Pasta',defaultServings:4,
      ingredients:[{id:'pasta',name:'Pasta',quantity:400,quantityText:null,unit:'g'},{id:'salt',name:'Salt',quantity:null,quantityText:'to taste',unit:null}],
      steps:['Original instructions'],sourceUrl:null,notes:null}}};
    TestBed.inject(MealsStore).refresh(); read().flush(s); await fixture.whenStable();
    button('Edit '+week+' Dinner').click(); await fixture.whenStable();
    expect(page.querySelector<HTMLInputElement>('[name=title]')!.readOnly).toBe(true);
    expect(page.querySelector('dialog')!.textContent).toContain('600 g'); expect(page.querySelector('dialog')!.textContent).toContain('to taste');
    await type('servings','2'); button('Save meal').click(); const write=http.expectOne(r=>r.method==='PUT');
    expect(write.request.body.servings).toBe(2); expect(write.request.body.recipe).toBeUndefined(); expect(write.request.body.removeRecipe).toBeUndefined();
    write.flush({}, {status:403,statusText:'Forbidden'}); await Promise.resolve(); await Promise.resolve(); read().flush(s); await fixture.whenStable();
    button('Change to free-text meal').click(); await fixture.whenStable(); await type('title','Leftovers');
    button('Save meal').click(); const detached=http.expectOne(r=>r.method==='PUT');
    expect(detached.request.body.removeRecipe).toBe(true); expect(detached.request.body.servings).toBeUndefined();
    detached.flush({}, {status:403,statusText:'Forbidden'}); await Promise.resolve(); await Promise.resolve(); read().flush(s); await fixture.whenStable();
  });
  it('defaults copy choices to empty destinations and freezes the reviewed versions through refresh', async () => {
    button('Copy previous week…').click(); fixture.detectChanges();
    const source=http.expectOne(r => r.url === '/api/meals' && r.params.get('from') === '2026-10-26'); source.flush(snapshot('2026-10-26'));
    const destination=snapshot(); destination.meals[5].title=null; destination.meals[5].version='cleared-slot';
    read().flush(destination); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await fixture.whenStable();
    const boxes=page.querySelectorAll<HTMLInputElement>('dialog input[type=checkbox]');
    expect(boxes).toHaveLength(7); expect(boxes[0].checked).toBe(false); expect(boxes[1].checked).toBe(true);
    boxes[0].click(); await fixture.whenStable();
    TestBed.inject(MealsStore).refresh(); read().flush(snapshot(week, 3)); await fixture.whenStable();
    button('Copy selected meals').click(); const write=http.expectOne('/api/meals/copy');
    expect(write.request.body.items).toHaveLength(2); expect(write.request.body.items[1].targetVersion).toBe('cleared-slot');
    write.flush({}, { status:409, statusText:'Conflict' }); await Promise.resolve(); await Promise.resolve(); read().flush(snapshot(week, 3)); await fixture.whenStable();
    expect(button('Copy selected meals').disabled).toBe(true); expect(page.querySelector('dialog')!.textContent).toContain('resets overwrite selections');
    button('Review latest').click(); fixture.detectChanges();
    http.expectOne(r => r.url === '/api/meals' && r.params.get('from') === '2026-10-26').flush(snapshot('2026-10-26', 3));
    read().flush(snapshot(week, 3)); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await fixture.whenStable();
    expect(page.querySelector('dialog')!.textContent).not.toContain('another device');
    expect([...page.querySelectorAll<HTMLInputElement>('dialog input[type=checkbox]')].every(b => !b.checked)).toBe(true);
  });
});
