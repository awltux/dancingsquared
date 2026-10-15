# Square Dance Engine Technical Specification

This document defines the computational model, mechanics, and terminology for a **Modern Western Square Dancing (MWSD)** call engine. Every movement is treated as a **deterministic state transformation** operating on an 8-dancer grid.

---

## 1. Core Terminology & Data Structures

### 1.1 The 8-Dancer State Space & Ghost Dancers

A square consists of **8 active dancer entities**. Each dancer entity maintains the following properties:

- **Identity:** a unique identifier per dancer.
- **Role:** BOY (or Head/Lead) or GIRL (or Trail/Follow).
- **Couple:** the home couple assignment (`1` to `4`).
- **Position:** absolute Cartesian coordinates on a normalized floor grid.
- **Facing:** a cardinal or ordinal heading vector (North, East, South, West, or directional offsets).
- **Role flags:** metadata tracking original partners, corners, and active/inactive status.

#### Ghost Dancers and Imaginary Pairs

To resolve complex conceptual mechanics—such as phantom columns, incomplete boxes, or fractional formations where dancers must interact with missing partners—the dance model supports **Ghost Dancers** (or *phantoms*):

- **Ghost marker:** marks a non-physical entity (as opposed to a physical dancer).
- **Anchor:** the reference active dancer or virtual axis the ghost is tethered to.

**Function:** Ghost dancers do not occupy physical collision space on the floor, but they provide necessary geometric reference points for calls defined around larger matrices (e.g., fractional setups, phantom waves, or split-phantom processing).

### 1.2 The FASR Framework

Every frame of execution evaluates the current formation using four hierarchical layers:

- **Formation:** The global geometric layout (e.g., Squared Set, Parallel Ocean Waves, Box of 4, Columns, Diamonds, Two-Faced Lines).
- **Arrangement:** The relational pairing and gender/role distribution across the formation.
- **Sequence:** The topological distance from the home/in-sequence state.
- **Relationship:** Local adjacency mapping (who is to the immediate Left, Right, Partner, and Corner).

---

## 2. Grid Geometry & Spatial Coordinates

### 2.1 The 4 × 4 Lattice Foundation

- **Base Structure:** The foundational framework of a square dance floor is mapped onto a discrete $4 \times 4$ unit coordinate grid (or a high-resolution sub-grid derivative, such as an $8 \times 8$ or continuous floating-point space scaled to integer anchor points).
- **Squared Set Layout:** In the home formation (Squared Set), the 8 dancers occupy specific perimeter nodes of the $4 \times 4$ grid, leaving the inner $2 \times 2$ matrix empty for central circulation (e.g., Pass Thru, Square Thru).

### 2.2 Off-Grid and Intermediate Positions

- **Dynamic Fluctuations:** While static formations (like waves and lines) snap cleanly to grid intersections, intermediate animation frames require fractional or off-grid coordinates (e.g., half-way through a Circulate or Hinge).
- **Collision Handling:** Grid points serve as discrete snap-targets for end-states, while intermediate transition frames use vector interpolation. Ghost dancers are omitted from spatial occupancy exclusion checks.

---

## 3. The Mechanics of a Call

Every standard MWSD call is modeled as a **discrete state machine** composed of three sequential phases:

$$\text{Call} = \text{Entry Padding} + \text{Core Movement} + \text{Exit Padding}$$

### 3.1 Entry Padding (Pre-requisite Alignment)

- **Function:** Resolves discrepancies between the current input formation and the strict domain required by the core movement.
- **Action:** Injects micro-adjustments (e.g., fractional turns, stepping forward/backward, joining hands) to establish required hand-holds or spatial alignments. May instantiate ghost anchor frameworks if required by phantom setups.

### 3.2 Core Movement

- **Function:** The invariant geometric transformation.
- **Action:** Executes vector rotations, translations, and arm-turns around dynamic local axes (Centers vs. Ends, Box pivots, Wave hinges) independent of initial global orientation.

### 3.3 Exit Padding (Post-movement Resolution)

- **Function:** Smooths kinetic flow and standardizes the output state.
- **Action:** Applies directional corrections (e.g., turning $90^\circ$ left or right) so that the ending formation maps cleanly into the domain expected by the subsequent call, cleaning up any temporary ghost references.

### 3.4 Calls Without an Authored Path

The three phases above describe a call authored as a path. A call may instead be
**geometry-derived** — computed from the board, with no `<tam>` and no Bézier path. Two
kinds, with different mechanics:

- **Pivot / re-facing** (per-dancer transform): the same transform on every board, so it
  always applies, occupies a fixed declared beat cost on the timeline, and has no entry or
  exit padding — the dancer keeps its spot and only the facing changes.
- **Resolve** (whole-set): the end state is defined by **identity** — every dancer on its
  own home spot and facing — not by a stored path, which is why it cannot be authored as a
  `<tam>` and why its duration depends on the board (§4). A resolve carries a
  **precondition** over the board (identity plus geometry) and **refuses** — returning the
  board unchanged and a reason — when the board does not meet it, rather than producing a
  state. `Promenade` / `Promenade Home` is the standard finish of this kind.

A geometry-derived call is defined **once**, in a registry that both the sequencer (apply)
and the analyser (replay and animation) read, so the same call cannot be legal in one and
illegal in the other, and its refusal is a reported result rather than a silent `false`.

---

## 4. Timing and Musical Phrasing

- **Metric Unit:** Square dancing operates strictly on musical beats. Standard hoedown and singing call tempo is $128\text{ BPM}$.
- **Beat-Weights:** Every call has a fixed integer beat cost (e.g., Pass Thru = 4 beats, Grand Square = 32 beats, Left Allemande = 8 beats). A geometry-derived call (§3.4) declares its cost in the registry instead of deriving it from a path, and that one declared value serves the timeline, the analyser and the legality surfaces alike.
- **Board-Dependent Duration:** Where a call's true duration depends on the board, the declared cost is an **approximation that must be stated as one** — a promenade's length is the distance the set has to travel, so its fixed cost is a simplification, not a measurement.
- **Singing Call Macro-Structure:** A standard segment consists of exactly 64 beats (subdivided into four 16-beat phrases). A valid sequence must sum to $64\text{ beats}$ (or account for continuous terminal actions like a Promenade).

---

## 5. Tips: The Structural Unit of a Square Dance

### 5.1 What a Tip Is

- A **tip** is the fundamental unit of a Modern Western Square Dance program — the continuous block of dancing performed between two musical records (or, in a live setting, between caller pauses). A typical tip lasts roughly **10–15 minutes**.
- An evening (dance) is made up of several tips — commonly **6 to 10** — that alternate between:
**patter tips** (instrumental music, no vocals) and 
**singing call tips** (a familiar tune with sung calls). The caller calls every figure in each tip.
- A tip is **self-contained**: its choreography is a *zero*, meaning it begins and ends at the **squared set** (home, in-sequence). This lets each tip start fresh from the same state, regardless of what came before.

### 5.2 How a Tip Is Constructed

A caller builds a tip from a sequence of **figures**, each a short, self-contained call routine. Every figure is a **zero** — it must begin and end at the squared set with the dancers' home FASR restored. The standard components, in order:

1. **Opener (Opening).** The first figure, which takes the dancers out of the squared set, moves them, and brings them back home — warming the square up. Common openers: *Circle Left + Forward and Back + Circle Right*, *Grand Square*, or an *Allemande Left + Promenade Home*.
2. **Figure (the core).** The main call sequence, performed by the whole square. In both singing calls and patter, the same figure is usually repeated **four times**, once with each couple leading — Heads, Sides, then their opposites — so all eight dancers get a turn as the active couple. Each repeat is a zero so the next couple can take the lead.
3. **Break / Middle Break.** A shorter, simpler zero figure inserted for variety and to give dancers a breather. In a singing call a **break** follows the opener; in a patter tip a **middle break** may split the tip into two halves.
4. **Closer.** A figure near the end used to wind the tip down and return everyone to the squared set.
5. **Finale (Grand Swing / Promenade Home).** The closing sequence — typically *Allemande Left, Grand Right and Left, Promenade Home* — that returns the dancers to the squared set. The final tip of the evening may close with a **Goodnight**.

### 5.3 Beat Structure

Consistent with section 4, a tip is built from the **16-beat phrase** unit:

- In the singing-call model, each figure is **16 beats**, and the four figures (one per leading couple) sum to the **64-beat segment** described in §4.
- The opener, breaks, and closer likewise each fit the 16-beat phrase structure, so an entire tip is assembled from 16-beat phrases.
- A tip is a **top-level sequence of calls that is a zero** — it must both start and finish in-sequence at the squared set, so it can be safely chained with the next tip.

---

## 6. Execution Rules & Collision Logic

- **The Passing Rule:** When two moving dancers' paths intersect head-on, they default to passing Right Shoulders, unless modified by a specific call parameter (e.g., Left Pass Thru).
- **Spatial Occupancy:** No two physical dancers may occupy the same $(x, y)$ coordinate space simultaneously during intermediate animation/transition frames. Ghost dancers bypass occupancy checks.
- **Resolution Logic:** Sequence parity must be tracked so that multi-call sequences can be deterministically resolved back to the home position using standard resolution lookup trees.

---

## 7. Formation Symmetry, Centering & Getouts

### 7.1 Formation Symmetry & Half-Set Authoring

A square-dance formation is **inherently symmetric**: it is built around a central point, and its geometry is usually invariant under rotation (in 90° steps) and, in many cases, reflection. Because of this symmetry, a formation is commonly **defined by only half (or a quarter) of the dancers**, with the remainder implied by rotating that half 180° about the set's center.

Consequences of this symmetric, center-anchored model:

- The **center of a formation** is the shared geometric center of the set, and dancers are positioned symmetrically around it.
- A half-set definition is *not* centered on its own — it sits offset from the center precisely so that its 180°-rotated duplicate completes the full, centered formation.
- The full formation (the unit dancers actually occupy) is centered and symmetric; the half-set offset is an authoring convenience and does not describe where the dancers stand.

#### 7.1.1 Declared Symmetry: three sizes that are easy to confuse

Because a shape is written as half of itself, **three different sizes** are in play at once, and
conflating any two of them is the source of most of the confusion around calls of fewer than eight
dancers:

| size | what it is | where it lives |
|---|---|---|
| **written** | the dancers a `<formation>` or a `<tam>`'s inline formation actually lists | the asset file |
| **declared set** | `written × symmetry` — the set the shape represents | the asset, via `asymmetric` |
| **board** | the dancers on the floor in the app, which is 8 in the POC | `Board` |

- **The multiplier is DECLARED, not inferred.** The default is **2** — the written dancers plus the
  same dancers turned 180° about the origin (the *completion reflection*, §7.3). A shape that is
  already complete says so with **`asymmetric="true"`** and has symmetry **1**: take it as written.
  Taminations implements exactly this as a declared multiplier (`geometry.dart`: `SQUARE = 2`,
  `ASYMMETRIC = 1`; `call_context.dart` instantiates the written dancers `geometryType` times), and
  `tamination.dtd` declares the attribute on `<tam>`. `formations.xml` cannot declare it, so every
  entry there is a half by construction.
- **A written shape is a UNIT, and a built bundle is `symmetry` copies of it.** This is what makes a
  two-dancer call expressible. A 2-dancer call is a **two-dancer written unit** whose two dancers each
  have their own motion; the completion makes **two copies** of it. A 4-dancer written unit is a
  half-set authoring of a whole-set call. A **one**-dancer written unit is a pair that **moves as
  one** — and because the completed copy carries the written dancer's gender, a lone `boy` completes
  to a pair of boys. So a two-dancer formation whose two dancers have different genders must be
  written with **both** dancers and `asymmetric="true"`, which is the only way to say it.
- **A two-dancer SHAPE is applied to every copy on the board** (§7.2.2, §7.5), which is the answer to
  "does the call also apply to the other group?". It never matches a whole eight-dancer board — a
  smaller setup is a subset match, and a whole-board apply refuses one by construction — so the only
  route is the parallel one: the board is tiled into two-dancer boxes and the pair runs in each.
  Measured: four facing pairs are four copies, and a board with no such pair (a squared set, where
  every dancer faces its corner six units away) is **refused** rather than force-fitted, which is what
  keeps the reading from being a fitted one.
- **What is measured.** `engine/test/shape-census.mjs` pins this over all 5963 shipped tams: the
  written sizes, `written × symmetry` against the size actually built, the one tam that disagrees
  (`Allemande Left` from `O Trade By`), the four one-dancer authorings that complete to same-gender
  pairs, and the shape of the formation registry (210 of 273 declared shapes are kept; every kept one
  declares eight).

The practical rule for a reader: **a number of dancers is never "the formation's size" on its own** —
ask which of the three it is.

### 7.2 Subset Formations

Most formations describe the **full 8-dancer set**, but some describe a **subset** — a smaller group of dancers (e.g. a Box of 4 or a Wave of 4 with 4, a Tidal formation with 6). These subset formations exist for two reasons:

**A subset of 2 is written differently from a formation of 2** (§7.1.1): the corpus's `Facing Couples` is *written* with two dancers and declares a **four**-dancer set (two facing couples), while the 2-dancer *pair* is `Facing Dancers`, written with **one** dancer and completed to a gender-blind pair. A two-dancer formation whose two dancers have different genders is written with both dancers and `asymmetric="true"`.

- **Parallel execution:** the same call can be danced by several identical subsets **at the same time** (see §7.5). A 2-dancer Facing Couples formation describes the call *Circle Right* once, and when the set holds four separate facing couples, all four dance it concurrently.
- **Named-group execution:** different calls are danced by **different named sets** of the dancers — e.g. Heads and Sides, Boys and Girls, Centers and Ends, or Couples 1–4. Each named group is itself a subset, so the subset formation is the unit the call acts on. (A named group like Heads/Sides selects dancers by **home identity**, fixed for the tip — see §7.2.3 — not by current position.)

Because a subset occupies only part of the set, its own geometry is **not centered on the set's center** the way a full formation is — it sits offset to wherever that group of dancers actually stands. That offset must be applied to match the subset to the real dancer positions.

#### 7.2.1 Edge Cases of Subset Formations

- **Uneven remainder:** an 8-dancer set does not always split into equal subsets. Calls that target a 6-dancer Tidal formation, or that name a group that leaves others out, must define where the *unused* dancers go (typically they stand still, or act as the complementary subset). A clean model must account for the dancers not covered by the subset.
- **Complementary (split) subsets:** many calls split the set into two complementary halves — e.g. "Centers … while Outsides …", or "Heads … while Sides …". Each half is a subset, but the two halves move *simultaneously and differently*, so a subset model that assumes all subsets do the same call does not fit; the call is really two parallel subset-actions with different choreography.
- **Overlapping / non-disjoint subsets:** a dancer can belong to more than one named subset at once (a dancer is simultaneously a Boy, a Head, a specific Couple, and a Center/End). A call selects one framing; the model must not assume the subsets partition the set into disjoint groups for every call.
- **Subset that must re-join the set:** a subset formation describes a transient grouping. After the call the dancers must resolve back into a recognizable full formation (or another consistent subset), so the endpoint of a subset call has to be defined in the context of the *whole* set, not just the subset.
- **Offset ambiguity:** because a subset is offset from the set's center, the same subset shape can appear at several distinct locations/orientations. The model must disambiguate which physical position a given subset definition matches — the offset, not just the shape, is what identifies it.
- **Single-group = whole set:** a "subset" can coincidentally cover the entire set (e.g. "All Eight"), in which case the offset is zero and the subset formation is indistinguishable from a full formation. The subset model should degrade gracefully to the full-formation case.
- **Half-set vs quarter-set authoring (§7.1) vs subsets:** a *half-set definition* is an authoring shortcut to build a full symmetric formation, which is different from a *subset formation* the dancers genuinely occupy as a group. A 4-dancer wave defined as a half-set and completed to an 8-dancer set is not the same as a 4-dancer wave used as a subset that only four dancers actually stand in.

#### 7.2.2 Multi-Match: One Call, Several Simultaneous Formations

A smaller formation can occur **several times in the same board at once**, and a
single call then acts on **all of those copies simultaneously**. This is the
"multi-formation from a single call" behaviour — distinct from the authoring
convenience of §7.1 and the *reason* it matters (parallel action, §7.5).

- **A formation may appear more than once.** A 2-dancer Facing Couples formation
  is present in *four* separate copies in a squared set (one per side); a Box of 4
  appears in *two* copies in a two-box setup. Each copy is a **disjoint** group of
  dancers (no dancer is part of two copies at once).
- **One call resolves against every copy.** When a call is authored for that
  smaller formation, it does not pick a single best copy — it finds **all**
  disjoint copies and applies to each concurrently. The set as a whole executes
  the call once per copy, and the copies do not interact.
- **Matching must find every copy.** When a call is named, the dancers recognise **all** of the disjoint copies present, not just the best one.
- **The copies must be disjoint and exhaustive.** No dancer is reused across
  copies, and every copy the board actually contains is covered. This is what lets
  a single call legitimately move several formations at once.
- **Distinct from subset authoring (§7.2).** A subset formation describes one
  group *once*; multi-match describes that the same group *repeats*. The former is
  about how the call is authored, the latter about how it is matched and executed
  when the board holds many copies.

#### 7.2.3 Home Identity: Heads/Sides Are Fixed for the Tip

A dancer's **"Head"** or **"Side"** designation is a *home-identity* property,
assigned once from the dancer's **home couple** at the start of the tip (or
figure), and **never changes** for the duration of that tip — regardless of
where calls move the dancer. It is **not** a property of the dancer's current
floor position.

- **Heads** are home couples **1 & 3**; **Sides** are home couples **2 & 4**
  (odd couple = head, even couple = side; the pattern repeats for larger sets).
  A dancer stamped as a head at the start remains a head even after the set
  rotates and that dancer comes to stand on a "side" wall.
- **A call that names a group acts on the home-designated dancers, not on
  whoever currently occupies the corresponding position.** For example, *Heads
  Pass Thru* acts on the *original* head couples even after a promenade or
  circle has moved them off the North/South walls; it must not silently switch
  to the couples that now happen to stand at N/S.
- **Why it matters for matching:** many formations — most notably the squared
  set — are 90°-rotationally symmetric, so a given geometric layout can be
  aligned to the dancers in several equivalent ways. The engine must break that
  ambiguity in favour of the alignment that maps each dancer back onto its
  **home couple**; otherwise a Heads/Sides call would target the wrong dancers
  whenever the set has rotated. Concretely, matching carries each dancer's home
  couple and, on a geometric tie, prefers the rotation where a call's head slots
  land on home couples 1 & 3 and its side slots on home couples 2 & 4.
- **Scope of persistence:** identity is stamped from the opening squared set and
  carried through every subsequent call, so the same couples remain "heads" for
  the entire figure — even as their positions permute — and only a fresh tip
  re-assigns designations from a new home square.

### 7.3 Two Kinds of "Reflection"
In square dancing, "reflection" can mean two distinct things:

- **Completion reflection:** the 180° rotation about the center that turns a half-set into the full formation. This always applies — every formation is conceptually complete and symmetric.
- **Orientation reflection:** whether a formation appears in its **left-hand** or **right-hand** (mirror-image) version on the floor. Some formations are handed (a Left-Hand Wave vs a Right-Hand Wave); others are their own mirror image and have no distinguishable reflection.

These are unrelated. A formation is *always* completed by its rotational mirror, but whether it needs a mirror-image *orientation* depends on the specific formation and how the dancers are arranged — many formations (e.g. a Squared Set) are unhanded, while handed ones (Waves, Lines, Quarter Tags) genuinely occur in mirror-image forms.

### 7.4 Getouts vs Modules

- **Module:** a general call sequence that moves the set from one formation to another. It is a reusable building block and may begin and end at any formation.
- **Getout:** a *special kind of module* whose purpose is to **return the dancers to home** (the squared set, in sequence). A getout always ends at home and, by definition, cannot start at home — if you are already home, there is nothing to get out of.
- **Getin:** a *special kind of module* whose purpose is to **take the dancers from home to a common formation** — the mirror-image companion of a getout. A getin always starts at home and ends at some non-home formation.

Every getout and every getin is a module, but not every module is a getout or a getin: the distinction is purely the constraint each places on home.

**What a getout's "home" is judged by — the caller convention (§9.1).** A get-out succeeds when it reaches a state from which the **standard finish** resolves — `Allemande Left`, `Right and Left Grand` or `Promenade` — not when the set sits literally on the home board. Both readings end at the same place once that finish is played; they differ only in how far the engine's own search has to carry the set. The engine's `getout()` search currently requires the literal home board, which is recorded as an open item.

**Getouts and getins are directional and not interchangeable.** A getout is a forward call sequence that *leads* the set home; a getin is a forward call sequence that *leads* the set out of home into a formation. They are **not** simply reverses of one another — you cannot obtain a getin by running a getout backwards (or vice versa), because calls do not run in reverse. A call's inverse is a geometric neighbour, not a callable forward sequence. This is what makes getins and getouts genuinely distinct families of modules rather than two views of the same data.

Both are normally authored for *common* target formations — the frequently used layouts a caller actually wants to enter or exit (e.g. Facing Couples, Parallel Waves, Lines) — rather than for every conceivable formation, so they read as a compact library of standard opening and closing sequences rather than an exhaustive mapping.


### 7.5 Calls Act on Everyone They Apply To (Parallel Action)

A call is performed **simultaneously by every group of dancers to whom the call applies**. A single-couple call such as *Circle Right* is not limited to one couple: when the set is split into separate Facing Couples, each couple dances the call **at the same time** — the action happens in parallel across all the couples (or boxes, or columns) present.

This parallel-action principle is central to square dancing: the caller names one call, and it is executed by all relevant groups concurrently, so the whole set moves together.


## 8. Data Invariants

### 8.1 Gender Balance

Every **full-set (8-dancer)** and **half-set (4-dancer)** definition — a formation in
`formations.xml`, or a call setup in a `<tam>` — must contain the **same number of boys
and girls**. A half-set is completed to the full set by rotating it 180° about the
centre (§7.1), so a balanced half is what makes a balanced whole; an imbalance in
either is a **data error** (a mistyped `gender` attribute), not a choreographic
choice.

**Subset and partial setups are exempt** (§7.2): they genuinely describe a smaller
group, so they are legitimately unbalanced — and a subset can be **all one gender**,
which is exactly what makes an "all boys" / "all girls" call callable. Measured
examples in the current catalogue: "Beaus Only" (2 boys), "Belles Only" (2 girls),
"Center 4 Dancers", "Step to a Wave from Facing Dancers" (1 dancer), "Columns of
3"/"Columns of 6" (authored as 3 dancers), "Compact Wave of 6" (a formation authored
as 3 dancers). All such cases have an odd dancer count (1, 3) or an explicitly
gender-scoped `from=` label.

Note the rule differs between a **definition** and a **board**:

- A **definition** of 4 dancers is a half-set that mirrors to 8 (§7.1), so it must be
  2 and 2. Failing to be balanced there is a data error.
- A **board** of fewer than 8 dancers is a *subset board* — the boys acting, the
  centers acting — and may legitimately be all one gender. Only a board holding the
  whole set (8 dancers) must be balanced.

This invariant is enforced as a **build error** by `engine/test/gender-audit.mjs`,
which runs first in `npm run verify`: it fails on an unbalanced 8- or 4-dancer
formation or setup, and reports the exempt subset cases for information. It also
checks boards — a board holding real genders must be balanced; a board whose genders
are all `phantom` is reported as "identity unknown" rather than failed (§8.2).

### 8.2 Identity Is Real Data, Never Derived From Position

Two rules, both enforced by `features/index_independence.feature`:

- **Indexes are meaningless.** The board index, the call index and the formation
  index carry no correspondence between them; matching derives the mapping from
  coordinates and rotation alone.
- **Identity comes from the data.** A dancer's home couple and gender are the
  formation's or setup's *declared* values or they are unknown (`UNKNOWN_COUPLE` /
  `phantom`) — never invented from an array position. Anything unknown must not act
  as identity: it is skipped by the matching tie-break, resolves no couple-based
  grouping, and imposes no couple-coherence constraint.

- **Gender is declared; the couple is not.** A formation declares a gender per slot
  and a `<tam>` declares one per dancer, so a **synthesised** board (one jumped to
  rather than danced to) carries the *declared* gender and gender-specific calls are
  gated correctly on it. The home couple is declared nowhere, so away from home it
  stays `UNKNOWN_COUPLE`, and the couple-based groupings stay unresolved. (Before
  this, a synthesised board invented a gender — first a hard-coded `boy`, which
  wrongly rejected e.g. `Circle Left` from a `Circle` board, then `phantom`, which
  gates nothing at all.)


## 9. Open Items

Remaining planned work, in the order agreed. **`PLAN.md` at the repo root is the consolidated version
of this section**: the measured state (§2, with the command for every row), what is refuted (§3), what
remains (§4, §6) and what is blocked (§5).

### 9.1 Get-out conformance (the active workstream)

The engine is measured against an **independent oracle**: Rich Reel's published
get-outs at all8.com, one page per FASR alignment (see
`engine/test/fixtures/README.md`). 29 alignments, 265 get-out lines, stored
verbatim. Taking that corpus as correct means every mismatch is an engine
deficiency, so the work is to make mismatches *expressible and diagnosable* rather
than to chase individual calls.

**DECIDED — what counts as a get-out: the caller convention.** A get-out succeeds
when it reaches a state from which the standard finish resolves (All8's lists
typically end at `--AL`, `--RLG` or `--Prom`), **not** when the set sits literally
on the home board. The engine's current `reachesTarget('Static Square')` demands the
literal home alignment (geometry *plus* the home FASR key) and is therefore stricter
than the thing being modelled.

Structural gaps this workstream has to close:

1. **Aligned identity.** `recognize` gives the formation and, since steps 2 and 3,
   `alignmentOf` reads and `boardsForAlignment` builds arrangement (6), sequence (4)
   and relationship (4) — but sequence and relationship need a board that carries
   identity, which the formation templates do not, and relationship is carried by
   identity *alone* (see step 3: the `c` and `r` boards are geometrically identical).
2. **The FSM state drops the alignment.** It keys on the normalised formation only,
   so up to 96 alignments per formation become one state. Step 3 demonstrated the
   consequence concretely: two boards in different relationships are indistinguishable
   to any geometry-only matcher.
3. **Alignment → board construction.** Done in step 3 for the 6 mapped formations.

**Step 1 is DONE — the formation templates reconcile.** `engine/test/all8-formation-map.mjs`
compares each All8 family's diagram (topology + facing, metric-free, under all 8
symmetries of the rectangle) against the engine's templates; the map is recorded in
`fixtures/all8-formation-map.json` and checked on every `npm run verify`:

| All8 family | engine formation | orientation |
|---|---|---|
| Box / 8-Chain `[B]` | `Eight Chain Thru` | rotated/mirrored |
| DPT `[P]` | `Double Pass Thru` | rotated/mirrored |
| Facing Lines `[L]` | `Normal Lines` (+ `Compact`) | identical |
| R-H Waves `[W]` | `Ocean Waves` (+ `Compact`) | identical |
| R-H 2-Face Lines `[F]` | `Two-Faced Lines` (+ `Compact`) | identical |
| L-H 2-Face Lines `[L.F]` | `Two-Faced Lines` — **mirrored only** | rotated/mirrored |

Consequences worth carrying forward:

- **The earlier `[B1p]` cross-check used the correct shape.** Box/8-Chain *is* the
  engine's `Eight Chain Thru`, so that failure was never a template problem — it lies
  in the calls and the target.
- **The engine's `Two-Faced Lines` template is right-handed**: the L-H family matches
  it only under reflection, and `Two-Faced Lines LH` does not appear separately
  because `getUniqueFormations` dedupes congruent shapes *including* reflection.
- **`Compact` variants are indistinguishable** in this comparison because the
  diagrams carry no distances; telling them apart needs the metric.
- **Dixie Grand (family "Special") is unmapped** — its page publishes no single
  diagram (it covers six alignments inline).

Remaining steps: **2** complete the FASR classifier (arrangement 6, sequence 4,
relationship 4); **3** generate a board per alignment by enumerating identity
assignments over the formation's spots (4!×4! = 576, classified and matched against
the requested All8 id) — tractable with no new data; **4** re-run the fixture as a
behavioural report giving, per get-out, the call it stopped at and why.

**Step 2 is DONE — the alignment classifier exists.** `engine/src/sequencer/alignment.ts`
names the other three FASR dimensions of a board, and `engine/test/alignment.mjs`
checks it on every `npm run verify`. Gap 1 below is now closed for arrangement, and
expressible (though not derivable) for sequence and relationship.

*Arrangement (6 states).* There is **no universal rule**, which is the trap. All8's
generic 6-pattern list (`BGGB`→0, …) is stated for a wave and is correct only there:
arrangement 0 of a wave *is* `BggB`, but arrangement 0 of Facing Lines is `gBgB`,
which the same list would call 1. So the module carries All8's **per-formation**
tables and matches the board against the table for the formation it is in.
Two things make this trustworthy:

- The tables are not trusted to transcription. `fixtures/all8-arrangements.json` is a
  machine parse of all 36 formations on `arrngdia.htm`; the hand-written tables in the
  module must equal it cell for cell (96 gender cells), or verify fails.
- The engine's own six templates independently agree: every one reads as arrangement 0.
  They are *not* stored in All8's drawing orientation (they are 90° clockwise from it),
  so this exercises the symmetry search rather than a lucky identity transform.

Readings are **rotation-only, never reflection**. Mirroring is not something dancers can
do, All8 publishes separate mirrored tables for left-hand formations (`[L.W]` beside
`[W]`, `[L.F]` beside `[F]`), and in `[B]`/`[P]`/`[L]` the left-right mirror of
arrangement 0 is *exactly* arrangement 5's gender pattern — so accepting a reflection
would silently relabel a 0 board as 5. A board that matches only under reflection is
refused, with the reflection-only reading reported as the diagnosis. The mirror maps are
themselves checked as data (all involutions): `[B]`/`[P]` `0↔5 1↔2 3↔4`, `[L]` `0↔5 1↔2`
with 3 and 4 fixed, and `[W]`/`[F]`/`[L.F]` refuse every mirrored board because their
facing layouts are not mirror-invariant — for those three the facings alone pin down the
handedness.

*Sequence (4 states).* All8's rule: walk the formation in promenade direction
(anti-clockwise) **starting at the #1 boy**; `1,2,3,4` is in sequence, `1,4,3,2` is out,
and **any other order is asymmetric**, not a fifth state — so the classifier reports
`null` with the offending cycle rather than rounding it to in/out. The same reading is
taken for the girls; the two states combine into codes 1–4. `HOME_RING_ORDER` is derived
from `HOME_DANCERS` rather than assumed, and the home squared set measures as sequence 1
with boys and girls both `1234`, which is what All8 says it is.

*Relationship (4 states).* The four letters are the four girls in cyclic order around the
boy, so the letter is an offset in the home ring: `+0 p` partner, `+1 r` right-hand girl
(the next couple round = on his right), `+2 o` opposite girl, `+3 c` corner (the previous
couple = on his left). This is checked against All8's own worked example — in a circle
formed from a squared set "each boy has his partner girl to his right", which the home
geometry reproduces — and the corner/right split is what follows from it: the #1 boy
stands south facing the centre, his partner (couple 1) is on his right, couple 2 further
right, and the girl on his left is couple 4, the couple he came from in the ring.

Two limits are deliberate, and the classifier says so rather than guessing:

- **Templates carry no identity.** The six engine templates have `couple 0` throughout, so
  sequence and relationship cannot be read from them at all; only identity-bearing boards
  (home, or anything replayed from it) can be classified. `alignmentOf` reports the reason.
- **The reference pair is a convention, not a derivation.** Callerlab agreed one for
  `[0L]` (the left-hand couple), `[0B]` (outside boy and the girl he faces), `[0F]` (the
  trailing couple) and `[0W]` (the in-facing end boy and adjacent girl) — those four, in
  standard arrangement, and All8 notes the choice is "somewhat arbitrary" and "makes a
  definite difference". So `alignmentOf` computes a relationship only when a reference
  pair is supplied; `REFERENCE_PAIR_RULES` records the four agreed rules.

*New data captured:* `fixtures/all8-16-states.json` — All8's own complete 16-state table
for `[B] [P] [L] [F] [W]`, each with a resolve hint (e.g. `[0B1c]` → "AL"). All five
tables contain exactly 16 distinct states = 4 sequences × 4 relationships at standard
arrangement, which is an independent confirmation of the 4×4 model this whole workstream
rests on.

Two findings, deliberately **not** fixed in this step:

1. **`analyzeFasr`'s `corner` is wrong** — it agrees with Callerlab's corner 0 times out
   of 4 on the home square, returning the *opposite* girl. It uses a fixed +45° angular
   offset, which in a squared set lands on the next ring position (the girl on his right)
   and, once the partner is excluded, falls through to the girl 2 away. The fix is small
   but the blast radius is not: `FasrRelations.corner` feeds `fasrKey`, which backs
   `isZero` and the solver's `Static Square` check, so it needs its own measured step
   rather than a drive-by edit.
2. **The corner/right naming is settled by the published diagrams, not by a call.**
   Step 2's write-up proposed a cross-check — that `[0B1c]` carries the resolve hint
   "AL" and the corpus gives `[B1p]` the get-out `Pass Thru > Allemande Left`, so a
   pass thru must take a `p` board to `c`. **That reasoning was wrong**, and step 3
   demonstrates why: a pass thru takes the box *out of the `[B]` formation*
   altogether (each facing pair swaps places and ends back to back — a Trade By), so
   there is no `[B]` state for it to land in. It also could not have worked in
   principle: the `c` and `r` states are **geometrically identical** — same spots,
   same facings, same genders — differing only in which couple number stands where,
   so no geometry-only legality check can separate them.
   The naming is instead confirmed the strong way: rebuilt from All8's own published
   diagrams, **14/14 of the alignments in the formations Callerlab actually defines a
   reference pair for reproduce their published arrangement, sequence *and*
   relationship letter** — including all six discriminating non-`p` cases
   (`B1c B2r B4c B3r L4r L3c`). Had the corner and right-hand letters been swapped,
   those six would read `r c r c c r` instead.

Remaining steps: **3** generate a board per alignment by enumerating identity assignments
over the formation's spots (4!×4! = 576, classified and matched against the requested All8
id) — tractable with no new data, and it is what turns step 2's classifier from a reader
into a constructor; **4** re-run the fixture as a behavioural report giving, per get-out,
the call it stopped at and why.

**Step 3 is DONE — a board can be built in a named alignment, and the model is now
validated against All8's own boards.** `engine/src/sequencer/alignment.ts` gained
construction, and `engine/test/alignment-boards.mjs` gates it on every `npm run verify`.

*The ground truth.* All8's get-out pages publish, per alignment, a diagram in which every
spot carries a **facing and a couple number** — so the diagram *is* a complete board,
written by the same author whose get-outs we measure against. `boardFromDiagram()` rebuilds
it (taking the spots and facings from the engine's template so the result has a metric the
engine can dance, and the identity layout from the diagram), and the central gate is:

> rebuild each published diagram, then classify it back with step 2's classifier and check
> it returns **that alignment's own four digits** — arrangement, sequence, relationship.

Result: **26 of 28 alignments reproduce exactly**, including **14/14** in the four
formations Callerlab actually defines a reference pair for, and all six discriminating
non-`p` cases (`B1c B2r B4c B3r L4r L3c`). This single check validates the arrangement
tables, the sequence rule, the relationship ring model, the corner/right-hand split, and
the reference-pair convention at once, against a source that can disagree.

*What construction adds.* `boardsForAlignment()` reads the alignment model backwards: the
formation fixes the spots and facings (from the engine's template, with its real metric),
the arrangement fixes the gender on each spot, and identity is the only free parameter —
4! ways to place the boys × 4! for the girls = 576, each classified and kept only if it
lands in the requested state. Every corpus alignment has boards (104 of them across the 26),
and every one classifies back to the alignment it was built for.

*The one thing that had to be learned rather than derived: which girl counts.* Relationship
needs a notion of "the girl adjacent to the reference boy", and **proximity is the wrong
tool** — measured, not assumed. In Facing Lines the two lines are 4 apart while the dancers
beside you in your own line are 2 apart, so nearest-opposite-gender picks a line-neighbour
instead of the couple; in the 8-Chain box a boy's facing partner and the dancer behind him
are both exactly 1 away, so it is not even well defined. What works is the formation's own
structure, readable straight off All8's tables: **the two spots of a column pair** — columns
`{2k, 2k+1}` of a row, or rows `{2k, 2k+1}` of a column, depending on how that formation is
drawn. `[B]` uses the column pair (its couples are the facing pairs); every other mapped
formation uses the row pair. That is All8's "couple" in all four of its wordings.

The reference pair itself was then **pinned against the corpus** rather than guessed. All8
gives the rules in words ("the outside boy", "the left-hand couple", "the trailing couple",
"the in-facing end"), but the words only resolve to a place once you know which end of the
drawing is meant, so each formation's spot was solved for: the one that reproduces the
*published* letter for **every** alignment. Two formations have alignments that can
discriminate (the rest are all `p`, where any pair agrees), and in both the answer is
unique:

| formation | reference pair (table frame) | reproduces |
|---|---|---|
| `[B]` Box / 8-Chain | (row 2, col 0) + (row 3, col 0) | all 6: `B1c B2r B4c B3r B1p B2p` |
| `[L]` Facing Lines | (row 0, col 2) + (row 0, col 3) | all 6: `L1p L2p L4r L3c 5L1p 5L2p` |

Both spots are recorded, not just the one a boy stood on, because a call can move a dancer
*within* his own pair — after a pass thru the reference couple's boy and girl have swapped
spots.

*`[P]` is a real, understood gap — **CORRECTED AND CLOSED, see "The `[P]` reference pair" below**.*
Beginning Double Pass Thru matches **no** fixed adjacent
place: its own diagrams show `P1c` pairing the outer couples side by side and the inner ones
as facing couples, because DPT genuinely mixes the two. That is precisely why All8 agrees a
reference pair for `[0L] [0B] [0F] [0W]` and not for `[P]` — so `P1c` and `P2r` could not be
classified and were reported as a gap, not silently rounded. (`P3p`/`P4p` were unanimous and
fine.) The same applies to `[W]` and `[F]`, where no published alignment discriminates, so
nothing is recorded and only unanimous states are reported. What this paragraph got wrong was
the conclusion: All8 does not leave `[P]` undefined, it leaves it to a **reduction** — mentally
have the Centers Pass Thru and read the relationship in the resulting `[0B]` — and the engine
now applies it.

*Two structural facts this step measured, both load-bearing for step 4:*

- **Relationship is invisible to geometry.** `[0B1c]` and `[0B2r]` boards have *identical*
  spots, facings and genders; only the couple numbers move. So the relationship letter can
  never be recovered from a geometric recogniser, and a formation-keyed FSM state cannot
  represent it — this is structural gap 2 below, now demonstrated rather than asserted.
- **The relationship letters are only defined for arrangements whose adjacent pairs are one
  boy and one girl.** Enumerating the space shows which: e.g. `[B]` yields all 16 states at
  arrangements 0 and 1 but none at 3 and 4, where the adjacent spot holds a boy. That is
  consistent with All8's own scope note that the convention is agreed "in 4 formations with
  standard gender arrangement only".

*Correction carried forward:* step 2's proposed pass-thru cross-check for the corner/right
naming does not work and has been replaced by the diagram check above — see finding 2 under
step 2.

*New for step 4:* `ADJACENT_PAIR`, `REFERENCE_PAIR_SPOTS`, `readLayout`, `boardFromDiagram`,
`boardsForAlignment`, `boardForAlignment`, `parseAlignmentId`, `adjacentPairs`,
`relationshipStateOf`. `parseAlignmentId` reads `B1c` / `5L2p` / `L.F1p` into a spec, which
is what turns a corpus id into a board.

Remaining step: **4** re-run the corpus as a behavioural report naming, per get-out, the call
it stopped at and why — now possible for 26 of the 28 alignments.

**Step 4 is DONE — the corpus is now run, not just read.** `engine/test/getout-behaviour.mjs`
takes the board All8's own diagram describes for each alignment, decodes the published line
with the shared abbreviation table, applies the calls in order, and stops at the first that
does not apply — recording **which call** and **why**, with the reason attributed to whoever
owns it. It is a diagnostic, not a gate: the only structural failures are a start board that
cannot be built or a contradiction inside our own model.

*Headline, over the 412 published lines that have a start board (get-out and Plus alike):*

| outcome | lines | |
|---|---|---|
| reached the finish and applied it | 41 (10%) | **success** by the caller convention |
| reached a state a finish resolves from | 2 | **success** |
| completed the body but did not resolve | 1 | body ran; end state is not a finish state |
| stopped only at the finish | 31 (8%) | body ran; the resolve call itself would not apply |
| stopped part-way through the body | 82 (20%) | the real engine coverage gap |
| stopped at a token we cannot decode | 202 (49%) | **our** gap in reading All8 |
| page text, not a get-out line at all | 53 (13%) | not a conformance datum |

*The blockers, in the order they are worth fixing — and the biggest one is ours:*

1. **Our decoder, 202 lines / 97 distinct tokens.** This is not an engine deficiency at all,
   and it masks everything behind it: until a line can be read, we cannot tell whether the
   engine can dance it. Top targets: `Plus`(22), `&Roll`(21), `SHing`(10), `DivTh`(9),
   `LT1/4`(7), `LA`(6), `PtTrd`(6), `SpChT`(5), `AcDcy`(5). Improving this table is the
   single highest-leverage change available, and it must come first.
2. **Subset selection, 28 lines.** `"Circulate" not legal for selected dancers`,
   `"U-Turn Back" ...`, `"Pass Thru" ...` — these are All8's group-scoped calls
   (`B-Cir`, `G-UTurn`). The call is implemented and the name decodes; the engine cannot
   resolve *who* acts from that board. A distinct failure mode from the two below, with its
   own owner.
3. **The finish calls, 31 lines.** The get-out body runs all the way to the state it was
   written to reach and then the resolve itself will not apply: `Promenade` (16),
   `Right and Left Grand` (14), `Allemande Left` (2). The cheapest wins in the corpus, and
   they land exactly on the caller-convention decision — the engine's own finishes are
   stricter than "a state the standard finish resolves from". One concrete cause: the engine
   implements only *qualified* promenades (`Heads Promenade 1/2`, `Star Promenade`, ...).
   **Bare `Promenade` is listed in the engine's own index and has no implementation**, and it
   is the most-used finisher in the corpus (26 lines).
4. **Mid-body call coverage, 82 lines / 27 distinct calls** (`Box the Gnat` 7, `Boys Trade` 3,
   `Scoot Back` 3, `Rollaway` 3, `Boys Fold` 3, `Ends Fold` 3, then a long tail). These need
   the call to match from more formations, not merely to exist. 44 of the 82 fail at the
   *first* call, from a start board that is All8's own and is recognised by the engine as the
   right formation — so these are genuine matching gaps, not setup artefacts.

*Three harness bugs this step had to fix first, all of which had been inflating the engine's
apparent failure rate:*

- **Calls were being registered by file basename**, so `Pass Thru` (file `pass_thru.xml`) was
  unregistered and every get-out appeared to fail at its first call. Registering by title
  fixes it; the shared loader now does this for every test that runs calls.
- **`poc/src/assets/src/calls.xml` was never read.** It is not a set of implementations but an
  *index* — `<call link="c3a/1_4_mix" title="1/4 Mix"/>` entries pointing at call files — so a
  name in it without a `<tam>` anywhere is a call the engine knows and cannot do. That is how
  the `Promenade` gap surfaced, and it is worth keeping the two notions apart.
- **All8's names differ from the engine's for three calls** (`Touch 1/4` → `Touch a Quarter`,
  `Cast Off 3/4` → `Cast Off Three Quarters`, `Do Sa Do` → `Dosado`), which were being counted
  as catalogue gaps. The bridge now lives in `test/lib/engine-calls.mjs`; the engine's own
  `CALL_SYNONYMS` map exists for exactly this and is empty (open item below).

With those fixed, the catalogue question is nearly closed: of 48 distinct whole-set call
names the corpus uses, **44 are implemented** and only 4 are absent — `Promenade` (indexed,
unimplemented), `Promenade Home`, `1/2 Circulate`, `Join Hands`.

*What step 4 changes about the plan.* Steps 1-4 were "make the corpus expressible". It now is,
and the answer to "where is the engine incomplete" is measurable rather than anecdotal — but
the measurement says the frontier is not where the earlier steps assumed. The engine's own
remaining gap (82 mid-body + 31 finish + 28 selection = 141 lines) is smaller than the gap in
our ability to READ the corpus (202 lines), so **decoder coverage is the next step**, followed
by subset-selection resolution, which is both the second-largest blocker and the one most
likely to be a single underlying defect.

**Step 4a is DONE — subset selection, and it was two different bugs wearing one message.**
All 28 selection failures read `"X" not legal for selected dancers`, which hid two unrelated
causes:

1. **Coded moves were never selection-aware.** `U-Turn Back` is a coded move — a per-dancer
   pivot applied straight from geometry, not a catalog setup — and `Girls U-Turn Back` was
   being routed to the applicator's selection path, which matches catalog setups against the
   isolated subset. A pivot is trivially well defined for any subset, so this failed for no
   reason. Fixed in `Sequencer.tryCodedMove`, which owns the coded table and now handles a
   selection prefix itself.
2. **Group-scoped catalog calls were only ever tried as an ISOLATED subset** — gather the
   selected dancers, centre them, and match the call against them as a formation of their own.
   But "Girls Circulate" in a wave means the girls walk the **wave's** circulate path, and the
   girls of an ocean wave are a 2×2 block that is not any Circulate variant at all. Fixed by
   adding a fallback in `CallApplicator.applySelected`: when the isolated reading fails, apply
   the call as the **whole formation** performs it and keep only the selected dancers' new
   poses. The fallback is strictly additive (the isolated reading is still tried first, so
   nothing that worked changes) and the parallel path is allowed inside it, because for
   several of these calls — `U-Turn Back` from an Eight Chain box — parallel is the only
   reading that matches.

Measured on the corpus: selection failures 28 → 22, mid-body stops 82 → 76, and finish-only
stops 31 → 37 — i.e. six published get-outs now reach the state their finish needs instead of
stopping in the body. `behaviour-audit` is unchanged at 137 / 0 / 0, and `engine/test/selection.mjs`
gates the new behaviour: a selection on a coded move pivots exactly the selected dancers in
place, leaves everyone else untouched, and preserves the board array order.

*Three findings this fix produced, none of them selection bugs:*

- **`Circulate` had no variant matching the engine's own wave templates** — see step 4b below,
  now fixed.
- **`Cross Fold` and `Promenade` are listed in the engine's own index with no implementation**
  (`Cross Fold` is used twice by the corpus). Same class as the bare-Promenade gap above.
- **The isolated reading can be unsound.** Centring a subset and matching it with the usual
  rotation tolerance means an arbitrary pair of dancers can satisfy a two-dancer setup: with
  `Centers Pass Thru` from Facing Lines the engine resolves just **two** dancers (one of them
  an end, at the opposite corner of the set) and then passes them through. The 4-centre
  grouping is not being applied, and the centring hides it. Recorded as an open item; the new
  fallback does not touch this path.

**Step 4b is DONE — the missing wave `Circulate`.** The single-wave `Circulate` variant was
authored with the two waves **2 apart** (`x = -1,1`) while the engine's `Ocean Waves`,
`Normal Lines` and `Two-Faced Lines` templates put them **4 apart** (`x = -2,2`), so `Circulate`
was illegal from all three — while `Split Circulate` and `All 8 Circulate`, whose variants do
match, were legal. Two new tams in `ms/circulate.xml` (`from="Right-Hand Waves"` /
`"Left-Hand Waves"`, `formation="Ocean Waves RH|LH BGGB"`) fix it at the template's spacing.

They reuse the **same four paths as `Split Circulate` from the same formation**, which is not a
shortcut but the correct reading: from two parallel waves "Circulate" means each wave
circulates within itself, and splitting a two-wave set in half gives exactly those two waves,
so the two calls coincide. They differ only where there are more than two circulating groups,
which is why the column/8-chain tams remain separate. This is verified rather than asserted:
`engine/test/selection.mjs` requires the two calls to produce **identical** boards from
`Ocean Waves`, and to leave the same spots occupied.

Measured on the corpus: `Circulate` selection failures 9 → **1**, total selection failures 22
→ 13, mid-body stops 76 → **72**, finish-only 37 → **40**, and one more published get-out now
runs to a full success (42 + 2 by the caller convention). `behaviour-audit` is unchanged at
137 / 0 / 0 and the precomputed FSM table is unaffected.

*Two things this did NOT fix, both recorded:*

- **`Circulate` from facing lines is still illegal.** The shipped line variants are
  `Lines Facing In` / `Lines Facing Out` — not facing lines — so the `Normal Lines` template
  has no `Circulate` any more than the wave templates did.
- **The wave circulate paths may themselves be wrong.** The motion the new tams inherit from
  `Split Circulate` moves half the dancers (4 units) between the two parallel waves, when a
  *split* call should keep each half in place. That is the shipped asset's behaviour, not
  something the new tams introduce, and if it needs correcting both calls need it together.

**Step 4c is DONE — and then UNDONE ON PURPOSE. `Promenade`, the standard finish, WAS a call the engine
knows and performs; it is not any more.** The record below is what the geometry-derived rule did, and it
is kept as history because it is the specification the hand-authored tams have to reproduce. What is no
longer true is the present tense: `Promenade`, `Promenade Home` and `Promenade 1/2` were **removed from
the coded-move registry** so the family can be authored from tams instead, `promenade.ts` and the
ring-move interpolation went with them, and the bare names are now **declared catalogue gaps** — no
shipped tam authors them, so `--Prom` and `--PromH` lines stop at their own finish again. `promenade.mjs`,
the gate for the derived rule, was deleted with its subject; the get-out expectations it and
`getout-convention.mjs`/`sequencer.mjs` pinned are deliberately LEFT RED to be re-measured against the
hand-authored tams. See the commit that removed the family for the measured cost.

`assets/src/calls.xml` has always indexed it; `ms/promenade.xml`
implements only the *qualified* forms (`Heads Promenade 1/2`, `Sides Promenade Full`,
`Star Promenade`, …). So every published get-out that ends `--Prom` ran its whole body and
then stopped at its own finish with "Unknown call" — the single largest group of
cheap failures left after step 4b.

It cannot be a catalog `<tam>`: it is not a fixed path. How far each dancer travels depends
on where the set happened to start, and it is legal from facing lines, waves, two-faced
lines and rotated squared sets alike. It is now a **geometry-derived call**
(`engine/src/sequencer/promenade.ts`), registered in the coded-move table with a
**precondition** so that the Sequencer and the sequence analyser share one definition of it —
the same mechanism the body-relative pivots use, extended with the ability to refuse and say
why.

The rule is Taminations' own (`lib/sequencer/calls/common/promenade_home.dart`), which is the
reference implementation for this engine:

1. take each couple's centre **by identity** (home couple number — not by who is standing
   next to whom);
2. snap that centre to the nearest of the four axis points by quadrant — this is what "the
   set is spread around the ring" means;
3. require one couple per side of the square, and require couples **1 → 2 → 3 → 4
   counter-clockwise** — the direction a promenade travels. That is the "in sequence" test:
   if the couples are permuted round the ring, no single wheeling of the set brings everybody
   home and the caller must fix the sequence first;
4. the result is the **literal home squared set** — every dancer back on its own spot and
   facing, verified by identity rather than by "the formation looks right".

Facings are deliberately **not** part of the test: forming up into promenade position is part
of the call, which is why All8 promenades out of a two-faced line (`[L.F1p]`'s only get-out is
`--PromH`, with no body at all) and out of facing lines.

*One place this is stricter than Taminations, deliberately:* the partners must be standing as
a couple (separation 2, band ±1). Taminations takes a couple's centre wherever the two dancers
are, so a board with the partners flung apart still "promenades home" on paper — which here
would launder a broken body into a false success. Measured: every healthy pre-`Prom` state in
the corpus has its partners **exactly 2.00** apart, while the states our own broken bodies
produce measure **0.00, 4.00 and 6.00** (0.00 being two dancers on the same spot).

Measured on the corpus (412 published lines, caller convention):

| | before step 4c | after |
|---|---|---|
| reached the finish and applied it | 42 | **53** |
| reached a state a finish resolves from | 2 | **4** |
| stopped only at the finish | 40 | **29** |
| stopped part-way through the body | 72 | **71** |
| catalogue gaps (calls All8 names, engine cannot perform) | 4 names | **`Join Hands` only** |

Of the 30 published lines that end in a promenade finish, 21 have a body the engine can play;
**12 of those now promenade home**. The 9 that do not are the finding, and they split in two:

- **6 are bodies that reach a state no promenade can finish from, because the body itself is
  wrong.** `--SwThr B-Run B-Trd --Prom` leaves the partners 4 apart; `--PsOcn B-Run B-Trd
  --Prom` and `B-UTurn B-Trd --Prom` leave them 6 apart. The cause is visible in the stop
  table: the corpus's own `B-Trd`/`G-Trd`/`B-Run` steps move dancers 4 units the wrong way.
- **3 are the `[B]` box, and they disagree with All8.** In our reading of All8's *own*
  diagrams, the `[B]` box puts the couples in the **mirrored** ring order (3,2,1,4
  counter-clockwise where home is 1,2,3,4), so no rotation of that board reaches the home
  square; `[B4c]` after `G-UTurn` has all four couples collinear, so there is no ring at all.
  All8's pages nevertheless list `--Prom` for `[B2r]`, `[B2p]` and that `[B4c]` line. Either
  our reading of the box is wrong in a way the FASR classification cannot see, or All8's
  `--Prom` there means something a promenade cannot do while preserving identity. Recorded as
  an open item rather than papered over with a looser rule.

**A new, specific bug found while measuring this (the next target).** `Boys Trade` /
`Girls Trade` / `Run` **select the wrong variant** from waves and two-faced lines. The asset
declares seven `Boys Trade` variants qualified by formation (`Right-Hand Wave, Boys Center`,
`…Boys End`, `Right-Hand Two-Faced Line`, …), so this is variant selection, not a missing
call. From `L1p` after `Boys U-Turn Back` the boys move 4 units **away** from the dancer they
should swap with and flip 180° (`2b (2,1) → (2,5)`, `1b (2,-3) → (2,-7)`, where the swap is
`(2,-3)` / `(2,1)`); from the `Ocean Waves` template `Boys Trade` moves the **girls**. It is
now the engine's top corpus gap (`4x Boys Trade`) and it is directly upstream of 6 of the 9
promenade refusals above, which is why it is worth doing before touching the remaining
finish calls.

*Two limitations recorded rather than fixed:* the precomputed FSM table and
`Sequencer.legalCalls` enumerate the *catalog*, so `Promenade` appears in `legalNext()` (when
it applies) but not in the FSM table — the table builder works from the applicator and would
need a rule for geometry-derived edges. And `Promenade`'s 8 beats are a fixed simplification:
a set already at home promenades no distance at all, one 270° round promenades three quarters
of the way.

**Step 5 is DONE — the engine's own getout search adopts the caller convention.** DECIDED:
`getout()` succeeds by reaching a state from which a standard finish CLOSES the square —
`Allemande Left`, `Right and Left Grand`, `Promenade` (All8's `--AL` / `--RLG` / `--Prom`) —
rather than by sitting on the literal home board. Until this step the search demanded
`fasrKey === homeFasrKey`, which is *stricter* than the corpus it is measured against: a real
get-out is written as a body plus a finish, and the search could neither end on a finish nor
use one as an edge.

It is implemented as a **finish as the final edge**, not as a looser goal:

- when a board is one finish away from home, the search **appends that finish to the path it
  returns**, so a returned path still ends on the literal home board. Every existing consumer
  keeps the contract it already had — the FSM amendment gate, the UI's "apply getout", the
  older tests that assert `isAt('Static Square')` — and `maxCalls` now bounds the length of the
  path **returned**, finish included;
- the standard finishes therefore become edges the search can use, including the
  geometry-derived `Promenade`, which until now was not a search candidate at all because the
  search enumerated the catalog only. `LegalityChecker.searchLegalCalls` now adds every coded
  move that carries a **precondition** (the resolves). The pure pivots are deliberately left
  out: a pivot is legal from any board and moves nobody, so its result has the same
  position signature as the board it came from — the search's seen-set prunes it immediately
  and it can never reach home. `boardSig` is positions-only, which is what makes that true;
- a non-home target has no finish: it is reached literally or not at all;
- `fixIt` tests the same goal, so "keeps a getout alive" now means "keeps the set one finish
  from home".

Measured (`engine/test/getout-convention.mjs`, budget 200, maxCalls 3): **27 of the 28
alignments that have a start board now have a getout, and 27 of 27 replay through the
Sequencer and land on the home board with every dancer on its own spot.** Every one of them
closes with `Promenade` — 11 of the 28 start boards are promenadeable directly (`[Promenade]`
in one call, e.g. the `[L.F1p]` board whose only published get-out is `--PromH`), and the rest
reach promenade position through a one- or two-call body the search now finds (`Circle to a
Line > Promenade`, `Circle Four Left 1/2 > Promenade`, `Flip Cross Reaction > Promenade`, …).
`[P4p]` has no getout within three calls — an honest negative, and the only one.

*Three things this step found, and did not fix:*

- **The search is quadratic in the catalog, so a FAILED search costs minutes.** Each node
  enumerates every registered call (~2200 titles) and, with equivalents on, widens each
  candidate by scanning the catalog again. A successful getout is therefore ~3 s, but a
  getout that does not exist took **54–102 s** on the corpus, and `fixIt` deeper than depth 0
  never finished (the features audit killed a `transitionTable` build for the same reason).
  This is pre-existing, not introduced here, but the convention makes it visible: the UI's
  "Getout" button now succeeds quickly and fails slowly. Next in line after the `Trade` fix.
- **The promenade rule admits the `[B1c]` zero box.** Our reading of All8's own diagram puts
  that box's couples in counter-clockwise ring order, so `Promenade` closes it — while `[B2r]`,
  `[B2p]` and `[B4c]` sit in the mirrored order and are refused (the open disagreement above).
  All8 publishes `AL`-based get-outs for `[B1c]` and lists no `--Prom`, which is consistent with
  but does not confirm a promenade from there. Pinned by the gate so it cannot drift unnoticed.
- **`fixIt` at depth 0 already offers 578 calls from home** (every call whose result is one
  finish from home). Informational, but it says the "keeps a getout alive" list is not a
  shortlist until the emptiness of an intermediate state is a real filter.

**Step 4d is next**: `Trade`/`Run` variant selection (see below) — the corpus's top engine gap
and upstream of 6 of the 9 promenade finishes that still refuse.

**The `[P]` reference pair is SETTLED — and it was the gate on the Orientation check, which now RUNS.**
Recorded here because it is the one part of the FASR model that All8 leaves to a procedure rather than
to an agreed pair, and reading the authority rather than reasoning is what settled it.

Callerlab agrees a reference pair for `[L] [B] [F] [W]` only; for Beginning Double Pass Thru it agrees
none, "since `[0P]` … does not have a single boy and a single girl in each quadrant". All8 supplies the
missing half in the same paragraph (`16com_p.htm`, "Special note about Double Pass Thru Formation"):
*"for purposes of evaluating relationship, we mentally have the Centers Pass Thru then evaluate
relationship in the resulting `[0B]` Eight Chain Thru Formation."* The engine records that as All8's
own **extension**, not a fifth convention (`REFERENCE_PAIR_RULES.P`, `relationshipStateOf`,
`centresPassThru`, `REFERENCE_PAIR_SPOTS.P`).

Measured on the four `[P]` alignments the get-out corpus publishes a diagram for
(`p-reference-pair-probe.mjs`, `p-reference-position-probe.mjs`):

- the reduction **is** the catalogue's own `Centers Pass Thru`, dancer for dancer (position and
  heading), and the result is named `Eight Chain Thru` every time — it is a pure permutation of the
  board's four INNER dancers, which is why the module can do it without the applicator;
- All8's **own conversion lines** are reproduced **4/4** — `C-PasTh [B1c]` (P1c), `[B2r]` (P2r),
  `[B3r]` (P3p), `[B4c]` (P4p) — which is the independent check, since those lines are what All8
  prints beside each diagram;
- the reference **POSITION** is one fixed cell, `(row 3, col 0)`, on all four, and the pair is
  `[[3,0],[3,1]]` — pinned the same way `[B]` and `[L]` were, through the reduction rather than
  directly;
- the published **LETTERS** are not a fixed pair's, and that split is measured rather than assumed:
  scoring every boy spot × girl spot over the four alignments finds **0** pairs that work, while the
  reduction does. So the rule reads the board's own pairs when they AGREE (P3p/P4p, "All Paired", every
  boy beside his partner) and reduces only when they disagree (P1c/P2r, "Outsides Paired").
  **Applying the reduction unconditionally would contradict the published `p` for P3p and P4p**, which
  is the measurement that fixes this shape.

*What it changes:* `boardForFasrCode` derives All8's own board for **28 of 28** published alignments
instead of 26 — both refusals gone, and `all8-format.mjs` now pins "no refusal" rather than the pair —
and `CANONICAL_INDEX.P` gains two measured entries (`1:{c:0}`, `2:{r:0}`; all four `[P]` codes measure
at index 0). Census, get-out and FSM are all unmoved: no figure uses a `[P]` code. Gated in
`alignment.mjs` (letters, reference cell, the reduction being involutive) and `alignment-boards.mjs`
(the reduction equals the catalogue call; All8's four conversion lines).

*And the probe the pair was blocking now runs, which DISPROVED the Orientation construction - and the
construction is now FIXED.* All8's own worked pair — the same board with the couples shifted, differing
only in Occupation — used to read `[0P1cR+]` and `[0P1cR']`: **Occupation exactly right for both**
(`+` and `'`), which validated the reference pair, and **Orientation R where All8 says H**. The fault
was a FRAME, not a missing definition: the old construction compared the reference boy's current
bearing with his home bearing and read the board in the engine's TEMPLATE frame, which for a 4x2
formation is All8's own drawing rotated a quarter turn — and for a line the two positions are not a
rotation of each other at all (raw **-37.9 deg**), so the quantisation was arbitrary. It now reads his
position in the formation's **own arrangement table** (All8's drawing frame, `readLayout`) and takes
the clockwise 90-degree step from his home side to that side, which is All8's own rule: its four
published `[B]` orientation diagrams put the reference boy south-west / north-east / north-west /
south-east and label them H / O / L / R. Both worked labels now come out exactly as All8 prints them
(`[0P1cH+]`, `[0P1cH']`), and every `[B]`, `[L]` and `[P]` code resolves its four boards to four
distinct FASROO codes where before the letters were half a step out. Two residues are recorded: a
synthesised board (no home couple) is REFUSED an orientation rather than given one read off arbitrary
ids, and `[L.F]` (the left-handed two-faced line) is refused a reference pair outright, because
Callerlab agrees one for the four standard-arrangement formations only. `[W]` and `[F]` — which had
the same collapse problem — are now pinned from All8's own "Reference Pair shown in RED" diagram
(`fasr-reference-pair-probe.mjs`, checked against the two pairs the corpus already pinned), so all
five formations with an agreed pair resolve their boards to distinct FASROO codes (80 of 80).

*The second source for the other twelve states cannot be read either, and that is recorded.* All8's
"16 Possible Pairings" page draws all sixteen with couple-numbered tiles, and the tiles now decode
exactly (`d1/<n><dir>.gif`, `couple = floor(n/2) + 1`, even = boy, odd = girl, `dir` = facing —
confirmed by the user, and consistent with the page's own "At Home" drawing where `0n` is the `#1` boy
All8 marks red). But the page's four overlapping states are **not** all the get-out pages' boards:
`P1c` and `P2r` match up to a uniform couple relabelling, `P3p` and `P4p` do not, and **no bijection of
the eight tile slots onto the eight spots reconciles all four** (`p-tile-order-probe.mjs` searches all
40,320 and finds zero) — read in document order those two cells are not valid boards at all. So the
`[P]` rule rests on the four published get-out diagrams and their four conversion lines, and that is
the honest sample size; the twelve unread states are neither confirmed nor refuted.

### 9.2 Other open items
1. **The decoder table is now the top blocker (§9.1 step 4).** 202 of 412 published lines stop
   at a token our abbreviation table cannot read, and that masks the engine's real coverage.
   Extending the table is mechanical but should stay conservative: a wrong expansion silently
   turns an engine gap into a phantom call name.

   **Two measurement corrections.** (a) Those 202/412/97 numbers are `getout-behaviour.mjs`'s, over
   `getoutLines` and `plusLines` for the alignments that have a start board;
   `getout-conformance.mjs` measures a different denominator (**265** get-out lines, 134 decoded,
   130 stopped). (b) The ranking in §9.1 is an ALL-OCCURRENCE count over every line and includes
   prose tokens, while both harnesses count FIRST-FAILURE only and filter prose out
   (`getout-behaviour.mjs:102-109`) — so the two lists are not comparable as a work queue
   (`&Roll` 21 vs 21, `LA` 14 vs 6), and a token appearing only after an earlier unknown is
   invisible in the harness count. `PLAN.md` Phase 2 settles it by reporting both. It also records
   the related gap: a wrong expansion is currently undetectable, because
   `getout-conformance.mjs:166` is a literal `check(true, …)`, and a phantom name is mis-attributed
   to the ENGINE in `CATALOGUE GAPS`.

   **DONE — Phase 2, with both corrections applied.** The tokenizer had FOUR bugs, measured rather
   than assumed: a **trailing joiner dash** was never stripped (24 occurrences across 18 distinct
   tokens, several of them tokens the table already knew — `C-SqT@3-`, `C-StepW-`, `C-SwThr-`,
   `C-T1/4-`, `C-VeerL-`, `C-PsOcn-`, `E-Trd-`, `DoSaD-`, `Clovr-`), `{...}` **braced asides** were
   not removed (`{beau couple: H/S}-WhlAr`), `[...]` **alignment markers** were not removed
   (`[B1c]`), and a gap that had collapsed to a single space before a `--` call marker was not
   split, so `AL --PasTh` arrived as one token — the same glue that produced the bare `C-`.

   `decodeStats` now reports BOTH rankings (first-failure and all-occurrence), and both harnesses
   print all of them instead of the top 14/18.

   The `check(true, …)` is now a real gate, and in a stronger form than "must be implemented": the
   corpus legitimately names calls the engine lacks, so the rule is **implemented OR declared in
   `KNOWN_CATALOGUE_GAPS`**, which makes each gap a deliberate reviewable statement AND fails loudly
   on a mis-expansion. It also fails if a declared gap has since been implemented, so the count
   cannot go stale. All **77** table names are admissible; the 5 declared gaps are `Join Hands`,
   `1/2 Circulate`, `Left Hinge`, `Fold`, `Cross Fold`.

   Every addition was checked against `implementedTitles()` first, which caught four traps
   intuition would have missed: `Sweep` → "Sweep a Quarter" is **indexed with no `<tam>` anywhere**;
   `SHing` (11) → "Single Hinge" is **not implemented** (`Split Hinge` neither), so decoding it
   would have booked a real engine gap as a phantom; `&Roll` (30) → `Roll` is **not a call in this
   engine at all** and needs a MODIFIER, not a table entry (as does `Expl&` = "Explode and <call>");
   and `H-Trd` → "Heads Trade" is not a title but DOES resolve, because the engine reads a group
   prefix compositionally and reaches the derived `Trade` — which is why `H` = Heads was added to
   `GROUP`, a reading the fixture states itself in `{beau couple: H/S}`. `LA` is left undecoded on
   purpose: the membership rule is necessary but not sufficient, and ambiguity wins.

   MEASURED: get-out lines decoded **134 → 160** of 265, lines stopped at an unread token
   **130 → 104**, whole-set names registered **46/48 → 54/56**, corpus success **59 → 66**,
   undecodable stops **202 → 170**, page text **53 → 46**. Mid-body stops rose **68 → 94**, which
   is the POINT of the phase rather than a regression: 32 lines moved out of "our gap" into genuine
   engine findings, and until a line can be read there is no way to tell whether the engine can
   dance it.
2. **Move the All8 → engine call-name bridge into the engine.** `CALL_SYNONYMS` is empty, so
   `Touch 1/4`, `Cast Off 3/4` and `Do Sa Do` resolve only because the test harness maps them.
   Anyone consuming published choreography needs that bridge in the engine, where
   `canonicalName()` already applies it.
3. **Bare `Promenade` was DONE (step 4c) and has been RE-OPENED DELIBERATELY.** The derived rule was
   removed so the family is hand-authored from tams (see the correction at step 4c), so this is open
   again as an **authoring** task rather than an engine one: `Promenade` and `Promenade Home` are
   declared catalogue gaps until a tam authors them, and the get-out gates that depended on the finish
   edge stay red until then. What remains from the old item, still true: the `[B]` box promenade
   disagreement with All8 (3 lines) and the fact that a geometry-derived call was never in the
   precomputed FSM table (item 12).
   **`Cross Fold`** is still indexed with no implementation; `1/2 Circulate` and `Join Hands`
   are absent entirely.
4. **Global corner fix (from step 2).** `analyzeFasr`'s `corner` returns the *opposite* girl
   (0/4 agreement with the home ring). `FasrRelations.corner` feeds `fasrKey`, which backs
   `isZero` and the solver's `Static Square` check, so it needs its own measured step.
5. **`Circulate` from facing lines is still illegal.** The shipped line variants are
   `Lines Facing In` / `Lines Facing Out`, not facing lines, so `Normal Lines` has no
   `Circulate` — the same gap the wave templates had (fixed in step 4b for waves).
6. **The wave circulate paths may be wrong.** The `Split Circulate` wave tam — and therefore the
   new `Circulate` wave tams that reuse its paths — moves half the dancers 4 units between the
   two parallel waves. A split call should keep each half in place, so the paths are suspect.
   Needs an independent read of the wave circulate before changing both calls together.
7. **`Trade`/`Run` variant selection is wrong from waves and two-faced lines (§9.1 step 4c).**
   `Boys Trade` from a wave picks the wrong gender/formation variant, moving dancers 4 units
   away from the dancer they should swap with and flipping their facings; it is the corpus's
   top engine gap (`4x`) and upstream of 6 of the 9 refused promenade finishes. `Cross Fold`
   is still indexed with no implementation, and `1/2 Circulate` and `Join Hands` are absent
   entirely.

   **CORRECTION — this is two problems, and the upstream one comes first.** The engine ignores
   the `sequencer` attribute except for the single value `gender-specific`
   (`convert.ts:273`), while Taminations defines four (`animated_call.dart:157-168`: `perimeter`,
   `exact`, `gender-specific`, `no`) and its own sequencer skips the last outright
   (`xml_call.dart:57-59`). Measured over all 556 asset files: 5948 authored `<tam>`, 271
   `sequencer="no"` across 61 titles, and **32 titles with no eligible variant at all**. So
   `matcher.ts:43-71` picks least error over a superset that includes caller-school demonstration
   animations. `Boys Trade` is 24 variants — 12 eligible in `b2/trade.xml` (all
   `gender-specific`) and 12 `sequencer="no"` in `ms/trade.xml`. Probed directly: the winner on the
   `Ocean Waves` template and on corpus `[W1p]` is a `sequencer="no"` demo at `error=0.000`, while
   on `Normal Lines` it is the eligible setup. The `Run` family (`Boys`/`Girls`/`Centers`/`Ends`),
   `Trade`, `Boys Fold`, `Girls Fold` and `Centers Cast Off Three Quarters` have NO eligible
   variant anywhere, so their winner is always a demonstration animation — which is why `B-Run`
   appears in 5 of the 9 refusing promenade lines and leaves partners 4–6 apart. The `prd.md`
   §9.5.1 selection rule is therefore the SECOND half of the fix, applied over the eligible set.
   See `PLAN.md` §2 and Phase 1.

   **MEASURED (step 4d, the flag is now parsed but matching is deliberately NOT filtered).** The
   attribute is now carried faithfully (`sequencerMode` / `forSequencer`, with `genderSpecific`
   derived from it — `convert.ts:parseSequencerMode`) and gated in `selection.mjs`. Filtering the
   `no` variants was tried BOTH ways and is a change for the WORSE, which is why matching is left
   unfiltered:

   | policy | published promenade get-outs that resolve | corpus success |
   |---|---|---|
   | unfiltered (shipped) | **12 of 30** | 53 |
   | strict skip of every `no` variant | **8** — `promenade.mjs` §5 FAILS | 52 |
   | prefer eligible, fall back where a call has none | **11** — `promenade.mjs` §5 FAILS | 53 |

   The two copies of `Boys Trade` are **indistinguishable on the setup**: for all 12 of its `from`
   strings the eligible `b2/` copy and the demo `ms/` copy have identical start geometry AND
   identical beat counts, so least-error matching cannot prefer one on geometry. The real
   mechanism, probed on the engine's own `Ocean Waves` template:

   ```
   [10] ELIGIBLE genderSpecific=true  from="Waves, Boys in Center"  REJECTED BY GENDER GATE (geometry matches at 0.0000)
   [11] ELIGIBLE genderSpecific=true  from="Waves, Boys Facing Out" REJECTED BY GENDER GATE (geometry matches at 0.0000)
   [22] demo     genderSpecific=false from="Waves, Boys in Center"  err=0.0000  <-- WINNER
   [23] demo     genderSpecific=false from="Waves, Boys Facing Out" err=0.0000
   ```

   The engine's wave template is **`BggB`** — boys at the ENDS, which is correct (All8's
   arrangement 0 for a wave, and `alignment.mjs` requires the templates to read as arrangement 0).
   Every eligible `Boys Trade` wave variant is authored for boys in the **CENTRE**, so the gender
   gate correctly rejects all of them; no eligible variant matches, and the **ungated demo wins the
   tie by array order**, applying boys-in-centre motion to a boys-at-ends board. That is the
   recorded symptom. On `Normal Lines` and `Two-Faced Lines` an eligible variant matches and wins —
   which is why the call is right from lines and wrong from two parallel waves.

   **THE FIX (next step, and it is not a filter).** The reference implements `Trade` and `Run` in
   CODE — `taminations-flutter/lib/sequencer/calls/ms/trade.dart` and `run.dart` — which is exactly
   why their `<tam>`s are marked not-for-sequencer. `trade.dart` is the specification: the trading
   dancer trades with the **nearest dancer in the direction containing an odd number of dancers**;
   when there are **intervening dancers** it runs around them, scaling to make room and passing
   right shoulders (so a trade ACROSS intervening dancers is legal — which is what `Boys Trade`
   from a `BggB` wave is); with no intervening dancers it is a partner trade (flip) when running
   left in the same direction, else a run scaled by half the distance, with hand holds for the
   swing/slip cases (`!samedir && dist < 2.1`). `run.dart` is the same shape: run around the side
   that has walkers, preferring the **partner** when both sides are open, each walker dodging into
   the runner's spot. Both belong in `coded-moves.ts` under the `prd.md` §9.5.4 contract. Only
   after that does removing the demonstration tams become safe, because the capability no longer
   depends on them. See `PLAN.md` Phase 1.

   **DONE — `Trade` and `Run` are now DERIVED calls.** Implemented in
   `engine/src/sequencer/trade-run.ts`, registered in `coded-moves.ts`. THE RULE, and it is a
   SWAP: both calls exchange the complete state — position AND facing — of the dancers they pair
   up, and nobody else moves. That is what the reference's arithmetic amounts to, because
   `run.dart` scales the runner's path and the walker's dodge by the *same* `dist/2` in the two
   dancers' own frames (which face opposite, so the displacements are the same world vector), and
   `trade.dart` leaves the intervening dancers out of `actives` entirely. The facing question this
   document previously flagged as unresolved therefore dissolved: in the net model there is no
   turn to derive, and exchanging the pair's facings is exactly what keeps a wave coherent. It was
   settled empirically by feeding each authored variant its own declared formation and reading the
   end board, and corroborated independently by the corpus, where the shipped demo motion leaves
   partners 4–6 units apart in 6 published promenade get-outs.

   The contract gained `CodedMove.applyToSelection(board, selectedIds)`: a move whose
   **non-designated dancers must also move**. The pivots' "apply the whole-board transform, then
   keep only the selected dancers" trick cannot express it — it would discard the walker's motion
   and leave two dancers on one spot, which is now asserted against. Both names also REFUSE the
   bare form with a reason, which is correct rather than a placeholder (neither has a whole-set
   reading), and that refusal keeps them out of `legalNext` and out of the search's edge set.

   MEASURED: promenade get-outs that resolve **12 → 15** of 30, broken-body refusals **6 → 3**,
   corpus success **53 → 59**, mid-body stops **71 → 68**, `ENGINE GAPS` distinct names **29 → 25**,
   and `Boys Run` — previously the list's top entry — is gone from it. `selection.mjs` asserts
   `Boys Trade` moves only the 4 boys (trading across the intervening girls) and `Boys Run` keeps
   the wave an Ocean Waves while swapping the layout `BB/GG/GG/BB → GG/BB/BB/GG`.

   Recorded limits, both refused with a reason rather than approximated: a Run around more than one
   dancer (`Run Around 2`; the reference's default is `runAround = 1`, which is what is
   implemented), and the reference's hand-holds for the swing/slip trade cases, because a derived
   apply has no hand state to read.
8. **The isolated selection reading can be unsound (§9.1 step 4a).** It centres the subset and
   matches with normal rotation tolerance, so an arbitrary pair can satisfy a two-dancer setup;
   `Centers Pass Thru` from Facing Lines currently resolves two dancers (one an end) rather than
   the 4 centres. Worth fixing by resolving the group first and constraining the match, rather
   than by centring.
9. **Phase 3 — Amendment policy for synthesised boards.** `FsmStore.amend` requires a getout,
   and a getout was not found even from boards with full identity, so every amendment from a
   formation that was not danced to was rejected with "no getout". Step 5 widens what counts as
   a getout (a state a finish closes), which should reduce those rejections — but that has NOT
   been measured, and the gate now returns paths that still end home, so the requirement's
   meaning is unchanged. The decision needed is still whether to make the getout gate advisory
   (recording `getoutVerified` on the amendment) or treat such formations as unamendable.
10. **The getout/getin search is quadratic in the catalog (step 5).** `searchCandidates`
    enumerates every registered call per node and, with equivalents on, re-scans the catalog per
    candidate. A successful getout costs ~3 s at budget 200; a getout that does not exist takes
    54–102 s on the corpus; `fixIt` beyond depth 0 and the `transitionTable` build do not finish
    at all. Needs an index (calls by start formation, or a cheap formation-only pre-filter)
    before the UI's getout/fixIt surfaces are usable on a set with no getout.

    **CORRECTION (re-measured).** `fixIt` beyond depth 0 DOES finish: depth 1 in 48.19 s, offering
    46 calls (depth 0 is 4.0–5.6 s and offers 578). Only the `transitionTable` build remains
    unverified, and it is still the worst case here. The pinned negative is `[P4p]` at
    `getout({maxCalls:3, budget:400})` = **134.60 s → null**. And the driver is NOT `budget` but the
    size of the reachable state space: a synthetic scattered board exhausts its `seen` set in
    0.07 s at budget 400 while `[P4p]` spends the whole budget for 134.6 s — so a before/after
    measurement needs a large-state-space board, which `getout-convention.mjs` deliberately does
    not contain (see its comment at `:132-135`; `PLAN.md` Phase 3 adds one behind an env flag).
    The per-node cost is dominated by the equivalents widening: `searchCandidates` calls
    `equivalentCalls` once per DISTINCT end board, and each re-loops the catalogue
    (`solver.ts:129-136` → `:102`), i.e. L × C applies per node with L = 24–286 and C = 2211.

    **SOLVED — Phase 3, which also found a defect while measuring.** The L × C term is GONE, and
    it did not need an index: a call's equivalents are exactly the other calls **legal from this
    board** reaching the same end formation, and `searchLegalCalls` has already computed that list
    with its end boards, so grouping it by `knownFormation` reproduces `equivalentCalls` from work
    already done. The private `equivalentCalls` is deleted; the public
    `Sequencer.equivalentCalls` is unchanged.

    New: `SearchStats` (exported; on with `setCollectStats(true)`) reports BOTH complexity terms —
    `candidateScans` / `candidateCalls` for C, `equivalentScans` / `equivalentNameIterations` /
    `distinctEndBoards` for L × C — because timing alone cannot tell "halved L" from "removed the C
    factor". Measured old source vs new, same machine (`git stash`, rebuild, re-run):

    | invocation | before | after |
    |---|---|---|
    | `[P4p]` getout `budget=400` (FAILS) | **95.0 s** | **11.5 s** |
    | `[P4p]` getout `budget=100` (FAILS) | 32.5 s | 3.9 s |
    | getout on `L1p` (succeeds) | 4.16 s | 1.87 s |
    | `fixIt depth=0` on `L.F1p` | 1.81 s | 0.78 s |
    | `fixIt depth=1` on `L.F1p` | 33.0 s | **3.6 s** |

    `eqScans=0, eqIters=0` on every invocation — the mechanism, not just the speed.

    **A real defect the measurement exposed:** `fixIt` returned DUPLICATES — `Promenade` eleven
    times — because the equivalents loop pushed a byte-identical `(name, end board)` pair once per
    candidate ending in the same formation. Pre-existing, not introduced by the change, but a list
    a caller chooses from must not repeat one. The candidate list is now deduped on that pair, which
    keeps genuinely different edges (the same call reaching a *different* board). Consequence, stated
    honestly: `fixIt` from home now offers **18** calls, not 578. Two reasons — the duplicate bug,
    and because the old list came from `applySearch` at the **loose** tolerance with **no tight
    prefilter**, so it contained force-fits that `searchLegalCalls` prunes by design ("so force-fits
    are pruned at search time rather than surfacing as a getout that fails on apply"). Verified: **0**
    entries of the new list fall outside the tight legal list. The 578 was inflated by both effects
    and was described here as "not a shortlist"; 18 is one.

    `getout-convention.mjs` §5b now sweeps **every** alignment behind `GETOUT_SWEEP=1`, closing a
    real gate gap: the workstream's headline claim — "27 of the 28 alignments that have a start
    board" — was asserted NOWHERE, and the harness sampled only five. It reports **27 of 28**, with
    `[P4p]` answering `null` in **11.5 s** against a 40 s bound.

    **Remaining:** the C term is now the whole cost (17 catalogue scans for 447 nodes on `[P4p]`).
    That is the start-formation index this step did not need — `library.allVariantSetups()` still
    drops the call name it would need to carry.
11. **`boardSig` ignores facing.** The BFS does not distinguish a board from its re-faced twin,
    which is what makes pivots prune cleanly, but it also means two genuinely different states
    share a dedup signature. Anything whose answer depends on facing must key on the full pose
    (the solver's `finishToHome` does). Review whether the search should distinguish them.
12. **Geometry-derived calls are still not FSM edges.** The precomputed table and
    `Sequencer.legalCalls` enumerate the catalog, so `Promenade` appears in `legalNext()` (when
    it applies) and is now a search edge, but not in the table. The table builder would need a
    rule for a call that is legal from a *precondition* rather than from a setup.
13. **Phase 4 — Coverage and spec alignment.** Audit checks for the bounded non-geometric
    matching exceptions (§8.2), a decision on the editor's "no match within tolerance" wording,
    and an explicit runtime-join check.
14. **Phase 5 — Hygiene.** `knownFormation` is the last loose-tolerance (6.0) outlier,
   deliberately permissive for legality; review whether it should follow the tight recognition
   threshold.

**Done.** **Phase 6 — Carry the declared gender onto synthesised boards.**
`formations.xml` declares a `<dancer gender="…">` per slot and `parseFormations`
parsed it, but `CallLibrary` discarded it when building the named formations — which
is why a synthesised board had to invent identity. The declared gender is now carried
through (including onto the 180°-mirrored half) and stamped by `boardFromMatchables`,
so gender gating works on Set-formation boards and the false rejection the fabricated
`boy` caused is gone. Measured: all 129 synthesised formation boards now carry real
4 boy + 4 girl genders; a `Circle` board accepts `Circle Left`, which the fake all-boy
rejected; and gender-based selections resolve on a synthesised board while the
couple-based ones still do not (`UNKNOWN_COUPLE`).

**Done.** **The ring's travel comes from the CALL, not from the end board.** Reported
from the POC: "the dancers don't move, but the sequencer counts 8 beats". The mechanism
is exact — `Promenade` means "promenade until you are home", so from a squared set its
end board IS the board it started on, and `interpolateSegment`'s ring branch derived its
whole arc from the start→end angle difference. Measured (`tools/promenade-instance-probe.mjs`):
net travel **0° for all eight dancers** from home, against **±180°** for `Promenade 1/2`.
The old route was also sign-ambiguous at half a turn, so a half promenade's partners took
OPPOSITE directions.

The rule is CALLERLAB's own Mainstream text: "Promenade Direction: Counter-clockwise", and
"Promenade Home is usually more than a quarter of the way around the set. If not, dancers
are often expected to add a full Promenade" — so a trip of a quarter turn or less becomes a
full circuit, which is the case that matters because from home the trip is zero. The
reference agrees and is the stronger evidence because it is an animation: Taminations has no
`AnimatedCall('Promenade')` (its `ms/promenade.dart` is every QUALIFIED form), the coded
table catches the bare name only to REFUSE it ("Use either Promenade Home or Promenade
<fraction>"), and the form that does move — `Promenade Home` — repeatedly applies
`Counter Rotate` (a quarter turn about the set centre) in a `do/while` until the dancer's
location angle returns to its home anchor, i.e. four quarter turns from a squared set. The
engine's bare `Promenade` is a documented bridge for All8's `--Prom`; what it lacked was
the motion, and the motion now comes from `promenadeTrip` + `promenadeLap`.

Measured after, over the 19 boards the call applies to (the 4 named formations + the 15
All8 get-out start boards; `tools/promenade-travel-probe.mjs`): home net travel **0 → 360°
for all 8**, end still exactly home; `Promenade 1/2` **±180° alternating → +180° for all 8**;
worst closest pair **0.055 unchanged**, boards with a pair inside 1.0 **13 unchanged**,
largest quarter-beat move **0.279 → 1.180**. It is a redistribution — `[P4p]` 0.076 → 0.764
and `[B4c]` 0.055 → 0.093 improve while `[P3p]` 0.764 → 0.076 and `[B1p]` 0.881 → 0.138
deepen, and a twentieth board outside that set, the body ceder-10530's `Right and Left Grand`
leaves (the known limit recorded at 0.303 when the ring arc landed), goes **0.303 → 0.187**.
**No board moves from a clean pass into the band** — every one that deepens was already inside
1.0 — and they are all bodies whose stored "couple" is split across the set, whose fix is the
facing-pair ring.

Two mechanisms had to be separated by measurement rather than argument. **(a)** The
CALLERLAB lap is decided ONCE for the whole set: being the same number for all eight it
cancels out of every pairwise angle, so it cannot collide anyone the trip would not, where
per dancer it can — measured on the Zero Box template `[B1c]`, **1.905 → 0.076 per dancer
against 1.905 → 1.905 shared**. **(b)** A ring move is never an EXCHANGE: the exchange
pairing runs first and a half promenade sends each dancer to the point diametrically
opposite its own, so it paired dancers six units apart and swept them the same way round a
shared midpoint until they met — measured closest pair **0.000** from `O In`, against 2.000
for the wheel the call is; guarding that detection took the `Promenade 1/2` band **17 → 13**
boards and its worst gap **0.000 → 0.127**.

`sequence-anim-collision-scan.mjs` is BLIND to all of this and returns byte-identical
numbers either side: of the 113 modules carrying a promenade step only **4 animate one**
and all four are qualified CATALOGUE calls. That is why the corpus probe was written
(`tools/promenade-corpus-play-probe.mjs`) and why the before/after is measured on the
boards the CALL applies to. Gated in the same commit: `promenade.mjs` pins the shape and the
direction exactly (a quarter turn counter-clockwise at the quarter beat to 1e-9, 6.32 units
travelled by the half beat, exactly home at the last beat, and a fraction that takes no lap),
and its old "in motion, not home" check — which passed on a wobble, and on 0.000 of motion —
is now a floor, with `[L.F1p]`'s worst dancer at **6.97** units by the half beat.

**Done, and half refuted.** **A ring's couples are read from the FLOOR, not from the stored `couple`
labels — and the pairs cannot be made to wheel rigidly while the identity model stands.** The report was
"they travel in different directions" on MS `ceder-7046`'s end ring, which `tools/ring-facing-probe.mjs`
measures as an **Alamo ring**: boys outside at radius 3.45, girls inside at 2.93, each pair FACING at
2.3 units with a side-offset of 0.01-0.05, while the stored labels pair dancers 180 degrees apart with
the same heading (the FASR `o` reading).

A new instrument was needed before anything could be judged, because neither corpus-wide scan can see
this class: `tools/promenade-pair-probe.mjs` re-derives the pairs from the floor INDEPENDENTLY of the
engine. MEASURED: **0** boards where a pair takes two different directions (the counter-clockwise fix
above had already removed the reported symptom), but **12 of 17** where a partner separation moves more
than 0.5 units, worst swing **6.15 units**; on 7046 the four pair MIDPOINTS sweep a uniform **509
degrees** while the two members of a pair disagree by **184 degrees**.

**"Wheel each pair rigidly" was implemented and REFUTED.** Each pair took its own midpoint's sweep as a
shared axis, each member's offset from that axis was held through the wheel and eased out over a settle —
the reference's own shape, since Taminations wheels and THEN does `Half Wheel Around` +
`adjustToFormation`. MEASURED worse on every axis: closest pair **0.055 → 0.007** (`[L3c]`), largest
quarter-beat move **1.180 → 2.086**, and on a half promenade **2 boards where a pair's members take
opposite directions**, the very thing the change was for. A softer settle restores the collisions (0.057)
but leaves the peak move at **1.464** and still splits 2 pairs. And it cannot meet the stated gate:
the separation swing is **5.79** against the **5.59** it started at, because the swing comes from the END
BOARD, not from the wheel.

**The cause is the identity model.** `promenadeHome` returns `makeSquaredSet()` BY ID — every dancer to
its OWN declared home spot — so on an Alamo ring a floor pair's members (declared into couple 3 and
couple 1) home **180 degrees apart**, and any converging animation must separate them by 180 degrees by
the end. The only freedom is WHEN, and the measurements show holding them together and settling late is
worse than the current smooth spread. Ending a promenade with the pair at the MAN's home is CALLERLAB's
own "the Couples Promenade to the Man's home position", i.e. applying the temporary couple number to the
RESULT — the change this repo reverted twice for 2 figures, and which contradicts "identity is data".
That decision belongs to the project, not to an animation tweak.

**The reading half IS done, and it is free.** The point-of-use pairing read could only see partners
standing SIDE BY SIDE with the same heading, so on an Alamo ring it found no mate, returned null, and let
the stored labels stand — whose "couple centres" are the MIDDLE OF THE SET (radius **1.13**, against
**3.00** for the real pairs). `progression.ts` now has a FACING pass, guarded to fire only when EVERY
stored pair is outside the couple band, i.e. when the labels pair every dancer with somebody on the far
side. MEASURED: a `Promenade 1/2` from 7046's end ring ended **-90 degrees from home** and now ends
**EXACTLY HOME** (`tools/promenade-rotation-probe.mjs`), because the ring reads as half a turn out.
Figures stay **116 of 188**; get-out behaviour and conformance byte-identical; `anim-convergence` keeps
its 7 pins; `verify:light` green.

**The guard is load-bearing, and that cost a census round-trip.** Unguarded, the facing pass also fires on
`figm130`, whose board is two squeezed LINES (floor pairs 1.5 apart, midpoints at the four CORNERS)
carrying one stored pair that IS inside the band, 2.50 apart; pairs read off a line are line adjacency
and not couples, so the ring test fired on a body that is not a ring and refused its `Promenade`:
figures **116 → 115**, three runs each way, with `tools/promenade-figure-stop-probe.mjs` naming the
victim. Gated in `promenade.mjs` §4c, which checks the witness really is an Alamo ring before using it.

**The call editor now edits an INSTANCE — the start formation and its arrangement, the end formation,
and the moves — and the `<tam>` round trip is MEASURED.** Until now the editor could only RE-FRAME a
call: `synthesizeSetup` pads another call's end onto its start. It could not touch the instance itself,
and a `<tam>` is exactly three things — a start formation, a path per dancer, and the beats around them.

The model is the BUNDLE. A `DancerSpec` already IS a start pose plus a path and a `CallBundle` already
IS an instance, so the editor adds OPERATIONS (`normalizeInstance`, `instanceTable`, `setDancerStart`,
`setDancerGender`, `setDancerEnd`, `setMove`, `addMove`, `removeMove`) rather than a second
representation that could drift out of step with the renderer, the matcher or the XML codec.

**`normalizeInstance` is the safety property, and it is measured rather than asserted.** A tam authored
for half the set publishes its four dancers in HALF-set space — `ms/circle.xml` and `b1/circle.xml` both
carry **4 mirrored of 8** — so letting a caller edit those numbers would edit a frame they never see,
and a start edit would land on the MIRROR of the spot that was typed. Normalization is a 180-degree
rotation about the origin, which is exactly `fromPosAngle(-x, -y, a + pi)`, and that left factor
commutes with the whole path chain. MEASURED over t = 0, ¼, ½, ¾ and the end on both witnesses: worst
pose gap **2.3e-15 units** — one ulp, because `cos(a + pi)` is not bit-identical to `-cos(a)` —
idempotent, with no mirror left. THE FIRST DRAFT OF THAT CLAIM SAID "EXACT" AND THE HARNESS KILLED IT:
the honest form is "exact algebra, exact in floating point to one ulp", and the bound is pinned rather
than rounded to zero.

**What each edit does is a measurement, not a description.** `setDancerStart`: a translated start
translates the whole path — a (+2, −1) start edit moves that dancer's end by exactly
**(2.000000, -1.000000)** — and a start HEADING edit **rotates** the path about the start, (dx, dy) →
(−dy, dx) to 1e-9, because a path is authored in dancer-local coordinates. That is what makes this an
edit of the INSTANCE rather than a rewrite of its choreography. `setDancerGender`: nobody moves, nobody
re-faces, and the derived home couple is **unchanged**, because identity is matched on position and
heading — which is why `couple` is reported as a READ and not as an editable field: a taminations
`<dancer>` declares only gender/x/y/angle, so an editable couple could not round-trip. `setDancerEnd`:
the dancer ends exactly on the target, only its LAST move changes, no other dancer moves, and the beats
are held. `setMove`/`addMove`/`removeMove` re-time the call.

**The first re-timing rule was wrong, and the harness caught it.** "beats = max(path)" CUT an authored
pause: a 14-beat call whose longest path is 10 came back at **10.5** after half a beat was added to a
shorter dancer — a 3.5-beat pause destroyed by an edit that never touched it — while leaving the number
alone ignores a genuine re-time. The pause is now carried as a DELTA: 14 → 14.5, pause still 3.5.

**Two real defects fell out of the export.** `callToXml` dropped `sequencer`, `actives` and the
`<taminator>` note. `sequencer` is not decoration: `Catalog.registrationXml` registers an applied fix
from THIS xml, so an edit to the `sequencer="no"` half of a call came back as an ordinary **matchable**
setup — the demonstration hole the flag exists to close, re-opened. Second, the 2-decimal precision is
the assets' own house style and is not enough for a round trip: a path is a CHAIN, so each segment's
rounded rotation Bezier accumulates. MEASURED on `ms/circle.xml` edited to 10.5 beats: the end pose came
back **0.0672 units** out, 13× the rounding of any single coordinate — a dancer visibly off its spot. At
**four** decimals the same path is out by **0.000082** end / 0.000037 move, and the harness pins
**0.001**, which the 2-decimal form fails.

**The round trip is the done-when and it is gated in `engine/test/editor.mjs`** — which is in the
`light` tier, so it runs in the fast gate. Edit every dimension the editor can reach, export, re-parse,
and require the same start formation, the same end formation, the same ARRANGEMENT (gender per dancer),
the same moves beats-and-Bezier and the same beat count — plus that exporting the RE-PARSED instance is
**byte-identical**, so the round trip cannot drift.

**One footgun is pinned rather than discovered later.** The engine's mirror rule is geometric — it
duplicates a half set only while SOME 180-degree partner exists — so an edited eight-dancer formation
with no origin-opposite pair is read back as **16 dancers** under `mirror: true`. A rigid edit (a
translation, or a rotation about the origin) PRESERVES every pair and cannot demonstrate it; moving one
dancer out of each pair can, and the harness does exactly that. Every editor path is `mirror: false`.

**The POC wiring is typechecked, not measured, and that is said rather than implied.** The Vite app
cannot run under this sandbox (`spawn EPERM`), so the instance table, the moves editor and the
save/apply-as-`kind: 'instance'` path are reasoned from the code; what IS measured is every geometric
decision they call. THE PRE-EXISTING `editor-ui.ts` TS2739 IS FIXED IN PASSING, so
`npx --prefix poc tsc -p poc --noEmit` is now CLEAN — a POC typecheck is a real signal from here on.
`node poc/verify.cjs` still fails the same THREE pre-existing `Pass Thru` checks and loads all 542
catalogue calls; `verify:light` is green at 12 harnesses in 36.3 s.

**The moves row drives the stage, and the beat range comes from the engine.** The moves of the
chosen track are shown as ONE STRIP rather than one at a time behind a dropdown, so the whole path
being edited is readable at once: the move being edited is **triple width** (180px against the
compact tiles' 60px) and carries its numbers, every other move is a compact tile showing its number,
its beats and its hands, and clicking one selects it — which is also what moves the highlight. A
declared pause still falls after the last move, and a long path scrolls horizontally.

Selecting a dancer in **Moves of** hides every other dancer's track — the dancers stay visible, only
the tracks are hidden, and leaving the instance editor gives every track back. The current move's own
stretch of the chosen track is highlighted in amber and the rest of it is dimmed. That stretch is a
BEAT RANGE, so it is `moveBeatRange(dancer, k)` in `editor.ts` and `sampleTrailRange` in `core.ts`
rather than arithmetic in the UI, which is the only reason it can be checked at all.

MEASURED: the ranges TILE the dancer's clock — `[0,1) [1,2) … [9,10)` for a ten-move path — and the
last move ends at the dancer's OWN path total. The poses at the range's `from` and `to` are the poses
reached with the earlier moves on the path and with this one included, and the check does that by
TRUNCATING THE PATH, a different code path from re-adding beats, so an off-by-one separates from a
typo. A declared PAUSE falls AFTER the last move and not inside it (`to` 10 against the call's 14) —
the distinction that keeps a highlight from claiming beats the move does not dance. A zero-beat move
owns an empty range and the renderer draws nothing for it, and an out-of-range index THROWS rather
than returning a silent empty range. For the sampling, the endpoints are **exactly** the poses at the
range ends, every sample lies inside the full track's bounding box, the stretch is never longer than
the whole track (2.04 against 17.53 units for move 2 of dancer 1), and a range past the end of the
path clamps to the path's last pose rather than returning NaN.

The trail itself is one state with ONE application rule. App-mode visibility, the dancer isolation and
the move highlight were three things that could disagree, and a trail that silently reappears after the
views are rebuilt is exactly the "draws wrong while it measures right" class this workstream exists to
remove — so `CallBrowser` remembers the focus and re-applies it whenever `showCall` rebuilds the views.

**The call lists have a filter, and it cannot change what you have selected.** The editor's catalogue is
several hundred calls, so a **Find** box narrows every call list in the panel — edit, post and pre —
by ANDed substrings over the level, the title, the file name and every setup's `from` label, which makes
`circle`, `ms wave` and `static square` all mean what they look like they mean, with a count of what is
left and Escape to clear it.

The one subtle part is the selection, and it is the reason this is worth writing down. Clearing a
`<select>`'s options moves its `value` onto whatever survived, and NO `change` event fires — so a filter
typed over the top of the chosen call would leave the panel showing one call while the editor's state
still held another, with nothing to reconcile them. The chosen call is therefore always kept, re-inserted
at the top of its list and marked `▸`, which makes the filter a pure VIEW of the catalogue: it can only
change which calls you can reach, never which one you have. It is UI-only and typechecked — no engine
code, no harness and no feature file changed for it, and the predicate is a substring test with no
geometry in it to measure.

**A call can now be CLONED onto a different start setup, and the track completed afterwards.** A `<tam>`
is authored for ONE start formation and its moves are written in dancer-LOCAL coordinates — each move's
origin is where the dancer stands when it begins and its +X is the dancer's facing — so the authoring
unit is really `[start formation] + [local move chain]`. Re-using the chain from a different start is
the cheap half of authoring a new setup, and it is also exactly why the track goes wrong: re-posing the
start re-frames the WHOLE chain, so the set stops performing the intended whole-set motion and the end
board comes apart.

MEASURED on a witness rather than asserted: `Circle Left` re-based from a squared set onto `Double Pass
Thru` finishes **2.86 units and 90°** from where the call finishes. That is the now-invalid track, and
`endPoseError` is what puts a number on it.

**The fix is one move per dancer, and the anchor is the END.** `connectStart` re-aims each dancer's FIRST
move so it carries the dancer from the new start to the pose where the ANCESTOR's track resumes. Every
later move is untouched, so the end composes from the same pose it always did and comes back. MEASURED:
the end is restored to **1.54e-15 units / 4.44e-16 rad** — ONE ULP, because the pad Bezier recovers its
end heading from a TANGENT, which is not bit-identical to walking the authored chain, and the bound is
pinned rather than asserted to be zero. Every later move is byte-identical, and the re-aimed move keeps
its own beats and hands: this re-aims a movement, it does not re-time the call.

IT WOULD HAVE BEEN EASY TO ANCHOR ON THE WRONG THING, and the first attempt did. Re-aiming at the OLD
START's first boundary would move the end along with the start — not a clone of anything. And the
"already connected" test was first written as "is the dancer's START the anchor", which is a different
question with a different answer for every dancer, so every authored first curve was silently re-aimed
into a straight pad and `connectStart(ancestor, ancestor)` was not the identity. Asking whether the
dancer's OWN FIRST MOVE already ends on the anchor fixes it, and the harness pins that identity now.

WHAT CANNOT BE CONNECTED IS REPORTED, NOT HIDDEN. A dancer whose first move has zero beats has no time
in which to walk in: it is left alone, stays **3.25 units** wrong, and `endPoseError` says so.
`endPoseError` compares dancer **BY INDEX** on purpose — a clone and its ancestor share their dancer
order and identity, so a permutation of the same ends must READ as an error rather than be paired away
by a re-derived correspondence. That is precisely what `closureDiscrepancy` does, and why it is the
wrong tool here.

THE PICKER OFFERS EIGHT-DANCER FORMATIONS ONLY, AND TODAY THAT FILTERS NOTHING. `setStartFormation`
refuses a formation whose dancer count differs from the call's, because re-basing eight dancers onto
four spots is a gap rather than a setup. MEASURED over the whole pooled catalogue
(`node engine/test/tools/editor-clone-probe.mjs`, registration 1.6 s): `listFormations()` offers **134
formations and every single one is eight dancers**. So the filter is a guard, not a fix, and it is
recorded as a guard — a filter that is doing nothing should say so rather than look load-bearing. The
assignment itself prefers a spot of the dancer's own declared gender whenever the counts allow, and
falls back to pure geometry when they do not, so it is total either way. A clone is saved and applied as
a NEW setup (`kind: 'clone'`, appended) rather than as a replacement — which is the whole difference
between it and an instance edit.

**The browse panel names the call's END FORMATION, and a caller can label one the library cannot.**
The panel holds a call BUNDLE and every read the engine offers takes a BOARD, so `boardAtBeat` is what
makes "what formation does this finish in" askable at all. Identity is read from the START — identity is
fixed at the opening square and never changes — while the geometry comes from the last beat; a start that
is not home-like reports `id: 0` / `UNKNOWN_COUPLE` rather than inventing an identity from the array
index, and the field shows the name, whether it is user-defined, the `[FASROO]` notation and the Callerlab
arrangement number when the formation's letter is known.

**The answer is COMPUTED, not looked up, and the FSM is the reason that is the right call.** The obvious
route is the precomputed FSM asset, whose edges carry an `endFormation` per (state, call). But that value
is itself produced by the same recognition, so it cannot name anything the recogniser cannot, while being
a BUILD ARTEFACT that can lag the assets. The panel has the call in hand, so its end board is one
`poseFor` per dancer away and is always current. Using the FSM here would have added a staleness failure
mode and bought nothing; what the read does instead is say WHICH recogniser answered — the permissive
library read or the curated label — so a stale FSM surfaces as a disagreement in the FSM tab rather than
as a wrong label here.

MEASURED, and it decides the shape of the feature (`node engine/test/tools/end-formation-probe.mjs`, MS
level, 1015 call variants): the library names **636 (62.7%)** of the end boards, **413 (40.7%)** also
carry a curated label, and **379 (37.3%) are unnameable**. The split inside that last number is the whole
story:

```
   2 dancers:     2 variants,     0 nameable
   4 dancers:   312 variants,     0 nameable
   6 dancers:     6 variants,     0 nameable
   8 dancers:   695 variants,   636 nameable (91.5%)
```

**Not one half-set end board can be named, and that is by construction** — the formation library holds
eight-dancer geometries only (its constructor mirrors a four-dancer corpus entry to eight and drops the
original), and `bestFormationMatch` skips any formation whose dancer count differs. So the labelling flow
is offered for the **59** unnameable EIGHT-dancer ends, and REFUSED with the reason on screen for a
half-set authoring, where a label would be exactly as unusable as the board it was made from.

**A user-defined formation is tagged and registers immediately.** `registerFormation` adds the name and
the geometry to the library and CLEARS THE MATCH CACHE, which is not a detail: the read is memoized by
exact geometry signature, so without that the board the caller was looking at would keep answering
"unnamed" for the rest of the session while the *next* board received the label. The same
geometry-dedupe the constructor applies is applied to the user path too, so re-registering a shape the
corpus already carries adds the NAME without a second copy of the geometry. Gated in `sequencer.mjs`:
the read before registration, the same read after (which is the cache), the tag, the dedupe, that an
already-named board keeps its name, that a FRESH sequencer over the same corpus does not know the label
(no leakage into the shipped catalogue), and that `formationToXml` round-trips through `parseFormations`
to 3.1e-16.

Stored locally and exported for the corpus, like every other authoring path here: a browser cannot write
`formations.xml`, so the label lives in `localStorage` (`dsUserFormations`), is registered at startup so
a shape labelled last session is recognised on the first read, and the panel offers the `<formation>`
block for pasting in.

**Two mistakes, two controls, because they are not the same mistake.** A user-defined end formation gets
a **detach** — the label is wrong *here*, so it stops applying to this call while the formation stays in
the corpus and still labels every other call that ends in it — and a **remove**, which deletes the stored
formation for every call. Detaching is deliberately NOT a change to the library: recognition is a geometry
question and geometrically the shape IS the shape, so there is nothing to correct; what can be wrong is
APPLYING a label to one call. The instance is keyed by `callId` + `setupIdx`, the same identity the
editor's saved edits use, and the detach is shown WHERE IT APPLIES (`"X" is detached from this call` with
a **reattach** button), because a mis-click must not be invisible or permanent. `remove` also drops the
detachments that named the formation — the record would otherwise dangle and silently suppress a future
formation given the same name.

**And the field must stop applying a label whose formation is gone**, or the destructive button appears
to do nothing: `remove` deletes the store entry and the library keeps the name until reload (there is no
unregister, on purpose), so the panel declines a user-defined name that is no longer stored — which is
exactly what a reload would show. Labelling a board RE-ATTACHES it, so a formation detached here and then
created again under the same name cannot eat its own work.

**NOTHING IS DECLINED SILENTLY, and that is the correction this feature needed.** The first version
returned a bare null, so the field read "not named" when the label was detached, when it had been removed
from the store, AND when the library had never heard of the shape — three different situations with one
appearance. A caller hit exactly that and reported "I created a new formation but the call I created it
from doesn't use it, still showing not named". The field now names the label it declined and why —
`detected "X", detached from this call [reattach]` / `detected "X", which is no longer in the corpus
[store]` — because an instrument that cannot report its own state is the bug, not a cosmetic gap.

**THE ACTUAL MISSING PLUMBING WAS THE SECOND LIBRARY BUILD.** `SequencerUI` builds a `Sequencer` in the
constructor AND in `rebuildSeq` (which replaces it wholesale on a level change). `rebuildSeq` re-registered
the user's saved MODULES and not their FORMATIONS, so a shape the caller had labelled stopped being
recognised the moment the level changed — the browse field went back to "not named" for the very call the
label came from. The registration now runs on BOTH builds, in one place (`registerUserFormations`), and
the invariant is the one the modules line beside it already stated: anything the panel adds to that
library has to be re-added whenever the library is rebuilt. Names are also compared canonically on the
store side, since the library canonicalises on the way in and the store keeps what was typed.

**The "all dancers" toggle is gone, replaced by one toggle per dancer, and the coordinate fields LOCK
when the selected dancers' shapes differ.** The user's own words were the argument for removing the
button: *"The 'All' button is almost useless as there are very few calls where all dancers do exactly
the same move."* A button you press and then have to undo is not a shortcut. It is now numbered chips in
the moves row, the same single state as the `sel` column of the instance table (one state, two places to
reach it), and a member of the selection can never be the last one removed — a panel showing a move with
no dancer selected has no meaning.

That removal deleted a concept rather than adding one. There is no separate "focused dancer" any more:
`moveDancer` is a GETTER over the selection returning its lowest-numbered member, because picking a
dancer to LOOK AT and picking dancers to CHANGE are the same act held in one place. Two pieces of state
for it gave the panel a way to display numbers that the next edit would not touch — the "draws wrong
while it measures right" class this workstream exists to remove.

**"Use the first selected dancer's data to modify all selected dancers" is exactly right for this data,
and the gate is on the LOCAL numbers.** A move's Bezier is authored in dancer-local coordinates — origin
at the dancer's spot when the move begins, +X along the facing at that instant — so the SAME local
control point on two dancers **is** the same shape, each rotated and translated into its own position.
Propagating a group edit therefore needs no rotation arithmetic at all: the local value is the shared
description, and the only conversion is the one that puts the pointer back in the dragged dancer's frame.
"After correct orientation" has a precise meaning here, and it is equality of those local values.

Which is why the fields are LOCKED unless the selected dancers' coordinates genuinely agree. Writing a
number into a field writes it to **every** selected dancer, so on a selection whose curves differ the
write would COLLAPSE genuinely different shapes into one in a keystroke — destroying the per-dancer
difference that made the selection worth making. Where they agree the write keeps them agreeing, which is
exactly the case where one set of numbers describes them all; a single selection is always editable. When
locked, the fields are **greyed rather than hidden** (the first selected dancer's value stays readable,
and a vanished field reads as a bug), the tile names the reason and the fix, and the board handles are
**not drawn at all** — a drag is a coordinate edit the same gate would refuse, and a draggable-looking dot
that does nothing is worse than no dot.

The gate is enforced in `commitMoveChange` AS WELL AS in the fields, and that is not belt-and-braces:
**the drag path reaches that function without going through the fields**, so a fields-only check would
have left the one path that writes geometry open. Beats and hands are deliberately NOT gated — they are
not coordinates, and unifying a timing or a hold across a selection is a legitimate group edit rather
than a collapse of geometry.

**ONE pair of handles is drawn, for the first selected dancer, and the dot is a third of the size.**
The pair belongs to `moveDancer`, so the handle on the board and the numbers in the tile are never two
dancers' worth of information. A pair per selected dancer is the literal picture of the group edit and
was the earlier behaviour; it is unreadable with a dozen dancers selected, the dots do not say which pair
is whose, and the pairs are copies of one another in any case because the drag writes one local value to
all of them.

The user reported the handles as *"very big"*, and measuring turns that from a preference into a fact: a
DANCER MARKER is radius **0.12** and the handle dot was **0.3** — **2.5x the thing it is a handle for**,
so the board looked like it was mostly handle. It is now **0.1**, a little under a dancer. The GRAB
TARGET deliberately did not shrink with it: shrinking the visible dot to a third shrinks its hit area
nine-fold, and a handle you can see but cannot grab is a worse artifact than a large one. The target is a
floor-plane radius checked independently of the mesh, on a plane at the handles' OWN height rather than
the floor, so a pick cannot drift with the camera angle.

`node poc/tools/handle-pick-probe.mjs` measures it, and wrote down a correction rather than a
confirmation. It pins the plane's sign (the classic `Plane(normal, constant)` off-by-a-sign, which a
steep camera hides and a grazing one does not), that a point 0.20 away is picked and 0.35 is not at BOTH
50° and 14° elevation, and that the target is 31-35 px on a 1080p view against the dot's 10-11 px. Then
it scans the corpus — **9994 resolved segments of the 542 catalog calls** — and reports that 69.7% of
curves have their two handles further apart than the pick radius, 24.8% have them distinct but closer,
and **5.5% have them EXACTLY coincident** (a Stand, or any curve whose control points collapse onto the
dancer's position). The first version of the probe asserted "unambiguous for >98% of curves" and THE SCAN
FAILED IT, so the claim that had just been written into the code comment was wrong and the comment now
states the real limit: where the dots coincide, the strict nearest-wins test gives the grab to `c1` and
one control point is unreachable. That limit predates the shrink — two coincident meshes were picked in
traversal order before — and a deterministic tie is the most a single grab point can honestly offer. It is
recorded rather than papered over.

(UI-only, as before: `npx --prefix poc tsc -p poc --noEmit` clean, `verify:light` green at 12 harnesses in
38.7 s, and `poc/verify.cjs` failing the same THREE pre-existing `Pass Thru` checks while loading all 542
catalogue calls. The Vite app cannot run in this sandbox, so the feel of the drag and the look of the
smaller dots remain reasoned from code and typechecked, not rendered.)

**THE FACING CURVE IS DRAGGABLE TOO, IN A DIFFERENT COLOUR — AND THE COLOUR IS THE ARGUMENT.** The Facing
tab draws the facing curve in cyan against the travel curve's magenta, and it appears only on the Facing
tab with `explicit` ticked. That last part is not a new guard: the tab is already disabled when `rotate`
is null, because "face along the travel tangent" is not a curve anyone can edit. The colour earns its
place because the two curves are different KINDS of thing — magenta is a path on the floor where the
dancer goes, cyan is a curve whose DIRECTION is where the dancer faces — and one colour for both would
invite reading the second as the first.

**AND THE FIRST VERSION OF IT WAS JOIN-THE-DOTS WITH A FALSE EXPLANATION, WHICH A CALLER CAUGHT.** The
reasoning that "the coefficients are a tangent space, so there is nowhere on the floor to put a heading"
was right; the conclusion drawn from it — draw only the control polygon — was wrong. The curve IS
drawable, and it is the thing that says which way the dancer faces. Worse, the note then claimed that
**the ray from the dancer out to a point of the curve is the heading**. `bezierAngle` is `atan2` of the
DERIVATIVE, so the heading is the direction of the curve's TANGENT. MEASURED over the corpus, the two
readings differ by more than 10° at **47.6%** of instants and more than 1° at **79.3%**: the claim was
not loose, it was false.

The curve is now drawn properly, sampled through the ENGINE'S OWN `bezierPoint` — the same cubic `poseFor`
evaluates the dance with, so the picture cannot drift from the data, which is the whole point of the POC's
split between engine and renderer. The three control points are the draggable dots and the control polygon
is the scaffolding they hang from. **Its length means nothing**, because uniformly scaling the curve leaves
every tangent — and so every facing — exactly as it was; it is drawn at the data's own scale so the dots
and the tile's numbers read straight off it. The cyan heading ticks on the amber trail are the same
headings, drawn where the dancer actually is, so the curve and the effect can be compared directly.

MEASURED (`node poc/tools/facing-handle-probe.mjs`, section 7): the drawn curve starts at the dancer's own
spot **exactly** and ends on the endpoint the tile edits (worst **0**); away from the ends its direction
matches the engine's heading to **0.00073°**, and quartering the measuring window cuts that by **16×**, so
the limit really is the tangent; the **32** drawn segments resolve the direction to **0.056°** at worst, so
the polyline is the curve rather than a lookalike. The two ENDS measure worse — 0.688°, shrinking 4× —
because a chord at an endpoint is a one-sided difference: first order, which is the INSTRUMENT and not the
claim, and it is reported as such rather than hidden by a looser bound. The probe's first version failed
its own check by asserting one bound across all instants, and its second failure in the same section was an
assertion that every curve stays inside the floor — 4 of 4145 reach past the floor's half-width — so the
tail is reported rather than asserted away. Nine curves in ten reach no more than **4.08** units from the
dancer, a couple of dancer-spacings, which makes the curve a local annotation rather than a board-wide
shape.

**THE TRAVEL CURVE GETS NO DRAWN CURVE OF ITS OWN, AND THAT IS NOT AN OMISSION: IT IS THE TRAIL.**
`sampleTrailRange` walks the very same cubic onto the floor, highlighted in amber for exactly this move, so
a second copy would sit on top of it and say nothing new. That is also the whole reason the facing curve
looked like join-the-dots: it had no other rendering, and the travel curve did.

**r1 SLIDES ON A RAIL, AND THAT IS THE FILE FORMAT TALKING.** MEASURED, and it is the finding that shaped
the gizmo: the `<rotate>` element carries cx3/cx4/cy4/x4/y4 and NO cy3, so the converter hardcodes
`cy1: 0` and the exporter emits no cy1 — an edit to cy1 is silently thrown away. A cy1 of 0.5 turns the
dancer **331°** mid-move and re-parses as the authored curve **exactly**. r1 therefore writes cx1 alone,
which is also what guarantees that no drag on this board can produce a facing the corpus cannot express.
In the **14** curves whose cx1 is already 0 the rail pointer sits on the dancer's own spot (Sashay,
Lateral Substitute) — a real authored shape, and it still means "no change of heading at the start",
because `atan2(0, 0)` is 0.

THE PROBE'S FIRST VERSION ASSERTED `cx1 > 0` OVER THE WHOLE CORPUS AND THE SCAN FAILED IT, the second time
in two commits that a claim written into a code comment was killed by its own instrument. The honest
assertion is `cx1 >= 0` with the zeros named. The same probe checks which point sets which end, and
MEASURED AT t < 1 TO DO IT: the heading change at t = 1 is the direction of `P3 − C2` only, so C2 and P3
set the facing the move ends on while C1 shapes only the middle, and nothing at all moves the heading
change at t = 0, because cy1 = 0 puts the start tangent along the dancer's own +x. A test at t = 1
reported "no change" for a cy1 edit that plainly changes the turn — the last derivative span contains no
C1 — which is why the measurement moved. Population: **4145 facing curves, 4088 of the 9994 resolved
segments carry an explicit one**; the end-of-move heading change is 0° for 2233 of them, 180° for 674,
−90° for 597, 90° for 383.

The drag's arithmetic is checked with its bound stated: placing a point and reading the pointer back is the
identity (worst **4.4e-16** over 20 frames at five headings), each of the three write rules touches its own
point's numbers and no other field, every edit keeps cy1 at exactly 0 and survives export + re-parse (worst
**0**), and a handle dropped back on its own value exports BYTE-IDENTICALLY, so a touch is not an edit. The
placement math is a COPY rather than the panel's function under test, because `editor-ui.ts` is TypeScript
inside a Vite app that cannot run in this sandbox, and the probe says so.

**AND THE NUMBERS FOLLOW THE DRAG LIVE, on both curves.** The drag path deliberately skips `renderInstance`
per pointer move — rebuilding the table, the strip and eight dancer views sixty times a second is the
difference between a drag and a slideshow — but that left the one thing the caller is steering by, the
numbers, frozen until the pointer came up. `refreshNumberFields` now writes the live instance's values into
the tile's existing inputs (skipping the focused one) on the light path.

The format fact the rail depends on is now a PERMANENT GATE rather than a comment: `engine/test/editor.mjs`
section 14c measures that a parsed facing curve carries cy1 = 0, that a cy1 of 0.5 really does turn the
dancer (331.5°), and that the export discards it. If someone later adds cy3 to the format and the exporter,
that check fails and tells them the rail is no longer the format's constraint but a self-imposed one.
`verify:light` green at 12 harnesses in 36.7 s, typecheck clean.

**CTRL SNAPS TO THE GRID — AS A MAGNET, AND THE CALLER CORRECTED MY FIRST ATTEMPT.** The cell is the
floor's own, and the authority is the format's header rather than a preference: *"The scale is in dancer
units, same as shown when the grid is on."* One unit is one drawn cell, a `Forward` (x2 = 1) is one cell
of travel, and the couples of a squared set stand **2** units apart. MEASURED
(`poc/tools/snap-grid-probe.mjs`): only **46%** of the corpus's authored coordinates are on the unit grid —
the rest are ⅓s, 4/3s and 1/√2s, what a Bézier approximation of an arc produces — so the snap is a NEW
convention rather than a restoration of one, which is why it sits behind a modifier.

The first version ROUNDED from anywhere in the cell, which quantises the drag: every position becomes a
grid position and the gesture stops being "help me land on the line". It is now a magnet — it pulls only
within a quarter of a cell (**20.1 px** in the flat view on a 1600 × 900 canvas with the floor fitted, where
a whole cell is 80.4 px) and
leaves the point EXACTLY where the pointer is otherwise, which the probe checks as a measurement of the
tolerance rather than an assertion about it.

**AND IT SNAPS TO THE BOARD'S GRID, NOT THE DANCER'S — the caller's third correction on this feature.**
Snapping the LOCAL coordinates put the control point on a grid rotated AND offset with the dancer, so it
lined up with the lines the caller can SEE only when the dancer was square to the floor *and* standing on
a whole coordinate. The point is now snapped in the coordinates the floor is drawn in, before it is taken
into the local frame at all. MEASURED (`poc/tools/snap-grid-probe.mjs`, which also reads three's own
GridHelper geometry to pin the premise that the drawn grid is 9 whole coordinates from -4 to 4 at a
spacing of 1): across **384** pose/pointer combinations the board snap lands exactly on a drawn line in
EVERY case, while the local one misses by up to **0.196** units — about 8 px, a control point visibly
beside the line it claims to be on — and agrees with the board snap only in the **64** cases where the
dancer is square to the floor on a whole coordinate. That stance is the usual one at the start of a move,
and it is the only one where the local snap was not misleading.

The trade is stated rather than hidden: the numbers left in the tile are the DANCER-LOCAL coordinates of
a grid point, so they are not round when the dancer is turned (a dancer facing 34° leaves 4.2132 rather
than 4.25). TWO OF THE PROBE'S OWN CLAIMS WERE WRONG AND THE SWEEP CAUGHT THEM: a single hand-picked
example happened to land 0.002 units from a line by luck, and the local snap is on a line in 32 of 384
half-coordinate cases by coincidence — never agreeing with the board snap in any of them.

**AND THE MAGNET HAS TWO TIERS, BECAUSE HALF POSITIONS ARE WHERE THIS DANCE'S COORDINATES LIVE.** The
caller asked for the half grid as well, and the measurement agrees with them: 61% of the corpus's authored
coordinates sit on half units against 46% on whole ones, so a magnet that only knew the drawn lines would
refuse the position the assets use most. The whole grid pulls from a quarter of a cell and the half grid
from half that — so a DRAWN line wins wherever they compete — and of 1000 positions across two cells 496
are pulled to a drawn line, 248 to a half position and 256 are left free: sticky enough to help, and free
over a quarter of the cell. And BOTH GRIDS NOW DRAW THE HALF POSITIONS - the square one as half LINES and the
radial one as half RINGS, at the same offsets and in the same material - so a half-snapped point lands on a
mark the caller can see rather than midway between two. Two tiers of PULL is still the honest description of
the magnet, since a drawn line wins wherever they compete, but the second tier is no longer a position the
floor declines to show.

**A SECOND FLOOR GRID, RADIAL, AND THE MAGNET FOLLOWS IT.** Asked for: "Add an alternative radial 'grid'
to all boards. The user can switch between radial and square grid. It should have 16 spokes and circles
along each of the existing x/y divisions. The Magnet feature should work in a similar way, but along the
spokes and circles." The switch is a STATE-DRIVEN BUTTON on the editor's Reset/Revert row — its label is
the state it is in ("Grid: Square" / "Grid: Radial") and pressing it flips to the other one, because there
are two references and no "off". The grid ITSELF is still drawn on every board in every tab; only the switch
lives there. It is deliberately NOT one of the editor's two view options, so `applyViewOptions` does not
release it, and `remember.ts` learned that a BUTTON can be a remembered control (its `value` carries the
state). One press, one session restore and the startup call all reach the floor through the same setter,
which writes the label, the value and both consumers at once.

THE GRID TOGGLE IS A KEY TOO - asked for as "Add a keyboard shortcut that maps the G key to toggle the Grid
type state that works globally for all boards." It is bound on the document rather than on the button, because
the button is one control inside the editor's panel and a shortcut bound to it would only work while that
panel happened to be on screen. THE KEY IS `W` NOW, NOT `G`, because `G` and `B` were asked for as the two
gender selects ("Now use the G to cycle Girls Select button and B to cycle the Boys Select button") and the
table is FIRST-MATCH-WINS with the grid binding ahead of every panel's - so `G` on both would have left the
girls select UNREACHABLE, still toggling the grid instead. A bare `W` is safe for the same reason any bare key
is: a modifier that is not asked for must not be held, so Ctrl/Cmd+W (close tab) stays with the browser.

AND THE SHORTCUT IS A LINE IN A TABLE, asked for as "Add a keyboard shortcut system, as i'll add others in the
future / or use a library." `poc/src/keys.ts` takes the bindings AND the listener target as arguments, so
`poc/tools/keys-probe.mjs` installs it on a FAKE target and dispatches synthetic events through it - the policy
is measured rather than read with a regex, which is what a `keydown` handler buried in a module cannot offer.
Four decisions are made once for every shortcut: A MODIFIER THAT IS NOT MENTIONED MUST NOT BE HELD (`{ key: 'w' }`
fires on `w` and never on Cmd+W, so a bare key cannot swallow the browser's chords - which matters most for the
letter whose chord closes a tab; `mod` is Ctrl-or-Cmd because
that is what undo means on both platforms); A FIELD BEING TYPED INTO KEEPS ITS KEYS (input/textarea/select/
contenteditable opt out unless a binding says `whileTyping`); HOLDING A KEY DOWN FIRES ONCE unless it says
`repeat`; and A PANEL SAYS WHERE ITS SHORTCUTS ARE LIVE with `when`, which is how the editor's Ctrl/Cmd+Z undo
moved onto the same table through `editorUi.keyBindings()` instead of owning a `window.addEventListener`.
The first matching binding wins, a key nothing owns is left entirely alone, and the table is validated on
install: a duplicate `id` is refused because it silently shadows a shortcut.

NOT A LIBRARY (mousetrap, hotkeys-js, tinykeys), and that is the judgement rather than an omission. The four
decisions above are the whole of what this app needs and are exactly the part a library cannot make for you -
what counts as "typing", what an unmentioned modifier means, whether a held key repeats. A library would add a
dependency to a package whose only runtime dependency is `three`, and a matcher that cannot be driven without a
DOM. `matchKey` and `dispatchKey` are the shape to keep if the table ever outgrows ~110 lines.

THE TABLE HAS SIX BINDINGS NOW, which is what it was built for. `W` is the floor grid, on every board in
every tab. Ctrl/Cmd+Z is undo, in the editor while it is editing an instance. And `S` - asked for as "Add an S
keyboard shortcut in Call Editor tab that switches between ends and controls on currently selected Move" -
flips the board's handles between the curve's CONTROL points and the move's END points, on the move the tile is
showing. `handleMode` is one value for the panel and the tile's `⇄` button is its control, so the key and the
button call ONE `toggleHandleMode` and cannot flip different state; its `when` asks `hasSelectedMove()`, the
same four things the tile needs (this panel, an instance, a dancer selected, a move at the selected index), so
`S` is live exactly when its button is visible rather than flipping a mode for a tile nobody is looking at.
VERIFIED IN THE BROWSER (Chromium against poc/dist): in the Call editor `S` flips `⇄ controls` -> `⇄ ends` ->
back with the status line following, an `s` typed into the call filter lands in the filter and flips nothing,
and Ctrl+S is left to the browser.

AND `E` ROTATES THE EDIT STATE - asked for as "Add the E keyboard shortcut that rotates through Edit Button
state between `Moves`, `Dancers + Position` and `Dancers + Rotation`." The Edit row asks two questions at once:
WHO the board's gizmo belongs to (the scope, `Moves` or `Dancers`) and WHAT it changes (the axis pair, position
or rotation). The three states it can show are named in ONE list, with the axis carried even for `Moves` - where
the pair is hidden - so that leaving `Moves` always lands on `Dancers + position` rather than on whichever axis
was left behind. The cycle calls `setScope`, the same method the row's own buttons call, and that is the whole of
the wiring: `setScope` is what writes the three buttons' `on` classes, shows or hides the axis pair and re-draws
the board, so a cycle that set the fields itself would be a second place for the row and the board to disagree.
AND `G` AND `B` CYCLE THE TWO GENDER SELECTS - asked for as "Now use the G to cycle Girls Select button and B to
cycle the Boys Select button." Each key runs `cycleGenderPicks`, the SAME method the button's own click handler
runs, and each is live by the SAME test the button's `disabled` reads (`hasGender`: this panel, an instance, and
somebody of that gender in it) - so the key cannot select a set the button would have refused, and the ticks, the
label ("girls", "girls 1·3", "girls 2·4") and the tooltip cannot disagree about what the key did. The tooltips
name their key, because that is the only place in the app the shortcut is written down. THE COLLISION THAT MADE
`W` NECESSARY is driven through the real dispatcher in `poc/tools/keys-probe.mjs` rather than argued about: two
bindings on one letter do not both run - the first wins and the second is dead - so a silent second binding is
exactly the failure a text assertion would wave through.

THE TWO GRIDS ARE THE SAME RULER. The radial one is 16 spokes (one every 22.5°, the four cardinals in the
bright centre-line colour the square grid gives x = 0 and y = 0) and a circle at every whole unit out to
the floor's edge, with the even radii overlaid exactly as the square grid overlays its 2-unit lines.
`scene.ts` draws it FROM the spec in `packages/stage/grid-magnet.ts`, which is pure — no DOM, no `three` — so what
is drawn and what a CTRL-drag snaps to cannot drift apart, and BOTH magnet probes now import that module
instead of restating the rule. Exactly one grid is ever visible: `setGridMode` sets both visibility flags
from one boolean, so there is no state in which the caller has to turn one off before the other on.

AND BOTH GRIDS DRAW THEIR HALF POSITIONS - the radial half rings were asked for first ("Add a half grid line for
the circles. Make this more subtle than the unit circles.") and the square half lines second ("Add the same
subtle half-grid line used by the radial grid to the square grid."). A mark at every half unit (0.5 … 3.5, one
between each pair of divisions) is a real reading, because 61% of this dance's authored coordinates sit on half
units; it is still not a DIVISION, so it is drawn to be seen without being read as one.

SAME POSITIONS, SAME MATERIAL, AND THE SECOND IS LITERAL. `squareHalfOffsets` returns exactly the offsets
`radialCircleRadii(...).halves` returns - computed separately, because an offset on an axis and a radius are
different shapes, and `radial-grid-probe.mjs` CHECKS that they agree rather than deriving one from the other -
and both grids draw from ONE `halfMat`, so "the same" is one object rather than two values that agree today.
The square half lines are a `LineSegments` and not a second `GridHelper`, and that is not a style choice: a
`GridHelper` divides its span evenly, so 40 divisions would put a line at EVERY half unit and overdraw the
divisions the grid already has, where the half mark is only the positions BETWEEN them. The probe also reads
the material itself and requires the half mark to stay dimmer than the divisions and clear of the cardinal
spokes' teal.

AND "TOO SUBTLE" TURNED OUT TO BE A NUMBER, which is how it got fixed rather than guessed at. The first cut
drew the half rings in the unit colour at 0.4, which composites to 0x202a35 - a contrast of 1.27 against the
0x0e141b floor, DIMMER than the 2-unit overlay already on that floor (1.43) and only a quarter brighter than
the floor itself. Reported from use: "I cannot see the half circles on the radial grid, they are too subtle."
`radial-grid-probe.mjs` recomputes all of it from the materials and the floor - the order, plus an absolute
1.5:1 under them - instead of reading the figures out of a comment.

AND BRIGHTNESS ALONE COULD NOT TELL THE TWO FAMILIES APART, asked for as "Can you add subtle colours to
differentiate the unit and half unit circles." The measurement says why it could not: the floor, the unit
circles and the overlay are all ONE HUE (212, blue), so a half ring differing only in alpha is the same colour
seen more faintly. The half rings now take a VIOLET-GREY (0x5c5068 at 0.6) - hue 270, 58 degrees away from the
divisions, still subtle at that saturation, and deliberately clear of the cardinal spokes' teal (hue 159) so
the three families on this floor read as three. It composites to 0x3d3849, a contrast of 1.64: above the
overlay's 1.43 so the half ring is not the faintest line in the picture, below the unit circles' 1.95 so it is
still the weaker family. The probe recomputes the contrast AND the hue gap from the materials - the order, an
absolute 1.5:1, and at least 30 degrees of hue between the two families - so neither "too faint" nor "the same
colour again" can return quietly. VERIFIED IN THE BROWSER (Chromium against poc/dist, the flat view, switched
with the W key): the half rings are visible and read as lavender between the blue-grey divisions.

THE MAGNET IS THE SAME RULE READ IN POLAR FORM: the radius through the square magnet's own two tiers, and
the angle onto the nearest of the 16 spokes. THE SPOKE'S TOLERANCE IS A DISTANCE, NOT AN ANGLE, and that is
the one decision in it — the same 3° off a spoke is 0.052 units across at r = 1 and 0.523 at r = 10, so an
angular window would pull both while a distance window pulls the first and refuses the second, and a point
a fixed 0.2 units across is pulled by 0.2 at r = 2, 5 and 10, over angles from 5.7° down to 1.1°. MEASURED
(`poc/tools/radial-grid-probe.mjs`): of the **359,687** moved points in a sweep of the floor every one
lands exactly on a circle of a snapped radius and exactly on a spoke whenever the angle moved; the magnet
is idempotent over 4000 swept points; the worst pull is **0.3614** units against the square magnet's
**0.3531** — the same **20.1 px** at that scale, because it is the same constant; and a point outside the pull
comes back BIT-IDENTICALLY unchanged, which is why the rule hands the point back untouched rather than
rebuilding it from its own polar form. NO HALF-SPOKE TIER is offered: the square grid's half tier exists
because 61% of authored coordinates sit on half units, and nothing in this corpus authors an angle on the
floor. Recorded rather than glossed: the spokes crowd together near the origin, so inside r = 1.281 every
angle is within a pull of some spoke.

**THE GROUP GATE WAS COMPARING THE WRONG THING, WHICH IS WHY A COMPLETED CLONE COULD NOT BE EDITED AS A
GROUP.** A caller reported that after "connect" cloned a start onto a new formation, selecting several
dancers no longer opened the Bézier edit — "they look the same" — and asked what the error window was.
The window was `1e-6` on each of the six translation numbers and the five facing ones, and the honest
answer to *what is the window* turned out to be that its WIDTH was never the problem: its KIND was.

MEASURED (`poc/tools/coords-gate-probe.mjs`, which drives the real engine through the panel's own clone
path): of 134 clone targets, 31677 pairs were identical to the last bit and 5326 were refused — and NOT
ONE refusal rested on a difference below 0.0889 units (3.6 px), while 509 pairs sat below 1e-6 and were
correctly treated as equal. So the raw-number window was separating noise from reality about as well as
it could. What it could not see was that a FACING CURVE IS SCALE-INVARIANT: `poseFor` reads it with
`bezierAngle`, which is `atan2` of the derivative, so multiplying all five numbers by any positive
constant leaves every heading at every instant EXACTLY as it was. Two such curves are the same facing,
and comparing the numbers refused the pair — which is the literal "they look the same". The same
happened with `rotate = null`: "face along the travel tangent" IS a facing, and comparing a null against a
curve refused on a difference of nothing at all.

The fix has three parts, and the first two are the engine's so they are gated headlessly:
`facingProfile` normalises a facing curve by its own derivative so a positive rescaling cancels and a
negative one (a 180° flip) does not; `sameFacing(a, b, tolDeg)` compares profiles exactly and falls back
to sampling the heading, because a heading is what it is only where it is evaluated and a bound on
`atan2` of a difference of derivative cubics blows up wherever the derivative nears zero — which facing
curves are full of, a hold's derivative being the zero vector. And the panel's gate now compares
`rotate ?? translate` — the facing the dancer ACTUALLY HAS — with a SHAPE window of 0.01 units and a
FACING window of half a degree. The shape window is a guarantee rather than a sample: a Bézier is a
convex combination of its control points, so two curves whose control points are within T are within T
everywhere, and 0.01 units is 0.4 px — below what an eye resolves.

The panel also stopped being silent about it: the lock note now names the two dancers, gives the
distance between their curves, and says outright when the difference is one nobody could see. Gated in
`engine/test/editor.mjs` section 18 (a curve and a multiple of it are the same facing while their
numbers differ by 0.825; a negative multiple is not; the tolerance form accepts 0.2° at half a degree
and rejects it at zero; a hold has no direction at all) and by the probe, which shows the tightest
refusal over every target to be a 0.09-unit difference in how far two dancers walk in.

**AND THE NUMBER FIELDS ARE NOW WIDE ENOUGH TO READ.** `show()` rounds to four decimals, so the longest
string a field holds is eight characters (`-10.3333`) — about 49px of digits at 11px, plus padding,
border and the browser's number spinner, which is 72px. They were 58px, and 50px inside the moves tile:
six characters, so a coordinate was clipped and the value being edited could not be read. The current
tile went from 180px to 240px so that two label-and-field pairs still share a row (three rows, not six),
and the field labels dropped their redundant `t.`/`r.` prefix — the tab already says which curve is on
screen — which is the width the second field needed.

**AND THE PROBES NOW RESOLVE THEIR PATHS FROM THEIR OWN FILE.** They read the POC's assets and source
through `process.cwd()`, so they ran only from `poc/`: `node poc/tools/x.mjs` from the repository root died
with ENOENT and looked like a broken probe rather than a misplaced one — found by running all five in one
loop from the root, which turned four of them red for a reason that had nothing to do with what they
measure. The dynamic engine import also needed a `file://` URL, because a bare Windows path is not a valid
ESM specifier.

**`arc` LOCKS A CURVE TO A QUARTER OF A CIRCLE OR AN ELLIPSE, AND THE GEOMETRY IS THE ENGINE'S.** The user
asked for a checkbox on each tab, and for it to be DISABLED where the handle directions make a quadrant
impossible. That last condition is the definition rather than a guard: A QUARTER ARC'S TWO END TANGENTS ARE
PERPENDICULAR — they are tangents at two radii a quadrant apart — so the family is the start direction plus
two lengths, and the endpoint follows to the conic's corner. The cubic is the standard
`k = 4/3(√2 − 1)` construction, a circle to **2.73e-4** of the radius, which is the best a cubic does.

**The quadrant keeps the curve's own handle directions**, so nothing about which way the dancer travels or
faces changes and only the endpoint moves. **The two handle lengths are the whole shape**, so they are the
two fields the tile offers while the five coordinates are locked, and the readout names the shape — which
is the rule as asked for: a circle if the two offsets are equal, otherwise an ellipse. The circle test
needs a RELATIVE tolerance, because the lengths come from a subtraction: a `Forward`'s two handles are
0.333 and 0.33300000000000002, and an equality test calls that walk an ellipse.

**MEASURED, AND IT DECIDES THE FEATURE'S SHAPE** (`engine/test/editor.mjs` section 17, over b1/ms/a1's
**4150** curves): **0** are already quarter arcs, **690 (16.6%)** could take the lock, and the rest are
blocked — **2968 (71.5%)** because their two handles are not at a right angle and **492 (11.9%)** because
they have no handle length to size an arc from. So the disabled state is the COMMON one, and a dead
checkbox with no explanation would have been the normal experience; the tile prints the angle it measured,
which is the number that tells the caller what to fix. A straight walk's handles are PARALLEL and a
U-turn's are ANTI-parallel, and neither is a quadrant of anything. A third refusal — a facing curve whose
start handle points backwards — never fires on the corpus (no authored facing curve starts by turning 180°)
and is recorded as a guard.

**A CURVE WITH NO HANDLE LENGTH IS NOT AN ARC, and that definition took a run to get right.** The first
version called the degenerate all-zero member of the family an arc and counted **138** corpus `Stand`s as
"already arcs" — three per cent of the corpus reported as a shape that is not there. With the no-shape case
refused, that number is zero. The projection's own first version also failed: its circle test was the
equality above.

The projection is checked to preserve what matters: both handle lengths and both directions kept exactly
with only the corner moving; a rotated arc is the unrotated one turned by its angle (worst **4.6e-16**); a
projected arc sets off and finishes facing EXACTLY as the original curve did; a facing arc turns the dancer
exactly a quarter turn; the disable reason and the projection agree on every witness, because the panel's
enabled state and its ability to project are one question asked once; and the arc survives export and
re-parse with re-exporting byte-identical. `verify:light` green at 12 harnesses, and the full engine gate
green at 23.

**DRAGGING A CONTROL POINT ALSO DRAGGED THE BOARD, AND THE CAUSE WAS TWO QUESTIONS SHARING ONE VARIABLE.**
`setControlsEnabled(false)` silences the camera for the length of a Bezier drag — but the drag RE-RENDERS
ON EVERY POINTER MOVE, and that path is `updateCall` → `applyDisplay` → `setView2D`, which wrote
`controls.enabled = !on` and so re-enabled the camera in the middle of the gesture. Worse, THE ORDER WAS
AGAINST US: OrbitControls registers its pointerdown listener when the stage is built, so it starts a pan
before the panel's handler silences it; and the panel's pointermove handler runs first, so the re-enable
landed before OrbitControls' handler ran on the same event. The board therefore panned under the point
being dragged. "Which view is on screen" and "is camera input suppressed right now" are now two facts:
`inputSuppressed` is the caller's, `setView2D` decides only WHICH control set it applies to, and a view
switch cannot resurrect the camera mid-gesture.

**AND THE FAULT IS REPRODUCED RATHER THAN JUST FIXED.** `poc/tools/view2d-probe.mjs` section 5 drives
three's own OrbitControls through a fake canvas in the order the browser delivers the events, with the
camera LIVE at pointerdown because the library's listener was registered first. The view moves **0.0000**
units with the fix and **3.13** with the rule it replaced — the second number is the regression test,
because a check that cannot fail on the bug is decoration. THE PROBE'S OWN FIRST VERSION PASSED ITS
NEGATIVE CONTROL BY MISTAKE: it suppressed input before dispatching the pointerdown, which lets
OrbitControls decline the gesture entirely, so nothing could pan however the view switch behaved. The
ordering WAS the mechanism, and getting it wrong made the instrument silent rather than wrong — the
failure mode this workstream keeps meeting.

**THE FLAT VIEW WAS NEVER FRAMED, AND HAD NO PAN OR ZOOM.** Two reported symptoms, two distinct faults,
and the first explains the second half of the report — *"it used to jump to square when dragged or
scaled"*. The orthographic camera is CONSTRUCTED with a square frustum (±11 on both axes), and `resize()`
— the one place that recomputes `left`/`right` from the canvas ASPECT — was only ever called from the
window's `resize` listener. The app never called it at startup, so on a 16:9 window the floor grid was
drawn stretched until the first window resize snapped it square. MEASURED, and the stretch is not
approximately the aspect but EXACTLY it: **142.8571 px per world unit across against 80.3571 up, ratio
1.777778** on 1600×900. (Those are the figures for the square frustum `createStage` builds from `FLOOR_HALF` - the
floor is 10 units across now, so they are smaller than they were at 8 and they move again if it moves.)

The fix is one implementation called from three places: `createStage` frames both cameras as it builds,
`setView2D` re-frames on every switch, and a `ResizeObserver` on the canvas catches a device-pixel-ratio
change or a fullscreen toggle. `resize()` deliberately does not touch `camera.zoom`, so a resize cannot
throw away the caller's view — which is what makes framing on every switch safe rather than annoying.
**AND THE FRAME IS THE VISIBLE BOX, NOT THE CANVAS.** The panels are DOM overlays floating ON TOP of the
canvas, so a floor centred on the canvas is centred UNDER the HUD. Reported from use: *"the board seems to
be centralised to the screen, but it hasn't taken into account that the left hand dialog changes the
visible board to the right hand side."* The frame is now computed from the canvas MINUS the strips the
panels cover (`scene.ts`: `visibleBox` then `frame`), and the floor is centred on the middle of what is
left, on BOTH cameras. The flat view gets an asymmetric frustum whose centre carries the visible box's own
offset, and it is fitted to that box, so a panel can be what decides the SCALE on a canvas where the width
is the tighter axis. The 3D view — the one on screen at startup — is moved by a LENS SHIFT
(`camera.setViewOffset`), which shifts the projection and leaves the camera exactly where it is: a moved
camera and target would be re-applied on every resize and would throw away whatever the caller had orbited
to, while a view offset can simply be recomputed. The same rule fits the 3D DISTANCE to the tighter axis,
which the old fixed `9.84` did not — it cropped **0.8 units off each side** of the floor on a canvas taller
than it is wide. The distance is only recomputed until the caller first touches the 3D view; the shift is
not gated that way, because it moves nothing the caller owns.

MEASURED in section 4 of `poc/tools/view2d-probe.mjs`, with the negative control being the old framing: on
1600×900 behind a 432 px panel the floor's centre lands at **1016.0 px**, the middle of the 1160 px that is
left, where framing against the canvas alone puts it at **800.0 px** — **216 px of the board's middle under
the panel**. The 3D camera's lens shift moves the picture by exactly that offset (1016.0 − 800.0 = 216.0 px
to 1e-6) and moves the camera not at all. The panel's width is MEASURED rather than assumed (`main.ts` reads
`#hud`'s own box, with a `ResizeObserver` on it, because the HUD is content-sized — 320 px at its narrowest
and 780 px in the instance editor), and the inset is capped at 45% of the canvas: past that the panel is most
of the window, there is no visible region left to centre in, and a frame that kept shrinking would draw the
floor a few pixels wide. The **axis labels are sized as a fraction of the floor's half-width**
(`AXIS_LABEL_FRAC`) — they were a constant written for a 20-unit floor and on the 8-unit one read as a
headline, reported as *"The axis text is much larger than it needs to be."*

**PAN AND ZOOM DID NOTHING IN 2D BECAUSE THE FLAT VIEW HAD NO CONTROLS AT ALL.** OrbitControls binds to
ONE camera object for its whole life, so `setView2D` had been switching the single control set OFF — and
simply enabling it in 2D would not have worked either, because that set drives the 3D camera: the pan and
dolly would have gone to the camera that was not on screen. There is now a second control set for
`camera2d`, with `enableRotate = false` (a top-down view that can be tilted is not a 2D view) and the LEFT
button re-mapped from ROTATE to PAN, which is not cosmetic: with rotation disabled the default mapping
leaves the first gesture anyone tries doing nothing at all. `Stage.controls` is no longer EXPORTED,
replaced by `setControlsEnabled`/`updateControls` that act on whichever view is on screen — the mistake
that produced this bug was a caller reaching for "the" controls, so the interface no longer offers one to
reach for.

**THE ZOOM AND PAN ARE BOUNDED, AND BOTH BOUNDS ARE ARGUMENTS RATHER THAN TASTE.** An orthographic frustum
of zero width has no inverse, so an unbounded dolly ends in a blank screen: 0.2× to 20×, which still frames
the whole floor at the wide end. The pan bound is the floor's half-width plus the visible half-span on that
axis, so the board's edge can always be brought to the screen's edge and the board can never be pushed off
with no gesture that brings it back. THE FIRST VERSION USED ONE SYMMETRIC LIMIT AND THE PROBE MEASURED IT
TOO TIGHT: `node poc/tools/view2d-probe.mjs` found the floor's edge stopping **0.571** of a screen-half
short of the side edge on a 21:9 canvas, because a limit derived from the VERTICAL half-span is
conservative horizontally by exactly the aspect ratio. Per axis, the edge now lands on the viewport edge to
**1.7e-14** across 80 clamped positions at five zooms and four canvas shapes, with a strip of floor always
visible.

**AND THE CONTROLS ARE MEASURED, NOT MERELY CONFIGURED**, because every claim above is about what three.js
does with these settings: the probe drives three's OWN OrbitControls through a fake canvas. A left drag of
100×50 px pans the view centre by 2.444×1.222 units — the orthographic pan scale, to 1e-6 — the camera
stays directly overhead (y = 40 to twelve decimal places, which is OrbitControls' own polar clamp rather
than a coincidence), the offset from the target is preserved so a pan is a pan and not a tilt, a wheel
changes the ZOOM ONLY with the camera left in place, and the clamps land exactly on 0.2 and 20 with an
invertible projection matrix.

**THE HANDLES DID NOT FOLLOW THE MOVE SELECTION, AND THAT IS THE THIRD BUG OF THIS SHAPE.** Selecting
another move in the strip re-rendered the strip and re-focused the trail highlight, but `renderHandles`
was called only from `renderInstance` — so the tile and the highlight described the new move while the
gizmo sat on the PREVIOUS move's control points. The trail-focus bug and the `registerUserFormations` bug
before it were the same fault: one thing that says "this is what is being edited" was updated and another
was not.

The fix is structural rather than local. `syncTrailFocus` is now `syncStageSelection` and draws the
handles itself, so the trail focus and the gizmo are ONE step: they are the same instruction to the stage,
and either alone is a board that disagrees with the panel. `renderInstance` calls it, `selectMove` calls
it, and `renderMoveStrip`'s own index clamp is covered because both of its call sites sync after it.

**AND THE FAULT CLASS IS NOW CHECKED IN THE SOURCE, WITH A NEGATIVE CONTROL.**
`node poc/tools/stage-sync-probe.mjs` parses `editor-ui.ts`, finds every method that writes the move
index, the travel/facing kind or the dancer set (or calls the strip renderer), and requires each to reach
the stage sync — either directly, or through `renderInstance`/`commit`. Two rules and one exemption: a
`render*` method may touch the selection because every caller of a renderer must itself sync, which the
second rule enforces. It reports the eight methods that qualify and passes. THEN IT IS SHOWN TO FAIL: the
same analysis runs over a copy of the source with `selectMove`'s sync call removed — the code as it was —
and it flags exactly `selectMove`. A structural check that cannot fail on the bug it was written for is
decoration, and this one is labelled as what it is: a check on the SOURCE, not a measurement of behaviour,
because the wiring fault is invisible to every engine harness and this sandbox cannot drive the browser.

**THE CLONE'S WALK-IN IS FORCED, SO "USE VALUES THAT WILL MATCH" HAD TO BE ANSWERED BY MEASUREMENT RATHER
THAN BY THE SOLVER.** The report came in three parts: after a `connect`, selecting several dancers did not
open the bezier edit although they "look the same"; then that the walk-ins the connect creates "for
opposites seem to match, but not dancers at other angles"; then the hypothesis that it "sounds like a
precision issue" and "the compare is too strict perhaps". `poc/tools/connect-assign-probe.mjs` answers all
three over every one of the 134 start formations, and the answers are not what any of us guessed.

The walk-in CANNOT be one shared move, and that is a proof rather than an opinion: the clone keeps the
ancestor's END formation and every move after the first is dancer-local, so the walk-in must carry *this*
dancer from *its* new start pose to exactly the pose the ancestor's own track resumes from. The probe
searches for an assignment of dancers to the new formation's spots that makes all eight walk-ins the same
local move - trying every spot for the first dancer and requiring the rest to match - and finds **none, on
any of the 134 targets**, not to 1e-9 and not to within the gate's windows. The values are the geometry.

What the geometry gives for free is the OPPOSITE pairs, and that is the reported symptom exactly: the
ancestor's own first boundary is point-symmetric, so a pair of dancers 180deg apart walks in identically.
MEASURED: 504 of the accepted walk-in pairs are 180deg apart against 76 at any other angle. A 90deg pair
would need the boundary to be 4-fold symmetric, and it is not: the source's own first move gives four
dancers a 0.59 step and the other four a 0.5 step plus a 45.15deg turn, and the boundary set is 4-fold
symmetric only to about a tenth of a unit. So a caller selecting a head and a side is looking at two
walk-ins whose PATHS are identical and whose TURNS are 45deg apart.

AND IT IS NOT PRECISION IN THE SENSE OF FLOATING POINT, but the report's own follow-up turned out to be
right about the WINDOW, and that needed a witness to settle. Measured over `ms/circle.xml` against every
formation: of the 570 walk-in pairs the gate accepts, the largest difference any of them has is 3.06e-3
units, and the smallest travel difference it refuses is 0.0561 units = 2.3px - so nothing there was being
refused on the last decimals. THEN THE WITNESS ARRIVED: "All 4 Couples Promenade Full" | Clone | Start From
the formation made from the END of "Right and Left Grand" (its "Grand Circle 3") | Connect | select dancers 1
and 3 | and the panel says so itself - "coordinates locked: dancer 1 and dancer 3 do not move alike here -
their curves are 0.0141 units apart". Reproduced exactly (`clone-refusal-probe.mjs`, which takes the target
formation from the end of a named call, because that is how the caller made it): the two straight connectors
differ by **0.0142 units, which is 0.58 px**, and the window was 0.01 units (0.4 px). The window was the
fault, by a hair.

SO THE WINDOW IS NOW ONE PIXEL, AND THE FIGURE IS MEASURED RATHER THAN ARGUED. `clone-refusal-probe.mjs
--sweep` walks every call in a sample against every formation the picker offers - 12248 refused walk-in pairs
- and bands the gap between the two curves at the probe's own 40.91 px per unit (a scale for the counts: the
window it bands against is in BOARD UNITS and does not move when the floor resizes): **232 refusals rest on a
difference under half a pixel, and the next smallest is 2 px**, with NOTHING at all between 0.5 and 2 px. The
window may sit anywhere in that empty band and the same refusals are made; at one pixel (0.025 units) it
opens the 232 and the witness and refuses nothing else in the corpus. It is also measured **along the curves**
now instead of on the control points: a Bezier is a convex combination of its control points, so equal control
points mean equal curves - but the converse fails, and a control point can differ by more than the curves do,
which is how the same straight segment written as an ease-in and as a constant-speed line was refused while
both trace the same line. The facing window stays at half a degree, where the refusals start at 3.15deg.

WHAT WAS ACTUALLY WRONG IS THAT THE GATE ASKED ABOUT THE WRONG CURVE. A Move-tab field writes
`translate.<attr>` and a Facing-tab field writes `rotate.<attr>`, so the question is whether THAT curve
agrees across the selection; asking about both is a strictly stronger condition on a write that touches
one, and it locked tabs whose own numbers were unanimous. Of the walk-in pairs the gate refuses, **76 have
identical travel curves (0.0000 units apart) and are refused on the facing alone** - the trails on the
board are the same shape and the Move tab was locked anyway, which is the literal "they look the same" -
and **242 face identically and are refused on the travel alone**, locking the Facing tab on a pair a
facing edit cannot collapse. **64 of the 134 targets have at least one such pair.** The gate, the field
locks, the board handles, the arc checkbox and the drag path are now all keyed on the curve in hand, and
the lock note gives the difference in that curve's own units - board units for the path, degrees for the
facing - instead of the old note's distance between the two curves *where they lie on the floor*, which is
dominated by how far apart the dancers stand: two dancers doing the same move two units apart reported a
2-unit disagreement that was not about the move at all. `coords-gate-probe.mjs` was updated to model the
per-curve gate it now describes, and the new probe carries the checks.

**A MOVE'S END FACING IS THE FRAME THE NEXT MOVE IS PLAYED IN, AND THE REPORT THAT IT SHOULD NOT BE WAS
WRONG - INCLUDING MINE.** "Adjusting the end of the facing curve alters the direction of the rest of the
trace. This shouldn't happen. The facing curve should only affect the direction the dancer is facing for the
duration of the move." So it was measured before it was touched, and the measurement has three parts, all
of them exact (`poc/tools/facing-chain-probe.mjs`): a facing edit writes no translation, so the position the
move itself ends on is bit-identical; the heading it ends on moves by the whole edit; and EVERY LATER
BOUNDARY POSE of the call is the old one RIGIDLY ROTATED about that pose by exactly that angle - agreement
to 2.8e-15 units, every later heading turned by the same amount, the drawn trace of every later move swung
by the same 10deg, and the call's end 0.417 units across the floor.

Then the reference, because a measurement says what happens and only the format says what SHOULD happen:
taminations composes a dancer's moves as `tx = tx * it.translate(); tx = tx * it.rotate();` per movement and
carries the frame forward (`taminations-flutter/lib/math/path.dart`, `Path.recalculate`, and the in-progress
movement as `tx * m.translate(bv) * m.rotate(bv)`). A trajectory is authored in the dancer's own frame, so
the heading a move ends on IS the frame the next move is played in; the trail and the animation agree by
construction because they are the same composition, and a facing edit is a REAL edit whose end formation
turns with it. The caller's follow-up settled it: "yes, I think it's all correct. My misunderstanding."

WHAT WAS BUILT FIRST AND THEN DELETED, because the honest version of this story is that I had started
implementing the request: `setMoveFacing`, an engine mutator that set the facing curve and turned the moves
after it BACK by the change in the end heading, so the facings turned and every later POSITION stayed where
it was (measured: trace bit-identical to 3.1e-15, later headings still turned by the whole 10deg, invertible
to one ulp). It was wired into the panel, gated in the harness and measured by the probe - and when the
caller said the swing was correct after all, it was removed rather than left switched off, because a
mutator nothing calls is a decision waiting to be made by accident. What stayed is the measurement: the
probe keeps the numbers and the reference quote together, `engine/test/editor.mjs` 19 pins the same numbers
in the headless suite ("whichever of us is tempted to 'fix' the swing has to come here and delete a
measurement first"), and the Facing tab says on screen that turning r3 swings the rest of the trace.

The one thing the episode did change is that the panel no longer lets the two readings be confused: the tab
used to say only that r3 "sets the heading the move ends on", which reads as a local tweak. It now says
that the heading is the frame the next move is played in, that the rest of the trace turns with it, and
that this is what the move means rather than a drawing error.

**A CREATED CALL NOW NAMES ITS START FORMATION, AND A CALLER-MADE FORMATION CAN BE ADDED TO THE CORPUS.**
Asked for: "in the Browse Calls, allow the created end formations to be added to the corpus, so that created
calls that start from it export xml with a formation reference rather than an embedded [formation]". The
corpus's own tams have always named their start - `<tam title="Circle Four Left 1/4" from="Facing Couples"
formation="Facing Couples">`, no geometry - and every tam the EDITOR wrote embedded a `<formation>` block
instead. For a created call that is not a matter of style: the point of labelling a formation from a call's
end is that other calls start from it, and an embedded copy puts the shape in every one of those files, so
editing the formation reaches none of them.

TWO HALVES, AND THE SECOND IS THE ONE THAT WAS ACTUALLY MISSING. `callToXml` grew a reference mode - it
writes `formation="Name"` and no block, with the embedded block still the DEFAULT so that every existing
caller and the round-trip gate are untouched - and `CallLibrary` now resolves a `formation="Name"`
reference against the formations `registerFormation` has added as well as against `formations.xml`.
Without that second half a reference to a caller-made shape simply died with `No formation "…"`, because
`loadVariants` parsed the corpus text and nothing else: the export would have been written and then failed
to load in the very app that wrote it.

THE ORDER THEN MATTERS, and it was already wrong. A call is BUILT when it is registered, and the library
does not retry, so `SequencerUi` was registering the whole catalogue at construction and only THEN
registering the caller's formations - which would have made every saved call that names its own start
formation fail to build. The formations now go in first, at both construction sites, including the level
change that rebuilds the library from scratch.

THE GUARD, because a reference that is nearly right is worse than a repeated block: `startsFromFormation`
compares the named formation's dancers with the call's start INDEX FOR INDEX - a tam's paths are paired
with the formation's dancers by POSITION, so a call whose dancers merely occupy the same spots in another
order would hand each of them somebody else's path - and the gender at each spot is part of it, because
that arrangement is what the gender gates read. `callToXmlNamed` is the decision the app calls: a
reference only when the name RESOLVES and the shape matches, the block otherwise.

ON THE APP SIDE it is one flag, one button and one helper. `UserFormation.inCorpus` is the CALLER'S
ASSERTION that the shape is in `formations.xml` - a browser cannot write the file, so the **add to corpus**
button in the Browse panel sets the flag and puts the `<formation>` block on the clipboard in the same
click, and the legend says plainly that a call naming it loads only in this browser until the block is
pasted. `poc/src/tam-xml.ts` is the one place that answers what a name resolves to, and every place that
writes a `<tam>` goes through it: the editor's saved instance, its copy-xml button, its generated setup and
the catalogue's sequencer registration, because one of them embedding while another referenced would be the
same class of fault as the stage-sync bug.

GATED: `engine/test/editor.mjs` 20 measures the reference export, the resolution against a registered
formation, the `No formation` guard, the three fallbacks to the block (no such name, a permuted shape, a
swapped arrangement) and the tolerance the exporter's own rounding needs; `poc/tools/formation-ref-probe.mjs`
checks the wiring in the source and is SHOWN TO FAIL on two patched copies - a direct `callToXml` call, and
the calls registered before the formations.

**THE EDITOR NOW HAS A LEVEL SELECTOR, AND IT IS THE SAME CONTROL THE OTHER SCREENS CARRY.** Asked for as a
"Programme selector e.g. MS, SSD, A1 etc under the Mode element, MS by default", and then named: "call it
Level, like the other screens". So it is a `<select>` directly under **Mode**, filled from the loaded
catalogue's own level list rather than a hard-coded one, with **All levels** among the options — the level
decides what the three call lists *offer* and must never put the rest of the catalogue out of reach. The
default is MS, and the default is CHECKED rather than assigned: a `<select>` ignores a value it holds no
option for, so setting `'ms'` blindly would have left the first option selected and the default a lie.

The panel needed this more than the other two screens did. Its three lists (edit, post, pre) were the whole
catalogue — several thousand `<tam>` entries whose level was only a prefix in the label — and the panel
therefore opened on whatever call happens to sort first, which is not a choice anybody made.

**AND THE PREFIX WENT WITH IT.** "You can remove the level text from the start of the Edit Call name", the
caller said next, and that is the other half of the same idea: `MS · Circle Left` existed to tell the levels
apart while one list held all of them, and the selector now states the level once, above the list, instead
of every entry repeating it. The entries carry the call TITLE alone; the `All levels` listing is still
sorted by level, so the grouping is visible in the order even where it is no longer written down.

**THE RULE THAT MAKES IT SAFE IS THE ONE THE FIND BOX ALREADY HAD.** The level is applied inside
`fillCallSelect`, the single function that builds a call list and the only thing the three selects are
filled from, so no list can be narrowed differently from another. It is a **view**: the call you already
have selected is still re-inserted (marked `▸`) when the level excludes it, and the level handler
re-narrows the lists WITHOUT reloading the instance — the one thing a selector here must not do, because
replacing the selected call would discard an edit in progress. The readout names the level whenever the
level is doing any of the narrowing (`MS · 137 of 4821 calls`), so a short list always says why, and the
level and the Find box AND together.

GATED by `poc/tools/editor-level-probe.mjs`, which is labelled as what it is — a check on the SOURCE,
because this is DOM code no engine harness can run and the sandbox cannot drive the browser: it checks the
row under Mode, the MS default against the catalogue's own level order and asset directory, `All levels`,
the filter living inside `fillCallSelect`, the title-only label, the pinned selection, all three lists being
filled from that one function, and the handler that re-narrows without reloading — then runs the same
analysis over five deliberately broken copies (the filter line removed, the default assignment removed, the
handler reloading the instance, the pinned option dropped, the level prefix put back) and requires each to
fail. `tsc -p poc --noEmit` clean, all eleven POC probes green.

**A HUD LABEL IS 44px WIDE, WHICH IS A COLUMN FOR A FIELD NAME AND NOT FOR A SENTENCE.** Reported: the
**Hide dancers** and **2D icons** text was reflowing although the row had room for it on one line. The cause
is one rule — `#hud label { width: 44px }`, the fixed column that lines up the names of the controls beside
them — applied to labels that are a checkbox and its own prose. A fixed width cannot do anything about a
sentence except decide where it breaks, so both wrapped. The same rule was breaking **Full square (mirror)**
in the browse panel, which nobody had reported.

The labels that contain a checkbox now size to their content and are not allowed to break
(`#hud label:has(input[type="checkbox"])`). `:has()` rather than a class on purpose: the rule is about what
the label CONTAINS, so the next checkbox label added to the HUD inherits it instead of having to be told.
Recorded honestly as the one change here that is NOT gated: a probe could assert that the rule's text is
present, which is a different claim from "the sentence fits on one line", and this sandbox cannot render a
page to check the second one. The instrument for that is the caller's eye.

**A CLONE IS NOT A MODE, WHICH IS WHY THE PANEL WAS SO QUIET ABOUT ONE.** Asked for: "make it more obvious
that a clone of a call is being worked on". Clicking Clone sets one flag, `asClone`, and that flag changes
exactly one thing - what Save does, an ADDITION instead of a replacement - while everything else on the panel
looks identical: the Clone button went back to looking unclicked and the Save button still said "Save". A
clone in hand with a button saying "Save" is a caller about to overwrite the setup they meant to copy.

So the state is now written in three places at once: a blue **CLONE** bar over the table naming the call and
the setup that is left as it is (and saying **Reset** goes back to editing that one), the Save button reading
**Save as new setup**, and the HUD's own edge taking the same blue - the amber palette was already taken by
"track incomplete", and blue is what this panel uses for what is being edited. One function writes all of it
(`renderCloneChrome`), because the alternative is the fault this panel has now produced three times: a method
changes state and a second view of it is not updated.

THE CLONE BUTTON IS DISABLED WHILE A CLONE IS IN HAND, and that is the one behavioural change rather than a
label. `doClone` RELOADS the catalogue instance, so pressing it a second time silently discarded the
re-based start and every move edit made since - a destructive button that looked like it was offering to
help. Its tooltip now says so, and the way back is Reset, which the bar names.

GATED by `poc/tools/clone-chrome-probe.mjs`, in the shape `stage-sync-probe.mjs` established: it parses the
class and requires every method that writes `asClone` (`loadInstance`, `doClone`, `doStartFormation`) to
reach the chrome, directly or through `renderInstance`; that the Save button's label has exactly ONE writer,
which is the chrome; and that the chrome asks the MODE, because the Save button lives outside the instance
panel and is shared with Fix and Create - so the label cannot outlive the clone it described. It then puts
two of those faults back - `doClone`'s own chrome pass removed (which is how the code was, and is the button
a caller actually presses) and the mode handler's pass removed - and requires each to fail. `tsc` clean, all
twelve POC probes green.

**THE END OF A TRACK CAN NOW BE RE-BASED ONTO A NAMED FORMATION, AND THE PAIRING IS THE HARD PART.** Asked
for: "Add an option to select a different end formation and Connect a last move to the new end point. How can
the interface handle formations with different indexes to the end positions. I may connect the end of the
dance path to the wrong formation point. Need a solution to change the auto-selected endpoint."

The panel gets an **End setup** picker and a **Connect end** button, mirroring the start's. `Connect end`
re-aims the LAST move of every dancer at its spot of that formation, one dancer at a time through the engine's
own `setDancerEnd`, which holds the beats and the hands: the call is not re-timed and no earlier move
changes.

THE ANSWER TO "DIFFERENT INDEXES" IS THAT A SPOT NUMBER IS NOT A CORRESPONDENCE, and the number says how
badly that would go: sweeping every call in the ms level against all 134 formations the picker offers (2278
pairings, `poc/tools/end-pair-probe.mjs`), index-for-index agrees with the geometric correspondence for **64
of them (2.8%)**, and where it disagrees it sends a dancer up to **11.57 units** from the spot the geometry
assigns. A formation's spot `j` is wherever ITS file wrote its j-th dancer, and nothing ties that to the
caller's dancer `j`. So the pairing is derived with the engine's own `deriveFormationMapping` - eight whole-set
rotations about the origin plus a centring translation, then the best 1:1 assignment on position and facing -
exactly as the start re-base does, and it is always a bijection over the spots.

AND THE PAIRING HAD A BUG THE MEASUREMENT FOUND RATHER THAN THE EYE. A formation's genders are its
ARRANGEMENT, and the geometric correspondence ignored them: over the same sweep, the geometry alone put a
dancer on a spot the formation declares for the OTHER gender in **1770 of 2278 pairings** (8840 spots - 77.7%,
worst case 8 of 8 dancers on an "Alamo Wave"). The shape would look right and the setup would be a different
one, which is precisely the "wrong formation point" the request was worried about. `deriveFormationMapping`
gained an opt-in `preferGender`: pass 0 offers only spots whose declared gender is the dancer's own, pass 1
over what is left makes the assignment TOTAL when the counts cannot line up - the two passes
`assignStartSlots` has always used at the start of a track. OFF BY DEFAULT, so every existing caller is
unchanged (the harness measures that erasing the genders changes no unflagged pairing), and the panel turns
it on: 8840 mismatched spots become 0.

THE OVERRIDE IS THE FEATURE, so it is a first-class control rather than an emergency hatch: beneath the End
setup row, one picker per dancer shows `dancer -> spot` with the spot's gender, coordinates and heading, and
choosing a spot another dancer holds SWAPS the two - eight independent choices could put two dancers on one
spot and leave another empty, and the permutation is what "the call finishes on this formation" means. The
association is DATA once the caller sets it (an override is kept and wins) and DERIVED while they have not,
and the derived one is NOT stored: it is recomputed from the instance's own start poses, so it cannot go stale
when a start, a gender or a move changes underneath it. MEASURED: an overridden dancer lands on the spot it
was pointed at to 2.4e-14, every other dancer's end moves by exactly 0.0, and every earlier move of the two
swapped dancers is bit-identical.

THE GAP IS RE-MEASURED, NEVER REMEMBERED. Re-aiming the FIRST move re-frames everything after it, so an end
that was connected stops being on target the moment the start is connected - the note under the End setup row
therefore prints the distance on every render, and the Start Connect's status says outright that the end moved
with the frame. When the call is on its end target and its ends differ from the catalogue's, the drift note
reads **end re-based** instead of `track incomplete`, and that is decided by measurement too: a flag would
have gone stale on the next edit.

TWO THINGS WERE FOUND WHILE MEASURING, AND NEITHER IS THE CONNECT'S FAULT. (a) `correctEndTo`, the engine's
whole-set route, DERIVES its own correspondence from the target it is handed, so it cannot carry an explicit
pairing at all: of 24 applied pairings it keeps the one it was given 5 times, diverging by up to 6.50 units
elsewhere - which is why an override has to go through the per-dancer mutator, and why the probe checks the
two routes against each other where they DO agree (0.00e+0). (b) A FORMATION'S NAME IS NOT STABLE AT 1e-14
RADIANS: adding 1e-14 rad to every heading of a formation's own board - a rotation by nothing - changes the
name for 5 of the 16 formations the curated read can name (`Quarter Lines RH` -> `Quarter Lines LH` and
friends), because their headings sit on the +/-pi branch cut. The connect's end board differs from the target
by ~3e-15 rad, so a raw name comparison would be testing that knife edge; the probe snaps headings before
comparing (48 of 48 named targets read back correctly) and reports the instability separately. Recorded as an
open item in `PLAN.md`: it affects the Browse panel's end-formation read too, and a fix means finding the
comparison that decides RH from LH and giving it a tolerance.

GATED by `poc/tools/end-pair-probe.mjs` (the sweep above, the bijection, the two routes, the override's
exactness and isolation, the recogniser read-back, the arrangement count, and the knife edge, with a negative
control that pairs by index and shows a different end board) and by `engine/test/editor.mjs` section 21 (the
flag off is the old behaviour bit for bit; the flag on leaves no mismatched spot; the assignment stays a
bijection and stays TOTAL when the counts do not line up; a different dancer count still throws). `verify:light`
green at 12 harnesses, `tsc` clean, all thirteen POC probes green.

**THE END OF A CURVE IS NOW A HANDLE, AND IT HOLDS THE DIRECTION THE DANCER LEAVES ON.** Asked for: "Add a
drag point for the end of a curve. This also requires adjusting the bezier controls to ensure the control for
this curve is aligned with the next control to preserve dancer direction. If there is a facing override, this
must also be managed to preserve the direction of travel to the next curve." And then: "I think there will
need to be a button to flip between controls and end points as the control can sit on top of the end point
making it difficult to use both at the same time."

THE MECHANISM IS ONE LINE OF `poseFor`: the move's end point is `p3`, and the heading it ends on - the frame
the NEXT move is played in - is `bezierAngle(rotate ?? translate, 1)`, the direction of the tangent at `t = 1`,
which for a cubic is exactly `p3 - p2`. Moving `p3` alone therefore changes the destination AND the frame,
and the rest of the track swings. `moveCurveEnd` holds the exit handle VECTOR - `p2` moves with `p3` - so the
tangent is the same tangent and the frame is the same frame, translated.

MEASURED OVER THE WHOLE ms LEVEL (884 moves with something after them, `poc/tools/move-end-probe.mjs`): a
plain drag turns the exit direction by a MEDIAN of 26.9deg and by more than 1deg in ALL 884 (worst 138.8deg);
with the hold, by at most 2.5e-14deg, and every later boundary is the old one CARRIED - same headings, same
shape, moved by the distance the end point moved (worst error 1.9e-15). That is the whole request: the dancer
lands where it was put and the rest of the dance keeps doing what it did.

AND THE FACING OVERRIDE IS A DIFFERENT MECHANISM, which is why the request separates it. With a facing curve
the heading comes from the ROTATION curve, so the tail is carried whether or not the handle is held - what the
hold protects there is the DIRECTION OF TRAVEL, and all 622 of the moves that carry one would otherwise set
off in a different direction. Without a facing curve the tangent IS the heading, so the hold is what stops the
track turning at all (262 moves, worst 98.5deg without it). Both cases are pinned in `engine/test/editor.mjs`
section 22, each with its own negative control, because a single "the tail moved" check would have been TRUE
of the facing case for the wrong reason.

THE FIRST VERSION OF THE RULE WAS WRONG AND THE SWEEP FOUND IT, not the eye. It skipped the hold when the exit
handle was the zero vector, on the reasoning that there is no direction to preserve there. There IS something
to preserve: `atan2(0, 0)` is 0, so the curve reports a heading, and leaving `p2` behind INVENTS a tangent
where there was none. 144 of the 884 movable moves have a zero-length exit handle, and every one of them
turned - up to 35deg of tail swing - under a guard that was supposed to be handling exactly that case. Holding
the zero vector keeps the curve degenerate and the heading exactly as it was.

THE HANDLE TOGGLE is the second half of the request, and the overlap it solves is measured rather than
imagined: over all 9994 resolved segments of the 542 catalog calls, 5.5% have their two control points EXACTLY
coincident (a `Stand`, or any curve whose controls collapse onto the dancer's own spot) and 24.8% have them
distinct but closer than the pick radius, where the nearest-wins tie is meaningless and one dot cannot be
grabbed (`poc/tools/handle-pick-probe.mjs`, which had already recorded that limitation). The tile's
`controls / ends` button swaps which set the board draws - `c1`/`c2` or the end point `c3` on the Move tab,
`r1`/`r2` or the end `r3` on Facing - so only one of the overlapping dots is ever live.

GATED by `engine/test/editor.mjs` section 22 (both facing cases with their own negative controls, the carried
tail, the degenerate exit, and the corpus count that makes the degenerate case impossible to dismiss) and by
`poc/tools/move-end-probe.mjs` (the 884-move sweep, the facing split, the negative control, and the source
wiring of the toggle and the drag). `verify:light` green at 12 harnesses, `tsc` clean, all fourteen POC probes
green.

**THE FLAT VIEW'S PERPENDICULARITY IS ENFORCED ON THE CAMERA, NOT CONFIGURED ON THE CONTROLS.** Reported: "in
2d mode, the drag board must not rotate on the x and y, only drag, keeping the board perpendicular to the
camera. Currently the drag rotates the dance floor."

THE CONFIGURATION ALREADY SAID THIS COULD NOT HAPPEN, and that is why re-reading it was not the answer:
`controls2d.enableRotate = false`, and every mouse button mapped to PAN or DOLLY, with a comment on each
saying why. The report was not reproducible by reading, so the guarantee was moved off the input and onto the
thing the claim is about - the CAMERA. `squareCamera2D` puts the flat camera directly over its target with the
board's +y up the screen, and it runs (a) at the end of `updateControls`, i.e. after OrbitControls have had
their say, so it is the LAST WORD on the camera each frame, and (b) on the way into the flat view, so the
first frame of 2D is overhead too. The pan clamp was changed to move the TARGET rather than the camera - the
comment there used to say "this is a clamp on where you are looking, not a tilt", and it is now structurally
true: ONE function writes the flat camera's position.

THE FAULT IS REPRODUCED RATHER THAN DESCRIBED. `poc/tools/view2d-probe.mjs` section 6 drives real
OrbitControls through the fake canvas with rotation ALLOWED - the configuration the report implies - and
measures the camera **49.49deg** off straight-down after a left drag; the same drag with the frame's squaring
applied ends at **exactly 0.0e+0deg**, and the without-the-rule case is the negative control, so the check
cannot be decoration. Five wiring checks pin the rule in the frame loop, the view switch, the pan clamp and
the touch mapping.

AND THE TOUCH MAPPING WAS A REAL GAP FOUND ON THE WAY: OrbitControls maps ONE finger to ROTATE by default, so
with rotation disabled a one-finger drag in the flat view did NOTHING AT ALL - the "pan and zoom do nothing in
2D" report over again, for anyone on a touchscreen. `touches = { ONE: PAN, TWO: DOLLY_PAN }` now, the same
re-mapping the left button already had. `tsc` clean, all fifteen POC probes green.

**BULK DANCER PICKS ABOVE THE TABLE, AND `matching` IS THE GATE ASKED THE OTHER WAY ROUND.** Asked for:
"Above the formation table, add dancer selectors for none, all, boys, girls and matching to make selecting
dancers more efficient. The matching selector will select all dancers that match the currently selected
Move(s) that can be edited together, if the currently selected Moves are already editable."

AND `boys` AND `girls` ARE PHASED. Asked for as: "Add new phase to the boys and girls Select buttons so that it
first selects all boys, then the first and third, then the second and fourth. These tend to match the matching
transformed paths in the different formations." Each click advances its own button through ALL of that gender,
then the ODD positions among them (1st, 3rd, ...), then the EVEN ones (2nd, 4th, ...); the label carries the
phase (`boys`, `boys 1·3`, `boys 2·4`) and the tooltip names both halves with their dancer numbers. The order is
the table's own `#` column - the dancer array the caller counts on screen - NOT the formation's identity, since
array position is the renderer's binding rather than an identity. A PHASE THAT WOULD SELECT NOBODY IS SKIPPED,
because a call with one boy has nothing at "the second and fourth" and landing on an empty set would clear
every tick and leave the panel saying edits have nowhere to go; the cycle therefore runs over the phases that
HAVE a pick rather than over the numbers 0, 1, 2. The phase is the button's own state rather than the
selection's, so hand ticks between clicks do not lose the caller's place, and `loadInstance` puts it back to 0.

AND THE REASON FOR WANTING IT HOLDS UP, which is why it was worth building. MEASURED
(`poc/tools/select-row-probe.mjs`, 76 (call, gender) sets over 38 eight-dancer calls of the ms level, move 1's
travel curve, each list measured against its OWN first dancer exactly as `matching` does): the whole gender
shares that path in 49 of 76, while the odd half does in 75 of 76 and the even half in 75 of 76 - and of the 27
sets whose whole gender does NOT share it, 26 have a half that does. So the phase selects a set the fields will
accept where "all boys" would have been refused. The probe also pins that the two phases PARTITION that gender
in all 76 sets: nobody dropped, nobody counted twice. VERIFIED IN THE BROWSER (Chromium against poc/dist, a
6-dancer call whose boys are rows 1, 3, 4, 6): `boys` -> `boys 1·3` -> `boys 2·4` -> `boys` selected [1,4],
[3,6], [1,3,4,6], and the girls cycled [2], [5], [2,5].
AND THE TICKS HAVE A TWO-DANCER ACTION: `⇄`, in the header cell of the formation table directly over the tick
column. Asked for as "Add a small button above the dancer select column that is normally greyed out and disabled
unless two dancers are selected. With two dancers selected, the button will switch the selected dancers. Use a
button icon something like a double ended arrow to indicate switch or swap." DISABLED UNLESS EXACTLY TWO, and
that is the whole of its safety rather than a nicety: a swap is symmetric and needs two operands, and any other
count has no defined answer - one dancer has nothing to swap with, and three would need an order the ticks do not
carry. Greyed out rather than hidden, so the column says what the ticks are for before there are enough of them;
the tooltip names the two dancers it would switch, since "which two" is the one thing a button with nothing
written on it cannot say for itself.

WHAT MOVES IS DECIDED BY HOW A PATH IS STORED. A path is authored in the dancer's OWN frame (+X is its initial
facing, P0 its own origin - `setDancerStart`), so the version that leaves a coherent board is the whole ENTRY
trading places: start pose, path, gender and the half-set mirror flag, in one engine call (`swapDancers`), with
the panel not restating which fields move. MEASURED (`poc/tools/swap-dancers-probe.mjs`, every pair of every
ms-level call that builds, 448 pairs): the two entries trade field for field and nobody else moves; the MULTISET
OF WORLD TRACKS is identical before and after, so the board is the same dance relabelled rather than redrawn; the
genders travel with their tracks; it is an INVOLUTION (swapping back restores the call exactly to the byte) and
COMMUTATIVE; the beat clock is untouched, the multiset of paths being the same; swapping a dancer with itself is
the identity, and an index outside the set is refused out loud. `id`/`couple` are deliberately NOT copied across:
`assignHomeIdentity` DERIVES the home identity from where a dancer stands, so swapping the poses swaps them.

THE NEGATIVE CONTROL IS THE CHEAPER EDIT THIS COULD HAVE BEEN: swapping the PATHS ALONE, one `setDancerPath` per
side. At 308 of the 448 pairs that draws a DIFFERENT board - the worst pose moving 12.008 units - because each
path is then re-framed by the other dancer's start pose. Without that measurement, "move the whole entry" would
be a preference rather than a finding. VERIFIED IN THE BROWSER (Chromium against poc/dist, ms _Finish Line of 6
Half Tag): the button is disabled with one dancer ticked and with three, enabled with exactly two, and its
tooltip names them; pressing it swapped dancers 3 and 6 (0.75,-0.5,180 <-> -0.75,0.5,0) with the status line
"dancer 3 and dancer 6 switched", left every other row alone, kept the keyboard focus on the button through the
re-render, and pressing it again put every dancer back exactly as it was.
AND THE SELECTION IS MARKED ON THE BOARD, asked for as "Highlight mismatched paths after selection" and "Outline
the dancers currently selected ... on the board." TWO MARKS, DRAWN FROM ONE CALL (`Browser.setSelection`, so they
cannot describe two different selections). A RING around every dancer an edit applies to - a circle on the floor,
0.7 units of radius against couples that stand 2 apart - drawn as a SCENE child placed from the pose rather than a
child of the avatar group, which is what makes it work in BOTH representations: a 3D avatar is a figure and a 2D
marker is a flat shape, and their only shared property is where the dancer is standing. It is deliberately NOT tied
to "Hide dancers", which is about the BODIES, while the ring is a mark on the floor saying which spots the edits
reach. And a RED TRACK for every dancer whose curve at the move being edited does NOT match the selection's, built
with `sameCurve` - the gate itself - so the reds and the locked fields are two readings of one fact rather than two
opinions. A warned track is drawn at FULL OPACITY (the normal trail is 0.55 and a dimmed one 0.45), which is what
keeps it distinguishable from couple 1's own red, and it is KEPT ON SCREEN WHEN ANOTHER DANCER IS FOCUSED, because
the mismatch is the reason the caller is looking at the board and the focus must not hide the answer.
`setTrailWarning` is reversible, and `setActive` clears both marks when the editor leaves the screen.

AND THE LOCK NAMES ITS OWN WAY OUT. The coordinate fields already lock when the selection disagrees; the note
under them now says the paths are marked in red, that the dancers the edits apply to are ringed, and the two things
that resolve it: the link beside a dancer (which clones the reference's whole trace onto it) or selecting one
dancer, which is what the lock is for. THE LINK WAS RELAXED TO MAKE THAT ROUTE REAL - it used to require the whole
selection to already agree, which is exactly the state in which a caller cannot use it, and it is now offered on
every dancer whose trace is not the reference's, including a selected one that disagrees.
A row of five buttons - `none`, `all`, `boys`, `girls`, `matching` - sits above the table, next to the
per-dancer ticks in its first column. `all`/`boys`/`girls` read the data and are the sets a caller reaches for;
`matching` is the one with a question in it, and it is answered with THE GATE'S OWN COMPARISON rather than a
second definition of "the same move": `matchingDancers` builds its set with `sameCurve` (a half-pixel of
movement along the travel curve, half a degree of turn for the facing), so the set it picks is a set the
fields accept, BY CONSTRUCTION. The reference is the lowest selected dancer's move at the selected index -
the dancer whose values the tile is showing - and the curve is the tab's, because that is what an edit writes.

MEASURED OVER THE ms LEVEL (`poc/tools/select-row-probe.mjs`, 2032 classes): **no pair inside any class is
refused by the gate**, and the value of the feature is not marginal - EVERY group has a class bigger than the
dancer it started from, the mean class is **3.65** dancers (a move is usually done by halves: four heads, four
sides), and 104 of the 1016 travel groups are all eight. The measurement has a control of its own: widen the
travel window from 0.025 to 4 units and **72 pairs** inside a class would be refused, so "the sets are
editable together" is a property of the gate's window and not of the grouping.

`matching` IS REFUSED UNLESS THE CURRENT SELECTION ALREADY AGREES, which is the rule as asked for - it widens
a set that can be edited together, and it is not a way to select a disagreeing one. The button is disabled and
WHY is in its tooltip; when it is available it carries the count (`matching (4)`) and the tooltip says what it
would pick ("4 of the 8 dancers share this path with dancer 3 - click to select them").

AND THE EXPLANATION IS A HOVER, NOT A LINE OF TEXT, which was the caller's next correction: the row printed a
sentence about what `matching` was looking at, and "it's just distracting. Move it to a hover over." One line
of prose between the buttons and the table is read once and read past on every render afterwards, so the same
sentence now lives on the button it is about, the span it used to fill is DELETED rather than hidden, and the
probe requires both (`this.selMatchBtn.title = ` present, no `edSelInfo` anywhere) - a request to remove
something is as checkable as a request to add it.

`none` MAKES AN EMPTY SELECTION A LEGAL STATE, and that is a change to an invariant this panel asserted
everywhere: the set used to be impossible to empty, on the grounds that a panel showing a move with no dancer
selected is not a state anybody can read. `none` is exactly that state, so it had to be made readable rather
than forbidden - the strip shows "no dancers selected" where the moves would be, the coordinate gate refuses
so the fields lock rather than stay live, `+ Move`/`- Move` are disabled, no handles are drawn, no chip is
drawn as the focus, and `commitMoveChange` refuses ANY write with nothing selected (including the beats and
hands writes the coordinate gate never covered), because a field that accepts a number and writes it to
nobody is the silent no-op this panel refuses everywhere else. GATED by `poc/tools/select-row-probe.mjs` -
the pairwise-gate sweep, the class-size measurement, seven wiring checks and two negative controls (the
empty-selection guard removed from the write path, and the window widened until the classes stop agreeing).
`tsc` clean, all sixteen POC probes green.

**THE CENTRE OF AN ARC IS A HANDLE, AND THE THREE THINGS ASKED OF IT CANNOT ALL HOLD.** Asked for: "When in
the end of curve drag mode, and the curve closely represents an arc or a circle, provide another drag point
that represent the center of the circle. Dragging this will keep the radius the same and rotate around the
curves start point. Care must be taken to maintain the dancers direction in transition from the previous
curve, including the facing curve."

THE GEOMETRY DECIDES THE ARGUMENT, and it is one line: a circular arc through a fixed start with a fixed
ENTRY TANGENT has its centre already determined - `r` along the normal - so if the arc also rotates rigidly
about its start, its entry tangent rotates with it. "Rotate about the start", "keep the radius" and "keep the
arrival direction" are therefore three constraints on two freedoms. The caller's own sentence says which one
matters ("care must be taken to maintain the dancers direction"), so that is the one the rule holds: the end
and the exit control rotate about the start and THE START HANDLE DOES NOT TURN, because the direction the
dancer arrives with IS that handle's direction.

"CLOSELY AN ARC" IS A FIT, and the fit is exact where it matters: `fitCircle` takes the two end tangents and
finds where their perpendiculars MEET - one linear solve, no search - then measures the curve against that
circle and refuses it if it strays too far. A straight walk has parallel perpendiculars and no centre at all,
which is the honest answer rather than a circle of infinite radius. MEASURED over the ms level's 1016 travel
curves (`engine/test/editor.mjs` 23): 222 have a centre, 134 are arcs by the panel's 2%, the worst real arc
deviates 1.47e-2 of its radius and the closest curve that is NOT one deviates 1.55e-1 - ELEVEN TIMES further
out - so 2% sits in an empty band rather than being a judgement call. The fit is validated against the number
the project already knew: a constructed quarter arc fits with relDev 2.72e-4, the same constant section 17
pins for the best cubic through a quarter circle, and its sweep IS the turn it makes to 1.9e-14deg over the
corpus. An ELLIPTICAL quarter is refused (relDev 1.00): this is a circle fit, and the quarter-arc lock
(`arcOf`) is deliberately a different test, because the lock is about both handles keeping their directions.

MEASURED, WHAT THE SWING HOLDS AND WHAT IT COSTS (`poc/tools/arc-centre-probe.mjs`, every arc x ten swing
angles): the entry tangent changes by **0.0e+0deg**, the FACING curve is bit-identical (not merely close), the
pose the move starts from does not move at all, and the END keeps its distance from the start to **8.9e-16** -
the radius of the swing, held exactly, because the swing is a rigid rotation of the end about the start. The
cost is measured too: the FITTED circle gives, up to 0.94 of the radius off its best fit at a half turn, and
for wide swings the curve is not a circle at all any more. So the handle is drawn from the BASE circle rotated
by the angle applied so far WHILE the gesture runs (the drag measures from the curve captured at pointerdown,
so a drag is a rotation of a fixed curve rather than a compounding one) - a dot that vanished from under the
pointer mid-drag would read as the gesture having failed rather than as the arc having been swung past what a
circle describes.

AND WHAT THE SWING DOES TO THE NEXT MOVE IS MEASURED BOTH WAYS, because the engine has two cases: with a
facing curve the heading is AUTHORED, so the swing holds the heading the move finishes on and CARRIES the rest
of the trace (all 98 arcs that have one), while with no facing curve the exit tangent IS the heading, so the
swing re-aims it - up to 34.4deg at the angle measured - which is what swinging an arc is FOR. The negative
control is the fault the request names: turning the start handle with the rest (a rigid rotation of the whole
curve) breaks the joint by the whole swing angle, 34.4deg. GATED by `engine/test/editor.mjs` 23 and
`poc/tools/arc-centre-probe.mjs`. `verify:light` green at 12 harnesses, `tsc` clean, all seventeen POC probes
green.





**THE SWING IS NOW A RIGID ROTATION, WHICH IS WHAT MAKES IT AN ARC.** The caller's next correction: "When
dragging the center of the arc, the start control point isnt adjusted to maintain the arc shape." That is the
right fix and it REPLACES the rule above, because the two messages cannot both be satisfied by this curve
alone: the start control point IS the direction the dancer arrives with, and on an arc that direction is
perpendicular to the radius - so turning the arc turns the joint, and holding the joint is exactly what stops
the curve being an arc. `swingArcAboutStart` now rotates every control and the endpoint about the start, so
the arc, its radius and its sweep are preserved EXACTLY (measured: shape 3.1e-16, radius 2.0e-15 of itself,
start pose 0.0), and the end swings by exactly the chord of the angle.

THE JOINT IS KEPT BY TURNING THE PREVIOUS MOVE'S DEPARTURE, and by freezing its HEADING CHANGE so the frame
does not rotate. Both halves are load-bearing: turning the exit keeps the dancer's path tangent-continuous
(the corner at the joint moves by 1e-10deg over the corpus, against 137deg without it), while freezing the
heading keeps the swing VISIBLE - and that second half is measured as its own dead end, because the obvious
version of "absorb the turn in the previous move's facing" is a gesture that does NOTHING: turn that move's
facing by -theta and leave its path alone, and the frame rotates by the swing angle while the arc rotates
back, leaving the arc's end within 1.3e-15 units of where it started, across the whole corpus. So the facing
absorbs the FRAME rather than the arc: a facing curve is written only where the previous move had none, as a
copy of its original travel curve - the heading profile it already had - and the previous move's own start and
finish never move.

AND ONE CASE CANNOT FOLLOW, reported rather than papered over: 22 of the 134 arc-ish moves in the ms level
follow a move whose exit handle has collapsed onto its endpoint, where `bezierAngle` reads `atan2(0, 0) = 0` -
a convention, not a direction. There is nothing to turn, and inventing a direction would deform a move
authored to arrive with nothing left to travel (`hasExitDirection` is the engine's name for the test), so that
move is left EXACTLY alone and the panel's status line says the joint kept the angle it had. `verify:light`
green at 12 harnesses, `tsc` clean, all seventeen POC probes green.

==================================================================================================
A WYSIWYG PATH EDITOR: what the corpus says the interface has to express (measured)
==================================================================================================

Asked for, as the bigger picture behind the editing work: "an intuitive mechanism to edit the dance path
through a wysiwyg interface. Many of the paths are circular (so this has to be easy to achieve), and the
dancers moves must start and end at fixed points (defined by a formation). There should be an easy way to make
the dancer face the right direction." That is three claims about the CORPUS, so they are measured rather than
designed around. `poc/tools/wysiwyg-path-probe.mjs` reads EVERY level and EVERY <tam> variant - 4754
eight-dancer variants, 94544 dancer-moves - because the ms level alone is 66 files of which 17 build as
eight-dancer setups, and the picker's unit is the VARIANT, not the file.

A CIRCULAR MOVE IS ALWAYS A QUARTER. 10884 of 94544 travel curves (11.5%) lie on a circle to within 2% of its
radius; their sweeps run from 10.1deg to 90.0deg with a median of exactly 90deg, and 89.1% sweep the full
quarter. So the panel's quarter lock is the right shape for the unit it locks. The lock would be ENABLED for
22930 curves (24.3%, blocked otherwise on 55642 non-perpendicular handle pairs and 15752 curves with no
handle length), and 0 curves in the corpus is ALREADY the quarter arc `arcOf` describes - so ticking the box
is always a projection and never a no-op.

BUT AN ORBIT IS A CHAIN, and the panel has no object for one. Because no single move turns more than 90deg, a
dancer going round is NECESSARILY several moves: 4589 runs of two or more consecutive moves lie on ONE circle
to within 2% of its radius, across 207 variants (4.4%). Sweeps: median 270.3deg, max 765.1deg; 4141 over a
quarter, 3503 over half, 2814 over three quarters, 652 over a full turn; 1162 span three or more moves. The
densest are ms/circle.xml and b1/circle.xml - a whole 360deg `Circle Left` as EIGHT moves of 45deg at radius
2.59 - and plus/spin_chain_and_exchange_the_gears.xml. Nothing in the panel holds the radius across such a
chain or notices when a move stops matching its neighbours.

JOINTS ARE BOTH PINNED AND FREE, in bulk. Over 132356 joints, 82.2% land on a spot the picker offers and
95401 of those carry that spot's declared heading, so a formation can pin position AND facing. Of the 57460
INTERIOR joints, 67.2% are on a catalogue spot and 32.8% are on no spot at all. So neither "snap every joint
to a formation" nor "free points only" describes the corpus.

AND A JOINT IS USUALLY ALREADY SMOOTH. Over 51180 interior joints the direction is measured as a CHORD of the
real world path immediately either side - not from `bezierAngle` plus a frame, which assumes the frame does
not rotate during a move and a facing curve makes it rotate: median corner 0.06deg, 83.7% within 1deg, max
180deg. Split by mechanism, 93.3% of joints after a move with NO facing curve are within 1deg against 68.6% of
those after one WITH a facing curve. Both mechanisms are real - handles lining up, and a facing curve turning
the dancer - which is why the facing channel cannot be folded into the travel tangent.

THE FIRST DRAFT OF THE PROBE WAS WRONG IN A WAY WORTH KEEPING. It asked `arcOf` whether the circle-fitting
curves were quarter arcs by handing it the whole `Seg` instead of `seg.translate`; `arcOf` then read
`undefined` for all six coordinates and returned a NaN object for everything, so the report was "10884 of
10884 agree" - a perfect agreement produced entirely by handing the instrument the wrong argument. The
corrected reading is 0 of 10884, and the probe now CHECKS THAT THE TWO TESTS DISAGREE, so the same mistake
cannot pass silently again.

`verify:engine` for the arc-swing commit 48628d3: 23 harnesses, all green, 947.9s (slowest determinism-audit
515.8s).

AND THE FACING CHANNEL IS NOT DECORATION. Over 89132 poses sampled at the middle of every move, facing is a
median of 0.0deg off the direction of travel and 62.2% are forward within 10deg - but 2.3% are BACKWARD and
3.5% are SIDEWAYS, so 37.8% are more than 10deg off. A single direction per point, which is what most path
editors have (the tangent), cannot express this corpus at all: a `Wheel` is a dancer walking backwards on
purpose, and the second channel is why the format can say so.

AND THE STORED LOCAL FORM IS AN EXACT RESTATEMENT OF THE WORLD PATH, which is the premise the "edit in world
space" design rests on and it is checkable. The prediction - world position = start pose + R(heading) . local
curve, and world heading = start heading + local angle profile - is checked against `poseFor` AS WRITTEN (which
composes transforms, so agreement is a test rather than a restatement): over 1037564 samples the position
agrees to 7.2e-15 units and the heading to 4.1e-13deg. So the two spaces carry the same information, a joint
can be dragged in world space with the local numbers recomputed, and the local form stays where it belongs - as
the reusable library format, which is why `moves.xml` works across formations at all.

AND TWO PRIMITIVES THE PANEL OFFERS TODAY ARE DEGRADED, measured in part 7. A HOLD is stored as an ordinary
move whose travel curve has ZERO LENGTH - 5192 of 94544 moves - and 0 of them has zero beats, so a hold always
costs beats and the TIMING channel cannot be used to spot one; only the geometry can. 15778 moves additionally
end with the exit handle collapsed onto the endpoint, so their departure has no direction to turn. And the ARC
LOCK can never be a no-op: it is enabled for 22930 curves and projecting moves the endpoint on 100% of them -
median 0.4% of the curve's own chord, which is why it feels like a snap, but 1128 of them move more than a
whole unit, worst 8.85. So the box always deforms and the size of the deformation is not visible beforehand.

THE "DOES THIS CALL CROSS ANOTHER FORMATION" FLAG IS BUILDABLE, BUT ONLY WITH A PERSISTENCE RULE - and that is
the user's own suggestion, measured. Asked for: "more advanced calls are often a common combination of smaller
calls, something like a module, and will therefore have points within the call that cross a formation... there
might be a flag to say whether a call contains other formations and identify which beats it lands on (these
could be automatically suggested by searching along the call for recognised formations)." It is, and the
measurement says the naive version is unusable while the persistent one is precise.

`poc/tools/call-formations-probe.mjs` walks every call beat by beat asking the engine's own recogniser what
formation the eight dancers are in. The naive scan reports 31.9% of calls crossing an interior formation =
3276 spans - and 3238 of those are a SINGLE SAMPLE at a 0.5-beat step, the recogniser catching a board
momentarily near a formation while the dancers pass through it. Requiring the formation to be HELD for 2 beats
collapses it to 31 spans in 17 calls (0.4% of the corpus). Checked rather than assumed: at a step EIGHT TIMES
finer, 19 of those 31 survive and the longest is 4.13 beats, while 40 control calls that produced only
transients produce 624 interior spans of which 0 are held. 75.6% of interior spans begin on a move boundary.
The held list is short and specific - Alamo Wave, Ocean Waves, Thar RH/LH Boys, Circle, Columns, Diamonds,
Normal Lines Compact - with beat ranges, e.g. b2/swing_thru.xml holds Alamo Wave for beats 6.50-10.00 of 10.40.

TWO INSTRUMENT BUGS HAD TO BE FIXED FIRST, and both are recorded because each produced a confident wrong
number. The control is "the call's own start formation must be recognised at beat 0", and it first read 27.8%.
(1) A tam with no `from` carries a RUN OF SPACES, and a whitespace string is TRUTHY - so every such call was
counted as declaring a from and then failed the comparison. (2) `from` IS NOT THE FORMATION. As the user put
it: "the tam elements 'formation' property is the real formation a call uses and the 'from' property is more of
a label for the user... the 'from' property is often used to label an embedded formation, or to provide an
alternative name for the 'formation' property." The engine agrees - `convert.ts:324` builds the dancers from
`tam.formationAttr` - so comparing a recognised name against `from` compares it against free text. Comparing
against the attribute gives 2299 of 2299 (100.0%). A third limit: 2113 tams name a formation the picker does
not carry, so the recogniser can only ever name the 134 eight-dancer formations it knows.

THE RUN-LEVEL CIRCLE IS BUILT (fields first; the bulge drag is still to come). The engine gains
`circleThrough(a, b, radius, side)` - the whole parameterisation, since a circular arc has five numbers and
pinning both endpoints spends four, leaving ONE continuous choice (the radius) and ONE discrete one (which side
of the chord the centre falls on), with both end headings DERIVED because an arc's tangent is perpendicular to
its radius - plus `fitCircleRun`, `setRunCircle`, `runCircleCount`'s `runCircleMoveCount` and `RUN_ARC_MAX`.

`setRunCircle` lays a run on the arc and keeps the run's move count, beats and hands. THE FRAMES MOVE WITH THE
REWRITE, so they are recomputed as it is written: the frame's position is the sub-arc's own start, and its
heading advances by the FACING channel's rule, so an authored turn survives and a missing facing curve keeps
meaning "walk the way you are going". Facing curves are never written. THE RADIUS IS SNAPPED TO WHERE THE RUN
STARTS, so the start does not move by construction - which is what lets a run be re-laid on its own
least-squares fit, since a fit does not put the sampled points exactly on its circle (ms/circle.xml fits at
radius 2.595 with its start 2.597 from the centre); the one thing it costs is the end.

THE TURN IS SPREAD IN PROPORTION TO BEATS, so a 45deg Circle Left move stays a 45deg move. And a turn a move
cannot carry in quarters is REFUSED, per the decision taken, naming the move and the angle: measured over the
corpus, of 10884 circle-fitting travel curves NONE sweeps past 90.0deg, and past a quarter the cubic leaves the
circle (2.7e-2 of the radius at a semicircle against 2.7e-4 at a quarter).

Gated in `engine/test/editor.mjs` 25 - start moves 0.0, heading 0.0, the end by no more than the fit was
already out, the re-fit 1.4e-5 of the radius against a 2e-2 tolerance, the turn spread by beats to 1.6e-15 rad,
joints within 4.6e-2deg, everything outside the run bit-for-bit untouched, and 116 of 116 moves keeping whether
they had a facing curve. Both refusals are built deliberately rather than hoped for. A real bug in the refusal
message went with it: `DEG` is PI/180 in this engine, so `rad * DEG` reported a 120deg turn as "0.0deg".

THE PANEL'S GROUP RULE IS NOT THE ENGINE'S: the engine takes one circle per dancer, the panel has ONE RADIUS TO
SHARE, because eight dancers circling a centre start and finish in eight different places. Measured in
`poc/tools/run-circle-probe.mjs`: 6 of 6 whole-call runs took a single shared radius for all eight, hit to
3.8e-3 of itself, every start moving 0.0. The probe also covers the run that CLOSES ON ITSELF - the 360deg
orbit, whose chord is a point so `circleThrough` has no answer and the CENTRE is the only thing left to keep -
and finds a case where the engine must refuse: a full turn over beats [1.5, 3, 3, 1.5] asks the middle move for
120deg.

In the panel: a `to` move, a `radius`, a side toggle and "make circle" on the selected move's tile, with
shift-click in the strip setting the run end and the run drawn as part of the selection so the range is visible
before it is applied.

THE RUN-LEVEL CIRCLE DESTROYED THE FLAGSHIP CASE, and a caller found it: "The Make Circle button seems to
completely collapse the trace. After pressing all I see is a single drag point and no trace line." It was real.
TWO POINTS ON A CIRCLE ADMIT TWO ARCS AND THE ENDPOINTS DO NOT SAY WHICH; `circleThrough` returned the minor one
always, and for a near-closed orbit the minor arc is nothing. Measured over the ms level, 48 of 527 runs lost
most of their length: `ms/circle.xml` is a 360deg `Circle Left` whose ends are 0.055 apart on a radius of 2.595,
so the minor arc between them is 1.22deg and a 16.34-unit orbit became 0.06. The missing quantity is the one SVG
calls `large-arc-flag`, and the run itself supplies it.

THE RULE IS NOW TWO BRANCHES, and the split is the whole of the fix. A run that ALREADY HAS A CENTRE keeps it -
only the radius and the turn move - because the centre is the circle's identity and a near-closed chord cannot
say which side it falls on. A run that is NOT a circle has no centre to keep, so the ENDS are the anchor and the
radius and side are what the caller supplies; that is the case the "both ends are kept exactly" property belongs
to. `circleThrough` takes an optional `turn` for the no-fit path - the sweep is the value CONGRUENT to the ends'
base angle that is NEAREST the turn given, so a 270deg turn through ends 90deg apart comes back as 270 and not
as the -90deg arc - and `runTurn` is the summed per-move turn that always exists when `fitCircleRun` says no.
Re-measured (`poc/tools/run-circle-probe.mjs` section 6, which is the regression gate): 1125 runs, worst keeps
98.6% of its path, turn moves by 5.5e-3deg.

AND A SECOND, MILDER FAULT CAME OUT OF THE SAME MEASUREMENT: `fitCircleRun` accepted runs it had no business
accepting. A RELATIVE TOLERANCE ALONE IS NOT ENOUGH - a straight run sits inside any relative tolerance on a
huge enough circle. `ms/grand_spin.xml` has two moves that go STRAIGHT (runTurn 0.00deg) and Kasa fitted them as
a circle of radius 28.23 at relDev 1.6e-2, just inside the default; re-laying that run moved its end 0.73 units
and cost it 12% of its length. `RUN_FIT_MAX_DEV` bounds the worst deviation against the run's OWN LENGTH too,
and the corpus separates cleanly: of 2253 accepted run fits the two bad ones sit at 29.9% and 14.7% of the path
length and the worst that SHOULD be kept is 3.8%, so any threshold between them decides every run the same way.
With it, the worst survivor keeps 98.6% instead of 87.6%.

THE RUN-LEVEL CIRCLE NOW CARRIES A CENTRE. Reported after the collapse was fixed: "The Circle left call starting
from Circle has a trace that is an offset circle. I want to select all the moves, create the circle and then put
the center of the circle at the origin (or where i drag the circle center to)." The witness is ms/circle.xml's
`Circle Left` from a `Circle` (tam #1): its dancers stand on a ring of radius 2.613 about the origin and walk an
orbit of radius 2.595 whose centre is 1.013 units off it - a DIFFERENT direction for each dancer, because the
authored offset lives in the dancer's own frame. A radius cannot correct that; the orbit is the right size in the
wrong place.

A NAMED CENTRE NEEDS NO RADIUS, and that is the point rather than a convenience: the run's START is pinned, so
|start - centre| IS the radius - which means moving the centre while the start stays put can only resize, and
"put the centre here" is therefore the right gesture for an orbit rather than a translation. The centre is
SHARED across the selection (the radius is not: it follows from each dancer's own ends), and naming a radius
clears a named centre and vice versa, because they are two ways to drive the same two degrees of freedom.

MEASURED (`poc/tools/run-circle-probe.mjs` section 7), naming the origin on that call with no radius given:
every orbit's centre goes from 1.013 off the origin to 1.7e-7, each radius lands on 2.613 - its own start
distance, so nothing was chosen - no dancer's start moves at all (0.0), and the turn changes by 8.0e-8deg so it
still closes. Panel: `centre x`, `centre y`, an `origin` button and a `clear`, in a group of their own so they
wrap. A DRAG of the centre on the board is the intended next gesture and is NOT built yet.

A FULL SET OF PATHS AGAINST A HALF-SET FORMATION WOULD NOT LOAD. Reported: "The create circle is not preserving
the half set as I get this error after applying create circle and apply to live: Path count mismatch for Circle
Left: 8 paths vs 4 dancers". Reproduced exactly: `Circle` in formations.xml authors FOUR dancers, the tam builds
to eight by mirroring, the editor's export names it (`formation="Circle"`) and carries EIGHT paths - and
`buildCallImpl` threw before it ever mirrored, because it paired paths against the AUTHORED four and mirrored
afterwards.

THE WRITER AND THE READER DISAGREED AND ONLY THE WRITER WAS TESTED. `poc/src/tam-xml.ts` mirrors a four-dancer
formation to eight before comparing and says why: "because that is what `buildCallImpl` does with a four-dancer
formation before pairing paths". It did not. So the reference was one the reader could never resolve, and the
gate could not see it because section 20 asserts the written XML CONTAINS `formation="NAME"` and resolves it
against a REGISTERED EIGHT-dancer formation - it never went near the half-set case. A gate on the text of an
export is not a gate on the export.

Fixed in `convert.ts`: when a tam carries twice as many paths as the formation authors dancers, the half is
MATERIALISED to a whole set BEFORE pairing. `materialiseFull` places the duplicate rather than flagging it -
`mirrorToFull` keeps the base's (x,y) and lets `poseFor` negate at read time, which is right while ONE path is
replayed for both halves and wrong the moment each dancer has its OWN path, since the negation would land on top
of a start already placed. Mirroring is attempted and the counts re-checked rather than assumed, so a formation
that already contains its own antipodes stays whole.

Round-tripped: `formation="Circle"` with eight paths reads back with mirror=false AND mirror=true as eight
dancers, every start pose identical to 0.0, the orbit identical to 4.7e-5 (the export's four decimals), and no
dancer left carrying the mirror flag. The corpus is untouched - 5943 tams, still exactly 2 failures, both the
pre-existing "No formation T-Bone Couples" tams, and 4794 building to eight dancers. Gated in
`engine/test/editor.mjs` 27, which round-trips the tam rather than reading its text.

THE FACING DROPDOWN IN THE CALL EDITOR IS REMOVED. Asked for as: "The Facing selector is not required. It is
always auto selected." It was `#facing`, a `<select>` in the editor panel's footer beside "Hide dancers" and "2D
icons", offering "Rotation Bezier (data)" (the default) and "Along travel", read once by `Browser.render` and
handed to `allPoses` as the `HeadingMode`.

IT WAS REDUNDANT BECAUSE THE DATA ALREADY DECIDES, which is what "always auto selected" means: `poseFor` reads
each move's authored rotation Bezier and falls back to the travel tangent only where that move has NONE, so the
choice is made per move by the call itself and a global override could only contradict it. The `Along travel`
option was worse than redundant - it forces EVERY move to follow its tangent, which erases the deliberate
backwards walking in a `Wheel` (2.3% of the corpus's poses measured earlier) and is a different dance from the
one the file describes.

Only the control went: the engine still carries both modes (`HeadingMode`, `poseFor`'s third argument), so
nothing else that reads it changed. `browser.ts` now poses with `'rotation'` and `HeadingMode` is no longer
imported there. Gated in `poc/tools/editor-level-probe.mjs`, which already audits `index.html`: it checks that
no `#facing` selector remains AND that nothing reads `facingSelect` AND that the preview poses with the authored
reading - a control removed while something still reads a mode from it would be the same bug wearing a different
face - plus two mutations proving the check trips when the control is put back or the mode is read again.

THE SAVED LIST NOW READS `<start formation> -> <call> -> <end formation>`, AND A SETUP IS NAMED BY ITS FORMATION.
Asked for: "Under the Save button is the list of created calls. Currently they are only listed by the start
formation. But this makes it difficult to understand what they are. In this list, it should read <start
formation name> -> <call name> -> <end formation name>. The dropdown for the Setup should only use the Formation
name."

TWO OF THE THREE PARTS WERE NOT IN THE RECORD. A `CallEdit` stores its own `name` and its XML and nothing else,
so the call's title and the formation it finishes in are read back off the REBUILT call rather than copied into
the record, where they would go stale the moment the path was edited again. The end is asked of the same
recogniser the browse and sequence views name formations with (`nameBoard`, i.e. `knownFormation`). Measured
(`poc/tools/saved-label-probe.mjs`): 383 calls named at BOTH ends, 73% of them finishing in a DIFFERENT formation
from the one they start in - so the third part carries something the first one does not. The `kind`
(create/clone/fix/instance) moved to the row's tooltip, since the three parts are what the line is for, and a
saved edit that will not rebuild leaves its row rather than taking the panel down with it.

THE SETUP DROPDOWN NAMED SETUPS BY `from`, WHICH IS FREE TEXT FOR THE USER. `from` labels an EMBEDDED formation
or gives a named one an alternative name, and `buildCallImpl` resolves the dancers from `formationAttr` and never
from it - so the corpus writes `from="Lines"` for a tam whose formation is `Normal Lines`, and `from=""` for tams
that name themselves entirely through `formation`. `callMeta` now prefers the FORMATION with `from` as the
fallback (an embedded formation has no `formation` attribute, so its `from` is the only name there is). Measured
over ms/b1/a1/c2: 1876 of 2657 setups read differently, and 847 setups with a blank `from` are named by their
formation instead of collapsing to `(default)`. This is the engine's shared `callMeta`, so the browse view's
setup list changes with the editor's - which is the point, they are the same control.

EXPORT ALL, AND A CORRECTION TO THE PREVIOUS COMMIT. Asked for: "add an 'Export All' button that copies all the
created calls. Each tam should be inside a tamination element under its appropriate family title (this should
match the existing tamination). Add a filepath property to taminations, to make it easier to find the file to
update. Also add a type property that indicates either 'clone' or 'update'."

The button sits directly under the saved list and walks it, rebuilding EVERY edit rather than replaying `s.xml` -
only an instance or a clone carries XML, and a fix or a create is synthesized on demand, so replaying the stored
XML would have silently exported two thirds of the list. Each tam is wrapped in a `<tamination>` carrying the
file's OWN `<tamination title>` (measured: 553 of 554 call files carry one, in 486 distinct families) plus a
`filepath` built from the catalogue entry the edit came from - and the filepath is not decoration, because 63
families are shared by more than one file, so the title alone does not say which file to edit. The `type` is the
app's own distinction: `doSave` already calls fix/instance REPLACING and create/clone APPENDING, and the export
writes those as `update` and `clone`; the probe checks the two predicates are the same expression rather than two
opinions.

AND THE PREVIOUS COMMIT'S SETUP-LABEL FIX WAS MADE AT THE WRONG LAYER. `callMeta` was changed to prefer the
formation and the change was MEASURED on `callMeta`'s own output (1876 of 2657 differ) - but the Setup dropdown
does not read `callMeta` at all: `data.ts` walks the file itself, because it needs the tam INDICES as well as the
labels, and built each label from `tams[i].from` directly. So the engine read changed and the dropdown did not.
The precedence now lives in ONE exported function, `setupLabel`, used by both call sites, and
`poc/tools/saved-label-probe.mjs` measures it on the tams the dropdown is actually built from: 1249 of 1879
setups over ms/b1/a1 read differently from their `from`. The lesson is the one that keeps recurring here - an
instrument's silence is not a pass, and a measurement is only about the layer it was taken at.

Also adds `CallMeta.family` and `CallInfo.family` (the file's tamination title) and `parseTaminationTitle`, which
`Export All` needs to file each block correctly.

THE FACING CURVE'S HANDLES WERE DRAWN WITH THE WRONG ARM. Reported: "The bezier controls for the Facing curve
display the connecting lines for the end point incorrectly. It connects from the control point to the other
control point. It should connect to the end point."

A handle's line runs from its ANCHOR to its dot, so it is the ARM of the cubic - the segment from an END of the
curve out to one of its controls. The facing branch anchored its second control on `c1`, which drew
control-point-to-control-point: a line that is not part of the curve at all and says nothing about where the
dancer finishes, on the one shape whose whole meaning is where the dancer finishes facing. The travel branch had
it right all along (`anchor: p1`, the move's end pose), so the two shapes were drawn differently.

Fixed to `anchor: p3` - the facing curve's own end point, which is what the `end` handle mode already used.

NOTHING CHECKED THE DRAWN ARMS, which is why it survived: `facing-handle-probe.mjs` tests what a DRAG does to the
NUMBERS, and the numbers were always right. The picture was wrong and no probe looked at the picture. The probe
now checks all three facing arms and both travel arms, that no handle anywhere is anchored on a control point,
and carries a mutation putting the old anchor back to prove both facing checks go red.

A MATCH LINK IN THE FORMATION TABLE, WHICH CLONES A WHOLE TRACE. Asked for: "When Select: matching is pressed,
the dancers that match are selected. Add a link symbol next to the dancers that dont match, that will correct the
non-matching coordinates using the matching coodinates. Remove the link once they do match and select the now
matching dancer." - and then, after using it, as: "If I select one, I'd expect the paperclip symbol for the
another dancer to copy the correct dancers Moves and settings, with appropriate transforms, to the paper-clip
trace. It should clone a good trace to another dancer."

THE FIRST VERSION COPIED ONE CURVE OF ONE MOVE, AND THE PROBE THAT GATED IT COULD NOT FAIL. It copied the curve
the tab edits at the move on screen, and `match-link-probe.mjs` compared the result against the very curve it
was copied from - "the copy matches in 4632 of 4632" was a value being equal to itself. Three real faults sat
behind that green light: the write went straight to `setMove` and so bypassed `holdFollowingTrace`, leaving the
following trace swinging (the one fix every other facing write in the panel routes through); a reference with no
explicit facing had its TRANSLATION Bezier copied into the `rotate` slot, whose `cy1` the format has no
attribute for (`bezRotAttr` writes only cx3/cx4/cy4/x4/y4), so it survived on screen and not in the file; and
the link read the tab, which `renderInstance` can be one frame stale in - the table is drawn BEFORE
`renderMoveStrip` normalises a stale `moveKind`, so the link was offered for a FACING curve the panel was about
to stop editing while the `matching` button in the same frame used the corrected one.

IT NOW CLONES THE WHOLE PATH, AND ALL THREE FALL OUT OF THAT. `matchDancer` calls the engine's new
`setDancerPath` - every move at once, with its facing, its beats and its hands - and the link is offered on
`donor && !sameTrace(donor, this dancer)`, which reads neither the tab nor the move index. Nothing is
left downstream to swing, no curve is converted from one kind into another, and a whole-trace question has no
move index to be asked at. NO COORDINATE TRANSFORM IS NEEDED, which is what "appropriate transforms" means here:
a path is authored in the dancer's OWN frame, so the local frame IS the transform and the receiving dancer gets
the donor's motion relative to its own start. The start pose, the gender and the home identity are NOT copied -
those are the formation's, and moving one dancer onto another's spot is the Dancer scope's edit, not this one.

MEASURED (`poc/tools/match-link-probe.mjs`, 861 donor/target pairs over 178 files): the clone makes the traces
the same in 861 of 861, and the target's path is VALUE-EQUAL to the donor's in all of them. The mutation isolates
the old gesture: one curve of the move on screen leaves 568 of 861 (66%) still not the same trace. A third leg
exports each cloned call and reads it back, where the two traces are still identical in 33 of 33 - the leg that
catches a copy the format cannot carry, and one the old probe had no equivalent of. A copied coordinate does not
travel with the clone either: a `Seg` carries its copy as a key in the editor's `moveClips`, and `carryMoveClips`
pairs by position when the path length is unchanged, so `matchDancer` drops the target's entries for its new
segments - the same rule that stopped a delete carrying the removed move's point onto the move that took its
index.

EVERY EXPORT NOW CARRIES THE BUILD IT CAME FROM. Asked for: "add an xml comment at the top of the export
containing the web apps buildhash. This should give basic version control when importing them."

Both exports carry it - `Export <tam> XML` and `Export All` - as `<!-- exported by the dancing-squared web app:
commit 7ee29bf, built 2024-06-01 12:00Z -->`. The values are the ones `vite.config.ts` already injects for the
build footer (`__GIT_COMMIT_SHORT__`, `__GIT_DIRTY__`, `__BUILD_TIME__`), and the built bundle was checked to
contain the resolved hash rather than the placeholder.

THE DIRTY FLAG IS THE HALF THAT MATTERS MOST: a short hash identifies a COMMIT, and an export made from a working
tree with uncommitted changes corresponds to no commit at all - so the hash alone would be a version stamp that
is quietly wrong exactly when it is most needed.

A COMMENT RATHER THAN AN ELEMENT, because these blocks are pasted INTO a corpus file and an element would become
part of that file's data. A comment at the top of a document is legal; an invalid one is not, and `--` may not
appear inside a comment at all - so the probe checks the content contains none AND that a stamped export still
parses back as the same single <tam>. (The first version of that check tested the whole string, including the
`<!--` and `-->` delimiters, and failed on a perfectly good comment.)

AN Edit BUTTON ON EVERY USER-FORMATION ROW IN THE BROWSE TAB. Asked for: "On the Browse calls tab, add an Edit
button ager the del button that opens the selected call in the call Editor tab", clarified as being at "the end
of the row of buttons titled xml, In Corpus and del".

The request mixed a placement (that row) with a subject (the selected CALL, and a row is a FORMATION), so the
placement was confirmed before anything was built. It switches the MODE SELECTOR to the editor, opens the Edit
instance tab, and chooses the call and setup there - the same thing as clicking the two lists by hand, so a
caller who only wanted to look has changed nothing and Save is not offered for a call nobody touched.

A FORMATION NOW STORES THE callId AND setupIdx IT WAS MADE FROM, and it could not before: `origin` is display
text built from the two dropdowns' labels ("Circle Left (from Circle)") and cannot be resolved back to a
catalogue entry, so the button had nothing to open. Formations saved before this have no ids and fall back to
whatever the Browse tab has selected now.

And the editor CLEARS ITS OWN FILTER if it has to: its three lists are narrowed by the Level selector and the
Find box, and a formation can have come from a call the editor is not currently offering - so the button would
otherwise fail on a panel state the caller cannot see the connection to.

Gated in poc/tools/editor-level-probe.mjs, which checks the whole chain rather than the endpoints: the fourth
button's position in the row, the handler going through the host, the ids being stored at creation, the host
interface declaring the method, main.ts switching the MODE and not only calling through, and the editor loading
the call the way its own lists do - including that openCall edits NOTHING.

A load BUTTON BESIDE Edit ON EVERY USER-FORMATION ROW. Asked for: "Add a load before the edit button, the loads
the call into the Browse Call tab and sets the Level, Call and Setup according to the setup for the load
button." The row now runs xml / add to corpus / del / load / Edit.

THE ORDER IS THE INVARIANT RATHER THAN A DETAIL: `populateCalls` only offers the calls of the level the selector
names, so setting the Call before the Level would be choosing it from a list that does not contain it. The method
sets Level, repopulates, picks the Call, rebuilds the setups, picks the Setup and shows the call - the same order
`onLevelChange` uses, for the same reason - and a call the level does not offer is REPORTED rather than leaving
the panel on whatever was there before.

It is also the same three loads a click on the lists makes (`populateCalls`, `refreshSetups`, `loadCurrent`), so
this is not a second way to show a call.

AND THE TWO BUTTONS NOW SHARE ONE TARGET HELPER, so load and Edit cannot disagree about which call a formation
row means: the ids it was made from, or the current selection for formations stored before those were recorded.
Two of the probe's earlier checks had to be updated for that refactor - they were pinned to the inline expression
rather than to the rule, which is the same "gate on the text instead of the behaviour" trap this repo keeps
finding.

THE EDIT BUTTON LOST THE HALF-SET READING. Reported: "When editing a 4 dancer user defined formation, the Call
Editor doesnt open the correct call, it ends up being an 8 person equivalent" - pressing Edit on a user-defined
formation row in the Browse tab.

The Browse tab's `Full square (mirror)` box decides how many dancers a half-set <tam> has, and the editor had no
such control: `loadInstance` hardcoded `loadCall(id, tam, true)`. So a formation stored with the box OFF - a
FOUR-dancer shape - opened the EIGHT-dancer reading of its call, which is a different dance from the one the
caller was looking at. Measured over ms/b1/a1: 1396 of 1879 tams are authored as four dancers and become eight
under mirroring, so this is most of the corpus rather than a corner.

Before changing anything the engine helpers the editor leans on were run against a four-dancer instance -
instanceTable, endPoses, moveBeatRange, poseFor, analyzeFasr, deriveFormationMapping, callToXml, normalizeInstance
twice, addMove, setDancerStart, setStartFormation, closureDiscrepancy - and all of them are generic over
`call.dancers`, so the fix is to carry the state rather than to make the editor half-set aware.

A formation records `mirror` now; `openEditor` and `openCall` carry it; `loadInstance` uses it. Picking a call from
the editor's OWN lists still means the full square, which is what those lists have always meant. The `load` button
restores the mirror box too, since it restores the same thing. And opening a half-set instance SAYS so, because
four rows in a panel with no mirror control are otherwise unexplained.

Six of the probe's earlier checks had to be loosened for the widened signatures - they were pinned to the exact
parameter list rather than to the call, and two of them then matched the INTERFACE declaration instead of the
method body when `indexOf` found it first. Same trap as before: a gate on the text rather than the behaviour.

THE Full square (mirror) CHECKBOX IS REMOVED. Asked for: "The full square (mirror) checkbox is not required as it
should always be enabled."

It decided whether a half-set <tam> is built as four dancers or mirrored to eight, and a formation is half the set
it represents - so the whole set is the reading there is. The Browse tab loads the full square now, the editor
does the same by the same rule rather than by a flag carried between panels, and the `mirror` field a formation
stored is gone with it.

That removes the contradiction the previous two commits were circling: the checkbox built a FOUR-dancer board out
of a four-dancer tam, which is a shape the library never names (it holds whole sets) and a dance nobody asked for.
So the half-set reading I added in 611e5a8 is reverted - it was the wrong direction, and the "not named" report
was it showing through.

Everything is REMOVED rather than left switched on: the control, the EditorHost/EditorUI parameter that carried
its state, `onMirrorChange`, and the stored field.

AND THE PROBE'S FOUR CROSS-PANEL CHECKS ARE NOW SIGNATURE-AGNOSTIC, because they broke on three consecutive
commits by pinning the exact parameter list - `openEditor(t.callId, t.setupIdx, t.mirror)` and its friends. They
now match the call and stop at the arguments, which is what they were always about. The one place that genuinely
needs the signature is the body extraction, and that is anchored on the implementation rather than the interface
(`indexOf` finds the interface first, and it has no body).

A CLICK ON THE BOARD OPENS THE VIEW OPTIONS AS A DIALOG. Asked for: "A click release on the dance board, opens a
small dialog with the Hide Dancers checkbox and a 2D/3D selector (similar to 2d icons checkbox). Use Close button
when finished."

The two checkboxes moved out of the editor panel row and into a `position: fixed` dialog with a Close button. They
are REMOVED from the row rather than duplicated into the dialog, and the same ids and tooltips are kept, so
`applyViewOptions` is unchanged.

A RELEASE, NOT A PRESS, and that is the whole gesture: the same canvas carries the orbit controls and the handle
drags, so "opens on click" really means "does not open on a press that turned into a drag". The test is the
pointer's own travel (4 px) plus whether a HANDLE was under it - and that second test is taken at the PRESS rather
than read at the release, because the handle drag's own listener clears `dragHandle` on the same event and the
order the two listeners run in is not something to depend on.

It is EDITOR-SCOPED, like the options themselves: `applyViewOptions` releases them when another panel is on
screen, so offering the dialog elsewhere would be offering two controls that do nothing. It closes on leaving the
editor for the same reason.

Gated in poc/tools/editor-level-probe.mjs: the dialog's contents, that the panel row is emptied rather than
duplicated, `[hidden]` being restated against `display`, and the gesture's two halves.

THE FSM TAB PICKS ITS LEVEL, AND EVERY CALL IN A NODE'S TO AND FROM LISTS CAN BE OPENED. Asked for: "In the FSM
tab, provide a dropdown filter for Level. And provide a Load and Edit buttons that open 'Browse Calls' and 'Call
Editor' respectively", clarified as "This is for the list of to and from calls. Use a small icon", with an "all
levels" item and "default to MS".

The Level control used to be `Object.values(fsmAssets)[0]` - the first key the bundler happened to emit, which
draws the wrong level the moment a second asset exists. It is now a dropdown of the assets that HAVE been built
plus `All levels`, defaulting to MS, and All levels is the UNION of the tables rather than a concatenation: two
levels that share a state share its calls, and the same call landing the same way is one edge.

The two icons on a call row are small because there are up to 3922 of them: the FSM frame holds precomputed table
data and no catalogue, so a click ASKS the app (`parent.postMessage`, answered only when the message comes from
the FSM frame, since a `srcdoc` frame inherits this origin and any frame could post the same thing).

THE RESOLUTION IS THE WHOLE CONTENT OF THE BUTTONS, and it is deliberately not clever. An FSM edge names a call
TITLE and the FORMATION it leaves from; the app addresses a call by `(callId, setupIdx)`. MEASURED on the shipped
asset: 242 of 1961 edges name one of the call's setups exactly, and matching the state's GEOMETRY against each
setup's built start board instead reaches 447 of the 1408 edges that have a catalogue entry at all (32%), with the
closest setup 7 to 21 units away on a six-unit square for most of the rest - the FSM enumerates calls through the
applicator's tolerance and its coded moves, not through the catalogue's setups. So the setup is taken ONLY on an
exact name, everything else falls back to the call's first setup, and the panel says which setup it landed on. A
nearest-setup guess would have been wrong far more often than right, and silently so.

136 of those edges name a call the catalogue does not hold - 133 `Face Half`, 3 `Promenade`, applied by rule
rather than from a `<tam>` - and those report themselves in the FSM toolbar, which is the only thing visible over
the browse legend, instead of loading an unrelated call of a similar name.

Gated in poc/tools/fsm-open-probe.mjs: the resolution rule CALLED rather than read (node strips the types), every
edge of the real asset resolved, every resolved `(entry, setup)` built to confirm the index names a tam of that
call, the rendered document's own `nodedata` carrying the formation for all 3922 rows, the union and its dedupe,
the default, and the bridge.

One thing the probe measured on the way past, and did NOT change: 312 of the 1021 ms tams build to FOUR dancers,
because they list a half set that already contains its own antipodes and `mirrorToFull` leaves such a set alone.
That is the catalogue's own reading and the same whether a call is picked by hand or from the FSM - but a
four-dancer board is what the Load button would otherwise be blamed for.

THE FORMATION AT THE OTHER END OF AN FSM ROW IS NOW A LINK TO IT. Asked for: "make names of calls from and to the
selected node clickable, so that it makes it the selected node."

Each row is `call → <other end>` or `<other end> → call`, so the other end is the one name that is not the node
already selected, and it is now a span that selects it. The click goes through `selectOnly` - the SET-not-toggle
selection the drag release already uses - because a toggle would deselect the node that was just clicked when it
happened to be the selected one.

The index it carries is checked in the probe against the name the row displays: every one of the 3922 rows names a
state index whose label is the name in the sentence, or the link would select a different board from the one it
says. The row is no longer one text node for the same reason - the name has to be an element to be clickable.

AND IT WAS NOT THERE TO CLICK: "I dont see the Levels drop down filter that you built earlier." The filter was
built, drawn, and INVISIBLE - `#fsmPanel` is z-index 5 UNDER `#hud`'s 10, deliberately, so the mode selector stays
reachable from the FSM tab, and the HUD is anchored at the top LEFT of the viewport with a 320px minimum width.
The FSM toolbar was laid out from the left, which puts it exactly underneath the HUD - the Level label, the select
and the title, all painted behind a panel. Nothing in the app could have reported this: the DOM was right, the
element had a size, and only the two boxes' positions made it invisible.

The toolbar is now laid out from the right, which is the only side the HUD is never on, and it is given its own
background and rule so it reads as a toolbar rather than as loose text over the graph. The arithmetic is gated in
poc/tools/fsm-open-probe.mjs - that the HUD is above the panel and anchored left, and that the toolbar is
right-aligned - because it is a property of two boxes rather than of any code path.

THE CALLS THAT KEEP A ROUTE HOME ARE MARKED. Asked for: "If there is a 'route home' for the currently selected
node, highlight the calls from that support it."

A call FROM the selected node leads home when the formation it reaches can still get back to the squared set, and
that is the whole definition - so only the outgoing list carries the mark, and a node with no route home has no
marked call BY CONSTRUCTION rather than by a rule applied twice: an edge to a formation that can home would BE a
route home, which is exactly how the node's own status is computed. The mark is the green the graph already uses
for "route home", on the row's background and left edge, and the legend says what it means rather than a sentence
in the panel.

MEASURED, and it is the reason the mark is worth having: 93 of the 155 states have a route home, and of the 1961
calls from the listed nodes, 1576 lead home. On 24 of those nodes the mark is a strict subset - some calls take
the set somewhere with no way back - and on 69 every call leads home, where the mark covers the list and says
nothing. So it is informative exactly where a caller is choosing between calls, which is where a choice exists.

The probe rebuilds the route home from the emitted rows themselves and compares it with the flags the renderer put
there, so the highlight is checked against the graph rather than against the code that produces it; it also checks
that no incoming call carries the flag, and that the mark really is a subset where it should be.

THE FSM SIDEBAR IS DRAGGABLE, AND REMEMBERS ITS WIDTH. Asked for: "allow me to drag the width of the left hand
pane."

A 6px grip sits between the lists and the graph - the edge being dragged, rather than a handle floating in the
graph - and the drag takes the width from the pointer's own x with the pane's left edge removed. The pointer is
CAPTURED on the grip, so a fast drag that outruns the 6px bar does not stop resizing the moment the cursor
leaves it.

THE WIDTH IS STORED, and that is not a flourish: the frame is rebuilt whole on a level change and on every visit
to the FSM tab, so a width that only lived in the document would snap back to 300px at exactly the moment the
lists were the way the caller wanted them. It goes in localStorage, which a `srcdoc` frame shares with its parent
origin, and a double-click on the grip restores the default.

THE CLAMP IS ONE FUNCTION, INLINED INTO THE DOCUMENT. The emitted document cannot import from the app, so the
rule would otherwise exist twice - once as the code the probe can call and once as a string in the template - and
a rule in two places agrees only until one of them changes. The renderer inlines `clampSideWidth`'s own compiled
source, so the document runs the function the probe tests: not narrower than 180px, not wider than 80% of the
window, and a NON-FINITE width clamped to the minimum rather than left as `NaNpx`, which the browser ignores
silently while the drag looks like it is working.

AN AUDIT FOR CLEANER CODE, AND THE SIX REFACTORS IT PRODUCED. Asked for: "Analyse the codebase to see if there are
any areas for refactoring to have cleaner code", then "make small changes with regular commits and validation."

The audit was four passes (engine/src; poc/src; the verification code; cross-package duplication) plus metrics over
4,230 text files. What was DONE, each its own commit with its own validation:

  4e4d39f  one `el()` and one `esc()`, not four copies of each. `esc` is the rule that authored data cannot
           become markup, and a rule written five times holds in four places the first time one copy changes.
   c467216  seven engine exports nothing in the repo refers to - and the first pass got this WRONG by scanning
           only engine/ and poc/: features/ binds `moveMatrix` and `UTurnLeft`, so the skipped tree is what made
           a feature-bound symbol look dead.
   ee91bc4  five sites that reached `innerHTML` with a call's title, a caller-typed module name or a thrown
           error's message unescaped - while importing `esc` and using it three lines away.
   3d9e2d8  the catalogue-scan machinery (`closureScan`, `levelCalls`, `sequencerCalls` and their types and
           facades, 130 lines), `assignCouples` and `CallBrowser.preview`: the first three are a capability no
           panel offers, the sequencer having moved to `sequencerCallsUpTo`.
   3c5a7d4  ONE validating parser for the caller's saved modules. Two readers, one of which cast whatever it
           parsed straight to `Module[]` and then mapped over it FROM THE CONSTRUCTOR - so a stored `{}` threw
           during startup and took the app down while the other reader carried on.
   6f2ef4e  the probes are RUN. Nothing executed poc/tools/*-probe.mjs at all, and two were red: one pinned
           `selectMove(k: number)` (the signature had gained a parameter), and its negative control, once it
           applied again, removed only the first of the method's two sync calls.

THE FIRST DRAFT OF THE SCAN WAS ITSELF THE TRAP IT WAS LOOKING FOR. `escape-probe` matched ``innerHTML = `...`;``
and found 20 sites; there are 54, and the ones it missed were the chained and `+=` forms. A scan that reads half
a surface and reports "clean" is the "instrument's silence is not a pass" failure in a new place, so it now walks
each assignment to its own terminating `;` and asserts it accounted for every one.

WHAT THE AUDIT FOUND AND THIS WORK DID NOT TOUCH, in the order it deserves attention - each is a behaviour
question rather than a tidy-up, and each is evidenced at file:line in the four reports:

  - `ENGINE_TO_TOKEN` (all8-format.ts:381-392) inverts `TOKENS` first-wins, and three alias entries are declared
    BEFORE their canonical spellings, so `formatAll8Call('Cloverleaf')` emits `--Clov`: a token All8 never
    prints, on the sequence-export path, contradicting the invariant written directly above the function.
  - The editor's synthesizers (editor.ts:902-921, 997-1011) rebuild a `CallBundle` field by field and never copy
    `actives`, while `callToXml`'s own doc (editor.ts:1834-1836) says an editor has no business erasing it.
  - The greedy dancer-to-spot assignment exists twice (editor.ts:226-267 vs 1418-1449) and the copies disagree
    on sort order, on the gender guard and on pass gating: the same call can pair dancers two ways.
  - `normAngle` is exported under that one name from two modules with different behaviour at exactly -pi
    (moves.ts:23-28 wraps to (-pi,pi]; identity.ts:9-13 keeps -pi), and 7 modules import one, 3 the other.
  - The Speed selector does nothing on the Sequencer tab: `main.ts:101-113` reads `#speed` only into the
    Player's `speedMul`, while the sequencer advances its own playhead at `MS_PER_BEAT = 500`
    (sequencer-ui.ts:56,635-653).
  - The sequencer library is built in two places with DIFFERENT order (constructor sequencer-ui.ts:157-165 vs
    rebuild :360-369) under a comment asserting they are the same.
  - The verification suite is reachable only as `verify:engine`; root `verify` does not run it. `map-tips.mjs`
    counts failures and can never exit non-zero, and several harnesses assert `check(true, ...)`.
  - The engine's "dancers on top of each other" threshold is 1.0 in three files under three names, and the
    comment claiming they cannot disagree is prose: neither constant is ever imported.

THE BOARD BELONGS TO THE PANEL THAT IS ON SCREEN. Found by driving the built app in a real browser - the first
time this session could - and not by reading code: on first load the Browse tab (the default mode) showed the
Call editor's call on the board AND in its legend, while its own Call dropdown named a different one
("Flutterwheel" against `_Finish Line of 6 Half Tag`).

The culprit named itself from a stack captured on the legend's `innerHTML` setter: `EditorController`'s
constructor previews through `loadEditSetup` ("edit setup start - ...") and again through its own `applyMode`
(the raw instance), and the LAST writer won. Every preview goes through `host.preview`/`previewAt` into the BROWSE
view, which sets the player's call and the browse legend - so the editor was painting over a panel that owned the
board.

THE FIRST FIX WAS WRONG AND THE GATE CAUGHT IT. Guarding `loadInstance` fixed nothing (eight preview sites, not
one), and the blanket rewrite of `this.host.preview(` -> `this.show(` also rewrote `show`'s OWN body into
`if (this.active) this.show(call)` - infinite recursion, invisible at startup because `active` is false and fatal
on the first editor click. Both are recorded here because both are the same lesson: the guard has to be in ONE
place that nothing can route around, and a probe has to check the structure rather than the path that was blamed.

The rule now: `show`/`showAt` are the only two callers of the host, each gated on `this.active`; `showInstance`
inherits it; entering the editor paints the instance the constructor refused to; and `applyMode` in main.ts calls
`browser.reload()` when the editor is left for the Browse tab, so the dropdown and the board cannot stay split.
Gated in poc/tools/board-owner-probe.mjs - one writer, no bypass, and the two halves that make the guard safe.
Verified in the browser: startup, in the editor, and back on Browse all agree with their own dropdown.

`STEP FORWARD`, AND THE ONE "WHILE" GROUP THAT DEPENDS ON THE OTHERS. Asked for as: "Create a Coded Call for
'Step In'. The named dancers step forward 2 dimensions. This is intended to work in parallel with another Call.
It takes on the duration of the other call and if at the end of the call nobody is in their original position,
they step back 2 dimensions. If there is someone in their original position, they remain where they are." Four
things that wording left open were asked and answered before any code was written: the unit is 2 BOARD UNITS (the
cell the magnets, the spans and the moves editor all use, where a `Forward` is 1); "forward" is the DANCER'S OWN
FACING, not towards the set centre; the call is `Step Forward`, not "Step In" (a separate `Step Forward and Back`
is coming); and CALLED ON ITS OWN it is legal and simply stays where it stepped.

IT IS DERIVED GEOMETRY AND NOT A CATALOGUE MATCH. There is no such title anywhere in the corpus - no tam, no call
index entry - so there is nothing to match a board against. Like `Fold` and `Trade` it NAMES A GROUP ("Heads Step
Forward"), which is why the bare name is refused with that reason: a step that displaces some dancers and leaves
the others exactly where they stand has no whole-set reading to fall back on.

THE RETURN IS NOT PART OF THE CALL, AND THAT IS THE WHOLE DESIGN. `Step Forward` on its own has one answer -
step, and stay. The return depends on a fact the call cannot see: whether somebody has MOVED ONTO the spot it
left. In a "while" step that fact only exists once the other groups have been applied, so the call is registered
as the registry's one DEFERRED move (`CodedMove.deferred`) and `Applicator.applyGroupStep` splits the groups: the
independent ones are applied to the original board and merged by dancer id exactly as before, and the deferred
group is resolved LAST, against the board that leaves. Two rules follow from the dependency and are enforced with
their own reasons rather than guessed at: AT MOST ONE deferred group per step (two would each depend on the
other, which has no answer) and IT NEEDS A PARTNER CALL (deferred on its own would resolve to a silent no-op).

"IS MY SPOT TAKEN" IS THE BODY MODEL, not a second tolerance to tune. The question is whether there is room to
stand where the dancer came from, and this engine already answers exactly that question: `bodyOverlap`, the same
oriented 0.95 x 0.45 body the contact rules and the collision guard measure. A dancer standing on the spot
overlaps it by construction; a dancer on the NEXT spot does not (0.05 of air at the tightest facing pass), so the
two cases the caller cares about are separated without inventing a radius. A GHOST does not block the return, for
the reason `bodies.ts` excludes ghosts everywhere: it is a geometric reference, not a dancer.

THE TIMING IS THE OTHER CALL'S, which the request says outright ("it takes on the duration of the other call").
A "while" step costs its longest group, so a deferred group simply contributes NO BEATS - read through the same
`isDeferredCall` the applicator uses, so the clock and the board cannot disagree about which groups are
dependent. Measured: with a ONE-beat partner (`Face Right`) the step costs one beat, where leaving the step in
the fold would have charged its own two.

A CODED CALL COULD NOT BE A "WHILE" GROUP AT ALL UNTIL THIS, and that was found by trying it: the coded table
lives in the Sequencer, so a group whose call is coded died in the applicator's catalogue path with `"Step
Forward" not legal for selected dancers`. The reading is now ONE function, `applyCodedToSelection` in
`coded-moves.ts` - the three cases (a rule that computes the whole board itself, a whole-set resolve allowed only
for "All X", and a plain transform with the designated dancers kept) - used by both `Sequencer.tryCodedMove` for
the one-name form and the applicator for a group, so `Heads Step Forward` cannot mean one thing as a step and
another as a group.

MEASURED by `engine/test/step-forward.mjs` (in the light suite), on the corpus's own formations:

  - the call: four heads on a squared set move EXACTLY 2.000 units, each along ITS OWN facing (the heads face
    north/south and the sides east/west, so a fixed direction cannot pass), turning nobody, and the four dancers
    nobody designated do not move at all;
  - STAY: `Girls Step Forward while All Except Girls Wheel Around` on a Double Pass Thru - all four girls stay
    where they stepped, because the boys' own call takes the spots they left;
  - RETURN: `Heads Step Forward while All Except Heads Right and Left Thru` on a squared set - all four heads
    come back, and the other group ends exactly where its own call alone put it;
  - PER DANCER, not all-or-nothing: `Girls Step Forward while All Except Girls Swing Thru` on a Double Pass Thru
    leaves two girls stepped and brings two back, and each of the four agrees with its OWN spot being occupied.
    This is the measurement that separates the two readings of the request;
  - the refusals: two dependent groups, and a dependent group with no partner, both refused with the reason;
  - the NEGATIVE CONTROL: the plain INDEPENDENT merge - what every other "while" step still does, and the "nobody
    ever steps back" reading of this one - agrees with the rule on 0 of 8 dancers where no spot is taken, differs
    by EXACTLY the four dancers that come back where one is, and leaves 4 OVERLAPPING BODIES where the rule
    leaves none. Without that last number, "the spot was taken" would be a story rather than a measurement.
AND IT IS REACHABLE FROM THE PICKER, WHICH TOOK A SECOND FIX AND A REVERTED FIRST ONE. A group-named coded
call is invisible to `legalNext`: that list is the WHOLE-BOARD reading, and `Fold`, `Cross Fold`, `Trade`, `Run`
and `Step Forward` all refuse the bare name by design. The first fix was to let them into `legalNext` anyway
(when some group can perform them) and it was REVERTED, because `features.mjs` pins the invariant that matters -
"every listed call applies interactively" - and the change made exactly that fail (measured: 20 listed, 6
invalid). The right place is the APP, which is where the group prefix is applied at all: `refreshCallSelect`
offers a group-named coded call when the engine's own `groupCanPerform` says the chosen group can do it, in the
same branch that already asks that question for whole-set calls. VERIFIED IN THE BROWSER (Chromium against
poc/dist): with `Heads` chosen, `Step Forward` is in the list (148 entries); after `Heads Right and Left Thru`
the Parallel button enables, the remainder's list offers `Step Forward` (128 entries), and applying composes ONE
step - "Heads Right and Left Thru while All Except Heads Step Forward — one step; Undo removes both".
AND IT ANIMATES UNDER THE SCRUB, WHICH IT DID NOT AT FIRST. Reported from use, after the call applied
correctly: "When adding this Step forward call as a separate call, It isnt animated using the scrub." The cause
was the WALK and not the geometry. `replayWalk` decides a scoped step's walkability from the CATALOGUE variant,
and `Step Forward` has no tams at all, so the step was recorded UNWALKABLE with 0 beats - and
`evaluateSequence` returns `s.before` for any unwalkable step, so the board never moved at any beat. The walk has
one documented job (the module says it in as many words): it must agree with the APPLICATOR, because the failure
to avoid is "the call is legal, moves the dancers, and animates nothing". It now does: a scoped step whose call
is coded and whose catalogue has no variant is WALKABLE, charged `stepBeats` (the call's own 2), and animated by
`interpolateSegment` straight to the end board the WALK produced - handed in rather than re-derived, so the
animation cannot describe a different destination from the one the apply and the walk agreed on. The
catalogue-with-no-variant case is untouched: `coded` is null there, so it keeps its 0 beats and its refusal.

A SECOND DROP, FOUND BY THE GATE WHILE FIXING THE FIRST: the walk read only `raw.call`, so a step carrying its
selection as a FIELD (`CallStep { selection, call }`) had no selection, took the WHOLE-BOARD coded branch, was
refused by the rule that says a group must be named, and was recorded unwalkable - the same freeze, one form
over. The selection is now read from whichever form carries it, and the gate checks that `"Heads Step Forward"`
and `{selection:"Heads", call:"Step Forward"}` walk IDENTICALLY.

MEASURED by `engine/test/step-forward.mjs` section 7: the step is not a stop, it is charged 2 beats, at beat 1
of 2 each designated dancer is EXACTLY half way (1.000 units), at beat 2 the full 2.000, the non-designated
dancers do not move at all, and the board the SCRUB ends on is the board the APPLY produces. VERIFIED IN THE
BROWSER (Chromium against poc/dist, on the app's own exported board at the playhead): "Heads Step Forward" from
a Static Square reads heads at y=+/-3.00 at beat 0, +/-2.00 at beat 1 and +/-1.00 at beat 2, with the sides
unmoved throughout - which is the scrub showing the step rather than freezing on its start board.
AND A "WHILE" STEP ANIMATES EACH GROUP ALONG ITS OWN PATH, AT ITS OWN PACE. Reported from use, on the pair this
call made worth composing: "When I apply Sides Promenade 3/4 to Home in parallel with Step Forward, the dancers
move in parallel, but the sides seem to take a direct shortcut between the start and end formation and the
parallel call only lasts as long as the Step Forward." Then, on the pacing: "A Step forward should take 2 beats
to move the two steps. The rest of it should be stand still." Both were ONE defect, in `evaluateGroupAt`: it
blended every dancer STRAIGHT from `before` to `after` over the step's own beats, so the promenade group walked a
chord through the middle of the set - MEASURED in the app, (3,-1) to (-1,-3), a constant 1/3 and 1/6 of a unit
per beat - and every group was drawn at the same pace, the short call stretched to fill the long one.

EACH GROUP WALKS ITS OWN PATH. `evaluateGroupAt` now poses each group with `evaluateCallAt`, the SAME function a
lone scoped step uses, with the other groups FROZEN where they stand so the exchange detection inside
`interpolateSegment` cannot pair a dancer with somebody the group does not own. The invariant is worth stating on
its own: A GROUP IN A "WHILE" STEP ANIMATES EXACTLY AS IT WOULD ALONE. Measured: over all 13 beats of the pair,
a promenading dancer is at the pose it would be at dancing the call alone, worst difference 0.00e+0 units, and at
the halfway beat the group is 5.70 units OFF the straight line between its start and end formations, which is the
reported shortcut gone rather than merely moved.

AND EACH GROUP RUNS ON ITS OWN CLOCK, holding at its end pose once its own call is over: a group is evaluated at
`min(localBeat, its own beats)`. The pair still COSTS the longest call (12 beats for the promenade), and inside
it the stepping dancers travel 1.000 unit at beat 1 and the full 2.000 at beat 2, then do not move again for the
remaining ten - the request's "2 beats to move the two steps, the rest stand still" - while the promenade is
still travelling at beat 6 (5.57 units along its own path). The last frame is still the board the step APPLIED,
which is what the old blend was built to guarantee and this keeps.

A SECOND TRAP IN THE SAME FLOW, found while measuring it. `refreshCallSelect` keeps the previous selection when
the list still offers it, and in parallel mode the previous selection is the call that was just applied - so
pressing "+ Parallel call" and then Apply composed `Sides Step Forward while All Except Sides Step Forward`,
refused by the engine (two dependent groups) and leaving the first call alone in the history with a 2-beat
scrub. A refusal the caller caused by not touching a control is the kind this panel refuses elsewhere, so
entering parallel mode now CLEARS the picker: "pick their call, then Apply" is literally true. VERIFIED IN THE
BROWSER (Chromium against poc/dist): pressing "+ Parallel call" leaves the picker empty; choosing `Step Forward`
composes "Sides Promenade 3/4 to Home while All Except Sides Step Forward" at 12 beats on the scrub, with the
sides wheeling (3,-1) -> (2.13,-0.07) -> (2.01,1.60) -> (1.19,2.39) -> (-1.81,1.81) -> (-2.22,-1.25) -> (-1,-3)
and the four heads stepping 2 units over the first two beats and then standing still.
AND A DEFERRED GROUP THAT RETURNS IS SHOWN STEPPING IN AND BACK OUT. Reported from use, one fraction later:
"if I apply Sides Promenade 1/2 to Home in parallel with Step Forward, the sequencer suggests they have been
applied, but the step forward dancers dont move. I suspect it is because they start an end that the same place."
The guess is exactly right, and the RULE is right too: `Promenade 1/2 to Home` brings the sides back to their own
four spots, so nobody is standing on the spots the heads left, so the heads step back - the pair nets to the
promenade alone, which is what the request asks for ("if nobody is in their original position, they step back").

WHAT WAS WRONG WAS THE ANIMATION. The group's start and end boards were the SAME board, and a two-point
interpolation between identical boards draws nothing, so the caller could not see that the step had happened at
all. The call has TWO moves in it and the request says where they go - the step at the start, and the step BACK
"at the end of the call" - so `evaluateGroupAt` now walks a deferred group FORWARD over its own beats, HOLDS, and
BACK over the last of them, with the leg capped at half the step so the round trip always fits (a two-beat step
inside a two-beat partner has half a beat each way rather than losing the return and disagreeing with the applied
board). A dancer that STAYED has `after === forward`, so its second leg is a no-op and the same formula serves
both outcomes.

MEASURED by `engine/test/step-forward.mjs` section 9, on `Sides Promenade 1/2 to Home while All Except Sides Step
Forward` (8 beats): the stepping dancer's distance from its start reads 0.00, 1.00, 2.00, 2.00, 2.00, 2.00,
2.00, 1.00, 0.00 across the nine beats - out over its own two beats, standing still for the five in the middle,
and back over the last two, which is the "at the end of the call" the request named. VERIFIED IN THE BROWSER
(Chromium against poc/dist) on the same pair: 8 beats on the scrub and head 1 at (1,3) -> (1,2) -> (1,1), holding
(1,1) through beat 6, then (1,2) -> (1,3).
RENAMED, AND SPLIT IN TWO. Asked for as: "Rename 'Step forward' to 'Step Forward and Back if Possible'". The call
described above under the name `Step Forward` is now `Step Forward and Back if Possible`, because that is what it
is: it steps out and decides whether the way back is clear. The rename also settled the one thing the old name got
wrong, in the words of the answer to "what should it do when called on its own?" - "Make it step back too - one
rule everywhere". So a lone `Heads Step Forward and Back if Possible` now steps out and back (4 beats: 1.00 at
beat 1, 2.00 at 2, 1.00 at 3, home at 4) instead of the special case that left it standing where it stepped. The
deferred machinery, the body-model test for "is my spot taken" and the applicator's late resolution are all
unchanged - only the standalone answer moved.

AND A NEW `Step Forward` WAS ASKED FOR IN THE SAME BREATH: "create another Coded call named 'Step Forward', that
just steps forward over 2 beats. If its part of parallel calls, it stands still for the remainder of the other
call." It is the same forward motion with no decision in it, and it is NOT deferred, so a "while" step treats it
as an ordinary group: its own two beats are charged (the step still costs the longer call), and the per-group
pacing holds it at its stepped pose for the rest - measured in the app as `Sides Promenade 1/2 to Home while All
Except Sides Step Forward` over 8 beats with the stepping dancer at 0.00, 1.00, 2.00, then 2.00 for every
remaining beat. `engine/test/step-forward.mjs` section 0 pins the pair of them: the deferred coded moves are TWO
SPELLINGS OF ONE RULE (`Step Forward and Back if Possible` and, below, `Forward and Back`, sharing one
`applyToSelection`), the plain step costs 2 and the round trip 4, and all three refuse the bare name.

`Forward and Back` IS THAT SAME ROUND TRIP UNDER THE NAME A CALLER ACTUALLY SAYS, and the report that found it
was: "in Static square, 'Heads Forward and Back' as a call in its own right does nothing." MEASURED BEFORE, on a
Static Square: the call APPLIED - the catalogue's own scoped tam (`ms/forward_and_back.xml`) steps the heads out
two and back two, so its net board is the board it started on - but `sequenceBeats` was **0** and
`sequenceStop` named it, so there was no timeline to animate over at all. The walk matches the BASE name, and
the corpus's `Forward and Back` authorings are two-dancer setups (`Facing Couples Compact`) that no four-dancer
subset can match; the step was recorded unwalkable. The scoped tam is also a different TIMING from the round
trip's: its two paths are `Forward 2` and `Back 2` at `beats="4"` each, i.e. 8 beats authored for a motion this
rule does in 4.
RESOLVED BY A SECOND ENTRY ON THE SAME RULE, not by an alias. The rule is bound once
(`stepForwardAndBackSelection` / `stepForwardHalf` in `coded-moves.ts`), so "one rule, two names" is a fact
`engine/test/step-forward.mjs` section 0 asserts by identity rather than a claim in a comment. It has to be a
second ENTRY because the registry is keyed on the BASE call name and would otherwise SHADOW the catalogue:
`Forward and Back` HAS a whole-set authoring that must keep working, so this entry declares `catalogueFallback`,
which declines that reading back to the tams. MEASURED over the engine's 136 named formations: the whole-set
reading applies on FIVE (`Normal Lines`, `Normal Lines Compact`, `3 and 1 lines #1`, `Inverted Lines Ends Facing
Out`, `Double Pass Thru`) and the derived precondition declines all five, so the catalogue serves every one;
without the flag all five would be refused. The bare call still refuses on a square, with the CATALOGUE's
reason, and `engine/test/step-forward.mjs` section 10 pins the count so the fallback cannot be dropped quietly.
BOTH TIMINGS ARE GATED (section 10), because either alone would pass a wrong rule. Standalone, `Heads Forward
and Back` costs **4** beats and the scrub reads 0.00, 1.00, 2.00, 1.00, 0.00 - two out and two back, where a
two-point interpolation between its two IDENTICAL ends would draw nothing. Beside `Sides Promenade 1/2 to Home`
the step costs the PARTNER's **8** beats, out at beat 2, still out through beat 6, and back over the last two -
the owner's own description of why the timing exists ("they step out as the other group finishes"). On that
witness it moves the dancers exactly as `Step Forward and Back if Possible` does, beat for beat, which is the
assertion that makes this a rename of a measured behaviour rather than a second implementation of it.
CONSEQUENCE, RECORDED RATHER THAN GLOSSED: the entry is DEFERRED, which is what makes the out-and-back span the
sibling at all, so a "while" step whose ONLY group is `Forward and Back` is now refused with the deferred rule's
own reason - the same answer `Step Forward and Back if Possible` gives, and the correct one (its dancers resolve
against the other groups' end poses and there are none). `engine/test/parallel-calls.mjs` section 7 had pinned
that lone group as part of its "the decomposed reading agrees with the string one" check; the witness moved to a
`{selection, call}` CallStep, which reaches the same applicator scoped-name lookup, and the lone group is now
pinned as a refusal beside it rather than being silently dropped.
AND ONE CENSUS MOVED, by exactly the two calls this entry adds. `canonical-identity-probe.mjs` §3 counts
`legalCalls` on each named registry key, and the IDENTIFIED column gains **+2** on SIX of the ten -
`Eight Chain Thru` 320 → 322, `Ocean Waves` 484 → 486, `Two-Faced Lines` 321 → 323, `Two-Faced Lines LH`
318 → 320, `Two-Faced Lines RH Compact` 91 → 93, `Ocean Waves RH BGGB Compact` 140 → 142 - while `Normal Lines`
(432) and `Normal Lines Compact` (243) are unchanged, because on those two the heads already stand as the
facing pairs the catalogue's scoped tam wants. The +2 is `Heads Forward and Back` and `Sides Forward and Back`,
which now apply where the scoped tam cannot match. It is the FIX rather than a side effect: the applicator
reaches the registry through `applySelected`'s `applyCodedToSelection`, whose contract is explicitly "strictly
additive, it can only turn a refusal into an application". That pin was ALREADY red before this change (it
expects `Eight Chain Thru` `[249,299]` against an actual `[269,320]`), so the movement is recorded here rather
than re-pinned - re-pinning a census that is red for a stale corpus would hide the next real movement.
THE REST IS UNCHANGED, measured before and after with `engine/src` + `engine/test` stashed for the baseline:
the FIGURE census is identical (`figures 7 of 188`, and the same cause table - `98 catalogue tam has no setup`,
`61 derived call refuses ("Promenade")`, ...), the full `npm run verify --prefix engine` run reports the same
**83** `FAIL` lines before and after with the legal-call census above the single line that differs, and
`node book/tools/check-links.mjs` is green. The census is that low in this tree for a pre-existing
corpus/registration reason that is NOT this change: the baseline was taken with the same dirty tree.

THE FORWARD HALF IS ONE DEFINITION (`stepForwardSteps`), which is what keeps the two calls from disagreeing about
what a step is, and it is also what the APPLICATOR resolves the deferred group from - a deferred call declares its
own `deferredHalf`, because `applyToSelection` is now the WHOLE call (the decision included) and applying it to
get the half-way board would ask "is my spot taken" about the wrong start. The same field is what the lone-call
animation walks out and back over, so the round trip is drawn by one function (`deferredRoundTrip`) whichever way
the call is danced.

THE OLD NAME STILL RESOLVES, to the plain step: `Step Forward` is the new call's name, so a saved module or an
All8 line that says `Heads Step Forward` now means "step out and stay" rather than the round trip. That is the
rename as asked for; a sequence that wants the old behaviour says `Step Forward and Back if Possible`.
AND THE FLOOR IS 10 UNITS ACROSS NOW, FROM -5 TO +5. Asked for as: "Expand the board's square and radial background
grids from -4/+4 to -5/+5." It is ONE constant (`scene.ts`: `FLOOR_HALF`), because everything that has an opinion
about the floor's size derives from it rather than repeating it: the two `GridHelper`s (10 units in 10 divisions,
with the brighter overlay every 2), the square half lines (0.5 … 4.5), the radial spokes (which stop at the floor's
own edge), the unit circles (1 … 5) and their half rings (0.5 … 4.5), the floor plane, the axes and their labels,
the pan limit, and the camera framing in both views. The 8-unit floor could only be changed in one place and neither
grid nor the frame needed an edit - which is the point of the axis labels being a fraction of the half-width and of
`frame()` taking the canvas rather than a constant.

WHAT DID NEED EDITING IS EVERY CLAIM ABOUT THE SIZE. The floor is described as "8 units in 8 divisions" in the
probes and the docs; the half marks are at 0.5 … 3.5, not 0.5 … 4.5; and the flat view's pixel scale moves with
the frame, from 97.83 px per unit at 1600×900 to 80.36, so a drawn line's magnet band is 20.1 px and a half
position's is 10.0. `radial-grid-probe.mjs`, `snap-grid-probe.mjs`, `view2d-probe.mjs` and
`facing-handle-probe.mjs` all carry a MIRRORED `FLOOR_HALF` (that is what a mirror is for - it has to be updated
with the thing it mirrors), and the radial probe's count of the even circles is `Math.floor(half / 2)`, because on
an ODD half the outermost even circle is r = 4 while the floor edge is 5: the count is a consequence of the radius
rather than a rule of its own, and `half / 2` was only ever right at 4.

MEASURED after the change: `radial-grid-probe.mjs` (5 circles, 2 even, 5 half rings, none past the floor),
`snap-grid-probe.mjs` (80.36 px per unit, the magnet still a quarter of a cell in both tiers), `view2d-probe.mjs`
(the frame fits 5.6 units plus the pad on the tighter axis, the pan limit lands on the floor's own edge, and the
construction-time frustum still stretches the floor by exactly 1.777778) and the nine probes that read the grid
for other reasons are all green. VERIFIED IN THE BROWSER (Chromium against poc/dist, 1600×900): the square grid
draws 10 cells across with the brighter overlay every 2 and the half lines between; `W` switches to the radial
one, whose spokes and unit circles reach 5 with the faint half rings at 0.5 … 4.5; the floor and its pad still fit
the frame with the HUD's inset honoured, and the axis labels sit just outside the grid.
AND THE RADIAL GRID CAN FIT A CURVE TO ITS OWN CIRCLES, one press at a time. Asked for as: "call editor: if
radial grid and start and end points of the current curve are on the same radial circumference and the distance
between the ends is less than half, offer a mid point control that when clicked calibrates the bezier controls best
fit of the curve to the radial line it's connected to. This makes accurate fitting to radial circles so much
easier than manually adjusting the controls."

WHAT IT IS. When the radial grid is the one on the floor and the selected move's travel curve has both ends on one
of the CIRCLES THE GRID DRAWS, the gadget grows one more dot - green, the colour the grid draws its circles in -
at the point halfway along the arc. Pressing it (it is the one control in the gadget that acts on a PRESS rather
than a drag, since there is nothing to drag it to) rewrites the move's two CONTROL points to the cubic that
follows that circle, leaving both END POINTS exactly where they were. So the chain the curve is part of - the move
before, the move after, the joint - is untouched, and only the shape between its own ends changes.

THE LIMIT IS A QUARTER TURN, AND THE FIRST VERSION'S CHORD LIMIT WAS WITHDRAWN. The request's "the distance
between the ends is less than half [a cell]" was taken literally at first, and that turned out to refuse
everything real: MEASURED over the ms level's 976 moves, 354 have both ends on one drawn circle and NONE was under
half a cell - the corpus's arcs are quarter and eighth turns, not slivers - so the control could never appear.
Withdrawn for "I think a radius of quarter or less is more workable with bezier", which is the standard fact about
cubics: `radial-arc-fit-probe.mjs` measures the fit's worst radial error at 2.7e-4 of the radius over a quarter
turn, 1.5e-3 at 120deg and 1.8e-2 at 180deg - so a quarter is where the fit stops being exact to the four decimals
the XML exports. With the sweep limit instead of the chord limit, 74 of those 354 curves are offered the fit
(median 45.1deg, widest exactly 90deg) and the 280 that sweep further are refused.

THE OTHER TWO CONDITIONS are refusals: the two ends must be on the SAME circumference, and that circumference must
be one the grid DRAWS. The tolerance is the magnet's own half tier (0.125 units), which is what makes the workflow
work - CTRL-drag the ends onto a ring, then press the dot - and `radialArcFit` (pure, in `grid-magnet.ts`) is the
one place it is stated.

ONE TOLERANCE, AND THE FIRST VERSION DID NOT HAVE THAT. The rule accepted a radius mismatch up to the magnet's
tier while the engine's `arcBezierAbout` refused anything past its own 5% relative default, so at r = 1.5 the dot
appeared for a pair the fit then refused. MEASURED in the browser on `ms/grand_spin.xml` move 2 - the dot was drawn
and pressing it said "the two ends are not on one circle" - which is exactly the "I pressed it and nothing
happened" the caller would report. The rule now carries the tolerance it accepted at (`RadialArcFit.tolRel`) and
the panel hands that to the engine, and the probe sweeps 1990 offered pairs to check the invariant that would have
caught it: everything OFFERED can be FITTED.

VERIFIED IN THE BROWSER (Chromium against poc/dist): `ms/grand_spin.xml` "Sides Face, Grand Spin", dancer 1's move
2, radial grid, flat view - the dot appears where the arithmetic says (the predicted screen point hit it first
try), and pressing it reports "curve fitted to the r = 1.5 circle (45.0deg of arc)" with the move's numbers going
from cx1 0.5, cy1 0, cx2 0.5, cy2 0.5 to cx1 0.2733, cy1 0.2733, cx2 0.6136, cy2 0.5 and x2/y2 UNCHANGED.
THE ARC FIT'S QUARTER TURN WAS AN EXACT RIGHT ANGLE, AND THE CORPUS'S QUARTER TURNS ARE NOT. Reported as: "The
central control to fit to radial curve only seems to appear on the first full curve of Promenade Full. It should
appear on all four of the quarter moves, unless fixing one has thrown out the end points of the other curves, so
they no longer align with the radius. If so, this should be prevented by pinning the subsequent end point while
adjusting the controls." - and then, looking again: "I just saw the first and last curves with the control, but
missing on the middle curve."

IT WAS TWO FAULTS, AND THE SECOND READING NAMED THE FIRST ONE EXACTLY. Both were measured before anything changed.

1. WHICH QUARTER WAS OFFERED TURNED ON THE LAST DECIMAL OF ITS COORDINATES. `radialArcFit` compared the sweep with
`PI/2` exactly, and the corpus writes its arcs in four decimals. MEASURED on the three authorings of the call in
`ms/promenade.xml` (rings r = 2.5 and 3.5), the quarter turns come out at 90.0003, 90.0049, 90.0053, 90.0152 and
90.0158deg - every one of them a hair PAST a right angle. Under the bare comparison, `Promenade Full to Home` was
offered the fit on moves 1 and 4 and refused it on 2 and 3, which is exactly "the first and the last, but not the
middle"; `Promenade Full` (Facing Couples Far) was offered it on move 1 alone. The slack is now
`RADIAL_ARC_SWEEP_TOL` = 2deg, and it is not a round number somebody liked: swept over EVERY TAM OF ALL NINE LEVELS
(98038 moves), 16120 pairs have both ends on one drawn circle within the magnet's tier, 986 of those measure past a
right angle (worst 90.708deg), and the narrowest arc that is genuinely wider than a quarter is 100.389deg - nothing
at all lives between those two numbers. The 2deg sits 1.3deg clear of the noise and 8.4deg clear of the shapes, and
it costs the fit 7% of an error that was never inside four decimals anyway (2.912e-4 of the radius at 91deg against
2.725e-4 at 90). It is an ANGLE and not the magnet's tier converted at the radius: the tier says how far a placed
point may be from where the caller meant it, while this bounds the SHAPE - whether the cubic is still the circle.

WITH IT, every dancer-move of every promenade path that is ON a ring is offered the fit: 62 of 62 across the three
authorings, against 34 under the bare `> PI/2`.
The moves that ENTER and LEAVE the ring are refused and should be - the first move
of the Facing Couples Far path runs from r = 3.1623 at the formation's corner to r = 2.500 on the ring, which is
not an arc about the centre at all. So "all four of the quarter moves" is three of that authoring's four moves;
the fourth is the transition onto the ring, and no circle through its two ends exists.

2. THE FIT DID THROW THE OTHER CURVES OUT, WHICH WAS THE REPORT'S OWN HYPOTHESIS. `poseFor` composes each move in
the frame turned by `bezierAngle(facing, 1) - bezierAngle(facing, 0)`, read off the move's FACING when it has one
and its TRAVEL when it has not. The panel compensated that turn only for a FACING write (the guard was
`curve === 'facing'`), on the belief recorded in a comment - that a travel write "already holds its own tail
through `moveCurveEnd`". That is true of an END POINT drag, which carries the exit handle as a vector, and false of
the FIT, which rewrites the departure tangent as well as the arrival one. MEASURED over the promenade's three
authorings (62 fits, 3936 end points re-evaluated): the fit alone moves a later end point by up to 4.86e-1 units,
and 44 of the 62 fits move something - which is the next quarter being pushed off its circle.

THE GUARD IS NOW THE ANGLE ITSELF (`frameTurn` in `editor-ui.ts`), for facings and travel curves alike, so
`holdFollowingTrace` fires for exactly the writes that turn the frame. Every later end point then moves 2.75e-15
units - the rounding of the rotation, eleven orders below the fourth decimal the assets are written in - and the
END POINT drag is untouched by the change: over the same 80 moves, `moveCurveEnd` leaves the frame turn within
2.22e-16, so the delta is 0 and the hold is the identity there. That is why the guard can be the angle rather than
a flag naming the tab, and why nothing is compensated twice. The status line follows: `noteTraceHold` speaks on
either tab (it reports the turn of the frame rather than of the facing), and the fit's own message says the trace
was held when it was.

GATES: `npx tsc -p poc --noEmit`; `node poc/tools/radial-arc-fit-probe.mjs`, whose sections 7-9 are new - the band
the slack sits in, the promenade's own moves curve by curve, and the two drifts side by side; and the wiring checks
in `facing-chain-probe.mjs` and `facing-end-drag-probe.mjs` were re-stated, because the guard they read for is the
thing that changed. THE ENGINE WAS NOT TOUCHED AT ALL: `holdFollowingTrace` and `poseFor` already did this. The
panel was simply not calling the first one for a travel write.

A "WHILE" GROUP MAY DANCE SEVERAL CALLS - THE LANE. Asked for as: "how difficult would it be to allow
multiple calls in a parallel set. If heads take 16 beats to do one call, the sides could do two 4-beat
calls."

THE RULE THIS CHANGES WAS WRITTEN DOWN AS A REFUSAL. `GroupStep` said "a group names a CALL, not a module.
Two composite routines of different lengths have no defined alignment, so allowing them would invent a
synchronisation rule the art does not have." The rule the art does have is the one the request describes,
and it is now stated on `GroupStep`:

  - every lane starts at beat 0, so the groups are still simultaneous;
  - a lane's calls run consecutively, each starting where the one before it left the group;
  - the step costs the LONGEST lane, and a lane that finishes early STANDS at its own end pose - which is
    the reading `stepBeats` and `evaluateGroupAt` already gave a group inside a longer "while";
  - there are NO synchronisation points BETWEEN lanes: nothing can start one lane's call at beat 6 of
    another's, and the engine reports the imbalance rather than removing it.

WHAT A LANE IS, IN THE DATA. `GroupStep.groups` went from `{selection, call}` to `{selection, calls[]}`,
with `groupCalls`/`normalizeGroupLane` reading the LEGACY single-`call` form everywhere - because a "while"
step can be SAVED as a module, so callers' browsers already hold `{selection, call}` and a migration would
buy nothing. `ApplyResult.lanes` and `SeqStep.lanes` report each group's calls AND the boards between them,
so the animator and the picker read the apply that actually happened instead of applying the lane again.
`stepLabel` joins a lane with "then" (All8's own punctuation gives `;` = "then" beside `,` = "while"), and
`Library.registerModule`/`flatten`/`moduleCollapsible` canonicalise and count every lane call.

MEASURED, on the report's own shape (`Heads Promenade Full` = 16 beats; `Sides Trade` = 4 and
`Sides Pass Thru` = 4 after it, both legal): the step costs 16 rather than 16 + 8, each lane ends exactly
where its own calls put it (worst 0.0e+0 units against applying them one at a time), and the lane labels
"Heads Promenade Full while Sides Trade then Pass Thru". The PACING is pinned on
`Sides Trade then Touch a Quarter` (4 + 2): the sides are still dancing at beat 5 and hold on their end pose
from beat 6 to the step's end at 16, exactly (drift 0.0e+0), while the heads keep promenading - a lane that
finishes early stands still.

TWO THINGS THE WORK TURNED UP, both recorded rather than papered over:

  - `evaluateCallAt` must be handed `null` for the variant info, NOT the walk's own `info`. A variant
    matched against the whole board makes it try to TILE the board with a subset variant, no group matches,
    nothing is posed, and the dancers HOLD at the sub-call's start until the step's last frame. MEASURED on
    `Sides Trade then Pass Thru`: with `info`, the sides sat at the Trade's end from beat 4 to 15.9 and
    jumped at 16. Every group call before lanes existed passed `null` here for the same reason.
  - THE PANEL APPLIED THE COMPOSED STEP TWICE, and a lane is what exposed it. `applyParallel` rebuilt the
    step, replayed the history (which, once the step is in the list, leaves the live board at the board the
    step PRODUCED) and then applied the step again - so the second application ran from a board the first
    one had left. That is harmless for the ordinary pair and stops being so the moment a lane can grow:
    MEASURED in the browser, `Heads Promenade Full while All Except Heads Trade` applied, and appending
    `Touch a Quarter` was then refused with `"Heads Promenade Full" in a "while" step: Promenade Full ...` -
    the HEADS' own call failing from a board the heads had already left. The step is now CHECKED once, on
    the board it starts from (`applyToBoard(p.start, step)`, a pure call that does not move the live board),
    and a refused append restores the lane as it was rather than collapsing the step back to the bare first
    call. Verified in the browser afterwards: two appends, one history row, `16.0 / 16.0 b`, and the
    sequence count still 1.  - A PRE-EXISTING ANIMATOR WART, found while choosing that witness and NOT fixed here: a scoped group call
    whose BARE name also matches the whole board takes the whole-board branch in `evaluateCallAt`, so
    `Sides Pass Thru` alone (or after `Sides Trade`) animates as nothing mid-call - measured mid-call motion
    0.00 units against 1.41 for `Sides Trade` and 3.16 for `Sides Touch a Quarter`. The harness uses
    `Touch a Quarter` for its pacing witness and says why.

GATES: `npm run build --prefix engine`; `npx tsc -p poc --noEmit`; `node engine/test/parallel-calls.mjs`
(section 8 is the lane: the beats, the per-lane boards, the early lane holding, a lane whose SECOND call
refuses being named as "call 2 of 2", the deferred-in-lane refusal, and the legacy `{selection, call}`
form); `modules.mjs` (the "then" label, the flatten pass-through with both calls intact, and
`collapseModule` across a lane) and `step-forward.mjs` (the same refusal from the deferred call's side).
On the POC side, `stored-modules-probe.mjs` checks the legacy lane is upgraded by the one parser,
`parallel-lane-probe.mjs` is new and reads the picker (Apply appends, the button finishes, the board the
list answers for advances with the lane, the balance is in the status line), and
`poc/tools/verify-probes.mjs` reports the same 13 pre-existing reds and no others (43 probes).
THE CALL PICKER SHOWS EACH CALL'S BEATS. Asked for as: "Sequencer: Display the beats for each call in the
Call selection e.g. '16 - Call name'."

WHAT THE NUMBER IS. Every entry in the Call list is labelled `${beats} - ${name}` - "16 - Promenade Full" -
read from the ENGINE and not estimated: `stepBeats` on THE BOARD THE CALL WOULD RUN ON (the lane's board in
parallel mode, which is where the next call would go) and for THE NAME APPLY WILL USE, the chosen group's
prefix included, since that is the step the sequencer charges. A MODULE is a whole sequence rather than a
call, so its number is `sequenceBeats` of its flattened steps - the same call the scrub uses - from the live
board, where a module is applied; a call lookup on a module name would have read 0. THE OPTION'S VALUE STAYS
THE BARE CALL NAME, because Apply, the previous-pick restore and the parallel lane all read
`callSelect.value` back, so the beats are presentation only. Asked for straight after the lane work, where
the balance of two short calls against a long one is the whole question and the number was only in the
status line AFTER something had been applied.

MEASURED: the probe checks against the built engine that the number shown is the number the step is
CHARGED - 16 for `Heads Promenade Full`, 4 for `Heads Trade`, 2 for `Heads Touch a Quarter`, each equal to
`sequenceBeats` of the same step - and reads the panel for the wiring (the label, the value, the board, the
prefix, and that the two places options are built are the only two). VERIFIED IN THE BROWSER (Chromium
against `poc/dist`, MS level, no group chosen): the Call control reads "16 - Promenade Full".

THE SEQUENCE LIST SPELLS OUT THE PARALLEL STRUCTURE, AND A THIRD GROUP IS BUILDABLE. Asked for as: "When I
add a third call to a parallel call it doesnt seem to animate and it seem to be added to the call list as a
new call. Display the parallel lines of the calls list using symbols '||' for parallel, '+' for sequential
combine, brackets to indicate scope e.g. call 1 || ( call 2 + call 3 ) || (call 4 + call 5)".

THE TWO HALVES HAVE ONE CAUSE. `+ Parallel call` meant two things: with nothing applied it seeded the
remainder's lane, and with a lane already started it FINISHED the step. A caller reaching for a THIRD
parallel group therefore had the figure end under them, and the call they applied next landed as a NEW entry
in the list - both reported symptoms at once, and the example's three groups cannot be built at all while
the button ends the figure. So the button now only ever OPENS A LANE, a separate **Done** button finishes,
and the mode holds `groups: {selection, calls[]}[]` plus the `active` lane that Apply appends to.

THE GROUP SELECTOR IS REBUILT IN PARALLEL MODE, and that is what makes a third group possible: a lane is
given the complement of everything claimed so far, so a lane holding ALL of it leaves nobody behind. While
the mode is on, the selector lists the groups that resolve INSIDE the unclaimed dancers. MEASURED IN THE
BROWSER on a squared set after `Heads Promenade Full`: `All Except Heads · Side Boys · Side Girls · Side
Men · Side Women · Side Beaus · Side Belles`, so the remainder can be SPLIT - `Sides Trade` for the Side
Boys and a different call for the Side Girls. An empty open lane is narrowed by the same press: it starts as
"everyone unclaimed" and the caller says "this lane is only the Side Boys". The complement is named with the
grammar that already subtracts a union (`All Except A and B`), MEASURED: `All Except Heads and Sides`
resolves to nobody, i.e. it is the subtraction of all eight.

A BUG THE BROWSER FOUND AND NO PROBE WOULD HAVE. The complement of an ALREADY-COVERING union is a
WELL-FORMED selector for nobody - `All Except Heads and All Except Heads`, the union of an ordinary pair -
so testing the selector for null was not enough: the panel offered a lane to an empty set of dancers and
printed that string as though it named a group. The emptiness is now measured ON THE IDS (`unclaimedIds`).

THE LABEL IS THE ENGINE'S, ONE FUNCTION, because the pane, the All8 view and the module list all read
`stepLabel`. A group of one call is bare; a group of several is bracketed and joined with `+`; the groups
are joined with `||`: `Heads Promenade Full || Sides ( Trade + Touch a Quarter ) || Side Boys Recycle`. The
selection stays in front of its bracket, so the grammar says WHO as well as WHEN, and the old "then"/"while"
wording was REPLACED rather than added to - a label that spells the same thing two ways is one more thing
for a pane to disagree about. Nothing parses the label (it is a message, and a replay cache key joined on
NUL), so the punctuation was free to change; the three harnesses that pinned the old words were updated
with it.

THE HUD'S TYPE IS A STEP BIGGER AND ITS DIM TEXT IS BRIGHTER. Asked for as: "The text in the Sequencer HUD
is too small for me to read comfortably. Make it a bit bigger with better overall contrast." MEASURED with one
instrument over the committed file and the working copy (`poc/tools/_hud-before-after.mjs`, deleted before the
commit), as WCAG contrast ratios against the panel's own COMPOSITED background (#11171e - `--panel` is
`rgba(18,24,32,0.85)` over `--bg`, and the timeline adds `rgba(9,13,18,0.5)` on top of that):

```
                       before                    after
font sizes in the HUD  9 x1, 10 x3, 11 x12,      11 x5, 12 x11, 13 x5,
                       12 x5, 13 x2, 15 x1       14 x2, 16 x1   (24 either side)
under 11px             4 declarations            0
--dim on the panel     5.17:1                    7.52:1
--dim in the timeline  5.39:1                    7.83:1
D/C badge in the tl.   2.33:1 (a FAIL)           9.08:1
```

The `--dim` fix is ONE LINE rather than twenty restyled rules, because there is one dim in the app and the
panel wanted a different one: `#hud { --dim: #9aa9b8 }` redefines the custom property for its own subtree, so
the editor, browse and FSM views keep the app's grey. The type step is per rule (11 -> 12, 12 -> 13, 13 -> 14,
15 -> 16, the 9px source badge to 11 and the 10px section heading to 11), which leaves NOTHING in the panel
under 11px where four declarations were.
AND THE MEASUREMENT FOUND TWO FAILURES OF OUR OWN from the previous round: the timeline badge distinguished
`D/C` from `D` with `opacity: 0.45`, which is **2.33:1** - a fail, on the one badge whose whole job is to be
read - and the base badge carried `opacity: 0.7` (3.24:1). Both opacities are gone; the blue is `#7ab8ff` and
`D/C` is distinguished by its LETTERS, which is where that difference always was.
VERIFIED IN A BROWSER (Chromium against a fresh `poc/dist` served from `node:http`, MS, Static Square, a
five-call All8 figure loaded through the panel's own Import button): the timeline draws `C`, `D/C`, `D/C`, `D`,
`C` on rows 1-5 with the beats and the refusal line legible, the top of the panel keeps its rows on one line,
and nothing wrapped or overflowed in the 320-420px column.
GATES: `npx tsc -p poc --noEmit` clean; the POC probe suite reports the same 13 pre-existing reds and no
others.

THE TIMELINE ROW SAYS WHERE ITS CALL COMES FROM. Asked for as: "add a small marker to indicate if a call
used in a sequence is a CodedMove or from the catalogue." The badge is two or three characters, and it is
THREE-WAY rather than two-way because the registry is: MEASURED, of the 23 coded moves **11 also have catalogue
authorings** and **5 declare `catalogueFallback`** - `Do Sa Do`, `Swing Thru`, `Left Swing Thru`, `Fan the Top`,
`Forward and Back`, which is the whole list. `D` is a coded rule the catalogue is never consulted for, `D/C` is
that rule with the catalogue as a DECLARED fallback, `C` is an authored tam, `M` is a stored module - a SEQUENCE
of calls, which is its own answer because the plausible two-way rule
(`findCodedMove(name) ? ... : 'catalogue'`) would call a module an authored tam - and the fifth is a "while"
whose lanes disagree, whose tooltip names which lane is which because the row is several calls and "mixed"
alone is not an answer.
The rule is `poc/src/step-source.ts`, DOM-free so `poc/tools/step-source-probe.mjs` runs it over the REAL
registry instead of reading the panel's source; the badge and its sentences are `SOURCE_MARK` in the panel,
because what an answer is CALLED on screen is not the rule. The probe also pins the three counts, so an overlap
that appears or vanishes is re-pinned deliberately rather than absorbed.
GATES: `npx tsc -p poc --noEmit` clean; `node poc/tools/step-source-probe.mjs` green, and registered by
residence in `poc/tools/` (51 probes, the same 13 pre-existing reds and no others). `poc/verify.cjs` is still
red at the pre-existing `selectTam` throw ("2 tams match 'Circle Left' [Static Square]"), which is untouched.
NOT OBSERVED IN A BROWSER: a Vite build needs wider access than this sandbox gives (the esbuild EPERM), so the
badge is verified as markup and wiring and not as pixels.

A STEP THAT APPLIES MUST ANIMATE SOMETHING, and this is the second real defect the request turned up.
`Heads Do Sa Do` applied legally, charged its full 8 beats and drew NOTHING: a scoped CODED call was drawn
as `interpolateSegment(board, after)`, and a call that RETURNS HOME has `after === board` for every dancer,
so the "straight line" was a point. Reported from use long before as "it looks applied but the dancers don't
move when I scrub". The fall-through is now taken only when that line cannot draw the call (the two boards
are equal for every dancer), which keeps the calls it was written for - MEASURED: making it unconditional
broke `Trade`, which IS coded and whose boards DO differ, and inside a lane the subset machinery draws
nothing for it (the bare call does not apply to the 4-dancer side subset), so the third sub-call stood still
for its 4 beats and snapped at the end. The new gate is
`engine/test/tools/scoped-coded-animation-probe.mjs`: every coded move x the 6 whole-set selections from a
`Static Square`, 138 rows of which 55 apply (51 of them with non-zero beats). Run against the PRE-FIX source it
reports exactly the four `Do Sa Do` rows as standstills (8 beats, 0.000 travel); with the fix those four travel
3.5 units and nothing else moved.
**AND THAT PARAGRAPH'S NEXT CLAUSE WAS WRONG, AND IT IS THE REASON THE SAME GATE MISSED THE NEXT DEFECT IN THE
SAME CLASS.** It read "the 24 heading-only `Face *` rows and the 0-beat `Join Hands` are not standstills in this
sense" - which is true of the METRIC the probe used and false of the animation. That metric took the MAX over
every sampled beat, and the LAST sample IS the applied board, so a step that stands still for its whole duration
and snaps on the final frame scored exactly like one that dances. MEASURED with the metric repaired (`max` over
the samples BEFORE the last): **20 of the 51 steps moved NOTHING until the final frame** - `Heads`/`Sides`/
`Boys`/`Girls` x `Face Right`/`Left`/`Half`/`In`/`Out`, 1 beat each, 1.571 or 3.142 radians of travel. Reported
from use as "Heads Face right has a single transition between frame 0.9 and 1.0" while the whole-set
`Face Right` was smooth.
THE CAUSE IS THE SAME GUARD ONE LEVEL DOWN. `evaluateCallAt`'s scoped-coded branch asked "did anyone MOVE"
(POSITION only) before drawing the call with `interpolateSegment`, so a pure pivot - 0 travel by construction -
fell past it into the subset machinery, whose re-apply is `applyToBoardInner` on the CENTRED SUBSET: a call the
CATALOGUE has no authoring for, and MEASURED illegal there
(`applicator.applyToBoard(centredHeads, "Face Right")` -> "No setup in this call matches the current
formation"). `animateParallelBoard` then returned the board unchanged, so the step stood still and jumped on the
last frame. The guard is now "does the POSE change", heading included, and `interpolateSegment` already owns the
pivot shape - it rotates every heading and leaves a dancer whose pose is unchanged exactly where it stands - so
no new animation code was needed. MEASURED after: 0 of the 51 dead, least of the move already done at the
halfway beat **0.500**, and `Heads Face Right` turns 45.0 degrees by the halfway beat.
**AND THE PROBE WAS REGISTERED NOWHERE**, which is the other half of why the class hid: §5's rule is that a
probe nobody runs is already stale. It is now an entry in `engine/test/verify-suite.mjs`
(`scoped-coded-animation-probe`, `sub: 'tools'`, `light` - ~8s, 138 applies plus 33 samples each), so the
sentence it states is a gate rather than a file.

ALSO FIXED BY THE SAME CHANGE, a harness that had been red: `engine/test/scoped-dosado.mjs` (2 failures at
HEAD, "Heads Dosado moves exactly 1,2,5,6 (got none)") is now ALL GREEN - the same degenerate straight line
is why a scoped dosado charged its beats and moved nobody.

GATES: `npm run build --prefix engine`; `npx tsc -p poc --noEmit`;
`node engine/test/tools/scoped-coded-animation-probe.mjs` (green with the fix, exactly 4 reds without it -
and it is a registered harness now, not a file, so it runs in the `light` tier);
`node engine/test/scoped-dosado.mjs` (all green); `parallel-calls.mjs`, `modules.mjs`, `step-forward.mjs`,
`scoped-animation.mjs` and `selection.mjs` (all green, with the label expectations updated to `||`/`+`);
`behaviour-audit.mjs` at PASS 149 / FAIL 2 on BOTH revisions (the two reds are pre-existing and named);
`node poc/tools/verify-probes.mjs` reports the same 13 pre-existing reds and no others (44 probes), with
`parallel-lane-probe.mjs` rewritten for the new flow (the button never finishes, the lanes accumulate, the
active lane is narrowable, the unclaimed set is measured as ids, Done finishes).
VERIFIED IN THE BROWSER (Chromium against `poc/dist`, MS level, Static Square): a subset call applied as ONE
list row; `+ Parallel call` opened the remainder's lane, and the group selector then offered exactly the
narrowing list measured above; **Done** was enabled with the figure's own label in its title; Apply appended
to the active lane and the list stayed ONE row reading `Heads Promenade Full to Home || All Except Heads
Recycle`, with the balance sentence naming the step's own cost. The two refinements made after that build
(the ids-based emptiness and the narrowable empty lane) are covered by the probe and the type check only:
`vite 5.4.21` has no `--configLoader` (that is a Vite 6 option) and a Vite build in this sandbox needs
esbuild's piped-stdio service spawn, which the sandbox denies with EPERM, so the bundle was not rebuilt.

TWO THINGS THIS LEFT OPEN, recorded rather than papered over:

  - A scoped group call whose BARE name also matches the whole board still takes the whole-board branch in
    `evaluateCallAt`, and the comment above that branch claims the rule it does not implement ("A STEP WITH
    A SELECTION never takes the whole-board branch"). MEASURED in a lane: `Sides Pass Thru` as a lane call
    matches the whole board and animates the sides as nothing. Guarding the branch was tried and REJECTED by
    measurement: `Heads Pass Thru` animates correctly today only BECAUSE of that branch - its 4-dancer
    subset has no matching variant and the bare call does not apply to the centred sub-board, so the subset
    machinery draws nothing and the guard would turn a working call into a standstill. Fixing it properly
    means teaching the subset machinery that call, not switching the branch off.
  - A lane sub-call whose geometry the catalogue has no path for (`Dosado` mid-lane) still stands still
    while its beats are charged. Its end board IS its start board, so no two-point interpolation can draw
    it, and the coded rule for `Do Sa Do` is the identity (`fn: (b) => b`) with no `legs` to animate. The
    honest fix is a rule-level path for the call, not another interpolation.

THE SEQUENCER HUD IS REORGANISED AS A SEQUENCER. Asked for as: "The sequencer HUD has become quite
unintuitive and incoherent. Use best design practices for sequencers to redesign the HUD and possibly some
of the workflow to ensure it is intuitive and beautifully designed."

WHAT WAS MEASURED BEFORE ANYTHING MOVED. The panel was one flat stack of twelve rows and five text blocks
with no headings, and its ORDER inverted its own importance: `Margin` - an expert matching tolerance - was
the first control; the board-view row (Formation/Set/Rot/View) sat BETWEEN the call picker and the button
that applies it; the transport was below six search buttons and above the list it describes; the status line
that answers Add lived in the SEARCH row, beside "Copy positions"; the sequence itself - the thing the panel
exists to build - was last-but-four and set in the 11px `--dim` style reserved for footnotes while buttons
were 13px; nine readouts were written into nine blocks in DOM order; the panel's own `max-height:
calc(100vh - 24px); overflow-y: auto` scrolled everything together, so the transport and the list drifted off
screen; the sequencer had NO keyboard bindings at all (`installKeys` carried the grid plus
`editorUi.keyBindings()` only) while being the one panel with a playhead to drive; and 2206 calls were offered
with no filter box, though the Browse tab has had one throughout.

THE SHAPE NOW, and the four zones are the whole of the design: a SESSION line (Level, and a chip naming the
formation the sequence stands on), a FIGURE banner that appears only while a `while` figure is being built, a
COMPOSER (Who, Filter, Call, Add to sequence, While…, and the ONE status line under them), a TIMELINE (a row
per step with its label, its beats, a bar scaled to the LONGEST step, a `×`, and Undo/Redo/Clear), a pinned
TRANSPORT (play, ⏪/⏩ one beat, beat box, Speed, scrub), and four `<details>` drawers - Solve (getout ·
getin · fix it), Board, Library, Advanced - closed by default. The panel is now `display: flex` and does NOT
scroll; the TIMELINE is the only scrolling region. The readouts that mattered were promoted and the ones that
did not were demoted: the sequence went from 11px dim to 12px `--text` with beats and totals, while the FASR
reading moved into a drawer.

WORKFLOW CHANGES, each following from a measured incoherence rather than from taste:

  - ONE VOCABULARY. `Apply` is `Add to sequence` (and `Add to lane` inside a figure, from the same button),
    `+ Parallel call`/`Done` are `While…`/`Finish figure` with a badged banner and the panel's own edge
    tinted - the clone bar's language, because a figure IS a mode - and the five search buttons
    (`Getout`, `Matrix getout`, `Apply getout`, `Getin`, `Fix it`, which wrote into three different blocks)
    are ONE Solve drawer: three questions, one Search, results as CLICKABLE LINES, and one Apply that acts on
    the chosen line.
  - THE RIGID GETOUT IS THE SAME QUESTION, so it is a `rigid first` toggle that puts the one-call self-inverse
    answer at the top of the getout list, not a second button beside a preview button.
  - UNDO IS ONE SNAPSHOT PER ACTION, and it had to be: `Apply getout` pushed one history entry PER CALL, so
    undoing a five-call getout took five presses, and an All8 import replaced the sequence with no way back.
    A snapshot carries the START BOARD as well as the calls, because `Clear` resets both and undoing a Clear
    that restored only the calls would replay them from the wrong square.
  - A STEP CAN BE DELETED FROM ITS OWN ROW, and the sequence is replayed afterwards - so a step the later
    ones depended on can leave them unplayable, which is REPORTED (the row is flagged from the walk's own
    `stop`, the status line names the call) rather than silently dropped.
  - THE FILTER IS THE BROWSE TAB'S RULE, exported as `filterNames` beside `filterCalls` and applied to every
    list the picker offers (whole-set, subset, modules), keeping the selected call present - a view, never a
    load.
  - THE SEQUENCER HAS A KEYBOARD (Space, ←/→, Shift+←/→, Enter, Ctrl+Z/Ctrl+Shift+Z, Delete, Esc), installed
    in the app's ONE table and scoped by `when` exactly as the editor's are.
  - The sequencer gained the SPEED control it never had. It is its own, not the browse view's: that one runs
    a single call through the shared player, this one walks the whole sequence in its own frame loop.
  - Accessibility came with the layout: `role="status" aria-live="polite"` on the one status line,
    `aria-current="step"` on the playing row, tab-focusable timeline rows, `for`/`id` on the composer labels,
    and the app's first `:focus-visible` rule.

THE PLAYMARK MUST NOT REBUILD THE LIST. The row under the playhead is updated from `renderPlayhead`, which
runs once per FRAME, so it toggles two class names and nothing else (`markTimelineCurrent`), and the beat a
row starts on is read from starts computed once per rebuild (`stepStarts`) rather than from a
`sequenceBeats` call per frame - which would replay the whole sequence sixty times a second.

TWO REGRESSIONS THE GATES CAUGHT, both in probes that pin the panel's markup:
`escape-probe.mjs` failed because the timeline and the module list are new `innerHTML` sites (both escape, and
the probe's two checks were updated to the new markup rather than the escape being loosened), and
`call-beats-probe.mjs` failed because the picker's subset loop became `for (const [sel, names] of bySelShown)`
- updated, with a new check that the Filter narrows through the SHARED rule. Both were caught by
`verify-probes.mjs` reporting 14 failed where the baseline is 13.

GATES: `npx tsc -p poc --noEmit`; `node poc/tools/sequencer-hud-probe.mjs` (new: the zones, the drawers and
that they are closed, one status line/transport/undo pair, the timeline's data and its per-frame mark, the
vocabulary, the snapshot-per-action rule, the bindings and their scoping, and the four CSS rules the layout
depends on); `node poc/tools/call-filter-probe.mjs` (now also runs `filterNames` over real lists and checks
the sequencer's wiring); `node poc/tools/parallel-lane-probe.mjs` (updated for the new labels, with the
figure-banner checks added); `node poc/tools/verify-probes.mjs` reports the SAME 13 pre-existing reds and no
others (45 probes, from 44); `node engine/test/verify-suite.mjs all` unchanged - NO ENGINE FILE WAS TOUCHED
by this work.

THE BROWSER PASS IS OUTSTANDING, and the reason is the build rather than the design. A fresh bundle could not
be produced in this environment: `vite 5.4.21` has no `--configLoader` (it is a Vite 6 option - tried, and
the CLI rejects the flag), and a Vite build here needs esbuild's piped-stdio service spawn, which the sandbox
denies with EPERM. Serving the existing `poc/dist` would show the OLD panel, so nothing was gained by it. In
its place the structural gates carry what they can: every `el()` id is cross-checked against `index.html` (48
of them - the one failure mode `tsc` cannot see, since `el()` casts `null` to the element type and a renamed
id becomes a crash on first paint), the tag pairs are balanced, and the zones, drawers, timeline data, one-of-
each rule, bindings and CSS are all asserted by `sequencer-hud-probe.mjs`. What has NOT been seen is the
panel rendered: the layout at a real viewport, the timeline's own scroll against a 40-beat sequence, and the
keyboard against a focused control. The first person to run `npm run build --prefix poc` should check those
three.

A DOSADO IS DRAWN WITH NO TURN IN IT, SO THE PAIR SLIDES PAST EACH OTHER FACING THEIR HOMES. Reported:
"the Dosado has the 'All Except Heads' dancers flipping from infacing to facing the home positions. This is
some sort of incompatible end to start transition."

IT IS NOT THE TRANSITION, and the measurement is what says so. The reported step is
`Heads Promenade 3/4 to Home || All Except Heads ( Step Forward + Dosado )`, whose lane the walk charges
`[2, 8]` beats. Sweeping the animation at 0.01-beat resolution across those 10 beats: the worst heading
change in one sample is **0.29deg** and the worst position change **0.011 units**, so there is no
discontinuity anywhere - and the pose at the `Step Forward` -> `Dosado` boundary is exactly `lane.boards[1]`,
the board the APPLICATOR produced. The sub-calls agree with each other; nothing is incompatible.

WHAT ITS FACINGS SAY, corrected after the caller pushed back - see the WITHDRAWN note below. `Dosado` on this
corpus keeps every dancer facing the way it STARTED, while its position orbits the partner: the matched tam's
own facing targets are ~(3,0.2)/(2,-0.2), i.e. "carry on facing your own way", and the engine applies them
faithfully (the t=0/4/8 headings are 180/0/180 for `#3` and 0/0/0 for `#8`, and the whole-call sweep is a
few degrees of wobble). So as the orbit carries a dancer past its partner its FIXED facing ends up pointing at
its own home side and the pair is briefly side-on rather than facing each other - the "flip from infacing to
facing the home positions". A dosado keeps the pair facing each other as they circle, so what is missing is a
TURN, not a pairing.

THE WITHDRAWN EXPLANATION, recorded because it was committed and was wrong. This entry first claimed that
`Dosado` "has no usable authored variant for a squared set", that the coded rule refuses the board, and that
the animator therefore fell back to a tiling that invented a cross-set pairing - and on that basis proposed
pairing the dosado with the PARTNER beside you. EVERY PART OF THAT IS WRONG, and the caller was right to
challenge it. The measurement I had made was `findMatchingVariant` against the WHOLE 8-DANCER BOARD, which is
not how the animator looks for a path at all: `animateParallelBoard` partitions the board into groups and
matches EACH GROUP, where the corpus's 2-dancer `Dosado` tams live. Measured properly, the engine picks
exactly the tam the caller named - for the sides in the MIDDLE (2 apart, after `Step Forward`) the groups are
`3+8 | 4+7` and each matches `Dosado` / **`Facing Dancers Close`**; on a SQUARED SET (6 apart) the same pairs
match `Dosado` / **`Facing Dancers Far`**. Both are correct, both are `mapping=[1,0]` with `reflect=false`,
and both are drawn about the pair's own midpoint: 1.50 units of travel in the middle, 3.50 on the squared set.
The corpus's own `Facing Dancers Far / Facing Dancers / Facing Dancers Compact / Facing Dancers Close` are
four DISTANCE CLASSES of the same call, and the matcher separates them properly.

SO THE PAIRING AND THE TAM ARE RIGHT, and what is actually wrong is the FACING the tams carry. Measured, as
shipped, over the lane's dosado: the angle between each dancer's heading and the bearing to its partner has
mean **49deg** and worst **180deg** - at the middle of the call the pair is exactly BACK TO BACK, each dancer
facing its own home side. That is the reported flip, quantified.

WHY THE TAMS CARRY NO TURN, by construction rather than by accident. The rotate Bezier is
`(0,0) -> (cx3,0) -> (cx4,cy4) -> (x4,y4)` (`engine/src/convert.ts:89-95`; `cy3` is always 0, as the DTD
says), and `poseFor` reads it as a TURN: `a = angle(1) - angle(0)` (`engine/src/core.ts:111-131`). The
direction at t=0 is therefore ALWAYS +x, and the whole turn is carried by the last segment, `(x4,y4) -
(cx4,cy4)`. EVERY movement of every `Facing Dancers *` Dosado tam has `y4 == cy4`, so every one of them
encodes a turn of EXACTLY 0 - four zeros per path, both paths. The editor can author a turn only through that
last segment because its export writes `cx3=cx1 cx4=cx2 cy4=cy2 x4=x2 y4=y2` and drops the editor Bezier's own
`cy1` (`poc/src/editor.ts:2281`), so the y of the FIRST control point never reaches the file.

THE REFERENCE TAMS CANNOT BE PUT BACK IN THEIR PLACE, which was the first thing tried. `ms/dosado.xml` holds
both our editor's exports (the `Facing Dancers *` tams, which the matcher picks) and the tams the reference
authored with named moves (`<move select="Extend Left" .../>` - the four-move do-si-do). Loading ONLY the
reference tams makes the sides' 4-dancer sub-board produce NO groups and 0 beats: they do not place on these
boards at all, so deleting our exports would regress a scoped dosado to the standstill the previous record's
fall-through fix removed.

THE FIX IS A CORPUS RE-AUTHORING, AND THE FITTER HAS TO WORK AGAINST THE DRAWN POSES - which is what it now
does, and the corpus has been re-authored with it (`poc/tools/dosado-facing-fit.mjs`, run 2026-10-04). The turn
each movement needs is the change in the bearing to the partner, sampled on the DRAWN poses
(`evaluateVariantAt` with `rebase = false`, exactly as `animateParallelBoard` matches a group - a first attempt
composed the tam's own translations instead, came out with 0deg turns everywhere, and changed nothing, because
the matched variant is RE-BASED onto the board and the tam's frame is not the drawn one). Because `poseFor`
applies a movement's translation in the frame as it stands at that movement's START and only THEN turns the
frame, each movement's translation controls are rotated BACK by the accumulated turn, which leaves the drawn
path where it was.

MEASURED RESULT - 8 tams (the three `Facing Dancers *` classes x `Dosado` and `Left Dosado`), 64 movement
lines, every one of them a `y4`/`cy4` pair that had been equal:

  heading vs bearing-to-partner   middle pairs (2 apart)   mean 49deg -> **9deg**,  worst 180deg -> **29deg**
                                  squared set (6 apart)    mean 55deg -> **13deg**, worst 180deg -> **37deg**
  drawn PATH, shipped vs fitted                            worst **4.97e-16** units - float precision, unchanged
  last animated frame vs the applied board                  **0.0e+0** in both, and 8 beats still
  `scoped-dosado` / `parallel-calls` / `modules` / `step-forward` / `scoped-animation` / `selection`   all green
  `behaviour-audit`                                        PASS 149 / FAIL 2, the two pre-existing reds, the
                                                           same values as before the data change
  `verify-probes.mjs`                                      45 probes, the same 13 pre-existing reds

The residual 29-37deg is TIMING rather than geometry: the bearing turns at the pair's own pace while the
encoding turns with the rotate curve's own angle profile, so the facing lags by up to a quarter of a 90deg
movement - a tighter follow than a dancer could dance, and removable by fitting the curve's control points to
the bearing profile.

TWO THINGS ABOUT THE TOOL ITSELF, both worth keeping:
  - IT IS NOT IDEMPOTENT AND GUARDS AGAINST THAT. The counter-rotation is absolute, so a second run would
    rotate every path a second time; the shipped signature (every movement with `y4 == cy4`) is checked and
    anything else refuses unless `--force` is given. A re-export from the editor can therefore be re-fitted,
    but a fitted file cannot be double-fitted by accident.
  - IT COST A SILENT BUG TO GET RIGHT, and the bug is worth remembering: `cy4="0.2"` CONTAINS `y4="0.2"`, and
    so `cx4` contains `x4` and `cx2` contains `x2`. Every unanchored read and write of `x4`/`y4`/`x2`/`y2`
    landed on the neighbouring CONTROL point - so the first version that produced a real change wrote the turn
    into `cx4`/`cy4`, which turned the pair by 135deg instead of 360 and bent the path by 2.59 units. Anchoring
    the attribute names with a lookbehind is the whole fix, and the path deviation number is what caught it.

  - ONE SMALLER DEFECT, left alone: the matched `Facing Dancers Close` tam carries 6 beats of movement inside a
    call charged 8, so the last two beats are a HOLD (measured: every dancer STILL from t=6.5 to 8.0).

DEFERRED BY THE CALLER ONCE, THEN ASKED FOR: the diagnosis was recorded first ("leave it for now") and the
data was re-authored after "go for it". No engine change was needed, and none was made.

A FIGURE CAN BE RE-OPENED FROM ITS OWN ROW, so a slot's free beats can still be filled. Asked for as: "when I
click on a parallel slot in the sequencer, reload the parallel system so I can add more calls to the free
beats in the slot." A figure is ONE history step (`GroupStep`), and EVERY way out of the mode - `Finish
figure`, a new call, Undo, a group change - clears `parallel`, so after that the row was only a seek and the
lane it built could never be extended. Clicking it now rebuilds the mode from the STEP ITSELF
(`resumeFigure`):

  - the lanes are the step's own groups, so the banner and the picker describe the figure that is really in
    the list rather than a rebuilt guess;
  - the start board is the one `seekTo` has just put the LIVE board on, and the step is re-applied there
    PURELY (`applyToBoard`, which does not move the live board - the same call `applyParallel` uses). The
    assumption was measured rather than assumed: for a sequence `[call, figure, call]`, the board at
    `beatAtStep(idx)` IS the board step `idx` starts on, for every index;
  - the ACTIVE lane is the one with the MOST FREE BEATS, which is what was clicked for (ties leave the last
    lane active). MEASURED on the reported figure (`Heads Promenade 3/4 to Home` beside `Step Forward +
    Dosado`): the heads lane is 12 of 12 beats and the sides lane 10 of 12, so the resume opens on the sides
    lane with its 2 free beats.

TWO SUPPORTING CHANGES, both so the free beats are VISIBLE rather than only reported after an Add:
`laneFill` reads each lane's beats from the engine (its own apply, plus per-call `stepBeats` on the boards
that apply passed through) and the figure banner prints them beside the lane they belong to -
`Sides ( Trade + Touch a Quarter ) 6.0/16.0 b · 10.0 free`; and the group selector, which in the mode means
"who the next lane gets", now falls back to the ACTIVE lane when no lane can be opened, instead of going
empty on exactly the figures that claim every dancer.

A FIGURE ROW IS MARKED, because it is the one row whose click does more than seek: `⇄` in the row and the
sentence "Click to re-open this figure and add calls to its free beats" in its tooltip. `Enter`/`Space`
activate the focused row exactly as a click does, and the arrow keys only WALK the list - navigation is not
activation, and a figure is not re-opened because the focus passed over it.

GATES: `npx tsc -p poc --noEmit` clean; `poc/tools/parallel-lane-probe.mjs` grew a section for the resume
(only a group step re-opens, the lanes come from the step, the apply is pure, the active lane is the freest,
the mode is rebuilt from the apply's own board, the paint happens before the message, both click and keyboard
go through `activateStep`, the row marker, and that the fill comes from the engine); the HUD probe pins the
figure row's mark and tooltip; `verify-probes.mjs` reports the same 13 pre-existing reds and no others.

`Circle Four N/4` WAS A TURN OF THE RING THE ACTING FOUR STAND ON, DERIVED - AND THE DERIVATION IS NOW GONE.
Reported: "the Circle Four Left 3/4
seems to assign the wrong dancer from the correct group to each path in the call. They also seem to rotate 90
degrees at the start of the call. This suggests that there are some invalid dancer id mappings and an invalid
rotation comes with that." The slot was
`Heads Promenade 3/4 to Home || All Except Heads ( Step Forward + Circle Four Left 3/4 )`.
REMOVED at the owner's request ("I only want to remove the codedMove circleFourDef"): all eight titles are
catalogue calls, declared by the tams in `ms/circle.xml`, and he is authoring explicit tams for the boards the
rule used to answer. `engine/test/circle-four.mjs` pins the catalogue-backed state and REPORTS the one gap that
leaves; the paragraphs below are the record of why the rule existed and what it measured.

WHAT WAS MEASURED, and the report is right about the geometry being wrong - the cause is just not the lane.
`Step Forward` leaves the sides at `(1,-1),(1,1),(-1,1),(-1,-1)`, a 2x2 RING of four. The corpus's tams for
this call (`ms/circle.xml`) are three HALF-SET 2-path tams - `Facing Couples` at x=-2, `Facing Couples Compact`
at -1.5, `Facing Couples Far` at -3, each doubled to four dancers by the 180-degree mirror - plus 4-path
`Lines` and `Eight Chain Thru` tams. The match error is a SUM over dancers (`DEFAULT_MATCH_MAX = 1.5`), so the
nearest half-set (`Compact`: 0.5 per dancer = 2.0) MISSED: the sub-board matched NOTHING at any tolerance to 8,
the bare apply on it was refused ("No setup in this call matches the current formation"), the call is not
coded, and the lane charged 6 beats and drew 0.00 motion for the whole window. Scoped to the HEADS instead the
same call DID match - the doubled `Facing Couples Far` - with `mapping=[2,3,0,1]`, `reflect=false`, turning
22.1 degrees in the first frame and ~80 by the first beat and walking the heads onto the SIDE positions by
t=6: that fit is the wrong-dancer-and-rotation the caller saw, and it is the branch their build drew.

THE CORPUS'S OWN ANSWER IS THE AUTHORITY FOR THE FIX. Apply `Circle Four Left 3/4` to a Static Square and it
applies as TWO PARALLEL GROUPS OF FOUR (`5+6+1+2 | 7+8+3+4`), each ending 90 degrees counter-clockwise from
its start in BOTH position and heading - which is 3/4 of a circle clockwise, the same thing on a four-point
ring. So `Left N/4` is a turn of `-N*90` degrees, `Right N/4` of `+N*90`, heading carried round with it.

THE RULE, therefore, WAS the ring itself (`circleFourDef` in `coded-moves.ts`, all eight corpus titles): the
acting dancers had to be four on one ring - a common centre, equal radii within 25%, distinct bearings - and the
call turned that ring. It needed `applyToSelection` as well as `fn`, because `applyCodedToSelection` SKIPS a
coded rule that has a precondition when the selection is not everybody, and the reported case is exactly a
selection. A ring of EIGHT declined (the whole board), so the catalogue's two-circles-of-four reading kept
handling the squared set, which is what `catalogueFallback` was for. None of this is in the engine any more.

THE ANIMATION WALKS THE LEGS, and that was the second half of the fix. A scoped coded call was drawn by
`interpolateSegment(board, after, t)` - a straight line, which for a 3/4 circle is a CHORD across the middle of
the square. The scoped coded branch was changed to walk the rule's own `legs` on the CENTRED SUBSET (its
precondition asked for the acting four, never the board) and to put the subset back where it stands. The `legs`
mechanism itself stays: the `Swing Thru`s still use it.

MEASURED RESULT BEFORE THE REMOVAL (`engine/test/circle-four.mjs`, 30 checks, all green then):
  - the reported slot applies, and the sides' board CHANGES: `(1,-1),(1,1),(-1,1),(-1,-1)` with headings
    180/180/0/0 becomes `(1,1),(-1,1),(-1,-1),(1,-1)` with -90/-90/90/90 - a 90-degree turn of the ring in
    position (worst 5.0e-16) AND heading (0.0e+0);
  - the drawn path goes ROUND: furthest 2.828 units from the start, against 2.000 for the chord, on a ring of
    radius sqrt(2) - i.e. 270 degrees of arc;
  - the last frame IS the applied board (0.0e+0) and the heads keep promenading (the rule turns only the four);
  - the squared set still applies as TWO groups of four, and their turn is the +90 the rule derives (worst
    0.008 units, 0.69 degrees - the corpus's own authored wobble, #5 ending at 3.00,-0.99 heading -179);
  - a line of four is refused, and the rule's own precondition says why ("their distances from the centre vary
    by 1.00").

AFTER THE REMOVAL, measured from the repo root: `findCodedMove` is undefined for all eight titles; the catalogue
applies all eight from `Static Square`, `Normal Lines` and `Eight Chain Thru` (8/8 legal each), at CALLERLAB's 2N
beats from a squared set; the squared set still tiles as two groups of four and the `Left 3/4` tam still turns
the heads a +90 quarter (worst 0.008 units, 0.69 degrees); a line of four is still refused by the catalogue; and
the reported 2x2-ring slot still applies and still costs its 12 beats but its circle lane does NOT move - the ring
`Step Forward` leaves matches no tam, which is the gap the owner's tams have yet to close.

GATES BEFORE THE REMOVAL: `npm run build --prefix engine`; `engine/test/circle-four.mjs` (new, all green); `scoped-dosado`,
`parallel-calls`, `modules`, `step-forward`, `scoped-animation` and `selection` all green; `sequencer.mjs` at
its SEVEN pre-existing reds on both revisions (measured by stashing the three engine files and re-running);
`poc/tools/verify-probes.mjs` at the same 13 pre-existing reds and no others (45 probes).

THE PLAN'S ITEM A IS SHIPPED, and it was the last piece of the ring work that was not: refusing a scoped apply
that returns LEGAL BUT CHANGES NOTHING. The mechanism is exact: `applySelected`'s last fallback applies the call
"as the WHOLE formation performs it" and keeps only the selected dancers' poses, while `parallelApply` leaves
every dancer it did not tile exactly where they stand (its own merge is `movedById.get(d.id) ?? d`) - so when no
reported group holds a selected dancer the merge is an identity and the step is accepted as a legal no-op that
still charges its beats.

THE GUARD IS ONE CONDITION - refuse when `whole.parallel` exists and no group contains a selected dancer - and
it is that MECHANISM rather than "the selected dancers all end where they started", because a real call can do
exactly that. MEASURED over the ms catalogue x 4 boards x 6 selections: **81** scoped applies are legal AND
leave the board unchanged, and `Heads Forward and Back` is one of them (it is asserted as a control), so the
behavioural phrasing would refuse real calls.

THE WITNESS is the reported slot, pinned in `engine/test/selection.mjs`: from a Static Square,
`All Except Heads Step Forward` puts the sides on a 2x2 ring, and `All Except Heads Circle Four Left 3/4` on
that board has a whole-board reading that tiles the HEADS (`5+6+1+2`) and holds none of the selected 3,4,7,8 -
so before the guard the scoped apply came back LEGAL with the board UNCHANGED. It is REFUSED now, with the
whole-board reading of the same call on the same board still applying as the control, and the sibling fallback
controls (`Heads Star Thru`, `Centers Trade`) still applying cleanly.

MEASURED EITHER SIDE: `figure-census.mjs` **1 of 188 -> 1 of 188**, and `selection.mjs` **2 -> 1** with the new
checks in place (the survivor is the pre-existing tied-name red). The census does not move because it is
dominated by the corpus's missing `Promenade` (72 "unknown call" blocks); ON A TREE WHERE `Promenade` EXISTS
THE GUARD COSTS ONE FIGURE, `figm17`: its chain's `Heads Lead Right` was a silent no-op - from the board
`Heads Promenade 1/2` leaves, the whole-board `Lead Right` tiles the SIDES (`3+4 | 7+8`) - and the chain
"reached the wave" by skipping it. `engine/test/sequencer.mjs` now pins that stop rather than carrying it, and
the `Girls Circulate 2` reading that block exists for is measured on the canonical `Ocean Waves` board. THE GAP
THE FIGURE NOW EXPOSES is the heads' own `Lead Right` reading, which is a matcher/tiling question of its own.

ONE NUMBER THAT DID NOT REPRODUCE, recorded because it was in the same report: the status line read
`= 6 of 12 beats` for that lane, and this tree answers **10 of 12** - `Step Forward` 2 + `Dosado` 8, which is
the walk's own `[2, 8]` - and every `Dosado` / `Do Sa Do` / `All Except Heads Dosado` measurement returns 8,
never 4. The panel takes the per-call boards from the apply's own lanes, which is what makes it agree with
the walk here; the 6 was not reproduced and the caller chose not to chase it.

A START-POSE DRAG NOW TRANSFORMS THE SELECTION AS ONE BOARD, RATHER THAN SHIFTING IT. Reported: "When multiple
dancers are selected and I've selected Edit: Dancers: Position, when I move the highlighted dancer all the
other dancers move in lock step rather than using a board transform e.g. If I move a dancer towards the center
of the board, all dancers should move towards the center of the board. Currently they move using global
coordinates."

THE OLD RULE WAS DELIBERATE AND PINNED, which is why this is a REDESIGN and not a bug fix.
`poc/tools/start-pose-drag-probe.mjs` pinned "the same floor shift on every selected dancer" and measured two
rejected alternatives against it, and the Edit row's own tooltip promised that a drag "writes every selected
dancer by the same delta - so a set can be placed and turned without touching a single move". The report says
what that could not do: a drag that goes IN should move the set in, and a shift cannot, because it has no idea
where the board's centre is.

THE RULE, chosen by the caller from three candidates (scale + translate, full similarity, centroid pivot) and
one question about scope (start poses only, not the authored tracks):

    scale   = |p1| / |p0|          the focus's distance from the BOARD CENTRE, after over before
    (dx,dy) = p1 - scale * p0      whatever motion is left over
    p_i    -> scale * p_i + (dx,dy)

It is the only decomposition in which the dragged dancer lands EXACTLY where the pointer is AND the old
behaviour survives as a slice of it. WHY BOTH MATTER: the first is what keeps grid snapping meaning what it
says, since the snapped point is what the transform is taken from, so a Ctrl-drag still lands the dancer on
the line or the ring; the second is that a CONSTANT-RADIUS drag has `scale == 1` and `(dx,dy) == p1 - p0`,
which is the old rule - so sliding a set across the floor is still a drag at a constant radius, and nothing
that used to be possible was lost. A pure radial drag has `(dx,dy) == 0`, which is the report's example
exactly: everyone moves along their own radius by the same factor, and a dancer standing on the centre is the
pivot and stays.

A FULL SIMILARITY (scale + rotation) WAS OFFERED AND REFUSED, and the arithmetic is why the offer was wrong
for this report: a rigid turn about the centre moves the other dancers TANGENTIALLY, not towards the centre,
so it answers a different request. Rotating the positions is also the one thing this axis must not do - the
headings are the `rotation` axis's own business, and a second way to turn the set would leave two controls
disagreeing about one edit.

THE TRACKS ARE NOT SCALED, the second decision. The write stays `setDancerStart`, whose documented semantics
are that a start translation carries the whole path and a start heading turns it about its own start (pinned
by `features/call_editor.feature` and `engine/test/editor.mjs`). There is no primitive that scales an authored
curve, and inventing one would stop the axis being "a set can be placed, sized and slid without touching a
single move".

WHERE IT LIVES. The arithmetic is a new pure module, `poc/src/board-transform.ts`, for the reason
`grid-magnet.ts` gives for existing: a rule that has to be measured cannot live in `editor-ui.ts`, which builds
DOM and cannot be imported by a probe - and this probe used to MIRROR the write rules, which is one edit away
from measuring a copy of the rule rather than the rule. `start-pose-drag-probe.mjs` now imports what the panel
imports, and section 5 pins that the panel imports it, so the arithmetic cannot drift back into the pointer
handler unnoticed.

MEASURED RESULT (`poc/tools/start-pose-drag-probe.mjs`, re-based, ALL CHECKS PASSED - every worst error prints
as 0; the tolerances are 1e-9 to 1e-12):
  - 495 constant-radius drags: the board transform agrees with the old same-delta rule (worst 0), each track
    keeps its shape in that slice (0), and no heading moves (0 deg);
  - 3288 selected dancers and 4380 pairs over factors 0.6 and 2.0: every dancer's distance from the centre is
    multiplied by the factor (worst 0), every pair's distance scales by it (0), the scale IS the ratio asked
    for (0), and a selected dancer on the centre stays there (0);
  - 495 general drags: the focus lands exactly on the pointer (worst 0) and no unselected dancer moves (0);
  - the degenerate drags: a focus ON the centre has no ratio, so the drag is the plain translation, scale 1
    (worst 0 against the old rule) rather than a division by zero; a pointer dragged onto the centre means
    scale 0 and collapses the selection there, reachable only by an explicit drag on the origin and
    recomputed from the base each move, so dragging back out restores it inside the same gesture;
  - the rejected controls: copying the focus pose onto everyone breaks the new shape check by 12.5 units;
    orbiting the centroid preserves shape exactly and is caught only by the rotation axis's "moves nobody";
    and SCALING ABOUT THE DRAGGED DANCER - the plausible accident, since the dragged dancer is the pivot in
    the caller's hand - preserves the shape up to the same factor too (worst 0) and is caught only by the new
    radius check, which it breaks by 2.14 units.

FOUR PRE-EXISTING REDS IN THAT PROBE ARE FIXED BY THE SAME EDIT, recorded because they were not obvious: the
app's TypeScript and HTML are checked in with CRLF while the probes are LF, and four of the probe's section 5
structural checks were written with a literal `\n` inside a regex or a `replace`, so they could never match
and had been failing on their own. Measured by normalising the line endings with nothing else changed, all
four pass - which is why `verify-probes.mjs` reports one FEWER failed probe than the baseline below.

THREE USER-FACING STRINGS ARE PART OF THE RULE and were restated with it: the `position` axis's tooltip ("the
same floor shift is added to every selected dancer"), the `Dancers` button's ("Every selected dancer gets the
same DELTA, so the arrangement is preserved") and the Edit row's ("writes every selected dancer by the same
delta"). The probe pins both directions - the new wording is present, and none of the three still describes the
old rule.

GATES: `npx tsc -p poc --noEmit` clean; `start-pose-drag-probe.mjs` all green; `stage-sync-probe.mjs` green and
unchanged (this adds no new stage-sync state); `verify-probes.mjs` 45 probes and **12 failed**, against the 13
this file recorded for the previous revision. MEASURED, the 12 are `clone-refusal`, `connect-assign`,
`coords-gate`, `editor-level`, `facing-end-drag`, `facing-handle`, `formation-ref`, `formation-size`,
`move-beats`, `run-circle`, `start-facing` and `wysiwyg-path` - so the probe this work changed is NOT among
them and no new red was introduced; the count is one LOWER because that probe used to be one of the 13 (it is
the only probe file this work touched, and it is green). `poc/src/assets/formations.xml` and
`poc/src/assets/ms/dosado.xml` are modified in this tree by other work, so a strict before/after of the whole
probe suite would want those set aside. NO ENGINE FILE WAS TOUCHED and no data format changed.

OUTSTANDING: the drag has not been seen on the board. A Vite build in this sandbox needs esbuild's piped-stdio
service spawn, which the file sandbox denies, so the visual check is the reporter's, on the dev server already
running.

REVERTED ON REQUEST: THE ROTATION AXIS IS UNCHANGED. A board-turn rotation drag was built on top of the entry
above - the same centre pivot, each selected start orbited and its heading turned by
`bearing(focus -> pointer) - focus.heading` - and it was rejected on sight: "Undo that fix as it now rotates
dancers around the board center, Let me reassess the problem with the original version." The POSITION axis is
kept; only the rotation half is undone, and nothing had been committed, so the undo puts the tracked code back
exactly: `src/board-transform.ts` exports the two position functions and no rotation helpers,
`applyDancerStartDrag`'s `dh` branch is the original heading-only rule again, `index.html`'s rotation tooltip is
the original, section 2 of `poc/tools/start-pose-drag-probe.mjs` pins "a rotation drag moves nobody: every start
is exactly where it was" again with the centroid orbit as its negative control, and section 5 pins the two-name
import. THE ROTATION PROBLEM IS OPEN AND NOT YET CHARACTERISED: the reporter's point is that the obvious pivot -
the board's centre - is not what they want, so the axis needs its actual behaviour pinned down before another
rule is chosen.

THE CALL EDITOR MIRRORS THE SELECTED DANCERS' MOVES ACROSS ONE OF THE BOARD'S AXES. Reported as: *"Add a mirror
feature. Add an X and Y button that mirrors the selected dancers Moves across the axis indicated by the button.
Dont move the dancers start position or rotation, just their Moves. When multiple dancers are selected, the
mirror must use the translation around the board centre to ensure the board maintains its balance. put the
buttons below the Edit: line"*.

TWO DECISIONS WERE THE CALLER'S, and both were taken before any arithmetic: the buttons name the **BOARD'S**
axes - X the horizontal line through the board's centre, Y the vertical one - and the hand state **swaps left
for right**, which is what the corpus means by a mirror.

THE RULE IS ONE REFLECTION PER MOVE, ABOUT A FIXED DIRECTION IN THE DANCER'S OWN FRAME:

    beta        = phi - h0        the board axis (phi: 0 for X, a quarter turn for Y), in the DANCER's frame
    local point -> R(2*beta) * diag(1, -1) * local point

A path is authored in dancer-LOCAL coordinates, so `phi - h0` is the only reading of "the board's axis" that
exists in this data at all - and it is the one asked for, because a dancer already facing along the axis gets
`beta = 0`: a plain left-for-right mirror.

AND THE RESULT IS EXACT IN BOARD TERMS - measured at every joint and mid-move instant of every move of every
selected dancer:

  - **POSITIONS.** The mirrored world position is the original's mirror about the chosen board axis through the
    DANCER'S OWN START: `p' = M * (p - S) + S`.
  - **HEADINGS.** The mirrored heading is the original's mirror about the DANCER'S OWN FACING: `h' = 2*h0 - h`.

THE FIRST ONE IS THE REQUIREMENT READ THE OTHER WAY ROUND. The axis is the board's, through the **board
centre**, and the reflected track is then **translated** back to where it started - which is exactly what moves
the axis onto the dancer's own start, so the centre cancels and the rule needs no centre argument. That is also
why selecting eight dancers mirrors the set about ONE line rather than about eight dancers' own centres, which
is what "the board maintains its balance" asks for.

A RIGID MIRROR OF THE WHOLE TRACK WAS NOT AVAILABLE, and the split above is forced rather than chosen. A
reflection about the board axis maps the start heading `h0` to `2*phi - h0`; a track that both mirrored AND
still began facing `h0` would have to be the reflection about `h0`'s OWN line - the dancer's axis and not the
board's, the same picture from both buttons. Pinning the start pose, which is what was asked for, therefore
pins the two channels separately - and both of them exactly.

THE FACING CHANNEL IS MIRRORED ABOUT THE LOCAL +X AXIS, NOT ABOUT `beta`, and the file format is why. `poseFor`
reads a facing curve as the DIFFERENCE of its own tangents at `t` and `0`, so only its turn means anything, and
a reflection negates the turn whichever line it is about - the board axis adds nothing to it. What DOES matter
is that the format has no `cy3` (`bezRotAttr` writes `cx3 cx4 cy4 x4 y4`), so a facing reflected about a
non-quarter-turn `beta` comes back with a non-zero `cy1` and loses its first span the moment the file is
re-read. The local +X mirror is that same turn in the one form the format can carry - it is what
`facingFromTravel` re-normalises to, for the same reason (AGENTS.md §8 trap 18).

WHERE IT LIVES. The rule is `mirrorDancerMoves` in `engine/src/editor.ts`, exported by the package, because the
engine owns every geometric decision and a rule inside `editor-ui.ts` can only ever be MIRRORED by a probe. The
hand swap is the engine's own `swapLR` - the definition `reflect="-1"` already used - now exported so the probe
measures it rather than restating it. The panel's half is two `el()` buttons in a new row directly below the
Edit row, one handler (`mirrorSelectedMoves`), and one `commit`: the whole mirror is one undo step, and no scope
changes.

MEASURED (`poc/tools/mirror-moves-probe.mjs`, ALL CHECKS PASSED; about 10 s of which all but a tenth is loading
the corpus):
  - 495 calls, 3288 selected dancer-tracks and 21472 instants: worst POSITION error **1.6e-14** and worst
    HEADING error **3.6e-15** rad against an independently written "reflect about the board axis, then carry it
    back" - so the rule IS the requirement's own sentence and not an approximation of it;
  - the start pose (x, y, heading), every move's beat count and every UNSELECTED dancer come back
    **bit-identical (0)**, and **3196** of the selected tracks come out differently under X and Y;
  - **3122** named hand states: every one is the engine's own `swapLR` of the authored one, and every one
    changed;
  - mirroring twice restores the track (worst **4.4e-16** over 9122 moves) and every hand with it;
  - **3592** mirrored facing curves, **0** with a non-zero `cy1`.
  - THE COVERAGE GAP THIS FOUND, and it is the interesting number: of the corpus's 3288 dancer-tracks only
    **8** land on a `beta` that is not a multiple of a quarter turn, because the shipped start headings are
    axis-aligned. That is the case where a reflected facing curve stops being representable at all, and it is a
    state the PANEL reaches from the formation table's `head` column, so the probe **builds** it with the
    panel's own `setDancerStart`: 232 dancers re-headed 45 degrees off the axis, 464 mirrored tracks, 2992
    instants - worst position **7.5e-15**, worst heading **2.0e-15** rad, and **0 of 444** diagonal facings
    unrepresentable - and one of them is exported and re-read (`a1/square_chain_thru.xml` dancer 1, 45 deg, 6
    moves): the track comes back through the format's own four decimals to **3.8e-5**.
  - THE REJECTED RULES, each measured as the control for the check that rules it out: `beta = phi` moves
    positions by up to **12.65** and leaves headings perfect, so the heading check cannot catch it; `beta` from
    each MOVE's own heading is the same shape (**12.17**); the hands left alone are geometrically identical and
    caught only by the hand count (**464** moves); the facing mirrored about `beta` moves nothing and is caught
    only by the representability count (**222 of 222**); the facing turn left alone breaks the headings
    (**3.14** rad) AND the positions (**14.42**), because the frames ARE the accumulated turns; and ignoring the
    axis argument makes X and Y identical on every dancer while remaining a self-consistent mirror of X.

GATES: `npm run build --prefix engine` clean; `npx tsc -p poc --noEmit` clean; `poc/tools/mirror-moves-probe.mjs`
ALL CHECKS PASSED (10 s standalone, 15 s inside the suite); `node poc/verify.cjs` **2 FAILED**, exactly the
pre-existing `Circle Left` ring pair of TODO item 6; `poc/tools/verify-probes.mjs` **62 probes, 5 failed** - the
four TODO item 10 reds (`facing-handle`, `radial-arc-fit`, `run-circle`, `start-facing`) plus `offer-permission`,
which was MEASURED red with this change stashed and the engine rebuilt from master, so it is not this change's;
`npm run verify --prefix engine` **47 harnesses, 25 FAILED**, MEASURED TWICE - before and after the rebase onto
`ebf8c14`, with the same 25 names both times (1693.5 s and 1815.7 s) - which is the recorded baseline of TODO
items 5-7 and 9 and no new one (the first run's `callerlab-diff` ENOENT is the un-provisioned oracle AGENTS §10
describes: re-run after `extract-pdf-text.mjs` it is red for the two PINNED numbers TODO item 5 already names);
`npm run verify:light --prefix engine` **30 harnesses, 14 FAILED**, the same pre-existing subset; and
`book/tools/check-links.mjs` passes with the repo-wide encoding item in it (`make-animations --check` still
reports the pre-existing `DRIFT animations-index.json` of TODO item 8, so `check:book` stops there as before).

NOT CHECKED, and it is the same gap the start-pose drag records: **THE BUTTONS HAVE NOT BEEN SEEN IN A
BROWSER.** A Vite build in this sandbox needs esbuild's piped-stdio service spawn, which the file sandbox
denies, so the visual check is the reporter's, on the dev server already running.
