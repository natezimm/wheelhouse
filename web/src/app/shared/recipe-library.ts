import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FamilyStore } from '../core/family';
import { Recipe, RecipeContent, RecipesStore } from '../core/recipes';
import { RecipeDetail } from './recipe-detail';
import { RecipeEditor } from './recipe-editor';

@Component({
  selector:'app-recipe-library',
  imports:[FormsModule, RecipeDetail, RecipeEditor],
  host:{'[class.wall]':'wall()', '[class.selecting]':'selecting()'},
  template:`
    @if (store.refreshFailed()) { <p class="error" role="alert">Could not refresh recipes. Saved contents remain available.</p><button class="button" type="button" (click)="store.refresh()">Retry recipes</button> }
    @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p> }
    @for (op of store.pending(); track op.key) {
      <p role="status">{{ op.uncertain ? 'Recipe save not confirmed' : 'Saving recipe…' }}
        @if (op.uncertain) { <button class="button" type="button" (click)="check(op.key)">Check recipe save</button> }
      </p>
    }
    @if (!store.ready() && !store.refreshFailed()) { <p role="status">Loading recipes…</p> }
    @if (draft; as content) {
      <h2>{{ original ? 'Edit recipe' : 'New recipe' }}</h2>
      <app-recipe-editor [draft]="content" [steps]="steps" (stepsChange)="steps = $event" [locked]="locked()" />
      @if (archiving) { <p>Archive “{{ content.title }}”? Saved meal plans keep their recipe contents.</p> }
      @if (conflicted()) {
        <p>Review latest keeps your draft and uses the current recipe version.</p>
        <button class="button" type="button" [disabled]="store.refreshing() || store.refreshFailed()" (click)="review()">Review latest recipe</button>
      }
      <div class="actions">
        <button class="button" type="button" (click)="close()">Close editor</button>
        @if (original && !archiving && !original.archived) { <button class="button danger" type="button" [disabled]="locked() || conflicted()" (click)="archiving = true">Archive recipe…</button> }
        <button class="button primary" type="button" [disabled]="locked() || conflicted() || !validDraft()" (click)="save()">{{ archiving ? 'Archive recipe' : 'Save recipe' }}</button>
      </div>
    } @else if (detail(); as recipe) {
      <button class="button" type="button" (click)="detail.set(null)">Back to recipes</button>
      @if (recipe.archived) { <p>Archived recipe. Saved meals keep their contents.</p> }
      <app-recipe-detail [recipe]="recipe" [servings]="servings()" (servingsChange)="servings.set($event)" [wall]="wall()" />
      @if (selecting() && !recipe.archived) { <button class="button primary" type="button" [disabled]="store.isPending(recipe.id) || !validServings()" (click)="chosen.emit({recipe,servings:servings()})">Use this recipe</button> }
      @if (canManage()) { <button class="button" type="button" [disabled]="store.isPending(recipe.id)" (click)="edit(recipe)">Edit recipe</button> }
    } @else {
      <div class="actions">
        @if (canManage()) { <button class="button primary" type="button" (click)="edit(null)">New recipe</button> }
        @if (!selecting()) { <label class="archive"><input type="checkbox" [ngModel]="archived()" (ngModelChange)="archived.set($event)" />Show archived recipes</label> }
      </div>
      <div class="recipes">
        @for (recipe of visible(); track recipe.id) {
          <button class="card recipe" type="button" [disabled]="store.isPending(recipe.id)" (click)="show(recipe)">
            <strong>{{ recipe.content.title }}</strong><span>Serves {{ recipe.content.defaultServings }} · {{ recipe.content.ingredients.length }} ingredients</span>
            @if (recipe.archived) { <small>Archived</small> }
          </button>
        } @empty { @if (store.ready()) { <p>No {{ archived() ? 'archived' : 'saved' }} recipes yet. A parent can save recipes from the phone.</p> } }
      </div>
    }
  `,
  styles:`
    :host { display:grid; gap:18px; } h2,p { margin:0; } h2 { font:600 28px var(--font-display); } .error { color:var(--danger); }
    .actions { display:flex; gap:12px; flex-wrap:wrap; align-items:center; } .recipes { display:grid; gap:14px; }
    .recipe { display:grid; gap:8px; width:100%; text-align:left; font:inherit; color:var(--ink); cursor:pointer; overflow-wrap:anywhere; min-height:88px; }
    .recipe strong { font:600 24px var(--font-display); } .recipe span,small { color:var(--muted); }
    .archive { display:flex; align-items:center; gap:8px; } .archive input { width:44px; height:44px; }
    :host.wall { font-size:22px; } :host.wall .recipes { grid-template-columns:repeat(3,minmax(0,1fr)); }
    :host.wall .button { min-height:56px; font-size:22px; } :host.wall .archive input { width:56px; height:56px; }
    :host.selecting .recipes { grid-template-columns:1fr; }
  `,
})
export class RecipeLibrary {
  protected readonly store = inject(RecipesStore); private readonly family = inject(FamilyStore);
  readonly wall = input(false); readonly selecting = input(false);
  readonly chosen = output<{recipe:Recipe;servings:number}>();
  protected readonly archived = signal(false); protected readonly detail = signal<Recipe | null>(null); protected readonly servings = signal(4);
  protected readonly visible = computed(() => this.store.recipes().filter(r => r.archived === this.archived() && (!this.selecting() || !r.archived)));
  protected readonly canManage = computed(() => !this.wall() && !this.selecting() && this.store.canManage());
  protected readonly saving = signal(false); protected readonly conflicted = signal(false);
  protected draft: RecipeContent | null = null; protected original: Recipe | null = null; protected steps = ''; protected archiving = false;
  private id = ''; private version: string | null = null; private operation: string | null = null; private epoch = 0;
  protected readonly locked = computed(() => this.saving() || !!this.operation && this.store.pending().some(o => o.key === this.operation));
  constructor() {
    let identity: string | null = null;
    effect(() => {
      const f = this.family.family(), denied = this.family.state().status === 'private';
      if (denied || f && identity && f.id !== identity) untracked(() => { this.close(); this.detail.set(null); this.archived.set(false); });
      if (f) { identity = f.id; untracked(() => this.store.activate()); }
    });
  }
  protected show(recipe: Recipe): void { this.detail.set(structuredClone(recipe)); this.servings.set(recipe.content.defaultServings); }
  protected edit(recipe: Recipe | null): void {
    this.close(); this.detail.set(null); this.original = recipe ? structuredClone(recipe) : null;
    this.id = recipe?.id ?? crypto.randomUUID(); this.version = recipe?.version ?? null;
    this.draft = recipe ? structuredClone(recipe.content) : {title:'',defaultServings:4,ingredients:[{id:crypto.randomUUID(),name:'',quantity:null,quantityText:null,unit:null}],steps:[],sourceUrl:null,notes:null};
    this.steps = recipe?.content.steps.join('\n') ?? ''; this.store.dismissError();
  }
  protected close(): void { this.epoch++; this.draft = null; this.original = null; this.operation = null; this.archiving = false; this.saving.set(false); this.conflicted.set(false); }
  protected validServings(): boolean { return Number.isInteger(this.servings()) && this.servings() >= 1 && this.servings() <= 100; }
  protected validDraft(): boolean {
    const d = this.draft; return !!d && !!d.title.trim() && Number.isInteger(d.defaultServings) && d.defaultServings >= 1 && d.defaultServings <= 100
      && d.ingredients.length > 0 && d.ingredients.every(i => !!i.name.trim() && !(i.quantity != null && i.quantityText?.trim()))
      && this.steps.split('\n').some(s => s.trim());
  }
  protected review(): void {
    const latest = this.store.recipes().find(r => r.id === this.id);
    if (!latest) return;
    this.version = latest.version; this.original = structuredClone(latest);
    this.conflicted.set(false); this.store.dismissError();
  }
  protected async save(): Promise<void> {
    if (!this.draft || this.locked() || this.conflicted() || !this.validDraft()) return;
    const epoch = this.epoch; this.saving.set(true);
    const previous = new Set(this.store.pending().map(o => o.key));
    const content = {...structuredClone(this.draft),steps:this.steps.split('\n').map(s => s.trim()).filter(Boolean)};
    const task = this.store.save(this.id,this.version,this.archiving || !!this.original?.archived,content);
    this.operation = this.store.pending().find(o => !previous.has(o.key))?.key ?? null;
    const ok = await task; if (epoch !== this.epoch) return;
    this.saving.set(false); if (ok) this.close(); else if (!this.locked()) this.conflicted.set(this.store.error().includes('another device'));
  }
  protected async check(key: string): Promise<void> { const epoch = this.epoch; if (await this.store.retry(key) && epoch === this.epoch && this.operation === key) this.close(); }
}
