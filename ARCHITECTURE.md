# UHRI Dashboard — Architecture

A map of the vanilla-JS, zero-build, module-per-file dashboard that ships
as `gh-pages`.

Last updated: 2026-04-22 (commit `7f089d5`).

---

## TL;DR

One HTML page (`dashboard.html`) plus 16 sibling `dashboard-*.js` modules.
No bundler, no framework, no TypeScript. Every script is a classic
non-module `<script>` — top-level declarations share the same global
realm by bare-name lookup, which is the seam that makes the
extraction work without an `import/export` graph.

```
dashboard.html (3743 lines)
├── <style> ..............................  ~1150 lines CSS
├── <body> ...............................    DOM shell
├── <script src="./dashboard-helpers.js">      ─┐
├── <script src="./dashboard-data.js">         │
├── <script src="./dashboard-route.js">        │
├── <script src="./dashboard-offline.js">      │
├── <script src="./dashboard-utils.js">        │
├── <script src="./dashboard-labels.js">       │
├── <script src="./dashboard-ui.js">           │ load order
├── <script src="./dashboard-timeline.js">     │ matters for
├── <script src="./dashboard-map.js">          │ constants,
├── <script src="./dashboard-search.js">       │ not for
├── <script src="./dashboard-filters.js">      │ functions
├── <script src="./dashboard-years.js">        │ (lazy-looked-up)
├── <script src="./dashboard-profiles.js">     │
├── <script src="./dashboard-methodology.js">  │
├── <script src="./dashboard-drawer-list.js">  │
├── <script src="./dashboard-reader.js">       ─┘
└── <script> ... inline spine ... </script>   ~1965 lines JS
```

History: `dashboard.html` was 9638 lines inline in early April 2026;
a series of seam-splits (P1..P3, commits `a08ce4a` → `7f089d5`)
dropped it to **3743 lines (-61 %)** across 16 external modules.

---

## Why this shape (and not ES modules / bundler)

- **GitHub Pages, no build step.** The whole directory is served as-is.
  Adding `esbuild`/`vite` would require `npm run build` before every
  deploy and would mask the actual browser runtime behaviour.
- **Non-module globals are a feature, not a bug, here.** The existing
  inline spine already reaches into the module graph by bare names
  (`renderTimeline`, `applyTweaks`, `state`). Converting to ES modules
  would require rewriting every call site — and still end up going
  through `window.*` stubs to keep inline working. Not worth it today.
- **Pro tempore.** When a build step does get adopted (e.g. for Vite
  HMR in dev), the module boundaries already established here are the
  seams to convert — each module's header documents exactly what it
  consumes and exposes.

---

## Load order

The `<script>` tags in `dashboard.html` (lines 1759‑1774) run top-down,
synchronously, before the inline spine. Every module is a classic
script — `function` and top-level `const`/`let` declarations attach to
the shared global scope and stay visible to everything that loads
later (and to anything that references them *lazily* from anywhere).

| # | Module | Lines | Depends on |
|--:|--------|------:|------------|
| 1 | `dashboard-helpers.js` | 368 | — (pure) |
| 2 | `dashboard-data.js` | 313 | 1 |
| 3 | `dashboard-route.js` | 143 | 1, 2 |
| 4 | `dashboard-offline.js` | 562 | 1, 2 |
| 5 | `dashboard-utils.js` | 928 | 1, 2 |
| 6 | `dashboard-labels.js` | 1305 | 1, 2, 4, 5 |
| 7 | `dashboard-ui.js` | 393 | 1, 2 |
| 8 | `dashboard-timeline.js` | 520 | 1, 2 |
| 9 | `dashboard-map.js` | 833 | 1, 2 |
| 10 | `dashboard-search.js` | 540 | 1, 2, 5 |
| 11 | `dashboard-filters.js` | 160 | 1, 2 |
| 12 | `dashboard-years.js` | 66 | 1, 2 |
| 13 | `dashboard-profiles.js` | 1067 | 1, 2, 5, 8, 9 |
| 14 | `dashboard-methodology.js` | 160 | — (minimal) |
| 15 | `dashboard-drawer-list.js` | 425 | 1, 2, 5 |
| 16 | `dashboard-reader.js` | 367 | 1, 2, 5 |
| — | *inline* `<script>` | ~1965 | everything |
| | **total** | **~8150** | |

