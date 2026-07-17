/* =========================================================================
   URL STATE (hash)
   ========================================================================= */

function _pushUrlState() {
  const f = state.filters;
  const p = new URLSearchParams();
  if (state.view && state.view !== 'overview') p.set('view', state.view);
  if (f.kw) p.set('q', f.kw);
  if (f.country.size) p.set('country', Array.from(f.country).join(','));
  if (f.body.size) p.set('body', Array.from(f.body).join(','));
  if (f.theme.size) p.set('theme', Array.from(f.theme).join('|'));
  if (f.group.size) p.set('group', Array.from(f.group).join('|'));
  if (f.region.size) p.set('region', Array.from(f.region).join(','));
  if (f.region.size && state.regionTaxonomy === 'unGroups') p.set('rt', 'unGroups');
  if (f.sdg.size) p.set('sdg', Array.from(f.sdg).join(','));
  if (_sdgExactValues(f).length) p.set('sdgx', _sdgExactValues(f).sort().join('|'));
  if (f.type.size) p.set('type', Array.from(f.type).join(','));
  if (f.themesMatch === 'all') p.set('tm', 'all');
  if (f.groupsMatch === 'all') p.set('gm', 'all');
  if (f.yearA && state.facets && f.yearA !== state.facets.min_year) p.set('y1', f.yearA);
  if (f.yearB && state.facets && f.yearB !== state.facets.max_year) p.set('y2', f.yearB);
  if (state.focusCountry) p.set('fc', state.focusCountry);
  if (state.focusTheme) p.set('ft', state.focusTheme);
  if (state.focusGroup) p.set('fg', state.focusGroup);
  if (state.focusSdg) p.set('fsdg', state.focusSdg);
  if (state.focusMechanism) p.set('fm', state.focusMechanism);
  if (state.focusFamily) p.set('mf', state.focusFamily);
  if (state.mechScope && state.mechScope !== 'single') p.set('ms', state.mechScope);
  if (state.cmpA) p.set('ca', state.cmpA);
  if (state.cmpB) p.set('cb', state.cmpB);
  const h = p.toString();
  const newHash = h ? '#' + h : '';
  const base = location.pathname + location.search;
  if (location.hash !== newHash) history.replaceState(null, '', newHash ? base + newHash : base);
}

function _syncRouteTabLabels() {
  // Empty (not "—") when there's no live selection: a `.t-ctx:empty` CSS
  // rule then hides the slot entirely, so inactive profile tabs stop
  // showing placeholder dashes / stale seeded entities (declutter 2026-07).
  const countryTab = $('#tabCountry');
  if (countryTab) countryTab.textContent = state.focusCountry ? (ISO_TO_NAME[state.focusCountry] || state.focusCountry) : '';

  const themeTab = $('#tabTheme');
  if (themeTab) themeTab.textContent = state.focusTheme || '';

  const groupTab = $('#tabGroup');
  if (groupTab) groupTab.textContent = state.focusGroup || '';

  const sdgTab = $('#tabSdg');
  if (sdgTab) sdgTab.textContent = state.focusSdg || '';

  const mechanismTab = $('#tabMechanism');
  if (mechanismTab) {
    if (state.mechScope === 'compare') {
      mechanismTab.textContent = 'All 3 families';
    } else if (state.mechScope === 'family') {
      const fam = MECH_FAMILIES.find(f => f.key === state.focusFamily);
      mechanismTab.textContent = fam?.full || 'Family rollup';
    } else {
      mechanismTab.textContent = state.focusMechanism || '';
    }
  }

  const searchTab = $('#tabSearch');
  if (searchTab) searchTab.textContent = state.filters.kw || '';

  // Consolidated "Profiles" tab (2026-07): its context mirrors the entity
  // of the ACTIVE profile view, so the tab reads "Profiles · Poland" while
  // you're on the Poland profile and stays quiet elsewhere. The per-type
  // spans written above live in the profile-type switcher strip now.
  const profilesTab = $('#tabProfiles');
  if (profilesTab) {
    const v = state.view;
    let ctx = '';
    if (v === 'country') ctx = countryTab?.textContent || '';
    else if (v === 'theme') ctx = themeTab?.textContent || '';
    else if (v === 'group') ctx = groupTab?.textContent || '';
    else if (v === 'sdg') ctx = sdgTab?.textContent || '';
    else if (v === 'mechanism') ctx = mechanismTab?.textContent || '';
    else if (v === 'compare') ctx = (state.cmpA && state.cmpB) ? `${state.cmpA} vs ${state.cmpB}` : 'A vs B';
    profilesTab.textContent = ctx;
  }
}

