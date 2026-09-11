# Plan

What to implement next, in phases, with the evidence for each. This supersedes the "if you have
one afternoon" ranking in `HANDOVER.md` §7 in one respect only: **step 4d starts by honouring the
`sequencer` attribute**, because that is the measured cause of the Trade/Run failures and it is
cheaper than the selection rule the handover proposes first.

**Read in this order:** `HANDOVER.md` → this file → `square-dancing.md` §9.1 (the chronological
workstream log) → `square-dancing.md` §9.2 (the consolidated open items).

Working rules are unchanged from `HANDOVER.md` §3: measure, do not reason; correct the docs when
the code disproves them; commit per phase; write probes as `.mjs` files, never `node -e`; run
`npm run verify --prefix engine` **in the background** (several minutes, exceeds the foreground
cap); delete any `*-verify.txt` log before committing; fixtures stay verbatim with attribution to
Rich Reel / all8.com retained.

---

## 1. The baseline this plan was built on

`npm run verify --prefix engine` — **all 19 gates, exit 0**. The corpus scoreboard reproduces
exactly:

| | lines | share | owner |
|---|---|---|---|
| reached the finish and applied it | 53 | 13% | success by the caller convention |
| reached a state a finish resolves from | 4 | 1% | success |
| completed the body but did not resolve | 0 | 0% | — |
| stopped only at the finish | 29 | 7% | the finish calls |
| stopped part-way through the body | 71 | 17% | the real coverage gap |
| stopped at a token we cannot decode | 202 | 49% | **our decoder** |
| page text, not a get-out line | 53 | 13% | not a conformance datum |

`getout-conformance.mjs` separately reports **265 get-out lines, 134 decoded (51%), 130 stopped at
an unread token** — a different denominator from the 412 that `HANDOVER.md` §4.2 quotes.

Solver baseline (reproduced on demand, `Sequencer` construction ~51 s excluded):

```
legalCalls(board)                 L1p 1.47 s (286 legal)   B1c 1.29 s (198)   L.F1p 1.00 s (24)
fixIt depth=0                     L.F1p 4.04 s   B1c 4.38 s   L1p 5.58 s        (578 calls)
fixIt depth=1                     L.F1p 48.19 s                                    (46 calls)
getout maxCalls<=3                L1p / B1c / L.F1p ~0.00 s        (all succeed)
[P4p] getout maxCalls=3 budget=400  134.60 s -> null            <-- the number to beat
```

---

## 2. The correction that reshapes step 4d

> **REFUTED — see Phase 1.** The measurement below is real and the *facts* stand (the flag is
> ignored, demos compete with setups, a demo wins the tie on the Ocean Waves template). But it is
> **not the fix**: filtering the demos out makes the published promenade results WORSE (12 of 30
> resolve → 8 strict / 11 preferring-eligible), because the demos are acting as an ungated
> fallback. The real mechanism is that every eligible `Boys Trade` wave variant is authored for
> boys-in-*centre* while the engine's wave template is `BggB` (boys at the *ends*), so the gender
> gate correctly rejects all of them. The reference implements `Trade` and `Run` in **code**
> (`calls/ms/trade.dart`, `run.dart`), which is why their tams are not-for-sequencer. Phase 1 has
> the corrected mechanism and the fix.

`HANDOVER.md` §4.1 frames the top engine gap as **variant selection** — "select the variant from
the declared gender plus the designated dancers' actual geometry" (`prd.md` §9.5.1). That
requirement is real. But measured, the dominant cause sits **upstream of selection**: the engine
registers variants the reference implementation refuses, and then picks among a superset.

**Evidence.**

- `taminations-flutter/lib/sequencer/calls/xml_call.dart:57-59` — the reference sequencer skips
  them outright:
  ```dart
  for (var tam in lookupAnimatedCall(norm)) {
    if (tam.notForSequencer) continue;
  ```
- `taminations-flutter/lib/animated_call.dart:157-168` shows `sequencer` has **four** values:
  `perimeter` | `exact` | `gender-specific` | `no`.
- `engine/src/convert.ts:273` reads **only** the exact string `'gender-specific'`. `no`,
  `perimeter` and `exact` are silently dropped, so those `<tam>`s register as ordinary setups.
- Counted over all 556 asset files under `poc/src/assets` (excluding the `src/` index):
  **5948 authored `<tam>`, of which 271 are `sequencer="no"` across 61 titles — and 32 titles have
  no eligible variant at all.** Also 285 `gender-specific`, 17 `perimeter`, 1 `exact`.
- `Boys Trade` = **24 variants**: 12 eligible in `b2/trade.xml` (every one
  `sequencer="gender-specific"`), 12 `sequencer="no"` in `ms/trade.xml`. They carry **identical
  `from` strings**, so the formation name cannot tell them apart. `matcher.ts:43-71` takes least
  error over all 24, first-wins on ties, with no eligibility filter.
