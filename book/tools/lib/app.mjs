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
 * The service worker: the shell and the engine are precached, everything else is cached as it is
 * seen.
 *
 * The precache holds what a reader needs to OPEN the book offline -- every page, the stylesheet, the
 * player, the engine, the dance data, the icons. The figures and animations are deliberately NOT
 * precached: they are 11 MB, and a reader who never opens a call page should not download them.
 * They are cached the moment they are viewed, so a second visit works offline.
 */
export function serviceWorkerSource({ version, precache }) {
  return `// GENERATED by book/tools/build-site.mjs -- do not edit by hand.
const VERSION = ${JSON.stringify(version)};
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('precache incomplete', err)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(request, response) {
  // Only same-origin, successful, complete responses are worth keeping.
  if (!response || response.status !== 200 || response.type === 'opaque') return response;
  const cache = await caches.open(VERSION);
  cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Pages: try the network so a reader gets the newest build, fall back to the cached page, then
    // to the offline notice. A page that has never been visited and cannot be fetched still lands
    // somewhere that explains itself.
    event.respondWith(
      fetch(request)
        .then((res) => put(request, res))
        .catch(async () => (await caches.match(request)) || (await caches.match('./offline.html'))),
    );
    return;
  }

  // Everything else: cache first. Figures and animations never change without the version
  // changing, so a cached copy is always current for this build.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => put(request, res))),
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

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}
