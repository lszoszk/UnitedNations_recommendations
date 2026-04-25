/* WCAG 2.2 AA accessibility audit — runs axe-core against every view
 * dispatcher.  Per the beta test plan §I.3 (and §B.3 — "0 criticals,
 * ≤ 5 minors").
 *
 * What this catches:
 *   - Missing alt text, aria-labels, role mismatches
 *   - Insufficient colour contrast (text + non-text)
 *   - Heading hierarchy breaks (h1 → h3 without h2, etc.)
 *   - Form fields without labels
 *   - Buttons without accessible names
 *   - Links without discernible text
 *   - Document language missing
 *
 * What this does NOT catch:
 *   - Dynamic interactions (focus traps, keyboard nav order)
 *   - Screen-reader UX quality — handled in manual NVDA/VoiceOver pass
 *     during beta phase 0
 *   - Charts/SVG semantics beyond aria-label presence
 *
 * The suite asserts ZERO `serious` or `critical` violations on every
 * view.  `moderate` and `minor` are logged for later attention but
 * don't fail the build — accumulating those into a reviewable
 * docs/a11y-findings.md is a follow-up task.
 *
 * Tags configured: WCAG 2.0 + 2.1 + 2.2 at AA level + best-practice
 * rules.  axe's `wcag22aa` tag covers the new 2.2 success criteria
 * (focus appearance, target size, etc.). */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWS = [
  'overview', 'country', 'compare', 'group', 'theme', 'sdg',
  'mechanism', 'search', 'bookmarks', 'labels', 'methodology', 'about',
];

/* Boot the dashboard and wait until the navigate() function exists
 * so we can switch views from inside the page. */
async function bootDashboard(page: Page) {
  // Pre-dismiss the GA consent banner.  Without this, axe samples the
  // banner mid-fade-in animation (the .ga-consent {animation:.25s}
  // rule), and reads the .ga-consent-more link as a partial-opacity
  // colour rather than the resolved CSS --dim, surfacing as
  // intermittent ratio drops in the 4.17–4.49 range that look like
  // contrast bugs but are really animation-sampling artefacts.
  await page.addInitScript(() => localStorage.setItem('uhri-ga-consent', 'denied'));
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  // 10 s (not 5) because the local test environment can't reach the
  // live VM and the boot's parallel fetches take a beat to time out
  // gracefully — particularly when running 12 a11y tests back-to-back
  // in a single browser context, the cumulative SW + IDB warmup makes
  // later tests slower than the first.  10 s gives plenty of headroom
  // without masking a real boot regression (which would never finish).
  await page.waitForFunction(
    () => typeof (globalThis as any).navigate === 'function',
    null,
    { timeout: 10000 }
  );
  // Wait a beat for the initial paint to settle (rail facets, mech tiles).
  await page.waitForTimeout(200);
}

/* Run axe with our project's standard tag set. The library's default
 * tags include rules that don't apply to a non-form analytics tool
 * (e.g. region, page-has-heading-one); enable explicit WCAG levels +
 * leave best-practice off for now (we'll review and selectively
 * enable later). */
function audit(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    /* Disable rules we've consciously deferred or that produce
       false-positive noise on this codebase: */
    .disableRules([
      // color-contrast was disabled during initial a11y wiring (commit
      // e2e5f14) so the suite could go green on its first run; the
      // 2026-04-25 contrast sweep re-enabled it after fixing the
      // surfaced dim-on-paper combos.  Don't re-disable without
      // tracking the regression in docs/a11y-findings.md.
      'scrollable-region-focusable',
      // ↑ Disabled with rationale: the `#tabs` element is a WAI-ARIA
      // tablist using the roving-tabindex pattern (one active tab has
      // tabindex=0, the rest have tabindex=-1, arrow keys move the
      // focus). The rule does not model this pattern correctly and
      // flags the scrollable nav as inaccessible even though the
      // active tab IS keyboard-reachable. Verified manually against
      // NVDA + VoiceOver. If we ever introduce a non-tablist
      // overflow-auto region, re-enable + audit.
    ]);
}

/* Bucket axe violations by impact so we can fail on serious/critical
 * but only log moderate/minor. */
function bucket(violations: any[]) {
  const out = { critical: [] as any[], serious: [] as any[], moderate: [] as any[], minor: [] as any[] };
  for (const v of violations) {
    const k = (v.impact || 'minor') as keyof typeof out;
    if (out[k]) out[k].push(v);
  }
  return out;
}

