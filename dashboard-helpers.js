/* UHRI Dashboard — shared pure helpers
 *
 * Loaded FIRST, before dashboard-data.js / -route.js / -offline.js / -utils.js.
 * Everything here is either stateless or uses state.* lazily (inside a function
 * body / as a default parameter) — so it is safe to define before state itself
 * is created in dashboard-data.js.
 *
 * WHY THIS FILE EXISTS
 * The seam split (data/route/offline/utils) left extracted modules calling
 * helpers that were declared in the inline <script> at the bottom of
 * dashboard.html. That worked at runtime (globals get populated before the
 * first UI interaction) but was fragile — any future move to real ES modules
 * would break the forward-ref. Consolidating the cross-file-referenced
 * helpers into this module makes the load order explicit and lets the rest
 * of the extraction progress without re-auditing forward refs every time.
 *
 * RULES FOR THIS FILE
 *   - No DOM mutation at top level (fine inside function bodies — they run later).
 *   - No reads of `state` / `api` / `offline` at top level.
 *   - Every export attaches to window for cross-file access (implicit via
 *     non-module script tag, so plain `const`/`function` declarations suffice).
 */

/* =========================================================================
   COUNTRY NAME ↔ ISO LOOKUPS
   ========================================================================= */

/* Country name → ISO3 for grid-map layout */
const NAME_TO_ISO = {
  "China":"CHN","Mexico":"MEX","Iran (Islamic Republic of)":"IRN","Colombia":"COL",
  "Russian Federation":"RUS","Brazil":"BRA","Türkiye":"TUR","India":"IND",
  "United States of America":"USA","Indonesia":"IDN","Egypt":"EGY","Philippines":"PHL",
  "Nigeria":"NGA","Pakistan":"PAK","Ukraine":"UKR","Myanmar":"MMR",
  "Venezuela (Bolivarian Republic of)":"VEN","Kenya":"KEN","Saudi Arabia":"SAU",
  "Ethiopia":"ETH","Argentina":"ARG","Algeria":"DZA","Viet Nam":"VNM",
  "Bangladesh":"BGD","Thailand":"THA","South Africa":"ZAF","Poland":"POL",
  "Iraq":"IRQ","Hungary":"HUN","Guatemala":"GTM","Peru":"PER","Spain":"ESP",
  "Italy":"ITA","France":"FRA","United Kingdom of Great Britain and Northern Ireland":"GBR",
  "Germany":"DEU","Sri Lanka":"LKA","Nepal":"NPL","Uzbekistan":"UZB",
  "Kazakhstan":"KAZ","Belarus":"BLR","Sudan":"SDN","Syrian Arab Republic":"SYR",
  "Yemen":"YEM","Libya":"LBY","Afghanistan":"AFG","Cameroon":"CMR",
  "Ghana":"GHA","Uganda":"UGA","United Republic of Tanzania":"TZA",
  "Morocco":"MAR","Tunisia":"TUN","Jordan":"JOR","Lebanon":"LBN",
  "Israel":"ISR","Georgia":"GEO","Azerbaijan":"AZE","Armenia":"ARM",
  "Romania":"ROU","Serbia":"SRB","Croatia":"HRV","Bulgaria":"BGR",
  "Greece":"GRC","Portugal":"PRT","Netherlands":"NLD","Belgium":"BEL",
  "Sweden":"SWE","Norway":"NOR","Finland":"FIN","Denmark":"DNK",
  "Ireland":"IRL","Austria":"AUT","Switzerland":"CHE","Czechia":"CZE",
  "Slovakia":"SVK","Slovenia":"SVN","Estonia":"EST","Latvia":"LVA",
  "Lithuania":"LTU","Canada":"CAN","Australia":"AUS","New Zealand":"NZL",
  "Japan":"JPN","Republic of Korea":"KOR",
  "Democratic People's Republic of Korea":"PRK",
  "Bolivia (Plurinational State of)":"BOL","Ecuador":"ECU","Chile":"CHL",
  "Cuba":"CUB","Dominican Republic":"DOM","Honduras":"HND","Nicaragua":"NIC",
  "El Salvador":"SLV","Costa Rica":"CRI","Panama":"PAN","Paraguay":"PRY",
  "Uruguay":"URY","Jamaica":"JAM","Haiti":"HTI","Lao People's Democratic Republic":"LAO",
  "Cambodia":"KHM","Malaysia":"MYS","Mongolia":"MNG","Singapore":"SGP",
  "Democratic Republic of the Congo":"COD","Rwanda":"RWA","Burundi":"BDI",
  "Zimbabwe":"ZWE","Zambia":"ZMB","Angola":"AGO","Mozambique":"MOZ",
  "Madagascar":"MDG","Senegal":"SEN","Mali":"MLI","Mauritania":"MRT",
  "Somalia":"SOM","South Sudan":"SSD","Eritrea":"ERI",
  "Niger":"NER","Burkina Faso":"BFA","Togo":"TGO","Benin":"BEN",
  "Côte d'Ivoire":"CIV","Guinea":"GIN","Liberia":"LBR","Sierra Leone":"SLE",
  "Turkmenistan":"TKM","Tajikistan":"TJK","Kyrgyzstan":"KGZ",
  "Bhutan":"BTN","Maldives":"MDV","Brunei Darussalam":"BRN","Fiji":"FJI",
};
const ISO_TO_NAME = Object.fromEntries(Object.entries(NAME_TO_ISO).map(([n,i])=>[i,n]));

