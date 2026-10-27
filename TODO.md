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

Last swept: **2026-10-16**, from `8cfe8a1` — **THE RED GATES ONLY**: the full engine suite on a clean corpus
(47 of 48 harnesses, **24 FAILED**), `poc/verify.cjs`, `npm run check:book` and the POC probe suite, with
every failing harness re-run individually and its cause named by the commit that moved it. That is item 7
and its corrections to items 6, 9 and 10; items 35–38 are what it found and filed.
The rest of this file still carries the **2026-10-14** sweep from `15d17ea`. That tree moved to `a5668a2`
MID-SWEEP — a POC-only commit by the owner (A/F step the selected move slot), so its engine measurements
still stand, and the probe suite's count went 59 → 60 because it added `poc/tools/move-nav-probe.mjs`.

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
  `assets/ms/allemande.xml`
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

- [ ] **4. RE-SCOPED, NOT FIXED — 95 apply-side pairs whose end board already has two BODIES in the same
  space, and they are BODY faults, not matching faults.** `[measured]`, RE-MEASURED ON THE ENGINE'S BODY
  MODEL with the sweep WIDENED to every authoring of the couple calls (39 calls x 138 formations); on the
  narrower 33-call sweep the same tree reads 23 apply / 292 coincident / 269 animation.
  The widened walk-through's **532 coincident** applications split into **437 animation faults and 95 APPLY
  faults**, and **72 of the 95 are the couple family's own authorings** — `Lead Right - Close` 24,
  `Lead Right - Far` 13, `Lead Left - Normal` 12, `Lead Left - Far` 11, `Lead Right - Normal` 8, `Lead Left` 4
  — which the gate could not see until this sweep was widened. The sweep lives in
  `engine/test/lib/apply-faults.mjs` and `node engine/test/tools/apply-fault-gate.mjs` pins it, with a ceiling
  of **95**. **THE MEASURE CHANGED, AND THAT WAS A DECISION TAKEN ON A MEASUREMENT**: the centre test
  (`closestPair < 0.1`) is the measure the engine's own `BODY_PATH_CLEARANCE` note records as superseded, and
  keeping it made the gate prefer the WORSE of two applications — measured on `Tidal Line RH` + `Chain Down
  the Line`, where the centre measure prefers an application whose bodies pass through each other by
  **−0.700** over one that grazes at **+0.003** because their centres read 0.136 against 0.062. A pair is now
  coincident when its bodies intersect (`bodyGap < 0`), and the end-board discriminator is the same threshold.
  The 532 is consistent with the engine's recorded 723-of-1580 modules overlapping (~46%), which is why the
  engine's own guard is off by default.
  **THE SCOPE THE OWNER PICKED FOR THIS ITEM IS REFUTED BY MEASUREMENT, BEFORE IMPLEMENTATION.** "Refuse a
  wrong-separation match" would refuse **ZERO of the 95**: every one is an application whose admitted match is
  **geometrically congruent** with the setup it was applied through — `noncongruent 0` even at the loose 1.5
  admission. What the faults actually are, measured: **50 body** (congruent at the tightest tolerance tested,
  0.01, unreflected, gender-exact, mean error 0.0000 — no matching rule can refuse these, the call's own body
  collides the dancers), **15 gender-miss** and **5 mirrored** (congruent but only through a permission the
  engine grants on purpose — `requireGender` is off wherever a variant is not declared `gender-specific`, and
  reflected readings are required to stay available, pinned by `engine/test/selection.mjs`), and **25 loose**
  (congruent only at the loosest 1.5 — the objective's "wrong Close/Normal/Far spacing sibling", and it is
  REAL and live again now that the siblings are swept; worst per-pair separation disagreement across all 95 is
  **0.1092 units**).
  Work list by call, on the WIDENED sweep: `Lead Right - Close` 24, `Lead Right - Far` 13,
  `Lead Left - Normal` 12, `Lead Left - Far` 11, `Lead Right - Normal` 8, `Lead Left` 4, then `Turn Thru` 4,
  `Touch a Quarter` 3, `Wheel and Deal` 3, `Lead Right` 2, `Box the Gnat` 2, `Square Thru 4` 2,
  `Chain Down the Line` 2, then 1 each of `Star Thru`, `Swing Thru`, `Veer Left`, `Veer Right`,
  `Square Thru 3` — 50 of the 95 are authored bodies. THE CEILING IS NOW **95** (23 on the narrower 33-call
  sweep, 37 and 50 before that on centres); re-pinning in the same commit that re-measures is the gate's own
  instruction, and widening the sweep is the one change that legitimately RAISES it.

  **THE PATH HALF IS AN ORDER OF MAGNITUDE LARGER AND IS NOW VISIBLE.** On the body model **437** applications
  put two bodies in the same space somewhere in their motion while ENDING on a healthy board — an animator's
  job, not the applicator's. Under the centre measure, on the narrower sweep, that figure was **14**, so the
  measure change did not create them; it disclosed them. They are reported by the gate, not pinned.

  **THE SWEEP WAS WIDENED, WHICH IS THE HALF OF THIS ITEM THAT WAS INCOMPLETE.** It now sweeps every
  authoring the corpus publishes for the couple calls, read from the corpus rather than typed, so a sibling
  added or retired cannot be missed: 39 calls x 138 formations, **1009 applied, 532 coincident, 95 apply**.
  **72 of the 95 are the sibling titles** — the gate could not see any of them before. They were
  **ungoverned by `PERMISSION_RULES`** when this was measured — each offered on all 138 formations x 45 group
  names, against 20 of 6,210 for the bare names — so the picker listed them: 275 calls on a Static Square
  including all seven titles, 250 on `Double Pass Thru` including the five variants and NOT the bare names.
  **THAT HALF IS NOW CLOSED**: `5096c63` gave each sibling its own deny/allow pair, so all seven authorings
  refuse all-8 and only a numbered couple may dance each of them. Governing the picker does NOT touch these
  apply faults - the permission layer is picker-only - so the 72 stand as measured.
  **AND THE `25 loose` ARE THE OBJECTIVE'S OWN `d` STEP, LIVE AGAIN**: with the siblings swept, the wrong
  Close/Normal/Far spacing sibling being admitted at 1.5 is a measured class rather than a suspicion.

  **AND `permissions` WAS RED FOR FIVE ASSERTIONS, WHICH WERE THE `- Close` / `- Normal` / `- Far` GAP.**
  Section 13 and section 15 were corrected to name the corpus's own titles, and the loop over those titles
  asserts that all-8 is refused from a Static Square for EVERY authoring: the two bare names passed and the
  five siblings failed, because the rules named only the bare call and the match is exact. `5096c63` governs
  the siblings and `engine/test/permissions.mjs` now pins `KNOWN_UNREFUSED_ALL8` EMPTY - measured: **0 of the
  7** authorings are unrefused, against 5 before - so this red is gone and the pin fails if the gap reopens.
  `circle-four` is red by CRASH (`applied.lanes` is undefined at
  `circle-four.mjs:124`), and `group-calls` carries its 2 pre-existing `Head Boys` reds.

---

## P1 — the red gates: decide per harness, re-pin or fix

**THE SUITE IS RED IN SPITE OF A COMMITTED CORPUS, and the premise this section led with is REFUTED by
measurement.** At `abc10f1` with `assets` clean, **25 of 46 harnesses fail** (item 5) and only NINE of
them are a stale pin or a stale generated asset — the rest are live work: the `Circle Left` ring, the bare
`Promenade` gap, the `Lead Right` square-set rule. A red below is a defect until the sweep says otherwise.

