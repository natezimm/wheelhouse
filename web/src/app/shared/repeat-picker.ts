import { Component, computed, input, output, signal } from '@angular/core';
import { Day, addDays, formatDay } from '../core/days';
import {
  RepeatRule,
  WEEKDAYS,
  Weekday,
  canonicalRule,
  describeRule,
  formatRule,
  parseRule,
  placeInMonth,
  presetOf,
  presetsFor,
  weekdayCode,
} from '../core/repeat-rule';

const UNITS = [
  { freq: 'DAILY', one: 'day', many: 'days' },
  { freq: 'WEEKLY', one: 'week', many: 'weeks' },
  { freq: 'MONTHLY', one: 'month', many: 'months' },
  { freq: 'YEARLY', one: 'year', many: 'years' },
] as const;

const WEEKDAY_LETTERS: Record<Weekday, [string, string]> = {
  MO: ['M', 'Monday'], TU: ['T', 'Tuesday'], WE: ['W', 'Wednesday'], TH: ['T', 'Thursday'], FR: ['F', 'Friday'], SA: ['S', 'Saturday'], SU: ['S', 'Sunday'],
};

/**
 * The Repeat row of the event editors: the usual repeats in one tap, and Custom for every N days,
 * weeks, months or years, on chosen weekdays or a weekday's place in the month, ending never, on a
 * day or after a number of times. The wall gets segments and steppers sized for touch; the phone
 * gets its list and form fields. Every rule it gives out is written as canonicalRule writes it.
 */
