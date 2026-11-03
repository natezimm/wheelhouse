import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { timeout } from 'rxjs';
import { CalendarEvent, CalendarStore, colorOf, peopleOf, showsOn, whenOn } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, minutesIn, timeIn, timeText } from '../core/days';
import { FamilyStore, Member } from '../core/family';
import { WeatherStore } from '../core/weather';
import { CountdownStrip } from '../shared/countdown-strip';
import { ModalFocus } from '../shared/modal-focus';
import { MemberAvatar } from '../shared/member-avatar';
import { WeatherIcon } from '../shared/weather-icon';

/** From 6 pm, a day with only all-day events left is done, and the glance looks to tomorrow. */
export const EVENING_MINUTES = 18 * 60;

/** How long the glance waits before reading its days again after a failed read. */
export const GLANCE_RETRY_MS = 30_000;

/** The most events the glance lists; the rest are counted. */
export const GLANCE_EVENTS = 5;

/** One line of the glance's list. */
export interface GlanceItem {
  id: string;
  title: string;
  when: string;
  /** Under way now. */
  now: boolean;
  color: string;
  people: Member[];
}

/**
 * What is left of a day: its all-day events, then timed events that have not ended yet, in order.
 * An event under way says "Now" and when it ends.
 */
export function restOf(events: readonly CalendarEvent[], day: Day, timeZone: string, now: Date, members: readonly Member[]): GlanceItem[] {
  const left = events.filter((event) => showsOn(event, day, timeZone) && (event.allDay || new Date(event.endsAt!) > now));
  left.sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.title.localeCompare(b.title));
  return left.map((event) => {
    const underway = !event.allDay && new Date(event.startsAt!) <= now;
    return {
      id: event.id,
      title: event.title,
      when: underway ? `Until ${timeText(timeZone, event.endsAt!)}` : whenOn(event, day, timeZone),
      now: underway,
      color: colorOf(event, members),
      people: peopleOf(event, members),
    };
  });
}

/**
 * Today at a glance: what the wall shows after a while untouched. A clock to read across the
 * kitchen, the weather and the next few days' forecast, what is left of today (or tomorrow, once
 * today is done) and the countdowns. During the family's night hours it turns dark and dim and
 * keeps only the clock and what is next, so the wall does not light up the room. Any touch, or a
 * key, brings the calendar back.
 */
