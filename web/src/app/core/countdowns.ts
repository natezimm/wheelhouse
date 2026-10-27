import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CalendarEvent, CalendarStore } from './calendar';
import { Clock } from './clock';
import { Day, dayIn } from './days';
import { FamilyStore } from './family';

/** One event the wall counts down to, and how many of the family's days are left until it. */
export interface Countdown {
  id: string;
  title: string;
  memberId: string | null;
  days: number;
  /** "Today", "Tomorrow" or "12 days". */
  left: string;
}

/** How long after a failed read the countdowns are read again. */
const RETRY_MS = 30_000;

/** Whole days from one family day to another. */
export function daysUntil(from: Day, to: Day): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** How the days left read: "Today", "Tomorrow" or "12 days". */
export function leftLabel(days: number): string {
  return days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`;
}

/**
 * The next few events marked to count down to, read from the API since they are usually beyond
 * the days on screen. Read again when the family's day turns and whenever the calendar takes a
 * newer snapshot, so a countdown set on a phone reaches the wall with the live update.
 */
@Injectable({ providedIn: 'root' })
export class CountdownStore {
  private readonly http = inject(HttpClient);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);
  private readonly events = signal<CalendarEvent[]>([]);
  private asked = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private familyId: string | null = null;

  /** The family's today, which only changes at its midnight. */
  private readonly today = computed(() => {
    const zone = this.family.family()?.timeZone;
    return zone ? dayIn(zone, this.clock.now()) : null;
  });

  readonly countdowns = computed<Countdown[]>(() => {
    const today = this.today();
    const zone = this.family.family()?.timeZone;
    if (!today || !zone) return [];
    return this.events().map((event) => {
      const days = daysUntil(today, event.startDate ?? dayIn(zone, event.startsAt!));
      return { id: event.id, title: event.title, memberId: event.memberId, days, left: leftLabel(days) };
    });
  });

  constructor() {
    const calendar = inject(CalendarStore);
    effect(() => {
      const today = this.today();
      const familyId = this.family.family()?.id ?? null;
      calendar.changeNumber();
      untracked(() => {
        // Another family's countdowns are never shown while this one's load.
        if (familyId !== this.familyId) {
          this.familyId = familyId;
          this.events.set([]);
        }
        this.fetch(today);
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.retry));
  }

  private fetch(today: Day | null): void {
    const ask = ++this.asked;
    clearTimeout(this.retry);
    if (!today) {
      this.events.set([]);
      return;
    }
    // A failed read keeps the countdowns shown and tries again after the shared recovery interval.
    this.http.get<CalendarEvent[]>('/api/calendar/countdowns', { params: { from: today } }).subscribe({
      next: (events) => {
        if (ask === this.asked) this.events.set(events);
      },
      error: () => {
        if (ask === this.asked) this.retry = setTimeout(() => this.fetch(today), RETRY_MS);
      },
    });
  }
}
