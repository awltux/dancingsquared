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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  navIcon,
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
 * reader has already arrived and knows where they are. The contents page is the exception:
 * "Contents" is an inside label, telling a reader who is already in the book where they are and
 * telling a stranger nothing.
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
  /* THE ONE STATE THAT ASKS THE READER TO DO SOMETHING -- a newer edition of the book is published and
     is waiting to be downloaded. It is the only colour here that is not the accent or a grey, so that
     "there is something for you to do" looks like nothing else on the page. The wash is the same
     colour at a tint light enough to read the glyph on, which is what keeps the button legible in the
     state that has to be noticed. */
  --warn: #a35a00;
  --warn-wash: #fdf4e7;
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
/* A CALLOUT IS A BLOCKQUOTE THAT IS NOT A QUOTATION. The plain accent bar is this book's mark for
   CALLERLAB's words, so a passage the book says in its own voice -- the warning that the book itself
   was machine-written -- cannot wear it. A tinted panel and a red rule mark it as an aside to read
   before trusting the page, without copying the quotation styling anywhere else. */
blockquote.callout { background: #fdf5f6; border-left-color: #b2182b; border-radius: 0 5px 5px 0;
                     padding: .8em 1.05em .8em 1.1em; color: var(--ink); }
blockquote.callout p:first-child { margin-top: 0; }
blockquote.callout p:last-child { margin-bottom: 0; }
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
/* THE START SELECTOR GETS THE LINE BELOW THE READOUT AND THE SPEED. It is set once before watching
   and then left alone, where the readout, the speed and the slider are touched continuously -- so
   the two controls a reader's thumb keeps coming back to stay together on one line, and the one
   that chooses WHICH animation is being watched sits on the next. A 100% basis is what puts it on a
   line of its own, the same trick the slider uses, and it comes last in the DOM as well so the tab
   order still runs left to right, top to bottom. */
.dsq-controls .dsq-start, .dsq-controls .dsq-call { flex: 1 0 100%; }
/* The hidden attribute has to be said out loud: .dsq-speed sets display: inline-flex, and an author
   rule beats the browser's own [hidden] { display: none }, so the attribute alone would leave a
   one-option chooser on the screen -- the thing it is set to avoid. */
