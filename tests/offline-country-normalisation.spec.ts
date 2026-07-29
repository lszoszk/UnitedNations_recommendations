import { test, expect } from '@playwright/test';

/**
 * Regression: Instant Mode must not lose whole countries to label decoration.
 *
 * Static audit 2026-07-28, H-02 (class C9). `offline._matches` normalised the
 * RECORD side of the country test with cleanCountryName() but compared it
 * against the raw facet label, so the two sides never met for any label the
 * cleaner rewrites. Two of those are selectable straight from the rail —
 * "State of Palestine*" and "Kosovo*", whose OHCHR observer asterisk is
 * stripped off the record — and picking either returned zero records with no
 * error. The corpus simply looked empty for those two states, which is a bad
 * failure mode in a human-rights tool for reasons beyond the bug itself.
 *
 * The 2-letter fold ("PK" → "Pakistan") reaches the same wall. It is not
 * clickable in the rail (cleanCountryList hides bare codes) but a shared
 * `#country=PK` link restores it into the same filter.
 *
 * Server mode was never affected: buildParams sends the label to the API,
 * which matches its own raw vocabulary. This is Instant Mode only.
 */

/* `offline` is a top-level `const` in a classic script: it lives in the
   global lexical environment, which — unlike `var` and function
   declarations — never becomes a property of `window`. So these must be
   reached by bare name inside evaluate(), not through `window.*`. */
declare const offline: any;
declare function emptyFilters(): any;

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  headers: CORS,
  body: JSON.stringify(body),
});

async function stubApi(page: import('@playwright/test').Page) {
  await page.route(/\/api\/data\//, (route) => route.fulfill(json({})));
  await page.route(/\/api\/data\/map/, (route) => route.fulfill(json({ country_counts: [] })));
  await page.route(/\/api\/data\/summary/, (route) => route.fulfill(json({ total_records: 0 })));
  await page.route(/\/api\/data\/facets/, (route) =>
    route.fulfill(json({
      // The real vocabulary carries both decorations this test is about.
      countries: ['Poland', 'State of Palestine*', 'Kosovo*', 'PK'],
      bodies: ['- CCPR'], regions: [], types: ['- Recommendations'],
      sdgs_hierarchy: {}, min_year: 2010, max_year: 2025, total_records: 4,
    })),
  );
}

const REC = (country: string) => ({
  Countries: [country], Body: '- CCPR', AnnotationType: '- Recommendations',
  Themes: [], AffectedPersons: [], Sdgs: [], PublicationDate: '2020-01-01',
  Text: 'stub', TextPlainCleaned: 'stub',
});

test('a decorated country label still matches its own records in Instant Mode', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof offline !== 'undefined' && typeof offline.filter === 'function', null, { timeout: 30_000 });

  const counts = await page.evaluate((rows) => {
    // Records as they arrive in an export: decorations intact.
    offline.data = rows;
    const pick = (c: string) => offline.filter({ ...emptyFilters(), country: new Set([c]) }).length;
    return {
      palestine: pick('State of Palestine*'),
      kosovo: pick('Kosovo*'),
      twoLetter: pick('PK'),
      // The fold means the canonical name reaches the "PK" record too.
      pakistanCanonical: pick('Pakistan'),
      control: pick('Poland'),
      unrelated: pick('Germany'),
    };
  }, [REC('State of Palestine*'), REC('Kosovo*'), REC('PK'), REC('Poland')]);

  expect(counts.palestine).toBe(1);
  expect(counts.kosovo).toBe(1);
  expect(counts.twoLetter).toBe(1);
  expect(counts.pakistanCanonical).toBe(1);
  expect(counts.control).toBe(1);
  // Normalisation must not turn the filter into a pass-through.
  expect(counts.unrelated).toBe(0);
});

test('normalisation does not mutate the caller\'s filter object', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof offline !== 'undefined' && typeof offline.filter === 'function', null, { timeout: 30_000 });

  const still = await page.evaluate((rows) => {
    offline.data = rows;
    const f = { ...emptyFilters(), country: new Set(['State of Palestine*']) };
    offline.filter(f);
    // The rail round-trips this Set back into the URL and the facet UI, so a
    // stripped asterisk here would desync the chip from what the user picked.
    return [...f.country];
  }, [REC('State of Palestine*')]);

  expect(still).toEqual(['State of Palestine*']);
});
