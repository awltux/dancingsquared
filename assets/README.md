# `assets/` — the corpus

Every call animation the engine, the book, the POC, the teacher and the game play comes from this directory.
There is **one** copy of it: its location is written once, in [`vite.corpus.ts`](../vite.corpus.ts), and every
reader reaches the same constant — the Vite apps through the `@corpus` alias, Node through
[`packages/corpus`](../packages/corpus/) (`filesOf`, `readFile`, `tamsOf`). Nothing here is edited by hand except
by a corpus change with its own gate; almost everything is either upstream's or generated.

Declared conventions (measured, and the numbers live in the harnesses named beside them):

| | |
|---|---|
| authored call files | **499** in nine level directories, plus `src/calls.xml` (the call index) — the 500 files `filesOf` walks |
| `<tam>` blocks | **5,489** |
| distinct call titles | **2,191** (`engine/test/corpus-inventory.mjs`, `engine/test/call-titles.mjs`) |
| generated instances | **7** `*.virtual.xml` (see below) |

## What is here

| Path | What it is | Who writes it |
|---|---|---|
| `ms/`, `plus/`, `a1/`, `a2/`, `c1/`, `c2/`, `c3a/`, `c3b/` | The programme levels: one XML file per call family, one or more `<tam>` per file. **66 + 50 + 36 + 26 + 87 + 79 + 84 + 66 = 494 files.** | upstream Taminations |
| `discovered/` | Calls found while working this corpus and not authored upstream (5 files, 7 tams). | this repo |
| `src/calls.xml` | Upstream's **master call index**: 690 `<call link="level/file" title="…">` rows, with `?animname=` fragments selecting one tam in a multi-tam file. Not animation data — the POC reads it to synthesise the one level the corpus has no directory for (`ssd`). | upstream Taminations |
| `moves.xml` | The move primitives: **156** `<path>` definitions, each a chain of cubic Béziers. The one file whose `<move>` modifiers (`offsetX`, `scaleX`, `beats`, `hands`, `reflect`) the engine implements — `engine/src/convert.ts` is the only reader of them in either codebase. | upstream Taminations |
| `formations.xml` | **292** `<formation name="…">` entries under a `<formations>` root: a name, its dancers' spots and facings, and its stored `fid`/`aid` (below). **MODIFIED from upstream** — `d244996` rotated `Static Square` by 90°, so do not "restore" it. Also a generated mirror of an upstream Dart list, so it drifts in both directions (`taminations.md` §2.3, §9.6). | upstream Taminations, then this repo |
| `fsm-ms.json` | The generated Mainstream resolve state machine (291 catalogue entries, 3,934 edges — `engine/test/fsm-asset.mjs` pins both), serialised so the FSM view and the teacher app open instantly. | `node scripts/build-fsm-asset.mjs` |
| `<level>/<family>.virtual.xml` | Whole-set instances generated for the book. **Not authored data** — see below. | `node book/tools/make-virtual.mjs` |

**`ssd` has no directory, and that is not a gap.** `PERMISSION_LEVELS` names ten levels but the corpus carries
nine directories: `ssd` is a VIEW of calls authored under `ms`/`plus`/`a1`, whose basenames `src/calls.xml` records,
and the POC synthesises it at load time (`poc/src/data.ts`). So `filesOf('ssd')` is `[]` — by design, and
`engine/test/corpus-inventory.mjs` pins that a missing level is an empty list rather than an error.

## A call file's shape

```xml
<?xml version="1.0"?>
<!DOCTYPE tamination SYSTEM "../src/tamination.dtd">
<!-- Copyright 2023 Brad Christie … GNU Affero General Public License … -->
<tamination title="Circle Family">
  <tam title="Circle Left Home" from="Static Square" formation="Static Square" parts="" vid="V1-…">
    <formation> … <dancer gender="boy" x="-1" y="-3" angle="90"/> … </formation>
    <path> … <movement hands="none" beats="4" cx1="…" x2="…" …/> … </path>
  </tam>
</tamination>
```

- The root element is `<tamination title="…">` — **singular** — and its `title` is the FAMILY a reader files the
  file under (`parseTaminationTitle`). A file holds one or more `<tam>`s; a level's file list is read by
  `filesOf(level)` in directory order, and that order is load-bearing (it pools a multi-authoring title's tams).
- The DOCTYPE names `../src/tamination.dtd`, **which is not in this repository**: every parser here ignores it.
  Do not add one to satisfy the line.
- Coordinates are **dancer-local**: the origin is the dancer's spot when the movement begins, +X is the dancer's
  facing, and **+Y is the dancer's own left** (`moves.xml`'s own header says so). Get that wrong and every path is
  mirrored.
