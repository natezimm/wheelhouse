import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { marlowes } from '../testing/marlowes';

describe('MemberEditor', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    // Settings, where a saved change returns to, also loads the family's displays.
    http.match('/api/devices');
    http.match('/api/calendar/google');
    http.verify();
  });

  /** Opens the editor at a URL with the family loaded. */
  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    http.expectOne('/api/family').flush(marlowes);
    await harness.fixture.whenStable();
    const page = harness.routeNativeElement as HTMLElement;
    return { page, settle: () => harness.fixture.whenStable() };
  }

  const nameField = (page: HTMLElement) => page.querySelector<HTMLInputElement>('[formControlName=displayName]')!;
  // A swatch is found by its color's name: Angular keeps a bound radio's value on the form
  // control, not on the element, so there is no value to select by.
  const swatch = (page: HTMLElement, colorName: string) =>
    Array.from(page.querySelectorAll('.swatch'))
      .find((label) => label.textContent?.trim() === colorName)!
      .querySelector<HTMLInputElement>('input')!;
  const role = (page: HTMLElement, value: string) =>
    page.querySelector<HTMLInputElement>(`input[type=radio][value=${value}]`)!;
  const picture = (page: HTMLElement, name: string) =>
    Array.from(page.querySelectorAll('.picture'))
      .find((label) => label.textContent?.trim().endsWith(name))!
      .querySelector<HTMLInputElement>('input')!;
  const preview = (page: HTMLElement) => page.querySelector('.preview')!;
  const submit = (page: HTMLElement) => page.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const button = (page: HTMLElement, label: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label)!;
  const alert = (page: HTMLElement) => page.querySelector('[role=alert]')?.textContent;

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  describe('adding', () => {
    it('needs a name and a color before it can be added', async () => {
      const { page, settle } = await open('/settings/members/new');
      expect(submit(page).disabled).toBe(true);

      type(nameField(page), '   ');
      swatch(page, 'Purple').click();
      await settle();
      expect(submit(page).disabled).toBe(true);

      type(nameField(page), 'Ada');
      await settle();
      expect(submit(page).disabled).toBe(false);
    });

    it('adds the member as a kid by default and returns to Settings', async () => {
      const { page, settle } = await open('/settings/members/new');
      type(nameField(page), ' Ada ');
      swatch(page, 'Purple').click();
      await settle();

      submit(page).click();
      const request = http.expectOne({ method: 'POST', url: '/api/family/members' });
      expect(request.request.body).toEqual({ displayName: 'Ada', color: '#7243B8', role: 'Kid', avatar: null });
      request.flush({ id: 'm4', displayName: 'Ada', color: '#7243B8', initial: 'A', role: 'Kid' });
      await settle();

      expect(router.url).toBe('/settings');
    });
  });

  describe('editing', () => {
    it('starts from the member as they are', async () => {
      const { page } = await open('/settings/members/m3');

      expect(nameField(page).value).toBe('Milo');
      expect(swatch(page, 'Teal').checked).toBe(true);
      expect(role(page, 'Kid').checked).toBe(true);
    });

    it('saves a new name, color and role and returns to Settings', async () => {
      const { page, settle } = await open('/settings/members/m3');
      type(nameField(page), 'Miles');
      swatch(page, 'Magenta').click();
      role(page, 'Parent').click();
      await settle();

      submit(page).click();
      const request = http.expectOne({ method: 'PUT', url: '/api/family/members/m3' });
      expect(request.request.body).toEqual({ displayName: 'Miles', color: '#A8326E', role: 'Parent', avatar: null });
      request.flush({ id: 'm3', displayName: 'Miles', color: '#A8326E', initial: 'M', role: 'Parent' });
      await settle();

      expect(router.url).toBe('/settings');
    });

    it('gives the member a picture, previewed on their color', async () => {
      const { page, settle } = await open('/settings/members/m3');
      expect(picture(page, 'Initial').checked).toBe(true);
      expect(preview(page).textContent?.trim()).toBe('M');

      picture(page, 'Owl').click();
      await settle();
      expect(preview(page).querySelector('img')?.getAttribute('src')).toBe('/avatars/owl.svg');

      submit(page).click();
      const request = http.expectOne({ method: 'PUT', url: '/api/family/members/m3' });
      expect(request.request.body).toEqual({ displayName: 'Milo', color: '#137A6D', role: 'Kid', avatar: 'owl' });
      request.flush({ ...marlowes.members[2], avatar: 'owl' });
      await settle();

      expect(router.url).toBe('/settings');
    });

    it('starts from the picture the member has, and can go back to the initial', async () => {
      const harness = await RouterTestingHarness.create('/settings/members/m3');
      http
        .expectOne('/api/family')
        .flush({ ...marlowes, members: marlowes.members.map((m) => (m.id === 'm3' ? { ...m, avatar: 'frog' } : m)) });
      await harness.fixture.whenStable();
      const page = harness.routeNativeElement as HTMLElement;
      expect(picture(page, 'Frog').checked).toBe(true);

      picture(page, 'Initial').click();
      await harness.fixture.whenStable();
      submit(page).click();
      const request = http.expectOne({ method: 'PUT', url: '/api/family/members/m3' });
      expect(request.request.body.avatar).toBeNull();
      request.flush(marlowes.members[2]);
      await harness.fixture.whenStable();
    });

    it('removes the member only after a second, explicit tap', async () => {
      const { page, settle } = await open('/settings/members/m3');

      button(page, 'Remove from family').click();
      await settle();
      http.expectNone({ method: 'DELETE' });
      expect(page.querySelector('.confirm span')?.textContent).toBe('Remove Milo from the family?');

      button(page, 'Remove').click();
      http.expectOne({ method: 'DELETE', url: '/api/family/members/m3' }).flush(null);
      await settle();

      expect(router.url).toBe('/settings');
    });

    it('backs out of removing when asked to keep the member', async () => {
      const { page, settle } = await open('/settings/members/m3');
      button(page, 'Remove from family').click();
      await settle();

      button(page, 'Keep').click();
      await settle();

      expect(page.querySelector('.confirm')).toBeNull();
      expect(router.url).toBe('/settings/members/m3');
    });

    it('stays put and says why when the server refuses', async () => {
      const { page, settle } = await open('/settings/members/m1');
      button(page, 'Remove from family').click();
      await settle();

      button(page, 'Remove').click();
      http
        .expectOne({ method: 'DELETE', url: '/api/family/members/m1' })
        .flush({ errors: { role: ['A family needs at least one parent.'] } }, { status: 400, statusText: 'Bad Request' });
      await settle();

      expect(alert(page)).toBe('A family needs at least one parent.');
      expect(router.url).toBe('/settings/members/m1');
    });

    it('says so when the member no longer exists', async () => {
      const { page } = await open('/settings/members/gone');

      expect(page.querySelector('.notice')?.textContent).toBe('That family member is no longer here.');
      expect(page.querySelector('form')).toBeNull();
    });
  });
});
