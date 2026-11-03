import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

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
 * change, and the few things worth trying that they would not find by looking. It never covers the
 * calendar on a phone (it sits above the view) and floats in a corner of a desktop window.
 */
@Component({
  selector: 'app-demo-welcome',
  imports: [RouterLink],
  host: { '[class.desktop]': "layout() === 'desktop'" },
  template: `
    <section class="panel" role="region" aria-labelledby="welcome-title">
      <button type="button" class="close" aria-label="Close the welcome" (click)="closed.emit()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
      <p class="eyebrow">Live demo</p>
      <h2 id="welcome-title">Meet the Marlowes</h2>
      <p class="lead">A fictional family's calendar, copied just for you. Change anything; it's cleared after a day.</p>
      <ul>
        @if (layout() === 'desktop') {
          <li>
            <span class="icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"></path></svg>
            </span>
            <span>Drag an event to a new time, or pull its bottom edge</span>
          </li>
          <li>
            <span class="icon" aria-hidden="true"><kbd>?</kbd></span>
            <span>Press <kbd>?</kbd> for keyboard shortcuts</span>
          </li>
        } @else {
          <li>
            <span class="icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>
            </span>
            <span>Tap an event for its details, or + to add one</span>
          </li>
        }
        <li>
          <span class="icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg>
          </span>
          <span><a routerLink="/wall" (click)="closed.emit()">Open the wall display</a>, made for a kitchen touch screen</span>
        </li>
        <li>
          <span class="icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5"></circle><circle cx="17.5" cy="10.5" r="1.5"></circle><circle cx="8.5" cy="7.5" r="1.5"></circle><circle cx="6.5" cy="12.5" r="1.5"></circle><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 22 10.7C22 5.9 17.5 2 12 2z"></path></svg>
          </span>
          <span><a routerLink="/settings" (click)="closed.emit()">Try a theme</a>: four looks, each with a night mode</span>
        </li>
      </ul>
      <button type="button" class="start" (click)="closed.emit()">Start exploring</button>
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

    ul {
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    li {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 15px;
      line-height: 1.35;
    }

    .icon {
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      display: grid;
      place-items: center;
      border-radius: 12px;
      background: var(--track);
      color: var(--ink);
    }

    .icon kbd {
      border: 0;
      background: none;
      padding: 0;
      font-weight: 700;
    }

    kbd {
      display: inline-block;
      min-width: 20px;
      padding: 0 5px;
      box-sizing: border-box;
      border: var(--control-border);
      border-radius: 6px;
      background: var(--ground);
      font: 600 13px/20px var(--font-body);
      text-align: center;
    }

    a {
      color: var(--accent);
      font-weight: 600;
    }

    .start {
      width: 100%;
      min-height: 48px;
      border: var(--primary-border);
      border-radius: var(--pill);
      background: var(--primary);
      color: var(--on-primary);
      box-shadow: var(--primary-shadow);
      font: 600 16px var(--font-body);
      cursor: pointer;
    }
  `,
})
export class DemoWelcome {
  readonly layout = input<'desktop' | 'phone'>('phone');
  readonly closed = output<void>();
}
