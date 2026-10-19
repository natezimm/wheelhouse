import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';
import { GroceryCategory, GroceryFields, HouseholdList, ListItem, ListsStore } from '../core/lists';
import { PhoneNav } from '../phone/phone-nav';
import { SignIn } from '../phone/sign-in';
import { DemoNotice } from './demo-notice';

type Editor = { kind: 'new' | 'rename' | 'item' | 'archive' | 'delete' | 'categories' | 'clear'; list?: HouseholdList; item?: ListItem; reviewed?: ListItem[] };

@Component({
  selector: 'app-lists-page',
  imports: [FormsModule, NgTemplateOutlet, RouterLink, PhoneNav, SignIn, DemoNotice],
  host: { '[class.wall]': 'wall' },
  template: `
    <header class="page-header">
      <div><a [routerLink]="wall ? '/wall' : '/'">← {{ wall ? 'Calendar' : 'Today' }}</a><h1>Lists</h1><p>Less to remember. More done together.</p></div>
      @if (family.family()) { <button class="button primary" (click)="open({ kind: 'new' })">New list</button> }
    </header>
    @if (family.state().status === 'private') {
      @if (wall) { <p>Pair this display to use your household lists.</p><a routerLink="/wall">Pair display</a> }
      @else { <app-sign-in /> }
    } @else if (family.family()) {
      <div class="connection" role="status" aria-live="polite">
        <span class="dot" [class.online]="live.state() === 'connected' || live.state() === 'resyncing'"></span>
        <span>{{ live.state() === 'reconnecting' ? 'Reconnecting' : live.state() === 'connected' || live.state() === 'resyncing' ? 'Live updates' : 'Connecting' }}</span>
        <button class="button" [disabled]="store.refreshing()" (click)="live.resync()">{{ store.refreshing() ? 'Resyncing…' : 'Resync now' }}</button>
      </div>
      @if (store.refreshFailed()) { <p class="error" role="alert">Could not refresh lists. Your last saved contents are still available. Use Resync now to retry.</p> }
      @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p> }
      @for (op of store.pending(); track op.key) {
        <div class="save-status" role="status"><span>{{ op.uncertain ? 'Save not confirmed' : 'Saving…' }} · {{ op.preview.name }}</span>
          @if (op.uncertain) { <button class="button" (click)="checkSave(op.key)">Check save</button> }
        </div>
      }
      @if (!store.ready() && !store.refreshFailed()) { <p role="status">Loading lists…</p> }
      @if (store.ready()) {
        <div class="workspace">
          <aside class="card list-picker" aria-label="Household lists">
            <div class="picker-heading"><h2>{{ archived() ? 'Archived lists' : 'Your lists' }}</h2><button class="button" (click)="archived.set(!archived())">{{ archived() ? 'Active lists' : 'Archived lists' }}</button></div>
            @for (list of visibleLists(); track list.creationId) {
              <button class="list-choice" [attr.aria-pressed]="selected()?.creationId === list.creationId" (click)="choice.set(list.creationId)">
                <span>{{ list.name }}@if (list.isGrocery) { <small> · Protected</small> }</span><small>{{ remaining(list) }} remaining</small>
              </button>
            } @empty { <p>{{ archived() ? 'No archived lists.' : 'No lists yet. Make one for errands, packing, or anything you share.' }}</p> }
          </aside>
          @if (selected(); as list) {
            <section class="card contents" [attr.aria-label]="list.name">
              <div class="list-heading"><div><span class="eyebrow">{{ list.archived ? 'Saved for later' : 'Shared with your household' }}</span><h2>{{ list.name }}</h2><p>{{ remaining(list) }} remaining · {{ list.items.length - remaining(list) }} checked</p></div>
                @if (!list.archived) { <div class="list-actions">
                  @if (list.isGrocery) { <button class="button" [disabled]="store.isPending(list.id)" (click)="open({ kind: 'categories', list })">Manage categories</button> }
                  @else { <button class="button" [disabled]="store.isPending(list.id)" (click)="open({ kind: 'rename', list })">Rename</button><button class="button" [disabled]="store.isPending(list.id)" (click)="open({ kind: 'archive', list })">Archive list</button> }
                </div> }
              </div>
              @if (list.archived) { <p>Archived lists keep their items for reference.</p> }
              @else {
                <form class="quick-add" (ngSubmit)="add(list)"><label class="field">Add an item<input name="quickItem" maxlength="200" placeholder="What needs doing?" [ngModel]="quickText(list)" (ngModelChange)="setQuick(list, $event)" [disabled]="store.isPending(list.id)" /></label>
                  <button class="button primary" [disabled]="store.isPending(list.id) || !quickText(list).trim()">Add item</button>
                  @if (list.isGrocery) {
                    <details class="quick-options"><summary>Quantity, unit & category (optional)</summary><div class="grocery-fields">
                      <label class="field">Quantity<input name="quickQuantity" maxlength="50" [ngModel]="quickGrocery(list).quantity" (ngModelChange)="setQuickField(list, 'quantity', $event)" [disabled]="store.isPending(list.id)" /></label>
                      <label class="field">Unit<input name="quickUnit" maxlength="50" [ngModel]="quickGrocery(list).unit" (ngModelChange)="setQuickField(list, 'unit', $event)" [disabled]="store.isPending(list.id)" /></label>
                      <label class="field category">Category<select name="quickCategory" [ngModel]="quickGrocery(list).categoryId" (ngModelChange)="setQuickField(list, 'categoryId', $event)" [disabled]="store.isPending(list.id)">@for (category of list.categories; track category.id) { <option [value]="category.id">{{ category.name }}</option> }</select></label>
                    </div></details>
                  }
                </form>
              }
              <div class="items">
                @if (list.isGrocery) {
                  @for (category of list.categories; track category.id) {
                    @if (categoryItems(list, category.id).length) { <section class="grocery-group" [attr.aria-label]="category.name"><h3>{{ category.name }}</h3>
                      @for (item of categoryItems(list, category.id); track item.id) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ list, item }" /> }
                    </section> }
                  }
                } @else {
                  @for (item of sectionItems(list, false); track item.id) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ list, item }" /> }
                }
                @if (!remaining(list)) { <p class="empty">{{ list.items.length ? 'All caught up. Checked items are below.' : 'Start with one thing. Add an item above.' }}</p> }
              </div>
              @if (list.isGrocery && sectionItems(list, true).length) { <button class="button" [disabled]="store.isPending(list.id)" (click)="open({ kind: 'clear', list, reviewed: sectionItems(list, true).slice(0, 500) })">Clear checked ({{ sectionItems(list, true).length > 500 ? 500 : sectionItems(list, true).length }})</button> }
              @if (list.isGrocery && sectionItems(list, true).length > 500) { <p>Clear up to 500 reviewed items at a time. The rest stay on the list.</p> }
              <details class="checked"><summary>Checked ({{ list.items.length - remaining(list) }})</summary>
                @for (item of sectionItems(list, true); track item.id) { <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ list, item }" /> }
                @empty { <p>No checked items yet.</p> }
              </details>
            </section>
          }
        </div>
      }
    } @else { <p role="status">Loading your household…</p> }

    <ng-template #row let-list="list" let-item="item">
      <article class="item" [class.pending]="store.isPending(list.id)">
        <button class="check" [disabled]="list.archived || store.isPending(list.id)" [attr.aria-pressed]="item.checked" [attr.aria-label]="(item.checked ? 'Reopen ' : 'Check ') + item.text" (click)="store.check(list, item, !item.checked)">{{ item.checked ? '✓' : '○' }}</button>
        <div class="item-text"><h3 [class.done]="item.checked">{{ item.text }}</h3>@if (item.quantity || item.unit) { <p>{{ item.quantity }} {{ item.unit }}</p> }@if (item.notes) { <p>{{ item.notes }}</p> }</div>
        @if (!list.archived) {
          <div class="item-actions"><button class="button" [disabled]="store.isPending(list.id) || !canMove(list, item, -1)" [attr.aria-label]="'Move up ' + item.text" (click)="store.move(list, item, -1)">↑</button>
            <button class="button" [disabled]="store.isPending(list.id) || !canMove(list, item, 1)" [attr.aria-label]="'Move down ' + item.text" (click)="store.move(list, item, 1)">↓</button>
            <button class="button" [disabled]="store.isPending(list.id)" [attr.aria-label]="'Edit ' + item.text" (click)="open({ kind: 'item', list, item })">Edit</button>
            <button class="button delete" [disabled]="store.isPending(list.id)" [attr.aria-label]="'Delete ' + item.text" (click)="open({ kind: 'delete', list, item })">Delete</button></div>
        }
      </article>
    </ng-template>

    @if (editor(); as edit) {
      <dialog #dialog (cancel)="close()" (close)="close()"><form (ngSubmit)="save()">
        <h2>{{ editorTitle() }}</h2>
        @if (edit.kind === 'archive') { <p>Archive “{{ edit.list?.name }}”? Its items stay available under Archived lists.</p> }
        @else if (edit.kind === 'delete') { <p>Delete “{{ edit.item?.text }}” from this list?</p> }
        @else if (edit.kind === 'clear') {
          <p>Clear these {{ edit.reviewed?.length }} checked items? Items checked later stay on the list. Reopened or edited items stop this clear so you can review again.</p>
          <ul>@for (item of edit.reviewed; track item.id) { <li>{{ item.text }} {{ item.quantity }} {{ item.unit }}</li> }</ul>
        }
        @else if (edit.kind === 'categories') {
          <p>Removing a category moves its items to Other. Other always stays last.</p>
          @for (category of categoryDraft(); track category.id; let index = $index) {
            <div class="category-editor"><label class="field">Category {{ index + 1 }}<input [name]="'category-' + category.id" maxlength="40" [ngModel]="category.name" (ngModelChange)="renameCategory(category.id, $event)" [disabled]="editorLocked() || category.isOther" /></label>
              @if (!category.isOther) {
                <button class="button" type="button" [attr.aria-label]="'Move up category ' + category.name" [disabled]="editorLocked() || index === 0" (click)="moveCategory(index, -1)">↑</button>
                <button class="button" type="button" [attr.aria-label]="'Move down category ' + category.name" [disabled]="editorLocked() || index >= categoryDraft().length - 2" (click)="moveCategory(index, 1)">↓</button>
                <button class="button" type="button" [attr.aria-label]="'Remove category ' + category.name" [disabled]="editorLocked()" (click)="removeCategory(category.id)">Remove</button>
              }
            </div>
          }
          <button class="button" type="button" [disabled]="editorLocked() || categoryDraft().length >= 16" (click)="addCategory()">Add category</button>
          @if (!validEditor()) { <p class="error">Use unique category names, 1–40 characters each.</p> }
        }
        @else {
          <label class="field">{{ edit.kind === 'item' ? 'Item text' : 'List name' }}<input name="title" [ngModel]="text()" (ngModelChange)="text.set($event)" [maxlength]="edit.kind === 'item' ? 200 : 100" required [disabled]="editorLocked()" /></label>
          @if (edit.kind === 'item') { <label class="field">Notes<textarea name="notes" [ngModel]="notes()" (ngModelChange)="notes.set($event)" maxlength="2000" [disabled]="editorLocked()"></textarea></label> }
          @if (edit.kind === 'item' && edit.list?.isGrocery) {
            <div class="grocery-fields">
              <label class="field">Quantity<input name="quantity" maxlength="50" [ngModel]="quantity()" (ngModelChange)="quantity.set($event)" [disabled]="editorLocked()" /></label>
              <label class="field">Unit<input name="unit" maxlength="50" [ngModel]="unit()" (ngModelChange)="unit.set($event)" [disabled]="editorLocked()" /></label>
              <label class="field category">Category<select name="category" [ngModel]="categoryId()" (ngModelChange)="categoryId.set($event)" [disabled]="editorLocked()">@for (category of edit.list?.categories; track category.id) { <option [value]="category.id">{{ category.name }}</option> }</select></label>
            </div>
          }
        }
        @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p> }
        @if (conflicted()) {
          <p>Review the latest list before applying this draft.</p>
          @if (currentItem(); as item) { <p>Latest item: {{ item.text }}@if (item.quantity || item.unit) { · {{ item.quantity }} {{ item.unit }} }@if (item.notes) { · {{ item.notes }} }</p> }
          @else if (currentList(); as list) { <p>Latest list: {{ list.name }}{{ list.archived ? ' (archived)' : '' }}</p> }
          @if (store.refreshFailed()) { <p class="error">The latest contents could not be loaded. Close this editor and use Resync now to retry.</p> }
          <button class="button" type="button" [disabled]="store.refreshing() || store.refreshFailed()" (click)="review()">Review latest</button>
        }
        <div class="dialog-actions"><button class="button" type="button" (click)="close()">{{ editorLocked() ? 'Close' : 'Cancel' }}</button>
          <button class="button primary" [disabled]="editorLocked() || conflicted() || !validEditor()">{{ saving() ? 'Saving…' : edit.kind === 'clear' ? 'Clear checked items' : edit.kind === 'archive' ? 'Archive list' : edit.kind === 'delete' ? 'Delete item' : 'Save' }}</button></div>
      </form></dialog>
    }
    <footer><app-demo-notice />@if (wall) { <a class="button" routerLink="/wall/chores">Chores</a> }</footer>
    @if (!wall) { <app-phone-nav /> }
  `,
  styles: `
    .quick-options { width:100%; } .grocery-fields { display:grid; grid-template-columns:1fr 1fr; gap:12px; } .category { grid-column:1 / -1; } .grocery-group { margin:24px 0; } .category-editor { display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; } .category-editor .field { flex:1; min-width:180px; } textarea { min-height:96px; }
    :host { display:flex; flex-direction:column; gap:18px; max-width:1200px; margin:auto; padding:24px 18px 12px; min-height:100vh; box-sizing:border-box; }
    h1 { font:600 40px var(--font-display); margin:10px 0 4px; } h2 { font:600 28px var(--font-display); margin:0; } h3 { font:600 18px var(--font-body); margin:0; overflow-wrap:anywhere; }
    p { margin:6px 0; } small, .eyebrow, header p, .list-heading p, .item-text p, .empty { color:var(--muted); }
    .eyebrow { text-transform:uppercase; letter-spacing:.08em; font-size:12px; } .page-header,.list-heading,.picker-heading { display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .page-header { align-items:flex-end; } a { color:var(--ink); } header a, footer a { display:inline-flex; align-items:center; min-height:44px; } .connection { display:flex; align-items:center; gap:8px; flex-wrap:wrap; } .connection .button { margin-left:auto; }
    .dot { width:9px; height:9px; border-radius:50%; background:var(--warn); } .dot.online { background:var(--ok); } .workspace { display:grid; grid-template-columns:280px minmax(0,1fr); gap:20px; align-items:start; }
    .card { padding:20px; min-width:0; } .list-picker { display:flex; flex-direction:column; gap:10px; } .picker-heading { flex-wrap:wrap; margin-bottom:8px; } .picker-heading h2 { font-size:23px; }
    .list-choice { display:flex; flex-direction:column; align-items:flex-start; text-align:left; gap:5px; border:1px solid var(--line); border-radius:12px; padding:14px; min-height:64px; background:var(--surface); color:var(--ink); font:600 17px var(--font-body); overflow-wrap:anywhere; }
    .list-choice[aria-pressed=true] { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,var(--surface)); } .list-choice small { font-size:13px; font-weight:400; }
    .contents h2 { overflow-wrap:anywhere; } .list-actions { display:flex; gap:8px; flex-wrap:wrap; } .list-heading { align-items:flex-start; flex-wrap:wrap; }
    .quick-add { display:flex; flex-wrap:wrap; align-items:flex-end; gap:10px; margin:24px 0 10px; } .quick-add .field { flex:1; min-width:0; } input { min-width:0; }
    .item { display:flex; gap:12px; align-items:center; padding:16px 0; border-bottom:1px solid var(--line); flex-wrap:wrap; } .item-text { flex:1; min-width:100px; } .item-text p { white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; }
    .check { width:44px; min-height:44px; flex-shrink:0; border:1px solid var(--line); border-radius:50%; background:var(--surface); font-size:24px; color:var(--accent); } .done { text-decoration:line-through; color:var(--muted); }
    .item-actions { display:flex; gap:6px; flex-wrap:wrap; } .item-actions .button { padding:0 12px; min-width:44px; } .delete { color:var(--danger); } .pending { opacity:.65; }
    .checked { margin-top:20px; } summary { min-height:44px; display:list-item; align-content:center; cursor:pointer; font-weight:600; } .error { color:var(--danger); } .save-status { display:flex; gap:12px; align-items:center; }
    footer { margin-top:auto; display:flex; align-items:center; gap:16px; } dialog { border:1px solid var(--line); border-radius:20px; padding:24px; width:min(480px,calc(100vw - 48px)); box-sizing:border-box; background:var(--surface); color:var(--ink); }
    dialog::backdrop { background:#0005; } dialog form { display:flex; flex-direction:column; gap:18px; } .dialog-actions { display:flex; justify-content:flex-end; gap:10px; }
    :host.wall { max-width:none; padding:28px 36px; font-size:20px; } :host.wall h1 { font-size:48px; } :host.wall h3 { font-size:23px; } :host.wall h2 { font-size:32px; }
    :host.wall .button,:host.wall input,:host.wall select,:host.wall textarea,:host.wall .check,:host.wall summary,:host.wall a { min-height:56px; font-size:20px; } :host.wall .check { width:56px; } :host.wall .workspace { grid-template-columns:340px minmax(0,1fr); } :host.wall dialog { width:600px; }
    :host.wall .item-actions .button { min-width:56px; }
    @media(max-width:700px) { .workspace { grid-template-columns:1fr; } .item-actions { width:100%; padding-left:56px; } .card { padding:16px; } .page-header .button { flex-shrink:0; } }
  `,
})
export class ListsPage {
  protected readonly family = inject(FamilyStore);
  protected readonly store = inject(ListsStore);
  protected readonly live = inject(HouseholdLive);
  protected readonly wall = inject(ActivatedRoute).snapshot.data['wall'] === true;
  protected readonly choice = signal<string | null>(null);
  protected readonly archived = signal(false);
  protected readonly visibleLists = computed(() => this.store.lists().filter(l => l.archived === this.archived()));
  protected readonly selected = computed(() => this.visibleLists().find(l => l.creationId === this.choice()) ?? this.visibleLists()[0]);
  protected readonly editor = signal<Editor | null>(null);
  protected readonly text = signal('');
  protected readonly notes = signal('');
  protected readonly quantity = signal('');
  protected readonly unit = signal('');
  protected readonly categoryId = signal('');
  protected readonly categoryDraft = signal<GroceryCategory[]>([]);
  private readonly quickFields = signal<Record<string, GroceryFields>>({});
  protected readonly saving = signal(false);
  protected readonly conflicted = signal(false);
  private readonly quick = signal<Record<string,string>>({});
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private editorEpoch = 0;
  private editorOperation: string | null = null;
  protected readonly editorLocked = computed(() => this.saving() || !!this.editorOperation && this.store.pending().some(o => o.key === this.editorOperation));
  protected readonly editorTitle = computed(() => ({ new:'New list', rename:'Rename list', item:'Edit item', archive:'Archive list', delete:'Delete item', categories:'Manage categories', clear:'Clear checked items' })[this.editor()!.kind]);
  protected readonly currentList = computed(() => this.store.lists().find(l => l.id === this.editor()?.list?.id));
  protected readonly currentItem = computed(() => this.currentList()?.items.find(i => i.id === this.editor()?.item?.id));

