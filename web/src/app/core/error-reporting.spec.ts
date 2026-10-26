import { ClientErrorReport, REPORT_LIMIT, REPORT_WINDOW_MS, ReportingErrorHandler, reportFor } from './error-reporting';

describe('error reporting', () => {
  let console: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    console = vi.spyOn(window.console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('names the layout from the page and the window width', () => {
    expect(reportFor(new TypeError('x is undefined'), '/wall', 1920).layout).toBe('wall');
    expect(reportFor(new Error('a'), '/', 390).layout).toBe('phone');
    expect(reportFor(new Error('a'), '/settings', 1024).layout).toBe('desktop');
  });

  it('keeps the name, message and stack of an Error, and a string of anything else', () => {
    const error = new TypeError('x is undefined');
    expect(reportFor(error, '/', 390)).toEqual(expect.objectContaining({ message: 'TypeError: x is undefined', stack: error.stack }));
    expect(reportFor('plain', '/', 390)).toEqual(expect.objectContaining({ message: 'plain', stack: null }));
  });

  it('still logs to the console, sends a message once and caps how many it sends', () => {
    const sent: ClientErrorReport[] = [];
    let now = 0;
    const handler = new ReportingErrorHandler((report) => sent.push(report), () => now);

    handler.handleError(new Error('same'));
    handler.handleError(new Error('same'));
    expect(sent.length).toBe(1);
    expect(console).toHaveBeenCalledTimes(2);

    for (let i = 0; i < REPORT_LIMIT * 2; i++) handler.handleError(new Error(`error ${i}`));
    expect(sent.length).toBe(REPORT_LIMIT);

    now += REPORT_WINDOW_MS;
    handler.handleError(new Error('later'));
    expect(sent.at(-1)!.message).toBe('Error: later');
  });

  it('never throws when sending fails', () => {
    const handler = new ReportingErrorHandler(() => { throw new Error('offline'); });
    expect(() => handler.handleError(new Error('boom'))).not.toThrow();
  });
});
