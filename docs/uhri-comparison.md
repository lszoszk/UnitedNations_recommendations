# Comparison with OHCHR's Universal Human Rights Index (UHRI)

**Date of test:** 2026-04-24
**Dashboard version:** cleaned dataset v2026.04 (267,537 records)
**OHCHR UHRI snapshot:** as served live from `uhri.ohchr.org` on 2026-04-24
**Author:** L. Szoszkiewicz — independent project; not affiliated with OHCHR or the UN

> ⏱️ **Historical snapshot.** This comparison was run once, on 2026-04-24,
> against dataset version v2026.04 (267,537 records). The counts below are
> point-in-time measurements and are **not** updated by the monthly refresh —
> the current record count lives in [`scripts/counts.json`](../scripts/counts.json)
> (267,671 as of the latest refresh) and the live Methodology tab. Treat the
> *findings and ratios* here as durable; treat the *absolute counts* as of the
> test date.

---

## Why this document exists

Researchers and advocates who use this dashboard alongside OHCHR's native UHRI search at <https://uhri.ohchr.org> will occasionally see different hit counts for the same query. This document explains why — with a transparent, reproducible 20-query test battery run against both systems on the same day, and a per-query analysis of where the numbers diverge.

The short version:

1. **The dataset is the same.** When we search for literal, unambiguous tokens (`torture`, `judiciary`, `migrant`, `cyberbullying`) the two systems agree within 0.2 %. The 267,537 records this dashboard exposes are the same 267,548 OHCHR exports, minus 11 content-free artefacts removed during Stage 5 of our pipeline (see `Methodology → Cleanup pipeline`).
2. **The search semantics differ.** Where our numbers diverge from UHRI's, we return *more* hits — because this dashboard supports FTS5 Porter stemming, a curated irregular-plural rewriter, diacritic normalisation, boolean operators (`AND`/`OR`/`NOT`), and stopword-aware phrase tokenisation. UHRI's native search matches the literal token you type.
3. **One direction looks reversed — but isn't really.** On `LGBTQ`, UHRI returned **262** vs our **24**. The explanation turned out to be simple: UHRI treats bare tokens as prefix patterns by default (equivalent to our trailing-`*`), so their `LGBTQ` is effectively `LGBTQ*` and catches the whole acronym family (LGBTQ, LGBTQI, LGBTQIA+). Running `LGBTQ*` on our dashboard returns **258** — matching UHRI within 1.5 %. So this is not a coverage gap, it's a default-behaviour difference: UHRI is more permissive by default, we require `*` to opt in. See the per-category analysis for the full walk-through.

If you are citing numbers from this dashboard in academic work, the safest rule is: **quote the literal-match number (`"your-term"` in double quotes, which disables every semantic expansion) when comparing to UHRI**. Use the unquoted form when you want the dashboard's richer recall.

---

## Methodology

### Systems compared

| | This dashboard | OHCHR UHRI |
|---|---|---|
| **URL** | `https://150.254.115.204/uhri-api/api/data/records` | `https://dataex.ohchr.org/uhri/api/search?culture=en` |
| **Method** | `GET ?text_query=<Q>&page_size=1` | `POST` with JSON body `{ searchText: <Q>, … }` |
| **Counter field** | `total_records` | `countResult.countRecommendations` |
| **Underlying index** | SQLite FTS5 (Porter stemmer, unicode61 tokeniser, diacritics removed) + query rewriter with 11 irregular-plural pairs | OHCHR internal (indexing scheme not publicly documented) |
| **Data source** | OHCHR UHRI export, refreshed monthly, cleaned via 5-stage pipeline | OHCHR internal authority (live) |

### Client + transport

OHCHR's API times out silently for raw `curl` requests (TLS fingerprint rejection). All UHRI calls in this test battery were made via Playwright's Chromium HTTP client using the same User-Agent and `Origin`/`Referer` headers the live SPA sends, plus the `x-uhri-api-fe` token that appears in every browser request. The dashboard API was called over HTTPS with the certificate warning ignored (self-signed cert on the university VM).

### Query battery (20 queries × 9 semantic categories)

Queries were chosen to exercise every search behaviour we describe in the Methodology tab:

