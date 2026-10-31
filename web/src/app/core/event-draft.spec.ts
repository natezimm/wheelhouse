import { marloweCalendars, allDay, timed } from '../testing/calendar';
import { marlowes } from '../testing/marlowes';
import { clockLabel, copyOf, draftOf, endAt, moveDays, moveEnd, moveStart, movedTo, newDraft, onDayOf, parseClock, peopleChoices, problemWith, requestOf, resizedTo, revise, startAt, togglePerson, writableCalendars } from './event-draft';

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

  it('read typed times in the usual ways, and nothing that is not a time', () => {
    for (const [typed, time] of [
      ['3pm', '15:00'], ['3 PM', '15:00'], ['3:30 PM', '15:30'], ['3:30p', '15:30'], ['3.30 p.m.', '15:30'], ['330pm', '15:30'],
      ['12am', '00:00'], ['12:15 AM', '00:15'], ['12pm', '12:00'], ['9a', '09:00'], ['15:30', '15:30'], ['1530', '15:30'],
      ['0930', '09:30'], ['00:45', '00:45'], ['23', '23:00'], ['noon', '12:00'], ['Midnight', '00:00'], [' 5:05 pm ', '17:05'],
    ]) {
      expect(parseClock(typed), typed).toBe(time);
    }
    for (const typed of ['', 'soon', '13pm', '0am', '3:75', '24:00', '3:3', '12345', '3pmm']) {
      expect(parseClock(typed), typed).toBeNull();
    }
  });

  it('read an hour without AM or PM as the first from the time given, a family’s day by default', () => {
    expect(parseClock('8')).toBe('08:00');
    expect(parseClock('3')).toBe('15:00');
    expect(parseClock('6:45')).toBe('18:45');
    expect(parseClock('1', '09:00')).toBe('13:00');
    expect(parseClock('11', '09:00')).toBe('11:00');
    expect(parseClock('10', '20:00')).toBe('22:00');
    expect(parseClock('1', '23:00')).toBe('01:00');
  });

  it('keep the length when a start is typed, and end at the first typed end time after the start', () => {
    const swim = { ...newDraft('2026-10-14', 'c1', zone, new Date()), startTime: '17:30', endTime: '18:15' };

    expect(startAt(swim, '23:40')).toMatchObject({ startDate: '2026-10-14', startTime: '23:40', endDate: '2026-10-15', endTime: '00:25' });
    expect(startAt(swim, '08:00')).toMatchObject({ startTime: '08:00', endDate: '2026-10-14', endTime: '08:45' });
    expect(endAt(swim, '20:00')).toMatchObject({ endDate: '2026-10-14', endTime: '20:00' });
    expect(endAt(swim, '01:00')).toMatchObject({ endDate: '2026-10-15', endTime: '01:00' });
    expect(endAt({ ...swim, endDate: '2026-10-15', endTime: '01:00' }, '19:00')).toMatchObject({ endDate: '2026-10-14', endTime: '19:00' });
    expect(problemWith({ ...endAt(swim, '17:30'), title: 'Swim' })).toBe('End the event after it starts.');
    // An event a day long or more keeps its last day.
    const day = { ...swim, startTime: '09:00', endDate: '2026-10-15', endTime: '09:00' };
    expect(endAt(day, '09:15')).toMatchObject({ endDate: '2026-10-15', endTime: '09:15' });
    expect(endAt(day, '09:00')).toMatchObject({ endDate: '2026-10-15', endTime: '09:00' });
    expect(endAt({ ...swim, endDate: '2026-10-16' }, '09:00')).toMatchObject({ endDate: '2026-10-16', endTime: '09:00' });
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

  it('sends notes only when they changed, so notes kept as HTML are not rewritten by an edit or a drag', () => {
    const event = { ...timed('Dentist', 'm1', '2026-10-12T13:00:00Z', '2026-10-12T14:00:00Z'), description: '<b>Bring</b> the card' };
    const draft = draftOf(event, 'America/New_York');
    expect(draft.notes).toBe('Bring the card');
    expect(requestOf(draft)).not.toHaveProperty('description');
    expect(requestOf(movedTo(event, '2026-10-13', '10:00', 'America/New_York'))).not.toHaveProperty('description');
    expect(requestOf({ ...draft, notes: '  Bring the new card ' }).description).toBe('Bring the new card');
    expect(requestOf({ ...draft, notes: '' }).description).toBe('');
    expect(requestOf({ ...newDraft('2026-10-12', 'c1', 'America/New_York', new Date('2026-10-12T12:00:00Z')), title: 'New' })).not.toHaveProperty('description');
  });

  it('send the people only when they changed, in any order, and always count the calendar’s owner', () => {
    const haircuts = { ...timed('Haircuts', 'm1', '2026-10-13T14:00:00Z', '2026-10-13T15:00:00Z'), memberIds: ['m3', 'm2'] };
    const draft = draftOf(haircuts, zone);

    expect(requestOf(draft)).not.toHaveProperty('memberIds');
    expect(requestOf({ ...draft, people: ['m2', 'm3'] })).not.toHaveProperty('memberIds');
    expect(requestOf({ ...draft, people: togglePerson(draft, 'm2') }).memberIds).toEqual(['m3']);
    expect(requestOf({ ...draft, people: [] }).memberIds).toEqual([]);
    expect(peopleChoices(draft, marloweCalendars, marlowes.members).map((p) => [p.id, p.owner, p.chosen])).toEqual([
      ['m1', true, true], ['m2', false, true], ['m3', false, true],
    ]);
    expect(peopleChoices({ ...draft, calendarId: 'c4', people: [] }, marloweCalendars, marlowes.members).every((p) => !p.owner && !p.chosen)).toBe(true);
  });

  it('copy an event as a new one that sends everything it keeps and does not repeat', () => {
    const therapy = {
      ...timed('Therapy', 'm2', '2026-10-13T14:00:00Z', '2026-10-13T15:00:00Z', 'Elm St'),
      private: true,
      description: 'Bring the form',
      memberIds: ['m1'],
      recurring: true,
      recurrence: 'RRULE:FREQ=WEEKLY',
      countdown: true,
    };
    const copy = copyOf(therapy, { id: 'c1', memberId: 'm1' }, zone);

    expect(requestOf(copy)).toMatchObject({
      calendarId: 'c1',
      title: 'Therapy',
      location: 'Elm St',
      startDate: '2026-10-13',
      startTime: '10:00:00',
      endTime: '11:00:00',
      description: 'Bring the form',
      // Tess's own event, copied into Ben's calendar, is still hers; Ben is its calendar's owner.
      memberIds: ['m2'],
      private: true,
    });
    expect(requestOf(copy)).not.toHaveProperty('recurrence');
    // A copy is not counted down to unless it is marked again.
    expect(copy.countdown).toBe(false);
    expect(requestOf(copy)).not.toHaveProperty('countdown');
    const swim = timed('Swim', 'm3', '2026-10-13T21:30:00Z', '2026-10-13T22:15:00Z');
    expect(requestOf(copyOf(swim, { id: swim.calendarId, memberId: 'm3' }, zone))).not.toHaveProperty('private');
    expect(requestOf(copyOf(swim, { id: swim.calendarId, memberId: 'm3' }, zone))).not.toHaveProperty('memberIds');
  });

  it('send privacy only when it changed', () => {
    const therapy = { ...timed('Therapy', 'm2', '2026-10-13T14:00:00Z', '2026-10-13T15:00:00Z'), private: true };
    const draft = draftOf(therapy, zone);

    expect(draft.isPrivate).toBe(true);
    expect(requestOf(draft)).not.toHaveProperty('private');
    expect(requestOf({ ...draft, isPrivate: false }).private).toBe(false);
    expect(requestOf({ ...newDraft('2026-10-13', 'c1', zone, new Date()), title: 'Gift', isPrivate: true }).private).toBe(true);
  });

  it('send the countdown mark only when it changed', () => {
    const cabin = { ...allDay('Cabin weekend', null, '2026-11-20', '2026-11-23'), countdown: true };
    const draft = draftOf(cabin, zone);

    expect(draft.countdown).toBe(true);
    expect(requestOf(draft)).not.toHaveProperty('countdown');
    expect(requestOf({ ...draft, countdown: false }).countdown).toBe(false);
    expect(requestOf({ ...newDraft('2026-10-13', 'c1', zone, new Date()), title: 'Party' })).not.toHaveProperty('countdown');
    expect(requestOf({ ...newDraft('2026-10-13', 'c1', zone, new Date()), title: 'Party', countdown: true }).countdown).toBe(true);
  });

  it('end a resized event at the new time on its own day, or at the midnight that ends it', () => {
    const swim = timed('Swim', 'm3', '2026-10-12T21:30:00Z', '2026-10-12T22:15:00Z'); // 5:30 to 6:15 PM

    expect(resizedTo(swim, 19 * 60, zone)).toMatchObject({ startDate: '2026-10-12', startTime: '17:30', endDate: '2026-10-12', endTime: '19:00' });
    expect(resizedTo(swim, 24 * 60, zone)).toMatchObject({ startTime: '17:30', endDate: '2026-10-13', endTime: '00:00' });
  });

  it('send a repeat rule only when it changed, and keep a series’ rule as it is', () => {
    const swim = { ...timed('Swim', 'm3', '2026-10-13T21:30:00Z', '2026-10-13T22:15:00Z'), recurring: true, recurrence: 'RRULE:FREQ=WEEKLY' };
    const draft = draftOf(swim, zone);

    expect(draft.recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU');
    expect(requestOf(draft)).not.toHaveProperty('recurrence');
    expect(requestOf({ ...draft, recurrence: 'RRULE:FREQ=DAILY' })).toMatchObject({ recurrence: 'RRULE:FREQ=DAILY' });
    // A rule the screens do not understand is kept, and never sent back.
    expect(draftOf({ ...swim, recurrence: 'RRULE:FREQ=WEEKLY;BYSETPOS=1' }, zone).recurrence).toBe('RRULE:FREQ=WEEKLY;BYSETPOS=1');
    expect(draftOf({ ...swim, recurring: false }, zone).recurrence).toBeNull();
  });

  it('let a ready-made repeat follow a new event’s first day, but not a series’ own rule', () => {
    const fresh = { ...newDraft('2026-10-13', 'c1', zone, new Date()), recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU' };
    expect(revise(fresh, moveDays(fresh, 1)).recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=WE');

    const series = { ...fresh, recurrenceFrom: fresh.recurrence };
    expect(revise(series, moveDays(series, 1)).recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU');
  });
});
