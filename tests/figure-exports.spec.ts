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
  // No web fonts in tests: the PNG path tries to embed them and must cope without.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
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
const readBytes = async (d: Download) => (await d.createReadStream()).toArray().then((c) => Buffer.concat(c));
const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });   // IHDR

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

  test('⬇ PNG on the timeline rasterises the same document at 2×', async ({ page }) => {
    const file = await clickForDownload(page, '#tlExportPng');
    expect(file.suggestedFilename()).toMatch(/^uhri-volume-over-time-.+\.png$/);
    const bytes = await readBytes(file);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(pngSize(bytes).w).toBe(2400);
    expect(bytes.length).toBeGreaterThan(20_000);
    await expect(page.locator('#toast')).toContainText('as PNG');
  });

  test('⬇ SVG on the map is a document too: title, colour ramp with its bounds, source', async ({ page }) => {
    await expect(page.locator('#mapWrap svg')).toBeVisible({ timeout: 20_000 });
    const file = await clickForDownload(page, '#mapExport');
    expect(file.suggestedFilename()).toMatch(/^uhri-where-the-recommendations-land-all-recommendations-(hex|choropleth)-.+\.svg$/);
    const body = await readDownload(file);
    expect(body).toContain('Where the recommendations land');
    expect(body).toContain('>0</text>');
    expect(body).toContain('>2,540</text>');                       // ramp upper bound = top country
    expect(body).toContain('recommendations per state');
    expect(body).toContain('Source: OHCHR Universal Human Rights Index');
    expect(body, 'hex fills must be literal colours').not.toMatch(/var\(--|color-mix\(/);
    await file.saveAs(`test-results/exports/map-${test.info().project.name}.svg`);
  });

  test('⬇ PNG on the map downloads a PNG', async ({ page }) => {
    await expect(page.locator('#mapWrap svg')).toBeVisible({ timeout: 20_000 });
    const file = await clickForDownload(page, '#mapExportPng');
    expect(file.suggestedFilename()).toMatch(/\.png$/);
    const bytes = await readBytes(file);
    expect(pngSize(bytes).w).toBe(2400);
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

  test('every ⬇ SVG on the profile has a ⬇ PNG twin', async ({ page }) => {
    const svgs = await page.locator('#view-country button[data-export-svg]').count();
    const pngs = await page.locator('#view-country button[data-export-png]').count();
    expect(svgs).toBe(1);
    expect(pngs).toBe(svgs);
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

test('Search: ⬇ Export .xlsx builds a real workbook from the whole result set', async ({ page }) => {
  await stubApi(page);
  // SheetJS ships from a CDN under an SRI pin, so a routed stub would be
  // rejected by the browser. Define window.XLSX before the page runs
  // instead — ensureXLSX() returns it and never touches the network — and
  // record what reached the workbook.
  await page.addInitScript(() => {
    (window as any).XLSX = {
      utils: {
        json_to_sheet: (rows: unknown[]) => ({ rows }),
        book_new: () => ({ sheets: [] as any[] }),
        book_append_sheet: (wb: any, ws: any, name: string) => { wb.sheets.push({ name, ws }); },
      },
      writeFile: (wb: any, filename: string) => {
        (window as any).__wb = { filename, name: wb.sheets[0].name, rows: wb.sheets[0].ws.rows };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['PK-stub'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      },
    };
  });
  const exportUrls: string[] = [];
  await page.route(/\/api\/data\/export/, (route) => {
    exportUrls.push(route.request().url());
    return route.fulfill(json({
      ok: true, total_records: 2, analysis_limit: 50_000,
      records: [
        { AnnotationId: 'a-1', Symbol: 'CCPR/C/POL/CO/7', PublicationDate: '2020-01-01', Body: '- CCPR',
          AnnotationType: '- Recommendations', Countries: ['Poland'], Regions: [], Themes: ['Torture'],
          AffectedPersons: [], Sdgs: [], TextPlainCleaned: 'Prohibit torture in all places of detention.' },
        { AnnotationId: 'a-2', Symbol: 'CAT/C/POL/CO/7', PublicationDate: '2019-08-29', Body: '- CAT',
          AnnotationType: '- Concerns/Observations', Countries: ['Poland'], Regions: [], Themes: [],
          AffectedPersons: [], Sdgs: [], TextPlainCleaned: 'The Committee is concerned about overcrowding.' },
      ],
    }));
  });
  await page.goto('/dashboard.html#view=search&q=china');
  await expect(page.locator('#view-search .se-head .q')).toHaveText('"china"', { timeout: 20_000 });

  const download = page.waitForEvent('download', { timeout: 15_000 });
  await page.locator('#seExport').click();
  const file = await download;

  // The request: the current query, and the API's own row cap — never a
  // `format` parameter, which this endpoint has never had.
  expect(exportUrls).toHaveLength(1);
  const params = new URL(exportUrls[0]).searchParams;
  expect(params.get('text_query')).toBe('china');
  expect(params.get('limit')).toBe('50000');
  expect(params.get('format'), 'the endpoint has no format parameter').toBeNull();

  // The file: built here, named .xlsx, carrying the rows the API returned.
  expect(file.suggestedFilename()).toMatch(/^uhri-export-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = await page.evaluate(() => (window as any).__wb);
  expect(wb.name).toBe('Records');
  expect(wb.rows).toHaveLength(2);
  expect(wb.rows[0]).toMatchObject({ Symbol: 'CCPR/C/POL/CO/7', Countries: 'Poland', Body: 'CCPR' });
  await expect(page.locator('#toast')).toContainText('Exported 2 records (XLSX)');
});

test('Rail export: CSV is built in the browser, not requested from the server', async ({ page }) => {
  await stubApi(page);
  await page.route(/\/api\/data\/export/, (route) => route.fulfill(json({
    ok: true, total_records: 1, records: [
      { AnnotationId: 'c-1', Symbol: 'CRC/C/POL/CO/6', PublicationDate: '2021-03-02', Body: '- CRC',
        AnnotationType: '- Recommendations', Countries: ['Poland'], Regions: [], Themes: ['Children, "rights of"'],
        AffectedPersons: [], Sdgs: [], TextPlainCleaned: 'Raise the minimum age, and report back.' },
    ],
  })));
  await page.goto('/dashboard.html#view=overview');
  await page.waitForFunction(() => typeof (globalThis as any).doExport === 'function', null, { timeout: 20_000 });

  const download = page.waitForEvent('download', { timeout: 15_000 });
  await page.evaluate(() => (globalThis as any).doExport('csv'));
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^uhri-export-\d{4}-\d{2}-\d{2}\.csv$/);

  const csv = await readDownload(file);
  const [header, row] = csv.split('\n');
  expect(header.split(',')).toContain('Symbol');
  expect(row).toContain('CRC/C/POL/CO/6');
  expect(row, 'a comma inside a theme must stay quoted').toContain('"Children, ""rights of"""');
});

/**
 * Exports larger than the API's single-request ceiling.
 *
 * `/api/data/export` caps at 50,000 rows and does NOT truncate above it —
 * it answers 400 with "The current filter matches 77,412 records. Narrow
 * the selection to 50,000 records or fewer…". The client used to swallow
 * that and say "the server answered HTTP 400", so a 77k-record search
 * (reported 2026-09-21) simply could not be exported. Now the file is
 * assembled from the paged records endpoint, and any error the server
 * does send is shown in the server's own words.
 */
const REC_AT = (i: number) => ({
  AnnotationId: `p-${i}`, Symbol: `CCPR/C/POL/CO/${i}`, PublicationDate: '2020-01-01', Body: '- CCPR',
  AnnotationType: '- Recommendations', Countries: ['Poland'], Regions: [], Themes: [], AffectedPersons: [],
  Sdgs: [], TextPlainCleaned: `Recommendation number ${i}.`,
});

test.describe('export above the API ceiling', () => {
  const TOTAL = 2_300;          // > the stubbed ceiling, so paging must kick in
  const CEILING = 1_000;

  async function stubBigCorpus(page: Page, seen: { export: number; pages: number[] }) {
    await stubApi(page);
    await page.route(/\/api\/data\/export/, (route) => {
      seen.export += 1;
      return route.fulfill({
        status: 400, contentType: 'application/json', headers: CORS,
        body: JSON.stringify({ detail: `The current filter matches ${TOTAL.toLocaleString('en-US')} records. Narrow the selection to ${CEILING.toLocaleString('en-US')} records or fewer for in-browser analytics.` }),
      });
    });
    await page.route(/\/api\/data\/records\?/, (route) => {
      const q = new URL(route.request().url()).searchParams;
      const size = Number(q.get('page_size') || 30);
      const pageNo = Number(q.get('page') || 1);
      if (size < 500) return route.fulfill(json({ ok: true, page: pageNo, page_size: size, total_records: TOTAL, total_pages: Math.ceil(TOTAL / size), records: [REC_AT(1)] }));
      seen.pages.push(pageNo);
      const first = (pageNo - 1) * size;
      const n = Math.max(0, Math.min(size, TOTAL - first));
      // The live endpoint clamps an out-of-range page to the last one; mimic
      // that, so the test would catch a loop that trusts "empty page = done".
      const rows = n > 0 ? Array.from({ length: n }, (_, k) => REC_AT(first + k + 1)) : [REC_AT(TOTAL)];
      return route.fulfill(json({ ok: true, page: pageNo, page_size: size, total_records: TOTAL, total_pages: Math.ceil(TOTAL / size), records: rows }));
    });
  }

  test('a filter over the ceiling is exported by paging, in order and without duplicates', async ({ page }) => {
    const seen = { export: 0, pages: [] as number[] };
    await stubBigCorpus(page, seen);
    await page.goto('/dashboard.html#view=overview');
    await page.waitForFunction(() => typeof (globalThis as any).doExport === 'function', null, { timeout: 20_000 });

    const download = page.waitForEvent('download', { timeout: 30_000 });
    await page.evaluate(() => (globalThis as any).doExport('csv'));
    const csv = await readDownload(await download);

    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(TOTAL + 1);                    // header + every row, no clamped duplicates
    expect(lines[1]).toContain('CCPR/C/POL/CO/1');            // server order preserved
    expect(lines[TOTAL]).toContain(`CCPR/C/POL/CO/${TOTAL}`);
    expect(seen.export, 'the one-shot endpoint is still tried first').toBe(1);
    expect(seen.pages.sort((a, b) => a - b)).toEqual(Array.from({ length: Math.ceil(TOTAL / 1000) }, (_, i) => i + 1));
    await expect(page.locator('#toast')).toContainText(`Exported ${TOTAL.toLocaleString('en-US')} records (CSV)`);
  });

  test('an error the paging cannot fix is reported in the server\'s own words', async ({ page }) => {
    await stubApi(page);
    await page.route(/\/api\/data\/export/, (route) => route.fulfill({
      status: 503, contentType: 'application/json', headers: CORS,
      body: JSON.stringify({ detail: 'Dataset is rebuilding — try again in a minute.' }),
    }));
    await page.goto('/dashboard.html#view=overview');
    await page.waitForFunction(() => typeof (globalThis as any).doExport === 'function', null, { timeout: 20_000 });
    await page.evaluate(() => (globalThis as any).doExport('csv'));
    await expect(page.locator('#toast')).toContainText('Dataset is rebuilding — try again in a minute.');
    await expect(page.locator('#toast')).toHaveClass(/error/);
  });
});

test('a page that fails once is retried, not fatal', async ({ page }) => {
  const TOTAL = 2_300;
  let failedOnce = false;
  await stubApi(page);
  await page.route(/\/api\/data\/export/, (route) => route.fulfill({
    status: 400, contentType: 'application/json', headers: CORS,
    body: JSON.stringify({ detail: `The current filter matches ${TOTAL.toLocaleString('en-US')} records. Narrow the selection to 1,000 records or fewer for in-browser analytics.` }),
  }));
  await page.route(/\/api\/data\/records\?/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    const size = Number(q.get('page_size') || 30);
    const pageNo = Number(q.get('page') || 1);
    if (size < 500) return route.fulfill(json({ ok: true, total_records: TOTAL, total_pages: 1, records: [REC_AT(1)] }));
    if (pageNo === 2 && !failedOnce) { failedOnce = true; return route.fulfill({ status: 429, contentType: 'application/json', headers: CORS, body: '{"detail":"slow down"}' }); }
    const first = (pageNo - 1) * size;
    const n = Math.max(0, Math.min(size, TOTAL - first));
    return route.fulfill(json({ ok: true, page: pageNo, page_size: size, total_records: TOTAL, total_pages: Math.ceil(TOTAL / size), records: Array.from({ length: n }, (_, k) => REC_AT(first + k + 1)) }));
  });
  await page.goto('/dashboard.html#view=overview');
  await page.waitForFunction(() => typeof (globalThis as any).doExport === 'function', null, { timeout: 20_000 });

  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.evaluate(() => (globalThis as any).doExport('csv'));
  const csv = await readDownload(await download);
  expect(failedOnce, 'the 429 must actually have been served').toBe(true);
  expect(csv.trim().split('\n')).toHaveLength(TOTAL + 1);
});
