# UHRI Analytics Dashboard — Beta Test Plan

**Document version:** 1.0
**Date:** 2026-04-25
**Owner:** L. Szoszkiewicz
**Status:** Draft, for circulation before tester recruitment

---

## 0. How to read this document

Sections **A–C** frame the program (why, who, what success looks like).
Sections **D–H** are the operational core — phases, scenarios, infrastructure.
Sections **I–L** are forward-looking — automation gaps, regression strategy,
schedule, risks. **Appendices** carry copy-paste artefacts (recruitment
email, feedback form, NDA-light, bug template).

If you read only one thing, read **§B (Success criteria)** + **§F (Heavy-user
test scenarios)** — they encode every assumption the rest of the plan rests
on.

---

## A. Executive summary

The UHRI Analytics Dashboard is a research-grade analytics interface over
267,537 OHCHR Universal Human Rights Index recommendations, developed at
Adam Mickiewicz University with HURIDOCS and RE:CONSTITUTION support. It is
currently used by the maintainer + a small circle of collaborators; this
document plans the first structured external testing program ahead of a
broader release.

**Why now.** Recent feature density (12 view dispatchers, custom-CSV upload,
Instant Mode, Labels DSL, GA4, 6-language search semantics, M49 region
taxonomy, raw-vs-cleaned dataset toggle) has outgrown what one maintainer
can dogfood. The 20-flow self-audit on 2026-04-24 surfaced 3 product bugs
+ 1 backend bug + 1 test-selector bug — strong evidence that real users
will find more.

**Strategy.** A three-phase program, **internal QA → closed beta (heavy
users) → open beta (mixed)**, biased toward researchers and analysts who
will use the tool for hours at a time and will notice subtle correctness
issues that casual testers won't. Beta is **time-boxed at 6 weeks** with
explicit success gates before each phase transition.

**Future-proofing.** Every defect reported during beta becomes (a) a
Playwright regression test, (b) a row in a published acceptance matrix,
or (c) a documented "won't fix" with rationale. The regression suite +
backend contract tests become the gate for every subsequent release.

---

## B. Goals, non-goals, success criteria

### B.1 Goals (in priority order)

1. **Catch correctness defects** — the dashboard is a research tool; one
   wrong number cited in a published paper is worse than ten lost users.
   Filter accuracy, count consistency, dataset-toggle parity, deep-link
   reproducibility are hard requirements.
2. **Validate that heavy-user workflows actually flow** — multi-hour
   sessions, multi-tab comparative analysis, bookmark→export→cite chains,
   custom-CSV upload-and-analyse, Boolean query crafting. These are not
   covered by the existing smoke tests.
3. **Establish a regression contract** — every bug reported in beta becomes
   an automated test or a deliberate, documented exception, before the
   next release ships.
4. **De-risk launch** — discover infrastructure and operational issues
   (VM rate limits, GA consent flows, SW caching, mobile rendering) under
   real load patterns before they hit a wider audience.
5. **Build a small power-user advisory pool** — testers who report well in
   beta become the recurring panel for future releases (rotating, not
   captive).

### B.2 Non-goals

- Localisation / translation testing (UI is English-only by design;
  multilingual content support is a separate roadmap item).
- Marketing validation, willingness-to-pay, or commercial UX research —
  this is a non-commercial research tool.
- Penetration testing — covered separately by the VM/infra hardening
  track; out of beta scope.
- Mobile-first redesign — sub-960px is supported but not optimised; mobile
  bug reports are tracked but not gating launch.

### B.3 Success criteria (gating, measurable)

| Metric | Target | Source |
|---|---|---|
| Critical (P0) bugs at end of closed beta | 0 | bug tracker |
| High (P1) bugs at end of closed beta | ≤ 3 with workarounds | bug tracker |
| Tester completion rate (≥80% of assigned scenarios) | ≥ 70% of testers | scenario log |
| Net Promoter Score from heavy-user cohort | ≥ +20 | exit survey |
| Mean time-to-first-task-success on first session | ≤ 8 minutes | session log / self-report |
| Page load (LCP, p75) on Overview cold visit | < 2.5 s | RUM (web-vitals) |
| Interaction (INP, p75) on filter change | < 200 ms | RUM |
| Filter-result count ≡ Top-N panel total (any tab) | 100% | automated regression |
| Deep-link URL → state → re-encode round-trip | Lossless | automated regression |
| Backend p95 query latency (cleaned, no kw) | < 4 s | nginx access log |
| Backend 5xx rate during beta | < 0.5% | nginx access log |
| WCAG 2.2 AA automated audit (axe-core) | 0 criticals, ≤ 5 minors | axe CI |

A failure on **any** of the first three rows blocks the next phase; the
remainder are documented but not blocking unless the maintainer judges
otherwise.

---

## C. Heavy-user personas

