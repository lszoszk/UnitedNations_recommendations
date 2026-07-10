/* UHRI Dashboard — world map (choropleth + hex tiles + legacy grid fallback)
 * and the one-off SVG export handler.
 *
 * Three renderers dispatched by getMapMode():
 *
 *   renderHexMap         — equal-sized hex per state party, visual-fairness
 *                          layout; default. Static SVG, no dependencies.
 *   renderChoroplethMap  — real-world geography via d3-geo + topojson-client
 *                          loaded dynamically from skypack CDN. ~160 KB of
 *                          libs on first open. Falls back to hex on failure.
 *   renderGridMap        — 22×12 grid fallback retained for the "grid" mode
 *                          value that some users may still have in localStorage
 *                          from an earlier dashboard version.
 *
 * LOAD ORDER
 *   Runs AFTER helpers/data (needs $, cleanCountryName, state) and BEFORE
 *   the inline <script>. Every outbound call is one of:
 *
 *   (a) Top-level from earlier modules:
 *         $                 (helpers)
 *         cleanCountryName  (helpers)
 *         state             (data — read/write state._lastCountryCounts)
 *
 *   (b) Lazy from inline (called only from event handlers / user actions):
 *         announce, toast, downloadBlob  — UX feedback plumbing
 *         navigate                        — tab dispatcher
 *         onFiltersChanged                — rail-filter pipeline trigger
 *         openListDrawer                  — list-drawer opener
 *         preloadCountryOnHover           — analytics prefetch
 *         refreshFacetUI                  — chip-strip refresher
 *
 *   (c) Dynamic imports from skypack CDN:
 *         d3-geo@3, topojson-client@3     — lazy-loaded on choropleth mode
 *
 * EXTERNAL SURFACE (what inline reaches into here)
 *   renderMap(container, countryCounts)    — dispatcher; used by the overview
 *                                             shell wiring (FIG.01)
 *   getMapMode() / setMapMode(m)            — mode persistence
 *   exportMapAsSVG()                        — overview SVG download button
 *
 *   Internal: renderHexMap / renderChoroplethMap / renderGridMap — bound only
 *   by renderMap itself.
 */

/* =========================================================================
   WORLD CHOROPLETH (TopoJSON via d3-geo)
   =========================================================================
   Replaces the 22×12 grid with a real world map. All ~195 countries appear
   in proper geography, coloured by record intensity. Libraries lazy-loaded
   from CDN (~50KB d3-geo + ~10KB topojson + ~100KB world-atlas). */

/* Reconciler: API country names (long-form, UN style) → world-atlas names
   (short). Most of the 198 are identical; list only divergent cases. */
const NAME_RECONCILER = {
  "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
  "United States of America": "United States of America",
  "Iran (Islamic Republic of)": "Iran",
  "Türkiye": "Turkey",
  "Viet Nam": "Vietnam",
  "Russian Federation": "Russia",
  "Syrian Arab Republic": "Syria",
  "Lao People's Democratic Republic": "Laos",
  "Bolivia (Plurinational State of)": "Bolivia",
  "Venezuela (Bolivarian Republic of)": "Venezuela",
  "Democratic Republic of the Congo": "Dem. Rep. Congo",
  "United Republic of Tanzania": "Tanzania",
  "Republic of Korea": "South Korea",
  "Democratic People's Republic of Korea": "North Korea",
  "Micronesia (Federated States of)": "Micronesia",
  "Republic of Moldova": "Moldova",
  "Brunei Darussalam": "Brunei",
  "Cabo Verde": "Cape Verde",
  "Czechia": "Czech Republic",
  "Eswatini": "Swaziland",
  "Côte d'Ivoire": "Ivory Coast",
  "Timor-Leste": "East Timor",
  "North Macedonia": "Macedonia",
  "State of Palestine*": "Palestine",
  "Kosovo*": "Kosovo",
  "Holy See": "Vatican",
  "Central African Republic": "Central African Rep.",
  "Equatorial Guinea": "Eq. Guinea",
  "Dominican Republic": "Dominican Rep.",
  "South Sudan": "S. Sudan",
  "Bosnia and Herzegovina": "Bosnia and Herz.",
  "Solomon Islands": "Solomon Is.",
  "Marshall Islands": "Marshall Is.",
  "Antigua and Barbuda": "Antigua and Barb.",
  "Saint Vincent and the Grenadines": "St. Vin. and Gren.",
  "Saint Kitts and Nevis": "St. Kitts and Nevis",
  "Saint Lucia": "Saint Lucia",
  "Sao Tome and Principe": "São Tomé and Principe",
};

function apiToTopoName(apiName) {
  return NAME_RECONCILER[apiName] || apiName;
}

/* Region assignment for choropleth features — built from HEX_LAYOUT
   (our canonical region dictionary) on first use. */
let _regionByTopoName = null;
function getRegionByTopoName() {
  if (_regionByTopoName) return _regionByTopoName;
  _regionByTopoName = {};
  if (typeof HEX_LAYOUT !== 'undefined') {
    HEX_LAYOUT.forEach(([col, row, iso, apiName, region]) => {
      const topo = NAME_RECONCILER[apiName] || apiName;
      _regionByTopoName[topo] = region;
    });
  }
  return _regionByTopoName;
}

let _mapLibsPromise = null;
function loadMapLibs() {
  if (_mapLibsPromise) return _mapLibsPromise;
  _mapLibsPromise = Promise.all([
    import('https://cdn.skypack.dev/d3-geo@3').catch(() => null),
    import('https://cdn.skypack.dev/topojson-client@3').catch(() => null),
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .catch(() => null),
  ]).then(([d3geo, topojson, world]) => {
    if (!d3geo || !topojson || !world) throw new Error('map libs failed to load');
    return { d3geo, topojson, world };
  });
  return _mapLibsPromise;
}

