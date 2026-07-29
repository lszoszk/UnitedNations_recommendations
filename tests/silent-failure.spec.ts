import { test, expect } from '@playwright/test';

/**
 * Regression: when data fails to load, the dashboard must say so.
 *
 * Static audit 2026-07-28, defect class C5 — six findings, one theme: a
 * failed request left the PREVIOUS filter's content on screen, or froze the
 * view on its "Loading…" placeholders, with no indicator either way. This
 * dashboard's output gets cited, so a number that is not what the interface
 * claims it is is the worst failure mode it has.
 *
 *   A-03      Overview's analytics rejection stripped neither the pulsing
 *             "recomputing…" badge nor the previous filter's numbers.
 *   B-03/J1-03 Every profile paint() bailed on the first null section, so one
 *             failed leg blanked a profile whose other five panels had landed.
 *   J2-02     Freshness card reported an unreachable endpoint as "never run".
 *   C-08      A malformed rule set threw mid-template and left the Labels tab
 *             permanently blank — including the selector needed to escape it.
 *
 * (D-02, the choropleth's grid fallback silently dropping 73 states, is
 * covered by switching that fallback to hex — a CDN-outage path these
 * localhost stubs cannot reach.)
 */

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  headers: CORS,
  body: JSON.stringify(body),
});
const fail = (status = 500) => ({
  status,
  contentType: 'application/json',
  headers: CORS,
  body: '{"detail":"stubbed failure"}',
});

const ANALYTICS = {
  trends: {
    yearly_body_counts: [{ year: 2020, body: 'CCPR', count: 5 }],
    dataset_first_publication_date: '2010-01-01T00:00:00',
    dataset_last_publication_date: '2025-01-01T00:00:00',
  },
  themes: { theme_counts: [{ theme: 'Stubbed Theme', count: 42 }] },
  text: {
    affected_person_counts: [{ affected_person: 'Stubbed Group', count: 7 }],
    sdg_counts: [{ sdg: '16.3', count: 3 }],
  },
};

/* NOTE: Playwright matches routes in REVERSE registration order — the last
   handler registered wins, so the catch-all goes FIRST. */
