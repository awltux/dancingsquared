# Handover

This file is generated at the end of a chat session so that a new chat session can pick up where the other
left off. There is no need to maintain it — it is completely regenerated when a new session is needed.

**Read in this order:**

1. `README.md` — the workspace in five lines.
2. **`AGENTS.md`** — THE RULES: the change loop, the gate matrix, the code and test standards, security, and
   the trap list. It is the authority for *how to work*; do not duplicate it here.
3. **this file** — the orientation: §1 the map, §2 what is measured, §3 how to work, §4 the live threads,
   §5 decisions, §6 traps, §7 the next steps.
4. `PLAN.md` — the state: §2 the scoreboard, **§3 what is refuted**, §5 what is blocked.
5. `square-dancing.md` — the spec (§1–§8) and §9 the open-items log.
6. `engine/test/fixtures/README.md` — where each oracle comes from and how to re-fetch it.

Numbers below are facts about a **closed measurement** or about an authority, and each names the command that
produced it. Where a number came from a **delegated subagent run** rather than the session's own hands, it says
so — the distinction has mattered twice in this session.

**THE ONE THING TO KNOW BEFORE YOU START:** §4.2 is a live, precisely-specified bug with the owner's own
statement of the intended design. It is small, it is measured to the point of the fix, and it should be the
first thing you do.

---

## 1. What the repo is

| Path | What it is |
|---|---|
| `engine/` | **The thing under test.** TypeScript library. `src/sequencer/` holds matcher, applicator, legality, solver, analyser, FSM, alignment, `grouping.ts` + `selection.ts` (the dancer-selection vocabulary), `couples.ts` (who is whose partner NOW), `coded-moves.ts` (the derived-call registry). |
| `poc/` | Three.js app **and the canonical corpus** (`src/assets/`). Sequencer panel (`src/sequencer-ui.ts`), call editor, FSM view, browse view. Probes in `tools/*-probe.mjs`. |
| `poc-teacher/` | Teacher / session-tracker app. |
| `poc-matrix/` | Earlier matrix experiments. **No gate.** |
| `features/` | Gherkin specs, gated by `engine/test/bind-audit.mjs`. |
| `modules/`, `sequences/` | The ceder corpus, tracked. `modules/` is 1652 JSON files with `startFormation` / `endFormation` / `steps[]` under `static_set/`, `zero_box/`, `zero_line/`. |
| `docs/` | The CALLERLAB PDF and downloaded pages — an oracle **outside git**. |
| `taminations-flutter/` | **Reference only** — read, never port. `assets/**/*.md` is the CALLERLAB text itself. |
| `book/` | The published book + its tools. `book/tools/check-links.mjs` item 7 is the REPO-WIDE text-corruption gate. |

## 2. Where it stands — measured, each with its command

| Entry point | State |
|---|---|
| `npx tsc -p poc --noEmit` | **clean** (exit 0) — re-checked after every UI commit this session |
| `npm run build --prefix engine` | **clean** |
| `npm run verify:light --prefix engine` | **28 of 46 harnesses, FAILED at catalogue (exit 1)**, section counts `3/1/9/2/4/5/3`, ~52 unique `FAIL` lines. **Almost all of it is pre-existing and corpus-driven** — the corpus moved repeatedly during this session (the owner committed tams), so a before/after delta is only meaningful with a stash of `engine/src` + `engine/test` |
| `node engine/test/couples.mjs` | **ALL CHECKS PASSED** |
| `node engine/test/selection.mjs` | **1 gate failed** — the pre-existing tied-formation namer |
| `node engine/test/circle-four.mjs` | **all green** — newly registered in the light tier; it was a harness nobody ran |
| `node poc/tools/verify-probes.mjs` | **50 probes, 13 failed** (the long-standing twelve + `radial-arc-fit`) |
| `node poc/verify.cjs` | **exit 1**, pre-existing: `selectTam` throws `2 tams match "Circle Left" [Static Square]`. Nobody has attributed it |
| `node book/tools/check-links.mjs` | **GREEN** — 109 pages; the repo-wide text-corruption gate |
| `npm run check:book` | **exit 1** at `make-animations.mjs --check` (`animations-index.json` DRIFT). Do not regenerate while the corpus is mid-edit |

