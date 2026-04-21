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

function bindYearSlider(minY, maxY) {
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
  A.addEventListener('mousedown', onDown); B.addEventListener('mousedown', onDown);
  A.addEventListener('touchstart', onDown); B.addEventListener('touchstart', onDown);
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove); document.addEventListener('touchend', onUp);
}
