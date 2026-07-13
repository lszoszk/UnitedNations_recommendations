/* UHRI Dashboard — search results view (infinite-scroll, KWIC, bulk ops)
 *
 * Extracted from dashboard.html inline as part of the seam split. Renders
 * the paginated full-text search tab: result items with smart KWIC snippet,
 * bulk selection (bookmark / pin / export), and an IntersectionObserver
 * sentinel for infinite-scroll page loading.
 *
 * LOAD ORDER
 *   Runs AFTER helpers/data/route/offline/utils and BEFORE the inline
 *   <script>. Every outbound call resolves via one of:
 *
 *   (a) Top-level from earlier modules:
 *         $, fmt, sanitize                       (helpers)
 *         cleanCountryName, cleanLabel           (helpers)
 *         inferAnnotationType, formatSdgLabel    (helpers)
 *         _hasSdgFilters                         (helpers)
 *         state, api                             (data)
 *         _kwTokens, _findBestCluster            (utils — KWIC helpers)
 *         highlightKeyword, countMatches         (utils)
 *         bmHas, bmToggle, noteHas               (utils)
 *         diffIsPinned, diffPinToggle,
 *         _renderDiffTray                        (utils — diff tray)
 *
 *   (b) Lazy from inline (only inside user-action handlers, safe):
 *         toast, announce, onFiltersChanged      — UX plumbing
 *         openReader, renderDrawer               — drawer integration
 *         openSelectionDrawer, refreshSelectionDrawer  (selection flow)
 *         _exportDrawerList                      — drawer CSV export
 *
 * EXTERNAL SURFACE (what inline reaches into here)
 *   renderSearch()  — full re-render of the search tab. Called by
 *                     navigate('search') and onFiltersChanged() when the
 *                     current view is 'search'. All other search functions
 *                     (smartSnippet, _seBulk*, loadNextSearchPage, …) are
 *                     internal — bound only by DOM event handlers created
 *                     inside renderSearch itself.
 */

/* =========================================================================
   VIEW: SEARCH RESULTS
   ========================================================================= */

/* Smart KWIC (keyword-in-context) snippet.
   For short records (<500 chars) or records where the keyword appears in
   the first ~400 chars, the existing fade-out preview already shows the
   highlight — we pass the full text through unchanged. When the keyword
   only appears past the fade-out fold, we build a 1–2-sentence KWIC
   window centred on the first hit so the user can see WHY the record
   matched without clicking "show full". Returns {html, isKwic, fullLen}. */
function smartSnippet(text, kw) {
  const t = String(text || '');
  const fullLen = t.length;
  const tokens = _kwTokens(kw);
  if (!tokens.length || fullLen <= 500) {
    return { html: highlightKeyword(t, kw), isKwic: false, fullLen };
  }
  // Find the best cluster across all tokens (handles "forced labour"
  // matching via "forced" + "labour" separately when FTS5 stemmed them).
  const idx = _findBestCluster(t, tokens);
  if (idx < 0 || idx < 400) {
    // hits already visible in the default fade-out window, or no hits
    return { html: highlightKeyword(t, kw), isKwic: false, fullLen };
  }
  // Build KWIC window around the cluster — roughly one sentence before + one after
  let start = Math.max(0, idx - 140);
  let end   = Math.min(fullLen, idx + 220);
  while (start > 0 && !/[.\n;:]/.test(t[start - 1])) start--;
  while (start < idx && /\s/.test(t[start])) start++;
  while (end < fullLen && !/[.\n]/.test(t[end])) end++;
  if (end < fullLen) end++;
  const snippet = t.slice(start, end);
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < fullLen ? ' …' : '';
  return {
    html: prefix + highlightKeyword(snippet, kw) + suffix,
    isKwic: true,
    fullLen,
  };
}

/* Swap a single .se-item between its on-load KWIC preview and the full
   highlighted text.  Idempotent: cards that never started in KWIC mode
   (data-mode="full") have no snippet to swap — only the .expanded class
   flips, which removes the CSS fade-out.
   The FIRST time a KWIC card expands we cache its original innerHTML in
   data-orig-snippet.  On collapse we restore THAT exact HTML — not a
   freshly-computed smartSnippet() — because the initial render usually
   preferred the server's tight FTS5 snippet (with <mark> already
   wrapped), and regenerating client-side produced a wider ~360-char
   window.  The expand↔collapse cycle was visibly growing the card. */
