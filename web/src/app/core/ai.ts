import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
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

/** The AI features' requests. Nothing here saves anything: a described event opens unsaved in the editor. */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);

  describe(text: string): Observable<DescribedEvent> {
    return this.http
      .post<DescribedEvent>('/api/ai/describe', { text })
      .pipe(timeout(AI_TIMEOUT_MS), catchError((error) => throwError(() => error)));
  }
}
