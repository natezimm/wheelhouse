import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { allDay, marloweCalendars, timed } from '../testing/calendar';
import { marlowes } from '../testing/marlowes';
import { CalendarStore, FAMILY, FAMILY_COLOR, colorOf, daysOf, whenOn } from './calendar';

const zone = 'America/New_York';

describe('calendar events', () => {
  it('show on each day they cover, with an all-day end exclusive', () => {
    expect(daysOf(allDay('Grandma in town', null, '2026-10-10', '2026-10-14'), zone)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
    ]);
    expect(daysOf(timed('Dentist', 'm1', '2026-10-12T19:00:00Z', '2026-10-12T20:00:00Z'), zone)).toEqual(['2026-10-12']);
  });

  it('do not spill into the next day when they end at midnight', () => {
    // 8 PM to midnight in New York.
    expect(daysOf(timed('Late', 'm1', '2026-10-13T00:00:00Z', '2026-10-13T04:00:00Z'), zone)).toEqual(['2026-10-12']);
  });

  it('say when they happen on each day they cover', () => {
    const trip = timed('Chicago trip', 'm1', '2026-10-15T10:10:00Z', '2026-10-17T00:00:00Z');

    expect(whenOn(trip, '2026-10-15', zone)).toBe('6:10 AM');
    expect(whenOn(trip, '2026-10-16', zone)).toBe('Until 8:00 PM');
    expect(whenOn(allDay('Trash', null, '2026-10-13', '2026-10-14'), '2026-10-13', zone)).toBe('All day');
  });

  it("take their member's color, or the family's", () => {
    expect(colorOf(timed('Dentist', 'm1', '2026-10-12T19:00:00Z', '2026-10-12T20:00:00Z'), marlowes.members)).toBe('#2F5FC4');
    expect(colorOf(allDay('Trash', null, '2026-10-13', '2026-10-14'), marlowes.members)).toBe(FAMILY_COLOR);
  });
});

describe('CalendarStore', () => {
  let store: CalendarStore;
  let http: HttpTestingController;
  const dentist = timed('Dentist', 'm1', '2026-10-12T19:00:00Z', '2026-10-12T20:00:00Z');
  const trash = allDay('Trash & recycling', null, '2026-10-13', '2026-10-14');

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(CalendarStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const respond = (events = [dentist, trash]) =>
    http
      .expectOne((request) => request.url === '/api/calendar')
      .flush({ calendars: marloweCalendars, events });

  it('asks for the days on screen, once', () => {
    store.show('2026-10-12', '2026-10-19');
    const request = http.expectOne((r) => r.url === '/api/calendar');
    expect(request.request.params.get('from')).toBe('2026-10-12');
    expect(request.request.params.get('to')).toBe('2026-10-19');
    request.flush({ calendars: marloweCalendars, events: [dentist] });

    store.show('2026-10-12', '2026-10-19');

    expect(store.events()).toEqual([dentist]);
    expect(store.hasFamilyCalendar()).toBe(true);
  });

  it("drops an answer for days that are no longer on screen", () => {
    store.show('2026-10-12', '2026-10-19');
    const stale = http.expectOne((r) => r.params.get('from') === '2026-10-12');
    store.show('2026-10-19', '2026-10-26');
    const current = http.expectOne((r) => r.params.get('from') === '2026-10-19');

    current.flush({ calendars: marloweCalendars, events: [trash] });
    stale.flush({ calendars: marloweCalendars, events: [dentist] });

    expect(store.events()).toEqual([trash]);
  });

  it("hides a person's events, and the family's, until their chip is tapped again", () => {
    store.show('2026-10-12', '2026-10-19');
    respond();

    store.toggle('m1');
    expect(store.events()).toEqual([trash]);
    store.toggle(FAMILY);
    expect(store.events()).toEqual([]);
    expect(store.allEvents()).toEqual([dentist, trash]);
    store.toggle('m1');
    expect(store.events()).toEqual([dentist]);
  });

  it('is unavailable when the first load fails, but a failed refresh keeps what is shown', () => {
    store.show('2026-10-12', '2026-10-19');
    http.expectOne((r) => r.url === '/api/calendar').flush(null, { status: 500, statusText: 'Server Error' });
    expect(store.state().status).toBe('unavailable');

    store.show('2026-10-12', '2026-10-19');
    respond();
    store.refresh();
    http.expectOne((r) => r.url === '/api/calendar').flush(null, { status: 500, statusText: 'Server Error' });

    expect(store.state().status).toBe('ready');
    expect(store.events()).toEqual([dentist, trash]);
  });
  const snapshot = (changeNumber: number, events = [dentist]) => ({ changeNumber, calendars: marloweCalendars, events });
  const read = () => http.expectOne((r) => r.url === '/api/calendar');

  it('coalesces notifications during a read and recovers a revision committed after its snapshot', () => {
    store.show('2026-10-12', '2026-10-19');
    const first = read();
    store.changed(2);
    store.changed(3);
    http.expectNone((r) => r.url === '/api/calendar');
    first.flush(snapshot(1));
    read().flush(snapshot(3, [trash]));
    expect(store.events()).toEqual([trash]);
    store.changed(3);
    store.changed(2);
    http.expectNone((r) => r.url === '/api/calendar');
  });

  it('retries a failed notification read while keeping the last snapshot visible', () => {
    vi.useFakeTimers();
    try {
      store.show('2026-10-12', '2026-10-19');
      read().flush(snapshot(1));
      store.changed(2);
      read().flush(null, { status: 503, statusText: 'Unavailable' });
      expect(store.events()).toEqual([dentist]);
      vi.advanceTimersByTime(5_000);
      read().flush(snapshot(2, [trash]));
      expect(store.events()).toEqual([trash]);
    } finally { vi.useRealTimers(); }
  });

  it('drops an old response even after navigating away and back to the same days', () => {
    store.show('2026-10-12', '2026-10-19');
    const stale = read();
    store.show('2026-10-19', '2026-10-26');
    const middle = read();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(4, [trash]));
    stale.flush(snapshot(1));
    middle.flush(snapshot(2));
    expect(store.events()).toEqual([trash]);
  });

  it('does not let an in-flight snapshot undo an accepted edit', () => {
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(1));
    store.refresh();
    const stale = read();
    store.update(dentist.id, {} as never).subscribe();
    http.expectOne(`/api/calendar/events/${dentist.id}`).flush({ ...dentist, title: 'Changed' });
    const latest = read();
    stale.flush(snapshot(1));
    expect(store.events()[0].title).toBe('Changed');
    latest.flush(snapshot(2, [{ ...dentist, title: 'Changed' }]));
    expect(store.events()[0].title).toBe('Changed');
  });

  it('ignores old reads and writes after the family changes', () => {
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(5));
    store.update(dentist.id, {} as never).subscribe();
    const edit = http.expectOne(`/api/calendar/events/${dentist.id}`);
    store.refresh();
    const stale = read();
    store.reset();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(1, [trash]));
    edit.flush(dentist);
    stale.flush(snapshot(6));
    expect(store.events()).toEqual([trash]);
    http.expectNone((r) => r.url === '/api/calendar');
  });

  it('times out a hung snapshot so later notifications can recover', () => {
    vi.useFakeTimers();
    try {
      store.show('2026-10-12', '2026-10-19');
      const hung = read();
      vi.advanceTimersByTime(15_000);
      expect(hung.cancelled).toBe(true);
      expect(store.state().status).toBe('unavailable');
      vi.advanceTimersByTime(5_000);
      read().flush(snapshot(1));
      expect(store.state().status).toBe('ready');
    } finally { vi.useRealTimers(); }
  });

});
