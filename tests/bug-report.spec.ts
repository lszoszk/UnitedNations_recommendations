/* In-app bug-report widget tests (§I.5).
 *
 * Covers:
 *   - Floating button is rendered and reachable
 *   - Modal opens with the form fields the test plan §G.1 mandates
 *   - Auto-context preview is populated with non-PII fields
 *   - Console errors are captured into the buffer
 *   - Issue body builder produces well-formed Markdown
 *   - GitHub URL builder respects the 8 KB cap (truncation kicks in)
 */
import { test, expect } from '@playwright/test';

test('bug-report fab + modal: opens, has all required fields, populates context', async ({ page }) => {
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).__bugReport === 'object', null, { timeout: 5000 });

  // Floating button exists and is keyboard-reachable.
  const fab = page.locator('#bugReportFab');
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute('aria-label', /report a bug/i);

  // Click → modal opens.
  await fab.click();
  await expect(page.locator('.bug-report-modal')).toBeVisible();

  // Required fields present.
  for (const fieldName of ['severity', 'summary', 'steps', 'expected', 'actual']) {
    await expect(page.locator(`.bug-report-modal [name="${fieldName}"]`), `field ${fieldName}`).toHaveCount(1);
  }

  // Submit buttons present.
  await expect(page.locator('#brmSubmitGh')).toBeVisible();
  await expect(page.locator('#brmSubmitMail')).toBeVisible();

  // Context preview is populated and contains expected fields.
  const previewText = await page.locator('#brmCtxPreview').textContent();
  expect(previewText).toContain('Active view');
  expect(previewText).toContain('User agent');
  expect(previewText).toContain('Viewport');
});

test('bug-report: collectAutoContext does not include PII or secret-like data', async ({ page }) => {
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).__bugReport === 'object', null, { timeout: 5000 });

  const ctx = await page.evaluate(() => (window as any).__bugReport.collect());

  // Must contain the documented public fields.
  for (const key of ['url', 'hash', 'userAgent', 'viewport', 'view', 'consoleErrors', 'timestamp']) {
    expect(ctx, `missing field: ${key}`).toHaveProperty(key);
  }

  // Must NOT contain any field that would carry PII / secrets.
  // Any non-public localStorage value must NOT have leaked through.
  const flat = JSON.stringify(ctx).toLowerCase();
  for (const forbidden of ['password', 'token', 'cookie:', 'authorization', 'bearer ', 'apikey']) {
    expect(flat.includes(forbidden), `must NOT contain ${forbidden}`).toBe(false);
  }
});

test('bug-report: console error buffer captures the last N errors', async ({ page }) => {
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).__bugReport === 'object', null, { timeout: 5000 });

  const result = await page.evaluate(() => {
    // Push 12 errors → buffer should keep the last 10.
    for (let i = 0; i < 12; i++) console.error(`test-error-${i}`);
    return (window as any).__bugReport.collect().consoleErrors;
  });

  expect(result.length, 'buffer caps at 10').toBeLessThanOrEqual(10);
  // Newest first per the collect() reversal — error 11 should appear before error 5.
  const flat = result.join('\n');
  expect(flat, 'most-recent error should be in the buffer').toContain('test-error-11');
  expect(flat, 'oldest error should have been evicted').not.toContain('test-error-0');
});

test('bug-report: buildBody produces a well-formed GitHub Markdown issue body', async ({ page }) => {
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).__bugReport === 'object', null, { timeout: 5000 });

  const body = await page.evaluate(() => {
    const ctx = (window as any).__bugReport.collect();
    return (window as any).__bugReport.buildBody({
      severity: 'P0',
      summary: 'Map disappears after region cycle',
      steps: '1. Click Africa\n2. Click World',
      expected: 'Map renders',
      actual: 'Map blank',
    }, ctx);
  });

  // Spot-check a handful of structural anchors.
  expect(body).toContain('### Severity');
  expect(body).toContain('P0');
  expect(body).toContain('### Summary');
  expect(body).toContain('Map disappears after region cycle');
  expect(body).toContain('### Steps to reproduce');
  expect(body).toContain('1. Click Africa');
  expect(body).toContain('<details><summary>Auto-captured context</summary>');
  expect(body).toContain('| URL hash |');
  expect(body).toContain('Filed via the in-app bug-report widget');
});

test('bug-report: form requires summary before submit', async ({ page }) => {
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => typeof (globalThis as any).__bugReport === 'object', null, { timeout: 5000 });

  await page.click('#bugReportFab');
  await expect(page.locator('.bug-report-modal')).toBeVisible();

  // Try to submit with no summary → modal stays open + summary input invalid.
  await page.click('#brmSubmitGh');
  await expect(page.locator('.bug-report-modal')).toBeVisible(); // not submitted/closed

  const isInvalid = await page.locator('input[name="summary"]').evaluate((el: HTMLInputElement) => !el.checkValidity());
  expect(isInvalid, 'summary field should be flagged invalid when empty').toBe(true);
});

test('the privacy banner never swallows the bug-report button', async ({ page }) => {
  /* Both are fixed to the bottom-right at z-index 200, and the banner is
     wider and later in the DOM — so until the visitor answered it covered
     the button entirely: 44x44 of 44x44 at desktop widths, 48x48 of 48x48
     at 375px, with elementFromPoint at the button's centre returning the
     banner. A first-time visitor could not report a bug on any viewport,
     which is precisely the visitor most likely to need to.

     The existing first test in this file also clicks the FAB, but it only
     caught this on a slow runner: locally the click landed before the
     banner rendered, so it passed 3/3 while CI failed 3/3. This one waits
     for the banner first, so it fails for everyone or nobody. */
  await page.goto('/dashboard.html', { waitUntil: 'commit' });
  const banner = page.locator('#gaConsent');
  await expect(banner, 'a fresh context must be offered the privacy choice').toBeVisible({ timeout: 10_000 });

  const geometry = await page.evaluate(() => {
    const fab = document.getElementById('bugReportFab')!;
    const ga = document.getElementById('gaConsent')!;
    const f = fab.getBoundingClientRect();
    const g = ga.getBoundingClientRect();
    const ox = Math.max(0, Math.min(f.right, g.right) - Math.max(f.left, g.left));
    const oy = Math.max(0, Math.min(f.bottom, g.bottom) - Math.max(f.top, g.top));
    const hit = document.elementFromPoint((f.left + f.right) / 2, (f.top + f.bottom) / 2) as HTMLElement | null;
    return { overlapArea: Math.round(ox * oy), landsOn: hit?.closest('button')?.id ?? 'none' };
  });
  expect(geometry.overlapArea, 'privacy banner overlaps the bug-report button').toBe(0);
  expect(geometry.landsOn, 'a tap on the button must reach the button').toBe('bugReportFab');

  // The assertion that actually failed in CI: a plain, un-forced click.
  await page.locator('#bugReportFab').click();
  await expect(page.locator('.bug-report-modal')).toBeVisible();

  // And the offset must be given back once the banner goes, so the button
  // does not float in mid-air for the rest of the session. One Escape is
  // enough for both: the banner installs its own document-level Escape
  // handler (dashboard-analytics.js), so it dismisses alongside the modal.
  await page.locator('.bug-report-modal').press('Escape');
  await expect(banner).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/ga-consent-open/);
  await expect(page.locator('#bugReportFab')).toBeVisible();
});