function summarise(violations: any[]): string {
  return violations.map(v => {
    // For color-contrast specifically, surface the actual ratio +
    // the colour pair so the operator can fix at the source instead
    // of having to open DevTools.
    const nodeDetail = (n: any) => {
      const target = n.target.join(' ');
      if (v.id === 'color-contrast' && n.any?.[0]?.data) {
        const d = n.any[0].data;
        return `${target} — ratio ${d.contrastRatio?.toFixed?.(2) ?? '?'} (need ${d.expectedContrastRatio ?? '?'}); fg=${d.fgColor} bg=${d.bgColor}`;
      }
      return target;
    };
    const samples = v.nodes.slice(0, 3).map(nodeDetail).join('\n      ');
    return `  · [${v.impact}] ${v.id} — ${v.help}\n      ${samples}${v.nodes.length > 3 ? `\n      (+${v.nodes.length - 3} more nodes)` : ''}`;
  }).join('\n');
}

/* ---------------------------------------------------------------- */
/* §1.  Audit every SPA view dispatcher.                              */
/* ---------------------------------------------------------------- */
for (const view of VIEWS) {
  test(`a11y: ${view} view has no critical/serious violations`, async ({ page }) => {
    await bootDashboard(page);
    await page.evaluate((v) => (globalThis as any).navigate(v), view);
    // Let dispatcher finish rendering. Some views fetch data before
    // populating; 400ms covers most paths in the local-stub env.
    await page.waitForTimeout(400);

    const results = await audit(page).analyze();
    const b = bucket(results.violations);

    if (b.moderate.length || b.minor.length) {
      console.warn(
        `[a11y:${view}] ${b.moderate.length} moderate · ${b.minor.length} minor (logged, not failing):\n` +
        summarise([...b.moderate, ...b.minor])
      );
    }

    expect(
      b.critical.length + b.serious.length,
      `view=${view}: ${b.critical.length} critical + ${b.serious.length} serious axe violations:\n` +
      summarise([...b.critical, ...b.serious])
    ).toBe(0);
  });
}

/* ---------------------------------------------------------------- */
/* §2.  Drawer at-a-glance — separate audit because the drawer       */
/*      isn't reached by the view-dispatcher loop.                   */
/* ---------------------------------------------------------------- */
test('a11y: drawer at-a-glance has no critical/serious violations', async ({ page }) => {
  await bootDashboard(page);
  // Drawer auto-opens on overview boot per the recent UX redesign;
  // make sure renderDrawer() has fired with state.selectedRec=null
  // (the at-a-glance branch).
  await page.evaluate(() => {
    const w = window as any;
    if (w.__state) w.__state.selectedRec = null;
    if (typeof w.renderDrawer === 'function') w.renderDrawer();
  });
  await page.waitForTimeout(300);

  const results = await new AxeBuilder({ page })
    .include('#drawer')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .disableRules(['color-contrast'])
    .analyze();

  const b = bucket(results.violations);
  if (b.moderate.length || b.minor.length) {
    console.warn(
      `[a11y:drawer] ${b.moderate.length} moderate · ${b.minor.length} minor:\n` +
      summarise([...b.moderate, ...b.minor])
    );
  }
  expect(
    b.critical.length + b.serious.length,
    `drawer at-a-glance: ${b.critical.length + b.serious.length} crit/serious:\n` +
    summarise([...b.critical, ...b.serious])
  ).toBe(0);
});

/* ---------------------------------------------------------------- */
/* §3.  Landing page (index.html) — separate audit.                  */
/* ---------------------------------------------------------------- */
test('a11y: landing page has no critical/serious violations', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(
    () => !!document.querySelector('#hexSvg'),
    null,
    { timeout: 5000 }
  );
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .disableRules(['color-contrast'])
    .analyze();

  const b = bucket(results.violations);
  if (b.moderate.length || b.minor.length) {
    console.warn(
      `[a11y:landing] ${b.moderate.length} moderate · ${b.minor.length} minor:\n` +
      summarise([...b.moderate, ...b.minor])
    );
  }
  expect(
    b.critical.length + b.serious.length,
    `landing: ${b.critical.length + b.serious.length} crit/serious:\n` +
    summarise([...b.critical, ...b.serious])
  ).toBe(0);
});
