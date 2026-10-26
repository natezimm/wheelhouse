import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { CalendarEvent, CalendarStore, eventRefusal } from '../core/calendar';
import { Day } from '../core/days';
import { EventDraft, draftOf, newDraft, onDayOf, peopleChoices, problemWith, requestOf, revise, togglePerson, writableCalendars } from '../core/event-draft';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { ModalFocus } from '../shared/modal-focus';
import { AvatarFace } from '../shared/avatar-face';
import { RepeatPicker } from '../shared/repeat-picker';

/** The phone's sheet for adding an event, or changing or deleting one, over the calendar. */
@Component({
  selector: 'app-event-sheet',
  imports: [AvatarFace, ModalFocus, RepeatPicker],
  template: `
    @if (draft(); as draft) {
      <form
        class="card"
        appModalFocus
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="heading()"
        (keydown.escape)="!busy() && closed.emit()"
        (submit)="$event.preventDefault(); save()"
      >
        <header>
          <h1>{{ heading() }}</h1>
          <span class="saves">{{ savesTo() }}</span>
        </header>

        <fieldset [disabled]="busy() || uncertain()">
        <label class="field">
          Title
          <input type="text" maxlength="255" autocomplete="off" [value]="draft.title" (input)="set({ title: $any($event.target).value })" />
        </label>

        <label class="field">
          Calendar
          <select [disabled]="event()?.recurring && scope() === 'this'" (change)="set({ calendarId: $any($event.target).value })">
            @for (choice of choices(); track choice.id) {
              <option [value]="choice.id" [selected]="choice.id === draft.calendarId">{{ choice.label }}</option>
            }
          </select>
        </label>

        @if (people().length > 1) {
          <div class="field">
            <span id="sheet-who">Who</span>
            <div class="people" role="group" aria-labelledby="sheet-who">
              @for (person of people(); track person.id) {
                <button
                  type="button"
                  class="person"
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
          </div>
        }

        @if (!event()?.recurring) {
          <app-repeat-picker [rule]="draft.recurrence" [day]="draft.startDate" (ruleChange)="set({ recurrence: $event })" />
        } @else {
          <label class="field">
            Change
            <select (change)="setScope($any($event.target).value)">
              <option value="this" [selected]="scope() === 'this'">This event</option>
              <option value="following" [selected]="scope() === 'following'">This and following events</option>
              <option value="all" [selected]="scope() === 'all'">All events in the series</option>
            </select>
          </label>
          @if (scope() !== 'this') {
            <app-repeat-picker [allowNever]="false" [rule]="draft.recurrence" [day]="draft.startDate" (ruleChange)="set({ recurrence: $event })" />
          }
        }

        <label class="all-day">
          <input type="checkbox" [checked]="draft.allDay" [disabled]="series()" (change)="set({ allDay: $any($event.target).checked })" />
          All day
        </label>

        <div class="pair">
          <label class="field">
            {{ draft.allDay ? 'First day' : 'Starts' }}
            <input type="date" [value]="draft.startDate" [disabled]="series()" (change)="setStartDate($any($event.target).value)" />
          </label>
          @if (!draft.allDay) {
            <label class="field">
              <span class="sr-only">Start time</span>&nbsp;
              <input type="time" step="300" [value]="draft.startTime" (change)="set({ startTime: $any($event.target).value })" />
            </label>
          }
        </div>

        <div class="pair">
          <label class="field">
            {{ draft.allDay ? 'Last day' : 'Ends' }}
            <input type="date" [value]="draft.endDate" [disabled]="series() && !draft.allDay" (change)="set({ endDate: $any($event.target).value })" />
          </label>
          @if (!draft.allDay) {
            <label class="field">
              <span class="sr-only">End time</span>&nbsp;
              <input type="time" step="300" [value]="draft.endTime" (change)="set({ endTime: $any($event.target).value })" />
            </label>
          }
        </div>

        <label class="field">
          Location
          <input type="text" maxlength="255" autocomplete="off" [value]="draft.location" (input)="set({ location: $any($event.target).value })" />
        </label>

        <label class="field">
          Notes
          <textarea rows="3" maxlength="8192" [value]="draft.notes" (input)="set({ notes: $any($event.target).value })"></textarea>
        </label>

        </fieldset>
        @if (series()) {
          <p class="note">Every event in the series keeps its own day.</p>
        }

        @if (message(); as message) {
          <p class="message" role="alert">{{ message }}</p>
        }

        <div class="actions">
          <button type="submit" class="button primary" [disabled]="busy()">{{ uncertain() ? 'Check save' : 'Save' }}</button>
          <button type="button" class="button" [disabled]="busy()" (click)="closed.emit()">Cancel</button>
        </div>

        @if (event()) {
          @if (confirmingDelete()) {
            <div class="actions">
              <button type="button" class="button danger" [disabled]="busy()" (click)="remove()">{{ series() ? 'Delete all events' : following() ? 'Delete this and later events' : 'Delete event' }}</button>
              <button type="button" class="button" (click)="confirmingDelete.set(false)">Keep it</button>
            </div>
          } @else {
            <button type="button" class="button quiet-danger" [disabled]="busy()" (click)="confirmingDelete.set(true)">Delete event</button>
          }
        }
      </form>
    }
  `,
  styles: `
    fieldset { display: grid; gap: 16px; min-width: 0; padding: 0; margin: 0; border: 0; }
    :host {
      position: fixed;
      inset: 0;
      z-index: 10;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 24px 18px;
      background: var(--ground);
    }

    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 26px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
    }

    .saves {
      font-size: 13px;
      color: var(--muted);
    }

    .pair {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
      gap: 10px;
    }

    .all-day {
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 600;
    }

    .all-day:has(input:disabled) {
      opacity: 0.45;
    }

    .all-day input {
      width: 22px;
      height: 22px;
      margin: 0;
      accent-color: var(--ink);
    }

    .note,
    .message {
      margin: 0;
      font-size: 14px;
    }

    .note {
      color: var(--muted);
    }

    .message {
      padding: 10px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--warn) 14%, var(--surface));
      font-weight: 600;
    }

    .people {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .person {
      min-height: 44px;
      padding: 0 14px 0 6px;
      border: 1px solid var(--line);
      border-radius: var(--pill);
      background: var(--surface);
      color: var(--ink);
      font: 600 15px var(--font-body);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .person[aria-pressed='true'] {
      border: 2px solid var(--ink);
      background: var(--member-chip-bg);
    }

    .person:disabled:not(.owner) {
      opacity: 0.45;
    }

    .mark {
      flex-shrink: 0;
      width: 30px;
      height: 30px;
      box-sizing: border-box;
      border-radius: 50%;
      background: var(--member-strong);
      border: var(--avatar-border);
      color: var(--on-avatar);
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
  `,
})
export class EventSheet {
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

