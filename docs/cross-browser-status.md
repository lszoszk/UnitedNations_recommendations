# Cross-browser test matrix — baseline 2026-04-25

This file is the regression baseline + work-list for the cross-browser
test gap (§I.6 / §I.7 in `docs/test-plan-beta-2026.md`).

`npm test` (Chromium only) is the **blocking gate** for every commit.
The cross-browser scripts (`test:firefox`, `test:webkit`, `test:mobile`)
surface the additional regressions documented below; resolving those
is **scoped as Phase-0 follow-up work, NOT a `npm test` blocker**.

## Run them

```bash
npm test                    # chromium only — blocking, ~55 s, 58/58
npm run test:firefox        # ~1.5 min,  55/58 passing
npm run test:webkit         # ~2.0 min,  28/58 passing
npm run test:mobile         # ~3.1 min,  26/58 passing
npm run test:cross-browser  # all four projects in sequence
```

## Status matrix (as of 2026-04-25)

| Suite | Chromium | Firefox | WebKit | Mobile (iPhone 13) |
|---|---|---|---|---|
| smoke (21 tests) | ✅ 21/21 | ⚠ 20/21 | ❌ 7/21 | ❌ 7/21 |
| tab-walk (5 tests) | ✅ 5/5 | ⚠ 4/5 | ❌ 0/5 | ❌ 0/5 |
| integrity (8 tests) | ✅ 8/8 | ✅ 8/8 | ❌ 0/8 | ❌ 0/8 |
| topbar-widths (8 tests) | ✅ 8/8 | ✅ 8/8 | ✅ 8/8 | n/a (desktop only) |
| analytics (2 tests) | ✅ 2/2 | ✅ 2/2 | ✅ 2/2 | ✅ 2/2 |
| a11y (14 tests) | ✅ 14/14 | ✅ 14/14 | ✅ 13/14 | n/a (desktop only) |
| **TOTAL** | ✅ 58/58 | ⚠ 55/58 | ❌ 28/58 | ❌ 26/58 |

(Approximate; numbers refresh on every fresh run.)

## Known issues by browser

### Firefox (3 fails)

- **smoke #10 cmdPalette ⌘K** — keyboard event for ⌘ behaves differently
  in Firefox; the smoke test sends `Meta+K` which Chromium handles but
  Firefox prefers `Control+K` on non-Mac hosts. _Mitigation in test:
  send both modifiers, or add a Firefox-specific branch._
- **smoke #21 aboutTab** — copy/markup mismatch on the About view that
  doesn't reproduce on Chromium. Specific text/layout assertion needs
  rechecking. _Investigate before beta._
- **tab-walk** — at least one view emits a console error in Firefox that
  Chromium doesn't. Likely a missing-API guard. _Run with --headed to
  capture which view._

### WebKit (~30 fails)

- **smoke #1 boot fails** — basic boot test can't get past the readiness
  wait on WebKit. Not a "look-and-feel" issue; suggests something
  fundamental like an early-script hang or a feature-detect that
  regresses on Safari. **Highest priority** to investigate before beta.
- **integrity D-01..D-08 all fail** — `_pushUrlState` round-trip
  doesn't work on WebKit. Likely a `history.replaceState` quirk OR a
  difference in URL hash handling that breaks the test fixture's
  expectations. Worth investigating because it would mean Safari
  users can't share/bookmark deep-links — a primary heavy-user
  workflow (test-plan §F.1 M-01).
- **smoke + tab-walk widespread** — likely cascade from #1 (boot
  doesn't complete → most tests fail).

### Mobile chromium @ iPhone 13 viewport (~30 fails)

- Same 8 integrity failures as WebKit suggest the integrity tests
  have a hidden assumption about page width or a mobile-CSS rule
  that changes element visibility.
- Smoke + tab-walk failures likely from the narrow viewport breaking
  layout assertions (the dashboard's mobile breakpoint kicks in
  below 960 px; iPhone 13 is 390 × 844 ≪ that).

## Triage priority before beta

1. **WebKit smoke #1 boot** — if Safari users can't even load the
   dashboard, that's a hard P0.
2. **Integrity tests on WebKit + mobile** — heavy-user reproducibility
   workflow (M-01) depends on this round-tripping.
3. **Firefox smoke #10/#21 + tab-walk** — small fixes, polish.

## When to update this doc

Every cross-browser fix sweep that lands a commit should:
1. Re-run all four scripts.
2. Update the Status matrix above.
3. Strike-through resolved items in the Known-issues lists with the
   commit SHA that fixed them.
4. Bump the date at the top.

This doc IS the regression history — keep it.
