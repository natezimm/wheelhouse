import { Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Family, FamilySettings, FamilyStore, refusalMessage } from '../core/family';
import { MemberAvatar } from '../shared/member-avatar';

/** Phone-only: who is in the family, and the family's own details. Parents manage both here. */
@Component({
  selector: 'app-settings',
  imports: [MemberAvatar, ReactiveFormsModule, RouterLink],
  template: `
    <header>
      <a class="back" routerLink="/" aria-label="Back to Today">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </a>
      <h1>Settings</h1>
    </header>

    @switch (family.state().status) {
      @case ('ready') {
        <section aria-labelledby="members-heading">
          <h2 id="members-heading">Family</h2>
          <ul class="card rows">
            @for (member of family.members(); track member.id) {
              <li>
                <a [routerLink]="['/settings/members', member.id]">
                  <app-member-avatar [member]="member" />
                  <span class="name">{{ member.displayName }}</span>
                  <span class="role">{{ member.role === 'Kid' ? 'Kid · no sign-in' : 'Parent' }}</span>
                </a>
              </li>
            }
            <li><a class="add" routerLink="/settings/members/new">Add a family member</a></li>
          </ul>
        </section>

        <section aria-labelledby="details-heading">
          <h2 id="details-heading">Details</h2>
          <form class="card" [formGroup]="form" (ngSubmit)="save()">
            <label class="field">
              Family name
              <input type="text" formControlName="name" maxlength="100" autocomplete="off" />
            </label>
            <label class="field">
              Time zone
              <select formControlName="timeZone">
                @for (zone of timeZones; track zone) {
                  <option [value]="zone">{{ zone }}</option>
                }
              </select>
            </label>
            <div class="pair">
              <label class="field">
                Week starts on
                <select formControlName="weekStartsOn">
                  <option value="Monday">Monday</option>
                  <option value="Sunday">Sunday</option>
                </select>
              </label>
              <label class="field">
                Temperature
                <select formControlName="units">
                  <option value="Imperial">°F</option>
                  <option value="Metric">°C</option>
                </select>
              </label>
            </div>
            <div class="pair">
              <label class="field">
                Night mode from
                <input type="time" formControlName="nightModeFrom" />
              </label>
              <label class="field">
                until
                <input type="time" formControlName="nightModeTo" />
              </label>
            </div>
            <button class="button primary" type="submit" [disabled]="form.invalid || saving()">Save details</button>
            <p class="message" role="status">{{ message() }}</p>
          </form>
        </section>
      }
      @case ('private') {
        <p class="notice">This Wheelhouse is private.</p>
      }
      @case ('unavailable') {
        <p class="notice">Could not load the family. Try again in a moment.</p>
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

    section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    h2 {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .rows {
      margin: 0;
      padding: 2px 14px;
      list-style: none;
      gap: 0;
    }

    .rows li + li {
      border-top: 1px solid var(--hairline);
    }

    .rows a {
      --avatar-size: 28px;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 48px;
      color: var(--ink);
      text-decoration: none;
    }

    .name {
      flex: 1;
      font-size: 16px;
      font-weight: 600;
    }

    .role {
      font-size: 13px;
      color: var(--muted);
    }

    .rows .add {
      color: var(--accent);
      font-size: 15px;
      font-weight: 600;
    }

    .pair {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .message {
      margin: 0;
      min-height: 20px;
      font-size: 14px;
      color: var(--muted);
    }

    .notice {
      margin: auto 0;
      text-align: center;
      font-family: var(--font-display);
      font-size: 22px;
      color: var(--muted);
    }
  `,
})
export class Settings {
  protected readonly family = inject(FamilyStore);
  protected readonly timeZones = Intl.supportedValuesOf('timeZone');
  protected readonly saving = signal(false);
  protected readonly message = signal('');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    timeZone: ['', Validators.required],
    weekStartsOn: ['Monday' as Family['weekStartsOn'], Validators.required],
    units: ['Imperial' as Family['units'], Validators.required],
    nightModeFrom: ['', Validators.required],
    nightModeTo: ['', Validators.required],
  });

  constructor() {
    if (this.family.state().status === 'loading') {
      this.family.load();
    }

    // Fill the form from the family once it arrives, but never over edits in progress.
    effect(() => {
      const state = this.family.state();
      if (state.status === 'ready' && !this.form.dirty) {
        this.form.reset({
          name: state.family.name,
          timeZone: state.family.timeZone,
          weekStartsOn: state.family.weekStartsOn,
          units: state.family.units,
          nightModeFrom: toTimeInput(state.family.nightModeFrom),
          nightModeTo: toTimeInput(state.family.nightModeTo),
        });
      }
    });
  }

  protected save(): void {
    if (this.form.invalid) {
      return;
    }

    const value = this.form.getRawValue();
    const settings: FamilySettings = {
      ...value,
      name: value.name.trim(),
      nightModeFrom: fromTimeInput(value.nightModeFrom),
      nightModeTo: fromTimeInput(value.nightModeTo),
    };

    this.saving.set(true);
    this.message.set('');
    this.family.saveSettings(settings).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.message.set('Saved');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.message.set(refusalMessage(error, 'Could not save. Try again in a moment.'));
      },
    });
  }
}

/** The server speaks HH:mm:ss; a time input speaks HH:mm. */
const toTimeInput = (time: string) => time.slice(0, 5);
const fromTimeInput = (time: string) => `${time}:00`;
