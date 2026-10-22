import { Component, computed, effect, inject, input, output } from '@angular/core';
import { CalendarStore, FAMILY, FAMILY_COLOR, daysOf, ownerOf } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, addMonths, dayIn, formatDay, startOfMonth, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { CalendarFilter } from '../shared/calendar-filter';
import { AgendaList } from './agenda-list';

/** The phone's month: a dot for each person busy on a day, and the chosen day's agenda below. */
@Component({
  selector: 'app-phone-month',
  imports: [AgendaList, CalendarFilter],
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
        <app-agenda-list [day]="focus()" (edit)="edit.emit($event)" />
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
      border-radius: 20px;
      background: var(--surface);
      box-shadow: var(--card-shadow);
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
      height: 46px;
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
      width: 32px;
      height: 32px;
      border-radius: 16px;
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
      background: var(--ink);
      color: var(--on-ink);
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
      background: color-mix(in srgb, var(--member) var(--member-shade), black);
    }

    .agenda {
      padding-bottom: 16px;
    }

    .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 18px;
      text-transform: uppercase;
      color: var(--muted);
    }

    .open {
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--line);
      border-radius: 22px;
      background: var(--surface);
      color: var(--ink);
      font: 700 14px var(--font-body);
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
  readonly edit = output<string>();

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
    let chosen = 0;
    for (const event of this.calendar.events()) {
      const days = daysOf(event, family.timeZone);
      chosen += days.includes(this.focus()) ? 1 : 0;
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

    const count = chosen === 1 ? '1 event' : `${chosen === 0 ? 'No' : chosen} events`;
    return {
      title: formatDay(first, { month: 'long', year: 'numeric' }),
      dows: cells.slice(0, 7).map((cell) => formatDay(cell.day, { weekday: 'narrow' })),
      cells,
      heading: `${formatDay(this.focus(), { weekday: 'short', month: 'short', day: 'numeric' })} · ${count}`,
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