/* 22×12 grid layout (ported from mockup) */
const MAP_LAYOUT = {
  CAN:[4,2], USA:[5,4], MEX:[5,5], GTM:[5,6], CUB:[6,5], HTI:[6,5], DOM:[6,5], JAM:[5,5],
  COL:[6,7], VEN:[7,7], PER:[6,8], BRA:[7,8], ARG:[7,9], CHL:[6,9], BOL:[7,8], ECU:[6,7],
  PRY:[7,9], URY:[7,9],
  GBR:[10,3], IRL:[9,3], FRA:[10,4], ESP:[9,4], PRT:[9,5], ITA:[11,4], DEU:[11,3],
  CHE:[10,4], AUT:[11,4], NLD:[10,3], BEL:[10,3], NOR:[11,2], SWE:[12,2], FIN:[12,2],
  DNK:[11,3], POL:[12,3], CZE:[11,3], SVK:[12,3], HUN:[12,4], ROU:[13,4], BGR:[13,4],
  GRC:[12,5], SVN:[11,4], HRV:[12,4], SRB:[12,4], EST:[12,2], LVA:[12,2], LTU:[12,3],
  UKR:[13,3], BLR:[13,2], RUS:[15,2], GEO:[14,4], AZE:[14,4], ARM:[14,4],
  TUR:[13,5], SYR:[14,5], LBN:[13,5], ISR:[13,5], JOR:[14,5], IRQ:[14,5], IRN:[15,5],
  SAU:[14,6], YEM:[14,6],
  MAR:[10,6], DZA:[11,6], TUN:[11,5], LBY:[12,6], EGY:[13,6], SDN:[13,7], SSD:[13,7],
  NGA:[11,8], ETH:[13,8], KEN:[14,8], UGA:[13,8], TZA:[13,9], ZAF:[12,10], CMR:[12,8],
  GHA:[10,8], CIV:[10,8], SEN:[9,7], MLI:[10,7], BFA:[10,8], NER:[11,7], MRT:[9,7],
  SOM:[14,8], RWA:[13,9], BDI:[13,9], ZMB:[12,10], ZWE:[13,10], MOZ:[13,10], AGO:[12,10],
  MDG:[14,10], LBR:[10,8], SLE:[10,8], GIN:[9,8], BEN:[11,8], TGO:[11,8], ERI:[14,7],
  PAK:[16,5], AFG:[16,5], IND:[17,6], NPL:[17,5], BGD:[18,6], LKA:[17,7], CHN:[18,4],
  JPN:[20,4], KOR:[19,4], PRK:[19,4], VNM:[19,6], THA:[18,6], PHL:[20,6], IDN:[19,7],
  MMR:[18,6], KAZ:[16,3], UZB:[16,4], TKM:[15,4], TJK:[16,4], KGZ:[17,4], MNG:[18,3],
  KHM:[18,6], MYS:[19,7], SGP:[19,7], BTN:[18,5], MDV:[17,7], BRN:[19,7],
  AUS:[20,9], NZL:[21,10], FJI:[21,9],
};

