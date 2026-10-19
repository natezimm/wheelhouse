import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { addDays } from './days';
import { refusalMessage } from './family';

export const MEAL_SLOTS = ['Breakfast', 'Lunch', 'Dinner'] as const;
export type MealKind = typeof MEAL_SLOTS[number];
export interface Meal { date: string; slot: MealKind; title: string | null; notes: string | null; version: string | null; }
export interface MealsSnapshot { from: string; to: string; changeNumber: number; meals: Meal[]; }
export interface MealCopy { source: Meal; target: Meal; }
export interface MealOperation {
  key: string; from: string; to: string; url: string; method: 'post' | 'put'; body: object; preview: Meal[]; uncertain: boolean;
}
export const mealKey = (m: Pick<Meal, 'date' | 'slot'>) => m.date + '/' + m.slot;

@Injectable({ providedIn: 'root' })
export class MealsStore {
  private readonly http = inject(HttpClient);
  private readonly confirmed = signal<Meal[]>([]);
  private readonly operations = signal<MealOperation[]>([]);
  private readonly loaded = signal(false);
  private readonly busy = signal(false);
  private readonly failed = signal(false);
  private readonly message = signal('');
  private from = ''; private to = ''; private epoch = 0; private sequence = 0;
  private revision = -1; private wanted = -1; private reading = false; private queued = false;
  readonly ready = this.loaded.asReadonly();
  readonly refreshing = this.busy.asReadonly();
  readonly refreshFailed = this.failed.asReadonly();
  readonly error = this.message.asReadonly();
  readonly pending = this.operations.asReadonly();
  readonly meals = computed(() => {
    const rows = new Map(this.confirmed().map(m => [mealKey(m), m]));
    for (const op of this.operations()) for (const meal of op.preview)
      if (rows.has(mealKey(meal))) rows.set(mealKey(meal), meal);
    return [...rows.values()];
  });

