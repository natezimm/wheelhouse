import { Component, computed, effect, inject, input, output, viewChild } from '@angular/core';
import { CalendarEvent, CalendarStore, colorOf, namesOf, peopleOf } from '../core/calendar';
import { dayBars, timedSegments } from '../core/calendar-grid';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, startOfWeek, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { GridColumn, GridNote, GridSlot, HourGrid } from './hour-grid';
import { AvatarFace } from '../shared/avatar-face';

export type { GridSlot } from './hour-grid';

/**
 * The week on a shared hour grid: seven aligned day columns, all-day and long events as bars
 * above them, timed events placed by their real start and length, side by side where they
 * overlap, and the now line on today. Used by the wall and by a desktop window.
 */
@Component({
  selector: 'app-week-view',
  imports: [AvatarFace, HourGrid],
  host: { '[class]': 'layout()' },
  template: `
    @if (week(); as week) {
      <div class="heads">
        <span></span>
        @for (day of week.days; track day.day) {
          <button type="button" class="head" [class.today]="day.isToday" [attr.aria-label]="'Open ' + day.name" (click)="openDay.emit(day.day)">
            <span class="dow">{{ day.dow }}</span>
            <span class="num">{{ day.num }}</span>
          </button>
        }
      </div>

      <div class="all-day">
        <span class="label">All day</span>
        <div class="bars" [style.--rows]="week.rows">
          @for (bar of week.bars; track bar.key) {
            <button
              type="button"
              class="bar"
              [style.grid-column]="bar.column"
              [style.grid-row]="bar.row"
              [style.--member]="bar.color"
              [class.before]="bar.before"
              [class.after]="bar.after"
              [class.selected]="bar.id === selected()"
              [class.calendar-pending]="bar.pending"
              [attr.aria-busy]="bar.pending"
              [attr.aria-label]="bar.label"
              (click)="inspect.emit(bar.id)"
            >
              <span class="mark" aria-hidden="true"><app-avatar-face [initial]="bar.initial" [avatar]="bar.avatar" /></span>
              <span class="title">{{ bar.title }}</span>
            </button>
          }
          @for (more of week.barsMore; track more.day) {
            <button type="button" class="bar-more" [style.grid-column]="more.column" [style.grid-row]="week.rows" [attr.aria-label]="more.label" (click)="openDay.emit(more.day)">
              +{{ more.count }} more
            </button>
          }
        </div>
      </div>

      <app-hour-grid
        [columns]="columns()"
        [layout]="layout()"
        [anchor]="start() ?? ''"
        [selected]="selected()"
        [canAdd]="canAdd()"
        [note]="note()"
        (inspect)="inspect.emit($event)"
        (moreOpened)="openDay.emit($event.column.day)"
        (create)="create.emit($event)"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      --gutter: 76px;
    }

    :host(.desktop) {
      --gutter: 62px;
    }

    .heads,
    .all-day {
      flex-shrink: 0;
      display: grid;
      grid-template-columns: var(--gutter) minmax(0, 1fr);
      border-bottom: 1px solid var(--rule);
    }

    .heads {
      height: 58px;
      border-bottom: var(--head-rule);
      grid-template-columns: var(--gutter) repeat(7, minmax(0, 1fr));
    }

    :host(.desktop) .heads {
      height: 50px;
    }

    .head {
      min-width: 0;
      padding: 0 14px;
      border: 0;
      border-left: 1px solid var(--rule);
      background: transparent;
      color: var(--ink);
      font: inherit;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
    }

    :host(.desktop) .head {
      padding: 0 10px;
      gap: 8px;
    }

    .head.today {
      background: var(--today-head);
    }

    .dow {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--faint);
    }

    .today .dow {
      color: var(--today-dow);
    }

    .num {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      line-height: 1;
    }

    .today .num {
      box-sizing: border-box;
      width: 40px;
      height: 40px;
      border: var(--today-num-border);
      border-radius: var(--today-num-radius);
      background: var(--today-num);
      color: var(--on-today-num);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    :host(.desktop) .dow {
      font-size: 12px;
    }

    :host(.desktop) .num {
      font-size: 20px;
    }

    :host(.desktop) .today .num {
      width: 32px;
      height: 32px;
    }

    .all-day {
      padding: 10px 0;
    }

    :host(.desktop) .all-day {
      padding: 8px 0;
    }

    .label {
      padding: 9px 12px 0 0;
      text-align: right;
      font-size: 13px;
      font-weight: 700;
      color: var(--faint);
    }

    :host(.desktop) .label {
      padding: 7px 10px 0 0;
      font-size: 12px;
    }

    .bars {
      --bar: 48px;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      grid-template-rows: repeat(var(--rows), var(--bar));
      row-gap: 8px;
    }

    :host(.desktop) .bars {
      --bar: 30px;
      row-gap: 4px;
    }

    .bar,
    .bar-more {
      min-width: 0;
      margin: 0 4px;
      border: 0;
      border-radius: var(--event-radius);
      font: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      position: relative;
    }

    /* On the wall a bar's hit area takes half the gap on each side, so it is 56 px tall. */
    .bar::after,
    .bar-more::after {
      content: '';
      position: absolute;
      inset: -4px 0;
    }

    :host(.desktop) .bar::after,
    :host(.desktop) .bar-more::after {
      inset: 0;
    }

    .bar {
      box-sizing: border-box;
      padding: 0 12px 0 7px;
      gap: 8px;
      background: var(--member-bg);
      box-shadow: var(--bar-outline);
      border: var(--event-border);
      color: var(--event-ink);
      font-size: 15px;
      font-weight: 600;
      text-align: left;
    }

    /* A bar that runs on past the week is squared off on that side. */
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

    .bar-more {
      padding: 0 10px;
      background: transparent;
      color: var(--quiet);
      font-size: 14px;
      font-weight: 700;
    }

    :host(.desktop) .bar {
      margin: 0 3px;
      padding: 0 10px 0 5px;
      gap: 6px;
      border-radius: var(--event-radius-small);
      font-size: 13px;
    }

    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mark {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      border-radius: 11px;
      background: var(--member-strong);
      border: var(--avatar-border);
      box-sizing: border-box;
      color: var(--on-avatar);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    :host(.desktop) .mark {
      width: 18px;
      height: 18px;
      border-radius: 9px;
      font-size: 10px;
    }

    .bar.selected {
      outline: 3px solid var(--ink);
      outline-offset: 1px;
      z-index: 1;
    }

    app-hour-grid {
      flex: 1;
    }
  `,
})
export class WeekView {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  /** A day in the week to show; null shows this week. */
  readonly focus = input<Day | null>(null);

