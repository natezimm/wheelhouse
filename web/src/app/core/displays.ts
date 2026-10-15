import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

/** A wall display paired with the family. */
export interface Display {
  id: string;
  name: string;
  pairedAt: string;
  /** When the display last reached the server, to the minute. Null before it has. */
  lastSeenAt: string | null;
}

export type DisplaysState =
  | { status: 'loading' }
  | { status: 'ready'; displays: Display[] }
  | { status: 'unavailable' };

/** A display counts as online when it has reached the server this recently. It checks in every 5 minutes. */
export const ONLINE_WITHIN_MS = 10 * 60_000;

/** The family's paired displays, which parents manage from Settings on the phone. */
@Injectable({ providedIn: 'root' })
export class DisplayStore {
  private readonly http = inject(HttpClient);
  private readonly current = signal<DisplaysState>({ status: 'loading' });

  readonly state = this.current.asReadonly();

  load(): void {
    this.http.get<Display[]>('/api/devices').subscribe({
      next: (displays) => this.current.set({ status: 'ready', displays }),
      error: () => this.current.set({ status: 'unavailable' }),
    });
  }

  // As with the family, the list changes only once the server accepts.

  /** Pairs the display showing <code>; it signs itself in as soon as this succeeds. */
  pair(code: string, name: string): Observable<Display> {
    return this.http
      .post<Display>('/api/devices', { code, name })
      .pipe(tap((paired) => this.change((displays) => [...displays, paired])));
  }

  /** Removes a display, which signs it out; it goes back to showing a pairing code. */
  remove(id: string): Observable<void> {
    return this.http
      .delete<void>(`/api/devices/${id}`)
      .pipe(tap(() => this.change((displays) => displays.filter((display) => display.id !== id))));
  }

  private change(change: (displays: Display[]) => Display[]): void {
    this.current.update((state) => (state.status === 'ready' ? { status: 'ready', displays: change(state.displays) } : state));
  }
}
