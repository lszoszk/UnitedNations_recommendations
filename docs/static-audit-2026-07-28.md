# UHRI+ dashboard — static code audit

Static code audit — 2026-07-28

## 1. Executive summary

This is the first purely static audit of the dashboard's front-end code. The two earlier
audits (`docs/self-audit-pre-beta-2026-04-25.md`, `docs/user-flows-report-2026-04-24.md`)
tested how the application *behaves*; this one reads what the code *says*, looking for
defects that behavioural testing tends to miss because they only surface under a specific
combination of filters, timing, or failure.

Fourteen agents read the code in parallel, each given the same checklist of ten defect
classes and the same suppression list. They produced 94 raw findings, 88 after
deduplication. Every finding above the cosmetic level was then handed to a second,
independent agent that had never seen the first one's reasoning and was instructed to
break it. **34 findings completed that adversarial step: 33 were confirmed, 1 was refuted.**
The remaining 54 never reached a verifier because the run was terminated early by an
account spend limit; they are listed in section 5b as leads only.

| Severity | Confirmed | Refuted | Found but unverified |
|---|--:|--:|--:|
| S1 critical | 5 | 0 | 1 |
| S2 high | 18 | 0 | 3 |
| S3 medium | 10 | 1 | 35 |
| S4 low | 0 | 0 | 15 |
| **Total** | **33** | **1** | **54** |

### The three findings that matter most

**The dashboard can show researchers numbers that do not match the filters they set.**
This is the single dominant theme of the audit, and it is a research-integrity problem
rather than a security one. Two separate mechanisms produce it. First, when a region
filter expands to an empty set of countries, `buildParams()` silently drops *both* the
region and the user's explicit country selection, so the query runs against the whole
world while the interface still displays the filter chips (J1-02 — fixed 2026-07-29). Second, an Overview
deep link never re-renders with its own filters: `boot()` only calls `navigate()` when the
restored view is something other than Overview, and the background analytics call that
paints the Overview panels is issued with an empty filter object, `api.analytics({})`
(A-01). A shared or cited Overview URL therefore shows global aggregates under a filtered
heading. Fourteen further confirmed findings are variations on this theme — counts drawn
from a different filter scope than the list they sit above, percentages whose numerator
and denominator come from different queries, dropdown option counts computed on a 5,000
record sample and presented as totals.

**Fast clicking can paint one entity's data into another entity's profile.** None of the
five profile renderers guards its awaited paint step with a generation token or a re-check
of which entity is currently in view (B-01), and the API layer's in-flight
de-duplication returns a pending promise without aborting the superseded request (J1-01).
Open Poland, then quickly switch to Germany, and Poland's late response can repaint the
Germany panels. Nothing warns the user; the heading says Germany.

**Error paths quietly leave stale content on screen.** Several failure handlers log or
toast and then return, leaving the previous filter's numbers rendered as though they were
current (A-03, J2-02, B-03, D-02). For a tool whose output gets cited, failing silently is
worse than failing loudly.

### Health verdict

The codebase is structurally sound and the two risks I expected to dominate did not
materialise. Its unusual architecture — twenty scripts sharing one global namespace with
no build step — is often assumed to be fragile, but a mechanical comparison of all 434
top-level declaration names found **zero collisions and zero load-order hazards**. The
HTML-injection discipline is likewise good: of 118 places where the code writes HTML, 110
are provably safe, and the specific pattern I considered most likely to be dangerous
before the audit — dynamic values interpolated into the inline `onclick` handlers in
`dashboard-search.js` — **does not occur anywhere in the repository**. Only two genuine
escaping defects were filed, neither of them remotely exploitable by a third party.

Where the codebase is weak is in a place no security checklist would look: the
relationship between what the user asks for and what the numbers on screen actually count.
That is the area worth spending fix time on, and it is precisely the area where a wrong
answer damages the tool's purpose most, because a researcher has no way to notice that a
displayed figure was computed against a different filter than the one they set.

## 2. Scorecard — confirmed findings by group and defect class

| Group | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A spine | – | – | – | 1 | 2 | – | – | – | 1 | – | 4 |
| B profiles | – | 1 | – | – | 1 | – | – | – | 2 | – | 4 |
| C labels | – | – | – | – | 2 | – | – | – | 4 | – | 6 |
| D map+timeline | – | – | – | – | 1 | – | – | – | 2 | – | 3 |
| E utils | – | – | – | – | – | – | – | – | 2 | – | 2 |
| F search+filters | – | – | – | – | – | – | – | – | 2 | – | 2 |
| G rail+years | – | 1 | – | 1 | – | – | – | – | – | – | 2 |
| H offline+drawer | – | – | – | – | – | – | – | – | 2 | – | 2 |
| I reader+ui | – | – | – | – | – | – | – | – | 1 | – | 1 |
| J1 plumbing | – | 1 | – | – | 1 | – | – | – | 1 | – | 3 |
| J2 leaf | – | – | – | – | 1 | – | 1 | – | – | – | 2 |
| SW1 sanitize sweep | – | – | – | – | – | – | – | – | – | – | – |
| SW2 listener sweep | – | – | – | – | – | – | – | – | – | – | – |
| SW3 loadorder sweep | – | – | – | – | – | – | – | 2 | – | – | 2 |

C1 unsafe HTML interpolation · C2 async races · C3 listener leaks · C4 route/URL contract · C5 API error paths · C6 global collisions/load order · C7 contract drift · C8 service worker & supply chain · C9 wrong data displayed · C10 dead code.

Every agent received the identical checklist, so the dashes are meaningful: they are evidence that the class was looked for and not found, not evidence that nobody looked. The two strongest such results are C6 (SW3 compared 434 top-level declaration names pairwise and found zero collisions) and C1 (SW1 classified 118 HTML-injection sites and filed only two).

Two caveats on reading this table. It counts only findings that survived adversarial
verification, so the dashes in the SW1 and SW2 rows understate what those sweeps produced:
SW1 filed two C1 findings and SW2 filed two C3 findings, but all four were still queued when
the run was cut short, and they appear in section 5b as unverified. And because 54 of the 88
deduplicated findings never reached a verifier, every cell in this table is a lower bound.

## 3. Confirmed findings

Ranked by the verifier's final severity, then by class. Each was found by one agent and independently re-derived from the source by a second agent that never saw the first one's reasoning.

### B-01 — S1 · C2 · [dashboard-profiles.js:412](dashboard-profiles.js#L412)

**Claim.** None of the five profile renderers guards its awaited `paint()` with a generation token or an entity/view re-check, so a late-resolving profile load repaints the panels of a DIFFERENT entity of the same type while the header (`.cp-iso`, `.cp-name`) still names the new one. The module's own `_profileSampleGen` idiom (L29/L70/L79) is applied only to the lazy sample rows, never to the main paint.

**Scenario.** 1) Open the Germany country profile so its /analytics, /map and /summary responses are in `memGet`. 2) Switch to Poland via `#cpSelect`; Poland's /analytics and /map return from the route cache in ~100 ms but its /summary is cold (the count call is the slow leg — `_loadProfile` gives it a PER-ENTITY abort scope `count:country:Poland`, so it is never superseded, unlike analytics/map which share the global 'analytics'/'map' scopes). 3) Within a second switch back to Germany; every Germany call is a cache hit, so `renderCountry` rebuilds `#view-country` and paints Germany correctly. 4) Poland's /summary lands; the still-pending `await cpProfile.fresh` in the Poland render resumes and `paint()` — which re-queries `$('#cpKpis')`, `.cp-sub`, `$('#cpTime')`, `$('#cpThemes')`, `$('#cpBodies')`, `$('#cpGroups')`, `$('#cpSdgs')` by id at call time — overwrites the live Germany page with Poland's total, timeline and every ranked list. The `<h1>Germany</h1>` and `DEU · COUNTRY PROFILE` eyebrow are written by the outer innerHTML and are NOT touched, so the researcher reads Poland's numbers attributed to Germany. `_mountProfileSamples` additionally sets `state.currentResultList` to Poland's records, so the reader's j/k stepping and any citation taken from it belong to Poland too. Nothing repairs this until the next navigation.

```js
  if (cpProfile.stale) paint(cpProfile.stale.analytics, cpProfile.stale.count, { stale: true, samples: cpProfile.stale.samples });
  try {
    const d = await cpProfile.fresh;
    paint(d.analytics, d.count, { stale: false, samples: d.samples });
    $('#cpSeeAll')?.addEventListener('click', () => {
      state.filters.country = new Set([name]);
      refreshFacetUI('country');
      navigate('search');
      onFiltersChanged();
    });
```

**Verifier's independent trace.** dashboard-profiles.js:331 (#cpSelect change -> navigate('country')) -> dashboard.html:3411,3471 (navigate has no re-entrancy/generation guard, awaits renderCountry) -> dashboard-profiles.js:308 (root.innerHTML rebuilds #view-country; .cp-iso/.cp-name written here only) -> dashboard-profiles.js:357 -> dashboard-data.js:467,478 (_loadProfile split path) -> dashboard-data.js:359,360 (api.analytics/api.map use GLOBAL scopes 'analytics'/'map') vs dashboard-data.js:493,494 (count leg gets PER-ENTITY scope `count:country:<name>`) -> dashboard-data.js:319-322,347 (inflight supersession is per-scope, so count:country:Poland is never aborted by count:country:Germany) -> dashboard-data.js:80-86 (swr swallows AbortError into `null`, so the aborted-rethrow at dashboard-data.js:504-505 is dead and the catch at dashboard-profiles.js:422 cannot fire) -> dashboard-profiles.js:414 (`const d = await cpProfile.fresh` resumes with no entity/generation re-check) -> dashboard-profiles.js:361 (guard passes: analytics and count both non-null) -> dashboard-profiles.js:378,383,394,399,401,403,405 (paint writes $('#cpKpis'), root.querySelector('.cp-sub'), $('#cpTime'), $('#cpThemes'), $('#cpBodies'), $('#cpGroups'), $('#cpSdgs')) via dashboard-helpers.js:97 ($ = document.querySelector) -> dashboard-profiles.js:407 -> dashboard-profiles.js:66-70,80 (_mountProfileSamples sees a different sampleKey, bumps _profileSampleGen past the live entity's, and repoints state.currentResultList/currentResultSource at the wrong entity's rows).

**Line corrections by the verifier.** dashboard-profiles.js:412-421 (anchor correct). also_at corrections: theme await is at dashboard-profiles.js:536 (claimed 534), group at 649 (claimed 647), sdg at 889 (claimed 887), mechanism at 1163/1166 with paint at 1168 (claimed 1155).

**Fix direction.** Capture a module-level `const gen = ++_profileRenderGen` (or reuse _profileSampleGen) at the top of each renderer and early-return from `paint()` when `gen !== _profileRenderGen`, or equivalently re-check the focus entity (`state.focusCountry === iso` / `state.focusTheme === name` / …) plus `state.view` immediately after the await and before painting.

### J1-01 — S1 · C2 · [dashboard-data.js:315](dashboard-data.js#L315)

**Claim.** apiGet's in-flight de-duplication branch returns the pending promise WITHOUT aborting the same-scope in-flight request, so a superseded profile load survives and later repaints its data into the newer profile's DOM. The twin branch three lines above (memCache hit) does perform that abort, with a comment describing exactly this bug.

**Scenario.** Rail empty, Overview open. Overview's country row-list fires getCountrySparkline / preloadCountryOnHover for Germany — api.analytics with key K_DE, scope 'spark:Germany' (dashboard-utils.js:630) or 'preload-analytics:country:Germany' (dashboard-utils.js:703). Those filters are `{...emptyFilters(), country:{X}}` / `_scopedFilter({country:{X}})`, which buildParams serialises to exactly the same query string _loadProfile uses, so the cache key is identical. With GATE_LIMIT=2 those speculative calls sit pending for seconds. User clicks Poland -> renderCountry('Poland') -> api.analytics(K_PL, scope 'analytics'); inflight['analytics'] = {ctrl_PL, K_PL}. Before it answers the user clicks Germany -> renderCountry('Germany') -> api.analytics(K_DE, scope 'analytics') -> memGet(K_DE) misses (nothing cached yet) but pendingPromises.get(K_DE) HITS, so apiGet returns at line 316 and never reaches the abort at 319. ctrl_PL is never aborted. Germany's already-warm promise resolves first and paints; Poland's slower response then resolves renderCountry('Poland')'s `await cpProfile.fresh`, and its paint() (dashboard-profiles.js:358, no generation guard) writes into #cpKpis / .cp-sub / #cpTime / #cpThemes / #cpBodies — the IDs now belonging to Germany's freshly rendered profile. Result: page header, tab label and URL all say Germany while every KPI, the timeline, the theme/body/group/SDG rankings and state.currentResultList are Poland's. No error, no indicator; it persists until the next navigation.

```js
      return hit;
    }
    const pending = pendingPromises.get(key);
    if (pending) return pending.promise;
  }

  if (inflight[scope] && inflight[scope].key !== key) {
    try { inflight[scope].ctrl.abort(); } catch {}
    pendingPromises.delete(inflight[scope].key);
  }
```

**Verifier's independent trace.** dashboard.html:2992 attachPreloadHover(row) -> dashboard-utils.js:744-750 -> dashboard-utils.js:698-703 preloadCountryOnHover('Poland') fires api.analytics(priority 'low', scope 'preload-analytics:Poland') -> dashboard-data.js:359 -> dashboard-data.js:347-348 pendingPromises.set(K_PL) | dashboard.html:2955-2958 cmd-click country row -> navigate('country') -> dashboard.html:3471 -> dashboard-profiles.js:272 renderCountry -> dashboard-profiles.js:357 _loadProfile -> dashboard-data.js:468 _scopedFilter (dashboard.html:2567; rail empty => identical params, cacheKey dashboard-data.js:217) -> dashboard-data.js:479 api.analytics(filter) scope 'analytics' -> dashboard-data.js:300 memGet miss -> dashboard-data.js:315-316 pendingPromises HIT, early return; dashboard-data.js:347 never runs so inflight['analytics'] is never set for Poland | dashboard-profiles.js:331-336 #cpSelect change -> navigate -> dashboard-profiles.js:308 root.innerHTML replaced with Germany's shell -> dashboard-profiles.js:357/dashboard-data.js:479 api.analytics(K_DE) scope 'analytics' -> dashboard-data.js:319 no inflight entry to abort, Poland's fetch lives on | Germany (normal priority) resolves -> dashboard-profiles.js:414-415 paint(Germany) | Poland's low-priority response resolves later -> dashboard-data.js:82-85 swr -> dashboard-data.js:503-509 allSettled (count scope 'count:country:Poland' was never aborted, so d.count is non-null and the early return at dashboard-profiles.js:361 does not fire) -> dashboard-profiles.js:414 resumes -> dashboard-profiles.js:378-409 writes Poland's KPIs, .cp-sub coverage line, #cpTime timeline, #cpThemes/#cpBodies/#cpGroups/#cpSdgs and #cpSamples into Germany's DOM; dashboard-profiles.js:416-421 binds "see all" to country=Poland; dashboard-profiles.js:36/59 sets state.currentResultList to Poland's rows. Nothing repaints Germany afterwards (only callers of renderCountry are dashboard.html:3471 and dashboard-filters.js:175).

**Line corrections by the verifier.** dashboard-data.js:315-322 (anchor correct, verbatim match)

**Fix direction.** Before the early return at dashboard-data.js:316, run the same supersession block as :319-322 and register inflight[scope] = { ctrl: pending.ctrl, key } so the de-duplicated request participates in scope supersession; belt-and-braces, add a focus/generation token check in each profile renderer after its await.

### J2-01 — S1 · C7 · [dashboard-analytics.js:84](dashboard-analytics.js#L84)

**Claim.** Every gtag call in this module sets `page_path` (a Universal-Analytics field GA4 ignores) but never sets `page_location`, so gtag.js supplies its own default `page_location = document.location.href` â which by this app's route contract carries the user's raw keyword (`_pushUrlState` writes `p.set('q', f.kw)` at dashboard-route.js:9). The search-term text is therefore transmitted to Google on every page_view/event, directly contradicting the consent banner ("Your search queries ... are never sent", line 238-239), the module header ("What is NOT tracked: Any text the user typed (kw query ...)", lines 18-19) and the About â Privacy section (dashboard-about.js:61).

**Scenario.** Consented user is on `#view=search&q=female%20genital%20mutilation&country=Egypt`; clicks the Country tab. navigate() (dashboard.html:3465-3469) calls `_pushUrlState()` — putting `q=female genital mutilation` into location.hash — and then `trackView('country')`. gtag.js builds the /g/collect request with `dl=https://…/dashboard.html%23view%3Dcountry%26q%3Dfemale+genital+mutilation%26country%3DEgypt`. The full keyword and country selection land in GA4's `page_location` dimension (and in any BigQuery export) even though the user was told at consent time that query text is never sent. Same leak on trackSearch (line 144) whose own params are scrubbed, and on trackEvent. tests/analytics.spec.ts only inspects the params object the app passes, so it cannot catch the parameter gtag adds itself.

```js
function trackView(viewName) {
  if (!_gaConsentIsGranted() || typeof window.gtag !== 'function') return;
  try {
    const label = _viewLabel(viewName);
    window.gtag('event', 'page_view', {
      page_title: label.title,
      page_path: label.path,
    });
  } catch (_) { /* never let analytics break the app */ }
}
```

**Verifier's independent trace.** dashboard-filters.js:156 onFiltersChanged() -> dashboard-filters.js:162 _pushUrlState() -> dashboard-route.js:9 p.set('q', f.kw) -> dashboard-route.js:35 history.replaceState(null,'',base+'#'+h) [document.location.href now carries the raw keyword + country/theme/region filters] -> dashboard.html:3465 _pushUrlState() -> dashboard.html:3469 trackView(view) -> dashboard-analytics.js:85 consent gate passes -> dashboard-analytics.js:88-91 window.gtag('event','page_view',{page_title,page_path}) with no page_location -> dashboard.html:123-128 gtag('config','G-F3XBX45HQC',{anonymize_ip,allow_ad_personalization_signals,allow_google_signals,send_page_view}) sets no page_location either -> gtag.js supplies default page_location=document.location.href on the /g/collect hit. Same terminal hop for dashboard-analytics.js:98 (trackEvent, e.g. dashboard.html:3593 dataset_toggle), :144 (trackSearch, reached from dashboard-search.js:511-512 after the same _pushUrlState wrote q=) and :198 (trackWebVital). Test blind spot: tests/analytics.spec.ts:20-25 replaces window.gtag with an array recorder so only app-supplied params are asserted; tests/integrity.spec.ts:26 blocks googletagmanager.com so the real tag never builds a hit.

**Fix direction.** Set an explicit scrubbed page_location (origin + pathname + '#view=' + view, no q/filter params) on every gtag call and in gtag('config'), drop the GA4-ignored page_path, and add a test asserting no gtag call can omit page_location.

### A-01 — S1 · C9 · [dashboard.html:4160](dashboard.html#L4160)

**Claim.** boot() parses filters out of the URL hash (_restoreUrlState at 4131) but only re-renders when the restored view is NOT 'overview', so an Overview deep link paints global unfiltered aggregates while the rail, filter chips and hit-count all show the restored filter.

**Scenario.** A researcher filters Overview to country=Poland and copies the URL. _pushUrlState omits `view` for overview, so the shared link is `dashboard.html#country=Poland`. On open: line 4115 renders the map + FIG.02 Top countries from `api.map({})` (unfiltered); 4131 restores f.country={Poland}; 4133 draws the Poland chip; 4161 refreshHitCount() prints Poland's filtered count; 4164's guard is false so renderOverview() never runs; finally 4184 paints `api.analytics({})` - explicitly unfiltered - into Top themes / Top groups / Top bodies / Top SDGs / the timeline. The recipient reads world-wide totals under a header that says Poland, with no indicator. Back/forward is fine (_applyRouteStateFromHash ends in navigate()); only the initial load is wrong.

```js
  // Initial hit count (fast - page_size=1)
  refreshHitCount();

  // Navigate to the current view (restored from URL or 'overview')
  if (state.view && state.view !== 'overview') {
    await navigate(state.view);
  }
```

**Verifier's independent trace.** dashboard-utils.js:125,159 (share copies location.href verbatim) → dashboard-route.js:8 (`view` omitted when overview, so shared hash is `#country=POL`) → dashboard.html:2409 (#view-overview is the only section without `hidden`, visible with no navigate()) → dashboard.html:4061 buildOverviewShell() → dashboard.html:4098 api.map({}) → dashboard-data.js:360 `f || state.filters` with truthy `{}` → dashboard-data.js:151-188 buildParams({}) emits zero filter params → dashboard.html:4115 renderOverviewMapOnly() paints map + FIG.02 Top countries (dashboard.html:3123-3131) unfiltered → dashboard.html:4131 _restoreUrlState() → dashboard-route.js:128 f.country.add('POL') → dashboard.html:4133 renderActiveFilters() draws the Poland chip into #activeFilters (dashboard.html:2407) → dashboard.html:4161 refreshHitCount() → dashboard-filters.js:242 api.recordsCount(state.filters) writes Poland's filtered count into #hitCount (dashboard.html:2258) → dashboard.html:4164 guard false, navigate() skipped (its only occurrence is dashboard.html:4165) → dashboard.html:4178 api.analytics({}) → dashboard.html:4184 renderOverviewAnalytics() repaints FIG.00 mechanism tiles, Top themes/groups/bodies/SDGs and the timeline with world totals, overwriting even the cached render at dashboard.html:4155.

**Line corrections by the verifier.** dashboard.html:4160-4166 (anchor exact; the mechanism also depends on dashboard-route.js:8 and dashboard-data.js:359-360)

**Fix direction.** Make the boot tail unconditional — `await navigate(state.view || 'overview')` — so the overview branch runs renderOverview() with the restored filters, or equivalently call refreshCurrentView() when _restoreUrlState() produced a non-empty state.filters.

### J1-02 — S1 · C9 · [dashboard-data.js:171](dashboard-data.js#L171)  ·  **FIXED 2026-07-29**

