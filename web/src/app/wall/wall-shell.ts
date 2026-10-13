import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Clock } from '../core/clock';
import { StatusLine } from '../shared/status-line';

/** The wall display's frame: date, clock and connection status. Sized for 1920 × 1080. */
@Component({
  selector: 'app-wall-shell',
  imports: [DatePipe, StatusLine],
  template: `
    <header>
      <h1>{{ clock.now() | date: 'EEEE, MMMM d' }}</h1>
      <span class="time">{{ clock.now() | date: 'h:mm a' }}</span>
    </header>
    <app-status-line />
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 28px 36px 24px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    header {
      display: flex;
      align-items: baseline;
      gap: 20px;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 52px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .time {
      font-family: var(--font-display);
      font-size: 34px;
      color: var(--muted);
    }
  `,
})
export class WallShell {
  protected readonly clock = inject(Clock);
}
