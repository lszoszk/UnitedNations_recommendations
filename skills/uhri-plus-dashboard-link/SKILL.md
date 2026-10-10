---
name: uhri-plus-dashboard-link
description: Build shareable deep links into the UHRI+ dashboard (lszoszk.github.io/UnitedNations_recommendations) — a country profile, a comparison of two countries, a keyword search with filters, a mechanism profile, or a methodology section. Use when the user wants to open, share, bookmark or embed a specific view, or after analysing UN recommendations so they can explore the same slice visually. Works without the MCP connector.
---

# UHRI+ — dashboard deep links

Base URL: `https://lszoszk.github.io/UnitedNations_recommendations/dashboard.html`

The dashboard keeps its whole state in the URL hash, so a link reproduces a view exactly. Build `base#key=value&key=value`, URL-encoding each value (spaces become `%20`, `*` becomes `%2A`).

## Views

`#view=` takes `overview`, `search`, `country`, `compare`, `group`, `theme`, `sdg`, `mechanism`, `labels`, `bookmarks`, `methodology` or `about`.

## Tested examples

| Goal | Hash |
|---|---|
| Germany's country profile | `#view=country&fc=DEU` |
| Poland, torture, 2015–2020 | `#view=country&fc=POL&q=torture&y1=2015&y2=2020` |
| Keyword search with a country filter | `#view=search&q=torture&country=Poland` |
| Compare two countries | `#view=compare&ca=DEU&cb=POL` |
| A treaty body's family rollup | `#view=mechanism&fm=CCPR&ms=family` |
| Methodology, search semantics | `#view=methodology#me-search-semantics` |

Methodology anchors: `me-cleanup`, `me-coverage`, `me-data-source`, `me-freshness`, `me-glossary`, `me-impact`, `me-search-semantics`, `me-uhri-comparison`.

## Parameters

- `fc` — focus country, as an **ISO 3166 alpha-3 code** (`DEU`, `POL`; `EUU` for the EU). `ca`/`cb` for `compare` take the same codes (country names also appear in the dashboard's own tests).
- `q` — keyword search. The box supports `AND`, `OR`, `NOT` and a trailing `*` for prefix matching.
- `country`, `body`, `region`, `sdg`, `type` — comma-separated lists. `country` uses the UN country name (`Poland`). `body` uses codes such as `CAT`, `UPR`.
- `theme`, `group` — pipe-separated (`a|b`) because the exact labels contain commas and ampersands. Read the exact labels from a retrieved item's `Themes:` line; do not guess them.
- `tm=all` / `gm=all` — require all selected themes / groups instead of any.
- `y1`, `y2` — first and last year.

## Rules

- Use only values you have seen (from a search result, `list_uhri_facets`, or the user), and tell the user if you built a link you could not open yourself.
- The dashboard and the MCP connector may not return identical totals for the same words: the dashboard adds stemming and plural expansion. Do not present one as a check on the other.
- Put no personal data in a link.
- The first visit shows a short onboarding tour; it can be dismissed.
- When a result will be cited, give the link **and** the exact filters in words, so the number can be reproduced.