async function renderChoroplethMap(container, countryCounts) {
  container.innerHTML = '<div class="map-loading">loading world map</div>';
  let libs;
  try {
    libs = await loadMapLibs();
  } catch (err) {
    console.warn('Choropleth libs failed, falling back to grid', err);
    return renderGridMap(container, countryCounts);  // graceful fallback
  }
  const { d3geo, topojson, world } = libs;

  const featureCollection = topojson.feature(world, world.objects.countries);
  const features = featureCollection.features;
  const w = container.offsetWidth || 600;
  const h = 400;

  // Equal Earth projection — area-accurate, good for choropleths
  const projection = d3geo.geoEqualEarth().fitSize([w, h-8], featureCollection);
  const pathGen = d3geo.geoPath(projection);

  // Build a feature-name index so we can try several name variants
  // (API sometimes uses long-form, atlas might use short-form or vice
  // versa — e.g. Czechia / Czech Republic, Türkiye / Turkey).
  const featuresByName = Object.create(null);
  features.forEach(f => { featuresByName[f.properties.name] = true; });

  const countByTopoName = Object.create(null);
  const topoToApi = Object.create(null);
  countryCounts.forEach(c => {
    const apiName = cleanCountryName(c.country);
    // Ordered candidates: raw name, reconciler match, stripped parenthetical
    const candidates = [
      apiName,
      apiToTopoName(apiName),
      apiName.replace(/\s*\([^)]*\)\s*/g, '').trim(),  // "Iran (Islamic Republic of)" → "Iran"
    ];
    let hit = null;
    for (const cand of candidates) {
      if (cand && featuresByName[cand]) { hit = cand; break; }
    }
    if (!hit) hit = apiToTopoName(apiName);  // fallback for reporting
    countByTopoName[hit] = (countByTopoName[hit] || 0) + c.count;
    topoToApi[hit] = apiName;
  });
  const maxCount = Math.max(0, ...Object.values(countByTopoName));

  const paths = features.map(f => {
    const name = f.properties.name;
    const count = countByTopoName[name] || 0;
    const intensity = maxCount ? count / maxCount : 0;
    const apiName = topoToApi[name];
    const filteredOn = apiName && state.filters.country.has(apiName);
    const fill = count > 0
      ? `color-mix(in oklab, var(--accent) ${Math.round(8 + intensity*82)}%, var(--paper-2))`
      : 'var(--paper-3)';
    const cls = 'country' + (count === 0 ? ' empty' : '') + (filteredOn ? ' on' : '');
    const d = pathGen(f);
    if (!d) return '';
    return `<path class="${cls}" d="${d}" fill="${fill}" data-name="${sanitize(name)}" data-api="${sanitize(apiName||'')}" data-count="${count}" tabindex="0" role="button" aria-label="${sanitize(apiName||name)}: ${fmt(count)} records" />`;
  }).filter(Boolean).join('');

  // Graticule for geographic context
  const graticule = d3geo.geoGraticule ? d3geo.geoGraticule().step([20,20])() : null;
  const gratPath = graticule ? pathGen(graticule) : '';
  const spherePath = pathGen({type:'Sphere'});

  /* Region buttons aligned with the hex map's M49 5-region set.  The old
     ad-hoc MENA bucket is gone; Northern Africa is part of `africa`,
     Western Asia part of `asia`, matching the hex map tabs + rail
     filter.  getRegionByTopoName() builds the name→region lookup from
     HEX_LAYOUT so both map modes stay in sync by construction. */
  const regions = ['world','africa','americas','asia','europe','oceania'];
  const currentRegion = state.geoRegion || 'world';
  const regionBtnsHtml = regions.map(r =>
    `<button data-region="${r}" class="${r === currentRegion ? 'on' : ''}">${r === 'world' ? 'World' : r.charAt(0).toUpperCase() + r.slice(1)}</button>`
  ).join('');

  container.innerHTML = `
    <div class="map-regions" id="geoRegions" role="group" aria-label="Zoom to region">${regionBtnsHtml}<button id="geoZoomIn" title="Zoom in" aria-label="Zoom in">+</button><button id="geoZoomOut" title="Zoom out" aria-label="Zoom out">−</button><button id="geoReset" class="geo-reset" title="Reset view">⟲ Reset</button></div>
    <svg class="geo-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="cursor:grab;user-select:none">
      <path class="sphere" d="${spherePath}" />
      <path class="graticule" d="${gratPath}" />
      ${paths}
    </svg>
    <div class="map-tooltip" id="mapTip"></div>
    <div class="map-scale">
      <span>0</span>
      ${[0.1,0.25,0.5,0.75,1.0].map(v =>
        `<span class="s" style="background:color-mix(in oklab, var(--accent) ${Math.round(v*90)}%, var(--paper-2))"></span>`
      ).join('')}
      <span>${fmt(maxCount)}</span>
      <span style="margin-left:auto;color:var(--dim);font-size:10px" title="drag to pan · scroll to zoom · click = filter · dblclick = profile">drag to pan · scroll to zoom · click = filter · dblclick = profile</span>
    </div>`;

  const tip = $('#mapTip', container);
  container.querySelectorAll('path.country').forEach(p => {
    p.addEventListener('mousemove', (e) => {
      const rect = container.getBoundingClientRect();
      const count = Number(p.dataset.count || 0);
      const name = p.dataset.api || p.dataset.name;
      tip.innerHTML = `${sanitize(name)}<span class="n">${fmt(count)}</span>`;
      tip.style.left = (e.clientX - rect.left) + 'px';
      tip.style.top = (e.clientY - rect.top) + 'px';
      tip.classList.add('show');
    });
    p.addEventListener('mouseleave', () => tip.classList.remove('show'));
    p.addEventListener('click', (e) => {
      const apiName = p.dataset.api;
      if (!apiName) return;
      // Shift-click: toggle rail filter (classic cross-filter)
      if (e.shiftKey) {
        const s = state.filters.country;
        if (s.has(apiName)) s.delete(apiName); else s.add(apiName);
        p.classList.toggle('on', s.has(apiName));
        refreshFacetUI('country');
        onFiltersChanged();
        return;
      }
      // Default: open the drawer with list of all records for this country
      openListDrawer('country', apiName);
    });
    p.addEventListener('dblclick', () => {
      const apiName = p.dataset.api;
      if (!apiName) return;
      const iso = getHexNameToIso()[apiName];
      if (iso) {
        state.focusCountry = iso;
        $('#tabCountry').textContent = apiName;
        navigate('country');
      }
    });
    // Keyboard: Enter/Space = open records (default click); Shift+Enter = filter.
    p.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (e.shiftKey) p.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
      else p.click();
    });
  });

  // ----- Pan + scroll zoom -----
  const svg = container.querySelector('.geo-svg');
  const initialVB = svg.getAttribute('viewBox').split(' ').map(Number);
  let panning = false, panStart = null, vbStart = null;

  function getVB() {
    return svg.getAttribute('viewBox').split(' ').map(Number);
  }
  function setVB(x, y, w, h) {
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  }
  // Zoom bounds: without them wheel/pinch zoom-out is unbounded — a dozen
  // scroll ticks shrinks the world to an unclickable speck that's hard to
  // recover from (user-reported). 32× in, 1.3× out (slightly beyond full
  // world so the reset feel isn't abrupt). Pan is clamped so at least a
  // quarter of the frame always overlaps the world box — the map can't be
  // dragged fully off-screen.
  const MIN_W = initialVB[2] / 32;
  const MAX_W = initialVB[2] * 1.3;
  const clampW = (w) => Math.max(MIN_W, Math.min(MAX_W, w));
  function clampedVB(x, y, w, h) {
    const minX = initialVB[0] - w * 0.75, maxX = initialVB[0] + initialVB[2] - w * 0.25;
    const minY = initialVB[1] - h * 0.75, maxY = initialVB[1] + initialVB[3] - h * 0.25;
    return [Math.min(maxX, Math.max(minX, x)), Math.min(maxY, Math.max(minY, y)), w, h];
  }
  // Shared by the +/− buttons: zoom about the current viewBox centre.
  function zoomBy(factor) {
    const vb = getVB();
    const newW = clampW(vb[2] * factor);
    const f = newW / vb[2];
    if (f === 1) return;
    const cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2;
    setVB(...clampedVB(cx - (vb[2] * f) / 2, cy - (vb[3] * f) / 2, vb[2] * f, vb[3] * f));
  }
  function fitToRegion(region) {
    state.geoRegion = region;
    if (region === 'world') {
      setVB(...initialVB);
    } else {
      const regionMap = getRegionByTopoName();
      let hit = features.filter(f => regionMap[f.properties.name] === region);
      if (!hit.length) return;
      /* Europe special case — Russia spans from Kaliningrad (20°E) to
         Kamchatka (180°E) as a single TopoJSON polygon.  Including it
         when computing bounds stretches the viewBox across all of
         Siberia and squishes actual Europe.  We compute bounds WITHOUT
         Russia, then extend the eastern edge a bit so Moscow / St
         Petersburg (~40°E) remain comfortably inside the frame — user
         can still click on European Russia, they just don't see the
         whole country body. */
      let boundsFeatures = hit;
      if (region === 'europe') {
        boundsFeatures = hit.filter(f => f.properties.name !== 'Russia');
      }
      const bounds = pathGen.bounds({ type: 'FeatureCollection', features: boundsFeatures });
      let x0 = bounds[0][0], y0 = bounds[0][1];
      let x1 = bounds[1][0], y1 = bounds[1][1];
      if (region === 'europe') {
        // Extend east to include roughly Moscow longitude (~40°E).
        const baseW = x1 - x0;
        x1 += baseW * 0.28;
      }
      let rawW = x1 - x0, rawH = y1 - y0;
      const rect = svg.getBoundingClientRect();
      const containerAspect = (rect.width && rect.height) ? (rect.width / rect.height) : 2;
      const contentAspect = rawW / rawH;
      let vbW, vbH;
      if (contentAspect > containerAspect) {
        vbW = rawW; vbH = rawW / containerAspect;
      } else {
        vbH = rawH; vbW = rawH * containerAspect;
      }
      const padFactor = 1.03;
      vbW *= padFactor; vbH *= padFactor;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      setVB(cx - vbW/2, cy - vbH/2, vbW, vbH);
    }
    container.querySelectorAll('#geoRegions button[data-region]').forEach(b =>
      b.classList.toggle('on', b.dataset.region === region));
  }

  // Region buttons
  container.querySelectorAll('#geoRegions button[data-region]').forEach(b =>
    b.addEventListener('click', () => {
      fitToRegion(b.dataset.region);
      announce('Zoomed to ' + b.dataset.region);
    }));
  $('#geoReset', container)?.addEventListener('click', () => fitToRegion('world'));
  $('#geoZoomIn', container)?.addEventListener('click', () => zoomBy(0.75));
  $('#geoZoomOut', container)?.addEventListener('click', () => zoomBy(1 / 0.75));

  // M3 · C2: Pan + pinch-zoom with Pointer Events (covers mouse, pen, touch).
  // Two-finger pinch detected by tracking active pointers; distance ratio
  // drives zoom. Single pointer does pan.
  const activePointers = new Map();  // pointerId → {x, y}
  let pinchStartDist = 0, pinchStartVB = null, pinchCenterRatio = null;

  const getPointerMidAndDist = () => {
    const pts = [...activePointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(b.x - a.x, b.y - a.y),
    };
  };

  svg.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('country') && activePointers.size === 0) return;  // let click on country take precedence
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture?.(e.pointerId);
    if (activePointers.size === 1) {
      panning = true;
      panStart = { x: e.clientX, y: e.clientY };
      vbStart = getVB();
      svg.style.cursor = 'grabbing';
    } else if (activePointers.size === 2) {
      // Start pinch
      panning = false;
      const info = getPointerMidAndDist();
      if (info) {
        pinchStartDist = info.dist;
        pinchStartVB = getVB();
        const rect = svg.getBoundingClientRect();
        pinchCenterRatio = {
          rx: (info.mid.x - rect.left) / rect.width,
          ry: (info.mid.y - rect.top) / rect.height,
        };
      }
    }
    e.preventDefault();
  });

  svg.addEventListener('pointermove', e => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2 && pinchStartVB) {
      // Pinch zoom
      const info = getPointerMidAndDist();
      if (!info || !pinchStartDist) return;
      const scale = pinchStartDist / info.dist;   // <1 = zoom in, >1 = zoom out
      const newW = clampW(pinchStartVB[2] * scale);
      const newH = pinchStartVB[3] * (newW / pinchStartVB[2]);
      // Keep the midpoint anchored (same SVG point under the midpoint)
      const anchorX = pinchStartVB[0] + pinchCenterRatio.rx * pinchStartVB[2];
      const anchorY = pinchStartVB[1] + pinchCenterRatio.ry * pinchStartVB[3];
      const newX = anchorX - pinchCenterRatio.rx * newW;
      const newY = anchorY - pinchCenterRatio.ry * newH;
      setVB(...clampedVB(newX, newY, newW, newH));
    } else if (activePointers.size === 1 && panning) {
      const vb = vbStart;
      const rect = svg.getBoundingClientRect();
      const scale = vb[2] / rect.width;
      setVB(...clampedVB(
            vb[0] - (e.clientX - panStart.x) * scale,
            vb[1] - (e.clientY - panStart.y) * scale,
            vb[2], vb[3]));
    }
  });

  const releasePointer = (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      pinchStartDist = 0; pinchStartVB = null; pinchCenterRatio = null;
    }
    if (activePointers.size === 0) {
      panning = false;
      svg.style.cursor = 'grab';
    }
  };
  svg.addEventListener('pointerup', releasePointer);
  svg.addEventListener('pointercancel', releasePointer);
  // NOT pointerleave: with pointer capture active, pointerleave fires as soon
  // as the cursor crosses the svg edge mid-drag, killing the pan even though
  // the button is still held. lostpointercapture is the correct terminal
  // event — it fires on release/cancel even off-element.
  svg.addEventListener('lostpointercapture', releasePointer);

  // Scroll to zoom (centered on cursor position in SVG coords)
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    const vb = getVB();
    const rect = svg.getBoundingClientRect();
    const newW = clampW(vb[2] * factor);
    const f = newW / vb[2];
    if (f === 1) return;   // at a zoom bound — nothing to do
    const newH = vb[3] * f;
    const sx = vb[0] + (e.clientX - rect.left) / rect.width * vb[2];
    const sy = vb[1] + (e.clientY - rect.top) / rect.height * vb[3];
    const newX = sx - (e.clientX - rect.left) / rect.width * newW;
    const newY = sy - (e.clientY - rect.top) / rect.height * newH;
    setVB(...clampedVB(newX, newY, newW, newH));
  }, { passive: false });

  // Apply any saved region on first render
  if (state.geoRegion && state.geoRegion !== 'world') {
    fitToRegion(state.geoRegion);
  }
}

