# 0011. A performance budget in CI: sizes held tightly, time loosely

**Status:** Accepted, November 2026

## Context

In November 2026 the demo took about five seconds to show a phone its calendar. The cause was the app's JavaScript reaching browsers uncompressed behind the server's HTTP/1.0 proxy, which no check could see; a person noticed. The fix ([#110](https://github.com/natezimm/wheelhouse/pull/110)) brought a throttled phone's first load to about 2.2 seconds. Nothing kept it there: the build's only budget was Angular's default (an error at 1 MB of initial files, two and a half times the app's size), and no check timed a load.

Speed is part of what the demo is for, since it is the first thing a recruiter or a family sees. A budget has to fail a pull request that makes the first load slower, without failing pull requests that did nothing, because a check that fails at random is soon re-run without being read and then ignored.

The options weighed:

- **Lighthouse CI.** The usual tool, with a performance score and timings. It adds a dependency and its own Chrome, and its score bundles several timings with weights that change between versions, so a score drop can come from an upgrade. Its simulated throttling (Lantern) models a network rather than slowing one, and on a shared CI machine its numbers still vary from run to run by more than the regressions worth catching.
- **Real User Monitoring** on the deployed demo. Real numbers, but it needs a collector, sees a regression only after it ships, and would put a third-party script in front of a site whose Content-Security-Policy allows none.
- **Bundle-size budgets only.** Exact and free, but blind to a change that adds a round trip, which on a phone's network costs more than kilobytes.
- **Bundle budgets in the build, plus a timed first visit with Playwright and the DevTools throttling Lighthouse applies, against the real stack.**

## Decision

Two checks, split by how much each measure varies ([performance budget](../performance-budget.md)):

- **Sizes are held tightly.** Angular's production budgets in `web/angular.json` fail the build about 12% over today's sizes (initial files, the calendar screen's chunk, all the JavaScript), warning at about 5%. The load check also holds the compressed bytes of the app's own files that a first visit downloads before its calendar shows, about 10% over today. Bytes are the same on every run, so the limits can sit close without ever failing at random, and they catch most regressions: a new library, code moved out of a lazy chunk, compression lost again.
- **Time is held loosely.** `web/perf/load-budget.mjs` in the `stack` job opens `/` on the demo as a new visitor on a phone, over DevTools' Slow 4G as Lighthouse applies it and with the CPU four times slower, warms up once, then takes the median of five fresh visits. The median must stay under a limit with room for a slower machine, about 10 to 20% over what CI measures today. It does not catch a small slowdown; it does catch a new round trip before the first screen, a request that hangs, or the app not starting.
- **What another service controls is reported, not budgeted.** The API's answers change with the demo's seeded week and the fonts come from Google Fonts, so neither counts toward a limit, and a weather failure does not fail the check.
- **Limits move only on purpose.** A pull request that needs more raises the limit itself and says why; one that makes the app smaller lowers it.

The time is measured on the stack CI already builds, real API and PostgreSQL included, so a slower query on the first screen counts as well as a heavier bundle, and no new dependency or service is added: Playwright's Chromium is already installed for the other browser checks.

## Consequences

- Thresholds against flakiness: a tight time limit would catch smaller regressions but fail on a busy runner; a loose one never flakes but lets a few hundred milliseconds through each time. Holding bytes tightly and time loosely keeps most of the catching where the measure is exact. Slow creep in time, under the limit, still needs a person to look at the job summary now and then.
- The profile is harsher than the 2.2 seconds measured for #110, so the check reports a larger number for the same app. It is a fixed yardstick for comparing pull requests, not a promise of what a visitor waits.
- CI's machines are not the server, and the stack runs without the server's nginx or HTTPS. The one difference that has bitten, the server's nginx forwarding over HTTP/1.0, is checked directly: the same step asks for the app's script over HTTP/1.0 and fails if it arrives uncompressed. Anything else only the deployed setup shows is still caught only after a release, by its browser checks or a person.
- The stack job takes about a minute longer, and makes six more demo copies from one address, well under the demo's 20 an hour.
- Each limit is a number someone has to keep honest. The page lists them in one place, with what to do when one fails.