/* =========================================================================
   CORE DOM / STRING HELPERS
   ========================================================================= */

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
const fmt = n => (n==null||isNaN(n)) ? '—' : n.toLocaleString('en-US');
const pct = n => (n*100).toFixed(1).replace(/\.0$/,'')+'%';
const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function cleanCountryList(names) {
  // Filter out 2-letter codes / garbage
  return names.filter(n => n && n.length > 2 && !/^[A-Z]{2}$/.test(n));
}
function sanitize(s) { return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

/* =========================================================================
   LABEL CLEANERS — API data carries "- " prefixes and UUIDs in several
   fields. Strip them consistently wherever the value reaches the UI.
   ========================================================================= */

function cleanLabel(s) {
  // Strip leading "- " (dashes + whitespace)
  return (s == null ? '' : String(s)).replace(/^[-\s]+/, '').trim();
}
function cleanAnnotationType(s) {
  const v = cleanLabel(s);
  // If it looks like a UUID, hide it — we don't have a human label yet
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)) return '—';
  return v || '—';
}
/* Infer the annotation type from the record itself when AnnotationType is a
   UUID (~67% of recent imports carry UUIDs instead of human labels). Uses
   (1) the raw text's UN-diplomatic verbs and (2) SectionHeadings hints. */
const _TYPE_CACHE = new Map();
function inferAnnotationType(rec) {
  if (!rec) return '—';
  const existing = cleanAnnotationType(rec.AnnotationType);
  if (existing && existing !== '—') return existing;
  const id = rec.AnnotationId || '';
  if (id && _TYPE_CACHE.has(id)) return _TYPE_CACHE.get(id);
  const txt = String(rec.TextPlainCleaned || rec.Text || '').slice(0, 400).toLowerCase();
  const heads = (rec.SectionHeadings || []).join(' ').toLowerCase();
  let label = 'Other';
  if (/\brecommend(s|ations?)\b|\burges\b|\bcalls upon\b|\brequests the state/i.test(txt) ||
      /recommend/i.test(heads)) {
    label = 'Recommendations';
  } else if (/\b(notes|observes|regrets|expresses (deep )?concern|is concerned|acknowledges|welcomes|takes note)\b/i.test(txt) ||
             /concern|observation|positive/i.test(heads)) {
    label = 'Observations';
  }
  if (id) _TYPE_CACHE.set(id, label);
  return label;
}
/* Normalize 2-letter ISO codes that leak into the Countries field as if
   they were separate countries. Maps PK → Pakistan, CZ → Czechia, etc. */
/* Every bare code the live facets carry, each of which has a full-name twin
   in the corpus. CU/CY/RS/SI/UZ were missing, so those five stayed unfolded
   on both sides: the record kept the code and the filter could not reach it.
   Kept in step with pipeline/normalize_metadata.py, which folds the same set
   in the data — this map is the display-side safety net for anything that
   slips through a future import. */
const ISO2_TO_NAME = {
  AU:'Australia', CA:'Canada', CO:'Colombia', CU:'Cuba', CY:'Cyprus',
  CZ:'Czechia', ES:'Spain', ET:'Ethiopia', GH:'Ghana', ID:'Indonesia',
  IQ:'Iraq', MV:'Maldives', MY:'Malaysia', PK:'Pakistan', RS:'Serbia',
  SG:'Singapore', SI:'Slovenia', SV:'El Salvador', UZ:'Uzbekistan', WS:'Samoa',
};
function cleanCountryName(s) {
  /* Normalises a country name from the API or upload to the form our
     lookups (NAME_TO_ISO / HEX_LAYOUT canonical names) key on.  Two
     transforms:
       * 2-letter stray ISOs ("PK", "CZ") → full name via ISO2_TO_NAME —
         the OHCHR facets payload occasionally carries these alongside
         their proper-named twins; without this fold they'd each end up
         as separate "countries" with a few records apiece.
       * Trailing OHCHR observer-state asterisk (e.g. "State of
         Palestine*", "Kosovo*") → stripped.  HEX_LAYOUT stores these
         without the decorator; leaving it on would make the lookup miss
         and drop the country from the hex map colouring. */
  let v = (s==null?'':String(s)).trim().replace(/\*+\s*$/, '').trim();
  if (ISO2_TO_NAME[v]) return ISO2_TO_NAME[v];
  return v;
}

