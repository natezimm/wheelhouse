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
    } @else if (calendar.undoable(); as change) {
      <div class="saving" role="status" aria-live="polite">
        <span>{{ change.label }}</span>
        <button type="button" [disabled]="!change.ready" (click)="undo()">Undo</button>
      </div>
    }
  `,
  styles: `
    /* A toast over the bottom of the calendar; each layout places it. */
    :host {
      display: block;
      pointer-events: none;
    }
    .saving {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 14px;
      min-height: 44px;
      box-sizing: border-box;
      padding: 4px 4px 4px 18px;
      color: var(--on-ink);
      background: var(--ink);
      border-radius: 24px;
      box-shadow: var(--toast-shadow);
      font-size: 14px;
      font-weight: 600;
    }
    .saving:not(:has(button)) {
      padding-right: 18px;
    }
    button {
      min-height: 44px;
      min-width: 44px;
      padding: 0 16px;
      border: 0;
      border-radius: 22px;
      background: var(--surface);
      color: var(--ink);
      font: 700 14px var(--font-body);
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    :host-context(app-wall-shell) .saving {
      min-height: 64px;
      padding-left: 26px;
      border-radius: 32px;
      font-size: 18px;
    }
    :host-context(app-wall-shell) .saving:not(:has(button)) {
      padding-right: 26px;
    }
    :host-context(app-wall-shell) button {
      min-height: 56px;
      min-width: 56px;
      padding: 0 22px;
      border-radius: 28px;
      font-size: 17px;
    }
  `,
})
export class CalendarSaveStatus {
  protected readonly calendar = inject(CalendarStore);
  protected uncertain(): boolean {
    return this.calendar.pending().some((op) => op.status === 'uncertain');
  }
  protected undo(): void {
    this.calendar.undo().subscribe({ error: () => {} });
  }
  protected check(): void {
    for (const op of this.calendar.pending().filter((op) => op.status === 'uncertain')) {
      this.calendar.retry(op.id).subscribe({ error: () => {} });
    }
  }
}
