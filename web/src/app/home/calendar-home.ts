import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CalendarEvent, CalendarStore } from '../core/calendar';
import { CalendarView, VIEWS, periodOf, stepFrom } from '../core/calendar-period';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay } from '../core/days';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { ViewPreferences } from '../core/view-preferences';
import { WeatherStore } from '../core/weather';
import { EventSheet } from '../phone/event-sheet';
import { PhoneNav } from '../phone/phone-nav';
import { SignIn } from '../phone/sign-in';
import { CalendarConnection } from '../shared/calendar-connection';
import { CalendarFilter } from '../shared/calendar-filter';
import { CalendarSaveStatus } from '../shared/calendar-save-status';
import { CalendarToolbar } from '../shared/calendar-toolbar';
import { DemoNotice } from '../shared/demo-notice';
import { EventDetails } from '../shared/event-details';
import { WeatherIcon } from '../shared/weather-icon';
import { DayView } from '../wall/day-view';
import { EventDialog } from '../wall/event-dialog';
import { MonthView } from '../wall/month-view';
import { GridSlot, WeekView } from '../wall/week-view';
import { PhoneDay } from './phone-day';
import { PhoneMonth } from './phone-month';
import { PhoneWeek } from './phone-week';

/** From this width the calendar is laid out for a desktop window rather than a phone. */
export const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * The calendar at <code>/</code>, for phones and desktop browsers alike. Below 768 px: a header,
 * the view switch, the view, and tabs along the bottom. From 768 px: a rail on the left, a
 * toolbar and the calendar in a card. The layout follows the window without changing the
 * route, and keeps the date, filters and any open editor as it does.
 */
