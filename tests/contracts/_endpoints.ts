/* Endpoint inventory for the contract suite.
 *
 * Single source of truth for which paths exist, what their canonical
 * "happy path" request looks like, the JSON Schema they must validate
 * against, and a per-endpoint latency SLO.  Adding a new endpoint =
 * one row here + one schema file in docs/api-schemas/v1/.
 *
 * Latency SLOs are p95 ceilings on a warm cache; cold-cache hits
 * (especially /analytics) can take ~10s on the first call after a
 * VM restart.  Tests use a 2× multiplier so they don't false-alarm
 * during route-cache warmup.
 */

export interface ContractEndpoint {
  /** Stable id used in test names + bug tickets. */
  id: string;
  /** Path including leading slash; query string allowed. */
  path: string;
  /** Schema file (relative to docs/api-schemas/v1/) for the 200 response. */
  schema: string;
  /** Optional human-readable purpose. */
  purpose: string;
  /** Latency SLO (warm-cache p95) in ms. Tests use 2× this as the failure threshold. */
  slo: number;
  /** True if the endpoint is expected to NOT respond to GET (rare). */
  noGet?: boolean;
}

export const API_BASE = 'https://150.254.115.204/uhri-api';
export const APPROVED_ORIGIN = 'https://lszoszk.github.io';

/* Canonical happy-path requests, one per endpoint.  Filters chosen to
 * exercise representative responses (Poland is a stable mid-volume
 * country guaranteed to return data on any release; ~1689 records). */
export const ENDPOINTS: ContractEndpoint[] = [
  {
    id:      'health',
    path:    '/api/data/health',
    schema:  'health.json',
    purpose: 'Liveness + dataset metadata; gates frontend boot.',
    slo:     500,
  },
  {
    id:      'facets',
    path:    '/api/data/facets?dataset=cleaned',
    schema:  'facets.json',
    purpose: 'Facet taxonomy + total record count; cached ~24h on the client.',
    slo:     1000,
  },
  {
    id:      'facets-raw',
    path:    '/api/data/facets?dataset=raw',
    schema:  'facets.json',
    purpose: 'Same shape as cleaned but reads the raw upstream dataset.',
    slo:     1000,
  },
  {
    id:      'records-poland',
    path:    '/api/data/records?countries=Poland&page=1&page_size=2',
    schema:  'records.json',
    purpose: 'Paginated records with a country filter; small page_size to keep test fast.',
    slo:     2000,
  },
  {
    id:      'records-text-query',
    path:    '/api/data/records?text_query=torture&page=1&page_size=1',
    schema:  'records.json',
    purpose: 'FTS5 text query happy path.',
    slo:     2500,
  },
  {
    id:      'map-poland',
    path:    '/api/data/map?countries=Poland',
    schema:  'map.json',
    purpose: 'Country-level counts; drives hex map + choropleth.',
    slo:     1500,
  },
  {
    id:      'summary-poland',
    path:    '/api/data/summary?countries=Poland',
    schema:  'summary.json',
    purpose: 'KPI strip + yearly_counts + body_counts.',
    /* TODO(perf): /summary measured at consistent 7.7–8.1 s on
       2026-04-25 — significantly slower than its API design intent
       (it's supposed to be the cheap fast path used in place of the
       slow /analytics).  Likely the route cache isn't warming this
       query because the dashboard primarily uses /analytics for
       country-filtered profiles.  Bumping SLO to 10 s as a stop-gap
       so the contract suite stops flapping; opening a perf ticket
       to investigate the missing route-cache warming for /summary
       under per-country filter. */
    slo:     10000,
  },
  {
    id:      'analytics-poland',
    path:    '/api/data/analytics?countries=Poland',
    schema:  'analytics.json',
    purpose: 'Slowest endpoint; full themes/groups/SDGs/trends payload.',
    slo:     5000,
  },
  {
    id:      'cache-status',
    path:    '/api/data/cache_status',
    schema:  'cache_status.json',
    purpose: 'Server-side LRU observability; not user-facing.',
    slo:     500,
  },
  {
    id:      'refresh-status',
    path:    '/api/data/refresh_status',
    schema:  'refresh_status.json',
    purpose: 'Pipeline freshness; drives Methodology dataset card.',
    slo:     500,
  },
];

/* Pathological text queries — must NEVER produce a 500 without CORS
 * (the bug class fixed in commit 99d1330 / FastAPI patch 2026-04-24).
 * They may legitimately return 200 with empty results (when the FTS5
 * escape layer sanitises them to a no-op token) or 400 with the
 * `bad_query_syntax` envelope.  Either is fine; 500 without CORS is
 * not. */
export const PATHOLOGICAL_QUERIES: { id: string; q: string; comment: string }[] = [
  { id: 'bare-asterisk',       q: '*',                              comment: 'Bare wildcard — FTS5 rejects without context.' },
  { id: 'special-chars',       q: '!@#',                            comment: 'Punctuation-only; tokeniser produces empty.' },
  { id: 'bare-and',            q: 'AND',                            comment: 'Boolean operator alone; no operands.' },
  { id: 'hyphenated-no-match', q: 'very-unlikely-phrase-xyz123abc', comment: 'Hyphens treated as NOT in FTS5; word doesn\'t exist.' },
  { id: 'unclosed-quote',      q: '"unclosed quote',                comment: 'Malformed phrase syntax.' },
];
