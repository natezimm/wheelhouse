import { Component, computed, effect, inject, input, output } from '@angular/core';
import { CalendarStore, daysOf } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { CalendarFilter } from '../shared/calendar-filter';
import { AgendaList } from './agenda-list';

/** The phone's day: a strip of the week to move around it, the people, then the day's agenda. */
@Component({
  selector: 'app-phone-day',
  imports: [AgendaList, CalendarFilter],
  template: `
    @if (strip(); as strip) {
      <div class="strip" role="group" aria-label="Days this week">
        @for (cell of strip; track cell.day) {
          <button type="button" [attr.aria-pressed]="cell.day === focus()" [class.is-today]="cell.isToday" [attr.aria-label]="cell.label" (click)="pick.emit(cell.day)">
            <span class="dow">{{ cell.dow }}</span>
            <span class="num">{{ cell.num }}</span>
            <span class="dot" [class.busy]="cell.busy" aria-hidden="true"></span>
          </button>
        }
      </div>
    }
    <app-calendar-filter class="compact" />
    <section [attr.aria-label]="name()">
      <app-agenda-list [day]="focus()" (inspect)="inspect.emit($event)" (add)="add.emit()" />
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .strip {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 2px;
    }

    .strip button {
      min-height: 64px;
      padding: 6px 0;
      box-sizing: border-box;
      border: 0;
      border-radius: min(16px, var(--card-radius));
      background: transparent;
      color: var(--ink);
      font: inherit;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      cursor: pointer;
    }

    .dow {
      font-size: 12px;
      font-weight: 700;
      color: var(--faint);
    }

    .num {
      font-family: var(--font-display);
      font-size: 18px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
    }

    .is-today .dow,
    .is-today .num {
      color: var(--now-text);
    }

    .strip button[aria-pressed='true'] {
      border: var(--today-num-border);
      background: var(--today-num);
      color: var(--on-today-num);
    }

    .strip button[aria-pressed='true'] .dow,
    .strip button[aria-pressed='true'] .num {
      color: var(--on-today-num);
    }

    .dot {
      width: 5px;
      height: 5px;
      border-radius: 3px;
    }

    .dot.busy {
      background: var(--faint);
    }

    [aria-pressed='true'] .dot.busy {
      background: var(--on-today-num);
    }

    section {
      padding-bottom: 16px;
    }
  `,
})
export class PhoneDay {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly focus = input.required<Day>();
  readonly pick = output<Day>();
  readonly inspect = output<string>();
  readonly add = output<void>();

  protected readonly name = computed(() => formatDay(this.focus(), { weekday: 'long', month: 'long', day: 'numeric' }));

  private readonly start = computed(() => {
    const family = this.family.family();
    return family ? startOfWeek(this.focus(), family.weekStartsOn) : null;
  });

  protected readonly strip = computed(() => {
    const family = this.family.family();
    const start = this.start();
    if (!family || !start) {
      return null;
    }
    const today = dayIn(family.timeZone, this.clock.now());
    const week = { from: start, to: addDays(start, 7) };
    const busy = new Set(this.calendar.events().flatMap((event) => daysOf(event, family.timeZone, week)));
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      return {
        day,
        dow: formatDay(day, { weekday: 'narrow' }),
        num: Number(day.slice(8)),
        label: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
        isToday: day === today,
        busy: busy.has(day),
      };
    });
  });

  constructor() {
    // The whole week, so the strip can mark busy days and moving within it needs no read.
    effect(() => {
      const start = this.start();
      if (start) {
        this.calendar.show(start, addDays(start, 7));
      }
    });
  }
}