- Direct probe of what the engine actually selects, all at `error=0.000` (perfect geometric
  matches):

  | board | `Boys Trade` winner |
  |---|---|
  | `Normal Lines` template | eligible (`gender-specific`) |
  | **`Ocean Waves` template** | **`sequencer="no"` demo** |
  | **corpus `[W1p]`** | **`sequencer="no"` demo** |
  | **corpus `[F1p]` + `Boys U-Turn Back`** | **`sequencer="no"` demo** |
  | corpus `[L1p]` + `Boys U-Turn Back` | eligible (`from="Waves, Boys Facing Out"`) |

  The Ocean Waves row **is** the handover's own symptom ("from the `Ocean Waves` template `Boys
  Trade` moves the girls"). The same call selects different *classes* of variant depending on the
  board.
- `Boys Run` / `Girls Run` / `Centers Run` / `Ends Run` (32/34/20/18), `Trade` (3/3),
  `Boys Fold`, `Girls Fold`, `Centers Cast Off Three Quarters` (12/12) have **no eligible variant
  anywhere** — their winner is always a demonstration animation. `B-Run` appears in **5 of the 9**
  refusing promenade lines, which is why those bodies leave partners 4–6 units apart.

**Consequence.** Step 4d is two halves, in this order: *filter to the eligible set first* (which
shrinks `Boys Trade` from 24 candidates to 12, and turns Run/Fold/Cast-Off/Turn-Back from
"silently wrong motion" into "no setup"), *then* apply the §9.5.1 selection rule over what
remains. Neither half alone fixes the corpus.

---

## Phase 0 — Lock the baseline, correct the record

Small, and it makes every later phase measurable.

- Commit the measured baseline for the two slow harnesses and the solver numbers, so "before" is
  on the record rather than in a transcript.
- Correct five doc inaccuracies found while building this plan — house style is to record
  corrections, not smooth them away:
  1. `HANDOVER.md` §4.2 cites `node engine/test/getout-conformance.mjs` as the refresh command for
     the **202/412/97** numbers, but those come from `getout-behaviour.mjs`; conformance reports
     265/130. Neither harness prints the full 97 (top 14 and top 18 respectively).
  2. `HANDOVER.md` §4.3 and §6 trap 2 cite `assets/src/calls.xml`; the real path is
     `poc/src/assets/src/calls.xml` (there is no top-level `assets/`).
  3. `HANDOVER.md` §4.4 and `square-dancing.md` §9.1 say `fixIt` beyond depth 0 "never finishes" —
     measured, `fixIt depth=1` finishes in **48.2 s**. Stale.
  4. `square-dancing.md` §9.1's blocker list (`Plus`(22), `&Roll`(21), …) is an **all-occurrence**
     count that includes prose; the harness counts **first-failure** and excludes prose. The two
     lists are not comparable, and which one `Plus` belongs to must be settled before anyone
     expands it.
  5. `[P4p]` at `getout({maxCalls:3, budget:400})` = **134.6 s → null**, pinned as the reproducible
     failing-search number.

**Gates:** `npm run verify` green on the docs commit.
**Done when:** the corrected numbers are in `square-dancing.md` §9.x with the command that
produced each.

---

## Phase 1 — `sequencer` attribute and the `Trade`/`Run` mechanism (step 4d)

**Status: the plumbing landed; the §2 hypothesis was REFUTED by measurement; the exact mechanism
is now pinned. Read the "Refuted" note below before acting on §2.**

### What was implemented

1. **The flag is carried faithfully.** `convert.ts` now parses all four values of the `sequencer`
   attribute that Taminations defines, into `sequencerMode` on `TamRaw` and `CallBundle`, with
   `forSequencer` and `genderSpecific` **derived** from it (one source of truth). The editor's
   `synthesizeSetup` / `synthesizeSetupChain` inherit the core's flags, so a synthesised variant of
   a `no` call cannot default to eligible and re-open the hole.
2. **Two queries, not one policy.** `CallLibrary.matchableVariants` (what matching uses),
   `sequencerVariants` (strictly eligible) and `hasSequencerSetup`, mirrored on the `Sequencer`
   facade, so "this call has no sequencer setup at all" is distinguishable from "the board does
   not match any of its setups". `selection.mjs` gates the plumbing invariant — every variant's
   `forSequencer` / `genderSpecific` agrees with its own `sequencerMode`.
3. **Matching is deliberately left UNFILTERED.** See below.

### Refuted: "filter the `sequencer="no"` variants" is not the fix

§2 proposed that the engine registering `sequencer="no"` demonstration animations is why the wrong
variant is applied. That is a true *fact* and a false *fix*. Measured both ways, with
`promenade.mjs` §5 as the gate:

| policy | published promenade get-outs that resolve | corpus success |
|---|---|---|
| unfiltered (shipped) | **12 of 30** | 53 |
| strict skip of every `no` variant | **8** — gate FAILS | 52 |
| prefer eligible, fall back where a call has none | **11** — gate FAILS | 53 |

The strict skip loses the `B-Run` bodies. And "prefer eligible" fails too, which is the interesting
part: the two copies of `Boys Trade` are **indistinguishable on the setup** — for all 12 of its
`from` strings the `b2/` eligible copy and the `ms/` demo copy have identical start geometry *and*
identical beat counts — so least-error matching cannot prefer one on geometry, and preferring it
by rule only re-orders an exact tie.

### The real mechanism (measured)

`Boys Trade` on the engine's own `Ocean Waves` template:

```
[10] ELIGIBLE genderSpecific=true  from="Waves, Boys in Center"  REJECTED BY GENDER GATE (geometry matches at 0.0000)
[11] ELIGIBLE genderSpecific=true  from="Waves, Boys Facing Out" REJECTED BY GENDER GATE (geometry matches at 0.0000)
[22] demo     genderSpecific=false from="Waves, Boys in Center"  err=0.0000  <-- WINNER
[23] demo     genderSpecific=false from="Waves, Boys Facing Out" err=0.0000
```

The engine's wave template is **`BggB`** — boys at the ENDS (correct: All8's arrangement 0 for a
wave, and `alignment.mjs` requires the engine templates to read as arrangement 0). Every eligible
`Boys Trade` wave variant is authored for boys **in the CENTRE**. So the gender gate *correctly*
rejects all of them, no eligible variant matches, and the **ungated demonstration wins the tie** by
array order — applying motion authored for boys-in-centre to a boys-at-ends board. That is the
recorded symptom ("from the `Ocean Waves` template `Boys Trade` moves the girls"), and it is why
removing the demos costs capability instead of correcting motion: they are acting as an *ungated
fallback*. On `Normal Lines` and `Two-Faced Lines` an eligible variant matches and wins, which is
why the call is right from lines and wrong from two parallel waves.

### The fix the reference actually uses: make `Trade` and `Run` DERIVED calls

`taminations-flutter/lib/sequencer/calls/ms/trade.dart` and `run.dart` implement both calls in
**code**, which is why their `<tam>`s are marked not-for-sequencer. `trade.dart` is the
specification:

- the trading dancer trades with the **nearest dancer in the direction containing an odd number of
  dancers** (`rightcount % 2 == 1 && leftcount % 2 == 0`, or the mirror);
- if there are **intervening dancers**, they are run around — the path scales to make room and
  passes right shoulders (`ctx.inBetween(...).isNotEmpty()` → `scaleX = 2.0`). So a trade *across*
  intervening dancers is legal, which is the case that `Boys Trade` from a `BggB` wave is;
- with no intervening dancers it is a Partner Trade (flip) when running left in the same
  direction, otherwise a run scaled by half the distance, with hand holds for the swing/slip cases
  (`!samedir && dist < 2.1`).

`run.dart` is the same shape: the runner runs around the dancer(s) on the side that has walkers,
preferring the **partner** when both sides are open, and each walker dodges into the runner's spot.

**Next step (this replaces the old Phase 1 step 5).** Implement `Trade` (`Boys`/`Girls`/`Centers`/
`Ends Trade`, and bare `Trade`) and `Run` as geometry-derived calls in `coded-moves.ts`, under the
`prd.md` §9.5.4 contract (a precondition over the board, a refusal with a reason, one definition
shared by apply/replay/search). Then, and only then, the `sequencer="no"` filter becomes safe,
because the capability no longer depends on the demonstration tams. Until that lands, matching
stays unfiltered and the honesty is recorded rather than enforced.

**The defect is now PINNED as a gate**, not left as prose — `selection.mjs`, section
"Trade / Run from two parallel waves". It asserts today's wrong behaviour so the fix has to flip a
red assertion rather than quietly change a number:

```
Boys Trade: 4 dancers moved (0 boys, 4 girls); result is Ocean Waves
    KNOWN DEFECT PINNED: Boys Trade moves only the GIRLS (4 of 4) - wrong dancers
Boys Run:   turns the wave into Two-Faced Lines
    KNOWN DEFECT PINNED
