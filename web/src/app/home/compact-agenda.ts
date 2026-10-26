import { Component, computed, inject, input, output } from '@angular/core';
import { CalendarStore, colorOf, namesOf, peopleOf, showsOn, spanOf } from '../core/calendar';
import { inAllDayLane } from '../core/calendar-grid';
import { Day, dayIn, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { AvatarFace } from '../shared/avatar-face';

/**
 * A day's events as one tinted row each, for the phone's week and month: the start time (or
 * "All day" in the owner's color), the owner's initial, and the title. Compact enough to scan
 * a week at a glance; the Day view keeps the full cards.
 */
@Component({
  selector: 'app-compact-agenda',
  imports: [AvatarFace],
  template: `
    @if (rows(); as rows) {
      @for (row of rows; track row.id) {
        <button
          type="button"
          [style.--member]="row.color"
          [class.all-day]="row.allDay"
          [class.calendar-pending]="row.pending"
          [attr.aria-busy]="row.pending"
          [attr.aria-label]="row.label"
          (click)="inspect.emit(row.id)"
        >
          <span class="time">{{ row.time }}</span>
          <span class="mark" aria-hidden="true"><app-avatar-face [initial]="row.initial" [avatar]="row.avatar" /></span>
          <span class="title">{{ row.title }}</span>
        </button>
      } @empty {
        <p class="empty">Nothing planned</p>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    button {
      min-height: 44px;
      padding: 0 12px;
      border: 0;
      border-radius: min(12px, calc(var(--event-radius) + 2px));
      background: var(--member-chip-bg);
      color: var(--ink);
      font: inherit;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .time {
      flex-shrink: 0;
      width: 58px;
      font-size: 13px;
      font-weight: 700;
      color: var(--notice-ink);
    }

    .all-day .time {
      color: var(--member-text);
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
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .title {
      flex: 1;
      min-width: 0;
      font-size: 15px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .empty {
      margin: 0;
      padding: 4px 4px 2px;
      font-size: 15px;
      color: var(--muted);
    }
  `,
})
export class CompactAgenda {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);

  readonly day = input.required<Day>();

  /** An event was tapped to see its details; carries its id. */
  readonly inspect = output<string>();

  /** All-day events first, then timed ones by start. Null while the days are loading or failed. */
  protected readonly rows = computed(() => {
    const family = this.family.family();
    const day = this.day();
    if (!family || this.calendar.state().status !== 'ready') {
      return null;
    }
    const zone = family.timeZone;
    const events = this.calendar.events().filter((event) => showsOn(event, day, zone));
    // A timed event that runs all through this day reads as all-day here, as on the Day agenda.
    const allDay = (event: (typeof events)[number]) => {
      const { first, last } = spanOf(event, zone);
      return inAllDayLane(event) || (first !== day && last !== day);
    };
    const ordered = [...events.filter(allDay), ...events.filter((event) => !allDay(event))];
    return ordered.map((event) => {
      const member = peopleOf(event, family.members)[0];
      const whole = allDay(event);
      const startsToday = !whole && dayIn(zone, event.startsAt!) === day;
      const time = whole ? 'All day' : startsToday ? timeIn(zone, event.startsAt!).replace(/\s?([AP]M)$/, (_, half: string) => ` ${half.toLowerCase()}`) : 'Until';
      return {
        id: event.id,
        title: event.title,
        color: colorOf(event, family.members),
        initial: member?.initial ?? 'F',
        avatar: member?.avatar ?? null,
        pending: !!event.pending,
        allDay: whole,
        time,
        label: `${event.title}, ${whole ? 'all day' : startsToday ? timeIn(zone, event.startsAt!) : `until ${timeIn(zone, event.endsAt!)}`}, ${namesOf(event, family.members)}${event.pending ? ', saving' : ''}`,
      };
    });
  });
}
