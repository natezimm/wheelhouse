import { marloweCalendars, allDay, timed } from '../testing/calendar';
import { marlowes } from '../testing/marlowes';
import { clockLabel, draftOf, moveEnd, moveStart, movedTo, newDraft, onDayOf, problemWith, requestOf, writableCalendars } from './event-draft';

describe('event drafts', () => {
  const zone = 'America/New_York';

  it('start a new event at the next half hour today, and at 9 AM on another day', () => {
    const now = new Date('2026-10-12T21:22:00Z'); // 5:22 PM in New York

    expect(newDraft('2026-10-12', 'c1', zone, now)).toMatchObject({ startTime: '17:30', endDate: '2026-10-12', endTime: '18:30' });
    expect(newDraft('2026-10-12', 'c1', zone, new Date('2026-10-12T21:40:00Z'))).toMatchObject({ startTime: '18:00' });
    expect(newDraft('2026-10-14', 'c1', zone, now)).toMatchObject({ startTime: '09:00', endTime: '10:00' });
  });

  it('start a new event at the time picked on the grid, across midnight if it must', () => {
    const now = new Date('2026-10-12T21:22:00Z');

    expect(newDraft('2026-10-14', 'c1', zone, now, '15:30')).toMatchObject({ startDate: '2026-10-14', startTime: '15:30', endDate: '2026-10-14', endTime: '16:30' });
    expect(newDraft('2026-10-14', 'c1', zone, now, '23:30')).toMatchObject({ startTime: '23:30', endDate: '2026-10-15', endTime: '00:30' });
  });

  it('read an event in the family’s own clock, with an all-day event’s last day inclusive', () => {
    expect(draftOf(timed('Swim', 'm3', '2026-10-12T21:30:00Z', '2026-10-12T22:15:00Z'), zone)).toMatchObject({
      startDate: '2026-10-12',
      startTime: '17:30',
      endTime: '18:15',
      allDay: false,
    });
    expect(draftOf(allDay('Grandma in town', null, '2026-10-10', '2026-10-14'), zone)).toMatchObject({
      startDate: '2026-10-10',
      endDate: '2026-10-13',
    });
  });

  it('send an all-day event’s end as the day after its last, and times with seconds', () => {
    const trip = { ...newDraft('2026-10-12', 'c4', zone, new Date()), title: ' Trip ', allDay: true, endDate: '2026-10-13' };

    expect(requestOf(trip)).toEqual({
      calendarId: 'c4',
      title: 'Trip',
      location: null,
      allDay: true,
      startDate: '2026-10-12',
      startTime: null,
      endDate: '2026-10-14',
      endTime: null,
      repeat: 'Never',
    });
    expect(requestOf({ ...trip, allDay: false, endDate: '2026-10-12' })).toMatchObject({ startTime: '09:00:00', endTime: '10:00:00' });
  });

  it('keep the length when the start moves and never let the end pass it', () => {
    const late = { ...newDraft('2026-10-14', 'c1', zone, new Date()), startTime: '22:30', endTime: '23:30' };

    expect(moveStart(late, 60)).toMatchObject({ startTime: '23:30', endDate: '2026-10-15', endTime: '00:30' });
    expect(moveStart(late, 24 * 60)).toMatchObject({ startDate: '2026-10-14', startTime: '23:45' });
    expect(moveEnd(late, -120)).toMatchObject({ endDate: '2026-10-14', endTime: '22:45' });
    expect(clockLabel('00:30')).toBe('12:30 AM');
    expect(clockLabel('17:05')).toBe('5:05 PM');
  });

  it('keep the length when moved to another day and time, past midnight and across clock changes', () => {
    const swim = timed('Swim', 'm3', '2026-10-14T21:30:00Z', '2026-10-14T22:15:00Z');

    expect(movedTo(swim, '2026-10-16', '09:00', zone)).toMatchObject({ startDate: '2026-10-16', startTime: '09:00', endDate: '2026-10-16', endTime: '09:45' });
    expect(movedTo(swim, '2026-10-16', '23:45', zone)).toMatchObject({ endDate: '2026-10-17', endTime: '00:30' });
    // 1:30 to 3:30 AM on the spring-forward day lasts an hour, and stays an hour.
    const early = timed('Early', 'm1', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z');
    expect(movedTo(early, '2026-03-09', '09:00', zone)).toMatchObject({ startTime: '09:00', endDate: '2026-03-09', endTime: '10:00' });
    // 1:45 EDT to 1:15 EST on the fall-back day lasts half an hour.
    const late = timed('Late', 'm1', '2026-11-01T05:45:00Z', '2026-11-01T06:15:00Z');
    expect(movedTo(late, '2026-11-02', '09:00', zone)).toMatchObject({ startTime: '09:00', endDate: '2026-11-02', endTime: '09:30' });
  });

  it('go back to their own day for a change to a whole series, keeping the new times', () => {
    const original = draftOf(timed('Soccer', 'm3', '2026-10-14T21:30:00Z', '2026-10-14T22:45:00Z'), zone);
    const moved = { ...moveStart({ ...original, startDate: '2026-10-16', endDate: '2026-10-16' }, 30), allDay: true };

    expect(onDayOf(moved, original)).toMatchObject({ allDay: false, startDate: '2026-10-14', startTime: '18:00', endDate: '2026-10-14', endTime: '19:15' });
  });

  it('need a title and an end after the start', () => {
    const draft = { ...newDraft('2026-10-14', 'c1', zone, new Date()), title: 'Dentist' };

    expect(problemWith(draft)).toBeNull();
    expect(problemWith({ ...draft, title: '  ' })).toBe('Give the event a title.');
    expect(problemWith({ ...draft, endTime: '09:00' })).toBe('End the event after it starts.');
  });

  it('offer the calendars that take new events, by whose they are', () => {
    const calendars = [...marloweCalendars, { id: 'c5', name: 'Holidays', memberId: null, canWrite: false }];

    expect(writableCalendars(calendars, marlowes.members).map((c) => c.label)).toEqual(['Ben', 'Tess', 'Milo', 'Family']);
  });
});
