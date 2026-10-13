import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Clock } from '../core/clock';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { DemoNotice } from '../shared/demo-notice';
import { MemberAvatar } from '../shared/member-avatar';
import { StatusLine } from '../shared/status-line';

/** The wall display's frame: date, clock, who is in the family, and connection status. Sized for 1920 × 1080. */
@Component({
  selector: 'app-wall-shell',
  imports: [DatePipe, DemoNotice, MemberAvatar, StatusLine],
  template: `
    <header>
      <div class="now">
        <h1>{{ clock.now() | date: 'EEEE, MMMM d' }}</h1>
        <span class="time">{{ clock.now() | date: 'h:mm a' }}</span>
      </div>
      <ul class="members" aria-label="Family members">
        @for (member of family.members(); track member.id) {
          <li [style.--member]="member.color">
            <app-member-avatar [member]="member" />
            {{ member.displayName }}
          </li>
        }
      </ul>
    </header>

    @if (family.state().status === 'private' && !session.isDemoFull()) {
      <p class="private">This Wheelhouse is private.</p>
    }

    <footer>
      <app-status-line />
      <app-demo-notice />
    </footer>
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 28px 36px 24px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    header,
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }

    .now {
      display: flex;
      align-items: baseline;
      gap: 20px;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 52px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .time {
      font-family: var(--font-display);
      font-size: 34px;
      color: var(--muted);
    }

    .members {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      gap: 10px;
    }

    /* Each chip is tinted with its member's color, as in the mockups. */
    .members li {
      display: flex;
      align-items: center;
      gap: 9px;
      height: 56px;
      padding: 0 20px 0 11px;
      border-radius: 28px;
      background: color-mix(in srgb, var(--member) 14%, white);
      font-size: 18px;
      font-weight: 600;
    }

    .private {
      margin: 0;
      text-align: center;
      font-family: var(--font-display);
      font-size: 34px;
      color: var(--muted);
    }
  `,
})
export class WallShell {
  protected readonly clock = inject(Clock);
  protected readonly family = inject(FamilyStore);

  protected readonly session = inject(SessionStore);

  constructor() {
    this.family.load();
  }
}
