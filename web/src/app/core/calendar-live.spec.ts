import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CalendarStore } from './calendar';
import {
  CALENDAR_CONNECTION,
  CALENDAR_EVERY_MS,
  CalendarLive,
  LIVE_RETRY_MS,
} from './calendar-live';
import { FamilyStore } from './family';
import { SessionStore } from './session';
import { marlowes } from '../testing/marlowes';

class Connection {
  start = vi.fn(async () => {});
  stop = vi.fn(async () => {});
  changed!: (message: { changeNumber: number }) => void;
  reconnecting!: () => void;
  reconnected!: () => void;
  closed!: () => void;
  on(_name: string, callback: Connection['changed']) {
    this.changed = callback;
  }
  onreconnecting(callback: () => void) {
    this.reconnecting = callback;
  }
  onreconnected(callback: () => void) {
    this.reconnected = callback;
  }
  onclose(callback: () => void) {
    this.closed = callback;
  }
}

describe('CalendarLive', () => {
  let live: CalendarLive;
  let calendar: CalendarStore;
  let family: FamilyStore;
  let http: HttpTestingController;
  let connections: Connection[];
  const snapshot = (changeNumber = 1) => ({
    changeNumber,
    calendars: [],
    events: [],
    needsReconnect: false,
  });
  const read = () => http.expectOne((r) => r.url === '/api/calendar');
  async function settle() {
    TestBed.tick();
    await Promise.resolve();
  }
  async function join(id = marlowes.id) {
    family.load();
    http.expectOne('/api/family').flush({ ...marlowes, id });
    await settle();
  }
  beforeEach(() => {
    vi.useFakeTimers();
    connections = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: CALENDAR_CONNECTION,
          useValue: () => {
            const connection = new Connection();
            connections.push(connection);
            return connection;
          },
        },
      ],
    });
    live = TestBed.inject(CalendarLive);
    calendar = TestBed.inject(CalendarStore);
    family = TestBed.inject(FamilyStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    http.verify();
    vi.useRealTimers();
  });

  it('waits for initialization and an authenticated family, sharing one socket across family reloads', async () => {
    await join();
    expect(connections).toHaveLength(0);
    live.start();
    await settle();
    expect(connections).toHaveLength(1);
    expect(live.state()).toBe('connected');
    await join();
    expect(connections).toHaveLength(1);
  });

  it('does not connect for an unsigned-in family', async () => {
    live.start();
    family.load();
    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();
    expect(connections).toHaveLength(0);
    expect(live.state()).toBe('stopped');
  });

  it('refreshes newer changes, ignores duplicates, and exposes resync progress', async () => {
    live.start();
    await join();
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(1));
    connections[0].changed({ changeNumber: 4 });
    expect(live.state()).toBe('resyncing');
    read().flush(snapshot(4));
    connections[0].changed({ changeNumber: 4 });
    expect(live.state()).toBe('connected');
    http.expectNone((r) => r.url === '/api/calendar');
  });

  it('takes a fresh snapshot on reconnect even when the revision did not advance', async () => {
    live.start();
    await join();
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(1));
    connections[0].reconnecting();
    expect(live.state()).toBe('reconnecting');
    http.expectOne('/api/family').flush(marlowes);
    connections[0].reconnected();
    read().flush(snapshot(1));
    expect(live.state()).toBe('connected');
  });

  it('retries initial failures and cancels retries after access is lost', async () => {
    live.start();
    // Queue a failure without changing the production factory contract.
    const start = vi.spyOn(Connection.prototype, 'on').mockImplementation(function (
      this: Connection,
      _name,
      callback,
    ) {
      this.changed = callback;
      this.start.mockRejectedValueOnce(new Error('Offline'));
    });
    await join();
    start.mockRestore();
    expect(live.state()).toBe('reconnecting');
    http.expectOne('/api/family').flush(marlowes);
    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);
    expect(connections[0].start).toHaveBeenCalledTimes(2);
    expect(live.state()).toBe('connected');
    connections[0].closed();
    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 2);
    expect(live.state()).toBe('stopped');
    expect(connections[0].start).toHaveBeenCalledTimes(2);
  });

  it('keeps the shared connection, snapshot and filters through a transient family-load failure', async () => {
    live.start();
    await join();
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(2));
    calendar.toggle('member');
    family.load();
    http.expectOne('/api/family').flush(null, { status: 503, statusText: 'Offline' });
    await settle();
    expect(connections[0].stop).not.toHaveBeenCalled();
    expect(calendar.changeNumber()).toBe(2);
    expect(calendar.hidden().has('member')).toBe(true);
    await join();
    expect(connections).toHaveLength(1);
  });

  it('stops a previous family socket, clears its snapshot, and ignores its callbacks', async () => {
    live.start();
    await join();
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(100));
    const previous = connections[0];
    await join('another-family');
    expect(previous.stop).toHaveBeenCalled();
    expect(calendar.changeNumber()).toBeNull();
    previous.changed({ changeNumber: 101 });
    previous.reconnecting();
    previous.closed();
    expect(live.state()).toBe('connected');
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(1));
    expect(calendar.changeNumber()).toBe(1);
  });

  it('stops and clears private data after parent sign-out', async () => {
    const session = TestBed.inject(SessionStore);
    const starting = session.start();
    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: true, canSignIn: true });
    await starting;
    live.start();
    await join();
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot());
    session.signOut().subscribe();
    http.expectOne('/api/auth/sign-out').flush(null);
    await settle();
    expect(connections[0].stop).toHaveBeenCalled();
    expect(calendar.state().status).toBe('idle');
  });

  it('recovers every thirty seconds on either layout and when a suspended tab resumes', async () => {
    live.start();
    await join();
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot());
    await vi.advanceTimersByTimeAsync(CALENDAR_EVERY_MS);
    read().flush(snapshot(2));
    document.dispatchEvent(new Event('visibilitychange'));
    read().flush(snapshot(3));
    window.dispatchEvent(new Event('online'));
    read().flush(snapshot(4));
    expect(calendar.changeNumber()).toBe(4);
  });

  it('does not revive a connection that finishes starting after access was removed', async () => {
    let finish!: () => void;
    const hook = vi.spyOn(Connection.prototype, 'on').mockImplementation(function (
      this: Connection,
      _name,
      callback,
    ) {
      this.changed = callback;
      this.start.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
    });
    live.start();
    await join();
    hook.mockRestore();
    family.refresh();
    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();
    finish();
    await settle();
    expect(live.state()).toBe('stopped');
    expect(calendar.state().status).toBe('idle');
    http.expectNone((r) => r.url === '/api/calendar');
  });

  it('cleans up the socket and timers when the app is destroyed', async () => {
    live.start();
    await join();
    TestBed.resetTestingModule();
    expect(connections[0].stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CALENDAR_EVERY_MS * 2);
  });

  it('manually replaces a dropped socket without clearing the calendar or owner filters', async () => {
    live.start();
    await join();
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(4));
    calendar.toggle('member');
    const old = connections[0];
    old.reconnecting();
    http.expectOne('/api/family').flush(marlowes);

    live.resync();
    expect(old.stop).toHaveBeenCalled();
    expect(connections).toHaveLength(2);
    expect(calendar.changeNumber()).toBe(4);
    expect(calendar.hidden().has('member')).toBe(true);
    expect(live.recovering()).toBe(true);
    await settle();
    read().flush(snapshot(5));
    // Connection establishment also asks for a snapshot, covering changes during negotiation.
    read().flush(snapshot(5));
    old.changed({ changeNumber: 100 });
    old.closed();
    expect(calendar.changeNumber()).toBe(5);
    expect(live.state()).toBe('connected');
    expect(live.recovering()).toBe(false);
  });

  it('refreshes a healthy connection without opening another socket', async () => {
    live.start();
    await join();
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot());
    live.resync();
    read().flush(snapshot(2));
    expect(connections).toHaveLength(1);
    expect(calendar.changeNumber()).toBe(2);
  });

  it('ignores explicit resync when access is absent', () => {
    live.resync();
    http.expectNone((r) => r.url === '/api/calendar');
    expect(connections).toHaveLength(0);
  });
});

