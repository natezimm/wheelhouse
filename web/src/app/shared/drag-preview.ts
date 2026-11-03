/**
 * A drag shown rather than described, for the demo's tour: a copy of an event on the grid lifts,
 * slides an hour and fades, while the event itself waits faintly where it is. Nothing is saved.
 */

/** The first writable event the Week or Day grid shows whole, if any. */
export function showableEvent(document: Document): HTMLElement | null {
  const events = Array.from(document.querySelectorAll<HTMLElement>('app-hour-grid .event.movable'));
  return (
    events.find((event) => {
      const box = event.getBoundingClientRect();
      const view = viewOf(event, document);
      return box.height > 0 && box.top >= view.top && box.bottom <= view.bottom;
    }) ?? null
  );
}

/** How far the copy slides: an hour later, or earlier when the grid shows no room below it. */
export function previewShift(block: HTMLElement, document: Document): number {
  const box = block.getBoundingClientRect();
  const step = Math.max(box.height, 48);
  return box.bottom + step <= viewOf(block, document).bottom ? step : -step;
}

/** Plays the drag once; the promise settles when the copy has gone. */
export function playDragPreview(block: HTMLElement, document: Document): Promise<void> {
  if (!block.animate) return Promise.resolve();
  const reduced = document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shift = previewShift(block, document);
  const ghost = block.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.tabIndex = -1;
  ghost.classList.add('drag-ghost');
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '5';
  ghost.style.boxShadow = 'var(--dialog-shadow)';
  block.after(ghost);
  const moves: Keyframe[] = reduced
    ? [{ opacity: 0.9, transform: `translateY(${shift}px)` }, { opacity: 0, transform: `translateY(${shift}px)` }]
    : [
        { opacity: 0, transform: 'translateY(0) scale(1)' },
        { opacity: 0.95, transform: 'translateY(-2px) scale(1.03)', offset: 0.15 },
        { opacity: 0.95, transform: `translateY(${shift}px) scale(1.03)`, offset: 0.6 },
        { opacity: 0.95, transform: `translateY(${shift}px) scale(1)`, offset: 0.8 },
        { opacity: 0, transform: `translateY(${shift}px) scale(1)` },
      ];
  block.animate([{ opacity: 1 }, { opacity: 0.35, offset: 0.15 }, { opacity: 0.35, offset: 0.8 }, { opacity: 1 }], { duration: 2200 });
  return ghost
    .animate(moves, { duration: 2200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' })
    .finished.then(
      () => undefined,
      () => undefined,
    )
    .finally(() => ghost.remove());
}

function viewOf(event: HTMLElement, document: Document): DOMRect {
  return (event.closest('.body') ?? document.documentElement).getBoundingClientRect();
}
