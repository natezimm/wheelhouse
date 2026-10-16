import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { CalendarEvent } from './core/calendar';
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T21:22:00Z'));
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.useRealTimers());

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

  const texts = (elements: NodeListOf<Element>) => Array.from(elements, (e) => e.textContent?.replace(/\s+/g, ' ').trim());

  /** Each row's parts, such as its time, title and whose it is, one space apart. */
  const rows = (elements: NodeListOf<Element>) =>
    Array.from(elements, (row) =>
      Array.from(row.children, (part) => part.textContent?.trim())
        .filter(Boolean)
        .join(' '),
    );

  describe('on the wall', () => {
    const column = (page: HTMLElement, name: string) =>
      texts(page.querySelectorAll(`section[aria-label="${name}"] li .title`));

    it("shows the family's week from Monday, with each event on the days it covers", async () => {
      const { page } = await open('/wall', { from: '2026-10-12', to: '2026-10-19' });

      expect(page.querySelector('app-week-view h2')?.textContent).toBe('Oct 12 – 18');
      expect(texts(page.querySelectorAll('.day .dow'))).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
      expect(column(page, 'Monday, October 12')).toEqual(['Grandma in town', 'Dentist', 'Swim lesson', 'Book club']);
      expect(column(page, 'Tuesday, October 13')).toEqual(['Grandma in town', 'Trash & recycling']);
      expect(page.querySelector('.day.is-today')?.getAttribute('aria-label')).toBe('Monday, October 12');
      expect(rows(page.querySelectorAll('section[aria-label="Thursday, October 15"] li'))).toEqual([
        '6:10 AM Flight to Chicago Ben',
      ]);
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

      expect(page.querySelector('app-week-view h2')?.textContent).toBe('Oct 19 – 25');
      expect(page.querySelectorAll('.day li').length).toBe(0);
    });
  });

  describe('on the phone', () => {
    it("shows what is up next today, then the rest of the day", async () => {
      const { page } = await open('/', { from: '2026-10-12', to: '2026-10-13' });

      expect(texts(page.querySelectorAll('.next > span'))).toEqual([
        'UP NEXT · IN 8 MIN',
        'Swim lesson',
        '5:30 – 6:15 PM · Milo · Riverside Rec Center',
      ]);
      expect(page.querySelector('#later')?.textContent).toBe('Later');
      expect(rows(page.querySelectorAll('app-today-events li'))).toEqual([
        'All day Grandma in town Family',
        '7:00 PM Book club Tess',
      ]);
    });

    it('shows the month with a dot per busy person, and the chosen day below', async () => {
      const { page, settle } = await open('/calendar', { from: '2026-09-28', to: '2026-11-02' });
      const cell = (label: string) => page.querySelector<HTMLButtonElement>(`.grid button[aria-label="${label}"]`)!;

      expect(page.querySelector('h1')?.textContent).toBe('October');
      expect(page.querySelectorAll('.grid button').length).toBe(35);
      expect(cell('Monday, October 12').querySelectorAll('.dots span').length).toBe(4);
      expect(page.querySelector('#agenda')?.textContent).toBe('Mon, Oct 12 · 4 events');

      cell('Tuesday, October 13').click();
      await settle();

      expect(page.querySelector('#agenda')?.textContent).toBe('Tue, Oct 13 · 2 events');
      expect(rows(page.querySelectorAll('.agenda li'))).toEqual(['F All day Grandma in town', 'F All day Trash & recycling']);
    });
  });
});
