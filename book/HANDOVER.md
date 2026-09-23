# Handover — the beginner's book for Mainstream Square Dancing

> **STATUS: BUILT, and the gate is green. This file began as the pre-build plan. §1, §3.3, §5, §6, §7
> and §9 now carry *as-built* notes describing what was actually built; §2, §3.1–§3.2, §4 and the
> warnings in §5 are still the authority for *why* the book is shaped as it is.**
>
> Read [`README.md`](README.md) to build and serve it, [`index.md`](index.md) to read the book.
>
> **As built** — every number below came from running the tool or the gate, not from memory:
>
> | | |
> |---|---|
> | Pages | **107** pages of book across **109** Markdown files (`README.md` and this file are workspace files, not pages) |
> | Call reference | **50** unit files in `04-calls/` carrying **78 call cards** |
> | Playable | **75 of 78** cards, from **118 curated start labels** in `tools/start-formations.json` — 64 wired to an authoring, 54 listed but not yet animatable. **5** cards have `"starts": {}` (`m03c`, `m12c`, `m14a`, `m15b`, `m15c`) because their manual wording is prose rather than a list |
> | Withheld | **3** cards — `m04a`, `m14b`, `m32c` — each with a recorded reason (`noAnimation` in `tools/animations-index.json`) |
> | Restrictions | stated on **54 of 78** cards |
> | Diagrams | **19** formation PNGs and **6** annotated SVGs (`book/diagrams/`), of which **5** are used by a page |
> | Online edition | `book/dancingsquared_book/` — 236 files, ~3.4 MB, a PWA with a service worker |
> | Build stamp | every page footer ends with the build's short content hash in square brackets, and the Introduction's correction link asks for the same hash as `book_build_hash=<hash>` — stamped at the end of `build-site.mjs`, the same value the offline cache is versioned by, so a deployment can be identified from the page a reader is looking at |
> | Gate | `npm run check:book` → exit 0: *109 pages, 50 teaching units, 75 playable calls; all links, anchors and coverage checks pass.* · *75 playable calls reproduce exactly.* · *75 playable calls verified (303 pose evaluations, 3 with a recorded reason).* |
>
> **Outstanding — found while updating this file, measured rather than suspected:**
>
> 1. **One of the six diagrams in `book/diagrams/` is orphaned.** `make-diagrams.mjs` draws "Heads
>    and Sides" and `--check` says it reproduces exactly — but **no page references it**, so it never
>    reaches the site: the build copies only the diagrams a page actually renders (this is deliberate;
>    see item 2). `02-language/naming-the-dancers.md` and `couples-and-positions.md` are the pages it
>    was drawn for. The other five are referenced: `couple-numbers.svg`,
>    `four-identifiers.svg`, `leaders-and-trailers.svg` and `centers-and-ends.svg` by
>    `02-language/naming-the-dancers.md`, and `phrase-bars.svg` by `01-start/timing-and-music.md`.
> 2. **`make-diagrams.mjs` is in `build:book` — the wiring this list used to ask for.** The build is
>    make-animations → make-formations → **make-diagrams** → make-reference → make-nav → build-site.
>    `build-site.mjs` copies the diagrams **a page renders** and no others, the same rule the call
>    authorings follow, so an unreferenced diagram stays out of the deploy and out of the reader's
>    cache rather than shipping as an unreachable file. **The consequence to remember:** a diagram no
>    page references will not appear on the site, and nothing will say so except this note.
> 3. **One `--check` mode is still wired to nothing.** `make-formations.mjs --check` passes, but
>    `check:book` runs `check-links.mjs`, `make-animations.mjs --check`, `make-animations.mjs --verify`
>    and `make-diagrams.mjs --check`. The formation gate exists; its wiring does not. That is §4 trap
>    6, still live for that one artefact.
> 4. **`make-reference.mjs`'s own header is wrong** (line 6): it says `check-links.mjs` re-runs its
>    `--check` mode. There is no such mode, and `check-links.mjs` only asserts that the `GENERATED`
>    header is *present* on its five pages — so a reference page edited by hand keeps its header and
>    nothing complains. The five generated reference pages are **ungated**.
> 5. **`README.md` mentions `make-diagrams.mjs` and `diagrams/`** in the tools table, the "what is
>    generated" table and the regeneration sequence — this was gap 5 in an earlier draft of this
>    banner, and it is closed.
> 6. **The engine workstream's tree carries mojibake in four files**, measured by reading the bytes:
>    `engine/src/sequencer/applicator.ts` (lines 668, 678, 860 — three comments holding ten mangled
>    sequences: an em dash and two section signs, encoded so many times over that they now render as
>    runs of accented characters), plus `engine/test/lib/getout-decode.mjs:69`,
>    `engine/test/tools/figure-census.mjs:120` and `engine/test/tools/setup-split.mjs:187`, where the
>    damage is inside `console.log` strings rather than comments. Nothing here changes engine
>    behaviour, but `build-site.mjs` publishes `engine/dist` as the site's `lib/`, so applicator.ts's
>    damaged text ships in `dancingsquared_book/lib/sequencer/applicator.js` (lines 639, 650, 841).
>    The repair belongs in `engine/src` followed by an `engine/dist` rebuild; neither is the book's to
>    edit by hand. `engine/test/tools/callerlab-diff.mjs` is the exception and **not** a defect: it
>    repairs extraction artefacts, so it quotes these sequences on purpose.
>    **Read the bytes, never the console, when checking this.** `Get-Content` decodes UTF-8 as
>    windows-1252 and prints a genuine `—` as `â€”`, so it invents corruption in every engine file that
>    contains an em dash: `engine/src/sequencer/coded-moves.ts` and `library.ts` both looked damaged
>    that way and are clean. This entry was wrong in its first draft — it named one file and blamed a
>    single round-trip — because the console was believed instead of a probe.
> 7. **A changed diagram can be served from a reader's cache after a deploy.** `style.css` and
>    `assets/player.js` carry `?v=<content hash>` precisely so that new HTML cannot meet a stale asset,
>    but the images in `formations/` and `diagrams/` are plain URLs and the deploy gives assets a
>    one-hour cache header — so a figure that changed is up to an hour late for anyone who has seen it
>    before. Found by rebuilding a diagram and being shown the OLD one in a browser: the file on disk and
>    a cache-busted fetch were both correct, and only the cached copy was not. The fix is the one the
>    stylesheet already uses, applied to images.
>
> What this file is still good for:
>
> - **§2 The authorities** — the two 2026 manuals, and the fact that the corpus is *not* the program.
> - **§3 The exclusion rules** — how non-calls and non-members were identified. Now implemented in
>   [`tools/make-reference.mjs`](tools/make-reference.mjs). The corpus classification table it once
>   produced is **no longer in the book**: it was deleted along with `definitions-reconciliation.md`
>   and `using-the-dancing-squared-app.md` in the *de-developer sweep*, on the principle that
>   `book/*.md` and `book/dancingsquared_book/*` are read by dancers and must contain no engine,
>   repository or
>   toolchain language. The only reader-facing residue is
>   [`08-reference/programme-membership.md`](08-reference/programme-membership.md) and
>   [`08-reference/moved-and-renamed.md`](08-reference/moved-and-renamed.md).
> - **§4 The traps** — `sequencer="no"` in particular. Still a live trap for anyone touching the corpus.
> - **§5.2 Reading the manual extracts** — with one correction: the shift is **+29 to decode**
>   (`$ G G H G` = "Added"), not −29 as this file first said. Implemented in
>   [`tools/clean-extract.mjs`](tools/clean-extract.mjs).
>
> Where the plan and the built book differ, the book is right: it was corrected by measurement during
> the build. §6 keeps the plan as approved, annotated with what was built instead.
>
> Two plan items were **not** delivered as designed, and both matter to anyone trusting the book's
> formation and timing cells:
>
> - **Figure admission** was to require corpus/manual agreement on start *and* end formation. What
>   shipped is weaker: three cards carry a recorded reason for having no animation, but nothing
>   compares a card's stated formations or timing against the corpus, and the reconciliation tool that
>   was to report it was never written (§6.2). The reconciliation *page* was deleted in the
>   de-developer sweep, along with the per-call figures, which the engine-driven animations replaced.
> - **The corpus hash** — a recorded hash of the corpus asset set, so that a re-levelled corpus shows
>   up as reported drift — was not built. The only hash anywhere in the tooling is the service
>   worker's cache version in `build-site.mjs`.
>
> **Corrections made after the first build, all of them from looking at the rendered output:**
>
> 1. **ONE ANIMATION PER CALL.** Each call page carried the interactive player *and* a GIF of the same
>    motion underneath it. The lower copy had no controls, so it read as a second and worse animation.
>    The image lines pointing at `../animations/<id>.gif` are gone from `04-calls/*.md`, replaced by a
>    line of prose, and `make-animations.mjs` no longer encodes a GIF unless passed `--gifs`.
>    `book/animations/` is deleted and now gitignored.
> 2. **The player went on the wrong call on two pages.** The builder paired animation ids with
>    `### Animation` headings by counting GIF references in the Markdown. Unit M4 is (a) Right/Left
>    Arm Turn — no animation — and (b) Allemande Left — animated, so the one player landed under card
>    (a); unit M32 had the same fault at card (d). Ids now come from the teaching order
>    (`call-map.json`), one slot per call card with a `null` where a card has none, and both
>    `build-site.mjs` and `check-links.mjs` fail if the heading count and the card count disagree.
> 3. **A dancer is one grid square wide.** The marker radius was a fixed 21 px, so it grew relative to
>    the dancers exactly when a call was fitted to a wider floor, and it was wider than the one-unit
>    spacing of a tidal wave and a promenade — which is the overlap visible in the waves. The radius is
>    now `MARKER_UNITS = 0.48` **board units** in `make-animations.mjs`, `assets/player.js` and
>    `make-formations.mjs`, with the facing nose and handhold trim proportional to it. Measured, not
>    guessed: squared set and ocean wave 2 units apart, tidal wave and promenade 1. The probes survive
>    in `tools/.cache/`: `probe-spacing.mjs`, `probe-spacing2.mjs` and `probe-approach.mjs` for this;
>    `probe-start-formations.mjs` and `probe-start-counts.mjs` for the corpus authoring counts;
>    `probe-labels.mjs` for the curated label counts.
> 4. **Formation labels were printed twice** — the image's alt text renders as the `<figcaption>`, and
>    an italic line repeating it followed. 17 italic repeats removed (16 in `formations.md`, 1 in
>    `directions.md`).
> 5. **The facing mark was not readable at a glance.** It was drawn in the dancer's own colour, so all
>    that showed was a small bump over a pale floor. It is now near-black, wider where it leaves the
>    body, and its tip reaches 1.6 × the marker radius (0.77 of a unit, against a 2-unit wave spacing).
>    Separately, it was drawn per dancer, so one dancer's nose was painted after the previous dancer's
>    BODY and landed on top of it in a close pass — dancers appeared to stab one another. All noses are
>    now drawn in one pass and all bodies in a second, so an intruding nose is covered by the body it
>    intrudes on and can never cover a number. Same treatment in `player.js`, `make-animations.mjs`
>    (previews) and `make-formations.mjs`.

