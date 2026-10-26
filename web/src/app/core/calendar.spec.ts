import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { allDay, marloweCalendars, timed } from '../testing/calendar';
import { marlowes } from '../testing/marlowes';
import { CalendarStore, FAMILY, FAMILY_COLOR, colorOf, daysOf, showsOn, spanOf, whenOn } from './calendar';

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

  it('list only the days asked for, however long they run', () => {
    const forever = allDay('Forever', null, '0001-01-01', '9999-12-31');

    expect(daysOf(forever, zone, { from: '2026-10-12', to: '2026-10-15' })).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(daysOf(allDay('Trash', null, '2026-10-13', '2026-10-14'), zone, { from: '2026-10-14', to: '2026-10-21' })).toEqual([]);
    expect(spanOf(forever, zone)).toEqual({ first: '0001-01-01', last: '9999-12-30' });
    expect(showsOn(forever, '2026-10-12', zone)).toBe(true);
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
    expect(store.refreshFailed()).toBe(true);
    store.refresh();
    expect(store.refreshFailed()).toBe(false);
    respond();
    expect(store.refreshFailed()).toBe(false);
  });

  it('keeps the calendars it knows while other days load, so columns and Add event stay put', () => {
    store.show('2026-10-12', '2026-10-19');
    respond();
    store.show('2026-10-19', '2026-10-26');

    expect(store.state().status).toBe('loading');
    expect(store.calendars()).toEqual(marloweCalendars);
    expect(store.events()).toEqual([]);
    respond([]);
    store.reset();
    expect(store.calendars()).toEqual([]);
  });
});

describe('calendar snapshot recovery', () => {
  let store: CalendarStore;
  let http: HttpTestingController;
  const snapshot = (changeNumber: number, title = 'Current') => ({
    changeNumber, needsReconnect: false, calendars: marloweCalendars,
    events: [allDay(title, null, '2026-10-12', '2026-10-13')],
  });
  const read = () => http.expectOne((r) => r.url === '/api/calendar');
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(CalendarStore);
    http = TestBed.inject(HttpTestingController);
    store.show('2026-10-12', '2026-10-19');
  });
  afterEach(() => http.verify());

  it('acknowledges snapshots, ignores duplicate/invalid notifications, and coalesces gaps', () => {
    read().flush(snapshot(5));
    store.changed(5);
    store.changed(4);
    store.changed(NaN);
    http.expectNone((r) => r.url === '/api/calendar');
    store.changed(8);
    const pending = read();
    store.changed(9);
    store.changed(10);
    expect(store.changeNumber()).toBe(5);
    http.expectNone((r) => r.url === '/api/calendar');
    pending.flush(snapshot(8));
    read().flush(snapshot(10));
    expect(store.changeNumber()).toBe(10);
    expect(store.refreshing()).toBe(false);
  });

  it('does not refetch when an in-flight snapshot already contains the notification', () => {
    store.changed(7);
    read().flush(snapshot(7));
    expect(store.changeNumber()).toBe(7);
    http.expectNone((r) => r.url === '/api/calendar');
  });

  it('coalesces forced refreshes into one follow-up read', () => {
    read().flush(snapshot(2));
    store.refresh();
    const pending = read();
    store.refresh(); store.refresh(); store.refresh();
    pending.flush(snapshot(3));
    read().flush(snapshot(4));
    http.expectNone((r) => r.url === '/api/calendar');
  });

  it('rejects an old request even after navigating away and back to the same days', () => {
    const first = read();
    store.show('2026-10-19', '2026-10-26');
    const second = read();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(9));
    first.flush(snapshot(1, 'Stale'));
    second.flush(null, { status: 500, statusText: 'Error' });
    expect(store.changeNumber()).toBe(9);
    expect(store.events()[0].title).toBe('Current');
  });

  it('keeps the latest revision when a delayed server snapshot is older', () => {
    read().flush(snapshot(9));
    store.refresh();
    read().flush(snapshot(8, 'Stale'));
    expect(store.changeNumber()).toBe(9);
    expect(store.events()[0].title).toBe('Current');
  });

  it('recovers an unavailable first load and does not spin when recovery fails', () => {
    read().flush(null, { status: 503, statusText: 'Offline' });
    store.changed(10);
    read().flush(null, { status: 503, statusText: 'Offline' });
    http.expectNone((r) => r.url === '/api/calendar');
    store.refresh();
    read().flush(snapshot(10));
    expect(store.state().status).toBe('ready');
  });

  it('releases a hung read so the next recovery check can retry', () => {
    read().flush(snapshot(1));
    vi.useFakeTimers();
    store.refresh();
    const hung = read();
    vi.advanceTimersByTime(15_000);
    expect(hung.cancelled).toBe(true);
    expect(store.refreshing()).toBe(false);
    store.refresh();
    read().flush(snapshot(1));
    expect(store.state().status).toBe('ready');
    vi.useRealTimers();
  });

  it('invalidates outstanding reads and counters when changing family', () => {
    const old = read();
    store.reset();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(1, 'Other family'));
    old.flush(snapshot(100, 'Previous family'));
    expect(store.changeNumber()).toBe(1);
    expect(store.events()[0].title).toBe('Other family');
  });

  it('does not overwrite a confirmed edit with a read started before the write', () => {
    read().flush(snapshot(1));
    store.refresh();
    const old = read();
    const request = {
      calendarId: 'c1', title: 'Edited', location: null, allDay: true,
      startDate: '2026-10-12', endDate: '2026-10-13', startTime: null, endTime: null,
    };
    store.update(store.events()[0].id, request).subscribe();
    http.expectOne((r) => r.method === 'PUT').flush(snapshot(2, 'Edited').events[0]);
    old.flush(snapshot(1, 'Old'));
    expect(store.events().some((e) => e.title === 'Edited')).toBe(true);
    read().flush(snapshot(2, 'Edited'));
    expect(store.changeNumber()).toBe(2);
  });
});

