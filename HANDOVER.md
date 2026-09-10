# Handover

Everything still to do on the square-dance engine, with the evidence for each item and where
to look. Written after the get-out conformance workstream reached step 5 (commits `62b6df3`
and `c21d54f`).

**Read in this order:** this file → `square-dancing.md` §9.1 (the chronological workstream log,
every claim measured) → `square-dancing.md` §9.2 (the consolidated open items, which this file
expands) → `engine/test/fixtures/README.md` (where the oracle comes from and how to re-fetch it).

---

## 1. What the repo is

| Path | What it is |
|---|---|
| `engine/` | The TypeScript library (`dancing-squared-engine`) — the thing under test. `src/sequencer/` holds the model: matcher, applicator, legality, solver, analyser, FSM. |
| `poc/` | Three.js debug app (`sequencer-ui.ts` is the sequencer panel). `poc/src/assets/` is the **canonical call data** (tamination XML). |
| `poc-teacher/` | Teacher/session app; also the biggest consumer of the sequencer. |
| `poc-matrix/` | Earlier matrix/graph experiments (a getout-path cache, `graph.mjs`). Not in `verify`. |
| `features/` | Gherkin specs, gated by `engine/test/bind-audit.mjs` (every `@bind:` tag must resolve). |
| `square-dancing.md` | The spec (§1–§8) + §9 the open-items log. |
| `prd.md` | The requirements/PRD; decisions live in §9.1 (modules), §9.5 (matching contract, §9.5.4 geometry-derived calls) and §14 (open decisions). |
| `taminations-flutter/` | **Reference only.** Data source for the XML assets; do not port its code. |

Untracked `taminations.md` at the root is a scratch file — leave it alone.

## 2. Where it stands

Recent commits, newest first:

```
c21d54f  Features: spec the geometry-derived resolve class
62b6df3  Search: adopt the caller convention for getout()
718ca67  Docs: write the recent work into the requirements, and un-stale a comment
0a7b9d6  Promenade: implement the standard finish as a geometry-derived call
e571092  Circulate: add the missing wave variants at the template spacing
df2a243  Selection: fix the two bugs behind "not legal for selected dancers"
29219f0  Step 4: run the published get-outs, and classify every stop by owner
```

Done and gated: the index-independence invariant; replay from an explicit start board; coded
Face/Turn moves; `isZero` restoring facings; `recognize` vs `matchesNamed`; gender balance;
declared gender on synthesised boards (Phase 6); steps 1–4 of the get-out workstream (a board
in every All8 alignment, the corpus classifier, the corpus runner); 4a selection; 4b the missing
wave `Circulate`; 4c `Promenade` as a geometry-derived resolve; 5 the caller convention in
`getout()`.

**The corpus scoreboard** (`engine/test/getout-behaviour.mjs`, 412 published lines — refresh it
with `node engine/test/getout-behaviour.mjs` from the repo root):

```
 53  13%  reached the finish and applied it        - SUCCESS by the caller convention
  4   1%  reached a state a finish resolves from   - SUCCESS
  0       completed the body but did not resolve
 29   7%  stopped only at the finish              - body ran, the resolve call refused
 71  17%  stopped part-way through the body       - the real coverage gap
202  49%  stopped at a token we cannot decode     - OUR gap in reading All8
 53  13%  page text, not a get-out line
```

**The solver** (`engine/test/getout-convention.mjs`): 27 of the 28 alignments that have a start
board now have a getout, and 27 of 27 replay through the Sequencer onto the home board; all 27
close with `Promenade`. `[P4p]` is the only negative.

## 3. How to work here

```powershell
npm run build --prefix engine                 # tsc
npm run verify --prefix engine                # the whole gate suite: RUN IT IN THE BACKGROUND
                                              # (it takes several minutes and exceeds the
                                              #  foreground command cap)
node engine/test/promenade.mjs                # or any single harness, from the repo root
node engine/test/getout-behaviour.mjs         # the corpus measurement (a report, not a gate)
```

