import { Component, OnDestroy, inject, input, output, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { AiService, DescribedEvent, aiRefusal } from '../core/ai';

/** What the editor says of each field Describe it guessed, in the order the form shows them. */
const HINTS: Record<string, string> = {
  title: "Couldn't find a title, so it uses your words.",
  day: "Couldn't tell the day for sure. Check it.",
  weekday: "The weekday and the date didn't match. Check the day.",
  time: "Couldn't tell the time, so check when it starts.",
  end: 'Check when it ends.',
  repeat: "Couldn't read how it repeats. Set Repeat yourself.",
  people: "Some names aren't in the family, so they were left out.",
};

/** What the demo offers to try: the Marlowes' own week. */
export const DESCRIBE_EXAMPLES = [
  'Nora soccer every Tuesday 5:15 to 6:15 at Riverside Park until June',
  'Milo dentist next Thursday at 3',
  'Family dinner at Nonna’s Saturday 6 to 8pm',
];

/** The hints for what Describe it guessed, said for people. */
export function describeHints(unclear: readonly string[]): string[] {
  return Object.keys(HINTS).filter((field) => unclear.includes(field)).map((field) => HINTS[field]);
}

/**
 * Describe it, at the top of a new event: a parent's words fill in the form below, unsaved. Nothing
 * is saved until they press Save, so a wrong guess costs a correction, never a wrong event. When the
 * assistant cannot help, the form works as it always does.
 */
@Component({
  selector: 'app-describe-card',
  template: `
    <section class="describe" [class.done]="filled()" aria-labelledby="describe-label">
      <label id="describe-label" for="describe-text" class="label">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"></path><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"></path></svg>
        Describe it
      </label>
      <div class="row">
        <input
          id="describe-text"
          type="text"
          autocomplete="off"
          enterkeyhint="go"
          maxlength="300"
          placeholder="Who, what, when and where"
          [attr.aria-describedby]="filled() || problem() ? 'describe-status' : 'describe-note describe-status'"
          [value]="text()"
          [disabled]="reading()"
          (input)="text.set($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); fill()"
        />
        <button type="button" class="button primary" [disabled]="reading() || !text().trim()" (click)="fill()">
          {{ reading() ? 'Reading…' : 'Fill in' }}
        </button>
      </div>
      @if (examples() && !filled() && !reading()) {
        <div class="examples" role="group" aria-label="Try an example">
          @for (example of examples(); track example) {
            <button type="button" class="example" (click)="text.set(example); fill()">{{ example }}</button>
          }
        </div>
      }
      @if (!filled() && !problem()) {
        <p id="describe-note" class="note">What you type is sent to Anthropic to understand it. Nothing is saved until you press Save.</p>
      }
      <div id="describe-status" class="status" aria-live="polite">
        @if (problem(); as problem) {
          <p class="problem">{{ problem }}</p>
        } @else if (filled()) {
          <p>Filled in from your words. Check it, then Save.</p>
          @for (hint of hints(); track hint) {
            <p class="hint">{{ hint }}</p>
          }
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }

    .describe {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line));
      border-radius: 16px;
      background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    }

    .label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 700;
      color: var(--ink);
    }

    .label svg { color: var(--accent); }

    .row {
      display: flex;
      gap: 8px;
    }

    input {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      height: 48px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      color: var(--ink);
      font: 400 16px var(--font-body);
    }

    input::placeholder { color: var(--muted); }

    .row .button { flex-shrink: 0; padding: 0 16px; }

    .examples {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .example {
      min-height: 44px;
      padding: 6px 12px;
      border: 1px solid var(--line);
      border-radius: var(--pill);
      background: var(--surface);
      color: var(--ink);
      font: 500 13px/1.3 var(--font-body);
      text-align: left;
      cursor: pointer;
    }

    .note {
      margin: 0;
      font-size: 12px;
      color: var(--muted);
    }

    .status:empty { display: none; }

    .status p {
      margin: 0;
      font-size: 13px;
      color: var(--ink);
    }

    .status p + p { margin-top: 4px; }

    .status .hint { color: var(--muted); }

    .status .problem { color: var(--danger-text); }
  `,
})
export class DescribeCard implements OnDestroy {
  private readonly ai = inject(AiService);

  /** A described event, for the editor to fill its form with. */
  readonly described = output<DescribedEvent>();

  /** Examples to try, on the demo only. */
  readonly examples = input<readonly string[] | null>(null);

  protected readonly text = signal('');
  protected readonly reading = signal(false);
  protected readonly filled = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly hints = signal<string[]>([]);
  private request: Subscription | null = null;

  protected fill(): void {
    const text = this.text().trim();
    if (!text || this.reading()) {
      return;
    }
    this.reading.set(true);
    this.problem.set(null);
    this.request = this.ai.describe(text).subscribe({
      next: (described) => {
        this.reading.set(false);
        this.filled.set(true);
        this.hints.set(describeHints(described.unclear));
        this.described.emit(described);
      },
      error: (error) => {
        this.reading.set(false);
        this.filled.set(false);
        this.problem.set(aiRefusal(error));
      },
    });
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }
}
