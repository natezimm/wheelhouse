import { Component, computed, effect, inject, input, output } from '@angular/core';
import { CalendarStore, colorOf, daysOf, whenOn } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';

/** The wall's week: a column per day with that day's events, in each person's color. */
@Component({
  selector: 'app-week-view',
  template: `
    @if (week(); as week) {
      <div class="days">
        @for (day of week.days; track day.day) {
          <section class="day" [class.is-today]="day.isToday" [attr.aria-label]="day.name">
            <div class="date">
              <span class="dow">{{ day.dow }}</span>
              <span class="num">{{ day.num }}</span>
            </div>
            <ul>
              @for (event of day.events; track event.id) {
                <li [style.--member]="event.color" [class.calendar-pending]="event.pending" [attr.aria-busy]="event.pending">
                  <button type="button" [disabled]="!event.canEdit" (click)="edit.emit(event.id)">
                    <span class="when">{{ event.when }}</span>
                    <span class="title">{{ event.title }}</span>
                    <span class="who"><span class="dot" aria-hidden="true"></span>{{ event.who }}</span>
                  </button>
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
    }

    .day {
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding: 14px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .day + .day {
      border-left: 1px solid var(--rule);
    }

    .day.is-today {
      background: var(--today-tint);
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
      color: var(--faint);
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
      color: var(--on-ink);
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    li button {
      width: 100%;
      padding: 10px 12px;
      border: 0;
      border-radius: 12px;
      background: color-mix(in srgb, var(--member) var(--member-fill), var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--member) var(--member-ring), var(--surface));
      color: var(--ink);
      font: inherit;
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 3px;
      cursor: pointer;
    }

    li button:disabled {
      cursor: default;
    }

    .when {
      font-size: 14px;
      font-weight: 600;
      color: var(--quiet);
    }

    .title {
      font-size: 17px;
      font-weight: 600;
      line-height: 1.25;
      overflow-wrap: break-word;
      hyphens: auto;
    }

    .who {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: var(--quiet);
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 5px;
      background: color-mix(in srgb, var(--member) var(--member-shade), black);
    }

    /* A narrow desktop window: smaller words, so titles break between them rather than inside. */
    @media (max-width: 1100px) {
      .day {
        padding: 12px 5px;
      }

      li button {
        padding: 8px;
      }

      .title {
        font-size: 14px;
      }

      .when,
      .who {
        font-size: 12px;
      }
    }
  `,
})
export class WeekView {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  /** A day in the week to show; null shows this week. */
  readonly focus = input<Day | null>(null);

  /** An event was tapped to change it; carries its id. */
  readonly edit = output<string>();

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
    const writable = new Set(this.calendar.calendars().filter((c) => c.canWrite).map((c) => c.id));
    for (const event of this.calendar.events()) {
      const pending = !!event.pending;
      const canEdit = writable.has(event.calendarId) && !this.calendar.isPending(event.id);
      const color = colorOf(event, family.members);
      const who = family.members.find((member) => member.id === event.memberId)?.displayName ?? 'Family';
      for (const day of daysOf(event, family.timeZone)) {
        byDay.get(day)?.push({ id: event.id, title: event.title, when: whenOn(event, day, family.timeZone), color, who, canEdit, pending });
      }
    }

    return {
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
  pending: boolean;
  id: string;
  title: string;
  when: string;
  color: string;
  who: string;
  canEdit: boolean;
}
