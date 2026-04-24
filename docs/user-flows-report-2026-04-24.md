# User-flow diagnostic — 2026-04-24

Twenty Playwright-driven flows (10 heavy + 10 casual) run against the
**live deployed dashboard**.  Each flow exercised real UI
(clicks, keyboard shortcuts, back/forward navigation, refine + clear
patterns) and collected console + page errors.  Full machine-readable
per-flow log at `test-results/user-flows-report.md`; this document is
the human summary with the bugs that surfaced and what was done about
them.

---

## Bugs found + fixed

### 🐛 H5: Labels starter template → `pageerror: total is not defined`

Clicking any of the starter rule templates in the Labels tab produced
a fatal JS error.  Root cause: `dashboard-labels.js:468` referenced
an undefined variable (`total` instead of the local `denom` used two
lines earlier).  Never caught because the error fired from a tooltip
`title` attribute assignment that looked plausible.

**Fix:** `${fmt(total)}` → `${fmt(denom)}`.  One-character delta.

### 🐛 C9: Unknown `#view=<typo>` → completely blank dashboard

Navigating to `#view=nonsense` (or any mistyped view name) caused
`navigate()` to hide ALL `.view` elements without rendering anything
— user saw a blank main-content area.  Happens on shared-link
typos, stale bookmarks, and GPT-generated URLs that invent view
names.

**Fix:** added `_VALID_VIEWS` set (12 entries, all real SPA views)
and early fallback to `overview` with a `console.warn` for
operator visibility.  Unknown views now land users on the homepage
instead of nothing.

### 🐛 C5 + others: Search failures left `#seList` blank

When `/api/data/records` returned an error (backend 500 on
special-character queries, cross-origin block, transient network),
the dashboard showed "failed" in the count badge and a brief toast,
but left the results list area completely empty.  Users had no
explanation of what happened in the place they were looking.

**Fix:** the `catch` branch of `loadNextSearchPage` now renders an
inline error card with:
- Echo of the failing query
- Heuristic hint ("odd punctuation or unclosed quote?" vs
  "transient backend")
- Canonical syntax-examples block
- "Clear keyword" + "Edit keyword" buttons

### 🧪 H6: Test-selector bug (not product bug)

My test queried `#view-bookmarks .dr-list-card` — wrong class.
Bookmarks view actually uses `.bm-card`.  `bmToggle` in
`dashboard-utils.js` correctly saves to localStorage; the save
path was fine all along.  Fixed the test selector so the flow
report stops lying about it.

---

## Backend-side finding (out of scope for this repo)

### ⚠️ FastAPI returns **500 Internal Server Error** on special-char queries

Verified with:

```bash
curl -sk "https://150.254.115.204/uhri-api/api/data/records?text_query=$q&page_size=1"

q='!@#'                        → 500
q='*'                          → 500  (bare asterisk; legitimate FTS5 = empty token)
q='AND'                        → 500  (boolean operator alone)
q='very-unlikely-phrase-xyz123' → 500  (hyphens; FTS5 treats as NOT)
```

The query parser is crashing instead of returning a friendly
400/empty-result.  Compounded by the fact that **500 responses lack
CORS headers** (FastAPI's CORSMiddleware skips error-path responses),
so in the browser these surface as "CORS blocked" rather than a
comprehensible error.

Fix path — not in this repo:

1. In the FastAPI backend (/opt/uhri/ or wherever the Python lives),
   wrap the FTS5 query-building in try/except.  Return 400 with
   `{"error": "bad query syntax", "detail": "..."}` instead of
   propagating the exception to a 500.
2. Either configure the CORSMiddleware to also emit headers on
   error responses, or add a global exception handler that emits
   CORS + structured JSON.

Until that lands, the frontend fix above (inline error card +
heuristic hint) masks the UX sharpness.

---

## Clean flows (16 of 20 green as designed)

All the following worked exactly as intended, zero console errors:

- **H1** search → open drawer → reader toggle
- **H2** search "woman" → country=Poland refinement
- **H3** dataset toggle cleaned↔raw (round-trip count identical)
- **H4** Theme profile → drill to country
- **H7** Compare DEU vs POL dual rendering
- **H8** Methodology TOC jump between 3 sections
- **H9** deep-link restoration with country+keyword+year, survives reload
- **H10** ⌘K palette open + type + Enter
- **C1** Landing "Open dashboard" CTA
- **C2** Hex map click → country profile
- **C3** Search + infinite scroll
- **C4** result → bookmark → close drawer
- **C6** rail toggle hide/show
- **C7** Copy quote to clipboard
- **C8** GA consent reject flow
- **C10** back/forward stress (3 backs + 1 forward)

Screenshots for each flow in `test-results/flow-*.png`.

---

## How to re-run

```bash
cd /path/to/repo
npx playwright test --config=playwright.live.config.ts
# → test-results/user-flows-report.md (machine-readable)
# → test-results/flow-*.png (per-flow screenshots)
```

Tests hit live production (https://lszoszk.github.io/UnitedNations_recommendations/).
Paced at ~1 req/sec; never trips the VM's rate-limit caps.  Total
runtime ~5 minutes.

Each flow always passes as a Playwright test; the diagnostic
richness lives in the markdown report, not in pass/fail.  This is
deliberate — we want all 20 flows to complete so the report is
complete, not to abort at the first surprise.
