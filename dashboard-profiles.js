/* UHRI Dashboard — profile, mechanism, and compare views
 *
 * Extracted from dashboard.html as the largest remaining render seam.
 * Owns the country/theme/group/SDG/mechanism profile tabs plus the
 * country-vs-country compare view and its preference helpers.
 *
 * LOAD ORDER
 *   Runs after helpers/data/route/offline/utils/ui/timeline/map/search/
 *   filters/years and before the remaining inline script.
 */

/* =========================================================================
   VIEW: COUNTRY PROFILE
   ========================================================================= */
function _profilePickerAnalytics() {
  return state.baselineAnalytics || state.analytics || null;
}

function _ensureProfilePickerAnalytics() {
  if (state.baselineAnalytics) return Promise.resolve(state.baselineAnalytics);
  return api.analytics({}, { scope: 'analytics:profile-picker' }).then(analytics => {
    state.baselineAnalytics = analytics;
    return analytics;
  });
}

function _refreshThemePicker(root, selected, analytics) {
  const select = $('#thSelect');
  if (!select || !root.contains(select) || state.focusTheme !== selected) return;
  const rows = analytics?.themes?.theme_counts || [];
  select.innerHTML = _dropdownOptionsWithCount(
    rows.map(row => row.theme), selected,
    Object.fromEntries(rows.map(row => [row.theme, row.count]))
  );
  select.value = selected;
}

function _refreshGroupPicker(root, selected, analytics) {
  const select = $('#gpSelect');
  if (!select || !root.contains(select) || state.focusGroup !== selected) return;
  const rows = analytics?.text?.affected_person_counts || [];
  select.innerHTML = _dropdownOptionsWithCount(
    rows.map(row => row.affected_person), selected,
    Object.fromEntries(rows.map(row => [row.affected_person, row.count]))
  );
  select.value = selected;
}

function _sdgPickerKey(value) {
  return _sdgTargetKey(value) || String(_sdgToFilterValue(value) || '');
}

function _completeSdgHierarchy(analytics, apiHierarchy = []) {
  const countsByKey = {};
  (analytics?.text?.sdg_counts || []).forEach(row => {
    const key = _sdgPickerKey(row.sdg);
    if (key) countsByKey[key] = Math.max(countsByKey[key] || 0, Number(row.count) || 0);
  });
  (apiHierarchy || []).forEach(goal => {
    countsByKey[String(goal.goal)] = Number(goal.count) || countsByKey[String(goal.goal)] || 0;
    (goal.targets || []).forEach(target => {
      const key = _sdgPickerKey(target.value);
      if (key) countsByKey[key] = Number(target.count) || countsByKey[key] || 0;
    });
  });

  return Object.keys(SDG_NAMES).map(goal => {
    const targets = Object.entries(SDG_TARGET_NAMES)
      .filter(([key]) => key.startsWith(goal + '.'))
      .map(([key, label]) => ({
        value: `SDG ${key}`,
        label: `SDG ${key} — ${label}`,
        count: countsByKey[key] || 0,
      }));
    return {
      goal,
      label: `SDG ${goal} — ${SDG_NAMES[goal]}`,
      count: countsByKey[goal] || targets.reduce((sum, target) => sum + target.count, 0),
      targets,
    };
  });
}

async function renderCountry() {
  const root = $('#view-country');
  const iso = state.focusCountry;
  const name = iso ? (ISO_TO_NAME[iso] || iso) : null;

  if (!iso || !name) {
    root.innerHTML = `<div class="me"><h1>Pick a country</h1><p>Use the command palette (⌘K), the map on the Overview tab, or the country filter in the left rail to choose a country.</p><button class="dr-btn primary" id="openPaletteFromCP">Open command palette</button></div>`;
    $('#openPaletteFromCP')?.addEventListener('click', openPalette);
    return;
  }

  const countries = cleanCountryList(state.facets?.countries || []).sort();
  const countryPickerFilter = _scopedFilter({ country: new Set() });
  const canUseCachedCountryCounts = _railIsEmpty(countryPickerFilter);
  // Cached all-country totals are only valid for the unfiltered profile.
  // Under keyword/rail filters they read as a mixed scope ("China · 2,540"
  // beside a 24-record profile), so render plain names until scoped map
  // counts arrive below.
  const countryCountsByKey = canUseCachedCountryCounts
    ? Object.fromEntries((state._lastCountryCounts || state.analytics?.map?.country_counts || []).map(c => [c.country, c.count]))
    : null;
  const options = _dropdownOptionsWithCount(countries, name, countryCountsByKey);

  root.innerHTML = `
    <div class="cp-head">
      <div>
        <div class="cp-iso">${iso} · COUNTRY PROFILE</div>
        <h1 class="cp-name">${sanitize(name)}</h1>
        <div class="cp-sub">Loading profile…</div>
        <div class="cp-kpis" id="cpKpis"></div>
        <div id="cpRailNote"></div>
      </div>
      <div class="cp-picker">
        <label>Switch country</label>
        <select id="cpSelect">${options}</select>
      </div>
    </div>
    <div class="cp-body">
      <div class="panel" style="grid-column:1 / -1"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.A</span><span class="t">Volume by year</span></div><div class="panel-actions"><span id="cpStackToggle"></span><span id="cpLegend"></span></div></div><div class="tl-wrap" id="cpTime"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.B</span><span class="t">Themes</span></div></div><div class="row-list" id="cpThemes"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.C</span><span class="t">Recommending bodies</span></div></div><div class="row-list" id="cpBodies"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.D</span><span class="t">Concerned groups</span></div></div><div class="row-list" id="cpGroups"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.E</span><span class="t">Top SDGs</span></div></div><div class="row-list" id="cpSdgs"><div class="panel-loading">loading</div></div></div>
      <div class="panel" style="grid-column:1 / -1"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.F</span><span class="t">Sample recommendations</span></div><div class="panel-actions"><button id="cpSeeAll">see all →</button></div></div><div id="cpSamples"><div class="panel-loading">loading</div></div></div>
    </div>`;

  $('#cpSelect').addEventListener('change', e => {
    const newName = e.target.value;
    state.focusCountry = NAME_TO_ISO[newName] || newName;
    $('#tabCountry').textContent = newName;
    navigate('country');
  });

  api.map(countryPickerFilter, { scope: 'country-picker' }).then(mapD => {
    const select = $('#cpSelect');
    if (!select || !root.contains(select)) return;
    const current = select.value || name;
    const scopedCounts = Object.fromEntries((mapD?.country_counts || []).map(c => [c.country, c.count]));
    select.innerHTML = _dropdownOptionsWithCount(countries, current, scopedCounts);
    select.value = current;
    const label = root.querySelector('.cp-picker label');
    if (label) label.textContent = _railIsEmpty(countryPickerFilter) ? 'Switch country' : 'Switch country · current filters';
  }).catch(err => {
    if (err.name !== 'AbortError') console.warn('country picker counts failed', err);
  });

  // Profile view intersects the rail with the focused country (Option B).
  // Cloning rail filter sets so override of `country` doesn't mutate state.
  const countryFilter = _scopedFilter({ country: new Set([name]) });
  // O6: bundled endpoint when rail is empty (common case). Country profile
  // only uses analytics + records in paint() — map is ignored but harmless
  // to fetch (free from MV). Fallback 3-call when rail has filters.
  const cpProfile = _loadProfile('country', name, { country: new Set([name]) });

  const paint = (analytics, records, opts = {}) => {
    updateSparklineCaches(analytics);
    if (!analytics || !records) return;
    const total = records.total_records;
    const themes = analytics?.themes?.theme_counts || [];
    const topTheme = themes[0]?.theme || '—';
    const bodyTotals = {};
    const ybc = analytics?.trends?.yearly_body_counts || [];
    if (Array.isArray(ybc)) {
      ybc.forEach(row => {
        const b = String(row.body||''); if (!b) return;
        bodyTotals[b] = (bodyTotals[b] || 0) + Number(row.count||0);
      });
    } else {
      Object.values(ybc).forEach(m => Object.entries(m).forEach(([b,c]) => bodyTotals[b] = (bodyTotals[b]||0) + c));
    }
    const nBodies = Object.keys(bodyTotals).length;
    const staleBadge = opts.stale ? '<span class="cp-stale-badge">refreshing</span>' : '';

    $('#cpKpis').innerHTML = `
      <div class="cp-kpi"><div class="n">${fmt(total)}</div><div class="l">Total</div></div>
      <div class="cp-kpi"><div class="n">${nBodies}</div><div class="l">Bodies</div></div>
      <div class="cp-kpi"><div class="n">${themes.length}</div><div class="l">Themes</div></div>
      <div class="cp-kpi"><div class="n" style="font-size:16px;max-width:220px;line-height:1.2">${sanitize(topTheme)}</div><div class="l">Leading theme</div></div>`;
    root.querySelector('.cp-sub').innerHTML = `${sanitize(analytics?.trends?.dataset_first_publication_date || '—')} → ${sanitize(analytics?.trends?.dataset_last_publication_date || '—')} · all mechanisms${staleBadge}`;
    _renderRailNoteInto($('#cpRailNote'), 'country');
    root.classList.toggle('stale', !!opts.stale);

    // B+C: profile timeline defaults to family (Overview-style narrative)
    // with a tiny [Family] [By body] toggle in the panel-actions slot.
    // Toggle state is session-scoped in state.profileStackBy and shared
    // across Country/Theme/Group/SDG profiles so flipping once is sticky
    // while the user explores — resets to family on page reload.
    const _cpRenderTl = () => {
      const mode = state.profileStackBy || 'family';
      renderTimeline($('#cpTime'), analytics?.trends?.yearly_body_counts || {}, { legendEl: $('#cpLegend'), interactive: false, stackBy: mode });
      _renderStackToggle($('#cpStackToggle'), mode, (next) => { state.profileStackBy = next; _cpRenderTl(); });
    };
    _cpRenderTl();
    const countryScope = { country: new Set([name]) };
    renderRowList($('#cpThemes'), themes.slice(0,12).map(t => ({ key:t.theme, label:t.theme, v:t.count })), { facet:'theme', sparklines: _themeSparklines, extraFilter: countryScope });
    const bodyRows = Object.entries(bodyTotals).sort((a,b)=>b[1]-a[1]).map(([k,v]) => ({ key:k, label:k, v }));
    renderRowList($('#cpBodies'), bodyRows, { facet:'body', sparklines: _bodySparklines, extraFilter: countryScope });
    const groups = analytics?.text?.affected_person_counts || [];
    renderRowList($('#cpGroups'), groups.slice(0,12).map(g => ({ key:g.affected_person, label:g.affected_person, v:g.count })), { facet:'group', sparklines: _groupSparklines, extraFilter: countryScope });
    const sdgs = analytics?.text?.sdg_counts || [];
    renderRowList($('#cpSdgs'), sdgs.slice(0,12).map(s => ({ key:s.sdg, label:formatSdgLabel(s.sdg), v:s.count })), { facet:'sdg', sparklines: _sdgSparklines, extraFilter: countryScope });

    const sampleEl = $('#cpSamples');
    sampleEl.innerHTML = '';
    state.currentResultList = records.records || [];
    state.currentResultSource = 'country';
    (records.records || []).forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'cp-sample';
      const txt = (r.TextPlainCleaned || r.Text || '').slice(0, 400);
      d.innerHTML = `<div class="meta">${sanitize(r.PublicationDate||'').slice(0,10)} · ${sanitize(cleanLabel(r.Body)||'—')} · ${sanitize((r.Themes||[])[0]||'')}</div><div class="cp-sample-text">${sanitize(txt)}${txt.length>=400?'…':''}</div><span class="cp-sample-arrow">→ read full</span>`;
      d.addEventListener('click', () => { state.selectedRec = r; state.currentResultIndex = i; renderDrawer(); openReader(r); });
      sampleEl.appendChild(d);
    });
    if (!(records.records||[]).length) sampleEl.innerHTML = '<div class="panel-loading" style="padding:20px 0">No sample records</div>';
  };

  if (cpProfile.stale) paint(cpProfile.stale.analytics, cpProfile.stale.records, { stale: true });
  try {
    const d = await cpProfile.fresh;
    paint(d.analytics, d.records, { stale: false });
    $('#cpSeeAll')?.addEventListener('click', () => {
      state.filters.country = new Set([name]);
      refreshFacetUI('country');
      navigate('search');
      onFiltersChanged();
    });
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast('Failed to load country profile: ' + err.message, true); }
  }
}