**Claim.** buildParams() drops ALL geographic filtering â both the region and the user's explicit country selection â whenever the region-to-country expansion yields an empty Set, because the empty Set is truthy but `effectiveCountries.size` is 0 so no `countries=` param is emitted and the m49 branch never sets `regions=`. The request then returns the entire unfiltered corpus.

**Scenario.** Two concrete triggers. (a) Disjoint selection: in the rail the user ticks Country = 'Poland' and Region = 'Africa' (M49, the default taxonomy). expandM49RegionsToCountries (dashboard-map.js:748) returns the African country-name Set; the intersection at line 172 is an empty Set; line 180's `.size` check is false so `countries=` is omitted and the m49 branch never reaches the `regions=` else-branch. The API is called with no geographic constraint at all and answers with all ~267,942 records, while the active-filter chips still read 'Country: Poland' and 'Region: Africa' and the hit count, KPIs, timeline and map all show the full corpus instead of 0. (b) Stale/foreign region key: a shared link or saved view carrying `#region=GRULAC` without `rt=unGroups` (or any region value not in M49_REGION_KEYS = africa/americas/asia/europe/oceania) makes expandM49RegionsToCountries return an empty Set; the same path silently discards the region AND any country the user has selected alongside it. The comment at dashboard-map.js:745 claims unknown keys are 'ignored rather than breaking the filter' — in fact they wipe every geographic filter and the whole dataset is returned as if narrowed.

```js
        effectiveCountries = effectiveCountries
          ? new Set([...effectiveCountries].filter(c => regionCountries.has(c)))
          : regionCountries;
      }
    } else {
      // unGroups — pass through to server native `regions` param.
      p.set('regions', Array.from(f.region).join(','));
    }
  }
  if (effectiveCountries && effectiveCountries.size) {
    p.set('countries', Array.from(effectiveCountries).join(','));
  }
```

**Verifier's independent trace.** dashboard-rail.js:227 (region facet renders M49 keys) -> dashboard-rail.js:273-277 (region ticked into state.filters.region; no country clearing) + dashboard-rail.js:325-331 (country ticked independently) | ALT entry dashboard-route.js:132 (#region=<any string> added unvalidated, tax stays 'm49' at :99) | AMPLIFIER dashboard.html:2575 (_scopedFilter copies f.region) -> dashboard-profiles.js:353 (_scopedFilter({country:new Set([name])}) overrides only country) -> dashboard-data.js:166 (effectiveCountries = {Poland}) -> dashboard-data.js:168-169 -> dashboard-map.js:748-756 (returns empty Set for disjoint/unknown keys, NOT null) -> dashboard-data.js:170 (empty Set is truthy) -> dashboard-data.js:171-173 (intersection = empty Set) -> dashboard-data.js:180 (.size === 0, countries= omitted; regions= unreachable, else-branch skipped at :175) -> dashboard-data.js:359-363/389 (api.analytics/map/summary/records called with zero geo params) and dashboard-filters.js:219-223 (/api/data/export URL likewise) -> full ~268k corpus rendered and exported while dashboard-filters.js:39 still shows the Region chip and dashboard.html:2634 still prints the region in the profile rail-note. Contrast dashboard-offline.js:28-31 and :36-46 which AND the two predicates and correctly return 0.

**Fix direction.** Have expandM49RegionsToCountries/buildParams distinguish "no region constraint" (null) from "constraint that resolves to nothing" (empty Set) and, when a geo filter is active but resolves empty, emit an impossible-match sentinel or short-circuit the request to an empty result set instead of omitting countries=/regions=; also drop or correct the now-false comment at dashboard-map.js:743-747.

**Fixed 2026-07-29** — `dashboard-data.js` (buildParams), `dashboard-map.js` (comment), `tests/smoke.spec.ts` (test 26).

The sentinel route was taken over short-circuiting because `buildParams` is the single choke point every geographic query passes through: `api.analytics/map/summary/records/recordsCount`, the `/api/data/export` URL in `dashboard-filters.js:219` and `doExport()` in `dashboard.html:2668`, and the sparkline fetch in `dashboard-utils.js:730`. Short-circuiting would have meant an empty-state branch at each of those call sites for the same user-visible result. buildParams now carries a `noGeoMatch` flag: when an active region filter resolves to no country — an M49 expansion disjoint from the picked countries, or one holding only unknown keys — it emits `countries=__no_matching_country__` (the new `NO_MATCHING_COUNTRY` constant) instead of dropping the geographic parameters, so the query answers 0 records and the user's explicit country selection is never silently discarded. Confirmed against the live VM: `/api/data/summary?countries=__no_matching_country__&dataset=cleaned` → `total_records: 0`.

The sibling unGroups branch carried the analogous defect and was fixed in the same pass. `f.region.size` can be non-zero while the joined value is empty — `#region=,,&rt=unGroups` yields a Set of one empty string — and `regions=` reads server-side as *no region filter* (verified live: it returns all 267,942 records). Blank values are now filtered out and an all-blank selection falls through to the same sentinel.

The comment at dashboard-map.js:743-747 that claimed unknown keys are "ignored rather than breaking the filter" now states the null-vs-empty-Set contract explicitly. `expandM49RegionsToCountries` itself was already correct and is unchanged. Test 26 (`geoFilterNeverVanishes`) pins both triggers in the scenario above, both unGroups shapes, and the three unaffected shapes (country-only, region-only, overlapping).

### A-04 — S2 · C5 · [dashboard.html:4223](dashboard.html#L4223)

**Claim.** boot()'s Phase-2 catch does not exempt AbortError, and any user filter action during the ~10s baseline analytics window aborts that request via apiGet's per-scope race guard - producing a false red error toast and permanently leaving the rail's Theme and Group facets empty because buildRail() is never re-run with real analytics.

**Scenario.** Cold first visit (no 'analytics:baseline' in localStorage), so buildRail at 4118 is handed the empty stub `{themes:{theme_counts:[]}, text:{affected_person_counts:[], sdg_counts:[]}}` and the rail Theme/Group lists render with zero options. Boot then awaits `api.analytics({})` (scope 'analytics'). Within the next few seconds the user types in the search box: bindKwInput -> debouncedKw(350ms) -> onFiltersChanged -> debouncedRefresh(650ms) -> refreshCurrentView -> renderOverview -> api.analytics(state.filters). apiGet sees the same scope with a different key and calls `inflight['analytics'].ctrl.abort()` (dashboard-data.js:319-322), rejecting boot's request with AbortError. This catch fires: a red 6s toast claims 'Analytics did not load (...). Map + rail still work.' although nothing failed, and everything after line 4184 is skipped for the session - cacheSet('analytics:baseline') (so the next visit is cold again), window._syncYearHistogram(), the focusTheme/Group/Sdg/Mechanism defaults, state.baselineAnalytics, and crucially `buildRail(state.facets, analytics)` at 4190. buildRail has only three call sites, all inside boot (verified by grep), and buildFacetList('theme'/'group') is called only from it, so the rail Theme and Group facets stay empty until a full page reload - the user cannot filter by theme or group at all. Clicking a hex-map country or a rail country checkbox triggers the identical abort.

```js
    progressBar(100, 'READY');
  } catch (err) {
    console.warn('Analytics failed', err);
    progressBar(100, 'ANALYTICS OFFLINE');
    toast('Analytics didn\'t load (' + err.message + '). Map + rail still work.', true, 6000);
  }
```

**Verifier's independent trace.** dashboard.html:4067 (cold visit: cacheGet('analytics:baseline') -> null) -> dashboard.html:4118 buildRail(facets, {themes:{theme_counts:[]},text:{affected_person_counts:[],sdg_counts:[]}}) -> dashboard-rail.js:91-102 themes=[] groups=[] -> buildFacetList('theme',[]) / buildFacetList('group',[]) render empty, #n-theme/#n-group = 0 -> dashboard.html:3676 bindKwInput() already wired -> dashboard.html:4178 await api.analytics({}) -> dashboard-data.js:355 apiGet(E.analytics, '', {scope:'analytics'}) -> dashboard-data.js:326 inflight['analytics']={ctrl_boot,key:''} -> [user types] dashboard-rail.js:738 debouncedKw -> dashboard-rail.js:713 debounce 350ms -> dashboard-filters.js:156 onFiltersChanged -> dashboard-filters.js:161 debouncedRefresh -> dashboard-filters.js:135 debounce 650ms -> dashboard-filters.js:172 refreshCurrentView -> renderOverview -> dashboard.html:3339 api.analytics(state.filters) -> dashboard-data.js:355 same scope 'analytics', key='text_query=...' -> dashboard-data.js:319-322 inflight['analytics'].ctrl.abort() -> boot's fetch rejects AbortError (or dashboard-data.js:281 gate reject) -> dashboard.html:4223 catch fires with no AbortError guard -> 4226 red toast; 4181 cacheSet skipped (next visit also cold), 4190 buildRail(state.facets, analytics) never runs -> rail Theme/Group facets remain empty for the session (grep: buildRail called only at dashboard.html:4072, 4118, 4190; buildFacetList('theme'|'group') called only from dashboard-rail.js:95/102; refreshFacetUI only re-checks boxes).

**Line corrections by the verifier.** dashboard.html:4223-4227 (anchor correct, no correction needed)

**Fix direction.** Add `if (err.name === 'AbortError') return;` (or re-run buildRail from the cached/baseline analytics) at the top of the Phase-2 catch, matching the guard already used at dashboard.html:3335/3348 — and, since a superseded baseline is never retried, re-issue the baseline fetch under a private scope (e.g. `{scope:'analytics:baseline'}`) so a user filter action cannot abort it at all.

### J2-02 — S2 · C5 · [dashboard-methodology.js:14](dashboard-methodology.js#L14)

**Claim.** Both freshness fetches swallow every failure with `.catch(() => null)`, so an unreachable/erroring status endpoint is indistinguishable from a pipeline that has never run: the card then renders the affirmative false statement "â· no refresh yet" / "Last refresh: never run" / "Dataset file modified: unknown" instead of an error state. The `catch` block at lines 82-86 that exists precisely to print "Status endpoint unreachable" is unreachable for network and non-2xx failures.

**Scenario.** The university VM is down, nginx 502s, or the user is on a network that blocks 150.254.115.204 (the API host is a bare-IP HTTPS origin, so a cert/blocking failure is a realistic single point of failure). The researcher opens Methodology → Dataset freshness — the one place in the product that answers "how current is this data?" — and reads a yellow card stating the monthly refresh has never run and the dataset file date is unknown. That is substantively wrong information about data provenance, shown silently, with no indication that the check simply failed. Reloading does not help while the endpoint is down.

```js
    const [status, health] = await Promise.all([
      fetch(API_BASE + '/refresh_status.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(API_BASE + '/api/data/health', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const stages = (status && status.stages) || {};
    const fail = Number((status && status.fail_count) || 0);
    const finished = status && status.finished_at;
```

**Verifier's independent trace.** dashboard.html:3480 (view==='methodology' -> renderMethodology) -> dashboard-methodology.js:200 (#freshness-card placeholder) -> dashboard-methodology.js:221 (renderFreshnessCard().catch = console.warn only) -> dashboard-methodology.js:15-18 (both fetches .catch(() => null); non-ok also -> null) -> dashboard-methodology.js:14 (Promise.all cannot reject) -> dashboard-methodology.js:23-24 (finished/dsMod = null) -> dashboard-methodology.js:33 (kind='is-warn', banner='◷ no refresh yet') -> dashboard-methodology.js:69,73 ('never run' / 'unknown' rendered) -> dashboard-methodology.js:82-86 (error branch never entered); reachability during outage: dashboard.html:3974 (nav delegate) registered before dashboard.html:4085 (Phase-1 try/catch early return); no SW masking: sw.js:61

**Fix direction.** Have each leg resolve to a distinguishable sentinel on rejection/non-ok (e.g. `{__err: r.status || String(e)}`) and branch the render into a "could not check freshness" state instead of collapsing failure into the same null as "never run".

### D-02 — S2 · C5 · [dashboard-map.js:1157](dashboard-map.js#L1157)

**Claim.** When the CDN is unreachable the choropleth falls back to renderGridMap, which silently discards the counts of every country missing from NAME_TO_ISO/MAP_LAYOUT (~60 of the 199 states in HEX_LAYOUT) with no indicator that the map is now incomplete.

**Scenario.** Offline / blocked-CDN session (the app ships a service worker and dashboard-offline.js, and cdn.skypack.dev + cdn.jsdelivr.net are cross-origin so sw.js passes them straight through to the network). loadMapLibs rejects, renderChoroplethMap catches at L135-137 and returns renderGridMap. renderGridMap drops any country whose cleaned name is absent from NAME_TO_ISO (dashboard-helpers.js:29) or whose ISO is absent from MAP_LAYOUT (dashboard-helpers.js:70) — that silently removes Papua New Guinea, Vanuatu, Samoa, Kiribati, Nauru, Palau, Marshall Is., Micronesia, Solomon Is., Timor-Leste, Chad, Congo, Gabon, Botswana, Namibia, Malawi, Djibouti, Comoros, Central African Republic, Bahrain, Kuwait, Oman, Qatar, UAE, Cyprus, Malta, Albania, Bosnia, North Macedonia, Montenegro, Kosovo, Moldova, Iceland, Luxembourg, State of Palestine and more. The user sees a map on which those states simply have no records. It is sticky for the session: _mapLibsPromise (L114-116) caches the rejected promise, so every later re-render re-enters the same grid path even after connectivity returns; only a reload retries. The module header at L10 claims 'Falls back to hex on failure' — hex would have shown all 199.

```js
  countryCounts.forEach(c => {
    const normalized = cleanCountryName(c.country);
    const iso = NAME_TO_ISO[normalized];
    if (!iso || !MAP_LAYOUT[iso]) return;
    const [col, row] = MAP_LAYOUT[iso];
    const k = col + '-' + row;
    if (!byCell[k]) byCell[k] = { iso, total:0, names:[] };
    byCell[k].total += c.count;
    if (!byCell[k].names.includes(normalized)) byCell[k].names.push(normalized);
  });
```

**Verifier's independent trace.** dashboard-map.js:1108 (getMapMode default 'choropleth') -> dashboard.html:3125 (renderOverviewMapOnly calls renderMap on the default overview) -> dashboard-map.js:1120-1124 (mode !== 'hex' branch) -> dashboard-map.js:130-134 (await loadMapLibs) -> dashboard-map.js:114-127 (loadMapLibs: skypack/jsdelivr imports .catch(()=>null), then `throw new Error('map libs failed to load')`; the rejected promise is cached in _mapLibsPromise) -> dashboard-map.js:135-137 (catch -> `return renderGridMap(...)`, so the promise RESOLVES and the outer hex .catch at 1125-1127 never runs) -> dashboard-map.js:1157-1160 (`if (!iso || !MAP_LAYOUT[iso]) return;`) -> dashboard-helpers.js:29-67 NAME_TO_ISO (139 keys) and dashboard-helpers.js:70-96 MAP_LAYOUT (126 ISO keys) vs dashboard-map.js:480-703 HEX_LAYOUT (199 ISO) = 73 states silently dropped, incl. COD, TCD, COG, GAB, CAF, BWA, NAM, MWI, DJI, COM, LSO, SWZ, BHR, KWT, OMN, QAT, ARE, CYP, MLT, ALB, BIH, MKD, MNE, XKX, MDA, ISL, LUX, PSE, LAO, TLS, PNG, SLB, VUT, WSM, HND, NIC, CRI, PAN, SLV -> dashboard-map.js:1167-1215 (renderGridMap output has no incompleteness indicator; missing states render as `.map-cell empty`, indistinguishable from ocean). Only complete-data channel is the visually-hidden .map-sr-summary appended at dashboard-map.js:1124/1136-1149. Reachability of the precondition is independently supported by dashboard-offline.js:135-147 + 212-220, whose Instant Mode computes country_counts locally, so an offline/firewalled session still has data to draw while both CDNs are unreachable (sw.js:61 passes cross-origin straight to network).

**Line corrections by the verifier.** dashboard-map.js:1157-1166 (anchor correct, no correction needed)

**Fix direction.** In the catch at dashboard-map.js:135-137 call renderHexMap (the fallback the header documents and the only layout covering all 199 states) instead of renderGridMap, and null out _mapLibsPromise on rejection so a later render retries after connectivity returns.

### B-03 — S2 · C5 · [dashboard-profiles.js:498](dashboard-profiles.js#L498)

**Claim.** Every profile `paint()` early-returns unless ALL of analytics, map and count are non-null, but `_loadProfile`'s split path resolves successfully with nulls for individual failed legs (`Promise.allSettled` + `val(x) = x.status === 'fulfilled' ? x.value : null`). A single endpoint failing therefore leaves the entire profile frozen on its "Loadingâ¦" placeholders with no toast, no error and no stale badge.

**Scenario.** Deep-link to any SDG profile (`entityType === 'sdg'` always takes the split path, L515-517 of dashboard-data.js), or any profile with a rail filter applied. If /summary 5xx's or the connection drops for that one leg while /analytics and /map succeed, `loadSplitProfile().fresh` resolves to `{analytics:<ok>, mapD:<ok>, count:null}` — the `aborted` check above it can never fire because `swr()` converts AbortError into a fulfilled `null`, and `res.every(rejected)` is false. `await spProfile.fresh` therefore does not throw, the `catch` that shows `toast('Failed to load SDG profile: …')` never runs, and `paint(analytics, mapD, null)` returns at the guard. The user is left with `<div class="cp-sub">Loading…</div>` and six `<div class="panel-loading">loading</div>` panels forever, even though five of the six panels' data is in hand. This directly contradicts `_loadProfile`'s stated contract: "one section 5xx-ing shouldn't blank the whole profile (the renderers already tolerate missing sections)".

```js
  const paint = (analytics, mapD, count, opts = {}) => {
    updateSparklineCaches(analytics);
    if (!analytics || !mapD || !count) return;
    const total = count.total_records;
```

**Verifier's independent trace.** dashboard-profiles.js:851 (_loadProfile('sdg',…)) -> dashboard-data.js:517 (entityType!=='sdg' false, and _bundledProfileEndpointAvailable false by default per :428/:400-403) -> dashboard-data.js:541 returns loadSplitProfile() -> dashboard-data.js:494 ctSwr = swr(count…) wrapping api.recordsCount -> dashboard-data.js:388-391 apiGet(E.summary) throws on HTTP 5xx (dashboard-data.js:331-336) -> dashboard-data.js:84 swr .catch re-throws non-AbortError, so ctSwr.fresh rejects -> dashboard-data.js:503-508: aborted find is null (nothing rejects with AbortError since :84 converts it to fulfilled null), res.every(rejected) false, val(res[2]) = null -> combine(analytics, mapD, null) -> dashboard-profiles.js:889 await spProfile.fresh resolves, no throw -> dashboard-profiles.js:853-855 paint(analytics, mapD, null): updateSparklineCaches runs, then `if (!analytics || !mapD || !count) return` -> zero DOM writes; dashboard-profiles.js:716 `<div class="cp-sub">Loading…</div>` and the six panel-loading divs at :729-734 stay forever -> dashboard-profiles.js:897-898 catch never runs, so toast('Failed to load SDG profile: …') never fires.

**Fix direction.** Make each paint() gate per-section instead of all-or-nothing — render the KPI/count block only when count is non-null, the map panels only when mapD is non-null, etc., and surface a per-panel "unavailable" state (the pattern already used at dashboard-profiles.js:84 and dashboard-search.js:708-724) for the legs that returned null.

### C-08 — S2 · C5 · [dashboard-labels.js:916](dashboard-labels.js#L916)

**Claim.** JSON import validates only `Array.isArray(s.rules)` and persists the set immediately; a rule whose `must`/`also`/`not` is not an array makes `compileRule` throw inside the `renderRules()` template literal, and because `rulesLoadSet()` has already written `state.rules.active` and `RULES_ACTIVE_KEY`, the Labels tab then throws on every subsequent page load with no in-app way back.

**Scenario.** A teammate hand-edits a shared rules file and writes `"must": "judiciary"` (a string) instead of an array — the documented sharing path (L757, "Use ⬇ JSON for durable copies and team sharing"). Import succeeds silently (only the top-level `rules` array is checked). The user then picks that set in `#rulesSetSelect`: `rulesLoadSet` copies the rules in, sets `state.rules.active` and writes `RULES_ACTIVE_KEY` (L133-136), then `renderRules()` runs `renderRuleCard` → `validateRule` → `compileRule` → `(arr || []).map` on a string → TypeError. The throw happens while evaluating the template literal, so `root.innerHTML` is never assigned and the change handler has no try/catch. On the next visit/reload, renderRules resumes the persisted active set (L697-700) and throws at the same point before writing any markup, leaving `#view-labels` permanently blank — the set selector needed to escape is itself part of the markup that never renders. Only clearing localStorage recovers.

```js
        const existing = rulesLoadSets();
        for (const s of incoming) {
          if (!s || !Array.isArray(s.rules)) continue;
          existing.unshift({
            ...s,
            id: rulesGenId(),
            saved_at: Date.now(),
            version: RULES_SCHEMA_VERSION,
          });
        }
        rulesSaveSets(existing);
```

**Verifier's independent trace.** dashboard-labels.js:916-918 (import: only `Array.isArray(s.rules)` checked, per-rule fields unvalidated) -> dashboard-labels.js:926 (rulesSaveSets persists the malformed set to RULES_KEY) -> dashboard-labels.js:890-893 (#rulesSetSelect change handler, no try/catch) -> dashboard-labels.js:130-137 (rulesLoadSet writes state.rules.active, state.rules.rules, and localStorage RULES_ACTIVE_KEY *before* any render) -> dashboard-labels.js:714 (root.innerHTML = `...` RHS begins evaluating) -> dashboard-labels.js:779 (`${rules.map(r => renderRuleCard(r)).join('')}`) -> dashboard-labels.js:797/799 (renderRuleCard -> validateRule) -> dashboard-labels.js:104 (validateRule -> compileRule) -> dashboard-labels.js:82-84 (`clean(r.must)`: `(arr || []).map` on the string "judiciary" -> TypeError, no .map on String.prototype) -> assignment at 714 never happens -> dashboard.html:3479 (`else if (view === 'labels') renderRules();` — unguarded; navigate is async at dashboard.html:3411 so it becomes an unhandled rejection) -> dashboard-bug-report.js:56-57 (logs only, no recovery) -> on reload state.rules re-inits with active:null (dashboard-labels.js:61-76), dashboard-labels.js:697-699 resumes the persisted broken set, and dashboard.html:2418 (`<section class="view hidden" id="view-labels"></section>`) is empty, so the view is permanently blank; the only RULES_ACTIVE_KEY removeItem (dashboard-labels.js:899) lives in #rulesNewSet, inside markup that never renders.

