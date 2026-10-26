import { Component, computed, effect, inject, input, output, viewChild } from '@angular/core';
import { CalendarStore, FAMILY, FAMILY_COLOR, colorOf, ownerOf, showsOn } from '../core/calendar';
import { inAllDayLane, timedSegments } from '../core/calendar-grid';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay } from '../core/days';
import { FamilyStore } from '../core/family';
import { GridColumn, GridNote, GridSlot, HourGrid } from './hour-grid';
import { spanLabel } from './week-view';
import { AvatarFace } from '../shared/avatar-face';

/**
 * One day with a column per person: each headed by their avatar, name and how many events they
 * have, their all-day events beneath, then their timed events on the same hour grid as Week.
 * Someone whose chip is off has no column. Used by the wall and by a desktop window.
 */
@Component({
  selector: 'app-day-view',
  imports: [AvatarFace, HourGrid],
  host: { '[class]': 'layout()', '[style.--columns]': 'columns().length' },
  template: `
    @if (day(); as day) {
      <div class="heads">
        <span></span>
        @for (person of day.people; track person.owner) {
          <div class="head" [style.--member]="person.color">
            <span class="avatar" aria-hidden="true"><app-avatar-face [initial]="person.initial" [avatar]="person.avatar" /></span>
            <span class="who">
              <span class="name">{{ person.name }}</span>
              <span class="count">{{ person.count }}</span>
            </span>
          </div>
        }
      </div>

      @if (day.hasAllDay) {
        <div class="all-day">
          <span class="label">All day</span>
          @for (person of day.people; track person.owner) {
            <div class="bars">
              @for (bar of person.allDay; track bar.id) {
                <button
                  type="button"
                  class="bar"
                  [style.--member]="bar.color"
                  [class.selected]="bar.id === selected()"
                  [class.calendar-pending]="bar.pending"
                  [attr.aria-busy]="bar.pending"
                  [attr.aria-label]="bar.label"
                  (click)="inspect.emit(bar.id)"
                >
                  <span class="title">{{ bar.title }}</span>
                </button>
              }
            </div>
          }
        </div>
      }

      <app-hour-grid
        variant="day"
        [columns]="columns()"
        [layout]="layout()"
        [anchor]="shown() ?? ''"
        [tintToday]="false"
        [selected]="selected()"
        [canAdd]="canAdd()"
        (inspect)="inspect.emit($event)"
        (moreOpened)="inspect.emit($event.events[0].id)"
        [note]="day.note"
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
      grid-template-columns: var(--gutter) repeat(var(--columns), minmax(0, 1fr));
      border-bottom: 1px solid var(--rule);
    }

    .heads {
      height: 70px;
      border-bottom: var(--head-rule);
    }

    :host(.desktop) .heads {
      height: 56px;
    }

    .head {
      min-width: 0;
      padding: 0 18px;
      border-left: 1px solid var(--rule);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    :host(.desktop) .head {
      padding: 0 12px;
      gap: 10px;
    }

    .avatar {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 20px;
      background: var(--member-strong);
      border: var(--avatar-border);
      box-sizing: border-box;
      color: var(--on-avatar);
      font-size: 19px;
      font-weight: 700;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    :host(.desktop) .avatar {
      width: 32px;
      height: 32px;
      border-radius: 16px;
      font-size: 15px;
    }

    .who {
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .name {
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      line-height: 1.1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    :host(.desktop) .name {
      font-size: 17px;
    }

    .count {
      font-size: 14px;
      font-weight: 600;
      color: var(--faint);
      white-space: nowrap;
    }

    :host(.desktop) .count {
      font-size: 12px;
    }

    .all-day {
      padding: 10px 0;
    }

    :host(.desktop) .all-day {
      padding: 8px 0;
    }

    .label {
      padding: 15px 12px 0 0;
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
      min-width: 0;
      padding: 0 8px;
      border-left: 1px solid var(--rule);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    :host(.desktop) .bars {
      padding: 0 6px;
      gap: 4px;
    }

    .bar {
      position: relative;
      height: 48px;
      box-sizing: border-box;
      padding: 0 14px;
      border: 0;
      border-radius: var(--event-radius);
      background: var(--member-bg);
      box-shadow: var(--bar-outline);
      border: var(--event-border);
      color: var(--event-ink);
      font: inherit;
      font-size: 16px;
      font-weight: 600;
      text-align: left;
      display: flex;
      align-items: center;
      cursor: pointer;
    }

    /* On the wall a bar's hit area takes half the gap on each side, so it is 56 px tall. */
    .bar::after {
      content: '';
      position: absolute;
      inset: -4px 0;
    }

    :host(.desktop) .bar {
      height: 30px;
      padding: 0 10px;
      border-radius: var(--event-radius-small);
      font-size: 13px;
    }

    :host(.desktop) .bar::after {
      inset: 0;
    }

    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .selected {
      outline: 3px solid var(--ink);
      outline-offset: 1px;
      z-index: 1;
    }

    app-hour-grid {
      flex: 1;
    }
  `,
})
export class DayView {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  /** The day to show; null shows today. */
  readonly focus = input<Day | null>(null);

