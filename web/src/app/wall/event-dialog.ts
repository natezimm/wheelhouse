import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, computed, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { CalendarEvent, CalendarStore, eventRefusal } from '../core/calendar';
import { Day, formatDay } from '../core/days';
import {
  EventDraft,
  STEP_MINUTES,
  clockLabel,
  draftOf,
  moveDays,
  moveEnd,
  moveLastDay,
  moveStart,
  newDraft,
  onDayOf,
  problemWith,
  requestOf,
  peopleChoices,
  revise,
  togglePerson,
  writableCalendars,
} from '../core/event-draft';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { ModalFocus } from '../shared/modal-focus';
import { AvatarFace } from '../shared/avatar-face';
import { RepeatPicker } from '../shared/repeat-picker';

/**
 * The wall's dialog for adding an event, or changing or deleting one. Everything works by touch:
 * days and times move with steppers, since a wall has no comfortable date picker.
 */
@Component({
  selector: 'app-event-dialog',
  imports: [AvatarFace, ModalFocus, RepeatPicker],
  template: `
    <div class="scrim" aria-hidden="true" (click)="!busy() && closed.emit()"></div>
    @if (draft(); as draft) {
      <form
        appModalFocus
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="heading()"
        (keydown.escape)="!busy() && closed.emit()"
        (submit)="$event.preventDefault(); save()"
      >
        <div class="top">
          <h1>{{ heading() }}</h1>
          <span class="saves"><span class="dot" aria-hidden="true"></span>{{ savesTo() }}</span>
        </div>

        <div class="fields">
          <fieldset class="field" [disabled]="busy() || uncertain()">
            <label for="event-title">TITLE</label>
            <input
              #title
              id="event-title"
              type="text"
              class="title"
              autocomplete="off"
              maxlength="255"
              [value]="draft.title"
              (input)="set({ title: $any($event.target).value })"
            />
          </fieldset>

          <fieldset class="field" [disabled]="busy() || uncertain()">
            <span id="event-when">WHEN</span>
            <div class="when" role="group" aria-labelledby="event-when">
              <div class="stepper date">
                <button type="button" [attr.aria-label]="draft.allDay ? 'First day earlier' : 'A day earlier'" [disabled]="series()" (click)="adjust(moveDays, -1)">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
                </button>
                <span>{{ dayLabel(draft.startDate) }}</span>
                <button type="button" [attr.aria-label]="draft.allDay ? 'First day later' : 'A day later'" [disabled]="series()" (click)="adjust(moveDays, 1)">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
                </button>
              </div>
              @if (draft.allDay) {
                <div class="stepper date">
                  <button type="button" aria-label="Last day earlier" (click)="adjust(moveLastDay, -1)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
                  </button>
                  <span>{{ draft.endDate === draft.startDate ? 'One day' : 'to ' + dayLabel(draft.endDate) }}</span>
                  <button type="button" aria-label="Last day later" (click)="adjust(moveLastDay, 1)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
                  </button>
                </div>
              } @else {
                <div class="stepper">
                  <button type="button" aria-label="Start earlier" (click)="adjust(moveStart, -step)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"></path></svg>
                  </button>
                  <span>{{ clockLabel(draft.startTime) }}</span>
                  <button type="button" aria-label="Start later" (click)="adjust(moveStart, step)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
                  </button>
                </div>
                <div class="stepper">
                  <button type="button" aria-label="End earlier" (click)="adjust(moveEnd, -step)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"></path></svg>
                  </button>
                  <span>
                    {{ clockLabel(draft.endTime) }}
                    @if (draft.endDate !== draft.startDate) {
                      <small>{{ shortDay(draft.endDate) }}</small>
                    }
                  </span>
                  <button type="button" aria-label="End later" (click)="adjust(moveEnd, step)">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
                  </button>
                </div>
              }
            </div>
          </fieldset>

          <fieldset class="field" [disabled]="busy() || uncertain()">
            <span id="event-calendar">CALENDAR</span>
            <div class="calendars" role="group" aria-labelledby="event-calendar">
              @for (choice of choices(); track choice.id) {
                <button
                  type="button"
                  class="chip"
                  [style.--member]="choice.color"
                  [attr.aria-pressed]="choice.id === draft.calendarId"
                  [disabled]="event()?.recurring && scope() === 'this' && choice.id !== draft.calendarId"
                  (click)="set({ calendarId: choice.id })"
                >
                  <span class="mark" aria-hidden="true"><app-avatar-face [initial]="choice.initial" [avatar]="choice.avatar" /></span>{{ choice.label }}
                </button>
              }
            </div>
          </fieldset>

          @if (people().length > 1) {
            <fieldset class="field" [disabled]="busy() || uncertain()">
              <span id="event-who">WHO</span>
              <div class="calendars" role="group" aria-labelledby="event-who">
                @for (person of people(); track person.id) {
                  <button
                    type="button"
                    class="chip"
                    [class.owner]="person.owner"
                    [style.--member]="person.color"
                    [attr.aria-pressed]="person.chosen"
                    [attr.aria-label]="person.owner ? person.name + ', owner of the calendar' : person.name"
                    [disabled]="person.owner"
                    (click)="set({ people: togglePerson(draft, person.id) })"
                  >
                    <span class="mark" aria-hidden="true"><app-avatar-face [initial]="person.initial" [avatar]="person.avatar" /></span>{{ person.name }}
                  </button>
                }
              </div>
            </fieldset>
          }

          <fieldset class="field" [disabled]="busy() || uncertain()">
            @if (!event()?.recurring) {
              <span id="event-repeat">REPEAT</span>
              <app-repeat-picker layout="wall" [rule]="draft.recurrence" [day]="draft.startDate" (ruleChange)="set({ recurrence: $event })" />
            } @else {
              <span id="event-repeat">CHANGE</span>
              <div class="segments" role="group" aria-labelledby="event-repeat">
                <button type="button" [attr.aria-pressed]="scope() === 'this'" (click)="setScope('this')">This event</button>
                <button type="button" [attr.aria-pressed]="scope() === 'following'" (click)="setScope('following')">This and following</button>
                <button type="button" [attr.aria-pressed]="scope() === 'all'" (click)="setScope('all')">All events</button>
              </div>
              @if (scope() !== 'this') {
                <app-repeat-picker layout="wall" [allowNever]="false" [rule]="draft.recurrence" [day]="draft.startDate" (ruleChange)="set({ recurrence: $event })" />
              }
            }
            <div class="toggles">
              <label class="all-day">
                <input type="checkbox" [checked]="draft.allDay" [disabled]="series()" (change)="set({ allDay: $any($event.target).checked })" />
                All day
              </label>
              @if (!isDisplay()) {
                <label class="all-day">
                  <input type="checkbox" [checked]="draft.isPrivate" (change)="set({ isPrivate: $any($event.target).checked })" />
                  Private
                </label>
              }
            </div>
          </fieldset>

          <fieldset class="field" [disabled]="busy() || uncertain()">
            <label for="event-location">LOCATION</label>
            <input
              id="event-location"
              type="text"
              autocomplete="off"
              maxlength="255"
              [value]="draft.location"
              (input)="set({ location: $any($event.target).value })"
            />
          </fieldset>

          <fieldset class="field" [disabled]="busy() || uncertain()">
            <label for="event-notes">NOTES</label>
            <textarea id="event-notes" rows="3" maxlength="8192" [value]="draft.notes" (input)="set({ notes: $any($event.target).value })"></textarea>
          </fieldset>

          <div class="actions">
            @if (confirmingDelete()) {
              <span class="confirm">{{ series() ? 'Delete every event in this series?' : following() ? 'Delete this and every later event?' : 'Delete this event?' }}</span>
              <button type="button" class="ghost" (click)="confirmingDelete.set(false)">Keep it</button>
              <button type="button" class="danger" [disabled]="busy()" (click)="remove()">{{ series() ? 'Delete all events' : following() ? 'Delete these events' : 'Delete event' }}</button>
            } @else {
              @if (event()) {
                <button type="button" class="quiet-danger" [disabled]="busy()" (click)="confirmingDelete.set(true)">Delete</button>
              }
              <button type="button" class="ghost" [disabled]="busy()" (click)="closed.emit()">Cancel</button>
              <button type="submit" class="primary" [disabled]="busy()">{{ uncertain() ? 'Check save' : event() ? 'Save changes' : 'Save event' }}</button>
            }
          </div>
        </div>

        @if (message(); as message) {
          <p class="message" role="alert">{{ message }}</p>
        }
      </form>
    }
  `,
  styles: `
    fieldset { min-width: 0; padding: 0; margin: 0; border: 0; }
    :host {
      position: fixed;
      inset: 0;
      z-index: 10;
    }

    .scrim {
      position: absolute;
      inset: 0;
      background: var(--scrim-strong);
    }

    /* Near the top, so the on-screen keyboard leaves the fields in view. */
    form {
      position: absolute;
      left: 50%;
      top: 44px;
      width: 1400px;
      max-width: calc(100% - 72px);
      max-height: calc(100% - 88px);
      overflow-y: auto;
      transform: translateX(-50%);
      box-sizing: border-box;
      margin: 0;
      padding: 32px 36px;
      border: var(--card-border);
      border-radius: var(--card-radius);
      background: var(--surface);
      box-shadow: var(--dialog-shadow);
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 34px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
    }

    .saves {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
      color: var(--muted);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: var(--ok);
    }

    .fields {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
      gap: 24px 36px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .field > label,
    .field > span {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--muted);
    }

    textarea {
      box-sizing: border-box;
      min-height: 112px;
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--field);
      color: var(--ink);
      font: 400 20px/1.4 var(--font-body);
      resize: vertical;
    }

    input[type='text'] {
      height: 64px;
      box-sizing: border-box;
      padding: 0 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--field);
      color: var(--ink);
      font: 400 20px var(--font-body);
    }

    input.title {
      border: 2px solid var(--ink);
      background: var(--surface);
      font-size: 24px;
      font-weight: 600;
    }

    .when,
    .calendars {
      display: flex;
      gap: 10px;
    }

    /* A long calendar name takes the room it needs, and the chips wrap onto another row. */
    .calendars {
      flex-wrap: wrap;
    }

    .stepper {
      flex: 1;
      min-width: 0;
      height: 64px;
      box-sizing: border-box;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--field);
      display: flex;
      align-items: center;
    }

    .stepper.date {
      flex: 1.25;
    }

    .stepper > span {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 19px;
      font-weight: 600;
      line-height: 1.1;
      white-space: nowrap;
    }

    .stepper small {
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
    }

    .stepper button {
      flex-shrink: 0;
      width: 56px;
      height: 62px;
      border: 0;
      background: none;
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .chip {
      flex: 1 1 auto;
      min-width: 0;
      max-width: 100%;
      height: 64px;
      white-space: nowrap;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: var(--pill);
      background: var(--surface);
      color: var(--ink);
      font: 600 19px var(--font-body);
      display: flex;
      align-items: center;
      gap: 9px;
      cursor: pointer;
    }

    .chip[aria-pressed='true'] {
      border: 2px solid var(--ink);
      background: var(--member-chip-bg);
    }

    .chip:disabled {
      opacity: 0.45;
      cursor: default;
    }

    /* The calendar's owner is always one of the event's people, so their chip stays on. */
    .chip.owner:disabled {
      opacity: 1;
    }

    .mark {
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      box-sizing: border-box;
      border-radius: 17px;
      background: var(--member-strong);
      border: var(--avatar-border);
      color: var(--on-avatar);
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .field > .segments {
      flex: none;
    }

    .toggles {
      display: flex;
      gap: 32px;
    }

    .all-day {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 56px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
    }

    .all-day input {
      width: 28px;
      height: 28px;
      margin: 0;
      accent-color: var(--ink);
    }

    .stepper button:disabled,
    .all-day:has(input:disabled) {
      opacity: 0.35;
      cursor: default;
    }

    .segments {
      flex: 1;
      display: grid;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      padding: 4px;
      border: var(--track-border);
      border-radius: min(16px, var(--pill));
      background: var(--track);
    }

    .segments button {
      height: 56px;
      border: 0;
      border-radius: min(12px, var(--pill));
      background: transparent;
      color: var(--quiet);
      font: 600 17px var(--font-body);
      cursor: pointer;
    }

    .segments button[aria-pressed='true'] {
      background: var(--segment);
      box-shadow: var(--raised);
      color: var(--on-segment);
      font-weight: 700;
    }

    .actions {
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      gap: 12px;
    }

    .actions button {
      height: 64px;
      padding: 0 32px;
      border-radius: var(--pill);
      font: 600 20px var(--font-body);
      cursor: pointer;
    }

    .actions button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .ghost {
      border: var(--control-border);
      background: var(--surface);
      box-shadow: var(--control-shadow);
      color: var(--ink);
    }

    .primary {
      padding: 0 44px;
      border: var(--primary-border);
      background: var(--primary);
      box-shadow: var(--primary-shadow);
      color: var(--on-primary);
      font-weight: 700;
    }

    .danger {
      border: 0;
      background: var(--danger);
      color: var(--on-danger);
      font-weight: 700;
    }

    .quiet-danger {
      margin-right: auto;
      border: 0;
      background: none;
      color: var(--danger);
    }

    .confirm {
      margin-right: auto;
      align-self: center;
      font-size: 20px;
      font-weight: 600;
    }

    .message {
      margin: 0;
      padding: 14px 18px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--warn) 14%, var(--surface));
      font-size: 18px;
      font-weight: 600;
    }
  `,
})
export class EventDialog {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly session = inject(SessionStore);

