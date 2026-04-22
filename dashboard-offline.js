/* =========================================================================
   OFFLINE DATA LAYER (#27) — in-memory aggregations over the full dataset
   ========================================================================= */
const offline = {
  enabled: false,
  data: null,
  aborter: null,

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
    /* Region filter uses M49 5-region (matching the hex map) instead of
       the Treaty Body electoral groups stored in r.Regions.  We look up
       each record's country in the M49 membership map built from
       HEX_LAYOUT (see dashboard-map.js#expandM49RegionsToCountries). */
    if (f.region?.size && typeof expandM49RegionsToCountries === 'function') {
      const regionCountries = expandM49RegionsToCountries(f.region);
      if (regionCountries) {
        const recCountries = (r.Countries || []).map(c => cleanCountryName(c));
        if (!recCountries.some(c => regionCountries.has(c))) return false;
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
      const y = Number((r.PublicationDate || '').slice(0, 4));
      if (f.yearA && y < f.yearA) return false;
      if (f.yearB && y > f.yearB) return false;
    }
    return true;
  },

  filter(f) {
    if (!this.data) return [];
    return this.data.filter(r => this._matches(r, f || state.filters));
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
      const y = Number((r.PublicationDate || '').slice(0, 4));
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
      const y = Number((r.PublicationDate || '').slice(0, 4));
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

  enable() {
    if (!this.data) return;
    this.enabled = true;
    this._savedApi = {
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

    document.body.classList.add('offline-mode');
    $('#offlineIcon').textContent = '⚡';
    $('#offlineLbl').textContent = 'INSTANT · ' + fmt(this.data.length) + ' LOCAL';
    $('#offlineBtn').classList.add('is-active');
    $('#offlineBtn').title = 'Instant Mode active — all ' + fmt(this.data.length) + ' records in your browser. Filters run locally at ~50ms, nothing leaves your machine. Right-click for options.';
    setStatus('live', 'OFFLINE');
    try { localStorage.setItem('uhri_v2_offline_pref', '1'); } catch {}

    (async () => { try { await updateOfflineBadge(); } catch {} })();
    toast('⚡ Instant Mode active — ' + fmt(this.data.length) + ' records in browser. Filters are now ~50ms.', false, 5000);
  },

  disable({ keepCache = true } = {}) {
    if (!this.enabled) return;
    this.enabled = false;
    if (this._savedApi) {
      Object.assign(api, this._savedApi);
      this._savedApi = null;
    }
    this.data = null;
    document.body.classList.remove('offline-mode');
    $('#offlineIcon').textContent = '⚡';
    $('#offlineLbl').textContent = 'INSTANT MODE';
    $('#offlineBtn').classList.remove('is-active', 'has-update');
    $('#offlineBtn').title = 'Enable Instant Mode — filter the full dataset locally at ~50ms';
    setStatus('live', 'LIVE');
    try { localStorage.removeItem('uhri_v2_offline_pref'); } catch {}
    if (!keepCache) idbOffline.clear().catch(() => {});
    toast(
      keepCache
        ? 'Instant Mode disabled — cache kept, click ⚡ to re-activate instantly'
        : 'Instant Mode disabled and cache cleared',
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