- [x] **5. DONE `dc51e56` — the corpus is frozen, the measurement is taken, and the `50d3e95` sweep is run.**
  `[measured]` (measured AT `abc10f1`, the declared-final corpus revision)
  The seven XMLs are committed (`ms/circle.xml` is `a834725`, verbatim the content that was pending), and the
  owner has declared the catalogue final. `assets` is clean, so these numbers are not churn:
  - `npm run verify:light --prefix engine` → **29 of 47 harnesses, 14 FAILED**, 136.9 s
  - `npm run verify --prefix engine` → **46 of 47 harnesses, 25 FAILED**, 1288.4 s, first failure `catalogue`

  RED in `light` (14): catalogue, shape-census, arrangement-picker, verify, sequencer, circle-four, permissions,
  parallel-calls, step-forward, group-calls, mainstream, matrix, editor, features.
  RED only in the full tier (11 more): anim-convergence, reading-census, fsm-asset, cell-census, level-census,
  canonical-identity-probe, getout-conformance, getout-convention, selection, behaviour-audit, callerlab-diff.

  **SWEEP — nine reds are stale pins or a stale generated asset:**
  - `shape-census` — **RE-PIN.** The pin is 5963 tams (its own buckets sum to exactly that); `50d3e95^` has
    **6019**, i.e. **+56** from the Promenade family committed between them, and `abc10f1` has **5516**, i.e.
    **−503** from the b1/b2 retirement exactly: **622** b1/b2 tams retired against **119** added to `ms`
    (622 − 119 = 503). The written-size buckets moved with the total (2: 1063 → 1001, 4: 4815 → 4434).
  - `arrangement-picker`; `canonical-identity-probe` — **RE-PIN.** `formations.xml` went **279 → 291** committed
    formations after the pin, and the arrangement counts and library names moved with it: 2: 6 → 10, 4: 48 → 49,
    8: 201 → 208, library names 134 → 138 (the `canonical-identity-probe` red is that same 138 vs 134).
  - `fsm-asset`; `reading-census`; `level-census` — **RE-PIN, one stale asset.** The stored
    `assets/fsm-ms.json` is `catalogCount 274` while the tree builds **290**; `fsm-asset` also reports
    schema 2 against the engine's 3, 70 states different, and 6 new-fact counts moved. All three read that
    one file.
  - `cell-census` — **RE-PIN.** The catalogue grew: 84 geometries → **122** cells (pinned 121) and 505 kept /
    **215** lost (pinned 506/216); 11 pinned numbers moved.
  - `getout-conformance` — **RE-PIN.** *"declared as a catalogue gap but the engine DOES implement it now:
    `Promenade 3/4`, `Promenade Full`"* — two entries to remove from `KNOWN_CATALOGUE_GAPS`.
  - `callerlab-diff` — **RE-PIN.** `PINNED.matched` 11 → **12** and `notASetup` 11 → **10**: one pair MOVED
    between the two buckets. The round-39 comment names `Dosado` among the (B) pairs and `Dosado` is not in
    today's (B) list of ten, so its documented `Facing Dancers` now matches a setup. The other three pins hold.
  **…and the rest are REAL**: the Circle-family data (`catalogue`, `verify`, `editor`, `mainstream`, `matrix`,
  `behaviour-audit`), the bare `Promenade` gap (`sequencer`, `getout-convention`), the `Lead Right` square-set
  rule (`permissions`, `circle-four`), the while-step/lane work (`step-forward`, `parallel-calls`,
  `group-calls`), the tied board name (`selection`), the figure/animation lists (`anim-convergence`,
  `features`).

  INSTRUMENT, in this commit: `verify-suite.mjs` now prints **the corpus revision it measured** (git prints it
  with `stdio: 'inherit'`, since a piped child is EPERM here; a file list means the corpus was dirty) and one
  `ok` / `FAILED <harness> (Ns)` line per harness. The runner previously named only the FIRST failure, so
  "FAILED at catalogue" read as though everything after it had passed — which is how a 25-red suite looked like
  one red. It also caught the corpus moving three times under this session (`a476a4f` → `38d1ee2` → `fa4fb67` →
  `abc10f1`), which is why the numbers above are taken in the main tree at a declared-final revision rather
  than in a worktree: a detached `git worktree` isolates the corpus but breaks the FOUR harnesses that import
  `poc-teacher/src/catalog.ts` (`fsm-asset`, `matrix`, `matrix-getout`, `level-census`), because
  `node_modules/dancing-squared-engine` is a junction to the main engine and they then hold a SECOND engine
  instance — measured: `matrix-getout` passes in the main tree and crashed in the worktree.

- [ ] **6. `Circle Left`: THE CORPUS IS SETTLED AND DELIBERATE, so these are TWO different questions.**
  `[measured]` at `8cfe8a1`, re-measured on the owner's confirmation that `ms/circle.xml` is no longer
  in flight. `assets/ms/circle.xml` carries the answer in its own section header —
  `CIRCLE LEFT FAMILY FROM STATIC SQUARE TO CIRCLE` for the bare title, and the `… - Stop at Home` family
  for the round trip. Measured through `poseFor` and `computeHandholds`:
  - **The bare `Circle Left` is authored to END in the `Circle` formation, and the engine applies it
    faithfully.** The result is exactly `formations.xml`'s `Circle` (radius 2.609 constant from beat 2,
    neighbours 1.993 apart, 8 holds at the final frame). `0.5860` is `2−√2`, the shrink from the square's
    r=3.162 to the ring's r=2.613, and `22.50°` is the `Circle` formation's own facing offset. The round trip
    exists under the sibling title: `Circle Left - Stop at Home` measures `0.0000 / 0.00° / Static Square`.
    So `catalogue.mjs`'s three checks and `poc/verify.cjs`'s "does not round-trip" premise are asking the bare
    title for something the settled corpus no longer says.
  - **AND THE FACINGS ARE GENUINELY WRONG, which is the one authored-data defect here.** For beats 2–15 every
    dancer faces **46–51° away from the ring centre**, so no hand-holds derive (0 holds at beats 2, 8 and 14)
    and the ring only "forms" on the last movement. That — not the radius — is what `poc/verify.cjs`'s
    `FAIL Circle Left derives 0 holds (expect 8 for a ring)` measures.
  - **`engine/test/verify.mjs` is a separate, sharper instance of trap 7**: it loads `circle.xml`'s tam
    **index 0** and asserts a ring, and index 0 stopped being a `Circle Left` authoring at corpus commit
    `b83c305` (2026-09-24), which stamped an app-exported `movement` authoring whose ring collapses to 0
    holds; the `move select="cl"` authorings in the same file hold 8 at every beat.

  DONE, IN THREE COMMITS, EACH FAST-FORWARDED: `ab415f0` (`catalogue.mjs` - the round trip re-pointed at the
  sibling, and the ORDER witness re-pinned STRUCTURALLY because `b1` is gone and NO live title is
  order-sensitive: 0 of 4278 applications differ under the two walks); `09ac387` (`matrix.mjs` - the three
  bare rows are not rigid any more, every radius 3.162 -> 2.613, while the round-trip siblings are, at
  4.4e-16); `e28ba96` (`editor.mjs` - the closure witness and three further corpus assumptions, with a crash
  replaced by five VISIBLE failures, item 7). `verify:light` went **13 -> 11**.
  WHAT REMAINS: the mid-call FACINGS (46-51° off the ring centre for beats 2-15) are untouched, and which
  `Circle Left` authoring is canonical for `verify.mjs` is still an owner call (§8 trap 7).