  protected readonly choices = computed(() => writableCalendars(this.calendar.calendars(), this.family.members()));

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

  protected set(change: Partial<EventDraft>): void {
    if (this.busy() || this.uncertain()) return;
    const draft = this.draft();
    if (draft) {
      this.edits.set(revise(draft, { ...draft, ...change }, this.following()));
      this.message.set(null);
    }
  }

  /** All events of a series keep their own days and share a calendar; see the wall's dialog. */
  protected setScope(scope: 'this' | 'following' | 'all'): void {
    const draft = this.draft();
    const event = this.event();
    const family = this.family.family();
    if (!draft || !event || !family) {
      return;
    }
    const original = draftOf(event, family.timeZone);
    this.scope.set(scope);
    this.set(scope === 'all' ? onDayOf(draft, original)
      : scope === 'this' ? { calendarId: original.calendarId, recurrence: original.recurrence } : {});
  }

  /** A new first day moves the last day with it, so the event keeps its length. */
  protected setStartDate(startDate: Day): void {
    const draft = this.draft();
    if (draft && startDate) {
      const length = Date.parse(draft.endDate) - Date.parse(draft.startDate);
      const endDate = new Date(Date.parse(startDate) + length).toISOString().slice(0, 10);
      this.set({ startDate, endDate });
    }
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
    const family = this.family.family();
    if (refusal.changed && family) {
      this.edits.set(draftOf(refusal.changed, family.timeZone));
    }
    this.message.set(refusal.message);
  }
}

