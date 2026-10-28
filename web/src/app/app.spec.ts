import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { ASK_EVERY_MS } from './core/pairing';
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

    expect(page.tagName.toLowerCase()).toBe('app-calendar-home');
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

    expect(text(page.querySelectorAll('app-calendar-filter button'))).toEqual(['B Ben', 'T Tess', 'M Milo']);
    expect(page.querySelector('app-pairing-screen')).toBeNull();
  });

  it('leads from the phone to Settings along the bottom', async () => {
    const { page, settle } = await open('/');

    http.expectOne('/api/family').flush(marlowes);
    await settle();

    const links = page.querySelectorAll('nav[aria-label="Sections"] a');
    expect(text(links)).toEqual(['Calendar', 'Settings']);
    expect(links[1].getAttribute('href')).toBe('/settings');
  });

  it('shows a pairing code on the wall when it is not signed in to a family', async () => {
    const { page, settle } = await open('/wall');

    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();
    http.expectOne({ method: 'POST', url: '/api/pairing' }).flush({ id: 'p1', code: '482913', expiresAt: '' });
    await settle();

    expect(page.querySelector('app-pairing-screen h1')?.textContent).toBe('Pair this display');
    expect(page.querySelector('.code')?.getAttribute('aria-label')).toBe('Pairing code 482 913');
    expect(page.querySelectorAll('app-calendar-filter button').length).toBe(0);
  });

  it('switches the wall to the family once a parent enters its code', async () => {
    const { page, settle } = await open('/wall');
    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();

    // Only the wait between questions is faked; the page settles on real time.
    vi.useFakeTimers();
    try {
      http.expectOne({ method: 'POST', url: '/api/pairing' }).flush({ id: 'p1', code: '482913', expiresAt: '' });
      vi.advanceTimersByTime(ASK_EVERY_MS);
      http.expectOne('/api/pairing/p1/finish').flush(null, { status: 204, statusText: 'No Content' });
    } finally {
      vi.useRealTimers();
    }
    await settle();
    http.expectOne('/api/family').flush(marlowes);
    await settle();

    expect(page.querySelector('app-pairing-screen')).toBeNull();
    expect(text(page.querySelectorAll('app-calendar-filter button'))).toEqual(['B Ben', 'T Tess', 'M Milo']);
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
      const { page, settle } = await open('/');
      await settle();

      expect(page.querySelector('app-demo-notice')?.textContent?.trim()).toBe(
        'Demo · your own copy of a fictional family, cleared after a day',
      );
    });

    it("pairs the demo's wall with the visitor's phone, and can go back without pairing", async () => {
      await startDemo({ status: 204 });
      const { page, settle } = await open('/wall');
      http.expectOne('/api/family').flush(marlowes);
      await settle();
      const button = (label: string) =>
        Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label)!;

      button('Pair with a phone').click();
      await settle();
      http.expectOne({ method: 'POST', url: '/api/pairing' }).flush({ id: 'p1', code: '482913', expiresAt: '' });
      await settle();
      expect(page.querySelector('app-pairing-screen h1')?.textContent).toBe('Pair this display');

      button('Back to the family').click();
      await settle();
      expect(page.querySelector('app-pairing-screen')).toBeNull();
      expect(text(page.querySelectorAll('app-calendar-filter button'))).toEqual(['B Ben', 'T Tess', 'M Milo']);
    });

    it('says the demo could not start instead of showing a pairing code', async () => {
      await startDemo({ status: 403 });
      const { page, settle } = await open('/wall');
      http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(page.querySelector('app-demo-notice')?.textContent?.trim()).toBe(
        'The demo could not start. Please reload to try again.',
      );
      expect(page.querySelector('app-pairing-screen')).toBeNull();
    });
  });

  describe('on a family instance', () => {
    async function startFamily(session: { signedIn: boolean; canSignIn: boolean }) {
      const starting = TestBed.inject(SessionStore).start();
      http.expectOne('/api/session').flush({ mode: 'Family', ...session });
      await starting;
    }

    /** Opens the phone with nobody signed in, so the family is private. */
    async function openPrivate(url: string) {
      const opened = await open(url);
      http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
      await opened.settle();
      return opened.page;
    }

    const signInLink = (page: HTMLElement) => page.querySelector<HTMLAnchorElement>('app-sign-in a.button');

    it('offers a parent sign-in with Google on the phone, passing the browser time zone along', async () => {
      await startFamily({ signedIn: false, canSignIn: true });
      const page = await openPrivate('/');

      const href = new URL(signInLink(page)!.href, 'http://localhost');
      expect(signInLink(page)!.textContent).toBe('Sign in with Google');
      expect(href.pathname).toBe('/api/auth/google');
      expect(href.searchParams.get('returnUrl')).toBe('/');
      expect(href.searchParams.get('timeZone')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
      expect(page.querySelector('[role=alert]')).toBeNull();
    });

    it('says why Google sent someone back without signing them in', async () => {
      await startFamily({ signedIn: false, canSignIn: true });
      const page = await openPrivate('/?signin=refused');

      expect(page.querySelector('[role=alert]')?.textContent).toBe(
        "That Google account can't sign in to this Wheelhouse. Only the family's parents can.",
      );
    });

    it('offers no sign-in where Google is not set up', async () => {
      await startFamily({ signedIn: false, canSignIn: false });
      const page = await openPrivate('/');

      expect(page.querySelector('app-sign-in .private')?.textContent).toBe('This Wheelhouse is private.');
      expect(signInLink(page)).toBeNull();
    });
  });

  it('shows no demo notice on a family instance', async () => {
    const starting = TestBed.inject(SessionStore).start();
    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: false, canSignIn: true });
    await starting;
    const { page, settle } = await open('/wall');
    await settle();

    expect(page.querySelector('app-demo-notice')?.textContent?.trim()).toBe('');
  });
});
