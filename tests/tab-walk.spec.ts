/* Tab-walk smoke: load dashboard.html, walk every tab, fail on any JS
   console error.  Runs on top of the standard Playwright webServer.
   Complementary to the existing 21 scenarios (which each focus on one
   flow) — this one simply makes sure the 12 view dispatchers don't
   throw when visited back-to-back. */
import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

const TOLERATED: RegExp[] = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /manifest\.webmanifest/i,
  /\/api\/data\//i,
  /\/uhri-api\//i,
  /Service Worker .* was intercepted/i,
  // Backend VM (150.254.115.204) is cross-origin + offline during tests.
  // The dashboard catches the fetch() rejection and emits a single
  // console.error("Phase 1 boot failed", err) — the app degrades
  // gracefully from there.  These are not JS bugs.
  /Phase 1 boot failed/i,
  /Failed to fetch/i,
  /Access-Control-Allow-Origin/i,       // WebKit's console-error CORS message
  /Cross-Origin Request Blocked/i,      // Firefox's CORS message
  /due to access control checks/i,      // WebKit's pageerror-channel CORS message
  /downloadable font: download failed/i, // Firefox font-network-error console message
  /fonts\.gstatic\.com/i,                // Firefox/WebKit fail-to-load when offline
  /A ServiceWorker passed a promise/i,   // Firefox's SW-fetch-rejected wrapper
  /\[freshness\] render failed/i,
  // Google Analytics requests are blocked by the test env's CSP /
  // network isolation — gtag.js loads with consent default=denied,
  // nothing is ever sent.  Don't fail tests on GA network noise.
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (TOLERATED.some(p => p.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = err.message || String(err);
    // pageerror events also need TOLERATED filtering — WebKit
    // surfaces cross-origin VM fetches as pageerror "<URL> due to
    // access control checks." while Chromium logs them as
    // console.error. Without this filter, every WebKit run flags
    // the expected cross-origin VM block as a real bug.
    if (TOLERATED.some(p => p.test(text))) return;
    errors.push('pageerror: ' + text);
  });
  return errors;
}

const VIEWS = [
  'overview', 'country', 'compare', 'group', 'theme', 'sdg',
  'mechanism', 'search', 'bookmarks', 'labels', 'methodology', 'about',
];

test('walk every tab — no JS errors in any view dispatcher', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

  for (const view of VIEWS) {
    await page.evaluate((v) => navigate(v), view);
    const visible = await page.locator(`#view-${view}`).isVisible();
    expect(visible, `view-${view} must become visible after navigate('${view}')`).toBe(true);
    // Let any async renderer settle before we move on — some dispatchers
    // await fetches that will reject in the test env; that's fine, we
    // already filter tolerated errors above. Give 50ms headroom.
    await page.waitForTimeout(60);
  }

  expect(errors, `JS errors while walking tabs:\n${errors.join('\n')}`).toEqual([]);
});

test('landing — index.html boots without JS errors', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => !!document.querySelector('#hexSvg'), null, { timeout: 5000 });
  await page.waitForTimeout(300); // let dot-field + hex map finish their initial paints
  expect(errors, `JS errors on landing page:\n${errors.join('\n')}`).toEqual([]);
});

test('rail facet heads toggle collapsed class — single listener, not N×', async ({ page, viewport }) => {
  /* Regression test for the duplicate-attach bug: buildRail() runs 2–3×
     during boot (SW cache / facets / analytics phases).  A previous
     implementation attached a fresh .facet-head click handler on each
     call, so clicks toggled .collapsed an even number of times on
     fresh visits — SDG and TYPE (which start collapsed) refused to
     expand.  The delegated handler in buildRail should fire exactly
     once per click no matter how many times buildRail ran.

     This test exercises the desktop rail layout.  On <960 px the rail
     is display:none until the user taps the hamburger button (mobile
     bottom-sheet pattern), so the .facet-head is unclickable in that
     state.  The duplicate-attach bug doesn't depend on viewport, so
     skipping on mobile loses no coverage. */
  if (viewport && viewport.width < 960) {
    test.skip();
    return;
  }

  const errors = collectConsoleErrors(page);
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).buildRail === 'function', null, { timeout: 5000 });
  // Simulate the full boot chain running buildRail twice (as it does
  // on a cold visit: once from Phase-1 facets, once from Phase-2 analytics).
  await page.evaluate(() => {
    const stubFacets = { countries: [], bodies: [], regions: [], types: [], min_year: 2006, max_year: 2026 };
    const stubAnalytics = { themes: { theme_counts: [] }, text: { affected_person_counts: [], sdg_counts: [] }, trends: {} };
    (globalThis as any).buildRail(stubFacets, stubAnalytics);
    (globalThis as any).buildRail(stubFacets, stubAnalytics);
  });

  const sdg = page.locator('[data-facet="sdg"]');
  await expect(sdg).toHaveClass(/\bcollapsed\b/);  // starts collapsed
  await sdg.locator('.facet-head').click();
  await expect(sdg).not.toHaveClass(/\bcollapsed\b/);  // one click, one toggle
  await sdg.locator('.facet-head').click();
  await expect(sdg).toHaveClass(/\bcollapsed\b/);  // click-to-collapse still works

  const type = page.locator('[data-facet="type"]');
  await expect(type).toHaveClass(/\bcollapsed\b/);
  await type.locator('.facet-head').click();
  await expect(type).not.toHaveClass(/\bcollapsed\b/);

  expect(errors).toEqual([]);
});

