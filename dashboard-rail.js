/* UHRI Dashboard — left rail (facets, body/mechanism grouping, keyword input)
 *
 * The rail is the main filter surface: country / body / theme / group / SDG
 * facets + year range + keyword. This module also owns the mechanism-family
 * taxonomy (TREATY_BODY_ACRONYMS + classifyBody) because the same code that
 * groups bodies in the rail's body-facet dropdown also groups them for the
 * Overview mechanism tiles (FIG.00) and the Mechanism profile scope picker.
 *
 * LOAD ORDER
 *   Runs AFTER helpers/data/route/offline/utils and BEFORE the inline
 *   <script>. Other modules (profiles, timeline, utils, reader, filters)
 *   reach back into classifyBody / renderMechTiles / _computeMechCounts
 *   / bodiesInFamily / _openFamilyListDrawer / renderKwSyns / the profile
 *   dropdown helpers — all via lazy forward-ref lookup.
 *
 *   (a) Top-level from earlier modules:
 *         $, $$, fmt, debounce                  (helpers)
 *         cleanCountryList, sanitize            (helpers)
 *         _sdgToggleFilter                      (helpers)
 *         state                                 (data)
 *
 *   (b) Lazy from later / inline (safe under forward-ref):
 *         bindYearSlider                        (dashboard-years.js)
 *         openListDrawer                        (dashboard-drawer-list.js)
 *         onFiltersChanged                      (dashboard-filters.js)
 *         renderGroup                           (dashboard-profiles.js)
 *         navigate, toast, refreshFacetUI        (inline spine)
 *
 * EXTERNAL SURFACE (what other modules and inline reach into here)
 *   Rail construction       buildRail, buildFacetList,
 *                            buildBodyFacetGrouped
 *   Keyword input           bindKwInput, renderKwSyns
 *   Mechanism family        classifyBody, aggregateMechanismCounts,
 *                            renderMechTiles, bodiesInFamily,
 *                            _computeMechCounts, _openFamilyListDrawer
 *   Profile dropdowns       _dropdownOptionsWithCount,
 *                            _bodyDropdownGroupedOptions,
 *                            _bodyTotalsFromAnalytics
 *   Shared constants        TREATY_BODY_ACRONYMS
 */

/* Render the synonym-expansion chip row under the keyword input.
   Each chip reads like "woman → women". No-op if input is empty; hidden
   when there are no expansions. Safe to call with null/undefined. */
function renderKwSyns(expansions) {
  const el = $('#kwSyns'); if (!el) return;
  const kw = (state.filters?.kw || '').trim();
  const list = Array.isArray(expansions) ? expansions : [];
  if (!kw || !list.length) {
    el.classList.remove('on');
    el.innerHTML = '';
    return;
  }
  const chips = list.map(x => {
    const term = sanitize(String(x.term || ''));
    const also = sanitize(String(x.also || ''));
    return `<span class="chip" title="Your search was auto-expanded to also match the plural/singular form"><strong>${term}</strong> <span class="arrow">→</span> ${also}</span>`;
  }).join('');
  el.innerHTML = `<span class="lbl">Also matching:</span>${chips}`;
  el.classList.add('on');
}

/* =========================================================================
   RAIL
   ========================================================================= */
