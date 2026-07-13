/* UHRI Dashboard — active filters + hit-count pipeline
 *
 * Extracted from dashboard.html as a low-risk seam split. Owns the rail
 * feedback layer: active-filter chips, live hit count, debounced view
 * refresh, and the slow-load banner shown while analytics recompute.
 */

/* ---------- Active-filter chip strip (#1) ---------- */
function renderActiveFilters() {
  const f = state.filters;
  const chips = [];
  const push = (kind, label, value, remove, opts) => chips.push({ kind, label, value, remove, ...(opts || {}) });

  /* Keyword chip — branches on whether the keyword came from a label
     rule (📊 Analyze / 🔎 Search on a rule card). Label-driven kw shows
     the label NAME with the FTS5 in the tooltip, instead of leaking the
     compiled query into the visible chip text. */
  if (f.kw && f.kw.trim()) {
    if (f.activeLabel && f.activeLabel.name) {
      push('label', '🏷', f.activeLabel.name,
        () => { f.kw = ''; f.activeLabel = null; const inp = $('#kwInput'); if (inp) { inp.value = ''; delete inp.dataset.fromLabel; } },
        { tooltip: f.kw });
    } else {
      push('kw', 'Q', f.kw,
        () => { f.kw = ''; f.activeLabel = null; $('#kwInput').value = ''; });
    }
  }

  for (const c of f.country) push('country', 'Country', c, () => f.country.delete(c));
  const bodyFamilies = mechanismFamilySelectionInfo();
  bodyFamilies.families.forEach(fam => {
    push('body', 'Mechanism', fam.full, () => fam.members.forEach(body => f.body.delete(body)));
  });
  for (const b of f.body) {
    if (!bodyFamilies.consumed.has(b)) push('body', 'Body', b, () => f.body.delete(b));
  }
  for (const t of f.theme)   push('theme',   'Theme',   t, () => f.theme.delete(t));
  for (const g of f.group)   push('group',   'Group',   g, () => f.group.delete(g));
  for (const r of f.region)  push('region',  'Region',  r, () => f.region.delete(r));
  for (const s of f.sdg)     push('sdg',     'SDG',     'SDG ' + s, () => f.sdg.delete(s));
  for (const s of _sdgExactValues(f)) push('sdg', 'SDG', formatSdgLabel(s), () => f.sdgExact.delete(s));
  for (const t of f.type)    push('type',    'Type',    t, () => f.type.delete(t));

  const minY = state.facets?.min_year;
  const maxY = state.facets?.max_year;
  if ((minY && f.yearA > minY) || (maxY && f.yearB < maxY)) {
    push('year', 'Years', `${f.yearA}–${f.yearB}`,
      () => { f.yearA = minY; f.yearB = maxY; if (typeof window._syncYearSlider === 'function') window._syncYearSlider(); });
  }

  const bar = $('#activeFilters');
  syncMechanismTileSelection();
  if (!chips.length) { bar.classList.remove('on'); bar.innerHTML = ''; return; }
  bar.classList.add('on');
  const COLLAPSE_AT = 6;
  const expanded = !!state._afExpanded;
  const shown = (expanded || chips.length <= COLLAPSE_AT) ? chips : chips.slice(0, COLLAPSE_AT);
  const hidden = chips.length - shown.length;
  const chipHtml = (c, i) => `
    <span class="af-chip kind-${c.kind}">
      <span class="k">${sanitize(c.label)}</span>
      <span class="v" title="${sanitize(c.tooltip || c.value)}">${sanitize(c.value)}</span>
      <button class="x" data-i="${i}" aria-label="Remove filter">×</button>
    </span>`;
  bar.innerHTML =
    '<span class="af-label">filtering</span>' +
    shown.map(chipHtml).join('') +
    (hidden > 0 ? `<button class="af-more" id="afMore">…+${hidden} more</button>` : '') +
    (expanded && chips.length > COLLAPSE_AT ? `<button class="af-more" id="afLess">show less</button>` : '') +
    '<button class="af-clear" id="afClearAll">clear all ×</button>';

  bar.querySelectorAll('.af-chip .x').forEach(btn => btn.addEventListener('click', () => {
    const i = Number(btn.dataset.i);
    chips[i].remove();
    const k = chips[i].kind;
    refreshFacetUI(k === 'group' ? 'group'
                 : (k === 'kw' || k === 'label' || k === 'year') ? null
                 : k);
    if (k === 'kw' || k === 'label') $('#tabSearch').textContent = '—';
    if (k === 'country') state.hexRegion = 'world';
    onFiltersChanged();
  }));
  $('#afMore')?.addEventListener('click', () => { state._afExpanded = true; renderActiveFilters(); });
  $('#afLess')?.addEventListener('click', () => { state._afExpanded = false; renderActiveFilters(); });
  $('#afClearAll').addEventListener('click', () => $('#clearFilters').click());
}

/* ---------- Scope banner (#3) ---------- */
/* Visible above the active-filter strip whenever the user has applied a
   label rule via 📊 Analyze / 🔎 Search. Carries the label name + live
   record count so it's obvious "you are now scoped to label X" — without
   this, the only signal that a label is active is a chip with a long
   FTS5 string, which scientists routinely overlook. */
