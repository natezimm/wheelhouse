import { CalendarEvent, CalendarSource } from '../core/calendar';

/** The demo family's calendars, as the API returns them. Shared by the specs. */
export const marloweCalendars: CalendarSource[] = [
  { id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true },
  { id: 'c4', name: 'Family', memberId: null, canWrite: true },
  { id: 'c3', name: 'Milo', memberId: 'm3', canWrite: true },
  { id: 'c2', name: 'Tess', memberId: 'm2', canWrite: true },
];

const calendarOf = (memberId: string | null) => marloweCalendars.find((c) => c.memberId === memberId)!.id;

export function timed(title: string, memberId: string | null, startsAt: string, endsAt: string, location: string | null = null): CalendarEvent {
  return {
    id: `${title}@${startsAt}`,
    calendarId: calendarOf(memberId),
    memberId,
    title,
    location,
    allDay: false,
    startsAt,
    endsAt,
    startDate: null,
    endDate: null,
    recurring: false,
  };
}

export function allDay(title: string, memberId: string | null, startDate: string, endDate: string): CalendarEvent {
  return {
    id: `${title}@${startDate}`,
    calendarId: calendarOf(memberId),
    memberId,
    title,
    location: null,
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate,
    endDate,
    recurring: false,
  };
}
