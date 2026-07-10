/* UHRI Dashboard — drawer list mode
 *
 * Extracted from dashboard.html as a medium-size seam. Owns the drawer's
 * list-mode flows: list opening, selection drawer, infinite scroll, and
 * drawer-list export.
 */

let _drListObserver = null;
let _drListDocumentClick = null;

async function openListDrawer(kind, value, extraOverride = null) {
  // kind: 'theme' | 'group' | 'country' | 'body' | 'sdg' | 'selection'
  //
  // extraOverride: optional filter bag (e.g. { country: new Set(['China']) })
  // merged on top of the normal {kind,value} override by listDrawerFilter.
  // Used by Compare so clicking "A: Themes → trafficking" scopes the drawer
  // list to Country A, not the whole rail.
  state.drawerMode = 'list';
  state.drawerList = { kind, value, records: [], page: 1, exhausted: false, total: 0, extraOverride };
  if (!TW.drawer) { TW.drawer = true; applyTweaks(); }
  renderDrawer();
  if (kind !== 'selection') await loadMoreListDrawer();
}
const _LIST_KIND_LABEL = {
  theme: 'THEME', group: 'CONCERNED GROUP', country: 'COUNTRY',
  body: 'RECOMMENDING BODY', sdg: 'SDG',
  selection: '★ YOUR SELECTION',
  rule: '🏷 LABEL RULE',
};
/* Selection drawer mode — shows records the user has ticked in Search as
   a reviewable list in the drawer. Doesn't fetch from API (records are
   already loaded in `state.searchLoaded`), just pulls them by AnnotationId. */
function openSelectionDrawer() {
  const sel = state.searchSelection || new Set();
  if (!sel.size) return;
  const recs = (state.searchLoaded || []).filter(r => sel.has(r.AnnotationId));
  state.drawerMode = 'list';
  state.drawerList = {
    kind: 'selection',
    value: sel.size === 1 ? 'one record' : sel.size + ' records',
    records: recs,
    page: 1,
    exhausted: true,
    total: recs.length,
    source: 'selection',
  };
  state.currentResultList = recs;
  state.currentResultSource = 'selection';
  if (!TW.drawer) { TW.drawer = true; applyTweaks(); }
  renderDrawer();
}
/* Refresh the selection drawer when the selection changes (add/remove).
   No-op if the drawer isn't currently showing the selection. */
function refreshSelectionDrawer() {
  if (state.drawerMode === 'list' && state.drawerList?.kind === 'selection') {
    openSelectionDrawer();
  }
}

/* SDG helpers (_sdgToFilterValue, _sdgTargetKey, _sdgCanonicalExactValue,
   _sdgExactValues, _sdgParamValues, _hasSdgFilters, _sdgMatchesExactFilter,
   _recordMatchesSdgFilters, _sdgToggleFilter, _sdgOverrideForValue) moved to
   dashboard-helpers.js. _replaceSdgFilters stays here — it mutates state. */

function _replaceSdgFilters(rawValue) {
  const next = _sdgOverrideForValue(rawValue);
  state.filters.sdg = next.sdg;
  state.filters.sdgExact = next.sdgExact;
}

function listDrawerFilter() {
  // Drawer list ("All records with this theme/body/SDG/group/country")
  // respects the rail so counts line up with Overview. The drawer's own
  // facet is layered on top. extraOverride (e.g. Compare's country scope)
  // is merged last and wins on collisions.
  const { kind, value, extraOverride } = state.drawerList || {};
  const override = {};
  if (kind === 'theme')   override.theme   = new Set([value]);
  else if (kind === 'group')   override.group   = new Set([value]);
  else if (kind === 'country') override.country = new Set([value]);
  else if (kind === 'body')    override.body    = new Set([value]);
  else if (kind === 'rule') {
    // Label rule drawer — extraOverride carries {kw: compiledFts5, ruleName}.
    // Overwrites rail kw (same as rulesFetchCount) so the drawer list
    // matches exactly the count badge the user clicked on.
  }
  else if (kind === 'sdg') {
    Object.assign(override, _sdgOverrideForValue(value));
  }
  if (extraOverride && typeof extraOverride === 'object') {
    Object.assign(override, extraOverride);
  }
  return _scopedFilter(override);
}