/* =========================================================================
   FILTER FACTORY — used rarely, only when a call genuinely wants the whole
   dataset (sparklines, preload). Profile views use _scopedFilter so rail
   filters intersect with the focused entity.
   ========================================================================= */

function emptyFilters() {
  return {
    kw: '', country: new Set(), body: new Set(), theme: new Set(), group: new Set(),
    region: new Set(), sdg: new Set(), sdgExact: new Set(), type: new Set(), yearA: null, yearB: null,
    themesMatch: 'any', groupsMatch: 'any',
    // Preserve the user's current dataset choice across "clear all" /
    // saved-view loads — raw mode should not silently revert to cleaned
    // just because filters got wiped. Falls back to 'cleaned' on first call
    // before state exists (bootstrap safety).
    dataset: (typeof state !== 'undefined' && state?.filters?.dataset) || 'cleaned',
    // Cleared along with the rest of the filter state — see comment in
    // dashboard-data.js for what this carries.
    activeLabel: null,
  };
}

/* The label rule currently DRIVING the filter, or null.
   `activeLabel` is set by the Labels workspace alongside the compiled FTS5
   it wrote into `kw` (dashboard-labels.js `_applyRuleAsActiveFilter`), but
   several paths overwrite `kw` without clearing the tag — the ⌘K palette
   (dashboard-ui.js) and the drawer-list keyword links among them. Trusting
   the tag alone made the scope banner attribute a live hit count to a rule
   the user is not running. Attribution is only claimed while `kw` is still
   verbatim the rule's compiled query; otherwise callers fall back to
   describing the raw keyword. */
function activeLabelIfLive(f = (typeof state !== 'undefined' ? state?.filters : null)) {
  const lbl = f && f.activeLabel;
  if (!lbl || !lbl.name) return null;
  const kw = (f.kw || '').trim();
  return kw && (lbl.query || '').trim() === kw ? lbl : null;
}

/* True when the current filter state actually narrows the corpus.
   boot() uses it to decide whether an Overview deep link needs its own
   filtered render, and whether the unfiltered baseline analytics may be
   painted into the Overview panels (static audit A-01: a shared
   `#country=Poland` URL used to show world totals under a Poland chip).
   `dataset` is a corpus choice, not a filter, so it is not counted; the
   year bounds count only when they sit inside the dataset's own range,
   because the slider is seeded to min_year/max_year. */
function hasActiveFilters(f = (typeof state !== 'undefined' ? state?.filters : null)) {
  if (!f) return false;
  if ((f.kw || '').trim()) return true;
  for (const k of ['country', 'body', 'theme', 'group', 'region', 'sdg', 'sdgExact', 'type']) {
    if (f[k] && f[k].size) return true;
  }
  const minY = (typeof state !== 'undefined' ? state?.facets?.min_year : null);
  const maxY = (typeof state !== 'undefined' ? state?.facets?.max_year : null);
  if (minY != null && f.yearA != null && f.yearA > minY) return true;
  if (maxY != null && f.yearB != null && f.yearB < maxY) return true;
  return false;
}

/* =========================================================================
   SDG CONSTANTS
   ========================================================================= */

const SDG_NAMES = {
  1:"No poverty", 2:"Zero hunger", 3:"Good health and well-being", 4:"Quality education",
  5:"Gender equality", 6:"Clean water and sanitation", 7:"Affordable and clean energy",
  8:"Decent work and economic growth", 9:"Industry, innovation and infrastructure",
  10:"Reduced inequalities", 11:"Sustainable cities and communities",
  12:"Responsible consumption and production", 13:"Climate action", 14:"Life below water",
  15:"Life on land", 16:"Peace, justice and strong institutions",
  17:"Partnerships for the goals",
};

