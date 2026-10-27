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
    http.match((r) => r.url === '/api/calendar/countdowns');
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

  it('changes an event and those after it, leaving the earlier ones as they are', () => {
    const wednesday = { ...draft('Later practice'), startDate: '2026-10-14', endDate: '2026-10-14' };
    store.update(second.id, wednesday, 'following').subscribe();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.params.get('following')).toBe('true');
    expect(put.request.params.has('series')).toBe(false);
    expect(store.events().find((e) => e.id === first.id)!.title).toBe('Practice');
    expect(store.events().find((e) => e.id === second.id)).toMatchObject({ title: 'Later practice', pending: true });
    expect(store.isPending(first.id)).toBe(true);
    put.flush({ ...second, id: 'split', seriesId: 'series-b', title: 'Later practice' });
    read().flush(snapshot([first, { ...second, id: 'split', seriesId: 'series-b', title: 'Later practice' }, unrelated], 2));
    expect(store.pending()).toHaveLength(0);
  });

  it('previews events that become a series of their own on the days their rule names', () => {
    store.reset();
    store.show('2026-10-12', '2026-10-19');
    const daily = { recurrence: 'RRULE:FREQ=DAILY' };
    read().flush(snapshot([{ ...first, ...daily }, { ...second, ...daily }, unrelated]));
    store.update(second.id, { ...draft('Daily from Wednesday'), startDate: '2026-10-14', endDate: '2026-10-14' }, 'following').subscribe();
    http.expectOne((r) => r.method === 'PUT');
    expect(store.events().filter((e) => e.title === 'Daily from Wednesday').map((e) => e.startsAt!.slice(0, 10)))
      .toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    expect(store.events().find((e) => e.id === first.id)!.title).toBe('Practice');
  });

  it('deletes an event and those after it', () => {
    store.remove(second.id, 'following').subscribe();
    const remove = http.expectOne((r) => r.method === 'DELETE');
    expect(remove.request.params.get('following')).toBe('true');
    expect(store.events().some((e) => e.id === second.id)).toBe(false);
    expect(store.events().some((e) => e.id === first.id)).toBe(true);
    remove.flush(null);
    read().flush(snapshot([first, unrelated], 2));
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
    store.add({ ...draft('Repeating'), recurrence: 'RRULE:FREQ=DAILY' }).subscribe();
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

  it('repeats an uncertain change to only the notes when the snapshot still has the old notes', () => {
    const notes: EventRequest = { ...draft('Practice'), startTime: '17:00:00', endTime: '18:00:00', description: 'Bring cleats' };
    store.update(first.id, notes, false, 'operation').subscribe({ error: () => {} });
    http.expectOne((r) => r.method === 'PUT').error(new ProgressEvent('error'));
    store.retry('operation').subscribe();
    read().flush(snapshot([first], 2));
    const again = http.expectOne((r) => r.method === 'PUT');
    expect(again.request.body).toMatchObject({ description: 'Bring cleats' });
    again.flush({ ...first, description: 'Bring cleats' });
    read().flush(snapshot([{ ...first, description: 'Bring cleats' }, second, unrelated], 3));
    expect(store.pending()).toHaveLength(0);
  });

  it('repeats an uncertain new rule for a series when the snapshot still has the old rule', () => {
    store.update(first.id, { ...draft('Practice'), startTime: '17:00:00', endTime: '18:00:00', recurrence: 'RRULE:FREQ=DAILY;UNTIL=20261030' }, true, 'operation').subscribe({ error: () => {} });
    http.expectOne((r) => r.method === 'PUT').error(new ProgressEvent('error'));
    store.retry('operation').subscribe();
    read().flush(snapshot([first], 2));
    http.expectOne((r) => r.method === 'PUT').flush({ ...first, recurrence: 'RRULE:FREQ=DAILY;UNTIL=20261031T035959Z' });
    read().flush(snapshot([first, second, unrelated], 3));
    expect(store.pending()).toHaveLength(0);
  });

  it('finds an uncertain new rule already saved, though Google ends it at an instant', () => {
    store.update(first.id, { ...draft('Practice'), startTime: '17:00:00', endTime: '18:00:00', recurrence: 'RRULE:FREQ=DAILY;UNTIL=20261030' }, true, 'operation').subscribe({ error: () => {} });
    http.expectOne((r) => r.method === 'PUT').error(new ProgressEvent('error'));
    store.retry('operation').subscribe();
    read().flush(snapshot([{ ...first, recurrence: 'RRULE:FREQ=DAILY;UNTIL=20261031T035959Z' }], 2));
    http.expectNone((r) => r.method === 'PUT');
    read().flush(snapshot([first, second, unrelated], 3));
    expect(store.pending()).toHaveLength(0);
  });

  it('shows an event that starts to repeat as its new series until a snapshot replaces it', () => {
    const daily: EventRequest = { ...draft('Reading time'), allDay: true, calendarId: 'c4', startDate: '2026-10-13', startTime: null, endDate: '2026-10-14', endTime: null, recurrence: 'RRULE:FREQ=DAILY' };
    store.update(unrelated.id, daily).subscribe();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body).toMatchObject({ recurrence: 'RRULE:FREQ=DAILY' });
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
    const weekly: EventRequest = { ...draft('Piano'), calendarId: 'c4', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO' };
    store.update(unrelated.id, weekly, false, 'operation').subscribe({ error: () => {} });
    http.expectOne((r) => r.method === 'PUT').error(new ProgressEvent('error'));
    store.retry('operation').subscribe();
    const started = { ...timed('Piano', null, '2026-10-12T22:00:00Z', '2026-10-12T23:00:00Z'), id: 'occurrence', recurring: true, seriesId: 'series-new', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO' };
    read().flush(snapshot([first, started], 2));
    http.expectNone((r) => r.method === 'PUT');
    read().flush(snapshot([first, second, started], 2));
    expect(store.pending()).toHaveLength(0);
  });

  it('offers Undo after deleting an event, which adds it back as it was', () => {
    const dentist = { ...timed('Dentist', 'm3', '2026-10-13T14:00:00Z', '2026-10-13T15:00:00Z', 'Main St'), description: '<b>Card</b>', memberIds: ['m1'] };
    store.reset();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot([dentist]));
    store.remove(dentist.id).subscribe();
    http.expectOne((r) => r.method === 'DELETE').flush(null);
    read().flush(snapshot([], 2));
    expect(store.undoable()).toEqual({ label: 'Event deleted', ready: true });

    store.undo().subscribe();
    expect(store.undoable()).toBeNull();
    const post = http.expectOne((r) => r.method === 'POST');
    expect(post.request.body).toMatchObject({
      calendarId: 'c3', title: 'Dentist', location: 'Main St', allDay: false,
      startDate: '2026-10-13', startTime: '10:00:00', endDate: '2026-10-13', endTime: '11:00:00',
      description: '<b>Card</b>', memberIds: ['m1'], private: false,
    });
    post.flush({ ...dentist, id: 'again' });
    read().flush(snapshot([{ ...dentist, id: 'again' }], 3));
  });

  it('offers Undo after moving an event, which puts back only its times', () => {
    const dentist = { ...timed('Dentist', 'm3', '2026-10-13T14:00:00Z', '2026-10-13T15:00:00Z'), description: '<b>Card</b>' };
    store.reset();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot([dentist]));
    store.update(dentist.id, { ...draft('Dentist'), startDate: '2026-10-14', endDate: '2026-10-14' }).subscribe();
    http.expectOne((r) => r.method === 'PUT').flush({ ...dentist, startsAt: '2026-10-14T22:00:00Z', endsAt: '2026-10-14T23:00:00Z' });
    read().flush(snapshot([{ ...dentist, startsAt: '2026-10-14T22:00:00Z', endsAt: '2026-10-14T23:00:00Z' }], 2));
    expect(store.undoable()).toEqual({ label: 'Event moved', ready: true });

    store.undo().subscribe();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.url).toBe(`/api/calendar/events/${dentist.id}`);
    expect(put.request.body).toMatchObject({ startDate: '2026-10-13', startTime: '10:00:00', endTime: '11:00:00' });
    expect(put.request.body).not.toHaveProperty('description');
    put.flush(dentist);
    read().flush(snapshot([dentist], 3));
  });

  it('undoes a move to a week that is not on screen', () => {
    const dentist = timed('Dentist', 'm3', '2026-10-13T14:00:00Z', '2026-10-13T15:00:00Z');
    const later = { ...dentist, startsAt: '2026-10-27T14:00:00Z', endsAt: '2026-10-27T15:00:00Z' };
    store.reset();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot([dentist]));
    store.update(dentist.id, { ...draft('Dentist'), startDate: '2026-10-27', endDate: '2026-10-27', startTime: '10:00:00', endTime: '11:00:00' }).subscribe();
    http.expectOne((r) => r.method === 'PUT').flush(later);
    read().flush(snapshot([], 2));
    expect(store.undoable()).toEqual({ label: 'Event moved', ready: true });

    store.undo().subscribe();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.url).toBe(`/api/calendar/events/${dentist.id}`);
    expect(put.request.body).toMatchObject({ startDate: '2026-10-13', startTime: '10:00:00' });
    expect(store.events().map((e) => e.id)).toEqual([dentist.id]);
    put.flush(dentist);
    read().flush(snapshot([dentist], 3));
  });

  it('offers no Undo for a change to a whole series, and lets an offer lapse', () => {
    vi.useFakeTimers();
    try {
      store.update(first.id, draft(), true).subscribe();
      http.expectOne((r) => r.method === 'PUT').flush({ ...first, title: 'Changed' });
      read().flush(snapshot([{ ...first, title: 'Changed' }, second, unrelated], 2));
      expect(store.undoable()).toBeNull();

      store.remove(unrelated.id).subscribe();
      http.expectOne((r) => r.method === 'DELETE').flush(null);
      read().flush(snapshot([first, second], 3));
      expect(store.undoable()?.label).toBe('Event deleted');
      vi.advanceTimersByTime(CalendarStore.UNDO_MS);
      expect(store.undoable()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
        recurrence: 'RRULE:FREQ=MONTHLY',
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