@Component({
  selector: 'app-wall-glance',
  imports: [CountdownStrip, MemberAvatar, ModalFocus, WeatherIcon],
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Today at a glance',
    '[class.dim]': 'dim()',
    '[attr.data-theme]': 'theme()',
    '[attr.data-night]': "dim() ? '' : null",
    '(click)': 'woken.emit()',
    '(keydown)': 'woken.emit()',
  },
  template: `
    <div class="glance" appModalFocus tabindex="-1">
      <section class="time">
        @if (now(); as now) {
          <p class="clock">{{ now.time }}<span class="meridiem">{{ now.meridiem }}</span></p>
          <p class="date">{{ now.date }}</p>
        }
        @if (!dim()) {
          @if (weather.weather(); as today) {
            <div class="weather">
              <app-weather-icon [icon]="today.icon" />
              <span class="temperature">{{ today.temperature }}°</span>
              <span class="summary">{{ today.description }}<br />H {{ today.high }}° · L {{ today.low }}°</span>
            </div>
            @if (forecast().length) {
              <ul class="forecast" aria-label="The next few days">
                @for (day of forecast(); track day.date) {
                  <li [attr.aria-label]="day.name + ': ' + day.description + ', high ' + day.high + '°, low ' + day.low + '°'">
                    <span class="name">{{ day.name }}</span>
                    <app-weather-icon [icon]="day.icon" />
                    <span class="temps">{{ day.high }}°<span class="low">{{ day.low }}°</span></span>
                  </li>
                }
              </ul>
            }
          }
        }
      </section>

      <section class="plan" [attr.aria-label]="plan().heading">
        <h2>{{ plan().heading }}</h2>
        @if (plan().items.length) {
          <ul class="events">
            @for (item of shown(); track item.id) {
              <li [style.--member]="item.color" [class.underway]="item.now">
                <span class="when">@if (item.now) {<span class="badge">Now</span>}{{ item.when }}</span>
                <span class="title">{{ item.title }}</span>
                <span class="people">
                  @for (person of item.people; track person.id) {
                    <app-member-avatar [member]="person" />
                  }
                </span>
              </li>
            }
          </ul>
          @if (more()) {
            <p class="more">and {{ more() }} more</p>
          }
        } @else {
          <p class="empty">{{ plan().empty }}</p>
        }
        @if (!dim()) {
          <app-countdown-strip layout="wall" />
        }
      </section>
    </div>
    <p class="hint">Tap anywhere for the calendar</p>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 20;
      box-sizing: border-box;
      padding: 72px 96px 48px;
      display: flex;
      flex-direction: column;
      background: var(--ground);
      color: var(--ink);
      cursor: pointer;
    }

    /* The ground covers the calendar at once; the glance itself comes up softly. */
    .glance {
      animation: fade-in 600ms ease-out;
    }

    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .glance {
        animation: none;
      }
    }

    .glance {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 96px;
      align-items: center;
      outline: none;
    }

    p {
      margin: 0;
    }

    .time {
      display: flex;
      flex-direction: column;
      gap: 28px;
    }

    .clock {
      font-family: var(--font-display);
      font-size: 240px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      letter-spacing: -0.04em;
      line-height: 0.9;
      white-space: nowrap;
    }

    .meridiem {
      margin-left: 16px;
      font-size: 64px;
      letter-spacing: 0;
      color: var(--muted);
    }

    .date {
      font-family: var(--font-display);
      font-size: 48px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      color: var(--muted);
    }

    .weather {
      display: flex;
      align-items: center;
      gap: 20px;
      margin-top: 16px;
    }

    .weather app-weather-icon {
      width: 88px;
      height: 88px;
    }

    .temperature {
      font-family: var(--font-display);
      font-size: 80px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      line-height: 1;
    }

    .summary {
      font-size: 24px;
      font-weight: 600;
      color: var(--muted);
    }

    .forecast {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      gap: 16px;
    }

    .forecast li {
      min-width: 112px;
      padding: 16px 12px;
      border: var(--card-border);
      border-radius: var(--card-radius);
      background: var(--surface);
      box-shadow: var(--card-shadow-small);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      font-size: 20px;
      font-weight: 700;
    }

    .forecast app-weather-icon {
      width: 40px;
      height: 40px;
    }

    .forecast .name {
      color: var(--muted);
    }

    .low {
      margin-left: 8px;
      font-weight: 600;
      color: var(--faint);
    }

    .plan {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    h2 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 40px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
    }

    .events {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .events li {
      min-width: 0;
      min-height: 96px;
      box-sizing: border-box;
      padding: 16px 24px;
      border: var(--event-border);
      border-left: 10px solid var(--member-strong);
      border-radius: var(--event-radius);
      background: var(--member-bg);
      color: var(--event-ink);
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'when people' 'title people';
      column-gap: 20px;
      align-items: center;
    }

    .events li.underway {
      box-shadow: 0 0 0 3px var(--member-ring);
    }

    .when {
      grid-area: when;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: var(--font-time);
      font-size: 22px;
      font-weight: 700;
      color: var(--member-time);
    }

    .badge {
      padding: 2px 12px;
      border-radius: var(--pill);
      background: var(--member-strong);
      color: var(--on-avatar);
      font-size: 18px;
    }

    .title {
      grid-area: title;
      min-width: 0;
      font-size: 32px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .people {
      grid-area: people;
      display: flex;
      --avatar-size: 48px;
    }

    .people app-member-avatar + app-member-avatar {
      margin-left: -12px;
    }

    .more,
    .empty {
      font-size: 26px;
      font-weight: 600;
      color: var(--muted);
    }

    .hint {
      align-self: center;
      font-size: 20px;
      font-weight: 600;
      color: var(--faint);
    }

    /* Night: only the clock and what is next, faint on the dark look, so the wall does not light the room. */
    :host(.dim) .glance,
    :host(.dim) .hint {
      opacity: var(--glance-dim);
    }

    :host(.dim) .events li {
      min-height: 0;
      box-shadow: none;
    }
  `,
})
export class WallGlance {
  private readonly clock = inject(Clock);
  private readonly family = inject(FamilyStore);
  private readonly calendar = inject(CalendarStore);
  private readonly http = inject(HttpClient);
  protected readonly weather = inject(WeatherStore);

