import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';

describe('PairDisplay', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Settings, where pairing returns to, loads the family and its displays.
    http.match('/api/family');
    http.match('/api/devices');
    http.match('/api/calendar/google');
    http.match((r) => r.url === '/api/calendar/countdowns');
    http.verify();
  });

  async function open() {
    const harness = await RouterTestingHarness.create('/settings/displays/pair');
    const page = harness.routeNativeElement as HTMLElement;
    return { page, settle: () => harness.fixture.whenStable() };
  }

  const input = (page: HTMLElement, name: string) => page.querySelector<HTMLInputElement>(`[formControlName=${name}]`)!;
  const submit = (page: HTMLElement) => page.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const alert = (page: HTMLElement) => page.querySelector('[role=alert]')?.textContent;

  function type(field: HTMLInputElement, value: string) {
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  async function fill(code: string, name: string) {
    const opened = await open();
    type(input(opened.page, 'code'), code);
    type(input(opened.page, 'name'), name);
    await opened.settle();
    return opened;
  }

  it('needs six digits and a name', async () => {
    const { page, settle } = await fill('48291', 'Kitchen wall');
    expect(submit(page).disabled).toBe(true);

    type(input(page, 'code'), '482 913');
    type(input(page, 'name'), '  ');
    await settle();
    expect(submit(page).disabled).toBe(true);

    type(input(page, 'name'), 'Kitchen wall');
    await settle();
    expect(submit(page).disabled).toBe(false);
  });

  it('sends the code as digits and returns to Settings once paired', async () => {
    const { page, settle } = await fill('482-913', ' Kitchen wall ');

    submit(page).click();
    const request = http.expectOne({ method: 'POST', url: '/api/devices' });
    expect(request.request.body).toEqual({ code: '482913', name: 'Kitchen wall' });
    request.flush({ id: 'd1', name: 'Kitchen wall', pairedAt: '2026-10-14T22:00:00Z', lastSeenAt: null });
    await settle();

    expect(TestBed.inject(Router).url).toBe('/settings');
  });

  it('stays put and says why when no display shows the code', async () => {
    const { page, settle } = await fill('000000', 'Kitchen wall');

    submit(page).click();
    http
      .expectOne('/api/devices')
      .flush(
        { errors: { code: ['No display is showing that code. Check the code on the display, or wait for a new one.'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();

    expect(alert(page)).toBe('No display is showing that code. Check the code on the display, or wait for a new one.');
    expect(TestBed.inject(Router).url).toBe('/settings/displays/pair');
    expect(submit(page).disabled).toBe(false);
  });

  it('asks the parent to wait after too many tries', async () => {
    const { page, settle } = await fill('000000', 'Kitchen wall');

    submit(page).click();
    http.expectOne('/api/devices').flush(null, { status: 429, statusText: 'Too Many Requests' });
    await settle();

    expect(alert(page)).toBe('Too many tries. Wait a minute, then try again.');
  });
});
