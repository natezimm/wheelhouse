import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionStore, googleSignInUrl } from '../core/session';

/**
 * What a phone shows when nobody is signed in to a private family: the way in for a parent,
 * and why the last attempt did not get them in.
 */
@Component({
  selector: 'app-sign-in',
  imports: [RouterLink],
  template: `
    <p class="private">This Wheelhouse is private.</p>
    @if (session.canSignIn()) {
      <a class="button primary" [href]="href()">Sign in with Google</a>
      @switch (outcome()) {
        @case ('refused') {
          <p class="outcome" role="alert">That Google account can't sign in to this Wheelhouse. Only the family's parents can.</p>
        }
        @case ('failed') {
          <p class="outcome" role="alert">Sign-in didn't finish. Try again.</p>
        }
      }
    }
    <a class="privacy" routerLink="/privacy">Privacy</a>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      text-align: center;
    }

    .private {
      margin: 0;
      font-family: var(--font-display);
      font-size: 22px;
      color: var(--muted);
    }

    a.button {
      display: inline-flex;
      align-items: center;
      text-decoration: none;
    }

    .privacy {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      font-size: 14px;
      color: var(--muted);
    }

    .outcome {
      margin: 0;
      max-width: 300px;
      font-size: 14px;
      color: var(--danger);
    }
  `,
})
export class SignIn {
  protected readonly session = inject(SessionStore);

  /** Where to return after signing in. */
  readonly returnUrl = input('/');

  /** How the last trip to Google ended, from the API's redirect: refused or failed. */
  readonly outcome = input<string>();

  protected readonly href = computed(() => googleSignInUrl(this.returnUrl()));
}
