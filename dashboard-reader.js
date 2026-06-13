/* =========================================================================
   Reader / Drawer / Citations
   ========================================================================= */

/* =========================================================================
   CITATIONS (#7) — APA / Chicago / BibTeX / RIS / Plain URL
   =========================================================================
   Build canonical citation strings from the record. All five formats reference
   the same UN document symbol + OHCHR UHRI as the host database; differences
   are in field ordering, punctuation, and year placement. */
function _citeBaseFields(r) {
  const yr = (r.PublicationDate || '').slice(0, 4) || 'n.d.';
  const country = cleanCountryName((r.Countries || [])[0] || '');
  const body = cleanLabel(r.Body || '');
  const theme = (r.Themes || [])[0] || '';
  // Never fall back to AnnotationId — an internal UUID printed as a "UN Doc."
  // symbol is a fabricated-looking citation. Empty symbol is handled below.
  const symbol = (r.Symbol || '').trim();
  const txt = (r.TextPlainCleaned || r.Text || '').trim();
  // Pinpoint: treaty-body / Special-Procedure paragraphs almost always begin
  // with their own number ("23. The Committee recommends…"). Best-effort.
  const pm = txt.match(/^\s*(\d{1,3})\s*\./);
  const para = pm ? pm[1] : '';
  // Title: a section heading if present, else the annotation type — never a
  // truncated sentence (which reads as a fake work title and is not how UN
  // documents are cited). Country is appended by each formatter.
  const sections = r.SectionHeadings || [];
  const typeLabel = (typeof cleanAnnotationType === 'function'
    ? cleanAnnotationType(r.AnnotationType || '') : '') || '';
  const title = sections[0] || typeLabel || body || 'UN human-rights record';
  // Primary URL = the authoritative UN document (undocs.org resolves by symbol
  // and redirects to docs.un.org). The dashboard deep-link is only a fallback.
  const sourceUrl = symbol ? 'https://undocs.org/' + encodeURI(symbol) : '';
  const shareUrl = location.origin + location.pathname + '#sel=' + encodeURIComponent(r.AnnotationId || '');
  return { yr, country, body, theme, symbol, para, title, sourceUrl, shareUrl, id: r.AnnotationId || '' };
}

/* "UN Doc. SYMBOL, para. N" — empty string when there is no official symbol. */
function _citeDoc(f) {
  if (!f.symbol) return '';
  return `UN Doc. ${f.symbol}${f.para ? ', para. ' + f.para : ''}`;
}

/* Resolvable citation link: the authoritative UN document when we have a
   symbol, otherwise the dashboard view, clearly labelled as a finding aid. */
function _citeUrl(f) {
  return f.sourceUrl || `${f.shareUrl} (UHRI+ finding aid — UN document symbol unavailable)`;
}

function citeAPA(r) {
  const f = _citeBaseFields(r);
  const author = f.body || 'United Nations';
  const doc = _citeDoc(f);
  return `${author}. (${f.yr}). ${f.title}${f.country ? ' — ' + f.country : ''}${doc ? ' [' + doc + ']' : ''}. United Nations. ${_citeUrl(f)}`;
}

function citeChicago(r) {
  const f = _citeBaseFields(r);
  const author = f.body || 'United Nations';
  const doc = _citeDoc(f);
  return [
    `${author}, "${f.title}${f.country ? ', ' + f.country : ''},"`,
    doc || null,
    `(${f.yr}),`,
    _citeUrl(f) + '.',
  ].filter(Boolean).join(' ');
}

