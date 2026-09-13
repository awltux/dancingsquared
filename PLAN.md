# Plan

**What is left, with the evidence for each.** This file now carries the *remaining work* only. The
chronological record of what was built, refuted and measured on the way here — rounds 1–39, Phases
0–19 — is in this file's git history and in `square-dancing.md` §9.1. What is kept below is: the
working rules, the measured state, the list of things that were refuted so nobody re-litigates them,
and the phases that still have work in them.

**Read in this order:** `HANDOVER.md` §1 and §3 (what the repo is, and the working rules — note its
§2 scoreboard is stale and this file supersedes it) → this file → `square-dancing.md` §9.1 for any
claim below you want the derivation of.

---

## 0. Working rules (unchanged)

Measure, do not reason — every claim in this file is a number produced by a checked-in tool or a
throwaway probe that was deleted before the commit. Correct the docs when the code disproves them;
record corrections rather than smoothing them away. Commit per phase. Write probes as `.mjs` files,
never `node -e`. Run `npm run verify --prefix engine` **in the background** (several minutes, exceeds
the foreground cap). Delete any `*-verify.txt` log before committing. Fixtures stay verbatim with
attribution to Rich Reel / all8.com retained.

Two habits this workstream has paid for repeatedly, and they are rules now:

- **A call that STOPPED is a symptom, not an owner.** At least four phases found the defect one call
  upstream (`Leaders Trade`, `Pass Thru`, `Walk and Dodge`, `Split Two`). Run `facing-audit.mjs` and
  a chain trace (`figure-trace.mjs`, `setup-split.mjs`) before authoring anything.
- **A probe that a call MATCHES a board says nothing about whether its paths are CORRECT on it.**
  `Sides Face, Grand Square` is the witness; a "mechanical copy" of a tam is a silently wrong board,
  not a fix.

---

## 1. Summary — what the engine is measured against

`engine/` is the TypeScript library under test; `poc/src/assets/` is the canonical tamination XML;
`taminations-flutter/` is reference **data and code to read, never to port**.

Three external oracles, plus one derived artefact:

| oracle | what it is | how it is read |
|---|---|---|
| **get-out corpus** | All8's published get-out lines (`getout.htm`) | `test/lib/getout-decode.mjs` + `test/getout-behaviour.mjs` |
| **figure corpus** | all 188 published Mainstream singing-call figures (`fig_m.htm`) | `test/lib/all8-figures.mjs` + `test/all8-figures.mjs` |
| **CALLERLAB** | the Mainstream definitions PDF (`docs/New_Mainstream_Definitions_26-03-29.pdf`) | `test/tools/extract-pdf-text.mjs` + `callerlab-diff.mjs` |
| **the FSM** | the resolve state machine built from the catalogue | `test/tools/fsm-getout-audit.mjs`; view asset via `poc/scripts/build-fsm-asset.mjs` |

Analyses (tools, not gates): `figure-census.mjs`, `figure-trace.mjs`, `facing-audit.mjs`,
`setup-split.mjs`, `setup-coverage.mjs`, `fsm-getout-audit.mjs`, `callerlab-diff.mjs`,
`determinism-audit.mjs`. Gates: `test/verify-suite.mjs` (`light` ≈ 15 s, `all` ≈ 290 s, 20 harnesses)
and `figures`, which is a **red target suite by design** (the finish line, not a gate).

---

## 2. Where it stands — last measured

| side | value | command |
|---|---|---|
| figures end-to-end | **101 of 188** | `node engine/test/tools/figure-census.mjs` |
| get-out: reached the finish and applied it | **140** | `node engine/test/getout-behaviour.mjs` |
| get-out: reached a state a finish resolves from | **13** | same |
| FSM | **155 states / 92 home / 43 nohome / 19 dead `@embed#N`** | `node engine/test/tools/fsm-getout-audit.mjs` |
| CALLERLAB | real gap is **2 (call, start) pairs + 24 formation names** | `node engine/test/tools/callerlab-diff.mjs` |
| gates | `verify:light` green; `verify` green; `verify:figures` **red by design** | `npm run verify --prefix engine` |