Boys Trade: 12 eligible variants, 12 demos, and 0 ELIGIBLE variants match this template
Boys Run:   0 eligible variants in the whole family - every one is sequencer="no"
```

Two things that measurement settles, and that the derived implementation must honour:

- **`Boys Trade` from the engine's `Ocean Waves` template moves the four GIRLS and no boys.** That
  is the recorded symptom reproduced deterministically. The instantiation is worth spelling out:
  the only tams matching the template are *ungated demos* authored for boys-in-centre, so the
  dancers that move are the ones occupying the centre slots — the girls.
- **`Boys Run` from the same template turns the wave into `Two-Faced Lines`.** A Run from a wave
  must leave the wave a wave, with the genders swapped end↔centre; destroying the formation is the
  demo's boys-in-centre motion applied to a boys-at-ends board.

### Reference semantics to implement (transcribe, do not re-derive)

Our `moves.xml` already carries the motion primitives the reference selects from — `Run Left`,
`Run Right`, `Flip Left`, `Dodge Left`, `Dodge Right` — and our engine already resolves them. So
this is a **selection and geometry** job, not a path-authoring one. Two facts about the reference's
movement data that matter when reading its rule:

- a `Movement` holds **two** Bezier curves: `btranslate` (the travel path, `cx1/cy1 → cx2/cy2 →
  x2/y2`) and `brotate` (the facing curve, `cx3/0 → cx4/cy4 → x4/y4`). When `cx3` is absent,
  `brotate = btranslate` (`math/movement.dart:52-92`); the `x4/y4` pair is a **direction**, not a
  position, which is why `Dodge Left`'s `(8,1)` is "about 7° left of forward" rather than nine units
  of travel.
- in our own model a move is a net local displacement plus a turn (`moves.ts`, `Move {dx, dy,
  turn}`), so only the **net** end state of each reference move is needed. `Run Left` is net
  `(0, +2)` local with no turn; `Dodge Left` is net `(0, +2)` local with the facing curve ending
  near-forward. Read `moves.xml` for the authority rather than these reconstructions.

**OPEN, and do not guess at it: the FACING convention.** The net *translation* of every reference
move is settled (a `Run` exchanges the runner's and the walker's positions — both scale by
`dist/2`, and the walker's dodge is measured in the walker's own frame, which faces opposite, so
the two are the same world direction). The net *facing* is not. For `Run Left`/`Run Right` the
reference passes no `cx3`, so `brotate = btranslate`, and the endpoint-to-last-control tangent of
`Run Right` is `(-1.333, 0)` — pointing 180° from the dancer's initial facing, which cannot be
right for a call that preserves a wave. The resolution is in how a pose is actually computed from
the rotation curve (`math/bezier.dart`, and the dancer pose path), not in the raw numbers. Settle
it against a case with a known answer — `Boys Run` from a wave must leave the wave a wave with the
genders swapped end↔centre, which is asserted in `selection.mjs` — and only then write the call.
A wrong `turn` here would silently produce new wrong motion, which is the failure mode this repo
treats as worse than a known gap.


**Gates:** `selection.mjs` (plumbing invariant), `promenade.mjs` §5 (12 of 30 must not regress),
`getout-behaviour.mjs` (53 success must not regress), `getout-convention.mjs` (27/28 with `[P4p]`
the only negative).

**Risk:** unchanged — this is still the phase that changes what every search node considers. Land
the derived calls and the filter as separate commits.

---

## Phase 1b — DONE: `Trade` and `Run` are derived calls

**Implemented, gated and measured.** `engine/src/sequencer/trade-run.ts` holds both rules;
`coded-moves.ts` registers them with a new selection-aware hook.

### The rule, and why the facing question dissolved

> **CORRECTED IN PHASE 4H — READ THIS FIRST.** The paragraph below claims both calls swap position
> *and* facing for both dancers. That is right for `Trade` and **WRONG for `Run`**: only the
> **runner** turns 180°, and the dancer run around keeps its own facing, so a Run from a wave
> produces a **two-faced line**. The reference's move curves settle it (`RunLeft`/`RunRight` carry
> no rotation curve, so the facing follows the path tangent and reverses; `DodgeLeft`/`DodgeRight`
> do carry one and end forward), and All8's `--SwThr B-Run --BendL` confirms it. The correction,
> the measurement and what it cost are in **Phase 4h** below. The reasoning that led to the wrong
> claim is kept here because the wrongness is instructive: positions came from the reference's
> `dist/2` arithmetic and were right; facings were *inferred* from "what keeps a wave coherent" and
> were not.

**Both calls are SWAPS of complete dancer state — position AND facing — and nobody else moves.**
That is what the reference's own arithmetic amounts to: `run.dart` scales the runner's path and
the walker's dodge by the *same* `dist/2`, measured in the two dancers' own frames, which face
opposite — so the two displacements are the same world vector. `trade.dart` likewise scales the
trader's run by `dist/2` and leaves the intervening dancers out of `actives` entirely.

This retired the whole "facing convention" worry recorded in the previous revision of this file.
Static reading of `math/bezier.dart` was inconclusive (the facing is the curve *tangent*, which at
`RunRight`'s endpoint points 180° from the start, while `rolling()` re-reads it as −90°), but in the
net model there is no turn to derive: a Run exchanges the pair's facings, and that is exactly what
keeps a wave coherent. Verified empirically by feeding each authored variant its own declared
formation and reading the end board, and corroborated independently by the corpus, where the
shipped demo motion leaves partners 4–6 units apart in 6 published promenade get-outs.

Two honest limits, both REFUSED with a reason rather than approximated, per `prd.md` §9.5.4:
a Run around more than one dancer (`Run Around 2` — the reference's default is `runAround = 1`,
which is what is implemented), and the reference's hand-holds for the swing/slip trade cases
(`!samedir && dist < 2.1`), because a derived apply has no hand state to read.

### Contract addition

`CodedMove.applyToSelection?(board, selectedIds)` — for a call whose **non-designated dancers must
also move**. The "apply the whole-board transform, then keep only the selected dancers" trick that
serves the pivots cannot express it: it would discard the walker's motion and leave two dancers on
one spot. `Sequencer.tryCodedMove` uses it when present, and the harness asserts that every dancer
keeps a distinct spot through a Run precisely because that is the failure mode.

Both names also **refuse the bare form** with a reason ("Trade names a group to trade…"), which is
correct rather than a placeholder: `Trade` and `Run` name no subset on their own. That refusal also
keeps them out of `legalNext` and out of the search's edge set, because `legality.searchLegalCalls`
adds only precondition-carrying coded moves that actually apply.

### Measured

| | before | after |
|---|---|---|
| promenade get-outs that resolve (of 30) | 12 | **15** |
| promenade refusals: partners not together ("broken body") | 6 | **3** |
| corpus: reached the finish and applied it | 53 | **59** |
| corpus: stopped part-way through the body | 71 | **68** |
| corpus `ENGINE GAPS` distinct names | 29 | **25** |
| `Boys Run` in `ENGINE GAPS` | top entry | **gone** |

`selection.mjs` asserts the fixed behaviour: `Boys Trade` moves only the 4 boys (trading across the
intervening girls, which is the reference's `inBetween` case) and leaves an Ocean Waves; and `Boys
Run` turns only the runner, so the wave becomes a **two-faced line** and every dancer keeps a
distinct spot. *(Phase 1b asserted "keeps the wave an Ocean Waves" here; **Phase 4h** corrected it
with the reference's move curves as evidence. The rest of this table is unaffected — it measures the
`Trade` fix and the disappearance of `Boys Run` as a gap, not the facing rule.)*

**Still open from this family.** `Cross Run`, `Fold` / `Boys Fold` / `Girls Fold`,
`Centers Cast Off Three Quarters`, `Turn Back` and the group-scoped `Heads/Sides Square Thru N`
are in the same boat — 32 titles whose only authored setups are demonstrations — and each needs
either a derived rule or an honest refusal. `Trade the Wave`, `Bend the Line`, `Box the Gnat` and
the rest of `ENGINE GAPS` are Phase 4.

---

## Phase 2 — DONE: the decoder table and the tokenizer

**Implemented, gated and measured.**

### The tokenizer bugs (four, each measured, none guessed)

`getout-decode.mjs`. The plan predicted two; measurement found four:

1. **A trailing joiner dash was never stripped.** All8 uses `-` as a *joiner* as well as a
   leading call marker, so a dash trails a token. **24 occurrences across 18 distinct tokens**,
   and several were tokens the table already knew: `C-SqT@3-`, `C-StepW-`, `C-SwThr-`, `C-T1/4-`,
   `C-VeerL-`, `C-PsOcn-`, `E-Trd-`, `DoSaD-`, `Clovr-`. Stripping only *leading* punctuation
   lost every one of those lines to a readable token.
2. **`{...}` is a third aside form.** The corpus writes conditional notes in braces —
   `{beau couple: H/S}-WhlAr` — which the `()` and `""` passes left in place, gluing the aside
   onto the following call.
3. **`[...]` alignment markers.** `[B1c]`, `[L1p]` and friends are commentary, six lines' worth.
4. **A collapsed gap before a call marker.** All8 separates calls with wide gaps, but wherever an
   aside was removed from between two calls the gap collapses to a single space, so `AL --PasTh`
   arrived as ONE token — the same glue that produced the bare `C-` leftover. A `--` always
   starts a new call, so the tokenizer now splits before one.

### The membership gate that did not exist

`getout-conformance.mjs:166` used to be a literal `check(true, …)`. A wrong expansion does not
crash and does not fail a gate: it moves a line from "our decoder gap" into "the engine has no
such call", so the harness **accused the engine** of a gap that was really our misreading, and
nothing could tell the two apart.

The rule cannot be "is it implemented", because the corpus legitimately names calls the engine
lacks. So it is now: **implemented, OR explicitly declared in `KNOWN_CATALOGUE_GAPS`** — which
makes each gap a deliberate, reviewable statement, and makes a mis-expansion fail loudly. The gate
also fails if a declared gap has since been *implemented*, so the gap count cannot quietly go
stale. Table names: **77, all admissible.**

The declared gaps, measured (59 of the table's 64 distinct names were implemented before Phase 2):
`Join Hands`, `1/2 Circulate` (absent entirely), `Left Hinge` (absent; only bare `Hinge` exists),
`Fold`, `Cross Fold` (in the index, no `<tam>` anywhere).

### Both rankings, not a slice

`decodeStats` reports **first-failure** (lines a fix would unblock) and **all-occurrence** (true
vocabulary size). They disagree materially — `&Roll` is 21 vs 41 — so a work queue built from one
is not the queue built from the other. Previously the harness printed the top 14 and the top 18 and
the two were quoted interchangeably.

### What the measurement rejected, and why it matters

Every addition was checked against `implementedTitles()` *before* being added. That procedure
caught four traps intuition would have missed:

- **`Sweep`** → "Sweep a Quarter" is in the engine's call **index with no `<tam>` anywhere**. An
  indexed title is not a call.
- **`SHing` (11, the second-largest remaining token)** → "Single Hinge" is *not implemented*
  (`Split Hinge` neither). Decoding it would have booked a real engine gap as a phantom name.
- **`&Roll` (30, the largest remaining token)** → `Roll` is not a call in this engine at all
  (`tam`, index and implemented all absent). All8 writes it as a **modifier on the preceding
  call**, and the reference implements it in code. It needs composition support, not a table
  entry — as does `Expl&` ("Explode and <next call>").
- **`H-Trd`** → "Heads Trade" is not a *title*, but it does resolve, because the engine reads a
  group prefix compositionally and reaches the derived `Trade`. That is why `H` was added to
  `GROUP`: the fixture states `H` = Heads in All8's own characters via `{beau couple: H/S}`.

`LA` is left undecoded on purpose: `Ladies Chain` is implemented and `Left Allemande` is not, so
the membership rule alone would have passed a reading the abbreviation does not settle — the rule
is necessary, not sufficient, and ambiguity still wins.

### Measured

| | before Phase 2 | after |
|---|---|---|
| get-out lines decoded (of 265) | 134 (51%) | **160 (60%)** |
| get-out lines stopped at an unread token | 130 | **104** |
| whole-set names registered | 46/48 | **54/56** |
| corpus: reached the finish and applied it | 59 | **66** |
| corpus: stopped at an undecodable token | 202 | **170** |
| corpus: page text | 53 | **46** |
| corpus: stopped part-way through the body | 68 | **94** |

**The mid-body count going UP is the intended outcome**, not a regression: 32 lines moved out of
"our gap" and into genuine engine findings, which is exactly what this phase exists to achieve —
until a line can be read, there is no way to tell whether the engine can dance it. The four
largest remaining tokens (`&Roll` 30, `SHing` 11, `LA` 9, `Expl&` 5) are now all *declared*
missing implementations or modifiers, not unreadable notation.

---

**Goal:** move the 202 undecoded lines into a real measurement of the engine, without ever
inventing a call name.

### Steps

The plan's original four steps, kept here with what actually happened to each, because two were
overtaken by measurement:

1. ~~Fix the tokenizer.~~ **Done — and it was FOUR bugs, not two.** The `O-` prefix predicted here
   turned out to occur once (`O-DivTh`) and is still left undecoded; what measurement found
   instead was the trailing joiner dash, `{...}` braced asides, `[...]` alignment markers, and a
   collapsed gap before a `--` call marker. See above.
2. ~~Add the gate that does not exist.~~ **Done, in a stronger form than proposed.** "Every decoded
   expansion must be an implemented title" cannot be the rule as stated, because the corpus
   legitimately names calls the engine lacks; it is now "implemented OR declared in
   `KNOWN_CATALOGUE_GAPS`", which keeps genuine gaps honest *and* fails on a mis-expansion.
3. **Expand conservatively** — done, and the procedure (check `implementedTitles()` first) is now
   written into the file header rather than left as a habit. `catalogueTitles()` is the oracle;
   `indexedTitles()` is not. Confirmed in practice: `Sweep a Quarter` is indexed and not
   implemented, and `RStar` is a pure phantom.
4. **Report the full ranking, not a slice** — done: `decodeStats` reports both rankings, and the
   harnesses now print all of them rather than the top 14/18.

**Residual, and deliberately so:** four tokens account for most of what is left, and none is an
unreadable-notation problem — `&Roll` (30) needs the **Roll modifier**, `Expl&` (5) needs
**"Explode and <call>" composition**, `SHing` (11) needs `Single Hinge` implemented, and `LA` (9)
is left ambiguous on purpose. Those are Phase 4 work, and the table records each with its reason
so nobody re-adds them as vocabulary.

---

## Phase 3 — DONE: the quadratic term removed, and the failing search bounded

**The L × C term is gone**, and the phase found a real defect on the way.

### Instrumentation first, as the plan required

`SearchStats` (in `config.ts`, exported from the index) reports `nodes`, `candidateScans`,
`candidateCalls`, `distinctEndBoards`, `equivalentScans` and `equivalentNameIterations`, collected
only when `setCollectStats(true)`. The plan's reason was exact: **timing alone cannot tell the two
complexity terms apart** — a change that halves L and a change that removes the C factor look
identical in a stopwatch. Every number below came from those counters.

### The fix: the answer was already in hand

`searchCandidates` called `equivalentCalls`, which **scanned the whole catalogue again** — once per
distinct end board. That is the L × C term: with C = 2211 titles and L between 24 and 286, 53 000
to 634 000 applies per node.

But a call's equivalents are precisely the other calls **legal from this board** that reach the
same end formation — and `searchLegalCalls` has already computed exactly that list, with end
boards. Grouping it by `knownFormation` reproduces `equivalentCalls` from work already done, so the
term **disappears** rather than shrinking. The private `equivalentCalls` is deleted; the public
query `Sequencer.equivalentCalls` is unchanged.

### A defect found while measuring: `fixIt` returned duplicates

`Promenade` appeared **eleven times** in `fixIt`'s output from home. The equivalents loop visited it
once per candidate ending in the same formation, and each visit pushed a `(name, res)` pair that was
byte-identical to the last. Pre-existing, not introduced here — but a list of calls a caller may
choose from must not repeat one, so the candidate list is now deduped on `(name, end board)`, which
keeps genuinely different edges (the same call reaching a *different* board) and drops exact
repeats.

### Measured, same machine, old source vs new (git stash, rebuild, re-run)

| invocation | before | after |
|---|---|---|
| `[P4p]` getout `maxCalls=3 budget=400` (**fails**) | **95.0 s** | **11.5 s** |
| `[P4p]` getout `maxCalls=2 budget=100` (fails) | 32.5 s | 3.9 s |
| getout on `L1p` (succeeds) | 4.16 s | 1.87 s |
| `fixIt depth=0` on `L.F1p` | 1.81 s | 0.78 s |
| `fixIt depth=1` on `L.F1p` | 33.0 s | **3.6 s** |

And the counters confirm the mechanism rather than merely the speed:
`eqScans=0, eqIters=0` on every invocation.

### An honest behaviour change

`fixIt` from home now offers **18** calls, not 578. Two separate reasons, both measured:

1. the duplicate bug above; and
2. the old equivalents came from `applySearch` at the **loose** search tolerance with **no tight
   prefilter**, so the list included force-fits — calls `searchLegalCalls` deliberately prunes,
   in its own words, "so force-fits are pruned at search time rather than surfacing as a getout
   that fails on apply".

Verified rather than asserted: **0** of the new list's entries fall outside the tight legal list.
The documented 578 was inflated by both effects and described in `square-dancing.md` as "not a
shortlist"; 18 is one.

### The regression gate the harness lacked

`getout-convention.mjs` only sampled **five** alignments, so a regression in the other twenty-three
would have passed unnoticed — and the workstream's headline claim, "27 of the 28 alignments that
have a start board", was asserted nowhere. Section 5b now sweeps **every** alignment and pins the
cost of the failing search, behind `GETOUT_SWEEP=1` so `npm run verify` stays fast:

```
27 of 28 alignments have a getout within 3 calls
no getout: P4p (11523 ms)
ok  [P4p] failing getout answers null in 11.5 s (the bound is 40 s; it was 95 s before Phase 3)
```

It also asserts `fixIt` lists each call at most once, and that depth 1 is affordable — the previous
comment in that file described depth 1 as taking minutes.

### What is left

The counters now show the **C term is what remains**: `[P4p]` does 17 catalogue scans
(`candidateScans=17`) for 447 nodes, and those scans are the 11.5 s. Removing them needs the
start-formation index the plan describes — index the variants once (making
`library.allVariantSetups()` carry the call name it currently drops) and pre-filter the per-name
loop, whose cost is a `findMatchingVariant` — i.e. a mirror-aware map, a signature computation and a
match — per one of 2211 titles, per node. That is the next win, and it is bounded work now that
the quadratic term is gone.

---

### The plan's steps, against what happened

1. ~~Instrument first.~~ **Done** — `SearchStats`, and the counters are what identified the fix
   rather than merely confirming it.
2. **Index calls by start formation.** *Not yet needed, and now clearly the remaining work.* The
   L × C term turned out to be removable without any index, because the equivalents were derivable
   from the candidate list. The counters now name what is left: `[P4p]` pays 17 catalogue scans for
   447 nodes, and those scans are the 11.5 s. The proposed change point stands —
   `library.allVariantSetups()` is still the flat list that **drops the call name**, and making it
   `{ name, setup }[]` is still the minimal way to build the index.
3. **Do not build it as an FSM table** — unchanged, and the reason is unchanged: building the table
   is itself O(states × catalogue), which is what killed the 20-minute build.
4. ~~Add the regression point the harness lacks.~~ **Done** — section 5b, behind `GETOUT_SWEEP=1`,
   and it immediately earned its keep by confirming 27 of 28 across every alignment, a claim that
   had been asserted nowhere.
5. **Re-measure the `transitionTable` build** — still unverified, and still the worst case
   remaining on the list. Recorded as open.

**Done when `[P4p]` is bounded in seconds with the same `null` answer, and `fixIt depth=1` is
usable** — met: 11.5 s and 3.6 s respectively, both from 95 s and 33 s.

---

## Phase 4 — IN PROGRESS: the finish stops were a symptom, and one cause is fixed

**Target: the 32 finish-only stops.** They are labelled "the cheapest wins — the get-out reached
the state it was written to reach and only the resolve call itself did not apply". Diagnosing them
found that the label is wrong: **the get-out did not reach the state it was written to reach.**

### The diagnosis

All 25 `Right and Left Grand` / `Allemande Left` refusals share **one** reason — "No setup in this
call matches the current formation" — and in every case the board they reached reports
`formation: null`. Tracing the published lines one call at a time shows why, and the distortion
starts in the BODY:

```
[B4c] "--SldTh --PsOcn --LSwTh --RLG"
  START                 y:[-1,1]   x:[-3,3]   Eight Chain Thru
  after Slide Thru      y:[-2,2]   x:[-3,3]   Normal Lines
  after Pass the Ocean  y:[-3,3]   x:[-2,2]   Ocean Waves      <- correct
  after Left Swing Thru y:[-7,7]   x:[-2,2]   null             <- THE WAVE'S SPAN MORE THAN DOUBLED
  Right and Left Grand: REFUSED - No setup in this call matches the current formation.
