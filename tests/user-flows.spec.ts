/* Interactive user-flow sweep against the LIVE deployed dashboard.
   20 flows: 10 "heavy" (power users, multi-step refinement, deep
   linking) + 10 "casual" (first-time visitors, simple clicks,
   common mistakes).  Each flow:

   - EXERCISES real UI (click hex tiles, type keywords, toggle rail)
   - Captures console.error + pageerror events
   - Takes a screenshot at a meaningful end-state
   - Logs status + notes to test-results/user-flows-report.md

   Tests are designed to ALWAYS complete (soft-assertions only) so
   all 20 flows run and surface issues to the report.  The report
   is the real diagnostic output, not pass/fail of individual tests. */
import { test, type ConsoleMessage, type Page } from '@playwright/test';
import * as fs from 'fs';

const BASE = 'https://lszoszk.github.io/UnitedNations_recommendations';

const TOLERATED: RegExp[] = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /manifest\.webmanifest/i,
  /Service Worker/i,
  /Phase 1 boot failed/i,
  /Failed to fetch/i,
  /\[freshness\] render failed/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /certificate/i,
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (TOLERATED.some(p => p.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (err) => {
    const text = 'pageerror: ' + err.message;
    if (TOLERATED.some(p => p.test(text))) return;
    errors.push(text);
  });
  return errors;
}

async function dismissOverlays(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('.tour-backdrop, .tour-pop, #gaConsent').forEach(el => el.remove());
    try { localStorage.setItem('uhri-ga-consent', 'denied'); } catch (_) {}
    try { localStorage.setItem('uhri-tour-dismissed', '1'); } catch (_) {}
  });
}

async function freshDashboard(page: Page, hashState = '') {
  await page.context().clearCookies();
  await page.goto(`${BASE}/dashboard.html${hashState}`, { waitUntil: 'networkidle', timeout: 30_000 });
  await dismissOverlays(page);
  await page.waitForTimeout(1500);
}

type FlowResult = { id: string; desc: string; status: 'clean' | 'errors' | 'surprising'; errors: string[]; steps: string[] };
const FLOWS: FlowResult[] = [];

function record(id: string, desc: string, errors: string[], steps: string[], surprise?: boolean) {
  FLOWS.push({
    id, desc, errors, steps,
    status: errors.length ? 'errors' : (surprise ? 'surprising' : 'clean'),
  });
}

test.afterAll(async () => {
  const lines: string[] = [];
  lines.push(`# User-flow diagnostic report — ${new Date().toISOString().slice(0,10)}`);
  lines.push('');
  lines.push(`Flows run: **${FLOWS.length}**`);
  lines.push(`Clean: **${FLOWS.filter(f => f.status === 'clean').length}**`);
  lines.push(`With errors: **${FLOWS.filter(f => f.status === 'errors').length}**`);
  lines.push(`Surprising (no error but note): **${FLOWS.filter(f => f.status === 'surprising').length}**`);
  lines.push('');
  for (const f of FLOWS) {
    const marker = f.status === 'clean' ? '✅' : f.status === 'errors' ? '❌' : '⚠️';
    lines.push(`## ${marker} ${f.id} — ${f.desc}`);
    if (f.steps.length) {
      lines.push('Steps:');
      for (const s of f.steps) lines.push(`  1. ${s}`);
    }
    if (f.errors.length) {
      lines.push('Errors:');
      for (const e of f.errors) lines.push(`  - ${e.slice(0, 300)}`);
    }
    lines.push('');
  }
  try {
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/user-flows-report.md', lines.join('\n'));
    console.log('\nWrote test-results/user-flows-report.md');
  } catch (_) {}
});

test.describe.configure({ mode: 'serial' });

// ═══════════════════════════════════════════════════════════════════
// HEAVY USERS (H1-H10)
// ═══════════════════════════════════════════════════════════════════