function buildRail(facets, analytics) {
  // --- COUNTRY --- all countries, searchable in-facet
  const countries = cleanCountryList(facets.countries || []).sort();
  buildFacetList('country', countries.map(c => ({ key:c, label:c })), 'country');
  $('#n-country').textContent = countries.length;

  // --- BODY --- grouped by mechanism family (UPR / Treaty Bodies / Special
  // Procedures) with quick-select chips at the top. Flat list below keeps
  // per-body checkboxes so users can still fine-tune.
  const bodies = (facets.bodies || []).filter(b => b && b !== '-').map(b => b.replace(/^-\s*/,''));
  buildBodyFacetGrouped(bodies);
  $('#n-body').textContent = bodies.length;

  // --- THEME --- (from analytics.themes.theme_counts)
  const themes = (analytics?.themes?.theme_counts || []).map(t => ({
    key: t.theme, label: t.theme, count: t.count
  }));
  buildFacetList('theme', themes, 'theme');
  $('#n-theme').textContent = themes.length;

  // --- GROUP (affected_persons) ---
  const groups = (analytics?.text?.affected_person_counts || []).map(g => ({
    key: g.affected_person, label: g.affected_person, count: g.count
  }));
  buildFacetList('group', groups, 'group');
  $('#n-group').textContent = groups.length;

  // --- REGION ---
  const regions = (facets.regions || []).map(r => ({ key: r, label: r }));
  buildFacetList('region', regions, 'region');
  $('#n-region').textContent = regions.length;

  // --- SDG --- (1–17 grid; sum target counts per goal for the tooltip totals)
  const sdgCountsByN = {};
  (analytics?.text?.sdg_counts || []).forEach(s => {
    const m = String(s.sdg||'').match(/(\d+)/);
    if (m) sdgCountsByN[+m[1]] = (sdgCountsByN[+m[1]] || 0) + (s.count || 0);
  });
  const sdgEl = $('#f-sdg');
  sdgEl.innerHTML = Array.from({length:17},(_,i)=>i+1).map(n => {
    const c = sdgCountsByN[n];
    const name = SDG_NAMES[n] || '';
    const tip = `SDG ${n}${name?' — '+name:''}${c?' ('+fmt(c)+' recs across targets)':''}`;
    return `<div class="sdg-cell" data-k="${n}" title="${sanitize(tip)}">${n}</div>`;
  }).join('');
  sdgEl.querySelectorAll('.sdg-cell').forEach(c => c.addEventListener('click', () => {
    const k = Number(c.dataset.k);
    _sdgToggleFilter(k);
    c.classList.toggle('on');
    onFiltersChanged();
  }));

  // --- TYPE ---
  const types = (facets.types || []).filter(t => t && t !== '-').map(t => t.replace(/^-\s*/,''));
  const cleanTypes = types.filter(t => !/^[a-f0-9-]{30,}$/.test(t));  // drop UUIDs
  buildFacetList('type', cleanTypes.map(t => ({ key:t, label:t })), 'type');

  // --- YEAR SLIDER ---
  const minY = facets.min_year || 2006;
  const maxY = facets.max_year || 2026;
  if (state.filters.yearA == null) state.filters.yearA = minY;
  if (state.filters.yearB == null) state.filters.yearB = maxY;
  $('#yrAL').textContent = state.filters.yearA;
  $('#yrBL').textContent = state.filters.yearB;
  $('#yrA').textContent = minY;
  $('#yrB').textContent = maxY;
  $('#ysTicks').innerHTML = Array.from({length: maxY-minY+1},()=>`<span></span>`).join('');
  bindYearSlider(minY, maxY);

  // --- Match-mode toggles ---
  $$('#themeMatch button').forEach(b => b.addEventListener('click', () => {
    state.filters.themesMatch = b.dataset.m;
    $$('#themeMatch button').forEach(x => x.classList.toggle('on', x.dataset.m === b.dataset.m));
    onFiltersChanged();
  }));
  $$('#groupMatch button').forEach(b => b.addEventListener('click', () => {
    state.filters.groupsMatch = b.dataset.m;
    $$('#groupMatch button').forEach(x => x.classList.toggle('on', x.dataset.m === b.dataset.m));
    onFiltersChanged();
  }));

  // Facet collapse toggles (clicking head)
  $$('.facet-head').forEach(h => h.addEventListener('click', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    h.parentElement.classList.toggle('collapsed');
  }));
}