```

**Cause 1, found and FIXED: a reflection was winning a tie.** On that right-hand wave,
`Left Swing Thru` matched a `from="Left-Hand Waves"` variant **by reflection** at `error=0.0000`
*and* a `from="Right-Hand Waves"` variant **directly** at `error=0.0000`. Both are eligible, both
score identically, so **array order decided** — and the mirrored variant won. Its motion took the
wave's end dancers from `y=±3` to `y=±7`.

The fix is in `matcher.ts`: least error still wins, but on an EQUAL error a variant matching
**without** reflection beats one that needs it. Reflection is real and stays available — `prd.md`
§9.5 matches "up to translation, rotation and reflection" — but it must be the fallback, never the
tie winner, because a mirrored match applies mirrored motion and the two variants are not
interchangeable. This is the same reasoning as the recorded decision that *"a mirrored candidate
must never decide an arrangement"*: a reflection must not decide a call either, when a direct
reading is available at the same error.

| | before | after |
|---|---|---|
| corpus: reached the finish and applied it | 66 | **75** |
| corpus: stopped only at the finish | 32 | **26** |
| corpus: stopped part-way through the body | 94 | **90** |
| promenade get-outs that resolve | 15 | **16** |

`selection.mjs` gates it: `Left Swing Thru` must match with `reflect=false`, must preserve the
set's span (a swing thru cannot change it), and must leave an Ocean Waves an Ocean Waves.

**Cause 2, CONFIRMED but not yet fixed: the wave `Circulate` paths.** This is the open item the
original handover flagged — *"the wave circulate paths may be wrong … needs an independent read
before changing both calls together"* — and the independent read is now done:

- The shipped wave tam is `Forward 4` / `Run Right` pairs, and `Forward 4` sends a dancer from
  `x=-2` to `x=+2`: **across to the other wave**, which is exactly what a *split* call must not do.
- `taminations-flutter/lib/sequencer/calls/ms/circulate.dart` — the reference's coded
  implementation — has **no ocean-wave branch at all**. Its own help text says *"You can just enter
  Circulate for All 8 Circulate, Column Circulate, Couples Circulate, and, for 4 dancers, Box
  Circulate"*: from a wave, bare `Circulate` is not a call the reference will compute, and
  `performCall` falls through to `throw CallError('Cannot figure out how to Circulate.')`.
- The consequence in our engine is that `Boys Circulate` / `Girls Circulate` are **compositional**
  (`getVariants` returns **0** for them; they resolve as group + `Circulate`) and therefore inherit
  the wrong whole-board paths. Measured on `[B1c] --SwThr G-Cir B-Trd --RLG`, `Girls Circulate`
  takes a correct Ocean Waves (`|y|=3/1`) and produces a `1/3/3/1` shape that is not a formation.

Fixing this needs the wave circulate motion written out per position — `Split Circulate` and
`Circulate` share those paths, so both must change together, which is why the item has waited.

### Still open from this family

`Box the Gnat` (7), `Scoot Back` (4), `Bend the Line`, `Rollaway`, `Ends Fold` (3 each) — the
"exists but will not match the board it was reached from" set, 25 distinct names; and the
`Roll` modifier (`&Roll`, 30 lines), "Explode and \<call\>" (`Expl&`, 5) and `Single Hinge` (11)
from Phase 2's decoder findings.

---

The plan's original list, kept with what happened to each item:

- `Box the Gnat` (7), `Scoot Back` (4), `Recycle` / `Rollaway` / `Bend the Line` / `Ends Fold`
  (3 each) — **exists, will not match the board it is reached from** (25 distinct names in this
  class). Still open; this is the "the call needs to match from more formations" work.
- `Cross Fold` (2) — indexed (`poc/src/assets/src/calls.xml:171`) with **no implementation**
  (`link="ms/fold"`); `1/2 Circulate` and `Join Hands` are absent from the catalogue entirely.
  Still open, and now enumerated rather than implied: the decoder's `KNOWN_CATALOGUE_GAPS` lists
  them, and `getout-conformance.mjs` fails if that list goes stale.
- `Right and Left Grand` (16) / `Allemande Left` (4) — **finish-only stops.** The plan's guess was
  that this is the *resolve's precondition* being too strict. **That guess was wrong**: the
  refusals are a symptom of a distorted BODY, diagnosed above, and one of the two causes is fixed.
  Worth recording as a near-miss — "the finish refuses" described where the failure *appeared*, not
  where it came from.
- Plus three items Phase 2 added to the list by making them *readable*: the `Roll` modifier
  (`&Roll`, 30 lines), "Explode and \<call\>" composition (`Expl&`, 5), and `Single Hinge` (11).
  None is a decoder problem any more.

---

## Phase 4d — DONE: `Roll`, and an inverted label nothing was reading

**The `Roll` modifier is implemented** — 30 published lines, the single largest token in the corpus.

### What `Roll` is, from the reference

`taminations-flutter/lib/sequencer/calls/plus/roll.dart` is 50 lines and completely explicit:

```dart
final roll = ctx.roll(d);
final move = {Rolling.LEFT: QuarterLeft, Rolling.RIGHT: QuarterRight, Rolling.NONE: Stand}[roll]!;
```

Its help text says why: *"The sequencer calculates Roll based on the turning motion at the end of
the previous call"*, and `performCall` refuses when it does not follow another call — without a
previous turn there is no direction to continue. So: **each dancer turns a quarter in the direction
they were already turning, and a dancer who was not turning does not move at all.**

### The bug found on the way: the label was inverted

`Roll` needs the remembered direction, and the engine already had it — `SeqDancer.lastTurnDir`,
written by the applicator and exposed as `Sequencer.lastTurnDirections`. Two things were wrong:

1. **The sign was backwards.** `moves.ts` documents its own `Move.turn` as *"net heading change in
   radians (+ = left / CCW)"*, and `FaceLeft` is `mv('Face Left', 0, 0, +PI/2)`. The recorder wrote
   `delta > 0 ? 'right' : 'left'` — exactly inverted. Nothing consumed the metadata, so no gate
   caught it; this is the first consumer, and it would have rolled every dancer the wrong way. The
   convention is now **asserted against the delta a caller can read off the board**, not trusted.
2. **The coded-pivot path recorded nothing at all.** `Face Left` and `U-Turn Back` go through
   `applyMoveToBoard`, not the catalog path, so after a pivot the metadata was unset and `Roll` had
   nothing to read. Recording now happens there too.

### The 180° case, which is not a corner case

A net 180° turn gives the same delta for left and right, so the direction cannot be read from it —
and that is exactly what `Partner Trade` does, while the corpus's "and Roll" lines are literally
`... --PtTrd --&Roll`. Falling back to "no direction" left `Roll` **refusing on 6 published lines**,
which the behaviour report showed as `6x Roll` in its stopping-call list.

The reference resolves it from the path's **halfway tangent** (`bezier.dart rolling()`: *"If it's 180
then use angle at halfway point"*). The engine can do the same, because it already computes a pose
at any time along a path: the heading change over the **first half** gives the sign. That is now
what happens, and `Roll` **no longer appears among the stopping calls at all**. A coded pivot is the
one case that genuinely has nothing to read — it carries a net `turn` and no path — so `U-Turn Back`
records no direction, and the audit asserts that distinction rather than the blanket claim it made
before.

### Measured

| | before | after |
|---|---|---|
| corpus: stopped at an undecodable token | 170 | **146** |
| corpus: stopped part-way through the body | 90 | 101 |
| corpus: `Roll` among the stopping calls | — | **0** (6 refusals after the first cut, 0 now) |
| table names admissible | 77 | **78** |
| behaviour-audit assertions | 137 | **143** |

`&Roll` now decodes because `Roll` is a *performable* derived call, and the membership gate added in
Phase 2 is what proves it: `all 78 table names are implemented or declared gaps`. Before this,
`Roll` was absent from the catalogue entirely — no `<tam>`, not even in the call index — so the
token could not be admitted without creating a phantom name.

Successes are unchanged at 75: the 24 newly-readable lines run further and then stop at genuine
engine gaps, which is the same effect Phase 2 had and the point of making them readable at all.

### Still open from this family

`Expl&` (5) — "Explode and \<call\>" needs **composition with the following token**, and
`Explode and Load the Boat` is not a title; and `Single Hinge` (11), where `Single Hinge` and
`Split Hinge` are both absent from the catalogue.

---

## Phase 4e — IN PROGRESS: authoring the variants the data does not have

**The largest remaining bucket is not missing calls — it is missing VARIANTS.** The report calls it
"ENGINE GAPS: the call exists but will not match the board it was reached from", 25–31 distinct
names. Diagnosing the top entry showed the label is right and the fix is not a matcher change:

```
Box the Gnat on the Eight Chain Thru board the corpus reaches it from
  from="Facing Couples" (ms, couples 3 apart)   best error 2.000   (tolerance 1.5)
  from="Facing Couples" (b2, couples 4 apart)   best error 4.000
  from="Right-Hand Wave"                        best error 5.248