  constructor() {
    this.family.load();
    let identity: string | null = null;
    effect(() => {
      const family = this.family.family();
      if (this.family.state().status === 'private' || family && identity && family.id !== identity) {
        this.choice.set(null); this.archived.set(false); this.quick.set({}); this.quickFields.set({}); this.close();
      }
      if (family) { identity = family.id; this.store.activate(); }
    });
    effect(() => { const dialog = this.dialog()?.nativeElement; if (dialog && !dialog.open) dialog.showModal(); });
  }
  protected remaining(list: HouseholdList): number { return list.items.filter(i => !i.checked).length; }
  protected sectionItems(list: HouseholdList, checked: boolean): ListItem[] { return list.items.filter(i => i.checked === checked); }
  protected canMove(list: HouseholdList, item: ListItem, direction: number): boolean {
    const rows = this.sectionItems(list, item.checked).filter(i => !list.isGrocery || i.categoryId === item.categoryId); const index = rows.findIndex(i => i.id === item.id) + direction;
    return index >= 0 && index < rows.length;
  }
  protected quickText(list: HouseholdList): string { return this.quick()[list.creationId] ?? ''; }
  protected setQuick(list: HouseholdList, text: string): void { this.quick.update(d => ({ ...d, [list.creationId]:text })); }
  protected categoryItems(list: HouseholdList, id: string): ListItem[] { return this.sectionItems(list, false).filter(i => i.categoryId === id); }
  protected quickGrocery(list: HouseholdList): GroceryFields {
    const fields = this.quickFields()[list.creationId] ?? {};
    return { ...fields, categoryId: list.categories?.some(c => c.id === fields.categoryId) ? fields.categoryId : list.categories?.find(c => c.isOther)?.id };
  }
  protected setQuickField(list: HouseholdList, field: keyof GroceryFields, value: string): void {
    this.quickFields.update(rows => ({ ...rows, [list.creationId]: { ...this.quickGrocery(list), [field]: value } }));
  }
  protected renameCategory(id: string, name: string): void { this.categoryDraft.update(rows => rows.map(c => c.id === id ? { ...c, name } : c)); }
  protected removeCategory(id: string): void { this.categoryDraft.update(rows => rows.filter(c => c.id !== id)); }
  protected addCategory(): void { this.categoryDraft.update(rows => [...rows.slice(0, -1), { id: crypto.randomUUID(), name: '', isOther: false }, ...rows.slice(-1)]); }
  protected moveCategory(index: number, direction: number): void {
    this.categoryDraft.update(rows => { const copy = [...rows]; [copy[index], copy[index + direction]] = [copy[index + direction], copy[index]]; return copy; });
  }
  protected validEditor(): boolean {
    const edit = this.editor(); if (!edit) return false;
    if (edit.kind === 'clear') return !!edit.reviewed?.length;
    if (edit.kind === 'categories') {
      const names = this.categoryDraft().map(c => c.name.trim().toLowerCase());
      return names.every(n => n.length > 0 && n.length <= 40) && new Set(names).size === names.length;
    }
    if (edit.kind === 'archive' || edit.kind === 'delete') return true;
    return !!this.text().trim() && (!edit.list?.isGrocery || edit.kind !== 'item' || !!edit.list.categories?.some(c => c.id === this.categoryId()));
  }
  protected async add(list: HouseholdList): Promise<void> {
    const text = this.quickText(list), familyId = this.family.family()?.id;
    if (await this.store.add(list, text, null, list.isGrocery ? this.quickGrocery(list) : {}) && familyId === this.family.family()?.id && this.quickText(list) === text) { this.setQuick(list, ''); this.quickFields.update(rows => ({ ...rows, [list.creationId]: {} })); }
  }
  protected open(editor: Editor): void {
    this.editorEpoch++; this.editorOperation = null; this.editor.set(editor); this.conflicted.set(false);
    this.text.set(editor.item?.text ?? editor.list?.name ?? ''); this.notes.set(editor.item?.notes ?? '');
    this.quantity.set(editor.item?.quantity ?? ''); this.unit.set(editor.item?.unit ?? '');
    this.categoryId.set(editor.item?.categoryId ?? editor.list?.categories?.find(c => c.isOther)?.id ?? '');
    this.categoryDraft.set(editor.list?.categories?.map(c => ({ ...c })) ?? []);
  }
  protected close(): void { this.editorEpoch++; this.editorOperation = null; this.editor.set(null); this.saving.set(false); this.conflicted.set(false); }
  protected review(): void {
    const edit = this.editor(); if (!edit?.list) return;
    const list = this.store.lists().find(l => l.id === edit.list!.id);
    const item = edit.item && list?.items.find(i => i.id === edit.item!.id);
    if (!list || list.archived || edit.item && !item) { this.close(); return; }
    this.editor.set({ ...edit, list, item }); this.conflicted.set(false);
    if (edit.kind === 'clear') this.editor.set({ ...edit, list, reviewed: this.sectionItems(list, true).slice(0, 500) });
    if (edit.kind === 'categories') this.categoryDraft.set(list.categories?.map(c => ({ ...c })) ?? []);
  }
  protected async checkSave(key: string): Promise<void> {
    const epoch = this.editorEpoch;
    const familyId = this.family.family()?.id;
    const op = this.store.pending().find(o => o.key === key);
    if (await this.store.retry(key) && familyId === this.family.family()?.id) {
      if (op?.kind === 'add') {
        const list = op.preview;
        if (this.quickText(list) === (op.body as { text: string }).text) { this.setQuick(list, ''); this.quickFields.update(rows => ({ ...rows, [list.creationId]: {} })); }
      }
      if (epoch === this.editorEpoch && this.editorOperation === key) {
        if (op?.kind === 'create') { this.archived.set(false); this.choice.set(op.preview.creationId); }
        this.close();
      }
    }
  }
  protected async save(): Promise<void> {
    const edit = this.editor(); if (!edit || this.editorLocked() || this.conflicted() || !this.validEditor()) return;
    const epoch = this.editorEpoch; this.saving.set(true);
    let task: Promise<boolean>;
    if (edit.kind === 'new') task = this.store.create(this.text());
    else if (edit.kind === 'rename') task = this.store.rename(edit.list!, this.text());
    else if (edit.kind === 'archive') task = this.store.archive(edit.list!);
    else if (edit.kind === 'delete') task = this.store.remove(edit.list!, edit.item!);
    else if (edit.kind === 'clear') task = this.store.clear(edit.list!, edit.reviewed!);
    else if (edit.kind === 'categories') task = this.store.categories(edit.list!, this.categoryDraft());
    else task = this.store.edit(edit.list!, edit.item!, this.text(), this.notes() || null, edit.list!.isGrocery ? { quantity: this.quantity().trim() || null, unit: this.unit().trim() || null, categoryId: this.categoryId() } : {});
    this.editorOperation = this.store.pending().at(-1)?.key ?? null;
    const saved = await task;
    if (epoch !== this.editorEpoch) return;
    this.saving.set(false);
    if (saved) {
      if (edit.kind === 'new') { this.archived.set(false); this.choice.set(this.editorOperation); }
      this.close();
    }
    else if (!this.editorLocked()) this.conflicted.set(this.store.error().includes('another device'));
  }
}
