/* Visual check for topbar collision at narrow widths — runs a set of
   representative viewport widths and screenshots the topbar.  Also
   asserts that no two topbar child boxes overlap geometrically. */
import { test, expect } from '@playwright/test';

const WIDTHS = [1920, 1600, 1440, 1366, 1280, 1200, 1100, 1000];

for (const w of WIDTHS) {
  test(`topbar at ${w}px — no overlap`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto('/dashboard.html', { waitUntil: 'commit' });
    await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 5000 });
    await page.waitForTimeout(300);

    const boxes = await page.locator('.topbar > *:not([hidden])').evaluateAll(els =>
      els
        .filter(el => {
          const cs = getComputedStyle(el as HTMLElement);
          return cs.display !== 'none' && (el as HTMLElement).offsetWidth > 0;
        })
        .map(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return { tag: el.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        })
    );

    // Sort by left; adjacent boxes must not overlap horizontally.
    boxes.sort((a, b) => a.left - b.left);
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1], curr = boxes[i];
      const overlap = prev.right - curr.left;
      // Allow 1px rounding slack — anything larger is a real overlap.
      expect(overlap, `overlap at ${w}px between "${prev.tag}" (right=${prev.right}) and "${curr.tag}" (left=${curr.left})`).toBeLessThanOrEqual(1);
    }

    await page.locator('.topbar').screenshot({ path: `test-results/topbar-${w}.png` });
  });
}
