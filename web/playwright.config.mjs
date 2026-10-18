import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:8123', trace: 'retain-on-failure' },
  projects: [
    { name: 'wall', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:8123',
    reuseExistingServer: !process.env.CI,
  },
});
