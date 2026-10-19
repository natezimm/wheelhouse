import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ChoreStatus, choreProgress, matchesChoreStatus } from '../core/chore-overview';
import { Chore, ChoreDraft, ChoresStore } from '../core/chores';
import { Clock } from '../core/clock';
import { addDays, dayIn, formatDay, timeIn, weekdayOf } from '../core/days';
import { ChoreRepeat } from '../core/chore-repeat';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';
import { PhoneNav } from '../phone/phone-nav';
import { SignIn } from '../phone/sign-in';
import { DemoNotice } from './demo-notice';

@Component({
  selector: 'app-chores-page',
  imports: [FormsModule, NgTemplateOutlet, RouterLink, PhoneNav, SignIn, DemoNotice],
  host: { '[class.wall]': 'wall()' },
  template: `
    <header class="page-header">
      <div><a [routerLink]="wall() ? '/wall' : '/'">← {{ wall() ? 'Calendar' : 'Today' }}</a>
        <h1>Chores</h1><p>A little teamwork, every day.</p></div>
      @if (canManage() && mode() === 'day') { <button class="button primary" (click)="open(null)">Add chore</button> }
    </header>

    @if (family.state().status === 'private') {
      @if (wall()) { <p>This display needs to be paired with your household.</p><a routerLink="/wall">Pair this display</a> }
      @else { <app-sign-in /> }
    } @else if (family.family()) {
      <div class="view-controls" role="group" aria-label="Chore view">
        <button class="button" [attr.aria-pressed]="mode() === 'day'" (click)="showDay()">Day</button>
        <button class="button" [attr.aria-pressed]="mode() === 'history'" (click)="showHistory()">History</button>
        <button class="button today" (click)="goToday()">Today</button>
      </div>
      @if (mode() === 'day') {
      <section class="toolbar" aria-label="Chore date">
        <button class="button" aria-label="Previous day" (click)="move(-1)">←</button>
        <label class="field"><span class="sr-only">Chore date</span>
          <input type="date" [ngModel]="selected()" (ngModelChange)="choose($event)" required />
        </label>
        <button class="button" aria-label="Next day" (click)="move(1)">→</button>
      </section>
      } @else {
        <section class="toolbar history-controls" aria-label="Chore history dates">
          <label class="field">History from<input type="date" [ngModel]="range().from" (ngModelChange)="changeRange('from', $event)" [max]="today()" required /></label>
          <label class="field">History through<input type="date" [ngModel]="historyThrough()" (ngModelChange)="changeRange('to', $event)" [max]="today()" required /></label>
          </section>
        <p>Review up to 31 days of chores.</p>
        @if (!validRange()) { <p class="error" role="alert">Choose 1 to 31 days ending today or earlier.</p> }
      }
      <section class="filters" aria-label="Chore filters">
        <label class="field">Member<select [ngModel]="owner()" (ngModelChange)="owner.set($event)">
          <option value="all">Everyone</option><option value="household">Household</option>
          @for (member of family.members(); track member.id) { <option [value]="member.id">{{ member.displayName }}</option> }
        </select></label>
        <label class="field">Status<select [ngModel]="status()" (ngModelChange)="status.set($event)">
          <option value="all">All statuses</option><option value="remaining">Remaining</option><option value="completed">Completed</option><option value="missed">Missed repeats</option>
          @if (mode() === 'history') { <option value="archived">Archived definitions</option> }
        </select></label>
        @if (owner() !== 'all' || status() !== 'all') { <button class="button" (click)="clearFilters()">Clear filters</button> }
      </section>
      <div class="day-heading"><h2>{{ mode() === 'day' ? dateLabel() : 'Chore history' }}</h2>@if (store.ready() && (mode() === 'day' || validRange())) { <span>{{ completed().length }} done · {{ active().length }} remaining</span> }</div>

      <div class="connection" role="status" aria-live="polite">
        <span class="dot" [class.online]="live.state() === 'connected' || live.state() === 'resyncing'"></span>
        <span class="connection-label">{{ connectionLabel() }}</span>
        <button class="button" [disabled]="store.refreshing() || (mode() === 'history' && !validRange())" [attr.aria-busy]="store.refreshing()" (click)="live.resync()">
          {{ store.refreshing() ? 'Resyncing…' : 'Resync now' }}
        </button>
      </div>
      @if (store.refreshFailed()) { <p class="error" role="alert">Chores could not be refreshed. Try Resync now. Your last saved view is still available.</p> }
      @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p> }
      @for (operation of store.pending(); track operation.key) {
        <div class="save-status" role="status">
          {{ operation.preview.title }}: {{ operation.uncertain ? 'save unconfirmed' : 'saving…' }}
          @if (operation.preview.repeat) { <span>Due {{ dueLabel(operation.preview.dueDate) }}</span> }
          @if (operation.uncertain && editorOperation() !== operation.key) {
            <button class="button" (click)="store.retry(operation.key)">Check save</button>
          }
        </div>
      }

      @if (!store.ready() && !store.refreshFailed()) { <p role="status">Loading chores…</p> }
      @if (store.ready() && (mode() === 'day' || validRange())) {
        @if (mode() === 'history') {
          <div class="history-days">
            @for (group of historyDays(); track group.day) {
              <section class="card history-day"><div class="day-heading"><h2>{{ fullDate(group.day) }}</h2>
                <button class="button" [attr.aria-label]="'Open ' + fullDate(group.day)" (click)="openDay(group.day)">Open day</button></div>
                @for (chore of group.items; track chore.occurrenceId ?? chore.id) {
                  <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: chore }" />
                }
              </section>
            }
          </div>
        } @else {
        @if (overdue().length) {
          <section class="overdue card"><h2>Overdue</h2>
            @for (chore of overdue(); track chore.occurrenceId ?? chore.id) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: chore }" />
            }
          </section>
        }
        <div class="groups">
          @for (group of groups(); track group.id) {
            <section class="member-card" [style.--member-color]="group.color">
              <h2><span class="avatar">{{ group.initial }}</span>{{ group.name }}<span class="count">{{ group.done }} of {{ group.total }} done</span></h2>
              <progress [value]="group.done" [max]="group.total || 1" [attr.aria-label]="group.name + ' chore progress'"></progress>
              @for (chore of group.items; track chore.occurrenceId ?? chore.id) {
                <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: chore }" />
              } @empty { <p class="empty">{{ group.remaining ? 'Earlier work is in Overdue.' : 'All clear for ' + dateLabel() + '.' }}</p> }
            </section>
          }
        </div>
        <details class="card completed" [open]="status() === 'completed'"><summary>Completed ({{ completed().length }})</summary>
          @for (chore of completed(); track chore.occurrenceId ?? chore.id) {
            <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: chore }" />
          } @empty { <p>No completed chores for this date yet.</p> }
        </details>
        }
        @if (!filtered().length && store.items().length) { <p class="empty" role="status">No chores match these filters.</p> }
        @if (!store.items().length) { <p class="empty">{{ mode() === 'history' ? 'No chore history for these due dates.' : 'No chores for this date.' }} {{ mode() === 'day' ? (canManage() ? 'Add a chore to get started.' : 'A parent can add chores from their phone.') : '' }}</p> }
      }
    } @else { <p role="status">Loading your household…</p> }

    <ng-template #row let-chore>
      <article class="chore" [class.pending]="store.isPending(chore.id, chore.dueDate)">
        <button class="check" [disabled]="chore.archived || store.isPending(chore.id, chore.dueDate) || (chore.repeat && chore.dueDate > today())" [attr.aria-label]="(chore.completedAt ? 'Reopen ' : 'Complete ') + chore.title"
          [attr.aria-pressed]="!!chore.completedAt" (click)="store.complete(chore, !chore.completedAt)">{{ chore.completedAt ? '✓' : '○' }}</button>
        <div class="chore-body"><h3 [class.done]="chore.completedAt">{{ chore.title }}</h3>
          @if (chore.notes) { <p>{{ chore.notes }}</p> }
          <small>{{ memberName(chore.memberId) }} · Due {{ dueLabel(chore.dueDate) }}</small>
          @if (chore.repeat) {
            <small>{{ repeatLabel(chore.repeat) }}</small>
            @if (chore.missed) { <small class="missed">Missed</small> }
            @if (chore.dueDate > today()) { <small>Available to complete on its due date.</small> }
            @if (chore.nextChangeDate && chore.dueDate <= today()) { <small>Schedule changes from {{ dueLabel(chore.nextChangeDate) }}.</small> }
            @if (chore.stopsOn) { <small>Repeats stop from {{ dueLabel(chore.stopsOn) }}.</small> }
          }
          @if (chore.archived) { <small>Archived · saved history</small> }
          @if (chore.completedAt) { <small>Completed {{ completionTime(chore.completedAt) }}</small> }
        </div>
        @if (canManage() && !chore.archived && !chore.seriesArchived) { <button class="button edit" [disabled]="store.definitionPending(chore.id)" [attr.aria-label]="'Edit ' + chore.title" (click)="open(chore)">Edit</button> }
      </article>
    </ng-template>

    <footer><app-demo-notice />
      @if (wall()) { <span>Parents manage chores from their phone.</span> }
    </footer>
    @if (!wall()) { <app-phone-nav /> }

    @if (editor()) {
      <dialog #dialog aria-labelledby="chore-editor-title" (cancel)="cancelEditor($event)">
        <form (ngSubmit)="save()">
          <h2 id="chore-editor-title">{{ original() ? 'Edit chore' : 'Add chore' }}</h2>
          <fieldset [disabled]="editorLocked()">
            <label class="field">Title<input name="title" [(ngModel)]="draft.title" maxlength="200" required autofocus /></label>
            <label class="field">Notes<textarea name="notes" [(ngModel)]="draft.notes" maxlength="2000" rows="3"></textarea></label>
            <label class="field">Assigned to<select name="member" [(ngModel)]="draft.memberId">
              <option [ngValue]="null">Household</option>
              @for (member of family.members(); track member.id) { <option [ngValue]="member.id">{{ member.displayName }}</option> }
            </select></label>
            <label class="field">Repeat<select name="repeat" [ngModel]="draft.repeat?.frequency ?? 'None'" (ngModelChange)="repeatChanged($event)" [disabled]="!!original() && !original()?.repeat">
              @if (!original()?.repeat) { <option value="None">Does not repeat</option> }
              <option value="Daily">Every day</option><option value="Weekly">Selected weekdays / weeks</option>
            </select></label>
            <label class="field">{{ draft.repeat ? 'Schedule start' : 'Due date' }}<input type="date" name="due" [(ngModel)]="draft.dueDate" required /></label>
            @if (draft.repeat; as repeat) {
              @if (repeat.frequency === 'Weekly') {
                <label class="field">Repeat every (weeks)<input type="number" name="interval" [(ngModel)]="repeat.intervalWeeks" min="1" max="52" required /></label>
                <div class="field"><span id="repeat-days-label">Repeat on</span><div class="weekdays" role="group" aria-labelledby="repeat-days-label">
                  @for (name of weekdayNames; track $index) {
                    <label><input type="checkbox" [name]="'weekday' + $index" [ngModel]="repeat.weekdays.includes($index)" (ngModelChange)="setWeekday($index, $event)" />{{ name }}</label>
                  }
                </div></div>
              }
              <label class="field">End date (optional)<input type="date" name="end" [(ngModel)]="repeat.endsOn" [min]="draft.dueDate" /></label>
              @if (!validRepeat()) { <p class="error">Select at least one weekday, a whole interval from 1 to 52 weeks, and an end date on or after the start.</p> }
            }
          </fieldset>
          @if (original()?.repeat) { <p>Changes start tomorrow, {{ dueLabel(tomorrow()) }}, in your household's time zone. Today and earlier dates keep their saved schedule.</p> }
          @if (original() && !original()?.repeat) { <p>This is a one-time chore. Create a new chore to set up a repeating schedule.</p> }
          @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p> }
          @if (editorUncertain()) {
            <p>The submitted draft is frozen until its result is checked.</p>
            <button class="button primary" type="button" (click)="checkEditor()">Check save</button>
          }
          <div class="actions">
            <button class="button" type="button" [disabled]="editorSaving()" (click)="close()">{{ editorUncertain() ? 'Close' : 'Cancel' }}</button>
            @if (original() && !editorLocked()) { <button class="button" type="button" (click)="reload()">Reload chore</button> }
            <button class="button primary" type="submit" [disabled]="editorLocked() || !draft.title.trim() || !draft.dueDate || !validRepeat()">{{ editorSaving() ? 'Saving…' : 'Save chore' }}</button>
          </div>
          @if (original() && !editorLocked()) {
            @if (!confirmArchive()) { <button class="button quiet-danger" type="button" (click)="confirmArchive.set(true)">Archive chore</button> }
            @else { <p>{{ original()?.repeat ? 'Stop repeats from tomorrow? Today and earlier history will remain.' : 'Remove this chore from active work? Its saved history will remain.' }}</p><button class="button danger" type="button" (click)="archive()">Confirm archive</button> }
          }
        </form>
      </dialog>
    }
  `,
  styles: `
    :host { box-sizing: border-box; min-height: 100vh; padding: 24px 18px 12px; display: flex; flex-direction: column; gap: 16px; }
    .page-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    h1,h2,h3,p { margin: 0; } h1,h2 { font-family: var(--font-display); } h1 { font-size: 38px; margin-top: 12px; }
    h2 { font-size: 22px; } h3 { font-size: 17px; overflow-wrap: anywhere; } p { color: var(--muted); line-height: 1.5; }
    a { color: var(--accent); min-height: 44px; display: inline-flex; align-items: center; }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .toolbar label { flex: 1; min-width: 130px; max-width: 240px; } input[type=date] { min-width: 0; appearance: none; }
    .day-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .day-heading span, small, .empty { color: var(--muted); } .connection { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--warn); } .dot.online { background: var(--ok); }
    .connection .button { margin-left: auto; } .error { color: var(--danger); } .save-status { display: flex; align-items: center; gap: 12px; }
    .view-controls { display: flex; gap: 8px; } .view-controls .today { margin-left: auto; } .view-controls [aria-pressed=true] { background: var(--ink); color: var(--surface); }
    .filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; } .filters label { flex: 1; min-width: 130px; max-width: 260px; }
    .history-days { display: grid; gap: 16px; } progress { width: 100%; height: 8px; accent-color: var(--member-color); }
    .groups { display: grid; gap: 16px; } .member-card { background: var(--surface); border: 1px solid var(--line); border-top: 4px solid var(--member-color); border-radius: 16px; padding: 16px; }
    .member-card h2 { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; } .count { margin-left: auto; font: 600 16px var(--font-body); color: var(--muted); }
    .avatar { background: var(--member-color); color: white; border-radius: 50%; width: 36px; height: 36px; display: grid; place-items: center; font: 700 18px var(--font-body); }
    .chore { display: flex; align-items: flex-start; gap: 10px; padding: 14px 0; border-bottom: 1px solid var(--hairline); }
    .chore:last-child { border: 0; } .chore-body { flex: 1; min-width: 0; display: grid; gap: 6px; } small { display: block; }
    .check { flex: 0 0 44px; min-height: 44px; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); color: var(--ok); font-size: 26px; cursor: pointer; }
    .check[aria-pressed=true] { background: #e7f3ef; } .pending { opacity: .65; } .done { text-decoration: line-through; color: var(--muted); }
    .edit { padding: 0 12px; } .empty { padding: 12px 0; } .overdue { border-left: 4px solid var(--warn); }
    details summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 700; }
    footer { margin-top: auto; display: flex; justify-content: space-between; color: var(--muted); gap: 16px; }
    dialog { box-sizing: border-box; width: min(520px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow-y: auto; border: 0; border-radius: 20px; padding: 24px; color: var(--ink); background: var(--surface); }
    dialog::backdrop { background: #1f232866; } form { display: grid; gap: 18px; } fieldset { min-width: 0; margin: 0; padding: 0; border: 0; display: grid; gap: 16px; }
    textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--line); border-radius: 12px; padding: 12px; font: 16px var(--font-body); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .weekdays { display: flex; flex-wrap: wrap; gap: 6px; } .weekdays label { min-height: 44px; min-width: 58px; display: flex; align-items: center; gap: 6px; }
    .weekdays input { width: 20px; height: 20px; accent-color: var(--accent); } .missed { color: var(--warn); font-weight: 700; }
    :host.wall { padding: 28px 36px; font-size: 20px; } :host.wall h1 { font-size: 48px; } :host.wall h2 { font-size: 28px; } :host.wall h3 { font-size: 23px; }
    :host.wall .groups { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); } :host.wall .button, :host.wall a, :host.wall summary { min-height: 56px; font-size: 20px; }
    :host.wall .check { flex-basis: 56px; min-height: 56px; } :host.wall input, :host.wall select { min-height: 56px; font-size: 20px; }
  `,
})
export class ChoresPage {
  readonly wall = input(false);
  protected readonly store = inject(ChoresStore);
  protected readonly family = inject(FamilyStore);
  protected readonly live = inject(HouseholdLive);
  private readonly clock = inject(Clock);
  protected readonly focus = signal<string | null>(null);
  protected readonly today = computed(() => dayIn(this.family.family()?.timeZone ?? 'UTC', this.clock.now()));
  protected readonly tomorrow = computed(() => addDays(this.today(), 1));
  protected readonly selected = computed(() => this.focus() ?? this.today());
  protected readonly weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  protected readonly dateLabel = computed(() => formatDay(this.selected(), { weekday: 'long', month: 'short', day: 'numeric' }));
  protected readonly canManage = computed(() => !this.wall() && this.family.state().status === 'ready' && this.store.canManage());
  protected readonly mode = signal<'day' | 'history'>('day');
  protected readonly owner = signal('all');
  protected readonly status = signal<ChoreStatus>('all');
  private readonly historyRange = signal<{ from: string; to: string } | null>(null);
  protected readonly range = computed(() => this.historyRange() ?? { from: addDays(this.today(), -6), to: addDays(this.today(), 1) });
  protected readonly historyThrough = computed(() => this.range().to ? addDays(this.range().to, -1) : '');
  protected readonly validRange = computed(() => {
    const { from, to } = this.range();
    const days = (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86_400_000;
    return days >= 1 && days <= 31 && to <= addDays(this.today(), 1);
  });
  protected readonly filtered = computed(() => this.store.items().filter(c =>
    (this.owner() === 'all' || (c.memberId ?? 'household') === this.owner()) && matchesChoreStatus(c, this.status())));
  protected readonly active = computed(() => this.filtered().filter(c => !c.completedAt && !c.archived));
  protected readonly overdue = computed(() => this.active().filter(c => c.dueDate < this.selected()));
  protected readonly completed = computed(() => this.filtered().filter(c => !!c.completedAt));
  protected readonly groups = computed(() => [
    ...this.family.members().map(m => ({ id: m.id as string | null, name: m.displayName, initial: m.initial, color: m.color })),
    { id: null, name: 'Household', initial: 'H', color: '#5B6470' },
  ].map(group => ({ ...group,
    ...choreProgress(this.store.items().filter(c => (c.memberId ?? null) === group.id), this.selected()),
    items: this.active().filter(c => (c.memberId ?? null) === group.id && c.dueDate === this.selected()),
  })).filter(group => (this.owner() === 'all' || this.owner() === (group.id ?? 'household'))
    && this.status() !== 'completed' && this.status() !== 'archived' && (this.wall() || group.items.length > 0)));
  protected readonly historyDays = computed(() => [...new Set(this.filtered().map(c => c.dueDate))]
    .sort().reverse().map(day => ({ day, items: this.filtered().filter(c => c.dueDate === day) })));
  protected readonly connectionLabel = computed(() => ({ connecting: 'Connecting', connected: 'Live updates', resyncing: 'Live updates', reconnecting: 'Reconnecting', stopped: 'Connecting' })[this.live.state()]);
  protected readonly editor = signal(false);
  protected readonly original = signal<Chore | null>(null);
  protected readonly editorOperation = signal<string | null>(null);
  protected readonly confirmArchive = signal(false);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly editorPending = computed(() => this.store.pending().find(o => o.key === this.editorOperation()));
  protected readonly editorUncertain = computed(() => !!this.editorPending()?.uncertain);
  protected readonly editorSaving = computed(() => !!this.editorPending() && !this.editorUncertain());
  protected readonly editorLocked = computed(() => !!this.editorPending());
  protected draft: ChoreDraft = { title: '', notes: null, memberId: null, dueDate: '' };
  private editorFamily: string | null = null;

  constructor() {
    this.family.load();
    let identity: string | null = null;
    effect(() => {
      const family = this.family.family();
      if (this.family.state().status === 'private' || family && identity && family.id !== identity) {
        this.focus.set(null); this.historyRange.set(null); this.mode.set('day'); this.clearFilters(); this.close();
      }
      if (family) {
        identity = family.id;
        if (this.owner() !== 'all' && this.owner() !== 'household' && !family.members.some(m => m.id === this.owner())) this.owner.set('household');
      }
    });
    effect(() => {
      if (!this.family.family()) return;
      if (this.mode() === 'day') this.store.select(this.selected());
      else if (this.validRange()) this.store.selectHistory(this.range().from, this.range().to);
    });
    effect(() => { const dialog = this.dialog()?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); });
    effect(() => {
      const id = this.family.family()?.id;
      if (this.editor() && (this.family.state().status === 'private' || (id && id !== this.editorFamily))) this.close();
    });
  }
  protected clearFilters(): void { this.owner.set('all'); this.status.set('all'); }
  protected showDay(): void { this.mode.set('day'); if (this.status() === 'archived') this.status.set('all'); }
  protected goToday(): void { this.focus.set(null); this.showDay(); }
  protected openDay(day: string): void { this.focus.set(day); this.showDay(); }
  protected showHistory(): void {
    if (!this.historyRange()) {
      const end = this.selected() > this.today() ? this.today() : this.selected();
      this.historyRange.set({ from: addDays(end, -6), to: addDays(end, 1) });
    }
    this.mode.set('history');
  }
  protected changeRange(edge: 'from' | 'to', day: string): void {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(day);
    this.historyRange.set({ ...this.range(), [edge]: valid ? (edge === 'to' ? addDays(day, 1) : day) : '' });
  }
  protected fullDate(day: string): string { return formatDay(day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
  protected choose(day: string): void { if (/^\d{4}-\d{2}-\d{2}$/.test(day)) this.focus.set(day); }
  protected move(days: number): void { this.focus.set(addDays(this.selected(), days)); }
  protected dueLabel(day: string): string { return formatDay(day, { month: 'short', day: 'numeric' }); }
  protected completionTime(instant: string): string { const zone = this.family.family()?.timeZone ?? 'UTC'; return this.fullDate(dayIn(zone, instant)) + ' at ' + timeIn(zone, instant); }
  protected memberName(id: string | null): string { return this.family.members().find(m => m.id === id)?.displayName ?? 'Household'; }
  protected open(chore: Chore | null): void {
    this.original.set(chore); this.editorOperation.set(null); this.confirmArchive.set(false);
    this.editorFamily = this.family.family()?.id ?? null;
    this.draft = chore ? structuredClone(chore.editDraft ?? { title: chore.title, notes: chore.notes, memberId: chore.memberId, dueDate: chore.dueDate, repeat: chore.repeat ?? null })
      : { title: '', notes: null, memberId: null, dueDate: this.selected() };
    this.editor.set(true);
  }
  protected close(): void { this.dialog()?.nativeElement.close(); this.editor.set(false); this.editorOperation.set(null); }
  protected cancelEditor(event: Event): void { if (this.editorSaving()) event.preventDefault(); else this.close(); }
  protected reload(): void {
    const conflict = this.store.conflict();
    const latest = conflict?.id === this.original()?.id ? conflict : this.store.items().find(c => c.id === this.original()?.id);
    if (latest) this.open(latest);
  }
  protected async save(): Promise<void> {
    if (this.editorLocked() || !this.canManage() || !this.draft.title.trim() || !this.draft.dueDate || !this.validRepeat()) return;
    const submitted = structuredClone(this.draft);
    if (submitted.repeat) submitted.repeat.endsOn ||= null;
    const original = this.original();
    const promise = original ? this.store.edit(original, submitted) : this.store.create(submitted);
    this.editorOperation.set(this.store.pending().at(-1)?.key ?? null);
    if (await promise) this.close();
  }
  protected async checkEditor(): Promise<void> { const key = this.editorOperation(); if (key && await this.store.retry(key)) this.close(); }
  protected async archive(): Promise<void> {
    const chore = this.original(); if (!chore || !this.canManage()) return;
    const promise = this.store.archive(chore);
    this.editorOperation.set(this.store.pending().at(-1)?.key ?? null);
    if (await promise) this.close();
  }
  protected repeatChanged(mode: string): void {
    this.draft.repeat = mode === 'None' ? null : {
      frequency: mode as 'Daily' | 'Weekly', intervalWeeks: 1,
      weekdays: mode === 'Weekly' ? [weekdayOf(this.draft.dueDate)] : [], endsOn: this.draft.repeat?.endsOn ?? null,
    };
  }
  protected setWeekday(day: number, checked: boolean): void {
    const repeat = this.draft.repeat; if (!repeat) return;
    repeat.weekdays = checked ? [...new Set([...repeat.weekdays, day])].sort() : repeat.weekdays.filter(d => d !== day);
  }
  protected validRepeat(): boolean {
    const repeat = this.draft.repeat;
    return !repeat || (!repeat.endsOn || repeat.endsOn >= this.draft.dueDate)
      && (repeat.frequency === 'Daily' || Number.isInteger(repeat.intervalWeeks) && repeat.intervalWeeks >= 1 && repeat.intervalWeeks <= 52 && repeat.weekdays.length > 0);
  }
  protected repeatLabel(repeat: ChoreRepeat): string {
    return repeat.frequency === 'Daily' ? 'Every day' : `${repeat.intervalWeeks === 1 ? 'Every week' : 'Every ' + repeat.intervalWeeks + ' weeks'} · ${repeat.weekdays.map(d => this.weekdayNames[d]).join(', ')}`;
  }
}
