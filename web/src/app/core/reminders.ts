import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** How long before an event this browser may be reminded, in minutes, as the API accepts. */
export const LEAD_CHOICES = [5, 10, 15, 30, 60, 120] as const;

/** The service worker that shows reminders and opens the event when one is tapped (public/push-worker.js). */
export const PUSH_WORKER_URL = '/push-worker.js';

export interface ReminderSettings {
  leadMinutes: number;
  /** Whose events; the whole family's always come too. */
  memberIds: string[];
}

export type RemindersState =
  | { status: 'loading' }
  /** This browser cannot be sent pushes. */
  | { status: 'unsupported' }
  /** An iPhone or iPad only takes pushes for a site added to its Home Screen. */
  | { status: 'install' }
  /** The person said no to notifications for this site; only the browser's settings can undo that. */
  | { status: 'blocked' }
  | { status: 'off' }
  | { status: 'on'; settings: ReminderSettings };

/** The parts of a browser's push subscription the API needs. */
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * The browser's notification and push APIs, behind a seam so the store can be tested without
 * them (jsdom has none).
 */
@Injectable({ providedIn: 'root' })
export class PushBrowser {
  supported(): boolean {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  /** An iPhone or iPad browsing the site, rather than running it from the Home Screen. */
  needsInstall(): boolean {
    if (typeof navigator === 'undefined') return false;
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installed = (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || (navigator as { standalone?: boolean }).standalone === true;
    return apple && !installed;
  }

  permission(): NotificationPermission {
    return Notification.permission;
  }

  requestPermission(): Promise<NotificationPermission> {
    return Notification.requestPermission();
  }

  private async registration(): Promise<ServiceWorkerRegistration> {
    await navigator.serviceWorker.register(PUSH_WORKER_URL);
    return navigator.serviceWorker.ready;
  }

  async current(): Promise<PushSubscriptionKeys | null> {
    const subscription = await (await this.registration()).pushManager.getSubscription();
    return subscription && keysOf(subscription);
  }

  /** Subscribes with the server's key, replacing a subscription made with another key. */
  async subscribe(publicKey: string): Promise<PushSubscriptionKeys> {
    const push = (await this.registration()).pushManager;
    const options = { userVisibleOnly: true, applicationServerKey: bytesOf(publicKey) };
    try {
      return keysOf(await push.subscribe(options));
    } catch (error) {
      const old = await push.getSubscription();
      if (!old) throw error;
      await old.unsubscribe();
      return keysOf(await push.subscribe(options));
    }
  }

  async unsubscribe(): Promise<void> {
    await (await (await this.registration()).pushManager.getSubscription())?.unsubscribe();
  }
}

function keysOf(subscription: PushSubscription): PushSubscriptionKeys {
  const json = subscription.toJSON();
  return { endpoint: subscription.endpoint, p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' };
}

function bytesOf(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Whether this browser is reminded before events, and of whose. Each browser chooses for itself:
 * the server keeps its push subscription with its lead time and people.
 */
@Injectable({ providedIn: 'root' })
export class ReminderStore {
  private readonly http = inject(HttpClient);
  private readonly browser = inject(PushBrowser);
  private readonly current = signal<RemindersState>({ status: 'loading' });
  private subscription: PushSubscriptionKeys | null = null;

  readonly state = this.current.asReadonly();

  async load(): Promise<void> {
    if (!this.browser.supported()) {
      this.current.set({ status: this.browser.needsInstall() ? 'install' : 'unsupported' });
      return;
    }
    if (this.browser.permission() === 'denied') {
      this.current.set({ status: 'blocked' });
      return;
    }
    try {
      this.subscription = await this.browser.current();
      if (!this.subscription || this.browser.permission() !== 'granted') {
        this.current.set({ status: 'off' });
        return;
      }
      const settings = await firstValueFrom(this.http.post<ReminderSettings>('/api/reminders/current', { endpoint: this.subscription.endpoint }));
      this.current.set({ status: 'on', settings });
    } catch {
      // 404: the server forgot this browser, or it signed in to another family.
      this.current.set({ status: 'off' });
    }
  }

  /** Asks for permission if need be, subscribes, and tells the server what to remind of. */
  async turnOn(settings: ReminderSettings): Promise<void> {
    if ((await this.browser.requestPermission()) !== 'granted') {
      this.current.set({ status: this.browser.permission() === 'denied' ? 'blocked' : 'off' });
      throw new ReminderError('Allow notifications for Wheelhouse to be reminded.');
    }
    try {
      const { publicKey } = await firstValueFrom(this.http.get<{ publicKey: string }>('/api/reminders/key'));
      this.subscription = await this.browser.subscribe(publicKey);
    } catch (error) {
      if (error instanceof HttpErrorResponse) throw new ReminderError('Could not reach Wheelhouse. Try again in a moment.');
      throw new ReminderError('This browser could not turn on notifications. Try again in a moment.');
    }
    await this.save(settings);
  }

  /** Changes the lead time or people of a browser already reminded. */
  async save(settings: ReminderSettings): Promise<void> {
    const subscription = this.subscription;
    if (!subscription) throw new ReminderError('Turn reminders on first.');
    try {
      const saved = await firstValueFrom(this.http.put<ReminderSettings>('/api/reminders', { ...subscription, ...settings }));
      this.current.set({ status: 'on', settings: saved });
    } catch {
      throw new ReminderError('Could not save the reminders. Try again in a moment.');
    }
  }

  async turnOff(): Promise<void> {
    const subscription = this.subscription;
    try {
      if (subscription) await firstValueFrom(this.http.post<void>('/api/reminders/remove', { endpoint: subscription.endpoint }));
    } catch {
      throw new ReminderError('Could not turn the reminders off. Try again in a moment.');
    }
    this.subscription = null;
    this.current.set({ status: 'off' });
    await this.browser.unsubscribe().catch(() => undefined);
  }

  /** Sends one reminder now, so the person sees what they look like on this phone. */
  async test(): Promise<void> {
    const subscription = this.subscription;
    if (!subscription) return;
    try {
      await firstValueFrom(this.http.post<void>('/api/reminders/test', { endpoint: subscription.endpoint }));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.subscription = null;
        this.current.set({ status: 'off' });
        throw new ReminderError('This phone stopped taking notifications. Turn reminders on again.');
      }
      throw new ReminderError('The reminder did not go out. Try again in a moment.');
    }
  }
}

/** A failure worded for the person, shown under the reminder settings. */
export class ReminderError extends Error {}