/* =========================================================================
   VIEW: THEME PROFILE
   ========================================================================= */
async function renderTheme() {
  const root = $('#view-theme');
  const name = state.focusTheme;
  if (!name) {
    root.innerHTML = `<div class="me"><h1>Pick a theme</h1><p>Click a theme in Overview's Top Themes, pick one from the rail, or search via the command palette.</p><button class="dr-btn primary" id="openPaletteFromTh">Open command palette</button></div>`;
    $('#openPaletteFromTh')?.addEventListener('click', openPalette);
    return;
  }

  // Q3a: options annotated with total counts (mirrors SDG dropdown UX)
  const themeCountList = _profilePickerAnalytics()?.themes?.theme_counts || [];
  const themesList = themeCountList.map(t => t.theme);
  const themeCountsByKey = Object.fromEntries(themeCountList.map(t => [t.theme, t.count]));
  const opts = _dropdownOptionsWithCount(themesList, name, themeCountsByKey);

  root.innerHTML = `
    <div class="cp-head">
      <div>
        <div class="cp-iso">THEME PROFILE</div>
        <h1 class="cp-name" style="font-size:42px">${sanitize(name)}</h1>
        <div class="cp-sub">Loading…</div>
        <div class="cp-kpis" id="thKpis"></div>
        <div id="thRailNote"></div>
      </div>
      <div class="cp-picker"><label>Switch theme</label>
        <select id="thSelect">${opts}</select></div>
    </div>
    <div class="cp-body">
      <div class="panel" style="grid-column:1 / span 2"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.A</span><span class="t">Volume over time</span></div><div class="panel-actions"><span id="thStackToggle"></span><span id="thLegend"></span></div></div><div class="tl-wrap" id="thTime"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.B</span><span class="t">Top countries</span></div></div><div class="row-list" id="thCountries"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.C</span><span class="t">Co-occurring themes</span></div></div><div class="row-list" id="thThemes"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.D</span><span class="t">Concerned groups</span></div></div><div class="row-list" id="thGroups"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.E</span><span class="t">Top SDGs</span></div></div><div class="row-list" id="thSdgs"><div class="panel-loading">loading</div></div></div>
      <div class="panel" style="grid-column:1 / span 2"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.F</span><span class="t">Sample recommendations</span></div><div class="panel-actions"><button id="thSeeAll">see all →</button></div></div><div id="thSamples"><div class="panel-loading">loading</div></div></div>
    </div>`;

  $('#thSelect').addEventListener('change', e => {
    state.focusTheme = e.target.value;
    $('#tabTheme').textContent = e.target.value;
    navigate('theme');
  });
  _ensureProfilePickerAnalytics()
    .then(analytics => _refreshThemePicker(root, name, analytics))
    .catch(err => { if (err.name !== 'AbortError') console.warn('theme picker catalog failed', err); });

  // Intersect rail filters with the focused theme (Option B).
  const themeFilter = _scopedFilter({ theme: new Set([name]) });

  // --- SWR: try cache first for instant paint, then refresh in background
  // O6: bundled /profile endpoint (MV-backed). Fallback to 3-call when
  // rail has filters that would narrow below "whole theme" scope.
  const thProfile = _loadProfile('theme', name, { theme: new Set([name]) });

  // Reusable painter — called once with stale (if any) then again with fresh
  const paint = (analytics, mapD, records, opts = {}) => {
    updateSparklineCaches(analytics);
    if (!analytics || !mapD || !records) return;
    const total = records.total_records;
    const countries = mapD.country_counts || [];
    const topC = countries[0]?.country || '—';
    const groups = analytics?.text?.affected_person_counts || [];
    const staleBadge = opts.stale ? '<span class="cp-stale-badge">refreshing</span>' : '';

    $('#thKpis').innerHTML = `
      <div class="cp-kpi"><div class="n">${fmt(total)}</div><div class="l">Total</div></div>
      <div class="cp-kpi"><div class="n">${countries.length}</div><div class="l">Countries</div></div>
      <div class="cp-kpi"><div class="n" style="font-size:16px;max-width:180px;line-height:1.2">${sanitize(topC)}</div><div class="l">Most-cited</div></div>
      <div class="cp-kpi"><div class="n">${groups.length}</div><div class="l">Concerned groups</div></div>`;
    root.querySelector('.cp-sub').innerHTML = `${sanitize(analytics?.trends?.dataset_first_publication_date||'—')} → ${sanitize(analytics?.trends?.dataset_last_publication_date||'—')}${staleBadge}`;
    _renderRailNoteInto($('#thRailNote'), 'theme');
    root.classList.toggle('stale', !!opts.stale);

    const _thRenderTl = () => {
      const mode = state.profileStackBy || 'family';
      renderTimeline($('#thTime'), analytics?.trends?.yearly_body_counts || {}, { legendEl: $('#thLegend'), interactive: false, stackBy: mode, yHeadroom: 1.15 });
      _renderStackToggle($('#thStackToggle'), mode, (next) => { state.profileStackBy = next; _thRenderTl(); });
    };
    _thRenderTl();
    renderRowList($('#thCountries'), countries.slice(0,12).map(c => ({ key:c.country, label:c.country, v:c.count })), { facet:'country' });
    const themes = (analytics?.themes?.theme_counts || []).filter(t => t.theme !== name).slice(0,12);
    renderRowList($('#thThemes'), themes.map(t => ({ key:t.theme, label:t.theme, v:t.count })), { facet:'theme', sparklines: _themeSparklines });
    renderRowList($('#thGroups'), groups.slice(0,12).map(g => ({ key:g.affected_person, label:g.affected_person, v:g.count })), { facet:'group', sparklines: _groupSparklines });
    const sdgs = analytics?.text?.sdg_counts || [];
    renderRowList($('#thSdgs'),   sdgs.slice(0,12).map(s => ({ key:s.sdg, label:formatSdgLabel(s.sdg), v:s.count })), { facet:'sdg', sparklines: _sdgSparklines });

    const sampleEl = $('#thSamples'); sampleEl.innerHTML = '';
    state.currentResultList = records.records || [];
    state.currentResultSource = 'theme';
    (records.records || []).forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'cp-sample';
      const txt = (r.TextPlainCleaned || r.Text || '').slice(0, 400);
      const rCountry = cleanCountryName((r.Countries||[])[0]||'');
      d.innerHTML = `<div class="meta">${sanitize(r.PublicationDate||'').slice(0,10)} · ${sanitize(rCountry)} · ${sanitize(cleanLabel(r.Body))}</div><div class="cp-sample-text">${sanitize(txt)}${txt.length>=400?'…':''}</div><span class="cp-sample-arrow">→ read full</span>`;
      d.addEventListener('click', () => { state.selectedRec = r; state.currentResultIndex = i; renderDrawer(); openReader(r); });
      sampleEl.appendChild(d);
    });
    if (!(records.records||[]).length) sampleEl.innerHTML = '<div class="panel-loading" style="padding:20px 0">No sample records</div>';
  };

  if (thProfile.stale) paint(thProfile.stale.analytics, thProfile.stale.mapD, thProfile.stale.records, { stale: true });
  try {
    const d = await thProfile.fresh;
    paint(d.analytics, d.mapD, d.records, { stale: false });
    $('#thSeeAll')?.addEventListener('click', () => {
      state.filters.theme = new Set([name]);
      refreshFacetUI('theme');
      navigate('search');
      onFiltersChanged();
    });
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast('Failed to load theme profile: ' + err.message, true); }
  }
}

