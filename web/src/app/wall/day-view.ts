import { Component, computed, effect, inject, input, output } from '@angular/core';
import { CalendarEvent, CalendarStore, FAMILY, FAMILY_COLOR, daysOf, ownerOf, timeRange } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, minutesIn, timeIn } from '../core/days';
import { Family, FamilyStore } from '../core/family';

/** The hours the day view always shows; it stretches to fit events outside them. */
const FIRST_HOUR = 7;
const LAST_HOUR = 21;

/** The wall's day: a column per person, all-day events on top and timed ones on an hour grid. */
@Component({
  selector: 'app-day-view',
  template: `
    @if (day(); as day) {
      <div class="sheet" [style.--columns]="day.columns.length">
        <div class="heads">
          <span class="all-day-label">All day</span>
          @for (column of day.columns; track column.owner) {
            <div class="head" [style.--member]="column.color">
              <div class="who">
                <span class="mark" aria-hidden="true">{{ column.initial }}</span>
                {{ column.name }}
              </div>
              @for (event of column.allDay; track event.id) {
                <button type="button" class="all-day" [class.calendar-pending]="event.pending" [disabled]="!canEdit(event)" (click)="edit.emit(event.id)">{{ event.title }}</button>
              }
            </div>
          }
        </div>

        <div class="grid">
          <div class="hours" aria-hidden="true">
            @for (hour of day.hours; track hour.label) {
              <span [style.top.%]="hour.top">{{ hour.label }}</span>
            }
          </div>
          @for (column of day.columns; track column.owner) {
            <ul class="column" [style.--member]="column.color" [attr.aria-label]="column.name">
              @for (event of column.timed; track event.id) {
                <li
                  [class.short]="event.short"
                  [style.top.%]="event.top"
                  [style.height.%]="event.height"
                  [style.left.%]="event.left"
                  [style.width.%]="event.width"
                >
                  <span class="title">{{ event.title }}</span>
                  <span class="when">{{ event.when }}</span>
                  <button
                    type="button"
                    class="open"
                    [class.calendar-pending]="event.pending" [attr.aria-busy]="event.pending"
                    [attr.aria-label]="event.title + ', ' + event.when"
                    [disabled]="!event.canEdit"
                    (click)="edit.emit(event.id)"
                  ></button>
                </li>
              }
            </ul>
          }
          @if (day.now !== null) {
            <div class="now" [style.top.%]="day.now" aria-hidden="true">
              <span>{{ day.nowLabel }}</span>
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
      gap: 12px;
      min-height: 0;
    }

    .sheet {
      flex: 1;
      min-height: 0;
      padding: 16px 18px 14px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .heads,
    .grid {
      display: grid;
      grid-template-columns: 72px repeat(var(--columns), minmax(0, 1fr));
      gap: 10px;
    }

    .heads {
      align-items: start;
    }

    .all-day-label {
      padding: 44px 8px 0 0;
      text-align: right;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
    }

    .head {
      min-height: 68px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .who {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 700;
    }

    .mark {
      width: 32px;
      height: 32px;
      border-radius: 16px;
      background: color-mix(in srgb, var(--member) var(--member-shade), black);
      color: var(--on-ink);
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .all-day {
      height: 30px;
      padding: 0 12px;
      border: 0;
      border-radius: 8px;
      background: color-mix(in srgb, var(--member) var(--member-fill), var(--surface));
      color: var(--ink);
      font-family: inherit;
      text-align: left;
      cursor: pointer;
      display: flex;
      align-items: center;
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .grid {
      position: relative;
      flex: 1;
      min-height: 0;
    }

    .hours {
      position: relative;
    }

    .hours span {
      position: absolute;
      right: 8px;
      transform: translateY(-50%);
      font-size: 13px;
      font-weight: 600;
      line-height: 18px;
      color: var(--faint);
    }

    .column {
      position: relative;
      margin: 0;
      padding: 0;
      list-style: none;
      background-image: repeating-linear-gradient(
        to bottom,
        var(--hour-rule) 0,
        var(--hour-rule) 1px,
        transparent 1px,
        transparent var(--hour)
      );
    }

    .column li {
      position: absolute;
      box-sizing: border-box;
      padding: 4px 12px;
      border: 2px solid var(--surface);
      border-radius: 10px;
      background: color-mix(in srgb, var(--member) var(--member-fill), var(--surface));
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      overflow: hidden;
    }

    /* The whole event is the button that opens it. */
    .column .open {
      position: absolute;
      inset: 0;
      border: 0;
      background: none;
      cursor: pointer;
    }

    .all-day:disabled,
    .column .open:disabled {
      cursor: default;
    }

    .column li.short {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .column .title {
      font-size: 17px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .column .when {
      font-size: 14px;
      font-weight: 600;
      color: var(--quiet);
      white-space: nowrap;
    }

    .now {
      position: absolute;
      left: 76px;
      right: 0;
      height: 2px;
      background: var(--ink);
      pointer-events: none;
    }

    .now span {
      position: absolute;
      left: -76px;
      top: -10px;
      width: 66px;
      height: 22px;
      border-radius: 11px;
      background: var(--ink);
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `,
  host: { '[style.--hour]': 'hourHeight()' },
})
export class DayView {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  /** The day to show; null shows today. */
  readonly focus = input<Day | null>(null);

