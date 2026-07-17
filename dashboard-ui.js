/* UHRI Dashboard — UI affordances (chrome, not content)
 *
 * Three loosely related UI features extracted from dashboard.html inline:
 *
 *   1. COMMAND PALETTE (⌘K) — openPalette/closePalette/renderPalette. Fuzzy-
 *      searches views + actions + countries + themes + bodies. Result items'
 *      action callbacks reach back into inline functions (navigate, setPalette,
 *      startTour, openShareModal, openSavedViewsModal, bmLoad) — all via lazy
 *      lookup since callbacks only fire after user click.
 *
 *   2. TWEAKS (palette / density / rail / drawer / reading mode) — persistent
 *      user preferences in localStorage. `TW` is a shared mutable state object
 *      exported as a global; inline code (e.g. renderDrawer) reads and writes
 *      TW.drawer when selection changes.
 *
 *   3. ONBOARDING TOUR (#16) — startTour/maybeShowTour. First-visit only, uses
 *      localStorage flag uhri_v2_tour_done. Self-contained; no cross-module
 *      dependencies except $ from helpers.
 *
 * LOAD ORDER
 *   This module runs AFTER dashboard-{helpers,data,route,offline,utils,labels}.js
 *   and BEFORE the inline <script> in dashboard.html. All references resolve via:
 *
 *   (a) From earlier modules (available at top-level):
 *         $, $$                           (helpers)
 *         cleanCountryList, escapeRegex, sanitize  (helpers)
 *         NAME_TO_ISO, ISO_TO_NAME        (helpers)
 *         state                            (data)
 *
 *   (b) From inline (lazy inside handlers/callbacks, safe):
 *         navigate, toast, bmLoad
 *         openShareModal, openSavedViewsModal
 *
 * EXTERNAL SURFACE (what dashboard.html inline reaches into this module for)
 *   openPalette / closePalette / renderPalette
 *   applyTweaks / loadTweaks / bindTweaks
 *   setPalette / cyclePalette / setDensity / toggleRail / toggleDrawer
 *   openTweaks / closeTweaks / toggleTweaks
 *   toggleReadingMode / bumpReadingFontSize
 *   startTour / maybeShowTour
 *   Shared state: TW (mutable object), _firstVisit (bool)
 */

/* =========================================================================
   COMMAND PALETTE
   ========================================================================= */
function openPalette() {
  // a11y: it's a modal dialog — remember what to return focus to, and trap Tab
  // inside it (cmdInput is the only focusable, so Tab just stays put rather
  // than escaping to the page behind the overlay). Esc is handled globally.
  state._cmdReturnFocus = document.activeElement;
  const pal = $('#cmdPalette');
  pal.classList.remove('hidden');
  pal.onkeydown = (e) => { if (e.key === 'Tab') { e.preventDefault(); $('#cmdInput').focus(); } };
  $('#cmdInput').value = '';
  $('#cmdInput').focus();
  renderPalette('');
}
function closePalette() {
  $('#cmdPalette').classList.add('hidden');
  // Restore focus to the control that opened the palette (⌘K from anywhere).
  state._cmdReturnFocus?.focus?.();
  state._cmdReturnFocus = null;
}