/* =========================================================================
   HEX TILE MAP — one equal-sized hex per state party (visual-fairness layout)
   =========================================================================
   Hand-placed pointy-top hexes in continental clusters. Luxembourg gets
   the same cell as China — geographic literacy trades for visual fairness.
   Data layer: countryCounts from /api/data/map, keyed by ISO3 via
   NAME_TO_ISO. Click = spotlight (drawer shows country summary), shift-
   click = toggle filter, dblclick = open Country profile. */
const HEX_LAYOUT = [
  /* africa / easternAfrica */
  [14, 14,'BDI','Burundi','africa','easternAfrica'],
  [15, 12,'COM','Comoros','africa','easternAfrica'],
  [15, 11,'DJI','Djibouti','africa','easternAfrica'],
  [14, 11,'ERI','Eritrea','africa','easternAfrica'],
  [14, 10,'ETH','Ethiopia','africa','easternAfrica'],
  [14, 12,'KEN','Kenya','africa','easternAfrica'],
  [15, 16,'MDG','Madagascar','africa','easternAfrica'],
  [14, 16,'MOZ','Mozambique','africa','easternAfrica'],
  [16, 14,'MUS','Mauritius','africa','easternAfrica'],
  [14, 15,'MWI','Malawi','africa','easternAfrica'],
  [13, 14,'RWA','Rwanda','africa','easternAfrica'],
  [15, 10,'SOM','Somalia','africa','easternAfrica'],
  [14,  9,'SSD','South Sudan','africa','easternAfrica'],
  [16, 13,'SYC','Seychelles','africa','easternAfrica'],
  [14, 13,'TZA','United Republic of Tanzania','africa','easternAfrica'],
  [13, 13,'UGA','Uganda','africa','easternAfrica'],
  [13, 15,'ZMB','Zambia','africa','easternAfrica'],
  [13, 16,'ZWE','Zimbabwe','africa','easternAfrica'],
  /* africa / middleAfrica */
  [12, 14,'AGO','Angola','africa','middleAfrica'],
  [13, 12,'CAF','Central African Republic','africa','middleAfrica'],
  [13, 11,'CMR','Cameroon','africa','middleAfrica'],
  [12, 13,'COD','Democratic Republic of the Congo','africa','middleAfrica'],
  [11, 13,'COG','Congo','africa','middleAfrica'],
  [10, 13,'GAB','Gabon','africa','middleAfrica'],
  [10, 14,'GNQ','Equatorial Guinea','africa','middleAfrica'],
  [11, 14,'STP','Sao Tome and Principe','africa','middleAfrica'],
  [12, 10,'TCD','Chad','africa','middleAfrica'],
  /* africa / northernAfrica */
  [10,  8,'DZA','Algeria','africa','northernAfrica'],
  [15,  9,'EGY','Egypt','africa','northernAfrica'],
  [12,  9,'LBY','Libya','africa','northernAfrica'],
  [10,  7,'MAR','Morocco','africa','northernAfrica'],
  [13, 10,'SDN','Sudan','africa','northernAfrica'],
  [11,  9,'TUN','Tunisia','africa','northernAfrica'],
  /* africa / southernAfrica */
  [13, 17,'BWA','Botswana','africa','southernAfrica'],
  [14, 18,'LSO','Lesotho','africa','southernAfrica'],
  [12, 16,'NAM','Namibia','africa','southernAfrica'],
  [14, 17,'SWZ','Eswatini','africa','southernAfrica'],
  [13, 18,'ZAF','South Africa','africa','southernAfrica'],
  /* africa / westernAfrica */
  [12, 11,'BEN','Benin','africa','westernAfrica'],
  [10, 10,'BFA','Burkina Faso','africa','westernAfrica'],
  [10, 11,'CIV',"Côte d'Ivoire",'africa','westernAfrica'],
  [ 8,  8,'CPV','Cabo Verde','africa','westernAfrica'],
  [11, 11,'GHA','Ghana','africa','westernAfrica'],
  [ 9, 10,'GIN','Guinea','africa','westernAfrica'],
  [ 8,  9,'GMB','Gambia','africa','westernAfrica'],
  [ 7, 10,'GNB','Guinea-Bissau','africa','westernAfrica'],
  [ 9, 11,'LBR','Liberia','africa','westernAfrica'],
  [10,  9,'MLI','Mali','africa','westernAfrica'],
  [ 9,  8,'MRT','Mauritania','africa','westernAfrica'],
  [11, 10,'NER','Niger','africa','westernAfrica'],
  [12, 12,'NGA','Nigeria','africa','westernAfrica'],
  [ 9,  9,'SEN','Senegal','africa','westernAfrica'],
  [ 8, 10,'SLE','Sierra Leone','africa','westernAfrica'],
  [11, 12,'TGO','Togo','africa','westernAfrica'],
  /* americas / caribbean */
  [ 5,  3,'ATG','Antigua and Barbuda','americas','caribbean'],
  [ 5,  2,'BHS','Bahamas','americas','caribbean'],
  [ 6,  5,'BRB','Barbados','americas','caribbean'],
  [ 3,  2,'CUB','Cuba','americas','caribbean'],
  [ 5,  4,'DMA','Dominica','americas','caribbean'],
  [ 4,  2,'DOM','Dominican Republic','americas','caribbean'],
  [ 7,  5,'GRD','Grenada','americas','caribbean'],
  [ 4,  3,'HTI','Haiti','americas','caribbean'],
  [ 3,  3,'JAM','Jamaica','americas','caribbean'],
  [ 6,  3,'KNA','Saint Kitts and Nevis','americas','caribbean'],
  [ 6,  4,'LCA','Saint Lucia','americas','caribbean'],
  [ 7,  6,'TTO','Trinidad and Tobago','americas','caribbean'],
  [ 7,  4,'VCT','Saint Vincent and the Grenadines','americas','caribbean'],
  /* americas / centralAmerica */
  [ 4,  4,'BLZ','Belize','americas','centralAmerica'],
  [ 2,  5,'CRI','Costa Rica','americas','centralAmerica'],
  [ 2,  3,'GTM','Guatemala','americas','centralAmerica'],
  [ 3,  4,'HND','Honduras','americas','centralAmerica'],
  [ 2,  2,'MEX','Mexico','americas','centralAmerica'],
  [ 3,  5,'NIC','Nicaragua','americas','centralAmerica'],
  [ 3,  6,'PAN','Panama','americas','centralAmerica'],
  [ 2,  4,'SLV','El Salvador','americas','centralAmerica'],
  /* americas / northernAmerica */
  [ 1,  0,'CAN','Canada','americas','northernAmerica'],
  [ 2,  1,'USA','United States of America','americas','northernAmerica'],
  /* americas / southAmerica */
  [ 5,  9,'ARG','Argentina','americas','southAmerica'],
  [ 5,  8,'BOL','Bolivia (Plurinational State of)','americas','southAmerica'],
  [ 5,  7,'BRA','Brazil','americas','southAmerica'],
  [ 4,  8,'CHL','Chile','americas','southAmerica'],
  [ 4,  5,'COL','Colombia','americas','southAmerica'],
  [ 4,  6,'ECU','Ecuador','americas','southAmerica'],
  [ 5,  6,'GUY','Guyana','americas','southAmerica'],
  [ 4,  7,'PER','Peru','americas','southAmerica'],
  [ 6,  8,'PRY','Paraguay','americas','southAmerica'],
  [ 6,  6,'SUR','Suriname','americas','southAmerica'],
  [ 6,  9,'URY','Uruguay','americas','southAmerica'],
  [ 5,  5,'VEN','Venezuela (Bolivarian Republic of)','americas','southAmerica'],
  /* asia / centralAsia */
  [16,  3,'KAZ','Kazakhstan','asia','centralAsia'],
  [18,  5,'KGZ','Kyrgyzstan','asia','centralAsia'],
  [18,  6,'TJK','Tajikistan','asia','centralAsia'],
  [17,  7,'TKM','Turkmenistan','asia','centralAsia'],
  [17,  6,'UZB','Uzbekistan','asia','centralAsia'],
  /* asia / easternAsia */
  [19,  5,'CHN','China','asia','easternAsia'],
  [21,  4,'JPN','Japan','asia','easternAsia'],
  [20,  5,'KOR','Republic of Korea','asia','easternAsia'],
  [17,  4,'MNG','Mongolia','asia','easternAsia'],
  [20,  4,'PRK',"Democratic People's Republic of Korea",'asia','easternAsia'],
  /* asia / southeasternAsia */
  [21,  9,'BRN','Brunei Darussalam','asia','southeasternAsia'],
  [23, 11,'IDN','Indonesia','asia','southeasternAsia'],
  [22,  9,'KHM','Cambodia','asia','southeasternAsia'],
  [22,  8,'LAO',"Lao People's Democratic Republic",'asia','southeasternAsia'],
  [21,  7,'MMR','Myanmar','asia','southeasternAsia'],
  [22, 10,'MYS','Malaysia','asia','southeasternAsia'],
  [23,  9,'PHL','Philippines','asia','southeasternAsia'],
  [22, 11,'SGP','Singapore','asia','southeasternAsia'],
  [21,  8,'THA','Thailand','asia','southeasternAsia'],
  [23, 12,'TLS','Timor-Leste','asia','southeasternAsia'],
  [22,  7,'VNM','Viet Nam','asia','southeasternAsia'],
  /* asia / southernAsia */
  [18,  7,'AFG','Afghanistan','asia','southernAsia'],
  [20,  9,'BGD','Bangladesh','asia','southernAsia'],
  [20,  8,'BTN','Bhutan','asia','southernAsia'],
  [19,  8,'IND','India','asia','southernAsia'],
  [17,  8,'IRN','Iran (Islamic Republic of)','asia','southernAsia'],
  [19,  9,'LKA','Sri Lanka','asia','southernAsia'],
  [19, 10,'MDV','Maldives','asia','southernAsia'],
  [20,  7,'NPL','Nepal','asia','southernAsia'],
  [19,  7,'PAK','Pakistan','asia','southernAsia'],
  /* asia / westernAsia */
  [18, 11,'ARE','United Arab Emirates','asia','westernAsia'],
  [16,  6,'ARM','Armenia','asia','westernAsia'],
  [16,  7,'AZE','Azerbaijan','asia','westernAsia'],
  [17, 10,'BHR','Bahrain','asia','westernAsia'],
  [13,  5,'CYP','Cyprus','asia','westernAsia'],
  [15,  6,'GEO','Georgia','asia','westernAsia'],
  [16,  8,'IRQ','Iraq','asia','westernAsia'],
  [15,  7,'ISR','Israel','asia','westernAsia'],
  [15,  8,'JOR','Jordan','asia','westernAsia'],
  [17,  9,'KWT','Kuwait','asia','westernAsia'],
  [14,  7,'LBN','Lebanon','asia','westernAsia'],
  [17, 11,'OMN','Oman','asia','westernAsia'],
  [15,  5,'PSE','State of Palestine','asia','westernAsia'],
  [18, 10,'QAT','Qatar','asia','westernAsia'],
  [16,  9,'SAU','Saudi Arabia','asia','westernAsia'],
  [14,  8,'SYR','Syrian Arab Republic','asia','westernAsia'],
  [14,  5,'TUR','Türkiye','asia','westernAsia'],
  [16, 10,'YEM','Yemen','asia','westernAsia'],
  /* europe / easternEurope */
  [13,  7,'BGR','Bulgaria','europe','easternEurope'],
  [13,  3,'BLR','Belarus','europe','easternEurope'],
  [12,  4,'CZE','Czechia','europe','easternEurope'],
  [12,  6,'HUN','Hungary','europe','easternEurope'],
  [14,  3,'MDA','Republic of Moldova','europe','easternEurope'],
  [11,  3,'POL','Poland','europe','easternEurope'],
  [13,  6,'ROU','Romania','europe','easternEurope'],
  [15,  2,'RUS','Russian Federation','europe','easternEurope'],
  [12,  5,'SVK','Slovakia','europe','easternEurope'],
  [13,  4,'UKR','Ukraine','europe','easternEurope'],
  /* europe / northernEurope */
  [10,  2,'DNK','Denmark','europe','northernEurope'],
  [11,  2,'EST','Estonia','europe','northernEurope'],
  [11,  1,'FIN','Finland','europe','northernEurope'],
  [ 9,  2,'GBR','United Kingdom of Great Britain and Northern Ireland','europe','northernEurope'],
  [ 8,  2,'IRL','Ireland','europe','northernEurope'],
  [ 8,  1,'ISL','Iceland','europe','northernEurope'],
  [12,  3,'LTU','Lithuania','europe','northernEurope'],
  [12,  2,'LVA','Latvia','europe','northernEurope'],
  [ 9,  1,'NOR','Norway','europe','northernEurope'],
  [10,  1,'SWE','Sweden','europe','northernEurope'],
  /* europe / southernEurope */
  [11,  8,'ALB','Albania','europe','southernEurope'],
  [ 8,  7,'AND','Andorra','europe','southernEurope'],
  [11,  7,'BIH','Bosnia and Herzegovina','europe','southernEurope'],
  [ 8,  6,'ESP','Spain','europe','southernEurope'],
  [13,  8,'GRC','Greece','europe','southernEurope'],
  [11,  6,'HRV','Croatia','europe','southernEurope'],
  [10,  5,'ITA','Italy','europe','southernEurope'],
  [15,  3,'XKX','Kosovo','europe','southernEurope'],
  [12,  8,'MKD','North Macedonia','europe','southernEurope'],
  [14,  6,'MLT','Malta','europe','southernEurope'],
  [13,  9,'MNE','Montenegro','europe','southernEurope'],
  [ 8,  5,'PRT','Portugal','europe','southernEurope'],
  [ 9,  6,'SMR','San Marino','europe','southernEurope'],
  [12,  7,'SRB','Serbia','europe','southernEurope'],
  [11,  5,'SVN','Slovenia','europe','southernEurope'],
  [ 9,  7,'VAT','Holy See','europe','southernEurope'],
  /* europe / regionalBloc — not a sovereign state; excluded from country count */
  [10,  0,'EUU','European Union','europe','regionalBloc'],
  /* europe / westernEurope */
  [11,  4,'AUT','Austria','europe','westernEurope'],
  [ 9,  4,'BEL','Belgium','europe','westernEurope'],
  [10,  4,'CHE','Switzerland','europe','westernEurope'],
  [10,  3,'DEU','Germany','europe','westernEurope'],
  [ 9,  5,'FRA','France','europe','westernEurope'],
  [14,  4,'LIE','Liechtenstein','europe','westernEurope'],
  [ 8,  4,'LUX','Luxembourg','europe','westernEurope'],
  [10,  6,'MCO','Monaco','europe','westernEurope'],
  [ 9,  3,'NLD','Netherlands','europe','westernEurope'],
  /* oceania / australiaNz */
  [24, 13,'AUS','Australia','oceania','australiaNz'],
  [25, 14,'NZL','New Zealand','oceania','australiaNz'],
  /* oceania / melanesia */
  [26, 12,'FJI','Fiji','oceania','melanesia'],
  [25, 12,'PNG','Papua New Guinea','oceania','melanesia'],
  [25, 13,'SLB','Solomon Islands','oceania','melanesia'],
  [26, 13,'VUT','Vanuatu','oceania','melanesia'],
  /* oceania / micronesia */
  [26,  9,'FSM','Micronesia (Federated States of)','oceania','micronesia'],
  [28,  9,'KIR','Kiribati','oceania','micronesia'],
  [27,  9,'MHL','Marshall Islands','oceania','micronesia'],
  [26, 11,'NRU','Nauru','oceania','micronesia'],
  [26, 10,'PLW','Palau','oceania','micronesia'],
  /* oceania / polynesia */
  [29, 13,'COK','Cook Islands','oceania','polynesia'],
  [28, 14,'NIU','Niue','oceania','polynesia'],
  [27, 14,'TON','Tonga','oceania','polynesia'],
  [27, 11,'TUV','Tuvalu','oceania','polynesia'],
  [28, 13,'WSM','Samoa','oceania','polynesia'],
];

