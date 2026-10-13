import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { Family } from './core/family';

const marlowes: Family = {
  id: 'f1',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  members: [
    { id: 'm1', displayName: 'Ben', color: '#2F5FC4', initial: 'B', role: 'Parent' },
    { id: 'm2', displayName: 'Tess', color: '#B85A14', initial: 'T', role: 'Parent' },
    { id: 'm3', displayName: 'Milo', color: '#137A6D', initial: 'M', role: 'Kid' },
  ],
};

describe('routes', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
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

  it('names each family member on the phone', async () => {
    const { page, settle } = await open('/');

    http.expectOne('/api/family').flush(marlowes);
    await settle();

    expect(text(page.querySelectorAll('.members .name'))).toEqual(['Ben', 'Tess', 'Milo']);
  });

  it('says the instance is private when nobody is signed in', async () => {
    const { page, settle } = await open('/wall');

    http.expectOne('/api/family').flush(null, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(page.querySelector('.private')?.textContent).toBe('This Wheelhouse is private.');
    expect(page.querySelectorAll('.members li').length).toBe(0);
  });

  it('shows the demo notice only on a demo instance', async () => {
    const { page, settle } = await open('/wall');
    const notice = () => page.querySelector('app-demo-notice')?.textContent?.trim();
    expect(notice()).toBe('');

    http.expectOne('/api/session').flush({ mode: 'Demo', signedIn: true });
    await settle();

    expect(notice()).toBe('Demo · a fictional family, reset every night');
  });

  it('shows no demo notice on a family instance', async () => {
    const { page, settle } = await open('/wall');

    http.expectOne('/api/session').flush({ mode: 'Family', signedIn: false });
    await settle();

    expect(page.querySelector('app-demo-notice')?.textContent?.trim()).toBe('');
  });
});
