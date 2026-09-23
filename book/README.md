<!-- This file is the build/workspace guide, not a page of the book. It is excluded from the
     reading order (book/tools/make-nav.mjs EXCLUDED) and is not linked from the book. -->

# Dancing Squared — a beginner's book for Mainstream Square Dancing

A practical, plain-language introduction to the **CALLERLAB Mainstream Dance Program**, written
for someone who has never square danced and who wants to walk into a hall and join in.

Every call here is the March 2026 program. Where an older name or a different old usage still
circulates in halls, the page says so rather than pretending it does not exist.

## Read it in this order

| | |
|---|---|
| **[index.md](index.md)** | the introduction — what the book is, who it is for, and the three ways to read it |
| **[how-this-book-is-organised.md](how-this-book-is-organised.md)** | the kinds of page, and the call card |
| **[contents.md](contents.md)** | the map, and three reading paths (dancer / teacher / first-timer) |
| **[conventions.md](conventions.md)** | how the pages are laid out, what the pictures show, and how to read them |
| **[01-start/](01-start/what-is-square-dancing.md)** | what square dancing is, the square itself, and how a call is put together |
| **[02-language/](02-language/naming-the-dancers.md)** | the words: who is who, what a formation is, how people are named |
| **[03-rules/](03-rules/passing-rule.md)** | the conventions that settle what a call means when it is ambiguous |
| **[04-calls/](04-calls/m01-circle-family.md)** | the call reference — one file per teaching unit |
| **[05-course/](05-course/course-overview.md)** | the taught path: the official teaching order, in classes |
| **[06-practice/](06-practice/how-to-practise.md)** | drills, how to dance a whole tip, and where the music comes from |
| **[07-plus/](07-plus/where-mainstream-leads.md)** | where Mainstream leads next |
| **[08-reference/](08-reference/glossary.md)** | glossary, indexes, sources and attribution |

## What this book is built from

Two authoritative documents, and nothing else:

| Document | What it is used for |
|---|---|
| CALLERLAB *Mainstream Dance Program Definitions*, revised **29 March 2026** | membership, teaching order, definitions, terminology, timing |
| CALLERLAB *Plus Program Definitions*, revised **25 August 2026** | the Plus appendix, and the evidence for what left Mainstream |

The **animations are generated from this repository's own square-dance engine**, not drawn by hand:
each is an animated GIF produced by `book/tools/make-animations.mjs`, and on the site the same call is
*played* by that engine in the browser. Re-running the tool reproduces them byte-for-byte.

CALLERLAB material is quoted only in short, attributed extracts; the definitions are the
copyright of CALLERLAB Inc. and are reproduced under the permission printed in
[08-reference/sources-and-attribution.md](08-reference/sources-and-attribution.md).

## The online edition, with animated calls

```bash
npm run build:book     # animations, reference tables, navigation, then the site
npm run serve:book     # http://127.0.0.1:8099
```

That writes `book/dancingsquared_book/` — one HTML page per section, a stylesheet, and an
**interactive player** on every call page.

**Serve it; do not open `book/dancingsquared_book/index.html` from disk.** The player is an ES module,
and browsers refuse to load ES modules over `file:`, so opening the built page directly leaves every
call page with a player-shaped hole. `serve:book` exists for that reason, and because a phone on the
same network can then read the book — which is how you would actually use it at a dance. The
page-detects this and prints an explanation in place of the player rather than showing an empty box.

### The player, and why the GIF was dropped

**ONE ANIMATION PER CALL.** The page used to carry two: the player, and a GIF of the same motion
underneath it. The GIF had no controls, so it read as a second and worse copy of the call rather than
as a second view of it. It is gone from the pages, and `make-animations.mjs` no longer encodes one by
default — `--gifs` still produces them if a shareable file is ever wanted.

**A GIF cannot have controls anyway.** The format has no timeline and no interactivity: it starts when
it loads, runs at a pace baked into the file, and stops at the end. If you want pause, play, scrub and
"jump to the starting or ending setup", the animation has to be driven by something that can be asked
for a state — and the engine can.