  /** An event was tapped to change it; carries its id. */
  readonly edit = output<string>();

  private readonly writable = computed(() => new Set(this.calendar.calendars().filter((c) => c.canWrite).map((c) => c.id)));

  protected canEdit(event: CalendarEvent): boolean {
    return this.writable().has(event.calendarId) && !this.calendar.isPending(event.id);
  }

  private readonly today = computed(() => {
    const family = this.family.family();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  private readonly shown = computed(() => this.focus() ?? this.today());

  /** The grid's hour lines, as a share of its height. */
  protected readonly hourHeight = computed(() => {
    const day = this.day();
    return day ? `calc(100% / ${day.hours.length})` : '46px';
  });

  protected readonly day = computed(() => {
    const family = this.family.family();
    const day = this.shown();
    if (!family || !day) {
      return null;
    }

    const events = this.calendar.events().filter((event) => daysOf(event, family.timeZone).includes(day));
    const timed = events
      .filter((event) => !event.allDay)
      .map((event) => ({ event, ...minutesOn(event, day, family.timeZone) }));

    // Stretch the hours to fit anything early or late.
    const first = Math.min(FIRST_HOUR, ...timed.map((t) => Math.floor(t.start / 60)));
    const last = Math.max(LAST_HOUR, ...timed.map((t) => Math.ceil(t.end / 60)));
    const span = (last - first) * 60;
    const at = (minutes: number) => ((minutes - first * 60) / span) * 100;

    const columns = this.columns(family).map((column) => {
      const mine = timed.filter((t) => ownerOf(t.event) === column.owner);
      return {
        ...column,
        allDay: events.filter((event) => event.allDay && ownerOf(event) === column.owner),
        timed: lanes(mine).map(({ event, start, end, lane, lanes }) => ({
          id: event.id,
          pending: !!event.pending,
          title: event.title,
          when: timeRange(event, family.timeZone),
          canEdit: this.canEdit(event),
          top: at(start),
          height: at(Math.max(end, start + 30)) - at(start),
          left: (lane / lanes) * 100,
          width: 100 / lanes,
          short: end - start < 60,
        })),
      };
    });

    const isToday = day === this.today();
    const nowMinutes = minutesIn(family.timeZone, this.clock.now());
    return {
      columns,
      hours: Array.from({ length: last - first }, (_, i) => ({ label: hourLabel(first + i), top: at((first + i) * 60) })),
      now: isToday && nowMinutes >= first * 60 && nowMinutes <= last * 60 ? at(nowMinutes) : null,
      nowLabel: timeIn(family.timeZone, this.clock.now()),
    };
  });

  constructor() {
    effect(() => {
      const day = this.shown();
      if (day) {
        this.calendar.show(day, addDays(day, 1));
      }
    });
  }

  /** A column for each person the filter shows, then the family's when it has a calendar. */
  private columns(family: Family) {
    const hidden = this.calendar.hidden();
    return [
      ...family.members.map((m) => ({ owner: m.id, name: m.displayName, initial: m.initial, color: m.color })),
      ...(this.calendar.hasFamilyCalendar() ? [{ owner: FAMILY, name: 'Family', initial: 'F', color: FAMILY_COLOR }] : []),
    ].filter((column) => !hidden.has(column.owner));
  }
}

/** Where a timed event sits on one day, in minutes from midnight, clipped to that day. */
function minutesOn(event: CalendarEvent, day: Day, timeZone: string) {
  const start = dayIn(timeZone, event.startsAt!) === day ? minutesIn(timeZone, event.startsAt!) : 0;
  const endsToday = dayIn(timeZone, new Date(new Date(event.endsAt!).getTime() - 1)) === day;
  const end = endsToday ? minutesIn(timeZone, event.endsAt!) || 24 * 60 : 24 * 60;
  return { start, end: Math.max(end, start) };
}

/** Puts events that overlap side by side: each gets a lane, and the number of lanes in its group. */
export function lanes<T extends { start: number; end: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: (T & { lane: number; lanes: number })[] = [];
  let group: (T & { lane: number; lanes: number })[] = [];
  let groupEnd = -1;
  for (const item of sorted) {
    if (item.start >= groupEnd) {
      group = [];
    }
    const taken = new Set(group.filter((other) => other.end > item.start).map((other) => other.lane));
    let lane = 0;
    while (taken.has(lane)) {
      lane++;
    }
    const entry = { ...item, lane, lanes: 1 };
    group.push(entry);
    placed.push(entry);
    groupEnd = Math.max(groupEnd, item.end);
    const count = Math.max(...group.map((other) => other.lane)) + 1;
    group.forEach((other) => (other.lanes = count));
  }
  return placed;
}

function hourLabel(hour: number): string {
  const h = hour % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