The figure census's blocking causes, re-measured this round:

```
   45  catalogue tam has no setup for this board      <- split below into AUTHORING vs BODY ERROR
    8  selection will not resolve on this board
    6  derived call refuses ("Sweep 1/4")
    6  derived call refuses ("Promenade")
    4  derived call refuses ("Swing Thru")
    4  other: "Rollaway" not legal for selected dancers
    3  unknown call (no catalogue entry)
    2  other: "Circle 2" not legal for selected dancers
    2  other: "Walk and Dodge" not legal for selected dancers
    1  each: Scoot Back | Promenade 1/2 | Turn Thru | Circulate | Walk Across | 8 Circulate 1 1/2
    1  derived call refuses ("Promenade Home")
```

The single most important reading of that table: **`catalogue tam has no setup` is not one owner.**
`setup-split.mjs` splits it by whether every intermediate board in the chain is a named formation —
`SETUP GAP` (a real missing authoring) vs `BODY ERROR` (an upstream call produced an arrangement the
engine cannot name, so authoring a setup would enshrine the bug). Both classes appear in the phases
below, and the census cannot tell them apart on its own.

---

## 3. Refuted — do not re-litigate

Each of these was tried, measured, and reverted. The measurement is what settles the question.

| hypothesis | measurement |
|---|---|
| filter `sequencer="no"` variants out of matching | 12 → 8 published get-outs resolve; the demos are acting as an ungated fallback |
| prefer eligible, fall back where a call has none | 12 → 11; the two `Boys Trade` copies are geometrically indistinguishable |
| apply CALLERLAB's temporary couple number per **board shape** | 98 → 96 figures; `couple` also carries Heads/Sides identity |
| …per **call name** (`Four Ladies Chain`) | fires, and moves **0** figures — a second defect masks it |
| drop `gender-specific` from `Allemande Left` | refuted by `features.mjs`'s `swappedG` gate (same-gender couples *are* improper) |
| `Star Thru` seam-2 authoring | legal, no figures, and does not reach its own target board |
| `Star Thru` seam-6 authoring | legal, **launders a collision** into a success (8 dancers, 4 spots, min distance 0.00) |
| `Touch 1/4` `scaleX = separation / 2` | at separation 6 it lands both couples on x = 0 — a collision |
| `Touch 1/4` seam-2 authoring | matches; **the end pose is not a formation**, so no figure is won |
| relax `partition`'s couple coherence for the Sweep | Sweep refusals 4 → 0 and figures 98 → **96**; the rule is what makes the tiling well posed |
| `Dosado` seam-2 authoring | no effect at all — its figures are not on seam-2 boards |
| `Split the Outside Couple` bridge | correct CALLERLAB rename, **0 figures** (re-attribution, not a win) |
| `Sides Face, Grand Square` as a mechanical tam copy | the tam's moves are in each dancer's OWN frame; matching is facing-independent, motion is not |
| "an unrecognised board is a defect" | the allemande pose, the grand ring and a pivot are legitimate dance states the engine has no template for |
| the 578-call `fixIt` list | inflated by a duplicate bug and by loose-tolerance force-fits; 18 is the real list |
| `Single Hinge` as a missing call | it is `Hinge` + a synonym; chasing it found a real matcher defect (reflected-motion, now fixed) |

Closed and shipped (do not reopen): `Trade`/`Run` derived; `Roll`; `Fold`/`Cross Fold`;
`Leaders Trade`; `Sweep 1/4`; `Join Hands`; `Split Two` bridge; `Box the Gnat` seam-6;
`Right and Left Thru` seam-2 (+3 figures); `Centers`/`Ends` grouping; `Circulate` from lines and
from a wave; the per-tam loader (two silently lost calls recovered); the decoder key work
(figure page 109 → 4 unread cells).

---