  select(from: string, to: string): void {
    if (this.from === from && this.to === to) return;
    this.from = from; this.to = to; this.sequence++; this.reading = false; this.queued = false;
    this.revision = -1; this.confirmed.set([]); this.loaded.set(false); this.refresh();
  }
  changed(number: number): void {
    if (!Number.isSafeInteger(number) || number < 0 || number <= this.wanted) return;
    this.wanted = number; if (number > this.revision) this.refresh();
  }
  refresh(): void {
    if (!this.from) return;
    if (this.reading) { this.queued = true; return; }
    const epoch = this.epoch, sequence = this.sequence, from = this.from, to = this.to;
    this.reading = true; this.busy.set(true); this.failed.set(false);
    this.http.get<MealsSnapshot>('/api/meals', { params:{ from, to } }).pipe(timeout(15_000)).subscribe({
      next: s => {
        if (epoch !== this.epoch || sequence !== this.sequence) return;
        if (this.valid(s, from, to) && s.changeNumber >= this.revision) {
          this.confirmed.set(s.meals); this.revision = s.changeNumber; this.loaded.set(true);
          if (this.wanted > this.revision) this.queued = true;
        } else this.failed.set(true);
      },
      error: () => { if (epoch === this.epoch && sequence === this.sequence) { this.failed.set(true); this.finishRead(); } },
      complete: () => { if (epoch === this.epoch && sequence === this.sequence) this.finishRead(); },
    });
  }
  async readRange(from: string, to: string): Promise<MealsSnapshot> {
    const epoch = this.epoch;
    const s = await firstValueFrom(this.http.get<MealsSnapshot>('/api/meals', { params:{ from, to } }).pipe(timeout(15_000)));
    if (epoch !== this.epoch || !this.valid(s, from, to)) throw new Error('Could not read meals.');
    return s;
  }
  isPending(meal: Pick<Meal, 'date' | 'slot'>): boolean {
    return this.operations().some(op => op.preview.some(m => mealKey(m) === mealKey(meal)));
  }
  save(meal: Meal, title: string | null, notes: string | null): Promise<boolean> {
    const key = crypto.randomUUID(); title = title?.trim() || null; notes = notes?.trim() || null;
    return this.begin({ key, from:meal.date, to:addDays(meal.date, 1), method:'put',
      url:'/api/meals/' + meal.date + '/' + meal.slot,
      body:{ commandId:key, version:meal.version, title, notes }, preview:[{ ...meal, title, notes }], uncertain:false });
  }
  copy(sourceFrom: string, targetFrom: string, choices: MealCopy[]): Promise<boolean> {
    const key = crypto.randomUUID();
    return this.begin({ key, from:targetFrom, to:addDays(targetFrom, 7), method:'post', url:'/api/meals/copy',
      body:{ commandId:key, sourceFrom, targetFrom, items:choices.map(c => ({ date:c.source.date, slot:c.source.slot,
        sourceVersion:c.source.version, targetVersion:c.target.version })) },
      preview:choices.map(c => ({ ...c.target, title:c.source.title, notes:c.source.notes })), uncertain:false });
  }
  async retry(key: string): Promise<boolean> {
    const op = this.operations().find(o => o.key === key && o.uncertain); if (!op) return false;
    const epoch = this.epoch; this.replace({ ...op, uncertain:false });
    try { await this.readRange(op.from, op.to); }
    catch {
      if (epoch === this.epoch) { this.replace({ ...op, uncertain:true }); this.message.set('Could not check save. Try again.'); }
      return false;
    }
    // The receipt, not a content guess, decides whether the exact command already committed.
    return this.send(op, epoch);
  }
  reset(): void {
    this.epoch++; this.sequence++; this.from = ''; this.to = ''; this.reading = false; this.queued = false;
    this.revision = -1; this.wanted = -1; this.confirmed.set([]); this.operations.set([]);
    this.loaded.set(false); this.busy.set(false); this.failed.set(false); this.message.set('');
  }
  private begin(op: MealOperation): Promise<boolean> {
    if (!op.preview.length || op.preview.some(m => this.isPending(m))) return Promise.resolve(false);
    this.message.set(''); this.operations.update(ops => [...ops, op]); return this.send(op, this.epoch);
  }
  private async send(op: MealOperation, epoch: number): Promise<boolean> {
    this.replace({ ...op, uncertain:false });
    try {
      const s = await firstValueFrom((op.method === 'put' ? this.http.put<MealsSnapshot>(op.url, op.body)
        : this.http.post<MealsSnapshot>(op.url, op.body)).pipe(timeout(20_000)));
      if (epoch !== this.epoch) return false;
      if (!this.valid(s, op.from, op.to)) throw new Error('Invalid meal response.');
      if (s.changeNumber >= this.revision) {
        const rows = new Map(s.meals.map(m => [mealKey(m), m]));
        this.confirmed.update(current => current.map(m => rows.get(mealKey(m)) ?? m));
      }
      this.operations.update(ops => ops.filter(o => o.key !== op.key)); this.message.set(''); this.afterWrite(); return true;
    } catch (e) {
      if (epoch !== this.epoch) return false;
      if (!(e instanceof HttpErrorResponse) || e.status === 0 || e.status >= 500 || e.status === 408) {
        this.replace({ ...op, uncertain:true }); this.message.set('Save not confirmed. Check save before trying again.');
      } else {
        this.operations.update(ops => ops.filter(o => o.key !== op.key));
        this.message.set(e.status === 409 ? 'Meals changed on another device. Review latest before saving again.'
          : refusalMessage(e, 'This meal was not saved. Your draft is still available.'));
        this.afterWrite();
      }
      return false;
    }
  }
  private afterWrite(): void { this.sequence++; this.reading = false; this.queued = false; this.refresh(); }
  private valid(s: MealsSnapshot, from: string, to: string): boolean {
    return !!s && s.from === from && s.to === to && Number.isSafeInteger(s.changeNumber) && s.changeNumber >= 0
      && Array.isArray(s.meals) && s.meals.length === ((Date.parse(to) - Date.parse(from)) / 86_400_000) * 3
      && new Set(s.meals.map(mealKey)).size === s.meals.length
      && s.meals.every(m => m.date >= from && m.date < to && MEAL_SLOTS.includes(m.slot));
  }
  private replace(op: MealOperation): void { this.operations.update(ops => ops.map(o => o.key === op.key ? op : o)); }
  private finishRead(): void { this.reading = false; this.busy.set(false); if (this.queued) { this.queued = false; this.refresh(); } }
}
