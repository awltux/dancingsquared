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

---

## 4. Timing and Musical Phrasing

- **Metric Unit:** Square dancing operates strictly on musical beats. Standard hoedown and singing call tempo is $128\text{ BPM}$.
- **Beat-Weights:** Every call has a fixed integer beat cost (e.g., Pass Thru = 4 beats, Grand Square = 32 beats, Left Allemande = 8 beats).
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

Remaining planned work, in the order agreed:

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

1. **Aligned identity.** `recognize` gives the formation and, since step 2,
   `alignmentOf` gives arrangement (6), sequence (4) and relationship (4) — but the
   last two need a board that carries identity, which the formation templates do not.
   A board can now be said to BE an alignment; nothing yet *constructs* one (step 3).
2. **The FSM state drops the alignment.** It keys on the normalised formation only,
   so up to 96 alignments per formation become one state (§8 note: 6 arrangements ×
   4 sequences × 4 relationships).
3. **Alignment → board construction.** Needed to run any published get-out.

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
2. **The corner/right naming is reason-verified, not test-verified.** All8 publishes both
   halves of a cross-check — `[0B1c]` carries the resolve hint "AL", and the get-out
   fixture gives `[0B1p]` the get-out `Pass Thru > Allemande Left` — so Pass Thru from a
   `[B1p]` board must land on `c`, not `r`. Reproducing it needs a constructed board in a
   named alignment, i.e. step 3, so the confirmation belongs there.

Remaining steps: **3** generate a board per alignment by enumerating identity assignments
over the formation's spots (4!×4! = 576, classified and matched against the requested All8
id) — tractable with no new data, and it is what turns step 2's classifier from a reader
into a constructor; **4** re-run the fixture as a behavioural report giving, per get-out,
the call it stopped at and why.

### 9.2 Other open items

1. **Phase 3 — Amendment policy for synthesised boards.** `FsmStore.amend` requires
   a getout, and a getout is not found even from boards with full identity, so every
   amendment from a formation that was not danced to is rejected with "no getout".
   No UI wires this yet, so it is latent; the decision needed is whether to make the
   getout gate advisory (recording `getoutVerified` on the amendment) or treat such
   formations as unamendable. The caller-convention decision in §9.1 bears on this.
2. **Phase 4 — Coverage and spec alignment.** Audit checks for the bounded
   non-geometric matching exceptions (§8.2), a decision on the editor's
   "no match within tolerance" wording, and an explicit runtime-join check.
3. **Phase 5 — Hygiene.** `knownFormation` is the last loose-tolerance (6.0)
   outlier, deliberately permissive for legality; review whether it should follow
   the tight recognition threshold.

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



