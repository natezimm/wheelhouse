import { Component, DestroyRef, computed, effect, inject, input, output } from '@angular/core';
import { WallPairing } from '../core/pairing';

/**
 * What a wall display shows until it is paired: a code for a parent to type on their phone,
 * and how to do it. It switches to the family by itself once the code is entered.
 */
@Component({
  selector: 'app-pairing-screen',
  template: `
    <div class="intro">
      <h1>Pair this display</h1>
      <p>Enter this code on a parent's phone to connect it to your family.</p>
    </div>

    @if (code(); as code) {
      <div class="code" role="img" [attr.aria-label]="'Pairing code ' + code.slice(0, 3) + ' ' + code.slice(3)">
        @for (digit of code.slice(0, 3); track $index) {
          <span class="digit" aria-hidden="true">{{ digit }}</span>
        }
        <span class="dash" aria-hidden="true"></span>
        @for (digit of code.slice(3); track $index) {
          <span class="digit" aria-hidden="true">{{ digit }}</span>
        }
      </div>
    } @else {
      <div class="code" aria-hidden="true">
        @for (slot of [1, 2, 3]; track slot) {
          <span class="digit empty"></span>
        }
        <span class="dash"></span>
        @for (slot of [4, 5, 6]; track slot) {
          <span class="digit empty"></span>
        }
      </div>
    }

    <ol class="steps">
      <li><span class="number" aria-hidden="true">1</span>Open the family app on your phone and go to Settings.</li>
      <li><span class="number" aria-hidden="true">2</span>Under Displays, tap Pair a display and type the code.</li>
      <li><span class="number" aria-hidden="true">3</span>This screen switches to your family by itself.</li>
    </ol>

    <p class="status" role="status">
      <span class="dot" [class.waiting]="code()" aria-hidden="true"></span>
      @switch (pairing.state().status) {
        @case ('showing') {
          Waiting for approval · the code works for 10 minutes, then a new one appears
        }
        @case ('unavailable') {
          Can't reach the server. Trying again…
        }
        @default {
          Getting a code…
        }
      }
    </p>

    @if (cancellable()) {
      <button class="back" type="button" (click)="cancelled.emit()">Back to the family</button>
    }
  `,
  styles: `
    /* Fills the wall's frame in place of the family. */
    :host {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 48px;
    }

    .intro {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      text-align: center;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 64px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      letter-spacing: -0.02em;
    }

    .intro p {
      margin: 0;
      font-size: 24px;
      color: var(--muted);
    }

    .code {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .digit {
      width: 150px;
      height: 190px;
      border-radius: 24px;
      background: var(--surface);
      font-family: var(--font-display);
      font-size: 120px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .digit.empty {
      background: color-mix(in srgb, var(--surface) 55%, transparent);
    }

    .dash {
      width: 36px;
      height: 8px;
      margin: 0 12px;
      border-radius: 4px;
      background: var(--line);
    }

    .steps {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      gap: 20px;
    }

    .steps li {
      box-sizing: border-box;
      width: 380px;
      padding: 22px 24px;
      border-radius: 20px;
      background: var(--surface);
      display: flex;
      align-items: flex-start;
      gap: 16px;
      font-size: 20px;
      line-height: 1.35;
    }

    .number {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 20px;
      background: var(--ink);
      color: var(--on-ink);
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .status {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 20px;
      color: var(--muted);
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 5px;
      background: var(--warn);
    }

    .dot.waiting {
      background: var(--ok);
    }

    .back {
      min-height: 56px;
      padding: 0 28px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--surface);
      color: var(--ink);
      font: 700 18px var(--font-body);
      cursor: pointer;
    }
  `,
})
export class PairingScreen {
  protected readonly pairing = inject(WallPairing);

  /** The demo's wall already shows a family, so it can go back to it without pairing. */
  readonly cancellable = input(false);

  /** A parent entered the code, and this browser is now signed in as the family's display. */
  readonly paired = output();
  readonly cancelled = output();

  protected readonly code = computed(() => {
    const state = this.pairing.state();
    return state.status === 'showing' ? state.code : null;
  });

  constructor() {
    this.pairing.begin();
    inject(DestroyRef).onDestroy(() => this.pairing.end());

    effect(() => {
      if (this.pairing.state().status === 'paired') {
        this.paired.emit();
      }
    });
  }
}