function _seSwapExpansion(el, expanding) {
  const tx = el.querySelector('.se-tx');
  if (!tx || tx.dataset.mode !== 'kwic') return;
  if (expanding) {
    if (tx.dataset.origSnippet == null) {
      tx.dataset.origSnippet = tx.innerHTML;
    }
    const full = tx.dataset.fullText || '';
    const kw   = tx.dataset.kw || '';
    // Bug A guard: if full text is absent (record had no TextPlainCleaned /
    // Text field), keep the server snippet visible instead of blanking the card.
    if (!full) return;
    // Pass 1 — client regex: exact phrases + wildcard (*) tokens from the query.
    let html = highlightKeyword(full, kw);
    // Pass 2 — server hints: FTS5 may have matched stemmed/inflected forms the
    // client regex can't reproduce (e.g. "preference" for query "preferences",
    // or a locale-variant spelling).  data-server-hints holds the exact words
    // the server put in <mark> tags so we can re-apply them here.
    const hints = (tx.dataset.serverHints || '').split('\x1f').filter(Boolean);
    if (hints.length) html = _highlightTerms(html, hints);
    tx.innerHTML = html;
  } else if (tx.dataset.origSnippet != null) {
    tx.innerHTML = tx.dataset.origSnippet;
  }
}

/* Renders a single search-result item HTML string */
/* Heavy-user result card (A–E redesign):
 *  A. Explainer banner above the list (done in renderSearch).
 *  B. Citation-grade header row: year · country · body · TYPE · symbol · marks.
 *  C. Full text with fade-out + "Show full" toggle (no 320-char slice).
 *  D. Per-row action bar stays for secondary tasks: Bookmark · Pin · Copy.
 *  E. Tags grouped by kind with visible category labels (THEMES / GROUPS / SDGs). */
