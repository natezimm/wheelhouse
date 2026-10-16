import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { Display } from '../core/displays';
import { SessionStore } from '../core/session';
import { marlowes } from '../testing/marlowes';

describe('Settings', () => {
  let http: HttpTestingController;
  let displays: Display[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    displays = [];
  });

  afterEach(() => http.verify());

  /** Opens Settings with the family loaded. */
  async function open() {
    const harness = await RouterTestingHarness.create('/settings');
    http.expectOne('/api/family').flush(marlowes);
    http.expectOne('/api/devices').flush(displays);
    http.expectOne('/api/calendar/google').flush({ canConnect: false, email: null, status: null });
    await harness.fixture.whenStable();
    const page = harness.routeNativeElement as HTMLElement;
    return { page, settle: () => harness.fixture.whenStable() };
  }

  const field = (page: HTMLElement, name: string) =>
    page.querySelector<HTMLInputElement | HTMLSelectElement>(`[formControlName=${name}]`)!;

  function type(control: HTMLInputElement | HTMLSelectElement, value: string) {
    control.value = value;
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
  }

  const saveButton = (page: HTMLElement) => page.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const message = (page: HTMLElement) => page.querySelector('[role=status]')?.textContent;

  it('lists each member with a link to edit them, then a way to add one', async () => {
    const { page } = await open();

    const links = Array.from(page.querySelectorAll('.rows a'), (link) => [
      link.querySelector('.name')?.textContent ?? link.textContent?.trim(),
      link.querySelector('.role')?.textContent,
      link.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Ben', 'Parent', '/settings/members/m1'],
      ['Tess', 'Parent', '/settings/members/m2'],
      ['Milo', 'Kid · no sign-in', '/settings/members/m3'],
      ['Add a family member', undefined, '/settings/members/new'],
    ]);
  });

  describe('displays', () => {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const rows = (page: HTMLElement) =>
      Array.from(page.querySelectorAll('.display'), (row) => [
        row.querySelector('.name')?.textContent,
        row.querySelector('.seen')?.textContent?.trim(),
        row.querySelector('.dot')?.classList.contains('online'),
      ]);
    const button = (page: HTMLElement, label: string) =>
      Array.from(page.querySelectorAll<HTMLButtonElement>('.display button')).find((b) => b.textContent?.trim() === label)!;

    it('lists each paired display with when it was last seen, then a way to pair one', async () => {
      displays = [
        { id: 'd1', name: 'Kitchen wall', pairedAt: minutesAgo(600), lastSeenAt: minutesAgo(3) },
        { id: 'd2', name: 'Hall', pairedAt: minutesAgo(9000), lastSeenAt: minutesAgo(3000) },
        { id: 'd3', name: 'Office', pairedAt: minutesAgo(1), lastSeenAt: null },
      ];
      const { page } = await open();

      const [kitchen, hall, office] = rows(page);
      expect(kitchen).toEqual(['Kitchen wall', 'Online · last seen 3 min ago', true]);
      expect(hall[1]).toMatch(/^Last seen /);
      expect(hall[2]).toBe(false);
      expect(office).toEqual(['Office', 'Waiting to sign in', false]);
      expect(page.querySelector('a.pair')?.getAttribute('href')).toBe('/settings/displays/pair');
    });

    it('says when there are none yet', async () => {
      const { page } = await open();

      expect(page.querySelector('.displays .none')?.textContent).toBe("No displays yet. A display shows a code until it's paired.");
    });

    it('removes a display only after a second, explicit tap', async () => {
      displays = [{ id: 'd1', name: 'Kitchen wall', pairedAt: minutesAgo(600), lastSeenAt: minutesAgo(3) }];
      const { page, settle } = await open();

      button(page, 'Remove').click();
      await settle();
      http.expectNone({ method: 'DELETE', url: '/api/devices/d1' });
      button(page, 'Remove').click();
      http.expectOne({ method: 'DELETE', url: '/api/devices/d1' }).flush(null, { status: 204, statusText: 'No Content' });
      await settle();

      expect(rows(page)).toEqual([]);
    });

    it('keeps the display when the server refuses to remove it', async () => {
      displays = [{ id: 'd1', name: 'Kitchen wall', pairedAt: minutesAgo(600), lastSeenAt: minutesAgo(3) }];
      const { page, settle } = await open();

      button(page, 'Remove').click();
      await settle();
      button(page, 'Remove').click();
      http.expectOne({ method: 'DELETE', url: '/api/devices/d1' }).flush(null, { status: 500, statusText: 'Server Error' });
      await settle();

      expect(rows(page).map(([name]) => name)).toEqual(['Kitchen wall']);
      expect(page.querySelector('.displays [role=alert]')?.textContent).toBe(
        'Could not remove Kitchen wall. Try again in a moment.',
      );
    });
  });

  it("fills the details from the family, with times a time input can show", async () => {
    const { page } = await open();

    expect(field(page, 'name').value).toBe('The Marlowes');
    expect(field(page, 'timeZone').value).toBe('America/New_York');
    expect(field(page, 'weekStartsOn').value).toBe('Monday');
    expect(field(page, 'units').value).toBe('Imperial');
    expect(field(page, 'nightModeFrom').value).toBe('21:30');
    expect(field(page, 'nightModeTo').value).toBe('06:30');
  });

  it('saves edited details in the form the server expects, and says so', async () => {
    const { page, settle } = await open();
    type(field(page, 'name'), '  The Marlowe Crew ');
    type(field(page, 'weekStartsOn'), 'Sunday');
    type(field(page, 'nightModeFrom'), '22:00');

    saveButton(page).click();
    const request = http.expectOne({ method: 'PUT', url: '/api/family' });
    expect(request.request.body).toEqual({
      name: 'The Marlowe Crew',
      timeZone: 'America/New_York',
      weekStartsOn: 'Sunday',
      units: 'Imperial',
      nightModeFrom: '22:00:00',
      nightModeTo: '06:30:00',
    });
    request.flush({ ...marlowes, name: 'The Marlowe Crew', weekStartsOn: 'Sunday', nightModeFrom: '22:00:00' });
    await settle();

    expect(message(page)).toBe('Saved');
    expect(field(page, 'name').value).toBe('The Marlowe Crew');
  });

  it('shows why the server refused, and keeps what was typed', async () => {
    const { page, settle } = await open();
    type(field(page, 'nightModeTo'), '21:30');

    saveButton(page).click();
    http
      .expectOne({ method: 'PUT', url: '/api/family' })
      .flush(
        { errors: { nightModeTo: ['Night mode needs a different start and end time.'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();

    expect(message(page)).toBe('Night mode needs a different start and end time.');
    expect(field(page, 'nightModeTo').value).toBe('21:30');
  });

  it('cannot save without a family name', async () => {
    const { page, settle } = await open();

    type(field(page, 'name'), '');
    await settle();

    expect(saveButton(page).disabled).toBe(true);
  });

  it('lets a signed-in parent sign out, then shows Today as private', async () => {
    const starting = TestBed.inject(SessionStore).start();
    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: true, canSignIn: true });
    await starting;
    const harness = await RouterTestingHarness.create('/settings');
    http.expectOne('/api/family').flush(marlowes);
    http.expectOne('/api/devices').flush([]);
    http.expectOne('/api/calendar/google').flush({ canConnect: true, email: null, status: null });
    await harness.fixture.whenStable();

    (harness.routeNativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.sign-out')!.click();
    http.expectOne({ method: 'POST', url: '/api/auth/sign-out' }).flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();
    // Today still holds the family for a moment, so it asks for the day's events once.
    http.expectOne((request) => request.url === '/api/calendar').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/health').flush({ status: 'Healthy', checks: {} });
    await harness.fixture.whenStable();

    const today = harness.routeNativeElement as HTMLElement;
    expect(today.tagName.toLowerCase()).toBe('app-phone-shell');
    expect(today.querySelector('app-sign-in a.button')?.textContent).toBe('Sign in with Google');
  });

  it('offers no sign-out unless a parent signed in with Google', async () => {
    const { page } = await open();

    expect(page.querySelector('button.sign-out')).toBeNull();
  });

  it('says the instance is private instead of showing settings', async () => {
    const harness = await RouterTestingHarness.create('/settings');
    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/devices').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/calendar/google').flush(null, { status: 401, statusText: 'Unauthorized' });
    await harness.fixture.whenStable();

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('.notice .private')?.textContent).toBe('This Wheelhouse is private.');
    expect(page.querySelector('form')).toBeNull();
  });
});