function citeBibTeX(r) {
  const f = _citeBaseFields(r);
  const key = 'UHRI_' + (f.id.replace(/-/g, '').slice(0, 10) || f.yr);
  const esc = s => String(s || '').replace(/[{}%&#_$]/g, '\\$&');
  return `@misc{${key},
  author       = {${esc(f.body || 'United Nations')}},
  title        = {${esc(f.title)}},
  year         = {${esc(f.yr)}},
  howpublished = {${f.symbol ? 'UN Doc. ' + esc(f.symbol) + (f.para ? ', para. ' + f.para : '') : 'United Nations document'}},
  ${f.country ? `addendum     = {${esc(f.country)}},\n  ` : ''}url          = {${_citeUrl(f)}},
  note         = {Retrieved via UHRI+ dashboard; UHRI annotation ${esc(f.id)}},
}`;
}

function citeRIS(r) {
  const f = _citeBaseFields(r);
  return [
    'TY  - GEN',
    'AU  - ' + (f.body || 'United Nations'),
    'PY  - ' + f.yr,
    'TI  - ' + f.title,
    'PB  - United Nations (OHCHR Universal Human Rights Index)',
    f.symbol ? 'ID  - ' + f.symbol : '',
    f.para ? 'SP  - ' + f.para : '',
    f.country ? 'CY  - ' + f.country : '',
    'UR  - ' + _citeUrl(f),
    'N1  - UHRI annotation ' + f.id,
    'ER  - ',
  ].filter(Boolean).join('\n');
}

function citePlainURL(r) {
  const f = _citeBaseFields(r);
  return f.sourceUrl || f.shareUrl;
}

const CITE_FORMATS = [
  { key: 'apa',     name: 'APA (7th ed.)',  fmt: 'APA',     build: citeAPA },
  { key: 'chicago', name: 'Chicago notes',  fmt: 'CHICAGO', build: citeChicago },
  { key: 'bibtex',  name: 'BibTeX',         fmt: '.BIB',    build: citeBibTeX },
  { key: 'ris',     name: 'RIS',            fmt: '.RIS',    build: citeRIS },
  { key: 'url',     name: 'Plain URL',      fmt: 'LINK',    build: citePlainURL },
];

/* =========================================================================
   DRAWER + READER
   ========================================================================= */
function navigateRec(step) {
  if (!state.currentResultList || !state.currentResultList.length) return;
  const idx = (state.currentResultIndex ?? 0) + step;
  if (idx < 0 || idx >= state.currentResultList.length) return;
  state.currentResultIndex = idx;
  state.selectedRec = state.currentResultList[idx];
  window._seSetActiveRecord?.(state.selectedRec);
  renderDrawer();
  // Open reader if it's already open
  if (!$('#reader').classList.contains('hidden')) openReader(state.selectedRec);
}

function renderDrawer() {
  // Auto-open the drawer as soon as the user actually selects a record
  // (default is closed to give the map + analytics more breathing room)
  if ((state.selectedRec || state.drawerMode === 'list') && TW.drawer === false) {
    TW.drawer = true;
    applyTweaks();
  }
  // M3 · C4: on mobile, the drawer is display:none until .mobile-open is
  // added. Fire the opener whenever we have a selected record or list to
  // show — without this, clicking a record did nothing visible on phones.
  if ((state.selectedRec || state.drawerMode === 'list') && window.innerWidth < 960) {
    window._openMobileDrawer?.();
  }

  // Branch: list mode (theme/group preview) vs record mode (default)
  if (state.drawerMode === 'list' && state.drawerList) {
    return renderDrawerListMode();
  }

  const el = $('#drawerBody');
  const r = state.selectedRec;
  if (!r) {
    // Empty drawer: show the at-a-glance panel (3 mechanism tiles +
    // dataset stats) before falling back to the generic "no record"
    // placeholder. Gives first-time visitors concrete facts about the
    // dataset structure without requiring any interaction.
    const mechCounts = _computeMechCounts();
    const hasMech = mechCounts && (mechCounts.upr + mechCounts.treaty + mechCounts.sp) > 0;
    const facets = state.facets || {};
    const total = facets.total_records || (mechCounts?._total) || 267671;
    // Use cleanCountryList — same canonical filter the rail uses for its
    // "02 COUNTRY 199" badge.  Raw facets.countries from the API contains
    // ~13 dirty entries (2-letter ISO leaks like "PK", "CZ"; OHCHR
    // internal labels; dupes) which inflated the at-a-glance count from
    // the canonical 199 to a misleading 212.
    const nCountries = cleanCountryList(facets.countries || []).length;
    const minY = facets.min_year || 2006;
    const maxY = facets.max_year || 2026;
    const kwHint = (state.filters.kw || '').trim();
    el.innerHTML = `
      <div class="dr-glance">
        <div class="dg-eyebrow">UHRI · at a glance</div>
        <div class="dg-title">Three UN mechanisms. One dataset.</div>
        <div class="dg-callout">The largest open dataset of UN human-rights recommendations — built from OHCHR UHRI, cleaned and unified across all three mechanisms.</div>
        <div class="dg-stats">
          <div class="s"><span class="n">${fmt(total)}</span>records</div>
          <div class="s"><span class="n">${nCountries || '—'}</span>countries</div>
          <div class="s"><span class="n">${minY}–${maxY}</span>years</div>
        </div>
        ${hasMech ? `<div id="drMechTiles"></div>` : `<div style="font-size:10px;color:var(--dim);padding:10px 0">${(state.analytics || state._offlineNotified || state._mechRetried) ? 'Mechanism breakdown unavailable for this view.' : 'Loading mechanism breakdown…'}</div>`}
        <div class="dg-quick">
          Click any tile → all recommendations from that mechanism · or click a record anywhere to preview it here${kwHint ? ` · current keyword <strong>"${sanitize(kwHint.slice(0, 40))}"</strong>` : ''}
        </div>
      </div>
      <div class="dr-empty" style="padding:24px 20px">
        <div>Click any record on the map, in a list, or in Search to preview it here.<br><br>Or press <kbd style="border:1px solid var(--line);padding:0 4px;font-family:var(--mono)">⌘K</kbd> for the command palette.</div>
      </div>`;
    // UI-10: never spin "Loading…" forever — retry once after a short delay to
    // catch a slow analytics load; if it still isn't there, the message above
    // already reads "unavailable" instead of an indefinite spinner.
    if (!hasMech && !state.analytics && !state._offlineNotified && !state._mechRetried) {
      state._mechRetried = true;
      setTimeout(() => { if (!state.selectedRec) renderDrawer(); }, 6000);
    }
    if (hasMech) state._mechRetried = false;
    if (hasMech) {
      // Drawer is the explainer panel — show the descriptions on each
      // tile (UPR / Treaty Bodies / Special Procedures) so first-time
      // visitors learn what each mechanism IS without first having to
      // click around.  The centre FIG.00 strip is now count-only.
      renderMechTiles($('#drMechTiles'), mechCounts, {
        mode: 'compact',
        showDesc: true,
        onClick: (family) => _openFamilyListDrawer(family),
      });
    }
    return;
  }

  const list = state.currentResultList || [];
  const idx = state.currentResultIndex ?? -1;
  const navHtml = list.length > 1 && idx >= 0 ? `
    <div class="dr-nav">
      <button id="drPrev" ${idx <= 0 ? 'disabled' : ''} title="Previous record (k)">↑ prev</button>
      <button id="drNext" ${idx >= list.length - 1 ? 'disabled' : ''} title="Next record (j)">↓ next</button>
      <span class="dr-nav-pos">${idx + 1} / ${list.length}</span>
      <span style="margin-left:auto">press <kbd>j</kbd>/<kbd>k</kbd></span>
    </div>` : '';
  el.dataset.hasNav = navHtml ? '1' : '0';
  const yr = (r.PublicationDate || '').slice(0, 4);
  const country = cleanCountryName((r.Countries || [])[0] || '—');
  const body = cleanLabel(r.Body) || '—';
  const themes = r.Themes || [];
  const groups = r.AffectedPersons || [];
  const sdgs = r.Sdgs || [];
  const txt = r.TextPlainCleaned || r.Text || '';
  const type = cleanAnnotationType(r.AnnotationType);

  const starred = bmHas(r.AnnotationId);
  const kw = state.filters.kw?.trim();
  const kwCount = kw ? countMatches(txt, kw) : 0;
  el.innerHTML = `
    ${navHtml}
    <div class="dr-id-row">
      <div class="dr-id">${sanitize(r.AnnotationId || '')}</div>
      <button class="bm-star ${starred ? 'on' : ''}" id="drStar" title="${starred ? 'Remove bookmark' : 'Bookmark this record'} (b)" aria-label="Toggle bookmark">${starred ? '★' : '☆'}</button>
    </div>
    <div class="dr-yr">${sanitize(yr || '—')}</div>
    <!-- Metadata + actions sit ABOVE the (often long) text so the record's
         identity (symbol/body/country) and the primary actions — above all
         Cite, the expert's most-used action — are reachable without
         scrolling to the bottom of the paragraph. -->
    <dl class="dr-meta">
      <dt>Country</dt><dd>${sanitize(country)}</dd>
      <dt>Region</dt><dd>${sanitize((r.Regions || [])[0] || '—')}</dd>
      <dt>Body</dt><dd>${sanitize(body)}</dd>
      <dt>Symbol</dt><dd>${sanitize(r.Symbol || '—')}</dd>
      <dt>Type</dt><dd>${sanitize(type)}</dd>
    </dl>
    <div class="dr-actions">
      <div class="cite-picker">
        <button class="dr-btn primary" id="drCite">Cite ▾</button>
        <div class="cite-dropdown" id="citeDropdown">
          ${CITE_FORMATS.map(c => `
            <div class="cite-item" data-cite="${c.key}">
              <span class="name">${c.name}</span>
              <span class="fmt">${c.fmt}</span>
            </div>`).join('')}
        </div>
      </div>
      <button class="dr-btn" id="drOpen">Focus reader →</button>
      <button class="dr-btn" id="drPin" title="Pin for side-by-side compare">${diffIsPinned(r.AnnotationId) ? '📌 Pinned' : '📌 Pin'}</button>
      <button class="dr-btn report" id="drReport" title="Report a data-quality issue with this record">🚩 Report</button>
    </div>
    ${kwCount ? `<div class="rd-kw-hint" style="margin-top:-6px;margin-bottom:8px"><kbd>${sanitize(kw)}</kbd> matched ${kwCount}× in this text</div>` : ''}
    <div class="dr-text">${highlightKeyword(txt, kw)}</div>
    <div class="dr-tags">
      ${themes.slice(0, 4).map(t => `<span class="dr-tag theme" role="button" tabindex="0" data-tag-kind="theme" data-tag-value="${sanitize(t)}" data-theme="${sanitize(t)}">${sanitize(t)}</span>`).join('')}
      ${groups.slice(0, 4).map(g => `<span class="dr-tag" role="button" tabindex="0" data-tag-kind="group" data-tag-value="${sanitize(g)}">${sanitize(g)}</span>`).join('')}
      ${sdgs.slice(0, 3).map(s => `<span class="dr-tag" role="button" tabindex="0" data-tag-kind="sdg" data-tag-value="${sanitize(s)}">${sanitize(s)}</span>`).join('')}
    </div>
    <div class="dr-note-block">
      <label class="dr-note-label" for="drNote">📝 Your note <span class="hint">private · saved in this browser</span></label>
      <textarea id="drNote" placeholder="Drop a thought, a quote, a todo — stays on this device, never sent anywhere." rows="3">${sanitize(noteGet(r.AnnotationId || ''))}</textarea>
      <div class="dr-note-status" id="drNoteStatus"></div>
    </div>`;

  $('#drOpen').addEventListener('click', () => openReader(r));
  $('#drReport').addEventListener('click', () => openReportModal(r));
  $('#drPin')?.addEventListener('click', (e) => {
    const outcome = diffPinToggle(r);
    const btn = e.currentTarget;
    btn.textContent = outcome === 'added' ? '📌 Pinned' : '📌 Pin';
    toast(outcome === 'added' ? `Pinned ${state.diffPins.length}/2 for compare` : 'Unpinned', false, 1400);
  });

  // Note autosave — debounced 400ms so fast typing doesn't hammer localStorage.
  const noteEl = $('#drNote');
  const noteStatus = $('#drNoteStatus');
  if (noteEl) {
    let noteT;
    const markSaved = () => {
      if (noteStatus) {
        noteStatus.textContent = '✓ saved ' + new Date().toLocaleTimeString();
        noteStatus.classList.add('saved');
      }
    };
    noteEl.addEventListener('input', () => {
      if (noteStatus) {
        noteStatus.textContent = '…';
        noteStatus.classList.remove('saved');
      }
      clearTimeout(noteT);
      noteT = setTimeout(() => {
        noteSet(r.AnnotationId, noteEl.value);
        markSaved();
      }, 400);
    });
  }

  $('#drPrev')?.addEventListener('click', () => navigateRec(-1));
  $('#drNext')?.addEventListener('click', () => navigateRec(1));

  // Horizontal swipe on drawer body → prev/next record.
  const drawerBody = $('#drawerBody');
  if (drawerBody && list.length > 1 && idx >= 0) {
    let sx = 0;
    let sy = 0;
    let swiping = false;
    drawerBody.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      swiping = true;
    }, { passive: true });
    drawerBody.addEventListener('touchend', (e) => {
      if (!swiping) return;
      swiping = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
        navigateRec(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  $('#drStar').addEventListener('click', () => {
    const nowOn = bmToggle(r);
    toast(nowOn ? '★ Bookmarked' : 'Bookmark removed', false, 1800);
    renderDrawer();
    if (state.view === 'bookmarks') renderBookmarks();
  });

  $('#drCite').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#citeDropdown').classList.toggle('open');
  });
  el.querySelectorAll('#citeDropdown .cite-item').forEach(item => {
    item.addEventListener('click', () => {
      const key = item.dataset.cite;
      const fmt = CITE_FORMATS.find(f => f.key === key);
      if (!fmt) return;
      const text = fmt.build(r);
      navigator.clipboard.writeText(text).then(() => {
        toast(`${fmt.name} citation copied`, false, 2800);
      });
      $('#citeDropdown').classList.remove('open');
    });
  });
  el.querySelectorAll('.dr-tag').forEach(tag => tag.addEventListener('click', () => {
    const kind  = tag.dataset.tagKind;
    const value = tag.dataset.tagValue;
    if (!kind || !value) return;
    if (kind === 'theme') {
      state.filters.theme.add(value);
      refreshFacetUI('theme');
    } else if (kind === 'group') {
      state.filters.group.add(value);
      refreshFacetUI('group');
    } else if (kind === 'sdg') {
      const goalNum = _sdgToFilterValue(value);
      if (goalNum !== null) {
        state.filters.sdg = state.filters.sdg || new Set();
        state.filters.sdg.add(goalNum);
        refreshFacetUI('sdg');
      }
    }
    onFiltersChanged();
    toast(`Filter added: ${value.slice(0, 48)}`, false, 2200);
  }));
  el.querySelectorAll('.dr-tag').forEach(tag => tag.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tag.click(); }
  }));
}

