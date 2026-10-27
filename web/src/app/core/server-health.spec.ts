import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ServerHealth } from './server-health';

describe('ServerHealth', () => {
  let health: ServerHealth;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    health = TestBed.inject(ServerHealth);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match((r) => r.url === '/api/calendar/countdowns');
    http.verify();
  });

  it('is checking until the first answer arrives', () => {
    health.check();

    expect(health.status()).toBe('checking');
    http.expectOne('/health').flush({ status: 'Healthy', checks: {} });
  });

  it('is live when /health answers 200', () => {
    health.check();
    http.expectOne('/health').flush({ status: 'Healthy', checks: { database: 'Healthy' } });

    expect(health.status()).toBe('live');
  });

  it('is offline when /health answers 503', () => {
    health.check();
    http
      .expectOne('/health')
      .flush({ status: 'Unhealthy', checks: { database: 'Unhealthy' } }, { status: 503, statusText: 'Service Unavailable' });

    expect(health.status()).toBe('offline');
  });

  it('is offline when the server cannot be reached', () => {
    health.check();
    http.expectOne('/health').error(new ProgressEvent('error'));

    expect(health.status()).toBe('offline');
  });

  it('goes back to live once the server answers again', () => {
    health.check();
    http.expectOne('/health').error(new ProgressEvent('error'));
    health.check();
    http.expectOne('/health').flush({ status: 'Healthy', checks: {} });

    expect(health.status()).toBe('live');
  });
});
