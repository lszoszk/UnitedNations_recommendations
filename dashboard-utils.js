/* =========================================================================
   SAVED VIEWS (#6a) — persist filter + focus state with a user-chosen name
   =========================================================================
   Stored in localStorage under 'uhri_v2_saved_views'. Each entry:
     { id, name, created_at, hash }  (hash is the #-string)
   A saved view replays by setting location.hash then calling _restoreUrlState. */
const SV_KEY = 'uhri_v2_saved_views';
function svLoad() {
  try { return JSON.parse(localStorage.getItem(SV_KEY) || '[]'); } catch { return []; }
}
function svSave(list) {
  try { localStorage.setItem(SV_KEY, JSON.stringify(list)); } catch {}
}

function describeCurrentState() {
  const f = state.filters;
  const bits = [];
  if (f.kw) bits.push(`"${f.kw}"`);
  if (f.country.size) bits.push(`${f.country.size} countries`);
  if (f.body.size) bits.push(`${f.body.size} bodies`);
  if (f.theme.size) bits.push(`${f.theme.size} themes`);
  if (f.group.size) bits.push(`${f.group.size} groups`);
  if (f.region.size) bits.push(`${f.region.size} regions`);
  if (f.sdg.size) bits.push(`${f.sdg.size} SDGs`);
  if (_sdgExactValues(f).length) bits.push(_sdgExactValues(f).length === 1 ? formatSdgLabel(_sdgExactValues(f)[0]) : `${_sdgExactValues(f).length} SDG targets`);
  if (state.facets && (f.yearA > state.facets.min_year || f.yearB < state.facets.max_year))
    bits.push(`${f.yearA}–${f.yearB}`);
  if (state.view && state.view !== 'overview') bits.push(state.view);
  return bits.length ? bits.join(', ') : 'no filters';
}

function openSavedViewsModal() {
  const m = document.createElement('div');
  m.className = 'sv-modal';
  function render() {
    const list = svLoad();
    m.innerHTML = `
      <div class="sv-card">
        <h3>Saved views</h3>
        <div class="sv-save-row">
          <input id="svName" placeholder="Name for current state — e.g. Colombia rule of law 2020–2024" maxlength="80" />
          <button id="svSave">Save</button>
        </div>
        ${list.length ? `
          <div class="sv-list">
            ${list.map(v => `
              <div class="sv-item" data-id="${sanitize(v.id)}">
                <span class="name">${sanitize(v.name)}</span>
                <span class="meta">${sanitize(new Date(v.created_at).toISOString().slice(0,10))}</span>
                <button class="del" data-del="${sanitize(v.id)}" title="Delete">×</button>
              </div>`).join('')}
          </div>` : `<div class="sv-empty">No saved views yet. Apply some filters, then give this state a name.</div>`}
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="ofl-actions" style="padding:8px 14px;border:1px solid var(--line);background:transparent;color:var(--ink);font:11px var(--mono);letter-spacing:.08em;text-transform:uppercase;cursor:pointer" id="svClose">Close</button>
        </div>
      </div>`;
    $('#svSave', m).addEventListener('click', () => {
      const input = $('#svName', m);
      const name = input.value.trim() || ('Saved view · ' + new Date().toISOString().slice(0,16).replace('T',' '));
      const id = 'sv_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
      const newList = [{ id, name, created_at: Date.now(), hash: location.hash.slice(1) || '' }, ...svLoad()];
      svSave(newList);
      toast(`Saved view "${name}"`, false, 3000);
      render();
    });
    $('#svClose', m).addEventListener('click', () => m.remove());
    m.querySelectorAll('.sv-item').forEach(item => item.addEventListener('click', async e => {
      if (e.target.classList.contains('del')) return;
      const id = item.dataset.id;
      const v = svLoad().find(x => x.id === id);
      if (v) {
        await _applyRouteStateFromHash(v.hash, { replaceLocation: true });
        m.remove();
        toast(`Loaded view "${v.name}"`, false, 2500);
      }
    }));
    m.querySelectorAll('.del').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.del;
      svSave(svLoad().filter(x => x.id !== id));
      render();
    }));
  }
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  render();
  // Pre-fill with a suggested name based on current filters
  const input = $('#svName', m);
  if (input) input.value = describeCurrentState();
}

/* =========================================================================
   SHARE (#6b) — modal with copy + mail + encoded-URL options
   ========================================================================= */
