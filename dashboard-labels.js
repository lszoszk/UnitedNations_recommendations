/* UHRI Dashboard — Labels workspace (boolean FTS5 rule builder)
 *
 * Extracted from dashboard.html inline script as part of the seam split.
 * Self-contained except for a few documented lazy dependencies.
 *
 * LOAD ORDER
 *   This script runs AFTER dashboard-{helpers,data,route,offline,utils}.js
 *   but BEFORE the inline <script> in dashboard.html. Every external reference
 *   here is resolved in one of three ways:
 *
 *   (a) From helpers.js / data.js — available at top-level evaluation time:
 *         $, $$, fmt                              (helpers)
 *         _hasSdgFilters, _recordMatchesSdgFilters (helpers)
 *         state, api, _railIsEmpty                 (data)
 *         offline                                  (offline)
 *
 *   (b) From inline <script> — called only from function bodies triggered
 *       by user interaction, so lazy lookup resolves fine:
 *         toast()
 *
 *   (c) Exported back into the inline side — `navigate('labels')` calls
 *       renderRules(). Because renderRules is a `function` declaration it
 *       attaches to the global object and survives the inline → module
 *       directional call.
 *
 * WHY THIS LIVES IN ITS OWN MODULE
 *   ~1268 lines of self-contained UI + state + server integration that was
 *   cluttering the main dashboard inline script. Labels is an experimental
 *   (β) feature — isolating it means changes here don't force a full parse
 *   of dashboard.html, and future work (e.g. migrating to ES modules) has
 *   a smaller blast radius.
 *
 * EXTERNAL SURFACE (what dashboard.html inline reaches into)
 *   renderRules()           — render the whole Labels view (navigate hook)
 *   (everything else is internal — called only from this file)
 */

/* =========================================================================
   VIEW: 🧪 LABELS — boolean rule builder
   =========================================================================
   Each label is a boolean FTS5 query compiled from three term lists
   (MUST / AND / NOT) or a raw-FTS5 escape hatch. Evaluation runs
   server-side via /api/data/records — same code path as the Search
   tab. A retained TF-IDF math helper (labComputeTfIdf etc. further
   down) powers the ⚡ Suggest-terms modal which proposes candidate
   terms from a small user-tagged sample. Design notes:
   pipeline/labels-rebuild/DESIGN.md

   LABELS_KEY / LABELS_ACTIVE_KEY — legacy v1 localStorage keys, kept
   only so the migration helper can detect and convert old classifier
   sets. Never written to by current code.
   LABELS_STOPWORDS — shared stopword list for the TF-IDF tokenizer. */
const LABELS_KEY = 'uhri_v2_label_sets_v1';
const LABELS_ACTIVE_KEY = 'uhri_v2_label_active_v1';
const LABELS_STOPWORDS = new Set(('a about above after again against all am an and any are aren as at be because been before being below between both but by can cannot could couldn did didn do does doesn doing don down during each few for from further had hadn has hasn have haven having he her here hers herself him himself his how i if in into is isn it its itself just ll me more most mustn my myself no nor not now of off on once only or other our ours ourselves out over own re s same shan she should shouldn so some such t than that the their theirs them themselves then there these they this those through to too under until up ve very was wasn we were weren what when where which while who whom why will with won would wouldn y you your yours yourself yourselves recommendation recommend observations observation state states party parties country countries committee council working group special rapporteur human rights take steps measures ensure provide promote respect guarantee').split(/\s+/));

const RULES_KEY        = 'uhri_v2_rule_sets_v2';
const RULES_ACTIVE_KEY = 'uhri_v2_rule_active_v2';
const RULES_MIGRATED_KEY = 'uhri_v2_rules_migration_v2';  // 'done' | 'skipped'
const RULES_SCHEMA_VERSION = 2;

if (!state.rules) {
  state.rules = {
    active: null,            // active RuleSet id (string) or null
    rules: [],               // [{id, name, must[], also[], not[], rawQuery?, notes?, seedExamples?}]
    counts: {},              // ruleId → integer (last-known count, cached between renders)
    _countInflight: {},      // ruleId → abortController (debounced count fetches)
    _sampleCache: null,      // candidate pool for ⚡ Suggest-terms modal
    _suggestOpen: null,      // ruleId whose suggester is open, or null
    _peekOpen: {},           // ruleId → bool (which rule cards are showing peek-5)
    _migration: null,        // 'pending' | 'done' | 'skipped' | 'none'
  };
}

/* ------------- Rule compilation — FTS5 emitter -------------
   Emits exactly the shape the backend's search endpoint accepts
   (plain FTS5 with AND / OR / NOT / parens). Order matters: positive
   groups AND-ed, then optional NOT appended. Empty rule → empty
   string (caller should treat as "no query, skip"). */
function compileRule(r) {
  if (!r) return '';
  if (r.rawQuery && r.rawQuery.trim()) return r.rawQuery.trim();
  const clean = (arr) => (arr || [])
    .map(s => String(s || '').trim())
    .filter(Boolean);
  const wrap = (arr) => arr.length === 1 ? arr[0] : '(' + arr.join(' OR ') + ')';
  const must = clean(r.must);
  const also = clean(r.also);
  const no   = clean(r.not);
  const parts = [];
  if (must.length) parts.push(wrap(must));
  if (also.length) parts.push(wrap(also));
  const positive = parts.join(' AND ');
  if (!positive) return '';
  return no.length ? `${positive} NOT ${wrap(no)}` : positive;
}

/* ------------- Rule validation — cheap client-side checks -------------
   Catches unbalanced parens and trailing operators before hitting the
   API (backend returns opaque HTTP errors on malformed FTS5). Returns
   { ok: bool, error?: string }. Permissive — doesn't try to fully
   parse FTS5 grammar, just guards against the top-3 foot-guns. */
function validateRule(r) {
  const q = compileRule(r);
  if (!q) return { ok: true, empty: true };                // empty = unbooked, not invalid
  // Balanced parens
  let depth = 0;
  for (const ch of q) {
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth < 0) return { ok: false, error: 'Unbalanced parentheses' }; }
  }
  if (depth !== 0) return { ok: false, error: 'Unbalanced parentheses' };
  // No trailing operator
  if (/\b(AND|OR|NOT)\s*$/.test(q)) return { ok: false, error: 'Query ends with an operator' };
  // No empty groups
  if (/\(\s*\)/.test(q)) return { ok: false, error: 'Empty group ()' };
  return { ok: true };
}

/* ------------- RuleSet persistence (schema v2) ------------- */
function rulesGenId() { return 'rs_' + Math.random().toString(36).slice(2, 10); }
function ruleGenId()  { return 'r_'  + Math.random().toString(36).slice(2, 10); }
function rulesLoadSets() {
  try { return JSON.parse(localStorage.getItem(RULES_KEY) || '[]'); } catch { return []; }
}
function rulesSaveSets(list) {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(list)); }
  catch { toast('localStorage full — cannot save rule set', true, 4000); }
}
function rulesLoadSet(id) {
  const s = rulesLoadSets().find(x => x.id === id);
  if (!s) return false;
  state.rules.active = s.id;
  state.rules.rules  = JSON.parse(JSON.stringify(s.rules || []));
  state.rules.counts = {};
  try { localStorage.setItem(RULES_ACTIVE_KEY, id); } catch {}
  return true;
}
function rulesSnapshotCurrent(name) {
  const id = state.rules.active || rulesGenId();
  const sets = rulesLoadSets().filter(s => s.id !== id);
  sets.unshift({
    id,
    name: name || ('Rules ' + new Date().toLocaleDateString()),
    rules: JSON.parse(JSON.stringify(state.rules.rules || [])),
    saved_at: Date.now(),
    version: RULES_SCHEMA_VERSION,
  });
  rulesSaveSets(sets);
  state.rules.active = id;
  try { localStorage.setItem(RULES_ACTIVE_KEY, id); } catch {}
  return id;
}
/* ------------- Migration from v1 TF-IDF sets ------------- */
function rulesDetectMigrationNeeded() {
  // Only prompt once per browser — once user picks done/skipped, leave them alone
  try {
    const flag = localStorage.getItem(RULES_MIGRATED_KEY);
    if (flag === 'done' || flag === 'skipped') { state.rules._migration = flag; return false; }
  } catch {}
  const oldSets = (() => { try { return JSON.parse(localStorage.getItem(LABELS_KEY) || '[]'); } catch { return []; } })();
  if (!Array.isArray(oldSets) || !oldSets.length) { state.rules._migration = 'none'; return false; }
  state.rules._migration = 'pending';
  return true;
}

