import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChoresStore } from './chores';
import { ListsStore } from './lists';
import { MealsStore } from './meals';
import { FamilyStore } from './family';
import { SessionStore } from './session';
import { HOUSEHOLD_CONNECTION, HOUSEHOLD_EVERY_MS, HOUSEHOLD_RETRY_MS, HouseholdLive } from './household-live';
import { marlowes } from '../testing/marlowes';

class Connection {
  start = vi.fn(async () => {}); stop = vi.fn(async () => {});
  changed!: (message: { domain: string; changeNumber: number }) => void;
  reconnecting!: () => void; reconnected!: () => void; closed!: () => void;
  on(_name: string, callback: Connection['changed']) { this.changed = callback; }
  onreconnecting(callback: () => void) { this.reconnecting = callback; }
  onreconnected(callback: () => void) { this.reconnected = callback; }
  onclose(callback: () => void) { this.closed = callback; }
}

describe('HouseholdLive', () => {
  let live: HouseholdLive; let family: FamilyStore; let http: HttpTestingController; let connections: Connection[];
  let chores: { refreshing: ReturnType<typeof signal<boolean>>; refresh: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn>; changed: ReturnType<typeof vi.fn> };
  let lists: typeof chores;
  let meals: typeof chores;
  async function settle() { TestBed.tick(); await Promise.resolve(); }
  async function join(id = marlowes.id) { family.load(); http.expectOne('/api/family').flush({ ...marlowes, id }); await settle(); }
  beforeEach(() => {
    vi.useFakeTimers(); connections = [];
    chores = { refreshing: signal(false), refresh: vi.fn(), reset: vi.fn(), changed: vi.fn() };
    lists = { refreshing: signal(false), refresh: vi.fn(), reset: vi.fn(), changed: vi.fn() };
    meals = { refreshing: signal(false), refresh: vi.fn(), reset: vi.fn(), changed: vi.fn() };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: ChoresStore, useValue: chores }, { provide: ListsStore, useValue: lists }, { provide: MealsStore, useValue: meals }, { provide: HOUSEHOLD_CONNECTION, useValue: () => {
        const connection = new Connection(); connections.push(connection); return connection;
      } },
    ] });
    live = TestBed.inject(HouseholdLive); family = TestBed.inject(FamilyStore); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { TestBed.resetTestingModule(); http.verify(); vi.useRealTimers(); });

  it('waits for initialization and shares one subscription across routes and family refreshes', async () => {
    await join(); expect(connections).toHaveLength(0); live.start(); await settle();
    await join(); expect(connections).toHaveLength(1); expect(live.state()).toBe('connected');
    connections[0].changed({ domain: 'meals', changeNumber: 1 }); expect(chores.changed).not.toHaveBeenCalled();
    expect(meals.changed).toHaveBeenCalledWith(1);
    connections[0].changed({ domain: 'chores', changeNumber: 2 });
    expect(chores.changed).toHaveBeenCalledWith(2); http.expectOne('/api/family').flush(marlowes);
    connections[0].changed({ domain:'lists', changeNumber:7 }); expect(lists.changed).toHaveBeenCalledWith(7);
  });

  it('refreshes after reconnect, every thirty seconds and on visible online recovery', async () => {
    live.start(); await join(); chores.refresh.mockClear();
    connections[0].reconnecting(); http.expectOne('/api/family').flush(marlowes);
    expect(live.state()).toBe('reconnecting'); connections[0].reconnected();
    await vi.advanceTimersByTimeAsync(HOUSEHOLD_EVERY_MS);
    window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'));
    expect(chores.refresh).toHaveBeenCalledTimes(4);
    expect(meals.refresh).toHaveBeenCalledTimes(5);
  });

  it('replaces a dropped socket without clearing drafts or chores and ignores old callbacks', async () => {
    live.start(); await join(); const old = connections[0];
    old.closed(); http.expectOne('/api/family').flush(marlowes); live.resync(); await settle();
    expect(old.stop).toHaveBeenCalled(); expect(connections).toHaveLength(2); expect(chores.reset).not.toHaveBeenCalled();
    old.changed({ domain: 'chores', changeNumber: 100 }); old.closed();
    expect(chores.changed).not.toHaveBeenCalled(); expect(live.state()).toBe('connected');
  });

  it('clears a former family and ignores its late notifications', async () => {
    live.start(); await join(); const old = connections[0]; await join('other-family');
    expect(chores.reset).toHaveBeenCalledTimes(1); expect(old.stop).toHaveBeenCalled();
    expect(lists.reset).toHaveBeenCalledTimes(1);
    expect(meals.reset).toHaveBeenCalledTimes(1);
    old.changed({ domain: 'chores', changeNumber: 100 }); expect(chores.changed).not.toHaveBeenCalled();
  });

  it('retries failed starts and stops after a revoked cookie', async () => {
    const hook = vi.spyOn(Connection.prototype, 'on').mockImplementation(function(this: Connection, _name, callback) {
      this.changed = callback; this.start.mockRejectedValueOnce(new Error('Offline'));
    });
    live.start(); await join(); hook.mockRestore(); http.expectOne('/api/family').flush(marlowes);
    await vi.advanceTimersByTimeAsync(HOUSEHOLD_RETRY_MS); expect(live.state()).toBe('connected');
    connections[0].closed(); http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' }); await settle();
    expect(live.state()).toBe('stopped'); expect(chores.reset).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HOUSEHOLD_RETRY_MS * 2); expect(connections[0].start).toHaveBeenCalledTimes(2);
  });

  it('stops household subscriptions and clears data after parent sign-out', async () => {
    const session = TestBed.inject(SessionStore); const starting = session.start();
    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: true, canSignIn: true }); await starting;
    live.start(); await join(); session.signOut().subscribe(); http.expectOne('/api/auth/sign-out').flush(null); await settle();
    expect(connections[0].stop).toHaveBeenCalled(); expect(chores.reset).toHaveBeenCalled();
  });
});
