# Handover

**The orientation document**: what the repo is, how to work in it, what has already been decided and
what has already bitten. It deliberately carries **no scoreboard and no work queue** — those live in
`PLAN.md`, and copying them here is exactly how the previous revision of this file rotted. That
revision still described the get-out conformance workstream at step 5 and listed `Trade`/`Run`
variant selection, the decoder table and the quadratic search as "remaining"; all three are long
finished, and the FASR/Setup thread (its successor) had not happened yet. Numbers printed here are
facts about the **authorities** (how many boards a code admits, how many diagrams exist) rather than
moving metrics, and every one of them names the command that produces it.

**Read in this order:**

1. `README.md` — the workspace in five lines.
2. **this file** — §1 the map, §3 the working rules, §4 the live workstream, §5 decisions, §6 traps.
3. `PLAN.md` — §2 the scoreboard, §3 what is **refuted**, §5 what is **blocked**, §6 the
   **recommended order**. This is the authority for state and remaining work.
4. `square-dancing.md` §9.1 — the chronological log; every claim in it is a number from a harness,
   including the ones that disproved an earlier claim in the same file.
5. `engine/test/fixtures/README.md` — where each oracle comes from and how to re-fetch it.

---

## 1. What the repo is

| Path | What it is |
|---|---|
| `engine/` | **The thing under test.** The TypeScript library (`dancing-squared-engine`). `src/sequencer/` holds the model: matcher, applicator, legality, solver, analyser, FSM, alignment. |
| `poc/` | Three.js debug app. `src/sequencer-ui.ts` is the sequencer panel (including the **All8** import/export row), `src/editor-ui.ts` the call editor, `src/fsm-view.ts` the FSM view, `src/assets/` the **canonical tamination XML**, `src/modules.ts` the coded starts. |
| `poc-teacher/` | Teacher / session tracker app (PRD §15). `npm run verify --prefix poc-teacher` **passes**. |
| `poc-matrix/` | Earlier matrix/graph experiments (a getout-path cache, `graph.mjs`). **No `verify` script**; not in any gate. |
| `features/` | 23 Gherkin specs, gated by `engine/test/bind-audit.mjs` (every `@bind:` tag must resolve). |
| `modules/` | **The ceder corpus, tracked.** 1652 modules — 911 `static_set`, 417 `zero_line`, 324 `zero_box` — as `modules/<label>/<end>/<id>.json`. `poc/src/ceder-modules.ts` globs it at build time. |
| `sequences/` | The same corpus in its raw pre-translation shape; `scripts/translate-sequences.mjs` regenerates `modules/` from it. |
| `docs/` | **Untracked.** Holds the CALLERLAB Mainstream definitions PDF and downloaded CALLERLAB pages — i.e. one of the oracles lives outside git. |
| `callerlab-ms.txt` | **Gitignored**, generated from that PDF by `test/tools/extract-pdf-text.mjs`. Regenerate on demand; not ours to redistribute. |
| `square-dancing.md` | The spec (§1–§8) plus §9 the open-items log. |
| `prd.md` | The requirements/PRD. Decisions live in §9.1 (modules), §9.5 (matching contract, §9.5.4 geometry-derived calls), §9.6 (All8 import/export) and §14 (open decisions). |
| `taminations-flutter/` | **Reference only.** Data and code to *read*, never to port. |
| `PLAN.md`, `HANDOVER.md` | This pair. `PLAN.md` is large and is the state; this file is the orientation. |

`taminations.md` at the root is a scratch file — leave it alone.

### The engine files you will actually touch

