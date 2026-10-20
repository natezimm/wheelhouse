import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Clock } from '../core/clock';
import { addDays, dayIn, daysBetween, formatDay, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';
import { MEAL_SLOTS, Meal, MealCopy, MealsStore, mealKey } from '../core/meals';
import { PhoneNav } from '../phone/phone-nav';
import { SignIn } from '../phone/sign-in';
import { DemoNotice } from './demo-notice';
import { Recipe, RecipeSnapshot, RecipesStore } from '../core/recipes';
import { RecipeLibrary } from './recipe-library';
import { RecipeDetail } from './recipe-detail';

type Editor = { kind: 'edit' | 'clear'; meal: Meal } | { kind:'copy'; from: string; sourceFrom: string };
type CopyRow = MealCopy & { selected: boolean };

@Component({
  selector:'app-meals-page',
  imports:[FormsModule, RouterLink, PhoneNav, SignIn, DemoNotice, RecipeLibrary, RecipeDetail],
  host:{ '[class.wall]':'wall' },
  template:`
    <header><div><a [routerLink]="wall ? '/wall' : '/'">← {{ wall ? 'Calendar' : 'Today' }}</a><h1>Meals</h1><p>A little planning. One less daily decision.</p></div></header>
    @if (family.state().status === 'private') {
      @if (wall) { <p>Pair this display to plan meals.</p><a routerLink="/wall">Pair display</a> } @else { <app-sign-in /> }
    } @else if (family.family()) {
      <div class="connection" role="status"><span>{{ live.state() === 'reconnecting' ? 'Reconnecting' : live.state() === 'connected' || live.state() === 'resyncing' ? 'Live updates' : 'Connecting' }}</span>
        <button class="button" [disabled]="store.refreshing()" (click)="live.resync()">{{ store.refreshing() ? 'Resyncing…' : 'Resync now' }}</button></div>
      <nav class="week-nav" aria-label="Meal week">
        <button class="button" (click)="navigate(-7)" [disabled]="week() <= '1900-01-08'">Previous week</button>
        <div><h2>Week of {{ label(week()) }}</h2><button class="button" (click)="focus.set(null)">This week</button></div>
        <button class="button" (click)="navigate(7)" [disabled]="week() >= '2199-12-17'">Next week</button>
      </nav>
      @if (!wall) { <button class="button copy" (click)="openCopy()" [disabled]="!store.ready() || !!store.pending().length">Copy previous week…</button> }
      <a class="button" [routerLink]="wall ? '/wall/recipes' : '/recipes'">Recipe library</a>
      @if (store.refreshFailed()) { <p class="error" role="alert">Could not refresh meals. Saved contents remain available. Use Resync now to retry.</p> }
      @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p> }
      @for (op of store.pending(); track op.key) {
        <div class="save-status" role="status">{{ op.uncertain ? 'Save not confirmed' : 'Saving…' }} · {{ label(op.from) }}
          @if (op.uncertain) { <button class="button" (click)="checkSave(op.key)">Check save</button> }
        </div>
      }
      @if (!store.ready() && !store.refreshFailed()) { <p role="status">Loading meal plan…</p> }
      @if (store.ready()) {
        <div class="week">
          @for (day of days(); track day) {
            <section class="card day" [class.today]="day === today()" [attr.aria-label]="day">
              <h2>{{ dayLabel(day) }}</h2>@if (day === today()) { <small>Today</small> }
              @for (slot of slots; track slot) {
                @if (meal(day, slot); as item) {
                  <button class="meal" [class.dinner]="slot === 'Dinner'" [class.pending]="store.isPending(item)" [disabled]="store.isPending(item)"
                    [attr.aria-label]="'Edit ' + day + ' ' + slot" (click)="open(item)">
                    <span class="kind">{{ slot }}</span><strong>{{ item.title || 'Not planned' }}</strong>
                    @if (item.recipe) { <small>Recipe · {{ item.servings }} servings</small> }
                    @if (item.notes) { <span class="notes">{{ item.notes }}</span> }
                    @if (store.isPending(item)) { <small>Saving / check save</small> }
                  </button>
                }
              }
            </section>
          }
        </div>
      }
    } @else { <p>Loading your household…</p> }
    @if (editor(); as edit) {
      <dialog #dialog (cancel)="close()" (close)="close()"><form (ngSubmit)="save()">
        <h2>{{ edit.kind === 'copy' ? 'Copy previous week' : edit.kind === 'clear' ? 'Clear meal' : 'Plan a meal' }}</h2>
        @if (edit.kind === 'copy') {
          <p>{{ label(edit.sourceFrom) }} → {{ label(edit.from) }}. Select the meals to copy. Existing meals are kept unless you select Replace. Empty source slots do not clear anything.</p>
          @if (copyLoading()) { <p role="status">Loading copy preview…</p> }
          @if (copyError()) { <p class="error" role="alert">{{ copyError() }}</p><button class="button" type="button" (click)="openCopy(edit.from)">Retry preview</button> }
          @for (row of copyRows(); track row.source.date + row.source.slot) {
            <label class="copy-row"><input type="checkbox" [checked]="row.selected" [disabled]="locked()" (change)="toggleCopy(row)" />
              <span><strong>{{ dayLabel(row.target.date) }} · {{ row.source.slot }}</strong><span>{{ row.source.title }}</span>
                <small>{{ row.target.title ? 'Replace: ' + row.target.title : 'Empty destination' }}</small>
              </span></label>
          } @empty { @if (!copyLoading() && !copyError()) { <p>No meals were planned in the previous week.</p> } }
          <p>{{ chosenCount() }} meals selected. The original week is unchanged.</p>
        } @else {
          <p>{{ dayLabel(edit.meal.date) }} · {{ edit.meal.slot }}</p>
          @if (edit.kind === 'clear') { <p>Clear “{{ edit.meal.title }}”? Other meals are kept.</p> }
          @else {
            @if (choosing()) {
              <h3>Choose a recipe</h3><app-recipe-library [wall]="wall" [selecting]="true" (chosen)="choose($event)" />
              <button class="button" type="button" (click)="choosing.set(false)">Back to meal</button>
            } @else {
            <label class="field">Meal title<input name="title" maxlength="200" required [ngModel]="title()" (ngModelChange)="title.set($event)" [disabled]="locked()" [readOnly]="!!recipe()" /></label>
            <button class="button" type="button" [disabled]="locked()" (click)="choosing.set(true)">{{ recipe() ? 'Choose / refresh recipe…' : 'Choose recipe…' }}</button>
            @if (recipe(); as saved) {
              <p>Saved recipe contents. Library changes do not change this meal. Choose the recipe again to review and use its latest contents.</p>
              <app-recipe-detail [recipe]="saved" [servings]="servings()" (servingsChange)="servings.set($event)" [wall]="wall" [locked]="locked()" />
              <button class="button" type="button" [disabled]="locked()" (click)="detach()">Change to free-text meal</button>
            }
            <label class="field">Notes<textarea name="notes" maxlength="2000" [ngModel]="notes()" (ngModelChange)="notes.set($event)" [disabled]="locked()"></textarea></label>
            @if (edit.meal.title) { <button class="button danger" type="button" [disabled]="locked() || conflicted()" (click)="confirmClear()">Clear this meal…</button> }
            }
          }
        }
        @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p> }
        @if (conflicted()) {
          @if (edit.kind !== 'copy') { <p>Latest meal: {{ currentMeal()?.title || 'Not planned' }}@if (currentMeal()?.notes) { · {{ currentMeal()?.notes }} }</p> }
          <p>{{ edit.kind === 'copy' ? 'Review latest reloads the preview and resets overwrite selections.' : 'Review latest keeps your draft and uses the current slot version.' }}</p>
          <button class="button" type="button" [disabled]="store.refreshing() || store.refreshFailed()" (click)="review()">Review latest</button>
        }
        <div class="actions"><button class="button" type="button" (click)="close()">{{ locked() ? 'Close' : 'Cancel' }}</button>
          <button class="button primary" [disabled]="locked() || conflicted() || choosing() || (edit.kind === 'edit' && (!title().trim() || !validServings())) || (edit.kind === 'copy' && (!chosenCount() || copyLoading() || !!copyError()))">{{ saving() ? 'Saving…' : edit.kind === 'clear' ? 'Clear meal' : edit.kind === 'copy' ? 'Copy selected meals' : 'Save meal' }}</button></div>
      </form></dialog>
    }
    <footer><app-demo-notice />@if (wall) { <a class="button" routerLink="/wall/lists">Lists</a><a class="button" routerLink="/wall/chores">Chores</a> }</footer>
    @if (!wall) { <app-phone-nav /> }
  `,
  styles:`
    :host { display:flex; flex-direction:column; gap:18px; max-width:1200px; margin:auto; padding:24px 18px 12px; min-height:100vh; box-sizing:border-box; }
    h1,h2,p { margin:0; } h1 { font:600 40px var(--font-display); margin:10px 0 4px; } h2 { font:600 24px var(--font-display); }
    header p,.kind,.notes,small { color:var(--muted); } a { color:var(--ink); display:inline-flex; align-items:center; min-height:44px; }
    .connection,.week-nav,.actions,.save-status,footer { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .connection .button { margin-left:auto; } .week-nav { justify-content:space-between; } .week-nav div { text-align:center; } .week-nav h2 { margin-bottom:8px; }
    .copy { align-self:flex-start; } .week { display:grid; gap:16px; } .day { min-width:0; } .day.today { outline:2px solid var(--accent); }
    .meal { display:flex; flex-direction:column; gap:8px; border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:14px; text-align:left; color:var(--ink); font:inherit; min-height:90px; cursor:pointer; overflow-wrap:anywhere; }
    .dinner { background:color-mix(in srgb,var(--accent) 5%,var(--surface)); } .kind { font-size:14px; } .notes { white-space:pre-wrap; font-size:14px; } .pending { opacity:.65; } .error { color:var(--danger); }
    footer { margin-top:auto; } dialog { border:1px solid var(--line); border-radius:20px; padding:24px; width:min(560px,calc(100vw - 40px)); box-sizing:border-box; background:var(--surface); color:var(--ink); }
    dialog::backdrop { background:#0005; } dialog form { display:flex; flex-direction:column; gap:18px; } textarea { border:1px solid var(--line); border-radius:12px; padding:12px; font:inherit; min-height:90px; box-sizing:border-box; width:100%; color:var(--ink); background:var(--surface); }
    .actions { justify-content:flex-end; } .copy-row { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
    .copy-row input { flex:0 0 44px; width:44px; height:44px; } .copy-row span { display:flex; flex-direction:column; gap:5px; min-width:0; }
    :host.wall { max-width:none; padding:28px 36px; font-size:20px; } :host.wall .week { grid-template-columns:repeat(7,minmax(0,1fr)); align-items:start; }
    :host.wall .button,:host.wall input,:host.wall textarea,:host.wall a { min-height:56px; font-size:20px; } :host.wall .meal { min-height:140px; } :host.wall .day { padding:16px; } :host.wall dialog { width:600px; }
    @media(max-width:600px) { .week-nav { display:grid; grid-template-columns:1fr 1fr; } .week-nav div { grid-column:1/-1; grid-row:1; } .week-nav .button { width:100%; } }
  `,
})
export class MealsPage {
  protected readonly store = inject(MealsStore);
  protected readonly family = inject(FamilyStore);
  protected readonly live = inject(HouseholdLive);
  protected readonly recipes = inject(RecipesStore);
  protected readonly wall = inject(ActivatedRoute).snapshot.data['wall'] === true;
  private readonly clock = inject(Clock);
  protected readonly slots = MEAL_SLOTS;
  protected readonly today = computed(() => dayIn(this.family.family()?.timeZone ?? 'UTC', this.clock.now()));
  protected readonly focus = signal<string | null>(null);
  protected readonly week = computed(() => this.focus() ?? startOfWeek(this.today(), this.family.family()?.weekStartsOn ?? 'Monday'));
  protected readonly days = computed(() => daysBetween(this.week(), addDays(this.week(), 7)));
  protected readonly editor = signal<Editor | null>(null);
  protected readonly title = signal(''); protected readonly notes = signal('');
  protected readonly recipe = signal<RecipeSnapshot | null>(null); protected readonly servings = signal(4); protected readonly choosing = signal(false);
  private selection: RecipeSnapshot | null = null; private removeRecipe = false;
  protected readonly saving = signal(false); protected readonly conflicted = signal(false);
  protected readonly copyRows = signal<CopyRow[]>([]); protected readonly copyLoading = signal(false); protected readonly copyError = signal('');
  protected readonly chosenCount = computed(() => this.copyRows().filter(r => r.selected).length);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private editorEpoch = 0; private operation: string | null = null;
  protected readonly locked = computed(() => this.saving() || !!this.operation && this.store.pending().some(o => o.key === this.operation));
  protected readonly currentMeal = computed(() => { const edit = this.editor(); return edit && edit.kind !== 'copy' ? this.meal(edit.meal.date, edit.meal.slot) : undefined; });
  constructor() {
    this.family.load(); let identity: string | null = null;
    effect(() => {
      const f = this.family.family(), denied = this.family.state().status === 'private';
      if (denied || f && identity && f.id !== identity) untracked(() => { this.focus.set(null); this.close(); });
      if (f) identity = f.id;
    });
    effect(() => { const f = this.family.family(), from = this.week(); if (f) untracked(() => this.store.select(from, addDays(from, 7))); });
    effect(() => { const dialog = this.dialog()?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); });
  }
  protected label(day: string): string { return formatDay(day, { month:'short', day:'numeric', year:'numeric' }); }
  protected dayLabel(day: string): string { return formatDay(day, { weekday:'short', month:'short', day:'numeric' }); }
  protected meal(date: string, slot: string): Meal | undefined { return this.store.meals().find(m => m.date === date && m.slot === slot); }
  protected navigate(offset: number): void { this.focus.set(addDays(this.week(), offset)); }
  protected open(meal: Meal): void { this.focus.set(this.week()); this.close(); this.editor.set({ kind:'edit', meal:structuredClone(meal) }); this.title.set(meal.title ?? ''); this.notes.set(meal.notes ?? ''); this.recipe.set(meal.recipe ? structuredClone(meal.recipe) : null); this.servings.set(meal.servings ?? 4); }
  protected choose(choice: {recipe:Recipe;servings:number}): void {
    this.selection = structuredClone(choice.recipe); this.recipe.set(this.selection); this.title.set(choice.recipe.content.title);
    this.servings.set(choice.servings); this.removeRecipe = false; this.choosing.set(false); this.conflicted.set(false);
  }
  protected detach(): void { this.recipe.set(null); this.selection = null; this.removeRecipe = true; }
  protected validServings(): boolean { return !this.recipe() || Number.isInteger(this.servings()) && this.servings() >= 1 && this.servings() <= 100; }
  protected confirmClear(): void { const edit = this.editor(); if (edit?.kind === 'edit') this.editor.set({ kind:'clear', meal:edit.meal }); }
  protected close(): void { this.editorEpoch++; this.editor.set(null); this.operation = null; this.selection = null; this.removeRecipe = false; this.recipe.set(null); this.choosing.set(false); this.saving.set(false); this.conflicted.set(false); this.copyLoading.set(false); this.copyError.set(''); }
  protected async openCopy(from = this.week()): Promise<void> {
    this.focus.set(from);
    this.close(); const epoch = this.editorEpoch, sourceFrom = addDays(from, -7);
    this.editor.set({ kind:'copy', from, sourceFrom }); this.copyRows.set([]); this.copyLoading.set(true);
    try {
      const [source, target] = await Promise.all([this.store.readRange(sourceFrom, from), this.store.readRange(from, addDays(from, 7))]);
      if (epoch !== this.editorEpoch) return;
      this.copyRows.set(source.meals.filter(m => m.title).map(m => {
        const date = addDays(from, Math.round((Date.parse(m.date) - Date.parse(sourceFrom)) / 86_400_000));
        const destination = target.meals.find(t => t.date === date && t.slot === m.slot)!;
        return { source:m, target:destination, selected:!destination.title };
      }));
      this.store.dismissError();
    } catch { if (epoch === this.editorEpoch) this.copyError.set('Could not load the copy preview. No meals were changed.'); }
    finally { if (epoch === this.editorEpoch) this.copyLoading.set(false); }
  }
  protected toggleCopy(row: CopyRow): void { this.copyRows.update(rows => rows.map(r => mealKey(r.source) === mealKey(row.source) ? { ...r, selected:!r.selected } : r)); }
  protected review(): void {
    const edit = this.editor(); if (!edit) return;
    if (edit.kind === 'copy') { void this.openCopy(edit.from); return; }
    const meal = this.currentMeal(); if (!meal) return;
    this.editor.set({ ...edit, meal:{ ...meal } }); this.conflicted.set(false); this.store.dismissError();
    if (this.selection) this.choosing.set(true);
    else if (this.recipe()) {
      this.recipe.set(meal.recipe ? structuredClone(meal.recipe) : null); this.title.set(meal.title ?? '');
    } else if (meal.recipe) this.removeRecipe = true;
  }
  protected async save(): Promise<void> {
    const edit = this.editor(); if (!edit || this.locked() || this.conflicted()) return;
    if (this.choosing() || edit.kind === 'edit' && (!this.title().trim() || !this.validServings()) || edit.kind === 'copy' && (!this.chosenCount() || this.copyLoading() || this.copyError())) return;
    const epoch = this.editorEpoch; this.saving.set(true);
    const previous = new Set(this.store.pending().map(o => o.key));
    const task = edit.kind === 'copy' ? this.store.copy(edit.sourceFrom, edit.from, this.copyRows().filter(r => r.selected))
      : this.store.save(edit.meal, edit.kind === 'clear' ? null : this.title(), edit.kind === 'clear' ? null : this.notes(),
        edit.kind === 'clear' ? null : this.selection, edit.kind === 'clear' || !this.recipe() ? null : this.servings(), this.removeRecipe);
    this.operation = this.store.pending().find(o => !previous.has(o.key))?.key ?? null;
    const ok = await task; if (epoch !== this.editorEpoch) return;
    this.saving.set(false); if (ok) this.close(); else if (!this.locked()) this.conflicted.set(this.store.error().includes('another device'));
  }
  protected async checkSave(key: string): Promise<void> {
    const epoch = this.editorEpoch;
    if (await this.store.retry(key) && epoch === this.editorEpoch && this.operation === key) this.close();
  }
}
