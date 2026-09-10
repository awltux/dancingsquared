# PRD — Standalone Square Dance Engine with 3D Avatar Animation

## 1. Overview

A **standalone square dance engine library** that can be consumed as the internal engine for a square dance game/tutor (a separate project). It must be **data-efficient**, **easy to use**, and produce **animated 3D avatars** for the dancers, not just 2D markers.

The behavioral/mechanical definitions come from [`square-dance.md`](square-dance.md). The call, move, and formation data are **extracted from the `taminations-flutter` directory** (which is reference-only — we do **not** port its code, we ingest its **data**).

---

## 2. Goals & Non-Goals

### Goals
- Deterministic, data-driven rendering of square dance calls as **3D avatar animations**.
- Extract all call/move/formation data from `taminations-flutter` **once**, into a normalized, validated runtime bundle.
- Support rich 3D avatar motion: **position + facing (heading)**, **hand holds**, **arm movements**, and **body twists / torso lean**.
- Clean separation between (a) canonical data, (b) pure animation math, and (c) pluggable renderers (3D, 2D, SVG).
- Easy, ergonomic API for a downstream game/tutor.
- Testable: snapshot-compare engine output against taminations' known-good behavior.
- In the sequencer, support **user-defined modules** (named call sequences reused as fixes/getouts) alongside the built-in catalog.

### Non-Goals (v1)
- Porting taminations' sequencer/FASR rule engine (deferred; see §9).
- Full skeletal rigging / facial animation / clothes simulation.
- Audio synthesis (audio *files* are referenced but not required by the engine).
- Authoring tools for new calls (nice-to-have, later).

---

## 3. Source Data

### 3.1 Behavioral spec
[`square-dance.md`](square-dance.md) defines the computational model: 8-dancer grid, ghost dancers, FASR layers, call mechanics (entry/core/exit padding), timing, and collision rules. This is the **semantic contract** the engine must honor.

### 3.2 Extracted data (from `taminations-flutter/assets`)
All of the following already exist as **declarative XML** and are the sole source of truth (no Dart code is ported):

| Data | File(s) | Content |
|------|---------|---------|
| **Moves** (path primitives) | `assets/src/moves.xml`, `assets/ms/moves.xml` | Named `Path`s of `Movement`s; each `Movement` = 1–2 cubic Bézier curves (translation + optional facing) + `beats` + `hands`. Composed via `<move select>` with `beats`/`scaleX`/`scaleY`/`reflect`/`hands`/`offsetX`/`offsetY`. |
| **Formations** | `assets/src/formations.xml` | `<formation name>` = list of `<dancer gender="boy\|girl\|phantom" x y angle>`. |
| **Calls** | `assets/{ms,plus,a1,a2,c1,c2,c3a,c3b}/<call>.xml` (≈498 files) | `<tamination>` = multiple `<tam>` variants; each has metadata (`title`, `from`, `parts`, `fractions`, `difficulty`, `sequencer`, `display`, `formation`) and one `<path>` per dancer (or per dancer-pair). |
| **Catalog** | `assets/src/calls.xml` | Ordered index: `<call link="ms/pass_thru" title="Pass Thru" audio="..."/>`. |

**Decision:** the XML is the **canonical, hand-curated source**. We do **not** re-author calls by hand. A **build-time converter** normalizes it into a typed JSON runtime bundle (see §5). If a hand-authored catalog is ever preferred over XML, JSON-first authoring is a drop-in replacement for the same converter.

> ⚠️ **License:** the source is GPL/AGPL-licensed. The animation/formation/move *data* is freely reusable with attribution. Preserve license headers in any copied data; verify downstream compatibility for the consuming game project.

---

## 4. Architecture