/* Build a canonical name → ISO3 map from HEX_LAYOUT — this is more complete
   than NAME_TO_ISO (which was missing Papua New Guinea, several Oceania +
   African states, etc.). Falls back to NAME_TO_ISO for anything not in
   HEX_LAYOUT (shouldn't happen but defensive). */
let _hexNameToIso = null;
function getHexNameToIso() {
  if (_hexNameToIso) return _hexNameToIso;
  _hexNameToIso = {};
  HEX_LAYOUT.forEach(([c, r, iso, name]) => { _hexNameToIso[name] = iso; });
  Object.assign(_hexNameToIso, NAME_TO_ISO);  // defensive fallback
  return _hexNameToIso;
}

/* M49 region membership — {africa: Set<countryName>, americas: Set<…>, …}.
   Built lazily from HEX_LAYOUT on first use.  Rail uses this to render the
   5 M49 region options and to expand a region filter into the list of
   country names we actually send to the server (the VM's `regions` param
   speaks Treaty Body electoral groups, not M49; we bypass it and filter
   by country instead).  Exposes UN M49 top-level categories as a first-
   class rail filter. */
const M49_REGION_KEYS = ['africa', 'americas', 'asia', 'europe', 'oceania'];
const M49_REGION_LABELS = {
  africa:   'Africa',
  americas: 'Americas',
  asia:     'Asia',
  europe:   'Europe',
  oceania:  'Oceania',
};
let _m49ByRegion = null;
function getM49RegionCountries() {
  if (_m49ByRegion) return _m49ByRegion;
  _m49ByRegion = {};
  M49_REGION_KEYS.forEach(k => { _m49ByRegion[k] = new Set(); });
  HEX_LAYOUT.forEach(([c, r, iso, name, region]) => {
    if (_m49ByRegion[region]) _m49ByRegion[region].add(name);
  });
  return _m49ByRegion;
}
/* Expand a region filter Set (from state.filters.region) to the union of
   country names it represents under M49.  Unknown region keys are skipped,
   so a stale server-side region ("GRULAC") from a saved view is ignored
   rather than breaking the filter.  Returns null if the region filter is
   empty (meaning: don't constrain by region at all). */
