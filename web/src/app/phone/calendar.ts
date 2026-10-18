import { CalendarSaveStatus } from '../shared/calendar-save-status';
import { CalendarConnection } from '../shared/calendar-connection';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { CalendarEvent, CalendarStore, FAMILY, FAMILY_COLOR, colorOf, daysOf, ownerOf, whenOn } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, addMonths, dayIn, formatDay, startOfMonth, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { CalendarFilter } from '../shared/calendar-filter';
import { EventSheet } from './event-sheet';
import { PhoneNav } from './phone-nav';
import { SignIn } from './sign-in';

/** The phone's month: a dot for each person busy on a day, and the chosen day's events below. */
@Component({
  selector: 'app-phone-calendar',
  imports: [CalendarConnection, CalendarSaveStatus, CalendarFilter, EventSheet, PhoneNav, SignIn],
  template: `
    @if (family.state().status === 'private') {
      <app-sign-in />
    } @else if (month(); as month) {
      <header>
        <h1>{{ month.title }}</h1>
        <div class="arrows">
          <button type="button" aria-label="Previous month" (click)="moveMonth(-1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
          </button>
          <button type="button" aria-label="Next month" (click)="moveMonth(1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
          </button>
        </div>
      </header>

      <app-calendar-connection />
      <app-calendar-filter class="compact" />

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
              [attr.aria-pressed]="cell.day === chosen()"
              [attr.aria-label]="cell.label"
              (click)="selected.set(cell.day)"
            >
              <span class="num">{{ cell.num }}</span>
              <span class="dots" aria-hidden="true">
                @for (color of cell.colors; track $index) {
                  <span [style.background]="color"></span>
                }
              </span>
            </button>
          }
        </div>
      </section>

      @if (calendar.state().status === 'unavailable') {
        <p class="empty" role="status">Can't load the calendar right now.</p>
      }

      <section class="agenda" aria-labelledby="agenda">
        <h2 id="agenda">{{ agenda().heading }}</h2>
        <ul>
          @for (event of agenda().events; track event.id) {
            <li [style.--member]="event.color" [class.calendar-pending]="event.pending" [attr.aria-busy]="event.pending">
              <button type="button" [disabled]="!event.canEdit" (click)="edit(event.id)">
                <span class="mark" role="img" [attr.aria-label]="event.who">{{ event.initial }}</span>
                <span class="when">{{ event.when }}</span>
                <span class="title">{{ event.title }}</span>
              </button>
            </li>
          }
        </ul>
      </section>

      @if (canAdd()) {
        <button type="button" class="add" aria-label="Add event" (click)="add()">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
        </button>
      }

      @if (editing(); as open) {
        <app-event-sheet [event]="open.event" [day]="open.day" (closed)="editing.set(null)" />
      }
    }

    <app-calendar-save-status />
    <app-phone-nav />
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 24px 18px 12px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    app-sign-in {
      margin: auto 0;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 34px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .arrows {
      display: flex;
      gap: 8px;
    }

    .arrows button {
      width: 44px;
      height: 44px;
      border-radius: 22px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .month {
      padding: 12px 10px;
      border-radius: 18px;
      background: var(--surface);
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
      color: var(--muted);
    }

    .grid {
      row-gap: 2px;
    }

    .grid button {
      height: 44px;
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
      width: 30px;
      height: 30px;
      border-radius: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .outside {
      color: #6b7077;
      font-weight: 400;
    }

    .grid button[aria-pressed='true'] .num {
      box-shadow: inset 0 0 0 2px var(--ink);
    }

    .is-today .num {
      background: var(--ink);
      color: #ffffff;
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
    }

    h2 {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 18px;
      text-transform: uppercase;
      color: var(--muted);
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    li button {
      width: 100%;
      min-height: 44px;
      box-sizing: border-box;
      padding: 8px 12px;
      border: 0;
      border-radius: 12px;
      background: color-mix(in srgb, var(--member) 14%, white);
      color: var(--ink);
      font: inherit;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
    }

    li button:disabled {
      cursor: default;
    }

    /* Room under the last event, so the add button never covers it. */
    .agenda {
      padding-bottom: 64px;
    }

    .add {
      position: fixed;
      right: 18px;
      bottom: 100px;
      width: 56px;
      height: 56px;
      border: 0;
      border-radius: 28px;
      background: var(--accent);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 16px rgba(31, 35, 40, 0.22);
      cursor: pointer;
    }

    .mark {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border-radius: 12px;
      background: var(--member);
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .when {
      flex-shrink: 0;
      width: 62px;
      font-size: 13px;
      font-weight: 600;
      color: #4a4f57;
    }

    li .title {
      flex: 1;
      font-size: 15px;
      font-weight: 600;
    }

    .empty {
      margin: 0;
      color: var(--muted);
    }

    app-phone-nav {
      margin-top: auto;
    }
  `,
})
export class PhoneCalendar {
  protected readonly calendar = inject(CalendarStore);
  protected readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  /** The day whose events show below the month. Today until another is tapped. */
  protected readonly selected = signal<Day | null>(null);

