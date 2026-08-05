import { test, expect } from '@playwright/test';

/**
 * Regression: the command palette must be usable without a mouse.
 *
 * Static audit I-06. Every row rendered a ↵ hint and the first rendered with
 * a `.focus` class, but nothing acted on either: `openPalette` trapped Tab
 * back onto the input and there was no Arrow handling anywhere in the module.
 * Enter did work — but through a separate document-level handler in the
 * inline spine that always ran `window.__cmdResults[0]`, so a keyboard user
 * could reach exactly one result: the first. ⌘K could be opened and typed
 * into, then only finished with a mouse.
 *
 * The fix moved Enter into the palette's own handler (the one that knows
 * which row is selected) and deleted the spine branch — keeping both would
 * have fired the action twice, because keydown bubbles from the input up to
 * document. That double-fire is what this file's third test pins.
 */

test('arrow keys move the selection and Enter runs the selected row', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof (globalThis as any).openPalette === 'function', null, { timeout: 10_000 });

  await page.keyboard.press('Meta+K');
  await expect(page.locator('#cmdPalette')).not.toHaveClass(/hidden/);
  await page.keyboard.type('methodology');

  const rows = page.locator('#cmdResults .cmd-result');
  await expect(rows).toHaveCount(2, { timeout: 3000 });

  // Renderer's own starting state, now also announced to assistive tech.
  await expect(rows.nth(0)).toHaveClass(/focus/);
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#cmdInput')).toHaveAttribute('aria-activedescendant', 'cmd-result-0');

  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1), 'ArrowDown must move the selection').toHaveClass(/focus/);
  await expect(rows.nth(0)).not.toHaveClass(/focus/);
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#cmdInput')).toHaveAttribute('aria-activedescendant', 'cmd-result-1');

  // Wrap-around in both directions, so the list is navigable end to end.
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(0), 'ArrowDown past the end wraps to the top').toHaveClass(/focus/);
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(1), 'ArrowUp past the top wraps to the bottom').toHaveClass(/focus/);

  // Enter runs the SELECTED row — the second one, the Methodology view.
  // Before the fix this ran result [0] (the full-text search action) instead.
  await page.keyboard.press('Enter');
  await expect(page.locator('#cmdPalette')).toHaveClass(/hidden/, { timeout: 3000 });
  await expect(page.locator('#view-methodology')).toBeVisible({ timeout: 3000 });
});

test('Enter on a freshly typed query still runs the first row', async ({ page }) => {
  // The pre-existing behaviour, which the fix must not take away.
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof (globalThis as any).openPalette === 'function', null, { timeout: 10_000 });

  await page.keyboard.press('Meta+K');
  await page.keyboard.type('methodology');
  await expect(page.locator('#cmdResults .cmd-result')).toHaveCount(2, { timeout: 3000 });
  await expect(page.locator('#cmdResults .cmd-result').nth(0).locator('.kind')).toHaveText('SEARCH');

  await page.keyboard.press('Enter');
  await expect(page.locator('#cmdPalette')).toHaveClass(/hidden/, { timeout: 3000 });
  // Result [0] is the full-text search action, so we land on the search view.
  await expect(page.locator('#view-search')).toBeVisible({ timeout: 3000 });
});

test('Enter fires the action exactly once', async ({ page }) => {
  await page.goto('/dashboard.html');
  await page.waitForFunction(() => typeof (globalThis as any).openPalette === 'function', null, { timeout: 10_000 });

  await page.keyboard.press('Meta+K');
  await page.keyboard.type('methodology');
  await expect(page.locator('#cmdResults .cmd-result')).toHaveCount(2, { timeout: 3000 });

  // Count invocations by wrapping every action currently on offer. Two live
  // Enter handlers — the palette's and the spine's — would show up as 2.
  const calls = await page.evaluate(async () => {
    const w = window as any;
    let n = 0;
    w.__cmdResults.forEach((r: any) => {
      const orig = r.action;
      r.action = (...a: unknown[]) => { n += 1; return orig.apply(r, a); };
    });
    // Re-attach nothing: the handlers read __cmdResults / the DOM live.
    document.getElementById('cmdInput')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 300));
    return n;
  });

  expect(calls, 'a duplicate handler would run the action twice').toBe(1);
});