/* =========================================================================
   VIEW: GROUP PROFILE — mirrors Theme profile, scoped by concerned group
   ========================================================================= */
async function renderGroup() {
  const root = $('#view-group');
  const name = state.focusGroup;
  if (!name) {
    root.innerHTML = `<div class="me"><h1>Pick a concerned group</h1><p>Click a group on Overview's Top Groups, use the rail facet, or search via the command palette.</p><button class="dr-btn primary" id="openPaletteFromGp">Open command palette</button></div>`;
    $('#openPaletteFromGp')?.addEventListener('click', openPalette);
    return;
  }
  // Q3a: options annotated with counts
  const groupCountList = _profilePickerAnalytics()?.text?.affected_person_counts || [];
  const groupsList = groupCountList.map(g => g.affected_person);
  const groupCountsByKey = Object.fromEntries(groupCountList.map(g => [g.affected_person, g.count]));
  const opts = _dropdownOptionsWithCount(groupsList, name, groupCountsByKey);
  root.innerHTML = `
    <div class="cp-head">
      <div>
        <div class="cp-iso">CONCERNED GROUP</div>
        <h1 class="cp-name" style="font-size:42px">${sanitize(name)}</h1>
        <div class="cp-sub">Loading…</div>
        <div class="cp-kpis" id="gpKpis"></div>
        <div id="gpRailNote"></div>
      </div>
      <div class="cp-picker"><label>Switch group</label><select id="gpSelect">${opts}</select></div>
    </div>
    <div class="cp-body">
      <div class="panel" style="grid-column:1 / span 2"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.A</span><span class="t">Volume over time</span></div><div class="panel-actions"><span id="gpStackToggle"></span><span id="gpLegend"></span></div></div><div class="tl-wrap" id="gpTime"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.B</span><span class="t">Top countries</span></div></div><div class="row-list" id="gpCountries"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.C</span><span class="t">Top themes</span></div></div><div class="row-list" id="gpThemes"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.D</span><span class="t">Co-occurring groups</span></div></div><div class="row-list" id="gpGroups"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.E</span><span class="t">Top SDGs</span></div></div><div class="row-list" id="gpSdgs"><div class="panel-loading">loading</div></div></div>
      <div class="panel" style="grid-column:1 / span 2"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.F</span><span class="t">Sample recommendations</span></div><div class="panel-actions"><button id="gpSeeAll">see all →</button></div></div><div id="gpSamples"><div class="panel-loading">loading</div></div></div>
    </div>`;
  $('#gpSelect').addEventListener('change', e => {
    state.focusGroup = e.target.value;
    $('#tabGroup').textContent = e.target.value;
    navigate('group');
  });
  _ensureProfilePickerAnalytics()
    .then(analytics => _refreshGroupPicker(root, name, analytics))
    .catch(err => { if (err.name !== 'AbortError') console.warn('group picker catalog failed', err); });
  const filter = _scopedFilter({ group: new Set([name]) });

  // O6: bundled profile endpoint
  const gpProfile = _loadProfile('group', name, { group: new Set([name]) });

  const paint = (analytics, mapD, records, opts = {}) => {
    updateSparklineCaches(analytics);
    if (!analytics || !mapD || !records) return;
    const total = records.total_records;
    const countries = mapD.country_counts || [];
    const themes = analytics?.themes?.theme_counts || [];
    const sdgs = analytics?.text?.sdg_counts || [];
    const topC = countries[0]?.country || '—';
    const staleBadge = opts.stale ? '<span class="cp-stale-badge">refreshing</span>' : '';

    $('#gpKpis').innerHTML = `
      <div class="cp-kpi"><div class="n">${fmt(total)}</div><div class="l">Total</div></div>
      <div class="cp-kpi"><div class="n">${countries.length}</div><div class="l">Countries</div></div>
      <div class="cp-kpi"><div class="n" style="font-size:16px;max-width:180px;line-height:1.2">${sanitize(topC)}</div><div class="l">Most-cited</div></div>
      <div class="cp-kpi"><div class="n">${themes.length}</div><div class="l">Themes</div></div>`;
    root.querySelector('.cp-sub').innerHTML = `${sanitize(analytics?.trends?.dataset_first_publication_date||'—')} → ${sanitize(analytics?.trends?.dataset_last_publication_date||'—')}${staleBadge}`;
    _renderRailNoteInto($('#gpRailNote'), 'group');
    root.classList.toggle('stale', !!opts.stale);
    const _gpRenderTl = () => {
      const mode = state.profileStackBy || 'family';
      renderTimeline($('#gpTime'), analytics?.trends?.yearly_body_counts || {}, { legendEl: $('#gpLegend'), interactive: false, stackBy: mode, yHeadroom: 1.15 });
      _renderStackToggle($('#gpStackToggle'), mode, (next) => { state.profileStackBy = next; _gpRenderTl(); });
    };
    _gpRenderTl();
    renderRowList($('#gpCountries'), countries.slice(0,12).map(c => ({ key:c.country, label:c.country, v:c.count })), { facet:'country' });
    renderRowList($('#gpThemes'), themes.slice(0,12).map(t => ({ key:t.theme, label:t.theme, v:t.count })), { facet:'theme', sparklines: _themeSparklines });
    const coGroups = (analytics?.text?.affected_person_counts || []).filter(g => g.affected_person !== name).slice(0,12);
    renderRowList($('#gpGroups'), coGroups.map(g => ({ key:g.affected_person, label:g.affected_person, v:g.count })), { facet:'group', sparklines: _groupSparklines });
    renderRowList($('#gpSdgs'), sdgs.slice(0,12).map(s => ({ key:s.sdg, label:formatSdgLabel(s.sdg), v:s.count })), { facet:'sdg', sparklines: _sdgSparklines });

    const sampleEl = $('#gpSamples'); sampleEl.innerHTML = '';
    state.currentResultList = records.records || [];
    state.currentResultSource = 'group';
    (records.records || []).forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'cp-sample';
      const txt = (r.TextPlainCleaned || r.Text || '').slice(0, 400);
      d.innerHTML = `<div class="meta">${sanitize(r.PublicationDate||'').slice(0,10)} · ${sanitize(cleanCountryName((r.Countries||[])[0]||''))} · ${sanitize(cleanLabel(r.Body))}</div><div class="cp-sample-text">${sanitize(txt)}${txt.length>=400?'…':''}</div><span class="cp-sample-arrow">→ read full</span>`;
      d.addEventListener('click', () => { state.selectedRec = r; state.currentResultIndex = i; renderDrawer(); openReader(r); });
      sampleEl.appendChild(d);
    });
    if (!(records.records||[]).length) sampleEl.innerHTML = '<div class="panel-loading" style="padding:20px 0">No sample records</div>';
  };

  if (gpProfile.stale) paint(gpProfile.stale.analytics, gpProfile.stale.mapD, gpProfile.stale.records, { stale: true });
  try {
    const d = await gpProfile.fresh;
    paint(d.analytics, d.mapD, d.records, { stale: false });
    $('#gpSeeAll')?.addEventListener('click', () => {
      state.filters.group = new Set([name]);
      refreshFacetUI('group');
      navigate('search');
      onFiltersChanged();
    });
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast('Failed to load group profile: ' + err.message, true); }
  }
}

