/* trackWebVital tests — verify the RUM helper buckets metrics
 * correctly, only emits with consent, and never crashes the app on
 * malformed input. */
import { test, expect } from '@playwright/test';

async function loadDashboard(page: any, consent: 'granted' | 'denied' | 'unset') {
  await page.addInitScript((c: string) => {
    if (c === 'unset') localStorage.removeItem('uhri-ga-consent');
    else localStorage.setItem('uhri-ga-consent', c);
  }, consent);
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).trackWebVital === 'function', null, { timeout: 5000 });
  // Replace the head-script gtag with a capture stub.
  await page.evaluate(() => {
    (window as any).__gaCapture = [];
    (window as any).gtag = function () {
      (window as any).__gaCapture.push(Array.from(arguments));
    };
  });
}

test('trackWebVital: bucketing per metric matches web.dev thresholds', async ({ page }) => {
  await loadDashboard(page, 'granted');

  // One sample per metric × per rating bucket.  Values picked just
  // above/below the published thresholds (web.dev/lcp etc.).
  const cases = [
    { name: 'LCP', value: 1500,   rating: 'good',              bucket: '<2.5s' },
    { name: 'LCP', value: 3000,   rating: 'needs-improvement', bucket: '2.5-4s' },
    { name: 'LCP', value: 5000,   rating: 'poor',              bucket: '>4s' },
    { name: 'INP', value: 100,    rating: 'good',              bucket: '<200ms' },
    { name: 'INP', value: 300,    rating: 'needs-improvement', bucket: '200-500ms' },
    { name: 'INP', value: 800,    rating: 'poor',              bucket: '>500ms' },
    { name: 'CLS', value: 0.05,   rating: 'good',              bucket: '<0.1' },
    { name: 'CLS', value: 0.15,   rating: 'needs-improvement', bucket: '0.1-0.25' },
    { name: 'CLS', value: 0.30,   rating: 'poor',              bucket: '>0.25' },
    { name: 'FCP', value: 1000,   rating: 'good',              bucket: '<1.8s' },
    { name: 'TTFB', value: 500,   rating: 'good',              bucket: '<800ms' },
  ];

  const captured = await page.evaluate((cases) => {
    (window as any).__gaCapture.length = 0;
    for (const c of cases) {
      (window as any).trackWebVital({
        name: c.name, value: c.value, rating: c.rating,
        id: `v3-${c.name}-test`, navigationType: 'navigate',
      });
    }
    return (window as any).__gaCapture;
  }, cases);

  const events = captured.filter((c: any[]) => c[0] === 'event' && c[1] === 'web_vital');
  expect(events.length, 'one web_vital event per call').toBe(cases.length);

  // For each case, assert the params object has the expected bucket
  // + rating + metric_name.
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const params = events[i][2];
    expect(params.metric_name,   `case ${i} ${c.name}`).toBe(c.name);
    expect(params.metric_rating, `case ${i} ${c.name}.rating`).toBe(c.rating);
    expect(params.metric_bucket, `case ${i} ${c.name}.bucket`).toBe(c.bucket);
  }
});

test('trackWebVital: no events emitted when consent is denied', async ({ page }) => {
  await loadDashboard(page, 'denied');

  const captured = await page.evaluate(() => {
    (window as any).__gaCapture.length = 0;
    (window as any).trackWebVital({ name: 'LCP', value: 1234, rating: 'good', id: 'x' });
    (window as any).trackWebVital({ name: 'INP', value: 100,  rating: 'good', id: 'y' });
    return (window as any).__gaCapture;
  });

  const webVitalEvents = captured.filter((c: any[]) => c[0] === 'event' && c[1] === 'web_vital');
  expect(webVitalEvents.length, 'no events should fire under denied consent').toBe(0);
});

test('trackWebVital: malformed input never throws', async ({ page }) => {
  await loadDashboard(page, 'granted');

  const result = await page.evaluate(() => {
    const tries = [
      undefined,
      null,
      {},
      { name: '' },
      { name: 'LCP' },                                  // missing value → coerced to 0
      { name: 'UNKNOWN_METRIC', value: 1234 },          // unknown name → bucket=unknown
      { name: 'LCP', value: 'NaN' },                    // bad value coerce
      { name: 'LCP', value: 1500, id: 'a'.repeat(500) },// long id → truncated
    ];
    let threw = false;
    for (const t of tries) {
      try { (window as any).trackWebVital(t); } catch (_) { threw = true; }
    }
    const events = (window as any).__gaCapture.filter((c: any[]) => c[0] === 'event' && c[1] === 'web_vital');
    return { threw, eventsLen: events.length, lastIdLen: events.length ? String(events[events.length-1][2].metric_id || '').length : 0 };
  });

  expect(result.threw, 'trackWebVital must never throw on bad input').toBe(false);
  // Some inputs are too malformed to emit (no name) — but emits that
  // DO happen must respect the id truncation.
  expect(result.lastIdLen, 'metric_id truncated to 64 chars max').toBeLessThanOrEqual(64);
});
