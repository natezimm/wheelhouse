import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { NavigationEnd, Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { filter, take } from 'rxjs';
import { routes } from './app.routes';
import { CalendarLive } from './core/calendar-live';
import { ReportingErrorHandler } from './core/error-reporting';
import { FamilyStore } from './core/family';
import { SessionStore } from './core/session';
import { traceContextInterceptor } from './core/trace-context';

/**
 * Starts fetching the first screen's code while the visitor is checked in, rather than after, so
 * the two waits overlap. The router's own import of the same module then finds it loaded.
 */
function preloadFirstScreen(path: string): void {
  const load = path === '/' || path === '/calendar' ? import('./home/calendar-home') : path.startsWith('/wall') ? import('./wall/wall-shell') : null;
  // A failed preload changes nothing: the router asks again and reports a failure itself.
  void load?.catch(() => {});
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Errors also go to the API's log, so a wall nobody watches can say what went wrong.
    { provide: ErrorHandler, useFactory: () => new ReportingErrorHandler() },
    // Each API call starts a trace whose id is logged if it fails (docs/observability.md).
    provideHttpClient(withInterceptors([traceContextInterceptor])),
    // The first screen waits for this: a demo visitor needs their cookie before anything loads.
    // The family is asked for as soon as the cookie exists, alongside the first screen's code.
    provideAppInitializer(() => {
      const session = inject(SessionStore);
      const family = inject(FamilyStore);
      const live = inject(CalendarLive);
      preloadFirstScreen(location.pathname);
      // Only the first screen takes the startup read; it has opened once its navigation ends.
      inject(Router)
        .events.pipe(filter((event) => event instanceof NavigationEnd), take(1))
        .subscribe(() => family.endPrefetch());
      return session.start().then(() => {
        family.prefetch();
        live.start();
      });
    }),
    // Route parameters such as a member's id arrive as component inputs.
    provideRouter(routes, withComponentInputBinding())
  ]
};


