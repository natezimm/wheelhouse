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
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  if (mode === 'Family') {
    // A fresh, unauthenticated context must not expose family data.
    expect((await context.request.get('/api/family')).status()).toBe(401);
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.locator('app-today-events')).toHaveCount(0);
  } else {
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await expect(page.locator('app-today-events')).toContainText(/\S/);
    for (const [name, path, selector] of [
      ['Calendar', '/calendar', 'app-phone-calendar .month'],
    ]) {
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new URL(path, baseURL).href);
      await expect(page.locator(selector)).toBeVisible();
      await expect(page.locator(selector)).toContainText(/\S/);
    }
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link')).toHaveCount(2);
    // Match actual seeded events returned by this browser's own demo copy to
    // rendered wall text. A healthy API with an empty/old UI must fail here.
    await page.setViewportSize({ width: 1920, height: 1080 });
    const snapshot = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/calendar' && r.status() === 200);
    await page.goto('/wall', { waitUntil: 'domcontentloaded' });
    const events = (await (await snapshot).json()).events;
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