function rulesMigrateFromV1() {
  // Convert each v1 category into a Rule with an empty term-list but
  // seedExamples populated from the old tagging work. User clicks
  // ⚡ Suggest terms in D2 to generate actual query terms.
  const oldSets = (() => { try { return JSON.parse(localStorage.getItem(LABELS_KEY) || '[]'); } catch { return []; } })();
  const migrated = [];
  for (const os of oldSets) {
    const cats = Array.isArray(os.categories) ? os.categories : [];
    if (!cats.length) continue;
    const rules = cats.map(catName => {
      const seedExamples = {};
      for (const [recId, ex] of Object.entries(os.examples || {})) {
        if (!ex || typeof ex !== 'object') continue;
        if (ex.excluded) { seedExamples[recId] = 'negative'; continue; }
        if (Array.isArray(ex.labels) && ex.labels.includes(catName)) {
          seedExamples[recId] = 'positive';
        }
      }
      return {
        id: ruleGenId(),
        name: String(catName),
        must: [], also: [], not: [],
        notes: '',
        seedExamples,
      };
    });
    migrated.push({
      id: rulesGenId(),
      name: String(os.name || 'Migrated set'),
      rules,
      saved_at: Date.now(),
      version: RULES_SCHEMA_VERSION,
      migrated_from_v1: true,
    });
  }
  // Save alongside existing v2 sets (if any) — never clobber
  const existing = rulesLoadSets();
  rulesSaveSets([...migrated, ...existing]);
  try { localStorage.setItem(RULES_MIGRATED_KEY, 'done'); } catch {}
  state.rules._migration = 'done';
  return migrated.length;
}

function rulesSkipMigration() {
  try { localStorage.setItem(RULES_MIGRATED_KEY, 'skipped'); } catch {}
  state.rules._migration = 'skipped';
}

/* ------------- ⚡ Suggest terms — TF-IDF helper -------------
   Reuses the math helpers from the old classifier (labTokenize,
   labComputeTfIdf, labCentroid) — defined further down in the file,
   hoisted via function declaration. Given a map of annotationId →
   'positive' | 'negative', returns two ranked term lists. Pure-client,
   no Instant Mode required — runs on the records the user has just
   hand-tagged (10–20 typically).

   Resolver: findRec(id) → record object (from offline.data,
   lab.sampleRows, or an explicit poolById map passed in).

   Output shape:
     {
       positive: [{term, score}, ...],   // top 8, score > 0
       negative: [{term, score}, ...],   // top 6, score < 0
     }
   Throws on too few examples (< 5 positive or < 5 negative). */
function suggestTerms(seedExamples, findRec) {
  const pos = [];
  const neg = [];
  for (const [id, tag] of Object.entries(seedExamples || {})) {
    if (tag !== 'positive' && tag !== 'negative') continue;
    const rec = findRec ? findRec(id) : null;
    if (!rec) continue;
    const text = labGetClassificationText(rec);  // hoisted
    const toks = labTokenize(text);              // hoisted
    if (!toks.length) continue;
    (tag === 'positive' ? pos : neg).push(toks);
  }
  if (pos.length < 5) throw new Error('Need at least 5 POSITIVE examples (have ' + pos.length + ')');
  if (neg.length < 5) throw new Error('Need at least 5 NEGATIVE examples (have ' + neg.length + ')');

  const { vectors } = labComputeTfIdf([...pos, ...neg]);  // hoisted
  const posVec = labCentroid(vectors.slice(0, pos.length));
  const negVec = labCentroid(vectors.slice(pos.length));
  const allTerms = new Set([...Object.keys(posVec), ...Object.keys(negVec)]);
  const scores = [];
  for (const t of allTerms) {
    const s = (posVec[t] || 0) - (negVec[t] || 0);
    if (!s) continue;
    scores.push({ term: t, score: s });
  }
  return {
    positive: scores.filter(x => x.score > 0).sort((a,b)=>b.score-a.score).slice(0, 8),
    negative: scores.filter(x => x.score < 0).sort((a,b)=>a.score-b.score).slice(0, 6),
    stats: { pos: pos.length, neg: neg.length },
  };
}

/* ------------- Candidate pool for the ⚡ Suggest-terms tagger -------------
   Resolves which records the user can tag in the inline tagger. Prefers
   offline.data if Instant Mode is on (no network), else falls back to
   the first page of the current rail filter from the API. Returns a
   Promise<Record[]>. Caches on state.rules._sampleCache to avoid
   re-fetching if user opens the modal on two rules in a row. */
async function rulesBuildCandidatePool(maxRecords = 40) {
  if (Array.isArray(state.rules._sampleCache) && state.rules._sampleCache.length) {
    return state.rules._sampleCache.slice(0, maxRecords);
  }
  if (offline.enabled && Array.isArray(offline.data) && offline.data.length) {
    // Reuse labBuildSampleRows logic — already filters by rail
    const sample = labBuildSampleRows(maxRecords);
    state.rules._sampleCache = sample;
    return sample;
  }
  try {
    const r = await api.records(state.filters, 1, maxRecords, { scope: 'rules:sample' });
    const recs = r.records || [];
    state.rules._sampleCache = recs;
    return recs;
  } catch (e) {
    console.warn('[rules] sample pool fetch failed:', e);
    return [];
  }
}

/* ---------- TF-IDF math helpers — powers ⚡ Suggest-terms modal ----------
   Retained from the classic app.js classifier. labNormalize /
   labTokenize / labGetClassificationText / labComputeTfIdf /
   labCentroid are called from suggestTerms() above; labBuildSampleRows
   (further down) is called from rulesBuildCandidatePool() to seed the
   tagger's candidate pool when Instant Mode is on. */
