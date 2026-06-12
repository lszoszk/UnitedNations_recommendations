# UHRI+ — UN Human Rights Recommendations Dashboard (GitHub Pages)

Static, zero-build dashboard for searching and analysing **267,671** cleaned
country-specific UN human-rights observations and recommendations (Treaty
Bodies, Universal Periodic Review, Special Procedures, 2006–2026), built on
the OHCHR Universal Human Rights Index.

**Live:** <https://lszoszk.github.io/UnitedNations_recommendations/>
**Dataset (HuggingFace):** <https://huggingface.co/datasets/lszoszk/uhri-recommendations>

**License:** [PolyForm Noncommercial 1.0.0](LICENSE) — research, education,
non-profit and personal use are permitted; redistribution must keep the
attribution notice; commercial use requires a separate licence from the
author. Bundled libraries retain their respective MIT / Apache 2.0
licences ([NOTICE](NOTICE)).

> **For engineering orientation see [ARCHITECTURE.md](ARCHITECTURE.md)** —
> module map, load order, cross-module surface, extraction conventions.

## What is included
- `index.html`: landing page
- `dashboard.html`: the dashboard application + 20 sibling `dashboard-*.js` modules (no bundler, classic `<script defer>` load order)
- `sw.js`: service worker (app-shell cache)
- `tests/`: Playwright suites — `smoke.spec.ts` (22 scenarios) plus `a11y`, `user-flows`, `contracts`, `tab-walk`, and others
- `scripts/`, `docs/`, `llms.txt`: count-sync tooling, methodology comparison, and an agent-friendly site summary

## How it works
The dashboard is fully static on GitHub Pages and reads data at runtime from a
FastAPI backend on a VM (SQLite + FTS5), with a 15-minute edge cache. Users can
also upload their own UHRI Excel/JSON export to browse it locally (no server
round-trip). There is no login.

VM API base: `https://150.254.115.204/uhri-api`. Main endpoints
(all under `/api/data/`):

| Endpoint | Purpose |
|---|---|
| `/health` | liveness probe |
| `/facets` | filter vocabularies (countries, bodies, themes, …) |
| `/records` | paginated, filtered records (full-text search via FTS5) |
| `/analytics` | aggregates for the current filter (trends, themes, SDGs) |
| `/map` | per-country counts for the hex / choropleth map |
| `/record/{annotation_id}` | a single record |
| `/export`, `/full` | bulk export of a filtered subset |
| `/feedback/report` | user-submitted data-quality reports |

Admin-only operations (`POST /mv/rebuild`, `DELETE /cache_status`) require an
`X-Admin-Key` header. The machine-readable `/openapi.json` is public; the
interactive Swagger UI is disabled in production.

## Deploy with GitHub Pages
1. Push this folder as its own GitHub repository.
2. In GitHub: `Settings` → `Pages`.
3. Set source to `Deploy from a branch`.
4. Select branch `gh-pages` and folder `/ (root)`.
5. Save and wait for the Pages URL to appear.

## Dataset & methodology
The cleaned dataset is produced by a transparent **5-stage pipeline** (OCR/HTML
repair → LLM-assisted residue review → AnnotationType normalisation → country
backfill from document symbols → artefact drop). Full detail is on the
dashboard's **Methodology** tab and in the HuggingFace dataset card. The
canonical record count is maintained in `scripts/counts.json` and synced across
the UI by `scripts/update-counts.mjs`.
