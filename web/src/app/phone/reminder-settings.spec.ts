import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FamilyStore } from '../core/family';
import { PushBrowser, PushSubscriptionKeys } from '../core/reminders';
import { marlowes } from '../testing/marlowes';
import { ReminderSettingsCard, leadText } from './reminder-settings';

class FakePushBrowser {
  supports = true;
  install = false;
  granted: NotificationPermission = 'default';
  answer: NotificationPermission = 'granted';
  subscription: PushSubscriptionKeys | null = null;
  subscribedWith: string | null = null;

  supported = () => this.supports;
  needsInstall = () => this.install;
  permission = () => this.granted;
  requestPermission = async () => (this.granted = this.answer);
  current = async () => this.subscription;
  subscribe = async (key: string) => {
    this.subscribedWith = key;
    return (this.subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/phone', p256dh: 'p', auth: 'a' });
  };
  unsubscribe = async () => {
    this.subscription = null;
  };
}

describe('ReminderSettingsCard', () => {
  let http: HttpTestingController;
  let browser: FakePushBrowser;

  beforeEach(() => {
    browser = new FakePushBrowser();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PushBrowser, useValue: browser }],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(FamilyStore).load();
    http.expectOne('/api/family').flush(marlowes);
  });

  afterEach(() => http.verify());

  async function open() {
    const fixture = TestBed.createComponent(ReminderSettingsCard);
    const card = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await fixture.whenStable();
    };
    await settle();
    return { card, settle };
  }

  /** The request, once the store's promises have got to it. */
  async function next(url: string, settle: () => Promise<void>): Promise<TestRequest> {
    await settle();
    return http.expectOne(url);
  }

  const button = (card: HTMLElement, label: string) =>
    Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find((b) => (b.querySelector('.name') ?? b).textContent?.trim() === label)!;
  const text = (card: HTMLElement) => card.querySelector('.place')?.textContent?.trim();
  const message = (card: HTMLElement) => card.querySelector('[role=status]')?.textContent?.trim();
  const chosen = (card: HTMLElement) =>
    Array.from(card.querySelectorAll('.person[aria-pressed=true] .name'), (b) => b.textContent?.trim());

  it('turns reminders on for everyone 15 minutes ahead unless chosen otherwise, asking for permission first', async () => {
    const { card, settle } = await open();
    expect(text(card)).toBe('Get a notification on this phone before events start.');
    expect(chosen(card)).toEqual(['Ben', 'Tess', 'Milo']);

    const select = card.querySelector('select')!;
    select.value = '30';
    select.dispatchEvent(new Event('change'));
    button(card, 'Milo').click();
    await settle();
    button(card, 'Turn on reminders').click();

    (await next('/api/reminders/key', settle)).flush({ publicKey: 'server-key' });
    const put = await next('/api/reminders', settle);
    expect(browser.subscribedWith).toBe('server-key');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/phone',
      p256dh: 'p',
      auth: 'a',
      leadMinutes: 30,
      memberIds: ['m1', 'm2'],
    });
    put.flush({ leadMinutes: 30, memberIds: ['m1', 'm2'] });
    await settle();

    expect(text(card)).toBe('This phone is reminded 30 min before events start.');
    expect(message(card)).toBe('Reminders are on. Send a test to see one.');
    expect(chosen(card)).toEqual(['Ben', 'Tess']);
  });

  it('shows what a reminded phone chose, saves a change at once, sends a test and turns off', async () => {
    browser.granted = 'granted';
    browser.subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/phone', p256dh: 'p', auth: 'a' };
    const { card, settle } = await open();
    const current = await next('/api/reminders/current', settle);
    expect(current.request.body).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/phone' });
    current.flush({ leadMinutes: 60, memberIds: ['m3'] });
    await settle();
    expect(text(card)).toBe('This phone is reminded 1 hour before events start.');
    expect(chosen(card)).toEqual(['Milo']);

    button(card, 'Ben').click();
    const put = await next('/api/reminders', settle);
    expect(put.request.body.memberIds).toEqual(['m3', 'm1']);
    put.flush({ leadMinutes: 60, memberIds: ['m3', 'm1'] });
    await settle();
    expect(message(card)).toBe('Saved.');

    button(card, 'Send a test').click();
    (await next('/api/reminders/test', settle)).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(message(card)).toBe('Sent. It should show on this phone in a moment.');

    button(card, 'Turn off').click();
    (await next('/api/reminders/remove', settle)).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(browser.subscription).toBeNull();
    expect(text(card)).toBe('Get a notification on this phone before events start.');
    expect(chosen(card)).toEqual(['Ben', 'Milo']);
  });

  it('says so when notifications are refused, and leaves reminders off', async () => {
    browser.answer = 'denied';
    const { card, settle } = await open();

    button(card, 'Turn on reminders').click();
    await settle();

    expect(text(card)).toBe("Notifications are off for Wheelhouse in this browser's settings. Allow them there to be reminded.");
    expect(message(card)).toBe('Allow notifications for Wheelhouse to be reminded.');
  });

  it('a phone the server forgot is off, and a test that finds it gone says to turn reminders on again', async () => {
    browser.granted = 'granted';
    browser.subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/phone', p256dh: 'p', auth: 'a' };
    const { card, settle } = await open();
    (await next('/api/reminders/current', settle)).flush(null, { status: 404, statusText: 'Not Found' });
    await settle();

    expect(button(card, 'Turn on reminders')).toBeTruthy();
  });

  it('tells an iPhone to add Wheelhouse to the Home Screen, and other browsers without push that they cannot', async () => {
    browser.supports = false;
    browser.install = true;
    const iphone = await open();
    expect(text(iphone.card)).toContain('Add to Home Screen');
    expect(iphone.card.querySelector('button')).toBeNull();

    browser.install = false;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PushBrowser, useValue: browser }],
    });
    http = TestBed.inject(HttpTestingController);
    const other = await open();
    expect(text(other.card)).toBe("This browser can't show reminders. Try Wheelhouse in Chrome, Edge, Firefox or Safari.");
  });

  it('words lead times as the menu does', () => {
    expect([5, 15, 60, 120].map(leadText)).toEqual(['5 min', '15 min', '1 hour', '2 hours']);
  });
});
