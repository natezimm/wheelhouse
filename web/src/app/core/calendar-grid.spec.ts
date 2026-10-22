import { allDay, timed } from '../testing/calendar';
import { arrange, dayBars, hourLabel, hourRange, inAllDayLane, timedSegments } from './calendar-grid';
import { daysBetween } from './days';

describe('calendar grid', () => {
  const zone = 'America/New_York';
  const week = daysBetween('2026-10-19', '2026-10-26');
  /** A timed event on a New York day, from 'HH:mm' to 'HH:mm'. */
  const at = (title: string, day: string, from: string, to: string, memberId: string | null = 'm1') =>
    timed(title, memberId, new Date(`${day}T${from}:00-04:00`).toISOString(), new Date(`${day}T${to}:00-04:00`).toISOString());
  const segmentsOf = (...events: ReturnType<typeof at>[]) => timedSegments(events, week, zone);

  it('places timed events in the family’s clock, not the browser’s', () => {
    const segments = segmentsOf(at('Swim', '2026-10-22', '15:00', '16:00')).get('2026-10-22')!;
    expect(segments).toEqual([expect.objectContaining({ start: 15 * 60, end: 16 * 60, continuesBefore: false, continuesAfter: false })]);
  });

  it('splits an overnight event into a segment on each day, one event behind both', () => {
    const late = timed('Red-eye', 'm1', '2026-10-23T02:00:00Z', '2026-10-23T10:30:00Z'); // 10 PM to 6:30 AM
    const segments = segmentsOf(late);
    expect(segments.get('2026-10-22')).toEqual([expect.objectContaining({ start: 22 * 60, end: 24 * 60, continuesAfter: true })]);
    expect(segments.get('2026-10-23')).toEqual([expect.objectContaining({ start: 0, end: 6 * 60 + 30, continuesBefore: true })]);
    expect(segments.get('2026-10-22')![0].event).toBe(segments.get('2026-10-23')![0].event);
  });

  it('ends an event at midnight on its own day', () => {
    const segments = segmentsOf(at('Late show', '2026-10-22', '22:00', '23:00'), timed('Party', 'm1', '2026-10-23T02:00:00Z', '2026-10-23T04:00:00Z'));
    expect(segments.get('2026-10-22')!.map((s) => s.end)).toEqual([23 * 60, 24 * 60]);
    expect(segments.get('2026-10-23')).toEqual([]);
  });

  it('clips segments to the visible days', () => {
    const segments = timedSegments([timed('Trip', 'm1', '2026-10-25T20:00:00Z', '2026-10-26T14:00:00Z')], week, zone);
    expect(segments.get('2026-10-25')).toEqual([expect.objectContaining({ start: 16 * 60, end: 24 * 60, continuesAfter: true })]);
    expect(segments.has('2026-10-26')).toBe(false);
  });

  it('measures days across daylight saving in the family’s clock', () => {
    const fallBack = timedSegments([timed('Early', 'm1', '2026-11-01T05:30:00Z', '2026-11-01T07:30:00Z')], ['2026-11-01'], zone);
    // 1:30 AM EDT to 2:30 AM EST: two real hours that the clock shows as one.
    expect(fallBack.get('2026-11-01')).toEqual([expect.objectContaining({ start: 90, end: 150 })]);
  });

  it('sends all-day events and timed ones of a day or more to the all-day lane', () => {
    expect(inAllDayLane(allDay('Visit', null, '2026-10-19', '2026-10-22'))).toBe(true);
    expect(inAllDayLane(timed('Conference', 'm1', '2026-10-20T13:00:00Z', '2026-10-21T13:00:00Z'))).toBe(true);
    expect(inAllDayLane(at('Swim', '2026-10-22', '15:00', '16:00'))).toBe(false);
    expect(segmentsOf(timed('Conference', 'm1', '2026-10-20T13:00:00Z', '2026-10-21T13:00:00Z')).get('2026-10-20')).toEqual([]);
  });

  it('puts overlapping events side by side, and touching ones one above the other', () => {
    const day = '2026-10-22';
    const { placed } = arrange(
      segmentsOf(at('Swim', day, '15:00', '16:00'), at('Orthodontist', day, '15:15', '16:15'), at('Soccer', day, '16:15', '17:00')).get(day)!,
    );
    expect(placed.map((p) => [p.event.title, p.lane, p.lanes])).toEqual([
      ['Swim', 0, 2],
      ['Orthodontist', 1, 2],
      ['Soccer', 0, 1],
    ]);
  });

  it('carries a chain of overlaps as one group, reusing a column once it frees up', () => {
    const day = '2026-10-22';
    const { placed } = arrange(
      segmentsOf(at('A', day, '09:00', '10:00'), at('B', day, '09:30', '11:00'), at('C', day, '10:00', '10:30'), at('D', day, '10:45', '11:30')).get(day)!,
    );
    expect(placed.map((p) => [p.event.title, p.lane, p.lanes])).toEqual([
      ['A', 0, 2],
      ['B', 1, 2],
      ['C', 0, 2],
      ['D', 0, 2],
    ]);
  });

  it('gathers events past three columns into a "+N" block in the last column', () => {
    const day = '2026-10-22';
    const { placed, more } = arrange(
      segmentsOf(at('A', day, '15:00', '16:00'), at('B', day, '15:00', '16:00'), at('C', day, '15:00', '16:00'), at('D', day, '15:30', '17:00')).get(day)!,
    );
    expect(placed.map((p) => [p.event.title, p.lane, p.lanes])).toEqual([
      ['A', 0, 3],
      ['B', 1, 3],
    ]);
    expect(more).toEqual([expect.objectContaining({ day, lane: 2, lanes: 3, start: 15 * 60, end: 17 * 60 })]);
    expect(more[0].events.map((e) => e.title)).toEqual(['C', 'D']);
  });

  it('orders the same events the same way however they arrive', () => {
    const day = '2026-10-22';
    const events = [at('Zumba', day, '09:00', '10:00'), at('Art', day, '09:00', '10:00'), at('Bake', day, '09:00', '11:00')];
    const order = (list: typeof events) => arrange(timedSegments(list, week, zone).get(day)!).placed.map((p) => p.event.title);
    expect(order(events)).toEqual(['Bake', 'Art', 'Zumba']);
    expect(order([...events].reverse())).toEqual(['Bake', 'Art', 'Zumba']);
  });

  it('says how much free room each event has below it', () => {
    const day = '2026-10-22';
    const { placed } = arrange(segmentsOf(at('Pickup', day, '15:00', '15:15'), at('Snack', day, '15:30', '16:00')).get(day)!);
    expect(placed.map((p) => p.room)).toEqual([15, 8 * 60]);
  });

  it('lays all-day bars across their days with exclusive ends, two lanes deep', () => {
    const { bars, lanes, hidden } = dayBars(
      [
        allDay('Grandma visiting', null, '2026-10-19', '2026-10-22'),
        allDay('Trash night', 'm1', '2026-10-20', '2026-10-21'),
        allDay('Library books due', 'm2', '2026-10-22', '2026-10-23'),
        allDay('Spirit Day', null, '2026-10-20', '2026-10-21'),
      ],
      week,
      zone,
    );
    expect(bars.map((b) => [b.event.title, b.first, b.span, b.lane])).toEqual([
      ['Grandma visiting', 0, 3, 0],
      ['Spirit Day', 1, 1, 1],
      ['Library books due', 3, 1, 0],
    ]);
    expect(lanes).toBe(2);
    expect(hidden).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });

  it('clips a bar that runs past the week and says it does', () => {
    const { bars } = dayBars([allDay('Cabin weekend', null, '2026-10-24', '2026-10-28')], week, zone);
    expect(bars).toEqual([expect.objectContaining({ first: 5, span: 2, continuesBefore: false, continuesAfter: true })]);
  });

  it('grows the hours to fit early and late events', () => {
    const day = '2026-10-22';
    expect(hourRange(segmentsOf(at('Lunch', day, '12:00', '13:00')).get(day)!)).toEqual({ first: 7, last: 21 });
    expect(hourRange(segmentsOf(at('Run', day, '05:45', '06:30'), at('Late', day, '21:00', '22:10')).get(day)!)).toEqual({ first: 5, last: 23 });
  });

  it('labels hours the way the family reads them', () => {
    expect([0, 7, 12, 15].map(hourLabel)).toEqual(['12 AM', '7 AM', '12 PM', '3 PM']);
  });
});
