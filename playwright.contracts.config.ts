/**
 * Playwright config for the BACKEND CONTRACT TEST SUITE.
 *
 * Different from the default config in three ways:
 *   1. testDir = tests/contracts/ (not tests/)
 *   2. NO webServer — these tests hit the LIVE FastAPI backend at
 *      150.254.115.204; spinning up a local Python server would be
 *      pointless cost.
 *   3. Per-test timeout 30s — pathological queries may have to wait
 *      for FTS5 to error-out, and analytics is the slowest endpoint.
 *
 * Run via:  npm run test:contracts
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/contracts',
  testMatch: /\.spec\.ts$/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    /* No baseURL — tests use the absolute API_BASE constant from
       _endpoints.ts. */
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
  },

  /* Single project — these are HTTP contract tests, no browser
     rendering involved.  Listing chromium just satisfies the
     Playwright runner; the request fixture is what's actually used. */
  projects: [
    {
      name: 'contract',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
