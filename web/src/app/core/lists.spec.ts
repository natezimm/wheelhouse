import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HouseholdList, ListsSnapshot, ListsStore } from './lists';

const list: HouseholdList = { id:'l1', creationId:'lc1', name:'Errands', archived:false, version:'lv1', items:[
  { id:'i1', creationId:'ic1', text:'Library books', notes:null, checked:false, deleted:false, version:'iv1', sortOrder:0 },
  { id:'i2', creationId:'ic2', text:'Bike lights', notes:null, checked:false, deleted:false, version:'iv2', sortOrder:1 },
] };
const snapshot = (changeNumber = 1, lists = [structuredClone(list)]): ListsSnapshot => ({ changeNumber, lists });

describe('ListsStore', () => {
  let store: ListsStore; let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers:[provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(ListsStore); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });
  function load() { store.activate(); http.expectOne('/api/lists').flush(snapshot()); }
  function refresh(revision = 2, lists = [structuredClone(list)]) { http.expectOne('/api/lists').flush(snapshot(revision, lists)); }

  it('does no background reads until activated, coalesces gaps and ignores duplicate notifications', () => {
    store.changed(1); http.expectNone('/api/lists'); load();
    store.changed(4); store.changed(5); refresh(4); refresh(5);
    store.changed(5); store.changed(2); http.expectNone('/api/lists');
  });

  it('preserves the optimistic item through live reads and rolls back only a definite failed list', async () => {
    load(); const other = { ...structuredClone(list), id:'l2', creationId:'lc2', name:'Packing' };
    store.refresh(); refresh(2, [structuredClone(list), other]);
    const first = store.add(list, 'Umbrella'); const request = http.expectOne('/api/lists/l1/items');
    expect(store.lists().find(l => l.id === list.id)!.items.at(-1)!.text).toBe('Umbrella');
    const second = store.rename(other, 'Trip'); const rename = http.expectOne('/api/lists/l2');
    store.changed(3); refresh(3, [structuredClone(list), other]);
    expect(store.lists().find(l => l.id === list.id)!.items).toHaveLength(3);
    request.flush({}, { status:403, statusText:'Forbidden' }); await first;
    expect(store.lists().find(l => l.id === list.id)!.items).toHaveLength(2);
    expect(store.lists().find(l => l.id === 'l2')!.name).toBe('Trip');
    refresh(3, [structuredClone(list), other]);
    rename.flush(snapshot(4, [list, { ...other, name:'Trip' }])); await second; refresh(4, [list, { ...other, name:'Trip' }]);
  });

  it('keeps uncertain creates frozen and checks a committed result before repeating a POST', async () => {
    load(); const task = store.add(list, 'Umbrella'); const request = http.expectOne('/api/lists/l1/items');
    const creationId = request.request.body.creationId;
    const committed = { ...structuredClone(list), items:[...structuredClone(list.items), { ...list.items[0], id:'new', creationId, text:'Umbrella' }] };
    request.flush({}, { status:503, statusText:'Unavailable' }); await task;
    expect(store.pending()[0].uncertain).toBe(true);
    const retry = store.retry(store.pending()[0].key); refresh(2, [committed]);
    expect(await retry).toBe(true); refresh(2, [committed]);
    http.expectNone(r => r.method === 'POST'); expect(store.pending()).toHaveLength(0);
  });

  it('reuses an uncommitted create operation ID after checking', async () => {
    load(); const task = store.create('Packing'); const first = http.expectOne('/api/lists'); const body = first.request.body;
    first.error(new ProgressEvent('error')); await task;
    const retry = store.retry(store.pending()[0].key); refresh(1); await Promise.resolve();
    const repeated = http.expectOne(r => r.method === 'POST'); expect(repeated.request.body).toEqual(body);
    repeated.flush(snapshot(2, [list, { ...list, id:'new', creationId:body.creationId, name:'Packing', items:[] }]));
    expect(await retry).toBe(true); refresh(2);
  });

  it('rejects snapshots predating accepted writes and keeps newer command replies', async () => {
    load(); store.refresh(); const old = http.expectOne('/api/lists');
    const task = store.check(list, list.items[0], true); const write = http.expectOne('/api/lists/l1/items/i1/checked');
    const updated = structuredClone(list); updated.items[0].checked = true;
    write.flush(snapshot(3, [updated])); await task;
    old.flush(snapshot(1)); refresh(3, [updated]);
    expect(store.lists()[0].items[0].checked).toBe(true);
    store.refresh(); refresh(2); expect(store.lists()[0].items[0].checked).toBe(true);
  });

  it('ignores late reads and writes after a family reset', async () => {
    load(); const task = store.rename(list, 'Old family'); const write = http.expectOne('/api/lists/l1');
    store.refresh(); const read = http.expectOne('/api/lists'); store.reset();
    store.activate(); refresh(0, []); read.flush(snapshot(9)); write.flush(snapshot(10));
    expect(await task).toBe(false); expect(store.lists()).toEqual([]); expect(store.pending()).toEqual([]);
  });

  it('retains confirmed contents on failed refresh and times out a hung recovery read', async () => {
    vi.useFakeTimers(); load(); store.refresh(); const hung = http.expectOne('/api/lists');
    await vi.advanceTimersByTimeAsync(15_001);
    expect(hung.cancelled).toBe(true); expect(store.refreshing()).toBe(false); expect(store.refreshFailed()).toBe(true);
    expect(store.lists()[0].name).toBe('Errands'); store.refresh(); refresh(2); expect(store.refreshFailed()).toBe(false);
  });

  it('sends explicit checked state and guarded ordering; stale edits remove the overlay', async () => {
    load(); const task = store.move(list, list.items[1], -1); const move = http.expectOne('/api/lists/l1/items/i2/move');
    expect(move.request.body).toEqual({ version:'iv2', listVersion:'lv1', direction:-1 });
    expect(store.lists()[0].items[0].id).toBe('i2');
    move.flush(list, { status:409, statusText:'Conflict' }); await task; refresh(2);
    expect(store.error()).toContain('another device'); expect(store.lists()[0].items[0].id).toBe('i1');
    const check = store.check(list, list.items[0], true); const request = http.expectOne('/api/lists/l1/items/i1/checked');
    expect(request.request.body.checked).toBe(true); request.flush(snapshot(3)); await check; refresh(3);
  });
});