function _renderSearchItem(rec, idx, kw) {
  const fullTxt = rec.TextPlainCleaned || rec.Text || '';
  const kwCount = kw ? countMatches(fullTxt, kw) : 0;
  const starred = bmHas(rec.AnnotationId);
  const hasNote = noteHas(rec.AnnotationId);
  const isPinned = diffIsPinned(rec.AnnotationId);
  const yr = (rec.PublicationDate||'').slice(0,4);
  const themes = (rec.Themes||[]).slice(0,4);
  const groups = (rec.AffectedPersons||[]).slice(0,3);
  const sdgs = (rec.Sdgs||[]).slice(0,2);
  const body = cleanLabel(rec.Body);
  const country = cleanCountryName((rec.Countries||[])[0] || '');
  const region = (rec.Regions||[])[0] || '';
  const typeRaw = inferAnnotationType(rec);
  const typeLower = String(typeRaw||'').toLowerCase();
  const typeClass = typeLower.includes('recommend') ? 'rec' : (typeLower.includes('observ') ? 'obs' : '');
  const typeLabel = (typeRaw && typeRaw !== '—') ? typeRaw : '';
  const symbol = rec.Symbol || '';
  const isLong = fullTxt.length > 520;
  // Prefer the FTS5 server snippet when the backend produced one (boolean /
  // wildcard / stemmed matches that the client-side substring highlighter
  // would miss). It arrives with <mark> tags already wrapped — sanitize()
  // would strip them, so we substitute the literal tags for delimiters
  // before sanitizing, then restore them after. The fallback smartSnippet
  // path stays intact for plain-mode and no-keyword queries.
  // Extract the exact words FTS5 marked in the server snippet — these may
  // differ from the user's query tokens via stemming (e.g. "preferences" →
  // "preference") or tokenisation differences.  Stored in data-server-hints
  // so _seSwapExpansion can re-highlight them over the full expanded text.
  let serverHintsAttr = '';
  let snippet;
  if (rec.snippet && kw) {
    const rawSn = String(rec.snippet);
    // Collect <mark>…</mark> contents before sanitization
    const _srvHints = [];
    const _hmRe = /<mark>([\s\S]*?)<\/mark>/g; let _hm;
    while ((_hm = _hmRe.exec(rawSn)) !== null) {
      const _t = _hm[1].trim();
      if (_t && !_srvHints.includes(_t)) _srvHints.push(_t);
    }
    if (_srvHints.length) {
      serverHintsAttr = ` data-server-hints="${sanitize(_srvHints.join('\x1f'))}"`;
    }
    const safeSn = sanitize(rawSn.replace(/<mark>/g, '\u0001MK\u0001').replace(/<\/mark>/g, '\u0001/MK\u0001'))
      .replace(/\u0001MK\u0001/g, '<mark class="kw-match">')
      .replace(/\u0001\/MK\u0001/g, '</mark>');
    // Bug B fix: also add client highlights for OR-branch terms the server
    // didn't mark in this window (e.g. "forced labour" when only "commun*" matched).
    snippet = { html: _highlightOutsideMarks(safeSn, kw), isKwic: true, fullLen: fullTxt.length };
  } else {
    snippet = smartSnippet(fullTxt, kw);
  }
  const isSelected = state.searchSelection.has(rec.AnnotationId);
  const isOpen = state.drawerMode !== 'list' && state.selectedRec?.AnnotationId === rec.AnnotationId;
  return `<div class="se-item${isSelected?' selected':''}${isOpen?' is-open':''}${snippet.isKwic?' is-kwic':''}" data-idx="${idx}" data-id="${sanitize(rec.AnnotationId||'')}" role="article" tabindex="0" aria-label="${sanitize(yr)} ${sanitize(country)} ${sanitize(body)} — Enter to open">
    <label class="se-check" title="Select for bulk actions" onclick="event.stopPropagation()"><input type="checkbox" data-bulkcb="${idx}" ${isSelected?'checked':''}></label>
    <div class="se-hdr">
      <span class="yr">${sanitize(yr || '—')}</span>
      <span class="country" title="${sanitize(country)}">${sanitize(country)}</span>
      <span class="body" title="Recommending body">${sanitize(body || '—')}</span>
      ${typeLabel ? `<span class="type ${typeClass}" title="Annotation type">${sanitize(typeLabel)}</span>` : ''}
      ${symbol ? `<span class="sym" title="UN document symbol — cite this">${sanitize(symbol)}</span>` : ''}
      ${kwCount ? `<span class="kw" title="${kwCount} keyword match${kwCount!==1?'es':''}">${kwCount}× "${sanitize(kw)}"</span>` : ''}
      ${snippet.isKwic ? `<span class="kwic-badge" title="Showing a matched excerpt (the keyword in context). Click 'show full text' to see the whole record.">◎ Excerpt</span>` : ''}
      ${(hasNote || starred || isPinned) ? `<span class="marks">
        ${hasNote ? '<span title="You have a note on this record">📝</span>' : ''}
        ${starred ? '<span style="color:#d97706" title="Bookmarked">★</span>' : ''}
        ${isPinned ? '<span title="Pinned for compare">📌</span>' : ''}
      </span>` : ''}
      ${region ? `<span class="region">${sanitize(region)}</span>` : ''}
    </div>
    <div class="se-tx" data-full-text="${sanitize(fullTxt)}" data-kw="${sanitize(kw||'')}"${serverHintsAttr} data-mode="${snippet.isKwic ? 'kwic' : 'full'}">${snippet.html}</div>
    ${isLong ? `<button class="se-more-btn">↓ Show full text (${fullTxt.length.toLocaleString()} chars)</button>` : ''}
    ${(themes.length || groups.length || sdgs.length) ? `<div class="se-tags">
      ${themes.length ? `<span class="tg-kind">Themes</span>${themes.map(t=>`<span class="tg-val" role="button" tabindex="0" title="Filter by this theme" data-tag-kind="theme" data-tag-value="${sanitize(t)}">${sanitize(t)}</span>`).join('')}` : ''}
      ${groups.length ? `<span class="tg-kind">Groups</span>${groups.map(g=>`<span class="tg-val" role="button" tabindex="0" title="Filter by this affected group" data-tag-kind="group" data-tag-value="${sanitize(g)}">${sanitize(g)}</span>`).join('')}` : ''}
      ${sdgs.length ? `<span class="tg-kind">SDGs</span>${sdgs.map(s=>`<span class="tg-val" role="button" tabindex="0" title="Filter by this SDG" data-tag-kind="sdg" data-tag-value="${sanitize(s)}">${sanitize(formatSdgLabel(s))}</span>`).join('')}` : ''}
    </div>` : ''}
    <div class="se-actions">
      <button data-act="bookmark" data-idx="${idx}" class="${starred?'starred':''}" title="Toggle bookmark (b)">${starred?'★ Bookmarked':'☆ Bookmark'}</button>
      <button data-act="pin" data-idx="${idx}" class="${isPinned?'pinned':''}" title="Pin for side-by-side compare">${isPinned?'📌 Pinned':'📌 Pin'}</button>
      <button data-act="copy" data-idx="${idx}" title="Copy quote with APA citation">Copy quote</button>
    </div>
  </div>`;
}

function _seSetActiveRecord(recOrId) {
  const id = typeof recOrId === 'string' ? recOrId : (recOrId?.AnnotationId || '');
  $$('#seList .se-item').forEach(el => {
    el.classList.toggle('is-open', !!id && el.dataset.id === id);
  });
}
window._seSetActiveRecord = _seSetActiveRecord;

/* Search view — infinite scroll with IntersectionObserver sentinel.
   Modern browsers use CSS content-visibility:auto on rows so only visible
   rows pay layout cost, enabling lists with thousands of records to scroll
   smoothly without a virtualization library. */