- [ ] **7. THE RED-GATE CENSUS, RE-MEASURED AT `8cfe8a1`.** `[measured]`
  `npm run verify --prefix engine` on a CLEAN corpus at `8cfe8a1` reads **47 of 48 harnesses, 24 FAILED**,
  and 13 of those are in `light` as well. Every row below was then re-run individually and each cause is
  named with the commit that moved it. **THE `abc10f1` SPLIT THIS ITEM USED TO CARRY IS SUPERSEDED**: it
  predates the `f60f8fe` corpus edits and the `1bc084e` engine rule, it calls `selection` REAL (it is a
  re-pin — the tie is gone), and it attributes `cell-census` to the same stale asset (it is not).
  `poc/verify.cjs` adds 2 (item 6) and the POC probe suite adds 4 (item 10).

  **THE TWO CAUSES THAT CARRY MOST OF IT.** (1) **The corpus re-authored `Circle Left` deliberately** — the
  bare title ends in `Circle`, the round trip lives under `Circle Left - Stop at Home`, and six harnesses
  still witness the bare title as a round trip (item 6). (2) **The generated FSM asset
  `assets/fsm-ms.json` is stale** — `schemaVersion 2` / `catalogCount 274` against the engine's
  schema 3 and **290** entries; last regenerated at `aa76148`, while `d3c0800` bumped the schema without
  regenerating it, against that file's own comment saying it is regenerated in the same change. That is a
  **DEFECT, not a knowingly-stale artefact**, and the shipped FSM view cannot label the tam behind an
  `@embed` node because of it. **A REGENERATION ALONE CLEARS NONE OF THE FOUR HARNESSES THAT READ IT**: each
  also pins numbers measured from the LIVE engine, which the asset cannot move, and `cell-census` is not even
  the same asset. `node scripts/build-fsm-asset.mjs` is the only writer and is wired into NO npm script.
  **UPDATE (`agent/one-fsm-asset`): the asset is REGENERATED (291 catalog / 68 states / 3934 edges) and the
  "clears none of the four" claim above was MEASURED and corrected** — `fsm-asset` went 7 FAILED → all green,
  `level-census` red → all green, `reading-census` 4 → 2 FAILED (the two it cleared were `102 build edges NOT
  reproducible` and 6 of its 9 reading mismatches), and only `cell-census` is unmoved (identical on both
  assets, so its reds are corpus drift). Item 37 is closed with the numbers; the pins that remain are item 7's
  census, not this.

  | harness | tier | class | the cause, named | next unit |
  |---|---|---|---|---|
  | `catalogue` | light | RE-PIN | bare `Circle Left` ends on `Circle` by design (`72cb0508`) | re-point the witness at `… - Stop at Home` |
  | `shape-census` | light | RE-PIN | pins blame `e041dae4`; tams **5963 → 5516** across `72cb050`/`d3c0800`/`50d3e95`; first declaration mismatch at `72cb050` | re-pin; make the mismatch check a named list |
  | `arrangement-picker` | light | RE-PIN + harness bug | counts moved by `5bdf55e`/`8731389`/`ab254d9`/`22a9eb3`/`f60f8fe`; **`Columns LH is offered` asks for a name that has never existed** (corpus spelling `Columns LH BGBG`) | fix the witness name, then re-pin 4 counts |
  | `verify` | light | **REAL** | loads `circle.xml` **index 0** (trap 7); `b83c305` (09-24) stamped an app-exported `movement` authoring there whose ring collapses to 0 holds from beat 2 | owner: which authoring is canonical (item 6) |
  | `sequencer` | light | REAL 11 / BLOCKED 3 | 3 await a bare `Promenade` tam; 11 independent, incl. the AUTHORED `Promenade 1/2` turning headings **90.8°** not 180° | re-author `Promenade 1/2` rigid; author the bare tam |
  | `circle-four` | light | REAL (harness) | crash: `applied.lanes.find` at `:124` unguarded after `applied.legal` failed — a refusal carries no lanes. Underlying refusal is the while-step collision (body gap −0.46) | guard the harness; see item 36 |
  | `parallel-calls` | light | REAL | `1bc084e` (10-13) added the group-scoped collision refusal (`applicator.ts:965`); its two-lane while-step witness is now refused and charged **0** beats, not max(6,2)=6 | engine/owner: exempt disjoint lanes, or re-author the witness |
  | `step-forward` | light | REAL 11 / RE-PIN 5 | 11 are the `All Except <group>` reading refusing; 5 are `ab254d9` moving `Promenade 1/2 to Home` **8 → 8.5** and `3/4` **12 → 12.25** beats. **A naive re-pin does NOT clear them**: `Array.from({length: 9.5}).length` is 9, so `trace[8.5]` is `undefined` | fix the half-beat sampling AND re-pin; `All Except` is its own engine unit |
  | `group-calls` | light | REAL / owner | `groupCanPerform('Head Boys','Promenade 1/2')` and `(…, 'Swing Your Partner')` both true, parking non-partner boys on the centre line — while `sequencer.ts:587`'s own doc says the OPPOSITE for `Swing Your Partner`. NOTE: authoring a bare `Promenade` turns the currently-PASSING sub-check RED | settle doc-vs-gate, then stop a whole-board call being scoped to 2 non-partners |
  | `mainstream` | light | REAL 4 (harness) + REAL 1 (engine) | `callMeta(ms/circle.xml).title` is now `Circle Left - Stop at Home`, so the harness registers no `Circle Left`; the fifth is **`getout()` leaking state into the interactive apply path** | item 35 (the leak); register by title list |
  | `matrix` | light | RE-PIN 2 + REAL 3 | `Circle Left/Right 1/4` end on `Circle`; `All 4 Couples Promenade 1/4` ends on `Promenade` (`b66b829`/`f60f8fe`) | re-point the two ring rows; promenade rows wait on item 9 |
  | `editor` | light | RE-PIN 3 + harness bug — **FIXED `e28ba96`, AND THE CRASH WAS HIDING FIVE MORE** | witness closes to **1.02°** (was ~44°); all 8 moves carry a facing curve so `path[-1]` died at `:1501`; **28** exact quarter arcs now exist; bbox excursion **6.4e-4** units against a 1e-9 tolerance. The uncaught `TypeError` aborted the run ~1000 lines early, so the census could only see four of them: with the guard in, **5 further failures are VISIBLE** — `2% sits in an EMPTY BAND` (worst real arc 4.99e-2 against the next curve at 5.22e-2, a ratio of **1.05** where the check wants 5x), `the END moves by no more than the fit was already out by` (5.6e-5 against a 1e-9 bound), `it reads as ONE turn` (the sweep reads **−201.9°**, not 360°), `runTurn agrees with the fit`, and `the export writes the reference it should` | its own unit — attribute the five; the first is item 10's class |
  | `features` | light | REAL (harness) | registers all of `circle.xml` under one name, then takes the SMALLEST setup — now a 2-dancer `Facing Dancers` pair, so the "8-dancer" board is built with 4 | pin the setup, not the smallest |
  | `anim-convergence` | all | RE-PIN (mostly) | jump list **7 → 20** (13 of 15 new keys are Circle-family, 2 are the `right_and_left_grand.xml` re-authoring); phantom list **11 → 18** is `Right and Left Thru`/`Box the Gnat`/`Slide Thru`, NOT the ring | re-pin both lists once item 6's witness question is settled |
  | `behaviour-audit` | all | REAL ×2 | a `Circle` board matches the **0.586-away Static-Square setup** over the exact one, which kills the gender gate; plus 4 unpinned animation jumps | matcher variant selection is its own unit |
  | `reading-census` | all | **DONE `6e334d6`** | the live catalog constant **274 → 290** (the check compares the live catalogue against the stored asset, so both sides had to move), and the multi-arity pool **107 titles in 3 size sets → 104 in 4** (`4,8` 104 → 97, `2,4,8` 2 → 4, a NEW `2,8` x2, `6,8` unchanged). The `{2,4,8}` set is the one that can express a MIXED partition; it grew 2 → 4 while the pinned yield stayed **ZERO**, so the pool is wider and still admits nothing | landed |
  | `fsm-asset` | all | **DONE `6e334d6`** | regenerated - "built in 55867ms: 70 states, 3958 edges" against 65 / 2308. Counts re-pinned **290/70/3958** and the six new-fact counts **1643/1186/1129/3598/14/346** (the six sum to the edge count: 1643+1186+1129 = 3958; `out-of-scope` FELL 17 → 14 and `novel` 640 → 346). The state list, the order and all 3958 edges now agree with the engine in BOTH directions | landed |
  | `level-census` | all | **DONE `6e334d6`** | `{42,78,34}` → **`{45,86,38}`**: the permissive closure escapes MORE of the level than before, so the STRICT-vs-PERMISSIVE decision is re-taken in the SAME direction and the case for STRICT is stronger | landed |
  | `cell-census` | all | **DONE `6e334d6`** | sizes 70/105 → **84/122**, price 1372/219/563 → **2983/331/729** (the cost of re-keying FALLS to 11.1%), and the 12-number block. `letteredGeometries` (9) does NOT move - the number saying the vocabulary was not redefined, only swept over more boards. Sequenced AFTER the regeneration on purpose: `targeted` is counted from the STORED asset | landed |
  | `canonical-identity-probe` | all | RE-PIN | `offered` **134 → 138** (+2 at `22a9eb3`, +2 at `f60f8fe`); the legal-calls pin is MIXED engine+corpus — its anonymous 347 appears at NO corpus revision under today's engine | re-run the probe to take the numbers; do not derive them |
  | `getout-conformance` | all | RE-PIN | `KNOWN_CATALOGUE_GAPS` (`all8-notation.ts:612-613`, `919af90e`) still declares `Promenade 3/4` / `Promenade Full`, authored at `ab254d9` | delete the two stale entries |
  | `getout-convention` | all | **FIXED `7a172b1` — 35 FAIL lines → 15, and ZERO `does not end home` (was 30)** | the goal test now requires IDENTITY (`sameBoardById` against `makeSquaredSet()`), not the home FASR, which is a RELATIONSHIP key that a wholesale rotation preserves. Reproduced before the fix: `[L1p]` from `Normal Lines` returned `[Circle Left - Stop at Home]` ending 8-of-8 off their own spots while `matchesNamed` was true and both FASR objects were JSON-identical. The 15 that remain are the Promenade removal's recorded cost (7 `no getout found`, 3 `Unknown call: Promenade`, 3 `fixIt offers nothing`, the sampled count) and are NOT fixed | the hand-authored promenade tams; `matrix-getout` was re-pointed in the same commit because it verified its path with `isAt`, which is `matchesNamed` |
  | `selection` | all | **RE-PIN — the recorded `REAL` is refuted** | the pin's premise is gone: `22a9eb3` added `Right and Left Grand Static Square`, which the `Face In` board now names exactly, so there is no tied best match left. VERIFIED in this tree: `knownFormation` returns that name while `recognize` still returns null | re-pin to assert the exact identity AND that `recognize` still refuses it |
  | `callerlab-diff` | all | PROVISIONING | `callerlab-ms.txt` is absent in this clone; `callerlab-diff.mjs:46` reads it unguarded → `ENOENT`, exit 1, no summary line. The PDF IS present, so it is one extractor run | provision per §10.1; then decide item 5's `matched 11→12` |