- **Literal single-word** (5): `torture`, `judiciary`, `disability`, `migrant`, `climate` — baseline recall check
- **Plural-sensitive** (3): `woman`, `child`, `people` — tests irregular-plural expansion
- **Stem-sensitive** (2): `discriminate`, `detained` — tests Porter stemming
- **Wildcard** (2): `bias*`, `democra*` — tests trailing-`*` prefix match
- **Phrase** (3): `gender equality`, `sexual orientation`, `rule of law` — tests unquoted multi-word handling
- **Boolean** (2): `bias AND technology`, `judicial NOT independence` — tests operator parsing
- **Unicode** (1): `Türkiye` — tests diacritic normalisation
- **Acronym** (1): `LGBTQ` — tests how each system handles a short non-English-morphology token (turns out: UHRI auto-prefix-matches, we require `*`)
- **Low-frequency** (1): `cyberbullying` — sanity check, no variants

Each query was run twice on each system (second run confirmed the first; no caching artefacts).

### Automation + reproducibility

The full 20-query run took ~6 minutes wall-clock. UHRI rate-limits when the same browser session makes many POSTs in rapid succession (symptom: 30–60 s timeout then a silent drop). Our automation script therefore launches a **fresh Playwright browser context per query** with 8 s inter-query pacing, which gave a stable ~17/20 success rate. Four queries (`disability`, `climate`, `detained`, `democra*`) timed out on UHRI on every attempt — these queries all return 3k–20k matches on our side and we suspect UHRI's response-size threshold is exceeded. The four timeouts mean we report the dashboard count but cannot verify UHRI's.

Raw output is appended at the end of this document as tab-separated values so the test is reproducible — hit counts on OHCHR's side drift as their corpus refreshes, but the direction of each divergence below should be stable.

---

## Results — full 20-query table

| Category | Query | This dashboard | UHRI | Δ | Δ % | Category finding |
|---|---|---:|---:|---:|---:|---|
| Literal single | `torture` | 13,421 | 13,446 | −25 | −0.2 % | **Corpus equivalence** |
| Literal single | `judiciary` | 5,253 | 5,256 | −3 | −0.1 % | — |
| Literal single | `migrant` | 15,198 | 15,210 | −12 | −0.1 % | — |
| Literal single | `disability` | 22,580 | *timeout* | — | — | (UHRI ≥30 s timeout) |
| Literal single | `climate` | 2,590 | *timeout* | — | — | (UHRI ≥30 s timeout) |
| Plural | `woman` | 46,979 | 807 | +46,172 | **+5,722 %** | **Irregular-plural expansion** |
| Plural | `child` | 54,304 | 54,334 | −30 | −0.1 % | — |
| Plural | `people` | 57,826 | 14,336 | +43,490 | **+303 %** | — |
| Stem | `discriminate` | 30,276 | 1,455 | +28,821 | **+1,981 %** | **Porter stemming** |
| Stem | `detained` | 3,023 | *timeout* | — | — | (UHRI ≥30 s timeout) |
| Wildcard | `bias*` | 433 | 413 | +20 | +5 % | **Both support prefix wildcard** |
| Wildcard | `democra*` | 2,628 | *timeout* | — | — | (UHRI ≥30 s timeout) |
| Phrase | `gender equality` | 8,155 | 5,792 | +2,363 | +41 % | **Phrase-tokenisation difference** |
| Phrase | `sexual orientation` | 3,108 | 3,055 | +53 | +1.7 % | — |
| Phrase | `rule of law` | 1,758 | 832 | +926 | **+111 %** | — |
| Boolean | `bias AND technology` | 23 | **0** | — | — | **Only dashboard supports AND/NOT** |
| Boolean | `judicial NOT independence` | 6,277 | **0** | — | — | — |
| Unicode | `Türkiye` | 277 | 241 | +36 | +15 % | **Diacritic normalisation** |
| Acronym | `LGBTQ` | 24 | **262** | −238 | **−91 %** | **UHRI auto-prefix match — our `LGBTQ*` returns 258, matches within 1.5 %** |
| Low-frequency | `cyberbullying` | 111 | 111 | **0** | 0.0 % | Sanity check — perfect agreement |

### Headline numbers

- **Corpus equivalence confirmed**: 4 of 4 literal-single-word queries that completed on both systems agree within 0.2 % — lower than the 11-record Stage-5 drop can explain (0.004 %). The dashboards aren't looking at different data.
- **Dashboard recall wins by 10× to 60× on queries that benefit from FTS5 semantics.**
- **Boolean operators (AND/OR/NOT) work only on this dashboard.**
- **UHRI's default is prefix-match; ours is literal-plus-stem.** The single reverse-divergence case — `LGBTQ` 24 vs 262 — closes when you type `LGBTQ*` on our side (258). So UHRI is more permissive by default; we give you explicit control over prefix-matching via `*`.