function _resetRouteState() {
  state.filters = { ...emptyFilters(), yearA: state.facets?.min_year, yearB: state.facets?.max_year };
  state.focusCountry = null;
  state.focusTheme = null;
  state.focusGroup = null;
  state.focusSdg = null;
  state.focusMechanism = null;
  state.focusFamily = null;
  state.mechScope = 'single';
  state.cmpA = null;
  state.cmpB = null;
  state.view = 'overview';
  state.regionTaxonomy = 'm49';
}

async function _applyRouteStateFromHash(hash, opts = {}) {
  const normalized = String(hash || '').replace(/^#/, '');
  if (opts.replaceLocation) {
    const nextHash = normalized ? `#${normalized}` : '';
    const base = location.pathname + location.search;
    const nextUrl = nextHash ? base + nextHash : base;
    const currentUrl = location.pathname + location.search + location.hash;
    if (currentUrl !== nextUrl) history.replaceState(null, '', nextUrl);
  }

  _resetRouteState();
  _restoreUrlState(normalized);
  ['country', 'body', 'theme', 'group', 'region', 'type', 'sdg'].forEach(refreshFacetUI);
  if ($('#kwInput')) $('#kwInput').value = state.filters.kw || '';
  _syncRouteTabLabels();
  renderActiveFilters();
  refreshHitCount();
  await navigate(state.view || 'overview');
}

function _restoreUrlState(hash = location.hash.slice(1)) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return;
  const p = new URLSearchParams(h);
  const f = state.filters;
  if (p.get('q')) { f.kw = p.get('q'); $('#kwInput').value = f.kw; }
  if (p.get('country')) p.get('country').split(',').forEach(v => f.country.add(v));
  if (p.get('body')) p.get('body').split(',').forEach(v => f.body.add(v));
  if (p.get('theme')) p.get('theme').split('|').forEach(v => f.theme.add(v));
  if (p.get('group')) p.get('group').split('|').forEach(v => f.group.add(v));
  if (p.get('region')) p.get('region').split(',').forEach(v => f.region.add(v));
  if (p.get('rt') === 'unGroups') state.regionTaxonomy = 'unGroups';
  if (p.get('sdg')) p.get('sdg').split(',').forEach(v => {
    const n = Number(v);
    if (!Number.isNaN(n)) f.sdg.add(n);
  });
  if (p.get('sdgx')) p.get('sdgx').split('|').forEach(v => {
    const raw = _sdgCanonicalExactValue(v);
    if (raw) f.sdgExact.add(raw);
  });
  if (p.get('type')) p.get('type').split(',').forEach(v => f.type.add(v));
  if (p.get('tm') === 'all') f.themesMatch = 'all';
  if (p.get('gm') === 'all') f.groupsMatch = 'all';
  if (p.get('y1')) f.yearA = Number(p.get('y1'));
  if (p.get('y2')) f.yearB = Number(p.get('y2'));
  if (p.get('fc')) {
    state.focusCountry = p.get('fc');
    $('#tabCountry').textContent = ISO_TO_NAME[state.focusCountry] || state.focusCountry;
  }
  if (p.get('ft')) { state.focusTheme = p.get('ft'); $('#tabTheme').textContent = state.focusTheme; }
  if (p.get('fg')) { state.focusGroup = p.get('fg'); $('#tabGroup').textContent = state.focusGroup; }
  if (p.get('fsdg')) { state.focusSdg = p.get('fsdg'); const t = $('#tabSdg'); if (t) t.textContent = state.focusSdg; }
  if (p.get('fm')) { state.focusMechanism = p.get('fm'); const t = $('#tabMechanism'); if (t) t.textContent = state.focusMechanism; }
  if (p.get('mf')) {
    const family = p.get('mf');
    if (MECH_FAMILIES.some(fam => fam.key === family)) state.focusFamily = family;
  }
  if (p.get('ms')) {
    const scope = p.get('ms');
    if (['single', 'family', 'compare'].includes(scope)) state.mechScope = scope;
  }
  if (p.get('ca')) state.cmpA = p.get('ca');
  if (p.get('cb')) state.cmpB = p.get('cb');
  if (p.get('view')) state.view = p.get('view');

  if (typeof window._syncYearSlider === 'function') window._syncYearSlider();
  $$('#themeMatch button').forEach(b => b.classList.toggle('on', b.dataset.m === f.themesMatch));
  $$('#groupMatch button').forEach(b => b.classList.toggle('on', b.dataset.m === f.groupsMatch));
  if (state.facets?.regions && typeof renderRegionFacet === 'function') renderRegionFacet(state.facets);
  ['country', 'body', 'theme', 'group', 'region', 'type', 'sdg'].forEach(refreshFacetUI);
  _syncRouteTabLabels();
}
