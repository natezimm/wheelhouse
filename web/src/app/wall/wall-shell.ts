import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { CalendarEvent, CalendarStore } from '../core/calendar';
import { CalendarView, periodOf, stepFrom } from '../core/calendar-period';
import { Clock } from '../core/clock';
import { Day, dayIn, formatDay, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { ViewPreferences } from '../core/view-preferences';
import { WeatherStore } from '../core/weather';
import { CalendarConnection } from '../shared/calendar-connection';
import { CalendarFilter } from '../shared/calendar-filter';
import { CalendarSaveStatus } from '../shared/calendar-save-status';
import { CalendarToolbar } from '../shared/calendar-toolbar';
import { CountdownStrip } from '../shared/countdown-strip';
import { DemoNotice } from '../shared/demo-notice';
import { EventDetails } from '../shared/event-details';
import { DayView } from './day-view';
import { EventDialog } from './event-dialog';
import { MonthView } from './month-view';
import { PairingScreen } from './pairing-screen';
import { WallWeather } from './wall-weather';
import { GridSlot, WeekView } from './week-view';

/** How long the wall stays on another day, week or month after the last touch before it comes back to now. */
export const RETURN_AFTER_MS = 2 * 60_000;

/** How often the wall checks in: it picks up changes from the phones, and the server sees it is still there. */
export const CHECK_IN_EVERY_MS = 5 * 60_000;

/**
 * The wall display: the time, date and family, a chip per person to filter the calendar and
 * today's weather; a toolbar with how up to date the calendar is; then the calendar by day,
 * week or month filling the rest. Sized for 1920 × 1080. A display that is not signed in to a
 * family shows a pairing code instead.
 */
@Component({
  selector: 'app-wall-shell',
  imports: [
    CalendarConnection,
    CalendarFilter,
    CalendarSaveStatus,
    CalendarToolbar,
    CountdownStrip,
    DayView,
    DemoNotice,
    EventDetails,
    EventDialog,
    MonthView,
    PairingScreen,
    WallWeather,
    WeekView,
  ],
  template: `
    @if (showPairing()) {
      <app-pairing-screen [cancellable]="pairingChosen()" (paired)="paired()" (cancelled)="pairingChosen.set(false)" />
    } @else {
      <header>
        <div class="now">
          @if (now(); as now) {
            <span class="clock">{{ now.time }}<span class="meridiem">{{ now.meridiem }}</span></span>
            <span class="date">
              <span class="weekday">{{ now.weekday }}</span>
              <span class="detail">{{ now.date }}@if (family.family(); as f) { · {{ f.name }}}</span>
            </span>
          }
        </div>
        <app-calendar-filter />
        <div class="end">
          <app-wall-weather />
          @if (session.isDemo()) {
            <!-- On the demo the wall starts with a copy of its own; pairing joins the phone's copy. -->
            <div class="demo">
              <span>Demo family</span>
              <button type="button" (click)="pairingChosen.set(true)">Pair with a phone</button>
            </div>
          } @else {
            <app-demo-notice />
          }
        </div>
      </header>
      <!-- Drawn only by a theme that has one: Groovy's three stripes. -->
      <div class="band" aria-hidden="true"><span></span><span></span><span></span></div>

      @if (period(); as period) {
        <app-calendar-toolbar
          layout="wall"
          [view]="view()"
          (viewChange)="choose($event)"
          [period]="period"
          [canAdd]="canAdd()"
          (today)="focus.set(null)"
          (step)="step($event)"
          (add)="addEvent()"
        >
          <app-calendar-connection status layout="wall" />
          <app-countdown-strip extras layout="wall" />
        </app-calendar-toolbar>
      } @else {
        <app-calendar-connection layout="wall" />
      }

      <section class="card" aria-label="Calendar">
        @if (family.state().status === 'ready') {
          @switch (view()) {
            @case ('day') {
              <app-day-view
                [focus]="focus()"
                layout="wall"
                [selected]="selected()"
                [canAdd]="canAdd()"
                (inspect)="selected.set($event)"
                (create)="addAt($event)"
              />
            }
            @case ('week') {
              <app-week-view
                [focus]="focus()"
                layout="wall"
                [selected]="selected()"
                [canAdd]="canAdd()"
                (inspect)="selected.set($event)"
                (openDay)="openDay($event)"
                (create)="addAt($event)"
              />
            }
            @case ('month') {
              <app-month-view [focus]="focus()" (opened)="openDay($event)" />
            }
          }
        }
        <app-calendar-save-status class="toast" />
        @if (selected(); as id) {
          <app-event-details [eventId]="id" layout="wall" (closed)="selected.set(null)" (edit)="editEvent($event)" (remove)="editEvent($event, true)" />
        }
      </section>

      @if (editing(); as open) {
        <app-event-dialog [event]="open.event" [day]="open.day" [at]="open.at" [deleting]="open.deleting" (closed)="editing.set(null)" />
      }
    }
  `,
  host: { '(pointerdown)': 'touched()' },
  styles: `
    :host {
      box-sizing: border-box;
      height: 100vh;
      padding: 22px 32px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    header {
      height: 72px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 32px;
    }

    .now {
      min-width: 430px;
      display: flex;
      align-items: center;
      gap: 18px;
    }

    .clock {
      font-family: var(--font-display);
      font-size: 64px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      letter-spacing: -0.03em;
      line-height: 1;
      white-space: nowrap;
    }

    .meridiem {
      margin-left: 6px;
      font-size: 24px;
      font-weight: 500;
      letter-spacing: 0;
      color: var(--muted);
    }

    .date {
      padding-left: 18px;
      border-left: var(--control-border);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .weekday {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      line-height: 1.1;
    }

    .detail {
      font-size: 18px;
      font-weight: 500;
      color: var(--muted);
      white-space: nowrap;
    }

    app-calendar-filter {
      flex: 1;
      min-width: 0;
      justify-content: center;
    }

    .end {
      min-width: 330px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 20px;
    }

    .demo {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 0 0 18px;
      border: var(--track-border);
      border-radius: var(--pill);
      background: var(--track);
      color: var(--muted);
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
    }

    .demo button {
      min-height: 56px;
      padding: 0 22px;
      border: 0;
      border-radius: var(--pill);
      background: var(--segment);
      box-shadow: var(--raised);
      color: var(--on-segment);
      font: 700 16px var(--font-body);
      cursor: pointer;
    }

    app-calendar-toolbar {
      height: 64px;
      flex-shrink: 0;
    }

    /* Countdowns give way, ending their titles early, before the controls or a connection problem do. */
    app-countdown-strip {
      flex: 0 1000 auto;
      min-width: 0;
      max-width: 44%;
      margin-right: 8px;
    }

    /* The calendar fills its card edge to edge, unlike the forms' cards. */
    .card {
      position: relative;
      flex: 1;
      min-height: 0;
      padding: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border: var(--card-border);
      border-radius: var(--card-radius);
      background: var(--surface);
      box-shadow: var(--card-shadow);
    }

    .band {
      flex-shrink: 0;
      margin-top: -4px;
      display: var(--band-display);
      flex-direction: column;
      gap: 3px;
    }

    .band span {
      height: 5px;
      border-radius: 3px;
      background: var(--band-1);
    }

    .band span:nth-child(2) {
      background: var(--band-2);
    }

    .band span:nth-child(3) {
      background: var(--band-3);
    }

    app-day-view,
    app-week-view,
    app-month-view {
      flex: 1;
    }

    /* Save feedback floats over the bottom of the calendar instead of taking a footer. */
    .toast {
      position: absolute;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      z-index: 2;
    }
  `,
})
export class WallShell {
  protected readonly clock = inject(Clock);
  protected readonly family = inject(FamilyStore);
  protected readonly calendar = inject(CalendarStore);
  protected readonly session = inject(SessionStore);
  private readonly weather = inject(WeatherStore);
  private readonly preferences = inject(ViewPreferences);

  /** Which view is on screen, the one the wall had last, and a day it shows; null means around today. */
  protected readonly view = signal<CalendarView>(this.preferences.view('wall'));
  protected readonly focus = signal<Day | null>(null);

  /** The event whose details are open, by id. */
  protected readonly selected = signal<string | null>(null);

  /** The event being added (no event) or changed in the dialog, or null when it is closed. */
  protected readonly editing = signal<{ event: CalendarEvent | null; day: Day; at: string | null; deleting: boolean } | null>(null);
  private readonly dialog = viewChild(EventDialog);
  private readonly week = viewChild(WeekView);
  private readonly dayView = viewChild(DayView);

  /** Whether any calendar takes new events; a family with none has nothing to add to. */
  protected readonly canAdd = computed(() => this.calendar.calendars().some((calendar) => calendar.canWrite));

  /** A demo visitor asked to pair this wall with their phone. */
  protected readonly pairingChosen = signal(false);

  protected readonly showPairing = computed(
    () => this.pairingChosen() || (this.family.state().status === 'private' && !this.session.isDemoFull()),
  );

  private readonly today = computed(() => {
    const family = this.family.family();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  /** The time and date in the family's zone, not the display's. */
  protected readonly now = computed(() => {
    const family = this.family.family();
    const today = this.today();
    if (!family || !today) {
      return null;
    }
    const [time, meridiem] = timeIn(family.timeZone, this.clock.now()).split(/\s/);
    return {
      time,
      meridiem,
      weekday: formatDay(today, { weekday: 'long' }),
      date: formatDay(today, { month: 'long', day: 'numeric' }),
    };
  });

  protected readonly period = computed(() => {
    const family = this.family.family();
    const today = this.today();
    return family && today ? periodOf(this.view(), this.focus() ?? today, today, family.weekStartsOn) : null;
  });

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

  /** Any touch restarts the wait before the wall comes back to now, so nobody leaves it on next month. */
  protected touched(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.returnToNow(), RETURN_AFTER_MS);
  }

  /**
   * Keeps the view but shows the current day, week or month again, scrolled to now, with any
   * details closed. An editor closes only if nothing in it has changed and no save is still
   * going, so a half-typed event is never lost.
   */
  private returnToNow(): void {
    this.focus.set(null);
    this.selected.set(null);
    this.week()?.scrollToNow();
    this.dayView()?.scrollToNow();
    if (this.editing() && !this.dialog()?.holdsWork() && this.calendar.pending().length === 0) {
      this.editing.set(null);
    }
  }

  protected choose(view: CalendarView): void {
    this.view.set(view);
    this.preferences.remember('wall', view);
  }

  protected step(by: number): void {
    const today = this.today();
    if (today) {
      this.focus.set(stepFrom(this.view(), this.focus() ?? today, by));
    }
  }

  /** A new event goes on the day on screen in the day view, otherwise on today. */
  protected addEvent(): void {
    const today = this.today();
    if (today) {
      this.editing.set({ event: null, day: (this.view() === 'day' && this.focus()) || today, at: null, deleting: false });
    }
  }

  /** An empty half hour tapped on the grid starts a new event there. */
  protected addAt(slot: GridSlot): void {
    this.editing.set({ event: null, day: slot.day, at: slot.time, deleting: false });
  }

  /** Edit or Delete in an event's details opens the editor, which asks first before deleting. */
  protected editEvent(event: CalendarEvent, deleting = false): void {
    this.selected.set(null);
    this.editing.set({ event, day: event.startDate ?? dayIn(this.family.family()!.timeZone, event.startsAt!), at: null, deleting });
  }

  /** A day tapped in the month or the week opens on its own. */
  protected openDay(day: Day): void {
    this.selected.set(null);
    this.focus.set(day);
    this.choose('day');
  }

  /** Signed in now: show the family the display was paired with. */
  protected paired(): void {
    this.pairingChosen.set(false);
    this.family.load();
  }
}
