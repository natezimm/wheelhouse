import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { CalendarStore } from './calendar';
import { FamilyStore } from './family';
import { SessionStore } from './session';

export const CALENDAR_EVERY_MS = 30_000;
export const LIVE_RETRY_MS = 5_000;

/** A factory keeps connection lifecycle tests independent of browser transport details. */
export const CALENDAR_CONNECTION = new InjectionToken<() => HubConnection>(
  'Calendar SignalR connection',
  {
    providedIn: 'root',
    factory: () => () =>
      new HubConnectionBuilder()
        .withUrl('/hubs/calendar')
        .withAutomaticReconnect({ nextRetryDelayInMilliseconds: () => LIVE_RETRY_MS })
        .configureLogging(LogLevel.None)
        .build(),
  },
);

export type CalendarLiveState =
  'connecting' | 'connected' | 'reconnecting' | 'resyncing' | 'stopped';

/** One subscription for all routes; notifications invalidate the visible range, never edit it. */
@Injectable({ providedIn: 'root' })
export class CalendarLive {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly session = inject(SessionStore);
  private readonly document = inject(DOCUMENT);
  private readonly createConnection = inject(CALENDAR_CONNECTION);
  private readonly enabled = signal(false);
  private readonly connectionState = signal<CalendarLiveState>('stopped');
  private connection?: HubConnection;
  private familyId: string | null = null;
  private generation = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private check?: ReturnType<typeof setInterval>;

  readonly state = computed<CalendarLiveState>(() => {
    const state = this.connectionState();
    return state === 'connected' && this.calendar.refreshing() ? 'resyncing' : state;
  });

  readonly available = computed(() => this.state() !== 'stopped');
  readonly recovering = this.calendar.refreshing;

  constructor() {
    effect(() => {
      const family = this.family.family();
      const denied = this.family.state().status === 'private' || this.session.canSignIn();
      const id = this.enabled() && !denied ? (family?.id ?? this.familyId) : null;
      untracked(() => this.useFamily(id));
    });
    const resume = () => {
      if (this.document.visibilityState === 'hidden' || !this.familyId) return;
      this.resync();
    };
    this.document.addEventListener('visibilitychange', resume);
    this.document.defaultView?.addEventListener('online', resume);
    inject(DestroyRef).onDestroy(() => {
      this.useFamily(null);
      this.document.removeEventListener('visibilitychange', resume);
      this.document.defaultView?.removeEventListener('online', resume);
    });
  }

  /** Called after session/demo initialization, without delaying the first screen on a socket. */
  start(): void {
    this.enabled.set(true);
  }

  /** Explicit recovery also replaces a dropped subscription, without resetting the calendar. */
  resync(): void {
    if (!this.familyId) return;
    this.refreshSnapshot();
    if (this.connectionState() !== 'connected') this.useFamily(this.familyId, true);
  }

  private refreshSnapshot(): void {
    if (!this.familyId) return;
    this.calendar.refresh();
  }

  private useFamily(id: string | null, restart = false): void {
    if (id === this.familyId && !restart) return;
    const previous = this.familyId;
    this.familyId = id;
    const generation = ++this.generation;
    clearTimeout(this.retry);
    clearInterval(this.check);
    const old = this.connection;
    this.connection = undefined;
    if (old) void old.stop().catch(() => {});
    if (previous && previous !== id) this.calendar.reset();
    if (!id) {
      this.connectionState.set('stopped');
      return;
    }
    const connection = this.createConnection();
    this.connection = connection;
    const current = () => generation === this.generation;
    connection.on('CalendarChanged', (message: { changeNumber: number }) => {
      if (current() && message) this.calendar.changed(message.changeNumber);
    });
    connection.onreconnecting(() => {
      if (!current()) return;
      this.connectionState.set('reconnecting');
      this.family.refresh();
    });
    connection.onreconnected(() => {
      if (!current()) return;
      this.connectionState.set('connected');
      this.refreshSnapshot();
    });
    connection.onclose(() => {
      if (!current()) return;
      this.connectionState.set('reconnecting');
      // Revoked cookies need a regular HTTP check; a socket cannot update the family store.
      this.family.refresh();
      this.later(generation, () => void connect());
    });
    const connect = async () => {
      if (!current()) return;
      try {
        await connection.start();
        if (!current()) {
          await connection.stop();
          return;
        }
        this.connectionState.set('connected');
        this.refreshSnapshot();
      } catch {
        if (!current()) return;
        this.connectionState.set('reconnecting');
        this.family.refresh();
        this.later(generation, () => void connect());
      }
    };
    this.connectionState.set(restart ? 'reconnecting' : 'connecting');
    this.check = setInterval(() => {
      this.refreshSnapshot();
      // The family itself has no live notification: this picks up a theme, a name or a member
      // changed on another device, and retries an offline revocation check while SignalR reconnects.
      this.family.refresh();
    }, CALENDAR_EVERY_MS);
    void connect();
  }

  private later(generation: number, action: () => void): void {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => generation === this.generation && action(), LIVE_RETRY_MS);
  }
}

