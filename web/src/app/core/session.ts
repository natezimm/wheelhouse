import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, TimeoutError, firstValueFrom, retry, tap, throwError, timeout, timer } from 'rxjs';

export interface Session {
  /** Demo: the public instance with a fictional family. Family: a real family's private one. */
  mode: 'Demo' | 'Family';
  signedIn: boolean;
  /** A family instance with Google sign-in set up, so a parent can sign in here. */
  canSignIn: boolean;
  /** Signed in as a paired display, which reads the family but is not a parent. */
  isDisplay?: boolean;
  /** The AI features this instance offers a parent (off unless the instance turns them on). */
  ai?: { describe: boolean; ask: boolean };
}

/**
 * A check-in that never got an answer (the connection dropped, or the browser gave up) or met a
 * server error is tried again this many times, this far apart, before the demo says it could not start.
 */
export const VISIT_RETRIES = 2;
export const VISIT_RETRY_MS = 1000;

/**
 * How long the first screen waits for each startup request. A request that hangs rather than
 * fails counts as no answer, so the app always starts and says what went wrong.
 */
export const START_TIMEOUT_MS = 8000;

type SessionState =
  | { status: 'unknown' }
  | { status: 'family'; signedIn: boolean; canSignIn: boolean; isDisplay: boolean }
  /** A demo visitor with their own private copy of the demo family. */
  | { status: 'demo'; isDisplay: boolean }
  /** A demo that could not check this visitor in: too many new visits from their network, or a failure. */
  | { status: 'demo-unavailable'; reason: 'busy' | 'failed' };

/** What kind of instance this is, and the demo visitor's way in. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly http = inject(HttpClient);
  private readonly current = signal<SessionState>({ status: 'unknown' });
  private readonly ai = signal<{ describe: boolean; ask: boolean }>({ describe: false, ask: false });

  /** Describe it: a parent's words fill in a new event. Never for a display, which has no keyboard. */
  readonly canDescribe = computed(() => this.ai().describe && !this.isDisplay());
  /** Whether Ask the calendar is offered: the features are on and this is not a paired display. */
  readonly canAsk = computed(() => this.ai().ask && !this.isDisplay());

  readonly isDemo = computed(() => this.current().status === 'demo');
  /** Why the demo could not check this visitor in, or null. */
  readonly demoUnavailable = computed(() => {
    const state = this.current();
    return state.status === 'demo-unavailable' ? state.reason : null;
  });
  /** A family instance where a parent can sign in with Google and nobody is signed in yet. */
  readonly canSignIn = computed(() => {
    const state = this.current();
    return state.status === 'family' && state.canSignIn && !state.signedIn;
  });
  /** This browser is paired as a display: it shows the family, but only a parent changes settings. */
  readonly isDisplay = computed(() => {
    const state = this.current();
    return (state.status === 'family' || state.status === 'demo') && state.isDisplay;
  });
  /** A parent signed in with Google, or a paired display, who can sign out. Demo visitors cannot. */
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
      const session = await firstValueFrom(this.http.get<Session>('/api/session').pipe(timeout(START_TIMEOUT_MS)));
      this.ai.set({ describe: !!session.ai?.describe, ask: !!session.ai?.ask });
      if (session.mode !== 'Demo') {
        this.current.set({
          status: 'family',
          signedIn: session.signedIn,
          canSignIn: session.canSignIn,
          isDisplay: session.signedIn && !!session.isDisplay,
        });
        return;
      }

      const visit = await this.visit();
      this.current.set(visit === 'ok' ? { status: 'demo', isDisplay: !!session.isDisplay } : { status: 'demo-unavailable', reason: visit });
    } catch {
      this.current.set({ status: 'unknown' });
    }
  }

  /**
   * On the demo, checks the visitor in again after their sign-in stopped working: their copy
   * expired with the tab left open, or made room for newer visitors. They get a fresh copy rather
   * than a screen saying the Wheelhouse is private. Resolves whether they have one; when not, the
   * demo says it could not start. Elsewhere it does nothing and resolves false.
   */
  async rejoin(): Promise<boolean> {
    if (!this.isDemo()) return false;
    const visit = await this.visit();
    // A fresh copy is a parent's, never a paired wall's.
    this.current.set(visit === 'ok' ? { status: 'demo', isDisplay: false } : { status: 'demo-unavailable', reason: visit });
    return visit === 'ok';
  }

  /** Asks the demo for this visitor's copy, retrying a lost answer or a server error. */
  private async visit(): Promise<'ok' | 'busy' | 'failed'> {
    try {
      await firstValueFrom(
        this.http.post('/api/demo/visit', null).pipe(
          timeout(START_TIMEOUT_MS),
          retry({
            count: VISIT_RETRIES,
            delay: (error) =>
              error instanceof TimeoutError || (error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500))
                ? timer(VISIT_RETRY_MS)
                : throwError(() => error),
          }),
        ),
      );
      return 'ok';
    } catch (error) {
      return error instanceof HttpErrorResponse && error.status === 429 ? 'busy' : 'failed';
    }
  }

  /** Ends a parent's or a display's sign-in. The session changes only once the server has signed them out. */
  signOut(): Observable<void> {
    return this.http.post<void>('/api/auth/sign-out', null).pipe(
      tap(() =>
        this.current.update((state) => (state.status === 'family' ? { ...state, signedIn: false, isDisplay: false } : state)),
      ),
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
