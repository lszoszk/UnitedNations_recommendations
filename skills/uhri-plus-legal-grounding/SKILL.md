---
name: uhri-plus-legal-grounding
description: Ground UN recommendations in the standards behind them — find the General Comment, individual-communication jurisprudence or Special Procedures report paragraphs that relate to a recommendation, and resolve or verify UN citations such as "CRC/C/GC/25 ¶12" or "A/HRC/61/42 para 10". Use when asked which General Comment or case says what, what standard supports a recommendation, or whether a UN citation is real. Needs the UHRI+ MCP connector (search_paragraphs, lookup_by_citation).
---

# UHRI+ — legal grounding

UHRI+ is served together with a sister corpus of paragraph-level text: Treaty Body General Comments (`gc`), jurisprudence (`jur`) and Special Procedures reports (`sp`). The two corpora are **never combined**; this skill is how you use them side by side. If the connector is not available, say so and point to https://lszoszk.github.io/UnitedNations_recommendations/ai.html — do not quote a General Comment from memory.

## Resolve or verify a citation

Call `lookup_by_citation` with the citation as the user wrote it: `CRC/C/GC/25 ¶12`, `A/HRC/61/42 para 10`, or just `CEDAW/C/GC/30` for document metadata. It matches the **printed paragraph number**. If nothing comes back, report "not found in this corpus" — the corpus covers several thousand documents, not every UN document, so that is not proof the citation is wrong.

- **Check the label in the reply.** It starts with `SYMBOL ¶n`. If `n` is not the paragraph you asked for, that label was not found and the text is another paragraph: do not use it.
- Informal names ("GC 34", "GR 35") do not resolve, and older General Comments are filed under compilation or report symbols (e.g. `HRI/GEN/1/Rev.9 (Vol. I) p. 191`). Find the symbol with `search_paragraphs` first.
- Decimal labels (`¶8.2`, common in decisions) may not resolve. Read the document page `https://lszoszk.github.io/generalcomments/d/<doc_id>/#p8.2.` (`doc_id` comes with every search result) or the official text at `https://docs.un.org/en/<symbol>`.
- To check every UN citation in a text, use the `un-citation-check` skill of the unhrdb plugin.

## Pair a recommendation with standards

1. Fetch the recommendation with `search_recommendations` (see `uhri-plus`). Note its issuing body and issue.
2. Search the standards with `search_paragraphs`: set `query` to the legal issue in plain words, `scope` to `gc`, `jur` or `sp`, and `committee` to the same committee when there is one (e.g. `CAT`, `CCPR`, `CRC`). Add `year` only if the user asked.
3. Read the best two or three paragraphs in full through `lookup_by_citation` if the search result is a fragment.
4. Present the pair: recommendation (symbol, paragraph) beside standard (symbol, ¶), each quoted verbatim.

## Be exact about the relationship

- Say the two are **thematically related** unless the recommendation text itself cites the General Comment or case. Do not claim a committee relied on a document unless the text says so.
- Footnote markers such as `[[fn:5]]` appear in the text but the footnote content is not included. Do not invent it.
- A General Comment states how a committee interprets a treaty; it is not itself binding in the way the treaty is. Describe it as interpretive guidance.
- Quote verbatim, with symbol and paragraph number. Keep your commentary outside the quotation marks.

## Output

A short table — *Recommendation | Related standard | Why they connect (one line, your words)* — followed by the full quotations and the list of citations used.
