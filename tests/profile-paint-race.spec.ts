import { test, expect } from '@playwright/test';

/**
 * Regression: a superseded profile load must never paint.
 *
 * Static audit 2026-07-28, findings B-01 + J1-01 — two halves of one race:
 *
 *   B-01 (receiving end) — the five profile renderers await their data and
 *   then paint by re-querying ids (#cpKpis, #cpTime, …) that belong to
 *   whatever profile is on screen WHEN THE RESPONSE LANDS. Open Poland,
 *   switch to Germany before Poland settles, and Poland's KPIs, timeline and
 *   ranked lists overwrite Germany's panels. The <h1>, the tab label and the
 *   URL still say Germany, so the reader attributes Poland's numbers to
 *   Germany with nothing to warn them.
 *
 *   J1-01 (sending end) — apiGet's in-flight de-duplication branch returned
 *   the pending promise without aborting the same-scope request it replaced,
 *   so the superseded load stayed alive to do exactly that repaint.
 *
 * Fix: `_profileRenderGen` guards every awaited paint (dashboard-profiles.js)
 * and the de-dup branch now claims its scope (dashboard-data.js). See
 * ARCHITECTURE.md § "Awaited paints — the generation-token rule".
 *
 * The third test covers Compare, which has the same unguarded shape but not
 * the same severity: its stale write is overwritten a tick later by the newer
 * render, so it flashes rather than persists. It is asserted at the level it
 * actually fails — no write at all from a superseded render — rather than on
 * a final value that would pass either way.
 */