function labNormalize(text) { return String(text || '').toLowerCase(); }
function labTokenize(text) {
  const out = [];
  const re = /[a-z0-9]+/g;
  let m;
  while ((m = re.exec(text))) {
    const w = m[0];
    if (w.length < 3 || w.length > 30) continue;
    if (LABELS_STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}
function labGetClassificationText(r) {
  const parts = [];
  if (Array.isArray(r.Themes) && r.Themes.length) parts.push(r.Themes.join(' '));
  if (Array.isArray(r.AffectedPersons) && r.AffectedPersons.length) parts.push(r.AffectedPersons.join(' '));
  const txt = r.TextPlainCleaned || r.Text || '';
  parts.push(txt);
  return labNormalize(parts.join(' '));
}
function labComputeTfIdf(documents) {
  // documents: Array<string[] tokens>
  const n = documents.length || 1;
  const df = new Map();
  for (const doc of documents) {
    const seen = new Set(doc);
    for (const tok of seen) df.set(tok, (df.get(tok) || 0) + 1);
  }
  const idf = new Map();
  for (const [tok, d] of df) idf.set(tok, Math.log((n + 1) / (d + 1)) + 1);
  const vectors = documents.map(doc => {
    const tf = new Map();
    for (const tok of doc) tf.set(tok, (tf.get(tok) || 0) + 1);
    const vec = Object.create(null);
    const len = Math.max(1, doc.length);
    for (const [tok, c] of tf) vec[tok] = (c / len) * (idf.get(tok) || 0);
    return vec;
  });
  return { vectors, idf };
}
/* Mean of a set of TF-IDF vectors — used by suggestTerms() to contrast
   the positive class against the negative class. */
function labCentroid(vectors) {
  const out = Object.create(null);
  if (!vectors.length) return out;
  for (const v of vectors) for (const k in v) out[k] = (out[k] || 0) + v[k];
  const n = vectors.length;
  for (const k in out) out[k] /= n;
  return out;
}

/* ---------- sample rows (respect rail filters where possible) ---------- */
function labBuildSampleRows(max = 120) {
  // Prefer offline.data (Instant Mode) + current rail filters.
  if (offline.enabled && Array.isArray(offline.data) && offline.data.length) {
    const f = state.filters;
    const kw = (f.kw || '').trim().toLowerCase();
    const filtered = offline.data.filter(r => {
      if (f.country.size) {
        const iso = (r.CountryISO3 || []).some(c => f.country.has(c));
        const nm = (r.Countries || []).some(c => f.country.has(c));
        if (!iso && !nm) return false;
      }
      if (f.body.size && !f.body.has(r.Body)) return false;
      if (f.theme.size) {
        const th = r.Themes || [];
        if (f.themesMatch === 'all') { for (const t of f.theme) if (!th.includes(t)) return false; }
        else if (!th.some(t => f.theme.has(t))) return false;
      }
      if (f.group.size) {
        const gr = r.AffectedPersons || [];
        if (f.groupsMatch === 'all') { for (const g of f.group) if (!gr.includes(g)) return false; }
        else if (!gr.some(g => f.group.has(g))) return false;
      }
      if (f.region.size) {
        const rg = r.Regions || [];
        if (!rg.some(rr => f.region.has(rr))) return false;
      }
      if (_hasSdgFilters(f) && !_recordMatchesSdgFilters(r.Sdgs || [], f)) {
        return false;
      }
      if (f.type.size && !f.type.has(r.AnnotationType)) return false;
      if (f.yearA || f.yearB) {
        const yr = Number((r.PublicationDate || '').slice(0, 4));
        if (f.yearA && yr < f.yearA) return false;
        if (f.yearB && yr > f.yearB) return false;
      }
      if (kw) {
        const hay = (r.TextPlainCleaned || r.Text || '').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    // Shuffle deterministically so re-enters feel stable but still varied
    const shuffled = filtered.slice(0, Math.min(filtered.length, max * 10));
    // Fisher-Yates with seed-free randomness; good enough for sampling
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, max);
  }
  return []; // Without Instant Mode, user needs to enable it
}


/* =====================================================================
   D2 — Boolean Rule Builder UI (renderRules + helpers)
   =====================================================================
   Replaces the old 3-step TF-IDF workspace. Each rule is a boolean
   FTS5 query shown as three editable chip rows (MUST / AND / NOT).
   Live count + peek hit the backend directly — no Instant Mode gate.
   Per-rule ⚡ Suggest-terms modal uses the retained TF-IDF math to
   propose terms from a small user-tagged sample.
   ===================================================================== */

/* ------------- Count fetching (debounced per-rule) ------------- */
const RULES_COUNT_DEBOUNCE = 350;
function rulesScheduleCount(rule) {
  const id = rule.id;
  if (state.rules._countInflight[id]) {
    clearTimeout(state.rules._countInflight[id]);
  }
  const timer = setTimeout(() => rulesFetchCount(rule), RULES_COUNT_DEBOUNCE);
  state.rules._countInflight[id] = timer;
}
async function rulesFetchCount(rule) {
  const validation = validateRule(rule);
  if (!validation.ok) {
    state.rules.counts[rule.id] = { error: validation.error };
    rulesPaintCount(rule);
    return;
  }
  const compiled = compileRule(rule);
  if (!compiled) {
    state.rules.counts[rule.id] = { n: null, empty: true };
    rulesPaintCount(rule);
    return;
  }
  state.rules.counts[rule.id] = { loading: true };
  rulesPaintCount(rule);
  try {
    const f = { ...state.filters, kw: compiled };
    const r = await api.recordsCount(f);
    state.rules.counts[rule.id] = { n: r.total_records || 0 };
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    state.rules.counts[rule.id] = { error: 'API error' };
  }
  rulesPaintCount(rule);
}

function rulesPaintCount(rule) {
  // In-place update of just the .rule-count element, no full re-render
  const el = document.querySelector(`[data-rule-id="${rule.id}"] .rule-count`);
  if (!el) return;
  const c = state.rules.counts[rule.id];
  if (!c) { el.textContent = '—'; el.className = 'rule-count'; return; }
  if (c.loading) { el.textContent = 'counting…'; el.className = 'rule-count loading'; return; }
  if (c.error) { el.textContent = '⚠ invalid'; el.className = 'rule-count err'; el.title = c.error; return; }
  if (c.empty) { el.textContent = 'empty rule'; el.className = 'rule-count loading'; return; }
  const n = c.n || 0;
  // Percentage denominator: rail hits if rail is active (so "% of Poland
  // records matching") else the dataset total.
  const denom = (!_railIsEmpty(state.filters) && state.totalHits)
    ? state.totalHits
    : 267537;
  const pct = (n / denom * 100).toFixed(n < 100 ? 2 : 1);
  el.textContent = `${fmt(n)} (${pct}%)`;
  el.className = 'rule-count ' + (n === 0 ? 'zero' : (n >= 50 && n <= 20000 ? 'ok' : 'warn'));
  // The denominator shown in the tooltip mirrors the denom used for pct
  // above (rail total if filtered, dataset total if not).  Previous line
  // referenced an undefined `total` — crashed as pageerror each time a
  // rule rendered.  Caught by user-flow H5 (Labels starter click).
  el.title = `${fmt(n)} of ${fmt(denom)} records match · click card for details`;
}

function rulesRefreshAllCounts() {
  for (const r of (state.rules.rules || [])) rulesScheduleCount(r);
}

/* ------------- Apply rule as global filter -------------
   Used by the "📊 Analyze" and "🔎 Search" rule-card actions. Sets the
   compiled FTS5 query as the rail keyword AND tags state.filters.activeLabel
   with the rule's id+name so the chip + scope banner can render the label
   name instead of the raw FTS5 string. Crucially, calls onFiltersChanged()
   so the rail hit-count, the active-filters strip, the URL hash and the
   current tab's render all stay in sync — without this, the user sees a
   half-applied filter (FIG.* refresh, but rail stays at 100% of dataset). */
function _applyRuleAsActiveFilter(rule, compiled) {
  state.filters.kw = compiled;
  state.filters.activeLabel = { id: rule.id, name: rule.name || 'unnamed rule' };
  const inp = $('#kwInput');
  if (inp) {
    inp.value = compiled;
    /* Clear any "label was here, then user typed" association in case
       this is a re-apply on top of a manually-edited keyword. */
    inp.dataset.fromLabel = '1';
  }
  if (typeof onFiltersChanged === 'function') onFiltersChanged();
}

/* ------------- Rule CRUD helpers ------------- */
function rulesAddRule(name) {
  const r = {
    id: ruleGenId(),
    name: name || 'New rule',
    must: [], also: [], not: [],
    rawQuery: '',
    notes: '',
  };
  state.rules.rules.push(r);
  _rulesInvalidateCoverage();
  return r;
}
function rulesDeleteRule(id) {
  state.rules.rules = state.rules.rules.filter(r => r.id !== id);
  delete state.rules.counts[id];
  delete state.rules._peekOpen[id];
  _rulesInvalidateCoverage();
}
function rulesFindById(id) { return state.rules.rules.find(r => r.id === id); }
function rulesAddTerm(rule, bucket, raw) {
  // Accept comma-separated paste. Trim. Dedupe. Skip empties.
  const incoming = String(raw || '')
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean);
  const existing = new Set(rule[bucket]);
  for (const t of incoming) if (!existing.has(t)) { rule[bucket].push(t); existing.add(t); }
  _rulesInvalidateCoverage();
}
function rulesRemoveTerm(rule, bucket, term) {
  rule[bucket] = rule[bucket].filter(t => t !== term);
  _rulesInvalidateCoverage();
}

/* ------------- Coverage (union / overlap / orphans across rules) ------------- */
/* state.rules.coverage = { stale:bool, running:bool, union:int, overlap:int,
                            perRule:{ruleId:Set<id>}, computed_at:ts } */
function renderCoverageSummary() {
  const c = state.rules.coverage;
  if (!c || c.stale) return `Coverage: <strong>—</strong> · <a href="#" id="rulesCoverageCompute">compute</a>`;
  if (c.running) return `Coverage: <em style="font-style:italic;color:var(--dim)">computing… ${c.progress || 0}%</em>`;
  if (c.error)   return `Coverage: <strong style="color:#b91c1c">error</strong> · ${sanitize(c.error)}`;
  const overlap = c.overlap || 0;
  return `<strong>${fmt(c.union)}</strong> records match 1+ rule${overlap ? ` · <strong>${fmt(overlap)}</strong> match 2+` : ''} · <a href="#" id="rulesCoverageRecompute">refresh</a>`;
}

async function rulesComputeCoverage() {
  const rules = (state.rules.rules || []).filter(r => compileRule(r));
  if (!rules.length) { toast('No rules to count', true, 2000); return; }
  state.rules.coverage = { running: true, progress: 0, perRule: {}, stale: false };
  _rulesRepaintCoverage();

  const perRuleIds = {};       // ruleId → Set<annotationId>
  try {
    let done = 0;
    for (const rule of rules) {
      perRuleIds[rule.id] = await _rulesFetchAllIds(rule);
      done++;
      state.rules.coverage.progress = Math.round(done / rules.length * 100);
      _rulesRepaintCoverage();
    }
    // Union + overlap counts
    const unionSet = new Set();
    const multi = new Set();        // ids in 2+ rules
    const countPerId = new Map();
    for (const ids of Object.values(perRuleIds)) {
      for (const id of ids) {
        unionSet.add(id);
        const n = (countPerId.get(id) || 0) + 1;
        countPerId.set(id, n);
        if (n >= 2) multi.add(id);
      }
    }
    state.rules.coverage = {
      running: false,
      union: unionSet.size,
      overlap: multi.size,
      perRule: perRuleIds,
      computed_at: Date.now(),
      stale: false,
    };
  } catch (e) {
    console.warn('[rules] coverage failed:', e);
    state.rules.coverage = { error: 'API error', running: false, stale: true };
  }
  _rulesRepaintCoverage();
}

function _rulesRepaintCoverage() {
  const el = $('#rulesCoverageText');
  if (el) el.innerHTML = renderCoverageSummary();
  // Rebind the inline <a> click handlers since innerHTML replaced them
  $('#rulesCoverageCompute')?.addEventListener('click', e => { e.preventDefault(); rulesComputeCoverage(); });
  $('#rulesCoverageRecompute')?.addEventListener('click', e => { e.preventDefault(); state.rules.coverage = null; rulesComputeCoverage(); });
}

/* Mark coverage as stale whenever a rule changes — user has to hit
   "refresh" to recompute. Cheaper than auto-running on every keystroke. */
function _rulesInvalidateCoverage() {
  if (state.rules.coverage) state.rules.coverage.stale = true;
}

/* ------------- Fetch all matching annotation IDs for one rule ------------- */
/* Paginates /api/data/records at page_size=1000 until exhausted.
   Respects current rail filter. Cancellable via AbortController on
   state.rules.coverage._abort (set by caller). Returns Set<string>. */
async function _rulesFetchAllIds(rule) {
  const q = compileRule(rule);
  const ids = new Set();
  if (!q) return ids;
  const pageSize = 1000;
  let page = 1;
  while (true) {
    const r = await api.records({ ...state.filters, kw: q }, page, pageSize, { scope: 'rules:idfetch:' + rule.id });
    for (const rec of (r.records || [])) ids.add(rec.AnnotationId);
    if (page >= (r.total_pages || 1) || !(r.records || []).length) break;
    page++;
    if (page > 300) { console.warn('[rules] id-fetch hit 300-page ceiling'); break; }
  }
  return ids;
}

/* ------------- CSV export — records × rules matrix ------------- */
async function rulesExportCsv() {
  const rules = (state.rules.rules || []).filter(r => compileRule(r));
  if (!rules.length) { toast('No rules to export', true, 2000); return; }

  // If coverage was just computed, reuse its perRule payload — otherwise fetch fresh
  let perRule = state.rules.coverage?.perRule;
  if (!perRule || state.rules.coverage?.stale) {
    toast('Fetching matching records — this can take a few seconds…', false, 3500);
    await rulesComputeCoverage();
    perRule = state.rules.coverage?.perRule;
  }
  if (!perRule) { toast('Coverage failed — can\'t export', true, 3000); return; }

  // Build id → Set<ruleName>
  const assign = new Map();
  for (const rule of rules) {
    const set = perRule[rule.id] || new Set();
    for (const id of set) {
      if (!assign.has(id)) assign.set(id, new Set());
      assign.get(id).add(rule.name);
    }
  }
  if (!assign.size) { toast('No records match any rule', true, 2500); return; }

  // CSV — one row per record, one column per rule + a joined "labels" column
  const header = ['AnnotationId', 'labels', ...rules.map(r => r.name)];
  const escape = (s) => {
    const str = String(s ?? '');
    return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const lines = [header.map(escape).join(',')];
  for (const [id, ruleSet] of assign) {
    const joined = Array.from(ruleSet).join('; ');
    const cols = rules.map(r => ruleSet.has(r.name) ? '1' : '0');
    lines.push([id, joined, ...cols].map(escape).join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'uhri-rules-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${fmt(assign.size)} records.`, false, 2500);
}

/* ------------- Main render ------------- */
function renderRules() {
  const root = $('#view-labels');
  if (!root) return;

  // Resume active set if one is saved
  if (!state.rules.active) {
    const id = (() => { try { return localStorage.getItem(RULES_ACTIVE_KEY); } catch { return null; } })();
    if (id && rulesLoadSets().find(s => s.id === id)) rulesLoadSet(id);
  }

  // Check for migration prompt
  if (state.rules._migration == null) rulesDetectMigrationNeeded();
  const showMigrationBanner = state.rules._migration === 'pending';

  const sets = rulesLoadSets();
  const rules = state.rules.rules || [];
  const hasRules = rules.length > 0;
  const activeSet = sets.find(s => s.id === state.rules.active);

  // Compute rail-scope hint
  const railActive = !_railIsEmpty(state.filters);

  root.innerHTML = `
    <div class="rules-wrap">

      ${showMigrationBanner ? `
        <div class="rules-migrate">
          <div class="rules-migrate-head">
            <strong>Welcome — your saved classifier sets can be converted.</strong>
          </div>
          <p>This workspace is now a <strong>boolean rule builder</strong>. Your old categories can be imported as rule stubs — tagged examples will seed the <em>⚡ Suggest terms</em> helper so you can generate query terms with one click.</p>
          <div class="rules-migrate-actions">
            <button id="rulesMigrateGo" class="primary">⚡ Convert my saved sets</button>
            <button id="rulesMigrateSkip">Skip — I'll start fresh</button>
          </div>
        </div>` : ''}

      ${!hasRules ? `
        <div class="rules-empty">
          <h2>Define your labels as boolean queries</h2>
          <p>No training. No 300 MB download. Every label is one query that runs server-side — fully explainable in a methodology section.</p>
          <p class="dim">Don't know the right terms yet? Tag a few examples and the <strong>⚡ Suggest terms</strong> helper proposes candidates from your positive/negative picks.</p>
          <div class="starter-row" id="rulesStarterRow">
            ${RULES_STARTER_TEMPLATES.map(t => `<button data-starter="${sanitize(t.id)}">${sanitize(t.name)} (${t.rules.length})</button>`).join('')}
          </div>
          <button class="add-first" id="rulesAddFirst">+ Add first rule</button>
        </div>` : ''}

      <!-- Documentation moved here from Methodology tab on 2026-04-23:
           the rule model, evaluation, suggest-terms helper, exports,
           fit/unfit use cases, and persistence details all belong in
           the tab where users actually build rules, not buried 9
           sections deep in Methodology.  <details> keeps the onboarding
           surface uncluttered — closed by default, one click to expand. -->
      <details class="rules-howto" style="margin:18px 0 4px;border:1px solid var(--line);border-radius:4px;background:var(--paper-2)">
        <summary style="padding:10px 14px;cursor:pointer;font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);list-style:none">How the Labels workspace works <span style="color:#7a5500">· β</span></summary>
        <div style="padding:4px 18px 16px;font-size:13.5px;line-height:1.6">
          <p style="margin-top:6px">This tab lets you define your own label taxonomy as explicit <strong>boolean FTS5 queries</strong>. Each label is one query that runs server-side against the same full-text index as the Search tab — <em>deterministic, fully explainable in a methodology section, no 300 MB download required</em>. A TF-IDF term-suggestion helper accelerates query construction by proposing candidate terms from a small sample of tagged examples. The workspace is flagged <strong>β</strong> while we collect feedback on the rule model and term-suggester — core behaviour is stable, edge cases (CSV export of very broad rules, set-migration corner cases) may still surprise.</p>
          <ul style="padding-left:22px">
            <li><strong>Rule model.</strong> Each rule has three term lists: <em>MUST</em> (OR-ed inside, required), <em>AND</em> (OR-ed inside, required when non-empty), <em>NOT</em> (OR-ed inside, excluded). They compile to FTS5 as <code>(must-1 OR must-2) AND (also-1 OR also-2) NOT (not-1)</code>. Stemming, irregular-plural expansion, quoted phrases and <code>*</code> wildcards work exactly as in the Search tab. A per-rule "raw FTS5" escape hatch is available for power users.</li>
            <li><strong>Evaluation.</strong> Every rule count is a single API call to <code>/api/data/records</code> with the compiled query — same code path as the Search tab, same performance (100–300 ms typical). Counts respect the current rail filter, so a <em>Judicial independence</em> rule with a Country=Poland rail counts Poland records only.</li>
            <li><strong>⚡ Suggest-terms helper.</strong> Per-rule modal: tag 10–20 records as <em>positive / negative / skip</em>, the browser runs TF-IDF centroid comparison on that small sample (≤50 ms), returns two ranked term lists. Click chips to add picked terms to MUST / AND / NOT. Tagged examples persist with the rule so the modal resumes where you left off. No Instant Mode required — the sample comes from the current rail filter (API page 1) or from <code>offline.data</code> if Instant Mode happens to be on.</li>
            <li><strong>Exports.</strong> <em>JSON</em> — full rule set, re-importable, shareable. <em>CSV</em> — records × rules assignment matrix (one row per record, one 1/0 column per rule plus a joined <code>labels</code> string). <em>Coverage</em> — union count (records matching ≥1 rule) and overlap count (records matching ≥2 rules). CSV / Coverage require one API round-trip per rule plus pagination of matching IDs; typically a few seconds for a 5-rule set with median match sizes.</li>
            <li><strong>Suitable for.</strong> Literature-review scaffolding with a defensible methodology annex, hypothesis probing ("how many UHRI records mention X AND Y but NOT Z?"), team-shared coding schemas that any collaborator with the UHRI can re-apply by pasting the compiled FTS5 string, reproducible research outputs.</li>
            <li><strong>Not suitable for.</strong> Fuzzy semantic matching where the target phrase rewrites heavily ("independent judiciary" surfaced as "courts free from political pressure"). Rules match the literal terms you declare — widen them with synonyms via OR, or use the Suggest-terms helper to discover vocabulary you'd missed.</li>
            <li><strong>Persistence.</strong> Rule sets live in your browser's <code>localStorage</code> per origin — clear cache and they are gone. Use <strong>⬇ JSON</strong> for durable copies and team sharing. Saved sets from the earlier TF-IDF workspace can be converted into rule stubs on first open (your tagged examples seed the Suggest-terms modal so you can bootstrap term lists with one click).</li>
          </ul>
        </div>
      </details>

      ${hasRules ? `
        <div class="rules-toolbar">
          <label>Set:
            <select id="rulesSetSelect" title="Switch between saved rule sets">
              <option value="">${activeSet ? '— unsaved changes —' : '— not saved —'}</option>
              ${sets.map(s => `<option value="${sanitize(s.id)}" ${s.id === state.rules.active ? 'selected' : ''}>${sanitize(s.name)} (${s.rules.length})</option>`).join('')}
            </select>
          </label>
          <button id="rulesNewSet" title="Start a fresh rule set">+ New set</button>
          <button id="rulesImportJson" title="Import rules from a JSON file">⬆ Import</button>
          ${railActive ? `<span class="rules-scope-note">Counts scoped to current rail filter · <a href="#" data-nav="search" style="color:var(--accent)">clear rail</a></span>` : `<span class="rules-scope-note">Dataset-wide (no rail filter active)</span>`}
        </div>

        <div class="rules-cards" id="rulesCards">
          ${rules.map(r => renderRuleCard(r)).join('')}
        </div>

        <button class="add-rule-btn" id="rulesAddAnother">+ Add rule</button>

        <div class="rules-bottom">
          <button id="rulesSaveSet" class="primary">💾 Save set${activeSet ? ' (overwrite)' : ''}</button>
          <button id="rulesSaveAsNew" ${activeSet ? '' : 'disabled'}>💾 Save as new</button>
          <button id="rulesComputeCoverage" title="Union / overlap / orphans across all rules (hits the API, can take a few seconds)">📊 Coverage</button>
          <button id="rulesExportCsv" title="Records × rules assignment matrix (one row per record, one column per rule)">⬇ CSV</button>
          <button id="rulesExportJson">⬇ JSON</button>
          <span class="coverage"><span id="rulesCoverageText">${renderCoverageSummary()}</span></span>
        </div>` : ''}
    </div>`;

  rulesBindEvents();
  rulesRefreshAllCounts();
}

/* ------------- Per-rule card render ------------- */
function renderRuleCard(rule) {
  const validation = validateRule(rule);
  const errMsg = validation.ok ? '' : validation.error;
  const useRaw = !!(rule.rawQuery && rule.rawQuery.trim());
  const isActiveFilter = state.filters?.activeLabel?.id === rule.id;
  return `
    <div class="rule-card ${errMsg ? 'invalid' : ''} ${state.rules._peekOpen[rule.id] ? 'has-peek' : ''} ${isActiveFilter ? 'is-active-filter' : ''}" data-rule-id="${sanitize(rule.id)}">
      <div class="rule-head">
        <input class="rule-name" type="text" value="${sanitize(rule.name)}" placeholder="Rule name — e.g. Judicial independence" />
        ${isActiveFilter ? `<span class="rule-active-badge" title="This label is currently driving the dataset filter">● ACTIVE FILTER</span>` : ''}
        <span class="rule-count" data-act="openDrawer" title="Click to browse matching records in the side drawer (stay on this tab)" role="button" tabindex="0">—</span>
        <button class="rule-btn" data-act="peek" title="Show 5 matching records inline (click any example to open it on the right)">👁</button>
        <button class="rule-btn" data-act="suggest" title="⚡ Suggest terms from tagged examples">⚡</button>
        <button class="rule-btn danger" data-act="delete" title="Delete this rule">×</button>
      </div>
      <div class="rule-body">
        ${useRaw ? `
          <div class="rule-raw">
            <textarea data-raw="${sanitize(rule.id)}" placeholder="Enter FTS5 query directly (e.g. (judiciary OR court*) AND independen* NOT executive)">${sanitize(rule.rawQuery || '')}</textarea>
            <div class="hint">RAW FTS5 MODE · <a href="#" data-act="unraw" data-rule="${sanitize(rule.id)}">← switch back to chips</a></div>
          </div>
        ` : `
          ${renderRuleRow(rule, 'must', 'MUST',  'judiciary, court*', '#0d9488')}
          ${renderRuleRow(rule, 'also', 'AND',   'independen*, impartial', 'var(--dim)')}
          ${renderRuleRow(rule, 'not',  'NOT',   'executive', '#b91c1c')}
        `}
        ${errMsg ? `<div class="rule-err">${sanitize(errMsg)}</div>` : ''}
        <div class="rule-actions">
          <button data-act="analyze" title="Apply as rail keyword and go to Overview — see map, timeline, country/body distributions for records matching this rule">📊 Analyze</button>
          <button data-act="openInSearch" title="Apply as rail keyword and go to Search — full-page list with sort, bulk actions, export">🔎 Search</button>
          <span class="rule-overflow-wrap">
            <button class="rule-overflow-btn" data-act="overflow" title="More actions" aria-haspopup="menu" aria-expanded="false">⋯</button>
            <span class="rule-overflow-menu" hidden role="menu">
              <button data-act="toggleRaw" class="${useRaw ? 'active' : ''}" role="menuitem">${useRaw ? '✓ Chips mode' : 'Raw FTS5 mode'}</button>
              <button data-act="copy" role="menuitem">📋 Copy query</button>
            </span>
          </span>
        </div>
        ${state.rules._peekOpen[rule.id] ? `<div class="rule-peek" data-peek="${sanitize(rule.id)}"><span class="pk-loading">Loading peek…</span></div>` : ''}
      </div>
    </div>`;
}

function renderRuleRow(rule, bucket, label, placeholder, color) {
  const terms = rule[bucket] || [];
  return `
    <div class="rule-row r-${bucket}">
      <div class="lbl" style="${color ? `color:${color}` : ''}">${label}</div>
      <div class="rule-terms r-${bucket}" data-bucket="${bucket}" data-rule="${sanitize(rule.id)}">
        ${terms.map(t => `<span class="term-chip">${sanitize(t)}<button class="x" data-rmterm="${sanitize(t)}" data-bucket="${bucket}">×</button></span>`).join('')}
        <input class="term-input" type="text" data-add-bucket="${bucket}" data-rule="${sanitize(rule.id)}" placeholder="${sanitize(placeholder)}" />
      </div>
    </div>`;
}

/* ------------- Event bindings (called after each render) ------------- */
function rulesBindEvents() {
  const root = $('#view-labels');
  if (!root) return;

  // Migration banner
  $('#rulesMigrateGo')?.addEventListener('click', () => {
    try {
      const n = rulesMigrateFromV1();
      toast(`Converted ${n} set${n === 1 ? '' : 's'}. Open the set selector to find them.`, false, 3500);
    } catch (e) {
      console.error('[rules] migration failed:', e);
      toast('Migration failed — see console', true, 3000);
    }
    renderRules();
  });
  $('#rulesMigrateSkip')?.addEventListener('click', () => {
    rulesSkipMigration();
    toast('Skipped.', false, 1800);
    renderRules();
  });

  // Starter templates + first rule (empty state)
  $$('#rulesStarterRow [data-starter]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.starter;
    const t = RULES_STARTER_TEMPLATES.find(x => x.id === id);
    if (!t) return;
    state.rules.rules = JSON.parse(JSON.stringify(t.rules)).map(r => ({ ...r, id: ruleGenId() }));
    state.rules.active = null;     // force save-as flow
    state.rules.counts = {};
    renderRules();
  }));
  $('#rulesAddFirst')?.addEventListener('click', () => {
    rulesAddRule();
    renderRules();
    setTimeout(() => $('.rule-name')?.focus(), 40);
  });

  // Set selector
  $('#rulesSetSelect')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    if (rulesLoadSet(id)) renderRules();
  });
  $('#rulesNewSet')?.addEventListener('click', () => {
    state.rules.active = null;
    state.rules.rules = [];
    state.rules.counts = {};
    try { localStorage.removeItem(RULES_ACTIVE_KEY); } catch {}
    renderRules();
  });

  // Import JSON
  $('#rulesImportJson')?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const data = JSON.parse(txt);
        // Accept either a single RuleSet or an array of them
        const incoming = Array.isArray(data) ? data : [data];
        const existing = rulesLoadSets();
        for (const s of incoming) {
          if (!s || !Array.isArray(s.rules)) continue;
          existing.unshift({
            ...s,
            id: rulesGenId(),
            saved_at: Date.now(),
            version: RULES_SCHEMA_VERSION,
          });
        }
        rulesSaveSets(existing);
        toast(`Imported ${incoming.length} set${incoming.length === 1 ? '' : 's'}.`, false, 2400);
        renderRules();
      } catch (e) {
        toast('Import failed — invalid JSON', true, 3000);
      }
    };
    inp.click();
  });

  // Save set
  $('#rulesSaveSet')?.addEventListener('click', () => {
    const name = state.rules.active
      ? (rulesLoadSets().find(s => s.id === state.rules.active)?.name || 'Saved rule set')
      : prompt('Name this rule set:', 'Rules ' + new Date().toLocaleDateString());
    if (!name) return;
    rulesSnapshotCurrent(name);
    toast('Saved.', false, 1500);
    renderRules();
  });
  $('#rulesSaveAsNew')?.addEventListener('click', () => {
    const name = prompt('Name for new set:', 'Copy of current');
    if (!name) return;
    state.rules.active = null;    // force new id
    rulesSnapshotCurrent(name);
    toast('Saved as new set.', false, 1500);
    renderRules();
  });

  // Export JSON
  $('#rulesExportJson')?.addEventListener('click', () => {
    const payload = {
      name: rulesLoadSets().find(s => s.id === state.rules.active)?.name || 'Rules',
      rules: state.rules.rules,
      version: RULES_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'uhri-rules-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Coverage button (top-level)
  $('#rulesComputeCoverage')?.addEventListener('click', () => rulesComputeCoverage());
  // Coverage inline links inside the coverage summary span
  $('#rulesCoverageCompute')?.addEventListener('click', e => { e.preventDefault(); rulesComputeCoverage(); });
  $('#rulesCoverageRecompute')?.addEventListener('click', e => { e.preventDefault(); state.rules.coverage = null; rulesComputeCoverage(); });

  // CSV export
  $('#rulesExportCsv')?.addEventListener('click', () => rulesExportCsv());

  // Add rule
  $('#rulesAddAnother')?.addEventListener('click', () => {
    rulesAddRule();
    renderRules();
    setTimeout(() => {
      const cards = $$('.rule-card');
      cards[cards.length - 1]?.querySelector('.rule-name')?.focus();
    }, 40);
  });

  // Per-rule bindings
  $$('#rulesCards .rule-card').forEach(card => {
    const id = card.dataset.ruleId;
    const rule = rulesFindById(id);
    if (!rule) return;

    // Name edit
    const nameEl = card.querySelector('.rule-name');
    nameEl?.addEventListener('blur', () => {
      rule.name = (nameEl.value || '').trim() || 'Untitled rule';
    });
    nameEl?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });

    // Term input (add)
    card.querySelectorAll('[data-add-bucket]').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const v = (inp.value || '').trim().replace(/,$/, '');
          if (!v) return;
          rulesAddTerm(rule, inp.dataset.addBucket, v);
          inp.value = '';
          renderRules();
          rulesScheduleCount(rule);
        } else if (e.key === 'Backspace' && !inp.value) {
          // Delete last chip on backspace in empty input
          const bucket = inp.dataset.addBucket;
          if (rule[bucket].length) {
            rule[bucket].pop();
            renderRules();
            rulesScheduleCount(rule);
          }
        }
      });
      inp.addEventListener('blur', () => {
        const v = (inp.value || '').trim();
        if (!v) return;
        rulesAddTerm(rule, inp.dataset.addBucket, v);
        inp.value = '';
        renderRules();
        rulesScheduleCount(rule);
      });
    });

    // Term chip remove
    card.querySelectorAll('.term-chip .x').forEach(btn => btn.addEventListener('click', () => {
      const bucket = btn.dataset.bucket;
      const term = btn.dataset.rmterm;
      rulesRemoveTerm(rule, bucket, term);
      renderRules();
      rulesScheduleCount(rule);
    }));

    // Raw textarea (debounced save on input)
    const rawEl = card.querySelector('textarea[data-raw]');
    if (rawEl) {
      let t = null;
      rawEl.addEventListener('input', () => {
        rule.rawQuery = rawEl.value;
        clearTimeout(t);
        t = setTimeout(() => rulesScheduleCount(rule), 200);
      });
    }

    // Action buttons — includes the clickable rule-count badge which
    // has data-act="openDrawer" (same action as the 📜 Browse button).
    card.querySelectorAll('.rule-head [data-act], .rule-actions button, a[data-act]').forEach(btn => {
      const trigger = (e) => {
        e.preventDefault();
        const act = btn.dataset.act;
        if (act === 'delete') {
          if (confirm(`Delete rule "${rule.name}"?`)) {
            rulesDeleteRule(id);
            renderRules();
          }
        } else if (act === 'toggleRaw') {
          if (rule.rawQuery && rule.rawQuery.trim()) {
            rule.rawQuery = '';   // drop back to chips
          } else {
            rule.rawQuery = compileRule(rule);  // seed from current chips
          }
          renderRules();
        } else if (act === 'unraw') {
          rule.rawQuery = '';
          renderRules();
        } else if (act === 'copy') {
          const q = compileRule(rule);
          if (!q) { toast('Rule is empty', true, 1500); return; }
          navigator.clipboard.writeText(q).then(
            () => toast('FTS5 query copied', false, 1500),
            () => toast('Copy failed — select the rule-count to see query in tooltip', true, 2400));
        } else if (act === 'openInSearch') {
          const q = compileRule(rule);
          if (!q) { toast('Rule is empty', true, 1500); return; }
          _applyRuleAsActiveFilter(rule, q);
          navigate('search');
        } else if (act === 'analyze') {
          // Answer to "what next after I've built a rule": pipe it through
          // the Overview lens so the user sees geographic distribution,
          // temporal trends, per-body breakdowns, SDG mappings — all
          // scoped to records the rule matches. Every tab (Country,
          // Mechanism, SDG, Compare) will then work as rule-scoped too.
          const q = compileRule(rule);
          if (!q) { toast('Rule is empty', true, 1500); return; }
          _applyRuleAsActiveFilter(rule, q);
          toast(`Filtering by label "${rule.name || 'unnamed rule'}" — explore across tabs`, false, 2500);
          navigate('overview');
        } else if (act === 'openDrawer') {
          // Hybrid: browse matching records in the side drawer without
          // leaving the Labels workspace. Drawer list uses the exact
          // same FTS5 query as the count badge, so the numbers match.
          const q = compileRule(rule);
          if (!q) { toast('Rule is empty', true, 1500); return; }
          openListDrawer('rule', rule.name || 'unnamed rule', { kw: q });
        } else if (act === 'peek') {
          const open = !state.rules._peekOpen[id];
          state.rules._peekOpen[id] = open;
          renderRules();
          if (open) rulesLoadPeek(rule);
        } else if (act === 'suggest') {
          rulesOpenSuggestModal(rule);
        } else if (act === 'overflow') {
          // Toggle the per-card overflow menu (Raw FTS5, Copy query).
          // Close any other open overflow menu so we don't end up with
          // multiple stacked menus when the user clicks across cards.
          const wrap = btn.closest('.rule-overflow-wrap');
          const menu = wrap?.querySelector('.rule-overflow-menu');
          if (!menu) return;
          const wasOpen = !menu.hasAttribute('hidden');
          $$('.rule-overflow-menu').forEach(m => m.setAttribute('hidden', ''));
          $$('.rule-overflow-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
          if (!wasOpen) {
            menu.removeAttribute('hidden');
            btn.setAttribute('aria-expanded', 'true');
          }
        }
      };
      btn.addEventListener('click', trigger);
      // Keyboard accessibility for the count-badge "button role"
      if (btn.getAttribute('role') === 'button') {
        btn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') trigger(e);
        });
      }
    });

    // Peek records: click any of the 5 inline examples to open it in
    // the side reader. Uses the records cached on the peek element by
    // rulesLoadPeek so we don't refetch.
    card.querySelectorAll('.rule-peek').forEach(peekEl => {
      const open = (idx) => {
        const rec = (peekEl._peekRecs || [])[idx];
        if (!rec) return;
        state.drawerMode = 'record';
        state.drawerList = null;
        state.selectedRec = rec;
        if (typeof renderDrawer === 'function') renderDrawer();
      };
      peekEl.addEventListener('click', e => {
        const pk = e.target.closest('.pk');
        if (!pk) return;
        open(+pk.dataset.pkIdx);
      });
      peekEl.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const pk = e.target.closest('.pk');
        if (!pk) return;
        e.preventDefault();
        open(+pk.dataset.pkIdx);
      });
    });
  });

  // Outside-click closes any open overflow menu — single global listener
  // installed once per render of the labels view.
  if (!root._overflowOutsideBound) {
    root._overflowOutsideBound = true;
    document.addEventListener('click', e => {
      if (e.target.closest('.rule-overflow-wrap')) return;
      $$('.rule-overflow-menu').forEach(m => m.setAttribute('hidden', ''));
      $$('.rule-overflow-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
    });
  }
}

