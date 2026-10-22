import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CalendarStore } from '../core/calendar';
import { CalendarLive } from '../core/calendar-live';
import { timeIn } from '../core/days';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { StatusLine } from './status-line';

/**
 * Whether the calendar is up to date, shared by every layout. A small Live dot while the
 * subscription is up; otherwise a pill that says what is wrong, what time the screen shows,
 * and one way to fix it. Google needing reconnection is its own notice. Before there is a
 * subscription, the server-health line takes the same place.
 */
@Component({
  selector: 'app-calendar-connection',
  imports: [RouterLink, StatusLine],
  host: { '[class]': 'layout()' },
  template: `
    @if (show() === 'live') {
      @if (live.available() && !offline() && !calendar.refreshFailed()) {
        <span class="state" role="status" aria-live="polite"
          ><span class="dot" aria-hidden="true"></span><span class="sr-only">{{ live.recovering() ? 'Refreshing' : 'Live' }}</span></span
        >
      }
    } @else if (calendar.state().status === 'unavailable') {
      <div class="pill failed">
        <span role="alert">Can't load the calendar</span>
        <button type="button" (click)="calendar.refresh()">Try again</button>
      </div>
    } @else if (live.available()) {
      @if (calendar.refreshFailed()) {
        <div class="pill failed" aria-label="Calendar connection">
          <span class="failure" role="alert">Couldn't refresh{{ showing() }}</span>
          <button type="button" [disabled]="live.recovering()" [attr.aria-busy]="live.recovering()" (click)="live.resync()">
            {{ live.recovering() ? 'Resyncing…' : 'Try again' }}
          </button>
        </div>
      } @else if (offline()) {
        <div class="pill reconnecting" aria-label="Calendar connection">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4"></path></svg>
          <span class="state" role="status" aria-live="polite">{{ offlineLabel() }}</span>
          <button type="button" [disabled]="live.recovering()" [attr.aria-busy]="live.recovering()" (click)="live.resync()">
            {{ live.recovering() ? 'Resyncing…' : 'Resync now' }}
          </button>
        </div>
      } @else if (show() === 'all') {
        <div class="live" aria-label="Calendar connection">
          <span class="state" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span>{{ live.recovering() ? 'Refreshing' : 'Live' }}</span>
          <button
            type="button"
            class="quiet"
            [disabled]="live.recovering()"
            [attr.aria-busy]="live.recovering()"
            [attr.aria-label]="live.recovering() ? 'Resyncing…' : 'Resync now'"
            title="Resync now"
            (click)="live.resync()"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4"></path></svg>
          </button>
        </div>
      }
    } @else {
      <app-status-line />
    }
    @if (calendar.needsReconnect() && show() !== 'live') {
      <p class="pill notice reconnect" role="alert">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 8v5M12 16.5v.5"></path><circle cx="12" cy="12" r="9"></circle></svg>
        <span>
          @if (layout() === 'wall') {
            Google Calendar needs reconnecting.@if (!problem()) { A parent can fix it in Settings on their phone.}
          } @else if (layout() === 'desktop' && problem()) {
            Google Calendar needs reconnecting.
          } @else if (session.canSignOut()) {
            Google Calendar needs reconnecting. <a routerLink="/settings/calendars">Reconnect in Settings</a>
          } @else {
            Google Calendar needs reconnecting. A parent can fix it in Settings.
          }
        </span>
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      min-width: 0;
    }

    .live {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .state {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--live);
    }

    button {
      flex-shrink: 0;
      min-height: 36px;
      padding: 0 16px;
      border: 0;
      border-radius: 22px;
      color: var(--on-ink);
      font: 700 14px var(--font-body);
      cursor: pointer;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    button.quiet {
      width: 44px;
      height: 44px;
      padding: 0;
      background: transparent;
      color: var(--muted);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pill {
      margin: 0;
      min-height: 44px;
      box-sizing: border-box;
      padding: 4px 4px 4px 16px;
      border-radius: 22px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      font-weight: 600;
    }

    .pill .state {
      color: inherit;
    }

    .reconnecting {
      background: var(--reconnecting);
      color: var(--reconnecting-ink);
    }

    .reconnecting button {
      background: var(--reconnecting-ink);
    }

    .failed {
      background: var(--failed);
      color: var(--failed-ink);
    }

    .failed button {
      background: var(--failed-ink);
    }

    .notice {
      padding-right: 16px;
      background: var(--notice);
      color: var(--notice-ink);
    }

    .notice svg {
      flex-shrink: 0;
    }

    a {
      color: inherit;
      font-weight: 700;
    }

    /* On the wall and a desktop everything stays on the toolbar's one line. */
    :host(.wall),
    :host(.desktop) {
      flex-wrap: nowrap;
    }

    :host(.wall) .pill,
    :host(.desktop) .pill {
      flex-shrink: 0;
      white-space: nowrap;
    }

    :host(.wall) .notice,
    :host(.desktop) .notice {
      flex-shrink: 1;
      min-width: 0;
    }

    :host(.wall) .notice > span,
    :host(.desktop) .notice > span {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* The phone shows problems as full-width banners above the view switch. */
    :host(.phone) {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }

    :host(.phone):empty {
      display: none;
    }

    :host(.phone) .pill {
      justify-content: space-between;
      border-radius: 16px;
    }

    :host(.phone) button {
      min-height: 44px;
    }

    :host(.phone) a {
      display: inline-block;
      min-height: 44px;
      align-content: center;
    }

    /* The wall: everything is read from across the room, and every control takes a finger. */
    :host(.wall) .state {
      font-size: 17px;
    }

    :host(.wall) .dot {
      width: 10px;
      height: 10px;
    }

    :host(.wall) .pill {
      min-height: 64px;
      padding: 4px 4px 4px 22px;
      border-radius: 32px;
      gap: 14px;
      font-size: 17px;
    }

    :host(.wall) .notice {
      min-height: 56px;
      padding-right: 22px;
    }

    :host(.wall) button {
      min-height: 56px;
      padding: 0 22px;
      border-radius: 28px;
      font-size: 16px;
    }

    :host(.wall) button.quiet {
      width: 56px;
      height: 56px;
      padding: 0;
    }
  `,
})
export class CalendarConnection {
  /** Which layout it sits in: a banner on the phone, a pill in the desktop toolbar, larger on the wall. */
  readonly layout = input<'phone' | 'desktop' | 'wall'>('phone');

  /** Everything; only problems, for the phone's banners; or only the Live dot, for the phone's header. */
  readonly show = input<'all' | 'problems' | 'live'>('all');

  protected readonly calendar = inject(CalendarStore);
  protected readonly live = inject(CalendarLive);
  protected readonly session = inject(SessionStore);
  private readonly family = inject(FamilyStore);

  protected readonly offline = computed(() => this.live.state() === 'connecting' || this.live.state() === 'reconnecting');

  /** Whether a connection problem already takes room, so the Google notice keeps to its first sentence. */
  protected readonly problem = computed(
    () => this.calendar.state().status === 'unavailable' || (this.live.available() && (this.offline() || this.calendar.refreshFailed())),
  );

  /** " · showing 4:32 PM": when the calendar on screen was read, in the family's time. */
  protected readonly showing = computed(() => {
    const at = this.calendar.shownAt();
    const family = this.family.family();
    return at && family ? ` · showing ${timeIn(family.timeZone, at)}` : '';
  });

  protected readonly offlineLabel = computed(() =>
    this.live.state() === 'connecting' && !this.calendar.shownAt() ? 'Connecting' : `Reconnecting${this.showing()}`,
  );
}