- [x] **8. `check:book` stops at a stale generated artefact.** `[measured]` at `8cfe8a1`, **FIXED at `d704a6a`**
  The record below is the defect as found. It was TWO defects, and the first hid the second: both `--check`
  paths compared the bytes they generate (LF) with the file in the working tree, which `core.autocrlf=true`
  makes CRLF on this clone — so `animations-index.json` "drifted" against a blob that matched the generator
  exactly, and 5 of the 6 diagrams did too (MEASURED: same line multiset, 0 lines in a different position).
  Because the chain fails at the first check, that also hid the ONE real drift: `centers-and-ends.svg`, a
  24-of-50-line reorder of the same four dancers, from a generator that is deterministic (two runs, same
  SHA-256). Fixed by `f0d8c43` (compare text, not line endings) and `d704a6a` (regenerate that diagram), and
  the index was regenerated in `1e434f2` with the start table it derives from. `npm run check:book` is GREEN:
  108 pages, 75 playable calls reproduce and verify (849 pose evaluations), 6 diagrams reproduce.
  **AND THE START-QUERY LINE IS NOW ACTIONABLE**: `40 resolved to nothing` -> `12`, and each of the 12 is
  NAMED by the build (`NOT DRAWN  <card> / <label>: "<title>" from "<formation>" in <file>`). All 12 fail on
  the FORMATION rather than the title — see item 39, which is what they turned out to need.

- [ ] **9. `getout-convention` and `getout-conformance`: NOT one Promenade item.** `[measured]` at `8cfe8a1`
  **THE ENGINE HALF IS FIXED (landed `7a172b1`, TODO item 7's row carries the numbers): the goal test now
  requires IDENTITY, so `getout-convention` went 35 FAIL lines -> 15 and has ZERO `returned path does not
  end home` where it had 30. What is described below is the DEFECT AS FOUND and is kept as the record; the
  15 that remain are `getout-conformance`'s two stale `KNOWN_CATALOGUE_GAPS` entries (a re-pin) and the
  `Promenade` family's absence, which is the hand-authored-tams item.**
  `node engine/test/getout-convention.mjs` → **35 FAIL lines, and only 4 of them name `Promenade`.** The
  other **30 are `returned path does not end home`**, and the cause is a live ENGINE defect in the goal
  test's CRITERION, not the missing family. `Solver.reachesTarget` (`engine/src/sequencer/solver.ts`) accepts
  a board as home when `matchesNamed` says so AND the board's FASR matches the home FASR — and **FASR is a
  RELATIONSHIP key, so rotating the whole squared set 90° does not change it.** REPRODUCED here from the
  harness's own start board: `[L1p]` starts on `Normal Lines`, `getout` returns
  `[Circle Left - Stop at Home]`, and the end board puts **all 8 dancers on a DIFFERENT dancer's home spot**
  (`#4 (1.00,3.00) vs home (3,1)`, `#3 (3.00,1.00) vs home (3,-1)`, …) — while `matchesNamed(board,'Static
  Square')` is `true` and the two FASR objects are JSON-identical. `[L.F1p]` shows the same with
  `[Promenade Full to Home]`. The harness's `onHome` compares **by identity** (each dancer against its OWN
  home spot and facing) and is right to refuse. The other 4 lines (`[B2r]`, `[B2p]`, `[B4c]`, `[P4p]`) ARE
  blocked on a bare `Promenade` tam.
  **So "it stays red until hand-authored tams replace them" is wrong for 30 of the 35, and authoring the
  tams would clear 4.**
  `node engine/test/getout-conformance.mjs` → `1 FIXTURE CHECK(S) FAILED`, and THIS one is a pure RE-PIN:
  `KNOWN_CATALOGUE_GAPS` (`engine/src/sequencer/all8-notation.ts:612-613`, blames `919af90e`) still declares
  `Promenade 3/4` and `Promenade Full` as gaps while `ab254d9` authored both into `ms/promenade.xml`. Two
  entries to delete, no tam to write.
  MEASURED, for the record: `ms/promenade.xml` authors NO bare `Promenade`/`Promenade Home`, and `ab254d9`
  also moved `Promenade 1/2 to Home` to **8.5** and `3/4 to Home` to **12.25** beats.

