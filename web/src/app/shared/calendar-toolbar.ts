import { Component, input, model, output } from '@angular/core';
import { CalendarView, Period, VIEWS } from '../core/calendar-period';

/**
 * The bar above the calendar on the wall and on a desktop: Today, the arrows, what is shown,
 * how up to date it is, then the Day, Week and Month switch and Add event. Put the connection
 * in the <code>status</code> slot and anything else for the right in the <code>extras</code> slot.
 */
@Component({
  selector: 'app-calendar-toolbar',
  host: { '[class]': 'layout()' },
  template: `
    <button type="button" class="today" [disabled]="period().isCurrent" (click)="today.emit()">Today</button>
    <button type="button" class="arrow" [attr.aria-label]="'Previous ' + period().unit" (click)="step.emit(-1)">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
    </button>
    <button type="button" class="arrow" [attr.aria-label]="'Next ' + period().unit" (click)="step.emit(1)">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
    </button>
    <h1>
      {{ period().title }}@if (period().year) {<span class="year"> {{ period().year }}</span>}
    </h1>
    <div class="status"><ng-content select="[status]" /></div>
    <ng-content select="[extras]" />
    <div class="view-switch" role="group" aria-label="View">
      @for (option of views; track option.view) {
        <button type="button" [attr.aria-pressed]="view() === option.view" (click)="view.set(option.view)">{{ option.label }}</button>
      }
    </div>
    @if (canAdd()) {
      <button type="button" class="add" (click)="add.emit()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
        <span class="label">Add event</span>
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    button {
      cursor: pointer;
      font-family: var(--font-body);
    }

    .today {
      height: 44px;
      padding: 0 18px;
      border: 1px solid var(--line);
      border-radius: 22px;
      background: var(--surface);
      color: var(--ink);
      font-size: 15px;
      font-weight: 700;
    }

    /* Already on today: it stays put, quieter, so the toolbar never jumps. */
    .today:disabled {
      color: var(--muted);
      cursor: default;
    }

    .arrow {
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: 22px;
      background: transparent;
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .arrow:hover {
      background: var(--track);
    }

    .arrow svg {
      width: 22px;
      height: 22px;
    }

    h1 {
      margin: 0 0 0 4px;
      font-family: var(--font-display);
      font-size: 26px;
      font-weight: 600;
      letter-spacing: -0.01em;
      white-space: nowrap;
    }

    .year {
      font-weight: 400;
      color: var(--faint);
    }

    .status {
      flex: 1 0 auto;
      margin-left: 12px;
      display: flex;
      align-items: center;
    }

    .add {
      height: 44px;
      margin-left: 6px;
      padding: 0 20px 0 16px;
      border: 0;
      border-radius: 22px;
      background: var(--ink);
      color: var(--on-ink);
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .add svg {
      width: 18px;
      height: 18px;
    }

    /* A narrower desktop window keeps every control by dropping words: the year, and Add event's label. */
    @media (max-width: 1180px) {
      :host(.desktop) h1 {
        font-size: 22px;
      }

      :host(.desktop) .year,
      :host(.desktop) .add .label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      :host(.desktop) .view-switch button {
        padding: 0 12px;
      }

      :host(.desktop) .add {
        width: 44px;
        padding: 0;
        justify-content: center;
      }
    }

    /* The wall, from across the room: 56 px controls and the connection in the middle. */
    :host(.wall) {
      flex-wrap: nowrap;
      gap: 10px;
    }

    :host(.wall) .today {
      height: 56px;
      padding: 0 26px;
      border-radius: 28px;
      font-size: 18px;
    }

    :host(.wall) .arrow {
      width: 56px;
      height: 56px;
      border-radius: 28px;
    }

    :host(.wall) .arrow svg {
      width: 26px;
      height: 26px;
    }

    :host(.wall) h1 {
      margin-left: 6px;
      font-size: 32px;
    }

    /* The connection gives way, ending its notice early, before any control does. */
    :host(.wall) .status {
      flex: 1 1 0;
      min-width: 0;
      justify-content: center;
    }

    :host(.wall) .view-switch {
      padding: 4px;
      border-radius: 32px;
    }

    :host(.wall) .view-switch button {
      height: 56px;
      padding: 0 28px;
      border-radius: 28px;
      font-size: 18px;
    }

    :host(.wall) .add {
      height: 60px;
      padding: 0 28px 0 22px;
      border-radius: 30px;
      font-size: 18px;
      gap: 10px;
    }

    :host(.wall) .add svg {
      width: 22px;
      height: 22px;
    }
  `,
})
export class CalendarToolbar {
  protected readonly views = VIEWS;

  readonly layout = input<'wall' | 'desktop'>('desktop');
  readonly view = model.required<CalendarView>();
  readonly period = input.required<Period>();

  /** Whether any calendar takes new events; a family with none has nothing to add to. */
  readonly canAdd = input(false);

  readonly today = output();
  /** An arrow: -1 for back a day, week or month, 1 for forward. */
  readonly step = output<number>();
  readonly add = output();
}
