import { Component, computed, effect, inject, model } from '@angular/core';
import { CalendarStore, colorOf, daysOf, whenOn } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { CalendarNav, WallView } from './calendar-nav';

/** The wall's week: a column per day with that day's events, in each person's color. */
@Component({
  selector: 'app-week-view',
  imports: [CalendarNav],
  template: `
    @if (week(); as week) {
      <app-calendar-nav
        [(view)]="view"
        unit="week"
        [label]="week.label"
        [backLabel]="week.isThisWeek ? null : 'This week'"
        (previous)="move(-7)"
        (next)="move(7)"
        (back)="focus.set(null)"
      />

      <div class="days">
        @for (day of week.days; track day.day) {
          <section class="day" [class.is-today]="day.isToday" [attr.aria-label]="day.name">
            <div class="date">
              <span class="dow">{{ day.dow }}</span>
              <span class="num">{{ day.num }}</span>
            </div>
            <ul>
              @for (event of day.events; track event.id) {
                <li [style.--member]="event.color">
                  <span class="when">{{ event.when }}</span>
                  <span class="title">{{ event.title }}</span>
                  <span class="who"><span class="dot" aria-hidden="true"></span>{{ event.who }}</span>
                </li>
              }
            </ul>
          </section>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
    }

    .days {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 10px;
    }

    .day {
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding: 12px 10px;
      border-radius: 16px;
      background: var(--surface);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .day.is-today {
      box-shadow: inset 0 0 0 2px var(--ink);
    }

    .date {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 2px 6px;
    }

    .dow {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--muted);
    }

    .num {
      width: 40px;
      height: 40px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 600;
    }

    .is-today .num {
      background: var(--ink);
      color: #ffffff;
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    li {
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--member) 14%, white);
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .when {
      font-size: 14px;
      font-weight: 600;
      color: #4a4f57;
    }

    .title {
      font-size: 17px;
      font-weight: 600;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .who {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: #4a4f57;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 5px;
      background: var(--member);
    }
  `,
})
export class WeekView {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly view = model.required<WallView>();

  /** A day in the week to show; null shows this week. */
  readonly focus = model<Day | null>(null);

  private readonly settings = this.family.family;

  private readonly today = computed(() => {
    const family = this.settings();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  private readonly start = computed(() => {
    const family = this.settings();
    const day = this.focus() ?? this.today();
    return family && day ? startOfWeek(day, family.weekStartsOn) : null;
  });

  protected readonly week = computed(() => {
    const family = this.settings();
    const start = this.start();
    if (!family || !start) {
      return null;
    }

    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const byDay = new Map<Day, WeekEvent[]>(days.map((day) => [day, []]));
    for (const event of this.calendar.events()) {
      const color = colorOf(event, family.members);
      const who = family.members.find((member) => member.id === event.memberId)?.displayName ?? 'Family';
      for (const day of daysOf(event, family.timeZone)) {
        byDay.get(day)?.push({ id: event.id, title: event.title, when: whenOn(event, day, family.timeZone), color, who });
      }
    }

    return {
      label: rangeLabel(days[0], days[6]),
      isThisWeek: days.includes(this.today()!),
      days: days.map((day) => ({
        day,
        name: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
        dow: formatDay(day, { weekday: 'short' }).toUpperCase(),
        num: Number(day.slice(8)),
        isToday: day === this.today(),
        // The server sends events by start, all-day ones first, which is the order to read them in.
        events: byDay.get(day)!,
      })),
    };
  });

  protected move(days: number): void {
    this.focus.set(addDays(this.start()!, days));
  }

  constructor() {
    effect(() => {
      const start = this.start();
      if (start) {
        this.calendar.show(start, addDays(start, 7));
      }
    });
  }
}

interface WeekEvent {
  id: string;
  title: string;
  when: string;
  color: string;
  who: string;
}

/** "Oct 12 – 18", or "Oct 26 – Nov 1" across a month's end. */
function rangeLabel(first: Day, last: Day): string {
  const from = formatDay(first, { month: 'short', day: 'numeric' });
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const to = formatDay(last, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${from} – ${to}`;
}
