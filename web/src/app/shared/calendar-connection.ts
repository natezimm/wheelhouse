import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CalendarStore } from '../core/calendar';
import { CalendarLive } from '../core/calendar-live';
import { SessionStore } from '../core/session';

/** Live subscription health and snapshot recovery, shared by every calendar layout. */
@Component({
  selector: 'app-calendar-connection',
  imports: [RouterLink],
  template: `
    @if (live.available()) {
      <div class="connection" aria-label="Calendar connection">
        <span class="pill" [class.offline]="offline()" role="status" aria-live="polite">
          <span class="dot" aria-hidden="true"></span>{{ label() }}
        </span>
        <button
          type="button"
          [disabled]="live.recovering()"
          [attr.aria-busy]="live.recovering()"
          (click)="live.resync()"
          aria-describedby="calendar-resync-help"
        >
          {{ live.recovering() ? 'Resyncing…' : 'Resync now' }}
        </button>
        <span id="calendar-resync-help" class="sr-only"
          >Refresh the calendar from the server and retry live updates.</span
        >
        @if (calendar.refreshFailed()) {
          <span class="failure" role="alert">Calendar refresh failed. Try Resync now again.</span>
        }
      </div>
    }
    @if (calendar.needsReconnect()) {
      <p class="reconnect" role="alert">
        @if (wall()) {
          Google Calendar has stopped updating. A parent can connect it again in Settings on their
          phone.
        } @else {
          Google Calendar has stopped updating.
          @if (session.canSignOut()) {
            <a routerLink="/settings/calendars">Connect Google again in Settings</a>.
          } @else {
            A parent can connect it again in Settings.
          }
        }
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .connection {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border-radius: 24px;
      color: var(--ink);
      background: color-mix(in srgb, var(--ok) 12%, var(--surface));
      font-size: 14px;
      white-space: nowrap;
    }
    .pill.offline {
      background: color-mix(in srgb, var(--warn) 16%, var(--surface));
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ok);
    }
    .offline .dot {
      background: var(--warn);
    }
    button {
      min-height: 44px;
      min-width: 44px;
      padding: 8px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
      color: var(--ink);
      font: 600 14px var(--font-body);
      cursor: pointer;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }
    button:focus-visible,
    a:focus-visible {
      outline: 3px solid var(--ink);
      outline-offset: 3px;
    }
    .failure {
      flex-basis: 100%;
      color: var(--ink);
      font-size: 14px;
    }
    .reconnect {
      margin: 10px 0 0;
      padding: 10px 14px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--warn) 16%, var(--surface));
      color: var(--ink);
      font: 600 14px var(--font-body);
      overflow-wrap: anywhere;
    }
    a {
      color: inherit;
      display: inline-block;
      min-height: 44px;
      align-content: center;
    }
    :host-context(app-wall-shell) .pill,
    :host-context(app-wall-shell) button,
    :host-context(app-wall-shell) .failure,
    :host-context(app-wall-shell) .reconnect {
      font-size: 17px;
    }
    :host-context(app-wall-shell) button {
      min-height: 56px;
      min-width: 56px;
    }
  `,
})
export class CalendarConnection {
  readonly wall = input(false);
  protected readonly calendar = inject(CalendarStore);
  protected readonly live = inject(CalendarLive);
  protected readonly session = inject(SessionStore);
  protected readonly offline = computed(
    () => this.live.state() === 'connecting' || this.live.state() === 'reconnecting',
  );
  protected readonly label = computed(() =>
    this.live.state() === 'connecting'
      ? 'Connecting'
      : this.offline()
        ? 'Reconnecting'
        : 'Live updates',
  );
}
