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

Below the call, **"Used by N modules"** lists the named sequences that use the
selected call — the ceder-translated corpus plus any modules you have saved — with
the step number at which the call appears. Each has an **open** button that
switches to Sequencer mode with that sequence loaded WHOLE (its context before and
after the call intact) and the playhead parked where the call starts, ready to
play. The list shows the first 20 and summarises the rest.

A call is matched on its FULL name, selection included: browsing `Heads Pass Thru`
lists the modules that actually dance it scoped, not the far more numerous ones
that dance bare `Pass Thru`.

The corpus records where each module was written to begin, and those names are
ceder's, not the engine's — **168 of the 294 modules it offers start somewhere
other than home**. A label names a formation **and an arrangement**, and the
formation library only gets the first half right: `boardForFormation('Normal
Lines')` classifies as `[L0]` yet carries no identity at all and its couples are
authored **1,4,3,2**. So the start board is built from a FASR code:

| corpus label | start board | why |
|---|---|---|
| `Zero Line` | All8 code **`L1o`** | sequence in, facing couple-pairs `1-4` and `2-3` — the zero line's own FASR |
| `Static Square` | `Static Square` | home, where the library is right |

`L1p` is the near-miss: identical at a glance, but its facing pairs are
`1-2 3-4`, the wrong couples. `engine/test/tools/zero-line-probe.mjs` measures all
thirteen candidates side by side.

A label the engine cannot resolve is a **failure, not an approximation**: the
sequence view loads nothing and says which formation it wanted, because replaying
from the wrong board dances different calls and reads as "the sequence is broken".
`Zero Box` is deliberately in that state — the same question for `[B]` has not
been settled, so its modules refuse rather than run wrong. The status line names
the board actually used: `loaded 5 call(s), from L1o`.

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
- It also shows the board's **All8 FASROO code** — `[0L1pH+]` — whenever the board is
  a setup all8 has a name for. **FASROO, not FASR**, because a plain FASR code names
  a *class* of four boards, identical in every dancer's position, heading and gender
  and differing only in which couple number stands on which spot; it tells a caller
  where the board is, but it does not place the dancers. FASROO adds **Orientation**
  (H/R/O/L, how the reference boy is rotated from his home) and **Occupation** (`+`
  Head / `'` Side), and all8's word for the three together is a **setup**.
  `fasrooOf` does the whole reading, including the reference pair that `[L]`, `[B]`,
  `[F]` and `[W]` are the only formations Callerlab defines one for. A part that
  cannot be determined prints `?` rather than a guess, so a formation stood up from
  the library reads `[0L????]` (it carries no identity) and `Static Square` prints
  nothing at all, because All8 gives it no letter.
- The code carries a **`?` marker**, and it is about the **Orientation letter** being
  unverified, not about the code being incomplete: all8 defines Orientation by
  superimposing the squared set, where the reference boy's home is a spot that does
  not exist in a line or a wave, and the engine compares bearings about the centre
  instead. The four boards do separate cleanly, one per orientation, so the structure
  holds — but treat the letter as indicative. Hover the marker for it.
  `engine/test/tools/fasroo-probe.mjs` shows the whole reading.

The board uses the same 3D avatars (colored by gender; identity is tracked as 4
couples internally and reported in the FASR readout).

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
| `src/editor-ui.ts` | Call editor: edit a taminations call INSTANCE (its start formation and arrangement, its end formation and its moves), fix a setup's closure, or generate a missing setup (padding core moves); preview, save to `localStorage`, export `<tam>` XML. |
| `src/assets/*.xml` | taminations data per level (`b1, b2, ms, plus, a1, a2, c1, c2, c3a, c3b`), plus `moves.xml` / `formations.xml` / `calls.xml` (GPL/A-GPL data; license headers preserved). |
| `verify.cjs` | Headless assertions over the engine + a full-catalog scan. |

## Browse mode: moving the dancers by hand

