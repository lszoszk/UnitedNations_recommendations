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
  if (f.yearA) p.set('year_start', f.yearA);
  if (f.yearB) p.set('year_end', f.yearB);
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
      const res = await fetch(url, { signal: ctrl.signal });
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
  recordsCount: (f) => {
    const p = buildParams(f || state.filters);
    p.set('page', 1);
    p.set('page_size', 1);
    return apiGet(E.records, p, { scope: 'recordsCount' });
  },
  profile: (entityType, entityValue, opts = {}) => {
    const p = new URLSearchParams();
    if (state.filters.dataset) p.set('dataset', state.filters.dataset);
    const path = `/api/data/profile/${encodeURIComponent(entityType)}/${encodeURIComponent(entityValue)}`;
    return apiGet(path, p, { scope: `profile:${entityType}:${entityValue}`, ...opts });
  },
};

let _bundledProfileEndpointAvailable = null;

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
  for (const key of ['country', 'body', 'theme', 'group', 'region', 'sdg', 'type']) {
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
  const norm = d => d ? { analytics: d.analytics, mapD: d.map, records: d.records_sample || d.records } : null;

  const loadSplitProfile = () => {
    const anSwr = swr(`analytics:${entityType}:${entityValue}`, filter, () => api.analytics(filter));
    const mpSwr = swr(`map:${entityType}:${entityValue}`, filter, () => api.map(filter));
    const rcSwr = swr(`records:${entityType}:${entityValue}`, filter, () => api.records(filter, 1, 5));
    const combine = (analytics, mapD, records) => ({ analytics, mapD, records });
    return {
      stale: (anSwr.stale && mpSwr.stale && rcSwr.stale) ? combine(anSwr.stale, mpSwr.stale, rcSwr.stale) : null,
      // allSettled, not all: one section 5xx-ing shouldn't blank the whole
      // profile (the renderers already tolerate missing sections). Still reject
      // on supersession (AbortError) so we don't paint stale partial data, and
      // on total failure so the error path shows.
      fresh: Promise.allSettled([anSwr.fresh, mpSwr.fresh, rcSwr.fresh]).then((res) => {
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
  if (entityType !== 'sdg' && railEmpty && _bundledProfileEndpointAvailable !== false) {
    const pSwr = swr(`profile:${entityType}:${entityValue}`, filter, () => api.profile(entityType, entityValue));
    return {
      stale: norm(pSwr.stale),
      fresh: pSwr.fresh
        .then(d => {
          _bundledProfileEndpointAvailable = true;
          return norm(d);
        })
        .catch(err => {
          if (_isBundledProfileUnavailable(err)) {
            _bundledProfileEndpointAvailable = false;
            console.warn('Bundled profile endpoint unavailable; falling back to analytics/map/records.', err);
            return loadSplitProfile().fresh;
          }
          throw err;
        }),
    };
  }

  return loadSplitProfile();
}
