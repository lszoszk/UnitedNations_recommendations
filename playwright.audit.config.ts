/**
 * Playwright config for the PRE-BETA SELF-AUDIT suite.
 *
 * Different from playwright.config.ts (smoke) and playwright.live.config.ts
 * (20-flow user audit) in three ways:
 *   1. testDir = tests/, testMatch = self-audit only
 *   2. NO webServer — runs against the LIVE deployed dashboard +
 *      LIVE VM API, same as user-flows.
 *   3. Per-test timeout 60 s — some scenarios drive the full UI
 *      through 7 tab transitions or seed records via the API and
 *      cross-check against the rendered DOM.
 *
 * Run via:  npm run test:self-audit
 *
 * Output:
 *   - test-results/self-audit-report-YYYY-MM-DD.md  (the actual
 *     deliverable, one section per scenario, status + evidence + notes)
 *   - test-results/*.png screenshots if a scenario captures one
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /self-audit\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,            // self-audit captures FIRST-RUN reality; retries would hide flake
  reporter: [['list']],
  use: {
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'audit', use: { ...devices['Desktop Chrome'] } }],
});
