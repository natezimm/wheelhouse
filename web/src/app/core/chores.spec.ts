import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Chore, ChoresStore } from './chores';

const day = '2026-11-01';
const chore: Chore = { id: 'c1', creationId: 'create1', title: 'Feed the fish', notes: null, memberId: null,
  dueDate: day, completedAt: null, archived: false, version: 'v1' };
const draft = { title: 'New chore', notes: null, memberId: null, dueDate: day };

describe('ChoresStore', () => {
  let store: ChoresStore;
  let http: HttpTestingController;
  const read = () => http.expectOne(r => r.url === '/api/chores' && r.method === 'GET');
  const snapshot = (revision = 1, items: Chore[] = [chore]) => read().flush({ changeNumber: revision, chores: items, canManage: true });
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(ChoresStore); http = TestBed.inject(HttpTestingController);
    store.select(day); snapshot();
  });
  afterEach(() => http.verify());

  it('uses the server management capability and clears it with family state', () => {
    expect(store.canManage()).toBe(true);
    store.refresh(); read().flush({ changeNumber: 1, chores: [chore], canManage: false });
    expect(store.canManage()).toBe(false);
    store.reset(); expect(store.canManage()).toBe(false);
  });

  it('shows completion immediately and rolls back only a definitely refused operation', async () => {
    const save = store.complete(chore, true);
    expect(store.items()[0].completedAt).not.toBeNull();
    http.expectOne('/api/chores/c1/completion').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(await save).toBe(false);
    expect(store.items()[0].completedAt).toBeNull();
    expect(store.pending()).toHaveLength(0); snapshot();
  });

  it('preserves an optimistic overlay through live snapshots and then accepts the result', async () => {
    const save = store.complete(chore, true);
    const write = http.expectOne('/api/chores/c1/completion');
    store.changed(2); snapshot(2);
    expect(store.items()[0].completedAt).not.toBeNull();
    write.flush({ ...chore, version: 'v2', completedAt: '2026-11-01T15:00:00Z' });
    expect(await save).toBe(true);
    expect(store.items()[0].version).toBe('v2');
    snapshot(3, [{ ...chore, version: 'v2', completedAt: '2026-11-01T15:00:00Z' }]);
  });

  it('does not let an older in-flight snapshot undo an accepted write', async () => {
    store.refresh(); const old = read();
    const save = store.complete(chore, true);
    const done = { ...chore, version: 'v2', completedAt: '2026-11-01T15:00:00Z' };
    http.expectOne('/api/chores/c1/completion').flush(done); await save;
    old.flush({ changeNumber: 1, chores: [chore] });
    expect(store.items()[0].completedAt).not.toBeNull(); snapshot(2, [done]);
  });

  it('reconciles an uncertain create by reading its stable creation ID without another POST', async () => {
    const save = store.create(draft);
    const write = http.expectOne(r => r.method === 'POST');
    const key = write.request.body.creationId;
    write.flush({}, { status: 503, statusText: 'Unavailable' }); await save;
    expect(store.pending()[0].uncertain).toBe(true);
    store.refresh(); snapshot(2, [{ ...chore, ...draft, id: 'server-id', creationId: key }]);
    expect(store.items()).toHaveLength(1); // a snapshot and pending overlay never duplicate the same create
    const retry = store.retry(key);
    http.expectOne(`/api/chores/creation/${key}`).flush({ ...chore, ...draft, id: 'server-id', creationId: key });
    expect(await retry).toBe(true);
    http.expectNone(r => r.method === 'POST'); snapshot(2, [{ ...chore, ...draft, id: 'server-id', creationId: key }]);
    expect(store.pending()).toHaveLength(0);
  });

  it('retries a missing uncertain create with exactly the original request', async () => {
    const save = store.create(draft);
    const write = http.expectOne(r => r.method === 'POST'); const body = write.request.body;
    write.flush({}, { status: 500, statusText: 'Lost response' }); await save;
    const retry = store.retry(body.creationId);
    http.expectOne(`/api/chores/creation/${body.creationId}`).flush(null, { status: 404, statusText: 'Not found' });
    await Promise.resolve();
    const repeated = http.expectOne(r => r.method === 'POST'); expect(repeated.request.body).toEqual(body);
    repeated.flush({ ...chore, ...draft, creationId: body.creationId });
    expect(await retry).toBe(true); snapshot(2);
  });

  it('keeps an uncertain command frozen when checking fails', async () => {
    const save = store.complete(chore, true);
    http.expectOne('/api/chores/c1/completion').flush({}, { status: 503, statusText: 'Lost response' }); await save;
    const op = store.pending()[0]; const retry = store.retry(op.key);
    http.expectOne('/api/chores/c1').flush({}, { status: 503, statusText: 'Offline' });
    expect(await retry).toBe(false); expect(store.pending()[0].uncertain).toBe(true);
    http.expectNone(r => r.method === 'PUT');
  });

  it('shows a conflict and keeps confirmed server data instead of silently overwriting', async () => {
    const save = store.edit(chore, draft);
    http.expectOne('/api/chores/c1').flush({ ...chore, title: 'Someone else edited' }, { status: 409, statusText: 'Conflict' });
    expect(await save).toBe(false); expect(store.error()).toContain('another device');
    snapshot(2, [{ ...chore, title: 'Someone else edited' }]);
    expect(store.items()[0].title).toBe('Someone else edited');
  });

  it('keeps the last snapshot when recovery fails and coalesces newer revisions', () => {
    store.changed(2); store.changed(3); store.changed(4);
    read().flush({}, { status: 503, statusText: 'Offline' });
    snapshot(4);
    expect(store.items()[0].title).toBe(chore.title);
    store.changed(4); http.expectNone(r => r.url === '/api/chores');
    store.refresh(); read().flush({}, { status: 503, statusText: 'Offline' });
    expect(store.refreshFailed()).toBe(true); expect(store.ready()).toBe(true);
  });

  it('ignores old family responses after reset', async () => {
    const save = store.complete(chore, true); const write = http.expectOne('/api/chores/c1/completion');
    store.refresh(); const old = read(); store.reset();
    write.flush({ ...chore, completedAt: '2026-11-01T15:00:00Z' }); expect(await save).toBe(false);
    old.flush({ changeNumber: 100, chores: [chore] });
    expect(store.items()).toEqual([]); expect(store.pending()).toEqual([]); expect(store.ready()).toBe(false);
    store.select(day); snapshot(1, []); expect(store.items()).toEqual([]);
  });

  it('loads the selected day after a queued range change without accepting the earlier day', () => {
    store.refresh(); const old = read(); store.select('2026-11-02');
    old.flush({ changeNumber: 2, chores: [{ ...chore, completedAt: '2026-11-01T15:00:00Z' }] });
    const next = read(); expect(next.request.params.get('date')).toBe('2026-11-02');
    next.flush({ changeNumber: 2, chores: [] });
    expect(store.items()).toEqual([]);
  });

  const repeat = { frequency: 'Daily' as const, intervalWeeks: 1, weekdays: [], endsOn: null };
  const recurring: Chore = { ...chore, id: 'repeat', creationId: 'repeat-key', repeat, definitionVersion: 'definition-v1',
    editDraft: { ...draft, title: chore.title, dueDate: '2026-10-01', repeat } };

  it('locks completion per date while protecting schedule edits across all dates', async () => {
    store.refresh(); snapshot(1, [recurring]);
    const first = store.complete(recurring, true);
    const write1 = http.expectOne('/api/chores/repeat/completion?date=2026-11-01');
    store.select('2026-11-02'); const next = { ...recurring, dueDate: '2026-11-02', version: 'next-occurrence' }; snapshot(1, [next]);
    expect(store.items()[0].completedAt).toBeNull(); expect(store.isPending('repeat')).toBe(false);
    const second = store.complete(next, true);
    const write2 = http.expectOne('/api/chores/repeat/completion?date=2026-11-02');
    expect(store.pending()).toHaveLength(2);
    expect(await store.edit(next, draft)).toBe(false);
    write1.flush({}, { status: 403, statusText: 'Forbidden' }); await first;
    write2.flush({}, { status: 403, statusText: 'Forbidden' }); await second;
    snapshot(1, [next]); snapshot(1, [next]); expect(store.pending()).toHaveLength(0);
  });

  it('checks the original occurrence date after navigating away from an uncertain save', async () => {
    store.refresh(); snapshot(1, [recurring]);
    const save = store.complete(recurring, true);
    http.expectOne('/api/chores/repeat/completion?date=2026-11-01').flush({}, { status: 503, statusText: 'Lost response' }); await save;
    const key = store.pending()[0].key;
    store.select('2026-11-02'); const next = { ...recurring, dueDate: '2026-11-02', version: 'next-occurrence' }; snapshot(2, [next]);
    const retry = store.retry(key);
    http.expectOne('/api/chores/repeat?date=2026-11-01').flush({ ...recurring, completedAt: '2026-11-01T15:00:00Z', version: 'done' });
    expect(await retry).toBe(true); expect(store.items()[0].completedAt).toBeNull();
    http.expectNone(r => r.method === 'PUT'); snapshot(2, [next]);
  });

  it('uses the definition version for future edits without changing the current occurrence', async () => {
    store.refresh(); snapshot(1, [recurring]);
    const edited = { ...recurring.editDraft!, title: 'Future title' };
    const save = store.edit(recurring, edited);
    expect(store.items()[0].title).toBe(chore.title); expect(store.items()[0].dueDate).toBe(day);
    const write = http.expectOne('/api/chores/repeat?date=2026-11-01'); expect(write.request.body.version).toBe('definition-v1');
    const response = { ...recurring, editDraft: edited, definitionVersion: 'definition-v2', nextChangeDate: '2026-11-02' };
    write.flush(response); expect(await save).toBe(true); snapshot(2, [response]);
    expect(store.items()[0].title).toBe(chore.title); expect(store.items()[0].editDraft?.title).toBe('Future title');
  });

  it('retains today when archiving a schedule and reconciles the series archive flag', async () => {
    store.refresh(); snapshot(1, [recurring]);
    const save = store.archive(recurring); expect(store.items()).toHaveLength(1);
    const write = http.expectOne('/api/chores/repeat/archive?date=2026-11-01'); expect(write.request.body.version).toBe('definition-v1');
    write.flush({}, { status: 503, statusText: 'Lost response' }); await save;
    const retry = store.retry(store.pending()[0].key);
    const archived = { ...recurring, seriesArchived: true, stopsOn: '2026-11-02' };
    http.expectOne('/api/chores/repeat?date=2026-11-01').flush(archived);
    expect(await retry).toBe(true); snapshot(2, [archived]); expect(store.items()).toHaveLength(1);
  });

  it('never rolls recurring misses into the next date while one-time overdue work remains', () => {
    store.refresh(); snapshot(1, [recurring, { ...chore, dueDate: '2026-10-31' }]);
    store.select('2026-11-02');
    expect(store.items().map(c => c.id)).toEqual([chore.id]); snapshot(1, []);
  });

  it('does not preview a new schedule on an unselected weekday', async () => {
    const weekly = { frequency: 'Weekly' as const, intervalWeeks: 1, weekdays: [1], endsOn: null };
    const save = store.create({ ...draft, dueDate: '2026-10-19', repeat: weekly });
    expect(store.items()).toHaveLength(1);
    const write = http.expectOne('/api/chores?date=2026-11-01');
    write.flush({ ...recurring, creationId: write.request.body.creationId, visible: false, repeat: weekly });
    expect(await save).toBe(true); snapshot(2, [chore]); expect(store.items()).toHaveLength(1);
  });
});
