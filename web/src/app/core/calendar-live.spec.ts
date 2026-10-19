import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CalendarHubFake } from '../testing/calendar-hub';
import { marlowes } from '../testing/marlowes';
import { CalendarStore } from './calendar';
import { CALENDAR_HUB, CalendarLive } from './calendar-live';
import { Family, FamilyStore } from './family';

describe('CalendarLive', () => {
  let hub: CalendarHubFake;
  let hubs: CalendarHubFake[];
  let family: ReturnType<typeof signal<Family | null>>;
  let load: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let forget: ReturnType<typeof vi.fn>;
  let store: CalendarStore;
  let http: HttpTestingController;
  const snapshot = (changeNumber: number) => ({
    changeNumber,
    calendars: [],
    events: [],
    needsReconnect: false,
  });
  const read = () => http.expectOne((r) => r.url === '/api/calendar');
  const settle = async () => {
    TestBed.tick();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hubs = [];
    family = signal<Family | null>(null);
    load = vi.fn();
    forget = vi.fn();
    refresh = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FamilyStore, useValue: { family, load, refresh, forget } },
        {
          provide: CALENDAR_HUB,
          useValue: () => {
            hub = new CalendarHubFake();
            hubs.push(hub);
            return hub;
          },
        },
      ],
    });
    store = TestBed.inject(CalendarStore);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(CalendarLive);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  async function connect() {
    family.set(marlowes);
    await settle();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(1));
  }

  it('waits for a family, uses one connection through family refreshes and stops on destruction', async () => {
    await settle();
    expect(hubs).toHaveLength(0);
    await connect();
    family.set({ ...marlowes, name: 'Changed' });
    await settle();
    expect(hubs).toHaveLength(1);
    expect(store.connection()).toBe('live');
    TestBed.resetTestingModule();
    expect(hub.stop).toHaveBeenCalledOnce();
    hub.notify(2);
    expect(store.state().status).toBe('ready');
  });

  it('recovers changes missed while disconnected from the reconnect revision, without polling a healthy hub', async () => {
    await connect();
    vi.advanceTimersByTime(30_000);
    http.expectNone((r) => r.url === '/api/calendar');
    hub.reconnecting?.();
    expect(store.connection()).toBe('reconnecting');
    hub.reconnected?.();
    hub.notify(8);
    read().flush(snapshot(8));
    expect(store.connection()).toBe('live');
    expect(store.state()).toMatchObject({ changeNumber: 8 });
    hub.notify(8);
    http.expectNone((r) => r.url === '/api/calendar');
  });

  it('retries an initial failure and a terminal disconnect, and polls while disconnected', async () => {
    // Start failure must be retried separately from SignalR automatic reconnect.
    TestBed.resetTestingModule();
    const failed = new CalendarHubFake();
    failed.start.mockRejectedValueOnce(new Error('offline'));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FamilyStore, useValue: { family, load, refresh, forget } },
        { provide: CALENDAR_HUB, useValue: () => failed },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(CalendarStore);
    TestBed.inject(CalendarLive);
    await connect();
    expect(store.connection()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(failed.start).toHaveBeenCalledTimes(2);
    expect(store.connection()).toBe('live');
    failed.closed?.();
    expect(refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(failed.start).toHaveBeenCalledTimes(3);
    failed.reconnecting?.();
    vi.advanceTimersByTime(20_000);
    read().flush(snapshot(2));
  });

  it('clears the previous family and ignores its late callbacks when pairing changes identity', async () => {
    await connect();
    const old = hub;
    family.set({ ...marlowes, id: 'another-family' });
    await settle();
    expect(old.stop).toHaveBeenCalledOnce();
    expect(store.state()).toEqual({ status: 'idle' });
    old.notify(999);
    old.closed?.();
    expect(refresh).not.toHaveBeenCalled();
    store.show('2026-10-12', '2026-10-19');
    read().flush(snapshot(1));
    expect(store.state()).toMatchObject({ changeNumber: 1 });
  });

  it('stops retrying and clears data as soon as family access ends', async () => {
    await connect();
    hub.closed?.();
    family.set(null);
    await settle();
    expect(store.state()).toEqual({ status: 'idle' });
    expect(store.connection()).toBe('idle');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hub.start).toHaveBeenCalledOnce();
  });

  it('rechecks access after an unauthorized start and clears cached events', async () => {
    await connect();
    hub.start.mockRejectedValueOnce({ statusCode: 401 });
    hub.closed?.();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).toHaveBeenCalledOnce();
    expect(store.state()).toEqual({ status: 'idle' });
  });
});
