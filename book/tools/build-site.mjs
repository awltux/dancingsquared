// Build the online edition: static HTML, with the calls ANIMATED.
//
//   node book/tools/build-site.mjs
//
// Writes `book/dancingsquared_book/` — one HTML page per Markdown section, a stylesheet, the
// animations, the small formation diagrams, and an interactive player on every call page. No server
// is required, but the player is an ES module, so the site must be SERVED (http/https), not opened
// from `file:`.
//
// The Markdown stays the single source of truth. This is a build of it, not a second copy, so the
// book and the site cannot drift.
//
// WHAT THE ONLINE EDITION ADDS. On a call page the animation comes FIRST: a still picture shows a
// formation, the animation shows the movement -- who moves first, and that a call is one continuous
// motion rather than a sequence of poses. That is the whole reason for it.
//
// NOTHING READER-VISIBLE DESCRIBES HOW THE BOOK IS MADE. The site is read by dancers, so no engine,
// repository, corpus or toolchain vocabulary is emitted into a page, and the shipped library is
// published as `lib/` rather than `engine/`.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { toolsDir } from './lib/load.mjs';
import { buildOrder } from './make-nav.mjs';
import { parseBlocks, render, inline } from './lib/markdown.mjs';
import {
  iconPng,
  ogImagePng,
  ICON_SVG,
  homeButton,
  manifestJson,
  serviceWorkerSource,
  sitemapXml,
  robotsTxt,
  offlineHtml,
} from './lib/app.mjs';

const BOOK = join(toolsDir, '..');
/** The build output directory: `book/dancingsquared_book/`. Renamed from `book/site/`, and reached
 *  only through this constant, so `serve-site.mjs` and the ignore file are the other two places that
 *  have to agree with it when the output folder is renamed again. */
const SITE = join(BOOK, 'dancingsquared_book');

/** Every file under `dir`, as paths relative to it. Used to precache the engine. */
function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p, `${prefix}${entry.name}/`));
    else out.push(`${prefix}${entry.name}`);
  }
  return out;
}

/**
 * The last-resort base, used only when nothing says where the site is published. SEO needs absolute
 * URLs, and a wrong canonical is worse than none, so this one is a deliberate placeholder that must
 * never reach a published site -- see `resolveBase()`.
 */
const DEFAULT_BASE = 'https://dancing-squared.example/';

/**
 * Where the site is published, highest precedence first:
 *
 *   1. `--base <url>` — a one-off, for a build that is going somewhere else;
 *   2. `$DSH_BOOK_BASE` — a deployment setting, for a machine rather than a repo;
 *   3. `book/site-base.txt` — the committed answer, so the ordinary `npm run build:book` is correct
 *      without anyone remembering a flag;
 *   4. `DEFAULT_BASE` — the placeholder, and the build says loudly that it was used.
 *
 * A stored base is read rather than defaulted because the failure is silent: a rebuild with the
 * placeholder produces a site that looks perfect and tells search engines it lives somewhere else.
 */
function resolveBase() {
  const arg = process.argv.indexOf('--base');
  if (arg > -1 && process.argv[arg + 1]) return { base: process.argv[arg + 1], source: '--base' };
  if (process.env.DSH_BOOK_BASE?.trim()) return { base: process.env.DSH_BOOK_BASE.trim(), source: 'DSH_BOOK_BASE' };

  const file = join(BOOK, 'site-base.txt');
  if (existsSync(file)) {
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'));
    if (!line) return { base: DEFAULT_BASE, source: null, problem: `${file} has no URL in it` };
    // Fail loudly rather than emit a canonical that is not a URL: a relative or malformed value
    // here would be worse than the placeholder, because it looks deliberate.
    if (!/^https?:\/\/[^\s/]+\//.test(line)) {
      return { base: DEFAULT_BASE, source: null, problem: `${file} does not hold an absolute http(s) URL: "${line}"` };
    }
    return { base: line, source: 'book/site-base.txt' };
  }
  return { base: DEFAULT_BASE, source: null };
}

/**
 * The words a page is SHARED with, as opposed to the words it is read with.
 *
 * A link to this book is usually pasted into a chat or a timeline, and the card that appears is
 * built from `<title>`/`og:title` and `og:description` -- never from the H1, which the recipient
 * cannot see yet. Everywhere else the page's H1 plus the site name is exactly right, because the
 * reader has already arrived and knows where they are. The front page is the exception: "Index —
 * the map of this book" is an inside label, telling a reader who is already in the book where they
 * are and telling a stranger nothing.
 *
 * KEYED BY PAGE PATH. An entry overrides the derived values for that page only:
 *   title       -- replaces the whole `<title>`/`og:title`/`twitter:title` and the JSON-LD name,
 *                  verbatim, with no site-name suffix appended
 *   description -- replaces the derived `og:description`, which for the front page is otherwise the
 *                  opening sentence of a reading-path list, truncated mid-thought
 *
 * The H1 stays as authored: this changes what the tab, the search result and the chat card say, not
 * what the page looks like to someone reading it.
 */
const SHARE_META = {
  'index.md': {
    title: 'Dancing Squared — a beginner’s book for Mainstream Square Dancing',
    description:
      'Every Mainstream call on its own page, each one animated and playable, with the words ' +
      'explained as you meet them — written for someone who has never square danced.',
  },
};