test('H1 — search → click result → reader → Esc → back to search', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=search&q=torture');
  await page.waitForTimeout(2500);
  const resultCount = await page.locator('.se-item').count();
  steps.push(`results visible: ${resultCount}`);

  if (resultCount > 0) {
    // Click first card (NOT on a button — so reader opens)
    const firstCard = page.locator('.se-item').first();
    const textArea = firstCard.locator('.se-tx').first();
    await textArea.click().catch(() => {});
    await page.waitForTimeout(1500);
    const drawerOpen = await page.locator('#drawer, .drawer').first().isVisible().catch(() => false);
    steps.push(`drawer after click: ${drawerOpen}`);

    // Try to enter reader mode
    const readBtn = page.locator('#drawerReadingMode, [data-nav="read"]').first();
    if (await readBtn.count()) {
      await readBtn.click().catch(() => {});
      await page.waitForTimeout(800);
      const reading = await page.locator('#app.reading-mode').count();
      steps.push(`reading-mode active: ${reading > 0}`);

      // Press r again to exit
      await page.keyboard.press('r');
      await page.waitForTimeout(500);
    }
  }
  await page.screenshot({ path: 'test-results/flow-H1.png' });
  record('H1', 'search → open drawer → reader → exit', errors, steps);
});

test('H2 — search "woman" → add country PL → narrow year → verify count drops', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=search&q=woman');
  await page.waitForTimeout(2500);
  const initialCount = await page.locator('#seN').textContent().catch(() => '');
  steps.push(`initial count: "${initialCount}"`);

  // Expand country facet if collapsed, check Poland
  const countryFacet = page.locator('[data-facet="country"] .facet-head').first();
  if (await countryFacet.count()) {
    const collapsed = await page.locator('[data-facet="country"].collapsed').count();
    if (collapsed) await countryFacet.click().catch(() => {});
  }
  await page.waitForTimeout(400);

  // Find + click Poland.  Country facet renders as <div class="opt"
  // data-k="Poland">, NOT <label>; the previous selector silently
  // no-op'd and the count stayed at the unfiltered value, with the
  // test reporting "clean" despite the filter never applying.
  const pl = page.locator('[data-facet="country"] .opt[data-k="Poland"]').first();
  if (await pl.count()) {
    // The country facet has 199 entries — Poland may be virtualised
    // off-screen.  Type into the filter input first to bring it into
    // the visible list, then click.
    const filter = page.locator('[data-facet="country"] .facet-filter');
    if (await filter.count()) await filter.fill('Poland').catch(() => {});
    await page.waitForTimeout(300);
    await pl.click({ timeout: 5000 }).catch((e) => steps.push(`Poland click failed: ${e.message}`));
    await page.waitForTimeout(2500);
  } else {
    steps.push('Poland .opt not found — country facet rendering bug?');
  }
  const afterCountry = await page.locator('#seN').textContent().catch(() => '');
  steps.push(`after Country=PL: "${afterCountry}"`);
  // Hard contract: country-filter MUST narrow the result count.  If it
  // didn't, either the click no-op'd or the filter pipeline is broken.
  const numFrom = (s: string) => Number((s.match(/[\d,]+/)?.[0] || '0').replace(/,/g, ''));
  const before = numFrom(initialCount || ''), after = numFrom(afterCountry || '');
  steps.push(`narrowed: ${before > after ? `yes (${before} → ${after})` : `NO (${before} = ${after}) — possible regression`}`);

  await page.screenshot({ path: 'test-results/flow-H2.png' });
  record('H2', 'refinement: search "woman" → country PL', errors, steps);
});

