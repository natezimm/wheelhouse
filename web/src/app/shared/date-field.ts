import { Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Day, addDays, addMonths, formatDay, startOfMonth, startOfWeek } from '../core/days';
import { placePopover } from './popover-place';

/**
 * A day chosen from a month calendar that opens under it, as the phone's own date picker does,
 * for the editor the wall and a desktop window share. Nothing is typed: a day is tapped or clicked,
 * or picked with the arrow keys and Enter, so there is nothing to check.
 */
@Component({
  selector: 'app-date-field',
  host: { '[class.field]': "look() === 'field'" },
  template: `
    <button
      #face
      type="button"
      class="face"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label() + ', ' + longDay(day())"
      [disabled]="disabled()"
      (click)="toggle()"
    >{{ text() ?? shortDay(day()) }}</button>
    @if (open()) {
      <div
        #pop
        class="pop"
        popover="auto"
        role="dialog"
        [attr.aria-label]="label()"
        (toggle)="toggled($event)"
        (keydown.escape)="$event.stopPropagation(); close(true)"
      >
        <div class="head">
          <button type="button" class="step" aria-label="Previous month" (click)="moveMonth(-1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
          </button>
          <span class="month" aria-live="polite">{{ monthName() }}</span>
          <button type="button" class="step" aria-label="Next month" (click)="moveMonth(1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
          </button>
        </div>
        <div class="grid" role="grid" [attr.aria-label]="monthName()" (keydown)="key($event)">
          <div class="row" role="row">
            @for (name of weekdays(); track name.long) {
              <span class="dow" role="columnheader" [attr.aria-label]="name.long">{{ name.short }}</span>
            }
          </div>
          @for (week of weeks(); track week[0]) {
            <div class="row" role="row">
              @for (cell of week; track cell) {
                <span role="gridcell">
                  <button
                    type="button"
                    class="day"
                    [class.outside]="cell.slice(0, 7) !== shown().slice(0, 7)"
                    [class.today]="cell === today()"
                    [attr.data-day]="cell"
                    [attr.aria-pressed]="cell === day()"
                    [attr.aria-current]="cell === today() ? 'date' : null"
                    [attr.aria-label]="longDay(cell)"
                    [attr.tabindex]="cell === focus() ? 0 : -1"
                    [disabled]="!allowed(cell)"
                    (click)="pick(cell)"
                  >{{ +cell.slice(8) }}</button>
                </span>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      flex: 1;
      min-width: 0;
      align-self: stretch;
      display: flex;
    }

    .face {
      flex: 1;
      min-width: 0;
      margin: 0;
      padding: 0 6px;
      border: 0;
      border-radius: 10px;
      background: none;
      color: var(--ink);
      font: 600 19px var(--font-body);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }

    .face:hover:not(:disabled),
    .face[aria-expanded='true'] {
      background: var(--surface);
    }

    .face:disabled {
      cursor: default;
    }

    .pop {
      inset: auto;
      margin: 0;
      padding: 16px;
      box-sizing: border-box;
      /* Seven 56 px days, the wall's smallest touch target, and the padding. */
      width: min(424px, calc(100vw - 16px));
      border: var(--card-border);
      border-radius: var(--card-radius);
      background: var(--surface);
      color: var(--ink);
      box-shadow: var(--dialog-shadow);
    }

    .head {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }

    .month {
      flex: 1;
      text-align: center;
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
    }

    .step {
      width: 56px;
      height: 56px;
      border: 0;
      border-radius: 28px;
      background: var(--soft);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .row {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
    }

    .dow {
      padding: 6px 0;
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--muted);
    }

    [role='gridcell'] {
      display: flex;
      justify-content: center;
    }

    /* 56 px on the wall; on a phone as wide as its column allows, never under the phone's 44 px. */
    .day {
      width: 100%;
      max-width: 56px;
      aspect-ratio: 1;
      height: auto;
      margin: 0;
      border: 0;
      border-radius: 28px;
      background: none;
      color: var(--ink);
      font: 600 17px var(--font-body);
      cursor: pointer;
    }

    .day:hover:not(:disabled) {
      background: var(--soft);
    }

    .day.outside {
      color: var(--muted);
    }

    .day.today {
      box-shadow: inset 0 0 0 2px var(--ink);
    }

    .day[aria-pressed='true'] {
      background: var(--primary);
      color: var(--on-primary);
      font-weight: 700;
    }

    .day:disabled {
      opacity: 0.35;
      cursor: default;
    }

    /* In a phone form's field: the field's own box, text from its start, and the whole box a button. */
    :host(.field) {
      align-self: center;
    }

    :host(.field) .face {
      padding: 0;
      text-align: start;
      align-items: flex-start;
      font: 400 16px var(--font-body);
    }

    :host(.field) .face:hover,
    :host(.field) .face[aria-expanded='true'] {
      background: none;
    }

    :host(.field) .face:focus-visible {
      outline: none;
    }

    :host(.field) .face::after {
      content: '';
      position: absolute;
      inset: 0;
    }
  `,
})
export class DateField {
  /** The day chosen. */
  readonly day = input.required<Day>();
  /** What the field is, such as "Starts", for its button and the calendar. */
  readonly label = input.required<string>();
  /** What the button shows, when not the day itself. */
  readonly text = input<string | null>(null);
  /** The first day that can be chosen. */
  readonly min = input<Day | null>(null);
  readonly disabled = input(false);
  /** 'stepper' sits centred between a stepper's buttons; 'field' fills a phone form's field, which it makes all one button. */
  readonly look = input<'stepper' | 'field'>('stepper');
  readonly weekStartsOn = input<'Sunday' | 'Monday'>('Monday');
  /** The family's today, ringed in the calendar. */
  readonly today = input<Day | null>(null);