const CSS = `:root {
  --ink: #1d262c;
  --muted: #5d6b74;
  --rule: #dde3e7;
  --accent: #1f6f8b;
  --paper: #ffffff;
  --wash: #f5f8f9;
  /* THE READING SIZE, AND THE ONE KNOB THE TEXT-SIZE SELECTOR TURNS. Every length in this file is
     in rem, which is measured from the root font size, so moving this one value moves the type, the
     spacing, the width of the column and the size of the nav buttons together and nothing can drift
     out of proportion. The column grows with the type (main is 46rem wide), so the number of words
     per line stays about the same at either size rather than the measure doubling. */
  --text-size: 16px;
}
html.text-large { --text-size: 20px; }
* { box-sizing: border-box; }
html { font-size: var(--text-size); -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--wash);
  color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: var(--text-size);
  line-height: 1.62;
}
main { max-width: 46rem; margin: 0 auto; padding: 1.4rem 1.1rem 4rem; background: var(--paper);
       box-shadow: 0 0 0 1px var(--rule); min-height: 100vh; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.9em 0 0.5em; }
h1 { font-size: 1.72rem; margin-top: 0.4em; }
h2 { font-size: 1.26rem; padding-bottom: .2em; border-bottom: 1px solid var(--rule); }
h3 { font-size: 1.06rem; color: #24333b; }
h1 + p, h2 + p, h3 + p { margin-top: .3em; }
p, ul, ol, blockquote, table, figure, pre { margin: 0 0 1.05em; }
a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }
strong { font-weight: 650; }
code { font: 0.86em/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
       background: var(--wash); padding: .12em .35em; border-radius: 3px; }
pre { background: var(--wash); border: 1px solid var(--rule); border-radius: 6px; padding: .8em .9em; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin-left: 0; padding: .1em 0 .1em 1em; border-left: 3px solid var(--accent); color: #33424a; }
blockquote p { margin: .35em 0; }
table { border-collapse: collapse; width: 100%; font-size: .93rem; }
th, td { text-align: left; padding: .42em .6em; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { border-bottom: 1.5px solid #9aa7ae; background: var(--wash); }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2em 0; }
figure { margin: 1.4em 0; text-align: center; }
figure img { max-width: min(100%, 30rem); height: auto; }
figure.anim img { max-width: min(100%, 21rem); }
figcaption { font-size: .84rem; color: var(--muted); margin-top: .45em; }
/* THE PLAYER IS ONE COLUMN THE WIDTH OF THE CANVAS, AND EVERY ROW OF THE CONTROLS SPANS THAT COLUMN.
   The scrub slider has to share edges with the canvas, and the beat readout has to be on its own
   line with the speed control, because the readout changes width as the numbers do ("beat 0.00 /
   8.00" against "beat 6.85 / 6.85") and used to shove the speed selector onto another row mid-play.
   --dsq-size is set by the player from the same data-size the canvas uses, so the two can never
   disagree.

   THE BUTTONS SHARE THEIR ROW instead of being packed against its left edge. At their natural size
   five of them filled barely half the canvas width, so half the control area a reader can see was
   not a button; growing them to fill the row costs nothing and roughly doubles each target, which is
   what makes the bar usable with a thumb. The row cannot overflow: five 2.4rem minimums plus the
   gaps are narrower than the smallest canvas the player is ever given. */
.dsq-player { margin: 1.4em auto .4em; max-width: var(--dsq-size, 21.25rem); }
.dsq-canvas { display: block; margin: 0 auto; width: 100%; max-width: var(--dsq-size, 21.25rem); border: 1px solid var(--rule); border-radius: 8px; background: #f7f9fa; }
.dsq-controls {
  display: flex; flex-wrap: wrap; align-items: center; gap: .4rem;
  width: 100%; margin: .5rem auto 0; font-size: .85rem;
}
.dsq-controls button {
  flex: 1 1 0; min-width: 2.4rem; height: 2.1rem; padding: 0 .45rem; font-size: .95rem; line-height: 1;
  border: 1px solid var(--rule); border-radius: 7px; background: #fff; color: var(--ink); cursor: pointer;
}
.dsq-controls button:hover { border-color: var(--accent); color: var(--accent); }
/* THE SCRUB SLIDER IS THE CONTROL A READER USES MOST, AND IT IS THE HARDEST TO HIT. A native range
   input is about 16px tall with a 4px track, which is a poor target with a thumb -- especially on a
   touch screen, where the reader is aiming at a small dot on a thin line. It is drawn here instead:
   the element is 2.5rem (40px) tall, the track is 8px and the thumb is 1.4rem (22px), so there is a
   real target under the finger and the position is readable at a glance. The 100% basis keeps it on
   its own line, so the buttons stay above it and the readout falls below it without a wrapper.
   Both engine prefixes are written out: Blink and WebKit use -webkit-slider-*, Firefox uses
   -moz-range-*, and a custom thumb that only one of them knows about is an invisible control in the
   other. accent-color stays as the fallback for a browser that applies neither. */
.dsq-controls input[type=range] {
  flex: 1 0 100%; min-width: 0; width: 100%; height: 2.5rem; margin: 0;
  border: 0; background: none; accent-color: var(--accent); cursor: pointer;
  -webkit-appearance: none; appearance: none;
}
.dsq-controls input[type=range]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: .55rem; }
.dsq-controls input[type=range]::-webkit-slider-runnable-track {
  height: .5rem; border-radius: .25rem; background: var(--rule);
}
.dsq-controls input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 1.4rem; height: 1.4rem; margin-top: -.45rem;
  border: 2px solid #fff; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.dsq-controls input[type=range]::-moz-range-track {
  height: .5rem; border-radius: .25rem; background: var(--rule);
}
.dsq-controls input[type=range]::-moz-range-thumb {
  width: 1.4rem; height: 1.4rem; border: 2px solid #fff; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 0 1px var(--accent);
}
.dsq-readout { margin-right: auto; font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
.dsq-speed { display: inline-flex; align-items: center; gap: .25rem; color: var(--muted); }
.dsq-speed select { border: 1px solid var(--rule); border-radius: 6px; padding: .15rem; background: #fff; }
.dsq-error { color: #b2182b; }
details.dsq-share { margin: 0 0 1.2em; font-size: .9rem; }
details.dsq-share summary { cursor: pointer; color: var(--muted); }
details.dsq-share figure { margin-top: .7em; }
nav.nav {
  display: flex; flex-wrap: wrap; gap: .4rem; align-items: center;
  padding: .5rem 0 .9rem; margin-bottom: 1.1rem; border-bottom: 1px solid var(--rule);
  font-size: 1rem;
}
nav.nav a, nav.nav span.off, nav.nav button.pin, nav.nav button.textsize {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 2.3rem; height: 2.3rem; padding: 0 .55rem;
  border: 1px solid var(--rule); border-radius: 8px; background: #fff; text-decoration: none;
  color: var(--ink); font-weight: 600;
}
nav.nav a:hover { border-color: var(--accent); color: var(--accent); }
nav.nav a.home { padding: 0 .62rem; }
nav.nav a.home svg { display: block; width: 1.15rem; height: 1.15rem; }
nav.nav span.off { color: #c2cbd1; background: var(--wash); }
nav.nav .where { margin-left: auto; font-size: .82rem; color: var(--muted); font-weight: 400; }
/* THE READER'S TOOLS -- the text-size selector and the pin -- travel together at the right-hand end
   of the row. One auto margin on the group is what holds them there, so adding a control here later
   cannot push the navigation links around, and the pair reads as page chrome rather than as two more
   places to navigate to. */
nav.nav .nav-tools { margin-left: auto; display: inline-flex; align-items: center; gap: .4rem; }
/* The text-size button matches the nav buttons in size and carries the standard two-A glyph: a small
   A and a large A side by side, which is the shape every reader already reads as "make the text
   bigger". It is a toggle like the pin, so its state rides aria-pressed and the CSS fills it the
   same way -- one pattern for both controls in this group. */
nav.nav button.textsize { cursor: pointer; }
nav.nav button.textsize svg { display: block; width: 1.6rem; height: 1.1rem; }
nav.nav button.textsize:hover { border-color: var(--accent); color: var(--accent); }
nav.nav button.textsize[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
/* THE PIN. It is a BUTTON rather than a link because it changes the page rather than going
   somewhere, and an aria-pressed toggle is what a screen reader needs to hear its state -- which is
   also how the filled state is selected in CSS, so the two cannot disagree. */
nav.nav button.pin { cursor: pointer; }
nav.nav button.pin svg { display: block; width: 1.15rem; height: 1.15rem; }
nav.nav button.pin:hover { border-color: var(--accent); color: var(--accent); }
nav.nav button.pin[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
/* THE PINNED HEADER. position: sticky keeps the bar where it is in the flow and holds it at the top
   of the viewport from the moment the page scrolls past it, so nothing moves when it is turned on
   and nothing is hidden when it is off. The board is white and the shadow is what makes a bar
   sitting over text read as floating above it rather than as another line of the page.
   Nothing may trap scrolling between the bar and the viewport: no ancestor of the nav sets
   overflow, which is exactly the condition sticky needs. */
nav.nav.pinned {
  position: sticky; top: 0; z-index: 5;
  background: var(--paper);
  box-shadow: 0 .45rem .6rem -.45rem rgba(29, 38, 44, .45);
}
/* AN ANCHOR JUMP LANDS UNDER A PINNED BAR otherwise: the heading a reader jumps to (a same-page
   related call, a formation link, a glossary link) comes to rest behind the pinned navigation, so
   the thing they asked for is the thing they cannot see. The bar's own height is 2.3rem of buttons
   plus 1.4rem of padding; 3.9rem clears it with a little air. Guarded on the bar actually being
   pinned, so an unpinned page lands exactly where it always did, and a browser without :has just
   keeps the old behaviour rather than losing the jump. */
html:has(nav.nav.pinned) h2,
html:has(nav.nav.pinned) h3 { scroll-margin-top: 3.9rem; }
footer.page { margin-top: 3rem; padding-top: .9rem; border-top: 1px solid var(--rule);
              font-size: .82rem; color: var(--muted); }
@media print {
  body { background: #fff; } main { box-shadow: none; max-width: none; }
  nav.nav { display: none; }
}
`;

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The name the book carries when it is INSTALLED as an app, rather than read as a website.
 *
 * The launcher label comes from the manifest's `short_name`, and iOS uses
 * `apple-mobile-web-app-title`; both have to be short, because a home screen truncates what does not
 * fit. It is deliberately not the book's title: "Dancing Squared — a beginner's book for Mainstream
 * Square Dancing" is a description, and a launcher wants a name. The manifest's long `name` stays
 * descriptive -- that is what the install dialog and the app-info page show.
 *
 * The ² is U+00B2, kept literal so the file stays readable; it is the same character in the emitted
 * manifest, which is UTF-8.
 */