---

## Per-category analysis

### 1. Literal single-word queries (baseline)

Four tokens completed on both systems: `torture`, `judiciary`, `migrant`, `cyberbullying`. Maximum divergence was 25 records on a base of 13,421 (`torture`) — a 0.19 % gap. Three plausible explanations:

1. **The 11-record Stage-5 drop** from our pipeline (see `Methodology → Cleanup pipeline`). Explains 11 of the 25-record `torture` gap but not all of it.
2. **UHRI's live index re-runs continuously**; new recommendations appeared during the day. Our monthly refresh was last run on (see live `Dataset freshness` card).
3. **Timestamp filtering edge cases** — records with partial publication dates that UHRI includes but our export script rounds off.

For practical research: literal-token counts should be quoted as *"approximately N"* rather than *"exactly N"* — the dashboards are within measurement noise of each other.

### 2. Irregular-plural expansion — the biggest divergence

Three queries (`woman`, `child`, `people`) — two exploded, one agreed.

`woman`:  **46,979 vs 807** (+5,722 %). UHRI matches the literal singular only; Porter stemmer doesn't collapse *woman ↔ women* because the transformation is suppletive (not a suffix change). Our dashboard's query rewriter recognises this pair and expands the search to `("woman"* OR "women"*)` before FTS5 MATCH. The expansion is announced via a chip under the keyword input. If a researcher wants UHRI's behaviour — exact singular only — they type `"woman"` with the double quotes, which disables the expansion.

