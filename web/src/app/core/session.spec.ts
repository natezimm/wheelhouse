import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessionStore } from './session';

describe('SessionStore', () => {
  let session: SessionStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    session = TestBed.inject(SessionStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

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
    expect(session.isDemoFull()).toBe(false);
  });

  it('checks in a returning demo visitor too, in case their copy was cleared', async () => {
    const starting = session.start();

    http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: true });
    await tick();
    http.expectOne({ method: 'POST', url: '/api/demo/visit' }).flush(null);
    await starting;

    expect(session.isDemo()).toBe(true);
  });

  it('knows when the demo has no room', async () => {
    const starting = session.start();

    http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: false });
    await tick();
    http
      .expectOne({ method: 'POST', url: '/api/demo/visit' })
      .flush({ detail: 'The demo is full right now. Try again later.' }, { status: 503, statusText: 'Service Unavailable' });
    await starting;

    expect(session.isDemoFull()).toBe(true);
    expect(session.isDemo()).toBe(false);
  });

  it('never checks in on a family instance', async () => {
    const starting = session.start();

    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: false });
    await starting;

    http.expectNone('/api/demo/visit');
    expect(session.isDemo()).toBe(false);
  });

  it('still finishes starting when the server cannot be reached', async () => {
    const starting = session.start();

    http.expectOne('/api/session').error(new ProgressEvent('error'));

    await expect(starting).resolves.toBeUndefined();
    expect(session.isDemo()).toBe(false);
  });
});