function renderPalette(q) {
  const qRaw = (q || '').trim();
  q = qRaw.toLowerCase();
  const countries = cleanCountryList(state.facets?.countries || []);
  const bodies = (state.facets?.bodies || []).filter(b => b && b !== '-').map(b => b.replace(/^-\s*/,''));
  const themes = (state.analytics?.themes?.theme_counts || []).map(t => t.theme);

  // Rank: exact prefix > word-boundary > contains; empty q shows pinned views first
  function scoreMatch(s) {
    if (!q) return 0;
    const lc = s.toLowerCase();
    if (lc === q) return 100;
    if (lc.startsWith(q)) return 80;
    if (new RegExp('\\b' + escapeRegex(q)).test(lc)) return 50;
    if (lc.includes(q)) return 20;
    return -1;
  }
  const matches = s => !q || scoreMatch(s) >= 0;

  // VIEWS (always first when empty; searchable when typing)
  const VIEWS = [
    { kind:'VIEW', label:'Overview', sub:'map + top countries + themes + timeline', score: 100, action:()=>{closePalette();navigate('overview');} },
    { kind:'VIEW', label:'Search results', sub:'paginated full-text', score: 99, action:()=>{closePalette();navigate('search');} },
    { kind:'VIEW', label:'Compare countries', sub:'A vs B side-by-side', score: 98, action:()=>{closePalette();navigate('compare');} },
    { kind:'VIEW', label:'Country profile', sub:`drill into ${ISO_TO_NAME[state.focusCountry]||'a country'}`, score: 97, action:()=>{closePalette();navigate('country');} },
    { kind:'VIEW', label:'Group profile', sub:`drill into ${state.focusGroup||'a concerned group'}`, score: 96.5, action:()=>{closePalette();navigate('group');} },
    { kind:'VIEW', label:'Theme profile', sub:`drill into ${state.focusTheme||'a theme'}`, score: 96, action:()=>{closePalette();navigate('theme');} },
    { kind:'VIEW', label:'SDG profile', sub:`drill into ${state.focusSdg||'an SDG target'}`, score: 95.5, action:()=>{closePalette();navigate('sdg');} },
    { kind:'VIEW', label:'Mechanism profile', sub:`drill into ${state.focusMechanism||'a recommending body'}`, score: 95.3, action:()=>{closePalette();navigate('mechanism');} },
    { kind:'VIEW', label:'Methodology', sub:'about the dataset', score: 95, action:()=>{closePalette();navigate('methodology');} },
    { kind:'VIEW', label:'Bookmarks', sub:`${bmLoad().length} saved records`, score: 94, action:()=>{closePalette();navigate('bookmarks');} },
    { kind:'VIEW', label:'Labels workspace', sub:'boolean rule builder (β)', score: 93, action:()=>{closePalette();navigate('labels');} },
    { kind:'VIEW', label:'About & cite this dataset', sub:'independence, citation, acknowledgements', score: 92, action:()=>{closePalette();navigate('about');} },
  ];

  // ACTIONS — appearance & layout commands surfaced in palette
  const ACTIONS = [
    { kind:'ACTION', label:'Palette: Archive', sub:'warm paper (default)',  action:()=>{closePalette();setPalette('archive');} },
    { kind:'ACTION', label:'Palette: Terminal', sub:'dark green-on-black',  action:()=>{closePalette();setPalette('terminal');} },
    { kind:'ACTION', label:'Palette: Ink',      sub:'white + cobalt',       action:()=>{closePalette();setPalette('ink');} },
    { kind:'ACTION', label:'Density: Tight',    sub:'ultra-compact',        action:()=>{closePalette();setDensity('tight');} },
    { kind:'ACTION', label:'Density: Cozy',     sub:'balanced',             action:()=>{closePalette();setDensity('cozy');} },
    { kind:'ACTION', label:'Density: Roomy',    sub:'comfortable',          action:()=>{closePalette();setDensity('roomy');} },
    { kind:'ACTION', label:'Toggle left rail',  sub:'hide / show filters ([)', action:()=>{closePalette();toggleRail();} },
    { kind:'ACTION', label:'Toggle drawer',     sub:'hide / show record details (])', action:()=>{closePalette();toggleDrawer();} },
    { kind:'ACTION', label:'Open tour',         sub:`${TOUR_STEPS.length}-step walkthrough`,   action:()=>{closePalette();startTour();} },
    { kind:'ACTION', label:'Clear all filters', sub:'reset to baseline',    action:()=>{closePalette();$('#clearFilters').click();} },
    { kind:'ACTION', label:'Share this view',   sub:'copy URL / email / social', action:()=>{closePalette();openShareModal();} },
    { kind:'ACTION', label:'Saved views',       sub:'load / name current state', action:()=>{closePalette();openSavedViewsModal();} },
  ];

  let results = [];
  VIEWS.forEach(v => { if (matches(v.label)) results.push({ ...v, _score: q ? scoreMatch(v.label) + 30 : 200 - VIEWS.indexOf(v) }); });
  ACTIONS.forEach(a => { if (matches(a.label)) results.push({ ...a, _score: q ? scoreMatch(a.label) + 20 : 150 - ACTIONS.indexOf(a) }); });

  // Themes — boosted above countries when query matches a theme word
  themes.forEach(t => {
    const s = scoreMatch(t);
    if (s < 0 && q) return;
    results.push({
      kind: 'THEME', label: t, sub: 'open theme profile', _score: (q ? s : 50) + 10,
      action: () => { state.focusTheme = t; $('#tabTheme').textContent = t; closePalette(); navigate('theme'); }
    });
  });

  countries.forEach(c => {
    const s = scoreMatch(c);
    if (s < 0 && q) return;
    results.push({
      kind: 'COUNTRY', label: c, sub: 'open country profile', _score: q ? s : 40,
      action: () => { state.focusCountry = NAME_TO_ISO[c] || c; $('#tabCountry').textContent = c; closePalette(); navigate('country'); }
    });
  });

  bodies.slice(0, 60).forEach(b => {
    const s = scoreMatch(b);
    if (s < 0 && q) return;
    results.push({
      kind: 'BODY', label: b, sub: 'open mechanism profile', _score: q ? s - 10 : 30,
      action: () => { state.focusMechanism = b; $('#tabMechanism').textContent = b; closePalette(); navigate('mechanism'); }
    });
  });

  // FULL-TEXT SEARCH — searching the corpus is the point of the tool. When the
  // user has typed anything, offer it as the top result so ⌘K runs a real
  // keyword search (not only entity jumps), matching the prominent "Search…"
  // hint. Routes through the same kw filter + onFiltersChanged pipeline the
  // rail keyword box uses.
  if (qRaw) {
    results.push({
      kind: 'SEARCH',
      label: `Search full text for "${qRaw}"`,
      sub: 'find this across all recommendations',
      _score: 1000,
      action: () => {
        const inp = $('#kwInput'); if (inp) inp.value = qRaw;
        if (state.filters) state.filters.kw = qRaw;
        closePalette();
        navigate('search');
        if (typeof onFiltersChanged === 'function') onFiltersChanged();
      }
    });
  }

  // Sort by score desc, then dedupe by label
  results.sort((a, b) => b._score - a._score);
  const seen = new Set();
  results = results.filter(r => { const k = r.kind + ':' + r.label; if (seen.has(k)) return false; seen.add(k); return true; });
  results = results.slice(0, 14);

  $('#cmdResults').innerHTML = results.map((r,i) => `
    <div class="cmd-result ${i===0?'focus':''}" data-i="${i}">
      <div class="kind">${r.kind}</div>
      <div><div>${sanitize(r.label)}</div><div style="color:var(--dim);font-size:10px">${sanitize(r.sub||'')}</div></div>
      <div style="color:var(--dim)">↵</div>
    </div>`).join('');
  $$('#cmdResults .cmd-result').forEach((el,i) => el.addEventListener('click', () => results[i].action()));
  window.__cmdResults = results;
}