**Position** is the call's progress bar, and it is a *placement* control rather than only a
transport one: dragging it PAUSES the call and moves the dancers to wherever the call's own paths
put them at that beat, so you can walk them around the board a quarter-beat at a time instead of
watching the whole call. The **beat box** beside it does the same thing exactly — type `3.25` and
they are there — and both work in **absolute beats**, `0` at the first beat of the call, which is
what the readout (`beat 3.25 / 12.00 (27%)`) is measuring.

The bar is in beats rather than percent so that its own value is the number the beat box takes: a
percentage scrubber could not be read off, typed into, or compared between two calls. Dragging past
either end CLAMPS to the start or the end of the call rather than being refused, because that is the
honest answer at the end of a drag. The beat box is kept in step with the playhead each frame, but
never while it has the focus — writing into the field somebody is typing in is the classic way a
synced readout becomes unusable.

## Browse mode: the end formation, and naming one

Under the call picker, **End** says what formation the loaded call **finishes in** — the question a
caller actually asks of a call, and one the panel could not answer at all before. It shows the
name, whether that name is user-defined, the `[FASROO]` notation, and the Callerlab arrangement
number when it can be read; when nothing is named it shows what *is* known — the dancer count and
the gender pattern — rather than filling the gaps in.

**The answer is computed, not looked up.** The obvious alternative is the precomputed FSM asset,
whose edges carry an `endFormation` per (state, call). But the panel has the call *in hand*, so its
end board is one cheap read away (`boardAtBeat` — a `poseFor` per dancer at the last beat) and it is
always current, where the FSM is a build artefact that can lag the assets — and its `endFormation` is
itself produced by the same recognition, so it cannot name anything the recogniser cannot. Using the
FSM here would add a staleness failure mode and buy nothing; a stale FSM shows up instead as a
disagreement in the sequence view's own FSM tab.

**Not named? Label it.** The **Label** row appears and stores the end board's *geometry* under the
name you type, tagged **user-defined**, registered with the live library so boards like it are
recognised from that moment on (including the one on screen, whose read is already cached — the
registry clears the match cache for exactly that reason). The list below it shows each stored shape
with an **xml** button that copies a `<formation>` block for pasting into
`poc/src/assets/formations.xml`, and a **del** button that forgets the label.

When the end formation **is** user-defined, the field carries two controls, because there are two
different mistakes and they need different answers:

| control | it means | what it does |
|---|---|---|
| **detach** | "this label is wrong *here*" | stops the formation labelling **this call's** end. The formation stays in the corpus and still labels every other call that ends in it. The field then reads `not named`, and the detach is shown *where it applies* — `"X" is detached from this call` with a **reattach** button, because a mis-click must not be invisible or permanent |
| **remove** | "this label is wrong" | deletes the stored formation, for every call |

