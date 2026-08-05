/* =========================================================================
   OFFLINE DATA LAYER (#27) — in-memory aggregations over the full dataset
   ========================================================================= */
const offline = {
  enabled: false,
  data: null,
  aborter: null,
  // Dataset provenance — distinguishes the two paths that flip the
  // dashboard into local-filter mode. 'vm' = the user downloaded the
  // full cleaned UHRI corpus via Instant Mode; 'upload' = the user
  // loaded their own UHRI export (.xlsx/.json) via the Upload button.
  // UI layers (badge, banner, sidebar hint) branch on this flag so
  // "you are analysing YOUR upload" is loud, not subtle.
  source: null,          // null | 'vm' | 'upload'
  uploadMeta: null,      // null | { filename, size, loadedAt }

  _matches(r, f) {
    if (f.kw && f.kw.trim()) {
      const q = f.kw.trim().toLowerCase();
      const t = (r.TextPlainCleaned || r.Text || '').toLowerCase();
      if (!t.includes(q)) return false;
    }
    if (f.country?.size) {
      const recCountries = (r.Countries || []).map(c => cleanCountryName(c));
      if (!recCountries.some(c => f.country.has(c))) return false;
    }
    if (f.body?.size) {
      const recBody = cleanLabel(r.Body || '');
      const matches = Array.from(f.body).some(b => recBody === b || recBody === cleanLabel(b));
      if (!matches) return false;
    }
    /* Region filter — the semantics depend on which taxonomy the rail
       is showing (state.regionTaxonomy).  Default 'm49' matches via
       country membership computed from HEX_LAYOUT; 'unGroups' matches
       record.Regions directly (Treaty Body electoral groups). */
    if (f.region?.size) {
      const tax = (typeof state !== 'undefined' && state.regionTaxonomy) || 'm49';
      if (tax === 'm49' && typeof expandM49RegionsToCountries === 'function') {
        const regionCountries = expandM49RegionsToCountries(f.region);
        if (regionCountries) {
          const recCountries = (r.Countries || []).map(c => cleanCountryName(c));
          if (!recCountries.some(c => regionCountries.has(c))) return false;
        }
      } else {
        if (!(r.Regions || []).some(rg => f.region.has(rg))) return false;
      }
    }
    if (f.type?.size) {
      const t = cleanLabel(r.AnnotationType || '');
      if (!f.type.has(t)) return false;
    }
    if (f.theme?.size) {
      const rt = r.Themes || [];
      if (f.themesMatch === 'all') {
        for (const sel of f.theme) if (!rt.includes(sel)) return false;
      } else if (!rt.some(t => f.theme.has(t))) {
        return false;
      }
    }
    if (f.group?.size) {
      const ap = r.AffectedPersons || [];
      if (f.groupsMatch === 'all') {
        for (const sel of f.group) if (!ap.includes(sel)) return false;
      } else if (!ap.some(g => f.group.has(g))) {
        return false;
      }
    }
    if (_hasSdgFilters(f) && !_recordMatchesSdgFilters(r.Sdgs || [], f)) return false;
    if (f.yearA || f.yearB) {
      const y = parseRecordYear(r);
      // An undated record cannot sit inside a year range. It was already
      // excluded here, but only because Number('') is 0 and 0 < yearA —
      // with a real NaN both comparisons below are false, so say it outright.
      if (!Number.isFinite(y)) return false;
      if (f.yearA && y < f.yearA) return false;
      if (f.yearB && y > f.yearB) return false;
    }
    return true;
  },

  /* The record side of the country test runs through cleanCountryName();
     the filter side used to arrive raw from the facet vocabulary, so the
     two never met for any label the cleaner rewrites (static audit H-02).
     The rail shows two such labels — "State of Palestine*" and "Kosovo*",
     whose OHCHR observer asterisk is stripped off the record — and picking
     either matched zero records in Instant Mode with no error: the corpus
     simply looked empty for those two states. A `#country=PK`-style deep
     link hits the same wall via the 2-letter fold.

     Normalise once per query rather than inside _matches, which runs per
     record (267,942 of them) — and do it here rather than caching on the
     Set, because several call sites mutate state.filters.country in place
     (dashboard-drawer-list.js:299, dashboard-utils.js:280) and an identity
     cache would go stale. Body already normalises both sides inline; this
     brings country in line with it. */
  _normaliseFilter(f) {
    if (!f?.country?.size) return f;
    return { ...f, country: new Set([...f.country].map(cleanCountryName)) };
  },

  filter(f) {
    if (!this.data) return [];
    const src = this._normaliseFilter(f || state.filters);
    return this.data.filter(r => this._matches(r, src));
  },

  analytics(f) {
    const rows = this.filter(f);
    const themeMap = new Map();
    const apMap = new Map();
    const sdgMap = new Map();
    const yearlyBody = [];
    const yearly = new Map();
    const ybKey = new Map();

    for (const r of rows) {
      (r.Themes || []).forEach(t => themeMap.set(t, (themeMap.get(t) || 0) + 1));
      (r.AffectedPersons || []).forEach(g => apMap.set(g, (apMap.get(g) || 0) + 1));
      (r.Sdgs || []).forEach(s => sdgMap.set(String(s), (sdgMap.get(String(s)) || 0) + 1));
      const y = parseRecordYear(r);   // NaN when undated — see helpers
      const b = r.Body || '';
      if (Number.isFinite(y)) {
        yearly.set(y, (yearly.get(y) || 0) + 1);
        const key = y + '|' + b;
        ybKey.set(key, (ybKey.get(key) || 0) + 1);
      }
    }
    for (const [key, count] of ybKey) {
      const [year, ...bParts] = key.split('|');
      yearlyBody.push({ year: +year, body: bParts.join('|'), count });
    }

    return {
      ok: true,
      requested_sections: ['trends', 'themes', 'text'],
      trends: {
        yearly_counts: Array.from(yearly, ([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
        yearly_body_counts: yearlyBody,
        yearly_region_counts: [],
        yearly_type_counts: [],
        dataset_first_publication_date: null,
        dataset_last_publication_date: null,
      },
      themes: {
        theme_counts: Array.from(themeMap, ([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count),
        yearly_theme_counts: [],
      },
      text: {
        affected_person_counts: Array.from(apMap, ([affected_person, count]) => ({ affected_person, count })).sort((a, b) => b.count - a.count),
        sdg_counts: Array.from(sdgMap, ([sdg, count]) => ({ sdg, count })).sort((a, b) => b.count - a.count),
        bigram_counts: [],
        body_avg_text_length: {},
        sampled: false,
        sample_size: rows.length,
        total_records: rows.length,
      },
    };
  },

  map(f) {
    const rows = this.filter(f);
    const m = new Map();
    for (const r of rows) {
      for (const c of (r.Countries || [])) {
        const nc = cleanCountryName(c);
        m.set(nc, (m.get(nc) || 0) + 1);
      }
    }
    return {
      ok: true,
      total_records: rows.length,
      country_counts: Array.from(m, ([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
    };
  },

  records(f, page = 1, pageSize = 30) {
    const rows = this.filter(f);
    const start = (page - 1) * pageSize;
    return {
      ok: true,
      page,
      page_size: pageSize,
      total_records: rows.length,
      total_pages: Math.max(1, Math.ceil(rows.length / pageSize)),
      records: rows.slice(start, start + pageSize),
    };
  },

  recordsCount(f) {
    return { total_records: this.filter(f).length };
  },

  facets() {
    const data = this.data || [];
    const countries = new Set();
    const bodies = new Set();
    const regions = new Set();
    const types = new Set();
    let minY = 9999;
    let maxY = 0;
    for (const r of data) {
      (r.Countries || []).forEach(c => countries.add(c));
      if (r.Body) bodies.add(r.Body);
      (r.Regions || []).forEach(rg => regions.add(rg));
      if (r.AnnotationType) types.add(r.AnnotationType);
      const y = parseRecordYear(r);   // undated records must not pull minY to 0
      if (Number.isFinite(y)) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return {
      ok: true,
      countries: Array.from(countries).sort(),
      bodies: Array.from(bodies).sort(),
      regions: Array.from(regions).sort(),
      types: Array.from(types).sort(),
      min_year: minY === 9999 ? 2006 : minY,
      max_year: maxY || 2026,
      total_records: data.length,
    };
  },

  enable(opts = {}) {
    if (!this.data) return;
    this.enabled = true;
    // Remember provenance so every downstream UI layer (badge, banner,
    // sidebar hint, toast copy) can branch on it. Default 'vm' keeps
    // backwards compatibility for any caller that still does bare
    // `offline.enable()`.
    this.source = opts.source || 'vm';
    this.uploadMeta = opts.uploadMeta || null;

    /* Snapshot the REAL api only when we are not already installed over it.
       enable() is re-entered without an intervening disable() — a second
       upload, or the download modal being reopened — and re-snapshotting
       then captured the stubs from the first enable(). disable() would
       later "restore" those stubs as the live API while setting data=null,
       so every call returned 0 records under a LIVE status chip, with no
       recovery short of a reload. */
    if (!this._savedApi) this._savedApi = {
      facets: api.facets,
      analytics: api.analytics,
      map: api.map,
      summary: api.summary,
      records: api.records,
      recordsCount: api.recordsCount,
      health: api.health,
    };
    api.facets = () => Promise.resolve(this.facets());
    api.analytics = (f) => Promise.resolve(this.analytics(f || state.filters));
    api.map = (f) => Promise.resolve(this.map(f || state.filters));
    api.summary = (f) => Promise.resolve({ ok: true, total_records: this.filter(f || state.filters).length });
    api.records = (f, page, pageSize) => Promise.resolve(this.records(f || state.filters, page, pageSize));
    api.recordsCount = (f) => Promise.resolve(this.recordsCount(f || state.filters));
    api.health = () => Promise.resolve({ dataset_ready: true, offline: true });

    const isUpload = this.source === 'upload';
    const fn = this.uploadMeta?.filename || '';
    const shortFn = fn.length > 20 ? fn.slice(0, 20) + '…' : fn;

    document.body.classList.add('offline-mode');
    if (isUpload) document.body.classList.add('uploaded-mode');
    else          document.body.classList.remove('uploaded-mode');

    $('#offlineIcon').textContent = isUpload ? '📁' : '⚡';
    $('#offlineLbl').textContent  = isUpload
      ? `${shortFn} · ${fmt(this.data.length)}`
      : `INSTANT · ${fmt(this.data.length)} LOCAL`;
    $('#offlineBtn').classList.add('is-active');
    $('#offlineBtn').title = isUpload
      ? `📁 Analysing your upload: ${fn} (${fmt(this.data.length)} records). Click to swap back to the live dataset.`
      : `Instant Mode active — all ${fmt(this.data.length)} records in your browser. Filters run locally at ~50ms, nothing leaves your machine. Right-click for options.`;
    setStatus('live', isUpload ? 'UPLOAD' : 'OFFLINE');
    // Only VM-sourced offline mode persists across reloads. Uploads are
    // one-shot session data — auto-restoring someone else's random
    // xlsx on next boot would be surprising at best.
    try {
      if (isUpload) localStorage.removeItem('uhri_v2_offline_pref');
      else          localStorage.setItem('uhri_v2_offline_pref', '1');
    } catch {}

    renderUploadIndicators();
    (async () => { try { await updateOfflineBadge(); } catch {} })();
    toast(isUpload
      ? `📁 Viewing your upload: ${fn} · ${fmt(this.data.length)} records. All queries run locally; the live dataset is paused.`
      : `⚡ Instant Mode active — ${fmt(this.data.length)} records in browser. Filters are now ~50ms.`,
      false, 5000);
  },

  disable({ keepCache = true } = {}) {
    if (!this.enabled) return;
    const wasUpload = this.source === 'upload';
    this.enabled = false;
    this.source = null;
    this.uploadMeta = null;
    if (this._savedApi) {
      Object.assign(api, this._savedApi);
      this._savedApi = null;
    }
    this.data = null;
    document.body.classList.remove('offline-mode', 'uploaded-mode');
    $('#offlineIcon').textContent = '⚡';
    $('#offlineLbl').textContent = 'INSTANT MODE';
    $('#offlineBtn').classList.remove('is-active', 'has-update');
    $('#offlineBtn').title = 'Enable Instant Mode — filter the full dataset locally at ~50ms';
    setStatus('live', 'LIVE');
    try { localStorage.removeItem('uhri_v2_offline_pref'); } catch {}
    if (!keepCache) idbOffline.clear().catch(() => {});

    // Tear down banner/pill/sidebar hint. Must run BEFORE the view
    // refresh so the re-rendered views never inherit the upload chrome.
    renderUploadIndicators();

    // Re-sync every surface that caches a count or an analytics dict.
    // `api.*` was just restored to the real VM-backed functions above
    // but nothing has asked them for fresh numbers yet — without these
    // calls the left sidebar keeps showing the upload's hit count while
    // the centre panels gradually refresh on their own schedule (the
    // exact split the user reported: `1,516 matching` next to
    // `127,625 / 119,404 / 20,488`).
    try { if (typeof refreshHitCount === 'function') refreshHitCount(); }
    catch (e) { console.warn('[offline.disable] refreshHitCount failed:', e); }
    try { if (typeof refreshCurrentView === 'function') refreshCurrentView(); }
    catch (e) { console.warn('[offline.disable] refreshCurrentView failed:', e); }

    toast(
      wasUpload
        ? (keepCache ? 'Upload closed — switched back to live VM dataset' : 'Upload closed, local cache cleared')
        : (keepCache ? 'Instant Mode disabled — cache kept, click ⚡ to re-activate instantly' : 'Instant Mode disabled and cache cleared'),
      false, 4000
    );
  },
};
window.__offline = offline;

/* =========================================================================
   TIER 4B — IndexedDB persistence for offline mode
   ========================================================================= */
const idbOffline = {
  DB_NAME: 'uhri-offline',
  DB_VERSION: 1,
  STORE: 'snapshot',
  MAX_AGE_DAYS: 30,

  _open() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          db.createObjectStore(this.STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB open blocked'));
    });
  },

  async getSnapshot() {
    try {
      const db = await this._open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE, 'readonly');
        const req = tx.objectStore(this.STORE).get('current');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('[idbOffline] getSnapshot failed:', e);
      return null;
    }
  },

  async putSnapshot(records, dataset = 'cleaned') {
    const json = JSON.stringify(records);
    let blob;
    let compressed = false;
    try {
      blob = await this._gzip(json);
      compressed = true;
    } catch (e) {
      console.warn('[idbOffline] gzip failed, storing uncompressed:', e);
      blob = new Blob([json], { type: 'application/json' });
    }
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put({
        id: 'current',
        dataset,
        blob,
        compressed,
        total: records.length,
        fetched_at: new Date().toISOString(),
        schema_version: 1,
      });
      tx.oncomplete = () => resolve({ bytes: blob.size, compressed });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IDB txn aborted'));
    });
  },

  async readRecords(snapshot) {
    if (!snapshot || !snapshot.blob) return null;
    if (snapshot.compressed) {
      return JSON.parse(await this._gunzipText(snapshot.blob));
    }
    return JSON.parse(await snapshot.blob.text());
  },

  async clear() {
    try {
      const db = await this._open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE, 'readwrite');
        tx.objectStore(this.STORE).delete('current');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[idbOffline] clear failed:', e);
    }
  },

  ageInDays(snapshot) {
    if (!snapshot || !snapshot.fetched_at) return Infinity;
    return (Date.now() - new Date(snapshot.fetched_at).getTime()) / 86400000;
  },

  isFresh(snapshot) {
    return snapshot && this.ageInDays(snapshot) < this.MAX_AGE_DAYS;
  },

  async _gzip(text) {
    const cs = new CompressionStream('gzip');
    const stream = new Blob([text]).stream().pipeThrough(cs);
    return await new Response(stream).blob();
  },

  async _gunzipText(blob) {
    const ds = new DecompressionStream('gzip');
    return await new Response(blob.stream().pipeThrough(ds)).text();
  },
};
window.__idbOffline = idbOffline;

async function updateOfflineBadge() {
  const btn = document.querySelector('#offlineBtn');
  const lbl = document.querySelector('#offlineLbl');
  if (!btn || !lbl || !offline.enabled) return;

  // Uploads don't live in IDB (they're one-shot session data), so the
  // "records · MB · Xd old" metadata this function surfaces is
  // meaningless for them. Skip the mutation entirely — otherwise the
  // async overwrite here silently clobbers the filename label that
  // enable() just set, which is the exact bug that left users staring
  // at `INSTANT · 1,516 LOCAL` after uploading their own file.
  if (offline.source === 'upload') return;

  const snap = await idbOffline.getSnapshot();
  const age = snap ? idbOffline.ageInDays(snap) : null;
  const n = offline.data ? fmt(offline.data.length) : '?';
  const ageTxt = age == null ? '' : ' · ' + (age < 1 ? 'today' : `${Math.round(age)}d`);
  lbl.textContent = `INSTANT · ${n} LOCAL${ageTxt}`;

  try {
    const res = await fetch(API_BASE + '/api/data/health', { cache: 'no-store' });
    if (!res.ok) return;
    const h = await res.json();
    const vmMod = h && h.modified_at ? new Date(h.modified_at).getTime() : 0;
    const idbMod = snap && snap.fetched_at ? new Date(snap.fetched_at).getTime() : 0;
    if (vmMod && idbMod && vmMod > idbMod) {
      btn.classList.add('has-update');
      btn.title = (btn.title || '').split(' · ')[0] +
        ` · VM has newer data (${new Date(h.modified_at).toISOString().slice(0, 10)}) — right-click → Refresh data`;
    } else {
      btn.classList.remove('has-update');
    }
  } catch {}
}

/* =========================================================================
   UPLOAD INDICATORS — three coordinated surfaces so the user never forgets
   the dashboard is showing THEIR file instead of the live UHRI corpus.
   =========================================================================
   1. Banner strip below the topbar — high-contrast amber, names the file,
      one-click path back to the live dataset. Never hidden by scroll
      position because it sits inside #main above the tab rail.
   2. Source pill in the topbar meta row — mirrors the visual language of
      the existing "DATA · cleaned/raw ▾" pill. Always visible, survives
      scroll on long pages.
   3. Sidebar sub-line under the hit count — tells the user, in the place
      they read numbers most often, that the denominator is their upload.

   All three are idempotently created/removed in a single function.  When
   source !== 'upload' the function simply tears them down, so calling it
   on every enable/disable is safe and cheap. */
function renderUploadIndicators() {
  const isUpload = offline.enabled && offline.source === 'upload';
  const meta = offline.uploadMeta || {};
  const filename = meta.filename || '';
  const count = offline.data?.length || 0;

  // -------- 1. BANNER STRIP ------------------------------------------------
  let banner = document.getElementById('uploadBanner');
  if (isUpload) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'uploadBanner';
      banner.className = 'upload-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      // Insert as the FIRST child of #main so it sits above the tab rail
      // and every view dispatcher (overview, country, compare, ...).
      const main = document.getElementById('main');
      if (main) main.insertBefore(banner, main.firstChild);
    }
    banner.innerHTML = `
      <span class="ub-icon" aria-hidden="true">📁</span>
      <span class="ub-text">
        <strong>Viewing your upload</strong>
        <span class="ub-file" title="${_attrEscape(filename)}">${_attrEscape(filename)}</span>
        · <span class="ub-count">${fmt(count)} records</span>
      </span>
      <span class="ub-note">All filters run locally, nothing leaves your machine.</span>
      <button type="button" class="ub-switch" id="uploadBannerSwitch" title="Close this upload and return to the live VM dataset">↩ Back to live dataset</button>`;
    const btn = banner.querySelector('#uploadBannerSwitch');
    if (btn) btn.onclick = () => offline.disable({ keepCache: true });
  } else if (banner) {
    banner.remove();
  }

  // -------- 2. SOURCE PILL (topbar) ---------------------------------------
  let pill = document.getElementById('sourcePill');
  if (isUpload) {
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'sourcePill';
      pill.type = 'button';
      pill.className = 'ds-pill source-pill';
      pill.setAttribute('aria-label', 'Data source');
      pill.onclick = () => offline.disable({ keepCache: true });
      // Anchor next to the existing "DATA · cleaned" pill so the two
      // chrome-level dataset controls live side by side.
      const anchor = document.querySelector('.ds-pill-wrap');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(pill, anchor);
    }
    const shortFn = filename.length > 22 ? filename.slice(0, 22) + '…' : filename;
    pill.innerHTML = `SOURCE · <span class="ds-val">upload</span> · <span style="font-weight:400;color:var(--dim)">${_attrEscape(shortFn)}</span>`;
    pill.title = `Showing your upload: ${filename} (${fmt(count)} records). Click to switch back to the live VM dataset.`;
  } else if (pill) {
    pill.remove();
  }

  // -------- 3. SIDEBAR SUB-LINE (under hit count) -------------------------
  let hint = document.getElementById('uploadSidebarHint');
  if (isUpload) {
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'uploadSidebarHint';
      hint.className = 'upload-sidebar-hint';
      const fr = document.getElementById('filterResult');
      if (fr) fr.appendChild(hint);
    }
    const shortFn = filename.length > 24 ? filename.slice(0, 24) + '…' : filename;
    hint.innerHTML = `<span class="ush-label">source:</span> <strong title="${_attrEscape(filename)}">${_attrEscape(shortFn)}</strong> · ${fmt(count)} recs`;
  } else if (hint) {
    hint.remove();
  }
}

