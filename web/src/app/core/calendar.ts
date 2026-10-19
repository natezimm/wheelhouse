import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap, timeout } from 'rxjs';
import { Day, addDays, dayIn, timeIn } from './days';
import { Member, refusalMessage } from './family';

/** One of the family's Google calendars. A null member means it is the whole family's. */
export interface CalendarSource {
  id: string;
  name: string;
  memberId: string | null;
  /** Whether events can be added to and changed in it from the screens. */
  canWrite: boolean;
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
  /** One event of a repeating series. A change to it changes only this event, unless the whole series is asked for. */
  recurring: boolean;
}

/** How often a new event repeats. */
export type Repeat = 'Never' | 'Daily' | 'Weekly' | 'Monthly';

/**
 * An event as a screen sets it, in the family's days and clock. A timed event runs from
 * startTime on startDate to endTime on endDate, as 'HH:mm:ss'; an all-day one has no times and
 * an exclusive endDate. Repeat makes a new event a series; a change leaves how an event repeats alone.
 */
export interface EventRequest {
  calendarId: string;
  title: string;
  location: string | null;
  allDay: boolean;
  startDate: Day;
  startTime: string | null;
  endDate: Day;
  endTime: string | null;
  repeat: Repeat;
}

interface CalendarResponse {
  changeNumber: number;
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
  private readonly live = signal<'idle' | 'connecting' | 'live' | 'reconnecting'>('idle');
  readonly connection = this.live.asReadonly();
  private target = 0;
  private identity = 0;
  private request = 0;
  private pending = false;
  private again = false;
  private retry?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.request++;
      clearTimeout(this.retry);
    });
  }

  setConnection(status: 'idle' | 'connecting' | 'live' | 'reconnecting'): void {
    this.live.set(status);
  }

  /** A new subscription includes the current revision, recovering anything missed offline. */
  changed(changeNumber: number): void {
    if (!Number.isSafeInteger(changeNumber) || changeNumber < 0) return;
    this.target = Math.max(this.target, changeNumber);
    const state = this.current();
    if (state.status !== 'idle' && (state.status !== 'ready' || state.changeNumber < this.target)) {
      if (!this.pending) this.fetch(state.from, state.to, state.status === 'ready');
    }
  }

  /** Forget data and in-flight responses when the signed-in family changes or access ends. */
  reset(): void {
    this.identity++;
    this.request++;
    this.pending = false;
    this.again = false;
    this.target = 0;
    clearTimeout(this.retry);
    this.current.set({ status: 'idle' });
    this.hiddenOwners.set(new Set());
  }

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
    this.request++;
    this.pending = false;
    this.again = false;
    clearTimeout(this.retry);
    this.current.set({ status: 'loading', from, to });
    this.fetch(from, to);
  }

  /** Fetches the days on screen again. A failed attempt keeps what is shown. */
  refresh(): void {
    const state = this.current();
    if (state.status !== 'idle') {
      if (this.pending) {
        this.again = true;
      } else {
        this.fetch(state.from, state.to, state.status === 'ready');
      }
    }
  }

  // Each change below reaches Google, through the server, first; the store takes the event as
  // the server returns it, so a refused change never shows on screen.

  /** Adds an event, or a series, which the server answers with its first event. */
  add(request: EventRequest): Observable<CalendarEvent> {
    const identity = this.identity;
    return this.http.post<CalendarEvent>('/api/calendar/events', request).pipe(
      tap((added) => {
        if (identity === this.identity) this.put(added);
      }),
    );
  }

  /**
   * Changes an event, or with <code>series</code> every event of its series, each staying on its
   * own day. When it changed in Google first, the server answers 409 with Google's version, which
   * the store shows instead; 404 means it was deleted there.
   */
  update(id: string, request: EventRequest, series = false): Observable<CalendarEvent> {
    const identity = this.identity;
    return this.http.put<CalendarEvent>(`/api/calendar/events/${id}`, request, { params: seriesParams(series) }).pipe(
      tap({
        next: (changed) => {
          if (identity === this.identity) this.put(changed);
        },
        error: (error: { status?: number; error?: unknown }) => {
          if (identity === this.identity) this.afterRefusal(id, error);
        },
      }),
    );
  }

  remove(id: string, series = false): Observable<void> {
    const identity = this.identity;
    return this.http.delete<void>(`/api/calendar/events/${id}`, { params: seriesParams(series) }).pipe(
      tap({
        next: () => {
          if (identity !== this.identity) return;
          this.drop(id);
          this.refresh();
        },
        error: (error: { status?: number; error?: unknown }) => {
          if (identity === this.identity) this.afterRefusal(id, error);
        },
      }),
    );
  }

  /** Shows what Google has now when a change was refused because the event changed or went away there. */
  private afterRefusal(id: string, error: { status?: number; error?: unknown }): void {
    if (error.status === 409 && isEvent(error.error)) {
      this.put(error.error);
    } else if (error.status === 404) {
      this.drop(id);
      this.refresh();
    }
  }

  /** Adds or replaces an event on screen, then reads the days again for the server's order. */
  private put(event: CalendarEvent): void {
    this.invalidateRead();
    this.current.update((state) =>
      state.status === 'ready' ? { ...state, events: [...state.events.filter((e) => e.id !== event.id), event] } : state,
    );
    this.refresh();
  }

  private drop(id: string): void {
    this.invalidateRead();
    this.current.update((state) =>
      state.status === 'ready' ? { ...state, events: state.events.filter((e) => e.id !== id) } : state,
    );
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

  private invalidateRead(): void {
    this.request++;
    this.pending = false;
    this.again = false;
    clearTimeout(this.retry);
  }

  private fetch(from: Day, to: Day, quietly = false): void {
    clearTimeout(this.retry);
    const request = ++this.request;
    this.pending = true;
    this.again = false;
    this.http.get<CalendarResponse>('/api/calendar', { params: { from, to } }).pipe(timeout(15_000)).subscribe({
      next: (response) => {
        if (request !== this.request) return;
        this.pending = false;
        const state = this.current();
        // Never replace a newer snapshot, even when returning to the same date range.
        if ((state.status === 'ready' && response.changeNumber < state.changeNumber) || response.changeNumber < this.target) {
          this.fetch(from, to, state.status === 'ready');
          return;
        }
        if (Number.isSafeInteger(response.changeNumber)) this.target = Math.max(this.target, response.changeNumber);
        this.current.set({ status: 'ready', from, to, ...response });
        if (this.again) {
          this.fetch(from, to, true);
        }
      },
      error: () => {
        if (request !== this.request) return;
        this.pending = false;
        if (!quietly) this.current.set({ status: 'unavailable', from, to });
        // A notification is not replayed after a failed GET. Keep trying its snapshot.
        this.retryRead();
      },
    });
  }

  private retryRead(): void {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.refresh(), 5_000);
  }
}

function seriesParams(series: boolean): Record<string, string> {
  return series ? { series: 'true' } : {};
}

/** A 409 for a change carries Google's version of the event; one for a lost connection carries a problem. */
function isEvent(body: unknown): body is CalendarEvent {
  return typeof body === 'object' && body !== null && 'calendarId' in body && 'title' in body;
}

/**
 * Why a change to an event was refused, said for people. When the event changed in Google
 * first, <code>changed</code> is Google's version, which the screen shows instead.
 */
export function eventRefusal(error: HttpErrorResponse): { message: string; changed: CalendarEvent | null } {
  if (error.status === 409 && isEvent(error.error)) {
    return {
      message: 'Someone changed this event in Google Calendar first. This is their version now.',
      changed: error.error,
    };
  }
  if (error.status === 404) {
    return { message: 'This event was deleted in Google Calendar.', changed: null };
  }
  if (error.status === 400) {
    return { message: refusalMessage(error, "This event can't be saved."), changed: null };
  }
  const title = typeof error.error?.title === 'string' ? error.error.title : null;
  if (title && (error.status === 409 || error.status === 503)) {
    return { message: title, changed: null };
  }
  return { message: "Can't save right now. Try again in a moment.", changed: null };
}