/* ------------- Peek 5 records inline ------------- */
async function rulesLoadPeek(rule) {
  const el = document.querySelector(`[data-peek="${rule.id}"]`);
  if (!el) return;
  const q = compileRule(rule);
  if (!q) { el.innerHTML = '<span class="pk-loading">Empty rule</span>'; return; }
  try {
    const r = await api.records({ ...state.filters, kw: q }, 1, 5, { scope: `rules:peek:${rule.id}` });
    const recs = r.records || [];
    if (!recs.length) { el.innerHTML = '<span class="pk-loading">No matches</span>'; return; }
    // Stash records on the peek element so click handlers can hand the
    // full record straight to the drawer without a refetch round-trip.
    el._peekRecs = recs;
    el.innerHTML = recs.map((rec, i) => {
      const yr = (rec.PublicationDate || '').slice(0, 4) || '—';
      const country = cleanCountryName((rec.Countries || [])[0] || '—');
      const body = cleanLabel(rec.Body || '—');
      const txt = rec.TextPlainCleaned || rec.Text || '—';
      return `<div class="pk" data-pk-idx="${i}" role="button" tabindex="0" title="Open this record in the side reader →">
        <div class="pk-meta">${sanitize(yr)} · ${sanitize(country)} · ${sanitize(body)}</div>
        ${sanitize(txt.slice(0, 240))}${txt.length > 240 ? '…' : ''}
      </div>`;
    }).join('');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    el.innerHTML = '<span class="pk-loading">Peek failed</span>';
  }
}

