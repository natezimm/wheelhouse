import { Component, input, output } from '@angular/core';

/** Remembered in this browser once a visitor has closed the welcome, so it shows only on a first visit. */
export const WELCOME_STORAGE_KEY = 'wheelhouse.welcome.v1';

/** Whether this browser has already closed the demo's welcome. Blocked storage counts as not yet. */
export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_STORAGE_KEY) === 'seen';
  } catch {
    return false;
  }
}

export function rememberWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_STORAGE_KEY, 'seen');
  } catch {
    // Private windows and blocked storage: the welcome shows again next time, which is harmless.
  }
}

/**
 * A first visitor's welcome to the public demo: whose calendar this is, that the copy is theirs to
 * change, and an offer to be shown around (the tour in demo-tour.ts). It never covers the
 * calendar on a phone (it sits above the view) and floats in a corner of a desktop window.
 */
@Component({
  selector: 'app-demo-welcome',
  host: { '[class.desktop]': "layout() === 'desktop'" },
  template: `
    <section class="panel" role="region" aria-labelledby="welcome-title">
      <button type="button" class="close" aria-label="Close the welcome" (click)="closed.emit()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
      <p class="eyebrow">Live demo</p>
      <h2 id="welcome-title">Meet the Marlowes</h2>
      <p class="lead">A fictional family's calendar, copied just for you. Change anything; it's cleared after a day.</p>
      <button type="button" class="start" (click)="tour.emit()">
        Take the tour <span class="sub">{{ layout() === 'desktop' ? '5 stops, about 30 seconds' : '5 quick stops' }}</span>
      </button>
      <button type="button" class="own" (click)="closed.emit()">Explore on my own</button>
    </section>
  `,
  styles: `
    :host {
      display: block;
      margin: 0 0 16px;
    }

    /* A desktop window: a card floating in the bottom corner, over the calendar but beside its toolbar. */
    :host(.desktop) {
      position: fixed;
      right: 32px;
      bottom: 32px;
      z-index: 6;
      width: 360px;
      max-width: calc(100vw - 64px);
      margin: 0;
    }

    .panel {
      position: relative;
      padding: 20px 20px 18px;
      border-radius: var(--card-radius);
      border: var(--card-border);
      background: var(--surface);
      box-shadow: var(--card-shadow);
      color: var(--ink);
      animation: rise 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) 0.5s both;
    }

    :host(.desktop) .panel {
      box-shadow: var(--dialog-shadow);
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .panel {
        animation: none;
      }
    }

    .close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }

    .close:hover {
      background: var(--track);
      color: var(--ink);
    }

    .eyebrow {
      margin: 0 0 4px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
    }

    h2 {
      margin: 0 48px 6px 0;
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      line-height: 1.15;
    }

    .lead {
      margin: 0 0 14px;
      font-size: 15px;
      line-height: 1.4;
      color: var(--muted);
    }

    .start {
      width: 100%;
      min-height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: var(--primary-border);
      border-radius: var(--pill);
      background: var(--primary);
      color: var(--on-primary);
      box-shadow: var(--primary-shadow);
      font: 600 16px var(--font-body);
      cursor: pointer;
    }

    .start .sub {
      font-size: 13px;
      font-weight: 500;
    }

    .own {
      width: 100%;
      min-height: 44px;
      margin-top: 6px;
      border: 0;
      border-radius: var(--pill);
      background: transparent;
      color: var(--muted);
      font: 600 15px var(--font-body);
      cursor: pointer;
    }

    .own:hover {
      color: var(--ink);
    }
  `,
})
export class DemoWelcome {
  readonly layout = input<'desktop' | 'phone'>('phone');
  /** Closed without the tour. */
  readonly closed = output<void>();
  /** The visitor would like to be shown around. */
  readonly tour = output<void>();
}
