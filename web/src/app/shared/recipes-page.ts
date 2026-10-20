import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FamilyStore } from '../core/family';
import { HouseholdLive } from '../core/household-live';
import { RecipesStore } from '../core/recipes';
import { PhoneNav } from '../phone/phone-nav';
import { SignIn } from '../phone/sign-in';
import { DemoNotice } from './demo-notice';
import { RecipeLibrary } from './recipe-library';

@Component({
  selector:'app-recipes-page', imports:[RouterLink,PhoneNav,SignIn,DemoNotice,RecipeLibrary],
  host:{'[class.wall]':'wall'},
  template:`
    <a [routerLink]="wall ? '/wall/meals' : '/meals'">← Meal plan</a>
    <header><h1>Recipes</h1><p>Family favorites, ready for another week.</p></header>
    @if (family.state().status === 'private') { @if (wall) { <a routerLink="/wall">Pair this display</a> } @else { <app-sign-in /> } }
    @else if (family.family()) {
      <div class="connection" role="status"><span>{{ live.state() === 'reconnecting' ? 'Reconnecting' : live.state() === 'connected' || live.state() === 'resyncing' ? 'Live updates' : 'Connecting' }}</span>
        <button class="button" [disabled]="recipes.refreshing()" (click)="live.resync()">Resync now</button></div>
      <app-recipe-library [wall]="wall" />
    } @else { <p>Loading your household…</p> }
    <footer><app-demo-notice /></footer>@if (!wall) { <app-phone-nav /> }
  `,
  styles:`
    :host { display:flex; flex-direction:column; gap:24px; max-width:780px; margin:auto; padding:24px 18px 12px; min-height:100vh; box-sizing:border-box; }
    h1 { font:600 40px var(--font-display); margin:0 0 8px; } p { margin:0; color:var(--muted); } a { display:flex; align-items:center; min-height:44px; color:var(--ink); }
    .connection { display:flex; align-items:center; justify-content:space-between; gap:12px; } footer { margin-top:auto; }
    :host.wall { max-width:1500px; font-size:22px; padding:28px 36px; } :host.wall .button,:host.wall a { min-height:56px; font-size:22px; }
  `,
})
export class RecipesPage {
  protected readonly family = inject(FamilyStore); protected readonly live = inject(HouseholdLive);
  protected readonly recipes = inject(RecipesStore);
  protected readonly wall = inject(ActivatedRoute).snapshot.data['wall'] === true;
  constructor() { this.family.load(); }
}
