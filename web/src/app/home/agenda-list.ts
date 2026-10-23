import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { CalendarEvent, CalendarStore, colorOf, daysOf } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, dayIn, formatDay, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';

/** Events that ended longer ago than this fold away on today, behind "N earlier events". */
const EARLIER_THAN_MS = 60 * 60_000;

/**
 * One day's events on the phone: all-day ones first, then timed ones in order with their start
 * and end on the left. On today a coral line marks now, and long-finished events fold away.
 */
@Component({
  selector: 'app-agenda-list',
  template: `
    @if (agenda(); as agenda) {
      @if (agenda.allDay.length) {
        <div class="all-day">
          <span class="label">All day</span>
          @for (event of agenda.allDay; track event.id) {
            <button
              type="button"
              class="bar"
              [style.--member]="event.color"
              [class.calendar-pending]="event.pending"
              [attr.aria-busy]="event.pending"
              (click)="inspect.emit(event.id)"
            >
              <span class="mark" role="img" [attr.aria-label]="event.who">{{ event.initial }}</span>
              <span class="title">{{ event.title }}</span>
            </button>
          }
        </div>
      }
      @if (agenda.earlier > 0 && !showEarlier()) {
        <button type="button" class="earlier" (click)="showEarlier.set(true)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"></path></svg>
          {{ agenda.earlier === 1 ? '1 earlier event' : agenda.earlier + ' earlier events' }}
        </button>
      }
      <ul>
        @for (row of agenda.rows; track row.id) {
          @if (row.now) {
            <li class="now" [attr.aria-label]="'Now, ' + row.start">
              <span class="time">{{ row.start }}</span>
              <span class="line" aria-hidden="true"></span>
            </li>
          } @else if (!row.folded || showEarlier()) {
            <li class="event" [style.--member]="row.color" [class.calendar-pending]="row.pending" [attr.aria-busy]="row.pending">
              <span class="when">
                <span class="start">{{ row.start }}</span>
                <span class="end">{{ row.end }}</span>
              </span>
              <button type="button" (click)="inspect.emit(row.id)">
                <span class="title">{{ row.title }}</span>
                <span class="meta">
                  <span class="mark" role="img" [attr.aria-label]="row.who">{{ row.initial }}</span>
                  <span class="detail">{{ row.detail }}</span>
                </span>
              </button>
            </li>
          }
        }
      </ul>
      @if (agenda.empty) {
        <div class="empty">
          <span class="icon" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"></rect><path d="M3.5 10h17M8 3v4M16 3v4M9.5 15h5"></path></svg>
          </span>
          <h2>Nothing planned for {{ agenda.name }}</h2>
          <p>{{ agenda.empty }}</p>
          @if (canAdd()) {
            <button type="button" class="add" (click)="add.emit()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
              Add event
            </button>
          }
        </div>
      }
    } @else if (calendar.state().status === 'loading') {
      <p class="loading" role="status">Loading the day…</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .all-day {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-bottom: 4px;
    }

    .label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    button {
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .bar {
      min-height: 44px;
      padding: 0 14px 0 8px;
      border: 0;
      border-radius: min(12px, calc(var(--event-radius) + 2px));
      background: var(--member-bg);
      box-shadow: var(--bar-outline);
      border: var(--event-border);
      color: var(--event-ink);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 600;
    }

    .mark {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border-radius: 13px;
      background: var(--member-strong);
      border: var(--avatar-border);
      box-sizing: border-box;
      color: var(--on-avatar);
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .event .mark {
      width: 22px;
      height: 22px;
      font-size: 11px;
    }

    .earlier {
      align-self: flex-start;
      min-height: 44px;
      padding: 0 4px;
      border: 0;
      background: transparent;
      color: var(--notice-ink);
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .event {
      display: flex;
      gap: 8px;
    }

    .when {
      flex-shrink: 0;
      width: 62px;
      padding-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .start {
      font-size: 15px;
      font-weight: 700;
    }

    .end {
      font-size: 13px;
      font-weight: 500;
      color: var(--faint);
    }

    .event button {
      flex: 1;
      min-width: 0;
      min-height: 44px;
      padding: 10px 14px;
      border: 0;
      border-radius: min(14px, calc(var(--event-radius) + 4px));
      background: var(--member-bg);
      box-shadow: var(--event-outline);
      border: var(--event-border);
      color: var(--event-ink);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .title {
      min-width: 0;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .meta {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      font-size: 14px;
      font-weight: 500;
      color: var(--event-quiet);
    }

    .detail {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .now {
      height: 22px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .now .time {
      width: 62px;
      flex-shrink: 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--now-text);
    }

    .line {
      position: relative;
      flex: 1;
      height: 2px;
      background: var(--now);
    }

    .line::before {
      content: '';
      position: absolute;
      left: -5px;
      top: -4px;
      width: 10px;
      height: 10px;
      border-radius: 5px;
      background: var(--now);
    }

    .empty {
      padding: 36px 12px 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      text-align: center;
    }

    .icon {
      width: 72px;
      height: 72px;
      border-radius: 36px;
      background: var(--surface);
      color: var(--muted);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .empty h2 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
    }

    .empty p {
      max-width: 300px;
      margin: 0;
      font-size: 15px;
      line-height: 1.45;
      color: var(--muted);
    }

    .empty .add {
      margin-top: 6px;
      height: 48px;
      padding: 0 22px 0 18px;
      border: var(--primary-border);
      border-radius: var(--pill);
      background: var(--primary);
      box-shadow: var(--primary-shadow);
      color: var(--on-primary);
      font-size: 16px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .loading {
      margin: 24px 0 0;
      text-align: center;
      font-size: 15px;
      color: var(--muted);
    }
  `,
})
export class AgendaList {
  protected readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly day = input.required<Day>();

