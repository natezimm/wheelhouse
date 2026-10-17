import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { CalendarEvent } from './core/calendar';
import { marloweCalendars, timed } from './testing/calendar';
import { marlowes } from './testing/marlowes';

/** Adding, changing and deleting events, with the clock at 5:22 PM on Monday, October 12, 2026 in New York. */
describe('event screens', () => {
  let http: HttpTestingController;

  const swim = timed('Swim lesson', 'm3', '2026-10-12T21:30:00Z', '2026-10-12T22:15:00Z', 'Riverside Rec Center');
  const events: CalendarEvent[] = [swim];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T21:22:00Z'));
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.useRealTimers());

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    http.expectOne('/api/family').flush(marlowes);
    await harness.fixture.whenStable();
    http.expectOne((r) => r.url === '/api/calendar').flush({ calendars: marloweCalendars, events });
    await harness.fixture.whenStable();
    return { page: harness.routeNativeElement as HTMLElement, settle: () => harness.fixture.whenStable() };
  }

  const button = (root: HTMLElement, label: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.getAttribute('aria-label') === label || b.textContent?.replace(/\s+/g, ' ').trim() === label,
    )!;

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  describe('on the wall', () => {
    it('adds an event from the steppers and chips, and shows it once the server has it', async () => {
      const { page, settle } = await open('/wall');

      button(page, 'Add event').click();
      await settle();
      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      expect(dialog.querySelector('h1')?.textContent).toBe('New event');
      expect(document.activeElement).toBe(dialog.querySelector('#event-title'));
      type(dialog.querySelector('#event-title')!, 'Parent & tot swim');
      button(dialog, 'Start later').click();
      button(dialog, 'Start later').click();
      button(dialog, 'A day later').click();
      Array.from(dialog.querySelectorAll<HTMLButtonElement>('.chip')).find((chip) => chip.textContent?.trim().endsWith('Milo'))!.click();
      await settle();
      expect(Array.from(dialog.querySelectorAll('.stepper > span'), (s) => s.textContent?.trim())).toEqual([
        'Tue, Oct 13',
        '6:30 PM',
        '7:30 PM',
      ]);
      button(dialog, 'Save event').click();

      const request = http.expectOne({ method: 'POST', url: '/api/calendar/events' });
      expect(request.request.body).toEqual({
        calendarId: 'c3',
        title: 'Parent & tot swim',
        location: null,
        allDay: false,
        startDate: '2026-10-13',
        startTime: '18:30:00',
        endDate: '2026-10-13',
        endTime: '19:30:00',
      });
      request.flush(timed('Parent & tot swim', 'm3', '2026-10-13T22:30:00Z', '2026-10-13T23:30:00Z'));
      http.expectOne((r) => r.url === '/api/calendar');
      await settle();

      expect(page.querySelector('app-event-dialog')).toBeNull();
      const tuesday = page.querySelectorAll('section[aria-label="Tuesday, October 13"] li .title');
      expect(Array.from(tuesday, (t) => t.textContent)).toEqual(['Parent & tot swim']);
    });

    it('shows Google’s version when the event changed there first', async () => {
      const { page, settle } = await open('/wall');

      page.querySelector<HTMLButtonElement>('section[aria-label="Monday, October 12"] li > button')!.click();
      await settle();
      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      expect(dialog.querySelector('h1')?.textContent).toBe('Edit event');
      type(dialog.querySelector('#event-title')!, 'Swim lesson (cancelled)');
      button(dialog, 'Save changes').click();

      const request = http.expectOne({ method: 'PUT', url: `/api/calendar/events/${swim.id}` });
      expect(request.request.body).toMatchObject({ title: 'Swim lesson (cancelled)', startTime: '17:30:00', endTime: '18:15:00' });
      request.flush({ ...swim, title: 'Swim lesson, indoor pool' }, { status: 409, statusText: 'Conflict' });
      http.expectOne((r) => r.url === '/api/calendar');
      await settle();

      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('changed this event in Google Calendar first');
      expect(dialog.querySelector<HTMLInputElement>('#event-title')!.value).toBe('Swim lesson, indoor pool');
    });

    it('deletes an event only once it is confirmed', async () => {
      const { page, settle } = await open('/wall');

      page.querySelector<HTMLButtonElement>('section[aria-label="Monday, October 12"] li > button')!.click();
      await settle();
      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      button(dialog, 'Delete').click();
      await settle();
      http.expectNone({ method: 'DELETE' });
      button(dialog, 'Delete event').click();
      http.expectOne({ method: 'DELETE', url: `/api/calendar/events/${swim.id}` }).flush(null, { status: 204, statusText: 'No Content' });
      await settle();

      expect(page.querySelector('app-event-dialog')).toBeNull();
      expect(page.querySelectorAll('section[aria-label="Monday, October 12"] li').length).toBe(0);
    });
  });

  describe('on the phone', () => {
    it('adds an event on the day chosen in the month', async () => {
      const { page, settle } = await open('/calendar');

      page.querySelector<HTMLButtonElement>('.grid button[aria-label="Thursday, October 15"]')!.click();
      await settle();
      button(page, 'Add event').click();
      await settle();
      const sheet = page.querySelector<HTMLElement>('app-event-sheet form')!;
      type(sheet.querySelector('input[type="text"]')!, 'Piano recital');
      const allDay = sheet.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      allDay.checked = true;
      allDay.dispatchEvent(new Event('change'));
      await settle();
      button(sheet, 'Save').click();

      const request = http.expectOne({ method: 'POST', url: '/api/calendar/events' });
      expect(request.request.body).toMatchObject({
        calendarId: 'c1',
        title: 'Piano recital',
        allDay: true,
        startDate: '2026-10-15',
        endDate: '2026-10-16',
      });
    });

    it('keeps a refused event open with the server’s reason', async () => {
      const { page, settle } = await open('/calendar');

      page.querySelector<HTMLButtonElement>('.agenda li > button')!.click();
      await settle();
      const sheet = page.querySelector<HTMLElement>('app-event-sheet form')!;
      button(sheet, 'Save').click();
      http
        .expectOne({ method: 'PUT' })
        .flush(
          { title: 'Google could not be reached. Try again in a moment.' },
          { status: 503, statusText: 'Service Unavailable' },
        );
      await settle();

      expect(page.querySelector('app-event-sheet')).not.toBeNull();
      expect(sheet.querySelector('[role="alert"]')?.textContent).toBe('Google could not be reached. Try again in a moment.');
    });
  });
});
