import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Clock } from '../core/clock';
import { addDays, dayIn, formatDay, startOfWeek } from '../core/days';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';
import { GroceryChoice, GroceryIngredient, GroceryMeal, GroceryPreview, MealGroceriesStore, compatibleIngredient, numericQuantity, sumQuantities } from '../core/meal-groceries';
import { DemoNotice } from '../shared/demo-notice';
import { PhoneNav } from './phone-nav';
import { SignIn } from './sign-in';

interface DraftLine extends GroceryIngredient {meal:GroceryMeal;selected:boolean;allowAdditional:boolean;targetId:string;numeric:boolean;}
const key=(r:DraftLine)=>r.meal.date+'/'+r.meal.slot+'/'+r.id;
@Component({
  selector:'app-meal-groceries-page',imports:[FormsModule,RouterLink,DemoNotice,PhoneNav,SignIn],
  template:`
    <a routerLink="/meals">← Meal plan</a><header><h1>Meals to groceries</h1><p>Review what you need before it goes on the list.</p></header>
    @if (family.state().status === 'private') { <app-sign-in /> }
    @else if (family.family()) {
      <div class="connection" role="status"><span>{{ live.state() === 'reconnecting' ? 'Reconnecting' : live.state() === 'connected' || live.state() === 'resyncing' ? 'Live updates' : 'Connecting' }}</span>
        <button class="button" [disabled]="store.refreshing()" (click)="live.resync()">Resync now</button></div>
      <nav aria-label="Grocery meal week"><h2>Week of {{ label(week()) }}</h2><div class="actions">
        <button class="button" [disabled]="locked() || confirming() || week() <= '1900-01-08'" (click)="navigate(-7)">Previous week</button>
        <button class="button" [disabled]="locked() || confirming() || week() >= '2199-12-17'" (click)="navigate(7)">Next week</button>
      </div></nav>
      @if (store.refreshFailed()) { <p class="error" role="alert">Could not refresh the preview. Your review is kept.</p><button class="button" (click)="store.refresh()">Retry preview</button> }
      @if (store.error()) { <p class="error" role="alert">{{ store.error() }}</p> }
      @if (store.pending(); as op) {
        <div class="card" role="status"><p>{{ op.uncertain ? 'Grocery save not confirmed' : 'Adding groceries…' }} · {{ op.body.items.length }} ingredients · {{ label(op.from) }}</p>
          @if (op.uncertain) { <button class="button" (click)="checkSave()">Check grocery save</button> }
        </div>
      }
      @if (submitted() && store.result(); as result) {
        <section class="card success" role="status"><h2>Groceries added</h2><p>{{ result.ingredientCount }} ingredients in {{ result.itemIds.length }} grocery items. Later meal changes keep these purchases intact.</p>
          <a class="button primary" routerLink="/lists">Open Grocery</a>
          <button class="button" [disabled]="store.refreshing() || store.refreshFailed()" (click)="review()">Review this week again</button>
        </section>
      } @else if (draft(); as preview) {
        @if (newer() || conflicted()) {
          <div class="notice"><p>New information is available. Review latest reloads meal contents, purchase counts and grocery choices and resets this review.</p>
            <button class="button" [disabled]="locked() || store.refreshing() || store.refreshFailed()" (click)="review()">Review latest</button></div>
        }
        <p>Use the quantities saved with each meal. Already added ingredients start unselected, even if checked or cleared from Grocery. A changed recipe or serving count needs a new review; existing purchases stay as they are.</p>
        <fieldset [disabled]="locked() || confirming()">
          <div class="actions"><button class="button" type="button" (click)="selectAll()">Select unpurchased ingredients</button><button class="button" type="button" (click)="clear()">Clear selection</button></div>
          @for (meal of preview.meals; track meal.date + meal.slot) {
            @if (firstMealOnDay(meal)) { <button class="button" type="button" (click)="selectDay(meal.date)">Select {{ label(meal.date) }} unpurchased ingredients</button> }
            <section class="card meal" [attr.aria-label]="meal.date + ' ' + meal.slot">
              <h2>{{ label(meal.date) }} · {{ meal.slot }}</h2><h3>{{ meal.title }}</h3>
              @if (!meal.snapshotKey) { <p>This is a free-text meal. Add ingredients manually in <a routerLink="/lists">Grocery</a>, or choose a saved recipe in Meals.</p> }
              @else {
                <p>{{ meal.servings }} servings</p>
                <button class="button" type="button" (click)="selectMeal(meal)">Select this meal's unpurchased ingredients</button>
                @for (row of mealRows(meal); track row.id) {
                  <article class="ingredient">
                    <label class="check"><input type="checkbox" [ngModel]="row.selected" (ngModelChange)="patch(row,'selected',$event)"
                      [attr.aria-label]="'Include ' + row.name + ' for ' + meal.date + ' ' + meal.slot" /><strong>{{ row.name }}</strong></label>
                    @if (row.previousCount) { <p class="previous">Already added {{ row.previousCount }} time(s) from this saved meal.</p>
                      @if (row.selected) { <label class="check"><input type="checkbox" [ngModel]="row.allowAdditional" (ngModelChange)="patch(row,'allowAdditional',$event)" />Buy this ingredient again</label> }
                    }
                    @if (row.selected) {
                      @if (row.numeric) {
                        <label class="field">Quantity · {{ row.unit || 'no unit' }}<input type="number" min="0" max="1000000000000" step="0.0001"
                          [attr.aria-label]="'Quantity for ' + row.name + ' on ' + meal.date + ' ' + meal.slot" [ngModel]="row.quantity" (ngModelChange)="patch(row,'quantity',$event)" /></label>
                      } @else {
                        <label class="field">Text quantity · {{ row.unit || 'no unit' }}<input maxlength="100"
                          [attr.aria-label]="'Text quantity for ' + row.name + ' on ' + meal.date + ' ' + meal.slot" [ngModel]="row.quantityText" (ngModelChange)="patch(row,'quantityText',$event)" /></label>
                        <p>Text quantities stay separate and are not scaled or combined.</p>
                      }
                      <label class="field">Grocery destination<select [attr.aria-label]="'Destination for ' + row.name + ' on ' + meal.date + ' ' + meal.slot" [ngModel]="row.targetId" (ngModelChange)="patch(row,'targetId',$event)">
                        <option value="">New grocery item</option>
                        @for (item of candidates(row); track item.id) { <option [value]="item.id">Combine with {{ item.text }} · {{ item.quantity }} {{ item.unit }}</option> }
                      </select></label>
                    }
                  </article>
                }
              }
            </section>
          } @empty { <p class="card">No meals planned this week. Choose recipes in Meals to preview their ingredients.</p> }
          <label class="check"><input type="checkbox" [ngModel]="combine()" (ngModelChange)="combine.set($event)" />Combine matching selected ingredients into new items</label>
          <p>Only numeric quantities with matching names and units combine. New items use Other; existing items keep their category. No unit conversions.</p>
        </fieldset>
        <p role="status">{{ selectedCount() }} ingredients selected (up to 500).</p>
        @if (!valid()) { <p>Select ingredients with valid quantities. Previously added ingredients require Buy this ingredient again.</p> }
        <button class="button primary" [disabled]="locked() || conflicted() || !valid()" (click)="confirming.set(true)">Review addition…</button>
      } @else if (!store.refreshFailed()) { <p role="status">Loading grocery preview…</p> }
      @if (confirming()) {
        <dialog #dialog (cancel)="confirming.set(false)" (close)="confirming.set(false)"><h2>Add to Grocery?</h2>
          <p>{{ selectedCount() }} ingredients. Check the resulting quantities:</p>
          <ul>@for (line of totals(); track $index) { <li>{{ line }}</li> }</ul>
          <p>Only the reviewed meals and grocery targets are used. Existing purchases are kept.</p>
          <div class="actions"><button class="button" (click)="confirming.set(false)">Back to review</button><button class="button primary" [disabled]="locked() || conflicted()" (click)="save()">Add groceries</button></div>
        </dialog>
      }
    } @else { <p>Loading your household…</p> }
    <footer><app-demo-notice /></footer><app-phone-nav />
  `,
  styles:`
    :host { display:flex; flex-direction:column; gap:20px; max-width:780px; margin:auto; padding:24px 18px 12px; min-height:100vh; box-sizing:border-box; }
    h1 { font:600 36px var(--font-display); margin:0 0 8px; } h2 { font:600 24px var(--font-display); } h2,h3,p { margin:0; } h3 { font-size:20px; }
    a { color:var(--ink); min-height:44px; display:inline-flex; align-items:center; } .actions,.connection { display:flex; flex-wrap:wrap; gap:12px; align-items:center; } .connection { justify-content:space-between; } nav { display:grid; gap:12px; }
    fieldset { padding:0; margin:0; border:0; display:grid; gap:18px; min-width:0; } .meal,.ingredient,.success { display:grid; gap:14px; min-width:0; overflow-wrap:anywhere; }
    .ingredient { border-top:1px solid var(--line); padding-top:14px; } .check { display:flex; gap:12px; align-items:center; } .check input { width:44px; height:44px; flex:0 0 44px; }
    p { line-height:1.5; } .previous,.notice { color:var(--muted); } .notice { display:grid; gap:12px; } .error { color:var(--danger); }
    select { min-height:44px; width:100%; min-width:0; border:1px solid var(--line); border-radius:12px; padding:10px; font:inherit; color:var(--ink); background:var(--surface); }
    dialog { border:1px solid var(--line); border-radius:20px; padding:24px; width:min(560px,calc(100vw - 40px)); box-sizing:border-box; background:var(--surface); color:var(--ink); } dialog::backdrop { background:#0005; }
    dialog p { margin:16px 0; } dialog li { padding:8px 0; overflow-wrap:anywhere; } footer { margin-top:auto; }
  `,
})
export class MealGroceriesPage {
  protected readonly family=inject(FamilyStore);protected readonly live=inject(HouseholdLive);protected readonly store=inject(MealGroceriesStore);
  private readonly clock=inject(Clock);private readonly route=inject(ActivatedRoute);
  protected readonly focus=signal<string|null>(this.initialWeek());
  protected readonly week=computed(()=>this.focus()??startOfWeek(dayIn(this.family.family()?.timeZone??'UTC',this.clock.now()),this.family.family()?.weekStartsOn??'Monday'));
  protected readonly draft=signal<GroceryPreview|null>(null);protected readonly rows=signal<DraftLine[]>([]);
  protected readonly combine=signal(false);protected readonly confirming=signal(false);protected readonly submitted=signal(false);protected readonly conflicted=signal(false);
  protected readonly locked=computed(()=>!!this.store.pending());
  protected readonly selectedCount=computed(()=>this.rows().filter(r=>r.selected).length);
  protected readonly newer=computed(()=>{const d=this.draft(),s=this.store.snapshot();return !!d&&!!s&&(s.mealsChangeNumber>d.mealsChangeNumber||s.listsChangeNumber>d.listsChangeNumber);});
  private readonly dialog=viewChild<ElementRef<HTMLDialogElement>>('dialog');private epoch=0;
  constructor(){
    this.family.load();let identity:string|null=null;let selectedWeek='';let selectedFamily='';
    effect(()=>{const f=this.family.family(),denied=this.family.state().status==='private';
      if(denied||f&&identity&&f.id!==identity)untracked(()=>{selectedWeek='';selectedFamily='';this.epoch++;this.draft.set(null);this.rows.set([]);this.confirming.set(false);this.submitted.set(false);this.focus.set(null);});
      if(f)identity=f.id;
    });
    effect(()=>{const f=this.family.family(),week=this.week();if(f&&(week!==selectedWeek||f.id!==selectedFamily))untracked(()=>{selectedWeek=week;selectedFamily=f.id;this.draft.set(null);this.rows.set([]);this.confirming.set(false);this.submitted.set(false);this.conflicted.set(false);this.store.select(week,addDays(week,7));});});
    effect(()=>{const s=this.store.snapshot();if(s&&s.from===this.week()&&!this.draft()&&!this.submitted())untracked(()=>this.apply(s));});
    effect(()=>{const dialog=this.dialog()?.nativeElement;if(dialog&&!dialog.open)dialog.showModal();});
  }
  private initialWeek():string|null {const v=this.route.snapshot.queryParamMap.get('from');return v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v>='1900-01-01'&&v<='2199-12-24'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;}
  protected label(day:string):string {return formatDay(day,{month:'short',day:'numeric',year:'numeric'});}
  protected navigate(days:number):void {this.focus.set(addDays(this.week(),days));}
  protected mealRows(meal:GroceryMeal):DraftLine[]{return this.rows().filter(r=>r.meal.date===meal.date&&r.meal.slot===meal.slot);}
  protected patch(row:DraftLine,field:'selected'|'allowAdditional'|'quantity'|'quantityText'|'targetId',value:unknown):void {
    this.rows.update(rows=>rows.map(r=>key(r)===key(row)?{...r,[field]:value,...(field==='quantity'&&value===null?{targetId:''}:{})}:r));
  }
  protected selectAll():void {this.rows.update(rows=>rows.map(r=>({...r,selected:r.previousCount===0})));}
  protected clear():void {this.rows.update(rows=>rows.map(r=>({...r,selected:false})));}
  protected selectMeal(meal:GroceryMeal):void {this.rows.update(rows=>rows.map(r=>r.meal.date===meal.date&&r.meal.slot===meal.slot?{...r,selected:r.previousCount===0}:r));}
  protected firstMealOnDay(meal:GroceryMeal):boolean {return this.draft()?.meals.find(m=>m.date===meal.date)?.slot===meal.slot;}
  protected selectDay(date:string):void {this.rows.update(rows=>rows.map(r=>r.meal.date===date?{...r,selected:r.previousCount===0}:r));}
  protected candidates(row:DraftLine){return this.draft()?.grocery.items.filter(i=>compatibleIngredient(row,i))??[];}
  protected valid():boolean {
    const rows=this.rows().filter(r=>r.selected);
    return rows.length>0&&rows.length<=500&&rows.every(r=>(!r.previousCount||r.allowAdditional)&&
      (r.quantity===null||numericQuantity(String(r.quantity))!==null));
  }
  protected review():void {const s=this.store.snapshot();if(!s||s.from!==this.week())return;this.submitted.set(false);this.apply(s);this.store.dismissError();}
  private apply(s:GroceryPreview):void {
    this.focus.set(s.from);this.draft.set(structuredClone(s));this.combine.set(false);this.conflicted.set(false);
    this.rows.set(s.meals.flatMap(meal=>meal.ingredients.map(line=>({...structuredClone(line),meal:structuredClone(meal),numeric:line.quantity!==null,selected:line.previousCount===0,allowAdditional:false,targetId:''}))));
  }
  protected totals():string[]{
    const grouped=new Map<string,{name:string;quantities:(number|string)[]|null;text:string|null;unit:string|null;existing:boolean}>();
    for(const row of this.rows().filter(r=>r.selected)){
      const target=this.draft()?.grocery.items.find(i=>i.id===row.targetId);
      const group=row.targetId||this.combine()&&row.quantity!==null&&JSON.stringify([row.name.trim().replace(/\s+/g,' ').toUpperCase(),row.unit?.trim().replace(/\s+/g,' ').toUpperCase()??''])||key(row);
      const prior=grouped.get(group);
      if(prior&&row.quantity!==null)prior.quantities!.push(row.quantity);
      else grouped.set(group,{name:target?.text??row.name,quantities:row.quantity===null?null:[target?.quantity??'0',row.quantity],text:row.quantityText,unit:target?.unit??row.unit,existing:!!target});
    }
    return [...grouped.values()].map(g=>(g.existing?'Update: ':'New: ')+g.name+' · '+(g.quantities===null?g.text??'':sumQuantities(g.quantities))+' '+(g.unit??''));
  }
  protected async save():Promise<void>{
    const d=this.draft();if(!d||this.locked()||this.conflicted()||!this.valid())return;const epoch=this.epoch;
    const choices:GroceryChoice[]=this.rows().filter(r=>r.selected).map(r=>({date:r.meal.date,slot:r.meal.slot,mealVersion:r.meal.version,
      snapshotKey:r.meal.snapshotKey!,ingredientId:r.id,quantity:r.quantity,quantityText:r.quantityText?.trim()||null,previousCount:r.previousCount,
      allowAdditional:r.allowAdditional,targetItemId:r.targetId||null,targetVersion:d.grocery.items.find(i=>i.id===r.targetId)?.version??null}));
    this.confirming.set(false);const ok=await this.store.add(d,choices,this.combine());if(epoch!==this.epoch)return;
    if(ok)this.submitted.set(true);else this.conflicted.set(this.store.error().includes('Review latest'));
  }
  protected async checkSave():Promise<void>{const epoch=this.epoch;if(await this.store.retry()&&epoch===this.epoch)this.submitted.set(true);}
}
