// Service worker: makes the app reload-safe when the network is down.
// Strategy: cache every successfully-fetched same-origin GET response as the app
// loads, then serve from cache when offline. Bump CACHE_NAME on app updates.
const CACHE_NAME = 'ds-teacher-v1';

self.addEventListener('install', (event) => {
  // Take control as soon as possible so the new cache is used right away.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(['./', './index.html']).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  // Remove old caches and take control of open pages.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // don't cache cross-origin (e.g. APIs)

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        // Network-first: fetch fresh, and put it in the cache for later offline use.
        const resp = await fetch(req);
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch {
        // Offline: fall back to the cached copy.
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    }),
  );
});
