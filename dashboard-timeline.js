/* UHRI Dashboard — timeline chart (stacked area, year × body) and its
 * cross-chart sync machinery.
 *
 * Extracted from dashboard.html inline as part of the seam split. The
 * timeline is rendered on seven surfaces (Overview FIG.04, Compare A vs B,
 * Country/Theme/Group/SDG/Mechanism profiles), so concentrating its code
 * in one place is worth the module boundary.
 *
 * LOAD ORDER
 *   Runs AFTER helpers/data (needs cleanLabel + cssVar + state) and BEFORE
 *   the inline <script> in dashboard.html. Dependencies:
 *
 *   (a) Top-level from earlier modules:
 *         cleanLabel, cssVar   (helpers)
 *         state                (data)
 *
 *   (b) Lazy from inline (only called inside function bodies, never at
 *       top-level evaluation — safe under forward-ref lookup):
 *         classifyBody         — maps a body name to its mechanism family
 *         onFiltersChanged     — called from interactive event handlers
 *
 * EXTERNAL SURFACE (what inline and other modules reach into here)
 *   renderTimeline(container, yearlyBodyCountsRaw, opts)  — main renderer
 *   _renderStackToggle(hostEl, currentMode, onChange)     — Family/By-body pill
 *   getTimelineMode() / setTimelineMode(_m)               — legacy shim
 *   _wireTimelineTooltip(container, ctx)                  — tooltip + sync
 *
 * Internal state:
 *   _tlSyncRegistry  — cross-chart year-sync for Compare A↔B mirror-hover.
 *   _normalizeYearlyBodyCounts(input)  — shape adapter (array ↔ dict).
 */

/* ---------- TIMELINE (stacked area, year × body) ----------
   Accepts either:
   - A list of {year, body, count} objects (what the API returns)
   - A dict {year: {body: count}} (legacy shape) */
function _normalizeYearlyBodyCounts(input) {
  if (!input) return {};
  if (Array.isArray(input)) {
    const out = {};
    input.forEach(row => {
      const y = Number(row.year); const b = String(row.body||''); const c = Number(row.count||0);
      if (!Number.isFinite(y) || !b) return;
      if (!out[y]) out[y] = {};
      out[y][b] = (out[y][b] || 0) + c;
    });
    return out;
  }
  return input;
}
// Timeline mode is fixed to 'annual' (stacked by body) — the alternative
// cumulative/total-line views were confusing and rarely used. Kept as a
// function so callers that pass `opts.mode` still work.
function getTimelineMode() { return 'annual'; }
function setTimelineMode(_m) { /* no-op, kept for callers wired to old toggle */ }

