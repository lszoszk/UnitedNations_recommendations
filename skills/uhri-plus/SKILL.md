---
name: uhri-plus
description: Search and quote UN human-rights recommendations addressed to States — Universal Periodic Review, Treaty Bodies (CAT, CCPR, CEDAW, CRC…) and Special Procedures, 2006 onward (UHRI+, 270,000+ items). Use when the user asks what the UN, the UPR, a treaty body or a Special Rapporteur recommended to or observed about a country, theme or group of people, or wants verbatim recommendations with their document symbols. Needs the UHRI+ MCP connector (tool search_recommendations).
---

# UHRI+ — search and quote UN recommendations

UHRI+ is an independent research dataset built on the OHCHR Universal Human Rights Index. It holds State-directed recommendations and observations. It is **not** the text of General Comments or case law (see `uhri-plus-legal-grounding` for that) and it is not affiliated with OHCHR or the UN.

## Before you start

The UHRI+ connector must be switched on (tools `search_recommendations`, `lookup_recommendation`, `list_uhri_facets`). If those tools are not available, do not answer from memory: tell the user to connect it — the guide is https://lszoszk.github.io/UnitedNations_recommendations/ai.html — and stop.

## Workflow

1. **Get exact spellings.** If you are not certain of a country name or body code, call `list_uhri_facets` (`kind`: `countries`, `bodies`, `regions` or `types`). Country names are the UN's own; body codes include treaty bodies (`CAT`, `CCPR`, `CEDAW`, `CRC`, `CRPD`…), `UPR`, and Special Procedures mandates (`SR Torture`, `WG Arbitrary detention`, `IE Older persons`…).
2. **Search.** Call `search_recommendations` with the narrowest filters that fit: `countries`, `bodies`, `year_start`/`year_end`, `themes`, `affected_persons`, `sdgs`, `annotation_type` (`Recommendations` or `Observations`), plus `query` for free text. Multiple values inside one filter mean OR. `limit` is 1–20; use `page` to go further.
   - `themes` needs the exact long labels. Read valid ones off an earlier unfiltered result (they appear on the `Themes:` line of each item) instead of guessing.
3. **Read the header.** Results open with the true total ("7 recommendations … Showing 3 (page 1 of 3)"). Report that total; never infer a count from how many items you happened to fetch.
4. **Quote verbatim.** For each item give: the exact text, the UN document symbol, the issuing body, country, year, and the `annotation_id`. Cite the paragraph number printed at the start of the text, e.g. *CAT/OP/POL/ROSP/1, para. 97 (SPT, 2020)*.
5. **Full record.** If a snippet looks cut, call `lookup_recommendation` with the `annotation_id`.

## Things that go wrong

- **UPR attribution.** In a UPR item the State named in parentheses at the end of the text (e.g. "(Russian Federation)") is the State that *made* the recommendation, not the State under review.
- **Observation ≠ recommendation.** Treaty-body concluding observations contain both. Say which you are quoting.
- **Empty result is not evidence of absence.** Before telling the user that nothing exists, retry with simpler wording, fewer filters, or a different body. Then say what you tried.
- **No paraphrase inside quotation marks.** Put your own summary outside the quote and label it as yours.
- **Do not mix corpora.** Recommendations and General Comment paragraphs come from different tools and are never blended.
- **Rate limits.** A 429 means pause and retry later. A brief outage during the monthly data refresh: retry once. This is a single shared university server — no bulk harvesting.

## Share or reproduce

To let the user explore the same slice visually, build a dashboard link with `uhri-plus-dashboard-link`. When a number or quote will be published, record the exact filters, the date, and the dataset version (see https://lszoszk.github.io/UnitedNations_recommendations/llms.txt), and cite the software as Szoszkiewicz, Ł. (2026), UHRI+, https://doi.org/10.5281/zenodo.21319464.
