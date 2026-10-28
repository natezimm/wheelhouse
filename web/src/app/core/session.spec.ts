import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessionStore, VISIT_RETRIES, VISIT_RETRY_MS } from './session';

describe('SessionStore', () => {
  let session: SessionStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    session = TestBed.inject(SessionStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match((r) => r.url === '/api/calendar/countdowns');
    http.verify();
  });

  /** Lets the store's awaited steps run up to its next request. */
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  it('checks a demo visitor in before it finishes starting', async () => {
    let started = false;
    const starting = session.start().then(() => (started = true));

    http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: false });
    await tick();
    expect(started).toBe(false);
    http.expectOne({ method: 'POST', url: '/api/demo/visit' }).flush(null);
    await starting;

    expect(session.isDemo()).toBe(true);
    expect(session.demoUnavailable()).toBeNull();
  });

  it('checks in a returning demo visitor too, in case their copy was cleared', async () => {
    const starting = session.start();

    http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: true });
    await tick();
    http.expectOne({ method: 'POST', url: '/api/demo/visit' }).flush(null);
    await starting;

    expect(session.isDemo()).toBe(true);
  });

  it('knows when too many new visits came from this network', async () => {
    const starting = session.start();

    http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: false });
    await tick();
    http
      .expectOne({ method: 'POST', url: '/api/demo/visit' })
      .flush({ detail: 'Too many new demo visits from your network. Try again later.' }, { status: 429, statusText: 'Too Many Requests' });
    await starting;

    expect(session.demoUnavailable()).toBe('busy');
    expect(session.isDemo()).toBe(false);
  });

  it('tries a check-in again when it got no answer', async () => {
    vi.useFakeTimers();
    try {
      const starting = session.start();

      http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: false });
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne({ method: 'POST', url: '/api/demo/visit' }).error(new ProgressEvent('abort'));
      await vi.advanceTimersByTimeAsync(VISIT_RETRY_MS);
      http.expectOne({ method: 'POST', url: '/api/demo/visit' }).flush(null);
      await starting;

      expect(session.isDemo()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('knows when the demo could not check the visitor in, after trying again', async () => {
    vi.useFakeTimers();
    try {
      const starting = session.start();

      http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: false });
      await vi.advanceTimersByTimeAsync(0);
      for (let attempt = 0; attempt <= VISIT_RETRIES; attempt++) {
        http
          .expectOne({ method: 'POST', url: '/api/demo/visit' })
          .flush(null, { status: 503, statusText: 'Service Unavailable' });
        await vi.advanceTimersByTimeAsync(VISIT_RETRY_MS);
      }
      await starting;

      expect(session.demoUnavailable()).toBe('failed');
      expect(session.isDemo()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never checks in on a family instance', async () => {
    const starting = session.start();

    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: false, canSignIn: true });
    await starting;

    http.expectNone('/api/demo/visit');
    expect(session.isDemo()).toBe(false);
    expect(session.canSignIn()).toBe(true);
    expect(session.canSignOut()).toBe(false);
  });

  it('lets a signed-in parent sign out, once the server has signed them out', async () => {
    const starting = session.start();
    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: true, canSignIn: true });
    await starting;
    expect(session.canSignIn()).toBe(false);
    expect(session.canSignOut()).toBe(true);

    let done = false;
    session.signOut().subscribe(() => (done = true));
    expect(session.canSignOut()).toBe(true);
    http.expectOne({ method: 'POST', url: '/api/auth/sign-out' }).flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
    expect(session.canSignOut()).toBe(false);
    expect(session.canSignIn()).toBe(true);
  });

  it('knows a paired display, which can sign out to let a parent sign in', async () => {
    const starting = session.start();
    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: true, canSignIn: true, isDisplay: true });
    await starting;
    expect(session.isDisplay()).toBe(true);
    expect(session.canSignOut()).toBe(true);

    session.signOut().subscribe();
    http.expectOne({ method: 'POST', url: '/api/auth/sign-out' }).flush(null, { status: 204, statusText: 'No Content' });

    expect(session.isDisplay()).toBe(false);
    expect(session.canSignIn()).toBe(true);
  });

  it('never offers sign-in or sign-out to a demo visitor', async () => {
    const starting = session.start();
    http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: false, canSignIn: false });
    await tick();
    http.expectOne({ method: 'POST', url: '/api/demo/visit' }).flush(null);
    await starting;

    expect(session.canSignIn()).toBe(false);
    expect(session.canSignOut()).toBe(false);
  });

  it('still finishes starting when the server cannot be reached', async () => {
    const starting = session.start();

    http.expectOne('/api/session').error(new ProgressEvent('error'));

    await expect(starting).resolves.toBeUndefined();
    expect(session.isDemo()).toBe(false);
  });
});