let _seObserver = null;
let _seLoading = false;   // in-flight guard for loadNextSearchPage (prevents double-append on rapid observer re-fire)
async function renderSearch() {
  const root = $('#view-search');
  const kw = state.filters.kw.trim();
  state.searchPage = 1;
  state.searchLoaded = [];
  state.searchExhausted = false;
  // Generation token: bumped on every (re-)render so an in-flight page fetch
  // from a previous sort/filter detects it's stale and discards its rows
  // instead of appending old-sort records into the freshly-reset list.
  state._searchGen = (state._searchGen || 0) + 1;
  _seLoading = false;
  state.currentResultList = [];
  state.currentResultSource = 'search';
  if (_seObserver) { _seObserver.disconnect(); _seObserver = null; }

  // Auto-default to relevance sort when a keyword query is active AND the
  // user hasn't explicitly chosen another sort. Otherwise date desc.
  const sortBy  = state.searchSort?.by  || (kw ? 'relevance' : 'publication_date');
  const sortDir = state.searchSort?.dir || (kw ? 'asc' : 'desc');
  const sortKey = sortBy + ':' + sortDir;

  root.innerHTML = `
    <div class="se-head">
      <span class="lbl">Search results</span>
      <span class="q">${kw ? `"${sanitize(kw)}"` : 'all recommendations'}</span>
      ${kw ? `<button class="se-kw-clear" id="seKwClear" title="Clear keyword filter">×</button>` : ''}
      <span class="n" id="seN" aria-live="polite">loading…</span>
      <span style="flex:1"></span>
      <label class="se-sort">sort
        <select id="seSort" title="Change result order">
          ${kw ? `<option value="relevance:asc" ${sortKey==='relevance:asc'?'selected':''}>relevance · best match</option>` : ''}
          <option value="publication_date:desc" ${sortKey==='publication_date:desc'?'selected':''}>date · newest first</option>
          <option value="publication_date:asc"  ${sortKey==='publication_date:asc'?'selected':''}>date · oldest first</option>
          <option value="country:asc"           ${sortKey==='country:asc'?'selected':''}>country · A–Z</option>
          <option value="body:asc"              ${sortKey==='body:asc'?'selected':''}>body · A–Z</option>
          <option value="type:asc"              ${sortKey==='type:asc'?'selected':''}>type · recommendation first</option>
        </select>
      </label>
      <button id="seExpandAll" title="Expand all result texts on the current page">↓ Expand all</button>
      <button id="seCollapseAll" title="Collapse all result texts">↑ Collapse all</button>
    </div>
    ${kw ? `<div class="se-exhaustive-note" role="note" style="font-size:11px;color:var(--dim);padding:6px 2px 0;line-height:1.5">Results match word forms found in the text — a low or zero count is <strong>not proof none exists</strong>. Broaden with a trailing <code>*</code> (e.g. <code>detentio*</code>) or a synonym. <a href="#view=methodology" onclick="event.preventDefault();navigate('methodology')">How search works →</a></div>` : ''}
    <div class="se-explainer">
      <span>Each row is <strong>one paragraph</strong> extracted from a UN concluding observation, UPR report or Special Procedure communication.</span>
      <span class="pill rec" id="seBreakRec" title="Formal UN recommendations — 'The Committee recommends that…'"><span class="v">…</span> Recommendations</span>
      <span class="pill" id="seBreakObs" title="Observations — findings, concerns, notes"><span class="v">…</span> Observations</span>
      <span class="pill" id="seBreakOther" title="Follow-up requests, procedural paragraphs, etc."><span class="v">…</span> Other</span>
      <span style="flex:1"></span>
      <span style="color:var(--dim)">Click row → side reader + notes · checkbox → bulk · <kbd>/</kbd> focus keyword</span>
    </div>
    <div class="se-bulk" id="seBulk" aria-live="polite">
      <span class="cnt" id="seBulkCount">0 selected</span>
      <button id="seBulkBookmark">★ Bookmark all</button>
      <button id="seBulkExportMd">Export .md</button>
      <button id="seBulkExportXlsx">Export .xlsx</button>
      <button id="seBulkPin" title="Pin first two as A/B for compare">📌 Pin first 2</button>
      <button class="clear" id="seBulkClear">× clear</button>
    </div>
    <!-- WCAG: dropped role="list" — children are .se-item divs without
         role="listitem", which axe flags as aria-required-children.
         Adding listitem to every renderer would be invasive for marginal
         AT benefit; the items are already keyboard-reachable as buttons
         and have aria-labels through their inner content.  If we adopt
         a list semantic later, every renderer below needs role="listitem"
         on its outer wrapper. -->
    <div class="se-list" id="seList"></div>
    <div class="se-sentinel" id="seSentinel" aria-live="polite"><span class="dot"></span>Loading more…</div>`;

  // H. Inline × on the keyword badge — fastest way to drop a too-narrow
  // keyword without hunting back to the rail input.
  $('#seKwClear')?.addEventListener('click', () => {
    state.filters.kw = '';
    if ($('#kwInput')) $('#kwInput').value = '';
    $('#tabSearch').textContent = '—';
    onFiltersChanged();
  });
  // F. Sort dropdown — round-trips through state.searchSort + re-renders.
  $('#seSort')?.addEventListener('change', (e) => {
    const [by, dir] = e.target.value.split(':');
    state.searchSort = { by, dir };
    renderSearch();
  });
  // Expand / Collapse all — toggles `.expanded` on every loaded item AND
  // swaps KWIC↔full text on cards that started in KWIC mode (see
  // _seSwapExpansion below).  Without the content swap, "Expand all"
  // just removed the fade-out but still showed the short KWIC window,
  // and "Collapse all" left cards that had been individually expanded
  // showing truncated full text.  Refreshes every "Show full text"
  // button label to match the new state.
  const flipExpansion = (on) => {
    document.querySelectorAll('#seList .se-item').forEach(el => {
      _seSwapExpansion(el, on);
      el.classList.toggle('expanded', on);
    });
    document.querySelectorAll('#seList .se-more-btn').forEach(btn => {
      btn.textContent = on ? '↑ Collapse' : '↓ Show full text';
    });
  };
  $('#seExpandAll')?.addEventListener('click', () => flipExpansion(true));
  $('#seCollapseAll')?.addEventListener('click', () => flipExpansion(false));
  // G. Bulk-bar wiring — selection persists across pagination by AnnotationId.
  _seUpdateBulkBar();
  $('#seBulkBookmark')?.addEventListener('click', _seBulkBookmark);
  $('#seBulkExportMd')?.addEventListener('click', () => _seExportSelected('md'));
  $('#seBulkExportXlsx')?.addEventListener('click', () => _seExportSelected('xlsx'));
  $('#seBulkPin')?.addEventListener('click', _seBulkPin);
  $('#seBulkClear')?.addEventListener('click', () => {
    state.searchSelection.clear();
    _seUpdateBulkBar();
    document.querySelectorAll('.se-item.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.se-item input[type="checkbox"]').forEach(cb => cb.checked = false);
  });

  await loadNextSearchPage();
}

