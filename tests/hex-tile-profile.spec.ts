import { test, expect } from '@playwright/test';

/**
 * Regression: a hex tile must open a profile the API can actually answer.
 *
 * renderCountry resolved the clicked tile with `ISO_TO_NAME[iso] || iso`.
 * ISO_TO_NAME is derived from NAME_TO_ISO, which lists 131 of the 196 tiles
 * in HEX_LAYOUT — so the other 65 fell through to the bare code: a profile
 * headed "EUU" / "MLT" / "PSE" that filtered on `countries=EUU` and rendered
 * 0 / 0 / 0 under "No data for this filter". Found by clicking the EU tile
 * on the live site; Luxembourg, Malta, Chad, the Caribbean and Pacific
 * states and the State of Palestine were all broken the same way.
 *
 * HEX_LAYOUT carries the API name for every tile, so isoToCountryName()
 * resolves from there — with one wrinkle: OHCHR decorates two facet values
 * with an observer-state asterisk ("State of Palestine*", "Kosovo*") that
 * HEX_LAYOUT stores without, and the un-starred spelling returns nothing.
 */

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const countryOf = (url: string) => new URL(url).searchParams.get('countries');

// Live counts, 2026-09-15. Poland is the control: it has an ISO_TO_NAME row.
const COUNTS: Record<string, number> = {
  'Poland': 4120, 'European Union': 233, 'Malta': 1081, 'State of Palestine*': 368,
};
const FACET_COUNTRIES = Object.keys(COUNTS);

async function stubApi(page: import('@playwright/test').Page, seen: string[]) {
  await page.route(/\/api\/data\//, (route) => { seen.push(route.request().url()); return route.fulfill(json({})); });
  // The bundled profile endpoint 404s on the live VM; keep the three-leg path.
  await page.route(/\/api\/data\/profile/, (route) => { seen.push(route.request().url()); return route.fulfill({ status: 404, contentType: 'application/json', headers: CORS, body: '{"detail":"Not Found"}' }); });
  await page.route(/\/api\/data\/map/, (route) => { seen.push(route.request().url()); return route.fulfill(json({
    country_counts: FACET_COUNTRIES.map((country) => ({ country, count: COUNTS[country] })),
  })); });
  await page.route(/\/api\/data\/summary/, (route) => { const u = route.request().url(); const c = countryOf(u);
    seen.push(u); return route.fulfill(json({ total_records: c ? (COUNTS[c] ?? 0) : 267942 })); });
  await page.route(/\/api\/data\/analytics/, (route) => { const u = route.request().url(); seen.push(u); return route.fulfill(json({
    trends: { yearly_body_counts: [{ year: 2020, body: 'CCPR', count: 5 }], dataset_first_publication_date: '2006-06-02T00:00:00', dataset_last_publication_date: '2026-05-20T00:00:00' },
    themes: { theme_counts: [{ theme: `${countryOf(u) || 'Baseline'} Theme`, count: 42 }] },
    text: { affected_person_counts: [], sdg_counts: [] },
  })); });
  await page.route(/\/api\/data\/facets/, (route) => { seen.push(route.request().url()); return route.fulfill(json({
    countries: FACET_COUNTRIES, bodies: ['CCPR'], regions: [], sdgs_hierarchy: {}, min_year: 2006, max_year: 2026, total_records: 267942,
  })); });
}

const TILES: Array<[iso: string, facetValue: string, why: string]> = [
  ['POL', 'Poland', 'control — the one path that already worked'],
  ['EUU', 'European Union', 'the regional-bloc tile the bug was reported on'],
  ['MLT', 'Malta', 'an ordinary state missing from NAME_TO_ISO'],
  ['PSE', 'State of Palestine*', 'the observer-state asterisk the API requires'],
];

for (const [iso, facetValue, why] of TILES) {
  test(`${iso} opens a profile filtered as "${facetValue}" (${why})`, async ({ page }) => {
    const seen: string[] = [];
    await stubApi(page, seen);
    await page.goto(`/dashboard.html#view=country&fc=${iso}`);

    await expect(page.locator('#view-country .cp-name')).toHaveText(facetValue, { timeout: 20_000 });
    await expect(page.locator('#view-country .cp-iso')).toContainText(iso);
    await expect(page.locator('#cpKpis')).toContainText(String(COUNTS[facetValue].toLocaleString('en-US')), { timeout: 20_000 });
    await expect(page.locator('#view-country')).toContainText(`${facetValue} Theme`);

    // The filter must carry the facet value the API knows, never the bare code.
    expect(seen.filter((u) => countryOf(u) === facetValue).length,
      `profile requests scoped to "${facetValue}"`).toBeGreaterThan(0);
    expect(seen.filter((u) => countryOf(u) === iso),
      'no request may filter on the bare code').toEqual([]);
  });
}

test('the country switcher carries facet values, never tile codes', async ({ page }) => {
  const seen: string[] = [];
  await stubApi(page, seen);
  await page.goto('/dashboard.html#view=country&fc=EUU');
  await expect(page.locator('#view-country .cp-name')).toHaveText('European Union', { timeout: 20_000 });

  // Option labels carry a count ("European Union · 233"); the value is the bare facet name.
  const values = await page.locator('#cpSelect option').evaluateAll(
    (els) => els.map((o) => (o as HTMLOptionElement).value));
  expect(values.sort()).toEqual([...FACET_COUNTRIES].sort());
});
