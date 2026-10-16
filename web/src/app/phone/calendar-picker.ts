import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FAMILY_COLOR } from '../core/calendar';
import { FamilyStore, refusalMessage } from '../core/family';
import { CalendarChoice, GoogleStore } from '../core/google';

/**
 * Phone-only: which of the shared account's calendars the family shows, and whose each one is,
 * which decides the color its events take. Opened from Settings.
 */
@Component({
  selector: 'app-calendar-picker',
  imports: [RouterLink],
  template: `
    <header>
      <a class="back" routerLink="/settings" aria-label="Back to Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </a>
      <h1>Calendars</h1>
    </header>

    @switch (google.calendars().status) {
      @case ('ready') {
        <p class="hint">Tick the calendars to show. Each one's events take the color of the person it belongs to.</p>
        <ul class="card rows">
          @for (row of rows(); track row.googleCalendarId; let i = $index) {
            <li>
              <label class="show">
                <input type="checkbox" [checked]="row.shown" (change)="setShown(i, $any($event.target).checked)" />
                <span class="dot" [style.background]="row.color ?? 'var(--line)'" aria-hidden="true"></span>
                <span class="name">{{ row.name }}</span>
              </label>
              @if (row.shown) {
                <label class="whose">
                  <span class="sr-only">Whose is {{ row.name }}</span>
                  <select [value]="row.memberId ?? ''" (change)="setOwner(i, $any($event.target).value)">
                    @for (member of family.members(); track member.id) {
                      <option [value]="member.id" [selected]="row.memberId === member.id">{{ member.displayName }}</option>
                    }
                    <option value="" [selected]="row.memberId === null">Whole family</option>
                  </select>
                  <span class="swatch" [style.background]="colorOf(row)" aria-hidden="true"></span>
                </label>
              }
            </li>
          } @empty {
            <li class="none">The account has no calendars yet. Make one per person in Google Calendar, then come back.</li>
          }
        </ul>
        <button class="button primary" type="button" [disabled]="saving()" (click)="save()">Save calendars</button>
        <p class="message" role="alert">{{ message() }}</p>
      }
      @case ('reconnect') {
        <p class="notice">Google stopped accepting the connection. <a routerLink="/settings">Connect again in Settings</a>.</p>
      }
      @case ('unavailable') {
        <p class="notice">Could not load the calendars. Try again in a moment.</p>
      }
    }
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
      font-weight: 600;
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

    .rows {
      margin: 0;
      padding: 2px 14px;
      list-style: none;
      gap: 0;
    }

    .rows li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 10px;
      padding: 4px 0;
    }

    .rows li + li {
      border-top: 1px solid var(--hairline);
    }

    .show {
      flex: 1 1 160px;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      cursor: pointer;
    }

    .show input {
      width: 22px;
      height: 22px;
      margin: 0;
      accent-color: var(--ink);
    }

    .dot {
      flex-shrink: 0;
      width: 10px;
      height: 10px;
      border-radius: 5px;
    }

    .name {
      font-size: 16px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .whose {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .whose select {
      min-height: 44px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
      color: var(--ink);
      font: 600 14px var(--font-body);
    }

    .swatch {
      width: 18px;
      height: 18px;
      border-radius: 9px;
    }

    .none {
      padding: 14px 0;
      font-size: 14px;
      color: var(--muted);
    }

    .message {
      margin: 0;
      min-height: 20px;
      font-size: 14px;
      color: var(--warn);
    }

    .notice {
      margin: auto 0;
      text-align: center;
      font-family: var(--font-display);
      font-size: 20px;
      color: var(--muted);
    }
  `,
})
export class CalendarPicker {
  protected readonly google = inject(GoogleStore);
  protected readonly family = inject(FamilyStore);
  private readonly router = inject(Router);

  /** The choices as edited here, saved together. */
  protected readonly rows = signal<CalendarChoice[]>([]);
  protected readonly saving = signal(false);
  protected readonly message = signal('');

  constructor() {
    if (this.family.state().status === 'loading') {
      this.family.load();
    }
    this.google.loadChoices();

    effect(() => {
      const state = this.google.calendars();
      if (state.status === 'ready') {
        this.rows.set(state.calendars.map((calendar) => ({ ...calendar })));
      }
    });
  }

  protected setShown(index: number, shown: boolean): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, shown } : row)));
  }

  protected setOwner(index: number, memberId: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, memberId: memberId || null } : row)));
  }

  /** The color the calendar's events will take: its person's, or the family's. */
  protected colorOf(row: CalendarChoice): string {
    return this.family.members().find((member) => member.id === row.memberId)?.color ?? FAMILY_COLOR;
  }

  protected save(): void {
    const chosen = this.rows()
      .filter((row) => row.shown)
      .map(({ googleCalendarId, memberId }) => ({ googleCalendarId, memberId }));
    this.saving.set(true);
    this.message.set('');
    this.google.saveChoices(chosen).subscribe({
      next: () => void this.router.navigateByUrl('/calendar'),
      error: (error: unknown) => {
        this.saving.set(false);
        this.message.set(refusalMessage(error, 'Could not save the calendars. Try again in a moment.'));
      },
    });
  }
}
