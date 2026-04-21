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
   (short). Most of the 199 are identical; list only divergent cases. */
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
    return `<path class="${cls}" d="${d}" fill="${fill}" data-name="${sanitize(name)}" data-api="${sanitize(apiName||'')}" data-count="${count}" />`;
  }).filter(Boolean).join('');

  // Graticule for geographic context
  const graticule = d3geo.geoGraticule ? d3geo.geoGraticule().step([20,20])() : null;
  const gratPath = graticule ? pathGen(graticule) : '';
  const spherePath = pathGen({type:'Sphere'});

  const regions = ['world','americas','europe','mena','africa','asia','oceania'];
  const currentRegion = state.geoRegion || 'world';
  const regionBtnsHtml = regions.map(r =>
    `<button data-region="${r}" class="${r === currentRegion ? 'on' : ''}">${r === 'world' ? 'World' : r.charAt(0).toUpperCase() + r.slice(1)}</button>`
  ).join('');

  container.innerHTML = `
    <div class="map-regions" id="geoRegions" role="group" aria-label="Zoom to region">${regionBtnsHtml}<button id="geoReset" class="geo-reset" title="Reset view">⟲ Reset</button></div>
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
      <span style="margin-left:auto;color:var(--dim);font-size:10px">drag to pan · scroll to zoom · click = filter · dblclick = profile</span>
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
  function fitToRegion(region) {
    state.geoRegion = region;
    if (region === 'world') {
      setVB(...initialVB);
    } else {
      const regionMap = getRegionByTopoName();
      const hit = features.filter(f => regionMap[f.properties.name] === region);
      if (!hit.length) return;
      const bounds = pathGen.bounds({ type: 'FeatureCollection', features: hit });
      let x0 = bounds[0][0], y0 = bounds[0][1];
      let x1 = bounds[1][0], y1 = bounds[1][1];
      let rawW = x1 - x0, rawH = y1 - y0;
      // Aspect-match the container so the region sits CENTERED without the
      // viewBox being squished — this is why Europe / Oceania looked "off".
      const rect = svg.getBoundingClientRect();
      const containerAspect = (rect.width && rect.height) ? (rect.width / rect.height) : 2;
      const contentAspect = rawW / rawH;
      let vbW, vbH;
      if (contentAspect > containerAspect) {
        // Content is wider than container → grow height
        vbW = rawW; vbH = rawW / containerAspect;
      } else {
        // Content narrower → grow width
        vbH = rawH; vbW = rawH * containerAspect;
      }
      // Very small safety padding — users can scroll-zoom out if they want more context
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
      const newW = pinchStartVB[2] * scale;
      const newH = pinchStartVB[3] * scale;
      // Keep the midpoint anchored (same SVG point under the midpoint)
      const anchorX = pinchStartVB[0] + pinchCenterRatio.rx * pinchStartVB[2];
      const anchorY = pinchStartVB[1] + pinchCenterRatio.ry * pinchStartVB[3];
      const newX = anchorX - pinchCenterRatio.rx * newW;
      const newY = anchorY - pinchCenterRatio.ry * newH;
      setVB(newX, newY, newW, newH);
    } else if (activePointers.size === 1 && panning) {
      const vb = vbStart;
      const rect = svg.getBoundingClientRect();
      const scale = vb[2] / rect.width;
      setVB(vb[0] - (e.clientX - panStart.x) * scale,
            vb[1] - (e.clientY - panStart.y) * scale,
            vb[2], vb[3]);
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
  svg.addEventListener('pointerleave', releasePointer);

  // Scroll to zoom (centered on cursor position in SVG coords)
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    const vb = getVB();
    const rect = svg.getBoundingClientRect();
    const sx = vb[0] + (e.clientX - rect.left) / rect.width * vb[2];
    const sy = vb[1] + (e.clientY - rect.top) / rect.height * vb[3];
    const newW = vb[2] * factor;
    const newH = vb[3] * factor;
    const newX = sx - (e.clientX - rect.left) / rect.width * newW;
    const newY = sy - (e.clientY - rect.top) / rect.height * newH;
    setVB(newX, newY, newW, newH);
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
  [ 1, 0,'CAN','Canada','americas'],[ 2, 1,'USA','United States of America','americas'],
  [ 2, 2,'MEX','Mexico','americas'],[ 3, 2,'CUB','Cuba','americas'],
  [ 3, 3,'JAM','Jamaica','americas'],[ 4, 3,'HTI','Haiti','americas'],
  [ 4, 2,'DOM','Dominican Republic','americas'],[ 2, 3,'GTM','Guatemala','americas'],
  [ 2, 4,'SLV','El Salvador','americas'],[ 3, 4,'HND','Honduras','americas'],
  [ 3, 5,'NIC','Nicaragua','americas'],[ 2, 5,'CRI','Costa Rica','americas'],
  [ 3, 6,'PAN','Panama','americas'],[ 4, 5,'COL','Colombia','americas'],
  [ 5, 5,'VEN','Venezuela (Bolivarian Republic of)','americas'],[ 5, 6,'GUY','Guyana','americas'],
  [ 4, 6,'ECU','Ecuador','americas'],[ 4, 7,'PER','Peru','americas'],
  [ 5, 7,'BRA','Brazil','americas'],[ 5, 8,'BOL','Bolivia (Plurinational State of)','americas'],
  [ 4, 8,'CHL','Chile','americas'],[ 5, 9,'ARG','Argentina','americas'],
  [ 6, 9,'URY','Uruguay','americas'],[ 6, 8,'PRY','Paraguay','americas'],
  [ 8, 1,'ISL','Iceland','europe'],[ 9, 1,'NOR','Norway','europe'],
  [10, 1,'SWE','Sweden','europe'],[11, 1,'FIN','Finland','europe'],
  [ 9, 2,'GBR','United Kingdom of Great Britain and Northern Ireland','europe'],[ 8, 2,'IRL','Ireland','europe'],
  [10, 2,'DNK','Denmark','europe'],[11, 2,'EST','Estonia','europe'],
  [12, 2,'LVA','Latvia','europe'],[12, 3,'LTU','Lithuania','europe'],
  [ 9, 3,'NLD','Netherlands','europe'],[ 9, 4,'BEL','Belgium','europe'],
  [10, 3,'DEU','Germany','europe'],[11, 3,'POL','Poland','europe'],
  [13, 3,'BLR','Belarus','europe'],[13, 4,'UKR','Ukraine','europe'],
  [ 9, 5,'FRA','France','europe'],[ 8, 5,'PRT','Portugal','europe'],
  [ 8, 6,'ESP','Spain','europe'],[10, 4,'CHE','Switzerland','europe'],
  [10, 5,'ITA','Italy','europe'],[11, 4,'AUT','Austria','europe'],
  [11, 5,'SVN','Slovenia','europe'],[12, 4,'CZE','Czechia','europe'],
  [12, 5,'SVK','Slovakia','europe'],[12, 6,'HUN','Hungary','europe'],
  [11, 6,'HRV','Croatia','europe'],[12, 7,'SRB','Serbia','europe'],
  [11, 7,'BIH','Bosnia and Herzegovina','europe'],[11, 8,'ALB','Albania','europe'],
  [13, 6,'ROU','Romania','europe'],[13, 7,'BGR','Bulgaria','europe'],
  [12, 8,'MKD','North Macedonia','europe'],[13, 8,'GRC','Greece','europe'],
  [15, 2,'RUS','Russian Federation','europe'],
  [14, 5,'TUR','Türkiye','mena'],[14, 7,'LBN','Lebanon','mena'],
  [14, 8,'SYR','Syrian Arab Republic','mena'],[15, 7,'ISR','Israel','mena'],
  [15, 8,'JOR','Jordan','mena'],[15, 6,'GEO','Georgia','mena'],
  [16, 6,'ARM','Armenia','mena'],[16, 7,'AZE','Azerbaijan','mena'],
  [16, 8,'IRQ','Iraq','mena'],[17, 8,'IRN','Iran (Islamic Republic of)','mena'],
  [15, 9,'EGY','Egypt','mena'],[16, 9,'SAU','Saudi Arabia','mena'],
  [17, 9,'KWT','Kuwait','mena'],[18,10,'QAT','Qatar','mena'],
  [18,11,'ARE','United Arab Emirates','mena'],[17,11,'OMN','Oman','mena'],
  [16,10,'YEM','Yemen','mena'],[17,10,'BHR','Bahrain','mena'],
  [10, 7,'MAR','Morocco','africa'],[10, 8,'DZA','Algeria','africa'],
  [11, 9,'TUN','Tunisia','africa'],[12, 9,'LBY','Libya','africa'],
  [13,10,'SDN','Sudan','africa'],[14, 9,'SSD','South Sudan','africa'],
  [ 9, 8,'MRT','Mauritania','africa'],[ 9, 9,'SEN','Senegal','africa'],
  [ 9,10,'GIN','Guinea','africa'],[10, 9,'MLI','Mali','africa'],
  [11,10,'NER','Niger','africa'],[12,10,'TCD','Chad','africa'],
  [10,10,'BFA','Burkina Faso','africa'],[10,11,'CIV',"Côte d'Ivoire",'africa'],
  [ 9,11,'LBR','Liberia','africa'],[ 8,10,'SLE','Sierra Leone','africa'],
  [11,11,'GHA','Ghana','africa'],[11,12,'TGO','Togo','africa'],
  [12,11,'BEN','Benin','africa'],[12,12,'NGA','Nigeria','africa'],
  [13,11,'CMR','Cameroon','africa'],[13,12,'CAF','Central African Republic','africa'],
  [14,10,'ETH','Ethiopia','africa'],[14,11,'ERI','Eritrea','africa'],
  [15,10,'SOM','Somalia','africa'],[14,12,'KEN','Kenya','africa'],
  [13,13,'UGA','Uganda','africa'],[12,13,'COD','Democratic Republic of the Congo','africa'],
  [11,13,'COG','Congo','africa'],[10,13,'GAB','Gabon','africa'],
  [14,13,'TZA','United Republic of Tanzania','africa'],[13,14,'RWA','Rwanda','africa'],
  [14,14,'BDI','Burundi','africa'],[12,14,'AGO','Angola','africa'],
  [13,15,'ZMB','Zambia','africa'],[14,15,'MWI','Malawi','africa'],
  [13,16,'ZWE','Zimbabwe','africa'],[14,16,'MOZ','Mozambique','africa'],
  [12,16,'NAM','Namibia','africa'],[13,17,'BWA','Botswana','africa'],
  [13,18,'ZAF','South Africa','africa'],[14,18,'LSO','Lesotho','africa'],
  [14,17,'SWZ','Eswatini','africa'],[15,16,'MDG','Madagascar','africa'],
  [16, 3,'KAZ','Kazakhstan','asia'],[17, 4,'MNG','Mongolia','asia'],
  [17, 6,'UZB','Uzbekistan','asia'],[17, 7,'TKM','Turkmenistan','asia'],
  [18, 5,'KGZ','Kyrgyzstan','asia'],[18, 6,'TJK','Tajikistan','asia'],
  [18, 7,'AFG','Afghanistan','asia'],[19, 7,'PAK','Pakistan','asia'],
  [19, 8,'IND','India','asia'],[20, 7,'NPL','Nepal','asia'],
  [20, 8,'BTN','Bhutan','asia'],[20, 9,'BGD','Bangladesh','asia'],
  [19, 9,'LKA','Sri Lanka','asia'],[19,10,'MDV','Maldives','asia'],
  [19, 5,'CHN','China','asia'],[20, 4,'PRK',"Democratic People's Republic of Korea",'asia'],
  [20, 5,'KOR','Republic of Korea','asia'],[21, 4,'JPN','Japan','asia'],
  [21, 7,'MMR','Myanmar','asia'],[21, 8,'THA','Thailand','asia'],
  [22, 8,'LAO',"Lao People's Democratic Republic",'asia'],
  [22, 9,'KHM','Cambodia','asia'],[22, 7,'VNM','Viet Nam','asia'],
  [22,10,'MYS','Malaysia','asia'],[22,11,'SGP','Singapore','asia'],
  [23, 9,'PHL','Philippines','asia'],[23,11,'IDN','Indonesia','asia'],
  [23,12,'TLS','Timor-Leste','asia'],[21, 9,'BRN','Brunei Darussalam','asia'],
  [24,13,'AUS','Australia','oceania'],[25,12,'PNG','Papua New Guinea','oceania'],
  [25,14,'NZL','New Zealand','oceania'],[26,12,'FJI','Fiji','oceania'],
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

function renderHexMap(container, countryCounts) {
  const nameToIso = getHexNameToIso();
  // Count lookup by ISO3
  const byIso = {};
  (countryCounts || []).forEach(c => {
    const name = cleanCountryName(c.country);
    const iso = nameToIso[name];
    if (iso) byIso[iso] = (byIso[iso] || 0) + c.count;
  });
  const MAX = Math.max(1, ...Object.values(byIso));
  const region = state.hexRegion || 'world';

  // Base hex size; zoomed regions use a bigger base so each hex reads larger
  // when there are fewer of them on screen. Auto-shrink further when a
  // region is dense enough that the default size would force vertical
  // scrolling (user feedback: Americas + Africa don't fit on one screen).
  const SIZE_BY_REGION = { world: 24, americas: 30, europe: 28, mena: 34, africa: 26, asia: 30, oceania: 36 };
  let SIZE = SIZE_BY_REGION[region] || 24;
  const regionHexCount = (region === 'world' ? HEX_LAYOUT : HEX_LAYOUT.filter(h => h[4] === region)).length;
  if (region !== 'world') {
    if (regionHexCount >= 35) SIZE = Math.round(SIZE * 0.82);
    else if (regionHexCount >= 25) SIZE = Math.round(SIZE * 0.9);
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
  const colorFor = n => {
    if (!n) return 'var(--paper-2)';
    const t = Math.min(1, n / MAX);
    const step = t < 0.06 ? 0.08 : t < 0.18 ? 0.24 : t < 0.36 ? 0.44 : t < 0.6 ? 0.65 : 0.92;
    return `color-mix(in oklab, var(--accent) ${Math.round(step * 100)}%, var(--paper-2))`;
  };
  const isLight = n => n && (n / MAX) >= 0.36;

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

  // Match container aspect so content stays CENTERED regardless of region size.
  // Without this, Oceania (5 hexes, narrow+tall viewBox) or Europe (wider)
  // scales inconsistently inside the fixed-aspect container.
  const rect = container.getBoundingClientRect();
  const containerAspect = (rect.width && rect.height) ? (rect.width / rect.height) : 2.2;
  const naturalAspect = natW / natH;
  if (naturalAspect > containerAspect) {
    // Content is wider than container → expand natH so aspect matches
    const targetH = natW / containerAspect;
    natY -= (targetH - natH) / 2;
    natH = targetH;
  } else {
    // Content is narrower → expand natW so aspect matches (centers horizontally)
    const targetW = natH * containerAspect;
    natX -= (targetW - natW) / 2;
    natW = targetW;
  }
  const vb = `${natX} ${natY} ${natW} ${natH}`;

  const labels = region === 'world' ? [
    ['AMERICAS', 1, 6], ['EUROPE', 9, 0], ['MENA', 15, 5],
    ['AFRICA', 10, 17], ['ASIA', 18, 3], ['OCEANIA', 24, 10],
  ].map(([t, c, r]) => {
    const [x, y] = hexCenter(c, r);
    return `<text class="region-lbl" x="${x}" y="${y - SIZE - 6}">${t}</text>`;
  }).join('') : '';

  const hexes = shownHexes.map(([c, r, iso, name]) => {
    const [cx, cy] = hexCenter(c, r);
    const n = byIso[iso] || 0;
    const on = state.filters.country.has(name);
    const cls = 'hex' + (isLight(n) ? ' light' : '') + (n === 0 ? ' empty' : '') + (on ? ' on' : '');
    return `<g class="${cls}" data-iso="${iso}" data-name="${sanitize(name)}" data-count="${n}" role="button" tabindex="0" aria-label="${sanitize(name)}: ${fmt(n)} records">
      <polygon points="${hexPoints(cx, cy)}" fill="${colorFor(n)}" stroke="var(--paper)" stroke-width="1.5"/>
      <text x="${cx}" y="${cy + 3}" text-anchor="middle">${iso}</text>
    </g>`;
  }).join('');

  const regionBtns = ['world','americas','europe','mena','africa','asia','oceania'].map(r =>
    `<button data-region="${r}" class="${r === region ? 'on' : ''}" title="Zoom to ${r === 'world' ? 'all 199 states' : r}">${r === 'world' ? 'World' : r.charAt(0).toUpperCase() + r.slice(1)}</button>`
  ).join('');

  const hasCountryFilter = state.filters.country.size > 0;
  container.innerHTML = `
    <div class="map-regions" id="hexRegions" role="group" aria-label="Zoom to region">${regionBtns}</div>
    <svg class="hex-svg${hasCountryFilter?' has-filter':''}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Hex-tile map — ${region} — one hex per state party">${labels}${hexes}</svg>
    <div class="hex-tip" id="hexTip" role="tooltip"></div>
    <div class="map-scale" style="margin-top:6px">
      <span>0</span>
      ${[0.08,0.24,0.44,0.65,0.92].map(v => `<span class="s" style="background:color-mix(in oklab, var(--accent) ${Math.round(v*100)}%, var(--paper-2))"></span>`).join('')}
      <span>${fmt(MAX)}</span>
      <span style="margin-left:auto;color:var(--dim);font-size:10px">${shownHexes.length} ${region === 'world' ? 'states' : 'in region'} · click = filter · dblclick = profile</span>
    </div>`;

  // Region zoom buttons
  container.querySelectorAll('#hexRegions button').forEach(b => b.addEventListener('click', () => {
    state.hexRegion = b.dataset.region;
    renderHexMap(container, countryCounts);
    announce('Zoomed to ' + b.dataset.region);
  }));

  const tip = container.querySelector('#hexTip');
  container.querySelectorAll('g.hex').forEach(g => {
    g.addEventListener('mousemove', e => {
      const n = +g.dataset.count;
      const name = g.dataset.name;
      const iso = g.dataset.iso;
      const sorted = (countryCounts || []).slice().sort((a, b) => b.count - a.count);
      const rank = sorted.findIndex(c => cleanCountryName(c.country) === name) + 1;
      tip.innerHTML = `
        <div class="nb">${sanitize(iso)} · ${n ? Math.round(n/MAX*100) : 0}% of max</div>
        <div class="nm">${sanitize(name)}</div>
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

/* Map-mode dispatcher — the user's choice (hex | choropleth | grid) is
   persisted in localStorage. Hex is the default. */
function getMapMode() {
  try { return localStorage.getItem('uhri_v2_map_mode') || 'hex'; } catch { return 'hex'; }
}
function setMapMode(m) {
  try { localStorage.setItem('uhri_v2_map_mode', m); } catch {}
}

function renderMap(container, countryCounts) {
  state._lastCountryCounts = countryCounts;
  // Migrate old localStorage value
  let mode = getMapMode();
  if (mode === 'grid') { mode = 'hex'; setMapMode(mode); }
  if (mode === 'hex') {
    renderHexMap(container, countryCounts);
  } else {
    renderChoroplethMap(container, countryCounts).catch(err => {
      console.warn('Choropleth failed, falling back to hex', err);
      renderHexMap(container, countryCounts);
    });
  }
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
      html += `<div class="map-cell ${on?'on':''}" data-iso="${cell.iso}" data-name="${sanitize(cell.names[0])}" style="background:${bg}" title="${sanitize(cell.names.join(', '))}: ${fmt(cell.total)} recs">${cell.iso}</div>`;
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