.dsq-controls label[hidden] { display: none; }
.dsq-error { color: #b2182b; }
details.dsq-share { margin: 0 0 1.2em; font-size: .9rem; }
details.dsq-share summary { cursor: pointer; color: var(--muted); }
details.dsq-share figure { margin-top: .7em; }
nav.nav {
  display: flex; flex-wrap: wrap; gap: .4rem; align-items: center;
  padding: .5rem 0 .9rem; margin-bottom: 1.1rem; border-bottom: 1px solid var(--rule);
  font-size: 1rem;
}
nav.nav a, nav.nav span.off, nav.nav button.pin, nav.nav button.textsize, nav.nav button.back {
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
/* THE BACK BUTTON. The same button styling as the pin and the text size, and one state the others do
   not have: with nothing behind the reader in this tab it is DISABLED rather than hidden, so the row
   keeps its shape and the reader can see that the trail starts here. */
nav.nav button.back { cursor: pointer; }
nav.nav button.back svg { display: block; width: 1.15rem; height: 1.15rem; }
nav.nav button.back:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
nav.nav button.back:disabled { color: #c2cbd1; background: var(--wash); cursor: default; }
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
/* THE SAVE-FOR-OFFLINE BUTTON. Sized and shaped like the two beside it, with three things of its own.

   A PROGRESS BAR DRAWN ALONG ITS BOTTOM EDGE, because the reader asked for the progress to be visible
   where they pressed rather than in a place they would have to go and find. It is a child element
   whose width is the fraction done, so the bar is one style change per tick and no layout.

   TWO GLYPHS, ONE SHOWING. The arrow means "there is something to fetch", the tick means "this device
   has the book". Which one is visible follows data-state, which is the same attribute the colours
   follow, so the picture and the state cannot disagree.

   THE PENDING EDITION IS THE ONE THING THAT SHOUTS. It is the only state that a reader has to act on
   -- everything else is either fine or already happening -- so it is the only one that takes the
   warning colour, and it also carries a dot in the corner. Colour alone is not an answer: the dot
   gives it a shape for anyone who cannot tell the two apart. */
nav.nav button.offline { position: relative; cursor: pointer; overflow: hidden; }
nav.nav button.offline[hidden] { display: none; }
nav.nav button.offline .glyph { display: block; }
nav.nav button.offline .glyph svg { display: block; width: 1.15rem; height: 1.15rem; }
nav.nav button.offline .glyph.here { display: none; }
nav.nav button.offline[data-state="current"] .glyph.here { display: block; }
nav.nav button.offline[data-state="current"] .glyph.down { display: none; }
/* A SAVED BOOK WHOSE CHECK DID NOT ANSWER IS STILL A SAVED BOOK, so it keeps the tick and only loses
   the accent: the difference between "up to date" and "could not ask" is the difference between a
   claim and no claim, and it is carried by the colour and the words rather than by the picture. */
nav.nav button.offline[data-state="saved"] .glyph.here { display: block; }
nav.nav button.offline[data-state="saved"] .glyph.down { display: none; }
nav.nav button.offline[data-state="saved"] { color: var(--muted); }
nav.nav button.offline[data-state="current"] { border-color: var(--accent); color: var(--accent); }
nav.nav button.offline:hover { border-color: var(--accent); color: var(--accent); }
nav.nav button.offline .bar {
  position: absolute; left: 0; bottom: 0; height: 3px; width: 0; background: var(--accent);
}
nav.nav button.offline[data-state="busy"] { border-color: var(--accent); cursor: default; }
nav.nav button.offline[data-state="busy"] .bar { background: var(--accent); }
nav.nav button.offline[data-state="stale"] { border-color: var(--warn); color: var(--warn); background: var(--warn-wash); }
nav.nav button.offline[data-state="stale"] .bar { background: var(--warn); }
nav.nav button.offline[data-state="stale"]::after {
  content: ''; position: absolute; top: 4px; right: 4px; width: 7px; height: 7px;
  border-radius: 50%; background: var(--warn); box-shadow: 0 0 0 1.5px #fff;
}
nav.nav button.offline[data-state="failed"], nav.nav button.offline[data-state="offline"] { color: var(--muted); }
nav.nav button.offline:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* THE PANEL. It hangs under the button rather than being part of the row, so opening it cannot push
   the navigation links around. It is created by the downloader, not by the page, because a page with
   no script has nothing to say here -- and it is positioned from the button's own box each time it
   opens, so it follows the bar when the line wraps or the page is scrolled with the bar pinned. */
.dsq-dl {
  position: fixed; z-index: 40; width: min(23rem, calc(100vw - 1.6rem));
  padding: .8rem .9rem .75rem; border: 1px solid var(--rule); border-radius: 10px;
  background: #fff; color: var(--ink); box-shadow: 0 8px 26px rgba(20, 32, 40, .18);
  font-size: .9rem; line-height: 1.4;
}
.dsq-dl[hidden] { display: none; }
.dsq-dl p { margin: 0 0 .5rem; }
.dsq-dl .dsq-dl-head { font-weight: 600; }
.dsq-dl[data-state="stale"] .dsq-dl-head { color: var(--warn); }
.dsq-dl .dsq-dl-detail { color: var(--muted); overflow-wrap: anywhere; }
.dsq-dl .dsq-dl-detail:empty { display: none; }
.dsq-dl .dsq-dl-track {
  height: 7px; border-radius: 4px; background: var(--wash); overflow: hidden; margin: 0 0 .55rem;
}
.dsq-dl .dsq-dl-track[hidden] { display: none; }
.dsq-dl .dsq-dl-fill { display: block; height: 100%; width: 0; background: var(--accent); transition: width .18s linear; }
.dsq-dl[data-state="stale"] .dsq-dl-fill { background: var(--warn); }
.dsq-dl .dsq-dl-actions { display: flex; gap: .4rem; justify-content: flex-end; }
.dsq-dl .dsq-dl-actions button {
  padding: .3rem .7rem; border: 1px solid var(--rule); border-radius: 7px; background: #fff;
  color: var(--ink); font: inherit; font-weight: 600; cursor: pointer;
}
.dsq-dl .dsq-dl-actions button:hover { border-color: var(--accent); color: var(--accent); }
.dsq-dl .dsq-dl-actions button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.dsq-dl .dsq-dl-actions button.primary:hover { background: #1a5f78; color: #fff; }
@media (max-width: 30rem) {
  nav.nav button.offline .glyph svg { width: 1.05rem; height: 1.05rem; }
}
/* THE PINNED HEADER. position: sticky keeps the bar where it is in the flow and holds it at the top
   of the viewport from the moment the page scrolls past it, so nothing moves when it is turned on
   and nothing is hidden when it is off. The board is white and the shadow is what makes a bar
   sitting over text read as floating above it rather than as another line of the page.
   Nothing may trap scrolling between the bar and the viewport: no ancestor of the nav sets
   overflow, which is exactly the condition sticky needs.

   THE STATE LIVES ON THE ROOT ELEMENT, not on the bar. The choice is remembered from page to page,
   so it has to be applied by the script in the head -- before the bar exists to put a class on, and
   before the first paint, so a reader who pinned the bar does not watch it sit at the top of the
   page and then jump to the top of the screen. It is also one value in one place, which is what the
   button's aria-pressed and this rule both read. */
html.nav-pinned nav.nav {
  position: sticky; top: 0; z-index: 5;
  background: var(--paper);
  box-shadow: 0 .45rem .6rem -.45rem rgba(29, 38, 44, .45);
}
/* AN ANCHOR JUMP LANDS UNDER A PINNED BAR otherwise: the heading a reader jumps to (a same-page
   related call, a formation link, a glossary link) comes to rest behind the pinned navigation, so
   the thing they asked for is the thing they cannot see. The bar's own height is 2.3rem of buttons
   plus 1.4rem of padding; 3.9rem clears it with a little air. Guarded on the bar actually being
   pinned, so an unpinned page lands exactly where it always did. */
html.nav-pinned h2,
html.nav-pinned h3 { scroll-margin-top: 3.9rem; }
footer.page { margin-top: 3rem; padding-top: .9rem; border-top: 1px solid var(--rule);
              font-size: .82rem; color: var(--muted); }
/* The build stamp: the smallest type on the page, in square brackets at the end of the notice, and the
   only monospace in the reader's view. It is there to be read out on request, not to be noticed, so it
   takes the quietest colour the palette has. */
footer.page .stamp { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                     font-size: .76rem; color: #9aa7ae; letter-spacing: .04em; white-space: nowrap; }
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

/**
 * THE TWO ASSET URLS A PAGE NAMES, WITH THEIR CONTENT'S HASH IN THE QUERY.
 *
 * This is what makes a deploy take effect on the FIRST load for a reader who has the service worker.
 * Pages are network-first, so a returning reader always gets the newest HTML -- but everything else
 * is cache-first, keyed by URL, so `style.css` came out of the old cache and the new markup was
 * drawn with the old stylesheet: the new nav buttons rendered as grey boxes and the player controls
 * kept their old widths, while S3 and CloudFront were both serving the new file. A reload fixed it,
 * but a reload is not something a reader should have to know to do.
 *
 * Changing the URL changes the cache key, so the old cache cannot answer: the request misses, goes to
 * the network, and the page and its stylesheet are always the same build. The hash is of the file's
 * CONTENTS, so an unchanged asset keeps its URL and stays cached.
 *
 * They are assigned during the build, once the files are on disk (`writeFileSync` of style.css and
 * the copy of player.js), so the default value here only applies if a page is rendered before them.
 */
let cssUrl = 'style.css';
let playerUrl = 'assets/player.js';
let offlineUrl = 'assets/offline.js';

/**
 * THE BUILD STAMP, before the hash it will carry exists.
 *
 * A hash cannot contain itself: if the pages were written with the hash already in them, the hash would
 * have to be known first. So every page is written with this token where the stamp goes, the whole site
 * is hashed, and only then is the token replaced -- which is why an unchanged book always builds to the
 * same stamp, and why any change to any page, the stylesheet, the player or the dance data moves it.
 * The value stamped is the same one the service worker uses as its cache version, so a reader can be
 * asked which build they are looking at and the answer compared with what is deployed.
 *
 * The token has to survive the Markdown renderer, because the Introduction names the build in the text
 * of its correction link as well as in the footer. `inline()` escapes `& < > "` -- so an HTML comment
 * would arrive as escaped text and never be replaced -- and a comment on a line of its own is dropped
 * outright as a note to the tools. Braces pass through both the escaper and the link-label pattern
 * untouched, and read as a placeholder if a page is ever viewed without being stamped.
 */
const BUILD_TOKEN = '{{build-hash}}';
/** How much of the hash a reader sees. Seven characters: the short-revision length people know. */
const BUILD_SHORT = 7;

const PAGE = ({ title, cardTitle = null, description, rel, navHtml, body, script = '', canonical = null, jsonLd, ogImage = null, home = false }) => {
  // A page's own H1 plus the site name is right for a page you arrive at by reading. It is wrong for
  // the page people SHARE, which is named from outside the book rather than from inside it, so a
  // page may carry a `cardTitle` that is used verbatim.
  const full = cardTitle ?? `${title} — Dancing Squared`;
  return `<!doctype html>
<html lang="en"${home ? ' data-book-home' : ''}>
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
<link rel="stylesheet" href="${rel}${cssUrl}">
<script>
// THE READER'S TWO CHOICES, APPLIED BEFORE THE FIRST PAINT: the text size, and whether the
// navigation bar is pinned. A reader who picked large text should not watch every page arrive small
// and grow, and one who pinned the bar should not watch it sit at the top of the page and then jump
// to the top of the screen. Both are put on the ROOT element rather than on the things they affect,
// so they can be set here -- before the bar exists to carry a class.
//
// Both are remembered in localStorage under this origin, so they carry from page to page. A browser
// that refuses storage (private mode, a locked-down profile) simply gets the defaults, and nothing
// else on the page depends on this having worked.
try {
  if (localStorage.getItem('dsq-text-size') === 'large') {
    document.documentElement.classList.add('text-large');
  }
  if (localStorage.getItem('dsq-nav-pinned') === 'yes') {
    document.documentElement.classList.add('nav-pinned');
  }
} catch (e) {}
</script>
<script>
// WHERE THE READER LEFT OFF, and it is a different question from the back-trail above. The trail is
// where this TAB has been, kept in sessionStorage and dropped when the tab closes; this is the last
// page read, kept in localStorage because "at a later date" is the whole point of it.
//
// IT RESOLVES AT THE FRONT DOOR ONLY, and only when the reader arrived from outside the book. Both
// limits are load-bearing. Redirecting on every page would hijack every link into the book -- a
// shared call page, a search result, the glossary -- and redirecting on an internal referrer would
// make the front door unreachable from inside the book, since the nav's own ◀/▶ walk over it, as does
// any link back to the introduction. A link from inside the book gives itself away in the referrer,
// which is what is checked. (The Home button is a fourth case again: it leaves the book for the
// Awltux Utilities hub, which is a different page served by the host, not this book's first page.)
//
// A hash or a query on the front door is a REQUEST for the front door -- a shared link, or an anchor
// someone meant to land on -- and is honoured as one. The book's own directory is taken from this
// page's URL, which is only valid because this IS the front door: that is the one page this script
// can redirect from.
try {
  var here = location.pathname + location.search + location.hash;
  var KEY = 'dsq-last-page';
  var last = localStorage.getItem(KEY);
  if (document.documentElement.hasAttribute('data-book-home')) {
    var root = location.pathname.replace(/[^/]*$/, '');
    var fromInside = document.referrer.indexOf(location.origin) === 0 && document.referrer !== '';
    var asked = location.hash || location.search;
    if (last && last.indexOf(root) === 0 && last !== here && !fromInside && !asked) {
      location.replace(last);
    } else {
      // Not resuming, so this visit IS where the reader is: record it, which also clears a stale
      // entry from a path the book no longer lives at.
      localStorage.setItem(KEY, here);
    }
  } else {
    localStorage.setItem(KEY, here);
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
<a href="${rel}08-reference/sources-and-attribution.html">sources and attribution</a>. <span class="stamp" title="The content hash of this build. The offline cache is keyed to the same value.">[${BUILD_TOKEN}]</span></p>
</footer>
</article>
</main>${script}
<script>
// THE PIN. Off on every page load: the reader chooses it for the page in front of them. All this
// does is move one class and mirror it into aria-pressed -- the sticking itself is CSS, so the
// control cannot leave the bar in a state the stylesheet does not describe.
(function () {
  var root = document.documentElement;
  var bar = document.querySelector('nav.nav');
  // THE PIN. The head script has already applied the reader's last choice to the root element and
  // the stylesheet has already drawn the page with it, so this only reads that state back into the
  // button and writes a new choice to both -- the sticking itself is CSS, so the control cannot
  // leave the bar in a state the stylesheet does not describe.
  var pin = bar && bar.querySelector('button.pin');
  if (pin) {
    var showPin = function (on) {
      root.classList.toggle('nav-pinned', on);
      pin.setAttribute('aria-pressed', on ? 'true' : 'false');
      pin.title = on
        ? 'Unpin the navigation bar and let it scroll away'
        : 'Pin the navigation bar to the top of the screen';
    };
    // Reflecting the state is not the same as choosing it: a page load shows what was chosen and
    // writes nothing, so a reader who never touches this control never has an opinion stored for
    // them.
    showPin(root.classList.contains('nav-pinned'));
    pin.addEventListener('click', function () {
      var on = !root.classList.contains('nav-pinned');
      showPin(on);
      try {
        localStorage.setItem('dsq-nav-pinned', on ? 'yes' : 'no');
      } catch (e) {}
    });
  }
  // THE BACK BUTTON. It retraces the reader's own path, which the bar cannot know from the reading
  // order -- so the path is remembered as they walk it, in sessionStorage, which is per TAB and
  // cleared when the tab closes. Nothing here is a preference to keep: this is where the reader has
  // been, not what they like.
  //
  // PUSH ON ARRIVAL, POP ON PRESS. Every page a reader lands on is pushed, unless it is already on
  // top (a reload, or the same page reached again), so the stack is exactly the trail. Pressing Back
  // drops the page being left and goes to the one below, which is what makes repeated presses retrace
  // the whole path rather than bounce between two pages. A reader who goes back and then follows a new
  // link pushes onto the shortened trail, which is the same thing every browser does with its own
  // history: what was ahead is gone.
  //
  // The trail is capped, so a long session in one tab cannot grow it without limit.
  (function () {
    var bar = document.querySelector('nav.nav');
    var back = bar && bar.querySelector('button.back');
    if (!back) return;
    var KEY = 'dsq-path';
    var CAP = 60;
    // THE BOOK'S OWN DIRECTORY, taken from the CONTENTS link: it is the one destination every page
    // carries at the book's root. NOT from the Home button, which leaves the book for the Awltux
    // Utilities hub at the host root -- reading the root from that gave the host's own root, which
    // accepts every path on the host. Entries outside the book are dropped, so a trail cannot lead
    // off it or outlive the book moving to another path.
    var contents = bar.querySelector('a[href$="contents.html"]');
    var root = contents
      ? new URL(contents.getAttribute('href'), location.href).pathname.replace(/[^/]*$/, '')
      : '/';
    var inBook = function (u) { return u.indexOf(root) === 0; };
    var read = function () {
      try {
        var raw = JSON.parse(sessionStorage.getItem(KEY) || '[]');
        return Array.isArray(raw) ? raw.filter(function (u) { return typeof u === 'string' && inBook(u); }) : [];
      } catch (e) {
        return [];
      }
    };
    var write = function (path) {
      try {
        sessionStorage.setItem(KEY, JSON.stringify(path.slice(-CAP)));
      } catch (e) {}
    };
    var here = location.pathname + location.search;
    var path = read();
    if (inBook(here) && path[path.length - 1] !== here) {
      path.push(here);
      write(path);
    }
    var showState = function () {
      var on = path.length > 1;
      back.disabled = !on;
      back.title = on ? 'Back to the page you came from' : 'Nothing behind you yet in this tab';
    };
    showState();
    back.addEventListener('click', function () {
      var trail = read();
      if (trail.length < 2) {
        showState();
        return;
      }
      trail.pop();
      var target = trail[trail.length - 1];
      write(trail);
      location.href = target;
    });
  })();
  // THE TEXT SIZE. As above: read the state back into the button, write a new choice to both. Small
  // is the absence of the class, so the default page has one thing less to go wrong.
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
<script defer data-dsq-offline src="${rel}${offlineUrl}" data-root="${rel}" data-manifest="download.json"></script>
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
    navIcon('size') +
    '</button>'
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
    navIcon('pin') +
    '</button>'
  );
}

/**
 * The Back button, at the left of the nav row.
 *
 * NOT A LINK, because it does not go to a fixed place: it retraces the reader's own path. Following
 * a link from the glossary to a call and then wanting the glossary back is the commonest movement in
 * this book, and [◀] is the wrong answer -- it is the PREVIOUS PAGE IN THE READING ORDER, which is
 * rarely where the reader came from. The browser's own Back button does the right thing, but on an
 * installed PWA there is no browser chrome, and inside the page the bar is the only navigation there is.
 *
 * The glyph is a return arrow rather than a browser-style left arrow, so it is not read as "previous
 * page" beside the two arrows that mean exactly that.
 */
function backButton() {
  return (
    '<button type="button" class="back" aria-label="Back to the page you came from" ' +
    'title="Back to the page you came from">' +
    navIcon('back') +
    '</button>'
  );
}

/**
 * The Save-for-offline button, first in the nav's tool group.
 *
 * IT STARTS HIDDEN, AND STAYS HIDDEN IF IT CANNOT WORK. `assets/offline.js` reveals it once it has
 * looked at the device and asked the server what the current edition is -- so the reader never sees a
 * state that was guessed, and a browser without Cache Storage (`file://`, an old engine, a locked-down
 * profile) shows no control at all rather than one that fails when pressed. That is the same rule the
 * Pin follows two functions down, and the reason it is hidden rather than disabled: there is nothing
 * a reader could do about it.
 *
 * TWO GLYPHS, ONE VISIBLE, chosen by `data-state` in the stylesheet: an arrow into a tray while there
 * is something to fetch, and a tick once the book is saved. The bar drawn along the bottom edge is
 * the progress bar, and it carries the progressbar role rather than the button: a button that also
 * announced itself as a progress bar would be announcing two things at once, and the one a reader
 * needs from a button is that it can be pressed.
 *
 * A NOTE ON WHY THE WORDS ARE NOT HERE. The nav is a row of icons at every width, and the sentence
 * that explains the state lives in the panel this button opens. The button itself carries the state in
 * `aria-label` and `title`, which is where a reader looks when they hover or tab to it.
 */
function offlineButton() {
  return (
    '<button type="button" class="offline" data-state="checking" hidden ' +
    'aria-label="Checking for a saved copy of this book">' +
    `<span class="glyph down">${navIcon('download')}</span>` +
    `<span class="glyph here">${navIcon('saved')}</span>` +
    '<span class="bar" role="progressbar" aria-label="Saving the book" aria-valuemin="0" aria-valuemax="100" ' +
    'aria-valuenow="0"></span>' +
    '</button>'
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
  // The Home button leads the row, then Back -- the reader's own trail -- then the page step, the
  // contents and the next page. The reader's tools (saving the book for offline, text size and the
  // pin) are grouped last, so they sit at the top right. The offline button leads that group because
  // it is the only one that changes what the book IS on this device rather than how it looks.
  return (
    `<nav class="nav">${homeButton()}${backButton()}${html}` +
    `<span class="nav-tools">${offlineButton()}${textSizeButton()}${pinButton()}</span>${note}</nav>`
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
  // The start formations and the calls the manual lists from each, as ONE JSON attribute rather than
  // a fistful of data attributes: every formation carries its own list of calls (Circle Left, Circle
  // Left 1/8, 1/2, 3/4, Circle Right, ... for a ring), and the player builds both its choosers from
  // this. Present whenever the manual's table has a start for the call -- a single formation can
  // still list eight calls, so it is not conditional on there being more than one formation.
  const formations = meta.starts?.length
    ? ` data-formations="${esc(
        JSON.stringify(
          meta.starts.map((s) => ({
            label: s.label,
            calls: (s.calls ?? []).map((c) => [c.title, c.file, c.tamIndex, c.view?.scale, c.view?.units, c.beats]),
          })),
        ),
      )}"`
    : '';
  return (
    `<div class="dsq-player" data-file="${meta.file}" data-tam="${meta.tamIndex ?? 0}" ` +
    `data-scale="${meta.view?.scale ?? 20}" data-units="${meta.view?.units ?? 6}" ` +
    `data-beats="${meta.beats}" data-size="340"${formations}></div>`
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

  // The annotated diagrams (`book/diagrams/`, SVG, because they carry words). ONLY THE ONES A PAGE
  // USES are copied, the same rule the call authorings follow: `diagrams/` also holds three position
  // pictures that no page references yet, and shipping those would put files in the deploy and in the
  // reader's cache that nothing can reach. Which ones are used is not guessed -- the page loop below
  // records every `diagrams/` source it renders, and this copies exactly that set.
  const usedDiagrams = new Set();

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
  // The offline downloader travels with every page, unlike the player: the front door is where a
  // reader decides to save the book, and the one page that must never be missing it is the one they
  // arrive on.
  cpSync(join(BOOK, 'assets', 'offline.js'), join(SITE, 'assets', 'offline.js'));
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
      for (const s of f.starts ?? []) for (const c of s.calls ?? []) needed.set(c.file, true);
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
  // Both files are on disk now, so the URLs the pages will name can carry their contents' hash.
  const contentHash = (p) =>
    createHash('sha256').update(readFileSync(join(SITE, p))).digest('hex').slice(0, 10);
  cssUrl = `style.css?v=${contentHash('style.css')}`;
  playerUrl = `assets/player.js?v=${contentHash('assets/player.js')}`;
  offlineUrl = `assets/offline.js?v=${contentHash('assets/offline.js')}`;

  let animated = 0;
  const injected = new Set();
  const layout = [];
  /** Diagrams a page asked for that are not on disk; reported with the other problems after the loop. */
  const diagramProblems = [];
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

    // Every `diagrams/` picture this page renders. Collecting them from the rendered body rather than
    // by scanning the Markdown means the set is whatever the reader is actually sent.
    for (const m of body.matchAll(/src="[^"]*?diagrams\/([^"]+)"/g)) usedDiagrams.add(m[1]);

    // One `### Animation` heading per call card, or a player lands on the wrong call.
    if (headings !== ids.length) {
      layout.push(`${page.path}: ${headings} animation heading(s) for ${ids.length} call card(s)`);    }

    const rel = page.path.includes('/') ? '../' : '';
    // The player module is added ONLY to the pages that have one: it pulls in the whole engine,
    // and no reader should download 1.5 MB of it to read a glossary.
    const hasPlayerHere = body.includes('dsq-player');
    if (hasPlayerHere) hasPlayer = true;
    const script = hasPlayerHere ? `\n<script type="module" src="${rel}${playerUrl}"></script>` : '';
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
      // The front door is the one page the resume script may redirect FROM, so it has to say which
      // page it is. `index.md` is the introduction and the landing page, and the only page the site
      // is ever entered at cold.
      home: page.path === 'index.md',
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

  // Copy the annotated diagrams those pages asked for. A page that names one that does not exist is a
  // gap the reader would see as a broken picture, so it is recorded here and fails the build with the
  // other problems rather than being skipped.
  if (usedDiagrams.size) {
    mkdirSync(join(SITE, 'diagrams'), { recursive: true });
    for (const name of [...usedDiagrams].sort()) {
      const src = join(BOOK, 'diagrams', name);
      if (!existsSync(src)) {
        diagramProblems.push(`diagrams/${name} is used by a page but is not in book/diagrams`);
        continue;
      }
      cpSync(src, join(SITE, 'diagrams', name));
    }
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
  // The nav bar's icons travel to the site as files as well, because a page that describes the bar
  // shows the same artwork rather than a lookalike: the buttons INLINE these files, and the pages
  // reference them. They are copied, never redrawn, so the two cannot drift apart. `navIcon` reads
  // them from `book/icons/`, which is also where the gate looks for the images the pages name.
  for (const name of ['home', 'back', 'size', 'pin']) {
    writeFileSync(join(SITE, 'icons', `nav-${name}.svg`), `${navIcon(name)}\n`, 'utf8');
  }

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
  writeFileSync(join(SITE, 'offline.html'), offlineHtml({ css: cssUrl }), 'utf8');

  // ---- WHAT THE BOOK IS MADE OF, AND WHICH BUILD IT IS
  //
  // THE LIST IS THE WHOLE SITE, not a shell of it. The old precache held only what a reader needed to
  // OPEN the book, and left the figures and animations -- the bulk of it -- to be cached if and when
  // they were viewed. That was the whole complaint: a reader who had not opened every call page held a
  // book with holes in it, and one updating from a previous edition held a book whose pages were new
  // and whose pictures were old. `download.json` names every file, and the reader's download fetches
  // all of it in one pass, so a saved book is the book.
  //
  // TWO FILES ARE NOT IN THE LIST, and both for the same reason: they are derived from it.
  //   - `download.json` cannot describe itself.
  //   - `sw.js` carries no content any more, and including it would make the version depend on a file
  //     that does not change when the content does.
  const DERIVED = new Set(['download.json', 'sw.js']);
  const siteFiles = listFiles(SITE).filter((f) => !DERIVED.has(f)).sort();

  // THE VERSION IS A HASH OF EVERY BYTE THE READER WILL HOLD. It names the store the download fills,
  // so it has to move whenever any part of the book moves; a version that lagged its contents would
  // let an update be skipped, or serve last edition's page beside this edition's stylesheet, which is
  // the mixture this whole change exists to make impossible.
  const digest = createHash('sha256');
  for (const entry of siteFiles) {
    digest.update(entry);
    digest.update(readFileSync(join(SITE, entry)));
  }
  const version = `v${digest.digest('hex').slice(0, 12)}`;
  writeFileSync(join(SITE, 'sw.js'), serviceWorkerSource(), 'utf8');

  // ---- verify the site rather than assume it: every internal link and image must resolve
  const problems = [];

  // ---- stamp every page footer with the short hash of the build
  //
  // This runs AFTER the cache version above, deliberately: that version is the hash of the pages as they
  // were written, still carrying the token, so the stamp a reader sees is not part of its own hash and a
  // rebuild of unchanged content stamps the same value every time. Stamping before the link check means
  // the verified site is the site that ships.
  const buildHash = version.replace(/^v/, '');
  const stamp = buildHash.slice(0, BUILD_SHORT);
  // The stamp must actually land. A page rendered without the token would keep a placeholder where the
  // hash belongs and nothing else here would notice, which is the silent-failure shape this file is
  // built to refuse.
  let stamped = 0;
  for (const page of pages) {
    const file = join(SITE, page.path.replace(/\.md$/, '.html'));
    const html = readFileSync(file, 'utf8');
    if (!html.includes(BUILD_TOKEN)) {
      problems.push(`${page.path.replace(/\.md$/, '.html')}: footer carries no build stamp token`);
      continue;
    }
    writeFileSync(file, html.replaceAll(BUILD_TOKEN, stamp), 'utf8');
    stamped++;
  }

  // ---- the list of contents, written LAST and measured from the files as they now are
  //
  // AFTER THE STAMP, because the stamp is bytes: a size recorded before it would be a few bytes short
  // of what the reader actually fetches, and a progress bar measured against wrong totals is a bar
  // that ends early or never reaches the end. The version was taken from the UNSTAMPED pages on
  // purpose (a hash cannot contain itself), so the sizes here and the version above are read at
  // different moments and that is correct rather than an oversight: the size is a fact about a file,
  // the version is a fact about the content.
  const manifestFiles = [];
  for (const entry of siteFiles) manifestFiles.push({ path: entry, size: statSync(join(SITE, entry)).size });
  const manifest = {
    version,
    total: manifestFiles.reduce((a, f) => a + f.size, 0),
    count: manifestFiles.length,
    files: manifestFiles,
  };
  writeFileSync(join(SITE, 'download.json'), `${JSON.stringify(manifest, null, 1)}\n`, 'utf8');

  // ---- THE LIST IS THE SITE. A manifest that named a subset would silently ship a book with holes;
  // ---- a file the reader is never told about is a page that fails only when they are offline, which
  // ---- is the worst possible moment to find out. So the list is re-derived from disk and compared.
  const listed = new Set(manifestFiles.map((f) => f.path));
  for (const entry of listFiles(SITE)) {
    if (DERIVED.has(entry)) continue;
    if (!listed.has(entry)) problems.push(`download.json does not list ${entry}`);
  }
  for (const f of manifestFiles) {
    if (!existsSync(join(SITE, f.path))) problems.push(`download.json lists ${f.path}, which is not on disk`);
    else if (statSync(join(SITE, f.path)).size !== f.size) problems.push(`download.json has the wrong size for ${f.path}`);
  }
  // THE DOWNLOADER MUST BE ON EVERY PAGE, and this is the check that says so rather than trusting a
  // template. A page without it is a page whose reader cannot save the book -- and the manifest would
  // still list the page, so nothing else here would notice.
  for (const page of pages) {
    const file = join(SITE, page.path.replace(/\.md$/, '.html'));
    if (!readFileSync(file, 'utf8').includes('data-dsq-offline')) {
      problems.push(`${page.path.replace(/\.md$/, '.html')}: no downloader, so this page cannot save the book`);
    }
  }
  const swSource = readFileSync(join(SITE, 'sw.js'), 'utf8');
  if (/\bcaches\.open\([^)]*\)[\s\S]{0,80}?\.put\(/.test(swSource)) {
    problems.push('sw.js writes to a cache, which is how a reader ends up with a mixture of two editions');
  }
  if (/addAll|precache/i.test(swSource)) {
    problems.push('sw.js precaches, which assembles the book in stages');
  }

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
        // A QUERY IS NOT PART OF THE PATH ON DISK. The stylesheet and the player are named with a
        // content hash in the query (`style.css?v=8562dd85ba`), which is what makes a deploy take
        // effect on the first load for a reader with a warm service worker -- so the fragment and the
        // query are both stripped before the file is looked for.
        const [path] = target.split(/[?#]/);
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
  for (const d of diagramProblems) problems.push(d);

  const htmlCount = pages.length;
  console.log(`${htmlCount} pages -> ${SITE}`);
  console.log(`${animated} call pages carry an animation; ${checked} internal links checked`);
  if (problems.length) {
    for (const p of problems.slice(0, 12)) console.error(`  ${p}`);
    console.error(`${problems.length} problem(s) in the built site.`);
    return 1;
  }
  console.log('every link and image in the site resolves.');
  // The build ends by naming itself. Everything above is about the content; this is the one line that
  // answers "which build is deployed?", and it is the same string stamped into the page footers. The
  // version names the store a reader's download fills, so it is the number to compare when a reader
  // says they are still on the previous edition.
  console.log(`build ${stamp} -- in every page footer (${stamped} pages).`);
  console.log(
    `${version} is the offline edition: ${manifest.count} files, ${(manifest.total / 1048576).toFixed(1)} MB, listed in download.json.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  process.exit(main());
}