  /** The event to change, or null to add one. */
  readonly event = input<CalendarEvent | null>(null);

  /** The day a new event goes on. */
  readonly day = input.required<Day>();

  /** The time a new event starts, as 'HH:mm', when one was picked on the grid. */
  readonly at = input<string | null>(null);

  /** Opens straight to asking whether to delete the event, as Delete in its details does. */
  readonly deleting = input(false);

  readonly closed = output<void>();

  protected readonly step = STEP_MINUTES;
  protected readonly clockLabel = clockLabel;
  protected readonly moveDays = moveDays;
  protected readonly moveLastDay = moveLastDay;
  protected readonly moveStart = moveStart;
  protected readonly moveEnd = moveEnd;

  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('title');

  protected readonly choices = computed(() => writableCalendars(this.calendar.calendars(), this.family.members()));

  /** What the dialog holds; null until the family is known. Set from the event or the day when it opens. */
  private readonly edits = signal<EventDraft | null>(null);

  protected readonly draft = computed(() => {
    const edits = this.edits();
    if (edits) {
      return edits;
    }
    const family = this.family.family();
    const event = this.event();
    const first = this.choices()[0];
    if (!family) {
      return null;
    }
    if (event) {
      return draftOf(event, family.timeZone);
    }
    return first ? newDraft(this.day(), first.id, family.timeZone, new Date(), this.at()) : null;
  });

