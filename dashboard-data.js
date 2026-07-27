/* =========================================================================
   DASHBOARD DATA LAYER
   ========================================================================= */

/* ---------- CONFIG ---------- */
const API_BASE = 'https://150.254.115.204/uhri-api';
const E = {
  facets:    '/api/data/facets',
  records:   '/api/data/records',
  analytics: '/api/data/analytics',
  summary:   '/api/data/summary',
  map:       '/api/data/map',
  health:    '/api/data/health',
};

/* =========================================================================
   STALE-WHILE-REVALIDATE (SWR) cache for profile views
   ========================================================================= */
const SWR_KEY = 'uhri_v2_swr_cache_v1';
const SWR_MAX_ENTRIES = 120;
const SWR_TTL_MS = 24 * 3600 * 1000;

function _swrCanonicalFilter(f) {
  f = f || {};
  return {
    kw: f.kw || '',
    country: [...(f.country || [])].sort(),
    body: [...(f.body || [])].sort(),
    theme: [...(f.theme || [])].sort(),
    group: [...(f.group || [])].sort(),
    region: [...(f.region || [])].sort(),
    sdg: [...(f.sdg || [])].map(String).sort(),
    sdgExact: [...(f.sdgExact || [])].map(String).sort(),
    type: [...(f.type || [])].sort(),
    yA: f.yearA ?? null,
    yB: f.yearB ?? null,
    tm: f.themesMatch || 'any',
    gm: f.groupsMatch || 'any',
    ds: f.dataset || 'cleaned',
  };
}

function _swrKey(scope, filter) {
  return scope + '|' + JSON.stringify(_swrCanonicalFilter(filter));
}

function _swrLoad() {
  try { return JSON.parse(localStorage.getItem(SWR_KEY) || '{}'); } catch { return {}; }
}

function _swrSave(obj) {
  try { localStorage.setItem(SWR_KEY, JSON.stringify(obj)); }
  catch (e) {
    const keys = Object.keys(obj).sort((a, b) => obj[a].t - obj[b].t);
    for (let i = 0; i < Math.floor(keys.length / 2); i++) delete obj[keys[i]];
    try { localStorage.setItem(SWR_KEY, JSON.stringify(obj)); } catch {}
  }
}

function swrGetStale(scope, filter) {
  const cache = _swrLoad();
  const entry = cache[_swrKey(scope, filter)];
  if (!entry) return null;
  if (Date.now() - entry.t > SWR_TTL_MS) return null;
  return entry.d;
}

function swrPut(scope, filter, data) {
  if (!data) return;
  const cache = _swrLoad();
  cache[_swrKey(scope, filter)] = { t: Date.now(), d: data };
  const keys = Object.keys(cache);
  if (keys.length > SWR_MAX_ENTRIES) {
    keys.sort((a, b) => cache[a].t - cache[b].t);
    for (let i = 0; i < keys.length - SWR_MAX_ENTRIES; i++) delete cache[keys[i]];
  }
  _swrSave(cache);
}

function swr(scope, filter, fetcher) {
  const stale = swrGetStale(scope, filter);
  const fresh = fetcher()
    .then(d => { if (d) swrPut(scope, filter, d); return d; })
    .catch(err => { if (err?.name !== 'AbortError') throw err; return null; });
  return { stale, fresh };
}

/* ---------- STATE ---------- */
const state = {
  view: 'overview',
  filters: {
    kw: '',
    country: new Set(),
    body: new Set(),
    theme: new Set(),
    group: new Set(),
    region: new Set(),
    sdg: new Set(),
    sdgExact: new Set(),
    type: new Set(),
    yearA: null,
    yearB: null,
    themesMatch: 'any',
    groupsMatch: 'any',
    dataset: 'cleaned',
    /* Labels-workspace integration: when the user clicks "📊 Analyze" or
       "🔎 Search" on a label rule, we pipe the rule's FTS5 query into kw
       and remember which rule it came from here. The chip + scope banner
       use this to render "🏷 <label name>" instead of the raw FTS5, and
       the kw input handler clears it on manual edit (because the user is
       no longer running the label, just an inspired-by query). */
    activeLabel: null,
  },
  selectedRec: null,
  focusCountry: null,
  focusTheme: null,
  focusGroup: null,
  focusSdg: null,
  focusMechanism: null,
  focusFamily: null,
  mechScope: 'single',
  profileStackBy: 'family',
  cmpA: null,
  cmpB: null,
  facets: null,
  analytics: null,
  // Unfiltered analytics is the stable catalog for profile switchers.
  // `analytics` itself is intentionally replaced by filtered Overview data.
  baselineAnalytics: null,
  searchPage: 1,
  searchPageSize: 30,
  searchSort: { by: 'publication_date', dir: 'desc' },
  searchSelection: new Set(),
  totalHits: 0,
  bootstrapDone: false,
  /* Taxonomy for the rail REGION filter — 'm49' (default, aligns with the
     hex map) or 'unGroups' (Treaty Body / HRC electoral groups). Toggled
     from the rail. */
  regionTaxonomy: 'm49',
};
window.__state = state;