  private readonly settings = computed(() => {
    const state = this.family.state();
    return state.status === 'ready' ? state.family : null;
  });

  private readonly today = computed(() => {
    const family = this.settings();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  protected readonly chosen = computed(() => this.selected() ?? this.today());

  /** The event being added (no event) or changed in the sheet, or null when it is closed. */
  protected readonly editing = signal<{ event: CalendarEvent | null; day: Day } | null>(null);

  private readonly writable = computed(() => new Set(this.calendar.calendars().filter((c) => c.canWrite).map((c) => c.id)));

  protected readonly canAdd = computed(() => this.writable().size > 0);

  /** The weeks the month covers, whole, from the family's first day of the week. */
  private readonly grid = computed(() => {
    const family = this.settings();
    const chosen = this.chosen();
    if (!family || !chosen) {
      return null;
    }
    const first = startOfMonth(chosen);
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

    const ownersByDay = new Map<Day, Set<string>>();
    for (const event of this.calendar.events()) {
      for (const day of daysOf(event, family.timeZone)) {
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
        isToday: day === this.today(),
        label: formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' }),
        // At most four dots fit under a date.
        colors: owners
          .filter(({ owner }) => ownersByDay.get(day)?.has(owner))
          .map(({ color }) => color)
          .slice(0, 4),
      });
    }

    return {
      title: formatDay(first, { month: 'long', ...(first.slice(0, 4) === this.today()!.slice(0, 4) ? {} : { year: 'numeric' }) }),
      dows: cells.slice(0, 7).map((cell) => formatDay(cell.day, { weekday: 'narrow' })),
      cells,
    };
  });

  protected readonly agenda = computed(() => {
    const family = this.settings();
    const day = this.chosen();
    if (!family || !day) {
      return { heading: '', events: [] };
    }
    const events = this.calendar
      .events()
      .filter((event) => daysOf(event, family.timeZone).includes(day))
      .map((event) => {
        const member = family.members.find((m) => m.id === event.memberId);
        return {
          id: event.id,
          pending: !!event.pending,
          title: event.title,
          when: whenOn(event, day, family.timeZone),
          who: member?.displayName ?? 'Family',
          initial: member?.initial ?? 'F',
          color: colorOf(event, family.members),
          canEdit: this.writable().has(event.calendarId) && !this.calendar.isPending(event.id),
        };
      });
    const count = events.length === 1 ? '1 event' : `${events.length === 0 ? 'No' : events.length} events`;
    return { heading: `${formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' })} · ${count}`, events };
  });

  constructor() {
    this.family.load();
    effect(() => {
      const grid = this.grid();
      if (grid) {
        this.calendar.show(grid.start, grid.end);
      }
    });
  }

  /** A new event goes on the day chosen in the month. */
  protected add(): void {
    const day = this.chosen();
    if (day) {
      this.editing.set({ event: null, day });
    }
  }

  protected edit(id: string): void {
    const event = this.calendar.allEvents().find((e) => e.id === id);
    const day = this.chosen();
    if (event && day) {
      this.editing.set({ event, day });
    }
  }

  /** Moves to the same date a month away, or that month's last day when it is shorter. */
  protected moveMonth(months: number): void {
    const chosen = this.chosen();
    if (chosen) {
      const target = addMonths(chosen, months);
      const lastDay = addDays(addMonths(target, 1), -1);
      const wanted = `${target.slice(0, 8)}${chosen.slice(8)}`;
      this.selected.set(wanted > lastDay ? lastDay : wanted);
    }
  }
}