## 4. Remaining work

Sizes are stops in the 188-figure census unless stated otherwise. Every phase states its **owner**
(what has to change), its **instrument** (how you know), and its **gate** (what must not regress).

### Phase A — the body errors (P16a): the largest owner the census cannot see

**Owner:** the call that MINTED the unnamed board, one step upstream of the stop.
**Size:** 28 of 188 figures are poisoned by a body, and only ~13 of them stop *at* the poison, so the
census under-counts this class by more than half. Work order by reach:

| first unnamed board after | figures poisoned |
|---|---|
| `Heads Touch 1/4` | **4** (and ≥6 total — figm15/figm16 stop later, on `Walk and Dodge`) |
| `Allemande Left` | 3 |
| `Sides Touch 1/4` | 2 |
| `Girls Run` | 2 |
| `Square Thru 4` | 2 |
| `Centers Swing Thru` | 2 |
| `Sides Right and Left Thru` | 2 |
| `Extend` / `Boys Run` | 1 each |

**The head of it, measured and not yet fixed — `Heads Touch 1/4`.** The defect is inside the tam's
motion, not the match. Applying it to each of its own three authorings directly (`self-match
err=0.000`, so matching is out of the picture) gives a rectangle whose forward dimension tracks the
scale instead of collapsing to a box:

```
separation 4 -> (±1, ±2)      2 wide × 4 tall
separation 3 -> (±1, ±1.5)    2 wide × 3 tall
separation 6 -> (±1, ±1.5)    2 wide × 3 tall   <- the one the corpus needs
```

None is the 2×2 box a completed `Touch 1/4` produces, and partners end 3 apart where a right-hand box
has every adjacent pair 2 apart. `applySearch` returns the same boards, so nothing downstream masks
it. `scaleX = separation / 2` is **refuted** as the cause (it collides at separation 6), so the defect
is in the `Extend` + `Hinge` composition. The concrete next measurement — recorded so it is not
re-derived — is the reference's own `Extend Left` + `Hinge Right` pair at unit scale from separation 2,
where the two lateral components should cancel into a box; that row currently refuses, which is
itself the anomaly to explain.

**Instrument:** `setup-split.mjs`'s prefix scan (names every intermediate board) and
`facing-audit.mjs` (`pairs`/`closest`/`mutual`/`split` columns).
**Gate:** poisoned chains fall; each cleared chain must land on a NAMED board, not merely run further.

### Phase B — the authoring queue (P16c): genuine setup gaps, per call

**Owner:** the matcher's setup vocabulary — tams authored for one arrangement and one scale.
**Size:** the `SHAPE / NO-POSITIONAL-MATCH` class, ~25 rows, **no two sharing a call**; the
`mutual` column of `facing-audit.mjs` is what cuts it from 35 to 25. Current heads:

| call | figures | boards | state |
|---|---|---|---|
| `Pass Thru` | 5 | Quarter Tag, unnamed, Lines Facing Out, Tidal Wave | **4 of 6 re-attributed to Phase A** — no facing dancers, or two on one spot |
| `Star Thru` | 5 | 2 × Static Square, unnamed, Completed Double Pass Thru, Eight Chain Thru | adjudicated a **notation issue** for the bare-from-squared-set cases; the ECT case is the per-PAIR gender question (Phase E) |
| `Slide Thru` | 3 | 3 × Tidal Wave | open — needs its definition read |
| `Touch 1/4` | 3 | 2 × Trade By, unnamed | **blocked by Phase A's composition defect** |
| `Turn Thru` | 1 | Static Square | open |
| `Sides Face, Grand Square` | 1 (`figm170`) | Eight Chain Thru | a **definition read**: motion must be authored for the arrangement reached, not copied |
| `Grand Square` (bare) | 0 | — | curiosity: CALLERLAB names Static Square, the engine has only Butterfly/Blocks; not exercised by any figure |

