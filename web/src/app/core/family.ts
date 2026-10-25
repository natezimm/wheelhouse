import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

export interface Member {
  id: string;
  displayName: string;
  /** Hex color such as #2F5FC4. It identifies the member on every screen. */
  color: string;
  initial: string;
  role: 'Parent' | 'Kid';
  /** A built-in picture (`core/avatars.ts`) shown instead of the initial. */
  avatar?: string | null;
}

export interface Family {
  id: string;
  name: string;
  timeZone: string;
  weekStartsOn: 'Sunday' | 'Monday';
  /** Local times as HH:mm:ss. Every screen turns dark between them when nightMode is AtNight. */
  nightModeFrom: string;
  nightModeTo: string;
  /** How every screen of the family looks. */
  theme: Theme;
  /** When every screen uses its theme's dark look. */
  nightMode: NightMode;
  units: 'Imperial' | 'Metric';
  /** Where the weather is for, to about a kilometre. Null until a parent sets it. */
  latitude: number | null;
  longitude: number | null;
  members: Member[];
}

export type Theme = 'Daylight' | 'Groovy' | 'Classic' | 'Bold';

export type NightMode = 'Off' | 'AtNight' | 'Always';

/** What a parent can change about the family itself. The theme has its own save. */
export type FamilySettings = Omit<Family, 'id' | 'members' | 'latitude' | 'longitude' | 'theme' | 'nightMode'>;

/** What a parent enters for a member; the server assigns the rest. */
export type MemberDraft = Pick<Member, 'displayName' | 'color' | 'role' | 'avatar'>;

/**
 * The colors a member can have. White text reads clearly on every one of them, which the
 * avatars rely on.
 */
export const MEMBER_COLORS = [
  { name: 'Blue', value: '#2F5FC4' },
  { name: 'Orange', value: '#B85A14' },
  { name: 'Teal', value: '#137A6D' },
  { name: 'Purple', value: '#7243B8' },
  { name: 'Magenta', value: '#A8326E' },
  { name: 'Green', value: '#2E7D32' },
  { name: 'Red', value: '#B3261E' },
  { name: 'Slate', value: '#5B6470' },
] as const;

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

  /** Counts accepted changes, so a check-in that started before one cannot undo it. */
  private writes = 0;

  readonly state = this.current.asReadonly();

  /** The family once loaded, or null. */
  readonly family = computed(() => {
    const state = this.current();
    return state.status === 'ready' ? state.family : null;
  });
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

  /**
   * The wall's regular check-in. It picks up changes made on a phone and notices when the
   * display has been removed, but a failed attempt keeps what is on screen.
   */
  refresh(): void {
    const writes = this.writes;
    this.http.get<Family>('/api/family').subscribe({
      // An unchanged family keeps its object, so nothing that depends on it works again for nothing.
      next: (family) => {
        if (writes !== this.writes) {
          return;
        }
        const state = this.current();
        if (state.status !== 'ready' || JSON.stringify(state.family) !== JSON.stringify(family)) {
          this.current.set({ status: 'ready', family });
        }
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.current.set({ status: 'private' });
        }
      },
    });
  }

  // Each change below reaches the server first; the store updates only once it is accepted,
  // so a refused change never shows on screen.

  saveSettings(settings: FamilySettings): Observable<Family> {
    return this.http
      .put<Family>('/api/family', settings)
      .pipe(tap((family) => this.accept(family)));
  }

  /** Sets where the weather is for; null for both clears it. */
  saveLocation(latitude: number | null, longitude: number | null): Observable<Family> {
    return this.http
      .put<Family>('/api/family/location', { latitude, longitude })
      .pipe(tap((family) => this.accept(family)));
  }

  /** Chooses the family's theme, and whether screens turn dark at night. */
  saveTheme(theme: Theme, nightMode: NightMode): Observable<Family> {
    return this.http
      .put<Family>('/api/family/theme', { theme, nightMode })
      .pipe(tap((family) => this.accept(family)));
  }

  addMember(draft: MemberDraft): Observable<Member> {
    return this.http
      .post<Member>('/api/family/members', draft)
      .pipe(tap((added) => this.changeMembers((members) => [...members, added])));
  }

  updateMember(id: string, draft: MemberDraft): Observable<Member> {
    return this.http
      .put<Member>(`/api/family/members/${id}`, draft)
      .pipe(
        tap((updated) =>
          this.changeMembers((members) => members.map((member) => (member.id === id ? updated : member))),
        ),
      );
  }

  removeMember(id: string): Observable<void> {
    return this.http
      .delete<void>(`/api/family/members/${id}`)
      .pipe(tap(() => this.changeMembers((members) => members.filter((member) => member.id !== id))));
  }

  private accept(family: Family): void {
    this.writes++;
    this.current.set({ status: 'ready', family });
  }

  private changeMembers(change: (members: Member[]) => Member[]): void {
    this.writes++;
    this.current.update((state) =>
      state.status === 'ready'
        ? { status: 'ready', family: { ...state.family, members: change(state.family.members) } }
        : state,
    );
  }
}

/** The first message from a refused change, or a fallback when the server gave none. */
export function refusalMessage(error: unknown, fallback: string): string {
  const errors = error instanceof HttpErrorResponse ? error.error?.errors : undefined;
  const first = errors && typeof errors === 'object' ? Object.values(errors)[0] : undefined;
  return Array.isArray(first) && typeof first[0] === 'string' ? first[0] : fallback;
}
