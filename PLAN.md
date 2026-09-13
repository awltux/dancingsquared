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
| figures end-to-end | **107 of 188** | `node engine/test/tools/figure-census.mjs` |
| get-out corpus: reaching a state the standard finish resolves from | **122 of 265** (was 116) | `node engine/test/getout-behaviour.mjs` |
| … of which ended by applying the finish itself | **110** (was 105) | same |
| … decoded but stopped at a call (the body gap) | **110** (was 115) | same |
| FSM | **155 states / 92 home / 43 nohome / 19 dead `@embed#N`** | `node engine/test/tools/fsm-getout-audit.mjs` |
| CALLERLAB | real gap is **2 (call, start) pairs + 24 formation names** | `node engine/test/tools/callerlab-diff.mjs` |
| gates | `verify:light` green; `verify` green (20 harnesses, ~295 s); `verify:figures` **red by design** | `npm run verify --prefix engine` |

The figure census's blocking causes, re-measured after Phases A and E:

```
   42  catalogue tam has no setup for this board      <- split below into AUTHORING vs BODY ERROR
    8  selection will not resolve on this board
    6  derived call refuses ("Sweep 1/4")
    4  derived call refuses ("Promenade")
    4  derived call refuses ("Swing Thru")
    3  unknown call (no catalogue entry)
    2  other: "Circle 2" not legal for selected dancers
    2  other: "Walk and Dodge" not legal for selected dancers
    1  each: Rollaway | Do Sa Do | Scoot Back | Promenade 1/2 | Turn Thru | Circulate | Walk Across | 8 Circulate 1 1/2
    1  derived call refuses ("Trade") | ("Promenade Home")
```

**Three phases landed in the session that rewrote this file.** Two cleared a body defect and moved
their chains DEEPER without moving the figure count (the stacked-refusal shape this plan keeps
recording); the third **won two figures**:

- **Phase A (done)** — `Touch a Quarter` ended in a 2-wide, 3-tall rectangle instead of the 2×2
  right-hand box CALLERLAB's ending names; fixed in `ms/touch_a_quarter.xml` (the net lateral of
  `Extend Left` + `Hinge Right` must cancel, so neither move may carry a `scaleY`). Cleared one
  `COLLISION` body error in `facing-audit.mjs` (48 → 47 refusal boards) and made `Heads Touch a
  Quarter` land on the centre box CALLERLAB's Squared Set Convention describes; `figm14` now runs two
  calls further.
- **Phase E item 2 (done)** — `Allemande Left`'s gender requirement is per COUPLE, not per slot
  (`PAIR_GENDER_CALLS` in `matcher.ts`). `Allemande Left` is now legal on the board `figm203` reaches,
  its chain runs to call 5, and `facing-audit.mjs`'s `SPLIT COUPLES` class fell **2 → 0**. **PLAN.md's
  own Phase E step was built on a factual error, corrected here: `features.mjs`'s `swappedG` is NOT "a
  square of four same-gender couples" — flipping every gender in a normal square leaves every couple
  one boy and one girl, so `swappedG` IS the half-sashayed square.** Its assertion was the opposite of
  CALLERLAB and is corrected; a genuine same-gender-couples witness now sits beside it.
- **Phase E item 1 (done, 101 → 103 figures)** — CALLERLAB's TEMPORARY COUPLE NUMBER, read where
  identity is USED rather than written onto the board. See the section below for the measurement and
  for why the two earlier reverts do not apply to this placement. **The get-out corpus gained five
  lines across the session's three phases (116 → 121 reaching a resolve state).**
- **And two refutations recorded** — the `Swing Your Partner` end pose, modelled as a local closure of
  co-oriented couples (**103 → 95 figures**), and reading the same couple-number convention inside the
  Sweep's `boxGroups` (Sweep refusals 6 → 4 but Promenade 4 → 6, figure count unchanged, and the
  resulting boards collide). Both are reverted and both are recorded beside the code.
