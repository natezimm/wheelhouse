import { DatePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Clock } from '../core/clock';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { DemoNotice } from '../shared/demo-notice';
import { MemberAvatar } from '../shared/member-avatar';
import { StatusLine } from '../shared/status-line';
import { PhoneNav } from './phone-nav';
import { SignIn } from './sign-in';
import { TodayEvents } from './today-events';

/**
 * The phone's Today screen: the date, who is in the family, what is on the calendar for the
 * rest of the day, and connection status. Sized for a 390 px wide screen.
 */
@Component({
  selector: 'app-phone-shell',
  imports: [DatePipe, DemoNotice, MemberAvatar, PhoneNav, RouterLink, SignIn, StatusLine, TodayEvents],
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
      <app-sign-in [outcome]="signin()" />
    } @else if (family.state().status === 'ready') {
      <app-today-events />
    }

    <footer>
      <app-demo-notice />
      <app-status-line />
    </footer>

    <app-phone-nav />
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 24px 18px 12px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    app-sign-in {
      margin: auto 0;
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

    footer {
      margin-top: auto;
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

  /** Set by the API when Google sent someone back without signing them in: refused or failed. */
  readonly signin = input<string>();

  constructor() {
    this.family.load();
  }
}