async function loadMoreListDrawer() {
  const ctx = state.drawerList;
  if (!ctx || ctx.exhausted) return;
  // Concurrency guard (fix 2026-04-24 for duplicate-row bug).
  // Before this guard, openListDrawer did `await loadMoreListDrawer()`
  // to fetch the first page.  renderDrawer() then drew the sentinel
  // at the top of an empty list (no records yet), and the freshly-
  // attached IntersectionObserver saw the sentinel intersecting and
  // fired its own loadMoreListDrawer() call — before the awaited one
  // had finished.  Two concurrent calls both fetched page=1, both
  // pushed identical records, and ctx.records ended with [rec, rec]
  // (→ "1 matching records · showing 2" in the drawer head, with a
  // duplicate card rendered).  The `_loading` flag short-circuits
  // the racing second caller; ctx.exhausted handles subsequent pages
  // as before.
  if (ctx._loading) return;
  ctx._loading = true;
  const pageSize = 30;
  try {
    const r = await api.records(listDrawerFilter(), ctx.page, pageSize, { scope: 'drawerList' });
    ctx.total = r.total_records;
    const newRecs = r.records || [];
    ctx.records.push(...newRecs);
    const totalPages = Math.max(1, Math.ceil(ctx.total / pageSize));
    if (ctx.page >= totalPages || !newRecs.length) ctx.exhausted = true;
    ctx.page++;
    // Currently-visible list → used by j/k navigation
    state.currentResultList = ctx.records;
    state.currentResultSource = 'drawer-list';
    renderDrawer();
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('drawer-list load failed', err);
  } finally {
    ctx._loading = false;
  }
}

function closeListDrawer() {
  state.drawerMode = 'record';
  state.drawerList = null;
  if (_drListObserver) { _drListObserver.disconnect(); _drListObserver = null; }
  renderDrawer();
}

