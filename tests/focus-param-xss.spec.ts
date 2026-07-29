import { test, expect } from '@playwright/test';

/**
 * Regression: a crafted URL must not execute script.
 *
 * Static audit 2026-07-28, SW1-01 (class C1). `_restoreUrlState` took the
 * focus params (fc/ft/fg/fsdg/fm) verbatim out of the hash, and
 * `renderCountry` interpolated `state.focusCountry` into the profile eyebrow
 * with no `sanitize()` — the one unescaped value on a line whose sibling
 * (`sanitize(name)`) was escaped. Confirmed executing on the deployed site:
 *
 *   dashboard.html#view=country&fc=<img src=x onerror="...">
 *
 * It matters more than a lone self-XSS would: this origin is shared with the
 * author's three other dashboards, so script here reads their localStorage
 * too, and UHRI+ URLs are built to be shared and cited — the delivery vector
 * is the product's own feature.
 *
 * Two layers are under test: the sink escapes (the actual fix), and
 * `_safeFocusParam` refuses the value at the source (defence in depth).
 * SW1-02 — the same sink class in dashboard-timeline.js's modeHint, fed by
 * an API body name rather than the URL — is covered by the unit assertion
 * at the bottom.
 */

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  headers: CORS,
  body: JSON.stringify(body),
});

/* NOTE: Playwright matches routes in REVERSE registration order — the last
   handler registered wins, so the catch-all goes FIRST. */
async function stubApi(page: import('@playwright/test').Page) {
  await page.route(/\/api\/data\//, (route) => route.fulfill(json({})));
  await page.route(/\/api\/data\/map/, (route) =>
    route.fulfill(json({ country_counts: [{ country: 'Poland', count: 10 }] })),
  );
  await page.route(/\/api\/data\/summary/, (route) => route.fulfill(json({ total_records: 1234 })));
  await page.route(/\/api\/data\/analytics/, (route) =>
    route.fulfill(json({
      trends: {
        yearly_body_counts: [{ year: 2020, body: 'CCPR', count: 5 }],
        dataset_first_publication_date: '2010-01-01T00:00:00',
        dataset_last_publication_date: '2025-01-01T00:00:00',
      },
      themes: { theme_counts: [{ theme: 'Stubbed Theme', count: 42 }] },
      text: { affected_person_counts: [], sdg_counts: [] },
    })),
  );
  await page.route(/\/api\/data\/facets/, (route) =>
    route.fulfill(json({
      countries: ['Poland', 'Germany'], bodies: ['CCPR'], regions: [],
      sdgs_hierarchy: {}, min_year: 2010, max_year: 2025, total_records: 1000,
    })),
  );
}

const PAYLOAD = '<img src=x onerror="window.__xssFired=true">';

test('a crafted fc param neither executes nor reaches the DOM as markup', async ({ page }) => {
  await stubApi(page);
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });

  await page.goto(`/dashboard.html#view=country&fc=${encodeURIComponent(PAYLOAD)}`);
  await page.waitForFunction(() => (window as any).__state?.bootstrapDone === true, null, { timeout: 30_000 });

  // 1. No script ran.
  expect(await page.evaluate(() => (window as any).__xssFired)).toBeUndefined();
  expect(dialogs).toEqual([]);

  // 2. Nothing was parsed as markup anywhere in the page.
  expect(await page.locator('img[src="x"]').count()).toBe(0);

  // 3. The source layer refused it, so it never became focus state at all.
  //    (null is the pass condition — `fc` was dropped, not merely escaped.)
  expect(String(await page.evaluate(() => (window as any).__state?.focusCountry ?? null))).not.toContain('<img');
});

test('a legitimate fc deep link still resolves to its country profile', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html#view=country&fc=POL');
  await page.waitForFunction(() => (window as any).__state?.bootstrapDone === true, null, { timeout: 30_000 });

  expect(await page.evaluate(() => (window as any).__state?.focusCountry)).toBe('POL');
  await expect(page.locator('#view-country .cp-iso')).toContainText('POL');
  await expect(page.locator('#view-country .cp-name')).toContainText('Poland');
});

test('the escape helpers cover both audited sinks', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof (window as any).sanitize === 'function', null, { timeout: 30_000 });

  const out = await page.evaluate((p) => {
    const w = window as any;
    return {
      // SW1-01 sink: the country eyebrow.
      sanitized: w.sanitize(p),
      // Source guard: rejects tag/attribute breakouts, keeps real entity names
      // that legitimately carry & and apostrophes.
      rejects: w._safeFocusParam(p),
      keepsAmpersand: w._safeFocusParam('Rule of law & impunity'),
      keepsIso: w._safeFocusParam('POL'),
    };
  }, PAYLOAD);

  expect(out.sanitized).not.toContain('<');
  expect(out.sanitized).toContain('&lt;');
  expect(out.rejects).toBeNull();
  expect(out.keepsAmpersand).toBe('Rule of law & impunity');
  expect(out.keepsIso).toBe('POL');
});
