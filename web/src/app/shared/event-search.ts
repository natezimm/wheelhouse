import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { timeout } from 'rxjs';
import { CalendarEvent, colorOf, namesOf, spanOf, timeRange } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, dayIn, formatDay } from '../core/days';
import { FamilyStore } from '../core/family';
import { ModalFocus } from './modal-focus';

/** How long typing pauses before the search goes out. */
export const SEARCH_WAIT_MS = 250;

/** What the API answers: up to 30 events, one per series, upcoming first, and how many series matched. */
export interface SearchResponse {
  events: CalendarEvent[];
  total: number;
}

/** One found event as a row: its day and time, title, place and people. */
interface Found {
  event: CalendarEvent;
  day: string;
  when: string;
  title: string;
  location: string | null;
  who: string;
  color: string;
  repeats: boolean;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'searching'; q: string }
  | { status: 'done'; q: string; found: SearchResponse }
  | { status: 'failed'; q: string };

/**
 * Finds the family's events by title or place, from the phone's view switch, the desktop rail or
 * the / key: a sheet on the phone, a panel over a desktop window. Each repeating event shows once,
 * at its next time. Picking one opens its day with its details.
 */
@Component({
  selector: 'app-event-search',
  imports: [ModalFocus],
  host: { '[class]': 'layout()', '(keydown.escape)': 'closed.emit()' },
  template: `
    <button type="button" class="scrim" tabindex="-1" aria-label="Close search" (click)="closed.emit()"></button>
    <section class="panel" appModalFocus tabindex="-1" role="dialog" aria-modal="true" aria-label="Search events">
      <div class="top">
        <label class="box">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.6-3.6"></path></svg>
          <span class="visually-hidden">Search events</span>
          <input #box type="search" placeholder="Search events" autocomplete="off" enterkeyhint="search" maxlength="100" [value]="query()" (input)="type($any($event.target).value)" />
        </label>
        <button type="button" class="close" aria-label="Close" (click)="closed.emit()">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
        </button>
      </div>

      <p class="status" role="status">{{ status() }}</p>

      @for (group of groups(); track group.name) {
        <h3>{{ group.name }}</h3>
        <ul>
          @for (row of group.rows; track row.event.id) {
            <li>
              <button type="button" class="row" [style.--member]="row.color" (click)="picked.emit(row.event)">
                <span class="when"><span class="day">{{ row.day }}</span><span class="time">{{ row.when }}</span></span>
                <span class="what">
                  <span class="title">{{ row.title }}</span>
                  <span class="detail">{{ row.who }}@if (row.location) { · {{ row.location }}}@if (row.repeats) { · Repeats}</span>
                </span>
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 30;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }

    .scrim {
      position: absolute;
      inset: 0;
      width: 100%;
      border: 0;
      background: var(--scrim);
      cursor: pointer;
    }

    .panel {
      position: relative;
      width: 600px;
      max-width: calc(100% - 32px);
      max-height: 76vh;
      margin-top: 10vh;
      box-sizing: border-box;
      padding: 16px 16px 20px;
      border-radius: var(--card-radius);
      background: var(--surface);
      box-shadow: var(--drawer-shadow);
      color: var(--ink);
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      outline: none;
    }

    /* On a phone the search takes the whole screen, so the keyboard leaves room for results. */
    :host(.phone) .panel {
      width: 100%;
      max-width: none;
      height: 100%;
      max-height: none;
      margin: 0;
      padding: 14px 16px 24px;
      border-radius: 0;
      background: var(--ground);
    }

    .top {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .box {
      flex: 1;
      min-width: 0;
      height: 48px;
      padding: 0 14px;
      box-sizing: border-box;
      border: var(--control-border);
      border-radius: var(--pill);
      background: var(--field);
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    :host(.phone) .box {
      background: var(--surface);
    }

    input {
      flex: 1;
      min-width: 0;
      height: 100%;
      border: 0;
      background: transparent;
      color: var(--ink);
      font: 600 17px var(--font-body);
      outline: none;
    }

    .box:focus-within {
      box-shadow: 0 0 0 2px var(--accent);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .close {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 22px;
      background: var(--soft);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .status {
      margin: 4px 6px;
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
    }

    .status:empty {
      display: none;
    }

    h3 {
      margin: 8px 6px 0;
      font: 700 13px var(--font-body);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .row {
      width: 100%;
      min-height: 56px;
      padding: 8px 14px 8px 12px;
      box-sizing: border-box;
      border: 0;
      border-left: 5px solid var(--member-strong);
      border-radius: var(--event-radius-small);
      background: var(--member-bg);
      color: var(--event-ink);
      display: flex;
      align-items: center;
      gap: 14px;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }

    .when {
      flex-shrink: 0;
      width: 92px;
      display: flex;
      flex-direction: column;
      font-size: 13px;
      font-weight: 700;
    }

    .time {
      color: var(--member-time);
      font-family: var(--font-time);
    }

    .what {
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .title {
      font-size: 16px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail {
      font-size: 13px;
      color: var(--event-quiet);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class EventSearch {
  private readonly http = inject(HttpClient);
  private readonly family = inject(FamilyStore);
  private readonly clock = inject(Clock);

  readonly layout = input<'desktop' | 'phone'>('desktop');
  readonly closed = output<void>();
  /** An event picked from the results. */
  readonly picked = output<CalendarEvent>();

  protected readonly query = signal('');
  private readonly state = signal<SearchState>({ status: 'idle' });
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  private wait?: ReturnType<typeof setTimeout>;
  private asked = 0;

  private readonly today = computed(() => {
    const zone = this.family.family()?.timeZone;
    return zone ? dayIn(zone, this.clock.now()) : null;
  });

  constructor() {
    afterNextRender(() => this.box()?.nativeElement.focus());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.wait));
  }

  protected type(value: string): void {
    this.query.set(value);
    clearTimeout(this.wait);
    const q = value.trim();
    if (!q) {
      this.asked++;
      this.state.set({ status: 'idle' });
      return;
    }
    this.wait = setTimeout(() => this.search(q), SEARCH_WAIT_MS);
  }

  private search(q: string): void {
    const today = this.today();
    if (!today) return;
    const ask = ++this.asked;
    this.state.set({ status: 'searching', q });
    this.http
      .get<SearchResponse>('/api/calendar/search', { params: { q, from: today } })
      .pipe(timeout(15_000))
      .subscribe({
        next: (found) => ask === this.asked && this.state.set({ status: 'done', q, found }),
        error: () => ask === this.asked && this.state.set({ status: 'failed', q }),
      });
  }

  protected readonly status = computed(() => {
    const state = this.state();
    switch (state.status) {
      case 'idle':
        return 'Search titles and places, from 90 days back to a year ahead.';
      case 'searching':
        return 'Searching…';
      case 'failed':
        return 'Could not search just now. Check the connection and try again.';
      case 'done': {
        const { events, total } = state.found;
        if (!events.length) return `No events match “${state.q}”.`;
        return total > events.length ? `The first ${events.length} of ${total}. Type more to narrow it down.` : '';
      }
    }
  });

  /** Upcoming events, then earlier ones, as the API orders them. */
  protected readonly groups = computed(() => {
    const state = this.state();
    const family = this.family.family();
    const today = this.today();
    if (state.status !== 'done' || !family || !today) return [];
    const zone = family.timeZone;
    const rows = state.found.events.map((event) => {
      const { first, last } = spanOf(event, zone);
      return { upcoming: last >= today, row: this.rowOf(event, first, zone, today) };
    });
    return [
      { name: 'Coming up', rows: rows.filter((r) => r.upcoming).map((r) => r.row) },
      { name: 'Earlier', rows: rows.filter((r) => !r.upcoming).map((r) => r.row) },
    ].filter((group) => group.rows.length);
  });

  private rowOf(event: CalendarEvent, first: Day, zone: string, today: Day): Found {
    const members = this.family.members();
    const sameYear = first.slice(0, 4) === today.slice(0, 4);
    return {
      event,
      day: first === today ? 'Today' : formatDay(first, sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }),
      when: event.allDay ? 'All day' : timeRange(event, zone),
      title: event.title,
      location: event.location,
      who: namesOf(event, members),
      color: colorOf(event, members),
      repeats: event.recurring,
    };
  }
}