async function stubApi(page: import('@playwright/test').Page) {
  await page.route(/\/api\/data\//, (route) => route.fulfill(json({})));
  // 404 exactly as the live VM does — otherwise the bundled one-call profile
  // path takes over and the three-leg path under test never runs.
  await page.route(/\/api\/data\/profile/, (route) => route.fulfill(fail(404)));
  await page.route(/\/api\/data\/map/, (route) =>
    route.fulfill(json({ country_counts: [{ country: 'Poland', count: 10 }] })),
  );
  await page.route(/\/api\/data\/summary/, (route) => route.fulfill(json({ total_records: 1234 })));
  await page.route(/\/api\/data\/analytics/, (route) => route.fulfill(json(ANALYTICS)));
  await page.route(/\/api\/data\/facets/, (route) =>
    route.fulfill(json({
      countries: ['Poland', 'Germany'], bodies: ['CCPR'], regions: [],
      sdgs_hierarchy: {}, min_year: 2010, max_year: 2025, total_records: 1000,
    })),
  );
}

test('a profile with one failed section paints the rest and says which is missing', async ({ page }) => {
  test.setTimeout(60_000);
  await stubApi(page);
  // The count leg (/summary) fails; analytics and map succeed. paint() used to
  // return at `if (!analytics || !count)` and leave the page on "Loading…".
  await page.route(/\/api\/data\/summary/, (route) => route.fulfill(fail(500)));

  await page.goto('/dashboard.html#view=country&fc=POL');
  await expect(page.locator('#view-country .cp-name')).toHaveText('Poland', { timeout: 15_000 });

  // The sections that DID load are on screen.
  await expect(page.locator('#cpThemes')).toContainText('Stubbed Theme', { timeout: 15_000 });

  // The one that didn't is marked, not guessed at — no zero, no stale number.
  await expect(page.locator('#cpKpis')).toContainText('n/a');
  await expect(page.locator('#view-country .cp-sub')).toContainText('partial');
  await expect(page.locator('#view-country .cp-sub')).toContainText('record count');

  // And the header is not still claiming to be loading.
  await expect(page.locator('#view-country .cp-sub')).not.toHaveText('Loading…');
});

test('Overview marks its panels stale when the analytics refresh fails', async ({ page }) => {
  test.setTimeout(60_000);
  await stubApi(page);

  await page.goto('/dashboard.html');
  await page.waitForFunction("typeof renderOverview === 'function'", null, { timeout: 15_000 });
  await expect(page.locator('#view-overview .p-top-themes')).toContainText('Stubbed Theme', { timeout: 20_000 });

  // Now analytics starts failing, and the user narrows the filter. The panels
  // below still hold the PREVIOUS filter's numbers.
  await page.route(/\/api\/data\/analytics/, (route) => route.fulfill(fail(500)));
  await page.evaluate(`(async () => {
    state.filters.country = new Set(['Poland']);
    await renderOverview({ keepPrevious: true });
  })()`);

  const panel = page.locator('#view-overview .p-top-themes');
  // Never left pulsing "recomputing for current filter…" over stale numbers.
  await expect(panel).not.toHaveClass(/\bpending\b/);
  await expect(panel).toHaveClass(/\bstale-failed\b/);
  await expect(page.locator('#view-overview .p-time')).toHaveClass(/\bstale-failed\b/);
  // ...and the failure was announced, not only implied by a badge.
  await expect(page.locator('#toast')).toContainText("didn't update");
});

test('the freshness card reports an unreachable endpoint as unreachable', async ({ page }) => {
  test.setTimeout(60_000);
  await stubApi(page);
  await page.route(/refresh_status\.json/, (route) => route.fulfill(fail(502)));
  await page.route(/\/api\/data\/health/, (route) => route.fulfill(fail(502)));

  await page.goto('/dashboard.html');
  await page.waitForFunction("typeof navigate === 'function'", null, { timeout: 15_000 });
  await page.evaluate("navigate('methodology')");

  const card = page.locator('#freshness-card');
  await expect(card).toContainText("couldn't check", { timeout: 15_000 });
  // The lie the audit caught: a down endpoint reported as a dated fact about
  // the pipeline.
  await expect(card).not.toContainText('never run');
  await expect(card).not.toContainText('✓ healthy');
});

test('a malformed rule set degrades to a recovery card, not a blank tab', async ({ page }) => {
  test.setTimeout(60_000);
  await stubApi(page);

  // A hand-edited JSON import: `must` is a bare string, not a list. This threw
  // inside renderRules' template literal, so #view-labels was never written.
  await page.addInitScript(() => {
    localStorage.setItem('uhri_v2_rule_sets_v2', JSON.stringify([{
      id: 'rs_broken', name: 'Broken import', saved_at: Date.now(), version: 2,
      rules: [{ id: 'r_1', name: 'Judiciary', must: 'judiciary', also: [], not: [] }],
    }]));
    localStorage.setItem('uhri_v2_rule_active_v2', 'rs_broken');
  });

  await page.goto('/dashboard.html');
  await page.waitForFunction("typeof navigate === 'function'", null, { timeout: 15_000 });
  await page.evaluate("navigate('labels')");

  const view = page.locator('#view-labels');
  // Either the term list was coerced at read time and the card renders, or the
  // render threw and the recovery card offers a way out — never a blank tab.
  await expect(view).not.toBeEmpty({ timeout: 15_000 });
  await expect(view.locator('#rulesRecoverNew, .rule-card, .rules-empty').first()).toBeVisible();
});

test('import rejects a rule set whose term lists are not lists', async ({ page }) => {
  test.setTimeout(60_000);
  await stubApi(page);
  await page.goto('/dashboard.html');
  await page.waitForFunction("typeof rulesNormalizeImportedSet === 'function'", null, { timeout: 15_000 });

  const out = await page.evaluate(`(() => {
    const norm = rulesNormalizeImportedSet({
      name: 'Broken', rules: [{ name: 'R', must: 'judiciary', also: null, not: 3 }],
    });
    return {
      must: norm.rules[0].must,
      also: norm.rules[0].also,
      not: norm.rules[0].not,
      compiled: compileRule(norm.rules[0]),
      notASet: rulesNormalizeImportedSet({ name: 'no rules array' }),
    };
  })()`);

  expect(out.must).toEqual(['judiciary']);   // coerced, not dropped
  expect(out.also).toEqual([]);
  expect(out.not).toEqual([]);
  expect(out.compiled).toBe('judiciary');    // and compiles without throwing
  expect(out.notASet).toBeNull();
});
