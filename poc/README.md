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
| **Hide dancers** | draws **no dancers at all, in either view** — the 3D figures and the 2D icons alike. The dancers are still there, only their bodies are not, so the trail, the handles and the floor grid read cleanly. A flat icon is just as much a body standing on the move you are looking at, so the option is about the dancers rather than about one representation of them |
| **2D icons** | looks straight down and draws small flat markers instead of the figures (the same markers the sequencer's 2D view uses). The trails and handles read **best** from above, so they stay in both views |

They are **scoped to the editor**: applied while it is the panel on screen and released when it is
not, or a caller who hid the dancers here would find them gone in the browse view with nothing on that
panel to explain why. The camera is **one object shared by every panel**, so the last panel to set it
wins — `applyMode` therefore calls the browse view, then the editor, then the sequencer, and the
sequencer only touches the camera while it is the active panel.

### The flat (2D) view: square framing, and pan and zoom that work

The flat view is a **second camera**, an orthographic one looking straight down, and it has its **own
orbit controls** because OrbitControls binds to one camera object for its whole life. It used to switch
the single control set off entirely, which is why dragging and zooming did nothing in 2D — and reusing
the 3D controls would not have fixed it either, since those drive the camera that is not on screen.

**In 2D: left-drag pans, the wheel zooms, and rotation is off.** Rotation is off because a top-down
view that can be tilted is not a 2D view; left-drag is re-mapped to pan because OrbitControls maps the
left button to *rotate*, which with rotation disabled would leave the first gesture anyone tries doing
nothing. The Bezier-handle drag still wins where it applies — grabbing a handle switches the active
controls off for the duration of the gesture, which is what `setControlsEnabled` exists for.

**The zoom is bounded (0.2×–20×), and not for taste**: an orthographic frustum of zero width has no
inverse, so an unbounded dolly ends in a blank screen. **The pan is bounded too**, at the floor's own
half-width plus the visible half-span on that axis — so the board's edge can always be brought to the
screen's edge, and the board can never be pushed off with no gesture that brings it back. The limit is
**per axis**, which the probe forced: one symmetric limit kept the board reachable but stopped the
floor's edge 0.571 of a screen-half short of the side edge on a 21:9 canvas, because a limit derived
from the vertical half-span is conservative horizontally by exactly the aspect ratio.

**Two questions, two flags: "which view is on screen" and "is camera input suppressed right now".**
They were one variable, and that was a real fault rather than untidiness. Dragging a Bézier control
point silences the camera for the length of the gesture, but the drag **re-renders on every pointer
move** — `updateCall` → `applyDisplay` → `setView2D` — and `setView2D` wrote `controls.enabled = !on`,
re-enabling the camera mid-drag. The panel's pointermove handler runs first, so by the time
OrbitControls' handler ran on the same event the controls were live again and **the board panned under
the point being dragged**. Now `setControlsEnabled` sets a suppression that `setView2D` honours, so a
view switch cannot resurrect the camera during a gesture. Measured by `node tools/view2d-probe.mjs`,
driving three's own OrbitControls through a fake canvas in the order the browser delivers the events
(the camera is live at pointerdown, because OrbitControls' listener was registered first): the view
moves **0.0000** units with the fix and **3.13** with the rule it replaced — and that second number is
the regression test, because a check that cannot fail on the bug is decoration.

**The appearance of the flat view used to depend on whether you had resized the window.** The
orthographic camera is constructed with a *square* frustum (±11 on both axes), and `resize()` — the one
place that recomputes it from the canvas aspect — was only ever called from the window's `resize`
listener, never at startup. So on a 16:9 window the floor grid was drawn **1.78× wider than it was
tall** until the first window resize snapped it square, which is exactly what a caller reported. It is
now resized once as the stage is built, again on every 3D↔2D switch, and by a **`ResizeObserver`** on
the canvas, so a device-pixel-ratio change or a fullscreen toggle cannot leave the frame a layout
behind either. `resize()` never touches `camera.zoom`, so panning and zooming survive it.

Measured by `node tools/view2d-probe.mjs`, which drives three.js's real OrbitControls through a fake
canvas: the construction-time frustum stretches the floor by exactly the canvas aspect (1.7778 on
1600×900) and the framed one is square to **1.1e-16** at all six canvas shapes tested; a left drag of
100×50 px moves the view centre by 2.444×1.222 units (the orthographic pan scale, to 1e-6) while the
camera stays directly overhead; a wheel changes the **zoom only**, leaving the camera in place; the
zoom clamps land exactly on 0.2 and 20; and at the pan clamp the floor's edge sits on the viewport edge
to **1.7e-14** across 80 clamped positions, with a strip of floor always still visible.

### The board follows the selection — and the class of bug is audited

Selecting another move in the strip **moves the highlight, the tile and the Bézier handles together**.
That is one step in the code (`syncStageSelection`: the trail focus and the handles), not three
separate refreshes, because they are the same instruction — "this is the move being edited" — and any
one of them alone is a board that disagrees with the panel. It was not: the handles were drawn only by
the full panel re-render, so clicking through the strip left the gizmo on the **previous** move's
control points while everything else said otherwise.

`node tools/stage-sync-probe.mjs` audits the source for that class: every method that writes the move
index, the travel/facing kind or the dancer set — or re-renders the strip, which clamps the index itself
— must reach the stage sync, directly or through `renderInstance`/`commit`. `render*` methods are
exempt because every caller of a renderer must itself sync, which the same audit enforces. It prints the
eight methods that qualify, **and then runs the same analysis over a copy with the fix removed and
requires it to fail** — a check that cannot fail on the bug it was written for is decoration. This is a
check on the source rather than on behaviour, said plainly: the wiring is invisible to the engine
harnesses and the Vite app cannot run in this sandbox.

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

**One pair** of control-point handles is drawn, for the **first selected dancer** — the same
`moveDancer` whose numbers the tile shows. A pair *per* selected dancer is the literal picture of the
group edit, and an earlier version drew exactly that; it was unreadable, because with a dozen dancers
selected the board fills with near-identical pairs and the dots themselves do not say which pair
belongs to which dancer. The pairs are not independent anyway — the drag writes one LOCAL value to
every selected dancer, so the second pair is only a copy of the first.

Each handle is a line from an anchor out to a dot. **Dragging a dot changes the SHAPE only** — the
endpoints, the beats and the hands are untouched. The camera is switched off for the duration, or the
orbit control takes the same gesture and the board spins while you are dragging. Moving the *shared
connecting point* between two curves (which adjusts both) is deliberately not offered yet.

**The dot is a third of what it was (0.1 board units), and that number is measured against the
dancers rather than guessed**: the old 0.3 was **2.5× a dancer marker** (0.12), so the handle was
bigger than the thing it is a handle for and the board looked like it was mostly handle. At 0.1 it is
a little under a dancer. **The grab target did not shrink with it** — it is a 0.3 radius on the plane
at the handles' own height, which is 31–35 px on a 1080p view against the dot's 10–11 px
(`node tools/handle-pick-probe.mjs`), because a handle you can see but cannot grab is worse than a
large one. The tie is real: over all 9994 resolved segments of the 542 catalog calls, 69.7% of curves
have their two handles further apart than the radius, 24.8% have them distinct but closer, and **5.5%
have them exactly coincident** (a Stand, or any curve whose control points collapse onto the dancer's
position) — where the dots overlap, the strict nearest-wins test gives the grab to `c1`, so one of
the two is unreachable. That limitation predates the shrink (two coincident meshes were picked in
traversal order), and a deterministic tie is the most a single grab point can offer.

**The numbers follow the drag live.** The drag deliberately skips the full panel re-render on every
pointer move (rebuilding the table, the strip and eight dancer views sixty times a second is the
difference between a drag and a slideshow), but that used to leave the one thing you are steering by —
the numbers — frozen until you let go. They are now written on each move; nothing else in the panel is.

### The facing curve is drawn as a CURVE, and its direction is the heading

The **Facing** tab draws the facing Bézier itself in **cyan**, sampled from the engine's own
`bezierPoint` — the same cubic `poseFor` evaluates the dance with, so the picture cannot drift from the
data — together with its three draggable control points. Magenta is the travel curve, a path on the
floor where the dancer goes; cyan is a curve whose *direction* is where the dancer faces. They appear
**only on the Facing tab with `explicit` ticked**, because without an explicit curve there is no facing
shape to drag (`rotate` absent means "face along the travel tangent", which is not a curve).

**What the heading is at any instant is the DIRECTION OF THE CURVE at that instant.** `poseFor` reads
the curve with `bezierAngle`, whose own implementation is `atan2` of the derivative — the tangent — so
the curve's direction *is* the heading change. The cyan heading ticks drawn on the amber trail are the
same headings, placed where the dancer actually is, so the two can be compared directly.

An earlier version of this panel drew only the **control polygon** — the dancer's spot, `C1`, `C2`, `P3`
joined by straight lines — and its note claimed that "the ray from the dancer out to a point of the
curve is that heading". **That was wrong.** The ray and the tangent are different angles, and measured
over the corpus they differ by more than 10° at **47.6%** of instants (more than 1° at 79.3%). The note
was not loose, it was false, and it is now the tangent reading above. The control polygon is still
drawn, as the scaffolding the dots hang from.

**The curve's length means nothing.** Uniformly scaling the whole curve leaves every tangent — and so
every facing — exactly as it was, so the distance from the dancer carries no information. It is drawn at
the data's own scale so the dots and the tile's numbers read straight off it; nine curves in ten reach
no more than **4.08** units from the dancer, a couple of dancer-spacings.

**Three points, not two, because the tile has five fields.** The Facing tab edits `r.cx3 cx4 cy4 x4
y4`, and the curve's three points carry exactly them: `r1` → `cx1`, `r2` → `cx2`/`cy2`, `r3` →
`x2`/`y2`. A pair like the travel curve's would leave the endpoint — the heading the move *finishes*
on — with no handle at all. **The travel curve gets no drawn curve of its own, and that is not an
omission: the travel curve IS the trail.** `sampleTrailRange` walks the very same cubic onto the floor,
highlighted in amber for exactly this move, so a second copy would sit on top of it and say nothing new.

**`r1` slides on a rail along the dancer's own forward axis, and that is the file format talking, not
the gizmo.** The `<rotate>` element carries `cx3 cx4 cy4 x4 y4` — there is no `cy3` — so the converter
hardcodes `cy1: 0` and the exporter emits no `cy1`. Measured: a `cy1` of 0.5 turns the dancer **331°**
mid-move and re-parses as the authored curve **exactly**. So `r1` writes `cx1` alone, which is also why
no drag here can produce a facing the corpus cannot express. In the 14 corpus curves whose `cx1` is
already 0 the rail pointer sits on the dancer's own spot (Sashay, Lateral Substitute) — a real authored
shape, and it still means "no change of heading at the start", because the tangent there is the zero
vector and `atan2(0, 0)` is 0.

**Which point sets which end** (measured): the heading change at `t = 1` is the direction of `P3 − C2`
**only**, so `C2` and `P3` set the facing the move ends on while `C1` shapes only the middle; and
*nothing* moves the heading change at `t = 0`, because `cy1 = 0` makes the start tangent point along the
dancer's own `+x`. Over the corpus: 4145 facing curves, **4088 of the 9994 resolved segments carry an
explicit one**, and the end-of-move heading change is 0° for 2233 of them, 180° for 674, −90° for 597,
90° for 383.

`node tools/facing-handle-probe.mjs` measures the drawing as well as the drag. The drawn curve starts at
the dancer's own spot **exactly** and ends on the endpoint the tile edits (worst **0**); away from the
ends its direction matches the engine's heading to **0.00073°**, and quartering the measuring window cuts
that by **16×**, so the limit really is the tangent; the **32** drawn segments resolve the direction to
**0.056°** at worst, so the polyline is the curve rather than a lookalike; and the two ends are a
one-sided difference, first order, which is the measurement and not the claim. The drag's arithmetic is
checked too: placing a point and reading the pointer back is the identity (worst **4.4e-16** over 20
frames at five headings), each of the three rules writes its own point's numbers and no other field,
every edit keeps `cy1` at exactly 0 and survives export + re-parse (worst **0**), and a handle dropped
back on its own value exports **byte-identically**, so touching one is not an edit.

### CTRL snaps to the grid — as a magnet, not a lock

**The cell is the floor's own**, and the authority is the format's header rather than a preference:
*"The scale is in dancer units, same as shown when the grid is on."* The floor this app draws is 20
units in 20 divisions, a `Forward` (`x2 = 1`) is one cell of travel, and the couples of a squared set
stand **2** units apart (`node tools/snap-grid-probe.mjs`). Only **46%** of the corpus's authored
coordinates are on the unit grid — the rest are ⅓s, 4/3s and 1/√2s, what a Bézier approximation of an arc
produces — so this is a new convention rather than a restoration of one, which is why it is behind a
modifier.

**Holding CTRL while dragging pulls the point onto a line only when it is already close to one**, and
leaves it exactly where the pointer is otherwise. That is a *magnet*: rounding from anywhere in the cell
would quantise the drag, so every position would be a grid position and the gesture would stop being
"help me land on the line".

**There are two tiers.** The drawn grid pulls from a quarter of a cell (**10.2 px** in the flat view at
1080p, where a whole cell is 40.9 px), and the **half positions** pull from half that (**5.1 px**) — a
weaker tier, so a drawn line wins wherever they compete. Half positions are worth a tier because they are
where this dance's own coordinates live: **61%** of the corpus's authored coordinates sit on half units
against **46%** on whole ones. Nothing is *drawn* at the half positions — the floor draws 1-unit cells and
a 2-unit overlay — so a half-snapped point sits midway between two lines. That is a real place in this
dance's vocabulary rather than an arbitrary point, but it is not a place the grid shows, and two tiers is
the honest way to say both things at once.

Measured: of 1000 positions across two cells, **496** are pulled to a drawn line, **248** to a half
position and **256** left free — sticky enough to help, free enough over a quarter of the cell to still
be a magnet rather than a lock.

**It snaps to the board's grid — the lines you can see — not to a grid turned with the dancer.** The
point is snapped in the coordinates the floor is drawn in, *before* it is taken into the dancer's local
frame; snapping the local coordinates instead puts the dot on a grid **rotated and offset with the
dancer**, so it lines up with the visible lines only when they are both square to the floor *and*
standing on a whole coordinate. Measured by `node tools/snap-grid-probe.mjs`, sweeping 384 pose/pointer
combinations: the board snap lands exactly on a drawn line in **every** case, while the local one misses
by up to **0.196** units (about 8 px — a control point sitting visibly beside the line it claims to be
on) and agrees with the board snap only in the 64 cases where the dancer is square to the floor on a
whole coordinate, which is the usual stance at the start of a move and the only one where it was not
misleading.

The trade is real and worth stating: the numbers left in the tile are then the **dancer-local
coordinates of a grid point**, so they are not round when the dancer is turned (a dancer facing 34°
leaves 4.2132 rather than 4.25). That is the honest consequence of snapping to a grid drawn in another
frame, and the panel does not pretend otherwise.

**It snaps to the board's grid — the lines you can see — not to a grid turned with the dancer.** The
point is snapped in the coordinates the floor is drawn in, *before* it is taken into the dancer's local
frame; snapping the local coordinates instead puts the dot on a grid **rotated and offset with the
dancer**, so it lines up with the visible lines only when they are both square to the floor *and*
standing on a whole coordinate. Measured by `node tools/snap-grid-probe.mjs`, sweeping 384 pose/pointer
combinations: the board snap lands exactly on a drawn line in **every** case, while the local one misses
by up to **0.196** units (about 8 px — a control point sitting visibly beside the line it claims to be
on) and agrees with the board snap only in the 64 cases where the dancer is square to the floor on a
whole coordinate, which is the usual stance at the start of a move and the only one where it was not
misleading.

The trade is real and worth stating: the numbers left in the tile are then the **dancer-local
coordinates of a grid point**, so they are not round when the dancer is turned (a dancer facing 34°
leaves 4.2132 rather than 4.25). That is the honest consequence of snapping to a grid drawn in another
frame, and the panel does not pretend otherwise.

### `arc`: locking a curve to a quarter of a circle or an ellipse

Each tab has an **`arc`** checkbox. Ticking it **locks the curve to a quarter arc**, which means its five
coordinates stop being independent: they follow from the two handle **lengths**, and the tile offers
exactly those two instead (`arc x`, `arc y`), with a readout naming the shape — *quarter CIRCLE, radius
1.5* when the two offsets are equal, *quarter ELLIPSE, 1.5 x 0.6* when they differ. That is the rule as
asked for: **a circle if the x and y offsets of the start and finish lines are equal, otherwise an
ellipse.** Unticking releases the fields without touching the curve.

**The quadrant keeps the curve's own handle directions.** A quarter arc's two end tangents are
perpendicular — they are tangents at two radii a quadrant apart — so the family is the start direction
plus the two lengths, and the endpoint follows to the conic's corner. Nothing about which way the dancer
travels or faces changes; what moves is the endpoint. The cubic is the standard `k = 4/3(√2 − 1)`
construction: it is a circle to **2.73e-4** of the radius, which is the best a cubic does and thousands
of times finer than this board.

**A drag in arc mode can only change a length.** `r1` slides along the start direction, `r2` along the
finish one, and `r3` (the corner) sets both at once — so nothing a handle can do takes the curve off the
family. That is what "locks out manual editing" means here: not that the handles stop working, but that
they cannot break the shape.

**And the checkbox is DISABLED — with the reason on screen — wherever a quarter arc is impossible.**
There are two such situations, and they are separated because they call for different things from you:

- **The handles are not at a right angle.** A quadrant's end tangents *are* perpendicular by definition,
  so locking such a curve would have to turn the dancer, and the lock refuses rather than doing it in
  silence. The tile prints the angle it measured. This is the common case: over b1/ms/a1, **71.5%** of
  the corpus's curves have non-perpendicular handles — a straight walk's two handles are *parallel* and a
  U-turn's are *anti-parallel*, and neither is a quadrant of anything.
- **There is no handle length at all to size an arc from.** A `Stand` has every coordinate zero, so there
  is no hint of how big to make the arc, and the panel says that rather than inventing a size. (Where
  only *one* handle is zero, the other's length is the hint and the arc comes out a circle.)

A third refusal, for a facing curve whose start handle points backwards, never fires on the corpus (no
authored facing curve starts by turning 180°) and is recorded as a guard.

Measured (`engine/test/editor.mjs`, section 17; `node poc/tools/snap-grid-probe.mjs`): of **4150** curves
in b1/ms/a1, **0** are already quarter arcs, **690 (16.6%)** could take the lock, and the rest are
blocked — **2968 (71.5%)** by the angle and **492 (11.9%)** by having no handle length. The projection is
checked to keep both handle lengths and both directions exactly while moving only the corner; a rotated
arc is the unrotated one turned by its angle (worst **4.6e-16**); a projected arc sets off and finishes
facing exactly as the original curve did; a facing arc turns the dancer **exactly** a quarter turn; and
the arc survives export and re-parse, with re-exporting byte-identical.

**A curve with no handle length is not reported as an arc** — and that took a definition to get right.
The first version called the degenerate all-zero member of the family an arc and counted **138** corpus
`Stand`s as "already arcs"; with the shape refused, that number is zero.

**The dancer selector is one toggle per dancer** — the numbered chips in the moves row, and the `sel`
column of the formation table (one state, two places to reach it). It replaced an "all" button, which
was near-useless: very few calls have every dancer doing exactly the same move, so "all" was a button
you pressed and then had to undo. **The lowest-numbered dancer selected is the one the tile shows and
the strip lists**, and the set can never be emptied — unticking the last one is refused, because a
panel showing a move with no dancer selected has no meaning.

**A drag propagates to all selected dancers, each in its own frame** — and that is *exact*, not
approximate, because a move's Bézier is authored in **dancer-local coordinates**. The origin is the
dancer's spot where the move begins and +X is the facing at that instant, so the *same* local control
point on two dancers **is** the same shape rotated and translated into each of their positions.
Propagating a change therefore needs no rotation arithmetic at all: the local value is the shared
description. The only conversion is the one that puts the pointer where you dropped it, in the frame
of the handle's own dancer.

**The coordinate fields are LOCKED unless the selected dancers' coordinates genuinely agree** — the same
shape, rotated to each position, which is the only case where one set of numbers describes them all.
Writing a number into a field writes it to *every* selected dancer, so on a selection whose curves
differ it would collapse genuinely different shapes into one — destroying the per-dancer difference you
were looking at. Where they agree, the write keeps them agreeing, which is exactly when it is safe; a
single selection is always editable. When locked the fields are **greyed, not hidden** (the first
selected dancer's value stays readable), the tile says why and what fixes it, and the board handles are
not drawn — a drag is a coordinate edit that the same gate would refuse.

**Beats and hands are deliberately NOT gated**: they are not coordinates, and unifying a timing or a
hold across a selection is a legitimate group edit rather than a collapse of geometry. Every move edit
goes to every selected dancer *patch by patch* rather than segment by segment — a patch built from the
first dancer's segment would copy its other control points onto everybody. `+ Move` / `− Move` apply to
the whole selection too, and a selected dancer with no move at that index is *skipped*, never given one.

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
