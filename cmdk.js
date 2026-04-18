/* =========================================================================
   Command palette (⌘K / Ctrl+K) for the classic UHRI dashboard.

   Design goals:
   - Fully additive — does not touch app.js, no classes renamed, no DOM edits
     outside the palette's own root element
   - Zero dependencies, vanilla JS
   - Navigates by URL hash (classic app.js's _restoreUrlState picks it up
     on hashchange / reload)
   - Fetches facets once on first open, then fuzzy-searches client-side
   ========================================================================= */
(function() {
  'use strict';

  /* Resolve the VM base URL the same way app.js does */
  function getApiBase() {
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get('vm_base');
      if (q) return q.replace(/\/+$/, '');
    } catch {}
    try {
      const stored = localStorage.getItem('un_hr_dashboard_vm_base');
      if (stored) return stored.replace(/\/+$/, '');
    } catch {}
    const isGhPages = /\.github\.io$/i.test(location.hostname);
    return isGhPages ? 'https://150.254.115.204/uhri-api' : '';
  }

  const API_BASE = getApiBase();
  let facets = null;   // {countries, bodies, regions, types}
  let themes = [];     // top theme names from analytics

  /* ---------- styles ---------- */
  const css = `
  .cmdk-root {
    position: fixed; inset: 0; background: rgba(15,15,16,.6); z-index: 10000;
    display: none; align-items: flex-start; justify-content: center;
    padding: 14vh 20px 20px; backdrop-filter: blur(4px);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .cmdk-root.open { display: flex; }
  .cmdk-card {
    background: var(--bg-primary, #fff); color: var(--text-primary, #111);
    width: 100%; max-width: 640px;
    box-shadow: 0 20px 60px rgba(0,0,0,.3);
    border: 1px solid rgba(0,0,0,.08);
  }
  body.theme-dark .cmdk-card {
    background: #1a1a1c; color: #e8e8e8; border-color: rgba(255,255,255,.1);
  }
  .cmdk-input-row {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; border-bottom: 1px solid rgba(0,0,0,.1);
  }
  body.theme-dark .cmdk-input-row { border-bottom-color: rgba(255,255,255,.1); }
  .cmdk-prompt { color: #d97706; font-weight: 700; }
  .cmdk-input-row input {
    flex: 1; border: 0; background: transparent; font-size: 14px; outline: none;
    font-family: inherit; color: inherit;
  }
  .cmdk-esc {
    font-size: 10px; padding: 2px 6px; border: 1px solid rgba(0,0,0,.15);
    color: #888; letter-spacing: .06em;
  }
  body.theme-dark .cmdk-esc { border-color: rgba(255,255,255,.15); }
  .cmdk-results { max-height: 55vh; overflow-y: auto; }
  .cmdk-item {
    display: grid; grid-template-columns: 80px 1fr auto;
    gap: 10px; padding: 8px 16px; font-size: 12px; cursor: pointer;
    border-bottom: 1px dotted rgba(0,0,0,.08);
  }
  body.theme-dark .cmdk-item { border-bottom-color: rgba(255,255,255,.08); }
  .cmdk-item:hover, .cmdk-item.focus {
    background: rgba(0,0,0,.04);
  }
  body.theme-dark .cmdk-item:hover, body.theme-dark .cmdk-item.focus {
    background: rgba(255,255,255,.05);
  }
  .cmdk-kind {
    font-size: 9px; letter-spacing: .16em; color: #888;
    text-transform: uppercase; align-self: center;
  }
  .cmdk-label { display: flex; flex-direction: column; gap: 2px; }
  .cmdk-sub { color: #888; font-size: 10px; }
  .cmdk-enter { color: #888; align-self: center; }
  .cmdk-empty { padding: 40px 20px; text-align: center; color: #888; font-size: 11px; }
  .cmdk-hint {
    position: fixed; bottom: 18px; right: 18px; z-index: 40;
    background: rgba(0,0,0,.85); color: #fff; padding: 6px 10px;
    font-family: ui-monospace, monospace; font-size: 10px;
    letter-spacing: .08em; border-radius: 2px; cursor: pointer;
    opacity: 0; transition: opacity .3s;
  }
  .cmdk-hint.show { opacity: 1; }
  .cmdk-hint kbd {
    background: #333; padding: 1px 5px; border-radius: 2px; margin: 0 2px;
  }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.className = 'cmdk-root';
  root.innerHTML = `
    <div class="cmdk-card">
      <div class="cmdk-input-row">
        <span class="cmdk-prompt">⌘</span>
        <input id="cmdkInput" placeholder="Jump to country, theme, body, tab…" autocomplete="off" />
        <span class="cmdk-esc">esc</span>
      </div>
      <div class="cmdk-results" id="cmdkResults"></div>
    </div>`;
  document.body.appendChild(root);

  const hint = document.createElement('div');
  hint.className = 'cmdk-hint';
  hint.innerHTML = 'Press <kbd>⌘</kbd><kbd>K</kbd> for quick jump';
  document.body.appendChild(hint);
  // Show hint briefly 3s after load, then fade after 6s
  setTimeout(() => hint.classList.add('show'), 3000);
  setTimeout(() => hint.classList.remove('show'), 9000);
  hint.addEventListener('click', openPalette);

  const input = document.getElementById('cmdkInput');
  const resultsEl = document.getElementById('cmdkResults');

  /* ---------- data loading ---------- */
  async function loadFacets() {
    if (facets) return;
    if (!API_BASE) return;
    try {
      const [f, a] = await Promise.all([
        fetch(API_BASE + '/api/data/facets').then(r => r.json()),
        fetch(API_BASE + '/api/data/analytics').then(r => r.json()).catch(() => ({})),
      ]);
      facets = {
        countries: (f.countries || []).filter(n => n && n.length > 2),
        bodies: (f.bodies || []).filter(b => b && b !== '-').map(b => b.replace(/^-\s*/, '')),
        regions: (f.regions || []),
      };
      themes = (a.themes?.theme_counts || []).map(t => t.theme);
    } catch (e) {
      console.warn('[cmdk] facets load failed', e);
    }
  }

  /* ---------- search ---------- */
  function buildResults(query) {
    const q = query.trim().toLowerCase();
    const results = [];

    const matches = s => !q || s.toLowerCase().includes(q);

    // Tab navigation (always first if matching)
    const tabs = [
      { label: 'Overview tab',    sub: 'charts + summary',   kind: 'TAB', id: 'overview' },
      { label: 'Records tab',     sub: 'paginated records',  kind: 'TAB', id: 'data' },
      { label: 'Labeling tab',    sub: 'annotate records',   kind: 'TAB', id: 'labeling' },
      { label: 'Statistics tab',  sub: 'analytics surface',  kind: 'TAB', id: 'statistics' },
    ];
    tabs.forEach(t => { if (matches(t.label)) results.push({ ...t, action: () => navigateTab(t.id) }); });

    if (facets) {
      facets.countries.forEach(c => {
        if (matches(c)) results.push({
          kind: 'COUNTRY', label: c, sub: 'filter by country',
          action: () => navigateFilter({ country: c }),
        });
      });
      themes.forEach(t => {
        if (matches(t)) results.push({
          kind: 'THEME', label: t, sub: 'filter by theme',
          action: () => navigateFilter({ theme: t }),
        });
      });
      facets.bodies.slice(0, 30).forEach(b => {
        if (matches(b)) results.push({
          kind: 'BODY', label: b, sub: 'filter by recommending body',
          action: () => navigateFilter({ body: b }),
        });
      });
      facets.regions.forEach(r => {
        if (matches(r)) results.push({
          kind: 'REGION', label: r, sub: 'filter by region',
          action: () => navigateFilter({ region: r }),
        });
      });
    }

    return results.slice(0, 14);
  }

  function render(q) {
    const items = buildResults(q);
    if (!items.length) {
      resultsEl.innerHTML = '<div class="cmdk-empty">' +
        (facets ? 'No matches — try "colombia", "torture", "upr"…'
                : 'Loading facets from VM…') + '</div>';
      return;
    }
    resultsEl.innerHTML = items.map((r, i) => `
      <div class="cmdk-item ${i === 0 ? 'focus' : ''}" data-i="${i}">
        <div class="cmdk-kind">${r.kind}</div>
        <div class="cmdk-label">
          <span>${escHTML(r.label)}</span>
          <span class="cmdk-sub">${escHTML(r.sub || '')}</span>
        </div>
        <div class="cmdk-enter">↵</div>
      </div>`).join('');
    resultsEl.querySelectorAll('.cmdk-item').forEach((el, i) => {
      el.addEventListener('click', () => items[i].action());
    });
    window.__cmdkLastResults = items;
  }

  function escHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ---------- navigation (via URL hash, picked up by app.js) ---------- */
  function buildHash(fields) {
    const p = new URLSearchParams(location.hash.slice(1));
    if (fields.tab) p.set('tab', fields.tab);
    if (fields.country) {
      const cur = p.get('country');
      p.set('country', cur ? cur + ',' + fields.country : fields.country);
    }
    if (fields.theme) {
      const cur = p.get('theme');
      p.set('theme', cur ? cur + '|' + fields.theme : fields.theme);
    }
    if (fields.body) {
      const cur = p.get('body');
      p.set('body', cur ? cur + ',' + fields.body : fields.body);
    }
    if (fields.region) {
      const cur = p.get('region');
      p.set('region', cur ? cur + ',' + fields.region : fields.region);
    }
    return '#' + p.toString();
  }

  function navigateTab(id) {
    closePalette();
    // Classic's app.js listens for tab clicks and URL state — triggering a
    // tab click is the least invasive way to switch views
    const tabEl = document.querySelector(`.tab-button[data-tab="${id}"]`)
              || document.querySelector(`[data-tab="${id}"]`);
    if (tabEl) tabEl.click();
    else location.hash = '#tab=' + id;
  }

  function navigateFilter(fields) {
    closePalette();
    location.hash = buildHash(fields);
    // Reload so app.js's URL restorer re-applies all filters fresh.
    // In practice the classic dashboard already reads hash on load.
    location.reload();
  }

  /* ---------- open/close ---------- */
  function openPalette() {
    loadFacets();  // fire-and-forget
    root.classList.add('open');
    input.value = '';
    input.focus();
    render('');
    hint.classList.remove('show');
  }

  function closePalette() { root.classList.remove('open'); }

  /* ---------- wire up ---------- */
  input.addEventListener('input', e => render(e.target.value));

  root.addEventListener('click', e => {
    if (e.target === root) closePalette();
  });

  document.addEventListener('keydown', e => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }
    if (!root.classList.contains('open')) return;
    if (e.key === 'Escape') { closePalette(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const items = window.__cmdkLastResults || [];
      const focused = resultsEl.querySelector('.cmdk-item.focus');
      const idx = focused ? Number(focused.dataset.i) : 0;
      if (items[idx]) items[idx].action();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = resultsEl.querySelectorAll('.cmdk-item');
      if (!all.length) return;
      let cur = resultsEl.querySelector('.cmdk-item.focus');
      let i = cur ? Number(cur.dataset.i) : 0;
      i += (e.key === 'ArrowDown') ? 1 : -1;
      i = Math.max(0, Math.min(all.length - 1, i));
      all.forEach(el => el.classList.remove('focus'));
      all[i].classList.add('focus');
      all[i].scrollIntoView({ block: 'nearest' });
    }
  });

  console.log('[cmdk] command palette ready — press ⌘K / Ctrl+K');
})();