**Detaching is not a change to the library**, and that is deliberate: recognition is a geometry
question, and geometrically the shape *is* the shape — there is nothing to correct. What can be wrong
is applying a label to one call. So the library keeps matching, nothing else in the app inherits a
hole, and the panel simply declines the name for that instance (keyed by `callId` + `setupIdx`, the
same identity the editor's saved edits use).

**Nothing is declined silently.** If the library *did* detect a user-defined label and the field is
not applying it, the field says which label and why — `detected "X", detached from this call
[reattach]`, or `detected "X", which is no longer in the corpus [store]`. A bare "not named" for a
label that exists is an instrument that cannot report its own state, and it cost a round trip: the
first version of this returned a null with no reason, so "detached", "removed from the store" and
"the library has never heard of this shape" all looked identical on screen.

**Removing** a formation deletes it from the store and drops any detachments that named it — a
record saying "this formation does not describe that end" is dangling once the formation is gone, and
leaving it would silently suppress a future formation given the same name. The *library* keeps the
name until the page is reloaded (there is no unregister, on purpose: a registered shape is the
load-bearing part, and removing it mid-session would leave every cached read naming a formation the
store no longer holds). So the field stops applying a label whose formation is no longer stored,
which is what makes the destructive button visibly work instead of appearing to do nothing; that is
also exactly what a reload would show.

User-defined formations live in `localStorage` (`dsUserFormations`, detachments in
`dsFormationDetachments`), not in the corpus, because a browser cannot write `formations.xml` — the
same local-first, export-for-the-corpus shape the call editor uses. **They are registered by the
panel that owns the formation library, on every library build** — the sequencer's constructor *and*
its `rebuildSeq` (a level change replaces the whole `Sequencer`, and the second build used to forget
them, so a label silently stopped being recognised the moment the level changed). Anything the panel
adds to that library has to be re-added on a rebuild, exactly as the saved modules are.

Three measured facts shape the whole feature, all from
`node engine/test/tools/end-formation-probe.mjs` (MS level, 1015 call variants):

| | |
|---|---|
| end boards the library can name | **636 of 1015** (62.7%); **413** (40.7%) also carry a curated label |
| unnameable **8-dancer** ends | **59** — these are what the label flow is for |
| unnameable 2/4/6-dancer ends | **320, and all of them are unnameable by construction** |

That last row is why the **Label** row does *not* appear for a half-set authoring: a formation is
matched only against a board of the same dancer count, and the formation library holds
**eight-dancer geometries only** — its constructor mirrors a four-dancer corpus entry to eight and
drops the original. So a 4-dancer end cannot be named, and labelling one would create a formation
that is just as unusable. The panel says so rather than offering a button that cannot work.

## Call editor mode

Switch the **Mode** dropdown to **Call editor**. It has three distinct features,
selected with the editor's own **Mode** toggle (**Edit instance** / Fix closure /
Create position). All three share an **Edit call + Setup** — the taminations call
instance being edited — and all three preview through the same 3D renderer.

Two **view options** sit at the bottom of the panel, both about getting the dancers out of the way of
the track you are measuring:

| option | what it does |
|---|---|
| **Hide dancers** | stops drawing the 3D figures — the dancers are still there, only their bodies are not, so the trail, the handles and the floor grid read cleanly |
| **2D icons** | looks straight down and draws small flat markers instead of the figures (the same markers the sequencer's 2D view uses). The trails and handles read **best** from above, so they stay in both views |

They are **scoped to the editor**: applied while it is the panel on screen and released when it is
not, or a caller who hid the dancers here would find them gone in the browse view with nothing on that
panel to explain why. The camera is **one object shared by every panel**, so the last panel to set it
wins — `applyMode` therefore calls the browse view, then the editor, then the sequencer, and the
sequencer only touches the camera while it is the active panel.

**Find** narrows the call lists, because the catalogue is several hundred calls. Terms
are ANDed substrings matched against the LEVEL, the TITLE, the file name and every
setup's `from` label, so `circle`, `ms wave` and `static square` all do what they look
like they should; the readout says how many calls are left, and **Escape** clears it.

**A generated setup is named by its FORMATION, never by the call.** A setup lives *inside* a call's
`<tam>` list, so the call is already its address — and every shipped setup is labelled by its `from`
alone (`Static Square`, `Facing Couples`). Generated ones now read the same way, in the Setup dropdown
and in the saved list:

| mode | the name it gets |
|---|---|
| **Edit instance** / **Clone** | the instance's own `from` — a clone's is the Start setup you picked |
| **Fix closure** | that setup's `from`; a fix does not change the formation, so it keeps the label (the list already says `fix ·`) |
| **Create position** | what you type in **Name**, or else the **pre call's END formation**, read from the library (`boardAtBeat` + a board read) — which is the formation the new setup actually starts from, not a pair of call names |

The last row is why the editor asks the host to name a board: without it the only name the editor had
for a created setup was `preCallId → postCallId`, which is two *call* names where a *formation* name
belongs. And because a setup's identity is its (call, index) pair, a **replacing** edit (fix or
instance) is now replaced by setup rather than by name — so an edit saved under the old
`Call · Formation` label cannot survive beside the new one and shadow it. An **appending** edit
(create or clone) is still identified by its name, because the name *is* the new setup.
The box narrows **every** call list in the panel (edit, post and pre) rather than one of
three identical controls, and **the call you currently have selected is always kept** at
the top of its list, marked `▸`, whenever the filter excludes it. That last part is not
politeness: clearing a `<select>`'s options moves its value onto whatever survived and
fires no `change` event, so a filter typed over the top of the chosen call would leave the
panel showing one call while the editor still held another. The filter can only change
which calls you can *reach*, never which one you *have*.

