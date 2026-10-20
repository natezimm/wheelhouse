import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { refusalMessage } from './family';

export interface ListItem {
  sources?: GroceryOrigin[];
  quantityIsText?: boolean;
  quantity?: string | null; unit?: string | null; categoryId?: string | null;
  id: string; creationId: string; text: string; notes: string | null;
  checked: boolean; deleted: boolean; sortOrder: number; version: string;
}
export interface GroceryOrigin { batchId:string; date:string; slot:string; mealTitle:string; ingredientName:string; recipeId:string;
  recipeVersion:string; servings:number; quantity:number|null; quantityText:string|null; unit:string|null; }
export interface HouseholdList {
  isGrocery?: boolean; categories?: GroceryCategory[];
  id: string; creationId: string; name: string; archived: boolean; version: string; items: ListItem[];
}
export interface GroceryCategory { id: string; name: string; isOther: boolean; }
export interface GroceryFields { quantity?: string | null; unit?: string | null; categoryId?: string | null; }
export interface ListsSnapshot { changeNumber: number; lists: HouseholdList[]; }
export interface ListOperation {
  key: string; listId: string; kind: 'create' | 'rename' | 'archive' | 'add' | 'edit' | 'check' | 'move' | 'delete' | 'categories' | 'clear';
  method: 'post' | 'put'; url: string; body: object; preview: HouseholdList; itemId?: string; uncertain: boolean;
}

/** A complete domain snapshot makes switching lists independent of network ordering. */
@Injectable({ providedIn: 'root' })
export class ListsStore {
  private readonly http = inject(HttpClient);
  private readonly confirmed = signal<HouseholdList[]>([]);
  private readonly operations = signal<ListOperation[]>([]);
  private readonly loaded = signal(false);
  private readonly busy = signal(false);
  private readonly failed = signal(false);
  private readonly message = signal('');
  private active = false;
  private epoch = 0;
  private sequence = 0;
  private reading = false;
  private queued = false;
  private revision = -1;
  private wanted = -1;

  readonly ready = this.loaded.asReadonly();
  readonly refreshing = this.busy.asReadonly();
  readonly refreshFailed = this.failed.asReadonly();
  readonly error = this.message.asReadonly();
  readonly pending = this.operations.asReadonly();
  readonly lists = computed(() => {
    const rows = new Map(this.confirmed().map(l => [l.creationId, l]));
    for (const op of this.operations()) rows.set(op.preview.creationId, op.preview);
    return [...rows.values()].sort((a, b) => Number(!!b.isGrocery) - Number(!!a.isGrocery) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  });

  activate(): void { if (!this.active) { this.active = true; this.refresh(); } }
  isPending(id: string): boolean { return this.operations().some(o => o.listId === id || o.preview.id === id); }
  changed(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision <= this.wanted) return;
    this.wanted = revision;
    if (revision > this.revision) this.refresh();
  }
  refresh(): void {
    if (!this.active) return;
    if (this.reading) { this.queued = true; return; }
    const epoch = this.epoch, sequence = this.sequence;
    this.reading = true; this.busy.set(true); this.failed.set(false);
    this.http.get<ListsSnapshot>('/api/lists').pipe(timeout(15_000)).subscribe({
      next: s => {
        if (epoch !== this.epoch || sequence !== this.sequence) return;
        if (!this.acceptSnapshot(s)) this.failed.set(true);
        if (this.wanted > this.revision) this.queued = true;
      },
      error: () => { if (epoch === this.epoch) { this.failed.set(true); this.finishRead(); } },
      complete: () => { if (epoch === this.epoch) this.finishRead(); },
    });
  }