function renderDrawerListMode() {
  const el = $('#drawerBody');
  const ctx = state.drawerList;
  if (!ctx) { state.drawerMode = 'record'; return renderDrawer(); }
  const kindLabel = _LIST_KIND_LABEL[ctx.kind] || ctx.kind.toUpperCase();
  // For rule-kind drawer, highlight the rule's FTS5 query (via
  // extraOverride.kw) instead of the rail kw — matches what FTS5
  // actually matched. Other drawer kinds fall back to rail kw.
  const kw = (ctx.kind === 'rule'
    ? (ctx.extraOverride?.kw || '')
    : (state.filters.kw || '')).trim();
  const cards = ctx.records.map((r, i) => {
    const yr = (r.PublicationDate||'').slice(0,4);
    const country = cleanCountryName((r.Countries||[])[0]||'');
    const body = cleanLabel(r.Body || '');
    const fullTxt = r.TextPlainCleaned || r.Text || '';
    const themes = (r.Themes||[]).slice(0,3);
    const starred = bmHas(r.AnnotationId);
    const isLong = fullTxt.length > 420;
    const kwCount = kw ? countMatches(fullTxt, kw) : 0;
    return `<div class="dr-list-card" data-idx="${i}" data-id="${sanitize(r.AnnotationId||'')}" role="article" aria-label="${sanitize(yr)} ${sanitize(country)} ${sanitize(body)}">
      <div class="meta">
        <span class="yr">${sanitize(yr)}</span>
        <span>·</span><span>${sanitize(country)}</span>
        <span>·</span><span>${sanitize(body)}</span>
        ${kwCount ? `<span style="color:var(--accent);font-weight:700" title="${kwCount} keyword match${kwCount!==1?'es':''}">${kwCount}× "${sanitize(kw)}"</span>` : ''}
        ${noteHas(r.AnnotationId) ? '<span class="note-mark" title="You have a note on this record">📝</span>' : ''}
        ${starred ? '<span class="star" title="Bookmarked">★</span>' : ''}
      </div>
      <div class="tx">${highlightKeyword(fullTxt, kw)}</div>
      ${isLong ? `<button class="more-btn" data-more="${i}">↓ Show full text (${fullTxt.length.toLocaleString()} chars)</button>` : ''}
      ${themes.length?`<div class="tg">${themes.map(t=>`<span>${sanitize(t)}</span>`).join('')}</div>`:''}
      <div class="actions">
        <button data-act="read" data-idx="${i}" title="Open full reader">📖 Read</button>
        <button data-act="bookmark" data-idx="${i}" title="Toggle bookmark (b)">${starred?'★ Bookmarked':'☆ Bookmark'}</button>
        <button data-act="copy" data-idx="${i}" title="Copy quote with citation">Copy</button>
        <button data-act="pin" data-idx="${i}" class="${diffIsPinned(r.AnnotationId)?'pinned':''}" title="Pin for side-by-side compare">${diffIsPinned(r.AnnotationId)?'📌 Pinned':'📌 Pin'}</button>
        <span class="spacer"></span>
        <span style="font:9px var(--mono);color:var(--dimmer);letter-spacing:.1em">${i+1}/${fmt(ctx.total)}</span>
      </div>
    </div>`;
  }).join('');
  const sentinelHtml = ctx.exhausted
    ? `<div class="dr-list-sentinel" style="color:var(--dimmer)">— end · ${fmt(ctx.total)} total —</div>`
    : `<div class="dr-list-sentinel" id="drListSentinel"><span class="dot"></span>Loading more…</div>`;
  // Breadcrumb: show the rail filters that are ALSO applied on top of
  // ctx.kind=ctx.value. Lets the researcher see exactly why the count is
  // what it is, and click off individual filters without leaving the drawer.
  const railDesc = _activeRailDescription(ctx.kind);
  const breadcrumb = railDesc
    ? `<div class="dr-breadcrumb">
         <span class="lbl">also filtered by</span>
         <span class="val">${sanitize(railDesc)}</span>
         <button data-clear-rail-in-list>clear rail ×</button>
       </div>`
    : '';
  el.innerHTML = `
    <div class="dr-list-head">
      <div class="k">${kindLabel}</div>
      <div class="v">${sanitize(ctx.value)}</div>
      <div class="n">${fmt(ctx.total)} matching records · showing ${fmt(ctx.records.length)}${kw ? ` · keyword "${sanitize(kw)}"` : ''}</div>
      ${breadcrumb}
      <div class="actions">
        ${ctx.kind === 'rule' ? `
          <button class="primary" id="drListAnalyze" title="Apply rule as rail keyword and open Overview (map, timeline, distributions)">📊 Analyze in Overview</button>
          <button id="drListOpenSearch" title="Apply rule as rail keyword and open Search tab (sortable, exportable)">🔎 Open in Search</button>
        ` : `
          <button class="primary" id="drListFilter">+ Narrow view by this ${ctx.kind}</button>
          <button id="drListProfile">Open ${ctx.kind} profile →</button>
        `}
        <div class="exp-picker">
          <button id="drListExport" title="Export the recommendations in this list">📥 Export ▾</button>
          <div class="exp-dropdown" id="drListExportMenu">
            <div class="exp-item" data-exp="md">Markdown (.md) — each record + citation</div>
            <div class="exp-item" data-exp="xlsx">Excel (.xlsx) — flat table with all fields</div>
          </div>
        </div>
        <button id="drListClose">× Close</button>
      </div>
    </div>
    <div class="dr-list-items">${cards}${sentinelHtml}</div>`;

  // Clear the rail's other filters while staying on this drawer list.
  el.querySelector('[data-clear-rail-in-list]')?.addEventListener('click', () => {
    const f = state.filters;
    if (ctx.kind !== 'country') f.country = new Set();
    if (ctx.kind !== 'body')    f.body    = new Set();
    if (ctx.kind !== 'theme')   f.theme   = new Set();
    if (ctx.kind !== 'group')   f.group   = new Set();
    if (ctx.kind !== 'sdg')     f.sdg     = new Set();
    f.region = new Set(); f.type = new Set(); f.kw = '';
    const minY = state.facets?.min_year, maxY = state.facets?.max_year;
    if (minY) f.yearA = minY; if (maxY) f.yearB = maxY;
    if ($('#kwInput')) $('#kwInput').value = '';
    if (typeof window._syncYearSlider === 'function') window._syncYearSlider();
    ['country','body','theme','group','region','type','sdg'].forEach(refreshFacetUI);
    // Re-fetch the drawer list with the relaxed filter
    state.drawerList = { ...ctx, records: [], page: 1, exhausted: false, total: 0 };
    onFiltersChanged();
    loadMoreListDrawer();
  });

  // Card-level: clicking the card body (not a button) just selects it as
  // the reader's "current record" (for j/k nav) and opens the full reader.
  // The expand/action buttons stop propagation so they don't also trigger
  // the reader.
  el.querySelectorAll('.dr-list-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;  // actions handled below
      const idx = +card.dataset.idx;
      const rec = ctx.records[idx];
      state.selectedRec = rec; state.currentResultIndex = idx;
      openReader(rec);
    });
  });
  // "Show full text" toggle — expands the serif text in-place.
  el.querySelectorAll('.dr-list-card .more-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.dr-list-card');
      const expanded = card.classList.toggle('expanded');
      btn.textContent = expanded ? '↑ Collapse' : `↓ Show full text`;
    });
  });
  // Per-card actions — keep them compact so cards stay scannable.
  el.querySelectorAll('.dr-list-card [data-act]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      const rec = ctx.records[idx];
      const act = btn.dataset.act;
      if (act === 'read') {
        state.selectedRec = rec; state.currentResultIndex = idx; openReader(rec);
      } else if (act === 'bookmark') {
        const on = bmToggle(rec);
        btn.textContent = on ? '★ Bookmarked' : '☆ Bookmark';
        toast(on ? 'Bookmarked' : 'Bookmark removed', false, 1400);
      } else if (act === 'copy') {
        const citation = citeAPA(rec);
        const quote = `"${(rec.TextPlainCleaned || rec.Text || '').trim()}"\n\n${citation}`;
        navigator.clipboard.writeText(quote).then(() => toast('Copied with citation', false, 1600));
      } else if (act === 'pin') {
        const outcome = diffPinToggle(rec);
        btn.classList.toggle('pinned', outcome === 'added');
        btn.textContent = outcome === 'added' ? '📌 Pinned' : '📌 Pin';
        toast(outcome === 'added' ? `Pinned ${state.diffPins.length}/2 for compare` : 'Unpinned', false, 1400);
      }
    });
  });

  $('#drListFilter')?.addEventListener('click', () => {
    const { kind, value } = ctx;
    if (kind === 'theme')   { state.filters.theme.add(value);   refreshFacetUI('theme'); }
    else if (kind === 'group')   { state.filters.group.add(value);   refreshFacetUI('group'); }
    else if (kind === 'country') { state.filters.country.add(value); refreshFacetUI('country'); state.hexRegion = 'world'; }
    else if (kind === 'body')    { state.filters.body.add(value);    refreshFacetUI('body'); }
    else if (kind === 'sdg') {
      if (_sdgToggleFilter(value)) refreshFacetUI('sdg');
    }
    onFiltersChanged();
    toast(`Added "${value}" to filter`, false, 2500);
  });
  $('#drListProfile')?.addEventListener('click', () => {
    if (ctx.kind === 'theme') {
      state.focusTheme = ctx.value; $('#tabTheme').textContent = ctx.value; navigate('theme');
    } else if (ctx.kind === 'country') {
      const iso = getHexNameToIso()[ctx.value] || NAME_TO_ISO[ctx.value] || ctx.value;
      state.focusCountry = iso; $('#tabCountry').textContent = ctx.value; navigate('country');
    } else if (ctx.kind === 'group') {
      state.focusGroup = ctx.value; $('#tabGroup').textContent = ctx.value; navigate('group');
    } else if (ctx.kind === 'body') {
      state.focusMechanism = ctx.value; $('#tabMechanism').textContent = ctx.value; navigate('mechanism');
    } else if (ctx.kind === 'sdg') {
      state.focusSdg = ctx.value; const t = $('#tabSdg'); if (t) t.textContent = ctx.value; navigate('sdg');
    }
    closeListDrawer();
  });
  // Rule-kind drawer: jump to Overview or Search with the rule as
  // rail keyword. Mirrors the rule-card's 📊 Analyze / 🔎 Search
  // buttons so users who drilled deep into the drawer can act on the
  // rule without closing + finding the rule card again.
  $('#drListAnalyze')?.addEventListener('click', () => {
    const q = ctx.extraOverride?.kw || '';
    if (!q) { toast('Empty rule', true, 1500); return; }
    state.filters.kw = q;
    if ($('#kwInput')) $('#kwInput').value = q;
    closeListDrawer();
    navigate('overview');
  });
  $('#drListOpenSearch')?.addEventListener('click', () => {
    const q = ctx.extraOverride?.kw || '';
    if (!q) { toast('Empty rule', true, 1500); return; }
    state.filters.kw = q;
    if ($('#kwInput')) $('#kwInput').value = q;
    closeListDrawer();
    navigate('search');
  });
  $('#drListClose')?.addEventListener('click', closeListDrawer);

  // Export menu — Markdown + XLSX of everything loaded so far. If not
  // all pages are loaded yet, warn so researchers know they might want
  // to scroll to the end first (infinite-scroll triggers loadMore).
  const expBtn = $('#drListExport');
  const expMenu = $('#drListExportMenu');
  if (expBtn && expMenu) {
    expBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      expMenu.classList.toggle('on');
    });
    if (_drListDocumentClick) document.removeEventListener('click', _drListDocumentClick);
    _drListDocumentClick = () => expMenu.classList.remove('on');
    document.addEventListener('click', _drListDocumentClick);
    expMenu.querySelectorAll('.exp-item').forEach(it => it.addEventListener('click', async (e) => {
      e.stopPropagation();
      const kind = it.dataset.exp;
      expMenu.classList.remove('on');
      const missing = Math.max(0, (ctx.total || 0) - ctx.records.length);
      if (missing > 0) {
        // OK = load every remaining page first (complete export); Cancel = just
        // the rows already loaded. Prevents silently exporting e.g. 30 of 1,204.
        const loadAll = confirm(`This list has ${fmt(ctx.total)} records but only ${fmt(ctx.records.length)} are loaded.\n\nOK — load all ${fmt(ctx.total)}, then export.\nCancel — export only the ${fmt(ctx.records.length)} loaded so far.`);
        if (loadAll) {
          toast(`Loading all ${fmt(ctx.total)} records…`, false, 4000);
          let guard = 0;
          while (!ctx.exhausted && guard < 500) { await loadMoreListDrawer(); guard++; }
        }
      }
      _exportDrawerList(kind, ctx);
    }));
  }

  // IntersectionObserver on the sentinel for infinite scroll
  const sentinel = $('#drListSentinel');
  if (sentinel) {
    if (_drListObserver) _drListObserver.disconnect();
    _drListObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && !ctx.exhausted) loadMoreListDrawer();
      });
    }, { root: el.parentElement, rootMargin: '120px' });
    _drListObserver.observe(sentinel);
  }
}