**`git status` regularly carries the owner's in-flight corpus work — this session it was
`poc/src/assets/ms/circle.xml`.** Never commit it. Untracked by design: `docs/`, `poc/pnpm-lock.yaml`,
`poc/pnpm-workspace.yaml`, `poc/tools/guard-exclusions-broken.md`, `verify*.log`, `poc/tools/_*.mjs`,
`engine/test/tools/_*.txt`.

## 3. How to work here

```powershell
npm run build --prefix engine                 # tsc, from the REPO ROOT
npm run verify:light --prefix engine          # the fast subset while iterating
npm run verify --prefix engine                # the whole engine gate: PRE-COMMIT, background
npx tsc -p poc --noEmit                       # the POC typecheck
node engine/test/couples.mjs                  # the couple/partner/role rules (~5 s)
node poc/tools/verify-probes.mjs              # the POC probes (~11 min)
node poc/tools/<name>-probe.mjs               # one probe
node book/tools/check-links.mjs               # the text-corruption gate, seconds
```

**DRIVE THE UI BEFORE YOU FIX A UI BUG.** This session's most expensive lesson (§6.3). The recipe:
`npm run build -w dancing-squared-poc`, serve `poc/dist` from a few lines of `node:http` (**not**
`vite preview`, which spawns esbuild), then Playwright (`PLAYWRIGHT_BROWSERS_PATH=<repo>/.pw-browsers`) or the
harness browser tools. **`browser_evaluate` is disabled in this session, but the accessibility snapshot marks
disabled controls**, which is usually all you need to confirm a "button does nothing" report.

## 4. The live threads

### 4.1 CLOSED this session — read this first so you do not reopen them

Four defects fixed and three derived calls removed, each with its own commit and a revert-sensitive gate:

- **`Couple #N` named all four couples** (`0c769aa`). `selectionGroup` maps every `Couple #N` spelling to the
  `couples` key, so the generic group branch answered with ALL FOUR and the two parametric branches below it
  were dead code. Now `Couple #1 -> [2,5]` on the measured witness where it used to be all eight.
- **`Beaus`/`Belles` picked by array order** (`ceaf632`). The test crossed two **parallel** vectors, so the
  cross product was structurally zero and the sign came from float residue: **227 of 680 side-by-side pairs
  (33%) wrong**, 0 after. `combined-groups.mjs` had PINNED the defective answer.
- **The derived `Swing Your Partner`** got a board-neutral motion source (`e43ed91`), was corrected to turn
  **clockwise** per `ms/swing.md` (`d8e9d3d`), and its end pose was **rejected on its matching cost**
  (`fd0bc8b`: a board-only co-facing pose changes the post-swing legal-call set on 10 of the 26 boards it
  fires on, including −232 on one). Then the whole coded move was **removed** at the owner's request
  (`c60c808`).
- **The derived `Circle Four` family** (all eight titles, one `circleFourDef` rule) **removed** (`6ccf14d`).
- **UI**: the HUD locks with an indeterminate progress bar while the sequencer calculates (`25e219a`); the
  "While…" mode has ONE owner (`41ba359`); and `While…` is enabled from the REMAINDER so it can start a lane
  with no figure open (`d285865`, browser-verified before and after).

### 4.2 **THE LIVE TASK — `Forward and Back` charges 0 beats standalone**

**REPORTED:** *"in Static square, 'Heads Forward and Back' as a call in its own right does nothing."*

**MEASURED** (standalone on a Static Square, own probe this session):

| call | legal | moved | `sequenceBeats` |
|---|---|---|---|
| `Heads Forward and Back` | yes | **0/8** | **0** — "NO BEATS AT ALL, there is no timeline to animate over" |
| `Sides Forward and Back` | yes | 0/8 | **0** |
| `Forward and Back` (unscoped) | **no** | — | refused: "No setup in this call matches the current formation" |
| `Heads Step Forward and Back if Possible` | yes | 0/8 | **4** ✅ |
| `Heads Step Forward` | yes | **4/8** | 2 ✅ |