  create(name: string): Promise<boolean> {
    const key = crypto.randomUUID();
    return this.begin({ key, listId: key, kind: 'create', method: 'post', url: '/api/lists',
      body: { creationId: key, name }, preview: { id: key, creationId: key, name: name.trim(), archived: false, version: '', items: [] }, uncertain: false });
  }
  rename(list: HouseholdList, name: string): Promise<boolean> {
    return this.change(list, 'rename', '', { name, version: list.version }, { ...list, name: name.trim() });
  }
  archive(list: HouseholdList): Promise<boolean> {
    return this.change(list, 'archive', '/archive', { version: list.version }, { ...list, archived: true });
  }
  add(list: HouseholdList, text: string, notes: string | null = null, fields: GroceryFields = {}): Promise<boolean> {
    const key = crypto.randomUUID();
    const item: ListItem = { id: key, creationId: key, text: text.trim(), notes, version: '', checked: false, deleted: false,
      sortOrder: Math.max(-1, ...list.items.map(i => i.sortOrder)) + 1, ...fields };
    return this.begin({ key, listId: list.id, kind: 'add', method: 'post', url: `/api/lists/${list.id}/items`,
      body: { creationId: key, text, notes, ...fields }, preview: { ...list, items: [...list.items, item] }, itemId: key, uncertain: false });
  }
  edit(list: HouseholdList, item: ListItem, text: string, notes: string | null, fields: GroceryFields = {}): Promise<boolean> {
    return this.change(list, 'edit', `/items/${item.id}`, { version: item.version, text, notes, ...fields },
      this.withItem(list, { ...item, text: text.trim(), notes: notes?.trim() || null, ...fields }), item.id);
  }
  check(list: HouseholdList, item: ListItem, checked: boolean): Promise<boolean> {
    return this.change(list, 'check', `/items/${item.id}/checked`, { version: item.version, checked },
      this.withItem(list, { ...item, checked }), item.id);
  }
  remove(list: HouseholdList, item: ListItem): Promise<boolean> {
    return this.change(list, 'delete', `/items/${item.id}/delete`, { version: item.version },
      { ...list, items: list.items.filter(i => i.id !== item.id) }, item.id);
  }
  move(list: HouseholdList, item: ListItem, direction: number): Promise<boolean> {
    const rows = list.items.filter(i => i.checked === item.checked && (!list.isGrocery || i.categoryId === item.categoryId));
    const neighbour = rows[rows.findIndex(i => i.id === item.id) + direction];
    if (!neighbour) return Promise.resolve(false);
    const preview = this.withItem(this.withItem(list, { ...item, sortOrder: neighbour.sortOrder }), { ...neighbour, sortOrder: item.sortOrder });
    preview.items.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    return this.change(list, 'move', `/items/${item.id}/move`, { version: item.version, listVersion: list.version, direction }, preview, item.id);
  }

  categories(list: HouseholdList, categories: GroceryCategory[]): Promise<boolean> {
    const normalized = categories.map(c => ({ ...c, name: c.name.trim() }));
    const other = normalized.find(c => c.isOther)?.id;
    return this.change(list, 'categories', '/categories', { version: list.version, categories: normalized.map(({ id, name }) => ({ id, name })) },
      { ...list, categories: normalized, items: list.items.map(i => normalized.some(c => c.id === i.categoryId) ? i : { ...i, categoryId: other }) });
  }
  clear(list: HouseholdList, reviewed: ListItem[]): Promise<boolean> {
    const items = reviewed.map(({ id, version }) => ({ id, version }));
    return this.change(list, 'clear', '/clear-checked', { items }, { ...list, items: list.items.filter(i => !items.some(r => r.id === i.id)) });
  }

  /** Inspect accepted state first, then retry the exact immutable command if necessary. */
  async retry(key: string): Promise<boolean> {
    const op = this.operations().find(o => o.key === key && o.uncertain);
    if (!op) return false;
    const epoch = this.epoch;
    this.replace({ ...op, uncertain: false });
    try {
      const snapshot = await firstValueFrom(this.http.get<ListsSnapshot>('/api/lists').pipe(timeout(15_000)));
      if (epoch !== this.epoch) return false;
      if (!this.acceptSnapshot(snapshot)) throw new Error('Invalid snapshot');
      if (this.matches(op, snapshot)) { this.finish(op); return true; }
    } catch {
      if (epoch === this.epoch) { this.replace({ ...op, uncertain: true }); this.message.set('Could not check this save. Try Check save again.'); }
      return false;
    }
    return this.send(op, epoch);
  }

