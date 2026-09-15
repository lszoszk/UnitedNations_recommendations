import { test, expect, type Page, type Download } from '@playwright/test';

/**
 * Figure exports — every chart and row list must export itself, in every view.
 *
 * History: the Overview's ⬇ SVG and 📋 CSV buttons were wired per-button
 * inside _wireTimelineModeToggle(), behind `if (!$('#tlModes')) return;` —
 * and #tlModes had left the markup. Both buttons sat dead for months
 * (reported 2026-09-15). The wiring is now one delegated document listener,
 * profiles and compare got the same buttons, and the SVG became a document
 * — title, scope, x-axis years, legend, source footer — instead of a bare
 * clone of the shapes that was unreadable on its own.
 */

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
const countryOf = (url: string) => new URL(url).searchParams.get('countries');

const COUNTRIES: Array<[string, number]> = [
  ['China', 2540], ['Mexico', 2210], ['Colombia', 1980], ['Brazil', 1740], ['Poland', 1120], ['Malta', 1081],
];
const THEMES = [
  { theme: 'Liberty and security of person', count: 900 }, { theme: 'Right to health', count: 700 }, { theme: 'Administration of justice', count: 450 },
];
// Six years × three families, so the timeline has real polygons and a legend.
const YEARLY = [2016, 2017, 2018, 2019, 2020, 2021].flatMap((year, i) => [
  { year, body: 'UPR', count: 40 + i * 7 }, { year, body: 'CCPR', count: 60 + i * 5 }, { year, body: 'SR Torture', count: 12 + i },
]);

async function stubApi(page: Page) {
  await page.route(/\/api\/data\//, (route) => route.fulfill(json({})));
  // The bundled profile endpoint 404s on the live VM; keep the three-leg path.
  await page.route(/\/api\/data\/profile/, (route) => route.fulfill({ status: 404, contentType: 'application/json', headers: CORS, body: '{"detail":"Not Found"}' }));
  await page.route(/\/api\/data\/facets/, (route) => route.fulfill(json({
    countries: COUNTRIES.map(([c]) => c), bodies: ['UPR', 'CCPR', 'SR Torture'], regions: [], sdgs_hierarchy: {},
    min_year: 2006, max_year: 2026, total_records: 10_671,
  })));
  await page.route(/\/api\/data\/summary/, (route) => { const c = countryOf(route.request().url());
    return route.fulfill(json({ total_records: c ? (Object.fromEntries(COUNTRIES)[c] ?? 0) : 10_671 })); });
  await page.route(/\/api\/data\/map/, (route) => route.fulfill(json({
    country_counts: COUNTRIES.map(([country, count]) => ({ country, count })),
  })));
  await page.route(/\/api\/data\/analytics/, (route) => route.fulfill(json({
    trends: { yearly_body_counts: YEARLY, dataset_first_publication_date: '2006-06-02T00:00:00', dataset_last_publication_date: '2026-05-20T00:00:00' },
    themes: { theme_counts: THEMES },
    text: { affected_person_counts: [{ affected_person: 'Children', count: 800 }], sdg_counts: [{ sdg: 'SDG 16', count: 600 }] },
  })));
}

const readDownload = async (d: Download) => (await d.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));

/** Route the clipboard into a variable instead of trusting headless permissions. */
async function captureClipboard(page: Page) {
  await page.evaluate(() => {
    (globalThis as any).__csv = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => { (globalThis as any).__csv = t; return Promise.resolve(); } }, configurable: true });
  });
  return async () => {
    await expect.poll(() => page.evaluate(() => (globalThis as any).__csv), { timeout: 5_000 }).not.toBeNull();
    return page.evaluate(() => (globalThis as any).__csv as string);
  };
}

/** Click an export button the way a person does (they fade in on panel hover) and catch the file. */
async function clickForDownload(page: Page, selector: string) {
  const btn = page.locator(selector);
  await btn.hover();
  const download = page.waitForEvent('download', { timeout: 10_000 });
  await btn.click();
  return download;
}

