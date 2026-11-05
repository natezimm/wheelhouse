import { Injector, afterNextRender } from '@angular/core';

/** Whether the keyboard has lost its place: nothing has focus, or what had it has left the page. */
export function focusLost(): boolean {
  const at = document.activeElement;
  return !at || at === document.body || !at.isConnected;
}

/**
 * Once the screen has redrawn, gives focus to an element if the change took it away from what had it,
 * such as a day's heading that opens that day in place of the week. Without this, the next Tab would
 * start again from the top of the page.
 */
export function keepFocus(injector: Injector, target: () => HTMLElement | null | undefined): void {
  afterNextRender(
    () => {
      if (focusLost()) {
        target()?.focus({ preventScroll: true });
      }
    },
    { injector },
  );
}