```
   CANONICAL SOURCE (declarative, curated)
   moves.xml  formations.xml  calls.xml  call/*.xml
            │
            │ build-time converter + schema validator
            ▼
   RUNTIME BUNDLE (normalized, typed JSON, static)
   moves[].segments[]  formations[]  calls[].variants[]
            │
            ▼
   CORE ENGINE (pure, side-effect-free, TypeScript)
   pose(call, t) -> Pose[]       (x, y, heading)
   + avatar(call, t) -> AvatarPose[]  (hands, arms, torso)
            │
   ┌────────┴─────────┐
   ▼                  ▼
   TIMELINE/SEQ.   RENDER ADAPTERS
   phases, beats,  Three.js | 2D canvas | SVG
   FASR, sequencer
```

**Layered rules:**
- Each layer depends only on the layer directly below.
- The core engine has **zero** renderer dependencies.
- Rendering has **zero** knowledge of data semantics — it consumes `Pose[]`/`AvatarPose[]`.

---

## 5. Runtime Bundle (build-time normalization)

The converter eagerly **resolves the entire `<move select>` reference graph** into flat, concrete segments, folding in all modifiers:

- `{ beats, hands, translateBezier, rotateBezier }` per segment.
- Modifiers applied: `scaleX/scaleY`, `reflect` (mirrors geometry **and** swaps left/right hands), `beats` override (rescales child timings proportionally — same semantics as Dart `changeBeats`), `hands` switch, `offsetX/offsetY`.

