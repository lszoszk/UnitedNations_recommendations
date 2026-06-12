#!/usr/bin/env node
/**
 * scripts/update-counts.mjs
 *
 * Fetches the live dataset total from the UHRI API and patches every
 * hardcoded count across all source files.  Run after each monthly
 * dataset refresh — or let .github/workflows/sync-counts.yml do it.
 *
 * USAGE
 *   node scripts/update-counts.mjs            # apply changes
 *   node scripts/update-counts.mjs --dry      # report without writing
 *   API_BASE=https://… node scripts/update-counts.mjs
 *
 * WHAT IT UPDATES
 *   • cleaned total    (e.g. 267,537) — from /api/data/facets#total_records
 *   • raw total        (e.g. 267,548) — cleaned + artefacts_dropped (sentinel)
 *   All format variants: "267,537" · "267537" · "267 548" (space-sep)
 *
 * WHAT IT LEAVES ALONE
 *   Pipeline methodology numbers (~56,000 edited, 3,294 type fixes, etc.)
 *   — those describe the pipeline logic, not the live volume, and need a
 *   human to verify they're still accurate after each major update.
 *   The artefacts_dropped count (11) in scripts/counts.json is also a
 *   pipeline constant; update it manually if Stage 5 changes.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath }                            from 'url';
import { dirname, resolve }                         from 'path';
import https                                        from 'https';
import { createGunzip }                             from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const DRY       = process.argv.includes('--dry') || process.argv.includes('--dry-run');
const API_BASE  = (process.env.API_BASE ?? 'https://150.254.115.204/uhri-api').replace(/\/$/, '');
const SENTINEL  = resolve(__dirname, 'counts.json');

// ── network ───────────────────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((ok, fail) => {
    https.get(url, { rejectUnauthorized: false }, res => {
      const chunks = [];
      const stream = res.headers['content-encoding'] === 'gzip'
        ? res.pipe(createGunzip()) : res;
      stream.on('data',  c => chunks.push(c));
      stream.on('end',   () => {
        try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { fail(new Error(`JSON parse failed for ${url}: ${e.message}`)); }
      });
      stream.on('error', fail);
    }).on('error', fail);
  });
}

// ── formatting ────────────────────────────────────────────────────────────────
const comma = n => Number(n).toLocaleString('en-US');          // 267537 → "267,537"
const plain = n => String(n);                                  // 267537 → "267537"
const spaceReg  = n => String(n).replace(/(\d)(?=(\d{3})+$)/g, '$1 ');  // "267 548"
const spaceNbsp = n => String(n).replace(/(\d)(?=(\d{3})+$)/g, '$1 '); // "267 548"
const esc  = s  => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const today = () => new Date().toISOString().slice(0, 10);

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Load sentinel ─ source of truth for current counts
  const sentinel = JSON.parse(readFileSync(SENTINEL, 'utf8'));
  const { cleaned: OLD_CLEANED, artefacts_dropped } = sentinel;
  if (!Number.isInteger(OLD_CLEANED) || !Number.isInteger(artefacts_dropped)) {
    throw new Error('counts.json must have integer "cleaned" and "artefacts_dropped" fields.');
  }
  const OLD_RAW = OLD_CLEANED + artefacts_dropped;

  // 2. Fetch live total_records from API
  console.log(`Fetching ${API_BASE}/api/data/facets …`);
  const facets = await httpsGet(`${API_BASE}/api/data/facets`);
  const NEW_CLEANED = facets.total_records;
  if (!Number.isInteger(NEW_CLEANED) || NEW_CLEANED < 100_000) {
    throw new Error(`Unexpected total_records value: ${JSON.stringify(NEW_CLEANED)}`);
  }
  const NEW_RAW = NEW_CLEANED + artefacts_dropped;
  const delta   = NEW_CLEANED - OLD_CLEANED;

  if (delta === 0 && !DRY) {
    console.log(`✓ Already current — ${comma(NEW_CLEANED)} records. Nothing to do.`);
    return;
  }

  const sign = delta >= 0 ? '+' : '';
  console.log(`Dataset: ${comma(OLD_CLEANED)} → ${comma(NEW_CLEANED)} (${sign}${delta})`);
  console.log(`Raw:     ${comma(OLD_RAW)} → ${comma(NEW_RAW)} (includes ${artefacts_dropped} dropped artefacts)`);
  if (DRY) console.log('(dry run — no files written)\n');

  // 3. Build replacement pairs  (longer/more-specific forms first to avoid
  //    partial double-replacement — e.g. patch "267,537" before "267537")
  const pairs = [
    [comma(OLD_CLEANED),     comma(NEW_CLEANED)],
    [comma(OLD_RAW),         comma(NEW_RAW)],
    [plain(OLD_CLEANED),     plain(NEW_CLEANED)],
    [plain(OLD_RAW),         plain(NEW_RAW)],
    [spaceReg(OLD_RAW),      spaceReg(NEW_RAW)],
    [spaceNbsp(OLD_RAW),     spaceNbsp(NEW_RAW)],
    // Also patch "X → Y" pipeline notation in methodology (e.g. "267,548 → 267,537")
    [`${comma(OLD_RAW)} → ${comma(OLD_CLEANED)}`, `${comma(NEW_RAW)} → ${comma(NEW_CLEANED)}`],
  ].filter(([a, b]) => a !== b);

  if (pairs.length === 0) {
    console.log('All format variants are identical — nothing to replace.');
    return;
  }

  // 4. Files to patch
  const FILES = [
    'dashboard.html',
    'index.html',
    'index2.html',
    'llms.txt',
    'manifest.webmanifest',
    'dashboard-about.js',
    'dashboard-filters.js',
    'dashboard-labels.js',
    'dashboard-methodology.js',
    'dashboard-profiles.js',
    'dashboard-reader.js',
    'dashboard-search.js',
    'dashboard-offline.js',
    'dashboard-utils.js',
    'dashboard-rail.js',
    'README.md',
  ];

  let changedFiles = 0;
  let totalSubs    = 0;

  for (const rel of FILES) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) continue;          // silently skip absent files

    const original = readFileSync(abs, 'utf8');
    let patched = original;

    for (const [from, to] of pairs) {
      patched = patched.replaceAll(from, to);
    }

    if (patched === original) continue;

    // Count how many substitutions were made
    let subs = 0;
    for (const [from] of pairs) {
      const m = original.match(new RegExp(esc(from), 'g'));
      if (m) subs += m.length;
    }

    console.log(`  ${DRY ? '[dry] ' : ''}${rel}  (${subs} substitution${subs === 1 ? '' : 's'})`);
    totalSubs    += subs;
    changedFiles += 1;

    if (!DRY) writeFileSync(abs, patched, 'utf8');
  }

  // 5. Write updated sentinel
  if (!DRY) {
    const updated = { ...sentinel, cleaned: NEW_CLEANED, raw: NEW_RAW, last_updated: today() };
    writeFileSync(SENTINEL, JSON.stringify(updated, null, 2) + '\n', 'utf8');
    console.log(`\nSentinel updated → scripts/counts.json`);
  }

  console.log(`\n${DRY ? 'Dry run complete.' : 'Done.'} ${totalSubs} substitution${totalSubs === 1 ? '' : 's'} across ${changedFiles} file${changedFiles === 1 ? '' : 's'}.`);
  if (DRY && delta !== 0) console.log('Run without --dry to apply.');
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