- **And a FOURTH separation fix, the largest single win of the session (`Rollaway`, 103 → 107
  figures).** The corpus reaches `Rollaway` from boards whose couples stand **two** apart (an
  `Eight Chain Thru`, a `Quarter Tag`) while the only `Facing Couples` authoring placed them four
  apart, so five figures refused. A Rollaway is a per-couple HALF SASHAY, so its displacement is the
  couple's own width and does not depend on how far two couples stand apart — the paths are in each
  dancer's own frame, so the same paths at separation 2 give the same swap. Authored inline at
  `x = -1` in `b1/sashay.xml` and gated in `sequencer.mjs` (both separations must end with each
  couple's dancers exactly exchanged, facings unchanged — which the figure count cannot see).
  **The separation recipe's tally is now: `Right and Left Thru` +3, `Box the Gnat` +1, `Rollaway`
  +4, and the zero-figure instances `Square Thru 4`, `Flutterwheel`, `Star Thru` (reverted),
  `Touch 1/4` seam-2 (reverted) and `Dosado` (reverted).**
- **And `Do Sa Do` derived as a measured IDENTITY (`0 figures`, and it is kept knowingly).** The
  authored tams are a net no-op — from `Normal Lines` and from an `Eight Chain Thru`, worst position
  change **0.000** and worst heading change **0.00°** — so in this net model the call is
  formation-INDEPENDENT and the setups were only limiting which boards it could be reached from. It is
  now a coded move (identity + "every dancer has a mutual facing partner" as the precondition, with
  `catalogueFallback` so a board the rule declines keeps the authored tams). **Measured: all three
  `Do Sa Do` stops are gone from the census, two of those figures move DEEPER onto `Allemande Left`,
  and the figure count does not move (107).** Kept because it is a correctness fix with a measured
  identity and it improves attribution, not because it pays; the honest cost of `catalogueFallback` is
  that when both readings refuse, the catalogue's message is the one that surfaces.
- **And `Allemande Left` can now follow ITSELF (`0 figures`, two of its three stops fixed).**
  CALLERLAB's command example is literally *"Allemande Left Your Corner; Dosado Your Partner;
  Allemande Left Your Corner"*, and Case 2's starting formations include a Trade By — but every
  authored setup was a Static Square with the HOME facings, so the allemande pose (the engine's own
  result, labelled `O Trade By`) matched none of them: **every variant NULL even at tolerance 100 with
  gender required**, and three census figures stopped there. The new tam is the pose's eight slots as
  an inline formation with the sibling's paths, and it is deliberately **NOT `gender-specific`**,
  unlike its siblings: the motion belongs to the SLOT, not the occupant, and six of the eight slots
  hold the other gender once the couples have progressed (measured on `figm167`/`figm171`, whose
  chains reach the pose through `Four Ladies Chain`). Declaring genders would have needed two copies
  of the tam and would still gate on a fact the motion does not depend on. `Allemande Left` stops
  **3 → 1** and the get-out corpus is unchanged at 122.

All three sides re-measured at the end of the round: figures **107 of 188**; get-out **122 of 265**
reaching a resolve state (110 applying the finish, 110 body stops); FSM **155 / 92 / 43 / 19
unchanged**; CALLERLAB **unchanged** (the 9-of-45 row is still the name-matching artefact, and the
real gap is still 2 (call, start) pairs + 24 formation names).

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
| read the temporary couple number in `boxGroups` too | the tiling of a `Normal Lines` board IS blocked by the stale pairing, and unblocking it (Sweep refusals 6 → 4) is still **wrong**: those boxes are FOUR apart, so a box 2 wide × 4 tall rotating 90° about its own centre becomes 4 wide × 2 tall and the two boxes meet at x = 0 with four dancers on two spots. The figures then refuse on `Promenade` from an UNNAMED board (4 → 6) with the figure count unchanged. The refusal was right and only its REASON was wrong — a board of lines cannot Sweep at all on this geometry. **The trap is now closed at the source**: `sweepCollision` refuses the swept board with that reason, gated in `sequencer.mjs` with a witness that tiles cleanly |

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

**STATUS: the head is DONE** (`Heads Touch 1/4`, shipped and gated — see §2). What follows is the
measurement that found it and the queue behind it.

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

**The head of it — `Heads Touch 1/4` — WAS THIS DEFECT, and it is fixed.** The tam's motion was
wrong, not the match: applying `Touch a Quarter` to each of its own three authorings directly
(`self-match err=0.000`, so matching is out of the picture) gave a rectangle whose forward dimension
tracked the scale instead of collapsing to a box:

```
separation 4 -> (±1, ±2)      2 wide × 4 tall
separation 3 -> (±1, ±1.5)    2 wide × 3 tall
separation 6 -> (±1, ±1.5)    2 wide × 3 tall   <- the one the corpus needs
```

None is the 2×2 box a completed `Touch 1/4` produces. The cause is the `scaleY` the tams put on ONE
of the two moves (`Extend Left scaleY=".5"` on one path, `Hinge Right scaleY=".5"` on the other):
the step to the wave dodges one unit sideways and the hinge brings it back, so the net lateral is
what must cancel and halving either one leaves a residual 0.5. With both unscaled, separations 3 and
6 both end on the four distinct spots of a right-hand box, and `Heads Touch a Quarter` from a Static
Square lands the four heads on the centre box facing east/west — CALLERLAB's worked case, board for
board. `scaleX = separation / 2` was **refuted** as the cause here (it collides at separation 6).

**Still open in this phase:** the queue below, minus `Heads Touch 1/4`.

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
| `Star Thru` | 5 | 2 × Static Square, unnamed, Completed Double Pass Thru, Eight Chain Thru | **NOT fixable by Phase E's relaxation** — see below |
| `Slide Thru` | 3 | 3 × Tidal Wave | open — the 3 Tidal Wave boards are the same class Phase A's `Pass Thru` measurement found (bodies with no facing pairs), so diagnose before authoring |
| `Touch 1/4` | 3 | 2 × Trade By, unnamed | the facing-couples end pose is FIXED (Phase A); these three are other boards |
| `Turn Thru` | 1 | Static Square | open |
| `Sides Face, Grand Square` | 1 (`figm170`) | Eight Chain Thru | a **definition read**: motion must be authored for the arrangement reached, not copied |
| `Grand Square` (bare) | 0 | — | curiosity: CALLERLAB names Static Square, the engine has only Butterfly/Blocks; not exercised by any figure |

**Method, non-negotiable:** the CALLERLAB definition first, then the rule/authoring, then validation
against the corpus — and `scaleX = separation / 2` is the law for *separation* gaps only (four
confirmed instances now: `Box the Gnat` +1 figure, `Pass Thru`, `Right Pull By`, and **`Rollaway` +4**,
whose case also shows the limits of the law: a HALF SASHAY does not scale with the separation at all,
because its displacement is the couple's own width, so there the fix is the same paths on an inline
formation at `x = -1` rather than a rescaled move). Run both `facing-audit.mjs` and a chain trace
before writing anything.
**Gate:** each (call, board geometry) pair is covered by a setup or a derived rule, or recorded with
its reason; the census must rise.

**`Star Thru` cannot use Phase E's per-couple relaxation, and the reason generalises.** Its ECT case
is the same shape as `Allemande Left`'s — a setup that overlays the board at error 0.000 with gender
ignored and NULL with gender required — but `Star Thru`'s MOTION is slot-sensitive (the woman turns
while the man steps), and the match's mapping is geometric, so relaxing per couple would apply the
man's path to the woman. That is the rule for `PAIR_GENDER_CALLS`: only calls whose motion is
gender-symmetric may go on the list.

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
3. **`Split Two` is the first concrete case, and its blocker is MEASURED — including an attribute the
   engine reads from nobody.** The call IS in the catalogue, under a file whose name hides it:
   `ms/split_the_outside_couple.xml` is a tamination titled **`Split Two`** whose tams are
   `Centers Split the Outside Couple` and `Centers Split Two`, each `formation="Eight Chain Thru"`
   with **`actives="Centers"`** — and each carrying FOUR `<path>` elements, i.e. the four ACTIVE
   dancers only, with the motion `Extend Left scaleY=.5` + `Extend Right scaleY=.5` = **net forward 2,
   no lateral, facing unchanged**, which agrees with the reference's `split_two.dart` (actives advance
   `dist/2 + 1`; tandems `Forward_2`; inactives step apart and back, ending where they started).
   `grep actives engine/src/convert.ts` returns NOTHING: `actives`, `group` and `display` are parsed by
   nobody, so those four paths are registered as a whole-board setup — the recorded "1 setup, n=8,
   positions `b(-3,1) g(-3,-1) b(-1,-1) g(-1,1)` listed TWICE" — which is why applying the call moves
   all eight by 2 (a whole-board `Pass Thru`) and why the bridge's four figures then stop on
   `Touch 1/4` from a bogus `Trade By`.
   **And the active set cannot be guessed geometrically.** On the board `figm109`/`figm112` reach
   (`Heads Square Thru 4` from a Static Square, an Eight Chain Thru), the PHYSICAL couples are
   `(#1(1,1)@E, #6(1,-1)@E)` and `(#2(-1,1)@W, #5(-1,-1)@W)` in the centre, `(#4(3,1)@W, #3(3,-1)@W)`
   and `(#7(-3,1)@E, #8(-3,-1)@E)` outside — parallel facing couples 2 apart. If the centre couple is
   active and "actives advance 2, inactives end where they started", the actives land **exactly on**
   the outside couple: the rule is unsatisfiable there. So the actives have to come from the call's own
   `actives` attribute (or a designation), not from the board.
   **Work, in order:** parse `actives` in `convert.ts` and carry it on `TamRaw`/`CallBundle` so a
   subset-authored tam is not mis-registered as a whole-board setup (this alone is a correctness fix
   for every such tam, not just this call); then decide the apply path — the engine already has a
   subset reading (`applySelected`) and a tiling reading (`boxGroups`), and the reference's rule needs
   the ACTIVE set plus the inactive pairs it splits.
   **Step 1 is DONE** (`convert.ts` + `types.ts`, gated in `test/catalogue.mjs`): the attribute is
   parsed verbatim onto `TamRaw` and `CallBundle`, and the shipped data is pinned — **28 tams declare
   it, by value `All` 18, `Ends` 4, `Centers` 3, `Heads` 2, `Sides` 1**, with `Centers Split Two`'s
   three tams asserted to be the `Centers` witness. The census is unchanged at 103: this is plumbing,
   not behaviour, and it is the plumbing that makes the next step reviewable.
   **A CORRECTION the analysis turned up, and it moves the cause one level up — twice.** The earlier
   note here blamed the "1 path per dancer-pair" fallback in `buildCallImpl`. Measured over the whole
   catalogue, **all 28 `actives` tams are 1:1** (paths == dancers) and NONE hits that branch. The
   mechanism is the HALF-SETUP convention: `formations.xml`'s `Eight Chain Thru` is a **four**-dancer
   formation (two facing couples at `x=-3` and `x=-1`), and `mirrorToFull` is what produces the full
   eight-dancer ECT.
   **And the engine is NOT mis-applying the tam.** Checked board-for-board on `figm109`/`figm112`'s
   board: the tam's motion is `Extend Left scaleY=.5` + `Extend Right scaleY=.5`, i.e. **advance 2 with
   facing unchanged**, and applied to the eight mirrored dancers it moves all eight by exactly 2.00,
   which **swaps each facing-couple pair** (`x=1 ↔ x=3` and `x=-1 ↔ x=-3`) and lands in a named
   `Trade By`. That is the authored data applied faithfully — a closed swap inside each half, which is
   what the four-dancer setup says.
   So the conflict is between the DATA and the DEFINITION, and `actives="Centers"` is where it shows:
   in the full ECT the "centres" are the four dancers at `x=±1`, which spans **both** halves (2 + 2),
   while the paths describe the authored half's own two couples swapping internally. Trusting
   `actives` instead — move only four — makes them land **exactly on** the other four, so it is
   unsatisfiable on this board; trusting the data gives the whole-board advance the engine already
   does. What is genuinely missing is CALLERLAB's per-dancer rule ("the actives move forward between
   the two inactives; the inactives end where they started"), which the reference computes from an
   active set the engine does not have.
   **Work, revised:** the plumbing is done (above), so the next step is NOT "stop mirroring the
   inactive half" — that reading is refuted by the swap. It is to give the sequencer an ACTIVE SET
   (Phase C item 2) and compute `Split Two` from the definition, then decide whether the call replaces
   or supplements the authored tam. A round that only suppressed the mirrored half would trade a
   faithful whole-board advance for a collision.

