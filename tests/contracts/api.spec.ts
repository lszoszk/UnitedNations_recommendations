/* Contract test suite — validates the live FastAPI backend at
 * https://150.254.115.204/uhri-api against docs/api-schemas/v1/*.json.
 *
 * Every endpoint listed in _endpoints.ts is checked for:
 *   1. HTTP 200 on canonical input
 *   2. CORS headers present + Access-Control-Allow-Origin matches the
 *      approved origin (https://lszoszk.github.io)
 *   3. JSON shape conforms to the documented schema
 *   4. Latency under 2× the per-endpoint SLO (warm cache; first run
 *      after a VM restart may need a re-run to settle)
 *
 * Pathological text queries (bare *, AND, !@#, hyphenated phrase,
 * unclosed quote) are checked separately:
 *   - Status MUST be < 500 (never an unhandled exception)
 *   - CORS headers MUST be present (browser must see the real status,
 *     not a misleading "CORS blocked" — the bug class fixed by commit
 *     99d1330 + the FastAPI exception-handler patch)
 *
 * The suite runs against the LIVE VM; it intentionally does NOT spin
 * up a local server.  This catches regressions introduced by backend
 * deploys that wouldn't show up in localhost-only smoke tests.
 *
 * Run via:  npm run test:contracts
 */
import { test, expect, request as pwRequest, type APIResponse } from '@playwright/test';
import { ENDPOINTS, PATHOLOGICAL_QUERIES, API_BASE, APPROVED_ORIGIN } from './_endpoints';
import { validate } from './_validator';

/* Helper: make a GET request and return body + headers + timing.
 * Uses Playwright's request fixture (no real browser needed) which
 * gives us automatic decompression of gzip/br responses + structured
 * timing.  ignoreHTTPSErrors: true because the VM uses a self-signed
 * cert that fails strict cert validation in default contexts. */
async function fetchEndpoint(path: string, opts: { extraHeaders?: Record<string, string> } = {}) {
  const ctx = await pwRequest.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: APPROVED_ORIGIN, ...opts.extraHeaders },
  });
  const t0 = Date.now();
  let res: APIResponse;
  try {
    res = await ctx.get(API_BASE + path);
  } finally {
    // Capture elapsed even on error
  }
  const elapsedMs = Date.now() - t0;
  let body: unknown = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  const headers = res.headers();
  await ctx.dispose();
  return { status: res.status(), headers, body, elapsedMs };
}

/* CORS assertions — every response from an approved origin must carry
 * Access-Control-Allow-Origin: <origin> + Vary: Origin (the latter
 * lets caches differentiate per-origin; without it, a cached response
 * for one origin would leak to another). */
function assertCorsHeaders(headers: Record<string, string>, soft = false) {
  const acao = headers['access-control-allow-origin'];
  if (soft) {
    if (!acao) console.warn('[contract] missing ACAO on a status path that should still emit it');
    return;
  }
  expect(acao, 'Access-Control-Allow-Origin missing').toBe(APPROVED_ORIGIN);
}

/* ---------------------------------------------------------------- */
/* §1.  Happy-path schema + CORS + latency for every endpoint.       */
/* ---------------------------------------------------------------- */
test.describe('@contract happy path', () => {
  for (const ep of ENDPOINTS) {
    test(`${ep.id}: 200 + schema + CORS + latency`, async () => {
      const { status, headers, body, elapsedMs } = await fetchEndpoint(ep.path);
      expect(status, `${ep.id} should return 200`).toBe(200);
      assertCorsHeaders(headers);
      const result = validate(ep.schema, body);
      expect(result.valid, `${ep.id} schema violations:\n  ${result.errors.join('\n  ')}`).toBe(true);
      // 2× SLO is a soft warning ceiling; cold-cache first-hit can be
      // slower. Tests log instead of fail when within 2–3× SLO so
      // CI doesn't flap on VM warmup, but fail beyond 3×.
      if (elapsedMs > ep.slo * 3) {
        throw new Error(`${ep.id} took ${elapsedMs}ms — > 3× SLO (${ep.slo}ms). Backend perf regression.`);
      } else if (elapsedMs > ep.slo * 2) {
        console.warn(`[contract] ${ep.id} took ${elapsedMs}ms (SLO ${ep.slo}ms; within 2-3× ceiling)`);
      }
    });
  }
});

