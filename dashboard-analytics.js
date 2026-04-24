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

// Expose for other modules / inline handlers
window.trackView = trackView;
window.trackEvent = trackEvent;

/* The first-visit onboarding tour (dashboard.html) puts up a full-
   viewport backdrop with z-index:240 that intercepts all pointer
   events — including clicks on our consent banner.  Rather than
   racing it with a higher z-index (confusing UX: banner floating
   over tour content), we wait until the tour is dismissed and then
   show the banner.  Also handles the case where the tour never runs
   (returning dashboard users, landing page) by resolving immediately. */
function _waitForTourDismissal() {
  return new Promise(resolve => {
    const check = () => !document.querySelector('.tour-backdrop');
    if (check()) return resolve();
    const interval = setInterval(() => {
      if (check()) { clearInterval(interval); resolve(); }
    }, 400);
    // Safety: give up after 2 min — don't leave the banner indefinitely
    // suspended if something weird happens with the tour.
    setTimeout(() => { clearInterval(interval); resolve(); }, 120_000);
  });
}

/* Consent banner — inserted at end of <body> when neither acceptance
   nor rejection has been recorded.  Two plain buttons.  Dismissed with
   Esc.  No tracking pixel, no fingerprinting, no third-party calls
   until after user clicks Accept. */
async function _insertGaConsentBanner() {
  if (_gaDoNotTrack()) return;           // DNT respected — don't even ask
  if (_gaConsentState() !== null) return; // already answered
  await _waitForTourDismissal();          // don't collide with onboarding
  if (_gaConsentState() !== null) return; // user may have decided in the meantime

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

  const close = () => host.remove();
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