/* SDG target names — granular sub-goals (UN 2030 Agenda). Subset focused on
   human-rights-relevant targets; falls back to goal name when target unknown. */
const SDG_TARGET_NAMES = {
  "1.1":"Eradicate extreme poverty","1.2":"Reduce poverty in all dimensions","1.3":"Implement social protection systems",
  "1.4":"Equal rights to economic resources","1.5":"Build resilience of the poor","1.a":"Resources for poverty eradication","1.b":"Pro-poor policy frameworks",
  "2.1":"End hunger, access to safe food","2.2":"End all forms of malnutrition","2.3":"Double agricultural productivity of smallholders",
  "3.1":"Reduce maternal mortality","3.2":"End preventable deaths of newborns & children","3.3":"End AIDS, TB, malaria, tropical diseases",
  "3.4":"Reduce premature mortality from non-communicable diseases","3.5":"Substance abuse prevention","3.6":"Halve road traffic deaths",
  "3.7":"Universal access to sexual & reproductive healthcare","3.8":"Universal health coverage","3.9":"Reduce deaths from pollution & contamination",
  "3.a":"Strengthen FCTC implementation","3.b":"Affordable medicines & vaccines","3.c":"Health workforce","3.d":"Health-risk early warning",
  "4.1":"Free, equitable, quality primary & secondary education","4.2":"Quality early-childhood development","4.3":"Affordable technical, vocational & tertiary education",
  "4.4":"Increase youth & adult skills for employment","4.5":"Eliminate gender disparities in education","4.6":"Universal literacy & numeracy",
  "4.7":"Education for sustainable development & global citizenship","4.a":"Safe, inclusive education facilities","4.b":"Scholarships for developing countries","4.c":"Qualified teachers",
  "5.1":"End discrimination against women & girls","5.2":"Eliminate violence against women","5.3":"Eliminate harmful practices (FGM, child marriage)",
  "5.4":"Recognise unpaid care & domestic work","5.5":"Women's full participation in leadership","5.6":"Universal access to reproductive health & rights",
  "5.a":"Equal rights to economic resources","5.b":"Enhance women's use of ICT","5.c":"Gender-equality policies & legislation",
  "6.1":"Safe & affordable drinking water","6.2":"Adequate sanitation & hygiene","6.3":"Water quality & pollution reduction",
  "6.4":"Water-use efficiency","6.5":"Integrated water-resources management","6.6":"Water-related ecosystems","6.a":"Water-related capacity-building","6.b":"Community water management",
  "7.1":"Universal access to modern energy","7.2":"Renewable energy share","7.3":"Energy efficiency","7.a":"Clean-energy research","7.b":"Clean-energy infrastructure",
  "8.1":"Sustain per-capita economic growth","8.2":"Productivity through diversification","8.3":"Formalisation & growth of MSMEs",
  "8.4":"Resource efficiency in consumption & production","8.5":"Full & productive employment, equal pay","8.6":"Reduce youth NEET rate",
  "8.7":"End forced labour, modern slavery, child labour","8.8":"Labour rights & safe workplaces (migrants, women)",
  "8.9":"Sustainable tourism","8.10":"Access to financial services","8.a":"Aid for Trade","8.b":"Youth-employment strategy",
  "9.1":"Resilient infrastructure","9.2":"Inclusive industrialisation","9.3":"Small-enterprise access to finance",
  "9.4":"Upgrade infrastructure with clean tech","9.5":"R&D capacity","9.a":"Sustainable infrastructure in LDCs","9.b":"Domestic technology development","9.c":"ICT access",
  "10.1":"Grow income of bottom 40%","10.2":"Social, economic & political inclusion","10.3":"Equal opportunity & end discriminatory laws",
  "10.4":"Fiscal, wage & social policies for equality","10.5":"Regulation of global financial markets","10.6":"Developing countries' voice in global institutions",
  "10.7":"Orderly, safe, regular migration","10.a":"Special treatment for developing countries","10.b":"ODA to states in greatest need","10.c":"Reduce remittance costs",
  "11.1":"Safe & affordable housing","11.2":"Safe, affordable transport","11.3":"Inclusive & sustainable urbanization",
  "11.4":"Protect cultural & natural heritage","11.5":"Reduce disaster deaths & economic losses","11.6":"Environmental impact of cities","11.7":"Safe, inclusive public spaces",
  "12.1":"10-year framework for sustainable consumption","12.2":"Sustainable management of natural resources","12.3":"Halve per-capita food waste",
  "12.4":"Environmentally sound chemicals management","12.5":"Reduce waste via recycle & reuse","12.6":"Sustainability reporting in companies",
  "13.1":"Climate resilience & adaptive capacity","13.2":"Integrate climate measures into policy","13.3":"Climate education & awareness",
  "14.1":"Reduce marine pollution","14.2":"Protect marine & coastal ecosystems","14.3":"Minimize ocean acidification",
  "14.4":"Regulate harvesting, end overfishing","14.5":"Conserve coastal & marine areas","14.6":"Prohibit harmful fisheries subsidies","14.7":"Benefits to SIDS & LDCs",
  "15.1":"Conserve terrestrial & freshwater ecosystems","15.2":"End deforestation","15.3":"Combat desertification",
  "15.4":"Conserve mountain ecosystems","15.5":"Halt biodiversity loss","15.6":"Genetic-resource access & benefit-sharing","15.7":"End poaching & trafficking of protected species",
  "15.8":"Prevent invasive alien species","15.9":"Biodiversity in planning & accounts",
  "16.1":"Reduce all forms of violence","16.2":"End abuse, exploitation, trafficking of children","16.3":"Promote the rule of law, equal access to justice",
  "16.4":"Reduce illicit financial & arms flows","16.5":"Reduce corruption & bribery","16.6":"Effective, accountable & transparent institutions",
  "16.7":"Responsive, inclusive, participatory decision-making","16.8":"Developing countries' participation in global governance",
  "16.9":"Legal identity for all (incl. birth registration)","16.10":"Public access to information & fundamental freedoms",
  "16.a":"Strengthen national institutions to prevent violence","16.b":"Promote non-discriminatory laws & policies",
  "17.1":"Domestic-resource mobilization","17.2":"Fulfil ODA commitments","17.3":"Additional financial resources for developing countries",
  "17.9":"Capacity-building for SDG implementation","17.14":"Policy coherence for sustainable development","17.16":"Global Partnership for Sustainable Development",
  "17.17":"Public, public-private & civil-society partnerships","17.18":"Capacity for high-quality data","17.19":"Measurements of progress beyond GDP",
};