  /** Night: dark, dim and down to the essentials. */
  readonly dim = input(false);

  /** A touch or a key asks for the calendar again. */
  readonly woken = output<void>();

  protected readonly theme = computed(() => (this.family.family()?.theme ?? 'Daylight').toLowerCase());

  private readonly today = computed(() => {
    const zone = this.family.family()?.timeZone;
    return zone ? dayIn(zone, this.clock.now()) : null;
  });

  protected readonly now = computed(() => {
    const family = this.family.family();
    const today = this.today();
    if (!family || !today) return null;
    const [time, meridiem] = timeIn(family.timeZone, this.clock.now()).split(/\s/);
    return { time, meridiem: meridiem.toLowerCase(), date: formatDay(today, { weekday: 'long', month: 'long', day: 'numeric' }) };
  });

  /** The next four days' forecast, after today. */
  protected readonly forecast = computed(() => {
    const today = this.today();
    const days = this.weather.weather()?.days ?? [];
    return today
      ? days
          .filter((day) => day.date > today)
          .slice(0, 4)
          .map((day) => ({ ...day, name: formatDay(day.date, { weekday: 'short' }) }))
      : [];
  });

  /**
   * What is left of today; once today is done (no timed events left, and evening), tomorrow,
   * when the days on screen reach it. The whole family's, whatever the chips were filtering.
   */
  protected readonly plan = computed(() => {
    const family = this.family.family();
    const today = this.today();
    const read = this.read();
    if (!family || !today) return { heading: 'Today', items: [] as GlanceItem[], empty: '' };
    if (!read || read.from !== today) {
      return { heading: 'Today', items: [] as GlanceItem[], empty: this.failed() ? 'Today’s events could not be loaded. Trying again on its own.' : 'Loading today…' };
    }
    const now = this.clock.now();
    const rest = restOf(read.events, today, family.timeZone, now, family.members);
    const evening = minutesIn(family.timeZone, now) >= EVENING_MINUTES;
    if (rest.some((item) => !evening || item.when !== 'All day')) return { heading: 'Still to come today', items: rest, empty: '' };
    const next = restOf(read.events, addDays(today, 1), family.timeZone, now, family.members);
    if (next.length) return { heading: 'Tomorrow', items: next, empty: '' };
    if (rest.length) return { heading: 'Today', items: rest, empty: '' };
    return { heading: 'Today', items: [], empty: 'Nothing else today.' };
  });

  /**
   * Today and tomorrow, read on their own, whatever days the calendar under the glance shows.
   * Read again when the family's day turns and with each newer calendar change, so it follows
   * the live updates; a failed read keeps what was shown and tries again after a while.
   */
  private readonly read = signal<{ from: Day; events: CalendarEvent[] } | null>(null);
  private readonly failed = signal(false);
  private retry?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const today = this.today();
      this.calendar.changeNumber();
      if (today) untracked(() => this.load(today));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.retry));
  }

  private asked = 0;

  private load(from: Day): void {
    clearTimeout(this.retry);
    const ask = ++this.asked;
    this.http
      .get<{ events: CalendarEvent[] }>('/api/calendar', { params: { from, to: addDays(from, 2) } })
      .pipe(timeout(15_000))
      .subscribe({
        next: (snapshot) => {
          if (ask !== this.asked) return;
          this.read.set({ from, events: snapshot.events });
          this.failed.set(false);
        },
        error: () => {
          if (ask !== this.asked) return;
          this.failed.set(true);
          this.retry = setTimeout(() => this.load(from), GLANCE_RETRY_MS);
        },
      });
  }

  /** At night just the next event; otherwise the first few. */
  protected readonly shown = computed(() => this.plan().items.slice(0, this.dim() ? 1 : GLANCE_EVENTS));
  protected readonly more = computed(() => (this.dim() ? 0 : Math.max(0, this.plan().items.length - GLANCE_EVENTS)));
}
