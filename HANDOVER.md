# Handover

This file is generated at the end of a chat session so that a new chat session can pick up where the
other left off. There is no need to maintain it as it will be completely regenerated when a new session
is needed.

**The orientation document**: what the repo is, how to work in it, what has already been decided and
what has already bitten. It deliberately carries **no scoreboard and no work queue** — those live in
`PLAN.md`, and copying them here is exactly how an earlier revision of this file rotted. Numbers printed
here are facts about the **authorities** or about a **closed** measurement, and every one names the
command that produces it.

**Read in this order:**

1. `README.md` — the workspace in five lines.
2. **this file** — §1 the map, §3 the working rules, §4 the two live threads, §5 decisions, §6 traps.
3. `PLAN.md` — §2 the scoreboard, §3 what is **refuted**, §5 what is **blocked**, §6 the recommended
   order. This is the authority for state and remaining work.
4. `square-dancing.md` — the spec (§1–§8) and §9 the open-items log. **§7.1.1 is new this session** and
   is the vocabulary the shape work is built on.
5. `engine/test/fixtures/README.md` — where each oracle comes from and how to re-fetch it.

---

## 1. What the repo is

| Path | What it is |
|---|---|
| `engine/` | **The thing under test.** The TypeScript library (`dancing-squared-engine`). `src/sequencer/` holds the model: matcher, applicator, legality, solver, analyser, FSM, alignment. |
| `poc/` | Three.js debug app. `src/sequencer-ui.ts` the sequencer panel, `src/editor-ui.ts` the call editor, `src/fsm-view.ts` the FSM view, `src/scene.ts` the dancers, `src/assets/` the **canonical tamination XML**. |
| `poc-teacher/` | Teacher / session tracker app. |
| `poc-matrix/` | Earlier matrix/graph experiments. **No `verify` script**; not in any gate. |
| `features/` | 23 Gherkin specs, gated by `engine/test/bind-audit.mjs`. |
| `modules/`, `sequences/` | The ceder corpus, tracked; `scripts/translate-sequences.mjs` regenerates the former from the latter. |
| `docs/` | **Untracked.** The CALLERLAB definitions PDF and downloaded pages — an oracle that lives outside git. |
| `taminations-flutter/` | **Reference only.** Data and code to *read*, never to port. It is the authority for the corpus's own conventions (`asymmetric`, `geometryType`, the `Face` family). |
| `PLAN.md`, `HANDOVER.md` | This pair. `PLAN.md` is the state; this file is the orientation. |

### The engine files the shape work touches

| File | What lives there |
|---|---|
| `types.ts` | `Symmetry = 1 | 2` with the full rule; `CallBundle.symmetry`; `CallBundle.actives` (parsed, still read by nobody). |
| `convert.ts` | `parseSymmetry`, `TamRaw.symmetry`, `buildCallImpl`'s completion (`mirrorToFull`), `hasAntipode`, `materialiseFull`, the two path-pairing branches. |
| `editor.ts` | `callToXml` (writes every dancer out, so it declares `asymmetric="true"` in EMBED mode only), `synthesizeSetup`/`synthesizeSetupChain` (symmetry 1). |
| `sequencer/library.ts` | `toWholeSet` (4→8 only), the constructor that keeps only declared set size 8, `registerFormation`, `getUniqueFormations`/`getNamedFormations`. |
| `sequencer/matcher.ts` | `findMatchingVariant` (rejects `m.subset`, so a sub-8 variant is never a whole-board apply), `knownFormation`, `recognize`, `PAIR_GENDER_CALLS`, `roleUniformMotions`. |
| `sequencer/applicator.ts` | `applyToBoard`'s fallback order, `applySelected`, `parallelApply`, **`partition`** (first tiling only) and **`partitionPartial`**, `ApplyResult.parallel`. |
| `sequencer/legality.ts` | `legalWithResults` — admits a call only when `knownFormation(result) !== null`; `parallelLegalCalls`. |
| `sequencer/sequencer.ts` | `buildFsmTable` (state set, `@embed#N`, `enumerate`), `boardForFormation`/`boardForSetup`, `transitionTable`. |
| `sequencer/fsm-table.ts` | `FsmTableEdge = {call, endFormation, orientationDelta, source}`; **identity is the CALL alone**; `FSM_TABLE_SCHEMA_VERSION = 1`. |

