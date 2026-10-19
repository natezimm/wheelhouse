import { vi } from 'vitest';

/** A controllable transport; tests still exercise the real Angular subscription and store. */
export class CalendarHubFake {
  changed?: (message: { changeNumber: number }) => void;
  reconnecting?: () => void;
  reconnected?: () => void;
  closed?: () => void;
  readonly start = vi.fn(async () => {});
  readonly stop = vi.fn(async () => {});
  on(name: string, callback: (message: { changeNumber: number }) => void): void {
    if (name === 'CalendarChanged') this.changed = callback;
  }
  onreconnecting(callback: () => void): void {
    this.reconnecting = callback;
  }
  onreconnected(callback: () => void): void {
    this.reconnected = callback;
  }
  onclose(callback: () => void): void {
    this.closed = callback;
  }
  notify(changeNumber: number): void {
    this.changed?.({ changeNumber });
  }
}
