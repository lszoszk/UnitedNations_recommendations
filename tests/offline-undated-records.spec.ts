import { test, expect } from '@playwright/test';

/**
 * Regression: a record with no publication date must not become "year 0".
 *
 * Static audit H-04. Four sites computed the year as
 * `Number((r.PublicationDate || '').slice(0, 4))` and then guarded with
 * `Number.isFinite(y)` — but **Number('') is 0, not NaN**, so the guard let
 * undated records through as year zero. In Instant Mode that put a phantom
 * column at the left edge of the timeline and dragged the facet year range
 * down to 0–2026, which in turn seeds the year slider.
 *
 * The two year-FILTER sites (offline._matches and the Labels rule matcher)
 * excluded undated records already — but only by accident, because 0 is less
 * than any yearA. Switching to a real NaN would have silently reversed that
 * (NaN < 2010 and NaN > 2020 are both false, so they would have started
 * passing every range), which is why the fix rejects them explicitly.
 */

declare const offline: any;
declare function emptyFilters(): any;
declare function parseRecordYear(rec: any): number;

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({
  status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body),
});

async function stubApi(page: import('@playwright/test').Page) {
  await page.route(/\/api\/data\//, (route) => route.fulfill(json({})));
  await page.route(/\/api\/data\/facets/, (route) =>
    route.fulfill(json({ countries: ['Poland'], bodies: ['- CCPR'], regions: [], types: [], sdgs_hierarchy: {}, min_year: 2010, max_year: 2025, total_records: 0 })));
}

const REC = (date: string | null) => ({
  Countries: ['Poland'], Body: '- CCPR', AnnotationType: '- Recommendations',
  Themes: [], AffectedPersons: [], Sdgs: [],
  PublicationDate: date, Text: 'stub', TextPlainCleaned: 'stub',
});

test('the year parser rejects every shape of missing date', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof parseRecordYear === 'function', null, { timeout: 30_000 });

  const out = await page.evaluate(() => ({
    dated: parseRecordYear({ PublicationDate: '2020-05-01T00:00:00' }),
    empty: Number.isNaN(parseRecordYear({ PublicationDate: '' })),
    missing: Number.isNaN(parseRecordYear({})),
    nulled: Number.isNaN(parseRecordYear({ PublicationDate: null })),
    junk: Number.isNaN(parseRecordYear({ PublicationDate: 'n/a' })),
    // The exact trap: the old expression returned 0 here and 0 is finite.
    oldExpressionWouldGive: Number(('' as string).slice(0, 4)),
  }));

  expect(out.dated).toBe(2020);
  expect(out.empty, 'empty string must be NaN, not 0').toBe(true);
  expect(out.missing).toBe(true);
  expect(out.nulled).toBe(true);
  expect(out.junk).toBe(true);
  expect(out.oldExpressionWouldGive, 'documents why the guard failed').toBe(0);
});

test('undated records stay out of the timeline and the year range', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof offline !== 'undefined' && typeof offline.analytics === 'function', null, { timeout: 30_000 });

  const out = await page.evaluate((rows) => {
    offline.data = rows;
    const a = offline.analytics({ ...emptyFilters() });
    const f = offline.facets();
    return {
      years: a.trends.yearly_counts.map((r: any) => r.year),
      bodyYears: a.trends.yearly_body_counts.map((r: any) => r.year),
      minYear: f.min_year,
      maxYear: f.max_year,
      // The undated record still exists — it is only absent from year maths.
      totalRows: a.text.total_records,
    };
  }, [REC('2018-01-01T00:00:00'), REC('2022-01-01T00:00:00'), REC(null), REC('')]);

  expect(out.years, 'year 0 must not appear').not.toContain(0);
  expect(out.years).toEqual([2018, 2022]);
  expect(out.bodyYears).not.toContain(0);
  expect(out.minYear, 'an undated record must not drag the range to 0').toBe(2018);
  expect(out.maxYear).toBe(2022);
  expect(out.totalRows, 'the undated records are still in the corpus').toBe(4);
});

test('a year filter still excludes undated records, deliberately', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof offline !== 'undefined' && typeof offline.filter === 'function', null, { timeout: 30_000 });

  const out = await page.evaluate((rows) => {
    offline.data = rows;
    const all = offline.filter({ ...emptyFilters() }).length;
    const ranged = offline.filter({ ...emptyFilters(), yearA: 2010, yearB: 2025 }).length;
    const openEnded = offline.filter({ ...emptyFilters(), yearA: 2010 }).length;
    return { all, ranged, openEnded };
  }, [REC('2018-01-01T00:00:00'), REC('2022-01-01T00:00:00'), REC(null), REC('')]);

  expect(out.all, 'with no year filter everything is in scope').toBe(4);
  expect(out.ranged, 'undated records cannot sit inside a range').toBe(2);
  expect(out.openEnded, 'nor inside a half-open one').toBe(2);
});