/* =========================================================================
   VIEW: SDG PROFILE — scoped by SDG target (e.g. "SDG 16.3")
   ========================================================================= */
async function renderSDG() {
  const root = $('#view-sdg');
  const sdg = state.focusSdg;
  if (!sdg) {
    root.innerHTML = `<div class="me"><h1>Pick an SDG</h1><p>Use the SDG grid in the left rail, then click "Open SDG profile". Or search for a specific target via the command palette.</p><button class="dr-btn primary" id="openPaletteFromSp">Open command palette</button></div>`;
    $('#openPaletteFromSp')?.addEventListener('click', openPalette);
    return;
  }
  // Always build from the local UN SDG taxonomy so all 17 goals and every
  // known target remain available. API payloads enrich the catalog with
  // counts but never decide which options exist.
  const hierarchy = _completeSdgHierarchy(
    _profilePickerAnalytics(),
    state.facets?.sdgs_hierarchy || []
  );
  const selectedSdgKey = _sdgPickerKey(sdg);
  const opts = hierarchy.map(g => {
      const goalValue = `SDG ${g.goal}`;
      const goalOpt = `<option value="${sanitize(goalValue)}" ${String(g.goal)===selectedSdgKey?'selected':''}>${sanitize(g.label)}  —  ${fmt(g.count)} recs</option>`;
      const targetOpts = (g.targets || []).map(t => {
        const sel = _sdgPickerKey(t.value) === selectedSdgKey ? 'selected' : '';
        return `<option value="${sanitize(t.value)}" ${sel}>${sanitize(t.label)}  —  ${fmt(t.count)} recs</option>`;
      }).join('');
      return `<optgroup label="SDG ${sanitize(g.goal)} — ${sanitize(SDG_NAMES[g.goal])}">
        ${goalOpt}
        ${targetOpts}
      </optgroup>`;
    }).join('');
  root.innerHTML = `
    <div class="cp-head">
      <div>
        <div class="cp-iso">SUSTAINABLE DEVELOPMENT GOAL</div>
        <h1 class="cp-name" style="font-size:38px">${sanitize(formatSdgLabel(sdg))}</h1>
        <div class="cp-sub">Loading…</div>
        <div class="cp-kpis" id="spKpis"></div>
        <div id="spRailNote"></div>
      </div>
      <div class="cp-picker sdg-picker">
        <label>Switch SDG</label>
        <input type="text" id="spFilter" placeholder="Type to filter 17 goals + targets (e.g. justice)…" autocomplete="off"
               style="width:100%;padding:6px 8px;border:1px solid var(--line);font:11px var(--mono);background:var(--paper);color:var(--ink)">
        <div id="spResults" class="sdg-results" style="display:none"></div>
        <select id="spSelect" style="margin-top:6px;width:100%">${opts}</select>
      </div>
    </div>
    <div class="cp-body">
      <div class="panel" style="grid-column:1 / span 2"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.A</span><span class="t">Volume over time</span></div><div class="panel-actions"><span id="spStackToggle"></span><span id="spLegend"></span></div></div><div class="tl-wrap" id="spTime"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.B</span><span class="t">Top countries</span></div></div><div class="row-list" id="spCountries"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.C</span><span class="t">Top themes</span></div></div><div class="row-list" id="spThemes"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.D</span><span class="t">Concerned groups</span></div></div><div class="row-list" id="spGroups"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.E</span><span class="t">Co-occurring SDGs</span></div></div><div class="row-list" id="spSdgs"><div class="panel-loading">loading</div></div></div>
      <div class="panel" style="grid-column:1 / span 2"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.F</span><span class="t">Sample recommendations</span></div><div class="panel-actions"><button id="spSeeAll">see all →</button></div></div><div id="spSamples"><div class="panel-loading">loading</div></div></div>
    </div>`;
  $('#spSelect').addEventListener('change', e => {
    state.focusSdg = e.target.value;
    $('#tabSdg').textContent = e.target.value.replace(/^SDG /, 'SDG ');
    navigate('sdg');
  });

  // The catalog works immediately; rebuild once baseline counts arrive so
  // count annotations are upgraded without narrowing the available options.
  if (!state.baselineAnalytics) {
    _ensureProfilePickerAnalytics().then(() => {
      if (state.view === 'sdg' && state.focusSdg === sdg && root.contains($('#spSelect'))) navigate('sdg');
    }).catch(err => { if (err.name !== 'AbortError') console.warn('SDG picker catalog failed', err); });
  }

  // Typeahead — shows a visible result panel below the input as the user
  // types, renders a hierarchical (goal → targets) list with match
  // highlighting, keyboard navigation (↑/↓/Enter/Esc), and clicking a
  // result switches the profile.
  const filterInput = $('#spFilter');
  const resultsEl   = $('#spResults');
  const selectEl    = $('#spSelect');
  if (filterInput && resultsEl) {
    let activeIdx = 0;
    let flatMatches = [];

    const pick = (value) => {
      if (!value) return;
      state.focusSdg = value;
      const tabEl = $('#tabSdg'); if (tabEl) tabEl.textContent = value.replace(/^SDG /, 'SDG ');
      navigate('sdg');
    };

    const highlight = (text, q) => {
      if (!q) return sanitize(text);
      const lower = text.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx < 0) return sanitize(text);
      return sanitize(text.slice(0, idx)) + '<mark>' +
             sanitize(text.slice(idx, idx + q.length)) + '</mark>' +
             sanitize(text.slice(idx + q.length));
    };

    const render = (q) => {
      if (!q) {
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';
        flatMatches = [];
        return;
      }
      const ql = q.toLowerCase();
      const out = [];
      flatMatches = [];
      for (const g of hierarchy) {
        const rowsForGoal = [];
        // Goal row itself
        const goalLabel = g.label || `SDG ${g.goal}`;
        if (goalLabel.toLowerCase().includes(ql)) {
          rowsForGoal.push({ value: `SDG ${g.goal}`, label: goalLabel, count: g.count, isGoal: true });
        }
        for (const t of (g.targets || [])) {
          const targetLabel = t.label || formatSdgLabel(t.value);
          if (targetLabel.toLowerCase().includes(ql)) {
            rowsForGoal.push({ value: t.value, label: targetLabel, count: t.count, isGoal: false });
          }
        }
        if (rowsForGoal.length) {
          out.push(`<div class="sr-goal">SDG ${sanitize(g.goal)} · ${sanitize(SDG_NAMES[g.goal] || '')}</div>`);
          for (const r of rowsForGoal) {
            flatMatches.push(r.value);
            out.push(`<div class="sr-item" data-val="${sanitize(r.value)}" data-idx="${flatMatches.length-1}">
              <span class="sr-label">${highlight(r.label, ql)}</span>
              <span class="sr-count">${fmt(r.count)}</span>
            </div>`);
          }
        }
      }
      if (!out.length) {
        resultsEl.innerHTML = `<div class="sr-empty">no SDGs match "${sanitize(q)}"</div>`;
      } else {
        resultsEl.innerHTML = out.join('');
      }
      resultsEl.style.display = 'block';
      activeIdx = 0;
      updateActive();
    };

    const updateActive = () => {
      resultsEl.querySelectorAll('.sr-item').forEach((el, i) => {
        el.classList.toggle('is-active', i === activeIdx);
        if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
      });
    };

    filterInput.addEventListener('input', () => render(filterInput.value.trim()));
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        filterInput.value = '';
        render('');
        return;
      }
      if (!flatMatches.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(flatMatches.length - 1, activeIdx + 1); updateActive(); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); updateActive(); }
      else if (e.key === 'Enter')     { e.preventDefault(); pick(flatMatches[activeIdx]); }
    });
    resultsEl.addEventListener('click', (e) => {
      const item = e.target.closest('.sr-item');
      if (item) pick(item.dataset.val);
    });
    // Focus the filter input on load so the user can type immediately
    setTimeout(() => filterInput.focus(), 50);
  }
  // O6: bundled /profile endpoint handles SDG shorthand → full-label
  // alias backend-side (perf-v6 F2). When rail is empty, hits MV.
  const spProfile = _loadProfile('sdg', sdg, {});

  const paint = (analytics, mapD, records, opts = {}) => {
    updateSparklineCaches(analytics);
    if (!analytics || !mapD || !records) return;
    const total = records.total_records;
    const countries = mapD.country_counts || [];
    const themes = analytics?.themes?.theme_counts || [];
    const groups = analytics?.text?.affected_person_counts || [];
    const staleBadge = opts.stale ? '<span class="cp-stale-badge">refreshing</span>' : '';

    $('#spKpis').innerHTML = `
      <div class="cp-kpi"><div class="n">${fmt(total)}</div><div class="l">Total</div></div>
      <div class="cp-kpi"><div class="n">${countries.length}</div><div class="l">Countries</div></div>
      <div class="cp-kpi"><div class="n">${themes.length}</div><div class="l">Themes</div></div>
      <div class="cp-kpi"><div class="n">${groups.length}</div><div class="l">Groups</div></div>`;
    root.querySelector('.cp-sub').innerHTML = `${sanitize(analytics?.trends?.dataset_first_publication_date||'—')} → ${sanitize(analytics?.trends?.dataset_last_publication_date||'—')}${staleBadge}`;
    _renderRailNoteInto($('#spRailNote'), 'sdg');
    root.classList.toggle('stale', !!opts.stale);
    const _spRenderTl = () => {
      const mode = state.profileStackBy || 'family';
      renderTimeline($('#spTime'), analytics?.trends?.yearly_body_counts || {}, { legendEl: $('#spLegend'), interactive: false, stackBy: mode, yHeadroom: 1.15 });
      _renderStackToggle($('#spStackToggle'), mode, (next) => { state.profileStackBy = next; _spRenderTl(); });
    };
    _spRenderTl();
    renderRowList($('#spCountries'), countries.slice(0,12).map(c => ({ key:c.country, label:c.country, v:c.count })), { facet:'country' });
    renderRowList($('#spThemes'),    themes.slice(0,12).map(t => ({ key:t.theme, label:t.theme, v:t.count })), { facet:'theme', sparklines: _themeSparklines });
    renderRowList($('#spGroups'),    groups.slice(0,12).map(g => ({ key:g.affected_person, label:g.affected_person, v:g.count })), { facet:'group', sparklines: _groupSparklines });
    const coSdgs = (analytics?.text?.sdg_counts || []).filter(s => s.sdg !== sdg).slice(0,12);
    renderRowList($('#spSdgs'), coSdgs.map(s => ({ key:s.sdg, label:formatSdgLabel(s.sdg), v:s.count })), { facet:'sdg', sparklines: _sdgSparklines });

    const sampleEl = $('#spSamples'); sampleEl.innerHTML = '';
    state.currentResultList = records.records || [];
    state.currentResultSource = 'sdg';
    (records.records || []).forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'cp-sample';
      const txt = (r.TextPlainCleaned || r.Text || '').slice(0, 400);
      d.innerHTML = `<div class="meta">${sanitize(r.PublicationDate||'').slice(0,10)} · ${sanitize(cleanCountryName((r.Countries||[])[0]||''))} · ${sanitize(cleanLabel(r.Body))}</div><div class="cp-sample-text">${sanitize(txt)}${txt.length>=400?'…':''}</div><span class="cp-sample-arrow">→ read full</span>`;
      d.addEventListener('click', () => { state.selectedRec = r; state.currentResultIndex = i; renderDrawer(); openReader(r); });
      sampleEl.appendChild(d);
    });
    if (!(records.records||[]).length) sampleEl.innerHTML = '<div class="panel-loading" style="padding:20px 0">No sample records</div>';
  };

  if (spProfile.stale) paint(spProfile.stale.analytics, spProfile.stale.mapD, spProfile.stale.records, { stale: true });
  try {
    const d = await spProfile.fresh;
    paint(d.analytics, d.mapD, d.records, { stale: false });
    $('#spSeeAll')?.addEventListener('click', () => {
      _replaceSdgFilters(sdg);
      refreshFacetUI('sdg');
      navigate('search');
      onFiltersChanged();
    });
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast('Failed to load SDG profile: ' + err.message, true); }
  }
}