| File | What lives there |
|---|---|
| `sequencer/alignment.ts` | The FASR model: `FORMATION_LETTER`, `ARRANGEMENT_TABLES` (row = string with `EMPTY_CELL = '.'` for a hole), `boardsForAlignment`, `canonicalBoard` + `CANONICAL_INDEX`, the setup registry (`setupForFormation`, `compliesWithSetup`), `coupleToSpot` and its operations, `fasrooOf`. |
| `sequencer/constants.ts` | `CALL_SYNONYMS` — the All8 → engine name bridge. |
| `sequencer/coded-moves.ts` | Geometry-derived calls and their preconditions. |
| `sequencer/trade-run.ts`, `fold.ts`, `swing-thru.ts`, `fan-the-top.ts`, `sweep.ts`, `promenade.ts` | The derived rules, one per family. |
| `sequencer/match.ts`, `matcher.ts`, `applicator.ts`, `selection.ts`, `grouping.ts` | Matching, applying, subset/parallel readings. `applicator.ts` knows **nothing** about coded moves. |
| `sequencer/sequencer.ts`, `solver.ts`, `fsm*.ts` | The Sequencer, the search, the state machine. |
| `sequencer/all8-format.ts`, `all8-notation.ts` | The All8 codec (import/export) and the abbreviation table. **These live in the engine**, not in `test/`: a production codec cannot reach into `test/`, and a second copy of a 130-entry table is how two readers drift. `engine/test/lib/getout-decode.mjs` is now a re-export shim. |

## 2. Where it stands

**There is no scoreboard in this file. It is `PLAN.md` §2, and `PLAN.md` §2 names the command for
every row.** Copying those numbers here is what made the old revision wrong.

What *is* durable, and worth knowing before you run anything:

| Entry point | What it runs | State |
|---|---|---|
| `npm run verify:light --prefix engine` | `tsc` then the **12** fast harnesses (~25 s) | green (last run: 22.8 s) |
| `npm run verify --prefix engine` | `tsc` then **all 23** — the pre-commit gate | green; run it **in the background**, it exceeds the foreground cap |
| `npm run verify:figures --prefix engine` | the 1 target harness | **RED BY DESIGN** — the finish line, not a gate |
| `npm run verify` (repo root) | builds the engine, then `poc/verify.cjs` | **RED (exit 1)** — 3 pre-existing `Pass Thru` checks |
| `npm run verify --prefix poc-teacher` | the teacher app's own headless check | green |

**The two `verify`s are different commands and this has cost time.** `npm run verify` at the root is
the *POC* check; the 23-harness engine gate is `npm run verify --prefix engine`. The root one fails on
three `Pass Thru` dancer-count/hand-hold checks that predate the current workstream — they reproduce
on old commits and no part of the FASR/Setup work touches them. A suite that is already red is not a
gate for your change; do not "fix" it to make your own run look green.

The important structural fact about the oracles: there are **three external ones** — All8's get-out
corpus, All8's 188-figure corpus, and the CALLERLAB Mainstream definitions — plus **one derived
artefact** (the FSM built from the catalogue). `PLAN.md` §1 tabulates which tool reads which.
And the closing judgement from the last rounds still shapes expectations: **the remaining refusals
are STACKED.** A coverage fix at call *N* generally reveals a *different* defect at call *N+1*, so the
figure count moves less than the number of defects fixed. Treat it as a **lagging indicator**; the
leading indicators are the cause table, the poisoned-chain count and `facing-audit.mjs`.

---

## 3. How to work here

```powershell
npm run build --prefix engine                 # tsc
npm run verify:light --prefix engine          # the FAST subset (~25s): use this while iterating
npm run verify --prefix engine                # the whole gate suite: PRE-COMMIT, RUN IN BACKGROUND
node engine/test/sequencer.mjs                # or any single harness, from the repo root
node engine/test/getout-behaviour.mjs         # the corpus measurement (a report, not a gate)
node poc/verify.cjs                            # the POC, headlessly - see the note below
```

### Two tiers, one list; plus a third that is a target

Every harness is **one entry** in `engine/test/verify-suite.mjs` with the tier as a field, because two
separate lists is how a harness gets added to one and forgotten in the other — this repo has been
bitten by exactly that shape of drift. **`light` is a subset, not a weaker check**: the same
harnesses with the same assertions, just fewer of them.

- **light (12):** `gender-audit`, `catalogue`, `verify`, `sequencer`, `mainstream`, `matrix`,
  `matrix-getout`, `editor`, `features`, `bind-audit`, `alignment`, `all8-formation-map`.
