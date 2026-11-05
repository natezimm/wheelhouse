# Performance budget

The demo once took five seconds to show a phone its calendar, and nothing noticed until a person did ([the fix](https://github.com/natezimm/wheelhouse/pull/110)). CI now holds the first load to a budget, in two places, so a change that makes it slower fails its pull request instead of reaching visitors. [ADR 0011](adr/0011-performance-budget-in-ci.md) says why the limits are where they are.

## What is checked

**Bundle sizes, in every build.** `web/angular.json`'s production budgets fail `npm run build`, and with it the `web` job and the images, when the app outgrows them. Sizes are the build's own, before compression; a warning in the build log comes first, about 5% over today's size, and the error about 12% over.

| Budget | Today | Warning | Error |
| --- | --- | --- | --- |
| Initial files (`initial`: what every screen loads first) | 402 kB | 420 kB | 450 kB |
| The calendar screen's own chunk (`calendar-home`) | 96 kB | 105 kB | 115 kB |
| All the JavaScript (`allScript`) | 784 kB | 820 kB | 880 kB |
| Any one component's styles (`anyComponentStyle`) | 7.8 kB at most | 6 kB | 8 kB |

**A first visit, in the `stack` job.** `web/perf/load-budget.mjs` opens `/` on the demo as `docker compose up` runs it, as a new visitor on a 390 × 844 phone, over DevTools' Slow 4G as Lighthouse applies it (562.5 ms round trips, 1.47 Mbit/s down) with the CPU four times slower. One run warms the API and database, then five are measured, each a fresh browser with an empty cache and its own demo copy. It measures until the calendar is on screen: the agenda has its events and the splash has begun to leave.

| Measure | Held to | Why that one |
| --- | --- | --- |
| Time until the calendar shows (CI measured 4,570 ms when this was added) | the median of the five runs, at most 5,000 ms | what a visitor feels; the median ignores one slow run |
| The app's own files downloaded by then (HTML, script, styles, pictures), compressed | the largest run, at most 215 kB | the same on every run, so it can be held tightly |
| Of those, JavaScript | at most 200 kB | the part a phone's CPU also has to run |

The answers from `/api` and `/hubs` (they change with the demo's week) and the fonts from Google Fonts are reported but not budgeted. The weather may fail without failing the check, since it comes from another service; any other failed request, or an error in the page, fails it.

Before the visits, the same step asks for the app's `main` script over HTTP/1.0, as the server's nginx forwards it, and fails if it does not arrive compressed: the cause of the five-second load.

The job's summary shows the table with each measure against its limit, and `load-results/load-budget.json` in the `stack-browser-checks` artifact keeps every run.

## Running it yourself

```
docker compose up --build -d
LOAD_URL=http://127.0.0.1:8080 node web/perf/load-budget.mjs
```

Run it from the repository root after `npm ci` in `web/`. `LOAD_RUNS` changes the number of measured runs, `LOAD_RESULTS` where the JSON goes, and `CHROMIUM_PATH` points at a Chromium that Playwright did not install itself. A faster machine than CI's measures less time; compare bytes, which do not depend on the machine.

## When a pull request goes over

1. **Find what grew.** The build log lists every chunk's size; build `main` and compare. A new import that pulls in a library, or code moved from a lazy chunk into `main`, is the usual cause. For the time budget, compare the runs in the job summary with those of a recent green run on `main`; a new request the first screen waits for costs about 600 ms on this profile.
2. **Make it smaller if you can.** Load it lazily (`loadComponent`, a dynamic `import()`), drop the dependency, or keep the first screen from waiting for it.
3. **Otherwise raise the limit on purpose.** When the growth is worth it, raise the limit in the same pull request (`BUDGET` in `web/perf/load-budget.mjs`, the budgets in `web/angular.json`, and this page's tables) and say why in its description. Do not raise a limit to get a flaky run through: re-run it once, and if it fails again it is not flaky.

Lower the limits when the app gets smaller, so the headroom does not quietly grow.