### A BODY DEFECT THE CENSUS CANNOT SEE: `Spin the Top` half-scales the wave (measured)

Found while reading the top `no setup` entries board-by-board (the read that found `Rollaway`'s
missing separation). The three `Slide Thru` stops all sit on a board the engine NAMES `Tidal Wave`,
and the name is the problem:

```
application                          result
Spin the Top from the engine's OWN
  canonical `Ocean Waves`            span 7.0 x 0.0, CLOSEST PAIR 1.00  -> named "Tidal Wave"
Swing Thru from the same board       closest pair 2.00                  -> named "Ocean Waves"
```

Every formation in this engine puts adjacent dancers **2** apart — except `formations.xml`'s
`Tidal Wave`, which is authored at **1** (`x=0, y = -.5/-1.5/-2.5/-3.5`), inherited unchanged from
upstream Taminations (`taminations-flutter/assets/src/formations.xml:1110`, identical coordinates).
So `Spin the Top` rotates each wave 90 degrees about its own centre — which IS what CALLERLAB asks
("Ending formation: Ocean Wave **perpendicular** to starting formation") — but it also **halves the
spacing**, and the half-scale template then hands the malformed result a legitimate name. Three
figures stop one call later on `Slide Thru`, and the census reports them as a coverage gap.

**Why it is not fixed here, and what a fix has to decide.** A 2-spaced rotation is geometrically
impossible from the engine's own `Ocean Waves` template: each 4-dancer wave rotates about its own
centre, so wave 1 (centre `(-2,0)`) would span `x = -5..1` and wave 2 (centre `(2,0)`) `x = -1..5`,
and they would collide at `x = +-1`. The half-scale merge into ONE tidal wave is Taminations'
device for fitting both into a 7-wide set, so "fix the tam's scale" is not a one-number change — it
forces a decision about what `Spin the Top` means for eight dancers in two parallel waves at all,
which CALLERLAB does not answer (its definition is written for one wave). Recorded with the numbers
rather than guessed at, and the two live options are: give the engine a SECOND `Tidal Wave` template
at the standard spacing and teach the wave-facing calls to act on it, or accept Taminations'
convention and make the follow-on calls scale-aware. **Either way the lesson is the one this plan
keeps meeting: a wrong board that gets a legitimate NAME is invisible to the census** — here it was
invisible for two reasons at once (the template is half-scale *and* the call that produces the board
is the one that looks correct).

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
- `Centers Left Hand Star` (5 figures) is **not** here, and the previous note about it was wrong
  about WHERE it fails. Re-measured: all five figures stop at that call with
  **`Unresolvable selection: Centers`** on a `Stars RH` board — the star's own motion is never
  reached, so nothing about the call's end state is being measured by the census. The five boards are
  two shapes, e.g. `#1B(-2,-1)@W #2G(1,0)@N #3B(2,-1)@W #4G(3,0)@S #5B(2,1)@E #6G(-1,0)@S #7B(-2,1)@E
  #8G(-3,0)@N` — an off-grid double-star the engine names `Stars RH`. `Centers` is defined in
  `grouping.ts` as the middle two of each of two LINES, and this board is not lines, so the selection
  refuses before anything dances. What the corpus means by `Centers` here is one of two readings the
  board cannot settle: the four dancers at the centre of the SET, or the four who just did the
  right-hand star (the chase is `... Right-hand Star | Centers Left Hand Star | ...`, and the bare
  `Right-hand Star` was applied to all eight). That is Phase C's active-set problem again, so it is
  recorded rather than guessed; a derived star would not touch this blocker at all.

