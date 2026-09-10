# all8.com fixtures

Three fixtures, all from Rich Reel's all8.com, all stored verbatim and all
independently checkable against the site. Attribution to Rich Reel / all8.com must
be retained in any reuse.

1. `all8-getouts.json` — the get-out corpus (the independent oracle). Documented below.
2. `all8-arrangements.json` — per-formation arrangement tables. See §"Arrangement
   tables" below.
3. `all8-16-states.json` — the 16 possible FASR states per formation, with All8's
   own resolve hints. See §"The 16 states" below.

---

# 1. Get-out corpus (`all8-getouts.json`)

An **independent oracle** for the engine's getout/resolution logic: get-outs
published by a caller, not derived from this codebase. Its value is that it can
disagree with us — and it does (see "What it already tells us").

## Provenance

- **Author / source:** Rich Reel, <https://www.all8.com/sd/calling/getoutd.htm>
  ("Square Dance Setup Diagrams for Getouts"), with one page per alignment
  (`go_*.htm`). Fetch dates and per-alignment URLs are recorded inside the JSON.
- **Notation reference:** <https://www.all8.com/sd/calling/fasr.htm>.
- The corpus is stored **verbatim**: abbreviated call names, leading marker
  characters and ordering are exactly as published. Nothing is normalised here, so
  the file can be re-verified against the site.

## Schema

```json
{
  "source": "…getoutd.htm",
  "fetched": "YYYY-MM-DD",
  "alignments": [
    {
      "id": "B1p",
      "url": "…/go_b1p.htm",
      "family": "Box / 8-Chain",
      "title": "Facing Partner In Sequence Box",
      "diagram": "v2 v1\n^2 ^1\nv3 v4\n^3 ^4",
      "description": "Everyone Facing Their Partner In Sequence",
      "getoutLines": ["--PasTh  --AL", "   --BxGnt  --RLG", "…"],
      "plusLines": ["…"],
      "conversionLines": ["…"]
    }
  ],
  "failures": []
}
```

`getoutLines` / `plusLines` / `conversionLines` are raw published lines.
`failures` records any alignment page that could not be fetched, so a partial
corpus is visible rather than silent.

## The alignment notation (FASR)

All8 writes a setup as `[Arrangement Formation Sequence Relationship]`, e.g.
`[L1p]` = standard arrangement, **L**ines, **1** (both in sequence), **p**
(reference boy with his **p**artner). When the arrangement is omitted it means
standard.

- **Formation** — single Callerlab letters (`B` Box/8-Chain, `C` Column,
  `D` Diamonds, `F` 2-Face Lines, `L` Facing Lines, `M` Completed DPT,
  `P` Beginning DPT, `Q` Quarter Tag, `R` Three-Quarter Tag, `S` Squared Set,
  `T` Trade By, `W` Parallel Waves) plus All8's two-letter extensions (`TW` Tidal
  Wave, `TL` Tidal Line, `LO` Lines Facing Out, `F.C` Magic Column …).
  Handedness prefixes: `L.` left-hand, `F.` ends R-H / centers L-H, `X.` the
  reverse.
- **Arrangement** — 6 states: `0` normal, `5` sashayed (1/2), `1`–`4`.
- **Sequence** — 4 states: `1` both in, `2` both out, `3` boys in/girls out,
  `4` boys out/girls in.
- **Relationship** — 4 states: `p` partner, `c` corner, `o` opposite girl,
  `r` right-hand girl.
- **Total FASR** adds Orientation (0/90/180/270) and Occupation (head/side).

The arithmetic that matters: **6 arrangements × 4 sequences × 4 relationships =
96 scrambled states per formation**; 16 with a known arrangement; 4 with an
arrangement plus one partner paired.

## How this fixture is used

`engine/test/getout-conformance.mjs`:

1. **Fixture integrity is a hard failure** — unique ids, valid all8.com URLs,
   non-empty line lists, and a line count high enough to prove the corpus is not
   truncated. A silently-partial corpus would be worse than none.
2. **Call-name coverage** decodes each published line with a *conservative*
   abbreviation table and reports which call names the engine's catalogue does not
   register. The table is **ours, not All8's** — All8's own notation reference
   (`help.cgi`) returns HTTP 500 — so tokens we cannot read with confidence are
   counted as undecoded rather than guessed, and group-scoped readings
   (`B-Run` → "Boys Run") are reported separately instead of being compared,
   because a composed name is our reading rather than a name All8 prints.
3. **Alignment coverage is reported, not gated** — All8 indexes get-outs by
   alignment, so a real conformance run needs a board in that alignment. The engine
   has no mapping from All8 alignment ids to a board, so today this reports the
   corpus rather than exercising it.

## What it already tells us

