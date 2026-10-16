import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CalendarStore } from '../core/calendar';
import { Clock } from '../core/clock';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { CalendarFilter } from '../shared/calendar-filter';
import { DemoNotice } from '../shared/demo-notice';
import { StatusLine } from '../shared/status-line';
import { WeatherStore } from '../core/weather';
import { PairingScreen } from './pairing-screen';
import { WallWeather } from './wall-weather';
import { WeekView } from './week-view';

/** How often the wall checks in: it picks up changes from the phones, and the server sees it is still there. */
export const CHECK_IN_EVERY_MS = 5 * 60_000;

/**
 * The wall display's frame: date, clock, a chip per person to filter the week's calendar,
 * today's weather, and connection status. Sized
 * for 1920 × 1080. A display that is not signed in to a family shows a pairing code instead.
 */
@Component({
  selector: 'app-wall-shell',
  imports: [CalendarFilter, DatePipe, DemoNotice, PairingScreen, StatusLine, WallWeather, WeekView],
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
        <app-week-view />
      }

      <footer>
        <app-status-line />
        <div class="demo">
          @if (session.isDemo()) {
            <!-- On the demo the wall starts with a copy of its own; pairing joins the phone's copy. -->
            <button class="pair" type="button" (click)="pairingChosen.set(true)">Pair with a phone</button>
          }
          <app-demo-notice />
        </div>
      </footer>
    }
  `,
  styles: `
    :host {
      box-sizing: border-box;
      height: 100vh;
      padding: 28px 36px 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    app-week-view {
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

    .demo {
      display: flex;
      align-items: center;
      gap: 16px;
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
  private readonly calendar = inject(CalendarStore);
  private readonly weather = inject(WeatherStore);

  protected readonly session = inject(SessionStore);

  /** A demo visitor asked to pair this wall with their phone. */
  protected readonly pairingChosen = signal(false);

  protected readonly showPairing = computed(
    () => this.pairingChosen() || (this.family.state().status === 'private' && !this.session.isDemoFull()),
  );

  constructor() {
    this.family.load();
    const timer = setInterval(() => {
      this.family.refresh();
      this.calendar.refresh();
      this.weather.refresh();
    }, CHECK_IN_EVERY_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Signed in now: show the family the display was paired with. */
  protected paired(): void {
    this.pairingChosen.set(false);
    this.family.load();
  }
}