The **Facing** dropdown sits here because the editor is the view that needs it: it
picks how the PREVIEWED dancers orient, and every editor action previews through
the same renderer.

- **Rotation Bézier (data)** — the authoritative taminations facing, taken
  from each movement's dedicated rotation Bézier (`cx3/cx4/cy4/x4/y4`, falling
  back to the travel tangent when absent). This intentionally makes a dancer
  walk **forward or backward** along the path — e.g. in a Wheel one partner
  backs up while the other walks forward.
- **Along travel** — always faces the instantaneous direction of motion (the
  translation-tangent heading), i.e. "always walk forward".

It is a property of the shared call renderer, so the BROWSE view honours whatever
is set here (and uses the default, `Rotation Bézier (data)`, if you have not been
to the editor). The sequencer does not use it - it draws from the engine's own
board state, not from an authored call path.

**Edit instance** — edit the `<tam>` itself: the START FORMATION (each dancer's x, y and
heading), the ARRANGEMENT (the gender of every spot, which the `gender` column sets), the
END FORMATION (each dancer's arrival pose) and the MOVES that carry each dancer between
them. Every number is a full-set coordinate: the engine normalizes a half-set authoring on
load, so a tam authored for four dancers is edited as the eight the renderer draws.

**The animation is OFF in this mode, and the Position bar above the moves is what moves the
dancers.** A move is edited one frame at a time, and an animation that kept running would move the
dancers out from under the move being edited, so entering the mode parks the playhead and the bar
becomes the only thing that advances it. Two consequences are load-bearing:

- **The parked beat is the editor's, not the player's.** Every edit re-shows the instance, and
  re-showing calls `Player.setCall`, which parks the playhead at the lead-in — so the beat is held in
  `editBeat` and re-applied after every re-show. Without that, the dancers would jump back to the start
  on every keystroke and the bar would be useless for the one thing it is for.
- **Dragging does not re-show the call.** `setPlayhead` moves the playhead alone; re-showing rebuilds
  all eight dancer views and their trails, which is far too much work for a pointer move.

The bar's value IS the beat (`0` = the call's first beat), and the readout carries the beat, the total
and which part of the call it is in. It is **the width of the formation table above it** — which needs
its own line, because inside a flex row it shared the line with its readout and came out narrower than
the table it is read against — and its step is **0.01 beat**, a hundredth: placing a dancer while
shaping a curve needs fine adjustment, and at that step a drag across the bar moves in finer increments
than one per pixel, the arrow keys nudge by 0.01 and Page Up/Down by 0.1. (The browse tab's Position
bar is the same control at quarter-beat steps, where the job is playing rather than placing.)
**Leaving the editor gives the animation back** — tracked by the previous mode, so a pause you set in
the browse view is not overridden.

Two properties of the data are worth knowing before using the table, and both are measured
by `engine/test/editor.mjs`:

- A path is authored in **dancer-local** coordinates, so re-posing a dancer's start
  RE-FRAMES its whole movement: translating the start translates the path, and changing the
  start heading rotates the path about the start. The choreography is carried through
  verbatim, in the frame you have just chosen.