```

`Box the Gnat` is a 4-dancer call, so on an 8-dancer board it goes down the **parallel-subset** path,
which partitions the board into two copies of the call's setup. Matching compares **distances**, so
the setup's couple separation has to be the board's. The two authored `Facing Couples` variants put
the couples **three** and **four** apart; every board the corpus reaches the call from — Eight Chain
Thru, Trade By — puts them **two** apart. So all of them miss, and the call was reported as an engine
gap it never was.

**FIXED, by authoring the missing variant** — the same move as step 4b. The leading was not
invented: the two existing authorings pin the travel-to-separation relation exactly,
`x2 = separation/2 + 1` (3 at separation 4, 2.5 at separation 3), so separation 2 gives `x2 = 2`.
The start formation is written **inline** at `x = -1` so the engine's own mirror (180° about the
origin) places the second couple at `+1`. Everything else is copied unchanged.

| | before | after |
|---|---|---|
| corpus: reached the finish and applied it | 75 | **78** |
| corpus: stopped part-way through the body | 101 | **97** |
| `Box the Gnat` among the stopping calls | 7 | **3** |

It applies through the **parallel-subset** path rather than the whole-board one, and leaves a valid
`Eight Chain Thru` with 8 distinct spots — verified before measuring.

**The remaining 3 are a NARROWER bug, and my first explanation of them was WRONG — Phase 4f pinned
it exactly.** I recorded that they are on `Trade By`, whose facing couples put the girl where Eight
Chain Thru puts the boy, and that the `gender-specific` gate was correctly rejecting the variant.
Measurement disproved it:

- the new variant matches a four-dancer subset of the `Trade By` board at **error 0.000 with the
  gender gate ON** (and 0.000 ungated), so neither spacing nor gender is the reason;
- `partition` does not consult gender at all — it calls `matchFormations` on
  `{x, y, heading}` with no `requireGender` (`applicator.ts:387-391`);
- and the couple-coherence check it *does* apply is inert here, because **both boards carry
  `couple = 0` for all eight dancers** (UNKNOWN_COUPLE), so `isKnownCouple` is false for every
  dancer and no constraint is imposed.

Replicating `partition` step for step locates it. On `Eight Chain Thru` the new variant partitions
cleanly — `[1,2,3,4] err=0.000 [5,6,7,8] err=0.000`. On `Trade By` the SAME variant fails, and the
best group containing dancer 1 is `[1,2,3,4]` at **err = 3.142** — π — at *any* tolerance.

π is the tell, and the geometry explains it. In a `Trade By` the couples at `x=±1` face **each
other** (a facing pair, separation 2) while those at `x=±3` face **away** from each other (also
separation 2). A `Box the Gnat` needs a *facing* couple, so the setup matches the inner pair and is
a pointwise face-reversal away from the outer pair — which no rotation or reflection can fix, hence
π. And `parallelApply` requires the setup to tile the **whole** board (`n % k === 0`, and every
dancer consumed), so one matching box is not enough.

**So the gap is structural, not an asset gap**: the engine can apply a call to *every* box in
parallel, and to a *selected subset* by dancer (`applySelected`), but there is no path for **a call
that is legal from some boxes and not others** — which is what `Box the Gnat` from a `Trade By` is.
That is a behaviour change with board-wide blast radius, so it is recorded rather than made on this
evidence, exactly as the collision refusal was in Phase 4b.

### Phase 4g — a second authoring, and it lands cleanly

`Right Pull By` is the same gap with an even cleaner scaling law. Its two authorings put the couples
**four** (b1) and **three** (ms) apart and scale the travel to match: `scaleX` is 2 at separation 4
and 1.5 at separation 3, i.e. **`scaleX = separation / 2`** — which is also what the motion *means*,
since each pair travels half the gap. So the missing variant is `scaleX = 1` at separation 2, with
the start formation written inline at `x = -1`. `Left Pull By` is authored alongside it for symmetry.

Measured: corpus success **78 → 79**, and **`Pull By` no longer appears among the stopping calls at
all**.

### Still open from this family

- **`Box the Gnat` from `Trade By`** (3 lines) — structural, not an asset gap: the call is legal
  from the inner facing pair only, and the engine has no "some boxes, not all" path. See Phase 4f.
- **`Scoot Back`** (4 lines, now the bucket's top entry) — best error **1.571** against 1.5, a
  whisker, so this needs its own diagnosis rather than an assumption about spacing.
- **`Bend the Line` / `Ends Fold`** (3 each) at error 3.142, and `Star Thru` (2) on a board with no
  recognised formation at all.
- **`Expl&`** (5) — "Explode and \<call\>" composition, and **`Single Hinge`** (11).
- **`Recycle` / `Slide Thru` / `Turn Thru`** (3 each) — not yet diagnosed.

---

## Phase 4h — CORRECTION: my `Run` facing rule was wrong in Phase 1b

**Phase 1b made `Run` exchange position AND facing for both dancers. The reference does not: only the
RUNNER turns.** Chasing the `Bend the Line` stops is what exposed it.

The evidence is in the reference's own move curves, and it is unambiguous:

- the runner's path is `RunLeft`/`RunRight`, which carry **no rotation curve**, so `brotate =
  btranslate` and the facing follows the path tangent — which at the endpoint points back the way
  the dancer came, i.e. **a 180° turn**;
- the dancer run around gets `DodgeLeft`/`DodgeRight`, which **do** carry a rotation curve ending
  forward, i.e. a pure sidestep with **no turn**.

So from a wave — where the runner and the dancer run around face opposite ways — a full exchange
reproduces the wave, while the reference's rule turns only the runner so the pair ends facing the
**same** way and the wave becomes a **two-faced line**. And All8's published get-out
`--SwThr B-Run --BendL` only works if that is so, because `Bend the Line` is legal from a two-faced
line and **not** from a wave. Those were exactly the lines stopping at `Bend the Line`.

**What went wrong in Phase 1b, and why the method still held.** I derived the rule from the *net*
displacement of the reference's `dist/2` scaling — which is right about positions — and then
reasoned that a full exchange is "what keeps a wave coherent", and pinned that in `selection.mjs`.
The pin is what made this findable: the corrected rule **failed my own gate**, which is precisely
what that gate was written to do ("implementing the derived call makes it go GREEN with a different
message... any change to the current behaviour has to be made deliberately rather than by editing a
number"). The gate now asserts the reference's behaviour, with the wrong reasoning recorded in it.

| | before | after |
|---|---|---|
| `Bend the Line` among the stopping calls | 3 | **2** |
| corpus: stopped only at the finish | 39 | 38 |
| corpus: stopped part-way through the body | 96 | 97 |
| promenade get-outs that resolve | 16 | 16 |

The corpus is otherwise flat — one line recovered — so this is a **correctness** correction rather
than a coverage win, and it is worth stating plainly: Phase 1b's committed `Run` was subtly wrong,
the error survived three phases, and it was found by following a downstream symptom rather than by
re-reading the code.

### What the same survey found about the rest

- **`Scoot Back` (4 lines) is NOT a tolerance problem, and its 1.571 "near-miss" must not be
  accepted.** The setup scoring 1.571 is `bE(-1,1) gS(-1,-1) bW(1,-1) gN(1,1)` — four dancers
  facing E, S, W, N — matched against an `Eight Chain Thru` box whose couples face each other.
  The residual is π/2 of wrong facing, so widening the tolerance would apply **wrong motion**.
  The data simply has no `Scoot Back` variant for facing couples (its variants are waves, boxes,
  columns and tags).
- **`Bend the Line`'s remaining 2** are the same shape: its variants are two-faced lines and tidal
  lines, and the boards it is reached from are waves — a `Bend the Line` from a wave is genuinely
  illegal, so those are upstream body problems, not matching gaps.
- **`Recycle` / `Slide Thru` / `Turn Thru` / `Boys Fold` / `Ends Fold`** (3 each) — not yet
  diagnosed; `Ends Fold` and `Boys Fold` are the `sequencer="no"` family from Phase 1.

---

## Phase 4i — DONE: "some boxes, not all", the structural gap behind several names

**`parallelApply` required the setup to tile the WHOLE board**, so a call whose setup matches some
boxes and not others was refused outright. Chasing `Turn Thru` found that three separate published
get-outs stop this way, and the fix is a strictly-additive second reading.

### The diagnosis, from the reusable survey

```
Turn Thru on the Double Pass Thru board it is reached from:
  Facing Couples, couples 2 apart   full-board subset 0.000   best TILING group 3.000
