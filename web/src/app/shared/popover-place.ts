/** The room kept between a popover, the control it opens from and the window's edges. */
const GAP = 8;

/**
 * Puts a popover shown in the top layer just under the control that opened it, centred on it, or
 * above it when the window has no room below, and always inside the window.
 */
export function placePopover(pop: HTMLElement, from: HTMLElement): void {
  const anchor = from.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, GAP), window.innerWidth - width - GAP);
  const below = anchor.bottom + GAP;
  const top = below + height <= window.innerHeight - GAP ? below : Math.max(anchor.top - GAP - height, GAP);
  pop.style.position = 'fixed';
  pop.style.left = `${Math.max(left, GAP)}px`;
  pop.style.top = `${top}px`;
}
