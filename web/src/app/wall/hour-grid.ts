import { Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { CalendarEvent, CalendarStore, colorOf, timeRange } from '../core/calendar';
import { TimedSegment, arrange, hourLabel, hourRange } from '../core/calendar-grid';
import { Clock } from '../core/clock';
import { Day, dayIn, formatDay, minutesIn, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';

/** Room above the first hour line and below the last, so their labels are not cut off. */
const PAD = 10;

/** How each layout draws the grid. */
const LAYOUTS = {
  /** The wall fits the day's hours without scrolling unless that would make an hour shorter than this. */
  wall: { gap: 4, minHour: 36, fallbackHour: 50, shortBelow: 50, minBlock: 22, lineHeight: 18, titleTop: 32, reach: 56, dayLine: 21, dayTime: 20 },
  /** A desktop window always scrolls the whole day at a fixed height. */
  desktop: { gap: 3, minHour: 48, fallbackHour: 48, shortBelow: 42, minBlock: 18, lineHeight: 16, titleTop: 25, reach: 0, dayLine: 18, dayTime: 17 },
};

/** A new event on the grid, from tapping an empty half hour: its day and 'HH:mm'. */
export interface GridSlot {
  day: Day;
  time: string;
}

/** One column of the grid: a day of the week, or one person's part of a day. */
export interface GridColumn {
  key: string;
  day: Day;
  /** Read aloud for the column, such as "Thursday, October 22" or "Clara". */
  name: string;
  segments: readonly TimedSegment[];
}

/** A note over the grid: why it is empty. A waiting note is only for a read still going. */
export interface GridNote {
  text: string;
  waiting?: boolean;
}

/** Events that did not fit side by side in a column, from a "+N" block. */
export interface GridMore {
  column: GridColumn;
  events: CalendarEvent[];
}

/**
 * The hours of a day as a grid: a gutter of hour labels, then columns where timed events sit by
 * their real start and length, side by side where they overlap, with the now line on today.
 * Week gives it a column per day and Day a column per person. On the wall the hours fit the
 * card; a desktop window scrolls the whole day.
 */
@Component({
  selector: 'app-hour-grid',
  host: { '[class]': 'layout() + " " + variant()', '[style.--hour.px]': 'scale().hour', '[style.--pad.px]': 'pad', '[style.--columns]': 'columns().length' },
  template: `
    <div class="body" #body [class.scrolls]="scale().scrolls">
      <div class="grid" [style.height.px]="scale().height">
        <div class="hours" aria-hidden="true">
          @for (hour of grid().hours; track hour.hour) {
            <span [style.top.px]="hour.top" [class.covered]="hour.covered">{{ hour.label }}</span>
          }
          @if (grid().now; as now) {
            <span class="now-label" [style.top.px]="now.top">{{ now.label }}</span>
          }
        </div>
        @for (column of grid().columns; track column.key) {
          <div class="column" role="group" [attr.aria-label]="column.name" [class.today]="column.isToday && tintToday()" [class.adds]="canAdd()" (click)="tapped($event, column.source)">
            @for (block of column.blocks; track block.key) {
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
                  @if (variant() === 'day') {
                    @if (block.short) {
                      <span class="title">{{ block.title }}</span>
                      <span class="time">{{ block.range }}</span>
                    } @else {
                      <span class="title clamp" [style.--lines]="block.lines">{{ block.title }}</span>
                      <span class="time">{{ block.range }}</span>
                      @if (block.place) {
                        <span class="place">{{ block.place }}</span>
                      }
                    }
                  } @else if (block.short) {
                    <span class="time">{{ block.time }}</span>
                    <span class="title" [class.clamp]="block.narrow" [style.--lines]="block.lines">{{ block.title }}</span>
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
            @for (more of column.more; track more.key) {
              <button
                type="button"
                class="more"
                [style.top.px]="more.top"
                [style.height.px]="more.height"
                [style.left]="more.left"
                [style.width]="more.width"
                [style.--reach.px]="more.reach"
                [attr.aria-label]="more.label"
                (click)="moreOpened.emit({ column: column.source, events: more.events })"
              >
                +{{ more.count }}
              </button>
            }
            @if (column.isToday && grid().now; as now) {
              <span class="now-line" [style.top.px]="now.top" aria-hidden="true"></span>
            }
          </div>
        }
      </div>
    </div>
    @if (note(); as note) {
      <p class="note" [class.waiting]="note.waiting" role="status">{{ note.text }}</p>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 0;
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
      position: relative;
      display: grid;
      grid-template-columns: var(--gutter) repeat(var(--columns), minmax(0, 1fr));
    }

    .hours {
      position: relative;
    }

    .hours span {
      position: absolute;
      right: 12px;
      transform: translateY(-50%);
      font-family: var(--font-time);
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
      border: var(--now-label-border);
      border-radius: var(--now-label-radius);
      background: var(--now-label);
      color: var(--on-now);
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
      border-radius: var(--event-radius);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .event {
      padding: 0;
      background: var(--member-bg);
      box-shadow: var(--event-outline);
      border: var(--event-border);
      color: var(--event-ink);
    }

    /* On the wall a short event still takes a finger: its hit area reaches into free space below. */
    .event::after,
    .more::after {
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

    .time {
      flex-shrink: 0;
      font-size: 13px;
      font-weight: 700;
      font-family: var(--font-time);
      color: var(--member-time);
    }

    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .event .title {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.22;
    }

    .short .title {
      font-size: 14px;
    }

    /* A long word that has to break, in a narrow block, breaks where a dictionary says it may. */
    .event .clamp {
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--lines);
      overflow-wrap: break-word;
      -webkit-hyphens: auto;
      hyphens: auto;
    }

    /* A short block three abreast has no room for its time on the line, so its title takes the lines it has. */
    .short.narrow .content {
      white-space: normal;
    }

    .short.narrow .title {
      line-height: 1.15;
    }

    :host(.desktop) .event,
    :host(.desktop) .more {
      border-radius: var(--event-radius-small);
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

    /* A person's column on the Day view is wide: the title leads, then the times and the place. */
    :host(.day) .content {
      padding: 9px 14px 8px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    :host(.day) .short .content {
      padding: 0 12px;
      flex-direction: row;
      justify-content: space-between;
      gap: 10px;
    }

    /* In a narrow person's column a short block keeps its title and drops the times. */
    :host(.day) .event {
      container-type: inline-size;
    }

    @container (max-width: 240px) {
      .short .time {
        display: none;
      }
    }

    /* When a theme's outline leaves less room than the lines were counted for, the title keeps its
       line and the times below it give way. */
    :host(.day) .event .title {
      flex-shrink: 0;
      font-size: 17px;
      font-weight: 700;
    }

    :host(.day) .short .title {
      font-size: 15px;
    }

    :host(.day) .time {
      font-size: 14px;
      white-space: nowrap;
    }

    .place {
      font-size: 14px;
      font-weight: 500;
      color: var(--event-quiet);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    :host(.day.desktop) .content {
      padding: 6px 10px;
      gap: 2px;
    }

    :host(.day.desktop) .short .content {
      padding: 0 10px;
    }

    :host(.day.desktop) .event .title {
      font-size: 14px;
    }

    :host(.day.desktop) .time,
    :host(.day.desktop) .place {
      font-size: 12px;
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
      box-shadow: 0 0 0 1px var(--now-edge);
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
      box-sizing: border-box;
      border: var(--now-label-border);
      background: var(--now);
    }

    /* A quiet note over the grid, such as an empty day or one still loading. It stays put as the
       grid scrolls, and taps reach the hours beneath. */
    .note {
      position: absolute;
      top: 96px;
      left: var(--gutter);
      right: 0;
      margin: 0;
      text-align: center;
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      color: var(--muted);
      pointer-events: none;
      z-index: 2;
    }

    :host(.desktop) .note {
      top: 72px;
      font-size: 19px;
    }

    /* Loading is only worth saying when it takes a moment, so a quick read never flashes it. */
    .note.waiting {
      animation: appear 0.2s ease-out 0.4s both;
    }

    @keyframes appear {
      from {
        opacity: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .note.waiting {
        animation-duration: 0s;
      }
    }

    /* Only the first column's line starts with a dot; the rest carry it across. */
    :host(.day) .column ~ .column .now-line::before {
      display: none;
    }
  `,
})
export class HourGrid {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly columns = input.required<readonly GridColumn[]>();

  /** The wall fits the day's hours on screen; a desktop window scrolls them. */
  readonly layout = input<'wall' | 'desktop'>('wall');

  /** Week blocks lead with the time and owner; Day blocks, in a person's own column, with the title. */
  readonly variant = input<'week' | 'day'>('week');

  /** What is on screen, such as the week's first day: the grid scrolls back to its opening only when it changes. */
  readonly anchor = input.required<string>();

  /** Whether today's column is tinted; Day shows only one day, so it is not. */
  readonly tintToday = input(true);

  /** The event whose details are open, outlined so it can be found on the grid. */
  readonly selected = input<string | null>(null);

  /** Whether tapping an empty half hour starts a new event there. */
  readonly canAdd = input(false);

  /** Said over the grid when it has nothing to show yet, or nothing at all; waiting notes fade in late. */
  readonly note = input<GridNote | null>(null);

  /** An event was tapped to see its details; carries its id. */
  readonly inspect = output<string>();

  /** A "+N" block was tapped. */
  readonly moreOpened = output<GridMore>();

  /** An empty half hour was tapped, to add an event there. */
  readonly create = output<GridSlot>();

  protected readonly pad = PAD;

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly bodyHeight = signal(0);

  /** Bumped to scroll the grid back to now, as the wall does when it has been left alone. */
  private readonly scrollRequest = signal(0);

  private readonly today = computed(() => {
    const family = this.family.family();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  private readonly segments = computed(() => this.columns().flatMap((column) => column.segments));

  /** The hours shown and how tall each is; the wall grows its hours to fit the events on screen. */
  protected readonly scale = computed(() => {
    const layout = LAYOUTS[this.layout()];
    const range = this.layout() === 'desktop' ? { first: 0, last: 24 } : hourRange(this.segments());
    const hours = range.last - range.first;
    const available = this.bodyHeight() - 2 * PAD;
    const fit = available > 0 ? available / hours : layout.fallbackHour;
    const scrolls = this.layout() === 'desktop' || fit < layout.minHour;
    const hour = scrolls ? layout.minHour : fit;
    return { ...range, hour, scrolls, height: hours * hour + 2 * PAD };
  });

  private readonly scrolls = computed(() => this.scale().scrolls);

  protected readonly grid = computed(() => {
    const family = this.family.family();
    const columns = this.columns();
    const zone = family?.timeZone ?? 'UTC';
    const members = family?.members ?? [];
    const layout = LAYOUTS[this.layout()];
    const { first, last, hour } = this.scale();
    const perMinute = hour / 60;
    const y = (minutes: number) => PAD + (minutes - first * 60) * perMinute;
    const writable = new Set(this.calendar.calendars().filter((c) => c.canWrite).map((c) => c.id));
    const today = this.today();

    const now = this.clock.now();
    const nowMinutes = minutesIn(zone, now);
    const showsNow = columns.some((column) => column.day === today) && nowMinutes >= first * 60 && nowMinutes <= last * 60;

    const across = (lane: number, lanes: number) => ({
      left: `calc(${(lane * 100) / lanes}% + ${layout.gap}px)`,
      width: `calc(${100 / lanes}% - ${2 * layout.gap}px)`,
    });
    const reach = (height: number, room: number) => (layout.reach ? Math.max(height, Math.min(layout.reach, height + room * perMinute)) : null);

    return {
      hours: Array.from({ length: last - first + 1 }, (_, i) => ({
        hour: first + i,
        label: hourLabel(first + i),
        top: y((first + i) * 60),
        covered: showsNow && Math.abs(y((first + i) * 60) - y(nowMinutes)) < 16,
      })),
      now: showsNow ? { top: y(nowMinutes), label: timeIn(zone, now).replace(/\s?[AP]M$/, '') } : null,
      columns: columns.map((column) => {
        const { placed, more } = arrange(column.segments);
        const weekday = formatDay(column.day, { weekday: 'long' });
        return {
          key: column.key,
          name: column.name,
          source: column,
          isToday: column.day === today,
          blocks: placed.map((segment) => {
            const event = segment.event;
            const member = members.find((m) => m.id === event.memberId);
            const who = member?.displayName ?? 'Family';
            const readOnly = !writable.has(event.calendarId);
            const height = Math.max((segment.end - segment.start) * perMinute - 3, layout.minBlock);
            const short = height < layout.shortBelow;
            // A Day block names its place only when the title, times and place all have a line.
            const place = this.variant() === 'day' && event.location && height >= 18 + layout.dayTime + 2 * layout.dayLine ? event.location : null;
            return {
              ...across(segment.lane, segment.lanes),
              id: event.id,
              key: `${event.id}@${column.key}`,
              title: event.title,
              color: colorOf(event, members),
              initial: member?.initial ?? 'F',
              pending: !!event.pending,
              top: y(segment.start) + 1,
              height,
              short,
              narrow: segment.lanes >= 3,
              reach: reach(height, segment.room),
              lines:
                this.variant() === 'day'
                  ? Math.max(1, Math.floor((height - 18 - layout.dayTime - (place ? layout.dayLine : 0)) / layout.dayLine))
                  : short
                    ? Math.max(1, Math.floor((height - 4) / layout.lineHeight))
                    : Math.max(1, Math.floor((height - layout.titleTop) / layout.lineHeight)),
              time: segment.continuesBefore ? `Until ${shortTime(timeIn(zone, event.endsAt!))}` : shortTime(timeIn(zone, event.startsAt!)),
              range: timeRange(event, zone),
              place,
              label: `${event.title}, ${weekday} ${timeRange(event, zone)}, ${who}${readOnly ? ', read only' : ''}${event.pending ? ', saving' : ''}`,
            };
          }),
          more: more.map((block) => {
            const height = Math.max((block.end - block.start) * perMinute - 3, layout.minBlock);
            return {
              ...across(block.lane, block.lanes),
              key: `${column.key}@${block.start}`,
              count: block.events.length,
              events: block.events,
              top: y(block.start) + 1,
              height,
              reach: reach(height, block.room),
              label:
                this.variant() === 'day'
                  ? `${block.events.length} more events for ${column.name} from ${timeIn(zone, block.events[0].startsAt!)}`
                  : `${block.events.length} more events from ${timeIn(zone, block.events[0].startsAt!)}, open ${weekday}`,
            };
          }),
        };
      }),
    };
  });

  constructor() {
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

    // Open a scrolling grid near now, or at the first event on another day. Only a new anchor, a
    // change between fitting and scrolling, or a request moves it: refreshes and live updates never do.
    let frame = 0;
    effect(() => {
      this.anchor();
      const scrolls = this.scrolls();
      this.scrollRequest();
      const body = this.body()?.nativeElement;
      if (!body) {
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
    const family = this.family.family();
    const { first, hour } = this.scale();
    if (!family) {
      return 0;
    }
    let minutes: number;
    if (this.columns().some((column) => column.day === this.today())) {
      const now = minutesIn(family.timeZone, this.clock.now());
      // Desktop opens a little above the previous whole hour, so the hour's label and its events show from their start.
      minutes = Math.floor(now / 60) * 60 - (this.layout() === 'desktop' ? 75 : 30);
    } else {
      const starts = this.segments().map((segment) => segment.start);
      minutes = (starts.length ? Math.min(...starts) : 8 * 60) - 30;
    }
    return Math.max(0, (minutes - first * 60) * (hour / 60));
  }

  /** An empty part of a column was tapped: start a new event at that half hour. */
  protected tapped(event: MouseEvent, column: GridColumn): void {
    if (!this.canAdd() || event.target !== event.currentTarget) {
      return;
    }
    const { first, hour } = this.scale();
    const minutes = first * 60 + ((event.offsetY - PAD) / hour) * 60;
    const slot = Math.min(Math.max(Math.floor(minutes / 30) * 30, 0), 23 * 60 + 30);
    this.create.emit({ day: column.day, time: `${String(Math.floor(slot / 60)).padStart(2, '0')}:${String(slot % 60).padStart(2, '0')}` });
  }
}

/** "3:15 PM" as "3:15 pm", and "3:00 PM" as "3 pm", to fit a narrow block. */
function shortTime(time: string): string {
  return time.replace(':00', '').replace(/\s?([AP]M)$/, (_, half: string) => ` ${half.toLowerCase()}`);
}