/* =========================================================================
   VIEW: MECHANISM PROFILE — scoped to a single recommending body
   =========================================================================
   Mirrors Theme/Group/SDG profile shape but scopes by body (e.g. CCPR,
   UPR, SR on Torture). Uses _scopedFilter so rail intersects normally. */
/* ---------- MECHANISM PROFILE — three scopes ---------------------
   Single tab, three modes controlled by a segmented picker:
     single  — one body (CCPR, CEDAW, SR on Torture, …) — original behaviour
     family  — one family aggregated (all Treaty Bodies, all SP, UPR)
     compare — all three families side-by-side
   Sub-functions below each render one mode; renderMechanism() is the
   dispatcher + picker host. */
async function renderMechanism() {
  const root = $('#view-mechanism');
  const scope = state.mechScope || 'single';

  // Scope picker is always visible; body/family select appears based on scope.
  const scopeBar = `
    <div class="mech-scope" role="tablist" aria-label="Mechanism profile mode">
      <button data-scope="single"  class="${scope==='single'?'on':''}"  role="tab">Single body</button>
      <button data-scope="family"  class="${scope==='family'?'on':''}"  role="tab">Family rollup</button>
      <button data-scope="compare" class="${scope==='compare'?'on':''}" role="tab">Compare all 3</button>
    </div>`;

  if (scope === 'compare') {
    root.innerHTML = `
      <div class="cp-head">
        <div>
          <div class="cp-iso">RECOMMENDING BODY · MECHANISM PROFILE</div>
          <h1 class="cp-name" style="font-size:40px">Compare all three</h1>
          <div class="cp-sub">Side-by-side volume, countries, themes, groups, and SDGs for every UN recommendation family.</div>
        </div>
        <div class="cp-picker" style="align-self:start">${scopeBar}</div>
      </div>
      <div class="mech-compare" id="mcGrid">
        ${MECH_FAMILIES.map(f => `
          <div class="mc-col ${f.cls}" data-family="${f.key}">
            <div class="mc-head">${f.full}</div>
            <div class="mc-sub">${f.desc}</div>
            <div class="mc-kpi" id="mcKpi-${f.key}">—</div>
            <div class="mc-kpi-label">records</div>
            <div class="mc-section">
              <div class="mc-section-title">Top 5 countries</div>
              <div class="row-list" id="mcCountries-${f.key}"><div class="panel-loading">loading</div></div>
            </div>
            <div class="mc-section">
              <div class="mc-section-title">Top 5 themes</div>
              <div class="row-list" id="mcThemes-${f.key}"><div class="panel-loading">loading</div></div>
            </div>
            <div class="mc-section">
              <div class="mc-section-title">Top 5 concerned groups</div>
              <div class="row-list" id="mcGroups-${f.key}"><div class="panel-loading">loading</div></div>
            </div>
          </div>
        `).join('')}
      </div>`;
    _wireScopeBar(root);
    // Fire three parallel analytics calls, one per family (body filter = union of bodies in that family)
    MECH_FAMILIES.forEach(f => {
      const bodies = bodiesInFamily(f.key);
      if (!bodies.length) {
        $(`#mcKpi-${f.key}`).textContent = '0';
        ['mcCountries','mcThemes','mcGroups'].forEach(id => { const el = $(`#${id}-${f.key}`); if (el) el.innerHTML = '<div class="mc-empty">no bodies matched</div>'; });
        return;
      }
      const filter = _scopedFilter({ body: new Set(bodies) });
      Promise.all([
        api.analytics(filter, { scope: 'analytics:family:'+f.key }),
        api.map(filter, { scope: 'map:family:'+f.key }),
        api.recordsCount(filter),
      ]).then(([analytics, mapD, count]) => {
        const k = $(`#mcKpi-${f.key}`); if (k) k.textContent = fmt(count.total_records);
        // Per-family sparkline maps — built LOCALLY from this family's own
        // yearly arrays, never written into the global _themeSparklines /
        // _groupSparklines caches.  Three parallel family fetches land in
        // non-deterministic order; if we used the globals the last one to
        // resolve would clobber the first two (all three columns would
        // render the SP timeline for the UPR and TB rows).  Locals keep
        // every column consistent with its own KPI.
        const themeSparks = _yearlyCountsByKey(analytics?.themes?.yearly_theme_counts, 'theme');
        const groupSparks = _yearlyCountsByKey(analytics?.text?.yearly_affected_person_counts, 'affected_person');
        renderRowList($(`#mcCountries-${f.key}`), (mapD?.country_counts || []).slice(0,5).map(c => ({ key:c.country, label:c.country, v:c.count })), { facet:'country', extraFilter: { body: new Set(bodies) } });
        renderRowList($(`#mcThemes-${f.key}`),    (analytics?.themes?.theme_counts || []).slice(0,5).map(t => ({ key:t.theme, label:t.theme, v:t.count })), { facet:'theme',   extraFilter: { body: new Set(bodies) }, sparklines: themeSparks });
        renderRowList($(`#mcGroups-${f.key}`),    (analytics?.text?.affected_person_counts || []).slice(0,5).map(g => ({ key:g.affected_person, label:g.affected_person, v:g.count })), { facet:'group', extraFilter: { body: new Set(bodies) }, sparklines: groupSparks });
      }).catch(err => {
        if (err.name === 'AbortError') return;
        console.warn('compare family load failed:', f.key, err);
        ['mcCountries','mcThemes','mcGroups'].forEach(id => { const el = $(`#${id}-${f.key}`); if (el) el.innerHTML = '<div class="mc-empty">load failed</div>'; });
      });
    });
    return;
  }

  // --- single + family share the same 6-figure layout ---
  // Decide target: body name (single) or family key (family). If neither,
  // default family to treaty (biggest / most-familiar) in family mode,
  // or show picker-empty state in single mode.
  let target, title, eyebrow, filterOverride, picker, headerClass;
  if (scope === 'family') {
    if (!state.focusFamily) state.focusFamily = 'treaty';
    const fam = MECH_FAMILIES.find(f => f.key === state.focusFamily);
    const bodies = bodiesInFamily(state.focusFamily);
    target = state.focusFamily;
    title = fam.full;
    eyebrow = `FAMILY ROLLUP · ${bodies.length} ${bodies.length === 1 ? 'body' : 'bodies'}`;
    filterOverride = { body: new Set(bodies) };
    headerClass = fam.cls;
    // Q3a: family picker also gets counts (UPR · 133,510 / Treaty Bodies · 70,420 etc.)
    const famCounts = _computeMechCounts() || { upr: 0, treaty: 0, sp: 0 };
    picker = `
      <label>Family</label>
      <select id="mpFamSelect">
        ${MECH_FAMILIES.map(f => {
          const c = famCounts[f.key];
          const tail = (c != null && c > 0) ? ` · ${fmt(c)}` : '';
          return `<option value="${f.key}" ${f.key===state.focusFamily?'selected':''}>${f.full}${tail}</option>`;
        }).join('')}
      </select>`;
  } else {
    const bodies = (state.facets?.bodies || [])
      .filter(b => b && b !== '-')
      .map(b => b.replace(/^-\s*/, ''));
    if (!state.focusMechanism && bodies.length) state.focusMechanism = bodies[0];
    if (!state.focusMechanism) {
      root.innerHTML = `
        <div class="cp-head">
          <div>
            <div class="cp-iso">RECOMMENDING BODY · MECHANISM PROFILE</div>
            <h1 class="cp-name" style="font-size:44px">Pick a body</h1>
            <div class="cp-sub">Use the command palette (⌘K → "Mechanism profile"), shift-click a body in the rail, or click a body in Overview.</div>
          </div>
          <div class="cp-picker" style="align-self:start">${scopeBar}</div>
        </div>`;
      _wireScopeBar(root);
      return;
    }
    target = state.focusMechanism;
    title = state.focusMechanism;
    eyebrow = 'RECOMMENDING BODY · MECHANISM PROFILE';
    filterOverride = { body: new Set([state.focusMechanism]) };
    const famKey = classifyBody(state.focusMechanism);
    const fam = MECH_FAMILIES.find(f => f.key === famKey);
    headerClass = fam?.cls || '';
    // Q3a+b: optgroup by mechanism family (UPR → TB → SP) with totals.
    // Prevents UPR from sorting alphabetically between SR and WG bodies
    // in the flat list, and surfaces the body's record count as the SDG
    // dropdown already does.
    const bodyCounts = _bodyTotalsFromAnalytics();
    const opts = _bodyDropdownGroupedOptions(bodies, state.focusMechanism, bodyCounts);
    picker = `<label>Switch body</label><select id="mpSelect">${opts}</select>`;
  }

  root.innerHTML = `
    <div class="cp-head">
      <div class="cp-family-header ${headerClass}">
        <div class="cp-iso">${eyebrow}</div>
        <h1 class="cp-name" style="font-size:48px">${sanitize(title)}</h1>
        <div class="cp-sub">Loading…</div>
        <div class="cp-kpis" id="mpKpis"></div>
        <div id="mpRailNote"></div>
      </div>
      <div class="cp-picker" style="display:flex;flex-direction:column;gap:10px;align-items:flex-end">
        ${scopeBar}
        <div>${picker}</div>
      </div>
    </div>
    <div class="cp-body">
      <div class="panel" style="grid-column:1 / span 2"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.A</span><span class="t">Volume over time</span></div><div class="panel-actions" id="mpLegend"></div></div><div class="tl-wrap" id="mpTime"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.B</span><span class="t">Top countries</span></div></div><div class="row-list" id="mpCountries"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.C</span><span class="t">Top themes</span></div></div><div class="row-list" id="mpThemes"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.D</span><span class="t">Concerned groups</span></div></div><div class="row-list" id="mpGroups"><div class="panel-loading">loading</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.E</span><span class="t">Top SDGs</span></div></div><div class="row-list" id="mpSdgs"><div class="panel-loading">loading</div></div></div>
      <div class="panel" style="grid-column:1 / span 2"><div class="panel-head"><div class="panel-title"><span class="idx">FIG.F</span><span class="t">Sample recommendations</span></div><div class="panel-actions"><button id="mpSeeAll">see all →</button></div></div><div id="mpSamples"><div class="panel-loading">loading</div></div></div>
    </div>`;
  _wireScopeBar(root);

  // Scope-specific picker change handlers
  $('#mpSelect')?.addEventListener('change', e => {
    state.focusMechanism = e.target.value;
    $('#tabMechanism').textContent = e.target.value;
    navigate('mechanism');
  });
  $('#mpFamSelect')?.addEventListener('change', e => {
    state.focusFamily = e.target.value;
    const fam = MECH_FAMILIES.find(f => f.key === e.target.value);
    if (fam) $('#tabMechanism').textContent = fam.full;
    navigate('mechanism');
  });

  const cacheKey = scope + ':' + target;
  const filter = _scopedFilter(filterOverride);

  // O6: single-body mode uses the bundled /profile endpoint (MV-backed,
  // <50ms warm). Family + compare modes stay on the 3-call path because
  // they pass multi-body filters that /profile can't express.
  const useBundle = (scope === 'single');
  let anSwr, mpSwr, rcSwr, profileLoader;
  if (useBundle) {
    profileLoader = _loadProfile('body', target, filterOverride);
  } else {
    anSwr = swr('analytics:mech:'+cacheKey, filter, () => api.analytics(filter));
    mpSwr = swr('map:mech:'+cacheKey,       filter, () => api.map(filter));
    rcSwr = swr('records:mech:'+cacheKey,   filter, () => api.records(filter, 1, 5));
  }

  const paint = (analytics, mapD, records, opts = {}) => {
    updateSparklineCaches(analytics);
    if (!analytics || !mapD || !records) return;
    const total = records.total_records;
    const countries = mapD.country_counts || [];
    const themes = analytics?.themes?.theme_counts || [];
    const groups = analytics?.text?.affected_person_counts || [];
    const sdgs = analytics?.text?.sdg_counts || [];
    const topC = countries[0]?.country || '—';
    const staleBadge = opts.stale ? '<span class="cp-stale-badge">refreshing</span>' : '';

    $('#mpKpis').innerHTML = `
      <div class="cp-kpi"><div class="n">${fmt(total)}</div><div class="l">Total</div></div>
      <div class="cp-kpi"><div class="n">${countries.length}</div><div class="l">Countries</div></div>
      <div class="cp-kpi"><div class="n">${themes.length}</div><div class="l">Themes</div></div>
      <div class="cp-kpi"><div class="n" style="font-size:16px;max-width:180px;line-height:1.2">${sanitize(topC)}</div><div class="l">Most-cited</div></div>`;
    root.querySelector('.cp-sub').innerHTML = `${sanitize(analytics?.trends?.dataset_first_publication_date||'—')} → ${sanitize(analytics?.trends?.dataset_last_publication_date||'—')}${staleBadge}`;
    _renderRailNoteInto($('#mpRailNote'), 'body');
    root.classList.toggle('stale', !!opts.stale);

    renderTimeline($('#mpTime'), analytics?.trends?.yearly_body_counts || {}, { legendEl: $('#mpLegend'), interactive: false });
    const extraFilter = filterOverride;
    renderRowList($('#mpCountries'), countries.slice(0,12).map(c => ({ key:c.country, label:c.country, v:c.count })), { facet:'country', extraFilter });
    renderRowList($('#mpThemes'),    themes.slice(0,12).map(t => ({ key:t.theme, label:t.theme, v:t.count })), { facet:'theme', sparklines: _themeSparklines, extraFilter });
    renderRowList($('#mpGroups'),    groups.slice(0,12).map(g => ({ key:g.affected_person, label:g.affected_person, v:g.count })), { facet:'group', sparklines: _groupSparklines, extraFilter });
    renderRowList($('#mpSdgs'),      sdgs.slice(0,12).map(s => ({ key:s.sdg, label:formatSdgLabel(s.sdg), v:s.count })), { facet:'sdg', sparklines: _sdgSparklines, extraFilter });

    const sampleEl = $('#mpSamples'); sampleEl.innerHTML = '';
    state.currentResultList = records.records || [];
    state.currentResultSource = 'mechanism';
    (records.records || []).forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'cp-sample';
      const txt = (r.TextPlainCleaned || r.Text || '').slice(0, 400);
      const rCountry = cleanCountryName((r.Countries || [])[0] || '');
      d.innerHTML = `<div class="meta">${sanitize((r.PublicationDate || '').slice(0,10))} · ${sanitize(rCountry)} · ${sanitize(cleanLabel(r.Body))}</div><div class="cp-sample-text">${sanitize(txt)}${txt.length>=400?'…':''}</div><span class="cp-sample-arrow">→ read full</span>`;
      d.addEventListener('click', () => { state.selectedRec = r; state.currentResultIndex = i; renderDrawer(); openReader(r); });
      sampleEl.appendChild(d);
    });
    if (!(records.records || []).length) sampleEl.innerHTML = '<div class="panel-loading" style="padding:20px 0">No sample records</div>';
  };

  if (useBundle) {
    if (profileLoader.stale) paint(profileLoader.stale.analytics, profileLoader.stale.mapD, profileLoader.stale.records, { stale: true });
  } else if (anSwr.stale && mpSwr.stale && rcSwr.stale) {
    paint(anSwr.stale, mpSwr.stale, rcSwr.stale, { stale: true });
  }
  try {
    let analytics, mapD, records;
    if (useBundle) {
      const d = await profileLoader.fresh;
      analytics = d.analytics; mapD = d.mapD; records = d.records;
    } else {
      [analytics, mapD, records] = await Promise.all([anSwr.fresh, mpSwr.fresh, rcSwr.fresh]);
    }
    paint(analytics, mapD, records, { stale: false });
    $('#mpSeeAll')?.addEventListener('click', () => {
      // "See all" pipes the current scope into the rail filter + Search tab.
      state.filters.body = new Set(Array.from(filterOverride.body || []));
      refreshFacetUI('body');
      navigate('search');
      onFiltersChanged();
    });
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast('Failed to load Mechanism profile: ' + err.message, true); }
  }
}

