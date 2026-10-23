import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DisplayStore } from '../core/displays';
import { refusalMessage } from '../core/family';

/** Phone-only: pair a wall display by typing the code it shows. Opened from Settings. */
@Component({
  selector: 'app-pair-display',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <header>
      <a class="back" routerLink="/settings" aria-label="Back to Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </a>
      <h1>Pair a display</h1>
    </header>

    <form class="card" [formGroup]="form" (ngSubmit)="pair()">
      <p class="hint">Open Wheelhouse on the display at /wall. It shows a 6-digit code.</p>
      <label class="field">
        Code on the display
        <input
          class="code"
          type="text"
          formControlName="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="7"
          placeholder="000 000"
        />
      </label>
      <label class="field">
        Name
        <input type="text" formControlName="name" maxlength="50" autocomplete="off" placeholder="Kitchen wall" />
      </label>
      <button class="button primary" type="submit" [disabled]="form.invalid || busy()">Pair display</button>
      <p class="message" role="alert">{{ message() }}</p>
    </form>
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 20px 18px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 30px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      letter-spacing: -0.02em;
    }

    .back {
      width: 44px;
      height: 44px;
      border-radius: 22px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .hint {
      margin: 0;
      font-size: 14px;
      color: var(--muted);
    }

    .field input.code {
      font: 600 24px var(--font-display);
      letter-spacing: 0.12em;
    }

    .message {
      margin: 0;
      min-height: 20px;
      font-size: 14px;
      color: var(--warn);
    }
  `,
})
export class PairDisplay {
  private readonly displays = inject(DisplayStore);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly message = signal('');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    // Six digits, allowing the space or dash someone might type in the middle.
    code: ['', [Validators.required, Validators.pattern(/^\s*\d{3}[\s-]?\d{3}\s*$/)]],
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(50)]],
  });

  protected pair(): void {
    if (this.form.invalid) {
      return;
    }

    const { code, name } = this.form.getRawValue();
    this.busy.set(true);
    this.message.set('');
    this.displays.pair(code.replace(/\D/g, ''), name.trim()).subscribe({
      // The display signs itself in within a few seconds; Settings lists it already.
      next: () => void this.router.navigateByUrl('/settings'),
      error: (error: unknown) => {
        this.busy.set(false);
        this.message.set(
          error instanceof HttpErrorResponse && error.status === 429
            ? 'Too many tries. Wait a minute, then try again.'
            : refusalMessage(error, 'Could not pair the display. Try again in a moment.'),
        );
      },
    });
  }
}