function closeReader() {
  $('#reader').classList.add('hidden');
  $('#reader').onkeydown = null;
  const ret = state._readerReturnFocus;
  state._readerReturnFocus = null;
  if (ret && typeof ret.focus === 'function') { try { ret.focus(); } catch (e) {} }
}

/* Focus trap for the Reader modal: keep Tab within the dialog. Escape-to-close
   is handled by the global keydown handler in dashboard.html. */
function _readerTrapTab(e) {
  if (e.key !== 'Tab') return;
  const nodes = $('#reader').querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const focusable = Array.from(nodes).filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openReader(r) {
  const yr = (r.PublicationDate || '').slice(0, 4);
  const country = cleanCountryName((r.Countries || [])[0] || '—');
  const body = cleanLabel(r.Body);
  const themes = r.Themes || [];
  const txt = r.TextPlainCleaned || r.Text || '';
  const sections = r.SectionHeadings || [];
  const type = cleanAnnotationType(r.AnnotationType);

  const starred = bmHas(r.AnnotationId);
  const kw = state.filters.kw?.trim();
  const kwCount = kw ? countMatches(txt, kw) : 0;
  $('#readerBody').innerHTML = `
    <button class="rd-close" id="rdClose" aria-label="close">×</button>
    <div class="rd-eyebrow">
      <span class="dot"></span>
      <span>${sanitize(body)}</span><span>·</span>
      <span>${sanitize(yr)}</span><span>·</span>
      <span>${sanitize(country)}</span>
      ${themes[0] ? `<span>·</span><span>${sanitize(themes[0])}</span>` : ''}
      <button class="bm-star ${starred ? 'on' : ''}" id="rdStar" title="${starred ? 'Remove bookmark' : 'Bookmark this record'} (b)" aria-label="Toggle bookmark">${starred ? '★' : '☆'}</button>
    </div>
    <h1 class="rd-title">${sanitize(sections[0] || txt.slice(0, 120) + (txt.length > 120 ? '…' : ''))}</h1>
    ${kwCount ? `<div class="rd-kw-hint"><kbd>${sanitize(kw)}</kbd> highlighted — matched ${kwCount}× in this record</div>` : ''}
    <div class="rd-body">${highlightKeyword(txt, kw)}</div>
    <dl class="rd-meta">
      <div><dt class="k">Symbol</dt><dd class="v">${sanitize(r.Symbol || '—')}</dd></div>
      <div><dt class="k">Country</dt><dd class="v">${sanitize(country)} · ${sanitize((r.Regions || [])[0] || '')}</dd></div>
      <div><dt class="k">Themes</dt><dd class="v">${sanitize(themes.join(', ') || '—')}</dd></div>
      <div><dt class="k">Concerned groups</dt><dd class="v">${sanitize((r.AffectedPersons || []).join(', ') || '—')}</dd></div>
      <div><dt class="k">Type</dt><dd class="v">${sanitize(type)}</dd></div>
      <div><dt class="k">Annotation ID</dt><dd class="v" style="word-break:break-all;font-size:10px">${sanitize(r.AnnotationId || '')}</dd></div>
    </dl>
    <div class="rd-foot">
      <button class="dr-btn primary" id="rdCloseFoot">Close</button>
      <button class="dr-btn report" id="rdReport">🚩 Report issue</button>
    </div>`;
  const _rdWasHidden = $('#reader').classList.contains('hidden');
  if (_rdWasHidden) state._readerReturnFocus = document.activeElement;
  $('#reader').classList.remove('hidden');
  $('#reader').onkeydown = _readerTrapTab;
  $('#rdClose').addEventListener('click', closeReader);
  $('#rdCloseFoot').addEventListener('click', closeReader);
  if (_rdWasHidden) { const _c = $('#rdClose'); if (_c) _c.focus(); }
  $('#rdReport').addEventListener('click', () => openReportModal(r));
  $('#rdStar').addEventListener('click', () => {
    const nowOn = bmToggle(r);
    toast(nowOn ? '★ Bookmarked' : 'Bookmark removed', false, 1800);
    openReader(r);
    renderDrawer();
    if (state.view === 'bookmarks') renderBookmarks();
  });
}