@Component({
  selector: 'app-repeat-picker',
  template: `
    @if (layout() === 'wall') {
      <div class="segments" role="group" aria-label="Repeat">
        @for (preset of wallPresets(); track preset.id) {
          <button type="button" [attr.aria-pressed]="!customOpen() && chosen()?.id === preset.id" (click)="choose(preset.rule)">{{ preset.short }}</button>
        }
        <button type="button" [attr.aria-pressed]="customOpen()" (click)="openCustom()">Custom</button>
      </div>
    } @else {
      <label class="field">
        Repeat
        <select aria-label="Repeat" (change)="pick($any($event.target).value)">
          @for (preset of presets(); track preset.id) {
            <option [value]="preset.id" [selected]="!customOpen() && chosen()?.id === preset.id">{{ preset.label }}</option>
          }
          <option value="custom" [selected]="customOpen()">{{ customOpen() && rule() ? said() : 'Custom…' }}</option>
        </select>
      </label>
    }

    @if (layout() === 'wall' && rule()) {
      <p class="said">{{ said() }}</p>
    }

    @if (customOpen() && parsed(); as current) {
      <div class="custom" role="group" aria-label="Custom repeat">
        <div class="row">
          <span class="label">Every</span>
          <div class="line">
            <div class="stepper count">
              <button type="button" aria-label="Fewer" [disabled]="current.interval <= 1" (click)="update({ interval: current.interval - 1 })">−</button>
              <span>{{ current.interval }}</span>
              <button type="button" aria-label="More" [disabled]="current.interval >= 99" (click)="update({ interval: current.interval + 1 })">+</button>
            </div>
            @if (layout() === 'wall') {
              <div class="segments" role="group" aria-label="Unit">
                @for (unit of units; track unit.freq) {
                  <button type="button" [attr.aria-pressed]="current.freq === unit.freq" (click)="setFrequency(unit.freq)">
                    {{ current.interval === 1 ? unit.one : unit.many }}
                  </button>
                }
              </div>
            } @else {
              <select aria-label="Unit" (change)="setFrequency($any($event.target).value)">
                @for (unit of units; track unit.freq) {
                  <option [value]="unit.freq" [selected]="current.freq === unit.freq">{{ current.interval === 1 ? unit.one : unit.many }}</option>
                }
              </select>
            }
          </div>
        </div>

        @if (current.freq === 'WEEKLY') {
          <div class="row">
            <span class="label">On</span>
            <div class="line weekdays" role="group" aria-label="Weekdays">
              @for (weekday of weekdays; track weekday) {
                <button type="button" [attr.aria-label]="letters[weekday][1]" [attr.aria-pressed]="current.byDay.includes(weekday)" (click)="toggleDay(current, weekday)">
                  {{ letters[weekday][0] }}
                </button>
              }
            </div>
          </div>
        }

        @if (current.freq === 'MONTHLY') {
          <div class="row">
            <span class="label">On</span>
            <div class="line segments" role="group" aria-label="Day of the month">
              <button type="button" [attr.aria-pressed]="current.byDay.length === 0" (click)="update({ byDay: [], byMonthDay: [date()] })">{{ dateSaid() }}</button>
              <button type="button" [attr.aria-pressed]="current.byDay.length > 0" (click)="update({ byDay: [place() + weekday()], byMonthDay: [] })">{{ placeSaid() }}</button>
            </div>
          </div>
        }

        <div class="row">
          <span class="label">Ends</span>
          <div class="line segments" role="group" aria-label="Ends">
            <button type="button" [attr.aria-pressed]="current.count === null && !current.until" (click)="update({ count: null, until: null })">Never</button>
            <button type="button" [attr.aria-pressed]="!!current.until" (click)="update({ count: null, until: current.until ?? later(current, current.freq === 'YEARLY' ? 5 : current.freq === 'MONTHLY' ? 6 : 12) })">On a day</button>
            <button type="button" [attr.aria-pressed]="current.count !== null" (click)="update({ until: null, count: current.count ?? 10 })">After</button>
          </div>
        </div>

        @if (current.until; as until) {
          <div class="row">
            <span class="label" aria-hidden="true"></span>
            @if (layout() === 'wall') {
              <div class="stepper until">
                <button type="button" aria-label="End earlier" [disabled]="later(current, -1, until) < day()" (click)="update({ until: later(current, -1, until) })">−</button>
                <span>{{ untilSaid(until) }}</span>
                <button type="button" aria-label="End later" (click)="update({ until: later(current, 1, until) })">+</button>
              </div>
            } @else {
              <input type="date" aria-label="Last day" [min]="day()" [value]="until" (change)="$any($event.target).value && update({ until: $any($event.target).value })" />
            }
          </div>
        }

        @if (current.count !== null) {
          <div class="row">
            <span class="label" aria-hidden="true"></span>
            <div class="stepper count">
              <button type="button" aria-label="Fewer times" [disabled]="current.count <= 1" (click)="update({ count: current.count - 1 })">−</button>
              <span>{{ current.count === 1 ? 'Once' : current.count + ' times' }}</span>
              <button type="button" aria-label="More times" [disabled]="current.count >= 999" (click)="update({ count: current.count + 1 })">+</button>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--gap, 12px);
      --control: 44px;
      --gap: 12px;
    }
    :host(.wall) {
      --control: 56px;
      --gap: 14px;
    }
    .segments {
      flex: 1;
      min-width: 0;
      display: grid;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      padding: 4px;
      border: var(--track-border);
      border-radius: min(16px, var(--pill));
      background: var(--track);
    }
    .segments button {
      min-width: 0;
      height: var(--control);
      padding: 0 6px;
      border: 0;
      border-radius: min(12px, var(--pill));
      background: transparent;
      color: var(--quiet);
      font: 600 15px var(--font-body);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    :host(.wall) .segments button {
      font-size: 17px;
    }
    .segments button[aria-pressed='true'] {
      background: var(--segment);
      box-shadow: var(--raised);
      color: var(--on-segment);
      font-weight: 700;
    }
    .said {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      color: var(--muted);
    }
    .custom {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--field);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .line {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .line.segments {
      display: grid;
    }
    /* The phone has no room beside the controls, so each row's name goes above them and the custom part loses its box. */
    :host(:not(.wall)) .custom {
      padding: 4px 0 0;
      border: 0;
      background: none;
    }
    :host(:not(.wall)) .row {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
    }
    :host(:not(.wall)) .label:empty {
      display: none;
    }
    :host(:not(.wall)) .label {
      flex-basis: auto;
    }
    .line select {
      flex: 1;
      min-width: 0;
      height: calc(var(--control) + 4px);
      box-sizing: border-box;
      padding: 0 42px 0 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background-color: var(--surface);
      color: var(--ink);
      font: 400 16px var(--font-body);
    }
    .label {
      flex: 0 0 48px;
      font-size: 15px;
      font-weight: 700;
      color: var(--muted);
    }
    :host(.wall) .label {
      flex-basis: 64px;
      font-size: 17px;
    }
    .stepper {
      flex-shrink: 0;
      height: calc(var(--control) + 4px);
      box-sizing: border-box;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: var(--surface);
      display: flex;
      align-items: center;
    }
    .stepper span {
      min-width: 72px;
      padding: 0 4px;
      text-align: center;
      font-size: 17px;
      font-weight: 600;
      white-space: nowrap;
    }
    .stepper.until span {
      min-width: 180px;
    }
    .stepper button {
      width: var(--control);
      height: var(--control);
      border: 0;
      background: none;
      color: var(--ink);
      font: 600 24px var(--font-body);
      cursor: pointer;
    }
    .stepper button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .weekdays {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    :host(:not(.wall)) .weekdays {
      display: grid;
      grid-template-columns: repeat(7, minmax(var(--control), 1fr));
      gap: 2px;
    }
    .weekdays button {
      min-width: var(--control);
      height: var(--control);
      border: 1px solid var(--line);
      border-radius: var(--control);
      background: var(--surface);
      color: var(--ink);
      font: 700 16px var(--font-body);
      cursor: pointer;
    }
    .weekdays button[aria-pressed='true'] {
      border-color: var(--primary);
      background: var(--primary);
      color: var(--on-primary);
    }
    input[type='date'] {
      flex: 1;
      min-width: 0;
      height: var(--control);
      box-sizing: border-box;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      color: var(--ink);
      font: 400 16px var(--font-body);
    }
  `,
  host: { '[class.wall]': "layout() === 'wall'" },
})
export class RepeatPicker {
  /** The rule as the draft has it, or null for an event that does not repeat. */
  readonly rule = input<string | null>(null);

