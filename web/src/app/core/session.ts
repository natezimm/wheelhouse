import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Session {
  /** Demo: the public instance with a fictional family. Family: a real family's private one. */
  mode: 'Demo' | 'Family';
  signedIn: boolean;
}

type SessionState =
  | { status: 'unknown' }
  | { status: 'family' }
  /** A demo visitor with their own private copy of the demo family. */
  | { status: 'demo' }
  /** A demo that has no room for another visitor right now. */
  | { status: 'demo-full' };

/** What kind of instance this is, and the demo visitor's way in. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly http = inject(HttpClient);
  private readonly current = signal<SessionState>({ status: 'unknown' });

  readonly isDemo = computed(() => this.current().status === 'demo');
  readonly isDemoFull = computed(() => this.current().status === 'demo-full');

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
        this.current.set({ status: 'family' });
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
}