test('drawer-list — single-record load does not duplicate (race fix)', async ({ page }) => {
  /* Regression test for the 2026-04-24 duplicate-card bug: openListDrawer
     awaited loadMoreListDrawer() for its first fetch, but simultaneously
     rendered the sentinel which fired the IntersectionObserver's own
     load call before the awaited one finished.  Two concurrent fetches,
     two pushes of the same record into ctx.records, 2 identical cards
     rendered from 1 API result.  Fixed by a ctx._loading reentrancy
     guard. */
  const errors = collectConsoleErrors(page);
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).openListDrawer === 'function', null, { timeout: 5000 });

  // Stub fetch to guarantee a known response: 1 record, same ID on any
  // duplicate call.  If the race regressed, ctx.records would grow to 2.
  await page.evaluate(() => {
    const stubRec = {
      AnnotationId: 'test-uuid-0001',
      Text: 'stub',
      TextPlainCleaned: 'stub',
      Countries: ['Albania'],
      Themes: [], AffectedPersons: [], Sdgs: [], Body: 'Stub',
      PublicationDate: '2012-01-01',
    };
    const origFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/data/records') && url.includes('countries=')) {
        return new Response(JSON.stringify({
          ok: true, total_records: 1, page: 1, page_size: 30,
          records: [stubRec], snippet: '',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return origFetch(input, init);
    };
  });

  await page.evaluate(() => (globalThis as any).openListDrawer('country', 'Albania'));
  await page.waitForTimeout(1500);

  // Check the DOM (classic-script `state` const isn't exposed on
  // globalThis — DOM is the robust source of truth).  Header text
  // "1 matching records · showing 1" vs the regressed "… · showing 2"
  // is a reliable signal.
  const result = await page.evaluate(() => {
    const cards = document.querySelectorAll('.dr-list-card');
    const head = document.querySelector('.dr-list-head .n');
    return {
      domCardCount: cards.length,
      uniqueDomIds: new Set(Array.from(cards).map(c => (c as HTMLElement).dataset?.id)).size,
      headText: head?.textContent?.trim() || '',
    };
  });

  expect(result.headText, 'head text should show 1 matching / 1 shown').toContain('showing 1');
  expect(result.domCardCount, 'DOM cards == total (no race duplicates)').toBe(1);
  expect(result.uniqueDomIds, 'no duplicate cards with same id').toBe(1);
  expect(errors).toEqual([]);
});

test('footer About link navigates from Overview', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  // Pre-set GA consent so the banner never appears.  On mobile
  // viewports the bottom-fixed banner intercepts pointer events on
  // the dash-footer below it, blocking this test.  Setting consent
  // either way (granted or denied) skips the banner; we use 'denied'
  // because that's also closest to the test env's network reality
  // (no GA traffic should fire from headless tests anyway).
  await page.addInitScript(() => localStorage.setItem('uhri-ga-consent', 'denied'));
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });
  await page.locator('.dash-footer .disclaimer').click();
  await expect(page.locator('#view-about')).toBeVisible();
  // Every anchor on the About page should have either href, or data-nav,
  // or mailto — no decorative <a>s without a destination.
  const anchors = await page.locator('#view-about a').evaluateAll(els =>
    els.map(a => ({
      text: a.textContent?.trim().slice(0, 30),
      href: a.getAttribute('href'),
      nav: a.getAttribute('data-nav'),
    })));
  for (const a of anchors) {
    expect(a.href || a.nav, `anchor "${a.text}" has no target`).toBeTruthy();
  }
  expect(errors, `JS errors during About navigation:\n${errors.join('\n')}`).toEqual([]);
});