/* =========================================================================
   TWEAKS — palette / density / rail / drawer (integrated into topbar)
   =========================================================================
   Three ways to change any of these:
   1. Click THEME button in topbar → dropdown
   2. Keyboard: t (palette cycle), [ (rail), ] (drawer)
   3. Command palette: type "palette archive" / "density cozy" / "toggle rail"
   All changes persist to localStorage. */
// Drawer resting state is CLOSED (declutter 2026-07). It opens the
// instant a record is selected (see renderDrawer), so its content is
// only ever on screen when it's relevant to what the user is doing.
// The old default kept it permanently open to host an at-a-glance
// explainer, which restated FIG.00 and cost ~340px on every view; the
// mechanism descriptions now ride as tooltips on the FIG.00 tiles, and
// the at-a-glance panel survives as the drawer's empty state for anyone
// who opens it via `]`. Persisted choice still wins (loadTweaks).
const _firstVisit = !localStorage.getItem('uhri_v2_tour_done');
const TW = { palette: 'archive', density: 'cozy', rail: true, drawer: false };
const PALETTES = ['archive', 'terminal', 'ink'];
const PALETTE_PREVIEW = { archive: '#F2EFE8', terminal: '#0b0d0b', ink: '#ffffff' };
const DRAWER_W_KEY = 'uhri_v2_drawer_w_px';
const DRAWER_W_DEFAULT = 340;

