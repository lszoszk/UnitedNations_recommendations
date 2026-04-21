import { defineConfig, devices } from '@playwright/test';

/**
 * UHRI Dashboard — smoke tests only.
 *
 * SCOPE: catch the classes of regression that have hurt us in recent weeks:
 *   - Inline <script> halting mid-IIFE so later wiring never happens
 *   - Script load order broken by extraction (forward-ref globals missing)
 *   - Text-drift (hardcoded numbers that no longer match the dataset)
 *   - Hash-based routing failing to restore state
 *
 * We do NOT test live API calls — the backend is on a cross-origin VM
 * (150.254.115.204) with its own monitoring. These tests run against
 * a local Python http.server serving this directory, and they tolerate
 * failed /api/data/* calls (the dashboard degrades gracefully).
 *
 * RUN: `npm test` (headless). `npm run test:headed` to watch. `npm run
 * test:ui` for interactive debugger.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,      // one browser, tests share a serving port
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                // keep it simple — local smoke only
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'python3 -m http.server 8787',
    url: 'http://localhost:8787/dashboard.html',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 10_000,
  },
});
