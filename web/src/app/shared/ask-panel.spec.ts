import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AskAnswer } from '../core/ai';
import { CalendarEvent, CalendarStore } from '../core/calendar';
import { Clock } from '../core/clock';
import { FamilyStore, Member } from '../core/family';
import { SessionStore } from '../core/session';
import { AskAddAt, AskPanel, DEMO_QUESTIONS, FAMILY_QUESTIONS, clock24 } from './ask-panel';
import { SearchPick } from './event-search';

describe('Ask the calendar', () => {
  const nora: Member = { id: 'nora', displayName: 'Nora', color: '#2F5FC4', initial: 'N', role: 'Kid' };
  const milo: Member = { id: 'milo', displayName: 'Milo', color: '#C4502F', initial: 'M', role: 'Kid' };

  // Saturday, November 7, 2026, 11 AM to 12:15 PM in New York.
  const soccer: CalendarEvent = {
    id: 'soccer', calendarId: 'nora-cal', memberId: 'nora', title: 'U10 Rec Soccer', location: 'Memorial Park',
    allDay: false, startsAt: '2026-11-07T16:00:00Z', endsAt: '2026-11-07T17:15:00Z', startDate: null, endDate: null, recurring: false,
  };

  const free: AskAnswer = {
    kind: 'free',
    sentence: 'Everyone is free 12:15–6 pm on Saturday.',
    slots: [{ start: '2026-11-07T17:15:00Z', end: '2026-11-07T23:00:00Z', memberIds: [] }],
    events: [soccer],
    changeNumber: 7,
    notCached: [],
  };

  function setup(options: { question?: string; demo?: boolean; changeNumber?: number | null; canWrite?: boolean } = {}) {
    const changeNumber = signal<number | null>(options.changeNumber ?? 7);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Clock, useValue: { now: signal(new Date('2026-11-04T14:00:00Z')) } },
        { provide: FamilyStore, useValue: { family: signal({ timeZone: 'America/New_York' }), members: signal([nora, milo]) } },
        { provide: CalendarStore, useValue: { changeNumber, calendars: signal([{ id: 'nora-cal', canWrite: options.canWrite ?? true }]) } },
        { provide: SessionStore, useValue: { isDemo: computed(() => options.demo ?? true) } },
      ],
    });
    const fixture = TestBed.createComponent(AskPanel);
    fixture.componentRef.setInput('question', options.question ?? '');
    const picked: SearchPick[] = [];
    const days: string[] = [];
    const adds: AskAddAt[] = [];
    const searches: string[] = [];
    fixture.componentInstance.picked.subscribe((p) => picked.push(p));
    fixture.componentInstance.openDay.subscribe((d) => days.push(d));
    fixture.componentInstance.addAt.subscribe((a) => adds.push(a));
    fixture.componentInstance.searchInstead.subscribe((q) => searches.push(q));
    fixture.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement, picked, days, adds, searches, changeNumber };
  }

  function ask(fixture: ReturnType<typeof setup>['fixture'], el: HTMLElement, question: string) {
    const input = el.querySelector('input')!;
    input.value = question;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  }

  const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.actions button')];

  it('answers free time from the server’s slots, with a new event at its start and its day to open', async () => {
    const { fixture, http, el, adds, days } = setup();
    ask(fixture, el, 'When are we all free Saturday afternoon?');

    const request = http.expectOne('/api/ai/ask');
    expect(request.request.body).toEqual({ question: 'When are we all free Saturday afternoon?' });
    expect(el.querySelector('.status')!.textContent).toContain('Reading your calendar');
    request.flush(free);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelector('.sentence')!.textContent).toBe('Everyone is free 12:15–6 pm on Saturday.');
    expect(el.querySelector('.slots')!.textContent).toContain('12:15 – 6 pm');
    expect(el.querySelector('.slots')!.textContent).toContain('Saturday');
    expect(el.querySelector('.row .name')!.textContent).toBe('U10 Rec Soccer');
    expect(buttons(el).map((b) => b.textContent!.trim())).toEqual(['Add event at 12:15 pm', 'Open Saturday']);
    buttons(el)[0].click();
    buttons(el)[1].click();
    expect(adds).toEqual([{ day: '2026-11-07', time: '12:15' }]);
    expect(days).toEqual(['2026-11-07']);
    expect(el.querySelector('.changed')).toBeNull();
  });

  it('opens an event’s details, saying when the calendar does not keep it', async () => {
    const { fixture, http, el, picked } = setup();
    ask(fixture, el, 'When is soccer?');
    http.expectOne('/api/ai/ask').flush({ ...free, kind: 'events', sentence: 'Soccer is Saturday at 11 am.', slots: [], notCached: ['soccer'] });
    fixture.detectChanges();
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('.row')!.click();
    expect(picked).toEqual([{ event: soccer, cached: false }]);
    // No free time, so nothing to add at; the event's day still opens.
    expect(buttons(el).map((b) => b.textContent!.trim())).toEqual(['Open Saturday']);
  });

  it('offers no new event without a calendar to add to', async () => {
    const { fixture, http, el } = setup({ canWrite: false });
    ask(fixture, el, 'free?');
    http.expectOne('/api/ai/ask').flush(free);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(buttons(el).map((b) => b.textContent!.trim())).toEqual(['Open Saturday']);
  });

  it('offers Search when nothing was found', async () => {
    const { fixture, http, el, searches } = setup();
    ask(fixture, el, 'When is karate?');
    http.expectOne('/api/ai/ask').flush({ ...free, kind: 'none', sentence: 'Nothing on the calendar for that.', slots: [], events: [] });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelector('.slots')).toBeNull();
    expect(el.querySelector('.rows')).toBeNull();
    buttons(el)[0].click();
    expect(searches).toEqual(['When is karate?']);
  });

  it('says what went wrong and still offers Search', async () => {
    const { fixture, http, el, searches } = setup();
    ask(fixture, el, 'free?');
    http.expectOne('/api/ai/ask').flush({ reason: 'Budget' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelector('.problem')!.textContent).toContain('done its share for today');
    buttons(el)[0].click();
    expect(searches).toEqual(['free?']);
  });

  it('asks the question it was opened with at once', async () => {
    const { fixture, http, el } = setup({ question: 'What does Milo have this week?' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(http.expectOne('/api/ai/ask').request.body).toEqual({ question: 'What does Milo have this week?' });
    expect(el.querySelector('input')!.value).toBe('What does Milo have this week?');
  });

  it('says when the calendar changed since, and asks again', async () => {
    const { fixture, http, el, changeNumber } = setup();
    ask(fixture, el, 'free?');
    http.expectOne('/api/ai/ask').flush(free);
    fixture.detectChanges();
    await fixture.whenStable();

    changeNumber.set(8);
    fixture.detectChanges();
    expect(el.querySelector('.changed')!.textContent).toContain('The calendar changed since you asked.');
    el.querySelector<HTMLButtonElement>('.changed button')!.click();
    fixture.detectChanges();
    expect(http.expectOne('/api/ai/ask').request.body).toEqual({ question: 'free?' });
  });

  it('suggests the demo family’s questions on the demo and nobody’s names elsewhere', () => {
    const demo = setup({ demo: true });
    expect([...demo.el.querySelectorAll('.example')].map((b) => b.textContent!.trim())).toEqual(DEMO_QUESTIONS);
    demo.el.querySelector<HTMLButtonElement>('.example')!.click();
    demo.fixture.detectChanges();
    expect(demo.http.expectOne('/api/ai/ask').request.body).toEqual({ question: DEMO_QUESTIONS[0] });
    expect(demo.el.querySelector('.example')).toBeNull();

    TestBed.resetTestingModule();
    const family = setup({ demo: false });
    expect([...family.el.querySelectorAll('.example')].map((b) => b.textContent!.trim())).toEqual(FAMILY_QUESTIONS);
  });

  it('turns a clock time into the editors’ 24-hour one', () => {
    expect(clock24('1:30 PM')).toBe('13:30');
    expect(clock24('12:15 PM')).toBe('12:15');
    expect(clock24('12:00 AM')).toBe('00:00');
    expect(clock24('9:05 am')).toBe('09:05');
  });
});