function _drawerWidthBounds() {
  const vw = window.innerWidth || 1280;
  const rail = ($('#rail')?.getBoundingClientRect().width || parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-w')) || 0);
  const min = 320;
  const mainMin = vw < 1200 ? 340 : 420;
  const layoutMax = Math.max(min, vw - (TW.rail ? rail : 0) - mainMin);
  const max = Math.max(min, Math.min(760, Math.floor(vw * 0.58), layoutMax));
  return { min, max };
}

function setDrawerWidth(px, persist = true) {
  const { min, max } = _drawerWidthBounds();
  const clamped = Math.max(min, Math.min(max, Math.round(px || DRAWER_W_DEFAULT)));
  document.documentElement.style.setProperty('--drawer-w', clamped + 'px');
  const handle = $('#drawerResizeHandle');
  if (handle) {
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(clamped));
  }
  if (persist) {
    try { localStorage.setItem(DRAWER_W_KEY, String(clamped)); } catch {}
  }
  return clamped;
}

function loadDrawerWidth() {
  let saved = DRAWER_W_DEFAULT;
  try {
    const raw = parseInt(localStorage.getItem(DRAWER_W_KEY) || '', 10);
    if (raw) saved = raw;
  } catch {}
  setDrawerWidth(saved, false);
}

function _persistTweaks() {
  // `drawer` is intentionally NOT persisted (declutter 2026-07): its
  // resting state is always closed and it auto-opens on record selection,
  // so persisting it would (a) re-inflate every existing user's saved
  // `drawer:true` from the old always-open era, and (b) pin it open
  // forever after the first record click (auto-open runs applyTweaks).
  const persisted = {
    palette: TW.palette,
    density: TW.density,
    rail: !!TW.rail,
  };
  try { localStorage.setItem('uhri_v2_tw', JSON.stringify(persisted)); } catch {}
}

function applyTweaks() {
  const app = $('#app');
  const reading = !!app?.classList.contains('reading-mode');
  const railVisible = reading ? false : !!TW.rail;
  document.body.dataset.palette = TW.palette;
  document.body.dataset.density = TW.density;
  app?.classList.toggle('rail-closed', !railVisible);
  app?.classList.toggle('drawer-closed', !TW.drawer);
  const railTog = $('#railTog'); if (railTog) { railTog.classList.toggle('on', railVisible); railTog.textContent = railVisible?'ON':'OFF'; }
  const drawTog = $('#drawerTog'); if (drawTog) { drawTog.classList.toggle('on', TW.drawer); drawTog.textContent = TW.drawer?'ON':'OFF'; }
  const dSel = $('#densitySel'); if (dSel) dSel.value = TW.density;
  $$('#swPalette .sw').forEach(s => s.classList.toggle('active', s.dataset.pal === TW.palette));
  // Topbar preview swatch — shows current palette at a glance
  const preview = $('#twPreview'); if (preview) preview.style.background = PALETTE_PREVIEW[TW.palette] || '#ccc';
  _persistTweaks();
}

