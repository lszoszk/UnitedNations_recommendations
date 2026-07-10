import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import * as fs   from 'fs';
import * as path from 'path';

/**
 * UHRI Dashboard smoke tests.
 *
 * These exist to catch specific classes of regression we've been hit by:
 *   1. boot         — inline IIFE halts partway (drawTimeline threw, 2026-04-20)
 *   2. loadOrder    — script extraction breaks a forward-ref global
 *   3. hashRouting  — dashboard-route.js fails to expose its routing API
 *   4. landingSearch — index.html hero search input isn't wired (bec17a1)
 *   5. datasetNumber — hardcoded "267,548" drifts from reality (pre-c87b355)
 *   6. searchView   — extracted search module no longer renders its shell
 *   7. readerDrawer — extracted reader module still renders record chrome
 *   8. compareScale — shared Y scale in Compare must normalize API row arrays
 *
 * Scenario tests (9-17) go one layer up — they exercise user-visible flows:
 *   9. hashFocusRestore     — deep-link URL restores focus country/theme
 *  10. cmdPalette           — ⌘K opens, typing filters, click navigates
 *  11. railFilterChip       — rail change surfaces chip + hit-count updates
 *  12. savedViewPersistence — svSave → reload → svLoad round-trip intact
 *  13. countryProfile       — navigate('country') switches tab + view section
 *  14. m49RegionLookup      — rail REGION filter uses M49 5-region, the
 *                             lookup correctly maps to country names (this
 *                             is how we bridge M49 UI ↔ Treaty Body server)
 *  15. uhriXlsxMapper       — upload pipeline's UHRI xlsx row → canonical
 *                             record shape, covering the "- " prefix strip,
 *                             \n-separated arrays, and Excel date serials
 *  16. rawModeBanner        — toggling RAW upstream mode doesn't collapse
 *                             the 3-column grid (banner spans row 1 full
 *                             width, rail / main / drawer stay in row 2)
 *  17. landingNameToIso3    — every canonical HEX_LAYOUT country name
 *                             resolves via _nameToIso3 (previously only
 *                             ~40 variant forms did; 150+ plain-English
 *                             names silently failed and stayed grey)
 *  18. readingModeResize    — A-/A+ changes drawer text size in read mode
 *  19. methodologyToc       — methodology jump-nav renders and removed copy
 *                             stays removed
 *  20. readingModeRailRestore — legacy saved tweak snapshots from old
 *                             reading-mode logic still restore the rail
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
  /Access-Control-Allow-Origin/i,       // WebKit's console-error CORS-block message
  /Cross-Origin Request Blocked/i,      // Firefox's CORS-block console message
  /due to access control checks/i,      // WebKit's pageerror-channel CORS message — emitted as a thrown error, not a console.error
  /downloadable font: download failed/i, // Firefox-only — fonts.gstatic.com timeout in test env
  /fonts\.gstatic\.com/i,                // generic Google Fonts offline fallout
  /A ServiceWorker passed a promise/i,   // Firefox's SW-fetch-rejected wrapper for the above
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
    await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
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
      openListDrawer:           typeof openListDrawer,
      openSelectionDrawer:      typeof openSelectionDrawer,
      refreshSelectionDrawer:   typeof refreshSelectionDrawer,
      loadMoreListDrawer:       typeof loadMoreListDrawer,
      closeListDrawer:          typeof closeListDrawer,
      renderDrawerListMode:     typeof renderDrawerListMode,
      citeAPA:                  typeof citeAPA,
      navigateRec:              typeof navigateRec,
      renderDrawer:             typeof renderDrawer,
      openReader:               typeof openReader,
      // From dashboard-rail.js — owns the left rail construction + the
      // mechanism-family taxonomy reached into by profiles, timeline,
      // utils, reader.
      buildRail:                typeof buildRail,
      buildBodyFacetGrouped:    typeof buildBodyFacetGrouped,
      classifyBody:             typeof classifyBody,
      renderMechTiles:          typeof renderMechTiles,
      _computeMechCounts:       typeof _computeMechCounts,
      bindKwInput:              typeof bindKwInput,
      renderKwSyns:             typeof renderKwSyns,
      TREATY_BODY_ACRONYMS:     typeof TREATY_BODY_ACRONYMS,
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

    const restoredModes = await page.evaluate(() => {
      _resetRouteState();
      state.facets = { ...(state.facets || {}), regions: ['GRULAC', 'Western Europe & Others'] };
      _restoreUrlState('theme=Health|Education&group=Women|Children&region=GRULAC&rt=unGroups&tm=all&gm=all');
      return {
        taxonomy: state.regionTaxonomy,
        themeMatch: state.filters.themesMatch,
        groupMatch: state.filters.groupsMatch,
        regions: Array.from(state.filters.region),
      };
    });
    expect(restoredModes).toEqual({
      taxonomy: 'unGroups', themeMatch: 'all', groupMatch: 'all', regions: ['GRULAC'],
    });

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
    await page.goto('/index.html', { waitUntil: 'commit' });
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

  test('5. datasetNumber — canonical count matches scripts/counts.json', async ({ page }) => {
    // Read the single source of truth so this test never needs manual edits
    // after the monthly dataset refresh.  scripts/counts.json is written by
    // update-counts.mjs and is the same file the sync-counts workflow reads.
    const countsPath = path.join(__dirname, '../scripts/counts.json');
    const counts = JSON.parse(fs.readFileSync(countsPath, 'utf8'));
    const expected = counts.cleaned.toLocaleString('en-US');   // e.g. "267,671"

    await page.goto('/dashboard.html', { waitUntil: 'commit' });
    // Footer and the prominent main-search placeholder are both in static HTML
    // — always present regardless of data load. They're the canonical surfaces
    // where the dataset number is visible to users on every view. (The ⌘K hint
    // intentionally no longer repeats the count; the main search bar carries it
    // so the two affordances don't compete with duplicate "Search all N" text.)
    const footer = page.locator('.dash-footer');
    await expect(footer).toContainText(expected);

    const mainSearch = page.locator('#mainSearchInput');
    await expect(mainSearch).toHaveAttribute(
      'placeholder',
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
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

  test('7. readerDrawer — extracted reader module renders a synthetic record', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    await page.evaluate(() => {
      const rec = {
        AnnotationId: 'smoke-reader-1',
        PublicationDate: '2024-02-03',
        Countries: ['China'],
        Regions: ['Asia'],
        Body: 'Committee against Torture',
        Themes: ['Liberty and security of person'],
        AffectedPersons: ['Women'],
        Sdgs: ['SDG 16.3'],
        Symbol: 'CAT/C/XYZ/1',
        AnnotationType: 'Concluding observations',
        SectionHeadings: ['Synthetic smoke-test record'],
        TextPlainCleaned: 'Synthetic smoke-test record text about detention, due process, and remedies.',
      };
      state.selectedRec = rec;
      state.currentResultList = [rec];
      state.currentResultIndex = 0;
      state.drawerMode = 'record';
      state.drawerList = null;
      renderDrawer();
      openReader(rec);
    });

    await expect(page.locator('#drawerBody #drOpen')).toBeVisible();
    await expect(page.locator('#drawerBody')).toContainText('smoke-reader-1');
    await expect(page.locator('#reader:not(.hidden) #readerBody .rd-title')).toContainText('Synthetic smoke-test record');
    await expect(page.locator('#reader:not(.hidden) #readerBody')).toContainText('CAT/C/XYZ/1');

    expect(errors, `JS errors while rendering drawer/reader:\n${errors.join('\n')}`).toEqual([]);
  });

  test('8. compareScale — compare timelines share a normalized annual max', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    await page.evaluate(async () => {
      state.facets = {
        ...(state.facets || {}),
        min_year: 2006,
        max_year: 2026,
        countries: ['Aland', 'Borland'],
      };

      const mk = (rows: Array<{ year: number; body: string; count: number }>) => ({
        trends: { yearly_body_counts: rows },
        themes: { theme_counts: [] },
        text: { affected_person_counts: [], sdg_counts: [] },
      });

      const analyticsByCountry: Record<string, any> = {
        Aland: mk([
          { year: 2010, body: 'UPR', count: 120 },
          { year: 2010, body: 'CCPR', count: 30 },
        ]),
        Borland: mk([
          { year: 2011, body: 'UPR', count: 80 },
        ]),
      };

      api.analytics = async (filter: any) => {
        const country = Array.from(filter?.country || [])[0];
        return analyticsByCountry[country] || mk([]);
      };
      api.records = async () => ({ total_records: 1, records: [] });

      state.cmpA = 'Aland';
      state.cmpB = 'Borland';
      await renderCompare();
    });

    await page.waitForFunction(() => {
      const subA = document.querySelector('#cmpSubA')?.textContent || '';
      const subB = document.querySelector('#cmpSubB')?.textContent || '';
      return subA.includes('1 recs') && subB.includes('1 recs');
    }, null, { timeout: 5000 });

    const { maxA, maxB } = await page.evaluate(() => {
      const readMax = (selector: string) => {
        const nums = Array.from(document.querySelectorAll(selector))
          .map(el => Number((el.textContent || '').replace(/,/g, '')))
          .filter(n => Number.isFinite(n));
        return nums.length ? Math.max(...nums) : 0;
      };
      return {
        maxA: readMax('#cmpTimeA .tl-svg text'),
        maxB: readMax('#cmpTimeB .tl-svg text'),
      };
    });

    expect(maxA).toBe(150);
    expect(maxB).toBe(150);
    expect(errors, `JS errors while rendering compare view:\n${errors.join('\n')}`).toEqual([]);
  });

  // ===========================================================================
  // SCENARIO TESTS (9-13) — exercise actual user flows, not just module wiring.
  // These catch regressions the unit/smoke layer above can't see: URL hash
  // restore, cmdk navigation, rail feedback, saved-view persistence, profile
  // rendering. Each one mocks the VM API just enough to avoid network and
  // asserts observable UI state.
  // ===========================================================================

  test('9. hashFocusRestore — /dashboard.html#view=country&fc=DEU opens Germany profile', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    // Boot's Phase 1 (facets + map + analytics) fires synchronously before the
    // hash restoration finishes. If those VM calls fail, boot's catch branch
    // renders "Can't reach the VM" and never calls navigate() — so the country
    // tab stays inactive. We intercept `fetch` at the network layer so the
    // boot path gets valid-enough shapes and navigate('country') fires.
    await page.addInitScript(() => {
      const realFetch = window.fetch;
      const stubs: Record<string, unknown> = {
        '/api/data/facets': {
          countries: ['Germany'], bodies: [], themes: [], groups: [], sdgs: [],
          min_year: 2006, max_year: 2026, total_records: 0,
        },
        '/api/data/map':       { country_counts: [] },
        '/api/data/analytics': {
          trends: { yearly_body_counts: [] },
          themes: { theme_counts: [], body_counts: [] },
          text:   { affected_person_counts: [], sdg_counts: [] },
        },
        '/api/data/records':   { total_records: 0, records: [] },
        '/api/data/recordsCount': { total_records: 0 },
        '/api/data/health':    { modified_at: new Date().toISOString() },
      };
      (window as any).fetch = async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        for (const [path, body] of Object.entries(stubs)) {
          if (url.includes(path)) {
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        return realFetch(input, init);
      };
    });

    await page.goto('/dashboard.html#view=country&fc=DEU');
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });
    await expect(page.locator('a[role="tab"][data-nav="country"]')).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    const focus = await page.evaluate(() => ({
      focusCountry: state.focusCountry,
      view: state.view,
      tabCountryLabel: document.getElementById('tabCountry')?.textContent || '',
    }));
    expect(focus.focusCountry).toBe('DEU');
    expect(focus.view).toBe('country');
    expect(focus.tabCountryLabel).toContain('Germany');

    expect(errors, `JS errors during hash deep-link restore:\n${errors.join('\n')}`).toEqual([]);
  });

  test('10. cmdPalette — ⌘K opens palette, typing filters, Enter navigates', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    // Palette starts hidden.
    const palette = page.locator('#cmdPalette');
    await expect(palette).toHaveClass(/hidden/);

    // ⌘K / Ctrl+K — inline boot wires this keydown listener on document.
    // Use Meta+K (macOS convention used by the app; Control+K also works but
    // we want to exercise the primary binding).
    await page.keyboard.press('Meta+K');
    await expect(palette).not.toHaveClass(/hidden/, { timeout: 2000 });
    await expect(page.locator('#cmdInput')).toBeFocused();

    // Typing filters results. With empty facets state, VIEW + ACTION rows
    // are still populated — typing 'methodology' should match the
    // Methodology view tile.
    await page.keyboard.type('methodology');
    // The palette now always offers a full-text "Search…" action as the top
    // result (so ⌘K can search the corpus, not just jump), plus the matching
    // Methodology view tile — two results with empty facets.
    await expect(page.locator('#cmdResults .cmd-result')).toHaveCount(2, { timeout: 2000 });
    await expect(page.locator('#cmdResults .cmd-result .kind').first()).toHaveText('SEARCH');

    // Click the Methodology *view* result specifically (not the search action).
    // We click instead of pressing Enter because the Enter handler is inline's
    // keydown on document reading `window.__cmdResults[0].action()`.
    await page.locator('#cmdResults .cmd-result')
      .filter({ has: page.locator('.kind', { hasText: 'VIEW' }) })
      .filter({ hasText: 'Methodology' })
      .click();

    await expect(palette).toHaveClass(/hidden/, { timeout: 2000 });
    await expect(page.locator('a[role="tab"][data-nav="methodology"]')).toHaveAttribute('aria-selected', 'true', { timeout: 2000 });

    expect(errors, `JS errors during cmdk flow:\n${errors.join('\n')}`).toEqual([]);
  });

  test('11. railFilterChip — adding a country filter renders an active-filter chip', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    // Seed a filter directly and call the pipeline that updates UI. This
    // mirrors what the rail's country-facet onclick does: mutate
    // state.filters.country, then onFiltersChanged() → renderActiveFilters().
    await page.evaluate(() => {
      state.filters.country.add('Germany');
      // refreshHitCount reads from api.recordsCount (not api.records — that's
      // the paginated endpoint). Stub both in case boot primes something.
      api.recordsCount = async () => ({ total_records: 42, search_expansions: [] });
      api.records      = async () => ({ total_records: 42, records: [] });
      renderActiveFilters();
      return refreshHitCount();
    });

    const chipStrip = page.locator('#activeFilters');
    await expect(chipStrip).toContainText('Germany');
    // Stubbed recordsCount returns 42 — the visible user feedback we're after.
    await expect(page.locator('#hitCount')).toHaveText('42', { timeout: 2500 });

    expect(errors, `JS errors while updating rail chips:\n${errors.join('\n')}`).toEqual([]);
  });

  test('12. savedViewPersistence — svSave entry survives a reload', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    // Step 1: boot the app once to get svSave/svLoad on the realm, then
    // seed a saved view directly into localStorage under uhri_v2_saved_views.
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).svLoad === 'function', null, { timeout: 5000 });

    const entry = await page.evaluate(() => {
      const v = {
        id: 'sv_test_' + Date.now(),
        name: 'Smoke test · Germany country profile',
        created_at: Date.now(),
        hash: 'view=country&fc=DEU',
      };
      svSave([v]);
      return v;
    });

    // Step 2: reload without any hash. svLoad() on the new page should see
    // the entry we just persisted — that's the localStorage round-trip.
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).svLoad === 'function', null, { timeout: 5000 });
    const persisted = await page.evaluate(() => svLoad());
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(entry.id);
    expect(persisted[0].name).toBe(entry.name);
    expect(persisted[0].hash).toBe(entry.hash);

    // Step 3: applying the saved-view hash should restore focus + tab —
    // this is the user-visible payoff of persistence.
    await page.evaluate(async (hash) => {
      // Stub analytics so applying the hash (which ends with navigate) doesn't hang.
      api.analytics = async () => ({
        trends: { yearly_body_counts: [] },
        themes: { theme_counts: [], body_counts: [] },
        text:   { affected_person_counts: [], sdg_counts: [] },
      });
      api.records = async () => ({ total_records: 0, records: [] });
      await _applyRouteStateFromHash(hash, { replaceLocation: true });
    }, entry.hash);
    await expect(page.locator('a[role="tab"][data-nav="country"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3000 });
    const focusCountry = await page.evaluate(() => state.focusCountry);
    expect(focusCountry).toBe('DEU');

    expect(errors, `JS errors during saved-view persistence:\n${errors.join('\n')}`).toEqual([]);
  });

  test('14. m49RegionLookup — expandM49RegionsToCountries maps UN M49 regions to country names', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).expandM49RegionsToCountries === 'function', null, { timeout: 5000 });

    // The lookup is the keystone of the rail REGION filter — it's what lets
    // us show M49 5-region in the rail while the VM API speaks Treaty Body
    // electoral groups. A regression here silently breaks the filter (either
    // everything or nothing matches, depending on the bug). Spot-check a
    // handful of anchor countries across all 5 regions.
    const probe = await page.evaluate(() => {
      const expand = (keys: string[]) => {
        const out = expandM49RegionsToCountries(new Set(keys));
        return out ? Array.from(out) : null;
      };
      return {
        africa:   expand(['africa'])!.sort(),
        europe:   expand(['europe'])!.sort(),
        oceania:  expand(['oceania'])!.sort(),
        multi:    expand(['asia', 'oceania'])!.length,
        empty:    expand([]),
        unknown:  expand(['GRULAC'])!.length,   // stale Treaty Body key → empty bucket
      };
    });
    // Known anchors:
    expect(probe.africa).toContain('Kenya');
    expect(probe.africa).toContain('Egypt');            // Northern Africa now in Africa
    expect(probe.africa.length).toBeGreaterThanOrEqual(50);
    expect(probe.europe).toContain('Germany');
    expect(probe.europe).not.toContain('Turkey');       // Türkiye is M49 Western Asia
    expect(probe.europe.length).toBeGreaterThanOrEqual(40);
    expect(probe.oceania).toContain('Fiji');
    expect(probe.oceania).toContain('Samoa');           // Polynesia now covered
    expect(probe.multi).toBeGreaterThan(probe.oceania.length);  // asia + oceania > just oceania
    expect(probe.empty).toBeNull();                     // empty Set → null ("no filter")
    expect(probe.unknown).toBe(0);                      // unknown keys silently drop

    expect(errors, `JS errors during M49 probe:\n${errors.join('\n')}`).toEqual([]);
  });

  test('13. countryProfile — navigate("country") renders the profile view shell', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    // Seed focus + stub analytics so renderCountry has something to chew on
    // without reaching the VM. Analytics mock returns the minimum shape that
    // every profile-rendering code path reads (trends / themes / text).
    await page.evaluate(async () => {
      state.focusCountry = 'USA';
      const tab = document.getElementById('tabCountry');
      if (tab) tab.textContent = 'United States of America';
      api.analytics = async () => ({
        trends: { yearly_body_counts: [{ year: 2020, body: 'UPR', count: 10 }] },
        themes: { theme_counts: [{ theme: 'Torture', count: 5 }], body_counts: [] },
        text:   {
          affected_person_counts: [{ affected_person: 'Women', count: 3 }],
          sdg_counts: [{ sdg: 'SDG 16', count: 2 }],
        },
      });
      api.records = async () => ({ total_records: 1, records: [] });
      await navigate('country');
    });

    // The country tab becomes active + the view-country section becomes visible.
    // We don't assert granular panel contents — they depend on renderRowList
    // internals. The SHELL rendering is what we care about here.
    await expect(page.locator('a[role="tab"][data-nav="country"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-country')).not.toHaveClass(/hidden/, { timeout: 3000 });
    await expect(page.locator('#view-overview')).toHaveClass(/hidden/);

    expect(errors, `JS errors while rendering country profile:\n${errors.join('\n')}`).toEqual([]);
  });

  test('17. landingNameToIso3 — every canonical country name resolves to ISO3', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    /* Regression: landing's _nameToIso3 used to consult only a 40-entry
       variant dict — any country whose API display-name wasn't in that
       short list returned null and got DROPPED from the live hex-colour
       map.  Fix widened the lookup with a lazily-built HEX_LAYOUT index
       (198 canonical names).  This test confirms a representative
       selection of previously-failing names resolves, AND that known
       variant spellings still work via the tight dict. */
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof (window as any).__nameToIso3 === 'function', null, { timeout: 5000 });

    const probe = await page.evaluate(() => {
      // Previously FAILING (plain English, not in the 40-entry dict):
      const plain = ['Albania','Argentina','Benin','Nepal','Fiji','Andorra','Barbados','Kenya','Egypt','Ghana'];
      // Known variant forms that must still resolve (shorter / alt spellings):
      const variants = ['Russia','Turkey','United States','Moldova','Tanzania','Vietnam'];
      // Observer-state asterisks (OHCHR decoration — must be stripped before lookup):
      const asterisks = ['State of Palestine*', 'Kosovo*'];
      // Deliberately unknown name → null
      const unknown = ['Atlantis','Westeros'];
      const mk = (names: string[]) => names.map(n => [n, (window as any).__nameToIso3(n)]);
      return {
        plain: mk(plain),
        variants: mk(variants),
        asterisks: mk(asterisks),
        unknown: mk(unknown),
      };
    });

    for (const [name, iso] of probe.plain) {
      expect(iso, `plain name "${name}" should resolve`).toBeTruthy();
      expect((iso as string).length).toBe(3);
    }
    for (const [name, iso] of probe.variants) {
      expect(iso, `variant "${name}" should resolve`).toBeTruthy();
    }
    // Asterisk stripping — Palestine must map to PSE even with the OHCHR "*"
    const pseEntry = probe.asterisks.find(([n]) => n === 'State of Palestine*')!;
    expect(pseEntry[1], 'State of Palestine* should resolve to PSE').toBe('PSE');
    for (const [name, iso] of probe.unknown) {
      expect(iso, `unknown "${name}" should return null`).toBeNull();
    }

    expect(errors, `JS errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('16. rawModeBanner — RAW toggle doesn\'t collapse the grid layout', async ({ page, viewport }) => {
    /* This test asserts the desktop 3-column grid layout (rail | main |
       drawer) doesn't collapse when raw-mode adds a top banner.  On
       mobile (<960 px viewport) the layout is intentionally
       single-column with rail in display:none until .mobile-open is
       added — none of the assertions below apply.  Skip on narrow
       viewports rather than rewrite the test for two layouts; the
       mobile-specific raw-mode contract is its own future test. */
    if (viewport && viewport.width < 960) {
      test.skip();
      return;
    }

    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    /* The raw-mode banner used to steal the first grid column from the
       rail (it's a direct child of .app, which is `grid-template-columns:
       rail-w 1fr drawer-w`).  Toggling RAW-upstream mode pushed the
       rail / main / drawer to wrong slots and the whole layout looked
       broken.  Regression test: enter raw-mode, assert rail/main/drawer
       all start at x=0, x=rail-end, and x=main-end respectively — i.e.
       the banner spans row 1 and the three real columns fall into row 2
       intact. */
    const boxes = await page.evaluate(() => {
      document.getElementById('app')?.classList.add('raw-mode');
      const rail   = document.getElementById('rail')?.getBoundingClientRect();
      const main   = document.querySelector('.main')?.getBoundingClientRect();
      const drawer = document.querySelector('.drawer')?.getBoundingClientRect();
      const banner = document.querySelector('.raw-banner')?.getBoundingClientRect();
      return {
        rail:   rail   ? { x: rail.x,   y: rail.y,   w: rail.width,   h: rail.height }   : null,
        main:   main   ? { x: main.x,   y: main.y,   w: main.width,   h: main.height }   : null,
        drawer: drawer ? { x: drawer.x, y: drawer.y, w: drawer.width, h: drawer.height } : null,
        banner: banner ? { x: banner.x, y: banner.y, w: banner.width, h: banner.height } : null,
      };
    });

    expect(boxes.rail).not.toBeNull();
    expect(boxes.main).not.toBeNull();
    expect(boxes.drawer).not.toBeNull();
    expect(boxes.banner).not.toBeNull();

    // Banner is a full-width row at the top.
    const banner = boxes.banner!;
    expect(banner.w).toBeGreaterThan(600);   // spans most of viewport
    expect(banner.h).toBeLessThan(60);       // thin strip, not a column

    // Rail, main, drawer are in the SECOND row — all below the banner.
    const rail = boxes.rail!, main = boxes.main!, drawer = boxes.drawer!;
    expect(rail.y).toBeGreaterThanOrEqual(banner.y + banner.h - 1);
    expect(main.y).toBeCloseTo(rail.y, 0);     // main aligned with rail top
    expect(drawer.y).toBeCloseTo(rail.y, 0);   // drawer too

    // Columns ordered left-to-right: rail, main, drawer.
    expect(main.x).toBeGreaterThan(rail.x + rail.w - 2);
    expect(drawer.x).toBeGreaterThan(main.x + main.w - 2);

    expect(errors, `JS errors in raw-mode layout probe:\n${errors.join('\n')}`).toEqual([]);
  });

  test('15. uhriXlsxMapper — UHRI xlsx row → canonical record shape', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any)._uhriRowToRecord === 'function', null, { timeout: 5000 });

    // Hand-crafted row mimicking an actual UHRI xlsx export — same column
    // names (including the "Reccomending Body" typo), "- " prefixes,
    // \n-separated multi-values, Excel-date-serial in the date fields.
    // This is the smallest reliable fixture that exercises every quirk
    // of the UHRI xlsx format our parser claims to handle.
    const out = await page.evaluate(() => {
      const mockRow = {
        'Text': 'Rural women 49.The Committee notes with concern',
        'Countries Concerned': '- Iraq',
        'Reccomending Body': '- CEDAW',
        'Document Symbol': 'CEDAW/C/IRQ/CO/8',
        'Themes': '- Equality & non-discrimination\n- Discrimination against women\n- Land & property rights',
        'Affected Persons': '- Persons living in rural areas\n- Women & girls',
        'Sdgs': '- 1.4 - Equal rights to economic resources\n- 16.3 - Promote the rule of law',
        'Document Publication Date': '46078',     // Excel date serial
        'UPR Reccomending States': '',
        'UPR Position': '',
        'Type': '- Concerns/Observations',
        'OHCHR Annotation Id': 'b4288060-6633-478d-9a9a-df1978d336c3',
        'UPR Session': '',
        'Regions Concerned': '- Asia-Pacific',
        'Recommending Regions': '',
        'Date of publication on UHRI': '46125.4996282407',
      };
      return _uhriRowToRecord(mockRow);
    });

    // Core identifiers + primitives:
    expect(out.AnnotationId).toBe('b4288060-6633-478d-9a9a-df1978d336c3');
    expect(out.Symbol).toBe('CEDAW/C/IRQ/CO/8');
    // "- " prefix stripped on single-value fields:
    expect(out.Body).toBe('CEDAW');
    expect(out.AnnotationType).toBe('Concerns/Observations');
    // Array fields: \n-split + "- " stripped + empty filtered:
    expect(out.Countries).toEqual(['Iraq']);
    expect(out.Themes).toEqual(['Equality & non-discrimination', 'Discrimination against women', 'Land & property rights']);
    expect(out.AffectedPersons).toEqual(['Persons living in rural areas', 'Women & girls']);
    expect(out.Sdgs).toEqual(['1.4 - Equal rights to economic resources', '16.3 - Promote the rule of law']);
    expect(out.Regions).toEqual(['Asia-Pacific']);
    // Excel date serial → ISO — 46078 ≈ March 2026:
    expect(out.PublicationDate).toMatch(/^2026-\d\d-\d\d$/);
    // Text is duplicated into both Text and TextPlainCleaned (dashboard
    // readers consult either).
    expect(out.Text).toContain('Rural women');
    expect(out.TextPlainCleaned).toContain('Rural women');

    expect(errors, `JS errors during UHRI xlsx mapper probe:\n${errors.join('\n')}`).toEqual([]);
  });

  test('18. readingModeResize — A-/A+ changes drawer text size in read mode', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    await page.evaluate(() => {
      const rec = {
        AnnotationId: 'smoke-reading-size-1',
        PublicationDate: '2025-01-15',
        Countries: ['Poland'],
        Regions: ['Eastern Europe'],
        Body: 'Human Rights Committee',
        Themes: ['Access to justice & remedy'],
        AffectedPersons: ['Women'],
        Sdgs: ['SDG 16.3'],
        Symbol: 'CCPR/C/XYZ/1',
        AnnotationType: 'Recommendations',
        TextPlainCleaned: 'This is a long enough paragraph to make drawer reading mode meaningful and to expose the effective font size on the live .dr-text node.',
      };
      state.selectedRec = rec;
      state.currentResultList = [rec];
      state.currentResultIndex = 0;
      state.drawerMode = 'record';
      state.drawerList = null;
      renderDrawer();
    });

    const sizeBefore = await page.locator('#drawerBody .dr-text').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await page.locator('#drawerReadingMode').click();
    await page.locator('#drFontUp').click();
    const sizeAfterUp = await page.locator('#drawerBody .dr-text').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await page.locator('#drFontDown').click();
    const sizeAfterDown = await page.locator('#drawerBody .dr-text').evaluate(el => parseFloat(getComputedStyle(el).fontSize));

    expect(sizeAfterUp).toBeGreaterThan(sizeBefore);
    expect(sizeAfterDown).toBeLessThanOrEqual(sizeAfterUp);
    expect(errors, `JS errors during reading-mode resize:\n${errors.join('\n')}`).toEqual([]);
  });

  test('19. methodologyToc — methodology jump-nav renders and trimmed copy stays gone', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html', { waitUntil: 'commit' });
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    await page.evaluate(async () => {
      await navigate('methodology');
    });

    const view = page.locator('#view-methodology');
    await expect(view.locator('.me-toc')).toBeVisible();
    await expect(view).not.toContainText('If you need the full 267,548');
    await expect(view).not.toContainText('experimental preview alongside the production dashboard');

    await view.locator('[data-meto-jump="me-search-semantics"]').click();
    await page.waitForFunction(() => {
      const target = document.getElementById('me-search-semantics');
      const main = document.querySelector('.main');
      if (!target || !main) return false;
      const dy = target.getBoundingClientRect().top - main.getBoundingClientRect().top;
      return dy >= 0 && dy < 160;
    }, null, { timeout: 4000 });

    expect(errors, `JS errors during methodology TOC flow:\n${errors.join('\n')}`).toEqual([]);
  });

  test('20. readingModeRailRestore — exiting read mode restores rail even from legacy saved tweaks', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.addInitScript(() => {
      localStorage.setItem('uhri_v2_tw', JSON.stringify({
        palette: 'archive',
        density: 'tight',
        rail: false,
        drawer: true,
        _preReadingRail: true,
      }));
    });
    await page.goto('/dashboard.html', { waitUntil: 'commit' });
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    await page.evaluate(() => {
      const rec = {
        AnnotationId: 'smoke-reading-rail-restore',
        PublicationDate: '2025-01-15',
        Countries: ['Poland'],
        Regions: ['Eastern Europe'],
        Body: 'Human Rights Committee',
        Themes: ['Access to justice & remedy'],
        AffectedPersons: ['Women'],
        Sdgs: ['SDG 16.3'],
        Symbol: 'CCPR/C/XYZ/1',
        AnnotationType: 'Recommendations',
        TextPlainCleaned: 'Reading mode should hide the rail temporarily and restore it when exiting.',
      };
      state.selectedRec = rec;
      state.currentResultList = [rec];
      state.currentResultIndex = 0;
      state.drawerMode = 'record';
      state.drawerList = null;
      renderDrawer();
    });

    await page.locator('#drawerReadingMode').click();
    await expect(page.locator('#app')).toHaveClass(/reading-mode/);
    await page.locator('#drawerReadingMode').click();
    await expect(page.locator('#app')).not.toHaveClass(/reading-mode/);

    const railState = await page.evaluate(() => {
      const app = document.getElementById('app');
      const saved = JSON.parse(localStorage.getItem('uhri_v2_tw') || '{}');
      return {
        appClass: app?.className || '',
        railClosed: !!app?.classList.contains('rail-closed'),
        railToggleText: document.getElementById('railTog')?.textContent || '',
        savedRail: saved.rail,
        savedPreReadingRail: saved._preReadingRail,
      };
    });

    expect(railState.railClosed).toBe(false);
    expect(railState.railToggleText).toContain('ON');
    expect(railState.savedRail).toBe(true);
    expect(railState.savedPreReadingRail).toBeUndefined();
    expect(errors, `JS errors during reading-mode rail restore:\n${errors.join('\n')}`).toEqual([]);
  });

  test('21. aboutTab — About view renders, footer link navigates, methodology no longer owns citation/ack/labels copy', async ({ page }) => {
    /* Added with the 2026-04-23 IA split: Methodology shrank from 13 to
       7 sections; Citation / Acknowledgements / Caveats / Labels-workspace
       moved to a dedicated About tab (and Labels how-it-works moved into
       the Labels tab itself).  This test pins each of those moves so we
       don't accidentally re-bloat Methodology during a future "just add
       one section" edit. */
    const errors = collectConsoleErrors(page);
    // Pre-set consent so the bottom-fixed GA banner doesn't intercept
    // pointer events on the dash-footer below it (mobile-only blocker;
    // identical pattern in tab-walk.spec.ts footer test).
    await page.addInitScript(() => localStorage.setItem('uhri-ga-consent', 'denied'));
    await page.goto('/dashboard.html', { waitUntil: 'commit' });
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });

    // Footer <a data-nav="about"> must fire navigate('about') via the
    // global delegated handler (no href attribute — click-to-navigate).
    await page.locator('.dash-footer .disclaimer').click();

    const aboutView = page.locator('#view-about');
    await expect(aboutView).toBeVisible();
    await expect(aboutView.locator('h1')).toContainText(/About/i);
    // Content that moved OUT of Methodology should live here now:
    await expect(aboutView).toContainText(/Citation/i);
    await expect(aboutView).toContainText(/Acknowledgements/i);
    await expect(aboutView).toContainText(/Szoszkiewicz/);
    await expect(aboutView).toContainText(/re:constitution/);

    // And must NOT remain in Methodology — these headings are gone.
    await page.evaluate(() => navigate('methodology'));
    const method = page.locator('#view-methodology');
    await expect(method.locator('h2', { hasText: 'Citation' })).toHaveCount(0);
    await expect(method.locator('h2', { hasText: 'Acknowledgements' })).toHaveCount(0);
    await expect(method.locator('h2', { hasText: 'Architecture' })).toHaveCount(0);
    await expect(method.locator('h2', { hasText: 'Labels workspace' })).toHaveCount(0);

    // Labels tab picks up the collapsible how-it-works panel.
    await page.evaluate(() => navigate('labels'));
    const labels = page.locator('#view-labels');
    await expect(labels.locator('details.rules-howto')).toHaveCount(1);
    await expect(labels.locator('details.rules-howto summary')).toContainText(/How the Labels workspace works/i);

    expect(errors, `JS errors during About tab flow:\n${errors.join('\n')}`).toEqual([]);
  });

  test('22. keyboardFocus — reader is a focus-trapped dialog; slider + chips are keyboard-operable', async ({ page }) => {
    /* Sprint 3 (keyboard/focus parity): the Reader modal must declare dialog
       semantics, move focus in on open, and restore focus to the opener on
       Escape; the year-slider handles must be real ARIA sliders driven by
       arrow keys. Pins these so a future refactor can't silently regress
       keyboard access for the core read + filter actions. */
    const errors = collectConsoleErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).openReader === 'function', null, { timeout: 5000 });

    // --- Reader: dialog semantics + focus move-in ---
    await page.evaluate(() => {
      const rec = {
        AnnotationId: 'kbd-1', PublicationDate: '2024-01-01', Countries: ['Poland'],
        Regions: ['Eastern Europe'], Body: 'CAT', Themes: ['Torture'], AffectedPersons: ['Women'],
        Sdgs: ['SDG 16.3'], Symbol: 'CAT/C/POL/CO/7', AnnotationType: 'Recommendations',
        SectionHeadings: ['Test'], TextPlainCleaned: '23. The Committee recommends keyboard access.',
      };
      state.selectedRec = rec; state.currentResultList = [rec]; state.currentResultIndex = 0;
      state.drawerMode = 'record'; state.drawerList = null;
      renderDrawer();
      document.getElementById('drOpen')?.focus();   // known opener focus
      openReader(rec);
    });
    const reader = page.locator('#reader');
    await expect(reader).toHaveAttribute('role', 'dialog');
    await expect(reader).toHaveAttribute('aria-modal', 'true');
    const focusInReader = await page.evaluate(() =>
      !!document.activeElement && !!document.getElementById('reader')?.contains(document.activeElement));
    expect(focusInReader, 'focus should move into the reader on open').toBe(true);

    // Escape closes the reader AND restores focus to the opener (#drOpen).
    await page.keyboard.press('Escape');
    await expect(reader).toHaveClass(/hidden/);
    const focusRestored = await page.evaluate(() => document.activeElement?.id);
    expect(focusRestored, 'focus should return to the element that opened the reader').toBe('drOpen');

    // --- Year slider: ARIA slider + arrow-key drives the bound value ---
    const slider = await page.evaluate(() => {
      state.facets = { ...(state.facets || {}), min_year: 2006, max_year: 2026 };
      state.filters.yearA = 2006; state.filters.yearB = 2026;
      bindYearSlider(2006, 2026);
      bindYearSlider(2006, 2026); // rebinding must replace, not accumulate, listeners
      const a = document.getElementById('ysA')!;
      const role = a.getAttribute('role');
      const valuemin = a.getAttribute('aria-valuemin');
      a.focus();
      a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      return { role, valuemin, yearA: state.filters.yearA };
    });
    expect(slider.role).toBe('slider');
    expect(slider.valuemin).toBe('2006');
    expect(slider.yearA, 'ArrowRight should advance the start year by one').toBe(2007);

    expect(errors, `JS errors during keyboard/focus test:\n${errors.join('\n')}`).toEqual([]);
  });

  test('23. profileSwitchers — baseline catalogs survive filtered analytics and clear-all races', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).renderSDG === 'function', null, { timeout: 5000 });

    const pickers = await page.evaluate(() => {
      state.baselineAnalytics = {
        themes: { theme_counts: [
          { theme: 'Health', count: 120 }, { theme: 'Education', count: 80 },
        ] },
        text: {
          affected_person_counts: [
            { affected_person: 'Women', count: 90 }, { affected_person: 'Children', count: 70 },
          ],
          sdg_counts: [
            { sdg: '16 - PEACE, JUSTICE AND STRONG INSTITUTIONS', count: 140 },
            { sdg: '4 - QUALITY EDUCATION', count: 60 },
          ],
        },
      };
      state.analytics = { themes: { theme_counts: [] }, text: { affected_person_counts: [], sdg_counts: [] } };
      state.facets = { ...(state.facets || {}), sdgs_hierarchy: [] };

      state.focusTheme = 'Health'; renderTheme();
      const themes = Array.from(document.querySelectorAll('#thSelect option')).map(o => o.value);
      state.focusGroup = 'Women'; renderGroup();
      const groups = Array.from(document.querySelectorAll('#gpSelect option')).map(o => o.value);
      state.focusSdg = '16 - PEACE, JUSTICE AND STRONG INSTITUTIONS'; renderSDG();
      const sdgs = Array.from(document.querySelectorAll('#spSelect option')).map(o => o.value);
      const sdgGoalGroups = document.querySelectorAll('#spSelect optgroup').length;
      const filter = document.querySelector('#spFilter') as HTMLInputElement;
      filter.value = 'justice';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
      const typeahead = document.querySelector('#spResults')?.textContent || '';
      return { themes, groups, sdgs, sdgGoalGroups, typeahead };
    });

    expect(pickers.themes).toEqual(['Health', 'Education']);
    expect(pickers.groups).toEqual(['Women', 'Children']);
    expect(pickers.sdgGoalGroups).toBe(17);
    expect(pickers.sdgs.length).toBeGreaterThan(100);
    expect(pickers.sdgs).toContain('SDG 16');
    expect(pickers.sdgs).toContain('SDG 5.2');
    expect(pickers.typeahead.toLowerCase()).toContain('justice');
  });

  test('24. profileTimelineHeadroom — profile peaks stay clear of the top edge', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).renderTimeline === 'function', null, { timeout: 5000 });
    const minPeakY = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      renderTimeline(host, [{ year: 2020, body: 'UPR', count: 100 }], {
        interactive: false, stackBy: 'family', yHeadroom: 1.15,
      });
      const points = host.querySelector('polygon')?.getAttribute('points') || '';
      const ys = points.split(/\s+/).map(point => Number(point.split(',')[1])).filter(Number.isFinite);
      host.remove();
      return Math.min(...ys);
    });
    expect(minPeakY).toBeGreaterThan(30);
  });

  test('25. sdgProfileScope — switching target filters every profile request', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => typeof (globalThis as any).renderSDG === 'function', null, { timeout: 5000 });
    const calls = await page.evaluate(async () => {
      const seen: { kind: string; sdgs: string | null }[] = [];
      state.filters = { ...emptyFilters(), yearA: 2006, yearB: 2026 };
      state.facets = { ...(state.facets || {}), min_year: 2006, max_year: 2026, sdgs_hierarchy: [] };
      state.focusSdg = 'SDG 5.2';
      state.view = 'sdg';
      state.baselineAnalytics = {
        themes: { theme_counts: [] },
        text: { affected_person_counts: [], sdg_counts: [] },
      };
      api.profile = async () => {
        seen.push({ kind: 'profile', sdgs: null });
        throw new Error('bundled profile must not be used for SDGs');
      };
      api.analytics = async (filter) => {
        seen.push({ kind: 'analytics', sdgs: buildParams(filter).get('sdgs') });
        return {
          themes: { theme_counts: [] }, text: { affected_person_counts: [], sdg_counts: [] },
          trends: {
            yearly_body_counts: [{ year: 2024, body: 'UPR', count: 7 }],
            dataset_first_publication_date: '2024-01-01', dataset_last_publication_date: '2024-12-31',
          },
        };
      };
      api.map = async (filter) => {
        seen.push({ kind: 'map', sdgs: buildParams(filter).get('sdgs') });
        return { country_counts: [] };
      };
      api.records = async (filter) => {
        seen.push({ kind: 'records', sdgs: buildParams(filter).get('sdgs') });
        return { total_records: 7, records: [] };
      };
      await renderSDG();
      return seen;
    });

    expect(calls.some(call => call.kind === 'profile')).toBe(false);
    expect(calls.filter(call => call.kind !== 'profile').map(call => call.sdgs)).toEqual([
      'SDG 5.2', 'SDG 5.2', 'SDG 5.2',
    ]);
  });

});