**Method, non-negotiable:** the CALLERLAB definition first, then the rule/authoring, then validation
against the corpus — and `scaleX = separation / 2` is the law for *separation* gaps only (three
confirmed instances: `Box the Gnat`, `Pass Thru`, `Right Pull By`). Run both `facing-audit.mjs` and a
chain trace before writing anything.
**Gate:** each (call, board geometry) pair is covered by a setup or a derived rule, or recorded with
its reason; the census must rise.

### Phase C — the two missing conventions

Both are stated by CALLERLAB and absent from the engine. They are different kinds of work from an
authoring, which is why they are their own phase.

1. **The implicit adjustment after Fold/Cross Fold.** CALLERLAB, on "Heads Square Thru 4, Touch a
   Quarter, Girls Fold, Double Pass Thru": *"Double Pass Thru implicitly tells dancers that they
   should be in the starting formation for that call (facing Tandems) … generally accepted at
   Mainstream, particularly following Fold or Cross Fold."* The engine's matcher insists the board
   already IS the setup. Four cleared Fold chains now stop on `Yellow Rock`, `Star Thru`,
   `Ladies Chain` and `Turn Thru` because of this. The scoping is in CALLERLAB's own words — the
   calls that follow a Fold — and the gate must assert it fires nowhere else.
2. **"Active dancers continue."** CALLERLAB assumes the active set carries across calls; the engine
   has no active-set tracking. This is the `Right-hand Star` / `Centers` family, and it is also why
   `-BRun` is an approximation in the decoder (`-B` = "the Boy(s) AMONG THE DANCERS WHO WERE ACTIVE").
   Design before code: the active set has to be a first-class part of the board or the sequencer state.

### Phase D — the missing calls (Phase 14 residue)

**Owner:** `coded-moves.ts` (derived) or the catalogue (authored). Census `unknown call` is down to
**3**; this is the tail of the named set. Re-ranked by what is now known about each:

- `Circle 2` (2 figures), `Promenade 1/2` (1), `Trade 1 1/2` (1), `Walk Across` (1),
  `8 Circulate 1 1/2` (1), `Scoot Back` (1), `Turn Thru` (1), `Circulate` (1) — single-figure
  refusals, each "not legal for selected dancers" or a no-setup, so each wants a diagnosis before an
  implementation (`setup-coverage.mjs` classifies them).
- `Yellow Rock`, `Pass One`, `Separate Around Two` — named in the census and in CALLERLAB; read the
  definition before writing the rule.
- **`Square Thru 1` / `5` / `6`.** Real gap, and the reading is pinned: the reference's loop is
  `for (c = 1; c < count; c++)`, so `count == 1` never runs `Explode and Step to a Compact Wave` —
  `Square Thru 1` is *step to a compact RH wave* then *step thru*, with **no pull by in it at all**.
  Check that against a real dance before implementing; only 5 and 6 need `Explode` geometry.
- **`Explode and <call>` composition** (`Expl&`, 5 get-out lines) — the reference's template for the
  `1-1/2`, `1/2of-`, `Twice` and `&Roll` modifiers, three of which are already implemented as folds.
- `Centers Left Hand Star` (5 figures) is **not** here: diagnosed, its end state destroys the 4-dancer
  line structure the next `Centers …` call needs, so it is a **prerequisite of the `Sw&Pr` family**
  and gains 0 figures on its own. A derived star must make a group decision and preserve those lines.

### Phase E — stale identity and the per-PAIR gender rule (Phase 19)

**Owner:** the board's identity model. Two independent defects, both measured, and the first masks the
second:

1. **CALLERLAB's temporary couple number.** *"Once this has happened, she temporarily takes on the
   Head/Side identity and home position of that Man."* The engine never does this, so a
   `gender-specific` setup is matched against stale slots. The rule is right; the TRIGGER is the open
   design question — a board-shape test fails (98 → 96) and a call-name test fires but moves 0
   figures. The next measurement is per-call and per-CALLERLAB: decide which calls progress, and check
   the census for each.