The gates, and what each one pins: `gender-audit`, `verify` (engine smoke), `sequencer`,
`mainstream`, `matrix`, `matrix-getout`, `editor`, `features`, `bind-audit` (every `@bind:` tag
resolves), `behaviour-audit`, `selection`, `promenade`, `getout-convention`,
`all8-formation-map`, `alignment`, `alignment-boards`, `getout-conformance`,
`getout-behaviour` (report).

Working rules that have paid off repeatedly:

- **Measure, do not reason.** Every claim in `§9.1` is a number from a harness, including the
  ones that disproved an earlier claim in the same document.
- **Correct the docs when the code disproves them.** `§9.1` contains several explicit "this was
  wrong" corrections; that is the house style, not a blemish.
- **Commit per phase**, with a descriptive message from a temporary `.git-cmsg-*.txt` (then
  delete it), and delete any `*-verify.txt` log before committing.
- **Write probe scripts as `.mjs` files**, never `node -e` (PowerShell quoting mangles them).
- **Fixtures stay verbatim**, with attribution to Rich Reel / all8.com retained.

## 4. Remaining work

**`PLAN.md` is the phased order**, and it carries one correction to §4.1 below that changes what
step 4d means: the dominant cause of the `Trade`/`Run` failures is not variant *selection* but that
the engine registers variants Taminations' own sequencer refuses (`sequencer="no"`). Read §4.1 here
for the symptom, and `PLAN.md` §2 for the measurement.

### 4.1 Next step: `Trade` / `Run` variant selection (step 4d)

The corpus's **top engine gap** (`Boys Trade` 4×, plus `Run`), and upstream of **6 of the 9
promenade finishes that still refuse**. `ms/trade.xml` declares seven `Boys Trade` variants
qualified by formation (`"Right-Hand Wave, Boys Center"`, `"…Boys End"`, `"Right-Hand Two-Faced
Line"`, …), so this is variant *selection*, not a missing call. Evidence: from `L1p` after `Boys
U-Turn Back` the boys move 4 units **away** from the dancer they should swap with and flip 180°
(`2b (2,1) → (2,5)`, `1b (2,-3) → (2,-7)`; the swap is `(2,-3)`/`(2,1)`); from the `Ocean Waves`
template `Boys Trade` moves the **girls**. Requirements it must satisfy are already written down:
`prd.md` §9.5.1 (variant selection uses declared gender + the designated dancers' actual
geometry, and moves only the dancers it names).

**Corrected by measurement (`PLAN.md` §2).** That requirement is real, but it is the *second* half
of the fix. `engine/src/convert.ts:273` reads only the exact string `'gender-specific'` from the
`sequencer` attribute, so the three other values Taminations defines — `no`, `perimeter`, `exact`
(`taminations-flutter/lib/animated_call.dart:157-168`) — are dropped and those `<tam>`s register as
ordinary setups. The reference sequencer skips them outright
(`taminations-flutter/lib/sequencer/calls/xml_call.dart:57-59`). Measured over all 556 asset files:
**5948 authored `<tam>`, 271 of them `sequencer="no"` across 61 titles, and 32 titles with no
eligible variant at all.** `Boys Trade` is 24 variants — 12 eligible in `b2/trade.xml`, all
`gender-specific`, and 12 `sequencer="no"` in `ms/trade.xml` with **identical `from` strings**, so
the formation name cannot tell them apart — and `matcher.ts:43-71` takes least error over all 24.
Probed directly, the winner on the `Ocean Waves` template and on corpus `[W1p]` is a
`sequencer="no"` demo at `error=0.000`, while on `Normal Lines` it is the eligible setup. `Boys
Run`, `Girls Run`, `Trade`, `Boys Fold` and `Centers Cast Off Three Quarters` have no eligible
variant anywhere, so their winner is always a demonstration animation — which is why `B-Run`
appears in 5 of the 9 refusing promenade lines.


### 4.2 Then: the decoder table (the largest single number)

202 of 412 lines stop at a token our abbreviation table (`engine/test/lib/getout-decode.mjs`)
cannot read — 97 distinct tokens. This is *our* gap, not the engine's, and it is mechanical, but
it must stay **conservative**: a wrong expansion silently turns an engine gap into a phantom call
name. Top tokens on the get-out pages: `DivTh(9) SHing(5) SpChT(4) RStar(4) PsTTC(3) G-RunL(3)`.
Refresh: `node engine/test/getout-behaviour.mjs`.

