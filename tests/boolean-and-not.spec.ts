import { test, expect } from '@playwright/test';

/**
 * Regression: `AND NOT` must not reach the API, because FTS5 cannot parse it.
 *
 * FTS5's NOT is a BINARY operator — `A NOT B` is "A but not B" — so
 * `A AND NOT B` is a syntax error and the backend answered it with
 * `sqlite3.OperationalError: fts5: syntax error near "NOT"` → HTTP 500.
 * Verified against the live API on 2026-09-15: `torture NOT military` → 200
 * (13,076 hits), `torture AND NOT military` → 500. Every UI surface
 * advertises "AND / OR / NOT", and `AND NOT` is how most people write
 * exclusion, so the query is rewritten to the equivalent `NOT` form on its
 * way out (and on the server, for direct API callers).
 */

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

async function stubApi(page: import('@playwright/test').Page, seen: string[]) {
  await page.route(/\/api\/data\//, (route) => { seen.push(route.request().url()); return route.fulfill(json({})); });
  await page.route(/\/api\/data\/facets/, (route) => route.fulfill(json({
    countries: ['Poland'], bodies: ['CCPR'], regions: [], sdgs_hierarchy: {}, min_year: 2006, max_year: 2026, total_records: 272_502,
  })));
  await page.route(/\/api\/data\/summary/, (route) => { seen.push(route.request().url()); return route.fulfill(json({ total_records: 42 })); });
  await page.route(/\/api\/data\/records/, (route) => { seen.push(route.request().url()); return route.fulfill(json({
    ok: true, page: 1, page_size: 30, total_records: 42, total_pages: 2,
    records: [{ AnnotationId: 'x-1', Text: 'Prohibit torture in all places of detention.', TextPlainCleaned: 'Prohibit torture in all places of detention.',
      Countries: ['Poland'], Themes: [], AffectedPersons: [], Sdgs: [], Body: 'CCPR', AnnotationType: 'Recommendations',
      PublicationDate: '2020-01-01', Symbol: 'CCPR/C/POL/CO/7' }],
  })); });
}

const queriesFor = (seen: string[]) => seen
  .map((u) => new URL(u).searchParams.get('text_query'))
  .filter((q): q is string => q !== null);

test('a search for "AND NOT" is sent as the FTS5-legal "NOT"', async ({ page }) => {
  const seen: string[] = [];
  await stubApi(page, seen);
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 10_000 });

  await page.locator('#mainSearchInput').fill('torture AND NOT military');
  await page.locator('#mainSearchInput').press('Enter');
  await expect.poll(() => queriesFor(seen).length, { timeout: 15_000 }).toBeGreaterThan(0);

  const sent = queriesFor(seen);
  expect(sent.every((q) => !/\bAND\s+NOT\b/.test(q)), `no request may carry "AND NOT": ${sent.join(' | ')}`).toBe(true);
  expect(sent).toContain('torture NOT military');
  // The box still shows what the user typed — only the wire form changes.
  await expect(page.locator('#mainSearchInput')).toHaveValue('torture AND NOT military');
});

test('the normaliser rewrites only the illegal pairing', async ({ page }) => {
  await stubApi(page, []);
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof (globalThis as any).normalizeBooleanQuery === 'function', null, { timeout: 10_000 });

  const cases = await page.evaluate(() => [
    'torture AND NOT military',
    'torture   AND   NOT   military',
    '(torture OR "cruel treatment") AND NOT military',
    'torture NOT military',
    'torture AND military',
    'women AND notification',          // "notification" is not the operator
    'torture and not military',        // lowercase = plain words, not operators
  ].map((q) => [q, (globalThis as any).normalizeBooleanQuery(q)]));

  expect(Object.fromEntries(cases)).toEqual({
    'torture AND NOT military': 'torture NOT military',
    'torture   AND   NOT   military': 'torture   NOT   military',   // spacing is preserved; FTS5 does not care
    '(torture OR "cruel treatment") AND NOT military': '(torture OR "cruel treatment") NOT military',
    'torture NOT military': 'torture NOT military',
    'torture AND military': 'torture AND military',
    'women AND notification': 'women AND notification',
    'torture and not military': 'torture and not military',
  });
});
