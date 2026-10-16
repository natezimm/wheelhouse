import { Component, inject, input, model, output } from '@angular/core';
import { CalendarStore } from '../core/calendar';

export type WallView = 'day' | 'week' | 'month';

const VIEWS: { view: WallView; label: string }[] = [
  { view: 'day', label: 'Day' },
  { view: 'week', label: 'Week' },
  { view: 'month', label: 'Month' },
];

/** The bar above each of the wall's calendar views: arrows, what is shown, and the Day, Week and Month switch. */
@Component({
  selector: 'app-calendar-nav',
  template: `
    <button type="button" class="round" [attr.aria-label]="'Previous ' + unit()" (click)="previous.emit()">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
    </button>
    <button type="button" class="round" [attr.aria-label]="'Next ' + unit()" (click)="next.emit()">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
    </button>
    <h2>{{ label() }}</h2>
    @if (backLabel(); as back) {
      <button type="button" class="back" (click)="back$.emit()">{{ back }}</button>
    }
    @if (calendar.state().status === 'unavailable') {
      <span class="problem" role="status">Can't load the calendar right now.</span>
    }
    <div class="views" role="group" aria-label="View">
      @for (option of views; track option.view) {
        <button type="button" [attr.aria-pressed]="view() === option.view" (click)="view.set(option.view)">
          {{ option.label }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .round {
      width: 56px;
      height: 56px;
      border-radius: 28px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    h2 {
      margin: 0 0 0 10px;
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 500;
    }

    .back {
      height: 56px;
      margin-left: 8px;
      padding: 0 22px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--surface);
      color: var(--ink);
      font: 600 17px var(--font-body);
      cursor: pointer;
    }

    .problem {
      color: var(--warn);
      font-size: 16px;
      font-weight: 600;
    }

    .views {
      margin-left: auto;
      display: flex;
      padding: 4px;
      border-radius: 32px;
      background: #e6e2da;
    }

    .views button {
      height: 56px;
      padding: 0 26px;
      border: 0;
      border-radius: 28px;
      background: transparent;
      color: #4a4f57;
      font: 600 17px var(--font-body);
      cursor: pointer;
    }

    .views button[aria-pressed='true'] {
      background: var(--ink);
      color: #ffffff;
    }
  `,
})
export class CalendarNav {
  protected readonly calendar = inject(CalendarStore);
  protected readonly views = VIEWS;

  readonly view = model.required<WallView>();

  /** What is on screen, such as "Oct 12 – 18". */
  readonly label = input.required<string>();

  /** The word the arrows move by: day, week or month. */
  readonly unit = input.required<string>();

  /** The way back to today, such as "This week", or null when today is already shown. */
  readonly backLabel = input<string | null>(null);

  readonly previous = output();
  readonly next = output();
  readonly back$ = output({ alias: 'back' });
}