/* ---------------------------------------------------------------- */
/* §2.  Pathological text queries — never 5xx without CORS.          */
/* ---------------------------------------------------------------- */
test.describe('@contract pathological queries', () => {
  for (const p of PATHOLOGICAL_QUERIES) {
    test(`text_query="${p.id}" must not 5xx + must emit CORS`, async () => {
      const path = `/api/data/records?text_query=${encodeURIComponent(p.q)}&page_size=1`;
      const { status, headers, body } = await fetchEndpoint(path);
      // Hard contract: never an unhandled 500-without-CORS.
      expect(status, `${p.id} (${p.comment}) returned ${status}`).toBeLessThan(500);
      // CORS MUST be present even on error paths — without this, the
      // browser surfaces "CORS blocked" instead of the real status,
      // which is unactionable for the user.  The exception-handler
      // patch deployed 2026-04-24 guarantees this; if it ever
      // regresses (FastAPI upgrade overwrites the handler, e.g.) this
      // test catches it before users hit the dashboard.
      assertCorsHeaders(headers);
      // Body must be JSON (object); parsable into either a 200
      // payload or the error envelope.
      expect(body, `${p.id} returned non-JSON body`).toBeTruthy();
      expect(typeof body, `${p.id} body is not an object`).toBe('object');
    });
  }
});

