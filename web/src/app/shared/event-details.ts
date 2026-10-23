import { Component, ElementRef, computed, effect, inject, input, output, viewChild } from '@angular/core';
import { CalendarEvent, CalendarStore, colorOf, daysOf, timeRange } from '../core/calendar';
import { addDays, dayIn, formatDay, timeIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { ModalFocus } from './modal-focus';

/**
 * What an event is, before anyone changes it: whose it is, when, where, whether it repeats and
 * which calendar holds it, then Edit and Delete. A drawer from the right over the calendar on
 * the wall and a desktop, a sheet from the bottom on a phone. An event from a calendar that
 * cannot be changed shows the same details and says why it has no Edit.
 */
@Component({
  selector: 'app-event-details',
  imports: [ModalFocus],
  host: { '[class]': 'layout()', '(keydown.escape)': 'closed.emit()' },
  template: `
    @if (shown(); as event) {
      <button type="button" class="scrim" tabindex="-1" aria-label="Close details" (click)="closed.emit()"></button>
      <section class="panel" appModalFocus tabindex="-1" role="dialog" aria-modal="true" [attr.aria-label]="event.title" [style.--member]="event.color">
        @if (layout() === 'phone') {
          <span class="grip" aria-hidden="true"></span>
        }
        <div class="owner">
          <span class="who"><span class="mark" aria-hidden="true">{{ event.initial }}</span>{{ event.who }}</span>
          <button #close type="button" class="close" aria-label="Close" (click)="closed.emit()">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
          </button>
        </div>
        <div class="hero">
          <span class="day">{{ event.day }}</span>
          <h2>{{ event.title }}</h2>
          <span class="when">{{ event.when }}</span>
        </div>
        <ul class="facts">
          @if (event.location) {
            <li>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>
              <span>{{ event.location }}</span>
            </li>
          }
          <li>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4"></path></svg>
            <span>{{ event.repeats ? 'Repeats' : 'Does not repeat' }}</span>
          </li>
          <li>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path></svg>
            <span>{{ event.calendar }}</span>
          </li>
        </ul>
        <div class="actions">
          @if (!event.canWrite) {
            <p class="note">This event comes from the {{ event.calendar }} calendar, which Wheelhouse can show but not change.</p>
          } @else {
            @if (event.saving) {
              <p class="note" role="status">{{ event.saving }}</p>
            }
            <div class="buttons">
              <button type="button" class="edit" [disabled]="event.busy" (click)="edit.emit(event.source)">Edit event</button>
              <button type="button" class="delete" [disabled]="event.busy" (click)="remove.emit(event.source)">Delete</button>
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 3;
    }

    :host(.phone) {
      position: fixed;
      z-index: 20;
    }

    .scrim {
      position: absolute;
      inset: 0;
      width: 100%;
      border: 0;
      background: var(--scrim);
      cursor: pointer;
    }

    :host(.phone) .scrim {
      background: var(--scrim-strong);
    }

    .panel {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 560px;
      max-width: 100%;
      box-sizing: border-box;
      padding: 26px 30px 30px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 22px;
      background: var(--surface);
      box-shadow: var(--drawer-shadow);
    }

    :host(.desktop) .panel {
      width: 420px;
      padding: 20px 22px 24px;
      gap: 18px;
    }

    :host(.phone) .panel {
      top: auto;
      left: 0;
      width: auto;
      max-height: calc(100% - 48px);
      padding: 10px 18px calc(28px + env(safe-area-inset-bottom));
      gap: 16px;
      border-radius: 26px 26px 0 0;
      box-shadow: var(--sheet-shadow);
    }

    .grip {
      align-self: center;
      width: 40px;
      height: 5px;
      border-radius: 3px;
      background: var(--line);
    }

    .owner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .who {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 18px;
      font-weight: 700;
    }

    .mark {
      width: 36px;
      height: 36px;
      border-radius: 18px;
      background: var(--member-strong);
      border: var(--avatar-border);
      box-sizing: border-box;
      color: var(--on-avatar);
      font-size: 17px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close {
      flex-shrink: 0;
      width: 56px;
      height: 56px;
      border: 0;
      border-radius: 28px;
      background: var(--soft);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .hero {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 22px 24px 24px;
      border: var(--chip-border);
      border-radius: 22px;
      background: var(--member-chip-bg);
    }

    .day {
      font-size: 16px;
      font-weight: 700;
      color: var(--member-text);
    }

    h2 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 38px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      line-height: 1.1;
      letter-spacing: -0.01em;
      overflow-wrap: anywhere;
    }

    .when {
      font-size: 20px;
      font-weight: 600;
    }

    .facts {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 18px;
      font-size: 18px;
    }

    .facts li {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      overflow-wrap: anywhere;
    }

    .facts svg {
      flex-shrink: 0;
      margin-top: 1px;
      color: var(--muted);
    }

    .actions {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .buttons {
      display: flex;
      gap: 12px;
    }

    .buttons button {
      height: 64px;
      border-radius: var(--pill);
      font: 700 20px var(--font-body);
      cursor: pointer;
    }

    .buttons button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .edit {
      flex: 1;
      border: var(--primary-border);
      background: var(--primary);
      box-shadow: var(--primary-shadow);
      color: var(--on-primary);
    }

    .delete {
      padding: 0 28px;
      border: 1px solid var(--danger-line);
      background: var(--surface);
      color: var(--danger-text);
    }

    .note {
      margin: 0;
      padding: 18px 20px;
      border-radius: 18px;
      background: var(--ground);
      color: var(--notice-ink);
      font-size: 17px;
      line-height: 1.4;
    }

    /* A desktop window and a phone use their own smaller sizes; the controls stay finger-sized. */
    :host(.desktop) .close,
    :host(.phone) .close {
      width: 44px;
      height: 44px;
      border-radius: 22px;
    }

    :host(.desktop) .who,
    :host(.phone) .who {
      gap: 10px;
      font-size: 16px;
    }

    :host(.desktop) .mark,
    :host(.phone) .mark {
      width: 30px;
      height: 30px;
      border-radius: 15px;
      font-size: 15px;
    }

    :host(.desktop) .hero,
    :host(.phone) .hero {
      gap: 6px;
      padding: 16px 18px 18px;
      border-radius: 18px;
    }

    :host(.desktop) .day,
    :host(.phone) .day {
      font-size: 14px;
    }

    :host(.desktop) h2,
    :host(.phone) h2 {
      font-size: 28px;
    }

    :host(.desktop) .when,
    :host(.phone) .when {
      font-size: 17px;
    }

    :host(.desktop) .facts,
    :host(.phone) .facts {
      gap: 14px;
      font-size: 16px;
    }

    :host(.desktop) .facts li,
    :host(.phone) .facts li {
      gap: 12px;
    }

    :host(.desktop) .buttons button,
    :host(.phone) .buttons button {
      height: 52px;
      font-size: 17px;
    }

    :host(.desktop) .delete,
    :host(.phone) .delete {
      padding: 0 22px;
    }

    :host(.desktop) .note,
    :host(.phone) .note {
      padding: 14px 16px;
      border-radius: 14px;
      font-size: 15px;
    }
  `,
})
export class EventDetails {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);

  /** The event to show, by id; it follows the calendar as the event changes. */
  readonly eventId = input.required<string>();

  /** A drawer on the wall and a desktop, a sheet on a phone. */
  readonly layout = input<'wall' | 'desktop' | 'phone'>('wall');

  readonly closed = output<void>();
  readonly edit = output<CalendarEvent>();
  readonly remove = output<CalendarEvent>();

  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('close');

  protected readonly shown = computed(() => {
    const family = this.family.family();
    const event = this.calendar.allEvents().find((e) => e.id === this.eventId());
    if (!family || !event) {
      return null;
    }
    const zone = family.timeZone;
    const member = family.members.find((m) => m.id === event.memberId);
    const source = this.calendar.calendars().find((c) => c.id === event.calendarId);
    const operation = this.calendar
      .pending()
      .find((op) => op.id === event.creationId || op.original?.id === event.id || op.originals.some((e) => e.id === event.id));
    const busy = !!event.pending || this.calendar.isPending(event.id);
    return {
      source: event,
      title: event.title,
      color: colorOf(event, family.members),
      who: member?.displayName ?? 'Family',
      initial: member?.initial ?? 'F',
      location: event.location,
      repeats: event.recurring,
      calendar: source?.name ?? 'Unknown',
      canWrite: !!source?.canWrite,
      busy,
      saving: !busy ? null : operation?.status === 'uncertain' ? 'This change may not have saved. Check it from the save notice.' : 'Saving this change…',
      ...whenOf(event, zone),
    };
  });

  constructor() {
    // An event that is gone (deleted here or in Google, or the calendar was reset because the
    // family signed out) has nothing left to show. Only a read in flight is worth waiting for.
    let seen = false;
    effect(() => {
      const shown = this.shown();
      if (shown && !seen) {
        seen = true;
        queueMicrotask(() => this.closeButton()?.nativeElement.focus());
      }
      if (!shown && seen && this.calendar.state().status !== 'loading') {
        this.closed.emit();
      }
    });
  }
}

/** The day line and the time line of the details' tinted block. */
function whenOf(event: CalendarEvent, zone: string): { day: string; when: string } {
  const long = { weekday: 'long', month: 'long', day: 'numeric' } as const;
  const brief = { weekday: 'short', month: 'short', day: 'numeric' } as const;
  if (event.allDay) {
    const last = addDays(event.endDate!, -1);
    const count = daysOf(event, zone).length;
    return last === event.startDate
      ? { day: formatDay(event.startDate!, long), when: 'All day' }
      : { day: `${formatDay(event.startDate!, brief)} – ${formatDay(last, brief)}`, when: `All day · ${count} days` };
  }
  const first = dayIn(zone, event.startsAt!);
  const days = daysOf(event, zone);
  if (days.length === 1) {
    return { day: formatDay(first, long), when: timeRange(event, zone) };
  }
  return {
    day: `${formatDay(first, brief)} – ${formatDay(days.at(-1)!, brief)}`,
    when: `${formatDay(first, { weekday: 'short' })} ${timeIn(zone, event.startsAt!)} – ${formatDay(days.at(-1)!, { weekday: 'short' })} ${timeIn(zone, event.endsAt!)}`,
  };
}
