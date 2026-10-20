import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { refusalMessage } from './family';

export interface Ingredient { id: string; name: string; quantity: number | null; quantityText: string | null; unit: string | null; }
export interface RecipeContent { title: string; defaultServings: number; ingredients: Ingredient[]; steps: string[]; sourceUrl: string | null; notes: string | null; }
export interface RecipeSnapshot { id: string; version: string; content: RecipeContent; }
export interface Recipe extends RecipeSnapshot { archived: boolean; }
export interface RecipesSnapshot { changeNumber: number; recipes: Recipe[]; canManage: boolean; }
interface Operation { key: string; recipe: Recipe; body: object; uncertain: boolean; }
export function ingredientQuantity(line: Ingredient, servings: number, base: number): string {
  return line.quantity === null ? line.quantityText ?? '' : String(Math.round((line.quantity * servings / base + Number.EPSILON) * 10000) / 10000);
}

@Injectable({ providedIn:'root' })
export class RecipesStore {
  private readonly http = inject(HttpClient);
  private readonly confirmed = signal<Recipe[]>([]);
  private readonly operations = signal<Operation[]>([]);
  private readonly loaded = signal(false); private readonly busy = signal(false); private readonly failed = signal(false);
  private readonly message = signal(''); private readonly manage = signal(false);
  private active = false; private epoch = 0; private sequence = 0; private reading = false; private queued = false;
  private revision = -1; private wanted = -1;
  readonly ready = this.loaded.asReadonly(); readonly refreshing = this.busy.asReadonly();
  readonly refreshFailed = this.failed.asReadonly(); readonly error = this.message.asReadonly();
  readonly pending = this.operations.asReadonly(); readonly canManage = this.manage.asReadonly();
  readonly recipes = computed(() => {
    const rows = new Map(this.confirmed().map(r => [r.id,r]));
    for (const op of this.operations()) rows.set(op.recipe.id,op.recipe);
    return [...rows.values()].sort((a,b) => a.content.title.localeCompare(b.content.title));
  });
  activate(): void { if (!this.active) { this.active = true; this.refresh(); } }
  changed(number: number): void {
    if (!Number.isSafeInteger(number) || number < 0 || number <= this.wanted) return;
    this.wanted = number; if (number > this.revision) this.refresh();
  }
  refresh(): void {
    if (!this.active) return;
    if (this.reading) { this.queued = true; return; }
    const epoch = this.epoch, sequence = this.sequence;
    this.reading = true; this.busy.set(true); this.failed.set(false);
    this.http.get<RecipesSnapshot>('/api/recipes').pipe(timeout(15000)).subscribe({
      next:s => {
        if (epoch !== this.epoch || sequence !== this.sequence) return;
        if (this.valid(s) && s.changeNumber >= this.revision) {
          this.confirmed.set(s.recipes); this.manage.set(s.canManage); this.loaded.set(true); this.revision = s.changeNumber;
          if (this.wanted > this.revision) this.queued = true;
        } else this.failed.set(true);
      },
      error:() => { if (epoch === this.epoch && sequence === this.sequence) { this.failed.set(true); this.finish(); } },
      complete:() => { if (epoch === this.epoch && sequence === this.sequence) this.finish(); },
    });
  }
  isPending(id: string): boolean { return this.operations().some(o => o.recipe.id === id); }
  save(id: string, version: string | null, archived: boolean, content: RecipeContent): Promise<boolean> {
    if (this.isPending(id)) return Promise.resolve(false);
    const key = crypto.randomUUID(), frozen = structuredClone(content);
    const op: Operation = { key, recipe:{id,version:version ?? '',archived,content:frozen},
      body:{commandId:key,version,archived,content:frozen},uncertain:false };
    this.message.set(''); this.operations.update(ops => [...ops,op]); return this.send(op,this.epoch);
  }
  async retry(key: string): Promise<boolean> {
    const op = this.operations().find(o => o.key === key && o.uncertain); if (!op) return false;
    const epoch = this.epoch; this.replace({...op,uncertain:false});
    try {
      const result = await firstValueFrom(this.http.get<RecipesSnapshot>('/api/recipes').pipe(timeout(15000)));
      if (epoch !== this.epoch) return false;
      if (!this.valid(result)) throw new Error('Invalid recipes');
    } catch { if (epoch === this.epoch) { this.replace({...op,uncertain:true}); this.message.set('Could not check save. Try again.'); } return false; }
    return this.send(op,epoch);
  }
  dismissError(): void { this.message.set(''); }
  reset(): void {
    this.epoch++; this.sequence++; this.active = false; this.reading = false; this.queued = false;
    this.revision = -1; this.wanted = -1; this.confirmed.set([]); this.operations.set([]);
    this.loaded.set(false); this.busy.set(false); this.failed.set(false); this.manage.set(false); this.message.set('');
  }
  private async send(op: Operation, epoch: number): Promise<boolean> {
    this.replace({...op,uncertain:false});
    try {
      const s = await firstValueFrom(this.http.put<RecipesSnapshot>('/api/recipes/'+op.recipe.id,op.body).pipe(timeout(20000)));
      if (epoch !== this.epoch) return false;
      if (!this.valid(s)) throw new Error('Invalid recipe response');
      if (s.changeNumber >= this.revision) {
        this.confirmed.set(s.recipes); this.manage.set(s.canManage); this.revision = s.changeNumber; this.loaded.set(true);
      }
      this.operations.update(ops => ops.filter(o => o.key !== op.key)); this.message.set(''); this.afterWrite(); return true;
    } catch(e) {
      if (epoch !== this.epoch) return false;
      if (!(e instanceof HttpErrorResponse) || e.status === 0 || e.status >= 500 || e.status === 408) {
        this.replace({...op,uncertain:true}); this.message.set('Save not confirmed. Check save before trying again.');
      } else {
        this.operations.update(ops => ops.filter(o => o.key !== op.key));
        this.message.set(e.status === 409 ? 'Recipe changed on another device. Review latest before saving again.'
          : refusalMessage(e,'Recipe not saved. Your draft is still available.')); this.afterWrite();
      }
      return false;
    }
  }
  private valid(s: RecipesSnapshot): boolean { return !!s && Number.isSafeInteger(s.changeNumber) && s.changeNumber >= 0 && Array.isArray(s.recipes) && typeof s.canManage === 'boolean'; }
  private replace(op: Operation): void { this.operations.update(ops => ops.map(o => o.key === op.key ? op : o)); }
  private afterWrite(): void { this.sequence++; this.reading = false; this.queued = false; this.refresh(); }
  private finish(): void { this.reading = false; this.busy.set(false); if (this.queued) { this.queued = false; this.refresh(); } }
}
