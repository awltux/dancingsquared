# Dancing Squared — 3D Square Dance Engine (Proof of Concept)

A minimal but complete vertical slice proving the pipeline from
`prd.md`:

```
taminations XML  →  converter  →  normalized bundle  →  pure engine  →  Three.js 3D avatars
```

It ingests **real taminations data** (`moves.xml`, `formations.xml`, and two
per-call files), resolves the move-reference graph at load time, evaluates
dancer poses from cubic Bézier paths, and renders **3D humanoid avatars**
with hand-holds (arm IK), path trails, and subtle body twist.

## Run it

This is part of the `dancing-squared` npm workspace. From the repo root:

```bash
npm install          # install everything (workspaces)
npm run build:engine # build the engine (the poc depends on its dist/)
npm run dev          # start the Vite dev server, open the printed URL
```

Equivalently, inside `poc/`: `npm install`, then `npm run dev` (after the
engine is built).

Open the URL Vite prints (default `http://localhost:5173`). Use the HUD to
pick a **level** (B1, B2, SSD, MS, Plus, A1, A2, C1, C2, C3A, C3B, or "All
levels"), which filters the **Call** dropdown (~630 call entries), choose a
setup, and play/pause, scrub, and change speed. Drag to orbit the camera. Each
avatar has a small yellow **"nose" cone** marking its facing direction so
orientation is visible. Dancers are **colour-coded by couple** (1=red, 2=yellow,
3=green, 4=blue) and **women have a distinct shape** (narrower torso + flared
skirt) so gender is readable from the silhouette as well as colour.

## Sequencer mode

Switch the **Mode** dropdown to **Sequencer** to build and validate a call
sequence on the 8-dancer board:

- Pick a **level** (SSD, MS, Plus, A1, …) to restrict which calls are available.
  Levels are **cumulative** (each builds on the earlier ones — e.g. B2 includes
  B1, MS includes B1/B2/SSD), unlike the browse mode, which shows only the calls
  specific to the selected level. Then pick a call and **Apply** — the board
  advances, illegal calls are rejected with a reason. The call picker shows
  **only calls legal from the current formation** (refreshed after every
  apply/undo/reset).
- **Undo** / **Reset** to step back or start over.
- **Getout** searches (bounded) for a sequence back to a Squared Set.
- **Fix it** lists the calls that keep a getout alive.
- **Save module** names the current sequence as a reusable fix/getout module; modules
  behave like single calls, appear in the call picker (tagged "module"), are
  persisted in `localStorage`, and are considered by Getout/Fix it.
- The readout shows the recognized formation, arrangement, sequence parity, and
  dancer 1's partner/corner (FASR).

The board uses the same 3D avatars (colored by gender; identity is tracked as 4
couples internally and reported in the FASR readout).

The **Facing** dropdown lets you pick how dancers orient:

- **Rotation Bézier (data)** — the authoritative taminations facing, taken
  from each movement's dedicated rotation Bézier (`cx3/cx4/cy4/x4/y4`, falling
  back to the travel tangent when absent). This intentionally makes a dancer
  walk **forward or backward** along the path — e.g. in a Wheel one partner
  backs up while the other walks forward.
- **Along travel** — always faces the instantaneous direction of motion (the
  translation-tangent heading), i.e. "always walk forward".

**Full square (duplicate half)** — taminations authors many calls for only
**one half** of the set (e.g. Brace Thru "Lines, Boys Ends" is a single line of
4). When checked, the engine adds the duplicate half by rotating the base
dancers **180° about the origin** (`(x,y) -> (-x,-y)`, `heading ->
heading + 180°`) to build the full move. Duplication is auto-applied only when
it is unambiguous: it is skipped when a dancer's 180° partner already exists in
the formation (the formation already contains both halves, e.g. a full Squared
Set or an on-axis wave/column).

Uncheck it to view the authored half-group in isolation.

Playback **pauses ~2s on the starting formation and the ending formation** so
the start/end hand holds are clearly visible before and after the move runs.

Production build:

```bash
npm run build
npm run preview
```

## Headless engine verification

The engine is the standalone `../engine` package; this verify runs it in plain
Node against the real taminations data:

```bash
npm run verify
```

This requires the engine to be built (`npm run build` in `../engine`). It runs
`verify.cjs`, which asserts move-registry resolution, correct dancer
counts/end-positions, hand holds (lines/ring/Wheel/Allemande), and a full
catalog scan across all levels.

## Layout

The engine modules (`convert`, `core`, `handholds`, `types`) live in
`../engine` and are consumed as the `dancing-squared-engine` package. This app
only contains the browser/renderer layer:

| Path | Purpose |
|------|---------|
| `src/data.ts` | Browser layer: `?raw`-imports the XML assets (via `import.meta.glob`), **splits multi-call files** so every distinct `<tam>` title is its own call, builds the level-grouped catalog (incl. b1/b2/ssd aliases), exposes `availableCalls()` / `loadCall()`. |
| `src/scene.ts` | Three.js adapter: floor grid, low-poly **wireframe** humanoids (torso/head/2-seg arm IK/legs with a beat-synced **walk cycle** via `WalkCycle`), hand-hold connectors, path trails. |
| `src/main.ts` | Playhead (beats → ms), HUD wiring, play/pause/step/scrub, level filter, mode switch, frame loop. |
| `src/sequencer-ui.ts` | Sequencer panel: apply calls on the board, FASR readout, getout + fix-it buttons. |
| `src/editor-ui.ts` | Call editor: pick a call + start/end formation, generate a missing setup (padding core moves), preview, save to `localStorage`, export `<tam>` XML. |
| `src/assets/*.xml` | taminations data per level (`b1, b2, ms, plus, a1, a2, c1, c2, c3a, c3b`), plus `moves.xml` / `formations.xml` / `calls.xml` (GPL/A-GPL data; license headers preserved). |
| `verify.cjs` | Headless assertions over the engine + a full-catalog scan. |