test.describe('Overview', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
    await page.goto('/dashboard.html#view=overview');
    await expect(page.locator('#tlWrap svg')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#topCountries .rl-row')).toHaveCount(COUNTRIES.length, { timeout: 20_000 });
  });

  test('⬇ SVG on the timeline downloads a self-contained chart: title, years, legend, source', async ({ page }) => {
    const file = await clickForDownload(page, '#tlExport');
    expect(file.suggestedFilename()).toMatch(/^uhri-volume-over-time-.+\.svg$/);
    await file.saveAs(`test-results/exports/overview-${test.info().project.name}.svg`);
    const body = await readDownload(file);
    expect(body).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(body).toContain('Volume over time');                  // title
    expect(body).toContain('All recommendations');                // scope line
    for (const y of ['2016', '2021']) expect(body).toContain(`>${y}</text>`);   // x-axis years
    for (const l of ['UPR', 'Treaty Bodies', 'Special Procedures']) expect(body).toContain(`>${l}</text>`); // legend
    expect(body).toContain('Source: OHCHR Universal Human Rights Index');
    expect(body).toContain('lszoszk.github.io/UnitedNations_recommendations');
    expect(body, 'every CSS variable must be resolved to a literal colour').not.toMatch(/var\(--|color-mix\(/);
    await expect(page.locator('#toast')).toContainText('as SVG');
  });

  test('📋 CSV on Top countries copies every row as rank,label,value', async ({ page }) => {
    const read = await captureClipboard(page);
    const btn = page.locator('.chart-export[data-export="topCountries"]');
    await btn.hover(); await btn.click();
    const lines = (await read()).trim().split('\n');
    expect(lines[0]).toBe('rank,label,value');
    expect(lines).toHaveLength(COUNTRIES.length + 1);
    expect(lines[1]).toBe('1,"China",2540');
    await expect(page.locator('#toast')).toContainText(`Copied ${COUNTRIES.length} rows as CSV`);
  });
});

test.describe('Country profile', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
    await page.goto('/dashboard.html#view=country&fc=POL');
    await expect(page.locator('#view-country .cp-name')).toHaveText('Poland', { timeout: 20_000 });
    await expect(page.locator('#cpTime svg')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#cpThemes .rl-row')).toHaveCount(THEMES.length, { timeout: 20_000 });
  });

  test('⬇ SVG on FIG.A names the country in the file and the scope line', async ({ page }) => {
    const file = await clickForDownload(page, '.chart-export[data-export-svg="cpTime"]');
    expect(file.suggestedFilename()).toMatch(/^uhri-volume-by-year-poland-.+\.svg$/);
    await file.saveAs(`test-results/exports/country-${test.info().project.name}.svg`);
    const body = await readDownload(file);
    expect(body).toContain('Volume by year');
    expect(body).toContain('>Poland</text>');
    expect(body).toContain('Source: OHCHR Universal Human Rights Index');
  });

  test('📋 CSV on FIG.B Themes copies the profile\'s theme list', async ({ page }) => {
    const read = await captureClipboard(page);
    const btn = page.locator('.chart-export[data-export="cpThemes"]');
    await btn.hover(); await btn.click();
    const lines = (await read()).trim().split('\n');
    expect(lines[0]).toBe('rank,label,value');
    expect(lines[1]).toBe('1,"Liberty and security of person",900');
    expect(lines).toHaveLength(THEMES.length + 1);
  });
});

test('Search: ⬇ Export .xlsx downloads the whole result set for the current query', async ({ page }) => {
  await stubApi(page);
  const exportUrls: string[] = [];
  await page.route(/\/api\/data\/export/, (route) => {
    exportUrls.push(route.request().url());
    return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Disposition': 'attachment; filename="uhri-export.xlsx"' },
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: 'PK' });
  });
  await page.goto('/dashboard.html#view=search&q=china');
  await expect(page.locator('#view-search .se-head .q')).toHaveText('"china"', { timeout: 20_000 });

  // Assert on the request, not the download event: the export is a
  // cross-origin <a download> that the server turns into an attachment, and
  // WebKit does not surface that as a download event under automation. The
  // contract we own is the URL the button asks for.
  const hit = page.waitForRequest(/\/api\/data\/export/, { timeout: 10_000 });
  await page.locator('#seExport').click();
  await hit;
  expect(exportUrls).toHaveLength(1);
  const p = new URL(exportUrls[0]).searchParams;
  expect(p.get('format')).toBe('xlsx');
  expect(p.get('text_query')).toBe('china');
});
