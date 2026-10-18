import { Component, inject } from '@angular/core';
import { CalendarStore } from '../core/calendar';

/** Save feedback belongs to both layouts, including when the editor has been left behind. */
@Component({
  selector: 'app-calendar-save-status',
  template: `
    @if (calendar.pending().length) {
      <div class="saving" role="status" aria-live="polite">
        @if (uncertain()) {
          <span>A calendar save needs checking.</span>
          <button type="button" (click)="check()">Check save</button>
        } @else {
          <span>Saving calendar…</span>
        }
      </div>
    } @else if (calendar.saveFailure(); as failure) {
      <div class="saving" role="alert">
        <span>{{ failure }}</span>
        <button type="button" (click)="calendar.dismissFailure()">Dismiss</button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .saving {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      color: var(--ink);
      background: var(--surface);
      border-radius: 12px;
      font-size: 14px;
    }
    button {
      min-height: 44px;
      min-width: 44px;
      padding: 8px 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    :host-context(app-wall-shell) .saving {
      font-size: 18px;
    }
    :host-context(app-wall-shell) button {
      min-height: 56px;
      min-width: 56px;
    }
  `,
})
export class CalendarSaveStatus {
  protected readonly calendar = inject(CalendarStore);
  protected uncertain(): boolean {
    return this.calendar.pending().some((op) => op.status === 'uncertain');
  }
  protected check(): void {
    for (const op of this.calendar.pending().filter((op) => op.status === 'uncertain')) {
      this.calendar.retry(op.id).subscribe({ error: () => {} });
    }
  }
}
