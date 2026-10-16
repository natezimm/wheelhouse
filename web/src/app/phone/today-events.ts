import { Component, computed, effect, inject } from '@angular/core';
import { CalendarEvent, CalendarStore, colorOf, daysOf } from '../core/calendar';
import { Clock } from '../core/clock';
import { addDays, dayIn, timeIn } from '../core/days';
import { Family, FamilyStore } from '../core/family';

/** The rest of today on the phone: what is up next, then the events after it. */
@Component({
  selector: 'app-today-events',
  template: `
    @if (today(); as today) {
      @if (today.next; as next) {
        <section class="next" aria-label="Up next">
          <span class="label">{{ today.nextLabel }}</span>
          <span class="title">{{ next.title }}</span>
          <span class="detail">{{ next.detail }}</span>
        </section>
      }

      @if (today.later.length > 0) {
        <section aria-labelledby="later">
          <h2 id="later">{{ today.next ? 'Later' : 'Today' }}</h2>
          <ul>
            @for (event of today.later; track event.id) {
              <li [style.--member]="event.color">
                <span class="when">{{ event.when }}</span>
                <span class="title">{{ event.title }}</span>
                <span class="who">{{ event.who }}</span>
              </li>
            }
          </ul>
        </section>
      } @else if (!today.next) {
        <p class="empty">Nothing else on the calendar today.</p>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .next {
      padding: 16px;
      border-radius: 18px;
      background: var(--ink);
      color: #ffffff;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #c9cdd2;
    }

    .next .title {
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: 600;
    }

    .detail {
      font-size: 14px;
      color: #c9cdd2;
    }

    h2 {
      margin: 4px 0 8px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    li {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--member) 14%, white);
    }

    .when {
      flex-shrink: 0;
      width: 64px;
      font-size: 14px;
      font-weight: 600;
      color: #4a4f57;
    }

    li .title {
      flex: 1;
      font-size: 16px;
      font-weight: 600;
    }

    .who {
      font-size: 13px;
      color: #4a4f57;
    }

    .empty {
      margin: 0;
      color: var(--muted);
      font-size: 16px;
    }
  `,
})
export class TodayEvents {
  private readonly calendar = inject(CalendarStore);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  private readonly settings = computed(() => {
    const state = this.family.state();
    return state.status === 'ready' ? state.family : null;
  });

  private readonly day = computed(() => {
    const family = this.settings();
    return family ? dayIn(family.timeZone, this.clock.now()) : null;
  });

  protected readonly today = computed(() => {
    const family = this.settings();
    const day = this.day();
    if (!family || !day || this.calendar.state().status !== 'ready') {
      return null;
    }

    const now = this.clock.now().getTime();
    // Today is everyone's day: the Calendar screen's filter does not apply here.
    const events = this.calendar.allEvents().filter((event) => daysOf(event, family.timeZone).includes(day));
    // Up next is the first timed event that has not ended yet; all-day events never are.
    const remaining = events.filter((event) => !event.allDay && new Date(event.endsAt!).getTime() > now);
    const next = remaining[0];
    const later = [...events.filter((event) => event.allDay), ...remaining.slice(1)];

    return {
      next: next && { title: next.title, detail: detail(next, family) },
      nextLabel: next && nextLabel(next, now, family.timeZone),
      later: later.map((event) => ({
        id: event.id,
        title: event.title,
        when: event.allDay ? 'All day' : timeIn(family.timeZone, event.startsAt!),
        who: whose(event, family),
        color: colorOf(event, family.members),
      })),
    };
  });

  constructor() {
    effect(() => {
      const day = this.day();
      if (day) {
        this.calendar.show(day, addDays(day, 1));
      }
    });
  }
}

const whose = (event: CalendarEvent, family: Family) =>
  family.members.find((member) => member.id === event.memberId)?.displayName ?? 'Family';

/** "5:30 – 6:15 PM · Milo · Riverside Rec Center". */
function detail(event: CalendarEvent, family: Family): string {
  const start = timeIn(family.timeZone, event.startsAt!);
  const end = timeIn(family.timeZone, event.endsAt!);
  const sameHalf = start.slice(-2) === end.slice(-2);
  const times = `${sameHalf ? start.slice(0, -3) : start} – ${end}`;
  return [times, whose(event, family), event.location].filter(Boolean).join(' · ');
}

/** "UP NEXT · IN 8 MIN", "UP NEXT · AT 3:00 PM", or "NOW · UNTIL 6:15 PM". */
function nextLabel(event: CalendarEvent, now: number, timeZone: string): string {
  const minutes = Math.ceil((new Date(event.startsAt!).getTime() - now) / 60_000);
  if (minutes <= 0) {
    return `Now · until ${timeIn(timeZone, event.endsAt!)}`.toUpperCase();
  }
  return (minutes < 60 ? `Up next · in ${minutes} min` : `Up next · at ${timeIn(timeZone, event.startsAt!)}`).toUpperCase();
}