function buildFacetList(facetKey, items, stateKey) {
  const el = $('#f-' + facetKey);
  // NOTE: do *not* capture state.filters[stateKey] in a closure — the command
  // palette's body action (and saved-views load) reassign
  // `state.filters.body = new Set(...)` which orphans the captured reference
  // so subsequent rail clicks would mutate a ghost Set that nothing reads.
  // Read state.filters[stateKey] live on every click/render instead.
  const currentSet = () => state.filters[stateKey];
  const withSearch = items.length > 15;
  const searchHtml = withSearch
    ? `<input class="facet-filter" type="search" placeholder="filter ${items.length}…" data-for="${facetKey}" />`
    : '';
  const initialSet = currentSet();
  const listHtml = items.map(it => {
    const on = initialSet.has(it.key) ? 'on' : '';
    return `<div class="opt ${on}" data-k="${sanitize(it.key)}" data-search="${sanitize(String(it.label||'').toLowerCase())}">
      <span class="box"></span>
      <span class="txt" title="${sanitize(it.label)}">${sanitize(it.label)}</span>
      ${it.count != null ? `<span class="n">${fmt(it.count)}</span>` : ''}
    </div>`;
  }).join('');
  el.innerHTML = searchHtml + listHtml;
  el.querySelectorAll('.opt').forEach(o => o.addEventListener('click', (ev) => {
    const k = o.dataset.k;
    // Shift-click on certain facets opens that entity's profile instead of
    // toggling the filter. Keeps "click to narrow" as the default, offers
    // "Shift-click to zoom in" for power users.
    if (ev.shiftKey) {
      if (facetKey === 'body')    { state.focusMechanism = k; $('#tabMechanism').textContent = k; navigate('mechanism'); return; }
      if (facetKey === 'country') { state.focusCountry = NAME_TO_ISO[k] || k; $('#tabCountry').textContent = k; navigate('country'); return; }
      if (facetKey === 'theme')   { state.focusTheme = k; $('#tabTheme').textContent = k; navigate('theme'); return; }
      if (facetKey === 'group')   { state.focusGroup = k; $('#tabGroup').textContent = k; navigate('group'); return; }
    }
    const set = currentSet();  // read live, survives reassignment
    if (set.has(k)) set.delete(k); else set.add(k);
    o.classList.toggle('on');
    // When a country filter changes, snap hex map to World view so the
    // highlighted country is always visible in its continental context.
    if (facetKey === 'country') state.hexRegion = 'world';
    onFiltersChanged();
  }));
  const input = el.querySelector('.facet-filter');
  if (input) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      el.querySelectorAll('.opt').forEach(o => {
        const match = !q || o.dataset.search.includes(q);
        o.style.display = match ? '' : 'none';
      });
    });
    // Prevent facet-head collapse when clicking search
    input.addEventListener('click', e => e.stopPropagation());
  }
}

/* =========================================================================
   BODY FACET — grouped by mechanism family
   =========================================================================
   UN Human Rights mechanisms split naturally into three families that the
   OHCHR itself surfaces as one-click groups in UHRI.org:

     * UPR                — Universal Periodic Review (1 body)
     * Treaty Bodies      — 10-12 Committees with acronyms like CRC, CAT…
     * Special Procedures — ~60 Rapporteurs / Working Groups / Independent
                            Experts. Data-derived: any body starting with
                            "SR ", "WG ", "IE ", or containing "Special
                            Rapporteur" / "Working Group" / "Independent
                            Expert" in its name. */
const TREATY_BODY_ACRONYMS = new Set([
  'CAT', 'CCPR', 'CED', 'CEDAW', 'CERD', 'CESCR',
  'CMW', 'CRC', 'CRC-OP-AC', 'CRC-OP-SC', 'CRPD', 'SPT',
]);

function classifyBody(name) {
  const s = String(name || '').trim();
  if (!s) return 'other';
  if (s === 'UPR') return 'upr';
  if (TREATY_BODY_ACRONYMS.has(s)) return 'treaty';
  if (/^(SR|WG|IE)\s/.test(s)) return 'sp';
  if (/Special Rapporteur|Working Group|Independent Expert/i.test(s)) return 'sp';
  return 'other';
}

/* ---------- MECHANISM FAMILY HELPERS ----------
   MECH_FAMILIES taxonomy moved to dashboard-helpers.js. */

/* Aggregate body-level counts into {upr,treaty,sp,other} totals.
   Pass either:
    - analytics.trends.body_year_totals (object: body → count)
    - analytics.themes.body_counts (array: [{body, count}])
    - a Map/array produced elsewhere
   Returns { upr, treaty, sp, other } as numbers. */
