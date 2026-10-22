import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** The phone's sections, along the bottom of the screen: the calendar and Settings. */
@Component({
  selector: 'app-phone-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav aria-label="Sections">
      <a routerLink="/" routerLinkActive="current" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path></svg>
        Calendar
      </a>
      <a routerLink="/settings" routerLinkActive="current" ariaCurrentWhenActive="page">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"></path></svg>
        Settings
      </a>
    </nav>
  `,
  styles: `
    :host {
      position: sticky;
      bottom: 0;
      z-index: 3;
      display: block;
    }

    nav {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: center;
      height: 76px;
      padding: 0 6px 16px;
      box-sizing: border-box;
      background: var(--surface);
      border-top: 1px solid var(--rule);
      box-shadow: 0 -10px 24px color-mix(in srgb, var(--ground) 95%, transparent);
    }

    a {
      min-height: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
    }

    a.current {
      color: var(--ink);
      font-weight: 700;
    }
  `,
})
export class PhoneNav {}
