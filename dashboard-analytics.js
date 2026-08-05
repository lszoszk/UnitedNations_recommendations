/* UHRI Dashboard — analytics (Google Analytics 4, consent-gated)
 *
 * Privacy-aware tracking: loaded only when user opts in via the banner
 * below (Consent Mode v2 default-denied), or skipped entirely when the
 * browser's Do-Not-Track header is set.  We track high-level navigation
 * and a handful of discrete actions — NOT search query strings, record
 * IDs, or anything that could identify what a specific user is
 * researching.  Matters for a human-rights tool whose audience includes
 * people in repressive regimes.
 *
 * What is tracked (anonymous, aggregated):
 *   - SPA page_view on each navigate(view) — view name only
 *   - dataset_toggle (cleaned ↔ raw)
 *   - instant_mode_enabled / instant_mode_disabled
 *   - upload_initiated, export_initiated (with export format)
 *
 * What is NOT tracked:
 *   - Any text the user typed (kw query, saved notes, rule names)
 *   - Specific records opened in the reader
 *   - User identity, IP in clear (GA4 anonymises IP by default + we
 *     disable ad personalisation + Google signals)
 *
 * How the consent flow works:
 *   - <head> inline script (in dashboard.html / index.html) sets the
 *     Consent Mode v2 default to "denied" AND conditionally appends the
 *     gtag.js script tag if DNT is not "1".  gtag.js loads but sends
 *     nothing until consent is granted.
 *   - This module decides whether to show the banner: hidden if the
 *     user previously accepted or rejected; visible otherwise.
 *   - On accept: writes localStorage + calls gtag('consent','update',...)
 *     which releases the queued initial page_view plus any events.
 *   - On reject: writes localStorage; gtag stays muted, banner hides. */

const _GA_CONSENT_KEY = 'uhri-ga-consent';

function _gaConsentState() {
  try { return localStorage.getItem(_GA_CONSENT_KEY); }
  catch { return null; }
}

function _gaConsentIsGranted() {
  return _gaConsentState() === 'granted';
}

function _gaDoNotTrack() {
  return navigator.doNotTrack === '1' || window.doNotTrack === '1';
}

/* Map an internal view key to (human title, path segment) for GA4.
   The title is what researchers will see in Reports → Pages & screens;
   putting the surface context in front makes it possible to tell at a
   glance whether a page_view came from the landing or from the
   dashboard, and which tab of the dashboard.  Order matters in the
   title — "UHRI Dashboard" first so the Pages & screens list groups
   dashboard entries together alphabetically. */
const _VIEW_LABELS = {
  landing:     { title: 'UHRI — Landing',                    path: '/landing' },
  overview:    { title: 'UHRI Dashboard — Overview',         path: '/dashboard/overview' },
  country:     { title: 'UHRI Dashboard — Country profile',  path: '/dashboard/country' },
  compare:     { title: 'UHRI Dashboard — Compare A vs B',   path: '/dashboard/compare' },
  group:       { title: 'UHRI Dashboard — Concerned group',  path: '/dashboard/group' },
  theme:       { title: 'UHRI Dashboard — Theme profile',    path: '/dashboard/theme' },
  sdg:         { title: 'UHRI Dashboard — SDG profile',      path: '/dashboard/sdg' },
  mechanism:   { title: 'UHRI Dashboard — Mechanism profile',path: '/dashboard/mechanism' },
  search:      { title: 'UHRI Dashboard — Search',           path: '/dashboard/search' },
  bookmarks:   { title: 'UHRI Dashboard — Bookmarks',        path: '/dashboard/bookmarks' },
  labels:      { title: 'UHRI Dashboard — Labels workspace', path: '/dashboard/labels' },
  methodology: { title: 'UHRI Dashboard — Methodology',      path: '/dashboard/methodology' },
  about:       { title: 'UHRI Dashboard — About',            path: '/dashboard/about' },
};

function _viewLabel(viewName) {
  const v = String(viewName || '').toLowerCase();
  return _VIEW_LABELS[v] || {
    title: 'UHRI Dashboard — ' + (viewName || 'unknown'),
    path:  '/dashboard/' + (viewName || 'unknown'),
  };
}

/* Public API — view + event tracking.  No-ops if consent isn't granted
   or gtag failed to load (DNT, network block, etc.).  Callers never
   need to check consent themselves; just call trackView / trackEvent
   freely. */
function trackView(viewName) {
  if (!_gaConsentIsGranted() || typeof window.gtag !== 'function') return;
  try {
    const label = _viewLabel(viewName);
    window.gtag('event', 'page_view', {
      page_title: label.title,
      page_path: label.path,
    });
  } catch (_) { /* never let analytics break the app */ }
}

function trackEvent(name, params = {}) {
  if (!_gaConsentIsGranted() || typeof window.gtag !== 'function') return;
  try {
    window.gtag('event', String(name), params);
  } catch (_) { /* never let analytics break the app */ }
}