### Phase E — stale identity and the per-PAIR gender rule (Phase 19)

**STATUS: item 2 is DONE** (shipped and gated — see §2). Item 1 remains open.

**Owner:** the board's identity model. **Both items are now DONE** — item 2 above, item 1 in the
section that follows. What remains of this family is the `Swing` no-op recorded there.

1. **DONE — CALLERLAB's temporary couple number**, read where identity is used (`promenade.ts`). See
   the section below: **101 → 103 figures**, and it is the reason two earlier reverts of the same rule
   do not apply to this placement.
2. **DONE — the per-PAIR gender requirement.** `Allemande Left`'s `from="Static Square"` authoring is
   `gender-specific` per SLOT, but CALLERLAB's requirement is per PAIR (each couple a man and a woman,
   side-agnostic): the call is "dancers face their corners and turn 1/2 by the left arm", the corner
   is a home-position relation, and every dancer does the same turn. Implemented as a per-couple
   retry of the same geometric match, gated to a one-entry `PAIR_GENDER_CALLS` list in `matcher.ts`
   and requiring the BOARD to be a set of man-and-woman couples. The strict per-slot reading runs
   first, so nothing that matched before changes, and the list stays one call deliberately: the retry
   is safe only where the motion is gender-symmetric, because the mapping is geometric and a
   slot-sensitive call (`Ladies Chain`, `Star Thru` — whose woman turns while the man steps) would
   apply a slot's motion to the wrong dancer. **This also explains why `Star Thru`'s ECT case from
   Phase B is NOT fixable the same way** — see Phase B.
   **CORRECTION to the previous revision of this file:** its two "witnesses" were the same board.
   `features.mjs`'s `swappedG` is not "a square of four same-gender couples"; flipping every gender
   in a normal square leaves every couple one boy and one girl, so it IS the half-sashayed square, and
   the half-sashayed square is ordinary for `Allemande Left`. The assertion was corrected, a genuine
   same-gender-couples witness was added beside it, and `facing-audit.mjs`'s `SPLIT COUPLES` class
   fell **2 → 0** (figm203, figm204).