  /** An event was tapped to see its details; carries its id. */
  readonly inspect = output<string>();

  /** Add event was tapped on an empty day. */
  readonly add = output<void>();

  protected readonly canAdd = computed(() => this.calendar.calendars().some((calendar) => calendar.canWrite));

  /** Whether the folded early events have been opened; another day starts folded again. */
  protected readonly showEarlier = linkedSignal({ source: this.day, computation: () => false });

  protected readonly agenda = computed(() => {
    const family = this.family.family();
    const day = this.day();
    // A day still loading, or that failed to load, is never shown as an empty day.
    if (!family || this.calendar.state().status !== 'ready') {
      return null;
    }
    const zone = family.timeZone;
    const now = this.clock.now();
    const isToday = day === dayIn(zone, now);

    const events = this.calendar.events().filter((event) => daysOf(event, zone).includes(day));
    const describe = (event: CalendarEvent) => {
      const member = family.members.find((m) => m.id === event.memberId);
      return {
        id: event.id,
        title: event.title,
        pending: !!event.pending,
        color: colorOf(event, family.members),
        who: member?.displayName ?? 'Family',
        initial: member?.initial ?? 'F',
      };
    };

    // A timed event that runs all through this day reads as all-day here.
    const spans = (event: CalendarEvent) => !event.allDay && daysOf(event, zone)[0] !== day && daysOf(event, zone).at(-1) !== day;
    const allDay = events.filter((event) => event.allDay || spans(event)).map(describe);

    type Row = ReturnType<typeof describe> & { start: string; end: string; detail: string; folded: boolean; now: boolean };
    const rows: Row[] = [];
    let earlier = 0;
    let nowPlaced = !isToday;
    for (const event of events.filter((event) => !event.allDay && !spans(event))) {
      const ends = new Date(event.endsAt!).getTime();
      if (!nowPlaced && new Date(event.startsAt!).getTime() > now.getTime()) {
        rows.push(this.nowRow(zone, now));
        nowPlaced = true;
      }
      const folded = isToday && ends < now.getTime() - EARLIER_THAN_MS;
      earlier += folded ? 1 : 0;
      const startsToday = daysOf(event, zone)[0] === day;
      const shown = describe(event);
      rows.push({
        ...shown,
        start: startsToday ? short(timeIn(zone, event.startsAt!)) : 'Until',
        end: short(timeIn(zone, event.endsAt!)),
        detail: [shown.who, event.location].filter(Boolean).join(' · '),
        folded,
        now: false,
      });
    }
    if (!nowPlaced) {
      rows.push(this.nowRow(zone, now));
    }

    return {
      allDay,
      rows,
      earlier,
      // Why the day is empty, and how sure that is.
      empty:
        events.length > 0
          ? null
          : this.calendar.refreshFailed()
            ? 'This is from the last good refresh, so try again to be sure.'
            : this.calendar.hidden().size > 0
              ? 'Nothing on the calendars shown. Tap a name above to show more.'
              : 'No events on anyone’s calendar.',
      name: formatDay(day, { weekday: 'long' }),
    };
  });

  private nowRow(zone: string, now: Date) {
    return { id: 'now', title: '', pending: false, color: '', who: '', initial: '', start: short(timeIn(zone, now)), end: '', detail: '', folded: false, now: true };
  }
}

/** "4:30 PM" as "4:30p", so a time fits the narrow column beside its event. */
function short(time: string): string {
  return time.replace(/\s?(AM|PM)$/, (_, half: string) => (half === 'AM' ? 'a' : 'p'));
}
