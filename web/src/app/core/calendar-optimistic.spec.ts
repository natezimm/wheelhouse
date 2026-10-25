import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CalendarEvent, CalendarStore, EventRequest } from './calendar';
import { FamilyStore } from './family';
import { instantAt, previewOccurrences } from './calendar-preview';
import { allDay, marloweCalendars, timed } from '../testing/calendar';
import { marlowes } from '../testing/marlowes';

const zone = 'America/New_York';
const first = {
  ...timed('Practice', 'm3', '2026-10-12T21:00:00Z', '2026-10-12T22:00:00Z'),
  recurring: true,
  seriesId: 'series-a',
};
const second = {
  ...first,
  id: 'second',
  startsAt: '2026-10-14T21:00:00Z',
  endsAt: '2026-10-14T22:00:00Z',
};
const unrelated = allDay('Other event', null, '2026-10-13', '2026-10-14');
const draft = (title = 'Changed'): EventRequest => ({
  calendarId: 'c3',
  title,
  location: null,
  allDay: false,
  startDate: '2026-10-12',
  startTime: '18:00:00',
  endDate: '2026-10-12',
  endTime: '19:00:00',
  repeat: 'Never',
});

describe('optimistic calendar operations', () => {
  let store: CalendarStore;
  let http: HttpTestingController;
  const snapshot = (events: CalendarEvent[], changeNumber = 1) => ({
    calendars: marloweCalendars,
    events,
    changeNumber,
    needsReconnect: false,
  });
  const read = () => http.expectOne((r) => r.url === '/api/calendar');
  const fail = (method: string, status = 400) =>
    http
      .expectOne((r) => r.method === method)
      .flush({ errors: { title: ['Try a different title.'] } }, { status, statusText: 'Refused' });
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(CalendarStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(FamilyStore).load();
    http.expectOne('/api/family').flush(marlowes);
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot([first, second, unrelated]));
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('renders an addition before the response, correlates live echoes, and replaces its temporary id', () => {
    store.add(draft('New'), '11111111-1111-4111-8111-111111111111').subscribe();
    const post = http.expectOne((r) => r.method === 'POST');
    const temporary = store.events().find((e) => e.title === 'New')!;
    expect(temporary.id).toMatch(/^pending:/);
    expect(temporary.startsAt).toBe('2026-10-12T22:00:00.000Z');
    expect(store.isPending(temporary.id)).toBe(true);
    const stored = { ...temporary, id: 'stored', pending: undefined };
    store.changed(2);
    read().flush(snapshot([first, second, unrelated, stored], 2));
    expect(store.events().filter((e) => e.title === 'New')).toHaveLength(1);
    post.flush(stored);
    read().flush(snapshot([first, second, unrelated, stored], 2));
    expect(store.pending()).toHaveLength(0);
    expect(store.events().find((e) => e.title === 'New')!.id).toBe('stored');
  });

  it('layers edits over live snapshots and rolls back only a refused operation', () => {
    store.update(first.id, draft('Changed')).subscribe({ error: () => {} });
    const put = http.expectOne((r) => r.method === 'PUT');
    store
      .add({ ...draft('Another pending'), startDate: '2026-10-15', endDate: '2026-10-15' })
      .subscribe({ error: () => {} });
    const post = http.expectOne((r) => r.method === 'POST');
    store.changed(2);
    read().flush(snapshot([{ ...first, location: 'Server room' }, second, unrelated], 2));
    expect(store.events().find((e) => e.id === first.id)!.title).toBe('Changed');
    put.flush(null, { status: 403, statusText: 'Forbidden' });
    expect(store.events().find((e) => e.id === first.id)!.location).toBe('Server room');
    expect(store.events().some((e) => e.title === 'Another pending')).toBe(true);
    post.flush(null, { status: 400, statusText: 'Bad request' });
    expect(store.pending()).toHaveLength(0);
  });

  it('removes immediately and restores the latest confirmed event on a definitive failure', () => {
    store.remove(first.id).subscribe({ error: () => {} });
    expect(store.events().some((e) => e.id === first.id)).toBe(false);
    store.changed(2);
    read().flush(snapshot([{ ...first, title: 'External change' }, second], 2));
    fail('DELETE', 403);
    expect(store.events().find((e) => e.id === first.id)!.title).toBe('External change');
  });

  it('previews a whole series across loaded occurrences, including regenerated ids', () => {
    store.update(first.id, { ...draft('New series'), calendarId: 'c2' }, true).subscribe();
    expect(
      store
        .events()
        .filter((e) => e.seriesId === 'series-a')
        .every((e) => e.title === 'New series' && e.memberId === 'm2'),
    ).toBe(true);
    expect(store.events().find((e) => e.id === second.id)!.startsAt).toBe(
      '2026-10-14T22:00:00.000Z',
    );
    store.changed(2);
    read().flush(
      snapshot(
        [{ ...first, id: 'regenerated-one' }, { ...second, id: 'regenerated-two' }, unrelated],
        2,
      ),
    );
    expect(store.events().filter((e) => e.seriesId === 'series-a')).toHaveLength(2);
    expect(store.isPending('regenerated-two')).toBe(true);
    const changed = {
      ...first,
      id: 'regenerated-one',
      title: 'New series',
      calendarId: 'c2',
      memberId: 'm2',
      startsAt: '2026-10-12T22:00:00Z',
      endsAt: '2026-10-12T23:00:00Z',
    };
    http.expectOne((r) => r.method === 'PUT').flush(changed);
    read().flush(
      snapshot(
        [
          changed,
          {
            ...changed,
            id: 'regenerated-two',
            startsAt: '2026-10-14T22:00:00Z',
            endsAt: '2026-10-14T23:00:00Z',
          },
          unrelated,
        ],
        2,
      ),
    );
    expect(store.pending()).toHaveLength(0);
  });

  it('hides every occurrence during a series delete without hiding an unrelated event', () => {
    store.remove(first.id, true).subscribe({ error: () => {} });
    expect(store.events()).toEqual([unrelated]);
    fail('DELETE');
    expect(store.events()).toHaveLength(3);
  });

  it('blocks overlapping changes to the same event or whole series while allowing unrelated saves', () => {
    store.update(first.id, draft()).subscribe({ error: () => {} });
    let refused = false;
    store.remove(second.id, true).subscribe({ error: () => (refused = true) });
    expect(refused).toBe(true);
    http.expectNone((r) => r.method === 'DELETE');
    store.remove(unrelated.id).subscribe({ error: () => {} });
    fail('DELETE');
    fail('PUT');
  });

  it('keeps a series preview when its first-event response arrives before the snapshot', () => {
    store.add({ ...draft('Repeating'), repeat: 'Daily' }).subscribe();
    expect(store.events().filter((e) => e.title === 'Repeating')).toHaveLength(7);
    http
      .expectOne((r) => r.method === 'POST')
      .flush({ ...first, title: 'Repeating', creationId: store.pending()[0].id });
    expect(store.events().filter((e) => e.title === 'Repeating')).toHaveLength(7);
    read().flush(snapshot([first, second, unrelated], 2));
  });

  it('retains a timed-out create and reconciles before retrying the same id and frozen payload', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    store.add(draft('Uncertain'), id).subscribe({ error: () => {} });
    const firstPost = http.expectOne((r) => r.method === 'POST');
    firstPost.error(new ProgressEvent('error'));
    expect(store.isUncertain(id)).toBe(true);
    store.add(draft('Changed after timeout'), id).subscribe();
    http.expectNone((r) => r.method === 'POST');
    read().flush(snapshot([first, second, unrelated]));
    const retry = http.expectOne((r) => r.method === 'POST');
    expect(retry.request.body).toMatchObject({ title: 'Uncertain', creationId: id });
    retry.flush({ ...first, id: 'created', title: 'Uncertain', creationId: id });
    read().flush(snapshot([first, second, unrelated], 2));
  });

  it('finishes an uncertain create from the server snapshot without posting it again', () => {
    store.add(draft('Uncertain'), 'request').subscribe({ error: () => {} });
    http.expectOne((r) => r.method === 'POST').error(new ProgressEvent('error'));
    store.retry('request').subscribe();
    const created = { ...first, id: 'created', creationId: 'request' };
    read().flush(snapshot([created], 2));
    http.expectNone((r) => r.method === 'POST');
    read().flush(snapshot([created], 2));
    expect(store.pending()).toHaveLength(0);
  });

  it('does not overwrite an external edit while reconciling an uncertain update', () => {
    store.update(first.id, draft(), false, 'operation').subscribe({ error: () => {} });
    http.expectOne((r) => r.method === 'PUT').error(new ProgressEvent('error'));
    let conflict = false;
    store.retry('operation').subscribe({ error: (error) => conflict = error.status === 409 });
    read().flush(snapshot([{ ...first, title: 'Edited elsewhere' }], 2));
    expect(conflict).toBe(true);
    http.expectNone((r) => r.method === 'PUT');
    read().flush(snapshot([{ ...first, title: 'Edited elsewhere' }, second, unrelated], 2));
    expect(store.events().find((e) => e.id === first.id)!.title).toBe('Edited elsewhere');
  });

  it('shows an event that starts to repeat as its new series until a snapshot replaces it', () => {
    const daily: EventRequest = { ...draft('Reading time'), allDay: true, calendarId: 'c4', startDate: '2026-10-13', startTime: null, endDate: '2026-10-14', endTime: null, repeat: 'Daily' };
    store.update(unrelated.id, daily).subscribe();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body).toMatchObject({ repeat: 'Daily' });
    const shown = store.events().filter((e) => e.title === 'Reading time');
    expect(shown.map((e) => e.startDate)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    expect(shown.every((e) => e.pending && e.recurring)).toBe(true);
    expect(store.events().some((e) => e.id === unrelated.id)).toBe(false);
    expect(store.isPending(shown[2].id)).toBe(true);
    const stored = shown.map((e, n) => ({ ...e, id: `stored-${n}`, seriesId: 'series-new', creationId: null, pending: undefined }));
    put.flush(stored[0]);
    expect(store.events().filter((e) => e.title === 'Reading time')).toHaveLength(6);
    read().flush(snapshot([first, second, ...stored], 2));
    expect(store.pending()).toHaveLength(0);
    expect(store.events().filter((e) => e.title === 'Reading time').map((e) => e.id)).toEqual(stored.map((e) => e.id));
  });

  it('finds an uncertain change that started a series by its content, since its occurrences have new ids', () => {
    const weekly: EventRequest = { ...draft('Piano'), calendarId: 'c4', repeat: 'Weekly' };
    store.update(unrelated.id, weekly, false, 'operation').subscribe({ error: () => {} });
    http.expectOne((r) => r.method === 'PUT').error(new ProgressEvent('error'));
    store.retry('operation').subscribe();
    const started = { ...timed('Piano', null, '2026-10-12T22:00:00Z', '2026-10-12T23:00:00Z'), id: 'occurrence', recurring: true, seriesId: 'series-new' };
    read().flush(snapshot([first, started], 2));
    http.expectNone((r) => r.method === 'PUT');
    read().flush(snapshot([first, second, started], 2));
    expect(store.pending()).toHaveLength(0);
  });

  it('does not apply a late successful write to another family', () => {
    store.update(first.id, draft()).subscribe();
    const put = http.expectOne((r) => r.method === 'PUT');
    store.reset();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot([unrelated]));
    put.flush({ ...first, title: 'From old family' });
    expect(store.events()).toEqual([unrelated]);
    expect(store.pending()).toHaveLength(0);
  });

  it('shares one HTTP mutation when multiple callers subscribe', () => {
    const save = store.update(first.id, draft());
    save.subscribe({ error: () => {} });
    save.subscribe({ error: () => {} });
    fail('PUT');
  });
});

describe('calendar optimistic time previews', () => {
  it('uses the family zone and matches DST gaps and overlaps', () => {
    expect(instantAt('2026-10-12', '18:00:00', zone)).toBe('2026-10-12T22:00:00.000Z');
    expect(instantAt('2026-11-01', '01:30:00', zone)).toBe('2026-11-01T06:30:00.000Z');
    expect(instantAt('2026-03-08', '02:30:00', zone)).toBe('2026-03-08T07:00:00.000Z');
  });
  it('skips short months for a monthly event on the 31st', () => {
    const result = previewOccurrences(
      {
        ...draft(),
        allDay: true,
        startDate: '2026-01-31',
        endDate: '2026-02-01',
        repeat: 'Monthly',
      },
      marloweCalendars[0],
      'request',
      zone,
      '2026-01-01',
      '2026-05-01',
    );
    expect(result.map((e) => e.startDate)).toEqual(['2026-01-31', '2026-03-31']);
  });
});
