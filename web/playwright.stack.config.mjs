import { defineConfig } from '@playwright/test';

// Browser checks against the whole app, real API and database included, as `docker compose up`
// runs it. Each test's browser gets its own demo copy, so the checks never share data.
export default defineConfig({
  testDir: './e2e-stack',
  outputDir: './stack-results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: process.env.STACK_URL ?? 'http://127.0.0.1:8080', trace: 'retain-on-failure' },
  projects: [
    { name: 'wall', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
  ],
});
