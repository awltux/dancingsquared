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
pick a **level** (MS, Plus, A1, A2, C1, C2, C3A, C3B, or "All
levels"), which filters the **Call** dropdown, choose a
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
sequence on the 8-dancer board.

### The HUD: four zones and four drawers

The panel used to be one flat stack of rows and text blocks, and its order inverted its own importance — an
expert matching tolerance first, a board-view row between the picker and its button, the transport below six
search buttons, and the **sequence itself last and smallest**, at 11px. It is now laid out as a sequencer:

| Zone | Holds | Why there |
|---|---|---|
| **Session line** | Mode, **Level**, and a chip naming the formation the sequence stands on | Level scopes everything below it; the board chip is the one piece of standing state |
| **Figure banner** | The `WHILE` badge, the lanes, and **Finish figure** | A figure is a mode, so it is badged rather than implied — the same job the editor's clone bar does |
| **Composer** | **Who**, **Filter**, **Call**, **Add to sequence**, **While…**, and the one status line | The primary flow, in the order a caller thinks it, with the feedback under the button that produced it |
| **Timeline** | One row per step (ordinal, label, beats, a duration bar, `×`), the totals, **Undo/Redo/Clear** | The document this panel exists to build — the only scrolling region, and the only 12px body text |
| **Transport** | Play, ⏪/⏩ one beat, the beat box, **Speed**, the scrub | Pinned, so position and playback are reachable from anywhere in a long sequence |
| **Drawers** (`<details>`, closed) | **Solve** (getout · getin · fix it), **Board** (formation, rotation, view, FASR), **Library** (modules, All8), **Advanced** (margin, diagnostics) | Secondary tools one click away instead of always present |

The timeline row under the playhead is tinted and marked `aria-current="step"`; a step the walk cannot play
is flagged amber with the engine's own reason in its tooltip. The status line is a `role="status"` live
region, so the answer to Add is announced rather than only drawn. `poc/tools/sequencer-hud-probe.mjs` is the
gate on this shape.

### Composing

- Pick a **level** (MS, Plus, A1, …) to restrict which calls are available.
  Levels are **cumulative** (each builds on the earlier ones — e.g. Plus includes
  MS), unlike the browse mode, which shows only the calls
  specific to the selected level. Choose **Who** acts (default `All 8`), pick a call and press
  **Add to sequence** — the board
  advances, illegal calls are rejected with a reason. The call picker shows
  **only calls legal from the current formation** (refreshed after every
  apply/undo/reset), and **each entry carries the beats it would cost** — `16 - Promenade Full` — read from
  the engine for the board the call would run on and the name Add will use (the chosen group's prefix
  included), so the number shown is the number the step is charged; a module shows its whole sequence's
  beats. The option's value stays the bare call name. A **group-named coded call** — `Fold`, `Trade`, `Run`, `Heads Step Forward` (and its round-trip sibling `Heads Step Forward and Back if Possible`) — is offered
  as well whenever the engine says the chosen group can dance it: those calls refuse their bare name by
  design, so the whole-board list can never carry them, and without this the picker could not sequence
  `Boys Trade` at all.
- **Filter** narrows the picker to the calls whose name contains what you type, case-insensitively. It is the
  same rule the Browse tab's own filter applies (`filterNames` in `call-filter.ts`) and the same promise: it
  is a **view**, so the call the board is showing always stays in the list and cannot silently move to
  another option. The hint under the composer says how many of how many match, and says so when none do.
- **Undo / Redo / Clear** act on the whole sequence. One undo point is one *action*, so an applied getout or
  an All8 import comes back in one press rather than one per call, and a snapshot carries the **start board**
  as well as the calls — undoing a Clear replays them from the formation they were built on.
- **`While…`** gives the dancers a subset call did NOT move their own call in the **same time
  slot** (CALLERLAB's "Centers Square Thru while Outsides Trade", which the engine models as one
  `GroupStep`). Press it after a subset call, pick from the list — which offers only what the active lane's
  group can do — and press **Add**. **Add again adds another call to the same lane**, and **Finish figure**
  ends it: a 16-beat `Heads Promenade Full` can be filled by `Sides Trade then Touch a Quarter`, and the
  status line reports the balance (`= 6 of 16 beats — 10 beats standing`). Each group's
  calls run back to back from the step's start, the step costs the **longest** lane, and a lane that
  finishes early **stands** on its end pose; there are no synchronisation points between lanes (nothing can
  start one group's call part-way through another's). Undo removes the whole step. A deferred call
  (`Step Forward and Back if Possible`) may only be a lane of its own, and a lane names calls rather than a
  saved module.
- **Three or more parallel groups.** `While…` never finishes the figure — it opens **another lane**
  for the dancers no lane has claimed, and **Finish figure** (or `Esc`) is the way out. The **Who**
  selector is rebuilt for that: while the mode is on it lists the groups that resolve *inside* the unclaimed
  dancers (`All Except Heads`, `Side Boys`, `Side Girls`, …), so a lane can be given to **part** of the
  remainder — which is the only way a third group can exist, since a lane given all of it leaves nobody (and
  when no lane can be opened it carries the **active** lane instead, so it is never empty). That
  is the shape the timeline shows as `Heads Promenade Full || Sides ( Trade + Touch a Quarter ) || Side Boys
  Recycle`: a
  group of one call is bare, a group of several is bracketed, `+` joins the calls that run in order and `||`
  joins the groups that run at once. *(The button used to mean "finish" once the lane had a call, so a caller
  reaching for a third group had the step end under them and their next call land as a separate entry in the
  list — reported as "when I add a third call to a parallel call … it seem to be added to the call list as a
  new call".)*
- **Solve** (a drawer) asks one of three questions and shows the answers as **lines you can click**:
  *Getout* — with **rigid first** to try the O(1) self-inverse matrix path as a one-call answer — *Getin*, and
  *Fix it*, which answers with single calls that keep a getout alive. **Search** fills the list, clicking a
  line chooses it, and **Apply** adds the chosen answer as **one step and one undo**. This replaces five
  buttons that wrote into three different blocks, and an `Apply getout` that appended a whole path one call at
  a time.
- **Library** (a drawer) saves the current sequence as a reusable module, lists the saved ones — click a name
  to load it into the timeline — and imports/exports All8 call-format text. Modules behave like single calls,
  appear in the call picker (tagged "module"), are persisted in `localStorage`, and are considered by Getout
  and Fix it.
- **Board** (a drawer) holds the formation jump, the board rotation, the 2D/3D view and the FASR/FASROO
  readout; **Advanced** holds the matching tolerance and the position dump. The readout shows the recognized
  formation, arrangement, sequence parity, and
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

### Editing a sequence, and the keyboard

Click a timeline row to move the playhead to it; click its `×` (or focus the row and press `Delete`) to
remove that step. The sequence is replayed from the start afterwards, so a step that later ones depended on
can leave them unable to play — and that is **reported rather than silently dropped**: the rest is kept, the
first row that no longer plays is flagged from the walk's own verdict, and the status line names it. Deleting
the last step is therefore always safe, and deleting from the middle tells you exactly what it cost.

**Clicking a FIGURE row re-opens the figure** (it is marked `⇄`), so calls can still be added to whatever beats
are free: the mode is rebuilt from the step itself, and the lane it opens on is the one with the **most free
beats**. The figure banner shows each lane's fill beside it — `Sides ( Trade + Touch a Quarter ) 6.0/16.0 b ·
10.0 free` — and the status line repeats it for the lane that is active. A plain row is still just a seek, and
clicking one leaves the figure mode (it belongs to the row it was opened from). `Enter`/`Space` activate the
focused row exactly as a click does; the arrow keys only walk the list.

| Key | Action |
|---|---|
| `Space` | play / pause |
| `←` `→` | one beat back / forward |
| `Shift`+`←`/`→` | previous / next step |
| `Enter` | Add the picked call |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Delete` | remove the selected step |
| `Esc` | end the figure being built |

They are installed in the app's one keyboard table (`main.ts`, beside the editor's) and scoped to the panel:
`Space` must not pause a sequence while the Call editor is on screen.

**Speed** is the sequencer's own, beside the transport. The browse view has its own Speed for the call it
previews, because the two playbacks are different things — that one runs a single call through the shared
player, this one walks the whole sequence on its own clock.

The board uses the same 3D avatars (colored by gender; identity is tracked as 4
couples internally and reported in the FASR readout).

**A call's facing comes from the corpus's rotate curves, and a tam that carries none is drawn facing the way it
started.** The `Dosado` tams our editor exported were in exactly that state: a two-dancer dosado rotates the
pair about its midpoint, and with no turn in the data the pair slid past each other and ended up **back to
back** half way through — reported as "the dancers flipping from infacing to facing the home positions". They
have been re-authored (`poc/tools/dosado-facing-fit.mjs`) so each dancer keeps facing its partner: the angle
between heading and bearing-to-partner fell from mean 49° / worst 180° to mean 9° / worst 29°, with the drawn
path unchanged to float precision (4.97e-16 units). The engine was not changed — see `square-dancing.md` for
why the turn belongs in the data (`rotate` is read as a turn, `a = angle(1) − angle(0)`, and the editor's
export can only express one through the curve's last segment).

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
| `src/data.ts` | Browser layer: `?raw`-imports the XML assets (via `import.meta.glob`), **splits multi-call files** so every distinct `<tam>` title is its own call, builds the level-grouped catalog, exposes `availableCalls()` / `loadCall()`. |
| `src/scene.ts` | Three.js adapter: floor grid, low-poly **wireframe** humanoids (torso/head/2-seg arm IK/legs with a beat-synced **walk cycle** via `WalkCycle`), hand-hold connectors, path trails. |
| `src/main.ts` | Playhead (beats → ms), HUD wiring, play/pause/step/scrub, level filter, mode switch, frame loop. |
| `src/sequencer-ui.ts` | Sequencer panel: apply calls on the board, FASR readout, getout + fix-it buttons. |
| `src/editor-ui.ts` | Call editor: edit a taminations call INSTANCE (its start formation and arrangement, its end formation and its moves), fix a setup's closure, or generate a missing setup (padding core moves); preview, save to `localStorage`, export `<tam>` XML and the start FORMATION as a `<formation>` block. |
| `src/formation-xml.ts` | The `Export <formation>` rule on its own, with no DOM: the block (through the engine's `formationToXml`) and the verdict a paste into `assets/formations.xml` would have — `add`, `same`, `reordered` or `changed`. Pure and given the corpus lookup as an argument, so `poc/tools/formation-export-probe.mjs` drives every verdict. |
| `assets/*.xml` | The tamination data per level (`ms, plus, a1, a2, c1, c2, c3a, c3b`), plus `moves.xml` / `formations.xml` / `calls.xml` (GPL/A-GPL data; license headers preserved). It is the repository's ONE copy, at the repo root, reached through the `@corpus` alias named in `vite.corpus.ts`. |
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
`assets/formations.xml`, and a **del** button that forgets the label.

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
nothing (and one-finger touch is re-mapped for the same reason — its default is *rotate*). The
Bezier-handle drag still wins where it applies — grabbing a handle switches the active controls off for
the duration of the gesture, which is what `setControlsEnabled` exists for.

**And being perpendicular is now ENFORCED, not configured.** Reported: *"in 2d mode, the drag board
must not rotate on the x and y, only drag, keeping the board perpendicular to the camera."* The
configuration already said this could not happen — `enableRotate = false`, every button mapped to pan —
so it was not re-read; *"2D"* is a statement about the **camera**, and it is now enforced **on the
camera**: `squareCamera2D` puts it directly over the target with the board's +y up the screen, after the
controls have been updated, so it is the last word on the camera each frame, and again on the way into
the flat view. The pan clamp moves the **target** and lets that one function place the camera, so there
is exactly one writer of the flat camera's position. Measured with real OrbitControls
(`node tools/view2d-probe.mjs` section 6): a rotate gesture tilts the camera **49.49°** off straight-down
when it is allowed, and the squaring rule takes it back to **exactly 0°** every frame — with the
without-the-rule case measured as the negative control.

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
**And the frame is the VISIBLE box, not the canvas.** The panels are DOM overlays floating *on top of*
the canvas, so an 8-unit floor centred on the canvas is centred **under the HUD**. Reported from use:
*"the board seems to be centralised to the screen, but it hasn't taken into account that the left hand
dialog changes the visible board to the right hand side."* `scene.ts` frames the floor inside the canvas
**minus the strips the panels cover** and centres it on the middle of what is left, on **both** cameras:

* the flat view gets an **asymmetric frustum** — its centre is moved by the visible box's own offset -
  and it is **fitted to the visible box**, so a panel narrows the board on a canvas where the width is
  the tighter axis. On 1600×900 with a 432 px panel the floor's centre lands at 1016 px, the middle of
  the 1160 px that is left, instead of the canvas's 800 px: the old framing left **216 px of the board's
  middle under the panel**, which is the negative control in `node tools/view2d-probe.mjs` section 4;
* the 3D view — the one on screen at startup - is moved by a **lens shift** (`camera.setViewOffset`),
  which shifts the *projection* and leaves the camera where it is. That is not a stylistic choice: a
  moved camera and target would be re-applied on every resize and would throw away whatever the caller
  had orbited to, while a view offset can simply be recomputed. The same rule also fits the 3D
  **distance** to the tighter axis, which the old fixed `9.84` did not — it cropped **0.8 units off each
  side** of the floor on a canvas taller than it is wide. The distance is only recomputed until the
  caller first touches the 3D view; the shift is not gated that way, because it does not move anything
  the caller owns.

The panel's width is **measured, not assumed** (`main.ts` reads `#hud`'s own box, and a `ResizeObserver`
re-reads it when the mode changes the panel's shape), because the HUD is content-sized — 320 px at its
narrowest and 780 px in the instance editor - and a constant would be right in one mode and wrong in the
next. The inset is **capped at 45% of the canvas**: past that the panel is most of the window, there is
no visible region left to centre in, and a frame that kept shrinking would draw the floor a few pixels
wide. The **axis labels are sized as a fraction of the floor's half-width** (`AXIS_LABEL_FRAC`) for the
same reason the floor's own numbers are derived rather than repeated: they were a constant written for a
20-unit floor, and on the 8-unit one they read as a headline — *"The axis text is much larger than it
needs to be."*

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

**Level** narrows the same three call lists to one programme — MS, Plus, A1, … — and opens on
**MS**. It sits directly under **Mode** and is the same control the browse and sequence panels
carry: the options come from the loaded catalogue rather than a hard-coded list, and **All levels**
is one of them, so the selector decides what the lists *offer* without ever putting the rest of the
catalogue out of reach. With the level stated once above the list, the entries themselves carry the
call **title alone** (`Circle Left`, not `MS · Circle Left`); the `All levels` listing is still sorted
by level, so the grouping survives in the order. The level and the **Find** box narrow the same lists
and combine (a Find term naming a different level then matches nothing); the readout names the level
whenever the level is doing any of the narrowing, so a short list always says why. Like Find, it is a
**view**: the call you already have selected stays selected and the instance is not reloaded, because
a selector that dropped the call would be a way to lose an edit in progress.
`node tools/editor-level-probe.mjs` audits that wiring — the level filtering inside the one function
that builds a call list, the title-only label, the pinned selection, the MS default checked against
the catalogue's own level list, and the handler that re-narrows without reloading — and **requires the
same analysis to fail** on five deliberately broken copies.

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

**The Facing dropdown is GONE**, asked for as *"The Facing selector is not required. It is always auto
selected."* It was: `poseFor` reads each move's authored rotation Bézier (`cx3/cx4/cy4/x4/y4`) and falls back
to the travel tangent only where that move has **none**, so the DATA already chooses per move and a global
override could only disagree with it.

The option that was there — **Along travel**, which forced every move to follow its tangent — is a different
dance from the one the file describes. It erases the deliberate backwards walking in a `Wheel`, where one
partner backs up while the other walks forward, and that is 2.3% of the corpus's poses measured earlier. The
engine still carries both modes (`HeadingMode`), so the capability is unchanged; only the control that could
contradict the call is gone. `poc/tools/editor-level-probe.mjs` checks that it is gone **and** that the preview
poses with the authored reading — a control removed while something still reads a mode from it would be the
same bug wearing a different face.

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
*"The scale is in dancer units, same as shown when the grid is on."* The floor this app draws is **10 units
in 10 divisions** — half-width 5, so with the half lines at 0.5 … 4.5 it is the 20 × 20 grid the caller counts
— a `Forward` (`x2 = 1`) is one cell of travel, and the couples of a squared set stand **2** units apart
(`node tools/snap-grid-probe.mjs`). The frame FITS that floor to the canvas on whichever axis is tighter
(`scene.ts`: `frame`), so the grid fills and centres rather than sitting in a fixed 11-unit frame. Only **46%** of the corpus's authored
coordinates are on the unit grid — the rest are ⅓s, 4/3s and 1/√2s, what a Bézier approximation of an arc
produces — so this is a new convention rather than a restoration of one, which is why it is behind a
modifier.

**Holding CTRL while dragging pulls the point onto a line only when it is already close to one**, and
leaves it exactly where the pointer is otherwise. That is a *magnet*: rounding from anywhere in the cell
would quantise the drag, so every position would be a grid position and the gesture would stop being
"help me land on the line".

**There are two tiers.** The drawn grid pulls from a quarter of a cell (**20.1 px** in the flat view on a
1600 × 900 canvas with the floor fitted, where a whole cell is 80.4 px), and the **half positions** pull
from half that (**10.0 px**) — a
weaker tier, so a drawn line wins wherever they compete. Half positions are worth a tier because they are
where this dance's own coordinates live: **61%** of the corpus's authored coordinates sit on half units
against **46%** on whole ones. **Both grids now DRAW the half positions** — the square one as half *lines* and
the radial one as half *rings*, at the same offsets (0.5 … 3.5) and in the same material, so a half-snapped
point lands on a line the caller can see rather than midway between two. It is drawn as the weaker family:
the divisions are the blue-grey at hue 212 and the half mark is a violet-grey at hue 270, at a lower alpha.
Two tiers of PULL is still the honest way to describe the magnet — a drawn line wins wherever they compete —
but the second tier is no longer a position the floor declines to show.

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

### Two floor grids: square, and radial

**The board draws one of two references**, switched by a **state-driven button on the editor's Reset/Revert
row**: the **square** grid the app has always drawn, or a **radial** one. The label *is* the state
(`Grid: Square` / `Grid: Radial`) and pressing it flips to the other one — there is no "off", because a board
with neither would have no reference at all. The grid itself is drawn on **every** board in every tab; only
the switch sits with the editor's board state. Both are the same ruler — a division every whole unit out to
the floor's edge, with every second one overlaid at the coarser weight — so switching changes the *shape* of
the reference and not its scale. One press, one session restore and the startup call all reach the floor
through the same setter, which writes the label, the `value` `remember.ts` stores and both consumers at once.

**THE `W` KEY TOGGLES IT TOO, on every board and in every tab**, because the button is one control inside the
editor's panel and a shortcut bound to it would only work while that panel happened to be on screen.

### The keyboard: one table, one listener

**Every shortcut in the app is a line in one table**, installed by `installKeys` in `poc/src/main.ts`.
There are eight:

- **`W`** — the floor grid, on every board in every tab.
- **Ctrl/Cmd+Z** — undo, in the editor while it is editing an instance.
- **`S`** — flip the board's handles between the curve's **control points** and the move's **end points**, in
  the editor, on the move the tile is showing. Asked for as *"Add an S keyboard shortcut in Call Editor tab
  that switches between ends and controls on currently selected Move."* `handleMode` is one value for the
  panel and the tile's `⇄` button is its control, so the key and the button call **one** `toggleHandleMode`
  and cannot flip different state; its `when` asks `hasSelectedMove()`, which is the same four things the tile
  needs (this panel, an instance, a dancer selected, a move at the selected index), so `S` is live exactly when
  its button is visible rather than flipping a mode for a tile nobody is looking at.
- **`E`** — rotate the board's **Edit** state: `Moves` → `Dancers + position` → `Dancers + rotation`. Asked for
  as *"Add the E keyboard shortcut that rotates through Edit Button state between 'Moves', 'Dancers + Position'
  and 'Dancers + Rotation'."* The Edit row is two questions — **who** the gizmo belongs to (the scope) and
  **what** it changes (the axis pair) — and the three answers are named in one list (`EDIT_STATES`), with the
  axis named for the `Moves` state too, so leaving it always lands on `Dancers + position` rather than on
  whichever axis was left behind. The cycle goes through **`setScope`**, the same call the row's own buttons
  make — which is what writes the buttons' `on` classes, shows or hides the axis pair and re-draws the board —
  so the row and the board cannot describe three different states.
- **`G`** and **`B`** — cycle the editor's **girls** and **boys** selects, on the letters those buttons carry.
  Asked for as *"Now use the G to cycle Girls Select button and B to cycle the Boys Select button."* They run
  **`cycleGenderPicks`**, the same method the buttons' own clicks run, so the ticks, the button's label
  (`girls`, `girls 1·3`, `girls 2·4`) and its tooltip cannot disagree about what the key did — and they are
  live by the **same test the button's `disabled` reads** (`hasGender`), so a key can never select a set the
  button would have refused to click. The tooltips name the key, because that is the only place in the app
  the shortcut is written down.
- **`A`** and **`F`** — step the selected **move slot** one along, **wrapping at both ends**: `A` from move 0
  goes to the last move, and `F` from the last goes back to 0. Asked for as *"Add keyboard shortcuts to change
  the currently selected Move slot. Use A-KEY to select the previous move (lower index), rotating to the end
  after it reaches 0 index. Similarly use F-KEY to select the next move (higher index), rotating to the start
  after last index."* They run the one **`stepMove`**, which goes through **`selectMove`** — the same call a
  tile click makes — so the move tile, the handles on the board and the `move k/n` readout cannot disagree
  with the key; the wrap itself is the imported rule in `poc/src/move-nav.ts`, measured by
  `poc/tools/move-nav-probe.mjs` rather than restated. Their `when` is **`hasSelectedMove()`**, the same test
  `S` uses, so they are live exactly when there is a strip to walk.

  **They are why the grid toggle moved from `G` to `W`**, and the move is not cosmetic: the table is
  first-match-wins with the grid binding ahead of every panel's, so `G` on both would have left the girls
  select **unreachable** and silently grid-toggling instead. `keys-probe.mjs` drives that collision through
  the real dispatcher rather than arguing about it, because a shortcut that quietly stops working is exactly
  the failure a text assertion would wave through.
`poc/src/keys.ts` is the system: it takes the bindings and the listener target as arguments, so it is pure
enough that `poc/tools/keys-probe.mjs` **installs it on a fake target and dispatches synthetic events through
it** rather than reading the source with a regex. **VERIFIED IN THE BROWSER** (Chromium against `poc/dist`):
in the Call editor, `S` flips `⇄ controls` → `⇄ ends` → back, with the status line following; an `s` typed into
the call filter lands in the filter and does not flip anything; and Ctrl+S is left to the browser.

**Four decisions are made once, for all of them**, which is the whole reason it is a table:

- **A modifier that is not mentioned must not be held.** `{ key: 'w' }` fires on `w` and never on Cmd+W,
  Ctrl+W, Alt+W or Shift+W — which matters more for `W` than it did for `G`, since Ctrl+W closes a browser tab — so a bare key cannot swallow the browser's own chords, and a modded one cannot
  fire on a stray letter. `mod` is Ctrl *or* Cmd, because that is what "undo" means on both platforms; a
  chord that wants one and specifically not the other has no use here.
- **A field being typed into keeps its keys.** Input, textarea, select and contenteditable all opt out by
  default, because a text box has its own undo and a bare letter that changed the floor while someone typed
  `g` into the call filter would cost more than the shortcut saves. A binding that wants the keystroke anyway
  — an Escape that closes a dialog — says `whileTyping: true`.
- **Holding a key down fires once.** Auto-repeat is off unless a binding asks for it, so holding `W` toggles
  the floor instead of flickering between the two grids.
- **A panel says where its shortcuts are live** with `when`, rather than owning a listener that checks. The
  editor's Ctrl+Z is live only while the editor is on screen and editing an instance; it hands the binding to
  the table through `editorUi.keyBindings()`.

**The first matching binding wins**, and a key no binding owns is left entirely alone — nothing runs and the
default is not cancelled, so a shortcut never costs the browser a keystroke it did not claim. `preventDefault`
is called exactly when something ran. The table is validated on install: two bindings sharing an `id`, or one
with no key, are refused with the reason, because a duplicate id is a copy-paste that silently shadows a
shortcut.

**WHY NOT A LIBRARY** (mousetrap, hotkeys-js, tinykeys): the four decisions above are the whole of what this
app needs, and they are the part a library cannot make for you — what counts as "typing", what an unmentioned
modifier means, whether a held key repeats. What a library *would* add is a dependency to a package whose only
runtime dependency is `three`, and a matcher that cannot be driven without a DOM. The ~110 lines in `keys.ts`
keep `matchKey` and `dispatchKey` as the shape to preserve if that ever changes.

**The radial grid is 16 spokes** (one every 22.5°, the four cardinals in the bright centre-line colour the
square grid gives `x = 0` and `y = 0`) **and a circle at every whole unit** from 1 to 4, with the even radii
overlaid — **plus a mark at every half unit between them** (0.5 … 3.5). The half positions are where **61%** of
this dance's authored coordinates live, so the mark between two divisions is a real reading — but it is not a
division, so it is drawn to be *seen without being read as one*.

**AND THE SQUARE GRID DRAWS THE SAME MARK.** Asked for as: *"Add the same subtle half-grid line used by the
radial grid to the square grid."* The square grid's half *lines* stand at exactly the offsets the radial grid
puts its half *rings* (`squareHalfOffsets` against `radialCircleRadii(...).halves`), and **both draw from ONE
material** — `halfMat` — so "the same" is literal rather than two values that happen to agree today. The lines
are a `LineSegments` rather than a second `GridHelper`: a `GridHelper` divides its span evenly, so 40 divisions
would put a line at *every* half unit and overdraw the divisions the grid already has, where the half mark is
only the positions *between* them. `radial-grid-probe.mjs` checks the two offset lists agree, that both grids
draw from the shared material, and — from the material itself — that the half mark stays dimmer than the
divisions and clear of the cardinal spokes' teal.

**AND "TOO SUBTLE" IS A NUMBER, WHICH IS HOW IT GOT FIXED.** The first cut drew the half rings in the unit
colour at **0.4**, which composites to `0x202a35` — a contrast of **1.27** against the `0x0e141b` floor,
*dimmer than the 2-unit overlay already on that floor* (**1.43**) and only a quarter brighter than the floor
itself. Reported from use: *"I cannot see the half circles on the radial grid, they are too subtle."*

**Brightness alone was not enough to tell the two families apart**, and the measurement says why: the floor,
the unit circles and the overlay are all **one hue** (212, blue), so a half ring that differs only in alpha is
the same colour seen more faintly. Asked for as *"add subtle colours to differentiate the unit and half unit
circles"*, the half rings now take a **violet-grey** (`0x5c5068` at 0.6) — **hue 270, 58° away** from the
divisions, still subtle at that saturation, and deliberately clear of the cardinal spokes' teal (hue 159) so
the three families on this floor read as three. It composites to `0x3d3849`, a contrast of **1.64**: above the
overlay's 1.43 so the half ring is not the faintest line in the picture, below the unit circles' 1.95 so it is
still the weaker family.

`radial-grid-probe.mjs` recomputes the contrast **and the hue gap** from the materials and the floor — the
order, an absolute 1.5:1 under them, and at least **30°** of hue between the two families — rather than
trusting the figures in the comment. **VERIFIED IN THE BROWSER** (Chromium against `poc/dist`, the flat view,
via the `W` key): the half rings are visible and read as lavender between the blue-grey divisions.

It is drawn by `scene.ts` **from the same spec the magnet pulls to** (`packages/stage/grid-magnet.ts`, which is
pure — no DOM and no `three`), so what is on the floor and what a CTRL-drag snaps to are one definition
rather than two that happen to agree today. Both magnet probes (`snap-grid-probe.mjs` and
`radial-grid-probe.mjs`) import
that module instead of restating the rule.

**Exactly one grid is ever visible.** `setGridMode` sets both flags from one boolean, so there is no state
in which the caller has to turn one off before turning the other on, and none in which the floor has no
reference at all.

**The magnet follows the grid, and along the spokes and circles it is the same rule read in polar form.**
The *radius* goes through the square magnet's own two tiers — whole circle first, then the half positions
the assets are full of — and the *angle* is pulled onto the nearest spoke **only when the point is already
close to it**. Measured by `node tools/radial-grid-probe.mjs`:

- **The spoke's closeness is a DISTANCE, not an angle**, and that is the one design decision in it. A
  fixed angular window behaves differently at every radius: the same **3°** off a spoke is **0.052** units
  across at r = 1 and **0.523** at r = 10, so an angular window would pull both while a distance window
  pulls the first and refuses the second. A point a fixed **0.2** units across is pulled by 0.2 at r = 2, 5
  and 10, over angles from 5.7° down to 1.1°.
- **It lands on the grid, never beside it**: every one of the **359,687** points the magnet moves in a
  sweep of the floor comes back exactly on a circle of a snapped radius, and exactly on a spoke whenever
  the angle is what moved.
- **It is a magnet, not a lock**: idempotent over 4000 swept points, so a held CTRL-drag cannot creep; no
  pull is worth half a cell (worst **0.3614** units against the square magnet's **0.3531** — the same size,
  and the same **20.1 px** at that scale, because it is the same constant); and a point outside the pull is left
  **bit-identically** where it was, which is why the rule hands the point back untouched rather than
  rebuilding it from its own polar form.
- **No half-spoke tier.** The square grid's half tier exists because **61%** of the corpus's authored
  coordinates sit on half units; nothing in this corpus authors an angle on the floor, so a 32-spoke tier
  would be a magnet for a position the grid does not draw. Recorded rather than glossed: the spokes crowd
  together near the origin, so **inside r = 1.281** every angle is within a pull of some spoke.

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
  silence. The tile prints the angle it measured. This is the common case: over ms/a1, **71.5%** of
  the corpus's curves have non-perpendicular handles — a straight walk's two handles are *parallel* and a
  U-turn's are *anti-parallel*, and neither is a quadrant of anything.
- **There is no handle length at all to size an arc from.** A `Stand` has every coordinate zero, so there
  is no hint of how big to make the arc, and the panel says that rather than inventing a size. (Where
  only *one* handle is zero, the other's length is the hint and the arc comes out a circle.)

A third refusal, for a facing curve whose start handle points backwards, never fires on the corpus (no
authored facing curve starts by turning 180°) and is recorded as a guard.

Measured (`engine/test/editor.mjs`, section 17; `node poc/tools/snap-grid-probe.mjs`): of **4150** curves
in ms/a1, **0** are already quarter arcs, **690 (16.6%)** could take the lock, and the rest are
blocked — **2968 (71.5%)** by the angle and **492 (11.9%)** by having no handle length. The projection is
checked to keep both handle lengths and both directions exactly while moving only the corner; a rotated
arc is the unrotated one turned by its angle (worst **4.6e-16**); a projected arc sets off and finishes
facing exactly as the original curve did; a facing arc turns the dancer **exactly** a quarter turn; and
the arc survives export and re-parse, with re-exporting byte-identical.

### The radial grid fits a curve to its own circles

**When the RADIAL grid is on and the selected move's curve has both ends on one of the circles the grid draws,
the gadget grows one more dot** — green, the colour the grid draws its circles in, at the point halfway along the
arc. Pressing it rewrites the curve's two CONTROL points to the cubic that follows that circle
(`arcBezierAbout`) and leaves both END POINTS exactly where they were, so the move before it, the move after it
and the joint are untouched. It is the one control in the gadget that acts on a **press** rather than a drag:
there is nothing to drag it to, because the circle it fits is already drawn on the floor.

**The working range is a QUARTER TURN, not a length.** The first version required the chord to be under half a
cell, which turned out to refuse every arc in the corpus — of the ms level's **976** moves, **354** have both ends
on one drawn circle and none was that short, because the corpus's arcs are quarter and eighth turns. The limit is
now the sweep, at a right angle: the fit's worst radial error is **2.7e-4** of the radius over a quarter turn,
**1.5e-3** at 120° and **1.8e-2** at 180°, so a quarter is where it stops being exact to the four decimals the XML
exports. The two ends must also be on the SAME circumference, and it must be one the grid **draws** — within the
magnet's own half tier, so **CTRL-drag the ends onto a ring and then press the dot**.

**And a quarter turn AS THE ASSETS AUTHOR ONE is a hair PAST a right angle**, which is why the limit carries a
**2° slack** rather than being a knife edge. Reported as *"The central control to fit to radial curve only seems to
appear on the first full curve of Promenade Full. It should appear on all four of the quarter moves"*, and then,
from the board, *"I just saw the first and last curves with the control, but missing on the middle curve"*:
`ms/promenade.xml`'s own quarter turns measure **90.0003° … 90.0158°**, so a bare `> 90°` offered whichever of a
call's quarters happened to round the right way. Swept over **every tam of all nine levels** (**98038** moves):
**16120** have both ends on one drawn circle within the magnet's tier, **986** of those measure past a right angle
and the worst is **90.708°**, while the narrowest arc that is genuinely wider than a quarter is **100.389°** —
nothing lives between those two numbers. So the slack sits in an empty 9.7° band (1.3° clear of the authoring's
noise, 8.4° clear of the shapes) and costs the fit **7%** of an error that was never inside four decimals anyway
(**2.9e-4** of the radius at 91° against **2.7e-4** at 90°). With it, every one of the promenade's ring moves is
offered the fit — 62 of 62 dancer-moves across its three authorings, against **34** under the bare limit — while
the moves that ENTER and LEAVE the ring are still refused, because their two ends are not on one circle at all
(the first move of the Facing Couples Far path runs from r = **3.162** at the formation's corner to r = **2.500**
on the ring).

**AND A FIT PINS THE REST OF THE TRACE.** The fit rewrites the curve's DEPARTURE tangent as well as its arrival
one, and a move's own curve IS the frame the next move is played in — so the fit on its own swung every later move
round the floor and carried the next curve off the ring it was being fitted to: **0.49 units** on `Promenade
Full`, caught by the same report as the condition *"unless fixing one has thrown out the end points of the other
curves ... this should be prevented by pinning the subsequent end point while adjusting the controls."* The write
path now holds the following trace by the turn of `moveTurn` — the engine's name for the angle `poseFor`
actually advances the frame by, read off the move's facing when it has one and its travel when it has not — so
every later end point stays
within **2.8e-15** units of where it was. It is the same `holdFollowingTrace` the Facing tab has always used, and
the guard is the ANGLE rather than the tab, so a control-point drag holds the tail too; an END-POINT drag needs no
compensation at all, because `moveCurveEnd` carries the exit handle as a vector and leaves that angle within
**2.2e-16** (measured, not assumed).

Gated by `node poc/tools/radial-arc-fit-probe.mjs`: the rule, each refusal on its own, the fit's accuracy at the
limit and past it, the agreement with the engine's own `ARC_K` quarter-arc constant, the empty band the slack sits
in, the promenade's own moves curve by curve, and that a fit pins every later end point — and, the invariant a
first version broke in the field, that everything **offered** can be **fitted** (2130 swept pairs), because the
rule's tolerance and the engine's default were two rules at r = 1.5 and the dot appeared for a pair the fit
refused.
**A curve with no handle length is not reported as an arc** — and that took a definition to get right.The first version called the degenerate all-zero member of the family an arc and counted **138** corpus
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

**The gate asks about the ONE curve the tab edits, not both.** A Move-tab field writes `translate.<attr>`
and a Facing-tab field writes `rotate.<attr>`, so the question is whether *that* curve agrees across the
selection; asking about both is a strictly stronger condition on a write that touches one, and it locked
tabs whose own numbers were unanimous. MEASURED (`node poc/tools/connect-assign-probe.mjs`, after a
`connect` onto each of the 134 start formations): of the walk-in pairs the gate refuses, **76 have
identical travel curves (0.0000 units apart) refused on the facing alone** — the trails on the board are
the same shape and the Move tab was locked anyway — and **242 are refused on the travel alone while facing
identically**, locking the Facing tab on a pair a facing edit cannot collapse. **64 of the 134 targets**
have at least one such pair, and that number is the size of the fix. The lock note names the curve and
gives the difference **in that curve's own units** — board units for the path, degrees for the facing —
because "2.00 units apart" measured the two dancers' curves *where they lie on the floor*, which is
dominated by how far apart the dancers stand: two dancers doing the same move two units apart reported a
2-unit disagreement that was not about the move at all. The measure is now the same frame the windows are
set against, so the number answers the question the gate asked.

**Beats and hands are deliberately NOT gated**: they are not coordinates, and unifying a timing or a
hold across a selection is a legitimate group edit rather than a collapse of geometry. Every move edit
goes to every selected dancer *patch by patch* rather than segment by segment — a patch built from the
first dancer's segment would copy its other control points onto everybody. `+ Move` / `− Move` apply to
the whole selection too, and a selected dancer with no move at that index is *skipped*, never given one.

**A facing edit is a real edit: the heading a move ends on is the frame the next move is played in.**
Reported as a bug — "adjusting the end of the facing curve alters the direction of the rest of the trace.
This shouldn't happen" — and MEASURED (`node poc/tools/facing-chain-probe.mjs`) it should, and does: a 10°
change to a middle move's end heading rotates **every later boundary pose rigidly about the pose the move
ends on** by exactly that angle (agreement to 2.8e-15 units), swings every later drawn segment by the same
10°, and carries the call's end 0.417 units across the floor. It is the FORMAT, not this engine's choice:
taminations composes a dancer's moves as `tx = tx * it.translate(); tx = tx * it.rotate();` and carries the
frame forward (`taminations-flutter/lib/math/path.dart`, `Path.recalculate`), so the trail and the
animation agree by construction. The Facing tab says so where the numbers are, `engine/test/editor.mjs` 19
pins the numbers headlessly, and the probe keeps the measurement and the reference quote together so the
next reader gets an answer instead of an opinion.

**The facing curve gets no handles**, and that is a fact about the data rather than an omission:
`poseFor` reads it with `bezierAngle`, so its **tangent is the heading** and its coordinates live in a
tangent space. A no-translation turn in `moves.xml` is `x4="0" y4="2"` with the tangent running 0° to
180° — there is nowhere on the floor to put that. The tile says so when the Facing tab is selected.

**The moves row drives the stage**, which is what makes a single move editable at all. The
moves themselves are shown as a STRIP: every move of the chosen track, in order, so the whole
path being edited is visible at once instead of one move at a time behind a dropdown. The move
being edited is **four times the width** of the others (240px against the compact tiles' 60px) and
carries its numbers; every other move is a compact tile showing its number, its beats and its hands,
and clicking one selects it. A long path scrolls horizontally.

**The number fields are 72px, sized to the numbers rather than to the space left over.** `show()`
rounds to four decimals, so the longest string a field ever holds is eight characters (`-10.3333`);
that is about 49px of digits at 11px, plus 6px of padding, 2px of border and the browser's own number
spinner at roughly 15px. They used to be 58px, and 50px inside the tile — six characters, so a
coordinate was cut off and the value being edited could not be read. The current tile grew from 180px
to 240px for the same reason: at 72px a row fits two label-and-field pairs, so the tile stays three
rows tall instead of growing to six. The **field labels lost their `t.`/`r.` prefix** with it — only
one curve's fields are ever on screen, because the tab selects which, so the prefix said nothing the
tab had not and cost the row the width a second field needed.

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

**A created call NAMES its start formation once that formation is in the corpus.** The corpus's own tams
carry `formation="Name"` and no geometry — `<tam title="Circle Four Left 1/4" from="Facing Couples"
formation="Facing Couples">` — while every tam the editor wrote embedded a `<formation>` block. For a
created call that is not a style question: the whole point of labelling a formation from a call's end is
that other calls start from it, and an embedded copy means the shape exists once per call, so editing the
formation never reaches them. So the **Browse Calls** panel's user-formation list grows an **add to corpus**
button beside the `xml` one: it marks the formation as corpus-backed (the flag lives with the stored shape),
puts its `<formation>` block on the clipboard for `assets/formations.xml`, and says what follows —
calls that start from it now export as `formation="Name"`. Taking it back out returns them to embedding.

Three rules keep that honest, and the third is what makes it safe:

- **A reference is only written for a formation the caller has ADDED to the corpus**, never for one that
  only exists in this browser's store: a reference to a shape nobody else has is a call that loads nowhere,
  which is far worse than a repeated block.
- **The reference must describe the call**, checked by the engine's `startsFromFormation` **index for
  index** — a tam's paths are paired with the formation's dancers by POSITION, so a call whose dancers
  merely occupy the same spots in another order would hand each of them somebody else's path. The gender at
  each spot is part of it too; that arrangement is what the gender gates read.
- **The catalogue can resolve it.** A call is BUILT when it is registered, so the app registers the user
  formations BEFORE the calls (both at startup and on a level change, which rebuilds the library). This was
  a real bug rather than a precaution: registering the calls first made every saved call that names a
  caller-made formation fail with `No formation "…"`, and the library does not retry.

The decision itself is the engine's (`callToXmlNamed`), so there is one definition of "the reference is
faithful"; `poc/src/tam-xml.ts` only answers what a name resolves to here, and every place that writes a
`<tam>` goes through it. Gated by `engine/test/editor.mjs` 20 (the reference export, the reference
resolving against a registered formation, the `No formation` guard, and the three fallbacks to the block)
and by `poc/tools/formation-ref-probe.mjs` for the wiring.

**Re-basing on a named formation, at either end** — author a NEW setup for a call out of an existing one. A `<tam>` is authored for one start formation and its moves are written in *dancer-local*
coordinates, so re-posing the start re-frames the whole chain and the set stops finishing
where the call finishes. The controls are the steps, and the start and the end each get their own:

| control | what it does |
|---|---|
| **Clone** | starts a NEW setup from this instance; Save/apply will ADD it rather than replace the one it came from |
| **Start setup** | re-bases the clone's start onto a named formation, keeping every move. The track is now **incomplete**, and the panel says by how much (`track incomplete: 2.86 units / 90° from "Static Square"`) |
| **Connect** | re-aims the **first move of every dancer** so it walks in from the new start to where the old track resumes. The end formation comes back exactly; no other move changes |
| **End setup** | re-bases the END onto a named formation: the call should finish *there* instead. Nothing moves until **Connect end**. It also opens on **the setup the call already finishes in, turned** — the name in the field, the turn on the spin control beside it, so `Circle Four Left 1/4` from `Facing Couples` reads `Facing Couples` at `90°` rather than `Unknown Setup` |
| **Connect end** | re-aims the **last move of every dancer** at its assigned spot of that formation. Beats and hands are held, so the call is not re-timed, and no earlier move changes |

**THE END IS NAMED UP TO A QUARTER TURN, and the turn is a RECORDED fact rather than an id.** The setup ids are
rotation-canonical already (`setup-id.ts`: a squared set and its quarter turn mint one `sid`), so a board turned a
quarter turn was never a different setup — what the row lacked was a name for it and somewhere to put the turn.
`endFormationMatch` reports both (`{ name, turnDeg }`), the picker's value is the name and the rotation control is the
turn, so choosing it does not rotate the dance: taking the name alone would move the worst dancer a **median of 1.42
units, worst 5.0** (the 1691 ends that fit a name only when turned, `node poc/tools/end-setup-name-probe.mjs`), against
the **0.05** a name is allowed to nudge. Turn 0 is tried first, so every end already named keeps its name and gains
`0°`; 45° is not a quarter turn and stays unnamed. `endFormationName` keeps the strict "standing in it as authored"
question, which is what the row asks when it calls an end **Unknown Setup**.

**A FORMATION'S SPOT NUMBER IS NOT A CORRESPONDENCE.** "Connect the end to `Ocean Waves`" needs an answer to
*which of its eight spots does dancer 3 finish on*, and the answer cannot be "spot 3": a formation's spots are
in ITS OWN authoring order, so `dancer 3 → spot 3` is a coincidence of two unrelated files. The pairing is
**derived by geometry** with the engine's own `deriveFormationMapping` — the same call the Start setup's
re-base uses: every multiple of 45° of whole-set rotation about the origin plus a centring translation, then
the best 1:1 assignment on position and facing. MEASURED (`node poc/tools/end-pair-probe.mjs`, every call in
the ms level × all 134 formations = 2278 pairings): index-for-index agrees with the geometry for **64 of them
(2.8%)**, and where it disagrees it sends a dancer up to **11.57 units** from the spot the geometry assigns.
The pairing is always a **bijection** — every spot used once — which is what "the call finishes on this
formation" requires.

**The arrangement is part of the correspondence.** A formation's genders are *which spots hold a boy and
which a girl*, so putting a dancer on the other gender's spot gives the right shape and a different SETUP
(measured: the geometry alone does that in **1770 of 2278** pairings, 8840 spots; `preferGender` on the
engine's derivation leaves **0**, and it is the rule `setStartFormation` has always applied at the start).

**And the pairing is editable, because the automatic one can be wrong.** Beneath the End setup row, one picker
per dancer shows `dancer → spot` with the spot's own gender, coordinates and heading. Choosing a spot another
dancer holds **swaps the two**, so the eight picks always use every spot once; **auto pairing** puts the
derived one back. Everything is re-measured on every render — the gap to the end target is a **number on
screen**, not a remembered "connected", because re-aiming the *first* move re-frames everything after it and
would silently move an end that was already connected. When the ends differ from the catalogue's source
*and* the call is on its end target, the note says **end re-based** rather than `track incomplete`.

**A clone is announced, because it is not a mode.** The flag changes exactly one thing — what
**Save** does, an ADDITION rather than a replacement — and everything else on the panel looks
identical, so the state is written in three places at once: a blue **CLONE** bar over the table
naming the call and the setup being *left as it is* (and saying **Reset** goes back to editing that
one), the Save button reading **Save as new setup**, and the HUD's own edge taking the same blue.
The **Clone** button is then **disabled** — `doClone` re-loads the catalogue instance, so pressing it
mid-clone would silently throw away the re-based start and every move edit made since.
`node poc/tools/clone-chrome-probe.mjs` audits the wiring in the source (every writer of the flag
reaches the one function that draws any of it, the Save label has that one writer, and the chrome asks
the MODE because the Save button is shared with Fix and Create), and it is **shown to fail** on
`doClone`'s missing pass and on the mode handler's.

**A HANDLE TOGGLE, because a control point can sit ON the end point.** The tile's **⇄ controls / ⇄ ends**
button swaps which set of handles the board draws: the curve's **control points** (`c1`/`c2` on the Move tab,
`r1`/`r2` on Facing), or its **end point** — where the move finishes (`c3`), or the heading it finishes on
(`r3`). Never both, and the reason is measured rather than tidy: over all 9994 resolved segments of the 542
catalog calls, **5.5% have their control points EXACTLY coincident** — a `Stand`, or any curve whose controls
collapse onto the dancer's own spot — and a further **24.8%** have them distinct but closer than the pick
radius, where nearest-wins has no meaning and one dot is unreachable (`node poc/tools/handle-pick-probe.mjs`).
An end point is the same overlap one step further out, so the mode decides which one is grabbable.

**Dragging the END of a move holds the direction the dancer LEAVES on, and that is what keeps the rest of the
dance still.** The move's end point is `translate.x2/y2`, and the heading it ends on — which is the frame the
NEXT move is played in — is the direction of the curve's tangent at `t = 1`, which for a cubic is exactly
`p3 - p2`. So moving `p3` alone changes the destination *and* the frame, and the tail swings: MEASURED over
the ms level (`node poc/tools/move-end-probe.mjs`, 884 moves with something after them), a plain drag turns
the exit direction by a **median of 26.9°**, more than 1° in **all 884**, worst 138.8°. With the exit handle
held (`moveCurveEnd`) the direction moves by at most **2.5e-14°** and every later boundary is the old one
**carried** — same headings, same shape, moved by the distance the end point moved (worst error 1.9e-15).

**And the facing override is a different mechanism with the same fix.** With a facing curve the heading comes
from the *rotation* curve, so the tail is carried whether or not the handle is held — what the hold protects
there is the **direction of travel** (622 of the 884 moves carry a facing curve, and without the hold every
one of them would set off in a different direction). With no facing curve the tangent *is* the heading, so the
hold is what stops the track turning (262 moves, worst 98.5° without it). MEASURED BOTH WAYS in
`engine/test/editor.mjs` section 22 — including the case that first came out wrong: **144 of the 884 movable
moves have a zero-length exit handle**, where there is no direction to read, and the zero vector is *held*
(`p2` moves with `p3`) so the curve stays degenerate instead of being handed a tangent the drag invented.
With the arc lock on, the end handle is the conic's corner, and the lock wins: the family's promise is that
the curve stays a quarter arc, which cannot also be a promise about the exit direction.

**A row of bulk dancer picks sits above the table**: `none`, `all`, `boys`, `girls` and `matching`, next to
the per-dancer ticks in the table's first column. **`matching` is the one with a question in it**: it selects
every dancer whose move at the selected position is the same shape as the one the tile is showing, and it is
built from `sameCurve` — *the gate itself* — so the set it picks is a set the fields accept, by construction.
It is refused unless the current selection already agrees, which is the rule as asked for: it **widens** a set
that can be edited together rather than being a way to select a disagreeing one. The button carries the
**count** (`matching (4)`) and everything else about it is a **tooltip** — what it would pick, or why it
cannot: a sentence printed between the buttons and the table is read once and read past on every render
afterwards. MEASURED over the ms level
(`node tools/select-row-probe.mjs`): no pair inside any of the **2032** classes it produces is refused by the
gate, and it is worth having — **every** group has a class bigger than the dancer you started from, mean size
**3.65** dancers (a call's move is usually done by halves), and 104 of the 1016 travel groups are all eight.
The measurement's own control: widen the travel window from 0.025 to 4 units and **72 pairs** inside a class
would be refused by the gate, so the safety claim is a property of the gate's window and not of the grouping.

**`boys` and `girls` are PHASED.** Asked for as: *"Add new phase to the boys and girls Select buttons so that
it first selects all boys, then the first and third, then the second and fourth. These tend to match the
matching transformed paths in the different formations."* Each click advances its own button through **all of
that gender → the ODD positions among them (1st, 3rd, …) → the EVEN ones (2nd, 4th, …)**, and the label carries
the phase it is on (`boys`, `boys 1·3`, `boys 2·4`) with the cycle explained in the tooltip. The order is the
table's own `#` column — the dancer array the caller can count on screen — not the formation's identity, since
array position is the renderer's binding rather than an identity.
**And the ticks have a two-dancer action: `⇄` in the header cell directly over them.** Asked for as: *"Add a
small button above the dancer select column that is normally greyed out and disabled unless two dancers are
selected. With two dancers selected, the button will switch the selected dancers. Use a button icon something
like a double ended arrow to indicate switch or swap."* It is **disabled unless exactly two are ticked** —
greyed out rather than hidden, so the column says what the ticks are for before there are enough of them — and
the tooltip names the two it would switch, because "which two" is the one thing a button with nothing written
on it cannot say for itself. The press is **one engine call**, `swapDancers`, so the panel does not restate
which fields move.

**What moves is decided by how a path is stored, not by taste.** A path is authored in the dancer's **own**
frame (`+X` is the dancer's initial facing, P0 its own origin), so the version that leaves a coherent board is
the whole **entry** trading places — start pose, path, gender, mirror flag. MEASURED over every pair of every
ms-level call that builds (`node tools/swap-dancers-probe.mjs`, **448 pairs**): the **multiset of world tracks
is identical before and after**, so the swap is a relabelling of the same dance rather than a redrawing of it;
it is an **involution** (swapping back restores the call exactly) and **commutative**; the beat clock is
untouched; a dancer swapped with itself is the identity; and an index outside the set is refused out loud. The
probe's negative control is the cheaper edit this could have been — **swapping the PATHS ALONE**, one
`setDancerPath` per side: at **308 of the 448** pairs that draws a *different* board, the worst pose moving
**12.008 units**, because each path is then re-framed by the other dancer's start pose. That measurement is
why the start pose travels with the path.

**A phase that would select NOBODY is skipped**, which is not a nicety: a call with one boy has nothing at
"the second and fourth", and landing on an empty set would clear every tick and leave the panel saying edits
have nowhere to go. So the cycle runs over the phases that *have* a pick — for that call, `all` and the single
boy — rather than over the numbers 0, 1, 2. The phase is the button's own state, not the selection's, so hand
ticks between clicks do not lose the caller's place; `loadInstance` puts it back to 0.

**AND THE CALLER'S REASON FOR WANTING IT HOLDS UP.** MEASURED (`node tools/select-row-probe.mjs`, 76
`(call, gender)` sets over 38 eight-dancer calls of the ms level, move 1's travel curve, each list measured
against **its own** first dancer exactly as `matching` does): the whole gender shares that path in **49 of
76**, while the odd half does in **75 of 76** and the even half in **75 of 76** — and of the **27** sets whose
whole gender does *not* share it, **26 have a half that does**. So the phase picks a set the fields will accept
where "all boys" would have been refused. The probe also pins that the two phases are a **partition** of that
gender in all 76 sets — nobody dropped, nobody counted twice.

**AND THE SELECTION IS MARKED ON THE BOARD.** Asked for as: *"Highlight mismatched paths after selection"* and
*"Outline the dancers currently selected... on the board."* Two marks, drawn by `scene.ts` and driven from the
editor in **one** call (`Browser.setSelection`), so they cannot be showing two different selections:

- **A RING around every dancer an edit applies to** — a circle on the floor, 0.7 units of radius (couples stand
  2 apart). It is a SCENE child placed from the pose rather than a child of the avatar group, and that is what
  makes it work in **both** representations: a 3D avatar is a figure and a 2D marker is a flat shape, and their
  only shared property is where the dancer is standing. It is deliberately **not** tied to "Hide dancers" — that
  option is about the BODIES, and the ring is a mark on the floor saying which spots the edits reach.
- **A RED TRACK for every dancer whose curve at the move being edited does NOT match the selection's.** The set is
  built with `sameCurve` — *the gate itself* — so the reds and the locked fields are two readings of one fact
  rather than two opinions. A warned track is drawn at **full opacity** (the normal trail is 0.55, a dimmed one
  0.45), which is what keeps it distinguishable from couple 1's own red, and it is **kept on screen when another
  dancer is focused**: the mismatch is the reason the caller is looking at the board, so the focus must not hide
  the answer. `setTrailWarning` is reversible — it puts the couple colour and brightness back — and `setActive`
  clears both marks when the editor leaves the screen, so the browse and sequencer views are never told that
  dancers are selected.

**AND THE LOCK NAMES ITS OWN WAY OUT.** The coordinate fields already lock when the selection disagrees; the note
under them now says the paths are marked **in red**, that the dancers the edits apply to are **ringed**, and the
two things that resolve it: the **🔗** beside a dancer (which clones the reference's whole trace onto it) or
**selecting one dancer** (which is what the lock is for). The 🔗 was itself RELAXED to make that route real — it
used to require the whole selection to already agree, which is exactly the state in which a caller cannot use it;
it is now offered on **every dancer whose trace is not the reference's**, including a selected one that disagrees.

**`none` is a real state, and the panel refuses to write into it.** An empty selection is how a caller clears
eight ticks before picking two, so the ticks and the table's checkboxes can now leave nobody selected — and
everything that would otherwise become a silent no-op says so instead: the strip shows *no dancers selected*
where the moves would be, the coordinate gate refuses (locking the fields), `+ Move`/`− Move` are disabled,
no handles are drawn, and a write that reaches `commitMoveChange` — including the ones the coordinate gate
does not cover, like beats and hands — is refused with a status line rather than doing nothing.

**In `ends` mode, an ARC also gets its CENTRE as a handle.** When the path is closely a circle — a fit the
engine does in one linear solve, because a true arc's end tangents are perpendicular to their radii — a third
dot appears at the centre, anchored on the move's **start** so its own line *is* the radius. Dragging it
**swings the whole curve rigidly about its start**: the arc and its radius are preserved **exactly** (a rigid
motion cannot change either), the end swings round the start at a fixed distance, and the **start control
point turns with it** — which is the point, since leaving it behind is what stops the swing being an arc.
MEASURED (`node poc/tools/arc-centre-probe.mjs`, every arc in the ms level with a move before it × seven swing
angles): the shape moves by **3.1e-16**, the radius by **2.0e-15** of itself, the start pose by **0.0**, and
the end moves by exactly the chord of the swing.

**And the JOINT is kept by turning the previous move's departure with it.** The direction the dancer arrives
with *is* perpendicular to the radius, so the joint cannot be held by this curve — holding it is what stops
the curve being an arc. Instead the previous move's **exit** turns by the same angle (so the dancer leaves it
along the arc's new arrival direction — measured: the corner at the joint moves by **1e-10°** over the corpus,
where without it the rigid swing leaves a corner of up to **137°**), and its **heading change is frozen** so
the frame this arc is played in does not rotate. That last part is what makes the swing *visible*: if the
facing alone absorbed the angle, the frame would rotate by the swing and the arc would land back exactly where
it started — measured as a **no-op** across the whole corpus, which is why the rule is written the other way.
A facing curve is written only where the previous move had none (a copy of its **original** travel curve,
which is the heading profile it already had), and the previous move's own start and finish never move.

**One case cannot follow, and the panel says so.** **22 of the 134** arc-ish moves in the ms level follow a
move whose exit handle has collapsed onto its endpoint: the tangent the engine reports there is
`atan2(0, 0) = 0`, a convention rather than a direction, so there is nothing to turn — and inventing a
direction would deform a move authored to arrive with nothing left to travel. That previous move is left
exactly alone and the status line says the joint kept the angle it had, rather than claiming a correction it
did not make.

**And the swing's effect on the NEXT move is the engine's documented one**, measured both ways: with a
**facing curve** on the arc the heading is authored, so the swing holds the heading it finishes on and carries
the rest of the trace; with **no facing curve** the exit tangent *is* the heading, so the swing re-aims it —
which is what swinging an arc is for.

The tolerance for "closely a circle" is **2% of the radius**, and it sits in a measured **empty band**: over
the 1016 travel curves in the ms level, **222** have a centre at all, the worst curve that *is* an arc deviates
**1.47e-2** and the closest one that is *not* deviates **1.55e-1** — eleven times further out — so 134 curves
(13%) qualify and the exact threshold does not matter (`engine/test/editor.mjs` 23 measures the band and pins
the standard quarter-arc's own 2.72e-4). An elliptical quarter is **refused**, because that is a different
shape: the fit is a *circle* fit, and the quarter-arc lock (`arcOf`) is not the same test.

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

**The walk-in the Connect writes is FORCED, dancer by dancer, and cannot be made the same move for
everyone.** The end formation is kept and the rest of the chain is dancer-local, so the walk-in must
carry *this* dancer from *its* new start pose to *exactly* the pose the ancestor's own track resumes
from; the local curve is whatever that takes. MEASURED (`node poc/tools/connect-assign-probe.mjs`,
over all 134 targets): **no assignment of dancers to the new formation's spots gives all eight the same
walk-in** — not to 1e-9, and not to within the gate's windows — which is the proof that this is the
geometry and not the solver. What the geometry *does* give for free is the opposite pairs: the
ancestor's own first boundary is **point-symmetric**, so a pair of dancers 180° apart walks in
identically (**504 of the accepted walk-in pairs**; 76 are at any other angle). Dancers at 90° agree
only when the boundary is 4-fold symmetric, and it is not: the source's own first move gives four
dancers a 0.59 step and the other four a 0.5 step plus a 45.15° turn, and the boundary set is
4-fold symmetric only to about a tenth of a unit. So a caller selecting a head and a side after a
Connect is looking at two walk-ins whose *paths* are identical and whose *turns* are 45° apart, and
the per-curve gate above is what lets the Move tab edit that shared path.

**Is the window the fault?** For the case that was reported, YES — by a hair — and that is what changed it.
The reported witness: `All 4 Couples Promenade Full` cloned onto the formation made from the end of
`Right and Left Grand`, connected, then dancers 1 and 3 selected. Their two straight connectors differ by
**0.0142 units — 0.58 px** — and the gate refused them, because the window was 0.01 units (0.4 px). It is
now **0.025 units, one pixel**, and it is measured **along the curves** rather than on the control points:
a Bézier is a convex combination of its control points, so equal control points mean equal curves, but a
control point can differ by more than the window while the curves stay inside it — which is how the same
segment written as an ease-in and as a constant-speed line was refused although both trace the same line.

**The one-pixel figure is measured, not chosen.** `node poc/tools/clone-refusal-probe.mjs --sweep` walks
every call in a sample against every formation the picker offers (12248 refused walk-in pairs) and bands
the gap between the two curves at the probe's own 40.91 px per unit - a scale for the counts rather than a claim
about the frame, because the window it bands against is in BOARD UNITS and does not move when the floor resizes:
**232 refusals rest on a difference
under half a pixel, and the next smallest is 2 px** — with nothing at all in between. So the window may sit
anywhere in that empty band and the same refusals are made; at one pixel it opens the 232 and the reported
witness and refuses nothing else in the corpus. The facing window stays at half a degree, where the
refusals also start well clear of it (**3.15°** at the nearest).

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

**`Export <formation>` hands over the START formation itself.** Asked for as: *"Call editor:
When I change the order of the dancer list, I'm really changing the formation definition, but
there is no way to export a formation from the call editor. Add an 'Export \<formation\>' button."*
The observation is the **format's**, not a quirk of this app: a `<tam>`'s paths are paired with
the formation's dancers **by position in the list** (`buildCallImpl` pairs `dancers[i]` with
`paths[i]`), so swapping two dancers in the table is the same spots in a different ORDER — a
different setup to every call that names that formation. `startsFromFormation` is the engine
saying the same thing from the other side. `assets/formations.xml` is where a formation lives and
the browser cannot write it, so the button puts the block **on the clipboard** — asked for as: *"No
need to show the exported text. Just put it on the OS copy buffer."* It sits beside the **first**
`Export <tam>` button, in the instance panel's own row.

**It writes HALF the set, because that is what the corpus writes and what the reader completes.**
Asked for as: *"the formation uses symmetry about the origin of the board to only include half the
dancers. The missing dancers are reconstituted at load time by duplication and rotation about the
center by 180 deg."* The written dancers are the first half, in list order, with the gender at each
spot; the reader rebuilds the rest by duplicating them and turning them 180° about the board
centre (the engine's `completedFormation`, and `hasAntipode` in `convert.ts` where the parser decides). MEASURED
(`poc/tools/formation-export-probe.mjs`): **281 of the 291** corpus formations are authored as
half a set, and the export writes **the count the file authored for all 291** — completing every
block back to its own board, worst position error **0**, every one exporting as `same`. The name
and heading cross the boundary correctly too: `angle="90"` for a heading of π/2, read back as
**90.000°**.

**Half only when it really is half.** The block is halved only when completing that half returns
the board index for index; a board that is not symmetric about the centre (one dancer moved, or
the two swapped) is written out in **full**, because halving it would silently drop dancers. That
is the ten entries the corpus already authors whole, and every asymmetric board; the status line
says which of the two it wrote. NOTHING SMALLER THAN TWO DANCERS is written either: a two-dancer
board *is* its own half, but the corpus authors 62 two-dancer entries and no one-dancer one, so
"Opposite Boy" exports as both its dancers.

The status line says **what the paste will be**, because a block pasted under a name the corpus
already carries REPLACES that entry (`parseFormationsImpl` `map.set`s by name) for every call
that names it:

| Verdict | When | What it tells you |
|---|---|---|
| `add` | no corpus formation has that name | pasting it adds one |
| `same` | the corpus's own spots, same order | pasting it changes no board |
| `reordered` | the SAME spots in a DIFFERENT ORDER | this is the reported case, and a different setup |
| `changed` | some spots differ | **n of m** spots differ, so it replaces that formation |
| *(size)* | the counts differ at all | stated as a size change, never as "8 of 6 spots" |

MEASURED on a real call: `ms/alamo_style.xml`'s *Allemande Left in the Alamo Style* starts from
`Static Square`, and the engine's own `swapDancers(call, 0, 1)` turns the verdict from `same`
into **`reordered` with exactly 2 of 8 spots differing** — while an ORDER-INSENSITIVE comparison
(the rule the arrangement picker uses, where order genuinely does not matter) calls the swapped
formation "the same". That control is the reason the verdict is index for index.

**The name comes from the setup, with no field beside the button** — asked for as: *"no need for
the 'formation name' input field."* In order: the setup's own `formation` attribute, then its
`from` label. NEITHER IS ALWAYS THERE: **249 of the corpus's 5516 `<tam>`s declare no `formation`
and no `from`**, and a `<formation>` with no name is one `parseFormations` skips, so such a setup
is **refused out loud** rather than getting a block that does nothing — and with the field gone,
that refusal is the one thing the button cannot do for those calls. It was observed in the browser
on `_Finish Line of 6 Half Tag`, whose setup is `(default)`.

Also observed in the browser, on `Allemande Left in the Alamo Style` (which starts from `Static
Square`), with the button in its new place: the status line read *"exported \<formation\> "Static
Square" (8 spots, written as the 4-dancer half the reader turns 180°, copied) — the corpus's own
spots in the same order, so pasting it changes no board"*, and the text pane still read *"Exported
XML appears here."* — the block went to the clipboard and nowhere else. **NOT observed in a
browser:** the `reordered` verdict. The swap that produces it is the *table's* control, which on
the only calls large enough to have a namesake formation sits below the two setup pickers
(~208 options each) and therefore past the browser tool's 500-ref snapshot cap; and no six-dancer
call in the catalogue starts from a six-dancer named formation (MEASURED: none in
`ms`/`plus`/`a1`/`a2`), so the small-picker calls cannot produce it either. It is measured against
the engine instead — `swapDancers` plus `startsFromFormation`, as above.

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

### What a WYSIWYG path editor would have to express, measured

The goal stated for this editor is *"an intuitive mechanism to edit the dance path through a
wysiwyg interface. Many of the paths are circular (so this has to be easy to achieve), and the
dancers moves must start and end at fixed points (defined by a formation). There should be an easy
way to make the dancer face the right direction."* Those are three claims about the corpus, so they
are measured rather than designed around: `node poc/tools/wysiwyg-path-probe.mjs` reads **every
level, every `<tam>` variant** — **4754** eight-dancer variants, **94544** dancer-moves — because
the ms level alone is 66 files of which 17 build, and a one-level sample would be a fifth of it.

**A circular MOVE is always a QUARTER, and the corpus is full of them.** **10884** of **94544**
travel curves (**11.5%**) lie on a circle within 2% of its radius. Their sweeps run from **10.1°**
to **90.0°**, median exactly **90°**, and **89.1%** sweep the full quarter. So the panel's quarter
lock is the *right shape for the unit it locks* — and part 2 is where the interest is. (The lock
would be *enabled* for **22930** curves, **24.3%**: **55642** are blocked on handles that are not at
a right angle and **15752** on having no handle length to size from. And **0** curves in the whole
corpus is already the quarter arc `arcOf` describes, so ticking the box is always a projection and
never a no-op.)

**An ORBIT, though, is a CHAIN of moves, and the panel has no object for one.** Because no single
move turns more than 90°, a dancer going round is *necessarily* several moves — and **4589** runs of
two or more consecutive moves lie on ONE circle to within 2% of its radius, across **207** variants
(**4.4%** of the corpus). Their sweeps: median **270.3°**, max **765.1°**; **4141** sweep more than
a quarter, **3503** more than half, **2814** more than three quarters, and **652** more than a full
turn. **1162** runs span three or more moves. The densest are in `ms/circle.xml`
(a whole 360° `Circle Left` as **8** moves of 45°, radius 2.59) and
`plus/spin_chain_and_exchange_the_gears.xml`. This is the gap the quarter lock leaves: a user who
means *"that is a circle"* can only say it one quarter at a time, and nothing in the panel holds the
radius across the chain or notices when a move stops matching its neighbours.

**Joints really are formation points, and they really are not — both, in bulk.** Over **132356**
joints, **82.2%** land on a spot some formation in the picker offers and **95401** of those carry
that spot's declared heading, so a formation can pin position **and** facing. Of the **57460**
*interior* joints, **67.2%** are on a catalogue spot and **32.8%** are on no spot at all. So a
design that only supports "snap every joint to a formation" is wrong, and so is one that only
supports free points: the editor needs both, and it needs to say which a given joint is.

**A joint is usually already smooth, so an editor may not casually break one — but a corner is an
authored thing too.** Over **51180** interior joints, the direction is measured as a *chord* of the
real world path immediately either side (not from `bezierAngle` plus a frame, which assumes the
frame does not rotate during a move and a facing curve makes it rotate): median corner **0.06°**,
**83.7%** within **1°**, and a maximum of **180°**. Split by mechanism, **93.3%** of the joints that
follow a move with *no* facing curve are within 1°, against **68.6%** of those that follow one with
a facing curve. Both mechanisms are real — handles lining up, and a facing curve turning the dancer
— which is why the facing channel cannot be folded into the travel tangent.

**And the dancer frequently does NOT face where it is going, so facing cannot be folded into the tangent.**
Over **89132** poses sampled at the middle of every move, facing is a median of **0.0°** off the direction of
travel and **62.2%** are forward within 10° — but **2.3%** are **backward** and **3.5%** are **sideways**, so
**37.8%** are more than 10° off. A single direction per point, which is what most path editors have (the
tangent), cannot express this corpus at all: a `Wheel` is a dancer walking backwards on purpose.

**And the stored LOCAL form is an exact restatement of the WORLD path, which is what makes the editor's choice
of space free.** The format is incremental: move *k*'s six numbers are a curve in the frame the dancer stands
in when move *k* **starts**, and the frames chain. Part 6 states the prediction the design rests on —
*`world position = start pose + R(heading) · local curve`, `world heading = start heading + local angle
profile`* — and checks it **against `poseFor` as written** (which composes transforms, so agreement is a real
test rather than a restatement): over **1037564** samples the position agrees to **7.2e-15 units** and the
heading to **4.1e-13°**. So the two spaces carry the same information, a joint can be dragged in world space
with the local numbers recomputed, and the local form is kept where it belongs — as the reusable library
format, which is the whole reason `moves.xml` works across formations.

**And two primitives the panel offers today are measurably degraded.** Part 7. A **HOLD** is stored as an
ordinary move whose travel curve has **zero length** — **5192** of 94544 moves, and **0** of them have zero
beats, so a hold always costs beats and the *timing* channel cannot be used to spot one; only the geometry can.
**15778** moves additionally end with the exit handle collapsed onto the endpoint, so their departure has no
direction to turn at all. And the **arc lock can never be a no-op**: it is enabled for **22930** curves and
projecting moves the endpoint on **100%** of them — usually by a hair (**median 0.4%** of the curve's own
chord, which is why it feels like a snap), but **1128** of them move by more than a whole unit, worst **8.85**.
So the box always deforms, and the size of the deformation is not visible before ticking it.

**And the "does this call pass through another formation?" flag is buildable, but only with a persistence
rule.** `poc/tools/call-formations-probe.mjs` walks every call beat by beat and asks the engine's own
recogniser what formation the eight dancers are in. The naive scan says **31.9%** of calls cross an interior
formation — **3276 spans** — and that is useless, because **3238 of them are a single sample at a 0.5-beat
step**: the recogniser catching a board that is momentarily *near* a formation while the dancers pass through
it. Require the formation to be **HELD for 2 beats** and the population collapses to **31 spans in 17 calls
(0.4%)**. That is checked rather than assumed: at a step **eight times finer** 19 of those 31 survive and the
longest is 4.13 beats, while **40 control calls** that produced only transients produce **624 interior spans
of which 0 are held**. Of the interior spans, **75.6% begin on a move boundary**, so most are joints a user can
see. The held ones are a short, high-confidence list — `Alamo Wave`, `Ocean Waves`, `Thar RH/LH Boys`,
`Circle`, `Columns`, `Diamonds`, `Normal Lines Compact` — each with its beat range, e.g. `ms/swing_thru.xml`
holding `Alamo Wave` for beats 6.50–10.00 of 10.40.

**Its control is the reason to trust it, and it took two bugs to get right.** The call's own start formation
must be recognised at beat 0: by the real **`formation` attribute** it is named correctly in **2299 of 2299**
calls. Two things had hidden that. A tam with no `from` carries a **run of spaces**, and a whitespace string is
**truthy**, so every such call was counted as declaring one and then failed. And **`from` is not the formation
at all** — it is a label for the user (`convert.ts:324` builds the dancers from `formationAttr`; `from` may
label an *embedded* formation or give the attribute an alternative name), so comparing a recognised name
against it compares it against free text. A third limit is worth stating: **2113** tams name a formation the
picker does not carry, so the recogniser can only ever name the **134** eight-dancer formations it knows.

**And the first draft of this probe was wrong in a way worth recording.** It asked `arcOf` whether
the circle-fitting curves were quarter arcs by handing it the whole `Seg` rather than
`seg.translate`; `arcOf` then read `undefined` for all six coordinates and returned a NaN object for
everything, so the report was "10884 of 10884 agree" — a perfect agreement produced entirely by
handing the instrument the wrong argument. The corrected reading is **0 of 10884**, and the probe
now checks that the two tests *disagree*, so the same mistake cannot pass again.

### `circle`: a RUN of moves laid on one arc

**A move cannot turn more than a quarter, so a circle is never one curve** — it is a run of them. MEASURED
(part 1 of the probe below): of the **10884** travel curves in the corpus that lie on a circle within 2% of its
radius, sweeps run from 10.1° to **90.0°** and **not one** exceeds a quarter; a 360° `Circle Left` is authored
as eight moves of 45°. Meanwhile **4589** runs of two or more consecutive moves lie on a single circle, median
turn **270°**, longest **765°**. The quarter-arc lock above can only ever describe one *piece* of that; this
control is the one that names the whole run.

**The gesture is the fields, and the drag is not built yet.** In the selected move's tile: a `to` move (the run
starts at the selected move, and **shift-click in the strip** sets the run end instead), a `radius`, a `↺/↻`
side, and **make circle**. The run is drawn as part of the selection in the strip, because a range you cannot
see is a range you cannot check before pressing the button. A bulge-drag on the board is the intended second
gesture and is deliberately not here yet.

**What it holds, and why each one is structural rather than lucky** (`engine/test/editor.mjs` 25):

| | measured |
|---|---|
| the run's **start** does not move | **0.0** — the radius is snapped to it |
| the heading it sets off on | **0.0°** |
| the run's **end** | by no more than the fit was *already* out by |
| the run's shape afterwards | **1.4e-5** of the radius, against a 2e-2 tolerance |
| the turn, spread in proportion to **beats** | **1.6e-15 rad** |
| joints inside the run | within **4.6e-2°** |
| everything outside the run | **bit-for-bit**, and its beats and hands untouched |
| each move keeps whether it had a **facing curve** | **116 of 116** |

**The ends are what makes it safe.** A circular arc has five numbers and pinning **both** endpoints spends four,
so what is left is **one continuous choice — the radius — and one discrete one, which way round**; both end
headings then *follow* from the circle, because an arc's tangent is perpendicular to its radius. There is no way
to ask for an arc that does not join up. The radius is then taken as the one that passes through where the run
*starts*, which is what lets a run be re-laid on its own least-squares fit — a fit does not put the sampled
points exactly on its circle (`ms/circle.xml` fits at radius 2.595 with its start 2.597 from the centre).

**A turn a move cannot carry in quarters is REFUSED, not approximated** — the decision taken, and the reason is
accuracy as well as convention: a cubic quarter misses its circle by 2.72e-4 of the radius and a single cubic
*semicircle* by about 100× that, so past a quarter the curve visibly leaves the circle. The refusal names the
move and the angle, e.g. *"move 2 would have to turn 180.0deg and a move carries at most 90deg — spread the
turn over more moves, or over moves with more even beats"*, and the panel quotes the count it needs.

**The panel's group rule is not the engine's.** The engine takes one circle per dancer; the panel has **one
radius to share**, because eight dancers circling a centre start and finish in eight different places. So the
radius and the side are what a group edit holds in common and the centre follows from each dancer's own run —
measured (`poc/tools/run-circle-probe.mjs`): **6 of 6** whole-call runs accepted one shared radius for all
eight, hit to **3.8e-3** of itself, with every start moving by **0.0**.

**And a run that closes on itself is a different problem**, not an edge case — that is the 360° orbit. Its ends
are the *same point*, so the chord is a point and defines no circle at all (`circleThrough` correctly returns
null), and there is nothing left to keep but the **centre**: the new radius is taken along the direction the
centre already lies in and the turn is the run's own, rounded to whole revolutions.

**TWO POINTS ON A CIRCLE ADMIT TWO ARCS, AND THE ENDPOINTS DO NOT SAY WHICH.** That is the one thing this
control got wrong, and it destroyed the flagship case. `ms/circle.xml` is a 360° `Circle Left` whose ends are
**0.055** apart on a radius of 2.595 — so the chord is nearly a point, the *minor* arc through those ends is
**1.22°**, and "make circle" turned a **16.34**-unit orbit into **0.06**. A caller saw exactly that: *"a single
drag point and no trace line."* Measured over the ms level, **48 of 527** runs lost most of their length that
way. The missing quantity is the one SVG calls `large-arc-flag`, and the run itself supplies it — so a run that
**already has a centre keeps it**, and only its radius and turn move. A run that is *not* a circle has no centre
to keep, so there the **ends** are the anchor and the radius and side are what the caller supplies; that is the
case the "both ends kept exactly" property belongs to. Re-measured: **1125** runs, the worst keeps **98.6%** of
its path, and the turn moves by **5.5e-3°**.

**And a "circle" has to describe the run it was fitted to.** A relative tolerance alone is not enough: a
*straight* run sits inside any relative tolerance on a huge enough circle. `ms/grand_spin.xml` has two moves
that go straight, and Kasa described them as a circle of radius **28** at a relative deviation of 1.6e-2, just
inside the default; re-laying that run moved its end **0.73** units. `RUN_FIT_MAX_DEV` bounds the worst
deviation against the run's **own length** as well, and the corpus separates cleanly — of 2253 accepted run
fits the two bad ones sit at **29.9%** and **14.7%** of the path length and the worst that should be *kept* is
**3.8%**, so any threshold between them decides every run in the corpus the same way.

**A RADIUS IS THE WRONG HANDLE FOR THE THING THAT GOES WRONG.** An orbit can be the right *size* and in the
wrong *place*, which is what a caller reported: *"The Circle left call starting from Circle has a trace that is
an offset circle. I want to select all the moves, create the circle and then put the center of the circle at
the origin."* The witness is `ms/circle.xml`'s `Circle Left` from a `Circle` - its dancers stand on a ring of
radius **2.613** about the origin and walk an orbit of radius **2.595** whose centre is **1.013** units off it,
a *different* direction for each dancer because the authored offset lives in the dancer's own frame.

So the row carries a **centre**: `x` and `y`, an **origin** button, and a **clear**. And a named centre needs
**no radius at all**, because the run's start is pinned - `|start - centre|` *is* the radius. That is exactly
what makes this the right gesture rather than a translation: moving the centre while the start stays put can
only resize. MEASURED (`poc/tools/run-circle-probe.mjs` section 7), naming the origin on that call:

| | before | after |
|---|---|---|
| each orbit's centre, from the origin | **1.013** | **1.7e-7** |
| radius | 2.595 | **2.613** - its own start distance, so nothing was chosen |
| a dancer's **start** moved | - | **0.0** |
| the turn | 361.2deg | changes by **8.0e-8deg**, so it still closes |

The centre is **shared** across the selection (unlike the radius, which follows from each dancer's own ends),
and naming a radius clears a named centre and vice versa - they are two ways to drive the same two degrees of
freedom, not two independent numbers. A **drag** of the centre on the board is the intended next gesture and is
not built yet.
**A FULL SET OF PATHS AGAINST A HALF-SET FORMATION COULD BE WRITTEN BUT NOT READ.** Reported after an edit was
applied to the library: *"Path count mismatch for Circle Left: 8 paths vs 4 dancers."* `Circle` in
`formations.xml` authors **four** dancers; a tam that names it builds to eight by mirroring. An edited call is
always full-set, so it **names** the formation and carries **eight** paths - and the parser paired paths against
the authored **four** and threw *before* it mirrored.

**The writer and the reader disagreed, and only the writer was tested.** `tam-xml.ts` mirrors a four-dancer
formation to eight before comparing, with the note *"because that is what `buildCallImpl` does with a
four-dancer formation before pairing paths"* - which it did not. And the old gate asserted the exported XML
**contains** `formation="NAME"`, resolving it against a **registered eight-dancer** formation, so it never went
near this case. A gate on the *text* of an export is not a gate on the export.

The parser now materialises the half to a whole set **before** pairing. The duplicate is **placed** rather than
flagged: `mirrorToFull` keeps the base's `(x, y)` and lets `poseFor` negate it at read time, which is right
while **one** path is replayed for both halves and wrong the moment each dancer has its **own** path — the
negation would land on top of a start already placed. Round-tripped, both ways the app reads an edit:

| | |
|---|---|
| `formation="Circle"` + 8 paths, read with `mirror=false` **and** `mirror=true` | **8 dancers** |
| worst start-pose difference | **0.0** |
| worst orbit difference | **4.7e-5** (the export's four decimals) |
| dancers left carrying the mirror flag | **none** |
| the corpus | **5943** tams, still exactly the same **2** pre-existing failures |
**The saved list reads `<start formation> -> <call> -> <end formation>`, and a Setup is named by its FORMATION.**
Asked for as: *"Currently they are only listed by the start formation. But this makes it difficult to understand
what they are... The dropdown for the Setup should only use the Formation name."*

**Two of the three parts were not in the record.** An edit stores its own `name` and its XML, and nothing else —
so the call's title and the formation it finishes in are read back off the **rebuilt** call rather than copied
into the record, where they would go stale the moment the path was edited again. The end goes through the same
recogniser the browse and sequence views name formations with (`nameBoard`). MEASURED
(`poc/tools/saved-label-probe.mjs`): **383** calls named at both ends, **73%** of them finishing in a *different*
formation from the one they start in — so the third part says something the first one does not. The `kind`
(`create` / `clone` / `fix` / `instance`) moved into the row's tooltip, since the three parts are what the line
is for. A saved edit that will not rebuild leaves its row rather than taking the panel down.

**And the Setup dropdown named setups by `from`, which is free text FOR THE USER.** `from` labels an *embedded*
formation or gives a named one an alternative name, and `buildCallImpl` resolves the dancers from
`formationAttr` and never from it — so the corpus writes `from="Lines"` for a tam whose formation is
`Normal Lines`, and `from=""` for tams that name themselves entirely through `formation`. The preference is now
reversed, with `from` as the **fallback** (an embedded formation has no `formation` attribute, so its `from` is
the only name there is). MEASURED over four levels: **1876 of 2657** setups now read differently, and **847**
setups with a blank `from` are named by their formation instead of collapsing to `(default)`.
**`Export All` copies every saved edit, grouped the way the corpus files them.** Asked for as: *"add an 'Export
All' button that copies all the created calls. Each tam should be inside a tamination element under its
appropriate family title (this should match the existing tamination). Add a filepath property to taminations...
Also add a type property that indicates either 'clone' or 'update'."*

Each block is filed under the **file's own `<tamination title>`**, not a name invented here. A file groups all
its calls under one title — `arm_turns.xml` holds *Turn Partner by the Right*, *Left Arm Turn 3/4* and more
under **Arm Turns** — so a block that has to be merged back says which title it belongs beneath rather than
guessing. MEASURED (`poc/tools/export-all-probe.mjs`): **553 of 554** call files carry a `<tamination title>`,
in **486** distinct families, and **63 families are shared by more than one file** — which is exactly why the
`filepath` rides on the element too, since the title alone does not say *which* file.

**`type` is the app's own word, not a new taxonomy.** `doSave` already distinguishes a **replacing** edit
(`fix`, `instance` — identified by the setup it replaces) from an **appending** one (`create`, `clone` —
identified by its name, because the name *is* the new setup). The export writes those two as `update` and
`clone`, and the probe checks the two predicates are the same expression.

```
<tamination title="Circle Family" filepath="assets/ms/circle.xml">
  <tam type="clone" title="Circle Left" from="Circle" formation="Circle" ...>
```

**And the Setup label fix had to be made twice.** The precedence went into `callMeta` first — and `callMeta`'s
own output was measured — but **the Setup dropdown does not read `callMeta` at all**: `data.ts` walks the file
itself (it needs the tam *indices* as well as the labels) and built labels from `tams[i].from` directly. The
engine read said "1876 of 2657 changed" while the dropdown was untouched. The rule now lives in **one exported
function**, `setupLabel`, that both call sites use, and `saved-label-probe.mjs` measures it on the tams the
dropdown is actually built from: **1249 of 1879** setups over three levels read differently from their `from`.
**A link symbol next to every dancer whose TRACE is not the selected one's, which clones it.** Asked for as:
*"Add a link symbol next to the dancers that dont match, that will correct the non-matching coordinates using
the matching coodinates. Remove the link once they do match and select the now matching dancer"* — and then,
after using it, as: *"If I select one, I'd expect the paperclip symbol for the another dancer to copy the
correct dancers Moves and settings, with appropriate transforms, to the paper-clip trace. It should clone a
good trace to another dancer."*

**THE FIRST VERSION COPIED ONE CURVE OF ONE MOVE, AND THE PROBE THAT GATED IT COULD NOT FAIL.** It copied the
curve the tab edits at the move on screen, and `match-link-probe.mjs` compared the result *against the very
curve it was copied from* — so "the copy matches in 4632 of 4632" was a statement about a value being equal to
itself. Three real faults sat behind that green light:

- **the following trace was left swinging.** The write went straight to `setMove`, bypassing `foldMoveChange`,
  so a copy never reached `holdFollowingTrace` — the one fix every other curve write in this panel routes through
  (and the guard is now the FRAME TURN rather than the Facing tab, so travel writes are covered too — see the
  arc-fit section). The dancer's headings changed *and* everything after the move swung with them.
- **a facing could be written as a travel curve.** With no explicit facing on the reference, `rotate ?? translate`
  copied the translation Bézier into the `rotate` slot, whose `cy1` the format has no attribute for
  (`bezRotAttr` writes only `cx3/cx4/cy4/x4/y4`). It survived on screen and not in the file.
- **the link read the tab, and the tab could be stale.** `renderInstance` draws the formation table BEFORE
  `renderMoveStrip` normalises a stale `moveKind`, so for one frame the link was offered — and pressable — for a
  FACING curve the panel was about to stop editing, while the `matching` button in the same frame used the
  corrected one.

**IT NOW CLONES THE WHOLE PATH, AND EVERYTHING ABOVE FALLS OUT OF THAT.** `matchDancer` calls the engine's
`setDancerPath` — every move at once, with its facing, its beats and its hands — and the link is offered on
`donor && !sameTrace(donor, this dancer)`, which reads neither the tab nor the move index. There is no
"following trace" left to hold, because the moves after the one being edited are the donor's too; no curve is
converted from one kind to another, so nothing is written that the format cannot carry; and a whole-trace
question has no stale move index to be asked at.

**NO COORDINATE TRANSFORM IS NEEDED, and that is what "appropriate transforms" means here.** A path is authored
in the dancer's OWN frame (`types.ts`), so the local frame *is* the transform: the receiving dancer gets the
donor's motion relative to its own start pose. **The start pose, the gender and the home identity are
deliberately NOT copied** — those are the formation's, and a link that "made two dancers the same" by moving one
onto the other's spot would be rewriting the set, which is the Dancer scope's edit (`setDancerStart`).

**MEASURED (`node poc/tools/match-link-probe.mjs`, 861 donor/target pairs over 178 files):** the clone makes the
two traces the same in **861 of 861**, and the target's path is **value-equal** to the donor's in all of them —
not merely within the window, which is what "clone" has to mean. The mutation isolates the old gesture: one
curve of the move on screen leaves **568 of 861 (66%)** still not the same trace. A third leg exports each
cloned call and reads it back, where the two traces are **still identical in 33 of 33** — the leg that would
catch a copy the format cannot carry, and the one the old probe had no equivalent of. The probe's own control
refuses genuinely different traces (20 of the first 40 files), so "the same" is not a function that always
returns true.

**A copied point does not travel with the clone.** A `Seg` carries its copied coordinate as a key in the
editor's `moveClips`, and `carryMoveClips` pairs by position whenever the path length is unchanged — so without
an explicit drop, a point copied from the dancer's own OLD move would survive onto a move it was never taken
from. `matchDancer` deletes the target's entries for the new segments, the same rule that stopped a delete
carrying the removed move's point onto the move that took its index.

**Every export carries the BUILD it came from, as an XML comment at the top.** Asked for as: *"add an xml
comment at the top of the export containing the web apps buildhash. This should give basic version control when
importing them."*

```xml
<!-- exported by the dancing-squared web app: commit 7ee29bf, built 2024-06-01 12:00Z -->
```

Both exports carry it — `Export <tam> XML` and `Export All`.

**THE DIRTY FLAG IS THE HALF THAT MATTERS MOST.** A short hash identifies a *commit*, and an export made from a
working tree with uncommitted changes corresponds to **no commit at all** — so `commit abc1234` alone would be a
version stamp that is quietly wrong exactly when it is most needed. `__GIT_DIRTY__` is injected by
`vite.config.ts` beside the hash (the build footer already reads it), and the stamp appends *"with uncommitted
changes"* when it is set.

**A comment rather than an element**, because these blocks are pasted *into* a corpus file and an element would
become part of that file's data. A comment at the top of a document is legal; an invalid one is not, and `--`
may not appear inside a comment at all, so the probe checks the content contains none and that a stamped export
still parses back as the same single `<tam>`.
**An `Edit` button at the end of every user-formation row, opening that call in the Call editor.** Asked for as:
*"add an Edit button ager the del button that opens the selected call in the call Editor tab"*, placed *"at the
end of the row of buttons titled xml, In Corpus and del"*.

It switches the MODE SELECTOR to the editor, opens the **Edit instance** tab, and chooses the call and setup
there — the same thing as clicking the two lists by hand, so a caller who only wanted to look has **changed
nothing** (`instanceEdited` stays false and Save is not offered for a call nobody touched).

**A formation now stores the `callId` and `setupIdx` it was made from.** It could not before: `origin` is
display text built from the two dropdowns' labels — *"Circle Left (from Circle)"* — and cannot be resolved back
to a catalogue entry, so a row's Edit button had nothing to open. Formations saved before this have no ids and
fall back to whatever the Browse tab has selected now.

**And the editor clears its own filter if it has to.** Its three call lists are narrowed by the Level selector
and the Find box, and a formation can perfectly well have come from a call the editor is not currently offering
— so the button would otherwise fail on a panel state the caller cannot see the connection to. Clearing both is
the same as pressing Escape in the Find box.
**A `load` button beside `Edit`, which loads the call back into the Browse tab itself.** Asked for as: *"Add a
load before the edit button, the loads the call into the Browse Call tab and sets the Level, Call and Setup
according to the setup for the load button."* The row now runs `xml · add to corpus · del · load · Edit`.

**The order is the invariant, not a detail.** `populateCalls` only offers the calls of the level the selector
names, so setting the **Call** before the **Level** would be choosing it from a list that does not contain it.
The method sets Level → repopulates → picks the Call → rebuilds the setups → picks the Setup → shows the call,
which is the same order `onLevelChange` uses for the same reason. A call the level does not offer is *reported*
rather than leaving the panel on whatever was there before.

It is also the same three loads a click on the lists makes (`populateCalls`, `refreshSetups`, `loadCurrent`), so
this is not a second way to show a call — it is the way the panel already does it.

**Both buttons resolve a row's target through one helper**, so `load` and `Edit` cannot disagree about which
call a formation means: the ids it was made with, or the current selection for formations saved before those
were recorded.
**The Edit button carries the half-set reading, so a 4-dancer formation opens its 4-dancer call.** Reported as:
*"When editing a 4 dancer user defined formation, the Call Editor doesnt open the correct call, it ends up being
an 8 person equivalent"* — pressing Edit on a user-defined formation row in the Browse tab.

**The Browse tab's `Full square (mirror)` box decides how many dancers a half-set `<tam>` has**, and the editor
had no such control: `loadInstance` hardcoded `loadCall(id, tam, true)`. So a formation stored with the box
**off** — a *four*-dancer shape — opened the *eight*-dancer reading of its call, which is a different dance from
the one the caller was looking at. MEASURED over ms/a1: **1396 of 1879** tams are authored as four dancers and
become eight under mirroring, so this is most of the corpus, not a corner.

A formation now records `mirror`, `openEditor` and `openCall` carry it, and `loadInstance` uses it instead of
`true`. Picking a call from the editor's **own** lists still means the full square, which is what those lists have
always meant — the field only carries a caller in from the Browse tab. The `load` button puts the mirror box back
too, since it restores the same thing.

**And opening a half-set instance says so**, because the editor has no mirror control of its own and four rows are
otherwise unexplained: *"opened Circle Left — 4 dancers, the half-set reading (the Browse tab's mirror box was
off)"*.
**The `Full square (mirror)` checkbox is GONE — the full square is the only reading.** Asked for as: *"The full
square (mirror) checkbox is not required as it should always be enabled."*

It decided whether a half-set `<tam>` is built as four dancers or mirrored to eight, and **a formation is half the
set it represents** — so the whole set is the reading there is. The Browse tab now loads
`loadCall(id, tamIndex, true)`, the editor loads `loadCall(id, tam, true)` by the same rule rather than by a flag
carried between panels, and the `mirror` field a formation stored is gone with it.

That also removes the contradiction the last two commits were circling: the checkbox built a *four*-dancer board
out of a four-dancer `<tam>`, which is a shape the library never names (it holds whole sets) and a dance nobody
asked for. Nothing in the panel offered a half-set reading that could be named, so the state it created could only
ever look broken.

The control, the `EditorHost`/`EditorUI` parameter that carried its state, `onMirrorChange`, and the stored field
are all **removed rather than left switched on**.
**A click on the board opens the view options as a small dialog.** Asked for as: *"A click release on the dance
board, opens a small dialog with the Hide Dancers checkbox and a 2D/3D selector (similar to 2d icons checkbox).
Use Close button when finished."* The two checkboxes moved out of the panel row and into a `position: fixed`
dialog with a **Close** button.

**A release, not a press** — and that is the whole gesture. The same canvas carries the orbit controls and the
handle drags, so "opens on click" really means *does not open on a press that turned into a drag*. The test is the
pointer's own travel (**4 px**), plus whether a **handle** was under it — and that second test is taken at the
**press**, not read at the release, because the handle drag's own listener clears `dragHandle` on the same event
and the order the two listeners run in is not something to depend on.

**It is editor-scoped, like the options themselves.** `applyViewOptions` releases them when another panel is on
screen — *"a caller who hid the dancers in the editor would find them gone in the browse view too, with nothing on
that panel to explain why"* — so offering the dialog elsewhere would be offering two controls that do nothing. It
is closed on leaving the editor for the same reason.
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
  the per-level XML folders): real calls across **MS**, Plus, A1, A2,
  C1, C2, C3A, C3B load through the same converter. `npm run verify` runs a
  full-catalog scan and confirms every call loads. Non-call files (moves
  definitions and rule references without a `<tam>`) are excluded.
- **The per-level XML folders ARE the animations** fetched from the web
  `taminations-multiplatform` repo (`Taminations/src/assets/*`). `b1` and `b2` were
  retired in favour of `ms` 2026; the four calls that existed only there were migrated
  into `ms/`. The `ssd` level went the same way when CALLERLAB retired SSD and
  replaced Basic/Mainstream/SSD with one Mainstream programme: it had no directory,
  it was a view synthesized from `src/calls.xml`, and the catalogue is now exactly
  the files the corpus carries.