function expandM49RegionsToCountries(regionSet) {
  if (!regionSet || !regionSet.size) return null;
  const buckets = getM49RegionCountries();
  const out = new Set();
  regionSet.forEach(r => {
    const bucket = buckets[r];
    if (bucket) bucket.forEach(name => out.add(name));
  });
  return out;
}

function renderHexMap(container, countryCounts) {
  const nameToIso = getHexNameToIso();
  // Count lookup by ISO3
  const byIso = {};
  (countryCounts || []).forEach(c => {
    const name = cleanCountryName(c.country);
    const iso = nameToIso[name];
    if (iso) byIso[iso] = (byIso[iso] || 0) + c.count;
  });
  /* If the rail has a region filter active, the API returns records that
     match the filter — but the country_counts aggregation on those records
     includes every country listed on the record, not just the ones in the
     filtered region.  A record "USA + Fiji" being pulled in by a rail
     region=Oceania filter (because Fiji is Oceania) would otherwise light
     up USA on the world map.  Drop non-region counts after aggregation
     so the map only colours countries that actually belong to the filtered
     region(s).  Only applies when the active taxonomy is M49 — the Treaty
     Body electoral groups have country lists too but we'd need a different
     lookup to derive them; for now 'unGroups' accepts the cross-listing
     bleed as a known limitation. */
  const activeTax = (typeof state !== 'undefined' && state.regionTaxonomy) || 'm49';
  if (activeTax === 'm49' && state.filters?.region?.size
      && typeof expandM49RegionsToCountries === 'function') {
    const allowed = expandM49RegionsToCountries(state.filters.region);
    if (allowed && allowed.size) {
      const allowedIsos = new Set();
      allowed.forEach(n => { const i = nameToIso[n]; if (i) allowedIsos.add(i); });
      Object.keys(byIso).forEach(iso => {
        if (!allowedIsos.has(iso)) delete byIso[iso];
      });
    }
  }
  const MAX = Math.max(1, ...Object.values(byIso));
  const region = state.hexRegion || 'world';

  // Base hex size; zoomed regions use a bigger base so each hex reads larger
  // when there are fewer of them on screen. Auto-shrink further when a
  // region is dense enough that the default size would force vertical
  // scrolling (user feedback: Americas + Africa don't fit on one screen).
  // NOTE: post-M49 migration there is no separate `mena` region — Western
  // Asia is now part of `asia`, Northern Africa part of `africa`. Both of
  // those main regions grow, hence the shrink heuristic below.
  const SIZE_BY_REGION = { world: 24, americas: 28, europe: 24, africa: 24, asia: 26, oceania: 30 };
  let SIZE = SIZE_BY_REGION[region] || 24;
  const regionHexCount = (region === 'world' ? HEX_LAYOUT : HEX_LAYOUT.filter(h => h[4] === region)).length;
  if (region !== 'world') {
    if (regionHexCount >= 45) SIZE = Math.round(SIZE * 0.78);
    else if (regionHexCount >= 35) SIZE = Math.round(SIZE * 0.88);
    else if (regionHexCount >= 25) SIZE = Math.round(SIZE * 0.94);
  }

  const hexCenter = (col, row) => {
    const w = Math.sqrt(3) * SIZE;
    const h = 2 * SIZE;
    return [(col + (row & 1 ? 0.5 : 0)) * w, row * h * 0.75];
  };
  const hexPoints = (cx, cy, r = SIZE) => {
    let p = '';
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 90);
      p += (cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2) + ' ';
    }
    return p.trim();
  };
  /* Colour scale. Linear `n / MAX` produces a map where the top country
     (typically ~20k recs) washes out the middle and renders most countries
     nearly invisible. Square-root scaling — standard in cartography for
     choropleths over skewed counts — lifts the low bins without losing the
     max ordering. A floor of 0.15 on any non-zero count guarantees every
     country with at least one record is visibly coloured.

     Before: t=0.05 (1000 recs vs 20000 max) → step 0.08 (barely visible)
     After:  t=sqrt(0.05)=0.22 → step 0.32 (clearly visible) */
  const colorFor = n => {
    if (!n) return 'var(--paper-2)';
    const t = Math.sqrt(Math.min(1, n / MAX));
    const step = t < 0.22 ? 0.15 : t < 0.40 ? 0.32 : t < 0.60 ? 0.52 : t < 0.80 ? 0.72 : 0.92;
    return `color-mix(in oklab, var(--accent) ${Math.round(step * 100)}%, var(--paper-2))`;
  };
  const isLight = n => n && Math.sqrt(n / MAX) >= 0.40;

  // Filter hexes by region (world = all)
  const shownHexes = region === 'world' ? HEX_LAYOUT : HEX_LAYOUT.filter(h => h[4] === region);

  // Compute natural content extent
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  shownHexes.forEach(([c, r]) => {
    const [x, y] = hexCenter(c, r);
    minX = Math.min(minX, x - SIZE); minY = Math.min(minY, y - SIZE);
    maxX = Math.max(maxX, x + SIZE); maxY = Math.max(maxY, y + SIZE);
  });
  const pad = region === 'world' ? SIZE * 0.4 : SIZE * 0.3;
  // Extra head-room above world view for region labels
  const topPad = region === 'world' ? pad + SIZE * 0.5 : pad;
  let natX = minX - pad, natY = minY - topPad;
  let natW = maxX - minX + pad * 2;
  let natH = maxY - minY + pad + topPad;

  // Match container aspect.  Horizontal padding centers L/R (visually
  // natural); vertical padding anchors to TOP instead of centering so
  // there's no empty gap between the region-button row and the first
  // hex row.  (Previously: returning from a region zoom to the world
  // view left a wide empty band at the top because the content got
  // vertically centered in a taller viewBox.)
  //
  // IMPORTANT: aspect must use the SVG element's OWN rendered height,
  // not the parent container's full height — the parent ALSO contains
  // the region-button row above and the scale row below the SVG, plus
  // (after the user clicked ⓘ once) the M49 popover.  Including those
  // ~80–280px of chrome puffed the aspect denominator and made the
  // viewBox math compute a too-tall content box; with preserveAspectRatio
  // = "xMidYMid meet" the hexes scaled down and sat in the top portion
  // of a 520px SVG with a wide empty band underneath them.  Most
  // visible after returning from a region zoom to the world view.
  const rect = container.getBoundingClientRect();
  const existingSvg = container.querySelector('.hex-svg');
  // Existing SVG (re-render path) — read its CSS-driven height directly.
  // First-render path: fall back to the CSS default, picking the right
  // value for the current breakpoint.  The two values must stay in sync
  // with the `.hex-svg{height:520px}` rule and its mobile @media variant
  // `.hex-svg{height:360px}` in dashboard.html.
  let svgPx = existingSvg ? existingSvg.getBoundingClientRect().height : 0;
  if (!svgPx) {
    const isNarrow = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(max-width: 960px)').matches;
    svgPx = isNarrow ? 360 : 520;
  }
  const containerAspect = (rect.width && svgPx) ? (rect.width / svgPx) : 2.2;
  const naturalAspect = natW / natH;
  if (naturalAspect > containerAspect) {
    // Content wider than container → pad natH at the BOTTOM only.
    const targetH = natW / containerAspect;
    natH = targetH;  // natY stays at minY - topPad
  } else {
    // Content narrower → expand natW so aspect matches (center horizontally)
    const targetW = natH * containerAspect;
    natX -= (targetW - natW) / 2;
    natW = targetW;
  }
  const vb = `${natX} ${natY} ${natW} ${natH}`;

  /* World-view region labels — M49 top-level regions.  MENA (the old 6th
     region) is dissolved: Northern Africa lives inside AFRICA, Western
     Asia inside ASIA.  Positions chosen to sit above the densest part of
     each region cluster on the grid. */
  const labels = region === 'world' ? [
    ['AMERICAS', 1, 6],
    ['EUROPE',   9, 0],
    ['AFRICA',   10, 17],
    ['ASIA',     16, 3],   // shifted one column left since Asia now covers Western Asia
    ['OCEANIA',  25, 10],
  ].map(([t, c, r]) => {
    const [x, y] = hexCenter(c, r);
    return `<text class="region-lbl" x="${x}" y="${y - SIZE - 6}">${t}</text>`;
  }).join('') : '';

  /* Friendly labels for M49 sub-regions (shown in the hex tooltip). */
  const SUBREGION_LABELS = {
    northernAfrica: 'Northern Africa',
    easternAfrica: 'Eastern Africa',
    middleAfrica: 'Middle Africa',
    southernAfrica: 'Southern Africa',
    westernAfrica: 'Western Africa',
    caribbean: 'Caribbean',
    centralAmerica: 'Central America',
    southAmerica: 'South America',
    northernAmerica: 'Northern America',
    centralAsia: 'Central Asia',
    easternAsia: 'Eastern Asia',
    southeasternAsia: 'South-eastern Asia',
    southernAsia: 'Southern Asia',
    westernAsia: 'Western Asia',
    easternEurope: 'Eastern Europe',
    northernEurope: 'Northern Europe',
    southernEurope: 'Southern Europe',
    westernEurope: 'Western Europe',
    australiaNz: 'Australia & New Zealand',
    melanesia: 'Melanesia',
    micronesia: 'Micronesia',
    polynesia: 'Polynesia',
    regionalBloc: 'Regional bloc',
  };

  const hexes = shownHexes.map(([c, r, iso, name, _region, hexSub]) => {
    const [cx, cy] = hexCenter(c, r);
    const n = byIso[iso] || 0;
    const on = state.filters.country.has(name);
    const isBloc = hexSub === 'regionalBloc';
    const cls = 'hex' + (isLight(n) ? ' light' : '') + (n === 0 ? ' empty' : '') + (on ? ' on' : '') + (isBloc ? ' bloc' : '');
    const subLabel = SUBREGION_LABELS[hexSub] || hexSub || '';
    return `<g class="${cls}" data-iso="${iso}" data-name="${sanitize(name)}" data-count="${n}" data-subregion="${sanitize(subLabel)}" role="button" tabindex="0" aria-label="${sanitize(name)}: ${fmt(n)} records, ${sanitize(subLabel)}">
      <polygon points="${hexPoints(cx, cy)}" fill="${colorFor(n)}" stroke="var(--paper)" stroke-width="1.5"/>
      <text x="${cx}" y="${cy + 3}" text-anchor="middle">${iso}</text>
    </g>`;
  }).join('');

  /* Top-level regions now follow UN M49 ("Standard Country or Area Codes
     for Statistical Use", https://unstats.un.org/unsd/methodology/m49/):
     Africa / Americas / Asia / Europe / Oceania.  The old "MENA" region
     we used pre-April 2026 is gone — Northern Africa (Algeria/Egypt/Libya/
     Morocco/Sudan/Tunisia) now rolls up into Africa, Western Asia
     (Turkey/Israel/Saudi/Iran adjacent) into Asia, matching UN standards.
     Each hex still carries a sub-region field (22 M49 sub-regions — see
     SUBREGION_LABELS below) shown in the hex tooltip. */
  const regionBtns = ['world','africa','americas','asia','europe','oceania'].map(r =>
    `<button data-region="${r}" class="${r === region ? 'on' : ''}" title="Zoom to ${r === 'world' ? 'all 198 states + EU' : r}">${r === 'world' ? 'World' : r.charAt(0).toUpperCase() + r.slice(1)}</button>`
  ).join('');

  /* Taxonomy disclaimer popover.  Previously used the native title
     attribute which either didn't appear at all on some browsers or
     showed as a cramped single-line truncation that nobody reads.
     Now renders as a proper dismissable popover: click ⓘ to open,
     click again / Esc / click outside to close. HTML allows line
     breaks + an Ack. link to Methodology. */
  const regionInfoHtml = `
    <h5>About these regions</h5>
    <p>Top-level regions follow <strong>UN M49</strong> — <em>Standard Country or Area Codes for Statistical Use</em> (UNSD): <strong>Africa · Americas · Asia · Europe · Oceania</strong>.</p>
    <p>Each hex carries its M49 <strong>sub-region</strong> too (22 in total — e.g. <em>Northern Africa</em>, <em>Western Asia</em>, <em>Caribbean</em>, <em>Melanesia</em>). Hover a hex to see it.</p>
    <p>Note: M49 is a <strong>statistical</strong> classification, not a political one. For HRC / Treaty Body work the <strong>electoral groups</strong> apply instead (African · Asia-Pacific · Eastern European · GRULAC · WEOG). The rail <em>Region</em> filter now has a toggle to switch between the two.</p>
    <p><a href="#view=methodology" data-close-popover="1">Full rationale in Methodology ↗</a></p>
  `.replace(/\s+/g, ' ');
  const hasCountryFilter = state.filters.country.size > 0;
  container.innerHTML = `
    <div class="map-regions" id="hexRegions" role="group" aria-label="Zoom to region">${regionBtns}<button type="button" class="map-regions-info" id="mapRegionsInfo" aria-label="About this regional classification" aria-expanded="false" aria-controls="mapRegionsInfoPopover">ⓘ</button></div>
    <div class="map-regions-info-popover hidden" id="mapRegionsInfoPopover" role="dialog" aria-label="About this regional classification">${regionInfoHtml}</div>
    <svg class="hex-svg${hasCountryFilter?' has-filter':''}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Hex-tile map — ${region} — one hex per state party">${labels}${hexes}</svg>
    <div class="hex-tip" id="hexTip" role="tooltip"></div>
    <div class="map-scale" style="margin-top:6px">
      <span>0</span>
      ${[0.15,0.32,0.52,0.72,0.92].map(v => `<span class="s" style="background:color-mix(in oklab, var(--accent) ${Math.round(v*100)}%, var(--paper-2))"></span>`).join('')}
      <span>${fmt(MAX)}</span>
      <span style="margin-left:auto;color:var(--dim);font-size:10px" title="${shownHexes.length} ${region === 'world' ? 'states' : 'in region'} · click = filter · dblclick = profile">${shownHexes.length} ${region === 'world' ? 'states' : 'in region'} · click = filter · dblclick = profile</span>
    </div>`;

  // Region zoom buttons — `[data-region]` so we don't also toggle the
  // ⓘ info button (which is now a <button> inside the same container).
  container.querySelectorAll('#hexRegions button[data-region]').forEach(b => b.addEventListener('click', () => {
    state.hexRegion = b.dataset.region;
    renderHexMap(container, countryCounts);
    announce('Zoomed to ' + b.dataset.region);
  }));

  /* ⓘ popover — click to toggle, Esc / outside-click to close.  Replaces
     the native title attribute that either wasn't showing at all or was
     truncating to one unreadable line. */
  const infoBtn = container.querySelector('#mapRegionsInfo');
  const infoPop = container.querySelector('#mapRegionsInfoPopover');
  if (infoBtn && infoPop) {
    const closeInfo = () => {
      infoPop.classList.add('hidden');
      infoBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', outsideClick, true);
      document.removeEventListener('keydown', onKey);
    };
    function outsideClick(e) {
      if (!infoPop.contains(e.target) && !infoBtn.contains(e.target)) closeInfo();
    }
    function onKey(e) { if (e.key === 'Escape') closeInfo(); }
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = infoPop.classList.toggle('hidden');
      infoBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (!open) {
        // Opening — attach dismiss listeners once layout settles
        setTimeout(() => {
          document.addEventListener('click', outsideClick, true);
          document.addEventListener('keydown', onKey);
        }, 0);
      } else {
        document.removeEventListener('click', outsideClick, true);
        document.removeEventListener('keydown', onKey);
      }
    });
    // Clicking the Methodology link inside the popover navigates + closes.
    infoPop.querySelectorAll('a[data-close-popover]').forEach(a => a.addEventListener('click', closeInfo));
  }

  const tip = container.querySelector('#hexTip');
  container.querySelectorAll('g.hex').forEach(g => {
    g.addEventListener('mousemove', e => {
      const n = +g.dataset.count;
      const name = g.dataset.name;
      const iso = g.dataset.iso;
      const subregion = g.dataset.subregion || '';
      const sorted = (countryCounts || []).slice().sort((a, b) => b.count - a.count);
      const rank = sorted.findIndex(c => cleanCountryName(c.country) === name) + 1;
      tip.innerHTML = `
        <div class="nb">${sanitize(iso)} · ${n ? Math.round(n/MAX*100) : 0}% of max</div>
        <div class="nm">${sanitize(name)}</div>
        ${subregion ? `<div class="nm" style="color:var(--dim);font-size:10px;margin-top:2px">${sanitize(subregion)} <span style="opacity:.55">· UN M49</span></div>` : ''}
        <div class="ln"></div>
        <div class="row"><span>Recommendations</span><b>${fmt(n)}</b></div>
        <div class="row"><span>Rank</span><b>${rank ? '#' + rank : '—'}</b></div>`;
      const r = container.getBoundingClientRect();
      const relX = e.clientX - r.left;
      const relY = e.clientY - r.top;
      tip.style.transform = 'translate(12px, 12px)';
      tip.style.left = relX + 'px';
      tip.style.top  = relY + 'px';
      tip.classList.add('show');
      // Flip tip position if it would overflow the map container
      const tipRect = tip.getBoundingClientRect();
      let dx = 12, dy = 12;
      if (tipRect.right  > r.right  - 4) dx = -tipRect.width  - 12;
      if (tipRect.bottom > r.bottom - 4) dy = -tipRect.height - 12;
      if (relX + dx < 4) dx = 12;
      if (relY + dy < 4) dy = 12;
      tip.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    g.addEventListener('mouseleave', () => tip.classList.remove('show'));
    g.addEventListener('click', (e) => {
      const name = g.dataset.name;
      // Shift-click: toggle the rail filter (classic cross-filter behavior)
      if (e.shiftKey) {
        const s = state.filters.country;
        if (s.has(name)) s.delete(name); else s.add(name);
        g.classList.toggle('on', s.has(name));
        refreshFacetUI('country');
        onFiltersChanged();
        return;
      }
      // Default: click on a country opens the drawer list with all matching
      // records — infinite scroll. Theme / group / SDG clicks cross-filter.
      openListDrawer('country', name);
    });
    g.addEventListener('dblclick', () => {
      state.focusCountry = g.dataset.iso;
      const t = $('#tabCountry');
      if (t) t.textContent = g.dataset.name;
      navigate('country');
    });
    g.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.click(); }
    });
    // Preload country analytics on hover (same scheme as top-countries rows)
    let tH;
    g.addEventListener('mouseenter', () => {
      tH = setTimeout(() => preloadCountryOnHover(g.dataset.name), 250);
    });
    g.addEventListener('mouseleave', () => clearTimeout(tH));
  });
}

