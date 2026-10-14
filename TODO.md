# TODO — the work queue

**What this file is.** The open problems, in the order they are worth doing, as a checklist. It is the front
door to the work: **`PLAN.md` owns the EVIDENCE** (§2 the scoreboard, §4 the detail, §5 blocked, §6 the long
form of this order), and this file owns the ORDER and the STATUS. If a claim here and a claim in `PLAN.md`
disagree, `PLAN.md` is right and this file is stale.

**Why it exists.** `PLAN.md` §6 already recommends an order, but it is a thousand lines of prose at the
bottom of a 478 KB file and it carries the DONE and REFUTED history inline, so it cannot be worked through
item by item. This is the same content as a queue.

**How to use it.** Tick `[x]` and add the commit sha when an item lands. An item is DONE when the command
in it says so — not when the code looks right. When you tick one, put the measurement in `PLAN.md` §2 or in
the harness that pins it, because commit messages are immutable and this file is a view.

**Provenance marks — read these before trusting a line.**

- `[measured]` — the command was run in this working tree and the output is quoted verbatim.
- `[recorded]` — quoted from `PLAN.md`, `square-dancing.md` §9, `engine/test/fixtures/README.md` or
  `poc/tools/guard-exclusions-broken.md`, and **NOT re-measured**. Re-measure before acting: the two
  `HANDOVER.md` files were deleted for doing exactly this and being believed anyway.

Last swept: **2026-10-14**, from `15d17ea`. The tree moved to `a5668a2` MID-SWEEP — a POC-only commit by
the owner (A/F step the selected move slot), so every engine measurement here still stands, and the probe
suite's count went 59 → 60 because it added `poc/tools/move-nav-probe.mjs`.

**The commands this file leans on**, all from the repo root:

| what | command |
|---|---|
| the whole engine gate | `npm run verify --prefix engine` |
| the fast subset | `npm run verify:light --prefix engine` |
| one engine harness | `node engine/test/<name>.mjs` |
| the POC gate | `node poc/verify.cjs` |
| every POC probe | `node poc/tools/verify-probes.mjs` |
| the book gate | `npm run check:book` |

---

## P0 — silently wrong, or a gate that cannot run