/* ------------- ⚡ Suggest-terms modal ------------- */
let _sugState = null;

async function rulesOpenSuggestModal(rule) {
  _sugState = {
    rule,
    pool: [],
    idx: 0,
    tags: { ...(rule.seedExamples || {}) },      // start from any existing seeds
    results: null,
    picked: { positive: new Set(), negative: new Set() },
  };
  // Build pool (up to 40 candidates)
  const pool = await rulesBuildCandidatePool(40);
  _sugState.pool = pool;
  // Jump cursor past any already-tagged records
  while (_sugState.idx < pool.length && _sugState.tags[pool[_sugState.idx]?.AnnotationId]) _sugState.idx++;
  rulesRenderSuggestModal();
}

function rulesRenderSuggestModal() {
  // Remove existing
  document.querySelector('.sug-overlay')?.remove();
  if (!_sugState) return;

  const overlay = document.createElement('div');
  overlay.className = 'sug-overlay';
  const { rule, pool, idx, tags, results } = _sugState;
  const pos = Object.values(tags).filter(t => t === 'positive').length;
  const neg = Object.values(tags).filter(t => t === 'negative').length;
  const done = Object.keys(tags).length;
  const total = Math.min(pool.length, 20);   // cap tagger at 20
  const canCompute = pos >= 5 && neg >= 5;

  if (results) {
    // Results screen
    overlay.innerHTML = `
      <div class="sug-modal">
        <div class="sug-head">
          <h3>Suggested terms for "${sanitize(rule.name)}"</h3>
          <button class="x" data-sug-act="close">×</button>
        </div>
        <div class="sug-body sug-results">
          <p class="sug-lead">Click chips to select, pick which bucket to add them to. Terms stay in your rule until you remove them. Based on ${results.stats.pos} positive + ${results.stats.neg} negative examples.</p>

          <h4>Positive-class terms (candidates for MUST / AND)</h4>
          <div class="chip-row" id="sugPosChips">
            ${results.positive.map(x => `<span class="sug-chip" data-sug-term="${sanitize(x.term)}" data-sug-class="pos">${sanitize(x.term)}<span class="s">${(x.score * 100).toFixed(0)}</span></span>`).join('') || '<span style="color:var(--dim);font-size:11px">None — positive and negative examples looked too similar.</span>'}
          </div>

          <h4>Negative-class terms (candidates for NOT)</h4>
          <div class="chip-row" id="sugNegChips">
            ${results.negative.map(x => `<span class="sug-chip" data-sug-term="${sanitize(x.term)}" data-sug-class="neg">${sanitize(x.term)}<span class="s">${Math.abs(x.score * 100).toFixed(0)}</span></span>`).join('') || '<span style="color:var(--dim);font-size:11px">None — no terms strongly marked negative examples.</span>'}
          </div>

          <div class="sug-add-row">
            <button data-sug-act="addMust" class="primary">Add picked to MUST</button>
            <button data-sug-act="addAlso">Add picked to AND</button>
            <button data-sug-act="addNot">Add picked to NOT</button>
            <button data-sug-act="back">← Back to tagger</button>
          </div>
        </div>
        <div class="sug-footer">
          <span>${results.stats.pos} positive · ${results.stats.neg} negative</span>
          <span>Close when done</span>
        </div>
      </div>`;
  } else {
    // Tagger screen
    const rec = pool[idx];
    overlay.innerHTML = `
      <div class="sug-modal">
        <div class="sug-head">
          <h3>⚡ Suggest terms for "${sanitize(rule.name)}"</h3>
          <button class="x" data-sug-act="close">×</button>
        </div>
        <div class="sug-body">
          <p class="sug-lead">Tag records as <strong>positive</strong> (fit the concept), <strong>negative</strong> (clearly don't), or <strong>skip</strong>. We'll compute distinguishing terms. Goal: ≥5 of each.</p>

          <div class="sug-progress">
            <span>${done}/${total}</span>
            <div class="bar"><span style="width:${Math.min(100, done / total * 100)}%"></span></div>
            <span>${pos}p · ${neg}n</span>
          </div>

          ${rec ? `
            <div class="sug-card">
              <div class="meta">${sanitize((rec.PublicationDate || '').slice(0,4) || '—')} · ${sanitize(cleanCountryName((rec.Countries || [])[0] || '—'))} · ${sanitize(cleanLabel(rec.Body || '—'))}${rec.AnnotationType ? ' · ' + sanitize(rec.AnnotationType) : ''}</div>
              <div class="tx">${sanitize((rec.TextPlainCleaned || rec.Text || '—').slice(0, 1200))}</div>
              <div class="choose">
                <button class="pos ${tags[rec.AnnotationId] === 'positive' ? 'active' : ''}" data-sug-act="tag" data-tag="positive">✓ Positive</button>
                <button class="neg ${tags[rec.AnnotationId] === 'negative' ? 'active' : ''}" data-sug-act="tag" data-tag="negative">✗ Negative</button>
                <button class="skip ${tags[rec.AnnotationId] === 'skip' ? 'active' : ''}" data-sug-act="tag" data-tag="skip">↻ Skip</button>
                <button data-sug-act="prev" ${idx === 0 ? 'disabled' : ''} style="margin-left:auto">← Prev</button>
                <button data-sug-act="next" ${idx >= pool.length - 1 ? 'disabled' : ''}>Next →</button>
              </div>
            </div>
          ` : '<p style="color:var(--dim);text-align:center;padding:40px 0">No candidate records. Try widening your rail filter and re-open.</p>'}

          <button class="sug-compute" data-sug-act="compute" ${canCompute ? '' : 'disabled'}>${canCompute ? `Compute suggestions (${pos}+${neg})` : `Need ${Math.max(0, 5 - pos)}+ positive, ${Math.max(0, 5 - neg)}+ negative`}</button>
        </div>
        <div class="sug-footer">
          <span>Pool: ${pool.length} candidates</span>
          <span>Tap outside to cancel</span>
        </div>
      </div>`;
  }

  document.body.appendChild(overlay);

  // Bind events
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { _sugState = null; overlay.remove(); return; }
    const btn = e.target.closest('[data-sug-act]');
    if (!btn) return;
    const act = btn.dataset.sugAct;
    if (act === 'close') { _sugState = null; overlay.remove(); }
    else if (act === 'tag') {
      const rec = _sugState.pool[_sugState.idx];
      if (rec) {
        _sugState.tags[rec.AnnotationId] = btn.dataset.tag;
        // auto-advance
        if (_sugState.idx < _sugState.pool.length - 1) _sugState.idx++;
      }
      rulesRenderSuggestModal();
    }
    else if (act === 'prev') { _sugState.idx = Math.max(0, _sugState.idx - 1); rulesRenderSuggestModal(); }
    else if (act === 'next') { _sugState.idx = Math.min(_sugState.pool.length - 1, _sugState.idx + 1); rulesRenderSuggestModal(); }
    else if (act === 'compute') {
      try {
        const findRec = (id) => _sugState.pool.find(r => r.AnnotationId === id);
        _sugState.results = suggestTerms(_sugState.tags, findRec);
        // Persist the tagged examples into the rule so reopening keeps them
        _sugState.rule.seedExamples = { ..._sugState.tags };
        rulesRenderSuggestModal();
      } catch (e) {
        toast(e.message || 'Suggest failed', true, 3000);
      }
    }
    else if (act === 'back') {
      _sugState.results = null;
      _sugState.picked = { positive: new Set(), negative: new Set() };
      rulesRenderSuggestModal();
    }
    else if (act === 'addMust' || act === 'addAlso' || act === 'addNot') {
      const bucket = act === 'addMust' ? 'must' : (act === 'addAlso' ? 'also' : 'not');
      const picks = [
        ..._sugState.picked.positive,
        ...(bucket === 'not' ? _sugState.picked.negative : []),
      ];
      if (!picks.length) { toast('No chips picked — click some first', true, 2000); return; }
      const targetRule = _sugState.rule;        // grab ref before we null _sugState
      rulesAddTerm(targetRule, bucket, picks.join(','));
      toast(`Added ${picks.length} term${picks.length === 1 ? '' : 's'} to ${bucket.toUpperCase()}.`, false, 2000);
      _sugState = null;
      overlay.remove();
      renderRules();
      rulesScheduleCount(targetRule);
    }
  });

  // Chip pick handlers (on results screen)
  overlay.querySelectorAll('.sug-chip').forEach(chip => chip.addEventListener('click', () => {
    const term = chip.dataset.sugTerm;
    const cls  = chip.dataset.sugClass;
    const set = cls === 'pos' ? _sugState.picked.positive : _sugState.picked.negative;
    if (set.has(term)) { set.delete(term); chip.classList.remove('picked'); if (cls === 'neg') chip.classList.remove('neg'); }
    else { set.add(term); chip.classList.add('picked'); if (cls === 'neg') chip.classList.add('neg'); }
  }));
}

