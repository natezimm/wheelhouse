import { Component, inject } from '@angular/core';
import { SessionStore } from '../core/session';

/** Tells visitors to the public demo that nothing here is real or kept. */
@Component({
  selector: 'app-demo-notice',
  template: `
    @if (session.isDemo()) {
      <span>Demo · a fictional family, reset every night</span>
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