The five personas below were derived from observed actual usage patterns
+ Human Rights Watch / OHCHR / UN-academia research methodology surveys.
Each persona drives a scenario set in §F; recruitment in §I targets a
quota per persona.

### C.1 Academic researcher — *Marta* (priority cohort)

- PhD in international law / political science / development studies.
- Multi-month research projects; cites the dashboard in published papers.
- Workflow: deep-link saved to Zotero or Notion → revisits weeks later
  and expects the same numbers → exports to xlsx for further analysis →
  cross-references with primary OHCHR source.
- **Cares most about:** reproducibility (URL hash stability, dataset
  versioning, methodology transparency); correctness (filter accuracy,
  Treaty Body classification, country-name normalisation); citation
  metadata (record permalinks, dataset version, fetch date).
- **Will not tolerate:** numbers that change between visits without
  explanation, unstable URLs, missing citation info, ambiguous
  "cleaned vs raw" distinctions.

### C.2 NGO analyst — *Tomás*

- Senior researcher at HRW / Amnesty / FIDH or a domestic NGO.
- Building country briefs, thematic reports, advocacy materials on tight
  deadlines.
- Workflow: open dashboard for a country → filter to relevant
  themes/groups → bookmark 20–60 records → export → continue editing in
  Word/LibreOffice with footnote citations.
- **Cares most about:** Compare tab (DEU vs POL kinds of comparisons),
  bookmark workflow at scale, export with full metadata, search precision
  (women, indigenous, LGBTQ, defenders — terms that under- or
  over-match in unsophisticated search).
- **Will not tolerate:** lost bookmarks, broken exports, filter UI that
  requires more than 2 minutes to compose a country+theme+year query.

### C.3 OHCHR / UN staff — *Aisha*

- Internal user verifying or contextualising the dataset against the
  authoritative OHCHR UHRI source.
- Methodology auditor, treaty-body secretariat support, occasional
  command-line user comfortable with API.
- Workflow: cross-check counts against OHCHR; raw-vs-cleaned dataset
  toggle to spot pipeline artefacts; raw API queries against the FastAPI
  backend.
- **Cares most about:** dataset provenance (Stage 1–6 cleaning pipeline
  documentation, Methodology tab depth); raw-mode parity with OHCHR;
  body classification edge cases (CCPR vs HR Committee, UPR cycles,
  Concluding Observations vs Decisions on Communications).
- **Will not tolerate:** any number that disagrees with OHCHR without an
  explainer; opaque cleaning steps; dropped or renamed bodies without
  audit trail.

### C.4 Litigation / advocacy lawyer — *Karim*

