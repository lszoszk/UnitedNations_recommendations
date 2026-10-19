import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Support section (landing FIG 06 + About → Support this project): copy the
 * citation / BibTeX, report a problem, tell us how you use it.
 *
 * The citation must carry the current dataset version from scripts/counts.json;
 * update-counts.mjs rewrites it, and this test catches a copy it missed.
 * Clipboard writes are recorded by a stub so every engine can run the test.
 */
const VERSION = JSON.parse(readFileSync('scripts/counts.json', 'utf8')).version as string;

async function recordClipboard(page: Page) {
  await page.addInitScript(() => {
    (window as any).__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => { (window as any).__copied.push(t); return Promise.resolve(); } },
    });
    try { localStorage.setItem('uhri-ga-consent', 'denied'); localStorage.setItem('who-v1:uhri-plus', 'test'); } catch (_) {}
  });
  await page.route(/\/api\/data\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }));
}
const copied = (page: Page) => page.evaluate(() => (window as any).__copied as string[]);

test('landing: the Help nav item leads to the support section', async ({ page }) => {
  await recordClipboard(page);
  await page.goto('/index.html');
  await page.locator('#sectionNav [data-to="#support"]').click();
  await expect(page.locator('#support .how-card')).toHaveCount(3);
  await expect(page.locator('#support')).toBeInViewport();
});

test('landing: citation and BibTeX copy with the current dataset version', async ({ page }) => {
  await recordClipboard(page);
  await page.goto('/index.html#support');
  await page.locator('#support [data-copy="supportCite"]').click();
  await page.locator('#support [data-copy="supportBib"]').click();
  const [cite, bib] = await copied(page);
  expect(cite).toContain('https://doi.org/10.5281/zenodo.21319464');
  expect(cite).toContain(VERSION);
  expect(bib).toMatch(/^@software\{/);
  expect(bib).toContain(`version   = {${VERSION}}`);
  await expect(page.locator('#support [data-copy="supportCite"]')).toHaveText('Copied');
});

test('landing: report and tell-us open prefilled emails, the latter asking for consent', async ({ page }) => {
  await recordClipboard(page);
  await page.goto('/index.html#support');
  const report = decodeURIComponent(await page.locator('#support a', { hasText: 'Email a report' }).getAttribute('href') || '');
  const tell = decodeURIComponent(await page.locator('#support a', { hasText: 'Write two lines' }).getAttribute('href') || '');
  expect(report).toMatch(/^mailto:l\.szoszkiewicz@amu\.edu\.pl\?subject=UHRI\+ problem report&body=/);
  expect(tell).toContain('subject=How I use UHRI+');
  expect(tell).toContain('May we mention it');
});

test('About: support section copies the citation and opens the bug-report form', async ({ page }) => {
  await recordClipboard(page);
  await page.goto('/dashboard.html#view=about');
  const sec = page.locator('#ab-support');
  await expect(sec).toBeVisible({ timeout: 15_000 });
  await sec.locator('[data-ab-copy="abBibtex"]').click();
  await sec.locator('[data-ab-copy="abCiteText"]').click();
  const [bib, cite] = await copied(page);
  expect(bib).toContain(`version   = {${VERSION}}`);
  expect(cite).toMatch(/^Szoszkiewicz, Ł\. \(2026\)\. UHRI\+/);
  await sec.locator('[data-ab-report]').click();
  await expect(page.locator('#bugReportTitle')).toBeVisible();
});
