import { test, expect } from '@playwright/test';

/**
 * The keyword hint ("Plain words match all… examples ▾") is shown only while the
 * keyword box has focus. Safari does not focus a link on click, so pressing the
 * mouse on "examples" blurred the box, hid the hint, and the click hit nothing:
 * the examples never opened in Safari. The webkit project is the one that
 * reproduces it; the clicks below are real mouse events, not el.click().
 */
test('the keyword examples open and close with the mouse', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('uhri-ga-consent', 'denied'); } catch (_) {} });
  await page.route(/\/api\/data\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }));
  await page.goto('/dashboard.html#view=search');
  // On a phone the filter rail is off-canvas behind the menu button.
  const menu = page.locator('.mobile-menu-btn');
  if (await menu.isVisible()) await menu.click();
  await page.locator('.facet[data-facet="kw"] .facet-head').click();
  await page.locator('#kwInput').click();

  const more = page.locator('#kwHintMore');
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('#kwExamples')).toBeVisible();
  await expect(more).toHaveText(/hide examples/);

  // Focus leaves the box (here: a click on the open examples). The way to close
  // them must not disappear with it.
  await page.locator('#kwExamples').click({ position: { x: 5, y: 5 } });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('#kwExamples')).toBeHidden();
  await expect(more).toHaveText(/examples ▾/);
});