- The **`couple` column is a read**, not a field. A taminations `<dancer>` declares only
  gender/x/y/angle, so the home couple is DERIVED from the start formation's geometry by
  `assignHomeIdentity` — the same read the dancer colours use. Changing a dancer's gender
  changes the arrangement and leaves the couple where it was.

The moves table edits the selected dancer's selected move. **A move has TWO SHAPES and they are
selected separately**, because they are different curves in different spaces:

| selection | the shape | drawn on the board as |
|---|---|---|
| **move** | the translation Bézier — *where the dancer goes* | the highlighted stretch of the track, in amber |
| **facing** | the rotation Bézier — *how the dancer turns* | **heading ticks** along the same stretch, in cyan |

Editing one while looking at the other is how a facing gets set to nonsense, so the tile shows one at
a time. The **facing** selection is only available when the move carries a rotation curve at all:
`rotate` absent means "face along the travel tangent", which is the taminations default and *not* a
curve anyone can edit, so with the **explicit** box unticked the facing tab is **disabled** rather
than opening onto nothing. The box itself stays reachable in the tile header; ticking it copies the
translation curve (which is behaviour-preserving — that is exactly the curve the renderer falls back
to), and unticking it while Facing is selected falls back to Move. Clicking through the strip keeps
the selection, except onto a move that has no facing.

**Brightness carries the selection.** The chosen dancer's **whole track stays visible at low
brightness** and the selected move is the only thing at full brightness — the track is context, the
move is the subject. Every other dancer's track is hidden outright. The two levels are named constants
in `scene.ts` (`TRAIL_OPACITY` 0.55 with nothing selected, `TRAIL_DIM_OPACITY` 0.45 for the context
track), and the dim value was **raised from 0.22 because it was invisible in use**: a saturated couple
colour at 22% loses to floor grid lines drawn at 95% in `0x2f9e77`, so the only thing that read on
screen was the amber highlight. Anything below about a third does not survive this floor.

The facing ticks are cyan against the move highlight's amber so the two shapes are never mistaken for
each other, and one tick is drawn per sample deliberately: a smooth facing curve and a jittery one
look different, which is the point of being able to select it at all.

The remaining numbers: **beats** and **hands** belong to the move (they are its timing and its hold),
and re-timing a move re-times the call when it changes the LONGEST dancer's path; a call whose
authored beat count is longer than every path (a pause) keeps the pause.

### Bezier handles, and editing many dancers at once

Each selected dancer gets the two **control-point handles** of the current move's translation curve,
drawn on the floor: a leader line from the curve's fixed anchor (its start for `c1`, its end for `c2`)
out to a magenta dot. **Dragging a dot changes the SHAPE only** — the endpoints, the beats and the
hands are untouched. The camera is switched off for the duration, or the orbit control takes the same
gesture and the board spins while you are dragging. Moving the *shared connecting point* between two
curves (which adjusts both) is deliberately not offered yet.

**A drag on any selected dancer's handle applies to all of them, each in its own frame** — and that is
*exact*, not approximate, because a move's Bézier is authored in **dancer-local coordinates**. The
origin is the dancer's spot where the move begins and +X is the facing at that instant, so the *same*
local control point on two dancers **is** the same shape rotated and translated into each of their
positions. Propagating a change therefore needs no rotation arithmetic at all: the local value is the
shared description. The only conversion is the one that puts the pointer where you dropped it, in the
frame of the dancer whose handle you grabbed.

Both halves of the group edit use that:

- **ticking dancers** in the `sel` column of the formation table (the `all` button in the moves row
  toggles the whole set) — the focused dancer is always in the selection, because the tile must not be
  showing values that edits do not touch;
- **every move edit** — the tile's fields, `+ Move` and `− Move` — goes to every selected dancer,
  *patch by patch* rather than segment by segment: a patch built from the focused dancer's segment would
  copy its other control points onto everybody, which is exactly the per-dancer difference a group edit
  exists to preserve. A selected dancer with no move at that index is skipped, never given one.