/* ---------- Bulk-selection helpers for search results (F+G) ----------
   Selection is keyed by AnnotationId so toggling off-screen items (after
   scrolling + re-sorting) still works. UI is additive: the bulk bar only
   appears when ≥1 item is selected. */
function _seUpdateBulkBar() {
  const n = state.searchSelection.size;
  const bar = $('#seBulk'); const cnt = $('#seBulkCount');
  if (bar) bar.classList.toggle('on', n > 0);
  if (cnt) cnt.textContent = `${n} selected` + (n >= 2 ? ' · ready to pin 2 or bulk-export' : '');
  // Tier 4 polish: persist a badge in the Search tab header so users who
  // scroll/navigate away still see their selection count.
  const tab = $('#tabSearch');
  if (tab) {
    const kw = (state.filters?.kw || '').trim();
    const kwPart = kw ? `"${kw}"` : '—';
    tab.innerHTML = n > 0
      ? `${sanitize(kwPart)} <span class="tab-selcount" title="${n} record${n!==1?'s':''} selected for bulk actions">★ ${n}</span>`
      : sanitize(kwPart);
  }
}
function _seToggleSelect(rec, onClass) {
  if (!rec || !rec.AnnotationId) return;
  const id = rec.AnnotationId;
  if (state.searchSelection.has(id)) state.searchSelection.delete(id);
  else state.searchSelection.add(id);
  _seUpdateBulkBar();
  // Selection → drawer (third drawer mode). Auto-switch iff the drawer
  // isn't currently busy with another context:
  //  - empty drawer (no selectedRec, not in list mode) → open selection
  //  - already showing selection → refresh
  //  - showing a theme/country/etc. list → don't steal the scope
  //  - showing a single record → don't steal
  const mode = state.drawerMode;
  const listKind = state.drawerList?.kind;
  if (state.searchSelection.size > 0) {
    if (mode === 'list' && listKind === 'selection') {
      openSelectionDrawer();  // refresh list
    } else if (!state.selectedRec && (mode !== 'list' || !listKind)) {
      openSelectionDrawer();
    } else {
      refreshSelectionDrawer();
    }
  } else if (listKind === 'selection') {
    // Cleared all selections while viewing them — close drawer list.
    state.drawerList = null;
    state.drawerMode = 'record';
    renderDrawer();
  }
  return state.searchSelection.has(id);
}
function _seBulkBookmark() {
  let added = 0;
  state.searchLoaded.forEach(r => {
    if (r && state.searchSelection.has(r.AnnotationId) && !bmHas(r.AnnotationId)) {
      bmToggle(r); added++;
    }
  });
  toast(`Bookmarked ${added} record${added !== 1 ? 's' : ''}`, false, 2200);
  // Refresh the star state on-screen so the user sees the effect
  document.querySelectorAll('.se-item [data-act="bookmark"]').forEach(b => {
    const idx = +b.dataset.idx;
    const r = state.searchLoaded[idx]; if (!r) return;
    const on = bmHas(r.AnnotationId);
    b.classList.toggle('starred', on);
    b.textContent = on ? '★ Bookmarked' : '☆ Bookmark';
  });
}
function _seBulkPin() {
  const picks = state.searchLoaded.filter(r => r && state.searchSelection.has(r.AnnotationId)).slice(0, 2);
  if (picks.length < 2) { toast('Select at least 2 records to compare', true, 2000); return; }
  state.diffPins = picks;
  _renderDiffTray();
  toast(`Pinned ${picks.length} record(s) · check the tray bottom-right`, false, 2400);
}
function _seExportSelected(kind) {
  const picks = state.searchLoaded.filter(r => r && state.searchSelection.has(r.AnnotationId));
  if (!picks.length) { toast('Nothing selected', true, 1800); return; }
  const fakeCtx = {
    kind: 'search',
    value: (state.filters.kw || '').trim() || 'all',
    records: picks,
    total: picks.length,
  };
  _exportDrawerList(kind, fakeCtx);
}

