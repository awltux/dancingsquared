# Square Dance Engine Technical Specification

This document defines the computational model, mechanics, and terminology for a **Modern Western Square Dancing (MWSD)** call engine. Every movement is treated as a **deterministic state transformation** operating on an 8-dancer grid.

---

## 1. Core Terminology & Data Structures

### 1.1 The 8-Dancer State Space & Ghost Dancers

A square consists of **8 active dancer entities**. Each dancer entity maintains the following properties:

- **`id`**: Unique identifier (`0` to `7`).
- **`role`**: `BOY` (or Head/Lead) or `GIRL` (or Trail/Follow).
- **`couple_id`**: Home couple assignment (`1` to `4`).
- **`position`**: Absolute Cartesian coordinates `(x, y)` on a normalized floor grid.
- **`facing`**: Cardinal or ordinal heading vector (North, East, South, West, or directional offsets).
- **`role_flags`**: Metadata tracking original partners, corners, and active/inactive status.

#### Ghost Dancers and Imaginary Pairs

To resolve complex conceptual mechanics—such as phantom columns, incomplete boxes, or fractional formations where dancers must interact with missing partners—the engine supports **Ghost Dancers** (or *phantoms*):

- **`is_ghost`**: Boolean flag (`true`/`false`) marking non-physical entities.
- **`ghost_anchor`**: Reference ID of the active dancer or virtual axis the ghost is tethered to.

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
- **Collision Handling:** The engine must treat grid points as discrete snap-targets for end-states, while using vector interpolation for intermediate transition frames. Ghost dancers are omitted from spatial occupancy exclusion checks.

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
- **Singing Call Macro-Structure:** A standard segment consists of exactly 64 beats (subdivided into four 16-beat phrases). The engine's validator must ensure that any generated sequence sums to $64\text{ beats}$ (or accounts for continuous terminal actions like a Promenade).

---

## 5. Execution Rules & Collision Logic

- **The Passing Rule:** When two moving dancers' paths intersect head-on, they default to passing Right Shoulders, unless modified by a specific call parameter (e.g., Left Pass Thru).
- **Spatial Occupancy:** No two physical dancers may occupy the same $(x, y)$ coordinate space simultaneously during intermediate animation/transition frames. Ghost dancers bypass occupancy checks.
- **Resolution Logic:** An engine must track sequence parity to ensure that multi-call sequences can be deterministically resolved back to the home position using standard resolution lookup trees.
