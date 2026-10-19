import { CalendarStore } from '../core/calendar';
import { Component, DestroyRef, computed, inject } from '@angular/core';
import { ServerHealth, ServerStatus } from '../core/server-health';

const RECHECK_EVERY_MS = 30_000;

const LABELS: Record<ServerStatus, string> = {
  checking: 'Connecting to the server…',
  live: 'Server connected',
  offline: 'Reconnecting…',
};

/** A dot and a few words saying whether this screen can reach the server. */
@Component({
  selector: 'app-status-line',
  template: `
    <span class="dot" [class]="status()" aria-hidden="true"></span>
    <span role="status">{{ label() }}</span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 15px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: var(--line);
    }

    .dot.live {
      background: var(--ok);
    }

    .dot.offline {
      background: var(--warn);
    }
  `,
})
export class StatusLine {
  protected readonly health = inject(ServerHealth);
  private readonly calendar = inject(CalendarStore);
  protected readonly status = computed(() => {
    const live = this.calendar.connection();
    return live === 'idle' ? this.health.status() : live === 'live' ? 'live' : live === 'connecting' ? 'checking' : 'offline';
  });
  protected readonly label = computed(() => {
    const live = this.calendar.connection();
    return live === 'idle' ? LABELS[this.health.status()] : live === 'live' ? 'Calendar connected' :
      live === 'connecting' ? 'Connecting to the calendar…' : 'Calendar reconnecting…';
  });

  constructor() {
    this.health.check();
    const timer = setInterval(() => this.health.check(), RECHECK_EVERY_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