**Two corrections to the numbers above.** The 202/412/97 count is the *behaviour* harness's, over
`getoutLines` **and** `plusLines` for the alignments that have a start board. The command named
here used to be `getout-conformance.mjs`, which measures something else: **265 get-out lines, 134
decoded (51%), 130 stopped at an unread token** — a different denominator. Neither harness prints
the full ranking (conformance prints the top 14, behaviour the top 18), and both count
**first-failure only**, so a token appearing only *after* an earlier unknown is invisible.

There are therefore **two rankings in this repo that are not comparable**, and which one a token
belongs to has to be settled before it is treated as a work queue:

- the **all-occurrence** count in `square-dancing.md` §9.1 (`Plus`(22), `&Roll`(21), …), which
  includes prose tokens; and
- the **first-failure** count the harness prints, which filters prose out
  (`getout-behaviour.mjs:102-109`).

`&Roll` reads 21 in both only by coincidence of where it lands in a line; `LA` reads 14 vs 6.
Recorded rather than reconciled — `PLAN.md` Phase 2 settles it by reporting both.

### 4.3 Then: the remaining call gaps, by corpus count

| Call | Count | Kind |
|---|---|---|
| `Box the Gnat` | 7 | exists, will not match the board it is reached from |
| `Scoot Back`, `Recycle`, `Rollaway`, `Boys Fold`, `Ends Fold` | 3 each | same |
| `Right Pull By`, `Do Paso`, `Turn Thru`, `Bend the Line`, `Trade the Wave` | 2 each | same |
| `Cross Fold` | 2 | **indexed in `poc/src/assets/src/calls.xml:171` with no implementation** |
| `1/2 Circulate`, `Join Hands` | 1 + 1 | absent from the catalogue entirely |
| `Right and Left Grand` / `Allemande Left` | 16 / 4 | finish-only stops: legal-looking states the finish refuses |

(29 distinct names are in the "exists but will not match" set.) The full ranking is printed by
`getout-behaviour.mjs` under "most common stopping calls" and "ENGINE GAPS".

### 4.4 The search is quadratic in the catalogue — a usability blocker

`Solver.searchCandidates` enumerates **every registered call** per search node (~2200 titles) and,
with equivalents on, re-scans the catalogue per candidate. Consequences, measured: a *successful*
getout is ~3 s; a getout that does **not** exist took **54–102 s** on the corpus; `fixIt` beyond
depth 0 and the `transitionTable` build never finish (the features audit killed a
`transitionTable` build after 20 minutes). So in the UI, `Getout` succeeds quickly and fails
slowly. Needs an index — calls by start formation, or a cheap formation-only pre-filter — before
the getout/fixIt surfaces are usable on a set with no getout.

**Re-measured, and one claim above is stale.** On this checkout, with the `Sequencer` construction
(~51 s) excluded:

```
legalCalls(board)                     L1p 1.47 s (286 legal)  B1c 1.29 s (198)  L.F1p 1.00 s (24)
fixIt depth=0                         4.0-5.6 s                (578 calls offered)
fixIt depth=1                         48.19 s                  (46 calls)
getout maxCalls<=3                    ~0.00 s                  (succeeds; rigid/greedy fast path)
[P4p] getout maxCalls=3 budget=400    134.60 s -> null         <-- the number to beat
synthetic scattered board, budget=20  1.44 s -> null
synthetic scattered board, budget=400 0.07 s -> null
```

So **`fixIt` beyond depth 0 does finish** — depth 1 in 48 s. The claim that it "never finishes" is
stale; only the `transitionTable` build is unverified, and it is still the worst case on the list.
The other correction: **`budget` is not the driver, the size of the reachable state space is.** The
scattered board exhausts its `seen` set in 0.07 s at budget 400, while `[P4p]` (a real alignment)
spends the whole budget for 134.6 s — so any before/after measurement must use a board with a large
reachable state space, and `getout-convention.mjs` deliberately contains none (its own comment at
`:132-135` says why). `PLAN.md` Phase 3 adds one behind an env flag.