/* Keyword search tracking — metadata only, content never sent.
   Emits a `search_performed` event with five derived properties that
   describe HOW the user searches, not WHAT they searched for:
     query_word_count   — bucketed: 1 | 2 | '3-5' | '6+'
     has_boolean        — true if AND / OR / NOT operator present
     has_wildcard       — true if trailing-* used
     has_quotes         — true if phrase-quoted segment present
     result_count_bucket — 0 | '1-10' | '11-100' | '101-1k' | '1k-10k' | '10k+'
   The raw query string is accepted as an argument but deliberately
   never written to any gtag call.  See About → Privacy for the
   user-facing description of what this tracks + why. */
function _bucketCount(n) {
  const v = Number(n) || 0;
  if (v === 0) return '0';
  if (v <= 10) return '1-10';
  if (v <= 100) return '11-100';
  if (v <= 1000) return '101-1k';
  if (v <= 10000) return '1k-10k';
  return '10k+';
}
function _bucketWords(wc) {
  if (wc <= 1) return '1';
  if (wc === 2) return '2';
  if (wc <= 5) return '3-5';
  return '6+';
}

function trackSearch(rawQuery, totalRecords) {
  if (!_gaConsentIsGranted() || typeof window.gtag !== 'function') return;
  const q = String(rawQuery || '').trim();
  if (!q) return;  // empty searches (user browsing via rail) don't count
  try {
    // Strip boolean operators/parens/quotes before counting words so the
    // bucket reflects the user's topic count, not their syntax overhead.
    const words = q
      .replace(/"[^"]*"/g, 'PHRASE')         // treat quoted phrase as one token
      .replace(/[()]/g, ' ')                 // strip parens
      .replace(/\b(AND|OR|NOT)\b/g, ' ')     // strip boolean operators
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    window.gtag('event', 'search_performed', {
      query_word_count:     _bucketWords(words.length),
      has_boolean:          /\b(AND|OR|NOT)\b/.test(q),
      has_wildcard:         q.includes('*'),
      has_quotes:           /["']/.test(q),
      result_count_bucket:  _bucketCount(totalRecords),
    });
  } catch (_) { /* never let analytics break the app */ }
}

/* Core Web Vitals — Real-User Monitoring (RUM).
 *
 * Web-vitals.js (loaded inline in dashboard.html) measures LCP, INP,
 * CLS, FCP, TTFB and calls trackWebVital() once per metric per page-
 * load.  We report:
 *   - metric_name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'
 *   - metric_rating: 'good' | 'needs-improvement' | 'poor' (per web.dev
 *     thresholds; same buckets the Chrome UX Report uses)
 *   - metric_value_bucket: rough numeric bucket so we get distribution
 *     data without flooding GA with high-cardinality continuous values
 *   - view: which SPA view was active when the metric fired
 *
 * The raw numeric value is intentionally NOT sent — GA cardinality
 * limits would shred a continuous timing dimension, and the bucket +
 * rating combination is sufficient to track p75 trends per web.dev's
 * own guidance. */
function _bucketLcp(ms)  { return ms < 2500 ? '<2.5s' : ms < 4000 ? '2.5-4s' : '>4s'; }
function _bucketInp(ms)  { return ms < 200  ? '<200ms' : ms < 500 ? '200-500ms' : '>500ms'; }
function _bucketCls(val) { return val < 0.1 ? '<0.1'  : val < 0.25 ? '0.1-0.25' : '>0.25'; }
function _bucketFcp(ms)  { return ms < 1800 ? '<1.8s' : ms < 3000 ? '1.8-3s' : '>3s'; }
function _bucketTtfb(ms) { return ms < 800  ? '<800ms' : ms < 1800 ? '800-1800ms' : '>1800ms'; }

function _bucketWebVital(name, value) {
  switch (name) {
    case 'LCP':  return _bucketLcp(value);
    case 'INP':  return _bucketInp(value);
    case 'CLS':  return _bucketCls(value);
    case 'FCP':  return _bucketFcp(value);
    case 'TTFB': return _bucketTtfb(value);
    default:     return 'unknown';
  }
}

/* Web-vitals.js library passes a Metric object: { name, value, rating,
 * id, navigationType, ... }.  We accept the whole object and pull the
 * fields we want.  Defensive on missing fields so an older library
 * version doesn't crash analytics (it would still surface useful data
 * via the bucket logic). */
function trackWebVital(metric) {
  if (!_gaConsentIsGranted() || typeof window.gtag !== 'function') return;
  if (!metric || typeof metric !== 'object' || !metric.name) return;
  try {
    const name = String(metric.name);
    const value = Number(metric.value) || 0;
    window.gtag('event', 'web_vital', {
      metric_name:    name,
      metric_rating:  metric.rating || 'unknown',
      metric_bucket:  _bucketWebVital(name, value),
      metric_id:      metric.id ? String(metric.id).slice(0, 64) : '',
      navigation_type: metric.navigationType || 'unknown',
      view: (typeof state !== 'undefined' && state?.view) || 'unknown',
    });
  } catch (_) { /* never let analytics break the app */ }
}

// Expose for other modules / inline handlers
window.trackView = trackView;
window.trackEvent = trackEvent;
window.trackWebVital = trackWebVital;
window.trackSearch = trackSearch;

/* Consent banner — inserted at end of <body> when neither acceptance
   nor rejection has been recorded.  Two plain buttons.  Dismissed with
   Esc.  No tracking pixel, no fingerprinting, no third-party calls
   until after user clicks Accept.
   Sequencing (declutter 2026-07): the banner goes FIRST — it's the
   blocking decision — and the first-visit tour (dashboard-ui.js
   maybeShowTour) waits for it to be answered before offering its
   invite chip. The old order (tour first, banner polling for the tour
   backdrop) raced the tour's 900 ms start delay and routinely stacked
   both overlays on the first paint. */
async function _insertGaConsentBanner() {
  if (_gaDoNotTrack()) return;           // DNT respected — don't even ask
  if (_gaConsentState() !== null) return; // already answered

  const host = document.createElement('div');
  host.id = 'gaConsent';
  host.className = 'ga-consent';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'Privacy choice');
  host.innerHTML = `
    <div class="ga-consent-body">
      <div class="ga-consent-text">
        We'd like to use <strong>Google Analytics</strong> to see which features get used —
        page views and a few discrete actions only.  <strong>Your search queries, the
        specific records you open, and your IP address in clear are never sent.</strong>
        <a href="#view=about" data-nav="about" class="ga-consent-more">Privacy details</a>
      </div>
      <div class="ga-consent-actions">
        <button id="gaReject" class="ghost" type="button">Reject</button>
        <button id="gaAccept" class="primary" type="button">Allow anonymous analytics</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  /* The banner is bottom-anchored and so is the bug-report button, and the
     banner is wider AND later in the DOM at the same z-index — so until the
     visitor answers, it covered the button completely: 44x44 of 44x44 at
     1280px, 48x48 of 48x48 at 375px, with elementFromPoint at the button's
     centre returning the banner both times. A first-time visitor on any
     viewport could not report a bug, which is exactly who most needs to.
     Publish how much room the banner takes so the button can step above it
     (see .bug-report-fab). Measured, not hard-coded: the text reflows, so
     the height changes with width and with the font swap. */
  const syncConsentInset = () => {
    const top = host.getBoundingClientRect().top;
    document.body.style.setProperty('--ga-consent-inset', Math.max(0, Math.round(window.innerHeight - top)) + 'px');
  };
  syncConsentInset();
  document.body.classList.add('ga-consent-open');
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(syncConsentInset) : null;
  ro?.observe(host);
  window.addEventListener('resize', syncConsentInset);

  const close = () => {
    ro?.disconnect();
    window.removeEventListener('resize', syncConsentInset);
    document.body.classList.remove('ga-consent-open');
    document.body.style.removeProperty('--ga-consent-inset');
    host.remove();
  };
  host.querySelector('#gaAccept').addEventListener('click', () => {
    try { localStorage.setItem(_GA_CONSENT_KEY, 'granted'); } catch (_) {}
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        analytics_storage: 'granted',
      });
      // GA config used send_page_view:false, so fire the first view
      // manually once consent flips.
      trackView(_gaInitialViewName());
    }
    close();
  });
  host.querySelector('#gaReject').addEventListener('click', () => {
    try { localStorage.setItem(_GA_CONSENT_KEY, 'denied'); } catch (_) {}
    close();
  });
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape' && document.body.contains(host)) {
      document.removeEventListener('keydown', escClose);
      close();
    }
  });
}

/* What view are we on right now?  Different answers on each surface:
     dashboard.html  — state.view if the SPA has booted, else 'overview'
     index.html      — 'landing' (no SPA; one-pager)
   The SPA navigate() dispatcher is expected to call trackView() on
   every view change; this function only produces the very first label. */
function _gaInitialViewName() {
  if (typeof window.state?.view === 'string') return window.state.view;
  // Landing page heuristic — no SPA state.  dashboard.html has #hexSvg on
  // landing + #app on dashboard; use the presence of #app to distinguish.
  return document.getElementById('app') ? 'overview' : 'landing';
}

/* Initialise on DOMContentLoaded (or immediately if already parsed).
   Intentionally lazy — delays the banner a beat so the initial paint
   isn't competing with it.  Previously-consented users skip the banner
   and get their first page_view fired automatically. */
(function _initGaConsent() {
  const run = () => {
    if (_gaConsentIsGranted() && typeof window.gtag === 'function') {
      try {
        window.gtag('consent', 'update', { analytics_storage: 'granted' });
        // GA config used send_page_view:false, so fire one manually for
        // the initial landing view.  Subsequent SPA navigations are
        // tracked by the navigate() hook.
        trackView(_gaInitialViewName());
      } catch (_) {}
    }
    // Show banner 600ms after first paint if undecided.
    if (_gaConsentState() === null && !_gaDoNotTrack()) {
      setTimeout(_insertGaConsentBanner, 600);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
