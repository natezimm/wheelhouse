import { DOCUMENT } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FamilyStore, Theme } from '../core/family';
import { THEMES, ThemeService } from '../core/theme';

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
            <span class="text">Drag an event to a new time, or pull its bottom edge</span>
            <button type="button" class="show" (click)="showDrag()">Show me</button>
          </li>
          @if (dragHint()) {
            <li class="hint" role="status">{{ dragHint() }}</li>
          }
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
      </ul>
      <!-- Each look is drawn in its own tokens, and a tap puts it on the calendar behind the card at once. -->
      <div class="themes" role="group" aria-labelledby="welcome-themes">
        <p id="welcome-themes" class="label">Try a look</p>
        <div class="swatches">
          @for (look of themes; track look.value) {
            <button
              type="button"
              class="swatch"
              [attr.data-theme]="look.value.toLowerCase()"
              [attr.aria-pressed]="look.value === current()"
              [disabled]="saving()"
              (click)="pick(look.value)"
            >
              <span class="sample" aria-hidden="true"><span class="bar"></span><span class="bar short"></span></span>
              <span class="name">{{ look.name }}</span>
            </button>
          }
        </div>
      </div>
      <a class="wall" routerLink="/wall" (click)="closed.emit()">
        <img src="welcome-wall.webp" width="320" height="180" alt="" />
        <span class="wall-label">Open the wall display <span class="sub">made for a kitchen touch screen</span></span>
      </a>
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

    .text {
      flex: 1;
    }

    .show {
      flex-shrink: 0;
      min-height: 44px;
      padding: 0 14px;
      border: var(--control-border);
      border-radius: var(--pill);
      background: var(--surface);
      color: var(--ink);
      font: 600 14px var(--font-body);
      cursor: pointer;
    }

    .hint {
      padding-left: 48px;
      font-size: 13px;
      color: var(--muted);
    }

    .themes {
      margin: 0 0 14px;
    }

    .label {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 700;
      color: var(--muted);
    }

    .swatches {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    /* A swatch carries its own data-theme, so it is drawn in that look's tokens. */
    .swatch {
      min-height: 64px;
      padding: 6px 4px 5px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      border: var(--card-border);
      border-radius: var(--card-radius);
      background: var(--ground);
      color: var(--ink);
      font: 600 12px var(--font-body);
      cursor: pointer;
    }

    .swatch[aria-pressed='true'] {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .sample {
      width: 100%;
      height: 26px;
      box-sizing: border-box;
      padding: 5px 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-radius: var(--event-radius-small);
      background: var(--surface);
    }

    .bar {
      height: 6px;
      border-radius: 3px;
      background: var(--accent);
    }

    .bar.short {
      width: 60%;
      background: var(--line);
    }

    .wall {
      margin: 0 0 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px;
      border: var(--card-border);
      border-radius: var(--card-radius);
      background: var(--ground);
      color: var(--ink);
      text-decoration: none;
    }

    .wall img {
      width: 112px;
      height: auto;
      flex-shrink: 0;
      border-radius: var(--event-radius-small);
      box-shadow: var(--card-shadow);
    }

    .wall-label {
      display: flex;
      flex-direction: column;
      font-size: 15px;
      font-weight: 600;
      color: var(--accent);
    }

    .sub {
      font-size: 13px;
      font-weight: 400;
      color: var(--muted);
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

  private readonly document = inject(DOCUMENT);
  private readonly family = inject(FamilyStore);
  private readonly look = inject(ThemeService);

  protected readonly themes = THEMES;
  protected readonly current = this.look.theme;
  protected readonly saving = signal(false);
  protected readonly dragHint = signal<string | null>(null);

  constructor() {
    for (const theme of THEMES) this.look.loadFonts(theme.value);
  }

  /** Puts a look on the visitor's own copy, as Settings would; the calendar behind the card changes at once. */
  protected pick(theme: Theme): void {
    const family = this.family.family();
    if (!family || theme === family.theme) return;
    this.saving.set(true);
    this.family.saveTheme(theme, family.nightMode).subscribe({
      next: () => this.saving.set(false),
      error: () => this.saving.set(false),
    });
  }

  /**
   * Shows a drag rather than describing one: a copy of an event on the grid lifts, slides an hour
   * later and fades, while the event itself waits faintly where it is. Nothing is saved.
   */
  protected showDrag(): void {
    const block = Array.from(this.document.querySelectorAll<HTMLElement>('app-hour-grid .event.movable')).find((event) => {
      // One the grid shows whole.
      const box = event.getBoundingClientRect();
      const view = (event.closest('.body') ?? this.document.documentElement).getBoundingClientRect();
      return box.height > 0 && box.top >= view.top && box.bottom <= view.bottom;
    });
    if (!block?.animate) {
      this.dragHint.set('Switch to Week or Day to see it, then drag any event.');
      return;
    }
    this.dragHint.set(null);
    const reduced = this.document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ghost = block.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    ghost.classList.add('welcome-ghost');
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '5';
    ghost.style.boxShadow = 'var(--dialog-shadow)';
    block.after(ghost);
    // It slides an hour later, or earlier when the grid shows no room below it.
    const view = (block.closest('.body') ?? this.document.documentElement).getBoundingClientRect();
    const box = block.getBoundingClientRect();
    const step = Math.max(box.height, 48);
    const hour = box.bottom + step <= view.bottom ? step : -step;
    const moves: Keyframe[] = reduced
      ? [{ opacity: 0.9, transform: `translateY(${hour}px)` }, { opacity: 0, transform: `translateY(${hour}px)` }]
      : [
          { opacity: 0, transform: 'translateY(0) scale(1)' },
          { opacity: 0.95, transform: 'translateY(-2px) scale(1.03)', offset: 0.15 },
          { opacity: 0.95, transform: `translateY(${hour}px) scale(1.03)`, offset: 0.6 },
          { opacity: 0.95, transform: `translateY(${hour}px) scale(1)`, offset: 0.8 },
          { opacity: 0, transform: `translateY(${hour}px) scale(1)` },
        ];
    block.animate([{ opacity: 1 }, { opacity: 0.35, offset: 0.15 }, { opacity: 0.35, offset: 0.8 }, { opacity: 1 }], { duration: 2200 });
    ghost.animate(moves, { duration: 2200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }).finished.finally(() => ghost.remove());
  }
}
