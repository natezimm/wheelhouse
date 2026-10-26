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
  const soccer = { ...timed('Soccer practice', 'm3', '2026-10-14T21:30:00Z', '2026-10-14T22:45:00Z'), recurring: true };
  const events: CalendarEvent[] = [swim, soccer];

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

  /** Opens the first event of a day on the wall's week, then its editor from the details. */
  async function edit(page: HTMLElement, settle: () => Promise<void>, day: string): Promise<void> {
    page.querySelector<HTMLButtonElement>(`[role="group"][aria-label="${day}"] .event`)!.click();
    await settle();
    button(page.querySelector('app-event-details')!, 'Edit event').click();
    await settle();
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  describe('on the wall', () => {
    it('adds a weekly event from the steppers and chips, and shows it once the server has it', async () => {
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
      // Weekly is named from the day the event is on by now.
      await settle();
      button(dialog, 'Weekly').click();
      await settle();
      expect(button(dialog, 'Weekly').getAttribute('aria-pressed')).toBe('true');
      expect(Array.from(dialog.querySelectorAll('.stepper > span'), (s) => s.textContent?.trim())).toEqual([
        'Tue, Oct 13',
        '6:00 PM',
        '7:00 PM',
      ]);
      button(dialog, 'Save event').click();

      const request = http.expectOne({ method: 'POST', url: '/api/calendar/events' });
      expect(request.request.body).toMatchObject({
        calendarId: 'c3',
        title: 'Parent & tot swim',
        location: null,
        allDay: false,
        startDate: '2026-10-13',
        startTime: '18:00:00',
        endDate: '2026-10-13',
        endTime: '19:00:00',
        recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
      });
      request.flush(timed('Parent & tot swim', 'm3', '2026-10-13T22:00:00Z', '2026-10-13T23:00:00Z'));
      http.expectOne((r) => r.url === '/api/calendar');
      await settle();

      expect(page.querySelector('app-event-dialog')).toBeNull();
      const tuesday = page.querySelectorAll('[role="group"][aria-label="Tuesday, October 13"] .event .title');
      expect(Array.from(tuesday, (t) => t.textContent)).toEqual(['Parent & tot swim']);
    });

    it('shows Google’s version when the event changed there first', async () => {
      const { page, settle } = await open('/wall');

      await edit(page, settle, 'Monday, October 12');
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

    it('makes an event that does not repeat yet into a weekly series', async () => {
      const { page, settle } = await open('/wall');

      await edit(page, settle, 'Monday, October 12');
      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      expect(button(dialog, 'Never').getAttribute('aria-pressed')).toBe('true');
      button(dialog, 'Weekly').click();
      await settle();
      expect(button(dialog, 'Weekly').getAttribute('aria-pressed')).toBe('true');
      button(dialog, 'Save changes').click();

      const request = http.expectOne({ method: 'PUT', url: `/api/calendar/events/${swim.id}` });
      expect(request.request.body).toMatchObject({ title: 'Swim lesson', startDate: '2026-10-12', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO' });
      await settle();
      const swims = page.querySelectorAll('.event[aria-busy="true"] .title');
      expect(Array.from(swims, (t) => t.textContent)).toEqual(['Swim lesson']);
    });

    it('changes every event of a series, keeping each on its own day', async () => {
      const { page, settle } = await open('/wall');

      await edit(page, settle, 'Wednesday, October 14');
      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      const tess = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('.chip')).find((chip) => chip.textContent?.trim().endsWith('Tess'))!;
      expect(button(dialog, 'This event').getAttribute('aria-pressed')).toBe('true');
      expect(button(dialog, 'Weekly')).toBeUndefined();
      expect(tess().disabled).toBe(true);

      button(dialog, 'A day later').click();
      button(dialog, 'All events').click();
      await settle();
      expect(button(dialog, 'A day later').disabled).toBe(true);
      expect(dialog.querySelector('.stepper > span')?.textContent?.trim()).toBe('Wed, Oct 14');
      tess().click();
      button(dialog, 'Start later').click();
      button(dialog, 'Save changes').click();

      const request = http.expectOne({ method: 'PUT', url: `/api/calendar/events/${soccer.id}?series=true` });
      expect(request.request.body).toMatchObject({ calendarId: 'c2', startDate: '2026-10-14', startTime: '17:45:00', endTime: '19:00:00' });
    });

    it('sets a custom repeat with steppers and weekday buttons', async () => {
      const { page, settle } = await open('/wall');

      await edit(page, settle, 'Monday, October 12');
      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      button(dialog, 'Custom').click();
      await settle();
      const custom = dialog.querySelector<HTMLElement>('[aria-label="Custom repeat"]')!;
      expect(button(custom, 'Monday').getAttribute('aria-pressed')).toBe('true');
      button(custom, 'More').click();
      await settle();
      button(custom, 'Wednesday').click();
      await settle();
      button(custom, 'After').click();
      await settle();
      button(custom, 'Fewer times').click();
      await settle();
      expect(dialog.querySelector('app-repeat-picker .said')?.textContent).toBe('Every 2 weeks on Monday and Wednesday, 9 times');
      button(dialog, 'Save changes').click();

      expect(http.expectOne({ method: 'PUT', url: `/api/calendar/events/${swim.id}` }).request.body)
        .toMatchObject({ recurrence: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=9' });
    });

    it('changes an event and those after it, which may move and take another calendar', async () => {
      const { page, settle } = await open('/wall');

      await edit(page, settle, 'Wednesday, October 14');
      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      button(dialog, 'This and following').click();
      await settle();
      expect(button(dialog, 'A day later').disabled).toBe(false);
      button(dialog, 'A day later').click();
      Array.from(dialog.querySelectorAll<HTMLButtonElement>('.chip')).find((chip) => chip.textContent?.trim().endsWith('Tess'))!.click();
      await settle();
      button(dialog, 'Save changes').click();

      const request = http.expectOne({ method: 'PUT', url: `/api/calendar/events/${soccer.id}?following=true` });
      expect(request.request.body).toMatchObject({ calendarId: 'c2', startDate: '2026-10-15' });
    });

    it('deletes an event only once it is confirmed', async () => {
      const { page, settle } = await open('/wall');

      page.querySelector<HTMLButtonElement>('[role="group"][aria-label="Monday, October 12"] .event')!.click();
      await settle();
      button(page.querySelector('app-event-details')!, 'Delete').click();
      await settle();
      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      expect(dialog.querySelector('.confirm')?.textContent).toBe('Delete this event?');
      http.expectNone({ method: 'DELETE' });
      button(dialog, 'Delete event').click();
      http.expectOne({ method: 'DELETE', url: `/api/calendar/events/${swim.id}` }).flush(null, { status: 204, statusText: 'No Content' });
      await settle();

      expect(page.querySelector('app-event-dialog')).toBeNull();
      expect(page.querySelectorAll('[role="group"][aria-label="Monday, October 12"] .event').length).toBe(0);
    });
  });

  describe('on the phone', () => {
    it('adds an event on the day chosen in the week strip', async () => {
      const { page, settle } = await open('/');

      page.querySelector<HTMLButtonElement>('.strip button[aria-label="Thursday, October 15"]')!.click();
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

    it('deletes a whole series when asked to', async () => {
      const { page, settle } = await open('/');

      page.querySelector<HTMLButtonElement>('.strip button[aria-label="Wednesday, October 14"]')!.click();
      await settle();
      page.querySelector<HTMLButtonElement>('app-agenda-list li button')!.click();
      await settle();
      button(page.querySelector('app-event-details')!, 'Edit event').click();
      await settle();
      const sheet = page.querySelector<HTMLElement>('app-event-sheet form')!;
      const change = Array.from(sheet.querySelectorAll('select')).find((select) => select.parentElement?.textContent?.includes('Change'))!;
      change.value = 'all';
      change.dispatchEvent(new Event('change'));
      await settle();
      expect(sheet.querySelector<HTMLInputElement>('input[type="date"]')!.disabled).toBe(true);
      button(sheet, 'Delete event').click();
      await settle();
      button(sheet, 'Delete all events').click();

      http.expectOne({ method: 'DELETE', url: `/api/calendar/events/${soccer.id}?series=true` }).flush(null, { status: 204, statusText: 'No Content' });
      http.expectOne((r) => r.url === '/api/calendar');
      await settle();
      expect(page.querySelector('app-event-sheet')).toBeNull();
    });

    it('makes an existing event repeat from its Repeat choice', async () => {
      const { page, settle } = await open('/');

      page.querySelector<HTMLButtonElement>('app-agenda-list li button')!.click();
      await settle();
      button(page.querySelector('app-event-details')!, 'Edit event').click();
      await settle();
      const sheet = page.querySelector<HTMLElement>('app-event-sheet form')!;
      const repeat = Array.from(sheet.querySelectorAll('select')).find((select) => select.parentElement?.textContent?.includes('Repeat'))!;
      repeat.value = 'monthly';
      repeat.dispatchEvent(new Event('change'));
      await settle();
      button(sheet, 'Save').click();

      expect(http.expectOne({ method: 'PUT', url: `/api/calendar/events/${swim.id}` }).request.body).toMatchObject({ recurrence: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=12' });
    });

    it('gives a whole series a new repeat, and none when only one event changes', async () => {
      const { page, settle } = await open('/');

      page.querySelector<HTMLButtonElement>('.strip button[aria-label="Wednesday, October 14"]')!.click();
      await settle();
      page.querySelector<HTMLButtonElement>('app-agenda-list li button')!.click();
      await settle();
      button(page.querySelector('app-event-details')!, 'Edit event').click();
      await settle();
      const sheet = page.querySelector<HTMLElement>('app-event-sheet form')!;
      const repeatOf = () => Array.from(sheet.querySelectorAll('select')).find((select) => select.parentElement?.textContent?.includes('Repeat'));
      expect(repeatOf()).toBeUndefined();
      const change = Array.from(sheet.querySelectorAll('select')).find((select) => select.parentElement?.textContent?.includes('Change'))!;
      change.value = 'all';
      change.dispatchEvent(new Event('change'));
      await settle();
      expect(Array.from(repeatOf()!.options, (o) => o.textContent?.trim())).not.toContain('Does not repeat');
      repeatOf()!.value = 'weekdays';
      repeatOf()!.dispatchEvent(new Event('change'));
      await settle();
      button(sheet, 'Save').click();

      expect(http.expectOne({ method: 'PUT', url: `/api/calendar/events/${soccer.id}?series=true` }).request.body)
        .toMatchObject({ recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    });

    it('deletes an event and those after it', async () => {
      const { page, settle } = await open('/');

      page.querySelector<HTMLButtonElement>('.strip button[aria-label="Wednesday, October 14"]')!.click();
      await settle();
      page.querySelector<HTMLButtonElement>('app-agenda-list li button')!.click();
      await settle();
      button(page.querySelector('app-event-details')!, 'Edit event').click();
      await settle();
      const sheet = page.querySelector<HTMLElement>('app-event-sheet form')!;
      const change = Array.from(sheet.querySelectorAll('select')).find((select) => select.parentElement?.textContent?.includes('Change'))!;
      change.value = 'following';
      change.dispatchEvent(new Event('change'));
      await settle();
      button(sheet, 'Delete event').click();
      await settle();
      button(sheet, 'Delete this and later events').click();

      http.expectOne({ method: 'DELETE', url: `/api/calendar/events/${soccer.id}?following=true` }).flush(null, { status: 204, statusText: 'No Content' });
      http.expectOne((r) => r.url === '/api/calendar');
    });

    it('keeps a refused event open with the server’s reason', async () => {
      const { page, settle } = await open('/');

      page.querySelector<HTMLButtonElement>('app-agenda-list li button')!.click();
      await settle();
      button(page.querySelector('app-event-details')!, 'Edit event').click();
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