## 2. Where it stands

**There is no scoreboard here — it is `PLAN.md` §2.** What follows was **re-measured this session**,
because three of the previous revision's entries were wrong:

| Entry point | What it runs | State |
|---|---|---|
| `npm run build --prefix engine` | `tsc` | clean |
| `npm run verify:light --prefix engine` | `tsc` then the **13** fast harnesses | green (46–70 s over four runs) |
| `npm run verify --prefix engine` | `tsc` then **all 25** — the pre-commit gate | **NOT RUN this session.** ~15 min; run it in the background before landing engine behaviour, and never while rebuilding `dist` |
| `npm run verify:figures --prefix engine` | the target harness (`all8-figures`) | **RED BY DESIGN** — the finish line, not a gate |
| `npm run verify --prefix poc` | `poc/verify.cjs` | **GREEN — this is a CHANGE.** It was RED on 3 `Pass Thru` checks for months; see §4.1 |
| `npm run verify:probes --prefix poc` | 27 POC probes | green, 0 failed (~9 min, dominated by `call-formations-probe` at 447 s) |
| `npx tsc -p poc --noEmit` | the POC typecheck | **clean (exit 0)** — the `editor-ui.ts` TS2739 error is gone |
| `node engine/test/shape-census.mjs` | the authoring census | green, 3.5 s (in `light`) |
| `node engine/test/reading-census.mjs` | the reading census | green, 30.4 s (in `all` only) |
| `node poc/scripts/build-fsm-asset.mjs` | regenerate `poc/src/assets/fsm-ms.json` | works under plain node (Node 24 strips TS), 36.7 s, **155 states / 2205 edges** |

**The two `verify`s are different commands.** `npm run verify` at the root is the **POC** check;
`npm run verify --prefix engine` is the engine gate. The root one is green now, so it is usable as a
gate again — do not let it rot back.

## 3. How to work here

```powershell
npm run build --prefix engine                 # tsc - run from the REPO ROOT
npm run verify:light --prefix engine          # the FAST subset: use this while iterating
npm run verify --prefix engine                # the whole gate suite: PRE-COMMIT, RUN IN BACKGROUND
node engine/test/shape-census.mjs             # the authoring convention (3.5s)
node engine/test/reading-census.mjs           # what reading each application got (30s)
node engine/test/editor.mjs                   # or any single harness, from the repo root
node poc/verify.cjs                           # the POC, headlessly - GREEN
npm run verify:probes --prefix poc            # the 27 POC probes (~9 min)
node poc/scripts/build-fsm-asset.mjs          # regenerate the FSM asset (see §4.2 before running)
```

### Two tiers, one list; plus a third that is a target

Every harness is **one entry** in `engine/test/verify-suite.mjs` with the tier as a field. **`light` is a
subset, not a weaker check.**

- **light (13):** `gender-audit`, `catalogue`, **`shape-census`**, `verify`, `sequencer`, `mainstream`,
  `matrix`, `matrix-getout`, `editor`, `features`, `bind-audit`, `alignment`, `all8-formation-map`.
- **all only (12):** `anim-convergence`, **`reading-census`**, `promenade`, `getout-conformance`,
  `all8-format`, `getout-behaviour`, `getout-convention`, `selection`, `behaviour-audit`,
  `alignment-boards`, plus `determinism-audit` and `callerlab-diff` (reached through the `sub` field).
- **target (1):** `all8-figures` — excluded from both tiers on purpose.

### The POC *can* be checked here

`node poc/verify.cjs` runs against the engine's built `dist` and is **green**. The Vite app cannot start
(`spawn EPERM`), and the **UI can only be observed with the run escalated out of the sandbox**:

