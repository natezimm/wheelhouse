import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('opens the phone layout at /', async () => {
    const harness = await RouterTestingHarness.create('/');

    expect(harness.routeNativeElement?.tagName.toLowerCase()).toBe('app-phone-shell');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Today');
  });

  it('opens the wall layout at /wall', async () => {
    const harness = await RouterTestingHarness.create('/wall');

    expect(harness.routeNativeElement?.tagName.toLowerCase()).toBe('app-wall-shell');
  });

  it('shows the connection status once the server answers', async () => {
    const harness = await RouterTestingHarness.create('/wall');
    const status = () => harness.routeNativeElement?.querySelector('[role=status]')?.textContent;
    expect(status()).toBe('Connecting to the server…');

    TestBed.inject(HttpTestingController).expectOne('/health').flush({ status: 'Healthy', checks: {} });
    await harness.fixture.whenStable();

    expect(status()).toBe('Server connected');
  });
});
