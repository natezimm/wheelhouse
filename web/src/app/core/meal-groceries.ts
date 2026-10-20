import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { HouseholdList, ListItem, ListsStore } from './lists';
import { refusalMessage } from './family';

export interface GroceryIngredient { id:string; name:string; quantity:number|null; quantityText:string|null; unit:string|null; previousCount:number; }
export interface GroceryMeal { date:string; slot:string; version:string; title:string; snapshotKey:string|null; servings:number|null; ingredients:GroceryIngredient[]; }
export interface GroceryPreview { from:string; to:string; mealsChangeNumber:number; listsChangeNumber:number; grocery:HouseholdList; meals:GroceryMeal[]; }
export interface GroceryChoice { date:string; slot:string; mealVersion:string; snapshotKey:string; ingredientId:string; quantity:number|null;
  quantityText:string|null; previousCount:number; allowAdditional:boolean; targetItemId:string|null; targetVersion:string|null; }
export interface GroceryBatch { id:string; addedAt:string; ingredientCount:number; itemIds:string[]; }
interface Operation { key:string; from:string; to:string; body:{commandId:string;groceryListId:string;combineNew:boolean;items:GroceryChoice[]}; uncertain:boolean; }
export const normalizeIngredient = (value:string|null|undefined) => (value ?? '').trim().replace(/\s+/g,' ').toUpperCase();
export function numericQuantity(value:string|null|undefined):number|null {
  if (!value || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const n=Number(value); return Number.isFinite(n) && n>=0 && n<=1e12 ? n : null;
}
export function compatibleIngredient(line:GroceryIngredient, item:ListItem):boolean {
  return line.quantity!==null && !item.checked && !item.deleted && numericQuantity(item.quantity)!==null
    && normalizeIngredient(line.name)===normalizeIngredient(item.text) && normalizeIngredient(line.unit)===normalizeIngredient(item.unit);
}

@Injectable({providedIn:'root'})
export class MealGroceriesStore {
  private readonly http=inject(HttpClient); private readonly lists=inject(ListsStore);
  private readonly confirmed=signal<GroceryPreview|null>(null); private readonly operation=signal<Operation|null>(null);
  private readonly busy=signal(false); private readonly failed=signal(false); private readonly message=signal('');
  private readonly completed=signal<GroceryBatch|null>(null);
  private from=''; private to=''; private epoch=0; private sequence=0; private reading=false; private queued=false;
  private mealsRevision=-1; private listsRevision=-1; private wantedMeals=-1; private wantedLists=-1;
  readonly snapshot=this.confirmed.asReadonly(); readonly pending=this.operation.asReadonly(); readonly result=this.completed.asReadonly();
  readonly refreshing=this.busy.asReadonly(); readonly refreshFailed=this.failed.asReadonly(); readonly error=this.message.asReadonly();
  select(from:string,to:string):void {
    if(this.from===from && this.to===to)return;
    this.from=from;this.to=to;this.sequence++;this.reading=false;this.queued=false;this.confirmed.set(null);this.refresh();
  }
  changed(domain:string,revision:number):void {
    if(!Number.isSafeInteger(revision)||revision<0)return;
    if(domain==='meals'){if(revision<=this.wantedMeals)return;this.wantedMeals=revision;if(revision>this.mealsRevision)this.refresh();}
    if(domain==='lists'){if(revision<=this.wantedLists)return;this.wantedLists=revision;if(revision>this.listsRevision)this.refresh();}
  }
  refresh():void {
    if(!this.from)return;if(this.reading){this.queued=true;return;}
    const epoch=this.epoch,sequence=this.sequence,from=this.from,to=this.to;this.reading=true;this.busy.set(true);this.failed.set(false);
    this.http.get<GroceryPreview>('/api/meals/groceries',{params:{from,to}}).pipe(timeout(15000)).subscribe({
      next:s=>{
        if(epoch!==this.epoch||sequence!==this.sequence)return;
        if(this.valid(s,from,to)&&s.mealsChangeNumber>=this.mealsRevision&&s.listsChangeNumber>=this.listsRevision){
          this.confirmed.set(s);this.mealsRevision=s.mealsChangeNumber;this.listsRevision=s.listsChangeNumber;
          if(this.wantedMeals>this.mealsRevision||this.wantedLists>this.listsRevision)this.queued=true;
        }else this.failed.set(true);
      },
      error:()=>{if(epoch===this.epoch&&sequence===this.sequence){this.failed.set(true);this.finishRead();}},
      complete:()=>{if(epoch===this.epoch&&sequence===this.sequence)this.finishRead();},
    });
  }
  add(preview:GroceryPreview,items:GroceryChoice[],combineNew:boolean):Promise<boolean> {
    if(this.operation()||!items.length)return Promise.resolve(false);
    const key=crypto.randomUUID(),op:Operation={key,from:preview.from,to:preview.to,
      body:{commandId:key,groceryListId:preview.grocery.id,combineNew,items:structuredClone(items)},uncertain:false};
    this.message.set('');this.completed.set(null);this.operation.set(op);return this.send(op,this.epoch);
  }
  async retry():Promise<boolean> {
    const op=this.operation();if(!op?.uncertain)return false;const epoch=this.epoch;this.operation.set({...op,uncertain:false});
    try {
      const s=await firstValueFrom(this.http.get<GroceryPreview>('/api/meals/groceries',{params:{from:op.from,to:op.to}}).pipe(timeout(15000)));
      if(epoch!==this.epoch)return false;if(!this.valid(s,op.from,op.to))throw new Error('Invalid preview');
    }catch{if(epoch===this.epoch){this.operation.set({...op,uncertain:true});this.message.set('Could not check grocery save. Try again.');}return false;}
    // The durable batch receipt decides whether to apply; content comparison cannot prove that.
    return this.send(op,epoch);
  }
  dismissError():void {this.message.set('');}
  reset():void {
    this.epoch++;this.sequence++;this.from='';this.to='';this.reading=false;this.queued=false;
    this.mealsRevision=-1;this.listsRevision=-1;this.wantedMeals=-1;this.wantedLists=-1;
    this.confirmed.set(null);this.operation.set(null);this.completed.set(null);this.busy.set(false);this.failed.set(false);this.message.set('');
  }
  private async send(op:Operation,epoch:number):Promise<boolean> {
    try {
      const result=await firstValueFrom(this.http.post<GroceryBatch>('/api/meals/groceries',op.body).pipe(timeout(20000)));
      if(epoch!==this.epoch)return false;
      if(!result||result.id!==op.key||result.ingredientCount!==op.body.items.length||!Array.isArray(result.itemIds))throw new Error('Invalid batch');
      this.operation.set(null);this.completed.set(result);this.message.set('');this.afterWrite();this.lists.refresh();return true;
    }catch(e){
      if(epoch!==this.epoch)return false;
      if(!(e instanceof HttpErrorResponse)||e.status===0||e.status>=500||e.status===408){
        this.operation.set({...op,uncertain:true});this.message.set('Grocery save not confirmed. Check grocery save before trying again.');
      }else{
        this.operation.set(null);this.message.set(e.status===409?'Meals, prior purchases or grocery items changed. Review latest before adding again.'
          :refusalMessage(e,'Groceries were not added. Your review is still available.'));this.afterWrite();
      }
      return false;
    }
  }
  private valid(s:GroceryPreview,from:string,to:string):boolean {
    return !!s&&s.from===from&&s.to===to&&Number.isSafeInteger(s.mealsChangeNumber)&&s.mealsChangeNumber>=0
      &&Number.isSafeInteger(s.listsChangeNumber)&&s.listsChangeNumber>=0&&Array.isArray(s.meals)&&!!s.grocery?.isGrocery&&Array.isArray(s.grocery.items);
  }
  private afterWrite():void {this.sequence++;this.reading=false;this.queued=false;this.refresh();}
  private finishRead():void {this.reading=false;this.busy.set(false);if(this.queued){this.queued=false;this.refresh();}}
}