  /** The wall fits the day's hours on screen; a desktop window scrolls them. */
  readonly layout = input<'wall' | 'desktop'>('wall');

  /** The event whose details are open, outlined so it can be found on the grid. */
  readonly selected = input<string | null>(null);

  /** Whether tapping an empty half hour starts a new event there. */
  readonly canAdd = input(false);

  /** An event was tapped to see its details; carries its id. */
  readonly inspect = output<string>();

  /** An empty half hour was tapped, to add an event there. */
  readonly create = output<GridSlot>();

  private readonly grid = viewChild(HourGrid);

  private readonly today = computed(() => {
    const family = this.family.family();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  protected readonly shown = computed(() => this.focus() ?? this.today());

  /** A column for each person the filter shows, then the family's when it has a calendar. */
  private readonly people = computed(() => {
    const family = this.family.family();
    if (!family) {
      return [];
    }
    const hidden = this.calendar.hidden();
    return [
      ...family.members.map((m) => ({ owner: m.id, name: m.displayName, initial: m.initial, avatar: m.avatar ?? null, color: m.color })),
      ...(this.calendar.hasFamilyCalendar() ? [{ owner: FAMILY, name: 'Family', initial: 'F', avatar: null, color: FAMILY_COLOR }] : []),
    ].filter((person) => !hidden.has(person.owner));
  });

  /** The day's events, filtered as the chips say. */
  private readonly events = computed(() => {
    const family = this.family.family();
    const day = this.shown();
    return family && day ? this.calendar.events().filter((event) => showsOn(event, day, family.timeZone)) : [];
  });

  protected readonly columns = computed<GridColumn[]>(() => {
    const family = this.family.family();
    const day = this.shown();
    if (!family || !day) {
      return [];
    }
    const segments = timedSegments(this.events(), [day], family.timeZone).get(day) ?? [];
    return this.people().map((person) => ({
      key: person.owner,
      day,
      name: person.name,
      segments: segments.filter((segment) => ownerOf(segment.event) === person.owner),
    }));
  });

  protected readonly day = computed(() => {
    const family = this.family.family();
    const day = this.shown();
    if (!family || !day) {
      return null;
    }
    const zone = family.timeZone;
    const writable = new Set(this.calendar.calendars().filter((c) => c.canWrite).map((c) => c.id));
    const isToday = day === this.today();
    const events = this.events();
    // A day still loading, or that failed to load, is never called empty.
    const status = this.calendar.state().status;
    const ready = status === 'ready';

    const people = this.people().map((person) => {
      const mine = events.filter((event) => ownerOf(event) === person.owner);
      const count = mine.length;
      return {
        ...person,
        count: !ready ? '' : count === 0 ? (this.calendar.isSynced(day) ? 'Nothing planned' : 'Not synced') : `${count} ${isToday ? 'today' : count === 1 ? 'event' : 'events'}`,
        allDay: mine.filter(inAllDayLane).map((event) => ({
          id: event.id,
          title: event.title,
          color: colorOf(event, family.members),
          pending: !!event.pending,
          label: `${event.title}, ${spanLabel(event, zone)}, ${person.name}${writable.has(event.calendarId) ? '' : ', read only'}${event.pending ? ', saving' : ''}`,
        })),
      };
    });

    const weekday = formatDay(day, { weekday: 'long' });
    const note: GridNote | null =
      status === 'loading'
        ? { text: `Loading ${isToday ? 'today' : weekday}…`, waiting: true }
        : status === 'unavailable'
          ? { text: `Couldn't load ${isToday ? 'today' : weekday}` }
          : people.length === 0
            ? { text: 'Choose someone above to see their day' }
            : events.length === 0
              ? { text: this.calendar.isSynced(day) ? `Nothing planned for ${isToday ? 'today' : weekday}` : 'Not synced this far' }
              : null;
    return {
      people,
      hasAllDay: people.some((person) => person.allDay.length > 0),
      note,
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

  /** Scrolls the grid back to the current hour, as when it opens. */
  scrollToNow(): void {
    this.grid()?.scrollToNow();
  }
}