  reset(): void {
    this.epoch++; this.sequence = 0; this.active = false; this.reading = false; this.queued = false;
    this.revision = -1; this.wanted = -1; this.confirmed.set([]); this.operations.set([]);
    this.loaded.set(false); this.busy.set(false); this.failed.set(false); this.message.set('');
  }
  private change(list: HouseholdList, kind: ListOperation['kind'], suffix: string, body: object, preview: HouseholdList, itemId?: string): Promise<boolean> {
    return this.begin({ key: crypto.randomUUID(), listId: list.id, kind, method: 'put', url: `/api/lists/${list.id}${suffix}`, body, preview, itemId, uncertain: false });
  }
  private begin(op: ListOperation): Promise<boolean> {
    if (this.isPending(op.listId) || (op.kind !== 'create' && op.preview.archived && op.kind !== 'archive')) return Promise.resolve(false);
    this.message.set(''); this.operations.update(ops => [...ops, op]);
    return this.send(op, this.epoch);
  }
  private async send(op: ListOperation, epoch: number): Promise<boolean> {
    this.replace({ ...op, uncertain: false });
    try {
      const snapshot = await firstValueFrom((op.method === 'post' ? this.http.post<ListsSnapshot>(op.url, op.body)
        : this.http.put<ListsSnapshot>(op.url, op.body)).pipe(timeout(20_000)));
      if (epoch !== this.epoch) return false;
      if (!this.acceptSnapshot(snapshot)) throw new Error('Invalid snapshot');
      this.finish(op); return true;
    } catch (error) {
      if (epoch !== this.epoch) return false;
      if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500 || error.status === 408) {
        this.replace({ ...op, uncertain: true }); this.message.set('Save not confirmed. Check save before trying again.');
      } else {
        this.operations.update(ops => ops.filter(o => o.key !== op.key));
        this.message.set(error.status === 409 ? 'This list changed on another device. Review its latest contents before saving again.'
          : refusalMessage(error, 'This change was not saved. Your draft is still available.'));
        this.sequence++; this.refresh();
      }
      return false;
    }
  }
  private finish(op: ListOperation): void {
    this.sequence++; this.operations.update(ops => ops.filter(o => o.key !== op.key)); this.message.set(''); this.refresh();
  }
  private acceptSnapshot(snapshot: ListsSnapshot): boolean {
    if (!snapshot || !Array.isArray(snapshot.lists) || !Number.isSafeInteger(snapshot.changeNumber) || snapshot.changeNumber < 0) return false;
    if (snapshot.changeNumber < this.revision) return true;
    this.confirmed.set(snapshot.lists); this.revision = snapshot.changeNumber; this.loaded.set(true); return true;
  }
  private matches(op: ListOperation, s: ListsSnapshot): boolean {
    const list = s.lists.find(l => l.creationId === op.preview.creationId);
    if (!list) return false;
    if (op.kind === 'create') return true;
    if (op.kind === 'rename') return list.name === op.preview.name;
    if (op.kind === 'archive') return list.archived;
    if (op.kind === 'clear') return (op.body as { items: { id: string }[] }).items.every(i => !list.items.some(row => row.id === i.id));
    if (op.kind === 'categories') return JSON.stringify(list.categories?.map(({ id, name }) => ({ id, name }))) === JSON.stringify((op.body as { categories: object[] }).categories);
    const preview = op.preview.items.find(i => i.id === op.itemId);
    const item = list.items.find(i => op.kind === 'add' ? i.creationId === preview?.creationId : i.id === op.itemId);
    if (op.kind === 'delete') return !item;
    if (!item || !preview) return false;
    if (op.kind === 'add') return true;
    if (op.kind === 'check') return item.checked === preview.checked;
    if (op.kind === 'edit') return item.text === preview.text && item.notes === preview.notes &&
      (item.quantity ?? null) === (preview.quantity ?? null) && (item.unit ?? null) === (preview.unit ?? null) && (item.categoryId ?? null) === (preview.categoryId ?? null);
    return list.items.filter(i => i.checked === preview.checked && (!list.isGrocery || i.categoryId === preview.categoryId)).map(i => i.id).join(',') ===
      op.preview.items.filter(i => i.checked === preview.checked && (!list.isGrocery || i.categoryId === preview.categoryId)).map(i => i.id).join(',');
  }
  private withItem(list: HouseholdList, item: ListItem): HouseholdList { return { ...list, items: list.items.map(i => i.id === item.id ? item : i) }; }
  private replace(op: ListOperation): void { this.operations.update(ops => ops.map(o => o.key === op.key ? op : o)); }
  private finishRead(): void { this.reading = false; this.busy.set(false); if (this.queued) { this.queued = false; this.refresh(); } }
}
