import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CalendarEvent, CalendarStore } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, dayIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { CalendarFilter } from '../shared/calendar-filter';
import { DemoNotice } from '../shared/demo-notice';
import { StatusLine } from '../shared/status-line';
import { WeatherStore } from '../core/weather';
import { PairingScreen } from './pairing-screen';
import { WallView } from './calendar-nav';
import { DayView } from './day-view';
import { EventDialog } from './event-dialog';
import { MonthView } from './month-view';
import { WallWeather } from './wall-weather';
import { WeekView } from './week-view';

/** How long the wall stays on another day or view after the last touch before it goes back to this week. */
export const RETURN_AFTER_MS = 2 * 60_000;

/** How often the wall checks in: it picks up changes from the phones, and the server sees it is still there. */
export const CHECK_IN_EVERY_MS = 5 * 60_000;

/**
 * The wall display's frame: date, clock, a chip per person to filter the calendar, today's
 * weather, the calendar by day, week or month, and connection status. Sized for 1920 × 1080. A display that is not signed in to a family shows a pairing code instead.
 */
@Component({
  selector: 'app-wall-shell',
  imports: [CalendarFilter, DatePipe, DayView, DemoNotice, EventDialog, MonthView, PairingScreen, StatusLine, WallWeather, WeekView],
  template: `
    @if (showPairing()) {
      <app-pairing-screen [cancellable]="pairingChosen()" (paired)="paired()" (cancelled)="pairingChosen.set(false)" />
    } @else {
      <header>
        <div class="now">
          <h1>{{ clock.now() | date: 'EEEE, MMMM d' }}</h1>
          <span class="time">{{ clock.now() | date: 'h:mm a' }}</span>
        </div>
        <app-calendar-filter />
        <app-wall-weather />
      </header>

      @if (family.state().status === 'ready') {
        @switch (view()) {
          @case ('day') {
            <app-day-view [(view)]="view" [(focus)]="focus" (edit)="editEvent($event)" />
          }
          @case ('week') {
            <app-week-view [(view)]="view" [(focus)]="focus" (edit)="editEvent($event)" />
          }
          @case ('month') {
            <app-month-view [(view)]="view" [(focus)]="focus" (opened)="openDay($event)" />
          }
        }
      }

      <footer>
        <div class="status">
          <app-status-line />
          @if (calendar.needsReconnect()) {
            <p class="reconnect" role="alert">
              Google Calendar has stopped updating. A parent can connect it again in Settings on their phone.
            </p>
          }
        </div>
        <div class="demo">
          @if (session.isDemo()) {
            <!-- On the demo the wall starts with a copy of its own; pairing joins the phone's copy. -->
            <button class="pair" type="button" (click)="pairingChosen.set(true)">Pair with a phone</button>
          }
          <app-demo-notice />
          @if (canAdd()) {
            <button class="add" type="button" (click)="addEvent()">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
              Add event
            </button>
          }
        </div>
      </footer>

      @if (editing(); as open) {
        <app-event-dialog [event]="open.event" [day]="open.day" (closed)="editing.set(null)" />
      }
    }
  `,
  host: { '(pointerdown)': 'touched()' },
  styles: `
    :host {
      box-sizing: border-box;
      height: 100vh;
      padding: 28px 36px 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    app-day-view,
    app-week-view,
    app-month-view {
      flex: 1;
    }

    header,
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }

    footer {
      margin-top: auto;
    }

    .now {
      display: flex;
      align-items: baseline;
      gap: 20px;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 52px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .time {
      font-family: var(--font-display);
      font-size: 34px;
      color: var(--muted);
    }

    .status {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .reconnect {
      margin: 0;
      padding: 10px 18px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--warn) 16%, var(--surface));
      color: var(--ink);
      font: 600 17px var(--font-body);
    }

    .demo {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .add {
      min-height: 64px;
      padding: 0 30px;
      border: 0;
      border-radius: 32px;
      background: var(--accent);
      color: #ffffff;
      font: 700 20px var(--font-body);
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
    }

    .pair {
      min-height: 56px;
      padding: 0 24px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--surface);
      color: var(--ink);
      font: 700 18px var(--font-body);
      cursor: pointer;
    }
  `,
})
export class WallShell {
  protected readonly clock = inject(Clock);
  protected readonly family = inject(FamilyStore);
  protected readonly calendar = inject(CalendarStore);
  private readonly weather = inject(WeatherStore);

  protected readonly session = inject(SessionStore);

  /** Which calendar view is on screen, and a day it shows; null means around today. */
  protected readonly view = signal<WallView>('week');
  protected readonly focus = signal<Day | null>(null);

  /** The event being added (no event) or changed in the dialog, or null when it is closed. */
  protected readonly editing = signal<{ event: CalendarEvent | null; day: Day } | null>(null);

  /** Whether any calendar takes new events; a family with none has nothing to add to. */
  protected readonly canAdd = computed(() => this.calendar.calendars().some((calendar) => calendar.canWrite));

  /** A demo visitor asked to pair this wall with their phone. */
  protected readonly pairingChosen = signal(false);

  protected readonly showPairing = computed(
    () => this.pairingChosen() || (this.family.state().status === 'private' && !this.session.isDemoFull()),
  );

  constructor() {
    this.family.load();
    const timer = setInterval(() => {
      this.family.refresh();
      this.weather.refresh();
    }, CHECK_IN_EVERY_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearTimeout(this.idle);
    });
  }

  private idle?: ReturnType<typeof setTimeout>;

  /** Any touch restarts the wait before the wall goes back to this week, so nobody leaves it on next month. */
  protected touched(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.view.set('week');
      this.focus.set(null);
      // Nobody is coming back to a half-typed event.
      this.editing.set(null);
    }, RETURN_AFTER_MS);
  }

  /** A new event goes on the day on screen in the day view, otherwise on today. */
  protected addEvent(): void {
    const family = this.family.family();
    if (family) {
      const day = (this.view() === 'day' && this.focus()) || dayIn(family.timeZone, this.clock.now());
      this.editing.set({ event: null, day });
    }
  }

  protected editEvent(id: string): void {
    const event = this.calendar.allEvents().find((e) => e.id === id);
    if (event) {
      this.editing.set({ event, day: event.startDate ?? dayIn(this.family.family()!.timeZone, event.startsAt!) });
    }
  }

  /** A day tapped in the month opens on its own. */
  protected openDay(day: Day): void {
    this.focus.set(day);
    this.view.set('day');
  }

  /** Signed in now: show the family the display was paired with. */
  protected paired(): void {
    this.pairingChosen.set(false);
    this.family.load();
  }
}