function _attrEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function showOfflineContextMenu(anchorEl, ev) {
  document.querySelectorAll('.ofl-menu').forEach(el => el.remove());
  if (!offline.enabled) return;

  const menu = document.createElement('div');
  menu.className = 'ofl-menu';
  const rect = anchorEl.getBoundingClientRect();

  const mkItem = (label, handler, opts = {}) => {
    const b = document.createElement('button');
    b.className = 'mi' + (opts.danger ? ' danger' : '');
    b.textContent = label;
    b.addEventListener('click', () => { menu.remove(); handler(); });
    return b;
  };

  (async () => {
    const snap = await idbOffline.getSnapshot();
    const hdr = document.createElement('div');
    hdr.className = 'hdr';
    if (snap) {
      const age = idbOffline.ageInDays(snap);
      const sz = snap.blob ? Math.round(snap.blob.size / (1024 * 1024)) : '?';
      hdr.textContent = `${fmt(offline.data?.length || 0)} records · ${sz} MB · ${Math.round(age)}d old`;
    } else {
      hdr.textContent = 'in-memory only (no cache)';
    }
    menu.prepend(hdr);
  })();

  menu.appendChild(mkItem('↻  Refresh data from VM', () => {
    offline.disable({ keepCache: false });
    showOfflineModal();
  }));
  menu.appendChild(mkItem('⏻  Disable Instant Mode (keep cache)', () => {
    offline.disable({ keepCache: true });
  }));
  const sep = document.createElement('div');
  sep.className = 'sep';
  menu.appendChild(sep);
  menu.appendChild(mkItem('🗑  Clear cache & disable', () => {
    offline.disable({ keepCache: false });
  }, { danger: true }));

  document.body.appendChild(menu);
  const pad = 4;
  const menuWidth = 220;
  const x = Math.min(rect.left, window.innerWidth - menuWidth - pad);
  const y = rect.bottom + pad;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const dismiss = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onEsc);
    }
  };
  const onEsc = (e) => {
    if (e.key === 'Escape') {
      menu.remove();
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onEsc);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onEsc);
  }, 0);

  if (ev) ev.preventDefault();
}

