import { test, expect } from '@playwright/test';

/**
 * Regression: the Overview's export buttons must do something when clicked.
 *
 * Both the timeline's "⬇ SVG" and the row lists' "📋 CSV" buttons are wired
 * inside _wireTimelineModeToggle(). That function began with
 * `const modes = $('#tlModes'); if (!modes) return;` — and #tlModes had
 * left the markup. So the export wiring below the return never ran: the
 * buttons rendered, hovered, and did nothing on click — no download, no
 * clipboard write, no toast, no console error. Reported from the live site
 * on 2026-09-15 and reproduced there.
 */

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

const COUNTRIES: Array<[string, number]> = [
  ['China', 2540], ['Mexico', 2210], ['Colombia', 1980], ['Brazil', 1740], ['Poland', 1120], ['Malta', 1081],
];
// Six years × three families, so the timeline has real polygons to export.
const YEARLY = [2016, 2017, 2018, 2019, 2020, 2021].flatMap((year, i) => [
  { year, body: 'UPR', count: 40 + i * 7 }, { year, body: 'CCPR', count: 60 + i * 5 }, { year, body: 'SR Torture', count: 12 + i },
]);

async function stubApi(page: import('@playwright/test').Page) {
  await page.route(/\/api\/data\//, (route) => route.fulfill(json({})));
  await page.route(/\/api\/data\/facets/, (route) => route.fulfill(json({
    countries: COUNTRIES.map(([c]) => c), bodies: ['UPR', 'CCPR', 'SR Torture'], regions: [], sdgs_hierarchy: {},
    min_year: 2006, max_year: 2026, total_records: 10_671,
  })));
  await page.route(/\/api\/data\/summary/, (route) => route.fulfill(json({ total_records: 10_671 })));
  await page.route(/\/api\/data\/map/, (route) => route.fulfill(json({
    country_counts: COUNTRIES.map(([country, count]) => ({ country, count })),
  })));
  await page.route(/\/api\/data\/analytics/, (route) => route.fulfill(json({
    trends: { yearly_body_counts: YEARLY, dataset_first_publication_date: '2006-06-02T00:00:00', dataset_last_publication_date: '2026-05-20T00:00:00' },
    themes: { theme_counts: [{ theme: 'Liberty and security of person', count: 900 }, { theme: 'Right to health', count: 700 }] },
    text: { affected_person_counts: [{ affected_person: 'Children', count: 800 }], sdg_counts: [{ sdg: 'SDG 16', count: 600 }] },
  })));
}

async function openOverview(page: import('@playwright/test').Page) {
  await stubApi(page);
  await page.goto('/dashboard.html#view=overview');
  await expect(page.locator('#tlWrap svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#topCountries .rl-row')).toHaveCount(COUNTRIES.length, { timeout: 20_000 });
}

test('⬇ SVG on the timeline downloads the chart as an SVG file', async ({ page }) => {
  await openOverview(page);
  // Buttons fade in on panel hover; hover first, as a person would.
  await page.locator('#tlExport').hover();
  const download = page.waitForEvent('download', { timeout: 10_000 });
  await page.locator('#tlExport').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^uhri-timeline-.+\.svg$/);
  const body = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  expect(body).toContain('<svg');
  expect(body).toContain('xmlns="http://www.w3.org/2000/svg"');
  await expect(page.locator('#toast')).toContainText('exported as SVG');
});

test('📋 CSV on Top countries copies every row as rank,label,value', async ({ page }) => {
  await openOverview(page);
  // Capture instead of trusting the headless clipboard permission.
  await page.evaluate(() => {
    (globalThis as any).__csv = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => { (globalThis as any).__csv = t; return Promise.resolve(); } }, configurable: true });
  });
  const btn = page.locator('.chart-export[data-export="topCountries"]');
  await btn.hover();
  await btn.click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).__csv), { timeout: 5_000 }).not.toBeNull();
  const csv: string = await page.evaluate(() => (globalThis as any).__csv);
  const lines = csv.trim().split('\n');
  expect(lines[0]).toBe('rank,label,value');
  expect(lines).toHaveLength(COUNTRIES.length + 1);
  expect(lines[1]).toBe('1,"China",2540');
  await expect(page.locator('#toast')).toContainText(`Copied ${COUNTRIES.length} rows as CSV`);
});
