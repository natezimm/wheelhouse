// The load budget: how long a phone on a slow connection waits for its first calendar, and how
// many bytes of the app it downloads on the way, against the whole app as `docker compose up` runs
// it. CI runs it in the stack job. docs/performance-budget.md says what it checks and how to run
// it; ADR 0011 says why the limits sit where they do.
//
//   LOAD_URL=http://127.0.0.1:8080 node web/perf/load-budget.mjs
//
// Each run is a first visit: a new browser context with an empty cache and its own demo copy, a
// 390 × 844 phone, DevTools' Slow 4G as Lighthouse applies it, and a CPU four times slower. One
// unmeasured run warms the API and database first. Time is held as the median of the measured
// runs, loosely, since it varies with the machine; bytes are the same on every run and are held
// tightly.
import { createRequire } from 'node:module';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';

const { chromium } = createRequire(new URL('../package.json', import.meta.url))('@playwright/test');

/** The limits. Raise one only on purpose, in the pull request that needs it (see ADR 0011). */
export const BUDGET = {
  /** Median time from navigation until the first calendar shows, its splash leaving. */
  readyMs: 5000,
  /** The site's own files downloaded before then (not /api or /hubs), compressed, headers included. */
  appKb: 215,
  /** Of those, the JavaScript. */
  scriptKb: 200,
};

/** DevTools' Slow 4G as Lighthouse applies it for its mobile run, and its 4× slower CPU. */
export const PROFILE = {
  latencyMs: 562.5,
  downloadKbps: 1474.56,
  uploadKbps: 675,
  cpuSlowdown: 4,
};

const baseURL = process.env.LOAD_URL;
const runs = Number(process.env.LOAD_RUNS || 5);
const outDir = process.env.LOAD_RESULTS || 'load-results';
if (!baseURL) throw new Error('LOAD_URL is required');

/**
 * Runs in the page before any of its own scripts: notes when the agenda first has events in it
 * and when the splash over it starts to leave, which is when a visitor first sees the calendar.
 */
function watchForCalendar() {
  const marks = {};
  window.__loadMarks = marks;
  const observer = new MutationObserver(() => {
    if (marks.calendar === undefined && document.querySelector('app-agenda-list')?.textContent?.trim()) {
      marks.calendar = performance.now();
    }
    if (marks.splash === undefined && document.querySelector('.splash-leaving')) marks.splash = performance.now();
    if (marks.calendar !== undefined && marks.splash !== undefined) observer.disconnect();
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

async function visit(browser) {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.addInitScript(watchForCalendar);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: PROFILE.latencyMs,
      downloadThroughput: (PROFILE.downloadKbps * 1024) / 8,
      uploadThroughput: (PROFILE.uploadKbps * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: PROFILE.cpuSlowdown });
    const errors = [];
    page.on('pageerror', () => errors.push('a browser runtime error'));
    // The weather comes from another service and may be down; the calendar may not be.
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400 && !path.startsWith('/api/weather')) errors.push(`${response.status()} from ${path}`);
    });
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__loadMarks.calendar !== undefined && window.__loadMarks.splash !== undefined, null, {
      timeout: 30_000,
      polling: 250,
    });
    if (errors.length) throw new Error(`The first visit met ${errors.join(', ')}`);
    // The page's own timings of what finished arriving before the calendar showed, which is
    // what the visitor waited for. transferSize is the compressed body plus its headers.
    return await page.evaluate(() => {
      const { calendar, splash } = window.__loadMarks;
      const ready = Math.max(calendar, splash);
      const entries = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')]
        .filter((entry) => entry.responseEnd <= ready)
        .map((entry) => ({ url: new URL(entry.name), bytes: entry.transferSize }));
      const own = entries.filter(({ url }) => url.origin === location.origin);
      const isApp = ({ url }) => !/^\/(api|hubs)\//.test(url.pathname);
      const kb = (list) => Math.round(list.reduce((total, entry) => total + entry.bytes, 0) / 102.4) / 10;
      return {
        readyMs: Math.round(ready),
        appKb: kb(own.filter(isApp)),
        scriptKb: kb(own.filter((entry) => isApp(entry) && entry.url.pathname.endsWith('.js'))),
        apiKb: kb(own.filter((entry) => !isApp(entry))),
        otherOriginKb: kb(entries.filter(({ url }) => url.origin !== location.origin)),
        requests: entries.length,
      };
    });
  } finally {
    await context.close();
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// CHROMIUM_PATH points at a browser Playwright did not install itself, where that is needed.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
try {
  await visit(browser); // warms the API and the database; not counted
  for (let run = 0; run < runs; run++) results.push(await visit(browser));
} finally {
  await browser.close();
}

const largest = (key) => Math.max(...results.map((result) => result[key]));
const measured = {
  readyMs: median(results.map((result) => result.readyMs)),
  appKb: largest('appKb'),
  scriptKb: largest('scriptKb'),
};
const rows = [
  ['Calendar on screen (median)', `${measured.readyMs} ms`, `${BUDGET.readyMs} ms`, measured.readyMs <= BUDGET.readyMs],
  ["The app's files before then", `${measured.appKb} kB`, `${BUDGET.appKb} kB`, measured.appKb <= BUDGET.appKb],
  ['Of which JavaScript', `${measured.scriptKb} kB`, `${BUDGET.scriptKb} kB`, measured.scriptKb <= BUDGET.scriptKb],
];
const summary = [
  '### Load budget',
  '',
  `A first visit to \`/\` on a 390 × 844 phone over Slow 4G (${PROFILE.latencyMs} ms, ${Math.round(PROFILE.downloadKbps)} kbps down) with a CPU ${PROFILE.cpuSlowdown}× slower, ${runs} runs after one warm-up.`,
  '',
  '| | Measured | Budget | |',
  '| --- | --- | --- | --- |',
  ...rows.map(([name, value, limit, ok]) => `| ${name} | ${value} | ${limit} | ${ok ? 'within' : '**over**'} |`),
  '',
  `Each run: ${results.map((result) => `${result.readyMs} ms`).join(', ')}. Not budgeted: the API's answers (${largest('apiKb')} kB, which change with the demo's week) and web fonts from other sites (${largest('otherOriginKb')} kB).`,
  '',
].join('\n');
console.log(summary);
await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/load-budget.json`, `${JSON.stringify({ budget: BUDGET, profile: PROFILE, measured, runs: results }, null, 2)}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
const over = rows.filter((row) => !row[3]).map((row) => row[0]);
if (over.length) {
  console.error(`Over the load budget: ${over.join('; ')}. See docs/performance-budget.md.`);
  process.exit(1);
}