**Correctness-critical composition rules to preserve exactly** (they mirror taminations' Dart semantics):
- `Pass Thru = Extend Left(scaleY .5) + Extend Right(scaleY .5)`.
- `Pull Left = Extend Left(hands=right)`; `Beau Wheel = BackRun Right(hands=gripright)`.
- A `reflect` of a path that uses hands flips `right↔left` and `gripright↔gripleft`.

**Guarantees this buys:**
- **No recursive resolution or cycle handling at play time** — the hardest part of taminations is solved once, at build time, verifiably.
- Timing is `O(1)` per segment; total beats known up front.
- The bundle is **validated against a typed schema (Zod)** — replacing the weak DTD with load-time guarantees.
- Paths normalized to **one path per dancer** at load (handles taminations' "one path per 2 dancers" pairing) to avoid alignment edge cases.

**Half-group duplication.** Many taminations calls are authored for **one half**
of the square only (e.g. Brace Thru "Lines, Boys Ends" is a single line of 4;
a "Box" is one couple). The converter builds the full move by adding the
duplicate half as a **180° rotation about the origin** of the base dancers
(`(x,y) -> (-x,-y)`, `heading -> heading + 180°`, applied at pose-evaluation
time). Duplication is auto-applied only when unambiguous: it is skipped when a
dancer's 180° partner already exists in the formation (formation already
contains both halves, e.g. a full Squared Set or an on-axis wave/column).

---

## 6. Core Engine (pure, immutable, TypeScript)

Small, fully portable 2D math + pose evaluation:

```
Vec2, Mat2 (2D affine), Bezier2 (pointAt, derivative, angle, scale, clip)
pose(dancer, t) = startTransform(x, y, heading) ∘ path(t)
path(t)         = accumulate segment.bezier at clamped local time
```

- **No mutation.** A `Dancer` is a pure `{ spec, resolvedPath }`; every frame computes a fresh `Pose[]` from the playhead beat. Snapshot-testable, parallelizable, free of shared-state bugs.
- Facing/heading is always along the Bézier tangent (`atan2` of derivative), matching taminations.
- Supports geometry variants (square, hexagon, bigon, hashtag) as affine pre/post transforms on the pose.

---

## 7. 3D Avatar Animation (new capability)

In addition to `Pose[]` (position + heading), the engine emits **`AvatarPose[]`** — richer per-dancer data driving 3D humanoid avatars. This is where **hand holds, arm movements, and body twists** live.

### 7.1 Data model additions
Extend each segment (and the resolved bundle) with hand-hold awareness. The `hands` field on a `Movement` already encodes grip state per movement; we promote it to first-class avatar data:

- `hands`: `none | left | right | both | gripleft | gripright | gripboth`.
- **Hand-hold resolution:** at each beat, derive the set of active grip connections (which dancers are gripping whom, and with which hand). A grip connects exactly two dancers; the connector is a positional constraint for both.

### 7.2 Per-dancer avatar pose fields
For each dancer at beat `t`, `AvatarPose` = `Pose` plus:

- **Heading / yaw** — from the curve tangent (§6); drives the avatar's facing direction about the vertical axis.
- **Hand holds** — resolved grip partners and grip hand(s) per segment.
- **Arm positions** — computed from hand holds + movement:
  - `shoulder` from the dancer's torso origin.
  - `hand` target = the **grip point** (midpoint toward the partner, or a designated hold point), or a relaxed neutral pose when free.
  - `elbow` solved from shoulder + hand (simple 2-bone IK or predefined easing when no partner).
- **Body twist / torso lean** — subtle secondary motion for realism:
  - **Torso twist** around the vertical axis, based on hand-hold side and direction of travel.
  - **Lean** forward/into turns derived from path curvature (derivative of heading).
  - Clamped so limbs never clip through the floor or the partner.
- **Optional per-level flags** for custom arm choreography where generic 2-bone IK is insufficient.

### 7.3 Avatar representation
- **Avatars:** simple humanoid rigs (capsule/teardrop torso, limbs as segmented capsules). Boy/girl/phantom distinct. **Instanced** for performance (many dancers on screen).
- **Labels:** name/number/couple sprites overhead.
- **Phantom dancers:** styled ghostly/translucent (do not collide — see `square-dance.md` ghost rules).
- **Hand-hold indicators:** visible connectors or grip rings during held segments (teaching aid).

### 7.4 Lead-in / lead-out "square breathing"
Inactive dancers still get slight idle motion (subtle bounce/sway) so the set feels alive between calls. Data flag mirrors taminations' `isJustBreathing`.

### 7.5 Collision & clipping guardrails
- No two physical dancers occupy the same `(x, y)` (from `square-dance.md` §5); ghost dancers bypass occupancy.
- Arm/torso IK results are validated so limbs don't interpenetrate the partner or floor.

---

## 8. Timeline, Timing & Phrasing

- **Metric unit:** musical beats; default tempo 128 BPM (per `square-dance.md` §4).
- Call timeline modeled as explicit **phases**: `lead-in`, `parts`, `fractions`, `lead-out`.
- Singing-call macro-structure (64 beats / four 16-beat phrases) is ordinary data for the validator, not special-cased in the engine.
- Beat clock: `beat = elapsedMs / msPerBeat`; `requestAnimationFrame` playhead with play/pause/seek/step-part/loop (mirrors `BeatNotifier` semantics).
- **Declared beat cost.** Every call reports a beat cost. A geometry-derived call (§9.5.4)
  declares it explicitly instead of deriving it from a path, and the declared value is the
  one the timeline, the analyser and the legality listing all use — the cost is not
  computed twice.
- **Board-dependent duration is declared as an approximation.** Where a call's true
  duration depends on the board (how far a set promenades is how far it has to travel), the
  engine declares one approximate cost and states it as an approximation; it must not be
  presented as measured.

---

## 9. Sequencer & FASR (deferred to v2)

- **Not in v1.** Taminations' sequencer/rule engine is the largest non-data-driven piece.
- v2 scope: a **separate module** that only *reads* `Pose[]`/`AvatarPose[]` and emits calls — fully decoupled from the animator. FASR formation/arrangement/sequence/relationship evaluation lives here and on top of the normalized bundle, not in the core.

### 9.1 User-Defined Modules (fixes / getouts)

A **Module** is a user-defined, named sequence of calls that represents a reusable
**fix** or **getout** — a short choreography the caller wants to remember and
reuse (e.g. a specific getout into a Squared Set). To the sequencer a module
looks like a single call, but it is **authored by the user** rather than coming
from the taminations data.

**Data model**

```ts
interface Module {
  name: string;          // e.g. "Alamo Getout"
  calls: string[];       // the underlying calls, in order
  level?: string;        // optional (e.g. "ms")
  tags?: string[];       // e.g. ["fix", "getout", "from-ocean-waves"]
  notes?: string;
}
```

**Semantics**
- A module behaves like **one call**: applying it replays its `calls` in sequence
  against the board, with identity and FASR advancing exactly as if the calls
  were typed one by one.
- **Legality** of a module at a given formation = every contained call is legal
  in turn (data-driven). A module is only "available"/listed if it is legal from
  the current board.
- **A getout ends at the standard finish, not necessarily on the literal home board.**
  A get-out succeeds when it reaches a state from which the standard finish resolves —
  `Allemande Left`, `Right and Left Grand` or `Promenade` — which is the caller
  convention decided in `square-dancing.md` §9.1. The engine's own `getout()` search
  still requires the literal home board and cannot use geometry-derived calls; that
  divergence is an open decision (§14).
- Modules live in a **user library** (persisted and editable) separate from the
  built-in catalog. Built-in calls and modules share the same picker, `legalNext`,
  `getout`, and `fixIt` surfaces — modules are tagged as **user-defined**.
- A module may be used inside another module (**nesting**), guarded against cycles.
- **Authoring:** capture the current sequence as a module (give it a name), or
  define it textually (a list of call names). Editing a module updates every
  reference to it.

**Sequencer integration**
- `getout` and `fixIt` treat a module as a **single step**, so a remembered getout
  can be found or suggested as one unit.
- Applying a module is equivalent to its expansion, so any sequence that uses
  modules can always be **flattened** back to plain calls.

---

## 9.5 Formation & Call Matching — Contract, Restrictions & Edge Cases

The engine matches a **board** (usually 8 dancers) against a **candidate** — a
recognized formation or a call's `<tam>` start setup — up to translation,
rotation (multiples of 90°) and reflection. This is the foundation of
recognition, call legality, and every getout/getin/fixIt search, so its contract
must be explicit. The reference implementation is `matchFormations` /
`matchFormationsAll` in `engine/src/sequencer/match.ts`.

### 9.5.1 Core contract

- **Order-independent.** Matching must not assume the board dancers are indexed
  in the same order as the candidate. It uses the **sorted pairwise-distance
  signature** (invariant to translation/rotation/reflection) as an order-
  independent quick-reject, then a **greedy one-to-all assignment** per
  rotation/reflection. Reordering the dancers in either set must not change the
  result.
- **Length handling:**
  - `source.length === target.length` → a **full one-to-one** match.
  - `source.length > target.length` → a **subset match**: the board *contains*
    the smaller target; we search all `(n choose k)` board subsets and return the
    best one that reproduces it (`match.subset` lists the chosen board indices;
    `mapping` is full-length with `-1` for unselected dancers).
  - `source.length < target.length` → **null** (a target cannot fit in a smaller
    board).
- **Multi-match.** A smaller formation can appear **several times** in one board
  (e.g. four separate Facing Couples in a squared set). `matchFormationsAll`
  returns **all disjoint copies** (no dancer reused across copies), sorted by
  error, with a `maxMatches` cap. The single `matchFormations` returns only the
  best copy for backward compatibility.
- **Gender consistency (opt-in).** For calls marked `sequencer="gender-specific"`
  (e.g. "Boys Turn Back", "Allemande Left"), a board dancer is only assigned to a
  candidate slot whose gender is compatible (`phantom` is a wildcard). Gender-
  specific calls must NOT match a board whose boy/girl arrangement differs, even
  if the geometry is identical. Non-gender-specific calls ignore gender.
- **Variant selection for gender- or position-qualified calls.** When a call is authored
  in several variants distinguished by gender or by position in the formation (e.g.
  `Boys Trade` with the boys as Centers vs as Ends), the engine selects the variant from
  the **declared gender** plus the **designated dancers' actual geometry**, and it moves
  **only the dancers the call names**. A variant that moves a dancer the call does not
  name is wrong even when its end board is a legal formation. (Currently violated for
  `Trade`/`Run` from waves and two-faced lines — see `square-dancing.md` §9.2.)
- **Identity is input, never output.** Matching carries each dancer's declared home couple
  and gender; neither may be inferred from position or index (`square-dancing.md` §8.2).
  A rule that needs identity refuses when it is unknown rather than inventing a grouping.
- **Name resolution is engine data.** A published name that differs from the catalogue
  title (`Touch 1/4` → `Touch a Quarter`, `Do Sa Do` → `Dosado`) must resolve inside the
  engine's canonical-name path, not in a test harness, and a call may legitimately carry
  several authored aliases resolved through one registry. (Currently the bridge lives in
  `engine/test/lib/engine-calls.mjs` and `CALL_SYNONYMS` is empty — see
  `square-dancing.md` §9.2.)

### 9.5.2 Restrictions

- **Subset matches are not whole-board applies.** A subset match means "this
  setup lives somewhere in the board"; it must NOT be applied as a full-board
  call (its `mapping` has `-1`). Subset application is handled separately by the
  parallel-subset path (`partitionInto` / `parallelLegalCalls`).
- **Force-fits must be rejected.** A candidate that shares the same spacing
  lattice but is a *different* formation (e.g. a T-Bone start onto a Double Pass
  Thru board) must not be treated as legal. The distance-signature quick-reject
  passes for identical lattices, so the final assignment error must be within the
  caller's tolerance to reject it.
- **Search vs interactive tolerance.** The getout/getin **search** uses a looser
  tolerance (pure-relative, drifting boards) than the **interactive apply**
  (tight, snap-clamped). Any search-found path must be **re-validated on the
  interactive apply path** before it is returned, so a returned getout genuinely
  starts from the current formation and reaches home (`verifyInteractivePath`).

### 9.5.3 Edge cases

- **Same-geometry, different-gender boards.** Two boards with identical geometry
  but different boy/girl placements must be distinct inputs to a gender-sensitive
  match: the match memo key **must include gender** for such calls, or a cached
  result leaks across arrangements.
- **Uneven remainder.** A board that cannot be split evenly into equal subsets
  (e.g. 6 dancers for a 4-dancer subset) has no clean partition and must not
  force one.
- **Offset / frame invariance.** The same shape translated or rotated in the board
  must still match (the signature + recentring handle absolute position/orientation).
- **Half-set authoring vs genuine subset.** A 4-dancer wave authored as a half-set
  and completed to an 8-dancer formation is **not** the same as a 4-dancer subset
  the dancers actually occupy. Matching treats the full, centered formation as the
  unit; a genuine subset match requires the board to actually contain that group.

### 9.5.4 Geometry-derived calls

Not every call is a setup. A call may be **geometry-derived** — computed from the board
rather than matched against an authored `<tam>`. This is not a catalog edge case; it is a
third kind of call, with its own contract. Two flavours exist:

- **Pivot / re-facing** (`Face Left`, `Face Right`, `U-Turn Back`, `Face In`, `Face Out`) —
  a per-dancer transform, well defined on any board, so it never refuses.
- **Resolve** (`Promenade` / `Promenade Home`) — a whole-set call, legal only from some
  boards, which carries a **precondition over the board** (identity plus geometry) and
  REFUSES instead of returning a board. The reference implementations are
  `engine/src/sequencer/coded-moves.ts` (the registry) and
  `engine/src/sequencer/promenade.ts` (the resolve's rule).

**Contract**

- **One definition, every consumer.** Apply, replay and animation all read the same
  registry entry: the legality, the end board and the beat cost may not be re-derived per
  consumer. A resolve that does not apply leaves the replayed board where it is — it must
  not teleport the set home.
- **A refusal is a result, not a false.** A refusal returns the board unchanged plus a
  human-readable **reason**, in the same `{ legal, reason }` shape as a catalog legality
  failure, so a caller (or the call picker) can show why. A reason-less refusal is a defect.
- **A resolve ends at home by identity, not by shape.** The result is the literal squared
  set — every dancer on its own home spot **and facing**, compared per dancer by identity
  rather than by recognizing the end formation. Facings may be left out of the
  *precondition* where forming up is part of the call; they may not be left out of the
  *result*.
- **Grouping is by identity.** A rule that groups dancers (a couple, a ring) groups them by
  declared home couple/gender, never by who is standing next to whom or by index, and
  refuses when identity is unknown rather than guessing a grouping.
- **Permissiveness has a floor.** A rule may be relaxed — facings ignored, geometry snapped
  rather than matched exactly — but it must never accept a state the model says cannot
  occur. A resolve must not succeed from a board whose partners are not standing as a
  couple: the standard couple separation is 2, so the accepted band is ±1, because every
  healthy state in the published corpus measures exactly 2 apart while the states a broken
  body produces measure 0, 4 or 6. Without that floor a wrong body is laundered into a
  false success.
- **Aliases belong to the call.** A geometry-derived call resolves every name it is
  registered under (`Promenade` and `Promenade Home` are one call), so a published finish
  is not a catalogue gap.

---

## 10. Rendering

- Renderers are thin adapters over `Pose[]`/`AvatarPose[]`:
  - **Three.js (primary, 3D):** instanced dancer rigs, floor grid, path trails (reprojected Bézier chains as 3D curves), orbit camera, hand-hold connectors, optional 2D overlay mode for teaching.
  - **2D canvas / SVG (secondary):** derived from the same core — the engine stays render-agnostic.
- **Recommended stack:** TypeScript everywhere, **Three.js** for 3D (largest ecosystem, instancing, orbit controls, WebGL/WebGPU fallback), **Vite** for build, **Zod** for data validation, `requestAnimationFrame` for the playhead.

---

## 11. API Sketch (ergonomics)

```ts
import { loadCall, pose, avatarPose, duration } from 'dancing-squared-engine';

const call = loadCall('Pass Thru');           // from runtime bundle
const beats = duration(call);                  // total beats incl. lead-in/out

function onFrame(ms: number) {
  const t = msToBeat(ms);
  const poses = pose(call, t);                 // Pose[] {x, y, heading}
  const avatars = avatarPose(call, t);         // AvatarPose[] adds hands/arms/torso
  scene.update(poses, avatars);                // render adapter, no engine knowledge
}
```

---

## 12. Testing & Validation

- **Snapshot tests:** compare `pose(call, t)` against taminations' known-good output for a sampled set of calls.
- **Data schema tests:** every bundle entry validates against Zod; converter rejects malformed XML/DAG cycles.
- **Invariants:** dancer count, one-path-per-dancer, total-beat sums, 64-beat macro-checks, no-position-collision, ghost-vs-physical separation.
- **Matching invariants (§9.5):**
  - Order independence: matching is unchanged when the dancers of either set are reordered.
  - Equal-length full match, and unequal-length subset match (a full board contains a 2/4-dancer target).
  - Multi-match: a smaller formation present N times yields N disjoint copies; copies never reuse a dancer; `maxMatches` caps results.
  - Gender-specific calls reject a same-geometry board with a different boy/girl arrangement; gender-agnostic calls still match.
  - A getout/fixIt search never returns a path whose first (or any) call fails the interactive apply.
  - Uneven-remainder boards (not evenly divisible into equal subsets) are rejected, never force-partitioned.
  - A geometry-derived call (§9.5.4) agrees across apply, replay and animation: same
    legality, same end board, same beat cost; a resolve that does not apply leaves the
    replayed board unchanged.
  - A resolve is a resolve only when **every** dancer returns to its own home spot and
    facing, compared per dancer by identity — never by recognizing the end formation.
  - Every refusal carries a reason; a legality check that comes back false with no reason
    fails the gate.
  - Legality never accepts a boundary state the model says cannot occur — partners who are
    not standing as a couple, or two dancers on the same spot.
  - A gender- or position-qualified call moves only the dancers it names.
- **Golden 3D stills:** fixed-camera renders at key beats for visual regression.

---

## 13. Milestones

1. **Data pipeline:** converter + schema + normalized bundle for moves/formations/calls; catalog load.
2. **Core engine:** pure `pose(call, t)`; snapshot parity vs taminations on a sample of calls (e.g. Pass Thru, Brace Thru).
3. **3D scene:** Three.js stage, dancer instances, floor grid, camera, playhead.
4. **Avatar layer:** `AvatarPose` (hands, arm IK, torso twist/lean), breathing, hand-hold connectors, phantoms.
5. **Path trails + teaching overlays + 2D adapter** (secondary).
6. **Sequencer/FASR (v2).**
7. **Sequencer modules:** author, persist, and apply user-defined fix/getout modules (single-step in getout/fixIt, flattenable to plain calls).

---

## 14. Open Decisions

- **3D engine:** **Three.js** (recommended) vs Babylon.js.
- **Authoring format going forward:** keep XML as canonical, or migrate the bundle to hand-authored JSON.
- **Scope of sequencer/FASR:** confirm deferral to v2.
- **Does the engine's own `getout()` search adopt the caller convention?** The convention —
  a get-out succeeds when it reaches a state from which the standard finish resolves — is
  settled as the acceptance criterion for published get-outs (`square-dancing.md` §9.1),
  but the search still requires the literal home board, and the precomputed FSM table and
  `legalCalls` enumerate the catalog, so it cannot use a geometry-derived resolve such as
  `Promenade` at all. Adopting it inside the search finds get-outs the corpus says exist,
  at the cost of returning paths that end one standard finish short of home, which every
  consumer must then be able to play; keeping the literal target keeps a returned path
  self-contained but under-reports and leaves amendments from synthesised boards
  impossible (`square-dancing.md` §9.2).
- **Target platform/consumers** of the downstream game/tutor to finalize API surface.

## 15. Teachers Session Tracker

A teacher wants to run a class teaching a level of dancing (e.g. SSD or MS). The
tool is **primarily mobile**, targeted at an older audience, so it must be easy to
read, tap, and understand: large type, big touch targets, high contrast, and a
set of **inter-related pages** with a simple bottom navigation.

### 15.1 Class instances & sessions

- A teacher may have **multiple class instances** in progress, each with a
  different set of students and its own **register of students**.
- A class is an **ordered list of sessions**. Each session is "like a multi-level
  level": it **introduces a new set of calls** (the session's *planned* calls) that
  build on everything taught in earlier sessions.
- A **session starts with an empty *taught* list.** During the session the teacher
  moves calls from the session's *planned* into its *taught* list (in the PoC,
  tap a planned call to teach it, tap a taught call to move it back).
- **Move plan to next:** the teacher can move **all** of the current session's
  planned calls to the next session's plan. If there is no next session, **create
  a new one** to hold them.
- **Pull from next:** the teacher can **pull the next call** from the next
  session's planned list into the **current session's planned** list (when there
  is time to teach more).

### 15.2 Attendance & student knowledge

- Each session keeps a **register of who was present and who was not.** A session
  starts with an empty register; the teacher marks each student present/absent.
- From the attendance registers the app derives, **per student**, which calls they
  **know** (taught in a session they attended) and which they **missed** and will
  **need re-teaching** (taught in a session they were absent from and not known
  from before).

### 15.3 Problem call-setups & prioritisation

- The teacher can **record which call-setup a student or the class is having
  problems with**, with a **priority**, so it is practised more.

### 15.4 Programmes (default course) & import/export

- A **Programme** is the default course: an ordered list of sessions, each with
  the **calls assigned to it** (by title).
- A programme is **importable and exportable** (a shareable JSON list of sessions
  with their calls), so a teacher can move a default course between devices.
- **Creating a new course** lets the teacher **pick a programme** (the built-in
  default or an imported one) and name the class; the programme's sessions become
  the course's sessions. Fields are validated with clear error feedback (e.g. the
  course name is required).

### 15.5 Practice tips / modules

- Before a session, the teacher can **auto-generate or manually create
  tips/modules** that use **only the current and previous sessions' calls**.
- Tips **prioritise the current session's calls and any call-setups flagged as
  problems.** Practising calls **from different positions** (setups) is key.
- Tips are **saved as modules against the session they were created from.**
- Tips can be **modified by inserting, changing, or removing calls.** The app
  **offers calls that can fit before, replace, or after the selected call** (from
  the calls the class knows, checked for legality against the current board).
