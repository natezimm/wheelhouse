import { Directive, ElementRef, OnDestroy, afterNextRender, inject } from '@angular/core';

/** What each open dialog was opened from, so a dialog opened from another hands focus back past it. */
const openers = new WeakMap<Element, HTMLElement>();

/** The opener of a dialog that just closed, for one opened in its place, such as the editor that Edit opens. */
let handoff: HTMLElement | null = null;

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// :disabled in the filter below also catches controls inside a disabled fieldset, as while a save is going.

/**
 * Keeps the keyboard inside a dialog while it is open: Tab and Shift+Tab go round its controls,
 * focus starts inside it, and when it closes focus goes back to what opened it, such as the
 * event on the grid. Put it on the dialog's panel; give the panel tabindex="-1" so it can take
 * focus itself when nothing in it should, like a form that would raise a touch keyboard.
 */
@Directive({
  selector: '[appModalFocus]',
  host: { '(keydown)': 'keep($event)' },
})
export class ModalFocus implements OnDestroy {
  private readonly panel: HTMLElement = inject(ElementRef).nativeElement;

  constructor() {
    const active = document.activeElement;
    const within = active?.closest('[data-modal]');
    const opener = within ? openers.get(within) : active instanceof HTMLElement && active !== document.body ? active : handoff;
    if (opener) {
      openers.set(this.panel, opener);
    }
    this.panel.setAttribute('data-modal', '');
    afterNextRender(() => {
      if (!this.panel.contains(document.activeElement)) {
        this.panel.focus({ preventScroll: true });
      }
    });
  }

  protected keep(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }
    const stops = Array.from(this.panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((stop) => !stop.matches(':disabled') && (stop.checkVisibility?.() ?? true));
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const at = document.activeElement;
    if (event.shiftKey && (at === first || at === this.panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === last) {
      event.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    const opener = openers.get(this.panel) ?? null;
    handoff = opener;
    // Only if nothing else has taken focus meanwhile, such as the editor that Edit opens.
    queueMicrotask(() => {
      if (handoff === opener) {
        handoff = null;
      }
      const at = document.activeElement;
      if (opener?.isConnected && (!at || at === document.body || !at.isConnected)) {
        opener.focus({ preventScroll: true });
      }
    });
  }
}
