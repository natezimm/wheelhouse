import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Clock } from '../core/clock';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { DemoNotice } from '../shared/demo-notice';
import { MemberAvatar } from '../shared/member-avatar';
import { StatusLine } from '../shared/status-line';

/** The phone layout's frame: today's date, who is in the family, and connection status. Sized for a 390 px wide screen. */
@Component({
  selector: 'app-phone-shell',
  imports: [DatePipe, DemoNotice, MemberAvatar, RouterLink, StatusLine],
  template: `
    <header>
      <div class="title">
        <span class="date">{{ clock.now() | date: 'EEE, MMM d' }}</span>
        <h1>Today</h1>
      </div>
      <a class="family" routerLink="/settings">
        <span class="sr-only">Family settings:</span>
        <ul class="members">
          @for (member of family.members(); track member.id) {
            <li>
              <app-member-avatar [member]="member" />
              <span class="sr-only">{{ member.displayName }}</span>
            </li>
          }
        </ul>
      </a>
    </header>

    @if (family.state().status === 'private' && !session.isDemoFull()) {
      <p class="private">This Wheelhouse is private.</p>
    }

    <footer>
      <app-demo-notice />
      <app-status-line />
    </footer>
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 24px 18px 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
    }

    .title {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .date {
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 34px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    /* Overlapping avatars, each ringed in the page color so they read as separate. */
    .members {
      --avatar-size: 32px;
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
    }

    .members li {
      border-radius: 50%;
      box-shadow: 0 0 0 2px var(--ground);
    }

    .members li + li {
      margin-left: -6px;
    }

    /* The avatars are the way into Settings; keep the tap target comfortable. */
    .family {
      display: flex;
      align-items: center;
      min-height: 44px;
      text-decoration: none;
    }

    .private {
      margin: 0;
      text-align: center;
      font-family: var(--font-display);
      font-size: 22px;
      color: var(--muted);
    }

    footer {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
  `,
})
export class PhoneShell {
  protected readonly clock = inject(Clock);
  protected readonly family = inject(FamilyStore);

  protected readonly session = inject(SessionStore);

  constructor() {
    this.family.load();
  }
}
