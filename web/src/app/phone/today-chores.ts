import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChoresStore } from '../core/chores';
import { choreProgress } from '../core/chore-overview';
import { Clock } from '../core/clock';
import { dayIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';

/** Today's household work uses the same confirmed snapshot, pending commands and live recovery. */
@Component({
  selector: 'app-today-chores',
  imports: [RouterLink],
  template: `
    <section class="card" aria-labelledby="today-chores-title">
      <header><h2 id="today-chores-title">Chores</h2><a routerLink="/chores">All chores →</a></header>
      @if (store.ready()) {
        <p class="summary" role="status">{{ progress().done }} of {{ progress().total }} done · {{ progress().remaining }} remaining</p>
        @if (progress().overdue) { <p class="overdue">{{ progress().overdue }} overdue · one-time chores stay open until finished</p> }
        @for (chore of outstanding(); track chore.occurrenceId ?? chore.id) {
          <div class="chore" [class.pending]="store.isPending(chore.id, chore.dueDate)">
            <button type="button" [disabled]="store.isPending(chore.id, chore.dueDate)" [attr.aria-label]="'Complete ' + chore.title"
              (click)="store.complete(chore, true)">○</button>
            <div><h3>{{ chore.title }}</h3><small>{{ memberName(chore.memberId) }}</small></div>
          </div>
        } @empty { <p>{{ progress().total ? 'All done for today.' : 'No chores due today.' }}</p> }
        @if (progress().remaining > 3) { <a routerLink="/chores">{{ progress().remaining - 3 }} more chores</a> }
      } @else if (!store.refreshFailed()) { <p role="status">Loading chores…</p> }
      @if (store.refreshFailed()) { <p role="alert">Chores could not be refreshed. Your last saved view is still available.</p> }
      @if (store.error()) { <p role="alert">{{ store.error() }}</p> }
      @for (operation of store.pending(); track operation.key) {
        <div role="status" class="save-status">{{ operation.preview.title }}: {{ operation.uncertain ? 'save unconfirmed' : 'saving…' }}
          @if (operation.uncertain) { <button class="button" type="button" (click)="store.retry(operation.key)">Check save</button> }
        </div>
      }
      @if (live.state() === 'reconnecting') { <p role="status">Chores reconnecting…</p> }
      @if (store.refreshFailed()) { <button class="button" type="button" [disabled]="store.refreshing()" (click)="store.refresh()">Refresh chores</button> }
    </section>
  `,
  styles: `
    section { display: grid; gap: 10px; } header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    h2,h3,p { margin: 0; } h2 { font: 600 24px var(--font-display); } h3 { font-size: 16px; overflow-wrap: anywhere; }
    a { min-height: 44px; display: inline-flex; align-items: center; color: var(--accent); font-weight: 600; }
    .summary { font-weight: 600; } p,small { color: var(--muted); } .overdue { color: var(--warn); font-size: 14px; }
    .chore { display: flex; align-items: center; gap: 12px; } .chore div { min-width: 0; } .pending { opacity: .65; }
    .chore button { flex: 0 0 44px; min-height: 44px; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); color: var(--ok); font-size: 26px; cursor: pointer; }
    .save-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  `,
})
export class TodayChores {
  protected readonly store = inject(ChoresStore);
  protected readonly live = inject(HouseholdLive);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);
  private readonly today = computed(() => dayIn(this.family.family()?.timeZone ?? 'UTC', this.clock.now()));
  protected readonly progress = computed(() => choreProgress(this.store.items(), this.today()));
  protected readonly outstanding = computed(() => this.store.items().filter(c => !c.completedAt && !c.archived).slice(0, 3));

  constructor() {
    effect(() => { if (this.family.family()) this.store.select(this.today()); });
  }
  protected memberName(id: string | null): string { return this.family.members().find(m => m.id === id)?.displayName ?? 'Household'; }
}