async function loadOfflineFromIDB(onProgress) {
  onProgress && onProgress({ phase: 'reading-cache' });
  const snap = await idbOffline.getSnapshot();
  if (!idbOffline.isFresh(snap)) return 0;
  onProgress && onProgress({ phase: 'decompressing', size: snap.blob?.size || 0 });
  const records = await idbOffline.readRecords(snap);
  if (!Array.isArray(records) || !records.length) return 0;
  offline.data = records;
  onProgress && onProgress({
    phase: 'done-cached',
    count: records.length,
    age_days: idbOffline.ageInDays(snap),
  });
  return records.length;
}

async function runOfflineDownload(onProgress) {
  const url = API_BASE + '/api/data/full?dataset=cleaned';
  const ctrl = new AbortController();
  offline.aborter = ctrl;
  const t0 = performance.now();

  const res = await fetch(url, { signal: ctrl.signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress && onProgress({ received, total, phase: 'download' });
  }

  onProgress && onProgress({ received, total, phase: 'parsing' });
  const blob = new Blob(chunks);
  const text = await blob.text();
  const parsed = JSON.parse(text);
  offline.data = parsed;
  const elapsed = Math.round(performance.now() - t0);
  onProgress && onProgress({ received, total, phase: 'done', elapsed, count: parsed.length });

  (async () => {
    onProgress && onProgress({ phase: 'persisting' });
    try {
      const meta = await idbOffline.putSnapshot(parsed, 'cleaned');
      onProgress && onProgress({ phase: 'persisted', bytes: meta.bytes, compressed: meta.compressed });
    } catch (err) {
      console.warn('[offline] IDB persist failed (continuing in-memory only):', err);
      onProgress && onProgress({ phase: 'persist-failed', error: String(err) });
    }
  })();

  return parsed;
}

function showOfflineModal() {
  const m = document.createElement('div');
  m.className = 'ofl-modal';
  m.innerHTML = `
    <div class="ofl-card">
      <h2>⚡ Instant Mode</h2>
      <p>Download the full cleaned UHRI dataset (<span class="bold">~420 MB</span>) into your browser. Afterwards:</p>
      <ul>
        <li><span class="bold">Instant filters</span> — analytics that currently take ~10s become ~50ms</li>
        <li><span class="bold">Works offline</span> — the dataset lives in your browser for the session</li>
        <li><span class="bold">Fully private</span> — nothing leaves your machine after the initial download; useful for sensitive research</li>
        <li>Close the tab and it's gone — no traces left behind</li>
      </ul>
      <div class="ofl-progress" id="oflProg" style="display:none">
        <div class="lbl" id="oflPhase">downloading…</div>
        <div class="num"><span id="oflPct">0</span>% <span style="font-size:11px;color:var(--dim);margin-left:8px"><span id="oflMb">0</span> MB</span></div>
        <div class="bar"><span id="oflBar" style="width:0%"></span></div>
      </div>
      <div class="ofl-actions">
        <button class="btn-primary" id="oflStart">Download & activate</button>
        <button class="btn-ghost" id="oflCancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(m);

  const close = () => { m.remove(); };
  m.addEventListener('click', e => { if (e.target === m) close(); });
  $('#oflCancel', m).addEventListener('click', () => {
    if (offline.aborter) try { offline.aborter.abort(); } catch {}
    close();
  });
  $('#oflStart', m).addEventListener('click', async () => {
    $('#oflStart', m).disabled = true;
    $('#oflStart', m).textContent = 'Downloading…';
    $('#oflProg', m).style.display = 'block';
    try {
      await runOfflineDownload(({ received, total, phase, count, elapsed }) => {
        const mb = (received / (1024 * 1024)).toFixed(0);
        const pct = total ? Math.min(100, Math.round((received / total) * 100)) : Math.min(95, Math.round(received / (3.5 * 1024 * 1024)));
        $('#oflPhase', m).textContent = phase === 'download' ? 'downloading…' : phase === 'parsing' ? 'parsing JSON…' : `done — ${fmt(count)} records in ${elapsed}ms`;
        $('#oflPct', m).textContent = pct;
        $('#oflMb', m).textContent = mb;
        $('#oflBar', m).style.width = pct + '%';
      });
      offline.enable();
      setTimeout(() => { close(); refreshCurrentView(); refreshHitCount(); }, 600);
    } catch (err) {
      console.error('Offline download failed', err);
      $('#oflPhase', m).textContent = 'failed: ' + err.message;
      $('#oflStart', m).disabled = false;
      $('#oflStart', m).textContent = 'Retry';
    }
  });
}
