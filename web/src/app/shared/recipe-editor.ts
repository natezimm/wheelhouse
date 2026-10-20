import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RecipeContent } from '../core/recipes';

@Component({
  selector:'app-recipe-editor',
  imports:[FormsModule],
  template:`
    <fieldset [disabled]="locked()">
      <label class="field">Recipe title<input name="recipeTitle" maxlength="200" required [(ngModel)]="draft().title" /></label>
      <label class="field">Default servings<input name="defaultServings" type="number" min="1" max="100" step="1" required [(ngModel)]="draft().defaultServings" /></label>
      <h3>Ingredients</h3><p>Use a decimal quantity or text such as “to taste”. Units are optional.</p>
      @for (line of draft().ingredients; track line.id; let i = $index) {
        <section class="ingredient" [attr.aria-label]="'Ingredient ' + (i + 1)">
          <label class="field">Ingredient name<input [name]="'name'+i" maxlength="200" required [(ngModel)]="line.name" /></label>
          <div class="amount">
            <label class="field">Numeric quantity<input [name]="'quantity'+i" type="number" min="0" max="1000000" step="0.0001" [(ngModel)]="line.quantity" /></label>
            <label class="field">Text quantity<input [name]="'quantityText'+i" maxlength="100" placeholder="e.g. to taste" [(ngModel)]="line.quantityText" /></label>
            <label class="field">Unit<input [name]="'unit'+i" maxlength="50" placeholder="e.g. g" [(ngModel)]="line.unit" /></label>
          </div>
          @if (line.quantity !== null && line.quantityText?.trim()) { <p class="error">Use either numeric or text quantity for this ingredient.</p> }
          <button class="button" type="button" [disabled]="draft().ingredients.length <= 1" (click)="remove(i)">Remove ingredient {{ i + 1 }}</button>
        </section>
      }
      <button class="button" type="button" [disabled]="draft().ingredients.length >= 100" (click)="add()">Add ingredient</button>
      <label class="field">Preparation steps (one per line)<textarea name="steps" [ngModel]="steps()" (ngModelChange)="stepsChange.emit($event)" required rows="6"></textarea></label>
      <label class="field">Source URL (optional)<input name="source" type="url" maxlength="2000" placeholder="https://" [(ngModel)]="draft().sourceUrl" /></label>
      <label class="field">Recipe notes (optional)<textarea name="recipeNotes" maxlength="4000" [(ngModel)]="draft().notes"></textarea></label>
    </fieldset>
  `,
  styles:`
    fieldset { border:0; margin:0; padding:0; display:grid; gap:18px; min-width:0; } h3,p { margin:0; } p { color:var(--muted); }
    .ingredient { padding:14px; border:1px solid var(--line); border-radius:12px; display:grid; gap:12px; min-width:0; }
    .amount { display:grid; grid-template-columns:1fr 1fr; gap:10px; } .field { min-width:0; } input { width:100%; box-sizing:border-box; min-width:0; }
    textarea { width:100%; box-sizing:border-box; min-height:100px; border:1px solid var(--line); border-radius:12px; padding:12px; font:inherit; color:var(--ink); background:var(--surface); }
    .error { color:var(--danger); }
  `,
})
export class RecipeEditor {
  readonly draft = input.required<RecipeContent>(); readonly steps = input.required<string>(); readonly locked = input(false);
  readonly stepsChange = output<string>();
  protected add(): void { this.draft().ingredients.push({id:crypto.randomUUID(),name:'',quantity:null,quantityText:null,unit:null}); }
  protected remove(index: number): void { this.draft().ingredients.splice(index,1); }
}
