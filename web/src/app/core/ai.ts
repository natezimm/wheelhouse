import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
import { CalendarEvent } from './calendar';
import { Day } from './days';

/** How long a screen waits for the assistant before offering the plain form. */
export const AI_TIMEOUT_MS = 20_000;

/**
 * What Describe it read from a parent's words: a new event in the family's days and clock, the shape
 * an event request takes. memberIds are the people besides the calendar's owner; unclear names what it
 * guessed or left at the editor's default ('title', 'day', 'weekday', 'time', 'end', 'repeat', 'people').
 */
export interface DescribedEvent {
  calendarId: string | null;
  title: string;
  location: string | null;
  allDay: boolean;
  startDate: Day;
  startTime: string | null;
  endDate: Day;
  endTime: string | null;
  recurrence: string | null;
  memberIds: string[];
  unclear: string[];
}

/** A free time Ask found, as instants, for memberIds (none for everyone). */
export interface AskSlot {
  start: string;
  end: string;
  memberIds: string[];
}

/**
 * Ask's answer card. The sentence is the assistant's words, checked against the calendar; the slots
 * and events are the server's own data, so the card's times, rows and buttons never come from the
 * model. changeNumber is the calendar's when it was asked, so a screen can tell the answer is old.
 */
export interface AskAnswer {
  kind: 'free' | 'events' | 'none' | 'outsideWindow' | 'offTopic' | 'unknown';
  sentence: string;
  slots: AskSlot[];
  events: CalendarEvent[];
  changeNumber: number;
  syncedFrom?: Day | null;
  syncedTo?: Day | null;
  /** Events found beyond the months the calendar keeps, which details show but cannot change. */
  notCached: string[];
}

/** Why Ask gave no answer, said for people; Search still works either way. */
export function askRefusal(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 429) {
    return 'Too many questions for now. Wait a minute, or search instead.';
  }
  if (error instanceof HttpErrorResponse && error.status === 503 && error.error?.reason === 'Budget') {
    return 'The assistant has done its share for today. Search instead, or ask again tomorrow.';
  }
  if (error instanceof HttpErrorResponse && error.status === 400) {
    return 'Ask in a few words, up to 200 letters.';
  }
  return error instanceof TimeoutError
    ? 'That took too long. Search instead, or ask again.'
    : "Couldn't answer just now. Search instead, or ask again.";
}

/** Why the assistant gave nothing, said for people; the form still works either way. */
export function aiRefusal(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 429) {
    return 'Too many tries for now. Wait a minute, or fill in the form yourself.';
  }
  if (error instanceof HttpErrorResponse && error.status === 503 && error.error?.reason === 'Budget') {
    return 'The assistant has done its share for today. Fill in the form yourself.';
  }
  if (error instanceof HttpErrorResponse && error.status === 400) {
    return 'Describe the event in a few words, up to 300 letters.';
  }
  return error instanceof TimeoutError
    ? 'That took too long. Fill in the form yourself, or try again.'
    : "Couldn't fill it in just now. Fill in the form yourself, or try again.";
}

/** The AI features' requests. Nothing here saves anything: a described event opens unsaved in the editor, and Ask only reads. */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);

  describe(text: string): Observable<DescribedEvent> {
    return this.http
      .post<DescribedEvent>('/api/ai/describe', { text })
      .pipe(timeout(AI_TIMEOUT_MS), catchError((error) => throwError(() => error)));
  }

  ask(question: string): Observable<AskAnswer> {
    return this.http
      .post<AskAnswer>('/api/ai/ask', { question })
      .pipe(timeout(AI_TIMEOUT_MS), catchError((error) => throwError(() => error)));
  }
}
