import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CalendarStore } from '../core/calendar';
import { CalendarLive, CalendarLiveState } from '../core/calendar-live';
import { SessionStore } from '../core/session';
import { allDay, marloweCalendars } from '../testing/calendar';
import { CalendarConnection } from './calendar-connection';

describe('calendar connection controls', () => {
  let fixture: ComponentFixture<CalendarConnection>;
  let calendar: CalendarStore;
  let http: HttpTestingController;
  const state = signal<CalendarLiveState>('connected');
  const resync = vi.fn(() => calendar.refresh());
  const event = allDay('Family dinner', null, '2026-10-12', '2026-10-13');
  const snapshot = (needsReconnect = false) => ({
    calendars: marloweCalendars,
    events: [event],
    needsReconnect,
    changeNumber: 1,
  });
  const read = () => http.expectOne((r) => r.url === '/api/calendar');
  const page = () => fixture.nativeElement as HTMLElement;
  const button = () => page().querySelector<HTMLButtonElement>('button')!;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(() => {
    state.set('connected');
    resync.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: CalendarLive,
          useValue: {
            state,
            available: computed(() => state() !== 'stopped'),
            recovering: computed(() => calendar?.refreshing() ?? false),
            resync,
          },
        },
      ],
    });
    calendar = TestBed.inject(CalendarStore);
    http = TestBed.inject(HttpTestingController);
    calendar.show('2026-10-12', '2026-10-19');
    read().flush(snapshot());
    fixture = TestBed.createComponent(CalendarConnection);
  });
  afterEach(() => http.verify());

  it('distinguishes the live connection from snapshot progress and exposes a disabled busy action', async () => {
    await settle();
    expect(page().querySelector('[role=status]')?.textContent).toContain('Live');
    button().click();
    await settle();
    expect(resync).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-label')).toBe('Resyncing…');
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(page().querySelector('[role=status]')?.textContent).toContain('Refreshing');
    read().flush(snapshot());
    await settle();
    expect(button().disabled).toBe(false);
    expect(button().getAttribute('aria-label')).toBe('Resync now');
  });

  it('says Connecting quietly the first time, with no pill or button, and nothing in the phone banners', async () => {
    state.set('connecting');
    await settle();
    expect(page().querySelector('[role=status]')?.textContent?.trim()).toBe('Connecting…');
    expect(page().querySelector('.pill')).toBeNull();
    expect(page().querySelector('button')).toBeNull();

    fixture.componentRef.setInput('show', 'problems');
    await settle();
    expect(page().textContent?.trim()).toBe('');
  });

  it('shows Reconnecting immediately and retains the accepted calendar', async () => {
    state.set('reconnecting');
    await settle();
    expect(page().querySelector('.pill')?.textContent).toContain('Reconnecting');
    expect(button().textContent?.trim()).toBe('Resync now');
    expect(calendar.events()).toEqual([event]);
    expect(button().disabled).toBe(false);
  });

  it('offers a clear retry after a failed quiet refresh and clears the error on recovery', async () => {
    await settle();
    button().click();
    read().flush(null, { status: 503, statusText: 'Offline' });
    await settle();
    expect(page().querySelector('[role=alert]')?.textContent).toContain("Couldn't refresh");
    expect(button().textContent?.trim()).toBe('Try again');
    expect(button().disabled).toBe(false);
    expect(calendar.events()).toEqual([event]);
    button().click();
    read().flush(snapshot());
    await settle();
    expect(page().querySelector('[role=alert]')).toBeNull();
  });

  it('keeps the Google reconnect notice separate from live connection recovery', async () => {
    const start = TestBed.inject(SessionStore).start();
    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: true, canSignIn: true });
    await start;
    calendar.refresh();
    read().flush(snapshot(true));
    await settle();
    expect(page().querySelector('[role=status]')?.textContent).toContain('Live');
    expect(page().querySelector('.reconnect')?.textContent).toContain('Google Calendar needs reconnecting');
    expect(page().querySelector('a')?.getAttribute('href')).toBe('/settings/calendars');
    button().click();
    read().flush(snapshot(true));
    await settle();
    expect(page().querySelector('.reconnect')).not.toBeNull();
    http.expectNone((r) => r.url.includes('/google'));
  });

  it('hides recovery controls when there is no authenticated subscription', async () => {
    state.set('stopped');
    await settle();
    expect(page().querySelector('button')).toBeNull();
    // The server-health line takes its place until there is a subscription.
    http.expectOne('/health').flush({ status: 'Healthy', checks: {} });
    await settle();
    expect(page().querySelector('app-status-line')?.textContent).toContain('Server connected');
  });
});