/* ---------- API CLIENT ---------- */
function buildParams(f) {
  const p = new URLSearchParams();
  if (f.kw && f.kw.trim()) p.set('text_query', f.kw.trim());
  /* Region filter — two taxonomies the user can toggle between:
       m49:       UN M49 statistical regions; we resolve to country names
                  client-side (server doesn't speak M49) and send as
                  `countries=…`, intersected with any explicit country
                  selection.
       unGroups:  UN Treaty Body / HRC electoral groups returned by the
                  server's facets.regions; we forward them to the server
                  as-is via the `regions=` param (its native taxonomy).

     Default is m49 (matches the hex map).  The `state.regionTaxonomy`
     flag is set by the rail toggle (see dashboard-rail.js). */
  const tax = (typeof state !== 'undefined' && state.regionTaxonomy) || 'm49';
  let effectiveCountries = f.country && f.country.size ? new Set(f.country) : null;
  if (f.region && f.region.size) {
    if (tax === 'm49' && typeof expandM49RegionsToCountries === 'function') {
      const regionCountries = expandM49RegionsToCountries(f.region);
      if (regionCountries) {
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
  if (f.body && f.body.size) p.set('bodies', Array.from(f.body).join(','));
  if (f.theme && f.theme.size) p.set('themes', Array.from(f.theme).join('|'));
  if (f.group && f.group.size) p.set('affected_persons', Array.from(f.group).join('|'));
  const sdgValues = _sdgParamValues(f);
  if (sdgValues.length) p.set('sdgs', sdgValues.join('|'));
  if (f.type && f.type.size) p.set('annotation_type', Array.from(f.type).join(','));
  /* Year bounds are sent ONLY when they actually narrow the range
     (perf 2026-07). The slider rests at the dataset's full span, so we
     used to append `year_start=2006&year_end=2026` — a semantic no-op
     — to every single request. It cost two ways:
       1. nginx's precompute map only recognises `""` / `dataset=cleaned`
          / `dataset=raw` as cacheable arg-strings, so the year pair
          bypassed the precomputed .json.gz and hit FastAPI every time;
       2. the year-filtered query path in the backend is pathologically
          slow — measured against the live VM, the SAME query went
          86-138 ms → 5.3-6.0 s on /records and 166 ms → 25.4 s on
          /analytics purely by adding the full-range pair.
     Verified equivalent (identical total_records unfiltered / by
     country / theme / body) before removing. A genuinely narrowed
     range still sends the bound it narrows, and only that one. */
  const _fy = (typeof state !== 'undefined' && state.facets) || null;
  const _fullMin = _fy && Number.isFinite(+_fy.min_year) ? +_fy.min_year : null;
  const _fullMax = _fy && Number.isFinite(+_fy.max_year) ? +_fy.max_year : null;
  if (f.yearA && !(_fullMin !== null && +f.yearA <= _fullMin)) p.set('year_start', f.yearA);
  if (f.yearB && !(_fullMax !== null && +f.yearB >= _fullMax)) p.set('year_end', f.yearB);
  if (f.themesMatch === 'all') p.set('themes_match', 'all');
  if (f.groupsMatch === 'all') p.set('affected_persons_match', 'all');
  if (f.dataset) p.set('dataset', f.dataset);
  return p;
}

const memCache = new Map();
const MEM_TTL = 5 * 60 * 1000;

function cacheKey(path, params) {
  return path + '?' + (params ? params.toString() : '');
}

function memGet(key) {
  const value = memCache.get(key);
  if (!value) return null;
  if (Date.now() - value.t > MEM_TTL) {
    memCache.delete(key);
    return null;
  }
  return value.d;
}

function memSet(key, data) {
  memCache.set(key, { t: Date.now(), d: data });
  if (memCache.size > 80) {
    const firstKey = memCache.keys().next().value;
    memCache.delete(firstKey);
  }
}

const inflight = {};
const pendingPromises = new Map();

/* ---------- REQUEST GATE: bounded client-side concurrency ----------
   The API degrades sharply when several requests land together: measured
   against the live VM with a realistic 8-request view mix, one random
   request in the batch gets starved for seconds while the others answer
   in ~150 ms. Throttling the CLIENT fixes it, and counter-intuitively
   makes the whole batch finish sooner — the same mix, 3 trials each:

     concurrency 8 -> p50 321ms  p95 2934ms  wall 3.77s
     concurrency 4 -> p50 167ms  p95 1512ms  wall 1.70s
     concurrency 2 -> p50 117ms  p95  770ms  wall 1.20s

   (Hedging the straggler — firing a duplicate after a delay — was also
   tried and made things worse: p95 2331ms -> 5878ms, because the extra
   load feeds the same contention. Measured, then discarded.)

   Two tiers so speculative work can never delay what the user is waiting
   for: 'low' is for hover-preloads and sparkline backfill, and is only
   dequeued when no normal-priority request is waiting. */
const GATE_LIMIT = 2;
let _gateActive = 0;
const _gateQ = [];       // normal priority
const _gateQLow = [];    // speculative

function _gatePump() {
  while (_gateActive < GATE_LIMIT) {
    const next = _gateQ.shift() || _gateQLow.shift();
    if (!next) return;
    _gateActive++;
    next();
  }
}

/* Runs fn() once a slot is free. Aborted-while-queued requests are
   dropped without ever hitting the network. */
function _gate(fn, { signal, priority } = {}) {
  return new Promise((resolve, reject) => {
    const start = () => {
      if (signal && signal.aborted) {
        _gateActive--; _gatePump();
        const e = new Error('aborted'); e.name = 'AbortError';
        return reject(e);
      }
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => { _gateActive--; _gatePump(); });
    };
    (priority === 'low' ? _gateQLow : _gateQ).push(start);
    _gatePump();
  });
}

async function apiGet(path, params, opts = {}) {
  const url = API_BASE + path + (params && params.toString() ? '?' + params.toString() : '');
  const key = cacheKey(path, params);

  const scope = opts.scope || path;
  if (!opts.noCache) {
    const hit = memGet(key);
    if (hit) {
      // Serving from cache still SUPERSEDES any in-flight request in this
      // scope with different params — abort it, or its late response will
      // zombie-paint over the newer state. (Empirically: apply filter on a
      // slow backend, clear-all while it's in flight; the cleared count is
      // a cache hit that used to return here without aborting, so the old
      // filtered response landed seconds later and "un-cleared" the UI.)
      if (inflight[scope] && inflight[scope].key !== key) {
        try { inflight[scope].ctrl.abort(); } catch {}
        pendingPromises.delete(inflight[scope].key);
        delete inflight[scope];
      }
      return hit;
    }
    const pending = pendingPromises.get(key);
    if (pending) return pending.promise;
  }

  if (inflight[scope] && inflight[scope].key !== key) {
    try { inflight[scope].ctrl.abort(); } catch {}
    pendingPromises.delete(inflight[scope].key);
  }
  const ctrl = new AbortController();

  const promise = (async () => {
    try {
      const res = await _gate(
        () => fetch(url, { signal: ctrl.signal }),
        { signal: ctrl.signal, priority: opts.priority },
      );
      if (!res.ok) {
        const err = new Error(`${path} -> HTTP ${res.status}`);
        err.status = res.status;
        err.path = path;
        err.url = url;
        throw err;
      }
      const data = await res.json();
      memSet(key, data);
      return data;
    } finally {
      if (inflight[scope]?.ctrl === ctrl) delete inflight[scope];
      pendingPromises.delete(key);
    }
  })();

  inflight[scope] = { ctrl, key };
  pendingPromises.set(key, { ctrl, promise });
  return promise;
}

const api = {
  facets: () => {
    const p = new URLSearchParams();
    if (state.filters.dataset) p.set('dataset', state.filters.dataset);
    return apiGet(E.facets, p, { scope: 'facets' });
  },
  health: () => apiGet(E.health, null, { scope: 'health' }),
  analytics: (f, opts = {}) => apiGet(E.analytics, buildParams(f || state.filters), { scope: 'analytics', ...opts }),
  map: (f, opts = {}) => apiGet(E.map, buildParams(f || state.filters), { scope: 'map', ...opts }),
  summary: (f, opts = {}) => apiGet(E.summary, buildParams(f || state.filters), { scope: 'summary', ...opts }),
  records: (f, page, pageSize, opts = {}) => {
    const p = buildParams(f || state.filters);
    p.set('page', page || 1);
    p.set('page_size', pageSize || 30);
    if (opts.sort_by) p.set('sort_by', opts.sort_by);
    if (opts.sort_dir) p.set('sort_dir', opts.sort_dir);
    return apiGet(E.records, p, { scope: 'records', ...opts });
  },
  /* Counts come from /summary, NOT /records?page_size=1 (perf 2026-07).
     /records is index-poor for most filters — measured cold against the
     live VM, the identical count cost 0.60-1.18 s there versus a flat
     0.05-0.06 s on /summary, and because the API serialises work, one
     slow /records call also head-of-line blocks every other request in
     flight (in-browser we measured a 22 s analytics call queued behind
     one). Equivalence verified before switching: identical total_records
     on 17 filter shapes — unfiltered, country, theme, multi-theme with
     themes_match=all, body, multi-body, group, groups_match=all, type,
     text_query, regions, sdgs, year ranges and combinations.

     opts.scope lets a caller opt OUT of the shared race guard, which
     aborts in-flight requests in the same scope. That is right when a
     newer filter supersedes an older one, but wrong when a view fires
     several counts at once — Mechanism → "compare all 3" (one per family)
     and Labels → the rule cards (one per rule) both pass their own scope.
     Any new fan-out caller must do the same, or its counts cancel one
     another and only the last one issued survives. */
  recordsCount: (f, opts = {}) => {
    const p = buildParams(f || state.filters);
    return apiGet(E.summary, p, { scope: 'recordsCount', ...opts });
  },
  profile: (entityType, entityValue, opts = {}) => {
    const p = new URLSearchParams();
    if (state.filters.dataset) p.set('dataset', state.filters.dataset);
    const path = `/api/data/profile/${encodeURIComponent(entityType)}/${encodeURIComponent(entityValue)}`;
    return apiGet(path, p, { scope: `profile:${entityType}:${entityValue}`, ...opts });
  },
};

/* The bundled /api/data/profile/{type}/{value} endpoint does not exist on
   the current backend — it 404s (confirmed: absent from openapi.json). The
   fallback to analytics+map+records is correct, but the probe cost a wasted
   round-trip IN FRONT of the profile, because the split fetch can only start
   once the probe has failed.

   Remembering the 404 for 24h fixed that for returning visitors but not for
   first-time ones, who still paid it on every cold visit. So the default is
   now the path that works, and the question "does the endpoint exist yet?"
   is asked in the BACKGROUND at 'low' priority, at most once a day — the
   dashboard still picks the endpoint up automatically if the VM ever ships
   it (there IS a materialised view behind it: /api/data/mv/status reports
   618 per-entity rows), without a cold visit ever waiting on the answer. */
const _BUNDLED_OK_KEY = 'uhri_v2_profile_ep_ok';
const _BUNDLED_PROBED_KEY = 'uhri_v2_profile_ep_probed_at';
const _BUNDLED_PROBE_EVERY_MS = 24 * 3600 * 1000;

function _readBundledProbeMemo() {
  try { return localStorage.getItem(_BUNDLED_OK_KEY) === '1'; }
  catch { return false; }
}
function _memoBundledUnavailable() {
  try { localStorage.removeItem(_BUNDLED_OK_KEY); } catch {}
}
function _clearBundledMemo() {
  try { localStorage.setItem(_BUNDLED_OK_KEY, '1'); } catch {}
}

let _bundledProfileEndpointAvailable = _readBundledProbeMemo();

/* Fire-and-forget: never awaited, so it cannot delay a profile, and it burns
   at most one request per day per browser. */
function _probeBundledProfileLater(entityType, entityValue) {
  if (_bundledProfileEndpointAvailable) return;
  try {
    const last = +(localStorage.getItem(_BUNDLED_PROBED_KEY) || 0);
    if (Date.now() - last < _BUNDLED_PROBE_EVERY_MS) return;
    localStorage.setItem(_BUNDLED_PROBED_KEY, String(Date.now()));
  } catch { return; }
  api.profile(entityType, entityValue, { priority: 'low' })
    .then(() => { _bundledProfileEndpointAvailable = true; _clearBundledMemo(); })
    .catch(() => {});
}

function _isBundledProfileUnavailable(err) {
  const status = Number(
    err?.status
    || String(err?.message || '').match(/HTTP\s+(\d+)/)?.[1]
    || 0
  );
  return status === 404 || status === 405 || status === 501;
}

function _railIsEmpty(filter) {
  const f = filter || state.filters;
  if ((f.kw || '').trim()) return false;
  for (const key of ['country', 'body', 'theme', 'group', 'region', 'sdg', 'sdgExact', 'type']) {
    const setValue = f[key];
    if (setValue && typeof setValue.size === 'number' && setValue.size > 0) return false;
  }
  if (state.facets) {
    if (f.yearA && f.yearA !== state.facets.min_year) return false;
    if (f.yearB && f.yearB !== state.facets.max_year) return false;
  }
  return true;
}

function _loadProfile(entityType, entityValue, scopeOverride) {
  const filter = _scopedFilter(scopeOverride || {});
  const railEmpty = _railIsEmpty();
  const norm = d => {
    if (!d) return null;
    // The bundled endpoint ships the sample rows inline, so when it is alive
    // there is nothing left to fetch lazily.
    const rec = d.records_sample || d.records || null;
    return { analytics: d.analytics, mapD: d.map, count: rec, samples: (rec && rec.records) || null };
  };

  const loadSplitProfile = () => {
    const anSwr = swr(`analytics:${entityType}:${entityValue}`, filter, () => api.analytics(filter));
    const mpSwr = swr(`map:${entityType}:${entityValue}`, filter, () => api.map(filter));
    /* The profile's headline count comes from /summary, and the sample ROWS
       are no longer part of the load at all (perf 2026-07, round 2).
       /records is the one endpoint that stays slow for the filters profiles
       use — measured against the live VM, `themes=Reservations&page_size=5`
       took 1.84s cold and still 0.83s warm, because unlike /summary,
       /analytics and /map it is not served from the route cache. Since
       paint() was gated on all three responses, that single call for five
       rows at the very bottom of the page delayed the entire profile.
       Verified equivalent before switching: /summary and /records report an
       identical total_records on theme, group, sdg, body, country and
       theme+country shapes. The rows now load on visibility — see
       _mountProfileSamples in dashboard-profiles.js. */
    const ctScope = `count:${entityType}:${entityValue}`;
    const ctSwr = swr(ctScope, filter, () => api.recordsCount(filter, { scope: ctScope }));
    const combine = (analytics, mapD, count) => ({ analytics, mapD, count, samples: null });
    return {
      filter,
      stale: (anSwr.stale && mpSwr.stale && ctSwr.stale) ? combine(anSwr.stale, mpSwr.stale, ctSwr.stale) : null,
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
      }),
    };
  };

  // SDG aliases vary between full labels, goals and granular targets. The
  // bundled endpoint has historically returned the unfiltered dataset for
  // canonical values such as "SDG 5.2". Use the normal filtered endpoints
  // for SDGs so buildParams() applies sdgs= deterministically.
  if (entityType !== 'sdg' && railEmpty && _bundledProfileEndpointAvailable === true) {
    const pSwr = swr(`profile:${entityType}:${entityValue}`, filter, () => api.profile(entityType, entityValue));
    return {
      filter,
      stale: norm(pSwr.stale),
      fresh: pSwr.fresh
        .then(d => {
          _bundledProfileEndpointAvailable = true;
          _clearBundledMemo();
          return norm(d);
        })
        .catch(err => {
          if (_isBundledProfileUnavailable(err)) {
            _bundledProfileEndpointAvailable = false;
            _memoBundledUnavailable();
            console.warn('Bundled profile endpoint unavailable; falling back to analytics/map/records.', err);
            return loadSplitProfile().fresh;
          }
          throw err;
        }),
    };
  }

  if (entityType !== 'sdg' && railEmpty) _probeBundledProfileLater(entityType, entityValue);
  return loadSplitProfile();
}
