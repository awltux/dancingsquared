// The stand-alone web app and SEO pieces of the site: icons, manifest, service worker, sitemap,
// robots and the offline page.
//
// ICONS ARE DRAWN, NOT SHIPPED AS ARTWORK. The motif is a squared set -- eight dancers in four
// couple colours -- rendered by the same rasteriser that draws the animations, so the app icon is
// made from the same vocabulary as everything else and cannot be a stale copy of a logo.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, PALETTE, writePng } from './raster.mjs';
import { escapeXml } from './escape.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * THE NAV BAR'S ICONS ARE FILES, and the bar inlines them.
 *
 * They were markup written into the button functions, which meant a page describing the bar had to
 * draw its own approximations of them -- a house glyph and a return glyph that were not the bar's
 * house and return. Reading them from `book/icons/nav-*.svg` gives one source: the button inlines the
 * file, and a page can reference the same file as an image, so the picture in the prose is the picture
 * in the bar and cannot drift from it.
 *
 * `currentColor` is deliberate: inlined in the bar these take the button's colour, and the files carry
 * no colour of their own. Served as an `<img>` they fall back to the page's text colour, which is what
 * a figure in the prose wants anyway.
 */
const ICON_CACHE = new Map();
export function navIcon(name) {
  if (!ICON_CACHE.has(name)) {
    const svg = readFileSync(join(HERE, '..', '..', 'icons', `nav-${name}.svg`), 'utf8').trim();
    if (!svg.startsWith('<svg')) throw new Error(`book/icons/nav-${name}.svg does not start with <svg`);
    ICON_CACHE.set(name, svg);
  }
  return ICON_CACHE.get(name);
}

const ACCENT = 8; // #1f6f8b in the shared palette, so the icon and the book agree on the colour
const FLOOR = 0;
const INK = 10;
const WHITE = 11;

/** The home squared set: [x, y, couple]. */
const HOME = [
  [1, 3, 3],
  [-1, 3, 3],
  [3, -1, 2],
  [3, 1, 2],
  [-1, -3, 1],
  [1, -3, 1],
  [-3, 1, 4],
  [-3, -1, 4],
];

/**
 * A squared set on the book's accent colour.
 *
 * `maskable` keeps the motif inside the central 80% that Android may crop to, and fills the whole
 * square with the background colour so a circular crop still looks deliberate.
 */
export function iconCanvas(size, { maskable = false } = {}) {
  const canvas = new Canvas(size, size, ACCENT);
  const inset = maskable ? size * 0.2 : size * 0.13;
  const panel = size - inset * 2;
  canvas.fillRect(inset, inset, panel, panel, FLOOR);

  const centre = size / 2;
  const half = panel / 2;
  const scale = (half * 0.74) / 3;
  const r = Math.max(2, size * 0.058);

  // A faint grid, so the icon reads as a dance floor rather than a diagram.
  for (const i of [-1, 1]) {
    canvas.strokeLine(centre + i * scale, inset + 2, centre + i * scale, size - inset - 2, 1, 1);
    canvas.strokeLine(inset + 2, centre + i * scale, size - inset - 2, centre + i * scale, 1, 1);
  }

  for (const [x, y, couple] of HOME) {
    canvas.fillCircle(centre + x * scale, centre - y * scale, r, 3 + couple);
  }
  // A right-hand star in the middle: the one shape every square dancer recognises.
  canvas.strokeCircle(centre, centre, r * 1.15, Math.max(1.5, size * 0.016), INK);
  canvas.fillCircle(centre, centre, r * 0.42, WHITE);
  return canvas;
}

export function iconPng(size, opts) {
  return writePng(iconCanvas(size, opts), PALETTE);
}

/**
 * The social-sharing card: 1200x630, the size every platform crops to.
 *
 * It carries the same squared set as the icon and no text, because the rasteriser has no text
 * engine beyond the digits 1-8 -- inventing a font to put a title on it would be a worse trade than
 * a clean, recognisable motif.
 */
export function ogImagePng() {
  const w = 1200;
  const h = 630;
  const canvas = new Canvas(w, h, ACCENT);
  const inset = 42;
  canvas.fillRect(inset, inset, w - inset * 2, h - inset * 2, FLOOR);

  const cx = w / 2;
  const cy = h / 2;
  const scale = (h / 2 - 92) / 3;
  const r = 26;
  for (const [x, y, couple] of HOME) {
    canvas.fillCircle(cx + x * scale, cy - y * scale, r, 3 + couple);
  }
  canvas.strokeCircle(cx, cy, r * 1.1, 5, INK);
  canvas.fillCircle(cx, cy, r * 0.4, WHITE);
  return writePng(canvas, PALETTE);
}