/* Update the type-breakdown pills in the explainer based on whatever
   records are loaded so far. Starts as "…" and refines as pages arrive. */
function _seUpdateBreakdown() {
  const counts = { rec: 0, obs: 0, other: 0 };
  state.searchLoaded.forEach(r => {
    const t = String(inferAnnotationType(r) || '').toLowerCase();
    if (t.includes('recommend')) counts.rec++;
    else if (t.includes('observ')) counts.obs++;
    else counts.other++;
  });
  const total = state.searchLoaded.length;
  const suffix = state.searchExhausted ? '' : ' so far';
  const setPill = (id, label, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = el.querySelector('.v');
    if (v) v.textContent = total ? fmt(n) : '—';
    el.style.display = (total === 0 || n === 0) ? (id === 'seBreakRec' ? '' : 'none') : '';
    el.title = label + ' — ' + fmt(n) + ' of ' + fmt(total) + ' loaded' + suffix;
  };
  setPill('seBreakRec', 'Recommendations', counts.rec);
  setPill('seBreakObs', 'Observations', counts.obs);
  setPill('seBreakOther', 'Other', counts.other);
}

async function loadNextSearchPage() {
  if (_seLoading || state.searchExhausted) return;
  _seLoading = true;
  const gen = state._searchGen;
  const kw = state.filters.kw.trim();
  const pageSize = state.searchPageSize;
  try {
    const sortOpts = state.searchSort || {};
    const r = await api.records(state.filters, state.searchPage, pageSize, {
      sort_by: sortOpts.by || 'publication_date',
      sort_dir: sortOpts.dir || 'desc',
    });
    // A re-sort / re-filter (renderSearch) may have superseded this fetch while
    // it was in flight — discard the stale page rather than appending its rows
    // (which would duplicate / mis-map data-idx against the reset list).
    if (gen !== state._searchGen) return;
    const total = r.total_records;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const n = $('#seN');
    if (n) n.textContent = `${fmt(total)} matches · showing ${fmt(state.searchLoaded.length + (r.records||[]).length)}`;

    // Analytics: on page 1 only (subsequent pages are scroll-through,
    // not a new search).  Fires metadata derived from `kw` — length
    // bucket, boolean/wildcard/quote flags — and the result-count
    // bucket.  The query string itself is never written to gtag.
    // See About → Privacy for the full list + rationale.
    if (state.searchPage === 1 && kw && typeof window.trackSearch === 'function') {
      window.trackSearch(kw, total);
    }

    if (state.searchPage === 1 && !(r.records || []).length) {
      // Empty state on first page — three flavours:
      // (a) backend returned `search_warning` → tailored hint with syntax
      //     examples (operator-only, empty phrase, etc.). Keeps the user
      //     oriented instead of a generic "no records" message that
      //     suggests the filters are the problem.
      // (b) the user has applied filters → offer quick-reset buttons.
      // (c) no filters, 0 records → something went very wrong.
      if (r.search_warning) {
        $('#seList').innerHTML = `
          <div class="empty-state">
            <div class="es-title">Let's refine your search</div>
            <div class="es-sub">${sanitize(r.search_warning)}</div>
            <div class="se-warn-hint">
              <span class="ico">!</span>Search syntax examples:<br>
              <code>torture AND detention</code> both terms ·
              <code>"forced labour"</code> exact phrase ·
              <code>LGBT*</code> prefix match ·
              <code>climate NOT green</code> exclude
            </div>
            <button class="primary" onclick="document.getElementById('kwInput').focus();document.getElementById('kwInput').select();">Edit keyword</button>
            <button onclick="document.getElementById('kwInput').value='';state.filters.kw='';onFiltersChanged();">Clear keyword</button>
          </div>`;
        const sentinel = $('#seSentinel'); if (sentinel) sentinel.style.display = 'none';
        state.searchExhausted = true;
        return;
      }
      const kwActive = state.filters.kw.trim();
      const hasFilters = state.filters.country.size || state.filters.body.size || state.filters.theme.size || state.filters.group.size || state.filters.region.size || _hasSdgFilters(state.filters) || state.filters.type.size || kwActive || (state.facets && (state.filters.yearA > state.facets.min_year || state.filters.yearB < state.facets.max_year));
      $('#seList').innerHTML = `
        <div class="empty-state">
          <div class="es-title">${kwActive ? `No matches for &ldquo;${sanitize(kwActive.slice(0, 60))}&rdquo;` : 'No records match your filters'}</div>
          <div class="es-sub">${hasFilters ? 'Try removing one or two filters, broadening the year range, or using a different keyword.' : 'Hmm, the dataset should have 267,942 records — something went wrong.'}</div>
          ${kwActive ? `
            <div class="se-warn-hint">
              <span class="ico">!</span><strong>A zero result is not proof that none exists.</strong>
              Search matches word forms found in the text, so exact spellings and quoted phrases can miss variants.
              Try a trailing <code>*</code> (e.g. <code>detentio*</code>), a synonym, or removing quotation marks.
              <a href="#view=methodology" onclick="event.preventDefault();navigate('methodology')">How search works →</a>
            </div>` : ''}
          ${hasFilters ? `
            <button class="primary" onclick="document.getElementById('clearFilters').click()">Clear all filters</button>
            ${kwActive ? `<button onclick="document.getElementById('kwInput').value='';state.filters.kw='';onFiltersChanged();">Drop keyword "${sanitize(kwActive.slice(0, 40))}"</button>` : ''}
            ${state.filters.country.size ? `<button onclick="state.filters.country=new Set();['country'].forEach(refreshFacetUI);onFiltersChanged();">Include all countries</button>` : ''}
            ${state.filters.theme.size ? `<button onclick="state.filters.theme=new Set();['theme'].forEach(refreshFacetUI);onFiltersChanged();">Include all themes</button>` : ''}
          ` : ''}
        </div>`;
      const sentinel = $('#seSentinel'); if (sentinel) sentinel.style.display = 'none';
      state.searchExhausted = true;
      return;
    }

    // Append new rows
    const startIdx = state.searchLoaded.length;
    const newRows = (r.records || []);
    state.searchLoaded.push(...newRows);
    state.currentResultList = state.searchLoaded;

    const html = newRows.map((rec, i) => _renderSearchItem(rec, startIdx + i, kw)).join('');
    const list = $('#seList');
    if (list) list.insertAdjacentHTML('beforeend', html);

    // Wire card click to the side drawer. Search is a scanning surface:
    // keep list context in the middle pane, inspect + note in the drawer.
    (list ? list.querySelectorAll('.se-item:not([data-wired])') : []).forEach(el => {
      el.dataset.wired = '1';
      el.addEventListener('click', (e) => {
        // Ignore clicks on buttons + the expand chevron — they handle themselves
        if (e.target.closest('button, .se-more-btn')) return;
        const idx = +el.dataset.idx;
        const rec = state.searchLoaded[idx];
        if (!rec) return;
        state.drawerMode = 'record';
        state.drawerList = null;
        state.selectedRec = rec;
        state.currentResultIndex = idx;
        state.currentResultList = state.searchLoaded;
        _seSetActiveRecord(rec);
        renderDrawer();
      });
      // Keyboard: Enter/Space on the card itself opens it in the reader. The
      // e.target guard lets inner buttons/checkbox/chips keep their own keys.
      el.addEventListener('keydown', (e) => {
        if (e.target !== el) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      });
      // Expand/collapse — see _seSwapExpansion for the KWIC↔full swap.
      el.querySelector('.se-more-btn')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const btn = ev.currentTarget;
        const expanding = !el.classList.contains('expanded');
        _seSwapExpansion(el, expanding);
        const on = el.classList.toggle('expanded');
        btn.textContent = on ? '↑ Collapse' : '↓ Show full text';
      });
      // Bulk-select checkbox (G) — syncs to state.searchSelection and the
      // sticky bulk bar. Checkbox click already has stopPropagation via
      // label/onclick, so the card's reader-click doesn't fire too.
      el.querySelector('input[type="checkbox"][data-bulkcb]')?.addEventListener('change', (ev) => {
        const idx = +ev.target.dataset.bulkcb;
        const rec = state.searchLoaded[idx]; if (!rec) return;
        const on = _seToggleSelect(rec);
        el.classList.toggle('selected', !!on);
      });
      // Per-row actions: bookmark / pin / copy. Reading + notes live in the drawer.
      el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = +btn.dataset.idx;
        const rec = state.searchLoaded[idx]; if (!rec) return;
        const act = btn.dataset.act;
        if (act === 'bookmark') {
          const on = bmToggle(rec);
          btn.textContent = on ? '★ Bookmarked' : '☆ Bookmark';
          btn.classList.toggle('starred', on);
          toast(on ? '★ Bookmarked' : 'Bookmark removed', false, 1400);
        } else if (act === 'pin') {
          const outcome = diffPinToggle(rec);
          const on = outcome === 'added';
          btn.classList.toggle('pinned', on);
          btn.textContent = on ? '📌 Pinned' : '📌 Pin';
          toast(on ? `Pinned ${state.diffPins.length}/2 for compare` : 'Unpinned', false, 1400);
        } else if (act === 'copy') {
          const quote = `"${(rec.TextPlainCleaned || rec.Text || '').trim()}"\n\n${citeAPA(rec)}`;
          navigator.clipboard.writeText(quote).then(() => toast('Copied with citation', false, 1600));
        }
      }));
      // Tag chips (themes / groups / SDGs) add the matching filter — same
      // contract as the drawer's .dr-tag chips. stopPropagation so the card's
      // reader-open click doesn't also fire.
      el.querySelectorAll('.tg-val').forEach(chip => chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const kind = chip.dataset.tagKind;
        const value = chip.dataset.tagValue;
        if (!kind || !value) return;
        if (kind === 'theme') { state.filters.theme.add(value); refreshFacetUI('theme'); }
        else if (kind === 'group') { state.filters.group.add(value); refreshFacetUI('group'); }
        else if (kind === 'sdg') {
          const g = _sdgToFilterValue(value);
          if (g === null) return;
          state.filters.sdg = state.filters.sdg || new Set();
          state.filters.sdg.add(g);
          refreshFacetUI('sdg');
        }
        onFiltersChanged();
        toast(`Filter added: ${value.slice(0, 48)}`, false, 2200);
      }));
      el.querySelectorAll('.tg-val').forEach(chip => chip.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); chip.click(); }
      }));
    });
    _seUpdateBreakdown();

    // Are we done?
    if (state.searchPage >= totalPages) {
      state.searchExhausted = true;
      _seUpdateBreakdown();
      const sentinel = $('#seSentinel');
      if (sentinel) {
        sentinel.classList.add('done');
        sentinel.innerHTML = `— end of results (${fmt(total)} total) —`;
      }
      if (_seObserver) { _seObserver.disconnect(); _seObserver = null; }
      return;
    }

    state.searchPage++;

    // Arm an IntersectionObserver on the sentinel for infinite scroll
    const sentinel = $('#seSentinel');
    if (sentinel && !_seObserver) {
      _seObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting && !state.searchExhausted) loadNextSearchPage();
        });
      }, { rootMargin: '240px' });  // start fetching before sentinel is visible
      _seObserver.observe(sentinel);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    const n = $('#seN');
    if (n) n.textContent = 'failed';
    // In-place error card in the list area — previously the list was
    // left blank (so users staring at a "failed" counter up top would
    // see no explanation below).  Shows the reason + retry + hint.
    // Caught by user-flow C5: "very-unlikely-phrase-xyz123" + similar
    // special-char inputs cause 500 responses upstream which lack CORS
    // headers.  Browser reports it as a CORS error; the root cause is
    // the backend's query parser not gracefully handling oddly-shaped
    // input.  Dashboard shouldn't stay blank for that.
    const list = $('#seList');
    if (list && state.searchPage === 1) {
      const kw = (state.filters.kw || '').trim();
      const looksLikeBadSyntax = /["'*()&|]/.test(kw) && !/\s(AND|OR|NOT)\s/i.test(kw);
      list.innerHTML = `
        <div class="empty-state">
          <div class="es-title">Search couldn't run</div>
          <div class="es-sub">The server returned an error for "<code>${sanitize(kw.slice(0, 80))}</code>".
            ${looksLikeBadSyntax
              ? 'This often means odd punctuation or an unclosed quote/paren confused the query parser.'
              : 'This is usually a transient backend issue — give it a few seconds and retry.'}</div>
          <div class="se-warn-hint">
            <span class="ico">!</span>Query tips:<br>
            <code>torture AND detention</code> both terms ·
            <code>"forced labour"</code> exact phrase ·
            <code>LGBT*</code> prefix match ·
            <code>climate NOT green</code> exclude
          </div>
          <button class="primary" onclick="state.filters.kw='';document.getElementById('kwInput').value='';onFiltersChanged();">Clear keyword</button>
          <button onclick="document.getElementById('kwInput').focus();document.getElementById('kwInput').select();">Edit keyword</button>
        </div>`;
      state.searchExhausted = true;
    }
    toast('Search failed: ' + err.message, true);
  } finally {
    _seLoading = false;
  }
}