/* Export the currently-visible drawer list as Markdown or XLSX.
   Each record includes its APA citation and user note (if any) so the
   export is self-contained — you can drop it into a Word doc or spreadsheet
   and every row carries the info needed to trace back to UHRI. */
async function _exportDrawerList(kind, ctx) {
  const ts = new Date().toISOString().slice(0, 10);
  const safeValue = String(ctx.value || 'all').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const filename = `uhri-${ctx.kind}-${safeValue}-${ts}`;

  if (kind === 'md') {
    const lines = [];
    lines.push(`# ${_LIST_KIND_LABEL[ctx.kind] || ctx.kind} · ${ctx.value}`);
    lines.push('');
    lines.push(`**${ctx.records.length}** of ${ctx.total} matching recommendations · exported ${new Date().toLocaleString()}`);
    const railDesc = _activeRailDescription(ctx.kind);
    if (railDesc) lines.push('', `_Also filtered by: ${railDesc}_`);
    lines.push('\n---\n');
    ctx.records.forEach((r, i) => {
      const yr = (r.PublicationDate || '').slice(0, 10) || 'n.d.';
      const country = cleanCountryName((r.Countries || [])[0] || '');
      const body = cleanLabel(r.Body || '');
      const themes = (r.Themes || []).join(', ');
      const groups = (r.AffectedPersons || []).join(', ');
      const sdgs = (r.Sdgs || []).join(', ');
      const txt = (r.TextPlainCleaned || r.Text || '').trim();
      const note = noteGet(r.AnnotationId || '');
      lines.push(`## ${i + 1}. ${body} — ${country} (${yr.slice(0, 4)})`);
      lines.push('');
      lines.push(`- **Symbol:** ${r.Symbol || '—'}`);
      lines.push(`- **Annotation ID:** ${r.AnnotationId || '—'}`);
      if (themes) lines.push(`- **Themes:** ${themes}`);
      if (groups) lines.push(`- **Concerned groups:** ${groups}`);
      if (sdgs) lines.push(`- **SDGs:** ${sdgs}`);
      lines.push('');
      lines.push('> ' + txt.split('\n').join('\n> '));
      lines.push('');
      if (note) { lines.push('**Your note:**', '', note, ''); }
      lines.push(`*${citeAPA(r)}*`);
      lines.push('\n---\n');
    });
    downloadBlob(lines.join('\n'), 'text/markdown', filename + '.md');
    toast(`Exported ${ctx.records.length} records as Markdown`, false, 2400);
    return;
  }

  if (kind === 'xlsx') {
    const XLSX = await ensureXLSX();
    const flat = ctx.records.map(r => ({
      AnnotationId: r.AnnotationId || '',
      Symbol: r.Symbol || '',
      PublicationDate: r.PublicationDate || '',
      Body: cleanLabel(r.Body || ''),
      AnnotationType: cleanAnnotationType(r.AnnotationType),
      Countries: (r.Countries || []).map(cleanCountryName).join('; '),
      Regions: (r.Regions || []).join('; '),
      Themes: (r.Themes || []).join('; '),
      AffectedPersons: (r.AffectedPersons || []).join('; '),
      Sdgs: (r.Sdgs || []).join('; '),
      Text: r.TextPlainCleaned || r.Text || '',
      APACitation: citeAPA(r),
      YourNote: noteGet(r.AnnotationId || ''),
    }));
    const ws = XLSX.utils.json_to_sheet(flat);
    const wb = XLSX.utils.book_new();
    const sheetName = (_LIST_KIND_LABEL[ctx.kind] || ctx.kind).slice(0, 28);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename + '.xlsx');
    toast(`Exported ${ctx.records.length} records as XLSX`, false, 2400);
  }
}
