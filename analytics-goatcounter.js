/* GoatCounter — a cookieless, open-source page counter (https://www.goatcounter.com).
 *
 * Counts HOW MANY people visit and WHICH tab of the dashboard they open. It is
 * deliberately separate from Google Analytics (dashboard-analytics.js), which
 * is consent-gated and measures feature use: this one answers only "is anyone
 * using it, and from where", on every public page.
 *
 * WHAT LEAVES THE BROWSER, per view: a fixed path and title — "/dashboard/country",
 * never which country; "/dashboard/search", never what was searched — plus the
 * referring site on the first view. The script is told the path explicitly and
 * never reads the URL itself: the dashboard keeps queries, filters and the
 * record being read in the URL hash, and none of that may reach a third party.
 *
 * WHEN IT RUNS: only on the production host, so a local copy, a fork, or a test
 * run never contacts GoatCounter; and not at all when the browser sends
 * Do-Not-Track, the same rule the GA bootstrap follows. An ad-blocker that
 * blocks gc.zgo.at simply turns this into a no-op.
 *
 * USAGE: <script src="./analytics-goatcounter.js" data-path="/landing"></script>
 * counts that page once on load. The dashboard omits data-path and calls
 * window.uhriCount(path, title) from navigate() instead — it is one document,
 * so a pageview per tab has to be reported by hand.
 */
(function () {
  'use strict';
  var PRODUCTION_HOST = 'lszoszk.github.io';
  var ENDPOINT = 'https://lszoszk.goatcounter.com/count';
  var SCRIPT = 'https://gc.zgo.at/count.js';

  var script = document.currentScript;
  var noop = function () {};
  window.uhriCount = noop;

  if (location.hostname !== PRODUCTION_HOST) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  // no_onload: never count from the URL. no_events: don't bind data-goatcounter-click.
  window.goatcounter = { endpoint: ENDPOINT, no_onload: true, no_events: true };

  var queue = [], ready = false, first = true, last = null;

  window.uhriCount = function (path, title) {
    if (!path || path === last) return;          // re-rendering the same view is not a new pageview
    last = path;
    var vars = { path: path, title: title || path };
    // Only the first view has a real referrer. Later ones are in-app hops; passing
    // '' stops GoatCounter filling in document.referrer on every tab switch.
    if (!first) vars.referrer = '';
    first = false;
    if (ready) window.goatcounter.count(vars); else queue.push(vars);
  };

  var s = document.createElement('script');
  s.async = true;
  s.src = SCRIPT;
  s.onload = function () {
    ready = true;
    queue.splice(0).forEach(function (v) { window.goatcounter.count(v); });
  };
  s.onerror = function () { queue.length = 0; window.uhriCount = noop; };   // blocked: stay silent
  document.head.appendChild(s);

  if (script && script.getAttribute('data-path')) {
    window.uhriCount(script.getAttribute('data-path'), document.title);
  }
})();
