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
      <span class="full">{{ period().title }}</span><span class="brief">{{ period().brief }}</span>@if (period().year) {<span class="year"> {{ period().year }}</span>}
    </h1>
    <div class="status"><ng-content select="[status]" /></div>
    <ng-content select="[extras]" />
    <div class="actions">
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
    </div>
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
      border: var(--control-border);
      border-radius: var(--pill);
      background: var(--surface);
      box-shadow: var(--control-shadow);
      color: var(--ink);
      font-size: 15px;
      font-weight: 700;
    }

    /* Already on today: it stays put, quieter, so the toolbar never jumps. */
    .today:disabled {
      box-shadow: none;
      color: var(--muted);
      cursor: default;
    }

    .arrow {
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      border-radius: var(--pill);
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
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      letter-spacing: -0.01em;
      white-space: nowrap;
    }

    .year {
      font-weight: 400;
      color: var(--faint);
    }

    .brief {
      display: none;
    }

    .status {
      flex: 1 0 auto;
      margin-left: 12px;
      display: flex;
      align-items: center;
    }

    /* The view switch and Add event stay together, so neither is left alone on a line. */
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .add {
      height: 44px;
      margin-left: 6px;
      padding: 0 20px 0 16px;
      border: var(--primary-border);
      border-radius: var(--pill);
      background: var(--primary);
      box-shadow: var(--primary-shadow);
      color: var(--on-primary);
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .add svg {
      color: var(--primary-icon);
      width: 18px;
      height: 18px;
    }

    /* When the controls no longer fit one line, the view switch and Add event move to a second, on the right. */
    :host(.desktop) .actions {
      margin-left: auto;
    }

    /* A narrower desktop window keeps every control on one line by dropping words: the year, the
       long day and month names, and Add event's label. A connection problem takes a line of its own. */
    @media (max-width: 1180px) {
      :host(.desktop) h1 {
        font-size: 22px;
      }

      :host(.desktop) .full {
        display: none;
      }

      :host(.desktop) .brief {
        display: inline;
      }

      :host(.desktop) .status {
        margin-left: 4px;
      }

      :host(.desktop) .status:has(.pill) {
        order: 1;
        flex-basis: 100%;
        margin-left: 0;
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
      font-size: 18px;
    }

    :host(.wall) .arrow {
      width: 56px;
      height: 56px;
    }

    :host(.wall) .arrow svg {
      width: 26px;
      height: 26px;
    }

    :host(.wall) h1 {
      margin-left: 6px;
      font-size: 32px;
    }

    /* The connection gives way, ending its notice early, before any control does. The Live dot
       and its refresh button are short and never give way, so countdowns end their titles first. */
    :host(.wall) .status {
      flex: 1 0 auto;
      justify-content: center;
    }

    /* A connection problem takes the room it needs; anything in the extras slot gives way first. */
    :host(.wall) .status:has(.pill) {
      flex: 0 1 auto;
      min-width: 0;
    }

    :host(.wall) .view-switch {
      padding: 4px;
    }

    :host(.wall) .view-switch button {
      height: 56px;
      padding: 0 28px;
      font-size: 18px;
    }

    :host(.wall) .actions {
      gap: 10px;
    }

    :host(.wall) .add {
      height: 60px;
      padding: 0 28px 0 22px;
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