@Component({
  selector: 'app-calendar-home',
  imports: [
    CalendarConnection,
    CalendarFilter,
    CalendarSaveStatus,
    CalendarToolbar,
    DayView,
    DemoNotice,
    EventDetails,
    EventDialog,
    EventSheet,
    MonthView,
    PhoneDay,
    PhoneMonth,
    PhoneNav,
    PhoneWeek,
    RouterLink,
    RouterLinkActive,
    SignIn,
    WeatherIcon,
    WeekView,
  ],
  host: { '[class.wide]': 'wide()' },
  template: `
    @if (wide()) {
      <nav class="rail" aria-label="Sections">
        <span class="mark" aria-hidden="true">W</span>
        <a routerLink="/" routerLinkActive="current" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path></svg>
          Calendar
        </a>
        <a routerLink="/settings">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"></path></svg>
          Settings
        </a>
        <app-demo-notice class="demo" [short]="true" />
      </nav>
    }

    <main>
      @if (signingIn()) {
        <app-sign-in [outcome]="signin()" />
      } @else if (wide()) {
        @if (period(); as period) {
          <app-calendar-toolbar [view]="view()" (viewChange)="choose($event)" [period]="period" [canAdd]="canAdd()" (today)="focus.set(null)" (step)="step($event)" (add)="add()">
            <app-calendar-connection status layout="desktop" />
            <div class="extras" extras>
              <app-calendar-filter [avatars]="true" />
              @if (weather.weather(); as today) {
                <span class="weather" [title]="today.description">
                  <app-weather-icon [icon]="today.icon" />{{ today.temperature }}°
                </span>
              }
            </div>
          </app-calendar-toolbar>
        } @else {
          <app-calendar-connection layout="desktop" />
        }
        <section class="card" aria-label="Calendar">
          @if (shown(); as day) {
            @switch (view()) {
              @case ('day') {
                <app-day-view
                  [focus]="day"
                  layout="desktop"
                  [selected]="selected()"
                  [canAdd]="canAdd()"
                  (inspect)="selected.set($event)"
                  (create)="addAt($event)"
                />
              }
              @case ('week') {
                <app-week-view
                  [focus]="day"
                  layout="desktop"
                  [selected]="selected()"
                  [canAdd]="canAdd()"
                  (inspect)="selected.set($event)"
                  (openDay)="openDay($event)"
                  (create)="addAt($event)"
                />
              }
              @case ('month') {
                <app-month-view [focus]="day" layout="desktop" (opened)="openDay($event)" />
              }
            }
          }
          <app-calendar-save-status class="toast" />
          @if (selected(); as id) {
            <app-event-details [eventId]="id" layout="desktop" (closed)="selected.set(null)" (edit)="edit($event)" (remove)="edit($event, true)" />
          }
        </section>
      } @else {
        <header>
          <div class="title">
            <span class="subtitle"><app-calendar-connection layout="phone" show="live" /><span class="text">{{ heading().subtitle }}</span></span>
            <h1>{{ heading().title }}</h1>
          </div>
          @if (period(); as period) {
            <!-- The day's week strip already leads back to today. -->
            @if (!period.isCurrent && view() !== 'day') {
              <button type="button" class="today" (click)="focus.set(null)">Today</button>
            }
            <button type="button" class="arrow" [attr.aria-label]="'Previous ' + period.unit" (click)="step(-1)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
            </button>
            <button type="button" class="arrow" [attr.aria-label]="'Next ' + period.unit" (click)="step(1)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
            </button>
          }
          @if (canAdd()) {
            <button type="button" class="add" aria-label="Add event" (click)="add()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
            </button>
          }
        </header>

        <app-calendar-connection layout="phone" show="problems" />

        @if (shown(); as day) {
          <div class="view-switch" role="group" aria-label="View">
            @for (option of views; track option.view) {
              <button type="button" [attr.aria-pressed]="view() === option.view" (click)="choose(option.view)">{{ option.label }}</button>
            }
          </div>
          @switch (view()) {
            @case ('day') {
              <app-phone-day [focus]="day" (pick)="focus.set($event)" (inspect)="selected.set($event)" (add)="add()" />
            }
            @case ('week') {
              <app-phone-week [focus]="day" (inspect)="selected.set($event)" />
            }
            @case ('month') {
              <app-phone-month [focus]="day" (pick)="focus.set($event)" (openDay)="openDay($event)" (inspect)="selected.set($event)" />
            }
          }
        }

        <app-demo-notice class="demo" />
        <app-calendar-save-status class="toast" />
      }
    </main>

    @if (!wide()) {
      <app-phone-nav />
      @if (selected(); as id) {
        <app-event-details [eventId]="id" layout="phone" (closed)="selected.set(null)" (edit)="edit($event)" (remove)="edit($event, true)" />
      }
    }

    @if (editing(); as open) {
      @if (open.wide) {
        <app-event-dialog [event]="open.event" [day]="open.day" [at]="open.at" [deleting]="open.deleting" (closed)="editing.set(null)" />
      } @else {
        <app-event-sheet [event]="open.event" [day]="open.day" [at]="open.at" [deleting]="open.deleting" (closed)="editing.set(null)" />
      }
    }
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    main {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      padding: 18px 16px 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    app-sign-in {
      margin: auto 0;
    }

    /* The phone. */
    header {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .title {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .subtitle {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
    }

    .subtitle .text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 32px;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    header button {
      flex-shrink: 0;
      height: 44px;
      border: 0;
      border-radius: 22px;
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .arrow {
      width: 44px;
      background: transparent;
    }

    .today {
      padding: 0 14px;
      border: 1px solid var(--line) !important;
      background: var(--surface);
      font: 700 14px var(--font-body);
    }

    .add {
      width: 44px;
      margin-left: 2px;
      background: var(--ink) !important;
      color: var(--on-ink) !important;
    }

    .view-switch {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .subtitle app-calendar-connection {
      flex-shrink: 0;
    }

    .demo {
      align-self: flex-start;
      margin: 4px 0 20px;
    }

    main > .toast {
      position: fixed;
      left: 16px;
      right: 16px;
      bottom: 92px;
      z-index: 4;
      display: flex;
      justify-content: center;
    }

    /* A desktop window: rail, toolbar and the calendar in a card that fills the rest. */
    :host(.wide) {
      height: 100vh;
      flex-direction: row;
    }

    :host(.wide) main {
      min-height: 0;
      padding: 16px 20px 18px 4px;
    }

    .rail {
      width: 76px;
      flex-shrink: 0;
      box-sizing: border-box;
      padding: 18px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .rail .mark {
      width: 40px;
      height: 40px;
      margin-bottom: 14px;
      border-radius: 12px;
      background: var(--ink);
      color: var(--on-ink);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: 700;
    }

    .rail a {
      width: 60px;
      height: 56px;
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: var(--quiet);
      font-size: 11px;
      font-weight: 600;
      text-decoration: none;
    }

    .rail a.current {
      background: var(--surface);
      box-shadow: var(--raised);
      color: var(--ink);
      font-weight: 700;
    }

    .rail .demo {
      margin: auto 0 0;
      align-self: center;
    }

    app-calendar-toolbar {
      min-height: 48px;
      flex-shrink: 0;
    }

    .extras {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-right: 10px;
    }

    .weather {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 15px;
      font-weight: 600;
      color: var(--notice-ink);
    }

    .weather app-weather-icon {
      width: 24px;
      height: 24px;
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
      border-radius: 22px;
      background: var(--surface);
      box-shadow: var(--card-shadow);
    }

    .card app-day-view,
    .card app-week-view,
    .card app-month-view {
      flex: 1;
    }

    .card .toast {
      position: absolute;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      z-index: 2;
    }

    /* Narrow desktop windows drop the weather before anything else. */
    @media (max-width: 1100px) {
      .weather {
        display: none;
      }
    }
  `,
})
export class CalendarHome {
  protected readonly calendar = inject(CalendarStore);
  protected readonly family = inject(FamilyStore);
  protected readonly session = inject(SessionStore);
  protected readonly weather = inject(WeatherStore);
  private readonly clock = inject(Clock);
  private readonly preferences = inject(ViewPreferences);