2. **`Allemande Left`'s `from="Static Square"` authoring is `gender-specific` per SLOT, but the
   requirement is per PAIR** — each couple must be a man and a woman, **side-agnostic**. This is the
   concrete next change and it is small: `swingProblem` already has the per-pair shape ("couple N is
   not a man and a woman, so there is no partner"). Two named witnesses already exist —
   a **half-sashayed square must become legal**, and `features.mjs`'s `swappedG` (all genders flipped)
   **must stay rejected**.

**Instrument:** `facing-audit.mjs`'s `SPLIT COUPLES` class identifies this family without any chain
reasoning, and the `Promenade` ring-order refusals (6 in the census) read the same stale numbers.
**Gate:** `Allemande Left` is legal on the board `figm203` reaches; the census rises; `SPLIT COUPLES`
falls.

### Phase F — the CALLERLAB formation vocabulary (16b)

**Owner:** the formation vocabulary — the gap is **24 formation NAMES**, not 9 missing calls.

```
(A) "9 calls the engine cannot perform": EVERY one reports "figures using it: 0" - a name-matching
    artefact (Star Right / Star Left are implemented as Right/Left Hand Star; Square Thru is the
    1/2/3/4 family; Cast Off Three -Quarters carries an extractor space).
(B) the real pairs:  Dive Thru from "Facing Couples"; Grand Square from "Static Square"
    (its authored setups are Butterfly | Blocks, which is itself worth a look).
(C) 24 formation names the engine has no formation for, led by Couple (6 calls),
    Facing Dancers (5), Two-Faced Line (4), Ocean Wave (3), Box Circulate (2), Mini-Wave (2),
    Alamo Ring (2), then 1s.
```

**Work:** a checked-in mapping from each documented starting-formation name to the engine's
formation(s) — `Two-Faced Line` → `Two-Faced Lines`, `Ocean Wave` → `Ocean Waves`, `Alamo Ring` →
`Alamo Wave`, `Facing Dancers` → the facing-couples / mini-wave family — plus explicit decisions for
the names the engine has no formation for; then re-run the diff over all 51 (call, start) pairs.
**Gate:** every documented pair is matched by a setup, modelled as a derived start, or listed as a
justified exception with the definition quoted; `callerlab-diff.mjs` becomes a harness so it cannot
drift. Note the overlap with Phase 4e's blocked facing-variant work: this is the same vocabulary.

### Phase G — the FSM backlog, and a live determinism smell

**Phase 17 — 43 `nohome` states + 19 unnamed dead states.** The 43 are the exotic formations
(Diamonds, Galaxies, I-Beams, Butterflies, Siamese waves) that no published Mainstream figure walks;
measured, they are **UNCHANGED across six figures gained**, because completing a figure adds no state.
So this is the scoreboard for **route-finding**, not for the figure work — do not schedule it against
the census. Gate: 0 `nohome` states, or a recorded reason per state; the 19 `@embed#N` inline setups
named or explicitly excluded (a dead node with no name is not actionable); the FSM view asset
regenerated (`poc/scripts/build-fsm-asset.mjs`, which now imports the workspace engine **by path** —
`poc/node_modules/dancing-squared-engine` is a stale pnpm copy, not a link).

**Open item found while fixing the FSM:** the coded-first dispatch and the catalogue disagree on where
a call lands — 61 edges land somewhere `knownFormation` cannot name, 12 of them coded calls and the
rest names like `Boys Trade` / `Girls Run` / `Centers Run` that exist in BOTH vocabularies. The table
deliberately uses the application that admitted each edge; the divergence should be diagnosed on its
own, because it means the two paths produce different boards for the same call.

**Phase 10 — the determinism smell.** Running the corpus with an interleaved `knownFormation` query
after every call yields **20** figures instead of 8; `recognize` yields 8. At the divergence the two
procedures apply the SAME call to a byte-identical board and get different boards. Every attempt to
isolate the trigger came back clean (no board mutation, no shared start board, stable queries), and
every real consumer uses the stable convention — so it does not block anything, but it is a live
correctness smell and it stays open. Done-when: both procedures agree, and `determinism-audit.mjs` is
promoted into `verify`. Note the convention is pinned in the tools meanwhile
(`figure-census.mjs` = 8, `fsm-getout-audit.mjs` = 20) so the two numbers cannot be compared by
accident.

**Standing (Phase 7):** keep `poc-matrix/` out of `verify`, and run `map-tips.mjs` whenever the FSM is
touched. `transitionTable` costs **36.8 s / 155 states / 1961 edges** on the 274-call Mainstream
catalog, and `legalCalls` is ~99% of it.

### Phase H — the solver side (the Phase 3 leftover)

**Owner:** the search's remaining C term. `[P4p]`'s failing getout (`maxCalls=3, budget=400`) now
answers `null` in **11.5 s** (was 95 s) and does `candidateScans=17` for 447 nodes — those 17
catalogue scans ARE the 11.5 s. The quadratic L × C term is gone (`eqScans=0, eqIters=0`).

**Work:** index the catalogue by start formation. `library.allVariantSetups()` is still the flat list
that **drops the call name**; making it `{ name, setup }[]` is the minimal change, then pre-filter the
per-name loop with a mirror-aware signature map. **Do not build it as an FSM table** — that is
O(states × catalogue), which is what killed the 20-minute build.
**Gate:** `[P4p]` keeps its `null` answer and stays bounded; `GETOUT_SWEEP=1` still reports 27 of 28
alignments and the `[P4p]` timing bound.

### Phase I — decoder residue (small, and mostly deliberate)

- **4 unread `fig_m` cells, all malformed SOURCE** — `--1/2` (ambiguous, two readings fit equally),
  `--Keep` (not in All8's key), `H-meet-T1/4` (prose in a call column), `S-` (orphaned designator left
  by a blanked quoted aside). **Do not guess any of them**; they are documented in `all8-notation.ts`.
- `Expl&` composition — see Phase D. `1-1/2`, `1/2of-`, `Twice` and `&Roll` are done.
- `/-SqTh4`: the `/` designator appears in **no** designator list in All8's key and occurs exactly
  twice, both on the same cell, so its scoping has no other context to be learned from.
- `-BRun` is **the table's only approximation** — All8's `-B` means "active boys", and the engine has
  no active-set tracking, so it maps to `Boys Run`. Recorded in the table, not hidden.
- `Outsiders` is not a selection the engine knows, so `O-SqTh3` composes but cannot be performed;
  declared.
- `KNOWN_CATALOGUE_GAPS` is **one list, in the engine**, re-exported by `getout-decode.mjs`, and
  `getout-conformance.mjs` fails if it goes stale in either direction. Keep it that way.

### Phase J — tie-break leftovers (Phase 18)

The catalogue tie-break is now level-ordered, but **level is a proxy** — it says "prefer the later
programme", not "prefer the authoring that round-trips". Two cheap turns not taken:

- `Circle Left 1/8` is the one fraction that is not exact (residual 0.448), and `display="no"` is a UI
  hint the matcher does not read, so it is registered and matchable like any other setup.
- The `from`-overlap question has been swept for **one** multi-level title; the other **231** are
  unswept. This is a per-call measurement of "which authoring is right" — exactly the measurement that
  found this one.

### Phase K — the target suite (the finish line, not a gate)

`npm run verify:figures` is red **by design** and should stay that way until the work is done:
**4 unread cells** and **22 call names** the engine lacks, with **101 of 188** figures running from
Static Square. It is the finish line the user set ("once the engine has fixed existing edge cases"),
excluded from both verify tiers on purpose. Two small stale readings it still carries: `verycenters`
is preserved as its own 2-dancer case (deliberately, so the `Centers` fix could not change any
`Very Centers …` asset) and `outside6` follows it; and `Centers In` / `Heads Pass Thru` still refuse
from `Normal Lines` — a different cause (no matching variant; `couple=0` on an identity-less board).

---

## 5. Blocked, and recorded so nobody re-opens them

These are Phase 4e's remainder. Each was probed to a definite answer and each needs a **source of the
same authority the separation law had** before it can move — a facing is the choreography, whereas a
separation is only the call's scale.

- **Facing-mismatch variants** (`Scoot Back` 2 stops at best error **1.571** against a 1.5 tolerance;
  `Bend the Line` / `Ends Fold` at 3.142; `Swing`, `Do Paso`, `Extend`). All are FINITE at tolerance
  100 and all are dominated by π/2 multiples, so the shape and positions are right and only the
  facings are wrong. Nothing available pins them: **59 of 66 `ms/` files are byte-for-byte identical
  to upstream**, all 7 that differ are our deliberate additions (22 tams, none removed or altered),
  and the reference's hand-coded implementations are **structural, not motion** (`ScootBack extends
  SplitCall` has no `performCall`; `Extend` has no sequencer implementation at all). Deriving a facing
  means asserting how the call is danced.
- **`Single File Promenade` from `Columns`** (6 of its 8 stops are from boards `knownFormation` cannot
  name). Measured: the stop boards really are `Columns`, the call has **exactly one variant**
  (`from="Static Square"`, inside `ms/promenade.xml`, byte-identical to upstream), and the best error
  at tolerance 100 is **16.378** — not a π/2 multiple and not a spacing adjustment. It is a different
  piece of choreography, not a scaled variant.
- **The unrecognised-board criterion.** `knownFormation === null` is **not** evidence of a defect: 48
  transitions are the allemande pose, 47 the grand ring, 22 a `Roll` pivot (which by construction
  leaves positions alone and rotates facings, so it cannot leave a formation match). These are
  legitimate transient dance states with no template. The real open question is the inverse — **what
  distinguishes a legitimately unnamed state from a wrong board** — and the closest thing to an
  instrument today is `facing-audit.mjs`'s BODY ERROR class plus the `setup-split.mjs` prefix scan.
  Settle that criterion before touching this bucket.
- **Bare `Star Thru` from a squared set** (`figm228`, `figm229`): a notation issue — a caller would
  say `Heads Star Thru` or `Sides Star Thru`, and the whole board tiles into two facing-couple boxes
  whose centres are the SAME point, so the call as transcribed cannot be danced without a collision.
- The **`Promenade` ring-order refusals** (5–6 figures) are kept deliberately: forming the ring is
  part of the call (so the ring geometry is not a precondition), but the second job the old band did —
  refusing a body that has fallen apart — was replaced by a collision guard at 1.0, and the two
  broken boards that guard refuses are the point of it.

---

## 6. Recommended order

**Phase A (body errors) first.** It is the largest owner the census can see and the one it
systematically under-counts; `setup-split.mjs` already names the calls and `Heads Touch 1/4` costs at
least six figures. Then:

1. **Phase E** — the per-PAIR gender rule for `Allemande Left`: small, two named witnesses, and it
   unblocks the identity family the `SPLIT COUPLES` instrument already tracks.
2. **Phase B** — the authoring queue, call by call, definition first. Run `facing-audit.mjs` and a
   chain trace before each row.
3. **Phase D** — the named missing calls (`unknown call` is down to 3, so this is bounded work).
4. **Phase C** — the two conventions; design before code, both have board-wide blast radius.
5. **Phases F, G, H, I, J** — vocabulary, FSM/determinism, the solver index, decoder residue,
   tie-break sweeps; independent of each other and of the figure work.

The closing judgement from the last rounds, kept because it should shape expectations: **the
remaining refusals are STACKED.** A coverage fix at call N generally reveals a different defect at
call N+1 rather than completing the figure, so the figure count moves less than the number of defects
fixed. Treat it as a **lagging indicator**; the leading indicators are the cause table, the
poisoned-chain count and `facing-audit.mjs`.
