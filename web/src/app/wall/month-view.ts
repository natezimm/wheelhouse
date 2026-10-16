import { Component, computed, effect, inject, model, output } from '@angular/core';
import { CalendarStore, colorOf, daysOf } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, addMonths, dayIn, formatDay, startOfMonth, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { CalendarNav, WallView } from './calendar-nav';

/** How many events fit in a day's box; a busier day shows one fewer and says how many more. */
const FITS = 3;

/** The wall's month: a box per day with its first few events. Tapping a day opens it. */
@Component({
  selector: 'app-month-view',
  imports: [CalendarNav],
  template: `
    @if (month(); as month) {
      <app-calendar-nav
        [(view)]="view"
        unit="month"
        [label]="month.label"
        [backLabel]="month.isThisMonth ? null : 'This month'"
        (previous)="move(-1)"
        (next)="move(1)"
        (back)="focus.set(null)"
      />

      <div class="dows" aria-hidden="true">
        @for (dow of month.dows; track $index) {
          <span>{{ dow }}</span>
        }
      </div>
      <div class="grid" [style.--weeks]="month.weeks">
        @for (cell of month.cells; track cell.day) {
          <button
            type="button"
            [class.outside]="!cell.inMonth"
            [class.is-today]="cell.isToday"
            [attr.aria-label]="cell.label"
            (click)="opened.emit(cell.day)"
          >
            <span class="num">{{ cell.num }}</span>
            @for (event of cell.events; track event.id) {
              <span class="event" [style.--member]="event.color">
                <span class="dot" aria-hidden="true"></span>
                <span class="title">{{ event.title }}</span>
              </span>
            }
            @if (cell.more > 0) {
              <span class="more">+{{ cell.more }} more</span>
            }
          </button>
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

    .dows,
    .grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 8px;
    }

    .dows span {
      padding-left: 10px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--muted);
    }

    .grid {
      flex: 1;
      min-height: 0;
      grid-template-rows: repeat(var(--weeks), minmax(0, 1fr));
    }

    .grid > button {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: 8px 10px;
      border: 0;
      border-radius: 14px;
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 4px;
      cursor: pointer;
    }

    .grid > button.outside {
      background: #ebe8e1;
    }

    .grid > button.is-today {
      box-shadow: inset 0 0 0 2px var(--ink);
    }

    .num {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: 600;
    }

    .outside .num {
      color: var(--muted);
    }

    .is-today .num {
      background: var(--ink);
      color: #ffffff;
    }

    .event {
      flex-shrink: 0;
      min-width: 0;
      height: 26px;
      padding: 0 8px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--member) 14%, white);
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
    }

    .dot {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: var(--member);
    }

    .title {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .more {
      padding-left: 8px;
      font-size: 14px;
      font-weight: 600;
      line-height: 26px;
      color: #4a4f57;
    }
  `,
})
export class MonthView {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly view = model.required<WallView>();

  /** A day in the month to show; null shows this month. */
  readonly focus = model<Day | null>(null);

  /** A day was tapped. */
  readonly opened = output<Day>();

  private readonly today = computed(() => {
    const family = this.family.family();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  /** The month's first day, and the whole weeks that show it. */
  private readonly grid = computed(() => {
    const family = this.family.family();
    const day = this.focus() ?? this.today();
    if (!family || !day) {
      return null;
    }
    const first = startOfMonth(day);
    const start = startOfWeek(first, family.weekStartsOn);
    const next = addMonths(first, 1);
    let end = start;
    while (end < next) {
      end = addDays(end, 7);
    }
    return { family, first, start, end };
  });

  protected readonly month = computed(() => {
    const grid = this.grid();
    if (!grid) {
      return null;
    }
    const { family, first, start, end } = grid;

    const byDay = new Map<Day, { id: string; title: string; color: string }[]>();
    for (const event of this.calendar.events()) {
      const shown = { id: event.id, title: event.title, color: colorOf(event, family.members) };
      for (const day of daysOf(event, family.timeZone)) {
        byDay.set(day, [...(byDay.get(day) ?? []), shown]);
      }
    }

    const cells = [];
    for (let day = start; day < end; day = addDays(day, 1)) {
      const events = byDay.get(day) ?? [];
      const fits = events.length > FITS ? FITS - 1 : FITS;
      cells.push({
        day,
        num: Number(day.slice(8)),
        inMonth: day.slice(0, 7) === first.slice(0, 7),
        isToday: day === this.today(),
        label: `${formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}, ${events.length === 1 ? '1 event' : `${events.length} events`}`,
        events: events.slice(0, fits),
        more: events.length - Math.min(events.length, fits),
      });
    }

    return {
      label: formatDay(first, { month: 'long', year: 'numeric' }),
      isThisMonth: first === startOfMonth(this.today()!),
      dows: cells.slice(0, 7).map((cell) => formatDay(cell.day, { weekday: 'short' }).toUpperCase()),
      weeks: cells.length / 7,
      cells,
    };
  });

  constructor() {
    effect(() => {
      const grid = this.grid();
      if (grid) {
        this.calendar.show(grid.start, grid.end);
      }
    });
  }

  protected move(months: number): void {
    this.focus.set(addMonths(this.grid()!.first, months));
  }
}
