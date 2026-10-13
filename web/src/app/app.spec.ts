import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { SessionStore } from './core/session';
import { marlowes } from './testing/marlowes';

describe('routes', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** Opens a route and returns its element plus a way to let the page settle after a response. */
  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    const page = harness.routeNativeElement as HTMLElement;
    return { page, settle: () => harness.fixture.whenStable() };
  }

  const text = (elements: NodeListOf<Element>) => Array.from(elements, (element) => element.textContent?.trim());

  it('opens the phone layout at /', async () => {
    const { page } = await open('/');

    expect(page.tagName.toLowerCase()).toBe('app-phone-shell');
    expect(page.querySelector('h1')?.textContent).toBe('Today');
  });

  it('opens the wall layout at /wall', async () => {
    const { page } = await open('/wall');

    expect(page.tagName.toLowerCase()).toBe('app-wall-shell');
  });

  it('shows the connection status once the server answers', async () => {
    const { page, settle } = await open('/wall');
    const status = () => page.querySelector('[role=status]')?.textContent;
    expect(status()).toBe('Connecting to the server…');

    http.expectOne('/health').flush({ status: 'Healthy', checks: {} });
    await settle();

    expect(status()).toBe('Server connected');
  });

  it('shows each family member by name on the wall, in order', async () => {
    const { page, settle } = await open('/wall');

    http.expectOne('/api/family').flush(marlowes);
    await settle();

    expect(text(page.querySelectorAll('.members li'))).toEqual(['B Ben', 'T Tess', 'M Milo']);
    expect(page.querySelector('.private')).toBeNull();
  });

  it('names each family member on the phone, as the way into Settings', async () => {
    const { page, settle } = await open('/');

    http.expectOne('/api/family').flush(marlowes);
    await settle();

    const link = page.querySelector('a.family');
    expect(link?.getAttribute('href')).toBe('/settings');
    expect(text(link!.querySelectorAll('.sr-only'))).toEqual(['Family settings:', 'Ben', 'Tess', 'Milo']);
  });

  it('says the instance is private when nobody is signed in', async () => {
    const { page, settle } = await open('/wall');

    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(page.querySelector('.private')?.textContent).toBe('This Wheelhouse is private.');
    expect(page.querySelectorAll('.members li').length).toBe(0);
  });

  describe('on a demo instance', () => {
    /** Starts the session the way the app does at launch, as a demo visitor. */
    async function startDemo(visit: { status: number }) {
      const starting = TestBed.inject(SessionStore).start();
      http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: false });
      await new Promise((resolve) => setTimeout(resolve));
      http
        .expectOne({ method: 'POST', url: '/api/demo/visit' })
        .flush(null, { status: visit.status, statusText: visit.status === 204 ? 'No Content' : 'Service Unavailable' });
      await starting;
    }

    it('tells the visitor the family is fictional and theirs alone', async () => {
      await startDemo({ status: 204 });
      const { page, settle } = await open('/wall');
      await settle();

      expect(page.querySelector('app-demo-notice')?.textContent?.trim()).toBe(
        'Demo · your own copy of a fictional family, cleared after a day',
      );
    });

    it('says the demo is full instead of calling it private', async () => {
      await startDemo({ status: 503 });
      const { page, settle } = await open('/wall');
      http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(page.querySelector('app-demo-notice')?.textContent?.trim()).toBe(
        'The demo is full right now. Please try again later.',
      );
      expect(page.querySelector('.private')).toBeNull();
    });
  });

  it('shows no demo notice on a family instance', async () => {
    const starting = TestBed.inject(SessionStore).start();
    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: false });
    await starting;
    const { page, settle } = await open('/wall');
    await settle();

    expect(page.querySelector('app-demo-notice')?.textContent?.trim()).toBe('');
  });
});