  /** The wall fits the day's hours on screen; a desktop window scrolls them. */
  readonly layout = input<'wall' | 'desktop'>('wall');

  /** The event whose details are open, outlined so it can be found on the grid. */
  readonly selected = input<string | null>(null);

  /** Whether tapping an empty half hour starts a new event there. */
  readonly canAdd = input(false);

  /** An event was tapped to see its details; carries its id. */
  readonly inspect = output<string>();

  /** A day's heading or a "+N" was tapped, to see the whole day. */
  readonly openDay = output<Day>();

  /** An empty half hour was tapped, to add an event there. */
  readonly create = output<GridSlot>();

  private readonly grid = viewChild(HourGrid);

  private readonly settings = this.family.family;

  private readonly today = computed(() => {
    const family = this.settings();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  protected readonly start = computed(() => {
    const family = this.settings();
    const day = this.focus() ?? this.today();
    return family && day ? startOfWeek(day, family.weekStartsOn) : null;
  });

  private readonly days = computed(() => {
    const start = this.start();
    return start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : [];
  });

  /** A grid column for each day, with its timed events. */
  protected readonly columns = computed<GridColumn[]>(() => {
    const family = this.settings();
    if (!family) {
      return [];
    }
    const segments = timedSegments(this.calendar.events(), this.days(), family.timeZone);
    return this.days().map((day) => ({
      key: day,
      day,
      name: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
      segments: segments.get(day) ?? [],
    }));
  });

  /** Over the grid while the week loads, or when it could not: an empty grid would read as an empty week. */
  protected readonly note = computed<GridNote | null>(() => {
    const status = this.calendar.state().status;
    return status === 'loading' ? { text: 'Loading the week…', waiting: true } : status === 'unavailable' ? { text: "Couldn't load the week" } : null;
  });

  protected readonly week = computed(() => {
    const family = this.settings();
    const days = this.days();
    if (!family || days.length === 0) {
      return null;
    }
    const zone = family.timeZone;
    const writable = new Set(this.calendar.calendars().filter((c) => c.canWrite).map((c) => c.id));

    const allDay = dayBars(this.calendar.events(), days, zone);
    const rows = Math.max(1, allDay.lanes) + (allDay.hidden.some((n) => n > 0) ? 1 : 0);
    const bars = allDay.bars.map((bar) => {
      const event = bar.event;
      const member = peopleOf(event, family.members)[0];
      const readOnly = !writable.has(event.calendarId);
      return {
        id: event.id,
        title: event.title,
        color: colorOf(event, family.members),
        initial: member?.initial ?? 'F',
        avatar: member?.avatar ?? null,
        pending: !!event.pending,
        key: event.id,
        column: `${bar.first + 1} / span ${bar.span}`,
        row: `${bar.lane + 1}`,
        before: bar.continuesBefore,
        after: bar.continuesAfter,
        label: `${event.title}, ${spanLabel(event, zone)}, ${namesOf(event, family.members)}${readOnly ? ', read only' : ''}${event.pending ? ', saving' : ''}`,
      };
    });
    const barsMore = allDay.hidden
      .map((count, i) => ({ count, day: days[i], column: `${i + 1}`, label: `${count} more all-day ${count === 1 ? 'event' : 'events'} on ${formatDay(days[i], { weekday: 'long' })}` }))
      .filter((more) => more.count > 0);

    return {
      rows,
      bars,
      barsMore,
      days: days.map((day) => ({
        day,
        name: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
        dow: formatDay(day, { weekday: 'short' }).toUpperCase(),
        num: Number(day.slice(8)),
        isToday: day === this.today(),
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

  /** Scrolls the grid back to the current hour, as when it opens. */
  scrollToNow(): void {
    this.grid()?.scrollToNow();
  }
}

/** The days an all-day or long event covers, for its name read aloud. */
export function spanLabel(event: CalendarEvent, timeZone: string): string {
  if (!event.allDay) {
    return `${formatDay(dayIn(timeZone, event.startsAt!), { weekday: 'long' })} ${timeIn(timeZone, event.startsAt!)} to ${formatDay(dayIn(timeZone, event.endsAt!), { weekday: 'long' })} ${timeIn(timeZone, event.endsAt!)}`;
  }
  const last = addDays(event.endDate!, -1);
  const from = formatDay(event.startDate!, { weekday: 'long', month: 'long', day: 'numeric' });
  return last === event.startDate ? `all day ${from}` : `all day ${from} to ${formatDay(last, { weekday: 'long', month: 'long', day: 'numeric' })}`;
}
