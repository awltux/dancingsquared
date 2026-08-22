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
- **Target platform/consumers** of the downstream game/tutor to finalize API surface.

## 15. Teachers Session Tracker

A teacher wants to run a class teaching a level of dancing e.g. SSD or MS. 
A default programme initiates a class instance by assigning calls to each session. As session is therefore like a multi-level level. 
Each session introduces a new set of calls, however some sessions they are unable to teach all of the calls and the untaught calls move the next session. Or they have time to teach more and pull calls forward from the next session. 
They may have multiple class instances in progress with different sets of students. Each class instance should have a register of students and each session will have a registers of who was there and who wasnt. This tells the teacher what calls they should  know and what they have missed and will need retaught in the next session. The teacher can also record which call-setup a student or class is having problems with, prioritising which call-setup should be practised more. 
Before a session starts, the teacher can auto-generate of manually create tips/modules that use only the current and previous sessions calls. They will prioritise the current sessions calls and any in the set that have been prioritised. Practising calls from different positions is key. These tips will be saved as modules against the session they were created from. The tips can be auto or manually generated and can be modified by inserting, changing or removing calls. The app offers calls that can fit before, replace or after the selected call.