- A `<tam>` attribute the engine reads and a reader should not "tidy away": `sequencer` (`no` means a
  demonstration, not a callable variant), `actives` (WHICH dancers the paths describe), `asymmetric` (how many
  copies of the written dancers make the set).
- **The three stored ids.** A formation DEFINITION — in `formations.xml` or a `<tam>`'s own `<formation>` block —
  carries `fid="F3-…"` and `aid="A1-…"`: its formation identity and its arrangement identity, written once and
  authoritative thereafter (a geometry edit leaves them alone, which is what replaced the root ledger). A `<tam>`
  carries `vid="V1-…"`: the CALL VARIANT it realises, `callVariantId(level, title, fid)` where the level is the
  directory the file lives in and the fid is the definition the tam starts from (its inline block if it authors one —
  the block wins at load time — otherwise the one it names). Unlike `fid`, a `vid` is **fully determined** by the
  tree, so a retitle or a level move re-mints it and `engine/test/variant-tags.mjs` fails until it is re-tagged. The
  one place they are all maintained is `scripts/tag-formations.mjs` and `scripts/tag-variants.mjs`; a generated
  `*.virtual.xml` instance carries `parent_id` instead — the variant it was *placed from*.

## Where the files came from — Taminations

The animation XML is **Taminations**: [Brad Christie](https://github.com/bradchristie/taminations-flutter)'s
Flutter app, checked out here as the git submodule `taminations-flutter/` (read-only reference — **never port its
code**, `AGENTS.md` §6). The submodule is not initialised in a fresh clone:

```bash
git submodule update --init taminations-flutter   # the reference, for reading only
```

- **Licence.** Every copied `.xml` carries its own header: *"Copyright 2023 Brad Christie … GNU Affero General
  Public License … version 3 or later"*. The animation data we distribute is therefore **AGPL-3.0-or-later**, and
  the headers travel with the files. Do not strip them, and do not relicense this directory.
- **What was taken, and what was not.** The XML only. Upstream also ships 777 written call definitions (`.md`),
  1,139 PNGs and 194 pronunciation `.mp3`s — `taminations.md` §3 measures that, and none of it is here; §12 ranks
  what is worth mining next.
- **The measurements behind all of this are [`taminations.md`](../taminations.md)** — provenance, the licence
  situation per file type, the deliberate divergences, and the traps. Read it before assuming an upstream file can
  be copied over ours. Two divergences are already recorded there: `formations.xml` is modified (above), and
  `discovered/` is ours.
- **Do not regenerate this directory from upstream.** `formations.xml` would lose its rotation, and the levels the
  corpus's own gates pin would move. A corpus change is a change with a gate
  (`node engine/test/corpus-inventory.mjs`, `node engine/test/call-titles.mjs`, `node engine/test/formation-tags.mjs`).

## `*.virtual.xml` — the generated whole-set instances

Seven files, e.g. `ms/circle.virtual.xml` beside `ms/circle.xml`:

```
ms/box_the_gnat.virtual.xml   ms/circle.virtual.xml     ms/circulate.virtual.xml   ms/dosado.virtual.xml
ms/lead_right.virtual.xml     ms/promenade.virtual.xml  ms/swing.virtual.xml
```

**What they are.** Part of the corpus is authored for PART of the set — `Promenade` from `Facing Couples Far` writes
two dancers, `Dosado` two — so it cannot be applied to a whole board and cannot be drawn as a whole-set picture.
The engine's answer is the **virtual call**: `placeVirtual` places the written unit on a whole board and keeps the
placement only if it STARTS and ENDS on a formation the namer recognises
(`engine/src/sequencer/virtual-call.ts`). `book/tools/make-virtual.mjs` materialises a chosen placement as a
whole-set `<tam>` and puts it **beside the family it was placed from**, so the book's player fetches it by
`(file, tamIndex)` like any other authoring.

**They are not authored data, and the suffix is the whole rule.** `packages/corpus/virtual.ts` owns
`.virtual.xml`: `filesOf` never returns these files, `virtualFilesOf` is how a caller asks for them, and both Vite
app loaders filter their glob keys with the same predicate. A census of authored tams that counted them would be
counting boards nobody authored — MEASURED: without the exclusion `make-virtual.mjs`'s own dead-row check read its
seven tams as new eight-dancer authorings.

**Each one names the variant it was placed from**, as `parent_id`:

```xml
<tamination title="Circle Family">
  <tam title="Circle Four Left" from="Static Square" parts="" asymmetric="true" parent_id="V1-85721b7k">
```

`parent_id` is the engine's **call-variant id** of the SOURCE authoring —
`callVariantId(level, sourceTitle, fid)`, where `fid` is the tag STORED on the definition the source starts from
(`VirtualCallInfo.sourceFid` when the source authored its own setup, otherwise the named definition's `fid`). It is
the identity a consumer dedupes on: several authorings of one variant share it by design.

**They are generated, so do not edit them.** The source of truth is
[`book/tools/virtual-placements.json`](../book/tools/virtual-placements.json) — one row per card: the call, the
board to place it on, and why — and the generated index is
[`book/tools/virtual-index.json`](../book/tools/virtual-index.json) (`file`, `tamIndex`, `title`, `parentId`,
`level`, the reading the permission layer allowed, and the end formation). A row marked `refused` is a CLAIM, and
the tool re-verifies it: today one call is withheld with the engine's own sentence.

## Finding the tam a `parent_id` names

The id is a digest of (level, title, the start definition's stored `fid`), so it cannot be inverted — the way back
is to build the candidate authorings and mint their ids. That is what
[`book/tools/find-variant.mjs`](../book/tools/find-variant.mjs) does, with the engine's own arithmetic:

```bash
node book/tools/find-variant.mjs --virtual=ms/circle.virtual.xml
```

```
ms/circle.virtual.xml is "Circle Four Left" from ms, placed from variant V1-85721b7k
  ms/circle.xml#77  "Circle Four Left"
      variant V1-85721b7k   start shape F3-rj0qnzj7   fid F3-rj0qnzj7
1 authoring(s) mint V1-85721b7k — built 4, skipped 0 that do not load, over 10 level(s)
```

`#77` is the **tam index** in that file — the same index `loadCallFromXml(xml, moves, formations, 77)` and the
book's `(file, tamIndex)` take. Use the manual form when you already have both halves, or drop the id to see every
variant one call has (what a placement row is written from):

```bash
node book/tools/find-variant.mjs V1-85721b7k --title="Circle Four Left"
node book/tools/find-variant.mjs --title="Swing Your Partner"
```

Two answers that look wrong and are not: an id can name **more than one authoring** (`Swing Your Partner`'s
`ms/swing.xml#0` and `#8` share one, because the fid covers a start SHAPE and not a board), and an id can name
**nothing** — a retitle or a re-levelling mints a new variant id, while a corrected *formation* keeps its stored
tag and therefore its variants.

## Deleting, and recreating, one virtual tam

**Never edit a `.virtual.xml` by hand.** `make-virtual.mjs --check` round-trips every committed file and compares it
byte for byte with a fresh render, so a hand edit is a red gate rather than a small drift. All three of the
following are safe, and they differ in what else moves:

**1. Delete a placement (the normal way).** Remove its row from `book/tools/virtual-placements.json`, then:

```bash
npm run build:engine                    # the tool loads engine/dist; it does NOT rebuild it for you
node book/tools/make-virtual.mjs        # rewrites every instance, DELETES any file no row produces (it says so)
node book/tools/make-virtual.mjs --check
```

Deleting one row removes one `.virtual.xml` and the card falls back to "no animation" — which the book reports by
name (`make-animations.mjs` lists it under NOT PLAYED), rather than drawing a fragment.

**2. Delete just the file, then regenerate.** Deleting the artefact alone breaks nothing at load time — the file is
not in `filesOf`, so no reader ever had it. Two things do go red, which is the point: `make-virtual.mjs --check`
reports `DRIFT assets/ms/<family>.virtual.xml`, and `engine/test/corpus-inventory.mjs` reports `INSTANCE GONE` for
it. `make-animations.mjs --check` also reports `DRIFT animations-index.json`, because the card that used it now
records no picture. To put it back:

```bash
node book/tools/make-virtual.mjs        # "7 placement(s) in 7 file(s), 1 refusal(s)"
node book/tools/make-virtual.mjs --check
npm run check:book                      # the book's own gate over the regenerated artefacts
```

**3. Recreate ONE without disturbing the others.** Running the tool rewrites all seven, deterministically: the six
you did not touch come back with identical bytes. Prove it rather than trusting it —

```bash
git diff --stat        # nothing for the six, a line only for the file whose content really moved
```

If `git status` lists all seven as modified while `git diff` shows nothing, that is line endings and not content:
the tool writes LF and this checkout is CRLF, so the stat cache is stale (`git status` is the misleading one here —
`git diff` compares the bytes it will actually store). Read the diff before reaching for `git checkout -- …`; that
would discard a real change.

**If the tool refuses, nothing is written.** It reports the placement or the row by name — the board does not stand
up, no reading the permission layer allows, an ambiguous placement, a level that authors no call with that title —
and exits 1 with all seven files untouched. That refusal is the tool's product, not a failure of it: a placement is
a search result recorded once, and the row is re-verified on every run.

**Change a placement (a different board, or the index's reading).** Edit the row's `board` (and its `why`, which a
reader sees), then regenerate and check as above. Do not hand-edit the generated file to "just move a dancer": the
round trip would re-derive the placement and the `parent_id` from the row either way.