const POLAND_DELAY_MS = 2500;   // Poland is the slow, superseded load
const POLAND_TOTAL = 111111;
const GERMANY_TOTAL = 222222;
const FRANCE_TOTAL = 333333;

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  headers: { 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

const analyticsFor = (country: string) => ({
  trends: {
    yearly_body_counts: [{ year: 2020, body: 'CCPR', count: 5 }],
    dataset_first_publication_date: '2010-01-01T00:00:00',
    dataset_last_publication_date: '2025-01-01T00:00:00',
  },
  themes: { theme_counts: [{ theme: `${country} Theme`, count: 42 }] },
  text: {
    affected_person_counts: [{ affected_person: `${country} Group`, count: 7 }],
    sdg_counts: [{ sdg: '16.3', count: 3 }],
  },
});

/** Which country a request is scoped to, read off `countries=` in the query. */
function countryOf(url: string): string | null {
  const v = new URL(url).searchParams.get('countries');
  if (!v) return null;
  return v.split(',')[0] || null;
}

const TOTALS: Record<string, number> = {
  Poland: POLAND_TOTAL,
  Germany: GERMANY_TOTAL,
  France: FRANCE_TOTAL,
};

/* NOTE: Playwright matches routes in REVERSE registration order — the last
   handler registered wins. The catch-all therefore has to go FIRST. */
async function stubApi(page: import('@playwright/test').Page) {
  // Everything not named below (records, health) — valid but empty.
  await page.route(/\/api\/data\//, (route) => route.fulfill(json({})));

  /* The bundled profile endpoint MUST 404, exactly as the live backend does
     (it is absent from the VM's openapi.json). Serving it 200 flips
     _bundledProfileEndpointAvailable to true the moment data.js's probe
     lands, and the profile silently switches to the one-call bundled path
     mid-test — which is not the path either finding is about, and made this
     test pass or fail on probe timing. */
  await page.route(/\/api\/data\/profile/, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"detail":"Not Found"}' }),
  );

  await page.route(/\/api\/data\/map/, (route) =>
    route.fulfill(json({ country_counts: [{ country: 'Poland', count: 10 }, { country: 'Germany', count: 20 }] })),
  );

  /* Analytics + summary are the two legs renderCountry's paint() waits on.
     ONLY /summary is delayed, which is what makes this the audit's scenario
     rather than an easier one: /summary is the count leg, and _loadProfile
     gives it a PER-ENTITY scope (`count:country:Poland`), so Germany's
     request cannot supersede it the way it supersedes the shared 'analytics'
     scope. Poland's analytics resolves early and sits in memCache; its count
     lands late; together they satisfy paint()'s `!analytics || !count` guard
     and the whole profile repaints. Nothing but the generation token stops
     it — delaying analytics instead would let apiGet's abort mask the bug. */
  await page.route(/\/api\/data\/summary/, async (route) => {
    const c = countryOf(route.request().url());
    if (c === 'Poland') await new Promise((r) => setTimeout(r, POLAND_DELAY_MS));
    await route.fulfill(json({ total_records: (c && TOTALS[c]) || 1000 }));
  });

  await page.route(/\/api\/data\/analytics/, (route) =>
    route.fulfill(json(analyticsFor(countryOf(route.request().url()) || 'Baseline'))),
  );

  // Facets — the country dropdown (#cpSelect) is built from this list, so
  // without it there is no way to switch country and no race to observe.
  await page.route(/\/api\/data\/facets/, (route) =>
    route.fulfill(json({
      countries: ['Poland', 'Germany', 'France'],
      bodies: ['CCPR'],
      regions: [],
      sdgs_hierarchy: {},
      min_year: 2010,
      max_year: 2025,
      total_records: 1000,
    })),
  );
}

test('a superseded country profile never repaints the current one', async ({ page }) => {
  /* Poland's stub alone burns 2.5s and the test waits it out twice over. */
  test.setTimeout(60_000);

  await stubApi(page);
  await page.goto('/dashboard.html#view=country&fc=POL');

  // Poland's profile shell is up (heading paints immediately from the hash);
  // its KPIs are still in flight behind the 2.5s stub.
  const heading = page.locator('#view-country .cp-name');
  await expect(heading).toHaveText('Poland', { timeout: 15_000 });
  await expect(page.locator('#cpKpis')).toBeEmpty();

  // Switch to Germany while Poland is still pending — the audit's scenario.
  await page.locator('#cpSelect').selectOption('Germany');
  await expect(heading).toHaveText('Germany', { timeout: 15_000 });

  // Germany paints from its own (fast) responses.
  const kpis = page.locator('#cpKpis');
  await expect(kpis).toContainText(GERMANY_TOTAL.toLocaleString('en-US'), { timeout: 15_000 });
  await expect(kpis).toContainText('Germany Theme');

  // Now let Poland's response land. THIS is the regression: before the fix it
  // resumed its await and overwrote every panel while the heading said Germany.
  await page.waitForTimeout(POLAND_DELAY_MS + 1500);

  await expect(heading, 'heading must still be Germany').toHaveText('Germany');
  await expect(kpis, "Poland's late response repainted Germany's KPIs")
    .toContainText(GERMANY_TOTAL.toLocaleString('en-US'));
  await expect(kpis).not.toContainText(POLAND_TOTAL.toLocaleString('en-US'));

  // Not just the KPIs — the ranked lists and the sample-row result list that
  // feed the reader's j/k stepping must belong to Germany too.
  const view = page.locator('#view-country');
  await expect(view, "Poland's data leaked into Germany's panels").not.toContainText('Poland Theme');
  await expect(view).toContainText('Germany Theme');
});

test('apiGet de-duplication aborts the request it supersedes', async ({ page }) => {
  test.setTimeout(60_000);

  await stubApi(page);
  // Hold analytics open so every request in this test stays in flight. Long
  // enough to outlast the 3s verdict below, short enough not to leave a
  // sleeping handler behind for the rest of the run.
  await page.route(/\/api\/data\/analytics/, async (route) => {
    await new Promise((r) => setTimeout(r, 8_000));
    await route.fulfill(json(analyticsFor('Baseline')));
  });

  await page.goto('/dashboard.html');
  // `api` is a classic-script top-level const — it lives in the shared script
  // scope, NOT on window — so it is reachable only by bare name. Hence the
  // string form of evaluate() here and below.
  await page.waitForFunction("typeof api === 'object' && typeof emptyFilters === 'function'", null, { timeout: 15_000 });

  /* J1-01 in miniature. A speculative preload puts Poland's request in flight
     under its own scope; the Poland profile then asks for the SAME params
     under scope 'analytics' and gets the pending promise back (de-dup hit).
     When Germany supersedes it on scope 'analytics', Poland's shared request
     must be aborted — otherwise it survives to resolve and repaint. */
  const outcome = await page.evaluate(`(async () => {
    const polandFilter  = { ...emptyFilters(), country: new Set(['Poland']) };
    const germanyFilter = { ...emptyFilters(), country: new Set(['Germany']) };

    const preload = api.analytics(polandFilter, { scope: 'preload-analytics:Poland' });
    const profile = api.analytics(polandFilter, { scope: 'analytics' });   // de-dup hit
    const settled = profile.then(() => 'resolved', (e) => (e && e.name) || 'rejected');
    preload.catch(() => {});   // same promise; keep the rejection handled

    // The user switches country: same scope, different params.
    api.analytics(germanyFilter, { scope: 'analytics' }).catch(() => {});

    return Promise.race([
      settled,
      new Promise((r) => setTimeout(() => r('still-pending'), 3000)),
    ]);
  })()`);

  expect(outcome, 'superseded de-duplicated request was not aborted').toBe('AbortError');
});

test('a superseded Compare render writes nothing into the newer one', async ({ page }) => {
  test.setTimeout(60_000);

  await stubApi(page);
  await page.goto('/dashboard.html#view=compare&ca=Poland&cb=France');

  /* Side B (France) answers immediately; side A (Poland) is still waiting on
     its count behind the 2.5s stub. */
  await expect(page.locator('#cmpSubB')).toContainText(FRANCE_TOTAL.toLocaleString('en-US'), { timeout: 15_000 });
  await expect(page.locator('#cmpTimeBLbl')).toHaveText('France');

  /* Change ONLY side B. Side A is re-issued with identical params, so apiGet
     de-duplicates it onto the request the first render is still awaiting —
     the per-side abort scopes cannot help, because both renders now resume
     from that one promise. */
  await page.locator('#cmpSelB').selectOption('Germany');
  await expect(page.locator('#cmpNameB')).toHaveText('Germany', { timeout: 15_000 });
  await expect(page.locator('#cmpTimeBLbl')).toHaveText('Germany');

  /* Record EVERY value side B's chart label takes from here on. Asserting the
     final value would prove nothing: the stale write is followed ~1 tick later
     by the newer render's correct one (it registered its continuation on the
     shared promise second, so it writes last), which repairs the end state.
     What the generation token actually buys is that the superseded render
     performs no write at all — so watch for the transient instead. */
  await page.evaluate(`(() => {
    window.__lblB = [];
    /* Read the values out of the mutation RECORDS, not out of the live node.
       Both writes land in the same microtask drain, so by the time the
       observer callback runs the DOM already reads 'Germany' and the stale
       value would be invisible. The records keep it. */
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') {
          if (r.oldValue) window.__lblB.push(r.oldValue);
          window.__lblB.push(r.target.data);
        } else {
          r.addedNodes.forEach((n) => window.__lblB.push(n.textContent));
        }
      }
    }).observe(document.querySelector('#cmpTimeBLbl'),
      { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
  })()`);

  // Let Poland land — this is when the stale closure used to repaint side B.
  await page.waitForTimeout(POLAND_DELAY_MS + 1500);

  const seen = await page.evaluate('window.__lblB');
  expect(seen, "the superseded render relabelled side B with the country it used to hold")
    .not.toContain('France');
  await expect(page.locator('#cmpTimeBLbl')).toHaveText('Germany');
  await expect(page.locator('#cmpSubB')).toContainText(GERMANY_TOTAL.toLocaleString('en-US'));
});