```

The setup **matches at 0.000**; what fails is the *tiling*. A `Double Pass Thru` — like a
`Trade By` — is couples facing each other in the middle and couples facing out on the ends, so the
inner pair matches and the outer pair cannot, and `partition` demands every dancer be consumed. The
same shape accounts for `Box the Gnat` from a `Trade By`, which is why those three lines survived
Phase 4f's structural diagnosis.

### The fix

`partitionPartial` — disjoint copies of the setup covering as much of the board as they can, with
the rest left where they stand — tried **only after** `partition` fails. That ordering makes it
**strictly additive**: a board that tiles today behaves exactly as before, and this can only turn a
refusal into an application.

`square-dancing.md` §7.5 is the reading — *"a call acts on everyone it applies to"*. §7.2.1 still
bounds it and is why the even-division guard stays: the board must divide **evenly** into
setup-sized boxes, so a 6-dancer board with a 4-dancer setup is still refused, exactly as before
(and `features.mjs` still asserts it).

### A second authoring, from a law pin that is now direct

`Slide Thru` and `Turn Thru` were the same spacing gap as `Box the Gnat` and `Pull By`: authored
`Facing Couples Compact` (couples 3 apart) while the boards use 2, measuring best errors of 2.000
against the 1.5 tolerance. This time the scaling law is **pinned directly rather than by analogy**:
`Star Thru` — which `Slide Thru`'s own taminator says it is, "just Star Thru with no hands" — is
authored at **both** spacings, `b1` with `Facing Couples` and `scaleX="2"`, `ms` with
`Facing Couples Compact` and `scaleX="1.5"`. So `scaleX = separation / 2`, and comparing the two
also pins what does *not* scale: `offsetX` stays **1** at both. Separation 2 therefore gives
`scaleX = 1`.

### Measured

| | before | after |
|---|---|---|
| corpus: reached the finish and applied it | 79 | **81** |
| corpus: stopped part-way through the body | 96 | **89** |
| `Turn Thru` among the stopping calls | 3 | **0** |
| `Box the Gnat` among the stopping calls | 3 | **0** |
| `Slide Thru` among the stopping calls | 3 | 2 |

`selection.mjs` gates the new reading on both concrete cases: `Box the Gnat` from a `Trade By` moves
exactly the one matching box (4 of 8) with no collision, and `Turn Thru` applies from a
`Double Pass Thru`.

### The scaling procedure, as it now stands (three confirmed instances)

1. A "will not match" call is usually a **near-miss in the match error**, not a missing call.
2. Two authorings at other spacings pin the law — `x2 = sep/2 + 1` for `Box the Gnat`,
   `scaleX = sep/2` for `Pull By`, `Star Thru` and (through it) `Slide Thru` / `Turn Thru`.
3. Write the formation **inline** at `x = -1` and let the engine's mirror place the second couple.
4. Then check whether the *tiling* or the *matching* was the real blocker — they are different
   failures and `bestGroup` vs `fullBoard` tells them apart.

---

## Phase 4j — DONE: All8's own notation key, and the biggest decoder jump of the workstream

**The key this file had been saying it could not get is available**, and using it moved **64 lines**
out of "our decoder gap" and **6** more to full success.

### The correction

`getout-decode.mjs` said the table is *"ours, not All8's"* because *"All8's own notation reference
(help.cgi) returns HTTP 500"*. The CGI does, but Rich Reel's notation page survives on the Internet
Archive and is the missing key:

> **Call Name and Designator Abbreviations** (14 Oct 2012) —
> <https://web.archive.org/web/20160701101228/http://www.all8.com/sd/calling/abbrlist.htm>

It carries the **call-name table, the designator list and the punctuation legend**, which between
them settle three things this file had been inferring or refusing:

1. **The expansions themselves.** 31 tokens whose calls this engine implements were added straight
   from All8's own list — every entry copied verbatim rather than read off the published lines. The
   membership gate still checked each one against `implementedTitles()`.
2. **Two tokens the file had refused as too ambiguous.** `LA` is All8's *"Left Alamande (Alamande
   Left)"* — **not** "Ladies Chain", which the membership rule alone would have accepted because
   `Ladies Chain` is implemented and `Left Allemande` is not. And `SHing` is `"Single Hinge"`.
3. **The punctuation and designators.** `,` is "while", `;` is "then", `!` marks a difficult line,
   and `-` after a call is an **"and"/"same ones" tie-in** where *"the active dancers keep working"*
   — which is the authority for the tokenizer's joiner-dash handling rather than our inference. The
   designator list also documents the one genuine ambiguity: **`H-` is "Heads or Sides (when
   H=Sides, S=Heads)"**, so `GROUP`'s `H: 'Heads'` is the default reading and the flip is a caller
   convention we cannot resolve from the text.

### The other half of the work: DECLARE the engine's gaps instead of hiding them

With the key in hand the honest move for a token whose call the engine simply lacks is to **decode
it and declare the gap**. `KNOWN_CATALOGUE_GAPS` now carries 13 more names — `Single Hinge` (11
lines, the largest single item left), `Right-hand Star`, `Sweep 1/4`, `1/2 Tag`, `Eight Chain 1`–`5`,
`Ladies In And The Men Sashay`, `Cross Run`, `See Saw`, `Left Hand Hinge` — each with All8's reading
as the authority. That moves those lines out of *"our gap in reading All8"*, where they were being
reported as a shorthand failure of ours, and into a correct **engine**-gap attribution.

`Twice` was also removed from the harness's PROSE filter: All8 defines it as a call modifier
(*"repeat the previous call again"*), so counting it as page text was wrong.

### Measured

| | before | after |
|---|---|---|
| get-out lines decoded (of 265) | 160 (60%) | **195 (74%)** |
| lines stopped at an unread token | 104 | **69** |
| corpus: reached the finish and applied it | 81 | **87** |
| corpus: stopped at an undecodable token | 146 | **82** |
| corpus: stopped part-way through the body | 89 | 142 |
| table names admissible | 78 | **120** |

The mid-body rise is the point again: **64 lines became readable** and then stopped at genuine
engine gaps, which is exactly what the decoder exists to expose. The remaining undecoded 52 tokens
are now mostly *modifiers needing composition* (`Twice` 5, `1-1/2`, `1/2of`, `Expl&`), designators
we do not model (`O-`, and the `H`/`S` flip), direction-specified runs the engine lacks
(`G-RunL`, `B-RunR`), and genuine page text (`"Dave Wilson"`, `"for beginners say"`).

### Still open

- **`Roll` is a modifier too.** All8's `&Roll` is *"(Anything) and Roll"* and `Roll` is *"{designated}
  Roll (use &Roll if everyone can Roll)"* — so the derived `Roll` currently applied to whoever has a
  remembered direction is a reading of the second form. Recorded, not reworked.
- **Composition for `Expl&`, `Twice`, `1-1/2`, `1/2of-`** — each takes the preceding or following
  call as an argument, and `Explode And (anything)` is the template for all four.

---

## Phase 5 — Latent correctness

Each needs its own measured step, ordered by blast radius:

1. **`analyzeFasr`'s `corner` returns the opposite girl** — 0/4 agreement with the home ring, with
   the mechanism identified (a fixed +45° angular offset lands on the girl on his right, then falls
   through to the opposite girl once the partner is excluded). It feeds `fasrKey` → `isZero` → the
   solver's `Static Square` check.
2. **The isolated selection reading can be unsound** — `Centers Pass Thru` from Facing Lines
   resolves 2 dancers (one an end) instead of the 4 centres. Fix by resolving the group **first**
   and constraining the match, not by centring.
3. **The wave `Circulate` paths may be wrong** — half the dancers move 4 units *between* the
   parallel waves. Needs an independent read **before** changing `Split Circulate` and `Circulate`
   together.
4. **`Circulate` from facing lines** — the shipped line variants are `Lines Facing In` / `Out`, not
   `Normal Lines`.
5. **`boardSig` ignores facing** (confirmed: `board.ts:26` copies `heading`; line 29 never reads
   it). Positions-only is *load-bearing* — it is why pivots prune cleanly. Review, do not casually
   "fix".
6. **The `[B]` box promenade disagreement** (3 lines) — pinned by `getout-convention.mjs` §3b. Keep
   it pinned.
7. **`Promenade`'s fixed 8 beats** and the fact that **geometry-derived calls are not FSM edges** —
   both recorded, with a worked-out shape in `features/resolve_calls.feature`.

---

## Phase 6 — The All8 → engine name bridge

`CALL_SYNONYMS` is **empty** (`constants.ts:85`) — verified. The bridge is 3 entries living in a
*test harness* (`engine/test/lib/engine-calls.mjs:112-116`), so only tests resolve `Touch 1/4`,
`Cast Off 3/4`, `Do Sa Do`. Anyone consuming published choreography needs it in the engine, where
`canonicalName()` already applies it. Small, independent, and it reduces how much of Phase 2's
accounting is harness-side.

---

## Phase 7 — Legacy phases, docs and harness gaps

- **Phase 3 (amendment policy):** `FsmStore.amend` (`fsm-store.ts:49`) requires a getout; the claim
  that step 5 reduced rejections is **unmeasured**. Measure it, then decide: an advisory gate
  recording `getoutVerified`, or unamendable. No UI wires this yet.
- **Phase 4:** audit checks for the bounded non-geometric matching exceptions (§8.2); the editor's
  "no match within tolerance" wording; an explicit runtime-join check.
- **Phase 5:** `knownFormation` is the last loose-tolerance (6.0) outlier.
- **Feature specs are the biggest documentation gap.** Nothing covers the All8 alignment/corpus
  work steps 1–3 (`boardFromDiagram`, `arrangementFor`, `sequenceFor`, `relationshipStateOf`),
  nothing covers the solver/getout search, nothing covers the call editor.
  `features/resolve_calls.feature` is the model — `@bind:`-tagged, with the engine behaviour in
  comments, so `bind-audit` catches rot. Add one per phase as that phase lands.
- **`transitionTable` / `map-tips.mjs`:** keep `poc-matrix/` out of `verify`; run `map-tips.mjs`
  whenever the FSM is touched.

---

## Recommended order

Phases 0 → 1 → 2 → 3 match `HANDOVER.md` §7's ranking, with one change of emphasis: **Phase 1
starts by honouring the `sequencer` attribute**, because that is the measured cause and the
cheapest high-yield change in the repo — a flag `convert.ts` already parses past, on 271 variants
concentrated in exactly the families the corpus is stuck on.

Phase 1 is the riskiest (it changes what every search node sees), which is why it wants two commits
and the Phase 0 baseline behind it. Phases 2 and 6 are mechanical and independent; Phase 3 is
independent of both.
