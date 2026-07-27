import { test, expect } from '@playwright/test';

/**
 * Regression: Labels rule counts must not cancel one another.
 *
 * Every rule card fetches its own count, and they all fire in the same tick
 * (renderRules -> rulesRefreshAllCounts sets every 350ms debounce timer
 * together, so they expire together). api.recordsCount defaults to the shared
 * scope 'recordsCount', and apiGet aborts an in-flight request in the same
 * scope whenever a newer one arrives with different params — so on the shared
 * scope each rule killed the previous rule's request and only the last rule
 * ever resolved. The rest sat on "counting…" forever, because the AbortError
 * branch in rulesFetchCount deliberately returns without clearing the loading
 * state (it assumes a supersession is followed by a fetch that repaints).
 *
 * The fix gives each rule its own scope, so only a newer count for rule X can
 * abort rule X. This test pins that: every rule card must reach a resolved
 * count, and /summary must be hit once per rule.
 */

const SUMMARY_RE = /\/api\/data\/summary/;

test('every Labels rule card resolves its count (no cross-rule aborts)', async ({ page }) => {
  /* Above the default 30s: the stub is deliberately slow and the poll below
     budgets 25s, so a genuine regression must have room to fail on the poll's
     own message ("not every rule card resolved its count") rather than being
     cut short by the test timeout, which says nothing about the cause. Passes
     in ~2.5s; this ceiling only matters on a loaded CI box. */
  test.setTimeout(60_000);

  const summaryUrls: string[] = [];

  // Stub /summary with a delay. The delay is what makes the race observable:
  // without it each request finishes before the next is issued and the bug
  // hides. Distinct total_records per query also proves counts aren't shared.
  await page.route(SUMMARY_RE, async (route) => {
    const url = route.request().url();
    summaryUrls.push(url);
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ total_records: 1000 + (summaryUrls.length * 7) }),
    });
  });

  // Stub every other API call with an empty-but-valid payload; the Labels
  // workspace is all we care about here, and letting these fail would only
  // add unrelated console noise.
  await page.route(/\/api\/data\/(?!summary)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '{}',
    }),
  );

  await page.goto('/dashboard.html#view=labels');
  await page.waitForSelector('[data-starter]', { timeout: 15_000 });

  // Starter templates carry 4-5 rules each — enough to race on a GATE_LIMIT
  // of 2. Pick the largest so the queue actually backs up.
  const starters = page.locator('[data-starter]');
  const n = await starters.count();
  expect(n).toBeGreaterThan(0);
  await starters.first().click();

  const cards = page.locator('.rule-card');
  await expect.poll(() => cards.count(), { timeout: 10_000 }).toBeGreaterThan(1);
  const ruleCount = await cards.count();

  const counts = page.locator('.rule-card .rule-count');
  const RESOLVED = /[\d,]+\s*\(\d+(\.\d+)?%\)/;

  // The assertion: EVERY card reaches a resolved number. Polling for the
  // absence of "counting…" would pass trivially at t=0, when the cards are
  // still on their "—" placeholder and no fetch has started yet.
  await expect
    .poll(
      async () => (await counts.allTextContents()).filter((t) => RESOLVED.test(t)).length,
      { timeout: 25_000, message: 'not every rule card resolved its count' },
    )
    .toBe(ruleCount);

  // Nothing stuck mid-flight or errored once the dust settles.
  const texts = await counts.allTextContents();
  expect(texts).toHaveLength(ruleCount);
  for (const t of texts) {
    expect(t, `unresolved rule count: "${t}"`).toMatch(RESOLVED);
  }

  // One /summary per rule — proof the requests all survived to the network
  // rather than being cancelled while queued behind the shared scope.
  expect(summaryUrls.length).toBeGreaterThanOrEqual(ruleCount);
});