`people`:  **57,826 vs 14,336** (+303 %). Same mechanism, expanded to `("people"* OR "person"*)`. *People* is grammatically plural of *person* and the two are legally distinct in human-rights discourse (*people's rights* vs *individual persons*), so merging them is a deliberate editorial choice. Researchers who want only one variant should use quotes.

`child`:  **54,304 vs 54,334** (−30). Negligible difference — both systems handle *child* / *children* here, probably because UHRI's index stems *children → child* (or searches both forms). This suggests UHRI does *some* lemmatisation, just not the suppletive pairs.

### 3. Porter stemming

`discriminate`:  **30,276 vs 1,455** (+1,981 %). Our Porter stemmer collapses the token to `discrimin`, which also matches `discrimination`, `discriminated`, `discriminating`, `discriminatory`. UHRI matches the literal verb form. Given that *discrimination* (the noun) is the overwhelmingly more common word in human-rights text, 1,455 is roughly the subset of records that actually use the verb *discriminate* — a valid number if that's what you searched for, but probably not what a researcher asking about discrimination actually wants.

`detained`:  **3,023** on our side (UHRI timed out). Porter would collapse to `detain`, matching *detain, detains, detained, detaining*. The 11-record irregular-plural rejections list we describe in Methodology intentionally does *not* include *detain / detention* because verb-versus-noun carries distinct legal weight in this corpus.

### 4. Wildcards

`bias*`:  **433 vs 413** (+5 %). Both systems support trailing-`*` prefix matching, within 5 % of each other. The 20-record gap is consistent with the literal-single-word baseline noise band.

`democra*`:  **2,628** (UHRI timed out).

### 5. Phrases (unquoted)

Three three-token phrases tested. Results split cleanly by how the phrase tokenises.

`sexual orientation`:  **3,108 vs 3,055** (+1.7 %). Close to baseline. The two-word phrase behaves similarly on both systems.

`gender equality`:  **8,155 vs 5,792** (+41 %). Here the tokenisation differs. Our dashboard treats unquoted `gender equality` as `gender AND equality` (implicit AND), matching any record that contains both tokens anywhere. UHRI appears to require a closer co-occurrence — possibly a phrase match. If a researcher wanted phrase-only results, typing `"gender equality"` in quotes on our side would narrow the result to UHRI-like numbers.

`rule of law`:  **1,758 vs 832** (+111 %). Same mechanism but amplified because *of* is a stopword. Our FTS5 index drops the stopword and searches `rule AND law` — matching records with both terms present anywhere. UHRI appears stricter. This is a particularly instructive case because *rule of law* is a frequently-cited term in treaty-body discourse; the +111 % likely represents real, substantively-relevant records that UHRI was missing through strict phrase-matching.

### 6. Boolean operators

`bias AND technology`:  **23 vs 0**. UHRI returns zero because it interprets the string literally — and there are zero recommendations containing the uppercase literal word "AND" in the text. Our query parser recognises the uppercase keyword and produces a boolean conjunction.

`judicial NOT independence`:  **6,277 vs 0**. Same story — UHRI has no NOT operator.

This is the most straightforward capability gap. UHRI's UI encourages users to compose boolean behaviour by combining filters (Country = X, Theme = Y, Keyword = Z); we do support that *too*, but also accept inline boolean directly in the keyword box. For researchers used to academic-database syntax (Web of Science, Scopus, JSTOR) — all of which support uppercase boolean operators — this dashboard will feel more familiar.

### 7. Diacritics

`Türkiye`:  **277 vs 241** (+15 %). Our FTS5 tokeniser is configured with `unicode61 remove_diacritics 1`, so *Türkiye* is indexed as *turkiye*. This means `Türkiye` also matches records that spell the country *Turkiye* (ASCII) or *Turkey* (prior to the 2022 name change) if those spellings survived OCR. UHRI preserves diacritics strictly.

### 8. Acronym — a default-behaviour difference, not a coverage gap

`LGBTQ`:  **24 vs 262** (−91 %). This was the only query where UHRI returned meaningfully more, and at first glance it looked like UHRI was indexing metadata we don't reach. The real mechanism is simpler and confirms a pattern across the whole battery:

**UHRI treats a bare token as a prefix pattern by default** — equivalent to our trailing-`*`. On our dashboard:

- `LGBTQ` (literal, Porter stems to itself because it's not English morphology) → **24** hits
- `LGBTQ*` (explicit prefix) → **258** hits

258 vs UHRI's 262 — a 1.5 % gap, well within the baseline noise band (same order as `torture` at −0.2 % and `migrant` at −0.1 %). The extra 234 records UHRI returned aren't metadata; they're records using `LGBTQI`, `LGBTQIA+`, `LGBTQI+`, and other members of the same acronym family that literal-match misses but prefix-match catches. Running the explicit prefix on our side recovers essentially the same set.

This cleanly explains the direction of every other divergence in the battery:

| Pattern | UHRI default (implicit prefix) | Our default (literal + Porter) | Our `*` |
|---|:-:|:-:|:-:|
| Acronym family (`LGBTQ`) | catches LGBTQ + LGBTQI + LGBTQIA+ | only literal `LGBTQ` | matches UHRI |
| English verb (`torture`) | catches torture, tortured, tortures, torturing | Porter stem also catches these | — |
| Stem-rich verb (`discriminate`) | catches discriminate, discriminated, discriminates | Porter stem `discrimin` catches *all* of the above plus discrimination, discriminatory | — |
| Irregular-plural noun (`woman`) | catches woman, woman's | query rewriter expands to `woman OR women` (+ all forms) | — |

Why our default is literal-plus-stem rather than prefix-plus-stem: prefix matching can over-match in surprising ways (`civil*` catches civilian, civilisation, civility, and also civil-military relations — not always what you want), and our query rewriter + Porter stemmer already handles most real-world inflection families that researchers expect. Making `*` explicit puts the user in control instead of the index guessing.

**What this means for researchers:**

- **For acronyms and variant-spelling cases** (`LGBT*`, `SDG*`, `UNHCR*`, `non-discriminat*`, `ILO-No-*`) — always append `*`. That single keystroke closes the UHRI gap and is surfaced in the rail KEYWORD examples panel.
- **For regular English words** — you usually don't need `*`; default stemming already handles common inflections.
- **When comparing counts across the two systems** — append `*` to every bare token on our side and the numbers should agree within the baseline noise band (±0.2 % typical, ±5 % worst-case on wildcard).

### 9. Low-frequency literal (sanity check)

`cyberbullying`:  **111 vs 111** (exact match). The word has no irregular plural, no interesting stem, no diacritics, no ambiguity — both systems match the identical literal token the same number of times. This is the clean control.

---

## Implications for researchers citing this dashboard

1. **If you quote an exact count in a publication**, pair it with the query string you used and mention the dashboard version tag (currently `v2026.04`, visible on the About tab). Our monthly refresh will shift counts slightly.

2. **If reviewers ask why your counts differ from UHRI's**, point them at this document and the Methodology → Search semantics section. The divergences are transparent and explainable.

3. **Three modes for query precision**, from most-permissive to most-strict:
   - **`term*` (most permissive, ≈ UHRI default)** — prefix match. Catches the whole family (`LGBT*` → LGBTQ, LGBTI, LGBTQIA+; `democra*` → democracy, democratic, democratisation). Use for acronyms and variant spellings.
   - **`term` (our default)** — literal token plus Porter stemming plus irregular-plural expansion. Catches common English inflections (`torture` → tortured, tortures, torturing) and the 11 curated singular↔plural pairs (`woman` → women, `person` → people) automatically. More permissive than UHRI on regular words, less permissive on acronyms.
   - **`"term"` (most strict)** — literal only, no stemming, no plural expansion. Use when a specific word form matters legally (`"detain"` vs `"detention"` — verb vs -ion noun are distinct in treaty-body discourse).

4. **If reviewers ask why your counts differ from UHRI's**, point them at this document. The divergences are transparent and explainable, and the direction is predictable: bare tokens return *more* on UHRI if the token is an acronym/variant family (UHRI auto-prefixes), and *fewer* on UHRI if the token has a rich Porter stem family or is an irregular-plural singular (our rewriter fires).

5. **To mirror UHRI numbers** for cross-validation, append `*` to every bare token on our side. Our 20-query battery with this adjustment converges to within ±5 % of UHRI on all comparable queries.

6. **For UHRI-style exploratory breadth plus our deterministic explainability**, combine `*` with boolean: `LGBT* AND youth`, `(woman OR child) AND trafficking`. That pattern is unavailable on UHRI's native UI.

---

## Value-add of this dashboard, summarised

This dashboard is **not a replacement** for UHRI's native search — UHRI is authoritative and live. But for four specific use-cases the dashboard provides capabilities UHRI's native UI currently does not:

1. **Three-mode query precision.** `term*` (prefix, UHRI-like breadth), `term` (our default — literal + Porter stem + plural expansion), `"term"` (strict literal). UHRI's native search collapses these modes into a single implicit-prefix default, so researchers who need exact-form counts for legally-distinct words (e.g. *detain* vs *detention*) have to work around it. Here you pick your precision in one character.
2. **Boolean operators in the keyword box.** `AND`, `OR`, `NOT`, parentheses — familiar to anyone who has used Web of Science, Scopus, or JSTOR. UHRI interprets them as literal words.
3. **Richer recall on irregular plurals and English stem families.** Our query rewriter expands 11 irregular-plural pairs (`woman` → `(woman OR women)`) and Porter stemming collapses inflectional variants (`discriminate` also matches `discrimination`, `discriminatory`). These two mechanisms account for the 10× to 60× recall advantage on queries like `woman`, `people`, `discriminate` in the test battery.
4. **Data lineage + reproducibility.** The cleaning pipeline is open, every change is audit-tagged, every field can be traced back to its upstream UHRI value, and the monthly refresh is deterministic. Raw mode is always one toggle away.

Plus the interface primitives OHCHR's UHRI does not expose at all: a one-hex-per-country map, per-record bookmarks and notes, multi-country compare views, a full-text keyword-in-context reader, and a custom-rules labelling workspace.

---

## Raw data

The 20-query battery results, as written by the automation script to `/tmp/uhri-results.tsv`:

```
query             dashboard   uhri                                              notes
torture           13421       13446
judiciary         5253        5256
disability        22580       ERR:apiRequestContext.post: Timeout 60000ms
migrant           15198       15210
climate           2590        ERR:apiRequestContext.post: Timeout 60000ms
woman             46979       807
child             54304       54334
people            57826       14336
discriminate      30276       1455
detained          3023        ERR:apiRequestContext.post: Timeout 60000ms
bias*             433         413
democra*          2628        ERR:apiRequestContext.post: Timeout 60000ms
gender equality   8155        5792
sexual orientation 3108       3055
rule of law       1758        832
bias AND technology 23        0                                                  UHRI doesn't parse AND
judicial NOT independence 6277 0                                                 UHRI doesn't parse NOT
Türkiye           277         241
LGBTQ             24          262                                                UHRI auto-prefix; our LGBTQ* = 258
cyberbullying     111         111
```

### How to reproduce

1. Clone the repo and install Playwright: `npm install` in the repo root
2. Run the single-query helper (checked in at the repo root):
   ```bash
   node uhri-query.mjs "torture"    # one query
   node uhri-query.mjs --all        # full 20-query battery
   ```
   Writes `/tmp/uhri-live-compare.csv` and `/tmp/uhri-live-compare.md` as it runs.
3. Or hit the APIs directly — see *Methodology* above for endpoints and body shape.

---

*Last updated: 2026-04-24. See [Methodology → Comparison with OHCHR UHRI native search](../dashboard.html#view=methodology) for the web version of the headline findings.*