- **The FASR target model is right.** Get-outs are indexed per alignment, not per
  formation, so requiring the home FASR (sequence + relationship), not just the
  geometry, is correct.
- **Relationship is under-modelled.** All8 defines 4 relationship states; the
  engine records 2 fields (`partner`, `corner`), so `o` and `r` collapse to the
  same `fasrKey`. Measured on the home square: 8/8 have a partner, 8/8 a corner,
  0 neither.
- **The FSM state drops the alignment.** It keys on the normalised formation only,
  so up to 96 alignments per formation become one state.
- **Call-name gaps are real and load-bearing.** Sampling `[B1p]`'s own first
  get-out (`Pass Thru > Allemande Left`) from the engine's Eight Chain Thru board
  leaves an *unrecognised* board; `Square Thru 1/5` and `Eight Chain 1/5` are not
  registered at all (`Unknown call`); `Box the Gnat`/`Rollaway` are not legal from
  that board.
- **Target semantics differ.** All8's lists typically end at a conventional finish
  (`--AL`, `--RLG`, `--Prom`) — a state from which the standard ending resolves —
  whereas the engine demands the literal home board.
- **Hand-use matters.** All8 notes that some get-outs require a free right hand
  (`T1/4`, `SqThr`, `SwThr`) and recommends neutral-flow openers otherwise. The
  engine's search does not model free-hand availability.

## To refresh

Re-fetch the `url` of each alignment (or the index, to pick up new alignments) and
rewrite the file with the same verbatim discipline; keep `fetched` and `failures`
honest. Attribution to Rich Reel / all8.com must be retained.

---

# 2. Arrangement tables (`all8-arrangements.json`)

**Source:** <https://www.all8.com/sd/calling/arrngdia.htm> — "Arrangement
Diagrams", 36 formations, each with its 6 arrangements drawn over the formation's
own facing layout.
**Refresh:** `node test/tools/fetch-arrangements.mjs` (network needed here only,
never in `npm run verify`; the tool prints every table it parses, which is worth
eyeballing).

## Why it exists

Arrangement says *which spots are occupied by boys and which by girls*, but **which
number a pattern gets depends on the formation**. All8's generic 6-pattern list
(`BGGB`→0, `GBBG`→5, `GBGB`→1, …) reads a **wave**, and is only right there: in a
wave arrangement 0 really is `BggB`, but arrangement 0 of Facing Lines is `gBgB`,
which that list would call 1. So an arrangement number cannot be computed from a
universal rule; it has to be looked up per formation.

## Schema

```json
{
  "keys": { "numberOrder": [0, 5, 1, 2, 3, 4] },
  "formations": {
    "B": {
      "rows": [
        { "facing": "vv", "gender": ["gB", "Bg", "BB", "gg", "gB", "Bg"] }
      ]
    }
  }
}
```

- `rows` are top row first, as printed; each `facing` string gives one character per
  column: `^` north, `v` south, `<` west, `>` east.
- `gender` is in the **printed column order `0, 5, 1, 2, 3, 4`** — recorded in
  `keys.numberOrder` so the order can never be silently assumed to be numeric. Entry
  `k` is one character per column: `B` boy, `g` girl.

## How it is used

`engine/test/alignment.mjs` requires the hand-written tables in
`src/sequencer/alignment.ts` to equal this file cell for cell (96 cells across the 6
mapped formations). Transcribing tables by eye is the obvious failure mode, so it is
checked rather than trusted — and the engine's own templates must independently read
as arrangement 0, which they do.

# 3. The 16 states (`all8-16-states.json`)

**Source:** `https://www.all8.com/sd/calling/16com_<b|p|l|f|w>.htm` — one page per
formation, from "16 Possible Pairings with Standard Arrangement".
**Refresh:** `node test/tools/fetch-16-states.mjs`.

Each page enumerates the complete set of FASR states reachable at standard
arrangement — 4 sequences × 4 relationships = 16 — and labels each with a short
resolve hint (e.g. `[0B1c]` → `"AL"`, meaning an allemande left works from there
straight away; `[0B1o]` → `"DixiG"`).

Two things make it valuable:

- **It confirms the 4×4 model.** All five formations yield exactly 16 distinct
  states covering every sequence/relationship pair, which is the arithmetic this
  whole workstream rests on (6 arrangements × 4 × 4 = 96 per formation).
- **The hints are an independent source of "which resolves work from here"**, to be
  set against the engine's own search in step 4. `[0B1c]` → `AL` pairs directly with
  the corpus's `[B1p]` get-out `Pass Thru > Allemande Left`: a pass thru must move a
  `p` board to `c`.

Caveat recorded in the file: the page grids are built from nested tables, so the
scraped *order* is not the visual order. The *set* is complete, which is what is
used; no claim is made about layout.