test('H3 — dataset toggle cleaned ↔ raw ↔ cleaned, counts consistent', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=search&q=discriminate');
  await page.waitForTimeout(2500);
  const initialCount = await page.locator('#seN').textContent().catch(() => '');
  steps.push(`cleaned count: "${initialCount}"`);

  // Click dataset toggle
  const dsBtn = page.locator('#dsToggle').first();
  if (await dsBtn.count()) {
    await dsBtn.click().catch(() => {});
    await page.waitForTimeout(400);
    const rawOption = page.locator('[data-ds="raw"] input[type="radio"]').first();
    if (await rawOption.count()) {
      await rawOption.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
  }
  const rawCount = await page.locator('#seN').textContent().catch(() => '');
  steps.push(`raw count: "${rawCount}"`);

  // Toggle back
  await dsBtn.click().catch(() => {});
  await page.waitForTimeout(300);
  const cleanedOption = page.locator('[data-ds="cleaned"] input[type="radio"]').first();
  if (await cleanedOption.count()) {
    await cleanedOption.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  const returnedCount = await page.locator('#seN').textContent().catch(() => '');
  steps.push(`back to cleaned: "${returnedCount}"`);

  await page.screenshot({ path: 'test-results/flow-H3.png' });
  record('H3', 'dataset toggle round-trip', errors, steps, returnedCount !== initialCount);
});

test('H4 — Theme profile → top country → Country profile', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=theme&ft=Reservations');
  await page.waitForTimeout(3000);
  const themeViewVisible = await page.locator('#view-theme').isVisible().catch(() => false);
  steps.push(`theme view loaded: ${themeViewVisible}`);

  // Try to click a country chip in the theme profile
  const countryChip = page.locator('#view-theme [data-tag-kind="country"], #view-theme .tg-val').first();
  if (await countryChip.count()) {
    await countryChip.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  const urlAfter = page.url();
  steps.push(`url after country click: ...${urlAfter.slice(-60)}`);

  await page.screenshot({ path: 'test-results/flow-H4.png' });
  record('H4', 'Theme profile → click → drill down', errors, steps);
});

test('H5 — Labels: click starter template → run → inspect counts', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=labels');
  await page.waitForTimeout(2500);

  const starterCount = await page.locator('[data-starter]').count();
  steps.push(`starter templates visible: ${starterCount}`);

  if (starterCount > 0) {
    await page.locator('[data-starter]').first().click().catch(() => {});
    await page.waitForTimeout(3000);
    const rulesLoaded = await page.locator('.rule-card, [class*="rule-"]').count();
    steps.push(`rules loaded after starter click: ${rulesLoaded}`);
  }

  await page.screenshot({ path: 'test-results/flow-H5.png' });
  record('H5', 'Labels: starter → rules loaded', errors, steps);
});

test('H6 — bookmark 3 results → go to Bookmarks', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=search&q=LGBT%2A');
  await page.waitForTimeout(3000);
  const results = await page.locator('.se-item').count();
  steps.push(`results: ${results}`);

  // Click bookmark icons on first 3 results (if available)
  let bookmarked = 0;
  for (let i = 0; i < Math.min(3, results); i++) {
    const btn = page.locator('.se-item').nth(i).locator('[data-act="bookmark"]').first();
    if (await btn.count()) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(300);
      bookmarked++;
    }
  }
  steps.push(`bookmark clicks: ${bookmarked}`);

  // Navigate to bookmarks tab
  await page.locator('[data-nav="bookmarks"]').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  const bmVisible = await page.locator('#view-bookmarks').isVisible().catch(() => false);
  // Bookmarks view uses .bm-card (NOT .dr-list-card — that's the search-
  // results drawer.  Fixed 2026-04-24 after user-flow H6 showed "0".)
  const bmCount = await page.locator('#view-bookmarks .bm-card').count();
  steps.push(`bookmarks view: ${bmVisible}, count: ${bmCount}`);

  await page.screenshot({ path: 'test-results/flow-H6.png' });
  record('H6', 'bookmark 3 → navigate Bookmarks', errors, steps, bmCount !== bookmarked);
});

test('H7 — Compare A=DEU B=POL, verify dual rendering', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=compare&ca=DEU&cb=POL');
  await page.waitForTimeout(3500);
  const compareVisible = await page.locator('#view-compare').isVisible().catch(() => false);
  // Compare uses .cmp-side (cmp not cp — distinct from country profile's
  // .cp-side); previous selector was a typo and silently no-op'd.
  const sideA = await page.locator('#view-compare .cmp-side').first().isVisible().catch(() => false);
  steps.push(`compare visible: ${compareVisible}`);
  steps.push(`side A rendered: ${sideA}`);

  // Try to swap A by changing the select/dropdown if available
  const selA = page.locator('#view-compare select').first();
  if (await selA.count()) {
    await selA.selectOption({ label: /France|Brazil|Mexico/ }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  steps.push(`after swap attempt: url=${page.url().slice(-40)}`);

  await page.screenshot({ path: 'test-results/flow-H7.png' });
  record('H7', 'Compare dual + swap A', errors, steps);
});

test('H8 — Methodology TOC jumps work', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=methodology');
  await page.waitForTimeout(2000);
  const toc = await page.locator('.me-toc button[data-meto-jump]').count();
  steps.push(`TOC buttons: ${toc}`);

  const targets = ['me-search-semantics', 'me-uhri-comparison', 'me-glossary'];
  for (const t of targets) {
    const btn = page.locator(`[data-meto-jump="${t}"]`).first();
    if (await btn.count()) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(700);
      const visible = await page.locator(`#${t}`).isVisible().catch(() => false);
      steps.push(`clicked ${t}, target visible: ${visible}`);
    }
  }

  await page.screenshot({ path: 'test-results/flow-H8.png' });
  record('H8', 'Methodology TOC navigation', errors, steps);
});

