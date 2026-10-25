import { Component, computed, input } from '@angular/core';
import { avatarUrl } from '../core/avatars';

/**
 * What goes inside an avatar circle: the member's picture if they chose one, otherwise their
 * initial. The circle itself (size, member color, border) belongs to whoever places this.
 */
@Component({
  selector: 'app-avatar-face',
  // On one line, so the initial carries no spaces into the text around it.
  template: `@if (url(); as url) {<img [src]="url" [class.muted]="muted()" alt="" draggable="false" />} @else {<ng-container>{{ initial() }}</ng-container>}`,
  styles: `
    :host {
      display: contents;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      pointer-events: none;
    }

    img.muted {
      filter: grayscale(1);
      opacity: 0.55;
    }
  `,
})
export class AvatarFace {
  readonly initial = input.required<string>();
  readonly avatar = input<string | null | undefined>(null);
  /** Greys the picture out, as for a member whose events are hidden. */
  readonly muted = input(false);

  protected readonly url = computed(() => avatarUrl(this.avatar()));
}