function aggregateMechanismCounts(source) {
  const totals = { upr: 0, treaty: 0, sp: 0, other: 0 };
  if (!source) return totals;
  let pairs = [];
  if (Array.isArray(source)) {
    pairs = source.map(x => [x.body || x.name || x.key, +(x.count || x.v || x.total || 0)]);
  } else if (typeof source === 'object') {
    pairs = Object.entries(source).map(([k, v]) => {
      if (v && typeof v === 'object') {
        // Nested year-maps: sum values
        return [k, Object.values(v).reduce((a,b) => a + (+b||0), 0)];
      }
      return [k, +(v||0)];
    });
  }
  for (const [body, n] of pairs) {
    const k = classifyBody(String(body || '').replace(/^-\s*/, ''));
    totals[k] += Number.isFinite(n) ? n : 0;
  }
  return totals;
}

/* Render three clickable mechanism tiles. Used by both the Overview
   KPI strip and the drawer at-a-glance panel. `mode` controls layout:
    - 'full'    — 3-column grid with counts + description
    - 'compact' — single-column stack, count-first (drawer)
   `onClick(familyKey)` fires when a tile is activated. */
function renderMechTiles(container, counts, { mode = 'full', onClick = null } = {}) {
  if (!container) return;
  const tiles = MECH_FAMILIES.map(f => {
    const n = counts[f.key] || 0;
    const pct = counts._total ? Math.round(100 * n / counts._total) : null;
    return `
      <button class="mech-tile ${f.cls}" data-family="${f.key}" aria-label="${f.full} — ${n} records">
        <div class="mt-family">${f.label}</div>
        <div class="mt-name">${f.full}</div>
        <div class="mt-count">${fmt(n)}${pct !== null ? ` <span class="mt-sub" style="display:inline;font-size:11px;margin-left:4px">${pct}%</span>` : ''}</div>
        ${mode === 'full' ? `<div class="mt-desc">${f.desc}</div>` : ''}
      </button>`;
  }).join('');
  container.className = 'mech-tiles' + (mode === 'compact' ? ' compact' : '');
  container.innerHTML = tiles;
  if (onClick) {
    container.querySelectorAll('.mech-tile').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        onClick(el.dataset.family, e);
      });
    });
  }
}

/* Given a family key ('upr' | 'treaty' | 'sp'), return the list of
   body names belonging to that family drawn from the current facet
   list. Used when opening a drawer list scoped to a whole family. */
function bodiesInFamily(familyKey) {
  const bodies = state.facets?.bodies || [];
  return bodies
    .filter(b => b && b !== '-')
    .map(b => String(b).replace(/^-\s*/, ''))
    .filter(b => classifyBody(b) === familyKey);
}

/* Compute current mechanism-family counts from cached analytics. Looks
   at the most reliable source first (yearly body totals summed) and
   falls back to body_counts array. Returns { upr, treaty, sp, other,
   _total } or null if no analytics are loaded yet. */
function _computeMechCounts() {
  const a = state.analytics;
  if (!a) return null;
  // Prefer the yearly-body totals (richest shape the backend provides).
  let src = a.trends?.yearly_body_counts || a.trends?.body_year_totals;
  if (!src) src = a.bodies?.body_counts || a.body_counts;
  const totals = aggregateMechanismCounts(src);
  totals._total = totals.upr + totals.treaty + totals.sp + totals.other;
  if (totals._total === 0) return null;
  return totals;
}

/* Open a drawer-list scoped to all recommendations from a whole
   mechanism family. Uses the existing openListDrawer plumbing but
   passes a body-Set override with every body classified as `familyKey`
   so the drawer shows the union. */
function _openFamilyListDrawer(familyKey) {
  const fam = MECH_FAMILIES.find(f => f.key === familyKey);
  if (!fam) return;
  const bodies = bodiesInFamily(familyKey);
  if (!bodies.length) { toast(`No ${fam.full} bodies in current dataset`, true, 2000); return; }
  // Use the `body` kind with the family label as the value so the drawer
  // list header reads nicely ("Treaty Bodies"), and pass the body-Set
  // override so the actual filter covers every body in that family.
  openListDrawer('body', fam.full, { body: new Set(bodies) });
}

