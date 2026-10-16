import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { CalendarStore } from './calendar';

/** The phone's "Connect Google Calendar" link. The API sends the browser on to Google's consent screen. */
export const GOOGLE_CONNECT_URL = '/api/calendar/google/connect';

/** Whether this Wheelhouse can connect Google, and which account it has connected. */
export interface GoogleConnection {
  /** False on the demo, which never calls Google. */
  canConnect: boolean;
  /** The shared account's address, or null when none is connected. */
  email: string | null;
  /** NeedsReauth when Google stopped accepting the connection and a parent has to connect again. */
  status: 'Connected' | 'NeedsReauth' | null;
}

/** A calendar a parent can choose to show, and whose it is. */
export interface CalendarChoice {
  googleCalendarId: string;
  name: string;
  /** The calendar's color in Google, as a hint for which is which. */
  color: string | null;
  shown: boolean;
  /** The member it belongs to; null is the whole family's. */
  memberId: string | null;
}

export type GoogleConnectionState =
  | { status: 'loading' }
  | { status: 'ready'; connection: GoogleConnection }
  | { status: 'unavailable' };

export type CalendarChoicesState =
  | { status: 'loading' }
  | { status: 'ready'; calendars: CalendarChoice[] }
  /** Google stopped accepting the connection; a parent has to connect again before choosing. */
  | { status: 'reconnect' }
  | { status: 'unavailable' };

/** The family's Google connection and which of its calendars show. Parents manage both from Settings. */
@Injectable({ providedIn: 'root' })
export class GoogleStore {
  private readonly http = inject(HttpClient);
  private readonly calendar = inject(CalendarStore);
  private readonly connection = signal<GoogleConnectionState>({ status: 'loading' });
  private readonly choices = signal<CalendarChoicesState>({ status: 'loading' });

  readonly state = this.connection.asReadonly();
  readonly calendars = this.choices.asReadonly();

  load(): void {
    this.http.get<GoogleConnection>('/api/calendar/google').subscribe({
      next: (connection) => this.connection.set({ status: 'ready', connection }),
      error: () => this.connection.set({ status: 'unavailable' }),
    });
  }

  /** Forgets the shared account, and with it the family's calendars. */
  disconnect(): Observable<void> {
    return this.http.delete<void>('/api/calendar/google').pipe(
      tap(() => {
        this.connection.update((state) =>
          state.status === 'ready' ? { status: 'ready', connection: { ...state.connection, email: null, status: null } } : state,
        );
        this.calendar.refresh();
      }),
    );
  }

  loadChoices(): void {
    this.choices.set({ status: 'loading' });
    this.http.get<{ calendars: CalendarChoice[] }>('/api/calendar/sources').subscribe({
      next: ({ calendars }) => this.choices.set({ status: 'ready', calendars }),
      error: (error: HttpErrorResponse) => this.choices.set({ status: error.status === 409 ? 'reconnect' : 'unavailable' }),
    });
  }

  /** Shows exactly the calendars given, each as its member's or the whole family's. */
  saveChoices(chosen: Pick<CalendarChoice, 'googleCalendarId' | 'memberId'>[]): Observable<{ calendars: CalendarChoice[] }> {
    return this.http.put<{ calendars: CalendarChoice[] }>('/api/calendar/sources', { calendars: chosen }).pipe(
      tap(({ calendars }) => {
        this.choices.set({ status: 'ready', calendars });
        this.calendar.refresh();
      }),
    );
  }
}
