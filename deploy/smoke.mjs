// Real deployed API and browser checks, reached through an SSH loopback tunnel.
// No Google credentials, family content, request traces or response bodies are recorded.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium, expect: baseExpect } = createRequire(new URL('../web/package.json', import.meta.url))('@playwright/test');
const timeout = Number(process.env.SMOKE_TIMEOUT_MS || 30_000);
const expect = baseExpect.configure({ timeout });
const baseURL = process.env.SMOKE_URL;
const mode = process.env.SMOKE_MODE;
if (!baseURL || !['Demo', 'Family'].includes(mode)) throw new Error('SMOKE_URL and SMOKE_MODE are required');
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
context.setDefaultTimeout(timeout);
const page = await context.newPage();
const errors = [];
page.on('pageerror', () => errors.push('Browser runtime error'));
page.on('response', (response) => {
  const path = new URL(response.url()).pathname;
  const expectedPrivateRefusal = mode === 'Family' && response.status() === 401;
  if (/^\/api\/(session|family|calendar|demo\/visit)(\/|$)/.test(path) && response.status() >= 400 && !expectedPrivateRefusal) {
    errors.push(`Core API failed (${response.status()})`);
  }
});
try {
  const health = await context.request.get('/health');
  expect(health.ok()).toBeTruthy();
  const sessionResponse = await context.request.get('/api/session');
  expect(sessionResponse.ok()).toBeTruthy();
  expect((await sessionResponse.json()).mode).toBe(mode);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  if (mode === 'Family') {
    // A fresh, unauthenticated context must not expose family data.
    expect((await context.request.get('/api/family')).status()).toBe(401);
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.locator('app-agenda-list')).toHaveCount(0);
  } else {
    // A new phone opens on today's agenda, with the calendar and Settings along the bottom.
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.locator('app-agenda-list')).toContainText(/\S/);
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await expect(sections.getByRole('link')).toHaveCount(2);
    await expect(sections.getByRole('link', { name: 'Calendar', exact: true })).toBeVisible();
    await expect(sections.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page.locator('app-phone-month .month')).toBeVisible();
    await expect(page.locator('app-phone-month .month')).toContainText(/\S/);
    // Old links to /calendar still reach the calendar.
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new URL('/', baseURL).href);
    // A desktop window opens on the week, with the sections in a rail.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    // Match actual seeded events returned by this browser's own demo copy to
    // rendered wall text. A healthy API with an empty/old UI must fail here.
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Read the body as soon as it arrives: a live refresh can replace it in the browser's cache.
    const snapshot = page
      .waitForResponse((r) => new URL(r.url()).pathname === '/api/calendar' && r.status() === 200)
      .then((response) => response.json());
    await page.goto('/wall', { waitUntil: 'domcontentloaded' });
    const events = (await snapshot).events;
    expect(events.length).toBeGreaterThan(0);
    await expect.poll(async () => {
      for (const event of events) {
        if (await page.getByText(event.title, { exact: true }).first().isVisible()) return true;
      }
      return false;
    }, { timeout }).toBeTruthy();
    await mkdir('smoke-results', { recursive: true });
    await page.screenshot({ path: `smoke-results/demo-wall-${process.env.SMOKE_INDEX || '1'}.png` });
  }
  expect(errors).toEqual([]);
  console.log(`${mode} browser smoke passed`);
} catch {
  // Deliberately omit Playwright's assertion details, URLs and response data.
  console.error(`${mode} browser smoke failed. Check the release recovery instructions.`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
