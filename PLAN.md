# Plan

**What is left, with the evidence for each.** This file now carries the *remaining work* only. The
chronological record of what was built, refuted and measured on the way here — rounds 1–39, Phases
0–19 — is in this file's git history and in `square-dancing.md` §9.1. What is kept below is: the
working rules, the measured state, the list of things that were refuted so nobody re-litigates them,
and the phases that still have work in them.

**Read in this order:** `HANDOVER.md` §1 and §3 (what the repo is, and the working rules) → this file →
`square-dancing.md` §9.1 for any claim below you want the derivation of. `HANDOVER.md` is the
orientation document and deliberately carries **no scoreboard**: §2 here is the only scoreboard, and
this file is the only work queue. It was the duplication of those two that made an earlier revision of
`HANDOVER.md` stale by four workstreams, so the numbers are not copied back into it.

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
`unknown-calls.mjs`, `spin-the-top-probe.mjs`, `from-overlap.mjs`. Gates: `test/verify-suite.mjs`
(`light` ≈ 15 s, `all` ≈ 500 s, **21 harnesses**) and `figures`, which is a **red target suite by
design** (the finish line, not a gate).

**One tool is deliberately NOT a gate, and it is the only one on disk that is not registered:**
`test/map-tips.mjs`. It is a GENERATOR, not a check — it walks tips and writes the missing FSM edges
into `poc/src/assets/discovered/` — and Phase G already says to run it by hand whenever the FSM is
touched. Recorded here because "a file in `test/` that the suite does not run" is exactly the shape that
hid the staleness in `getout-convention` (`GETOUT_SWEEP`), and the answer here is that there is no
second one: `process.env` appears in exactly ONE place in the whole engine, and every other skip in
`test/` is either the `light` tier's explicit message or an exactly-pinned list (`catalogue.mjs`'s
`KNOWN_SKIPS`).

---

## 2. Where it stands — last measured

| side | value | command |
|---|---|---|
| figures end-to-end | **116 of 188** (was 114) | `node engine/test/tools/figure-census.mjs` |
| get-out corpus: reaching a state the standard finish resolves from | **124 of 265** (was 122) | `node engine/test/getout-behaviour.mjs` |
| … of which ended by applying the finish itself | **112** (was 110) | same |
| … decoded but stopped at a call (the body gap) | **108** (was 110) | same |
| FSM | **155 states / 92 home / 43 nohome / 19 dead `@embed#N`** | `node engine/test/tools/fsm-getout-audit.mjs` |
| CALLERLAB | real gap is **11 (call, start) pairs + 9 formation names** (was 9 + 24 — THREE instrument bugs, rounds 24, 37/38, 39) | `node engine/test/tools/callerlab-diff.mjs` |
| gates | `verify:light` green; `verify` green (**23 harnesses, ~1400 s, measured**); `verify:figures` **red by design** | `npm run verify --prefix engine` |
| walk-through (POC) | COINCIDENT **32**, of which ANIMATION fault **10** / APPLY fault **22** (was 72 / 42 / 30) | `node engine/test/tools/walkthrough-survey.mjs` |
| … walk vs applicator, over 134 boards × 132 calls | agree **1920 of 1920**; silent no-ops **0**; phantoms **11**; dropped **6** (were 27 / 2466 / 400) | `node engine/test/anim-convergence.mjs` |
| … ceder modules replayed from a start formation the corpus did not specify | **168 of 294** (Zero Line 108, Zero Box 71); the engine has neither formation | `node engine/test/tools/start-formation-probe.mjs` |

All three sides above were re-measured again in round 28 and agree with the table exactly: figures
**116 of 188** (also confirmed independently by `fsm-getout-audit.mjs`), FSM **155 / 92 / 43 / 19**, and
CALLERLAB **9 documented start formations with no matching tam setup + 20 formation names**. The audit's
cross-checks are all zero — "(a) DEAD states a figure walked straight through: 0" and "(b) NOHOME states
on a path that REACHES HOME in our own graph: 0" — so no figure is being carried by a state the engine
cannot actually resolve.

The figure census's blocking causes, **re-measured in round 27 and REPLACED — the previous table was
stale**. It still listed three calls that no longer appear as blockers in the re-measurement
(`Circle 2` 2, `Promenade 1/2` 1, `Turn Thru` 1) and so summed to **75** against the **72** blocked
that the same scoreboard reports; the corrected rows sum to exactly 72 = 188 − 116:

```
   34  catalogue tam has no setup for this board      <- split below into AUTHORING vs BODY ERROR
    7  selection will not resolve on this board
    6  derived call refuses ("Sweep 1/4")
    6  unknown call (no catalogue entry)              <- was recorded as 5; see Phase D
    4  derived call refuses ("Swing Thru")
    4  derived call refuses ("Promenade")
    2  other: "Walk and Dodge" not legal for selected dancers
    1  other: "Rollaway" not legal for selected dancers
    1  derived call refuses ("Do Sa Do")
    1  other: "Scoot Back" not legal for selected dancers
    1  other: "Circulate" not legal for selected dancers
    1  other: "Walk Across" not legal for selected dancers
    1  derived call refuses ("Trade")
    1  other: "8 Circulate 1 1/2" not legal for selected dancers
    1  derived call refuses ("Promenade Home")
    1  other: "Left Hand Star" not legal for selected dancers
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
- **And a FIFTH win, the ring pair: 107 → 110 figures (rounds 10–11).** `Allemande Left` called FROM
  its own end pose is a **no-op**, because CALLERLAB defines the ending formation of ANY Allemande
  Left as the Right and Left Grand Circle and says the next call is given "as if this were the ending
  formation" — so a second one starts and finishes in the ring. Getting there took three attempts,
  each refuted by measurement: the pose tam applying the square's paths (turned everyone another
  quarter onto `Static Facing Out`), then as the exact INVERSE of the square (an involution back to
  the Static Square), and finally the no-op. The fact that settled it is that **`Weave the Ring`'s
  authored setup angles ARE the pose**, not the square's inward facings. Then the same ring needed
  `Weave the Ring`'s own `sequencer="gender-specific"` slot gate removed: its four paths are per SLOT
  (boys `Lead Left 1/2`, girls `Lead Right 1/2`) and a weave's hand pattern is fixed by the ring
  POSITION, not by the occupant's gender, so the gate was rejecting exactly the PROGRESSED rings the
  corpus reaches (six of eight slots hold the other gender after `Four Ladies Chain`). Measured:
  107 → 108 for the no-op, 108 → 110 for the slot gate, `no setup` 42 → 39, get-out unchanged at 122.
  Gated on the property the corpus needs: after the documented pattern, `Weave the Ring` must be
  legal, on the plain ring AND the progressed one.

All three sides re-measured at the end of the round: figures **110 of 188** then (now **113**, see
the role reading below); get-out **122 of 265**
reaching a resolve state (110 applying the finish, 110 body stops); FSM **155 / 92 / 43 / 19
unchanged**; CALLERLAB **re-classified, not moved** (the 9-of-45 row is still the name-matching
artefact; the real gap re-measured in round 24 as 9 (call, start) pairs + 20 formation names, see
Phase F).

**AND A SIXTH WIN — the ROLE READING: 110 → 113 figures (round 15), and it is the largest single
class left.** A `gender-specific` tam's paths are a **ROLE** motion — what a boy does, what a girl
does — not the motion of a particular SLOT. `Heads Rollaway` half-sashays the head couples, so every
dancer still faces an opposite-gender dancer and `Star Thru` is legal (CALLERLAB: "Starting formation
- facing dancers (man and woman)"), but the catalogue's `Static Square` setup pins `boy` to the
south-WEST slot and the rollaway puts him south-EAST — so slot-wise gender matching refused **an
exact geometry match**. Measured: 43 stops in the `no setup` bucket have a best setup error of
**1.57** against a tolerance of 1.5, and **four** of them (`figm#102`, `figm#185`, `figm#186`,
`figm#15`) overlay a setup at **error 0.000** once the gender constraint is off.
The fix is *geometry from the SLOT, motion from the ROLE*: match with gender off, then take each
slot's PATH from the role its occupant's own gender performs. It is well defined because
`BezierData` is authored in **dancer-local space** (`types.ts`: "+X is the dancer's initial facing
direction"), so a slot's path IS its local motion and two slots are directly comparable. It is
enabled per VARIANT by the catalogue's own data rather than by a hand-maintained call list:
`roleUniformMotions` returns a table only when every slot of a given `(gender, active)` role performs
an IDENTICAL local motion — **145 of the 287 gender-specific variants qualify**, and the other 142
(`Wave the Boys`, `Ramble`, `Twist the Line <Normal Lines>`, `Brace Thru <Eight Chain Thru>`, …) do
not, so the reading stays off for them. It cannot change a working case: where the board already
satisfies the slot genders the role motion looked up IS the slot's own path, so the outcome is
identical — pinned in `sequencer.mjs` by asserting the canonical `Star Thru` from a Static Square
still ends in `Double Pass Thru`. Nor is it a relaxation of the gender structure: the board's genders
must still preserve the authored gender multiset of its own interacting pairs (`anyPairingKeepsGenders`,
backtracking over the pairings because an `Eight Chain Thru`'s slots are two apart in BOTH axes and
only one of each 4-cycle's matchings is right — measured, the greedy first-match rejected the very
case the reading exists to accept), so a square of four same-gender couples is still refused.
`figm#102` and `figm#185` now run **end to end**; the other two progress further and stop later
(`#15` on a later `Box the Gnat`, `#186` on `Heads Left Hand Star`). The motion is verified against
the engine's own rule rather than argued: after the half-sashayed `Star Thru` the heads have swapped
partners into an `Eight Chain Thru` and **the woman is on the man's right in all four couples** —
the same convention the untouched canonical result obeys. Get-out holds at **122**, FSM
**155 / 92 / 43 / 19** unchanged, CALLERLAB unchanged; verify green (20 harnesses).
**Two hypotheses were refuted on the way there**, both now in §3: a TOLERANCE change (swept
`setMatchMargin` 0 → 4.5: nothing at all up to tolerance 2.5, and loosening to 3.5 is *harmful*,
101 figures) and UNIFORM-SCALE matching (24 of the 43 stops do prefer a non-unit scale, but 19 have
no scale at all and most of the 24 keep a residual of 1.1–11.7 even at their best scale).

**AND TWO MORE CONVENTIONS, PLUS A NOTATION ROUND, ONE PER ROUND (113 → 116 figures, 125 get-out
lines).**
- **Round 17 — CALLERLAB's implicit adjustment after a Fold** (Phase C item 1, 113 → 114 figures and
  122 → 124 get-out lines): the board a Fold/Cross Fold leaves carries a PERMISSION
  (`Board.adjustToNextSetup`, set only by `foldRule`), and the single call after it may be re-matched
  at the SEARCH tolerance and re-based onto its own setup — "danced as if the Tandems were facing".
  The permission is the scope, the strict reading is still tried first, and a result with two dancers
  closer than 1.0 is refused. See Phase C item 1 for the seven-figure witness set, the collision the
  guard now prevents, and the refutation of a looser tolerance.
- **Round 18 — `Promenade 1/2` is the ring HALF WAY round, not home** (Phase D, 114 → 115 figures):
  All8's `Pr1/2`, reached by the corpus as `All Promenade 1/2` — `figm86`'s FIRST call. It reuses
  `promenadeHome` wholesale for every precondition and then ROTATES the home squared set by the ring's
  current rotation plus the fraction, so a half promenade puts every couple on the opposite side. The
  vertical direction is fixed by the ring-order test's own convention, and the seventy
  `Heads Promenade 1/2` figures are NOT shadowed (a partial selection with a `precondition` returns
  null from the coded-move selection path and keeps the catalogue's own reading) — gated both ways.
- **Round 19 — a NOTATION round that turned into a win** (115 → 116 figures, 124 → 125 get-out lines):
  All8's own abbreviation key (`abbrlist.htm`, Rich Reel, 14 Oct 2012 — the URL the fixture already
  records as its `archivedNotationKey`) was FETCHED AND READ rather than remembered. It corrected
  `Cir2` back to "Circulate 2 spots **(Circulate Twice)**" — the table had `Circle 2` and a note
  claiming the key said so, which it does not — and that definition is what made the multiple
  implementable. The four other readings the key settled, including the `SqT@#` blend construction
  that is NOT a rename, are recorded in full below.

**AND ALL8'S OWN NOTATION KEY HAS NOW BEEN FETCHED AND READ (round 19), which settles four open
readings and corrects one entry that a previous round had made WRONG.** The key is
`abbrlist.htm` (Rich Reel, 14 Oct 2012), the URL the fixture already records as its
`archivedNotationKey`; reading it is the procedure `all8-notation.ts`'s header prescribes and it had
been done from memory. What it says, against what the table had:

- **`Cir2` is "{designated} Circulate 2 spots (Circulate Twice)"** — the table said `Circle 2`, and
  carried a note claiming "All8's key says Circle" while *correcting* an earlier comment that had it
  right as "Girls Circulate 2". The key has no `Circle 2` at all; its circle entries are
  `CirL`/`CirR` and `4Cir1`/`4Cir2`/`4Cir3` ("4 dancers Join Hands, Circle Left 1/4 / half-way /
  3/4"). **CORRECTED to `Circulate 2`**, the gap list updated (`Circle 2` out, `Circulate 2` in), and
  the reading IMPLEMENTED as a MULTIPLE: `Circulate 2` is the base call applied twice, which is
  All8's own parenthetical and CALLERLAB's rule that "Fractions are proper and occasionally used with
  calls in the Circulate family" (line 1041). **115 → 116 figures and 124 → 125 get-out lines** —
  `figm17`'s chain (`Girls Circulate 2 | Turn Thru | Allemande Left | Promenade`) is otherwise clear.
  Circulate is catalogue TAMS here, not a rule, so "twice" cannot be composed from geometry; it is
  composed from the engine's own reading of the base call, in `Sequencer.tryCodedMove`, guarded so a
  REGISTERED `… 2` title keeps its own authoring (`Square Thru 2`, `Eight Chain 2`) — gated on the
  strongest available case, that `Square Thru 2` applies from a Static Square while bare `Square Thru`
  is not even a call there.
- **`SqT@#` is "Square Thru, But On The # Hand", NOT `SqTh#` ("Square Thru #")** — and the table
  mapped BOTH to the same name. That is not a rename: CALLERLAB's own text for it says it is an
  *extended application* of Square Thru "where the Pull By action on the specified hand blends into
  the following call" (`Square Thru, on the Third Hand Spin the Top`), and *"Unless the caller
  specifies, the call … does not have a clear ending"*. So `SqT@#` is a **blend construction**, not a
  call. **CORRECTED in round 21** — the four key forms now decode to their own names and are declared
  gaps — and the correction is FREE, which a measurement settled: the old reading was *latent*, not
  active. An earlier revision of this paragraph said `figm179` "currently completes by reading it as a
  complete `Square Thru 3`"; **that was wrong**. `figm179` is not in the running set at all — it stops
  seven calls earlier on `Heads Walk and Dodge` — so no figure was dancing the wrong call, and the
  census is unchanged at 116 with the correction in. **A missing CONSTRUCTION**, and one no figure
  reaches yet.
  **AND THE CORRECTION COST ONE GET-OUT LINE (125 → 124), WHICH IS RECORDED RATHER THAN GLOSSED.**
  Round 21 measured the FIGURES after this change and not the get-out corpus, and this is the cost of
  that. The nine published lines that use the cell are used exactly as CALLERLAB describes it —
  `--BxGnt --SqT@3 --RLG`, `--SqT@4 --AL ("...but on the 4th arm...")`, `--PasTh --TrdBy --LSqT@3 --AL`
  — i.e. the cell's whole job is the BLEND. One of them used to "pass" by dancing a full `Square Thru`
  and then the next call, which is a *different board*: CALLERLAB's blend omits the final quarter turn
  ("the Pull By action on the specified hand blends into the following call"). So the line was not
  lost, a FALSE PASS was removed — and the construction cannot be used to win it back, because
  CALLERLAB says of it *"Unless the caller specifies, the call … does not have a clear ending"*: there
  is no end state to model, which is exactly why the old reading was a coincidence rather than a
  reading. **Lesson, and it is the goal's own instruction: measure all three sides for every change.**
  The get-out corpus is a lagging indicator (§6), so a -1 there is not an argument for the wrong name.
- **`Pass1` is "Pass One (Pass by 1, Pass 1 by, Skip 1)"**, `ChgHn` is "Change (Switch) Hands
  **(NOL)**" and `YelRk` is "Yellow Rock **(NOL)**" — i.e. none of them is a CALLERLAB call. That
  confirms, from the authority, round 16's reading of `Pass One` and round 17's refusal to ship
  `Change Hands` as an invisible no-op.
- **`SepA2` is "Separate Around Two    (Make A Line if not followed by ComIn)"** — the parenthetical
  confirms round 16's finding that the catalogue's phrase fragment is `Around Two to a Line`.
- Checked and found HARMLESS in effect, so left as they are: `2LChn` ("2 Ladies Chain Across", table
  says `Ladies Chain` — a naming simplification, the call resolves), `4LRollA` (the key's designator
  `4L` = "4 Ladies", so "4 Ladies Rollaway"; a Rollaway IS the lady rolling across, so the same
  motion), and `Sp2A1` (the key says "Split The Outside Couple (Outside 2) **Around One**", which the
  table truncates — the bridge to `Split Two` is recorded as a re-attribution with 0 figures, and the
  key's full wording is worth having when that bridge is re-checked).
- The key also shows the table is MISSING `Splt2` ("Split The Outside Two / Split The Outside
  Couple") and `ComIn` ("Come In To (Down) The Middle") outright, neither reached by this corpus.

**AND THE RECORDED `Touch 1/4` REFUTATION IS CONFIRMED BY A FRESH MEASUREMENT (round 19).** `figm109`
and `figm112` share a board — `Heads Square Thru 4 | Split the Outside Couple` leaves a `Trade By`
whose MIDDLE four are two facing couples, so CALLERLAB's "Starting formation: Facing Dancers only"
gives a reading for `Touch 1/4`. A loose match does apply it, and then the NEXT call stops with the
board UNNAMED (`Column Circulate` for `figm109`, `Right-hand Star` for `figm112`) — which is exactly
the refuted "the end pose is not a formation" entry, now measured rather than quoted. Authoring a
seam-2 `Touch 1/4` would win nothing on these two.

**CORRECTED (round 10): the allemande pose tam's MOTION was wrong, and it is the pair that matters.**
The first version applied the Static Square's own paths to the pose, so a second `Allemande Left`
turned every dancer another quarter and ended on a board the engine names `Static Facing Out`. The
corpus says otherwise: its chain is `Four Ladies Chain | Rollaway | Circle Left | Allemande Left |
Do Sa Do | Allemande Left | Weave the Ring`, and **`Weave the Ring`'s own authored setup IS the
Static Square** — so the pair of Allemande Lefts has to return to the square. The pose tam's paths
are now the INVERSE of the square's, which in this engine is a pure pivot per slot (**boys
`Quarter Left`, girls `Quarter Right`**), and the pair is measured as an exact involution: worst
per-dancer departure **0.000000** in position and heading. Gated in `sequencer.mjs`, which now
asserts the round trip rather than just legality. No figure moves (107 → 107, get-out 122 → 122): the
three chains then stop one call later on `Weave the Ring`.
**And that next stop is diagnosed, with its cheap fix measured and reverted.** `Weave the Ring`
refuses on three boards — two `Static Square`, one `O Trade By` — and its setup is the Static Square
with **gender-specific** slots, while the boards are the PROGRESSED square (the chain runs through
`Four Ladies Chain`), so the slots hold the other gender. Adding `weave the ring` to
`PAIR_GENDER_CALLS` — the per-couple retry that fixed exactly this for `Allemande Left` — is **INERT
here: 107 → 107 and the three stops unchanged**, so either the retry's board test or its geometric
match declines this board; reverted, and recorded as the lead it is rather than as a fix.

**AND THE WAVE-BASED `Square Thru` ENDS IN A BOARD THAT SUPPORTS NOTHING — a measured body defect
with a CALLERLAB citation, found in round 23 and NOT yet fixed.** `Square Thru`'s definition states
**"Ending formation: Facing Couples"** and grants it the Ocean Wave Rule, so a wave-in square thru
should end with the two couples FACING each other. Measured, the catalogue's wave authorings (which
are byte-identical to the reference's, the only difference in the file being the separation-2 block an
earlier round added) end with the couples facing AWAY:

- from a canonical `Ocean Waves` board, `Square Thru 4` ends in `Lines Facing Out` (named, and the
  dancers all face outward);
- from the four-dancer `Right-Hand Wave` authoring — the one the corpus actually uses, via the
  parallel path on a `Quarter Tag`'s centre wave — `figm36`'s board ends with **0 of 8 dancers having
  anyone directly in front**, and the two centre couples facing apart.

Applied to the centre four ALONE it gives the identical board, so the parallel path is not at fault;
the authoring is. **Two corpus figures then depend on that board in OPPOSITE directions**, which is
worth knowing before "fixing" it either way: `figm36` wants `Do Sa Do` (CALLERLAB: "Starting
formation: Facing Dancers", ending "Facing Dancers") and `figm37` wants `Spin Chain Thru` (CALLERLAB:
"Starting formation: Ocean Wave" — and its own change log says **"8/12/02 Removed the reference to Fan
the Top and Spin Chain Thru from the Facing Couples Rule"**, so facing couples will NOT do). Correcting
the ending to `Facing Couples` would therefore fit `figm36` and not `figm37`. **Round 23 stopped at
the measurement: the fix is a hand-authored end pose and the data is the reference's own, so it needs
one more round and a decision about which figure to believe.**
  **ROUND 24 EXTENDED THE MEASUREMENT AND IT CHANGES THE PICTURE: the whole FAMILY ends that way, so it
  is a modelling choice rather than a slip in one tam.** Applying every `Square Thru N` authoring to
  its OWN setup (`variantStarts`) shows all of them — the two `Facing Couples` authorings and the
  `Right-Hand Wave` one, for N = 2, 3 and 4 — ending with the two couples facing APART. Two further
  facts, both surprising and both worth having before anyone edits the data: `Square Thru 2` and
  `Square Thru 4` give the SAME end state from a wave, and no authoring of any N ends in a wave. That
  is consistent with the corpus's own use (every other figure calls `Swing Your Partner` or `Promenade`
  next, neither of which looks at facings), and it means the two figures above are the ONLY witnesses
  for what the end state must support — and they still disagree, unless the answer is "a wave", which
  is what `Do Sa Do`'s Ocean Wave Rule would make work for figm36 and `Spin Chain Thru` needs for
  figm37. **Left alone deliberately: editing one member of a family that behaves uniformly, on the
  strength of two conflicting figures, is exactly the kind of guess this plan refuses.**

**AND `Do Sa Do`'s OWN OCEAN WAVE RULE IS A DOCUMENTED GAP, INDEPENDENTLY OF THAT.** CALLERLAB:
*"The Ocean Wave Rule applies to this call. The ending formation remains Facing Dancers."* The
engine's derived `Do Sa Do` is an IDENTITY (measured, and correct) whose precondition requires every
dancer to have a mutual facing partner, so it refuses a WAVE — a call CALLERLAB says applies there.
Low yield on its own (the census has one `Do Sa Do` stop, and it is `figm36`'s, on the board above), so
it is recorded with its citation rather than shipped alone.

**THE GET-OUT CORPUS'S BIGGEST BLOCKER IS NOT WHAT ITS RANKING SUGGESTS (round 22).** Measured over
every alignment's published lines, **51 of them stop on `Right and Left Grand`** — by far the largest
single entry — and 15 more on `Allemande Left`, 9 on `Single File Promenade`, 6 on `Extend`, 5 on
`Do Paso`. `Right and Left Grand` is worth a look because CALLERLAB gives it a deliberately BROAD set
of starting formations (a Grand Circle, an Eight Chain Thru, a Trade By plus the ends Face In, any of
those with dancers stepped to a mini-wave, "or any formation in which dancers may conveniently turn up
to 90 degrees so the Men face promenade direction and the Women face wrong way promenade direction").
**The boards say it is not a coverage gap: 35 of the 51 are on UNNAMED boards** — body errors
upstream — against 4 `Ocean Waves`, 3 `Tidal Wave`, 4 T-Bone variants, 2 `Normal Lines`, 1 each of
`Lines Facing Out`, `Two-Faced Lines` and `Quarter Z RH`. So the work here is the same body-error
hunt the figure census needs, not a new `Right and Left Grand` setup; the named ones are a per-case
question (arrangement or improper) and are the only part a coverage fix could touch.

**...AND ROUND 10'S OWN CONCLUSION WAS WRONG TOO — corrected in round 11, for +3 figures.** Probing
the retry's inertness rather than guessing at it turned up the fact that settles the whole family:
**`Weave the Ring`'s authored setup angles are the POSE, not the square** (boys a quarter towards
promenade direction, girls the other way). The "returns to the square" reading was wrong, and so was
the involution that implemented it. CALLERLAB's own sentence decides it: *"While the dance action of
Allemande Left might not cause the dancers to end in precisely this formation, the next call should
be given AS IF this were the ending formation"* — the ending formation of ANY Allemande Left is the
Right and Left Grand Circle, so one called FROM that circle starts and finishes there. The pose tam is
therefore a **NO-OP** (`Stand`), which took the census **107 → 108**.
The second half came from the same probe: `boardHasCoupleGenderPairs` is **true** on the ring, so the
retry runs and simply finds no geometric match — the ring has no side-by-side couples at all. What the
ring needs instead is the `Weave the Ring` tam itself, whose four paths are per SLOT (boys
`Lead Left 1/2`, girls `Lead Right 1/2`): a weave's hand pattern is fixed by the RING POSITION, not by
the occupant's gender, so the `sequencer="gender-specific"` slot gate was rejecting exactly the
progressed arrangements the corpus reaches. Removing it took the census **108 → 110** and the
`no setup` bucket 42 → 39. Both halves are gated on the property the corpus needs — after the
documented pattern, **`Weave the Ring` must be legal**, on the plain ring AND on the progressed one —
and the gate now asserts that instead of the refuted involution. verify green.

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
| narrow `partition`'s couple coherence to couples actually standing as couples | `figm131`'s `Eight Chain Thru` (after `Wheel and Deal`) is refused by the Sweep because its stored pairs are FACING PAIRS — 2 apart, opposite headings — so requiring them to stay in one subset forbids EVERY tiling, even though the board divides cleanly into facing-couple boxes. Restricting the constraint to pairs that are together AND co-oriented (measured: gap ≤ 3.0 and headings within 0.2 rad) is principled and does let it tile — Sweep refusals **6 → 5** — and it measures **107 → 107 figures and 122 → 122 get-out lines**, with one figure moving from the Sweep bucket into `no setup`. Reverted: no gain, and `partition` is the tiling used by `parallelApply` for EVERY call, so a relaxation there needs a payoff to justify its blast radius. It is also a variant of the relaxation already refuted above, whose recorded reason is that the coherence rule "is what makes the decomposition well posed" |
| **raise the MATCHING TOLERANCE to clear the `no setup` bucket** | the bucket looked like a threshold artefact because its stops' best setup error is **1.57** against `DEFAULT_MATCH_MAX = 1.5`, and the binding gate is `matchEqualLength`'s distance-signature reject at `sigTol = maxError / 12` (0.125 at the apply tolerance). Swept `setMatchMargin` over **0, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 4.5**: **110 figures at every margin up to 1.0** (tolerance 2.5, well past 1.57) — the error budget is not what refuses these boards — and at margin 2.0 the count goes **DOWN to 101**, gaining 5 and losing 14. Loosening is actively harmful; the bucket is a genuine body/shape gap |
| **match up to uniform SCALE as well as translation/rotation/reflection** | measured: only **24 of the 43** `no setup` stops prefer a non-unit scale at all, and most of those keep a residual of 1.1–11.7 even at their best scale (`Slide Thru` on a `Tidal Wave` 3.17 at 0.34, `Trade By` on `Lines Facing Out` 11.71 at 0.75, `Sides Face, Grand Square` 11.14 at 1.0), so a scale-invariant matcher would not have unlocked them. The real shape of the bucket is the ROLE READING above and the four exact-match witnesses, not spacing |
| **re-key the FSM's nodes from GEOMETRY to CELL (geometry × gender pattern)** — Stage 3's architectural piece, on the reasoning that a ceder module's start is a formation *and an arrangement* (`Zero Box` = `[B1c]`) so a geometry-keyed node cannot say where the module begins | **the motivating pair shares BOTH its geometry AND its gender pattern**: the `[B1c]` board `boardForFasrCode` builds and the `Eight Chain Thru` state's own board match at **error 0.0000** with pattern `BgBgBgBg` on both, and their CELL KEYS differ only in `sequence`/`relationship` (`26\|BgBgBgBg\|1\|c` vs `26\|BgBgBgBg\|?\|?`) — both unreadable because **the FSM's state boards carry no home identity at all** (couples `3,4,2,1,3,2,4,1` against `0,0,0,0,0,0,0,0`). So re-keying the states as they stand would mint nodes distinguished only by "identity unknown" vs "identity known" — noise, not structure — and would not let one arrangement-specific module attach. **The blocker is CANONICAL IDENTITY, not arrangement**, and identity is harder: a geometry admits four relabellings, only the six All8 letter families have an authority-picked canonical board, and `relationship` needs a reference pair Callerlab records for `[L] [B] [F] [W]` only — the same limit that leaves **22 of 396 cells fully readable**. And it would COST: the scoped vocabulary goes **70 geometries → 105 cells (1.50×)** while of the **1340** edges with a target only **548** end on a declared pattern — **219 (16.3%)** end on one nothing declares and become transients. Pinned in `cell-census.mjs` section 5 |
| **`Star Thru` with a WEAKER board check (gender counts only)** | the first version of the role reading required only that the board's gender MULTISET match the setup's, which accepts a square of four same-gender couples (4 boys / 4 girls either way). Caught by the gate added with the change, not by the census: the reading now requires the board to preserve the authored gender multisets of the setup's own interacting PAIRS, and the same-gender square is refused again. **A gate written with a change is what found this, which is the reason the rule is "gate it in the same commit"** |
| **loosen the Fold adjustment's tolerance to catch CALLERLAB's own flagship example** | CALLERLAB's illustration of the convention is "Girls Fold, Double Pass Thru", and `figm30` IS that example — its `Double Pass Thru` setup is **17.88** away, so the SEARCH tolerance (6.0) refuses the very case the rule was written for. Raising the adjustment to **24.0** measured **114 → 114 figures** (no gain at all) while `facing-audit.mjs`'s refusal list went **38 → 39**, moving `figm142` back into it. The reason is that a looser tolerance changes WHICH VARIANT wins (least error for the whole-board reading, first that tiles for the parallel one), so its effect is not monotonic, and the variant it picks at 24.0 is refused by the collision guard where the one picked at 6.0 is accepted. Reverted |
| **a per-dancer DISPLACEMENT bound on the Fold adjustment** | considered as the alternative to the collision guard and rejected as an arbitrary threshold, on measurement: the case known to be WRONG (`figm83`, which left two dancers on one spot) moves dancers **2.00**, the case known to be right (`figm142`) **0.50**, and `figm71`/`figm136` sit at **2.00 / 2.06** — two cases a hair apart on opposite sides of any such number. Note also that the repeated binding constraint here is the same one round 15 found: `matchEqualLength`'s distance-signature reject at `sigTol = maxError / 12`, which is why the three post-Fold boards that failed at 6.0 are a SIGNATURE question, not a Fold question |
| **`Swing Thru` on the four boards that refuse it** | the four stops (`figm13` `Completed Double Pass Thru`, `figm14` `Mixed Columns RH Centers Out`, `figm193` `T-Bone LUUR`, and one more) all have a four-dancer `Right-Hand Wave` setup at a best error of **3.14** — positions right, facings π out — which is why they look like a facing bug. They are not fixed cheaply: CALLERLAB's own comment on Swing Thru says *"After applying the Facing Couples Rule, the starting formation of Swing Thru must be a Wave or an Alamo Ring … It is improper, for example, to call Swing Thru from an Inverted Line"*, and a `Completed Double Pass Thru` is couples facing west/west/east/east — no two couples face each other, so the Facing Couples Rule has no box to step into. The engine's derived rule already declines correctly (`swing-thru.ts`, arm 2 requires the boxes to COVER the board). Settle what a `Completed Double Pass Thru` is in CALLERLAB's vocabulary before touching this |
| **close the FSM over unnamed ends as NEW STATES** (the plan's own step 3) | **REFUTED BY MEASUREMENT — the closure DIVERGES.** An eight-dancer board's geometry is continuous, so the successors of the off-grid setups never close. Taken faithfully to `buildFsmTable`'s own `addState` dedupe (`matchFormations(dancers, existing, 1.0)`), starting from the table's 155 states: **level 1 alone adds 1840 new geometries** (whole 585, full-tiling 743, partial 512), and the closure reached **3005 states after enumerating 400, still growing**. A cap would only hide it, and thousands of unnamed `#N` nodes is not a state machine a caller can read. **What shipped instead: an unnamed end is RECORDED as an edge with `endFormation: null`** — the state set stays 155, and the application is no longer dropped. Measured: states **155 unchanged**, figures **116 unchanged**, get-out **124 unchanged**, edges **1961 → 4656** (see `engine/test/fsm-asset.mjs`, the staleness gate that now pins it) |
| **the FSM asset needs no gate** | it went stale silently: the SAME 155 states but **2205 edges against the stored 1961**, with **76 edges landing on a DIFFERENT end**, 511 admitted applications with no edge, and 188 stored edges not reproduced. The generator was wired into no npm script and no harness. `engine/test/fsm-asset.mjs` now rebuilds the table the generator's way and fails when disk disagrees in EITHER direction, with the counts pinned separately |
| **"a tied best match is not an identity" needs a new threshold to implement** | it needs none, and the recorded decision is enough: the tie rule alone refuses **613 of 2247** admitted applications, and only **7** tie at error 0 — all seven genuine `T-Bone DRDR`/`T-Bone LULU` mirror ambiguities, which is exactly what a tie means. Every other tie is at error ≥ π. What the tie rule does NOT catch is a board with one dancer outside the engine's own binding allowance (`maxError / 12`), so the two land together: union **768**, of which exactly TWO sit within 0.075 of the boundary. **Note this is NOT the per-dancer bound §3 refutes for the Fold adjustment** (row above): that one was an arbitrary displacement number for a tolerance decision, this one is the tolerance the matcher's own distance-signature filter already applies, extended to the facing half of the error it cannot see |
| **a MIXED (multi-size) reading would unblock applications** | **REFUTED BY MEASUREMENT, and the number that suggested it was the wrong number.** "107 of 273 titles are multi-arity" was read as the pool; measured on the size SETS, **104 of the 107 are `{4,8}`**, which admits no mixed shape at all — 8 IS the whole-board apply and `[4,4]` is already reachable homogeneously — and **1 is `{6,8}`** (`Column Circulate`, where 8 − 6 = 2 and it has no 2-dancer authoring). The **entire** mixed pool is **2 titles**, `Step to a Wave` and `Step to a Left-Hand Wave`, both `{2,4,8}`, whose only mixed shape is **4+2+2** (210 labelled partitions each). Over the FSM's own **1013** boards (133 named + **880** embedded setups): **18** have a mixed partition in which every block matches a variant of its own size, and the engine **already applies the call on all 18** — **ZERO would be new**. Couple coherence is not what refuses them either: dropping the rule changes the per-title count not at all (9 before, 9 after). `partitionsFor` is built and exported (`applicator.ts`) with the cap and the shared coherence rule, and is wired to `reading-census.mjs`'s reporter, which **PINS the zero** — so a catalogue change that creates a witness fails the gate and forces the decision rather than silently unblocking it. **Do NOT build the FSM schema change on this mechanism** |

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

**RE-MEASURED, AND THE QUEUE IS SMALLER THAN THE REACH TABLE SUGGESTS — the intersection is what
matters.** `setup-split.mjs`'s reach scan counts every figure with an unnamed board anywhere, and that
is a SUPERSET: the allemande pose, the grand ring and a Fold are all legitimately unnamed, so
`figm17` is "poisoned" and still runs end to end. The queue is the intersection of *blocked* and
*poisoned*, and re-measuring it (`figure-census.mjs --ids` against the prefix scan) gives **19 figures
— exactly the set the round-31 note records**, with the plan's own shorter list (3/2/2/2/2/2 for
`Allemande Left`/`Sides Touch 1/4`/…) now STALE: the reach order today is `Boys Fold` 7,
`Allemande Left` 5, `Square Thru 4` 3, then `Slide Thru`, `Girls Run`, `Centers Swing Thru`,
`Star Thru`, `Boys Cross Fold` 2 each, and seven singletons. Of the 19:

- **14 are already adjudicated** by the plan and must not be re-opened: `Boys Fold` 5 (two of them
  closed outright as `Change Hands`/`Yellow Rock`, the tolerance route refuted), `Square Thru 4` 3
  (the family-wide recorded measure), `Allemande Left` 2 (`Pass One`, a Phase D name no authority
  defines), and the four `[W]`/pose cases.
- **3 are SELECTION problems, not body errors**: `figm65` and `figm212` fail with `Unresolvable
  selection: Centers` on an unnamed board, and `figm174` the same via `Centers Pass Thru`. That is
  Phase C's active-set item, and `phase-a-queue-probe.mjs` prints the reason for each.
- **2 have no defect at all** — `figm24` and `figm216` (`Girls Run`) are geometrically sound (closest
  pair 2.00) and their next call is LEGAL; the figure simply fails further on. A body scan cannot fix
  what is not broken.
- **ONE is a genuine collision: `figm92`**, whose board has two dancers **0.32** apart.

**AND THAT ONE IS FIXED — the minting call was not the poisoned one.** `figm92`'s chain is
`Tag the Line | Face In | Star Thru | …`, and the collision is minted TWO CALLS UP: `Face In` produced
headings of **-108 / -135 / -45 degrees**, off the 90-degree grid, and the `Star Thru` after it
collapsed the set. The cause was in `moves.ts`: `faceInOutStates` aimed each dancer at the centre's
EXACT bearing, which is not what the call is —

> "Face In: Each individual turns in place **90 degrees**, turning toward the center of the set."
> (CALLERLAB; Face Out is the same, turning away)

— and on a Completed Double Pass Thru the corner dancers sit at 45 degrees to the centre, so the
"aim" is a diagonal and the whole set leaves the grid. It is now a QUARTER TURN with the sense chosen
by which way the centre lies, and CALLERLAB's own worked note is the shape gate: *"From General Lines,
Tag the Line, Face In (or Face Out) ends in Facing Lines (or Lines Back-to-Back)"* — measured, every
heading on the grid, every turn exactly 90 degrees, every dancer inward (or outward) afterwards.
Gated in `sequencer.mjs`.

**IT DOES NOT MOVE A FIGURE, AND THAT IS RECORDED RATHER THAN GLOSSED.** All three sides are unchanged
— figures **116 of 188**, get-out **124 of 265**, FSM **155/92/43/19** — because `figm92` now stops one
call later: the corrected `Face In` leaves a facing line **2 apart** and `Star Thru` has no setup at
that separation, so the blocker becomes the compact-line spacing Phase B's `scaleX = separation / 2`
recipe owns. It is kept for the same reason the plan kept `Fan the Top` and the `Do Sa Do` identity: a
correctness fix with an authority citation and a gate, whose metric is unchanged. **The lesson is the
phase's own — a call that STOPPED is a symptom, not an owner: the collision was attributed to
`Star Thru` and belonged to `Face In`.**

**Instrument:** `setup-split.mjs`'s prefix scan (names every intermediate board) and
`facing-audit.mjs` (`pairs`/`closest`/`mutual`/`split` columns).
**Gate:** poisoned chains fall; each cleared chain must land on a NAMED board, not merely run further.

### Phase B — the authoring queue (P16c): genuine setup gaps, per call

**WHERE THE BODY ERRORS ACTUALLY GATE THE COUNT (measured, round 31).** `setup-split.mjs`'s P16a work
order ranks 32 figures POISONED by an unnamed board somewhere in the chain, but "poisoned" is neither
"blocked" nor "fixable" — `figm17` runs end to end with an unnamed board in the middle, which is exactly
what CALLERLAB expects after a Fold. Intersecting the 32 poisoned figures with the 72 BLOCKED ids
(`figure-census.mjs --ids`) gives the list that actually matters, and it is much smaller:

```
19 of the 72 blocked figures are also poisoned, by first offender:
   5  after Boys Fold            figm30 figm70 figm71 figm83 figm142
   3  after Square Thru 4        figm36 figm37 figm191
   2  after Allemande Left       figm125 figm149
   2  after Girls Run            figm24 figm216
   2  after Centers Swing Thru   figm65 figm212
   1  each: after Star Thru (figm92), after Centers Pass Thru (figm122),
            after All Fold (figm136), after Centers Star Thru (figm174),
            after Sides Touch 1/4 (figm207)
```

So the body errors that actually gate blocked figures are TEN boards, and the largest is **`after Boys
Fold`, five figures** — one this plan has already been round once. Traced in round 31, those five do NOT
share a downstream call, which is why a single fix has never moved them together:

```
figm30   #9  Double Pass Thru   "no setup matches"    (the 17.88 case §3 records)
figm71   #10 Star Thru          "no setup matches"
figm83   #6  Ladies Chain       "no setup matches"
figm142  #9  Change Hands       unknown call          (closed, no definition in any authority)
figm70   #9  Yellow Rock        unknown call          (closed, round 27)
```

Two of the five are closed outright (`Change Hands`, `Yellow Rock`), so **`Boys Fold` can yield at most
three figures**, and only if the implicit-adjustment route works for `Double Pass Thru`, `Star Thru` and
`Ladies Chain` on three different unnamed boards. §3 records that route's own limit: raising the
adjustment's tolerance to 24.0 measured 114 → 114 with `facing-audit`'s refusal list going 38 → 39,
because a looser tolerance changes WHICH variant wins and the one it picks is refused by the collision
guard. **That is the honest ceiling on this phase, and it should be weighed against the ~30 SETUP GAP
rows below before another round is spent on it.**

**THE ~0.79 CLUSTER IS NOT A TOLERANCE ARTEFACT EITHER — and it looks exactly like one (round 32).**
Re-measuring the SETUP GAP rows shows a striking pattern: **seven** of them sit at almost the same
positional distance from their nearest same-size setup, and that distance is INSIDE `DEFAULT_MATCH_MAX`:

```
figm9   Eight Chain Thru   Mixed Columns RH Centers Out   0.79
figm113 Pass Thru          Lines Facing Out               0.79
figm202 Pass the Ocean     Lines Facing Out               0.79
figm217 Square Thru 3      Trade By                      0.79
figm219 Pass Thru          Double Pass Thru              0.79
figm224 Circle Left        Normal Lines                  0.79
figm35  Pass Thru          Quarter Tag                   0.81
```

A board 0.79 off its setup, refused by a matcher whose tolerance is 1.5, is the definition of a
threshold artefact — so this was checked rather than assumed, and it is NOT one:

- The binding gate is **not** `maxError` but `matchEqualLength`'s distance-signature check at
  `sigTol = maxError / 12` (`match.ts` lines 169 and 280), i.e. 0.125 at the apply tolerance. §3's own
  margin sweep already raised that **proportionally** — margin 1.0 puts `maxError` at 2.5 and `sigTol` at
  0.208 — and measured **110 figures at every margin up to 1.0**, then a DROP to 101 at margin 2.0. So
  loosening the signature by 66% cleared none of this cluster.
- And the effective allowance is pinned ON PURPOSE by a gate. `test/selection.mjs` ("knownFormation's
  tolerance is ~0.5, not 6.0") asserts, for every dancer of three formations, that a **0.50 displacement
  must still match and 0.75 must NOT**, with the comment that this *"pins the EFFECTIVE behaviour, which
  is what a future change to either the constant or the /12 divisor would break"*. The cluster sits above
  that deliberate boundary, not below it.
- Causally checked in that same gate: setting `KNOWN_FORMATION_MAX` to 3.0 moved the measured limit to
  exactly 0.25, so the divisor really is what binds.

**So the honest read is that these boards differ in SHAPE, not in position or scale** — seven calls
whose authored setups genuinely are not the arrangement reached. They are authoring work in the §"genuine
setup gaps" sense, and a constants change will not touch them; do not spend a round on the divisor.

**THE `T-Bone LUUR` CLUSTER IS NOT AUTHORABLE FROM THIS REPO'S AUTHORITIES EITHER (round 33).** It is
the most attractive remaining row — three figures sharing ONE board, which is why it was the recommended
next target — and it is closed for a reason that also bounds the rest of the phase:

```
figm63   #7  Lead Right   T-Bone LUUR   "4/8 face the wrong way (max 90 deg)"
figm193  #3  Swing Thru   T-Bone LUUR   same board signature
figm194  #3  Extend       T-Bone LUUR   same
```

(`figm193` and `figm194` reach it the same way — `Heads Box the Gnat` leaves the `LUUR` T-Bone — which is
why the three are one row and not three.)

- **`callerlab-ms.txt` does not contain the word "T-Bone" AT ALL** (zero occurrences in 3,438 lines).
  The Mainstream document simply does not discuss T-Bones, so there is no definition here to transcribe —
  and unlike `Fan the Top`, whose rule the reference ships as `assets/plus/fan_the_top.md`, there is no
  CALLERLAB text for this arrangement anywhere in the repo.
- **The reference's catalogue has no T-Bone setup for any of the three calls.** Checked directly:
  `swing_thru.xml`, `extend.xml`, `lead_right.xml`, and for good measure `pass_thru.xml` and
  `wheel_and_deal.xml` all have **no `T-Bone` entry**, while `ferris_wheel.xml` does (`from="T-Bone
  Couples"`, `from="T-Bone Couples 2"`). So the catalogue supports SOME calls from T-Bones and simply
  does not author these.
- The reference does not code them either, so there is no rule to port.

So authoring these would be **inventing choreography for an arrangement neither authority in this repo
defines for these calls**. That is the same disposition as `Trade By` on `Lines Facing Out` and it is the
general shape of what is left in this phase: the rows that remain are ones where the corpus reaches a
call from a board no authority covers, NOT rows where a known setup exists at a wrong scale. Recorded so
the row is not re-opened.

**Owner:** the matcher's setup vocabulary — tams authored for one arrangement and one scale.
**Size:** the `SHAPE / NO-POSITIONAL-MATCH` class, ~25 rows, **no two sharing a call**; the
`mutual` column of `facing-audit.mjs` is what cuts it from 35 to 25. Current heads:

| call | figures | boards | state |
|---|---|---|---|
| `Pass Thru` | 5 | Quarter Tag, unnamed, Lines Facing Out, Tidal Wave | **4 of 6 re-attributed to Phase A** — no facing dancers, or two on one spot |
| `Star Thru` | 5 | 2 × Static Square, unnamed, Completed Double Pass Thru, Eight Chain Thru | **DONE in round 15 — three of the five were the ROLE reading (`figm#102`, `#185`, `#186`); see below** |
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

**`Star Thru` cannot use Phase E's per-couple relaxation, and the reason generalises — but it IS
fixed, by the ROLE reading (round 15, 110 → 113 figures).** Its ECT case
is the same shape as `Allemande Left`'s — a setup that overlays the board at error 0.000 with gender
ignored and NULL with gender required — but `Star Thru`'s MOTION is slot-sensitive (the woman turns
while the man steps), and the match's mapping is geometric, so relaxing per couple would apply the
man's path to the woman. That is the rule for `PAIR_GENDER_CALLS`: only calls whose motion is
gender-symmetric may go on the list. The role reading is the OTHER answer to the same problem:
instead of reusing a slot's motion, it takes the motion of the dancer's own gender from wherever the
setup authors it, which is well defined because a path is in the dancer's local frame. Three of the
five `Star Thru` stops (`figm#102`, `figm#185`, `figm#186`) went with it; what remains of this row is
`figm#15` (which now stops LATER, on a subsequent `Box the Gnat`) and the unnamed/`Completed Double
Pass Thru` boards.

### Phase C — the missing conventions

Both are stated by CALLERLAB and absent from the engine. They are different kinds of work from an
authoring, which is why they are their own phase. **Item 1 (the implicit adjustment after
Fold/Cross Fold) is DONE — round 17, +1 figure and +2 get-out lines; item 2 (the active set) is the
last one open, and the Ocean Wave Rule is item 3.**

1. **The implicit adjustment after Fold/Cross Fold.** CALLERLAB, on "Heads Square Thru 4, Touch a
   Quarter, Girls Fold, Double Pass Thru": *"Double Pass Thru implicitly tells dancers that they
   should be in the starting formation for that call (facing Tandems) … generally accepted at
   Mainstream, particularly following Fold or Cross Fold."* The engine's matcher insists the board
   already IS the setup. Four cleared Fold chains now stop on `Yellow Rock`, `Star Thru`,
   `Ladies Chain` and `Turn Thru` because of this. The scoping is in CALLERLAB's own words — the
   calls that follow a Fold — and the gate must assert it fires nowhere else.
   **DONE in round 17: +1 figure (113 → 114) and +2 get-out lines (122 → 124).** The witness set,
   measured rather than quoted: **SEVEN** figures stop on the call right after a Fold
   (`figm30`, `figm70`, `figm71`, `figm83`, `figm89`, `figm136`, `figm142`), and every one reaches its
   Fold from a NAMED, legitimate formation (Ocean Waves, Two-Faced Lines, Eight Chain Thru) — so no
   upstream body error is involved, which was the thing to establish before touching it.
   The mechanism is a **permission carried by the board** (`Board.adjustToNextSetup`, set only by
   `foldRule` and dropped by every apply result, since each result is a freshly built board). The next
   call is matched strictly FIRST; only if that refuses, and only on the interactive path, is it
   re-matched at the SEARCH tolerance and **re-based onto its own setup** — which is literally
   CALLERLAB's "danced as if the Tandems were facing", because `applyWholeBoard` with `rebase = true`
   puts each dancer on the mapped setup slot before applying the motion. The permission IS the scope,
   so the gate is structural: the same call on the same board with the flag stripped must still
   refuse. Held off the search path deliberately — there a force-fit is not a normalization but a
   bogus solver edge.
   **The trap was walked into and is now guarded.** Without a postcondition the adjustment ran
   `figm83`'s first `Ladies Chain` from a board **4.0** away from its setup and left two dancers on
   one spot: `facing-audit.mjs` re-classified that figure `coverage?` → **COLLISION** (refusal boards
   39 → 38 but COLLISION 3 → 4) — a laundered body error, which is what an implicit adjustment must
   never be. `adjustToSetup` now refuses any result with two dancers closer than **1.0**, the same
   threshold `SWEEP_COLLISION_MIN` and the audit's COLLISION class use, so the engine and the
   instrument cannot disagree. Final measured state: figures **114**, refusal boards **39 → 38**,
   COLLISION **3 → 3**, get-out **124**. `figm142` moved out of the no-setup bucket onto
   `Change Hands` (an unknown call, Phase D) — an attribution change, not a win.
2. **"Active dancers continue."** CALLERLAB assumes the active set carries across calls; the engine
   has no active-set tracking. This is the `Right-hand Star` / `Centers` family, and it is also why
   `-BRun` is an approximation in the decoder (`-B` = "the Boy(s) AMONG THE DANCERS WHO WERE ACTIVE").
   Design before code: the active set has to be a first-class part of the board or the sequencer state.
4. **THE OCEAN WAVE RULE — an unambiguously missing convention, and its prerequisite is now measured.**
   CALLERLAB, "Ocean Wave Rule": *"Some calls that are defined to start from Facing Couples are also
   proper starting from a Right-Hand Ocean Wave … While the rule is called the Ocean Wave Rule, it is
   generalized to include Mini-Wave (Facing Dancers) and Tidal Wave (Facing Lines), etc. **Examples
   include Pass Thru, Slide Thru, Box the Gnat, and Double Pass Thru** … The adjustment that is part of
   the Ocean Wave Rule does not change the effect of the call … **It is as if any dancer in a mini-wave
   had first stepped back into facing dancers and then all did the call.** For example, from a
   Right-Hand Mini-Wave, 'Dosado' ends in Facing Dancers, not in a Right-Hand Mini-Wave."*
   So the engine needs a way for these calls to act on **facing PAIRS (2 dancers)**, and every
   `Slide Thru` authoring is a 4- or 8-dancer setup — a wave cannot be tiled by them. **Measured: a
   `from="Facing Dancers"` authoring (an inline pair, mirrored to itself) registers and works on a
   bare facing pair, and changes NO figure outcome at all** (census 107 → 107, all 42 `no setup`
   refusals unchanged), because the three `Slide Thru` stops are the HALF-SCALE `Tidal Wave` boards
   described above and their dancers stand ONE apart, so no 2-apart pair matches. Reverted on the
   repo's own rule — a behaviour change with no measured gain is not a phase — and recorded here as
   the prerequisite it is: the rule is real, its authoring is cheap, and it is blocked on the scale
   defect, not on itself.
   **One data note and one CORRECTED false alarm, both worth knowing before the same ground is
   re-covered.** (a) `mirrorToFull` appends the far half as COPIES carrying a `mirror` flag rather
   than mirrored coordinates, so a bundle's raw formation prints its near half twice — the mirror is
   applied at match time, which is correct but makes the raw data look duplicated in any diagnostic.
   (b) **CORRECTED (round 14): "the `Ocean Waves` template is BGGB while the calls are GBBG" is NOT an
   inconsistency.** `formations.xml` names **six** legitimate wave arrangements — `Ocean Waves RH/LH
   BGGB`, `GBBG`, `BGBG` and `GBGB` — so a wave with two girls adjacent is a named, proper formation,
   and the engine's template simply happens to be one of them while a given call's setup is authored
   for another. That is the ARRANGEMENT class `setup-coverage.mjs` already reports (a call whose setups
   cover only one arrangement refuses a board in another), not a template bug, and "fix the template"
   would have been wrong.
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

### A BODY DEFECT THE CENSUS CANNOT SEE: `Spin the Top` half-scales the wave (measured, and smaller than first recorded)

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

**Why it is not fixed here, and what a fix has to decide.** A 2-spaced rotation *per wave* is
geometrically impossible from the engine's own `Ocean Waves` template: each 4-dancer wave rotating
about its own centre, wave 1 (centre `(-2,0)`) would span `x = -5..1` and wave 2 (centre `(2,0)`)
`x = -1..5`, and they would collide at `x = +-1`. The half-scale merge into ONE tidal wave is
Taminations' device for fitting both into a 7-wide set. **The whole-SET rotation avoids that** — the
canonical board rotated a quarter turn about the set centre is still named `Ocean Waves` at the
closest pair 2.00 — and it was measured as a substitution anyway: **7 figures complete today, 5 with
the rotation.** So the remaining options are additive ones, each measured per follow-on call: give
the engine a second `Tidal Wave` template at the standard spacing and teach the wave-facing calls to
act on it; accept Taminations' convention and make those calls scale-aware; or leave the motion and
fix the follow-on calls it actually blocks (`Slide Thru` 3, `Swing Thru` 2, `Sweep 1/4` 2 — all of
which are refused BEFORE and AFTER the rotation, so they are not caused by the scale at all).
**The lesson this plan keeps meeting, now with a second edge: a wrong board that gets a legitimate
NAME is invisible to the census** — and a *measurement* that mislabels a normal intermediate state is
invisible in exactly the same way, one level up. Both were caught by re-running the walk without the
label.

**How much it is worth, measured — AND THE FIRST NUMBER RECORDED HERE WAS WRONG.** Every corpus
figure that uses `Spin the Top`, walked with no substitution (the shipped behaviour):

```
figures using Spin the Top: 16;   completing: 7
   3  stopped on Slide Thru
   2  stopped on Swing Thru
   2  stopped on Sweep 1/4
   1  stopped on Heads Sweep 1/4
   1  stopped on Separate Around Two (a missing call, not this)
```

So the half-scale result is real and it is the shape of five or six of those failures, but it is
**not** the blocker the previous revision of this section claimed. That revision said *"figures using
Spin the Top: 16; running to the end: 0"* — a **probe artefact**: the walk recorded the half-scale
board as the figure's outcome and then overwrote it, so every figure that passed through Spin the
Top and went on to complete was counted as a stop. Corrected here, and worth recording as a lesson
of its own: the number was produced by a tool, looked decisive, and was wrong because the tool
mis-labelled a normal intermediate state; the same walk re-run without the label gives 7.

**The whole-set rotation was then measured as a SUBSTITUTION, and it is REFUTED.** The obvious
repair — `Spin the Top` rotates the whole set a quarter turn about the SET's centre, which the grid
CAN represent (measured: the canonical two-wave board rotates to a board the engine still names
`Ocean Waves` at the closest pair 2.00, and on it BOTH `Swing Thru` and `Right and Left Thru` are
legal, so the follow-on calls are reachable) — makes the corpus WORSE:

```
shipped half-scale behaviour     7 of the 16 figures complete
whole-set rotation, CCW          5
whole-set rotation, CW           5
```

Substituting the rotation moves 7 figures past Spin the Top but costs 2 net, so the half-scale board
is not merely wrong: for some follow-on calls it is the board they are authored against. **A fix
must therefore be additive and measured per follow-on call, not a swap of the motion.** The defect
stays open, at its true size (about five figures), rather than at the size the bad probe claimed.

### Round 13: the `unknown call` and `Promenade` buckets, and the end of the separation recipe

**`Swing Thru` (4) and `Scoot Back` (1) are the same shape as everything else here — partial-set calls.**
`Swing Thru`'s three whole-board refusals are boards on which only PART of the set can act: on
`figm4`'s `Completed Double Pass Thru` the two middle columns are a legal facing-couples box and the
two OUTER couples face away from everything, so a whole-board `Swing Thru` is not the call. That is the
"some boxes, not all" structural class the plan already records, and `catalogueFallback` cannot help
because the catalogue has no setup for it either. `Scoot Back`'s single stop is `Boys Scoot Back` from
`Normal Lines`, refused as *"not legal for selected dancers"*: the four boys are one dancer per column
and do not form the mini-waves a Scoot Back needs, so the SELECTION is again the question rather than
the setup. Neither is a spacing case — the plan's own "whisker" note about `Scoot Back` is superseded
by this measurement.

**`unknown call` (4) is blocked on reference material this repo does not have.** The four stops are
`Yellow Rock`, `Partner Trade 1 1/2`, `Pass One` (twice) and `Separate Around Two`. `Yellow Rock` is a
**Plus** call and the repo's CALLERLAB text is Mainstream only; `Pass One` is All8's own abbreviation
(*"Pass One (Pass by 1, Pass 1 by, Skip 1)"*) with no CALLERLAB definition at all; `Circle 2` likewise
(*"No `Circle 2` title exists"*). Each is already DECLARED in `KNOWN_CATALOGUE_GAPS` with its reason,
which is exactly what that list is for — so they are recorded gaps, not oversights, and implementing
any of them means asserting choreography from nothing.

**`Promenade` (4) is two honest refusals and two misattributed reasons.** Measured: two are
`collision` refusals (`dancers 5 and 7 are 0.87 apart`, `dancers 6 and 2 are 1.00 apart`) — bodies
that have fallen apart, where refusing is right. The other two are `couples out of sequence`, and on
BOTH the board is not a couple arrangement at all: `figm175`'s board has **no two dancers of a pair
standing together at any spacing** (every 2-apart pair faces opposite ways), and `figm124`'s couples
are four apart with no physical pairing to fall back on. So the ring-order arithmetic is being run
over couple midpoints that are fictions. **Fixing the reason is not available cheaply**: gating the
check on "the couples are standing together" is exactly the relaxation that breaks the `[B2r]`/`[B2p]`
alignment gates, whose stored pairs are ALSO 2-apart facing pairs — measured in round 2 and recorded
then. Recorded here so the next reader does not re-derive it.

**AND THE SEPARATION RECIPE IS NOW EXHAUSTED — measured, not assumed.** The recipe that won four
figures is: find the authored setup with the board's SHAPE at another SCALE, and author the missing
separation. That requires the best error against the call's own setups to be **FINITE**.
**CORRECTED IN ROUND 15, and the round-13 form of this paragraph was a PROBE ARTEFACT.** It used to
claim "every single stop returns NULL ... finite-shape: 0 of 46". The probe mapped each variant with
the raw `<formation>` coordinates, but the MATCHER maps them through `variantMatchable`, which is
where the `mirror` flag of a duplicated half is turned into a real 180-degree rotation — so the
probe was comparing every board against a near-half target and got NULL for everything. Re-measured
with the matcher's own mapping, **43 of 43 stops have a finite best error**. The conclusion the
mis-measurement supported (there is no missing separation here) still holds, but its stated reason
does not: the bucket is not "no setup of the right shape", it is "the right setup with the genders
the other way round" (the ROLE READING above, +3 figures) plus genuine body defects, several of them now
root-caused just below.

**THE HALF-SCALE `TIDAL WAVE` IS NOW ROOT-CAUSED, AND THE FIX IS AUTHORITATIVE BUT NOT YET A WIN
(round 25).** The measurement, first:

- `formations.xml` authors `Tidal Wave` with its dancers **ONE** apart (y = -3.5, -2.5, -1.5, -0.5)
  while `Ocean Waves` authors them **TWO** apart (y = 3, 1, -1, -3). `Spin the Top` from a canonical
  `Ocean Waves` produces **one line of eight at half spacing** (x = ±0.5, ±1.5, ±2.5, ±3.5) instead of
  two waves, and four published figures whose next call is `Slide Thru` (figm48, figm59, figm115) or
  `Pass Thru` (figm126) then refuse, because those calls' setups are the REAL waves.
- The root is not the template but the AUTHORING: the catalogue ships an 8-dancer
  `from="Right-Hand Waves"` `Spin the Top`, and it merges the two facing waves instead of working each.

**SHARPENED, ROUND 27 — THE OWNER IS `Fan the Top`, NOT `Spin the Top`, AND THE DEFECT IS SYMMETRIC.**
The round-25 statement above was measured on a mid-chain board. Re-measured on the two CANONICAL boards
(`engine/test/tools/spin-the-top-probe.mjs`, which prints the matched variant, the error, and the
distinct inter-dancer gaps):

```
start          call           result                                     gaps < 3.5
Ocean Waves    Swing          Ocean Waves                     (unchanged) 2.00
Ocean Waves    Fan the Top    "Tidal Wave", ONE line of 8 at y=0          1.00, 2.00, 3.00   <- WRONG
Ocean Waves    Spin the Top   "Tidal Wave", ONE line of 8                1.00, 2.00, 3.00   <- WRONG
Tidal Wave     Swing          Tidal Wave                      (unchanged) 1.00, 2.00, 3.00
Tidal Wave     Fan the Top    Ocean Waves, two columns at x=±3           2.00               <- WRONG
Tidal Wave     Spin the Top   Ocean Waves, two columns at x=±1           2.00               <- WRONG
```

So it is **not** "Spin the Top merges two facing waves": **`Fan the Top` is wrong from BOTH formations,
in both directions**, and `Spin the Top` merely inherits it. `Swing` is correct from both — which is why
the round-26 composition attempt could not have worked whatever the sub-apply tolerance did.

Three facts pin the owner:

- `Fan the Top` has **no derived rule in this engine at all** (`coded-moves.ts` has no entry); it is a
  PLUS call served entirely by `poc/src/assets/plus/fan_the_top.xml`. `Spin the Top` is a Mainstream tam.
- Its `from="Right-Hand Waves"` tam carries `formation="Ocean Waves RH BGGB"` and only **FOUR `<path>`
  elements for eight dancers**, i.e. the catalogue itself expresses it as a 4-dancer wave read applied
  per half — which is the reference's `SplitCall`, exactly as round 25 cited from `split_call.dart`.
- The matcher reports an **8-dancer** variant matched at **error 0.000** on BOTH boards, so this is not a
  tolerance or tiling failure: the engine believes it has a perfect match and then produces the wrong
  shape. Whatever the fault is, it is in reading the per-half paths, not in finding them.

**The target this section set was `Fan the Top` as a derived call, and it is DONE — see the
IMPLEMENTED block below.** Note how it was reached, because it changed: the plan expected a per-half
split, and round 28 measured that simply *preferring* the per-half route does not work (the 4-dancer
tams are wrong too). What actually worked was reading the definition as a whole-board FAN about the SET
centre — no split at all. The witness is still much better than round 26's: the two canonical boards
above are a two-line test that needs no
figure at all to tell right from wrong. (The obvious stronger test — a bare 4-dancer wave — is NOT
reachable through the public API: `library.ts` keeps only 8-dancer named formations and mirrors every
4-dancer one up to 8, so `boardForFormation('Wave RH GBBG')` yields no wave of four, and on the doubled
board the matcher picks the 8-dancer demonstration tam anyway.)

**AND THE AUTHORITY SAYS IT MUST WORK EACH.** `Fan the Top` is a per-half call in the reference —
`FanTheTop extends SplitCall`, and `split_call.dart` states it outright: *"This is a class for 3- or
4-dancer calls ... The formation is split and the call performed on each side"* (near/far first, then
left/right) — and `SpinTheTop` is defined as two parts: part 1 `Swing` (whole board, after checking
every active is in a wave), part 2 `Fan the Top`. Both are CODED in the reference and therefore only
demonstrations in the XML — our `ms/spin_the_top.xml` is byte-identical to the reference's and neither
marks it `sequencer="no"`. This is the `Fold` pattern exactly, whose remedy (transcribe the rule) is
already the house style.

**TWO CHEAP CANDIDATE FIXES ARE NOW MEASURED AND ELIMINATED (round 28).** Both were the obvious
shortcuts past writing a derived rule, and both are refuted by measurement rather than argument.

1. **"Just prefer the per-half (parallel) reading."** REFUTED. `parallelApply` is private, but it is
   reachable publicly: `selectInterpretation` picks between the whole-board and parallel readings with
   `config.rand()`, so `setSelectionMode('probabilistic')` + `setRandomSource(() => 0.999)` pins the
   parallel branch. Forced that way on the canonical boards:

   ```
   Ocean Waves  Fan the Top  [PARALLEL]  a line of 8 at y=0 spanning x=-5..5   WRONG
   Ocean Waves  Spin the Top [PARALLEL]  a line of 8, x=-5..5                  WRONG
   Tidal Wave   Fan the Top  [PARALLEL]  Ocean Waves, columns x=±1, ±3         same as whole-board
   Tidal Wave   Spin the Top [PARALLEL]  Ocean Waves, columns x=±1, ±3         same as whole-board
   ```

   So the per-half route is not merely unhelpful on these boards, it is *worse* on `Ocean Waves`
   (scattering dancers out to x=±5). `parallelApply` reaches the 4-dancer tams — line 492 of
   `applicator.ts` skips any setup of size ≥ the board, so the 8-dancer demonstration tam is never a
   candidate there — and the 4-dancer tam still produces the wrong shape. **The 4-dancer motion is
   wrong too, not just the 8-dancer wrapping.** The variant inventory (added to the same probe, because
   "which sizes exist" decides what the per-half route can even reach) rules out the alternative that
   it had tiled into something smaller:

   ```
   Fan the Top:  28 matchable variant(s) - 10x4-dancer, 18x8-dancer   (no 2-dancer setup at all)
   Spin the Top: 10 matchable variant(s) -  4x4-dancer,  6x8-dancer
   ```

   so on an 8-dancer board the parallel route can only ever use the four-dancer tams, and it did.

2. **"Correct the `Tidal Wave` template's scale."** REFUTED, and this one matters because it looks like
   a port bug. `formations.xml` authors `Tidal Wave` with its four dancers ONE apart (y = -3.5, -2.5,
   -1.5, -0.5) while `Ocean Waves` authors its four TWO apart (y = 3, 1, -1, -3). That IS a real scale
   outlier — but it is **not ours**: `taminations-flutter/assets/src/formations.xml` lines 1110-1115 are
   byte-identical, so the half-scale `Tidal Wave` is authoritative reference data, not a transcription
   error. The reference gets away with it because its calls are CODED and never use a template as a
   match target; our engine does, which is the architectural difference this whole section is about.
   Editing the template would be inventing data.

   The reusable lesson: **`poc/src/assets` and `taminations-flutter/assets` are the same catalogue,
   so "the data is wrong" must be checked against the reference copy before it is believed.** VERIFIED
   for the four files this section depends on — `formations.xml`, `moves.xml`, `ms/spin_the_top.xml` and
   `plus/fan_the_top.xml` all compare **identical** to their reference counterparts (only the path differs:
   `assets/src/X` there, `assets/ms/X` here). A `Compare-Object` of the two trees is the cheap first
   step, and it would have saved this round.

**IMPLEMENTED (round 29): `fan-the-top.ts` is now a DERIVED call, and the defect above is gone.** The
rule, the derivation and the two canonical boards it was validated on are in that file's header; the
short version is that reading CALLERLAB's "three quarters" (centres) against "a quarter circle" (ends)
as two groups turning in OPPOSITE senses is the only reading in which **every dancer walks forward**,
and it is the only one that satisfies the definition's own closing sentences:

```
ends     rotate -90° (clockwise)        about the SET centre
centres  rotate +90° (counterclockwise) about the SET centre     positions AND headings
```

Measured on the canonical board, before and after:

```
Ocean Waves  Fan the Top   BEFORE: "Tidal Wave", ONE line of 8 at half spacing (all y = 0)
Ocean Waves  Fan the Top   AFTER:  "Ocean Waves", TWO rows at y = ±2, gaps 2.00
```

with centres still the middle two of their row and ends still the outer two, on both rows — which is
the definition's "centers remain centers and ends remain ends" checked directly rather than assumed.
Both properties are now a GATE in `engine/test/sequencer.mjs`.

WHY THE SET CENTRE AND NOT EACH WAVE'S OWN: rotating each wave about its own centre sends both onto the
same line (both centres lie on the x-axis) where they overlap; about the SET centre they stay separate,
which is what makes `Spin the Top` work from two parallel waves. Registered with `catalogueFallback`,
so the boards the derived rule does not cover — diamonds, facing couples, Eight Chain Thru, lines — are
still the catalogue's, and the derived rule only ever replaces the boards the catalogue gets wrong.

**IT FIXES A MEASURED DEFECT WITHOUT MOVING A METRIC — and that is recorded rather than glossed.** All
three sides are UNCHANGED: figures **116 of 188**, get-out **124 of 265 / 112 applying the finish**,
`verify` green (20 harnesses). So no published figure currently depends on a wave `Fan the Top`. It is
kept because it is a correctness fix with a gate, it is strictly additive by construction, and it is
the prerequisite for `Spin the Top` — which is where the figures actually are (`Spin the Top` is used by
16 figures, and 4 of them — `figm48`, `figm59`, `figm115`, `figm126` — stop on the half-scale board this
removes). **The next step is therefore `Spin the Top` as part 1 `Swing` + part 2 `Fan the Top`, now that
part 2 exists.**

**AND THE COMPOSITION FOR `Spin the Top` IS ALREADY MEASURED TO WORK ON THE WAVE CASE (round 29).**
Nothing is wired yet — this is a probe result, recorded because it decides the next move. `Swing` then
`Fan the Top`, both existing calls, against `Spin the Top` direct:

```
start          Swing                then Fan the Top      Spin the Top direct
Ocean Waves    Ocean Waves (2.00)   Ocean Waves (2.00)    Tidal Wave  (1,2,3)   <- direct is WRONG
Tidal Wave     Tidal Wave (1,2,3)   Ocean Waves (2.00)    Ocean Waves (2.00)
Normal Lines   REFUSED              (Swing refused)       Ocean Waves (2.00)
```

So on `Ocean Waves` the two-part composition gives the RIGHT answer where the catalogue tam gives the
wrong one, and `Swing` preserving the formation (measured in round 27) is exactly why. Three things the
next round needs, all now visible in that table:

- the `Ocean Waves` row is the win to wire, and it is the board the four blocked figures reach;
- the `Tidal Wave` row is NOT yet right, and the reason is specific: an eight-dancer Tidal Wave is ONE
  continuous chain of eight hand-holds (facings W,E,W,E,E,W,E,W — a wave of EIGHT, not two waves of
  four), so `findWaves` correctly refuses it and the call falls back to the catalogue. Whether Fan the
  Top is even legal from a tidal wave is the open question, and it should be settled before coding;
- the `Normal Lines` row shows `Swing` refusing, so the composition needs `catalogueFallback` like the
  other partially-ported calls rather than replacing the call outright.

**IT WAS THEN WIRED AND MEASURED, AND IT COSTS TWO FIGURES — SO IT IS NOT SHIPPED (round 30).** The
branch is written, works on the canonical board, and is recorded in `sequencer.ts` as a comment rather
than as code. The measurement:

```
census   116 -> 114 figures        (72 -> 74 blocking ids)
get-out  unchanged
```

DIAGNOSED, not assumed — and the diagnosis is the useful part. `Spin the Top` does **not** appear in the
blocking-call list after the change, so the two figures do not fail AT the call; they fail LATER, on the
corrected board. `figure-census.mjs` gained an `--ids` flag for exactly this, and diffing the two runs
names them: **`figm140`** and **`figm183`**. Traced with the composition enabled:

```
figm140  ... Spin the Top | Right and Left Thru | Rollaway | Touch 1/4 | Boys Run Right | Swing Your
         Partner | Promenade            -> FAILS at #10 Promenade
         "the couples are out of sequence: couple 2 is -90 degrees round the ring from couple 1,
          not 90 counter-clockwise, so promenading would not bring everyone home"
figm183  ...                             -> FAILS at #8 Trade By
         "No setup in this call matches the current formation."
```

So both regressions are the STACKED-REFUSAL shape this plan keeps recording, and both are already-known
categories: the `Promenade` ring-order refusal is the one §5 documents (its owner is the unmodelled
`Swing Your Partner` end pose, which no local rule fixes), and `Trade By` is a Phase B setup gap. Two
figures were passing only because the catalogue's half-scale `Spin the Top` happened to leave the pose
the next call wanted — which is worth recording on its own, because it means **a correct call can lower
the census**, and the two downstream gaps must be fixed in the SAME change as the composition.

TWO THINGS THE NEXT ATTEMPT MUST NOT RE-LEARN:

- **each part must go through the coded-move dispatch, not straight to the applicator.** `CallApplicator`
  has no knowledge of coded moves (`findCodedMove` does not appear in it), so
  `applicator.applyStep(board, 'Fan the Top')` silently reads the CATALOGUE tam and returns the wrong
  board as a legal result — the very bug the composition exists to fix, one level down. The first cut of
  the branch did exactly that and measured `Spin the Top` from `Ocean Waves` as unchanged. The working
  line is `const applyAny = (b, call) => this.tryCodedMove(b, call) ?? this.applicator.applyStep(b, call);`
- `Right and Left Thru` is NOT the blocker, despite being the next call in `figm140`: measured legal at
  error 0.000 on both canonical boards (Eight Chain Thru / Normal Lines). The blocker is ten calls later.

**AND THE COMPOSITION DOES UNBLOCK THE FOUR TIDAL FIGURES — THEY JUST LAND ON TWO KNOWN GAPS.** This is
the part that decides where the next round should spend its time, so it is measured rather than reasoned.
With the branch enabled and the four figures traced:

```
figure    blocked WITHOUT the composition        blocked WITH it
figm48    #5 Slide Thru                          #7 Trade By        (two calls deeper)
figm59    (same tidal wall)                      #10 Promenade
figm115   (same tidal wall)                      #11 Promenade
figm126   #4 Pass Thru                           #4 Pass Thru       (unchanged)
```

So `Slide Thru` and `Pass Thru` ARE unblocked by it — they refuse only on the half-scale tidal board and
are both legal at error 0.000 on a proper `Ocean Waves` (measured: `Slide Thru` -> Normal Lines,
`Pass Thru` -> Trade By). The chain then ends on one of exactly two things, both already in this plan:

- **`Promenade`, the ring-order refusal** — the one §5 documents as CORRECT and unfixable locally, whose
  owner is the unmodelled `Swing Your Partner` end pose. It blocks `figm59`, `figm115` and `figm140`.
- **`Trade By`, "no setup matches"** — and this one I first called a Phase B setup gap (round 30) and was
  WRONG: **§3 ALREADY REFUTES IT**, and the row is in the refuted table because it was measured there —
  *"`Trade By` on `Lines Facing Out` 11.71 at 0.75"*, i.e. **no uniform scale gets this board near any
  `Trade By` setup** (best residual 11.71 even at the best scale found). So it is not a setup that is
  missing at a wrong spacing; the arrangement is simply not one the call has. That is confirmed against
  both authorities: CALLERLAB's starting formation for `Trade By` is the formation NAMED "Trade By"
  (dance action: *"Centers Pass Thru while Outsides, who must be Couples facing out, Partner Trade"*,
  ending Eight Chain Thru), and on `Lines Facing Out` there are no facing dancers anywhere for the
  centres' `Pass Thru` — every one of the four physical couples (the columns) faces OUT. The reference
  cannot dance it either: `Trade By` has **no `.dart` file at all** (`find` over `lib/sequencer` finds
  only the abbreviation table and `square_the_bases.dart`), so it is pure catalogue tams, and those tams
  are `from="Trade By"`, `from="3/4 Tag"`, `from="T-Bones"` — no `Lines Facing Out`. **So the engine's
  refusal agrees with the reference and with CALLERLAB's starting formation, and the two figures are
  gated on the corpus's choreography, not on a missing setup.** Authoring one would be inventing
  choreography for an arrangement no authority lists.

WHY THAT MAKES THE COMPOSITION A NET LOSS AND NOT A NEAR MISS: enabling it costs `figm140` and `figm183`
and gains nothing, so the four tidal figures must ALSO start passing for it to pay — and they sit behind
`Promenade` (three of the four) and this `Trade By` board (the fourth), **and NEITHER is fixable from the
authorities this repo holds**: the `Promenade` ring-order refusal is correct and owned by the unmodelled
`Swing Your Partner` end pose, and this `Trade By` board is not a starting formation at all.
**THE CONCLUSION IS THEREFORE THAT `Fan the Top` / `Spin the Top` IS A DEAD END FOR THE FIGURE COUNT**,
not merely unprofitable today — both of its downstream gates are closed for reasons no code change in
this repo can clear. The four figures this section was chasing are NOT gated on the half-scale
`Tidal Wave` after all; that was the plan's assumption, and it is refuted. The derived `Fan the Top` is
still kept on its own merits (correctness, a gate, strictly additive), but it is not a route to figures,
and neither is the composition that builds on it. **The next work should go where the census's own causes
point — the authoring queue and the body errors — not further down this branch.**

**AND THE RULE, AND WHERE IT CAME FROM (round 28).** The definition is not in `callerlab-ms.txt`
(`Fan the Top` is Plus), but the reference ships CALLERLAB's own text at
`taminations-flutter/assets/plus/fan_the_top.md`, and it is short enough to derive from directly:

> Starting formation - ocean wave or two-faced lines. **The centers of the line or wave turn three
> quarters (270°) while the outside dancers move forward in a quarter circle.** The ending formation is
> at right angles to the starting formation. **Centers remain centers and ends remain ends.**
> (Timing: 4)

That is a DERIVABLE rule — a rotation about the wave's own centre, with the centres taking 270° and the
ends a quarter circle, the result at right angles — and it needs no catalogue motion at all. So the
implementation is `fan-the-top.ts` in the same shape as `fold.ts` / `trade-run.ts` / `swing-thru.ts`:
transcribe the rule, split for boards over four dancers, and gate it on the two canonical boards. The
one thing to get right and to MEASURE first is the SIGN of the rotation (which way the wave turns),
since the definition does not state it — and the canonical test settles that in one run, which is why
the probe prints facings as well as positions.

**AND BOTH COMPOSITIONS WERE IMPLEMENTED, MEASURED AND REVERTED — ROUND 26 FOUND WHY.**
In `tryCodedMove`, by two different routes:

- `Swing` (whole) then `Fan the Top` through `parallelApply`: **116 → 112**.
- the same composition with `Fan the Top` split GEOMETRICALLY (by the separating axis, near/far then
  left/right, as the reference does) and applied with pure-relative motion: **116 → 108**.
- `Fan the Top` per half ALONE, by BOTH routes: **116 → 115**, losing `figm34` and gaining nothing.

And the boards the last of those produces are the answer: `figm34` comes out with dancers **seven units
apart** (`(-7,0) … (7,0) … (-1,2)`) and `figm126` with **two dancers on (0,-2) and two on (0,0)** — i.e.
broken bodies, not waves. The cause is a MISSING ENGINE CAPABILITY, not a wrong reading: the engine's
only pure-relative apply path is `applySearch`, and `applyToBoardInner` ties the tolerance to the rebase
— `matchTol = rebase ? DEFAULT_MATCH_MAX : SEARCH_MATCH_MAX`, i.e. **the no-snap path is always the LOOSE
6.0 path**, so a half that is not exactly a wave matches some other setup and the motion goes anywhere.
There is no "strict tolerance, no snap" mode to do what the reference does with centred halves.

**AND THE REFERENCE'S OWN `Swing` IS A FURTHER INGREDIENT THE ENGINE LACKS.** Transcribed verbatim from
`taminations-flutter/lib/sequencer/calls/a2/swing.dart` (CODED there, so `a2/slip.xml`'s tams are
demonstrations too — which is exactly why the composition leaned on the wrong `Swing`):

```
//  If single wave in center, just those 4 Swing
if (!ctx.subContext(ctx.center(4), (ctx2) {
  if (ctx.dancers.length > 4 && ctx2.isLines() && ctx2.isWaves() && !ctx.isTidal()) {
    ctx2.analyze();
    ctx2.applyCalls('Trade');
  }
})) {
  //  Not single wave in center
  if (ctx.actives.every((it) => ctx.isInWave(it)))
    ctx.applyCalls('Trade');
  else
    throw CallError('Dancers must be in mini-waves to Swing');
}
```

— i.e. the A2 `Swing` IS `Trade`: the centre 4 trade when the board is lines-and-waves and not tidal,
otherwise every active trades provided every active is in a wave. The engine's derived `Trade`
deliberately REFUSES a bare call ("Trade names a group to trade"), so the composition has no whole-board
wave `Trade` to lean on either — two missing ingredients, not one.

**Next step, precisely:** pin `Swing` to this rule, pin a whole-board wave `Trade`, and add a
strict-tolerance no-snap apply mode (or split only into halves that match a wave setup within
`DEFAULT_MATCH_MAX`), then redo this. The prize is not small — `figm48`, `figm59`, `figm115` and `figm126`
all stop on the half-scale board this would remove, and 16 figures use `Spin the Top` at all. Note also
the simulation that DID pass: applying the composition OUTSIDE the engine made figm48 and figm59
run end-to-end on a proper two-wave board, so the reading is sound and only the ingredients are missing.

Those defects, once diagnosed, are `Spin the Top`'s half scale, `Split Two`'s whole-board motion, and the
`Mixed Columns` boards that `Heads Touch 1/4` leaves — or else choreography that would have to be derived
from a definition this repo does not hold. `/walk and dodge` evidence retained below; the 1.57-against-1.5 coincidence that made
the bucket look like a tolerance artefact is refuted in §3.

### The `selection will not resolve` bucket, diagnosed (round 12) — three causes, not one

The bucket had never been read at all; all eight stops are now attributed, and they are three
different things:

| stop | figures | what it actually is |
|---|---|---|
| `Centers Left Hand Star` | 5 | `Centers` has **no definition on a two-star board** |
| `Partner Trade 1 1/2` | 1 | a **dangling group key**: `'partner' → 'partners'`, a group nothing implements |
| `Centers Swing Thru` / `Centers Pass Thru` / `Centers Turn Thru` | 3 | unnamed, off-grid boards — body errors upstream |

**The `partner` fix is DONE and is an attribution fix, not a figure win.** `SELECTION_GROUP` mapped
`'partner' → 'partners'` and `Grouping.subsetOf` has **no `partners` case**, so the mapping made
`splitSelection` claim a selection that nothing could ever resolve. Measured: `Partner Trade 1 1/2`
split into `{ selection: 'Partner', call: 'Trade 1 1/2' }`, neither name is a registered call, and the
failure surfaced as *"Unresolvable selection: Partner"* — an accusation about a GROUP, for a call the
engine simply lacks. `Partner Trade` and `Partner Hinge` **are** registered calls (12 and 4 variants),
so the whole-board path already handles them and never reaches the table. With the key removed the
engine says what is true — `Unknown call: Partner Trade 1 1/2` — and the census moves 8 → **7**
selection refusals and 3 → **4** unknown calls, with the figure count unchanged at 110.

**`Centers` on a two-star board is a real gap with no cheap fix.** The five figures stop on a board
the engine names `Stars RH`: two four-dancer stars, each of radius 1, centred at `(-2,0)` and `(2,0)`.
`Centers` is defined in `grouping.ts` as *the middle two of each of two LINES*, and that board has no
lines at all, so the selection refuses before anything dances. What the corpus means by `Centers`
there is one of two readings the board cannot settle — the four dancers nearest the SET's centre, or
the four who formed one of the two stars — and the second reading is really Phase C's active-set
question, because the corpus's `Right-hand Star` is bare and the engine applies it to all eight,
forming TWO stars. A definition that picks four of those eight would be a guess.

**`Walk and Dodge` (4 stops, three of them counted in other buckets) is NOT a spacing gap, and that is
now measured rather than assumed.** All four sit on a `Mixed Columns RH Ends In` board produced by
`Heads Touch 1/4`, and against every authored setup — `Right-Hand Box`, `Left-Hand Box`, RH/LH Waves,
RH/LH Columns — the best error is **NULL at tolerance 100**: no setup even has the right SHAPE. The
inner four dancers are two couples facing OPPOSITE ways, which is not a box circulate formation. So
the missing-separation recipe that won four figures elsewhere does not apply, and `Walk and Dodge` is
a Plus call whose definition is not in this repo's CALLERLAB text — authoring a variant would be
asserting choreography, which is the line this plan does not cross.

**CORRECTED IN ROUND 20 (the attribution, not the outcome — and it makes this a real lead).** The
para above calls those boards a body defect, and `Heads Touch 1/4`'s output is NOT one. Measured:

- `Heads Touch 1/4` from a Static Square lands on the engine's own **named** `Mixed Columns RH Ends
  In` at error **0.00**, and its arrangement is exactly what CALLERLAB's *Static Square Convention*
  prescribes for this very call — it lists "Heads Touch a Quarter" among the calls whose actives
  "remain in the center". The heads end as two right-hand mini-waves at `(±1,±1)` and the sides never
  move ✓. `Boys Run Right` then lands on the named `Mixed Columns RH Centers Out` at error **0.00**.
  So the stops are the CALLS' fault, not the body's.
- `Swing Thru` is genuinely improper on `Mixed Columns RH Centers Out`: after the Facing Couples Rule
  its starting formation "must be a Wave or an Alamo Ring", the board's inner four are two couples
  facing OPPOSITE ways, and two separate mini-waves are not a group of four. Its derived rule already
  declines, correctly (round 18's finding, now confirmed on a SECOND board).
- `Walk and Dodge` is an **ARRANGEMENT gap inside columns** — but **the round-20 hope that the rule
  is "readable" from the reference is REFUTED (round 21), before any code was written.** What IS true:
  the catalogue and the reference AGREE exactly on every arrangement they both author (their RH/LH
  Columns path lists are identical), and for columns the rule is consistent — in each pair one behind
  the other with the same facing, the BACK dancer walks (`Forward`) and the FRONT dodges sideways
  (right for RH, left for LH). What is NOT true is that one rule covers the call: the `Box RH` variant
  is authored from a two-dancer MINI-WAVE whose pair are 2 apart with OPPOSITE facings, and there the
  east-facing dancer walks — a different shape with a different assignment. And the arrangement the
  corpus reaches (`Mixed Columns RH Ends In`) is authored by NEITHER: it is two RH mini-waves in the
  centre plus two end couples, whose pairing for Walk and Dodge is not determined by either authority
  (a line of three dancers facing the same way plus one facing back). Authoring it would be a guess
  that the metric would reward — up to 3 figures (`figm15`, `figm16`, `figm179`; `figm207` is on an
  unnamed board) — while corrupting the boards, which is the line the plan does not cross. It needs a
  CALLERLAB Plus definition this repo does not hold.

### Phase D — the missing calls (Phase 14 residue)

**Owner:** `coded-moves.ts` (derived) or the catalogue (authored). The header here used to say the
census `unknown call` was "down to **3**"; **re-measured in round 27 it is 6**, and the new probe
`engine/test/tools/unknown-calls.mjs` names the figure behind each one (the census only reports the
call name). The six, with their dispositions:

| figure | call | disposition |
|---|---|---|
| `figm125`, `figm149` | `Pass One` | read and CLOSED (round 20) — not a CALLERLAB call, not in the reference |
| `figm142` | `Change Hands` | read and CLOSED (round 17) — a handhold change, moves nobody |
| `figm145` | `Partner Trade 1 1/2` | declared gap: `--PtTrd --1-1/2` composes a name the catalogue lacks (`KNOWN_CATALOGUE_GAPS`) |
| `figm226` | `Separate Around Two` | read (round 16) — a missing PHRASE, plus an unread notation cell |
| `figm70` | `Yellow Rock` | read and CLOSED in round 27; see below |

Then the rest of the tail, re-ranked by what is now known about each:

- `Walk Across` (1), `8 Circulate 1 1/2` (1), `Scoot Back` (1), `Circulate` (1) — single-figure
  refusals, each "not legal for selected dancers" or a no-setup, so each wants a diagnosis before an
  implementation (`setup-coverage.mjs` classifies them).
  **Three names have dropped out of this list, re-measured in round 27**: `Circle 2` and `Trade 1 1/2`
  block **nothing** any more (neither appears in the census at all), and the only remaining `Turn Thru`
  refusal is `Centers Turn Thru`, whose recorded cause is `selection will not resolve on this board` — a
  selection problem, not a missing call, so it belongs to Phase C's active-set item below.
  **`Promenade 1/2` is DONE — round 18, +1 figure (`figm86`).** It was not a missing call so much as a
  missing FRACTION: `all8-notation.ts` decodes `Pr1/2` to "Promenade 1/2", the corpus reaches it as
  `All Promenade 1/2`, and the engine had no bare `Promenade 1/2` at all (`Unknown call`) while the
  circle's own precondition already knew how to tell whether a board may promenade. `promenadeFraction`
  reuses every one of `promenadeHome`'s checks and then ROTATES the home squared set by the ring's
  current rotation plus the fraction — the vertical direction taken from the ring-order test's own
  convention (counter-clockwise, home couple 1 on the south side). Only the HALF is registered:
  `Promenade 3/4` and `Promenade Full` decode too but are reached by no figure bare, so they wait for a
  witness; the same helper serves them in one line.
- `Yellow Rock`, `Pass One`, `Separate Around Two` — three names this section once grouped as "named in
  the census and in CALLERLAB; read the definition before writing the rule". All three are now read, and
  that grouping was itself wrong: **two of the three are not in CALLERLAB at all**. A corpus name that
  neither authority defines is the finding, not a detail.
  **`Yellow Rock` is now READ and CLOSED (round 27), and it is NOT in CALLERLAB.** The corpus reaches
  it once, at `figm70`, whose chain (decoded names, from `figure-trace.mjs`) is
  `Heads Promenade 1/2 | Heads Square Thru 4 | Right and Left Thru | Veer Left | Couples Circulate |
  1/2 Tag | Cast Off 3/4 | Boys Fold | Yellow Rock | ...`,
  and the engine stops on it with `Unknown call: Yellow Rock` from an **unnamed** board — the
  `Boys Fold` body error again, so `figm70` carries two independent blockers exactly as `figm226` does.
  Searches: `callerlab-ms.txt` (231,768 bytes, and it DOES contain `Square Thru`) has **no** occurrence
  of the word `Yellow` at all, and its only `Rock` is line 628, `Rock Forward and Back (from Facing
  Lines)` — a COMMAND EXAMPLE of `Forward and Back`, a different call; `taminations-flutter/lib` has no
  hit either. So neither authority in this repo defines it, and — the difference that matters — **the
  corpus itself declines to treat it as a call**: All8's get-out key reaches it twice more as
  `B-XFold "sneaky"-YelRk` and as `--YelRk (gimmick - still [B1c] - neutralizes hand use)`. A call whose
  own corpus gloss is "gimmick ... neutralizes hand use" is a HANDHOLD effect, which is `Change Hands`'s
  blocker again: the engine keeps no handhold state on the board, so any implementation would be a
  motionless no-op asserting an effect the engine cannot represent. Recorded, not implemented — and note
  it is NOT worth re-opening for the figure count even if a definition were found, because the
  `Boys Fold` board in front of it would have to be fixed as well.
  **`Pass One` is now READ and CLOSED (round 20), and it is the strongest temptation in this file so
  far.** All8's key glosses it `Pass1  Pass One  (Pass by 1, Pass 1 by, Skip 1)`, and the corpus
  reaches it twice, both as `... Allemande Left | Pass One | Swing Your Partner | Promenade`
  (`figm125`, `figm149`) — the two figures the `Circulate 2` multiple just moved deeper. **It is not a
  CALLERLAB call**: the Mainstream text has no entry, and its Right and Left Grand family (where such a
  prompt would live) gives only "Right and Left Grand" and "Grand Right and Left" as command examples.
  The reference does not implement it either — no hit anywhere in `taminations-flutter/lib`. And the
  measurement that makes a no-op tempting is exactly why it must not be one: **after `Allemande Left`
  every dancer already faces their PARTNER** (`seq.applyToBoard(sq,'Allemande Left')` gives the
  `O Trade By` pose, each dancer facing its own home couple) and **`Swing Your Partner` is already
  legal on that board**, so shipping `Pass One` as "no geometric effect" would win two figures by
  asserting an effect nobody has defined — the same call as `Change Hands` above, and the same answer.
  If it is ever implemented it needs a definition of where a "pass" leaves the ring, and neither
  authority in this repo has one.
- **`Change Hands` — DIAGNOSED, deliberately NOT implemented (round 17).** It became `figm142`'s stop
  once the Fold adjustment moved that figure deeper, and the corpus reaches it as
  `... Boys Fold | Box the Gnat | Change Hands | Allemande Left | ...`. It is **not a call with a
  dance action**: CALLERLAB mentions it once, in Box the Gnat's *command examples*
  (`Box the Gnat, Change Hands; Allemande Left`), and its Box the Gnat comment explains it — *"The
  right hands are still joined at the completion of the action, and often the next call will begin
  with the joined right hands."* So it changes which hand is joined and moves nobody. The reference
  has no implementation of it either (no hit in `taminations-flutter/lib`). The engine keeps no
  handhold state on the board, so a no-op coded move would be geometrically invisible and would make
  the engine claim a call it does not model — a figure moved by an unobservable change is exactly the
  kind of "win" this plan refuses. Recorded with its evidence instead; it belongs with the handhold
  model, not with Phase D's missing calls.
  **`Separate Around Two` is now READ, and it is not a missing call — it is a missing PHRASE
  (round 16).** All8's `--SepA2` decodes to the name `Separate Around Two`, and the catalogue has no
  such title; but `ms/separate.xml` and `b1/separate.xml` DO author the motion, as fragments of the
  published phrase: `Around One to a Line`, `Around Two to a Line`, `Around One and Come Into the
  Middle`, `Around Two and Come Into the Middle`, each `formation="T-Bone URLU"`, plus the whole-phrase
  tams `Heads Pass Thru, Separate Around 1/2 to a Line` and `... and Come Into the Middle`, all
  `formation="Static Square"`. The corpus's `figm226` is
  `H-PasTh | --SepA2 | S-SqTh4 | H-meet-T1/4 | -BRun | ...`, i.e. exactly the decomposed form of
  *Heads Pass Thru, Separate Around 2 to a Line* — so the fragment is the right target. **Measured:
  after `Heads Pass Thru` the engine's board is `T-Bone LDDR`, and `Around Two to a Line`
  (`T-Bone URLU`) refuses on it with "no setup matches"**, so the fragment's authored start and the
  board the engine produces are different T-Bones; a bridge would need a `T-Bone LDDR` authoring, i.e.
  new choreography, not a synonym. **And `figm226` has a second, independent blocker**: its
  `H-meet-T1/4` cell is one of the four UNREAD notation cells, so the figure would still not run
  end-to-end. Two blockers, one of them in the decoder → recorded, not started.
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
  **CLOSED AS "NOT AN ENGINE GAP" in round 16, by measuring the reference.** Its `analyze()`
  (`call_context.dart`) sorts the dancers by distance from the set's centre and only designates
  centers when there is a clean split: a 4-vs-4 gap (`!dorder[3].isAbout(dorder[4])`) or a centre
  wave of 4. On this board the distances are **{1.0, 1.0, 2.236 ×4, 3.0 ×2}**, so `dorder[3]` and
  `dorder[4]` are BOTH 2.236 and the 4-centres branch is skipped, while `dorder[1] = 1.0 ≉ dorder[2]
  = 2.236` puts the two closest into **very centers** — so the reference's `Centers` here is **zero
  dancers**, and its `Centers Left Hand Star` cannot run either. The reference does not decompose this
  chain at all: its `ms/star.xml` ships a SINGLE `<tam>` titled *"Heads Square Thru; Make A Right Hand
  Star With The Sides; Heads Center Left Hand Star; Back To The Same Girl With A Right and Left Thru"*
  — one animation for the whole phrase (see Phase L). The engine's refusal agrees with the reference;
  what is missing is the phrase, not the selection rule.
  (`figm75` is in this set AND has an unread notation cell, `--1/2`, so even a fix here would leave it
  short — `unreadCells` reports 4 cells in total: `figm75 --1/2`, `figm170 S-`, `figm184 --Keep`,
  `figm226 H-meet-T1/4`.)

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
3. **DONE (110 → 113 figures) — the ROLE reading, which is what the note above said could not be
   done.** The note was right that `Star Thru`'s motion is slot-SENSITIVE and that a geometric retry
   applying a slot's motion to the wrong dancer is wrong — and that is exactly why the fix is not a
   retry of the SLOT motion but a move to the ROLE motion: the call's paths are what a BOY does and
   what a GIRL does, so the right motion for a board dancer is selected by that dancer's own gender.
   Legitimate because a path is authored in **dancer-local space** (`types.ts`), making two slots'
   paths directly comparable, and enabled only where the variant's own data says the role is
   unambiguous (`roleUniformMotions`: 145 of 287 gender-specific variants). See §2 for the four
   witnesses and the measurements. So the family is now **three** distinct gender mechanisms, in the
   order they are tried: per-SLOT (the catalogue's own, unchanged and first), per-COUPLE
   (`PAIR_GENDER_CALLS`, for calls whose motion is gender-symmetric), and per-ROLE (`roleUniformMotions`,
   for calls whose motion differs by gender but is identical within a gender).

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

**Owner:** the formation vocabulary — the gap is **20 formation NAMES**, not 9 missing calls.
**RE-MEASURED IN ROUND 24, AND THE PREVIOUS NUMBERS WERE AN INSTRUMENT BUG.** The tool's (C) check asked
a formation name against `formations.xml` ALONE, so every name the engine authors INLINE on a `<tam>`
(`from="Facing Couples"`, `from="Right-Hand Wave"`, `from="Mini-Wave"`) was reported as "a formation the
engine has no formation for" — false, and misleading for anyone planning work from it. `formationIsKnown`
now also accepts any name used as a tam's `from`, which is the vocabulary that actually matters (the
engine can start a call from it). The measured effect: **8 matched / 2 (call, start) pairs / 24 names
becomes 13 / 9 / 20**, and the seven names that moved are the ones the engine genuinely has (they are
per-call setup gaps, which is what (B) is for).

```
(A) "9 calls the engine cannot perform": EVERY one reports "figures using it: 0" - a name-matching
    artefact (Star Right / Star Left are implemented as Right/Left Hand Star; Square Thru is the
    1/2/3/4 family; Cast Off Three -Quarters carries an extractor space).
(B) 9 (call, start) pairs where the engine HAS the formation but the call authors no setup from it.
    They are mostly GRANULARITY, not absence: "Facing Dancers" is a two-dancer formation (Box the
    Gnat, Dosado, Pass Thru, Slide Thru, Star Thru all document it) while the engine's cheapest
    authorings are four-dancer `Facing Couples`, and "Ocean Wave" is documented for the calls whose
    setups name a wave ARRANGEMENT (`Right-Hand Wave`). Dove Thru from "Facing Couples" and Grand
    Square from "Static Square" (its setups are Butterfly | Blocks) remain the two that are really
    about setups.
(C) 20 formation names the engine has no formation for, led by Couple (6 calls), Ocean Wave (3),
    Box Circulate (2), Mini-Wave (2), One-Faced Line, then 1s. Several are CALLERLAB's SPELLING of a
    formation the engine has under another name (`Ocean Wave`/`Ocean Waves`, `1/4 Tag`/`Quarter Tag`,
    `Two-Faced Line`/`Two-Faced Lines`) - see the note in the tool for why a spelling-bridge map was
    written, measured and REMOVED: it moved three names from (C) straight into (B) without fixing
    either, so the counting is left literal.
```

**Work:** a checked-in mapping from each documented starting-formation name to the engine's
formation(s) — but see the removal note above: the honest version of that mapping has to model the
FAMILY/arrangement relationship (`setup-coverage.mjs`'s job), not string-equality; then re-run the
diff over all 51 (call, start) pairs.
**Gate:** every documented pair is matched by a setup, modelled as a derived start, or listed as a
justified exception with the definition quoted; `callerlab-diff.mjs` becomes a harness so it cannot
drift. Note the overlap with Phase 4e's blocked facing-variant work: this is the same vocabulary.

**A SECOND INSTRUMENT BUG IN THE SAME CHECK, AND THE GATE (round 37).** This section already records
one instrument problem fixed in round 24. There was another, in the (C) count itself:

`unknownFormation` was keyed on the **raw** string while the lookup used `norm(fm)`, so ONE name counted
twice whenever the extractor put a space in it. `One -Faced Line` normalises to the same
`one faced line` as `One-Faced Line`, and `Mini- Wave` to the same `mini wave` as `Mini-Wave` — four
entries for two names. Keying the map on the normalised name (keeping the raw spellings on the entry)
takes **(C) from 20 to 18**, and the tool now prints the spellings so a genuine difference is still
visible.

**AND THE REMAINING 18 ARE NOT 18 MISSING FORMATIONS — about ten are still extractor artefacts**, which
is why the gate pins the NUMBER rather than claiming the list is clean:

```
box circulate                      <- a CALL name, not a formation: Split Circulate, Scoot Back
facing dancers m an  +  w oman     <- the two halves of ONE wrapped line, from "Facing Dancers (Man…"
one m an and one w oman            <- the same wrap inside a description, with the words split too
a couple / normal couple only / facing couples only / facing dancers only
restricted at mainstream to facing couples only
eight chain thru formation in general
```

so the genuine candidates are about EIGHT, not twenty: `couple`, `mini wave`, `ocean wave`,
`one faced line`, `facing tandems`, `single 14 tag`, `tandem facing a couple`, `tandem couples` — and
two of those (`ocean wave`/`Ocean Waves`, `single 14 tag`/`Quarter Tag`) are CALLERLAB's SPELLING of a
formation the engine already has. **Before any mapping is written, the extractor noise has to be
separated**, or the mapping will be built against a list that is half fiction.

**SEPARATED (round 38), AND (C) IS NINE.** Three fixes, all in `callerlab-diff.mjs`, each measured:

1. **Parenthesised asides are stripped BEFORE the list is split.** The source writes `Facing Dancers
   (Man and Woman)`; splitting first on `\s+and\s+(?=[A-Z])` produced `Facing Dancers (M an` and
   `W oman)` — two fragments with unmatched parens, neither of them a formation.
2. **CALL names are excluded from formation lists** — `Box Circulate` is documented as the starting
   formation for `Split Circulate` and is a call the catalogue HAS; three such entries are now counted
   and reported separately.
3. **`PROSEISH` extended** with the markers the list actually showed: `only`, `in general`, a leading
   `a `, `restricted`. Prose entries went 5 → 11.

```
              before   after
matched          13      12
(B) pairs         9      10
(C) names        18       9      <- of which EIGHT are genuine
prose             5      11
call-not-formation 0      3
```

**The nine, and they are clean:** `Couple` (6 calls), `Mini-Wave` (3), `Ocean Wave` (3), `One-Faced
Line` (2), `Facing Tandems` (1), `Single 1/4 Tag` (1), `Tandem facing a Couple` (1), `Tandem Couples`
(1) — plus ONE residual artefact, `one m an and one w oman`, which is `one Man and one Woman` with the
PDF's split words and no parens to strip. The tool prints both raw spellings when a name has several
(`Mini-Wave | Mini- Wave`), so a genuine spelling difference stays visible.

**So Phase F's mapping has EIGHT names to model, not twenty** — and two of them (`Ocean Wave`,
`Single 1/4 Tag`) are CALLERLAB's spelling of a formation the engine already has under another name,
which leaves six to actually author or model. That is a tractable piece of work for the first time.

**A THIRD INSTRUMENT BUG, in the (B) COLUMN, FOUND BY CHASING THE ONE PAIR THAT LOOKED REAL (round 39).**
`Dive Thru` was the single (B) entry whose "engine setups" column read `[none]`, so it looked like the
one genuine missing setup in the list. It is not — **the column was being computed from the `from`
attribute alone, and `Dive Thru`'s tams declare only `formation="Pass Thru"` with no `from` at all**.
The engine has never worked that way: `convert.ts:414` is `label: t.from || t.formationAttr ||
'(default)'`, and `convert.ts:324` builds the setup from `formationAttr` when the tam has no inline
dancers. Reading the label the way the engine does, per tam:

```
Dive Thru   documented "Facing Couples"   engine setups: [Pass Thru]      (was: [none])
```

and two more pairs became visible, which is why (B) went 10 → **11**:

```
Scoot Back  documented "1/4 Tag"          engine setups: [Right-Hand Box, Left-Hand Box, ... Quarter Tag, ...]
Swing       documented "Facing Dancers"   engine setups: [Right-Hand Waves, Left-Hand Waves, Inverted Lines, ...]
```

**AND MOST OF (B) IS GRANULARITY, NOT ABSENCE.** Six of the eleven pairs document `Facing Dancers` —
Box the Gnat, Dosado, Pass Thru, Slide Thru, Star Thru, Swing — and CALLERLAB's `Facing Dancers` is a
TWO-dancer formation while the engine's cheapest authorings are four-dancer `Facing Couples`. Two more
document `Alamo Ring` (Swing Thru, Left Swing Thru) where the engine has `Alamo Wave`. The genuinely
missing setups reduce to `Dive Thru`'s (`Pass Thru` is two facing couples, so the geometry exists and
only the NAME differs) and the two the plan already named: `Dove Thru` from Facing Couples and `Grand
Square` from Static Square, whose setups are Butterfly | Blocks.

**THE DISPOSITION TABLE (round 40), which is this phase's own gate — "every documented pair is matched
by a setup, modelled as a derived start, or listed as a justified exception with the definition
quoted".** Both lists are now short enough to dispose of item by item. The "documented" column IS the
CALLERLAB text, read by the tool from `callerlab-ms.txt`; the dispositions are grouped, not individually
adjudicated, and the two that need real work are named:

```
(B) — a formation the engine HAS, with no setup for it on that call   11 pairs
  GRANULARITY (8): the doc names a TWO-dancer formation and the engine's cheapest authoring is the
    four-dancer one, so the call is performable from the documented start but not MATCHABLE from it.
      Facing Dancers   Box the Gnat, Dosado, Pass Thru, Slide Thru, Star Thru, Swing
      Alamo Ring       Swing Thru, Left Swing Thru   (engine: Alamo Wave)
      -> the work is a two-dancer start for `Facing Dancers`, i.e. one modelled START, not a setup
         per call. `setup-coverage.mjs` is the tool that has to decide the family relationship.
  NAME DIFFERS (1): Dive Thru — doc "Facing Couples", engine setup `Pass Thru`, which IS two facing
    couples (formations.xml: -3/+1 facing, -1/-1 facing). Same geometry, different name.
  GENUINE (1): Grand Square — doc "Static Square", engine setups Butterfly | Blocks. This one is a
    real missing setup, and the plan has said so since Phase 16b.
  (1 left: Scoot Back from "1/4 Tag", where the engine has Quarter Tag AND Single Quarter Tag; a
    spelling question for the same reason as `Single 1/4 Tag` below.)

(C) — formation NAMES the engine has no formation for                       9 names
  SPELLING of a formation the engine already has (4): Ocean Wave (Ocean Waves), Mini-Wave
    (Wave RH/LH, Compact Wave), Single 1/4 Tag (Quarter Tag), One-Faced Line (the engine names the
    two-faced and normal lines; "One-Faced" is the arrangement it does NOT name).
  GENUINE (4): Couple (6 calls), Facing Tandems, Tandem facing a Couple, Tandem Couples.
  ARTEFACT (1): `one m an and one w oman` — the PDF's split words with no parens to strip.
```

**So the honest state of Phase F is: ONE missing setup (`Grand Square`), ONE name mismatch (`Dive Thru`),
ONE modelled start that would clear eight pairs (`Facing Dancers` as a two-dancer formation), and FOUR
formation names to add.** That is the whole phase, and it is a bounded authoring job — not the "20
formation names" the section opened with, which was an instrument artefact three times over.

**THE GATE IS NOW IN PLACE, which is the second half of this phase's closure:** `callerlab-diff.mjs`
pins four measured numbers exactly — 13 matched, 9 (B) pairs, 18 (C) names, 5 prose — and exits
non-zero if ANY moves in EITHER direction, so an improvement is re-pinned deliberately with its reason
rather than absorbed silently. It is registered in `verify-suite.mjs` through the same optional `sub`
field the determinism audit uses, so the suite's "one place to add a harness" rule still holds.

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

**Phase 10 — the determinism smell. CLOSED, and its done-when is now met (round 33).**

What this section used to say: *"Running the corpus with an interleaved `knownFormation` query after every
call yields **20** figures instead of 8; `recognize` yields 8. At the divergence the two procedures apply
the SAME call to a byte-identical board and get different boards... it is a live correctness smell and it
stays open. Done-when: both procedures agree, and `determinism-audit.mjs` is promoted into `verify`."*

**Both halves of that are now satisfied, and the divergence is gone.** Re-measured:

```
=== 7 procedures over 188 figures, random source pinned to 0.5 ===
  baseline: one instance, one start board       116  none
  ...fresh start board per figure               116  none
  ...knownFormation after every call            116  none
  ...recognize after every call                 116  none
  ...fresh Sequencer per figure                 116  none
  ...figures walked in REVERSE order            116  none
  ...fresh catalog objects                      116  none
  baseline repeated: identical (the harness is stable)
```

Seven procedures, **zero differences**, at the CURRENT 116 figures rather than the 8/20 the smell was
found at — so whatever caused it did not survive the intervening work, and the interleaved
`knownFormation` query no longer changes any figure's outcome. The audit now EXITS NON-ZERO on any
disagreement and is registered in `verify-suite.mjs` (full tier only; it lives in `tools/` and is reached
through a new optional `sub` field, so the suite's "one place to add a harness" rule still holds).

TWO THINGS WORTH KEEPING FROM THE EXERCISE:

- the audit's `legalCalls` procedure is **off by default** (`--full` adds it). It enumerates every legal
  call after every call of every figure — ~2000 `legalCalls` computations over the 274-call catalogue —
  and it alone pushed a run past **35 minutes**. The Phase 10 question is whether the procedures
  DISAGREE, and `legalCalls` is a robustness check rather than part of that comparison.
- the promoted set costs **214.9s**, measured. `verify` was 290.2s over 20 harnesses, so this is the
  largest single addition the suite has taken; it is still within the ~9 minutes the suite's own header
  budgets for the full pre-commit gate, and `verify:light` is untouched.

The 61-edge coded-vs-catalogue divergence recorded above is a DIFFERENT open item and is NOT closed by
this — the audit compares walk PROCEDURES, not the two application paths.

**Standing (Phase 7):** keep `poc-matrix/` out of `verify`, and run `map-tips.mjs` whenever the FSM is
touched. `transitionTable` costs **36.8 s / 155 states / 1961 edges** on the 274-call Mainstream
catalog, and `legalCalls` is ~99% of it.

### The modules / cell-vocabulary direction for the FSM — Stage 0 DONE, measured

**The problem it answers.** The FSM's EDGES are quantised to named states, so a transition whose end
the namer refuses (`endFormation: null`, 66% of them) has no target node, and closing over those ends
as new states **DIVERGES** (recorded in `buildFsmTable`: 1840 new geometries at level 1, 3005 states
after enumerating 400 and still growing). So the node set can only be bounded by DECLARATION.

**THE PREMISE CORRECTED, and it matters for every stage that follows: the FSM is NOT the solver.**
`HomeSolver` runs a live DFS over `searchLegalCalls` and never reads the table; the FSM feeds
`poc/src/fsm-view.ts` and `fsm-getout-audit.mjs`. "It can no longer solve get-outs" is true of the
route GRAPH, not of the search. Approved direction: make the graph faithful first, and promote it to
the solver only if a stage produces a witness that the live DFS cannot afford (none exists today —
Phase H records that there are **no failed searches**).

**STAGE 0, MEASURED (`engine/test/tools/cell-census.mjs`, `all` tier, 23 s; vocabulary in
`engine/src/sequencer/cells.ts`).** A cell is `geometry | gender-arrangement | sequence |
relationship`:

```
geometries declared        155   <- EXACTLY the engine's own state set (155). The lattice IS the
                                    state set made explicit, not a second opinion.
  named / setup-only       129 / 26
  geometries with >1 gender pattern   23  (max 4)  <- the arrangement half is real, not cosmetic
  geometries All8 gives a LETTER       9  (B F L P S W)
4416 legal applications over the 133 named states
  end ON the lattice       1414  (32.0%)
  end OFF it (NOVEL)       3002  (68.0%) in 1923 distinct geometries
distinct CELLS reached      396   (57 carry a letter; only 22 are fully readable)
141 of 273 calls mint a novel geometry
```

**TWO FINDINGS THAT SHAPED THE PLAN.**

- **All8's FASR cannot be the node key.** `FORMATION_LETTER` maps nine engine names to six letters, so
  FASR names only **9 of the 129** named geometries (and, over the full transition set, **17 of the
  2052** distinct end geometries). FASROO cannot extend it — `fasrooOf` refuses a formation with no
  agreed reference pair, and Callerlab records one for `[L] [B] [F] [W]` only. **So the vocabulary is
  OURS to author**: `geometryId + arrangement` is a complete identity needing no authority's leave,
  and All8's notation is kept as an ANNOTATION where it exists.
- **The gap is a vocabulary gap, not a missing-formation gap.** The calls that mint novel geometries
  are a narrow, recognisable class — `Face Out` 112, `Step to a Wave` 110, `Step to a Left-Hand Wave`
  110, `Face Left`/`Face Right` 109, `Face In` 107, `Girls Fold` 100, `Boys Fold` 97 on down. Those
  are the pivot/fold/quarter-turn transients PLAN §5 already names, plus the half-scale `Step to a
  Wave` class Phase B records — not 1923 formations the catalogue forgot.

**THE STAGES AFTER IT** (approved, in order): (1) module primitives including a GROUPED step — the
"while" construct `Centers X while Outsides Y`, which is not expressible today (`Running Bear` proves
it is hand-authored per-dancer at the move level); (2) the faithful FSM graph, with the reading and a
`transient` marker on the edge; (3) **modules as FSM edges where start and end are both cells** — the
absorption mechanism that keeps a transient from ever becoming a node, and the stage that proves the
node count stays flat; (4) the solver engine, **only against a witness**.

**STAGE 1 DONE.** `GroupStep` (`types.ts`) + `applicator.applyGroupStep` + the animation and beats for
it, with `engine/test/modules.mjs` (light tier) pinning the four rules the step promises — disjoint,
atomic, calls-only, simultaneous — plus that a grouped result IS the two solo results merged by dancer
id, that the animation lands exactly on the applied board, and that `collapseModule` still composes a
per-dancer matrix across it. `stepsEqual`/`stepCall`/`stepLabel`/`isGroupStep` are exported so the POC
stops re-implementing the step union (its local `stepLabel` would have printed `[object Object]`).
**`Running Bear` could NOT be recomposed, and that is the measurement rather than a failure:** its
sub-calls are named only in comments, the comments annotate chunks of ONE path rather than a shared
timeline, and its own first named sub-call (`Ladies Chain`) is not legal on the board the tam starts
from — so a composed "while" is a NEW capability, not a refactor of existing authoring.

**STAGE 0b — THE LEVEL DIMENSION, and it is a real leak (measured).** A programme/level restricts which
formations and arrangements a call may be used from; later levels ADD to that vocabulary and a lower
level must not see the additions. MEASURED: the engine has **no level concept at all** — level lives in
`poc/src/data.ts`, whose `sequencerCallsUpTo(level)` accumulates "level and all earlier levels" for
CALLS — while `formations.xml` has **no level attribute** and is one flat list used by every level. So
the vocabulary leaks:

```
formations.xml declares                                 273 names
  referenced by some level's tam (formation="Name")     219
  referenced by NO level at all                          54
names each level's own tams introduce (owner counts)    b1 62  b2 51  ms 98  plus 95  a1 76
                                                        a2 86  c1 144 c2 123 c3a 78 c3b 56
first referenced at (declared names)                    b1 60  b2 16  ms 21  plus 33  a1 14
                                                        a2 8   c1 41  c2 22  c3a 3   (c3b 0)
the engine's 134 whole-set names: 100 are NOT states at ms
the 129 named geometries: 88 are NOT states at ms (41 are)
```

**THESE NUMBERS REPLACE AN EARLIER, WRONG SET** (`238 referenced / 35 never`, `b1:137 b2:64 ms:65 …`,
`116 above ms`, `102 of 210`, `70 of 134`), and the error is worth recording because of its shape: the
first probe read `from="…"` as a formation reference and read it off the whole `<tam>` BLOCK, so it was
matching `<path from=…>` and inline `<formation>` children as well. `from` is free text the engine never
resolves a formation from (`buildCallImpl` uses `formation=`), and an inline `<formation>` child means
the tam declared a SETUP, not a name. Only `formation=` on the tam, with inline tams skipped, gives the
219/54 above. The qualitative finding was unchanged either way; every number was.

and the **ms FSM's 155 states were built from that flat list**, so roughly half of its nodes were
formations no ms call introduces. That is the node-bound thesis with its exception found: nodes are
bounded by DECLARATION, so **the declaration has to be level-scoped**. The open design question Stage
0b had to settle by measurement, because the two answers differ a lot: is a formation "introduced" at
the level whose tam NAMES it (strict — then `Face Out`'s own result is unnamed at ms), or at the lowest
level whose calls can REACH it (permissive — then ms keeps everything ms dancing can produce)? The
second needed a per-level reachability sweep, which is what `cell-census.mjs` already did for one level.

**STAGE 0b DONE — STRICT, decided by measurement, and the state set is now derived from the call set.**
(`engine/test/tools/level-census.mjs`, `tools`/`all` tier, ~35 s; the capability is
`library.referencedFormations()` + `CallBundle.formation`.)

**THE MEASUREMENT THAT DECIDED IT.** Seed the closure with the 42 named geometries ms declares, apply
the 273 ms calls, keep every end ON the declared lattice:

```
3063 legal applications, 16 s
PERMISSIVE closure                     78 of 131 declared named geometries   (was 131 flat)
  of those, named only ABOVE ms        34     <- THE ESCAPE
  reachable but NOT declared           36     <- the transient pool Stage 3 must absorb
```

and the escape is not exotic: **`Static MiniWaves RH` is reached by `Boys Run`, `T-Bone DRDR` by
`All 8 Circulate`, `T-Bone RDRD` by `Face Left`, `3/4 Lines RH` by `Boys Run`** — all Mainstream calls.
So "introduced at the lowest level whose calls can reach it" admits **34 formations no Mainstream call
is authored from**, which is exactly the gate it was proposed to keep. 79/35 was measured first on the
APP's pooled "ms" (`sequencerCallsUpTo('ms')` = 291 titles); the shipped asset is built from `ms/*.xml`
alone (273 titles), which gives 78/34, and that is the set the gate pins. **Both readings agree on the
decision; the difference is one geometry.**

**WHAT SHIPPED.** `CallBundle.formation` records the name a `<tam>` declared its start formation by
(`formation="Name"`, `null` when the setup was authored INLINE) — `buildCallImpl` resolved the name and
then threw it away, so the engine could say what GEOMETRY a call starts from but not which DECLARED
formation was asked for. `library.referencedFormations()` is the level-scoped counterpart of
`getUniqueFormations()`: the named formations the REGISTERED CALLS actually start from, deduped the same
way. `buildFsmTable` now takes its NAMED half from that instead of the whole corpus, so **the engine
needs no level concept at all — the level IS the call set**, which is how `poc/src/data.ts` already
models it. `getUniqueFormations()` is untouched and stays the NAMING vocabulary (`knownFormation`,
`recognize`), because "what is this board called" is a question about the corpus and must not depend on
a programme.

**MEASURED, BOTH WAYS.**

```
                                    before        after
ms FSM states                       155           65      (42 named + 23 @embed)
  of which named                    133           42
ms FSM edges                        4656          2260
  unnamed ends                      2937 (63.1%)  1648 (72.9%)
corpus whole-set names              134           134
  not states at ms                  0             100
named states / referenced names     133 / 133     42 / 98
reading-census sweep                4416 apps     1885 apps  (42 named states x 273 calls)
  unnamed end                       2937          996
  sub-8 covering all eight          1107          386
cell-census declared lattice        155 = 155     155 vs 70  (state set is now a strict subset)
  applications on/off lattice       1414 / 3002   844 / 1041
  the vocabulary gap                68.0%         55.2%
  the level scope removes           n/a           54.8% of the declared lattice
```

The state list reads like Mainstream, which is the informal check: `Static Square`, `Promenade`,
`Stars RH/LH`, `Normal Lines`, `Ocean Waves RH BGGB`, `Circle`, `Alamo Wave`, `Thar`, `Diamonds`,
`3 and 1 lines #1..#6`, `Quarter Tag`, `3/4 Tag`, `Double Pass Thru`, `Eight Chain Thru`, `Trade By`,
`Column RH GBGB`, `Tidal Wave`, `T-Bone ...`. **The named half adds NO geometry at all** — all 41
referenced geometries are already registered start setups, so the states are precisely the setups of the
calls registered and the named half only supplies human-readable KEYS. That is the clean statement of
the rule, and the 23 setups with no in-scope name stay `@embed#N`.

**EIGHT OF THE 42 NAMED STATES ARE RENAMED**, and that is the scoping working rather than a side
effect. A geometry shared by several names is keyed by the FIRST in `formations.xml` order; when that
name is out of scope the scoped dedupe keeps the first name that IS in scope — the level's own name for
the shape: `Ocean Waves RH BGGB`, `Two-Faced Lines RH`, `Diamonds RH Girl Points`, `Column RH GBGB`,
`Tidal Wave RH BGGB`, `Inverted Tidal Line RH`, `Facing Blocks Left`, `T-Bone URLU`.

**THE VOCABULARY GROWS WITH THE LEVEL AND NEVER SHRINKS** (level-census section 1), which is the
"later levels ADD" half of the rule, now a gate:

```
level      own-names  cum-names  cum-declared  cumulative-titles
b1                62         62            61                150
b2                51         78            77                206
ms                98         99            98                291
plus              95        132           131                466
a2                86        154           153                764
c1               144        195           194               1331
c3a               78        220           219               1925
c3b               56        220           219               2135
```

`formations.xml` declares 273 names; **219 are referenced by some level's tam and 54 by none**; the
engine keeps 134 as whole sets. `ms/` tams reference 98 names and **all 98 are declared** (the app's
pooled "ms" is 99 — the extra one, `T-Bone Couples`, is referenced at a level BELOW ms, not at ms).

**ONE RECORDED INCONSISTENCY, NOT FIXED HERE.** The shipped `fsm-ms.json` is built from `ms/*.xml`
alone (274 catalog entries), while the APP's own "Mainstream" is `sequencerCallsUpTo('ms')`, which pools
every level at or below ms and is **18 titles more**. So the FSM view has never shown the sequencer's
own Mainstream call set. `poc/scripts/build-fsm-asset.mjs` is left as it is deliberately — changing the
call set inside Stage 0b would put two changes in one measurement — and it is recorded here as its own
decision to take, with the number (18 titles, 273 → 291) already measured.

**THE SCOPE HAD A HOLE, AND THE FULL GATE COULD NOT SEE IT.** `library.registerFormation`'s own
documented purpose is that an unnameable board is a dead end *"the engine will not say what formation
the dancers are in, so the FSM has no state for it"* and that labelling one *"is how that dead end gets
closed"*. Scoping the state set to the formations the CALLS declare closed the `knownFormation` half of
that dead end and left the FSM half open — and `test/sequencer.mjs`'s existing `registerFormation`
section covered only `knownFormation`/`listFormations`, so **29 green harnesses did not notice**. The
probe that found it was written because the doc comment was read rather than trusted.
`referencedFormationNames()` now carries `userFormations` as well as the call-referenced names, the rule
being *a formation is in scope because a call declares it **or because a person declared it***, and
`sequencer.mjs` asserts both halves: the label is a state, AND the scope did not widen to the corpus
(125 corpus formations stay out of scope in that small library).

**WHAT DID NOT MOVE.** The FSM is not the solver (`HomeSolver` runs a live DFS over `searchLegalCalls`
and never reads the table), so a node-set change cannot move figures or get-outs — and the full gate
confirms it rather than assuming it. `map-tips.mjs` is NOT a gate and was already reporting 0
fully-mapped tips before this change: it registers `ms,b1,b2,a1,a2,plus,c1,c2` ASCENDING into one
library, so `register`'s last-wins overwrite hands most titles a lower level's authoring — the exact
hazard `poc/src/data.ts::sequencerCallsUpTo` documents. Recorded, not fixed.

**STAGE 2 DONE — THE EDGE SAYS WHAT HAPPENED, AND WHY IT HAS NO TARGET (schema 2).**
(`engine/src/sequencer/fsm-table.ts` — `FsmReading` + `FsmEndKind`; the enumeration is in
`buildFsmTable`; gates in `fsm-asset.mjs`, `reading-census.mjs`, `behaviour-audit.mjs`; the view in
`poc/src/fsm-view.ts`.)

**TWO FACTS PER EDGE, and before this both were computed and thrown away.** `reading` is how much of the
board the application actually moved — `whole` / `full-tiling` / `partial` — because `parallelApply` can
tile the board into copies of a sub-board variant and `partitionPartial` leaves the rest STANDING, so a
partial application was stored as though everyone did the call. `endKind` is where the edge lands and, when
there is no target, WHY. MEASURED on the ms table (65 states, 2260 edges):

```
reading   whole 1174   full-tiling 665   partial 421
endKind   state 1619   novel 624         out-of-scope 17
```

`endKind` is the axis Stage 0b CREATED and nothing could see. Before the level scope a null end meant one
thing; after it there are two, and they call for opposite responses: **`out-of-scope`** is a formation the
corpus NAMES but this table does not model as a state, so a LEVEL BUMP would make it a node (17 edges);
**`novel`** is a board no level names, which only a module edge can absorb (624). The invariant that makes
the field trustworthy is gated in two harnesses: `endKind === 'state'` EXACTLY when `endFormation` is set.

**THE FIELD WAS WRONG ON MOST OF ITS EDGES UNTIL THE RESOLUTION RULE WAS FIXED, and that is the finding.**
An end used to be resolved BY NAME only, so a node with no name could never be an edge's target. MEASURED
over the 42 named ms states: of the 924 edges the name lookup could not resolve, **496 were landing on a
state's own geometry** — 464 on an `@embed#N` state and 32 on a named state whose namer answer was refused.
`buildFsmTable` now falls back to a geometry scan at the tolerance `addState` itself dedupes with
(`matchFormations(dancers, g, 1.0)`), which is UNAMBIGUOUS BY CONSTRUCTION: `addState` folds candidates at
exactly that tolerance, so the surviving state geometries are pairwise further apart than it and a board can
match at most one. The name still wins wherever there is one — it is the readable answer — and the scan is
the fallback for the case the name path structurally cannot express. **Edges with a target: 612 → 1619
(27% → 72%).**

**A MEASUREMENT TRAP WORTH KEEPING, because it nearly produced a false defect report.** A probe that
re-applied each edge through `Sequence.applyToBoard` found 25 edges the table calls `novel` whose end
matched a state geometry at error 0.000, which reads as the scan being broken. It is not: `applyToBoard` is
CODED-FIRST (`tryCodedMove`, then the applicator) while `buildFsmTable` deliberately records the
APPLICATOR's result for any call `legalCalls` admits and the coded rule only for a name the catalogue does
not have. The two paths are different applications, and MEASURED they disagree about the end on **258 edges
over 87 calls** (74 of them the derived/coded selection names — `Boys Run`, `Girls Trade`, `Centers Run`).
So the probe was measuring one path and the table the other. That divergence is real and its own open item;
it is NOT a defect in the scan, and the distinction only became visible because the disagreement was chased
to the dispatch rather than assumed away.

**AND THE SAME DISPATCH SPLIT MAKES `reading-census`'S OWN CENSUS A DIFFERENT CENSUS.** Nine coded moves are
ALSO catalogue titles — `Swing Thru`, `Left Swing Thru`, `Fan the Top`, `Promenade`, `Run`, `Trade`, `Fold`,
`Swing Your Partner`, `Do Sa Do` — so that harness's reading totals (whole 1032 / full-tiling 504 /
partial 349) are the CODED-FIRST readings while the FSM's are the applicator's. Both are real, of different
applications. The cross-check therefore dispatches the way the table did and re-applies each edge: **1809
edges compared, 0 reading mismatches.** Its first version compared through `applyToBoard` and failed on 38
edges, every one "table says partial, sweep says whole" on `Stars RH`/`Stars LH` — the coded `Swing Thru`
reports no `parallel` structure where the catalogue authoring applies a 4-dancer variant to a quarter of the
board. The failure was the instrument, and it is recorded rather than pinned around.

**THE VIEW SAYS SO NOW RATHER THAN HIDING IT.** `poc/src/fsm-view.ts` dropped every null end when building
the graph, so it silently declined to draw 28% of its own table. It now counts them in the header
(`641 of 2260 edges leave the vocabulary (novel 624, out-of-scope 17)`) and lists them per formation in the
sidebar with their kind, which is where a reader is already looking. **The GRAPH still draws only edges with
a target** — a stub per transient is a layout change and remains separate work, recorded here as such.
`poc/tools/fsm-open-probe.mjs` gains the section that checks this on the emitted document, and it is the
only verification of the view available here (no browser).

**SCHEMA 2, and `load` accepts only the current version**, so a stored v1 asset is refused rather than read
with the new fields silently absent — the same rule as before, and the reason `fsm-ms.json` is regenerated
in the same change. The counts 65 / 2260 are UNCHANGED by it: the reading and the classification are facts
about the edges, not new edges. Build time 17 s → 21 s.

**STAGE 3 — RECONNAISSANCE FIRST, and two things came back that change what the stage is.**
Stage 3 is "modules as FSM edges where start and end are both cells — the absorption mechanism that keeps a
transient from ever becoming a node". Three measurements, before any code.

**(1) THE MECHANISM ALREADY EXISTS, and Stage 2 is what switched it on.** `LegalityChecker.legalWithResults`
already enumerates `library.moduleNames()` alongside the catalogue (`legality.ts`, second loop), so
`buildFsmTable` records a module as an edge and classifies its end like any call's. MEASURED: registering
one two-call module (`Swing Thru` then `Boys Run`) takes the ms table from 2260 to 2278 edges — **18 edges
named after the module, and the state count unchanged at 65.** So the "keeps a transient from ever becoming
a node" property is not something to build; it is already true BY CONSTRUCTION, because a module edge's end
is resolved by the same rule as a call's and can only target an existing state or be recorded as a
transient. And **most of those 18 edges land on `@embed#44`/`@embed#45`** — Stage 2's geometry fallback is
what gives them targets at all, so module edges were previously recorded as targetless and are now real
graph edges. Stage 2 was a prerequisite in a way its own plan did not say.

**(2) THE SHIPPED CEDER CORPUS IS NOT THE MODULE SOURCE (measured).** The app registers 294 of them
(126 `Static Square`, 97 `Zero Line`, 71 `Zero Box`). Applied the way the app applies them, each from ITS
OWN declared start board:

```
294 modules, all 294 have a start board the engine can stand up
 89 replay all the way from that board          (30.3%)
 66 of those end on an FSM state
 43 distinct state->state pairs, from the 42 named states
  0 end at Static Square
```

and asked the other way — do their paths cover the boards the graph cannot name? Over the 42 named states
and all 294 modules: 163 legal (state, module) applications, 120 landing on a state; against the 469
targetless call edges from those same states their paths cover **41 (8.7%)** and leave 428 outside every
module. **The corpus is CHOREOGRAPHY (ceder get-out sequences), not an encoding of calls** — which is what
the stage needs — and 70% of it does not replay on this catalogue at all. Adding all of it gains 43 edges
and closes under a tenth of the gap.

**(3) THE ARRANGEMENT BLOCKER, and it is structural rather than a data problem.** A module's start is a
formation AND AN ARRANGEMENT — `Zero Box` is All8's `[B1c]`, the same GEOMETRY as an `Eight Chain Thru`
with different couples — while the FSM's nodes are keyed by geometry alone, because `addState` dedupes with
`matchFormations(dancers, existing, 1.0)` and a match is identity-blind. MEASURED: the `B1c` board
`boardForFasrCode` builds and the `Eight Chain Thru` node's own board are **the same geometry at error
0.0000**, so the FSM cannot tell them apart and an arrangement-keyed module cannot be attached to a
geometry-keyed node faithfully. This is the SAME split Stage 0 measured from the other side (23 of the 129
named geometries carry more than one gender pattern, max 4), and it is now the concrete architectural
blocker rather than a footnote: **the cell vocabulary has the arrangement; the node set does not.**

**WHAT THE ABSORPTION HAS TO BE, and how deep.** Since the corpus cannot supply it, it has to be DERIVED
from the calls — `S --C--> X --D--> T`, `X` a board nothing names and `T` a state, the pair recorded as ONE
edge so `X` never becomes a node. That is the user's own framing ("if all calls are encoded as modules")
applied to the catalogue instead of to a separate corpus. MEASURED over the 315 distinct transient
geometries the ms FSM's targetless edges reach (469 edges, deduped by geometry):

```
with at least one legal call             228   (87 have NONE - genuinely dead positions)
closed by ONE MORE CALL (X --D--> state) 185   (58.7%)
still open after one more call           130
the calls that close the most: Face In 76, U-Turn Back 21, Boys Run 17, Box the Gnat 8
```

So **a composition depth of two closes 58.7% of the transients**, and the closers are the same
pivot/fold class `cell-census` already identified as the novel-geometry minters. The remaining 130 are
where a depth-3 search or a genuine vocabulary gap would live.

**SO STAGE 3'S REMAINING WORK IS NOT "ADD MODULE EDGES".** It is: (a) a module source that encodes CALLS
rather than choreography; (b) ~~the ARRANGEMENT dimension on the node set~~ — **REFUTED, see below**;
(c) the "call wins" registration rule when a module and a call reach the same state; and (d) the
demonstration that the node count stays flat under (a) — which this reconnaissance has already shown holds by
construction.

**THE ARRANGEMENT DIMENSION WAS THE NEXT STEP AND IT IS REFUTED (measured).** The plan was to re-key the FSM's
nodes from GEOMETRY to CELL (geometry × gender pattern), because a ceder module's start is a formation **and an
arrangement** (`Zero Box` is All8's `[B1c]`) and a geometry-keyed node cannot represent where the module begins.
The motivating pair says otherwise, and `cell-census` section 5 now pins all of it:

```
[B1c] vs the Eight Chain Thru node: same geometry true, same pattern true, geometry error 0.0000
  [B1c] cell key   26|BgBgBgBg|1|c
  node  cell key   26|BgBgBgBg|?|?
  couples: [B1c] 3,4,2,1,3,2,4,1  vs  node 0,0,0,0,0,0,0,0
```

**THE TWO BOARDS SHARE THEIR GEOMETRY *AND* THEIR GENDER PATTERN.** The only difference is the couple
numbering: All8's board carries one, and the FSM's state board carries **none** — `boardFromMatchables` stamps
home identity only when the geometry is home-like, which at ms is exactly one state in 65. So the keys differ in
`sequence` and `relationship`, both of which are unreadable *because* identity is missing. Re-keying the states
as they stand would mint nodes distinguished only by "identity unknown" versus "identity known" — noise, not
structure — and would not let a single arrangement-specific module attach. **The blocker is CANONICAL IDENTITY
on the state boards, which is a different and harder piece:** a geometry admits four relabellings and only six
All8 letter families have an authority-picked canonical board (`CANONICAL_INDEX`, measured against the 26
published diagrams), while `relationship` needs an agreed reference pair that Callerlab records for
`[L] [B] [F] [W]` only. That is the same limit this census already reports — **22 of 396 cells are fully
readable** — so the arrangement dimension cannot be the thing that lets modules attach, and building it would
have been work in the wrong direction.

**AND IT WOULD HAVE COST.** Even taken on its own terms, cell-keying is not free: the scoped vocabulary declares
**70 geometries and 105 cells (1.50×)**, and of the **1340** edges that HAVE a target only **548** end on a
gender pattern some declared shape realises — **219 (16.3%)** end on one nothing declares, and under a cell key
those become transients. So the change buys a node count 1.5× larger and loses a sixth of its edges, to
distinguish boards that are not distinguishable by arrangement in the first place.

**THE FSM VIEW WAS CHECKED IN A REAL BROWSER FOR THE FIRST TIME, AND IT HAD TWO DEFECTS.** Both are
consequences of Stage 2's edge changes and **neither was visible to any existing check** — `fsm-open-probe.mjs`
only ever regexed the emitted STRING, and both defects are invisible in the string: the fit is fine per-axis,
and a blob is perfectly valid geometry. Recorded here because the lesson is the instrument, not the fixes.

**1. THE FIT CLIPPED THE GRAPH.** `S = 1800 / (maxX - minX)` was applied to BOTH axes, so it fits only while
the layout is wider than it is tall — and a force layout's aspect follows the EDGE COUNT. MEASURED:

```
asset before Stage 2   164 node pairs drawn   x 100..1900   y 100..1814    fits
asset after  Stage 2   516 node pairs drawn   x 100..1900   y 100..2650    650 units OUTSIDE
```

against `viewBox="0 0 2000 2000"`, which the SVG silently CLIPS. The fit now uses the larger extent and
centres the other axis. The bug predates Stage 2; Stage 2 EXERCISED it, which is the only reason it was found.

**2. TWO LAYOUTS DISAGREED, AND THE READER SAW THE WRONG ONE.** The document contains BOTH a PRERENDER (400
FR iterations baked into each node's transform) and a LIVE SIMULATION, and only the simulation has a
centripetal pull toward (1000,1000). Without it one node ejects to a large radius and the bounding-box fit —
which normalises by those extremes — SHRINKS everything else. MEASURED on the ms asset:

```
prerender   median nearest-neighbour  3.6   overlapping 64 of 65   mass in  7% of the frame
settled     median nearest-neighbour 57.3   overlapping  5 of 65   mass in 62% of the frame
```

with a node radius of 13–20 units, so 3.6 is a blob and 57.3 clears the label box. The simulation only started
from a node's `pointerdown`, so **the blob was what a reader saw UNTIL they happened to touch a node** — and
then it reflowed, which reads as the view being broken until touched. REPORTED FROM THE APP and reproduced
headless. Fixed by AUTO-SELECTING HOME AND STARTING THE SIMULATION ON LOAD, which also opens the sidebar on the
squared set (94 calls) instead of "Click a node to see its calls." **`select` alone does NOT reflow** — it only
paints and fills the sidebar — so the fix must kick the simulation, and the gate asserts both.

**THE FIRST VERSION OF THAT FIX LOOKED RIGHT AND DID NOTHING**, and it is the most transferable thing in this
entry. It called `idx.get(HOME)`: those are `renderFsmHtml`'s OWN variables and do not exist in the emitted
page, so the page threw a **silent ReferenceError**, kept rendering, and stayed a blob. No string-level check
could see it, because the text contained everything the fix was supposed to ADD. It was caught by measuring the
document's own geometry **from inside the browser** — via `document.title`, because `browser_evaluate` is
disabled in this environment, so the document has to report on itself. The gate now asserts the ABSENCE that
would have caught it: **the page must never call `idx.get(...)`**. A blunt "no `idx` or `HOME` anywhere" check
was tried first and is itself WRONG — the document legitimately declares `jumpSpan=(text,idx)` and says "HOME"
in three prose comments — and that is recorded so it is not re-proposed.

**TWO TOOLS, so this is repeatable rather than a one-off:** `poc/tools/emit-fsm-view.mjs` writes the document
the app frames (`--probe` appends a diagnostics script), and `poc/tools/serve-view.mjs` gives it a loopback
origin, because this environment's browser tool refuses `file://`. The generated documents are gitignored.

**STILL OPEN, and deliberately not touched:** the two layouts duplicate each other, and merging them means
deciding which force parameters are correct — a design change rather than a fix. The `fsm-view` module is also
352 lines of one template literal, which is why a stray backtick in a comment has now produced a syntax error
three times in this file; that is its own small item.

**THE POC'S OWN PROBE SUITE IS NOW IN ITS GATE, WHICH IS WHAT ITS OWN RUNNER WAS WRITTEN FOR.** Recorded here
because it is the same failure this repo keeps finding, one level up: `poc/tools/verify-probes.mjs` exists, is
well designed, and DISCOVERS every `*-probe.mjs` by name so a new probe cannot forget to register itself — and
its own header says *"Twenty-odd probes … and NOTHING RAN ANY OF THEM … A probe nobody runs is a probe that is
already stale; it just has not been noticed yet."* But `poc/package.json` wired only `verify.cjs`, and the root
`verify` runs that, so the suite was reachable only by a person who already knew to ask for it. MEASURED before
touching anything: **27 probes, all green, 582 s** — so the mechanism worked and nothing was broken, which is
exactly why it went unnoticed.

**ONE PROBE COST MORE THAN THE OTHER TWENTY-SIX TOGETHER, and that is what the split is for.**
`call-formations-probe.mjs` is **461 s of the 582**. It is not doing anything wrong: `walkCall` compares every
sampled board against ALL 134 catalogue formations by their 28 pairwise distances (~3750 comparisons a sample),
it samples every call in the corpus at 0.5 beats, and then samples the held population AND a 40-file control
again at 0.0625 beats. A naive nearest-neighbour scan over a large sample, left as it is.

So the tier split is the ENGINE suite's own convention rather than a new idea: `verify-probes.mjs` gains a
`SLOW` map with a reason per entry and an `--all` flag, `verify` runs the fast tier, and **the banner names what
was skipped and why** — a green "26 of 27" that silently omitted the most expensive probe would be the same
class of silence as a generated asset with no gate. `poc/package.json`:

```
verify              node verify.cjs && node tools/verify-probes.mjs      (fast tier)
verify:probes:all   node tools/verify-probes.mjs --all                   (everything)
```

MEASURED after: **26 probes, 139 s for the whole POC gate** (it was ~18 s for `verify.cjs` alone), with
`fsm-open-probe.mjs` at 511 ms — so the Stage 2 view gates above, and 4d/4e, now actually run in a gate rather
than only when someone remembers. The trade is a ~2-minute pre-commit step against 26 forgotten probes, and
the slow one is still one flag away.

**A SWEEP THE SUITE CANNOT JUDGE, recorded rather than fixed:** **16 of the 27 probes never call
`process.exit`**, so the runner judges them on their own `FAIL` lines and says so. That is a weaker signal than
an exit code — a probe that stops early, or one whose `check` helper prints something a regex does not
recognise, passes. The runner prints the list every run, which is the honest place to leave it until the
signal matters.

### Phase H — the solver side (the Phase 3 leftover)

**Owner:** the search's remaining C term. `library.allVariantSetups()` is still the flat list that
**drops the call name**; making it `{ name, setup }[]` is the minimal change, then pre-filter the
per-name loop with a mirror-aware signature map. **Do not build it as an FSM table** — that is
O(states × catalogue), which is what killed the 20-minute build.

**ITS MOTIVATION IS GONE, AND THE GATE ABOVE IT WAS STALE (round 33).** This section used to read:
*"`[P4p]`'s failing getout (`maxCalls=3, budget=400`) now answers `null` in **11.5 s** … those 17
catalogue scans ARE the 11.5 s"*, with the gate *"`[P4p]` keeps its `null` answer and stays bounded;
`GETOUT_SWEEP=1` still reports 27 of 28 alignments"*. Both halves are now false, and `getout-convention`
with the sweep ON was **RED at HEAD** because of it:

```
FAIL  [P4p] now HAS a getout ([Promenade]) - re-measure the documented negative
  28 of 28 alignments have a getout within 3 calls
```

`[P4p]` (a Double Pass Thru) now has a **one-call** getout, `Promenade`, and it is GENUINE rather than a
search false positive: `acceptPath` plays it with the real applicator and confirms it ends home — the
same check the sweep already applies to all 28 alignments. So `27 of 28` is `28 of 28`, and there is no
failed search left to time.

THREE CONSEQUENCES:

- **the index is no longer urgent.** It was worth building to make a FAILED search affordable; there are
  no failed searches. The remaining scans are real but no longer bound anything, so this is now an
  optimisation with no witness.
- **`getout-convention`'s sweep is ON BY DEFAULT**, and that is a measured reversal: 58.0 s with it,
  58.8 s without, because what made it slow was the failed search. Leaving it opt-in would have kept OFF
  the check that caught this — which is how the staleness survived. `GETOUT_SWEEP=0` opts out.
- **the 40 s FAILED-search bound has LOST ITS WITNESS**, and that is recorded rather than silently
  dropped. A future negative would have to be re-established before it can be asserted again.

**An attempt at the index was made and REVERTED, with a hazard worth recording.** The first cut memoised
`matchables(board)` and the board's half of the `matchMemo` key in `WeakMap`s keyed on the BOARD OBJECT
(the search passes one immutable board to ~2211 titles per node, so the pose string was being rebuilt
2211 times). That is the right shape, but keying on object identity is a STRICTER assumption than the
existing string-keyed cache: if any board were mutated in place, a string key would reflect the change
and an identity key would not. `matchMemo`'s own comment claims boards are "always cloned before
mutation", and the reverted cut did not verify that for every producer. Measure that first, or key the
memo on the pose string and cache only the per-board STRING.

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

**SWEPT (round 35) — AND THE QUESTION IS 17 TITLES, NOT 231.** `engine/test/tools/from-overlap.mjs`
answers it, and answering it needed the key to be corrected twice:

```
2211 titles, 232 defined at more than one LEVEL
  212 of those author the same `formation` twice
   40 of those write a DIFFERENT MOTION on a shared `formation`
   17 of those END DIFFERENTLY on a shared `formation`   <- the tie-break decides these
```

The 17, and note how many of them the census touches — `Wheel and Deal`, `Box Circulate`, `Rollaway`,
`Courtesy Turn`:

`Box Circulate`, `Boys Trade`, `California Twirl`, `Centers Cross Run`, `Centers Trade`, `Circle Left`,
`Circle Right`, `Courtesy Turn`, `Ends Trade`, `Face In`, `Face Left`, `Face Right`, `Girls Trade`,
`Ladies In, Men Sashay`, `Partner Trade`, `Rollaway`, `Wheel and Deal`.

**TWO CORRECTIONS TO THE KEY WERE NEEDED, and both were made by measuring rather than reasoning:**

1. **The key is `formation`, NOT `from`.** `from` is a coarse label: `Square Thru 3` is authored at `b1`
   from `formation="Facing Couples"` and at `ms` from `formation="Facing Couples Compact"` — two setups
   at different SEPARATIONS, which the engine pools deliberately and which can never both match one
   board. Keying on `from` counted those as conflicts and gave **65** false ones; keying on `formation`
   gives 40, and only 17 where the ENDING actually differs.
2. **A tam with no `formation` must be excluded.** Those author their dancers INLINE, so the empty
   string is not a setup name and grouping on it conflates unrelated tams — `Star Thru` and
   `Allemande Left` each appeared as a single row with a dozen distinct endings for exactly that reason.
   131 such tams are excluded and counted in the tool's output.

`CallBundle` does not carry `formation`, which is WHY the first key was wrong — the attribute is in the
XML but not in the engine's view, so the tool reads it from the blocks and gets each tam's end pose from
a ONE-TAM `Sequencer`. The end pose is compared as SHAPE + FACINGS so a rotated authoring of the same
dance is not a conflict.

**The sanity check is that `Circle Left` / `formation="Static Square"` / `b1, ms` is in the list** — the
one case the plan already measured (88 vs 90 figures). So 16 are unswept, and the next round has a
17-row list to judge instead of a 231-row question.

**AND THEY ARE NOW ALL JUDGED: THE TIE-BREAK COSTS NOTHING (round 36).** Two screens, both in the same
tool, and the phase closes negative.

FIRST, a tie-break can only matter where the call is USED, so the 17 were cross-referenced against the
published corpus. **8 of the 17 are used by at least one BLOCKED figure** — the rest cannot be losing a
figure because nothing reaches them:

```
Wheel and Deal       22 figures, 10 BLOCKED     Rollaway        17 figures,  4 BLOCKED
Partner Trade        12 figures,  4 BLOCKED     Face In          5 figures,  4 BLOCKED
Circle Left           5 figures,  1 BLOCKED     California Twirl 1 figure,   1 BLOCKED
Courtesy Turn         1 figure,   1 BLOCKED     Face Right       1 figure,   1 BLOCKED
```

SECOND, each of those 8 was A/B tested on its own (`--flip <Title>`, which rebuilds the catalogue with
THAT title's tam blocks reversed and re-runs the whole corpus; the pool is highest-first, so reversing
hands every equal-error tie in that title to the lowest level):

```
Circle Left        116 -> 114   LOST 2: figm197(Heads Square Thru 4) figm204(Rollaway)
Wheel and Deal     116 -> 116   no figure changed at all
California Twirl   116 -> 116   no change
Courtesy Turn      116 -> 116   no change
Face Right         116 -> 116   no change
Face In            116 -> 116   no change
Rollaway           116 -> 116   no change
Partner Trade      116 -> 116   no change
```

**So exactly ONE of the seventeen is material, and the engine already has it RIGHT**: reversing
`Circle Left` LOSES the two figures the plan's own 88-vs-90 measurement names, which is that measurement
reproduced at today's 116 baseline. The other seven are immaterial — the two authorings never both match
the same board anywhere in the corpus, so the tie never decides an outcome.

**CONCLUSION: the level-ordered tie-break is not costing any figure.** The remaining Phase J item is the
other half of the bullet — `Circle Left 1/8`, whose residual is 0.448 and whose `display="no"` the
matcher does not read — and that is a different (setup-precision) question from this one.

### Phase K — the target suite (the finish line, not a gate)

`npm run verify:figures` is red **by design** and should stay that way until the work is done.
**RE-MEASURED round 34, and two of the three numbers were stale:**

```
BEFORE (this section):   4 unread cells, 22 call names the engine lacks, 101 of 188 figures
NOW (measured):          4 unread cells, 13 call names the engine lacks, 116 of 188 figures
```

- **`101 of 188` is now 116 of 188.** Confirmed independently: `all8-figures.mjs` prints *"116 of 188
  figures run end-to-end"* and `figure-census.mjs` prints the same, so the target suite and the census
  agree. The stale number had survived the whole session's +15 figures.
- **`22 call names` is now 13.** That is a count of distinct NAMES the corpus uses and the engine lacks,
  which is a different measure from `unknown-calls.mjs`'s SIX — that tool counts the figures that
  actually STOP on an unknown name, and a name used by a figure which already stops earlier for another
  reason never gets there. Both numbers are right; they answer different questions, and the plan should
  say so rather than carry one and imply the other.
- **`4 unread cells` is still 4** ✓ (Phase I, closed by design as malformed source).

The suite's own failing gates are exactly two, and they are the first two numbers: *"4 call cells across
4 distinct tokens are not readable"* and *"13 of them are calls the engine does not have"*. The third
(the run count) is REPORTED rather than gated, which is why it could drift to 101 unremarked.

It is the finish line the user set ("once the engine has fixed existing edge cases"),
excluded from both verify tiers on purpose. Two small stale readings it still carries: `verycenters`
is preserved as its own 2-dancer case (deliberately, so the `Centers` fix could not change any
`Very Centers …` asset) and `outside6` follows it; and `Centers In` / `Heads Pass Thru` still refuse
from `Normal Lines` — a different cause (no matching variant; `couple=0` on an identity-less board).

### The walk-through defect (POC): five mechanisms, four now closed, all measured

The POC sequencer animates a call by interpolating from the board before it to the board after it.
`engine/test/tools/walkthrough-survey.mjs` puts a number on what that gets wrong. It enumerates every
named 8-dancer formation × every call the corpora use (**134 distinct boards**), samples 60 beats
through each applying pair, and flags any whose **closest two dancers** fall into each other. It also
records the END board's own closest pair, because a pair whose end board is already broken is an
APPLY fault that no animation can repair — a distinction the first draft of the survey missed.

A raw count is not a work list: of the faults it keeps, **214 are (formation, call) pairs no corpus
ever stands in**. The survey therefore marks every fault with whether real choreography uses the
combination, and only then ranks. That filter is what made the target obvious — `Swing Thru` from
`Ocean Waves` is Mainstream bread and butter, and it was measured at **0.00 units**.

| metric | before | after |
|---|---|---|
| COINCIDENT pairs (< 0.1 units) | 72 | **32** |
| … ANIMATION fault (end board healthy) | 42 | **10** |
| … APPLY fault (end board already broken) | 30 | **22** |
| `Swing Thru` animation faults | 12 | **2** |
| `Right and Left Thru` animation faults | 8 | **0** |

**Mechanism 1 — multi-cycle coded moves, CLOSED for `Swing Thru`.** The call is two EXCHANGES, and a
dancer's path depends on which one it is doing, so a single straight line cannot express it; on an
ocean wave it drove four dancers through the middle at once. `swingThruLegs` now returns the board
after each part, `CodedMove.legs` hands the animator those boards, and `evaluateCodedAt` interpolates
within the leg the beat falls in (commit `3a9b1b1`). `Ocean Waves` went **0.000 → 2.000** and
`Eight Chain Thru` **0.894 → 1.414**.

**Mechanism 2 — coded calls that applied but could not be animated, CLOSED.** A coded move whose
derived rule refuses a board still applies when it carries `catalogueFallback`, because
`tryCodedMove` returns null and the applicator reads the authored variant. `replayWalk` had no such
fallback: it recorded the step unwalkable and BROKE, so the call was legal, moved the dancers, and
animated **nothing** — the last frame sat on the start board. Found as a 2.5-unit convergence gap for
`Swing Thru` from `Normal Lines`, then sized by `engine/test/tools/coded-refusal-probe.mjs`: **84
(move, board) pairs**, 0 of which animated. `replayWalk` now falls through to the catalogue step,
which is what the applicator does; **57 of 84** animate, and the animation is faithful to the board
the sequencer stores. The residual **27** are all exotic boards (Diamonds, Hourglass, Stars,
Misshapen I-Beam, Tidal Wave of 6, 3/4 Tag) where the CATALOGUE also has no variant at walk
tolerance, so `applyToBoard` calling those LEGAL is the questionable half — a different defect, and
no standard Mainstream formation is among them (commit `d33a851`).

**The two metrics in the table moved UP for this fix, and that is the honest direction.** Those
calls previously animated nothing, so nothing could collide; now they play, and some of them do
collide. The collision was always latent — the end board was already being produced — it was simply
invisible. A call the walk-through silently refuses to play is a worse defect than one it plays
badly, because only the second is diagnosable.

**Mechanism 3 — the parallel path's grouping, CLOSED, and it was the largest owner.** The animator
and the applicator each answered "which groups is this call tiled into?" with their own code, and the
two predicates are not the same: `matchingVariantInfo` requires a FULL tiling, while `parallelApply`
also accepts `partitionPartial`. `engine/test/tools/parallel-group-probe.mjs` measures the divergence
at **2 of the 13** survey pairs — both `Right and Left Thru`, and both the worst cases. There the
applicator had applied the call to ONE group of four and left the other four dancers standing, while
the animator animated TWO groups of four: the four dancers the call never moves were spun up to 86°
and dragged 1.2 units out and back, and the four that moved were swept through the centre.
`ApplyResult.parallel` now carries the variant and grouping the applicator actually used, and the
animator follows it — **the second implementation is removed rather than kept in step**. That one
change took `Right and Left Thru` from 8 animation faults to **0**, `Box the Gnat` 6 → 0, and
`Square Thru 3`, `Zoom`, `Scoot Back`, `Turn Thru`, `Veer Left`, `Veer Right` all to 0.

**Mechanism 4 — the apply side, not an animation fault at all.** **22** pairs whose end board already
has coincident dancers. No interpolation can fix these; they need the call's own body fixed, which is
census-side work (Phases A/B), not walk-through work. They are counted separately for exactly that
reason, and **every remaining entry on the survey's "worst first" list with a closest pair of 0.00 now
has a broken END board** — the animation is no longer the thing putting dancers on top of each other.

**Mechanism 5 — the walk's own predicate, CLOSED, and it was the largest of all.** The (D)/(E)
disagreements recorded below were one bug, and it turned out to be worth finding: for a call with no
whole-board match, `matchingVariantInfo` asked `partitionExists` — **FULL tilings only, at SEARCH** —
while `applyToBoardInner` hands `parallelApply` **`partition ?? partitionPartial`, at DEFAULT**. There
are boards where NO variant tiles fully while one tiles partially, and on those the walk charged the
call **0 beats** and then `evaluateSequence` aborted the whole animation and returned the board BEFORE
that call. Aligning the predicate to `parallelApply`'s:

```
(C) silent no-ops        27 -> 0        (E) applied but not played   400 -> 6
(D) phantoms           2466 -> 11        calls the walk plays       1497 -> 1920
```

It also fixed a REPORTED POC BUG end-to-end: `ceder-7046`'s fourth call, `Swing Thru`, is applied by
the applicator through variant #10's `partitionPartial(DEFAULT)` on the `Double Pass Thru` the module
reaches, and had been charged 0 beats — so the walk-through aborted there and snapped the board back to
`Double Pass Thru`. `sequenceBeats` for that module went **24.5 → 33.5** and the animation now ends on
the board the stored walk reaches. See `engine/test/tools/7046-swing-thru-probe.mjs`.

**The census does NOT move for any of this**, which was the reason to fix it rather than pin it:
`applyToBoard` decides the boards, `sequenceBeats` only decides the frames. Re-measured after the
change — figures **116 of 188**, get-out **124 of 265** (112 finishing), FSM **155 / 92 / 43 / 19** —
all identical. The three remaining pinned populations are now accounts of one thing only:
`parallelApply` ALSO requires every sub-apply to succeed, which `matchingVariantInfo` cannot cheaply
check, and the 11 + 6 survivors are that gap on Galaxy/Diamond/Star/Star-Promenade boards.

**A REPORTED POC BUG THAT WAS NOT A BODY BUG: modules replayed from the wrong start formation.**
`ceder-7046` is `startFormation: "Zero Line"` and the sequence view replayed it from home, so its
fourth call (`Swing Thru`) landed on a `T-Bone RDRD` from which `Right and Left Grand` refused — which
reads as "the calls are broken" when the BOARD is what is wrong. **The engine had the formation all
along: `Zero Line` is All8's `L0`, and the engine's `Normal Lines` IS `L0`.** Two independent
agreements — `arrangementFor(boardForFormation('Normal Lines'), 'L')` returns 0, and the engine's
transcribed `[L]` table at column 0 is `gBgB`/`BgBg`, character for character what All8 prints. The app
was matching the corpus's LABEL against engine names and never resolving it.

Fixed in the POC: `START_FORMATION` maps the labels (`Zero Line` → `Normal Lines`, `Zero Box` →
`Eight Chain Thru` — `[B]`, whose own table comment in `alignment.ts` is *"Box / 8-Chain Thru"*), the
sequence view now replays from the resolved formation, and **a label that does not resolve is a
FAILURE that loads nothing and says so** rather than being silently replaced by home. Measured: the
five steps now run **5 of 5** from `Normal Lines` at **35.0 beats**, reaching `Normal Lines` →
`Eight Chain Thru` → **`Ocean Waves`** on the way, where from home they stopped at `Swing Thru`.

**AND THAT EXPOSED A NEW ONE. From its own start, `ceder-7046`'s last call ends on a board the engine
cannot name.** `Right and Left Grand` from `Ocean Waves` puts all eight dancers on a ring of radius
~3.46 at 45° increments, and `knownFormation` returns **null** — while the module declares
`endFormation: "Static Square"`. Either the grand's final rotation is off by 45°, or recognition only
has an axis-aligned circle template. Not investigated; recorded.

**AND A SECOND REPORTED POC DEFECT ON THE SAME MODULE, FIXED — "the last frame renders the start
formation of the currently selected call".** The sequence view played the module and then, on the final
frame, showed the board the LAST call started from instead of the board it ends on. It is TWO defects
stacked, and both are now closed:

1. **THE EVALUATOR'S CONTRACT HAS NO WAY TO SAY "IT STOPS HERE".** `evaluateSequence` returns
   `step.before` for a step the walk cannot walk, and `sequenceBeats` charges a CATALOGUE step 0 beats
   and moves on (only a coded refusal `break`s). So a sequence whose LAST call cannot be played reports
   a total that EXCLUDES that call and an end board that is the board before it — silently. Measured on
   `ceder-7046`: replayed from HOME, `Right and Left Grand` is refused on the `T-Bone ULLD` its chain
   reaches, so it plays **33.5 beats** and ends on that T-Bone; replayed from the module's own
   `Zero Line` start (`boardForFasrCode('L1o')`, which is what the app does) the same call applies, it
   plays **35 beats**, and it ends on the ring the call produces (`sequence-stop-probe.mjs`). The
   missing 1.5 beats are exactly
   that call. **`Sequencer.sequenceStop(flat, start)` is the missing half**: it names the first step
   that cannot be walked, why (the applicator's own reason), and the board the animation therefore ends
   on. Gated in `sequencer.mjs` on a primitive witness (`["Circle Left", "Swing Thru"]` from home stops
   at index 1) and on the property that the reported board is the one `evaluateSequence` returns.
2. **THE UI DREW THE LAST FRAME FROM THE WRONG BOARD.** `SequencerUI.renderPlayhead` drew the evaluated
   board and then, because `evaluateSequence` signals "this is the final board" with `beats > 0`,
   called `render()` — which draws `this.seq.board`, the LIVE board, the result of a SEPARATE
   `applyStep` replay. The live board therefore won the last frame. Where the two replays agree it is
   invisible (measured identical for `ceder-7046` from `L1o`), but where they part the user sees the
   live one. It now MOVES the live board to the evaluated one and refreshes the readout instead of
   drawing over the animation, so the drawn frame is always the evaluator's. The panel also names the
   stop (`stops at "<call>" - <reason>` in the load status and `ends before "<call>"` beside the beat
   counter) rather than leaving a sequence that stops early looking complete.

**Not verified in this environment, and recorded as such:** the POC's UI cannot be exercised here (the
Vite/esbuild spawn is blocked), so the UI half is typechecked (`tsc -p poc --noEmit`, whose only error
is the pre-existing `editor-ui.ts` TS2739) and reviewed, not measured. `node poc/verify.cjs` still fails
exactly its three pre-existing `Pass Thru` checks. The ENGINE half is measured and gated. The module's
end state being an unnameable ring is the item above, and is untouched by this.

**AND A THIRD POC REPORT, SAME AREA: "when a module is loaded the next-call list isn't updated with the
calls available from the end formation".** The frame is drawn from `evaluateSequence`, but `legalNext()`,
the readout and the formation select all answer from the SEQUENCER'S OWN board — and the two only met at
the very END of a sequence (`renderPlayhead`). Everything in between therefore left the next-call list
answering from whatever board the last EDIT produced: `openSequence` parks the playhead on the clicked
call, playing to the end moves the FRAME but not the live board, and the list stayed on the parked
board. `settlePlayhead()` now makes the board under a stationary playhead live — on playback stop, on
pause, on scrub RELEASE, and after a load — and one `seekTo` copy of the same work is removed.

**The cost is why it is not in the frame loop, and it is measured: `legalNext()` takes 686-692 ms warm
(1.6 s cold) because it enumerates the whole catalogue and applies every call to the board.** So the
refresh is skipped when the settled board is the one the list was already built from (`boardKey`, on
positions AND facings — a position-only signature is the `boardSig` trap), which keeps a pause or a
scrub released where it started free. Note this cost is pre-existing: every edit, seek and undo already
pays it, and it is the same `legalCalls` term Phase H is about.

**AND A FOURTH POC REPORT, THE MOST PRECISE OF THEM, FIXED — "if I apply a Promenade to the end, the
Dancers switch position in the final static square ... they flip to setup arrangement for Static Square
on the last frame".** The reported module (`ceder-7046`) had already been cleared on every headless
mechanism I could test — the `dancers` array order, the `couple` field per id, the live-vs-walk end
board, the final instant `total − 1e-6`, and per-frame motion (worst single-frame move over its 35
beats: **0.060 units at beat 11.93**, twice the 0.0305 median). The missing variable was the APPENDED
call, and with it the report reproduces exactly.

- **THE CAUSE IS THE DANCER ARRAY ORDER, and it is one line of data.** `evaluateSequence` returns an
  INTERPOLATED board at a mid-call beat — which carries the order the sequence walked in (from the
  `L1o` start, `1,3,7,5,6,8,4,2`) — but at the total it returns `step.after`, the board the call STORES.
  `promenadeHome` stored a fresh `makeSquaredSet()`, whose order is `1..8`. The POC's `renderBoard`
  builds its pose list in `board.dancers` order and hands pose `i` to dancer view `i`, so on that ONE
  frame all eight views jump to a neighbour's body: **per-id poses identical, the set scrambled on
  screen** (measured). `makeSquaredSet()` is literally the SETUP ARRANGEMENT, which is why the report
  named it. `applyToBoard` re-bases with `board.dancers.map(...)` (`sequencer.ts:186-191`), so every
  other path already carried the incoming order through — promenade was the only component that did not.
- **THE FIX**: `reorderLike(order, rebuilt)` in `board.ts` — it takes only the ORDER, leaving every
  position, heading, couple and gender the coded move's — applied in `promenadeHome` (and inherited by
  `promenadeFraction`, which maps over `home.board.dancers`). `promenadeHome` still lands every dancer
  on its own home spot; `Promenade 1/2` still ends on the rotated square it is defined to end on, and
  that genuinely non-standard arrangement now STAYS as danced, which is the stated principle: what was
  deduced from dancing the sequence wins over a re-derived reading of it.
- **MEASURED ACROSS THE CORPUS** (`sequence-order-flip-scan.mjs`, 1652 modules, every step boundary as
  well as the final frame): last-frame re-orders **0 → 0** — the corpus never exercises the reported
  case, because no module ENDS on a promenade finish, which is exactly why it took a user-appended call
  to surface it — while **live-vs-walk order disagreements 16 → 0**. The geometry is untouched: the
  last-frame jump scan (`sequence-last-frame-jump-scan.mjs`, 86 modules / worst 6.32 units) is
  unchanged by this fix, because that residual is per-ID motion and this defect was not.
- **GATED** in `promenade.mjs`: (1) `promenadeHome` on a home square whose dancers are merely LISTED in
  another order keeps that order and still lands everyone exactly home; (2) `ceder-7046` + `Promenade`
  from `L1o` — the last frame keeps the order the sequence danced in, moves nobody (worst 1e-6), and
  the live replay agrees with the walk.
- **NOT verified here**: the POC UI itself, again (the Vite/esbuild spawn is blocked), so the renderer
  half is reasoned from `renderBoard`'s positional binding and measured through the engine board it is
  handed. `poc/verify.cjs` still fails exactly its three pre-existing `Pass Thru` checks.

**THE LAST-FRAME CONVERGENCE RESIDUAL — DIAGNOSED TO THE SNAP, FIX DESIGNED, NOT APPLIED (the fix
was implemented, measured, and REVERTED, because it buys convergence with collisions).** The residual
is the second way a final frame lies: 86 of 1652 modules move a dancer more than 0.05 units on the last
frame, worst **6.32 units**, and `anim-convergence` pinned 7 of the single-call cases at 0.02–0.1476
(`sequence-last-frame-jump-scan.mjs`).

- **WHO OWNS IT**: 85 of the 86 are CATALOGUE calls, not coded ones — `Right and Left Grand` 23,
  `Allemande Left` + `ALLEMANDE_LEFT` 22, then `Star Thru`, `Bend the Line`, `Pass Thru`,
  `Partner Trade`, `Boys Run`, `Right and Left Thru`, `1/2 Square Thru`, `Extend` at 6.32
  (`sequence-convergence-owner-probe.mjs`). Only 1 is coded, so `evaluateCodedAt` is not the owner —
  which was worth measuring, because the by-call list looks like coded moves until it is classified.
- **THE ERROR FIELD NAMES THE CAUSE** (`sequence-authored-end-probe.mjs`): 80 of the 86 are a
  PER-DANCER field in which some dancers have delta **exactly 0.00** and others are displaced by
  **lattice-valued** vectors (2.00 / 4.00 / 6.00 / 6.32) in partner pairs. That is a SNAP signature,
  not a smooth transform — a rotation or translation would move every dancer.
- **THE SNAP IS NOT THE OWNER — MEASURED, AND THE FIRST ATTRIBUTION HERE WAS WRONG.** Lattice-valued
  deltas plus `snapBoard`'s MEAN-error bound (`matcher.ts:401`, `snapMaxError = 1.0`) made the snap the
  obvious cause, and it is a latent defect of its own kind (a mean bound does not bound a dancer). But
  it is not THIS one: `snap-source-probe.mjs` disables the snap outright (`setSnapMaxError(0)`) and
  re-measures the whole corpus — of the 86, **3 are the snap** (shifts of 0.07–0.13, `Men Run` ×2 and
  one `Right and Left Grand`) and **83 survive**. A BOUNDED SNAP was implemented and measured
  (`snapMaxShift = 0.25`, refusing a snap that moves any single dancer further than the drift the clamp
  exists to absorb, in `config.ts` + `matcher.ts`): it fixes exactly those 3 and nothing else, so it was
  **reverted** rather than shipped as a behavioural change to the interactive board for a 3-module
  gain. `snapBoard` still deserves a per-dancer bound one day; it does not belong to this defect.
- **THE CAUSE IS A DROPPED DANCER SELECTION, and the animation has been playing the WRONG CALL.** The
  count that would not add up — 77 offenders with no whole-board match and no stored parallel — was a
  question aimed at the wrong step, and MEASURING THE STEP rather than assuming it is what found this:
  - `last-frame-before-probe.mjs`: on **81 of the 86** the module's LAST flat step is charged **0
    beats**, i.e. the final call never plays at all (`sequenceBeats` skips a catalogue step with no
    matching variant). `evaluateSequence(flat, total)` then returns that step's `before`, so the jump
    being measured belongs to the last step that DOES play. Every probe before this one asked
    `findMatchingVariant` about the final call — a call that contributes nothing.
  - `last-frame-owner-probe.mjs` identifies the OWNER properly (`the last step whose own beats are
    non-zero`) and asks about THAT: owners split 43 whole-board / 34 parallel-stored / 8 coded — so the
    parallel branch, which converges by construction, does jump — and **84 of the 86 owner steps carry
    a SELECTION**, with a raw-step-vs-bare-NAME apply difference on **83 of them that equals the jump
    exactly** (6.32 = 6.32 on the worst four).
  - **The mechanism**: `replayWalk` stores `step.after` from `applyToBoard(board, raw)` — the raw step,
    selection included — while `evaluateSequence` animates `evaluateCallAt(s.before, s.name, ...)`, and
    `ReplayStep.name` is `raw.call`, i.e. the bare call with the selection DROPPED. For a selection
    step the animation therefore plays the whole-set reading of the call (every dancer moves) while the
    stored board is the selected reading (the unselected dancers never move). That is precisely the
    error field `sequence-authored-end-probe.mjs` measured — **some dancers at delta exactly 0.00,
    others displaced by lattice-valued vectors, in partner pairs** — which the earlier commit in this
    section mis-attributed to `snapBoard`.
  - **So the residual was masking this, not fixing it**: dragging the whole-set animation onto the
    selected board hides a selection bug, which is why the snap probe found only 3 and why the residual
    needed 6-unit drags at all.
  - **THE FIX — DONE, and it needs no residual.** `evaluateSequence` now hands the animator the STEP
    (`s.raw`) instead of `s.name`, `evaluateCallAt` takes `string | CallStep` and refuses the whole-board
    branch for a step carrying a selection (the apply never touched the whole board, so a whole-board
    path would move dancers the call never moved), and `evaluateParallelAt` applies the same `step`. A
    second half was needed and MEASURED: the groups come from the board's TILING rather than from what
    the call touched, so a group the call leaves standing was still animated along the authored path and
    dragged back - **any dancer whose APPLIED pose equals its current pose is now pinned**, after the
    group loop (writing the pin before it was tried and was useless - the group loop simply overwrote
    it, leaving 3.16 units of unselected motion on `Heads Right and Left Thru`; see
    `selection-witness-probe.mjs`, which enumerates 6 formations × 8 selections × 14 calls and now shows
    `unselected-move 0.000 / end-gap 0.000` on every pair that applies).
  - **MEASURED**: corpus last-frame jumps **86 → 2** (worst **6.32 → 0.13**, and the 2 that remain are
    modules whose final call does not play at all); the owner probe's selection offenders **84 → 0**;
    `anim-convergence` unchanged and PASSING (its 7 pins are single calls from NAMED formations, which
    is why they never showed this); `behaviour-audit` **148 PASS / 0 FAIL** with a new primitive gate
    ("a selection animates ONLY the selected dancers", worst unselected move 0.000000).
    The convergence RESIDUAL is consequently unnecessary, so its collision cost is not paid either.
  - **THE UNGROUPED MOVERS NOW FOLLOW A SEGMENT, NOT A STRAIGHT LINE.** Where the bare call cannot tile
    the board, the dancers in no matched group used to be blended along a straight line — which walks two
    dancers who TRADE PLACES (partners passing, as `Right and Left Thru` does) through the same midpoint.
    They now go through `interpolateSegment`, the coded path's own routing, whose EXCHANGE pair is
    rotated rigidly by a half turn about its midpoint so the two stay diametrically opposite and land
    exactly swapped at t = 1. MEASURED, for its size: this changes exactly **ONE** module across the
    corpus (`modules/static_set/resolve/2728.json`, minimum closest pair **0.00 → 1.00** — a real
    collapse, fixed) and nothing else.
  - **STILL OPEN, and the second hypothesis is now DISPROVED too**: the collision scan shows modules with
    a coincident pair (min gap < 0.1) going **73 → 103** when the selection fix landed (52 modules improve
    by >0.3, 37 worsen). The straight-line collapse explained this in principle and does NOT in fact —
    fixing it moved exactly one module — so the cause is **not diagnosed**. The remaining candidate is
    the pinning itself: a dancer the call does not move now STANDS STILL (correct) where before it was
    dragged along the authored path (incorrect, but it kept the movers clear of it), and a stationary
    dancer is something a mover can brush past. That is a hypothesis, not a measurement, and the next
    step is to check it on the modules that entered the band rather than to guess a third time.
  - Recorded for the next reader: `behaviour-audit` registers calls by FILENAME SLUG, so a title-keyed
    selection step cannot resolve there; the new gate builds its own `callsByTitle` Sequencer for that
    reason. A gate that uses the harness's own catalogue measures the harness, not the engine.
- **THE RESIDUAL WAS TRIED AND REVERTED.** Hoisting the parallel branch's correction into
  `evaluateSequence` for every branch — `pose(t) = authored(t) + (appliedEnd − authoredEnd) * t` —
  works on its own terms: corpus last-frame jumps **86 → 0** (worst 6.32 → 0.00), `anim-convergence`
  convergence **1913/1920 → 1920/1920**, `behaviour-audit`'s worst dPos **0.0392 → 0.0000**, and the
  largest single half-beat move across the corpus **6.836 → 1.868 units** (so most of the observed
  "jumps" are this defect, not a rounding artefact). But it is a DRAG, and a 6-unit drag is not a
  dance: across 1607 modules / 63645 samples (`sequence-anim-collision-scan.mjs`) modules with a
  coincident pair (**< 0.1**) go **73 → 135**, `< 0.5` goes **109 → 193**, and 55 modules move from a
  ≥ 0.5 pass to an exact coincidence. Trading a visible jump for dancers crossing is not a fix.
- **ALSO RECORDED**: `behaviour-audit.mjs`'s convergence gate allows 0.5 units / 0.1 rad, which cannot
  catch a class whose worst member is 0.1476 on the single-call sample — tighten it when the root is
  fixed (`anim-convergence`'s empty pin already gates the corpus-facing property).
- **A FULL `Promenade` FROM A SQUARED SET DID NOT MOVE, AND THE TRAVEL WAS NEVER THE CALL'S. DONE.**
  The report was "the dancers don't move, but the sequencer counts 8 beats". The mechanism is exact:
  `Promenade` means "promenade until you are home", so `promenadeHome` returns the home squared set —
  and FROM a squared set that is also the board the call STARTED on. `interpolateSegment`'s ring branch
  derived the whole arc from the start→end angle difference, so the difference was zero for all eight
  dancers. MEASURED (`tools/promenade-instance-probe.mjs`): net travel **0° for all 8**, against
  **±180°** for the same call's `Promenade 1/2`. It has never animated in this repo's history (commit
  `a753955`, which introduced the ring arc, records that same 0.000 in its own message), so this is a
  missing mechanism rather than a regression.
  - **THE AUTHORITY IS CALLERLAB'S OWN COMMENT, and the direction is CALLERLAB's too**: "Promenade
    Direction: Counter-clockwise", and "Especially in singing calls, Promenade Home is usually more
    than a quarter of the way around the set. **If not, dancers are often expected to add a full
    Promenade**." So the trip is the counter-clockwise angle to the home side and a trip of a quarter
    turn or less becomes a full circuit — which is the case that matters, because from home it is zero.
  - **THE REFERENCE AGREES, AND IT IS AN ANIMATION RATHER THAN A DESCRIPTION.** Taminations has no
    `AnimatedCall('Promenade')` at all: `ms/promenade.dart`'s 24 entries are every QUALIFIED form
    (`Heads/Sides/All 4 Couples Promenade <1/4…Full>`, `Star Promenade`, `Single File`, Wrong-Way), and
    the coded table catches the bare name with `'Promenade(Home)?' → PromenadeHome`, whose
    `performCall` **refuses a bare `Promenade`** ("Use either Promenade Home or Promenade <fraction>").
    The instance that does exist and does move is `Promenade Home`: it repeatedly applies
    `Counter Rotate` — a quarter turn about the set centre, `counter_rotate.dart` sweeping
    `3 * anginc` with `anginc = pi/6` — in a `do/while` until the dancer's `location.angle` (its
    `anglePosition`) comes back around its home anchor, which from a squared set is four of them. The
    engine's bare `Promenade` is a bridge for All8's `--Prom` and is documented as such; what it did
    not have was the motion, and the reference is where the motion comes from.
  - **IMPLEMENTED**: `promenadeTrip` (counter-clockwise, `[0, 2pi)`) replaces `shortest`, and
    `promenadeLap` adds the CALLERLAB full turn, both in `promenade.ts`; the ring branch takes them
    from `CodedMove.ringHome`. **MEASURED**: home `Promenade` net travel **0 → 360° for all 8**, end
    still exactly home; `Promenade 1/2` **±180° alternating → +180° for all 8** (the old route was sign
    ambiguous at half a turn, so partners went opposite ways).
  - **THE LAP IS DECIDED ONCE FOR THE WHOLE SET, AND THAT IS A MEASUREMENT, NOT A PREFERENCE.** The
    same number for all eight dancers CANCELS out of every pairwise angle, so the set's relative
    geometry over the call is exactly the trips' and the lap cannot collide anyone the trip would not.
    Per dancer it can, because on a board whose couples are not a ring the trips differ and some fall
    inside the quarter while others do not. MEASURED (`tools/promenade-travel-probe.mjs`, 19 boards =
    the 4 named formations the call applies to + the 15 All8 get-out start boards): the Zero Box
    template **`[B1c]` 1.905 → 0.076 per dancer, 1.905 → 1.905 shared**.
  - **A RING MOVE IS NEVER AN EXCHANGE, and that was a second live defect.** The exchange-pair
    detection runs before the ring branch, and a half promenade sends every dancer to the point
    diametrically opposite its own — so it paired a dancer with whoever stood there, six units away,
    and the two swept opposite ways about their shared midpoint and MET IN THE MIDDLE. MEASURED:
    closest pair **0.000 from `O In`** and 0.448 on three more, against 2.000 for the wheel the call
    is. Guarding that detection to non-ring segments fixed all four; `Promenade 1/2`'s band went
    **17 → 13** boards and its worst gap **0.000 → 0.127**.
  - **THE CORPUS-WIDE COLLISION SCAN CANNOT SEE ANY OF THIS, which is worth knowing before quoting
    it.** `sequence-anim-collision-scan.mjs` returns byte-identical numbers before and after, because
    of the 113 modules carrying a promenade step **only 4 animate one and all four are QUALIFIED
    CATALOGUE calls**; the rest are Ceder prose that fails to parse, and the bare coded `Promenade` is
    reached by NO module (`tools/promenade-corpus-play-probe.mjs` is the measurement of that, and is
    the reason `promenade-travel-probe.mjs` exists). An instrument's silence is not a pass.
  - **WHAT IT COSTS, measured rather than claimed.** Across the 19 boards: full `Promenade` closest
    pair **0.055 unchanged**, boards with a pair inside 1.0 **13 unchanged**, non-rigid **16
    unchanged**, largest quarter-beat move **0.279 → 1.180** (the motion). It is a REDISTRIBUTION:
    `[P4p]` 0.076 → 0.764 and `[B4c]` 0.055 → 0.093 improve, `[P3p]` 0.764 → 0.076 and `[B1p]` 0.881 →
    0.138 deepen. A twentieth board outside that set deepens too: the body ceder-10530's
    `Right and Left Grand` leaves, which is the KNOWN LIMIT commit `a753955` recorded at 0.303,
    goes **0.303 → 0.187** (`tools/promenade-anim-probe.mjs`). **No board moves from a clean pass
    into the band** — all five that deepen were already inside 1.0 — and the two that deepen are
    bodies where a stored "couple" is split across the set, so the counter-clockwise route sends one
    partner the long way. **That is the next item's job** — the ring these calls should be read from
    is the FACING pairs' (see the `7046` Alamo-ring entry in `HANDOVER.md` §4.2 and
    `tools/ring-facing-probe.mjs`), and the stored `couple` labels are the FASR `o` reading, which
    pairs dancers 180° apart with the same heading.
  - **GATED IN THE SAME COMMIT**: `promenade.mjs` now pins the shape, the direction and the magnitude
    exactly — from home, a quarter of the way in every dancer is a quarter turn counter-clockwise
    (tolerance 1e-9), half way in every dancer is on the opposite side and has travelled **6.32**
    units, the last beat is exactly home, and `Promenade 1/2` is a quarter round at its own half way
    (so the full call's lap cannot leak into a fraction). Its old "in motion, not home" check passed on
    a wobble and is now a floor: `[L.F1p]`'s worst dancer moves **6.97** units by the half beat, where
    from home the old derivation moved **0.000**.
  - `node engine/test/tools/promenade-travel-probe.mjs` and `promenade-corpus-play-probe.mjs` are the
    two new instruments; `anim-convergence` PASSES with its 7 pins unchanged and `behaviour-audit`
    148/0, `verify:light` all green.
- **A RING'S COUPLES ARE THE FACING PAIRS, NOT THE STORED `couple` LABELS — HALF DONE, AND THE OTHER
  HALF IS REFUTED BY MEASUREMENT.** The report was "they travel in different directions" on MS
  `ceder-7046`'s end ring. `tools/ring-facing-probe.mjs` measures the board: it is an **Alamo ring** -
  boys outside at radius 3.45, girls inside at 2.93, each pair FACING at 2.3 units with a side-offset of
  0.01-0.05 - while the stored labels pair dancers 180 degrees apart with the SAME heading (the FASR
  `o` reading).
  - **A NEW INSTRUMENT FIRST**, because the corpus-wide scans cannot see any of this:
    `tools/promenade-pair-probe.mjs` re-derives the pairs from the floor INDEPENDENTLY of the engine and
    reports, over the boards the call applies to, whether a pair wheels together. MEASURED before this
    round: **0** boards where a pair takes two different directions (the item-1 counter-clockwise fix
    had already removed that), but **12 of 17** where a partner separation moves more than 0.5 units,
    worst swing **6.15 units**, and on 7046 the four pair MIDPOINTS sweep a uniform **509 degrees** (the
    ring does turn as one) while the two members of a pair disagree by **184 degrees**.
  - **"WHEEL EACH PAIR RIGIDLY" IS REFUTED.** It was implemented - each pair taking its own midpoint's
    sweep as a shared axis, with each member's offset from that axis held through the wheel and eased
    out over a settle, which is the reference's own shape (Taminations wheels with `Counter Rotate` and
    THEN does `Half Wheel Around` + `adjustToFormation`). MEASURED, and it is worse on every axis:
    closest pair **0.055 -> 0.007** (`[L3c]`), largest quarter-beat move **1.180 -> 2.086**, and on a
    half promenade **2 boards where the pair members take opposite directions** - the very thing the
    change was for. A softer settle (half the call instead of a quarter) restores the collisions
    (0.057) but leaves the peak move at **1.464** and still splits 2 pairs on the fraction.
    **And it cannot achieve the gate in any case**: the partner separation swing is **5.79** against
    the **5.59** it started at, because the swing is not made by the wheel at all. It is made by the END
    BOARD - see below.
  - **THE REASON IS THE IDENTITY MODEL, NOT THE PAIRING.** `promenadeHome` returns `makeSquaredSet()` BY
    ID: every dancer to its OWN declared home spot. On an Alamo ring a floor pair's members are declared
    into different couples - the pair (#1, #6) is declared couple 3 and couple 1 - so their homes are
    **180 degrees apart** and ANY animation that converges must separate them by 180 degrees by the end
    of the call. The only freedom is WHEN, and the four measurements above show that holding them
    together and settling late is worse than the current smooth spread; the linear per-dancer trip is
    the smoothest reconciliation there is. Making a promenade end with the pair at the MAN's home is
    CALLERLAB's own "the Couples Promenade to the Man's home position" - i.e. applying the temporary
    couple number to the RESULT - which is the change this repo reverted TWICE (it cost 2 figures;
    `progression.ts`) and which contradicts "identity is data". **That is the real decision, and it is
    the user's, not an animation tweak's.**
  - **THE READING HALF IS DONE, AND IT IS FREE.** The pairing read at the point of use could only see
    partners standing SIDE BY SIDE with the same heading, so on an Alamo ring it found no mate, returned
    null and left the stored labels standing - whose "couple centres" are the MIDDLE OF THE SET (radius
    **1.13**, against **3.00** for the real pairs). `progression.ts` now has a FACING pass for that
    arrangement, behind a guard: it fires only when EVERY stored pair is outside the couple band, i.e.
    when the board's own labels pair every dancer with somebody on the far side. MEASURED effect: a
    `Promenade 1/2` from 7046's end ring ended **-90 degrees from home** and now ends **EXACTLY HOME**
    (`tools/promenade-rotation-probe.mjs`), because the ring reads as half a turn out. Figures stay
    **116 of 188**, get-out behaviour and conformance are byte-identical, `anim-convergence` keeps its 7
    pins, `verify:light` green.
  - **THE GUARD IS LOAD-BEARING, AND FINDING THAT OUT COST A CENSUS ROUND-TRIP.** Without it the facing
    pass fires on `figm130` too, whose board is two squeezed LINES (floor pairs 1.5 apart, midpoints at
    the four CORNERS) carrying one stored pair that IS inside the band, 2.50 apart. Pairs read off a
    line are line adjacency, not couples, so the ring test fired on a body that is not a ring and refused
    its `Promenade`: figures **116 -> 115**, three runs each way, and `tools/promenade-figure-stop-probe.mjs`
    names the victim. The guard is the measurement that separates the two cases - the Alamo ring has all
    four stored pairs ~6.0 apart, figm130 has one at 2.50. Gated in `promenade.mjs` §4c, which checks the
    witness really is an Alamo ring before using it.
  - **STILL OPEN, and it is the identity decision above**: on the 13 boards whose floor pairs and
    declared couples disagree, a promenade still shows the couples separating. Its size is the same
    before and after this round, and no animation change can reduce it.

- **THE CALL EDITOR NOW EDITS AN INSTANCE, AND THE `<tam>` ROUND TRIP IS MEASURED.** The editor could
  only RE-FRAME a call — pad another call's end onto its start — and could not touch the instance
  itself. A `<tam>` is a start formation, a path per dancer and the beats around them, and the ask was
  to edit all three. The model is the BUNDLE (a `DancerSpec` already IS a start pose plus a path), so
  the editor adds OPERATIONS rather than a second representation that can drift out of step with the
  renderer, the matcher or the XML codec.
  - **`normalizeInstance` IS THE SAFETY PROPERTY, AND IT IS MEASURED, NOT ASSERTED.** A tam authored
    for half the set publishes four dancers in HALF-set space — `ms/circle.xml` and `b1/circle.xml`
    both carry **4 mirrored of 8** — so letting a caller edit those numbers would edit a frame they
    never see, and a start edit would land on the MIRROR of the spot that was typed. Normalization is a
    180-degree rotation about the origin, i.e. exactly `fromPosAngle(-x, -y, a + pi)`, and that left
    factor commutes with the whole path chain. MEASURED over t = 0, ¼, ½, ¾, end on both witnesses:
    worst pose gap **2.3e-15 units** — one ulp, because `cos(a + pi)` is not bit-identical to `-cos(a)`
    — idempotent, no mirror left. So the claim is "exact algebra, exact in floating point to one ulp",
    and the harness pins the bound instead of pretending it is zero.
  - **WHAT EACH EDIT MEASURABLY DOES.** `setDancerStart`: a translated start translates the whole path
    (end delta exactly **(2.000000, -1.000000)** for a (+2, −1) start edit) and a start heading edit
    **ROTATES** the path about the start ((dx, dy) → (−dy, dx) to 1e-9), because a path is authored in
    dancer-local coordinates — which is what makes this an edit of the INSTANCE and not of the
    choreography. `setDancerGender`: nobody moves, nobody re-faces, and the derived home couple is
    **unchanged** (identity is matched on position and heading), which is why `couple` is reported as a
    READ rather than as an editable field — the taminations `<dancer>` declares only gender/x/y/angle,
    so an editable couple could not round-trip. `setDancerEnd`: the dancer ends exactly on the target,
    only its LAST move changes, no other dancer moves, beats held.
  - **THE FIRST RE-TIMING RULE WAS WRONG AND THE HARNESS CAUGHT IT.** `beats = max(path)` CUT an
    authored pause: a 14-beat call whose longest path is 10 came back at **10.5** after half a beat was
    added to a shorter dancer — a 3.5-beat pause destroyed by an edit that never touched it — while
    leaving the number alone ignores a genuine re-time. The pause is now carried as a **DELTA**:
    14 → 14.5 with the pause still 3.5.
  - **A REAL DEFECT FELL OUT OF THE EXPORT.** `callToXml` dropped `sequencer`, `actives` and the
    `<taminator>` note, and `sequencer` is not decoration: `Catalog.registrationXml` registers an
    applied fix from THIS xml, so an edit to the `sequencer="no"` half of a call came back as an
    ordinary **matchable** setup — the demonstration hole the flag exists to close, re-opened. All
    three are now written back out and pinned (`Ends Bend` `no` → `no` with `forSequencer false`;
    `Split the Outside Couple` `actives="Centers"` preserved; the `<taminator>` text preserved).
  - **THE EXPORT PRECISION WAS TOO LOW, AND THE NUMBER IS THE REASON.** Two decimals is the assets' own
    house style and it is not enough for a round trip: a path is a CHAIN, so each segment's rounded
    rotation Bezier accumulates and the final pose is out by the distance travelled since. MEASURED on
    `ms/circle.xml` edited to 10.5 beats: the end pose came back **0.0672 units** out — 13× the
    rounding of any single coordinate, a dancer standing visibly off its spot. At **four** decimals the
    same path is out by **0.000082** end / 0.000037 move, and the harness pins **0.001**, which the
    2-decimal form fails.
  - **THE ROUND TRIP IS THE DONE-WHEN, GATED IN `engine/test/editor.mjs`** (and that harness is in the
    `light` tier, so it runs in the fast gate): edit every dimension the editor can reach, export,
    re-parse, and require the same start formation, the same end formation, the same **ARRANGEMENT**
    (gender per dancer), the same moves beats-and-Bezier and the same beat count — and that exporting
    the RE-PARSED instance is **byte-identical**, so the round trip cannot drift.
  - **ONE FOOTGUN IS PINNED RATHER THAN DISCOVERED LATER.** The engine's mirror rule is geometric — it
    duplicates a half set only while SOME 180-degree partner exists — so an edited eight-dancer
    formation with no origin-opposite pair is read back as **16 dancers** under `mirror: true`. A rigid
    edit (a translation, or a rotation about the origin) PRESERVES every pair and cannot demonstrate
    it; moving one dancer out of each pair can, and the harness does exactly that. Every editor path is
    `mirror: false`, and `data.ts` says so where it matters.
  - **THE POC WIRING IS TYPECHECKED, NOT MEASURED**, and the commit says so: the Vite app
    cannot run under this sandbox (`spawn EPERM`), so the instance table, the moves editor and
    the save/apply-as-`kind: 'instance'` path are reasoned from the code — what IS measured is
    every geometric decision they call. **The pre-existing `editor-ui.ts` TS2739 is fixed in
    passing**, so `npx --prefix poc tsc -p poc --noEmit` is now **CLEAN**, and a POC typecheck
    is a real signal from here on (it is trap 18 in `HANDOVER.md`). `node poc/verify.cjs` still
    fails the same **three** pre-existing `Pass Thru` checks and loads all **542** catalogue
    calls.
  - **THE MOVES ROW DRIVES THE STAGE, and the beat range comes from the ENGINE.** The moves of
    the chosen track are shown as ONE STRIP rather than one at a time behind a dropdown: the move
    being edited is TRIPLE WIDTH and carries its numbers, and every other move is a compact tile
    (number, beats, hands) that selects on click — which is also what moves the highlight, so a
    long path is read whole instead of probed one move at a time. Picking a dancer in **Moves of**
    hides every other dancer's track, and the current move's own stretch of the chosen track is
    highlighted in amber with the rest of it dimmed. The stretch
    is a beat range, so it is `moveBeatRange(dancer, k)` in `editor.ts` and `sampleTrailRange` in
    `core.ts`, not arithmetic in the UI — which is what makes it checkable. MEASURED (section 15):
    the ranges TILE the dancer's clock ([0,1) [1,2) … [9,10) for a 10-move path), the last move
    ends at the dancer's own path total, and the poses at `from`/`to` are the poses reached with
    the earlier moves on the path and with this one included — checked against a TRUNCATED PATH,
    a different code path from re-adding beats, so an off-by-one separates from a typo. A PAUSE
    falls **after** the last move (`to` 10, call 14 — the distinction the doc comment makes), a
    zero-beat move owns an empty range and draws nothing, and an out-of-range index THROWS rather
    than returning a silent empty range. `sampleTrailRange`'s endpoints are **exactly** the poses
    at the range ends, every sample is inside the full track's bounding box, the stretch is never
    longer than the whole track (2.04 against 17.53 units for move 2 of dancer 1), and a range
    past the path end clamps to the path's last pose rather than returning NaN.
  - **THE CALL LISTS HAVE A FILTER, AND IT CANNOT CHANGE WHAT YOU HAVE SELECTED.** The editor's
    catalogue is several hundred calls, so a **Find** box narrows every call list in the panel
    (edit, post and pre) by ANDed substrings over the level, title, file and setup labels —
    `circle`, `ms wave` and `static square` all read the way they should. The one subtle part is
    the SELECTION: clearing a `<select>`'s options moves its value onto whatever survived and
    fires no `change` event, so a filter typed over the top of the chosen call would leave the
    panel showing one call while the editor still held another, with nothing to reconcile them.
    The chosen call is therefore always kept, re-inserted at the top and marked, which makes the
    filter a pure VIEW of the catalogue. UI-only, typechecked: no engine code, no harness and no
    feature file changes, and the filter predicate is a substring test with no geometry in it.
  - **CLONING A CALL ONTO A DIFFERENT START SETUP, AND COMPLETING THE TRACK.** A `<tam>` is authored
    for ONE start formation and its moves are written in dancer-LOCAL coordinates, so re-posing the
    start re-frames the whole chain. That is the cheap half of authoring a new setup, and it is also
    why the track goes wrong: MEASURED, `Circle Left` re-based from a squared set onto `Double Pass
    Thru` finishes **2.86 units and 90° away** from where the call finishes. `setStartFormation`
    re-bases (assigning dancers to the formation's spots geometrically, preferring a spot of the
    dancer's own declared gender whenever the counts allow, and REFUSING a count mismatch rather than
    re-basing onto gaps), and `connectStart` completes the track by re-aiming **exactly one move per
    dancer — the first** — so it walks in from the new start to where the old track resumes.
  - **THE ANCHOR IS THE END, NOT THE START, and the identity was got wrong first.** The anchor is the
    ANCESTOR's pose at the end of ITS first move; re-aiming at the old start's boundary instead would
    move the end with the start and would not be a clone of anything. MEASURED: the end comes back to
    **1.54e-15 units / 4.44e-16 rad** — one ulp, because the pad Bezier recovers its end heading from a
    tangent, which is not bit-identical to walking the authored chain — every later move is
    byte-identical, and the re-aimed move keeps its own beats and hands. The FIRST attempt asked
    whether the dancer's START is the anchor, which is a different question with a different answer
    for every dancer, and it silently re-aimed every authored first curve into a straight pad:
    `connectStart(ancestor, ancestor)` was not the identity. Asking whether the dancer's OWN FIRST
    MOVE already ends on the anchor fixes it, and the harness now pins that identity.
  - **WHAT CANNOT BE CONNECTED IS REPORTED, NOT HIDDEN.** A dancer whose first move has zero beats has
    no time to walk in: it is left alone and stays **3.25 units** wrong, which `endPoseError` shows.
    `endPoseError` compares dancer **BY INDEX** on purpose — a clone and its ancestor share identity,
    so a permutation of the same ends must read as an error rather than be paired away by a
    re-derived correspondence, which is exactly what `closureDiscrepancy` does and why it is the
    wrong tool here.
  - **THE PICKER OFFERS EIGHT-DANCER FORMATIONS ONLY, AND TODAY THAT FILTERS NOTHING.**
    `listFormations()` over the whole pooled catalogue is **134 formations and every one is eight
    dancers** (`node engine/test/tools/editor-clone-probe.mjs`; the registration takes 1.6 s). The
    filter is a guard rather than a fix, and it is recorded that way — a filter that is doing nothing
    should say so rather than look load-bearing. A clone is saved and applied as a NEW setup
    (`kind: 'clone'`, appended), not as a replacement, which is the difference between it and an
    instance edit.
  - **A CREATED CALL CAN NAME ITS START FORMATION, AND A CALLER-MADE FORMATION CAN BE ADDED TO THE
     CORPUS.** Asked for: "in the Browse Calls, allow the created end formations to be added to the corpus,
     so that created calls that start from it export xml with a formation reference rather than an embedded
     [formation]". The corpus's own tams name their start (`formation="Name"`, no geometry); every tam the
     editor wrote embedded the block, so a shape labelled from one call's end existed once per call that
     started from it and editing it reached none of them. TWO ENGINE HALVES, both gated in
     `engine/test/editor.mjs` 20: `callToXml(call, name, { formation: 'reference' })` writes
     `formation="Name"` and no block (the default is still the block, so every existing caller and the
     round-trip gate are untouched), and `CallLibrary` now resolves a `formation="Name"` reference against
     the formations `registerFormation` has added as well as the corpus - without that half a reference to
     a caller-made shape simply failed with `No formation "..."`, and the library does not retry, so the
     APP's registration ORDER matters too (formations before calls, at both construction sites; registering
     the calls first was a real bug). `startsFromFormation` is the guard that keeps a reference honest: the
     name must describe the shape the call starts from INDEX FOR INDEX, because a tam's paths are paired
     with the formation's dancers by position, and the gender at each spot is part of the arrangement the
     gender gates read; `callToXmlNamed` is the app-facing decision (reference only when the name resolves
     AND matches, else the block). The POC side is one flag (`UserFormation.inCorpus`), one Browse button
     (`add to corpus`, which hands over the `<formation>` block because a browser cannot write
     `formations.xml`), and one helper (`poc/src/tam-xml.ts`) that every `<tam>` writer goes through - the
     wiring is checked by `poc/tools/formation-ref-probe.mjs`, with the two faults it exists for shown to
     fail on a patched copy.
  - **A MOVE'S END FACING IS THE FRAME THE NEXT MOVE IS PLAYED IN, AND THAT IS THE FORMAT RATHER THAN A
     BUG.** Reported as one: "adjusting the end of the facing curve alters the direction of the rest of the
     trace. This shouldn't happen." MEASURED on a witness (`poc/tools/facing-chain-probe.mjs`): a 10deg
     change to a middle move's end heading rotates every later boundary pose RIGIDLY about the pose the move
     ends on by exactly that angle (agreement 2.8e-15 units), swings every later drawn segment by the same
     10deg, and carries the call's end 0.417 units across the floor. Confirmed against the reference:
     taminations composes a dancer's moves as `tx = tx * it.translate(); tx = tx * it.rotate();` and carries
     the frame forward (`taminations-flutter/lib/math/path.dart`, `Path.recalculate`), so the trail and the
     animation agree by construction and the end formation turns with the facing. The caller's own follow-up
     was "yes, I think it's all correct. My misunderstanding." So the behaviour is UNCHANGED and now PINNED
     - `engine/test/editor.mjs` 19 (the rotation, the exact angle, the untouched moves before it and the
     untouched other dancers), the probe (the same numbers with the reference quoted), and a sentence on the
     Facing tab where the numbers are. The compensation that was built first (`setMoveFacing`, which kept
     the trace and turned only the headings) was DELETED rather than left switched off: a mutator nothing
     calls is a decision waiting to be made by accident.
  - **THE CLONE'S WALK-IN IS FORCED, AND THE EDITOR'S GROUP GATE NOW ASKS ABOUT THE CURVE IT WRITES.**
     Reported after a completed clone: "selecting multiple dancers is no longer activating the bezier
     edit mode - they look the same", then "the connect created for opposites seem to match, but not
     dancers at other angles", then the hypothesis "sounds like a precision issue". All three are
     answerable by measurement, and `poc/tools/connect-assign-probe.mjs` answers them over all 134
     targets: **the walk-in cannot be one shared move** (no assignment of dancers to the new formation's
     spots makes all eight agree - 0 of 134, to 1e-9 or to within the windows, because the end formation
     is kept and the chain is local, so the walk-in is whatever carries *this* dancer to *its* anchor);
     **opposites match because the ancestor's own first boundary is point-symmetric** (504 accepted
     walk-in pairs are 180deg apart against 76 at any other angle - and only 4-fold symmetry, which the
     boundary does not have to within a tenth of a unit, would make a 90deg pair agree); and **it is not
     precision** (the worst difference the gate ACCEPTS is 3.06e-3 units, the smallest it refuses 0.0561
     units = 2.3px, so the refusals are not floating-point noise); and the WINDOW ITSELF WAS TOO TIGHT, which
     the report was right about after all. The reported witness - `All 4 Couples Promenade Full` cloned onto
     the formation made from the end of `Right and Left Grand`, then dancers 1 and 3 - was refused on a
     difference of **0.0142 units = 0.58 px**, because the window was 0.01 units (0.4 px). The shape window
     is now **0.025 units, one pixel**, measured ALONG THE CURVES rather than on the control points (a
     control point can differ by more than the curves do, which is how the same segment written as an
     ease-in and as a constant-speed line was refused), and the one-pixel figure is measured:
     `clone-refusal-probe.mjs --sweep` bands 12248 refused walk-in pairs over a call sample x every offered
     formation and finds **232 under half a pixel and the next smallest at 2 px, with nothing in between**,
     so the window sits in that empty band and opens the 232 plus the witness while refusing nothing else.

     THE OTHER HALF OF THE REPORT WAS A DIFFERENT DEFECT: the gate asked whether BOTH curves agreed while a
     Move-tab edit writes only `translate` and a Facing-tab edit only `rotate`, so it locked a tab whose own
     numbers were unanimous. Of the walk-in pairs it refuses, **76 are refused on the FACING alone while
     their travel curves agree to within the window - 24 of them with all six numbers identical, the very
     same straight line - and 242 face identically and are refused on the travel alone**, with 64 of the 134
     targets having such a pair. The gate, the field locks, the handles, the drag path and the arc checkbox
     are now keyed on the curve in hand, and the lock note gives the difference in that curve's own
     units (board units for the path, degrees for the facing - the old note measured the two curves
     where they lie ON THE FLOOR, so two dancers doing the same move two units apart reported a 2-unit
     disagreement about nothing).
  - **THE BROWSE PANEL NOW NAMES THE CALL'S END FORMATION, AND A CALLER CAN LABEL ONE IT CANNOT.**
    The panel holds a call BUNDLE and every read the engine offers takes a BOARD, so `boardAtBeat`
    is what makes "what formation does this finish in" askable at all; identity is read from the
    START (identity is fixed at the opening square), geometry from the last beat, and a start that
    is not home-like reports `id: 0` / `UNKNOWN_COUPLE` rather than inventing an identity from the
    array index. The field shows the name, whether it is user-defined, the `[FASROO]` notation and
    the arrangement number when the letter is known.
  - **THE ANSWER IS COMPUTED, NOT LOOKED UP, AND THE FSM IS WHY THAT IS THE RIGHT CALL.** The
    obvious route is the precomputed FSM asset, whose edges carry an `endFormation` per (state,
    call) — but its `endFormation` is itself produced by the same recognition, so it CANNOT name
    anything the recogniser cannot, while being a build artefact that can lag the assets. The panel
    has the call in hand, so the end board is one `poseFor` per dancer away and always current.
    The FSM would have added a staleness failure mode and bought nothing; the read says WHICH
    recogniser answered instead, so a stale FSM shows up as a disagreement in the FSM tab.
  - **MEASURED, AND IT DECIDES THE SHAPE OF THE FEATURE** (`tools/end-formation-probe.mjs`, MS,
    1015 call variants): the library names **636 (62.7%)** of the end boards, **413 (40.7%)** also
    carry a curated label, and **379 (37.3%) are unnameable** — of which **320 are 2/4/6-dancer
    boards that are unnameable BY CONSTRUCTION** (the formation library holds eight-dancer
    geometries only: the constructor mirrors a four-dancer corpus entry to eight and drops the
    original, and `bestFormationMatch` skips any formation of a different dancer count). So the
    labelling flow is offered for the **59** unnameable EIGHT-dancer ends and REFUSED — with the
    reason on screen — for a half-set authoring, where a label would be as unusable as the board.
  - **A USER-DEFINED FORMATION IS TAGGED AND REGISTERS IMMEDIATELY.** `registerFormation` adds the
    name and the geometry to the library and CLEARS THE MATCH CACHE, which is not a detail: the read
    is memoized by exact geometry signature, so without it the board the caller was looking at would
    keep answering "unnamed" for the rest of the session while the next board got the label. The
    same geometry-dedupe the constructor applies is applied to the user path, so re-registering a
    shape the corpus carries adds the NAME without a second copy of the geometry. Gated in
    `sequencer.mjs`: the read before registration, the same read after (the cache), the tag, the
    dedupe, that an ALREADY-named board keeps its name, that a FRESH sequencer over the same corpus
    does not know the label (no leakage into the shipped catalogue), and that `formationToXml`
    round-trips through `parseFormations` to 3.1e-16.
  - **STORED LOCALLY, EXPORTED FOR THE CORPUS**, like every other authoring path here: a browser
    cannot write `formations.xml`, so the label lives in `localStorage` (`dsUserFormations`), is
    registered at startup, and the panel offers the `<formation>` block for pasting in. `del` forgets
    the label but the LIBRARY keeps the name until reload — said on screen, because unregistering
    mid-session would leave cached reads naming a formation the store no longer holds.
  - **TWO MISTAKES, TWO CONTROLS, because they are not the same mistake.** A user-defined end
    formation gets a **detach** (the label is wrong HERE — stop it applying to this call; the
    formation stays in the corpus and still labels every other call) and a **remove** (the label is
    wrong — delete it for every call). DETACHING IS NOT A CHANGE TO THE LIBRARY, deliberately:
    recognition is a geometry question and geometrically the shape IS the shape, so there is nothing
    to correct; what can be wrong is applying a label to one call. The instance is keyed by
    `callId` + `setupIdx`, the same identity the editor's saved edits use, and the detach is shown
    WHERE IT APPLIES (`"X" is detached from this call` + reattach) because a mis-click must not be
    invisible or permanent. `remove` also drops the detachments that named the formation — the
    record would otherwise dangle and silently suppress a future formation given the same name.
  - **AND THE FIELD MUST STOP APPLYING A LABEL WHOSE FORMATION IS GONE**, or the destructive button
    appears to do nothing: `remove` deletes the STORE entry, the library keeps the name until reload
    (as chosen), so `applyLabel` declines a user-defined name that is no longer stored — which is
    exactly what a reload would show. Labelling a board re-attaches it, so a formation detached here
    and then created again under the same name cannot eat its own work.
  - The new instrument is `node engine/test/tools/editor-instance-probe.mjs`; `verify:light` is green
    (12 harnesses, 36.3 s).
  - **THE "ALL" BUTTON IS GONE, AND THE COORDINATE FIELDS LOCK WHEN A SELECTION'S SHAPES DIFFER.** The
    "all" button was near-useless for the reason the user gave — very few calls have every dancer doing
    exactly the same move — so it is now ONE TOGGLE PER DANCER (numbered chips in the moves row, the
    same state as the `sel` column of the table). That deleted a concept as well: there is no separate
    "focused dancer" any more, `moveDancer` is a GETTER over the selection returning the
    lowest-numbered member, because picking a dancer to look at and picking dancers to change are the
    same act and two pieces of state for it only gave the panel a way to show values edits did not
    touch. Unticking the last member is refused; the set can never be empty.
  - **MULTIPLE SELECTED DANCERS ARE EDITED FROM THE FIRST ONE'S DATA, AND ONLY WHEN THE NUMBERS
    GENUINELY AGREE.** The gate is on the LOCAL values, which is what "after correct orientation"
    means for this data: a move's Bezier is authored in dancer-local coordinates, so the same local
    control point on two dancers IS the same shape in each frame and no rotation arithmetic is
    involved. Writing a number into a field writes it to every selected dancer, so on a selection whose
    curves differ the write would COLLAPSE genuinely different shapes into one in a keystroke — the
    exact difference the table exists to show. Where they agree the write keeps them agreeing, and a
    single selection is always editable. When locked the fields are greyed, not hidden (the first
    dancer's value stays readable), the tile names the reason and the fix, and the board handles are
    not drawn at all, because a drag is a coordinate edit the same gate would refuse. The gate is
    enforced in `commitMoveChange` as well as in the fields, because THE DRAG PATH REACHES THAT
    FUNCTION WITHOUT PASSING THE FIELDS — a fields-only check would have left that hole open. Beats and
    hands are deliberately NOT gated: they are not coordinates, and unifying a timing or a hold is a
    legitimate group edit rather than a collapse of geometry.
  - **ONE PAIR OF HANDLES, NOT ONE PAIR PER DANCER, AND A THIRD OF THE SIZE.** The handles are the
    first selected dancer's, which is what makes the picture and the tile describe the same dancer. A
    pair per selected dancer is the literal picture of the group edit and was the earlier behaviour; it
    was unreadable with a dozen dancers selected, and the pairs are copies of each other anyway.
    The dot went 0.3 -> 0.1 board units. MEASURED, and this is what makes "very big" an objective
    complaint rather than a preference: a DANCER MARKER is 0.12, so the handle was **2.5x the thing it
    is a handle for**. The GRAB TARGET deliberately did not shrink with it — it is now a floor-plane
    radius checked independently of the mesh, on a plane at the handles' own height rather than the
    floor, so the pick cannot drift with the camera angle. `node poc/tools/handle-pick-probe.mjs`
    measures the plane's sign (the classic `Plane(normal, constant)` off-by-a-sign, which a steep
    camera hides), that a point 0.20 away is picked and 0.35 is not at 50deg AND 14deg elevation, that
    the target is 31-35 px at 1080p against the dot's 10-11 px, and — over all **9994 resolved
    segments of the 542 catalog calls** — that 69.7% of curves have separable handles, 24.8% have them
    distinct but closer than the radius and **5.5% have them EXACTLY coincident**. The first version of
    that probe asserted "unambiguous for >98% of curves" and the corpus scan FAILED it: the claim in
    the code comment was wrong, so the comment now states the real limit. Where the dots coincide the
    strict nearest-wins test gives the grab to `c1` and one control point is unreachable — a
    pre-existing limit (two coincident meshes were picked in traversal order before), recorded rather
    than papered over. Typecheck clean, `verify:light` green (12 harnesses, 38.7 s), `poc/verify.cjs`
    the same 3 pre-existing Pass Thru failures.
  - **THE FACING CURVE IS DRAGGABLE TOO, IN A DIFFERENT COLOUR, AND IT IS DRAWN AS A CURVE.** The
    Facing tab draws the facing Bezier ITSELF in **cyan** against the travel curve's magenta, sampled
    through the ENGINE'S OWN `bezierPoint`, so the picture cannot drift from the data — the point of
    the POC's split is that there is no second implementation of the geometry, in the renderer or
    anywhere else. The three control points are the draggable dots and the control polygon is the
    scaffolding they hang from. It appears ONLY on the Facing tab with `explicit` ticked, which is not a
    new guard: the Facing tab is already disabled when `rotate` is null, because "face along the travel
    tangent" is not a curve anyone can edit. The colour is the point of the exercise rather than
    decoration: magenta is a path on the floor where the dancer goes, cyan is a curve whose DIRECTION is
    where the dancer faces, and one colour for both would invite reading the second as the first.
  - **AND THE FIRST VERSION OF THIS WAS DRAWING JOIN-THE-DOTS WITH A FALSE EXPLANATION, WHICH A CALLER
    CAUGHT.** The reasoning that "the coefficients are a tangent space, so there is nowhere on the floor
    to put a heading" was right, and the conclusion drawn from it — draw only the control polygon — was
    wrong: the curve is drawable, and it is the thing that says which way the dancer faces. The note
    then went further and claimed that **the ray from the dancer out to a point of the curve is the
    heading**. `bezierAngle` is `atan2` of the DERIVATIVE, so the heading is the direction of the
    curve's TANGENT. MEASURED: the two readings differ by more than 10deg at **47.6%** of instants and
    more than 1deg at **79.3%** — the claim was not loose, it was false, and the correction is pinned in
    the probe (7c) rather than trusted to this entry.
  - **THE PICTURE IS THE DATA.** `poseFor` reads the curve with `bezierAngle`, so its tangent IS the
    heading; the curve is drawn in the dancer's frame at the move's start, which is the frame its
    coefficients are authored in, and where the tile's own numbers can be read straight off it. Its
    LENGTH means nothing — uniformly scaling the whole curve leaves every tangent, and so every facing,
    exactly as it was — which is the one thing to be careful about when reading it. The cyan heading
    ticks on the amber trail are the same headings drawn where the dancer actually is, so the two can be
    compared directly. MEASURED (`node poc/tools/facing-handle-probe.mjs`, section 7): the drawn curve
    starts at the dancer's own spot EXACTLY and ends on the endpoint the tile edits (worst **0**); away
    from the ends its direction matches the engine's heading to **0.00073deg** and quartering the
    measuring window cuts that by **16x**, so the limit really is the tangent; the **32** drawn segments
    resolve the direction to **0.056deg** at worst, so the polyline is the curve and not a lookalike;
    and the two ends measure worse (0.688deg, shrinking 4x) because a chord at an endpoint is a
    one-sided difference — first order, which is the INSTRUMENT and not the claim. The probe's first
    version failed its own check by asserting a single bound across all instants, and the second failure
    in the same section was an assertion that every curve stays inside the floor: 4 of 4145 reach past
    the floor's half-width, so the tail is reported rather than asserted away. Nine curves in ten reach
    no more than **4.08** units from the dancer.
  - **THE TRAVEL CURVE GETS NO DRAWN CURVE OF ITS OWN, AND THAT IS NOT AN OMISSION: IT IS THE TRAIL.**
    `sampleTrailRange` walks the very same cubic onto the floor, highlighted in amber for exactly this
    move, so a second copy would sit on top of it and say nothing new. That is the whole reason the
    facing curve looked like join-the-dots: it had no other rendering, and the travel curve did.
  - **THREE POINTS AND NOT TWO, BECAUSE THE TILE HAS FIVE FIELDS.** The facing tab edits `r.cx3 cx4
    cy4 x4 y4`; the curve's three points carry exactly them (r1 → cx1, r2 → cx2/cy2, r3 → x2/y2). A
    pair like the travel curve's would leave the endpoint — the heading the move FINISHES on — with no
    handle at all. The travel curve keeps its pair deliberately: there the endpoint IS the authored
    track, and dragging it is the deferred shared-connecting-point gesture. So the asymmetry has a
    reason on both sides rather than being an oversight.
  - **r1 SLIDES ON A RAIL, AND THAT IS THE FORMAT'S CONSTRAINT RATHER THAN THE GIZMO'S CHOICE.**
    MEASURED (`node poc/tools/facing-handle-probe.mjs`): the `<rotate>` element carries
    cx3/cx4/cy4/x4/y4 and **no cy3**, the converter hardcodes `cy1: 0` and the exporter emits no cy1, so
    an edit to cy1 is silently thrown away — a cy1 of 0.5 turns the dancer **331deg** mid-move and
    re-parses as the authored curve **exactly**. r1 therefore writes cx1 alone, which is also what
    guarantees no drag here can produce a facing the corpus cannot express. In the **14** curves whose
    cx1 is already 0 the rail pointer sits on the dancer's own spot (Sashay, Lateral Substitute) — a
    real authored shape, and it still means "no change of heading at the start", because `atan2(0, 0)`
    is 0. The probe's FIRST version asserted `cx1 > 0` for the whole corpus and the scan FAILED it;
    like the coincident-handle claim last commit, the assertion was the wrong shape and the honest one
    is `cx1 >= 0` with the zeros named.
  - **WHICH POINT SETS WHICH END, MEASURED RATHER THAN REASONED.** The heading change at t = 1 is the
    direction of `P3 − C2` ONLY, so C2 and P3 set the facing the move ends on while C1 shapes only the
    middle — and NOTHING moves the heading change at t = 0, because cy1 = 0 puts the start tangent along
    the dancer's own +x. The probe's second version had to MEASURE AT t < 1 to see a cy1 edit at all: at
    t = 1 it reported "no change" for an edit that plainly changes the turn, because the last derivative
    span contains no C1. Population over the corpus: **4145 facing curves, 4088 of the 9994 resolved
    segments carry an explicit one**, and the end-of-move heading change is 0deg for 2233, 180deg for
    674, -90deg for 597, 90deg for 383.
  - **THE DRAG'S ARITHMETIC IS CHECKED, WITH ITS BOUND STATED.** Placing a point and reading the
    pointer back is the identity (worst **4.4e-16** over 20 frames at five headings), each of the three
    write rules touches its own point's numbers and no other field, every edit keeps cy1 at exactly 0,
    each survives export + re-parse (worst **0** against the harness's own 0.001 tolerance), and a
    handle dropped back on its own value exports **BYTE-IDENTICALLY** — a touch is not an edit. The
    placement math is a COPY rather than the panel's own function under test, because `editor-ui.ts` is
    TypeScript inside a Vite app that cannot run in this sandbox; the probe says so, so the bound is the
    honest one.
  - **THE NUMBERS NOW FOLLOW THE DRAG LIVE.** The drag path deliberately skips `renderInstance` per
    pointer move — rebuilding the table, the strip and eight dancer views sixty times a second is the
    difference between a drag and a slideshow — but that left the one thing the caller is steering by,
    the numbers, frozen until the pointer came up, on BOTH curves. `refreshNumberFields` writes the live
    instance's values into the tile's existing inputs (skipping the focused one) as part of the light
    path, which is a handful of field assignments rather than a rebuild.
  - **AND THE FORMAT FACT THE RAIL DEPENDS ON IS NOW A PINNED GATE.** `engine/test/editor.mjs` section
    14c measures that a parsed facing curve carries cy1 = 0, that a cy1 of 0.5 really does turn the
    dancer (331.5deg), and that the export DISCARDS it — so if someone later adds cy3 to the format and
    the exporter, the check fails and tells them the rail is no longer the format's constraint.
    `verify:light` green (12 harnesses, 36.7 s); typecheck clean; `poc/verify.cjs` the same 3
    pre-existing Pass Thru failures.
  - **THE FLAT VIEW WAS NEVER FRAMED, AND HAD NO PAN OR ZOOM.** Two reported symptoms, two distinct
    faults, and the first one explains the second half of the report ("it used to jump to square when
    dragged or scaled"): the orthographic camera is constructed with a SQUARE frustum (±11 on both
    axes) and `resize()` — the one place that recomputes left/right from the canvas ASPECT — was only
    ever called from the window's `resize` listener. The app never called it at startup, so on a 16:9
    window the floor grid was drawn **1.78x wider than tall** until the first window resize snapped it
    square. MEASURED, and the ratio is not approximately the aspect but EXACTLY it: 72.7273 px/unit
    across against 40.9091 up, ratio 1.777778. `createStage` now resizes once as it builds, `setView2D`
    resizes on every switch, and a `ResizeObserver` on the canvas catches a device-pixel-ratio change or
    a fullscreen toggle — three calls, one implementation, and the frame can no longer be a layout
    behind. `resize()` deliberately does not touch `camera.zoom`, so a resize cannot throw away the
    caller's view.
  - **PAN AND ZOOM DID NOTHING IN 2D BECAUSE THE FLAT VIEW HAD NO CONTROLS AT ALL.** OrbitControls
    binds to ONE camera object for its whole life, so `setView2D` had been switching the single control
    set off — and simply enabling it in 2D would not have worked either, because that control set drives
    the 3D camera: the pan and dolly would have gone to the camera that was not on screen. There is now
    a second control set for `camera2d` with `enableRotate = false` (a top-down view that can be tilted
    is not a 2D view) and the LEFT button re-mapped from ROTATE to PAN, which is not cosmetic: with
    rotation disabled the default mapping leaves the first gesture anyone tries doing NOTHING.
    `Stage.controls` is no longer exported, replaced by `setControlsEnabled`/`updateControls` that act
    on whichever view is on screen — the mistake that created this bug was a caller reaching for "the"
    controls, so the interface no longer offers one to reach for.
  - **THE ZOOM AND PAN ARE BOUNDED, AND BOTH BOUNDS ARE ARGUMENTS RATHER THAN TASTE.** An orthographic
    frustum of zero width has no inverse, so an unbounded dolly ends in a blank screen: 0.2x to 20x, a
    100x range that still frames the whole floor at the wide end. The pan bound is the floor's own
    half-width plus the visible half-span on that axis, so the board's edge can always be brought to the
    screen's edge and the board can never be pushed off with no gesture that brings it back. THE FIRST
    VERSION USED ONE SYMMETRIC LIMIT AND THE PROBE MEASURED IT TOO TIGHT: `node poc/tools/view2d-probe.mjs`
    found the floor's edge stopping 0.571 of a screen-half short of the side edge on a 21:9 canvas,
    because a limit derived from the VERTICAL half-span is conservative horizontally by exactly the
    aspect ratio. Per axis, the edge now lands on the viewport edge to **1.7e-14** across 80 clamped
    positions at five zooms and four canvas shapes, with a strip of floor always visible.
  - **THE CONTROLS ARE MEASURED, NOT MERELY CONFIGURED.** Every claim above is about what three.js does
    with these settings, so the probe drives three's OWN OrbitControls through a fake canvas: a left
    drag of 100x50 px pans the view centre by 2.444x1.222 units — the orthographic pan scale, to 1e-6 —
    the camera stays directly overhead (y = 40 to 12 decimal places, which is OrbitControls' own polar
    clamp, not a coincidence), the offset from the target is preserved so a pan is a pan and not a tilt,
    a wheel changes the ZOOM ONLY with the camera left in place (which is why a resize cannot disturb
    it), and the clamps land exactly on 0.2 and 20 with an invertible projection matrix. Typecheck
    clean; `verify:light` green (12 harnesses, 36.9 s); `poc/verify.cjs` the same 3 pre-existing
    Pass Thru failures.
  - **THE HANDLES DID NOT FOLLOW THE MOVE SELECTION — THE THIRD BUG OF THAT SHAPE, SO THE CLASS IS NOW
    CHECKED.** Selecting another move in the strip re-rendered the strip and re-focused the trail
    highlight, but `renderHandles` was called only from `renderInstance`: the tile and the highlight
    described the new move while the gizmo sat on the PREVIOUS move's control points. Same fault as the
    trail-focus bug and the `registerUserFormations` bug before it — one thing that says "this is what is
    being edited" was updated and another was not.
  - **THE FIX IS STRUCTURAL RATHER THAN LOCAL.** `syncTrailFocus` is now `syncStageSelection` and draws
    the handles itself, so the trail focus and the gizmo are ONE step: they are the same instruction to
    the stage, and either alone is a board that disagrees with the panel. `renderInstance` calls it,
    `selectMove` calls it, and `renderMoveStrip`'s own index clamp is covered because both of its call
    sites sync after it.
  - **AND THE CLASS IS AUDITED IN THE SOURCE, WITH A NEGATIVE CONTROL.** `node
    poc/tools/stage-sync-probe.mjs` parses `editor-ui.ts`, finds every method that writes the move index,
    the travel/facing kind or the dancer set (or calls the strip renderer), and requires each to reach
    the stage sync — directly or through `renderInstance`/`commit`. Two rules and one exemption: a
    `render*` method may touch the selection because every caller of a renderer must itself sync, which
    the second rule enforces — and it names the eight qualifying methods. THEN IT IS SHOWN TO FAIL: the
    same analysis over a copy with `selectMove`'s sync call removed (the code as it was) flags exactly
    `selectMove`. A structural check that cannot fail on the bug it was written for is decoration. It is
    labelled for what it is — a check on the SOURCE and not on behaviour, because this wiring fault is
    invisible to every engine harness and the Vite app cannot run in this sandbox. The audit's mutator
    list now also carries the ARC LOCK's two fields, which are selection-dependent state for the same
    reason the move index is.
  - **CTRL SNAPS TO THE GRID, AS A MAGNET RATHER THAN A LOCK.** The cell is the floor's own and the
    authority is the format's own header — *"The scale is in dancer units, same as shown when the grid
    is on"* — so one unit is one drawn cell, a `Forward` (x2 = 1) is one cell of travel, and the couples
    of a squared set stand **2** units apart. MEASURED (`node poc/tools/snap-grid-probe.mjs`): only
    **46%** of the corpus's authored coordinates are on the unit grid (the rest are 1/3s, 4/3s and
    1/sqrt2s, what a Bezier approximation of an arc produces), so the snap is a NEW convention rather
    than a restoration of one — which is why it is behind a modifier. THE TOLERANCE IS THE ONE JUDGEMENT
    CALL and the caller corrected the first attempt: rounding from anywhere in the cell quantises the
    drag, so every position is a grid position and the gesture stops being "help me land on the line".
    It now pulls only within a quarter of a cell (**10.2 px** in the flat view at 1080p, where the whole
    cell is 40.9 px) and leaves the point EXACTLY where the pointer is otherwise — and the probe checks
    that outside the magnet there is no rounding at all, which is what makes it a magnet. The snap is in
    the BOARD'S grid, not a grid turned with the dancer's frame, because "snap to the grid" means the
    grid the caller can see — see the correction below.
  - **AND THE SNAP IS IN THE BOARD'S FRAME, NOT THE DANCER'S — THE CALLER'S THIRD CORRECTION ON THIS
    FEATURE.** Snapping the LOCAL coordinates put the dot on a grid rotated AND offset with the dancer,
    so it lined up with the lines the caller can see only when the dancer was square to the floor AND
    standing on a whole coordinate. The point is now snapped in the coordinates the floor is drawn in,
    before it is taken into the local frame at all. MEASURED by `node poc/tools/snap-grid-probe.mjs`,
    which sweeps 384 pose/pointer combinations: the board snap lands exactly on a drawn line in EVERY
    case; the local one misses by up to **0.196** units (about 8 px at the flat view's 40.9 px/unit) and
    agrees with the board snap only in the 64 cases where the dancer is square to the floor on a whole
    coordinate — the usual stance at the start of a move, and the only one where it was not misleading.
    The probe also reads three's own GridHelper geometry to pin the premise: the drawn grid is 21 whole
    coordinates from -10 to 10 at a spacing of 1, so a 1-unit cell IS the drawn cell and a whole
    coordinate IS a drawn line. AND THE TRADE IS STATED RATHER THAN HIDDEN: the numbers left in the tile
    are then the dancer-local coordinates of a grid point, so they are not round when the dancer is
    turned (a dancer facing 34deg leaves 4.2132 rather than 4.25). Two of the probe's own claims were
    wrong and it caught them: a single example chosen by hand landed 0.002 units from a line by luck, and
    the sweep then showed the local snap is on a line in 32 of 384 half-coordinate cases by coincidence
    — never agreeing with the board snap in any of them.
  - **AND THE MAGNET HAS TWO TIERS, BECAUSE HALF POSITIONS ARE WHERE THIS DANCE'S COORDINATES LIVE.**
    The caller asked for the half grid as well, and the measurement agrees with them: 61% of the corpus's
    authored coordinates sit on half units against 46% on whole ones, so a magnet that only knew the
    drawn lines would refuse the position the assets use most. The whole grid pulls from a quarter of a
    cell and the half grid from half that, so a DRAWN line wins wherever they compete; MEASURED, of 1000
    positions across two cells 496 are pulled to a drawn line, 248 to a half position and 256 are left
    free — sticky enough to help, free over a quarter of the cell. Recorded rather than glossed: NOTHING
    IS DRAWN at the half positions, so a half-snapped point sits midway between two lines. That is a real
    place in the dance's vocabulary rather than an arbitrary point, but it is not a place the grid shows,
    and two tiers is the honest way to say both things at once.
  - **AND THE PROBES NOW RESOLVE THEIR PATHS FROM THEIR OWN FILE.** They read the POC's assets and source
    through `process.cwd()`, which made them runnable only from `poc/` — `node poc/tools/x.mjs` from the
    repository root died with ENOENT and looked like a broken probe rather than a misplaced one. Found
    because running all five in one loop from the root turned four of them red. (The dynamic engine import
    also needed a `file://` URL: a bare Windows path is not a valid ESM specifier.) All five now run from
    either directory.
  - **THE `arc` CHECKBOX LOCKS A CURVE TO A QUARTER OF A CIRCLE OR AN ELLIPSE.** The geometry is the
    engine's (`arcBezier`, `arcOf`, `arcIsCircle`, `arcCorner`, `arcBlocker`, `projectToArc`,
    `setMoveArc`) and it is gated in `editor/test/editor.mjs` section 17, because that is where
    geometric decisions live in this codebase; the panel only wires it. A quarter arc's two end tangents
    are PERPENDICULAR — they are tangents at two radii a quadrant apart — so the family is the start
    direction plus two lengths, and the endpoint follows to the conic's corner. **The quadrant keeps the
    curve's own handle directions**: nothing about which way the dancer travels or faces changes, and
    only the endpoint moves. The cubic is the standard k = 4/3(sqrt2 - 1) construction, a circle to
    **2.73e-4** of the radius — the best a cubic does.
  - **THE LOCK IS EDITING STATE, NOT DATA, AND IT FOLLOWS THE SELECTION.** The `<tam>` format has no
    "this is an arc" flag and inventing one would be a field the assets cannot read, so the flag is a
    mode keyed to the curve being edited: whenever the tile is built for a different (dancer, move,
    curve) it is re-initialised FROM THE DATA, so a curve whose numbers already are a quarter arc comes
    up locked and the panel cannot claim a curve is free when it is not. Unticking releases the fields
    without touching the curve.
  - **THE TWO HANDLE LENGTHS ARE THE WHOLE SHAPE**, so they are the two fields the tile offers (`arc x`,
    `arc y`) while the five coordinates are locked — the same `locked` styling the group gate uses, and
    for the same reason: one set of numbers cannot describe the curve any more. The readout names the
    shape, which is the rule as asked for: **a circle if the two offsets are equal, otherwise an
    ellipse** (`arcIsCircle`, with a RELATIVE tolerance because the lengths come from a subtraction and
    a `Forward`'s two handles differ by one ulp — 0.333 against 0.33300000000000002 — which an equality
    test would call an ellipse).
  - **A DRAG IN ARC MODE CAN ONLY CHANGE A LENGTH.** r1 slides along the start direction, r2 along the
    finish one, and r3 — the corner — sets both at once, so nothing a handle can do takes the curve off
    the family. That is what "locks out manual editing" means: not that the handles stop working, but
    that they cannot break the shape.
  - **AND THE CHECKBOX IS DISABLED, WITH THE REASON ON SCREEN, WHEREVER A QUARTER ARC IS IMPOSSIBLE —
    THE CALLER'S SECOND CORRECTION, AND IT IS THE COMMON CASE.** Two situations, separated because they
    call for different things: the handles are **not at a right angle** (locking such a curve would have
    to turn the dancer, and the lock refuses rather than doing it in silence — the tile prints the angle
    it measured), and there is **no handle length to size from** (a `Stand` has every coordinate zero,
    so the panel says that rather than inventing a size; where only ONE handle is zero, the other's
    length is the hint and the arc comes out a circle). A third refusal — a facing curve whose start
    handle points backwards — never fires on the corpus and is recorded as a guard. MEASURED over
    b1/ms/a1's **4150** curves: **0** already quarter arcs, **690 (16.6%)** lockable, and blocked
    **2968 (71.5%)** by the angle plus **492 (11.9%)** by having no handle length. So the disabled state
    is the COMMON one, and a dead checkbox with no explanation would have been the normal experience.
    Two of the probe's own claims were killed by its first runs and are recorded: `arcOf` called the
    degenerate all-zero member of the family an arc and counted **138** corpus `Stand`s as "already
    arcs" (zero, once the no-shape case is refused), and the projection's circle test was an equality
    that the ulp above broke.
  - **THE PROJECTION IS CHECKED TO PRESERVE WHAT MATTERS.** Both handle lengths and both directions are
    kept exactly and only the corner moves; a rotated arc is the unrotated one turned by its angle
    (worst **4.6e-16**); a projected arc sets off and finishes facing EXACTLY as the original curve did;
    a facing arc turns the dancer exactly a quarter turn (90.0000deg); the disable reason and the
    projection agree on every witness (the panel's enabled state and its ability to project are one
    question, asked once); and the arc survives export and re-parse with re-exporting byte-identical.
    Typecheck clean; all four POC probes green; `poc/verify.cjs` the same 3 pre-existing Pass Thru
    failures; the FULL engine gate green (23 harnesses).
  - **DRAGGING A CONTROL POINT ALSO DRAGGED THE BOARD, AND THE CAUSE WAS TWO QUESTIONS SHARING ONE
    VARIABLE.** `setControlsEnabled(false)` silences the camera for the length of a Bezier drag — but the
    drag RE-RENDERS ON EVERY POINTER MOVE, and that path is `updateCall` -> `applyDisplay` ->
    `setView2D`, which wrote `controls.enabled = !on` and therefore re-enabled the camera in the middle
    of the gesture. The panel's own pointermove handler runs FIRST, so by the time OrbitControls' handler
    ran on the same event the controls were live again and the board panned under the point being
    dragged. "Which view is on screen" and "is camera input suppressed right now" are now two facts:
    `inputSuppressed` is the caller's, `setView2D` decides only WHICH control set it applies to, and a
    view switch can no longer resurrect the camera mid-gesture.
  - **AND THE FAULT IS REPRODUCED, NOT JUST FIXED.** `node poc/tools/view2d-probe.mjs` section 5 drives
    three's own OrbitControls through a fake canvas IN THE ORDER THE BROWSER DELIVERS THE EVENTS: the
    camera is LIVE at pointerdown, because OrbitControls registered its listener when the stage was built
    and therefore runs before the panel's. The view moves **0.0000** units with the fix and **3.13**
    with the rule it replaced — the second number is the regression test, because a check that cannot
    fail on the bug is decoration. THE PROBE'S OWN FIRST VERSION PASSED THE NEGATIVE CONTROL BY
    MISTAKE: it suppressed input before dispatching the pointerdown, which lets OrbitControls decline the
    gesture entirely, so nothing could pan however the view switch behaved. The ordering was the whole
    mechanism, and getting it wrong made the instrument silent rather than wrong.

**DOES THE ENGINE SUPPORT ARRANGEMENTS, OR ONLY FORMATIONS?** Asked directly, and the answer is
**both, in two disconnected systems**:

- **Formations**: `boardForFormation(name)` gives GEOMETRY plus each slot's declared GENDER, and
  nothing else. Identity (id/couple) is stamped only when the geometry matches the home square
  (`boardFromMatchables`), so **129 of the 134 named formations carry NO identity at all** —
  `couple: UNKNOWN_COUPLE` for all eight, which means no partner, no corner and no sequence. Measured
  by the new `engine/test/tools/arrangement-probe.mjs`.
- **Arrangements**: `alignment.ts` is the real machinery — All8's formation LETTER, arrangement
  NUMBER 0–5 transcribed from All8's published tables, sequence and relationship — and
  `boardForFasrCode('L1p', template)` builds a **fully identified** board (8/8 identity, sequence in)
  from a published code alone.

So `Static Square`'s arrangement is **not** a coincidence: `HOME_DANCERS` in `identity.ts` is authored
data naming every dancer's couple, gender and pose, and `analyzeFasr` reads partner and corner off it
for all eight. It is simply the ONLY arrangement the formation library carries.

Two things in this engine are also both called "arrangement" and they are not the same: `analyzeFasr`'s
field is a **prose count** (`"8 dancers (4 boys, 4 girls), 0 couples"`) that cannot tell `gBgB` from
`BgBg`, while `alignment.ts`'s is the Callerlab number. Worth renaming the first.

### A FASR SETUP PER FORMATION, AND A COMPLIANCE LEVEL PER MODULE (THE WIRING IS BUILT AND GATED)

**STATUS. This is DONE for the setup path and the FSM, and `boardForFormation` was deliberately left
alone.** Items 1 and 2 of the shape below **SHIPPED** — `FORMATION_SETUP_CODE` (10 keys), `setupForFormation(name,
templateFor)`, `compliesWithSetup(board, setup, level)`, `coupleToSpot` — and they are gated by
`test/tools/setup-registry-probe.mjs` (26/26 canonical, `L1o` a zero line by property, every entry reading back
as its own code with 8/8 identity).

The gap was never the model, it was that **nothing in production called either function**. Commits
`194414a` (the primitive + its gate), `cd06ef6` (the wiring) and `aa76148` (the FSM's state boards) close
it. `compliesWithSetup` still has **no production caller** — that is item 2's *matching* half and it is the
only piece of this section still outstanding (see "WHAT IS STILL OPEN" below).

**THE APPROVED NEXT STEP: CANONICAL IDENTITY ON THE STATE BOARDS.** Where the engine can name a formation's
zero setup by authority, the board it stands up for that name should carry the canonical couple numbering, so
the board reads an arrangement/sequence/relationship and couple-based calls work from it. Where it cannot,
behaviour is unchanged (anonymous). This closes the symptom `setup-path-probe.mjs`'s own header quotes — *"when
I apply a module or a Call to a sequence and it is the first item… always use the zero, all in-sequence FASROO
to setup the dancers"* — and it is scoped by "when possible":

```
FSM states                                     65 (42 named, 23 @embed)
  named states the registry covers              4   Static Square, Normal Lines, Normal Lines Compact, Eight Chain Thru
  offered formations                           134, of which 129 ANONYMOUS
  lettered names differing from their zero code  8 of 9
```

**This is NOT a vocabulary-wide change and it CANNOT cell-key the FSM** — that is refuted above (only 4 of 42
named states are covered, and the motivating pair shares its geometry *and* its pattern). It is a capability on
the formations that HAVE an authority-backed setup, plus the wiring of a built-but-unused path.

**D2 WAS WRONG AND THE TREE SAID SO BEFORE ANY CODE WAS WRITTEN.** The approved plan said to split
`boardForFormation` into an anonymous body plus a registry-consulting wrapper. Measuring first showed the
premise was false on two counts:

1. **The app does not set up from `boardForFormation`.** The Set dropdown is
   `sequencer-ui.ts::setBoardFormation -> seq.setSetup -> boardForSetup`, and the module start is
   `replayModule -> boardForSetup`. A *sibling* for the identified path already existed and was already
   wired; D2 would have built a third.
2. **`boardForFormation` IS an instrument.** ~60 probes and harnesses call it as the anonymous path on
   purpose — `zero-line-probe.mjs`'s header says *"`boardForFormation('Normal Lines')` is `[L0]` by its
   GENDER pattern, but it carries NO identity"*, `view-gender-probe.mjs` calls it "the letter-L TEMPLATE",
   and `setupForFormation`'s own `templateFor` must be anonymous or the membership test is self-referential.
   Making it identified would have destroyed the contract a second time.

So the target was corrected to where the wiring actually is, and **the failing path was measured before it
was fixed**: `boardForSetup` derived the setup from the formation's letter alone (`<letter>1`), which is
arrangement 0 and sequence 1 but names **no relationship** — and a code with no relationship cannot pin a
board, because one code's enumeration admits four boards differing only in which couple stands where. So
`canonicalBoard` found no index and fell back to `boards[0]`. **It agreed with the registry on 3 of its 10
keys, and `boardForSetup('Normal Lines')` came back reading `0L1p` where the zero line is `0L1o`** — the
reported symptom, live. It is 10 of 10 now.

**THE THREE DECISIONS THAT SURVIVED, plus the one that replaced D2:**

- **D1 — `setupForFormation` is the SINGLE SOURCE.** Not `letterForFormation(name) + '<letter>1'`: the registry
  carries the couple-to-spot assignment (which a code cannot), uses the deliberately chosen codes (`L1o`, not
  `L1`), and fails loudly when a named relationship was never measured. No entry ⇒ no identity.
- **D2 (as built) — `boardForSetup` consults the registry FIRST and keeps the letter derivation as the
  FALLBACK, and `boardForFormation` is untouched.** The fallback is a measurement, not caution: the registry
  covers 10 names and the app offers 134, and **five** formations (`Double Pass Thru`, `O Eight Chain Thru`,
  `O In`, `O Out`, `O Trade By`) get a correct identity from the letter path that the registry has no entry
  for. So the change is ADDITIVE — nothing that had identity lost it — and three compact variants that were
  ANONYMOUS became identified (`Normal Lines Compact`, `Two-Faced Lines RH Compact`, `Ocean Waves RH BGGB
  Compact`), because the registry takes the NAME's own geometry as the template instead of the letter's
  first template. Wired-path identity count: **10 of 134 offered → 13**.
- **D3 — DANCER ORDER IS PRESERVED.** `boardsForAlignment` returns boys-then-girls in LATTICE order, which is
  not the template's order; the POC binds avatars by array index, `applyToBoard` preserves order, and
  `collapseModule` keys matrices by dancer `id`. So the registry's `board` is NOT returned: its assignment is
  applied by `identifyByAssignment(board, assignment)`, which overwrites `id`/`couple`/`gender` and nothing
  else, keyed on `spotKey` (now shared with `coupleToSpot`/`rotationBetweenBoards` so producer and consumer
  cannot drift). **All-or-nothing**: a dancer it cannot resolve returns the board UNCHANGED, because half a
  board with couples reads as a sequence it is not.
- **D4 — ONE RULE FOR BOTH THE SETUP PATH AND THE FSM.** `buildFsmTable.enumerate` identifies the state's OWN
  geometry (`setupIdentifiedBoard`) for named states the registry covers; `@embed#N` has no name and the other
  38 named states have no authority-backed setup, so they stay anonymous — which is what keeps the refutation
  above intact. It is **four states**, not a vocabulary.**

**THE MEASURED RESULT OF D4, and the state count is the gate rather than the outcome:**

```
states            65 -> 65     IDENTITY CHANGES NO GEOMETRY, and `enumerate` never invents a state.
                               A state-count change here would FALSIFY the premise, not record a result.
edges             2260 -> 2308  (+48, from exactly THREE states)
  Normal Lines          +17     Normal Lines Compact  +15     Eight Chain Thru  +16
readings  whole    1174 -> 1222   full-tiling 665 (same)   partial 421 (same)
endKind   state    1619 -> 1651   novel 624 -> 640   out-of-scope 17 (same)
targeted share     71.6% -> 71.5%
```

Every one of the 48 is a `Heads ...`/`Sides ...`/`Beaus`/`Belles`/`Couples` call — the couple-dependent
vocabulary. **Identity is what it READS, so an anonymous board REFUSES calls that are legal from the real
formation**: `Normal Lines` 347 → 403 legal calls, `Ocean Waves` 456 → 483, `Two-Faced Lines` 305 → 314,
`Eight Chain Thru` 249 → 299. **All gains, no losses.** The FSM was answering *"this call is not legal here"*
for calls the engine could not read.

**TWO HARNESSES HAD GONE SILENT, and both are now instruments again rather than re-pins:**

- **`reading-census` was rebuilding the state boards through `boardForFormation`**, so the 48 new edges were
  not legal from *its* board and were counted `excluded` — **a number it REPORTED but never asserted**. The
  cross-check it exists for shrank from 1857 to 1809 edges without anything going red. It uses `stateBoard`
  now (compared **1857 = 1809 + 48, excluded 0**) **and asserts the exclusion**, because a cross-check that
  silently shrinks is the instrument's silence, not a smaller cross-check.
- **`cell-census` asserted the OPPOSITE of what is now true** — *"the FSM state reads no sequence (no home
  identity: couples all 0)"*. It sweeps its own board now, and the refutation of arrangement-keying comes out
  **stronger**: `[B1c]` and the `Eight Chain Thru` node have the IDENTICAL cell key `26|BgBgBgBg|1|c`, so an
  arrangement key would **MERGE** them rather than separate them. The only thing that ever separated them was
  the missing identity, and no arrangement key would have supplied that either. Its pins move with it and the
  movement is itself the result: **fully-readable cells 22 → 103, lettered cells 50 → 112**, applications
  1885 → 1933, geometries reached 643 → 670.

**THE LESSON, since the same shape has now cost this repo three times.** `boardForSetup` and the FSM both
derived the same named formation by different routes and disagreed; `reading-census` and `cell-census` both
restated a rule the engine already had and went stale when it changed. The fix each time was to make ONE place
own the rule (`setupIdentifiedBoard`) and let the consumers ask for it (`stateBoard`) — and to **assert the
number that measures the silence**, not just print it.

**WHAT IS STILL OPEN in this section:** item 2's *matching* half — `compliesWithSetup` is built, gated and
called by nothing, so a module label like `Zero Line` is still resolved without checking the board complies.
That is where item 3 (matching should be able to REQUIRE an arrangement) belongs, and it is the risky third.

**A NEW, SEPARATE FINDING, unrelated to identity but found while gating this: the `Circle` state is an
ISLAND.** Every edge into `Circle` in the ms FSM comes from `Circle` itself, and `Static Square` has zero
edges to it — even `Circle Left` from a square ends on `Static Square`. So **"from Static Square, hold hands,
ladies in, men sashay" is not a supported sequence**, and the blocker is not the figure: `Ladies In, Men
Sashay` is legal from a Circle, matches a variant at error 0.0000, and the FSM records it as
`Circle -- Ladies In, Men Sashay -> Circle`. The engine models `Circle` as its own geometry (8 points equally
spaced on a radius-2.61 circle, rotated 22.5°) while the squared set is the square outline at radius 3.16, and
joining hands moves nobody — so the board stays a squared set and never matches the `Circle` state. **In the
dance the squared set IS the circle you circle left in.** Gated by `test/tools/ladies-sashay-probe.mjs`, with
both answers pinned and its two limits recorded (the two tams differ only in `from`, which is not a formation
the engine builds, so the first match always wins; and `Circle` is anonymous, so a circle has no sequence,
relationship or partner — `Circle` has no All8 letter, so there is no FASR code to set it up by).

**THE FOUR GATES THAT WERE EXPECTED TO FLIP DID NOT, AND THAT IS A CORRECTION WORTH KEEPING.** The
approved plan named four harnesses as pinning identity's ABSENCE — `alignment.mjs:550` (`Double Pass Thru`
[P] refused an orientation), `behaviour-audit.mjs:562` and `:674` (`Two-Faced Lines` [F]), `promenade.mjs:174`
(`Normal Lines` [L] template refused) — on the reasoning that all four use a LETTERED formation and so would
be identified once `boardForFormation` was. **They all still pass unchanged, because `boardForFormation` was
never changed** (see D2 above). They pin the absence of identity on the ANONYMOUS template, which is exactly
what those harnesses need, and re-pointing them to an unlettered formation would have been churn. **Do not
re-litigate this:** the gates are correct as they stand, and the positive case they were to gain lives in
`canonical-identity-probe.mjs` §1b/§5 and in `setup-registry-probe.mjs` instead.

`setup-path-probe.mjs`'s `[arr/seq/rel]` column **had been broken for every row since it was written** — it
called `seq.alignmentOf(b)`, which does not exist on `Sequencer`, inside a try/catch that turned the TypeError
into the string `'error'`. Both sides of every comparison were `'error'`, so the column equalled itself and
the `same`/`DIFFERS` verdicts beside it were decided by the identity count and the formation name alone.
Rebuilt from the shipped readers and pinned at the measured **129 anonymous / 8 differ / 1 same**. (A missing
method is a load-time error, not a runtime one — nothing failed loudly, which is the only reason it survived.)

**ACCEPTANCE, met:** the registry keys are identified 8/8 with the anonymous board's pose and dancer ORDER
preserved (`canonical-identity-probe.mjs` §1b and §5, `setup-registry-probe.mjs`); `fsm-asset` /
`reading-census` / `cell-census` re-pinned with the measured deltas above and the **state count unchanged at
65**; `npm run verify --prefix engine` green (31 harnesses) and `npm run verify` green; `tsc -p poc --noEmit`
clean. The POC probe suite also had to be run with `--all` for this, which found a bug in the runner itself —
it leaked its own `--all` flag into the probes' `argv`, so the two probes that take a call name from `argv[2]`
were being asked for a call titled `--all` and the slow tier was checking them LESS than the fast tier
(`ed7460c`).

**The gap.** A corpus label like `Zero Line` names a formation **and an arrangement**, and the engine
can only associate the first with a name. `boardForFormation('Normal Lines')` classifies as `[L0]` and
is still not a zero line: no identity at all, and its couples are authored **1,4,3,2**. Worse, the
POC's first fix resolved the label to that name and produced a board in the WRONG COUPLE ORDER — which
is the reported symptom, and it looked right because arrangement 0 only fixes the GENDER pattern.

**The shape of the fix, and it belongs in the engine's formation model, not in the POC:**

1. **A canonical FASR setup per formation.** `FASR_SETUP: Record<formationName, code>` in
   `alignment.ts` — the All8 `[arrangement]LETTER[sequence][relationship]` code that stands that
   formation up in its zero arrangement. Then `boardForFormation` (or a sibling) can return an
   IDENTIFIED board, and `analyzeFasr` stops reporting `sequence: unknown` for every named formation.
   `Normal Lines` → `L1o` is the first entry and is confirmed.
2. **A compliance level per MODULE, not only per formation.** The corpus's label is a REQUIREMENT:
   some modules run from any board with the right geometry, some need the arrangement, some need the
   couples in sequence, some need partner/corner intact. Today nothing can express that, which is why
   the wrong board was accepted silently. A level (`formation` | `arrangement` | `sequence` |
   `relationship`) checked against the start board, failing loudly, is the missing half.
3. **Matching, not just setup.** `matchFormations` matches geometry and facing; if a call's setup is
   authored in a particular arrangement, matching should be able to require it. That is the risky
   third of the three — `matcher.ts` already records that a reflection must never be allowed to
   decide an arrangement — and it should come after 1 and 2.

**Is the canonical entry DERIVABLE, so the table need not be hand-written?** Measured by the new
section of `engine/test/tools/zero-line-probe.mjs`, on the rule "sequence IN and every facing couple
pair is a CORNER pair" (`corner(c) = c+3`, so the pairs are `{1,4}` and `{2,3}`):

```
[B  ] Eight Chain Thru    -> NO code satisfies it
[L  ] Normal Lines        -> L1o (in, pairs 1-4 2-3)   |  L2p (out, pairs 1-4 2-3)
[W  ] Ocean Waves         -> NO code satisfies it
[P  ] Double Pass Thru    -> NO code satisfies it
[F  ] Two-Faced Lines     -> NO code satisfies it
[L.F] Two-Faced Lines LH  -> NO code satisfies it
```

So the rule is **right for `[L]` and incomplete for the rest**: in a wave, a box or a double pass
thru, "the dancer you face" is not a straight-ahead pairing, so the property has to be stated per
formation before it can be checked. That is the argument FOR a declared per-formation setup rather
than a universal rule — and it is why `Zero Box` is currently left UNRESOLVED and fails loudly.

### WHAT ALL8 ACTUALLY SAYS, AND A CONFLICT WITH `boardForFasrCode` (fetched, not inferred)

`https://www.all8.com/sd/calling/fasr.htm` and `/getoutd.htm`, Rich Reel. The authoritative facts:

- **`[B1c]` IS NAMED "ZERO BOX"** — verbatim from its get-out diagram: *"Facing Corners / ZERO BOX /
  AL BOX / Box 1-4 / 'AL'"*. So the zero box is a stated code, not something to derive. That closes
  the `Zero Box` question once the convention below is settled.
- **The arrangement number is the GENDER pattern**, six states 0/5/1/2/3/4 (`\u00bd` is 5 here), and it is
  assigned per formation — "the assignment depends on the specific formation".
- **Sequence** is the promenade-direction order of the couples, 1..4 (1 both in, 2 both out, 3 boys in
  / girls out, 4 the reverse), measured by connecting the same-gender dancers without crossing; in a
  wave, "Rear Back" first.
- **Relationship** is `p`/`c`/`o`/`r`, and all8's own texts state the reference pair for exactly the
  four formations the engine implements: `[0L]` the **left-hand couple**, `[0B]` the **outside boy and
  the girl he is facing**, `[0F]` the **trailing couple**, `[0W]` the **in-facing end and the adjacent
  girl**. all8 also warns the letter "unfortunately" depends on that choice.

**THE CONFLICT — RE-MEASURED AND NO LONGER TRUE.** This entry recorded: all8's text diagram for `[L1p]`
has facing couple-pairs `{2,3}`/`{1,4}`; "the engine's `boardForFasrCode('L1p')` produces `{1,2}`/`{3,4}`,
and it is `L1o` that produces `{2,3}`/`{1,4}`", therefore the engine's relationship letter for `[L]` was
offset by one from all8's. `test/tools/l1p-conflict-probe.mjs` checks it against the fixture's own
diagram and reads BOTH fields, and the claim does not hold today:

```
code     all8 pairs   engine pairs   same?
L1p      1-4 2-3      1-4 2-3        YES
L2p      1-4 2-3      1-4 2-3        YES
L4r      1-1 2-2 3-3 4-4  1-1 2-2 3-3 4-4   YES
L3c      1-1 2-2 3-3 4-4  1-1 2-2 3-3 4-4   YES
5L1p     1-4 2-3      1-4 2-3        YES
5L2p     1-4 2-3      1-4 2-3        YES

all8's diagram           3B(id1) 2G(id4) 3G(id2) 2B(id3) 4B(id7) 1G(id6) 4G(id8) 1B(id5)
boardForFasrCode('L1p')  3B(id1) 2G(id4) 3G(id2) 2B(id3) 4B(id7) 1G(id6) 4G(id8) 1B(id5)
boardForFasrCode('L1o')  4B(id7) 1G(id6) 2G(id4) 3B(id1) 1B(id5) 4G(id8) 3G(id2) 2B(id3)
```

**What the entry was actually seeing, and why that matters more than the correction.** The `{2,3}`/`{1,4}`
it attributes to all8's diagram is not what all8 DRAWS — it is the *identity* (`id`) reading of the
engine's own board, printed by the probe that recorded the entry. `couple` and `id` are different fields:
`couple` is the board's own numbering (which a FASR code does **not** pin — that is the orientation
freedom) and `id` is the home identity. All8's diagram assigns couple numbers, so the diagram's **couple**
field is the authority, and on that field `L1p` reproduces the page character for character while `L1o`
does not (same facing pairs, different couples). So the offset the entry reported was a field confusion
in the instrument, not a disagreement with all8 — and the standing lesson is one this file already
carries in another form: a probe that reads the wrong field will agree with itself and prove nothing.

That retires the second half of the entry as well: `boardForFasrCode` is no longer a search whose answer
happens to satisfy the code, because it now selects All8's own board through the measured
`CANONICAL_INDEX` (see the SETUP section above), and `all8-format.mjs` gates the COUPLE placement on all
26 published diagrams rather than only the identity-free geometry.

**`Zero Box` is therefore no longer refused on this ground** — `boardForFasrCode('B1c')` now stands up
All8's own board and agrees with the setup registry, so the reason the entry gave for keeping it out is
gone. **AND IT IS NOW WIRED, MEASURED FIRST.** `poc/src/modules.ts` maps `'zero box' -> { code: 'B1c' }`
and `LETTER_TEMPLATE` gained `S: 'Static Square'` (without it an `[S]`-coded label is told the engine has
no template for a formation it has). `test/tools/zero-box-probe.mjs` measured the switch before making
it, over the corpus's own `Zero Box` modules:

```
from the [B1c] board:  54/324 replay all the way   stops: Left Allemande (33), Trade (22), Pass Thru (19), Circulate (17)
from home:              0/324 replay all the way   stops: Swing Thru (97), Veer Left (20), Centers In (16), Slide Thru (14)
```

The second line is the "wrong start" signature this file warns about — `Swing Thru` from a square is
what a zero-box module meets first when danced from home — so the label demonstrably matters, and the
board that resolves it is demonstrably better. The 270 that still stop from `[B1c]` are the engine's
ordinary coverage gaps, the same class the get-out corpus reports, not a mis-set board. `Zero Box` is
also All8's own name for the code, verbatim from its get-out diagram: *"[B1c] ... Facing Corners / ZERO
BOX / AL BOX / Box 1-4 / 'AL'"*, and `relationshipStateOf(board, 'B')` reads `c` on exactly that board.

**THE STOPPING CALLS, DIAGNOSED — and the two biggest are NOT the same kind of thing.**
`test/tools/zero-box-stops-probe.mjs` classifies every stop by WHY it stops, because three causes look
identical in a count and are owned by different work: NAMING (no title), ENGINE (the call exists and
will not apply), and CORPUS (the module's own step is not a call name). Of the 270 modules that stop:

- **`Left Allemande` (33) was PURE NAMING, and is now BRIDGED** — `CALL_SYNONYMS` maps it to
  `Allemande Left`. The evidence is the repo's own: `all8-notation.ts` records `LA` as "Allemande Left"
  while its comment calls that token "Left Allemande" out loud. **Measured effect: the `Zero Box` corpus
  goes 54 → 76 modules replaying all the way**, census (116) and get-out (124) unmoved. The 11 stops
  that still name `Left Allemande` are a DIFFERENT cause — the call is reached on an UNNAMED board, so
  the engine refuses it there; that is the unrecognised-board bucket, not a naming gap.
- **The rest of the "Left Allemande" entries are CORPUS DATA, not naming.** Ceder's own comments are
  concatenated into the step string: `Left Allemande This is a ZB-ZB module just before the Left
  Allemande.`, `Left Allemande After the Square Thru 3/4 the Formation = 8ChT (0) and ZB.`,
  `Left Allemande Lines of Four facing out.`, and even a literal
  `*** not validated *** (Zero Box) Swing Thru`. Nothing in the engine should resolve those.
- **`Trade` (22) is the biggest GENUINE item, and an attempt to derive it was made and REVERTED.** The
  bare `Trade` is real: All8 authors it `from="Right-Hand Waves"` with FOUR `Swing Right` paths,
  `from="Left-Hand Waves"` with four `Swing Left`, and from `Inverted Lines` too — eight dancers moving
  in four pairs. The corpus uses it in **85 modules**, and the board it is called FROM is not the start
  label: `Ocean Waves` 26, `Completed Double Pass Thru` 7, `Two-Faced Lines` 6, `Tidal Wave` 3,
  `Lines Facing Out` 3, `Quarter Tag` 2, `Two-Faced Tidal Line RH` 1, `3/4 Tag` 1.

  **What was tried:** designate every dancer and reuse `tradeRule`, with a precondition that every
  dancer has a partner beside them. It made the `Zero Box` corpus go 76 → 83 modules — and it was
  WRONG, caught by two harness gates rather than by the corpus. Measured afterwards
  (`test/tools/trade-whole-set-record-probe.mjs`):
  - **it applied from 126 of the 134 named formations**, `Static Square` included, because "every dancer
    has someone beside them" is true nearly everywhere and the parity rule then always finds a partner.
    A derivation covering 94% of formations is not a reading of the call.
  - **it paired DIFFERENT GENDERS, 2 apart, on a wave**, because `tradeRule`'s rule is "the nearest other
    trader" and on the engine's wave template the nearest is 2 away, not 4.

  **The trap, recorded so it is not re-entered:** the invariant "leaves an `Ocean Waves` with every
  gender in its original spot" is satisfied by ALL THREE candidate pairings — same-column 2 apart,
  across-column 4 apart, and same-gender — and they are **different boards**. Only the across-column one
  is consistent with the authored motion, since `Swing Left` is defined as `Run Left hands="gripleft"`,
  i.e. a pair 4 apart. So the cheap invariant does not identify the pairing, and the corpus's
  module count improving was the wrong reason to believe it.

  **A correct derivation needs two things, and neither is in hand:** (a) the PAIRING the call means on
  each board, from a source rather than chosen; and (b) a precondition false for the 126 formations
  where a bare `Trade` is not that call. It therefore REFUSES everywhere, as before — reverted in full,
  with the engine source otherwise untouched.

**AND A DIFFERENT KIND OF FINDING, worth knowing before chasing more of this list:** of the ~30 distinct
stopping strings in the `Zero Box` corpus, a third are not call names at all — Ceder comments and
`*** not validated ***` markers that were concatenated into the step, or prose naming a formation. The
engine-side residue is the ENGINE class below, and it is smaller than the raw stop count suggests.



### WHY `[L1p]` DISAGREED: THE CODE NAMES FOUR BOARDS, AND THE ENGINE TOOK THE FIRST

**STATUS: CLOSED, and the measurements below stand — only the "disagrees" part is historical.** The
diagnosis was exactly right and is worth keeping: a code admits four boards and the engine took the
first. What has changed since is the SELECTION. `boardForFasrCode` now picks All8's own board through
the measured `CANONICAL_INDEX` (SETUP section), so no caller sees the disagreement any more, and the
bullet below that says all8's board is "index 1 of the 4" is still true *for `[L1p]`* while the general
rule turned out to be a per-code table rather than an index.

Measured by `engine/test/tools/fasr-determinism-probe.mjs`, and it is NOT the indexing hypothesis:

- **Every code admits exactly 4 distinct boards** (`L1p`, `L1o`, `B1c`, `W1p`, `F1p`, … all 4). So a
  plain FASR code **does not determine a board**. **CORRECTED: `P1c`/`P2r` "admit 0" was a
  consequence of the missing `[P]` relationship rule, not of the enumeration** — with All8's own
  mental-Centers-Pass-Thru convention recorded (see the `[P]` SETUP entry below) every `[P]` code
  admits its 4 as well, and All8's own board is at index 0 of them.
- **`boardForAlignment` returns `boards[0]`** — the first of the four, chosen by enumeration order.
  That was the whole of the disagreement with all8's diagram, and it is why `boardForFasrCode` no
  longer routes through it.
- **all8's own `[L1p]` IS in the set**: 2 of the 4 boards have its facing pairs `{2,3}`/`{1,4}` with
  partners adjacent. The engine's old pick had `{1,2}`/`{3,4}`. Both satisfy "0L1p"; they are different
  boards. **The facing pairs here are read off the IDENTITY field**, which is what made this look like
  an offset in the relationship letter — see the correction above; on the COUPLE field, which is what
  All8's diagram actually prints, the engine's `L1p` board reproduces the page.
- **The template's ARRAY ORDER changes nothing.** Reversing and rotating the template gives the
  identical 4 boards and the identical `boards[0]`. So dancer indexing does NOT leak into the
  alignment construction.
- **The 4 boards are the 4 ORIENTATIONS.** Relabelling every couple `c -> c+k (mod 4)` for k=1,2,3
  maps `boards[0]` onto the other three. So the freedom the code leaves is the whole-set rotation.

That last point is exactly what all8's own page says about it: FASR alone is **not** "Total FASR" —
resolving dancers "at home" additionally needs **Orientation** (0/90/180/270°) and **Occupation**
(Head/Side), which all8 marks as *not officially recognized by Callerlab*. The engine has no
orientation anchor, so `boards[0]` supplies one silently.

**AND ALL8'S CANONICAL BOARD IS ALREADY IN THE SET — index 1 of the 4.** The probe now renders the
four the way all8's `getoutd.htm` draws them, and the comparison is exact:

```
all8 getoutd.htm says:   3> 2< | 3> 2< | 4> 1< | 4> 1<
  [0] <- what boardForAlignment returns   4> 3< | 4> 3< | 1> 2< | 1> 2<
  [1]                                     3> 2< | 3> 2< | 4> 1< | 4> 1<   *** THIS IS ALL8'S ***
  [2]                                     2> 1< | 2> 1< | 3> 4< | 3> 4<
  [3]                                     1> 4< | 1> 4< | 2> 3< | 2> 3<
```

all8 is the canonical form and the Taminations-derived board is an arbitrary FASR of the four — but
NOT the one used at the start position. So nothing has to be authored: `boardsForAlignment` already
computes it, and only the SELECTION is wrong.

**A CANDIDATE SELECTION RULE, TESTED AND REFUTED.** The guess was "pick the relabelling that puts each
couple on the side of the formation nearest its home position" (orientation 0, all8's own notion).
`engine/test/tools/fasr-determinism-probe.mjs` transcribes **all six** \([L]\) diagrams all8 publishes
and checks the rule against every one:

```
code    all8 index   rule index   rule picks all8?
L1p              1            0   NO
L2p              2            0   NO
L4r              1            0   NO
L3c              2            0   NO
5L1p             1            0   NO
5L2p             2            0   NO
```

**0 of 6.** The rule is not merely unproven, it is wrong — and worse, it is ill-posed for a line
formation: the four couple centroids sit at the four DIAGONALS (±45°, ±135°) while the home bearings
are the four cardinals, so every board scores almost the same and the metric degenerates to
enumeration order. Do not build on it.

**SETUP vs FASR — the terminology names the missing piece, and it is measured.** all8's page opens by
saying callers call "a formation with the dancers arranged in a specific way" a **setup**, and that
"for 'at-home' choreography, two additional terms are required to fully specify the setup or Total
FASR": **Orientation** and **Occupation**. FASR identifies where the board IS, at any moment, for a
caller choosing the next call; it does not place the dancers absolutely.

Checked directly by `engine/test/tools/fasr-readout-probe.mjs`, on the four boards `[L1p]` admits:

```
positions+headings+gender per spot identical across all 4: YES
distinct couple-numberings among them:                      4
```

So FASR pins the formation geometry, the gender on every spot, the sequence and the relationships —
**everything except which COUPLE NUMBER sits on which spot**. That free part is exactly all8's
Orientation, and adding it is what turns a class of boards into an absolute setup. **This is what the
SETUP registry now supplies** (`setupForFormation`, above): the anchor is the couple-to-spot
assignment, and it is what `boardForFasrCode` selects with — so four different boards still read the
same `[0L1p]` honestly, and the engine now returns ALL8'S one rather than `boards[0]`.

**This is the correct name for the per-formation table.** It is not a "FASR setup" for a formation; it
is the formation's **setup** — FASR plus the couple numbering (and, if Head/Side designators are to be
interpreted, Occupation, which the engine also has no notion of).

**FASROO IS NOW IMPLEMENTED — `fasrooOf(board, formationName)`** (All8's `fasroo.htm`: FASR +
Orientation + Occupation, e.g. `[0L1pH+]`; Orientation `H`/`R`/`O`/`L` measured from the **boy of the
reference pair**, Occupation `+` Head / `'` Side; both marked *not recognised by Callerlab*; the terms
are Gero Teufert's, and Bill Davis called Orientation "Quadrature"). It is additive — a new export, no
existing path touched — and it does the job FASR cannot:

```
the four boards [L1p] admits, all reading the identical [0L1p]:
  board 0  [0L1pH+]      board 1  [0L1pL']   <- all8's canonical
  board 2  [0L1pO+]      board 3  [0L1pR']
```

Four distinct codes, one per orientation. **A 45-DEGREE ORIENTATION STEP WAS TRIED AND IS WRONG —
removed.** The reasoning was that a board can end half-rotated and would otherwise be indescribable;
but **Orientation is relative to HOME**, so the half-steps are not orientations at all. A board that
genuinely ends half-rotated is described by its FORMATION. `ORIENTATION_STEP_DEG` is 90, which is what
All8's four states are.

**WHY HOME HAS NO FASR(OO) TABLE — and it is not that home is outside the notation.** All8 lists `[S]`
as a formation letter ("Squared Set (Static Square)"). It NOW has the engine mapping and a transcribed
arrangement table (Step 2, above), so home reads `[0S1?]`; what it still lacks is a reference pair, and
that is a Step 3 question. The reason the TABLES originally skipped it is that **every component of the
notation is defined RELATIVE to home**:

- Arrangement **0** is defined as "Boy on the left, Girl on the right" — which IS the home arrangement.
- Sequence **1** is "in sequence" — which IS the home order.
- Relationship **p** is the reference boy adjacent to his **partner** — which IS home.
- Orientation **H** is literally "Reference Boy **At Home**".

So home's FASR(OO) is the constant `[0S1pH+]` — the identity element. The notation exists to say how
far a board has drifted from home so the caller can bring it back, and home is where the measuring
starts. All8's arrangement diagrams and reference-pair rules are for boards you have been CALLED to.

**It is not vacuous, though, and the engine's reading proves it.** `fasrooOf(home)` returns
`[??1???]`: only the sequence is determined, because the engine has no letter for `[S]` and so no
reference dancer. Two consequences worth having on record:

- A **half-sashayed** squared set is arrangement **5**, not 0, and a **rotated** home is Orientation
  ≠ H. Both are real states a caller may need, and neither is "home".
- The engine currently reads `[??1???]` for home AND for home-rotated, and **cannot tell them apart**.
  `[S]` is the one formation where the reference pair is unambiguous — at home every dancer has their
  partner by construction — so it is the cheapest place to add a letter, an arrangement table (0 and 5
  at least) and a reference pair, and it would make the two readings differ.

**HOME IS `[0S1p?+]`, NOT `[?S1???]` — the difference matters and the `?`s in our own output are a
lie.** (The `?S` half of this is now CLOSED: `[S]` is mapped and the table transcribed, so the engine
reads `[0S1?]` as an alignment and `[0S1???]` from `fasrooOf`. The relationship is the one part still
open, and it is open because no reference pair is recorded for `[S]` — not because home is vague.)
Every part except Occupation is determined *by definition*, not by measurement:

- **Formation is not open.** Home is a squared set — a definite geometry. (The `?` here in our output
  is the missing letter, not generality.)
- **Arrangement is not open.** Home is arrangement **0**; arrangement 5 is a half-sashayed square,
  which is a different setup. There is no arrangement in which home is home.
- **Sequence is not open.** Home is in sequence by definition.
- **Relationship is not open.** At home the reference boy is adjacent to his partner by construction.
- **Orientation is not open, and this is the strongest of the five**: Orientation is DEFINED as the
  reference boy's displacement from his home position, so at home it is zero → **H** by definition. It
  is true by construction rather than read off the board.
- **Occupation is the only genuinely open slot**, and not because home is vague: it reports whether the
  reference boy is a Head or a Side, and that needs a REFERENCE PAIR, which Callerlab defines for `[L]`,
  `[B]`, `[F]` and `[W]` only. Adopt all8's own convention — the #1 Head boy as the reference dancer —
  and it is `+`, giving **`[0S1pH+]`**.

So the answer to "is home more general" is NO for five of the six parts and yes only for Occupation.
Reading our `[??1???]` as "home has no FASR" would be the same mistake as reading a missing table as a
fact about the dance.

**THE LETTER IS `[S]`, AND OCCUPATION SPLITS "HOME" FROM "THE INITIAL SETUP".** Home as a STATE does not
need Occupation — the board does not care, and Occupation is a description relative to a reference pair
rather than a property of the board. The INITIAL Static Square SETUP does need it, because that is what
anchors the couple numbering: at home Orientation is trivially H, so Occupation is the only remaining
handle on which physical couple stands where, and it is the thing a caller relies on the moment a call
designates Heads, Sides or a couple number (All8's `Centers Star Thru; Back Away` ends at home either
way; `Heads Trade` does not).

```
home as a state       [0S1p]      no Occupation - the board does not care
the initial setup     [0S1pH+]    needs it - it is the couple-numbering anchor
```

**A TENSION THIS EXPOSES, worth testing before anything is built on it.** All8's own example is
`[0P1cH+]` versus `[0P1cH']` — same formation, arrangement, sequence, relationship AND orientation,
differing only in Occupation — so **Orientation and Occupation are INDEPENDENT axes**. But our four
`[L1p]` boards, which differ only by whole-set couple relabelling, come out ONE PER ORIENTATION
(H/L/O/R), which would make Occupation redundant rather than independent. Both cannot be true. The
likely reading is that `fasrooOf`'s orientation construction is not merely unverified but **measuring
the wrong axis** — it is picking up the couple-relabelling freedom and labelling it Orientation, which
would also explain why every board landed on a half-step before the 90-degree quantisation. Test it on
`[P]`, the case All8 actually draws: if the two boards of `[0P1cH+]` and `[0P1cH']` do not read H with
different Occupations, the construction is wrong rather than merely imprecise.

**RESOLUTION: A SETUP IS KEYED ON THE COUPLE-TO-SPOT ASSIGNMENT, AND FASROO IS A CALLER'S VIEW OF IT.**
(The report's reading, and it settles the tension above.)

For **constructing and identifying a setup**, the natural and complete anchor is *which home couple
stands on which spot* — couple index zero and the cycle from it. That is exactly the freedom
`boardsForAlignment` leaves: four boards identical in geometry, facing and gender, differing only in
the couple-to-spot map. It needs no reference pair, no handedness convention and no overlay.

**Orientation and Occupation are a caller-facing DESCRIPTION of that same information**, re-encoded
through conventions that are themselves disputed: a reference pair Callerlab defines for four
formations only, and an R-versus-L handedness stated only in All8's diagrams. That is why they do not
line up with the couple-to-spot map — All8's `[0P1cH+]`/`[0P1cH']` pair shows O and O varying
independently, while a cyclic relabelling of four couples has only four members. **The two encodings
are not the same shape**, and forcing them to correspond is what produced the one-per-orientation
artefact. So:

- **Store and select a setup by its couple-to-spot assignment.** That is the primitive.
- **Derive FASROO for display only**, never to choose a board, and keep the `?` marker on the
  Orientation letter.

**AND ORIENTATION IS POSITION, NOT FACING.** The report's reading: it is where the reference boy's
POSITION falls relative to an **overlaid squared set**, in 90-degree steps — a rotation of the board
carries him through all four states. `fasrooOf` instead compares his current bearing to HIS OWN home
bearing about the formation centre, a proxy that never asks which home spot he now corresponds to.
All8's own worked case is the check: in `[P]` the reference boy inside, with the formation rotated 90
degrees, is a **Side** occupation yet still oriented **H** — so a correct implementation must produce
H and `'` for the same board. NOTE the honest caveat measured at the same time: in our four `[L1p]`
boards the reference boy is a DIFFERENT PHYSICAL DANCER each time (refBoy 1, 3, 5, 7), because the
couple labels rotated under him — so their four different orientation letters are not by themselves
proof of an error. `[P]` is what separates the two readings, and `boardsForAlignment` currently returns
ZERO boards for `[P]`, so that case has to be built from the diagram rather than from the code path.

**THE MECHANISM, READ NOT INFERRED.** Two specifics, and neither is about the 4x4 lattice being too
small — it holds the eight dancers comfortably. The blockers are the table FORMAT and one guard:

1. **`ARRANGEMENT_TABLES` has no way to express an empty spot.** Each row is a STRING with one character
   per column — `facing: 'vvvv'`, `genders: ['gBgB', ...]` — so a row is always full width. A ring cannot
   be written in it, because a ring is exactly a shape with holes.
2. **`projectCells` demands a COMPLETE CARTESIAN PRODUCT.** Its second line is

   ```ts
   const xs = [...new Set(cells.map((c) => +c.x.toFixed(4)))].sort((a, b) => a - b);
   const ys = [...new Set(cells.map((c) => +c.y.toFixed(4)))].sort((a, b) => b - a);
   if (xs.length * ys.length !== cells.length) return null;
   ```

   and it then requires every `(x, y)` combination to be occupied. A squared set's eight points are
   `(±1,±3)` and `(±3,±1)`: FOUR distinct x values and FOUR distinct y values, so `4 * 4 = 16 !== 8` and
   the projection bails before anything else runs. No rotation changes that, since a rotation permutes
   the same eight points.

So the earlier claim was right but loosely stated: it is not that "no rectangular grid contains them",
it is that **the engine requires the occupied cells to BE a rectangle, and its row-string tables cannot
write a hole.** Both are general, and both are small: allow an explicit empty marker in the table and
relax the guard to "every non-empty cell is occupied". That would also cover the other ring and
spoke formations — Thars, Alamo, diamonds — which are in the same position (a diamond's four points
give `3 * 3 = 9 !== 4`).

So adding `[S]` is not "transcribe one more table"; it is a small format change plus the table. Worth
deciding before writing, because everything ring-shaped depends on it.

**BUILT (Step 1). The format change is DONE, and the guard was in TWO places, not one.** Measured and
shipped:

- **The empty marker is `EMPTY_CELL = '.'`**, and a row keeps one character per COLUMN, so a hole holds
  the later columns in place instead of shifting them. `.` cannot collide with a row's other
  characters (genders `B`/`g`/`?`; facings `>`/`^`/`<`/`v`/`?`).
- **BOTH rectangle guards are relaxed**, and the second one is not in `projectCells`' first line but
  the same test repeated: `toGrid` (`xs.length * ys.length !== dancers.length`) and `projectCells`
  (`xs.length * ys.length !== cells.length`). Each now refuses only what genuinely cannot be read: a
  board with more dancers than the lattice has spots, or two dancers on one spot. A hole is a `null`
  cell and an `.` in the row.
- **One more test had the same shape and was not in the report: `arrangementFor`'s own pre-check**
  (`dancers.length !== table.length * table[0].facing.length`) refused a squared set *after* the grid
  was built, with the reason "formation has 4x4 spots, board has 8 dancers". All three now count
  OCCUPIED spots (`occupiedSpots(table)`), which is `rows * columns` for every table that has no holes -
  so the mapped six are untouched.
- **Behaviour freeze, measured:** `ring-round-trip-probe.mjs` builds every mapped formation from its own
  table for all 6 arrangements and reads it back at all 4 rotations - **144 readings, all correct** -
  and `ring-representability-probe.mjs` shows the guard refusing a squared set under **0 of 8**
  symmetries before the change. The squared set now projects, its rows read `.vv. / >..< / >..< / .^^.`,
  and its 8 holes appear as 8 `null` cells.
- **A property of RINGS that the change exposes, measured on a 4-dancer diamond:** the diamond projects,
  but a half turn maps it onto itself, so arrangement **0 and arrangement 4 are both readings** and the
  module reports the ambiguity (`candidates [0,4]`) rather than picking one. That is the shape's
  symmetry, not a guard artefact - and it is the question `[S]` itself raises in Step 2, since home is
  symmetric under a quarter turn. Expect the `[S]` readout to be ambiguous by construction.
- **What the change costs at the source:** `fetch-arrangements.mjs` DROPS every printed row whose six
  gender cells cannot be joined into contiguous letters, so the fixture on disk holds only the two
  hole-FREE rows of `[S]` (and loses a row of `[D]` and three of `[I]` the same way). The `[S]` table
  therefore has to be transcribed from `arrngdia.htm`'s raw `<pre>` block, and the parser needs the same
  empty-cell awareness before the fixture can check it. Both are Step 2 work.
- **The `[S]` table's middle rows, and WHY the fixture loses them — both measured, and the first
  reading of it was wrong.** The fixture's `fetch-arrangements.mjs` strips HTML with
  `.replace(/<[^>]+>/g, '')`, and the middle rows of `[S]` print a literal `<` (the Sides facing west)
  which that rule eats as the opening of a tag - it consumes everything up to the next `>`, which is
  the one in "Choreo Bits:" two lines later. That is why the fixture holds only the two hole-FREE rows
  of `[S]` (and loses a row of `[D]` and the middle row of `[I]`, whose arrows include `<`). So there
  is no disagreement between two versions of the page: the raw `<pre>` block is the source, and the
  text rendering is a parse artefact. `live-squared-set-block-probe.mjs` prints both side by side.
- **`[S]` transcribed from the raw `<pre>` block, with the holes read off the LEFT formation block.**
  The page draws the formation's own facing first and then the 6 arrangements, so the left block gives
  the row's facing layout: rows 0, 3 are `v v` / `^ ^` (the Heads, at the two middle spots) and rows 1,
  2 are `> ... <` (the Sides, at the two END spots, facing the centre). Arrangement 0 is therefore
  `.gB.` / `B..g` / `g..B` / `.Bg.` - which is exactly the home square's own occupied lattice, so the
  geometry confirms the transcription independently. The middle rows' gender cells are unambiguous in
  the source (two per arrangement: `Bg gB gg BB gB Bg` for row 1), and each carries the two facing
  tokens at the row's two OUTER cell positions with the hole between them.

**BUILT (Step 2). `[S]` IS IN, with its table, and the readout is no longer a bare letter with
unknowns.** Measured:

- **`FORMATION_LETTER` has `'Static Square': 'S'` and `ARRANGEMENT_TABLES.S` has the six arrangements.**
  A SECOND spelling is needed and it is not cosmetic: `alignmentOf` is handed the name
  `knownFormation` returns, and recognition reports **'Squared Set'** (it comes first in
  `STANDARD_FORMATIONS`), so keying only the canonical name left `alignmentOf(home, 'Squared Set')`
  reading `[??1?]` while `alignmentOf(home, 'Static Square')` read `[0S1?]`. Both are listed now, and
  the reverse map still names one template because 'Squared Set' is not in the formation library.
  `arrangementFor(home, 'S')` is **0** (candidates `[0]`, mirroredCandidates `[5]`) and
  `alignmentOf(home, 'Static Square').notation` is **`[0S1?]`** - a real arrangement and a real
  sequence, with the relationship unknown for the stated reason. `fasrooOf(home, ...)` is
  **`[0S1???]`**. So the POC no longer reads `[?S1????]`: the two parts the engine can determine are
  determined, and the note attached to the readout already says why the reference pair is missing.
  **THE DECISION IS TO SHOW IT**, because the misleading shape the plan was worried about (one real
  letter, everything else `?`) does not arise: arrangement and sequence come out real, and the
  remaining `?`s are exactly the ones Callerlab gives `[S]` no convention for.
- **The table had to be stated in the ENGINE's frame, and that is forced by the code rather than
  chosen.** `arrangementFor` matches the facing layout EXACTLY under the four rotations and never
  accepts a reflection; the home square is invariant under all four rotations, so its facing layout
  (`.vv. / >..< / >..< / .^^.`) is the only one reachable. The source page draws the same square in the
  other orientation, which is not a rotation of it, so the source's rows cannot be used as printed.
  What IS taken from the source is the six gender patterns in their printed column order, which put
  arrangement 0 where All8's own definition puts it: at home.
- **The row ORDER and the cell COLUMNS are what had to be derived, and hand-deriving them produced two
  wrong tables before a mechanical check caught it.** `squared-set-table-build-probe.mjs` now reads the
  source's token stream, tries all six cyclic column shifts, and picks the one whose arrangement 0 is
  the home square. It matters because the engine's row order is NOT the source's: the home square's
  own projection is `.vv. / >..< / >..< / .^^.`, and that projection is what fixes which source row
  goes where.
- **A half-sashay now reads 5** (`swap each couple's two spots`), so home and half-sashayed home - the
  pair the plan says the engine "cannot tell apart" - are now distinguished.
- **`boardsForAlignment` no longer refuses `[S]`, but only for a spec that does not name a
  relationship.** It compared a board's arrangement to one NUMBER, and a ring's board can carry two
  honest readings (a half turn maps 1<->2 and 3<->5), so it admitted nothing; membership of the
  candidate set is the right test, and `{letter S, arrangement 0}` now returns **576** boards rather
  than 0. The harness's reachability table still prints `0:0/16` for `[S]` and that is correct rather
  than a leftover: it asks for all four parts, `relationshipStateOf(board, 'S')` is null, and a
  constraint the engine cannot evaluate admits nothing. **`boardForAlignment` picks the first of those
  576** - the same order-dependence the plan records for `[L1p]`, now visible for `[S]` too. That is
  Step 3's problem and it is not guessed at here.
- **Still NOT resolved for `[S]`, recorded as Step 3's starting point.** A board built by the
  enumeration reads `sequence null` (`sequenceFor` finds the couple order asymmetric), and
  `relationshipStateOf(board, 'S')` is null because `[S]` has no recorded adjacent-pair structure - so
  a spec naming a sequence or a relationship admits nothing. `{letter S, arrangement 0}` gives 576
  boards; adding `sequence: 1` gives 16; adding `relationship: 'p'` gives 0. The setup primitive is to
  be keyed on the couple-to-spot assignment and build the board directly, which is what skips this
  whole search.
- **A second parser defect in the fixture refresh, fixed, and it is why the fixture is worth
  regenerating rather than hand-editing.** `fetch-arrangements.mjs` stripped tags with `/<[^>]+>/g`,
  which ate every row whose printed arrows include `<` - the middle rows of `[S]`, one row of `[D]` and
  one of `[I]`. A `<` only starts a tag when a name or a slash follows it, and the fix says so.
  Regenerating AFTER the fix ADDS those rows and changes no other byte: 39 formations, 0 deletions.

**BUILT (Step 3). THE SETUP PRIMITIVE, keyed on the couple-to-spot assignment.** Measured:

- **The anchor is the assignment, and the operations on it are exported**: `CoupleToSpot`,
  `coupleToSpot`, `sameCoupleToSpot`, `rotationBetweenBoards`, `relabelCouples`. Orientation and
  Occupation stay derived for display, never used to choose a board.
- **All8's own board is now SELECTED, not accidentally taken, and the rule is a measurement.** Three
  candidates were refuted before the table was written, and `canonical-rule-probe.mjs` scores them so
  nobody re-derives them: the SEQUENCE ALONE (holds for `[L] [W] [F] [L.F]` — in → +3, out → +2 — and is
  refuted by `[B]`, whose in-sequence `p` code sits at 2 and whose `c`/`r` codes sit at 0), the
  ARRANGEMENT, and the geometric "nearest its home bearing" rule (**re-measured at 3 of 26**; the plan
  already had this refuted at 0 of 6). The relationship IS involved — it is the letter All8 measures
  FROM the reference pair, so it says where the reference pair goes — but `(letter, relationship)` is
  not a function either. What ships is `CANONICAL_INDEX`, the measured index per code, and **26 of 26
  published diagrams now select All8's own board**. A code with no entry falls back to `boards[0]`,
  i.e. to the old behaviour rather than to a guess.
- **`setupForFormation(name, templateFor)`** is the registry: All8's zero setup code per formation plus
  the board and assignment it stands up, and it **fails loudly** when the code names a relationship the
  table has not measured, so a setup is never silently rotated wrong. Nine entries stand up a board with
  8/8 identity that reads back as its own code, and `Normal Lines → L1o` is confirmed a **ZERO LINE by
  property** (in sequence, and every dancer facing a dancer of a corner couple).
- **`compliesWithSetup(board, setup, level)`** with levels `formation | arrangement | sequence |
  relationship`. A corpus label like `Zero Line` is a REQUIREMENT; the engine could not express that,
  which is how a module came to start on the right geometry in the wrong arrangement.
- **TWO THINGS RECORDED RATHER THAN SMOOTHED.** `[S]`'s setup code is **`S1` with no relationship
  component** — `[S]` has no reference pair, so `S1p` is a state that cannot exist and the enumeration
  correctly admits nothing for it. And **`L1o`'s index is the one entry not measured off a diagram**:
  All8 publishes none for an `o` code, and the zero-line property holds on ALL FOUR candidates because
  it is rotation-invariant (relabelling couples does not change who faces whom), so index 0 is a
  **recorded choice**, verified to satisfy the property it is used for.

**THE `[P]` REFERENCE PAIR IS DECIDED AND RECORDED, AND IT WAS THE GATE ON THE ORIENTATION CHECK —
which now RUNS and DISPROVES the construction.** This was the first thing to settle in the whole
thread, because `fasrooOf` refuses a formation with no reference pair before it computes anything.
The decision turned on reading the authority rather than reasoning, and All8 states the rule outright
(`16com_p.htm`, "Special note about Double Pass Thru Formation"):

> "To determine relationship, by convention we need one girl and one boy in each quadrant of the
> setup. … Since **[0P]** Double Pass Thru formation does not have a single boy and a single girl in
> each quadrant, for purposes of evaluating relationship, **we mentally have the Centers Pass Thru
> then evaluate relationship in the resulting [0B] Eight Chain Thru Formation**."

So `[P]` gets a **reduction to `[B]`**, not a fifth agreed pair — Callerlab's four are unchanged, and
the engine records All8's own extension as such (`REFERENCE_PAIR_RULES.P`, `relationshipStateOf`,
`centresPassThru`). Measured on all four `[P]` alignments the get-out corpus publishes a diagram for:

- **the reduction IS the catalogue's own `Centers Pass Thru`, dancer for dancer** (positions and
  headings identical), and the result is named `Eight Chain Thru` every time — so it is a pure
  permutation of the board's four INNER dancers, which is why `alignment.ts` can do it at all;
- **All8's OWN conversion lines are reproduced 4/4**, and they are the independent check:
  `C-PasTh [B1c]` (P1c), `[B2r]` (P2r), `[B3r]` (P3p), `[B4c]` (P4p);
- **the reference POSITION is one fixed cell**: `REFERENCE_PAIR_SPOTS.P = [[3,0],[3,1]]`, measured by
  carrying `[B]`'s reference pair back through the reduction (`p-reference-position-probe.mjs`);
- **the LETTERS are not a fixed pair's**, and that split is measured rather than assumed: scoring every
  boy spot × girl spot over all four alignments finds **0** pairs that reproduce the published letters,
  while the reduction does. The rule therefore reads the board's own pairs when they AGREE (P3p/P4p,
  "All Paired" — every boy beside his partner, published `p`) and reduces only when they disagree
  (P1c/P2r, "Outsides Paired") — applying the reduction unconditionally would contradict the published
  `p` for P3p and P4p.

**What it changes, measured on three sides.** `boardForFasrCode` now derives All8's OWN board for **28
of 28** published alignments instead of 26 — the two refusals are gone, and the harness pins "no
refusal" rather than pinning the two. `CANONICAL_INDEX.P` gains the two measured entries (`1:{c:0}`,
`2:{r:0}`; all four `[P]` codes measure at index 0, so the enumeration fallback was right by luck and
is now right by measurement). No census moves: figures 116 of 188, get-out 124 of 265, FSM
155/92/43/19 are all unchanged, because no figure uses a `[P]` code. Gates: `alignment.mjs` (light)
pins the letters, the reference cell and the reduction being involutive; `alignment-boards.mjs` pins
the call-level half — the reduction equals the catalogue call, and All8's four conversion lines.

**AND THE ORIENTATION PROBE NOW RUNS, WHICH IS WHAT THE DECISION WAS FOR. It was WRONG on All8's own
worked pair, and that defect is now FIXED — see the ORIENTATION entry below.** Running it on All8's
pair used to give the right OCCUPATION and the WRONG ORIENTATION:

```
BEFORE  [0P1cH+]  (the published board)    -> [0P1cR+]   occupation +   orientation 270 deg / R
        [0P1cH']  (same board, couples +1) -> [0P1cR']   occupation '   orientation 270 deg / R
AFTER   [0P1cH+]                           -> [0P1cH+]   occupation +   orientation   0 deg / H
        [0P1cH']                           -> [0P1cH']   occupation '   orientation   0 deg / H
```

Occupation was right for both even before, which is a direct validation of the reference pair; the
ORIENTATION was R where All8 says H on the authority's own example — no longer a suspicion flagged in
the source but a demonstrated fault. **It is now repaired** (the reference boy's side read in All8's
own drawing frame), and both labels come out exactly as All8 prints them.

**A SECOND SOURCE WAS SOUGHT FOR THE OTHER TWELVE `[P]` STATES AND CANNOT BE READ EITHER.** All8's
"16 Possible Pairings" page draws all sixteen with couple-numbered tiles, and the tiles decode exactly
once the sprite convention is pinned (`d1/<n><dir>.gif`, `couple = floor(n/2) + 1`, even = boy, odd =
girl, `dir` = facing — confirmed by the user and by the page's own "At Home" drawing, where `0n` is the
`#1` boy All8 marks red). Two findings, both recorded rather than smoothed:

- **the page's four overlapping states are NOT all the get-out pages' boards.** `P1c` and `P2r` match
  up to a uniform couple relabelling; `P3p` and `P4p` do not, and **no bijection of the eight tile slots
  onto the eight spots reconciles all four** (`p-tile-order-probe.mjs` searches all 40,320 and finds
  **zero**). Read in document order the page's `P3p`/`P4p` cells are not valid boards at all — a
  couple's two dancers end up two columns apart with another couple's boy between them.
- so the `[P]` rule stays measured on the **four** published get-out diagrams, each cross-checked
  against the conversion line All8 prints beside it. That is the honest sample size, and it is why the
  rule is gated on those four rather than claimed for the other twelve.

The code's own `FASROO_ORIENTATION_NOTE` still flags the construction in the source, and now carries
the `[P]` witness beside the `[L1p]` one.

### THE ORIENTATION CONSTRUCTION, FIXED - and it was a FRAME bug, not a missing definition

`fasrooOf`'s Orientation was the last open item of the FASR thread, and it took two measurements to
settle because the first one pointed the wrong way (`fasroo-orientation-frame-probe.mjs`).

**What was wrong.** The old construction compared the reference boy's CURRENT bearing about the board
centre with his HOME bearing about the home centre, and quantised the difference. Two things are wrong
with that:

- for a LINE the two positions are not related by a rotation at all — home `(3,-1)` is at 341.6 deg
  while `[L1p]`'s reference cell is at 303.7 deg, a raw **-37.9 deg**, i.e. not a multiple of 90 — so
  the quantisation was picking arbitrarily between two states; and
- more importantly it read the board in the engine's TEMPLATE frame, which for a 4x2 formation is
  All8's own drawing **rotated a quarter turn**, and Orientation is precisely the rotation relative to
  home. That is what produced `[0P1cR+]` where All8 prints `[0P1cH+]`.

**The fix.** Read the reference boy's position in the formation's **own arrangement TABLE** — which IS
All8's drawing frame; its facing layout is exactly what the published orientation diagrams are drawn
on (`[P]`'s table is `vv vv ^^ ^^`, couple 1 at the bottom facing north, which is his home) — take the
nearest compass SIDE of his cell about the table centre, and make the letter the **clockwise
90-degree step from his home side to it**. `readLayout` already computes the change into that frame, so
nothing had to be invented. Two supporting choices, both from the authority:

- the reference dancer is the boy of the pair `REFERENCE_PAIR_SPOTS` pins; where it is not pinned
  (`[W]`, `[F]`) the fallback is All8's own — "These diagrams use the **#1 (Head) Boy** as the
  reference dancer. Alternately, the opposite dancer, the **#3 (Head) Boy** could be used … the result
  is the same" — rather than whatever pair happened to sort first, which is what the old code did;
- a cell on a DIAGONAL of the table has no nearest side, so the letter is refused with that reason
  instead of being rounded.

**The two witnesses, both All8's own.**

```
(a) the worked pair, which the labels state:   [0P1cH+]  ->  [0P1cH+]   occupation +   orientation H
                                               [0P1cH']  ->  [0P1cH']   occupation '   orientation H
(b) the four published [0B] orientation diagrams: reference boy at
        south-west -> H     north-east -> O     north-west -> L     south-east -> R
    which the rule reproduces (they are the only place All8 publishes the letter WITH a picture).
```

**And it restored resolution as well as correctness: every `[B]`, `[L]` and `[P]` code now resolves
its four boards to four DISTINCT FASROO codes** (`fasroo-injectivity-probe.mjs`, 48 of 48 at
arrangement 0, e.g. `[0B1pH+] [0B1pL'] [0B1pO+] [0B1pR']`), where the old construction produced a
half-step-shifted set. Two things are recorded rather than smoothed:

- **a synthesised board is refused an Orientation outright.** `boardForFormation` stamps array-index ids
  and no home couple, so reading a home off those ids invents the identity the reading is relative to.
  It now says so: "the reference boy has no home couple, so there is no home for Orientation to be
  measured against (identity is data)". (`relabelCouples` is the opposite case and is still allowed —
  its couples are KNOWN, merely shifted, which is exactly what `[0P1cH']` is.)
- **`[W]` and `[F]` were COLLAPSING and are now FIXED**: their reference pair was recorded in WORDS
  but not pinned to spots (no published alignment discriminates their relationship letter), so with
  the #1-boy fallback a code's four boards did not all separate — 24 of 72 codes at arrangement 0.
  **All8 draws all four agreed pairs side by side under "Reference Pair shown in RED" on its FASR
  page**, and `fasr-reference-pair-probe.mjs` reads them: that page's sprites are a COLOUR set
  (0 = red boy, 1 = red girl, 8 = black boy, 9 = black girl), so the 0/1 tiles are exactly the
  reference dancers — four of them, because All8's convention has two reference positions "opposite
  each other" and draws both — and the probe solves each diagram's print layout against All8's OWN
  table facings, checking itself on the two formations the corpus already pinned (**[L]'s red couple
  lands on `(0,2)+(0,3)`, [B]'s on `(2,0)+(3,0)`**, the recorded cells). `[F]` and `[W]` come out at
  `(0,2)+(0,3)` too. Pinned in `REFERENCE_PAIR_SPOTS`, and the collapse is gone: **all five formations
  with an agreed pair now resolve their boards to distinct FASROO codes, 80 of 80** at arrangement 0,
  where before it was 48 of 72 with 24 collisions. **The only collisions left are `[L.F]`**
  (Two-Faced Lines LH) — 8 codes whose boards read `[0L.F2???]` — and that is CORRECT rather than a
  gap: Callerlab agrees the pair for the four standard-arrangement formations only, the left-handed
  variant is not one, and `fasrooOf` refuses it outright instead of guessing. Gated in `alignment.mjs`.
  *(Consequence recorded: pinning the pair also makes `[W]`/`[F]` readable at sequences 3 and 4, where
  the boys disagree and the letter was previously null, so 16 more codes now build boards. Their
  `CANONICAL_INDEX` entries cannot be measured — All8 publishes no sequence-3/4 wave diagram — so
  `boardForFasrCode` uses the documented `boards[0]` fallback for an unmeasured code.)*

**Gates:** `alignment.mjs` pins both witnesses, the 80-of-80 distinctness across all five formations
with an agreed pair, the `[L.F]` refusal and the identity refusal.

### THE `[S]` "0:0/16" WAS AN INSTRUMENT FAULT, NOT A COVERAGE GAP - and the fix is in the instrument

Worth its own entry because the wrong reading of it is so inviting, and because the obvious repair is
wrong. `alignment-boards.mjs`'s reachability table printed

```
  [S] Static Square          0:0/16  5:0/16  1:0/16  2:0/16  3:0/16  4:0/16
```

for every arrangement, next to letters showing 16/16 and 8/16, which reads as "squared sets are
broken". They are not. The table asks for all four parts, `relationshipStateOf` is undefined for `[S]`
(Callerlab records a reference pair for `[L] [B] [F] [W]` only), and the strict relationship filter
therefore admits nothing - while the same call with the relationship left out returns 576 boards.

**THE OBVIOUS REPAIR WAS TRIED AND REVERTED, and it is the interesting part.** Relaxing the sequence and
relationship filters to "skip a constraint the engine cannot evaluate" is a defensible principle, and it
broke two things at once (measured, `all8-format.mjs`):

- **`boardsForAlignment` returns MORE boards**, so **14 corpus codes then selected the wrong one** -
  `canonicalBoard`'s measured index is only meaningful over the set the strict filter produced;
- the `[P]`, `[W]` and `[F]` refusals moved, because the strict filter is what keeps a relationship
  LETTER meaningful: a spec naming one is satisfied only by a board whose relationship the engine can
  read.

So the zero STANDS and the filter is left strict. **The fault was the instrument's silence**, and it is
now fixed there: the harness prints, beside every zero, whether it is a coverage gap or an unnameable
state, and which part cannot be read. For `[S]` it now says

```
      [0S]   NONE of them can be named: no relationship letter can be measured for this formation
      [0S]   (readable here: sequence 4/2/1/3, relationship none)
```

which is the fact that matters: the SEQUENCE is perfectly readable, the RELATIONSHIP is not, and a
caller refusing an `[S]`-with-relationship label is therefore CORRECT rather than blocked. It also
prints a gate: a zero from `boardsForAlignment` with no reason is a failure, because a silent zero is
exactly what produced this confusion.

### THE POC CAN BE CHECKED HEADLESSLY, AND IT HAS THREE PRE-EXISTING FAILURES

Worth recording because the working rule says the POC cannot be run here: `node poc/verify.cjs` DOES run
— it is a plain Node script against the engine's built `dist`, so it never touches Vite or esbuild and
the `spawn EPERM` that blocks the app does not apply. It is not a full app check (no UI, no rendering),
but it exercises the formation/call pipeline a coded start feeds, and it is now the closest thing to a
POC-side gate this environment has.

**It fails 3 of its checks, and they are PRE-EXISTING rather than caused by this work** — checked by
rebuilding the engine from the Step 2 commit (`009965b`, before `boardForFasrCode` changed) and running
it again, which reproduces the identical three:

```
FAIL Pass Thru half has 2 dancers (expect 4)
FAIL Pass Thru full (mirrored) has 4 dancers (expect 8)
FAIL Pass Thru start line shows all dancers holding hands (static)
```

They are about a `Pass Thru` setup's dancer COUNT and hand holds, which no part of the FASR/setup work
touches. Recorded rather than fixed: they are a separate defect, and a suite that fails before your
change is not a gate for it. The POC's own `START_FORMATION` path is exercised by
`test/tools/poc-zero-line-probe.mjs` and `fasr-code-canonical-probe.mjs` instead, which ask the engine
the same questions headlessly.

### A FORMATION'S NAME IS NOT STABLE AT 1e-14 RADIANS (open, measured)

Found while building the editor's **End setup / Connect end** (the end of a track can now be re-based onto a
named formation). The end board a connect produces has the target formation's poses to within **~3e-15
radians** in heading, and the library's curated read (`Sequencer.recognize`) sometimes names it differently:
`Quarter Lines RH` comes back as `Quarter Lines LH`.

The cause is not the connect. MEASURED directly on the library's own boards: taking a formation's board and
adding **1e-14 rad to every heading** — a rotation by nothing at all — changes the NAME for **5 of the 16**
formations the curated read can name (`Magic Column RH`, `Quarter Lines RH`, `Quarter Tag`, `Tidal Line RH`
all flip to their LH reading; the 134-formation sweep and the full list are printed by
`poc/tools/end-pair-probe.mjs` section 6). Every heading in those boards sits on the ±π branch cut, so
whatever decides RH from LH is resolved by a comparison that a 1e-14 rotation can tip.

Consequences, both real: the **Browse** panel's end-formation read can report the mirrored arrangement for a
board that is the one it was given, and any check of the form "does this call finish in formation X" has to
snap headings before it compares, or it is testing this knife edge instead of the feature. The probe does
snap, and reports the instability separately so it cannot hide.

Not fixed: the read is in the matcher/alignment path, and a fix means finding exactly which comparison
decides RH from LH and giving it a tolerance — a change to every formation read in the app, which wants its
own measurement rather than a patch bolted onto this feature.

### THE ONE LIVE CALLER OF THE OLD SELECTION, CHECKED RATHER THAN ASSUMED

`boardForFasrCode` used to return `boards[0]` — the setup work added `canonicalBoard` and used it in the
registry but deliberately did not change the code path the POC runs on, so the app's one coded start was
asked the question directly, by `test/tools/poc-zero-line-probe.mjs`:

```
the app loaded `Zero Line` as boardForFasrCode('L1o')    identity 8/8, sequence 1, facing pairs 1-4 2-3
the app's own comment claims                              facing pairs are 1-4 and 2-3   -> CLAIM HOLDS
```

**So the app was not loading a wrong board, and that is a property of `L1o` rather than of the code
path.** The same probe shows why it was luck rather than correctness: `L1o`'s four candidates read
`1-4 2-3`, `1-2 3-4`, `1-4 2-3`, `1-2 3-4`, so the property holds on indices **0 and 2** but NOT on 1
and 3 — the ONE code whose selection happens not to matter was the one code the app used.

**The consequence was a live trap for the next coded start, and it is now CLOSED.** `Zero Box` (`B1c`)
is the obvious next entry, and for it the measured index is **0 of the same four**, so `boards[0]` would
have stood the module up on the wrong board — silently, on the right geometry, with the right gender
pattern. `boardForFasrCode` now builds through `canonicalBoard`, and the function the POC actually calls
was re-measured: **26 of 26 published alignments place the same COUPLE on every spot as All8's own
diagram**, `L1o` still carries the property the app's comment claims, and `B1c` now agrees with the
setup registry. Exactly **12 codes change** (`B1p B2p L1p L2p L3c L4r W1p W2p F1p F2p L.F1p L.F2p`,
the ones whose measured index is not 0); every other code, measured or not, builds what it built before,
because `canonicalBoard` falls back to `boards[0]`. The guarantee is now GATED rather than only probed:
`all8-format.mjs` used an identity-free geometry signature that could not see the couple placement at
all, and it now compares the couple-to-spot assignment too.

**AND A SMALLER CORRECTION THAT IS INDEPENDENT OF THAT (DONE in Step 2).** `FORMATION_LETTER` had no
entry for `Static Square`, so `letterForFormation` returned null and `fasrooOf` bailed out before it
could read anything — which is why the POC printed nothing at all for home rather than a partial code.
All8 DOES give home a letter (`[S]`), and it is now mapped, together with the table that makes the
arrangement readable.

**What is still NOT trustworthy in `fasrooOf`: the ORIENTATION CONSTRUCTION.** All8 defines it by
superimposing the SQUARED SET, where the reference boy's home is a SPOT (couple 3 north at (1,3)) that
does not exist in a line or a wave at all; `fasrooOf` compares bearings about the centre instead, which
is a different question. The four boards do read four distinct orientations — 1:1 onto H/L/O/R — so
the structure is sound and the readout works, but the ABSOLUTE letter must not be trusted until the
construction follows All8's superposition, and the **R-vs-L handedness is a convention only All8's
diagrams state**. Flagged in the source next to the code, not just here.

**The fix follows the report's wording**: use the FASR properties plus an orientation/reference anchor
to place the dancers, rather than taking enumeration index 0. `REFERENCE_PAIR_RULES` is used to
CLASSIFY a board, never to SELECT one, which is the gap.

**A REAL INDEX-AS-IDENTITY BUG, but somewhere else.** `boardFromMatchables` stamps
`id: m ? home[m.mapping[i]] : i + 1` — for any geometry that is not home-like, DANCER ID IS THE ARRAY
INDEX. That is the report's instinct, and it is why a named formation stood up from the library carries
no real identity at all (129 of the 134) and why `sequence` reads `unknown` for every one of them. It
is a separate defect from the `[L1p]` mismatch and does not cause it.

**A residual, found by the new gate, recorded not papered over: the final-frame jump.** Extending
`anim-convergence.mjs` from the coded moves to the 111 non-coded calls the corpora use turned up
**7 (board, call) pairs where the last drawn frame is not the board the call produces** — a jump on
the final beat, worst **0.1476** units on a lattice that stands 2.00 apart (~7%). Every one is a
CIRCLE call (`Circle Left`, `Circle Left 1/4`, `Circle Left 3/4`, `Circle Right 3/4`, and
`Rollaway from Circle`), plus `Lead Right from Eight Chain Thru`, which is one cause or two and is
the next thing to chase: the frame just before the end disagrees with the board `applyWholeBoard`
stores, so `poseFor(t, dancerBeats(t))` and whatever places the applied end are not the same pose for
these variants. Pinned as a LIST in the harness so it can only shrink deliberately. Note the survey
could not see this class at all — the closest pair stays ~1.9 while a dancer teleports 0.15.

**A model limit, deliberately left.** `Swing Thru` from `Columns` still touches 0.00 at beat 1.5
(#2/#8). That board's `2+2+2+2` pairs stand 2.0 apart, so their radius-1 semicircles are **tangent**
and no split into parts separates them. Expressing it would need the two exchanges sequenced in TIME
within a part, which the leg model does not express. Recorded rather than papered over.

**TWO MORE DISAGREEMENTS, both found by check (D)/(E) of the new gate, and BOTH NOW CLOSED.** Widening
`anim-convergence.mjs` to the non-coded corpus calls made the harness ask the applicator and the walk
the same question directly, and they did not always answer alike. Both were the same smell — one
question, two implementations — and Mechanism 5 above is the fix:

- **PHANTOMS: `applyToBoard` REFUSES the call, `sequenceBeats` charges it beats. Measured 2466, now
  11.** Hand-checked in `engine/test/tools/phantom-probe.mjs`: `Square Thru 4` from `Columns` refuses
  with *"No setup in this call matches the current formation"* and was still charged **10.0 beats**.
  `evaluateParallelAt` returns the board unchanged for those beats, so a sequence containing one
  silently stalls — the caller's beat count and the dancers disagree.
- **DROPPED: the applicator applies a call and moves the dancers but the walk plays nothing. Measured
  400, now 6.** An authored call with no variant at walk tolerance is a deliberate `walkable: false`
  stop, so this is `walkable` behaving as designed — but the applicator disagreeing with it 400 times
  was the same tolerance pair, and the same one-line alignment closed it.

The cause of both was NOT the tolerance: it was the PREDICATE. `matchingVariantInfo` asked
`partitionExists` — full tilings only — while `parallelApply` accepts `partition ?? partitionPartial`.

### Phase L — PHRASE tams: the catalogue's own model for whole published chains (round 16)

**The finding, and it is a structural one.** `taminations-flutter/`'s XML — and **our own
`poc/src/assets/`**, which is the same data — author several of the corpus's published chains as a
**single `<tam>` whose title is the whole phrase**, `formation="Static Square"`, with the actives'
paths run end to end and the others standing:

- `ms/star.xml`: *"Heads Square Thru; Make A Right Hand Star With The Sides; Heads Center Left Hand
  Star; Back To The Same Girl With A Right and Left Thru"* — the exact chain behind the five
  `Centers Left Hand Star` stops.
- `ms/separate.xml` + `b1/separate.xml`: `Heads Pass Thru, Separate Around 1 to a Line`, `… Around 2
  to a Line`, `… Around 1/2 and Come Into the Middle`, `… Around 2; Meet Your Partner and Dosado`.

The engine has these tams loaded (they are ordinary `<tam>` titles, so `callsByTitle` registers them),
but **nothing can reach them**: the corpus is decomposed into individual calls, and no call name
equals a sentence. So the 5 `Centers Left Hand Star` figures and the `Separate Around Two` figure are
blocked by the absence of a phrase layer, not by a selection rule or a missing call — which is also
why the reference can run them and a decomposed sequencer cannot.

**Why this is worth having, and why it is not a shortcut.** Reading the tams' paths is reading the
published choreography for exactly these chains, from a source this repo already ships; it is not
inventing motion (the line Phase B does not cross). Two mechanisms are possible and they are very
different in size:

1. **A phrase match** — before decomposing, see whether the incoming call WINDOW matches a registered
   tam whose title is that phrase. Cheap to try, but it changes what a call IS (`Right-hand Star` +
   `Centers Left Hand Star` would sometimes be one step), so it needs its own decision about which
   sequences it may claim, and the tams only exist for the phrases upstream chose to animate.
2. **Authoring the missing FRAGMENT** — the same motion as a call whose setup is the board the engine
   actually produces. `Separate Around Two` is the witness that this is not a drop-in: the fragments
   are authored from `T-Bone URLU` while the engine's post-`Heads Pass Thru` board is `T-Bone LDDR`,
   so the fragment would have to be re-authored for the board, and getting a T-Bone's four facings
   right is exactly the kind of authoring Phase B demands a definition for.

**Do not start with the star file.** `Centers` on that board has no answer in either implementation
(round 16's measurement above), and `figm75` has an unread cell besides; the phrase layer is the only
route for those five, so nothing else should be spent on them.

---

### A WYSIWYG PATH EDITOR: the design the measurements point at (designed, not built)

The goal, in the user's words: *"an intuitive mechanism to edit the dance path through a wysiwyg interface.
Many of the paths are circular (so this has to be easy to achieve), and the dancers moves must start and end
at fixed points (defined by a formation). There should be an easy way to make the dancer face the right
direction."* `poc/tools/wysiwyg-path-probe.mjs` measures the corpus against those three claims (the numbers
are in `poc/README.md`); this is what they imply.

**The panel exposes ONE of the three things a move has.** A `Seg` carries a *position* curve, a *facing*
channel (`rotate`, or "face along travel" when null), and *timing*. The instance panel edits the six numbers
of the position curve, and the facing only through a second tab on the same six-number widget. Everything
asked for this session - the handle/endpoint mode toggle, the quarter-arc checkbox, the arc-centre handle, the
end-formation connect - is a workaround for that one mismatch.

**D0. Prior art, and the one piece of it that validates the model we already have.** The closest analogue by
far is **marching-band drill design** - Pyware 3D X (`pyware.com/guide/3dx/`), FORMI, StageKeep - which solves
the identical problem for 100+ performers: a step grid with snapped divisions, **named curve tools including
Arc, Circle and Bezier**, a count-track timeline, and, critically, **facing authored as its own curve with its
own modes**: *Don't Change* / *Follow Direction of Movement* / *Face a Fixed Direction* / *Face to a Performer*
/ *Face to a Point*, plus "take N counts to move" interpolating the heading over a range. That is the
separate `rotate` channel and the "face along travel OR an absolute heading" switch, arrived at independently
by a mature commercial product in exactly this domain - so the two-channel `Seg` is not an oddity to
apologise for, it is the feature to protect. The domain even *defines* the separation in its own vocabulary:
glide-step marching distinguishes **sliding**, "keeping the upper body facing a different direction than the
lower body", from back-marching - which is our 37.8%. (The research prototype **ChoreoVis**, Eurographics 2024,
`ar5iv.labs.arxiv.org/html/2404.04100v1`, does the same for formation dancing with up to 16 dancers:
drag-and-drop formations, transition waypoints, per-dancer path-length charts.) **And the same tools show the
failure mode to avoid:** straight-line interpolation between formations, and endpoint-only authoring. In square
dancing there is no editor of this kind at all - Taminations, the corpus this engine renders, is
**hand-written XML with no GUI** (`taminations-flutter`, AGPL), and the commercial choreography tools that
exist (CSDS, `ceder.net/csds/`) drag dancers from a start spot to an end spot and state outright that they do
**not** animate or count beats. **The vocabulary to build the gestures out of is already standardised**:
CALLERLAB's definitions (`knowledge.callerlab.org/programdocuments/`) specify each call as *starting formation
/ dance action / ending formation / timing in beats*, and describe the motion in reusable terms - "turn, **as a
unit**, away from the center of the Line for **3/4 of a circle (270 degrees)**", "Turn 1/4 by the left", the
**Facing Couples Rule** and the **Ocean Wave Rule**. So the arc gesture's units should be the ones the
definitions use: a **fraction of a circle**, about a named centre, as a unit - not a raw Bezier control point.

**The measurements that constrain any design:**
- a joint is **usually already smooth** (**83.7%** of 51180 interior joints within 1deg), but a **corner is an
  authored thing** (max 180deg) - so an editor may neither break continuity casually nor force it;
- the dancer **often does not face where it is going** (**37.8%** of 89132 poses more than 10deg off, 2.3%
  walking backwards) - so facing is **not** derivable from the path;
- joints are **two-thirds on a formation spot and one-third on none** - so pinning and freeing must both be
  first-class;
- a circular **move** is always a **quarter** (max sweep 90.0deg over 10884 circle fits), while an **orbit is a
  chain** of them (**4589** runs, median 270deg, max 765deg).

**D1. The JOINT is the editing unit, not the move.** A joint is `(position, facing)` at a move boundary. Every
measured fact above is about joints; the six numbers are what a *pair* of joints compiles to. The panel should
put a draggable dot at each joint with a heading arrow, and treat the curve as the rendering of it. **And the
interaction belongs on the BOARD, not in the panel** - which is a measured claim rather than a preference:
Knotation's field study of choreographers counted **30.8 interactions with the floorplan against 4.3 with the
timeline** (`hal.science/hal-01817569/document`), a factor of seven, and what worked was the floorplan and the
timeline *paired* rather than one substituting for the other. The instance panel is currently the opposite way
round - a column of number fields with the board as the preview - and that is the biggest single change the
prior art asks for.

**D2. Edit in WORLD space; store in LOCAL space.** The stored form is a bijection of the world description
(each move's curve is the world curve re-expressed in the frame at that move's start), and the local form is
what makes `moves.xml` reusable across formations - so both are wanted, but the *editor* must be the world
one. Today a local-curve edit moves the world path downstream of it, which is exactly the "the board rotated
when I changed a number" class of surprise. The conversion is mechanical and should be a gate: re-express the
whole corpus world-first and require a round trip inside the export's own four decimals.

**D2a. And the PATH itself is DERIVED first, with the curve as an OVERRIDE.** This is the architectural
consensus of the sibling domain and it corrects an implication of D2: Pyware, EnVision, OpenMarch and Drill
Studio all **auto-generate** the transition when a form is repositioned, and offer curves as an *override*
(Pyware's `Straighten Paths` and `Curved Shape` toggles); only Field Artist makes path drawing primary. The
published schema behind the same model - US 9,812,031 - stores **`performers[{coordinates[{setId,x,y}]}]` and
no paths at all**. So the user's primary act is placing **joints** (which D1 already makes the unit), the path
between them is *computed*, and the six Bezier numbers are what you get when you press "customise this path".
That is a better fit for this repo than "the user draws curves", because a library of 500+ calls whose paths
are all bespoke is not a library - and because it makes the **derivation rule** the thing to get right instead
of the drawing tool. **The rule must not be a straight line**, which is the documented failure in this same
domain and one of the five walk-through mechanisms already closed here; the rule to use is the one CALLERLAB
writes the calls in - *turn, as a unit, a fraction of a circle about a named centre*.

**D2b. A HOLD is its own element, not a zero-length move.** Ultimate Drill Book documents a workaround -
directors insert a "subset tab" for a "move 8, hold 8" - that exists **only** because the marching model
conflates a transition with a single interpolated span. This corpus has the same conflation and it has already
cost us: a `Seg` with zero beats, or with a handle that has collapsed onto its endpoint, is a *hold* wearing a
move's clothes, and it is exactly the case that produced the **144 of 884** moves with a collapsed exit handle
and the **22** arcs whose joint could not be turned. Making a hold explicit removes a whole class of
degenerate cases rather than handling each one.

**D2c. And two cheap derived readouts are worth more than a constraint HUD** (see D6a for why the HUD does not
work). UDBapp computes and displays **xCounts** - the counts at which a performer crosses each yard line - and
a **Halfway Point**, both of which are exactly what someone reading a call wants to know. The square-dance
equivalents are nearly free from what the engine already evaluates: **the count at which each dancer passes the
centre of the square**, and **where each dancer is halfway through the call**.

**D2d. Coordinates read as "N steps from a named checkpoint".** OpenMarch's model is the cleanest and is open
source: signed steps from the field centre on one axis, steps from the front on the other, each checkpoint
carrying a `Short Name` that becomes the *displayed* coordinate, plus a separate `Use as Reference` flag that
distinguishes visual reference points from real coordinate references. `formations.xml` is already centred at
the origin, so this is a display and naming layer rather than a data change - and Pyware's Terms tab exists
purely because every ensemble renames the sides, which for square dancing is "heads/tails", "boys/girls",
"left/right".

**D2e. One sibling-domain primitive does NOT transfer, and it is worth saying so.** Pyware's interval (spacing)
box is described as its most transferable idea: locking the spacing makes a form grow by *changing the number
of positions*, with mixed-interval notation like `5x3,10x2,5x3`. **Square dancing cannot do that** - a square is
eight dancers and the spacing is a property of the *formation*, not an authoring value - so interval is not a
free variable here and there is nothing to gain from exposing it. The transferable half is only that spacing
is *named* and *visible*, which `formations.xml` already does.

**D2f. And the editor should REUSE the FASR layer this engine already has, not invent a state model.** Square
dancing already has a formal four-part state - **FASR** = Formation + Arrangement + Sequence + Relationship,
"based on terminology approved by Callerlab" (`all8.com/sd/calling/fasr.htm`) - and its definition of Formation
is *verbatim this problem*: *"where dancers are standing on the floor relative to each other; which direction
each of the dancers is facing relative to the others."* This repo already implements it: `analyzeFasr`,
`fasrKey`, `homeFasrKey`, `fasrooOf`, `boardForFasrCode`, `CANONICAL_INDEX`. **And it already learned the one
trap the summary of FASR invites** - formations are *rotation-invariant* ("Formations rotated 90, 180 and 270
degrees are still the same formation"), so **a FASR code admits four boards and three of them are the wrong
placement**. That is not a hypothesis here: PLAN.md 4 recorded it as *"a code admits four boards and three of
them are the wrong placement"* and fixed it with a measured `CANONICAL_INDEX`, and `fasrooOf`-injectivity was
probed to 80 of 80. So the rule is the one already written down - **store the SETUP (FASR + the couple-to-spot
assignment) and derive FASROO for display only** - and the editor's pin-state and validation should read the
existing layer rather than grow a second opinion about where the dancers are.

**D3. The hard constraints are STRUCTURAL, not solved.** A pinned joint stores a **reference** to a formation
spot, not coordinates, and the position/facing are *read* from it - so "exactly" cannot drift. A free joint
stores a world point. Precedent: SolveSpace special-cases any equation solvable by forward substitution and
only runs Newton on the genuinely coupled remainder (`solvespace.com/tech.pl`). The alternative - a numeric
constraint solver - is **history-dependent**: the branch is chosen by the initial guess, which is FreeCAD's
documented "flipping" problem. For 6 unknowns per segment and tens of segments that price is not worth paying.

**D4. The CIRCLE is ONE object over a RUN of moves.** Select the run, press *circle*: fit (Pratt/Taubin on
world samples - **not** Kasa, which is biased toward small circles on partial arcs), show centre and radius,
and edit **radius + side**. That is exactly the true degree of freedom: a circular arc between two fixed
points has **1 continuous DOF (the radius) and 1 discrete one (which side)**, and the endpoint headings are
then *derived*. Storage splits it into <=90deg cubics, because the standard construction's error is O(theta^6)
- a quarter is 2.7e-4 of the radius, a single cubic semicircle is **100x worse** - and **the centre and radius
are the source of truth**, never the cubics, or repeated editing bleeds the shape off the circle (which is
what mainstream 2D tools gave up on and why their circles stop being circles).

**D4a. THREE arc gestures, one storage.** The prior art converges on a clear split, and the corpus supports it:
- **Tangent-continuation is the DEFAULT for one move.** The previous move's exit tangent is already data, so
  the user supplies **one** input and gets a G1-continuous arc - this is AutoCAD's "press Enter at the start
  prompt" and BricsCAD's "follow last point" (`help.bricsys.com/.../arc-command`), and it is exactly the
  gesture for "dance around the circle", where the joint is measured to be smooth anyway.
- **Bulge-drag is the general "make this an arc".** Drag the curve sideways; the distance sets the radius and
  the direction sets the side, with **no sign convention at all**. This is the same family as the 3-point arc
  (AutoCAD's most intuitive option) but continuous rather than click-commit.
- **A radius field, with the flip NAMED, not hidden.** `Start-End-Radius` is two-valued in radius (minor /
  major) and two-valued in side: four arcs. AutoCAD resolves side by endpoint pick ORDER and flips CCW/CW on
  Ctrl, and SVG formalises it as `large-arc-flag` + `sweep-flag` - two flags that are *not geometric
  quantities*, which is the W3C's own complaint about them (`github.com/w3c/svgwg/issues/945`). Ship the
  radius field **with a visible minor/major and side toggle**; shipping it alone is the classic "I typed 5 ft
  and got the wrong arc".

**D4b. And the orbit primitive's parameters are already PUBLISHED: direction, fraction, beats.** CALLERLAB
states the rule - *"While executing each call, the dancers should take one step for each beat of music"* - and
then publishes the table: **Circle** 1/4 = **4** beats, 1/2 = **8**, 3/4 = **12**, Full = **16**; **Star R/L**
1/2 = 4, 3/4 = 6, Full = 8; **Arm Turn** 1/2 = 4, 3/4 = 4-6, Full = 6-8; **Allemande Left** 1/2 = 4-6, 3/4 =
6-8, Full = 8; **Cast Off 3/4 = 6**. So an orbit's natural parameterisation is **(direction, fraction of a
circle, beats)** - not degrees, and not a handle length - and the beats are *derivable* from the fraction by
the caller's own rule. This is also the only place in the whole survey where an orbit primitive appears in a
published schema at all: MovementXML's `set-path` carries `type in {straight, circular, stationary, any}`,
`strict` (false = ad libitum), `direction in {clockwise, counter-clockwise, any}`, a start/duration and a
nested payload for what the dancer does *while* orbiting - **and no centre**, which is the field to add,
because a square-dance orbit is always around something (a named spot, a partner, or the centre of the set).

**AND THE OVER-DETERMINATION IS REAL, WHICH IS WHY THE TWO CHANNELS MATTER.** If the *facing* is also pinned
to the travel tangent at both ends, a circle through two fixed points is **over-determined by one** (5 unknowns
of centre+radius+angles, 6 equations) and generically **has no solution** at all. This engine keeps facing in a
**separate channel**, so the circle survives - and the UI should say *which* constraint is being relaxed rather
than silently producing a non-circle. That is the concrete payoff of the two-channel model the corpus uses.
FreeCAD's own worked algebra for the same primitive says the same thing from the other end: an arc has 5 DOF,
two endpoint coincidences eat 4, and the **last one has to be the radius** - a third coincidence is an
over-constraint (`wiki.freecad.org/Sketcher_CreateArc`).

**D5. FACING is a first-class per-joint control with three states.** *along travel* (derived), *an absolute
heading* (pinned, and what a formation declares), *an authored profile* (the `rotate` curve). The panel shows
the turn as a number and lets the heading arrow be dragged; the curve is generated. The prior art is
unanimous that this must be a *proper channel with an explicit off*, not a derived read-only consequence:
CSS `offset-rotate` is independently animatable and names the reversal (`auto | reverse | <angle>`, where
`reverse` is literally `auto 180deg`); Unity splines have `Align To = None`; Maya replaced a boolean
`useNormal` with a five-mode enum because "which way is forward" is not a checkbox. **And the failure mode to
avoid is the top reported complaint in this whole area: an auto-facing rule and a manual heading that both
write the same channel and are silently combined, so the user cannot debug it.** So: one writer per joint, and
"face along travel" is switched OFF *visibly* when a heading is pinned.

**D6. Continuity defaults to SMOOTH with NO OVERSHOOT.** Blender's `AUTO_CLAMPED` is the right precedent: it
refuses to let an automatic handle overshoot past the fixed point, which for us means the path may not bulge
past a pinned formation spot. A corner stays available and explicit. Note the documented trap: Inkscape's
switch to auto-smooth **repositions handles and deforms the path**, and touching a handle silently drops the
auto status (`bugs.launchpad.net/inkscape/+bug/654765`). **A mode switch must never move geometry.**

**D6a. Do NOT show a "degrees of freedom" badge and expect it to work.** Measured elsewhere and worth
inheriting: of 40 engineering students, **only 20% could correctly judge whether a sketch was fully
constrained, and training did not significantly improve it** (`cad-journal.net/files/vol_18/CAD_18(3)_2021_612-623.pdf`).
So the panel must show the *geometric consequence* - a ghost of the curve the constraint allows, or the
reachable handle - rather than a symbol the user is expected to interpret. Colour (Onshape's blue/black) is a
useful ambient cue and nothing more.

**D6b. Every refusal and every silent no-op has to be on screen.** "The tool did nothing and did not say why"
is the single most repeated failure in the survey (Blender's Follow Path inert until *Animate Path*; AE's
auto-orient inert when a position expression exists; 3ds Max's bank only working when `follow` is true). This
repo already writes reasons into the status line for the arc lock and the coordinate gate; that is the
established pattern and it must hold for all of the above.

**D6c. The handle/endpoint collision needs more than the mode toggle.** The measured problem (5.5% of corpus
curves have a control point sitting on its own endpoint, and a straight segment's handle retracts *exactly*
onto the anchor) has four standard fixes, all better than one toggle: **don't draw handles until the joint is
selected** (Figma creates handles on demand, so a resting handle never covers an anchor); **give the joint
priority over its own handles** (Onshape: non-fully-constrained points are prioritised over overlapping
fully-constrained ones); **Ctrl-click retracts a handle to zero and Shift-drag pulls a hidden one back out**
(Inkscape); and **Tab cycles the joints** so there is always a keyboard route. The existing `controls / ends`
toggle stays as the coarse switch, but it should not be the only answer, and **snapping must have a bypass
modifier** (Inkscape's "can't disable node handle snapping" is a documented pain).

**D7. Do NOT build:** a general CAD constraint solver (D3 gives the structural answer for every case the corpus
has); SVG's `A` arc parameterisation *as the internal storage* (four candidate arcs, two non-geometric flags,
silently rescaled out-of-range radii, no way to express a full circle) - keep it only as the interchange
encoding, which is exactly what D4a's "store it as two flags" means; clothoid/Spiro/G2 blends (at walking speed
with radii of 1-3 units the lateral-jerk step is imperceptible, the separate facing channel already decouples
visible turn smoothness from path curvature, and Inkscape's own manual concedes its Spiro implementation
"sometimes yields wild curves"); and **destructive arc baking** - "a shape can always be converted to a path,
but a path can never be converted back into an object" (`inkscape-manuals.readthedocs.io/.../objects-to-paths.html`)
is the documented regret of every tool that took this shortcut, and D4's radius/sweep editing dies with it.

**D7a. Keep the editor 2D, and treat that as a feature.** Every "it flipped" / "it rolled" / gimbal complaint
in the survey is an artefact of the under-determined tangent-to-orientation map in **3D**. In 2D the heading is
one scalar and the flip is one named sign. The POC already has the flat view (`ORTHO_CAM_HEIGHT`,
`squareCamera2D`); path authoring belongs there.

**D7b. And the specific avoid-list the prior art contributes,** each of which is a documented dead end in a
sibling domain: **endpoint-only authoring** (CSDS - cannot animate); **straight-line interpolation between
formations** (wrong for every orbital call, and one of the five walk-through mechanisms already closed here);
**free-form curves with no formation snapping** (Pyware can afford bespoke curves, this repo has 500+ reusable
calls); **hand-edited XML as the only authoring path** (keep it as import/export - which is exactly what
`callToXml` already is); **a duplicate animation per starting formation** where the Facing Couples or Ocean
Wave rule would compose it; **absolute floor coordinates inside a movement primitive** (it kills reuse across
formations, which is the whole reason the local frame exists - and D2 must therefore not leak world
coordinates *into* `moves.xml`); and **treating styling as decoration**, since paths, facings, hands and beats
are the contract. A music/caller console is explicitly *not* this tool's problem.

**The cheapest first step, and the one that de-risks the rest:** D2. It is a change of *coordinates*, not of
feature, it is exactly checkable against the whole corpus, and every later item is easier in world space.
`poc/tools/wysiwyg-path-probe.mjs` part 6 already pins the premise it rests on: over **1037564** samples the
stored local curves and (boundary pose + world curve) agree to **7.2e-15 units** and **4.1e-13 deg**, so the
two spaces carry the same information and the editor may move between them freely.

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
  **AND THE RING-ORDER TEST IS RIGHT ABOUT ITS BOARDS — checked by hand in round 21, which moves the
  owner elsewhere.** The two "out of sequence" refusals are `figm143` (`Ocean Waves`) and `figm215`
  (`Trade By`), and in both the couples' centres snap to four distinct axes in CLOCKWISE order:
  `figm143` has couple 1 NORTH and couple 3 SOUTH (swapped), `figm215` couple 1 SOUTH, 2 WEST, 3
  NORTH, 4 EAST (a rotation of the clockwise reading). No single wheeling brings them home, so the
  refusal is correct and no relaxation is wanted. What is worth knowing is WHERE those boards come
  from: **both are the board immediately after `Swing Your Partner`**, and `Swing Your Partner` is the
  IDENTITY in this engine (`coded-moves.ts`: a partner swing is a full turn, so in a net model of
  position + heading it moves nobody), so the order Promenade judges is the PRE-swing order. That
  makes the swing's unmodelled end pose the owner of these two — the fidelity gap already recorded
  against it — and it also says a LOCAL end pose cannot fix them: a swing is a per-couple action and
  cannot change the couples' angular order round the centre. Rule it out before spending a phase.

---

## 6. Recommended order

**DONE: Phase A's head (`Heads Touch 1/4`), Phase E item 2 (the per-couple gender rule) and Phase E
item 1 (the temporary couple number, +2 figures).** One attempted phase is REFUTED and recorded: the
swing's local closure end pose (103 → 95). Also DONE, and outside the phase list because it is
POC-facing rather than census-facing: the walk-through defect's **mechanisms 1, 2 and 3** (the
parts-based `Swing Thru` animation, the coded calls that applied but animated nothing, and the
parallel grouping the animator re-derived differently from the applicator), and **the ring's travel
coming from the CALL** (the full `Promenade` from a squared set now wheels a full counter-clockwise
circuit instead of standing still, and a ring move is no longer routed as an exchange). **The ring's
couples are now read from the FLOOR too**, behind a guard, which is free: figures stay at 116. The
rigid-pair WHEEL that was supposed to go with it is REFUTED by measurement and recorded in the
walk-through section - it is worse on collisions and peak speed and cannot meet its own gate while
`promenadeHome` homes every dancer to its own declared spot. Then, in this order:

1. **Phase A's remaining queue** — the body errors the `setup-split.mjs` prefix scan names next
   (`Allemande Left` 3, `Sides Touch 1/4` 2, `Girls Run` 2, `Square Thru 4` 2, `Centers Swing Thru` 2,
   `Sides Right and Left Thru` 2).
2. **Phase B** — the authoring queue, call by call, definition first; run `facing-audit.mjs` and a
   chain trace before each row.
3. **Phase C item 3 (the Ocean Wave Rule)** and **Phase D** — the named missing calls (`unknown call`
   is 5, so this is bounded work). Phase C items 1 and 2 are DONE and the per-PAIR/per-ROLE gender
   work is DONE; Phase C's active-set item is the last convention left.
4. **Phase C** — the two conventions; design before code, both have board-wide blast radius.
5. **`Swing Your Partner`'s end pose** — needs a corpus- or reference-pinned model, not a local rule.
6. **The walk/walk agreement pass (Mechanism 5) is CLOSED** — the predicate alignment took phantoms
   2466 → 11, dropped 400 → 6 and silent 27 → 0 with the census unmoved. What is left of it is the
   ONE remaining difference: `parallelApply` also requires every SUB-APPLY to succeed, which
   `matchingVariantInfo` cannot cheaply check. Closing that fully means having the walk take its
   variant from the apply's own `ApplyResult.parallel` (which now exists) instead of re-deriving it,
   which is a small change with a much larger blast radius because `matchingVariantInfo` also feeds
   the BEAT COUNT. Do it only with the census, get-out and FSM measured either side.
7. **PIN THE ORIENTATION — DONE for the SELECTION and for the READOUT.** Every FASR code admits 4
   boards — the 4 relabellings — and `boardForFasrCode` used to silently return `boards[0]`. all8's
   canonical board IS among the four (index 1 for `[L1p]`, character-for-character its published
   diagram); only the SELECTION was wrong. **The selection is closed: `CANONICAL_INDEX` is the
   measured index per code and `boardForFasrCode` routes through `canonicalBoard`, reproducing All8's
   own board on all 28 published diagrams** — 28 and not 26 because the two `[P]` refusals are gone
   (see the `[P]` entry above). **The `[P]` reference pair is decided and recorded**
   (`REFERENCE_PAIR_SPOTS.P`, All8's own mental Centers Pass Thru reduction), `fasrooOf` no longer
   refuses `[P]`, and **the ORIENTATION CONSTRUCTION IS FIXED** — see the dedicated entry above for the
   measurement and the two witnesses. `REFERENCE_PAIR_RULES` CLASSIFIES a board but is never used to
   SELECT one, and the same rule applies to the `[P]` reduction — it is a readout, and
   `boardForFasrCode` uses the measured `CANONICAL_INDEX`, not it.
   The geometric "nearest its home bearing" rule was TESTED against all six published [L] diagrams
   and REFUTED (0 of 6), and re-measured at 3 of 26, so do not use it.
   **MEASURED, AND THE "INDEX 1 / INDEX 2" HYPOTHESIS IS REFUTED.** `test/tools/canonical-board-probe.mjs`
   rebuilds all8's own board for every one of
   the **26** corpus alignments that publish a diagram (`boardFromDiagram`, the same path
   `alignment-boards.mjs` uses), locates it in `boardsForAlignment`'s enumeration, and reports the
   CYCLIC RELABELLING that takes `boards[0]` to it. The result is not index-based and not
   arrangement-based:
   ```
     sequence 1 (in)    -> relabel +3     (10 of 10)   not 1
     sequence 2 (out)   -> relabel +2     (10 of 10)   not 2
     sequence 3, 4      -> relabel  0     ( 6 of  6)
   ```
   It holds across every formation letter (`[B] [L] [W] [F] [L.F] [P]`) and every arrangement number
   (`0`, `1`, `2`, `5`), while the INDEX varies with the letter and the arrangement and is therefore
   the wrong key. The in-sequence/out-of-sequence indices are only *usually* 1 and 2 (8 of 10 each)
   because index and relabelling coincide on those codes by coincidence of construction order.
   **THE SEQUENCE-ALONE READING WAS THEN REFUTED TOO, and the shipped form is a per-code table.**
   `[B]` puts its in-sequence `p` code at index 2 and its `c`/`r` codes at index 0, while
   `[L] [W] [F] [L.F]` put theirs at 1 — so the relabelling is not a function of the sequence, and
   `(letter, relationship)` is not a function either (`canonical-rule-probe.mjs` scores each candidate).
   What ships is `CANONICAL_INDEX`: the measured index per code, with a fallback to `boards[0]` for a
   code it did not measure. Sequence 3 and 4 codes all measure at index 0, which is worth knowing
   because it means the CURRENT behaviour was already All8's board for them. **The rule is measured on
   26 diagrams across six formation letters and four arrangement numbers**; the honest next step before
   it is trusted further is a check on a second source (below).
   **AND ONE READ-WITH-CARE NOTE, because it looks like a contradiction and is not.** The old
   `fasr-determinism-probe.mjs` prints, next to All8's own drawing, `boards[0] ... facing pairs
   1-2 3-4`. That is the PRE-FIX board, and it is exactly what the entry above records as the
   "offset by one" conflict. After the fix `boardForFasrCode` returns the board at `CANONICAL_INDEX`
   instead, which `l1p-board-diagnostic.mjs` confirms dancer by dancer for `[L1p]`: the built board is
   the enumeration's index 1, couples 3-3-4-4 down one column and 2-2-1-1 down the other, facing pairs
   `1-4 2-3` — All8's board. The probe still reports on `boards[0]` because that is what it was written
   to measure; it is not reporting a live disagreement.
   **THE SECOND SOURCE IS REAL BUT NOT YET DECODED, AND THE GAP IS NOW PRECISE.** All8's "16 Possible
   Pairings" pages (`16com_<b|l|f|w|p>.htm`) publish a couple-numbered grid per state — every spot is
   an `<img>` whose `alt` is `<gender><facing><couple>` in EITHER order (`<G4` and `4B>` both occur) —
   plus the state's own FASR label and resolve hint, so they cover all 16 states including sequences 3
   and 4. `test/tools/sixteen-states-board-probe.mjs` parses all of it (16 labelled cells of 8 tiles per
   page, tiles read correctly), and the TILE ORDER is now pinned by the FACINGS: the page draws the
   frame with its two tile-rows in the opposite order from the engine's lattice, and reading it that way
   reproduces the page's facing sequence exactly. **What is still unsolved is the CELL-to-SPOT mapping.**
   The page's eight tiles then land on the engine's eight spots with the same gender at every spot —
   which is the encouraging part — but the couple-to-spot pattern is `a,b,b,a,c,d,d,c` on every one of
   the engine's boards and `a,b,a,b,c,d,c,d` on the page's, so no cyclic relabelling maps one to the
   other and the spots are permuted by something not yet identified. Until that permutation is found
   this source has NOT confirmed or refuted the rule, and it is recorded that way.
   **SHARPENED, and it is worse than "unsolved": for `[P]` the page's own drawings are not all the
   get-out pages' boards at all.** The sprite convention is now pinned
   (`d1/<n><dir>.gif`, `couple = floor(n/2) + 1`, even = boy, odd = girl, `dir` = facing — confirmed
   by the user and consistent with the page's own "At Home" drawing, where `0n` is the `#1` boy All8
   marks red). With it, the four `[P]` states BOTH sources draw can be compared directly: `P1c` and
   `P2r` agree up to a uniform couple relabelling, **`P3p` and `P4p` do not** — read in document order
   those two cells are not valid boards at all (a couple's two dancers end up two columns apart with
   another couple's boy between them) — and **no bijection of the eight tile slots onto the eight
   spots reconciles all four**: `p-tile-order-probe.mjs` searches all 40,320 and finds **zero**. So the
   blocker is not that the mapping is unidentified but that no single mapping can exist, which means
   the page's tiles are laid out per state rather than on one lattice, or the page disagrees with
   itself. Either way this source cannot be read as boards yet, and the `[P]` rule rests on the four
   published get-out diagrams plus their four published conversion lines.
   **The gating argument, however, does not depend on it:** the fix is confined to sequences 1 and 2,
   and those are measured across six formation letters and four arrangement numbers in the corpus.
8. **`boardFromMatchables` uses the ARRAY INDEX as dancer id** (`id: i + 1`) for any geometry that is
   not home-like, so a named formation stood up from the library has arbitrary ids and reports
   `sequence: unknown`. At SETUP the FASR properties should place the dancers, not the index. 129 of
   the 134 named formations are in this state.
9. **A SETUP per formation, and a COMPLIANCE LEVEL per module** — the design section above. NOTE THE
   NAME: what a formation needs is a **setup** (FASR + couple numbering, all8's Orientation), not a
   FASR code — a code admits four boards and three of them are the wrong placement. The engine can
   already BUILD an identified board from a code (`boardForFasrCode`); what is missing is the
   association from a formation NAME to its canonical setup, and any way for a module to say how much
   of it it needs. `Normal Lines` → `L1o` is confirmed by property; `Zero Box` is all8's `B1c` by name
   — but both wait on item 7 before they can be pinned to a spelling.
10. **`Right and Left Grand`'s final board** — from `Ocean Waves` it leaves all eight on a ring at 45°
    increments that `knownFormation` cannot name, while `ceder-7046` declares `Static Square`. Decide
    whether the grand's end rotation is wrong or recognition only has an axis-aligned circle template.
    Small, and it is the last thing between that module and running as published.
11. **Fix the second "arrangement"** — `analyzeFasr`'s field is a prose count that cannot distinguish
    `gBgB` from `BgBg`; `alignment.ts` has the real Callerlab number. One name, one meaning.
12. **The final-frame jump** — 7 (board, call) pairs in `anim-convergence.mjs`, every one a CIRCLE call
    plus `Lead Right from Eight Chain Thru`. Small (worst 0.1476 units) but it is a teleport on the
    last beat, and it names one cause: the pose just before the end is not the pose `applyWholeBoard`
    stores. Start from `poseFor(t, dancerBeats(t))` versus `endPoses(variant)`.
    **AND THERE IS AN EIGHTH THAT LIST CANNOT SEE, because it is HEADING-ONLY (round 41).** The seven
    above are measured by `anim-convergence.mjs`'s POSITION gap, so a final-beat heading snap with no
    movement is invisible to it. `behaviour-audit.mjs`'s check measures both, and sweeping the whole
    legal set (2074 pairs) finds exactly one offender: **`Cloverleaf` from a `3/4 Tag` snaps dancer #8
    by 90.00 degrees on the final beat with dPos 0.0000**. Verified under BOTH the harness's
    basename-keyed catalogue and the engine's own title-keyed one, so it is a real engine defect and
    not a registration artefact; pinned as `KNOWN_FINAL_FRAME_JUMPS` in `behaviour-audit.mjs` so it
    can only shrink deliberately. It was ALWAYS there — the check used to stop at the first 400 calls
    in formation order, so widening `legalCalls` moved its sample onto it. Two consequences worth
    having: a final-frame check must compare HEADINGS as well as positions, and a gate whose sample is
    a prefix of a set another change can grow is not measuring what it claims.
13. **Phases F, G, H, I, J** — vocabulary, FSM/determinism, the solver index, decoder residue,
   tie-break sweeps; independent of each other and of the figure work.
14. **Phase L** — the phrase tams. Last on purpose: it is the only route to the star and `Separate`
   chains, but it is a new mechanism (what is a call?) rather than a fix, and it should be designed
   against a second witness before any code. Its cheap half is the decoder side — the 4 unread cells
   (`figm75 --1/2`, `figm170 S-`, `figm184 --Keep`, `figm226 H-meet-T1/4`) are Phase I work and two of
   them sit in figures Phase L would otherwise unblock.
15. **HOW MUCH A CODE CAN BE TOLD APART — measured, and it names a reader gap nobody had priced.**
    `fasr-injectivity-probe.mjs` enumerates all 576 boards of a formation at a fixed arrangement
    (4! boy placements × 4! girl placements) and classifies each, which turns "does a code name a
    board?" into a count:
    ```
    [P] [B] [L] [W] at arrangement 0, 576 boards each
      sequence read as ASYMMETRIC (no FASR digit at all)   512
      named by a (sequence, relationship) code              64   as 16 classes of 4 boards
    ```
    Four facts, all measured:
    - **a named state is always a class of exactly 4 boards**, and for `[P] [B] [L]` the four are
      always whole-set relabellings of each other. So a code names a class, never a board — which is
      the whole reason `CANONICAL_INDEX` exists, and why selection must go through the couple-to-spot
      assignment.
    - **out-of-sequence is NOT where the notation weakens.** Sequences 2, 3 and 4 are 4 classes × 4
      boards each, exactly like sequence 1: the four-fold freedom is a property of every state, not of
      the scrambled ones.
    - **512 of 576 boards are ASYMMETRIC** — no sequence digit exists at all, which is All8's own
      "any other order … the sequence is asymmetric". All8's 96 states describe only the symmetric
      slice of the space, which is why All8 started the separate "bang" notation. Not actionable, but
      it is the honest size of what FASR covers.
    - **`[W]` at sequences 3 and 4 is a genuine collapse: 16 boards share one bucket, and those 16 are
      NOT relabellings of each other.** The relationship letter cannot be read there, so the class is
      keyed on (arrangement, sequence) alone. All8's `16com_w.htm` lists all 16 `W` states and its
      wave rule says to **Rear Back** before evaluating relationship, which the reader does not do — so
      this is most likely an ENGINE gap rather than a notation limit, and it is the same shape as
      `[P]` before All8's reduction was recorded (which took `[P]` from 10 classes — two of them
      16-board buckets — to 16 classes of 4).
    **Work:** read the Rear Back convention and see whether the wave relationship becomes readable at
    sequences 3/4; if it does, it is a reader fix with a measurable resolution gain; if it does not,
    the limit is the notation's and gets recorded. **Gate:** the class sizes, pinned in
    `fasr-injectivity-probe.mjs`.

The closing judgement from the last rounds, kept because it should shape expectations: **the
remaining refusals are STACKED.** A coverage fix at call N generally reveals a different defect at
call N+1 rather than completing the figure, so the figure count moves less than the number of defects
fixed. Treat it as a **lagging indicator**; the leading indicators are the cause table, the
poisoned-chain count and `facing-audit.mjs`.

### THE `asymmetric` SELECTOR ON THE CALL: HALF THE SET, OR EVERY DANCER (BUILT AND GATED)

Asked for: *"a tam.asymmetric selector added to the call. This decides if the dancers are exported explicitly or as a
taminations half set ... If the asymmetric flag is set, then this must be included in the exported tam properties. Put
the asymmetric checkbox before the tables Select label. Default to unselected."*

**THE FORMAT ALREADY SAID THIS, AND THE ENGINE ALREADY READ IT.** `<tam asymmetric="true">` means "take the written
dancers as the whole set" (symmetry 1); with the attribute ABSENT the written shape is the HALF and the reader
completes it by rotating 180 degrees about the board centre (symmetry 2, the default). `tam.symmetry` carries it and
`buildCallImpl` already gates its completion on `mirror && tam.symmetry === 2`, so what was missing was only a
WRITER that could emit the half form and a control to choose it. Until now `callToXml` always wrote every dancer out
and declared `asymmetric="true"`, because that is always correct.

**WHAT WAS BUILT.**

- `callToXml(call, name, { symmetry })` - `1` (the DEFAULT, unchanged) writes the whole set and the attribute; `2`
  writes the half set and NO attribute, which is the corpus's own convention.
- `halfSetReport(call)` is the precondition, public so the UI can explain a refusal rather than silently do something
  else. It checks the two halves pair by INDEX (`i` with `i + n/2`, the pairing `mirrorToFull` creates - the only one
  a half-set text can reproduce): each pair is the 180-degree rotation in POSITION and HEADING, the same GENDER, and
  the **same path** - because a half-set tam writes one path per written dancer and the reader replays it for both
  halves, so a hand-edited second half fails even when its start poses still pair up.
- A refusal is TOTAL and silent-free: `callToXml` with `symmetry: 2` on a set that is not a half writes the WHOLE set
  with the attribute, and the panel says why before the export.
- The checkbox is `#edAsym`, placed immediately before the tables' `Select` row, UNTICKED by default, and it opens on
  what the loaded call itself declares (`symmetry === 1`), so a call that is already explicit shows as explicit.
- `poc/src/data.ts`'s `rebuildInstance` now passes `mirror: true` instead of `false`. This is the load-bearing half:
  a half-set export is FOUR dancers in the text, and `false` would read it back as four. Passing `true` is safe for a
  whole-set export because the DECLARATION refuses (`symmetry === 1`), which is the rule the attribute exists for.

**THE GENDER PRECONDITION WAS WRONG TWICE, AND THE SECOND TIME WAS A REAL DEFECT.**

1. `boys === girls` was the first rule, from reading "equal numbers of boys and girls". It refuses exactly the sets
   the half-set form is for. **CORRECTED by the requester:** *"What I mean is half the number of girls and half the
   number of boys. This covers calls that have 6 dancers all together. So if the board has 4 boys and 2 girls, it will
   create a half set of 2 boys and 1 girl."* So the rule is that **each gender's count must be EVEN**, since the
   pairing pairs a dancer with another dancer of its own gender - and a six-dancer set of 4B+2G writes **2B+1G**.
   Pinned on that exact case in `editor.mjs` §29.
2. The panel reported **"writes all 8 dancers"** as a literal, on a six-dancer board. Reported from the running app;
   the count is the board's now, and pinned so the literal cannot come back.

**A THIRD REPORT FROM THE APP, AND IT WAS A CSS CONTRACT RATHER THAN THIS FEATURE.** *"The asymmetric checkbox
obscures the end of its label."* `#hud label` is a 44px column, and the stylesheet widens a checkbox label back to
`auto` with `label:has(input[type="checkbox"])` - a selector that only matches a **NESTED** input. The row was
written `<label for=...>Asymmetric</label><input>` with the input a SIBLING, so the rule did not match, the label
stayed 44px wide, and the box covered the end of the word. It is nested now, which is the app's own convention
(`<label><input/> Hide dancers</label>`), and the probe pins the nesting rather than the appearance.

**GATES.** `poc/tools/asymmetric-export-probe.mjs` (new, auto-discovered by the POC runner) reads the control's
placement and the path the value takes through `editor-ui.ts` / `tam-xml.ts` / `data.ts` - and MEASURES the format on
a mirror-completed call: both written forms, the gender split of the half, the round trip through a reader that is
allowed to complete and one that is not, and the refusal. `engine/test/editor.mjs` §29 does the same from the engine
side, including the six-dancer case. Engine suite: 31 harnesses green. `poc/verify.cjs`: all checks passed.

**AND ONE POC PROBE IS RED AT HEAD FOR A REASON THAT IS NOT THIS WORK, REPORTED RATHER THAN RE-PINNED.**
`run-circle-probe.mjs` fails 2 assertions that pin OFFSET orbits (`offsets.every(o => o > 0.5)`) and now measures
`0.000`, i.e. the symptom it describes is gone. It is not this change: every hunk in `engine/src/editor.ts` is at line
1839 or later while `fitCircleRun` is at 672 and `setRunCircle` at 752, and the probe's only asset input,
`poc/src/assets/ms/circle.xml`, was last changed by the BOOK commit `3781730` (15 insertions, 21 deletions). The
probe reads its symptom from that file, so re-authoring the asset is what invalidated the pin. Left red deliberately:
re-pinning another workstream's symptom probe would hide the consequence of their change rather than record it.
### A FACING EDIT HOLDS THE FOLLOWING TRACE (BUILT AND GATED)

Reported twice, and the second report is the one that identified the real defect: *"The end facing control is
affecting the placement angle of the next follow path. I dont think this should be the case. It should only
affect the rotation of the dancer, not its follow direction."* and then *"this prevents me using the facing
controls i.e. I cannot face the dancer without corrupting the next follow path. Many of the existing facing
paths are impossible to create with this interaction."*

**FIRST, WHAT IS *NOT* THE BUG, because the earlier answer got this far and no further.** A move is authored in
the dancer's own frame at the move's start (`types.ts`), and `poseFor` composes `m = m * translateBy(p); m =
m * rotateBy(a)` per move (`core.ts:98-110`), so the heading a move ends on IS the frame the next move is played
in. A turn therefore re-places what follows - `Veer Left` from a different facing goes to a different spot - and
that is the format, measured by `poc/tools/facing-chain-probe.mjs` and pinned by `engine/test/editor.mjs` 19,
which warns that *"anyone tempted to fix the swing has to come here and delete a measurement first."* Nothing
about that changed.

**THE DEFECT IS THE GESTURE, AND IT IS AN INVARIANCE.** Because the same angle turns the facing AND the
following path, the angle BETWEEN them is a constant of the data - so the facing control could not set the one
relationship a facing expresses. MEASURED (`Circle Left`, move 2, +10.000deg on the end facing):

```
the heading move 2 ends on: -45.153deg -> -35.153deg (a change of 10.000deg)
move 3: (-2.4047, 1.0128) @ -0.31deg -> (-2.7527, 0.9840) @ 9.69deg   (heading shifted 10.000deg)
move 3: drawn from 89.74deg to 99.74deg (swung 10.00deg), same length 2.0034 -> 2.0034
```

The facing change and the path's swing are the same 10.000deg, so the facing-versus-follow-direction angle did
not move AT ALL - -90.042deg before and after. That is why the controls were unusable, and it is pinned as such
in the probe's held/unheld comparison.

**THE FIX: COMPENSATE THE EDIT, NOT THE COMPOSITION.** `holdFollowingTrace(call, dancer, k, delta)` rotates every
move AFTER `k` about its own start by `-delta`. A later move's floor point is `p0 + R(theta) * local`; the edit
takes `theta` to `theta + delta`, so `local` to `R(-delta) * local` leaves the product unchanged - same start,
same shape, same floor direction, same end point. MEASURED: every later boundary stands where it did (worst
2.4e-15 units), every later path still points where it did (worst 2.8e-14deg), every later heading moves by
exactly the edit (worst 4.7e-16deg), and the call's end formation does not move. The facing-versus-follow angle
becomes settable: -112.62deg to -102.62deg held, against -112.62deg unheld.

`delta = 0` is the identity. No cascade is needed: a later move with no facing curve has its heading
contribution fall by `delta` while the incoming frame rises by `delta`, and one WITH a facing curve contributes
what it did before.

**WIRED IN ONE PLACE.** `commitMoveChange` already knows the curve kind, so `foldMoveChange` takes it and holds
the trace on a `facing` write only - a TRAVEL write already holds its own tail through `moveCurveEnd` (section
22) and must not be compensated twice. That one point covers the Facing tab's coordinate fields and the drag.
The delta is PER DANCER (the selection shares local numbers, not the frames they land in), and it compounds
through a drag because each pointer move writes the facing absolutely and holds the step since the last one:
MEASURED, three successive pointer moves leave the tail 1.8e-15 units from where it began.

**A SECOND DEFECT IN THE SAME FAMILY, FOUND WHILE CHECKING.** `swingArcAboutStart` wrote a facing as
`{ ...original.translate }` - a copy of a travel curve - whose first control has a `y` the FORMAT HAS NO SLOT
FOR. `tamination.dtd` declares the rotate as `cx3, cx4, cy4, x4, y4`, `bezRotAttr` emits those five and never
`sel.cy1`, and `facing-handle-probe.mjs` asserts every facing in the corpus has `cy1 === 0` for exactly this
reason. So the frozen joint was lost the moment the file was re-read. It is written through `facingFromTravel`
now: turn the curve so its start lies on the forward axis (`cy1` goes to 0), then turn its exit tangent back so
the heading change it ENDS on is the one it started with - both ends held, and section 24's "the frame the arc
is played in is unmoved" still passes. Section 30 adds the round trip section 24 lacked.

**AND THE ONE CASE THE HOLD CANNOT SMOOTH, REPORTED RATHER THAN REWRITTEN.** A following move with NO facing
curve faces along its own path, so holding its path holds its heading and the joint steps by `delta - a0`; the
facing IS the path there, so compensating would undo the edit. The panel now prints a measured `facing joint:`
line - silent when both joints are smooth, and otherwise naming the cause and the size - and a facing drag sets
a status line saying what turned and that the trace was held, so the new behaviour is visible rather than merely
absent.

**TWO EARLIER REQUESTS WERE MOOT, AND THE REQUESTER SAID SO.** Making the start facing control free, and syncing
a move's start facing with the previous move's end facing, both presume a start facing that does not exist:
`poseFor` breaks out of the segment loop at `t = 0`, so `poseFor(d, 0).heading === d.angleDeg` - the FIRST
move's facing is the FORMATION's declared one, and every later move's is the previous move's end heading. So the
`r1` rail stays and there is nothing to sync. The rail reason and the swing are both already stated in the panel
(`editor-ui.ts` note); that they were read as a bug is why the joint line is a number rather than more prose.

**TWO PRE-EXISTING REDS, PROVEN NOT TO BE THIS WORK, NOT RE-PINNED.** `engine/test/editor.mjs` section 16b fails
2 checks - `the track is now invalid` (1.99 against a `> 2` threshold) and `a dancer whose first move has ZERO
beats` (2.44 against `> 3`) - and `poc/tools/run-circle-probe.mjs` fails 2 more pinning OFFSET orbits it now
measures at `0.000`. PROVEN pre-existing by stashing every file of this change and re-running: the same four
failures appear at HEAD engine + HEAD harness. All four read `poc/src/assets/ms/circle.xml`, which the book work
re-authored (`3781730`, `67e9ab9`, and an in-flight edit). Deciding whether the committed or the dirty asset is
responsible would mean temporarily stashing somebody else's uncommitted file, which was deliberately not done.
They are the book work's to re-pin.

### A REVERT BUTTON THAT PUTS BACK THE LAST 50 CHANGES (BUILT AND GATED)

Asked for: "Add a revert feature to the poc call editor so I can undo the last 50 UI changes."

**ONE PLACE PUSHES THE SNAPSHOT, BECAUSE THERE ARE EIGHT WAYS TO EDIT AND ONE WAY TO DRAW THEM.** The tile's
fields, the four kinds of drag, the tabs, the `explicit` and `arc` toggles and the run-circle edit all end in
`renderInstance`, so `noteState()` is called at the END of that one method. It keys on `stateKey()` - the instance
and its flags, NOT the selected move or the visible tab - so a snapshot pushed by each editing path could not
have missed whichever path was added next, and merely CLICKING a tile does not push a step, because that is not a
change to the call. Snapshots hold the bundle BY REFERENCE, which is safe because every engine operation returns a
new bundle rather than mutating one: MEASURED, 61 retained states are byte-identical after 60 later editor
operations. A DRAG IS ONE STEP, not one per pointer move, because only the pointerup renders. `clearUndo()` runs
in `loadInstance`, and `doRevert()` calls `resetNoteState()` BEFORE it renders so it cannot push its own undo.
Ctrl/Cmd+Z is wired and is ignored while an `input`, `textarea`, `select` or `contentEditable` holds focus.
NOT COVERED, deliberately: the saved-edit list, the mode, the level, and the Start/End setup selects - those are
commands and settings rather than edits to the call. `poc/tools/revert-probe.mjs` is the gate: the retained-state
sweep, the walk back to the 50 cap, and the structural pins on the wiring.

### THE SINGLE `<tam>` EXPORT IS NOT WRAPPED IN `<calls>` (BUILT AND GATED)

Asked for: "When exporting an individual tam from the POC - Call Editor, there is no need to wrap it in the
`<calls>` element". One `<tam>` is already a whole file, and the `<calls>` wrapper belongs to the multi-call
export that writes several of them, so `doExport` writes the stamp and that one element. `export-all-probe.mjs`
pins both halves: the unwrapped text parses as its own document, and the multi-call path still groups.

### THE CURVE'S NUMBERS, RELATIVE AND ABSOLUTE, ON ONE ROW EACH (BUILT AND GATED)

Asked for: "display absolute coordinates alongside the existing relative coordinates. Both can be edited,
updating the other." Then, on seeing the first cut: "Its inserted a lot of unnecessary text. Put the absolute
coordinates to the right or the relative ones. Add a simple heading to make it clear what they are. No need to
have increment decrement controls", and "remove this text too: cyan curve: ...".

**THE TWO SETS ARE ONE POINT SEEN FROM TWO PLACES, AND NEITHER IS A READOUT OF THE OTHER.** The local numbers are
the tangent-space description the FORMAT stores - measured from the dancer when the move begins, `+X` along their
own facing - and the absolute pair is where that same point sits on the floor. The map between them is an
ISOMETRY, so placing a point and reading it back is the identity and an edit made in either set is exact in the
other. MEASURED over 1364 moves in 62 calls, 498 of them in a TURNED frame where the two pairs genuinely differ:
the local origin is the pose `poseFor` starts the move from to 0.0e+0 units, the local endpoint is the pose it
ends at to 1.6e-15, and a board edit round-trips through the relative pair to 9.5e-16, with 30 of 60 edits moving
BOTH local numbers.

**ONE MAP, THREE CALLERS.** `localToFloor` / `floorToLocal` are module-level, and the DRAWN handles, the DRAG
that reads a pointer off the board, and these fields all go through them. They were two copies of the same
rotation before; a drag and a field that disagreed about the frame would move a point somewhere neither of them
named.

**LAYOUT, ASKED FOR TWICE, AND THE SECOND TIME IS THE ONE THAT SHIPPED.** The first cut printed a paragraph and
then a second block of six fields below the relative ones. The request was to have the pairs read ACROSS under a
simple heading, with no spinner arrows and none of the prose. So each coordinate is now ONE ROW of a three-cell
grid - the field's name in the XML's own words, the relative field, the absolute field - under a two-word heading
`relative | absolute`, and what the prose was for is on the two headings' and the fields' `title`s. Both inputs
in the table carry `.no-step`, which hides the number spinner in both engines (`appearance: textfield` plus the
`::-webkit-outer/inner-spin-button` pair); `step` is still set, so the arrow keys and the wheel still nudge.
The facing tab's long `cyan curve:` paragraph was removed for the same reason, and what a caller actually needed
from it is on the fields and in the panel's existing notes.

**A GROUP EDIT KEEPS THE SHAPE, NOT THE SPOT.** The frame is the SHOWN dancer's, and the local value a board
number converts to is what every SELECTED dancer receives - exactly the drag's rule, so both ways of moving a
point do the same thing to a selection rather than there being a second, quieter rule.

**THE ONE RAIL IS A NUMBER, NOT A ROW.** `tamination.dtd` declares the rotate as `cx3, cx4, cy4, x4, y4` and
there is no `cy3`, so the facing curve's first control has no local Y to pair with and its board Y is a readout.
It is locked PER AXIS. The first cut locked the whole row, which would have taken away the edit of `cx3` that the
panel has always allowed - the Y is what the format cannot carry, not the point. Both gates still apply to both
columns: the group-agreement gate, because one set of numbers cannot describe several shapes, and the arc lock,
because a quarter arc's five numbers are not independent.

**CHECKED IN THE REAL PANEL, NOT ONLY IN THE PROBE.** The built POC was loaded and driven in a browser. On the
Move tab the table reads `cx1 [0.0000][3.0000]`, `cy1 [0][-0.5]`, `cx2 [1.0000][2.5000]`, `cy2 [0.5][-1]`,
`x2 [1.75][2]`, `y2 [0.5][-1]`. Setting the ABSOLUTE `C1x` to `1` and committing fired `change`, the panel
re-rendered as `edited` with Revert armed, and the RELATIVE `cx1` came back `2.5` - which is `1 - (-1.5)`, the
frame of a dancer starting at `(-1.5, -1)` facing 0. On the Facing tab the same table labels its rows `cx3`, `—`,
`cx4`, `cy4`, `x4`, `y4`: the `—` row's absolute field is DISABLED and carries the rail reason, and `cx3`'s pair
is live in both columns. `absolute-coords-probe.mjs` is the gate - the engine-frame cross-check, the round-trip
identity, and the structural pins on the layout, the single map, the rail, and the hidden spinners.

**THIS WORK ALSO FIXED DRIFT IN THIS FILE.** The Revert button and the `<tam>` unwrapping each shipped without a
section here, because PLAN.md is written at the end of a piece and those two were committed straight after the
facing work. Both are written up above, from the commits rather than from memory.

### COPY / PASTE A MOVE'S END POINT: `C`, `Pa`, `Pr` (BUILT AND GATED)

Asked for: "Add [C]opy/[Pa]PasteAbsolute/[Pr]PasteRelative buttons to each Move pane, beside the 'arc' checkbox,
that keeps a local copy of the move x/y end coordinates and can paste them back at a later date (if it was
changed by deleting/adding other Moves). The C button will be highlighted if it is currently holding a value. C
will clear when Pa/Pr is pressed. Pressing C a second time will replace the copied coordinates with the latest
values. Hovering over C button will show current values stored, if there are any. If multiple moves are selected,
the C applies to all selected Moves."

**TWO PAIRS ARE STORED, AND THAT IS WHY THERE ARE TWO PASTE BUTTONS.** A move's numbers are authored in the frame
the move is PLAYED FROM, so `Pa` and `Pr` would be one button twice unless the ground under the move can move -
and it can: deleting or adding an earlier move leaves a later move's LOCAL numbers alone and moves where they
land on the FLOOR, while re-aiming a move moves the local numbers under a floor position that did not change. So
the copy holds the relative pair AND the board pair, `Pr` writes the relative one straight back and `Pa`
converts the board one through the frame the move has NOW. MEASURED over the corpus: 1056 moves that have a move
before them, 1012 of them with the ground actually moved under them (by up to 4.175 units). `Pa` puts the point
back on the floor position it was copied from to **1.14e-15**; `Pr` misses by at least **0.209 units on every
single moved frame**; and with nothing moved the two agree to 6.3e-16, which is the control.

**THE COPY BELONGS TO THE MOVE OBJECT, NOT TO ITS INDEX** - and that was the interesting part. It was asked
twice: "If multiple Moves were selected when Copy pressed, pasting seems to always paste the first index, rather
than the Move specific index", then "Will the copy index cope with deleting a Move?", then the answer itself:
"Sounds like the copy data needs to belong to the Move object." An index does NOT cope: deleting a move in front
of a copied run shifts every index down by one, and no rule inferred from indices can tell that from a different
move having been copied. A `WeakMap` keyed on the `Seg` object can, and the engine makes it free - `setMove`
clones ONLY the move it writes (`moves.map((s, k) => k === i ? cloneSegs([seg])[0] : s)`), `addMove` splices one
in and `removeMove` splices one out, and all three end in a SHALLOW `retime`, so every move that was not the one
written keeps its object identity. MEASURED over EVERY level, 547 calls and 1864 copied moves carried through a
real delete, a real insert and a real rewrite: **0 lost to a delete, 0 to an insert, 0 disturbed by a rewrite of
another move**, and a write replaces **exactly one** object every time.

**THE ONE HOLE, AND WHERE IT IS CLOSED.** The move that IS written loses its object by design, so its copy has
to be moved onto the object that replaced it. `carryMoveClips` does that by comparing the old and new bundles
positionally - the lengths always match, because none of these writes adds or removes a move - and it is called
from BOTH write paths, `commit` and `applyLight`, because the drag writes through the second one and a drag that
moved the copied end point would otherwise drop the copy on its first pointer move. THERE IS NO OTHER FALLBACK
AND NO LIST: a move either is holding a point or is not, and only that move can paste it.

**EACH MOVE KEEPS ITS OWN, AND THE PASTE SPANS THE SELECTION EXACTLY AS THE COPY DOES.** That took two
corrections and both were reported from use. First: "After the copy for one Move is activated, all moves seem to
be activated with the same copy data. This was not the intention... each Users Move has it's own copy of the
coordinates. If multiple Dancers and Moves are enabled, they copy their own specific coordinates. These copied
coordinates are only available to that specific move." - so the store is per `Seg` and there is no shared list:
`C` fills in every move of the run for every selected dancer, EACH TAKING ITS OWN numbers, and only those moves'
buttons light up. Then: "Just as the copy works with selected Dancers and Moves, so does the Paste (but the data
is local to the Move)." - so the paste is decided PER DANCER AND MOVE inside the fold rather than up front from
the move the tile happens to show, and a dancer or move holding nothing is left exactly as it is. MEASURED over
every level, 932 dancers across 547 calls: a copy is invisible to every other move of the same dancer and to the
same-numbered move of every other dancer - **0 leaks** both ways - and 1864 copied moves survive a real delete, a
real insert and a real rewrite with **0 lost, 0 disturbed**.

**THE ONE THING THAT IS NOT SHARED IS THE CURVE.** A point taken on the Move tab is a position and one taken on
the Facing tab is a heading pair, so a move holding the wrong one for the tab in front of it is skipped and
counted rather than pasted into nonsense. What was written, what was left holding nothing, and what was taken on
the other tab are all said on the status line, because a paste that did nothing looks exactly like a paste that
worked.

**LAYOUT, AND A REAL CSS BUG THE STYLING REQUEST UNCOVERED.** Three one- and two-letter buttons beside the `arc`
box, in the tile's grid, with `C` lit while it holds anything and the values on its hover (a highlight says
something is held; only the numbers say WHICH point). Asked to "make the buttons a bit more prominent, they are
hard to see against the dark background" - and the reason they were invisible was not the colours: an earlier
edit of the CSS block had DELETED ITS COMMENT TERMINATOR, so every `.ed-clip` rule was inside an unterminated
comment and the buttons were being drawn by the panel's dim default. The rules were rewritten loud (full-strength
text, a raised background, an edge, a bold label), and the probe now STRIPS CSS COMMENTS before checking any
style, which is the check that would have caught it.

**KEPT, NOT CLEARED, AFTER A PASTE.** The request said "C will clear when Pa/Pr is pressed"; after using it the
caller asked for the opposite - "dont clear the memory after a paste... it's more useful to keep it" - so one copy
can be pasted as BOARD and then as RELATIVE, or onto a second run, without taking it again. `C` stays lit, the
status line says it still holds it, and the value is cleared in exactly ONE place: loading another call, where the
moves it describes no longer exist. It is deliberately NOT part of the undo state - holding a point is not a
change to the call, so a revert must not clear it or put an older one back.

The run is the strip's only multi-move selection, so it is normalised (`min`/`max` of `moveIndex` and `circleTo`)
and the strip's highlight uses the same range the copy covers, or the caller would be checking a range the button
will not use. `move-clipboard-probe.mjs` is the gate.

### THE EDITOR'S SCRUB SPANS THE CALL, NOT THE TIMELINE (BUILT AND GATED)

Reported: "Currently, the call edit scrub progress bar has a 2 second intro and outro that dont actually exist in
the call Moves. Can these fictitious dead beats be removed."

**THEY ARE REAL, THEY ARE IN THE DATA, AND THE MOVES DO NOT USE THEM.** A `<tam>` declares a `leadin` and a
`leadout` - two beats each, on all 547 calls of the corpus, 2188 dead beats between them - and the engine carries
them as `leadin`, `beats` and `leadout` with `totalBeats = leadin + beats + leadout`. MEASURED: `moveBeatRange`
puts every dancer's FIRST move at beat **0** and no dancer's last move past `beats`, so the moves live on the
call's own clock and the lead-in and lead-out are time outside them. A bar drawn over `totalBeats` therefore
spends its first two beats and its last two on nothing.

**TWO CLOCKS, AND THE CONVERSION IS IN ONE PLACE.** `player.ts` keeps `beat` starting at `-leadin`, and
`seekAbsolute` takes a beat where 0 is the start of the lead-in - so the panel's playhead is now in THE CALL'S
OWN BEATS and `absoluteEditBeat` adds the lead-in at the two places the stage is told where to stand (the parked
playhead after an edit, and the manual scrub). `renderScrub` takes its maximum from `call.beats`, clamps to it,
and reads out `beat x / beats`; the part index is read straight off that beat, so the `- leadin` that used to be
there is gone with the dead beats. The bar's end is where the CALL ends: a shorter dancer simply stops when it is
done, which is `instanceBeats` taking the max and is unchanged.

**THE BROWSE VIEW IS DELIBERATELY LEFT ALONE.** Its scrub still spans `totalBeats`, because it is showing the
whole timeline the player runs - a different question from the one that was asked about the editor's bar - and
the probe pins that it was not changed rather than leaving it to be discovered.

`scrub-beats-probe.mjs` is the gate: the two clocks measured over every level, and the panel's use of them read
from the source. `board-owner-probe.mjs` needed one line, because it pins `showInstance`'s `showAt` call.

### THE `asymmetric` SELECTOR CANNOT LIE ABOUT THE EXPORT ANY MORE (BUILT AND GATED)

Reported: "The XML export is exporting all 8 dancers with the asymetric paramter = true. But the UI is showing the
checkbox unchecked." Asked what should happen about it, the answer was **"Refuse the export and say why"**; asked
what the line beside the box had said, the answer was **"I didn't notice / the line was empty"**.

**THE MECHANISM, MEASURED.** Unticked means the half set, and with it unticked the writer really does write **4
dancers and no `asymmetric`** - checked on `circle.xml`, `sashay.xml`, `arm_turns.xml` and
`right_and_left_grand.xml`. It writes all 8 with `asymmetric="true"` only when the call's halves no longer pair up
exactly, and that fallback is not pedantry: a half-set tam REPLAYS the written half's paths for the second half, so
writing four dancers there would silently change the dance. `halfSetReport` is the test. MEASURED over every level
and every setup: of **3279 call/setup combinations exactly ONE fails it on load**
(`a2/box_counter_rotate.xml`, setup 5) - so in practice the fallback arrives after an EDIT, usually one that
touches some dancers and not others, or a re-base that moves the halves out of antipodal step.

**THE FALLBACK IS GONE FROM THE PANEL, AND THE NOTICE IS NO LONGER A STATUS LINE.** Every tam-writing site -
the single export, the xml a saved edit stores, and (through that) Export All - now goes through one
`exportSymmetry`, which returns the whole set when the box is ticked and otherwise REFUSES with the reason
`halfSetReport` gave, naming the dancers and the move it stopped on, plus what to do about it. A refused export
also CLEARS the pane, because an old `<tam>` left sitting there reads as the result of the button just pressed -
which is half of how the mismatch looked in the first place. The line beside the box is flagged (`warn`) and turns
the panel's amber, and its sentence leads with "will NOT export", because the previous wording was read past.
The one case that is NOT refused is an export that NAMES its formation: no dancers are written, the choice is
inert, and the panel uses the SAME predicate `tam-xml` uses to decide that, so the notice and the export cannot
disagree about it either.

**THE ENGINE STILL FALLS BACK, AND THAT IS NOW DELIBERATE.** `callToXml` handed `symmetry: 2` for a call that is
not a half set still writes the whole set: it has no caller to ask and no screen to report on, so the refusal
belongs in the panel. The probe pins both, so nobody "fixes" the engine into throwing for readers that have no
choice to offer.

**CHECKED IN THE PANEL.** `a2/box_counter_rotate.xml` at `T-Bone 2` - the one setup that fails the test on load -
loaded with the box ticked (the tam declares it), and UNTICKING it turned the row amber with
`will NOT export: the half set cannot be written - dancer 3's move 1 is not dancer 1's ...`, and pressing
`Export <tam>` reported the refusal on the status line and left the pane empty.

### A DELETE SHIFTED THE MOVES, AND THE CARRY-OVER PAIRED THEM BY POSITION (BUILT AND GATED)

Reported: "select two moves, press C to copy x,y, delete the first move, then Pa the remaining Move - it pastes
the deleted move's coordinates. This suggests the coordinate copies aren't embedded in a Move object." The copies
ARE embedded in the move object; the fault was in the one place that maintains that embedding.

**THE BUG, EXACTLY.** `carryMoveClips` moves a copied point onto the object that replaced a rewritten move, by
comparing the old and new paths BY POSITION - which is right for a field, a drag, an arc or a paste, because
those rewrite a move in place. But it is called from `commit`, and `commit` is also how `+ Move` and `- Move`
land. A delete SHIFTS every later move down one, so the old and new paths at the same index are DIFFERENT MOVES:
copy moves 0 and 1, delete move 0, and it saw `before[0]` (the deleted move) differ from `after[0]` (the
survivor) and copied the DELETED move's point onto the survivor. The comment even claimed "the lengths always
match, because none of these writes adds or removes a move", which was simply not true of `commit`.

**THE FIX IS ONE GUARD: same length or nothing.** A move that is added or removed KEEPS THE OBJECT IT HAD, so its
copy is already keyed correctly and there is nothing to carry; only an in-place rewrite needs the carry at all.
MEASURED over every level, on a real `removeMove`: with the guard, **932 of 932** survivors keep their OWN point;
with the old rule, **932 of 932** take the deleted move's - so the guard is the fix and the control is real,
which is the pair `move-clipboard-probe.mjs` now asserts.

**AND THE PASTES ARE IN COLUMN ORDER.** The table reads `relative` then `absolute`, and the buttons read `Pr`
then `Pa` - asked for as "switch the Pa, Pr buttons to reflect the column order". Each paste button now sits over
the column it writes, with `C` still in front of both.

### THE START SETUP SWAPPED THE INSTANCE WITHOUT CARRYING THE COPIES (BUILT AND GATED)

Reported: "If I [C]opy the move coordinates, then set the start setup, the copy contents are cleared. I need them
to persist after applying a new start and end setup."

**THE END SETUP ALREADY SURVIVED, THE START DID NOT - and by accident, not by design.** The copied points are
keyed on the move's own segment, and a swap of the instance REPLACES THE SEGMENTS, so something has to carry them
onto the objects that replaced them. `commit` and `applyLight` do that themselves, and `doConnectEnd` goes
through `commit` - which is why the end setup was fine. But `doStartFormation` and `doConnect` assigned
`this.instance` DIRECTLY and then called `showInstance`/`renderInstance` themselves, so the carry never ran; and
these are exactly the two paths that rewrite EVERY move (`setStartFormation` re-frames the whole path into the new
start's coordinates, `connectStart` re-aims each dancer's first move), so every object is new and the entire
clipboard went with them.

**ONE METHOD NOW OWNS THE SWAP.** `swapInstance(next)` carries, assigns, marks the edit and re-renders, and both
paths go through it - the carry belongs to the SWAP rather than to whichever handler remembered it, which is the
lesson of the previous section arriving a second time. MEASURED on a real `setStartFormation` over every level:
the re-base replaces **932 of 932** dancers' every move objects - so this really did drop the whole clipboard -
and the carry-over keeps **932 of 932** copied points on the move they came from.
`move-clipboard-probe.mjs` now asserts both, and that no instance swap outside `commit`/`applyLight`/`swapInstance`
exists.

`asymmetric-export-probe.mjs` grew a section 4 for the refusal; its section 3 assertion that the ENGINE falls back
had to be re-worded rather than deleted, and its count of export sites now counts `exportSymmetry` - three of them.

**A NOTE FOR WHOEVER EDITS THESE FILES FROM A SCRIPT.** TWO traps, and both were hit here. A patch script reads
as ANSI when PowerShell 5.1 parses it without a BOM, so a non-ASCII character in an ANCHOR never matches the file
it was copied from - which made one replacement silently fail on the marker the status line already carries; that
marker is now written as an escape in the one new place that needs it, and anchors avoid non-ASCII.

AND A WHOLE-FILE REWRITE CAN SILENTLY CHANGE THE LINE ENDINGS. `core.autocrlf` is `true` here and there is no
`.gitattributes`, so git stores LF and hands back CRLF - which means a file that has been LF all session can come
back CRLF without `git status` saying a word. `stage-sync-probe`, `clone-chrome-probe` and `editor-level-probe`
anchor their NEGATIVE CONTROLS on an LF-only `}` boundary, which cannot match a CRLF file, and all three failed
with "the negative control really is a different file" while nothing in the code had changed. PROVEN not to be
this work by checking out the PREVIOUS commit's `editor-ui.ts` and re-running: the same three fail. They now
normalise `\r\n` on read, so the gate gives the same answer on either checkout - which is the least a gate owes.
`\u2717` in the one new place that needs it, and anchors avoid non-ASCII.

### ADDING A COPY OF A MOVE, EITHER SIDE OF IT (BUILT AND GATED)

Asked for: "On the selected Move add a [D]uplicate button at the top to the left and right of the current move
header. This duplicates the Move and inserts it to the left or right of the current move, depending on which
button was pressed. It should copy only the selected Move (even if multiple moves are selected), but across
multiple dancers if they are selected." Then, in the same breath: "Perhaps [<A] and [A>] might be better text for
the buttons", and then "Move the [A>] to the far right."

**THE WHOLE FEATURE IS ONE ENGINE CALL.** The tile builds no segment of its own: it hands `addMove` a move it
already has, plus an index, and every claim the button makes is `addMove`'s behaviour rather than the tile's. So
`duplicate-move-probe.mjs` measures that behaviour over all 542 calls rather than assuming it.

**THE CLAIM THAT NEEDED MEASURING is the one the status line makes: "the copy is a new move, so it holds no copied
point until C is pressed on it."** The clipboard is a `WeakMap` keyed on the move's own segment, so if `addMove`
spliced the segment it was handed, the copy and the original would be ONE OBJECT and the copy would silently
inherit the original's clipboard entry - a move that looks like it is holding a point nobody copied onto it. It
CLONES. Measured at every index over every call: the inserted move is a new object **542/542** at the head, the
middle and the tail; it carries the original's numbers exactly **542/542**; the original keeps its own object
**542/542**, so a copied point already on it stays on it; every OTHER move on that dancer keeps its object
**542/542**, so their own copied points survive an insert in front of them; the other dancers are the same objects
they were **542/542**; and the instance passed in is untouched **542/542**, which is what makes the press
undoable. A second sweep of every move of every dancer - 9988 pairs, both sides - confirms the same six things
plus the one the request actually asks about: LEFT puts the copy at the original's index and slides the original
right (9988/9988), RIGHT leaves the original and puts the copy after it (9988/9988).

**ONLY THE SELECTED MOVE, so the RUN IS IGNORED - and then CLEARED.** A run is a range for the circle and for the
clipboard, and eight copies from one press would be a different feature with a different question (where does each
copy go?). It is cleared as well because inserting shifts every later index, and a run left naming them would name
the wrong moves. The probe asserts both the ignoring and the clearing, so the clearing cannot be mistaken for the
ignoring.

**THE CURSOR FOLLOWS THE COPY, WHICH IS WHY THE TWO SIDES DIFFER.** A left insert puts the copy at `from`, so the
tile moves to `from + 1`; a right insert leaves the original at `from`, so the tile stays. The probe's third
sweep checks that the move under the cursor is the one on the pressed side, 9988/9988. It also skips a dancer with
no move at that index rather than giving it one - the same rule the delete follows.

**THE LABELS, AND WHERE THEY SIT.** A first cut labelled both buttons `D`, which left which-is-which to position
alone; the arrows were asked for instead and they now carry the direction themselves: `<A` appended immediately
left of the move's own title, `A>` appended after the facing control so the header's own `space-between` pins it
to the far right. The probe asserts the two appends, the `space-between` in comment-stripped CSS, and that
`.ed-dup` is live CSS - a rule inside an unterminated comment is not a rule, which is exactly how the clipboard
buttons once rendered as the dim default and were reported as hard to see.

**A WARNING ABOUT THE BROWSER-AID CSS, SINCE IT COST A ROUND TRIP.** The panel's call list is ~300 options, so
the tile sits past the snapshot cap; the aid appended to the built CSS hides those lists. It also carried
`.ed-move{flex:0 0 auto}` so the tile would size to its content - which OVERRODE the selected tile's own width and
made the header far wider than the pane, pushing `A>` off the visible edge and making the far-right placement look
broken. It was not: removing the override showed `[<A] move 1 [ ] explicit [A>]` exactly as asked. Rebuild `dist`
without the aid before believing anything about this row's layout.

Verified in the browser: the right button takes the call from 2 to 4 beats, leaves the tile on move 1 and adds
one tile to the strip; the left button leaves the tile on move 2 (the copy) with the original behind it; both
messages name the side; and one press is one revert step.

### THE WHOLE BOOK DOWNLOADED IN ONE GO, WITH A NAV BUTTON THAT SAYS WHEN (BUILT AND VERIFIED)

Reported: "Last time I deployed to S3, the book didn't refresh as a whole, and there were many
inconsistencies in the interface. I want to use the book offline, so download all the contents in one go.
Use a progress bar to keep the reader informed of download progress. When connected, test for new versions
and highlight a pending download button in the nav menu. Press the button to do the download." Then, as a
correction to the diagnosis: "The deploy worked fine, it was the browser that caused problems, downloading
the updates in stages."

**THE DEPLOY WAS FINE; THE BROWSER WAS ASSEMBLING THE BOOK IN STAGES, AND THERE WERE TWO SEPARATE CAUSES.**
The service worker precached only what a reader needed to OPEN the book -- pages, stylesheet, player,
engine, XML -- and left the 11 MB of figures and animations to be cached IF AND WHEN they were viewed. It
then served pages network-first and everything else cache-first, and activated with `skipWaiting` plus
`clients.claim` so the caches swapped mid-session. A reader therefore read the new HTML wearing last
build's assets, and a reader who had not opened every call page held a book with holes in it. That is the
staged download, and it is why the same book looked different depending on which pages had been opened.

**SO NOTHING ENTERS THE OFFLINE STORE BY ACCIDENT ANY MORE.** `assets/offline.js` is the only thing that
writes it, on the reader's own instruction; `sw.js` only reads it. The worker has no precache and no
cache-as-you-view, and the round trip is verified rather than assumed -- `build-site.mjs` now REFUSES the
build if `sw.js` writes to a cache at all (`caches.open(...).put(` or `addAll`/`precache` anywhere in it).

**THE LIST OF CONTENTS IS THE WHOLE SITE, AND THE BUILD PROVES IT.** `download.json` names every file with
its size (256 files, 4.4 MB here; the real site is larger because the local build has no CALLERLAB extract
and so no full set of animations). Two files are excluded because they are DERIVED from the list:
`download.json` cannot describe itself, and `sw.js` carries no content, so including it would make the
version depend on a file that does not move when the content does. The version is a hash of every byte
the reader will hold, so it moves whenever any part of the book moves. The sizes are read AFTER the build
stamp is written, because the stamp is bytes and a total taken before it would be short. And the list is
then RE-DERIVED from disk and compared, both directions: a file the manifest omits would be a page that
fails only when the reader is offline, which is the worst possible moment to find out. Verified on the
built site: 256 listed, 256 on disk, no difference either way, sum of sizes equal to `total`.

**ALL OR NOTHING, WITHOUT A RENAME CACHE STORAGE DOES NOT HAVE.** The store is named for the build and a
marker file is written into it LAST. The worker serves a store only if it holds the marker, so an
interrupted download is invisible -- the reader keeps the edition they had -- and the old complete store is
deleted only after the marker lands, so there is no moment with no usable copy. A file already in the
store is not fetched again, so pressing the button after an interruption RESUMES; that is sound only
because the store is named after the build, so its contents cannot be superseded without the name moving
too. A store that is neither the complete copy nor the build now on offer is deleted as wreckage.

**THREE FIXES CAME OUT OF TESTING IT IN A REAL BROWSER, AND EVERY ONE OF THEM WAS INVISIBLE TO REASONING.**

1. THE `no-store` BYPASS WAS TOO BROAD. The manifest must never be answered from a cache, so the worker
   passed `no-store` and `reload` through to the network -- including for NAVIGATIONS. A reader who
   pressed reload offline therefore got the network and a failure page instead of the book they had
   saved. It is now narrowed to subresources: a navigation comes from the store whenever the store has it.
   This alone was the difference between the saved copy opening on a train and not opening at all.

2. THE WORKER REMEMBERED AN EMPTY ANSWER. `active()` memoised its lookup, so a worker started by the
   reader's FIRST visit -- before any store exists -- remembered "no store" for the rest of its life and
   sent every request to the network. The download would appear to do nothing, and going offline then
   failed to open the saved book: exactly the failure the feature exists to prevent. It showed up as an
   intermittent difference between two ports in testing (one worker had been evicted and restarted, the
   other had not), which is the shape this bug would have had in the field. Only a FOUND store is
   remembered now, and a remembered store is re-checked each request because a download REPLACES it and a
   handle on a deleted cache does not merely go stale, it throws.

3. A FAILED CHECK IS NOT A FAILED DOWNLOAD. With a book already saved and no way to reach the server, the
   button said "The download did not finish", which is untrue and alarming for a reader who is reading
   their saved copy perfectly well. There is now a `saved` state, distinct from `current`: same tick,
   muted colour, and words that say the only thing actually lost is the news. Whether a store exists is
   what decides which of the two a failed check means.

**THE BUTTON, AND WHY THE PANEL IS NOT IN THE WAY.** It lives in the nav's tool group, starts HIDDEN, and
is revealed only once the device has been looked at -- so a browser without Cache Storage shows no control
rather than one that fails when pressed, the same rule the Pin follows. It carries the download glyph
while there is something to fetch and a tick once the book is saved; the pending edition is the ONLY state
that takes the warning colour, and it also carries a corner dot, because colour alone is not an answer.
Pressing it downloads -- one press, as asked -- and the bar is drawn along the button's own bottom edge,
with the detail in a panel anchored under it. The bar, not the button, carries the `progressbar` role: a
button that also announced itself as a progress bar would be announcing two things at once.

**VERIFIED END TO END IN A REAL BROWSER, against `serve-site.mjs`**:
  - not saved -> "Save the whole book on this device" -> one press -> progress -> "Saved on this device,
    and up to date", with the Reload offered because the open page is still the edition it was loaded from;
  - a rebuild -> the button turns AMBER with the corner dot, "A newer edition of this book is ready to
    download" -> one press -> the new edition saved and the old store replaced;
  - server stopped -> a page NEVER VISITED in that session loads in full, and so do the ANIMATION PLAYERS,
    which pull `player.js`, the whole engine from `lib/` and the call authorings out of the saved copy;
  - server stopped with the book saved -> "Saved on this device. The server could not be reached to check
    for a newer edition."

**ONE THING THE DEPLOY MUST NOW DO THAT IT DID NOT HAVE TO.** Assets are uploaded with a one-hour cache and
their filenames are NOT content-hashed, so the CloudFront invalidation is load-bearing rather than a
nicety: a reader downloading a new edition inside the hour after a deploy could take the pages from the new
build and the figures, formations and engine from the CDN's copy of the old one -- and would then keep that
mixture OFFLINE, where nothing can correct it. `book/deploy.txt` used to call the invalidation optional and
say skipping it "costs little"; that is no longer true and the file now says so. Uploading `sw.js`
`no-cache` does not help, because the files that go stale are the assets.

### THE MOVE'S DURATION, EDITABLE IN THE TILE (BUILT AND GATED)

Asked for: "Add a beats edit field to the Move."

**A MOVE'S `beats` IS NOT LIKE ITS COORDINATES, and the three differences decided the design.** It is
written in neither of the two spaces the tile's grid has columns for, so it does not belong in the grid;
it is not per-curve, because the Move and Facing tabs are two shapes of ONE move and the move lasts as
long as it lasts whichever shape is on screen; and THE ENGINE DOES NOT VALIDATE IT. MEASURED
(`poc/tools/move-beats-probe.mjs`, section 2): `setMove` stores `beats: 0` and `beats: -2` without
complaint, and a move of no length or of negative length is what the scrub, `moveBeatRange` and the pose
sampling all divide by. The panel is therefore the only thing between a slipped keystroke and a broken
track, so the field refuses two things out loud and writes nothing: a duration of zero or less, and one
beyond a whole 64-beat phrase (which is a slipped digit rather than a duration - the corpus's own maximum
is 9.5). The field is rebuilt on refusal, so it goes back to showing the duration the move actually has.

**FRACTIONAL BEATS ARE ORDINARY, so the step could not be 1.** MEASURED over the corpus's 9988 segments:
**2260 are not whole numbers** - 0.75, 1.5, 4.5 and 2.5 are as much part of the corpus as 2 and 3, and
`0.1`, `0.375`, `1.125`, `1.33`, `1.7` and `2.67` appear too. So the spinner steps by a quarter beat
(the granularity the scrub already works in, and the finest subdivision that is common) while a TYPED
value is taken exactly as typed, which it has to be, because no single step produces those last six. Every
one of the 9988 segments is positive, which is what makes a zero here a typo rather than an authoring
choice, and the whole corpus sits between **0.1 and 9.5** beats - a long way inside the ceiling.

**THE FIELD HAS TO NOTICE A DIFFERENCE RATHER THAN CREATE ONE UNSEEN.** A coordinate field LOCKS when the
selected dancers disagree, because one number cannot describe several shapes. One TIMING for several
dancers is a legitimate group edit - the choice `commitMoveChange` already records for beats and hands -
so this field stays live. But MEASURED: **285 of the 547 calls hold a move whose beats differ between
dancers** (675 indices), the widest being `c3a/spin_the_pulley.xml`, which opens on 3, 3, 7.5, 9.5 across
its eight. A multi-dancer selection therefore routinely spans several timings, so a field showing one of
them and saying nothing would invite a caller to flatten a difference they never saw. It is MARKED, not
locked: the group takes the warning colour and the hover names the values themselves (`5, 2, 2, 2, 2, 2
beats`), so the difference is visible BEFORE the write - and the status line afterwards says the write
flattened something, because after the write there is nothing left to notice.

**THE FIELD WENT ON THE KEY THE PANEL ALREADY USED.** `refreshNumberFields` has carried
`m${i}:${k}:beats` since the drag path was built, so a beats input keyed the same way is kept live while
a handle is dragged and has its focus restored through the rebuild by `focusKey` - both for free, and the
probe asserts the two keys are the same string rather than assuming it.

**THE CALL'S LENGTH IS ITS LONGEST DANCER.** MEASURED: `call.beats` equals the longest dancer's total
track in **547 of 547** calls. That is why lengthening a move on the dancer who is already longest
lengthens the call, and on a shorter one may not - and the move's own span grows while every LATER move
is pushed along by the same amount, so the rest of the track keeps its own durations.

Verified in the browser: the field shows `beats 2` between the shape tabs and the handles toggle; 2 -> 5
takes the call from 2 to 5 beats, updating the info line, the strip and the scrub, in ONE undo step; `0`
is refused with `a move has to last some time: 0 beats is not a duration, so nothing was written`, the
call is untouched and no undo step is added; and with a selection that disagrees the field goes amber and
names the values while the coordinate fields beside it are disabled - then writing 3 across all six
reports `move 1 now lasts 3 beats for 6 dancers - that is ONE timing for all of them, and they did not
all have the same before` and the marker clears.

### THE START AND END SETUP LISTS, RESTRICTED TO THE CALL'S OWN SIZE (BUILT AND GATED)

Reported: "When the start setup is 4 dancers, the start and end setup override lists should be restricted to
4 dancer formations", then "currently it only shows 8 dancer setups", and the answer to where the four-dancer
ones are: "I can see them in formations.xml. The 51 with 2 are the 4 dancer formations."

**WHAT WAS WRONG.** Both pickers were filled from the sequencer's formation library, which is eight dancers
only - `startFormations()` filtered `boardForSetup(name).dancers.length !== 8` and its own comment recorded
that all 134 names are eight. MEASURED over the catalogue: **212 of 547 calls are four-dancer**, so this was
most of the catalogue rather than an edge case, and every one of them was offered a list of formations
`setStartFormation` refuses and `doEndFormation` refuses out loud. The picker could not express the call's
own start, which is the one thing it is for.

**THE CORPUS AUTHORS HALF A SET, which is where the 51 come from.** "2 dancers in xml is displayed as 4
dancers, 4 dancers in xml is displayed as 8 dancers" (`engine/src/sequencer/library.ts`, `toWholeSet`), so
the played shape is the written dancers plus the same dancers rotated 180 degrees. MEASURED over
`formations.xml`'s 274 entries: 51 write two, 210 write four, 11 write six - and **no entry of any size is
already whole**, so the doubling is the rule rather than a special case, and it yields 51 formations at four
dancers, 209 at eight (two names collapse canonically) and 11 at twelve.

**THE LIBRARY WAS NOT WIDENED, AND THE PROBE PINS THAT.** Doubling the two-written shapes inside
`toWholeSet` is the change the engine's own note says is coming ("TWO DOUBLES TO FOUR as well ... the
two-dancer case belongs with that picker's guard, in its own change") - and its blast radius is why it is
not this change: `listFormations()` would go from 134 to 164 names, `engine/test/shape-census.mjs` pins the
134-and-all-eight invariant, and four engine harnesses plus several probes walk that list. A picker's
contents do not justify that. So the POC reads the same file the library does, applies the same rule, and
leaves the library at 134 - which `formation-size-probe.mjs` asserts, so the decision cannot be undone by
accident.

**SIZE IS NOW AN ARGUMENT, ALL THE WAY DOWN.** `startFormations(dancers)` answers with the corpus for
anything but eight and the library for eight; `ensureStartFormations(dancers)` rebuilds both pickers when
the INSTANCE's size moves (it was memoized with a boolean, now with the count, so it is not rebuilt on every
render); the two change handlers look a chosen name up at the same size, so a name cannot be found at one
size and applied at another; and a size the corpus cannot stand up - sixteen dancers, which four calls have
- disables both pickers with the reason rather than leaving a lone "keep the current" that reads as a bug.

**THE USEFULNESS MEASUREMENT, and it took two goes to be honest about it.** Comparing the picker's names to
a call's `from` reported 95 of 200, because the corpus names one shape two ways - a call says
`from="Right-Hand Box"` where `formations.xml` says `Box RH`, and thirteen such names cover 105 calls.
Comparing with `startsFromFormation` reported **ZERO**, which is the more interesting failure: the engine's
comparison is exact to 1e-3 because it answers whether a tam may REFERENCE a formation by name, and
`Cross Trail Thru` starts from "Facing Couples" drawn at x = +/-1.5 while the corpus entry is drawn at
x = +/-2.0 - the same formation at a different scale. So the probe uses a shape fingerprint - the multiset
of pairwise distances normalised by their mean, plus the relative headings - which is rigid-motion AND
scale invariant, and reports **197 of 200** four-dancer calls with their own start shape in the new list.
The three that miss are "Right-Hand Outfacing Z", "Left-Hand Z" and "Center 4 Dancers", shapes the corpus
names but does not draw at four.

**THE SAME ONE LIST FILLS BOTH PICKERS**, unchanged: a start and an end are both "a named formation of this
call's size", and the correspondence between a call's dancers and a formation's spots is derived the same
way for either end (`setStartFormation` / `deriveFormationMapping`), so two lists that could disagree would
be a bug waiting to happen. The probe asserts both are filled from the one size-filtered list.

Verified in the browser: the SIX-dancer call the editor opens on now offers exactly one formation
("Compact Wave of 6"); "Cross Trail Thru" (4 dancers) offers **51 four-dancer formations** in both pickers -
Facing Couples, Box RH/LH, Wave RH/LH, Diamond RH/LH, Star RH/LH, Single Double Pass Thru - where it used to
offer 134 eight-dancer ones, with the Asymmetric line correctly reading "the HALF set (2 dancers)"; and
"Circle Left" (8 dancers) still offers the library's 134 eight-dancer names, unchanged.

### THE FACING END POINT NOW CARRIES ITS CONTROL (BUILT AND GATED)

Reported: "when dragging a facing end point, the end control point stays at its absolute position, which
warps the curve in unpredictable ways. FIX: When dragging a facing end point, drag the end control point
with it, keeping its relative position." Clarified as a rule with two halves: "When p3 is moved, c2 keeps
its relative position from p3. When c2 is moved, p3 stays fixed."

**WHY THAT IS THE WHOLE GESTURE, and it had to be established rather than assumed.** `poseFor` accumulates
a move's heading from `bezierAngle(rotate, t)` (`engine/src/core.ts`), and the tangent of a cubic at `t = 1`
is the direction of `p3 - p2` - the line drawn from the end control to the end point. So moving the CONTROL
alone pivots that line about a fixed end point, which TURNS the finish heading; moving the END POINT with
the control in tow holds the line rigid, which RELOCATES the ramp and leaves the heading where it was. The
probe first had to rule out the other reading - that the heading is the direction of the end point itself -
and MEASURED that it is not: over the corpus's **4128** facing curves the two agree on only **3.3%**, and
differ by up to **90 degrees**. That measurement is what made the requested rule coherent instead of
self-defeating, and it is section 1 of `facing-end-drag-probe.mjs`.

**THE BUG, AS A NUMBER.** Dragging the end point alone left the control where it was on the floor, so the
line pivoted about it AND changed length at the same time. MEASURED: a normal end-point drag moved the
finish heading on **4128 of 4128** curves (worst 142.2deg), and the control-to-end distance moved by up to
1.42 units. At the far end of the gesture - the end dot dragged onto the control - the distance **collapses
to zero on 4116 of 4128** curves, where the tail of the cubic has no tangent of its own and the whole curve
is all that is left: the "unpredictable" warp, exactly.

**THE FIX IS THE ENGINE'S OWN RULE, NOT A SECOND COPY OF IT.** The facing end point now goes through
`moveCurveEnd(seg.rotate, lx, ly)`, the same call the travel end point has always used. It holds
`p3 - p2` as a vector, so the ramp relocates and the heading it finishes on is HELD - exactly in exact
arithmetic, **bit-identical on 3892 of 4128** curves and within **5.1e-14deg** on the rest (the residue is
`x2 - (x2 - dx)` rounding). Verified across the corpus: the end point lands exactly where it was dragged
(12384 of 12384), the control-to-end distance is preserved to within rounding (12384 of 12384), and
dragging the CONTROL still moves nothing but `cx2`/`cy2`, leaving the end point exactly where it was
(4128 of 4128).

**THE TWO HANDLES DIVIDE THE WORK, one axis each, and neither disturbs the other - which is what the rule
asks for.** The CONTROL sets the finish heading by pivoting the line about the point; the END POINT
relocates the tail and holds it. `noteFacingHold` therefore stays silent on an end-point drag and speaks on
a control drag, which is the honest report of which of the two happened. The Facing tab keeps full heading
control - through the other handle - and the probe asserts the control still turns the heading on 4128 of
4128 curves.

**WHAT WAS NOT CHANGED.** The arc branch is untouched: an arc is rebuilt from its parameters
(`arcBezier`) so its control point is DERIVED, and there is no control to carry. The rail still writes
`cx1` alone, which the format requires (no `cy3`). And the tile's NUMBER FIELDS still write one number
each - typing `x4` leaves `cx4` where it is - because that is what a per-number field means and it is the
contract every field in the tile is built on; the carry is the DRAG's rule, which is how it was reported.

Verified: `tsc` clean, 35 probes (the 3 pre-existing failures stand), `vite build` clean, and the Facing
tab checked in the browser - it renders the format's own five fields (cx3, the pinned control with no cy3,
cx4/cy4/x4/y4) with the heading ticks on the board. THE POINTER GESTURE ITSELF COULD NOT BE DRIVEN: the
browser tooling here has no drag primitive, so the drag is verified by the probe - which mirrors the exact
patch the drag applies, against the engine's own `moveCurveEnd` - and by reading the patch chain from the
source, not by a hand drag.

### LOADING A CALL BY NAME INSTEAD OF BY POSITION (ENGINE API + verify.cjs; CONVERSION INCOMPLETE)

Reported after a data change broke five checks: "It should load by XML search, not index. Index is too
fragile", then "I'm going to be making many changes to the xml data over the coming days, so convert tests
and lookups to xml search rather than index to prevent this happening again."

**THE FAILURES THAT PROMPTED IT WERE NOT INDEX FRAGILITY, and that had to be separated out first.**
MEASURED across revisions with the file swapped in place, byte-fidelity checked by hashing each revision's
blob, and judged on EXIT CODES rather than on grepping for FAIL lines (a distinction that mattered - see
below): every one of the five checks passes at `b83c305~1` and fails at `b83c305` "New circle calls." and
with the in-flight working tree alike. So the committed data change broke them, the uncommitted one did
not, and one of them - `Circle Left derives 0 holds` - is not a lookup problem at all: the check now
resolves the tam NAMED `Circle Left [Static Square]` and it still derives 0 holds, while a sweep of the
whole call shows the ring DOES form (8 holds at other beats) and the closest any two dancers ever come is
1.900 units. The check samples at exactly `beats * 0.5`, which is a stronger claim than "Circle Left is a
ring".

**A CORRECTION.** The first revision comparison I ran was an artifact and I reported its conclusion before
catching it: `Set-Content -Encoding UTF8` writes a BOM, the BOM made the XML unparseable, and I read the
resulting crashed run as "0 FAIL lines" - a pass. Counting FAIL lines is not a pass/fail signal; the exit
code is, and a byte-fidelity hash is the only thing that proves the swap happened.

**THE ENGINE NOW TAKES A NAME, AND AN AMBIGUOUS NAME IS AN ERROR.** `loadCallFromXml`'s tam argument
accepts a position, a title, or `{ title, formation?, from?, nth? }`, resolved by the exported `selectTam`.
The identity is the title PLUS the formation the tam starts from - the `formation` attribute when the tam
references a named formation, `from` when the formation is embedded - which is the key the user specified
and which MEASURES as the right one over the corpus's 547 files and 5963 tams (811 of them carrying no
`formation` attribute at all):

    duplicate title alone                      398 files (72.8%)   - the title CANNOT be the key
    duplicate title + from                      39 files ( 7.1%)
    duplicate title + (formation ?? from)       19 files ( 3.5%)   - so that is the key

The remaining 19 need an `nth`, which is why it is there. A name that matches nothing, or matches several,
THROWS and prints what the file actually holds. And the silent `tams[index] ?? tams[0]` fallback is gone: an
out-of-range index used to load the FIRST tam and report nothing, which is the same invisible swap by
position that started all this - it now throws, naming the file's size and its tams.

**CONVERTED SO FAR: `poc/verify.cjs`**, all five of its call lookups - `Brace Thru [Lines, Boys Ends]`,
`Pass Thru [Normal Lines] from Lines` (which had hand-rolled exactly this search with a `findIndex` and then
passed an index on, so a later insertion could still move it), `Circle Left [Static Square]`,
`Allemande Left` by `from`, and `Wheel Around [Lines]`. The now-unused `parseCallXml` import is dropped.

**NOT YET CONVERTED, and this is the honest state: 22 sites in `poc/tools/*.mjs` and 31 in `engine/test/*.mjs`
still load by position.** The engine API they need is in place and tested, so each is now a one-token change,
but none has been made. What HAS been checked is that the new loud error breaks nothing that was working:
the POC gates still show exactly the same three probe failures and no selector error fires anywhere, and the
two engine harnesses that load calls (`editor`, `behaviour-audit`) fail only on `Circle Left` checks - the
same data, not the lookup.

### 2D ICONS BY DEFAULT, AND THE SESSION REMEMBERED ACROSS A RELOAD (BUILT AND VERIFIED)

Asked for: "Make the default board '2d icons'. Add a feature to remember the last tab, level, call and setup
to make working with auto reloads easier. The repeated board setups only takes a few seconds, but it eats
into development time."

**THE DEFAULT BOARD IS 2D ICONS, AND IT TOOK THREE PLACES RATHER THAN ONE.** The choice lived in three
independent defaults, and changing any one of them alone leaves the board 3D: `browser.use2d` was `false`;
`edView2d` opened unticked; and - the one that actually decides what most sessions see - `applyViewOptions`
RELEASES the board to a hardcoded `{ use2d: false }` whenever the editor is not the active panel, so the
browse and sequence views were forced back to 3D no matter what the other two said. All three now say 2D
icons. The release still exists and still matters: it is what stops the EDITOR's choice leaking into the
other panels, which is a different job from having a default.

**THE SESSION IS REMEMBERED IN `poc/src/remember.ts`**, a short named list rather than every input on the
page. A blanket "remember everything" would also restore the transient things - a half-typed coordinate, a
selected run, a move index - and those are EDITS, not navigation; quietly bringing back an edit nobody asked
to keep is worse than losing it. The list is navigation and display only: the three levels, the three call
pickers, the three setup pickers, the two view checkboxes, and the tab.

**THE ORDER IS A DEPENDENCY ORDER, NOT A PREFERENCE.** Each list is filled from the choice above it, so the
level is restored before the call and the call before the setup; restoring a call first would set a value
against the wrong list and then have the level's own change handler rebuild the options and discard it. The
tab goes LAST, because switching tabs is what shows and hides the panels every list belongs to.

**A RESTORE IS A CHANGE, AND IT HAS TO SAY SO.** These controls do their work in their own change handlers -
setting `edCall.value` on its own loads nothing - so each restore dispatches a real `change` event. Without
it every dropdown would name one call while the board showed another. The restore also happens AFTER the
app's own `applyMode()`, because the listeners it fires live in panel constructors that must have run.

**EVERY RESTORE IS BEST-EFFORT, WHICH IS THE POINT RATHER THAN A NICETY.** The reason a reload is worth
surviving is that the data underneath is being edited, so a remembered call or setup may simply not exist
any more. A value the control cannot represent is DROPPED SILENTLY and the app opens on its own default,
because a stale fragment of yesterday's session is not something to interrupt the caller about. Corrupt or
hand-edited storage is treated as empty rather than throwing on every page load.

Verified in the browser: a fresh load opens on the 2D icons board; switching to the Call editor, choosing
level A1 and the call "Cross Trail Thru" (setup "Facing Couples Compact"), and RELOADING brings all four
back - tab, level, call and setup.