import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { addDays, daysBetween } from './days';
import { MEAL_SLOTS, Meal, MealsSnapshot, MealsStore } from './meals';

export function mealSnapshot(from = '2026-11-01', count = 7, changeNumber = 1): MealsSnapshot {
  return { from, to:addDays(from, count), changeNumber, meals:daysBetween(from, addDays(from, count)).flatMap(date =>
    MEAL_SLOTS.map(slot => ({ date, slot, title:slot === 'Dinner' ? 'Pasta' : null, notes:null, version:slot === 'Dinner' ? date + slot : null }))) };
}

describe('MealsStore', () => {
  let store: MealsStore; let http: HttpTestingController;
  const read = () => http.expectOne(r => r.method === 'GET' && r.url === '/api/meals');
  const flush = (s = mealSnapshot()) => read().flush(s);
  beforeEach(() => { TestBed.configureTestingModule({ providers:[provideHttpClient(), provideHttpClientTesting()] }); store = TestBed.inject(MealsStore); http = TestBed.inject(HttpTestingController); });
  afterEach(() => { http.verify(); vi.useRealTimers(); });
  function load() { store.select('2026-11-01', '2026-11-08'); flush(); }
  const dinner = () => mealSnapshot().meals[2];

  it('coalesces notifications, ignores duplicates and preserves pending intent through live reads', async () => {
    load(); const m = dinner(), task = store.save(m, 'Soup', 'Bread');
    const write = http.expectOne('/api/meals/' + m.date + '/Dinner');
    store.changed(3); store.changed(4); flush(mealSnapshot(undefined, 7, 3)); flush(mealSnapshot(undefined, 7, 4));
    expect(store.meals()[2].title).toBe('Soup');
    write.flush({}, { status:403, statusText:'Forbidden' }); expect(await task).toBe(false);
    flush(mealSnapshot(undefined, 7, 4)); expect(store.meals()[2].title).toBe('Pasta');
    store.changed(4); http.expectNone(r => r.method === 'GET');
  });
  it('ignores an older range reply after navigating away and back', () => {
    store.select('2026-11-01', '2026-11-08'); const old = read();
    store.select('2026-11-08', '2026-11-15'); const away = read();
    store.select('2026-11-01', '2026-11-08'); flush(mealSnapshot(undefined, 7, 5));
    old.flush(mealSnapshot(undefined, 7, 1)); away.flush(mealSnapshot('2026-11-08', 7, 2));
    expect(store.meals()[0].date).toBe('2026-11-01'); expect(store.ready()).toBe(true);
  });
  it('checks the original day after navigation and retries the exact receipted command', async () => {
    load(); const m = dinner(), task = store.save(m, 'Soup', null); const write = http.expectOne('/api/meals/' + m.date + '/Dinner');
    const frozen = write.request.body; write.flush({}, { status:503, statusText:'Lost' }); await task;
    store.select('2026-11-08', '2026-11-15'); flush(mealSnapshot('2026-11-08'));
    const retry = store.retry(store.pending()[0].key); const check = read();
    expect(check.request.params.get('from')).toBe(m.date); check.flush(mealSnapshot(m.date, 1, 2)); await Promise.resolve(); await Promise.resolve();
    const repeated = http.expectOne('/api/meals/' + m.date + '/Dinner'); expect(repeated.request.body).toEqual(frozen);
    repeated.flush(mealSnapshot(m.date, 1, 3)); expect(await retry).toBe(true); flush(mealSnapshot('2026-11-08', 7, 3));
    expect(store.meals()[0].date).toBe('2026-11-08');
  });
  it('keeps copy source/target versions and only overlays selected destinations', async () => {
    load(); const source = { ...dinner(), date:'2026-10-25', title:'Tacos', version:'source-v' }, target = dinner();
    const task = store.copy('2026-10-25', '2026-11-01', [{ source, target }]); const write = http.expectOne('/api/meals/copy');
    expect(write.request.body.items).toEqual([{ date:source.date, slot:'Dinner', sourceVersion:'source-v', targetVersion:target.version }]);
    source.title = 'Changed local object'; expect(store.meals()[2].title).toBe('Tacos'); expect(store.meals()[5].title).toBe('Pasta');
    write.flush({}, { status:409, statusText:'Conflict' }); await task; flush();
    expect(store.meals()[2].title).toBe('Pasta'); expect(store.error()).toContain('another device');
  });
  it('discards late responses and pending operations on family reset', async () => {
    load(); const task = store.save(dinner(), 'Old family', null); const write = http.expectOne(r => r.method === 'PUT');
    store.refresh(); const old = read(); store.reset(); store.select('2026-11-01', '2026-11-08'); flush();
    write.flush(mealSnapshot('2026-11-01', 1, 99)); old.flush(mealSnapshot(undefined, 7, 99));
    expect(await task).toBe(false); expect(store.pending()).toHaveLength(0); expect(store.meals()[2].title).toBe('Pasta');
  });
  it('retains a last good snapshot on timeout and refuses backwards snapshots', async () => {
    vi.useFakeTimers(); load(); store.refresh(); const hung = read(); await vi.advanceTimersByTimeAsync(15001);
    expect(hung.cancelled).toBe(true); expect(store.refreshFailed()).toBe(true); expect(store.meals()).toHaveLength(21);
    store.refresh(); flush(mealSnapshot(undefined, 7, 0)); expect(store.meals()).toHaveLength(21); expect(store.refreshFailed()).toBe(true);
  });
  it('sends an explicit versioned clear and locks only overlapping slots', async () => {
    load(); const m = dinner(); const task = store.save(m, null, null); const write = http.expectOne(r => r.method === 'PUT');
    expect(write.request.body).toMatchObject({ version:m.version, title:null, notes:null }); expect(store.meals()[2].title).toBeNull();
    expect(await store.save(m, 'Blocked', null)).toBe(false);
    const result = mealSnapshot(m.date, 1, 2); result.meals[2] = { ...m, title:null, notes:null, version:'empty-v' };
    write.flush(result); await task; const full = mealSnapshot(undefined, 7, 2); full.meals[2] = result.meals[2]; flush(full);
    expect(store.meals()[2].version).toBe('empty-v');
  });
});
