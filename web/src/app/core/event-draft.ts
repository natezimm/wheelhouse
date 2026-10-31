import { CalendarEvent, CalendarSource, EventRequest, FAMILY_COLOR, sameMembers } from './calendar';
import { instantAt } from './calendar-preview';
import { Day, addDays, dayIn, minutesIn } from './days';
import { notesText } from './notes';
import { Member } from './family';
import { canonicalRule, followDay } from './repeat-rule';

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
  /**
   * Its repeat rule (see repeat-rule.ts), or null for an event that does not repeat. A change to
   * one event of a series leaves it alone; a change to the whole series may set a new one.
   */
  recurrence: string | null;
  /** The rule as the event had it. The rule is sent only when it changed. */
  recurrenceFrom: string | null;
  /** The notes, as plain text. */
  notes: string;
  /**
   * The notes as the event had them. Notes are sent only when they changed, so an edit never
   * rewrites notes kept as HTML into plain text.
   */
  notesFrom: string;
  /** The members it is for besides its calendar's owner. */
  people: string[];
  /** The people as the event had them; they are sent only when they changed. */
  peopleFrom: string[];
  /** Private in Google, so displays show it only as busy. Sent only when it changed. */
  isPrivate: boolean;
  privateFrom: boolean;
  /** Counted down to on the wall, and whether it was before this edit. */
  countdown: boolean;
  countdownFrom: boolean;
}

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
    recurrence: null,
    recurrenceFrom: null,
    notes: '',
    notesFrom: '',
    people: [],
    peopleFrom: [],
    isPrivate: false,
    privateFrom: false,
    countdown: false,
    countdownFrom: false,
  };
}

/** An event as it is now, ready to change. */
export function draftOf(event: CalendarEvent, timeZone: string): EventDraft {
  const notes = notesText(event.description);
  const first = event.startDate ?? dayIn(timeZone, event.startsAt!);
  // A rule the screens do not understand is kept as Google wrote it, and is never sent back.
  const recurrence = event.recurring ? canonicalRule(event.recurrence, first, timeZone) ?? event.recurrence ?? null : null;
  const people = event.memberIds ?? [];
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
      recurrence,
      recurrenceFrom: recurrence,
      notes,
      notesFrom: notes,
      people,
      peopleFrom: people,
      isPrivate: !!event.private,
      privateFrom: !!event.private,
      countdown: !!event.countdown,
      countdownFrom: !!event.countdown,
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
    recurrence,
    recurrenceFrom: recurrence,
    notes,
    notesFrom: notes,
    people,
    peopleFrom: people,
    isPrivate: !!event.private,
    privateFrom: !!event.private,
    countdown: !!event.countdown,
    countdownFrom: !!event.countdown,
  };
}

/**
 * A new event like <code>event</code>: the same title, place, times, notes, people and privacy,
 * in <code>calendar</code>, which is its calendar when that takes new events. Copied into another
 * calendar it keeps its own calendar's owner among its people. It does not repeat, even when
 * copied from a series, and is not counted down to until marked; everything it keeps is sent, since nothing holds it yet.
 */
export function copyOf(event: CalendarEvent, calendar: Pick<CalendarSource, 'id' | 'memberId'>, timeZone: string): EventDraft {
  const draft = draftOf(event, timeZone);
  const owners = calendar.id !== event.calendarId && event.memberId ? [event.memberId, ...draft.people] : draft.people;
  return {
    ...draft,
    calendarId: calendar.id,
    people: [...new Set(owners)].filter((id) => id !== calendar.memberId),
    recurrence: null,
    recurrenceFrom: null,
    notesFrom: '',
    peopleFrom: [],
    privateFrom: false,
    countdown: false,
    countdownFrom: false,
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
    ...(draft.recurrence && draft.recurrence !== draft.recurrenceFrom ? { recurrence: draft.recurrence } : {}),
    ...(draft.notes.trim() !== draft.notesFrom.trim() ? { description: draft.notes.trim() } : {}),
    ...(!sameMembers(draft.people, draft.peopleFrom) ? { memberIds: draft.people } : {}),
    ...(draft.isPrivate !== draft.privateFrom ? { private: draft.isPrivate } : {}),
    ...(draft.countdown !== draft.countdownFrom ? { countdown: draft.countdown } : {}),
  };
}

/**
 * A draft changed to <code>next</code>. A repeat being set for the first time follows a new first
 * day, so Weekly on Tuesday becomes Weekly on Wednesday, and so does the rule of events that become
 * a series of their own (<code>splitting</code>); otherwise a series' own rule stays as it is.
 */
