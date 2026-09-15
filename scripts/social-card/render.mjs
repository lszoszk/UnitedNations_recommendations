// Renders card.html to ../../social-card.png at 1200x627. Needs the repo's Playwright install.
import { chromium } from 'playwright';
const dir = new URL('.', import.meta.url).pathname;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 627 }, deviceScaleFactor: 1 });
await p.goto('file://' + dir + 'card.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
await p.screenshot({ path: dir + '../../social-card.png', type: 'png', clip: { x: 0, y: 0, width: 1200, height: 627 } });
const fonts = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
console.log('fonts loaded:', [...new Set(fonts)].join(', ') || 'NONE (fallbacks used)'); await b.close();
