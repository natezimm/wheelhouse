import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { CalendarEvent, CalendarStore, colorOf, timeRange } from '../core/calendar';
import { arrange, dayBars, hourLabel, hourRange, timedSegments } from '../core/calendar-grid';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, minutesIn, startOfWeek, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';

/** Room above the first hour line and below the last, so their labels are not cut off. */
const PAD = 10;

/** How each layout draws the grid. */
const LAYOUTS = {
  /** The wall fits the day's hours without scrolling unless that would make an hour shorter than this. */
  wall: { gap: 4, minHour: 36, fallbackHour: 50, shortBelow: 50, minBlock: 22, lineHeight: 18, titleTop: 32, reach: 56 },
  /** A desktop window always scrolls the whole day at a fixed height. */
  desktop: { gap: 3, minHour: 48, fallbackHour: 48, shortBelow: 42, minBlock: 18, lineHeight: 16, titleTop: 25, reach: 0 },
};

/** A new event on the grid, from tapping an empty half hour: its day and 'HH:mm'. */
export interface GridSlot {
  day: Day;
  time: string;
}

/**
 * The week on a shared hour grid: seven aligned day columns, all-day and long events as bars
 * above them, timed events placed by their real start and length, side by side where they
 * overlap, and the now line on today. Used by the wall and by a desktop window.
 */