So the call pages carry a **canvas player driven by the engine in the browser**, the same way the
POC's Browse mode works: it loads `moves.xml`, `formations.xml` and the call's own `<tam>`, builds the
call bundle, and evaluates `allPoses(bundle, beat)` at whatever beat you choose.

**A call can be shown from more than one start formation.** The corpus usually carries several
authorings of a call, one per formation it can start from — 71 of 78 cards have more than one, and 63
build from *different* formations (median 4, up to 36 for Cast Off Three-Quarters, whose extras
include `3 and 1 Lines #1…#8`). Offering all of them would be unusable, so the list is
`tools/start-formations.json`: **hand-curated from the manual's own "Starting formations:" line**,
keeping only entries the corpus can actually animate. It is curated rather than derived because the
manual's PDF text extract cannot be section-associated reliably — an automatic pass offered
California Twirl "Lines Facing Out" where the manual says *Normal Couple only*, and read the Centers
In card out of the *Centers and Ends* terminology block.

**Every call card has an entry**, so a card with nothing verified yet is scaffolding rather than an
omission — adding one later is a data edit, not a change to the tooling. Start labels for the cards
that are not yet curated come from the card's own **At a glance** "Starting formation" cell: that is
the manual's list already transcribed and reviewed, one card at a time, so it cannot cross-contaminate
a neighbouring call. The manual's PDF extract was measured and rejected for this — fed the extract, a
parse gave Pass Thru eleven labels belonging to four other calls, made "Man" and "Woman" out of Swing's
"(Man and Woman)", and offered California Twirl "Lines Facing Out" where the manual says *Normal Couple
only*. The shape is:

```jsonc
"m01a": {
  "name": "Circle Left/Right (1/4, 1/2, 3/4, Full)",   // the manual's title: m01a says nothing
  "citation": "Mainstream Dance Program Definitions, revised 29 March 2026, page 24: …",
  "starts": {                                           // keyed by the MANUAL's wording
    "Static Square": {
      "formation": "Static Square",                     // the name that wording maps to
      "calls": [{ "file": "ms/circle.xml", "tam_xml_queries": [ /* … */ ] }]
    },
    "Facing Lines": { "formation": "Lines", "calls": [] }   // listed, but nothing can animate it
  }
}
```