**Instrument:** `facing-audit.mjs`'s `SPLIT COUPLES` class identifies this family without any chain
reasoning, and the `Promenade` ring-order refusals (6 in the census) read the same stale numbers.
**Gate:** `Allemande Left` is legal on the board `figm203` reaches; the census rises; `SPLIT COUPLES`
falls.

#### Phase E item 1 — DONE (101 → 103 figures): the temporary couple number, read where identity is USED

Diagnosing the six figures that stopped on `Promenade` — the largest derived-call bucket — split them
into **four ring-order refusals** and **two collisions**, and the four shared one cause the census
attributed to `Promenade` itself:

```
reason: the couples are out of sequence: couple 2 is -90 degrees round the ring from couple 1, ...
board : c4#7(-1,-1)@180 c4#8(-1,1)@180  c3#1(3,-1)@180 c3#2(-3,-1)@0
        c2#3(1,1)@0    c2#4(1,-1)@0     c1#5(-3,1)@0   c1#6(3,1)@180      -> Eight Chain Thru
```

The board is a proper Eight Chain Thru whose **PHYSICAL couples** are `(#1B,#6G)`, `(#2G,#5B)`,
`(#3B,#4G)`, `(#7B,#8G)` — every one a man and a woman standing side by side two apart — while the
stored identity pairs `#1` with `#2` and `#5` with `#6`, putting those two "couples" six apart across
the set. That is CALLERLAB's temporary couple number exactly: *"each Woman … temporarily takes on the
Head/Side identity and home position of that Man."* Promenade anchored couple 1 north and couple 2
east, read the ring as out of sequence and refused.

