import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Clock } from '../core/clock';
import { Display, DisplayStore, ONLINE_WITHIN_MS } from '../core/displays';
import { Family, FamilySettings, FamilyStore, MEMBER_COLORS, Theme, refusalMessage } from '../core/family';
import { GOOGLE_CONNECT_URL, GoogleStore } from '../core/google';
import { SessionStore } from '../core/session';
import { THEMES, ThemeService } from '../core/theme';
import { MemberAvatar } from '../shared/member-avatar';
import { SignIn } from './sign-in';

/**
 * Phone-only: who is in the family, its wall displays, its Google calendars, its own details and
 * where its weather is for. Parents manage them here.
 */
@Component({
  selector: 'app-settings',
  imports: [DatePipe, MemberAvatar, NgTemplateOutlet, ReactiveFormsModule, RouterLink, SignIn],
  template: `
    <header>
      <a class="back" routerLink="/" aria-label="Back to the calendar">
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

        <section aria-labelledby="displays-heading">
          <h2 id="displays-heading">Displays</h2>
          <div class="card displays">
            @switch (displays.state().status) {
              @case ('ready') {
                @for (display of displayList(); track display.id) {
                  <div class="display">
                    <span class="dot" [class.online]="isOnline(display)" aria-hidden="true"></span>
                    <span class="about">
                      <span class="name">{{ display.name }}</span>
                      <span class="seen">
                        @if (!display.lastSeenAt) {
                          Waiting to sign in
                        } @else if (isOnline(display)) {
                          Online · last seen {{ minutesAgo(display) }}
                        } @else {
                          Last seen {{ display.lastSeenAt | date: 'MMM d, h:mm a' }}
                        }
                      </span>
                    </span>
                    @if (removing() === display.id) {
                      <button class="button small danger" type="button" (click)="removeDisplay(display)">Remove</button>
                      <button class="button small" type="button" (click)="removing.set(null)">Keep</button>
                    } @else {
                      <button class="button small" type="button" (click)="removing.set(display.id)">Remove</button>
                    }
                  </div>
                } @empty {
                  <p class="none">No displays yet. A display shows a code until it's paired.</p>
                }
              }
              @case ('unavailable') {
                <p class="none">Could not load the displays.</p>
              }
            }
            <a class="button primary pair" routerLink="/settings/displays/pair">Pair a display</a>
            @if (displayMessage()) {
              <p class="message" role="alert">{{ displayMessage() }}</p>
            }
          </div>
        </section>

        <section aria-labelledby="calendars-heading">
          <h2 id="calendars-heading">Calendars</h2>
          <div class="card">
            @switch (google.state().status) {
              @case ('ready') {
                @if (connection(); as connected) {
                  @if (connected.email) {
                    <p class="place">Connected to <strong>{{ connected.email }}</strong>.</p>
                    @if (connected.status === 'NeedsReauth') {
                      <p class="warning">Google stopped accepting the connection, so the calendar can't stay up to date.</p>
                      <a class="button primary link" [href]="connectUrl">Connect again</a>
                    }
                    <a class="button link" routerLink="/settings/calendars">Choose calendars</a>
                    @if (disconnecting()) {
                      <p class="place">Disconnecting removes the family's calendars from Wheelhouse. They stay in Google.</p>
                      <div class="pair">
                        <button class="button danger" type="button" (click)="disconnect()">Disconnect</button>
                        <button class="button" type="button" (click)="disconnecting.set(false)">Keep</button>
                      </div>
                    } @else {
                      <button class="button" type="button" (click)="disconnecting.set(true)">Disconnect Google</button>
                    }
                  } @else if (connected.canConnect) {
                    <p class="place">Connect the family's shared Google account, the one with a calendar for each person.</p>
                    <a class="button primary link" [href]="connectUrl">Connect Google Calendar</a>
                  } @else {
                    <p class="place">The demo's calendars are made up, so there is no Google account to connect. You can still say whose calendar is whose.</p>
                    <a class="button link" routerLink="/settings/calendars">Choose calendars</a>
                  }
                }
              }
              @case ('unavailable') {
                <p class="none">Could not load the calendar connection.</p>
              }
            }
            @if (googleMessage()) {
              <p class="message" role="alert">{{ googleMessage() }}</p>
            }
          </div>
        </section>

        <section aria-labelledby="look-heading">
          <h2 id="look-heading">Look</h2>
          <div class="card look">
            <p class="place">The wall and every phone use the family's theme.</p>
            <div class="themes" role="group" aria-label="Theme">
              @for (theme of themes; track theme.value) {
                <button
                  class="theme"
                  type="button"
                  [attr.aria-pressed]="theme.value === chosenTheme()"
                  [disabled]="savingTheme()"
                  (click)="chooseTheme(theme.value)"
                >
                  <ng-container *ngTemplateOutlet="preview; context: { look: theme.value.toLowerCase() }" />
                  <span class="theme-name">{{ theme.name }}</span>
                  <span class="theme-about">{{ theme.about }}</span>
                </button>
              }
            </div>
            <div class="night">
              <ng-container *ngTemplateOutlet="preview; context: { look: 'night' }" />
              <label class="night-choice">
                <input type="checkbox" [checked]="autoNight()" [disabled]="savingTheme()" (change)="chooseNight($any($event.target).checked)" />
                <span>
                  <span class="theme-name">Night</span>
                  <span class="theme-about">Dark from {{ nightHours() }}, whatever the theme. The hours are under Details.</span>
                </span>
              </label>
            </div>
            <p class="message" role="status">{{ themeMessage() }}</p>
          </div>
        </section>

        <!-- A small calendar drawn in one look, with the family's own colors. -->
        <ng-template #preview let-look="look">
          <span class="preview" [attr.data-theme]="look" aria-hidden="true">
            <span class="mini">
              <span class="mini-head"><span class="mini-dow">Thu</span><span class="mini-num">22</span></span>
              <span class="mini-event" [style.--member]="previewColors()[0]">
                <span class="mini-time">9:00</span>
                <span class="mini-title">Swim lessons</span>
              </span>
              <span class="mini-event" [style.--member]="previewColors()[1]">
                <span class="mini-time">4:30</span>
                <span class="mini-title">Taco night</span>
              </span>
            </span>
            <span class="mini-add">+ Add</span>
          </span>
        </ng-template>

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

        <section aria-labelledby="weather-heading">
          <h2 id="weather-heading">Weather</h2>
          <div class="card">
            <p class="place">
              @if (place(); as at) {
                Weather is for {{ at }}.
              } @else {
                Set where you live to show the weather on the wall and on Today.
              }
            </p>
            <button class="button primary" type="button" [disabled]="locating()" (click)="useThisPhone()">
              {{ locating() ? 'Finding this phone…' : "Use this phone's location" }}
            </button>
            @if (place()) {
              <button class="button" type="button" [disabled]="locating()" (click)="clearPlace()">Stop showing the weather</button>
            }
            <p class="message" role="status">{{ placeMessage() }}</p>
          </div>
        </section>

        @if (session.canSignOut()) {
          <button class="button sign-out" type="button" [disabled]="signingOut()" (click)="signOut()">Sign out</button>
        }
        <a class="privacy" routerLink="/privacy">Privacy</a>
      }
      @case ('private') {
        <app-sign-in class="notice" returnUrl="/settings" />
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
      max-width: 720px;
      margin: 0 auto;
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

    .displays {
      padding: 2px 14px 12px;
      gap: 0;
    }

    .display {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 56px;
      border-bottom: 1px solid var(--hairline);
    }

    .dot {
      flex-shrink: 0;
      width: 10px;
      height: 10px;
      border-radius: 5px;
      background: var(--line);
    }

    .dot.online {
      background: var(--ok);
    }

    .about {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .about .name {
      font-size: 15px;
    }

    .seen {
      font-size: 13px;
      color: var(--muted);
    }

    .button.small {
      min-height: 44px;
      padding: 0 14px;
      font-size: 13px;
    }

    .none {
      margin: 0;
      padding: 14px 0;
      font-size: 14px;
      color: var(--muted);
    }

    .displays .pair {
      margin-top: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
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

    .place {
      margin: 0;
      font-size: 15px;
    }

    .warning {
      margin: 0;
      font-size: 14px;
      color: var(--danger);
    }

    .link {
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
    }

    .privacy {
      align-self: center;
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      font-size: 14px;
      color: var(--muted);
    }

    .sign-out {
      align-self: center;
    }

    .themes {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .theme {
      min-width: 0;
      padding: 8px 8px 12px;
      border: 2px solid var(--hairline);
      border-radius: 18px;
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 2px;
      cursor: pointer;
    }

    .theme[aria-pressed='true'] {
      border-color: var(--ink);
    }

    .theme:disabled {
      cursor: default;
    }

    .theme .preview {
      margin-bottom: 8px;
    }

    .theme-name {
      display: block;
      padding: 0 4px;
      font-size: 15px;
      font-weight: 700;
    }

    .theme-about {
      display: block;
      padding: 0 4px;
      font-size: 13px;
      line-height: 1.3;
      color: var(--muted);
    }

    .night {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .night .preview {
      flex: 0 0 132px;
    }

    .night-choice {
      flex: 1;
      min-width: 0;
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
    }

    .night-choice input {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      margin: 0;
      accent-color: var(--ink);
    }

    .night-choice .theme-name,
    .night-choice .theme-about {
      padding: 0;
    }

    /* Each preview carries its own data-theme, so everything inside it takes that theme's tokens. */
    .preview {
      box-sizing: border-box;
      height: 124px;
      padding: 8px;
      border-radius: 12px;
      background: var(--ground);
      color: var(--ink);
      font-family: var(--font-body);
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow: hidden;
    }

    .mini {
      flex: 1;
      min-height: 0;
      padding: 5px 6px;
      border: var(--card-border);
      border-radius: min(12px, var(--card-radius));
      background: var(--surface);
      /* The card's own shadow, at this size: only the bolder themes' offset survives. */
      box-shadow: var(--bar-lift);
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .mini-head {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-weight: 700;
      color: var(--today-dow);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .mini-num {
      box-sizing: border-box;
      width: 18px;
      height: 18px;
      border: var(--today-num-border);
      border-radius: var(--today-num-radius);
      background: var(--today-num);
      color: var(--on-today-num);
      font: var(--display-weight) 11px var(--font-display);
      font-variation-settings: var(--display-variation);
      letter-spacing: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mini-event {
      flex-shrink: 0;
      box-sizing: border-box;
      height: 20px;
      padding: 0 6px;
      border: var(--event-border);
      border-radius: min(6px, var(--event-radius));
      background: var(--member-bg);
      box-shadow: var(--bar-outline);
      color: var(--event-ink);
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
    }

    .mini-time {
      font-family: var(--font-time);
      font-weight: 700;
      color: var(--member-time);
    }

    .mini-title {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mini-add {
      align-self: flex-end;
      box-sizing: border-box;
      height: 20px;
      padding: 0 9px;
      border: var(--primary-border);
      border-radius: var(--pill);
      background: var(--primary);
      box-shadow: var(--primary-shadow);
      color: var(--on-primary);
      font-size: 10px;
      font-weight: 700;
      line-height: 18px;
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
  protected readonly session = inject(SessionStore);
  protected readonly signingOut = signal(false);
  protected readonly displays = inject(DisplayStore);
  /** The display whose removal is waiting to be confirmed. */
  protected readonly removing = signal<string | null>(null);
  protected readonly displayMessage = signal('');
  protected readonly locating = signal(false);
  protected readonly placeMessage = signal('');
  protected readonly google = inject(GoogleStore);
  protected readonly connectUrl = GOOGLE_CONNECT_URL;
  /** Waiting for a second tap to confirm disconnecting Google. */
  protected readonly disconnecting = signal(false);
  private readonly disconnectMessage = signal('');

  /** How the last trip to Google's consent screen ended, from the API's redirect. */
  readonly googleOutcome = input<string>(undefined, { alias: 'google' });

  protected readonly connection = computed(() => {
    const state = this.google.state();
    return state.status === 'ready' ? state.connection : null;
  });

  protected readonly googleMessage = computed(() => {
    switch (this.googleOutcome()) {
      case 'cancelled':
        return "Google wasn't connected: its screen was closed before allowing access.";
      case 'no-calendar':
        return 'Google was connected without calendar access. Connect again and leave calendar access ticked.';
      case 'failed':
        return "Connecting Google didn't finish. Try again.";
      default:
        return this.disconnectMessage();
    }
  });

  private readonly clock = inject(Clock);
  private readonly router = inject(Router);

  protected readonly themes = THEMES;
  protected readonly savingTheme = signal(false);
  protected readonly themeMessage = signal('');
  protected readonly chosenTheme = computed(() => this.family.family()?.theme ?? 'Daylight');
  protected readonly autoNight = computed(() => this.family.family()?.autoNight ?? true);

  /** The previews draw the family's own first two colors, so a parent sees their calendar. */
  protected readonly previewColors = computed(() => {
    const colors = this.family.members().map((member) => member.color);
    return [colors[0] ?? MEMBER_COLORS[0].value, colors[1] ?? MEMBER_COLORS[2].value];
  });

  protected readonly nightHours = computed(() => {
    const family = this.family.family();
    return family ? `${clockTime(family.nightModeFrom)} to ${clockTime(family.nightModeTo)}` : '';
  });

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

    // The previews draw every theme, so every theme's fonts are needed here.
    const look = inject(ThemeService);
    for (const theme of THEMES) look.loadFonts(theme.value);

    // Always fresh: a display may have signed in since this screen was last open.
    this.displays.load();
    this.google.load();

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

  protected chooseTheme(theme: Theme): void {
    if (theme !== this.chosenTheme()) this.saveTheme(theme, this.autoNight());
  }

  protected chooseNight(on: boolean): void {
    this.saveTheme(this.chosenTheme(), on);
  }

  /** Saves at once, so the screen and the wall change as soon as the server accepts it. */
  private saveTheme(theme: Theme, autoNight: boolean): void {
    this.savingTheme.set(true);
    this.themeMessage.set('');
    this.family.saveTheme(theme, autoNight).subscribe({
      next: () => this.savingTheme.set(false),
      error: (error: unknown) => {
        this.savingTheme.set(false);
        this.themeMessage.set(refusalMessage(error, 'Could not change the look. Try again in a moment.'));
      },
    });
  }

  /** Where the weather is for, as coordinates, or null when nowhere is set. */
  protected place(): string | null {
    const state = this.family.state();
    if (state.status !== 'ready' || state.family.latitude === null || state.family.longitude === null) {
      return null;
    }
    const { latitude, longitude } = state.family;
    return `${Math.abs(latitude).toFixed(2)}° ${latitude < 0 ? 'S' : 'N'}, ${Math.abs(longitude).toFixed(2)}° ${longitude < 0 ? 'W' : 'E'}`;
  }

  /** Asks the browser where this phone is; the server keeps it to about a kilometre. */
  protected useThisPhone(): void {
    if (!('geolocation' in navigator)) {
      this.placeMessage.set("This browser can't share its location.");
      return;
    }
    this.locating.set(true);
    this.placeMessage.set('');
    navigator.geolocation.getCurrentPosition(
      (position) => this.savePlace(position.coords.latitude, position.coords.longitude, 'Saved'),
      (error) => {
        this.locating.set(false);
        this.placeMessage.set(
          error.code === error.PERMISSION_DENIED
            ? 'Location is blocked for this site. Allow it in the browser, then try again.'
            : 'Could not find this phone. Try again in a moment.',
        );
      },
      { maximumAge: 10 * 60_000, timeout: 20_000 },
    );
  }

  protected clearPlace(): void {
    this.locating.set(true);
    this.placeMessage.set('');
    this.savePlace(null, null, 'The weather is off');
  }

  private savePlace(latitude: number | null, longitude: number | null, done: string): void {
    this.family.saveLocation(latitude, longitude).subscribe({
      next: () => {
        this.locating.set(false);
        this.placeMessage.set(done);
      },
      error: (error: unknown) => {
        this.locating.set(false);
        this.placeMessage.set(refusalMessage(error, 'Could not save. Try again in a moment.'));
      },
    });
  }

  protected disconnect(): void {
    this.disconnectMessage.set('');
    this.google.disconnect().subscribe({
      next: () => this.disconnecting.set(false),
      error: () => {
        this.disconnecting.set(false);
        this.disconnectMessage.set('Could not disconnect Google. Try again in a moment.');
      },
    });
  }

  protected displayList(): Display[] {
    const state = this.displays.state();
    return state.status === 'ready' ? state.displays : [];
  }

  protected isOnline(display: Display): boolean {
    return !!display.lastSeenAt && this.clock.now().getTime() - Date.parse(display.lastSeenAt) < ONLINE_WITHIN_MS;
  }

  protected minutesAgo(display: Display): string {
    const minutes = Math.floor((this.clock.now().getTime() - Date.parse(display.lastSeenAt!)) / 60_000);
    return minutes < 1 ? 'just now' : `${minutes} min ago`;
  }

  protected removeDisplay(display: Display): void {
    this.displayMessage.set('');
    this.displays.remove(display.id).subscribe({
      next: () => this.removing.set(null),
      error: () => {
        this.removing.set(null);
        this.displayMessage.set(`Could not remove ${display.name}. Try again in a moment.`);
      },
    });
  }

  protected signOut(): void {
    this.signingOut.set(true);
    this.session.signOut().subscribe({
      // Today reloads the family, which is private now, so it offers sign-in again.
      next: () => void this.router.navigateByUrl('/'),
      error: () => this.signingOut.set(false),
    });
  }
}

/** A time of day for people, such as "9:30 PM". */
function clockTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return `${((hours + 11) % 12) + 1}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** The server speaks HH:mm:ss; a time input speaks HH:mm. */
const toTimeInput = (time: string) => time.slice(0, 5);
const fromTimeInput = (time: string) => `${time}:00`;