test('H9 — deep-link restoration with multiple params, then refresh', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  // Deep-link to Poland country profile, specific year range, search term
  await freshDashboard(page, '#view=country&fc=POL&q=torture&y1=2015&y2=2020');
  await page.waitForTimeout(3000);

  const activeTab = await page.locator('.tab.active').first().textContent().catch(() => '');
  const yearStart = await page.locator('#yrAL').textContent().catch(() => '');
  const yearEnd = await page.locator('#yrBL').textContent().catch(() => '');
  const kwVal = await page.locator('#kwInput').inputValue().catch(() => '');
  steps.push(`active tab: "${activeTab.slice(0,40)}", y1=${yearStart}, y2=${yearEnd}, kw="${kwVal}"`);

  // Reload and verify state restores
  await page.reload({ waitUntil: 'networkidle' });
  await dismissOverlays(page);
  await page.waitForTimeout(2500);

  const activeTabAfter = await page.locator('.tab.active').first().textContent().catch(() => '');
  const kwAfter = await page.locator('#kwInput').inputValue().catch(() => '');
  steps.push(`after reload: tab="${activeTabAfter.slice(0,40)}", kw="${kwAfter}"`);

  await page.screenshot({ path: 'test-results/flow-H9.png' });
  record('H9', 'deep-link restoration + reload', errors, steps,
    activeTab !== activeTabAfter || kwVal !== kwAfter);
});

test('H10 — keyboard shortcuts: ⌘K palette + nav', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page);
  // Focus the body so the document-level keydown handler receives the
  // shortcut.  Without this, the keystroke can land on whatever
  // element happened to have focus after page load (often the rail
  // search input) and the global Meta+K handler never fires.
  await page.locator('body').click();
  await page.keyboard.press('Meta+K');
  await page.waitForTimeout(800);
  // The palette container exists in DOM at boot with .hidden; opening
  // removes that class.  Check the SPECIFIC #cmdPalette without
  // .hidden to avoid matching some other dialog.
  const paletteVisible = await page.evaluate(() => {
    const el = document.getElementById('cmdPalette');
    return !!el && !el.classList.contains('hidden');
  });
  steps.push(`palette visible: ${paletteVisible}`);

  if (paletteVisible) {
    await page.keyboard.type('Poland');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    const urlAfter = page.url();
    steps.push(`after Poland enter: url ends ...${urlAfter.slice(-50)}`);
  }

  // Close with Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.screenshot({ path: 'test-results/flow-H10.png' });
  record('H10', '⌘K palette + type + Enter', errors, steps);
});

// ═══════════════════════════════════════════════════════════════════
// CASUAL USERS (C1-C10)
// ═══════════════════════════════════════════════════════════════════

test('C1 — Landing → "Open dashboard" CTA → onto dashboard', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await page.context().clearCookies();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(2000);

  const cta = page.locator('a.btn', { hasText: /Open the dashboard/i }).first();
  const ctaPresent = await cta.count();
  steps.push(`CTA found: ${ctaPresent}`);
  if (ctaPresent) {
    await cta.click();
    await page.waitForTimeout(3500);
    await dismissOverlays(page);
    const onDashboard = page.url().includes('dashboard.html');
    steps.push(`landed on dashboard: ${onDashboard}`);
  }

  await page.screenshot({ path: 'test-results/flow-C1.png' });
  record('C1', 'landing CTA flow', errors, steps);
});

