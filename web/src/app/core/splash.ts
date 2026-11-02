import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs';
import { CalendarStore } from './calendar';
import { FamilyStore } from './family';
import { SessionStore } from './session';

/** The splash's id in index.html. */
export const SPLASH_ID = 'splash';

/** How long the splash takes to fade, matching its transition in index.html. */
export const SPLASH_FADE_MS = 500;

/**
 * The longest the splash stays once the app has started. Past this the screen underneath says
 * itself that it is still loading, which is more use than the splash.
 */
export const SPLASH_LONGEST_MS = 6000;

/** The calendar's own screens, which keep the splash until they have a calendar to show. */
function isCalendarScreen(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return path === '/' || path === '/wall' || path.startsWith('/wall/');
}

/**
 * The splash index.html draws before any of the app's code has arrived. It stays over the app
 * until the first screen has something to show, then fades away and is removed: on the calendar
 * that is its first answer (events or a failure), or a reason there is none (signed out, the demo
 * could not start); on any other screen, as soon as it opens.
 */
@Injectable({ providedIn: 'root' })
export class Splash {
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(SessionStore);
  private readonly family = inject(FamilyStore);
  private readonly calendar = inject(CalendarStore);
  private readonly firstUrl = signal<string | null>(null);
  private done = false;

  /** Whether the first screen has something to show. */
  readonly ready = computed(() => {
    const url = this.firstUrl();
    if (url === null) return false;
    if (!isCalendarScreen(url) || this.session.demoUnavailable()) return true;
    const family = this.family.state().status;
    if (family === 'private' || family === 'unavailable') return true;
    const calendar = this.calendar.state().status;
    return calendar === 'ready' || calendar === 'unavailable';
  });

  /** Called once by the app: dismisses the splash when the first screen is ready, or after a while regardless. */
  follow(): void {
    inject(Router)
      .events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        take(1),
      )
      .subscribe((event) => this.firstUrl.set(event.urlAfterRedirects));
    effect(() => {
      if (this.ready()) this.dismiss();
    });
    const longest = setTimeout(() => this.dismiss(), SPLASH_LONGEST_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(longest));
  }

  /** Fades the splash out. Calling it again, or with no splash on the page, does nothing. */
  dismiss(): void {
    if (this.done) return;
    this.done = true;
    const splash = this.document.getElementById(SPLASH_ID);
    if (!splash) return;
    // Its status line stops speaking for the page once the page can speak for itself.
    splash.setAttribute('aria-hidden', 'true');
    // One frame first, so the screen underneath has painted before the splash starts to fade.
    const view = this.document.defaultView;
    const fade = () => {
      splash.classList.add('splash-leaving');
      setTimeout(() => splash.remove(), SPLASH_FADE_MS);
    };
    if (view?.requestAnimationFrame) view.requestAnimationFrame(() => fade());
    else fade();
  }
}
