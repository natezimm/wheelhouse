import { Component, inject } from '@angular/core';
import { SessionStore } from '../core/session';

/** Tells visitors to the public demo that nothing here is real or kept, or that it has no room. */
@Component({
  selector: 'app-demo-notice',
  template: `
    @if (session.isDemo()) {
      <span>Demo · your own copy of a fictional family, cleared after a day</span>
    } @else if (session.isDemoFull()) {
      <span>The demo is full right now. Please try again later.</span>
    }
  `,
  styles: `
    span {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 999px;
      background: var(--ink);
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
    }
  `,
})
export class DemoNotice {
  protected readonly session = inject(SessionStore);
}