- [ ] **10. The three owner-deferred probes.** `[measured]` at `1c3897f`
  `node poc/tools/verify-probes.mjs` → **68 probes, 3 failed**, 8 failing checks in total:
  `radial-arc-fit-probe` 2, `run-circle-probe` 4, `start-facing-probe` 2. `call-formations-probe` is
  SKIPPED in the default tier ("slow tier - run with `--all`").
  **THE OTHER TWO ARE NOW GREEN, and neither was a re-pin.** `facing-handle-probe`'s byte-identity check
  by the exporter writing a canonical `[0, 360)` dancer angle (`1c3897f`), and `end-pair-probe`'s section 5
  because its sample was `calls[0]` — a position in a directory listing — and that call, `ms/fold.xml`,
  has four dancers with an EMPTY path, so no connect could land it on any target. Both were recorded as
  red by decision at `13b688b`; the measurements above are what overturned the first, and the second was
  never a defect.
  Re-measured and attributed: `radial-arc-fit-probe` reports the two checks its own header records as
  owner-ruled (the 180-of-188 offer and the 1.7° band against 2.0° of slack), and `run-circle-probe` reports
  four — the `setRunCircle`/`arcBezierAbout` closure and turn checks plus the two section-7 OFFSET-orbit
  pins, a DIFFERENT set from the four its header lists, same owner-ruled class. Both are about
  `setRunCircle`/`arcBezierAbout`, not the corpus ring.
  **THE ENGINE HARNESS THAT WAS RED FOR THE SAME MEASUREMENT IS NOW GREEN, and no longer waits on this
  decision.** `engine/test/editor.mjs`'s band check was measuring `2%` against a ratio of **1.05** where it
  wanted 5x; it now measures the engine's own `ARC_FIT_TOL = 0.02` with a 3x margin — worst real arc
  **1.47e-2**, the closest curve that is not one **4.99e-2** — so it pins the constant the code ships
  rather than a window the corpus no longer agrees with. `editor` passes, and the count of failing engine
  harnesses is 10, none of them this one.

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

- [ ] **51. FOUR ENGINE MODULES ARE 1300-1700 LINES, AND SIZE IS NOT THE MEASUREMENT THAT SAYS SO.** `[measured]`
  A line count over the tree (`Get-Content <f> | Measure-Object -Line`) puts `engine/src/sequencer/applicator.ts`
  at **1658**, `alignment.ts` **1582**, `sequencer.ts` **1562**, `sequence.ts` **1342**; outside the engine
  `packages/stage/scene.ts` **1509**, `book/tools/build-site.mjs` **1389**, `game/src/net/api.ts` **963**,
  `engine/src/sequencer/all8-notation.ts` **981**, `scripts/tag-formations.mjs` **866** and `poc/src/browser.ts`
  **853** (36 methods, 2 exports). The longest lines are NOT the signal: `poc/src/fsm-view.ts` is only 418 lines but
  carries **18** over 200 characters (minified layout data), and `poc/src/editor-ui.ts` is **6113** lines with 19 -
  a UI shell whose size is item-shaped rather than rule-shaped.
  **THE R6 PRECEDENT IS THE METHOD, NOT THE TARGET**: R6 extracted four modules and each extraction was justified by
  a rule that could not be probed where it lived (`export-format.ts`, `same-move.ts`, `board-key.ts`,
  `board-period.ts`) - never by a line count. So the next step is a MEASUREMENT per module (what rule is unreachable
  from a probe, how many call sites agree on it), not a split. Filed rather than started because a 1600-line module
  split with no measured lead is churn, and the probes that would prove the split live in the `all` tier.

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

- [ ] **48b. THE `1e-3` COPIES IN THE PROBES, WHICH ITEM 40 ADJUDICATED AS DELIBERATE.** `[measured]`
  The normaliser half of the old item 48 is done and its record is in the commit that converted it; what remains is
  the tolerance, and item 40's close-out already argues it: **12 `engine/test/` and 11 `poc/tools/` files spell
  `1e-3`**, and a probe's own tolerance is not automatically a copy of `XML_ROUND_TRIP_TOL` — the self-containment
  rule (§5) is why several of them spell it. Converting one is a decision per site, so this is filed as a reading
  pass, not a sweep: for each, does the number answer "the same after a file" (then it is the engine's) or "close
  enough for THIS measurement" (then it stays, with the reason in place)?

- [ ] **49. `MS_PER_BEAT` IS DECLARED TWICE AND DERIVED A THIRD TIME - AND THE GAME'S COMMENT SAYS IT IS REUSED.** `[measured]`
  `game/src/puzzle/config.ts:195` exports `MS_PER_BEAT = 500` under a comment saying "The POC's `MS_PER_BEAT` (500,
  i.e. 120 beats a minute), reused rather than re-chosen", and `poc/src/sequencer-ui.ts:104` declares its OWN private
  `const MS_PER_BEAT = 500` with no import in either direction. MEASURED, `git grep -n MS_PER_BEAT`: the two
  declarations, the game's consumers (`game/src/ui/playhead.ts` and `game/test/playhead-probe.mjs`), and
  `poc-teacher/src/preview.ts:110`, which derives `60000 / PREVIEW_BPM` because the teacher previews at its own tempo.
  So a sentence is the only thing keeping two app constants equal — the copy-without-a-gate failure `AGENTS.md`
  §11.2.9 names. **The fix is a decision about ownership before it is code**: the engine owns beats (and
  `SIGNATURE_DIVISOR` already sits in `sequencer/constants.ts`), but a playback tempo is presentation, so either one
  owner plus an injectable BPM, or two copies plus a probe that compares them. `square-dancing.md:3278` states the
  number as a convention, so it moves with whichever decision is taken.

- [ ] **50. THE GAME'S TWO `corpusCalls()` LOADERS ARE DELIBERATE TWINS, AND THEIR POOLING HALF IS THE DUPLICATE.** `[measured]`
  `game/src/data/assets.ts` (57 lines) enumerates the corpus through Vite's `import.meta.glob`;
  `game/src/data/corpus-node.ts` (156 lines) goes through `filesOf`/`readFile` from `dancing-squared-corpus`. Both
  export `corpusCalls()`, both carry the same measurement written twice (`62 titles from 66 files` becoming
  **322** — `assets.ts:35,46` and `corpus-node.ts:58,73`), and both skip generated instances by the same predicate.
  The ENUMERATION cannot be shared (the browser build has no `fs`), and that is the documented reason for the twins -
  but the POOLING half is fs-free: a `pooledByTitle(files: Record<path, xml>)` in `packages/corpus/blocks.ts` (~10
  lines, the module that already owns the `<tam>` slice) would take each loader's map and return the same title list,
  leaving only the enumeration per environment. Filed rather than done because the proof is a `game` probe run
  (`game/tools/verify-probes.mjs`) showing the two still agree, and that suite is minutes long.

---

## P1 — FOUND BY THE ITEM 7 CENSUS AT `8cfe8a1`

- [ ] **35. `getout()` LEAKS STATE INTO THE INTERACTIVE APPLY PATH.** `[measured]` at `8cfe8a1`, found during
  the item 7 census and filed rather than fixed because it is an engine-contract question, not a pin.
  `mainstream.mjs`'s fifth red is not its registration bug: with `seq.getout(...)` called first, replaying
  the returned path interactively is REFUSED, and the SAME replay after `seq.reset()` without the `getout`
  call is legal at every step — MEASURED, the three-step path
  `[Cast Off Three Quarters, Right and Left Grand, Promenade Full to Home]` gives
  `No setup in this call matches the current formation.` for the first two steps when the search ran first,
  and `legal=true` for all three when it did not. So a search changes the answer of a later apply, which is
  a contract violation and the same first-call-validity property `features.mjs` pins elsewhere. NEXT UNIT:
  find what `getout` leaves behind (match memo, FSM store, `adjustToNextSetup`) and show `reset()` does not
  clear it.