---

This file exists so a **later session** can pick the book up without re-deriving anything. It was
written before the build; the build has since happened and the gate is green, so read §1 and §9 for
where things actually stand, and §6 for the plan the book's shape rests on.

**Read in this order:**

1. **this file** — §1 the task, §2 the authorities, §3 the exclusion rules, §4 the traps, §5 the engine notes, §6 the plan to execute;
2. `README.md` and `HANDOVER.md` at the repo root — the workspace, and how to work in it;
3. `square-dancing.md` — the engine's own model (§1.2 FASR, §4 timing, §5 tips, §6 the passing rule, §7 formations, §8 invariants);
4. `docs/New_Mainstream_Definitions_26-03-29.pdf` and `docs/Plus-Definitions-26-08-25.pdf` — **the authorities for the book's content** (untracked; may need re-supplying in a fresh clone).

---

## 1. The task

Write a **beginner's book teaching CALLERLAB Mainstream Square Dancing**, under `book/`, as plain
Markdown with **one file per section**. It must be user-friendly and easy to read, **introduce and use
the square-dancing domain language**, and **cross-reference modular explanations rather than
re-explaining** — each term defined in exactly one place, linked everywhere else.

### Decisions already taken with the user

| Decision | Value | Why |
|---|---|---|
| Figure format | **SVG generated headlessly from the engine** | Deterministic, crisp, versionable; works inside the file sandbox |
| Browser screenshots | **Not used** | User's explicit choice. (Recorded for completeness: Chromium cannot start in a confined sandbox — Mojo IPC needs named pipes — so screenshots would need `danger-full-access`.) |
| Call scope | **The 2026 Mainstream programme, plus a short Plus appendix** | User's choice; the corpus's own "Mainstream" tag is *not* the programme (§3) |
| Rendering target | Plain Markdown + SVG | Renders on GitHub and in any Markdown viewer; no static-site generator |
| Cross-reference discipline | One definition site per term, listed in a glossary, linked elsewhere | The user's stated requirement, and the thing that keeps the book from bloating |

