import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { CalendarEvent, CalendarStore } from './core/calendar';
import { FamilyStore } from './core/family';
import { VIEW_STORAGE_KEY } from './core/view-preferences';
import { RETURN_AFTER_MS } from './wall/wall-shell';
import { allDay, marloweCalendars, timed } from './testing/calendar';
import { marlowes } from './testing/marlowes';

/** The calendar on the wall and the phone, with the clock at 5:22 PM on Monday, October 12, 2026 in New York. */
describe('calendar screens', () => {
  let http: HttpTestingController;

  const events: CalendarEvent[] = [
    allDay('Grandma in town', null, '2026-10-10', '2026-10-14'),
    timed('Dentist', 'm1', '2026-10-12T19:00:00Z', '2026-10-12T20:00:00Z'),
    timed('Swim lesson', 'm3', '2026-10-12T21:30:00Z', '2026-10-12T22:15:00Z', 'Riverside Rec Center'),
    timed('Book club', 'm2', '2026-10-12T23:00:00Z', '2026-10-13T01:00:00Z'),
    allDay('Trash & recycling', null, '2026-10-13', '2026-10-14'),
    timed('Flight to Chicago', 'm1', '2026-10-15T10:10:00Z', '2026-10-15T12:40:00Z'),
  ];

  beforeEach(() => {
    // Each test starts on a new device, with no remembered views.
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T21:22:00Z'));
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  // Remembered views would otherwise reach other spec files that share this browser storage.
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  /** Opens a screen, answers for the family and the calendar, and returns the page. */
  async function open(url: string, range: { from: string; to: string }) {
    const harness = await RouterTestingHarness.create(url);
    http.expectOne('/api/family').flush(marlowes);
    await harness.fixture.whenStable();
    const request = http.expectOne((r) => r.url === '/api/calendar');
    expect({ from: request.request.params.get('from'), to: request.request.params.get('to') }).toEqual(range);
    request.flush({ calendars: marloweCalendars, events });
    await harness.fixture.whenStable();
    return { page: harness.routeNativeElement as HTMLElement, settle: () => harness.fixture.whenStable() };
  }

  /** What the toolbar says is shown, such as "October 12 – 18 2026". */
  const shownTitle = (page: HTMLElement) => page.querySelector('app-calendar-toolbar h1')?.textContent?.replace(/\s+/g, ' ').trim();

  const texts = (elements: NodeListOf<Element>) => Array.from(elements, (e) => e.textContent?.replace(/\s+/g, ' ').trim());

  /** The titles of a day's timed events on the week's grid. */
  const column = (page: HTMLElement, name: string) => texts(page.querySelectorAll(`[role="group"][aria-label="${name}"] .event .title`));

  /** Each row's parts, such as its time, title and whose it is, one space apart. */
  const rows = (elements: NodeListOf<Element>) =>
    Array.from(elements, (row) =>
      Array.from(row.children, (part) => part.textContent?.trim())
        .filter(Boolean)
        .join(' '),
    );

  describe('on the wall', () => {
    it("shows the family's week from Monday on one hour grid, with all-day events as bars across their days", async () => {
      const { page } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });

      expect(shownTitle(page)).toBe('October 12 – 18 2026');
      expect(texts(page.querySelectorAll('.heads .dow'))).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
      expect(page.querySelector('.head.today')?.getAttribute('aria-label')).toBe('Open Monday, October 12');

      const bars = Array.from(page.querySelectorAll<HTMLElement>('.bars .bar'));
      expect(bars.map((bar) => [bar.querySelector('.title')?.textContent, bar.style.gridColumn, bar.classList.contains('before')])).toEqual([
        ['Grandma in town', '1 / span 2', true],
        ['Trash & recycling', '2 / span 1', false],
      ]);

      expect(column(page, 'Monday, October 12')).toEqual(['Dentist', 'Swim lesson', 'Book club']);
      expect(column(page, 'Tuesday, October 13')).toEqual([]);
      expect(Array.from(page.querySelectorAll('[aria-label="Thursday, October 15"] .event'), (e) => e.getAttribute('aria-label'))).toEqual([
        'Flight to Chicago, Thursday 6:10 – 8:40 AM, Ben',
      ]);
    });

    it('places timed events by their start and length, from an hour that fits the earliest, with the now line on today', async () => {
      const { page } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });
      const block = (title: string) =>
        Array.from(page.querySelectorAll<HTMLElement>('.event')).find((e) => e.querySelector('.title')?.textContent === title)!;

      // The 6:10 AM flight moves the first hour from 7 AM to 6. At 50 px an hour below 10 px of
      // room, 3 PM is 9 hours down, and an hour-long event is 50 px less 3 px of gap.
      expect(texts(page.querySelectorAll('.hours span')).slice(0, 2)).toEqual(['6 AM', '7 AM']);
      expect([block('Dentist').style.top, block('Dentist').style.height]).toEqual(['461px', '47px']);
      // An hour at 50 px leaves too little room for the time row and a title line, so it reads on one line.
      expect(block('Dentist').classList.contains('short')).toBe(true);
      expect(block('Book club').classList.contains('short')).toBe(false);
      expect(block('Swim lesson').querySelector('.time')?.textContent).toBe('5:30 pm');
      expect(page.querySelectorAll('[aria-label="Monday, October 12"] .now-line')).toHaveLength(1);
      expect(page.querySelectorAll('.now-line')).toHaveLength(1);
      expect(page.querySelector('.now-label')?.textContent).toBe('5:22');
    });

    it('opens an event’s details first, and closes them again', async () => {
      const { page, settle } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });

      page.querySelector<HTMLButtonElement>('[aria-label^="Swim lesson"]')!.click();
      await settle();
      const details = page.querySelector<HTMLElement>('app-event-details [role="dialog"]')!;
      expect(details.getAttribute('aria-label')).toBe('Swim lesson');
      expect(details.querySelector('.who')?.textContent).toContain('Milo');
      expect(texts(details.querySelectorAll('.day, h2, .when, .facts li'))).toEqual([
        'Monday, October 12',
        'Swim lesson',
        '5:30 – 6:15 PM',
        'Riverside Rec Center',
        'Does not repeat',
        'Milo',
      ]);
      expect(page.querySelector('app-event-dialog')).toBeNull();
      expect(page.querySelector('[aria-label^="Swim lesson"]')?.classList.contains('selected')).toBe(true);

      details.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
      await settle();
      expect(page.querySelector('app-event-details')).toBeNull();
    });

    it('shows a read-only event’s details with why it cannot be changed', async () => {
      const harness = await RouterTestingHarness.create('/wall');
      http.expectOne('/api/family').flush(marlowes);
      await harness.fixture.whenStable();
      const school = { id: 'c9', name: 'School district', memberId: null, canWrite: false };
      http.expectOne((r) => r.url === '/api/calendar').flush({
        calendars: [...marloweCalendars, school],
        events: [{ ...allDay('Spirit Day', null, '2026-10-16', '2026-10-17'), calendarId: 'c9' }],
      });
      await harness.fixture.whenStable();
      const page = harness.routeNativeElement as HTMLElement;

      page.querySelector<HTMLButtonElement>('.bar')!.click();
      await harness.fixture.whenStable();
      const details = page.querySelector<HTMLElement>('app-event-details')!;
      expect(details.querySelector('.note')?.textContent?.trim()).toBe(
        'This event comes from the School district calendar, which Wheelhouse can show but not change.',
      );
      expect(details.querySelector('.edit')).toBeNull();
      expect(texts(details.querySelectorAll('.day, .when'))).toEqual(['Friday, October 16', 'All day']);
    });

    it('starts a new event at the half hour tapped on the grid', async () => {
      const { page, settle } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });
      const wednesday = page.querySelector<HTMLElement>('[role="group"][aria-label="Wednesday, October 14"]')!;

      // 10 px of room, then 50 px an hour from 6 AM: 445 px is 8 hours and 42 minutes in.
      Object.defineProperty(MouseEvent.prototype, 'offsetY', { configurable: true, get: () => 445 });
      wednesday.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      delete (MouseEvent.prototype as { offsetY?: number }).offsetY;
      await settle();

      const dialog = page.querySelector<HTMLElement>('app-event-dialog form')!;
      expect(Array.from(dialog.querySelectorAll('.stepper > span'), (s) => s.textContent?.trim())).toEqual(['Wed, Oct 14', '2:30 PM', '3:30 PM']);
    });

    it("hides a person's events when their chip is tapped", async () => {
      const { page, settle } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });
      const chip = (name: string) =>
        Array.from(page.querySelectorAll<HTMLButtonElement>('app-calendar-filter button')).find((b) =>
          b.textContent?.includes(name),
        )!;

      expect(texts(page.querySelectorAll('app-calendar-filter button'))).toEqual(['B Ben', 'T Tess', 'M Milo', 'F Family']);
      chip('Family').click();
      await settle();

      expect(chip('Family').getAttribute('aria-pressed')).toBe('false');
      expect(column(page, 'Monday, October 12')).toEqual(['Dentist', 'Swim lesson', 'Book club']);
      expect(page.querySelectorAll('.bars .bar')).toHaveLength(0);
    });

    it('moves a week at a time', async () => {
      const { page, settle } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });

      page.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click();
      await settle();
      http.expectOne((r) => r.params.get('from') === '2026-10-19' && r.params.get('to') === '2026-10-26').flush({
        calendars: marloweCalendars,
        events: [],
      });
      await settle();

      expect(shownTitle(page)).toBe('October 19 – 25 2026');
      expect(page.querySelectorAll('.event, .bar').length).toBe(0);
    });
  });

  describe('on the wall, by day and by month', () => {
    const button = (page: HTMLElement, label: string) =>
      Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label)!;

    /** Opens the wall's week, then switches it to another view, answering for its days. */
    async function switchTo(label: string, range: { from: string; to: string }) {
      const opened = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });
      button(opened.page, label).click();
      await opened.settle();
      http
        .expectOne((r) => r.params.get('from') === range.from && r.params.get('to') === range.to)
        .flush({ calendars: marloweCalendars, events });
      await opened.settle();
      return opened;
    }

    it('shows a day as a column per person, with all-day events on top', async () => {
      const { page } = await switchTo('Day', { from: '2026-10-12', to: '2026-10-13' });

      expect(shownTitle(page)).toBe('Monday, October 12 2026');
      expect(rows(page.querySelectorAll('app-day-view .head .who'))).toEqual(['Ben 1 today', 'Tess 1 today', 'Milo 1 today', 'Family 1 today']);
      expect(texts(page.querySelectorAll('app-day-view .all-day .bar'))).toEqual(['Grandma in town']);
      expect(rows(page.querySelectorAll('[role="group"][aria-label="Milo"] .event .content'))).toEqual(['Swim lesson 5:30 – 6:15 PM']);
      expect(rows(page.querySelectorAll('[role="group"][aria-label="Tess"] .event .content'))).toEqual(['Book club 7:00 – 9:00 PM']);
      // The now line crosses every person's column, with the time in the gutter.
      expect(page.querySelectorAll('app-day-view .now-line').length).toBe(4);
      expect(page.querySelector('app-day-view .now-label')?.textContent).toBe('5:22');
    });

    it('says plainly when a day has nothing planned, and only once it has loaded', async () => {
      const { page, settle } = await switchTo('Day', { from: '2026-10-12', to: '2026-10-13' });
      page.querySelector<HTMLButtonElement>('button[aria-label="Next day"]')!.click();
      await settle();
      const tuesday = http.expectOne((r) => r.params.get('from') === '2026-10-13');
      expect(page.querySelector('app-day-view .empty')).toBeNull();
      tuesday.flush({ calendars: marloweCalendars, events: [] });
      await settle();

      expect(page.querySelector('app-day-view .empty')?.textContent).toBe('Nothing planned for Tuesday');
      expect(texts(page.querySelectorAll('app-day-view .head .count'))).toEqual(['Nothing planned', 'Nothing planned', 'Nothing planned', 'Nothing planned']);
    });

    it("drops a hidden person's column from the day", async () => {
      const { page, settle } = await switchTo('Day', { from: '2026-10-12', to: '2026-10-13' });

      Array.from(page.querySelectorAll<HTMLButtonElement>('app-calendar-filter button'))
        .find((b) => b.textContent?.includes('Tess'))!
        .click();
      await settle();

      expect(texts(page.querySelectorAll('app-day-view .head .name'))).toEqual(['Ben', 'Milo', 'Family']);
    });

    it('shows the month with the first events of each day, and opens a day when it is tapped', async () => {
      const { page, settle } = await switchTo('Month', { from: '2026-09-28', to: '2026-11-02' });
      const cell = (label: string) =>
        Array.from(page.querySelectorAll<HTMLButtonElement>('app-month-view button.cell')).find((b) => b.getAttribute('aria-label')?.startsWith(label))!;
      const lines = (day: string) => rows(page.querySelectorAll(`app-month-view .lines[data-day="${day}"] .line`));

      expect(shownTitle(page)).toBe('October 2026');
      expect(page.querySelectorAll('app-month-view button.cell').length).toBe(35);
      expect(page.querySelectorAll('app-month-view .week').length).toBe(5);
      expect(cell('Monday, October 12').getAttribute('aria-label')).toBe('Monday, October 12, 4 events');
      // All-day events are bars across their days; timed ones a line each with a short time.
      expect(texts(page.querySelectorAll('app-month-view .bar .title'))).toEqual(['Grandma in town', 'Grandma in town', 'Trash & recycling']);
      expect(lines('2026-10-12')).toEqual(['3p Dentist', '5:30p Swim lesson', '7p Book club']);
      expect(lines('2026-10-15')).toEqual(['6:10a Flight to Chicago']);

      cell('Tuesday, October 13').click();
      await settle();
      http.expectOne((r) => r.params.get('from') === '2026-10-13').flush({ calendars: marloweCalendars, events });
      await settle();

      expect(shownTitle(page)).toBe('Tuesday, October 13 2026');
      expect(button(page, 'Day').getAttribute('aria-pressed')).toBe('true');
    });

    it('asks a parent to connect Google again when it has stopped accepting the connection', async () => {
      const harness = await RouterTestingHarness.create('/wall');
      http.expectOne('/api/family').flush(marlowes);
      await harness.fixture.whenStable();
      http.expectOne((r) => r.url === '/api/calendar').flush({ calendars: marloweCalendars, events, needsReconnect: true });
      await harness.fixture.whenStable();
      const page = harness.routeNativeElement as HTMLElement;

      expect(page.querySelector('.reconnect')?.textContent?.trim()).toBe(
        'Google Calendar needs reconnecting. A parent can fix it in Settings on their phone.',
      );
      expect(column(page, 'Monday, October 12')).toContain('Dentist');
    });

    it('shows no reconnect notice while Google is connected', async () => {
      const { page } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });

      expect(page.querySelector('.reconnect')).toBeNull();
    });

    it('comes back to now a while after the last touch, keeping the view', async () => {
      const { page, settle } = await switchTo('Month', { from: '2026-09-28', to: '2026-11-02' });
      page.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click();
      await settle();
      http.expectOne((r) => r.params.get('from') === '2026-10-26').flush({ calendars: marloweCalendars, events });
      await settle();
      expect(shownTitle(page)).toBe('November 2026');

      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      page.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      vi.advanceTimersByTime(RETURN_AFTER_MS - 1);
      expect(shownTitle(page)).toBe('November 2026');

      vi.advanceTimersByTime(1);
      vi.useFakeTimers({ toFake: ['Date'] });
      await settle();

      expect(button(page, 'Month').getAttribute('aria-pressed')).toBe('true');
      expect(shownTitle(page)).toBe('October 2026');
    });

    /** Opens the editor for a new event, maybe types in it, then leaves the wall alone. */
    async function leaveEditor(typed: string | null) {
      const { page, settle } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });
      button(page, 'Add event').click();
      await settle();
      if (typed) {
        const title = page.querySelector<HTMLInputElement>('#event-title')!;
        title.value = typed;
        title.dispatchEvent(new Event('input'));
        await settle();
      }
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      page.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      vi.advanceTimersByTime(RETURN_AFTER_MS);
      vi.useFakeTimers({ toFake: ['Date'] });
      await settle();
      return page;
    }

    it('closes an untouched editor when the wall comes back to now', async () => {
      const page = await leaveEditor(null);

      expect(page.querySelector('app-event-dialog')).toBeNull();
    });

    it('closes an event’s details when the wall comes back to now', async () => {
      const { page, settle } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });
      page.querySelector<HTMLButtonElement>('[aria-label^="Dentist"]')!.click();
      await settle();
      expect(page.querySelector('app-event-details')).not.toBeNull();

      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      page.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      vi.advanceTimersByTime(RETURN_AFTER_MS);
      vi.useFakeTimers({ toFake: ['Date'] });
      await settle();

      expect(page.querySelector('app-event-details')).toBeNull();
    });

    it('keeps an editor with a half-typed event open when the wall comes back to now', async () => {
      const page = await leaveEditor('Bake sale');

      expect(page.querySelector<HTMLInputElement>('app-event-dialog #event-title')?.value).toBe('Bake sale');
    });

    it('opens in the view the wall had last, and remembers it apart from the phone', async () => {
      localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ wall: 'month', phone: 'week' }));
      const { page } = await open('/wall', { from: '2026-09-28', to: '2026-11-02' });

      expect(button(page, 'Month').getAttribute('aria-pressed')).toBe('true');
      button(page, 'Day').click();
      expect(JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY)!)).toEqual({ wall: 'day', phone: 'week' });
    });
  });

  describe('on the phone', () => {
    const button = (page: HTMLElement, label: string) =>
      Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label)!;

    it('closes an event’s details when the family signs out, so they never cover the sign-in screen', async () => {
      const { page, settle } = await open('/', { from: '2026-10-12', to: '2026-10-19' });
      page.querySelector<HTMLButtonElement>('app-agenda-list li.event button')!.click();
      await settle();
      expect(page.querySelector('app-event-details [role="dialog"]')).not.toBeNull();

      // What the live connection does when the cookie no longer opens the family.
      TestBed.inject(FamilyStore).refresh();
      http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
      TestBed.inject(CalendarStore).reset();
      await settle();
      expect(page.querySelector('app-event-details')).toBeNull();
    });

    it("opens on today's agenda, with the now line between what has happened and what is next", async () => {
      const { page, settle } = await open('/', { from: '2026-10-12', to: '2026-10-19' });

      expect(page.tagName.toLowerCase()).toBe('app-calendar-home');
      expect(page.querySelector('h1')?.textContent).toBe('Today');
      expect(button(page, 'Day').getAttribute('aria-pressed')).toBe('true');
      expect(texts(page.querySelectorAll('.all-day .title'))).toEqual(['Grandma in town']);
      expect(page.querySelector('.earlier')?.textContent?.trim()).toBe('1 earlier event');
      const agenda = Array.from(page.querySelectorAll('app-agenda-list li'), (row) =>
        ['.time', '.start', '.end', '.title', '.detail']
          .map((part) => row.querySelector(part)?.textContent?.trim())
          .filter(Boolean)
          .join(' '),
      );
      expect(agenda).toEqual(['5:22p', '5:30p 6:15p Swim lesson Milo · Riverside Rec Center', '7:00p 9:00p Book club Tess']);

      button(page, '1 earlier event').click();
      await settle();
      expect(texts(page.querySelectorAll('app-agenda-list li .title'))).toEqual(['Dentist', 'Swim lesson', 'Book club']);
    });

    it('moves around the week from its strip, and says when a day is empty', async () => {
      const { page, settle } = await open('/', { from: '2026-10-12', to: '2026-10-19' });
      const day = (label: string) => page.querySelector<HTMLButtonElement>(`.strip button[aria-label="${label}"]`)!;

      expect(texts(page.querySelectorAll('.strip .dow'))).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
      expect(day('Thursday, October 15').querySelector('.dot.busy')).not.toBeNull();
      expect(day('Friday, October 16').querySelector('.dot.busy')).toBeNull();

      day('Friday, October 16').click();
      await settle();

      expect(page.querySelector('h1')?.textContent).toBe('Friday');
      expect(page.querySelector('.empty h2')?.textContent).toBe('Nothing planned for Friday');
      expect(page.querySelector('.empty p')?.textContent).toBe('No events on anyone’s calendar.');
      // The week is already loaded, so no more reads.
      http.expectNone((r) => r.url === '/api/calendar');
    });

    it('shows the week as a card per day with a row per event, today outlined', async () => {
      const { page, settle } = await open('/', { from: '2026-10-12', to: '2026-10-19' });
      button(page, 'Week').click();
      await settle();
      http.expectNone((r) => r.url === '/api/calendar');

      const cards = page.querySelectorAll('app-phone-week section.day');
      expect(cards.length).toBe(7);
      expect(rows(page.querySelectorAll('app-phone-week section.day h2'))).toEqual([
        'Today Monday · 4 events',
        'Tomorrow Tuesday · 2 events',
        'Wednesday October 14 · No events',
        'Thursday October 15 · 1 event',
        'Friday October 16 · No events',
        'Saturday October 17 · No events',
        'Sunday October 18 · No events',
      ]);
      expect(cards[0].classList).toContain('is-today');
      expect(rows(cards[0].querySelectorAll('app-compact-agenda button'))).toEqual([
        'All day F Grandma in town',
        '3:00 pm B Dentist',
        '5:30 pm M Swim lesson',
        '7:00 pm T Book club',
      ]);
      expect(cards[2].querySelector('app-compact-agenda .empty')?.textContent).toBe('Nothing planned');
    });

    it('shows the month with a dot per busy person, the chosen day below, and opens a day', async () => {
      const { page, settle } = await open('/', { from: '2026-10-12', to: '2026-10-19' });
      button(page, 'Month').click();
      await settle();
      http.expectOne((r) => r.params.get('from') === '2026-09-28' && r.params.get('to') === '2026-11-02').flush({ calendars: marloweCalendars, events });
      await settle();
      const cell = (label: string) => page.querySelector<HTMLButtonElement>(`.grid button[aria-label="${label}"]`)!;

      expect(page.querySelector('h1')?.textContent).toBe('October');
      expect(page.querySelectorAll('.grid button').length).toBe(35);
      expect(cell('Monday, October 12').querySelectorAll('.dots span').length).toBe(3);
      expect(page.querySelector('#agenda')?.textContent).toBe('Today · Monday, October 12');

      cell('Tuesday, October 13').click();
      await settle();

      expect(page.querySelector('#agenda')?.textContent).toBe('Tuesday, October 13');
      expect(rows(page.querySelectorAll('.agenda app-compact-agenda button'))).toEqual(['All day F Grandma in town', 'All day F Trash & recycling']);
      expect(button(page, 'Month').getAttribute('aria-pressed')).toBe('true');

      button(page, 'Open day').click();
      await settle();
      expect(button(page, 'Day').getAttribute('aria-pressed')).toBe('true');
      expect(page.querySelector('h1')?.textContent).toBe('Tomorrow');
    });

    it('remembers the view chosen on the phone for its next visit', async () => {
      const first = await open('/', { from: '2026-10-12', to: '2026-10-19' });
      button(first.page, 'Week').click();
      await first.settle();

      expect(JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY)!)).toEqual({ phone: 'week' });
    });

    it('falls back to Day when what was remembered cannot be read', async () => {
      localStorage.setItem(VIEW_STORAGE_KEY, '{"phone": "agenda", "wall": 7');
      const { page } = await open('/', { from: '2026-10-12', to: '2026-10-19' });

      expect(button(page, 'Day').getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps /calendar working for old links', async () => {
      const { page } = await open('/calendar', { from: '2026-10-12', to: '2026-10-19' });

      expect(page.tagName.toLowerCase()).toBe('app-calendar-home');
    });
  });

  describe('in a desktop browser', () => {
    const original = window.matchMedia;
    let widthChanged: ((change: { matches: boolean }) => void) | undefined;

    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query === '(min-width: 768px)',
        addEventListener: (_: string, listener: (change: { matches: boolean }) => void) => (widthChanged = listener),
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
    });

    afterEach(() => (window.matchMedia = original));

    it('opens on the week, with a rail instead of the bottom tabs', async () => {
      const { page } = await open('/', { from: '2026-10-12', to: '2026-10-19' });

      expect(shownTitle(page)).toBe('October 12 – 18 2026');
      expect(texts(page.querySelectorAll('nav.rail a'))).toEqual(['Calendar', 'Settings']);
      expect(page.querySelector('app-phone-nav')).toBeNull();
      expect(column(page, 'Monday, October 12')).toContain('Dentist');
    });

    it('keeps the view and the day when the window narrows, and remembers a view for the context it is in now', async () => {
      const { page, settle } = await open('/', { from: '2026-10-12', to: '2026-10-19' });
      page.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click();
      await settle();
      http.expectOne((r) => r.params.get('from') === '2026-10-19').flush({ calendars: marloweCalendars, events });

      widthChanged!({ matches: false });
      await settle();

      expect(page.querySelector('app-phone-nav')).not.toBeNull();
      expect(page.querySelector('h1')?.textContent).toBe('Oct 19 – 25');
      expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBeNull();

      Array.from(page.querySelectorAll<HTMLButtonElement>('.view-switch button')).find((b) => b.textContent?.trim() === 'Month')!.click();
      await settle();
      expect(JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY)!)).toEqual({ phone: 'month' });
      http.match((r) => r.url === '/api/calendar');
    });
  });
});
