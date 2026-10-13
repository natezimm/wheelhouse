import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

export interface Member {
  id: string;
  displayName: string;
  /** Hex color such as #2F5FC4. It identifies the member on every screen. */
  color: string;
  initial: string;
  role: 'Parent' | 'Kid';
}

export interface Family {
  id: string;
  name: string;
  timeZone: string;
  weekStartsOn: string;
  members: Member[];
}

export type FamilyState =
  | { status: 'loading' }
  | { status: 'ready'; family: Family }
  /** The instance is private and nobody is signed in. */
  | { status: 'private' }
  | { status: 'unavailable' };

/** The signed-in family and its members, shared by every screen. */
@Injectable({ providedIn: 'root' })
export class FamilyStore {
  private readonly http = inject(HttpClient);
  private readonly current = signal<FamilyState>({ status: 'loading' });

  readonly state = this.current.asReadonly();
  readonly members = computed(() => {
    const state = this.current();
    return state.status === 'ready' ? state.family.members : [];
  });

  load(): void {
    this.http.get<Family>('/api/family').subscribe({
      next: (family) => this.current.set({ status: 'ready', family }),
      error: (error: HttpErrorResponse) =>
        this.current.set({ status: error.status === 401 ? 'private' : 'unavailable' }),
    });
  }
}
