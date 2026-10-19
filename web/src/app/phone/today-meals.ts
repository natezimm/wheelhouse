import { Component, computed, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Clock } from '../core/clock';
import { addDays, dayIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { MealsStore } from '../core/meals';

@Component({
  selector:'app-today-meals',
  imports:[RouterLink],
  template:`
    <section class="card" aria-label="Today's meals"><div class="heading"><h2>Today's meals</h2><a routerLink="/meals">Plan the week →</a></div>
      @if (!store.ready() && !store.refreshFailed()) { <p role="status">Loading meals…</p> }
      @if (store.refreshFailed()) { <p role="alert">Could not refresh meals.</p><button class="button" (click)="store.refresh()">Retry meals</button> }
      @if (store.error()) { <p role="alert">{{ store.error() }}</p> }
      @if (store.ready()) {
        @for (meal of store.meals(); track meal.slot) { <div class="meal"><span>{{ meal.slot }}</span><strong>{{ meal.title || 'Not planned' }}</strong>@if (meal.notes) { <small>{{ meal.notes }}</small> }</div> }
      }
      @for (op of store.pending(); track op.key) { <p role="status">{{ op.uncertain ? 'Meal save not confirmed' : 'Saving meal…' }}</p>@if (op.uncertain) { <button class="button" (click)="store.retry(op.key)">Check meal save</button> } }
    </section>
  `,
  styles:`h2,p { margin:0; } h2 { font:600 24px var(--font-display); } .heading { display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; } a { color:var(--ink); min-height:44px; display:inline-flex; align-items:center; } .meal { display:grid; grid-template-columns:90px minmax(0,1fr); gap:6px; padding:10px 0; border-top:1px solid var(--line); overflow-wrap:anywhere; } .meal span,small { color:var(--muted); } small { grid-column:2; white-space:pre-wrap; }`,
})
export class TodayMeals {
  protected readonly store = inject(MealsStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);
  private readonly day = computed(() => dayIn(this.family.family()?.timeZone ?? 'UTC', this.clock.now()));
  constructor() { effect(() => { const f = this.family.family(), day = this.day(); if (f) untracked(() => this.store.select(day, addDays(day, 1))); }); }
}
