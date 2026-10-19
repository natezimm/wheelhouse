import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { Day } from './days';
import { refusalMessage } from './family';
import { ChoreRepeat, repeatOn, sameRepeat } from './chore-repeat';

export interface Chore {
  id: string; creationId: string; title: string; notes: string | null; memberId: string | null;
  dueDate: Day; completedAt: string | null; archived: boolean; version: string;
  repeat?: ChoreRepeat | null; definitionVersion?: string | null; editDraft?: ChoreDraft | null;
  visible?: boolean; missed?: boolean; seriesArchived?: boolean; nextChangeDate?: Day | null;
  occurrenceId?: string | null; stopsOn?: Day | null;
}
export type ChoreDraft = Pick<Chore, 'title' | 'notes' | 'memberId' | 'dueDate' | 'repeat'>;
export interface ChoresSnapshot { changeNumber: number; chores: Chore[]; canManage: boolean; }
export interface ChoreOperation {
  key: string; id: string; kind: 'create' | 'edit' | 'complete' | 'archive';
  url: string; body: Record<string, unknown>; preview: Chore; uncertain: boolean;
}

/** Confirmed state plus independent pending intent. Reads never replace an open form draft. */
@Injectable({ providedIn: 'root' })
export class ChoresStore {
  private readonly http = inject(HttpClient);
  private readonly confirmed = signal<Chore[]>([]);
  private readonly operations = signal<ChoreOperation[]>([]);
  private readonly currentDay = signal<Day | null>(null);
  private readonly history = signal<{ from: Day; to: Day } | null>(null);
  private readonly loaded = signal(false);
  private readonly busy = signal(false);
  private readonly failed = signal(false);
  private readonly message = signal('');
  private readonly parent = signal(false);
  private readonly latestConflict = signal<Chore | null>(null);
  private familyEpoch = 0;
  private writeSequence = 0;
  private reading = false;
  private queued = false;
  private revision = -1;
  private wanted = -1;

  readonly ready = this.loaded.asReadonly();
  readonly refreshing = this.busy.asReadonly();
  readonly refreshFailed = this.failed.asReadonly();
  readonly error = this.message.asReadonly();
  readonly pending = this.operations.asReadonly();
  readonly canManage = this.parent.asReadonly();
  readonly conflict = this.latestConflict.asReadonly();
  readonly items = computed(() => {
    const map = new Map(this.confirmed().map(c => [this.identity(c), c]));
    for (const op of this.operations()) {
      // A live snapshot can already contain a create whose POST response is still in flight.
      for (const [id, chore] of map) if (chore.creationId === op.preview.creationId
        && (!chore.repeat || chore.dueDate === op.preview.dueDate)) map.delete(id);
      map.set(this.identity(op.preview), op.preview);
    }
    const day = this.currentDay();
    const history = this.history();
    return [...map.values()].filter(c => c.visible !== false && (history
      ? c.dueDate >= history.from && c.dueDate < history.to
      : !c.archived && day && (c.dueDate === day || (!c.repeat && c.dueDate < day && !c.completedAt))))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
  });

  select(day: Day): void {
    if (this.currentDay() === day && !this.history()) return;
    this.history.set(null);
    this.currentDay.set(day);
    this.loaded.set(false);
    this.refresh();
  }

  /** A bounded view of due-date occurrences, including archived one-time work. */
  selectHistory(from: Day, to: Day): void {
    const current = this.history();
    if (current?.from === from && current.to === to) return;
    this.history.set({ from, to });
    this.currentDay.set(null);
    this.loaded.set(false);
    this.refresh();
  }

