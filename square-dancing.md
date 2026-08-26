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
- **Named-group execution:** different calls are danced by **different named sets** of the dancers — e.g. Heads and Sides, Boys and Girls, Centers and Ends, or Couples 1–4. Each named group is itself a subset, so the subset formation is the unit the call acts on.

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


