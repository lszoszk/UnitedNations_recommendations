import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * UHRI Dashboard smoke tests.
 *
 * These exist to catch specific classes of regression we've been hit by:
 *   1. boot        — inline IIFE halts partway (drawTimeline threw, 2026-04-20)
 *   2. loadOrder   — script extraction breaks a forward-ref global
 *   3. hashRouting — dashboard-route.js fails to expose its routing API
 *   4. landingSearch — index.html hero search input isn't wired (bec17a1)
 *   5. datasetNumber — hardcoded "267,548" drifts from reality (pre-c87b355)
 *   6. searchView  — extracted search module no longer renders its shell
 *
 * The backend API lives on a cross-origin VM (150.254.115.204) with its own
 * monitoring. These tests DO NOT depend on it — the dashboard is designed
 * to degrade gracefully when API calls fail, and we only assert behaviours
 * independent of live data.
 *
 * RUN: `npm test` (headless). `npm run test:headed` to watch.
 */

/**
 * Non-fatal console messages emitted when the VM backend is unreachable.
 * Matching these keeps the "no console errors" assertion meaningful —
 * we only want to catch *JS* errors (thrown, parse, missing global), not
 * network failures the app is designed to tolerate.
 */
const TOLERATED_MESSAGE_PATTERNS: RegExp[] = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /manifest\.webmanifest/i,             // PWA install unavailable during test
  /\/api\/data\//i,                     // VM backend down during tests
  /\/uhri-api\//i,                      // same
  /ServiceWorker registration failed/i,
  /refresh_status/i,
  /The connection used to load resources/i,
  /Phase 1 boot failed/i,               // VM-down path, dashboard handles it
  /Analytics failed/i,                  // VM-down path, dashboard handles it
  /Failed to fetch/i,                   // VM-down path
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (TOLERATED_MESSAGE_PATTERNS.some(p => p.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = err.message;
    if (TOLERATED_MESSAGE_PATTERNS.some(p => p.test(text))) return;
    errors.push(`pageerror: ${text}`);
  });
  return errors;
}