/* Map-mode dispatcher — the user's choice (choropleth | hex | grid) is
   persisted in localStorage.  Default is `choropleth` (GEO): real-world
   geography is the more immediately legible default; hex is available
   via the toggle for users who want visual fairness (one equal-sized
   tile per state). */
function getMapMode() {
  try { return localStorage.getItem('uhri_v2_map_mode') || 'choropleth'; } catch { return 'choropleth'; }
}
function setMapMode(m) {
  try { localStorage.setItem('uhri_v2_map_mode', m); } catch {}
}

function renderMap(container, countryCounts) {
  state._lastCountryCounts = countryCounts;
  // Migrate old localStorage value
  let mode = getMapMode();
  if (mode === 'grid') { mode = 'hex'; setMapMode(mode); }
  const _summary = () => _appendMapSrSummary(container, countryCounts);
  if (mode === 'hex') {
    renderHexMap(container, countryCounts);
    _summary();
  } else {
    renderChoroplethMap(container, countryCounts).then(_summary).catch(err => {
      console.warn('Choropleth failed, falling back to hex', err);
      renderHexMap(container, countryCounts);
      _summary();
    });
  }
}

/* A11Y: the map encodes counts by colour only. Append a visually-hidden text
   alternative so screen-reader and colour-blind users get the same data. */
