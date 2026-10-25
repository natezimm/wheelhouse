import { Component, computed, effect, inject, input, output } from '@angular/core';
import { CalendarStore, FAMILY, FAMILY_COLOR, daysOf, ownerOf } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, addMonths, dayIn, formatDay, startOfMonth, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { CalendarFilter } from '../shared/calendar-filter';
import { CompactAgenda } from './compact-agenda';

/** The phone's month: a dot for each person busy on a day, and the chosen day's agenda below. */
@Component({
  selector: 'app-phone-month',
  imports: [CompactAgenda, CalendarFilter],
  template: `
    <app-calendar-filter class="compact" />
    @if (month(); as month) {
      <section class="month" [attr.aria-label]="month.title">
        <div class="dows" aria-hidden="true">
          @for (dow of month.dows; track $index) {
            <span>{{ dow }}</span>
          }
        </div>
        <div class="grid">
          @for (cell of month.cells; track cell.day) {
            <button
              type="button"
              [class.outside]="!cell.inMonth"
              [class.is-today]="cell.isToday"
              [attr.aria-pressed]="cell.day === focus()"
              [attr.aria-label]="cell.label"
              (click)="pick.emit(cell.day)"
            >
              <span class="num">{{ cell.num }}</span>
              <span class="dots" aria-hidden="true">
                @for (color of cell.colors; track $index) {
                  <span [style.--member]="color"></span>
                }
              </span>
            </button>
          }
        </div>
      </section>

      <section class="agenda" aria-labelledby="agenda">
        <div class="heading">
          <h2 id="agenda">{{ month.heading }}</h2>
          <button type="button" class="open" (click)="openDay.emit(focus())">Open day</button>
        </div>
        <app-compact-agenda [day]="focus()" (inspect)="inspect.emit($event)" />
      </section>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .month {
      padding: 12px 10px;
      border: var(--card-border);
      border-radius: min(20px, var(--card-radius));
      background: var(--surface);
      box-shadow: var(--card-shadow-small);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .dows,
    .grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .dows span {
      text-align: center;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 18px;
      color: var(--faint);
    }

    .grid {
      row-gap: 2px;
    }

    .grid button {
      height: 48px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--ink);
      font: 600 15px var(--font-body);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      cursor: pointer;
    }

    .num {
      box-sizing: border-box;
      width: 32px;
      height: 32px;
      border-radius: var(--today-num-radius);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .outside {
      color: var(--faint);
      font-weight: 400;
    }

    .grid button[aria-pressed='true'] .num {
      box-shadow: inset 0 0 0 2px var(--ink);
    }

    .is-today .num {
      border: var(--today-num-border);
      background: var(--today-num);
      color: var(--on-today-num);
    }

    .dots {
      display: flex;
      gap: 3px;
      height: 5px;
    }

    .dots span {
      width: 5px;
      height: 5px;
      border-radius: 3px;
      background: var(--member-text);
    }

    .agenda {
      padding-bottom: 16px;
    }

    .agenda {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 2px;
    }

    /* Wraps rather than cutting the date off on a narrow phone. */
    h2 {
      min-width: 0;
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.3;
    }

    .open {
      flex-shrink: 0;
      min-height: 44px;
      padding: 0 2px 0 12px;
      border: 0;
      background: none;
      color: var(--accent);
      font: 700 15px var(--font-body);
      cursor: pointer;
    }
  `,
})
export class PhoneMonth {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly focus = input.required<Day>();
  readonly pick = output<Day>();
  readonly openDay = output<Day>();
  readonly inspect = output<string>();

  /** The weeks the month covers, whole, from the family's first day of the week. */
  private readonly grid = computed(() => {
    const family = this.family.family();
    if (!family) {
      return null;
    }
    const first = startOfMonth(this.focus());
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
    const today = dayIn(family.timeZone, this.clock.now());

    const ownersByDay = new Map<Day, Set<string>>();
    for (const event of this.calendar.events()) {
      const days = daysOf(event, family.timeZone, { from: start, to: end });
      for (const day of days) {
        ownersByDay.set(day, (ownersByDay.get(day) ?? new Set()).add(ownerOf(event)));
      }
    }
    // Dots keep the same order on every day: the members' own order, then the family's.
    const owners = [
      ...family.members.map((member) => ({ owner: member.id, color: member.color })),
      { owner: FAMILY, color: FAMILY_COLOR },
    ];

    const cells = [];
    for (let day = start; day < end; day = addDays(day, 1)) {
      cells.push({
        day,
        num: Number(day.slice(8)),
        inMonth: day.slice(0, 7) === first.slice(0, 7),
        isToday: day === today,
        label: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
        // At most three dots fit under a date.
        colors: owners
          .filter(({ owner }) => ownersByDay.get(day)?.has(owner))
          .map(({ color }) => color)
          .slice(0, 3),
      });
    }

    const named = formatDay(this.focus(), { weekday: 'long', month: 'long', day: 'numeric' });
    return {
      title: formatDay(first, { month: 'long', year: 'numeric' }),
      dows: cells.slice(0, 7).map((cell) => formatDay(cell.day, { weekday: 'narrow' })),
      cells,
      heading: this.focus() === today ? `Today · ${named}` : named,
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
}