**THE INTENDED DESIGN, stated by the owner** — this is the acceptance criteria, not a guess:
the timing exists so that one set of dancers moves into the middle while the other set does something like a
promenade around them, **so the out-and-back spans the SIBLING's duration and they step out as the other group
finishes**. **With no other group in the slot it must behave as a hard-coded 2 beats in and 2 out (= 4).**

**SO THE BUG IS ROUTING, NOT A MISSING RULE.** The hard-coded fallback already exists
(`STEP_FORWARD_AND_BACK_BEATS = 2 × 2 = 4`) and already works — for `Heads Step Forward and Back if Possible`.
The spelling the owner invokes reaches a catalogue path with a zero-length path and zero beats. The seam:

```
findCodedMove('Step Forward and Back if Possible')  ->  Step Forward and Back if Possible
findCodedMove('Forward and Back')                   ->  undefined        <-- nothing claims this name
```

`splitSelection('Heads Forward and Back')` gives selection `Heads` + call **`Forward and Back`**, no coded move
claims that name, so the coded path is skipped and the catalogue serves it hollow.

**NEXT, in order:**
1. **Measure** which route serves `Heads Forward and Back` and where the 0 beats come from — the variant the walk
   finds, or the absence of one. (Start at `matchingVariantInfo` in `sequence.ts`.)
2. **Then fix** by registering the SCOPED spelling against the derived rule. Two things stop it being a one-line
   alias: (a) the rule's precondition **deliberately refuses a whole-set reading** ("names a group to step … it
   has no whole-set reading"), so the unscoped case must keep refusing for that reason; and (b) there is a
   recorded asymmetry in this name — `applicator.ts:979-981` notes the corpus carries
   `tam title="Sides Forward and Back" display="none"`, and that the scoped form is refused while
   whole-board-by-name applies.
3. **Gate BOTH timings**: the hard-coded 4 standalone **and** the sibling-driven span. A probe that pinned only
   the first would break the promenade-around-them case.

### 4.3 OPEN, MEASURED, DECISION PENDING — the line/wave pairing

`Couple #N` on a wave highlights the **home** partner. Measured on the owner's own Ocean Waves board
(own probe): `findCouplePairs` returns **0 pairs**, every dancer keeps its home couple, `Couple #1 -> [5,6]` —
and **#6 is 4.00 away from #5**, where the adjacent girl is **#4**, 2.00 away. `findCouplePairs` refuses wave
neighbours **by design** (`couples.mjs` asserts `findCouplePairs(Ocean Waves) === 0`), and the reference
disagrees: `ms/swing.md:111-119` — *"they Swing the dancer BESIDE them, not the one they are facing across the
square"*. Same hole as `swingProblem`'s home fallback, recorded in `4463d01`.

**Both candidates were implemented, measured and reverted** by a delegated run — numbers are from that run:
- **A (a "beside" third pass in `findCouplePairs`)**: fixes the highlight; **19 of 263 boards change their
  `legalNext`**, −20 `Beaus Trade`/`Belles Trade`, +6 `Allemande Left`; `Beaus` becomes `[1,2,3,4]` (half
  girls) because a beside pair faces opposite ways so left/right is undefined; `couples.mjs` 3 red (all three
  pinning the old wave reading on purpose); light `FAIL` lines 54 → 57.
- **B (beside only for the couple NUMBER)**: fixes the highlight and is **invisible to every gate** (54 → 54)
  while giving `Couple #1 = [4,5]` on a board where `findCouplePairs` still returns **0** — one module, two
  contradictory definitions of "current partner".
- **`Swing Your Partner` is unchanged by both** (0 of 263 boards).

**RECOMMENDATION, not yet taken:** beside-for-the-NUMBER, roles unchanged — deliberate and stateable, unlike B's
silent divergence. One more measurement decides it. **Unmeasured consumer:** `areCurrentPartners` also feeds
`trade-run.ts`'s Run/Trade preference, which is NOT in `legalNext`.

### 4.4 Corpus gaps the removals exposed — the owner's to close