function _appendMapSrSummary(container, countryCounts) {
  if (!container) return;
  const prev = container.querySelector('.map-sr-summary');
  if (prev) prev.remove();
  const arr = (countryCounts || [])
    .filter(c => c && c.count > 0)
    .map(c => [cleanCountryName(c.country), c.count])
    .sort((a, b) => b[1] - a[1]);
  const div = document.createElement('div');
  div.className = 'sr-only map-sr-summary';
  div.setAttribute('role', 'note');
  div.textContent = arr.length
    ? `Map text alternative: ${arr.length} countries with recommendations. Highest counts — ${arr.slice(0, 15).map(([n, v]) => `${n} ${fmt(v)}`).join('; ')}.`
    : 'Map text alternative: no country counts available for the current view.';
  container.appendChild(div);
}

/* ---------- LEGACY GRID MAP (fallback) ---------- */
function renderGridMap(container, countryCounts) {
  const ROWS=12, COLS=22;
  const byCell = {};
  // Aggregate by cell — normalize 2-letter ISO codes that leak as if they
  // were countries (e.g. "PK" → "Pakistan") so counts fold correctly
  countryCounts.forEach(c => {
    const normalized = cleanCountryName(c.country);
    const iso = NAME_TO_ISO[normalized];
    if (!iso || !MAP_LAYOUT[iso]) return;
    const [col, row] = MAP_LAYOUT[iso];
    const k = col + '-' + row;
    if (!byCell[k]) byCell[k] = { iso, total:0, names:[] };
    byCell[k].total += c.count;
    if (!byCell[k].names.includes(normalized)) byCell[k].names.push(normalized);
  });
  const max = Math.max(0, ...Object.values(byCell).map(v => v.total));
  let html = '<div class="map-grid">';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const k = c + '-' + r;
    const cell = byCell[k];
    if (cell) {
      const intensity = max ? cell.total/max : 0;
      const bg = `color-mix(in oklab, var(--accent) ${Math.round(8+intensity*80)}%, var(--paper-2))`;
      // Cell is "on" if ANY of its aggregated country names is filtered
      const on = cell.names.some(n => state.filters.country.has(n));
      html += `<div class="map-cell ${on?'on':''}" data-iso="${cell.iso}" data-name="${sanitize(cell.names[0])}" role="button" tabindex="0" aria-label="${sanitize(cell.names.join(', '))}: ${fmt(cell.total)} records — Enter to filter" style="background:${bg}" title="${sanitize(cell.names.join(', '))}: ${fmt(cell.total)} recs">${cell.iso}</div>`;
    } else {
      html += `<div class="map-cell empty"></div>`;
    }
  }
  html += '</div>';
  html += `<div class="map-scale"><span>less</span>` +
    [0.08,0.2,0.4,0.6,0.8].map(v=>`<span class="s" style="background:color-mix(in oklab, var(--accent) ${Math.round(v*100)}%, var(--paper-2))"></span>`).join('') +
    `<span>more</span><span style="margin-left:auto;color:var(--dim)">click cell = filter · double-click = country profile</span></div>`;
  container.innerHTML = html;
  container.querySelectorAll('.map-cell[data-iso]').forEach(cell => {
    cell.addEventListener('click', () => {
      const name = cell.dataset.name;
      const s = state.filters.country;
      if (s.has(name)) s.delete(name); else s.add(name);
      // IMMEDIATE visual feedback — toggle .on on this cell without waiting
      // for the 650ms-debounced full re-render
      cell.classList.toggle('on', s.has(name));
      refreshFacetUI('country');
      onFiltersChanged();
    });
    cell.addEventListener('dblclick', () => {
      state.focusCountry = cell.dataset.iso;
      $('#tabCountry').textContent = cell.dataset.name;
      navigate('country');
    });
    // Keyboard parity with the hex/choropleth cells: Enter/Space = filter.
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cell.click(); }
    });
  });
}