**The rule was implemented and reverted TWICE before (Phase 19), and this placement is why it works
now.** Applied to the BOARD after every call it cost two figures (98 → 96), because `couple` also
carries the Heads/Sides identity that a later `Heads …` call targets; applied on a call-name trigger
it fired but moved nothing, because the board it aimed at then failed on a MIRRORED couple — which is
precisely what Phase E item 2's per-couple gender retry now accepts. Reading it inside
`promenadeProblem` has no blast radius at all: it changes one call's precondition and nothing else.
The convention is applied where it is needed instead of globally.

**Measured:** figures **101 → 103**; `Promenade` refusals **6 → 4**, and the remainder are the
legitimate ones. Gated in `test/promenade.mjs` §3b, which REBUILDS the witness by replaying the
published chain rather than hardcoding coordinates, asserts the witness really is the stale case
(the physical pairs are two apart and do NOT share a stored couple; the stored pair IS six apart, so
the gate cannot go vacuous), and keeps the `[B2r]` permuted-ring refusal as the control. The get-out
corpus and `facing-audit.mjs` are unchanged (120 reaching a resolve state; 47 refusal boards), and
`verify` is green.

**THE TRIGGER TOOK THREE TRIES, and the two failures are worth keeping.** (1) Apply the regrouping
whenever some stored couple's dancers are not exactly two apart: this broke figure #12, whose couples
stand THREE apart — a normal, healthy spacing — and got a ring-order problem invented for it
(103 → 102). (2) The band that decides it is the engine's OWN notion of "standing together", already
in this file as the promenade couple band `1.0..3.0`; every healthy pre-promenade state measures
exactly 2.00 while the states a broken body produces measure 0.00, 4.00 or 6.00. The trigger is
therefore a stored couple **outside that band** — a partner genuinely somewhere else — and it keeps
figure #12, `[B2r]` and `[B2p]` all on the stored reading while still firing for `figm` #31/#83.
Worth recording because the first two versions each looked right and each was wrong by one figure or
by two gates.

