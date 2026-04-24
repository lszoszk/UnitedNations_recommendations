#!/usr/bin/env node
/* Live 20-query comparison helper for lszoszk dashboard vs official OHCHR UHRI.
 *
 * Uses Playwright's request client only (no browser launch), which works
 * reliably against OHCHR when plain curl does not. Writes machine-readable
 * outputs under /tmp so we can inspect partial progress while it runs.
 *
 * USAGE
 *   node uhri-query.mjs <query>      # one query only
 *   node uhri-query.mjs --all        # full 20-query battery
 */
import { request } from 'playwright';
import fs from 'fs';

const MY_API = 'https://150.254.115.204/uhri-api/api/data/records';
const UHRI_API = 'https://dataex.ohchr.org/uhri/api/search?culture=en';
const UHRI_FE = 'a40ca594-5e5b-498a-9a1a-3eb43fa46db5';

const QUERIES = [
  { group: 'single', query: 'torture' },
  { group: 'single', query: 'judiciary' },
  { group: 'single', query: 'disability' },
  { group: 'single', query: 'migrant' },
  { group: 'single', query: 'climate' },
  { group: 'plural', query: 'woman', note: 'dashboard expands singular/plural' },
  { group: 'plural', query: 'child', note: 'dashboard expands child/children' },
  { group: 'plural', query: 'people', note: 'dashboard expands people/person' },
  { group: 'stem', query: 'discriminate', note: 'dashboard uses Porter stemming' },
  { group: 'stem', query: 'detained', note: 'dashboard uses Porter stemming' },
  { group: 'wildcard', query: 'bias*', note: 'dashboard supports trailing-* wildcard' },
  { group: 'wildcard', query: 'democra*', note: 'dashboard supports trailing-* wildcard' },
  { group: 'phrase', query: 'gender equality' },
  { group: 'phrase', query: 'sexual orientation' },
  { group: 'phrase', query: 'rule of law' },
  { group: 'boolean', query: 'bias AND technology', note: 'dashboard supports boolean operators' },
  { group: 'boolean', query: 'judicial NOT independence', note: 'dashboard supports boolean operators' },
  { group: 'unicode', query: 'Türkiye' },
  { group: 'acronym', query: 'LGBTQ' },
  { group: 'rare', query: 'cyberbullying' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryDashboard(ctx, q) {
  try {
    const r = await ctx.get(MY_API, {
      params: { text_query: q, page_size: 1 },
      timeout: 30_000,
    });
    if (!r.ok()) return `HTTP ${r.status()}`;
    const json = await r.json();
    return String(json?.total_records ?? '?');
  } catch (err) {
    return 'ERR:' + String(err?.message || err).slice(0, 60);
  }
}

async function queryOfficialUhri(ctx, q, attempts = 3) {
  let last = 'ERR';
  for (let a = 1; a <= attempts; a++) {
    try {
      const r = await ctx.post(UHRI_API, {
        data: {
          affectedPersons: [],
          countries: [],
          displayLastCycleOfMechanism: false,
          displayOnlyDocumentsToDownload: false,
          displayOnlyObservations: false,
          displayOnlyRecommendations: false,
          documentCodes: [],
          documentTypes: [],
          fromDate: null,
          mechanisms: [],
          regions: [],
          sdgs: [],
          searchText: q,
          themes: [],
          toDate: null,
          uprCycles: [],
          uprPositions: [],
          uprRegions: [],
          uprSessions: [],
          uprStates: [],
        },
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://uhri.ohchr.org',
          'Referer': 'https://uhri.ohchr.org/',
          'x-uhri-api-fe': UHRI_FE,
        },
        timeout: 30_000,
      });
      if (!r.ok()) {
        last = `HTTP ${r.status()}`;
      } else {
        const json = await r.json();
        return String(json?.countResult?.countRecommendations ?? '?');
      }
    } catch (err) {
      last = 'ERR:' + String(err?.message || err).slice(0, 60);
    }
    if (a < attempts) await sleep(a === 1 ? 6_000 : 12_000);
  }
  return last;
}

function calcDelta(mine, uhri) {
  if (!/^\d+$/.test(mine) || !/^\d+$/.test(uhri)) {
    return { delta: '', pct: '' };
  }
  const m = Number(mine);
  const u = Number(uhri);
  const delta = m - u;
  const pct = u === 0 ? '' : ((delta / u) * 100).toFixed(2);
  return { delta: String(delta), pct };
}

function writeOutputs(rows) {
  const tsv = rows.map(r => [r.group, r.query, r.mine, r.uhri, r.delta, r.pct, r.note || ''].join('\t')).join('\n') + '\n';
  fs.writeFileSync('/tmp/uhri-live-compare.tsv', tsv);

  const csvLines = ['group,query,dashboard,uhri,delta,delta_pct,note'];
  for (const row of rows) {
    const cols = [row.group, row.query, row.mine, row.uhri, row.delta, row.pct, row.note || '']
      .map(v => /[",\n\t]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    csvLines.push(cols.join(','));
  }
  fs.writeFileSync('/tmp/uhri-live-compare.csv', csvLines.join('\n') + '\n');

  const mdLines = [
    '| Group | Query | Dashboard | UHRI | Δ | Δ% | Note |',
    '|---|---|---:|---:|---:|---:|---|',
    ...rows.map(r => `| ${r.group} | \`${r.query}\` | ${r.mine} | ${r.uhri} | ${r.delta || '—'} | ${r.pct ? `${r.pct}%` : '—'} | ${r.note || ''} |`)
  ];
  fs.writeFileSync('/tmp/uhri-live-compare.md', mdLines.join('\n') + '\n');
}

async function runOne(ctx, item) {
  const mine = await queryDashboard(ctx, item.query);
  await sleep(800);
  const uhri = await queryOfficialUhri(ctx, item.query);
  const { delta, pct } = calcDelta(mine, uhri);
  const row = { ...item, mine, uhri, delta, pct };
  console.log(`${item.group.padEnd(8)}\t${item.query}\tmine=${mine}\tuhri=${uhri}\t${delta ? `delta=${delta} (${pct}%)` : 'delta=—'}`);
  return row;
}

async function main() {
  const arg = process.argv[2];
  const items = arg === '--all'
    ? QUERIES
    : QUERIES.filter(q => q.query === arg);

  if (!items.length) {
    console.error('usage: node uhri-query.mjs <query> | --all');
    process.exit(2);
  }

  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  const rows = [];
  try {
    for (const item of items) {
      const row = await runOne(ctx, item);
      rows.push(row);
      writeOutputs(rows);
      if (items.length > 1) await sleep(8_000);
    }
  } finally {
    await ctx.dispose();
  }
}

await main();
