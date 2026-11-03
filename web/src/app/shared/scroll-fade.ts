import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Fades a row that scrolls sideways at whichever edge has more to show, so a cut-off chip reads
 * as "there is more this way" rather than as a clipped one. Sets <code>data-fade</code> to
 * start, end or both; the fade itself is in styles.css.
 */
@Directive({ selector: '[appScrollFade]' })
export class ScrollFade {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const update = () => this.update();
      this.host.addEventListener('scroll', update, { passive: true });
      const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
      const observeChildren = () => {
        resized?.disconnect();
        resized?.observe(this.host);
        for (const child of Array.from(this.host.children)) {
          resized?.observe(child);
        }
        update();
      };
      const changed = typeof MutationObserver === 'undefined' ? null : new MutationObserver(observeChildren);
      changed?.observe(this.host, { childList: true });
      observeChildren();
      destroyRef.onDestroy(() => {
        this.host.removeEventListener('scroll', update);
        resized?.disconnect();
        changed?.disconnect();
      });
    });
  }

  private update(): void {
    const { scrollLeft, scrollWidth, clientWidth } = this.host;
    // Only a row that scrolls fades (the same row on the wall wraps or fits instead), with a
    // pixel of slack, since a scrolled position can land a fraction short of the end.
    const scrolls = ['auto', 'scroll'].includes(getComputedStyle(this.host).overflowX);
    const start = scrolls && scrollLeft > 1;
    const end = scrolls && scrollLeft + clientWidth < scrollWidth - 1;
    const fade = start && end ? 'both' : start ? 'start' : end ? 'end' : null;
    if (fade) {
      this.host.dataset['fade'] = fade;
    } else {
      delete this.host.dataset['fade'];
    }
  }
}