function openShareModal() {
  const m = document.createElement('div');
  m.className = 'sh-modal';
  const u = location.href;
  const encoded = encodeURIComponent(u);
  const summary = describeCurrentState();
  const subject = encodeURIComponent('UHRI analytics — ' + summary);
  const body = encodeURIComponent('I filtered the UHRI analytics dashboard to: ' + summary + '\n\n' + u);
  m.innerHTML = `
    <div class="sh-card">
      <h3>Share this view</h3>
      <div class="sh-filters-summary">${sanitize(summary)}</div>
      <label style="font-size:10px;letter-spacing:.12em;color:var(--dim);text-transform:uppercase;display:block;margin-bottom:4px">Shareable URL</label>
      <div class="sh-url-row">
        <input readonly value="${sanitize(u)}" id="shUrl" />
        <button id="shCopy">Copy</button>
      </div>
      <div class="sh-options">
        <a class="sh-opt" href="mailto:?subject=${subject}&body=${body}"><span class="ic">✉</span>Email</a>
        <a class="sh-opt" href="https://twitter.com/intent/tweet?text=${subject}&url=${encoded}" target="_blank" rel="noopener"><span class="ic">𝕏</span>Twitter / X</a>
        <a class="sh-opt" href="https://www.linkedin.com/sharing/share-offsite/?url=${encoded}" target="_blank" rel="noopener"><span class="ic">in</span>LinkedIn</a>
        <a class="sh-opt" href="https://bsky.app/intent/compose?text=${subject}+${encoded}" target="_blank" rel="noopener"><span class="ic">🦋</span>Bluesky</a>
      </div>
      <div class="sh-cite-note" style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px;font-size:11px;color:var(--dim)">
        Citing this in research? See <a href="#view=about" id="shAbout" style="color:var(--accent)">how to cite the dataset &amp; the independence statement →</a>
      </div>
      <div style="margin-top:16px;text-align:right">
        <button id="shClose" style="padding:8px 14px;border:1px solid var(--line);background:transparent;color:var(--ink);font:11px var(--mono);letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Close</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  $('#shClose', m).addEventListener('click', () => m.remove());
  $('#shAbout', m)?.addEventListener('click', (e) => { e.preventDefault(); m.remove(); if (typeof navigate === 'function') navigate('about'); });
  $('#shCopy', m).addEventListener('click', () => {
    $('#shUrl', m).select();
    navigator.clipboard.writeText(u).then(() => {
      $('#shCopy', m).textContent = 'Copied ✓';
      setTimeout(() => { $('#shCopy', m).textContent = 'Copy'; }, 2000);
    });
  });
}

/* =========================================================================
   REPORT RECORD (feedback loop) — POST /api/feedback/report
   ========================================================================= */
function openReportModal(rec) {
  const m = document.createElement('div');
  m.className = 'rpt-modal';
  const snippet = (rec.TextPlainCleaned || rec.Text || '').slice(0, 140);
  m.innerHTML = `
    <div class="rpt-card">
      <h3>Report data issue</h3>
      <div class="sub">${sanitize(rec.AnnotationId||'')}</div>
      <div style="font-family:var(--serif);font-size:13px;color:var(--ink-2);background:var(--paper-2);padding:10px;border-left:2px solid #b91c1c;margin-bottom:12px;max-height:100px;overflow-y:auto">${sanitize(snippet)}${snippet.length>=140?'…':''}</div>
      <label for="rptReason">What's wrong?</label>
      <select id="rptReason">
        <option value="wrong_country">Wrong country assignment</option>
        <option value="wrong_themes">Wrong themes / tags</option>
        <option value="bad_text">Garbled or incomplete text</option>
        <option value="duplicate">Duplicate of another record</option>
        <option value="wrong_body">Wrong recommending body</option>
        <option value="other">Other issue</option>
      </select>
      <label for="rptMsg">Details (optional but helpful)</label>
      <textarea id="rptMsg" placeholder="What did you expect, and what did you see?"></textarea>
      <div class="rpt-actions">
        <button class="btn-ghost" id="rptCancel" style="padding:8px 14px;border:1px solid var(--line);background:transparent;color:var(--ink);font:11px var(--mono);text-transform:uppercase;letter-spacing:.08em;cursor:pointer">Cancel</button>
        <button class="btn-primary" id="rptSend" style="padding:8px 14px;background:#b91c1c;color:#fff;border:1px solid #b91c1c;font:11px var(--mono);text-transform:uppercase;letter-spacing:.08em;cursor:pointer">Send report</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', e => { if (e.target === m) close(); });
  $('#rptCancel', m).addEventListener('click', close);
  $('#rptSend', m).addEventListener('click', async () => {
    $('#rptSend', m).disabled = true;
    $('#rptSend', m).textContent = 'Sending…';
    try {
      const res = await fetch(API_BASE + '/api/feedback/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotation_id: rec.AnnotationId,
          symbol: rec.Symbol,
          category: $('#rptReason', m).value,
          reason: $('#rptReason', m).value,
          message: $('#rptMsg', m).value,
          source: 'dashboard2',
          url: location.href,
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      toast('Thanks — your report was received and will be reviewed.', false, 5000);
      close();
    } catch (err) {
      $('#rptSend', m).disabled = false;
      $('#rptSend', m).textContent = 'Retry';
      toast('Report failed: ' + err.message, true, 5000);
    }
  });
}

/* =========================================================================
   UPLOAD — file upload + OHCHR URL auto-parse
   =========================================================================
   Two input modes:
   1. JSON file export from OHCHR UHRI → parse directly, load into offline
   2. Paste a uhri.ohchr.org URL → parse query params, apply as filters */
function parseOhchrUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!/uhri\.ohchr\.org/i.test(u.hostname)) return null;
    const p = u.searchParams;

    // OHCHR URL params come in several shapes. Extract what we can:
    // - ?country[]=Afghanistan, ?annotation_country[]=X
    // - ?mechanism[]=CCPR, ?annotation_body[]=X
    // - ?theme[]=X, ?annotation_theme[]=X
    // - ?search=text, ?q=text
    // - ?from=2015&to=2024, ?year_from=, ?year_to=
    const take = (names) => {
      const out = [];
      for (const n of names) {
        p.getAll(n).forEach(v => { if (v) out.push(v); });
        p.getAll(n + '[]').forEach(v => { if (v) out.push(v); });
      }
      return out;
    };

    const result = {
      countries: take(['country','annotation_country','state','state_under_review']),
      bodies: take(['mechanism','annotation_body','body']),
      themes: take(['theme','annotation_theme']),
      kw: p.get('search') || p.get('q') || p.get('fulltext') || '',
      yearA: Number(p.get('from') || p.get('year_from') || p.get('yearFrom')) || null,
      yearB: Number(p.get('to') || p.get('year_to') || p.get('yearTo')) || null,
    };

    // Handle hash-based params too (some OHCHR pages use # for state)
    if (u.hash) {
      try {
        const hp = new URLSearchParams(u.hash.slice(1));
        if (!result.kw && (hp.get('search') || hp.get('q'))) result.kw = hp.get('search') || hp.get('q');
        if (!result.countries.length) result.countries = take.call({get:(n)=>hp.get(n),getAll:(n)=>hp.getAll(n)}, ['country']);
      } catch {}
    }

    return result;
  } catch { return null; }
}

function applyOhchrUrlFilters(parsed) {
  if (!parsed) return 0;
  let n = 0;
  if (parsed.kw) { state.filters.kw = parsed.kw; $('#kwInput').value = parsed.kw; n++; }
  if (parsed.countries?.length) { parsed.countries.forEach(c => state.filters.country.add(c)); n++; }
  if (parsed.bodies?.length) { parsed.bodies.forEach(b => state.filters.body.add(b)); n++; }
  if (parsed.themes?.length) { parsed.themes.forEach(t => state.filters.theme.add(t)); n++; }
  if (parsed.yearA) { state.filters.yearA = parsed.yearA; n++; }
  if (parsed.yearB) { state.filters.yearB = parsed.yearB; n++; }
  if (typeof window._syncYearSlider === 'function') window._syncYearSlider();
  ['country','body','theme'].forEach(refreshFacetUI);
  $('#tabSearch').textContent = state.filters.kw || '—';
  renderActiveFilters();
  return n;
}

