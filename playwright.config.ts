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
  /* Exclude two suites that have their own configs:
     - contracts/  → playwright.contracts.config.ts (live VM, no localhost)
     - user-flows  → playwright.live.config.ts (live deployed dashboard)
     Both run via dedicated npm scripts (test:contracts / test:live-flows).
     Without this exclusion, `npm test` (the smoke suite) would try to
     run them against localhost and fail because the URL/baseURL doesn't
     match what they expect. */
  testIgnore: ['**/contracts/**', '**/user-flows.spec.ts'],
  fullyParallel: false,      // one browser, tests share a serving port
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                // keep it simple — local smoke only
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    /* sw.js calls skipWaiting() + clients.claim(), so a few seconds into
       every page it takes control of the client — and requests issued
       through a service worker are NOT visible to page.route(). Tests would
       start against their stubs and then silently switch to the live VM
       mid-run: the first profile got mocked data, the one after the SW
       activated got real records. That produced the whole WebKit/mobile red
       block (mocked totals arriving as real ones, /records assertions seeing
       no intercepted request, the update chip appearing and overlapping the
       topbar) while Chromium stayed green, because its SW timing differed.
       No suite here exercises the worker, so block it and let every request
       stay interceptable. The live/audit/contracts configs deliberately do
       NOT set this — there the worker is part of what is being tested. */
    serviceWorkers: 'block',
  },

  /* Four projects — chromium is the default fast gate; the other three
     run via dedicated scripts (test:firefox / test:webkit / test:mobile /
     test:cross-browser).  Cross-browser coverage matters because
     Safari/WebKit have shipped real regressions affecting this dashboard
     (commit 5364fd9 documented a Safari 26 SW + cross-origin HTTP/2
     gzip race, fixed via SW pass-through).  Mobile chromium catches
     viewport-narrow rendering bugs on iPhone-class widths. */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      /* Firefox is slower at boot than Chromium under the same WebServer.
         The tablist roving-tabindex + axe-core combination occasionally
         times out the 5 s waits used by some smoke specs.  Mark moderate
         and minor flakes informationally: rerun a failing test once. */
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
      /* Mobile project intentionally skips topbar-widths.spec.ts (it
         tests desktop breakpoints) and a11y.spec.ts (axe runs once on
         desktop is enough; rerunning on every viewport is overkill).
         Must also re-state the global testIgnore (contracts/ +
         user-flows) — Playwright project-level testIgnore replaces
         rather than merges with the top-level one, so without these
         the mobile project would try to run user-flows + contracts. */
      testIgnore: [
        '**/contracts/**', '**/user-flows.spec.ts',
        '**/topbar-widths.spec.ts', '**/a11y.spec.ts',
      ],
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