  protected readonly views = VIEWS;

  /** Set by the API when Google sent someone back without signing them in: refused or failed. */
  readonly signin = input<string>();

  private readonly media = typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null;

  /** Whether the window is desktop width. It follows resizing; the view does not. */
  protected readonly wide = signal(!!this.media?.matches);

  /** The view: the one this context had last, Day on a phone and Week on a desktop the first time. */
  protected readonly view = signal<CalendarView>(this.preferences.view(this.wide() ? 'desktop' : 'phone'));

  /** A day the view shows; null means around today. */
  protected readonly focus = signal<Day | null>(null);

  /** The event whose details are open, by id: a drawer on a desktop, a sheet on a phone. */
  protected readonly selected = signal<string | null>(null);

  /** The event being added (no event) or changed, and whether it opened in the desktop editor. */
  protected readonly editing = signal<{ event: CalendarEvent | null; day: Day; wide: boolean; at: string | null; deleting: boolean } | null>(null);

  protected readonly canAdd = computed(() => this.calendar.calendars().some((calendar) => calendar.canWrite));

  protected readonly signingIn = computed(() => this.family.state().status === 'private' && !this.session.isDemoFull());

  private readonly today = computed(() => {
    const family = this.family.family();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  /** The day in view, once the family's zone is known. */
  protected readonly shown = computed(() => (this.family.state().status === 'ready' ? (this.focus() ?? this.today()) : null));

  protected readonly period = computed(() => {
    const family = this.family.family();
    const today = this.today();
    const day = this.shown();
    return family && today && day ? periodOf(this.view(), day, today, family.weekStartsOn) : null;
  });

  /** The phone's header: "Today" or the date, with the date and today's weather above it. */
  protected readonly heading = computed(() => {
    const period = this.period();
    const day = this.shown();
    if (!period || !day) {
      return { title: 'Calendar', subtitle: '' };
    }
    const today = this.today();
    const weather = this.weather.weather();
    const current = weather && period.isCurrent ? ` · ${weather.temperature}° ${weather.description.toLowerCase()}` : '';
    if (this.view() === 'day') {
      const title =
        day === today ? 'Today' : day === addDays(today!, 1) ? 'Tomorrow' : day === addDays(today!, -1) ? 'Yesterday' : formatDay(day, { weekday: 'long' });
      return { title, subtitle: `${formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' })}${current}` };
    }
    if (this.view() === 'week') {
      return { title: period.title.replace(/[A-Z][a-z]+/g, (month) => month.slice(0, 3)), subtitle: `${period.year}${current}` };
    }
    return { title: period.title, subtitle: `${period.year}${current}` };
  });

  constructor() {
    const follow = (change: MediaQueryListEvent) => this.wide.set(change.matches);
    this.media?.addEventListener('change', follow);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', follow));

    this.family.load();
    effect(() => {
      const state = this.family.state();
      if (state.status === 'ready') {
        this.weather.show(state.family);
      }
    });
  }

  /** A view chosen is remembered for the context the window is in now. */
  protected choose(view: CalendarView): void {
    this.view.set(view);
    this.preferences.remember(this.wide() ? 'desktop' : 'phone', view);
  }

  protected step(by: number): void {
    const day = this.shown();
    if (day) {
      this.focus.set(stepFrom(this.view(), day, by));
    }
  }

  /** A day picked in the month or the week opens on its own. */
  protected openDay(day: Day): void {
    this.selected.set(null);
    this.focus.set(day);
    this.choose('day');
  }

  /** A new event goes on the day in view, or on today when it is in the week shown, or the week's first day. */
  protected add(): void {
    const period = this.period();
    const day = this.view() !== 'week' ? this.shown() : period?.isCurrent ? this.today() : period?.start;
    if (day) {
      this.editing.set({ event: null, day, wide: this.wide(), at: null, deleting: false });
    }
  }

  /** An empty half hour tapped on the grid starts a new event there. */
  protected addAt(slot: GridSlot): void {
    this.editing.set({ event: null, day: slot.day, wide: this.wide(), at: slot.time, deleting: false });
  }

  /** Edit or Delete in an event's details opens the editor, which asks first before deleting. */
  protected edit(event: CalendarEvent, deleting = false): void {
    const family = this.family.family();
    if (family) {
      this.selected.set(null);
      this.editing.set({ event, day: event.startDate ?? dayIn(family.timeZone, event.startsAt!), wide: this.wide(), at: null, deleting });
    }
  }
}