  changed(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision <= this.wanted) return;
    this.wanted = revision;
    if (revision > this.revision) this.refresh();
  }

  refresh(): void {
    const day = this.currentDay();
    const history = this.history();
    if (!day && !history) return;
    if (this.reading) { this.queued = true; return; }
    const epoch = this.familyEpoch;
    const sequence = this.writeSequence;
    this.reading = true;
    this.busy.set(true);
    this.failed.set(false);
    const url = history ? '/api/chores/history' : '/api/chores';
    const params: Record<string, string> = history ? { from: history.from, to: history.to } : { date: day! };
    this.http.get<ChoresSnapshot>(url, { params }).pipe(timeout(15_000)).subscribe({
      next: snapshot => {
        if (epoch !== this.familyEpoch || this.currentDay() !== day || this.history() !== history || sequence !== this.writeSequence) return;
        if (!Array.isArray(snapshot.chores) || !Number.isSafeInteger(snapshot.changeNumber)) {
          this.failed.set(true); return;
        }
        if (snapshot.changeNumber < this.revision) return;
        this.confirmed.set(snapshot.chores);
        this.parent.set(snapshot.canManage === true);
        this.loaded.set(true);
        this.revision = snapshot.changeNumber;
        if (this.wanted > this.revision) this.queued = true;
      },
      error: () => { if (epoch === this.familyEpoch) { this.failed.set(true); this.finishRead(); } },
      complete: () => { if (epoch === this.familyEpoch) this.finishRead(); },
    });
  }

  isPending(id: string, day = this.currentDay()): boolean {
    return this.operations().some(o => (o.id === id || o.preview.id === id)
      && (o.kind !== 'complete' || !o.preview.repeat || o.preview.dueDate === day));
  }
  definitionPending(id: string): boolean { return this.operations().some(o => o.id === id || o.preview.id === id); }

  create(draft: ChoreDraft): Promise<boolean> {
    const key = crypto.randomUUID();
    const day = this.currentDay() ?? draft.dueDate;
    const preview: Chore = { ...draft, dueDate: draft.repeat ? day : draft.dueDate, id: key,
      creationId: key, version: '', completedAt: null, archived: false,
      visible: !draft.repeat || repeatOn(draft.repeat, draft.dueDate, day) };
    return this.begin({ key, id: key, kind: 'create', url: '/api/chores' + (draft.repeat ? `?date=${day}` : ''), body: { ...draft, creationId: key }, preview, uncertain: false });
  }

  edit(chore: Chore, draft: ChoreDraft): Promise<boolean> {
    return this.begin({ key: crypto.randomUUID(), id: chore.id, kind: 'edit', url: `/api/chores/${chore.id}` + this.dateQuery(chore),
      body: { ...draft, version: chore.definitionVersion ?? chore.version },
      preview: chore.repeat ? { ...chore, editDraft: draft } : { ...chore, ...draft }, uncertain: false });
  }

  complete(chore: Chore, completed: boolean): Promise<boolean> {
    return this.begin({ key: crypto.randomUUID(), id: chore.id, kind: 'complete', url: `/api/chores/${chore.id}/completion` + this.dateQuery(chore),
      body: { version: chore.version, completed }, preview: { ...chore, completedAt: completed ? new Date().toISOString() : null }, uncertain: false });
  }

  archive(chore: Chore): Promise<boolean> {
    return this.begin({ key: crypto.randomUUID(), id: chore.id, kind: 'archive', url: `/api/chores/${chore.id}/archive` + this.dateQuery(chore),
      body: { version: chore.definitionVersion ?? chore.version },
      preview: chore.repeat ? { ...chore, seriesArchived: true } : { ...chore, archived: true }, uncertain: false });
  }

  /** Read first; retry the frozen command with its original creation ID or expected version. */
  async retry(key: string): Promise<boolean> {
    const op = this.operations().find(o => o.key === key && o.uncertain);
    if (!op) return false;
    const epoch = this.familyEpoch;
    this.replace({ ...op, uncertain: false });
    try {
      const found = await firstValueFrom(this.http.get<Chore>(op.kind === 'create'
        ? `/api/chores/creation/${op.preview.creationId}` + this.dateQuery(op.preview)
        : `/api/chores/${op.id}` + this.dateQuery(op.preview)).pipe(timeout(15_000)));
      if (epoch !== this.familyEpoch) return false;
      if (this.matches(op, found)) { this.accept(op, found); return true; }
    } catch (error) {
      if (epoch !== this.familyEpoch) return false;
      if (!(error instanceof HttpErrorResponse && error.status === 404)) {
        this.replace({ ...op, uncertain: true });
        this.message.set('Could not check this save. Try Check save again.');
        return false;
      }
    }
    return this.send(op, epoch);
  }

  reset(): void {
    this.familyEpoch++;
    this.confirmed.set([]); this.operations.set([]); this.currentDay.set(null); this.history.set(null);
    this.loaded.set(false); this.busy.set(false); this.failed.set(false); this.message.set('');
    this.parent.set(false);
    this.latestConflict.set(null);
    this.reading = false; this.queued = false; this.revision = -1; this.wanted = -1; this.writeSequence = 0;
  }

  private begin(op: ChoreOperation): Promise<boolean> {
    if (this.isPending(op.id, op.preview.dueDate)
      || op.kind !== 'complete' && this.definitionPending(op.id)) return Promise.resolve(false);
    this.message.set('');
    this.latestConflict.set(null);
    this.operations.update(ops => [...ops, op]);
    return this.send(op, this.familyEpoch);
  }

  private async send(op: ChoreOperation, epoch: number): Promise<boolean> {
    this.replace({ ...op, uncertain: false });
    try {
      const response = await firstValueFrom((op.kind === 'create' ? this.http.post<Chore>(op.url, op.body)
        : this.http.put<Chore>(op.url, op.body)).pipe(timeout(20_000)));
      if (epoch !== this.familyEpoch) return false;
      this.accept(op, response);
      return true;
    } catch (error) {
      if (epoch !== this.familyEpoch) return false;
      if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500 || error.status === 408) {
        this.replace({ ...op, uncertain: true });
        this.message.set('The save could not be confirmed. Check save before trying again.');
      } else {
        if (error.status === 409 && typeof error.error?.id === 'string') this.latestConflict.set(error.error);
        this.operations.update(ops => ops.filter(o => o.key !== op.key));
        this.message.set(error.status === 409 ? 'This chore changed on another device. Review its latest state before saving again.'
          : refusalMessage(error, 'This change was not saved. Your draft is still available.'));
        this.refresh();
      }
      return false;
    }
  }

  private accept(op: ChoreOperation, chore: Chore): void {
    this.writeSequence++;
    this.confirmed.update(items => [...items.filter(c => this.identity(c) !== this.identity(op.preview)
      && !(c.creationId === chore.creationId && (!c.repeat || c.dueDate === chore.dueDate))), chore]);
    this.operations.update(ops => ops.filter(o => o.key !== op.key));
    this.message.set('');
    this.refresh();
  }

  private matches(op: ChoreOperation, c: Chore): boolean {
    if (op.kind === 'create') return c.creationId === op.preview.creationId;
    if (op.kind === 'archive') return c.archived || !!c.seriesArchived;
    if (c.archived) return false;
    if (op.kind === 'complete') return !!c.completedAt === !!op.body['completed'];
    const draft = c.editDraft ?? c;
    return draft.title === String(op.body['title']).trim() && (draft.notes ?? '') === String(op.body['notes'] ?? '').trim()
      && draft.memberId === op.body['memberId'] && draft.dueDate === op.body['dueDate']
      && sameRepeat(draft.repeat, op.body['repeat'] as ChoreRepeat | null | undefined);
  }

  private identity(chore: Chore): string { return chore.repeat ? `${chore.id}:${chore.dueDate}` : chore.id; }
  private dateQuery(chore: Chore): string { return chore.repeat ? `?date=${chore.dueDate}` : ''; }

  private replace(op: ChoreOperation): void { this.operations.update(ops => ops.map(o => o.key === op.key ? op : o)); }
  private finishRead(): void {
    this.reading = false; this.busy.set(false);
    if (this.queued) { this.queued = false; this.refresh(); }
  }
}
