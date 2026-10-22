import { Component, computed, effect, inject, input, output } from '@angular/core';
import { CalendarStore } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { CalendarFilter } from '../shared/calendar-filter';
import { AgendaList } from './agenda-list';

/** The phone's week: each day's agenda in a card of its own, rather than seven squeezed columns. */
@Component({
  selector: 'app-phone-week',
  imports: [AgendaList, CalendarFilter],
  template: `
    <app-calendar-filter class="compact" />
    @for (day of days(); track day.day) {
      <section class="day" [class.is-today]="day.isToday" [attr.aria-label]="day.label">
        <h2><span class="dow">{{ day.dow }}</span> {{ day.num }}</h2>
        <app-agenda-list [day]="day.day" (edit)="edit.emit($event)" />
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
      padding: 12px 14px 14px;
      border-radius: 20px;
      background: var(--surface);
      box-shadow: var(--card-shadow);
    }

    .day.is-today {
      box-shadow: inset 0 0 0 2px var(--ink);
    }

    h2 {
      margin: 0 0 8px;
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: 600;
    }

    .dow {
      font-family: var(--font-body);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--faint);
    }
  `,
})
export class PhoneWeek {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly focus = input.required<Day>();
  readonly edit = output<string>();

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
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      return {
        day,
        dow: formatDay(day, { weekday: 'short' }).toUpperCase(),
        num: Number(day.slice(8)),
        label: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
        isToday: day === today,
      };
    });
  });

  constructor() {
    effect(() => {
      const start = this.start();
      if (start) {
        this.calendar.show(start, addDays(start, 7));
      }
    });
  }
}