**Still open, and now a separate item: `Swing Your Partner` is the IDENTITY transform.** Of the 103
`Swing Your Partner` calls the figure walk reaches, **26 have no pair standing as a couple at all**
(13 with every pair ≥ 4 apart) — and a swing is exactly the call that brings partners together, so
the no-op is wrong wherever the body leaves them apart. `Promenade`'s two collision refusals
(`dancers 5 and 7 are 0.87 apart`) are BODY errors and belong to Phase A.

**A first attempt at the end pose is REFUTED, measured this session.** Closing every co-oriented
couple (partners facing the same way) up to the standard two-unit separation about its own midpoint —
the one case CALLERLAB's silence still leaves unambiguous — measured **103 → 95 figures** while the
get-out corpus gained one line (120 → 121). So the swing's end pose is **not derivable from the local
pairing**: moving the pairs changes the anchors `Promenade` reads, and eight figures that used to
reach a legal promenade no longer do. A correct model has to be pinned by the corpus or the
reference, not by a local closure rule; until then the identity stands, and the refutation is
recorded in `coded-moves.ts` beside the rule so it is not retried.

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

**DONE: Phase A's head (`Heads Touch 1/4`), Phase E item 2 (the per-couple gender rule) and Phase E
item 1 (the temporary couple number, +2 figures).** One attempted phase is REFUTED and recorded: the
swing's local closure end pose (103 → 95). Then, in this order:

1. **Phase A's remaining queue** — the body errors the `setup-split.mjs` prefix scan names next
   (`Allemande Left` 3, `Sides Touch 1/4` 2, `Girls Run` 2, `Square Thru 4` 2, `Centers Swing Thru` 2,
   `Sides Right and Left Thru` 2).
2. **Phase B** — the authoring queue, call by call, definition first; run `facing-audit.mjs` and a
   chain trace before each row.
3. **Phase D** — the named missing calls (`unknown call` is down to 3, so this is bounded work).
4. **Phase C** — the two conventions; design before code, both have board-wide blast radius.
5. **`Swing Your Partner`'s end pose** — needs a corpus- or reference-pinned model, not a local rule.
6. **Phases F, G, H, I, J** — vocabulary, FSM/determinism, the solver index, decoder residue,
   tie-break sweeps; independent of each other and of the figure work.

The closing judgement from the last rounds, kept because it should shape expectations: **the
remaining refusals are STACKED.** A coverage fix at call N generally reveals a different defect at
call N+1 rather than completing the figure, so the figure count moves less than the number of defects
fixed. Treat it as a **lagging indicator**; the leading indicators are the cause table, the
poisoned-chain count and `facing-audit.mjs`.