  /** The event's first day, which the ready-made repeats are named from. */
  readonly day = input.required<Day>();

  readonly layout = input<'wall' | 'phone'>('phone');

  /** Whether Does not repeat is offered: a whole series cannot stop repeating from here. */
  readonly allowNever = input(true);

  readonly ruleChange = output<string | null>();

  protected readonly units = UNITS;
  protected readonly weekdays = WEEKDAYS;
  protected readonly letters = WEEKDAY_LETTERS;

  protected readonly presets = computed(() => presetsFor(this.day()).filter((preset) => this.allowNever() || preset.rule));
  protected readonly wallPresets = computed(() => this.presets().filter((preset) => preset.id !== 'monthlyByWeekday'));
  protected readonly chosen = computed(() => presetOf(this.rule(), this.day()));

  /** Custom stays open once chosen, and is open by itself for a rule no ready-made repeat names. */
  private readonly customChosen = signal(false);
  protected readonly customOpen = computed(() => this.customChosen() || (!!this.rule() && !this.chosen()));

  protected readonly parsed = computed(() => parseRule(this.rule()));
  protected readonly said = computed(() => describeRule(this.rule()));
  protected readonly weekday = computed(() => weekdayCode(this.day()));
  protected readonly date = computed(() => Number(this.day().slice(8)));
  protected readonly place = computed(() => placeInMonth(this.day()));
  protected readonly dateSaid = computed(() => describeRule(`RRULE:FREQ=MONTHLY;BYMONTHDAY=${this.date()}`).replace('Every month on', 'On'));
  protected readonly placeSaid = computed(() => describeRule(`RRULE:FREQ=MONTHLY;BYDAY=${this.place()}${this.weekday()}`).replace('Every month on', 'On'));

  protected choose(rule: string | null): void {
    this.customChosen.set(false);
    this.emit(rule);
  }

  protected pick(id: string): void {
    if (id === 'custom') {
      this.openCustom();
    } else {
      this.choose(this.presets().find((preset) => preset.id === id)!.rule);
    }
  }

  /** Custom starts from the rule there is, or from repeating weekly on the event's day. */
  protected openCustom(): void {
    this.customChosen.set(true);
    if (!this.parsed()) {
      this.emit(presetsFor(this.day()).find((preset) => preset.id === 'weekly')!.rule);
    }
  }

  protected update(change: Partial<RepeatRule>): void {
    const rule = this.parsed();
    if (rule) {
      this.emit(formatRule({ ...rule, ...change }));
    }
  }

  /** A new unit names its days afresh from the event's first day. */
  protected setFrequency(freq: RepeatRule['freq']): void {
    const rule = this.parsed();
    if (rule && rule.freq !== freq) {
      this.emit(formatRule({ ...rule, freq, byDay: [], byMonthDay: [], byMonth: [] }));
    }
  }

  /** Weekdays toggle, but a weekly rule always keeps one. */
  protected toggleDay(rule: RepeatRule, weekday: Weekday): void {
    const byDay = rule.byDay.includes(weekday) ? rule.byDay.filter((day) => day !== weekday) : [...rule.byDay, weekday];
    if (byDay.length > 0) {
      this.update({ byDay });
    }
  }

  /**
   * An end <code>steps</code> away from <code>from</code>: a week at a time for daily and weekly
   * rules, a month for monthly ones and a year for yearly ones, never before the first day.
   */
  protected later(rule: RepeatRule, steps: number, from: Day = this.day()): Day {
    if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') return addDays(from, 7 * steps);
    const months = rule.freq === 'MONTHLY' ? steps : 12 * steps;
    const [year, month, date] = from.split('-').map(Number);
    const target = new Date(Date.UTC(year, month - 1 + months, 1, 12));
    const length = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
    target.setUTCDate(Math.min(date, length));
    return target.toISOString().slice(0, 10);
  }

  protected untilSaid(until: Day): string {
    return `Until ${formatDay(until, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  private emit(rule: string | null): void {
    this.ruleChange.emit(rule ? canonicalRule(rule, this.day()) : null);
  }
}