  protected readonly people = computed(() => {
    const draft = this.draft();
    return draft ? peopleChoices(draft, this.calendar.calendars(), this.family.members()) : [];
  });
  protected readonly togglePerson = togglePerson;
  /** A display shows private events only as busy, so it cannot make one. */
  protected readonly isDisplay = this.session.isDisplay;

  protected readonly heading = computed(() => (this.event() ? 'Edit event' : 'New event'));
  protected readonly savesTo = computed(() => (this.session.isDemo() ? 'Saves to the demo calendar' : 'Saves to Google Calendar'));

  /** Which events of a series a change goes to: this one, it and every later one, or all of them. */
  protected readonly scope = signal<'this' | 'following' | 'all'>('this');
  protected readonly series = computed(() => !!this.event()?.recurring && this.scope() === 'all');
  protected readonly following = computed(() => !!this.event()?.recurring && this.scope() === 'following');

  private readonly operationId = crypto.randomUUID();
  protected readonly uncertain = computed(() => this.calendar.isUncertain(this.operationId));
  protected readonly busy = signal(false);
  protected readonly confirmingDelete = linkedSignal(() => this.deleting());
  protected readonly message = signal<string | null>(null);

  /** Whether closing it would lose something: a change, or a save still going or to check. */
  readonly holdsWork = computed(() => this.edits() !== null || this.busy() || this.uncertain());