/* ---------- Profile dropdown helpers (Q3a+b) ----------
   Shared renderers for the `Switch <entity>` dropdowns in Theme,
   Concerned-groups and SDG profiles. Reproduces the SDG-profile
   pattern (every option annotated with its record count) for the
   other three so the user can pick Kenya over Chad because Kenya
   has 312 records vs Chad's 64 without guessing. For bodies the
   dropdown also gets <optgroup> family headers — UPR at the top,
   then Treaty Bodies, then Special Procedures — so UPR no longer
   sorts alphabetically between SR-entries. */
function _dropdownOptionsWithCount(entities, selected, countsByKey) {
  return entities.map(name => {
    const c = countsByKey ? countsByKey[name] : null;
    const tail = (c != null && c >= 0) ? ` · ${fmt(c)}` : '';
    return `<option value="${sanitize(name)}" ${name===selected?'selected':''}>${sanitize(name)}${tail}</option>`;
  }).join('');
}

function _bodyDropdownGroupedOptions(bodies, selected, countsByKey) {
  // Partition by family, sort alphabetically within each, emit optgroups
  // in a stable narrative order: UPR → Treaty Bodies → Special Procedures
  // → Other (should be empty in a clean dataset but keep the escape hatch).
  const buckets = { upr: [], treaty: [], sp: [], other: [] };
  bodies.forEach(b => buckets[classifyBody(b)].push(b));
  Object.keys(buckets).forEach(k => buckets[k].sort((a,b) => a.localeCompare(b)));
  const renderGroup = (label, bs) => {
    if (!bs.length) return '';
    return `<optgroup label="${label}">${_dropdownOptionsWithCount(bs, selected, countsByKey)}</optgroup>`;
  };
  return [
    renderGroup('Universal Periodic Review', buckets.upr),
    renderGroup('Treaty Bodies', buckets.treaty),
    renderGroup('Special Procedures', buckets.sp),
    renderGroup('Other', buckets.other),
  ].join('');
}

/* Build a body→total-count map from cached analytics. Used when the
   body dropdown options render — so each option shows "CCPR · 1,136". */
function _bodyTotalsFromAnalytics() {
  const a = state.analytics;
  const src = a?.trends?.yearly_body_counts || a?.trends?.body_year_totals || [];
  const out = {};
  if (Array.isArray(src)) {
    src.forEach(row => {
      const b = String(row.body || '').replace(/^-\s*/, '');
      if (b) out[b] = (out[b] || 0) + Number(row.count || 0);
    });
  } else if (src && typeof src === 'object') {
    Object.entries(src).forEach(([body, yearMap]) => {
      const b = String(body || '').replace(/^-\s*/, '');
      if (!b || !yearMap) return;
      const total = Object.values(yearMap).reduce((a, v) => a + (+v || 0), 0);
      out[b] = (out[b] || 0) + total;
    });
  }
  return out;
}

