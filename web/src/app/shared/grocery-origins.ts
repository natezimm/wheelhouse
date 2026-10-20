import { Component, input } from '@angular/core';
import { GroceryOrigin } from '../core/lists';

@Component({
  selector:'app-grocery-origins',host:{'[class.wall]':'wall()'},
  template:`<details><summary>Originally from {{ sources().length }} meal ingredients</summary>
    <ul>@for (source of sources(); track $index) { <li>{{ source.date }} · {{ source.slot }} · {{ source.mealTitle }} ({{ source.servings }} servings): {{ source.quantity ?? source.quantityText }} {{ source.unit }} {{ source.ingredientName }}</li> }</ul>
  </details>`,
  styles:`summary { min-height:44px; display:flex; align-items:center; cursor:pointer; } :host.wall summary { min-height:56px; } li { margin:8px 0; overflow-wrap:anywhere; }`,
})
export class GroceryOrigins { readonly sources=input.required<GroceryOrigin[]>(); readonly wall=input(false); }
