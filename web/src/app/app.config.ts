import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { CalendarLive } from './core/calendar-live';
import { SessionStore } from './core/session';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    // The first screen waits for this: a demo visitor needs their cookie before anything loads.
    provideAppInitializer(() => {
      const session = inject(SessionStore);
      const live = inject(CalendarLive);
      return session.start().then(() => live.start());
    }),
    // Route parameters such as a member's id arrive as component inputs.
    provideRouter(routes, withComponentInputBinding())
  ]
};