### 4.5 Latent correctness items

- **`analyzeFasr`'s `corner` returns the opposite girl** (0/4 agreement with the home ring).
  `FasrRelations.corner` feeds `fasrKey`, which backs `isZero` and the solver's `Static Square`
  check, so this needs its own measured step.
- **The isolated selection reading can be unsound.** It centres the subset and matches with
  normal rotation tolerance, so an arbitrary pair can satisfy a two-dancer setup: `Centers Pass
  Thru` from Facing Lines resolves two dancers (one of them an end) rather than the 4 centres.
  Fix by resolving the group first and constraining the match, rather than by centring.
- **`boardSig` ignores facing** (positions only — its comment used to claim otherwise). The BFS
  therefore does not distinguish a board from its re-faced twin. That is what makes pivot pruning
  work, but anything facing-dependent must key on the full pose (the solver's `finishToHome`
  does). Review whether the search should distinguish them.
- **The `[B]` box promenade disagreement with All8.** In our reading of All8's *own* diagrams the
  `[B]` box puts the couples in **mirrored** ring order, so no rotation of it reaches the home
  square — yet the corpus lists `--Prom` for `[B2r]`, `[B2p]` and one `[B4c]` line (3 lines).
  Either our reading of the box is wrong in a way the FASR classification cannot see, or All8's
  `--Prom` there means something a promenade cannot do while preserving identity. Pinned by
  `getout-convention.mjs` §3b so it cannot be papered over. Related: the promenade rule *admits*
  the `[B1c]` zero box, which the corpus neither confirms nor denies.
- **The wave circulate paths may be wrong.** The shipped `Split Circulate` wave tam — and the new
  `Circulate` wave tams that reuse its paths — moves half the dancers 4 units *between* the two
  parallel waves, where a *split* call should keep each half in place. Needs an independent read
  before changing both calls together.
- **`Circulate` from facing lines is still illegal** (`Normal Lines` has no matching variant; the
  shipped line variants are `Lines Facing In`/`Out`). Same gap the wave templates had.
- **`Promenade`'s 8 beats are a fixed approximation** of a distance-dependent motion.
- **Geometry-derived calls are still not FSM edges.** The precomputed table and
  `Sequencer.legalCalls` enumerate the catalogue, so `Promenade` appears in `legalNext()` (when it
  applies) and is now a search edge, but not in the table; the table builder would need a rule for
  a call legal from a *precondition* rather than from a setup.

### 4.6 The All8 → engine name bridge

`CALL_SYNONYMS` in `engine/src/sequencer/constants.ts` is **empty**, so `Touch 1/4` → `Touch a
Quarter`, `Cast Off 3/4` → `Cast Off Three Quarters` and `Do Sa Do` → `Dosado` resolve only
because a *test harness* maps them (`engine/test/lib/engine-calls.mjs`). Anyone consuming
published choreography needs that bridge in the engine, where `canonicalName()` already applies
it. (Aliases that are the *same call* are already handled in the engine — `Promenade` /
`Promenade Home` — so the bridge is only for differently-named calls.)

### 4.7 Legacy phases (from the original plan)

- **Phase 3 — amendment policy for synthesised boards.** `FsmStore.amend` requires a getout; a
  getout was not found even from boards with full identity, so every amendment from a formation
  that was not danced to was rejected with "no getout". Step 5 should reduce those rejections —
  **not measured**. The decision still needed: make the getout gate advisory (recording
  `getoutVerified`) or treat such formations as unamendable. No UI wires this yet.
- **Phase 4 — coverage and spec alignment.** Audit checks for the bounded non-geometric matching
  exceptions (§8.2), a decision on the editor's "no match within tolerance" wording, and an
  explicit runtime-join check.
- **Phase 5 — hygiene.** `knownFormation` is the last loose-tolerance (6.0) outlier, deliberately
  permissive for legality; review whether it should follow the tight recognition threshold.

### 4.8 Documentation and harness gaps

- **`features/` has no spec for the All8 alignment/corpus work** (steps 1–3: `boardFromDiagram`,
  `arrangementFor`, `sequenceFor`, `relationshipStateOf`), none for the solver/getout search, and
  none for the call editor / synthesised-board amendments. `resolve_calls.feature` (step 4c/5) is
  the newest and the model to follow.