function buildBodyFacetGrouped(bodies) {
  const el = $('#f-body');
  const currentSet = () => state.filters.body;

  // Partition bodies into groups and sort each group
  const groups = { upr: [], treaty: [], sp: [], other: [] };
  bodies.forEach(b => groups[classifyBody(b)].push(b));
  groups.treaty.sort();                              // alphabetical
  groups.sp.sort((a, b) => a.localeCompare(b));      // alphabetical
  groups.other.sort();

  const chipsHtml = `
    <div class="body-chips">
      <button class="bc" data-grp="upr"    title="Add UPR to the selection">+ UPR</button>
      <button class="bc" data-grp="treaty" title="Add every Treaty Body Committee">+ All Treaty Bodies</button>
      <button class="bc" data-grp="sp"     title="Add every Special Procedure mandate">+ All Special Procedures</button>
      <button class="bc bc-clear" data-grp="clear" title="Clear the body filter">× Clear</button>
    </div>
    <div class="body-chips-hint">Chips ADD to current selection · Shift+click = REPLACE selection</div>
  `;

  const searchHtml = `<input class="facet-filter" type="search" placeholder="filter ${bodies.length}…" data-for="body" />`;

  const renderOpt = (b) => {
    const on = currentSet().has(b) ? 'on' : '';
    return `<div class="opt ${on}" data-k="${sanitize(b)}" data-search="${sanitize(b.toLowerCase())}">
      <span class="box"></span>
      <span class="txt" title="${sanitize(b)}">${sanitize(b)}</span>
    </div>`;
  };

  const section = (title, members) => members.length
    ? `<div class="facet-group-hdr" data-search="${sanitize(title.toLowerCase())}">${sanitize(title)} <span class="cnt">(${members.length})</span></div>
       ${members.map(renderOpt).join('')}`
    : '';

  el.innerHTML = chipsHtml + searchHtml
    + section('UPR', groups.upr)
    + section('Treaty bodies', groups.treaty)
    + section('Special procedures', groups.sp)
    + section('Other', groups.other);

  // Chip behaviour
  const chipAdd = (ev, groupKey) => {
    const set = currentSet();
    const replace = ev.shiftKey;
    if (groupKey === 'clear') {
      state.filters.body = new Set();
    } else {
      const members = groups[groupKey] || [];
      if (replace) state.filters.body = new Set(members);
      else members.forEach(m => set.add(m));
    }
    refreshFacetUI('body');
    onFiltersChanged();
  };
  el.querySelectorAll('.bc').forEach(chip => chip.addEventListener('click', (ev) => {
    ev.stopPropagation();
    chipAdd(ev, chip.dataset.grp);
  }));

  // Per-option click — same contract as buildFacetList (shift = open profile)
  el.querySelectorAll('.opt').forEach(o => o.addEventListener('click', (ev) => {
    const k = o.dataset.k;
    if (ev.shiftKey) {
      state.focusMechanism = k;
      $('#tabMechanism').textContent = k;
      navigate('mechanism');
      return;
    }
    const set = currentSet();
    if (set.has(k)) set.delete(k); else set.add(k);
    o.classList.toggle('on');
    onFiltersChanged();
  }));

  // Typeahead filter — also hide group header when no member is visible
  const input = el.querySelector('.facet-filter');
  if (input) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      // First, show/hide individual options
      const visibleByHeader = {};
      let currentHeader = null;
      el.querySelectorAll('.facet-group-hdr, .opt').forEach(node => {
        if (node.classList.contains('facet-group-hdr')) {
          currentHeader = node;
          visibleByHeader[currentHeader] = 0;
        } else {
          const match = !q || node.dataset.search.includes(q);
          node.style.display = match ? '' : 'none';
          if (match && currentHeader) visibleByHeader[currentHeader] = (visibleByHeader[currentHeader] || 0) + 1;
        }
      });
      // Hide group headers with zero visible members
      Object.entries(visibleByHeader).forEach(([hdrNode, n]) => {
        // hdrNode is a string key here because object keys are strings — use the stored DOM reference
      });
      el.querySelectorAll('.facet-group-hdr').forEach(hdr => {
        let sibling = hdr.nextElementSibling;
        let hasVisible = false;
        while (sibling && !sibling.classList.contains('facet-group-hdr')) {
          if (sibling.classList.contains('opt') && sibling.style.display !== 'none') { hasVisible = true; break; }
          sibling = sibling.nextElementSibling;
        }
        hdr.style.display = hasVisible ? '' : 'none';
      });
    });
    input.addEventListener('click', e => e.stopPropagation());
  }
}

/* Year slider + histogram moved to dashboard-years.js. */

/* ---------- Keyword input ---------- */
const debouncedKw = debounce(() => onFiltersChanged(), 350);
function bindKwInput() {
  // Query-syntax examples — show/hide on click
  const kwHintMore = $('#kwHintMore');
  const kwExamples = $('#kwExamples');
  if (kwHintMore && kwExamples) {
    kwHintMore.addEventListener('click', (e) => {
      e.preventDefault();
      const open = kwExamples.style.display === 'block';
      kwExamples.style.display = open ? 'none' : 'block';
      kwHintMore.textContent = open ? 'examples ▾' : 'hide examples ▴';
    });
  }

  $('#kwInput').addEventListener('input', e => {
    state.filters.kw = e.target.value;
    $('#tabSearch').textContent = e.target.value.trim() || '—';
    debouncedKw();
  });
  $('#kwInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      $('#tabSearch').textContent = state.filters.kw || '—';
      navigate('search');
    }
  });
}

/* Active-filter strip + hit-count pipeline moved to dashboard-filters.js. */

