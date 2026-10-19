import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';
import { HouseholdList } from '../core/lists';
import { ListsStore } from '../core/lists';
import { marlowes } from '../testing/marlowes';
import { ListsPage } from './lists-page';

const initial: HouseholdList[] = [
  { id:'errands', creationId:'e-key', name:'Errands', archived:false, version:'e-v1', items:[
    { id:'item', creationId:'i-key', text:'Books', notes:null, checked:false, deleted:false, sortOrder:0, version:'i-v1' },
  ] },
  { id:'packing', creationId:'p-key', name:'Packing', archived:false, version:'p-v1', items:[] },
];

describe('shared lists screen', () => {
  let fixture: ComponentFixture<ListsPage>; let page: HTMLElement; let http: HttpTestingController;
  const button = (text: string) => [...page.querySelectorAll<HTMLButtonElement>('button')]
    .find(b => b.getAttribute('aria-label') === text || b.textContent?.trim() === text)!;
  const type = async (selector: string, value: string) => {
    const input = page.querySelector<HTMLInputElement>(selector)!; input.value = value; input.dispatchEvent(new Event('input')); await fixture.whenStable();
  };
  const read = (lists = initial, changeNumber = 1) => http.expectOne('/api/lists').flush({ changeNumber, lists:structuredClone(lists) });
  async function settle() { await Promise.resolve(); await Promise.resolve(); fixture.detectChanges(); }
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable:true, value:function(this: HTMLDialogElement) { this.open=true; } });
    TestBed.configureTestingModule({ imports:[ListsPage], providers:[provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide:FamilyStore, useValue:{ load:vi.fn(), family:signal(marlowes), state:signal({ status:'ready', family:marlowes }) } },
      { provide:HouseholdLive, useValue:{ state:signal('connected'), resync:vi.fn() } },
    ] });
    http = TestBed.inject(HttpTestingController); fixture = TestBed.createComponent(ListsPage); page = fixture.nativeElement;
    fixture.detectChanges(); read(); fixture.detectChanges();
  });
  afterEach(() => { http.verify(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); });

  async function loadGrocery() {
    const grocery: HouseholdList = { ...structuredClone(initial[0]), name:'Grocery', isGrocery:true,
      categories:[{ id:'produce', name:'Produce', isOther:false }, { id:'other', name:'Other', isOther:true }],
      items:[{ ...initial[0].items[0], text:'Apples', quantity:'6', unit:null, categoryId:'produce', checked:true }] };
    TestBed.inject(ListsStore).refresh(); read([grocery], 2); await fixture.whenStable(); return grocery;
  }

  it('preserves grocery edit fields through live reads and sends the reviewed category', async () => {
    const grocery = await loadGrocery();
    page.querySelector<HTMLDetailsElement>('details.checked')!.open=true;
    button('Edit Apples').click(); await fixture.whenStable(); await type('input[name=quantity]', '2'); await type('input[name=unit]', 'bags');
    TestBed.inject(ListsStore).refresh(); read([{ ...grocery, version:'latest' }], 3); await fixture.whenStable();
    expect(page.querySelector<HTMLInputElement>('input[name=quantity]')!.value).toBe('2');
    page.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit', { bubbles:true })); fixture.detectChanges();
    const request = http.expectOne('/api/lists/errands/items/item');
    expect(request.request.body).toMatchObject({ quantity:'2', unit:'bags', categoryId:'produce', version:'i-v1' });
    request.flush({ changeNumber:4, lists:[grocery] }); await settle(); read([grocery], 4); await fixture.whenStable();
  });

  it('keeps clear confirmation fixed until explicit review of a conflict', async () => {
    const grocery = await loadGrocery(); button('Clear checked (1)').click(); await fixture.whenStable();
    const newer = structuredClone(grocery); newer.items.push({ ...grocery.items[0], id:'milk', creationId:'mc', text:'Milk', version:'mv' });
    TestBed.inject(ListsStore).refresh(); read([newer], 3); await fixture.whenStable();
    expect(page.querySelector('dialog')!.textContent).toContain('these 1 checked');
    expect(page.querySelector('dialog')!.textContent).not.toContain('Milk');
    page.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit', { bubbles:true })); fixture.detectChanges();
    const request = http.expectOne('/api/lists/errands/clear-checked');
    expect(request.request.body).toEqual({ items:[{ id:'item', version:'i-v1' }] });
    request.flush({}, { status:409, statusText:'Conflict' }); await settle(); read([newer], 3); await fixture.whenStable();
    button('Review latest').click(); await fixture.whenStable();
    expect(page.querySelector('dialog')!.textContent).toContain('these 2 checked'); expect(page.querySelector('dialog')!.textContent).toContain('Milk');
  });

  it('keeps separate quick-add drafts while switching lists', async () => {
    await type('input[name=quickItem]', 'Library bag'); button('Packing0 remaining').click(); await fixture.whenStable();
    await type('input[name=quickItem]', 'Raincoat'); button('Errands1 remaining').click(); await fixture.whenStable();
    expect(page.querySelector<HTMLInputElement>('input[name=quickItem]')!.value).toBe('Library bag');
    button('Packing0 remaining').click(); await fixture.whenStable();
    expect(page.querySelector<HTMLInputElement>('input[name=quickItem]')!.value).toBe('Raincoat');
  });

  it('clears an accepted quick-add even if another editor opens during the save', async () => {
    await type('input[name=quickItem]', 'Umbrella'); page.querySelector<HTMLFormElement>('form.quick-add')!.dispatchEvent(new Event('submit', { bubbles:true })); fixture.detectChanges();
    const write = http.expectOne('/api/lists/errands/items'); button('New list').click(); fixture.detectChanges();
    write.flush({ changeNumber:2, lists:initial }); await settle(); read(initial, 2); await fixture.whenStable();
    expect(page.querySelector<HTMLInputElement>('input[name=quickItem]')!.value).toBe('');
    expect(page.querySelector('dialog')!.open).toBe(true);
  });

  it('preserves a stale draft and shows the authoritative item before explicit review', async () => {
    button('Edit Books').click(); await fixture.whenStable(); await type('input[name=title]', 'My draft');
    page.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit', { bubbles:true })); fixture.detectChanges();
    http.expectOne('/api/lists/errands/items/item').flush(initial[0], { status:409, statusText:'Conflict' }); await settle();
    const current = structuredClone(initial); current[0].items[0].text = 'Changed elsewhere'; current[0].items[0].version = 'i-v2';
    read(current, 2); fixture.detectChanges();
    expect(page.querySelector('dialog')!.textContent).toContain('Latest item: Changed elsewhere');
    expect(page.querySelector<HTMLInputElement>('input[name=title]')!.value).toBe('My draft');
    expect(button('Save').disabled).toBe(true); button('Review latest').click(); fixture.detectChanges(); expect(button('Save').disabled).toBe(false);
  });
});