/* Timeline (stacked area, year × body), tooltip/sync, and stack-toggle
   moved to dashboard-timeline.js. */


function exportMapAsSVG() {
  const svg = $('#mapWrap svg');
  if (!svg) { toast('No map to export yet', true); return; }
  const clone = svg.cloneNode(true);
  // Fix: hex fills use `fill="var(--accent)"` + `color-mix(...)` which
  // are UNRESOLVED when the SVG is opened standalone (iOS preview,
  // Chrome file://, etc.) — every hex rendered BLACK. Walk the clone
  // and replace each fill attribute with its computed colour from the
  // live page (getComputedStyle resolves the CSS vars). Uses a throw-
  // away div to let the browser compute `color-mix(...)` → rgb().
  const probe = document.createElement('div');
  document.body.appendChild(probe);
  const resolveColor = (raw) => {
    if (!raw || raw === 'none' || raw === 'transparent') return raw;
    probe.style.color = raw;
    const c = getComputedStyle(probe).color;
    return c || raw;
  };
  clone.querySelectorAll('[fill]').forEach(el => {
    el.setAttribute('fill', resolveColor(el.getAttribute('fill')));
  });
  clone.querySelectorAll('[stroke]').forEach(el => {
    el.setAttribute('stroke', resolveColor(el.getAttribute('stroke')));
  });
  // Also pull computed colors of class-styled fills (for CSS rules like
  // .country.empty{fill:var(--paper-2)}).
  clone.querySelectorAll('.country.empty').forEach(el => el.setAttribute('fill', resolveColor('var(--paper-2)')));
  probe.remove();

  // Inline static styles (non-var) as a safety net.
  const css = `
    text{font-family:monospace;font-size:9px}
    .region-lbl{font-size:10px;fill:#6B6863;letter-spacing:2px}
    .country{stroke:#0F0F10;stroke-width:.4}
    .sphere{fill:none;stroke:#0F0F10;stroke-width:.4}
    .graticule{fill:none;stroke:rgba(0,0,0,.08);stroke-width:.3}
    .hex polygon{stroke:#F2EFE8;stroke-width:1.5}
    .hex.on polygon{stroke:#0F0F10;stroke-width:2.5}`;
  const style = document.createElementNS('http://www.w3.org/2000/svg','style');
  style.textContent = css;
  clone.insertBefore(style, clone.firstChild);
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
  downloadBlob(str, 'image/svg+xml', `uhri-map-${getMapMode()}-${new Date().toISOString().slice(0,10)}.svg`);
  toast('Map exported as SVG', false, 2500);
}
