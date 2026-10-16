import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** The phone's sections, along the bottom of the screen. More join as their features land. */
@Component({
  selector: 'app-phone-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav aria-label="Sections">
      <a routerLink="/" routerLinkActive="current" [routerLinkActiveOptions]="{ exact: true }" ariaCurrentWhenActive="page">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7M6 10v9h12v-9"></path></svg>
        Today
      </a>
      <a routerLink="/calendar" routerLinkActive="current" ariaCurrentWhenActive="page">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"></rect><path d="M3.5 10h17M8 3v4M16 3v4"></path></svg>
        Calendar
      </a>
    </nav>
  `,
  styles: `
    :host {
      position: sticky;
      bottom: 0;
      margin: 0 -18px -12px;
    }

    nav {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      align-items: center;
      height: 84px;
      padding: 0 6px 18px;
      box-sizing: border-box;
      background: var(--surface);
      border-top: 1px solid #e2ded6;
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
