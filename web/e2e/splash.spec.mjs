import { test, expect } from '@playwright/test';

const family = {
  id: 'family',
  name: 'The Marlowes',
  timeZone: 'America/New_York',
  weekStartsOn: 'Monday',
  nightModeFrom: '22:00:00',
  nightModeTo: '06:00:00',
  theme: 'Groovy',
  nightMode: 'AtNight',
  units: 'Imperial',
  latitude: null,
  longitude: null,
  members: [{ id: 'm1', displayName: 'Ben', initial: 'B', role: 'Parent', color: '#2F5FC4' }],
};

/** Answers the API, holding the calendar until the test lets it go. */
async function stub(page) {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    if (url === '/api/calendar') {
      await held;
      return route.fulfill({ json: { calendars: [{ id: 'c1', name: 'Ben', memberId: 'm1', canWrite: true }], events: [], changeNumber: 1 } });
    }
    const body = url === '/api/session' ? { mode: 'Demo', signedIn: true, canSignIn: false } : url === '/api/family' ? family : {};
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'Healthy' }));
  await page.route('**/hubs/**', (route) => route.fulfill({ status: 503, body: 'Offline' }));
  return () => release();
}

const splash = (page) => page.locator('#splash');

test('the splash covers the start until the calendar answers, then fades away', async ({ page }) => {
  const release = await stub(page);
  await page.goto('/');

  await expect(splash(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Starting Wheelhouse' })).toBeAttached();
  // The family is known by now; the splash still waits for the calendar.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'groovy');
  await expect(splash(page)).not.toHaveClass(/splash-leaving/);

  release();
  await expect(splash(page)).toHaveCount(0);
});

test('a quick start never shows the wheel, not even as the splash fades', async ({ page }) => {
  // Records the most the splash's body has shown, frame by frame, and when the splash began to leave.
  await page.addInitScript(() => {
    window.splashSeen = { most: 0, leftAt: null };
    const start = performance.now();
    const watch = () => {
      const splash = document.getElementById('splash');
      const body = splash?.querySelector('.splash-body');
      if (!splash) return;
      if (body) {
        const shown = Number(getComputedStyle(body).opacity) * Number(getComputedStyle(splash).opacity);
        window.splashSeen.most = Math.max(window.splashSeen.most, shown);
      }
      if (splash.classList.contains('splash-leaving') && window.splashSeen.leftAt === null) {
        window.splashSeen.leftAt = performance.now() - start;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  const release = await stub(page);
  release();
  await page.goto('/');
  await expect(splash(page)).toHaveCount(0);

  const seen = await page.evaluate(() => window.splashSeen);
  test.skip(seen.leftAt === null || seen.leftAt > 500, `This start took ${seen.leftAt} ms, too slow to say anything about a quick one.`);
  expect(seen.most).toBe(0);
});

test('a later start wears the family’s theme, dark at its night hours, before the app has asked', async ({ page }) => {
  // 11 PM in New York: inside the family's night hours.
  await page.clock.install({ time: new Date('2026-10-13T03:00:00Z') });
  const release = await stub(page);
  await page.goto('/');
  release();
  await expect(splash(page)).toHaveCount(0);

  // The app starts this time but the family never arrives, so only what the browser kept can dress the splash.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url()).pathname;
    if (url === '/api/session') return route.fulfill({ json: { mode: 'Demo', signedIn: true, canSignIn: false } });
    if (url === '/api/demo/visit') return route.fulfill({ status: 204 });
  });
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.reload();

  await expect(page.locator('app-root')).not.toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'groovy');
  await expect(page.locator('html')).toHaveAttribute('data-night', '');
  await expect(splash(page)).toHaveCSS('background-color', await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await expect(page.locator('link[data-fonts="groovy"]')).toHaveCount(1);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the wheel stays still', async ({ page }) => {
    await stub(page);
    await page.goto('/');

    await expect(page.locator('.splash-wheel')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.splash-body')).toHaveCSS('opacity', '1');
  });
});
