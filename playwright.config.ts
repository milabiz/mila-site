import { defineConfig } from '@playwright/test';

/**
 * Runs against `astro dev`, not `astro preview` — the Vercel adapter does not
 * support preview, and the demo route is on-demand rendered.
 *
 * DEMO_MODE=mock so the endpoint never calls a provider or the database:
 * the suite costs nothing and cannot be flaky on provider latency. UI-level
 * response shapes are mocked per-test with page.route().
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.DEPLOY_URL ?? 'http://localhost:4321',
    trace: 'retain-on-failure',
  },

  // When DEPLOY_URL is set we're testing a real deployment — don't start one.
  webServer: process.env.DEPLOY_URL
    ? undefined
    : {
        command: 'npm run dev',
        port: 4321,
        reuseExistingServer: !process.env.CI,
        env: { DEMO_MODE: 'mock' },
      },

  projects: [
    { name: 'Desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'Mobile', use: { viewport: { width: 375, height: 812 } } },
  ],
});