/** A vector version of the icon, for the browser tab and anywhere a scalable mark is wanted. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 10 10" width="64" height="64" role="img">
<title>Dancing Squared</title>
<rect x="-5" y="-5" width="10" height="10" fill="#1f6f8b"/>
<rect x="-3.7" y="-3.7" width="7.4" height="7.4" fill="#f7f9fa"/>
<circle cx="1" cy="-3" r="0.58" fill="#1b7837"/><circle cx="-1" cy="-3" r="0.58" fill="#1b7837"/>
<circle cx="3" cy="1" r="0.58" fill="#2166ac"/><circle cx="3" cy="-1" r="0.58" fill="#2166ac"/>
<circle cx="-1" cy="3" r="0.58" fill="#b2182b"/><circle cx="1" cy="3" r="0.58" fill="#b2182b"/>
<circle cx="-3" cy="-1" r="0.58" fill="#8c6d1f"/><circle cx="-3" cy="1" r="0.58" fill="#8c6d1f"/>
<circle cx="0" cy="0" r="0.68" fill="none" stroke="#22303a" stroke-width="0.16"/>
</svg>
`;

/**
 * Where the Home button goes: the root of whatever host the book is served from.
 *
 * HOST-AGNOSTIC ON PURPOSE. A root-relative path carries no domain, so the same build is correct
 * on util.awltux.trade, on a staging host, and on a laptop's `serve:book` address -- and it is one
 * less thing that has to be changed when the book moves. The book is published in a subdirectory
 * (`dancingsquared_book/`), which is what makes `/index.html` the HOST's home page rather than the
 * book's own contents page: on util.awltux.trade that is the Awltux Utilities hub, which lists this
 * book among the other tools. The button says so, because a reader deep in a call page cannot guess
 * that a house glyph leaves the book.
 *
 * IT IS NOT THE BOOK'S FRONT DOOR, and nothing should treat it as one: the book's own first page is
 * `/dancingsquared_book/index.html`, which is what the installed app opens and what the resume logic
 * redirects from. The back-trail reads the book's directory from the CONTENTS link instead.
 *
 * THE ONE PLACE THIS DOES NOT RESOLVE is a browser opening the built HTML straight from disk: under
 * `file:` a root-relative path means the filesystem root, and a local `serve:book` has no hub at all,
 * so there the button lands on the book's own front page. The site is meant to be served, and the
 * README says so, but this is the button that would break if it were not.
 */
export const HOME_URL = '/index.html';

/** The Home button, as it appears at the top left of every page. The glyph is decorative, so the
 *  accessible name has to come from `aria-label`; without it a screen reader hears only "link". */
export function homeButton() {
  return (
    `<a class="home" href="${HOME_URL}" aria-label="Awltux Utilities" ` +
    'title="Awltux Utilities — the other tools on this site">' +
    navIcon('home') +
    '</a>'
  );
}