- Practitioner using the dashboard to find precedent recommendations
  ("UN bodies have called on State X to repeal article Y of the …
  Code N times since 2018").
- Workflow: precise text query (exact phrases, Boolean operators,
  date ranges) → reads ~30 full records → captures permanent URLs +
  citations into a brief.
- **Cares most about:** search precision and explainability ("why did
  this match?"), exact-phrase + wildcard reliability, individual record
  permalinks, copy-citation affordance.
- **Will not tolerate:** false matches presented without context, FTS5
  syntax errors that produce blank results without explaining why,
  records whose permalink doesn't deep-link back to that exact record.

### C.5 Journalist — *Eleni*

- Ad-hoc usage; few minutes per session, weekly cadence.
- Workflow: country in the news → quick scan of recent recommendations →
  one or two screenshots → calls the maintainer with a clarifying
  question.
- **Cares most about:** fast first paint, obvious "what does this say
  about country X" answer on the country profile, export of a single
  finding as a sharable image.
- **Will not tolerate:** anything that takes more than 30 seconds to
  understand on first visit.

---

## D. Test pyramid

The classical pyramid (unit → integration → E2E → manual) maps onto this
project as below, with current coverage and gaps marked.

```
                      ┌──────────────────────────┐
                      │   Beta UAT (heavy users) │  ← §F scenarios
                      │   ~ 25 testers · 6 weeks │     this plan
                      └──────────────────────────┘
                  ┌──────────────────────────────────┐
                  │   Exploratory + a11y manual      │  GAP → §I.4
                  │   NVDA / VoiceOver, Safari, FF   │
                  └──────────────────────────────────┘
              ┌──────────────────────────────────────────┐
              │   E2E user flows (live deployment)        │  20 flows
              │   tests/user-flows.spec.ts (Playwright)   │  EXISTS
              └──────────────────────────────────────────┘
          ┌──────────────────────────────────────────────────┐
          │   E2E smoke + tab-walk + topbar (localhost)      │  EXISTS
          │   tests/smoke + tab-walk + topbar-widths +       │  21+5+8+2
          │   analytics.spec.ts                              │  = 36 tests
          └──────────────────────────────────────────────────┘
      ┌──────────────────────────────────────────────────────────┐
      │   Backend contract tests (FastAPI endpoints)             │  GAP → §I.2
      │   /facets /records /map /analytics /health /full         │
      └──────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────────────┐
  │   Data integrity tests (count parity, hash stability)             │  GAP → §I.3
  └──────────────────────────────────────────────────────────────────┘
```

The two grey zones (backend contract, data integrity) are gaps **created**
by the beta program — see §I.

---

## E. Phases

The program runs **6 weeks** end-to-end. Phase-gate criteria are quoted
from §B.3.

### Phase 0 — Internal QA & infrastructure prep (week −2 to 0)

**Owner:** maintainer.

- Stand up missing test infrastructure (§I): axe-core CI, web-vitals RUM,
  backend contract tests, in-app bug-report widget, GA4 events for
  scenario tracking.
- Create `BETA-TESTERS.md` with onboarding link, SSH deep-link to the
  beta build, NDA-light agreement, scenario sheet.
- Pre-register the build: tag a specific commit as `beta-2026.0`,
  freeze backend `main.py` at a known revision, snapshot the dataset.
- Run the full automated suite once on the frozen build; document results
  as the **regression baseline**.
- Self-run all 50+ scenarios once (§F). Discard scenarios that produce
  false positives in this dry run.

**Exit criteria:** 100% of scheduled smoke + tab-walk + a11y CI green;
bug-report widget functional; baseline doc committed.

### Phase 1 — Closed beta, heavy users (weeks 1–3)

**Cohort:** ~12 testers, recruited per persona quota:
- 4 academic researchers (C.1)
- 3 NGO analysts (C.2)
- 2 OHCHR/UN staff (C.3)
- 2 lawyers (C.4)
- 1 journalist (C.5)

**Format:** structured. Each tester gets a **scenario sheet** (§F) with
their persona's flows + a free-form exploration block. Sessions are
self-paced, ~2 hours per tester per week, three rounds (orientation,
deep dive, freeform).

**Communication:** dedicated Slack/Mattermost channel with the maintainer
+ a separate Notion/GitHub Discussions board for reports. Weekly
30-minute group call — optional attendance, recorded.

**Exit criteria** (§B.3 rows 1, 2, 3, plus): all P0 fixed and verified;
P1 either fixed or documented with workaround; ≥70% scenario completion;
exit survey NPS ≥ +20; baseline regression suite green on the latest
HEAD.

### Phase 2 — Open beta (weeks 4–5)

**Cohort:** ~50 testers, less curated. Distributed via:
- HRC / OHCHR mailing lists (Aisha persona expansion)
- Re:constitution network (academic expansion)
- Maintainer's personal academic Twitter/Bluesky/LinkedIn

**Format:** lighter-touch. Three target scenarios (Overview, Country
profile, Search) + a single-question survey ("Did you find what you
came for? Y/N + 1-sentence why").

**Exit criteria:** crash rate < 0.5%, no new P0/P1 surfaces in the last
72 hours of the phase, RUM CWV targets met (§B.3).

### Phase 3 — Public launch (week 6)

Soft-launch on the existing GitHub Pages URL with a "this is v1.0,
released after a 6-week beta with X testers" banner that fades after
72 hours. Schedule a v1.1 patch release for week 8 to roll up
non-blocking issues found in the launch tail.

---

## F. Heavy-user test scenarios

Scenarios are organised by persona; each carries a **goal**, a **success
signal**, an **anti-goal** (what would constitute failure), and a
**failure escalation level** (S0/S1/S2). Numbering allows traceability
into the regression suite.

> Convention: **S0** = blocks the phase if it fails; **S1** = blocks the
> next phase; **S2** = catalogue, fix in v1.1.

### F.1 Marta — academic researcher (S0/S1 only)

**M-01 [S0] Reproducibility round-trip.** Compose a complex filter
(country=Poland + theme=Privacy + 2018–2024 + keyword="data protection")
on Overview. Copy the URL, close the tab, paste it into a fresh browser
(no localStorage). Verify every facet, the year slider, and the keyword
re-render identically. Check `state.facets.total_records` numerator
matches the original number.

**M-02 [S0] Citation permanence.** Open any record. Copy its permalink
from the drawer. Paste it 24h later; verify the same record opens with
the same metadata. (Tests: drawer permalink generation, record-by-id
endpoint stability.)

**M-03 [S0] Dataset version transparency.** From the Methodology tab,
identify (a) the source (OHCHR UHRI), (b) the cleaning pipeline version,
(c) the dataset fetch date, (d) the record count broken down by Stage.
Each must be present and correct.

**M-04 [S1] Cleaned vs raw parity audit.** Pick any country. Note record
count under "DATA · cleaned". Switch to "DATA · raw upstream". Document
the delta, then click any artefact and verify the explanation matches
Methodology Stage 5.

**M-05 [S1] Export integrity.** Apply a filter, export to xlsx, count
rows in the export. Re-apply the same filter via URL, export again.
The two exports must be byte-identical for the data columns.

**M-06 [S1] Hash stability across sessions.** Bookmark a complex view
(Compare DEU/POL with theme + year). Wait 7 days (covers a re-deploy).
Open the bookmark; verify identical state restoration.

### F.2 Tomás — NGO analyst (S0/S1)

**T-01 [S0] Compare-tab dual-country brief.** Goal: produce a 1-page
brief comparing Germany and Poland on theme="freedom of expression",
2014–2024. Success: timeline rendered, top groups for each, side-by-side
counts; export both columns to a single xlsx.

**T-02 [S0] Bookmark-at-scale workflow.** Bookmark 30+ records across
3 separate filter sessions. Open the Bookmarks view. Verify all 30+
records present, ordering preserved, exportable, and survive a hard
reload.

**T-03 [S0] Search precision: women.** Search "women". Expect ~60–80k
matches (the corpus average); verify the synonym chip "woman → women"
appears, scroll the result list 3 pages without errors, click into any
record and confirm "women" or "woman" actually appears.

**T-04 [S0] Search precision: LGBTQ.** Search `LGBTQ*` (with wildcard).
Verify count ≈ 250–270 (per docs/uhri-comparison.md). Open three
records, confirm relevance.

**T-05 [S1] Concerned-groups deep dive.** Group profile → "Indigenous
peoples" → switch the entity dropdown to "Persons with disabilities" →
verify the timeline updates, top countries update, sample records update.
No stale state from the previous group.

**T-06 [S1] Refine-and-clear pattern.** Apply 5 filters → realise
they're wrong → CLEAR ALL → expect facets reset, hit count back to
267,537, URL hash empty.

### F.3 Aisha — OHCHR/UN staff (S0/S1)

**A-01 [S0] Body classification audit.** Open the Recommending Body
filter. Verify each item is classified into UPR / Treaty Bodies /
Special Procedures correctly. CCPR is a Treaty Body (not UPR). Special
Procedures includes Working Groups + Independent Experts. No body is
mis-classified or "Other".

**A-02 [S0] Country-name canonicalisation.** Verify every variant of
"Iran (Islamic Republic of)", "Türkiye / Turkey", "Czechia / Czech
Republic", "Palestine *" (with asterisk), "Holy See (Vatican)" maps to
exactly one row in the rail and one tile on the hex map. No duplicates,
no drops.

**A-03 [S0] Methodology tab depth.** Read end-to-end: every claim has
either a number, a code reference, or an OHCHR primary-source link.
Stage 1–6 each named, dated, audited.

**A-04 [S1] Raw vs cleaned dataset toggle parity.** Top-line number on
"raw upstream" matches the OHCHR primary record count ± 5 records.
Switch back to "cleaned" — match the cleaning Stage 5 output.

**A-05 [S1] FastAPI direct query parity.** `curl -k
'https://150.254.115.204/uhri-api/api/data/facets'` → counts parity
with what the dashboard shows. (Frontend not lying about backend.)

### F.4 Karim — lawyer (S0/S1)

**K-01 [S0] Exact-phrase precision.** Search `"abolish the death
penalty"` (with quotes). Expect tight result set (50–500). Open 3
records: each contains the exact phrase. No fuzzy matches.

**K-02 [S0] Boolean composability.** Search `(torture OR
"cruel treatment") AND NOT military`. Verify count is bounded by
`torture OR "cruel treatment"` count and is reduced by the NOT clause.
Inspect random 5 records — none mention `military`.

**K-03 [S0] Search-failure UX.** Submit a deliberately broken query:
bare `*`, `AND` alone, `!@#`. Verify an inline error card explains
the issue — no blank result list, no console error visible, suggested
correction shown.

**K-04 [S1] Permalink → exact record drill.** Open a record from a
result list. Copy the in-drawer permalink. Open it in a new tab. The
same record opens, with full metadata + reader pane available.

**K-05 [S1] Wildcard prefix reliability.** Search `discriminat*`. Verify
matches include `discrimination`, `discriminatory`, `discriminated`,
`discriminates`. Count > 50,000 (per docs).

### F.5 Eleni — journalist (S2)

**E-01 [S2] First impression — 30s test.** Land on `/`. Within 30
seconds, identify (a) what the dataset is, (b) how many records it has,
(c) one mechanism family count.

**E-02 [S2] Country profile glance.** Open Country tab → pick a
country in the news. Within 2 minutes, find the most-cited theme + a
recent recommendation.

**E-03 [S2] Screenshot-of-finding workflow.** Find one finding → SVG
or PNG export of the chart that shows it.

### F.6 Cross-cutting scenarios (every tester runs at least one)

**X-01 [S0] Custom CSV upload.** Upload a known small UHRI export
(provided). Verify (a) the upload banner appears, (b) the source pill in
topbar shows filename, (c) sidebar shows "source: <file>",
(d) Three-mechanism breakdown sums to upload total, (e) "back to live"
button restores the live VM dataset.

**X-02 [S0] Instant Mode round-trip.** Activate Instant Mode → wait for
download → switch to a complex filter → measure latency (<200 ms per
filter change) → disable and clear cache → verify live mode resumes.

**X-03 [S1] Cross-tab consistency.** Apply filter on Overview. Switch
to Country, then Theme, then Group, then SDG, then Mechanism, then
Search. The hit count in the rail must remain identical across all 7
tabs (when no tab-local override is applied).

**X-04 [S1] Browser back/forward stress.** Visit 6 different views with
different filters. Press back 6 times, then forward 6 times. Verify
every state restores correctly, no JS errors, no orphaned rendering.

**X-05 [S1] Service Worker cache invalidation.** When a redeploy ships
(SW SHELL_CACHE bumps), users should see the "refresh for new version"
chip within ~30s of opening a stale tab. Ack the chip → fresh build.

**X-06 [S2] Mobile viewport.** Open at 375 × 812 (iPhone 13 mini). Run
a single search. Hit count visible, results scrollable, drawer
accessible. (Doesn't gate; informs v1.1.)

**X-07 [S2] Slow network.** Throttle to "Slow 3G" in DevTools → cold
visit. Skeleton renders within 2s; full data within 30s; no JS errors.

---

## G. Feedback collection infrastructure

Three channels, ranked by friction (lowest first):

### G.1 In-app bug-report widget (planned, §I.5)

A floating button bottom-right of every view, opens a small form:
- Auto-captures: user-agent, viewport, current URL hash, last 10
  console errors, current `state` snapshot, GA `client_id`.
- Asks: 1-line summary; severity dropdown (P0/P1/P2/won't-fix);
  reproduction steps; screenshot upload.
- Submits to: a Formspree / Netlify Forms / GitHub Issues API endpoint
  (cheap, no backend dependency).

This is the **primary channel** for in-flow reports.

### G.2 Scenario sheet — Notion / GitHub Discussions

Each tester gets a copy of the persona-scoped scenario sheet (§F).
Per scenario:
- ✅ Worked as expected
- ⚠️ Worked but confusing — note why
- ❌ Did not work — note what happened

Lighter-touch than a bug report; used to compute scenario-completion
rate (§B.3). Aggregated weekly into a status doc.

### G.3 Exit survey (Typeform / Lyssna / paper)

End of beta. ~10 questions. NPS ("how likely are you to recommend the
dashboard to a colleague?", 0–10), task-completion confidence per
persona-relevant scenario, free-text "what one thing would change your
score from N to N+2?".

### G.4 Optional: 30-min recorded session

Per the NN/G "qualitative usability testing" protocol — 5 testers (one
per persona) walk through their scenarios on screen-share with the
maintainer observing silently. **Recommended but not required;** highest
qualitative yield, highest recruiter cost.

---

## H. Bug triage & SLA

### H.1 Severity scale

- **P0 — Data wrong.** Any number, classification, or filter result that
  contradicts the source-of-truth (OHCHR UHRI for cleaned-dataset
  numerators; the cleaning pipeline output for the rest). Includes
  obvious data corruption, dropped records, mis-attributed countries.
- **P0 — Crash / unrecoverable.** Page errors that leave a view
  unusable; can't recover without a hard reload; loss of user state
  (filters, bookmarks).
- **P1 — Degraded.** Workflow possible but slower/harder than designed.
  Missing label, broken visual, layout overflow, search returns blank
  with unclear error. **Has a workaround.**
- **P2 — Polish.** Typo, color contrast, copy ambiguity, mobile-narrow
  layout glitch, "could be nicer." No workaround needed.
- **Won't fix.** Documented exception; rationale in the bug ticket.

### H.2 Response SLA during beta

| Severity | Acknowledge | Triage | Fix / decision |
|---|---|---|---|
| P0 | 2 h (waking hours) | 24 h | 72 h |
| P1 | 24 h | 72 h | 7 d |
| P2 | 7 d | 14 d | next minor release |

### H.3 Single source of truth

GitHub Issues on the dashboard repo, label scheme:
`severity:p0`, `severity:p1`, `severity:p2`, `won't-fix`,
`persona:academic`, `persona:ngo`, ...,
`area:filters`, `area:search`, `area:export`, ...,
`phase:closed-beta`, `phase:open-beta`, `phase:launch`.

Every bug ticket carries: tester ID (anonymised pseudonym), persona,
scenario ID, browser+OS, viewport, repro steps, expected vs actual,
severity (tester's), severity-final (maintainer's), resolution + commit
SHA when closed.

---

## I. Automation gaps to fill before Phase 1

The existing test infrastructure (§Inventory above the plan) is strong
but has eight gaps the beta program would magnify if not addressed.
**Each gap below is a Phase-0 work item.**

### I.1 Backend contract tests *(highest priority)*

Currently the only backend "test" is the manual curl in
`docs/user-flows-report-2026-04-24.md`. The 2026-04-24 audit surfaced a
500-without-CORS bug in the FastAPI exception handler — exactly the
class of issue contract tests catch.

**Build:** a `tests/contracts/` suite that exercises every backend
endpoint listed in `dashboard-data.js` (`api.facets`, `api.records`,
`api.map`, `api.analytics`, `api.health`, `api.full`, `api.export`)
against the live VM. Each test asserts:
- HTTP 200 on canonical input
- HTTP 4xx (not 5xx) on malformed input
- CORS headers present on every response (incl. errors)
- JSON shape matches the documented schema (one schema file per endpoint
  in `docs/api-schemas/`)
- Latency p95 below SLO (§B.3)

**Tool:** keep it cheap — `pytest` + `requests` or even `bash + jq`. Run
on every push to the dashboard repo; nightly against live.

### I.2 Data integrity / count-parity tests

The dashboard currently does not assert that the rail's hit count
matches the sum of the Top-N panels, that filter A∩B == B∩A, or that
the same filter via URL params and via UI clicks produces the same
count. **These are the kind of issues §B.3's "hard" success criterion
requires.**

**Build:** a `tests/integrity.spec.ts` Playwright suite that, for a
sampled set of filter compositions:
- Checks rail hit count == sum of mechanism tile counts.
- Applies (country=X, theme=Y) via UI and via URL hash; counts must match.
- Applies (country=X) then (country=X, theme=Y); the second result must
  be a subset of the first.
- Round-trips a deep link: state → URL → state'; assert state ≡ state'.

### I.3 Accessibility CI (axe-core)

Currently zero automated WCAG checks. WCAG 2.2 AA is a documented goal
(`a11y + perf` commit `e7e8395`).

**Build:** install `@axe-core/playwright`, add an `a11y.spec.ts` that
visits every view + every modal/popover and asserts zero criticals.
Document violations (with rationale) in `docs/a11y-exceptions.md`.
Manual screen-reader pass (NVDA + VoiceOver) on the canonical Overview
+ Search + Country flows.

### I.4 Real-user monitoring (web-vitals)

Currently zero CWV measurement in production. Targets in §B.3 cannot
be verified without telemetry.

**Build:** install the `web-vitals` package, wire LCP/INP/CLS reporting
to GA4 events (consent-gated, same as the existing search_performed
event). Dashboard the results in Looker Studio or similar; update §B.3
with actuals before each phase gate.

### I.5 In-app bug-report widget

See §G.1. Implementation: a small floating button + form, submitting
to GitHub Issues API via a Cloudflare Worker (so the GitHub PAT lives
on server side). Two-day implementation; cuts feedback friction by
roughly an order of magnitude.

### I.6 Cross-browser CI

Playwright config currently runs `chromium` only. The 5364fd9 commit
mentions a Safari 26 SW regression — exactly why Safari + Firefox in
CI matters.

**Build:** add `firefox` and `webkit` projects to
`playwright.config.ts`. Run on push (chromium-blocking, others
informational) and nightly (all blocking).

### I.7 Mobile-viewport CI

Currently only `topbar-widths.spec.ts` cares about viewport, and only
desktop widths. Add a mobile project (375 × 812, `devices['iPhone 13']`)
that runs the tab-walk + a couple of search flows. Informational, not
blocking — mobile parity is a v1.1 goal per §B.2.

### I.8 GitHub Actions CI/CD

Currently `npm test` runs locally only. Add `.github/workflows/test.yml`
with: install → smoke + tab-walk + topbar + analytics + a11y +
contract jobs in parallel → comment results on PR. Block merges to
`gh-pages` on red.

---

## J. Future-proof regression strategy

### J.1 Every bug becomes a test

When a beta tester reports a bug:
1. Reproduce locally; capture the minimal repro (URL hash + steps).
2. Write a Playwright (or contract, or integrity) test that fails on
   the bug.
3. Fix the bug; the test now passes; commit both in the same change.

The 2026-04-24 audit produced commits `99d1330` (3 product fixes) and
`dbe6d0f` (race-condition fix) — but only `dbe6d0f` ships with a
regression test. **Tighten this discipline for beta.**

### J.2 Contract testing for backend ↔ frontend

The dashboard couples to a separately-deployed FastAPI backend over
HTTPS. Schema drift is the highest-likelihood-medium-impact risk.

**Mitigation:** versioned API schemas (`docs/api-schemas/v1/*.json`).
Contract tests (§I.1) read the schemas and fail when responses drift.
Backend changes that intentionally break the schema bump the schema
version + the dashboard's expected version + are documented in
`CHANGELOG-API.md`.

### J.3 Data freshness contract

The dataset is re-pulled from OHCHR weekly via `uhri_weekly_sync.py`.
Pulls can fail silently (network, source-format change, OHCHR-side
incident). Add a **freshness telemetry**:
- `/api/data/health` returns `modified_at` (already exists per
  `dashboard-offline.js:374-385`).
- A scheduled GitHub Action checks `modified_at` is no older than 14
  days; opens an issue if older.
- The dashboard surfaces the freshness status in the topbar (already
  partially done — extend to a freshness chip if older than 14d).

### J.4 Tester rotation

The same testers across multiple releases produce diminishing-returns
feedback (familiarity bias). Rotate **half** of the closed-beta panel
per major release. Maintain a pool of past good testers + a pipeline of
new candidates per persona.

### J.5 Test plan versioning

This document is `test-plan-beta-2026.md` (v1.0). Each subsequent major
release updates it (v1.1, v2.0). Old versions stay in repo for audit
trail. Diff the plan against the previous to see what was learned.

### J.6 Public regression suite as a quality artefact

After launch, add a top-of-README badge: `tests: 36 passing / live: ✓ /
a11y: AA / api contract: 7/7`. Link to the suite. Researchers value
research tools whose maintainers visibly invest in correctness; the
badge is also future-proofing — it raises the implicit cost of
shipping a regression.

---

## K. Schedule + resource estimate

```
Week  -2  -1   0   1   2   3   4   5   6   7   8
      ┌─────────┐
P0 QA │ ███████ │
      └─────────┘
                ┌──────────────────┐
P1 closed beta  │ ███ ███ ███      │
                └──────────────────┘
                                   ┌────────┐
P2 open beta                       │ ██████ │
                                   └────────┘
                                            ┌─┐
Launch                                      │█│
                                            └─┘
                                                ┌─┐
v1.1 patch                                      │█│
                                                └─┘
```

### K.1 Maintainer time (estimated)

- Phase 0: 60–80 h (the eight gaps in §I)
- Phase 1: 30 h triage + 40 h fixes + 5 h calls = ~75 h
- Phase 2: 15 h triage + 20 h fixes = ~35 h
- Launch + patch: 20 h
- **Total: ~210 h over 8 weeks** ≈ 25 h/week, sustainable solo.

### K.2 Tester time (asked of testers)

- Closed beta: 6h × 3 weeks = 18 h per tester. Small thank-you
  honorarium considered (book token / co-authorship acknowledgement
  per academic norms).
- Open beta: 30 min, voluntary.

### K.3 Costs

- GitHub Pages, GA4, Cloudflare Worker (Issues bridge): free tier.
- BrowserStack / Sauce Labs (cross-browser real devices): ~ €40/mo if
  Playwright `webkit` proves insufficient. Probably skip.
- Lyssna / Maze / Typeform exit survey: free tier likely sufficient;
  budget €30/mo cap.
- Tester honoraria: €0–€100 per tester academic acknowledgement; cap
  €1,000.

---

## L. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Backend goes down mid-beta (VM cert expiry, ISP issue) | Med | High | Health-check job; pre-stage Instant Mode payload; 24h SLA on backend incidents documented |
| R2 | OHCHR changes UHRI source format unexpectedly | Med | High | Weekly sync job alerts on parser failure; data freshness chip surfaces stale data |
| R3 | Tester drop-off mid-program | High | Med | Over-recruit by 30%; rotating reminders; honoraria; weekly call optional but warm |
| R4 | Critical bug found in last week of open beta | Med | High | Hold a "code freeze" release-candidate from week 4; only critical fixes after that |
| R5 | GA4 consent flow subtly broken; lose telemetry | Low | Med | Smoke test asserts gtag fires only after consent; manual verification per phase |
| R6 | Cross-browser regression (Safari 26 SW bug) re-emerges | Med | Med | §I.6 cross-browser CI; Safari-specific manual pass each phase |
| R7 | Researcher cites dashboard, then a number changes | Low | Very high | Dataset versioning + permalink → version pinning; "as of YYYY-MM-DD" required in citation guide |
| R8 | Beta scope creeps; release slips ≥1 month | Med | Med | Hard scope cap: P0/P1 only block release; P2 → v1.1. Maintainer-only release decision |
| R9 | Tester PII / sensitive uploaded data leaks via bug report screenshots | Low | High | Upload widget redacts known-PII patterns; explicit "your screenshot will be visible to maintainer" disclaimer |
| R10 | Service Worker cache traps users on stale build | Med | Med | §I.5 in-chip handler exists; document hard-reload procedure in BETA-TESTERS.md |

---

## Appendix A — Tester recruitment email (copy-paste)

> Subject: 6-week beta of the UHRI Analytics Dashboard — would you take 2h/week?
>
> Hi <name>,
>
> I'm running a closed beta of the UHRI Analytics Dashboard, a research
> tool over the OHCHR Universal Human Rights Index recommendations
> dataset (267k records). It's at https://lszoszk.github.io/UnitedNations_recommendations/.
>
> I'm looking for ~12 heavy users — researchers, NGO analysts, OHCHR
> staff, lawyers, journalists — to use the tool for ~2 hours a week
> over 3 weeks (early May → late May 2026), report bugs and feedback,
> and help shape the v1.0 release.
>
> What I'd ask:
> - 2h/week, self-paced
> - Walk through a short scenario sheet (matched to your typical use)
> - File bugs via a single in-app button (no GitHub account needed)
> - Optional: one 30-min screen-share call with me
>
> What I'd give back:
> - A small honorarium (Amazon voucher or equivalent, €40)
> - Acknowledgement in the v1.0 release notes (or anonymity, your call)
> - Early access to features I'm planning for v1.1
> - The tool itself, free, forever, with proper citation guide
>
> Interested? Reply to this email or sign up at <link>. Beta begins
> 2026-05-04.
>
> — L. Szoszkiewicz, AMU Faculty of Law / RE:CONSTITUTION

---

## Appendix B — Bug report template (in-app form)

```
Severity: [ P0 — broken/wrong | P1 — degraded | P2 — polish | not sure ]

What went wrong (1 sentence):
_____________________________________________

What were you trying to do:
_____________________________________________

Steps to reproduce:
1. _________________________________________
2. _________________________________________
3. _________________________________________

What you expected:
_____________________________________________

What actually happened:
_____________________________________________

[ optional ] Screenshot: [drag-and-drop area]

[ auto-captured ]
- URL: <auto>
- User-agent: <auto>
- Viewport: <auto>
- Last 10 console errors: <auto>
- GA client ID: <auto>
```

---

## Appendix C — Exit survey (10 questions)

1. (NPS) On a 0–10 scale, how likely would you recommend this dashboard
   to a colleague doing similar work?
2. (Open) What was the **single most useful** thing the dashboard did
   for you?
3. (Open) What was the **single most frustrating** thing?
4. Did you trust the numbers? [Always / Mostly / Sometimes / No / Didn't
   check]
5. Did the dashboard let you complete <persona-relevant scenario>?
   [Yes / Yes-with-difficulty / No]
6. (Open) If "no" or "with-difficulty", what blocked you?
7. Did you discover any feature by accident? Which one?
8. Did you encounter a bug serious enough to abandon a session? [Y/N +
   open]
9. Would you use this dashboard for a real publication / report? [Y/N +
   open]
10. (Open) One change that would move you from <NPS score> to
    <NPS score+2>?

---

## Appendix D — Scenario sheet template (per tester)

```
UHRI Beta — Scenario sheet for <persona>
Tester pseudonym: ____________ · Browser: ____________ · OS: ____________

WEEK 1 — Orientation (90 min)
[ ] M-01 Reproducibility round-trip                  → ⬜ ⚠️ ❌
[ ] M-02 Citation permanence                         → ⬜ ⚠️ ❌
[ ] M-03 Dataset version transparency                → ⬜ ⚠️ ❌
[ ] X-03 Cross-tab consistency                       → ⬜ ⚠️ ❌
                                                ── Notes / blockers:
________________________________________________________________

WEEK 2 — Deep dive (90 min)
[ ] M-04 Cleaned vs raw parity audit                 → ⬜ ⚠️ ❌
[ ] M-05 Export integrity                            → ⬜ ⚠️ ❌
[ ] X-01 Custom CSV upload                           → ⬜ ⚠️ ❌
[ ] X-04 Browser back/forward stress                 → ⬜ ⚠️ ❌
                                                ── Notes / blockers:
________________________________________________________________

WEEK 3 — Freeform exploration (90 min)
Task: complete a self-defined research task end-to-end.
Describe what you set out to do, and what happened:
________________________________________________________________
```

---

## Appendix E — NDA-light (single paragraph)

> By participating in the UHRI Analytics Dashboard beta program, I agree
> to (a) not redistribute the beta build URL outside the program until
> public launch, (b) not publish screenshots that name the maintainer
> negatively without prior conversation, (c) treat any data I upload via
> the Custom-CSV feature as my own to redistribute, and (d) understand
> that the maintainer may include anonymised quotes from my feedback in
> public release notes unless I opt out. Beta participation is voluntary
> and I may withdraw at any time.

---

## Sources & methodology

This plan synthesises:

- The existing test inventory (Playwright suites, user-flows audit doc,
  GA4 wiring) collected via in-repo exploration.
- 2026 best-practice surveys on beta programs, UAT for analytics
  dashboards, and accessibility for data viz (BetaTesting.com guides,
  Centercode UAT primers, Tableau dashboard-a11y patterns,
  the W3C WAI evaluation tools list).
- Human Rights Watch's published research methodology, used to inform
  the academic + NGO + OHCHR personas.
- Nielsen Norman Group's qualitative usability testing protocol, used
  for §G.4.
- The 2026-04-24 self-audit (`docs/user-flows-report-2026-04-24.md`),
  which provided the empirical bug-class baseline.

---

*End of plan v1.0.*
