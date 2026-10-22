import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { CalendarChoice, GoogleConnection } from './core/google';
import { marlowes } from './testing/marlowes';

/** Connecting the family's Google account and choosing its calendars, on the phone. */
describe('Google Calendar on the phone', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match('/health');
    http.verify();
  });

  const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim();
  const section = (page: HTMLElement) => page.querySelector('section[aria-labelledby=calendars-heading]')!;
  const button = (page: HTMLElement, label: string) =>
    Array.from(section(page).querySelectorAll<HTMLButtonElement>('button')).find((b) => text(b) === label);

  /** Opens Settings with the family loaded and Google's connection as given. */
  async function settings(connection: GoogleConnection, url = '/settings') {
    const harness = await RouterTestingHarness.create(url);
    http.expectOne('/api/family').flush(marlowes);
    http.expectOne('/api/devices').flush([]);
    http.expectOne('/api/calendar/google').flush(connection);
    await harness.fixture.whenStable();
    return { page: harness.routeNativeElement as HTMLElement, settle: () => harness.fixture.whenStable() };
  }

  describe('in Settings', () => {
    it('offers to connect the shared account on a family instance with none', async () => {
      const { page } = await settings({ canConnect: true, email: null, status: null });

      const link = section(page).querySelector<HTMLAnchorElement>('a.button');
      expect(text(link)).toBe('Connect Google Calendar');
      expect(link?.getAttribute('href')).toBe('/api/calendar/google/connect');
    });

    it('names the connected account, with a way to choose calendars', async () => {
      const { page } = await settings({ canConnect: true, email: 'family.calendars@example.com', status: 'Connected' });

      expect(text(section(page).querySelector('.place'))).toBe('Connected to family.calendars@example.com.');
      expect(section(page).querySelector('a[href="/settings/calendars"]')).not.toBeNull();
      expect(section(page).querySelector('.warning')).toBeNull();
    });

    it('asks a parent to connect again when Google stopped accepting the connection', async () => {
      const { page } = await settings({ canConnect: true, email: 'family.calendars@example.com', status: 'NeedsReauth' });

      expect(text(section(page).querySelector('.warning'))).toContain('Google stopped accepting the connection');
      expect(text(section(page).querySelector('a[href="/api/calendar/google/connect"]'))).toBe('Connect again');
    });

    it('disconnects only after a second, explicit tap', async () => {
      const { page, settle } = await settings({ canConnect: true, email: 'family.calendars@example.com', status: 'Connected' });

      button(page, 'Disconnect Google')!.click();
      await settle();
      http.expectNone({ method: 'DELETE', url: '/api/calendar/google' });
      button(page, 'Disconnect')!.click();
      http.expectOne({ method: 'DELETE', url: '/api/calendar/google' }).flush(null, { status: 204, statusText: 'No Content' });
      await settle();

      expect(text(section(page).querySelector('a.button'))).toBe('Connect Google Calendar');
    });

    it('says why connecting did not finish', async () => {
      const { page } = await settings({ canConnect: true, email: null, status: null }, '/settings?google=no-calendar');

      expect(text(section(page).querySelector('[role=alert]'))).toContain('without calendar access');
    });

    it('explains that the demo has no Google account but its calendars can still be assigned', async () => {
      const { page } = await settings({ canConnect: false, email: null, status: null });

      expect(text(section(page).querySelector('.place'))).toContain("The demo's calendars are made up");
      expect(section(page).querySelector('a[href="/api/calendar/google/connect"]')).toBeNull();
      expect(section(page).querySelector('a[href="/settings/calendars"]')).not.toBeNull();
    });
  });

  describe('choosing calendars', () => {
    const choices: CalendarChoice[] = [
      { googleCalendarId: 'primary', name: 'Shared account', color: '#9fc6e7', shown: false, memberId: null },
      { googleCalendarId: 'ben-cal', name: 'Ben', color: '#f83a22', shown: true, memberId: 'm1' },
      { googleCalendarId: 'family-cal', name: 'Family', color: '#4986e7', shown: true, memberId: null },
    ];

    async function picker() {
      const harness = await RouterTestingHarness.create('/settings/calendars');
      http.expectOne('/api/family').flush(marlowes);
      http.expectOne('/api/calendar/sources').flush({ calendars: choices });
      await harness.fixture.whenStable();
      return { page: harness.routeNativeElement as HTMLElement, settle: () => harness.fixture.whenStable(), harness };
    }

    const row = (page: HTMLElement, name: string) =>
      Array.from(page.querySelectorAll('.rows li')).find((li) => text(li.querySelector('.name')) === name)!;

    it("lists the account's calendars, with whose each shown one is", async () => {
      const { page } = await picker();

      expect(Array.from(page.querySelectorAll('.rows .name'), (n) => text(n))).toEqual(['Shared account', 'Ben', 'Family']);
      expect(row(page, 'Shared account').querySelector('select')).toBeNull();
      expect(row(page, 'Ben').querySelector('select')!.value).toBe('m1');
      expect(row(page, 'Family').querySelector('select')!.value).toBe('');
    });

    it('saves the ticked calendars and whose they are, then shows the calendar', async () => {
      const { page, settle, harness } = await picker();

      const tick = row(page, 'Shared account').querySelector<HTMLInputElement>('input[type=checkbox]')!;
      tick.checked = true;
      tick.dispatchEvent(new Event('change'));
      await settle();
      const whose = row(page, 'Shared account').querySelector('select')!;
      whose.value = 'm2';
      whose.dispatchEvent(new Event('change'));
      const untick = row(page, 'Family').querySelector<HTMLInputElement>('input[type=checkbox]')!;
      untick.checked = false;
      untick.dispatchEvent(new Event('change'));
      await settle();
      page.querySelector<HTMLButtonElement>('button.primary')!.click();

      const request = http.expectOne({ method: 'PUT', url: '/api/calendar/sources' });
      expect(request.request.body).toEqual({
        calendars: [
          { googleCalendarId: 'primary', memberId: 'm2' },
          { googleCalendarId: 'ben-cal', memberId: 'm1' },
        ],
      });
      request.flush({ calendars: choices });
      await settle();
      // The calendar screen loads the family and its days.
      http.match('/api/family');
      http.match((r) => r.url === '/api/calendar');

      expect(harness.routeNativeElement?.tagName.toLowerCase()).toBe('app-calendar-home');
    });

    it('stays put and says why when the server refuses', async () => {
      const { page, settle } = await picker();

      page.querySelector<HTMLButtonElement>('button.primary')!.click();
      http
        .expectOne({ method: 'PUT', url: '/api/calendar/sources' })
        .flush({ errors: { memberId: ['Choose someone in the family.'] } }, { status: 400, statusText: 'Bad Request' });
      await settle();

      expect(text(page.querySelector('[role=alert]'))).toBe('Choose someone in the family.');
    });

    it('sends a parent back to Settings when Google stopped accepting the connection', async () => {
      const harness = await RouterTestingHarness.create('/settings/calendars');
      http.expectOne('/api/family').flush(marlowes);
      http.expectOne('/api/calendar/sources').flush(null, { status: 409, statusText: 'Conflict' });
      await harness.fixture.whenStable();

      expect(text((harness.routeNativeElement as HTMLElement).querySelector('.notice'))).toBe(
        'Google stopped accepting the connection. Connect again in Settings.',
      );
    });
  });

  it('explains what happens to Google data, to anyone, signed in or not', async () => {
    const harness = await RouterTestingHarness.create('/privacy');

    const page = harness.routeNativeElement as HTMLElement;
    expect(text(page.querySelector('h1'))).toBe('Privacy');
    expect(text(page)).toContain('Limited Use requirements');
  });
});