- [ ] **36. FIVE HARNESSES ASSUME A CORPUS SHAPE THAT MOVED, SO THEIR REDS ARE HARNESS BUGS.** `[measured]`
  at `8cfe8a1`. Each was re-run and the assumption named; none is an engine defect, and each reds the whole
  harness rather than one check:
  - `circle-four.mjs:124` reads `applied.lanes.find(...)` after `applied.legal` failed — a REFUSAL carries no
    lanes, so the harness dies with `TypeError` and exit 1 instead of reporting. Same missing guard at
    `editor.mjs:1501` (`path[-1]` is undefined when the tam carries a facing curve on all 8 moves).
  - `arrangement-picker.mjs:120` asserts `Columns LH is offered`, and `Columns LH` has existed in NO revision
    of `formations.xml` (the corpus spelling is `Columns LH BGBG`), so the check can never pass and the two
    `if (p('Columns LH'))` witnesses below it never run.
  - `features.mjs:113-115` pools all of `circle.xml` under one name and then takes the SMALLEST setup, which
    is now a 2-dancer `Facing Dancers` pair — so its "8-dancer" board is built with 4 dancers and the
    parallel-apply checks ask the wrong question.
  - `mainstream.mjs:25-35` registers each ms file by `callMeta(xml).title`, i.e. its FIRST tam's title, which
    for `circle.xml` is now `Circle Left - Stop at Home` — so `Circle Left` is unregistered and four checks
    fail on `Unknown call: Circle Left`. (This is AGENTS trap 7 again: register by TITLE, not by file.)
  - `step-forward.mjs:424/500/574` build their sample traces with `Array.from({length: total+1})`, and
    `Array.from({length: 9.5}).length` is **9** — so with the corpus's new 8.5-beat promenade `trace[8.5]` is
    `undefined`. A re-pin alone cannot clear those two checks; the sampling must take half beats.

- [x] **37. THE FSM ASSET'S STALENESS IS INVISIBLE TO EVERY CHANGE-TIME GATE.** `[measured]` at `8cfe8a1`;
  **CLOSED in `agent/one-fsm-asset`.** `assets/fsm-ms.json` went stale at `d3c0800` (schema 2 → 3) and stayed
  stale for the many commits since, and the reason was structural rather than accidental: the writer
  (`node scripts/build-fsm-asset.mjs`) was wired into **NO npm script**, and the one gate that checks freshness —
  `fsm-asset.mjs` — is `light: false`, as are `reading-census`, `cell-census` and `level-census`. So
  `verify:light`, the gate a change is supposed to run, structurally could not see it.
  **WHAT CLOSED IT, in two commits.** (1) The asset is REGENERATED: 290 catalog / 70 states / 3958 edges →
  **291 / 68 / 3934**, and `fsm-asset.mjs` is GREEN for the first time in ~20 commits — MEASURED per harness, the
  regeneration cleared `fsm-asset` (7 FAILED → all green), `level-census` (was red → all green) and
  `reading-census`'s two asset-shaped failures (`102 build edges NOT reproducible` → 0, `9 readings disagree` →
  3); its remaining 2 and `cell-census`'s 4 are IDENTICAL on both assets, so they are corpus drift and are left
  red for item 7's census. (2) The gate exists in the tier a change runs: `engine/test/fsm-asset-freshness.mjs`
  (`light: true`, ~0.3 s) asserts the two facts that actually drifted (schema, catalogue count), that the table
  is not empty, and that there is ONE copy. The generator is now `npm run build:fsm` / `npm run check:fsm`, and
  `scripts/build-fsm-asset.mjs --check` proves a stale asset by name — MEASURED against the two real stale
  artefacts: the old 290-title asset (`catalogCount 290 vs 291, states 70 vs 68, edges 3958 vs 3934`) and the
  teacher's dead schema-1 copy (`schemaVersion 1 vs 3, 154 vs 68 states, 803 vs 3934 edges`), both exit 1.
  **The second victim is gone too**: `poc-teacher/src/assets/fsm-table.json` + its builder are deleted and the
  app reads `@corpus/fsm-ms.json`; its own copy had gone UNLOADABLE (schema 1 against 3), so it was 77.5 KB of
  dead data while the app built the table at runtime.

