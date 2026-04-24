import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: /user-flows\.spec\.ts/,
  timeout: 120_000,         // each flow can take up to 2 minutes (live API + multi-step interaction)
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    actionTimeout: 10_000,  // individual click/find operations fail fast
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
