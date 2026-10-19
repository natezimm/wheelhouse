import { FamilyStore } from './family';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, tap } from 'rxjs';

export interface Session {
  /** Demo: the public instance with a fictional family. Family: a real family's private one. */
  mode: 'Demo' | 'Family';
  signedIn: boolean;
  /** A family instance with Google sign-in set up, so a parent can sign in here. */
  canSignIn: boolean;
}

type SessionState =
  | { status: 'unknown' }
  | { status: 'family'; signedIn: boolean; canSignIn: boolean }
  /** A demo visitor with their own private copy of the demo family. */
  | { status: 'demo' }
  /** A demo that has no room for another visitor right now. */
  | { status: 'demo-full' };

/** What kind of instance this is, and the demo visitor's way in. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly http = inject(HttpClient);
  private readonly family = inject(FamilyStore);
  private readonly current = signal<SessionState>({ status: 'unknown' });

  readonly isDemo = computed(() => this.current().status === 'demo');
  readonly isDemoFull = computed(() => this.current().status === 'demo-full');
  /** A family instance where a parent can sign in with Google and nobody is signed in yet. */
  readonly canSignIn = computed(() => {
    const state = this.current();
    return state.status === 'family' && state.canSignIn && !state.signedIn;
  });
  /** A parent signed in with Google, who can sign out. Demo visitors cannot. */
  readonly canSignOut = computed(() => {
    const state = this.current();
    return state.status === 'family' && state.signedIn;
  });

  /**
   * Runs once, before the app's first screen. On a demo instance it checks the visitor in,
   * which gives a newcomer their own copy of the demo family and the cookie for it; every
   * other request needs that cookie, so they must wait for this to finish. It never rejects:
   * if the server cannot be reached the app still starts, and its status line says so.
   */
  async start(): Promise<void> {
    try {
      const session = await firstValueFrom(this.http.get<Session>('/api/session'));
      if (session.mode !== 'Demo') {
        this.current.set({ status: 'family', signedIn: session.signedIn, canSignIn: session.canSignIn });
        return;
      }

      try {
        await firstValueFrom(this.http.post('/api/demo/visit', null));
        this.current.set({ status: 'demo' });
      } catch {
        this.current.set({ status: 'demo-full' });
      }
    } catch {
      this.current.set({ status: 'unknown' });
    }
  }

  /** Ends a parent's sign-in. The session changes only once the server has signed them out. */
  signOut(): Observable<void> {
    return this.http.post<void>('/api/auth/sign-out', null).pipe(
      tap(() => {
        this.family.forget();
        this.current.update((state) => (state.status === 'family' ? { ...state, signedIn: false } : state));
      }),
    );
  }
}

/**
 * Where "Sign in with Google" goes: the API sends the browser on to Google and, once a parent
 * is signed in, back to <returnUrl>. The browser's time zone becomes the family's if this
 * first sign-in creates it.
 */
export function googleSignInUrl(returnUrl = '/'): string {
  const query = new URLSearchParams({ returnUrl, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return `/api/auth/google?${query}`;
}
