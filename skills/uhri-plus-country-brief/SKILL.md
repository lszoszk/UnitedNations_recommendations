---
name: uhri-plus-country-brief
description: Build a sourced country brief from UN human-rights recommendations — what the UPR, treaty bodies and Special Procedures have said to one State on a topic over time, with recurring concerns and verbatim quotes. Use for requests like "what has the UN told Poland about detention", "background brief on country X and children's rights", shadow-report or advocacy preparation, journalist background, or comparing mechanisms on one country. Needs the UHRI+ MCP connector.
---

# UHRI+ — country brief

Produce a short, checkable brief from UHRI+ recommendations. Follow `uhri-plus` for how to search and quote; this skill adds the structure. If the UHRI+ connector is not available, say so and point to https://lszoszk.github.io/UnitedNations_recommendations/ai.html — do not write the brief from memory.

## 1. Fix the scope (state your assumptions, do not interrogate)

Country, topic, period, mechanisms. If the user left something out, pick a sensible default and say it in one line: for example "last 10 years, all three mechanisms". Ask a question only if the country or topic is genuinely ambiguous.

## 2. Collect, one search per mechanism family

Use `search_recommendations` with `countries` set and your topic as `query`.

| Family | How to filter |
|---|---|
| UPR | `bodies: ["UPR"]` |
| Treaty bodies | `bodies` = the relevant committees, e.g. `["CAT","CCPR","CEDAW","CRC","CRPD","SPT"]` |
| Special Procedures | no `bodies` filter, keep items whose body starts with `SR`, `WG` or `IE`; or name mandates that fit the topic (e.g. `SR Torture`) |

Page through until you have either everything or a clearly stated cut-off. Note the reported total for each search; it is the figure to give the user, not the number you read.

## 3. Find what recurs

Group the retrieved items by issue. Mark an issue as **recurring** only if you have actually seen it in two or more distinct documents or years; say "in the items retrieved". Note when different mechanisms converge on the same point.

## 4. Write the brief

- **Summary** — three to five bullets, each tied to at least one quoted item below.
- **By mechanism** — a table with year, body, document symbol, and a short verbatim excerpt (quotation marks, symbol, paragraph number).
- **Recurring concerns** — the grouping from step 3, with the supporting symbols.
- **Scope and limits** — filters used, reported totals versus items read, anything not searched.
- **Sources** — full list of symbols and `annotation_id`s.

Keep verbatim UN text and your own wording visibly separate.

## 5. Caveats to carry into the brief

- Absence of a recommendation is not evidence that a State was not criticised; mechanisms review on different schedules and the dataset covers 2006 onward.
- UPR recommendations are made by other States, with the recommender named in parentheses; they are not findings of an expert body.
- This is a summary of recommendations, not a legal assessment of compliance.

Offer the user a dashboard link to the same country with `uhri-plus-dashboard-link`.
