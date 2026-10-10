# UHRI+ skills for Claude

Four small skills that teach Claude how to work with UHRI+ — the dashboard and
dataset of more than 270,000 UN human-rights recommendations (Treaty Bodies,
Universal Periodic Review, Special Procedures, 2006 onward). They make answers
verbatim, cited to the UN document symbol, and honest about counts and limits.

| Skill | Use it when you want Claude to… | Needs the connector |
|---|---|---|
| [`uhri-plus`](uhri-plus/SKILL.md) | find and quote what the UN, the UPR, a treaty body or a Special Rapporteur recommended on a country, theme or group | yes |
| [`uhri-plus-country-brief`](uhri-plus-country-brief/SKILL.md) | write a sourced brief on one country and topic across all three mechanisms, with recurring concerns | yes |
| [`uhri-plus-legal-grounding`](uhri-plus-legal-grounding/SKILL.md) | tie a recommendation to the General Comment, case or report paragraph behind it, or verify a citation such as `CRC/C/GC/25 ¶12` | yes |
| [`uhri-plus-dashboard-link`](uhri-plus-dashboard-link/SKILL.md) | build a shareable link to a country profile, comparison, search or methodology section of the dashboard | no |

The first three call the hosted **UHRI+ connector** (an MCP server — free, no
account). Connect it first: <https://lszoszk.github.io/UnitedNations_recommendations/ai.html>.

## Install

**Claude (web or desktop app).** Download the zips below, then open
*Customize → Skills* (in some versions *Settings → Capabilities → Skills*) and
upload each one. If a menu has moved, search the Claude help centre for
"upload a skill". Skills need a plan and settings that allow them; the help
centre lists the current requirements.

- [uhri-plus.zip](uhri-plus.zip)
- [uhri-plus-country-brief.zip](uhri-plus-country-brief.zip)
- [uhri-plus-legal-grounding.zip](uhri-plus-legal-grounding.zip)
- [uhri-plus-dashboard-link.zip](uhri-plus-dashboard-link.zip)

**Claude Code (terminal).** Install all four for every project:

```bash
mkdir -p ~/.claude/skills && cd ~/.claude/skills
for s in uhri-plus uhri-plus-country-brief uhri-plus-legal-grounding uhri-plus-dashboard-link; do
  curl -sLO "https://lszoszk.github.io/UnitedNations_recommendations/skills/$s.zip" && unzip -oq "$s.zip" && rm "$s.zip"
done
```

Each zip holds one folder with a `SKILL.md`, which is all a skill is.

## Try it

- "What has the UN recommended to Poland on prison conditions since 2020? Quote it with the document symbols."
- "Write me a brief on what the UPR, treaty bodies and Special Procedures have said to Greece about migrant children."
- "Which General Comment sits behind this recommendation?" (paste it)
- "Give me a dashboard link for Germany, torture, 2015–2020."

## Maintaining

Edit a `SKILL.md`, then run `sh skills/build-zips.sh` to refresh the zips that
the site serves. Descriptions in the front matter are what lets Claude choose
the right skill, so keep them specific.

UHRI+ is an independent research project built on the OHCHR Universal Human
Rights Index; it is not affiliated with OHCHR or the United Nations. Same
licence as the repository ([PolyForm Noncommercial 1.0.0](../LICENSE)).