function loadTweaks() {
  loadDrawerWidth();
  try {
    const s = localStorage.getItem('uhri_v2_tw');
    if (!s) return;
    const saved = JSON.parse(s);
    if (!saved || typeof saved !== 'object') return;
    if (saved.palette) TW.palette = saved.palette;
    if (saved.density) TW.density = saved.density;
    if (typeof saved.rail === 'boolean') TW.rail = saved.rail;
    // `drawer` deliberately not restored — always boots closed (declutter).
    // Migrate legacy snapshots written while reading mode was active. Those
    // used to persist `_preReadingRail` plus `rail:false`, which could leave
    // the left rail hidden forever after pressing R to exit.
    if (typeof saved._preReadingRail === 'boolean') TW.rail = saved._preReadingRail;
  } catch {}
}

function setPalette(p) { if (PALETTES.includes(p)) { TW.palette = p; applyTweaks(); toast('Palette → ' + p, false, 1800); } }
function cyclePalette() { const i = PALETTES.indexOf(TW.palette); setPalette(PALETTES[(i + 1) % PALETTES.length]); }
function setDensity(d) { if (['tight','cozy','roomy'].includes(d)) { TW.density = d; applyTweaks(); toast('Density → ' + d, false, 1800); } }
function toggleRail() { TW.rail = !TW.rail; applyTweaks(); toast('Rail ' + (TW.rail?'shown':'hidden'), false, 1500); }
function toggleDrawer() { TW.drawer = !TW.drawer; applyTweaks(); toast('Drawer ' + (TW.drawer?'shown':'hidden'), false, 1500); }
function closeDrawerPanel() {
  const app = $('#app') || document.body;
  app.classList.remove('reading-mode');
  if (state.drawerMode === 'list' && typeof closeListDrawer === 'function') {
    closeListDrawer();
  }
  state.selectedRec = null;
  state.drawerMode = 'record';
  state.drawerList = null;
  state.currentResultIndex = -1;
  TW.drawer = false;
  window._seSetActiveRecord?.(null);
  window._closeMobileDrawer?.();
  applyTweaks();
  if (typeof renderDrawer === 'function') renderDrawer();
}
/* Reading mode — wide drawer + larger serif text for comfortable reading
   of long recommendations. Toggled via the 📖 button in drawer-head or
   the `r` keyboard shortcut. Cooperates with the existing rail/drawer
   toggles: turning reading mode on force-hides the rail, turning it off
   restores the rail to whatever state the user had. */
const READING_FS_KEY = 'uhri_v2_reading_fs_px';
function _applyReadingFontSize(px) {
  const clamped = Math.max(13, Math.min(28, px));
  // Reading-mode CSS resolves --reading-fs from the .app container, so
  // writing it there (not on :root) ensures A-/A+ actually changes the
  // live drawer text instead of being shadowed by the fallback on .app.
  const host = $('#app') || document.documentElement;
  host.style.setProperty('--reading-fs', clamped + 'px');
  try { localStorage.setItem(READING_FS_KEY, String(clamped)); } catch {}
  return clamped;
}
function bumpReadingFontSize(delta) {
  const app = $('#app') || document.body;
  if (!app.classList.contains('reading-mode')) return;
  const cur = parseInt(getComputedStyle(app).getPropertyValue('--reading-fs')) || 17;
  const next = _applyReadingFontSize(cur + delta);
  toast(`Text size: ${next}px`, false, 1200);
}
function toggleReadingMode() {
  const app = $('#app') || document.body;
  const on = !app.classList.contains('reading-mode');
  if (on) {
    if (!TW.drawer) TW.drawer = true;
    // Restore persisted font size
    try {
      const saved = parseInt(localStorage.getItem(READING_FS_KEY) || '');
      if (saved) _applyReadingFontSize(saved);
    } catch {}
  }
  app.classList.toggle('reading-mode', on);
  applyTweaks();
  toast(on ? '📖 Reading mode · press R to exit · +/- to resize' : 'Reading mode off', false, 1800);
}

