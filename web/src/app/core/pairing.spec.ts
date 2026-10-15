import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ASK_EVERY_MS, RETRY_AFTER_MS, WallPairing } from './pairing';

describe('WallPairing', () => {
  let pairing: WallPairing;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    pairing = TestBed.inject(WallPairing);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    pairing.end();
    http.verify();
    vi.useRealTimers();
  });

  const showCode = (id: string, code: string) =>
    http.expectOne({ method: 'POST', url: '/api/pairing' }).flush({ id, code, expiresAt: '2026-10-14T22:10:00Z' });

  const answer = (id: string, status: number, statusText: string) =>
    http.expectOne({ method: 'POST', url: `/api/pairing/${id}/finish` }).flush(null, { status, statusText });

  it('shows a code and asks every few seconds whether a parent has entered it', () => {
    pairing.begin();
    showCode('p1', '482913');
    expect(pairing.state()).toEqual({ status: 'showing', code: '482913' });

    vi.advanceTimersByTime(ASK_EVERY_MS);
    answer('p1', 202, 'Accepted');
    vi.advanceTimersByTime(ASK_EVERY_MS);
    answer('p1', 204, 'No Content');

    expect(pairing.state()).toEqual({ status: 'paired' });
    vi.advanceTimersByTime(ASK_EVERY_MS * 3);
    http.expectNone('/api/pairing/p1/finish');
  });

  it('shows a new code once the old one expires', () => {
    pairing.begin();
    showCode('p1', '482913');

    vi.advanceTimersByTime(ASK_EVERY_MS);
    answer('p1', 404, 'Not Found');
    showCode('p2', '105377');

    expect(pairing.state()).toEqual({ status: 'showing', code: '105377' });
  });

  it('keeps asking about the same code when an answer is lost', () => {
    pairing.begin();
    showCode('p1', '482913');

    vi.advanceTimersByTime(ASK_EVERY_MS);
    http.expectOne('/api/pairing/p1/finish').error(new ProgressEvent('error'));
    vi.advanceTimersByTime(ASK_EVERY_MS);
    answer('p1', 204, 'No Content');

    expect(pairing.state()).toEqual({ status: 'paired' });
  });

  it('says so and tries again when the server cannot be reached', () => {
    pairing.begin();
    http.expectOne('/api/pairing').error(new ProgressEvent('error'));
    expect(pairing.state()).toEqual({ status: 'unavailable' });

    vi.advanceTimersByTime(RETRY_AFTER_MS);
    showCode('p1', '482913');

    expect(pairing.state()).toEqual({ status: 'showing', code: '482913' });
  });

  it('stops asking once ended', () => {
    pairing.begin();
    showCode('p1', '482913');

    pairing.end();
    vi.advanceTimersByTime(ASK_EVERY_MS * 3);

    http.expectNone('/api/pairing/p1/finish');
    expect(pairing.state()).toEqual({ status: 'idle' });
  });
});