Ordering beyond "helpers first, data second" rarely matters at runtime
because cross-module calls happen inside function bodies (lazy).
Constants used at top-level evaluation — e.g. `HEX_LAYOUT` referenced
by `dashboard-map.js` when building `NAME_RECONCILER` — are the only
case where order is load-bearing.

---

## Module reference

### `dashboard-helpers.js` — pure helpers and shared constants

Loaded **first**. Zero runtime state. Everything here is either
stateless or uses `state.*` lazily (inside function bodies / default
params) so it is safe to define before `state` itself exists.

- **Constants**
  `NAME_TO_ISO`, `ISO_TO_NAME`, `ISO2_TO_NAME`, `MAP_LAYOUT`,
  `SDG_NAMES`, `SDG_TARGET_NAMES`, `MECH_FAMILIES`
- **DOM + string helpers**
  `$`, `$$`, `fmt`, `pct`, `cssVar`, `debounce`, `sanitize`,
  `escapeRegex`
- **Data cleaners**
  `cleanLabel`, `cleanAnnotationType`, `inferAnnotationType` (+
  `_TYPE_CACHE`), `cleanCountryName`, `cleanCountryList`
- **Filter factory**
  `emptyFilters()`
- **SDG rule-building (lazy `state.filters` defaults)**
  `formatSdgLabel`, `_sdgToFilterValue`, `_sdgTargetKey`,
  `_sdgCanonicalExactValue`, `_sdgExactValues`, `_sdgParamValues`,
  `_hasSdgFilters`, `_sdgMatchesExactFilter`,
  `_recordMatchesSdgFilters`, `_sdgToggleFilter`,
  `_sdgOverrideForValue`

### `dashboard-data.js` — state, API client, SWR cache

Shared mutable application state, the fetch client against the VM
API, and a localStorage SWR layer (5-min TTL) for facets / map /
analytics / records responses. Also owns the bundled-profile
`/api/data/profile` 404 fallback flag used by drawer-list and
profile renderers.

- `state` (shared mutable), `api`, `API_BASE`, `apiGet`
- SWR: `swrGetStale`, `swrPut`, `swr`, `_swr*` internals
- `_loadProfile`, `_isBundledProfileUnavailable`, `_railIsEmpty`
- In-memory per-session cache: `memCache`, `memGet`, `memSet`,
  `cacheKey`, `buildParams`

### `dashboard-route.js` — URL hash as single source of truth

Tiny (143 lines). Reads `#view=…&country=…&compareA=…&sort=…&kw=…` on
boot, writes it on every navigate / filter change. `_applyRouteStateFromHash`
is the backbone of the browser back/forward UX.

- `_pushUrlState`, `_applyRouteStateFromHash`, `_restoreUrlState`
- `_syncRouteTabLabels`, `_resetRouteState`

### `dashboard-offline.js` — in-memory dataset layer

When the user hits ⚡ *Instant Mode*, the full dataset is loaded into
IndexedDB and subsequent queries run client-side. This module:

- Aggregates facets / map / analytics / records from the in-memory
  array using the same filter semantics as the VM API.
- Persists and rehydrates the dataset through IndexedDB
  (`idbOffline`, `loadOfflineFromIDB`, `runOfflineDownload`).
- Drives the offline-status badge and context menu.

Surface: `offline` (mutable state), `runOfflineDownload`,
`showOfflineModal`, `showOfflineContextMenu`, `loadOfflineFromIDB`,
`updateOfflineBadge`.

### `dashboard-utils.js` — user artifacts + shared render helpers

The grab-bag module for anything that persists user intent:

