import { CalendarEvent, CalendarSource, EventRequest, FAMILY_COLOR, Repeat } from './calendar';
import { Day, addDays, dayIn, minutesIn } from './days';
import { Member } from './family';

/**
 * An event being added or changed on a screen, in the family's days and clock. Times are
 * 'HH:mm'. For an all-day event endDate is the last day it covers; for a timed one it is the day
 * its end time falls on.
 */
export interface EventDraft {
  calendarId: string;
  title: string;
  location: string;
  allDay: boolean;
  startDate: Day;
  startTime: string;
  endDate: Day;
  endTime: string;
  /** How a new event repeats. */
  repeat: Repeat;
}

/** The choices of the Repeat row. */
export const REPEATS: readonly Repeat[] = ['Never', 'Daily', 'Weekly', 'Monthly'];

/** How far one tap moves a time on the wall. */
export const STEP_MINUTES = 15;

const DAY_MINUTES = 24 * 60;

/**
 * A new event on <code>day</code> for an hour: at <code>at</code> ('HH:mm') when a time was
 * picked, otherwise the next half hour when it is today, or 9 AM on another day.
 */
export function newDraft(day: Day, calendarId: string, timeZone: string, now: Date, at: string | null = null): EventDraft {
  const today = dayIn(timeZone, now);
  const start = at
    ? minutesOf(day, at) - minutesOf(day, '00:00')
    : day === today
      ? Math.min(Math.floor(minutesIn(timeZone, now) / 30) + 1, 47) * 30
      : 9 * 60;
  const [endDate, endTime] = split(minutesOf(day, clock(start)) + 60);
  return {
    calendarId,
    title: '',
    location: '',
    allDay: false,
    startDate: day,
    startTime: clock(start),
    endDate,
    endTime,
    repeat: 'Never',
  };
}

/** An event as it is now, ready to change. */
export function draftOf(event: CalendarEvent, timeZone: string): EventDraft {
  if (event.allDay) {
    return {
      calendarId: event.calendarId,
      title: event.title,
      location: event.location ?? '',
      allDay: true,
      startDate: event.startDate!,
      startTime: '09:00',
      endDate: addDays(event.endDate!, -1),
      endTime: '10:00',
      repeat: 'Never',
    };
  }
  return {
    calendarId: event.calendarId,
    title: event.title,
    location: event.location ?? '',
    allDay: false,
    startDate: dayIn(timeZone, event.startsAt!),
    startTime: clock(minutesIn(timeZone, event.startsAt!)),
    endDate: dayIn(timeZone, event.endsAt!),
    endTime: clock(minutesIn(timeZone, event.endsAt!)),
    repeat: 'Never',
  };
}

/**
 * A draft put back on <code>original</code>'s day, all day or timed as it was, keeping its new
 * times and length: a change to a whole series keeps each event on its own day.
 */
export function onDayOf(draft: EventDraft, original: EventDraft): EventDraft {
  const days = (Date.parse(original.startDate) - Date.parse(draft.startDate)) / (24 * 60 * 60_000);
  return moveDays({ ...draft, allDay: original.allDay }, days);
}

/** What the server is sent for a draft. */
export function requestOf(draft: EventDraft): EventRequest {
  return {
    calendarId: draft.calendarId,
    title: draft.title.trim(),
    location: draft.location.trim() || null,
    allDay: draft.allDay,
    startDate: draft.startDate,
    startTime: draft.allDay ? null : `${draft.startTime}:00`,
    endDate: draft.allDay ? addDays(draft.endDate, 1) : draft.endDate,
    endTime: draft.allDay ? null : `${draft.endTime}:00`,
    repeat: draft.repeat,
  };
}

/** What stops a draft from being saved, said for people, or null when it can be. */
export function problemWith(draft: EventDraft): string | null {
  if (!draft.title.trim()) {
    return 'Give the event a title.';
  }
  if (draft.allDay) {
    return draft.endDate < draft.startDate ? 'End the event on or after the day it starts.' : null;
  }
  return endOf(draft) <= startOf(draft) ? 'End the event after it starts.' : null;
}

/** Moves the whole event by whole days. */
export function moveDays(draft: EventDraft, days: number): EventDraft {
  return { ...draft, startDate: addDays(draft.startDate, days), endDate: addDays(draft.endDate, days) };
}

/** Moves an all-day event's last day, never before its first. */
export function moveLastDay(draft: EventDraft, days: number): EventDraft {
  const endDate = addDays(draft.endDate, days);
  return endDate < draft.startDate ? draft : { ...draft, endDate };
}

/** Moves the start within its day, keeping the event's length. */
export function moveStart(draft: EventDraft, minutes: number): EventDraft {
  const start = minutesOf(draft.startDate, draft.startTime);
  const moved = Math.min(Math.max(start + minutes, minutesOf(draft.startDate, '00:00')), minutesOf(draft.startDate, '23:45'));
  const [endDate, endTime] = split(endOf(draft) + moved - start);
  return { ...draft, startTime: clock(moved % DAY_MINUTES), endDate, endTime };
}

/** Moves the end, never to or before the start. */
export function moveEnd(draft: EventDraft, minutes: number): EventDraft {
  const end = Math.max(endOf(draft) + minutes, startOf(draft) + STEP_MINUTES);
  const [endDate, endTime] = split(end);
  return { ...draft, endDate, endTime };
}

/** A time such as '17:30' as the family reads it, "5:30 PM". */
export function clockLabel(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** A calendar an event can go in, labelled by whose it is. */
export interface CalendarChoice {
  id: string;
  label: string;
  initial: string;
  /** The owner's picture, if they chose one. */
  avatar?: string | null;
  color: string;
}

/**
 * The calendars events can be added to, in the members' order and then the family's. A
 * member's calendar takes their name, unless they have more than one.
 */
export function writableCalendars(calendars: readonly CalendarSource[], members: readonly Member[]): CalendarChoice[] {
  const writable = calendars.filter((calendar) => calendar.canWrite);
  const owned = (memberId: string | null) => writable.filter((calendar) => calendar.memberId === memberId);
  const choices: CalendarChoice[] = [];
  for (const member of members) {
    const theirs = owned(member.id);
    for (const calendar of theirs) {
      const label = theirs.length === 1 ? member.displayName : calendar.name;
      choices.push({ id: calendar.id, label, initial: member.initial, avatar: member.avatar, color: member.color });
    }
  }
  for (const calendar of writable.filter((c) => !choices.some((choice) => choice.id === c.id))) {
    choices.push({ id: calendar.id, label: calendar.name, initial: calendar.name.charAt(0).toUpperCase(), color: FAMILY_COLOR });
  }
  return choices;
}

function startOf(draft: EventDraft): number {
  return minutesOf(draft.startDate, draft.startTime);
}

function endOf(draft: EventDraft): number {
  return minutesOf(draft.endDate, draft.endTime);
}

/** Minutes since the start of 1970's first day, for comparing and adding to a day and time. */
function minutesOf(day: Day, time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (Date.parse(`${day}T00:00:00Z`) / 60_000) + hours * 60 + minutes;
}

function split(total: number): [Day, string] {
  const day = new Date(Math.floor(total / DAY_MINUTES) * DAY_MINUTES * 60_000).toISOString().slice(0, 10);
  return [day, clock(((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES)];
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
