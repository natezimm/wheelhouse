import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

export type ServerStatus = 'checking' | 'live' | 'offline';

/** Whether the API is reachable and healthy, from its /health endpoint. */
@Injectable({ providedIn: 'root' })
export class ServerHealth {
  private readonly http = inject(HttpClient);
  private readonly state = signal<ServerStatus>('checking');

  readonly status = this.state.asReadonly();

  /** Asks the API once. A 503 or a network failure both count as offline. */
  check(): void {
    this.http.get('/health').subscribe({
      next: () => this.state.set('live'),
      error: () => this.state.set('offline'),
    });
  }
}
