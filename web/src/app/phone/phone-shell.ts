import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Clock } from '../core/clock';
import { StatusLine } from '../shared/status-line';

/** The phone layout's frame: today's date and connection status. Sized for a 390 px wide screen. */
@Component({
  selector: 'app-phone-shell',
  imports: [DatePipe, StatusLine],
  template: `
    <header>
      <span class="date">{{ clock.now() | date: 'EEE, MMM d' }}</span>
      <h1>Today</h1>
    </header>
    <app-status-line />
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 24px 18px 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    header {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .date {
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 34px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
  `,
})
export class PhoneShell {
  protected readonly clock = inject(Clock);
}
