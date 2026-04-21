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
  $('#cmdPalette').classList.remove('hidden');
  $('#cmdInput').value = '';
  $('#cmdInput').focus();
  renderPalette('');
}
function closePalette() { $('#cmdPalette').classList.add('hidden'); }

function renderPalette(q) {
  q = (q||'').trim().toLowerCase();
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
    { kind:'ACTION', label:'Open tour',         sub:'4-step walkthrough',   action:()=>{closePalette();startTour();} },
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
// First-visit Overview: drawer starts hidden so the map + analytics get full
// breathing room. Drawer auto-opens when a record / list context is selected
// (renderDrawer does `if (state.selectedRec && TW.drawer===false) TW.drawer=true`).
// After first visit, TW.drawer persists to `true` via the existing tweak write path.
const _firstVisit = !localStorage.getItem('uhri_v2_tour_done');
const TW = { palette: 'archive', density: 'tight', rail: true, drawer: !_firstVisit };
const PALETTES = ['archive', 'terminal', 'ink'];
const PALETTE_PREVIEW = { archive: '#F2EFE8', terminal: '#0b0d0b', ink: '#ffffff' };

function applyTweaks() {
  document.body.dataset.palette = TW.palette;
  document.body.dataset.density = TW.density;
  $('#app').classList.toggle('rail-closed', !TW.rail);
  $('#app').classList.toggle('drawer-closed', !TW.drawer);
  const railTog = $('#railTog'); if (railTog) { railTog.classList.toggle('on', TW.rail); railTog.textContent = TW.rail?'ON':'OFF'; }
  const drawTog = $('#drawerTog'); if (drawTog) { drawTog.classList.toggle('on', TW.drawer); drawTog.textContent = TW.drawer?'ON':'OFF'; }
  const dSel = $('#densitySel'); if (dSel) dSel.value = TW.density;
  $$('#swPalette .sw').forEach(s => s.classList.toggle('active', s.dataset.pal === TW.palette));
  // Topbar preview swatch — shows current palette at a glance
  const preview = $('#twPreview'); if (preview) preview.style.background = PALETTE_PREVIEW[TW.palette] || '#ccc';
  try { localStorage.setItem('uhri_v2_tw', JSON.stringify(TW)); } catch {}
}

function loadTweaks() {
  try { const s = localStorage.getItem('uhri_v2_tw'); if (s) Object.assign(TW, JSON.parse(s)); } catch {}
}

function setPalette(p) { if (PALETTES.includes(p)) { TW.palette = p; applyTweaks(); toast('Palette → ' + p, false, 1800); } }
function cyclePalette() { const i = PALETTES.indexOf(TW.palette); setPalette(PALETTES[(i + 1) % PALETTES.length]); }
function setDensity(d) { if (['tight','cozy','roomy'].includes(d)) { TW.density = d; applyTweaks(); toast('Density → ' + d, false, 1800); } }
function toggleRail() { TW.rail = !TW.rail; applyTweaks(); toast('Rail ' + (TW.rail?'shown':'hidden'), false, 1500); }
function toggleDrawer() { TW.drawer = !TW.drawer; applyTweaks(); toast('Drawer ' + (TW.drawer?'shown':'hidden'), false, 1500); }
/* Reading mode — wide drawer + larger serif text for comfortable reading
   of long recommendations. Toggled via the 📖 button in drawer-head or
   the `r` keyboard shortcut. Cooperates with the existing rail/drawer
   toggles: turning reading mode on force-hides the rail, turning it off
   restores the rail to whatever state the user had. */
const READING_FS_KEY = 'uhri_v2_reading_fs_px';
function _applyReadingFontSize(px) {
  const clamped = Math.max(13, Math.min(28, px));
  document.documentElement.style.setProperty('--reading-fs', clamped + 'px');
  try { localStorage.setItem(READING_FS_KEY, String(clamped)); } catch {}
  return clamped;
}
function bumpReadingFontSize(delta) {
  const app = $('#app') || document.body;
  if (!app.classList.contains('reading-mode')) return;
  const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--reading-fs')) || 17;
  const next = _applyReadingFontSize(cur + delta);
  toast(`Text size: ${next}px`, false, 1200);
}
function toggleReadingMode() {
  const app = $('#app') || document.body;
  const on = !app.classList.contains('reading-mode');
  if (on) {
    TW._preReadingRail = TW.rail;
    TW.rail = false;
    if (!TW.drawer) TW.drawer = true;
    // Restore persisted font size
    try {
      const saved = parseInt(localStorage.getItem(READING_FS_KEY) || '');
      if (saved) _applyReadingFontSize(saved);
    } catch {}
  } else {
    if (TW._preReadingRail !== undefined) { TW.rail = TW._preReadingRail; delete TW._preReadingRail; }
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

function bindTweaks() {
  $$('#swPalette .sw').forEach(s => s.addEventListener('click', () => setPalette(s.dataset.pal)));
  $('#densitySel').addEventListener('change', e => setDensity(e.target.value));
  $('#railTog').addEventListener('click', toggleRail);
  $('#drawerTog').addEventListener('click', toggleDrawer);
  $('#tweaksClose').addEventListener('click', closeTweaks);
  $('#twBtn').addEventListener('click', e => { e.stopPropagation(); toggleTweaks(); });
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
const TOUR_STEPS = [
  { target: '#cmdkBtn',       title: 'Fast jump with ⌘K',     text: 'Fuzzy-search any country, theme, body or view. Two keystrokes — no menus.' },
  { target: '#rail',          title: 'Filter from the rail',  text: 'Country, body, theme, year, SDG — live hit count updates as you click. Clicking a country, theme or SDG on the map also filters here.' },
  { target: '#tabs',          title: 'Eleven workspaces',     text: 'Overview · Country / Group / Theme / SDG / Mechanism profiles · Compare two countries · Search · Bookmarks · Labels · Methodology. Shift-click a country / body / theme in the rail to jump straight to its profile.' },
  { target: '#drawer',        title: 'Drawer follows you',    text: 'Click any record in a list, map cell or search result — it opens here. Use <kbd>j</kbd> / <kbd>k</kbd> to flip between results, <kbd>b</kbd> to bookmark.' },
  { target: '#offlineBtn',    title: '⚡ Instant Mode',       text: 'Load the full dataset (~420 MB) into your browser once — filters drop from ~10 s to ~50 ms, works offline, fully private.' },
  { target: '[data-nav="labels"]', title: 'Build your own labels', text: 'Define each label as a boolean FTS5 query — <em>MUST / AND / NOT</em> term lists. Tag 10–20 examples, hit <strong>⚡ Suggest terms</strong>, and the dashboard proposes candidate terms from your tags. Queries are deterministic, explainable, and exportable as CSV × rules matrices.' },
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

function maybeShowTour() {
  try {
    if (localStorage.getItem('uhri_v2_tour_done')) return;
    // N3: tour spots are anchored via getBoundingClientRect to specific
    // desktop elements (rail, drawer, tabs). On mobile the rail is
    // hidden behind the hamburger and several steps target off-screen
    // elements — the tour pops up in empty space and confuses users.
    // Skip entirely under 960px; mobile users learn via the empty-state
    // CTAs + command palette. Mark as seen so desktop revisits don't
    // re-trigger after the user has been on mobile.
    if (window.innerWidth < 960) {
      localStorage.setItem('uhri_v2_tour_done', 'skipped:mobile');
      return;
    }
    // Delay a beat so the layout settles
    setTimeout(startTour, 900);
  } catch {}
}
