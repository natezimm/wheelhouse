import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * What Wheelhouse does with Google data, at /privacy. Google asks for this page before it lets
 * the family's OAuth app keep a Calendar token, and it is open to anyone, signed in or not.
 */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink],
  template: `
    <header>
      <a class="back" routerLink="/" aria-label="Back to Today">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </a>
      <h1>Privacy</h1>
    </header>

    <article class="card">
      <p>
        Wheelhouse is a family calendar for a wall display and the family's phones. Each Wheelhouse is run by one family for
        itself, on a server it controls. This page explains what it does with data from Google.
      </p>

      <h2>Signing in</h2>
      <p>
        Parents sign in with their own Google accounts. Wheelhouse reads only the account's name, email address and Google's
        id for it, to know which parent is signing in. Only addresses the family has listed can sign in.
      </p>

      <h2>The family's calendars</h2>
      <p>
        A parent connects one Google account that holds the family's calendars and chooses which of its calendars to show.
        Wheelhouse then reads those calendars and their events (titles, times, places and whether they repeat) and keeps a
        copy on the family's server so the wall and the phones can show them. When a parent adds or changes an event in
        Wheelhouse, it writes that change to the same calendar in Google.
      </p>
      <p>
        To keep the calendars up to date with nobody signed in, Wheelhouse keeps the token Google issues for that account. It
        is stored encrypted and is never sent to the wall or the phones.
      </p>

      <h2>Who sees it</h2>
      <p>
        Only people the family lets in: its parents, and the wall displays a parent has paired. Wheelhouse does not sell,
        share or show Google data to anyone else, uses it for nothing but showing and editing the family's own calendar, and
        has no ads or analytics.
      </p>
      <p>
        Wheelhouse's use and transfer of information received from Google APIs adheres to the
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>

      <h2>Other services</h2>
      <p>
        For the weather, Wheelhouse sends the family's location, rounded to about a kilometer, to Open-Meteo. The screens load
        their fonts from Google Fonts.
      </p>

      <h2>Removing it</h2>
      <p>
        A parent can disconnect Google in Settings. Wheelhouse then tells Google to withdraw its access and deletes the token
        and its copy of the calendars. The calendars themselves stay in Google, untouched. Access can also be removed from the
        Google account at <a href="https://myaccount.google.com/connections">myaccount.google.com/connections</a>.
      </p>

      <h2>The demo</h2>
      <p>The public demo shows a made-up family. It never connects to Google, and each visitor's copy is deleted within a day.</p>
    </article>
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

    article {
      gap: 10px;
      font-size: 15px;
      line-height: 1.5;
    }

    h2 {
      margin: 8px 0 0;
      font-family: var(--font-display);
      font-size: 18px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
    }

    p {
      margin: 0;
    }

    a {
      color: var(--accent);
    }
  `,
})
export class Privacy {}