- **`poc-matrix/` is not in `verify`** and `engine/test/map-tips.mjs` is a diagnostic by design
  (it walks realistic tips and reports missing FSM edges — worth running when you touch the FSM).
- A first version of the caller-convention probe measured `getout()` from **home** 28 times
  because `Sequencer.getout()` searches the Sequencer's *own* board — call `setBoard(board)`
  first. See §5.

## 5. Decisions already made — do not relitigate without new evidence

- **The caller convention**: a get-out succeeds by reaching a state a standard finish closes
  (`Allemande Left` / `Right and Left Grand` / `Promenade`), not by sitting on the literal home
  board. It is also the acceptance criterion for the published corpus, and since step 5 it is the
  engine's own search target, implemented as a **finish as the final edge** so returned paths
  still end home (`square-dancing.md` §9.1 step 5, `prd.md` §14).
- **Index independence**: the board index, call index and formation index carry no correspondence;
  matching derives its mapping from coordinates and rotation alone.
- **Identity is data**: home couple and gender are declared or `UNKNOWN_COUPLE`/`phantom` — never
  invented from array position, and anything unknown must not act as identity.
- **Readings are rotation-only, never reflection**: in `[B]`/`[P]`/`[L]` the mirror of arrangement
  0 is arrangement 5's pattern, and a mirrored candidate must never decide an arrangement.
- **Arrangement numbers are per-formation**: look them up (`ARRANGEMENT_TABLES`), never compute
  them from a universal rule.
- **Two tolerances, on purpose**: `DEFAULT_MATCH_MAX = 1.5` for the interactive apply (the UI and
  legality) and `SEARCH_MATCH_MAX = 6.0` for the pure-relative search; a search result must be
  re-validated on the interactive path.
- **A call may be geometry-derived**: a pivot (always legal) or a resolve (legal only when its
  precondition holds, and it must REFUSE with a reason). One definition, shared by the Sequencer,
  the analyser and the search (`prd.md` §9.5.4).

## 6. Traps that have already bitten

1. **Register calls by title, not file basename** — or `Pass Thru` (in `pass_thru.xml`) never
   registers and every corpus line "fails at its first call".
2. **`poc/src/assets/src/calls.xml` is an index, not implementations** (there is no top-level
   `assets/`). A title there with no `<tam>` anywhere is a call the engine *knows* and cannot
   perform (`Cross Fold`, `1/2 Circulate`).
3. **`getUniqueFormations` dedupes congruent shapes including reflection**, so it cannot name e.g.
   `Two-Faced Lines LH`; `recognize` does distinguish it.
4. **`Sequencer.getout()`/`fixIt()` search the Sequencer's own board** — `setBoard(board)` first,
   or you measure the home board N times.
5. **`boardSig` is positions-only**; a pure pivot therefore collapses onto the state it came from
   (which is why pivots need not be search edges).
6. **All8's `--Prom` is a finish**, not a fraction; `A-Prom` = "All Promenade" = bare `Promenade`
   (the group prefix names everyone); `--PromH` = `Promenade Home`, one call.
7. **`[P]` (Beginning DPT) mixes side-by-side and facing couples**, so All8 defines no reference
   pair for it: its relationship letter is `null`, which is why 2 of 28 alignments do not classify
   back.
8. **Page text is not a get-out**: 53 of the 412 "lines" are prose that leaked into the lists.
9. **PowerShell truncation looks like a failure**: `... | Select-Object -First N` can make a
   successful command report `[exit code: 1]`. Re-run without the truncation before believing it.
10. **The corpus is an oracle, not a spec**: when it disagrees, the disagreement is recorded
    (with the measurement) rather than smoothed away by loosening a rule.

## 7. If you have one afternoon

1. **`Trade`/`Run` variant selection** — the top engine gap and it unblocks 6 refused finishes
   (§4.1).
2. **The decoder table** — the largest single number in the corpus, mechanical, and it unmasks
   what the engine can really do (§4.2).
3. **The search index** — turns a 1–2 minute failed `getout()` into a usable UI action (§4.4).