/* Bind scope-picker buttons in the Mechanism tab header to switch modes. */
function _wireScopeBar(root) {
  root.querySelectorAll('.mech-scope button[data-scope]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const next = btn.dataset.scope;
      if (next === state.mechScope) return;
      state.mechScope = next;
      // Update tab label to match new mode
      const tab = $('#tabMechanism');
      if (tab) {
        if (next === 'compare') tab.textContent = 'All 3 families';
        else if (next === 'family') {
          const fam = MECH_FAMILIES.find(f => f.key === (state.focusFamily || 'treaty'));
          tab.textContent = fam?.full || 'Family rollup';
        } else if (state.focusMechanism) {
          tab.textContent = state.focusMechanism;
        }
      }
      navigate('mechanism');
    });
  });
}

/* =========================================================================
   VIEW: COMPARE (A vs B)
   ========================================================================= */
/* D5: Compare A/B default resolution. Three layers of priority:
    1. URL params  ?compareA=Poland&compareB=Germany — link-shareable
    2. localStorage — last user choice, persists across sessions
    3. Alphabetical — neutral cold-start (first two non-empty country names)
   The old "top-by-volume" default (China vs Colombia) was removed because
   it pinned the first Compare view to the most politically scrutinised
   state, reading as editorial choice in a research tool. Tag: compare-d5. */
