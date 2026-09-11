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
`getout()`; 5b the `Centers`/`Ends` grouping fix; 5c `Circulate` from a wave; the All8 notation
second pass and `Twice`; **and All8 sequence import/export (§2.1)**.

**The corpus scoreboard** (`engine/test/getout-behaviour.mjs`, 412 published lines — refresh it
with `node engine/test/getout-behaviour.mjs` from the repo root):

```
117  28%  reached the finish and applied it        - SUCCESS by the caller convention
  6   1%  reached a state a finish resolves from   - SUCCESS
  0       completed the body but did not resolve
 54  13%  stopped only at the finish              - body ran, the resolve call refused
146  35%  stopped part-way through the body       - the real coverage gap
 45  11%  stopped at a token we cannot decode     - OUR gap in reading All8
 44  11%  page text, not a get-out line
```

Decoder coverage of the 265 published get-out lines: **228 (86%)**, 36 stopped at an unread token,
134 admissible table names. (Was 53/4/0/29/71/202/53 and 134 decoded at the start of this
workstream.) What remains is a long tail: 32 distinct tokens, the largest only **2 occurrences**.

**Five of those gap declarations were WRONG, and removing them was worth 7 get-outs.**
`Eight Chain 1` .. `Eight Chain 5` were declared catalogue gaps, but the catalogue DOES implement
them — it titles them with the number **spelled out** (`Eight Chain One` .. `Eight Chain Seven`, the
Plus programme's own naming), while All8 abbreviates them `8Chn1` .. `8Chn7`. The bridge is a
digit-to-text conversion in `CALL_SYNONYMS`, written out per family rather than applied to every
name, because a blanket rule would rename real titles out of existence (`Square Thru 4` and
`Square Thru 2 1/2` are catalogue titles *with* digits). This is precisely the misattribution the gap
list exists to expose, and the gate's stale-gap check is what caught it.

**The All8 codec is now reachable from the POC.** The sequencer panel has an **All8** row — a text
box plus Import/Export — so a figure from an all8.com page can be pasted in and danced, and the
current sequence can be rendered back into All8 notation. An `[FASR]` setup code is reported but not
applied, because the engine still has no FASR-code → board derivation (PLAN.md Phase 7).

### 2.1 All8 sequence import/export

New: choreography can be **imported from and exported to All8's own published call format**, the
notation Rich Reel uses for the singing-call figures and get-out pages.

- `engine/src/sequencer/all8-format.ts` — the codec. `parseAll8Figures` (plain text with call
  sharing), `parseAll8CellRows` (real table cells), `formatAll8Figures` / `formatAll8Call`.
- `engine/src/sequencer/all8-notation.ts` — the abbreviation table, tokenizer and line decoder.
  **These MOVED out of `engine/test/lib/` into the engine**, because a production codec cannot reach
  into `test/` and a second copy of a 130-entry table is how two readers drift. The old
  `engine/test/lib/getout-decode.mjs` is now a re-export shim, so every harness is unchanged.
- `engine/test/all8-format.mjs` — the gate (part of `npm run verify`).
- `engine/test/fixtures/all8-figures.json` — verbatim from Rich Reel's pages, attributed.
  Regenerate with `node engine/test/tools/fetch-all8-figures.mjs`.

**The hard part is call sharing**, and it is gated against All8's own arithmetic rather than our
reading of it: `abbrev.htm` publishes a sharing example *and prints the expected figure in full*,
so if "an empty leading cell is inherited from the line above" is read wrong, the import cannot
match the printed figure. Measured: all 188 published mainstream figures import, 169 of them via
sharing, and 183 of 183 complete figures end at a resolve (the other 5 carry quoted delivery text
and are breaks/codas).

**Reading the figure corpus found two things the get-out corpus could not:**
- `S-` = **Sides** does occur (`S-SqTh4`, `S-RLT`, …). An earlier note had recorded "no `S-` token
  occurs" and omitted the prefix on that basis — true of the get-outs, false of the figures. Note it
  had to be added to the tokenizer's **regex** as well as the designator table; adding it to the
  table alone does nothing.
- `Sw&Pr` = "Swing and Promenade" is the **most common token on the figure pages** (170 of them,
  more than every other unread token combined) and was absent from the table entirely, because
  get-outs almost always end at `--RLG`/`--AL`/`--Prom`.


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

**Corrected by measurement (`PLAN.md` §2 and Phase 1).** The `sequencer` attribute is real and the
engine ignores three of its four values (`engine/src/convert.ts` read only `'gender-specific'`;
Taminations defines `perimeter`/`exact`/`gender-specific`/`no` — `animated_call.dart:157-168` — and
its sequencer skips `no` outright, `xml_call.dart:57-59`). **But filtering those variants out is
NOT the fix, and this was measured both ways**: strict skip takes the published promenade get-outs
that resolve from 12 of 30 to **8** (`promenade.mjs` §5 fails) and corpus success 53 → 52, and
"prefer eligible" gives **11**. The engine now PARSES the flag faithfully
(`sequencerMode`/`forSequencer`) and gates it, but matching is deliberately left unfiltered.

The real mechanism, probed on the engine's own `Ocean Waves` template: every eligible
`Boys Trade` wave variant is authored for boys in the **CENTRE**, while the template is **`BggB`**
— boys at the **ENDS**, which is correct (arrangement 0). So the gender gate correctly rejects all
of them, no eligible variant matches, and the **ungated `sequencer="no"` demo wins the tie by array
order**, applying boys-in-centre motion to a boys-at-ends board. That is the recorded symptom, and
it is why the demos are an *ungated fallback* rather than a bug to delete. On `Normal Lines` and
`Two-Faced Lines` an eligible variant matches and wins, which is why the call is right from lines
and wrong from two parallel waves.

**The fix is a derived call, and it is DONE.** The reference implements `Trade` and `Run` in CODE
(`taminations-flutter/lib/sequencer/calls/ms/trade.dart`, `run.dart`) — which is why their `<tam>`s
are not-for-sequencer. Both are now derived in `engine/src/sequencer/trade-run.ts` and registered in
`coded-moves.ts`, and the rule is a **SWAP of positions** — with a facing subtlety Phase 1b got wrong
and **Phase 4h corrected**: only the **RUNNER** turns 180°, and the dancer run around keeps its own
facing, so a `Run` from a wave produces a **two-faced line**. The reference's move curves settle it
(`RunLeft`/`RunRight` carry no rotation curve, so the facing follows the path tangent and reverses;
`DodgeLeft`/`DodgeRight` do carry one and end forward), and All8's `--SwThr B-Run --BendL` confirms
it, because `Bend the Line` is legal from a two-faced line and not from a wave. `Trade` remains a
full exchange: both traders end facing the way the other did. `trade.dart` is the specification for
the pairing: trade
with the nearest dancer in the direction holding an **odd** number of them, running **around**
intervening dancers and passing right shoulders (so a trade ACROSS intervening dancers is legal —
what `Boys Trade` from a `BggB` wave is). `run.dart` is the same shape: run around the side that has
walkers, preferring the **partner** when both sides are open.

MEASURED: promenade get-outs that resolve **12 → 15** of 30, broken-body refusals **6 → 3**, corpus
success **53 → 59**, and `Boys Run` — previously the top entry in `ENGINE GAPS` — is gone from that
list. `selection.mjs` asserts the behaviour.

**What is left from this family:** `Cross Run`, `Fold` / `Boys Fold` / `Girls Fold`,
`Centers Cast Off Three Quarters`, `Turn Back` and the group-scoped `Heads/Sides Square Thru N` are
in the same position — 32 titles whose only authored setups are demonstrations — and each needs
either a derived rule or an honest refusal. See `PLAN.md` Phase 4.




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
Recorded rather than reconciled — **Phase 2 settled it by reporting BOTH**, and the decoder table
is now DONE:

- The tokenizer had **four** bugs, not the two predicted, all found by measurement: a **trailing
  joiner dash** was never stripped (24 occurrences, 18 distinct tokens, several of them tokens the
  table already knew); `{...}` braced asides were not removed; `[...]` alignment markers were not
  removed; and a gap that had collapsed to a single space before a `--` call marker was not split.
- `getout-conformance.mjs:166`'s `check(true, …)` is now a real gate — **implemented OR declared in
  `KNOWN_CATALOGUE_GAPS`** — so a mis-expansion fails loudly instead of being reported as an engine
  deficiency, and a declared gap that later gets implemented also fails, so the count cannot go
  stale. All 77 table names are admissible.
- Every addition was checked against `implementedTitles()` first. That caught `Sweep` → "Sweep a
  Quarter" (indexed, **no `<tam>` anywhere**), `SHing` → "Single Hinge" (not implemented),
  `&Roll` → `Roll` (not a call at all; it is a MODIFIER), and confirmed `H` = Heads from the
  fixture's own `{beau couple: H/S}`.

MEASURED: get-out lines decoded **134 → 160** of 265, stopped at an unread token **130 → 104**,
whole-set names registered **46/48 → 54/56**, corpus success **59 → 66**, undecodable stops
**202 → 170**. Mid-body stops rose 68 → 94 — which is the phase working, not a regression: those
lines are now readable, and they are genuine engine gaps instead of hiding behind an unread token.

**`Twice` is a rule, not vocabulary (82% now).** All8's key defines it as *"repeat the previous call
again"*, so it cannot live in the token table — it is resolved in `decodeLine` against what has
already been read, and that made `decodeLine` the single authority for reading a line (`decodeStats`
and the conformance gate now call it rather than looping over `decodeToken`). `SpltC Twice RLG` is
three calls, not two, and one line contains two `Twice`s. This also reclassified **6 lines out of
"page text"**: a line the decoder could not read had been counted as prose rather than as a get-out
it could not parse.

**A third pass (from All8's pages) took it to 228 of 265 (86%)**, corpus success **87 → 110**,
undecodable stops **82 → 45**, admissible table names **120 → 132**. It added two new token *shapes*
as well as vocabulary: `RolPr`/`Tag_I` are compounds ("Roll then Promenade"), and `ToWav` is a
**suffix modifier that rewrites the preceding call** ("DoSaD ToWav" is ONE call, "Do Sa Do to a
Wave" — which needed a `CALL_SYNONYMS` entry, because the catalogue spells the title `Dosado`).

**A second pass over the same key (Phase 5b) took it to 218 of 265 (82%)**, corpus success
**87 → 108**, undecodable stops **82 → 56**, admissible table names **120 → 126**. Seven base tokens
the key gives and the table lacked (`Hing`, `Roll`, `DoPas`, `SqTh1`, `Cir2`, `RunL`, `RunR` —
four of them DECLARED engine gaps, since the calls really are missing), plus `TagI`, which All8
publishes as the compound "Tag The Line - Face In" and which `MULTI_TOKENS` now expands to two calls
because both halves are implemented.

**`C` was not a vocabulary gap but a tokenizer one.** All8's key gives it two readings separated by
the dash alone — `C` alone = Circulate, `C-` = the "Centers -" **designator**. The corpus's bare `C`
tokens are neither: they are designators stranded when a quoted aside between designator and call was
dropped (`C-"reverse"-WhlAr`). `tokenize` now reattaches a dangling designator **before** the strip
that erases the dash, so four previously unreadable lines now read as `Centers Wheel Around` /
`Centers Promenade` / `Centers California Twirl`. Adding `C` to the table first would have decoded
them as `Circulate` — the merge has to happen while the dash is still visible.

**What is left of the decoder gap is not notation.** The four largest remaining tokens were
`&Roll` (30) — the **Roll modifier**, `SHing` (11) — `Single Hinge` not being implemented,
`LA` (9) — ambiguous on purpose, and `Expl&` (5) — "Explode and \<call\>" composition. The table
records each with its reason so nobody re-adds them as vocabulary.

**`&Roll` IS DONE (Phase 4d).** `Roll` was absent from the catalogue entirely — no `<tam>`, not even
in the call index — and is now a **geometry-derived call** (`coded-moves.ts`): each dancer turns a
quarter in the direction they were already turning, which is the reference's rule verbatim
(`calls/plus/roll.dart`, 50 lines). Implemented it turned up a latent bug worth knowing about:
`SeqDancer.lastTurnDir` was **labelled backwards** (`moves.ts` documents `turn` as "+ = left / CCW",
the recorder wrote `delta > 0 ? 'right' : 'left'`), and the coded-pivot path recorded **nothing at
all**. Nothing consumed the metadata, so no gate caught either; `Roll` is its first consumer.
Measured: corpus lines stopped at an undecodable token **170 → 146**, `Roll` **no longer appears
among the stopping calls**, and behaviour-audit grew 137 → 143 assertions. The 180° case is handled
the way the reference handles it — from the path's halfway pose — because that is what `Partner
Trade` does and the corpus's "and Roll" lines are literally `--PtTrd --&Roll`.


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

**FIXED — Phase 3 removed the quadratic term and found a defect doing it.** `searchCandidates`
called `equivalentCalls`, which re-scanned the whole catalogue **once per distinct end board**
(the L × C term, 53 000–634 000 applies per node). A call's equivalents are exactly the other calls
**legal from this board** reaching the same end formation — which `searchLegalCalls` has already
computed — so the term now **disappears** rather than shrinking. `SearchStats` (exported; enable
with `setCollectStats(true)`) reports both terms, because timing alone cannot tell them apart.

Measured same-machine, old source vs new:

```
                                       before     after
[P4p] getout budget=400 (FAILS)        95.0 s     11.5 s
[P4p] getout budget=100 (FAILS)        32.5 s      3.9 s
getout on L1p (succeeds)                4.16 s     1.87 s
fixIt depth=1 on L.F1p                 33.0 s      3.6 s
```

Counters confirm the mechanism, not just the speed: `eqScans=0, eqIters=0` everywhere.

Two secondary findings. `fixIt` returned **duplicate** calls (`Promenade` eleven times) — the
equivalents loop pushed an identical `(name, end board)` pair once per visit; the list is now
deduped on that pair. And `fixIt` from home now offers **18** calls rather than 578, because the old
list came from `applySearch` at the loose tolerance with no tight prefilter, so it included
force-fits that `searchLegalCalls` prunes by design. Verified: **0** entries of the new list fall
outside the tight legal list.

`getout-convention.mjs` §5b now sweeps **every** alignment behind `GETOUT_SWEEP=1` — the
workstream's headline claim, "27 of the 28 alignments that have a start board", previously asserted
nowhere — and pins the failing-search cost under 40 s. It reports **27 of 28**, with `[P4p]` at
11.5 s.

**What is left:** the counters now show the C term is the whole remaining cost (17 catalogue scans
for 447 nodes), which is the start-formation index Phase 3 did not need but Phase 4+ will.



### 4.5 Latent correctness items

- **`analyzeFasr`'s `corner` returns the opposite girl** (0/4 agreement with the home ring).
  `FasrRelations.corner` feeds `fasrKey`, which backs `isZero` and the solver's `Static Square`
  check, so this needs its own measured step.

  **FIXED (Phase 5).** Measured on the home square, all eight dancers: the opposite-gender dancer
  geometrically on a dancer's **left** is always the one at ring offset **+3**, for boys and girls
  alike. The old fixed bearing (+45° for a boy, −45° for a girl) landed on the **right-hand girl**
  for all four boys and happened to be right for all four girls — half the dancers agreed, which is
  how it survived. The corner is now derived from the **declared home couple**
  (`((couple - 1 + 3) % 4) + 1`), the same ring offset `alignment.ts`'s `relationshipCode` uses, and
  a dancer with no known couple reports **no** corner. Gated for both genders in `alignment.mjs`
  (8/8 agree; a board with no known couples reports none). **The corpus is unchanged** — `fasrKey`
  is compared against `homeFasrKey()` and both come from the same function, so a systematic error
  cancels there; only the Callerlab cross-check, previously a *finding* line rather than a gate,
  was catching it.
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

  **CONFIRMED — Phase 4 did the independent read, and it came back with more than expected.** The
  read is `taminations-flutter/lib/sequencer/calls/ms/circulate.dart`, the reference's CODED
  implementation, and it has **no ocean-wave branch at all**: its own help text says *"You can just
  enter Circulate for All 8 Circulate, Column Circulate, Couples Circulate, and, for 4 dancers,
  Box Circulate"*, and for 8 dancers in a wave `performCall` falls through to
  `throw CallError('Cannot figure out how to Circulate.')`. So from a wave, bare `Circulate` is not
  something the reference will compute — it is **our reading**, not an authored counterpart.

  What is now measured rather than suspected:

  - **The tams ARE applied as authored**, which refutes the obvious alternative explanation.
    `Ocean Waves RH BGGB` is a **four**-dancer formation (the left wave), so a tam's four paths bind
    **1:1** — not 2:1 against an eight-dancer formation — and the engine mirrors the half set.
    Reproducing the per-dancer displacement confirms it, so the tams are not mis-declared.
  - **The crossing is real**: `Split Circulate` moves **4 of the 8** dancers 4 units across to the
    other wave (`i1`, `i3`, `i5`, `i7`). That is **correct for `All 8 Circulate`** — the two waves
    are one loop — and **wrong for a split reading**, where each half must stay put. A fix must
    therefore change `Split Circulate` without breaking `All 8 Circulate`.
  - **`Circulate` from a wave is byte-identical to `Split Circulate`** in the assets, so it inherits
    the crossing. Step 4b's argument that the two "coincide from parallel waves" is true of the
    assets, but it rests on the split motion being right — which it is not.
  - **The group-scoped reading then collides**: `Girls Circulate` and `Boys Circulate` leave **6
    distinct spots for 8 dancers** (`1&2@-2.00,3.00`), because the reading keeps the non-selected
    dancers where they stand while the movers take poses from whole-formation motion. That is what
    turns a correct Ocean Waves into the `1/3/3/1` shape seen on `[B1c]`.

  Both are **pinned in `selection.mjs`** so a fix has to flip an assertion rather than quietly
  change a number. A collision refusal in the applicator was tried and **reverted**: measured a wash
  (corpus successes unchanged at 75) with a wider blast radius than it looked — `ENGINE GAPS` went
  from 25 to 31 names, including calls like `Star Thru` that *every* group-scoped call routes
  through, so the extra names cannot be told apart from refusals the check introduced itself. Trading
  a corrupt board for phantom gap attributions is the trade the decoder phase spent a commit
  undoing. The real fix is the tam motion, and it is still open.

- **`Circulate` from facing lines** (`Normal Lines` had no matching variant; the shipped line
  variants are `Lines Facing In`/`Out` — the same gap the wave templates had).

  **FIXED (Phase 5d).** A `Lines Facing In` / `Normal Lines` variant was authored, and the motion is
  not a guess: the reference **dispatches bare `Circulate` by formation**
  (`taminations-flutter/lib/sequencer/calls/ms/circulate.dart` — `isTwoFacedLines()` → Couples
  Circulate, `isLines()` → All 8 Circulate), so from lines `Circulate` **is** `All 8 Circulate` and
  the new tam reuses that call's paths verbatim. `selection.mjs` now asserts the reference's rule —
  the two calls must produce the **same board**, not merely both be legal. Measured: mid-body stops
  134 → 133.
- **`Promenade`'s 8 beats are a fixed approximation** of a distance-dependent motion.
- **Geometry-derived calls are still not FSM edges.** The precomputed table and
  `Sequencer.legalCalls` enumerate the catalogue, so `Promenade` appears in `legalNext()` (when it
  applies) and is now a search edge, but not in the table; the table builder would need a rule for
  a call legal from a *precondition* rather than from a setup.

### 4.6 The All8 → engine name bridge

**DONE (Phase 6).** `CALL_SYNONYMS` in `engine/src/sequencer/constants.ts` used to be **empty**, so
`Touch 1/4` → `Touch a Quarter`, `Cast Off 3/4` → `Cast Off Three Quarters` and `Do Sa Do` →
`Dosado` resolved only because a *test harness* mapped them. The bridge now lives in the engine,
where `canonicalName()` already applied it, and `engine/test/lib/engine-calls.mjs` re-exports it —
so there is one definition and any consumer of published choreography gets it.

It immediately unblocked the largest remaining named gap, and the evidence came from All8's own
notation key rather than from guessing: All8 lists `Hinge  {designated} Hinge  (prefer SHing if
designating all)` and `SHing  Single Hinge`, i.e. **"Single Hinge" is how All8 spells the call the
catalogue titles `Hinge`** — there is no `Single Hinge` title anywhere in the assets, which is why
it looked like a catalogue gap. Bridging it cleared **9** stopping lines, `Left Hand Hinge` **3**
more, and corpus success went **87 → 88**.

The stale-gap check from Phase 2 fired on each in turn ("declared as a catalogue gap but the engine
DOES implement it now"), forcing both out of `KNOWN_CATALOGUE_GAPS` — exactly what it is for.

**Still open:** only the names the corpus needed are mapped. All8's key carries many more aliases
and the same treatment applies.

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