- [x] **1. DONE `15d17ea` — the Allemande Left selector that aborted `poc/verify.cjs`.** `[measured]`
  The Allemande Left loop's selector was `{ title: 'Allemande Left', from }`, and
  `poc/src/assets/ms/allemande.xml`
  has **two** such tams (lines 183 and 441), so `selectTam` refused, the script threw, and the gate stopped
  there with everything after it unmeasured. **ROOT CAUSE, unattributed before this: `50d3e95`** ("corpus:
  retire b1/b2 into ms 2026") — `50d3e95^` has ONE `Left-Hand Waves` tam, HEAD has two. The gate now
  resolves EVERY authoring (`buildCallVariants` + filter on the bundle's own `title`/`from`) and treats an
  empty list as a FAILURE. MEASURED AFTER: **43 ok / 2 FAIL**, reaching its own summary — the throw had been
  hiding nothing (both `Left-Hand Waves` authorings pass with maxDeg=1; Wheel Around, motion sanity and
  `all 490/490 catalog calls load without error` all pass). `ladies-sashay-probe` is all green.
  **THIS ITEM WAS ALSO HALF WRONG AND THE CORRECTION MATTERS:** the `ladies-sashay-probe` half was a **STALE
  PIN** (4 → 2), **not** an ambiguous selector, and `50d3e95` caused that too — `b1/sashay.xml` (2 tams) and
  `ms/sashay.xml` (2 tams) were both pooled under the title until b1 was retired. Fixed in the same pass,
  with the reason recorded in the probe so nobody re-pins it to 4. The durable record for both halves is now
  the code comments (`listAuthorings` in `poc/verify.cjs`, and the pin's own comment), not this file.
  The 2 remaining `poc/verify.cjs` failures are the `Circle Left` ring checks: filed under item 6.

- [x] **2. DONE — `Couple #N` on a wave named the home pair; a wave's adjacent pair is now the couple.**
  `[measured]` _scope chosen by the owner: wave neighbours are couples EVERYWHERE, one definition._
  The item as filed was `[recorded]`, and re-measuring it corrected three things. (a) The witness is not a
  built board: `boardForFormation('Ocean Waves')` carries **no home identity**, so `Couple #N` answers
  **null** there, not `[5,6]`. The defect needs a board **danced into** - `All 4 Couples Circle to a Wave`
  answered `Couple #1 = [5,6]`, the home pair, **6.00** apart. (b) `findCouplePairs` returned 0 pairs on
  **53** of the 270 boards the catalogue reaches from a squared set, and `Couple #1` was more than 2.5 apart
  on **27** of them. (c) The recorded `19 of 263` / `−20` / `+6` numbers are stale; the measured delta is
  **gained 7, lost 10** `legalNext` entries (`−Beaus/Belles Trade` and `+Allemande Left`, both directions).
  **Fixed** by a THIRD pass in `findCouplePairs` (opposite gender, one couple width, facing OPPOSITE, offset
  ACROSS that facing), run last so boards already paired side-by-side or facing cannot move. The authority
  is the corpus's own vocabulary file: *"Couples / Waves - dancers that are couples (facing the same
  direction), or dancers in waves or mini-waves (facing opposite directions)."*
  MEASURED AFTER: `Ocean Waves` 0 → **4** pairs, each exactly **2.00**; `couples.mjs` §7's sweep **189
  boards / 680 pairs → 223 boards / 816 pairs, 0 wrong** by its independent left/right truth; `Couple #1` on
  the witness `[2,5]` at **2.00**.
  **IT EXPOSED A SECOND DEFECT, FIXED WITH IT**: `beauBelle` took the left/right axis from whichever dancer
  the board ARRAY listed first, which is invisible for a co-facing couple and ARBITRARY for a wave pair
  (they face opposite ways). The truth test caught **39 of 816 pairs** wrong under the wave pass; the axis
  now comes from the pair's BOY. The same test then reports **0 wrong**, and no board outside the wave ones
  moved.
  **AND A THIRD, FILED NOT FIXED** — see item 34.

- [x] **3. DONE `d7147b5` — a scoped apply can be LEGAL and move nobody.** `[measured]`
  The guard recorded in `square-dancing.md` §9 is shipped: `applySelected`'s last fallback refuses when the
  whole-formation reading's `parallel` groups hold no selected dancer, because `parallelApply` leaves a dancer
  it did not tile exactly where it stands - so the merge is an identity and the step was accepted as a no-op
  that still charged its beats. THE CONDITION IS THE MECHANISM, NOT the "all end where they started" wording
  this item first asked for: MEASURED over the ms catalogue x 4 boards x 6 selections, **81** scoped applies
  are legal AND leave the board unchanged, and `Heads Forward and Back` is one of them, so the behavioural
  phrasing would refuse real calls. The witness is pinned in `engine/test/selection.mjs` - `All Except Heads
  Circle Four Left 3/4` on the ring `All Except Heads Step Forward` leaves, whose whole-board reading tiles the
  heads `5+6+1+2` - as the refusal, its reason, the whole-board control and the no-op control. EITHER SIDE:
  `figure-census.mjs` **1 -> 1** (the corpus's missing `Promenade` dominates it) and `getout-behaviour.mjs`
  identical over 412 published lines; `selection.mjs` **2 -> 1** with the new checks in place. ON A TREE WHERE
  `Promenade` EXISTS THE GUARD COSTS ONE FIGURE, `figm17`, whose chain was reaching its wave through this exact
  no-op; `engine/test/sequencer.mjs` now pins that stop and measures `Girls Circulate 2` on the canonical wave.
  The gap it exposes is the heads' own `Lead Right` reading.

- [ ] **4. RE-SCOPED, NOT FIXED — 50 apply-side pairs whose end board already has coincident dancers, and
  they are BODY faults, not matching faults.** `[measured]`
  The walk-through's `COINCIDENT 64` splits into **14 animation faults and 50 APPLY faults** (was
  32 / 10 / 22). The sweep now lives in `engine/test/lib/apply-faults.mjs`, and
  `node engine/test/tools/apply-fault-gate.mjs` pins it. **THE SCOPE THE OWNER PICKED FOR THIS ITEM IS
  REFUTED BY MEASUREMENT, BEFORE IMPLEMENTATION.** "Refuse a wrong-separation match" would refuse **ZERO
  of the 50**: every one is an application whose admitted match is **geometrically congruent** with the
  setup it was applied through — `noncongruent 0` even at the loose 1.5 admission — and the worst per-pair
  separation disagreement across all 50 is **0.0000 units**. What the faults actually are, measured:
  **29 body** (congruent at the tightest tolerance tested, 0.01, unreflected, gender-exact, mean error
  0.0000 — no matching rule can refuse these, the call's own body collides the dancers), **11 gender-miss**
  and **5 mirrored** (congruent but only through a permission the engine grants on purpose — `requireGender`
  is off wherever a variant is not declared `gender-specific`, and reflected readings are required to stay
  available, pinned by `engine/test/selection.mjs`), and **5 loose** (separated correctly in SHAPE,
  congruent only at the loosest admission tested, 1.5). The item's own attribution was therefore RIGHT —
  the call's own body is what lands two dancers on one spot — so this is corpus authoring (Phases A/B),
  except `Swing Thru`, which is coded.
  Work list by call: `Lead Right` 15, `Touch a Quarter` 7, `Box the Gnat` 5, `Square Thru 3` 4,
  `Chain Down the Line` 4, `Turn Thru` 4, `Square Thru 4` 3, then 1 each of `Star Thru`, `Swing Thru`,
  `Veer Right`, `Allemande Left`, `Wheel and Deal`, `Veer Left`, `Scoot Back`, `Right and Left Thru` —
  49 of the 50 are authored calls. The gate holds a ceiling of 50 and pins `noncongruent === 0`, so a fix
  that trades a body fault for a wrong-separation admission cannot pass it.

---

## P1 — the red gates: decide per harness, re-pin or fix

The engine suite is red **because the corpus is mid-edit**, and that currently makes a regression
indistinguishable from corpus churn. Freeze the corpus, run the full gate once, then work this list.

- [ ] **5. Freeze the corpus and take one clean measurement.** `[measured]`
  `npm run verify --prefix engine` → **45 of 46 harnesses, `FAILED at catalogue`, 1604.9 s**;
  `npm run verify:light --prefix engine` → **29 of 46, `FAILED at catalogue`, 121.7 s**.
  Seven corpus XMLs are modified and uncommitted in the tree (`formations.xml`,
  `ms/{alamo_style,allemande,circle,promenade,right_and_left_grand,star}.xml`). Nothing below can be
  classified as defect-vs-stale until those are settled.
  **SWEEP FOR MORE `50d3e95` DAMAGE — the pin drifts below are probably not all corpus churn.** Item 1 found
  that the b1/b2 retirement broke TWO unrelated gates (an ambiguous selector and a stale count) and that
  neither was attributed. That commit deleted the `b1/` and `b2/` level directories, so any gate counting,
  pooling or listing tams across levels was pinned to a tree that no longer exists. The method: for each
  currently-red harness, ask whether its pinned number was plausibly taken across b1/b2, and check with
  `git show 50d3e95^:poc/src/assets/b1/<file>` whether the difference is exactly the retired copy. A red
  whose delta equals a b1/b2 duplicate is a re-pin; a red that does not is a real change.

- [ ] **6. `Circle Left` fails in TWO gates — almost certainly one corpus edit.** `[measured]`
  `node engine/test/catalogue.mjs` → 3 checks:
  - `FAIL Circle Left from a Static Square ROUND-TRIPS (worst position residual 0.5860, was 0.6140 under the ascending order)`
  - `FAIL Circle Left leaves every facing where it found it (worst heading residual 22.50 deg, was 43.80)`
  - `FAIL the board after Circle Left is still named Static Square (got Circle)`

  `node poc/verify.cjs` → 2 checks, and these are the ENTIRE remaining failure list of that gate now that it
  runs to completion:
  - `FAIL Circle Left derives 0 holds (expect 8 for a ring)`
  - `FAIL every dancer holds exactly 2 neighbours (a ring)`

  The 22.50° residual, the `Circle` name and "0 holds" all point at one thing: `ms/circle.xml` is mid-edit and
  its ring no longer closes. Treat the two gates as one investigation and re-measure once the corpus settles —
  do NOT fix either gate's expectation first.

- [ ] **7. Pin-drift failures: each needs ONE decision, re-pin or fix.** `[measured]`
  These are signals, not noise — a pinned number moved.
  - `anim-convergence` — `the final-frame jump list changed: measured 20, pinned 7` and
    `the phantom list changed: measured 18, pinned 11`.
  - `cell-census` (`engine/test/tools/cell-census.mjs`) — `10 pinned number(s) moved - decide and re-pin`,
    plus `84 geometries -> 121 cells` and `506 kept, 216 lost of 1372 targeted edges`.
  - `level-census` (`engine/test/tools/level-census.mjs`) — `3 pinned number(s) moved - the
    STRICT-vs-PERMISSIVE decision has to be taken again`.
  - `fsm-asset` — `the asset was built from 274 catalog entries, the gate builds 288` and
    `6 new-fact count(s) moved - decide and re-pin`.
  - `reading-census` — `288 ms catalog entries, and the stored asset was built from 274`;
    `40 edge(s) disagree about the reading`; `28 build edge(s) were NOT reproducible`.
  - `selection` — `a board tied between two formations is still named "Right and Left Grand Static Square"
    - a tied best match is not an identity`.
  - `behaviour-audit` — 2, including `declared genders accept Circle Left from a Circle board`.
  - `editor.mjs` — 4 (identical before and after this session's `Face In` and rotation work):
    the `Circle Left` 1° heading discrepancy, the bounding-box check, the ms/a1 quarter-arc census, and
    `the witness has both cases to measure`.

- [ ] **8. `check:book` stops at a stale generated artefact.** `[measured]`
  `npm run check:book` → `check-links.mjs` PASSES (108 pages), then
  `DRIFT animations-index.json` / `1 file(s) differ`. Knowingly stale: **do not regenerate while the corpus
  is mid-edit** (AGENTS §8 trap 9). Also note the line it prints: `start queries: 0 matched on a tam's own
  declared formation (its "from" is empty); 11 resolved to nothing`.

- [ ] **9. `getout-convention` and `getout-conformance`.** `[measured]`
  `node engine/test/getout-convention.mjs` → **35 FAIL lines** (e.g. `[L1p]: returned path does not end home:
  dancer 4 at (1.00,3.00), home is (3,1)`, and `[B2r]: refused for the wrong reason: Unknown call: Promenade`).
  `node engine/test/getout-conformance.mjs` → `1 FIXTURE CHECK(S) FAILED`. Deliberately red since the
  `Promenade` family was removed; it stays red until hand-authored tams replace them.

- [ ] **10. The four owner-deferred probes.** `[measured]`
  `node poc/tools/verify-probes.mjs` → **59 probes, 4 failed**: `facing-handle-probe`,
  `radial-arc-fit-probe`, `run-circle-probe`, `start-facing-probe`. One more, `call-formations-probe`, is
  SKIPPED in the default tier ("slow tier — run with `--all`").

---

## P2 — real defects, bounded reach

- [ ] **11. `analyzeFasr`'s `corner` is wrong.** `[recorded]`
  It agrees with CALLERLAB's corner **0 times out of 4** on the home square — it returns the opposite girl.
  It feeds `fasrKey`, `isZero` and the solver's `Static Square` check, so it needs its own measured step.

- [ ] **12. A formation's NAME is not stable at 1e-14 rad.** `[recorded]`
  Adding 1e-14 rad to every heading changes the name for **5 of 16** formations (`Quarter Lines RH` →
  `Quarter Lines LH`, `Quarter Tag` → `Quarter Tag LH`, `Tidal Line RH` → `Tidal Line LH`,
  `Magic Column RH` → `Magic Column LH`). The connect end board differs by ~3e-15 rad. Not fixed.

- [ ] **13. `Circulate` is illegal from facing lines.** `[recorded]`
  The shipped variants are `Lines Facing In`/`Lines Facing Out`, so `Normal Lines` has no `Circulate`.

- [ ] **14. The wave `Circulate` paths may themselves be wrong.** `[recorded]`
  The `Split Circulate` wave tam moves half the dancers **4 units** between the two parallel waves, where a
  split call should keep each half in place. "The paths are suspect."

- [ ] **15. `boardSig` ignores facing.** `[recorded]`
  The get-out BFS cannot tell a board from its re-faced twin. Decide whether the search should.

- [ ] **16. `knownFormation`'s tolerance is the last loose one.** `[recorded]`
  It uses **6.0** where interactive matching uses `DEFAULT_MATCH_MAX = 1.5`; it is deliberately permissive
  for legality. Review whether it should follow the tight recognition threshold.

- [ ] **17. `compliesWithSetup` has no production caller.** `[recorded]`
  The FASR setup-matching half was built and wired nowhere; ditto the observation that the **`Circle` FSM
  state is an island** — every edge into it comes from `Circle` itself, and `Static Square` has zero edges
  to it, so "from Static Square, hold hands, ladies in, men sashay" is not a supported sequence.

- [ ] **18. The `Facing Dancers Close` tam carries 6 beats of movement in a call charged 8.** `[recorded]`
  Every dancer is STILL from t=6.5 to 8.0. "Left alone" deliberately.

- [ ] **19. Two `sequencer.mjs` checks fail on the corpus's own swing tam.** `[recorded]`
  The authored `Adjacent Dancers Close` swing ends partners **1.00** apart — a tandem, not CALLERLAB's
  ~2.0 Normal Couple — so `figm86`/`figm89` report *"dancers 1 and 4 are 1.00 apart … nothing to promenade"*.

- [ ] **20. 249 modules do not walk even with the guard off.** `[recorded]`
  `poc/tools/guard-exclusions-broken.md` (untracked by design): **249 modules / 50 distinct failing calls**,
  led by `Boys Run` 30, `Heads Lead Right` 28, `Centers In` 23, `Heads Pass the Ocean` 15. **101 of the 249**
  fail at the module's own start, so there is no "path before failure" to look at. This is where invalid
  calls in the corpus show up.

- [ ] **21. The decoder's 4 unread cells.** `[recorded]`
  `--1/2`, `--Keep`, `H-meet-T1/4`, `S-` are read by nothing, and the note says "do not guess". `-BRun` is
  the table's only approximation; `Outsiders` composes but cannot be performed.

---

## P3 — structural: these block whole classes of work

- [ ] **22. The FSM state drops the alignment.** `[recorded]`
  It keys on the normalised formation only, so **up to 96 alignments per formation collapse into one
  state**, and `c`/`r` boards are geometrically identical — no geometry-only matcher can separate them.

- [ ] **23. Relationship is under-modelled.** `[recorded]`
  All8 defines 4 relationship states; the engine records 2 (`partner`, `corner`), so `o` and `r` share one
  `fasrKey`. Measured on the home square: 8/8 have a partner, 8/8 a corner, 0 neither.

- [ ] **24. Canonical identity is the blocker for the cell key.** `[recorded]`
  Re-keying FSM nodes geometry→CELL gives `70 geometries → 105 cells (1.50×)`, and of 1340 edges **219
  (16.3%)** end on a declared pattern nothing declares; "22 of 396 cells fully readable".

- [ ] **25. No PHRASE layer.** `[recorded]`
  Blocks 5 `Centers Left Hand Star` figures and `Separate Around Two` — "blocked by the absence of a phrase
  layer", not by anything the engine could infer.

- [ ] **26. Active-set tracking is absent, and the Ocean Wave Rule is missing.** `[recorded]`
  Phase C's item 2 ("active dancers continue") is the last convention left; item 3, the Ocean Wave Rule, is
  "an unambiguously missing convention" and is BLOCKED on the scale defect — a `from="Facing Dancers"`
  authoring changed **no** figure outcome (census 107 → 107). `Do Sa Do`'s own Ocean Wave Rule is a
  documented gap with its CALLERLAB citation.

- [ ] **27. The get-out search's residual cost.** `[recorded]`
  The C term is now the whole cost (17 catalogue scans for 447 nodes on `[P4p]`), and
  `library.allVariantSetups()` **still drops the call name it would need to carry**. An index attempt was
  made and reverted: WeakMap object-identity keying is stricter than the string-keyed `matchMemo`, so
  measure that first.

---

## P4 — hygiene, by design, or deferred by decision

- [ ] **28. `callerlab-diff` cannot be green on a fresh clone.** `[recorded]`
  It `readFileSync`s the deliberately-untracked `callerlab-ms.txt` with no fallback and throws rather than
  skipping. Believed to be the only such dependency — keep it that way (AGENTS §6).

- [ ] **29. The busy lock drops a second click.** `[recorded]`
  A fast deliberate double-undo loses the second press. One line to make it queue; "the owner has not chosen".

- [ ] **30. `fsm-view` is 352 lines of one template literal**, and its two layouts duplicate each other.
  `[recorded]`

- [ ] **31. Browser observations never made.** `[recorded]`
  The start-pose drag "has not been seen on the board", and the reorganized HUD has not been checked at a
  real viewport (layout, timeline scroll against a 40-beat sequence, keyboard against a focused control).

- [ ] **32. `verify:figures` — the finish line, red BY DESIGN, and its census has COLLAPSED.** `[measured]`
  Run today: `188 figures, 1717 call cells, 4 unread (0.2%)`; `FAIL 4 call cells across 4 distinct tokens are
  not readable`; `164 distinct engine call names appear`, **`FAIL 16 of them are calls the engine does not
  have`**; `180 get-out links captured`; and **`1 of 188 figures run end-to-end`**.
  THAT LAST NUMBER WAS RECORDED AS **116 of 188** (and 13 missing calls, not 16) — so the figure census has
  fallen by 115 in the current tree. **It is NOT this session's couples change**: measured before and after
  that change and IDENTICAL on all four figures. It is the corpus mid-edit, and it is the largest single
  signal in the repo right now — a census this low makes every other figure number incomparable with the
  ones `PLAN.md` §2 records. Attribute it before trusting any census row, and re-measure the recorded 116 /
  124-of-265 / FSM 155 rows once the corpus settles.

- [ ] **33. Six more call selectors would die the same way item 1 did.** `[measured]`
  `poc/verify.cjs` has five further `{ title, … }` selector literals — `Brace Thru` (twice, lines 60 and 61),
  `Pass Thru` (166), `Circle Left` (188) and `Wheel Around` (224), as of `15d17ea` — and
  `poc/tools/end-spin-probe.mjs` has one. All six resolve to exactly one tam **today**, so they were
  deliberately left alone in `15d17ea` rather than rewritten speculatively. Each is one legitimate second
  authoring away from the same throw-at-the-gate failure, and the corpus is being edited. Cheapest
  prevention is to route them through the plural helper `listAuthorings` if and when one of them is touched
  for another reason; there is no reason to churn five working call sites now.

- [ ] **34. `Beaus`/`Belles` is INCOMPLETE where only some of a board's couples are recognised.** `[measured]`
  Found while fixing item 2, filed rather than fixed because it is a separate decision about the FALLBACK.
  `beauBelle` groups dancers by their derived couple NUMBER and then requires each number to hold exactly two
  dancers; on a partial board an unpaired dancer keeps its HOME number, so a number can hold three and that
  whole pair then contributes **no** role. MEASURED on `Heads Single Rotate 1/2`, `Heads Reverse Single
  Rotate 1/2` and `Sides Reverse Single Rotate 1/2`: the board recognises **three** couples but `Beaus` has
  only **two** entries, and an independent left/right truth check reports the missing pair
  (`engine beau #null truth #8`). It costs those boards `Beaus Trade` / `Belles Trade` legality — 5 of the 10
  lost entries in item 2's delta — because the engine then has no complete designated set to trade.
  The choice to take: derive the roles from `findCouplePairs`' own pairs (always one role per recognised
  pair, complete by construction) rather than by re-grouping numbers — which also removes the fallback that
  currently invents roles for UNRECOGNISED pairs out of home numbers, the same invention item 2 was about.