**Every entry carries a citation**, taken from the `Manual source` line the card's own call page
already ends with — `<title>, revised <date>, page N` — and then what the entry rests on: a verified
quotation for a curated card, or "start labels transcribed from this card's At a glance table" for
scaffolding. The page number is **read from the book, not derived from the extract**: the extract's
page markers do not map cleanly to definitions (Veer Left's heading follows the p.65 marker, Pass
Thru's follows p.44 while the book cites p.45), so the reviewed value the reader already sees wins,
and the two stay consistent. An earlier draft of this file typed the pages from memory and had Veer
Left as p.66 and Allemande Left as p.11 — both wrong; it is p.65 and p.19.

A `tam_xml_queries` entry matches the first `<tam>` whose named attributes all match, and **must name
`from` or `formation`** — `title` alone spans every formation the authoring was written for and would
pin nothing. `title` is matched exactly where the table gives it, and the table lists every instance
one manual title covers (`Circle Left`, `Circle Left 1/8`, … `Circle Right 3/4`: ten tams).

**The first start defines the animation the page shows.** The book's terminology is the manual's, so no
start is ever labelled with the engine's own name for an authoring: where the manual's first start is
not the authoring the corpus happened to list first, the page plays the manual's first. That moved M4b
Allemande Left off a four-dancer Facing Couples authoring and onto the manual's Case 1 opener, Eight
Chain Thru, and M36 Extend onto 1/4 Tag. The call index's `Starts from` column and the formation index
follow automatically, because both are generated from the same `from`. A label the corpus cannot
animate is dropped from the player, but stays in the table for the next person to fill in. Every
resolved start is loaded and pose-checked by `make-animations.mjs --verify`, because a selector entry
that throws in the browser is invisible to a link check.

Two states are worth telling apart when filling the table in. A start with a `formation` and queries
is wired up and playable — **64 of the 118 labels** here. A start with **`"calls": []`** is a label
waiting for someone to find the authoring — the other **54**. And **5 cards have no labels at all**
yet, because their card's wording is prose rather than a list ("Promenade or any position after a
U-Turn Back"), so a comma split would have produced a formation that does not exist; `starts` is left
`{}` for those rather than filled with guesses.

Scaffolded labels are wired **automatically, and strictly**: a tam counts only when the label and its
`from` (or `formation`) are equal after normalising case, plurals, handedness and *arrangement* words
(Compact, Normal, General), and only when the tam's `title` belongs to that call. Substring matching is
deliberately not used — it is what once offered California Twirl a start the manual forbids — and
`Tidal`/`Inverted` are **not** normalised away, because they name different formations: treating them
as qualifiers let the label "Line" match a tidal line of eight.

| Control | What it does |
|---|---|
| **⏮  ⏭** | jump to the starting setup, or the ending setup |
| **⏪  ⏩** | step a quarter of a beat at a time |
| **▶ / ⏸** | play or pause |
| **slider** | scrub anywhere in the call; the readout shows the beat |
| **speed** | 1/4, 1/2 or full tempo — it opens at **1/2**, because full calling tempo is too fast to study a call from |

Because poses are asked for directly rather than interpolated between stored frames, scrubbing is
**exact**.

**Which player goes on which page is computed, not inferred.** The builder takes animation ids from the
teaching order (`call-map.json`), one slot per call card, with a `null` for a card that has no
animation, and injects the player at each `### Animation` heading in turn. Pairing ids with headings by
counting references in the Markdown was wrong for unit M4, whose card (a) has no animation and whose
card (b) does: the one player landed under the wrong call. `check-links.mjs` now gates the heading
count against the card count, so the pairing cannot silently rot again.

The **dance library is only shipped to the pages that need it** (`book/dancingsquared_book/lib/`, 729 KB
of runtime `.js` — the `.d.ts` declarations and `.map` source maps in `engine/dist` are stripped, since
they are 786 KB a browser never reads — and no external imports, so it runs as a plain ES module). The
glossary does not make you download it. It is published
as `lib/` and not `engine/` because the site is read by dancers: no path a reader can see should
describe how the book is made.

**The marker is one grid square wide, measured in board units, not pixels.** A fixed pixel radius was
the reason the dancers overlapped in the waves: the board puts dancers two units apart in a squared set
or a wave, but only one unit apart in a tidal wave and a promenade, and because a call that travels
far is fitted to a wider floor, a fixed radius also grew exactly when the view zoomed out. `MARKER_UNITS
= 0.48` in `make-animations.mjs`, `player.js` and `make-formations.mjs` sizes the dancer as a square of
floor at every zoom — a hair under a full square, so a tidal wave's one-unit spacing still reads as two
dancers.

**The facing mark is ink, and is drawn in its own pass.** Two separate corrections, both from looking
at the output:

- it was the dancer's own colour, so the only part that showed was a small bump over a pale floor —
  close to invisible. It is now near-black, and as wide as the body where it leaves it, so it reads as
  a beak. The tip is 0.77 of a unit from the centre, against a 2-unit wave spacing, so it cannot span
  the gap to a neighbour.
- it was drawn per dancer, so dancer N's nose was painted **after** dancer N−1's body and landed on top
  of it wherever the two passed close — they looked as if they were stabbing one another. Now **every
  nose is drawn first and every body after**, so an intruding nose is covered by the body it intrudes
  on, and no nose can cover a number.

The handhold trim uses the same radius, so a handhold is only ever drawn across the gap.

Nothing here can write an image, so the writers are written from scratch:

| Tool | What it does |
|---|---|
| `book/assets/player.js` | the browser player: canvas, controls, engine, the marker geometry |
| `book/tools/lib/gif.mjs` | GIF89a encoder and decoder — used only by `make-animations.mjs --gifs`, and to read back the GIFs if any are written |
| `book/tools/lib/raster.mjs` | the rasteriser: flat shapes, a hand-written 3×5 bitmap for the dancer numbers, and a PNG dump for looking at a frame |
| `book/tools/lib/markdown.mjs` | Markdown → HTML, the subset this book uses: headings, paragraphs, lists, tables, images, `> ` quotations (line by line, as the call pages stack them) and `> [!WARNING]` callouts (reflowed as prose, styled as the book's own voice rather than a quotation). An **external** link opens in a new tab — the site is installable and is read in its own window, where there is no back button to return from GitHub with |
| `book/tools/build-site.mjs` | the site: pages, navigation buttons, stylesheet, the player's assets, and checks that every link, image and player asset resolves |
| `book/site-base.txt` | the address the site is published at, read by `build-site.mjs` for every canonical, `og:url`, `og:image`, `robots.txt` and `sitemap.xml` |

That is not a preference. This machine has no image toolchain — no ImageMagick, no ffmpeg, no python
image module, no node package — and **Chromium cannot start in the sandbox**: its Mojo IPC needs named
pipes and dies with `platform_channel.cc:108 Check failed: Access is denied`. So no picture could be
made with a browser. Because a renderer that runs without error is not evidence that a board LOOKS
right, `make-animations.mjs --preview=<id>` writes a PNG frame that can actually be looked at — which is
how the overlapping markers were found and the one-square width confirmed.

The site is build output and is gitignored, like `dist/`. Remove the `dancingsquared_book/` line from
`book/.gitignore` if you would rather commit the built site for publishing.

### Stand-alone app capability

The site is a **PWA**: `manifest.webmanifest`, a service worker, and a set of drawn icons.

- **Installable** — "Add to Home Screen" on a phone or "Install" in a desktop browser opens it
  full-screen, with no browser chrome, like an app. The installed app is called **Dancing² Mainstream**
  (`APP_NAME` in `build-site.mjs`): that is the manifest's `short_name`, which is what an Android
  launcher and an iOS home screen label, and it is short on purpose — a launcher needs a name, not the
  book's descriptive title. The manifest's long `name`, and so the install dialog and the Android app-info
  page, keep the full descriptive title.
- **Works offline** — the service worker precaches what a reader needs to *open* the book: all 107
  pages, the stylesheet, the player, the dance library, the dance data and the icons (255 entries).
  The whole book is playable offline; only the icons are fetched lazily.
- **Pages are network-first, assets cache-first.** A reader online gets the newest build; a reader
  offline gets the cached page, or `offline.html`, which explains itself rather than failing.
- The cache is versioned by a hash of its own contents, so a new build replaces the old one instead
  of serving a mixture.
- **The pages name their own build.** Every footer ends with the build's short content hash in square
  brackets, and the Introduction's correction link asks the reader to mention
  `book_build_hash=<hash>` in the issue — so a bug report identifies the build it came from without
  anyone having to ask. It is stamped at the END of the
  build, after the hash is taken, because a hash cannot contain itself: the pages are written with
  `{{build-hash}}`, the whole site is hashed, and only then is the token replaced. So an unchanged book
  always builds to the same stamp, any change to any page or asset moves it, and "which build is this?"
  can be answered from the page rather than from the deploy log. One consequence worth knowing: the
  token is visible in `index.md` when the raw Markdown is read on GitHub, the one place it is not
  substituted.

Service workers need a secure context, so they run over `https:` or `localhost` — **not** from
`file://`. Opened from the filesystem the site still works; it simply is not installable or offline.

The icons are **drawn, not artwork**: the same rasteriser that draws the animations renders a squared
set in the four couple colours, so the app icon is made from the book's own vocabulary and cannot be
a stale copy of a logo. Maskable variants keep the motif inside the central 80% that Android may crop.

### SEO

Built into every page by `build-site.mjs`:

| Feature | Detail |
|---|---|
| **Titles** | `<title>` is the page's own heading plus the site name |
| **Descriptions** | derived from the page — a call page's is composed from its **At a glance** table ("From Facing Dancers … to Couple, 4 beats"), so it cannot go stale; truncated at a word boundary |
| **Canonical** | `<link rel="canonical">` per page |
| **Open Graph / Twitter** | `og:title`, `og:description`, `og:image`, `og:url`, `twitter:card` with a 1200×630 card |
| **Structured data** | JSON-LD: `WebPage` + `BreadcrumbList` on every page; **`HowTo`** on call pages, with the *What you do* steps as `HowToStep` |
| **`robots.txt`** | allows everything and points at the sitemap |
| **`sitemap.xml`** | all 106 pages with priorities (calls weighted above prose) |
| **Semantics** | one `<h1>` per page, `<nav>`, `<article>`, `lang="en"` |
| **Home button** | a house icon leads the nav row on every page — including the offline page — as a **host-agnostic** link to `/index.html`, the root of whatever host serves the book (so it works on `util.awltux.trade`, a staging host, or a laptop preview without a rebuild). It is **site chrome, not book content**: `HOME_URL` in `lib/app.mjs` is the one place it is defined, and it is deliberately never written into the Markdown, which is also read on GitHub where that path means nothing |
| **App metadata** | `theme-color`, `apple-mobile-web-app-*` (title `Dancing² Mainstream`), `apple-touch-icon` |

**The published address lives in `book/site-base.txt`.** SEO needs absolute URLs, and a canonical
pointing at the wrong domain is worse than none, so the build reads the base from that file — which
means the ordinary `npm run build:book` is correct and nobody has to remember a flag. The build
prints where the base came from, so a wrong one is visible in the log rather than only in the HTML:

```
base: https://util.awltux.trade/dancingsquared_book/  (from book/site-base.txt)
```

Precedence is `--base <url>`, then `$DSH_BOOK_BASE`, then `book/site-base.txt`, then a placeholder
that the build complains about loudly. Two guards matter:

- an **absent** `site-base.txt` is not fatal — the build falls back to the placeholder and says so,
  which is what a fresh clone with no deployment gets;
- a **malformed** one is fatal — the build exits 1 having written nothing, because a relative or
  mistyped URL would produce canonicals that look deliberate.

```bash
node book/tools/build-site.mjs --base https://example.org/dancing-squared/   # one-off override
```

**The words a link is shared with are separate from its H1.** `<title>`, `og:title`, `twitter:title`
and the JSON-LD name come from the page's own H1 plus the site name — right for a page you arrive at
by reading, wrong for the page you paste into a chat, where the recipient sees the H1 out of context.
`index.md` is the case that matters: it is the book's front door and its H1 is "Introduction", which
tells a stranger nothing about the book they have just been handed. `SHARE_META` in
`build-site.mjs` overrides this **per page, by path**, verbatim and with no site-name suffix
appended:

| Page | What a chat card now says |
|---|---|
| `index.md` | *Dancing Squared — a beginner's book for Mainstream Square Dancing* |
| everything else | unchanged: the H1 plus " — Dancing Squared" |

The H1 is not touched, so the change is confined to the tab, the search result and the card. Add an
entry when a page is going to be shared cold; leave the rest alone. Note that a chat service caches
the card it first saw for a URL, so an already-shared link can keep the old title for a while — share
it with a throwaway query string (`?v=2`) to see the new one immediately.

## Publishing to S3

The book is served from S3, so the built site is uploaded with the AWS CLI by
`scripts/deploy-book.mjs` (wrapped as `npm run deploy:book`):

```bash
npm run build:book
npm run deploy:book -- --bucket <bucket> [--distribution <cloudfront-id>]
```

Bucket, prefix and distribution come from flags or from `BOOK_S3_BUCKET`, `BOOK_S3_PREFIX`
(default `dancingsquared_book`) and `BOOK_CLOUDFRONT_DISTRIBUTION_ID`. `--dryrun` shows what
would change without writing anything.

Two details the script exists to get right, and which a plain file copy — or a *mounted*
bucket — gets wrong:

- **`manifest.webmanifest` needs its real Content-Type.** The CLI's extension map does not
  always know `.webmanifest`, and a manifest served as `application/octet-stream` can stop
  the PWA installing. The script re-uploads it as `application/manifest+json`.
- **Cache headers are split.** `*.html` and `sw.js` go up `no-cache`; everything else gets an
  hour. The book's filenames are not content-hashed — a changed `lib/*.js` or formation PNG
  reuses its name — so a hard long-lived cache would strand readers on an old build.

## Regenerating the animations and the reference tables

Every player and every generated reference table is reproducible from the repository's own data.

```bash
node book/tools/clean-extract.mjs      # readable copies of both manuals (gitignored, in tools/.cache)
node book/tools/map-calls.mjs          # teaching order -> corpus authorings; writes call-map.json
node book/tools/make-animations.mjs    # the player catalogue: animations-index.json
node book/tools/make-animations.mjs --verify   # every call loads and poses cleanly, start to end
node book/tools/make-animations.mjs --check    # the committed catalogue is not stale
node book/tools/make-animations.mjs --gifs     # optional: also encode a GIF of each call
node book/tools/make-formations.mjs    # the small formation diagrams (PNG, from the rasteriser)
node book/tools/make-diagrams.mjs      # the annotated diagrams (SVG, because they carry words)
node book/tools/make-diagrams.mjs --check      # they reproduce exactly  (run by check:book)
node book/tools/make-reference.mjs     # the generated tables in 08-reference/
node book/tools/make-nav.mjs           # the navigation bar at the head of every page  <-- RUN LAST
node book/tools/fix-links.mjs          # repair sibling links to the real filenames
node book/tools/check-links.mjs        # the gate: links, anchors, formation headings, coverage, player placement, nav
```

**Run `make-nav.mjs` after `make-reference.mjs`.** The reference generator rewrites its pages from
scratch, so it wipes their navigation bars; the gate fails loudly if a page is left without one, which
is how that gets caught rather than shipped.

## Navigating the book

Every page carries a navigation bar above its title:

- **⏮ / ⏭** step by **section** — the previous and next numbered chapter;
- **◀ / ▶** step by **page** in the reading order;
- **☰ Contents** returns to the [contents page](contents.md), which links every page in the book;
- **A A** (a small A beside a large one) — the reading size, as a **toggle** rather than a selector:
  pressed is large, and it is one button because two sizes are a state, not a list. Large raises the
  root font size from 16px to 20px, and because every length in the stylesheet is in rem the type,
  the spacing, the column width and the controls all grow together, so the number of words per line
  stays about the same and nothing needs telling twice. The choice is kept in `localStorage` and
  applied by a script in the `<head>`, so a reader who needs large text does not watch every page
  arrive small and grow — and the glyph needs no label, because a reader who cannot read the words
  "small" and "large" has no use for a label that names them;
- **📌 Pin** (right-hand end) pins the bar to the top of the screen, so it stays in reach while you
  read down a long call page. Turning it off lets the bar scroll away with the page again. The state
  rides `aria-pressed` and the pressing is CSS, so the button's look and what a screen reader
  announces cannot disagree — and, like the text size, the choice is remembered from page to page in
  `localStorage` (`dsq-nav-pinned`) and applied by the script in the `<head>`, so a reader who pinned
  the bar does not watch it jump on every page they open.

Those two are the reader's tools: one `aria-pressed` toggle pattern, grouped together at the
right-hand end of the row so they read as page chrome rather than as more places to navigate to.

The build can also render a chapter-and-progress line and an **On this page** list, but it reads them
from lines the Markdown nav blocks do not currently carry, so no page shows either today.

The order the buttons follow is declared in `book/tools/make-nav.mjs` rather than derived from
filenames, because the reading order is not alphabetical — and a page that is missing from the
declared order is an error, not a silent omission.

The tools read the engine's built output (`engine/dist`) and **never rebuild it** — the engine is
another workstream's artefact. They assert the engine API they need and fail loudly, by name, if it
moves.

`check-links.mjs` is the gate to run after any edit: it fails on a dead link, a dead anchor, a
teaching unit with no page, a page for a call that is not in the program, a call card whose
`### Animation` heading count does not match the number of cards (which would put a player on the
wrong call), and a playable call that no page places.

## What is generated, and what is not

| Generated (do not edit by hand) | Written by hand |
|---|---|
| `animations-index.json` — which call each player loads and how it fits the floor | `01-start/`, `02-language/`, `03-rules/` |
| every PNG in `formations/` | every call page in `04-calls/` |
| every SVG in `diagrams/` — the squared-set pictures and the 2/4-against-4/4 phrase diagram | `05-course/`, `06-practice/`, `07-plus/` |
| `08-reference/call-index.md`, `formation-index.md`, `animations-index.md`, `programme-membership.md`, `moved-and-renamed.md` | `08-reference/glossary.md`, `sources-and-attribution.md`, `watching-the-animations.md` |

Generated pages carry a `<!-- GENERATED … -->` header and are checked for it by the gate.
