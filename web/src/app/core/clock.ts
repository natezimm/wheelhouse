import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** The current time as a signal, refreshed every second, so views re-render as the minute turns. */
@Injectable({ providedIn: 'root' })
export class Clock {
  private readonly time = signal(new Date());

  readonly now = this.time.asReadonly();

  constructor() {
    const timer = setInterval(() => this.time.set(new Date()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