- **Saved views** (#6a): `svLoad`, `svSave`, `openSavedViewsModal`,
  `describeCurrentState`
- **Share / report**: `openShareModal`, `openReportModal`,
  `parseOhchrUrl`, `applyOhchrUrlFilters`, `triggerUpload`
- **Bookmarks**: `BM_KEY`, `bmLoad`, `bmSave`, `bmHas`, `bmToggle`
- **Notes** (not listed above — see `notesLoad`/`noteHas` inside)
- **Diff tray**: `diffPinToggle`, `_renderDiffTray`,
  `diffIsPinned`
- **KWIC + highlight**: `_kwTokens`, `highlightKeyword`,
  `countMatches`, `_findBestCluster`
- **Sparklines**: `buildSparklineSVG`, `updateSparklineCaches`,
  per-facet caches, `preloadCountryOnHover`, `attachPreloadHover`,
  `backfillCountrySparklines`
- **XLSX export**: `ensureXLSX` (lazy CDN load), `exportXLSXFromRows`

### `dashboard-labels.js` — 🧪 Labels workspace (boolean FTS5 rule builder)

Self-contained β feature: define labels as `MUST / AND / NOT` term
lists, compile to FTS5, preview with ⚡ *Suggest terms* (TF-IDF over
user-tagged sample), coverage analytics, CSV export of the
records × rules matrix.

Surface exposed back to inline:
- `renderRules()` — the view's render entry point
  (called from `navigate('labels')`).

Internal: 30+ `rules*` and `lab*` functions, `RULES_*` constants,
`RULES_STARTER_TEMPLATES`.

### `dashboard-ui.js` — chrome: ⌘K palette, tweaks, onboarding tour

Three loosely related UI affordances bundled because they all reach
back into inline for `toast`, `navigate`, and share openers.

- **Command palette**: `openPalette`, `closePalette`, `renderPalette`
- **Tweaks** (shared mutable `TW`): `applyTweaks`, `loadTweaks`,
  `setPalette`, `cyclePalette`, `setDensity`, `toggleRail`,
  `toggleDrawer`, `openTweaks`, `closeTweaks`, `toggleTweaks`,
  `bindTweaks`
- **Reading mode**: `toggleReadingMode`, `bumpReadingFontSize`,
  `_applyReadingFontSize`
- **Tour**: `startTour`, `maybeShowTour`, `TOUR_STEPS`

`TW` is a shared mutable object — inline `renderDrawer` reads and
writes `TW.drawer` when a selection opens. The `const` binding is
declared here but lives in the shared script realm.

### `dashboard-timeline.js` — stacked-area year × body chart

One renderer, seven surfaces (Overview FIG.04, Compare A/B, five
profile pages). Cross-chart sync registry (`_tlSyncRegistry`) mirrors
the hovered year between paired timelines in Compare mode.

Surface: `renderTimeline`, `_renderStackToggle`, `getTimelineMode`,
`setTimelineMode`, `_wireTimelineTooltip`.

### `dashboard-map.js` — world map (hex + choropleth + legacy grid)

Dispatcher + three renderers. Hex is the default; choropleth lazy-
loads `d3-geo@3` + `topojson-client@3` from skypack on first use and
falls back to hex on failure. Also owns the SVG export handler for
the overview map panel.

Surface: `renderMap` (dispatcher), `getMapMode`, `setMapMode`,
`exportMapAsSVG`. Internal hex layout data: `HEX_LAYOUT` (87 entries),
`NAME_RECONCILER` (long-form → world-atlas name mapping).

### `dashboard-search.js` — full-text search view

Infinite scroll via `IntersectionObserver`, KWIC snippets, bulk
selection (bookmark / pin-to-diff / export-CSV).

Surface: `renderSearch` (entry point). Internal: `smartSnippet`,
`_renderSearchItem`, `loadNextSearchPage`, `_seBulk*`,
`_seToggleSelect`, `_seUpdateBreakdown`.

### `dashboard-filters.js` — rail feedback + hit-count pipeline

Low-risk self-contained plumbing: renders the active-filter chip
strip under the top bar, debounces the hit-count fetch and the
view refresh when the user clicks a facet in the rail.

Surface: `onFiltersChanged`, `refreshHitCount`, `refreshCurrentView`,
`renderActiveFilters`. Internal: slow-load banner helpers,
debounced announcers.

### `dashboard-years.js` — year slider + histogram

Smallest module (66 lines). Owns the left-rail year-range control
including the histogram drawn behind the slider handles.

Surface: `bindYearSlider`, `_renderYearHistogram`.

### `dashboard-profiles.js` — Country / Theme / Group / SDG / Mechanism / Compare

Largest remaining render seam (1067 lines). Owns five profile tabs
plus the A-vs-B Compare view. Heavy dependency on `renderTimeline`,
`_renderStackToggle` (from timeline module) and `renderRowList`
(still inline).

Surface: `renderCountry`, `renderTheme`, `renderGroup`, `renderSDG`,
`renderMechanism`, `renderCompare`, `_wireScopeBar`,
`_resolveCompareDefaults`, `_persistCompareChoice`,
`CMP_A_KEY`, `CMP_B_KEY`.

### `dashboard-methodology.js` — Methodology tab + freshness card

Static view + live dataset-health card polling
`/api/data/health` and `/refresh_status.json` for pipeline stage
status + "days since last pull".

Surface: `renderMethodology`, `renderFreshnessCard`.

### `dashboard-drawer-list.js` — drawer list mode

When you click a theme / group / SDG / country / body row, the
drawer flips to list mode and paginates records matching *rail
filters ∩ clicked entity*. Owns infinite scroll inside the drawer
and the drawer-list CSV export.

Surface: `openListDrawer`, `closeListDrawer`,
`openSelectionDrawer`, `refreshSelectionDrawer`,
`renderDrawerListMode`, `loadMoreListDrawer`, `_exportDrawerList`,
`_replaceSdgFilters`, `listDrawerFilter`, `_LIST_KIND_LABEL`.

### `dashboard-reader.js` — reader modal + citation exports + drawer render

Render of the single-record drawer + the full-screen reader modal,
plus all five citation formats.

Surface: `renderDrawer`, `openReader`, `navigateRec`,
`citeAPA`, `citeChicago`, `citeBibTeX`, `citeRIS`, `citePlainURL`,
`_citeBaseFields`, `CITE_FORMATS`.

---

## What's still inline in `dashboard.html`

The ~1965-line inline `<script>` is the remaining spine — things that
either (a) wire the boot sequence, (b) own a piece of shared UI state
that multiple modules read/write, or (c) are so small that extracting
them would cost more than it saves.

```
1776   Export #26 (doExport, downloadBlob, toCSV)                    ~155
1931   Accessibility helpers (announce, trapFocus, progressBar)      ~124
       + cache / toast / status-dot plumbing
2055   Rail build (buildRail, buildFacetList)                        ~146
2201   Body facet grouped by mechanism family                        ~333
       (TREATY_BODY_ACRONYMS, classifyBody, aggregateMechanismCounts,
        renderMechTiles, bodiesInFamily, _computeMechCounts,
        _openFamilyListDrawer, _bodyDropdownGroupedOptions,
        _bodyTotalsFromAnalytics, buildBodyFacetGrouped)
2504   Keyword input (bindKwInput, debouncedKw, renderKwSyns)         ~30
2534   Chart helpers (renderRowList, _openRowActionSheet,              ~208
       _attachLongPress, refreshFacetUI)
2742   View: Overview (_skelRowList, _skelTimeline, _skelMap,          ~312
       buildOverviewShell, renderOverviewMapOnly, _wireMapModeToggle,
       _wireTimelineModeToggle, renderOverviewAnalytics,
       renderOverview)
3054   NAV — async navigate(view)  [11-way view dispatcher]            ~33
3087   BOOT — dataset toggle + initDatasetToggle +                    ~656
       async boot() (mother of all side effects)
```

### Why these stay inline (for now)

- **`navigate()`** is the 11-way dispatcher that routes to every
  render function in every module. It's the one true cross-cutting
  seam — extracting it means either (a) making every renderer
  independently addressable by string key (a registry), or
  (b) keeping the giant `if`-chain around but in another file.
  Neither is a net win.
- **`boot()`** is ~510 lines of "first-time init" — dataset toggle,
  event wiring, keyboard shortcuts, hit-count debounce, SW
  registration, offline reconciliation, tour trigger, hash restore.
  Almost every line either reads `state` after `data.js` initialized
  it, or attaches an event listener to a DOM element that only
  exists after the HTML rendered. It could move to
  `dashboard-boot.js` but the payoff is low: it's called once and
  has no cross-module API.
- **Rail builders** (`buildRail`, `buildBodyFacetGrouped`, etc.)
  call `onFiltersChanged` which lives in `dashboard-filters.js`, so
  extracting them is possible — just a sizeable block (~480 lines
  across 2055‑2530) that nothing outside calls and that spins off
  many tiny helpers.
- **`renderOverview` + overview skeletons** are tightly coupled to
  `buildRail` (both wire the same rail facets) and to
  `renderMap` / `renderTimeline` which live in separate modules.
  Extractable, but would produce a module that is 80 % event
  wiring.
- **`renderRowList`** is the single most-reused render primitive in
  the app (drawer, profiles, overview tiles, search bulk bar).
  Moving it breaks many forward refs unless we also move its
  consumers — and they are scattered. Needs a dedicated chart-helpers
  seam if/when extracted.

In short: the remaining inline is deliberately the spine. Future
extractions should prefer one-last Rail extraction over trying to
flatten `boot()`.

---

## Cross-cutting concerns

### State
One shared `state` object lives in `dashboard-data.js`. Mutated by
every module. No schema file — the shape is documented at the
declaration (`dashboard-data.js:~120`). Key subtrees:
- `state.filters` (rail state)
- `state.facets`, `state.analytics` (last-fetched slices)
- `state.view`, `state.focusCountry`, `state.focusTheme`, …,
  `state.focusMechanism` (route focus)
- `state.selectedRec`, `state.drawerMode`, `state.drawerList`
  (drawer state)
- `state.rules`, `state.searchSort`, `state.diffPins`,
  `state.cmpA/B`

### URL state
`dashboard-route.js` serializes a selected subset of `state` into
`location.hash`. Every route-changing action ends with
`_pushUrlState()`. Back/forward replays the reverse map via
`_applyRouteStateFromHash()`.

### Lazy cross-module calls
Every module's header documents which external symbols it consumes.
The general rule:
- Top-level constant references ⇒ must be declared *before* in
  load order.
- References inside function bodies / default params ⇒ free to
  reference anything, including inline `<script>`, because lookup
  happens at call time, by which point all scripts have loaded.

### Service worker
`sw.js` caches the app shell + static modules under `uhri-v2-shell-v*`
keys. **Bump the `SHELL_CACHE` version on every ship** — otherwise
returning users keep serving stale modules from the SW cache.

---

## Testing

Playwright smoke tests live in `tests/smoke.spec.ts`. 8 scenarios,
~20s runtime against a local `python3 -m http.server`:

1. **boot** — dashboard.html renders tabs, no unexpected JS errors
2. **loadOrder** — every module-level global is defined
3. **hashRouting** — route module exposes API + tab clicks
4. **landingSearch** — index.html hero search input is wired
5. **datasetNumber** — "267,537" appears in footer + ⌘K hint
6. **searchView** — extracted search module renders shell + sort
7. **readerDrawer** — extracted reader renders a synthetic record
8. **compareScale** — compare timelines share normalized annual max

Run: `npx playwright test --reporter=list`.

Test #2 (`loadOrder`) is the canary for extractions: when a new
module is added, extend it with that module's top-level exports.
A broken forward-ref surfaces here first.

---

## When making changes

### Adding a new extracted module
1. Identify the block in inline. Note its external deps and the
   internal symbols that inline reaches into it for.
2. Create `dashboard-<name>.js` with a header preamble (pattern:
   see `dashboard-ui.js`, `dashboard-labels.js` — every module
   documents LOAD ORDER + EXTERNAL SURFACE).
3. Delete the block from inline, leave a breadcrumb comment.
4. Add `<script src="./dashboard-<name>.js">` in `dashboard.html`.
5. Extend `tests/smoke.spec.ts` test #2 with your module's exports.
6. Bump `SHELL_CACHE` in `sw.js`.
7. Run `npx playwright test`. All 8 should pass.

### Changing a cross-module function signature
1. Grep for its name across every `dashboard-*.js` + `dashboard.html`
   inline — look for both function-call sites and string references
   (event-delegation often passes names as strings).
2. Update all call sites atomically in one commit.

### Inline → module move (partial extraction)
Safe when the function has no top-level side effects and is only
called lazily. If it registers a listener or queries the DOM at
module-evaluation time, keep it inline.