function formatSdgLabel(sdgStr) {
  if (!sdgStr) return '';
  const s = String(sdgStr).trim();
  // Support "SDG 16.3", "16.3", "16.b", "SDG 16", "16"
  const m = s.match(/(\d+)(?:\.(\w+))?/);
  if (!m) return s;
  const goal = +m[1];
  const target = m[2];
  const goalName = SDG_NAMES[goal];
  if (target) {
    const tkey = goal + '.' + target;
    const tName = SDG_TARGET_NAMES[tkey];
    if (tName) return `SDG ${tkey} — ${tName}`;
    return `SDG ${tkey}${goalName ? ' · ' + goalName : ''}`;
  }
  return `SDG ${goal}${goalName ? ' — ' + goalName : ''}`;
}

/* =========================================================================
   SDG FILTER HELPERS — resolve numeric goals vs. exact target strings
   ("SDG 16.3") against state.filters. All use lazy state.* refs so they are
   safe to define here (before state exists).
   ========================================================================= */

/* SDG rows in row-lists pass the stored label ("16.3 - Promote…"). The rail
   filter expects a numeric goal. Returns null if we can't parse — caller
   should skip the toggle rather than poisoning state.filters.sdg. */
function _sdgToFilterValue(label) {
  const m = String(label || '').match(/^\s*(?:SDG\s*)?(\d{1,2})/i);
  return m ? Number(m[1]) : null;
}

