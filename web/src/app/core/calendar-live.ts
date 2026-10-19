import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, computed, effect, inject, untracked } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { CalendarStore } from './calendar';
import { FamilyStore } from './family';

/** Injectable boundary for testing the real subscription lifecycle without opening sockets. */
export const CALENDAR_HUB = new InjectionToken<
  () => Pick<
    HubConnection,
    'on' | 'onclose' | 'onreconnecting' | 'onreconnected' | 'start' | 'stop'
  >
>('Calendar hub factory', {
  providedIn: 'root',
  factory: () => () =>
    new HubConnectionBuilder()
      .withUrl('/hubs/calendar')
      .configureLogging(LogLevel.Warning)
      .withAutomaticReconnect()
      .build(),
});

/** One authenticated subscription for the app, independent of route and calendar view. */
@Injectable({ providedIn: 'root' })
export class CalendarLive {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly createHub = inject(CALENDAR_HUB);
  private readonly document = inject(DOCUMENT);

  constructor() {
    const identity = computed(() => this.family.family()?.id ?? null);
    let previous: string | null = null;
    effect((onCleanup) => {
      const id = identity();
      untracked(() => {
        if (previous !== null && previous !== id) this.calendar.reset();
        previous = id;
        if (!id) {
          this.calendar.setConnection('idle');
          return;
        }
        onCleanup(this.subscribe());
      });
    });
  }

  private subscribe(): () => void {
    const connection = this.createHub();
    let active = true;
    let starting = false;
    let revision: number | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    this.calendar.setConnection('connecting');

    const start = async () => {
      if (!active || starting) return;
      starting = true;
      try {
        await connection.start();
        if (active) this.calendar.setConnection('live');
      } catch (error) {
        if (!active) return;
        this.calendar.setConnection('reconnecting');
        // A revoked cookie must return the screen to sign-in/pairing, not keep old data.
        if (
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          (error.statusCode === 401 || error.statusCode === 403)
        ) {
          this.calendar.reset();
          this.family.forget();
          this.family.load();
        }
        clearTimeout(retry);
        retry = setTimeout(() => void start(), 5_000);
      } finally {
        starting = false;
      }
    };

    connection.on('CalendarChanged', (message: { changeNumber: number }) => {
      if (
        !active ||
        !message ||
        !Number.isSafeInteger(message.changeNumber) ||
        message.changeNumber < 0
      )
        return;
      // A revision can also mean a new time zone or calendar ownership. Refresh those labels.
      if (revision !== undefined && message.changeNumber > revision) this.family.refresh();
      revision = Math.max(revision ?? 0, message.changeNumber);
      this.calendar.changed(message.changeNumber);
    });
    connection.onreconnecting(() => {
      if (active) {
        this.calendar.setConnection('reconnecting');
        this.family.refresh();
      }
    });
    connection.onreconnected(() => {
      if (active) this.calendar.setConnection('live');
      // The server sends its current revision on every new connection, including reconnects.
    });
    connection.onclose(() => {
      if (!active) return;
      this.calendar.setConnection('reconnecting');
      this.family.refresh();
      clearTimeout(retry);
      retry = setTimeout(() => void start(), 5_000);
    });

    // Poll only as a fallback; the store retries failed snapshot reads itself.
    const timer = setInterval(() => {
      if (this.calendar.connection() !== 'live') this.calendar.refresh();
    }, 30_000);
    const wake = () => {
      if (this.document.visibilityState === 'visible') {
        this.family.refresh();
        this.calendar.refresh();
      }
    };
    this.document.addEventListener('visibilitychange', wake);
    void start();
    return () => {
      active = false;
      clearTimeout(retry);
      clearInterval(timer);
      this.document.removeEventListener('visibilitychange', wake);
      void connection.stop().catch(() => {});
    };
  }
}
