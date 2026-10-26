import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal, untracked } from '@angular/core';
import { Observable, catchError, defer, of, shareReplay, switchMap, tap, throwError, timeout } from 'rxjs';
import { Day, addDays, dayIn, timeIn } from './days';
import { FamilyStore, Member, refusalMessage } from './family';
import { overlaps, previewEvent, previewOccurrences, previewSeries } from './calendar-preview';

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
  /** Opaque, family-scoped correlation shared by the loaded occurrences of a series. */
  seriesId?: string | null;
  /** Correlates an optimistic create with snapshots received before its HTTP response. */
  creationId?: string | null;
  /** The event's notes as Google keeps them, which may hold simple HTML; see notesText. */
  description?: string | null;
  /** Its series' repeat rule, such as "RRULE:FREQ=WEEKLY;BYDAY=TU,TH"; see describeRule. */
  recurrence?: string | null;
  pending?: boolean;
}

/** How often a new event, or one that does not repeat yet, repeats. */
export type Repeat = 'Never' | 'Daily' | 'Weekly' | 'Monthly';

/**
 * An event as a screen sets it, in the family's days and clock. A timed event runs from
 * startTime on startDate to endTime on endDate, as 'HH:mm:ss'; an all-day one has no times and
 * an exclusive endDate. Repeat makes a new event, or a change to one that does not repeat yet, the
 * first of a series; a change to an event that already repeats leaves its rule alone.
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
  /** New notes, replacing the event's; left out, the notes stay as they are. Empty clears them. */
  description?: string | null;
}

export interface PendingCalendarChange {
  id: string;
  kind: 'add' | 'update' | 'remove';
  request?: EventRequest;
  original?: CalendarEvent;
  originals: CalendarEvent[];
  series: boolean;
  source: CalendarSource;
  zone: string;
  status: 'saving' | 'uncertain' | 'settling';
  settleAfter?: number;
  result?: CalendarEvent;
}

interface CalendarResponse {
  changeNumber: number;
  calendars: CalendarSource[];
  events: CalendarEvent[];
  /** Google stopped accepting the family's connection, so the events have stopped updating. */
  needsReconnect: boolean;
  /**
   * The days the server keeps of the family's Google calendars, the last exclusive; absent when
   * everything there is is kept, as on the demo. Days outside it are not empty, only unread.
   */
  syncedFrom?: Day | null;
  syncedTo?: Day | null;
}

export type CalendarState =
  | { status: 'idle' }
  | { status: 'loading'; from: Day; to: Day }
  | ({ status: 'ready'; from: Day; to: Day } & CalendarResponse)
  | { status: 'unavailable'; from: Day; to: Day };

/** The filter key for whole-family events. Members' events use the member's id. */
export const FAMILY = 'family';

/**
 * The color of whole-family events, which belong to no one member. It is a token, because Night
 * lightens it: the day's slate would all but vanish on a dark card.
 */
export const FAMILY_COLOR = 'var(--family)';

/** Whose an event is, for the filter: a member's id, or FAMILY. */
export const ownerOf = (event: CalendarEvent) => event.memberId ?? FAMILY;

/** The color an event takes: its member's, or the family's. */
export function colorOf(event: CalendarEvent, members: readonly Member[]): string {
  return members.find((member) => member.id === event.memberId)?.color ?? FAMILY_COLOR;
}

/** The first and last of the family's days an event shows on. A timed event that ends at midnight does not reach the next day. */
export function spanOf(event: CalendarEvent, timeZone: string): { first: Day; last: Day } {
  const first = event.allDay ? event.startDate! : dayIn(timeZone, event.startsAt!);
  const last = event.allDay
    ? addDays(event.endDate!, -1)
    : dayIn(timeZone, new Date(new Date(event.endsAt!).getTime() - 1));
  return { first, last: last < first ? first : last };
}

/** Whether an event shows on one of the family's days, without listing the days of a long one. */
export function showsOn(event: CalendarEvent, day: Day, timeZone: string): boolean {
  const { first, last } = spanOf(event, timeZone);
  return first <= day && day <= last;
}

/**
 * The family's days an event shows on. With <code>within</code>, only those from its
 * <code>from</code> up to, not including, its <code>to</code>, so an event that runs for years
 * costs only the days on screen.
 */