- **The network works, but not through Schannel.** `Invoke-WebRequest`/`curl.exe` fail with
  `SEC_E_NO_CREDENTIALS`; Node is fine — test connectivity with Node, never a Schannel client.
- **`npm i --no-save playwright` needs `--cache <repo>/.npm-cache`** (gitignored) or it is rejected.
- **Chromium cannot start in either confined mode.** Mojo IPC uses named pipes and both modes block
  them: `mojo\platform_channel.cc:108 Check failed`, crashpad `OpenProcess: Access is denied`.
- With `danger-full-access` it all works: `PLAYWRIGHT_BROWSERS_PATH=<repo>/.pw-browsers`,
  `npx playwright install chromium`, serve `poc/dist` with a few lines of `node:http` (**not**
  `vite preview`, which spawns esbuild), `chromium.launch({args:['--no-sandbox']})`, screenshot, read
  the PNG back. Without the escalation, **say the UI was not observed** rather than implying it was.

The case for that trouble: the FSM Level filter was built, laid out and **invisible behind the HUD for
three commits** because two boxes overlapped. A typecheck and a board measurement cannot see that.

### Working rules that have paid off repeatedly

- **Measure, do not reason.** Every claim in `PLAN.md` and `square-dancing.md` §9.1 is a number from a
  checked-in harness or a throwaway probe.
- **Test an attribution by disabling the suspect**, not by reasoning about it again.
- **Measure BEFORE and AFTER**, and prefer a **reverted** fix to a shipped half-fix.
- **Correct the docs when the code disproves them** — including your own earlier commit message. §4.3 is
  a worked example from this session; the durable record is the harness's own header comment, because
  commit messages are immutable.
- **Gate it in the same commit** (or say why the gate has to land in the next one).
- **Write probes as `.mjs` files**, never `node -e` (PowerShell quoting mangles them).
- **Commit per logical piece** with a multi-line message via `git commit -F`.
- **Beware commit ordering**: a commit that adds a gate whose fix is in the NEXT commit is not green
  standalone. That happened this session and was rewound; check the pair before pushing.
- **Never rebuild `engine/dist` while a suite is running.**
- `docs/`, `poc/pnpm-lock.yaml`, `poc/pnpm-workspace.yaml` stay **untracked**.
- `HANDOVER.md` is **not** updated during work — only when a session ends and the user asks.

---

## 4. The two live threads

### 4.1 The shape / symmetry thread (this session's main thread)

