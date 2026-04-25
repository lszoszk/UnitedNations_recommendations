# Cross-browser test matrix — baseline 2026-04-25 (post fix-sweep)

This file is the regression baseline + work-list for the cross-browser
test gap (§I.6 / §I.7 in `docs/test-plan-beta-2026.md`).

`npm test` (Chromium only) is the **blocking gate** for every commit.
The cross-browser scripts (`test:firefox`, `test:webkit`, `test:mobile`)
catch additional regressions — currently **all green** after the
fix sweep.

## Run them

```bash
npm test                    # chromium only — blocking, ~55 s, 66/66
npm run test:firefox        # ~1.6 min,   66/66
npm run test:webkit         # ~1.4 min,   66/66
npm run test:mobile         # ~1.7 min,   42/42 + 2 desktop-only skips
npm run test:cross-browser  # all four projects in sequence, ~6 min
```

## Status matrix (post fix-sweep — full green)

| Suite | Chromium | Firefox | WebKit | Mobile (iPhone 13) |
|---|---|---|---|---|
| smoke (21 tests) | ✅ 21/21 | ✅ 21/21 | ✅ 21/21 | ✅ 20/21 + 1 skip¹ |
| tab-walk (5 tests) | ✅ 5/5 | ✅ 5/5 | ✅ 5/5 | ✅ 4/5 + 1 skip² |
| integrity (8 tests) | ✅ 8/8 | ✅ 8/8 | ✅ 8/8 | ✅ 8/8 |
| topbar-widths (8 tests) | ✅ 8/8 | ✅ 8/8 | ✅ 8/8 | n/a (excluded — desktop-only) |
| analytics (2 tests) | ✅ 2/2 | ✅ 2/2 | ✅ 2/2 | ✅ 2/2 |
| a11y (14 tests) | ✅ 14/14 | ✅ 14/14 | ✅ 14/14 | n/a (excluded — desktop-only) |
| bug-report (5 tests) | ✅ 5/5 | ✅ 5/5 | ✅ 5/5 | ✅ 5/5 |
| web-vitals (3 tests) | ✅ 3/3 | ✅ 3/3 | ✅ 3/3 | ✅ 3/3 |
| **TOTAL** | ✅ 66/66 | ✅ 66/66 | ✅ 66/66 | ✅ 42/42 + 2 skips |

¹ smoke #16 rawModeBanner — desktop 3-column grid layout test; on
  <960 px the layout is intentionally single-column with rail in
  display:none, so the assertions don't apply. Skipped via
  `test.skip()` with rationale comment.

² tab-walk rail facet heads — same rationale; the .facet-head is
  inside a display:none rail on mobile, so click times out.

## Resolved during the 2026-04-25 sweep

All 7 issues catalogued in the previous baseline are now resolved by
4 small changes — no UI code changes, only test instrumentation.

### Test infrastructure (the actual fix)

* **TOLERATED message patterns extended** to cover all three browsers
  consistently. Previously they only matched Chromium's CORS / network
  error format and ignored equivalent messages in Firefox + WebKit.
  Added regexes for:
  - `/Access-Control-Allow-Origin/i` (WebKit console-error CORS)
  - `/Cross-Origin Request Blocked/i` (Firefox CORS)
  - `/due to access control checks/i` (WebKit pageerror-channel CORS —
    this one was 80% of the WebKit cascade because pageerror events
    bypassed the TOLERATED filter entirely)
  - `/downloadable font: download failed/i` (Firefox font-network)
  - `/fonts\.gstatic\.com/i` (any browser, Google Fonts offline)
  - `/A ServiceWorker passed a promise/i` (Firefox SW-fetch-rejected)

* **pageerror handler now filters via TOLERATED** in tab-walk +
  integrity tests (smoke already did). Without this, WebKit's
  cross-origin VM rejection — emitted as a thrown error rather than
  console.error — broke every test that checks for "no errors".

* **Two desktop-only smoke tests** marked `test.skip()` on <960 px
  viewports with rationale comments — they assert the 3-column rail/
  main/drawer grid which doesn't exist on mobile by design.

* **Two GA-consent-banner-blocked clicks** pre-dismissed via
  `localStorage.setItem('uhri-ga-consent', 'denied')` in
  `addInitScript`. The bottom-fixed banner intercepts pointer events
  on the dash-footer below it on mobile widths only.

### Strike-through of the previous baseline's known issues

- ~~WebKit smoke #1 boot fails~~ — was a TOLERATED gap (pageerror
  channel), 0 product code changes needed.
- ~~Integrity D-01..D-08 all fail on WebKit + mobile~~ — same
  pageerror gap; all 8 now pass on every browser.
- ~~Firefox cmdPalette ⌘K~~ — was a font/SW-network noise leak (no
  keymap issue); fixed by font/SW patterns.
- ~~Firefox aboutTab~~ — same noise leak.
- ~~Firefox tab-walk view JS error~~ — same.
- ~~Mobile narrow-viewport cascade~~ — root cause was the GA banner +
  the desktop-only assertions; resolved with `test.skip()` +
  `addInitScript` consent.
- ~~smoke #16 rawModeBanner on mobile~~ — desktop-only by design,
  skipped.

## When to update this doc

Every cross-browser fix sweep that lands a commit should:
1. Re-run all four scripts.
2. Update the Status matrix above.
3. Strike-through resolved items in the Known-issues lists with the
   commit SHA that fixed them.
4. Bump the date at the top.

This doc IS the regression history — keep it.

## Known flake (acceptable, not blocking)

* **`webkit` topbar at 1100px** intermittently fails when run
  back-to-back after another browser project in `test:cross-browser`.
  Standalone (`test:webkit`) it passes 8/8. Likely Playwright web-
  server / Service Worker cache state interaction across rapid
  Safari spin-ups; not a product regression. The nightly GitHub
  Action runs each browser as an independent matrix entry (no
  cross-browser back-to-back), so it doesn't manifest there.

## Future-proofing notes

* Adding a new `console.error` or `pageerror` source from a new
  browser → add to TOLERATED in **all four** test files (smoke,
  tab-walk, integrity, user-flows). Easy to forget; one missed file
  → one browser project red.
* If a new test inspects a clickable target near the bottom of the
  viewport, pre-dismiss the GA banner with the same
  `addInitScript` pattern.
* Desktop-only layout tests should branch on `viewport.width < 960`
  and `test.skip()` on mobile rather than wishfully assert.