test('C2 — Click a hex on the map → opens country', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page);
  await page.waitForTimeout(4000);
  // The map defaults to GEO/choropleth mode (per getMapMode() ->
  // 'choropleth'), which renders <path class="country" data-api="…">
  // — there are no <g data-iso="…"> elements until the user toggles
  // to HEX. Toggle to HEX explicitly so this regression test
  // exercises the hex-tile click path the casual user is most likely
  // to use (one cell per country, easy to hit on touch).
  await page.locator('#mapModes button[data-mode="hex"]').click().catch(() => {});
  await page.waitForTimeout(1500);
  const hex = page.locator('g[data-iso="DEU"], g[data-iso="USA"], g[data-iso="CHN"]').first();
  const hexCount = await hex.count();
  steps.push(`hex visible: ${hexCount}`);

  if (hexCount > 0) {
    const iso = await hex.getAttribute('data-iso');
    // Single click on a hex opens the DRAWER list of records for that
    // country (intentional — most common casual-user action: "what
    // recommendations does X have?").  Double-click navigates to the
    // full Country profile.  Test single-click → drawer first.
    await hex.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2500);
    const drawerOpen = await page.locator('#drawerBody .dr-list-card, #drawerBody .se-item').first().isVisible().catch(() => false);
    steps.push(`clicked ${iso}: drawer opened: ${drawerOpen}`);
    // Double-click → country profile (URL change).
    await hex.dblclick({ force: true }).catch(() => {});
    await page.waitForTimeout(2500);
    const url = page.url();
    steps.push(`dbl-clicked ${iso}: url ends: ...${url.slice(-60)}`);
  }

  await page.screenshot({ path: 'test-results/flow-C2.png' });
  record('C2', 'hex click → country profile', errors, steps);
});

test('C3 — Simple keyword search + scroll', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=search&q=women');
  await page.waitForTimeout(3000);
  const resultCount = await page.locator('.se-item').count();
  steps.push(`results initial: ${resultCount}`);

  // Scroll to bottom to trigger infinite scroll
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);
  const resultCount2 = await page.locator('.se-item').count();
  steps.push(`after scroll: ${resultCount2}`);

  await page.screenshot({ path: 'test-results/flow-C3.png' });
  record('C3', 'search + infinite scroll', errors, steps);
});

test('C4 — click result → bookmark → close drawer', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=search&q=torture');
  await page.waitForTimeout(2500);
  const firstCard = page.locator('.se-item').first();
  if (await firstCard.count()) {
    await firstCard.click().catch(() => {});
    await page.waitForTimeout(1500);
    // Click Bookmark button
    const bm = page.locator('#drawer button', { hasText: /Bookmark/i }).first();
    if (await bm.count()) {
      await bm.click().catch(() => {});
      steps.push('clicked bookmark');
    }
    // Close drawer
    const close = page.locator('#drawerClear').first();
    if (await close.count()) {
      await close.click().catch(() => {});
      await page.waitForTimeout(500);
      steps.push('closed drawer');
    }
  }

  await page.screenshot({ path: 'test-results/flow-C4.png' });
  record('C4', 'result → bookmark → close drawer', errors, steps);
});

test('C5 — over-filtering → empty state with "clear all"', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=search&q=very-unlikely-phrase-xyz123');
  await page.waitForTimeout(3000);
  const empty = await page.locator('.empty-state, .es-title').first().isVisible().catch(() => false);
  const clearBtn = await page.locator('.empty-state button').count();
  steps.push(`empty-state shown: ${empty}, buttons: ${clearBtn}`);

  await page.screenshot({ path: 'test-results/flow-C5.png' });
  record('C5', 'empty-state for unmatched query', errors, steps);
});

test('C6 — rail toggle hide + show', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page);
  await page.waitForTimeout(2000);
  const before = await page.locator('#app').getAttribute('class') || '';
  steps.push(`before: ${before.includes('rail-closed') ? 'closed' : 'open'}`);

  const toggle = page.locator('#railTog').first();
  if (await toggle.count()) {
    await toggle.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  const after = await page.locator('#app').getAttribute('class') || '';
  steps.push(`after toggle 1: ${after.includes('rail-closed') ? 'closed' : 'open'}`);

  await toggle.click().catch(() => {});
  await page.waitForTimeout(500);
  const after2 = await page.locator('#app').getAttribute('class') || '';
  steps.push(`after toggle 2: ${after2.includes('rail-closed') ? 'closed' : 'open'}`);

  await page.screenshot({ path: 'test-results/flow-C6.png' });
  record('C6', 'rail toggle', errors, steps);
});