**The problem it exists for.** A `<formation>` or a `<tam>`'s inline formation writes **half** the set:
the written dancers plus the same dancers turned 180° about the origin. A shape that is already complete
says so with `asymmetric="true"` (declared on `<tam>` in `tamination.dtd`; the reference implements it as
`geometry.dart`'s `SQUARE = 2` / `ASYMMETRIC = 1`). Nothing in the engine *named* that rule — it
re-derived it geometrically as `hasAntipode`, which agrees with the declaration on every shipped tam but
one.

**The vocabulary now exists** — `Symmetry` in `types.ts` and `square-dancing.md` §7.1.1:

- **three sizes**: *written* (what the file lists), *declared set* (`written × symmetry`), *board*;
- **a built bundle is `symmetry` copies of a `written`-dancer UNIT**;
- **a two-dancer shape with two genders is written with BOTH dancers and `asymmetric="true"`** — the only
  way to say it, because a completed copy carries the written dancer's gender, so a lone `boy` completes
  to a pair of boys (measured: the 4 shipped one-dancer authorings all build `bb`);
- `formations.xml` **cannot** declare it (its DTD element takes `name` only), so every registry entry is
  a half by construction.

**Measured and pinned** (`engine/test/shape-census.mjs`, 3.5 s, in `light`): of 5963 shipped tams, 5961
build; **5942 build at written × 2, 19 declare `asymmetric` and take the written shape as it stands, and
ZERO build against their declaration** (it was one — `Allemande Left` from `O Trade By`, which now
carries the attribute). The registry keeps **210 of 273** declared shapes and every kept one declares
eight; the **63 dropped** are 51 written-2, 1 written-3 and 11 written-6, including `Facing Couples`
(written **2**, declaring **4**) — the formation `Star Thru` is authored against by name. Every shipped
tam authors **one path per written dancer**; the other two pairing branches in `buildCallImpl` are
reachable only from the editor.

**A two-dancer pair is not only expressible, it is APPLICABLE** — and the route is forced. A sub-8 shape
can never match an 8-dancer board (a smaller setup is a subset match, and `findMatchingVariant` rejects
`m.subset` by construction), so the only route is `parallelApply`: tile the board into 2-dancer boxes and
run the pair in each. Measured: four facing pairs = four copies moving all eight; a squared set, which
has no such pair, is **refused** rather than force-fitted.

**Commits, in order:**

| Commit | What landed |
|---|---|
| `e041dae` | Carry `Symmetry` from `asymmetric` (no behaviour change); add `shape-census.mjs`; `square-dancing.md` §7.1.1. |
| `3437e97` | The **declaration decides** the completion; `hasAntipode` becomes a tolerance for a forgotten attribute; the one disagreeing tam gains the attribute; the census gains a synthetic two-way direction gate. |
| `058d4da` | `callToXml` declares the whole set it wrote out — **fixes a real defect**: an exported 8-dancer set whose formation has no antipodal pair re-read through the **sequencer's** registration path (`loadVariants`, `mirror: true`) as **16 dancers**. `editor.mjs` had that pinned as a footgun (asserting the doubled size), so the gate pinned the defect; it now pins the rule and still asserts the stripped shape doubles. |
| `6ede27a` | The two-dancer pair gate: held at 2 with both genders, applied to every copy, refused where no pair exists. |
| `9ac3028` | `poc/verify.cjs` selects the `Pass Thru` variant **by name, not by index** — see the trap in §6.1. `poc verify` has been RED on these three checks for months and is now green. |

### 4.2 The FSM reading thread (Stage 0 done; the rest is the next work)

**The problem.** A call applied to eight dancers is not always performed by everyone. `parallelApply` can
tile the board into copies of a variant smaller than a board, and when only some boxes match it falls
back to `partitionPartial` and **leaves the rest standing**. So every legal application has a READING —
`whole` / full-tiling / partial — and **the FSM stores none of it**: an edge is `{call, endFormation}`
and its identity is the **call alone**.

**Stage 0 is committed** (`reading-census.mjs`, `cd59222` + `2175a69`; 30 s, in `all` only). Measured
over 133 named FSM states × 273 ms calls = **4416 legal applications**:

- `whole` 2014, `full-tiling` 1276, **`partial` 1126 over 89 boards**;
- **2169 (49%) are DROPPED** — legal, but the end board is unnamed, and `legalWithResults` admits a call
  only when `knownFormation(result) !== null`;
- **1048 of those are sub-8 variants covering ALL EIGHT dancers** — the user's requirement 1, recorded
  as nothing at all rather than as four edges;
- exactly **one reading per (state, call)** — the invariant a multi-reading FSM has to break;
- **107 of 273 titles are multi-arity** (variants at >1 built size) — the pool for a MIXED reading.

**Two findings that block the obvious next move:**

1. **The stored FSM asset is stale, and nothing could have noticed.** `poc/scripts/build-fsm-asset.mjs`
   exists but is wired into **no npm script and no harness**. Rebuilding gives the **same 155 states**
   but **2205 edges against the stored 1961**, with **76 edges landing on a different end**, 511 admitted
   applications with no edge, and 188 stored edges not reproduced.
2. **And regenerating it would freeze a naming artefact — the `Face In`/`Face Out` answer.** Resolved in
   `2175a69` and worth reading before touching it:
   - **`Face In` is CORRECT.** CALLERLAB (the asset's own `face.md`): *"each individual turns 90 degrees,
     in place, toward the center"*; the turn direction matches `face.dart`; the result from a squared set
     is **four exact mini-waves** (measured: each wall's pair 2.00 apart and facing each other). A squared
     set does not face the *exact* centre (~18° off, dancers stand on walls, not axes), so a quarter turn
     toward it overshoots to tangential. The reference throws only when the offset is *exactly* zero,
     which a squared set never is.
   - **What it is CALLED is the defect.** That board matches 11 formations inside the naming tolerance
     (`KNOWN_FORMATION_MAX 6.0` + margin 1.5) with a best error of **3.1416 — π — and FOUR tie exactly at
     π**: `O In`, `O Trade By`, `O Eight Chain Thru`, `O Out`. `knownFormation` returns the **first tied
     candidate in library scan order**, so the name is an artefact of the library's contents and order —
     which is exactly why those 76 edges moved. `recognize` (curated, tighter) returns **null** for the
     same board, so the two namers already disagree about whether it is named at all.

**The ordering constraint, which is the thing to get right next.** The fix belongs in the **namer**: a
board that far from everything should be refused rather than named after whichever candidate was scanned
first. The recorded note on `KNOWN_FORMATION_MAX` says the tolerance that *actually* binds is
`maxError / 12` — about **0.5 per dancer** — while the final gate uses the raw **6.0**, which is what
lets a π-off board through. **But it cannot land alone:** `legalCalls` admits a call only when
`knownFormation(result) !== null`, so refusing more names **drops more applications from the FSM**. It
must land in the same change as admitting unnameable ends:

1. `knownFormation` refuses a π-off / tied best match;
2. `legalWithResults` admits a legal application with an **unnamed** end;
3. `buildFsmTable` closes over those ends as new states (the `@embed#N` mechanism exists for **sources**;
   the state set is currently fixed *before* enumeration, so this needs a closure pass);
4. then regenerate `fsm-ms.json`, pin the counts, and **add the gate that fails when the asset no longer
   matches a rebuild** — that gate is what was missing.

**Design decisions already taken for the later stages** (from the approved plan): nodes stay
**geometry-keyed** (the multiplier comes from distinct successor geometries, not from reading-keyed
nodes) unless Step 1's measurement finds coincident-geometry readings with divergent successors; the
**active set stays out of scope** (Phase C item 2); a **cap with reported truncation** is load-bearing,
since Bell(8) = 4140 bounds the groupings; and mixed-arity findings are **reported before they are
admitted**, because this mechanism multiplies the one class of reading the repo has already measured as
*wrong* (`Sweep 1/4`'s full tiling produced four dancers on two spots, which is why `partition` enforces
couple coherence).

### 4.3 The animation / board-identity thread (still open, untouched this session)

Five items, unchanged and still carrying their measurements:

1. **A full `Promenade` from a squared set does not move** — 8 beats, zero net travel, because the ring
   path is derived from start→end and a circuit ends where it began. The travel is a property of the
   CALL. Fix in the ring branch.
2. **A ring's couples are the FACING pairs, not the stored `couple` labels.** 7046's end ring is an Alamo
   ring (boys outside r 3.45, girls inside r 2.93, facing at 2.3 units); the stored labels pair dancers
   180° apart with the same heading, so `promenadeHome` sends each couple in **opposite directions**.
3. **`L1o`'s identity question** — `CANONICAL_INDEX.L[1].o = 0` is the one entry not measured off a
   diagram. Upstream of FASR/FSM: decide it with a source or record it as a choice again.
4. **The coincident-band regression from the selection fix** (73 → 103 modules with a pair inside 0.1).
   The straight-line hypothesis was **disproved**; the remaining candidate (a pinned/unmoved dancer) is
   still a hypothesis, not a measurement.
5. **`anim-convergence` still pins 7 single-call jumps** (worst 0.1476). A residual **bounded by
   magnitude** (~0.5 units) would fix them without the 6-unit drags that got the blanket residual
   reverted, and without the collision cost.

---

## 5. Decisions already made — do not relitigate without new evidence

**The caller convention.** A get-out succeeds by reaching a state a standard finish closes, not by
sitting on the literal home board.

**Index independence.** Board, call and formation indexes carry no correspondence; matching derives its
mapping from coordinates and rotation alone.

**Identity is data.** Home couple and gender are declared, or `UNKNOWN_COUPLE`/phantom — never invented
from array position. (Known violation: `boardFromMatchables` stamps `id: i + 1` for non-home-like
geometry, so 129 of the 134 named formations carry no identity.)

**The dancer ARRAY ORDER is the renderer's binding, not decoration.** Any component that rebuilds a board
must return it in the order it was given (`reorderLike`).

**THE NEW ONES (this session):**

- **A written shape is half the set unless it says otherwise.** `written × symmetry` is the declared set;
  the declaration is the data's, not a geometric guess. Do not add a second inference.
- **A shape's written size is a UNIT size, not a count.** A built bundle is `symmetry` copies of it. This
  is what makes a two-dancer call expressible, and it is why `written == 8` does not mean "the whole set"
  for a tam that forgot its attribute (it declares 16).
- **A two-dancer pair is authored with both dancers and `asymmetric="true"`.** Never by completing a
  one-dancer authoring when the two dancers differ in gender — the completion copies the gender.
- **`formations.xml` stays unable to declare symmetry.** Widening its DTD would diverge from upstream for
  no measured gain; the two-dancer case lives in a `<tam>`'s inline formation and in
  `registerFormation`.
- **An exported tam is a whole set, so it declares it — in EMBED mode only.** In reference mode the
  dancers come from the named formation, and `asymmetric="true"` beside a 2-written name would be a lie.
- **Do not regenerate a generated artefact while the thing it encodes is being adjudicated.** The FSM
  asset stays stale until the namer is settled (§4.2).
- **A board that matches nothing must be refused, not named.** A tied best match is not an identity.

**Unchanged:** FASROO is display-only; the strict sequence/relationship filter stays strict; two
tolerances on purpose (`DEFAULT_MATCH_MAX = 1.5` interactive, `SEARCH_MATCH_MAX = 6.0` search, and a
search result must be re-validated interactively); a call may be geometry-derived (a pivot always legal,
a resolve only when its precondition holds and it must REFUSE with a reason); **All8 is the authority
over Taminations for notation and FASR, CALLERLAB over All8 for definitions**; **an instrument's silence
is the bug** (a zero must say whether it is a coverage gap or an unnameable state); **a corpus count
improving is not evidence a change is right**; **a fix that trades a visible defect for a hidden one is
not a fix**; `[S]`'s setup code is `S1` with no relationship component; the `16com` second source stays
undecoded and its authority is bounded (all 40,320 permutations searched, none survive).

---

## 6. Traps that have already bitten

1. **A position into an authored list is not an identity.** `poc/verify.cjs` hard-coded
   `tamIndex: 1` into `ms/pass_thru.xml`; a hand-added `from="Facing Couples"` tam was **inserted** at
   index 1, silently re-pointing three checks onto a two-dancer pair. They failed saying *"Pass Thru half
   has 2 dancers"* — true of the tam loaded, wrong about the one meant — and were read as an engine
   defect for months. Select by `from`/`formation`.
2. **A gate can pin a DEFECT.** `editor.mjs` asserted the 16-dancer doubling as the expected behaviour
   ("the editor must export/import with mirror=false"), so the fix went red. When a gate goes red on a
   fix, read the gate before assuming the fix is wrong.
3. **`parallel.groups` holds dancer OBJECTS, not ids.** Comparing them against `d.id` made "dancers left
   standing" read 8/8 on every board and invented **18 false "declined tiling" cases**; re-measured
   against the engine's own coupling rule it was **zero**. Same class as trap 10 of the old list.
4. **A generated artefact with no gate goes stale silently.** The FSM asset is 1961 edges where the
   engine now produces 2205, and 76 names have moved. When you find one, add the gate that would have
   caught it.
5. **`knownFormation` returns a name for a board that matches nothing**, and on a tie the winner is
   **library scan order** — so an FSM edge's `endFormation` is not stable under unrelated library
   changes. `recognize` refuses the same board, so the two namers disagree.
6. **`npm run build --prefix engine` from inside `engine/` resolves to `engine/engine`** and fails with
   ENOENT. Pass the repo root as the workdir.
7. **A census that FAILS for a knowingly-stale artefact trains people to skip it.** Report the
   divergence, keep the rules about the engine.
8. **There are two `verify` commands**, and the root one is the POC. Both are green now; the engine gate
   is `npm run verify --prefix engine`.
9. **Register calls by title, not file basename** — or `Pass Thru` never registers. Note that
   `behaviour-audit.mjs` builds its catalogue by FILENAME SLUG, so a title-keyed witness silently refuses
   there; a gate that uses a harness's own catalogue measures the harness.
10. **`Sequencer.getout()`/`fixIt()` search the Sequencer's OWN board** — `setBoard(board)` first. The
    failure is SILENT.
11. **`boardSig` is positions-only**; anything facing-dependent must key on the full pose.
12. **`boardFromMatchables` uses the array index as dancer id** for non-home-like geometry.
13. **`snapMaxError = 1.0` bounds the MEAN match error, not a dancer.**
14. **A module's LAST flat step is often charged 0 beats** — identify the owner as the last step whose own
    beats are non-zero.
15. **`replayWalk` stores each step's `before` board**, and a hand-rolled prefix replay can differ from
    it.
16. **`boardForAlignment` returns `boards[0]`**; production goes through `boardForFasrCode`.
17. **Under the sandbox a Node child spawned with piped stdio fails with EPERM** — which is why
    `verify-suite.mjs` uses `stdio: 'inherit'`. It is **not** why the POC is unrunnable.
18. **PowerShell truncation looks like a failure**: `... | Select-Object -First N` can make a successful
    command report `[exit code: 1]`.
19. **The `write`/`edit` tools intermittently fail** with `ReplaceFileW EIO (Win32 32)`; retrying the
    identical edit succeeds. `git checkout -- <file>` restores CRLF, so a multi-line literal match must
    normalise line endings first or it silently matches nothing.

---

## 7. If you have one afternoon

In the order the evidence supports:

1. **Settle the namer and let an unnamed end be an end** (§4.2) — one change, in this order:
   `knownFormation` refuses a π-off/tied best match; `legalWithResults` admits an unnameable end;
   `buildFsmTable` closes over those ends as states; `poc/src/fsm-view.ts` and `main.ts`'s table type
   render them. **Measure the blast radius both ways** (legal-call counts per state, FSM edge count, and
   a corpus figure count) because `knownFormation` feeds `legalCalls`, the sequence analyser and the
   solver.
2. **Then regenerate `poc/src/assets/fsm-ms.json`** and pin the state/edge counts, **with the staleness
   gate** (a harness that rebuilds the table and fails when the stored asset disagrees). Without that
   gate the asset will go stale again.
3. **Then the mixed-arity enumeration** (`partitionsFor`: group sizes drawn only from the call's own
   variants, couple coherence reused rather than re-derived, a reported cap) — wired to a **reporter
   first**, not to the FSM. Each new reading has to be justified against a witness before it is admitted,
   because this is the mechanism that multiplies the readings already measured as wrong once.
4. **Only then** the FSM schema change (`(call, reading)` edge identity, schema v2, the five identity
   sites: `FsmTable.build`, `FsmTable.merge`, `FsmStore`, `fsm-view.ts`, the export snapshot).
5. **The other thread's highest-value item** is the promenade ring travel (§4.3 item 1) — bounded, has a
   primitive gate, and it is the difference between a Promenade that dances and one that stands still.

Read `PLAN.md` §3 (refuted) **before** starting any of these. Several attractive-looking next steps —
raising the matching tolerance, a scale-invariant matcher, filtering `sequencer="no"` variants, a `[B]`
promenade "fix" — are in that table with the measurement that killed them.
