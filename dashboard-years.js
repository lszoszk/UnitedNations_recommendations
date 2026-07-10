/* UHRI Dashboard — year slider + histogram
 *
 * Extracted from dashboard.html as a self-contained seam. Owns the left-rail
 * year-range control, including the histogram background, draggable handles,
 * and the public sync hooks used by route restore, clear-all, and timeline.
 */

/* ---------- YEAR SLIDER (with histogram, #4) ----------
   Background bars show record volume per year so users see where the
   dataset is dense. Bars recolour to accent when inside the selected
   range, fade to dim outside. Data comes from analytics.trends.yearly_counts
   (updated via _syncYearHistogram when fresh analytics arrive). */
function _renderYearHistogram(minY, maxY) {
  const host = $('#ysHist');
  if (!host) return;
  const yc = state.analytics?.trends?.yearly_counts || [];
  const byYear = {};
  yc.forEach(o => { byYear[o.year] = o.count; });
  const years = [];
  for (let y = minY; y <= maxY; y++) years.push(y);
  const max = Math.max(1, ...years.map(y => byYear[y] || 0));
  host.innerHTML = years.map(y => {
    const v = byYear[y] || 0;
    const h = Math.max(3, Math.round((v / max) * 36));
    const inRange = y >= state.filters.yearA && y <= state.filters.yearB;
    return `<span class="ys-hist-bar ${inRange ? 'in-range' : ''}" style="height:${h}px" title="${y}: ${fmt(v)} recs" data-y="${y}"></span>`;
  }).join('');
}

let _yearSliderAbort = null;

function bindYearSlider(minY, maxY) {
  if (_yearSliderAbort) _yearSliderAbort.abort();
  _yearSliderAbort = new AbortController();
  const listenerOpts = { signal: _yearSliderAbort.signal };
  const slider = $('#yearSlider'), fill = $('#ysFill');
  const A = $('#ysA'), B = $('#ysB');
  let dragging = null;
  const yrToPct = y => ((y - minY) / (maxY - minY)) * 100;
  function update() {
    const pA = yrToPct(state.filters.yearA), pB = yrToPct(state.filters.yearB);
    A.style.left = pA + '%'; B.style.left = pB + '%';
    fill.style.left = pA + '%'; fill.style.width = (pB - pA) + '%';
    $('#yrAL').textContent = state.filters.yearA;
    $('#yrBL').textContent = state.filters.yearB;
    A.setAttribute('aria-valuenow', state.filters.yearA);
    A.setAttribute('aria-valuetext', state.filters.yearA + ' (start year)');
    B.setAttribute('aria-valuenow', state.filters.yearB);
    B.setAttribute('aria-valuetext', state.filters.yearB + ' (end year)');
    $$('#ysHist .ys-hist-bar').forEach(b => {
      const y = Number(b.dataset.y);
      b.classList.toggle('in-range', y >= state.filters.yearA && y <= state.filters.yearB);
    });
  }
  window._syncYearSlider = update;
  window._syncYearHistogram = () => _renderYearHistogram(minY, maxY);
  _renderYearHistogram(minY, maxY);
  update();
  function onDown(e) { dragging = e.target.dataset.which; e.preventDefault(); }
  function onMove(e) {
    if (!dragging) return;
    const r = slider.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - r.left;
    const p = Math.max(0, Math.min(1, x / r.width));
    const yr = minY + Math.round(p * (maxY - minY));
    if (dragging === 'a') state.filters.yearA = Math.min(yr, state.filters.yearB);
    else state.filters.yearB = Math.max(yr, state.filters.yearA);
    update();
  }
  function onUp() { if (dragging) { dragging = null; onFiltersChanged(); } }
  A.addEventListener('mousedown', onDown, listenerOpts); B.addEventListener('mousedown', onDown, listenerOpts);
  A.addEventListener('touchstart', onDown, listenerOpts); B.addEventListener('touchstart', onDown, listenerOpts);
  document.addEventListener('mousemove', onMove, listenerOpts); document.addEventListener('mouseup', onUp, listenerOpts);
  document.addEventListener('touchmove', onMove, listenerOpts); document.addEventListener('touchend', onUp, listenerOpts);

  // Keyboard parity — handles are real sliders: arrows ±1yr, PgUp/PgDn ±5,
  // Home/End jump to the range edge. The global :focus-visible ring makes the
  // focused handle visible against the track.
  [[A, 'a', 'Start year'], [B, 'b', 'End year']].forEach(([h, which, label]) => {
    h.setAttribute('role', 'slider');
    h.setAttribute('tabindex', '0');
    h.setAttribute('aria-label', label);
    h.setAttribute('aria-valuemin', minY);
    h.setAttribute('aria-valuemax', maxY);
    h.addEventListener('keydown', (e) => {
      let d = 0;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -1;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = 1;
      else if (e.key === 'PageDown') d = -5;
      else if (e.key === 'PageUp') d = 5;
      else if (e.key === 'Home') d = which === 'a' ? (minY - state.filters.yearA) : (state.filters.yearA - state.filters.yearB);
      else if (e.key === 'End') d = which === 'a' ? (state.filters.yearB - state.filters.yearA) : (maxY - state.filters.yearB);
      else return;
      e.preventDefault();
      if (which === 'a') state.filters.yearA = Math.max(minY, Math.min(state.filters.yearA + d, state.filters.yearB));
      else state.filters.yearB = Math.min(maxY, Math.max(state.filters.yearB + d, state.filters.yearA));
      update();
      onFiltersChanged();
    }, listenerOpts);
  });
  update();
}