export function daysOf(event: CalendarEvent, timeZone: string, within?: { from: Day; to: Day }): Day[] {
  const { first, last } = spanOf(event, timeZone);
  const from = within && within.from > first ? within.from : first;
  const to = within && within.to <= last ? addDays(within.to, -1) : last;
  const days: Day[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
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
  private readonly family = inject(FamilyStore);
  private familyEpoch = 0;
  private readonly operations = signal<PendingCalendarChange[]>([]);
  private readonly failure = signal<string | null>(null);
  readonly pending = this.operations.asReadonly();
  readonly saveFailure = this.failure.asReadonly();

  dismissFailure(): void { this.failure.set(null); }
  isUncertain(id: string): boolean { return this.operations().some((op) => op.id === id && op.status === 'uncertain'); }
  isPending(id: string, wholeSeries = false): boolean {
    const event = this.current().status === 'ready' ? this.allEvents().find((e) => e.id === id) : undefined;
    return this.operations().some((op) => op.id === event?.creationId || op.original?.id === id
      || op.originals.some((e) => e.id === id)
      || (!!event?.seriesId && event.seriesId === op.original?.seriesId && (op.series || wholeSeries)));
  }

  private readonly current = signal<CalendarState>({ status: 'idle' });
  private readonly hiddenOwners = signal<ReadonlySet<string>>(new Set());

  private serial = 0;
  private active: number | null = null;
  private queued = false;
  private wanted = 0;
  private readonly accepted = signal<number | null>(null);
  private readonly fetching = signal(false);
  private readonly readFailed = signal(false);
  private readonly acceptedAt = signal<Date | null>(null);

  readonly state = computed<CalendarState>(() => {
    const state = this.current();
    return state.status === 'ready' ? { ...state, events: this.project(state) } : state;
  });
  /** The revision actually represented by the last accepted snapshot, never a notification. */
  readonly changeNumber = this.accepted.asReadonly();
  readonly refreshing = this.fetching.asReadonly();
  /** A failed background refresh retains the snapshot, but must still offer a visible retry. */
  readonly refreshFailed = this.readFailed.asReadonly();
  /** When the snapshot on screen was read, so a stale screen can say what time it shows. */
  readonly shownAt = this.acceptedAt.asReadonly();

  /** Forget another family's data and invalidate every outstanding response. */
  reset(): void {
    this.familyEpoch++;
    this.operations.set([]);
    this.failure.set(null);
    this.serial++;
    this.active = null;
    this.queued = false;
    this.wanted = 0;
    this.accepted.set(null);
    this.fetching.set(false);
    this.readFailed.set(false);
    this.acceptedAt.set(null);
    this.knownCalendars.set([]);
    this.current.set({ status: 'idle' });
    this.hiddenOwners.set(new Set());
  }

  /** Notifications can skip revisions; only a fresh snapshot acknowledges them. */
  changed(changeNumber: number): void {
    if (!Number.isSafeInteger(changeNumber) || changeNumber < 0) return;
    this.wanted = Math.max(this.wanted, changeNumber);
    if (changeNumber <= (this.accepted() ?? -1) || this.active !== null) return;
    this.refresh();
  }

  /** Owners whose events are filtered out: member ids, or FAMILY. */
  readonly hidden = this.hiddenOwners.asReadonly();

  /** The calendars from the last snapshot, so columns, chips and Add event stay put while other days load. */
  private readonly knownCalendars = signal<CalendarSource[]>([]);

  readonly calendars = computed(() => {
    const state = this.current();
    return state.status === 'ready' ? state.calendars : this.knownCalendars();
  });

  /** Every event in range, filtered or not. */
  readonly allEvents = computed(() => {
    const state = this.state();
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

  /**
   * Where the days on screen reach past the days the server keeps: the first day kept, when they
   * start before it, and the last, when they end after it. Null when every day on screen is kept,
   * so a screen can say why days look empty rather than claim nothing is planned.
   */
  readonly outsideSync = computed<{ first: Day | null; last: Day | null } | null>(() => {
    const state = this.current();
    if (state.status !== 'ready' || !state.syncedFrom || !state.syncedTo) return null;
    const first = state.from < state.syncedFrom ? state.syncedFrom : null;
    const last = state.to > state.syncedTo ? addDays(state.syncedTo, -1) : null;
    return first || last ? { first, last } : null;
  });

  /** Whether the server keeps a day's events, so an empty day is known to be empty. */
  isSynced(day: Day): boolean {
    return this.unsyncedSide(day) === null;
  }

  /** Which side of the days kept a day falls on, or null when it is kept. */
  unsyncedSide(day: Day): 'back' | 'ahead' | null {
    const state = this.current();
    if (state.status !== 'ready' || !state.syncedFrom || !state.syncedTo) return null;
    return day < state.syncedFrom ? 'back' : day >= state.syncedTo ? 'ahead' : null;
  }

  /** Whether any calendar is the whole family's, so the filter needs a chip for it. */
  readonly hasFamilyCalendar = computed(() => this.calendars().some((calendar) => calendar.memberId === null));

  /** Shows the days from <code>from</code> up to, not including, <code>to</code>. Asking again for the same days does nothing. */
  show(from: Day, to: Day): void {
    // Views call this from effects. Untracked, so a failed read does not make their effect ask again at once.
    untracked(() => {
      const state = this.current();
      if (state.status !== 'idle' && state.status !== 'unavailable' && state.from === from && state.to === to) {
        return;
      }
      this.invalidateRead();
      this.current.set({ status: 'loading', from, to });
      this.fetch(from, to);
    });
  }

  /** Fetches the days on screen again. A failed attempt keeps what is shown. */
  refresh(): void {
    const state = this.current();
    if (state.status === 'idle') return;
    if (this.active !== null) {
      this.queued = true;
      return;
    }
    this.fetch(state.from, state.to, state.status === 'ready');
  }

  /** A confirmed write must not be overwritten by a snapshot started before it. */
  private invalidateRead(): void {
    this.serial++;
    this.active = null;
    this.queued = false;
  }

  /** Each subscription starts one optimistic operation; multiple subscribers share the save. */
  add(request: EventRequest, operationId: string = crypto.randomUUID()): Observable<CalendarEvent> {
    return this.mutate('add', undefined, request, false, operationId) as Observable<CalendarEvent>;
  }

  update(id: string, request: EventRequest, series = false, operationId: string = crypto.randomUUID()): Observable<CalendarEvent> {
    return this.mutate('update', id, request, series, operationId) as Observable<CalendarEvent>;
  }

  remove(id: string, series = false, operationId: string = crypto.randomUUID()): Observable<void> {
    return this.mutate('remove', id, undefined, series, operationId) as Observable<void>;
  }

  /** Check a lost response first; retry the frozen intent, with the same create id if needed. */
  retry(id: string): Observable<CalendarEvent | void> {
    const op = this.operations().find((op) => op.id === id);
    return op ? this.mutate(op.kind, op.original?.id, op.request, op.series, id) : of(undefined);
  }

  private mutate(kind: PendingCalendarChange['kind'], eventId: string | undefined,
    request: EventRequest | undefined, series: boolean, operationId: string): Observable<CalendarEvent | void> {
    return defer(() => {
      const epoch = this.familyEpoch;
      const existing = this.operations().find((op) => op.id === operationId);
      if (existing && (existing.status !== 'uncertain' || existing.kind !== kind)) return throwError(() => new HttpErrorResponse({ status: 409, error: { title: 'This change is still saving.' } }));
      const original = existing?.original ?? this.allEvents().find((e) => e.id === eventId);
      const source = existing?.source ?? this.calendars().find((c) => c.id === (request?.calendarId ?? original?.calendarId));
      if (!source || !source.canWrite || (kind !== 'add' && !original)) {
        return throwError(() => new HttpErrorResponse({ status: 400, error: { title: 'This event cannot be changed right now.' } }));
      }
      if (!existing && eventId && this.isPending(eventId, series)) {
        return throwError(() => new HttpErrorResponse({ status: 409, error: { title: 'This event is still saving.' } }));
      }
      const op: PendingCalendarChange = existing ?? {
        id: operationId, kind, request, original, series, source,
        originals: original ? this.allEvents().filter((e) => e.id === original.id || (series && !!original.seriesId && e.seriesId === original.seriesId)) : [],
        zone: this.family.family()?.timeZone ?? 'UTC', status: 'saving',
      };
      op.status = 'saving';
      this.failure.set(null);
      this.operations.update((ops) => [...ops.filter((p) => p.id !== op.id), op]);
      const send = () => kind === 'add'
        ? this.http.post<CalendarEvent>('/api/calendar/events', { ...op.request, creationId: op.id })
        : kind === 'update'
          ? this.http.put<CalendarEvent>(`/api/calendar/events/${op.original!.id}`, op.request, { params: seriesParams(op.series) })
          : this.http.delete<void>(`/api/calendar/events/${op.original!.id}`, { params: seriesParams(op.series) });
      const call = existing ? this.reconcile(op).pipe(switchMap((found) => found.resolved ? of(found.event) : send())) : send();
      return call.pipe(timeout(20_000), tap((result) => {
        if (epoch !== this.familyEpoch) return;
        this.invalidateRead();
        op.status = 'settling';
        op.settleAfter = this.serial + 1;
        op.result = result || undefined;
        this.operations.update((ops) => ops.map((p) => p.id === op.id ? { ...op } : p));
        if (result) this.current.update((state) => state.status === 'ready'
          ? { ...state, events: [...state.events.filter((e) => e.id !== result.id && e.id !== op.original?.id), result] } : state);
        this.refresh();
      }), catchError((error: unknown) => {
        if (epoch !== this.familyEpoch) return throwError(() => error);
        const http = error as HttpErrorResponse;
        const uncertain = !(error instanceof HttpErrorResponse) || http.status === 0 || http.status >= 500;
        this.operations.update((ops) => uncertain
          ? ops.map((p) => p.id === op.id ? { ...p, status: 'uncertain' } : p)
          : ops.filter((p) => p.id !== op.id));
        if (!uncertain && http.status === 409 && isEvent(http.error)) {
          this.invalidateRead();
          this.current.update((state) => state.status === 'ready'
            ? { ...state, events: [...state.events.filter((e) => e.id !== eventId), http.error as CalendarEvent] } : state);
          this.refresh();
        } else if (!uncertain && http.status === 404) {
          this.invalidateRead();
          this.current.update((state) => state.status === 'ready' ? { ...state, events: state.events.filter((e) => e.id !== eventId) } : state);
          this.refresh();
        }
        this.failure.set(uncertain ? 'A save could not be confirmed. Check it before trying again.' : eventRefusal(http).message);
        return throwError(() => error);
      }));
    }).pipe(shareReplay({ bufferSize: 1, refCount: false }));
  }

  private reconcile(op: PendingCalendarChange): Observable<{ resolved: boolean; event?: CalendarEvent }> {
    const day = op.request?.startDate ?? op.original!.startDate ?? dayIn(op.zone, op.original!.startsAt!);
    const starts = startsSeries(op);
    return this.http.get<CalendarResponse>('/api/calendar', { params: { from: day, to: addDays(day, 1) } }).pipe(
      timeout(15_000), switchMap((snapshot) => {
        const expected = op.kind === 'remove' ? undefined : op.series && op.original
          ? previewSeries(op.request!, op.source, op.original, op.zone)
          : previewEvent(op.request!, op.source, '', op.zone, op.original);
        // Google gives an event that starts to repeat new occurrence ids, so its first occurrence is found by content.
        const matching = snapshot.events.filter((e) => op.kind === 'add' ? e.creationId === op.id
          : e.id === op.original?.id || (op.series && !!op.original?.seriesId && e.seriesId === op.original.seriesId)
            || (starts && e.recurring && sameContent(e, expected!)));
        if (op.kind === 'remove') {
          if (!matching.length) return of({ resolved: true });
          const current = matching.find((e) => e.id === op.original!.id) ?? matching[0];
          if (!sameContent(current, op.original!)) return throwError(() => new HttpErrorResponse({ status: 409, error: current }));
          return of({ resolved: false });
        }
        const found = matching.find((e) => sameContent(e, expected!) && (!starts || e.recurring));
        if (op.kind === 'update' && !found && matching.length) {
          const current = matching.find((e) => e.id === op.original!.id) ?? matching[0];
          if (!sameContent(current, op.original!)) return throwError(() => new HttpErrorResponse({ status: 409, error: current }));
        }
        // A known create is never repeated, even if someone changed it after our lost response.
        return of({ resolved: op.kind === 'add' ? matching.length > 0 : !!found, event: op.kind === 'add' ? matching[0] : found });
      }),
    );
  }

  private project(state: Extract<CalendarState, { status: 'ready' }>): CalendarEvent[] {
    if (this.operations().length === 0) return state.events;
    let events = state.events;
    for (const op of this.operations()) {
      const matches = (e: CalendarEvent) => e.id === op.original?.id || op.originals.some((old) => old.id === e.id)
        || (op.series && !!op.original?.seriesId && e.seriesId === op.original.seriesId);
      if (op.kind === 'remove') { events = events.filter((e) => !matches(e)); continue; }
      if (op.kind === 'add') {
        const known = events.filter((e) => e.creationId === op.id || e.id === op.result?.id);
        const previews = previewOccurrences(op.request!, op.source, op.id, op.zone, state.from, state.to);
        const dayOf = (e: CalendarEvent) => e.startDate ?? dayIn(op.zone, e.startsAt!);
        const shown = previews.map((preview) => ({ ...(known.find((e) => dayOf(e) === dayOf(preview)) ?? preview), pending: true }));
        events = [...events.filter((e) => !known.includes(e)), ...shown,
          ...known.filter((e) => !previews.some((p) => dayOf(e) === dayOf(p))).map((e) => ({ ...e, pending: true }))];
      } else if (startsSeries(op)) {
        // An event that starts to repeat shows as the new series across the loaded days, in place of itself.
        events = [...events.filter((e) => !matches(e) && e.id !== op.result?.id && !(op.result?.seriesId && e.seriesId === op.result.seriesId)),
          ...previewOccurrences(op.request!, op.source, op.id, op.zone, state.from, state.to)];
      } else {
        const loaded = events.filter(matches);
        const originals = loaded.length ? loaded : op.originals;
        events = [...events.filter((e) => !matches(e)), ...originals.map((e) => op.series
          ? previewSeries(op.request!, op.source, e, op.zone)
          : previewEvent(op.request!, op.source, e.id, op.zone, e))];
      }
    }
    const zone = this.family.family()?.timeZone ?? 'UTC';
    return events.filter((e) => overlaps(e, state.from, state.to, zone)).sort((a, b) =>
      (a.startDate ?? a.startsAt!).localeCompare(b.startDate ?? b.startsAt!) || a.title.localeCompare(b.title));
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
    const serial = ++this.serial;
    this.active = serial;
    this.fetching.set(true);
    this.readFailed.set(false);
    this.http.get<CalendarResponse>('/api/calendar', { params: { from, to } }).pipe(timeout(15_000)).subscribe({
      next: (response) => {
        if (serial !== this.serial) return;
        // Older servers/test fixtures may omit the counter; production responses always include it.
        const revision = response.changeNumber ?? 0;
        if (revision >= (this.accepted() ?? 0)) {
          this.readFailed.set(false);
          this.accepted.set(revision);
          this.acceptedAt.set(new Date());
          this.knownCalendars.set(response.calendars);
          this.operations.update((ops) => ops.filter((op) => op.status !== 'settling' || serial < op.settleAfter!));
          this.current.set({ status: 'ready', from, to, ...response, changeNumber: revision });
        }
        this.finishRead(serial, revision < this.wanted);
      },
      error: () => {
        if (serial !== this.serial) return;
        this.readFailed.set(true);
        if (!quietly) this.current.set({ status: 'unavailable', from, to });
        // Do not spin on an unavailable server. The connection or recovery timer will retry.
        this.finishRead(serial, false);
      },
    });
  }

  private finishRead(serial: number, behind: boolean): void {
    if (serial !== this.serial) return;
    this.active = null;
    this.fetching.set(false);
    const again = this.queued || behind;
    this.queued = false;
    if (again) this.refresh();
  }
}

function sameContent(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.title === b.title && a.location === b.location && a.calendarId === b.calendarId && a.allDay === b.allDay
    && (a.description ?? null) === (b.description ?? null)
    && (a.allDay ? a.startDate === b.startDate && a.endDate === b.endDate
      : Date.parse(a.startsAt!) === Date.parse(b.startsAt!) && Date.parse(a.endsAt!) === Date.parse(b.endsAt!));
}

/** A change that makes an event that does not repeat yet the first of a series. */
function startsSeries(op: PendingCalendarChange): boolean {
  return op.kind === 'update' && !op.series && !op.original?.recurring && !!op.request && op.request.repeat !== 'Never';
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


