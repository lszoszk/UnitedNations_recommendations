/* Analytics module smoke tests.
   Verify that trackSearch never leaks the raw query text into any
   gtag call, and that the derived metadata buckets match what the
   About → Privacy section promises. */
import { test, expect } from '@playwright/test';

test('trackSearch emits only derived metadata, never the raw query', async ({ page }) => {
  await page.addInitScript(() => {
    // Pretend consent was granted so the module emits.
    localStorage.setItem('uhri-ga-consent', 'granted');
  });

  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).trackSearch === 'function', null, { timeout: 5000 });

  // The page's own <head> snippet declared `function gtag(){}` which
  // hoisted and became the window.gtag we actually want trackSearch
  // to call.  Swap it out NOW (after all scripts parsed) for our
  // capture so subsequent trackSearch calls hit the recorder.
  await page.evaluate(() => {
    (window as any).__gaCapture = [];
    (window as any).gtag = function () {
      (window as any).__gaCapture.push(Array.from(arguments));
    };
  });

  // Run a range of queries to exercise each code path.
  const cases = [
    { query: 'torture',                                total: 13421, expect_words: '1', boolean: false, wildcard: false, quotes: false, bucket: '10k+' },
    { query: 'LGBT*',                                  total: 258,   expect_words: '1', boolean: false, wildcard: true,  quotes: false, bucket: '101-1k' },
    { query: '"forced labour"',                        total: 5,     expect_words: '1', boolean: false, wildcard: false, quotes: true,  bucket: '1-10' },
    { query: 'torture AND detention',                  total: 85,    expect_words: '2', boolean: true,  wildcard: false, quotes: false, bucket: '11-100' },
    { query: '(child OR woman) AND trafficking NOT "sex work"', total: 40, expect_words: '3-5', boolean: true, wildcard: false, quotes: true, bucket: '11-100' },
    { query: '   ',                                    total: 100,   skip: true }, // empty → no event
  ];

  const captured = await page.evaluate((cases) => {
    (window as any).__gaCapture.length = 0; // clear any init events
    for (const c of cases) (window as any).trackSearch(c.query, c.total);
    return (window as any).__gaCapture;
  }, cases);

  // Each non-skipped case → one event.
  const eventCalls = captured.filter((c: any[]) => c[0] === 'event' && c[1] === 'search_performed');
  const nonSkipped = cases.filter(c => !c.skip);
  expect(eventCalls.length, 'one search_performed event per non-empty query').toBe(nonSkipped.length);

  // CRITICAL: none of the events can contain the raw query string.
  // Flatten every event's params + stringify — assert no substring match.
  for (const c of cases) {
    if (c.skip) continue;
    const payload = JSON.stringify(eventCalls);
    // The raw query must never appear in the captured payload.  We
    // allow a few sanitised fragments that could coincidentally appear
    // (word "AND" would be a boolean keyword; "torture" as a word is
    // the query itself).  To stay strict, we check the whole raw
    // query string is NOT in the payload.
    const raw = c.query.trim();
    if (raw.length > 3) {  // skip short words to avoid false positives (e.g. 'OR' inside 'orange')
      expect(payload.includes(raw),
        `raw query "${raw}" must NOT appear in analytics payload`).toBe(false);
    }
  }

  // Shape check — verify buckets match the expected for each case.
  nonSkipped.forEach((c, i) => {
    const params = eventCalls[i][2];
    expect(params.query_word_count,    `words bucket for "${c.query}"`).toBe(c.expect_words);
    expect(params.has_boolean,         `boolean for "${c.query}"`).toBe(c.boolean);
    expect(params.has_wildcard,        `wildcard for "${c.query}"`).toBe(c.wildcard);
    expect(params.has_quotes,          `quotes for "${c.query}"`).toBe(c.quotes);
    expect(params.result_count_bucket, `result bucket for "${c.query}"`).toBe(c.bucket);
  });
});

test('trackSearch is no-op when consent not granted', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uhri-ga-consent', 'denied');
  });

  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).trackSearch === 'function', null, { timeout: 5000 });

  const captured = await page.evaluate(() => {
    (window as any).__gaCapture = [];
    (window as any).gtag = function () {
      (window as any).__gaCapture.push(Array.from(arguments));
    };
    (window as any).trackSearch('torture', 13421);
    (window as any).trackSearch('LGBT*', 258);
    return (window as any).__gaCapture;
  });

  // With denied consent, trackSearch must emit zero events.
  const eventCalls = captured.filter((c: any[]) => c[0] === 'event' && c[1] === 'search_performed');
  expect(eventCalls.length).toBe(0);
});