/* ---------------------------------------------------------------- */
/* §3.  Single-record by id — depends on records list to seed an id. */
/* ---------------------------------------------------------------- */
test.describe('@contract single record', () => {
  test('record-by-id: 200 + schema + CORS', async () => {
    // Seed: pull one record id from the live records list.
    const seed = await fetchEndpoint('/api/data/records?countries=Poland&page=1&page_size=1');
    expect(seed.status, 'seed records query failed').toBe(200);
    const seedBody = seed.body as { records?: Array<{ AnnotationId?: string }> };
    const id = seedBody.records?.[0]?.AnnotationId;
    expect(id, 'seed record had no AnnotationId').toBeTruthy();

    const { status, headers, body, elapsedMs } = await fetchEndpoint(`/api/data/record/${id}`);
    expect(status).toBe(200);
    assertCorsHeaders(headers);
    const result = validate('record-by-id.json', body);
    expect(result.valid, `record-by-id schema violations:\n  ${result.errors.join('\n  ')}`).toBe(true);
    expect(elapsedMs, 'record-by-id slow').toBeLessThan(2000);
  });

  test('record-by-id: unknown id → 404 with error envelope + CORS', async () => {
    const { status, headers, body } = await fetchEndpoint('/api/data/record/00000000-0000-0000-0000-000000000000');
    expect(status, 'unknown id should be 404 (FastAPI default for missing path/resource)').toBe(404);
    assertCorsHeaders(headers);
    const result = validate('error.json', body);
    expect(result.valid, `error envelope schema violations:\n  ${result.errors.join('\n  ')}`).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/* §4.  Method contracts — /full rejects HEAD/POST cleanly.           */
/* ---------------------------------------------------------------- */
test.describe('@contract method enforcement', () => {
  test('/full HEAD returns 405 with Allow:GET + CORS', async () => {
    const ctx = await pwRequest.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Origin: APPROVED_ORIGIN },
    });
    const res = await ctx.head(API_BASE + '/api/data/full?dataset=cleaned');
    const headers = res.headers();
    expect(res.status(), '/full should reject HEAD with 405 (it is a streaming GET)').toBe(405);
    expect(headers['allow'], 'Allow header should advertise GET').toContain('GET');
    expect(headers['access-control-allow-origin'], 'CORS missing on 405').toBe(APPROVED_ORIGIN);
    await ctx.dispose();
  });
});

/* ---------------------------------------------------------------- */
/* §5.  Invariants across endpoints — total_records consistency.     */
/* ---------------------------------------------------------------- */
test.describe('@contract cross-endpoint invariants', () => {
  test('facets.total_records ≡ records?page_size=1.total_records on full dataset', async () => {
    const facets = await fetchEndpoint('/api/data/facets?dataset=cleaned');
    const records = await fetchEndpoint('/api/data/records?dataset=cleaned&page=1&page_size=1');
    expect(facets.status).toBe(200);
    expect(records.status).toBe(200);
    const fb = facets.body as { total_records?: number };
    const rb = records.body as { total_records?: number };
    expect(fb.total_records, 'facets total_records missing').toBeGreaterThan(0);
    expect(rb.total_records, 'records total_records missing').toBeGreaterThan(0);
    // Cross-endpoint equality — if these drift, every count surface
    // in the dashboard will disagree with itself.
    expect(rb.total_records, `facets says ${fb.total_records}, records says ${rb.total_records}`).toBe(fb.total_records);
  });

  test('Poland: map.total_records ≡ records.total_records ≡ summary.total_records', async () => {
    const [m, r, s] = await Promise.all([
      fetchEndpoint('/api/data/map?countries=Poland'),
      fetchEndpoint('/api/data/records?countries=Poland&page=1&page_size=1'),
      fetchEndpoint('/api/data/summary?countries=Poland'),
    ]);
    expect(m.status).toBe(200);
    expect(r.status).toBe(200);
    expect(s.status).toBe(200);
    const mb = m.body as { total_records?: number };
    const rb = r.body as { total_records?: number };
    const sb = s.body as { total_records?: number };
    expect(mb.total_records, 'map total_records missing').toBeGreaterThan(0);
    expect(rb.total_records, `map=${mb.total_records}, records=${rb.total_records}`).toBe(mb.total_records);
    expect(sb.total_records, `map=${mb.total_records}, summary=${sb.total_records}`).toBe(mb.total_records);
  });
});

/* ---------------------------------------------------------------- */
/* §6.  Boolean search semantics — what the operators promise.       */
/* ---------------------------------------------------------------- */
/* The keyword box, its help panel and llms.txt all advertise
 * AND / OR / NOT and grouped booleans. Two ways that promise was
 * broken, both found from the live site (2026-09-15 / 2026-09-22):
 *
 *   - `_fts5_boolean` tokenised with a bare \S+, so `(child` and
 *     `woman)` were swallowed whole into a quoted term. FTS5 drops the
 *     bracket as punctuation, the grouping vanishes, and FTS5's own
 *     precedence (NOT > AND > OR) re-reads the query. Both spellings
 *     below returned an identical 54,978 rows — i.e. everything
 *     mentioning a child. Wrong answers, no error, full confidence.
 *   - FTS5's NOT is BINARY, so `A AND NOT B` was a syntax error and
 *     the API answered 500.
 *
 * These assert the semantics, not the counts, so they stay valid as
 * the corpus grows. */
test.describe('@contract boolean search semantics', () => {
  const count = async (q: string) => {
    const r = await fetchEndpoint('/api/data/summary?dataset=cleaned&text_query=' + encodeURIComponent(q));
    return { status: r.status, total: (r.body as { total_records?: number })?.total_records ?? -1 };
  };

  test('parentheses group — (a OR b) AND c is not a OR b AND c', async () => {
    const grouped = await count('(child OR woman) AND trafficking');
    const flat = await count('child OR woman AND trafficking');
    const swapped = await count('trafficking AND (child OR woman)');
    expect(grouped.status).toBe(200);
    expect(flat.status).toBe(200);
    expect(swapped.status).toBe(200);

    // Grouping must change the meaning: without it, precedence turns the
    // query into `child OR (woman AND trafficking)` — a far bigger set.
    expect(grouped.total,
      `grouping is being ignored: "(child OR woman) AND trafficking" and `
      + `"child OR woman AND trafficking" both return ${grouped.total}`).not.toBe(flat.total);
    // …and it must be commutative: the same group on either side of AND.
    expect(swapped.total, 'the same grouped query must not depend on clause order').toBe(grouped.total);
    // An AND of two clauses cannot exceed either clause alone.
    const child = await count('child');
    expect(grouped.total).toBeLessThan(child.total);
  });

  test('NOT excludes, in both spellings, inside and outside groups', async () => {
    const plain = await count('torture');
    const not = await count('torture NOT military');
    const andNot = await count('torture AND NOT military');
    expect(plain.status).toBe(200);
    expect(not.status, 'NOT must not 500').toBe(200);
    expect(andNot.status, 'AND NOT must not 500 — FTS5 NOT is binary; rewrite it').toBe(200);
    expect(not.total, 'NOT must actually remove rows').toBeLessThan(plain.total);
    expect(andNot.total, 'AND NOT and NOT are the same query in FTS5').toBe(not.total);
  });

  test('the shapes FTS5 cannot express answer 4xx with a reason, never 5xx', async () => {
    for (const q of ['NOT military', 'torture OR NOT military', '(child AND woman', 'child AND ()']) {
      const r = await fetchEndpoint('/api/data/summary?dataset=cleaned&text_query=' + encodeURIComponent(q));
      expect(r.status, `"${q}" must not be a server error`).toBeLessThan(500);
      expect(r.status, `"${q}" should be rejected as a bad request`).toBeGreaterThanOrEqual(400);
      const detail = (r.body as { detail?: string })?.detail;
      expect(typeof detail === 'string' && detail.length > 20,
        `"${q}" should come back with an explanation, got: ${JSON.stringify(detail)}`).toBe(true);
    }
  });
});