**As built, two of those read differently.** *Figure format*: only the position diagrams are SVG
(text-bearing, so the reader's own font is used); the formation diagrams are PNG from the
engine-driven rasteriser, which has no font engine, and the pictures of the calls themselves are not
images at all — they are the interactive player, so there is no per-call figure to version.
*Rendering target*: the Markdown renders on GitHub and in any viewer, but it is no longer the only
target — there is a static-site generator (`build-site.mjs`) and the online edition is a PWA, neither
of which the "no static-site generator" line anticipated. On GitHub a call page shows its prose and
its `### Animation` line but no player, because the player is injected at build time. Browser
screenshots are still not used, as decided.

### Where it stands

**Built and green.** `book/` holds the finished book plus the tools that generate its diagrams,
tables and site:

```
book/
  README.md  index.md  conventions.md  HANDOVER.md    README and HANDOVER are workspace files, not pages
  01-start/     8 pages      02-language/   9 pages     03-rules/     8 pages
  04-calls/    50 unit files carrying 78 call cards
  05-course/   14 pages      06-practice/   4 pages     07-plus/      3 pages
  08-reference/ 8 pages — 5 generated (call, formation, animations, membership, moved) and 3 by hand
  assets/player.js        the browser player — the only hand-written runtime asset
  formations/  19 generated PNGs        diagrams/  4 generated SVGs (3 orphaned; see the banner)
  tools/       generators, the gate, and the committed indexes they check against
  dancingsquared_book/    build output: the site, gitignored

The layout differs from §6.1's plan in three ways: `figures/` became `formations/` **plus**
`diagrams/` (named `positions/` until the phrase diagram, which is not a position, was added to it);
`CHECKPOINT-classification.md` and the three developer-facing reference pages
(`corpus-classification`, `definitions-reconciliation`, `using-the-dancing-squared-app`) were deleted
in the de-developer sweep; and the three planned gates `classify-corpus.mjs`, `resolve-programme.mjs`
and `reconcile-definitions.mjs` were never written as separate tools — the classification and
membership work they were to do is implemented inside `make-reference.mjs`.

Nothing is blocked. §5.4 described an in-flight session on the engine; that landed, the engine's built
output is present and current, and the book's tools read it without rebuilding it.

---

## 2. The authorities

Two documents govern the book's content. **The XML corpus is a geometry/animation source only**, and is
admitted solely where it agrees with a manual, and only after it has been classified as a call (§3).

| Document | Revision | Role |
|---|---|---|
| `docs/New_Mainstream_Definitions_26-03-29.pdf` | **29 March 2026** | **Membership, teaching order, definitions, terminology, timing** for everything taught |
| `docs/Plus-Definitions-26-08-25.pdf` | **25 August 2026** | The Plus appendix, the bridge chapter, and the **evidence for what left Mainstream** |

Both are **untracked** (`docs/` is gitignored territory), so a fresh clone may not have them.

### 2.1 The 2026 program change — read this before anything else

The Mainstream manual records that **in 2025 the CALLERLAB membership voted to approve The Proposal**,
and the Mainstream Committee then:

> selected **50 calls or call families** to be used in the new Mainstream Program. This new program
> **replaces the previous Basic, Mainstream, and SSD Programs.**

It carries a **CALLERLAB (New) Mainstream Suggested Teaching Order, effective September 1, 2026** —
units `M 1` … `M 50`. Thirteen units have lettered parts, giving **~78 call entries across 50 unit
files**. (Counting the lettered parts: `M1`, `M3`, `M4`, `M6`, `M12`, `M13`, `M14`, `M15`, `M19`, `M31`,
`M32`, `M43`, `M49` have parts; their parts number 41; plus the other 37 single units.)

**That teaching order is the book's spine.** Do **not** use the older plans in
`poc-teacher/src/programme.ts` (`mainstream2026Programme`, 19 sessions; `ssdProgramme`, 12 sessions) as
the spine — they predate the revision and use retired names such as `Circle Left 1/4`. They remain
useful as *evidence of teaching practice*, not as the programme.

The **Plus manual has no teaching order**, so the Plus appendix follows its published TOC order.

### 2.2 Extracting the manuals

Use the existing extractor — **do not write a new one**:

```
node engine/test/tools/extract-pdf-text.mjs <path.pdf> <out.txt>     # args optional; defaults are callerlab-ms.txt
```

It works cleanly on both PDFs. Measured: the Mainstream PDF is 1,232,012 bytes and extracts to
**231,768 characters**; the Plus PDF is 666,582 bytes and extracts to **100,094 characters**.
Dependency-free: it scans `stream … endstream`, inflates, and reconstructs text from text-position
operators.

**Always pass an explicit output path under `book/tools/.cache/`.** Never let it write its default
`callerlab-ms.txt` at the repo root — that file is gitignored, is the other session's artefact, and is
documented as "not ours to redistribute by default".

### 2.3 Reproduction and licensing — the rules

- **The book's prose is original.** CALLERLAB appears only as **short, attributed quotations** with the
  required notice on the page and in the sources page.
- **Never commit an extracted manual.** The repo already decided this by gitignoring `callerlab-ms.txt`.
- **No book prose is generated from an extract.** The extracts are a *reading aid*; every quotation is
  checked against the PDF before it is published.
- The Callerlab notice travels with the work:
  - Mainstream: *© 1994, 2000-2026 by CALLERLAB Inc., The International Association of Square Dance Callers. Permission to reprint, republish, and create derivative works without royalty is hereby granted, provided this notice appears.*
  - Plus: *© Copyright 1997, 2001-2026 by CALLERLAB Inc., The International Association of Square Dance Callers. Permission to reprint, republish, and create derivative works without royalty is hereby granted, provided this notice appears.*
- The tamination XML is GPL/AGPL; preserve its license headers, and **do not** reuse the
  `taminations-flutter/assets/**` PNG frames (that tree is "reference only — read, never port").

---

## 3. The exclusion rules — the hard-won part

Two **independent** questions. Do not conflate them: *"is it in the program?"* and *"is it a call at
all?"* are different, and answering only the first is how a routine gets a call page.

### 3.1 Membership comes from the manual, not from the corpus

**Level in the corpus is expressed by path, not by attribute.** There is **no per-call level field**.
It is the directory (`poc/src/assets/ms/…`, `plus/…`, `b1/…`) and the `link` in the corpus's own
catalogue `poc/src/assets/src/calls.xml` (`<call link="b1/allemande" …/>`,
`<call link="plus/acey_deucey" …/>`).

That declaration is exactly what the book overrides. **The user's rule:** *ignore moves tagged as
Mainstream in the XML if they are not in the PDF.*

The corpus's "Mainstream" is also **cumulative**: `calls.xml` holds **166** entries across `b1`, `b2`,
`ssd` and `ms`, against only **66** XML files in `ms/`. Basic-level calls are tagged as available at
Mainstream, which is precisely why so many moves appear "marked Mainstream" that the 2026 program does
not contain.

### 3.2 Three-way membership, by evidence across *both* manuals

Do not infer "absent from Mainstream ⇒ moved to Plus". That inference was made early and then
**disproved by measurement**:

| Evidence | Class | Handling |
|---|---|---|
| in the Mainstream manual | **Mainstream** | taught; gets a call card |
| absent from Mainstream, **present in Plus** | **Plus** — confirmed moved | `moved-and-renamed.md` + the Plus index |
| **absent from both manuals** | **outside the 2026 programs** | recorded, not taught, **not** indexed as Plus |

Verified examples:

| Corpus file (declared `ms`) | Mainstream manual | Plus manual | Verdict |
|---|---|---|---|
| `ms/dixie_style.xml` | absent | **present** as `Dixie Style to an Ocean Wave` | moved to Plus |
| `ms/grand_spin.xml` | absent | **absent** | outside both — and **not a call** (§3.3) |
| `ms/running_bear.xml` | absent | **absent** | outside both — and **not a call** (§3.3) |

### 3.3 "Is it a call at all?" — the content-type classes

`poc/src/assets/ms/` is **not** a directory of calls. Classify every corpus entry:

| Class | Evidence | Handling |
|---|---|---|
| `call` | in a manual; a `<tam>` whose moves *are* the call's own dance action | call card |
| `family` | in a manual as a family with lettered parts | call cards for its parts, under one unit file |
| `routine-or-example` | a single `<tam>` that performs **several** calls as raw `<move>`s, with the call names only in HTML comments; a long `fractions` list; `group=" "` | **excluded**, reason recorded |
| `rule` | the manual's *Conventions and Rules*; `*_rule.xml` | `03-rules/` |
| `terminology` | the manual's *Descriptive Terminology*; `face.xml`, `pull_by.xml`, `step_thru.xml`, `forward_and_back.xml` | `02-language/` |
| `registry` / `artefact` | `moves.xml`; everything under `discovered/` | **excluded** |

Read and confirmed:

| File | What it actually is | Class |
|---|---|---|
| `poc/src/assets/ms/running_bear.xml` | A **singing-call routine**: one `<tam>`, `group=" "`, `fractions="8;8;3;5;2;3;4;4.5;2;6.5;4;4.5;2"`, whose path plays Ladies Chain, Rollaway, Star Thru, Dive Thru, Dosado… as raw moves with the call names only in `<!-- -->` comments | routine |
| `poc/src/assets/ms/grand_spin.xml` | Opens *"FIGURE OF GRAND SPIN AS FOLLOWS: Sides will face as in Grand Square, back up 3 steps & turn on #4 step…"* — a **figure**, not a call | routine |
| `poc/src/assets/ms/moves.xml` | The **move registry**, living inside the `ms/` level directory | registry |
| `poc/src/assets/ms/*_rule.xml`, `*_style.xml` | Passing Rule, Ocean Wave Rule, Facing Couples Rule, Same Position Rule, Alamo Style, Dixie Style | rule |
| `poc/src/assets/discovered/*.xml` | 5 generated/scratch authorings (`flutterwheel`, `pass_thru`, `recycle`, `square_thru`, `star_thru`). `data.ts` lists `'discovered'` **first** in `levelOrder`, which treats a scratch directory as a dance level | artefact |

**There are almost certainly more, so find them rather than guessing.** The planned gate reports every
corpus entry absent from *both* manuals and flags routine-like structure; a human then assigns the
class; and the gate **fails on any unreviewed entry** so nothing slips in unclassified.

**As built:** there is no separate classification gate. `make-reference.mjs` performs the three-way
membership measurement and carries the two non-calls it must name (`Running Bear`, `Sides Face, Grand
Spin` — both recorded as routines) as a small reviewed list; the *unreviewed* state the plan wanted to
fail on has no representation, so a new corpus entry that is in neither manual simply lands in
"outside both" rather than stopping the build. That is a real gap between the plan and the book, and it
is the same missing gate as `reconcile-definitions.mjs` in §6.2.

### 3.4 `calls.xml` is corroboration only — not a test

It is **not** a clean call/non-call discriminator, in both directions:

- it **has** entries for rules and terminology — `Passing Rule`, `Ocean Wave Rule`, `Step Thru`,
  `Pull By`, `Forward and Back`;
- it **misses** real things — no entry for `Face In`, none for `Dixie Style` (which appears under its
  full title `Dixie Style to a Wave`).

It corroborates that `Running Bear` and `Grand Spin` are not calls (no entry), but it cannot decide the
question alone.

---

## 4. Traps that have already bitten

1. **`sequencer="no"` is NOT a membership signal.** It marks individual *demonstration* variants of
   entirely real calls. `run.xml` alone has ~40 of them, and `trade`, `pass_thru`, `hinge`,
   `cast_off_three_quarters`, `touch_a_quarter`, `square_thru`, `right_and_left_thru`, `turn_back`,
   `wheel_around`, `sashay`, `fold`, `circulate`, `face`, `california_twirl` and `courtesy_turn` carry
   it too. The engine's own docs say it means *"a demonstration animation the sequencer must not
   match"* — nothing more. **Filtering on it would delete mainline calls from the book.** Such variants
   remain perfectly usable for figures.
2. **Do not infer "not Mainstream ⇒ Plus".** Measured false for `grand_spin` and `running_bear` (§3.2).
3. **Do not trust the extract's text.** It contains three repairable artefact classes (§5.2) and at
   least one region that decays to noise. Quotations must be checked against the PDF.
4. **Never let the extractor write its default output.** `callerlab-ms.txt` at the root belongs to the
   other session's work and is gitignored on purpose.
5. **`docs/` is untracked.** The manuals may be absent in a fresh clone; the book's committed prose must
   not depend on them, and the sources page should say how to regenerate.
6. **A generated artefact with no gate goes stale silently** — this repo has already been bitten by it
   once (the FSM asset, see the root `HANDOVER.md`). Every generated table in the book gets a gate in
   the same change.

---

## 5. Engine and figure notes

### 5.1 Generating the figures

The precedent for **headless SVG generation with no browser** already exists in this repo:
**`poc-teacher/scripts/fsm-visual.mjs`** renders the FSM transition table as a standalone interactive
SVG/HTML. Follow that shape.

**As built, the figure story changed shape.** There is no per-call figure: the call pages carry the
interactive player instead, and only two image families exist — the formation diagrams (PNG, from
`make-formations.mjs`, sharing the animation rasteriser) and the position diagrams (SVG, from
`make-diagrams.mjs`, because they carry words and the rasteriser has no font engine). The APIs below
are still the ones the tools use.

Headless engine use follows **`poc/verify.cjs`**: it requires the built ESM dist and injects a
DOMParser, because Node has none:

```js
const { DOMParser } = require('@xmldom/xmldom');   // resolves from poc/node_modules
const eng = require('../engine/dist/index.js');
eng.setParser(DOMParser);
```

**Preflight the exports and fail loudly, naming any missing symbol** — the other session is editing
`engine/src/index.ts`, so the surface can move. The long-standing exports the figures need:

`setParser`, `loadCallFromXml`, `callMeta`, `parseMoves`, `parseFormations`, `poseFor`, `allPoses`,
`sampleTrail`, `sampleTrailRange`, `dancerBeats`, `computeHandholds`, `assignHomeIdentity`,
`Sequencer`, `boardAtBeat`.

Key APIs, from `engine/src/core.ts` and `engine/src/types.ts`:

- `poseFor(dancer, beat, headingMode?)` → `{ x, y, heading, hands }`; `heading` is radians, `0 = +X`,
  positive counter-clockwise. `headingMode` is `'rotation'` (the authored facing curve — authoritative)
  or `'travel'` (always face along motion).
- `allPoses(call, beat)` — every dancer at a beat.
- `sampleTrail(dancer, steps = 60)` — the whole path as points. **This is the dancer track.**
- `sampleTrailRange(dancer, from, to, steps = 48)` — one stretch of the path.
- `computeHandholds(poses, 'active' | 'static')`.
- `DancerSpec` carries `gender` (`'boy' | 'girl' | 'phantom'`), `x`, `y`, `angleDeg`, `path`,
  and (once stamped by `assignHomeIdentity`) `id` (1..8) and `couple` (1..4) for colouring.
- `CallBundle` carries `title`, `from`, `beats`, `leadin`, `leadout`, `totalBeats`, `symmetry`,
  `sequencerMode`, `forSequencer`.

### 5.2 Reading the manual extracts

The extracts contain three mechanical, **decodable** artefact classes. Repair them and **report anything
that could not be repaired** with page and line ranges — do not silently smooth.

<!-- mojibake-check:allow — this section quotes the corruption on purpose, as its signature. -->

| Artefact | Signature | Example | Repair |
|---|---|---|---|
| Font glyph runs **shifted by exactly +29**, space-interleaved | single chars separated by spaces, in the shifted range | `+ D Q G V` → `Hands`; `7 K H  Z R U G` → `The word` | strip interleaving, subtract 29 |
| **UTF-8 read as latin1** | `Â` prefix bytes | `Â©` → `©`, `Â´` → `´` | re-decode as UTF-8 |
| **Spurious intra-word spaces** from the extractor's own line logic | space inside a word | `M1 2.`, `D ance`, `C ouple`, `Facing Couple s Rule` | heuristic join, **and report** |

### 5.3 Drawing conventions

The POC draws with these conventions. Reuse them where they help a beginner; **depart deliberately**
where they do not, and record the departure:

- The **flat (2D) view** is an orthographic top-down camera with the board's `+y` up the screen.
- Dancers are **colour-coded by couple** (POC: 1 = red, 2 = yellow, 3 = green, 4 = blue), and women have
  a distinct silhouette. This palette is tuned for a **dark 3D scene** — for a printed page, use a
  print- and colourblind-safe palette, and make **colour never the only signal**: every marker should
  also carry its couple number and a gender shape.
- A small **"nose" cone** marks each dancer's facing.
- The floor grid is 20 units in 20 divisions; a `Forward` is one cell; the couples of a squared set
  stand **2** units apart.
- The POC's **trail** is the same data as `sampleTrail`, drawn per dancer; the editor dims the
  unselected track and highlights the selected move. For a book, one track figure per call plus a
  start and an end board is the planned shape.

**As built:** the 2D top-down view, the `+y`-up board and the 2-unit squared-set spacing all hold, and
the marker is one square wide (`MARKER_UNITS = 0.48`). The departures are deliberate and are the
reader-facing rules in `conventions.md`:

- **Colour is by couple** — 1 red, 2 blue, 3 green, 4 gold — and **falls back to gender** when a call
  involves only four dancers, where there is no home couple to point at. Shape (circle = Girl, square =
  Boy) and facing are always drawn, so nothing depends on colour alone; the "women have a distinct
  silhouette" idea became the circle/square marker.
- **The facing cone** became the near-black facing wedge, drawn in its own pass (see correction 5 in the
  banner).
- **No per-call track figure was drawn.** The player shows the trail on demand, which is where the
  "one track figure per call" plan went.

### 5.4 The in-flight session that once blocked the build *(historical)*

**This section is kept only as a record of why the build was deferred; it no longer blocks anything.**
The session below has long since landed, and the book's tools run against a settled `engine/dist`.

At the time of writing, `git status` showed **modified**: `PLAN.md`, `engine/src/index.ts`,
`engine/src/sequencer/applicator.ts`, `engine/src/sequencer/library.ts`, `engine/src/sequencer/sequence.ts`,
`engine/src/sequencer/sequencer.ts`, `engine/src/sequencer/types.ts`, `engine/test/verify-suite.mjs`,
`poc/src/modules.ts`, `poc/src/sequencer-ui.ts`; and **untracked**: `engine/test/modules.mjs`,
`engine/src/sequencer/cells.ts`, `engine/test/tools/cell-census.mjs`, `docs/`, `poc/pnpm-lock.yaml`,
`poc/pnpm-workspace.yaml`, and the screenshot artefacts `poc/tools/_browse-filter.png`,
`poc/tools/_fsm.png`, `poc/tools/_fsm-node.png`.

**That footprint is a moving target, and it grew while this plan was being written** — from three
modified files to ten over the course of one conversation, spreading from the sequencer into the POC.
Re-run `git status` yourself rather than trusting this list; treat it as a shape, not a census.

**Wait until those are committed/settled before building** — that instruction applied at the time and
has been satisfied. The engine rules it lists still hold whenever the tools are re-run:

- use the engine, but **never rebuild `engine/dist` while a suite is running**;
- rebuild it once, deliberately, if you need current engine source: `npm run build --prefix engine`
  **from the repo root** (running it from inside `engine/` resolves to `engine/engine` and fails);
- re-run the preflight export check before trusting the figures.

The preflight surface §5.1 names is still intact: `index.d.ts` re-exports `./core.js` wholesale, so
`poseFor`, `allPoses`, `sampleTrail`, `sampleTrailRange`, `dancerBeats` and `computeHandholds` are all
reachable from the package root by `export *` rather than by name.

---

## 6. The plan to execute — and what was built instead

**Executed, with one substitution and one deletion, both noted in place below.** The plan is kept
because the book's shape rests on its reasoning; where it and the built book disagree, the book is
right.

### 6.1 Book structure

**The plan, as approved:**

```
book/
  .gitignore                    tools/.cache/
  README.md  index.md  conventions.md
  CHECKPOINT-classification.md  the reviewed corpus table, put to the user before prose

  01-start/     what-is-square-dancing · the-square · your-first-call · how-a-call-works
                timing-and-music · tips-and-figures · zeroes-getouts-and-modules · how-this-book-is-organised
  02-language/  naming-the-dancers · couples-and-positions · directions · formations ·
                arrangements-and-gender · sequence-and-relationship · hands-and-holds ·
                fractions · concepts-and-modifiers
  03-rules/     passing-rule · same-position-rule · facing-couples-rule · ocean-wave-rule ·
                squared-set-convention · circle-rule · proper-versus-improper · mainstream-restrictions
  04-calls/     m01-circle-family … m50-recycle            (50 unit files, ~78 call cards)
  05-course/    course-overview · class-01 … class-12 · teaching-a-class
  06-practice/  how-to-practise · drills · dancing-a-tip · caller-and-teacher-notes · finding-music
  07-plus/      where-mainstream-leads · plus-programme · plus-call-index
  08-reference/ glossary · call-index · formation-index · figures-index ·
                programme-membership · corpus-classification · definitions-reconciliation ·
                moved-and-renamed · using-the-dancing-squared-app · sources-and-attribution
  figures/      generated SVG, committed
  tools/        generators and gates
```

**What was built** — the same skeleton with four differences:

| Planned | Built | Why |
|---|---|---|
| `figures/` — one SVG per call, 250–350 of them | `formations/` (19 PNGs) + `diagrams/` (6 SVGs) + the browser player | The engine-driven player replaced the per-call figure set, so only the small formation and annotated diagrams remain as images; the count is **25, not 250–350** (and two of the four diagrams are orphaned — see the banner) |
| `CHECKPOINT-classification.md` | absent | The corpus-classification table was later deleted in the de-developer sweep; the reader-facing residue is `08-reference/programme-membership.md` and `moved-and-renamed.md` |
| `figures-index.md`, `corpus-classification.md`, `definitions-reconciliation.md`, `using-the-dancing-squared-app.md` in `08-reference/` | `animations-index.md`, `watching-the-animations.md` instead | Developer-facing pages were removed by the same sweep; the animations index took the figure index's place |
| `01-start/your-first-call.md` — a walkthrough of the first call | written, then **deleted** | It restated the M1a call card: the same walkthrough, the same fraction table, the Manual's styling quotation word for word, the same faults. That is exactly the duplication the book exists to avoid, and it was the only page doing it. Its one unique note — the grapevine step in an eight-dancer circle — moved to the M1a **Styling** section, and the flagpole centre it re-defined already lives in `02-language/directions.md`. The URL is gone and the book has no redirects, so a bookmark of it now 404s, as with the pages renamed in the front-matter swap |

`02-language/` is built from the manual's **Ways of Naming Dancers** (Partner & Corner, Heads & Sides,
Couple #1–#4, Boys & Girls, Centers & Ends, Leaders & Trailers, Adjacent, Couples, Opposite,
Right-Hand Lady, The Four Identifiers) and its **Descriptive Terminology** (Left, Right, In, Out,
Forward and Back, Rear Back, Reverse, Home, Promenade Direction, Turn 1/4 / 1/2 / 3/4 / Full),
plus the corpus files classed `terminology`. `03-rules/` is built from its **Conventions and Rules**.

### 6.2 The gates

**The plan, as approved:**

1. **`clean-extract.mjs`** — runs the existing extractor for both PDFs into `tools/.cache/`, applies the
   §5.2 repairs, reports unrepairable ranges.
2. **`classify-corpus.mjs`** — §3.3 classes; human-reviewed; fails on unreviewed.
3. **`resolve-programme.mjs`** — §3.2 membership; human-reviewed; fails on unreviewed.
4. **`reconcile-definitions.mjs`** — per Mainstream entry, compares the manual against the corpus:
   *Starting Formation* ↔ the XML setup's `from`; *Ending Formation* ↔ the engine's recognised end
   formation; *Timing* ↔ the XML beat total; restrictions ↔ whether the card states them.
5. **`make-figures.mjs`** — emits SVGs plus `figures-index.json`; deterministic (fixed sample counts,
   fixed rounding, sorted iteration, no timestamps); `--check` regenerates and fails on drift.
6. **`check-links.mjs`** — links and fragments resolve; every unit `M1`–`M50` has a call file; every
   programme entry has a figure or a recorded reason; no orphan figures; one definition site per
   glossary term; **no call page for a non-call**; the contents links every page in the reading order;
   **no file has been through a single-byte encoding round-trip**; **no reader-facing page speaks in
   the tools' language** (`board`, `corpus`, `precondition`, `+y` and the like).

**What was built** — two of the six planned gates were never written, one split into two tools, and the
`--check` modes that exist are not all wired in (see the banner):

| Planned | Built | Note |
|---|---|---|
| `clean-extract.mjs` | `clean-extract.mjs` | as planned, both manuals into `tools/.cache/` |
| `classify-corpus.mjs` | — | never written as a tool; the `§3.3` classes now live inside `make-reference.mjs`, which generates the reader-facing membership and moved-and-renamed pages from them |
| `resolve-programme.mjs` | — | same: the three-way membership is computed in `make-reference.mjs` |
| `reconcile-definitions.mjs` | — | never written; the deletions noted in §6.1 removed the page it fed. **The reconciliation it described is therefore not running** — nothing today compares a card's stated start/end formation and timing against the corpus, and nothing compares the cards against the manual's pages |
| `make-figures.mjs` | `make-formations.mjs` + `make-diagrams.mjs` | both deterministic with `--check`; **`make-diagrams.mjs` is in `check:book`, `make-formations.mjs` is not** |
| `check-links.mjs` | `check-links.mjs` | as planned, plus: `### Animation` heading count vs call-card count, nav-bar sentinels, `GENERATED` headers, formation-diagram orphan checking, the contents page linking every page in the reading order, mojibake in any source or tool file, and the tools' own vocabulary in a reader-facing page |

The live gate is `npm run check:book`:

```
node book/tools/check-links.mjs              # links, anchors, coverage, player placement, nav, headers
node book/tools/make-animations.mjs --check  # the committed catalogue is not stale
node book/tools/make-animations.mjs --verify # every call loads and poses cleanly, start to end
```

`check-links.mjs` does **not** re-run `make-reference.mjs`, contrary to that tool's header comment: it
asserts only that the five generated pages carry their `GENERATED` header, so a reference page edited
by hand keeps its header, passes the gate, and says nothing.

**Figure admission rule.** Draw a figure only for a confirmed Mainstream call whose corpus
representative agrees with the manual on **start and end formation**:

- geometry disagreement → **no figure**, reason recorded, page still teaches the manual's action;
- timing-or-wording difference only → figure drawn, caption carries the manual's value;
- `no-corpus-data` → no figure, reason recorded, page written from the manual.

That is the difference between a picture of the call and a picture of an *older definition* of it.
**As built**, the rule survives in the weaker form the banner notes: 3 cards carry a recorded reason
(`noAnimation`), but the comparison is **not** automatic — a card's start/end formation and timing
are not currently checked against the corpus by any gate.

**Corpus hash.** Each gate records a hash of the corpus asset set. When the corpus is later re-levelled,
`--check` reports the drift instead of the book quietly changing. **Not built as described**: the
animations catalogue is checked for drift against itself, not against a recorded corpus hash.

### 6.3 The call card template

**The plan, as approved:**

1. **At a glance** — start formation → end formation, beats, teaching unit, level.
2. **Figure** — start board, end board, dancer tracks (or the recorded reason there is none).
3. **Dance action** — the manual's sentence, quoted and attributed.
4. **What you actually do** — original beginner prose, second person, no unlinked jargon.
5. **Styling**.
6. **Restrictions** — see §6.4.
7. **Common faults and the fix.**
8. **Where you meet it** — links to class pages.
9. **Related calls** — links, never restatements.
10. **Manual source** — section and page, with the notice.
11. **Also called / formerly** — where the 2026 name differs from what dancers say.

**What was built.** Every card carries the same headings in the same order — measured across all 78
cards, not sampled. Ten headings are on every card; *Restrictions* is an eleventh, on 54 of them:

```
At a glance · Animation · Dance action · What you do · Timing · Styling ·
[Restrictions] · Common faults · Where you meet it · Related calls · Also called / formerly
```

| Planned | Built | Note |
|---|---|---|
| **Figure** | **Animation** | the heading the site builder injects the player under; there is no per-call image (§6.1) |
| — | **Timing** | added as its own section rather than a cell in *At a glance* |
| **Restrictions** as item 6 | present as a heading on **54 of 78** cards | placed after *Styling*, before *Common faults*; the other 24 cards have no restriction to state |
| **Manual source** per card | **once per unit file** — 50 lines, not 78 | the citation is the *unit's* (e.g. M1's covers pages 24–25 for all three of its cards) and sits at the foot of the file |
| **Level** in *At a glance* | **Unit/part** | the level is always Mainstream, and the unit is the useful fact |

Each unit file opens with a blockquote naming the teaching unit, its effective date and its
prerequisites, and the *At a glance* table is what the site build composes the page description from.

Course pages contain **only the plan** (goals, units, prerequisites, drills, checks) and link to call
pages; they never restate a dance action. **As built, verified:** no course page carries a *Dance
action* block.

### 6.4 What the Plus manual contributes to the *Mainstream* chapters

Its section **"Mainstream Restrictions that are Removed at Plus"** is authoritative evidence that
Mainstream definitions carry restrictions. At Mainstream:

- **Courtesy Turn** can start only from a **Normal Couple** (and the Mainstream restrictions on
  **Right and Left Thru** and **Chain Down the Line** follow from it);
- **Pass the Ocean** can start only from **Facing Couples**;
- **Swing Thru** / **Left Swing Thru** can start only from a **Wave of at least 3 or an Alamo Ring**.

**Each belongs on the Mainstream call card** — a beginner book that omits them teaches improper usage.

**As built, verified on the cards themselves:** Courtesy Turn states the Normal Couple restriction
(`m09`), Pass the Ocean states "Restricted at Mainstream to Facing Couples only" (`m35`), and Swing
Thru's card starts from an Ocean Wave or an Alamo Ring (`m33`). 54 of the 78 cards carry a
*Restrictions* section at all.

The Plus manual also **generalizes the Facing Couples Rule** to any formation where dancers can step
forward to a wave (facing dancers → Mini-Wave; facing couples → Ocean Wave; facing lines → Tidal Wave;
Eight Chain Thru → Parallel Waves; Right and Left Grand circle → Thar), and names the calls it applies
to — the Plus calls, **plus three Mainstream calls: `Swing Thru`, `Left Swing Thru`, `Spin the Top`**.

### 6.5 Practice material

- `poc-teacher/src/teacher.ts` — `generateTips(seq, available, priority, opts)` builds **zeroes** that
  start and finish in the squared set. Good source for per-class drills.
- `modules/**/*.json` and `sequences/**/*.json` — the ceder corpus; **316 of 1652 modules translate
  successfully** (`"success": true`) and make good worked "dance a tip" examples with full-board tracks.

**As built:** neither was used. `06-practice/` is written from the class progression and the call
cards — `drills.md` and `how-to-practise.md` share the class pages' sequences rather than the ceder
corpus. The two bullets above remain a suggestion for anyone wanting worked full-board examples.

### 6.6 Order of work

Executed in this order, with one change: the gates landed **alongside** the content rather than before
it, and the checkpoint at step 4 became the `08-reference/` membership pages that ship with the book
(§6.1). Steps 2, 3, 5–9 describe what was done; where a named tool does not exist, see §6.2.

1. Scaffold `book/` and `check-links.mjs` **first** — gate before content so the structure cannot drift.
2. `clean-extract.mjs`; then **read both manuals properly**: the 50 Mainstream units, the naming and
   terminology sections, the Conventions and Rules, the teaching order, and the Plus restrictions
   section. Write nothing before this.
3. `classify-corpus.mjs`, `resolve-programme.mjs`, `reconcile-definitions.mjs`, then the human review.
4. **⏸ CHECKPOINT — stop and put it to the user.** Publish `CHECKPOINT-classification.md`: the three-way
   membership table, the corpus-classification table (every excluded file with its reason, including
   additions to `running_bear` / `grand_spin`), and every call with no figure, and why. This is where
   the scope risk concentrates, and it is cheap to fix before 100 files and expensive after.
5. Figure pipeline; verify determinism with `--check`.
6. `02-language/`, `03-rules/`, then `01-start/`.
7. The 50 unit files in teaching order, restrictions on the cards.
8. `05-course/`, `06-practice/`, `07-plus/`, `08-reference/`.
9. Full gate run; read-through of one concept page, one call page and one class page.

### 6.7 Acceptance checks

**The plan, as approved** (three of these tools were never written — see §6.2):

```
node book/tools/clean-extract.mjs         # both reading copies; reports unrepairable ranges
node book/tools/classify-corpus.mjs       # no unreviewed corpus classes
node book/tools/resolve-programme.mjs     # no unreviewed membership entries
node book/tools/reconcile-definitions.mjs # no unreviewed reconciliation entries
node book/tools/make-figures.mjs --check  # exit 0, "no diffs"
node book/tools/check-links.mjs           # exit 0: links, anchors, coverage, no orphans
```

**The commands that actually gate the book**, all run from the repo root:

```
npm run check:book                          # the gate: the three below, in order
node book/tools/check-links.mjs             # 109 pages, 50 teaching units, 75 playable calls
node book/tools/make-animations.mjs --check # 75 playable calls reproduce exactly
node book/tools/make-animations.mjs --verify # 75 verified, 303 pose evaluations, 3 with a reason

node book/tools/make-formations.mjs --check # 19 formation diagrams reproduce exactly, 2 with a reason  (NOT in check:book)
node book/tools/make-diagrams.mjs --check  # 4 diagrams reproduce exactly          (IS in check:book)
node book/tools/clean-extract.mjs           # not a gate: regenerates the reading copies on demand
```

**Last run: all of the above exit 0.**

---

## 7. Open questions for the next session

**All four were put to the user and answered; they are kept with their answers so the decisions are
not re-litigated.**

1. **Twelve classes or the plain 50-unit order?** — **Twelve classes.** `05-course/` carries
   `course-overview.md`, `class-01.md` … `class-12.md` and `teaching-a-class.md`, and the unit files
   link into them from *Where you meet it*. The manual's plain order remains visible on every card as
   its *Unit/part* cell.
2. **A call with no admissible figure** — **omit it, and say why on the page.** `conventions.md` states
   the rule ("An animation is also shown only where it agrees with the 2026 definitions"), and
   `animations-index.md` lists the calls with none. Three cards carry a recorded machine reason
   (`m04a`, `m14b`, `m32c` — `no corpus title`); **54** start labels are listed with `"calls": []`
   because no authoring can animate them, and **5** cards (`m03c`, `m12c`, `m14a`, `m15b`, `m15c`)
   have `"starts": {}` because their manual wording is prose rather than a list.
3. **The Plus appendix** — **the bridge plus an index**, not full Plus call cards: `07-plus/` holds
   `where-mainstream-leads.md`, `plus-programme.md` and `plus-call-index.md`. Growing it into cards is
   still open work, and the same pipeline supports it.
4. **Is there more source material?** — **No more was supplied.** `docs/downloads/teaching.callerlab.org/mainstream/`
   still holds exactly two teaching pages (`right-and-left-thru-definition`, `veer-definition`). The
   *(New) Mainstream Playbook*, a lesson plan or course notes would still be welcome: pacing and class
   grouping are the least-evidenced part of the book, and §6.5's practice sources were not used.

---

## 8. Repo working rules that apply here

From the root `HANDOVER.md`, all of which have paid off repeatedly:

- **Measure, do not reason.** Every claim in a doc should be a number or an observation from a checked-in
  harness or a throwaway probe. This session's own corrections (`grand_spin`/`running_bear` are not calls;
  `sequencer="no"` is not a membership signal) came from reading, not from thinking.
- **Write probes as `.mjs` files**, never `node -e` — PowerShell quoting mangles them.
- **Never round-trip a text file through PowerShell.** `Get-Content` in PowerShell 5.1 decodes UTF-8 as
  windows-1252 and `Set-Content -Encoding UTF8` writes the rubbish back, so a move-and-edit becomes a
  silent corruption of every non-ASCII character in the file. Move with `git mv`/`Move-Item` (byte-exact)
  and edit with the editor or Node's `readFileSync(…, 'utf8')`. This cost one page fourteen em dashes
  before anyone read it; `check-links.mjs` now fails on the sequences it leaves behind.
- **Never rebuild `engine/dist` while a suite is running.**
- **Gate it in the same commit**, or say why the gate has to land in the next one.
- **An instrument's silence is the bug.** A zero must say whether it is a coverage gap or a genuine
  absence — which is why every gate here fails on *unreviewed* rather than skipping.
- **A corpus count improving is not evidence a change is right.**
- **Correct the docs when the code disproves them**, including your own earlier statement.
- `HANDOVER.md` is **not** updated during work — only when a session ends and the user asks.

---

## 9. State of the workspace

- **The book is built and the gate is green.** `book/` holds 109 files, 50 unit files, 78 call cards,
  19 formation PNGs, 3 position SVGs, the player, the generators, the gate and the built site.
- **`book/` is tracked but uncommitted** (`git status` shows ~120 modified files, the two renames and a
  handful of new ones). The reading-order change is among it: `01-start/how-this-book-is-organised.md`
  moved to the root, the old `index.md` became `contents.md`, and a new `index.md` is the Introduction
  and the landing page. `docs/` and `scripts/deploy-book.mjs` are untracked, and `package.json` plus
  `poc/src/assets/ms/circle.xml` carry uncommitted modifications from earlier work.
- **The book has been deployed to S3, and the working tree has moved on since.** Nothing has been
  uploaded since the user's "don't auto deploy" instruction, so the bucket
  (`util.awltux.trade`, prefix `dancingsquared_book`) is missing the navigation pin and text-size
  controls, the contents-and-introduction swap, the contents reflow and the two new formation images.
  Deploying is an explicit instruction, never a build step. The live bucket was not checked from here;
  `book/tools/check-links.mjs` and the built site are what this file's numbers describe.
- **The built site is gitignored** (`book/.gitignore`): reproducible with `npm run build:book`, so it
  is not part of what a commit needs to carry.
- **Immediate next steps, in the order they matter:** place or delete the two orphaned diagrams in
  `book/diagrams/` (`make-diagrams.mjs` is already in `build:book` and its `--check` in `check:book`);
  wire `make-formations.mjs --check` into `check:book`; decide whether the reference pages need a real
  `--check` mode (they are ungated today); then commit `book/`.
- **Corrected while updating this file, in `README.md`:** its start-label counts said 112 labels / 60
  wired / 52 waiting; the table is now 118 / 64 / 54. One claim in that same paragraph is still
  unverified rather than disproved — "up to 36 for Cast Off Three-Quarters" is true of M45, but the
  corpus's largest single card is now M36 Extend with 42 authorings.
