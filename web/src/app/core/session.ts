import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

export interface Session {
  /** Demo: the public instance with a fictional family. Family: a real family's private one. */
  mode: 'Demo' | 'Family';
  signedIn: boolean;
}

/** What kind of instance this is and whether the visitor is signed in. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly http = inject(HttpClient);
  private readonly current = signal<Session | null>(null);

  readonly isDemo = computed(() => this.current()?.mode === 'Demo');

  load(): void {
    this.http.get<Session>('/api/session').subscribe({
      next: (session) => this.current.set(session),
      // Leave it unknown: the status line already says when the server cannot be reached.
      error: () => this.current.set(null),
    });
  }
}