function _sdgTargetKey(label) {
  const m = String(label || '').match(/^\s*(?:SDG\s*)?(\d{1,2}(?:\.\d+)+)/i);
  return m ? m[1] : '';
}

function _sdgCanonicalExactValue(rawValue) {
  const raw = String(rawValue || '').trim();
  const target = _sdgTargetKey(raw);
  return target ? `SDG ${target}` : raw;
}

function _sdgExactValues(f = state.filters) {
  return [...new Set([...(f?.sdgExact || [])].map(_sdgCanonicalExactValue).filter(Boolean))];
}

function _sdgParamValues(f = state.filters) {
  return [
    [...(f?.sdg || [])].map(n => `SDG ${n}`),
    _sdgExactValues(f),
  ].flat();
}

function _hasSdgFilters(f = state.filters) {
  return !!((f?.sdg && f.sdg.size) || _sdgExactValues(f).length);
}

function _sdgMatchesExactFilter(selected, candidate) {
  const candidateNorm = String(candidate || '').trim().toLowerCase();
  const candidateTarget = _sdgTargetKey(candidate);
  return selected.some(value => {
    const norm = String(value || '').trim().toLowerCase();
    if (norm && norm === candidateNorm) return true;
    const target = _sdgTargetKey(value);
    return !!(target && candidateTarget && target === candidateTarget);
  });
}

function _recordMatchesSdgFilters(recordSdgs, f = state.filters) {
  const values = (recordSdgs || []).map(v => String(v || '').trim()).filter(Boolean);
  if (!_hasSdgFilters(f)) return true;
  if (f?.sdg?.size) {
    const numeric = values.map(_sdgToFilterValue).filter(v => v != null);
    if (numeric.some(n => f.sdg.has(n))) return true;
  }
  const exact = _sdgExactValues(f);
  if (exact.length && values.some(v => _sdgMatchesExactFilter(exact, v))) return true;
  return false;
}

function _sdgToggleFilter(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return false;
  const target = _sdgTargetKey(raw);
  if (target) {
    const canonical = _sdgCanonicalExactValue(raw);
    const exact = new Set(_sdgExactValues());
    if (exact.has(canonical)) exact.delete(canonical); else exact.add(canonical);
    state.filters.sdgExact = exact;
    return true;
  }
  const n = _sdgToFilterValue(raw);
  if (n == null) return false;
  if (state.filters.sdg.has(n)) state.filters.sdg.delete(n); else state.filters.sdg.add(n);
  return true;
}

function _sdgOverrideForValue(rawValue) {
  const raw = String(rawValue || '').trim();
  const target = _sdgTargetKey(raw);
  if (target) {
    const canonical = _sdgCanonicalExactValue(raw);
    return { sdg: new Set(), sdgExact: canonical ? new Set([canonical]) : new Set() };
  }
  const n = _sdgToFilterValue(raw);
  return { sdg: n == null ? new Set() : new Set([n]), sdgExact: new Set() };
}

/* =========================================================================
   MECHANISM FAMILIES TAXONOMY
   Single source of truth for:
     - the (key, label, css-class) triple
     - pretty labels + one-liner descriptions for the tile UI
     - body-list → family → total-count aggregation
   ========================================================================= */
const MECH_FAMILIES = [
  { key: 'upr',    cls: 'upr', label: 'UPR',
    full: 'Universal Periodic Review',
    desc: 'Peer review of every UN State every ~4.5 years — recommendations from one State to another.' },
  { key: 'treaty', cls: 'tb',  label: 'Treaty Bodies',
    full: 'Treaty Bodies',
    desc: 'Independent expert committees (CCPR, CEDAW, CAT…) reviewing compliance with the 10 core UN human-rights treaties — plus the SPT, the OPCAT torture-prevention subcommittee.' },
  { key: 'sp',     cls: 'sp',  label: 'Special Procedures',
    full: 'Special Procedures',
    desc: 'Special Rapporteurs, Working Groups, and Independent Experts on thematic or country-specific mandates.' },
];
