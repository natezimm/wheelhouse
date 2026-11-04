import { Component, computed, inject, signal } from '@angular/core';
import { FamilyStore } from '../core/family';
import { LEAD_CHOICES, ReminderError, ReminderSettings, ReminderStore } from '../core/reminders';
import { AvatarFace } from '../shared/avatar-face';

/** "15 min", "1 hour", "2 hours". */
export function leadText(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
}

/**
 * Settings' Reminders: this phone gets a notification before its people's events start. Each
 * phone chooses for itself, so a parent can be reminded of their own events and a kid's.
 */
@Component({
  selector: 'app-reminder-settings',
  imports: [AvatarFace],
  template: `
    <h2 id="reminders-heading">Reminders</h2>
    <div class="card" role="group" aria-labelledby="reminders-heading">
      @switch (reminders.state().status) {
        @case ('loading') {
          <p class="place">Checking this phone…</p>
        }
        @case ('unsupported') {
          <p class="place">This browser can't show reminders. Try Wheelhouse in Chrome, Edge, Firefox or Safari.</p>
        }
        @case ('install') {
          <p class="place">
            On an iPhone or iPad, reminders need Wheelhouse on the Home Screen: tap Share, then Add to Home Screen, and turn
            them on from there.
          </p>
        }
        @case ('blocked') {
          <p class="place">Notifications are off for Wheelhouse in this browser's settings. Allow them there to be reminded.</p>
        }
        @default {
          <p class="place">
            @if (on()) {
              This phone is reminded {{ lead(chosen().leadMinutes) }} before events start.
            } @else {
              Get a notification on this phone before events start.
            }
          </p>
          <label class="field">
            How early
            <select [value]="chosen().leadMinutes" [disabled]="busy()" (change)="setLead(+$any($event.target).value)">
              @for (minutes of leads; track minutes) {
                <option [value]="minutes" [selected]="minutes === chosen().leadMinutes">{{ lead(minutes) }} before</option>
              }
            </select>
            <span class="hint">An event can have its own time instead: set Remind phones when you edit it.</span>
          </label>
          @if (members().length > 1) {
            <div class="field">
              <span id="reminders-who">Whose events</span>
              <div class="people" role="group" aria-labelledby="reminders-who">
                @for (member of members(); track member.id) {
                  <button
                    type="button"
                    class="person"
                    [style.--member]="member.color"
                    [attr.aria-pressed]="chosen().memberIds.includes(member.id)"
                    [disabled]="busy()"
                    (click)="toggle(member.id)"
                  >
                    <span class="mark" aria-hidden="true"><app-avatar-face [initial]="member.initial" [avatar]="member.avatar" /></span><span class="name">{{ member.displayName }}</span>
                  </button>
                }
              </div>
              <span class="hint">Events for the whole family always come too.</span>
            </div>
          }
          @if (on()) {
            <div class="pair">
              <button class="button" type="button" [disabled]="busy()" (click)="test()">Send a test</button>
              <button class="button" type="button" [disabled]="busy()" (click)="turnOff()">Turn off</button>
            </div>
            <p class="hint">
              Also see the family's calendars in Google Calendar? Set their notifications to none there, or this phone is told
              twice.
            </p>
          } @else {
            <button class="button primary" type="button" [disabled]="busy()" (click)="turnOn()">Turn on reminders</button>
          }
        }
      }
      <p class="message" role="status">{{ message() }}</p>
    </div>
  `,
  styles: `
    :host {
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

    .place {
      margin: 0;
      font-size: 15px;
    }

    .hint {
      margin: 0;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
    }

    .people {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .person {
      min-height: 44px;
      padding: 0 14px 0 6px;
      border: 1px solid var(--line);
      border-radius: var(--pill);
      background: var(--surface);
      color: var(--ink);
      font: 600 15px var(--font-body);
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .person[aria-pressed='true'] {
      border: 2px solid var(--ink);
      background: var(--member-chip-bg);
    }

    .mark {
      flex-shrink: 0;
      width: 30px;
      height: 30px;
      box-sizing: border-box;
      border-radius: 50%;
      background: var(--member-strong);
      border: var(--avatar-border);
      color: var(--on-avatar);
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
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

    .message:empty {
      min-height: 0;
    }
  `,
})
export class ReminderSettingsCard {
  protected readonly reminders = inject(ReminderStore);
  private readonly family = inject(FamilyStore);

  protected readonly leads = LEAD_CHOICES;
  protected readonly lead = leadText;
  protected readonly members = this.family.members;
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  /** What to remind of before reminders are on: 15 minutes, everyone. */
  private readonly draft = signal<ReminderSettings | null>(null);

  protected readonly on = computed(() => this.reminders.state().status === 'on');

  protected readonly chosen = computed<ReminderSettings>(() => {
    const state = this.reminders.state();
    if (state.status === 'on') return state.settings;
    return this.draft() ?? { leadMinutes: 15, memberIds: this.members().map((m) => m.id) };
  });

  constructor() {
    void this.reminders.load();
  }

  protected setLead(leadMinutes: number): void {
    this.change({ ...this.chosen(), leadMinutes });
  }

  protected toggle(id: string): void {
    const ids = this.chosen().memberIds;
    this.change({ ...this.chosen(), memberIds: ids.includes(id) ? ids.filter((m) => m !== id) : [...ids, id] });
  }

  /** Before reminders are on, a change is kept for Turn on; after, it saves at once. */
  private change(settings: ReminderSettings): void {
    if (!this.on()) {
      this.draft.set(settings);
      return;
    }
    void this.run(() => this.reminders.save(settings), 'Saved.');
  }

  protected turnOn(): void {
    void this.run(() => this.reminders.turnOn(this.chosen()), 'Reminders are on. Send a test to see one.');
  }

  protected turnOff(): void {
    void this.run(async () => {
      this.draft.set(this.chosen());
      await this.reminders.turnOff();
    }, 'Reminders are off on this phone.');
  }

  protected test(): void {
    void this.run(() => this.reminders.test(), 'Sent. It should show on this phone in a moment.');
  }

  private async run(action: () => Promise<void>, done: string): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    try {
      await action();
      this.message.set(done);
    } catch (error) {
      this.message.set(error instanceof ReminderError ? error.message : 'Something went wrong. Try again in a moment.');
    } finally {
      this.busy.set(false);
    }
  }
}
