/* UHRI v2 Service Worker
 * - Cache-first for app shell (dashboard2.html, manifest, icons, fonts)
 * - Stale-while-revalidate for /api/data/facets, /api/data/map, /api/data/analytics
 * - Network-only for /api/feedback/report, /api/data/full
 */
const SHELL_CACHE  = 'uhri-v2-shell-v1';
const DATA_CACHE   = 'uhri-v2-data-v1';
const FONT_CACHE   = 'uhri-v2-font-v1';

const SHELL_ASSETS = [
  './dashboard2.html',
  './manifest.webmanifest',
  './icon-192.svg',
  './icon-512.svg',
];

const SWR_PATHS = ['/api/data/facets', '/api/data/map', '/api/data/analytics', '/api/data/record/', '/api/data/cache_status', '/api/data/refresh_status'];
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

  // Google Fonts — long cache
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // Never cache — form posts & mega payloads
  if (NETWORK_ONLY.some(p => url.pathname.includes(p))) return;

  // SWR for data endpoints
  if (SWR_PATHS.some(p => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    return;
  }

  // Shell files: cache-first; fallback to network
  if (url.origin === location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
  }
});

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
      const shell = await cache.match('./dashboard2.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || networkPromise;
}

// Allow the page to force-update the cache
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'clearDataCache') caches.delete(DATA_CACHE);
});
