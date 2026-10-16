import { Component, computed, effect, inject, signal } from '@angular/core';
import { CalendarStore, colorOf, daysOf, whenOn } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';

/** The wall's week: a column per day with that day's events, in each person's color. */
@Component({
  selector: 'app-week-view',
  template: `
    @if (week(); as week) {
      <div class="toolbar">
        <button type="button" class="round" aria-label="Previous week" (click)="offset.set(offset() - 1)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
        </button>
        <button type="button" class="round" aria-label="Next week" (click)="offset.set(offset() + 1)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
        </button>
        <h2>{{ week.label }}</h2>
        @if (offset() !== 0) {
          <button type="button" class="today" (click)="offset.set(0)">This week</button>
        }
        @if (calendar.state().status === 'unavailable') {
          <span class="problem" role="status">Can't load the calendar right now.</span>
        }
      </div>

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

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .round {
      width: 56px;
      height: 56px;
      border-radius: 28px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    h2 {
      margin: 0 0 0 10px;
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 500;
    }

    .today {
      height: 56px;
      margin-left: 8px;
      padding: 0 22px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--surface);
      color: var(--ink);
      font: 600 17px var(--font-body);
      cursor: pointer;
    }

    .problem {
      margin-left: auto;
      color: var(--warn);
      font-size: 16px;
      font-weight: 600;
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

  /** Weeks away from this one; the arrows move it. */
  protected readonly offset = signal(0);

  private readonly settings = computed(() => {
    const state = this.family.state();
    return state.status === 'ready' ? state.family : null;
  });

  private readonly today = computed(() => {
    const family = this.settings();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  private readonly start = computed(() => {
    const family = this.settings();
    const today = this.today();
    return family && today ? addDays(startOfWeek(today, family.weekStartsOn), this.offset() * 7) : null;
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