export function manifestJson({ name, shortName, description, base, theme = '#1f6f8b' }) {
  return JSON.stringify(
    {
      name,
      short_name: shortName,
      description,
      start_url: './index.html',
      scope: './',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      orientation: 'any',
      background_color: '#f5f8f9',
      theme_color: theme,
      lang: 'en',
      dir: 'ltr',
      categories: ['education', 'sports', 'reference'],
      icons: [
        { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: './icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: './icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      id: `${base || './'}`,
    },
    null,
    2,
  );
}

/**
 * The service worker: it READS a complete copy of the book and writes nothing at all.
 *
 * WHY IT WRITES NOTHING. It used to precache a shell and cache everything else as it was seen. Both
 * halves of that caused the same complaint: a reader updating from one edition to the next read a
 * MIXTURE, because pages were served network-first while figures, the stylesheet and the engine were
 * served cache-first, and the figures were only ever cached when a reader happened to open the page
 * that showed them. The deploy was fine; the browser was assembling the book in stages and a reader
 * could see the seams.
 *
 * So the store is now written in exactly one place -- `assets/offline.js`, on the reader's own
 * instruction -- and this worker only serves it. Three rules follow from that, and each is load
 * bearing:
 *
 *   1. A STORE IS USABLE ONLY IF IT IS COMPLETE. A download writes a marker file last, and only a
 *      store holding that marker is served. An interrupted download is therefore invisible: the
 *      reader keeps the edition they had. This is what makes the copy all-or-nothing without a
 *      rename Cache Storage does not offer.
 *
 *   2. THE LIST OF CONTENTS IS NEVER CACHED. `download.json` is the question "what does the server
 *      have now?", so answering it from a cache would be circular.
 *
 *   3. A SUBRESOURCE THAT ASKS NOT TO BE CACHED IS NOT ANSWERED FROM ONE. `no-store`/`reload` pass
 *      through to the network. NAVIGATIONS ARE NOT INCLUDED IN THIS RULE, and that is the whole point
 *      of the offline copy: a reader pressing reload while offline is asking for the book, not for the
 *      network, and a saved book has to answer. Exempting navigations was the difference between the
 *      saved copy opening on a train and not opening at all.
 *
 * With no complete store the worker passes everything through: a first-time reader browses the
 * published site normally and nothing is stored behind their back.
 *
 * ONCE A STORE EXISTS IT WINS OVER THE NETWORK, including for pages. That is deliberate, and it is
 * the rest of the answer to the mixture: a reader reads one edition, whole. The way to a newer one is
 * the nav's download button, which says when one is waiting -- not a page that quietly belongs to the
 * next build.
 *
 * The version is not here. It lives in the store's NAME and in `download.json`, so this file changes
 * only when its own logic does, and a rebuild of unchanged content does not rewrite it.
 */
export function serviceWorkerSource() {
  return `// GENERATED by book/tools/build-site.mjs -- do not edit by hand.
const PREFIX = 'dsq-offline-';
const MARKER = '__complete';
const MANIFEST = 'download.json';

// The complete store. There is at most one, and the page keeps it that way: it deletes every other
// store of ours after a download finishes.
//
// ONLY A FOUND STORE IS REMEMBERED, and that is not an optimisation detail. A worker is started by the
// reader's FIRST visit -- before there is any store -- so an empty answer is the answer it gets, and
// remembering it would mean this worker went on sending every request to the network for the rest of
// its life. The reader's download would appear to do nothing, and the moment they lost connectivity
// the saved book would fail to open: the one failure the download exists to prevent. A missing store
// costs one \`caches.keys()\` per request until the reader saves the book, which is nothing.
//
// AND THE REMEMBERED STORE IS RE-CHECKED, because a download REPLACES it: the old one is deleted a
// moment after the new one is complete, and a remembered handle on a deleted cache is not merely
// stale -- using it throws, so every request would fail. One marker lookup per request is the price of
// a worker that cannot outlive the store it is holding, and it is a lookup rather than a fetch.
let ACTIVE;
async function active() {
  if (ACTIVE) {
    try {
      if (await ACTIVE.match(MARKER)) return ACTIVE;
    } catch (err) {
      // The store this handle names has been deleted under us.
    }
    ACTIVE = null;
  }
  for (const key of await caches.keys()) {
    if (!key.startsWith(PREFIX)) continue;
    const cache = await caches.open(key);
    if (await cache.match(MARKER)) {
      ACTIVE = cache;
      return ACTIVE;
    }
  }
  return null;
}

self.addEventListener('install', () => self.skipWaiting());

// NOTHING IS DELETED HERE. The stores are the reader's downloaded editions and are not this worker's
// to tidy; deleting them on activate is exactly how a reader used to lose the copy they had.
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** A page for a reader who is offline with nothing stored, so a dead end still explains itself. */
function empty() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
      '<p>This book has not been saved on this device for offline reading, and there is no connection ' +
      'to fetch it from. Reconnect, open the book, and use the download button in the navigation bar ' +
      'to save the whole book.',
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Rule 3, and rule 2. The manifest is the question "what does the server have now?", so it is always
  // asked of the network. A subresource that asks not to be cached is not answered from a cache. A
  // NAVIGATION IS NOT EXEMPTED BY EITHER: a page comes from the store whenever the store has it.
  if (url.pathname.endsWith('/' + MANIFEST)) return;
  if (request.mode !== 'navigate' && (request.cache === 'no-store' || request.cache === 'reload')) return;

  event.respondWith(
    (async () => {
      const cache = await active();
      if (!cache) return fetch(request);
      // The page it is, then a directory's own index.html, so a navigation to \`04-calls/\` finds the
      // page the download stored as \`04-calls/index.html\`.
      const hit =
        (await cache.match(request, { ignoreSearch: true })) ||
        (request.mode === 'navigate' && url.pathname.endsWith('/')
          ? await cache.match(new URL('index.html', url).href)
          : null);
      if (hit) return hit;
      try {
        return await fetch(request);
      } catch (err) {
        // A page the store does not have, and no connection. Rule 1 means this cannot happen for a
        // complete store; it is here for a request outside the manifest, such as a favicon the store
        // never held, so the reader gets an explanation rather than the browser's error page.
        if (request.mode === 'navigate') return (await cache.match('./offline.html')) || empty();
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })(),
  );
});
`;
}

export function sitemapXml(entries) {
  const urls = entries
    .map((e) => `  <url>\n    <loc>${escapeXml(e.loc)}</loc>\n    <priority>${e.priority}</priority>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function robotsTxt({ base }) {
  return `User-agent: *
Allow: /

Sitemap: ${base}sitemap.xml
`;
}

export function offlineHtml({ rel = './', css = 'style.css' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline — Dancing Squared</title>
<link rel="stylesheet" href="${rel}${css}">
</head>
<body>
<main>
<nav class="nav">${homeButton()}<a href="${rel}contents.html" title="Contents">&#9776;</a></nav>
<h1>Offline</h1>
<p>This page has not been stored on your device yet, and there is no connection to fetch it.</p>
<p>Pages you have already read work offline, and so do the figures, animations and the interactive
player once they have been loaded. Open the <a href="${rel}contents.html">contents</a> and pick a page
you have visited before, or reconnect and try again.</p>
</main>
</body>
</html>
`;
}

// THE XML RULE IS THE BOOK'S SHARED ONE (`lib/escape.mjs`, imported at the top), and it is the SAME SET the
// engine's exporter uses (`engine/src/convert.ts`): `& < "`. This file used to escape `'` as `&apos;` too —
// harmless in XML, but a third spelling of one rule, and the sitemap it builds is not a
// single-quoted-attribute document.

