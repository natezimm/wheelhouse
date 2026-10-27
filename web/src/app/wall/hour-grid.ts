import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { CalendarEvent, CalendarStore, FAMILY_COLOR, colorOf, namesOf, peopleOf, timeRange } from '../core/calendar';
import { STEP_MINUTES, clockLabel, movedTo, requestOf, resizedTo } from '../core/event-draft';
import { TimedSegment, arrange, hourLabel, hourRange } from '../core/calendar-grid';
import { Clock } from '../core/clock';
import { Day, dayIn, formatDay, minutesIn, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { ThemeService } from '../core/theme';
import { AvatarFace } from '../shared/avatar-face';

/** How many minutes before its start an event shows as about to start. */
export const SOON_MINUTES = 10;

/** Whole minutes until a timed event starts, rounded up, while that is within SOON_MINUTES; otherwise null. */
export function soonIn(event: CalendarEvent, continuesBefore: boolean, now: Date): number | null {
  if (event.allDay || continuesBefore || !event.startsAt) return null;
  const minutes = Math.ceil((Date.parse(event.startsAt) - now.getTime()) / 60_000);
  return minutes >= 1 && minutes <= SOON_MINUTES ? minutes : null;
}

/** How far the wall's resize grip reaches below an event into free space, making it 56 px with its 16 px inside. */
const GRIP_BELOW = 40;

/** Room above the first hour line and below the last, so their labels are not cut off. */
const PAD = 10;

/** How each layout draws the grid. */
const LAYOUTS = {
  /** The wall fits the day's hours without scrolling unless that would make an hour shorter than this. */
  wall: { gap: 4, minHour: 36, fallbackHour: 50, shortBelow: 50, minBlock: 22, lineHeight: 18, titleTop: 32, reach: 56, dayLine: 21, dayTime: 20 },
  /** A desktop window always scrolls the whole day at a fixed height. */
  desktop: { gap: 3, minHour: 48, fallbackHour: 48, shortBelow: 42, minBlock: 18, lineHeight: 16, titleTop: 25, reach: 0, dayLine: 18, dayTime: 17 },
};

/** How far a mouse or pen moves before a press becomes a drag, and a finger before a long press gives way to scrolling. */
const DRAG_SLOP = 6;
const TOUCH_SLOP = 10;

/** A finger holds an event this long to pick it up, so a tap still opens it and a swipe still scrolls. */
const LONG_PRESS = 350;

/** How close to the top or bottom of a scrolling grid a dragged event scrolls it, and how fast. */
const EDGE = 48;
const EDGE_SPEED = 14;

/**
 * An event being dragged to another time or day, or by its bottom edge to a new end: where it was
 * picked up and where it would land.
 */
interface Drag {
  event: CalendarEvent;
  /** Moving keeps the length; resizing keeps the start and changes the end. */
  mode: 'move' | 'resize';
  pointerId: number;
  touch: boolean;
  /** Where the press began, and where the pointer is now, in the window. */
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  /** Minutes between the event's start (its end, for a resize) and the point it was picked up by. */
  grab: number;
  /** The column and minute of the day it started in. */
  fromColumn: string;
  fromDay: Day;
  fromStart: number;
  /** Whether the press has become a drag; until then it may still be a tap. */
  moving: boolean;
  column: string;
  day: Day;
  start: number;
  /** The minute of the day it ends at, and where a resize would end it. */
  fromEnd: number;
  end: number;
}

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
  imports: [AvatarFace],
  host: {
    '[class]': 'layout() + " " + variant()',
    '[class.dragging]': '!!drag()?.moving',
    '[style.--hour.px]': 'scale().hour',
    '[style.--pad.px]': 'pad',
    '[style.--gap.px]': 'gap()',
    '[style.--columns]': 'columns().length',
  },
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
                [class.movable]="block.movable"
                [class.lifted]="block.id === lifted()"
                [class.soon]="block.soon !== null"
                [attr.aria-busy]="block.pending"
                [style.--member]="block.color"
                [style.top.px]="block.top"
                [style.height.px]="block.height"
                [style.--reach.px]="block.reach"
                [style.--grip-below.px]="block.gripBelow"
                [style.left]="block.left"
                [style.width]="block.width"
                [attr.aria-label]="block.label"
                (click)="inspect.emit(block.id)"
                (pointerdown)="press($event, block.segment, column.source, block.movable)"
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
                      <span class="marks" aria-hidden="true">
                        <span class="mark"><app-avatar-face [initial]="block.initial" [avatar]="block.avatar" /></span>
                        @for (other of block.also; track other.id) {
                          <span class="mark also" [style.--member]="other.color"><app-avatar-face [initial]="other.initial" [avatar]="other.avatar" /></span>
                        }
                      </span>
                    </span>
                    <span class="title clamp" [style.--lines]="block.lines">{{ block.title }}</span>
                  }
                </span>
                @if (block.resizable) {
                  <span class="resize" aria-hidden="true" (pointerdown)="press($event, block.segment, column.source, true, 'resize')"></span>
                }
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
            @if (preview(); as preview) {
              @if (preview.column === column.key) {
                <div class="event preview" [class.short]="preview.short" [style.--member]="preview.color" [style.top.px]="preview.top" [style.height.px]="preview.height" aria-hidden="true">
                  <span class="content">
                    <span class="time">{{ preview.range }}</span>
                    <span class="title">{{ preview.title }}</span>
                  </span>
                </div>
                @if (choosing()) {
                  <div
                    class="chooser"
                    role="dialog"
                    [attr.aria-label]="preview.resizing ? 'Change a repeating event' : 'Move a repeating event'"
                    [class.end]="preview.end"
                    [class.above]="preview.above"
                    [style.top.px]="preview.above ? preview.top - 8 : preview.top + preview.height + 8"
                    (pointerdown)="$event.stopPropagation()"
                  >
                    <span class="ask">{{ preview.resizing ? 'Change which events to' : preview.sameDay ? 'Move which events to' : 'Move this event to' }} {{ preview.when }}?</span>
                    <button type="button" (click)="drop(false)">This event</button>
                    @if (preview.sameDay) {
                      <button type="button" (click)="drop(true)">All events</button>
                    }
                    <button type="button" class="cancel" (click)="cancel()">Cancel</button>
                  </div>
                }
              }
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
      -webkit-touch-callout: none;
      user-select: none;
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

    /* The bottom edge pulls the end: a grip shows where to take it, and its reach takes a finger. */
    .resize {
      position: absolute;
      z-index: 1;
      left: 0;
      right: 0;
      bottom: -6px;
      height: 16px;
      cursor: ns-resize;
      touch-action: none;
    }

    .resize::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: 8px;
      width: 28px;
      height: 4px;
      margin-left: -14px;
      border-radius: 2px;
      background: var(--member-strong);
      opacity: 0;
      transition: opacity 0.15s;
    }

    :host(.wall) .resize {
      bottom: calc(-1 * var(--grip-below, 0px));
      height: calc(16px + var(--grip-below, 0px));
    }

    :host(.wall) .resize::before {
      bottom: calc(6px + var(--grip-below, 0px));
      opacity: 0.45;
    }

    .event:hover .resize::before,
    .event.selected .resize::before,
    .resize:hover::before {
      opacity: 0.8;
    }

    .short .resize::before,
    .narrow .resize::before {
      width: 18px;
      margin-left: -9px;
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

    /* An event for two people shows both faces, the second tucked under the first. */
    .marks {
      flex-shrink: 0;
      display: flex;
    }

    .marks > .mark:first-child {
      position: relative;
      z-index: 1;
    }

    .mark.also {
      margin-left: -6px;
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

    /* On one line the title gives way to the times, so "12:15 – 1:00 PM" is never cut. */
    :host(.day) .short .title {
      flex-shrink: 1;
      min-width: 0;
      font-size: 15px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    :host(.day) .short .time {
      flex-shrink: 0;
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

    /* While an event is dragged it stays faintly where it was, and a lifted copy shows where it lands. */
    .lifted {
      opacity: 0.35;
    }

    :host(.dragging),
    :host(.dragging) .event {
      cursor: grabbing;
      user-select: none;
    }

    .preview {
      left: var(--gap);
      right: var(--gap);
      outline: 2px solid var(--member-strong);
      box-shadow: var(--event-lift), var(--event-outline);
      pointer-events: none;
      z-index: 3;
    }

    .preview .content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .preview.short .content {
      flex-direction: row;
    }

    /* A repeating event asks whether the move is for it alone or for every event of its series. */
    .chooser {
      position: absolute;
      left: var(--gap);
      z-index: 4;
      width: max-content;
      max-width: 300px;
      box-sizing: border-box;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--surface);
      border: var(--card-border);
      border-radius: var(--card-radius);
      box-shadow: var(--dialog-shadow);
      color: var(--ink);
    }

    .chooser.end {
      left: auto;
      right: var(--gap);
    }

    .chooser.above {
      transform: translateY(-100%);
    }

    .ask {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.3;
    }

    .chooser button {
      min-height: 56px;
      padding: 0 18px;
      border: 0;
      border-radius: 28px;
      background: var(--primary);
      color: var(--on-primary);
      font: 700 16px var(--font-body);
      cursor: pointer;
    }

    .chooser .cancel {
      background: var(--soft);
      color: var(--ink);
    }

    :host(.desktop) .chooser {
      padding: 10px;
    }

    :host(.desktop) .ask {
      font-size: 13px;
    }

    :host(.desktop) .chooser button {
      min-height: 44px;
      border-radius: 22px;
      font-size: 14px;
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

    /* An event about to start: a ring in its owner's color that breathes, and "In 8 min" for its time. */
    .event.soon {
      box-shadow: 0 0 0 3px var(--member-strong), var(--event-outline);
      animation: soon 2.4s ease-in-out infinite;
    }

    .event.soon .time {
      color: var(--member-time);
      font-weight: 800;
    }

    @keyframes soon {
      50% {
        box-shadow: 0 0 0 6px var(--member-edge), var(--event-outline);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .note.waiting,
      .event.soon {
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
  private readonly theme = inject(ThemeService);

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
  protected readonly gap = computed(() => LAYOUTS[this.layout()].gap);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The event being dragged, from the press that may become a drag until it is dropped. */
  protected readonly drag = signal<Drag | null>(null);

  /** A repeating event was dropped somewhere new, and asks whether the move is for it alone or its series. */
  protected readonly choosing = signal(false);

  /** The event left faintly in place while it is dragged. */
  protected readonly lifted = computed(() => (this.drag()?.moving ? this.drag()!.event.id : null));

  /** Where a dragged event would land, drawn over the grid with its new times. */
  protected readonly preview = computed(() => {
    const drag = this.drag();
    if (!drag?.moving) {
      return null;
    }
    const layout = LAYOUTS[this.layout()];
    const { first, hour, height: gridHeight } = this.scale();
    const perMinute = hour / 60;
    const resizing = drag.mode === 'resize';
    const length = resizing ? drag.end - drag.start : (Date.parse(drag.event.endsAt!) - Date.parse(drag.event.startsAt!)) / 60_000;
    const top = PAD + (drag.start - first * 60) * perMinute + 1;
    const height = Math.max(length * perMinute - 3, layout.minBlock);
    const draft = this.draftFor(drag);
    const range = `${clockLabel(draft.startTime)} – ${clockLabel(draft.endTime)}`;
    const columns = this.columns();
    const index = columns.findIndex((column) => column.key === drag.column);
    return {
      column: drag.column,
      top,
      height,
      short: height < layout.shortBelow,
      title: drag.event.title,
      color: colorOf(drag.event, this.family.family()?.members ?? []),
      range,
      when: resizing ? `end at ${clockLabel(draft.endTime)}` : `${drag.day === drag.fromDay ? '' : formatDay(drag.day, { weekday: 'long' }) + ' '}${clockLabel(draft.startTime)}`,
      resizing,
      sameDay: drag.day === drag.fromDay,
      // The question opens toward the room it has: leftward from the last columns, upward near the bottom.
      end: columns.length > 2 && index >= columns.length - 2,
      above: top + height + 260 > gridHeight,
    };
  });

  private readonly zone = computed(() => this.family.family()?.timeZone ?? 'UTC');

  /** Listeners for the press in progress, removed when it ends. */
  private release: (() => void) | null = null;
  private longPress = 0;
  private edgeFrame = 0;
  /** Set when a drag ends, so the click that follows the release does not open the event or start a new one. */
  private swallowClick = false;

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
    // A title's last line stays clear of the block's bottom edge, and of the outline Groovy and Bold draw.
    const outlined = !this.theme.night() && (this.theme.theme() === 'Groovy' || this.theme.theme() === 'Bold');
    const titleBottom = outlined ? 7 : 2;

    const now = this.clock.now();
    const nowMinutes = minutesIn(zone, now);
    const showsNow = columns.some((column) => column.day === today) && nowMinutes >= first * 60 && nowMinutes <= last * 60;

    const across = (lane: number, lanes: number) => ({
      left: `calc(${(lane * 100) / lanes}% + ${layout.gap}px)`,
      width: `calc(${100 / lanes}% - ${2 * layout.gap}px)`,
    });
    const reach = (height: number, room: number) => (layout.reach ? Math.max(height, Math.min(layout.reach, height + room * perMinute)) : null);
    // On the wall the grip that pulls the end takes a finger in the free space below the event, never over the next one.
    const gripBelow = (room: number) => (layout.reach ? Math.min(GRIP_BELOW, Math.max(0, room * perMinute - layout.gap)) : null);

    return {
      hours: Array.from({ length: last - first + 1 }, (_, i) => ({
        hour: first + i,
        label: hourLabel(first + i),
        top: y((first + i) * 60),
        covered: showsNow && Math.abs(y((first + i) * 60) - y(nowMinutes)) < 16,
      })),
      now: showsNow ? { top: y(nowMinutes), label: timeIn(zone, now).replace(/\s?[AP]M$/, '') } : null,
      columns: columns.map((column) => {
        // A Week day is narrow: past two side by side the rest fold into "+N", so titles stay readable.
        const { placed, more } = arrange(column.segments, this.variant() === 'week' ? 2 : 3);
        const weekday = formatDay(column.day, { weekday: 'long' });
        return {
          key: column.key,
          name: column.name,
          source: column,
          isToday: column.day === today,
          blocks: placed.map((segment) => {
            const event = segment.event;
            // On Day an event shared by several people shows in each one's column, in that person's color.
            const people = peopleOf(event, members);
            const member = (this.variant() === 'day' ? people.find((m) => m.id === column.key) : undefined) ?? people[0];
            const who = namesOf(event, members);
            const readOnly = !writable.has(event.calendarId) || !!event.hidden;
            const height = Math.max((segment.end - segment.start) * perMinute - 3, layout.minBlock);
            const short = height < layout.shortBelow;
            // A Day block names its place only when the title, times and place all have a line.
            const place = this.variant() === 'day' && event.location && height >= 18 + layout.dayTime + 2 * layout.dayLine ? event.location : null;
            const soon = soonIn(event, segment.continuesBefore, now);
            return {
              ...across(segment.lane, segment.lanes),
              id: event.id,
              key: `${event.id}@${column.key}`,
              segment,
              // An event is picked up by the part on the day it starts; one still saving waits.
              movable: !readOnly && !event.pending && !segment.continuesBefore,
              // Its end is pulled from its bottom edge, on the day it both starts and ends.
              resizable: !readOnly && !event.pending && !segment.continuesBefore && !segment.continuesAfter,
              title: event.title,
              color: member?.color ?? FAMILY_COLOR,
              initial: member?.initial ?? 'F',
              avatar: member?.avatar ?? null,
              also: people.filter((m) => m !== member).slice(0, 1).map((m) => ({ id: m.id, color: m.color, initial: m.initial, avatar: m.avatar ?? null })),
              pending: !!event.pending,
              top: y(segment.start) + 1,
              height,
              short,
              narrow: segment.lanes >= 3,
              reach: reach(height, segment.room),
              gripBelow: gripBelow(segment.room),
              lines:
                this.variant() === 'day'
                  ? Math.max(1, Math.floor((height - 18 - layout.dayTime - (place ? layout.dayLine : 0)) / layout.dayLine))
                  : short
                    ? Math.max(1, Math.floor((height - 4) / layout.lineHeight))
                    : Math.max(1, Math.floor((height - layout.titleTop - titleBottom) / layout.lineHeight)),
              soon,
              time: soon !== null ? `In ${soon} min` : segment.continuesBefore ? `Until ${shortTime(timeIn(zone, event.endsAt!))}` : shortTime(timeIn(zone, event.startsAt!)),
              range: soon !== null ? `In ${soon} min · ${timeRange(event, zone)}` : timeRange(event, zone),
              place,
              label: `${event.title}, ${weekday} ${timeRange(event, zone)}${soon !== null ? `, starts in ${soon} ${soon === 1 ? 'minute' : 'minutes'}` : ''}, ${who}${readOnly ? ', read only' : ''}${event.pending ? ', saving' : ''}`,
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
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(frame);
      this.cancel();
    });

    const host = this.host.nativeElement;
    // Once a finger has picked an event up, its moves drag the event instead of scrolling the grid.
    host.addEventListener('touchmove', (event) => this.drag()?.moving && event.preventDefault(), { passive: false });
    host.addEventListener('contextmenu', (event) => this.drag() && event.preventDefault());
    host.addEventListener(
      'click',
      (event) => {
        if (this.swallowClick) {
          this.swallowClick = false;
          event.stopPropagation();
          event.preventDefault();
        }
      },
      true,
    );
  }

  /**
   * A press on an event: a mouse or pen that moves drags it, and a finger picks it up by holding
   * still for a moment. A press that never becomes a drag stays a tap and opens the event.
   */
  protected press(event: PointerEvent, segment: TimedSegment, column: GridColumn, movable: boolean, mode: Drag['mode'] = 'move'): void {
    if (mode === 'resize') {
      // The edge is inside the event: the event itself must not also pick it up to move.
      event.stopPropagation();
    }
    if (this.choosing()) {
      this.cancel();
    }
    if (!movable || this.drag() || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    const minute = this.minuteAt(event.clientY);
    if (minute === null) {
      return;
    }
    this.swallowClick = false;
    const touch = event.pointerType === 'touch';
    this.drag.set({
      event: segment.event,
      mode,
      pointerId: event.pointerId,
      touch,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      grab: minute - (mode === 'resize' ? segment.end : segment.start),
      fromColumn: column.key,
      fromDay: column.day,
      fromStart: segment.start,
      moving: false,
      column: column.key,
      day: column.day,
      start: segment.start,
      fromEnd: segment.end,
      end: segment.end,
    });
    if (touch) {
      this.longPress = window.setTimeout(() => this.pickUp(), LONG_PRESS);
    }
    const move = (e: PointerEvent) => e.pointerId === event.pointerId && this.moved(e.clientX, e.clientY);
    const up = (e: PointerEvent) => e.pointerId === event.pointerId && this.released();
    const cancel = (e: PointerEvent) => e.pointerId === event.pointerId && this.cancel();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && this.cancel();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    this.release = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }

  /** Puts down a dragged repeating event: for it alone, or for every event of its series at the same time of day. */
  protected drop(series: boolean): void {
    const drag = this.drag();
    this.stop();
    if (!drag) {
      return;
    }
    const draft = this.draftFor(drag);
    // The calendar shows the move at once and says if it could not be saved, putting the event back.
    this.calendar.update(drag.event.id, requestOf(draft), series).subscribe({ error: () => undefined });
  }

  /** The event as a drag would leave it: moved, keeping its length, or with its new end. */
  private draftFor(drag: Drag) {
    return drag.mode === 'resize'
      ? resizedTo(drag.event, drag.end, this.zone())
      : movedTo(drag.event, drag.day, clock(drag.start), this.zone());
  }

  /** Lets go of a drag, or of a question about one, leaving the event where it was. */
  protected cancel(): void {
    if (this.drag()?.moving && !this.choosing()) {
      // Let go mid-drag, the release that follows lands somewhere on the grid without adding an event there.
      this.swallowNextClick();
    }
    this.stop();
  }

  /** Swallows the click that follows the pointer's next release. */
  private swallowNextClick(): void {
    this.swallowClick = true;
    window.addEventListener('pointerup', () => setTimeout(() => (this.swallowClick = false)), { once: true });
  }

  private stop(): void {
    clearTimeout(this.longPress);
    cancelAnimationFrame(this.edgeFrame);
    this.release?.();
    this.release = null;
    this.drag.set(null);
    this.choosing.set(false);
  }

  /** A held finger picks the event up. */
  private pickUp(): void {
    const drag = this.drag();
    if (!drag || drag.moving) {
      return;
    }
    navigator.vibrate?.(10);
    this.drag.set({ ...drag, moving: true });
    this.follow(drag.lastX, drag.lastY);
  }

  private moved(x: number, y: number): void {
    const drag = this.drag();
    if (!drag || this.choosing()) {
      return;
    }
    if (!drag.moving) {
      const far = Math.hypot(x - drag.x, y - drag.y);
      if (drag.touch) {
        // A finger that moves before the long press is scrolling or swiping, not dragging.
        if (far > TOUCH_SLOP) {
          this.stop();
        } else {
          this.drag.set({ ...drag, lastX: x, lastY: y });
        }
        return;
      }
      if (far < DRAG_SLOP) {
        return;
      }
      this.drag.set({ ...drag, moving: true });
    }
    this.follow(x, y);
  }

  /** Puts the preview under the pointer: the column it is over and its start, snapped to the editor's steps. */
  private follow(x: number, y: number): void {
    const drag = this.drag();
    const minute = this.minuteAt(y);
    if (!drag || minute === null) {
      return;
    }
    const { first, last } = this.scale();
    if (drag.mode === 'resize') {
      // The end follows the pointer, wherever on the grip it was taken, at least a step after the start.
      const end = Math.round((minute - drag.grab) / STEP_MINUTES) * STEP_MINUTES;
      this.drag.set({ ...drag, lastX: x, lastY: y, end: Math.min(Math.max(end, drag.start + STEP_MINUTES), Math.min(last * 60, 24 * 60)) });
      this.scrollAtEdge();
      return;
    }
    const columns = this.columns();
    const elements = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.column'));
    let index = elements.findIndex((element) => x < element.getBoundingClientRect().right);
    index = index < 0 ? elements.length - 1 : index;
    const over = columns[index];
    // A Day view's columns are people, not days: an event moves in time there, and stays with its person.
    const column = !over || over.day === drag.fromDay ? { key: drag.fromColumn, day: drag.fromDay } : over;
    const snapped = Math.round((minute - drag.grab) / STEP_MINUTES) * STEP_MINUTES;
    const start = Math.min(Math.max(snapped, first * 60), Math.min(last * 60, 24 * 60) - STEP_MINUTES);
    this.drag.set({ ...drag, lastX: x, lastY: y, column: column.key, day: column.day, start });
    this.scrollAtEdge();
  }

  private released(): void {
    const drag = this.drag();
    if (!drag?.moving) {
      this.stop();
      return;
    }
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false));
    clearTimeout(this.longPress);
    cancelAnimationFrame(this.edgeFrame);
    if (drag.day === drag.fromDay && drag.start === drag.fromStart && drag.end === drag.fromEnd) {
      this.stop();
    } else if (drag.event.recurring) {
      // Keep the preview where it was dropped while the question is open.
      this.release?.();
      const key = (e: KeyboardEvent) => e.key === 'Escape' && this.cancel();
      // A tap elsewhere only puts the question away; it does not also open or add an event.
      const away = () => {
        this.swallowNextClick();
        this.cancel();
      };
      window.addEventListener('keydown', key);
      window.addEventListener('pointerdown', away);
      this.release = () => {
        window.removeEventListener('keydown', key);
        window.removeEventListener('pointerdown', away);
      };
      this.choosing.set(true);
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.chooser button')?.focus(), { injector: this.injector });
    } else {
      this.drop(false);
    }
  }

  /** Near the top or bottom of a scrolling grid, a dragged event scrolls it to reach earlier or later hours. */
  private scrollAtEdge(): void {
    cancelAnimationFrame(this.edgeFrame);
    const body = this.body()?.nativeElement;
    const drag = this.drag();
    if (!body || !drag?.moving || !this.scale().scrolls) {
      return;
    }
    const rect = body.getBoundingClientRect();
    const speed = drag.lastY < rect.top + EDGE ? -EDGE_SPEED : drag.lastY > rect.bottom - EDGE ? EDGE_SPEED : 0;
    if (!speed) {
      return;
    }
    this.edgeFrame = requestAnimationFrame(() => {
      const before = body.scrollTop;
      body.scrollTop += speed;
      if (body.scrollTop !== before) {
        this.follow(drag.lastX, drag.lastY);
      }
    });
  }

  /** The minute of the day at a point in the window, on the grid's clock. */
  private minuteAt(clientY: number): number | null {
    const grid = this.host.nativeElement.querySelector('.grid');
    if (!grid) {
      return null;
    }
    const { first, hour } = this.scale();
    return first * 60 + ((clientY - grid.getBoundingClientRect().top - PAD) / hour) * 60;
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

/** Minutes since midnight as 'HH:mm'. */
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "3:15 PM" as "3:15 pm", and "3:00 PM" as "3 pm", to fit a narrow block. */
function shortTime(time: string): string {
  return time.replace(':00', '').replace(/\s?([AP]M)$/, (_, half: string) => ` ${half.toLowerCase()}`);
}