test.describe('UHRI Dashboard smoke', () => {
  test('1. boot — dashboard.html renders tabs, no unexpected JS errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    // The tab bar is rendered in HTML (not JS), so it appears even when the
    // IIFE bails. But we want them PRESENT — their absence means the HTML
    // itself failed to parse, which is a far worse regression.
    await expect(page.locator('[data-nav="overview"]')).toBeVisible();
    await expect(page.locator('[data-nav="labels"]')).toBeVisible();
    // Let the IIFE run so synchronous errors surface.
    await page.waitForTimeout(800);
    expect(errors, `JS errors during boot:\n${errors.join('\n')}`).toEqual([]);
  });

  test('2. loadOrder — helper globals and module globals are all defined', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForLoadState('domcontentloaded');
    // Top-level `const` bindings DON'T attach to window — but they ARE
    // visible to bare-name lookup in other scripts in the same realm.
    // page.evaluate() runs a synthesized script in that same realm, so
    // bare `typeof X` correctly reads them.
    //
    // `typeof undeclared-name` returns 'undefined' without throwing, which
    // is exactly what we want for this probe.
    const globals = await page.evaluate(() => ({
      // From dashboard-helpers.js (loaded FIRST):
      cleanCountryName:         typeof cleanCountryName,
      cleanLabel:               typeof cleanLabel,
      ISO_TO_NAME:              typeof ISO_TO_NAME,
      MAP_LAYOUT:               typeof MAP_LAYOUT,
      MECH_FAMILIES:            typeof MECH_FAMILIES,
      _hasSdgFilters:           typeof _hasSdgFilters,
      _recordMatchesSdgFilters: typeof _recordMatchesSdgFilters,
      formatSdgLabel:           typeof formatSdgLabel,
      emptyFilters:             typeof emptyFilters,
      sanitize:                 typeof sanitize,
      // From the other extracted modules — they all depend on helpers,
      // so proving they're loaded proves load order is correct:
      state:                    typeof state,
      api:                      typeof api,
      offline:                  typeof offline,
      // From dashboard-labels.js — renderRules is the cross-module call
      // surface (inline's navigate() dispatches here for the Labels tab).
      renderRules:              typeof renderRules,
      compileRule:              typeof compileRule,
      RULES_STARTER_TEMPLATES:  typeof RULES_STARTER_TEMPLATES,
      // From dashboard-ui.js — cmdk palette, tweaks (shared TW), and tour.
      // Inline keydown handlers, topbar buttons, renderDrawer (reads TW),
      // and the boot sequence all reach back into these.
      openPalette:              typeof openPalette,
      TW:                       typeof TW,
      applyTweaks:              typeof applyTweaks,
      startTour:                typeof startTour,
      // From dashboard-timeline.js — renderTimeline is called from 7+
      // profile renderers in inline, plus the overview FIG.04 panel.
      renderTimeline:           typeof renderTimeline,
      _renderStackToggle:       typeof _renderStackToggle,
      getTimelineMode:          typeof getTimelineMode,
      // From dashboard-map.js — renderMap is the main FIG.01 entry point,
      // getMapMode/setMapMode persist user preference, exportMapAsSVG is
      // bound by the overview shell's ⬇ SVG button.
      renderMap:                typeof renderMap,
      getMapMode:               typeof getMapMode,
      setMapMode:               typeof setMapMode,
      exportMapAsSVG:           typeof exportMapAsSVG,
      renderSearch:             typeof renderSearch,
      renderActiveFilters:      typeof renderActiveFilters,
      refreshHitCount:          typeof refreshHitCount,
      onFiltersChanged:         typeof onFiltersChanged,
      bindYearSlider:           typeof bindYearSlider,
      _renderYearHistogram:     typeof _renderYearHistogram,
      renderCountry:            typeof renderCountry,
      renderTheme:              typeof renderTheme,
      renderGroup:              typeof renderGroup,
      renderSDG:                typeof renderSDG,
      renderMechanism:          typeof renderMechanism,
      renderCompare:            typeof renderCompare,
      _resolveCompareDefaults:  typeof _resolveCompareDefaults,
      renderFreshnessCard:      typeof renderFreshnessCard,
      renderMethodology:        typeof renderMethodology,
    }));
    for (const [name, type] of Object.entries(globals)) {
      expect(type, `\`${name}\` should not be undefined — load order broken?`).not.toBe('undefined');
    }
  });

  test('3. hashRouting — route module exposes its API and tabs switch on click', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForLoadState('domcontentloaded');
    // Route module should have loaded and defined its handlers.
    const routeApi = await page.evaluate(() => ({
      applyFn:   typeof _applyRouteStateFromHash,
      pushFn:    typeof _pushUrlState,
      restoreFn: typeof _restoreUrlState,
    }));
    expect(routeApi.applyFn, '_applyRouteStateFromHash should be loaded').toBe('function');
    expect(routeApi.pushFn, '_pushUrlState should be loaded').toBe('function');
    expect(routeApi.restoreFn, '_restoreUrlState should be loaded').toBe('function');

    // Separately: clicking a tab switches the active tab. This exercises
    // the wiring between <a role="tab" data-nav=...> and the navigate()
    // function without depending on the VM being up.
    //
    // `[data-nav=...]` matches multiple links (tab + footer + inline prose),
    // so we scope to the tab by combining with role="tab".
    //
    // Under SW warm-up / dynamic map-lib imports / full-suite load, boot
    // wiring can take >500ms. Poll for `navigate` to be defined instead of
    // a fixed wait — that's the last thing the inline IIFE attaches and is
    // the proper signal that click handlers are live.
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });
    const methodologyTab = page.locator('a[role="tab"][data-nav="methodology"]');
    const overviewTab    = page.locator('a[role="tab"][data-nav="overview"]');
    await methodologyTab.click();
    await expect(methodologyTab).toHaveAttribute('aria-selected', 'true', { timeout: 3000 });
    await expect(overviewTab).toHaveAttribute('aria-selected', 'false');
  });

  test('4. landingSearch — index.html hero search input is wired and opens dropdown', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/index.html');
    const input = page.locator('#landingSearch');
    await expect(input).toBeVisible();
    await input.fill('china');
    const dropdown = page.locator('#landingSearchDropdown');
    // The dropdown stays `hidden` (boolean attr present) when closed, and
    // the attribute is removed when the wiring opens it. Presence test:
    await expect(dropdown).not.toHaveAttribute('hidden', /.*/, { timeout: 2000 });
    await page.waitForTimeout(300);
    expect(errors, `JS errors on landing page:\n${errors.join('\n')}`).toEqual([]);
  });

  test('5. datasetNumber — "267,537" appears in footer and cmdk hint', async ({ page }) => {
    await page.goto('/dashboard.html');
    // Footer and cmdk hint are both in static HTML — always present regardless
    // of data load. They're the canonical surfaces where the dataset number
    // is visible to users on every view.
    const footer = page.locator('.dash-footer');
    await expect(footer).toContainText('267,537');
    await expect(footer).not.toContainText('267,548');

    const cmdkHint = page.locator('.cmdk-hint');
    await expect(cmdkHint).toContainText('267,537');
    await expect(cmdkHint).not.toContainText('267,548');
    // Methodology tab legitimately mentions the raw-count 267,548 as
    // documentation — so we deliberately don't do a page-wide scan.
  });

  test('6. searchView — extracted search module renders shell and keyword sort', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    await page.evaluate(async () => {
      state.filters.kw = 'china';
      state.searchSort = null;
      const kw = document.getElementById('kwInput') as HTMLInputElement | null;
      if (kw) kw.value = 'china';
      await navigate('search');
    });

    const searchTab = page.locator('a[role="tab"][data-nav="search"]');
    await expect(searchTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-search .se-head .lbl')).toHaveText('Search results');
    await expect(page.locator('#view-search .se-head .q')).toHaveText('"china"');
    await expect(page.locator('#seSort')).toHaveValue('relevance:asc');
    await expect(page.locator('#seBulkCount')).toHaveText('0 selected');
    await expect(page.locator('#seSentinel')).toContainText('Loading more');

    expect(errors, `JS errors while rendering search view:\n${errors.join('\n')}`).toEqual([]);
  });
});