const CMP_A_KEY = 'uhri_v2_compare_a';
const CMP_B_KEY = 'uhri_v2_compare_b';

function _resolveCompareDefaults() {
  const countries = cleanCountryList(state.facets?.countries || []).slice().sort();
  if (!countries.length) return;

  // Layer 1: URL params (wins over everything)
  let chosenA = null, chosenB = null;
  try {
    const u = new URL(location.href);
    const qa = u.searchParams.get('compareA');
    const qb = u.searchParams.get('compareB');
    if (qa && countries.includes(qa)) chosenA = qa;
    if (qb && countries.includes(qb)) chosenB = qb;
  } catch {}

  // Layer 2: localStorage
  if (!chosenA) {
    try { const v = localStorage.getItem(CMP_A_KEY); if (v && countries.includes(v)) chosenA = v; } catch {}
  }
  if (!chosenB) {
    try { const v = localStorage.getItem(CMP_B_KEY); if (v && countries.includes(v)) chosenB = v; } catch {}
  }

  // Layer 3: alphabetical (skip duplicates so A !== B)
  if (!chosenA) chosenA = countries[0];
  if (!chosenB) chosenB = countries.find(c => c !== chosenA) || countries[1] || countries[0];

  state.cmpA = chosenA;
  state.cmpB = chosenB;
}

function _persistCompareChoice() {
  // Save current pair locally, then let the shared hash serializer carry
  // it for copy-links, saved views, and back/forward.
  try {
    if (state.cmpA) localStorage.setItem(CMP_A_KEY, state.cmpA);
    if (state.cmpB) localStorage.setItem(CMP_B_KEY, state.cmpB);
  } catch {}
  _pushUrlState();
}

