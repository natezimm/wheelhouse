import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Day, addDays, dayIn, timeIn } from './days';
import { Member } from './family';

/** One of the family's Google calendars. A null member means it is the whole family's. */
export interface CalendarSource {
  id: string;
  name: string;
  memberId: string | null;
}

/**
 * A timed event has startsAt and endsAt, as instants; an all-day event has startDate and an
 * exclusive endDate, as days in the family's zone.
 */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  memberId: string | null;
  title: string;
  location: string | null;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startDate: Day | null;
  endDate: Day | null;
}

interface CalendarResponse {
  calendars: CalendarSource[];
  events: CalendarEvent[];
  /** Google stopped accepting the family's connection, so the events have stopped updating. */
  needsReconnect: boolean;
}

export type CalendarState =
  | { status: 'idle' }
  | { status: 'loading'; from: Day; to: Day }
  | ({ status: 'ready'; from: Day; to: Day } & CalendarResponse)
  | { status: 'unavailable'; from: Day; to: Day };

/** The filter key for whole-family events. Members' events use the member's id. */
export const FAMILY = 'family';

/** The color of whole-family events, which belong to no one member. */
export const FAMILY_COLOR = '#4A4F57';

/** Whose an event is, for the filter: a member's id, or FAMILY. */
export const ownerOf = (event: CalendarEvent) => event.memberId ?? FAMILY;

/** The color an event takes: its member's, or the family's. */
export function colorOf(event: CalendarEvent, members: readonly Member[]): string {
  return members.find((member) => member.id === event.memberId)?.color ?? FAMILY_COLOR;
}

/** The family's days an event shows on. A timed event that ends at midnight does not reach the next day. */
export function daysOf(event: CalendarEvent, timeZone: string): Day[] {
  const first = event.allDay ? event.startDate! : dayIn(timeZone, event.startsAt!);
  const last = event.allDay
    ? addDays(event.endDate!, -1)
    : dayIn(timeZone, new Date(new Date(event.endsAt!).getTime() - 1));
  const days: Day[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    days.push(day);
  }
  return days.length > 0 ? days : [first];
}

/** When an event happens, as a short label for one of the days it shows on. */
export function whenOn(event: CalendarEvent, day: Day, timeZone: string): string {
  if (event.allDay) {
    return 'All day';
  }
  const starts = dayIn(timeZone, event.startsAt!) === day;
  const ends = dayIn(timeZone, new Date(new Date(event.endsAt!).getTime() - 1)) === day;
  if (starts) {
    return timeIn(timeZone, event.startsAt!);
  }
  return ends ? `Until ${timeIn(timeZone, event.endsAt!)}` : 'All day';
}

/** A timed event's times, such as "10:30 – 11:15 AM", or "11:30 AM – 12:15 PM" across noon. */
export function timeRange(event: CalendarEvent, timeZone: string): string {
  const start = timeIn(timeZone, event.startsAt!);
  const end = timeIn(timeZone, event.endsAt!);
  return start.slice(-2) === end.slice(-2) ? `${start.slice(0, -3)} – ${end}` : `${start} – ${end}`;
}

/**
 * The calendar for the days a screen is showing, and which people's events are filtered out.
 * Google Calendar stays the source of truth; this reads the server's copy of it.
 */
@Injectable({ providedIn: 'root' })
export class CalendarStore {
  private readonly http = inject(HttpClient);
  private readonly current = signal<CalendarState>({ status: 'idle' });
  private readonly hiddenOwners = signal<ReadonlySet<string>>(new Set());

  readonly state = this.current.asReadonly();

  /** Owners whose events are filtered out: member ids, or FAMILY. */
  readonly hidden = this.hiddenOwners.asReadonly();

  readonly calendars = computed(() => {
    const state = this.current();
    return state.status === 'ready' ? state.calendars : [];
  });

  /** Every event in range, filtered or not. */
  readonly allEvents = computed(() => {
    const state = this.current();
    return state.status === 'ready' ? state.events : [];
  });

  /** The events in range that the filter lets through. */
  readonly events = computed(() => {
    const hidden = this.hiddenOwners();
    return this.allEvents().filter((event) => !hidden.has(ownerOf(event)));
  });

  /** Whether a parent has to connect Google again before the calendar updates. */
  readonly needsReconnect = computed(() => {
    const state = this.current();
    return state.status === 'ready' && state.needsReconnect;
  });

  /** Whether any calendar is the whole family's, so the filter needs a chip for it. */
  readonly hasFamilyCalendar = computed(() => this.calendars().some((calendar) => calendar.memberId === null));

  /** Shows the days from <code>from</code> up to, not including, <code>to</code>. Asking again for the same days does nothing. */
  show(from: Day, to: Day): void {
    const state = this.current();
    if (state.status !== 'idle' && state.status !== 'unavailable' && state.from === from && state.to === to) {
      return;
    }
    this.current.set({ status: 'loading', from, to });
    this.fetch(from, to);
  }

  /** Fetches the days on screen again. A failed attempt keeps what is shown. */
  refresh(): void {
    const state = this.current();
    if (state.status === 'ready') {
      this.fetch(state.from, state.to, true);
    }
  }

  toggle(owner: string): void {
    this.hiddenOwners.update((hidden) => {
      const next = new Set(hidden);
      if (!next.delete(owner)) {
        next.add(owner);
      }
      return next;
    });
  }

  private fetch(from: Day, to: Day, quietly = false): void {
    this.http.get<CalendarResponse>('/api/calendar', { params: { from, to } }).subscribe({
      next: (response) => {
        // A slower answer for days no longer on screen is dropped.
        const state = this.current();
        if (state.status !== 'idle' && state.from === from && state.to === to) {
          this.current.set({ status: 'ready', from, to, ...response });
        }
      },
      error: () => {
        const state = this.current();
        if (!quietly && state.status !== 'idle' && state.from === from && state.to === to) {
          this.current.set({ status: 'unavailable', from, to });
        }
      },
    });
  }
}
