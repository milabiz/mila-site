import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // Playwright specs live in tests/*.spec.ts and are run by `npm run test:e2e`.
    exclude: ['tests/*.spec.ts', 'node_modules/**'],
  },
});