async function renderCompare() {
  const root = $('#view-compare');
  const countries = cleanCountryList(state.facets?.countries || []).sort();
  // Defaults resolved once at boot (_resolveCompareDefaults in boot()).
  // Keep the guards so direct nav to Compare without boot init still works.
  if (!state.cmpA) _resolveCompareDefaults();
  if (!state.cmpA) state.cmpA = countries[0] || null;
  if (!state.cmpB) state.cmpB = countries[1] || null;
  const opts = name => countries.map(c => `<option value="${sanitize(c)}" ${c===name?'selected':''}>${sanitize(c)}</option>`).join('');

  // IDs use letter-as-suffix consistently: cmpSelA/cmpNameA/cmpSubA/cmpTimeA/cmpThemesA
  root.innerHTML = `
    <div class="cmp-head">
      <div class="cmp-side"><label for="cmpSelA">A</label><select id="cmpSelA" aria-label="Country A">${opts(state.cmpA)}</select>
        <div class="big" id="cmpNameA">${sanitize(state.cmpA||'—')}</div>
        <div class="sub" id="cmpSubA">loading…</div></div>
      <div class="cmp-vs">vs</div>
      <div class="cmp-side b"><label for="cmpSelB">B</label><select id="cmpSelB" aria-label="Country B">${opts(state.cmpB)}</select>
        <div class="big" id="cmpNameB">${sanitize(state.cmpB||'—')}</div>
        <div class="sub" id="cmpSubB">loading…</div></div>
    </div>
    <p style="font-size:11px;color:var(--dim);padding:8px 24px;margin:0;border-bottom:1px solid var(--line)">⚑ <strong>Comparability note:</strong> Treaty Body counts reflect only the bodies each state has ratified — countries with fewer ratifications will structurally show lower totals. Volume comparisons are most meaningful between states with similar treaty profiles.</p>
    <div class="cmp-body">
      <!-- C1: Timelines stacked vertically, both full-width. Half-width
           side-by-side squeezed 21 years into ~500 px and made year
           labels + Y scale unreadable. Timelines now get the full
           horizontal budget; row-list panels (themes / groups / SDGs)
           remain two-column because they fit fine at half width and
           direct visual alignment row-by-row is actually the point. -->
      <div class="panel" style="grid-column:1 / -1"><div class="panel-head"><div class="panel-title"><span class="idx">A</span><span class="t">Over time — <span id="cmpTimeALbl">—</span></span></div><div class="panel-actions" id="cmpTimeALegend"></div></div><div class="tl-wrap" id="cmpTimeA"></div></div>
      <div class="panel" style="grid-column:1 / -1;background:var(--paper-2)"><div class="panel-head"><div class="panel-title"><span class="idx">B</span><span class="t">Over time — <span id="cmpTimeBLbl">—</span></span></div><div class="panel-actions" id="cmpTimeBLegend"></div></div><div class="tl-wrap" id="cmpTimeB"></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">A</span><span class="t">Themes</span></div></div><div class="row-list" id="cmpThemesA"></div></div>
      <div class="panel" style="background:var(--paper-2)"><div class="panel-head"><div class="panel-title"><span class="idx">B</span><span class="t">Themes</span></div></div><div class="row-list" id="cmpThemesB"></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">A</span><span class="t">Concerned groups</span></div></div><div class="row-list" id="cmpGroupsA"></div></div>
      <div class="panel" style="background:var(--paper-2)"><div class="panel-head"><div class="panel-title"><span class="idx">B</span><span class="t">Concerned groups</span></div></div><div class="row-list" id="cmpGroupsB"></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title"><span class="idx">A</span><span class="t">SDGs</span></div></div><div class="row-list" id="cmpSdgsA"></div></div>
      <div class="panel" style="background:var(--paper-2)"><div class="panel-head"><div class="panel-title"><span class="idx">B</span><span class="t">SDGs</span></div></div><div class="row-list" id="cmpSdgsB"></div></div>
    </div>`;

  $('#cmpSelA').addEventListener('change', e => { state.cmpA = e.target.value; _persistCompareChoice(); navigate('compare'); });
  $('#cmpSelB').addEventListener('change', e => { state.cmpB = e.target.value; _persistCompareChoice(); navigate('compare'); });

  // C2: shared-Y coordinator. Each side's analytics lands asynchronously;
  // timelines render with their own scale first (so the user sees data
  // immediately), then when both are in, we re-render both with the
  // shared max so peak heights are actually comparable.
  // C5: both charts share a sync group so a hover on A paints the
  // cursor + tooltip on B at the same year, and vice versa.
  const cmpState = { A: null, B: null, nameA: state.cmpA, nameB: state.cmpB };

  const _paintCmpTimeline = (letter, yMax) => {
    const an = cmpState[letter];
    const timeEl = $(`#cmpTime${letter}`);
    if (!timeEl || !an) return;
    renderTimeline(timeEl, an?.trends?.yearly_body_counts || {}, {
      interactive: false,
      stackBy: 'family',
      yMax: yMax || undefined,
      legendEl: $(`#cmpTime${letter}Legend`),
      syncGroup: 'compare-tl',
    });
    const lbl = $(`#cmpTime${letter}Lbl`);
    if (lbl) lbl.textContent = cmpState['name' + letter] || '—';
  };

  const _reconcileSharedY = () => {
    if (!cmpState.A || !cmpState.B) return;
    const yearlyMax = (an) => {
      const yc = _normalizeYearlyBodyCounts(an?.trends?.yearly_body_counts || {});
      const totals = Object.values(yc).map(byBody => {
        if (byBody && typeof byBody === 'object') return Object.values(byBody).reduce((a, b) => a + (+b || 0), 0);
        return 0;
      });
      return totals.length ? Math.max(...totals) : 0;
    };
    const sharedMax = Math.max(yearlyMax(cmpState.A), yearlyMax(cmpState.B), 1);
    _paintCmpTimeline('A', sharedMax);
    _paintCmpTimeline('B', sharedMax);
  };

  async function loadSide(name, letter) {  // letter is 'A' or 'B'
    // Both sides intersect the current rail (body, theme, year etc.)
    // with their own country scope — so you can e.g. compare Poland vs
    // Germany under a CCPR-only filter.
    const f = _scopedFilter({ country: new Set([name]) });
    // Unique abort-scope per side so A and B don't cancel each other
    const scope = 'compare-' + letter;
    try {
      const [an, recs] = await Promise.all([
        api.analytics(f, { scope: 'analytics:' + scope }),
        api.records(f, 1, 1, { scope: 'records:' + scope }),
      ]);
      const subEl = $(`#cmpSub${letter}`);
      if (subEl) subEl.textContent = `${fmt(recs.total_records)} recs · ${(an?.themes?.theme_counts||[]).length} themes · ${(an?.text?.affected_person_counts||[]).length} groups`;
      cmpState[letter] = an;
      cmpState['name' + letter] = name;
      // Initial paint uses local max — once both sides are in, the
      // coordinator re-paints with a shared max so peaks are comparable.
      _paintCmpTimeline(letter, null);
      _reconcileSharedY();
      // Each Compare bar is clickable — it opens the drawer list scoped to
      // the country for that side (A or B). `extraFilter` pins the country
      // so the records behind the bar match what the bar represents, not
      // the rail's country selection. Shift / ⌘ keep the same contract as
      // other tabs (toggle rail filter / jump to profile).
      const cmpScope = { country: new Set([name]) };
      const themeEl = $(`#cmpThemes${letter}`);
      if (themeEl) {
        const t = (an?.themes?.theme_counts||[]).slice(0,8).map(x => ({ key:x.theme, label:x.theme, v:x.count }));
        renderRowList(themeEl, t, { facet: 'theme', extraFilter: cmpScope });
      }
      // Concerned Groups (top 8)
      const groupEl = $(`#cmpGroups${letter}`);
      if (groupEl) {
        const g = (an?.text?.affected_person_counts||[]).slice(0,8).map(x => ({ key:x.affected_person, label:x.affected_person, v:x.count }));
        renderRowList(groupEl, g, { facet: 'group', extraFilter: cmpScope });
      }
      // SDGs with granular target names (SDG 16.3 — Promote the rule of law…)
      const sdgEl = $(`#cmpSdgs${letter}`);
      if (sdgEl) {
        const s = (an?.text?.sdg_counts||[]).slice(0,12).map(x => ({
          key: x.sdg, label: formatSdgLabel(x.sdg), v: x.count
        }));
        renderRowList(sdgEl, s, { facet: 'sdg', extraFilter: cmpScope });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      const subEl = $(`#cmpSub${letter}`);
      if (subEl) subEl.textContent = 'load failed: ' + (err.message || err);
      console.error('compare side ' + letter + ' failed:', err);
    }
  }
  if (state.cmpA) loadSide(state.cmpA, 'A');
  if (state.cmpB) loadSide(state.cmpB, 'B');
}