- **The removed `Circle Four` rule was filling a lane.** `Heads Promenade 3/4 to Home || All Except Heads
  (Step Forward + Circle Four Left 3/4)` still applies and still costs 12 beats, **but its circle lane no longer
  moves** — no tam matches the ring `Step Forward` leaves. `circle-four.mjs` prints whether it is closed rather
  than asserting either way.
- **The corpus's own spellings of that family are different**: the only ones in `modules/` are
  `Circle Four 3/4` (9 files) and `Circle Four Half Way` (3) — **neither is among the eight aliases that were
  removed**, so something else resolves them. Unresolved.
- **`Circle Four Left Full` appears in `modules/` ZERO times** (0 of 1652). The family's actual start formations
  there are **Static Square (8), Zero Box (2), Zero Line (2)**.
- **The authored `Adjacent Dancers Close` swing tam ends partners 1.00 apart** — a tandem, not CALLERLAB's Normal
  Couple (~2.0 side by side) — which is why two `sequencer.mjs` checks now fail with *"dancers 1 and 4 are 1.00
  apart … nothing to promenade"* (`figm86`, `figm89`).

### 4.5 Recorded non-decisions — do not relitigate without new evidence

- **`findCouplePairs` admits a co-facing tandem** (its side-by-side pass tests only distance and heading):
  38 of 748 pairs on 12 boards, and **0 of 38 renumber** anyone, so it is inert for the couple number. Left
  alone on purpose; recorded in `couples.ts`.
- **A pair standing front-to-back** keeps the array order for `Beaus`/`Belles`; the projection is 0 and the role
  is genuinely undefined there.
- **The busy lock DROPS a second click**, so a fast deliberate double-undo loses the second press. One line to
  make it queue. The owner has not chosen.

## 5. Decisions already made — do not relitigate without new evidence

**Earlier, unchanged:** the caller convention; index independence; **identity is data**; the dancer ARRAY ORDER
is the renderer's binding (`reorderLike`); a written shape is half the set unless it says otherwise; a
two-dancer pair is authored with both dancers and `asymmetric="true"`; `formations.xml` cannot declare symmetry;
a board that matches nothing must be refused, not named; `KNOWN_FORMATION_MAX`'s tolerance is
`maxError / 12`; `DEFAULT_MATCH_MAX = 1.5` interactive vs `SEARCH_MATCH_MAX = 6.0` search; All8 is the authority
over Taminations for notation and FASR, **CALLERLAB over All8 for definitions**.

**New this session:**
- **The couple id is the Boy's and the pair is his CURRENT Girl partner** (`couples.ts`) — the stored
  `SeqDancer.couple` is the Girl's memory of her ORIGINAL couple, which is what `Heads`/`Sides`/FASR read.
  `Heads`/`Sides` key on the stored field; `Couples`/`Couple #N` are a CURRENT reading, and they deliberately
  disagree after a partner change.
- **A name that resolves to everyone is not a proper subset**, so `Couples` is correctly absent from
  `subsetGroups` while `Couple #N` are present.
- **The A-1 beau/belle rule is "partner on the right"**, i.e. the dancer on the couple's LEFT; a front-to-back
  pair is undefined.
- **The subset-line synonym filter (Men/Women/Ladies) is DISPLAY-ONLY.**
- **A coded move SHADOWS the catalogue**, and `catalogueFallback` does **not** mean "prefer the catalogue" — it
  means "decline to the catalogue when my precondition refuses". The order is coded-first, deliberately, because
  the family was born formation-INDEPENDENT. See §6.4 for the distinction that decides removals.
- **The `While…` mode has ONE owner** (`setParallel` → `applyParallelChrome`), and its enable condition is the
  REMAINDER, not the mode flag.

## 6. Traps that have already bitten

1. **A TEST CAN BE STRUCTURALLY DEGENERATE AND STILL LOOK RIGHT.** `Beaus`/`Belles` crossed two PARALLEL vectors,
   so the cross product was identically zero and array order decided. **When a test compares two vectors, ask
   whether they can be parallel by construction** — check `angle(u,v)` is near 90°, not 0 or 180.