export function revise(draft: EventDraft, next: EventDraft, splitting = false): EventDraft {
  return next.startDate === draft.startDate || (next.recurrenceFrom !== null && !splitting) || next.recurrence !== draft.recurrence
    ? next
    : { ...next, recurrence: followDay(next.recurrence, draft.startDate, next.startDate) };
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

/**
 * A timed event moved to start at <code>time</code> ('HH:mm') on <code>day</code>, keeping how long
 * it really lasts: an event that spans a clock change keeps its elapsed length, not its clock times.
 */
export function movedTo(event: CalendarEvent, day: Day, time: string, timeZone: string): EventDraft {
  const end = new Date(Date.parse(instantAt(day, time, timeZone)) + Date.parse(event.endsAt!) - Date.parse(event.startsAt!));
  return { ...draftOf(event, timeZone), startDate: day, startTime: time, endDate: dayIn(timeZone, end), endTime: clock(minutesIn(timeZone, end)) };
}

/** A timed event given a new end on its first day, <code>end</code> minutes after that day's midnight; 24:00 is the next midnight. */
export function resizedTo(event: CalendarEvent, end: number, timeZone: string): EventDraft {
  const draft = draftOf(event, timeZone);
  return end >= DAY_MINUTES
    ? { ...draft, endDate: addDays(draft.startDate, 1), endTime: '00:00' }
    : { ...draft, endDate: draft.startDate, endTime: clock(end) };
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

/**
 * Starts the event at <code>time</code> ('HH:mm') on its own day, keeping its length, as typing a
 * start does.
 */
export function startAt(draft: EventDraft, time: string): EventDraft {
  const start = minutesOf(draft.startDate, draft.startTime);
  const [endDate, endTime] = split(endOf(draft) + minutesOf(draft.startDate, time) - start);
  return { ...draft, startTime: time, endDate, endTime };
}

/**
 * Ends the event at <code>time</code> ('HH:mm'), as typing an end does: at the first such time
 * from its start, so a time before the start ends it the next day. An event longer than a day keeps
 * its last day while the time still falls after the start.
 */
export function endAt(draft: EventDraft, time: string): EventDraft {
  const start = startOf(draft);
  const onLastDay = minutesOf(draft.endDate, time);
  const end = endOf(draft) - start > DAY_MINUTES && onLastDay > start ? onLastDay
    : minutesOf(draft.startDate, time) + (time < draft.startTime ? DAY_MINUTES : 0);
  const [endDate, endTime] = split(end);
  return { ...draft, endDate, endTime };
}

/**
 * A typed time as 'HH:mm', or null when it is not one: "3pm", "3:30 PM", "3.30p", "330pm", "15:30",
 * "1530", "noon" or "midnight". An hour from 1 to 11 with no AM or PM, such as "3" or "3:30", is the
 * first of its morning and afternoon times from <code>after</code> ('HH:mm'), so by default "8" is
 * 8 AM and "3" is 3 PM, and an end after a 9 AM start reads "1" as 1 PM.
 */
export function parseClock(text: string, after = '07:00'): string | null {
  const typed = text.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, (dot, at, all) => (/\d/.test(all[at - 1] ?? '') && /\d/.test(all[at + 1] ?? '') ? ':' : ''));
  if (typed === 'noon') return '12:00';
  if (typed === 'midnight') return '00:00';
  const match = /^(\d{1,2})(?::?(\d{2}))?(am?|pm?)?$/.exec(typed);
  if (!match) return null;
  const [, hourText, minuteText = '00', half] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (minute > 59) return null;
  if (half) {
    return hour < 1 || hour > 12 ? null : clock(((hour % 12) + (half.startsWith('p') ? 12 : 0)) * 60 + minute);
  }
  if (hour > 23) return null;
  if (hour === 0 || hour >= 12 || hourText.startsWith('0')) return clock(hour * 60 + minute);
  const morning = clock(hour * 60 + minute);
  const afternoon = clock((hour + 12) * 60 + minute);
  return morning >= after ? morning : afternoon >= after ? afternoon : morning;
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
    choices.push({ id: calendar.id, label: calendar.name, initial: 'F', color: FAMILY_COLOR });
  }
  return choices;
}

/** A member an event can be for: always its calendar's owner, and anyone else who is chosen. */
export interface PersonChoice {
  id: string;
  name: string;
  initial: string;
  avatar: string | null;
  color: string;
  /** The calendar's owner, whose event it is already. */
  owner: boolean;
  chosen: boolean;
}

/** Who the draft's event can be for, in the members' order. */
export function peopleChoices(draft: EventDraft, calendars: readonly CalendarSource[], members: readonly Member[]): PersonChoice[] {
  const owner = calendars.find((calendar) => calendar.id === draft.calendarId)?.memberId ?? null;
  return members.map((member) => ({
    id: member.id,
    name: member.displayName,
    initial: member.initial,
    avatar: member.avatar ?? null,
    color: member.color,
    owner: member.id === owner,
    chosen: member.id === owner || draft.people.includes(member.id),
  }));
}

/** The draft's people with <code>id</code> added, or taken away when it was there. */
export function togglePerson(draft: EventDraft, id: string): string[] {
  return draft.people.includes(id) ? draft.people.filter((person) => person !== id) : [...draft.people, id];
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
