/* UHRI v2 Service Worker
 * - Cache-first for app shell (dashboard.html, manifest, icons, fonts)
 * - Stale-while-revalidate for /api/data/facets, /api/data/map, /api/data/analytics,
 *   /api/data/records (Tier 4a — filter-change instant on repeat visits)
 * - Network-only for /api/feedback/report, /api/data/full
 */
const SHELL_CACHE  = 'uhri-v2-shell-v40';  // bump to invalidate stale caches on ship
const DATA_CACHE   = 'uhri-v2-data-v6';    // moot under cross-origin pass-through
const FONT_CACHE   = 'uhri-v2-font-v2';

/* Path rename 2026-04-21: dashboard2.html → dashboard.html, index2.html →
   index.html. Old SW had dashboard2.html in SHELL_ASSETS which 404s after
   the rename — addAll() rejects the whole install, old SW stays active,
   and its stale fetch handler served cached cross-origin data instead of
   network. Bumping SHELL_CACHE + fixing the list forces reinstall with
   the corrected paths. */
const SHELL_ASSETS = [
  './dashboard.html',
  './index.html',
  './manifest.webmanifest',
  './icon-192.svg',
  './icon-512.svg',
];

const SWR_PATHS = ['/api/data/facets', '/api/data/map', '/api/data/analytics', '/api/data/records', '/api/data/record/', '/api/data/cache_status', '/api/data/refresh_status'];
const NETWORK_ONLY = ['/api/feedback/report', '/api/data/full', '/api/data/export'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![SHELL_CACHE, DATA_CACHE, FONT_CACHE].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts — long cache (same-origin-ish via preconnect, stable)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // CROSS-ORIGIN PASS-THROUGH: anything not on our own origin — including
  // the VM API at 150.254.115.204 — we DO NOT intercept. Safari 26's SW
  // has a regression where cross-origin HTTP/2 + gzip responses sometimes
  // surface to respondWith() as "TypeError: Load failed" even though the
  // network succeeded (server access log shows 200). Skipping respondWith
  // lets the browser handle these natively, which bypasses the bug and
  // still gets nginx-level gzip + Cache-Control + our Tier-2 precompute.
  if (url.origin !== location.origin) return;

  // Never cache — form posts & mega payloads (same-origin only now)
  if (NETWORK_ONLY.some(p => url.pathname.includes(p))) return;

  // SWR for data endpoints (same-origin only — unused today because VM is
  // cross-origin, but kept for any future same-origin proxied setup)
  if (SWR_PATHS.some(p => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    return;
  }

  // Navigation requests (HTML) → NETWORK-FIRST so users always get fresh
  // dashboard code; fall back to cache if offline.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // Other same-origin static assets (icons, manifest) → cache-first
  event.respondWith(cacheFirst(req, SHELL_CACHE));
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw new Error('offline and no cache');
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    // Graceful offline shell: return a minimal HTML if the dashboard is requested
    if (req.mode === 'navigate') {
      const shell = await cache.match('./dashboard.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  // Kick off the background refresh. If it rejects we deliberately do
  // nothing — the caller either got a cached hit or will let the original
  // fetch error bubble up through respondWith.
  const networkPromise = fetch(req).then(res => {
    // Only cache healthy 2xx responses.
    // We keep clone+put in a separate promise chain with its own catch so
    // a cache.put failure (e.g. Safari quirks around cloned HTTP/2 gzip
    // responses) can never poison the Response we hand back to the page.
    if (res && res.ok) {
      try {
        const copy = res.clone();
        cache.put(req, copy).catch(() => {});
      } catch (_) { /* clone unavailable — serve network result as-is */ }
    }
    return res;
  });
  // If we already had a cache entry, serve it immediately and let the
  // network refresh happen in the background. Never return null/undefined.
  if (cached) return cached;
  return networkPromise;
}

// Allow the page to force-update the cache
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'clearDataCache') caches.delete(DATA_CACHE);
});
