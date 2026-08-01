import { test, expect } from '@playwright/test';

/**
 * Regression: the scroll chevron must not sit on top of the ⋯ overflow menu.
 *
 * `.tabs-chevron` is absolutely positioned inside `#tabsWrap`, and
 * `.tabs-more-wrap` (which holds ⋯, and cannot move inside `role="tablist"`
 * without tripping axe's aria-required-children) is that same wrap's last flex
 * item. A plain `right:4px` therefore parked the chevron directly over ⋯.
 * Measured at 375px: 40 of the button's 44px covered, and elementFromPoint at
 * its centre returned `tabsChevron` — so Labels and Methodology were
 * unreachable by tap until the strip happened to be scrolled fully right,
 * which is also the only thing that hides the chevron.
 *
 * Two traps this test is shaped around, both verified:
 *  - `toBeVisible()` passes on a fully occluded button (it checks box + style,
 *    not hit-testing), so it cannot guard this. Clicking WITHOUT a preceding
 *    scroll is the assertion that actually failed before the fix.
 *  - `#tabsChevron` `toBeHidden()` also passes for a DETACHED node, so a
 *    "fix" that deleted the chevron would sail through. The geometry check
 *    below only runs when the chevron is present AND shown, and the scroll
 *    affordance is asserted separately.
 *
 * Overflow only occurs on the narrow (mobile) project; on desktop widths the
 * strip fits and the chevron stays hidden. The test asserts the right thing in
 * both worlds rather than skipping, so a layout change that introduces
 * overflow on desktop is covered too.
 */

const boxes = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const wrap = document.getElementById('tabsWrap')!;
    const tabs = document.getElementById('tabs')!;
    const more = document.getElementById('tabsMore')!;
    const chev = document.getElementById('tabsChevron');
    const shown = !!chev && getComputedStyle(chev).display !== 'none';
    const mb = more.getBoundingClientRect();
    const cb = chev?.getBoundingClientRect();
    return {
      chevronPresent: !!chev,
      chevronShown: shown,
      overflowPx: tabs.scrollWidth - tabs.clientWidth,
      classes: wrap.className,
      overlapPx: shown && cb ? Math.max(0, Math.min(mb.right, cb.right) - Math.max(mb.left, cb.left)) : 0,
      hitAtMoreCentre:
        (document.elementFromPoint((mb.left + mb.right) / 2, (mb.top + mb.bottom) / 2) as HTMLElement | null)?.id ?? 'none',
    };
  });

test('the scroll chevron never covers the ⋯ overflow button', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => !!document.getElementById('tabsMore'), null, { timeout: 10_000 });
  // updateTabsOverflow re-measures at 50ms and again at 500ms (font swap).
  await page.waitForTimeout(900);

  const atRest = await boxes(page);
  expect(atRest.chevronPresent, 'the chevron must still exist — see the header note').toBe(true);
  expect(atRest.overlapPx, `chevron overlaps ⋯ at rest (${atRest.classes})`).toBe(0);
  expect(atRest.hitAtMoreCentre, 'a tap on the centre of ⋯ must land on ⋯').toBe('tabsMore');

  // Mid-scroll is the state the old code could never recover from: the chevron
  // showed whenever the strip was not scrolled fully right.
  await page.locator('#tabs').evaluate((el) => {
    el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2);
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(250);

  const mid = await boxes(page);
  expect(mid.overlapPx, `chevron overlaps ⋯ mid-scroll (${mid.classes})`).toBe(0);
  expect(mid.hitAtMoreCentre).toBe('tabsMore');
});

test('⋯ opens its menu without scrolling the strip first', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof (globalThis as any).navigate === 'function', null, { timeout: 10_000 });
  await page.waitForTimeout(900);

  // No scroll, no force: plain actionability. This is the call that timed out
  // before the fix with "<button id=tabsChevron> intercepts pointer events".
  await page.locator('#tabsMore').click();
  await expect(page.locator('#tabsMore')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.tabs-more-pop [data-nav="methodology"]')).toBeVisible();
});

test('the chevron still works as a scroll affordance where the strip overflows', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => !!document.getElementById('tabsChevron'), null, { timeout: 10_000 });
  await page.waitForTimeout(900);

  const before = await boxes(page);
  test.skip(before.overflowPx <= 2, 'strip fits at this viewport — nothing to scroll');

  expect(before.chevronShown, 'chevron must be offered while there is strip left to scroll').toBe(true);
  const from = await page.locator('#tabs').evaluate((el) => el.scrollLeft);
  await page.locator('#tabsChevron').click();
  await page.waitForTimeout(600);   // smooth scroll
  const to = await page.locator('#tabs').evaluate((el) => el.scrollLeft);
  expect(to, 'clicking the chevron must scroll the strip right').toBeGreaterThan(from);
});