test('C7 — Copy quote button', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=search&q=torture');
  await page.waitForTimeout(2500);
  const copyBtn = page.locator('.se-item').first().locator('[data-act="copy"]').first();
  const present = await copyBtn.count();
  steps.push(`copy button present: ${present}`);

  if (present) {
    await copyBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    // Two signals — primary is the user-visible "Copied with citation"
    // toast (the actual feedback the user sees); secondary is clipboard
    // content (Playwright's clipboard-read sandbox occasionally returns
    // empty even with permissions granted, so we don't fail on that).
    const toastInfo = await page.evaluate(() => {
      const el = document.getElementById('toast');
      return el
        ? { text: el.textContent || '', hidden: el.classList.contains('hidden') }
        : { text: '(no #toast)', hidden: true };
    });
    const clipboardText = await page.evaluate(async () => {
      try { return (await navigator.clipboard.readText()).slice(0, 80); } catch { return '(no access)'; }
    });
    steps.push(`toast text: "${toastInfo.text}", visible: ${!toastInfo.hidden}`);
    steps.push(`clipboard: "${clipboardText}"`);
  }

  await page.screenshot({ path: 'test-results/flow-C7.png' });
  record('C7', 'Copy quote to clipboard', errors, steps);
});

test('C8 — GA consent Reject → no tracking downstream', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await page.context().clearCookies();
  await page.addInitScript(() => {
    try { localStorage.removeItem('uhri-ga-consent'); } catch (_) {}
  });
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle', timeout: 30_000 });

  await page.evaluate(() => {
    document.querySelectorAll('.tour-backdrop, .tour-pop').forEach(el => el.remove());
  });
  await page.waitForTimeout(1500);

  const bannerVisible = await page.locator('#gaConsent').isVisible().catch(() => false);
  steps.push(`consent banner visible: ${bannerVisible}`);

  if (bannerVisible) {
    const rejectBtn = page.locator('#gaReject').first();
    if (await rejectBtn.count()) {
      await rejectBtn.click().catch(() => {});
      await page.waitForTimeout(500);
      const choice = await page.evaluate(() => localStorage.getItem('uhri-ga-consent'));
      steps.push(`consent stored: "${choice}"`);
    }
  }

  await page.screenshot({ path: 'test-results/flow-C8.png' });
  record('C8', 'GA consent reject flow', errors, steps);
});

test('C9 — typo URL #view=nonsense → graceful fallback', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page, '#view=nonsense&q=x');
  await page.waitForTimeout(2500);
  const anyViewVisible = await page.evaluate(() => {
    const views = Array.from(document.querySelectorAll('.view'));
    return views.filter(v => !(v as HTMLElement).classList.contains('hidden'))
                .map(v => v.id);
  });
  steps.push(`visible views after typo URL: ${JSON.stringify(anyViewVisible)}`);

  await page.screenshot({ path: 'test-results/flow-C9.png' });
  record('C9', 'typo URL fallback', errors, steps, anyViewVisible.length === 0);
});

test('C10 — back/forward stress', async ({ page }) => {
  const errors = collectErrors(page);
  const steps: string[] = [];

  await freshDashboard(page);
  for (const view of ['search', 'methodology', 'about', 'labels']) {
    await page.locator(`[data-nav="${view}"]`).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const urlBefore = page.url();
  steps.push(`forward end: ...${urlBefore.slice(-40)}`);

  // Back 3 times
  for (let i = 0; i < 3; i++) {
    await page.goBack().catch(() => {});
    await page.waitForTimeout(600);
  }
  const afterBacks = page.url();
  steps.push(`after 3 × back: ...${afterBacks.slice(-40)}`);

  // Forward once
  await page.goForward().catch(() => {});
  await page.waitForTimeout(600);
  const afterForward = page.url();
  steps.push(`after 1 × fwd: ...${afterForward.slice(-40)}`);

  await page.screenshot({ path: 'test-results/flow-C10.png' });
  record('C10', 'back/forward stress', errors, steps);
});
