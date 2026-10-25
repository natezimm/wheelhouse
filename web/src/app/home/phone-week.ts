import { Component, ElementRef, computed, effect, inject, input, output, untracked, viewChildren } from '@angular/core';
import { CalendarStore, daysOf } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { CalendarFilter } from '../shared/calendar-filter';
import { CompactAgenda } from './compact-agenda';

/**
 * The phone's week: each day in a card of its own, rather than seven squeezed columns, with a
 * row per event. Today is outlined, and the week opens scrolled to yesterday so today is in view.
 */
@Component({
  selector: 'app-phone-week',
  imports: [CompactAgenda, CalendarFilter],
  template: `
    <app-calendar-filter class="compact" />
    @for (day of days(); track day.day) {
      <section #card class="day" [class.is-today]="day.isToday" [attr.aria-labelledby]="'week-' + day.day">
        <div class="heading">
          <span class="num" aria-hidden="true">{{ day.num }}</span>
          <h2 [id]="'week-' + day.day">
            <span class="name">{{ day.name }}</span>
            <span class="sub">{{ day.sub }}</span>
          </h2>
        </div>
        <app-compact-agenda [day]="day.day" (inspect)="inspect.emit($event)" />
      </section>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-bottom: 16px;
    }

    .day {
      padding: 12px;
      border: var(--card-border);
      border-radius: min(20px, var(--card-radius));
      background: var(--surface);
      box-shadow: var(--card-shadow-small);
      display: flex;
      flex-direction: column;
      gap: 6px;
      scroll-margin-top: 12px;
    }

    .day.is-today {
      box-shadow: inset 0 0 0 2px var(--ink), var(--card-shadow-small);
    }

    .heading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 2px 4px 4px;
    }

    .num {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      box-sizing: border-box;
      border-radius: var(--today-num-radius);
      background: var(--soft);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-display);
      font-size: 19px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
    }

    .is-today .num {
      border: var(--today-num-border);
      background: var(--today-num);
      color: var(--on-today-num);
    }

    h2 {
      margin: 0;
      display: flex;
      flex-direction: column;
    }

    .name {
      font-size: 15px;
      font-weight: 700;
    }

    .sub {
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
    }
  `,
})
export class PhoneWeek {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly focus = input.required<Day>();
  readonly inspect = output<string>();

  private readonly start = computed(() => {
    const family = this.family.family();
    return family ? startOfWeek(this.focus(), family.weekStartsOn) : null;
  });

  protected readonly days = computed(() => {
    const family = this.family.family();
    const start = this.start();
    if (!family || !start) {
      return [];
    }
    const today = dayIn(family.timeZone, this.clock.now());
    // Counts wait for the week to load, so a day is never called empty before it is known to be.
    const ready = this.calendar.state().status === 'ready';
    const counts = new Map<Day, number>();
    for (const event of this.calendar.events()) {
      for (const day of daysOf(event, family.timeZone, { from: start, to: addDays(start, 7) })) {
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
    }
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      const weekday = formatDay(day, { weekday: 'long' });
      const count = counts.get(day) ?? 0;
      const events = !ready ? '' : count === 0 ? 'No events' : count === 1 ? '1 event' : `${count} events`;
      const isToday = day === today;
      return {
        day,
        num: Number(day.slice(8)),
        name: isToday ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : day === addDays(today, -1) ? 'Yesterday' : weekday,
        sub: [isToday || Math.abs(Date.parse(day) - Date.parse(today)) <= 86_400_000 ? weekday : formatDay(day, { month: 'long', day: 'numeric' }), events]
          .filter(Boolean)
          .join(' · '),
        isToday,
      };
    });
  });

  private readonly cards = viewChildren<ElementRef<HTMLElement>>('card');

  constructor() {
    effect(() => {
      const start = this.start();
      if (start) {
        this.calendar.show(start, addDays(start, 7));
      }
    });

    // Once this week has loaded, bring yesterday to the top so today is in view. Only once per
    // week: later refreshes and live updates never move the page.
    let scrolledFor: Day | null = null;
    effect(() => {
      const start = this.start();
      const ready = this.calendar.state().status === 'ready';
      const cards = this.cards();
      if (!start || !ready || scrolledFor === start || cards.length !== 7) {
        return;
      }
      scrolledFor = start;
      const index = untracked(this.days).findIndex((day) => day.isToday);
      if (index >= 2) {
        requestAnimationFrame(() => cards[index - 1].nativeElement.scrollIntoView({ block: 'start' }));
      }
    });
  }
}
