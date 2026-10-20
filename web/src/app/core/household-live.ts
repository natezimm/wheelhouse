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
import { ChoresStore } from './chores';
import { ListsStore } from './lists';
import { MealsStore } from './meals';
import { FamilyStore } from './family';
import { SessionStore } from './session';

export const HOUSEHOLD_EVERY_MS = 30_000;
export const HOUSEHOLD_RETRY_MS = 5_000;

/** A factory keeps connection lifecycle tests independent of browser transport details. */
export const HOUSEHOLD_CONNECTION = new InjectionToken<() => HubConnection>(
  'Household SignalR connection',
  {
    providedIn: 'root',
    factory: () => () =>
      new HubConnectionBuilder()
        .withUrl('/hubs/household')
        .withAutomaticReconnect({ nextRetryDelayInMilliseconds: () => HOUSEHOLD_RETRY_MS })
        .configureLogging(LogLevel.None)
        .build(),
  },
);

export type HouseholdLiveState =
  'connecting' | 'connected' | 'reconnecting' | 'resyncing' | 'stopped';

/** One subscription for all routes; notifications invalidate the visible range, never edit it. */
@Injectable({ providedIn: 'root' })
export class HouseholdLive {
  private readonly household = inject(ChoresStore);
  private readonly lists = inject(ListsStore);
  private readonly meals = inject(MealsStore);
  private readonly family = inject(FamilyStore);
  private readonly session = inject(SessionStore);
  private readonly document = inject(DOCUMENT);
  private readonly createConnection = inject(HOUSEHOLD_CONNECTION);
  private readonly enabled = signal(false);
  private readonly connectionState = signal<HouseholdLiveState>('stopped');
  private connection?: HubConnection;
  private familyId: string | null = null;
  private generation = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private check?: ReturnType<typeof setInterval>;

  readonly state = computed<HouseholdLiveState>(() => {
    const state = this.connectionState();
    return state === 'connected' && (this.household.refreshing() || this.lists.refreshing() || this.meals.refreshing()) ? 'resyncing' : state;
  });

  readonly available = computed(() => this.state() !== 'stopped');
  readonly recovering = this.household.refreshing;

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

  /** Explicit recovery also replaces a dropped subscription, without resetting the household. */
  resync(): void {
    if (!this.familyId) return;
    this.refreshSnapshot();
    if (this.connectionState() !== 'connected') this.useFamily(this.familyId, true);
  }

  private refreshSnapshot(): void {
    if (!this.familyId) return;
    this.household.refresh();
    this.lists.refresh();
    this.meals.refresh();
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
    if (previous && previous !== id) this.household.reset();
    if (previous && previous !== id) this.lists.reset();
    if (previous && previous !== id) this.meals.reset();
    if (!id) {
      this.connectionState.set('stopped');
      return;
    }
    const connection = this.createConnection();
    this.connection = connection;
    const current = () => generation === this.generation;
    connection.on('HouseholdChanged', (message: { domain: string; changeNumber: number }) => {
      if (current() && message?.domain === 'chores') { this.household.changed(message.changeNumber); this.family.refresh(); }
      if (current() && message?.domain === 'lists') this.lists.changed(message.changeNumber);
      if (current() && message?.domain === 'meals') this.meals.changed(message.changeNumber);
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
      // An offline revocation check may have failed; retry it even while SignalR keeps reconnecting.
      if (this.connectionState() === 'reconnecting') this.family.refresh();
    }, HOUSEHOLD_EVERY_MS);
    void connect();
  }

  private later(generation: number, action: () => void): void {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => generation === this.generation && action(), HOUSEHOLD_RETRY_MS);
  }
}