- **all only (11):** `anim-convergence`, `promenade`, `getout-conformance`, `all8-format`,
  `getout-behaviour`, `getout-convention`, `selection`, `behaviour-audit`, `alignment-boards`,
  plus `determinism-audit` and `callerlab-diff` (both live in `tools/` and are reached through the
  entry's `sub` field).
- **target (1):** `all8-figures`. It is excluded from **both** tiers on purpose — a permanently
  failing entry in the pre-commit gate trains everyone to ignore the gate.

### The POC *can* be checked here

The old revision of this file said the POC cannot be run in this environment. That is **half true and
the half that matters is false**: the Vite app cannot (`spawn EPERM` under the sandbox), but
`node poc/verify.cjs` **does** run — it is a plain Node script against the engine's built `dist`, so
it never touches Vite or esbuild. It is not a UI check, but it exercises the formation/call pipeline a
coded start feeds. Two probes ask the engine the same questions headlessly:
`test/tools/poc-zero-line-probe.mjs` and `fasr-code-canonical-probe.mjs`.

### Working rules that have paid off repeatedly

- **Measure, do not reason.** Every claim in `PLAN.md` and `square-dancing.md` §9.1 is a number from
  a checked-in tool or a throwaway probe that was deleted before the commit.
- **Correct the docs when the code disproves them.** Both docs contain explicit "this was wrong"
  corrections; that is the house style, not a blemish.
- **A call that STOPPED is a symptom, not an owner.** Several phases found the defect one call
  upstream. Run `facing-audit.mjs` and a chain trace (`figure-trace.mjs`, `setup-split.mjs`) before
  authoring anything.
- **A probe that a call MATCHES a board says nothing about whether its paths are CORRECT on it.**
  `Sides Face, Grand Square` is the witness; a "mechanical copy" of a tam is a silently wrong board.
- **An improvement in a corpus count is not evidence that a change is right.** This has bitten at
  least twice; see §5.
- **Gate it in the same commit.** A gate written *with* a change has found the change's own bug more
  than once (the `Star Thru` role reading, and the `[S]` instrument fault below).
- **Write probes as `.mjs` files**, never `node -e` (PowerShell quoting mangles them).
- **Commit per logical piece**, with a multi-line message written to `.git/CMSG*` and committed with
  `git commit -F` (there is no heredoc in PowerShell), and **delete any `*-verify*.log` before
  committing**.
- **Never rebuild `engine/dist` while a suite is running.**
- **Fixtures stay verbatim**, with attribution to Rich Reel / all8.com retained.
- `docs/`, `poc/pnpm-lock.yaml` and `poc/pnpm-workspace.yaml` stay **untracked/uncommitted**.

---

## 4. The live workstream: the FASR / Setup thread

`PLAN.md` §4 holds the phase list. This section explains the thread that is actually in flight and
the vocabulary it needs, because the words are the hard part.

### The vocabulary, because it is where readers trip

- **FASR code** — All8's `[arrangement]LETTER[sequence][relationship]`, e.g. `[0L1p]`. It identifies
  a formation, an arrangement (the gender pattern), a sequence (the promenade order of the couples)
  and a relationship (where a *reference pair* sits relative to each other).
- **A FASR code admits FOUR boards.** Measured: every code gives exactly 4. They are identical in
  geometry, facing and gender on **every spot**; they differ only in the **couple-to-spot
  assignment**, and the four are exactly the four whole-set relabellings. So a plain FASR code
  **does not determine a board** — which is the whole reason the `[L1p]` "disagreement" with All8
  existed, and it was a selection bug, not an offset.
- **FASROO** — FASR + **Orientation** (`H`/`R`/`O`/`L`) + **Occupation** (`+` Head / `'` Side). This
  is All8's "Total FASR"; the terms are Gero Teufert's, Bill Davis called Orientation "Quadrature",
  and All8 marks both as **not officially recognised by CALLERLAB**.
- **A *setup*** — FASR **plus the couple numbering**. That is the primitive, and it is what
  `setupForFormation` returns. Orientation and Occupation are a caller-facing *description* of the
  same information, re-encoded through conventions that are themselves disputed.

### What is built (all measured, all committed)

| Commit | What landed |
|---|---|
| `6066fdb` | **Rings are representable.** `EMPTY_CELL = '.'` so a table row can hold a HOLE without shifting later columns, and **both** full-rectangle guards relaxed plus a third site (`arrangementFor`'s pre-check, now `occupiedSpots()`). A squared set could not be projected at all before; it now reads `.vv. / >..< / >..< / .^^.`, with its eight holes as `null` cells. |
| `009965b` | **`[S]`**, the Squared Set, and its arrangement table, transcribed from the raw `<pre>` block. |
| `4226a52` | The `[S]` `0:0/16` was an **instrument fault**; the harness now says *why* every zero happens and **fails on a zero with no reason**. |
| `5610269` | **The setup registry** keyed on the couple-to-spot assignment: `coupleToSpot`, `sameCoupleToSpot`, `rotationBetweenBoards`, `relabelCouples`, `setupForFormation`, `compliesWithSetup` with levels `formation \| arrangement \| sequence \| relationship`. |
| `855d23c` | `boardForFasrCode` builds through **`canonicalBoard`/`CANONICAL_INDEX`** instead of returning `boards[0]`. |
| `69448c1`, `6f346c5` | **Zero Box** wired to `B1c` (measured before it was switched on), and `Left Allemande` bridged. |
| `282faaa` | A whole-set `Trade` derivation was **reverted** (see §5). |

### What holds, and the command that says so

- **26 of 26** published alignments now select **All8's own board** — `fasr-code-canonical-probe.mjs`.
  The two that refuse are the `[P]` pair, for a documented reason. **12 codes** are the ones whose
  index is not 0, i.e. the ones whose built board actually changed; every other code builds what it
  built before, because `canonicalBoard` falls back to `boards[0]`.
- **10 name → code rows** in the registry each stand up a board with **8/8 identity** that reads back
  as its own code (`setup-registry-probe.mjs`): `Normal Lines`/`Normal Lines Compact` → `L1o`,
  `Eight Chain Thru` → `B1c`, `Ocean Waves`/`… RH BGGB Compact` → `W1p`, `Two-Faced Lines`/`… RH
  Compact` → `F1p`, `Two-Faced Lines LH` → `L.F1p`, `Static Square`/`Squared Set` → `S1`.
- Home reads **`[0S1?]`** as an alignment and **`[0S1???]`** from `fasrooOf`, with the missing part
  named. Home as a *state* is `[0S1p]`; the **initial setup** needs Occupation (`[0S1pH+]`) because
  Occupation is the couple-numbering anchor. A **half-sashay is arrangement 5**, so home and
  half-sashayed home are distinguishable now.

### What is genuinely open

1. **The `[P]` reference pair — this is the first thing to settle, and it is upstream of the probe
   the plan wanted.** `fasrooOf(board, 'Double Pass Thru')` returns `[0P????]`: orientation *and*
   occupation are null, with the reason recorded, because `REFERENCE_PAIR_RULES` has no `[P]` entry.
   All8's own worked case for Orientation is a `[P]` board — so the check exercises a code path that
   refuses `[P]` outright. Decide and record the `[P]` reference pair first. The board itself is not
   the obstacle; the corpus carries `P4p` (`3v v3 / 4v v4 / 2^ ^2 / 1^ ^1`).
2. **`fasrooOf`'s Orientation construction is flagged unverified in the source.** It compares the
   reference boy's current bearing to *his own* home bearing about the centre; All8 **superimposes
   the squared set** and asks which spot he now corresponds to. The four `[L1p]` boards do read four
   distinct orientations (H / L / O / R), so the structure is sound and the readout works — but
   **the absolute letter must not be trusted, and FASROO must never be used to SELECT a board.**
3. **The `16com` second source is parsed but not decoded.** All8's "16 Possible Pairings" pages
   publish a couple-numbered grid for all 16 states including sequences 3 and 4. The **tile order is
   pinned by the facings** (the page draws its two tile-rows in the opposite order from the engine's
   lattice, and reading it that way reproduces the page's facing sequence exactly), and the same
   gender lands on every spot — but the **cell-to-spot mapping** is unsolved: the couple pattern is
   `a,b,a,b,c,d,c,d` on the page and `a,b,b,a,c,d,d,c` on the engine's boards, so no cyclic relabelling
   maps one to the other. Until that permutation is found this source has **not** confirmed or
   refuted `CANONICAL_INDEX`. The gating argument does not depend on it: the rule is confined to
   sequences 1 and 2, which are measured across six formation letters and four arrangement numbers.

**The Zero Box residue**, measured rather than raw-counted: of the 324 modules labelled Zero Box,
**76 replay all the way** from the `[B1c]` board (up from 54 after the `Left Allemande` bridge;
0 from home — the "wrong start" signature). `zero-box-stops-probe.mjs` classifies every remaining stop
as **NAMING** (no title), **ENGINE** (the call exists and will not apply) or **CORPUS** (the module's
own step is not a call name) — and about a third of the ~30 distinct stopping strings are the last
kind: Ceder comments and `*** not validated ***` markers concatenated into the step. Re-run
`zero-box-probe.mjs` rather than quoting a number from any document.

---

## 5. Decisions already made — do not relitigate without new evidence

**The caller convention.** A get-out succeeds by reaching a state a standard finish closes
(`Allemande Left` / `Right and Left Grand` / `Promenade`), not by sitting on the literal home board.
It is also the acceptance criterion for the published corpus, and it is the engine's own search
target, implemented as a **finish as the final edge** so returned paths still end home.

**Index independence.** The board index, call index and formation index carry no correspondence;
matching derives its mapping from coordinates and rotation alone.

**Identity is data.** Home couple and gender are declared, or `UNKNOWN_COUPLE`/`phantom` — never
invented from array position, and anything unknown must not act as identity. (Note the known
violation: `boardFromMatchables` stamps `id: i + 1` for any geometry that is not home-like, so a named
formation stood up from the library carries arbitrary ids and reports `sequence: unknown`.)

**Readings are rotation-only, never reflection.** In `[B]`/`[P]`/`[L]` the mirror of arrangement 0 is
arrangement 5's pattern, and a mirrored candidate must never decide an arrangement. Likewise a FASR
code's four boards are **rotations** of each other, never reflections.

**Arrangement numbers are per-formation** — look them up in `ARRANGEMENT_TABLES`, never compute them
from a universal rule. A table row is a string, one character per column, and `EMPTY_CELL = '.'` is
how a ring writes a hole.

**Two tolerances, on purpose.** `DEFAULT_MATCH_MAX = 1.5` for the interactive apply (UI and legality)
and `SEARCH_MATCH_MAX = 6.0` for the pure-relative search; a search result must be re-validated on the
interactive path.

**A call may be geometry-derived** — a pivot (always legal) or a resolve (legal only when its
precondition holds, and it must REFUSE with a reason). One definition, shared by the Sequencer, the
analyser and the search. `applicator.applyStep` does **not** know about coded moves; the working line
is `tryCodedMove(b, call) ?? applicator.applyStep(b, call)`.

**All8 is the authority over Taminations for notation and FASR; CALLERLAB over All8 for call
definitions.** Where they disagree, record the measurement rather than smoothing it.

**A setup is keyed on the couple-to-spot assignment, and FASROO is a caller's view.** Store and select
a setup by the assignment; derive FASROO **for display only**, never to choose a board, and keep the
`?` marker on the Orientation letter. `REFERENCE_PAIR_RULES` **classifies** a board and is never used
to select one.

**The strict sequence/relationship filter stays strict.** A spec that names a relationship letter is
satisfied only by a board whose relationship the engine can actually read — which is what keeps the
letter meaningful. The relaxation was tried and broke 14 corpus codes plus the `[P]`/`[W]`/`[F]`
refusals; see §6.

**An instrument's silence is the bug, not the data.** A zero in a reachability table must say whether
it is a coverage gap or an unnameable state, and which part cannot be read. A zero with no reason is
now a **failure**.

**A corpus count improving is not evidence a change is right.** Two recorded cases: the whole-set
`Trade` (below), and the invariant "leaves an `Ocean Waves` with every gender in its original spot",
which is satisfied by **all three** candidate pairings — same-column 2 apart, across-column 4 apart,
and same-gender — and they are **different boards**. Only the across-column pairing is consistent with
the authored motion (`Swing Left` is `Run Left hands="gripleft"`, i.e. a pair 4 apart).

**A whole-set `Trade` refuses, deliberately, and the derivation is reverted (`282faaa`).** It made the
Zero Box corpus go 76 → 83 modules, and it was wrong: it applied from **126 of the 134** named
formations, `Static Square` included, and on a wave it **paired different genders 2 apart** because
`tradeRule`'s rule is "the nearest other trader". A correct derivation needs two things, and neither
is in hand: **(a)** the pairing the call means on each board, from a source rather than chosen, and
**(b)** a precondition that is false for the 126 formations where a bare `Trade` is not that call.

**`[S]`'s setup code is `S1` with no relationship component.** `[S]` has no reference pair, so `S1p`
is a state that cannot exist and the enumeration correctly admits nothing for it.

**`L1o`'s index is the one `CANONICAL_INDEX` entry not measured off a diagram** — All8 publishes none
for an `o` code. It is index 0, a **recorded choice**, and it is safe because the zero-line property it
is used for is rotation-invariant (relabelling couples does not change who faces whom), so it holds on
all four candidates.

---

## 6. Traps that have already bitten

1. **There are two `verify` commands, and the root one is RED.** `npm run verify` builds the engine and
   runs `poc/verify.cjs` (3 pre-existing `Pass Thru` failures, exit 1). The gate is
   `npm run verify --prefix engine`.
2. **Register calls by title, not file basename** — or `Pass Thru` (in `pass_thru.xml`) never registers
   and every corpus line "fails at its first call".
3. **`poc/src/assets/src/calls.xml` is an index, not implementations.** A title there with no `<tam>`
   anywhere is a call the engine *knows* and cannot perform.
4. **`Sequencer.getout()`/`fixIt()` search the Sequencer's OWN board** — `setBoard(board)` first, or you
   measure the home board N times. **The failure is SILENT**: `Sequencer.getout(opts)` takes only opts
   while `HomeSolver.getout(board, opts)` takes the board, so `seq.getout(someBoard, {...})` does not
   error, it ignores `someBoard`. Check the arity, not your intent.
5. **`Sequencer.getout()`/`fixIt()` aside, `boardForAlignment` returns `boards[0]`** — the first of the
   four boards a FASR code admits, by enumeration order. Production goes through
   `boardForFasrCode` → `canonicalBoard`. The POC's old coded start was correct only because `L1o` is
   the one code whose selection happens not to matter; `B1c` is index 0 of a *different* four, so the
   next coded start would have stood up a silently wrong board.
6. **`boardSig` is positions-only.** A pure pivot therefore collapses onto the state it came from, and
   anything facing-dependent must key on the full pose.
7. **A probe that reads the WRONG FIELD will agree with itself and prove nothing.** The recorded
   `[L1p]` "conflict" was the `id` field (home identity) being compared where All8's diagram prints
   the `couple` field (the board's own numbering, which a FASR code does not pin). On the `couple`
   field the engine reproduces the page character for character. `couple` and `id` are different
   fields; know which one an authority prints.
8. **A fixture row can contain a literal `<`.** `fetch-arrangements.mjs` stripped tags with
   `/<[^>]+>/g`, which ate every row whose printed arrows include `<` — the middle rows of `[S]`, one
   row of `[D]`, one of `[I]`. A `<` only starts a tag when a name or a slash follows it. **Both**
   parser defects here (that one, and a collapsed-space glue before a `--` marker) silently deleted
   data, so regenerate the fixture rather than hand-editing it.
9. **`getout-conformance.mjs`'s `check(true, …)` was a literal no-op for a long time.** It is now a
   real gate — *implemented OR declared in `KNOWN_CATALOGUE_GAPS`* — so a mis-expansion fails loudly
   instead of being reported as an engine deficiency, and a declared gap that later gets implemented
   also fails. A phantom call name is otherwise mis-attributed to the ENGINE.
10. **`boardFromMatchables` uses the array index as dancer id** for any geometry that is not home-like,
    so a named formation stood up from the library has no real identity and reports `sequence:
    unknown`. 129 of the 134 named formations are in this state.
11. **Page text is not a get-out, and Ceder comments are not call names.** A third of the Zero Box
    corpus's distinct stopping strings are prose or `*** not validated ***` markers concatenated into
    the step. Nothing in the engine should resolve those.
12. **`boardFromDiagram`/`getUniqueFormations` dedupe congruent shapes including reflection**, so they
    cannot name e.g. `Two-Faced Lines LH`; `recognize` does distinguish it.
13. **All8's `--Prom` is a finish**, not a fraction; `A-Prom` = bare `Promenade`; `--PromH` =
    `Promenade Home`, one call.
14. **`[P]` (Beginning Double Pass Thru) mixes side-by-side and facing couples**, so All8 defines no
    reference pair for it: its relationship letter is `null`, which is why 2 of 28 alignments do not
    classify back and why `[P]` refuses in `fasrooOf`.
15. **PowerShell truncation looks like a failure**: `... | Select-Object -First N` can make a
    successful command report `[exit code: 1]`. Re-run without the truncation before believing it.
16. **The corpus is an oracle, not a spec**: when it disagrees, record the disagreement (with the
    measurement) rather than smoothing it away by loosening a rule.
17. **Under the sandbox a Node child spawned with piped stdio fails with EPERM.** That is why
    `verify-suite.mjs` uses `stdio: 'inherit'` and why the Vite app cannot start here — and it is
    **not** why the POC is unrunnable: `node poc/verify.cjs` works fine.
18. **`poc/src/editor-ui.ts` has a pre-existing TS2739 error**, so a typecheck of the POC app is not a
    clean signal.

---

## 7. If you have one afternoon

In the order the evidence supports, with the payoff of each:

1. **Decide and record the `[P]` reference pair**, then compare `fasrooOf`'s Orientation against All8's
   own worked case (a reference boy inside, formation rotated 90°, a Side occupation yet **still
   oriented H**). This is the last open item of the thread that is actually in flight, it is bounded,
   and it is upstream of the readout being trustworthy. §4 has the exact state.
2. **Phase A's remaining body-error queue** — the largest owner the census cannot see. The head
   (`Heads Touch 1/4`) is fixed; the queue behind it is in `PLAN.md` §4/Phase A, and its order comes
   from `setup-split.mjs`'s prefix scan. Remember the phase's own honest ceiling, measured: the five
   `Boys Fold` figures can yield at most three.
3. **Phase B's authoring queue**, call by call, **definition first** — CALLERLAB, then the rule or the
   authoring, then validation against the corpus. Run `facing-audit.mjs` and a chain trace before each
   row. Note that the rows that remain are increasingly ones where the corpus reaches a call from a
   board **no authority covers** (`T-Bone LUUR`, `Lines Facing Out`, `Single File Promenade` from
   columns) rather than a known setup at the wrong scale.
4. **A correct whole-set `Trade`** — 22 Zero Box stops and 85 corpus modules use it, and it is the
   biggest genuine item in the Zero Box residue. It needs **(a)** the pairing per board from a source
   and **(b)** a precondition false for the 126 formations where a bare `Trade` is not that call. Do
   not re-enter it with only one of the two: that is precisely what was tried and reverted.
5. **Decode the `16com` cell-to-spot mapping** — it would strengthen `CANONICAL_INDEX` on sequences 3
   and 4, where the current behaviour already agrees. Cheap once the permutation is found, and it is
   the last independent check on a rule that is measured on 26 diagrams.
6. **Phase H, the solver index** — turns a 1–2 minute failed `getout()` into a usable UI action.
   Independent of the figure work, so it is the right thing to do when you need a break from it.

Read `PLAN.md` §3 (refuted) **before** starting any of these. Several of the most attractive-looking
next steps — raising the matching tolerance, a scale-invariant matcher, filtering `sequencer="no"`
variants, `Spin the Top`'s composition, a `[B]` promenade "fix" — are in that table with the
measurement that killed them.