2. **A GATE CAN PIN THE IMPLEMENTATION RATHER THAN THE BEHAVIOUR.** `parallel-lane-probe.mjs` went red on a
   refactor that moved state ownership; the fix was to re-point each check **after confirming the behaviour it
   pinned was still true**. Re-pointing a regex at a new method name without keeping the assertion is a
   weakening. And a gate can pin a DEFECT (`combined-groups.mjs` did).
3. **DRIVE THE REPRO BEFORE YOU FIX IT.** The `While…` button took **three** attempts: the first two were me
   reading source and fixing what I could see, and both missed the owner's actual blocker. The third reproduced
   his exact six steps first — the button was simply `[disabled]` — and found it in one step. The owner was the
   ground truth each time.
4. **A DERIVED CALL EXISTS TO CORRECT THE TAMS, OR TO EXTEND THEIR REACH — AND ONLY THE SECOND KIND IS SAFELY
   REMOVABLE.** `Fan the Top` "covers the case the tams get wrong"; `Swing Your Partner` existed only to reach
   boards the tams couldn't. Deleting the first family reinstates a defect someone already measured.
5. **`--prefix engine` FROM INSIDE `poc/` RESOLVES TO `poc/engine`** and fails ENOENT — and the error lands at
   the end of a piped command, so the next command silently measures the OLD `dist`.
6. **REBUILDING `dist` WHILE A SUITE RUNS INVALIDATES THE WHOLE RUN.** I did it; the results were worthless.
7. **`verify-suite`'s verdict names only ONE failing harness.** To attribute anything, capture the run to a log
   and **diff the `FAIL` lines** against a stash-based baseline.
8. **A MEASUREMENT OVER IDENTITY-LESS TEMPLATES MEASURES NOTHING.** `boardForFormation` returns templates with
   `couple=0`, where `swingProblem` REFUSES — a probe counted "10 of 11 formations lose Promenade" on boards
   where the call could never apply. Counting only boards where the call is LEGAL gave 26/0/3 instead.
9. **MY OWN PROBE REGEXES FAIL SILENTLY.** A `<tam\b[^>]*>` pattern missed multi-line `<tam>` elements (they span
   lines in `ms/swing.xml`); "no tams found" was my pattern, not the file. Check the pattern against a known
   positive.
10. **A harness can crash instead of failing.** `check()` does not exist in `selection.mjs`; calling it threw
    `ReferenceError` and the run ended early — a grep had shown it "passing". Always read the verdict line.
11. **`node -e` is banned; probes are files.** PowerShell mangles the quoting, and `.mjs` with top-level `await`
    cannot also use `require`.
12. **CRLF.** The app's `.ts`/`.html` are CRLF in the working tree; a multi-line literal match needs
    `.replace(/\r\n/g, '\n')`.
13. **Under the file sandbox a Node child spawned with piped stdio fails with `EPERM`** (esbuild/vite, and the
    Vite app cannot be started without wider access).
14. **`... | Select-Object -First N` can make a successful command report exit 1.**
15. **A position into an authored list is not an identity.** Select a tam by `from`/`formation`, never by index.
16. **`knownFormation` will name a board that matches nothing**, and on a tie the winner is scan order.
17. **The corpus XML in the tree is the owner's in-flight work.** Never commit it; it changes probe results.
18. **A fabricated number in a doc is a defect**, and so is a confident causal story in this file with no command
    behind it — the previous revision's §4.1 was one, and it cost a whole session.

## 7. If you have one afternoon

1. **§4.2 — the `Forward and Back` timing.** One measurement, then a small routing fix, with a probe pinning
   BOTH timings. It is specified to the point of implementation and it is what the owner asked for last.
2. **§4.3 — take the pairing decision** (beside-for-the-number, roles unchanged), with the second measurement
   that covers `trade-run.ts`.
3. **§4.4 — close the corpus gaps** the two removals exposed: the circle lane, the swing tam's 1.00-apart end
   pose, and the `Circle Four 3/4` / `Half Way` spellings that no alias covers.
4. **Attribute `poc/verify.cjs`** — red for several sessions, nobody has looked.
5. **The busy-lock drop-vs-queue decision** (§4.5) — one line.
