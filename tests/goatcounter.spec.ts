import { test, expect, type Page } from '@playwright/test';

/**
 * GoatCounter — what it counts, and what it must never see.
 *
 * analytics-goatcounter.js only runs on the production host, so these tests
 * serve the real pages under https://lszoszk.github.io/UnitedNations_recommendations/
 * (routed to the local server) and replace GoatCounter's count.js with a
 * recorder. That verifies the exact arguments the app passes to count() without
 * ever contacting the real counter.
 *
 * The invariant that matters most: the dashboard keeps queries, filters and the
 * record being read in the URL hash. None of that may reach a third party.
 */

const PROD = 'https://lszoszk.github.io/UnitedNations_recommendations/';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

const RECORDER = `
  window.goatcounter = window.goatcounter || {};
  window.goatcounter.count = function (v) { (window.__gc = window.__gc || []).push(JSON.parse(JSON.stringify(v))); };
`;

/** Serve the repo's own files as if from the production origin. */
async function asProduction(page: Page, opts: { countJs?: 'record' | 'block' } = {}) {
  const hosts: string[] = [];
  page.on('request', (r) => { const h = new URL(r.url()).hostname; if (/goatcounter|zgo\.at/.test(h)) hosts.push(r.url()); });
  await page.route(/googletagmanager\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/\/api\/data\//, (r) => r.fulfill(json({})));
  await page.route(/\/api\/data\/facets/, (r) => r.fulfill(json({
    countries: ['Poland'], bodies: ['CCPR'], regions: [], sdgs_hierarchy: {}, min_year: 2006, max_year: 2026, total_records: 10,
  })));
  await page.route(/\/api\/data\/summary/, (r) => r.fulfill(json({ total_records: 10 })));
  await page.route(/\/api\/data\/analytics/, (r) => r.fulfill(json({
    trends: { yearly_body_counts: [{ year: 2020, body: 'CCPR', count: 5 }] }, themes: { theme_counts: [] }, text: { affected_person_counts: [], sdg_counts: [] },
  })));
  await page.route('https://gc.zgo.at/count.js', (r) => opts.countJs === 'block'
    ? r.abort() : r.fulfill({ status: 200, contentType: 'application/javascript', body: RECORDER }));
  await page.route(`${PROD}**`, async (r) => {
    const rest = new URL(r.request().url()).pathname.replace('/UnitedNations_recommendations/', '');
    const res = await r.fetch({ url: `http://localhost:8787/${rest || 'index.html'}` });
    await r.fulfill({ response: res });
  });
  return hosts;
}

const calls = (page: Page) => page.evaluate(() => (window as any).__gc || []) as Promise<Array<{ path: string; title: string; referrer?: string }>>;

test('a local copy never contacts GoatCounter', async ({ page }) => {
  const hosts: string[] = [];
  page.on('request', (r) => { if (/goatcounter|zgo\.at/.test(new URL(r.url()).hostname)) hosts.push(r.url()); });
  await page.route(/\/api\/data\//, (r) => r.fulfill(json({})));
  await page.goto('/dashboard.html#view=search&q=secret');
  await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function');
  await page.evaluate(() => (globalThis as any).navigate('methodology'));
  expect(hosts, 'no request to GoatCounter off the production host').toEqual([]);
  expect(await page.evaluate(() => (window as any).goatcounter)).toBeUndefined();
  expect(await page.evaluate(() => typeof (window as any).uhriCount), 'still a callable no-op').toBe('function');
});

test('the landing page is counted once, as /landing', async ({ page }) => {
  await asProduction(page);
  await page.goto(`${PROD}index.html`);
  await expect.poll(async () => (await calls(page)).length, { timeout: 15_000 }).toBe(1);
  const [c] = await calls(page);
  expect(c.path).toBe('/landing');
  expect(c).not.toHaveProperty('referrer');          // the first view keeps the real referrer
});

test('the AI-connector guide is counted as /ai', async ({ page }) => {
  await asProduction(page);
  await page.goto(`${PROD}ai.html`);
  await expect.poll(async () => (await calls(page)).map((c) => c.path), { timeout: 15_000 }).toEqual(['/ai']);
});

test('the dashboard reports each tab once, by fixed path — never the entity, the query or the hash', async ({ page }) => {
  await asProduction(page);
  await page.goto(`${PROD}dashboard.html#view=search&q=secret-query-xyz&fc=POL`);
  await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function');
  await expect.poll(async () => (await calls(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);

  await page.evaluate(() => (globalThis as any).navigate('country'));
  await page.evaluate(() => (globalThis as any).navigate('country'));      // same view again: not a new pageview
  await page.evaluate(() => (globalThis as any).navigate('methodology'));

  const seen = await calls(page);
  expect(seen.map((c) => c.path)).toEqual(['/dashboard/search', '/dashboard/country', '/dashboard/methodology']);
  expect(seen[0]).not.toHaveProperty('referrer');
  expect(seen.slice(1).every((c) => c.referrer === ''), 'in-app hops are not referrals').toBe(true);

  const wire = JSON.stringify(seen);
  for (const leak of ['secret', 'POL', 'q=', 'fc=', '#']) expect(wire, `"${leak}" must never reach GoatCounter`).not.toContain(leak);
});

test('Do-Not-Track switches it off entirely', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' }));
  const hosts = await asProduction(page);
  await page.goto(`${PROD}index.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  expect(hosts, 'count.js must not even be requested').toEqual([]);
  expect(await calls(page)).toEqual([]);
});

test('a blocked counter (ad-blocker) leaves the dashboard working and silent', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await asProduction(page, { countJs: 'block' });
  await page.goto(`${PROD}dashboard.html#view=overview`);
  await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function');
  await page.evaluate(() => (globalThis as any).navigate('about'));
  await expect(page.locator('#view-about')).toBeVisible();
  expect(errors).toEqual([]);
});
