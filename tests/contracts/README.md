# Backend contract tests

Validates the live FastAPI backend at `https://150.254.115.204/uhri-api`
against the JSON schemas in `docs/api-schemas/v1/`.

## What's covered (20 tests)

- **§1 Happy path** (10 tests, one per endpoint) — HTTP 200, schema
  conformance, CORS headers, latency under 3× the per-endpoint SLO.
- **§2 Pathological text queries** (5 tests) — bare `*`, `AND`, `!@#`,
  hyphenated phrases, unclosed quotes. Status MUST be < 500. CORS MUST
  be present. Catches regressions of the bug class fixed by the
  2026-04-24 FastAPI exception-handler patch.
- **§3 Single-record by id** (2 tests) — happy path + 404 with the
  error envelope.
- **§4 Method enforcement** (1 test) — `/full` rejects HEAD with 405 +
  proper Allow header + CORS.
- **§5 Cross-endpoint invariants** (2 tests) — `facets.total_records`
  must equal `records.total_records` on the unfiltered dataset; for
  any country filter, `map.total_records ≡ records.total_records ≡
  summary.total_records`. If these drift the dashboard will silently
  display inconsistent counts in different panels.

## How to run

```bash
npm run test:contracts          # full suite, ~22 s
npm run test:contracts -- --reporter=list   # verbose
```

The suite runs against the **live VM**, not localhost. There is no
`webServer` in `playwright.contracts.config.ts` — these tests are
network-only.

## How to extend

### Add a new endpoint

1. Capture a sample response: `curl -sk --compressed -H "Origin:
   https://lszoszk.github.io" '<URL>' | python3 -m json.tool >
   /tmp/sample.json`.
2. Write a schema in `docs/api-schemas/v1/<endpoint>.json`. Mark only
   the fields the frontend USES as required; leave the rest optional
   so additive backend changes don't break the contract.
3. Add a row to `ENDPOINTS` in `tests/contracts/_endpoints.ts` with
   the schema filename + a realistic latency SLO.
4. Run `npm run test:contracts`. The new endpoint will be auto-picked
   up by §1 happy-path loop.

### Add a new pathological query case

Append to `PATHOLOGICAL_QUERIES` in `_endpoints.ts`. Same caveats — must
not 5xx, must emit CORS.

### Schema versioning

Breaking changes (removed field, type change, status-code shift)
require a `v2/` folder + matching frontend update + a row in
`CHANGELOG-API.md`. Additive changes stay in `v1/`.

## Open findings (as of 2026-04-25)

- **`/api/data/summary?countries=X` is consistently ~7.7–8.1 s.** Per
  its API design intent it should be the cheap fast path used in place
  of the slow `/analytics`. Likely the route cache isn't warming
  per-country `summary` queries because the dashboard primarily uses
  `/analytics` for country-filtered profiles. SLO bumped to 10 s as a
  stop-gap; backend perf ticket open. (See comment in `_endpoints.ts`
  next to the `summary-poland` row.)
