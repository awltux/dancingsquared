// THE SERVICE WORKER: WHAT MAKES "INSTALL IT AND PLAY OFFLINE" TRUE RATHER THAN ASPIRATIONAL.
//
// WHY IT EXISTS. The game is offline by design (`index.html`'s own note: no font CDN, no analytics, no stylesheet from a
// network) and every asset is bundled, so the only thing missing from an offline build was a cache. That matters more on a
// phone than anywhere else: a dance teacher on a hall's wifi should not lose the app when the signal does.
//
// RUNTIME CACHING, NOT A PRECACHE LIST, and the reason is the build. Vite names its output by content hash, so a static list
// of files here would be stale the moment anything changed — and a stale list that 404s is worse than no cache. Instead:
//   * a NAVIGATION is network-first with the cached shell as the fallback, so a new build is picked up as soon as the server
//     answers and the app still opens when it does not;
//   * everything else same-origin is cache-first, because those URLs are hashed — a cached copy of `index-abc123.js` IS the
//     build that asked for it, so there is nothing to invalidate within a version.
//
// THE VERSION IS THE ONLY HAND-MAINTAINED NUMBER, and it is deliberate: it names the cache, `activate` deletes every other
// `dsq-` cache, and the app's own update path is the browser's (a new worker installs, waits, and takes over on the next
// visit). A build that needs to drop old entries bumps it.
//
// SERVED FROM THE APP'S OWN ORIGIN (`public/sw.js` is copied to the build root by Vite), so its scope is the app and nothing
// else. It makes no cross-origin request, holds no state beyond the cache, and reports nothing anywhere (AGENTS.md §6: the
// apps are offline).

const VERSION = 'dsq-v1';
const SHELL = VERSION;
const SHELL_URL = './index.html';

self.addEventListener('install', () => {
  // TAKE OVER AS SOON AS POSSIBLE: an installed app that keeps running the previous worker would not pick up a fix until
  // the second visit after the update.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // EVERY OTHER VERSION GOES, so a bump cannot leave a player's device holding two shells.
    for (const name of await caches.keys()) {
      if (name.startsWith('dsq-') && name !== SHELL) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL);
        await cache.put(SHELL_URL, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(SHELL_URL);
        // A NAVIGATION THAT CANNOT BE SERVED IS NOT SWALLOWED: the browser's own offline page is more honest than a blank
        // screen, and the app has never asked for a custom one.
        if (cached) return cached;
        throw new Error('offline and no shell cached');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fresh = await fetch(request);
    // ONLY A SUCCESSFUL, SAME-ORIGIN RESPONSE IS KEPT: an opaque or 404 entry would poison the cache for the hashed URL.
    if (fresh.ok) {
      const cache = await caches.open(SHELL);
      await cache.put(request, fresh.clone());
    }
    return fresh;
  })());
});