**The facing curve gets no handles**, and that is a fact about the data rather than an omission:
`poseFor` reads it with `bezierAngle`, so its **tangent is the heading** and its coordinates live in a
tangent space. A no-translation turn in `moves.xml` is `x4="0" y4="2"` with the tangent running 0° to
180° — there is nowhere on the floor to put that. The tile says so when the Facing tab is selected.

**The moves row drives the stage**, which is what makes a single move editable at all. The
moves themselves are shown as a STRIP: every move of the chosen track, in order, so the whole
path being edited is visible at once instead of one move at a time behind a dropdown. The move
being edited is **triple width** (180px against the compact tiles' 60px) and carries its
numbers; every other move is a compact tile showing its number, its beats and its hands, and
clicking one selects it. A long path scrolls horizontally.

- **Moves of** — only the chosen dancer's TRACK is drawn; every other dancer's track is
  hidden, so the one you are editing is not lost among eight. The dancers themselves stay
  visible (only tracks are hidden), and leaving the instance editor gives every track back.
- **The current move** — its own stretch of that track is highlighted in amber, and the rest
  of the track is dimmed. The stretch is the BEAT RANGE the move occupies, from
  `moveBeatRange`, mapped to floor positions by `sampleTrailRange` — both engine functions,
  so what is highlighted is the move the strip names rather than a plausible-looking slice.
  A zero-beat move owns an empty range and draws nothing.

**Reset** throws away the edits made in the tab and reloads the instance — and note what it
reloads: `loadCall` honours an edit already applied to the live catalogue, so an
applied instance edit is reloaded as itself. Unapply it in the saved list to get the
shipped tam back.

**Clone onto a different Start setup** — author a NEW setup for a call out of an existing one.
A `<tam>` is authored for one start formation and its moves are written in *dancer-local*
coordinates, so re-posing the start re-frames the whole chain and the set stops finishing
where the call finishes. The three controls are the three steps:

| control | what it does |
|---|---|
| **Clone** | starts a NEW setup from this instance; Save/apply will ADD it rather than replace the one it came from |
| **Start setup** | re-bases the clone's start onto a named formation, keeping every move. The track is now **incomplete**, and the panel says by how much (`track incomplete: 2.86 units / 90° from "Static Square"`) |
| **Connect** | re-aims the **first move of every dancer** so it walks in from the new start to where the old track resumes. The end formation comes back exactly; no other move changes |

Only **eight-dancer** formations are offered, because `setStartFormation` refuses a count
mismatch — re-basing eight dancers onto four spots is a gap, not a setup. `listFormations()`
currently offers 134 formations and *every one of them is eight dancers*
(`node engine/test/tools/editor-clone-probe.mjs`), so the filter removes nothing today; it is
there so that the day one is not, the picker cannot offer it.

The end is what the connection aims at: re-aiming each first move at the *old start's* first
boundary instead would move the end along with the start and would not be a clone of anything.
A dancer whose own first move already ends on the anchor is left exactly as authored, which is
what makes connecting an already-good track a no-op rather than a straightening of an authored
curve; and a dancer whose first move has **zero beats** cannot walk in, is left alone, and is
reported as still wrong rather than quietly accepted.

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

For all three features: **Save** persists the result to `localStorage` (reusable this
session), and **Export &lt;tam&gt; XML** produces a paste-able taminations `<tam>`
you can drop back into the data files. An instance edit is saved as the exported XML
itself — expanded, full-set, carrying its own `sequencer`/`actives` declarations — and is
read back with `mirror: false`, because the engine's mirror rule would otherwise DOUBLE an
edited formation that has no 180-degree partner.

Each saved edit has an **apply to live** toggle. Applying it overrides the live
call-position database: `loadCall` returns the edited setup (a `fix` or an `instance`
replaces the setup, a `create` appends a new setup) **and the sequencer's call registration
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