function triggerUpload() {
  const m = document.createElement('div');
  m.className = 'ofl-modal';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.innerHTML = `
    <div class="ofl-card" style="max-width:560px">
      <h2 style="font-family:var(--serif);font-size:28px;margin:0 0 8px;line-height:1.1">Upload or link</h2>
      <p style="font-family:var(--serif);font-size:14px;line-height:1.5;color:var(--ink-2);margin:0 0 18px">
        Load your own UHRI-format JSON export — or paste an <code style="background:var(--paper-2);padding:1px 4px;font-size:12px">uhri.ohchr.org</code> search URL to apply its filters to the dashboard.
      </p>

      <label style="display:block;font:10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">UHRI export (.xlsx or .json)</label>
      <input type="file" id="uplFile" accept=".json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="width:100%;padding:8px;border:1px dashed var(--line);font-family:var(--mono);font-size:11px;margin-bottom:6px;background:var(--paper-2)" />
      <div style="font:10px var(--mono);color:var(--dim);margin-bottom:14px;line-height:1.5">
        <strong style="color:var(--ink-2)">.xlsx</strong> — the standard UHRI download.
        <strong style="color:var(--ink-2)">.json</strong> — our canonical shape (same fields as the live API).
      </div>

      <label style="display:block;font:10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:6px">OHCHR UHRI URL</label>
      <div style="display:flex;gap:6px;margin-bottom:4px">
        <input type="url" id="uplUrl" placeholder="https://uhri.ohchr.org/en/search/annotations?..." style="flex:1;padding:8px 10px;border:1px solid var(--line);font:12px var(--mono);background:var(--paper);color:var(--ink)" />
        <button id="uplApplyUrl" style="padding:8px 14px;background:var(--ink);color:var(--paper);border:0;font:11px var(--mono);letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Apply</button>
      </div>
      <div id="uplUrlHint" style="font:10px var(--mono);color:var(--dim);margin-bottom:14px;min-height:14px"></div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button id="uplCancel" style="padding:8px 14px;border:1px solid var(--line);background:transparent;color:var(--ink);font:11px var(--mono);letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Close</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', e => { if (e.target === m) close(); });
  $('#uplCancel', m).addEventListener('click', close);

  // File path — JSON (canonical shape) or XLSX (UHRI standard download)
  $('#uplFile', m).addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 700 * 1024 * 1024) {
      toast('File too large (>700 MB). Uploads are held in memory.', true, 6000);
      return;
    }
    const tEl = $('#uplUrlHint', m);
    tEl.style.color = '';
    tEl.textContent = `Reading ${file.name} (${(file.size/1024/1024).toFixed(1)} MB)…`;
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const parsed = isXlsx ? await parseUhriXlsx(file) : await parseUhriJson(file);
      if (!parsed.length) throw new Error('Parsed 0 records — is this an empty export?');
      offline.data = parsed;
      // Hand source + meta to enable() so the badge / banner / sidebar hint
      // render in a single coordinated pass. The old implementation set the
      // DOM manually after enable() returned, which raced against
      // updateOfflineBadge() (fired async from inside enable) and silently
      // reverted the 📁 + filename to ⚡ + "INSTANT · N LOCAL".
      offline.enable({
        source: 'upload',
        uploadMeta: {
          filename: file.name,
          size: file.size,
          loadedAt: Date.now(),
        },
      });
      close();
      refreshCurrentView(); refreshHitCount();
    } catch (err) {
      tEl.style.color = '#b91c1c';
      tEl.textContent = 'Upload failed: ' + err.message;
    }
  });

  // URL path
  $('#uplUrl', m).addEventListener('input', e => {
    const parsed = parseOhchrUrl(e.target.value);
    const hint = $('#uplUrlHint', m);
    if (!e.target.value.trim()) { hint.textContent = ''; return; }
    if (!parsed) { hint.textContent = 'Not a uhri.ohchr.org URL — paste a search link'; hint.style.color = '#b91c1c'; return; }
    const bits = [];
    if (parsed.kw) bits.push(`kw="${parsed.kw.slice(0,25)}"`);
    if (parsed.countries?.length) bits.push(`${parsed.countries.length} countries`);
    if (parsed.themes?.length) bits.push(`${parsed.themes.length} themes`);
    if (parsed.bodies?.length) bits.push(`${parsed.bodies.length} bodies`);
    if (parsed.yearA || parsed.yearB) bits.push(`${parsed.yearA||'…'}–${parsed.yearB||'…'}`);
    hint.style.color = '';
    hint.textContent = bits.length ? 'Detected: ' + bits.join(' · ') : 'No filters detected in URL';
  });
  $('#uplApplyUrl', m).addEventListener('click', () => {
    const url = $('#uplUrl', m).value.trim();
    const parsed = parseOhchrUrl(url);
    if (!parsed) { toast('Not a uhri.ohchr.org URL', true); return; }
    const n = applyOhchrUrlFilters(parsed);
    if (n) {
      toast(`Applied ${n} filter${n>1?'s':''} from OHCHR URL`, false, 3500);
      close();
      onFiltersChanged();
    } else {
      toast('No filters to apply from that URL', true);
    }
  });
}

/* =========================================================================
   UHRI upload — JSON (canonical) + XLSX (standard OHCHR download)
   =========================================================================
   JSON: our on-disk shape, same fields as the live API — straight load.
   XLSX: parsed with SheetJS, mapped through a UHRI-column alias table.
   UHRI exports carry several OHCHR-internal quirks we normalise here:
     * "Reccomending Body" (double c, their typo) → Body
     * Multi-value cells are line-separated with "- " prefixes
     * Date fields are Excel serials (days since 1900 w/ leap bug)
     * Type labels carry "- " prefix; countries too
   The output record shape matches what the dashboard's offline layer
   expects (Countries/Body/Themes/Sdgs/Regions/AffectedPersons arrays +
   AnnotationType/AnnotationId/PublicationDate/Symbol/Text). */
async function parseUhriJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error('Expected a non-empty JSON array of records');
  }
  const sample = parsed[0];
  if (!sample.AnnotationId && !sample.annotation_id) {
    throw new Error('Records must have an AnnotationId field (UHRI JSON format)');
  }
  return parsed;
}

async function parseUhriXlsx(file) {
  const XLSX = await ensureXLSX();
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  if (!wb.SheetNames.length) throw new Error('Workbook has no sheets');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) throw new Error('First sheet has no data rows');
  // Sanity-check: the UHRI export has a small set of recognisable column
  // headers. If NONE of them match, the user uploaded the wrong file.
  const sampleKeys = Object.keys(rows[0]).map(k => k.toLowerCase());
  const hasUhri = sampleKeys.some(k => /annotation|reccomend|themes|countries/.test(k));
  if (!hasUhri) {
    throw new Error('Columns don\'t look like a UHRI export — expected "Countries Concerned", "Reccomending Body", "Themes", "OHCHR Annotation Id"');
  }
  return rows.map(_uhriRowToRecord);
}

/* UHRI row → canonical record shape.  Handles the list of aliases UHRI
   uses across export versions (some have "Recommending Body" corrected,
   others keep the historical typo "Reccomending Body").  Case- and
   whitespace-insensitive match so we accept either. */
function _uhriRowToRecord(row) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const rowNorm = {};
  for (const [k, v] of Object.entries(row)) rowNorm[norm(k)] = v;
  const get = (...aliases) => {
    for (const a of aliases) {
      const key = norm(a);
      if (rowNorm[key] != null && rowNorm[key] !== '') return rowNorm[key];
    }
    return '';
  };
  const stripDash = (s) => String(s || '').replace(/^[-\s]+/, '').trim();
  const parseList = (v) => String(v || '')
    .split(/\r?\n/)
    .map(s => stripDash(s))
    .filter(Boolean);
  // Excel date serial → ISO-YYYY-MM-DD.  Epoch Dec 30 1899 handles the
  // well-known 1900 leap-year bug Excel never fixed.  Non-numeric falls
  // through unchanged (some exports already pre-format as ISO).
  const excelDate = (v) => {
    if (!v) return '';
    const n = Number(v);
    if (Number.isFinite(n) && n > 10000) {
      const epochMs = Date.UTC(1899, 11, 30);
      return new Date(epochMs + n * 86400000).toISOString().slice(0, 10);
    }
    return String(v);
  };
  const text = String(get('Text') || '');
  return {
    AnnotationId:       String(get('OHCHR Annotation Id', 'AnnotationId', 'Annotation Id') || ''),
    Symbol:             String(get('Document Symbol', 'Symbol') || ''),
    PublicationDate:    excelDate(get('Document Publication Date', 'PublicationDate', 'Publication Date')),
    Body:               stripDash(get('Reccomending Body', 'Recommending Body', 'Body')),
    AnnotationType:     stripDash(get('Type', 'AnnotationType', 'Annotation Type')),
    Countries:          parseList(get('Countries Concerned', 'Countries')),
    Regions:            parseList(get('Regions Concerned', 'Regions')),
    Themes:             parseList(get('Themes')),
    AffectedPersons:    parseList(get('Affected Persons', 'AffectedPersons')),
    Sdgs:               parseList(get('Sdgs', 'SDGs')),
    Text:               text,
    TextPlainCleaned:   text,
    SectionHeadings:    [],
    UprSession:         stripDash(get('UPR Session')) || null,
    UprRecommendingStates: parseList(get('UPR Reccomending States', 'UPR Recommending States')),
    UprPosition:        stripDash(get('UPR Position')) || null,
  };
}

/* =========================================================================
   XLSX in offline — lazy-load SheetJS from CDN
   ========================================================================= */
let _xlsxPromise = null;
function ensureXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // 0.18.5 (last npm release) carries CVE-2023-30533 + CVE-2024-22363;
    // 0.20.3 ships only via the vendor CDN. SRI pin so a CDN compromise
    // can't inject script into this origin (we parse untrusted uploads
    // with it). Hash = sha384 of the fetched artefact, 2026-06-11.
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.integrity = 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Failed to load SheetJS from CDN'));
    document.head.appendChild(s);
  });
  return _xlsxPromise;
}

async function exportXLSXFromRows(rows, filename) {
  const XLSX = await ensureXLSX();
  // Flatten array-valued columns so Excel users get clean cells
  const flat = rows.map(r => ({
    AnnotationId: r.AnnotationId || '',
    Symbol: r.Symbol || '',
    PublicationDate: r.PublicationDate || '',
    Body: cleanLabel(r.Body || ''),
    AnnotationType: cleanLabel(r.AnnotationType || ''),
    Countries: (r.Countries || []).map(cleanCountryName).join('; '),
    Regions: (r.Regions || []).join('; '),
    Themes: (r.Themes || []).join('; '),
    AffectedPersons: (r.AffectedPersons || []).join('; '),
    Sdgs: (r.Sdgs || []).join('; '),
    Text: r.TextPlainCleaned || r.Text || '',
  }));
  const ws = XLSX.utils.json_to_sheet(flat);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Records');
  XLSX.writeFile(wb, filename);
}

/* =========================================================================
   SPARKLINES (Batch 5) — tiny year-over-year mini-charts per row
   =========================================================================
   Two sources of truth:
   - Themes use analytics.themes.yearly_theme_counts (server has this)
   - Countries use a lazy per-country fetch (already cached by warmer)
   Groups have no yearly breakdown on the server — we skip those for now. */
function _yearlyCountsByKey(list, keyField) {
  // Build { key → { year → count } } from a list of {year, <keyField>, count}
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const r of list) {
    const k = r[keyField]; if (!k) continue;
    if (!out[k]) out[k] = {};
    out[k][r.year] = (out[k][r.year] || 0) + (r.count || 0);
  }
  return out;
}

function buildSparklineSVG(yearToCount, minYear, maxYear, color = null) {
  // T3: optional `color` override — used to tint body sparklines by
  // their mechanism family (teal / violet / orange) so Top Bodies lists
  // gain the same colour coding as the timeline stack + KPI strip.
  // Defaults to --accent when no override is supplied.
  const strokeCol = color || 'var(--accent)';
  const fillCol = color || 'var(--accent)';
  const W = 54, H = 16, pad = 1;
  if (!yearToCount) return '';
  const years = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);
  const values = years.map(y => yearToCount[y] || 0);
  const max = Math.max(1, ...values);
  if (values.every(v => v === 0)) return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><line x1="0" y1="${H-1}" x2="${W}" y2="${H-1}" stroke="currentColor" stroke-opacity=".3"/></svg>`;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, years.length - 1)) * W;
    const y = H - pad - (v / max) * (H - pad * 2);
    return [x, y];
  });
  const line = pts.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fill = `M 0,${H} L ${line} L ${W},${H} Z`;
  // Last point highlighted
  const last = pts[pts.length - 1];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${fill}" fill="${fillCol}" opacity="0.16"/>
    <polyline points="${line}" fill="none" stroke="${strokeCol}" stroke-width="1" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.5" fill="${strokeCol}"/>
  </svg>`;
}

/* Family-color lookup for body sparklines. Maps body name → CSS var
   string usable in SVG fill/stroke. Falls back to null (→ default
   accent) for orphan/unclassified bodies. */
function _bodyColor(bodyName) {
  const fam = classifyBody(String(bodyName || '').replace(/^-\s*/, ''));
  if (fam === 'upr')    return 'var(--mech-upr)';
  if (fam === 'treaty') return 'var(--mech-tb)';
  if (fam === 'sp')     return 'var(--mech-sp)';
  return null;
}

/* Precomputed sparkline data maps — updated when analytics lands.
   Fed into renderRowList via `opts.sparklines` so every entity row in
   Top Themes / Concerned Groups / Top SDGs / Top Bodies gets its own
   mini year-by-year curve. Countries have their own cache because they
   need a per-country fetch (no baseline yearly breakdown). */
let _themeSparklines = {};
let _groupSparklines = {};
let _sdgSparklines = {};
let _bodySparklines = {};

function updateSparklineCaches(analyticsArg) {
  // Accept an explicit analytics dict so callers rendering BEFORE
  // state.analytics has been assigned can still populate the caches.
  const a = analyticsArg || state.analytics;
  if (!a) return;
  _themeSparklines = _yearlyCountsByKey(a?.themes?.yearly_theme_counts, 'theme');
  _groupSparklines = _yearlyCountsByKey(a?.text?.yearly_affected_person_counts, 'affected_person');
  _sdgSparklines   = _yearlyCountsByKey(a?.text?.yearly_sdg_counts, 'sdg');
  _bodySparklines  = _yearlyCountsByKey(a?.trends?.yearly_body_counts, 'body');
}

/* Lazy country sparklines — fetch per country on demand, cache in localStorage
   (small: 10 countries × 20 years × ~30 bytes ≈ 6KB) */
const _countrySparkCache = {};
const COUNTRY_SPARK_CACHE_KEY = 'uhri_v2_country_sparks_v1';
try { Object.assign(_countrySparkCache, JSON.parse(localStorage.getItem(COUNTRY_SPARK_CACHE_KEY) || '{}')); } catch {}
function saveCountrySparkCache() {
  try { localStorage.setItem(COUNTRY_SPARK_CACHE_KEY, JSON.stringify(_countrySparkCache)); } catch {}
}

async function getCountrySparkline(country) {
  if (_countrySparkCache[country]) return _countrySparkCache[country];
  try {
    const an = await api.analytics({...emptyFilters(), country: new Set([country])}, { scope: 'spark:' + country });
    const yearly = (an?.trends?.yearly_counts || []);
    const data = {};
    yearly.forEach(r => data[r.year] = r.count);
    _countrySparkCache[country] = data;
    saveCountrySparkCache();
    return data;
  } catch { return null; }
}

/* Fill country sparklines after the list is rendered. Runs in background,
   writes SVG into already-rendered `.spark` cells. */
async function backfillCountrySparklines(listEl, minY, maxY) {
  const rows = listEl.querySelectorAll('.rl-row[data-facet="country"]');
  const tasks = [];
  for (const row of rows) {
    const country = row.dataset.key;
    if (!country) continue;
    const sparkEl = row.querySelector('.spark');
    if (!sparkEl) continue;
    if (_countrySparkCache[country]) {
      sparkEl.innerHTML = buildSparklineSVG(_countrySparkCache[country], minY, maxY);
    } else {
      row.classList.add('loading-spark');
      tasks.push(
        getCountrySparkline(country).then(data => {
          if (data) sparkEl.innerHTML = buildSparklineSVG(data, minY, maxY);
          row.classList.remove('loading-spark');
        })
      );
    }
  }
  // Don't await — let them fill in as they arrive
}

/* =========================================================================
   PRELOAD ON HOVER (Batch 5) — warm the cache for what the user might click
   =========================================================================
   Hover ≥ 250ms → fire api.analytics + api.map for that country. Uses the
   same route cache as everything else. Offline-mode is a no-op (data is
   already local). */
const _preloadQueued = new Set();
function preloadCountryOnHover(country) {
  if (!country || offline.enabled) return;
  if (_preloadQueued.has('country:' + country)) return;
  _preloadQueued.add('country:' + country);
  const f = { ...emptyFilters(), country: new Set([country]) };
  api.analytics(f, { scope: 'preload-analytics:' + country }).catch(()=>{});
  api.map(f, { scope: 'preload-map:' + country }).catch(()=>{});
}
/* Generic preload for any entity kind the user might click → open profile.
   Intersects with the current rail so the warm cache matches what the
   Option-B profile renderers actually request. Fire-and-forget; errors
   are swallowed because this is speculative. */
function preloadEntityOnHover(kind, value) {
  if (!value || offline.enabled) return;
  const tag = kind + ':' + value;
  if (_preloadQueued.has(tag)) return;
  _preloadQueued.add(tag);
  const override = {};
  if (kind === 'country') override.country = new Set([value]);
  else if (kind === 'theme') override.theme = new Set([value]);
  else if (kind === 'group') override.group = new Set([value]);
  else if (kind === 'body')  override.body  = new Set([value]);
  else if (kind === 'sdg') {
    // SDG rows pass the full label ("16.3 - Promote…"). Feed it straight
    // to the API via raw params to match the SDG profile's request shape.
    const f = _scopedFilter({ sdg: new Set(), sdgExact: new Set() });
    const p = buildParams(f);
    p.set('sdgs', value);
    apiGet(E.analytics, p, { scope: 'preload-analytics:sdg-' + value }).catch(()=>{});
    apiGet(E.map,       p, { scope: 'preload-map:sdg-' + value }).catch(()=>{});
    return;
  } else return;
  const f = _scopedFilter(override);
  api.analytics(f, { scope: 'preload-analytics:' + tag }).catch(()=>{});
  api.map(f, { scope: 'preload-map:' + tag }).catch(()=>{});
}

function attachPreloadHover(el) {
  let t;
  el.addEventListener('mouseenter', () => {
    t = setTimeout(() => {
      const key = el.dataset.key;
      const kind = el.dataset.facet;
      if (!key || !kind) return;
      // Map facet name → preload kind (most are 1:1)
      if (kind === 'country') preloadCountryOnHover(key);
      else preloadEntityOnHover(kind, key);
    }, 250);
  });
  el.addEventListener('mouseleave', () => clearTimeout(t));
}

/* =========================================================================
   FULL-TEXT HIGHLIGHTING (Batch 5) — glow the keyword in drawer + reader
   ========================================================================= */
/* Extract highlight units from a user query. Phrases in quotes stay as
   atomic units (highlighted in one mark), bare words stay individual.
   Boolean operators + parens are stripped. Returns a flat list of strings,
   phrases first so they win over their own word-tokens in the alternation
   regex (longest-first ordering handles that). */
function _kwTokens(kw) {
  if (!kw || !kw.trim()) return [];
  const units = [];
  const raw = kw.trim();
  // Extract quoted phrases first, add as atomic units, then remove from raw
  let remaining = raw.replace(/"([^"]+)"/g, (m, phrase) => {
    const p = phrase.trim();
    if (p) units.push(p);
    return ' ';
  });
  // Strip boolean operators + parens from the remainder
  remaining = remaining.replace(/\b(AND|OR|NOT)\b/g, ' ').replace(/[()]/g, ' ');
  for (const tok of remaining.split(/\s+/)) {
    const t = tok.trim();
    if (t && t.length >= 2) units.push(t);
  }
  return units;
}

/* Convert a single _kwTokens output unit to a regex fragment. FTS5 syntax
   lets users append a trailing "*" for prefix matching (bias* → anything
   starting with "bias"). The upstream snippet returned by the server
   already handles this; the client-side fallback highlighter + counter
   need to mirror the semantics or they'll find literal asterisks (which
   don't appear in UHRI text) and render zero highlights on expand.
   Bug surfaced as: "expand" dropped all <mark> tags for queries with *. */
function _tokenToRegex(tok) {
  if (tok.length > 1 && tok.endsWith('*')) {
    return escapeRegex(tok.slice(0, -1)) + '\\w*';
  }
  return escapeRegex(tok);
}

function highlightKeyword(text, kw) {
  const safe = sanitize(text);
  const tokens = _kwTokens(kw);
  if (!tokens.length) return safe;
  // Longest tokens first so "human rights" doesn't fragment when both
  // "human" and "human rights" would match.
  tokens.sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(' + tokens.map(_tokenToRegex).join('|') + ')', 'gi');
  return safe.replace(pattern, '<mark class="kw-match">$1</mark>');
}

/* Re-apply an explicit list of plain strings as highlights, leaving any
   existing <mark> elements untouched.  Used in _seSwapExpansion to map
   server-FTS5-matched forms (e.g. "will and preference" — singular —
   when the user typed "will and preferences") back onto the full expanded
   text even though the client regex can't reproduce the stemming.
   terms[] entries are plain text (not query syntax); escapeRegex handles
   any special chars inside them. */
function _highlightTerms(html, terms) {
  if (!terms || !terms.length) return html;
  const filtered = terms.filter(t => t && t.trim());
  if (!filtered.length) return html;
  filtered.sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(' + filtered.map(escapeRegex).join('|') + ')', 'gi');
  return html.replace(/(<mark\b[^>]*>[\s\S]*?<\/mark>)|([^<]+)/g,
    (m, marked, text) => {
      if (marked) return marked;
      if (text)   return text.replace(pattern, '<mark class="kw-match">$1</mark>');
      return m;
    });
}

/* Apply client-side highlights to text runs that sit OUTSIDE existing
   <mark> elements.  Used when the server has already wrapped some matches
   (FTS5 snippet path) but OR-branch terms that also appear in the same
   snippet window aren't marked — e.g. for the query
   "forced labour" OR commun*, the server might only mark the "commun*"
   branch while "forced labour" in the same window goes unhighlighted.
   This function leaves every existing <mark> untouched and re-runs the
   client regex only on the plain-text runs between tags. */
function _highlightOutsideMarks(html, kw) {
  const tokens = _kwTokens(kw);
  if (!tokens.length) return html;
  tokens.sort((a, b) => b.length - a.length);
  const pattern = new RegExp('(' + tokens.map(_tokenToRegex).join('|') + ')', 'gi');
  // Each iteration of the replacer receives either:
  //   marked — an existing <mark …>…</mark> block  (group 1, left intact)
  //   text   — a plain-text run with no angle brackets (group 2, highlighted)
  return html.replace(/(<mark\b[^>]*>[\s\S]*?<\/mark>)|([^<]+)/g,
    (m, marked, text) => {
      if (marked) return marked;
      if (text)   return text.replace(pattern, '<mark class="kw-match">$1</mark>');
      return m;
    });
}

function countMatches(text, kw) {
  const tokens = _kwTokens(kw);
  if (!tokens.length || !text) return 0;
  const pattern = new RegExp(tokens.map(_tokenToRegex).join('|'), 'gi');
  return (text.match(pattern) || []).length;
}

/* Find the tightest window containing the most query tokens. Returns the
   index of the FIRST token in the best window, used by smartSnippet to
   pick where to centre the KWIC excerpt. */
function _findBestCluster(text, tokens) {
  if (!tokens.length) return -1;
  const lower = text.toLowerCase();
  const hits = [];
  for (const t of tokens) {
    // Mirror FTS5 trailing-* prefix matching: strip the asterisk and
    // treat the remainder as a prefix so tokens like "bias*" still
    // find "bias"/"biased"/"biases" when picking the KWIC cluster.
    const lt = t.toLowerCase();
    const isPrefix = lt.length > 1 && lt.endsWith('*');
    const probe = isPrefix ? lt.slice(0, -1) : lt;
    if (!probe) continue;
    let i = 0;
    while ((i = lower.indexOf(probe, i)) !== -1) {
      hits.push({ pos: i, token: probe });
      i += probe.length;
    }
  }
  if (!hits.length) return -1;
  hits.sort((a, b) => a.pos - b.pos);
  // Sliding window: find the window of hits with the most unique tokens.
  let best = { pos: hits[0].pos, uniq: 1, span: 0 };
  let left = 0;
  const seen = new Map();
  for (let right = 0; right < hits.length; right++) {
    const t = hits[right].token;
    seen.set(t, (seen.get(t) || 0) + 1);
    while (hits[right].pos - hits[left].pos > 400) {
      const lt = hits[left].token;
      const n = seen.get(lt) - 1;
      if (n <= 0) seen.delete(lt); else seen.set(lt, n);
      left++;
    }
    const uniq = seen.size;
    const span = hits[right].pos - hits[left].pos;
    // Prefer more unique tokens, then tighter span
    if (uniq > best.uniq || (uniq === best.uniq && span < best.span)) {
      best = { pos: hits[left].pos, uniq, span };
    }
  }
  return best.pos;
}

/* =========================================================================
   BOOKMARKS (Batch 5) — starred records, stored in localStorage
   ========================================================================= */
const BM_KEY = 'uhri_v2_bookmarks_v1';
function bmLoad() { try { return JSON.parse(localStorage.getItem(BM_KEY) || '[]'); } catch { return []; } }
function bmSave(list) { try { localStorage.setItem(BM_KEY, JSON.stringify(list)); } catch {} }
function bmHas(id) { return bmLoad().some(b => b.AnnotationId === id); }
function bmToggle(rec) {
  if (!rec || !rec.AnnotationId) return false;
  const list = bmLoad();
  const idx = list.findIndex(b => b.AnnotationId === rec.AnnotationId);
  if (idx >= 0) {
    list.splice(idx, 1);
    bmSave(list);
    updateBookmarkCount();
    return false;  // removed
  } else {
    const yr = (rec.PublicationDate || '').slice(0, 4);
    const txt = (rec.TextPlainCleaned || rec.Text || '').slice(0, 500);
    list.unshift({
      AnnotationId: rec.AnnotationId,
      Symbol: rec.Symbol,
      PublicationDate: rec.PublicationDate,
      year: yr,
      country: cleanCountryName((rec.Countries || [])[0] || ''),
      body: cleanLabel(rec.Body || ''),
      theme: (rec.Themes || [])[0] || '',
      themes: rec.Themes || [],
      affected: rec.AffectedPersons || [],
      text_snippet: txt,
      bookmarked_at: Date.now(),
    });
    bmSave(list);
    updateBookmarkCount();
    return true;  // added
  }
}
/* =========================================================================
   NOTES — private per-record research notes kept in localStorage
   =========================================================================
   Prywatne notatki użytkownika doklejane do `AnnotationId`. Wyświetlane
   w drawerze obok tekstu + ikonka 📝 na kartach w drawer-list. Czysto
   lokalne (brak serwera), tekstowe, z prostym autosave. */
/* =========================================================================
   RECORD DIFF — pick two records, open a side-by-side comparison modal
   =========================================================================
   Use case: compare two CCPR paragraphs to Turkey 2014 vs 2020, or the
   same theme addressed to two countries. Pin A, pin B, click 'Compare'. */
state.diffPins = [];
function diffPinToggle(rec) {
  if (!rec || !rec.AnnotationId) return 'none';
  const idx = state.diffPins.findIndex(p => p.AnnotationId === rec.AnnotationId);
  if (idx >= 0) {
    state.diffPins.splice(idx, 1);
    _renderDiffTray();
    return 'removed';
  }
  if (state.diffPins.length >= 2) state.diffPins.shift();  // FIFO eviction
  state.diffPins.push(rec);
  _renderDiffTray();
  return 'added';
}
function diffIsPinned(id) { return state.diffPins.some(p => p.AnnotationId === id); }
function _renderDiffTray() {
  let tray = $('#diffTray');
  if (!state.diffPins.length) { if (tray) tray.remove(); return; }
  if (!tray) {
    tray = document.createElement('div');
    tray.id = 'diffTray';
    tray.className = 'diff-tray';
    document.body.appendChild(tray);
  }
  const pins = state.diffPins;
  tray.innerHTML = `
    <div class="dt-label">📌 Pinned for compare · ${pins.length}/2</div>
    <div class="dt-pins">
      ${pins.map((p, i) => `
        <span class="dt-pin" data-idx="${i}" title="${sanitize(p.AnnotationId)}">
          <span class="n">${i === 0 ? 'A' : 'B'}</span>
          <span class="t">${sanitize(cleanCountryName((p.Countries||[])[0]||''))} · ${sanitize(((p.PublicationDate||'').slice(0,4))||'—')}</span>
          <button class="x" data-x="${i}" aria-label="Unpin">×</button>
        </span>`).join('')}
    </div>
    <div class="dt-actions">
      ${pins.length === 2 ? '<button id="diffOpen" class="primary">Compare →</button>' : '<span class="muted">pin one more to compare</span>'}
      <button id="diffClear">clear</button>
    </div>`;
  tray.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => {
    state.diffPins.splice(Number(b.dataset.x), 1);
    _renderDiffTray();
  }));
  $('#diffClear')?.addEventListener('click', () => { state.diffPins = []; _renderDiffTray(); });
  $('#diffOpen')?.addEventListener('click', () => openDiffModal());
}
function openDiffModal() {
  if (state.diffPins.length !== 2) return;
  const [A, B] = state.diffPins;
  const kw = (state.filters.kw || '').trim();
  const render = r => {
    const yr = (r.PublicationDate || '').slice(0, 10);
    const country = cleanCountryName((r.Countries || [])[0] || '—');
    const body = cleanLabel(r.Body || '—');
    const themes = (r.Themes || []).slice(0, 4);
    const groups = (r.AffectedPersons || []).slice(0, 4);
    const sdgs = (r.Sdgs || []).slice(0, 3);
    const txt = r.TextPlainCleaned || r.Text || '';
    return `
      <div class="diff-col">
        <div class="dc-head">
          <div class="dc-yr">${sanitize(yr)}</div>
          <div class="dc-title">${sanitize(country)}</div>
          <div class="dc-sub">${sanitize(body)} · ${sanitize(r.Symbol || '—')}</div>
        </div>
        <dl class="dc-meta">
          ${themes.length ? `<dt>Themes</dt><dd>${themes.map(sanitize).join(' · ')}</dd>` : ''}
          ${groups.length ? `<dt>Groups</dt><dd>${groups.map(sanitize).join(' · ')}</dd>` : ''}
          ${sdgs.length   ? `<dt>SDGs</dt><dd>${sdgs.map(sanitize).join(' · ')}</dd>` : ''}
        </dl>
        <div class="dc-text">${highlightKeyword(txt, kw)}</div>`
      + `</div>`;
  };
  const modal = document.createElement('div');
  modal.className = 'diff-modal';
  modal.innerHTML = `
    <div class="diff-card">
      <div class="diff-head">
        <h2>Side-by-side comparison</h2>
        <div style="flex:1"></div>
        <button id="diffSwap" title="Swap A and B">↔ Swap</button>
        <button id="diffClose" title="Close (Esc)">× Close</button>
      </div>
      <div class="diff-cols">
        <div class="diff-label">A</div>
        <div class="diff-label b">B</div>
        ${render(A)}
        ${render(B)}
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => { modal.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  $('#diffClose', modal).addEventListener('click', close);
  $('#diffSwap', modal).addEventListener('click', () => { state.diffPins.reverse(); close(); openDiffModal(); _renderDiffTray(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

const NOTES_KEY = 'uhri_v2_notes_v1';
function notesLoad() { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch { return {}; } }
function notesSave(obj) { try { localStorage.setItem(NOTES_KEY, JSON.stringify(obj)); } catch {} }
function noteGet(id) { if (!id) return ''; return (notesLoad()[id] || {}).text || ''; }
function noteHas(id) { if (!id) return false; const e = notesLoad()[id]; return !!(e && e.text && e.text.trim()); }
function noteSet(id, text) {
  if (!id) return;
  const all = notesLoad();
  const trimmed = String(text || '').trim();
  if (trimmed) {
    all[id] = { text: trimmed, updated_at: Date.now() };
  } else {
    delete all[id];
  }
  notesSave(all);
}
function updateBookmarkCount() {
  const n = bmLoad().length;
  const badge = $('#tabBookmarks');
  if (badge) badge.textContent = n ? `${n} saved` : '—';
}

function renderBookmarks() {
  const root = $('#view-bookmarks');
  const list = bmLoad();
  if (!list.length) {
    root.innerHTML = `
      <div class="bm-empty">
        <div class="big">No bookmarks yet</div>
        <p>Click the ★ icon next to any record to save it here.<br>
        Keyboard: press <kbd style="border:1px solid var(--line);padding:0 4px;font-family:var(--mono)">b</kbd> with a record selected to toggle.</p>
      </div>`;
    return;
  }
  root.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px">
      <span style="font:10px var(--mono);letter-spacing:.12em;color:var(--dim);text-transform:uppercase">Bookmarked recommendations</span>
      <span style="font-family:var(--serif);font-size:22px">${fmt(list.length)}</span>
      <span style="margin-left:auto;display:flex;gap:6px">
        <button id="bmExport" style="padding:5px 10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);font:10px var(--mono);letter-spacing:.08em;text-transform:uppercase;cursor:pointer">⬇ Export JSON</button>
        <button id="bmClear" style="padding:5px 10px;border:1px solid var(--line);background:var(--paper);color:#b91c1c;font:10px var(--mono);letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Clear all</button>
      </span>
    </div>
    <div class="bm-grid">
      ${list.map((b, i) => `
        <div class="bm-card" data-i="${i}" data-id="${sanitize(b.AnnotationId)}">
          <button class="remove" data-rm="${sanitize(b.AnnotationId)}" title="Remove">×</button>
          <div class="meta">${sanitize(b.year||'—')} · ${sanitize(b.country||'')} · ${sanitize(b.body||'')}</div>
          <div class="tx">${sanitize(b.text_snippet)}${b.text_snippet.length >= 500 ? '…' : ''}</div>
          <div class="tg">
            ${(b.themes||[]).slice(0,2).map(t => `<span>${sanitize(t)}</span>`).join('')}
            ${(b.affected||[]).slice(0,2).map(a => `<span>${sanitize(a)}</span>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
  // Card click opens reader (fetch if we only have snippet)
  $$('#view-bookmarks .bm-card').forEach(card => card.addEventListener('click', async e => {
    if (e.target.classList.contains('remove')) return;
    const id = card.dataset.id;
    const rec = await fetchRecordById(id);
    if (rec) { state.selectedRec = rec; state.currentResultList = [rec]; state.currentResultIndex = 0; renderDrawer(); openReader(rec); }
    else toast('Record not accessible (network offline or VM down)', true, 4000);
  }));
  $$('#view-bookmarks .remove').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const id = btn.dataset.rm;
    bmSave(bmLoad().filter(b => b.AnnotationId !== id));
    updateBookmarkCount();
    renderBookmarks();
  }));
  $('#bmClear')?.addEventListener('click', () => {
    if (confirm('Clear all ' + list.length + ' bookmarks? This cannot be undone.')) {
      bmSave([]); updateBookmarkCount(); renderBookmarks();
    }
  });
  $('#bmExport')?.addEventListener('click', () => {
    downloadBlob(JSON.stringify(list, null, 2), 'application/json', 'uhri-bookmarks-' + new Date().toISOString().slice(0,10) + '.json');
    toast('Exported ' + list.length + ' bookmarks (JSON)', false, 3000);
  });
}

/* =========================================================================
   RECORD DEEP-LINK (#18) — ?sel=<id> or #sel=<id> opens a record directly
   =========================================================================
   Supports two data-source paths:
   1. Offline mode — find locally in offline.data (instant)
   2. VM mode — fetch from /api/data/record/{id} (single-record endpoint)
   Older backends without that endpoint fail gracefully with a toast. */
async function fetchRecordById(id) {
  if (!id) return null;
  if (offline.enabled && offline.data) {
    return offline.data.find(r => r.AnnotationId === id) || null;
  }
  try {
    const res = await fetch(API_BASE + '/api/data/record/' + encodeURIComponent(id));
    if (res.ok) {
      const d = await res.json();
      return d.record || null;
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function handleSelParam() {
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const id = searchParams.get('sel') || hashParams.get('sel');
  if (!id) return;
  const rec = await fetchRecordById(id);
  if (!rec) {
    toast('Record not found: ' + id.slice(0, 12) + '…', true, 4500);
    return;
  }
  state.selectedRec = rec;
  state.currentResultList = [rec];
  state.currentResultIndex = 0;
  renderDrawer();
  openReader(rec);
}