const APP_NAME = 'Dancing² Mainstream';

const PAGE = ({ title, cardTitle = null, description, rel, navHtml, body, script = '', canonical = null, jsonLd, ogImage = null }) => {
  // A page's own H1 plus the site name is right for a page you arrive at by reading. It is wrong for
  // the page people SHARE, which is named from outside the book rather than from inside it, so a
  // page may carry a `cardTitle` that is used verbatim.
  const full = cardTitle ?? `${title} — Dancing Squared`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<meta name="author" content="Dancing Squared">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="article">
<meta property="og:site_name" content="Dancing Squared">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:locale" content="en">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(full)}">
<meta name="twitter:description" content="${esc(description)}">
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ''}
<link rel="manifest" href="${rel}manifest.webmanifest">
<meta name="theme-color" content="#1f6f8b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${esc(APP_NAME)}">
<link rel="apple-touch-icon" href="${rel}icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="${rel}icons/icon-192.png">
<link rel="icon" type="image/svg+xml" href="${rel}icons/icon.svg">
<link rel="stylesheet" href="${rel}style.css">
<script>
// THE CHOSEN TEXT SIZE, APPLIED BEFORE THE FIRST PAINT. A reader who picked large text should not
// watch every page arrive small and grow -- the flash is worse than the delay it saves. Every page
// in the book is served from the same origin, so the choice carries from one page to the next; a
// browser that refuses storage (private mode, a locked-down profile) simply gets the default, and
// nothing else on the page depends on this having worked.
try {
  if (localStorage.getItem('dsq-text-size') === 'large') {
    document.documentElement.classList.add('text-large');
  }
} catch (e) {}
</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<main id="content">
<article>
${navHtml}
${body}
<footer class="page">
<p>Dancing Squared — a beginner's book for Mainstream Square Dancing. Written from the CALLERLAB
Mainstream Dance Program Definitions, revised 29 March 2026, and the CALLERLAB Plus Program
Definitions, revised 25 August 2026. Definitions quoted with permission; see
<a href="${rel}08-reference/sources-and-attribution.html">sources and attribution</a>.</p>
</footer>
</article>
</main>${script}
<script>
// THE PIN. Off on every page load: the reader chooses it for the page in front of them. All this
// does is move one class and mirror it into aria-pressed -- the sticking itself is CSS, so the
// control cannot leave the bar in a state the stylesheet does not describe.
(function () {
  var bar = document.querySelector('nav.nav');
  var pin = bar && bar.querySelector('button.pin');
  if (pin) {
    pin.addEventListener('click', function () {
      var on = bar.classList.toggle('pinned');
      pin.setAttribute('aria-pressed', on ? 'true' : 'false');
      pin.title = on
        ? 'Unpin the navigation bar and let it scroll away'
        : 'Pin the navigation bar to the top of the screen';
    });
  }
  // THE TEXT SIZE. The head script has already put the reader's last choice on the root element and
  // the stylesheet has already drawn the page with it; all this does is read that state back into the
  // button and write a new choice to both. Small is the absence of the class, so the default page
  // has one thing less to go wrong.
  var root = document.documentElement;
  var sizeBtn = bar && bar.querySelector('button.textsize');
  if (sizeBtn) {
    var showSize = function (large) {
      root.classList.toggle('text-large', large);
      sizeBtn.setAttribute('aria-pressed', large ? 'true' : 'false');
      sizeBtn.title = large ? 'Back to the normal text size' : 'Show the text at the larger size';
      try {
        localStorage.setItem('dsq-text-size', large ? 'large' : 'small');
      } catch (e) {}
    };
    showSize(root.classList.contains('text-large'));
    sizeBtn.addEventListener('click', function () {
      showSize(!root.classList.contains('text-large'));
    });
  }
})();
if (location.protocol === 'http:' || location.protocol === 'https:') {
  if ('serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('${rel}sw.js').catch(function () { /* offline mode is a bonus, not a requirement */ });
    });
  }
}
// The player is an ES MODULE, and browsers refuse to load modules from file://. When that happens
// the module never runs at all, so the player would be an empty box with no error anywhere -- which
// is exactly how it looks when someone opens index.html from disk instead of serving it. This runs
// as a CLASSIC script, so it still executes in that case, and says what happened.
addEventListener('load', function () {
  setTimeout(function () {
    var hosts = document.querySelectorAll('.dsq-player');
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].childElementCount) continue;
      hosts[i].innerHTML =
        '<p class="dsq-error">The interactive player is not running. It is loaded as an ES module, ' +
        'and browsers block those on <code>file://</code> &mdash; so this happens when the book is ' +
        'opened straight from disk rather than served. Run <code>npm run serve:book</code> and open ' +
        'the address it prints. The animated GIF below works either way.</p>';
    }
  }, 900);
});
</script>
</body>
</html>
`;
};

/**
 * The text-size button, in the nav's tool group.
 *
 * A TOGGLE, NOT A SELECTOR. Two sizes is a state, not a choice from a list, so it is one button that
 * says which size you are on -- the same shape as the pin beside it, and the same aria-pressed
 * mechanism, which is what a screen reader needs to hear the state and what the CSS fills on.
 *
 * THE GLYPH IS THE SMALL A AND THE LARGE A SIDE BY SIDE, sharing a baseline, which is the standard
 * mark for this control and needs no label: a reader who cannot read the words "small" and "large"
 * because they are too small has no use for a label that names them. SVG text rather than drawn
 * paths, so the letters are the reader's own font like the text they are asking to enlarge, and
 * currentColor so they follow the button's colour in both states.
 */
function textSizeButton() {
  return (
    '<button type="button" class="textsize" aria-pressed="false" aria-label="Larger text" ' +
    'title="Show the text at the larger size">' +
    '<svg viewBox="0 0 32 22" aria-hidden="true" focusable="false">' +
    '<text x="3" y="20" font-size="13" font-weight="700" fill="currentColor">A</text>' +
    '<text x="16" y="20" font-size="19" font-weight="700" fill="currentColor">A</text>' +
    '</svg></button>'
  );
}

/**
 * The Pin button, at the right-hand end of the nav row.
 *
 * NOT SHARED WITH `lib/app.mjs`, unlike the Home button. The offline page carries no scripts, so a
 * Pin there could not work, and a control that does nothing is worse than no control.
 *
 * The glyph is decorative and the accessible name comes from `aria-label`; the state rides
 * `aria-pressed`, which is what the CSS selects on and what a screen reader announces, so the look
 * and the announcement cannot drift apart.
 */
function pinButton() {
  return (
    '<button type="button" class="pin" aria-pressed="false" aria-label="Pin the navigation bar" ' +
    'title="Pin the navigation bar to the top of the screen">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M9.2 3.2H14.8V8.3L17 10.5V12.1H12.9V19.2L12 20.8L11.1 19.2V12.1H7V10.5L9.2 8.3Z"/>' +
    '</svg></button>'
  );
}

/** The Markdown nav line, re-rendered as buttons. It is already a list of links, so this is a
 *  re-wrap rather than a re-derivation: the destinations come from the one place that knows them. */
function navHtmlFrom(block) {
  if (!block) return '';
  const lines = block
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const buttonLine = lines.find((l) => l.startsWith('**')) ?? lines[0] ?? '';
  const infoLine = lines.find((l) => /page\s+\d+\s+of\s+\d+/.test(l)) ?? '';
  const m = /page\s+(\d+)\s+of\s+(\d+)/.exec(infoLine);
  const chapter = infoLine.replace(/·?\s*page.*$/, '').trim();
  let html = inline(buttonLine);
  html = html.replace(/<del>(.*?)<\/del>/g, '<span class="off">$1</span>');
  const note = m ? `<span class="where">${chapter ? `${chapter} · ` : ''}page ${m[1]} of ${m[2]}</span>` : '';
  // The Home button leads the row, so it sits at the top left of every page. It comes from
  // `lib/app.mjs` so the offline page cannot drift from the pages that carry the nav bar. The
  // reader's tools -- text size and the pin -- are grouped last, so they sit at the top right.
  return (
    `<nav class="nav">${homeButton()}${html}` +
    `<span class="nav-tools">${textSizeButton()}${pinButton()}</span>${note}</nav>`
  );
}

/**
 * A page's meta description, taken from its own opening paragraph.
 *
 * Derived rather than hand-written so it cannot go stale, and truncated at a WORD boundary: a
 * description cut mid-word is the visual signature of a generated site.
 */
function describe(blocks, fallback, page = null) {
  const plain = (s) =>
    String(s)
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  const trim = (text) => {
    if (!text) return '';
    if (text.length <= 158) return text;
    const cut = text.slice(0, 158);
    return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  };

  // (a) The page's own opening, BEFORE its first sub-heading. For a call page that is the
  //     prerequisite note, which is a better summary than an italic aside further down.
  const firstHeading = blocks.findIndex((b) => b.type === 'heading');
  const intro = blocks.slice(0, firstHeading < 0 ? blocks.length : firstHeading);
  const introPara = intro.find((b) => b.type === 'paragraph');
  if (introPara) {
    const text = trim(plain(introPara.text));
    if (text.length > 60) return text;
  }
  const introQuote = intro.find((b) => b.type === 'quote');
  if (introQuote) {
    const text = trim(plain(introQuote.lines.join(' ')));
    if (text.length > 60) return text;
  }

  // (b) A call page's `At a glance` table IS its summary: starting formation, ending formation,
  //     timing. Composed from the table rather than written twice, so it cannot go stale.
  const glance = blocks.find(
    (b) => b.type === 'table' && b.rows.some((r) => /Starting formation/i.test(r[0] ?? '')),
  );
  if (glance) {
    const cell = (label) => {
      const row = glance.rows.find((r) => new RegExp(label, 'i').test(r[0] ?? ''));
      return row ? plain((row[1] ?? '').replace(/—/g, '-')) : '';
    };
    const from = cell('Starting formation');
    const to = cell('Ending formation');
    const beats = cell('Timing');
    const bits = [];
    if (from && to) bits.push(`From ${from} to ${to}`);
    else if (from) bits.push(`From ${from}`);
    if (beats) bits.push(beats.includes('beat') ? beats : `${beats} beats`);
    if (bits.length) {
      const head = page ? `${page.title}. ` : '';
      return trim(`${head}${bits.join(', ')}. A Mainstream call, with figure, dancer tracks, styling and common faults.`);
    }
  }

  // (c) Anything else at all.
  const para = blocks.find((b) => b.type === 'paragraph');
  const text = trim(plain(para?.text ?? ''));
  return text || fallback;
}

/** The numbered steps under `### What you do`, as list items. */
function stepsOf(blocks) {
  const at = blocks.findIndex((b) => b.type === 'heading' && /^What you do$/i.test(b.text.trim()));
  if (at < 0) return [];
  for (let i = at + 1; i < blocks.length; i++) {
    if (blocks[i].type === 'list') {
      return blocks[i].items.map((t) => t.replace(/`/g, '').replace(/\*\*/g, '').slice(0, 300));
    }
    if (blocks[i].type === 'heading') break;
  }
  return [];
}

/**
 * Structured data.
 *
 * A call page is marked up as a `HowTo` as well as a `WebPage`, with the `What you do` steps as its
 * steps -- which is what the page actually is: instructions for performing a movement. Every page
 * carries a breadcrumb, because the book is a hierarchy and that is worth saying explicitly.
 */
function jsonLdFor({ page, name = page.title, description, canonical, base, url, siteName }) {
  const crumbs = [{ '@type': 'ListItem', position: 1, name: 'Contents', item: `${base}index.html` }];
  if (page.chapter !== 'front') {
    crumbs.push({
      '@type': 'ListItem',
      position: 2,
      name: page.label,
      item: `${base}${firstPageOfChapter(page.chapter)}`,
    });
  }
  const node = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name,
        description,
        url: canonical ?? url,
        inLanguage: 'en',
        isPartOf: { '@type': 'Book', name: siteName, url: base },
        breadcrumb: { '@type': 'BreadcrumbList', itemListElement: crumbs },
      },
    ],
  };
  const steps = stepsOf(parseBlocks(page.text.replace(/<!-- nav:start -->[\s\S]*?<!-- nav:end -->/, '')));
  if (steps.length) {
    node['@graph'].push({
      '@type': 'HowTo',
      name,
      description,
      inLanguage: 'en',
      step: steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text })),
    });
  }
  return node;
}

let chapterFirst = new Map();
function firstPageOfChapter(chapter) {
  return chapterFirst.get(chapter) ?? 'index.html';
}

function animationFigure(id, meta) {
  if (!meta) return '';
  // ONLY THE PLAYER IS INJECTED, and only once. It is the call's animation: a second, control-less
  // copy underneath it read as a mistake rather than as a second view of the call.
  void id;
  // The alternative start formations travel as one JSON attribute rather than as a fistful of data
  // attributes, because each carries four fields and the player has to be able to read them as a
  // list. Absent when the call has only one, which is most of them: a one-item selector is noise.
  const starts =
    (meta.starts?.length ?? 0) > 1
      ? ` data-starts="${esc(JSON.stringify(meta.starts.map((s) => [s.label, s.file, s.tamIndex, s.view?.scale, s.view?.units, s.beats])))}"`
      : '';
  return (
    `<div class="dsq-player" data-file="${meta.file}" data-tam="${meta.tamIndex ?? 0}" ` +
    `data-scale="${meta.view?.scale ?? 20}" data-units="${meta.view?.units ?? 6}" ` +
    `data-beats="${meta.beats}" data-size="340"${starts}></div>`
  );
}

/**
 * The animation ids for a call page, in call-card order -- with `null` for a card that has none.
 *
 * TAKEN FROM THE TEACHING ORDER, not from anything in the page text. Pairing ids with `### Animation`
 * headings by counting matches in the Markdown put the wrong player on the page as soon as a card
 * without an animation came first: unit M4 is (a) Right/Left Arm Turn, which has none, and (b)
 * Allemande Left, which has one, so the one player on that page was injected under the wrong call.
 * A null slot keeps the alignment exact, and the count check below proves it.
 */
function animationIdsFor(pathAndName, unitByNumber, animMeta) {
  const m = /(?:^|\/)04-calls\/m(\d\d)-/.exec(pathAndName);
  if (!m) return [];
  const unit = unitByNumber.get(m[1]);
  if (!unit) return [];
  return unit.entries.map((e) => {
    const id = `m${m[1]}${e.letter ?? ''}`;
    return animMeta.has(id) ? id : null;
  });
}

export function main() {
  const resolved = resolveBase();
  if (resolved.problem) {
    console.error(`error: ${resolved.problem}`);
    console.error('       fix it, or pass --base https://your.site/ for this build.');
    return 1;
  }
  const base = resolved.base.replace(/\/?$/, '/');
  if (resolved.source) {
    console.log(`base: ${base}  (from ${resolved.source})`);
  } else {
    console.log(`note: canonical URLs and the sitemap use the placeholder base ${DEFAULT_BASE}`);
    console.log('      put the real address in book/site-base.txt, or pass --base https://your.site/,');
    console.log('      or the canonical URLs will point readers and search engines at a domain that is');
    console.log('      not yours.');
  }

  const pages = buildOrder();
  chapterFirst = new Map();
  for (const p of pages) if (!chapterFirst.has(p.chapter)) chapterFirst.set(p.chapter, p.path.replace(/\.md$/, '.html'));
  const siteName = 'Dancing Squared — a beginner’s book for Mainstream Square Dancing';

  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(SITE, { recursive: true });

  // The small formation diagrams. They ARE precached: they are 1-2 KB each and they sit inside a
  // concept page, so a reader who opens Formations offline should see them.
  cpSync(join(BOOK, 'formations'), join(SITE, 'formations'), { recursive: true });

  // The dance library the player needs, so it can evaluate poses in the browser exactly as the POC
  // does. `engine/dist` has no external imports, so the directory copies over and runs as an ES
  // module. It is published as `lib/` rather than `engine/`: the site is read by dancers, and
  // nothing a reader can see should describe how the book is made.
  const engineDist = join(BOOK, '..', 'engine', 'dist');
  if (!existsSync(join(engineDist, 'index.js'))) {
    console.error('engine/dist is not built; the interactive player cannot be included.');
    console.error('Build it with: npm run build:engine');
    return 1;
  }
  // Only the runtime `.js`. The dist also carries `.d.ts` declarations and `.map` source maps,
  // which are 786 KB of a 1.5 MB directory that a browser never reads.
  for (const rel of listFiles(engineDist)) {
    if (!rel.endsWith('.js')) continue;
    const dest = join(SITE, 'lib', rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(engineDist, rel), dest);
  }
  mkdirSync(join(SITE, 'assets'), { recursive: true });
  cpSync(join(BOOK, 'assets', 'player.js'), join(SITE, 'assets', 'player.js'));
  for (const name of ['moves.xml', 'formations.xml']) {
    cpSync(join(BOOK, '..', 'poc', 'src', 'assets', name), join(SITE, 'assets', name));
  }

  // Only the call authorings a page actually plays, not the whole corpus: the one each figure starts
  // from, plus every alternative start formation the player can switch to.
  const animIndexPath = join(toolsDir, 'animations-index.json');
  const animMeta = new Map();
  if (existsSync(animIndexPath)) {
    for (const f of JSON.parse(readFileSync(animIndexPath, 'utf8')).figures) animMeta.set(f.id, f);
    const needed = new Map();
    for (const f of animMeta.values()) {
      needed.set(f.file, true);
      for (const s of f.starts ?? []) needed.set(s.file, true);
    }
    for (const file of needed.keys()) {
      const dest = join(SITE, 'assets', 'calls', file);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(BOOK, '..', 'poc', 'src', 'assets', file), dest);
    }
  }
  const callMap = JSON.parse(readFileSync(join(toolsDir, 'call-map.json'), 'utf8'));
  const unitByNumber = new Map(callMap.units.map((u) => [String(u.n).padStart(2, '0'), u]));

  writeFileSync(join(SITE, 'style.css'), CSS, 'utf8');

  let animated = 0;
  const injected = new Set();
  const layout = [];
  let hasPlayer = false;
  for (const page of pages) {
    const navMatch = /<!-- nav:start -->([\s\S]*?)<!-- nav:end -->/.exec(page.text);
    const withoutNav = page.text.replace(/<!-- nav:start -->[\s\S]*?<!-- nav:end -->\n?/, '');
    const blocks = parseBlocks(withoutNav);

    // The animation each call card carries, in card order, so each gets ITS call's player.
    const ids = animationIdsFor(page.path, unitByNumber, animMeta);
    let next = 0;
    let headings = 0;

    const body = render(blocks, {
      figureId: ids.length ? 'auto' : null,
      onFigureHeading: () => {
        headings++;
        const id = ids[next++];
        if (!id) return '';
        const meta = animMeta.get(id);
        if (meta) {
          animated++;
          injected.add(id);
        }
        return animationFigure(id, meta);
      },
    });

    // One `### Animation` heading per call card, or a player lands on the wrong call.
    if (headings !== ids.length) {
      layout.push(`${page.path}: ${headings} animation heading(s) for ${ids.length} call card(s)`);
    }

    const rel = page.path.includes('/') ? '../' : '';
    // The player module is added ONLY to the pages that have one: it pulls in the whole engine,
    // and no reader should download 1.5 MB of it to read a glossary.
    const hasPlayerHere = body.includes('dsq-player');
    if (hasPlayerHere) hasPlayer = true;
    const script = hasPlayerHere ? `\n<script type="module" src="${rel}assets/player.js"></script>` : '';
    const url = `${base}${page.path.replace(/\.md$/, '.html')}`;
    const share = SHARE_META[page.path] ?? {};
    const description = share.description ?? describe(
      blocks,
      `${page.title} — from Dancing Squared, a beginner's book for Mainstream Square Dancing.`,
      page,
    );
    const html = PAGE({
      title: page.title,
      cardTitle: share.title ?? null,
      description,
      rel,
      navHtml: navHtmlFrom(navMatch?.[1]),
      body,
      script,
      canonical: url,
      ogImage: `${base}icons/og-image.png`,
      jsonLd: jsonLdFor({
        page,
        description,
        canonical: url,
        base,
        url,
        siteName,
        name: share.title ?? page.title,
      }),
    });
    const out = join(SITE, page.path.replace(/\.md$/, '.html'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html, 'utf8');
  }

  // ---- the stand-alone app: icons, manifest, service worker, offline page
  mkdirSync(join(SITE, 'icons'), { recursive: true });
  const icons = [
    ['icon-192.png', iconPng(192)],
    ['icon-512.png', iconPng(512)],
    ['maskable-192.png', iconPng(192, { maskable: true })],
    ['maskable-512.png', iconPng(512, { maskable: true })],
    ['apple-touch-icon.png', iconPng(180)],
    ['og-image.png', ogImagePng()],
  ];
  for (const [name, buf] of icons) writeFileSync(join(SITE, 'icons', name), buf);
  writeFileSync(join(SITE, 'icons', 'icon.svg'), ICON_SVG);

  writeFileSync(
    join(SITE, 'manifest.webmanifest'),
    manifestJson({
      name: siteName,
      shortName: APP_NAME,
      description:
        'A beginner’s book for the CALLERLAB Mainstream Square Dance Program, with every call ' +
        'animated and playable. Works offline once opened.',
      // An absolute start_url/scope only when the site has a real host; from the placeholder the
      // manifest stays relative, so a site opened from disk still installs against its own path.
      base: resolved.source ? base : '',
    }),
    'utf8',
  );
  writeFileSync(join(SITE, 'robots.txt'), robotsTxt({ base }), 'utf8');
  // The contents page is the entry point, so it carries the top priority. It is NOT listed
  // separately as well: doing that put `index.html` in the sitemap twice with two different
  // priorities (1.0 and 0.6), which is a contradiction a crawler has to guess at.
  writeFileSync(
    join(SITE, 'sitemap.xml'),
    sitemapXml(
      pages.map((p) => ({
        loc: `${base}${p.path.replace(/\.md$/, '.html')}`,
        priority: p.path === 'index.md' ? '1.0' : p.chapter === '04-calls' ? '0.8' : '0.6',
      })),
    ),
    'utf8',
  );
  writeFileSync(join(SITE, 'offline.html'), offlineHtml(), 'utf8');

  // Precache what a reader needs to OPEN the book offline: every page, the stylesheet, the player,
  // the engine and the dance data. Figures and animations are NOT precached -- they are 11 MB, and
  // they are cached on first view instead, so a reader who never opens a call page does not pay for
  // them.
  const precache = [
    './index.html',
    './style.css',
    './offline.html',
    './manifest.webmanifest',
    ...pages.map((p) => `./${p.path.replace(/\.md$/, '.html')}`),
    './assets/player.js',
    './assets/moves.xml',
    './assets/formations.xml',
    ...[...animMeta.values()].map((f) => `./assets/calls/${f.file}`),
    ...listFiles(join(SITE, 'lib')).map((f) => `./lib/${f}`),
    ...listFiles(join(SITE, 'formations')).map((f) => `./formations/${f}`),
    ...icons.map(([name]) => `./icons/${name}`),
  ];
  // THE VERSION IS A HASH OF WHAT IS IN THE CACHE, not of the names in it. Hashing the names alone
  // meant a change to the stylesheet -- or to any page, or to the dance library -- rebuilt the site
  // without rotating the cache, so a reader who had visited before kept the old copy. Pages are
  // network-first and everything else is cache-first, so the new HTML would arrive wearing the old
  // CSS: a control ships, renders unstyled, and does nothing when pressed. Reading the contents is
  // what makes a new build replace the old one instead of serving a mixture.
  const digest = createHash('sha256');
  for (const entry of [...precache].sort()) {
    digest.update(entry);
    try {
      digest.update(readFileSync(join(SITE, entry.replace(/^\.\//, ''))));
    } catch {
      // An entry that is not on disk still has to move the version, so its name goes in alone and
      // `cache.addAll` reports it at install time.
    }
  }
  const version = `v${digest.digest('hex').slice(0, 12)}`;
  writeFileSync(join(SITE, 'sw.js'), serviceWorkerSource({ version, precache }), 'utf8');

  // ---- verify the site rather than assume it: every internal link and image must resolve
  const problems = [];
  let checked = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.name.endsWith('.html')) continue;
      const html = readFileSync(p, 'utf8');
      for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const target = m[1];
        // Skipped: absolute URLs, and root-relative ones (`/index.html`, which is the Home button).
        // A root-relative target belongs to the HOST, which sits outside the directory this build
        // owns, so there is nothing here to resolve it against. Everything else must exist on disk.
        if (/^(https?:|mailto:|#|\/)/.test(target)) continue;
        checked++;
        const [path] = target.split('#');
        if (!existsSync(join(dirname(p), decodeURIComponent(path)))) {
          problems.push(`${relative(SITE, p)}: dead ${target}`);
        }
      }
      // A player is only as good as the assets it fetches at runtime, and those requests do not
      // appear in the HTML as href/src -- so they are checked from the data attributes instead.
      for (const m of html.matchAll(/class="dsq-player"[^>]*data-file="([^"]+)"/g)) {
        checked++;
        if (!existsSync(join(SITE, 'assets', 'calls', m[1]))) {
          problems.push(`${relative(SITE, p)}: player needs missing authoring ${m[1]}`);
        }
      }
    }
  };
  if (hasPlayer) {
    for (const needed of ['lib/index.js', 'assets/player.js', 'assets/moves.xml', 'assets/formations.xml']) {
      checked++;
      if (!existsSync(join(SITE, needed))) problems.push(`site is missing ${needed} (needed by the player)`);
    }
  }
  walk(SITE);

  // Every call the catalogue can play must reach a page. A playable call that no page places is a
  // silent gap in the one feature this edition exists for, so it is an error, not a stray file.
  const animIndex = join(toolsDir, 'animations-index.json');
  if (existsSync(animIndex)) {
    const { figures } = JSON.parse(readFileSync(animIndex, 'utf8'));
    const orphans = figures.map((f) => f.id).filter((id) => !injected.has(id));
    for (const id of orphans) problems.push(`the player for ${id} is never placed on a page`);
  }
  for (const l of layout) problems.push(l);

  const htmlCount = pages.length;
  console.log(`${htmlCount} pages -> ${SITE}`);
  console.log(`${animated} call pages carry an animation; ${checked} internal links checked`);
  if (problems.length) {
    for (const p of problems.slice(0, 12)) console.error(`  ${p}`);
    console.error(`${problems.length} problem(s) in the built site.`);
    return 1;
  }
  console.log('every link and image in the site resolves.');
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  process.exit(main());
}

