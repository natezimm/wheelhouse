import { Component, output } from '@angular/core';
import { ModalFocus } from './modal-focus';

/** The keys a desktop window answers to, as `?` lists them. */
export const SHORTCUTS: readonly { keys: string[]; does: string }[] = [
  { keys: ['T'], does: 'Go to today' },
  { keys: ['J', 'N'], does: 'Next day, week or month' },
  { keys: ['K', 'P'], does: 'Previous day, week or month' },
  { keys: ['D'], does: 'Day view' },
  { keys: ['W'], does: 'Week view' },
  { keys: ['M'], does: 'Month view' },
  { keys: ['C'], does: 'New event' },
  { keys: ['/'], does: 'Search events' },
  { keys: ['E'], does: 'Edit the open event' },
  { keys: ['Delete'], does: 'Delete the open event' },
  { keys: ['?'], does: 'Show these shortcuts' },
];

export type Shortcut = 'today' | 'next' | 'previous' | 'day' | 'week' | 'month' | 'create' | 'search' | 'edit' | 'delete' | 'help';

const KEYS: Record<string, Shortcut> = {
  t: 'today',
  j: 'next',
  n: 'next',
  k: 'previous',
  p: 'previous',
  d: 'day',
  w: 'week',
  m: 'month',
  c: 'create',
  '/': 'search',
  e: 'edit',
  Delete: 'delete',
  Backspace: 'delete',
  '?': 'help',
};

/**
 * What a key press asks for, or null. Typing in a field, a key held with Ctrl, Alt or the Command
 * key, and a key something else already handled are never shortcuts.
 */
export function shortcutOf(event: KeyboardEvent): Shortcut | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
    return null;
  }
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) {
    return null;
  }
  return KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key] ?? null;
}

/** A small dialog over a desktop calendar listing its keyboard shortcuts. */
@Component({
  selector: 'app-shortcut-help',
  imports: [ModalFocus],
  host: { '(keydown.escape)': 'closed.emit()' },
  template: `
    <button type="button" class="scrim" tabindex="-1" aria-label="Close shortcuts" (click)="closed.emit()"></button>
    <section class="panel" appModalFocus tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <div class="top">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button type="button" class="close" aria-label="Close" (click)="closed.emit()">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
        </button>
      </div>
      <dl>
        @for (shortcut of shortcuts; track shortcut.does) {
          <div>
            <dt>
              @for (key of shortcut.keys; track key; let last = $last) {
                <kbd>{{ key }}</kbd>
                @if (!last) {
                  <span class="or">or</span>
                }
              }
            </dt>
            <dd>{{ shortcut.does }}</dd>
          </div>
        }
      </dl>
    </section>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .scrim {
      position: absolute;
      inset: 0;
      width: 100%;
      border: 0;
      background: var(--scrim);
      cursor: pointer;
    }

    .panel {
      position: relative;
      width: 380px;
      max-width: calc(100% - 32px);
      box-sizing: border-box;
      padding: 22px 24px 24px;
      border-radius: var(--card-radius);
      background: var(--surface);
      box-shadow: var(--drawer-shadow);
      color: var(--ink);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: -8px -10px 0 0;
    }

    h2 {
      margin: 0;
      font: 700 20px var(--font-display);
    }

    dl {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    dl div {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    dt {
      width: 110px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    dd {
      margin: 0;
      font-size: 15px;
    }

    kbd {
      min-width: 26px;
      height: 26px;
      padding: 0 7px;
      box-sizing: border-box;
      border: var(--control-border);
      border-radius: 7px;
      background: var(--ground);
      font: 700 13px var(--font-body);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .or {
      color: var(--muted);
      font-size: 13px;
    }

    .close {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 22px;
      background: var(--soft);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
  `,
})
export class ShortcutHelp {
  readonly closed = output<void>();
  protected readonly shortcuts = SHORTCUTS;
}