function openTweaks() {
  $('#tweaks').classList.add('open');
  $('#twBtn').classList.add('open');
}
function closeTweaks() {
  $('#tweaks').classList.remove('open');
  $('#twBtn').classList.remove('open');
}
function toggleTweaks() {
  if ($('#tweaks').classList.contains('open')) closeTweaks();
  else openTweaks();
}

/* (Focus mode is now the only layout — compact/toggle removed) */

function bindDrawerResize() {
  const handle = $('#drawerResizeHandle');
  if (!handle || handle.dataset.wired === '1') return;
  handle.dataset.wired = '1';
  let startX = 0;
  let startW = DRAWER_W_DEFAULT;
  let nextW = DRAWER_W_DEFAULT;
  let raf = 0;

  const paint = () => {
    raf = 0;
    setDrawerWidth(nextW, false);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(paint);
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    $('#app')?.classList.remove('drawer-resizing');
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    setDrawerWidth(nextW, true);
  };
  const move = (e) => {
    nextW = startW + (startX - e.clientX);
    schedule();
  };

  handle.addEventListener('pointerdown', (e) => {
    if (window.innerWidth < 960) return;
    e.preventDefault();
    if (!TW.drawer) { TW.drawer = true; applyTweaks(); }
    startX = e.clientX;
    startW = $('#drawer')?.getBoundingClientRect().width || DRAWER_W_DEFAULT;
    nextW = startW;
    $('#app')?.classList.add('drawer-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });

  handle.addEventListener('dblclick', () => {
    setDrawerWidth(DRAWER_W_DEFAULT, true);
    toast('Drawer width reset', false, 1200);
  });

  handle.addEventListener('keydown', (e) => {
    if (window.innerWidth < 960) return;
    const cur = $('#drawer')?.getBoundingClientRect().width || DRAWER_W_DEFAULT;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setDrawerWidth(cur + (e.shiftKey ? 80 : 24), true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setDrawerWidth(cur - (e.shiftKey ? 80 : 24), true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setDrawerWidth(DRAWER_W_DEFAULT, true);
    }
  });

  window.addEventListener('resize', () => {
    const cur = $('#drawer')?.getBoundingClientRect().width || DRAWER_W_DEFAULT;
    setDrawerWidth(cur, false);
  });
}

function bindTweaks() {
  $$('#swPalette .sw').forEach(s => s.addEventListener('click', () => setPalette(s.dataset.pal)));
  $('#densitySel').addEventListener('change', e => setDensity(e.target.value));
  $('#railTog').addEventListener('click', toggleRail);
  $('#drawerTog').addEventListener('click', toggleDrawer);
  $('#tweaksClose').addEventListener('click', closeTweaks);
  $('#twBtn').addEventListener('click', e => { e.stopPropagation(); toggleTweaks(); });
  bindDrawerResize();
  // Close when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('#tweaks') && !e.target.closest('#twBtn')) closeTweaks();
  });
}

/* =========================================================================
   ONBOARDING TOUR (#16) — 4-step spotlight for first-time visitors
   =========================================================================
   Shown once, dismissible, skip-all available. Uses localStorage flag
   uhri_v2_tour_done so returning users don't see it again. */
/* Task-first, 4 steps (declutter 2026-07): the old 6-step version led
   with a keyboard shortcut and closed on a ~420 MB download pitch —
   power-user content fronted to first-timers. Steps now follow the
   actual first task (search → map → refine → navigate); power tools
   get one line inside the last step. NOTE: don't target elements that
   are hidden at rest (#drawer is closed by default, #offlineBtn lives
   inside the collapsed DATA menu) — a 0-size rect breaks the spotlight. */
const TOUR_STEPS = [
  { target: '#mainSearch',    title: 'Start with search',     text: 'Full-text across all 267,942 recommendations. Plain words, <code>"exact phrase"</code>, <code>term*</code>, or <code>AND / OR / NOT</code> — syntax help appears under the keyword box in the rail.' },
  { target: '.p-map',         title: '…or click the map',     text: 'Click a country to filter everything; click again to clear. Any record in any list opens in a side reader — <kbd>j</kbd> / <kbd>k</kbd> flips between results, <kbd>b</kbd> bookmarks.' },
  { target: '#rail',          title: 'Refine from the rail',  text: 'Country, body, theme, year, SDG — the hit count at the top reacts live. Collapsed sections expand on click and auto-open whenever they hold an active filter.' },
  { target: '#tabs',          title: 'Workspaces',            text: 'Profiles (Country / Group / Theme / SDG / Mechanism), Compare, Search, Saved. Press <kbd>⌘K</kbd> to jump anywhere; power tools (Instant Mode, Upload, raw data) live under <strong>DATA</strong>.' },
];

function startTour() {
  let step = 0;
  const backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  const pop = document.createElement('div');
  pop.className = 'tour-pop';
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  document.body.appendChild(backdrop);
  document.body.appendChild(spot);
  document.body.appendChild(pop);

  function render() {
    const s = TOUR_STEPS[step];
    const target = document.querySelector(s.target);
    if (!target) { next(); return; }  // skip if target doesn't exist
    // Bring the target into the visible area before measuring. The tabs
    // strip (.tabs) is overflow-x:auto and the Labels tab (10/11) is
    // routinely scrolled off the right edge — without this, the rect
    // is past the viewport and the spotlight lands offscreen while the
    // popup gets clamped back, making it look like the popup is
    // pointing at the wrong element.
    try { target.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch {}
    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.style.top = (r.top - pad) + 'px';
    spot.style.left = (r.left - pad) + 'px';
    spot.style.width = (r.width + pad*2) + 'px';
    spot.style.height = (r.height + pad*2) + 'px';

    pop.innerHTML = `
      <h4>${s.title}</h4>
      <p>${s.text}</p>
      <div class="nav">
        <span class="step">${step + 1} / ${TOUR_STEPS.length}</span>
        <div style="display:flex;gap:6px">
          <button id="tourSkip">Skip</button>
          ${step > 0 ? '<button id="tourPrev">← Back</button>' : ''}
          <button class="primary" id="tourNext">${step === TOUR_STEPS.length - 1 ? 'Done ✓' : 'Next →'}</button>
        </div>
      </div>`;
    // Position popup relative to spotlight — try below, above, right, left,
    // then hard-clamp into the viewport. This protects against tall targets
    // (like the left rail) whose top is near 0 and bottom is past vh, which
    // used to flip the popup to a negative top offscreen.
    const vw = window.innerWidth, vh = window.innerHeight;
    const MARGIN = 20;
    pop.style.visibility = 'hidden';
    pop.style.top = '0'; pop.style.left = '0';
    pop.style.maxHeight = (vh - 40) + 'px';
    pop.style.overflowY = 'auto';
    // measure after forcing layout
    const pr = pop.getBoundingClientRect();
    const spaceBelow = vh - r.bottom - MARGIN;
    const spaceAbove = r.top - MARGIN;
    const spaceRight = vw - r.right - MARGIN;
    const spaceLeft  = r.left - MARGIN;

    let top, left;
    if (spaceBelow >= pr.height + 14) {
      // Below target
      top = r.bottom + 14;
      left = r.left;
    } else if (spaceAbove >= pr.height + 14) {
      // Above target
      top = r.top - pr.height - 14;
      left = r.left;
    } else if (spaceRight >= pr.width + 14) {
      // To the right
      top = Math.max(MARGIN, r.top);
      left = r.right + 14;
    } else if (spaceLeft >= pr.width + 14) {
      // To the left
      top = Math.max(MARGIN, r.top);
      left = r.left - pr.width - 14;
    } else {
      // Nothing fits adjacent — centre it in the viewport
      top = Math.max(MARGIN, (vh - pr.height) / 2);
      left = Math.max(MARGIN, (vw - pr.width) / 2);
    }
    // Final hard clamp so it is *always* fully visible
    top  = Math.max(MARGIN, Math.min(top,  vh - pr.height - MARGIN));
    left = Math.max(MARGIN, Math.min(left, vw - pr.width  - MARGIN));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    pop.style.visibility = 'visible';

    $('#tourSkip', pop).addEventListener('click', finish);
    $('#tourNext', pop).addEventListener('click', next);
    $('#tourPrev', pop)?.addEventListener('click', prev);
  }
  function next() { if (step >= TOUR_STEPS.length - 1) finish(); else { step++; render(); } }
  function prev() { if (step > 0) step--; render(); }
  function finish() {
    try { localStorage.setItem('uhri_v2_tour_done', '1'); } catch {}
    backdrop.remove(); spot.remove(); pop.remove();
    document.removeEventListener('keydown', keyHandler);
    window.removeEventListener('resize', render);
  }
  function keyHandler(e) {
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    else if (e.key === 'ArrowLeft') prev();
  }
  document.addEventListener('keydown', keyHandler);
  backdrop.addEventListener('click', finish);
  window.addEventListener('resize', render);
  render();
}

/* First-visit invite chip — replaces the auto-opened tour popover.
   Declutter 2026-07: the old flow stacked THREE decision layers on the
   very first paint (tour popover + GA consent banner + the live UI).
   Now the consent banner resolves first, then a one-line invite chip
   offers the tour instead of hijacking the screen with it. */
function _showTourInvite() {
  if (document.getElementById('tourInvite')) return;
  const chip = document.createElement('div');
  chip.id = 'tourInvite';
  chip.className = 'tour-invite';
  chip.setAttribute('role', 'status');
  chip.innerHTML = `
    <span>First time here? A 30-second tour shows the basics.</span>
    <button id="tourInviteStart" class="primary" type="button">Start tour</button>
    <button id="tourInviteSkip" type="button" title="Dismiss — the tour stays available in ⌘K">Not now</button>`;
  document.body.appendChild(chip);
  const dismiss = (mark) => {
    if (mark) { try { localStorage.setItem('uhri_v2_tour_done', 'invite-dismissed'); } catch {} }
    chip.remove();
  };
  chip.querySelector('#tourInviteStart').addEventListener('click', () => { chip.remove(); startTour(); });
  chip.querySelector('#tourInviteSkip').addEventListener('click', () => dismiss(true));
  document.addEventListener('keydown', function escInvite(e) {
    if (e.key === 'Escape' && document.body.contains(chip)) {
      document.removeEventListener('keydown', escInvite);
      dismiss(true);
    }
  });
}

function maybeShowTour() {
  try {
    if (localStorage.getItem('uhri_v2_tour_done')) return;
    // N3: tour spots are anchored via getBoundingClientRect to specific
    // desktop elements (rail, tabs). On mobile the rail is hidden behind
    // the hamburger and several steps target off-screen elements — the
    // tour pops up in empty space and confuses users. Skip entirely
    // under 960px; mobile users learn via the empty-state CTAs + command
    // palette. Mark as seen so desktop revisits don't re-trigger after
    // the user has been on mobile.
    if (window.innerWidth < 960) {
      localStorage.setItem('uhri_v2_tour_done', 'skipped:mobile');
      return;
    }
    // Consent first, tour second — never both at once. Wait until the GA
    // banner is answered (or was never inserted: DNT, prior answer, Esc-
    // dismissed). Poll instead of coupling to the analytics module; give
    // up silently after 2 min and try again next visit (nothing marked).
    const t0 = Date.now();
    const tryShow = () => {
      const bannerUp = !!document.getElementById('gaConsent');
      if (!bannerUp && Date.now() - t0 > 1500) { _showTourInvite(); return; }
      if (Date.now() - t0 > 120_000) return;
      setTimeout(tryShow, 500);
    };
    setTimeout(tryShow, 900);
  } catch {}
}