function renderTimeline(container, yearlyBodyCountsRaw, opts={}) {
  const yearlyBodyCounts = _normalizeYearlyBodyCounts(yearlyBodyCountsRaw);
  const W=1000, H=220, pad={l:40,r:20,t:14,b:26};
  // Always pad X-axis to the full dataset range (2006–2026 by default) so
  // sparse results (e.g. body=CCPR for one country → 2 data points) don't
  // collapse into a single trapezoid and lose their temporal context.
  const rangeMin = state.facets?.min_year || 2006;
  const rangeMax = state.facets?.max_year || 2026;
  const presentYears = Object.keys(yearlyBodyCounts).map(Number).filter(y => y >= 1990 && y <= 2100);
  if (!presentYears.length) { container.innerHTML = '<div class="panel-loading" style="padding:80px 0">No data for this filter</div>'; return; }
  const years = [];
  for (let y = rangeMin; y <= rangeMax; y++) years.push(y);
  const mode = opts.mode || getTimelineMode();  // 'annual' | 'cumulative' | 'total-line'
  // T1: stack dimension — 'body' (default, top 6 bodies) or 'family'
  // (3 layers: UPR / Treaty Bodies / Special Procedures, colour-coded
  // with --mech-* custom props). Overview + Compare pass 'family' so
  // the big-picture view matches the KPI strip; drill-down profiles
  // (country, theme, mechanism single body…) stay at body granularity.
  const stackBy = opts.stackBy || 'body';

  let stackKeys;       // ordered list of stack-layer identifiers
  let stackLabels;     // human-readable label per layer (for legend/tooltip)
  let stackColors;     // CSS colour per layer (index-aligned with stackKeys)
  let yearToLayer;     // (year) => [countsForEachLayer]

  if (stackBy === 'family') {
    // Three deterministic layers — always in this order so colours and
    // legend stay stable regardless of which mechanisms actually have
    // data in the current filter.
    stackKeys   = ['upr', 'treaty', 'sp'];
    stackLabels = { upr: 'UPR', treaty: 'Treaty Bodies', sp: 'Special Procedures' };
    stackColors = {
      upr:    cssVar('--mech-upr') || '#c2410c',
      treaty: cssVar('--mech-tb')  || '#0d9488',
      sp:     cssVar('--mech-sp')  || '#7c3aed',
    };
    yearToLayer = (y) => {
      const m = yearlyBodyCounts[y] || {};
      const agg = { upr: 0, treaty: 0, sp: 0, other: 0 };
      Object.entries(m).forEach(([b, c]) => { agg[classifyBody(b)] += c; });
      return stackKeys.map(k => agg[k]);
    };
  } else {
    // P4: dynamic top-8 + Other. If ≤8 bodies in the filter, show them
    // all (every layer named). If >8, show the top-8 by volume and
    // bundle the remaining N-8 into an "Other (N-8 bodies)" aggregate
    // stack in a faded neutral. This fixes the old "top 6 only" silent
    // truncation where the chart claimed "Volume over time" but
    // actually excluded every non-top-6 body — so annualTotals lied
    // about the Y-axis max too. Now Y reflects true annual volume.
    const bodyTotals = {};
    years.forEach(y => {
      const m = yearlyBodyCounts[y] || {};
      Object.entries(m).forEach(([b,c]) => bodyTotals[b] = (bodyTotals[b]||0) + c);
    });
    const allSorted = Object.entries(bodyTotals).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
    // Top 6 + Other reads more cleanly than top 8 + Other — 6 greyscale
    // layers stay individually distinguishable; 8 blur together in the
    // stacked chart. Tail still visible as a "Other (N bodies)" aggregate.
    const TOP_N = 6;
    const topBodies = allSorted.slice(0, TOP_N);
    const otherBodies = allSorted.slice(TOP_N);
    const hasOther = otherBodies.length > 0;
    stackKeys = hasOther ? [...topBodies, '__other__'] : topBodies;
    stackLabels = Object.fromEntries(topBodies.map(k => [k, k]));
    if (hasOther) {
      stackLabels['__other__'] = `Other (${otherBodies.length} ${otherBodies.length===1?'body':'bodies'})`;
    }
    const ink = cssVar('--ink'), accent = cssVar('--accent');
    // Greyscale ramp for top 6 named bodies. 6th gets accent to stand
    // out against adjacent greys; Other (if present) uses --stack-other
    // — a faded neutral palette-aware tint.
    const bodyPalette = [ink, '#3a3a3a', '#5c5a55', '#7a7872', '#98968f', accent];
    stackColors = Object.fromEntries(topBodies.map((k, i) => [k, bodyPalette[i] || '#aba9a2']));
    if (hasOther) stackColors['__other__'] = cssVar('--stack-other') || '#bcbab2';
    yearToLayer = (y) => {
      const m = yearlyBodyCounts[y] || {};
      return stackKeys.map(k => {
        if (k === '__other__') return otherBodies.reduce((sum, b) => sum + (m[b] || 0), 0);
        return m[k] || 0;
      });
    };
    // Stash for tooltip use so body-mode breakdown can expose the
    // individual bodies that roll up into "Other" when the user hovers.
    opts._otherBodies = otherBodies;
  }

  // Hidden layers are zeroed so their area disappears; still show in legend.
  const hidden = state._hiddenBodies || new Set();
  const stacks = years.map(y => yearToLayer(y).map((v, i) => hidden.has(stackKeys[i]) ? 0 : v));
  const annualTotals = stacks.map(s => s.reduce((a,b)=>a+b,0));
  // Cumulative: running sum — each year includes everything before it
  const cumulTotals = [];
  annualTotals.reduce((acc, v, i) => { cumulTotals[i] = acc + v; return cumulTotals[i]; }, 0);

  const xStep = (W-pad.l-pad.r) / Math.max(1, years.length-1);
  // Kept for cumulative / total-line modes which use ink/accent directly
  const ink = cssVar('--ink'), accent = cssVar('--accent');

  // Pick series/max depending on mode
  const series = mode === 'cumulative' ? cumulTotals : annualTotals;
  // C2: allow caller to force a shared Y-axis max (Compare A-vs-B uses
  // this so both timelines share the same scale — without it, a small
  // peak in B can render at the same pixel height as a huge peak in A).
  const baseMax = (opts.yMax && opts.yMax > 0) ? Math.max(1, opts.yMax) : Math.max(1, ...series);
  // Dense profile charts benefit from a little breathing room above their
  // highest peak. Callers opt in so Country and shared-scale Compare charts
  // retain their established framing.
  const yHeadroom = Math.max(1, Number(opts.yHeadroom) || 1);
  const max = baseMax * yHeadroom;
  const yOf = v => pad.t + (H-pad.t-pad.b)*(1 - v/max);

  // Grid + Y labels
  let g = `<g>`;
  [0,.25,.5,.75,1].forEach(p => {
    const y = pad.t + (H-pad.t-pad.b)*(1-p);
    g += `<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="${ink}" stroke-opacity=".07"/>`;
    g += `<text x="${pad.l-6}" y="${y+3}" text-anchor="end" font-family="var(--mono)" font-size="9" fill="${ink}" opacity=".5">${fmt(Math.round(max*p))}</text>`;
  });
  g += `</g>`;

  if (mode === 'cumulative') {
    // Single-line cumulative — running total, rises monotonically
    const line = years.map((_,i) => `${pad.l+i*xStep},${yOf(cumulTotals[i])}`).join(' ');
    const area = `M ${pad.l},${H-pad.b} L ${line.split(' ').join(' L ')} L ${pad.l+(years.length-1)*xStep},${H-pad.b} Z`;
    g += `<path d="${area}" fill="${accent}" fill-opacity="0.22"/>`;
    g += `<polyline points="${line}" fill="none" stroke="${ink}" stroke-width="1.8"/>`;
    years.forEach((_,i) => {
      g += `<circle cx="${pad.l+i*xStep}" cy="${yOf(cumulTotals[i])}" r="2" fill="${ink}"><title>${years[i]}: ${fmt(cumulTotals[i])}</title></circle>`;
    });
  } else if (mode === 'total-line') {
    // Simple line + area: single series of annual totals (no body split)
    const line = years.map((_,i) => `${pad.l+i*xStep},${yOf(annualTotals[i])}`).join(' ');
    const area = `M ${pad.l},${H-pad.b} L ${line.split(' ').join(' L ')} L ${pad.l+(years.length-1)*xStep},${H-pad.b} Z`;
    g += `<path d="${area}" fill="${accent}" fill-opacity="0.20"/>`;
    g += `<polyline points="${line}" fill="none" stroke="${ink}" stroke-width="1.6"/>`;
    years.forEach((_,i) => {
      g += `<circle cx="${pad.l+i*xStep}" cy="${yOf(annualTotals[i])}" r="2" fill="${ink}"><title>${years[i]}: ${fmt(annualTotals[i])}</title></circle>`;
    });
  } else {
    // Default: stacked area by stackBy dimension (family or body)
    const cumulative = years.map(()=>0);
    stackKeys.forEach((key, bi) => {
      for (let i = 0; i < years.length; i++) cumulative[i] += stacks[i][bi];
      const topPts = years.map((_,i)=>`${pad.l+i*xStep},${yOf(cumulative[i])}`);
      const botPts = years.map((_,i)=>`${pad.l+i*xStep},${yOf(cumulative[i]-stacks[i][bi])}`).reverse();
      const col = stackColors[key] || accent;
      // In family mode all 3 layers have similar weight — fuller opacity.
      // In body mode keep the fade so top-1 reads strongest.
      const alpha = stackBy === 'family' ? 0.82 : (bi===5?0.9:(0.85-bi*0.06));
      g += `<polygon points="${topPts.concat(botPts).join(' ')}" fill="${col}" opacity="${alpha}"><title>${sanitize(stackLabels[key] || key)}</title></polygon>`;
    });
    // Sparse-data markers: when the dataset only has a handful of years
    // with non-zero data, plain trapezoids are hard to read. Overlay a
    // circle at every non-zero year so the viewer can pinpoint them.
    const nonZeroCount = annualTotals.filter(v => v > 0).length;
    if (nonZeroCount > 0 && nonZeroCount < 6) {
      years.forEach((y, i) => {
        if (annualTotals[i] > 0) {
          g += `<circle cx="${pad.l+i*xStep}" cy="${yOf(annualTotals[i])}" r="3" fill="${ink}" stroke="${cssVar('--paper')}" stroke-width="1.5"><title>${y}: ${fmt(annualTotals[i])}</title></circle>`;
        }
      });
    }
  }

  // X-axis labels — DON'T render inside SVG. The SVG uses
  // preserveAspectRatio="none" which would stretch/squish text along with
  // the chart. Instead emit a native HTML row of year labels below the
  // SVG via a small placeholder in `.tl-hint` (see container.innerHTML
  // below). This keeps labels legible at every container width.
  const labelStep = years.length > 20 ? 5 : (years.length > 12 ? 2 : 1);
  const yearLabelsHtml = years
    .map((y, i) => (i % labelStep === 0 || i === years.length - 1)
      ? `<span style="position:absolute;left:${(i / Math.max(1, years.length - 1)) * 100}%;transform:translateX(-50%);white-space:nowrap">${y}</span>`
      : '')
    .filter(Boolean)
    .join('');

  let modeHint;
  if (mode === 'cumulative') modeHint = 'cumulative total';
  else if (mode === 'total-line') modeHint = 'annual total (all bodies)';
  else if (stackKeys.length === 0) modeHint = 'no data';
  else if (stackBy === 'family') modeHint = 'annual · stacked by mechanism family (click legend to toggle)';
  else if (stackKeys.length === 1) modeHint = `annual · only ${String(stackKeys[0]).replace(/^-\s*/, '')}`;
  else if (stackKeys.includes('__other__')) {
    const otherN = (opts._otherBodies || []).length;
    const namedN = stackKeys.length - 1; // minus '__other__'
    modeHint = `annual · top ${namedN} bodies + Other (${otherN} more bundled · all bodies included)`;
  }
  else modeHint = `annual · stacked by all ${stackKeys.length} bodies (click legend to toggle)`;
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="tl-svg">${g}</svg>
    <div class="tl-years">${yearLabelsHtml}</div>
    <div class="tl-hint">${modeHint} · ${opts.interactive !== false ? 'click year · drag to select range' : 'read-only'}</div>`;

  // Click/drag interaction: map pixel x → year, set state.filters.yearA/B
  // Only on Overview's timeline (opts.interactive !== false). Skips country
  // & theme profile timelines since they're showing a scoped view.
  if (opts.interactive !== false) {
    const svg = container.querySelector('svg');
    const xToYear = clientX => {
      const rect = svg.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const innerPct = (relX * W - pad.l) / (W - pad.l - pad.r);
      const year = years[0] + Math.round(innerPct * (years.length - 1));
      return Math.max(years[0], Math.min(years[years.length - 1], year));
    };
    let dragStart = null, selEl = null;
    // M3 · C1: use Pointer Events so touch + pen + mouse all work through
    // the same handlers. Legacy mouseleave kept via pointerleave so the
    // drag cancels correctly when the pointer exits the SVG mid-drag.
    const pointerDown = (clientX, clientY) => {
      dragStart = xToYear(clientX);
      selEl = document.createElement('div');
      selEl.className = 'tl-sel';
      const rect = svg.getBoundingClientRect();
      const startX = clientX - rect.left;
      selEl.style.left = startX + 'px';
      selEl.style.width = '1px';
      container.appendChild(selEl);
    };
    const pointerMove = (clientX) => {
      if (!dragStart || !selEl) return;
      const rect = svg.getBoundingClientRect();
      const startX = ((dragStart - years[0]) / (years.length - 1)) * (rect.width * (W - pad.l - pad.r) / W) + rect.width * pad.l / W;
      const curX = clientX - rect.left;
      selEl.style.left = Math.min(startX, curX) + 'px';
      selEl.style.width = Math.abs(curX - startX) + 'px';
    };
    const finish = (clientX) => {
      if (dragStart == null) return;
      const endYear = xToYear(clientX);
      const [a, b] = dragStart <= endYear ? [dragStart, endYear] : [endYear, dragStart];
      state.filters.yearA = a;
      state.filters.yearB = b;
      if (typeof window._syncYearSlider === 'function') window._syncYearSlider();
      if (selEl) { selEl.remove(); selEl = null; }
      dragStart = null;
      onFiltersChanged();
    };
    svg.addEventListener('pointerdown', e => { svg.setPointerCapture?.(e.pointerId); pointerDown(e.clientX, e.clientY); });
    svg.addEventListener('pointermove', e => pointerMove(e.clientX));
    svg.addEventListener('pointerup',   e => finish(e.clientX));
    svg.addEventListener('pointercancel', e => { if (dragStart != null) finish(e.clientX); });
    svg.addEventListener('pointerleave',  e => { if (dragStart != null) finish(e.clientX); });
  }

  // Interactive legend — each stack layer can be toggled off/on via click
  if (opts.legendEl) {
    opts.legendEl.innerHTML = stackKeys.map((key) => {
      const col = stackColors[key] || 'var(--accent)';
      const rawLbl = stackLabels[key] || key;
      const lbl = stackBy === 'family' ? rawLbl : cleanLabel(rawLbl);
      const short = lbl.length > 20 ? lbl.slice(0,18)+'…' : lbl;
      const isOff = (state._hiddenBodies || new Set()).has(key);
      return `<span class="legend-body${isOff?' off':''}" data-body="${sanitize(key)}" title="${sanitize(lbl)} — click to ${isOff?'show':'hide'}" style="display:inline-flex;gap:4px;align-items:center;margin-right:6px;font-size:10px"><span class="swatch" style="width:10px;height:10px;background:${col};display:inline-block"></span>${sanitize(short)}</span>`;
    }).join('');
    opts.legendEl.querySelectorAll('.legend-body').forEach(span => {
      span.addEventListener('click', () => {
        if (!state._hiddenBodies) state._hiddenBodies = new Set();
        const b = span.dataset.body;
        if (state._hiddenBodies.has(b)) state._hiddenBodies.delete(b);
        else state._hiddenBodies.add(b);
        // Re-render same timeline with same data
        renderTimeline(container, yearlyBodyCountsRaw, opts);
      });
    });
  }

  // ---------- T2: rich hover tooltip ----------
  // Replaces the primitive SVG <title> tooltips with a floating HTML
  // card showing year · total · top 3 contributors. Attached to the
  // container (not the SVG) so it can escape SVG clipping. Uses native
  // mousemove to compute the year under the cursor and pull the
  // top-3 breakdown from the original (non-hidden-filtered) data so
  // numbers match what the user sees in the stack.
  _wireTimelineTooltip(container, {
    years, xStep, pad, W, H,
    stackBy, stackKeys, stackLabels, stackColors,
    yearlyBodyCounts, annualTotals, cumulTotals,
    mode,
    otherBodies: opts._otherBodies || [],
    syncGroup: opts.syncGroup || null,
  });
}

/* Sync registry for linked timelines. Each timeline that opts into a
   syncGroup registers { container, renderAtYear, hide } so sibling
   timelines can drive it remotely. Used by Compare (A ↔ B) so a hover
   on one chart paints the cursor + tooltip on the other at the same
   year. Entries are replaced on re-render (same container key). */
const _tlSyncRegistry = {};

/* Build/position a rich floating tooltip over a timeline SVG + an
   in-chart vertical cursor line. Handles mousemove → year lookup →
   render. Single reusable overlay element per container. Opts into
   cross-chart sync via ctx.syncGroup — sibling timelines in the same
   group mirror the hovered year so Compare A vs B shows both timelines
   highlighted at the same moment. Tag: timeline-tooltip-v2 */
function _wireTimelineTooltip(container, ctx) {
  if (!container) return;
  const svg = container.querySelector('svg');
  if (!svg) return;

  // Re-use existing tooltip div if present (re-render case)
  let tip = container.querySelector('.tl-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tl-tooltip';
    tip.style.display = 'none';
    container.appendChild(tip);
  }

  // C5: in-chart vertical cursor line. Re-created each render because
  // the previous SVG gets replaced; no DOM leak.
  let cursor = svg.querySelector('.tl-cursor');
  if (!cursor) {
    cursor = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    cursor.setAttribute('class', 'tl-cursor');
    cursor.setAttribute('stroke', 'currentColor');
    cursor.setAttribute('stroke-opacity', '0.35');
    cursor.setAttribute('stroke-width', '1');
    cursor.setAttribute('pointer-events', 'none');
    cursor.style.display = 'none';
    svg.appendChild(cursor);
  }

  const { years, xStep, pad, W, H, stackBy, stackKeys, stackLabels, stackColors, yearlyBodyCounts, annualTotals, cumulTotals, mode, syncGroup, otherBodies = [] } = ctx;
  cursor.setAttribute('y1', pad.t);
  cursor.setAttribute('y2', H - pad.b);

  const xToYearIdx = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const innerPct = (relX * W - pad.l) / (W - pad.l - pad.r);
    const i = Math.round(innerPct * (years.length - 1));
    return Math.max(0, Math.min(years.length - 1, i));
  };

  const moveCursor = (yearIdx) => {
    const svgX = pad.l + yearIdx * xStep;
    cursor.setAttribute('x1', svgX);
    cursor.setAttribute('x2', svgX);
    cursor.style.display = 'block';
  };

  const renderTooltip = (yearIdx, clientX, clientY) => {
    const year = years[yearIdx];
    const total = mode === 'cumulative' ? cumulTotals[yearIdx] : annualTotals[yearIdx];

    const yearMap = yearlyBodyCounts[year] || {};
    let breakdownRows = [];
    if (stackBy === 'family') {
      const agg = { upr: 0, treaty: 0, sp: 0, other: 0 };
      Object.entries(yearMap).forEach(([b, c]) => { agg[classifyBody(b)] += c; });
      breakdownRows = stackKeys
        .map(k => ({ key: k, label: stackLabels[k], count: agg[k], color: stackColors[k] }))
        .filter(r => r.count > 0);
    } else {
      // Body mode — top 3 named bodies. If the stack contains an
      // "__other__" aggregate AND at least one of the Other bodies
      // contributed this year, append a dedicated "Other (N)" row so
      // the tooltip covers the same categories the stack shows.
      const namedKeys = new Set(stackKeys.filter(k => k !== '__other__'));
      breakdownRows = Object.entries(yearMap)
        .filter(([b]) => namedKeys.has(b))
        .map(([b, c]) => ({ key: b, label: cleanLabel(b), count: c, color: stackColors[b] || 'var(--dim)' }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      if (stackKeys.includes('__other__') && otherBodies.length) {
        const otherSum = otherBodies.reduce((sum, b) => sum + (yearMap[b] || 0), 0);
        if (otherSum > 0) {
          breakdownRows.push({
            key: '__other__',
            label: `Other (${otherBodies.length} ${otherBodies.length===1?'body':'bodies'})`,
            count: otherSum,
            color: stackColors['__other__'] || 'var(--dim)',
          });
        }
      }
    }

    const rowsHtml = breakdownRows.length
      ? breakdownRows.map(r => `<div class="tl-tt-row"><span class="tl-tt-sw" style="background:${r.color}"></span><span class="tl-tt-lbl">${sanitize(r.label)}</span><span class="tl-tt-n">${fmt(r.count)}</span></div>`).join('')
      : '<div class="tl-tt-row" style="color:var(--dim)">no data this year</div>';

    tip.innerHTML = `
      <div class="tl-tt-head">
        <span class="tl-tt-year">${year}</span>
        <span class="tl-tt-total">${fmt(total)} record${total===1?'':'s'}${mode==='cumulative'?' (cumulative)':''}</span>
      </div>
      ${rowsHtml}`;

    const rect = container.getBoundingClientRect();
    let x = clientX - rect.left + 14;
    let y = clientY - rect.top + 14;
    tip.style.display = 'block';
    const tipRect = tip.getBoundingClientRect();
    if (x + tipRect.width > rect.width - 4) x = clientX - rect.left - tipRect.width - 10;
    if (y + tipRect.height > rect.height - 4) y = clientY - rect.top - tipRect.height - 10;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  };

  /* External sync entry-point: shown on sibling timelines when the user
     hovers this chart's partner. Positions tooltip near cursor at mid-
     chart-height since there's no real mouse event to drive position. */
  const renderAtYear = (yearIdx) => {
    moveCursor(yearIdx);
    const rect = svg.getBoundingClientRect();
    const svgX = pad.l + yearIdx * xStep;
    const clientX = rect.left + (svgX / W) * rect.width;
    const clientY = rect.top + rect.height * 0.35; // upper-third looks nicer than dead-centre
    renderTooltip(yearIdx, clientX, clientY);
  };

  const hide = () => {
    tip.style.display = 'none';
    cursor.style.display = 'none';
  };

  const broadcast = (fn) => {
    if (!syncGroup) return;
    const peers = _tlSyncRegistry[syncGroup] || [];
    peers.forEach(p => { if (p.container !== container) fn(p); });
  };

  svg.onmousemove = (e) => {
    const idx = xToYearIdx(e.clientX);
    moveCursor(idx);
    renderTooltip(idx, e.clientX, e.clientY);
    broadcast(p => p.renderAtYear(idx));
  };
  svg.onmouseleave = () => {
    hide();
    broadcast(p => p.hide());
  };

  // Register in sync group. Also evict any dead entries whose container
  // is no longer in the DOM (happens when renderCompare re-runs and
  // swaps out the whole panel HTML — the old refs become orphan).
  if (syncGroup) {
    if (!_tlSyncRegistry[syncGroup]) _tlSyncRegistry[syncGroup] = [];
    _tlSyncRegistry[syncGroup] = _tlSyncRegistry[syncGroup].filter(p =>
      document.contains(p.container) && p.container !== container
    );
    _tlSyncRegistry[syncGroup].push({ container, renderAtYear, hide });
  }
}

/* Render the family/body stack toggle into a panel-actions slot and wire
   click handlers. Reused by every profile tab that has a FIG.A timeline.
   `hostEl` is the span we reserved in panel-actions; `currentMode` is the
   active stackBy; `onChange` re-renders the timeline with the new mode.
   Uses .onclick (not addEventListener) so repeated wires don't stack. */
function _renderStackToggle(hostEl, currentMode, onChange) {
  if (!hostEl) return;
  hostEl.className = 'tl-stack-toggle';
  hostEl.innerHTML = `
    <button data-mode="family" class="${currentMode==='family'?'on':''}" title="Stack by mechanism family (UPR · Treaty Bodies · Special Procedures)">Family</button>
    <button data-mode="body" class="${currentMode==='body'?'on':''}" title="Stack by individual recommending body (top 6)">By body</button>
  `;
  hostEl.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      const next = btn.dataset.mode;
      if (next !== currentMode) onChange(next);
    };
  });
}
