import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RecipeSnapshot, ingredientQuantity } from '../core/recipes';

@Component({
  selector:'app-recipe-detail',
  imports:[FormsModule],
  host:{'[class.wall]':'wall()'},
  template:`
    <section aria-label="Recipe detail">
      <h3>{{ recipe().content.title }}</h3>
      <label class="field">Servings<input name="servings" type="number" min="1" max="100" step="1"
        [ngModel]="servings()" (ngModelChange)="servingsChange.emit($event)" [disabled]="locked()" /></label>
      <p>Original recipe serves {{ recipe().content.defaultServings }}. Text quantities stay as written.</p>
      <h4>Ingredients</h4><ul>
        @for (line of recipe().content.ingredients; track line.id) {
          <li><strong>{{ quantity(line) }} {{ line.unit }}</strong> {{ line.name }}</li>
        }
      </ul>
      <h4>Preparation</h4><ol>@for (step of recipe().content.steps; track $index) { <li>{{ step }}</li> }</ol>
      @if (recipe().content.notes) { <h4>Recipe notes</h4><p class="preserve">{{ recipe().content.notes }}</p> }
      @if (recipe().content.sourceUrl) { <a [href]="recipe().content.sourceUrl" target="_blank" rel="noopener noreferrer">Original source ↗</a> }
    </section>
  `,
  styles:`
    section { display:grid; gap:14px; overflow-wrap:anywhere; } h3 { font:600 28px var(--font-display); margin:0; } h4,p { margin:0; }
    p { color:var(--muted); } ul,ol { margin:0; padding-left:24px; } li { padding:6px 0; line-height:1.5; } .preserve { white-space:pre-wrap; }
    a { min-height:44px; display:flex; align-items:center; color:var(--ink); }
    :host.wall { font-size:22px; } :host.wall input,:host.wall a { min-height:56px; font-size:22px; }
  `,
})
export class RecipeDetail {
  readonly recipe = input.required<RecipeSnapshot>(); readonly servings = input.required<number>();
  readonly wall = input(false); readonly locked = input(false); readonly servingsChange = output<number>();
  protected quantity(line: RecipeSnapshot['content']['ingredients'][number]): string {
    const value = this.servings();
    return ingredientQuantity(line, Number.isInteger(value) && value >= 1 && value <= 100 ? value : this.recipe().content.defaultServings, this.recipe().content.defaultServings);
  }
}
