import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

export const TRACE_HEADER = 'traceparent';

/**
 * Starts a W3C trace for each call to our own API, so a failed request can be found in the server's
 * traces and logs by the id this logs. The flags say "not sampled": the server keeps its own share of
 * traces whatever the browser asks (docs/observability.md), so a visitor cannot make every request traced.
 */
export const traceContextInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request);
  const traceId = randomHex(16);
  const traced = request.clone({ setHeaders: { [TRACE_HEADER]: `00-${traceId}-${randomHex(8)}-00` } });
  return next(traced).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500))
        console.error(`Wheelhouse API call failed (${error.status}); trace id ${traceId}`);
      return throwError(() => error);
    }),
  );
};

/** Lowercase hex from the browser's random source; never all zeros, which W3C treats as invalid. */
export function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  if (values.every(v => v === 0)) values[bytes - 1] = 1;
  return Array.from(values, v => v.toString(16).padStart(2, '0')).join('');
}
