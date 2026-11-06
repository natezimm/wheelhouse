import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild, viewChildren } from '@angular/core';
import { clockLabel } from '../core/event-draft';
import { placePopover } from './popover-place';

/** The height of one row of a wheel, the wall's smallest touch target. */
const ROW = 56;

/** How long a wheel stays still before the time under its band is taken. */
const SETTLE_MS = 120;

let wheels = 0;

interface Column {
  name: string;
  options: { label: string; value: number }[];
  selected: number;
}

/**
 * A time chosen on scrolling wheels of hours, minutes and am or pm that open under it, as a
 * phone's own time picker does, for the editor the wall and a desktop window share. Nothing is
 * typed: a wheel is scrolled, or a time tapped or clicked, or picked with the arrow keys, and the
 * time under the band is taken as each wheel comes to rest.
 */
@Component({
  selector: 'app-time-wheel',
  host: { '[class.field]': "look() === 'field'" },
  template: `
    <button
      #face
      type="button"
      class="face"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label() + ', ' + clockLabel(time())"
      [disabled]="disabled()"
      (click)="toggle()"
    >
      {{ clockLabel(time()) }}
      @if (note(); as note) {
        <small>{{ note }}</small>
      }
    </button>
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
        <div class="wheels">
          <span class="band" aria-hidden="true"></span>
          @for (column of columns(); track column.name; let c = $index) {
            <div
              #wheel
              class="wheel"
              role="listbox"
              tabindex="0"
              [attr.aria-label]="column.name"
              [attr.aria-activedescendant]="id + '-' + c + '-' + column.selected"
              (scroll)="scrolled(c)"
              (wheel)="turning.delete(c)"
              (pointerdown)="turning.delete(c)"
              (touchstart)="turning.delete(c)"
              (keydown)="key($event, c)"
            >
              @for (option of column.options; track option.value; let i = $index) {
                <div
                  class="option"
                  role="option"
                  [id]="id + '-' + c + '-' + i"
                  [attr.aria-selected]="i === column.selected"
                  (click)="choose(c, i, true)"
                >{{ option.label }}</div>
              }
            </div>
          }
        </div>
        <button type="button" class="done" (click)="close(true)">Done</button>
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
      padding: 0;
      border: 0;
      border-radius: 10px;
      background: none;
      color: var(--ink);
      font: 600 19px/1.1 var(--font-body);
      white-space: nowrap;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .face:hover:not(:disabled),
    .face[aria-expanded='true'] {
      background: var(--surface);
    }

    .face small {
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
    }

    .pop {
      inset: auto;
      margin: 0;
      padding: 16px;
      box-sizing: border-box;
      width: 332px;
      max-width: calc(100vw - 16px);
      border: var(--card-border);
      border-radius: var(--card-radius);
      background: var(--surface);
      color: var(--ink);
      box-shadow: var(--dialog-shadow);
    }

    .wheels {
      position: relative;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
    }

    /* The band the chosen time sits in, behind the wheels. */
    .band {
      position: absolute;
      inset: ${ROW * 2}px 0 auto;
      height: ${ROW}px;
      border-radius: 14px;
      background: var(--soft);
      pointer-events: none;
    }

    .wheel {
      position: relative;
      height: ${ROW * 5}px;
      box-sizing: border-box;
      padding: ${ROW * 2}px 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      scroll-snap-type: y mandatory;
      scrollbar-width: none;
      border-radius: 14px;
      mask-image: linear-gradient(transparent, #000 35%, #000 65%, transparent);
    }

    .wheel::-webkit-scrollbar {
      display: none;
    }

    .option {
      height: ${ROW}px;
      display: flex;
      align-items: center;
      justify-content: center;
      scroll-snap-align: center;
      font: 500 22px var(--font-body);
      font-variant-numeric: tabular-nums;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
    }

    .option[aria-selected='true'] {
      color: var(--ink);
      font-weight: 700;
    }

    .done {
      width: 100%;
      height: 56px;
      margin-top: 12px;
      border: var(--primary-border);
      border-radius: var(--pill);
      background: var(--primary);
      box-shadow: var(--primary-shadow);
      color: var(--on-primary);
      font: 700 18px var(--font-body);
      cursor: pointer;
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
export class TimeWheel {
  /** The time chosen, as 'HH:mm'. */
  readonly time = input.required<string>();
  /** What the field is, such as "Start time", for its button and the wheels. */
  readonly label = input.required<string>();
  /** A word under the time, such as the day an end falls on. */
  readonly note = input<string | null>(null);
  readonly disabled = input(false);
  /** 'stepper' sits centred between a stepper's buttons; 'field' fills a phone form's field, which it makes all one button. */
  readonly look = input<'stepper' | 'field'>('stepper');

  readonly timeChange = output<string>();

  protected readonly clockLabel = clockLabel;
  protected readonly id = `wheel-${++wheels}`;
  protected readonly open = signal(false);

  private readonly injector = inject(Injector);
  private readonly faceButton = viewChild.required<ElementRef<HTMLButtonElement>>('face');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');
  private readonly wheelList = viewChildren<ElementRef<HTMLElement>>('wheel');
  /** Each wheel's pending settle, while it is moving. */
  private readonly settling = new Map<number, ReturnType<typeof setTimeout>>();
  /** The row each wheel is being turned to after a tap or a key, whose scrolling is not a choice. */
  protected readonly turning = new Map<number, number>();

  /** Hours 1 to 12, minutes in fives (and the time's own minute when it is not one), and am or pm. */
  protected readonly columns = computed<Column[]>(() => {
    const [hours, minutes] = this.time().split(':').map(Number);
    const fives = Array.from({ length: 12 }, (_, i) => i * 5);
    const minuteValues = fives.includes(minutes) ? fives : [...fives, minutes].sort((a, b) => a - b);
    return [
      { name: 'Hour', options: Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), value: i + 1 })), selected: (hours % 12 || 12) - 1 },
      { name: 'Minute', options: minuteValues.map((value) => ({ label: String(value).padStart(2, '0'), value })), selected: minuteValues.indexOf(minutes) },
      { name: 'am or pm', options: [{ label: 'am', value: 0 }, { label: 'pm', value: 12 }], selected: hours < 12 ? 0 : 1 },
    ];
  });

  constructor() {
    // A time changed from outside, such as by the steppers, turns the wheels to it.
    effect(() => {
      this.time();
      if (untracked(this.open)) {
        afterNextRender(() => this.turnWheels(false), { injector: this.injector });
      }
    });
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(false);
      return;
    }
    this.open.set(true);
    afterNextRender(() => {
      const pop = this.pop()?.nativeElement;
      if (!pop) return;
      pop.showPopover?.();
      placePopover(pop, this.faceButton().nativeElement);
      this.turnWheels(false);
      this.wheelList()[0]?.nativeElement.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  protected toggled(event: Event): void {
    if ((event as ToggleEvent).newState === 'closed') {
      this.clearSettling();
      this.open.set(false);
    }
  }

  close(refocus: boolean): void {
    this.pop()?.nativeElement.hidePopover?.();
    this.clearSettling();
    this.open.set(false);
    if (refocus) {
      this.faceButton().nativeElement.focus();
    }
  }

  /** Takes the row a wheel comes to rest on. */
  protected scrolled(column: number): void {
    clearTimeout(this.settling.get(column));
    this.settling.set(column, setTimeout(() => {
      this.settling.delete(column);
      const wheel = this.wheelList()[column]?.nativeElement;
      if (!wheel) return;
      const row = Math.round(wheel.scrollTop / ROW);
      if (this.turning.has(column)) {
        // Still on its way to a row chosen by a tap or key; that row is already taken.
        if (this.turning.get(column) === row) this.turning.delete(column);
        return;
      }
      this.choose(column, row, false);
    }, SETTLE_MS));
  }

  protected key(event: KeyboardEvent, column: number): void {
    const { options, selected } = this.columns()[column];
    const to: Record<string, number> = { ArrowUp: selected - 1, ArrowDown: selected + 1, Home: 0, End: options.length - 1, PageUp: selected - 3, PageDown: selected + 3 };
    if (!(event.key in to)) return;
    event.preventDefault();
    this.choose(column, to[event.key], true);
  }

  /** Puts a wheel on one of its rows, and turns it there when it was not scrolled there. */
  protected choose(column: number, index: number, turn: boolean): void {
    const columns = this.columns();
    const options = columns[column].options;
    const at = Math.min(Math.max(index, 0), options.length - 1);
    const values = columns.map((c, i) => (i === column ? options[at] : c.options[c.selected]).value);
    const [hour, minute, half] = values;
    const time = `${String((hour % 12) + half).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (time !== this.time()) {
      this.timeChange.emit(time);
    }
    if (turn) {
      clearTimeout(this.settling.get(column));
      this.settling.delete(column);
      this.turning.set(column, at);
      afterNextRender(() => this.turnWheels(true), { injector: this.injector });
    }
  }

  /** Scrolls every wheel that is not moving to the time's row. */
  private turnWheels(smooth: boolean): void {
    const wheels = this.wheelList();
    this.columns().forEach((column, i) => {
      const wheel = wheels[i]?.nativeElement;
      if (!wheel || this.settling.has(i)) return;
      const top = column.selected * ROW;
      if (Math.abs(wheel.scrollTop - top) > 1) {
        wheel.scrollTo?.({ top, behavior: smooth ? 'smooth' : 'instant' });
      } else {
        this.turning.delete(i);
      }
    });
  }

  private clearSettling(): void {
    this.settling.forEach((timer) => clearTimeout(timer));
    this.settling.clear();
    this.turning.clear();
  }
}
