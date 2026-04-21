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
  const push = (kind, label, value, remove) => chips.push({ kind, label, value, remove });

  if (f.kw && f.kw.trim()) push('kw', 'Q', f.kw, () => { f.kw = ''; $('#kwInput').value = ''; });

  for (const c of f.country) push('country', 'Country', c, () => f.country.delete(c));
  for (const b of f.body)    push('body',    'Body',    b, () => f.body.delete(b));
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
  if (!chips.length) { bar.classList.remove('on'); bar.innerHTML = ''; return; }
  bar.classList.add('on');
  const COLLAPSE_AT = 6;
  const expanded = !!state._afExpanded;
  const shown = (expanded || chips.length <= COLLAPSE_AT) ? chips : chips.slice(0, COLLAPSE_AT);
  const hidden = chips.length - shown.length;
  const chipHtml = (c, i) => `
    <span class="af-chip kind-${c.kind}">
      <span class="k">${sanitize(c.label)}</span>
      <span class="v" title="${sanitize(c.value)}">${sanitize(c.value)}</span>
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
    refreshFacetUI(chips[i].kind === 'group' ? 'group'
                 : chips[i].kind === 'kw' || chips[i].kind === 'year' ? null
                 : chips[i].kind);
    if (chips[i].kind === 'kw') $('#tabSearch').textContent = '—';
    if (chips[i].kind === 'country') state.hexRegion = 'world';
    onFiltersChanged();
  }));
  $('#afMore')?.addEventListener('click', () => { state._afExpanded = true; renderActiveFilters(); });
  $('#afLess')?.addEventListener('click', () => { state._afExpanded = false; renderActiveFilters(); });
  $('#afClearAll').addEventListener('click', () => $('#clearFilters').click());
}

/* ---------- Filter-changed pipeline ---------- */
const debouncedHit = debounce(() => refreshHitCount(), 200);
const debouncedRefresh = debounce(() => refreshCurrentView(), 650);
function onFiltersChanged() {
  renderActiveFilters();
  debouncedHit();
  debouncedRefresh();
  _pushUrlState();
  _announceHit();
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
async function refreshHitCount() {
  const el = $('#filterResult');
  el.classList.add('fr-loading');
  try {
    const r = await api.recordsCount(state.filters);
    state.totalHits = r.total_records;
    $('#hitCount').textContent = fmt(r.total_records);
    const totalAll = state.facets?.total_records || 267537;
    const p = r.total_records / totalAll;
    $('#hitBar').style.width = (p * 100) + '%';
    $('#hitPct').textContent = pct(p);
    el.classList.remove('fr-loading');
    renderKwSyns(r.search_expansions || []);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.warn('hit count failed', err);
    el.classList.remove('fr-loading');
  }
}
