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

### 7.2 Subset Formations

Most formations describe the **full 8-dancer set**, but some describe a **subset** — a smaller group of dancers (e.g. Facing Couples with 2, a Box of 4 or a Wave of 4 with 4, a Tidal formation with 6). These subset formations exist for two reasons:

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

Remaining planned work, in the order agreed. `HANDOVER.md` at the repo root is the consolidated
version of this section: what is done (with the numbers and the command to reproduce them), what
remains, the decisions already made, and the traps that have already bitten.

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

*`[P]` is a real, understood gap.* Beginning Double Pass Thru matches **no** fixed adjacent
place: its own diagrams show `P1c` pairing the outer couples side by side and the inner ones
as facing couples, because DPT genuinely mixes the two. That is precisely why All8 agrees a
reference pair for `[0L] [0B] [0F] [0W]` and not for `[P]` — so `P1c` and `P2r` cannot be
classified and are reported as a gap, not silently rounded. (`P3p`/`P4p` are unanimous and
fine.) The same applies to `[W]` and `[F]`, where no published alignment discriminates, so
nothing is recorded and only unanimous states are reported.

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

**Step 4c is DONE — `Promenade`, the standard finish, is no longer a call the engine knows
and cannot perform.** `assets/src/calls.xml` has always indexed it; `ms/promenade.xml`
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
2. **Move the All8 → engine call-name bridge into the engine.** `CALL_SYNONYMS` is empty, so
   `Touch 1/4`, `Cast Off 3/4` and `Do Sa Do` resolve only because the test harness maps them.
   Anyone consuming published choreography needs that bridge in the engine, where
   `canonicalName()` already applies it.
3. **Bare `Promenade` is DONE (step 4c).** Remaining from it: the `[B]` box promenade
   disagreement with All8 (3 lines), the fixed 8-beat timing, and the fact that a
   geometry-derived call is not in the precomputed FSM table (item 12).
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



