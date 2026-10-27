import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { allDay, timed } from '../testing/calendar';
import { marlowes } from '../testing/marlowes';
import { CountdownStore, daysUntil, leftLabel } from './countdowns';
import { FamilyStore } from './family';

describe('countdowns', () => {
  it('count whole family days, across a change of clocks', () => {
    expect(daysUntil('2026-10-27', '2026-10-27')).toBe(0);
    expect(daysUntil('2026-10-27', '2026-10-28')).toBe(1);
    expect(daysUntil('2026-10-27', '2026-11-29')).toBe(33);
  });

  it('read as Today, Tomorrow or a number of days', () => {
    expect(leftLabel(0)).toBe('Today');
    expect(leftLabel(1)).toBe('Tomorrow');
    expect(leftLabel(12)).toBe('12 days');
  });
});

describe('CountdownStore', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    // 9 PM on the 27th in New York, already the 28th in UTC.
    vi.setSystemTime(new Date('2026-10-28T01:00:00Z'));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.useRealTimers());

  it('asks from the family’s today and counts the days left to each event in its clock', () => {
    const store = TestBed.inject(CountdownStore);
    TestBed.tick();
    http.expectNone((r) => r.url === '/api/calendar/countdowns');
    expect(store.countdowns()).toEqual([]);

    TestBed.inject(FamilyStore).load();
    http.expectOne('/api/family').flush(marlowes);
    TestBed.tick();

    const ask = http.expectOne((r) => r.url === '/api/calendar/countdowns');
    expect(ask.request.params.get('from')).toBe('2026-10-27');
    ask.flush([
      // 8 PM in New York on the 28th, though the 29th in UTC.
      timed('Recital', 'm3', '2026-10-29T00:00:00Z', '2026-10-29T01:00:00Z'),
      allDay('Cabin weekend', null, '2026-11-20', '2026-11-23'),
    ]);

    expect(store.countdowns().map((c) => [c.title, c.days, c.left])).toEqual([
      ['Recital', 1, 'Tomorrow'],
      ['Cabin weekend', 24, '24 days'],
    ]);
  });
});
