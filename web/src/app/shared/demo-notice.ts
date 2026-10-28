import { Component, inject, input } from '@angular/core';
import { SessionStore } from '../core/session';

/** Tells visitors to the public demo that nothing here is real or kept, or that it could not start. */
@Component({
  selector: 'app-demo-notice',
  template: `
    @if (session.isDemo()) {
      @if (short()) {
        <span title="Your own copy of a fictional family, cleared after a day">Demo</span>
      } @else {
        <span>Demo · your own copy of a fictional family, cleared after a day</span>
      }
    } @else if (session.demoUnavailable() === 'busy') {
      <span>Too many new demo visits from your network. Please try again later.</span>
    } @else if (session.demoUnavailable() === 'failed') {
      <span>The demo could not start. Please reload to try again.</span>
    }
  `,
  styles: `
    span {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 999px;
      background: var(--ink);
      color: var(--on-ink);
      font-size: 14px;
      font-weight: 600;
    }
  `,
})
export class DemoNotice {
  /** Just "Demo", for the desktop rail. */
  readonly short = input(false);
  protected readonly session = inject(SessionStore);
}
