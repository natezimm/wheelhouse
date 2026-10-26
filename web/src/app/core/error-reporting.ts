import { ErrorHandler } from '@angular/core';

/** How many errors one screen reports in a window, so a loop that throws cannot flood the log. */
export const REPORT_LIMIT = 5;
export const REPORT_WINDOW_MS = 10 * 60 * 1000;

/** What the API keeps of an error, as `POST /api/client-errors` takes it. */
export interface ClientErrorReport {
  message: string;
  stack: string | null;
  page: string;
  layout: 'wall' | 'desktop' | 'phone';
}

/** The report for an error on the page at <code>path</code> in a window <code>width</code> pixels wide. */
export function reportFor(error: unknown, path: string, width: number): ClientErrorReport {
  // Angular hands over what was thrown, which need not be an Error.
  const real = error instanceof Error ? error : null;
  return {
    message: real ? `${real.name}: ${real.message}` : String(error),
    stack: real?.stack ?? null,
    page: path,
    layout: path.startsWith('/wall') ? 'wall' : width < 768 ? 'phone' : 'desktop',
  };
}

/**
 * Logs errors to the console as Angular does, and also sends each to the API, so a wall with
 * nobody watching its console still tells someone what went wrong. The same message is sent
 * once, and no more than REPORT_LIMIT in REPORT_WINDOW_MS; a report that cannot be sent is
 * dropped, since reporting must never cause errors of its own.
 */
export class ReportingErrorHandler extends ErrorHandler {
  private readonly sent = new Set<string>();
  private recent: number[] = [];

  constructor(
    private readonly send: (report: ClientErrorReport) => void = sendReport,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  override handleError(error: unknown): void {
    super.handleError(error);
    try {
      const report = reportFor(error, location.pathname, innerWidth);
      const at = this.now();
      this.recent = this.recent.filter((time) => at - time < REPORT_WINDOW_MS);
      if (this.sent.has(report.message) || this.recent.length >= REPORT_LIMIT) return;
      this.sent.add(report.message);
      this.recent.push(at);
      this.send(report);
    } catch {
      // Nothing to do: the console already has it.
    }
  }
}

/** Plain fetch rather than HttpClient, so a report never runs through the app's own code that may have failed. */
function sendReport(report: ClientErrorReport): void {
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => undefined);
}
