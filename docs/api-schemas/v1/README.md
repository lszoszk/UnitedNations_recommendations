# UHRI Backend API — Contract Schemas (v1)

This folder is the **single source of truth** for the shape of the FastAPI
backend's responses. The dashboard frontend consumes these endpoints and
the contract test suite (`tests/contracts/`) validates each shipped backend
build against these schemas.

## Versioning

- `v1/` — the schema set in force as of 2026-04-25.
- A breaking change to any endpoint (removed field, type change, status-code
  meaning shift) requires a `v2/` folder + matching frontend update + a
  `CHANGELOG-API.md` entry.
- Additive changes (new optional field, new endpoint) stay in `v1/`.

## Endpoint → schema map

| Endpoint | Schema | Notes |
|---|---|---|
| `GET /api/data/health` | `health.json` | Liveness + dataset metadata |
| `GET /api/data/facets` | `facets.json` | Facet taxonomy + total count |
| `GET /api/data/records` | `records.json` | Paginated full-text + filtered |
| `GET /api/data/record/{id}` | `record-by-id.json` | Single record by AnnotationId |
| `GET /api/data/map` | `map.json` | Country-level counts |
| `GET /api/data/summary` | `summary.json` | KPI strip data |
| `GET /api/data/analytics` | `analytics.json` | Themes / groups / SDGs / yearly |
| `GET /api/data/cache_status` | `cache_status.json` | Server-side LRU stats |
| `GET /api/data/refresh_status` | `refresh_status.json` | Pipeline freshness |
| `GET /api/data/full?dataset=cleaned` | _(contract: 200 + JSON array)_ | Not schema-validated (~420 MB) |
| `*` (any 4xx/5xx) | `error.json` | FastAPI standard error envelope |

## Contract guarantees

Every response, **including error paths**, must:

1. Carry a JSON body — never empty 4xx/5xx without a body.
2. Carry CORS headers (`Access-Control-Allow-Origin: <approved origin>`,
   `Vary: Origin`) when the request includes an approved `Origin`.
3. Match the documented schema for its status code.
4. Respect SLO latency (see `docs/test-plan-beta-2026.md` §B.3).

Pathological text queries (`*`, `AND`, `!@#`, hyphenated phrases) must
return EITHER a 200 with empty/empty-ish results OR a 400 with
`{"error": "bad_query_syntax", ...}` — never a 500 without CORS, which
surfaces as "CORS blocked" in the browser and is unactionable for the user.

## How to update a schema

1. Capture a new sample response: `curl -sk --compressed -H "Origin: …"
   <URL> | python3 -m json.tool > sample.json`.
2. Run the existing contract suite against the new build: `npm run
   test:contracts`. Failures show the diff.
3. Decide: is the change additive (extend schema, ship v1) or breaking
   (write `v2/`, dual-publish for one release cycle, deprecate v1)?
4. Bump `package.json` field `apiSchemaVersion` if breaking.
5. Open a PR; the contract suite must pass on the candidate backend
   before merge.