  readonly dayChange = output<Day>();

  private readonly injector = inject(Injector);

  protected readonly open = signal(false);
  /** The day the keyboard is on, whose month is shown. */
  protected readonly focus = signal<Day>('');
  protected readonly shown = computed(() => startOfMonth(this.focus() || this.day()));

  private readonly faceButton = viewChild.required<ElementRef<HTMLButtonElement>>('face');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');

  protected readonly weekdays = computed(() => {
    const first = startOfWeek('2026-10-12', this.weekStartsOn());
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(first, i);
      return { short: formatDay(day, { weekday: 'narrow' }), long: formatDay(day, { weekday: 'long' }) };
    });
  });

  /** Six weeks from the week holding the month's first day, so the calendar never changes height. */
  protected readonly weeks = computed(() => {
    const first = startOfWeek(this.shown(), this.weekStartsOn());
    return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  });

  protected readonly monthName = computed(() => formatDay(this.shown(), { month: 'long', year: 'numeric' }));

  protected shortDay(day: Day): string {
    return formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  protected longDay(day: Day): string {
    return formatDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  protected allowed(day: Day): boolean {
    const min = this.min();
    return !min || day >= min;
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(false);
      return;
    }
    this.focus.set(this.day());
    this.open.set(true);
    afterNextRender(() => {
      const pop = this.pop()?.nativeElement;
      if (!pop) return;
      pop.showPopover?.();
      placePopover(pop, this.faceButton().nativeElement);
      this.focusDay();
    }, { injector: this.injector });
  }

  protected toggled(event: Event): void {
    if ((event as ToggleEvent).newState === 'closed') {
      this.open.set(false);
    }
  }

  close(refocus: boolean): void {
    this.pop()?.nativeElement.hidePopover?.();
    this.open.set(false);
    if (refocus) {
      this.faceButton().nativeElement.focus();
    }
  }

  protected pick(day: Day): void {
    if (!this.allowed(day)) return;
    if (day !== this.day()) {
      this.dayChange.emit(day);
    }
    this.close(true);
  }

  protected moveMonth(by: number): void {
    const target = addMonths(this.shown(), by);
    // The same date in the new month, or its last day.
    const date = Math.min(+this.focus().slice(8), +addDays(addMonths(target, 1), -1).slice(8));
    this.focus.set(`${target.slice(0, 8)}${String(date).padStart(2, '0')}`);
  }

  /** Arrow keys move a day or a week, Page Up and Down a month, Home and End to the week's ends. */
  protected key(event: KeyboardEvent): void {
    const focus = this.focus();
    const weekStart = startOfWeek(focus, this.weekStartsOn());
    const moves: Record<string, () => Day> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => weekStart,
      End: () => addDays(weekStart, 6),
      PageUp: () => { this.moveMonth(-1); return this.focus(); },
      PageDown: () => { this.moveMonth(1); return this.focus(); },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    this.focus.set(move());
    afterNextRender(() => this.focusDay(), { injector: this.injector });
  }

  private focusDay(): void {
    this.pop()?.nativeElement.querySelector<HTMLElement>(`[data-day="${this.focus()}"]`)?.focus();
  }
}
