import { test, expect } from '@playwright/test';

/**
 * Regression: only fade a search result whose text is actually cut off.
 *
 * `.se-tx` clamps at ~7 lines and paints a gradient over its bottom 2em to
 * signal "there is more". The gradient was painted unconditionally, so a
 * one- or two-line recommendation had its LAST LINE washed out with nothing
 * hidden behind it — at 15px/1.7 the fade is taller than a line. Measured on
 * the live corpus, a 30-row sample for "torture" had 7 rows clipped and 23
 * not, so roughly three quarters of every result list looked half-erased.
 *
 * CSS cannot ask "did this overflow?", so dashboard-search.js marks the rows
 * that genuinely do and the gradient is gated on `.is-clipped`.
 */

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({
  status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body),
});

const SHORT = 'Take measures to guarantee full access to education for vulnerable persons.';
// Comfortably past the ~7-line clamp at any column width the test runs at.
const LONG = ('Investigate thoroughly all acts of vandalism and bring the perpetrators to '
  + 'justice, ensure that victims receive full reparation, and report back on the measures '
  + 'taken, including disaggregated statistics on prosecutions, convictions and sentences, '
  + 'as well as on the remedies afforded, ').repeat(6);

const REC = (id: string, text: string) => ({
  AnnotationId: id, Text: text, TextPlainCleaned: text,
  Countries: ['Poland'], Themes: [], AffectedPersons: [], Sdgs: [],
  Body: '- UPR', AnnotationType: '- Recommendations',
  PublicationDate: '2017-01-01', Symbol: 'A/HRC/36/14',
});

async function stubApi(page: import('@playwright/test').Page) {
  await page.route(/\/api\/data\//, (route) => route.fulfill(json({})));
  await page.route(/\/api\/data\/facets/, (route) =>
    route.fulfill(json({
      countries: ['Poland'], bodies: ['- UPR'], regions: [], types: ['- Recommendations'],
      sdgs_hierarchy: {}, min_year: 2006, max_year: 2026, total_records: 2,
    })));
  await page.route(/\/api\/data\/summary/, (route) => route.fulfill(json({ total_records: 2 })));
  await page.route(/\/api\/data\/records/, (route) =>
    route.fulfill(json({
      ok: true, page: 1, page_size: 30, total_records: 2, total_pages: 1,
      records: [REC('short-0001', SHORT), REC('long-0001', LONG)],
    })));
}

/** Per-row: is it marked clipped, does it really overflow, is the fade painted? */
const rows = async (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#seList .se-item')].map((el) => {
      const tx = el.querySelector('.se-tx') as HTMLElement;
      return {
        id: (el.querySelector('.se-tx')?.textContent || '').slice(0, 12),
        marked: el.classList.contains('is-clipped'),
        overflows: tx.scrollHeight > tx.clientHeight + 1,
        fadePainted: getComputedStyle(tx, '::after').content !== 'none',
      };
    }));

test('the fade appears only where the text is genuinely cut off', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html#view=search');
  await expect(page.locator('#seList .se-item')).toHaveCount(2, { timeout: 20_000 });

  const [short, long] = await rows(page);

  // The mark must track reality, not guesswork.
  expect(short.overflows, 'the short record must not overflow the clamp').toBe(false);
  expect(short.marked).toBe(false);
  expect(short.fadePainted, 'this is the defect: a fade over text that is all there').toBe(false);

  expect(long.overflows, 'the long record must overflow the clamp').toBe(true);
  expect(long.marked).toBe(true);
  expect(long.fadePainted, 'the affordance must survive where it is honest').toBe(true);
});

test('expanding a clipped row drops its fade, collapsing brings it back', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html#view=search');
  await expect(page.locator('#seList .se-item')).toHaveCount(2, { timeout: 20_000 });

  const longRow = page.locator('#seList .se-item').nth(1);
  await longRow.locator('.se-more-btn').click();
  await expect(longRow).toHaveClass(/expanded/);
  // max-height animates over .25s, so poll rather than measure mid-flight.
  await expect.poll(async () => (await rows(page))[1].fadePainted,
    { message: 'nothing is hidden once expanded' }).toBe(false);

  await longRow.locator('.se-more-btn').click();
  await expect(longRow).not.toHaveClass(/expanded/);
  await expect.poll(async () => (await rows(page))[1].fadePainted,
    { message: 'collapsing must bring the affordance back' }).toBe(true);
});

test('Expand all / Collapse all keep the marks in step', async ({ page }) => {
  await stubApi(page);
  await page.goto('/dashboard.html#view=search');
  await expect(page.locator('#seList .se-item')).toHaveCount(2, { timeout: 20_000 });

  await page.locator('#seExpandAll').click();
  await expect.poll(async () => (await rows(page)).some((r) => r.fadePainted),
    { message: 'no fade while everything is open' }).toBe(false);

  await page.locator('#seCollapseAll').click();
  await expect.poll(async () => (await rows(page))[1].fadePainted,
    { message: 'the long row gets its affordance back' }).toBe(true);
  expect((await rows(page))[0].fadePainted,
    'the short row stays clean after a bulk collapse').toBe(false);
});
