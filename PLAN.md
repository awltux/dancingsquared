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
intervening girls, which is the reference's `inBetween` case) and leaves an Ocean Waves; `Boys Run`
keeps the wave an Ocean Waves, swaps the layout `BB/GG/GG/BB → GG/BB/BB/GG`, and leaves every
dancer on a distinct spot.

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

## Phase 3 — The search index

**Goal:** `getout()` stops being fast on success and slow on failure.

**Mechanism.** `searchCandidates` (`solver.ts:116-139`) calls `searchLegalCalls`
(`legality.ts:49-79`, C = 2211 titles) once, then for **every distinct end board** calls
`equivalentCalls` (`solver.ts:102`), which loops the catalogue **again**. With L = 24–286 distinct
end boards that is L × C ≈ 53 000–634 000 applies per node — **~99% of the node bill**, and
quadratic because L is a large fraction of C. `budget` is not the driver; the size of the reachable
state space is (a synthetic scattered board exhausts `seen` in 0.07 s at the same budget).

### Steps

1. **Instrument first**: log `|bySig|` (L), `|callNames()|` (C) and node count per node. Timing
   alone cannot distinguish halving L from removing the C factor.
2. **Index calls by start formation.** The minimal change point is `library.allVariantSetups()`
   (`library.ts:189-197`), already the flat list of variant setups and **deliberately lossy — it
   drops the back-pointer to the call name**. Make it `{ name, setup }[]` and the index exists.
   Query it with the formation key that already exists (`knownFormation` / `recognize`, memoised
   per pose at `matcher.ts:152-154`).
3. **Do not build it as an FSM table.** `FsmTable` is already a `state → calls` adjacency and the
   right *query* shape, but building it is itself O(states × catalogue) (`sequencer.ts:491` calls
   `legalCalls` per state; `addState` linear-scans with `matchFormations`) — that is what killed
   the 20-minute `transitionTable` build. Index lazily, from the variant list.
4. **Add the regression point the harness deliberately lacks.** `getout-convention.mjs` contains no
   large-reachable-state invocation (its own comment at `:132-135` says so). Add the `[P4p]` shape
   behind an **env flag**, not in `npm run verify` — it costs ~2 min today.
5. Re-measure the `transitionTable` build; the doc claim about it is unverified on this checkout.

**Done when:** `[P4p]` failing getout is bounded in seconds with the same `null` answer, and
`fixIt depth=1` is usable.

---

## Phase 4 — Remaining call gaps and the refused finishes

By corpus count, after Phase 1 has removed the variants that should not apply, so the ranking is
honest:

- `Box the Gnat` (7), `Scoot Back` / `Recycle` / `Rollaway` / `Boys Fold` / `Ends Fold` (3 each) —
  **exists, will not match the board it is reached from** (29 distinct names in this class).
  `Boys Fold` / `Girls Fold` are 2/2 `sequencer="no"`, so Phase 1 reclassifies them: revisit
  before authoring.
- `Cross Fold` (2) — indexed (`poc/src/assets/src/calls.xml:171`) with **no implementation**
  (`link="ms/fold"`); `1/2 Circulate` and `Join Hands` are absent from the catalogue entirely.
- `Right and Left Grand` (16) / `Allemande Left` (4) — **finish-only stops**: legal-looking states
  the finish refuses. Per `prd.md` §9.5.4 this is the resolve's precondition, and the answer is a
  measured floor (like the ±1 couple band), never a looser rule that launders a broken body into a
  false success.

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
