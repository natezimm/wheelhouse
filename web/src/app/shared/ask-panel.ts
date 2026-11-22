import { Component, ElementRef, OnDestroy, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { AiService, AskAnswer, AskSlot, askRefusal } from '../core/ai';
import { CalendarEvent, CalendarStore, colorOf, namesOf, spanOf, timeRange } from '../core/calendar';
import { Clock } from '../core/clock';
import { Day, addDays, dayIn, formatDay, timeIn, timeText } from '../core/days';
import { FamilyStore } from '../core/family';
import { SessionStore } from '../core/session';
import { ModalFocus } from './modal-focus';
import { SearchPick } from './event-search';

/** What the demo offers to ask: questions the Marlowes' week answers. */
export const DEMO_QUESTIONS = ['When are we all free Saturday afternoon?', 'What does Milo have this week?', "When is Milo's next dentist visit?"];

/** What a family instance offers to ask, with nobody's name in it. */
export const FAMILY_QUESTIONS = ['When are we all free this weekend?', "What's on tomorrow?", "What's coming up next week?"];

/** A new event the answer offers to start: its day and start time ("13:30"). */
export interface AskAddAt {
  day: Day;
  time: string;
}

type AskState =
  | { status: 'idle' }
  | { status: 'asking'; question: string }
  | { status: 'done'; question: string; answer: AskAnswer }
  | { status: 'failed'; question: string; problem: string };

/** One free time on the card. */
interface SlotRow {
  key: string;
  when: string;
  day: string;
  who: string;
}

/** One event on the card, drawn as search draws its rows. */
interface EventRow {
  event: CalendarEvent;
  cached: boolean;
  day: string;
  when: string;
  title: string;
  location: string | null;
  who: string;
  color: string;
}

/**
 * Ask the calendar: one question, one answer card, read-only. A sheet on the phone (from Search's
 * "Ask instead"), a panel over a desktop window (from the rail or the A key). The card's free times,
 * events and buttons come from the server's own data, so a wrong sentence can cost wording but never
 * show an event or a time that is not there. Nothing changes until a parent saves in an editor.
 */
@Component({
  selector: 'app-ask-panel',
  imports: [ModalFocus],
  host: { '[class]': 'layout()', '(keydown.escape)': 'closed.emit()' },
  template: `
    <button type="button" class="scrim" tabindex="-1" aria-label="Close Ask" (click)="closed.emit()"></button>
    <section class="panel" appModalFocus tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="ask-title">
      <div class="top">
        <h2 id="ask-title" class="title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"></path><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"></path></svg>
          Ask the calendar
        </h2>
        <button type="button" class="close" aria-label="Close" (click)="closed.emit()">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
        </button>
      </div>

      <form class="ask" (submit)="$event.preventDefault(); ask()">
        <label class="box">
          <span class="visually-hidden">Your question</span>
          <input
            #box
            type="text"
            placeholder="When are we all free Saturday?"
            autocomplete="off"
            enterkeyhint="send"
            maxlength="200"
            aria-describedby="ask-note"
            [value]="text()"
            [disabled]="asking()"
            (input)="text.set($any($event.target).value)"
          />
        </label>
        <button type="submit" class="button primary" [disabled]="asking() || !text().trim()">{{ asking() ? 'Reading…' : 'Ask' }}</button>
      </form>

      @if (state().status === 'idle') {
        <div class="examples" role="group" aria-label="Try asking">
          @for (question of questions(); track question) {
            <button type="button" class="example" (click)="text.set(question); ask()">{{ question }}</button>
          }
        </div>
      }

      <div class="status" role="status">
        @switch (state().status) {
          @case ('asking') {
            <p class="quiet">Reading your calendar…</p>
          }
          @case ('failed') {
            <p class="problem">{{ problem() }}</p>
          }
          @case ('done') {
            <p class="sentence">{{ answer()!.sentence }}</p>
          }
        }
      </div>

      @if (answer(); as answer) {
        @if (slots().length) {
          <ul class="slots" aria-label="Free times">
            @for (slot of slots(); track slot.key) {
              <li><span class="slot-when">{{ slot.when }}</span><span class="slot-day">{{ slot.day }}{{ slot.who }}</span></li>
            }
          </ul>
        }
        @if (rows().length) {
          <ul class="rows" aria-label="Events in the answer">
            @for (row of rows(); track row.event.id) {
              <li>
                <button type="button" class="row" [style.--member]="row.color" (click)="picked.emit({ event: row.event, cached: row.cached })">
                  <span class="when"><span class="day">{{ row.day }}</span><span class="time">{{ row.when }}</span></span>
                  <span class="what">
                    <span class="name">{{ row.title }}</span>
                    <span class="detail">{{ row.who }}@if (row.location) { · {{ row.location }}}</span>
                  </span>
                </button>
              </li>
            }
          </ul>
        }
        @if (adding() || opening() || searchable()) {
          <div class="actions">
            @if (adding(); as add) {
              <button type="button" class="button primary" (click)="addAt.emit(add.at)">{{ add.label }}</button>
            }
            @if (opening(); as open) {
              <button type="button" class="button" (click)="openDay.emit(open.day)">{{ open.label }}</button>
            }
            @if (searchable()) {
              <button type="button" class="button" (click)="searchInstead.emit(lastQuestion())">Search instead</button>
            }
          </div>
        }
        @if (changed()) {
          <div class="changed">
            <p>The calendar changed since you asked.</p>
            <button type="button" class="button" (click)="again()">Ask again</button>
          </div>
        }
      }

      @if (state().status === 'failed') {
        <div class="actions">
          <button type="button" class="button" (click)="searchInstead.emit(lastQuestion())">Search instead</button>
        </div>
      }

      <p id="ask-note" class="note">Read from your calendar only. Nothing changes until you save. What you ask is sent to Anthropic to answer it.</p>
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
      max-height: 80vh;
      margin-top: 8vh;
      box-sizing: border-box;
      padding: 16px 16px 20px;
      border-radius: var(--card-radius);
      background: var(--surface);
      box-shadow: var(--drawer-shadow);
      color: var(--ink);
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      outline: none;
    }

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
      justify-content: space-between;
      gap: 8px;
    }

    .title {
      margin: 0 0 0 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      font: 700 18px var(--font-body);
    }

    .title svg {
      color: var(--accent);
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

    .ask {
      display: flex;
      gap: 8px;
    }

    .box {
      flex: 1;
      min-width: 0;
      display: flex;
    }

    input {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      height: 48px;
      padding: 0 14px;
      border: var(--control-border);
      border-radius: var(--event-radius);
      background: var(--field);
      color: var(--ink);
      font: 500 16px var(--font-body);
    }

    :host(.phone) input {
      background: var(--surface);
    }

    input::placeholder {
      color: var(--muted);
    }

    .ask .button {
      flex-shrink: 0;
      padding: 0 18px;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .examples {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .example {
      min-height: 44px;
      padding: 6px 12px;
      border: var(--control-border);
      border-radius: var(--pill);
      background: var(--surface);
      color: var(--ink);
      font: 500 14px/1.3 var(--font-body);
      text-align: left;
      cursor: pointer;
    }

    .status:empty {
      display: none;
    }

    .status p {
      margin: 0 4px;
    }

    .quiet {
      font-size: 15px;
      font-weight: 600;
      color: var(--muted);
    }

    .problem {
      font-size: 15px;
      color: var(--danger-text);
    }

    /* The answer leads: one sentence, with what it rests on under it. */
    .status .sentence {
      margin: 0;
      padding: 14px;
      border: var(--control-border);
      border-radius: var(--event-radius);
      background: color-mix(in srgb, var(--accent) 8%, var(--surface));
      font-size: 18px;
      font-weight: 700;
      line-height: 1.35;
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .slots li {
      min-height: 48px;
      padding: 8px 14px;
      box-sizing: border-box;
      border: var(--control-border);
      border-style: dashed;
      border-radius: var(--event-radius-small);
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .slot-when {
      font: 700 16px var(--font-time);
      white-space: nowrap;
    }

    .slot-day {
      font-size: 14px;
      color: var(--muted);
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
      min-width: 92px;
      display: flex;
      flex-direction: column;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
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

    .name {
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

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .actions .button {
      padding: 0 16px;
    }

    .changed {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin: 0 4px;
    }

    .changed p {
      margin: 0;
      font-size: 14px;
      color: var(--ink);
    }

    .changed .button {
      padding: 0 16px;
    }

    .note {
      margin: 4px 4px 0;
      font-size: 12px;
      color: var(--muted);
    }
  `,
})
export class AskPanel implements OnDestroy {
  private readonly ai = inject(AiService);
  private readonly family = inject(FamilyStore);
  private readonly calendar = inject(CalendarStore);
  private readonly session = inject(SessionStore);
  private readonly clock = inject(Clock);

  readonly layout = input<'desktop' | 'phone'>('desktop');
  /** A question to start with, such as what was typed in Search before Ask instead. */
  readonly question = input('');

  readonly closed = output<void>();
  /** An event on the card, for its details. */
  readonly picked = output<SearchPick>();
  /** The day the answer is about, to show. */
  readonly openDay = output<Day>();
  /** A new event at a free time's start. */
  readonly addAt = output<AskAddAt>();
  /** Search, with the question's words, when Ask could not help. */
  readonly searchInstead = output<string>();

  protected readonly text = signal('');
  protected readonly state = signal<AskState>({ status: 'idle' });
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  private request: Subscription | null = null;

  constructor() {
    afterNextRender(() => {
      const start = this.question().trim();
      this.text.set(start);
      this.box()?.nativeElement.focus();
      if (start) this.ask();
    });
  }

  protected readonly questions = computed(() => (this.session.isDemo() ? DEMO_QUESTIONS : FAMILY_QUESTIONS));
  protected readonly asking = computed(() => this.state().status === 'asking');
  protected readonly answer = computed(() => {
    const state = this.state();
    return state.status === 'done' ? state.answer : null;
  });
  protected readonly problem = computed(() => {
    const state = this.state();
    return state.status === 'failed' ? state.problem : null;
  });
  protected readonly lastQuestion = computed(() => {
    const state = this.state();
    return state.status === 'idle' ? this.text().trim() : state.question;
  });

  private readonly zone = computed(() => this.family.family()?.timeZone ?? null);
  private readonly today = computed(() => {
    const zone = this.zone();
    return zone ? dayIn(zone, this.clock.now()) : null;
  });

  protected ask(): void {
    const question = this.text().trim();
    if (!question || this.asking()) return;
    this.request?.unsubscribe();
    this.state.set({ status: 'asking', question });
    this.request = this.ai.ask(question).subscribe({
      next: (answer) => this.state.set({ status: 'done', question, answer }),
      error: (error) => this.state.set({ status: 'failed', question, problem: askRefusal(error) }),
    });
  }

  protected again(): void {
    this.text.set(this.lastQuestion());
    this.ask();
  }

  /** Whether the calendar has taken a newer change than the one the answer was read from. */
  protected readonly changed = computed(() => {
    const answer = this.answer();
    const now = this.calendar.changeNumber();
    return !!answer && now !== null && now > answer.changeNumber;
  });

  protected readonly slots = computed<SlotRow[]>(() => {
    const answer = this.answer();
    const zone = this.zone();
    if (!answer || !zone) return [];
    const members = this.family.members();
    return answer.slots.map((slot) => {
      const names = members.filter((m) => slot.memberIds.includes(m.id)).map((m) => m.displayName);
      return {
        key: `${slot.start}-${slot.end}`,
        when: this.range(slot, zone),
        day: capitalized(this.dayLabel(dayIn(zone, slot.start), { weekday: 'long', month: 'short', day: 'numeric' })),
        who: names.length ? ` · ${names.join(', ')}` : '',
      };
    });
  });

  protected readonly rows = computed<EventRow[]>(() => {
    const answer = this.answer();
    const zone = this.zone();
    const today = this.today();
    if (!answer || !zone || !today) return [];
    const members = this.family.members();
    const notCached = new Set(answer.notCached ?? []);
    return answer.events.map((event) => {
      const { first } = spanOf(event, zone);
      return {
        event,
        cached: !notCached.has(event.id),
        day: first === today ? 'Today' : formatDay(first, { weekday: 'short', month: 'short', day: 'numeric' }),
        when: event.allDay ? 'All day' : timeRange(event, zone),
        title: event.title,
        location: event.location,
        who: namesOf(event, members),
        color: colorOf(event, members),
      };
    });
  });

  /** "Add event at 1:30 pm", at the first free time's start, when there is a calendar to add to. */
  protected readonly adding = computed(() => {
    const answer = this.answer();
    const zone = this.zone();
    const slot = answer?.kind === 'free' ? answer.slots[0] : undefined;
    if (!slot || !zone || !this.calendar.calendars().some((c) => c.canWrite)) return null;
    return { at: { day: dayIn(zone, slot.start), time: clock24(timeIn(zone, slot.start)) }, label: `Add event at ${timeText(zone, slot.start)}` };
  });

  /** "Open Saturday": the day the answer is about, from its first free time or event. */
  protected readonly opening = computed(() => {
    const answer = this.answer();
    const zone = this.zone();
    if (!answer || !zone) return null;
    const first = answer.slots[0]?.start ?? null;
    const event = answer.events[0];
    const day = first ? dayIn(zone, first) : event ? spanOf(event, zone).first : null;
    return day ? { day, label: `Open ${this.dayLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })}` } : null;
  });

  /** Search is offered when Ask found nothing or could not answer. */
  protected readonly searchable = computed(() => {
    const kind = this.answer()?.kind;
    return kind === 'none' || kind === 'unknown';
  });

  /** "today", "tomorrow", a weekday within the coming week, or the date further off. */
  private dayLabel(day: Day, far: Intl.DateTimeFormatOptions): string {
    const today = this.today();
    if (!today) return formatDay(day, far);
    if (day === today) return 'today';
    if (day === addDays(today, 1)) return 'tomorrow';
    if (day > today && day < addDays(today, 7)) return formatDay(day, { weekday: 'long' });
    return formatDay(day, far);
  }

  /** "1:30 – 4 pm", as the screens write a time range. */
  private range(slot: AskSlot, zone: string): string {
    const start = timeText(zone, slot.start);
    const end = timeText(zone, slot.end);
    return start.slice(-2) === end.slice(-2) ? `${start.slice(0, -3)} – ${end}` : `${start} – ${end}`;
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "1:30 PM" as "13:30", the editors' clock. */
export function clock24(time: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(time.trim());
  if (!match) return time;
  const hour = (Number(match[1]) % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}
