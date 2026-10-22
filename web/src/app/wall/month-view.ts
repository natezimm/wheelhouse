import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { CalendarStore, colorOf, daysOf } from '../core/calendar';
import { compactTime, monthWeek } from '../core/calendar-grid';
import { Clock } from '../core/clock';
import { Day, addDays, addMonths, dayIn, formatDay, startOfMonth, startOfWeek, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';

/** How each layout sizes a week's row: the date, a row of bars, and a line of a day's events. */
const LAYOUTS = {
  wall: { head: 44, bar: 32, line: 26, foot: 6, fallbackLines: 4 },
  desktop: { head: 34, bar: 26, line: 22, foot: 4, fallbackLines: 4 },
};

/**
 * The month filling the card, in as many week rows as it needs. All-day and long events are
 * bars across their days; timed events are a line each with the owner's dot, a short time and
 * the title, as many as fit, then "+N more". Each day is one button that opens it in Day, so
 * every target is a whole day, however busy. Used by the wall and by a desktop window.
 */
@Component({
  selector: 'app-month-view',
  host: { '[class]': 'layout()' },
  template: `
    @if (month(); as month) {
      <div class="dows" aria-hidden="true">
        @for (dow of month.dows; track $index) {
          <span>{{ dow }}</span>
        }
      </div>
      <div class="weeks" #weeks [style.--weeks]="month.weeks.length">
        @for (week of month.weeks; track week.start) {
          <div class="week" [style.grid-template-rows]="week.rows">
            @for (cell of week.cells; track cell.day) {
              <button
                type="button"
                class="cell"
                [style.grid-column]="cell.column"
                [class.outside]="!cell.inMonth"
                [class.is-today]="cell.isToday"
                [attr.aria-label]="cell.label"
                (click)="opened.emit(cell.day)"
              ></button>
              <span class="num" [style.grid-column]="cell.column" [class.outside]="!cell.inMonth" [class.is-today]="cell.isToday" aria-hidden="true">{{ cell.num }}</span>
              <span class="lines" [attr.data-day]="cell.day" [style.grid-column]="cell.column" [style.grid-row]="cell.row" aria-hidden="true">
                @for (line of cell.lines; track line.key) {
                  <span class="line" [style.--member]="line.color" [class.calendar-pending]="line.pending">
                    <span class="dot"></span>
                    <span class="time">{{ line.time }}</span>
                    <span class="title">{{ line.title }}</span>
                  </span>
                }
                @if (cell.more > 0) {
                  <span class="more">+{{ cell.more }} more</span>
                }
              </span>
            }
            @for (bar of week.bars; track bar.key) {
              <span
                class="bar"
                aria-hidden="true"
                [style.grid-column]="bar.column"
                [style.grid-row]="bar.row"
                [style.--member]="bar.color"
                [class.before]="bar.before"
                [class.after]="bar.after"
                [class.calendar-pending]="bar.pending"
              >
                <span class="mark">{{ bar.initial }}</span>
                <span class="title">{{ bar.title }}</span>
              </span>
            }
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      --head: 44px;
      --bar: 32px;
      --line: 26px;
    }

    :host(.desktop) {
      --head: 34px;
      --bar: 26px;
      --line: 22px;
    }

    .dows {
      flex-shrink: 0;
      height: 44px;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      border-bottom: 1px solid var(--rule);
    }

    :host(.desktop) .dows {
      height: 36px;
    }

    .dows span {
      display: flex;
      align-items: center;
      padding: 0 16px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--faint);
    }

    :host(.desktop) .dows span {
      padding: 0 12px;
      font-size: 12px;
    }

    .weeks {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-rows: repeat(var(--weeks), minmax(0, 1fr));
    }

    .week {
      position: relative;
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      border-bottom: 1px solid var(--rule);
    }

    .week:last-child {
      border-bottom: 0;
    }

    /* The day's button lies under everything else in its column, which lets taps through to it. */
    .cell {
      grid-row: 1 / -1;
      margin: 0;
      padding: 0;
      border: 0;
      background: var(--surface);
      cursor: pointer;
    }

    .cell:not(:nth-child(1)) {
      border-left: 1px solid var(--rule);
    }

    .cell.outside {
      background: var(--month-outside);
    }

    .cell.is-today {
      background: var(--today-tint);
    }

    .num,
    .lines,
    .bar {
      pointer-events: none;
    }

    .num {
      grid-row: 1;
      align-self: center;
      justify-self: start;
      margin-left: 10px;
      padding-left: 6px;
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: 600;
    }

    :host(.desktop) .num {
      margin-left: 6px;
      font-size: 16px;
    }

    .num.outside {
      color: var(--faint);
    }

    .num.is-today {
      width: 36px;
      height: 36px;
      padding: 0;
      border-radius: 18px;
      background: var(--ink);
      color: var(--on-ink);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    :host(.desktop) .num.is-today {
      width: 28px;
      height: 28px;
      border-radius: 14px;
    }

    .lines {
      min-width: 0;
      min-height: 0;
      padding: 4px 10px 0 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }

    :host(.desktop) .lines {
      padding: 2px 8px 0 9px;
    }

    .line {
      flex-shrink: 0;
      min-width: 0;
      height: calc(var(--line) - 2px);
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 15px;
      white-space: nowrap;
    }

    :host(.desktop) .line {
      gap: 5px;
      font-size: 13px;
    }

    .dot {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--member) var(--member-shade), black);
    }

    :host(.desktop) .dot {
      width: 7px;
      height: 7px;
    }

    .time {
      flex-shrink: 0;
      font-weight: 700;
      color: var(--quiet);
    }

    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .line .title {
      font-weight: 600;
    }

    .more {
      flex-shrink: 0;
      height: calc(var(--line) - 2px);
      display: flex;
      align-items: center;
      padding-left: 15px;
      font-size: 14px;
      font-weight: 700;
      color: var(--notice-ink);
    }

    :host(.desktop) .more {
      padding-left: 12px;
      font-size: 12px;
    }

    .bar {
      min-width: 0;
      height: calc(var(--bar) - 4px);
      margin: 0 6px;
      box-sizing: border-box;
      padding: 0 10px 0 4px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--member) var(--member-fill), var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--member) var(--member-ring), var(--surface));
      color: var(--ink);
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 15px;
      font-weight: 600;
    }

    :host(.desktop) .bar {
      margin: 0 4px;
      padding: 0 8px 0 3px;
      gap: 5px;
      border-radius: 6px;
      font-size: 13px;
    }

    /* A bar that runs on into the week before or after is squared off on that side. */
    .bar.before {
      margin-left: 0;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
    }

    .bar.after {
      margin-right: 0;
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }

    .mark {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--member) var(--member-shade), black);
      color: var(--on-ink);
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    :host(.desktop) .mark {
      width: 18px;
      height: 18px;
      border-radius: 9px;
      font-size: 9px;
    }
  `,
})
export class MonthView {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  /** A day in the month to show; null shows this month. */
  readonly focus = input<Day | null>(null);

  /** The wall's rows are taller and its type larger than a desktop window's. */
  readonly layout = input<'wall' | 'desktop'>('wall');

  /** A day was tapped. */
  readonly opened = output<Day>();

  private readonly weeksElement = viewChild<ElementRef<HTMLElement>>('weeks');
  private readonly height = signal(0);

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
    const zone = family.timeZone;
    const layout = LAYOUTS[this.layout()];
    const events = this.calendar.events();
    const weekCount = Math.round((Date.parse(end) - Date.parse(start)) / (7 * 86_400_000));

    // How many lines fit in a row under its bars, from the height the weeks have on screen.
    const rowHeight = this.height() / weekCount;
    const room = (lanes: number) =>
      rowHeight > 0 ? Math.floor((rowHeight - layout.head - lanes * layout.bar - layout.foot) / layout.line) : layout.fallbackLines - lanes;

    // Every event a day holds, for the day's name read aloud.
    const counts = new Map<Day, number>();
    for (const event of events) {
      for (const day of daysOf(event, zone)) {
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
    }
    const describe = (event: (typeof events)[number]) => {
      const member = family.members.find((m) => m.id === event.memberId);
      return { title: event.title, color: colorOf(event, family.members), initial: member?.initial ?? 'F', pending: !!event.pending };
    };

    const weeks = [];
    for (let weekStart = start; weekStart < end; weekStart = addDays(weekStart, 7)) {
      const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      const row = monthWeek(events, days, zone, room);
      weeks.push({
        start: weekStart,
        rows: `var(--head)${' var(--bar)'.repeat(row.lanes)} minmax(0, 1fr)`,
        bars: row.bars.map((bar) => ({
          ...describe(bar.event),
          key: `${bar.event.id}@${weekStart}`,
          column: `${bar.first + 1} / span ${bar.span}`,
          row: `${bar.lane + 2}`,
          before: bar.continuesBefore,
          after: bar.continuesAfter,
        })),
        cells: row.days.map((cell, i) => {
          const count = counts.get(cell.day) ?? 0;
          return {
            day: cell.day,
            column: `${i + 1}`,
            row: `${cell.lanes + 2} / -1`,
            num: Number(cell.day.slice(8)),
            inMonth: cell.day.slice(0, 7) === first.slice(0, 7),
            isToday: cell.day === this.today(),
            label: `${formatDay(cell.day, { weekday: 'long', month: 'long', day: 'numeric' })}, ${count === 0 ? 'no events' : count === 1 ? '1 event' : `${count} events`}`,
            lines: cell.segments.map((segment) => ({
              ...describe(segment.event),
              key: segment.event.id,
              time: segment.continuesBefore ? `→${compactTime(timeIn(zone, segment.event.endsAt!))}` : compactTime(timeIn(zone, segment.event.startsAt!)),
            })),
            more: cell.more,
          };
        }),
      });
    }

    return {
      dows: weeks[0].cells.map((cell) => formatDay(cell.day, { weekday: 'short' }).toUpperCase()),
      weeks,
    };
  });

  constructor() {
    effect(() => {
      const grid = this.grid();
      if (grid) {
        this.calendar.show(grid.start, grid.end);
      }
    });

    // Follow the height the weeks have, so each day shows as many lines as fit.
    effect((onCleanup) => {
      const weeks = this.weeksElement()?.nativeElement;
      if (!weeks || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(() => this.height.set(weeks.clientHeight));
      observer.observe(weeks);
      onCleanup(() => observer.disconnect());
    });
  }
}