function renderScopeBanner() {
  const el = $('#scopeBanner');
  if (!el) return;
  const f = state.filters;
  const lbl = f.activeLabel;
  if (!lbl || !f.kw) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const total = state.facets?.total_records || 267942;
  const hits = state.totalHits;
  const hitsTxt = (hits == null) ? '…' : fmt(hits);
  const pctTxt = (hits == null) ? '' : `(${pct(hits / total)})`;
  el.hidden = false;
  el.innerHTML = `
    <span class="sb-icon" aria-hidden="true">🏷</span>
    <div class="sb-text">
      <span class="sb-lead">Filtering by label</span>
      <strong class="sb-name" title="${sanitize(f.kw)}">${sanitize(lbl.name)}</strong>
      <span class="sb-count">${hitsTxt} of ${fmt(total)} records ${pctTxt}</span>
    </div>
    <div class="sb-actions">
      <a href="#" id="scopeBannerEdit" title="Open the Labels workspace to refine this rule">edit rule →</a>
      <button id="scopeBannerClear" type="button" aria-label="Remove label filter">× remove</button>
    </div>`;
  $('#scopeBannerEdit')?.addEventListener('click', e => {
    e.preventDefault();
    if (typeof navigate === 'function') navigate('labels');
  });
  $('#scopeBannerClear')?.addEventListener('click', () => {
    f.kw = '';
    f.activeLabel = null;
    const inp = $('#kwInput'); if (inp) { inp.value = ''; delete inp.dataset.fromLabel; }
    $('#tabSearch').textContent = '—';
    onFiltersChanged();
  });
}

/* ---------- Filter-changed pipeline ---------- */
const debouncedHit = debounce(() => refreshHitCount(), 200);
const debouncedRefresh = debounce(() => refreshCurrentView(), 650);
function onFiltersChanged() {
  renderActiveFilters();
  renderScopeBanner();
  debouncedHit();
  debouncedRefresh();
  _pushUrlState();
  _announceHit();
  // Keep the prominent main-column search mirror in sync with programmatic
  // kw clears/restores (clear-all, seKwClear, share-link). Guarded no-op when
  // the bar isn't present; in-app typing is already covered by its own listener.
  window._syncMainSearch?.();
}

async function refreshCurrentView() {
  _slowLoadSchedule();
  try {
    if (state.view === 'overview') await renderOverview({ keepPrevious: true });
    else if (state.view === 'search') await renderSearch();
    else if (state.view === 'country') await renderCountry();
    else if (state.view === 'theme')   await renderTheme();
    else if (state.view === 'group')   await renderGroup();
    else if (state.view === 'sdg')     await renderSDG();
    else if (state.view === 'mechanism') await renderMechanism();
    else if (state.view === 'compare') await renderCompare();
  } finally {
    _slowLoadClear();
  }
}

/* ---------- Slow-load banner ---------- */
let _slowLoadTimer = null;
function _slowLoadSchedule() {
  _slowLoadClear();
  _slowLoadTimer = setTimeout(() => {
    _slowLoadShow();
  }, 2000);
}
function _slowLoadClear() {
  if (_slowLoadTimer) { clearTimeout(_slowLoadTimer); _slowLoadTimer = null; }
  document.getElementById('slowLoadBanner')?.remove();
}
function _slowLoadShow() {
  let el = document.getElementById('slowLoadBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'slowLoadBanner';
    el.className = 'slow-load-banner';
    document.body.appendChild(el);
  }
  const hits = state.totalHits != null ? fmt(state.totalHits) : '…';
  el.innerHTML = `
    <div class="sl-left">
      <div class="sl-spinner"></div>
      <div class="sl-text">
        <div class="sl-title">Building analytics for ${hits} records</div>
        <div class="sl-sub">This filter hasn't been computed before — first hit takes ~10–15 s. Next hit will be instant.</div>
      </div>
    </div>
    <button class="sl-export" id="slowLoadExport" title="Skip the render and download the matching records as .xlsx">↓ Download .xlsx while we wait</button>
    <button class="sl-close" id="slowLoadClose" title="Dismiss">×</button>`;
  document.getElementById('slowLoadClose').addEventListener('click', _slowLoadClear);
  document.getElementById('slowLoadExport').addEventListener('click', () => {
    const p = buildParams(state.filters);
    const url = API_BASE + '/api/data/export?' + p.toString();
    window.open(url, '_blank');
    toast('Download started (check the browser download tray).', false, 2400);
  });
}

const _announceHit = debounce(() => {
  const n = state.totalHits;
  if (n != null && state.facets) {
    announce(`${fmt(n)} of ${fmt(state.facets.total_records)} records match current filters`);
  }
}, 800);

/* ---------- HIT COUNT ---------- */
let _hitGen = 0;
async function refreshHitCount() {
  // Generation guard: only the newest call may paint. Without it a slow
  // filtered response can land after a faster (or cached) cleared one and
  // overwrite the fresh count with stale numbers.
  const gen = ++_hitGen;
  const el = $('#filterResult');
  el.classList.add('fr-loading');
  try {
    const r = await api.recordsCount(state.filters);
    if (gen !== _hitGen) return;
    state.totalHits = r.total_records;
    $('#hitCount').textContent = fmt(r.total_records);
    const totalAll = state.facets?.total_records || 267942;
    const p = r.total_records / totalAll;
    $('#hitBar').style.width = (p * 100) + '%';
    $('#hitPct').textContent = pct(p);
    el.classList.remove('fr-loading');
    renderKwSyns(r.search_expansions || []);
    /* Re-render scope banner so its count refreshes once the hit-count
       request comes back (initial render uses old / undefined hits). */
    renderScopeBanner();
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (gen !== _hitGen) return;   // stale failure — newest call owns the UI
    console.warn('hit count failed', err);
    state.totalHits = null;
    $('#hitCount').textContent = '—';
    $('#hitBar').style.width = '0%';
    $('#hitPct').textContent = 'count unavailable';
    el.classList.remove('fr-loading');
  }
}