  ngAfterViewInit(): void {
    if (!this.event()) {
      this.titleInput()?.nativeElement.focus();
    }
  }

  protected set(change: Partial<EventDraft>): void {
    const draft = this.draft();
    if (draft) {
      this.change({ ...draft, ...change });
    }
  }

  /** Moves a day or time from the dialog's current state, so quick taps add up. */
  protected adjust(move: (draft: EventDraft, by: number) => EventDraft, by: number): void {
    const draft = this.draft();
    if (draft) {
      this.change(move(draft, by));
    }
  }

  /**
   * Every event of a series stays on its own day and in one calendar, so choosing all of them
   * puts the day back, and choosing one again puts its calendar and rule back. Events from this
   * one on become a series of their own, so they can move and take a new calendar or rule.
   */
  protected setScope(scope: 'this' | 'following' | 'all'): void {
    const draft = this.draft();
    const event = this.event();
    const family = this.family.family();
    if (!draft || !event || !family) {
      return;
    }
    const original = draftOf(event, family.timeZone);
    this.scope.set(scope);
    this.change(scope === 'all' ? onDayOf(draft, original)
      : scope === 'this' ? { ...draft, calendarId: original.calendarId, recurrence: original.recurrence } : draft);
  }

  private change(draft: EventDraft): void {
    if (this.busy() || this.uncertain()) return;
    const before = this.draft();
    this.edits.set(before ? revise(before, draft, this.following()) : draft);
    this.message.set(null);
  }

