import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, ErrorHandler, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { CalendarLive } from './core/calendar-live';
import { ReportingErrorHandler } from './core/error-reporting';
import { SessionStore } from './core/session';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Errors also go to the API's log, so a wall nobody watches can say what went wrong.
    { provide: ErrorHandler, useFactory: () => new ReportingErrorHandler() },
    provideHttpClient(),
    // The first screen waits for this: a demo visitor needs their cookie before anything loads.
    provideAppInitializer(() => {
      const session = inject(SessionStore);
      const live = inject(CalendarLive);
      return session.start().then(() => { live.start(); });
    }),
    // Route parameters such as a member's id arrive as component inputs.
    provideRouter(routes, withComponentInputBinding())
  ]
};