- [x] **38. `engine/test/tools/fsm-getout-audit.mjs` IS IN NO SUITE.** `[measured]` at `8cfe8a1`, **CLOSED by the
  R2 triage**. MEASURED: it runs in 113.8 s, prints a table and **no check lines, and exits 0 on any input** — it
  is a REPORT, not a gate, so "wire it in" was the wrong half of the choice: a gate that cannot fail is not a
  gate, and 114 s in the pre-commit tier to print a census nobody compares is the cost §11.3 warns about. Its
  claim (the FSM's 155 states / 92 home / 43 nohome / 19 dead `@embed#N`) is recorded in `PLAN.md` §2, and the
  file now says on line 1 that it is a one-shot diagnostic and points there. **The class it belongs to is now
  enforced**: every file under `engine/test/` is either registered in `engine/test/suite.mjs` or stamped, and
  `engine/test/harness-registry.mjs` fails when one is neither — so this TODO cannot recur silently.

- [ ] **41. TWO UNREGISTERED INSTRUMENTS ARE ALREADY ROTTED.** `[measured]` by the R2 triage, which ran every
  unregistered probe that is gate-shaped (checks + a non-zero exit; 17 of them). Two fail today, and neither is
  registered, so nothing has noticed:
  - **`engine/test/tools/setup-path-probe.mjs`** — exit 1 in 30.3 s: "1 PIN(S) MOVED".
  - **`engine/test/tools/swing-thru-rule.mjs`** — exit 1 in 4.1 s: "SWING THRU RULE: 1 check(s) FAILED".
    Its header says the rule was "kept as a tool rather than thrown away" — the transcribed rule and the engine
    have since diverged, which is exactly the stale-copy shape AGENTS §11.2.9 describes. A decision is owed:
    re-pin it to today's behaviour (and say what moved), or retire it. It was NOT registered as a red gate: a
    permanently-failing entry trains everyone to ignore the tier. Both are stamped `Recorded: TODO.md` until
    decided.

- [ ] **40. ANGLE NORMALISATION — what was left, and the TIE-BREAK THIS FOUND.** `[measured]`
  The engine's 21 expressions in seven interval conventions became one (`moves.ts`'s `normAngle`, gated by
  `engine/test/angle-normalisation.mjs`). Two loose ends, one inside the engine and one outside:
  - **`core.ts`'s mirrored-half heading still spells `atan2(sin(h + PI), cos(h + PI))`** — the one substitution
    that was reverted, because replacing it MOVED A GEOMETRIC TIE-BREAK. `behaviour-audit`'s two 45-degree-offset
    checks went from the identity mapping to a two-step cyclic shift `[6,7,0,1,2,3,4,5]`, and the audit's own
    FAIL/PASS counts moved 149/2 → 147/4. **BISECTED file by file**: restoring `core.ts` alone restores the
    mapping; the while-vs-modulo choice of the rule's body does NOT (measured — the loop body still flipped it).
    Restoring `core.ts`'s atan2 spelling restored 149/2. So the survivor is on the record with its measurement,
    and the finding underneath is worth its own unit:
  - **THE 45-DEGREE ALIGNMENT TIE-BREAK IS DECIDED BY ONE ULP.** Two alignments of a rotated squared set are
    equally exact — the mirrored dancers' headings differ in the last bit and the winner moves — so
    `deriveFormationMapping`'s `bestErr` comparison should break near-ties EXPLICITLY, the way `match.ts`'s
    `TIE_EPS` (1e-9) already does for formation matching, instead of letting a rounding decide. Not done here:
    it is a behaviour change, and this unit's intent was to consolidate with NO behaviour change. Witness and
    probes to re-run: `behaviour-audit`'s "Index independence: editor joins ignore array order" section, and
    `poc/tools/end-pair-probe.mjs` (2278 pairings).
  What is still OUTSIDE the engine, with the reason each was left:
  - **`poc/src`, 5 sites** — `formation-xml.ts:91` and `editor-ui.ts:364` (`atan2(sin, cos)`), `editor-ui.ts`
    (a while-loop pair), and two inline `atan2`s. Left because **~30 `poc/tools` probes read `poc/src` as SOURCE
    TEXT and assert what it spells** (`end-spin-probe.mjs`, `move-nav-probe.mjs`, `named-setup-probe.mjs`,
    `mirror-moves-probe.mjs`, `start-pose-drag-probe.mjs`'s "Mirrored from `editor-ui.ts`"), so changing the
    panel is a migration of those audits rather than a substitution. The panel CAN import the engine's
    `normAngle` (it already imports the engine by package name); the audits are the work.
  - **`book/tools`, 1 site** — `make-formations.mjs:293`. Left because the engine export list is ASSERTED in
    `book/tools/lib/load.mjs` (`REQUIRED`) and `check:book` compares GENERATED figures: a last-bit change is a
    figure re-generation, which §11.2.9 says not to do while something else is being adjudicated.
  - **The probes' own copies (~26 in `poc/tools`, plus `game/test` and `engine/test/tools`)** — deliberate per
    §5 self-containment: a probe that imports the rule cannot be the independent judge of it.
  - **DEGREE moduli** (`poc/src/tam-xml.ts`, `book/tools/lib/squared-set.mjs`, `book/tools/make-diagrams.mjs`,
    `poc/tools/dosado-facing-fit.mjs`, and four in `engine/src`: `editor.ts:2684`, `formation-order.ts:160/163`,
    `alignment.ts:1123/1131`) — codomain `[0, 360)` or `[-180, 180)`, not `(-PI, PI]`; converting through radians
    would change their arithmetic for nothing. They are not this rule.

---

## P3 — VIRTUAL CALLS: a subwhole-set authoring placed on a whole-set board

- [ ] **39. VIRTUAL CALLS — the resolver, then the chooser, then the cache.** `[measured]` at `b5ebc93`;
  **THE RESOLVER, THE CHOOSER AND THE CACHE HAVE LANDED** (`a8d77a3` engine, `d3a30b3` cache, `b5ebc93` the book's
  report). The design record below is kept, because it is what the implementation is judged against.

  **WHAT LANDED.** `engine/src/sequencer/virtual-call.ts` — `placeVirtual`, `resolveVirtual`, `chooseVirtual` —
  `Sequencer.virtualCall`/`virtualCacheStats`, and `engine/test/virtual-call.mjs` in the LIGHT tier (45 harnesses
  now, still the same 8 red). MEASURED, full sweep (`node engine/test/virtual-call.mjs --all`): **58,650
  (formation, title) pairs in 45.9 s — 1,828 resolve to a single call, 85 resolve but are ambiguous, 56,737 refuse
  with a reason**, and **425 of the catalogue's 2,203 titles have a sub-eight-dancer authoring** (24 at two, 388 at
  four, 13 at six). The default run sweeps 20 of the 138 named formations in ~12 s and prints what it skipped.

  **THE CONSTRAINT IS LOAD-BEARING, NOT DECORATION.** With a namer that names the board but no end, the same call
  REFUSES (pinned); over the full sweep **4,264 placements were dropped for an unnamed end**. A REFLECTED placement
  is refused BY NAME (**526 pairs**) because the track would have to be mirrored about a line that is not the
  dancer's own axis — the format's limit, AGENTS §8 trap 18 — and the placed path is otherwise the source path
  verbatim, pinned move for move.

  **TWO REFUSALS THE CHOOSER MAKES ON PURPOSE, both MEASURED**: `Promenade` from a Static Square has two BODIES on
  one placement (`Promenade` vs `Static Square`, both at error 0), and `Single File Promenade` has two equally good
  placements (the boys' pair and the girls' pair) — naming the dancers settles the second, which is what
  `preferGroup` is for.

  **THE CACHE** is the matcher's third Map: keyed on the board's exact POSE SET + call + tolerance + placement
  preference (never the formation's NAME), storing REFUSALS as values, with `virtualCacheStats()`. Pinned: a square
  turned 90 degrees is still named `Static Square` and is a MISS with its own answer; a refusal is a hit;
  `registerFormation` clears it.

  **WHAT REMAINS, in the order to take it.**
  (a) **DRAWING a virtual call in the book — DONE, and the artefact moved.** `book/assets/player.js` fetches
      `../assets/calls/<file>` and loads by `(file, tamIndex)`, so a virtual call needed a generated `<tam>` file,
      an index field, a copy rule and a `--check`; all four landed, and the file now lives BESIDE ITS FAMILY as
      `<level>/<family>.virtual.xml` (`ms/circle.virtual.xml` next to `ms/circle.xml`) instead of in an
      `assets/virtual/` directory that was not a level — MEASURED, that directory cost three gates
      (`call-titles`, `poc/tools/corpus-key-probe.mjs`, `poc/tools/mirror-moves-probe.mjs`). The suffix is the
      exclusion (`packages/corpus/virtual.ts`: `filesOf` omits them, `virtualFilesOf` returns them; the two Vite
      globs filter their keys by the same predicate), each tam carries `parent_vid` — the call-variant id of the
      authoring it was placed FROM, from `VirtualCallInfo.sourceFid` — and `engine/test/corpus-inventory.mjs`
      pins the layout, the exclusion and the provenance by building every authoring of each call again.
      The build REPORTS resolvability (`b5ebc93`): of its 12 unresolved start queries **5 resolve as
      virtual calls, 3 are refused by the engine for a reason, 1 has no authoring at all and 3 name a start the
      engine has no board for**.
  (b) **APPLYING a virtual call to a sequencing path** (`legalNext`, the picker, the FSM) — deliberately untouched
      here, because it moves counts that `permissions`, `level-census` and the FSM asset pin.
  (c) **THE TWO BODIES OF `Promenade`** are an adjudication, not a bug: the corpus authors one that ends on
      `Static Square` and one that ends on `Promenade`, both placing on a squared set's slots at error 0.
  (d) **`Wrong Way Promenade 1/4` HAS NO AUTHORING** — the corpus publishes `Wrong Way Promenade`, `1/2` and `3/4`.
      The book's table asks for `1/4`; that is a corpus gap the table has been waiting on.
  (e) **`tamsOf` DOES NOT STRIP XML COMMENTS** (`book/tools/make-animations.mjs`), so in the four corpus files that
      carry a commented-out tam its index can disagree with the DOM parse `loadCall` uses; fixing it shifts
      `tamIndex` in the index and needs its own commit plus a regeneration (recorded in `b5ebc93`).

  **THE PROBLEM IT ANSWERS.** Part of the corpus is authored for PART of the set, so it cannot be applied
  from a whole-set board at all. MEASURED (`ms/promenade.xml`): `Promenade` from `Facing Couples Far` builds
  to **2 dancers**, `Promenade - Keep Walking` from `Two-Faced Lines LH` to **4**, and their start poses are
  literally slots of a square (`(-2,±1) (-2,±3)`). `deriveFormationMapping` REFUSES this by design
  ("cannot align 8 dancers to a 4-dancer core — refusing to pair them by array index"), which is why the
  book's 12 remaining start queries (item 8) cannot resolve: they ask a 2- or 4-dancer authoring to start
  from an 8-dancer formation.

  **THE OWNER'S DESIGN, as stated.** A cache stores previous resolution searches for calls with dancer
  subsets (< 8 dancers). It takes the subset CALL NAME and the board's current 8-DANCER FORMATION NAME and
  returns a "virtual" 8-dancer call variant that starts from the board's formation and carries the subset
  call's name.

  **THE OWNER'S CONSTRAINT, and it is the acceptance criterion this item is judged by.**
  > *All virtual 8-dancer variants must start AND end on a KNOWN formation.*

  Concretely, and this is stronger than it sounds: the START is the board's own formation, so it must be
  NAMED by the engine rather than assumed from the board we happened to be handed (AGENTS §8 trap 10:
  `knownFormation` will name a board that matches nothing, and on a tie the winner is library scan order);
  and the END board — the subset's own end poses placed on the same slots, with every other dancer holding —
  must also be a board a namer NAMES. A variant whose end is a scattered set of spots is NOT admissible,
  however correct its geometry, because nothing downstream can reason about where the call finishes.

  **WHAT ALREADY EXISTS AND MUST NOT BE DUPLICATED (AGENTS §11.4.4).**
  - `actives` on a `<tam>` is the corpus's own declaration of which dancers a partial authoring describes —
    28 shipped tams declare it (`engine/test/catalogue.mjs` pins the count and the values).
  - `symmetric`/`mirror` half-set tams expand 4 written dancers to 8 by an ANTIPODAL mirror. That is ONE
    embedding (pairs), not the general subset placement, so it is a special case of this idea and not a
    substitute for it.
  - `matchMemo` + `formationMatchCache` (`engine/src/sequencer/matcher.ts`) are already a
    "(board geometry + call) → variant" memo. The cache here belongs IN that mechanism.

  **THE THREE THINGS THAT WOULD MAKE IT WRONG, in the order they would bite.**
  1. **A formation NAME is not an identity.** It hides rotation and arrangement, and it can be ambiguous
     (traps 10 and 11). The cache key must be the quantised POSE SET of the whole board (positions,
     headings, genders) plus the call plus the selector — a name-keyed cache returns a variant for a board
     it never resolved, silently.
  2. **The answer is a SET, not one variant.** Four dancers in an eight-dancer square is `C(8,4) = 70` slot
     sets × the rotations/reflections congruent with the authoring, and on a symmetric board several are
     equally good — the same ambiguity `deriveFormationMapping` needed `preferGender` for. So: the RESOLVER
     returns candidate embeddings each with a validity verdict; a CHOOSER (declared `actives`, arrangement
     preference, the panel's explicit correction) collapses them; only then is anything cacheable, keyed by
     the request INCLUDING the selector.
  3. **Refusals must be cached too**, or every miss re-runs the expensive sweep forever. The engine's
     contract is that a refusal is a VALUE (§11.3), so "no embedding" is a cacheable answer with a reason.

  **BUILD ORDER (followed): resolver → chooser → cache.** Cache-first freezes an interface before its semantics
  exist, which is how a cache ends up fast and wrong — and the order is why the first unit could be judged with
  nothing memoised.

  **A VIRTUAL VARIANT IS INVENTED GEOMETRY AND MUST SAY SO.** Every derivable fact in this tree comes from
  the corpus; a synthesised variant is the exception, so it must be MARKED the way `phantom` marks an
  unknown identity, and no census may count it — `shape-census`, the figure counts and `verify:figures` are
  cited in the docs and would otherwise start counting boards nobody authored.

  **ACCEPTANCE CRITERIA (each one gateable, none of them "looks right").**
  1. A probe sweeps every subwhole-set authoring × every whole-set named formation, and reports resolved /
     refused WITH denominators — no `0 of 0`.
  2. For every accepted variant: the start board is named by the engine's namer, AND the end board is named
     by it. **Refuse rather than return an unnamed end.**
  3. The judge is INDEPENDENT of the resolver (§11.2.3): the namer, not the resolver's own alignment.
  4. A synthesised variant is distinguishable from an authored one in the type, and a census that counts
     authored tams is unchanged by it.
  5. The cache is keyed on the board's pose set, returns a set of candidates or a recorded refusal, and a
     revert of the chooser turns a check red.

  **MEASURED FIRST, AND THE ANSWER CHANGED THE PLAN.** The three questions item 39 asked before any code:
  (a) how many pairs embed at all — **1,828 of 58,650** over the full sweep, and 426 of 8,500 on the sampled one, so
  it is a real minority rather than a handful OR a majority; (b) the ambiguity rate — **85 of 1,913 resolved
  pairs**, which is why the chooser's refusals are affordable; (c) the cost of one sweep — **45.9 s** full, ~12 s
  sampled, which is why the harness samples in `light` and prints what it skipped. The book's 12 unresolved queries
  were the cheapest first consumer and are reported by `b5ebc93`.

  **ACCEPTANCE, as it stands.** 1 (sweep with denominators) done, both tiers. 2 (start and end named) done, judged by
  `knownFormation` called from the harness. 3 (independent judge) done. 4 (marker) done — `CallBundle.virtual`, and
  resolving registers nothing. 5 (cache keyed on the pose set, refusals recorded, a chooser revert red) done: the
  cache section pins the pose-set key, the cached refusal and the cleared cache, and the chooser's two refusals are
  pinned by their own checks.

  **RELATED, AND THEY ARE NOT THE SAME QUESTION.** Item 26 (active-set tracking, the Ocean Wave Rule) is the
  layer that says WHICH dancers are acting; that is what a chooser should read rather than infer. Item 24
  (canonical identity) is the blocker for a stable pose-set key — the same reason a name is not an identity.
  Both are upstream of a good cache and neither is required for a first resolver.

- [ ] **41. THE TWO DISJOINT-COPY SEARCHES DISAGREE ABOUT WHO DANCES WHAT, and the numbers are now pinned.**
  `[measured]` by `engine/test/disjoint-copies.mjs` (LIGHT, ~4 s: 20 of the 138 named formations x 59 of the 409
  sub-eight titles, both every 7th and printed). MEASURED: **1140 (board, title) pairs — 954 both-refuse, 43 agree,
  76 are WHOLE-BOARD readings (a different question: counted, not compared), and 67 DISAGREE**, digest
  `87de7fd0acdeaa49`. The 67 split by the dimension they come from, and the split is the finding:
  - **43 / constraint** — the resolver found placements and dropped every one because its END was unnamed. That is
    item 39's own start-and-end-named constraint working; the picker has no such test, so it applies where the
    resolver refuses. BY DESIGN, and the cost of that constraint is now a number.
  - **18 / B-searches-nothing** — no placement at all, where `partitionPartial` found a group. A real difference in
    the two searches at the SAME tolerance (both paths run at `DEFAULT_MATCH_MAX`, because `applyToBoard` applies
    with `rebase = true`), and the class a merge would have to reconcile first. Witness: `3 and 1 lines #1` /
    `Chase the Tag`, A `1x4` covering `{1,2,5,6}`, B nothing.
  - **4 / partial-copies** — the resolver's partial reading is ONE copy BY CONSTRUCTION (`virtual-call.ts`), while
    `partitionPartial` packs as many groups as fit. Witness: `3 and 1 lines #1` / `Single Circle Left 1/2`,
    A `{1,6}|{2,5}` (two copies), B `{1,6}` (one). BY DESIGN.
  - **2 / search** — **THE ROW THIS ITEM EXISTS FOR**: both place ONE group of four, covering four dancers, and each
    picks a DIFFERENT four. Witness: `Quarter Tag` / `Left Square Thru 3 1/2`, A `{2,3,6,7}`, B `{0,1,4,5}`. Two
    search orders breaking a symmetric tie differently — the same law as `AGENTS.md` §8 trap 30 ("who stands where
    is data"), one level up: WHO DANCES WHAT.
  **THE DECISION THIS ENABLES, and it is the owner's.** Merging the two searches moves at least 24 of 1140 pairs
  even after the two by-design classes are set aside, so it cannot ride in as a refactor. Cheapest first:
  (a) keep both searches and leave this harness as the record, aligning nothing; (b) align only the
  `B-searches-nothing` class — 18 pairs, and it is where one search genuinely misses a group the other finds;
  (c) one search, which moves all 67 and needs `parallel-calls.mjs`, `virtual-call.mjs` and
  `poc/tools/end-pair-probe.mjs` (the 2278-pair pairing census) re-measured. **The next unit is the owner's choice
  between (a), (b) and (c)** — do not merge on the strength of this item alone.