  protected dayLabel(day: Day): string {
    return formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  protected shortDay(day: Day): string {
    return formatDay(day, { weekday: 'short' });
  }

  protected save(): void {
    if (this.uncertain() && !this.busy()) {
      this.busy.set(true);
      this.calendar.retry(this.operationId).subscribe({ next: () => this.closed.emit(), error: (error: HttpErrorResponse) => this.refused(error) });
      return;
    }
    const draft = this.draft();
    if (!draft || this.busy()) {
      return;
    }
    const problem = problemWith(draft);
    if (problem) {
      this.message.set(problem);
      return;
    }
    const event = this.event();
    const request = requestOf(draft);
    this.edits.set(draft);
    this.busy.set(true);
    (event ? this.calendar.update(event.id, request, this.following() ? 'following' : this.series(), this.operationId) : this.calendar.add(request, this.operationId)).subscribe({
      next: () => this.closed.emit(),
      error: (error: HttpErrorResponse) => this.refused(error),
    });
  }

  protected remove(): void {
    const event = this.event();
    if (!event || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.calendar.remove(event.id, this.following() ? 'following' : this.series(), this.operationId).subscribe({
      next: () => this.closed.emit(),
      error: (error: HttpErrorResponse) => this.refused(error),
    });
  }

  private refused(error: HttpErrorResponse): void {
    this.busy.set(false);
    this.confirmingDelete.set(false);
    const refusal = eventRefusal(error);
    if (refusal.changed) {
      // Show Google's version, so whoever is at the wall decides again with it in front of them.
      const family = this.family.family();
      if (family) {
        this.edits.set(draftOf(refusal.changed, family.timeZone));
      }
    }
    this.message.set(refusal.message);
  }
}