## Call editor mode

Switch the **Mode** dropdown to **Call editor**. It has two distinct features,
selected with the editor's own **Mode** toggle (Fix closure / Create position).
Both share an **Edit call + Setup** (the call/setup being edited) and a **Post
call + Setup** (whose *start* position is the target end). Pre/post positions are
mapped to the edit call's dancer identities by aligning to its start, tolerating a
whole-set rotation.

**Fix closure** — correct an existing call setup that doesn't close cleanly (e.g. a
full Circle Left leaves the girls ~44° off, so the sequencer sees an unrecognized
formation). Pick the edit call+setup and a post call+setup; the editor shows the
end's heading/position offset from the post-call start, and **Fix closure**
retargets each dancer's **final move** so the setup ends exactly at the post-call
start — **without changing the beat count** (the existing moves' geometry is
adjusted, not their durations). Large corrections prompt a warning before applying.

**Create position** — synthesize a NEW position for the edit call. It starts at the
**Pre call + Setup**'s *end*, runs through the selected edit-call setup (the core),
and ends at the **Post call + Setup**'s *start*, with a new position name. The
result is shown on the 3D stage and can be played/scrubbed.

For both features: **Save** persists the result to `localStorage` (reusable this
session), and **Export &lt;tam&gt; XML** produces a paste-able taminations `<tam>`
you can drop back into the data files.

Each saved edit has an **apply to live** toggle. Applying it overrides the live
call-position database: `loadCall` returns the edited setup (a `fix` replaces the
setup, a `create` appends a new setup) **and the sequencer's call registration
delivers the edited `<tam>`** — so browse, editor and sequencer all use the edit.
Applied edits are **highlighted** in the saved list. These applied override flags
are stored with a data-version stamp and are **cleared on an app/data update** —
the live catalog reverts to the shipped version while your local edit definitions
are preserved, ready to re-apply. (Rebuild the sequencer — switch level or reload —
to pick up newly applied edits.)

The padding supports both **rigid re-bases** (pre/post positions congruent to the
core — the pads collapse to a whole-set translation/rotation) and **scripted
transitions** (non-congruent — dancers walk directly from their new spots into
the core). Mirrored (half-set) calls are handled by re-basing at their actual
full-set positions.

## Notes / current limitations

- **Install caveat:** in this sandbox `npm install` used `--ignore-scripts`
  because spawning esbuild's postinstall is blocked. On a normal machine a plain
  `npm install` is fine (the esbuild binary ships as an optional dependency).
- **Hand holds follow codified rules** (`src/handholds.ts`), ported from
  taminations' `handhold.dart`:
  1. A dancer only holds when it has a hand available — its `right` hand reaches
     its single nearest partner on its right, its `left` hand its single nearest
     on its left (one partner per hand).
  2. A hold exists only if the two dancers **mutually** reach each other (each
     is the other's chosen target). This keeps a couple together during a Wheel
     and stops opposite-couple dancers grabbing each other when they pass close.
  3. Partners must be within reach and roughly to the side (not directly in
     front/behind), so facing pairs about to pass through don't hold.
  Modes: **static** (resting — every dancer gets both hands, so a line/ring
  shows all joined) and **active** (uses the movement `hands`, so a Wheel keeps
  its grip, Circle Left forms a ring, and an Allemande reaches only its corner).
- **Facing is fully data-derived** — each movement carries an optional rotation
  Bézier that encodes the facing curve (so a dancer can walk forward or
  backward along a path). `diag.cjs` (after `npm run verify`) prints per-dancer
  facing vs. travel-tangent over time and confirms the analytic values match a
  numeric derivative. Run it with `node diag.cjs`.
- The 2D→3D mapping is `world = (x, 0, -y)` with `rotation.y = +heading`. These
  two signs **must stay matched** (`z = -y` ↔ `+heading`, or `z = +y` ↔
  `-heading`). If they get out of step, the body rotates **opposite** to its
  orbit (a chirality bug where dancers appear to spin the wrong way around a
  wheel). The same reflection flips left/right, so the avatar's local `+z` maps
  to the dancer's 2D *right* — the arm/side assignment must account for it or
  the dancers hold the wrong (crossed) hands. `npm run verify` includes a check
  asserting the body points along (or opposite) the orbit correctly.
- **The full catalog is wired in** (`src/data.ts` uses `import.meta.glob` over
  the per-level XML folders): real calls across **B1, B2**, MS, Plus, A1, A2,
  C1, C2, C3A, C3B load through the same converter, plus **SSD level aliases**
  (Standard Square Dance) derived from `src/calls.xml`. `npm run verify` runs a
  full-catalog scan and confirms every call loads. Non-call files (moves
  definitions and rule references without a `<tam>`) are excluded.
- **B1/B2 are the real animation files** fetched from the web
  `taminations-multiplatform` repo (`Taminations/src/assets/{b1,b2}`). **SSD**
  has no directory in that data and groups the same calls as MS, so SSD entries
  are aliases that load the shared ms/plus animation.
