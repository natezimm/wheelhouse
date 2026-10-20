import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { Family } from './core/family';
import { Weather } from './core/weather';
import { marloweCalendars } from './testing/calendar';
import { marlowes } from './testing/marlowes';

/** Today's weather on the wall and the phone, and where a parent sets it. */
describe('weather', () => {
  let http: HttpTestingController;

  const newYork: Family = { ...marlowes, latitude: 40.71, longitude: -74.01 };
  const partlyCloudy: Weather = { temperature: 61, description: 'Partly cloudy', icon: 'PartlyCloudy', high: 66, low: 48, unit: 'F' };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T21:22:00Z'));
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    // The status line checks the server's health; nothing here is about it.
    http.match('/health');
    http.match(r => r.url === '/api/chores').forEach(r => r.flush({ changeNumber: 0, chores: [], canManage: true }));
    http.match(r => r.url === '/api/meals').forEach(r => r.flush(null, { status:503, statusText:'Not relevant to weather' }));
    http.verify();
  });

  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();

  /** Opens a screen and answers for the family and, when asked, the calendar and the devices. */
  async function open(url: string, family: Family) {
    const harness = await RouterTestingHarness.create(url);
    http.expectOne('/api/family').flush(family);
    await harness.fixture.whenStable();
    http.match((r) => r.url === '/api/calendar').forEach((r) => r.flush({ calendars: marloweCalendars, events: [] }));
    http.match('/api/devices').forEach((r) => r.flush([]));
    http.match('/api/calendar/google').forEach((r) => r.flush({ canConnect: false, email: null, status: null }));
    return { page: harness.routeNativeElement as HTMLElement, settle: () => harness.fixture.whenStable() };
  }

  it('shows the temperature, the sky and the day’s range at the right of the wall’s header', async () => {
    const { page, settle } = await open('/wall', newYork);

    http.expectOne('/api/weather').flush(partlyCloudy);
    await settle();

    const header = page.querySelector('header app-wall-weather');
    expect(text(header?.querySelector('.temperature') ?? null)).toBe('61°');
    expect(text(header?.querySelector('.summary') ?? null)).toBe('Partly cloudy · H 66° L 48°');
    expect(header?.querySelector('app-weather-icon svg')).not.toBeNull();
  });

  it('adds the weather to the date on the phone’s Today', async () => {
    const { page, settle } = await open('/', newYork);

    http.expectOne('/api/weather').flush(partlyCloudy);
    await settle();

    expect(text(page.querySelector('.date'))).toBe('Mon, Oct 12 · 61° partly cloudy');
  });

  it('leaves the weather out until a parent says where the family lives', async () => {
    const { page, settle } = await open('/', marlowes);
    await settle();

    http.expectNone('/api/weather');
    expect(text(page.querySelector('.date'))).toBe('Mon, Oct 12');
  });

  it('leaves the weather out while the forecast cannot be reached', async () => {
    const { page, settle } = await open('/wall', newYork);

    http.expectOne('/api/weather').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(text(page.querySelector('app-wall-weather'))).toBe('');
  });

  describe('in Settings', () => {
    const button = (page: HTMLElement, label: string) =>
      Array.from(page.querySelectorAll<HTMLButtonElement>('section[aria-labelledby=weather-heading] button')).find(
        (b) => text(b) === label,
      )!;
    const section = (page: HTMLElement) => page.querySelector('section[aria-labelledby=weather-heading]');

    function locateAt(latitude: number, longitude: number) {
      const getCurrentPosition = vi.fn((found: PositionCallback) =>
        found({ coords: { latitude, longitude } } as GeolocationPosition),
      );
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
      return getCurrentPosition;
    }

    function refuseLocation() {
      const getCurrentPosition = vi.fn((_: PositionCallback, failed: PositionErrorCallback) =>
        failed({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
      );
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    }

    it('sets the place from this phone, once the server accepts it', async () => {
      locateAt(47.606209, -122.332069);
      const { page, settle } = await open('/settings', marlowes);
      await settle();
      expect(text(section(page)?.querySelector('.place') ?? null)).toContain('Set where you live');

      button(page, "Use this phone's location").click();
      const request = http.expectOne({ method: 'PUT', url: '/api/family/location' });
      expect(request.request.body).toEqual({ latitude: 47.606209, longitude: -122.332069 });
      request.flush({ ...marlowes, latitude: 47.61, longitude: -122.33 });
      await settle();

      expect(text(section(page)?.querySelector('.place') ?? null)).toBe('Weather is for 47.61° N, 122.33° W.');
      expect(text(section(page)?.querySelector('[role=status]') ?? null)).toBe('Saved');
    });

    it('says how to allow the location when the browser blocks it', async () => {
      refuseLocation();
      const { page, settle } = await open('/settings', marlowes);
      await settle();

      button(page, "Use this phone's location").click();
      await settle();

      http.expectNone('/api/family/location');
      expect(text(section(page)?.querySelector('[role=status]') ?? null)).toContain('Location is blocked for this site');
    });

    it('stops showing the weather by clearing the place', async () => {
      const { page, settle } = await open('/settings', newYork);
      await settle();

      button(page, 'Stop showing the weather').click();
      const request = http.expectOne({ method: 'PUT', url: '/api/family/location' });
      expect(request.request.body).toEqual({ latitude: null, longitude: null });
      request.flush(marlowes);
      await settle();

      expect(button(page, 'Stop showing the weather')).toBeUndefined();
      expect(text(section(page)?.querySelector('[role=status]') ?? null)).toBe('The weather is off');
    });
  });
});