/* ------------- Starter templates (seeded good-enough terms) ------------- */
const RULES_STARTER_TEMPLATES = [
  {
    id: 'rule_of_law',
    name: 'Rule of law',
    rules: [
      { id: '', name: 'Judicial independence', must: ['judiciary','judicial','court*'], also: ['independen*','impartial','"separation of powers"'], not: [] },
      { id: '', name: 'Access to justice', must: ['access*'], also: ['justice','court*','"legal aid"','remedy'], not: [] },
      { id: '', name: 'Due process', must: ['"due process"','"fair trial"','"fair hearing"'], also: [], not: [] },
      { id: '', name: 'Anti-corruption', must: ['corrupt*','"anti-corruption"','bribery'], also: [], not: [] },
      { id: '', name: 'Transitional justice', must: ['"transitional justice"','reparations','"truth commission"'], also: [], not: [] },
    ],
  },
  {
    id: 'gender_equality',
    name: 'Gender equality & SGBV',
    rules: [
      { id: '', name: 'Gender-based violence', must: ['"gender-based violence"','"sexual violence"','femicide','"domestic violence"'], also: [], not: [] },
      { id: '', name: 'Equal participation', must: ['women','gender'], also: ['participation','representation','quota*'], not: [] },
      { id: '', name: 'Reproductive rights', must: ['reproductive','"sexual health"','abortion','contraception'], also: [], not: [] },
      { id: '', name: 'Discriminatory laws', must: ['discriminat*'], also: ['law*','legislation','statute*'], not: [] },
    ],
  },
  {
    id: 'civic_space',
    name: 'Civic space',
    rules: [
      { id: '', name: 'Freedom of expression', must: ['"freedom of expression"','"free speech"','press'], also: [], not: [] },
      { id: '', name: 'Freedom of assembly', must: ['"freedom of assembly"','"peaceful assembly"','protest*'], also: [], not: [] },
      { id: '', name: 'Freedom of association', must: ['"freedom of association"','"civil society"','NGO*'], also: [], not: [] },
      { id: '', name: 'Human rights defenders', must: ['"human rights defender*"','"human rights activist*"','HRD*'], also: [], not: [] },
    ],
  },
  {
    id: 'detention',
    name: 'Detention & torture',
    rules: [
      { id: '', name: 'Torture & ill-treatment', must: ['torture','"ill-treatment"','"cruel"','"inhuman"','"degrading"'], also: [], not: [] },
      { id: '', name: 'Arbitrary detention', must: ['detention','detain*','"deprivation of liberty"'], also: ['arbitrary','unlawful','incommunicado'], not: [] },
      { id: '', name: 'Prison conditions', must: ['prison','detention'], also: ['overcrowd*','conditions','facilit*'], not: [] },
      { id: '', name: 'Death penalty', must: ['"death penalty"','execution','"capital punishment"'], also: [], not: [] },
    ],
  },
];
