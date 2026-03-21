import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:4321',
  },
  webServer: {
    command: 'npm run preview',
    port: 4321,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'Desktop',
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'Mobile',
      use: { viewport: { width: 375, height: 667 } },
    },
  ],
});