@Component({
  selector: 'app-week-view',
  host: { '[class]': 'layout()', '[style.--hour.px]': 'scale().hour', '[style.--pad.px]': 'pad' },
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
              <span class="mark" aria-hidden="true">{{ bar.initial }}</span>
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

      <div class="body" #body [class.scrolls]="scale().scrolls">
        <div class="grid" [style.height.px]="scale().height">
          <div class="hours" aria-hidden="true">
            @for (hour of week.hours; track hour.hour) {
              <span [style.top.px]="hour.top" [class.covered]="hour.covered">{{ hour.label }}</span>
            }
            @if (week.now; as now) {
              <span class="now-label" [style.top.px]="now.top">{{ now.label }}</span>
            }
          </div>
          @for (day of week.days; track day.day) {
            <div class="column" role="group" [attr.aria-label]="day.name" [class.today]="day.isToday" [class.adds]="canAdd()" (click)="tapped($event, day.day)">
              @for (block of day.blocks; track block.key) {
                <button
                  type="button"
                  class="event"
                  [class.short]="block.short"
                  [class.narrow]="block.narrow"
                  [class.selected]="block.id === selected()"
                  [class.calendar-pending]="block.pending"
                  [attr.aria-busy]="block.pending"
                  [style.--member]="block.color"
                  [style.top.px]="block.top"
                  [style.height.px]="block.height"
                  [style.--reach.px]="block.reach"
                  [style.left]="block.left"
                  [style.width]="block.width"
                  [attr.aria-label]="block.label"
                  (click)="inspect.emit(block.id)"
                >
                  <span class="content">
                    @if (block.short) {
                      <span class="time">{{ block.time }}</span>
                      <span class="title">{{ block.title }}</span>
                    } @else {
                      <span class="top">
                        <span class="time">{{ block.time }}</span>
                        <span class="mark" aria-hidden="true">{{ block.initial }}</span>
                      </span>
                      <span class="title clamp" [style.--lines]="block.lines">{{ block.title }}</span>
                    }
                  </span>
                </button>
              }
              @for (more of day.more; track more.key) {
                <button
                  type="button"
                  class="more"
                  [style.top.px]="more.top"
                  [style.height.px]="more.height"
                  [style.left]="more.left"
                  [style.width]="more.width"
                  [attr.aria-label]="more.label"
                  (click)="openDay.emit(day.day)"
                >
                  +{{ more.count }}
                </button>
              }
              @if (day.isToday && week.now; as now) {
                <span class="now-line" [style.top.px]="now.top" aria-hidden="true"></span>
              }
            </div>
          }
        </div>
      </div>
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
      background: var(--today-tint);
    }

    .dow {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--faint);
    }

    .today .dow {
      color: var(--ink);
    }

    .num {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 600;
      line-height: 1;
    }

    .today .num {
      width: 40px;
      height: 40px;
      border-radius: 20px;
      background: var(--ink);
      color: var(--on-ink);
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
      border-radius: 16px;
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
      --bar: 36px;
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      grid-template-rows: repeat(var(--rows), var(--bar));
      row-gap: 6px;
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
      border-radius: 10px;
      font: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
    }

    .bar {
      box-sizing: border-box;
      padding: 0 12px 0 7px;
      gap: 8px;
      background: color-mix(in srgb, var(--member) var(--member-fill), var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--member) var(--member-ring), var(--surface));
      color: var(--ink);
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
      border-radius: 8px;
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
      background: color-mix(in srgb, var(--member) var(--member-shade), black);
      color: var(--on-ink);
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

    .body {
      position: relative;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    .body.scrolls {
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .grid {
      display: grid;
      grid-template-columns: var(--gutter) repeat(7, minmax(0, 1fr));
    }

    .hours {
      position: relative;
    }

    .hours span {
      position: absolute;
      right: 12px;
      transform: translateY(-50%);
      font-size: 13px;
      font-weight: 600;
      color: var(--faint);
      white-space: nowrap;
    }

    :host(.desktop) .hours span {
      right: 10px;
      font-size: 12px;
    }

    /* An hour label the now label sits on gives way to it. */
    .hours .covered {
      visibility: hidden;
    }

    .hours .now-label {
      right: 8px;
      padding: 1px 6px;
      border-radius: 8px;
      background: var(--now);
      color: var(--on-ink);
      font-weight: 700;
      z-index: 1;
    }

    .column {
      position: relative;
      min-width: 0;
      border-left: 1px solid var(--rule);
      background-image: linear-gradient(var(--hour-rule) 1px, transparent 1px);
      background-size: 100% var(--hour);
      background-position: 0 var(--pad);
    }

    .column.today {
      background-color: var(--today-tint);
    }

    .column.adds {
      cursor: pointer;
    }

    .event,
    .more {
      position: absolute;
      box-sizing: border-box;
      border: 0;
      border-radius: 10px;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .event {
      padding: 0;
      background: color-mix(in srgb, var(--member) var(--member-fill), var(--surface));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--member) var(--member-ring), var(--surface));
      color: var(--ink);
    }

    /* On the wall a short event still takes a finger: its hit area reaches into free space below. */
    .event::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: var(--reach, 100%);
    }

    /* Block, not flex, so the title can clamp to the lines that fit. */
    .content {
      display: block;
      height: 100%;
      box-sizing: border-box;
      padding: 7px 9px 6px 10px;
      overflow: hidden;
    }

    .short .content {
      padding: 0 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .top {
      margin-bottom: 3px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    /* Three side by side leave room for the time and title only; a short one keeps the title. */
    .narrow .mark,
    .narrow.short .time {
      display: none;
    }

    .time {
      flex-shrink: 0;
      font-size: 13px;
      font-weight: 700;
      color: color-mix(in srgb, var(--member) var(--member-shade), black);
    }

    .event .title {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.22;
    }

    .short .title {
      font-size: 14px;
    }

    .event .clamp {
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--lines);
      overflow-wrap: break-word;
    }

    :host(.desktop) .event,
    :host(.desktop) .more {
      border-radius: 8px;
    }

    :host(.desktop) .content {
      padding: 5px 8px;
    }

    :host(.desktop) .top {
      margin-bottom: 2px;
    }

    :host(.desktop) .short .content {
      padding: 0 8px;
      gap: 5px;
    }

    :host(.desktop) .time {
      font-size: 12px;
    }

    :host(.desktop) .event .title {
      font-size: 13px;
    }

    .more {
      padding: 0;
      background: var(--soft);
      box-shadow: inset 0 0 0 1px var(--line);
      color: var(--quiet);
      font-size: 15px;
      font-weight: 700;
      text-align: center;
    }

    .selected {
      outline: 3px solid var(--ink);
      outline-offset: 1px;
      z-index: 1;
    }

    .now-line {
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      margin-top: -1px;
      background: var(--now);
      pointer-events: none;
      z-index: 2;
    }

    .now-line::before {
      content: '';
      position: absolute;
      left: -6px;
      top: -5px;
      width: 12px;
      height: 12px;
      border-radius: 6px;
      background: var(--now);
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

  protected readonly pad = PAD;

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly bodyHeight = signal(0);

  /** Bumped to scroll the grid back to now, as the wall does when it has been left alone. */
  private readonly scrollRequest = signal(0);

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

  private readonly days = computed(() => {
    const start = this.start();
    return start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : [];
  });

  private readonly segments = computed(() => {
    const family = this.settings();
    return family ? timedSegments(this.calendar.events(), this.days(), family.timeZone) : new Map();
  });

  /** The hours shown and how tall each is; the wall grows its hours to fit the week's events. */
  protected readonly scale = computed(() => {
    const layout = LAYOUTS[this.layout()];
    const range = this.layout() === 'desktop' ? { first: 0, last: 24 } : hourRange([...this.segments().values()].flat());
    const hours = range.last - range.first;
    const available = this.bodyHeight() - 2 * PAD;
    const fit = available > 0 ? available / hours : layout.fallbackHour;
    const scrolls = this.layout() === 'desktop' || fit < layout.minHour;
    const hour = this.layout() === 'desktop' ? layout.minHour : scrolls ? layout.minHour : fit;
    return { ...range, hour, scrolls, height: hours * hour + 2 * PAD };
  });

  private readonly scrolls = computed(() => this.scale().scrolls);

  protected readonly week = computed(() => {
    const family = this.settings();
    const days = this.days();
    if (!family || days.length === 0) {
      return null;
    }
    const zone = family.timeZone;
    const layout = LAYOUTS[this.layout()];
    const { first, last, hour } = this.scale();
    const perMinute = hour / 60;
    const y = (minutes: number) => PAD + (minutes - first * 60) * perMinute;
    const writable = new Set(this.calendar.calendars().filter((c) => c.canWrite).map((c) => c.id));

    const describe = (event: CalendarEvent) => {
      const member = family.members.find((m) => m.id === event.memberId);
      const who = member?.displayName ?? 'Family';
      const readOnly = !writable.has(event.calendarId);
      return {
        id: event.id,
        title: event.title,
        color: colorOf(event, family.members),
        initial: member?.initial ?? 'F',
        pending: !!event.pending,
        who,
        suffix: `, ${who}${readOnly ? ', read only' : ''}${event.pending ? ', saving' : ''}`,
      };
    };

    const allDay = dayBars(this.calendar.events(), days, zone);
    const rows = Math.max(1, allDay.lanes) + (allDay.hidden.some((n) => n > 0) ? 1 : 0);
    const bars = allDay.bars.map((bar) => {
      const shown = describe(bar.event);
      return {
        ...shown,
        key: bar.event.id,
        column: `${bar.first + 1} / span ${bar.span}`,
        row: `${bar.lane + 1}`,
        before: bar.continuesBefore,
        after: bar.continuesAfter,
        label: `${shown.title}, ${spanLabel(bar.event, zone)}${shown.suffix}`,
      };
    });
    const barsMore = allDay.hidden
      .map((count, i) => ({ count, day: days[i], column: `${i + 1}`, label: `${count} more all-day ${count === 1 ? 'event' : 'events'} on ${formatDay(days[i], { weekday: 'long' })}` }))
      .filter((more) => more.count > 0);

    const now = this.clock.now();
    const nowMinutes = minutesIn(zone, now);
    const showsNow = days.includes(this.today()!) && nowMinutes >= first * 60 && nowMinutes <= last * 60;

    return {
      rows,
      bars,
      barsMore,
      hours: Array.from({ length: last - first + 1 }, (_, i) => ({
        hour: first + i,
        label: hourLabel(first + i),
        top: y((first + i) * 60),
        covered: showsNow && Math.abs(y((first + i) * 60) - y(nowMinutes)) < 16,
      })),
      now: showsNow ? { top: y(nowMinutes), label: timeIn(zone, now).replace(/\s?[AP]M$/, '') } : null,
      days: days.map((day) => {
        const { placed, more } = arrange(this.segments().get(day) ?? []);
        const weekday = formatDay(day, { weekday: 'long' });
        const across = (lane: number, lanes: number) => ({
          left: `calc(${(lane * 100) / lanes}% + ${layout.gap}px)`,
          width: `calc(${100 / lanes}% - ${2 * layout.gap}px)`,
        });
        return {
          day,
          name: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
          dow: formatDay(day, { weekday: 'short' }).toUpperCase(),
          num: Number(day.slice(8)),
          isToday: day === this.today(),
          blocks: placed.map((segment) => {
            const shown = describe(segment.event);
            const height = Math.max((segment.end - segment.start) * perMinute - 3, layout.minBlock);
            const short = height < layout.shortBelow;
            return {
              ...shown,
              ...across(segment.lane, segment.lanes),
              key: `${segment.event.id}@${day}`,
              top: y(segment.start) + 1,
              height,
              short,
              narrow: segment.lanes >= 3,
              reach: layout.reach ? Math.max(height, Math.min(layout.reach, height + segment.room * perMinute)) : null,
              lines: Math.max(1, Math.floor((height - layout.titleTop) / layout.lineHeight)),
              time: segment.continuesBefore ? `Until ${shortTime(timeIn(zone, segment.event.endsAt!))}` : shortTime(timeIn(zone, segment.event.startsAt!)),
              label: `${shown.title}, ${weekday} ${timeRange(segment.event, zone)}${shown.suffix}`,
            };
          }),
          more: more.map((block) => ({
            ...across(block.lane, block.lanes),
            key: `${day}@${block.start}`,
            count: block.events.length,
            top: y(block.start) + 1,
            height: Math.max((block.end - block.start) * perMinute - 3, layout.minBlock),
            label: `${block.events.length} more events from ${timeIn(zone, block.events[0].startsAt!)}, open ${weekday}`,
          })),
        };
      }),
    };
  });

  constructor() {
    effect(() => {
      const start = this.start();
      if (start) {
        this.calendar.show(start, addDays(start, 7));
      }
    });

    // Follow the space the grid has, so the wall's hours fill it.
    effect((onCleanup) => {
      const body = this.body()?.nativeElement;
      if (!body || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(() => this.bodyHeight.set(body.clientHeight));
      observer.observe(body);
      onCleanup(() => observer.disconnect());
    });

    // Open a scrolling grid near now, or at the week's first event. Only a new week, a change
    // between fitting and scrolling, or a request moves it: refreshes and live updates never do.
    let frame = 0;
    effect(() => {
      const start = this.start();
      const scrolls = this.scrolls();
      this.scrollRequest();
      const body = this.body()?.nativeElement;
      if (!start || !body) {
        return;
      }
      untracked(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          body.scrollTop = scrolls ? this.openingTop() : 0;
        });
      });
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(frame));
  }

  /** Scrolls the grid back to the current hour, as when it opens. */
  scrollToNow(): void {
    this.scrollRequest.update((n) => n + 1);
  }

  private openingTop(): number {
    const family = this.settings();
    const { first, hour } = this.scale();
    if (!family) {
      return 0;
    }
    const days = this.days();
    let minutes: number;
    if (days.includes(this.today()!)) {
      const now = minutesIn(family.timeZone, this.clock.now());
      minutes = this.layout() === 'desktop' ? now - 60 : Math.floor(now / 60) * 60 - 30;
    } else {
      const starts = [...this.segments().values()].flat().map((segment) => segment.start);
      minutes = (starts.length ? Math.min(...starts) : 8 * 60) - 30;
    }
    return Math.max(0, (minutes - first * 60) * (hour / 60));
  }

  /** An empty part of a day was tapped: start a new event at that half hour. */
  protected tapped(event: MouseEvent, day: Day): void {
    if (!this.canAdd() || event.target !== event.currentTarget) {
      return;
    }
    const { first, hour } = this.scale();
    const minutes = first * 60 + ((event.offsetY - PAD) / hour) * 60;
    const slot = Math.min(Math.max(Math.floor(minutes / 30) * 30, 0), 23 * 60 + 30);
    this.create.emit({ day, time: `${String(Math.floor(slot / 60)).padStart(2, '0')}:${String(slot % 60).padStart(2, '0')}` });
  }
}

/** "3:15 PM" as "3:15 pm", and "3:00 PM" as "3 pm", to fit a narrow block. */
function shortTime(time: string): string {
  return time.replace(':00', '').replace(/\s?([AP]M)$/, (_, half: string) => ` ${half.toLowerCase()}`);
}

/** The days an all-day or long event covers, for its name read aloud. */
function spanLabel(event: CalendarEvent, timeZone: string): string {
  if (!event.allDay) {
    return `${formatDay(dayIn(timeZone, event.startsAt!), { weekday: 'long' })} ${timeIn(timeZone, event.startsAt!)} to ${formatDay(dayIn(timeZone, event.endsAt!), { weekday: 'long' })} ${timeIn(timeZone, event.endsAt!)}`;
  }
  const last = addDays(event.endDate!, -1);
  const from = formatDay(event.startDate!, { weekday: 'long', month: 'long', day: 'numeric' });
  return last === event.startDate ? `all day ${from}` : `all day ${from} to ${formatDay(last, { weekday: 'long', month: 'long', day: 'numeric' })}`;
}