**Line corrections by the verifier.** dashboard-labels.js:916-926 (anchor correct); actual sink is dashboard-labels.js:714 (root.innerHTML) via 779 (rules.map(renderRuleCard)); throw origin dashboard-labels.js:82-84

**Fix direction.** Coerce/validate per-rule term lists at the import boundary (and defensively in compileRule's `clean`, e.g. `Array.isArray(arr) ? arr : []`), and wrap the renderRules() dispatch so a bad set degrades to an error card with a working "New set" escape.

### J1-03 — S2 · C5 · [dashboard-data.js:500](dashboard-data.js#L500)

**Claim.** _loadProfile's allSettled combiner returns nulls for failed sections on the documented premise that 'the renderers already tolerate missing sections', but every profile paint() bails out on the first null (`if (!analytics || !mapD || !count) return;`), so a single failing endpoint leaves the profile permanently on its 'loading' placeholders with no error, no toast and no stale indicator.

**Scenario.** User opens any profile (e.g. Theme = 'Reservations'). /api/data/analytics returns 500 (or any non-200) while /map and /summary succeed. apiGet throws, swr rethrows the non-Abort error, allSettled reports one rejection, `res.every(rejected)` is false so nothing is thrown, and combine() yields {analytics:null, mapD:<ok>, count:<ok>}. renderTheme awaits cpProfile.fresh, calls paint(null, mapD, count) which returns at its first line (dashboard-profiles.js:499). The outer catch never runs because the promise resolved, so the 'Failed to load … profile' toast never fires. The user is left staring at 'Loading…' in the sub-header and 'loading' in FIG.A–FIG.F indefinitely; because the failure is deterministic for that filter shape, reloading reproduces it exactly. The comment on lines 500-503 asserts the opposite behaviour, so a maintainer reading it would not look here.

```js
      // allSettled, not all: one section 5xx-ing shouldn't blank the whole
      // profile (the renderers already tolerate missing sections). Still reject
      // on supersession (AbortError) so we don't paint stale partial data, and
      // on total failure so the error path shows.
      fresh: Promise.allSettled([anSwr.fresh, mpSwr.fresh, ctSwr.fresh]).then((res) => {
        const aborted = res.find(x => x.status === 'rejected' && x.reason && x.reason.name === 'AbortError');
        if (aborted) throw aborted.reason;
        if (res.every(x => x.status === 'rejected')) throw res[0].reason;
        const val = x => x.status === 'fulfilled' ? x.value : null;
        return combine(val(res[0]), val(res[1]), val(res[2]));
```

**Verifier's independent trace.** dashboard-data.js:300 (apiGet throws on !res.ok) -> dashboard-data.js:83 (swr rethrows non-AbortError) -> dashboard-data.js:503 (Promise.allSettled) -> dashboard-data.js:506 (`res.every(rejected)` false, no throw) -> dashboard-data.js:508-509 (val() maps rejected to null, combine returns {analytics:null, mapD, count}) -> dashboard-profiles.js:536 (`const d = await thProfile.fresh` resolves) -> dashboard-profiles.js:537 (paint(null, mapD, count)) -> dashboard-profiles.js:500 (`if (!analytics || !mapD || !count) return;`) -> dashboard-profiles.js:545 (catch/toast never reached) -> dashboard-profiles.js:465-478 (shell "Loading…" + FIG.A-F "loading" persist)

**Line corrections by the verifier.** dashboard-data.js:499-509 (comment starts at 499, not 500); guards are dashboard-profiles.js:500 (theme), 361 (country), 614 (group), 855 (sdg), 1125 (mechanism) — claim's also_at said profiles.js:499/359, each off by one

**Fix direction.** In the combiner, treat a null section the way the renderers actually behave — reject with the first rejection reason unless the caller declares that section optional (only country's paint truly ignores mapD) — and/or make paint() render a per-section error state instead of returning; separately, make swr propagate AbortError so the now-dead `aborted` check at dashboard-data.js:504 actually fires.

### SW3-01 — S2 · C8 · [sw.js:18](sw.js#L18)  ·  independently found by **SW3, J1**

**Claim.** SHELL_ASSETS precaches only 5 files and omits all 21 same-origin JavaScript files that dashboard.html loads, so the precached offline shell renders as a dead page with zero scripts.

**Scenario.** User opens dashboard.html for the first time. The scripts load while no SW controls the page, so nothing is written to the cache; install() then precaches only dashboard.html/index.html/manifest/2 icons and self.skipWaiting()+clients.claim() activate immediately. The user loses connectivity (plane, field work) and reopens the PWA: the navigate branch serves the cached ./dashboard.html, but every one of the 20 dashboard-*.js requests plus ./web-vitals.js goes through networkFirst, misses the cache and throws 'offline and no cache'. The user sees the static markup — topbar, empty rail, empty #app — with no error, no toast, no data, forever. The same reset happens after every SHELL_CACHE bump: activate() deletes the old cache generation, and the new generation again contains only the 5 shell assets until the next successful online load.

```js
const SHELL_ASSETS = [
  './dashboard.html',
  './index.html',
  './manifest.webmanifest',
  './icon-192.svg',
  './icon-512.svg',
];

const SWR_PATHS = ['/api/data/facets', '/api/data/map', '/api/data/analytics', '/api/data/records', '/api/data/record/', '/api/data/cache_status', '/api/data/refresh_status'];
const NETWORK_ONLY = ['/api/feedback/report', '/api/data/full', '/api/data/export'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
```

**Verifier's independent trace.** sw.js:18-24 (SHELL_ASSETS omits all 20 dashboard-*.js + web-vitals.js) -> sw.js:31 (only addAll() in repo; verified by repo-wide grep for addAll/precache) -> dashboard.html:2530-2549 (20 deferred script tags) -> dashboard.html:4242-4246 (boot() on DOMContentLoaded) -> dashboard.html:3688 (register('./sw.js') runs inside boot, i.e. after those scripts already fetched uncontrolled -> zero JS enters SHELL_CACHE on first visit) -> sw.js:31 skipWaiting -> sw.js:38 activate deletes every non-current cache key -> sw.js:39 clients.claim() -> [user goes offline, reopens PWA; manifest.webmanifest start_url ./dashboard.html, display standalone] -> sw.js:75-76 navigate -> networkFirst -> sw.js:104-105 cache.match hits precached ./dashboard.html -> sw.js:84-89 each script (destination 'script') -> networkFirst -> sw.js:100 fetch(req,{cache:'reload'}) rejects offline and bypasses HTTP cache -> sw.js:104 cache.match miss -> sw.js:106 throw 'offline and no cache' -> dashboard.html:4244 boot() executes with zero module globals -> uncaught ReferenceError, no surrounding try/catch, 0 <noscript> elements -> user sees only static markup from dashboard.html:2241 onward

**Line corrections by the verifier.** Anchor is exact (sw.js:18-32). Mechanism additionally depends on sw.js:38, sw.js:100-106, dashboard.html:3688 and dashboard.html:4244.

**Fix direction.** Extend SHELL_ASSETS (or a separate install-time cache.addAll) to cover the 20 dashboard-*.js files plus ./web-vitals.js so every cache generation ships a complete runnable shell, while keeping the networkFirst fetch handler unchanged for version freshness.

### SW3-03 — S2 · C8 · [dashboard-map.js:117](dashboard-map.js#L117)  ·  independently found by **D, SW3, J1**

**Claim.** AGGREGATE supply-chain finding: the three third-party map dependencies are loaded from CDNs with neither subresource integrity nor exact-version pinning, and two of them execute as script on the app's origin.

**Scenario.** cdn.skypack.dev is compromised or DNS/BGP-hijacked (or simply publishes a malicious 3.x patch — the specifiers are the ranges `d3-geo@3` and `topojson-client@3`, not exact versions). Any visitor who opens the default overview with the default 'choropleth' map mode executes the attacker's module in the dashboard's origin, with read/write access to every localStorage key the app owns (uhri_v2_bookmarks_v1, uhri_v2_notes_v1, uhri_v2_saved_views, uhri_v2_label_sets_v1, uhri-ga-consent) and to the DOM. Nothing detects this: dynamic `import()` cannot carry an integrity attribute at all, so the only fix is self-hosting — which the project already does for web-vitals (dashboard.html:145, './web-vitals.js') and already applies in its stricter form for SheetJS (dashboard-utils.js:505-508, exact version + sha384 integrity + crossOrigin). The world-atlas fetch on line 120 is data rather than code, but is likewise unpinned and unverified, so a tampered countries-110m.json silently redraws country borders in a human-rights map. Three sites, one root cause, one fix.

```js
  _mapLibsPromise = Promise.all([
    import('https://cdn.skypack.dev/d3-geo@3').catch(() => null),
    import('https://cdn.skypack.dev/topojson-client@3').catch(() => null),
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .catch(() => null),
  ]).then(([d3geo, topojson, world]) => {
```

**Verifier's independent trace.** dashboard.html:3332 (renderOverview success path; also 4073 cached-map path, 4115) -> dashboard.html:3123-3125 renderOverviewMapOnly -> dashboard-map.js:1114 renderMap -> dashboard-map.js:1117 getMapMode() -> dashboard-map.js:1108 returns 'choropleth' by default -> dashboard-map.js:1124 renderChoroplethMap -> dashboard-map.js:134 await loadMapLibs() -> dashboard-map.js:115-123 unpinned import('https://cdn.skypack.dev/d3-geo@3'), import('https://cdn.skypack.dev/topojson-client@3'), fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'); no-CSP confirmed by absence of http-equiv in dashboard.html; no SW mitigation at sw.js:61 (cross-origin pass-through); contrast pins at dashboard-utils.js:505-507 and dashboard.html:145

**Fix direction.** Self-host all three assets next to web-vitals.js (bundled d3-geo + topojson-client ESM builds and countries-110m.json) and import them by relative path, or at minimum replace the `@3`/`@2` ranges with exact versions; the `.catch(() => null)` fallback to renderHexMap at dashboard-map.js:1124-1127 already covers a missing asset, so no new error handling is needed.

### F-02 — S2 · C9 · [dashboard-filters.js:97](dashboard-filters.js#L97)

**Claim.** `renderScopeBanner` (and the label chip at line 19) render `f.activeLabel.name` whenever `f.activeLabel` is set and `f.kw` is non-empty, never checking that `f.kw` is still the label's compiled query. Several code paths overwrite `f.kw` without clearing `activeLabel`, so the banner attributes a live record count to a label rule the user is not running.

**Scenario.** Labels workspace → click 🔎 Search on rule "Torture in detention": dashboard-labels.js:509-510 sets `f.kw = <compiled FTS5>` and `f.activeLabel = {id, name:'Torture in detention'}`. The user then presses ⌘K, types "climate adaptation" and hits Enter on the "Search full text for …" result — dashboard-ui.js:162 does `state.filters.kw = qRaw` and calls `onFiltersChanged()` without clearing `activeLabel` (unlike the rail #kwInput listener at dashboard-rail.js:734, which does clear it). `renderScopeBanner` now passes its `!lbl || !f.kw` guard and paints "Filtering by label **Torture in detention** — 8,412 of 267,942 records (3.1%)", where 8,412 is the hit count for "climate adaptation". `renderActiveFilters` simultaneously emits a 🏷 chip reading "Torture in detention" instead of a Q chip for the real query. The wrong attribution persists silently until the user types in the rail input or reloads.

```js
  const f = state.filters;
  const lbl = f.activeLabel;
  if (!lbl || !f.kw) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const total = state.facets?.total_records || 267942;
  const hits = state.totalHits;
  const hitsTxt = (hits == null) ? '…' : fmt(hits);
  const pctTxt = (hits == null) ? '' : `(${pct(hits / total)})`;
  el.hidden = false;
```

**Verifier's independent trace.** dashboard-labels.js:1087 (rule card 🔎 Search, markup at :825) → dashboard-labels.js:509-510 sets f.kw=compiled and f.activeLabel={id,name} → dashboard.html:4006 (⌘K) → dashboard-ui.js:47 openPalette → dashboard-ui.js:155-167 SEARCH result action → :161 `inp.value = qRaw` (property write, no 'input' event) → :162 `state.filters.kw = qRaw` (activeLabel untouched) → :165 onFiltersChanged → dashboard-rail.js:727-739 listener NOT invoked (would have cleared activeLabel) → dashboard-filters.js:156-159 → dashboard-filters.js:99 guard `!lbl || !f.kw` passes → :113 `sanitize(lbl.name)` paints the stale rule name, :114 `hitsTxt` from state.totalHits → dashboard-filters.js:19-22 emits the 🏷 chip with the stale name and the new query only in the title tooltip → dashboard-filters.js:246-255 re-renders the banner once refreshHitCount lands the count for the NEW query → dashboard-route.js:34 history.replaceState, no hashchange, so dashboard.html:4172 / _applyRouteStateFromHash:112 _resetRouteState never runs.

**Line corrections by the verifier.** none — dashboard-filters.js:97-108 and :19 are exact; dashboard-ui.js:162, dashboard-rail.js:734, dashboard-labels.js:509-510 all verified at the claimed lines

**Fix direction.** Make the banner/chip verify attribution rather than trust the flag: gate on `f.activeLabel && f.kw === f.activeLabel.query` (store the compiled query on activeLabel at dashboard-labels.js:510) so any unclearing kw overwrite — dashboard-ui.js:162 and dashboard-drawer-list.js:324/332 — degrades to a plain Q chip instead of a wrong label.

### H-01 — S2 · C9 · [dashboard-offline.js:209](dashboard-offline.js#L209)

**Claim.** offline.enable() has no already-enabled guard, so a second enable() saves the already-installed offline stubs into this._savedApi; a later disable() then "restores" those stubs while setting this.data = null, leaving every api.* call returning 0 records with the status chip reading LIVE.

**Scenario.** User clicks ⚡ Instant Mode and it activates (enable() #1 stores the real api.facets/records/... in _savedApi and overwrites api.* with local stubs). User then clicks Upload and loads a UHRI .xlsx/.json — dashboard-utils.js:343-356 sets offline.data = parsed and calls offline.enable({source:'upload'}) with no intervening disable(), so _savedApi is overwritten with the stub closures. (Same happens on a second upload, or when the user closes the download modal via backdrop click without aborting and starts a second download, since showOfflineModal calls offline.enable() again.) User then clicks "↩ Back to live dataset" / the SOURCE pill / context-menu "Disable Instant Mode" → disable() runs Object.assign(api, this._savedApi), reinstalling the stubs as the "real" API, sets this.data = null, and calls setStatus('live','LIVE'). From that point every stub routes through this.filter(), which returns [] because this.data is null: overview KPIs, map, timeline, search and every drawer list show 0 records, api.health reports {dataset_ready:true}, and disable() early-returns on the next call so there is no recovery short of a full page reload.

```js
    this._savedApi = {
      facets: api.facets,
      analytics: api.analytics,
      map: api.map,
      summary: api.summary,
      records: api.records,
      recordsCount: api.recordsCount,
      health: api.health,
    };
```

**Verifier's independent trace.** dashboard.html:3878 (#uploadBtn click, unguarded) -> dashboard-utils.js:292 triggerUpload() -> dashboard-utils.js:331 #uplFile change handler -> dashboard-utils.js:347 offline.data = parsed -> dashboard-utils.js:349 offline.enable({source:'upload'}) while offline.enabled is already true -> dashboard-offline.js:200 sole guard `if (!this.data) return` passes -> dashboard-offline.js:209-217 _savedApi = {facets: api.facets, ...} captures the stubs installed by the first enable() -> dashboard-offline.js:218-224 api.* overwritten with stubs again -> dashboard-offline.js:499 #uploadBannerSwitch onclick (or 513 source pill, or 582/588 context menu) -> dashboard-offline.js:266 Object.assign(api, this._savedApi) reinstalls the stubs as the "real" API -> dashboard-offline.js:269 this.data = null -> dashboard-offline.js:275 setStatus('live','LIVE') -> dashboard-offline.js:290-293 refreshHitCount()/refreshCurrentView() -> dashboard-offline.js:164 recordsCount() -> dashboard-offline.js:77-78 filter() returns [] because this.data is null -> dashboard-offline.js:260 next disable() early-returns; dashboard-offline.js:200 enable() early-returns on null data; no recovery without reload

**Fix direction.** In enable(), only snapshot the real API when not already installed — e.g. `if (!this._savedApi) this._savedApi = {...}` — or have the upload path in dashboard-utils.js:349 call offline.disable({keepCache:true}) before re-enabling.

### B-02 — S2 · C9 · [dashboard-profiles.js:576](dashboard-profiles.js#L576)

**Claim.** The Group profile's "Switch group" dropdown annotates every option with `analytics.text.affected_person_counts[].count`, which this same file documents (L126-129) as computed on a 5,000-record SAMPLE and therefore "not record counts at all", while the KPI strip two inches to the left shows the exact `/summary` total for the same group. The sampled/exact fix was applied only to `_renderEntityPicker` (via `countsAreSampled`/`countParam` + `_backfillPickerCounts`), never to this dropdown.

**Scenario.** Open the Concerned-group profile for "Women & girls" (rail empty). `paint()` writes `#gpKpis` Total from `count.total_records` (exact /summary figure). The `#gpSelect` switcher rendered at L579 shows the option `Women & girls · 1,245` — the file's own comment at L129 states this exact pair: "'Women & girls' reads 1,245 there against 67,360 actual". Both numbers are on screen simultaneously, both unlabelled, and a researcher reading the switcher to decide which group has enough material gets a figure ~50x too small with no indication it is a sample. `_refreshGroupPicker` re-renders the same dropdown from the same sampled array when baseline analytics land, so the wrong number also survives the refresh.

```js
  const groupCountList = _profilePickerAnalytics()?.text?.affected_person_counts || [];
  const groupsList = groupCountList.map(g => g.affected_person);
  const groupCountsByKey = Object.fromEntries(groupCountList.map(g => [g.affected_person, g.count]));
  const opts = _dropdownOptionsWithCount(groupsList, name, groupCountsByKey);
```

**Verifier's independent trace.** dashboard-profiles.js:576 (_profilePickerAnalytics) → dashboard-profiles.js:102-103 (state.baselineAnalytics) → dashboard-profiles.js:209-210 (api.analytics({}) unfiltered) → dashboard-profiles.js:578 (countsByKey from g.count, sampled text section per :125-132, :974, docs/api-schemas/v1/analytics.json text.sampled) → dashboard-profiles.js:579 → dashboard-rail.js:542-548 (emits `${sanitize(name)} · ${fmt(c)}`, no qualifier) → dashboard-profiles.js:589 (<select id="gpSelect">) rendered in the same .cp-head as dashboard-profiles.js:586 #gpKpis → dashboard-profiles.js:622-623 (fmt(count.total_records)) → dashboard-data.js:494 (api.recordsCount) → dashboard-data.js:388-390 (E.summary, exact). No-mitigation hops: dashboard-profiles.js:203 (_backfillPickerCounts gated on countsAreSampled && countParam, reached only from _renderEntityPicker) and dashboard-profiles.js:570 (flags passed only on the name-less picker branch, which returns at :573); refresh path dashboard-profiles.js:604-605 → :226-234 re-renders the same sampled rows.

**Line corrections by the verifier.** none — snippet is exact at dashboard-profiles.js:576-579

**Fix direction.** Route the group switcher through the same sampled-count contract as the picker — render the option counts as pending and backfill each via api.recordsCount({group}), or omit the count annotation entirely when the source is analytics.text.* — and apply the same change in _refreshGroupPicker:229-232.

### D-01 — S2 · C9 · [dashboard-map.js:156](dashboard-map.js#L156)

**Claim.** renderChoroplethMap (the DEFAULT map mode) aggregates country_counts with no M49 region-filter pruning, so with a rail Region filter active it colours and counts countries that are not in the filtered region â the exact bleed renderHexMap explicitly corrects at lines 779-790.

**Scenario.** Default route (Overview), default map mode = 'choropleth' (getMapMode, L1108). User ticks Region = Oceania in the rail. dashboard-data.js:168-176 converts that to countries=<all Oceania states>, so the API returns every record naming any Oceania state; its country_counts includes every country listed on those records, e.g. a record naming both Fiji and the United States. The choropleth then shades the USA and its tooltip/aria-label reads 'United States of America: N records' while the Oceania filter is on. Switching the same view to Hex mode makes the USA go grey, because renderHexMap deletes non-region ISOs from byIso before colouring. The two renderings of FIG.01 disagree over the same data and the default one shows the bleed the team already identified as misleading.

```js
  const countByTopoName = Object.create(null);
  const topoToApi = Object.create(null);
  countryCounts.forEach(c => {
    const apiName = cleanCountryName(c.country);
    // Ordered candidates: raw name, reconciler match, stripped parenthetical
    const candidates = [
      apiName,
      apiToTopoName(apiName),
      apiName.replace(/\s*\([^)]*\)\s*/g, '').trim(),  // "Iran (Islamic Republic of)" → "Iran"
    ];
    let hit = null;
    for (const cand of candidates) {
```

**Verifier's independent trace.** dashboard-rail.js:206-213 (m49 region checkboxes, Oceania) → dashboard-rail.js:229 _buildFacetListInto('region') sets state.filters.region → dashboard-data.js:165-180 buildParams: tax='m49' (default, dashboard-data.js:146) → expandM49RegionsToCountries → p.set('countries', <all Oceania states>) → API /map returns country_counts aggregated over ANY-match records (shape proven by dashboard-offline.js:23-26, :36-43, :136-147) → dashboard.html:3124-3125 renderOverviewMapOnly passes raw country_counts → dashboard-map.js:1117 getMapMode()='choropleth' (dashboard-map.js:1108) → dashboard-map.js:1124 renderChoroplethMap → dashboard-map.js:156-172 countByTopoName aggregation with NO allowed-set prune (contrast dashboard-map.js:766-790) → dashboard-map.js:176-187 every feature shaded and labelled aria-label="United States of America: N records" → dashboard-map.js:1119/1134-1146 SR summary repeats the unpruned list for both modes.

**Line corrections by the verifier.** dashboard-map.js:156-172 (evidence spans 156-168, not 156-174). The also_at anchor 1138 is _appendMapSrSummary's raw-counts read (1134-1146), which is a distinct and arguably worse instance — it runs for BOTH modes, so in hex mode the screen-reader text alternative lists the very countries the visible hex map just pruned. The grid-map instance the claim likely meant is renderGridMap at 1152-1166.

**Fix direction.** Extract the hex prune block (dashboard-map.js:766-790) into a helper and apply it once to countryCounts at the top of renderMap (dashboard-map.js:1114) so choropleth, grid, hex and the SR summary all colour and narrate the same set.

### C-04 — S2 · C9 · [dashboard-labels.js:130](dashboard-labels.js#L130)

**Claim.** `rulesLoadSet()` replaces `state.rules.rules` and clears `state.rules.counts` but leaves `state.rules.coverage` untouched and non-stale, so after switching saved sets the bottom bar keeps presenting the *previous* set's union/overlap totals as current results for the newly loaded set.

**Scenario.** User computes Coverage on set A (5 rules) and gets "12,430 records match 1+ rule · 2,100 match 2+". They pick set B from the `#rulesSetSelect` dropdown; `rulesLoadSet` swaps in B's rules and resets counts, then `renderRules()` re-emits `renderCoverageSummary()` (L787). Because `state.rules.coverage.stale` is still false, the summary renders A's 12,430 / 2,100 verbatim under B's cards, with a "refresh" link that implies the numbers are already valid. `_rulesInvalidateCoverage()` is only wired to rule/term CRUD (L531, L538, L549, L553), so the same silent carry-over happens after clicking a starter template (L878), after "+ New set" (L897, once any rule is re-added), and after editing a rule's raw FTS5 query (L1051) — none of which mark coverage stale. ⬇ CSV then reuses that same `perRule` payload (L650) keyed by the old rule ids.

```js
function rulesLoadSet(id) {
  const s = rulesLoadSets().find(x => x.id === id);
  if (!s) return false;
  state.rules.active = s.id;
  state.rules.rules  = JSON.parse(JSON.stringify(s.rules || []));
  state.rules.counts = {};
  try { localStorage.setItem(RULES_ACTIVE_KEY, id); } catch {}
  return true;
}
```

**Verifier's independent trace.** dashboard.html:2372 (More menu, data-nav="labels") → dashboard.html:3479 renderRules() → dashboard-labels.js:973 "#rulesComputeCoverage" click → dashboard-labels.js:568 rulesComputeCoverage() → dashboard-labels.js:595-602 state.rules.coverage = {union, overlap, perRule, stale:false} → dashboard-labels.js:890-893 "#rulesSetSelect" change → rulesLoadSet(id) → dashboard-labels.js:130-138 (rules/counts replaced, coverage untouched) → dashboard-labels.js:893 renderRules() → dashboard-labels.js:787 renderCoverageSummary() → dashboard-labels.js:560-565 (c truthy, !c.stale, !c.running, !c.error) prints set A's fmt(c.union)/fmt(c.overlap) as set B's result. Secondary sink: dashboard-labels.js:650-651 rulesExportCsv reuses the same non-stale perRule.

**Line corrections by the verifier.** Anchor 130-138 is exact. also_at corrections: dashboard-labels.js:878 (starter template) confirmed — sets state.rules.rules/counts with no invalidation. dashboard-labels.js:1050-1051 (raw FTS5 textarea input handler; claim said 1051) confirmed — mutates rule.rawQuery and only reschedules the per-rule count, never marking coverage stale. dashboard-labels.js:895-901 ("+ New set") is NOT a live instance: it empties state.rules.rules, so the `hasRules` gate at L762/L781 hides the coverage bar entirely, and the first re-add goes through rulesAddRule → _rulesInvalidateCoverage (L531) before the bar can reappear — that sub-path self-heals.

**Fix direction.** Reset coverage (state.rules.coverage = null) inside rulesLoadSet, alongside the counts reset, and add _rulesInvalidateCoverage() to the starter-template handler and the raw-query input handler.

### C-03 — S2 · C9 · [dashboard-labels.js:659](dashboard-labels.js#L659)

**Claim.** The CSV assignment matrix keys rule membership by `rule.name` instead of `rule.id`, so two rules sharing a name (the default `rulesAddRule()` name is literally 'New rule', and any cleared name becomes 'Untitled rule') collapse into one column value â a record matching only one of them is exported as matching both.

**Scenario.** User clicks "+ Add rule" twice and fills terms into each card without renaming them (both keep name 'New rule'), or renames two cards to the same string. On ⬇ CSV, `assign.get(id).add(rule.name)` (L664) stores a Set of *names*, so a record matched only by the first rule yields ruleSet = {'New rule'}; the column builder `rules.map(r => ruleSet.has(r.name) ? '1' : '0')` (L678) then emits '1' for both columns, and the joined `labels` cell reads "New rule" once for a record the exporter believes matches two rules. The header also contains two identically named columns, so the downstream analyst cannot even detect the duplication. The exported matrix — the artefact used for a methodology annex — silently overstates coverage of every duplicate-named rule.

```js
  const header = ['AnnotationId', 'labels', ...rules.map(r => r.name)];
  const escape = (s) => {
    const str = String(s ?? '');
    return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const lines = [header.map(escape).join(',')];
  for (const [id, ruleSet] of assign) {
    const joined = Array.from(ruleSet).join('; ');
    const cols = rules.map(r => ruleSet.has(r.name) ? '1' : '0');
    lines.push([id, joined, ...cols].map(escape).join(','));
```

**Verifier's independent trace.** dashboard-labels.js:522-525 (rulesAddRule defaults name to literal 'New rule'; called with no argument at L884 and L983) -> dashboard-labels.js:1000 (blur handler: cleared name becomes literal 'Untitled rule'; no uniqueness check anywhere) -> dashboard-labels.js:979 (#rulesExportCsv click -> rulesExportCsv; button rendered at L785 when hasRules) -> dashboard-labels.js:646 (rules = state.rules.rules filtered by compileRule; both duplicate-named rules survive if each has terms) -> dashboard-labels.js:578 / 661 (perRule correctly keyed by rule.id) -> dashboard-labels.js:659-665 (assign.get(id).add(rule.name) discards the id, storing a Set of names) -> dashboard-labels.js:670 (header repeats the same name twice) -> dashboard-labels.js:678 (rules.map(r => ruleSet.has(r.name) ? '1' : '0') emits '1' for both identically named columns) -> dashboard-labels.js:681-687 (blob written and downloaded, no warning)

**Fix direction.** Key `assign` by `rule.id` (Set of ids), build the 1/0 columns with `ruleSet.has(r.id)`, derive the joined `labels` cell via an id-to-name lookup, and disambiguate duplicate header names (e.g. append the rule id or an index).

### E-01 — S2 · C9 · [dashboard-utils.js:620](dashboard-utils.js#L620)

**Claim.** The persistent country-sparkline cache is keyed by country name alone â not by data source (live VM vs. uploaded file) nor by `dataset` (cleaned/raw) â so sparklines computed from a user's uploaded XLSX/JSON are written to localStorage and then re-rendered as if they described the live 127k-record dataset, permanently and with no indicator.

**Scenario.** Researcher opens the Upload modal, loads their own UHRI export (say 800 Colombia records). `offline.enable()` monkey-patches `api.analytics` (dashboard-offline.js:219) to the local calculator, which returns the same `trends.yearly_counts` shape. Overview's Top-countries list runs `backfillCountrySparklines` -> `getCountrySparkline('Colombia')` -> the 800-record curve is stored in `_countrySparkCache` and flushed to localStorage key `uhri_v2_country_sparks_v1`. The user then closes the upload (or just reloads — upload mode is deliberately NOT restored, dashboard-offline.js:247). Back on the live VM dataset, `getCountrySparkline` returns the cached upload-derived curve at line 628 without any refetch, so Colombia's trend sparkline on the default Overview route depicts 800 records instead of the live dataset. Nothing ever evicts this entry: there is no TTL, no version field beyond the frozen `_v1` suffix, and `offline.disable()` (dashboard-offline.js:259-300) clears the IDB snapshot but never touches this key. The same collision applies to the cleaned/raw toggle: `_switchDataset` explicitly does `memCache.clear()` at dashboard.html:3597 with the comment 'cleaned / raw responses share endpoint paths and would collide otherwise', but leaves this persistent cache untouched even though `emptyFilters()` feeds `state.filters.dataset` into the request.

```js
const _countrySparkCache = {};
const COUNTRY_SPARK_CACHE_KEY = 'uhri_v2_country_sparks_v1';
try { Object.assign(_countrySparkCache, JSON.parse(localStorage.getItem(COUNTRY_SPARK_CACHE_KEY) || '{}')); } catch {}
function saveCountrySparkCache() {
  try { localStorage.setItem(COUNTRY_SPARK_CACHE_KEY, JSON.stringify(_countrySparkCache)); } catch {}
}

async function getCountrySparkline(country) {
  if (_countrySparkCache[country]) return _countrySparkCache[country];
  try {
    const an = await api.analytics({...emptyFilters(), country: new Set([country])}, { scope: 'spark:' + country, priority: 'low' });
    const yearly = (an?.trends?.yearly_counts || []);
```

**Verifier's independent trace.** dashboard.html:3878 (#uploadBtn click) -> dashboard-utils.js:292 triggerUpload -> dashboard-utils.js:328-346 file change, offline.data = parsed -> dashboard-utils.js:349 offline.enable({source:'upload'}) -> dashboard-offline.js:219 api.analytics monkey-patched to offline.analytics (dashboard-offline.js:82, returns trends.yearly_counts from local rows) -> dashboard-utils.js:357 refreshCurrentView() -> dashboard.html:3130 renderRowList('#topCountries', {facet:'country'}) (no sparkSource, no noSparklines) -> dashboard.html:3023-3025 backfillCountrySparklines -> dashboard-utils.js:654 getCountrySparkline(country) -> dashboard-utils.js:630 patched api.analytics -> dashboard-utils.js:634-635 _countrySparkCache[country] = uploadCurve; saveCountrySparkCache() -> localStorage 'uhri_v2_country_sparks_v1'; then dashboard-offline.js:258-300 offline.disable() (or reload — upload pref deliberately not persisted, dashboard-offline.js:247) restores api.* but never clears the cache -> dashboard-utils.js:622 rehydrate on next boot -> dashboard-utils.js:628 / 649 / 684 return the upload-derived curve for the live dataset, permanently.

**Line corrections by the verifier.** none — evidence is exact at dashboard-utils.js:620-638; also_at dashboard-utils.js:649 and :684 both confirmed

**Fix direction.** Key the cache (and its localStorage blob) by provenance + dataset, e.g. `${offline.source||'live'}|${state.filters.dataset}|${country}`, and skip persisting entirely when `offline.source === 'upload'`.

### C-02 — S2 · C9 · [dashboard-labels.js:789](dashboard-labels.js#L789)

**Claim.** Rule counts and the rail-scope note are recomputed only at the end of `renderRules()`, and `refreshCurrentView()` (dashboard-filters.js:170-184) has no `labels` branch, so changing any rail filter while the Labels tab is open silently leaves every count â and the scope note that describes them â on the previous filter scope.

**Scenario.** User opens Labels with no filters: the toolbar renders "Dataset-wide (no rail filter active)" (L772) and each card shows a dataset-wide count. Without leaving the tab the user ticks Country = Poland in the always-visible left rail. `onFiltersChanged()` runs `debouncedHit()` (rail hit count updates) and `debouncedRefresh()` → `refreshCurrentView()`, whose if-chain covers overview/search/country/theme/group/sdg/mechanism/compare but not `labels`, so `renderRules()` never runs. Every rule card keeps its dataset-wide number and the toolbar keeps asserting "Dataset-wide (no rail filter active)", directly contradicting the tab's own documented contract at L752 ("Counts respect the current rail filter, so a Judicial independence rule with a Country=Poland rail counts Poland records only"). Nothing indicates the numbers are stale; only switching tabs and back repairs them.

```js
    </div>`;

  rulesBindEvents();
  rulesRefreshAllCounts();
}
```

**Verifier's independent trace.** dashboard-rail.js:136,163,168,238,277,331,498,652,671 (facet toggles) -> dashboard-filters.js:156 onFiltersChanged() -> dashboard-filters.js:160 debouncedHit() [dashboard-filters.js:134 -> refreshHitCount -> dashboard-filters.js:245 state.totalHits = r.total_records, LIVE] and dashboard-filters.js:161 debouncedRefresh() [dashboard-filters.js:135 -> refreshCurrentView] -> dashboard-filters.js:169-184 if-chain covers overview/search/country/theme/group/sdg/mechanism/compare, NO labels branch -> renderRules() (dashboard-labels.js:692) never re-runs -> dashboard-labels.js:772 railActive scope note and dashboard-labels.js:792 rulesRefreshAllCounts() never re-evaluated -> stale counts persist; dashboard-filters.js:162 _pushUrlState() -> dashboard-route.js:35 history.replaceState (no hashchange, so dashboard.html:3479 navigate('labels') -> renderRules() is not re-entered)

**Fix direction.** Add `else if (state.view === 'labels') renderRules();` to the refreshCurrentView() if-chain in dashboard-filters.js:169-184 (or, to avoid clobbering in-progress rule edits, re-render only the scope note and call rulesRefreshAllCounts()).

### C-01 — S2 · C9 · [dashboard-labels.js:483](dashboard-labels.js#L483)

**Claim.** The rule-count percentage divides the rule's own match count by `state.totalHits`, which is the hit count for the rail filter *including* `state.filters.kw` â but `n` was computed with `kw` replaced by the rule's compiled query, so numerator and denominator describe different universes whenever a keyword (or an applied label) is active.

**Scenario.** User builds 3 rules, clicks "📊 Analyze" on rule A. `_applyRuleAsActiveFilter` (L508) sets `state.filters.kw` to A's FTS5 query and `onFiltersChanged()` → `refreshHitCount()` sets `state.totalHits` = A's match count (say 1,200). User clicks "edit rule →" in the scope banner (dashboard-filters.js:120 → navigate('labels')) → renderRules → rulesRefreshAllCounts. `_railIsEmpty` returns false (kw is set, dashboard-data.js:455), so denom = 1,200. Rule A now reads "1,200 (100.0%)", rule B (8,000 matches) reads "8,000 (666.7%)", and rule C (600 matches) reads a plausible-but-meaningless "600 (50.0%)". The tooltip on L493 states "600 of 1,200 records match", which is a false claim about the corpus. Same occurs whenever the user has simply typed a keyword in the rail before opening Labels.

```js
  const denom = (!_railIsEmpty(state.filters) && state.totalHits)
    ? state.totalHits
    : 267942;
  const pct = (n / denom * 100).toFixed(n < 100 ? 2 : 1);
  el.textContent = `${fmt(n)} (${pct}%)`;
  el.className = 'rule-count ' + (n === 0 ? 'zero' : (n >= 50 && n <= 20000 ? 'ok' : 'warn'));
```

**Verifier's independent trace.** dashboard-labels.js:1087 (📊 Analyze) → dashboard-labels.js:508-509 `state.filters.kw = compiled` → dashboard-labels.js:518 `onFiltersChanged()` → dashboard-filters.js:244-245 `state.totalHits = r.total_records` from `api.recordsCount(state.filters)` (kw INCLUDED) → dashboard-filters.js:120 "edit rule →" `navigate('labels')` → dashboard.html:3479 `renderRules()` → dashboard-labels.js:792 `rulesRefreshAllCounts()` → dashboard-labels.js:440 `const f = { ...state.filters, kw: compiled }` → dashboard-labels.js:462 `api.recordsCount(f)` (kw REPLACED) → dashboard-data.js:455 `_railIsEmpty` returns false because `f.kw` is non-empty → dashboard-labels.js:483-486 denom = kw-universe count, numerator = rule-universe count → dashboard-labels.js:487 renders `(666.7%)` and dashboard-labels.js:493 tooltip asserts "N of DENOM records match". Second, cheaper entry: any keyword typed into #kwInput before opening Labels reaches the same L483 with the same mismatch, no label rule required.

**Fix direction.** Derive the denominator from a kw-stripped filter — count `{...state.filters, kw: ''}` once per rail change (cached in state) — instead of reusing `state.totalHits`, and use that same value in the L493 tooltip.

### F-01 — S2 · C9 · [dashboard-search.js:445](dashboard-search.js#L445)

**Claim.** Bulk selection is keyed by AnnotationId and survives every re-render, but every bulk action resolves ids against `state.searchLoaded`, which `renderSearch()` resets to `[]` (line 259). After any re-render the bulk bar still advertises the full selection count while export / bookmark / pin silently operate on the subset that happens to be re-loaded on page 1.

**Scenario.** Search "torture", scroll through 4 pages (120 rows), tick 20 records across those pages — the bulk bar reads "20 selected · ready to pin 2 or bulk-export". Now change the sort dropdown to "country · A–Z" (or switch to the Overview tab and back, or edit any facet): navigate/renderSearch sets `state.searchLoaded = []` (dashboard-search.js:259) and reloads only page 1, but never touches `state.searchSelection`. `_seUpdateBulkBar()` (called at line 356) re-reads `state.searchSelection.size` and again prints "20 selected", and the re-rendered rows show ticked checkboxes. Click "Export .xlsx": `_seExportSelected` filters the 30-row `searchLoaded` and hands `_exportDrawerList` only the ~4 selected ids that survived, with `total: picks.length` — the researcher downloads a 4-row spreadsheet believing it holds their 20 chosen records, with no warning. `_seBulkPin` in the same state reports "Select at least 2 records to compare" while 20 are selected.

```js
function _seExportSelected(kind) {
  const picks = state.searchLoaded.filter(r => r && state.searchSelection.has(r.AnnotationId));
  if (!picks.length) { toast('Nothing selected', true, 1800); return; }
  const fakeCtx = {
    kind: 'search',
    value: (state.filters.kw || '').trim() || 'all',
    records: picks,
    total: picks.length,
  };
  _exportDrawerList(kind, fakeCtx);
}
```

**Verifier's independent trace.** dashboard-data.js:140 (`searchSelection: new Set()`, never reassigned) → dashboard-search.js:345-348 (sort `change` handler calls `renderSearch()`) OR dashboard.html:3477 (`navigate('search')` → `renderSearch()`) → dashboard-search.js:258-259 (`state.searchPage = 1; state.searchLoaded = []` — selection untouched) → dashboard-search.js:356 `_seUpdateBulkBar()` → :376-380 (prints `${state.searchSelection.size} selected · ready to pin 2 or bulk-export`) → dashboard-search.js:179/182 (re-rendered page-1 rows render `checked` for surviving ids, reinforcing the count) → dashboard-search.js:446 (`picks = state.searchLoaded.filter(... searchSelection.has ...)` — only the ~30 reloaded rows are candidates) → dashboard-search.js:450-453 (`records: picks, total: picks.length`) → dashboard-search.js:454 → dashboard-drawer-list.js:388/447-452 (xlsx built from `ctx.records`, no completeness check; the confirm guard at dashboard-drawer-list.js:356 is in the drawer render path and is never reached, and `missing` would be 0 anyway). Same defect on the sibling paths: dashboard-search.js:439 `_seBulkPin` (yields <2 picks → "Select at least 2 records to compare" while N are selected), dashboard-search.js:423-424 `_seBulkBookmark`, and dashboard-drawer-list.js:34-46 `openSelectionDrawer` (header value = `sel.size` records, body = filtered survivors, `total: recs.length`).

**Line corrections by the verifier.** dashboard-search.js:445-454 (claim said 445-455; function body ends at 454)

**Fix direction.** Keep a Map of AnnotationId → record populated on select (and persisted across renders) and resolve bulk actions against it instead of `state.searchLoaded`; failing that, drop ids from `state.searchSelection` whenever `renderSearch` clears `searchLoaded` so the bar can never overstate.

### G-02 — S3 · C2 · [dashboard-years.js:30](dashboard-years.js#L30)

**Claim.** `bindYearSlider` tears down its listeners with `_yearSliderAbort.abort()` on every re-bind. If `buildRail()` re-runs while the user is mid-drag (it runs up to 3Ã per boot, the last time when phase-2 analytics land ~10 s in), the `mouseup`â`onUp` handler is removed before it fires, so `state.filters.yearA/yearB` keep the values `onMove` already wrote but `onFiltersChanged()` â and therefore `_pushUrlState()`, `refreshHitCount()` and `refreshCurrentView()` â never run.

**Scenario.** Cold load of dashboard.html. At ~2 s the rail is up; the user presses the mouse on #ysA and drags the start year from 2006 to 2015. `onMove` (years.js:60-69) mutates `state.filters.yearA` on every move and calls `update()`, so #yrAL, the fill bar and the histogram already read 2015. At ~10 s the phase-2 `api.analytics({})` resolves and dashboard.html:4190 calls `buildRail(state.facets, analytics)`, which reaches rail.js:157 `bindYearSlider(minY, maxY)` → line 33 `_yearSliderAbort.abort()` removes the document mouseup/mousemove listeners; the fresh closure starts with `dragging = null`. The user releases the button: no `onUp` runs in either closure, so `onFiltersChanged()` is never called. Result: the rail shows "2015–2026", the histogram highlights 2015+, and `renderActiveFilters` will even draw a "Years 2015–2026" chip — but the hit count, the Overview figures and the record list still reflect 2006–2026, and the URL carries no `y1`, so a researcher who copies the link at that moment cites a scope different from the one on screen. The mismatch persists until the user touches any other filter, at which point the never-confirmed 2015 silently takes effect.

```js
let _yearSliderAbort = null;

function bindYearSlider(minY, maxY) {
  if (_yearSliderAbort) _yearSliderAbort.abort();
  _yearSliderAbort = new AbortController();
  const listenerOpts = { signal: _yearSliderAbort.signal };
  const slider = $('#yearSlider'), fill = $('#ysFill');
  const A = $('#ysA'), B = $('#ysB');
  let dragging = null;
```

**Verifier's independent trace.** dashboard.html:4190 buildRail(state.facets, analytics) [phase-2, after api.analytics resolves] -> dashboard-rail.js:157 bindYearSlider(minY, maxY) (re-entry documented at dashboard-rail.js:171-172 "buildRail() gets called 2-3x per boot") -> dashboard-years.js:33 _yearSliderAbort.abort() unconditionally removes the document mousemove/mouseup registered at dashboard-years.js:73-74 with { signal } -> dashboard-years.js:38 fresh closure starts dragging = null -> user releases button: new dashboard-years.js:70 onUp() sees dragging === null and returns without calling onFiltersChanged (old closure's onUp is already detached) -> dashboard-years.js:66 value written by onMove survives because dashboard-rail.js:149-150 only seeds yearA/yearB when null -> dashboard-filters.js:156-168 onFiltersChanged (sole caller of _pushUrlState, debouncedHit, debouncedRefresh, renderActiveFilters) never runs -> dashboard.html:4191-4192 post-buildRail code calls only refreshFacetUI, so no compensating refresh. Same hazard at the earlier re-binds dashboard.html:4072 and dashboard.html:4118.

**Fix direction.** Hoist the drag flag to module scope and either early-return from bindYearSlider while a drag is in flight, or call onUp()/onFiltersChanged() to commit before _yearSliderAbort.abort().

### G-01 — S3 · C4 · [dashboard-rail.js:660](dashboard-rail.js#L660)

**Claim.** Shift-clicking a body in the rail sets `state.focusMechanism` and navigates to the mechanism profile but never resets `state.mechScope`, so when the scope is 'family' or 'compare' the profile silently renders the family rollup / 3-family comparison and the clicked body is ignored â while `_pushUrlState()` writes an internally contradictory `fm=<body>&ms=family` URL.

**Scenario.** 1) Open the Mechanism profile and use the scope bar to pick "Family rollup" (dashboard-profiles.js:1186-1187 sets `state.mechScope='family'`; dashboard-route.js:29 serialises `ms=family`). 2) Go back to Overview. 3) Shift-click "CCPR" in the rail's RECOMMENDING BODY facet. rail.js:663 sets `state.focusMechanism='CCPR'`, `#tabMechanism` reads "CCPR", `navigate('mechanism')` runs. 4) `renderMechanism` reads `const scope = state.mechScope || 'single'` (dashboard-profiles.js:916) → still 'family', so it takes the `scope === 'family'` branch (profiles.js:1013-1022) and paints the Treaty-Bodies rollup titled "Treaty Bodies / FAMILY ROLLUP · 12 bodies" with `filterOverride = { body: new Set(bodiesInFamily('treaty')) }`. The user asked for CCPR and gets all 12 committees. `navigate()` then calls `_pushUrlState()` (dashboard.html:3465) producing `#view=mechanism&fm=CCPR&ms=family`; anyone opening that citation URL also lands on the family rollup, not CCPR. The mechanism-profile empty state itself advertises "shift-click a body in the rail" (profiles.js:1043) as the way to select a single body, so this contradicts the module's own documented contract.

```js
  el.querySelectorAll('.opt').forEach(o => o.addEventListener('click', (ev) => {
    const k = o.dataset.k;
    if (ev.shiftKey) {
      state.focusMechanism = k;
      $('#tabMechanism').textContent = k;
      navigate('mechanism');
      return;
    }
```

**Verifier's independent trace.** dashboard-data.js:121 (`mechScope: 'single'` default) → dashboard-profiles.js:1184-1187 (`_wireScopeBar` sets `state.mechScope='family'`, no other writer) → dashboard-route.js:29 (serialised as `ms=family`) → user leaves to overview; grep shows no site resets mechScope except dashboard-route.js:95 inside `_resetRouteState`, called only from dashboard-route.js:112 (`_applyRouteStateFromHash`) → dashboard-rail.js:663-665 (shift-click in `buildBodyFacetGrouped` sets `state.focusMechanism=k`, writes `#tabMechanism`, calls `navigate('mechanism')`; mechScope untouched) → dashboard.html:3424-3465 (`navigate` sets view, calls `_pushUrlState()` at 3465 → dashboard-route.js:27+29 emit `fm=CCPR&ms=family`) → dashboard.html:3474 (`await renderMechanism()`) → dashboard-profiles.js:916 (`const scope = state.mechScope || 'single'` → 'family') → dashboard-profiles.js:1015-1023 (family branch: `filterOverride = { body: new Set(bodiesInFamily(state.focusFamily)) }`, eyebrow `FAMILY ROLLUP · N bodies`; `state.focusMechanism` is never read in this branch) → dashboard.html:3482 `_syncRouteTabLabels()` → dashboard-route.js:56-60 overwrites the tab label back to the family name. Same missing reset at the other five entry points: dashboard-rail.js:268, dashboard-rail.js:320, dashboard.html:2879, dashboard.html:2964, dashboard-ui.js:145, dashboard-drawer-list.js:311.

**Line corrections by the verifier.** dashboard-profiles.js:1046 (empty-state "shift-click a body in the rail" copy, claim said 1043); dashboard-profiles.js:1015-1023 (family branch, claim said 1013-1022). Primary anchor dashboard-rail.js:660-667 is exact.

**Fix direction.** Set `state.mechScope = 'single'` alongside every `state.focusMechanism = k` assignment (or, better, reconcile once in renderMechanism/navigate) so choosing a specific body implies single-body scope.

### A-02 — S3 · C4 · [dashboard.html:4168](dashboard.html#L4168)

**Claim.** The hashchange handler runs the full route-reset pipeline on ANY hash change, including the plain in-page anchor `#main` emitted by the 'Skip to main content' link (dashboard.html:2467), so activating that link silently wipes every filter, focus entity and the current view.

**Scenario.** A keyboard or screen-reader user applies filters (URL becomes e.g. `#view=search&q=torture&country=Poland`), then Tabs to the sr-only 'Skip to main content' link and presses Enter. That anchor has no data-nav, so the delegated [data-nav] handler at 3974 never preventDefault()s it; the browser sets location.hash to '#main' and fires hashchange. This handler calls _applyRouteStateFromHash('#main'), whose first act is _resetRouteState() - state.filters is replaced with emptyFilters(), focusCountry/Theme/Group/Sdg/Mechanism are nulled and state.view is forced to 'overview'. _restoreUrlState('main') then restores nothing (URLSearchParams('main') yields no known keys), navigate('overview') repaints, and _pushUrlState() rewrites the address bar with no hash at all. The user's entire query is gone, unrecoverably (reload restores nothing), with no message.

```js
  // Re-apply URL state on hash-only changes (browser back/forward, or any
  // programmatic location.hash write from outside the app). Without this
  // _restoreUrlState only ran at boot - clicking Back after drilling into
  // a theme profile would update the address bar but leave the view stale.
  window.addEventListener('hashchange', async () => {
    await _applyRouteStateFromHash(location.hash);
  });
```

**Verifier's independent trace.** dashboard.html:2467 (a#skipMain href="#main", no data-nav, no bound listener — grep for "skipMain" hits only HTML) → dashboard.html:3974-3979 (delegated [data-nav] click: e.target.closest('[data-nav]') is null → early return, no preventDefault; browser sets location.hash='#main' and fires hashchange) → dashboard.html:4172-4174 (unconditional `await _applyRouteStateFromHash(location.hash)`) → dashboard-route.js:112 `_resetRouteState()` → dashboard-route.js:87-101 (state.filters = emptyFilters(); focusCountry/Theme/Group/Sdg/Mechanism/Family=null; mechScope='single'; cmpA/cmpB=null; view='overview'; regionTaxonomy='m49') → dashboard-route.js:113 `_restoreUrlState('main')` → dashboard-route.js:122-123 (h='main' is truthy so the `if (!h) return` bail is skipped; new URLSearchParams('main') yields key 'main'='' and every p.get('q'|'country'|'view'|'fc'|…) is null → nothing restored) → dashboard-route.js:118 `await navigate('overview')` → dashboard.html:3411,3464 `_pushUrlState()` → dashboard-route.js:33-35 (history.replaceState to pathname+search, hash removed entirely). Net: filters, focus entities and view silently gone, address bar left with no hash, no toast/announce.

**Line corrections by the verifier.** dashboard.html:4168-4174 (anchor correct; the comment uses an em dash, not the hyphen shown in the claim's evidence)

**Fix direction.** Either bind a click handler on #skipMain that preventDefaults and calls $('#main').focus(), or gate the hashchange handler so it ignores hashes that carry no recognised route key (e.g. bail when the hash contains no '=' ).

### A-03 — S3 · C5 · [dashboard.html:3339](dashboard.html#L3339)

**Claim.** renderOverview's analytics rejection path removes neither the '.pending' class nor the previous filter's rendered numbers, so a failed analytics call leaves the last filter's data on screen under a permanently pulsing 'RECOMPUTING FOR CURRENT FILTER...' badge with no error surfaced.

**Scenario.** User is on Overview with country=France applied (panels show France's Top themes / groups / timeline). They add theme=Torture. onFiltersChanged -> debouncedRefresh -> refreshCurrentView -> renderOverview({keepPrevious:true}), which adds 'pending' to .p-top-themes, .p-time and .p-sankey at 3325-3328. The /analytics request 5xx-es (or times out). The `.then` that both repaints the panels and strips 'pending' is skipped; the `.catch` only console.warns and returns null. `root.classList.remove('updating')` still runs at 3353, so the whole-view refresh indicator clears and the view looks settled. Result: France-only numbers are displayed while the rail says France + Torture, each panel carrying the CSS pseudo-element from dashboard.html:711 that reads 'recomputing for current filter...' forever. No toast, no red state - a researcher reads and cites the wrong aggregate.

```js
  const anP = api.analytics(state.filters).then(d => {
    state.analytics = d;
    renderOverviewAnalytics(d);
    // Clear pending state on the themes/groups/timeline panels
    ['.p-top-themes', '.p-time', '.p-sankey'].forEach(sel => {
      const el = root.querySelector(sel); if (el) el.classList.remove('pending');
    });
    return d;
  }).catch(err => {
    if (err.name !== 'AbortError') console.warn('analytics failed', err);
    return null;
  });
```

**Verifier's independent trace.** dashboard-rail.js:136 onFiltersChanged -> dashboard-filters.js:156 -> :161 debouncedRefresh -> :135 -> :170 refreshCurrentView -> :173 renderOverview({keepPrevious:true}) -> dashboard.html:3303 buildOverviewShell (early return at 3063, prior rows kept) -> dashboard.html:3324-3328 add 'pending' to .p-top-themes/.p-time/.p-sankey -> dashboard.html:3339 api.analytics -> dashboard-data.js:359 -> dashboard-data.js:294 apiGet -> dashboard-data.js:331-336 throws on !res.ok -> dashboard.html:3347-3350 catch swallows, returns null (3341-3345 skipped, 'pending' never removed, state.analytics keeps prior filter's object) -> dashboard.html:3353 remove('updating') -> dashboard-filters.js:181-183 _slowLoadClear removes the slow-load banner. Secondary silent-data path: state.analytics stale + DOM-scraping CSV export at dashboard.html:3199-3208 copies the previous filter's rows and toasts "Copied N rows as CSV" with no staleness marker.

**Fix direction.** Give the analytics promise a non-Abort catch branch that strips 'pending', swaps in a failed/stale panel state (or clears the panels), and raises the same toast boot already uses at dashboard.html:4226.

### C-05 — S3 · C5 · [dashboard-labels.js:834](dashboard-labels.js#L834)

**Claim.** `renderRuleCard` re-emits the peek panel's "Loading peekâ¦" placeholder whenever `_peekOpen[rule.id]` is true, but `rulesLoadPeek()` is called only from the `peek` toggle action (L1111), so any subsequent `renderRules()` wipes the fetched peek and strands it on "Loading peekâ¦" forever.

**Scenario.** User clicks 👁 on a rule; the 5 example records load. Still watching them, the user types another term into that rule's MUST input and presses Enter — the keydown handler calls `renderRules()` (L1015). The card is rebuilt, `state.rules._peekOpen[id]` is still true so the peek div is re-created with the placeholder, `peekEl._peekRecs` is lost, and nothing re-issues the fetch. The panel shows "Loading peek…" indefinitely and clicking an example does nothing (`open()` returns early on the missing `_peekRecs`, L1144). The same happens to every open peek when any *other* rule is edited, a rule is deleted, or a set is saved. Recovery requires toggling 👁 off and on again; there is no error or spinner-timeout to explain it.

```js
        ${state.rules._peekOpen[rule.id] ? `<div class="rule-peek" data-peek="${sanitize(rule.id)}"><span class="pk-loading">Loading peek…</span></div>` : ''}
```

**Verifier's independent trace.** dashboard.html:2372 (nav data-nav="labels") → dashboard.html:3479 (view==='labels' → renderRules()) → dashboard-labels.js:808 (👁 button data-act="peek") → dashboard-labels.js:1107-1111 (_peekOpen[id]=true; renderRules(); rulesLoadPeek(rule)) → dashboard-labels.js:1179-1201 (api.records fills el.innerHTML and stashes el._peekRecs) → dashboard-labels.js:1013-1016 (term-input Enter → rulesAddTerm + renderRules()) → dashboard-labels.js:714 (root.innerHTML = ... destroys peek DOM and _peekRecs) → dashboard-labels.js:834 (_peekOpen still true → placeholder re-emitted, no fetch) → dead end: rulesLoadPeek call sites = {1111} only (grep -rn across *.js/*.html)

**Line corrections by the verifier.** dashboard-labels.js:834 (anchor correct). One claim detail is overstated: after the rebuild there are no `.pk` elements at all, so the L1144 `_peekRecs` early-return is never even reached — clicks are inert because the examples are gone, not because the cache lookup fails. Outcome is unchanged.

**Fix direction.** At the end of rulesBindEvents (or after renderRules' innerHTML assignment), re-issue rulesLoadPeek for every rule whose state.rules._peekOpen[id] is true, rather than only from the open-toggle branch at L1111.

### H-03 — S3 · C9 · [dashboard-drawer-list.js:224](dashboard-drawer-list.js#L224)

**Claim.** The drawer list's "clear rail Ã" handler clears state.filters.sdg but never clears state.filters.sdgExact, so an SDG-target filter silently survives a full rail clear and keeps narrowing the drawer count, the exported file and the shared URL.

**Scenario.** Researcher selects an SDG *target* (not a goal) in the rail — e.g. target 1.1 — which populates state.filters.sdgExact (dashboard-helpers.js:359 returns {sdg:new Set(), sdgExact:new Set([canonical])}) and is serialised to the URL as `sdgx` (dashboard-route.js:17). They then open a theme drawer list (kind='theme'), see the "also filtered by" breadcrumb, and click "clear rail ×". The handler resets country/body/theme/group/sdg/region/type/kw and the year range but leaves f.sdgExact populated. state.drawerList is rebuilt and loadMoreListDrawer() refetches — the list, the "N matching records" head and any Markdown/XLSX export from that drawer are still restricted to SDG target 1.1, and onFiltersChanged() → _pushUrlState() writes a URL that still carries sdgx. The equivalent profile-level control does clear it: dashboard.html:2612 reads `if (excludeKey !== 'sdg') { f.sdg = new Set(); f.sdgExact = new Set(); }`. Result is two "clear rail" buttons in the same app that produce different record counts for the same starting state.

```js
    const f = state.filters;
    if (ctx.kind !== 'country') f.country = new Set();
    if (ctx.kind !== 'body')    f.body    = new Set();
    if (ctx.kind !== 'theme')   f.theme   = new Set();
    if (ctx.kind !== 'group')   f.group   = new Set();
    if (ctx.kind !== 'sdg')     f.sdg     = new Set();
    f.region = new Set(); f.type = new Set(); f.kw = '';
    const minY = state.facets?.min_year, maxY = state.facets?.max_year;
```

**Verifier's independent trace.** dashboard.html:3281-3284 (Overview "Top SDGs" rows keyed by target-level sdg_counts) -> dashboard.html:2972 shift-click / dashboard.html:2863 action-sheet "Add to rail filter" -> dashboard-helpers.js:337-347 _sdgToggleFilter sets state.filters.sdgExact -> dashboard-drawer-list.js:11-23 openListDrawer('theme', value) -> dashboard-drawer-list.js:188-195 breadcrumb rendered because dashboard.html:2636 counts sdgExact -> dashboard-drawer-list.js:223-240 click handler clears f.sdg (229) but not f.sdgExact -> dashboard-drawer-list.js:71-93 listDrawerFilter -> dashboard.html:2577 _scopedFilter copies sdgExact -> dashboard-data.js:186-187 buildParams emits sdgs=SDG 1.1 -> dashboard-drawer-list.js:116 api.records: ctx.total and ctx.records still target-scoped -> dashboard-drawer-list.js:388-424/429+ export uses those records -> dashboard-filters.js:162 _pushUrlState -> dashboard-route.js:17 writes sdgx (restored at dashboard-route.js:140). Contrast: dashboard.html:2612 clears both sdg and sdgExact.

**Line corrections by the verifier.** dashboard-drawer-list.js:223-240 (anchor 224-231 correct)

**Fix direction.** In dashboard-drawer-list.js:229 make the sdg branch clear both sets, matching dashboard.html:2612: if (ctx.kind !== 'sdg') { f.sdg = new Set(); f.sdgExact = new Set(); }

### D-03 — S3 · C9 · [dashboard-timeline.js:403](dashboard-timeline.js#L403)

**Claim.** The timeline tooltip builds its breakdown rows from the raw yearlyBodyCounts while the headline total comes from annualTotals, which has hidden legend layers zeroed â so after any legend toggle the rows sum to more than the total the same tooltip displays.

**Scenario.** Overview FIG.04 (default route, stackBy 'family'). User clicks the 'UPR' legend chip to hide it (L314-323 adds 'upr' to state._hiddenBodies and re-renders). stacks/annualTotals now exclude UPR (L145-147), so the chart and the tooltip header show e.g. '2019 · 4,000 records'. renderTooltip re-aggregates yearMap over ALL bodies (L410-414) and emits a row for every stackKey with count>0, so the UPR row still shows its full 3,000 — the three rows now add up to 7,000 under a 4,000 header. Same in body mode: namedKeys (L420) still contains hidden body names, so a hidden body keeps appearing in the top-3 rows. The code comment at L330-332 asserts the opposite ('so numbers match what the user sees in the stack').

```js
  const renderTooltip = (yearIdx, clientX, clientY) => {
    const year = years[yearIdx];
    const total = mode === 'cumulative' ? cumulTotals[yearIdx] : annualTotals[yearIdx];

    const yearMap = yearlyBodyCounts[year] || {};
    let breakdownRows = [];
    if (stackBy === 'family') {
      const agg = { upr: 0, treaty: 0, sp: 0, other: 0 };
      Object.entries(yearMap).forEach(([b, c]) => { agg[classifyBody(b)] += c; });
      breakdownRows = stackKeys
```

**Verifier's independent trace.** dashboard.html:3292 renderTimeline($('#tlWrap'), analytics.trends.yearly_body_counts, {legendEl:$('#tlLegend') when mode==='annual', stackBy:'family'}) → dashboard-timeline.js:58 yearlyBodyCounts = _normalizeYearlyBodyCounts(raw) (unfiltered) → dashboard-timeline.js:84 stackKeys=['upr','treaty','sp'] fixed → dashboard-timeline.js:305-322 legend chip click adds key to state._hiddenBodies and re-renders → dashboard-timeline.js:145-147 stacks zero hidden layers; annualTotals = sum of visible only → dashboard-timeline.js:332-337 _wireTimelineTooltip receives BOTH the unfiltered yearlyBodyCounts and the filtered annualTotals → dashboard-timeline.js:405 total = annualTotals[yearIdx] (excludes hidden) vs dashboard-timeline.js:407-414 agg built over every body in yearMap, rows emitted for all stackKeys with count>0 (includes hidden) → dashboard-timeline.js:441-450 rows + header rendered into the same card; body mode has the identical fault at L419-424 where namedKeys retains hidden body names. Hover handlers wired at L470/L487 regardless of opts.interactive.

**Line corrections by the verifier.** dashboard-timeline.js:403-437 (accurate; the mismatch originates at dashboard-timeline.js:145-147)

**Fix direction.** Filter the tooltip's breakdown rows through the same `state._hiddenBodies` set used at L145 (drop hidden stackKeys in family mode, and hidden bodies from namedKeys/otherBodies in body mode) so rows always sum to the displayed header total.

### B-04 — S3 · C9 · [dashboard-profiles.js:454](dashboard-profiles.js#L454)

**Claim.** The Theme, Group and Mechanism switcher dropdowns annotate their options with UNFILTERED baseline totals (`state.baselineAnalytics` via `_profilePickerAnalytics()`, and `state.analytics` via `_bodyTotalsFromAnalytics()`/`_computeMechCounts()`) while the profile body beside them renders rail-FILTERED data via `_scopedFilter`, with no scope label on either. The Country profile guards against exactly this and the other four do not.

**Scenario.** Open the shareable deep link `#view=theme&ft=Reservations&country=Kenya` (or apply any rail filter, then use the profile-type switcher to reach Theme). `_loadProfile('theme','Reservations',…)` intersects the rail, so `#thKpis` Total shows the Kenya∩Reservations count — say 24. `#thSelect`, built at L457 from `state.baselineAnalytics.themes.theme_counts` (always the unfiltered `api.analytics({})` payload set in boot), shows `Reservations · 2,540`. Both numbers describe "Reservations" and sit in the same header. renderCountry documents this precise failure and avoids it — L299-302: "Cached all-country totals are only valid for the unfiltered profile. Under keyword/rail filters they read as a mixed scope ('China · 2,540' beside a 24-record profile)" — and it both suppresses the counts and relabels its picker to 'Switch country · current filters' (L303-306, L346). No equivalent exists for theme, group or mechanism. `refreshCurrentView()` (dashboard-filters.js:170) re-renders these profiles on every rail change without ever refreshing the count source, so the mismatch persists for the whole session.

```js
  const themeCountList = _profilePickerAnalytics()?.themes?.theme_counts || [];
  const themesList = themeCountList.map(t => t.theme);
  const themeCountsByKey = Object.fromEntries(themeCountList.map(t => [t.theme, t.count]));
  const opts = _dropdownOptionsWithCount(themesList, name, themeCountsByKey);
```

**Verifier's independent trace.** dashboard.html:4180 state.baselineAnalytics = await api.analytics({})  [unfiltered, boot] -> dashboard-profiles.js:102-104 _profilePickerAnalytics() returns state.baselineAnalytics -> dashboard-profiles.js:207-213 _ensureProfilePickerAnalytics() short-circuits on it, never rescopes -> dashboard-profiles.js:454-457 themeCountsByKey built from theme_counts[].count -> dashboard-rail.js:542-549 _dropdownOptionsWithCount emits `${name} · ${fmt(c)}` -> dashboard-profiles.js:469 rendered into #thSelect (collapsed select shows the selected option's tail) || CONTRASTING BODY PATH: dashboard-profiles.js:490 _scopedFilter({theme:...}) -> dashboard.html:2567-2586 intersects every other rail dimension (country, kw, year) -> dashboard-profiles.js:495 _loadProfile -> L501/507-508 total = count.total_records painted into #thKpis, one DOM block above the select || NO-REPAIR PATH: dashboard-profiles.js:485-487 _ensureProfilePickerAnalytics().then(_refreshThemePicker) -> L215-224 rebuilds options from the same unfiltered rows || PERSISTENCE: dashboard-filters.js:170-176 refreshCurrentView() awaits renderTheme() on every rail change, re-entering L454 with the unchanged baseline || ABSENT GUARD: dashboard-profiles.js:298/303-306/346 renderCountry gates on _railIsEmpty(countryPickerFilter), passes null counts and relabels to 'Switch country · current filters'; grep shows _railIsEmpty appears at profiles.js:298 and 346 only || ALSO_AT: L576-579 (group, same baseline source), L1025 _computeMechCounts and L1064 _bodyTotalsFromAnalytics both read state.analytics, overwritten filtered at dashboard.html:3340 || REACHABILITY: dashboard-route.js:24 serialises ft=, L151 restores state.focusTheme, so #view=theme&ft=Reservations&country=Kenya is a genuine shareable deep link.

**Line corrections by the verifier.** dashboard-profiles.js:454-457 (anchor exact); taint-source correction for the mechanism sites: dashboard.html:3340 (state.analytics = filtered api.analytics(state.filters)), not the unfiltered baseline as claimed

**Fix direction.** Mirror renderCountry's guard in renderTheme/renderGroup/renderMechanism: pass null as countsByKey when !_railIsEmpty(_scopedFilter({<dim>: new Set()})) and suffix the picker <label> with "· current filters"; separately stop _computeMechCounts/_bodyTotalsFromAnalytics reading the filtered state.analytics and point them at state.baselineAnalytics so their scope is at least deterministic.

### E-02 — S3 · C9 · [dashboard-utils.js:797](dashboard-utils.js#L797)

**Claim.** `highlightKeyword` HTML-escapes the haystack before matching but never escapes the needle, so any query token containing `'`, `&`, `<`, `>` or `"` can never match â while `countMatches` runs the identical token regex against the RAW text, producing a keyword-match badge that contradicts the zero highlights rendered beside it.

**Scenario.** User types `children's` into the keyword box and opens any result. In `highlightKeyword`, line 798 turns the record text into `... children&#39;s rights ...`; `_kwTokens` yields the single token `children's`, and the alternation regex built at line 804 cannot match the escaped form, so line 805 returns text with zero `<mark>` elements. Meanwhile dashboard-drawer-list.js:159 calls `countMatches(fullTxt, kw)` on the unescaped `fullTxt`, which matches normally, and dashboard-drawer-list.js:165 renders the accent-coloured badge `3x "children's"` directly above a text block containing no highlight at all. The same split occurs in the reader (dashboard-reader.js:265 and :497). Result on the default search route: the UI asserts N matches in a record while giving the researcher no way to locate any of them; for a mixed query such as `children's rights` only the apostrophe-free token gets marked, so the highlight count silently under-reports. Apostrophes are routine in this corpus (children's rights, women's rights, indigenous peoples' rights).

```js
function highlightKeyword(text, kw) {
  const safe = sanitize(text);
  const tokens = _kwTokens(kw);
  if (!tokens.length) return safe;
  // Longest tokens first so "human rights" doesn't fragment when both
  // "human" and "human rights" would match.
  tokens.sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(' + tokens.map(_tokenToRegex).join('|') + ')', 'gi');
  return safe.replace(pattern, '<mark class="kw-match">$1</mark>');
}
```

**Verifier's independent trace.** dashboard-rail.js:728 (state.filters.kw = e.target.value, raw) → dashboard-drawer-list.js:147 (kw = state.filters.kw.trim()) → dashboard-drawer-list.js:159 countMatches(fullTxt, kw) → dashboard-utils.js:853-857 (regex from raw tokens vs RAW text → N>0) → dashboard-drawer-list.js:165 renders `${kwCount}× "…"` badge; sibling call dashboard-drawer-list.js:169 highlightKeyword(fullTxt, kw) → dashboard-utils.js:798 sanitize(text) → dashboard-helpers.js:107 ('→&#39;, &→&amp;) → dashboard-utils.js:790 _tokenToRegex → dashboard-helpers.js:108 escapeRegex (leaves ' and & literal, never entity-encodes) → dashboard-utils.js:804-805 pattern /(women's)/gi vs "women&#39;s" → 0 <mark>. Same pair at dashboard-reader.js:265+305 and dashboard-reader.js:497+510, where dashboard-reader.js:509 literally prints "highlighted — matched N× in this record". Corpus-independent instance: dashboard-helpers.js:223 → formatSdgLabel dashboard-helpers.js:262-270 → dashboard.html:2916 highlightKeyword(r.label, kw). Expand path: dashboard-search.js:104 highlightKeyword(full, kw) in _seSwapExpansion vs badge from dashboard-search.js:126.

**Fix direction.** Build the alternation from sanitize()-transformed tokens (escapeRegex(sanitize(tok))) so needle and haystack live in the same encoding space, in both _tokenToRegex consumers; countMatches must then match the same way or be fed the sanitized text.

### I-01 — S3 · C9 · [dashboard-ui.js:140](dashboard-ui.js#L140)

**Claim.** renderPalette() truncates the body list with `bodies.slice(0, 60)` BEFORE applying the query filter, so the last 10 of the dataset's 70 issuing bodies can never appear as a command-palette result â including UPR, the largest mechanism in the corpus.

**Scenario.** `state.facets.bodies` holds 70 entries (verified against the live UHRI facets: CAT … WG Women & girls, alphabetical). The filter/map on line 70 removes only '-' entries, so 70 survive; `.slice(0, 60)` then discards indices 60-69: SR Unilateral coercive measures, SR Violence against women, SR Water & sanitation, UPR, WG Arbitrary detention, WG Disappearances, WG Mercenaries, WG People of african descent, WG Transnational corporations, WG Women & girls. A user presses ⌘K on the default Overview route and types "UPR" (or "Violence against women", or any WG mandate): no BODY result is offered and there is no way to reach that mechanism profile from the palette, with no message explaining the omission. The cap is also redundant — `results.slice(0, 14)` on line 174 already bounds what is rendered — and countries/themes are deliberately NOT capped, so the asymmetry is unintentional.

```js
  bodies.slice(0, 60).forEach(b => {
    const s = scoreMatch(b);
    if (s < 0 && q) return;
    results.push({
      kind: 'BODY', label: b, sub: 'open mechanism profile', _score: q ? s - 10 : 30,
      action: () => { state.focusMechanism = b; $('#tabMechanism').textContent = b; closePalette(); navigate('mechanism'); }
    });
  });
```

**Verifier's independent trace.** dashboard.html:3606 (state.facets = await api.facets(), GET /api/data/facets) -> dashboard.html:4071/4100 (same assignment on the cached/offline boot paths) -> dashboard-ui.js:70 (filter drops only exact '-', 70 entries survive; corroborated by docs/api-schemas/v1/facets.json minItems:50 and by the read-only facets listing returning 70 names CAT..WG Women & girls) -> dashboard-ui.js:140 (bodies.slice(0, 60) discards indices 60-69: SR Unilateral coercive measures, SR Violence against women, SR Water & sanitation, UPR, WG Arbitrary detention, WG Disappearances, WG Mercenaries, WG People of african descent, WG Transnational corporations, WG Women & girls) -> dashboard-ui.js:141-142 (scoreMatch/query filter runs only over the 60 survivors, so no BODY result can ever be produced for the dropped 10) -> dashboard-ui.js:174 (results.slice(0, 14) is the actual render bound, making the 60-cap redundant) -> dashboard-ui.js:176-182 (#cmdResults rendered without any "results truncated" notice). Entry points, all unconditional chrome: dashboard.html:4006 (global Cmd/Ctrl+K keydown), dashboard.html:3713 (#cmdkBtn click), dashboard.html:3758 (#cmdInput input -> renderPalette), container markup dashboard.html:2454-2461. Ordering premise independently corroborated in-repo at dashboard-profiles.js:1062 ("Prevents UPR from sorting alphabetically between SR and WG bodies in the flat list"). Contrast (uncapped, proving the asymmetry is unintentional): dashboard-ui.js:122 themes, dashboard-ui.js:131 countries, dashboard-rail.js:87 rail body facet, dashboard-profiles.js:1036 mechanism switcher.

**Fix direction.** Delete the `.slice(0, 60)` at dashboard-ui.js:140 so bodies are filtered like countries and themes, since `results.slice(0, 14)` at line 174 already bounds what is rendered; if a pre-filter cap is still wanted, apply it after the scoreMatch filter rather than before.


## 4. Plausible — needs a runtime check

No finding ended in the `UNVERIFIABLE` state. Every verified claim could be settled by
reading the code alone, which is itself a small positive result: the defects found are
structural, not dependent on unknown API behaviour.

## 4b. Corrections made after the automated run

I re-checked the heaviest findings by hand, independently of the agents. Two corrections
follow, and they cut in opposite directions.

**SW3-01 should be S4, not S2.** The mechanism is real — the service worker's
`SHELL_ASSETS` list precaches five files and omits all twenty-one JavaScript files the
page loads. But the consequence claimed (a precached shell that renders as a dead page) is
largely self-healing: `sw.js:80-91` routes every `.js`, `.css` and `.html` request through
`networkFirst()`, which caches each successful response into the same `SHELL_CACHE`. Any
user who has loaded the page even once therefore has the scripts cached, and installing
the service worker requires loading the page. The residual risk is a partial cache if the
user goes offline mid-load. Worth tidying, not worth shipping urgently.

**A-01 is stronger than the finding states.** The finder claimed the Overview deep link
never re-renders with its restored filters. It is worse than that: `dashboard.html:4178`
issues `api.analytics({})` — an explicit *empty* filter object — and line 4184 paints that
result into the Overview whenever the current view is Overview. So the unfiltered figures
are not merely stale, they are actively re-fetched and re-painted after the filters have
been restored and their chips drawn. Meanwhile `refreshHitCount()` at line 4161 *does* use
the filters, so the hit count and the charts beside it disagree on the same screen.

**On the confirmation rate.** 33 of 34 confirmed is high enough to be worth flagging as a
methodological caveat rather than a triumph. Against it: the verifiers were visibly not
rubber-stamping — many corrected the finder's line numbers, one narrowed a claim by
proving a sub-path self-heals (C-04), another identified a *different and worse* instance
than the one claimed (D-01). Still, a single verifier per finding is the weakest form of
this design. Findings that would drive an expensive change deserve a second opinion, which
is what my own spot-checks above were for.


## 5. Refuted, and found-but-unverified

### 5a. Refuted by an independent verifier

- **J1-04** (dashboard-route.js:32, C4) — claim: _pushUrlState is the only URL writer in the app and it uses history.replaceState exclusively â there is not a single history.pushState call anywhere in the repo â so no in-app navigation ever crea
  - Disproof: The evidence snippet is verbatim at dashboard-route.js:32-36 and there is indeed no pushState in the repo, but the claim's two load-bearing assertions — "no in-app navigation ever creates a history entry" and the hashchange listener "can never be reached by in-app navigation" — are both disproved by two in-app anchors that perform default fragment navigation (which pushes a history entry AND fires hashchange): dashboard.html:2467 `<a class="sr-only sr-skip" href="#main" id="skipMain">` (grep shows zero listeners on #skipMain and no [data-nav], so the delegated preventDefault at dashboard.html:3976 never applies) and dashboard-map.js:978 `<a href="#view=methodology" data-close-popover="1">`, whose only handler is closeInfo (dashboard-map.js:1007, bound at :1033) which does not call preventDefault. The claim's harm model is also wrong: replaceState mutates the current entry in place, so Forward from index.html returns to dashboard.html at the last-written hash with every filter still encoded — the "entire filter session is gone" outcome does not occur. What survives is only that filter/view/compare changes deliberately do not accumulate history entries, which dashboard.html:3558 documents as intentional ("replaceState so the back button doesn't collect history entries"), fails loudly rather than silently, and is an objection to the routing design as such.


### 5b. Found but never verified (the run was cut short — see section 6)

54 deduplicated findings never reached a verifier. They are listed here as leads, not as defects: under this audit's default-refute rule an unverified claim carries no weight. Sorted by the finder's own proposed severity.

| id | sev | class | location | claim (finder's words, truncated) |
|---|---|---|---|---|
| SW1-01 | S1 | C1 | dashboard-profiles.js:308 | The country-profile eyebrow interpolates `state.focusCountry` into `root.innerHTML` with no `sanitize()`, while every sibling value on the same line ( |
| SW3-02 | S2 | C8 | dashboard-map.js:130 | When the CDN is unreachable, renderChoroplethMap catches internally and returns renderGridMap — the retired 22x12 grid that silently drops ~73 states  |
| H-02 | S2 | C9 | dashboard-offline.js:23 | offline._matches normalises the RECORD side of the country comparison with cleanCountryName() but not the FILTER side, so any rail country whose facet |
| SW1-02 | S2 | C1 | dashboard-timeline.js:240 | `modeHint` embeds a raw recommending-body name (`stackKeys[0]`, an API field) with only a leading-dash strip, then is interpolated unescaped into `con |
| J2-03 | S3 | C7 | dashboard-bug-report.js:80 | The module header states the widget captures "NOT ... anything that could include searched-keyword text" (lines 26-28), but `collectAutoContext` captu |
| J2-04 | S3 | C9 | dashboard-bug-report.js:149 | `buildMailtoUrl` encodes the body with `URLSearchParams.toString()`, which is `application/x-www-form-urlencoded` — every space becomes `+`. RFC 6068  |
| J1-05 | S3 | C5 | dashboard-data.js:325 | apiGet attaches no timeout to its fetch (the AbortController is only ever fired by supersession), and every request is funnelled through a hard two-sl |
| J1-06 | S3 | C2 | dashboard-data.js:80 | swr() converts AbortError into a RESOLVED null, which makes _loadProfile's supersession guard (`res.find(x => x.status === 'rejected' && x.reason.name |
| H-06 | S3 | C5 | dashboard-drawer-list.js:361 | The export "load all pages first" loop treats every loadMoreListDrawer() early-return as a completed page, so on an API error it re-requests the same  |
| H-07 | S3 | C9 | dashboard-drawer-list.js:290 | In the selection drawer (kind='selection') the two primary action buttons are dead: #drListFilter falls through every branch and still fires a success |
| F-03 | S3 | C5 | dashboard-filters.js:256 | The `refreshHitCount` failure path sets `state.totalHits = null` and blanks the rail counter, but never calls `renderScopeBanner()` — which the succes |
| C-06 | S3 | C9 | dashboard-labels.js:1234 | The ⚡ Suggest-terms modal counts positive/negative tags over the whole `tags` map (which is seeded from `rule.seedExamples`), while `suggestTerms()` o |
| C-07 | S3 | C9 | dashboard-labels.js:270 | `state.rules._sampleCache` is written once and never invalidated — no filter-change, rule-change or set-switch path clears it (grep: only L271/272/277 |
| D-05 | S3 | C2 | dashboard-map.js:130 | renderChoroplethMap awaits the ~160 KB CDN import and then writes container.innerHTML with no generation token or liveness check, so a hex render star |
| D-06 | S3 | C9 | dashboard-map.js:1043 | The hex tooltip computes Rank from the unpruned countryCounts while the displayed count comes from the region-pruned byIso, so a country dropped by th |
| D-07 | S3 | C9 | dashboard-map.js:1172 | In the grid fallback several ISO3 codes share one MAP_LAYOUT cell; the cell is labelled with the first ISO encountered but its click handler filters c |
| H-04 | S3 | C9 | dashboard-offline.js:181 | The Number.isFinite() guard meant to reject records with no publication date does not reject them, because Number('') === 0 is finite; missing dates t |
| H-05 | S3 | C2 | dashboard-offline.js:431 | updateOfflineBadge() checks offline.enabled only before its two awaits and never re-checks afterwards, so a late response paints Instant-Mode chrome b |
| J1-10 | S3 | C9 | dashboard-offline.js:637 | runOfflineDownload — a raw-fetch site that bypasses apiGet — hardcodes `dataset=cleaned` and ignores state.filters.dataset, so a user in raw mode who  |
| B-05 | S3 | C2 | dashboard-profiles.js:744 | `renderSDG` re-enters `navigate('sdg')` from the baseline-analytics callback, which rebuilds `root.innerHTML` wholesale and destroys the user's in-pro |
| G-03 | S3 | C2 | dashboard-rail.js:300 | `buildFacetList` unconditionally replaces `#f-<facet>`'s innerHTML, including the `.facet-filter` typeahead input. Because `buildRail()` re-runs when  |
| G-04 | S3 | C9 | dashboard-rail.js:424 | `renderMechTiles` computes each FIG.00 tile's share against `counts._total`, which `_computeMechCounts` defines as `upr + treaty + sp + other` (rail.j |
| I-03 | S3 | C9 | dashboard-reader.js:110 | For records with no UN document symbol, `_citeUrl()` returns a URL with an English sentence appended, and that composite string is written unescaped i |
| I-05 | S3 | C9 | dashboard-reader.js:404 | `_citeCurrentKey` is reassigned by a `mouseenter` handler on every `.cite-item`, and the `#citePreviewCopy` button sits below all five items inside th |
| I-07 | S3 | C5 | dashboard-reader.js:415 | Both citation-copy paths call `navigator.clipboard.writeText(...).then(onSuccess)` with no rejection handler and no guard on `navigator.clipboard`, so |
| F-04 | S3 | C4 | dashboard-search.js:331 | The #seSort change handler mutates `state.searchSort` and re-renders without calling `_pushUrlState()`; `searchSort` is absent from `_pushUrlState` (d |
| F-05 | S3 | C5 | dashboard-search.js:704 | The in-place error card in `loadNextSearchPage`'s catch is gated on `state.searchPage === 1`. When a page ≥ 2 fetch fails, nothing sets `state.searchE |
| D-04 | S3 | C9 | dashboard-timeline.js:227 | The HTML year-label row is positioned across 0–100% of the container while the plotted year columns occupy only pad.l…W-pad.r (4%–98%) of the same wid |
| I-04 | S3 | C9 | dashboard-ui.js:431 | The window-resize handler reads the drawer's live width and falls back to `DRAWER_W_DEFAULT` on a falsy value; because the drawer's resting state is c |
| I-06 | S3 | C10 | dashboard-ui.js:47 | Every non-first command-palette result is unreachable without a mouse: `openPalette` traps Tab on `#cmdInput`, the `.cmd-result` rows carry no tabinde |
| E-03 | S3 | C10 | dashboard-utils.js:263 | The hash-parameter fallback in `parseOhchrUrl` calls `take.call(fakeParams, ['country'])`, but `take` is an arrow function that closes over `p` and ne |
| E-04 | S3 | C5 | dashboard-utils.js:495 | `ensureXLSX` memoises the loader promise before it settles and never resets `_xlsxPromise` on failure, so a single CDN load error permanently disables |
| E-05 | S3 | C5 | dashboard-utils.js:1170 | `fetchRecordById` swallows every failure mode into a bare `null`, so the citation deep-link handler reports a network outage or a backend 5xx to the r |
| E-06 | S3 | C9 | dashboard-utils.js:408 | `parseUhriJson` accepts a records array whose id field is the snake_case `annotation_id`, but the entire downstream pipeline reads only the PascalCase |
| J1-09 | S3 | C5 | dashboard-utils.js:1160 | fetchRecordById — one of the 8 raw-fetch sites that bypass apiGet — collapses every failure mode (network error, CORS rejection, 5xx, malformed JSON,  |
| G-05 | S3 | C2 | dashboard-years.js:59 | The year-slider drag state is sticky: `onMove` never checks `e.buttons` and there is no pointer capture, no `touchcancel` handler and no blur/mouselea |
| A-05 | S3 | C5 | dashboard.html:4136 | The Phase-1 failure handler overwrites #view-overview's innerHTML with the error page but leaves root.dataset.built === '1' (set by buildOverviewShell |
| A-06 | S3 | C9 | dashboard.html:4094 | boot's two baseline requests pass a bare `{}` instead of state.filters, and buildParams() only emits `dataset=` when the field is truthy, so in raw-up |
| SW3-04 | S3 | C8 | sw.js:103 | networkFirst's offline fallback calls cache.match(req) without {ignoreSearch:true}, so any navigation carrying a query string misses the cached './das |
| J2-06 | S4 | C10 | dashboard-analytics.js:279 | `_gaInitialViewName` probes `window.state`, which is never assigned anywhere in the codebase — dashboard-data.js:89 declares `const state` (a top-leve |
| J2-07 | S4 | C9 | dashboard-analytics.js:144 | `has_quotes` tests `/["']/` — the character class includes the apostrophe, so any query containing an ordinary apostrophe is reported as a phrase-quot |
| SW3-05 | S4 | C6 | dashboard-analytics.js:279 | `state` is a top-level `const` in dashboard-data.js, which does not create a window property, so `window.state?.view` in _gaInitialViewName() is perma |
| SW2-01 | S4 | C3 | dashboard-bug-report.js:239 | Three document-level Escape handlers are removed only from inside their own handler, so every dismissal that does NOT go through Escape (button click, |
| C-09 | S4 | C7 | dashboard-labels.js:67 | The `state.rules` schema comment documents `_countInflight` as "ruleId → abortController", but `rulesScheduleCount` stores a `setTimeout` handle there |
| B-06 | S4 | C10 | dashboard-profiles.js:736 | `.replace(/^SDG /, 'SDG ')` replaces a string with itself — an identity operation at both L738 and L764. More broadly, every `$('#tab…').textContent = |
| G-06 | S4 | C10 | dashboard-rail.js:265 | The four shift-click profile branches inside `_buildFacetListInto` are unreachable: the function has exactly one call site (rail.js:227) and it always |
| G-07 | S4 | C10 | dashboard-rail.js:680 | The `visibleByHeader` tally in the body-facet typeahead is dead and structurally broken: DOM nodes used as object keys all stringify to "[object HTMLD |
| F-06 | S4 | C4 | dashboard-search.js:555 | The inline "Include all countries" handler in the empty-state card clears `state.filters.country` but omits `state.hexRegion = 'world'`, which every o |
| D-09 | S4 | C10 | dashboard-timeline.js:178 | The 'cumulative' and 'total-line' render branches (and the cumulTotals computation that feeds them) are unreachable: no caller can ever set opts.mode  |
| I-08 | S4 | C10 | dashboard-ui.js:202 | `_firstVisit` is a top-level const that is declared, advertised in the module header as part of the module's external surface, and referenced nowhere  |
| SW2-02 | S4 | C3 | dashboard-utils.js:672 | `backfillCountrySparklines` constructs a new IntersectionObserver on every call and never keeps a handle or calls `disconnect()` — the only one of the |
| A-07 | S4 | C10 | dashboard.html:3010 | renderRowList's `opts.onClick` branch is dead: none of the 32 call sites across dashboard-*.js, dashboard.html and tests/ passes an onClick option. |
| SW3-07 | S4 | C6 | dashboard.html:4243 | The `else { boot(); }` branch at the end of the inline spine would call boot() synchronously before any deferred module has executed, producing an imm |
| SW3-06 | S4 | C8 | sw.js:110 | The Google Fonts stylesheet can never enter FONT_CACHE because a cross-origin <link rel=stylesheet> without a crossorigin attribute yields an opaque r |


## 6. Coverage

### What was audited

All 20 `dashboard-*.js` modules (11,057 lines) and the inline spine of `dashboard.html`
(lines 2550-4248, ~1,700 lines) were read by a per-module finder, and the whole repository
was swept three more times for the three cross-cutting classes. Every agent worked from
the same ten-class checklist, so a class not reported by a group was looked for there.

| Group | Files | Lines |
|---|---|--:|
| A | `dashboard.html` spine L2550-4248 (+ inline-handler skim of L1-2529) | ~1,700 |
| B | `dashboard-profiles.js` | 1,437 |
| C | `dashboard-labels.js` | 1,421 |
| D | `dashboard-map.js`, `dashboard-timeline.js` | 1,784 |
| E | `dashboard-utils.js` | 1,185 |
| F | `dashboard-search.js`, `dashboard-filters.js` | 1,007 |
| G | `dashboard-rail.js`, `dashboard-years.js` | 850 |
| H | `dashboard-offline.js`, `dashboard-drawer-list.js` | 1,186 |
| I | `dashboard-reader.js`, `dashboard-ui.js` | 1,182 |
| J1 | `dashboard-helpers.js`, `dashboard-data.js`, `dashboard-route.js`, `sw.js` | 1,254 |
| J2 | `dashboard-methodology.js`, `dashboard-about.js`, `dashboard-analytics.js`, `dashboard-bug-report.js` | 908 |
| SW1 | every HTML-writing site in the repository | 118 sites |
| SW2 | every listener/observer registration, filtered to long-lived targets | 320 sites → 33 examined |
| SW3 | every top-level declaration, the service worker, the CDN dependencies | 434 names |

### The sanitize() coverage table

This was the mandated artifact of sweep SW1 and is the most reusable output of the audit,
independent of how many defects it produced. Totals: **118 HTML-writing sites, 110 safe in
text or quoted-attribute context, 5 in URL context (all safe — none accepts an
attacker-controllable scheme), 3 carrying unescaped dynamic values, of which 2 were filed
as findings.** Four further mentions were comments, not real sites. The full per-file
tally and the reasoning for each negative result are in the SW1 coverage note below.

Three C1 sub-classes were checked and found entirely absent: JavaScript-in-attribute
interpolation (the `&#39;`-breaks-out-of-a-string class), unquoted attribute
interpolation, and sanitize-then-decode round trips (`decodeURIComponent` does not appear
anywhere in the codebase).

### What was not audited

The FastAPI backend (a different repository and machine), the CSS, the Playwright suites
themselves, `node_modules`, `web-vitals.js`, and application behaviour and user experience
— the last of these because the two prior audits covered it and this run was told not to
repeat their ground. The static DOM shell in `dashboard.html` lines 1-2529 received only a
targeted skim for inline handlers and duplicate ids, not a full read. The known open
backend issues (the FTS5 `NOT` clause leak, 500s on special-character queries, `/summary`
latency) were excluded by instruction and are unaffected by this audit.

### What the run did not finish

The workflow was terminated during the verification phase by a monthly account spend
limit, after 48 of 59 agents completed. All 14 finders finished; 34 of the 88 unique
findings were verified. The 54 unverified findings in section 5b are therefore leads
awaiting adjudication, not results. Two verifiers (C-05, D-03) completed while the
harness's safety classifier was unavailable; I re-read both findings against the source
and they hold, but they carry marginally less assurance than the rest.

No file in the repository was modified during the audit: every agent was read-only and
`git status` was clean afterwards. This report is the only artifact.


### Per-agent coverage notes

**A spine.** I read the full inline spine of dashboard.html (L2550-4248) line by line - _scopedFilter/_renderRailNoteInto/_activeRailDescription, the export helpers (doExport, downloadBlob, toCSV), announce/progressBar/cacheGet/cacheSet/toast/setStatus, _attachLongPress/_openRowActionSheet, renderRowList, refreshFacetUI, the skeleton + buildOverviewShell/renderOverviewMapOnly/_wireMapModeToggle/_wireTimelineModeToggle/renderOverviewAnalytics/renderOverview block, bindMainSearch, the navigate() dispatcher, closeDrawerPanelSafe, the whole dataset-toggle group (DS_KEY through initDatasetToggle) and all of boot(). To disprove candidates I also read dashboard-route.js in full, dashboard-data.js in full (apiGet/scope-abort/gate/api surface), and the relevant parts of dashboard-filters.js (onFiltersChanged, refreshCurrentView, refreshHitCount, debouncedRefresh), dashboard-rail.js (buildRail, buildFacetList, classifyBody, bindKwInput, debouncedKw), dashboard-utils.js (highlightKeyword, _kwTokens, _tokenToRegex, backfillCountrySparklines), dashboard-helpers.js emptyFilters, dashboard-offline.js api overrides, sw.js in full, and both prior audit docs plus tests/user-flows.spec.ts C10. Defect classes I checked and found clean: C1 - every HTML sink in the spine interpolates either a hardcoded literal, a numeric value, sanitize()-wrapped text in a text or quoted-attribute context, or highlightKeyword() output (which sanitizes before inserting <mark>); there are no inline on*= handlers, no dynamic href/src, and no unquoted dynamic attributes anywhere in the spine. C3 - every long-lived-target addEventListener in the spine is one-time boot wiring or guarded by a dataset.wired flag; the per-render listeners hang off .rl-row nodes destroyed by the next innerHTML replacement. C6 - I extracted every top-level function/const/let/var/class declaration from all 20 modules plus the spine and diffed for duplicates: zero collisions, so no SyntaxError-kills-a-script or silent-override hazards. The skim of the static DOM shell (L1-2529) was clean on both assigned checks: zero inline on*= handler attributes in the whole file and zero duplicate id attributes among the 115 ids in the shell. I did not report the CDN SRI issue because the skypack/jsdelivr imports live in dashboard-map.js and the XLSX loader in dashboard-utils.js, both outside my scope; likewise I left the missing dashboard-*.js entries in sw.js SHELL_ASSETS unreported because the fetch handler is network-first for scripts and caches them on first load, so no mixed-version shell results.

**B profiles.** Read all 1437 lines of dashboard-profiles.js in full (two passes), plus the supporting code every candidate depended on: dashboard-route.js in full (_pushUrlState uses replaceState only, _restoreUrlState, _resetRouteState, _syncRouteTabLabels), dashboard-data.js L40-120 (swr / swrGetStale — confirmed swr() swallows AbortError into a fulfilled null), L294-400 (apiGet's per-scope abort + memGet/pendingPromises dedupe, and the api.* scope strings: analytics/map are shared scopes, recordsCount and profile take per-entity scopes), L420-542 (_railIsEmpty, _loadProfile bundled vs split, _bundledProfileEndpointAvailable), dashboard-rail.js L500-575 (_computeMechCounts, _dropdownOptionsWithCount, _bodyDropdownGroupedOptions, _bodyTotalsFromAnalytics), dashboard-helpers.js L170-372 (emptyFilters, formatSdgLabel, the _sdg* family, MECH_FAMILIES), dashboard-filters.js L156-184 (onFiltersChanged / refreshCurrentView), and dashboard.html L2567-2600 (_scopedFilter, _renderRailNoteInto), L2887-2990 (renderRowList), L3218-3230 + L3325-3350 (where state.analytics is written), L3411-3485 (navigate — confirmed _pushUrlState runs BEFORE the renderer and _syncRouteTabLabels after), L4050-4200 (boot ordering). C1: classified all 35 innerHTML sites by context — every dynamic value reaches either a text node or a double-quoted attribute and is sanitize()-wrapped; there are no inline event-handler attributes, no href/src interpolation and no unquoted attributes in this module, and the SDG typeahead's highlight() slices before escaping (safe order), so I found nothing to report. I checked and dismissed two near-misses: `sanitize(r.PublicationDate).slice(0,10)` at L408 escapes before truncating (can only mangle an entity, never re-create '<'), and CSS.escape at L135 is valid inside a quoted attribute selector. C3: grepped the file for window/document/visualViewport/matchMedia/setInterval/ResizeObserver targets — there are none; every listener is on a child of a root whose innerHTML is replaced, and the single IntersectionObserver is disconnected on each _mountProfileSamples, so no leak survives. C6: verified all 24 top-level declarations are unique across all 20 dashboard-*.js files and dashboard.html. C4: I investigated and DISPROVED an initial suspicion that Compare's A/B pair never reaches the URL — boot calls _resolveCompareDefaults() before _restoreUrlState() and navigate() then serializes ca/cb, and _pushUrlState uses replaceState so the several double-push sites create no junk history; profileStackBy is documented as deliberately session-scoped. Not covered: I could not verify whether `state.facets.sdgs_hierarchy` ships exact counts (nothing in this repo populates it), so I deliberately anchored the sampled-count finding on the Group dropdown, whose only source is unambiguous, rather than the SDG one; and I could not evaluate the ~40-200 fan-out /summary calls _backfillPickerCounts issues when the Group/SDG picker opens, since that is a performance question outside the listed defect classes.

**C labels.** Read dashboard-labels.js end to end (all 1421 lines, in two passes), plus the collaborators its behaviour depends on: dashboard-data.js:440-480 (_railIsEmpty, state.totalHits declaration), dashboard-filters.js:95-266 (renderScopeBanner, onFiltersChanged, refreshCurrentView, refreshHitCount), dashboard-route.js in full (_pushUrlState/_restoreUrlState), and dashboard.html:3355-3490 (navigate dispatcher, #view-labels section at L2418). C1 was checked exhaustively and is clean: I classified all 24 interpolation sites reaching innerHTML in renderRules/renderRuleCard/renderRuleRow/rulesLoadPeek/rulesRenderSuggestModal/renderCoverageSummary — every dynamic value is sanitize()-wrapped in either a text-node or a double-quoted attribute context, there are no inline on* handlers with dynamic values, no href/src built from data (the only hrefs are literal "#"), no unquoted dynamic attributes, and no decodeURIComponent re-insertion; the localStorage/imported-JSON round trip (rule names, terms, raw queries) lands only in those safe contexts. C3 is clean: the single long-lived listener (document click for the overflow menu, L1170) is guarded by a `root._overflowOutsideBound` expando on the persistent #view-labels section, so it registers exactly once; every other listener is on a child of replaced innerHTML. C6 is clean: I grepped all top-level names declared here (LABELS_KEY, LABELS_ACTIVE_KEY, LABELS_STOPWORDS, RULES_*, RULES_COUNT_DEBOUNCE, RULES_STARTER_TEMPLATES, _sugState and the 30+ function declarations) across all dashboard-*.js, dashboard.html and tests/ — no duplicates and no initializer referencing a later-loaded name (RULES_STARTER_TEMPLATES is referenced only from function bodies). C4 is clean for this module: _pushUrlState uses replaceState so the _applyRuleAsActiveFilter → onFiltersChanged → navigate() pair creates no junk history, and rule sets are deliberately localStorage-scoped rather than URL-scoped. I did not audit C8 (service worker) or the legacy HTML files, which are out of my scope.

**D map+timeline.** I read dashboard-map.js (all 1259 lines, in two passes) and dashboard-timeline.js (all 525 lines) in full, plus the supporting code needed to confirm or refute each candidate: dashboard-helpers.js:25-105 (NAME_TO_ISO, MAP_LAYOUT, $/fmt/cssVar/sanitize), dashboard-rail.js:360-400 and 500-610 (classifyBody, aggregateMechanismCounts, the 'other' bucket), dashboard-data.js:155-190 (how state.filters.region becomes a countries= param), dashboard-filters.js:156-181 (onFiltersChanged), dashboard.html:3095-3175 and 3285-3300 (renderMap/renderTimeline call sites, mode toggles, .tl-wrap/.tl-years/.tl-svg CSS at 584-598 and 907-913), and sw.js:1-110. C1 came back clean: every interpolation in both files lands in a text node or a quoted attribute, all are sanitize()-wrapped or provably internal (path data from d3-geo, colours from cssVar/palette, ISO codes and hex geometry from the hardcoded HEX_LAYOUT), and neither file builds an inline event handler, an href/src, or an unquoted attribute from dynamic data. C6 came back clean: I grepped all 29 top-level declarations of both files across every dashboard-*.js and found no duplicate const/let/function and no initializer referencing a later-loaded name (HEX_LAYOUT is only touched from function bodies). C3 came back clean: the only long-lived-target listeners are the ⓘ popover's document click/keydown pair, which is bounded — any document click or Escape, including the one that opens a new popover, runs closeInfo() and detaches the stale pair; every other listener is on a child of a container whose innerHTML is replaced, and _tlSyncRegistry evicts entries whose container has left the DOM. C4 came back clean for these files: every filter-mutating handler (map shift-click, hex/grid click, timeline drag) ends in onFiltersChanged(), which calls _pushUrlState() at dashboard-filters.js:162. I also killed one candidate with live data — I checked the 70 body names in the UHRI corpus via list_uhri_facets and every one classifies as upr/treaty/sp, so the family-mode timeline's lack of an 'other' layer drops nothing today and I did not report it. I did not audit the choropleth pan/pinch geometry for numerical correctness beyond the clamp bounds, and I could not exercise the CDN-failure or region-filter paths at runtime, so D-01, D-02, D-06 and D-07 rest on static reading of the two count pipelines rather than observed output.

**E utils.** Read all 1185 lines of /Users/lszoszk/Desktop/AI/HURIDOCS/App/_repo_push/dashboard-utils.js in full, then verified every cross-module assumption against source rather than inference: sanitize/escapeRegex (dashboard-helpers.js:107-108), toast (dashboard.html:2752-2767), onFiltersChanged (dashboard-filters.js:156-168), the full route contract (dashboard-route.js:1-173), apiGet/api/buildParams and the request gate (dashboard-data.js:180-380), offline.enable/disable and its api monkey-patch (dashboard-offline.js:82-300), renderRowList and doExport (dashboard.html:2646-3030), renderOverviewAnalytics (dashboard.html:3219-3300), the dataset toggle (dashboard.html:3530-3610), the boot deep-link call site (dashboard.html:4232), and every consumer of countMatches/highlightKeyword in drawer-list.js and reader.js. C1 came back clean: I classified all 11 innerHTML sinks in the file by context and found no dynamic value in an inline-handler string, no interpolation into href/src (the only dynamic URLs are encodeURIComponent'd share links at lines 140-143), and no unquoted attribute — every dynamic value is sanitize()-wrapped in text or quoted-attribute position, and toast() uses textContent so the `?sel=` and localStorage-sourced strings never reach an HTML parser. C6 came back clean: I enumerated every top-level function/const/let/var declaration across all 20 modules and found zero duplicate bare names, and the file's only top-level side effects (state.diffPins at :954, the localStorage hydrate at :622) reference names declared in earlier scripts. C8 for this file is clean — the SheetJS CDN load carries a pinned sha384 integrity plus crossOrigin at lines 505-507, so no SRI finding applies here. What I could not cover: whether real uhri.ohchr.org search URLs actually place country values in the fragment (E-03's trigger shape is inferred from the code's own comment), and the exact facet-value formatting OHCHR emits, so I did not claim a value-format mismatch in applyOhchrUrlFilters. I also deliberately did not report the SW shell-asset list omitting dashboard-*.js, since that is a global service-worker concern outside this module's scope.

**F search+filters.** Read dashboard-search.js (all 741 lines) and dashboard-filters.js (all 266 lines) in full, plus every cross-module helper they call, to verify or refute each candidate: dashboard-helpers.js:99-107 (fmt/pct/sanitize/debounce) and :256-362 (SDG helpers), dashboard-utils.js:755-885 (highlightKeyword / _highlightTerms / _highlightOutsideMarks / countMatches / _kwTokens / _findBestCluster) and :276-285, dashboard-data.js:151-395 (buildParams, memCache, _gate, apiGet abort scoping, api.records/recordsCount), dashboard-route.js:1-140 (_pushUrlState / _resetRouteState / _restoreUrlState), dashboard.html:3028-3036 (refreshFacetUI) and the navigate() dispatcher, dashboard-rail.js:727-745 (#kwInput listener), dashboard-ui.js:154-168 (command palette), dashboard-drawer-list.js:28-52 and :315-340, dashboard-labels.js:502-512, dashboard-map.js:785-800. C1 was swept exhaustively as the stated priority and came back CLEAN: all 11 inline onclick strings in dashboard-search.js (182, 295, 535, 536, 553, 556, 557, 558, 559, 732, 733) contain only hardcoded JS — the one dynamic value on line 557 sits in the button's text-node context after the closing '>', not inside the handler string — and every other interpolation reaches a quoted attribute or text node through sanitize(); highlightKeyword() sanitizes internally, _highlightTerms/_highlightOutsideMarks only re-insert already-escaped $1 captures, and the <mark>-placeholder round-trip at lines 170-172 restores only literal mark tags, so no unescaped API text reaches innerHTML/insertAdjacentHTML in either file. C3 was checked and found clean: every listener in both files is bound to a node inside a container whose innerHTML is subsequently replaced (#view-search, #seList, #activeFilters, #scopeBanner, #slowLoadBanner), and _seObserver is disconnected in renderSearch and on exhaustion. C6 was checked and found clean: the top-level initializers in dashboard-filters.js (debouncedHit/debouncedRefresh/_announceHit at lines 134, 135, 226) reference debounce from dashboard-helpers.js:102, which loads first, and no bare name in either file is duplicated at top level elsewhere. Not covered: the runtime behaviour of _exportDrawerList, renderDrawer and refreshFacetUI beyond signature/guard checks, and the map/rail/labels modules themselves, which belong to other finders.

**G rail+years.** I read dashboard-rail.js (all 748 lines) and dashboard-years.js (all 102 lines) in full, then cross-checked every candidate against dashboard-route.js (full), dashboard-filters.js:20-270, dashboard-profiles.js:900-1100, dashboard-helpers.js (sanitize/cleanLabel/debounce/MECH_FAMILIES/SDG_NAMES), dashboard-offline.js:85-130, sw.js:1-100, docs/api-schemas/v1/{analytics,facets,summary}.json, and the buildRail/boot call sites in dashboard.html (2300-2330, 3020-3080, 3210-3300, 3411-3490, 3560-3690, 4050-4200). C1 came back clean and I checked it exhaustively: every template-literal sink in both files interpolates either a hardcoded literal (MECH_FAMILIES fields, optgroup labels, section titles), a provably numeric value (SDG index 1-17, fmt() counts, histogram year/height), or a sanitize()-wrapped value in text-node or double-quoted-attribute context — there is no inline onclick with a dynamic value, no href/src interpolation, and no unquoted attribute. C5 is vacuous here: neither file contains an await, fetch or apiGet. C6 is clean: I grepped all 25 top-level names declared by these two files across every dashboard-*.js, dashboard.html and sw.js and found no duplicate declaration, and the only two top-level initialisers (`const debouncedKw = debounce(...)` at rail.js:713, `const TREATY_BODY_ACRONYMS = new Set([...])` at rail.js:360) reference only earlier-loaded or literal values. For C3 I confirmed the two long-lived-target registrations are already guarded (`_railCollapseWired` at rail.js:69, and the AbortController in bindYearSlider) and I deliberately did not report the duplicate `#themeMatch`/`#groupMatch` click listeners added on each of the up-to-3 buildRail calls: I verified those buttons are siblings of #f-theme/#f-group (dashboard.html:2310/2314) so they survive the innerHTML rebuild, the handler is idempotent, and the only non-idempotent tail (`debouncedHit`/`debouncedRefresh`, dashboard-filters.js:134-135) is a trailing debounce that collapses — bounded and harmless per the suppression rule. C8 is a non-issue for these two files: sw.js:84-91 routes all .js network-first, so they cannot go stale relative to dashboard.html. I could not statically confirm whether the 'other' mechanism bucket is non-empty against the live VM dataset, which is why G-04 is medium confidence; likewise G-05 depends on browser mouseup delivery when the release happens outside the window, which I could not exercise under the read-only constraint.

**H offline+drawer.** I read both scope files end to end (dashboard-offline.js 1-733, dashboard-drawer-list.js 1-453) and then traced every candidate out into its callers and helpers: dashboard-data.js:294-396 (apiGet scope/abort semantics, the api object), dashboard-helpers.js:103-170 and 292-362 (sanitize, cleanLabel, cleanCountryName, cleanCountryList, the _sdg* family), dashboard-rail.js:60-145 and 292-332 (how facet values become state.filters entries), dashboard-utils.js:292-370 (the upload path into offline.enable), :797-858 (highlightKeyword/countMatches), dashboard-filters.js:156-184 (onFiltersChanged → _pushUrlState), dashboard-route.js:17/140 (sdgx serialisation), dashboard.html:2550-2660, 3875-3965, 4060-4110, and sw.js:1-40. C1 came back clean for my scope and I actively disproved the candidates: highlightKeyword sanitizes before inserting marks, _attrEscape and sanitize are only used in text-node or double-quoted-attribute contexts, toast() uses textContent, and there is no dynamic value interpolated into an inline handler, href/src, or unquoted attribute in either file. C4 also came back clean: every filter mutation in dashboard-drawer-list.js terminates in onFiltersChanged(), which calls _pushUrlState(). C3 produced only bounded, self-cleaning cases I deliberately dropped — showOfflineContextMenu's document mousedown/keydown pair survives a menu-item click but is removed by the very next mousedown or Escape, and _drListDocumentClick removes its predecessor before re-registering; the IntersectionObserver is disconnected before each re-create and in closeListDrawer. C6 was checked by grepping every top-level name in both files across all dashboard-*.js and the inline spine: no duplicate declarations and no initializer referencing a later-loaded name. I also disproved a promising C2 in loadMoreListDrawer — a second openListDrawer aborts the first via apiGet's scope:'drawerList' race guard, so no stale page-1 clobber — and a variant where a late response after closeListDrawer writes state.currentResultList, which I dropped for lack of an observable wrong outcome. Not covered: I could not verify the two data-dependent preconditions behind H-02 (an asterisked country label actually present in the live facets payload) and H-04 (a record with an empty PublicationDate), since running the app or hitting the API was out of bounds; both are supported by in-repo comments but rest on corpus content I could not inspect. I also did not audit the SW shell-asset list or the CDN SRI question, as those belong to the foundation group.

**I reader+ui.** I read dashboard-reader.js (all 538 lines) and dashboard-ui.js (all 644 lines) in full, then traced every cross-module symbol they touch: sanitize/escapeRegex/cleanCountryList/cleanCountryName/cleanLabel/cleanAnnotationType/_sdgToFilterValue (dashboard-helpers.js:103-305), highlightKeyword/countMatches/noteGet/handleSelParam/fetchRecordById (dashboard-utils.js:790-870, 1148-1183), toast/setStatus (dashboard.html:2745-2795), navigate/boot (dashboard.html:3411-3470, 4120-4247), onFiltersChanged (dashboard-filters.js:156-167), _pushUrlState/_restoreUrlState/_applyRouteStateFromHash (dashboard-route.js:1-172), _computeMechCounts/_openFamilyListDrawer (dashboard-rail.js:500-530) and renderMechanism/_wireScopeBar (dashboard-profiles.js:905-1200). I also read the relevant CSS (drawer grid columns, .cite-item/.cite-preview ordering, .cmd-result) in dashboard.html. C1 came back clean for both files: every interpolated value in renderDrawer, openReader, renderPalette, startTour and _showTourInvite is either a hardcoded literal, a number, or passed through sanitize() in a text-node or double-quoted-attribute context; there are no inline on* handlers with dynamic values, no dynamic href/src, no unquoted attributes, and highlightKeyword sanitizes before injecting <mark>. C6 came back clean: I counted top-level declarations for all 50 bare names these two files export and every one is declared exactly once, with no initializer referencing a later-loaded module. C3 came back mostly clean — the drawer swipe listeners on the persistent #drawerBody are correctly torn down by an AbortController, bindDrawerResize is idempotent via dataset.wired, and startTour removes both its document/window listeners in finish(); the one leaked listener I found (_showTourInvite's escInvite, which never self-removes once the chip is dismissed) is bounded to a single registration per page load and is a no-op, so I suppressed it. I did not audit the other 18 modules, the inline spine, sw.js or the legacy HTML files, and I could not verify runtime behaviour (read-only, no execution), so the ordering claim in I-01 rests on the live UHRI facets listing (70 bodies, alphabetical) rather than on the deployed /api/data/facets response — though the finding holds on the count alone.

**J1 plumbing.** Read in full: dashboard-helpers.js (382 lines), dashboard-data.js (542), dashboard-route.js (173), sw.js (157). Read targeted regions of the cross-file mandates: dashboard.html spine (2550-2600 _scopedFilter, 3320-3350 renderOverview api calls, 3440-3600 navigate + dataset toggle, 4090-4250 boot/hashchange), dashboard-filters.js 1-180 + 230-260, dashboard-profiles.js 1-140 + 330-500 + 960-1200 + 1235-1290, dashboard-map.js 108-135 + 700-780, dashboard-utils.js 190-235 + 490-540 + 620-745 + 1145-1185, dashboard-offline.js 425-455 + 620-680, dashboard-methodology.js 1-45, dashboard-rail.js 195-250. Mandate (i) sanitize(): the 5-char escaper at dashboard-helpers.js:107 is correct and complete for text-node and quoted-attribute contexts; I grepped every dashboard-*.js for dynamic interpolation into inline handler attributes, href=/src= URL contexts and unquoted data-attributes and found no dynamic value inside an inline handler string (dashboard-search.js:557-559 place sanitized text in element CONTENT, not in the onclick), no template-built href/src from API/hash/localStorage data, and no unquoted dynamic attributes; cleanLabel/cleanCountryName/cleanAnnotationType only strip characters and never re-introduce markup, and no site sanitizes then decodeURIComponent-s. Mandate (ii): all 8 raw-fetch sites enumerated and compared against apiGet — findings J1-09 (utils:1161) and J1-10 (offline:643) are the material gaps; utils:203 (feedback POST) and methodology:15/17 already check res.ok and surface/absorb failures acceptably; offline:438 and offline:643 correctly check res.ok. Mandate (iii): _pushUrlState has exactly three call sites (dashboard.html:3465, dashboard-filters.js:162, dashboard-profiles.js:1264); I traced every writer of state.view / focusCountry / focusTheme / focusGroup / focusSdg / focusMechanism / focusFamily / mechScope / cmpA / cmpB / regionTaxonomy and each funnels into navigate() or onFiltersChanged(), so no missing call site survived; field-by-field, _pushUrlState and _restoreUrlState are symmetric (dataset lives in location.search and is preserved by the `base` concatenation, not asymmetric), and the one real route defect is the replaceState-only history model (J1-04). Mandate (iv) apiGet semantics documented in J1-01/J1-03/J1-05/J1-06. C6 checked mechanically: extracted every top-level const/let/var/function/class declaration across all 20 modules plus the inline spine and diffed for duplicates — zero collisions, and no top-level initializer references a later-loaded name, so C6 is clean. Not covered by me: the render modules' own DOM sinks (ui, timeline, search, reader, drawer-list, labels, analytics, bug-report) beyond the four cross-file mandates, and listener-lifecycle auditing outside my four files.

**J2 leaf.** Read all four scoped files end to end (dashboard-methodology.js 1-222, dashboard-about.js 1-79, dashboard-analytics.js 1-311, dashboard-bug-report.js 1-296), plus the supporting context needed to confirm or refute each candidate: the gtag/Consent-Mode head script and web-vitals loader in dashboard.html (95-153), the navigate() analytics hook (dashboard.html 3455-3479), boot's route restore (dashboard.html 4150-4174), _pushUrlState (dashboard-route.js 1-36), the `state` declaration and `window.__state` export (dashboard-data.js 80-148), sw.js 1-30, sitemap.xml, and tests/analytics.spec.ts. Cross-checked every candidate against greps for the missing guard (`window.state`, `__state`, `__offline`, removeEventListener, page_location) before submitting. Checked and found clean: C1 — dashboard-about.js and renderMethodology contain no dynamic interpolation at all (only hardcoded literals into innerHTML), and the only unescaped API-derived value anywhere in my scope is `${st.seconds}` at dashboard-methodology.js:58 in a text-node context, whose source (refresh_status.json on the project's own nginx) is not outsider-influenceable, so I dropped it; no js-in-attribute, URL-context or unquoted-attribute sinks exist in these four files. C2 — renderFreshnessCard captures its card node before the await and can only paint a detached node after navigation, no observable race. C4 — none of these modules touch state.filters or the route; navigate() owns _pushUrlState. C6 — no top-level initializer in these files references a later-loaded name (API_BASE, $, sanitize, state are all call-time lookups inside function bodies). C8 — out of my scope. C10 — I explicitly checked the legacy-file question and it is a FALSE POSITIVE: dashboard2.html, index2.html and index-classic.html are each 21-line hash-preserving redirect stubs to ./dashboard.html with `robots: noindex` and a canonical link, deliberately kept alive for old bookmarks, so I filed no aggregate dead-code finding. One scope correction worth passing on: dashboard-bug-report.js does not POST anything to the backend — it only opens a prefilled GitHub issue URL or a mailto; the real `/api/feedback/report` POST lives at dashboard-utils.js:203 and belongs to another finder's scope. Not covered: the GA4 property's server-side Enhanced Measurement setting, which if enabled would let gtag.js emit scroll/outbound-click events (carrying the same page_location described in J2-01) outside this module's local consent gate — that cannot be confirmed from this repository.

**SW1 sanitize sweep.** Cross-cutting sweep 1 (class C1 for the whole repo). I enumerated every innerHTML / outerHTML / insertAdjacentHTML / createContextualFragment site with `grep -n -E "innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment"` across all 20 dashboard-*.js plus dashboard.html (118 real sites after discarding 4 comment-only mentions at rail:211, labels:613, search:85, timeline:225), then read each enclosing template in full and classified its sink context. I read dashboard-profiles.js and dashboard-route.js end to end, dashboard-search.js:60-741, dashboard-rail.js:30-748, dashboard-timeline.js:55-525, dashboard-utils.js:40-370 and 556-1185, dashboard-labels.js:540-1320, dashboard-map.js:176-1200, dashboard-reader.js:190-520, dashboard-offline.js:480-700, dashboard-filters.js:40-230, dashboard-ui.js:60-610, dashboard-methodology.js:1-135, dashboard-bug-report.js:80-240, dashboard-years.js, dashboard-drawer-list.js:144-215, dashboard-about.js, dashboard-analytics.js:225-250, and the dashboard.html spine sinks at 2596/2717/2844/2899/3006/3064/3188/3298/3702/4141. I also verified the escape primitives themselves (helpers.js:107 sanitize; offline.js:543 _attrEscape, a byte-identical duplicate), the two highlighters (utils.js:797 highlightKeyword and 815 _highlightTerms — both operate on already-sanitized text and re-insert only `$1` from the sanitized haystack, so neither reintroduces markup), and the search.js:170 mark-sentinel round-trip (only ever regenerates `<mark class="kw-match">`, not arbitrary tags).

PER-FILE TALLY — format: file: sites / text-or-quoted-attr context and fully escaped (safe) / JS-in-attribute or URL context / unescaped dynamic value.
profiles 35 / 34 / 0 / 1 (L311). search 10 / 10 / 0 / 0. rail 9 / 9 / 0 / 0. utils 10 / 6 / 4 URL (L140-143 mailto:/twitter/linkedin/bsky — fixed scheme + encodeURIComponent on every interpolant) / 0. dashboard.html 10 / 9 / 1 URL (L4146 href="${API_BASE}…", API_BASE is a hardcoded const at dashboard-data.js:6) / 0. labels 8 / 8 / 0 / 0. map 6 (+1 outerHTML SVG export) / 7 / 0 / 0. timeline 5 / 4 / 0 / 1 (L240→L250). filters 5 / 5 / 0 / 0. offline 4 / 4 / 0 / 0. ui 3 / 3 / 0 / 0. reader 3 / 3 / 0 / 0. methodology 3 / 2 / 0 / 1 low-risk residual (L65 `${st.seconds}` / `${banner}` from /refresh_status.json, our own nginx-served static file, not record- or user-influenced — noted, not filed). bug-report 2 / 2 / 0 / 0 (the auto-context goes via .textContent, not HTML). years 1 / 1 / 0 / 0 (all values numeric). drawer-list 1 / 1 / 0 / 0. about 1 / 1 / 0 / 0 (fully static). analytics 1 / 1 / 0 / 0 (fully static). TOTALS: 118 sites / 110 safe / 5 URL-context all safe / 3 unescaped, of which 2 are filed above.

Defect classes checked and found clean: (a) JS-IN-ATTRIBUTE — there are exactly 8 inline `onclick=` handlers in generated HTML (search.js:182, 295, 535, 536, 553, 556-559, 732, 733) and NOT ONE interpolates a dynamic value inside the handler string; the only dynamic bits nearby (`${sanitize(kwActive.slice(0,40))}` at :557, `${sanitize(kw.slice(0,80))}` at :721) sit in element text content after the `>`, where sanitize() is sufficient. So the `&#39;`-breaks-out-of-a-JS-string class does not occur anywhere in this repo. (b) UNQUOTED ATTRIBUTE — I found no `data-x=${v}` / `class=${v}` without quotes; every data-*/title/aria-label interpolation is quoted. (c) URL CONTEXT — the 5 sites are enumerated above; none takes an attacker-controllable scheme. (d) SANITIZE-THEN-DECODE — no decodeURIComponent anywhere in the codebase; the one attribute→JS round-trip (`tx.dataset.fullText`/`serverHints` in search.js:98-111) re-sanitizes through highlightKeyword before re-insertion. C9 double-encoding visible to the user: highlightKeyword can match inside an emitted entity (searching "amp" or "39" would split `&amp;` / `&#39;`), but no plausible research query triggers it, so I did not file it. Not covered / out of scope for this sweep: legacy dashboard2.html, index2.html, index-classic.html (foundation group owns those), and all non-C1 classes.

**SW2 listener sweep.** Scope was listener/observer lifecycle (C3) across the whole repo. I enumerated all 320 addEventListener sites in the 20 dashboard-*.js modules plus the dashboard.html spine, then filtered to long-lived targets (window, document, document.body, matchMedia, persistent static shell nodes with ids declared in dashboard.html markup, and container elements that survive innerHTML replacement) by mapping each site to its enclosing function with awk and checking every caller of that function; child-element listeners destroyed by an innerHTML reset were suppressed per the brief. That yielded 33 long-lived registrations examined (29 addEventListener + 4 IntersectionObserver constructions); 31 are correctly guarded and 2 are not. Guarded categories verified by reading the code, not by grep alone: 17 boot-only sites (dashboard.html 3626/3633/3733/3746/3752/3867/3974/3986/4002/4172/4244 all inside boot()/initDatasetToggle(), which run once from the DOMContentLoaded hook at 4244; bug-report 56/57/285; analytics 307 uses {once:true}; ui 446 via bindTweaks() called once at dashboard.html:3669); idempotency-flag guards at dashboard-rail.js:180 (_railCollapseWired) and dashboard-labels.js:1168 (root._overflowOutsideBound, an expando on the STATIC #view-labels at dashboard.html:2418, so it survives renderRules' innerHTML reset); explicit teardown at dashboard-ui.js:389-408 and 565-576, dashboard-utils.js:1046-1047, dashboard-drawer-list.js:349-351 (removes the prior handler by reference), dashboard-map.js:1010-1032 (closeInfo, and the capture-phase outsideClick fires ahead of every click path that re-renders the hex map), dashboard-offline.js:609-620 (self-heals on the next mousedown); an AbortController signal covering all six document listeners in dashboard-years.js:32-99; a dataset.wired latch on dashboard-ui.js:369-431; and disconnect handles on _seObserver, _drListObserver and _profileSampleIO. I read dashboard-years.js, dashboard-route.js and dashboard-methodology.js in full, and read the relevant regions of rail/ui/map/search/profiles/reader/timeline/labels/utils/offline/filters/drawer-list/analytics/bug-report and dashboard.html L2550-4250. I also checked for setInterval (none exist anywhere in the app code), self-rescheduling setTimeout chains (only maybeShowTour's tryShow, which is time-bounded at 120s), ResizeObserver/MutationObserver (none), and scroll/online/offline/visibilitychange/popstate/beforeunload/storage handlers (none beyond the single boot-time tabsNav scroll listener). One duplicate registration I deliberately did NOT report: dashboard-rail.js:160/165 attaches click handlers to the STATIC #themeMatch/#groupMatch buttons (dashboard.html:2310/2314) on every buildRail() call, and buildRail runs 2-3x per boot (dashboard.html:4072/4118/4190) with no guard — but the duplicate work is bounded at 3, the class toggles use the force argument, and the resulting extra onFiltersChanged() calls collapse into debouncedHit/debouncedRefresh and an idempotent replaceState, so it meets the "harmless AND bounded" suppressor. Not covered: web-vitals.js (vendored minified library) and sw.js internals beyond confirming it registers no page-side listeners.

**SW3 loadorder sweep.** Task (i): I extracted 394 top-level (column-0) const/let/var/function/class declaration names from the 20 dashboard-*.js modules plus 40 from the inline spine (dashboard.html L2550-4248) = 434 names, and compared them pairwise for duplicates. Result: ZERO duplicate bare names — no SyntaxError-class const/let collisions and no silent function overrides anywhere in the load order. I also cross-checked the 9 `window.X` references that name a top-level declaration; 8 are legitimate (explicit `window.trackView/trackEvent/trackWebVital/trackSearch/_seSetActiveRecord` assignments, plus openListDrawer/closeListDrawer/closeDrawerPanel which are global function declarations and therefore genuinely on window) and exactly one is broken (SW3-05, `window.state`). A heuristic sweep of ~120 left-hand assignment targets found no implicit/undeclared globals. Task (ii): I inspected the initializer of every top-level const/let in all 20 modules (98 of them). Only four have non-literal initializers referencing another module — `debouncedKw` (rail:713), `debouncedHit`/`debouncedRefresh`/`_announceHit` (filters:134,135,226) all call `debounce`, declared in dashboard-helpers.js:102 which loads FIRST — and `_bundledProfileEndpointAvailable` (data:428) which calls a hoisted function declaration in the same file. No HEX_LAYOUT-class evaluation-time ReferenceError exists; the one `typeof HEX_LAYOUT !== 'undefined'` guard (map:105) sits inside a function body and is fine. All 40 spine top-level consts are literals. Task (iii): I read sw.js in full (157 lines) against every asset dashboard.html and index.html load — SHELL_ASSETS omits all 20 dashboard-*.js plus web-vitals.js (SW3-01) and the cache.match key mismatch is SW3-04. Error responses are correctly gated by `res.ok` in all three strategies, so no 4xx/5xx can be cached; API vs shell separation (cross-origin pass-through, NETWORK_ONLY, SWR_PATHS, network-first for js/css/html) is sound. Two further SW oddities I verified but judged too weak to report: the `clearDataCache`/`skipWaiting` message handlers are never posted to by any page code (dead), and cacheFirst's `req.mode === 'navigate'` fallback (line 120) is unreachable because navigations are intercepted earlier. Task (iv): supply chain reported as one aggregate (SW3-03) covering both skypack imports and the jsdelivr world-atlas fetch; SheetJS is correctly exact-pinned with sha384 SRI + crossOrigin and is NOT part of that finding; the CDN-failure behaviour is reported separately as SW3-02. Not covered (out of my scope): XSS sinks, async render races, listener lifecycles, and route/URL-state serialization.

## 7. Next actions

### (a) Fixes worth shipping, in order

1. **J1-02** — treat an empty region expansion as "no matching countries", not as "no
   filter". One conditional in `buildParams()`; today an empty `Set` passes a truthiness
   check and silently erases the country filter too.
2. **A-01** — let `boot()` render the Overview with restored filters, and stop painting
   the unfiltered `api.analytics({})` result over a filtered view. This is what makes
   shared and cited Overview URLs wrong.
3. **B-01 with J1-01** — add a generation token to the profile paint step and abort the
   superseded request in `apiGet`. These are two halves of the same race and should be
   fixed together.
4. **The counting-scope cluster** (C-01, C-02, C-03, C-04, B-02, B-04, F-01, F-02, D-01,
   D-03, E-01, H-01, H-03, I-01) — each is small on its own, but they share one root
   cause: a count displayed next to a list is often computed from a different filter scope
   or a sampled subset than the list itself. Worth one focused pass rather than fourteen
   separate patches.
5. **The silent-failure cluster** (A-03, A-04, B-03, D-02, J2-02, C-08) — make failure
   visible. A stale number with no indicator is the worst outcome for a citable tool.

### (b) Runtime experiments

None required — see section 4.

### (c) Process items, not defects

- Add the twenty module files to the service worker's `SHELL_ASSETS` and keep the
  `SHELL_CACHE` bump on a ship checklist (SW3-01, downgraded to S4 above).
- Pin exact versions and add subresource integrity to the three CDN-loaded map
  dependencies, or vendor them (SW3-03). They execute as script from a third party.
- Refresh `ARCHITECTURE.md`: its line counts have drifted and it still describes 17
  modules where there are 20. The audit deliberately filed no findings about this.
- Consider adopting the `_profileSampleGen` guard idiom as a documented convention, since
  its absence is what produced the two S1 race findings.
