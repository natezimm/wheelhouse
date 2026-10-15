import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

/** A code the API issued for this display, and the private id it asks about it with. */
export interface PairingCode {
  id: string;
  code: string;
  expiresAt: string;
}

export type PairingState =
  | { status: 'idle' }
  | { status: 'showing'; code: string }
  /** A parent entered the code, and this browser is now signed in as the family's display. */
  | { status: 'paired' }
  /** The server could not be reached; it keeps trying. */
  | { status: 'unavailable' };

/** How often the display asks whether a parent has entered its code. */
export const ASK_EVERY_MS = 3_000;

/** How long the display waits before trying again when the server cannot be reached. */
export const RETRY_AFTER_MS = 10_000;

/**
 * The wall display's side of pairing: it gets a code to show, then keeps asking the API
 * whether a parent has typed it on their phone. When one has, the API's answer carries the
 * display's sign-in cookie. An expired code is replaced by a new one without anyone touching
 * the wall.
 */
@Injectable({ providedIn: 'root' })
export class WallPairing {
  private readonly http = inject(HttpClient);
  private readonly current = signal<PairingState>({ status: 'idle' });

  readonly state = this.current.asReadonly();

  private timer?: ReturnType<typeof setTimeout>;
  /** Bumped by begin() and end(), so an answer to an abandoned request changes nothing. */
  private run = 0;

  /** Shows a new code and keeps asking about it until it is entered or end() is called. */
  begin(): void {
    this.end();
    this.requestCode(this.run);
  }

  end(): void {
    this.run++;
    clearTimeout(this.timer);
    this.current.set({ status: 'idle' });
  }

  private requestCode(run: number): void {
    this.http.post<PairingCode>('/api/pairing', null).subscribe({
      next: (pairing) => {
        if (run !== this.run) return;
        this.current.set({ status: 'showing', code: pairing.code });
        this.later(run, () => this.ask(run, pairing.id), ASK_EVERY_MS);
      },
      error: () => {
        if (run !== this.run) return;
        this.current.set({ status: 'unavailable' });
        this.later(run, () => this.requestCode(run), RETRY_AFTER_MS);
      },
    });
  }

  private ask(run: number, pairingId: string): void {
    this.http.post(`/api/pairing/${pairingId}/finish`, null, { observe: 'response' }).subscribe({
      next: (response) => {
        if (run !== this.run) return;
        if (response.status === 204) {
          this.current.set({ status: 'paired' });
        } else {
          this.later(run, () => this.ask(run, pairingId), ASK_EVERY_MS);
        }
      },
      error: (error: HttpErrorResponse) => {
        if (run !== this.run) return;
        // The code expired: show a new one. Anything else is a blip; keep asking.
        if (error.status === 404) {
          this.requestCode(run);
        } else {
          this.later(run, () => this.ask(run, pairingId), ASK_EVERY_MS);
        }
      },
    });
  }

  private later(run: number, next: () => void, ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => run === this.run && next(), ms);
  }
}
