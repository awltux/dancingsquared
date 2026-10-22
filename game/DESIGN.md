# DESIGN — the Dancing Squared call game

**Status:** design for review. No code exists yet; this directory deliberately contains this file only, and
nothing here is under source control. The implementation phases are in §13.

**What it is.** A browser game that teaches square dancers and callers how calls *interconnect*: the player
is shown a start setup and a goal setup and must supply the calls that connect them. Two modes share one
engine contract, one level ladder and one scoring currency — a continuously-playable **Drill** and a
once-a-day **Daily Challenge**. Login is backed by AWS Lambda in front of a cheap database so scores can be
compared, and the game is monetised with Google Ads.

**Where it lives.** A new workspace package, `game/`, alongside `engine/`, `poc/` and `poc-teacher/`. It
consumes the engine **by package name** (`dancing-squared-engine`) and never reaches into `engine/src`, the
same boundary `poc/` keeps (AGENTS.md §1, §4.3).

---

## 1. Decisions locked in this session

These are settled. They are written down because the rest of the document is derived from them, and because
a later reader must not re-open them by accident.

| # | Decision | Consequence |
|---|---|---|
| 1 | The **three-option drill is the continuously playable mode**; the **daily challenge is a once-a-day extra**. | Two modes, one engine contract, two leaderboard partitions. They differ in **who decides the puzzle**: the Drill's order is authored and served (§7.2, §8), the Daily is derived from the date (§9). |
| 2 | Drill: at each step three options — one correct, one legal-but-wrong, one illegal; a click gives instant feedback. | `DrillPuzzle` and `StepOptions`; the failure taxonomy in §8. |
| 3 | Daily: the player selects **each call individually** from the moves the sequencer offers, with **undo/redo** until the puzzle is solved. | `PlaySession` with a move stack in §9. |
| 4 | Failure is instructive: animate the player's own line, say why it failed, then offer a **"show me the answer" replay** of the correct line. | The review/replay flow, shared by both modes. |
| 5 | Ladder: L1's pool is **57 calls** and its Drill is a one-call solution; **every level adds 4 calls** (`poolSize(n) = 57 + 4·(n − 1)` — the owner's rule on the family floor, see §5 finding 4). The design's original "L1 is 10 calls" is superseded by the measurement. | `LevelSpec` and the level→spec function in §5. |
| 6 | **Cognito User Pools** (email + password, JWT verified in Lambda). Anonymous play is a **read-only demo** that stores nothing; a device's local ledger may be imported only as unranked history (A26, §11.1). **AMENDED** from "anonymous play whose local scores can be claimed on login": the claim survives as history, and it buys no board, no hints and no progress. | Auth, the three identity modes and the bulk-claim endpoint in §11 and §11.2. |
| 7 | Extract the POC's Three.js stage into a **shared renderer package first**, then build on it, offering **both 2D and 3D** views. | Phase 0 in §13. One package, consumed by the POC and by **both** game modes (§4). |
| 8 | The daily is seeded from the **UTC date** — one challenge per day — **issued per level to all players**, with the leaderboard partitioned **per level**. | §9: with the challenge now level-scoped, its solution no longer has to be derivable from the level-1 pool. What remains fixed is that every player at a level gets the identical challenge. |
| 9 | **Free exploration; the score penalises extra moves and time.** Offered calls are **legal now, not "still solvable"** — dead ends are the player's to discover. | Undo is free and unpunished; the clock and the move count carry the cost; §9 and §6 make "wander until the picture matches" a losing strategy. |
| 10 | **The Drill is loaded from the database**, so every player at a level follows **the same regime in the same order**. | §7.2 and §8: a per-level ordered schedule of seeds is authored ahead of play and served as the canonical sequence; the client never decides *which* drill comes next. |
| 11 | A player's **position** in the regime is their own, and a drill is **locked when it is issued**. | §8: everyone's first L1 drill is the same puzzle; a player who joined late starts at the beginning of the order rather than being skipped forward, and a schedule edit never rewrites a drill already served to someone. |
| 12 | **The engine runs on both sides**: the server to *create* the problems and check the answers, the client to *play* them. | §4: the server generates every puzzle and validates every submission; the client runs a live sequencer for **both** modes. |
| 13 | **The Drill's three options are danced, not shown as video** — the engine presents them, since it is already on the client for the Daily. | §8: the client runs the engine in this mode too. A published Drill entry is a **seed**, so nothing has to be rendered ahead of play and there is no media pipeline. |
| 14 | **Both modes are interactive**: the Daily to add and remove calls and see the consequences, the Drill to watch an option and commit to an answer. | §4.4, §8, §9: the offering list comes from `legalNext`, every move is an `applyToBoard`, and each Drill option is a one-call `evaluateSequence` on the shared renderer. |
| 15 | **Hints are earned on the drill line and spent on the Daily**: one per **10 successful Drill puzzles**, up to **three** held, at a **60-second time penalty** each. | §10: hints are a time penalty folded into `elapsed`, not a scoring factor of their own; the earning ledger counts ranked Drill successes; a hint names one call that reduces the distance to the goal from the player's *current* board. |

**The one consequence worth stating out loud (decisions 3 and 9 together).** With only-legal offerings and
free undo, a dead end can always be escaped — so declining to filter the offerings by solvability costs the
player **time and moves**, which is exactly what the score already measures. That is why no separate
dead-end warning is designed. The thing it changes is that a player *can* wander, so the Daily needs a
**move allowance**; §9 fixes it as the shortest solution the generator found plus a cushion, with scoring
built on **wasted moves**.

**A second consequence, from decisions 10 and 11 together: the two modes have different sources of
authority, and the design must not blur them.** The **Drill's order is data an operator curates and the
server serves**; the **Daily's puzzle is derived from the date**. Both are still *generated* by the same pure
function from a seed (§7) — what differs is who chose the seed and when. That is why the Drill is not "the
daily without a date": its sequence is authored once, published per level, and then immutable in the sense
that matters (§7.2, §8), where a date-seeded challenge is reproducible by anyone who knows the date.

**And a third, from decisions 12 to 14: the engine is on both sides, and neither mode needs production
infrastructure.** A published Drill entry is a **seed**, and since the client stopped generating (§9) the puzzle
that seed names travels with it: the serving layer builds the boards, the client draws and dances them on the
renderer the Daily already needs. The mode that looked like the cheap one and the mode that
looked like the expensive one turn out to need the same things — a `Sequencer` and a stage — and the only
difference is what the player does with them.

That is worth writing down because the arithmetic governs the phases (§12): the Drill is *not* front-loaded
with a pipeline, so the two modes can be built in either order, and the shared pieces (the generator, the
goal test, the stage) are built once and used twice.

---

## 2. Facts this design rests on

Every claim below is a fact about the repository, with the file that owns it. Nothing in this document is a
remembered number.

- **The engine has the primitives both modes need**, all public: `Sequencer.apply`, `legalNext`,
  `applyToBoard`, `recognize`, `fasr`, `evaluateSequence`, `sequenceBeats`, `sequenceStop`, `sequenceInfo`,
  `getout`, `setActiveLevel` — `engine/src/sequencer/sequencer.ts`, re-exported through `engine/src/index.ts`.
  - `evaluateSequence(flat, beat, startBoard)` returns `{ board, beats }` for a whole flat sequence from an
    **arbitrary start board**, not only from home — this is the animation contract.
  - `sequenceStop(flat, startBoard)` returns where a sequence stops being playable, so the last frame can
    never silently render the board *before* a call that could not be played.
- **Level scoping needs no engine change.** `engine/src/sequencer/library.ts` records that "the level IS the
  call set", and `HomeSolver` requires the caller to pass the board rather than holding one. Constructing a
  `Sequencer` per level from only that level's titles therefore gives correct scoping *and* a small
  catalogue — which is what makes a **client-side** sequencer affordable for the Daily (§4.4), and what makes
  server-side generation affordable for the schedule (§7.2). `sequencerCallsUpTo(level)` in `poc/src/data.ts`
  is the existing precedent for pooling call authorings.
- **The renderer extraction was clean, and small — and it is DONE (Phase 0, §13).** The two modules now live
  in the shared package `packages/stage/` (`dancing-squared-stage`), exported as **source** rather than a
  built `dist/` — which is not a style choice: `poc/`'s gate is `tsc --noEmit`, so a package pointing at a
  build would have the app type-checking stale output, and `grid-magnet.ts` must stay loadable by path
  because the probes import it to measure the rule rather than mirror it. Measured at the move: `scene.ts`
  imports exactly `three` and `./grid-magnet`, `grid-magnet.ts` has **zero** imports, and the consumers were
  **11, not the 7 this document first estimated** — 8 import statements across 4 app files (`main.ts`,
  `browser.ts`, `editor-ui.ts`, `sequencer-ui.ts`) plus **4 probe files** that deep-import `grid-magnet.ts`
  by path, one of them also reading it as text. The estimate was the one thing that was wrong.
  - **And the stage only knows the engine, not the app.** Its imports are `three` and its own
    `./grid-magnet.ts` — nothing from `poc/src/dom.ts`, `browser.ts` or the panels. That is why the same
    file can serve two consumers (the POC and the game's two modes) as a package rather than a fork — and
    why the extraction is what unblocks **both** modes at once (§4).
- **Nothing in this repository renders off-browser, and the design no longer needs it to.** There is no
  headless GL and no canvas backend anywhere in the tree (the only rendering is the browser `WebGLRenderer`
  inside `createStage`, now in `packages/stage/scene.ts`). An earlier revision of this document had the
  server rendering the Drill's options to video; **that plan is dropped** (decision 13), so the whole class
  of work — headless render, an encoder, a media bucket, a staleness gate on rendered frames — is out of
  scope rather than deferred.
- **The engine's own search does not answer the Daily's question.** `HomeSolver.reachesTarget`,
  `finishToHome` and `goalFinish` are **private**, and `goalFinish` treats every target other than
  `Static Square` as "reached literally or not at all", with no finish appended. So an arbitrary named goal
  board is not something the shipped search handles, and the game's goal test is a new, small, gated
  addition rather than a reuse (§4.2).
- **There is no shared renderer package, no date-seeded puzzle concept, no drill schedule, and no network
  code anywhere in `poc/`.** `poc/` makes no network calls by rule (AGENTS.md §6), so every call the game
  makes to AWS is new code in `game/` — and so is the authoring side of the regime in §7.2, which is a first
  for this repository: nothing here currently serves an ordered list of puzzles to players.
- **The Mainstream corpus is what the level-1 pool must be carved out of.** `assets/` carries
  `ms` (66 XML files) plus `plus`, `a1`, `a2`, `c1`, `c2`, `c3a`, `c3b`, `discovered` and the `src`
  directory of shared definitions; `engine/test/mainstream.mjs` registers roughly 59 calls from those 66
  files (it asserts ≥ 50), because a file can hold several titles and a file can fail to build. So a call
  pool is **built from the catalogue**, never assumed — and a title, not a filename, is the identity
  (AGENTS.md §8 trap 7).
- **The animation is a known quantity.** `poc/src/player.ts` defaults to 500 ms per beat with a 2 s hold on
  the start and end formations, so a short call is a few seconds on screen. That is why §11 forbids an ad
  during the animation rather than merely discouraging one.

---

## 3. Product

**Audience.** Dancers learning Mainstream who know the individual calls but not how they fit together, and
callers who need to sight-resolve — to see a setup, see where they want the set to end, and know the calls
that connect the two.

**The learning objective, stated so it can be measured against.** The player must internalise *how a call
connects one setup to the next*: which call can be called from here at all, which one moves the set towards
the goal, and how two or three calls compose. The game does **not** teach a whole tip, and it does not teach
the mechanics of an individual call's arm work — the POC already does that.

**The surface.** A home screen with the day's challenge, the player's **next drill in the level's regime**,
the player's level and progress through the current season, and the level's leaderboard. Two modes inside,
one of which is issued once a day.

---

## 4. Where the engine runs, and the contract each side uses

**The engine exists on both sides, and that is a requirement rather than an accident.** The server needs it
to *create* the problems and to check the answers; the client needs it to *play* them. **Both modes need it
on the client**, and for the same reason — the two modes present the same kind of thing (a board, a motion,
a consequence), so the Drill's three options are *danced* rather than shown as video, using the renderer the
Daily already needs. This section is the interface, because it decides what is bundled and what is
version-locked.

| | Server | Client |
|---|---|---|
| Engine | **yes** — every puzzle is generated here (§7) and every submission is re-derived | **yes, both modes** — the Drill to dance its three options, the Daily to play the moves (§4.4) |
| Sequencer | **yes** — generation, validation, re-derivation for scoring | **yes, both modes** — `legalNext`/`applyToBoard` for the Daily's moves, and the Drill's options' endings |
| Renderer | **no** | **yes** — 2D and 3D, for both modes |
| Publish step | a seed and a level, and nothing else | — |

**The consequence worth stating plainly: neither mode needs production infrastructure.** A published Drill
entry is a **seed**, not a rendered artefact, so the same generator call that builds the Daily builds the
Drill — on the client, in the browser, from the level's own call set. The engine being on both sides is what
makes that possible, and it is why the two modes cost the same kind of thing rather than opposite ones.

This section is the interface, so no implementer reinvents it. Everything here is stated in terms the git
history can be checked against; the pieces the engine does **not** have today are named as such.

### 4.1 Applying a call (both modes, and server-side generation)

```ts
// The board is the game's own state, recorded by the move stack.
const result = seq.applyToBoard(currentBoard, callName);
// { board, legal, reason? }  — reason is non-optional on a refusal, by the engine's contract.
```

`Sequencer.apply`/`applyStep` are the stateful form and are what the POC uses; the game holds its own board
and uses `applyToBoard`, so undo and redo are pure data operations over a stack of boards rather than calls
into a mutable sequencer. The refusal `reason` is **engine-owned prose** and is surfaced verbatim to the
player; it is never re-worded by the game.

**A fresh `Sequencer` per level is what makes this cheap and safe on a client.** `CallLibrary` treats "the
level IS the call set", so a level's sequencer holds only that level's titles — which keeps the bundle and
the legality scan small, and is what lets the offering list be exactly "legal from here, at my level" with
no filtering that could drift (§4.2).

### 4.2 The valid next moves, and the goal test (both modes)

**Offered moves** are the level's registered titles, filtered TWICE, and the second filter is not optional: a call
is offered only when it applies to the whole board (`Sequencer.applyToBoard`) **and** `Sequencer.mayOffer(name,
null, board)` permits that reading. The second is what makes `PERMISSION_RULES` visible to a drill at all —
MEASURED at the level-1 pool from a squared set, the geometric question answers 40 with the table installed and 40
without it, so a drill built from legality alone offered `Circle Four Left 3/4` for eight dancers, which the table
refuses and no body measurement separates. `mayOffer` is asked with the board EXPLICITLY: the applier never calls
`setBoard`, so leaving it to the default would check a formation-scoped rule against whatever board the sequencer
was constructed with.

The engine's own `legalNext()` has the same two-part shape and is the contract these lists lean on
(`engine/src/sequencer/sequencer.ts`):

- it lists a call only when it **actually applies interactively**;
- it lists the whole-board reading of a call with no group prefix, and reaches group-named coded calls
  (`Fold`, `Cross Fold`, `Trade`, `Run`, `Step Forward` refuse the bare name by design) through
  `groupCanPerform`, which is the group-aware question;
- it is pre-group and already passes through the permission layer, `mayOffer`.

Because both modes' interaction is "a button that must work when clicked", this is pinned by a probe rather
than assumed: **every call the game offers must apply from the board it was offered on** (§13). The Drill's
options are subject to the same rule — an option that is not legal from the shared start board is not a
wrong answer, it is a *broken question*, and the generator's gates reject it (§7.3).

**The goal test** is an **identity-exact, per-dancer board comparison** against the generator's stored goal
board, keyed on `SeqDancer.id` with a small position and heading tolerance. It is deliberately *not*
`recognize`:

- `recognize` and `knownFormation` **disagree on purpose** on a tie, and on a tie the winner is library scan
  order (AGENTS.md §8 trap 10) — so making correctness depend on a name would make scoring depend on scan
  order;
- the engine's own resolve logic says the same thing in the other direction: "a resolve ends at home by
  identity, not by shape" (`prd.md` §9.5.4).

Naming a board is therefore **display-only**: the game shows the formation name as a teaching aid and never
as the correctness test.

**This is the one engine addition Phase 1 needs — and it LANDED in Phase 1.** A public identity comparison
(`sameBoardById`, in `engine/src/sequencer/board.ts` beside `reorderLike` and `boardSig`) belongs in the
engine because it is a rule the engine owns and a probe must be able to import it, **and because all three
consumers need the same test**: the server decides a submitted run's correctness with it, the Daily's client
decides whether to show the win, and the Drill uses it to label its options. Three implementations of "did
this board arrive" is exactly the drift this design is trying to avoid (AGENTS.md §4.3, §5: "import the rule;
never mirror it"). Its tolerance (`SAME_BOARD_TOL`, 1e-6) and the reason it is a *range* rather than a taste
are in the constant's own comment; the engine harness `board-identity` pins the four properties — including
the one that makes it necessary, that `boardSig` **accepts** a board whose dancers all face the wrong way.
Its refusal of a board whose ids are not unique is **total, including against itself**: the first version
tested only one side and made an identity-less board unequal to its own copy, which is an answer that depends
on argument order.

### 4.3 Animating a call or a list (both modes)

One call and a whole list are the same mechanism:

```ts
const { board, beats } = seq.evaluateSequence(chosenCalls, beat, startBoard);
const stop = seq.sequenceStop(chosenCalls, startBoard);
```

- `evaluateSequence` is driven per animation frame, exactly as `poc/src/browser.ts` and
  `poc/src/sequencer-ui.ts` drive it today, and the resulting board is handed to the shared renderer's
  `DancerView.update(pose, targets, walk)`. **The Drill passes a one-call list** — its three options are
  three single-call sequences — so the Drill and the Daily share this path rather than duplicating it.
- `sequenceStop` is consulted **before** playback: if the sequence cannot be walked to the end, the game
  shows the point it stopped at and the engine's own reason. A last frame that silently renders the board
  before the call that failed is a defect the engine already has a name for. For the Drill's illegal option
  this is the *point* of the option rather than an error path.
- `sequenceBeats` supplies the total, so the progress indicator is not a second estimate of the same sum.

### 4.4 The client sequencer is the same sequencer the server used

The client's `Sequencer` is built from the level's call XML and the engine bundle, and the server builds the
identical one to generate the puzzle and to validate the run. **That is a contract, not a coincidence**, and
it has teeth — and it is *stronger* than it was, not weaker: the puzzles themselves now come from the server (§9),
so what the client's identical sequencer applies is the player's own CALLS (the Daily's line, the drill's dance),
and those have to be the ones the server will replay.

- **The call data must ship with the app, or behind the app's own version.** The client cannot ask the server
  for a puzzle and then apply it with a different catalogue — a single missing or extra title changes the
  offering list and can change whether the intended move is legal at all. So the level's call XML is part of
  the *deployed* artefact, and the level's contents are versioned with it (§7's `poolVersion`).
- **A run is therefore reproducible on both sides and verifiable without trusting the client.** The server
  regenerates from `(seed, level, poolVersion)` and replays the submitted move list; it never accepts the
  client's word for the final board (§10).
- **The interaction is fully testable headless.** Move application, the offering list, undo/redo, the goal
  test and a Drill option's ending are pure engine calls with no DOM, so a probe can play a whole Daily — and
  answer a whole Drill — under Node. That is a better test than clicking through a browser, and it is
  available here (§13).
- **What the client does *not* need: any network call between moves.** The sequencer is local and pure, so a
  move, an undo, a redo and a Drill option's dance are immediate; only starting a puzzle and submitting the
  run touch the API.

---

## 5. Levels and the ladder

```ts
interface LevelSpec {
  index: number;    // 1-based; the leaderboard partition
  poolSize: number; // how many Mainstream titles exist at this level
  depth: number;    // how long the intended solution is, in calls
  optionCount: number; // how many options a step presents (added in Phase 1 — see below)
}
```

**MEASURED IN PHASE 1, AND TWO OF THESE RULES ARE CORRECTED BY IT.** The census
(`node game/tools/measure-ladder.mjs 30 3 50000`) sweeps pool × depth × options at 6–8 seeds per cell and
found that the design's ladder as written **cannot generate puzzles above depth 1**:

| pool | depth 1 | depth 2 | depth 3 |
|---|---|---|---|
| 10 | 3 options, 150 ms | **2 options** only | 2 options, 290 ms |
| 25 | 3 options, 209 ms | **2 options** only | 2 options, 893 ms |
| 35 | 3 options, 295 ms | 3 options, 1304 ms | 3 options, 3345 ms |
| 40 | 3 options, 365 ms | 3 options, 1657 ms | 3 options, 4361 ms |
| 45 | 3 options, 382 ms | 3 options, 1825 ms | 2 options, 7176 ms |

**THE TABLE ABOVE IS STALE BY ABOUT 2×, AND THE CAUSE IS THE LOADER RATHER THAN THE GENERATOR.** MEASURED by
re-running the same census on the current tree (`node game/tools/measure-ladder.mjs 30 3`): worst level **1346 ms**
(L30), level 1 **20 ms**, pool 45 at depth 2 **814 ms** where the table says 1825 ms, and every level's pool
registers in full. The generator is unchanged; `createEngineApplier` is not — it now registers one call per TAM
TITLE (`registerByTitle`) where it used to register each file as a whole document, so every title used to drag its
file's sibling variants into the matcher and pay for them on every legality sweep. The old numbers are kept because
they are what the ladder was DESIGNED against (and the reason the ladder stops at depth 2); the fresh ones are what
a budget should be set from. `game/src/puzzle/levels.ts`'s header now carries both: the old table, labelled as the
squared-set generator's, and the corrections below.

1. **A three-option question needed a pool of 35 — and that was the SQUARED SET's floor, not the pool's.** Below 35 the
   reachable board graph has no route from home whose played-from boards all offer three distinct endings, which is
   why `optionCount` became a per-level value. **RE-MEASURED once the generator began drawing its start from the
   level's own formations (§7): a three-option question generates from a pool of 5** (5 of 5 seeds; 0 of 5 at pool 4,
   where no start offers the three distinct endings the question needs), so `THREE_OPTION_MIN_POOL` is **5**. The
   floor was always the START's fan-out rather than the pool's size, and `optionCount` is per-level now only because
   level 1 ships with two by product decision.
2. **A three-CALL question needs a pool of at least 20 — and that is a hard floor, not a cost.** MEASURED (5 seeds
   per cell) and UNMOVED by the start-board change: at pools 10 and 15, 0 of 5 seeds find a named board reachable in
   exactly 3 calls from ANY of the two named formations those pools declare — there is no goal to offer at all. At
   pool 20 it generates every seed. That is why the ladder's floor is 20 rather than the 10 first proposed: the Daily
   is asked in three calls (§9), and a level that cannot be asked one is not a level of this game.
3. **Depth 3 is affordable now that it is not the client's job.** Its worst case is 0.4 s at pool 20 rising to
   ~4.9 s at pool 55 **from a squared set**; re-measured over the level's own starts it is **1.6 s at pool 20, 2.1 s at
   pool 25 and 4.0 s at the shipped level-1 pool**, because a generation now tries its formations in order until one
   yields a puzzle. It cost the cap on a browser; generation moved to the serving side (§9) and the Daily's publisher
   is a midnight trigger, so the cap is kept for the DRILL only (`MAX_DEPTH = 2`, one call at L1) and the Daily is
   asked in `DAILY_DEPTH = 3` at every level.
4. **THE LADDER THAT SHIPS: `poolSize(n) = 57 + 4·(n − 1)`, `depth = 1` at L1 and 2 after, `optionCount = 3` above a
   five-title pool EXCEPT at L1, which is pinned at two.** That is the owner's four-calls-a-level rule (decision 4's
   shape) on the floor finding 2 requires. **`BASE_POOL` MOVED 20 → 57 SO LEVEL 1 TEACHES WHOLE FAMILIES**: the pool is
   a PREFIX of the teaching order, so its boundary is a count, and at 20 the count landed in the middle of Circle Four
   — `Circle Four Left` in, `Circle Four Right` out. MEASURED by `node game/tools/pool-families.mjs 10`: 57 titles is
   the boundary of the TENTH whole family, and reaching it needed the ORDER grouped into contiguous families (as
   curated it had only two clean cut points, 32 and 37). `pool-probe.mjs` pins that the shipped boundary splits no
   family. Consequences, each measured: a **Mainstream-sized pool fills 74 levels** (was 76) by `publishableLevels()`;
   a Daily costs **~5 s at L1 and ~155 s at L74** measured from a squared set, and **9.4–15.1 s at L1** re-measured
   over the level's own starts (§7.1) — the L74 figure is the old regime's and has NOT been re-measured. Either way it
   is once per (level, day) and cached, and the exponent is the depth, not the constant.
5. **The Daily is three calls at EVERY level; the Drill is one at L1 and two after.** The two modes ask different
   questions of the same progression — `dailySpec(level)` applies the mode's depth where a puzzle is generated for
   the mode — so a level does not carry two depths that could drift apart.

6. **A LEVEL'S REQUIREMENT IS ITS FIRST 10×10 ARRAY — 100 DRILLS — AND LATER ARRAYS ARE OPTIONAL CONTENT.**
   The progress display is the **10×10 block** of §15 Q17 (v), one cell per finished drill, and filling the
   **first** array is what promotes the player. A level that proves popular may be given **additional 10×10
   arrays**: their cells record real completions, but a player does not have to fill them to ascend, so extra
   content can be added to a level without moving the finish line for someone already on it. Q17 carries the
   rule and the correction it makes to the two entries around it; the SUPPLY side is Q17 (iii)'s — the server
   keeps adding unique drills — so an array fills from accumulated entries, not from one season's 13.

So the three bullets below stand as the *design's intent*, and the table above is what the corpus supports.
The gap is recorded rather than papered over: **the design asked for three options at every level, and this ships
what the corpus can actually generate; it asked for depth to rise to 3, and that is now the Daily's question at
every level rather than the Drill's.**

- **L1 = `{ poolSize: 20, depth: 1 }`.** The floor is finding 2's, not a preference.
- `depth` rises 1 → 2 for the Drill and stays; the Daily is `DAILY_DEPTH` throughout.
- **`poolSize` grows by 4 PER LEVEL** from a floor of 57 (decision 4, as re-measured for the family boundary — §5
  finding 4).
- Every level's `Sequencer` is built from **only that level's titles**, so the engine's own legality scan is
  already level-scoped and the "offered moves are limited to the level being played" rule is a property of
  construction, not of a filter that could drift.
- **The level id is the only leaderboard partition.** A player never compares against another level — that is
  explicit in the brief and is why the leaderboard keys in §6 start with the level.

**The pool is a curated teaching order, not an alphabetical slice.** `poolSize = N` means "the first N
titles in this order", and the order is a checked-in data file ordered the way a class meets the calls. Two
reasons it cannot be derived mechanically:

1. A call is only usable in a puzzle once its prerequisites are known, and the corpus gives no such order
   (`PERMISSION_LEVELS` in `engine/src/sequencer/permissions.ts` orders *programmes*, not calls within one).
2. `poc/package.json` and `poc/src/` show the app already treats "the level is the call set" as the model;
   adding a second, finer order is a game concept, and it belongs in the game's data.

**Do not invent the ladder's ceiling.** The maximum `poolSize` is the number at which generation stops
producing puzzles that pass the quality gates in §7 — or at which the offering list stops fitting a phone
screen — and it is to be **measured**. The design states a floor rather than a ceiling: the ladder must
comfortably exceed L1, and if it cannot reach a useful number of levels the finding is the design's problem,
not the player's.

**MEASURED IN PHASE 1: there is no ceiling to find, and `levelSpec` is TOTAL for every integer ≥ 1.** The
census walks 30 levels and all 30 generate, with the pool outrunning the 62-title corpus at L45 — so the
ladder stops only when the *pool* does, and the code has no top level. A consequence the schedule-lint probe
found the hard way: its negative control `levelIndex: 999` **passed as a valid level** (pool 1680, depth 2),
because the formula answers it. The control had to become `0` and a negative index, and a new check now pins
that 999 IS a level — a negative control that passes tests nothing (AGENTS.md §5). So "a level that cannot
generate" is a **measurement to report** (§5's finding 1 is exactly that at small pools), never an index the
code refuses.

---

## 6. Scoring

One currency, so a player's progress reads the same in both modes:

```
score = base(level) × timeFactor(elapsed, par) × wasteFactor(moves, shortest)   [× attemptFactor(attempts)  — Drill only]

elapsed = time-on-the-clock + 60s × hintsUsed        -- see §10
```

- `base(level)` grows with the level, so a harder level is worth more.
- `par` is **derived**, never hand-set: the shortest solution the generator knows, times a stated per-call
  allowance.
- `wasteFactor` is where decision 9 lives. Wandering is legal and undo is free; what it costs is *moves
  beyond the shortest the generator found*, so "try every call until the picture matches" is a losing
  strategy even though nothing forbids it.
- `attemptFactor` exists only in the Drill, where a wrong option is a discrete event.
- **A hint is a time penalty, and that is the whole of its scoring effect** (§10): 60 seconds per hint,
  folded into `elapsed` rather than given its own factor. One term, one place to tune, and it reads to the
  player as what it is — a minute, not a multiplier.

**All weights live in one checked-in config module** so retuning the game is one edit, not a hunt. The hint
penalty is one of them, and the hint cap of 3 is another, so neither is a number buried in a screen.

**The weights are proposed, not measured, and must be calibrated from playtest data before launch.** There
is no playtest data in this repository and there cannot be one before the game runs; a document that
presented these numbers as measured would be the exact fabrication AGENTS.md §4.1 forbids. **That includes
the 60-second penalty**: it is chosen because it is legible, easy to explain and easy to tune, not because a
minute was measured to be the right deterrent. It is worth noting that it is deliberately *dominant* at low
levels, where `par` is one call and a minute dwarfs the solve — that is the intended shape, because a tip
should be worth using and not worth relying on.

**The server clamps every submission** to the maximum score the server can itself recompute from
`(seed, level, elapsed, moves, attempts, hintsUsed)`. A modified client cannot post an impossible number,
and **a client cannot claim a hint it did not spend or hide one it did** (§11) — the hint count is in the
signed-off transcript of the run, not a display detail.

**Two boards, both partitioned by level:**

| Board | Key | Scope |
|---|---|---|
| Daily | `board#daily#<level>#<YYYY-MM-DD>` | One challenge per UTC day **per level**, issued to every player at that level (§9) |
| Drill | `board#drill#<level>#<set>` | The **cumulative** score over one published SET of drills: the schedule is a progression (§7.2, §8), not a daily allowance, so the board accumulates across the set. `<set>` is the `Schedule` row's own version — `seasonVersion(poolVersion, season)` for a season the publisher wrote — and NOT a calendar month (§15 Q17(vii)): a set that is extended or republished starts a fresh board rather than moving the denominator under existing scores |

**One entry per player per board — the player's best — and that is a rule, not a convention.** Without it,
replaying an easy drill repeatedly would out-score one clean run, which is the same exploit the waste factor
exists to prevent (§6). It also means a *repeated* drill cannot be farmed, so pressing "next" through the
sequence and replaying a favourite costs the player nothing but cannot buy them anything either.

**The season boundary is an open question, not an assumption** (§15): the Drill's board key needs a period,
and whatever period is chosen, the schedule and the level ladder must only be re-authored **at a boundary**,
never mid-season.

---

## 7. Puzzle generation

A **pure, seeded, engine-only module**, shared by the client and the server:

```
generatePuzzle(seed, levelSpec, poolVersion) -> Puzzle
```

**The same function runs on both sides, for different jobs** (§4): the server runs it to *create* the problem
and to validate a submission, and the client runs it for the Daily so it can put a board on screen without a
round trip. That is only safe because it is pure and version-pinned, which is what the rest of this section
establishes.

- **Pure and deterministic in `(seed, levelSpec, poolVersion)`.** That is what makes a puzzle shareable by
  seed and verifiable by the server without a puzzle database.
- **`poolVersion` participates in the seed's meaning.** A leaderboard entry is only meaningful within one
  pool version, so a catalogue or order change invalidates old boards **by design**. `poc/src/data.ts`'s
  `dataVersion` is the precedent for a version key that invalidates persisted state.
- **A schedule is a list of seeds, and nothing else.** Because a puzzle is derivable from
  `(seed, levelSpec)`, publishing a regime does **not** require a table of puzzles: the Drill's schedule
  (§7.2) is an ordered list of seeds and the serving layer calls `generatePuzzle` on the requested one. The
  same property is what lets the server validate a Daily submission without storing the Daily.
- **Forward exploration** from the start board under a node budget finds the solvable end boards.
- **The start board is one of the LEVEL'S OWN FORMATIONS, and the seed chooses which.** Every corpus `<tam>`
  declares the formation its call is used from, so a level's pool names dozens of starts — a pool of 57 titles at
  level 1 declares 67, of which the engine builds 44 and can name 20. The generator filters that set with the same
  gates it applies to any board a step is played from, orders it by the seed, and tries the starts in that order
  until one yields a puzzle; a formation that cannot carry the question is not a candidate, and the refusal counts
  it rather than dropping it silently. **MEASURED over the first 100 level-1 seeds: one fixed start gave 5 distinct
  starts, 5 distinct goals and 77 distinct puzzles; the level's own set gives 15–17 starts, 37 goals and the same
  77 puzzles**, at the same 100/100 generation rate. That constant start is the reported *"all drills seem
  identical"*, stated as a number.
  - **The variety is not cosmetic.** A squared set offers 40 of level 1's 57 titles, so `Bend the Line`,
    `California Twirl`, `Cast Off Three Quarters`, `Double Pass Thru`, `Box Circulate` and `Boys Trade` are **never
    offered from it** — a one-start ladder can carry those titles and never ask about them. Asking from the pool's
    own formations is what turns the rest of the level's vocabulary into questions.
  - **The "map the authored subset onto an 8-dancer formation" idea is already the engine's, and it does not
    cover these.** 22 of level 1's declared formations stand up no board at all (`Facing Couples`, `Wave RH`,
    `Box RH`, `Diamond LH`, `Two-Faced Line RH`, `Single Double Pass Thru`, `Opposite Boy`, …) and **every one is
    authored as two dancers**. `library.ts`'s `toWholeSet` already completes a formation's authored half to a whole
    set — four dancers to eight — and deliberately does not double two, because two authored dancers represent a
    **four**-dancer setup. Two-dancer *call* setups are likewise already matched onto eight-dancer boards (`Dosado`
    is legal from a squared set through six two-dancer authorings), so there is no second mapping to build and no
    cache to keep: a two-dancer formation has no eight-dancer board to stand up, and doubling those four through
    the origin lands back on the same four.
- **A reverse BFS from the goal** produces the distance-to-goal map. This is what gives all three consumers
  what they need: the Daily's shortest-solution figure and move allowance, the Drill's option filtering, and
  **the hint's "does this move make progress?"** best look-up (§10) — so the hint needs no search of its own
  and is deterministic from the seed like everything else. It also makes an *arbitrary* goal cheap, which the
  engine's own `getout` is not — that search is built around returning to `Static Square` and appending a
  standard finish, and its frontier cost is the reason the plan records search shape carefully (AGENTS.md §3,
  the L × C refutation).
- **Quality gates — constraints that reject a seed and retry, never warnings:**
  - the puzzle is solvable, and the shortest solution is exactly `depth`;
  - the **goal** board must be a **formation the corpus defines** — not necessarily one the curated recogniser
    *names*. `recognize` is a caption vocabulary of twenty-odd standard names, deliberately narrow because a board
    congruent to several corpus formations would otherwise get a confident wrong label; "is this arrangement one of
    ours" is a different question, and `GameApplier.formationOf` answers it against every formation in `formations.xml`
    with the same matcher and threshold. MEASURED at level 1: the one-call outcomes accepted as goals go from **91 to
    206** of 303, **13 start formations go from blocked to usable**, and 24 of 40 sampled goals are formations the
    curated recogniser cannot name — a formation is valid because the corpus defines it, not because it has a
    comfortable name. The caption prefers the curated name and falls back to the corpus one. **THE START DOES NOT HAVE
    TO BE NAMED** and this used to require it: reported as
    *"the drills seem to contain many duplicates"*, and MEASURED, 24 of level 1's 44 declared formations have no
    recogniser name, so the naming gate restricted the whole 100-drill block to 20 starts — and the caption over the
    start board says "Setup, k of n" either way. An unnamed INTERMEDIATE is not refused and must not be: it is a legal
    state the engine simply has no template for, the player never sees it named, and MEASURED at L2/pool 15 most
    depth-2 states are unnamed, so a gate on every board would leave the level with no puzzles at all;
  - **a goal candidate is a BOARD, not a `boardSig`**, which was the other half of the reported duplication. `boardSig`
    is positions-only (AGENTS.md §8 trap 11), so two goals that differ only in FACING were one candidate: MEASURED, a
    level-1 start's named one-call goals are 1..17 by pose and 1..6 by signature. A player sees the picture, so the
    picture is the identity. MEASURED ON ONE ENGINE, seeds 1..100: **37 distinct (start, goal) pictures before this and
    the validity change, 52 after** — 24 starts becoming 35; over 400 seeds, **60 → 98** pictures and 26 → 41 starts.
    THE SPACE IS STILL FINITE AND SMALL: 98 distinct pictures at level 1 even over 400 seeds, so a 100-drill block
    cannot be duplicate-free at this level; a block that were one would need the goal side widened further, or a
    schedule rule that picks seeds against the pictures already used;
  - the start and goal boards are distinguishable at a glance, so the puzzle is not solvable by "they look
    the same";
  - the start offers at least as many legal calls as the question has options, with distinct endings, or the
    question cannot be asked from it at all;
  - at each step there are at least the number of distinct endings the mode needs (three for the Drill);
  - the goal board is reachable by **more than one** call path where possible (see below).

**Correctness is the goal board, not the generator's route.** A player who reaches the goal by a different
sequence is correct and is scored as correct. The generator's own path exists to give the puzzle a shortest
length, a par, and a "show me the answer" replay — not to constrain the player.

**Both modes are published, not derived on the fly.** The Drill's seeds are curated into a schedule ahead of
play (§7.2), and the Daily is generated ahead of the UTC boundary that publishes it (§9). In both cases the
gate that the generator passes at authoring time is the gate it passes forever, because the function is
pure — so "this seed is good" is decided once, by machine, and never by the player discovering a bad puzzle.

**And a published entry is a seed and nothing else** (decision 13). The schedule stores no puzzle, no board
and no media; the SERVING LAYER regenerates the entry from `(seed, level, poolVersion)` with the same call the
Daily uses, which is what keeps the two modes on one generator rather than two. What the client receives is the
result, not the seed alone (§9).

### 7.1 Generation performance — the one real risk, so it is measured

The call pool is small by construction (it is the level), and a published entry is a seed rather than a
pre-built puzzle. The generator therefore runs **on the serving side** — to create the puzzle and to validate the
run — and, since the client no longer generates, its cost is a **publish-time and per-request** cost rather than a
browser's. The client still runs the ENGINE (to apply calls and to draw them), which is why the same budget bounds
the hint's search, but a level that takes seconds to generate is now a loading state on the server rather than a
hung tab. No unmeasured budget ships.

**MEASURED (Phase 1, committed with this file): `node game/tools/measure-ladder.mjs 30 3 50000`** — 30
levels, 3 seeds each, 50 000-node budget:

| | value |
|---|---|
| levels that generate | **30 of 30** (every published level) |
| worst level | **4959 ms** (L23; L25–L30 all 3.3–4.9 s) |
| largest exploration | **194 states** (L28–L30, pool 55) |
| cheapest level | 460 ms (L1) |

So the budget is pinned at **50 000 nodes**, and the client's worst case is **~5 s** — which is the number
Phase 2's loading state has to cover. The exploration count is far below the budget (194 against 50 000),
which is why raising the budget changes nothing: what bounds these levels is the **reachability structure**,
not the search cap. Depth 3 was measured too and is **capped out of the ladder** — see §5's corrections.

**RE-MEASURED after the start-board change (§7), because that is the one thing that made every published level more
expensive.** Over the first 100 seeds of each level, mean generation time is **41 ms at L1 (depth 1), 468 ms at L3 and
488 ms at L6 (depth 2)** — against **13 / 56 / 52 ms** for the same seeds with the start forced to a squared set. So
opening on the level's own formations costs about **8×** on the drill path, and the reason is structural rather than
wasteful: a start that has to be refused pays for its own exploration first, and refusing one is how a level with
twenty formations finds the ones that work. Three things keep that in proportion — the population that pays it is the
**serving** side, where a puzzle is generated once per seed and then cached (`api/src/levels.ts`); a level's 100 drills
are generated by the SCHEDULE PUBLISHER rather than by a player's press; and the DAILY, at three calls, was re-measured
in the same sweep at **9.4–15.1 s** against **7.8–13.9 s**, which is inside the cost it already had and is why §9 gives
it a midnight trigger instead of a request budget.

### 7.2 Authoring the regime (the schedule pipeline)

The schedule is code-adjacent data, so it needs the gate every generated artefact in this repository needs
(AGENTS.md §4.3: "a generated artefact needs the gate that fails when it goes stale"), plus the two checks
that are about policy rather than mechanism:

- **Every seed in the schedule passes the §7 quality gates for its level**, or the build fails. A schedule
  published with one bad puzzle is a bad puzzle served to every player at that level simultaneously.
- **A seed is MEANINGFUL only against the level it was validated at — and this is NOT because it fails
  elsewhere.** The first draft of this rule said reusing a seed at another `poolSize` "would return a
  *different* puzzle", and Phase 1 measured exactly that, but also measured that the failure mode people
  would expect does **not** happen: of 60 seeds that generate at L1 (pool 10), **60 also generate at L3**
  (pool 15) — while **20 of 20 produce a different goal and a different solution**. So cross-level reuse is
  not an error to be rejected; it is a puzzle that has been validated at the level that declares it and is
  simply a different question there. What the lint must catch is the case that IS an error: **a seed that no
  longer generates at its declared level**, which is what makes a schedule go stale after a pool, ladder or
  generator change. The level travels beside the seed because it is part of the puzzle's identity, and the
  lint re-runs the generator rather than trusting the author's memory.
- **The order is the contract.** The gate pins that the schedule is non-empty, ordered, and advances; the
  design does not pin a count, because the count is a season-length decision (§15).

### 7.3 Drill question construction (the puzzle, as the engine presents it)

The constraints the generator must satisfy, or the seed is rejected:

- **Step 1** may be `1 correct + 1 legal-but-wrong + 1 illegal`. The illegal option is what teaches "that
  call cannot be made from here", and it is only legible at the start, where the player is reading the
  current board for the first time.
- **Later steps** are `1 correct + 2 legal-but-wrong`. A dead end placed behind a call that *is* legal would
  punish a player who has reasoned correctly so far, which is the wrong lesson.
- **All three endings must be distinct boards.** A distractor that reaches the goal is **reclassified as
  correct**, not offered as wrong — otherwise the game tells a player who found a genuine alternative that
  they were wrong.
- **The illegal option's reason is the engine's own string**, displayed verbatim — and, since §8's correction, the
  option itself is **drawn from the whole refused pool and placed by the puzzle** (`PuzzleStep.unknownIndex`) rather
  than being the alphabetically-first refusal in last position. It must not be tellable from the other buttons: which
  call is illegal and which slot it sits in are both the puzzle's business, and neither is a constant.

**CORRECTED IN PHASE 1 — the illegal option CANNOT be one of a step's options, and this is provable rather
than a preference.** An illegal application returns the board *unchanged*, so an illegal option's "ending"
would be the current board — and the §7 gate that the start and goal are distinguishable guarantees the
current board is not the goal, which is what makes it a viable WRONG option but not a third *distinct
ending*. Requiring three distinct endings and admitting an illegal member are mutually unsatisfiable. The
implementation therefore has **`moves`: exactly `optionCount` legal options with distinct endings**, and a
**separate `step.unknown = { call, reason }`** authored from the engine's own refusals — which is also why
the game's engine seam has `candidateCalls()` at all (a refusal can only be found by naming a call and
asking). §4.2's wording "one correct, one legal-but-wrong, one illegal" is therefore a description of what
the *player* sees, not of the option array.

**AND THE "CORRECT" OPTION IS NOT "AN OPTION THAT REACHES THE GOAL" — except on the last step.** This was
the Phase 1 bug that made depth 2 generate **0/8 at every pool size**, and the arithmetic is worth keeping:
the goal is at distance `d`, and a board at distance `i < d − 1` cannot reach the goal in one call, because
a move from distance `i` lands at distance at most `i + 1` — so a one-call route would mean the goal was at
distance `i + 1 < d`, contradicting the BFS. The correct rule is the design's own *"makes progress"*: a
correct move **reduces the remaining distance**, which on the last step is the same statement as reaching
the goal. Requiring goal-reaching at every step was asking for a solution shorter than the puzzle's own
distance.

**Each option is a one-call `evaluateSequence` on a shared start board** (§4.3), so the question is the same
board shown three ways. Four rules follow from the options being **computed on the client** rather than
rendered ahead of time:

- **All three options start from the identical board, with the identical camera, floor and dancer set.** Only
  the motion differs. **This is a fairness rule, not a style rule**: it is what makes the three options
  comparable, and it is why the options are generated as one puzzle rather than assembled from three
  independent ones. It also falls out of the design rather than being maintained — they literally share the
  generator's start board.
- **The option order is shuffled per issue and stored nowhere**, because the seed determines it: the generator's
  rng is what shuffles, so the order is reproducible from `(seed, level)` without a published
  index — and now the server hands the ordered options over, so there is nothing to reproduce.
  (An earlier revision had to publish a `correctIndex` because the answer had to survive a video
  cache; with the engine on the client there is nothing to survive.)
- **Correctness is the goal board** (§4.2) for the same reason it is in the Daily: an option that reaches
  the goal by any legal route is correct, and the generator's chosen route does not decide the answer.
- **The endings are precomputed when the entry loads**, not when a button is pressed, so the interaction is
  instant and the presentation scope stays open: a thumbnail of each ending, a caption naming the call, a
  replay of all three back to back, or a reveal in sequence are all available from the same data with no
  change to the engine contract.

### 7.4 Why the presentation has room to move (and why that is a design goal)

The options are *data* — three single-call sequences from one board — so the way they are shown is a UI
decision rather than a pipeline decision. That is the practical argument for decision 13, and it is worth
recording because an earlier revision of this document fixed the presentation in advance by rendering it to
video: a caption, a slow-motion replay, a side-by-side of two endings, or a labelled motion are all
presentation options that cost nothing to change, where a rendered artefact would have had to be re-rendered
for each. **No rendered asset, and no encoder, is part of this design** (§2).

---

## 8. Mode A — the Drill (the level's regime, served in order, danced as options)

**The order is not the player's to choose.** Per decision 10, every player at a level follows the same
regime in the same order. The schedule from §7.2 is what the server serves, and the client's job is to
advance through it — it never picks a seed, and it cannot skip one without the server having issued the next.

**The client runs the engine here, exactly as it does for the Daily** (decision 13, §4). A published entry is
a seed, and the serving layer sends the boards it generates from that seed; the client animates them with the
stage it already needs. Nothing is pre-rendered, so the presentation is data rather than media (§7.4), and the
answers cannot drift between the client and the server, because there is now only ONE derivation — the server's.

- **Two boards on screen — the current WAYPOINT and the next one — and three answer buttons.** A puzzle is a
  sequence of waypoints and a waypoint is a formation (§9.1), so the pair is two adjacent entries of that sequence:
  the left board is where the player stands (their own board, which can leave the generated route in the Daily) and
  the right board is the waypoint to reach. Each carries a **border** — green solved, blue next, red locked — and a
  **paging arrow** at each edge walks the window along the route when there is one to walk; a start-and-end puzzle
  has a single pair and no arrows. Pressing one *dances*
  that option, then gives its verdict. The player can replay an option as often as they like before
  committing, which is the presentation room the engine buys (§7.4): a replay, a caption, a slow pass and a
  side-by-side are all the same data.
- **The framing of the question is a teaching decision with two readings,** and both use the same three
  options: *"which call is this?"* (name the motion) and *"which one gets you there?"* (choose the motion
  that reaches the goal board). **Recommended for v1: the second**, because it is the skill the game exists
  to teach and it needs no call-name vocabulary the player may not have.
- **The illegal option is the lesson.** It stops part-way, and the engine's own refusal reason is shown
  verbatim — the same reason string the Daily shows, from the same `applyToBoard` result (§4.1).
  **AND IT MUST NOT BE RECOGNISABLE BEFORE IT IS PRESSED**, which is two rules and both were defects once
  (reported: *"the third drill option always seems to be 'Adjust to an Alamo', and its outline is in red, a dead
  giveaway"*). (i) **The call is drawn from the whole refused pool** by the puzzle's rng, not from the
  alphabetically-first refused title: MEASURED over 100 level-1 seeds, that rule produced **one call in every
  one of them**, which is a button a player learns to ignore rather than a question they reason about — it is
  now **44 distinct calls over the same 100 seeds** at L1 and 48 at L3. (ii) **Its POSITION is the puzzle's**
  (`PuzzleStep.unknownIndex`, `0..optionCount`), because the screen used to append it last, so the slot alone
  gave it away; the positions are now spread across all of them (L1: 42/28/30 across three slots). (iii) **It
  carries no styling of its own** — there is deliberately no `.answer.illegal` rule and the screen sets no
  class, so the only feedback is the engine's refusal after the press. `puzzle-core-probe.mjs` §4b pins (i) and
  (ii) against the rule that shipped; (iii) is CSS and is not probeable, so it is stated here.
- **The legal-but-wrong option is the discrimination.** It dances a real call that lands somewhere else, so
  the player has to read the end board rather than spot a failure.
- **A player's position in the regime is theirs** (decision 11). Everyone's first L1 drill is the same
  puzzle; a player who arrives late starts at the beginning of the order rather than being thrown into the
  middle of it, because the point is to follow the progression, not to catch up with it.
- **A drill is locked when it is issued.** Resuming a part-finished drill the next day resumes *that* drill.
  The consequence is deliberate and is stated because it is a real cost: a schedule edit cannot rewrite a
  drill already handed out, so the fix for a bad puzzle is a new schedule entry, not an edit to an old one.
  (This is also why §7.2's gate runs before publication rather than after.)
- **Issuing a drill, resuming one, and fetching the next are server decisions.** The client asks for "the
  drill I am on"; the serving layer answers with **the seed, the level and the puzzle itself** — every step, every
  option, every board and the answer key (§9: the client generates nothing). Which entry is
  next, and whether the previous one is finished, are facts the server owns — which is why the endpoint in
  §11 is not a `GET /puzzle` by seed for this mode, even though the client could apply one.
- **The score is cumulative over the regime** and the board accumulates across a season (§6), with one entry
  per player: their best. Re-playing a drill the player enjoyed cannot buy them a place.
- **Anonymous play still gets the regime — as a DEMO.** The Drill is the funnel, so a signed-out visitor can be
  issued a drill and play it; nothing is submitted, scored or stored, and the progression is not theirs. Signing in
  is what makes a run count, and a device's own ledger can then be imported as unranked history (A26). A
  non-member is following the same regime in the same order; they simply have not published a score.
- **Level changes mid-regime** move the player into the new level's regime at its start, because a drill
  validated against one `poolSize` is not a drill at another (§7.2).
- **A drill's answer is a single choice, so the timing rule is short.** The clock starts when the entry is
  shown and stops on the answer; there is no move-by-move play to time beyond that (§6). Replaying the
  options is not penalised separately — the clock already counts it, which is the same "wandering costs
  time" rule the Daily's undo runs on.
- **THE LEVEL BLOCK IS WHERE THE TAB OPENS, and a cell is the way into a drill.** The tab has TWO VIEWS and still two
  MODES: `drillView: 'level' | 'drill'` sits beside `mode`, and entering The Drill still ISSUES a drill — because
  "which drill is next" is the server's `nextIndex` and the drill it issues IS the next one, so the grid takes `next`
  as an INPUT and never derives it (§15 Q25(a),(j)). **TWO STATES ARE LINKS**: the NEXT cell, and a cell that was
  closed WITHOUT being passed — a skip or a revealed solve, which `POST /drill/replay` reopens so the player can go back
  and earn the pass (§15 Q25(a), corrected). Every other cell is a statement: a PASSED drill has nothing left to earn,
  an unfinished one the server has not handed out is an order question and not the player's to choose, and an
  unpublished cell is a statement about supply rather than a lock. The rule that decides a cell's state is
  `puzzle/block.ts` (five states, precedence `unpublished` > `done` > `next` > `published`, so a stale `next` cannot
  repaint a finished cell) and the rule that decides WHICH states are pressable is `isReplayable` beside it — both gated
  by `test/block-probe.mjs`; the screen is left with paint.

---

## 9. Mode B — the Daily Challenge (once a day)

**THE PUZZLE IS THE SERVER'S; THE ENGINE IS STILL THE CLIENT'S, AND THE TWO ARE NOW DIFFERENT JOBS.** A puzzle used
to be derived in the browser from `(seed, level, poolVersion)`, and this section used to say so. It does not any
more: `GET /puzzle` answers with the **boards**, because "generated on the server, applied on the client" is the
arrangement that makes the challenge identical for everyone by construction rather than by two implementations
agreeing. What stays on the client is the part that cannot: the player adds and removes calls and must see the
consequence immediately, so `applyToBoard` runs locally with no round trip. The API is touched to fetch the
challenge's boards and to submit the run.

**WHY THE REVERSAL, since it costs a payload.** Determinism was never the client's problem — the same seed and pool
give the same puzzle on both sides, and `game/test/puzzle-core-probe.mjs` pins it. The problem is the CORPUS: a
puzzle is only reproducible while both sides hold the same call set and the same engine, and `poolVersion` catches a
pool change only for a client that agrees to check. A served puzzle makes the question a fact about the payload.
The cost is a body of ~8 boards per drill, measured at `api/src/levels.ts`.

**WITH NO API CONFIGURED THERE IS NO DAILY, and that is a decision rather than an omission.** The mode's premise is
a challenge PUBLISHED for a level and a UTC day: the boundary job validates it, everyone at the level gets the same
one, and the server scores against it. Nothing publishes without a server, so the panel says so rather than deriving
a seed on the device — which was, until it was removed, the last place on the client that still ran the generator.
The DRILL still plays offline, from a BAKED fixture season (`game/src/game/season-data.ts`, written by
`game/tools/bake-season.mjs` and gated by `game/test/schedule-fixture-probe.mjs`): data the build ships, not a call
it makes. `game/test/client-generation-probe.mjs` walks the app's import graph and fails if the generator is
reachable from it at all, so "no puzzle is generated on the client" is a property a gate checks rather than a rule
the code keeps by habit.

**THE CHALLENGE IS PRODUCED BY A MIDNIGHT TRIGGER, NOT BY A READ.** A scheduled job runs the boundary
(`api/src/daily-publishing.ts`, `npm run api:publish-daily`) just before the UTC day turns, and that job is what
generates every level's challenge for the day. It is the right place for the work for three reasons: generating one
Daily costs seconds — MEASURED at **9.4–15.1 s** at the shipped level-1 pool after the start-board change (§7.1) —
the challenge is then a batch the operator can validate before anybody plays it, and the cost lands at a boundary
rather than on a player's first request of the day. `GET /puzzle` still derives the puzzle from the stored seed when
its own cache is cold, because the stored artefact is a SEED (decision 13) and a read must not depend on the trigger
having run in this process; what the trigger decides is that the day EXISTS. A day nobody published stays
`404 no_published_daily` rather than becoming a puzzle invented on demand (§9's "the server never invents a
challenge").

- **One challenge per UTC day *per level*, issued to every player at that level** (decision 8). The day is
  computed in **UTC** so it flips at the same instant for everyone and a late-night player is not on a
  different challenge from their friends. The seed therefore has to bind the level — `seed = hash(level,
  YYYY-MM-DD)` — because the same date must produce a *different* puzzle at a different `poolSize` (§7.2).
- **"The same challenge to all players" is per level, and that is the whole of it.** Each level's challenge is
  generated from **that level's** pool and issued identically to every player at it, so the challenge always
  sits inside the calls the level knows and `depth` is satisfied by construction. A player at L4 and a player
  at L7 are given different puzzles on the same day; every player at L4 is given the same one. Nothing else in
  the mode depends on the level, and nothing about it depends on another level.
- **The offering list is what is legal now**, per decision 9 — not what is still solvable. Dead ends are the
  player's to discover, and the score is what makes discovering them cost something.
- **The list is GROUPED BY THE READING, and that is the mode's second half.** The engine's `applicableMoves` gives
  every legal move with the reading that performs it — the whole board (`selection: null`, headed **All 8**) and
  each subset that can perform the call ("Heads", "Head Boys", …) — and what the player clicks plays the group's own
  spelling ("Heads Dosado"), which is what the client applies, what `POST /daily/move` records and what
  `POST /runs` replays. MEASURED at pool 36 from a squared set: **370 readings against 35 whole-board calls**, in 14
  sections, and **322 of the 335 shared-call readings end on a different board from the whole-board reading of the
  same call** — so a list built by filtering `offered` cannot express them in either direction. The picker asks on
  every view (each move, each undo), which is why `createEngineApplier` caches the list **by full pose and identity**
  — NOT by `boardSig`, and that is a correction the probe made: a call that changes only FACING returns the same
  board signature and a different question, so a positions-only key served the previous board's list.
  `game/test/daily-readings-probe.mjs` pins all of it.
- **A group-only call — one a subset can perform and the set cannot — is legal here too**, and it is the engine's
  harness that builds the case (`engine/test/group-refusal.mjs`), because the squared set at a real level's pool
  offers 35 of its 36 titles whole-board and the situation does not arise within one call of the start.

- **The challenge MAY carry waypoints, and they GUIDE the route rather than gate it.** A Daily can show an
  ordered sequence of **formations and arrangements** between the start and the goal, and the player is helped,
  not policed: correctness is still the GOAL BOARD, so a route that reaches it another way still wins. The unit
  is the **arrangement**, not the name — §9.1 measures why a name cannot key one (all three waypoints of the
  sample route were `Static Square`) and why the congruence `geometryKey` computes is exactly the equivalence a
  waypoint wants. The sequence is the generator's own route (`puzzle.path.slice(1, -1)`), so a waypoint cannot
  disagree with the solution; progress is monotone over the boards the player actually stood on, so an undo
  rewinds it for free; and a challenge may carry **zero** waypoints at all.

### 9.1 Can the server solve the Daily outright? Measured, and no — but the measurement says what to do instead

The proposal was: once per puzzle, before publication, enumerate every choice to the allowance and ship the result,
so the client can warn on a dead end and refuse a circular line. Measured on the CHEAPEST level (pool 20, a
three-call Daily, allowance five), forward from the start over EVERY reading:

| calls | boards (new) | distinct lines | edges | cumulative CPU |
|---|---|---|---|---|
| 1 | 97 | 192 | 192 | 0.5 s |
| 2 | 5 366 | 22 480 | 11 920 | 29 s |
| 3 | 247 927 | 2 546 477 | 624 487 | **23.4 min** |

and the answers it would buy, from the same run:

- **Exactly ONE three-call line reaches the goal**, out of 2 546 477 distinct lines.
- **252 388 of the 252 389 boards at three calls are dead ends** — the goal is not reachable in the two calls left.
- The goal-side table to depth 2 (what a warning would consult) holds **1 board**.
- Shipping the artefact would cost **16.9 MB** of pose keys at three calls alone, before the four- and five-call
  layers the allowance also permits.

So the tree is neither shippable nor affordable per puzzle, and the cost grows with the pool — the level-5 pool is
eighteen times the titles and the top of the ladder is 320. **The design does not need it**, for a reason the same
run exposes: the graph does not branch into interesting states, it branches into *the same* states. 192 readings from
the start land on **2 distinct recognised arrangements** — 112 on `Static Square` and 80 on boards the recogniser
refuses to name. The route itself is `Static Square → (unnamed) → Static Square → Static Square`.

**That last number is the finding, and it kills two rules that looked free:**

1. *"A call must end in a known formation to be valid"* — with today's recogniser this would refuse **80 of the 192
   legal readings (42%)** and accept 112 that are all the same name. Validity by name is not a filter, it is a coin
   toss that happens to be stable.
2. *"Waypoints as a sequence of named formations"* — the names are rotation- and reflection-invariant, so they cannot
   tell the route's stages apart: all three waypoints above are `Static Square`. A waypoint sequence keyed on the name
   is degenerate by construction.

**What the arrangement that CAN be keyed is.** The engine already has `geometryKey` (`engine/src/sequencer/cells.ts`):
positions AND headings, taken over all eight rotations and both reflections — "two boards share a key precisely when
the matcher would call them congruent", which is exactly the equivalence a waypoint wants. So the shape of the mode
that survives this measurement is:

**THE SEQUENCE IS BUILT** (`game/src/puzzle/arrangement.ts`, `puzzle/waypoint-pair.ts`, `DailyRun.view().waypoints`,
`DrillView.waypoints`, the route line in the Daily panel, and the two boards themselves):

- `arrangementKey(board)` is `geometryKey(boardMatchables(board))` — the engine's own congruence — and the puzzle's
  waypoints are derived from `puzzle.path` by `waypointBoards`, so the sequence is the generator's own route rather
  than a second one.
- **A WAYPOINT IS A FORMATION, so consecutive equal formations collapse.** A call that leaves the set in the
  arrangement it was already in reaches no new waypoint. MEASURED over 24 generated level-1 routes: **16 of 24 repeat
  a formation in consecutive stages** and every repeat in the sample is a consecutive one, so the waypoint count is
  **2..4** where the board count is 4. A RETURN is still a new waypoint (A → B → A is three), which is what makes a
  round trip cost a call.
- progress is `waypointReached(waypoints.slice(1), boardsStoodOnInOrder)`: a monotone count over the formations the
  player actually stood in, derived from the move stack in the Daily and from the route prefix in the Drill — so an
  undo rewinds it for free and it cannot disagree with the line the server replays.
- **the boards ARE the sequence**: the stage shows two adjacent waypoints with a border on each (`waypoint-pair.ts`
  decides which two and what each says), the arrows page the window along the route, and the panel shows the same
  list as text. It is a readout, not a gate: correctness is still the goal board, and no call is refused because a
  waypoint is ahead.

MEASURED, and it is the number that justifies the arrangement being the unit: from a squared set, **143 of 192 readings
leave a different arrangement and 49 leave the SAME arrangement on a DIFFERENT board** — a quarter of the legal moves
change the setup without changing the stage. A call-name rule cannot see that; a pose rule would call all 192 distinct.

- a **waypoint** is a congruence class of arrangements (`geometryKey`), not a board pose and not a display name;
- the puzzle carries an ordered sequence of them, and the route is legible as a sequence of PICTURES, with the
  recogniser's name as a caption where it has one;
- correctness at each step is "the board you are on is congruent to waypoint *k*", which is decidable, cheap
  (`geometryKey` is a string comparison), and never depends on the goal pose or on the player's line matching the
  generator's;
- a **dead end** then means "no waypoint-advancing move is left", which is a local question the picker can answer
  without a shipped graph — and it is the warning the mode would want, rather than a warning about a tree.
- **Circularity needs no analysis at all**: MEASURED, a reading that changes nothing is rare (0 self-loops from the
  start at pool 20), and a repeated ARRANGEMENT is visible in the waypoint state — a line that returns to a waypoint
  it has already satisfied is exactly the case the sequence is there to make impossible.

**What is NOT built, and should not be re-derived.** Waypoints are not yet a CORRECTNESS test (the goal board is), and
the generator does not yet REQUIRE distinct arrangements — it does so by luck, 11 routes in 12. Making the sequence
gating is the next step, and it is a generator change with a re-bake, not a display change. And the numbers above are
why "solve it on the server" should not be attempted again: 23 minutes for the cheapest level, one solution, and a
display name that cannot tell its own route apart.

### 9.2 Parallel calls for two subsets: measured, and why they are not a client change

The mode was specified with "parallel calls for different subsets of dancers, similar to the POC sequencer". The
cheap reading of that is a composition: play `Heads Circle Left Home` and `Sides Single Circle Left` — selections
confined to their own dancers — one after the other, and if the order did not matter a parallel step would need
nothing new on the wire. **MEASURED, from a squared set at pool 36, 40 pairs of disjoint-selection readings: 23 were
legal in both orders, 11 produced the same board either way and 12 produced DIFFERENT boards.**

So order decides the outcome, and the feature is not a game-side composition.

**CORRECTED — THE ENGINE DID HAVE THE PRIMITIVE, and this section said it did not.** A `GroupStep`
(`{ groups: [{ selection, calls }, …] }`) is applied as one step by `Sequencer.applyToBoard`, and
`engine/test/parallel-calls.mjs` and `modules.mjs` already pin the rules (disjoint, atomic, simultaneous, one undo). What
was genuinely missing was the WAY BACK: `stepLabel` wrote a step down as text and nothing read it back, so a parallel
step could not travel as the string the game's line is made of. That is now in place:

- `parseStep` (engine, `a2f1203`) is the inverse of `stepLabel`, pinned by `engine/test/step-parse.mjs`: the round trip,
  the APPLY invariant (the parsed step dances the same board), and the refusals.
- `createEngineApplier` (game, `62d7dfc`) routes any line element containing ` || ` through it, so
  `Heads Allemande Left in the Alamo Style || Sides Allemande Left to an Alamo Ring` is one element of a line, legal,
  with both groups moved — pinned by `game/test/parallel-step-probe.mjs` against the engine's object form as the oracle.

**THE PICKER COMPOSES ONE TOO, AND THE GESTURE IS THE MODE.** A plain click **plays** the reading — the common case, one
press, and the run is scored on the clock, so an extra press on every move would cost the player real time. A
**Shift-click** arms a reading as the first half of a two-group step; with one armed, a click on a reading for a
**different** group plays both at once as the label `A || B`, a click on the armed reading cancels, and two readings of
the SAME group are not a pair — `parallelLabel` returns null and the click re-arms instead — because that is a sequence,
and the measurement above is exactly why it must not be sold as a parallel step. The hint line above the list carries
both halves of that instruction, because a gesture nobody is told about does not exist. **THE COST IS RECORDED: composing
needs a Shift key, so the two-group step is desktop-only.**

**THE FIRST VERSION OF THIS SHIPPED BROKEN, AND NO GATE SAW IT — that is the durable part.** `b4d1d43` armed on every
plain click and never called `play`, so a single call had no path at all and the Daily was unplayable past its first
move. MEASURED in a real browser against the built app (`npm run dev:game` over `npm run dev:api`), while the code
comment, that commit's message and this section all said "a click with nothing armed plays the reading" — a sentence
that is also self-contradictory, since a click that has already played cannot be half of a pair with a second click.
`game/test/parallel-step-probe.mjs` was green throughout because it measures the COMPOSER, not the rule that decides what
a click does, and the rule could not be imported at all while it lived in `ui/daily-screen.ts` (bare Node refuses that
class). The rule is now `puzzle/arming.ts`'s `decidePick`, and `game/test/picker-interaction-probe.mjs` pins every row of
its table — including `an unarmed plain click PLAYS`, the one check the shipped rule fails — with the three plausible
wrong rules run beside it as negative controls. `game/test/parallel-step-probe.mjs` still pins the composer against the
applier, so the two spellings cannot drift.
- **Add a call, remove a call, see the consequence.** The sequencer is local, so this is immediate: `legalNext`
  offers the available calls from the board the player is standing on, `applyToBoard` advances it, and the
  board is redrawn from the engine's own poses. This is the interaction the mode exists for, and it is the
  Drill's counterpart: one mode *names the motion*, the other *builds the line*.
- **Undo/redo is a standard move stack.** Undo pops the current board and pushes it to the redo stack; a new
  call made after an undo truncates the redo branch. Both are free and unpunished; what they cost is the
  clock and, ultimately, the waste factor.
- **The move allowance** is the generator's shortest call count **plus a cushion** (a stated, calibrated
  number). It exists because with free undo and honest offerings, an unlimited allowance would let a player
  reach any displayed board by elimination — the allowance plus the waste factor is what makes that lose.
- **The challenge is issued, so it is generated ahead of the boundary that publishes it.** A scheduled job
  generates each level's challenge before 00:00 UTC and publishes it, so "the same challenge to all players"
  is true at the moment the day changes rather than true once someone happens to load the page. It is
  generated **once** and stored: the serving endpoint reads what the job published rather than generating per
  request, so the cost is one generation per level per day and every reader sees the same artefact.
  **There is deliberately no fallback**: if the job has not run, the challenge is unavailable and says so,
  because the two alternatives are worse — serving an unvalidated puzzle to everyone at once, or letting each
  request invent its own and quietly breaking the shared challenge.
- **Past dailies stay playable** (each day's seed resolves to the same puzzle forever, by construction); only
  *today* feeds *today's* board, so missing a day costs the entry and nothing else.
- **Review**: on solving, or on giving up, the player can replay their own line and the generator's shortest
  line, with the engine's own names and reasons. This is decision 4, and it is the same component the Drill
  uses — the only difference is the input, since the Drill replays a single option where the Daily replays a
  whole line.
- **A hint is available for this mode** (§10), and the move allowance is what makes a hint *worth having*:
  the allowance bounds how much elimination a player can do, so a nudge towards the answer is a real nudge.
  Taking one adds a minute to the clock and is never refunded, so the hint appears **where the cost is paid**:
  on the elapsed-time readout, not as a separate number to reconcile.

---

## 10. Hints

**Concept: hints are earned on the drill line and spent on the Daily.** The regime is what you grind; the
daily is where grinding pays off. All numbers below are in the one scoring config module (§6), so retuning
them is one edit.

**1. Earning.** **One hint per 10 successful Drill puzzles, to a maximum of three held at once.**

- **What counts as "successful": a correct answer, whether first try or after replays.** The alternative — a
  clean first attempt — was rejected because it makes the earner feel like a test rather than a reward, and
  because the Drill already prices a wrong answer through `attemptFactor` (§6). Retrying to learn what a call
  looks like is the *point* of the drill line, so it must not be the thing that forfeits the tip.
- **Silent progress, announced grant.** The player can see "7 of 10" rather than discovering the requirement
  when they cross it; the grant is announced once, because a reward nobody notices is not a reward.
- **The cap is on the balance, not on the earning.** At 3 held, further successes accumulate nothing. The
  cap is what keeps hints a tip rather than a resource to hoard.
- **Only ranked Drill answers count.** The unranked practice mode (§15, open question 6) grants nothing, for
  the obvious reason. The ledger records `successes` and `hints` separately so the rule is auditable and the
  numbers can be retuned independently.

**2. Spending.** **A hint may be taken on the Daily, costs a 60-second time penalty, and there is no undo.**
- **The penalty is one minute per hint, and it is folded into the elapsed time** rather than given its own
  factor (§6). It is charged once, when the hint is taken, and **undoing the move afterwards does not refund
  it** — a hint is information, and information cannot be un-known. That is a rule rather than an oversight:
  a refundable hint would be a free look at the answer, taken, used, and undone.
- **The count is part of the run's signed transcript** (`hintsUsed`), so the server can clamp the score
  correctly and neither side can quietly add or drop one (§11).
- **The hint is not a move.** It reveals; the player may take its advice, ignore it, or leave the puzzle
  unsolved. Ignoring it is a legitimate choice, so the penalty is not refunded when the hinted move is
  *available but unused* either.
- **The balance lives on the account, and an anonymous player's is claimed with the rest of the ledger**
  (§11), so a signed-out player is not punished for being signed out.
- **The spend is a server call, and its FIRST answer in a process can take a minute and a half.** `POST /me/hints`
  names the call from the recorded line (§11.1, A23), which runs the reverse-BFS map of §10.3 in the server — and
  MEASURED, one build of that map is **79-91 s** at the shipped level-1 pool, cached per goal afterwards
  (`api/src/levels.ts`). The app therefore waits for the answer with the button marked busy rather than spending its
  shared 8 s handshake window on it: MEASURED in the dev server's own log, one `POST /me/hints` answered **200 after
  88 295 ms** while the client had already given up at 8 s — the debit landed, the app never adopted it, and every
  later press was refused against a balance the player no longer held. A retry would have been the wrong repair: the
  spend is a write, so retrying a request that already landed costs a second hint.

**3. What a hint reveals — and this needs deciding, so here is the recommendation.** *Recommend: one call
name, marked in the offering list, valid from wherever the player is.*

- **It names one call that reduces the distance to the goal**, taken from the reverse-BFS map (§7), so it is
  correct from the player's *current* board and not only along the generator's route. If it named a move on
  the generator's own path, a player who had taken a different-but-valid route would be told a move that is
  illegal from where they are standing — a worse failure than no hint at all.
- **The distance map decides it, not a second search.** "Which offered call has distance-to-goal one less
  than here" is a table look-up over moves the client already has, so the hint is deterministic from the
  seed, identical on both sides, and cannot drift.
- **Ties break by the generator's stable order**, and the rule is pinned by a probe, because "which of two
  equally good moves" must not depend on object iteration order.
- **What is deliberately not revealed:** the whole solution. A tree of remaining calls is the answer, and
  the game's job is the one call the player is stuck on. *This is the recommendation rather than a settled
  decision* — see §15, open question 7.

---

## 11. Auth, API and the cheap database

**Login: Cognito User Pools**, email + password, email verification, **no SMS** (cost, and to avoid a phone
number field that older players find fiddly). The app holds no password and no secret; tokens are verified in
Lambda by the API Gateway authorizer. Cognito's own hosted/password-reset flows are used rather than an
invented one.

**Sign-in is what makes anything count, and a signed-out visitor gets a demo.** The game is playable with no
account — a read-only demo that stores nothing (§11.2) — and a device's own local run ledger can be **imported**
on login with `POST /me/runs:bulk`, **idempotent on a client-generated `runId`**, so a retry or a double-submit
cannot double-count. **The imported rows are history and nothing else**: no board, no hints, no progress, because
a run the server never issued cannot be verified (A26). This amends decision 6: the funnel becomes *try it
read-only, then sign in to be ranked*.

**API** (API Gateway + Lambda):

| Method and path | Mode | Purpose |
|---|---|---|
| `GET /drill/current?level` | Drill | **The drill this player is on** — the seed, the level, the generated puzzle and the issue date. The server decides which entry: the first schedule entry the player has not finished, or their locked part-finished one. Not a `GET /puzzle` by seed for this mode, even though the client *could* apply one: the player does not choose their seed, and which entry is next is the server's fact (§8). **THE LEVEL IS THE SERVER'S TOO** (§15 Q17(vi)): for a request the server can name, the level comes from the player's LADDER row (`api/src/ladder.ts`) and `?level=` is not consulted; a caller the server cannot name has no ladder, so a demo is served the level it asks for and that is the only path on which the query is read. |
| `POST /drill/advance` | Drill | Mark the current drill finished, so the next request for `/drill/current` returns the next schedule entry. **It earns nothing** — no score, no hint — and it is recorded as an abandonment (A25) so a skipped season is visible to the operator rather than a silent gap. **It is also the SKIP the player can choose** (§15 Q5: a mark-and-continue for a drill they cannot solve), which is why the control is offered only where the request can succeed. **The app asks for it only when the server does not already hold the drill as finished** (§15 Q21): a recorded run finishes the drill itself, so an advance after one asks the server to skip a drill that is already skipped — a `409` the endpoint is right to answer, and a refusal that A25 would count against an honest player. |
| `POST /drill/replay` | Drill | **Reattempt a position the player closed without passing it** — a skip or a revealed solve — which is the one place the ORDER gives a position back (§15 Q25(a)). The position must be finished and NOT passed, so it reopens exactly the cells a skip left behind and nothing else; the issue is stamped `replay` so a reload resumes it, and it earns nothing (the position is already `finished`, so the hint rule's first-time test is false) — what it buys is the PASS. Refusals: `409 not_finished`, `409 already_passed`, `409 no_entry`, `400 bad_index`. |
| `GET /puzzle?mode=daily&level&date` | Daily | The published challenge for that level and UTC date: the stored seed AND the puzzle it names (generated once, then served from the cache — the client generates nothing, §9). **An identified read also records WHEN this player looked at it** (the attempt row that starts the Daily's clock, A21); a signed-out one records nothing. |
| `POST /drill/answer` | Drill | One press, recorded as it happens (§11.1 A22): the step and the call the player chose. **The server derives the verdict** from the puzzle it issued and answers with the wrong-try count so far; nothing about the press is taken on trust, and it scores nothing. |
| `POST /drill/reveal` | Drill | That one step's answer was SHOWN to this player (§15 Q16, A28): the step, and the call the server looks up from the puzzle it issued — the same expression A22's verdict and §11's transcript check use, so one position has one answer. **Recorded as an event and not as a press**, because a reveal is not an answer the player committed; deduplicated by step, because a second press of the same button shows the same call. It scores nothing itself, and it is what stops the run it finishes from counting. |
| `POST /daily/move` | Daily | One move, undo or redo, recorded for the same reason (A22): the Daily's line and its length become the server's record rather than the submission's claim. |
| `POST /me/hints` | Daily | Spend a hint (§11.1 A23): the server debits the balance and records the spend against the challenge's attempt row, answering with the balance AND the call it named. **Both are the server's** — the spend is the anti-cheat part, and the NAME comes from §10's look-up over the recorded line (A22), which is the board the player is actually on. A spend that can name nothing is refused (`nothing_to_name`) before the balance moves. |
| `POST /daily/abandon` | Daily | Give up today's challenge (A25's accounting): the attempt is stamped as abandoned, ONCE (a second call keeps the first stamp), and it does NOT bar a later submission — the app lets a player replay both lines, and an abandonment is a fact about the attempt. The hint an abandoned run owes is no longer debited here: A23 moved the debit to the moment a hint is taken, which is strictly better. |
| `POST /runs` | both | One completed run. **Drill**: the issued-drill id and the `runId`; the calls chosen — one per step — and, under A22 (§11.1), they are the transcript of presses the SERVER recorded rather than a claim. **Daily**: the level, the date and the `runId`; the line the server recorded. `elapsed`, `attempts`, `hintsUsed` and `reveals` appear in the body only as AUDIT inputs — the server measures the first (A21), counts the second (A22), debits the third (A23) and has its own record of the fourth (A28). The server re-derives which option was correct at each step rather than trusting the client's claim about it, and it answers with `run.ranked`, which is the server's own word about whether the run counted. |
| `POST /me/runs:bulk` | both | Import a device's local ledger as **unranked history** (A26): one `history#<playerId>` row per run, marked `unverified`, and NOTHING ELSE — no board, no hints, no progress, and no row in the results partition. A run already imported is SKIPPED rather than rewritten, so a second import claiming a better score for the same id changes no number. |
| `GET /leaderboard?mode&level&period` | both | The board for one mode, level and period |

`GET /drill/current` works **without an account, and then it is a demo**: the server answers the level it was
asked for (a signed-out caller has no ladder row, so it is the only path on which `?level=` is read), writes no
Progress row for that caller, and reports it as a demo (§11.2). A signed-out
player therefore follows the same order as everyone else without a progression of their own, and the moment they
sign in, their progress is a Progress row keyed on their `sub` — which is why the Progress row's key includes the
player rather than the level alone. An IDENTIFIED caller's level comes from their ladder row, and a full block
promotes them (the promotion is evaluated on the READ, in `api/src/ladder.ts`, so a lost write heals itself).

**The three endpoints as they are implemented (Phase 5.0 and 5.3), so the client can be written against them.**
`GET /drill/current?level=<n>` → `200 { drill: { id, index, levelIndex, seed, poolVersion, scheduleVersion,
issuedAtMs, puzzle, resumed }, regime: { finished, length } }`, where `drill` is `null` once every entry of that
level is finished. **`puzzle` is the whole generated puzzle** — start, goal, every step's options and their boards,
and the answer key — because the client generates nothing; it is the same object `POST /drill/answer` and
`POST /runs` score against, so the screen and the verdict cannot disagree about the question. **`levelIndex` is the
level the answer was SERVED FROM** — the ladder's for an identified
caller — and it is what the client adopts rather than the level it asked with. **`scheduleVersion` is the published
set the drill was issued from, which is the Drill board's identity** (§15 Q17(vii)): the client passes it back as
`/leaderboard`'s `period` instead of computing a calendar month, and `POST /runs` lands the run on that set's board. `id` is `"<level>:<index>"` — meaningful rather than opaque, because the only check that
matters ("is this the drill I issued you?") is an exact comparison against the player's Progress row, and an
opaque token would need a row or an index to resolve. `POST /drill/advance { drillId }` → `200 { regime }`.
**`POST /drill/replay { index }` → `200 { drill, regime }`** reattempts a position the player closed without passing —
the one place the order gives a position back, and the answer is the same shape `/drill/current` gives because the drill
on screen is the same kind of thing either way. It requires the position to be **finished and NOT passed**, so it reopens
exactly what a skip or a reveal closed and nothing else: `409 not_finished` (an unfinished position belongs to the
order), `409 already_passed` (a pass is monotone, so there is nothing left to earn), `409 no_entry`, `400 bad_index`. The
issue is stamped `replay: true` so a reload RESUMES it rather than moving on — without that flag `isPlayable` refuses a
finished index and the reattempt would exist for exactly one response (MEASURED, and that is how the flag was found to be
missing: the second read answered position 2). Closing one is the two paths that already exist, because the id is the
position's own: `POST /runs` takes the pass, `POST /drill/advance` does not.
Refusals are `{ error: { code, message } }` with a status: `400 bad_level`/`bad_drill_id`/`bad_index`, `401
unauthenticated`, `404 no_schedule` (that level has no published regime — the normal state of a fresh
deployment), `409 stale_drill` (the id is not the one issued), the three `409`s above, and `409 contended` (three
compare-and-set attempts lost), `503 unreadable_progress`/`unreadable_schedule`/`unplayable_drill` (a stored row this
build cannot read, or a published seed that no longer generates — both operator findings rather than client errors).
**A refusal never writes**, which is what makes a retry safe.

`GET /puzzle?mode=daily&level=<n>&date=<YYYY-MM-DD>` answers `{ daily: { day, levelIndex, seed, poolVersion,
publishedAtMs, playable, puzzle } }`. **What is STORED is the seed and what is SERVED is the puzzle**: `POST /runs`
re-derives the puzzle from the stored seed to verify a submission, so a stored board would be a second copy that a
corrupt or edited row could disagree with. `puzzle` is `null` exactly when `playable` is false — a challenge published
against a pool this build does not serve has no boards this build can draw, and generating one anyway would hand the
client a puzzle the server would refuse to score. `playable` is false when the row was published against a pool this
build does not serve, which is the same rule
as §7.2's "a seed is only meaningful against the pool it was validated at". `404 no_published_daily` means the
boundary job has not run for that level and day — and the server does NOT invent a seed in that case, because a
challenge nobody validated is exactly what §7.2's gate exists to prevent.

`POST /runs` takes `{ runId, mode, levelIndex, elapsedSeconds, hintsUsed, attempts, calls, score? }`, plus
`drillId` for a Drill run and `date` (`YYYY-MM-DD`) for a Daily one — the SAME word the query parameter uses,
because a client that had to know `day` here and `date` there was two names for one fact (the body field was
renamed in Phase 5.9, while the only consumer was this repository's own client). and answers
`{ run: { runId, mode, score, elapsedSeconds, scoreVersion, clamped, duplicate }, hints: { hints, successes,
granted }, board: { period, score, runs }, progress: { finished } | null }` — the SERVER's numbers, so a client
never has to guess what its own claim was worth. `calls` is one call per step for the Drill (the answer the
player committed at each step, re-derived against the issued puzzle) and the whole line for the Daily (walked
through the engine). `score` is the client's claim and is CLAMPED to what the server recomputes, with
`clamped: true` saying that it was. `duplicate: true` means the `runId` had already landed and nothing was
written twice. Refusals add `400 not_solved`/`over_allowance`/`impossible_elapsed`/`bad_*`,
`404 no_published_daily`, and `409 stale_drill`/`stale_pool`. **A Daily submission is also cross-checked against the
server's own record of the line: `409 no_recorded_line` when the moves were never recorded, and `400 line_mismatch`
when the calls it names are not the ones the log derives.** The `400 over_allowance` refusal is GONE — the line is
replayed through `PlaySession`, whose budget is the same `MOVE_ALLOWANCE_CUSHION`, so a recorded line cannot exceed
the allowance and the check was unreachable.

`POST /daily/move` records one move of the Daily, and it is what makes the LINE the server's. The body is
`{ levelIndex, date, move: 'add' | 'undo' | 'redo', call? }` — a call on an `add`, and nothing on the other two,
because an undo names no call of its own. The answer is `{ recorded }`, the number of moves the log now holds: it is
the only number the endpoint can report without generating the puzzle, and it is what tells a client its move landed.
**The client never states its line.** `POST /runs` derives it by replaying the log through the same `PlaySession` the
app drives (§4.4), which is why the two sides cannot disagree about what was played. Refusals: `400
bad_level`/`bad_date`/`bad_move`/`bad_call`, `401 unauthenticated`, `409 no_attempt_row` (the challenge was never
read by this player, so there is no attempt to record against — A21's row is what a move hangs on), `409
move_log_full` (the 300-move bound) and `409 contended`.

`GET /leaderboard?mode=<drill|daily>&level=<n>&period=<p>` answers
`{ board: { mode, levelIndex, period, entries: [{ playerId, score, runs }], examined, truncated } }`, highest score
first with ties broken by player id so one board answers ONE order. It is a READ and needs no identity, and it reads
exactly ONE board — `board#<mode>#<level>#<period>`, so another day, level or mode cannot appear in it (the negative
control in `api/test/leaderboard-probe.mjs` is a board that would). **IT READS THE BOARD INDEX, so the top N is ONE
BOUNDED READ**: the base table's sort key for a board is the PLAYER, so ranking there would mean reading the whole
partition and sorting it in the process — which is what this endpoint did first, under a 1000-row `BOARD_READ_CAP` it
had to admit in the answer. The index carries the score INVERTED in its sort key (§11's table paragraph), so
ascending IS best-first, the tie-break is part of the same key, and `limit` returns the top of the board with nothing
to sort. `examined` and `truncated` are re-stated rather than re-used: they now mean the size of the page and whether
the page FILLED (which may mean there is more behind it), and `BOARD_READ_CAP` is GONE with the read it bounded. A
row the index does not carry cannot appear at all — the attributes are built by the one writer (`handlers/runs.ts`),
which REFUSES a run whose board score will not fit the sort key's fixed width (`unrankable_board`) rather than
clamping it into a wrong rank. Refusals: `400
bad_mode`/`bad_level`/`bad_period` and `503 unreadable_board` (a row this build cannot rank is an operator finding,
never a zero and never a skip — a board that quietly dropped a player would be one nobody could audit).

**The board is a PANEL, not a third mode.** A mode is something a player plays; a board is a read (§6), so it is a
section of the shell with one button, loaded ON DEMAND — a player who came to play should not pay for a request they
did not ask for. It says three things rather than implying them: WHICH board (the mode, the level and the period are
written down, because "the leaderboard" is three facts and comparing across levels is comparing nothing), WHICH ROW
IS YOU (the id the session holds, since the board is public and a signed-out player still reads it), and WHETHER THE
LIST IS COMPLETE (`truncated` becomes a sentence, because a cut-off list presented as the standings is worse than no
list at all). MEASURED in a browser (dev:game 8089 + `DSQ_AUTH=emulate` dev:api 8090), ON THE OLD PERIOD RULE: after
one solved Drill the panel read "The Drill — level 1, season 2026-10", "Top 1 of 1 player on this board", and the row
"1. emu:… (you) 84 — 1 run", with `200 GET /leaderboard?mode=drill&level=1&period=2026-10` in the dev server's log.
**THAT PERIOD IS SUPERSEDED** (§15 Q17(vii), implemented): the Drill's period is the PUBLISHED SET the drill was issued
from, which the client takes from the answer's `IssuedDrill.scheduleVersion` rather than computing a month — so the same
observation now reads "season local-fixture/ms-2" against the local fixture, or "season ms-2-seasonN" against a
published set, and asks for that string. `game/src/puzzle/season.ts` is DELETED rather than left as an unused export,
because nothing derives a calendar month any more. **NOT RE-OBSERVED IN A BROWSER AFTER THE CHANGE**: the panel text
above is the old run's, and the new period has only been driven through the handlers (`api/test/runs-probe.mjs` §1 and
§2b, which submit on both sides of a month boundary). **THE DAILY PATH IS NOW OBSERVED TOO, AND IT WAS THE ONE CLIENT
SURFACE LEFT UNSEEN**: switching to Today's
Daily, solving it and opening the board read "Today's Daily — level 1, 2026-10-16 (UTC)", "1 player on this board" and
the row "1. emu:… (you) — 100 — 1 run", and the dev server's log holds the whole chain in order —
`GET /puzzle?mode=daily&level=1&date=2026-10-16`, `POST /daily/move`, `POST /runs`, then
`GET /leaderboard?mode=daily&level=1&period=2026-10-16`. That last line is the point: the client asked for the DAILY
board with the UTC DAY as its period, which is the branch the Drill observation could not exercise (the day comes from
`utcDay`), and the server answered it from the day's own index
partition.

**The `Schedule` item as it is published (Phase 5.5).** `schedule#<level>` / `current` holds `{ scheduleVersion,
entries: [{ seed, levelIndex, poolVersion }] }` — a seed, a level and a pool version, no puzzle, no board, no media
(§11, decision 13). The order is ascending and the season is a PREFIX of any longer season, so extending one cannot
rewrite a drill already handed out. `scheduleVersion` is `ms-1-season<N>`: it names the pool and the length, which
is what an operator needs to see that a republish changed the regime. It deliberately does NOT encode the
generator's version, because a change there is caught by `lintSchedule` re-running the generator rather than by a
string comparison.
**DynamoDB, one table**, `PK`/`SK`, **plus the board index — which is now built, and this paragraph has been wrong
twice.** It first described a `GSI1 (GSI1PK, GSI1SK)` "for the two leaderboard partitions" *and* a `seed#playerId`
dedup index; neither existed. It was then corrected to say NO index existed, which was true until `createTable` grew
one. What exists now is **one** index, and the dedup index is still not needed: the run id is the key
(`runs#<player> / run#<runId>`), so a replay writes the same key and the transaction's create-only condition cancels
it. **The index is what makes the leaderboard's top N a bounded read**: a board row carries `GSI1PK = the board's own
partition` and `GSI1SK = (999999999 − score)` zero-padded to a fixed width, then `#<playerId>` — so ascending order
IS highest-score-first, the tie-break by player id is part of the key, and a `Query` with `Limit` returns the top of
the board. A score too wide for that field is REFUSED rather than clamped (`handlers/runs.ts`'s `unrankable_board`),
because a clamped row would sit at the wrong rank forever. Its projection is `ALL`, and that is a decision with a
measurement behind it: the in-memory twin returns the whole item for an index read, so a GSI projecting a SUBSET would
make the two stores answer differently for the same query — and the store contract suite, which runs the same checks
against both, is the only reason that would be found before production. The item shapes below are the storage form of
decisions 10, 11 and 15, and of the two published sources of a puzzle:

| Item | Purpose |
|---|---|
| **Schedule** (`schedule#<level>`) | The level's ordered seeds, published ahead of play (§7.2), with the level stored beside each seed and the schedule version. **A seed and its level: no puzzle, no board, no media.** |
| **Progress** (`progress#<playerId>#<level>`) | The player's position: the issued drill id and issue date, and the set of finished ones. This is what makes "a drill is locked when issued" and "everyone follows the same order" both true. |
| **Score** (`board#…`) | The leaderboard entry, one per player per board — their best |
| **Published daily** (`daily#<level>#<date>`) | The generated-and-validated challenge for that level and day, written by the boundary job |
| **Hints** (`hints#<playerId>`) | The balance and its earning progress: `hints` (0–3) and `successes` (0–9, reset on each grant), plus a `grantedAt` stamp so a grant can be shown once rather than re-announced on every load (§10). **One row per player, not per level** — hints are earned on one level's line and worth spending on another's. |
| **Attempts** (`attempts#<playerId>`) | One row per challenge the player LOOKED at. For the Daily it holds the start stamp (`daily#<level>#<date>`) — written by an identified `GET /puzzle` and **never rewritten**, because a stamp a re-read could move is a clock the player controls (A21). For the Drill it holds the recorded presses (`drill#<id>`), each with the step, the call and the server's own arrival time, which is what `attempts` is counted from (A22). |

There is deliberately **no media table and no asset bucket** (decision 13): nothing about a Drill entry is
rendered ahead of play, so the only published artefacts in the system are a seed and a level.

**The client never sees a seed it has not been issued.** For the Drill, `GET /drill/current` is the only way
to learn a seed, and the server answers from the player's **Progress** row rather than from the schedule
directly. That is not ceremony: the schedule is what every player at a level is working through, so a public
"here is the whole schedule" read would let anyone pre-solve the regime and share answers, which is precisely
the fairness decision 10 exists to create.

**The server re-runs the same generator** to validate a submission: it recomputes `par`, the shortest
solution and the maximum achievable score, and refuses anything above it. This is the reason the generator is
a package-shared, engine-only, pure module (§7) rather than app code — it must run identically on both sides.
For the Drill it re-checks **two** things: that the entry is the one the player was **issued**, and which
option was actually correct — so neither a puzzle the player chose nor a client's claim about the answer can
be published.

**And the same treatment applies to hints (§10), because a hint is a currency.** The server credits a grant
from its own record of scored Drill successes rather than from anything the client says — so a client cannot mint
a hint by reporting successes it did not have. **The spend side is the client's word until A23 (§11.1) lands**: the
debit came from the `hintsUsed` a submission carried, which a modified client could report as zero. A23 makes the
spend an event (`POST /me/hints`), and the balance is then **server-owned state that the client displays and
requests against** on both sides, never a client-side counter that happens to be synced.

**Publishing a schedule is an operator action, not a code path a player can reach**: the authoring pipeline
in §7.2 writes the Schedule item (and, for the Daily, the boundary job writes the Published item), and there
is no client-facing write to either.

**Licence.** The engine is **AGPL-3.0** (`engine/README.md`) and the taminations data is GPL/AGPL. The design
records where the obligation attaches — shipped front-end code that derives from the engine — and keeps
backend logic separate. That is the scope of the claim; nothing more is asserted here, and **no secrets ever
live in this repository** (AGENTS.md §6).

### 11.1 Cheat resistance: what the server measures, and what it only bounds

**THE RULE THIS SECTION EXISTS FOR: a measurement the server did not make is not a measurement.** Every term of a
score (§6) comes from something a modified client could otherwise choose, and so does the identity behind it. The
line a player plays is already verified; the score is already clamped; what could still be bought is the run's
**time**, its **attempts** and its **hints spent**.

**The ceiling is already honest, which is what makes closing the rest worth doing.** Every factor of the score is
at most 1 (`puzzle/score.ts`), so the best possible score is `BASE_SCORE × level` — exactly what a clean, par,
first-try run gets. There is no impossible number to post; a cheat buys a ceiling it did not earn.
**MEASURED at L1 with the shipped arithmetic** (`game/tools/_measure-cheats.mjs`, a throwaway deleted after it was
read; the constants are `BASE_SCORE` 100, `SECONDS_PER_CALL` 15, `HINT_PENALTY_SECONDS` 60, `ATTEMPT_PENALTY`
0.25): a clean par run scores **100**; a 100-second run scores **15**, and claiming par makes it **100**, a
**6.7×** gain; one hint on a 10-second clock scores **21**, and hiding it makes it **100**, a **4.8×** gain; one
wrong answer at par scores **80**, and hiding it makes it **100**, **+25 %**. And a claim cannot beat the ceiling —
claiming `0.1 s` also scores **100**, because `timeFactor` stops at 1.

| Rule | What it requires |
|---|---|
| **A20 — the identity is verified or absent.** | Reads (`GET /drill/current`, `GET /puzzle`) answer a signed-out caller as a **demo** and write nothing at all — no Progress row, no attempt row. Every write (`POST /runs`, `POST /drill/advance`, `POST /me/hints`, `POST /me/runs:bulk`, `POST /daily/move`) requires a verified `sub`, and a header is never an identity. |
| **A21 — the clock is the server's.** | A run's elapsed is `submittedAt − issuedAt`, both the server's own facts: for the Drill the Progress row's issue stamp, for the Daily a per-player attempt row created by that player's own first read of the challenge. The client's `elapsedSeconds` is kept as an **audit input** and never scored. |
| **A22 — the interaction is recorded, so `attempts` is counted.** | `POST /drill/answer` records each press (step, call and the SERVER's arrival time) against the issued drill, decides the verdict from the puzzle it issued, and `attempts` is the number of recorded non-correct presses — the submission's count is kept as an audit input. A run with no log is refused (`no_press_log`) and a transcript the log cannot account for is refused (`unexplained_calls`); the log is bounded at 200 presses. `POST /daily/move` records add/undo/redo for the same reason, so the Daily's line and its length are server facts too. |
| **A23 — the hint spend is an event, not a field.** | `POST /me/hints` debits the balance and records the spend against the challenge's attempt row at the moment the hint is taken, so the run is charged 60 seconds per RECORDED spend and a submission claiming more than the record is refused (`unrecorded_hints`). The balance and the event move in one transaction. **The call it names is the server's too**: §10's look-up runs over the board the player is standing on, and for the Daily that board is the RECORDED line — replayed through the app's own `PlaySession.hint()`, so one name exists for one fact — and a spend that can name nothing is refused (`nothing_to_name`) rather than charging for a hint that says nothing. `POST /daily/abandon` is what debits the hint an abandoned run owes. |
| **A24 — scoring is a function of server facts only.** | Measured elapsed, counted attempts, server-debited hints, the regenerated `shortest` and the recorded line. The answer reports measured against claimed, so a disagreement is visible rather than silent. |
| **A25 — accountability is recorded.** | Every accepted or refused run stores what was measured and what was claimed plus its flags, and increments a bounded `abuse#<playerId>` counter. The gateway throttles per player, and a refusal-rate alarm is the operator's signal that someone is probing. |
| **A26 — the bulk claim is HISTORY, not rank.** | A device's local ledger may be imported only as `unverified` rows that count for nothing — no board, no hints, no progress — because a run the server never issued cannot be verified. This amends decision 6: the anonymous ledger is kept, and it buys no standing. |
| **A27 — local development never needs a provider, and never reaches production.** | Three identity modes (§11.2). `dev` is refused when the environment is production. |
| **A28 — a shown answer is recorded, and it buys nothing.** | `POST /drill/reveal` records that one step's answer was SHOWN, naming the call from the puzzle the server issued (the same expression A22's verdict uses), deduplicated by step and never recorded as a press. A drill finished with any reveal recorded is **kept and counted for nothing**: no hint credit, no board entry at all (not a zero), and the regime still advances, because leaving a player on a question they have read is the trap Q5 exists to solve. The submission's `reveals` is an AUDIT input and the rule takes the **union** of the two sources — either one saying "shown" is enough, because the record alone ranks a run whose reveal POST was lost and the claim alone ranks a client that never sends one. |

**Known limits, stated rather than dressed up as defences.** (1) Automation that plays correctly earns at most a
**par** score — but it earns it every time, and no submission can prove a human made it. **A28 IS INSIDE THIS LIMIT
AND DOES NOT SHRINK IT**: a client that plays the puzzle itself can simply never post a reveal, exactly as it can play
perfectly, and no submission can tell the difference. What A28 closes is the app's OWN button minting currency —
press "show me the answer", press the call you were told, earn a tenth of a hint — which is a defect in the honest
path rather than a defence against a modified client. (2) The information a
hint reveals is derivable from the puzzle the client was served, so a modified client can skip the 60-second
penalty; the mitigation is that a hint buys time, not score beyond the par ceiling, and the recorded spend is what
the honest path charges. (3) The Daily's seed is a public function of the date (`puzzle/daily.ts`), so a published
day is pre-computable by anyone; the countermeasures are that the day is published at its boundary rather than
ahead of it and that A21 bounds what a pre-solver can claim for TIME. (4) Several accounts can be created for
several board entries; Cognito's email verification raises the cost and does not remove it. (5) **The window is
wall time from the server's own stamp to the submission, so it charges for everything in between** — network
latency, reading the question, and a tab left open while a drill is in flight. A resume does NOT re-stamp it
(that is the point: a re-stamp is a clock the player controls), so an idle tab scores as a slow run. That is the
honest cost of measuring the clock at all, and the fix if it ever matters is a client-side "you have been idle"
prompt, not a movable stamp. Closing (1)–(3) properly means not serving the puzzle (a board-state API rather
than a seed), which is a change to the game's information model rather than to its security.

**Enforcement status, because a rule that is only written down is not a rule.** What is already true in the code:
the transcript is verified by regeneration (`handlers/runs.ts`), the score is clamped (`runs.ts:scoreWithClaim`),
the run row is created inside the same transaction as its effects so a retry cannot double-count, an issued drill
is locked, the hint CREDIT is the server's own record of finished drills, an identity is a VERIFIED token or an
absent one (`auth/identity.ts`: the token adapters have no expression that reads a request header) with a
signed-out read a demo that writes nothing and every write a `401` (`api/test/auth-probe.mjs`, 76 checks, 7 of
them negative controls) — and, since the clock stage landed, **A21**: a run's elapsed is
`submittedAt − issuedAt` from the server's own stamp (the Progress row's issue date for the Drill, an attempt row
created by this player's identified read of the challenge for the Daily, `attempt-row.ts`), the client's
`elapsedSeconds` is recorded as `claimedSeconds` and never scored, and a Daily the server never saw start is
refused (`no_attempt_row`). MEASURED in `api/test/runs-probe.mjs` (70 checks): a 1 s claim on a 60 s window
scores **25** where scoring the claim would have paid **100** — the same 4x a claim of the 6.7x defect would have
taken — the run row holds measured **60** beside claimed **1**, and a re-read of the challenge leaves the start
stamp byte-identical. **A22** is now true for the Drill: `POST /drill/answer` records every press with the
server's own arrival time and its own verdict, and `POST /runs` counts `attempts` from that log rather than from
the submission — MEASURED in `api/test/press-log-probe.mjs`, where a run claiming **0** wrong tries after two
recorded ones scores **17** instead of the **25** the claim would have paid, a transcript whose calls were never
pressed is refused `unexplained_calls`, and a run with no log at all is refused `no_press_log`. **A23's spend is
an event**: the balance moves when the hint is taken and the run is charged the recorded spend — MEASURED in
`api/test/hint-event-probe.mjs`, where a Daily run hiding a recorded hint scores **13** instead of the **25** it
would have taken, the run row holds recorded **1** beside claimed **0**, a claim of a hint the server never
recorded is refused `unrecorded_hints`, and a challenge nobody read cannot be charged a hint at all
(`no_attempt_row`). What is not yet true, and the stage that lands it (AGENTS.md §0: one change, one commit):

**A20's client half is now true, and the last piece of it was a defect a browser found.** The app discovers the mode,
runs the flow, keeps the session and **marks an unranked run on screen** (`paintLedger` and `paintBalance`, §11.2),
and it reads the server's own `demo: true` rather than inferring the demo from a session it might be wrong about — so
a run the server called a demo is never submitted. MEASURED in a real browser (Chrome, `npm run dev:game` on 8089,
`DSQ_AUTH=emulate npm run dev:api` on 8090, server log read from the dev server itself): a signed-out page loads the
demo drill and its press sends **no** request at all, while the same press after signing in is `200 POST
/drill/answer`. AND THE FIRST VERSION OF THIS DID NOT WORK, which is why it is written down: the client sent
`x-dev-player` unconditionally when signed out, a token mode deliberately does not advertise that header in CORS
(§11.2, pinned as a negative control in `api/test/auth-probe.mjs`), and the resulting failed preflight answered the
demo read as `TypeError — the server could not be reached` — MEASURED in that browser and visible in the dev server's
own log as an `OPTIONS /drill/current` with no request behind it. The device header is now a `dev`-only identity
(`game/src/net/api.ts`), the boot waits for `/health` before the first request, and the rule lives in
`game/src/net/standing.ts`, where `game/test/standing-probe.mjs` drives every combination.

**A26 is now enforced on both sides too.** A device's ledger is handed over on sign-in, as `history#<playerId>` rows
marked `unverified` that buy no standing — no board, no hints, no progress. The mapping is the client's half and it is
a rule rather than a field copy: the two modes name the transcript differently LOCALLY (`options` for a drill's one
call per step, `moves` for the daily's line) and the imported row has one `calls` list, so a mapping that read one
field for both would send a Daily with an empty transcript — which the endpoint accepts and stores as history with no
line. MEASURED in a browser: a drill solved as a signed-out DEMO is recorded on the device ("1 run · best 59 —
unranked"), and signing in answers "1 run from this device imported as history: kept, and not ranked" with `200 POST
/me/runs:bulk` in the dev server's log; the SAME sign-in again answers "the server already held all 1 of this
device's runs (1 run skipped)", which is the create-only row doing its work rather than the client remembering. AN
EMPTY LEDGER IS SENT TO NOBODY — a fresh session signs in, the row reads "Signed in as …", and the log holds no
`/me/runs:bulk` AT ALL, because the endpoint refuses an empty body and A25 counts refusals at the route table, so
posting one would put the commonest first sign-in into the operator's signal that someone is probing. What is not yet
true, and the stage that lands it (AGENTS.md §0: one change, one commit):

**A22's Daily half is now true, and it is the one change here that could not be made tolerance-free.** The Daily's
line is the server's: `POST /daily/move` records add/undo/redo as the player presses them, and `POST /runs` derives
the line by replaying that log through **the same `PlaySession` the client drives** (§4.4) — not a reimplementation of
undo/redo, so the two sides cannot disagree about what was played. §6 prices that line (`wasteFactor`), which is why
it could not stay a claim. MEASURED: `api/test/daily-move-probe.mjs` compares the server's derivation against a real
`PlaySession` driven over the same sequence, for the add/undo/redo round trip, for the redo branch an add truncates,
and for an illegal call — which the recorder stores and the replay drops, so it never enters the line. A submission
whose calls the log does not derive is refused `line_mismatch` and one with no log at all `no_recorded_line`
(`runs-probe.mjs`), so the claim is cross-checked rather than ignored. The `over_allowance` refusal is REMOVED with
its check: the allowance is `PlaySession`'s own budget now, so the refusal became unreachable. What is not yet true,
and the stage that lands it (AGENTS.md §0: one change, one commit):

**A23's naming is now the server's too**, and it was the last thing `POST /daily/move` unblocked. §10's hint names a
call on the board the player is standing on, and for the Daily that board is the recorded line — so `POST /me/hints`
replays it through `PlaySession.hint()`, **the same function the screen calls**, and records the name it answers with.
The server adds the BOARD the client cannot be trusted for: it names from the position it WATCHED the player reach,
where the app names from the position it believes it is on, which can lag by a move that has not landed. The answer
carries the name (`call`) and the app adopts it rather than showing a second one, and a spend that can name nothing —
a dead end — is REFUSED (`nothing_to_name`) before the balance moves, because a hint that cannot say anything is not
a hint. MEASURED in `api/test/hint-event-probe.mjs`, which checks the recorded name against the ENGINE's own offered
list rather than a literal, and whose negative control is the rule this replaced (the field left empty, a placeholder
for a name the client held). §11.1's known limit 2 still stands and is unchanged: the information a hint reveals is
derivable from the puzzle the client was served, so the naming is a fairness feature and the SPEND is the defence.
What is not yet true, and the stage that lands it (AGENTS.md §0: one change, one commit):

**A28's rule is now the server's, and it is the last of the hint family.** "Show me the answer" names the call and
dances it, and the player still presses it — so before this, pressing the app's own button and then pressing the call
it named earned a normal success, and ten of those mints a hint. The design carried it as an open question (§15 Q16)
precisely because the LEDGER had to know: the hint balance is the server's (A23), so the fact had to reach the server,
and a fact the server did not witness is not a fact — which is why it is an EVENT (`POST /drill/reveal`, deduplicated
by step, never recorded as a press) rather than a field. The run it finishes is KEPT and counted for NOTHING, which is
A26's treatment of a run the server cannot verify and the honest shape of "you may finish, you may not be paid": no
hint credit, **no board row at all** rather than a zero on one, and the regime still advances, because leaving a
player on a question whose answer they have read is the trap Q5 exists to solve. **MEASURED in
`api/test/reveal-probe.mjs` (39 checks)**: the same drill, the same presses and the same balance one success short of a
grant, submitted by two players — the one who asked to be shown a step finishes holding **0** hints with **no board
row**, while the one who did not holds **1** and is on the board with **25**; a run whose reveal POST was lost but
which CLAIMS one scores **0** hints either, with the disagreement left on the row as recorded **0** beside claimed
**1**. Each wrong rule is measured to fail exactly the case that rules it out: the record alone fails only the lost-POST
case, the claim alone only the claim-less client. And the fix is measured by removing it — dropping `!revealed` from
the credit condition fails **exactly four** checks and nothing else (the two credit checks and the two board checks in
both directions). **AND THE APP OBEYS IT**, which is the second half of this rule and the one the server cannot supply:
`DrillController` records WHICH steps were shown — a rule of the machine rather than of a screen, like `attempts` — the
record survives a reload (a page that forgot it would come back with a run that counts, which is a refresh key that
launders a shown answer), `review()` posts each one as `POST /drill/reveal`, the submission DECLARES the same count as
its claim, and the offline ledger applies the same rule locally, so the outage path and the offline path agree with the
server about what a shown answer is worth. The button says so BEFORE it is pressed — "Show me the answer — this drill
will not count" — for the reason Q18's armed reset and Q20's practice offer carry their cost on the label. MEASURED in
`game/test/drill-controller-probe.mjs` (the reveal is recorded, once per step, and a revealed step outside the puzzle is
dropped), `game/test/save-state-probe.mjs` §1b (one success short of a grant, a revealed solve grants nothing and still
finishes the position) and `game/test/api-client-probe.mjs` §7/§9b (the reveal is posted as a step and nothing else, the
call comes from the server, and `ranked: false` is adopted). **AND IT IS NOW OBSERVED END TO END IN A BROWSER**, which
is the only place the two halves meet: the label before the press, `POST /drill/reveal` in the dev server's log, the
two verdict sentences, the hint progress that does not move and the empty board — with the SAME flow without a reveal
as the measured negative control. §15 Q16 carries the observation, and Q21 carries the shell defect that check found
beside it. What is not yet true, and the stage that lands it (AGENTS.md §0: one change, one commit):

| Not yet enforced | Today | Lands in |
|---|---|---|
| A25's remainder | EVERY endpoint's refusals increment the bounded `abuse#<playerId>` tally (the count is applied at the route table, so coverage is a property of the table); no structured log and no alarm yet | logging, the alarm, per-player throttling at the gateway |
| the `cognito` flow | the surface offers a form only where `/health` advertises sign-in routes, which is `dev` (none) and `emulate` (the emulator's five); a deployed pool's hosted flow is not opened by this build | stage 7, with the pool |

The leaderboard's scale left this table when the board index landed: `GET /leaderboard` reads the index with `Limit`,
so the top N is one bounded read and `truncated` means "the page filled" rather than "the read hit a cap".

### 11.2 Identity: three modes, and a local sign-in that needs no provider

**Local development must not need Cognito, and the LOGIN FEATURE must still be testable.** Those are two different
requirements and they get two different modes. `DSQ_AUTH` selects one; the deployed adapter has only the last.

| Mode | Who the caller is | What it is for |
|---|---|---|
| `dev` | the `x-dev-player` header, or `Bearer dev:<name>`, **treated as verified** | the ordinary local run and the probes: no accounts, no tokens, no provider. The boot banner says so (`auth: dev — x-dev-player: <name> names the player — NOT for production`) |
| `emulate` | a **real JWT** issued and verified locally | testing the sign-in feature: signup → confirm → sign-in → refresh → expiry → sign-out, against the same verifier the deployment uses |
| `cognito` | a Cognito access token, verified against the pool's JWKS | the deployment. `dev` is refused outright, and only the `cognito` path loads a JWKS — `emulate` builds the emulator instead, and the deployed adapter does not import the emulator at all |

**A HEADER A MODE DOES NOT ACCEPT IS NOT SENT, AND THAT IS A BROWSER RULE RATHER THAN A STYLE ONE.** The `dev` mode's
`x-dev-player` is advertised in `access-control-allow-headers` **only** when `DSQ_AUTH=dev` (`api/src/dev-server.ts`,
pinned as a negative control by `api/test/auth-probe.mjs`): in a token mode the omission is the point, because it
means a browser cannot even attempt to name a player by header. A CUSTOM HEADER MAKES A REQUEST NON-SIMPLE, so a
client that sends it anyway has its preflight refused and gets no request at all — MEASURED in a browser as
`TypeError — the server could not be reached` on the demo read, with a lone `OPTIONS /drill/current` in the dev
server's log. So the client's identity header is a function of the mode the server reported (`game/src/net/api.ts`),
a signed-out caller in a token mode sends **no** identity at all, and a mode the client has not learned yet is not
treated as `dev` — the app asks `/health` BEFORE its first request for exactly this reason.

**ONE VERIFIER, TWO KEY SOURCES.** `api/src/auth/verify.ts` checks a JWT's signature, issuer, audience, expiry and
`sub` with a pluggable key source — the emulator's local key, or Cognito's JWKS fetched and cached — so the
emulator exercises the code the deployment runs, and only the key's provenance differs. Signing and verification
use `node:crypto` (HS256 locally, RS256 with a small JWKS read for Cognito), so this adds **no dependency**.

**THE EMULATOR IS A DEV ADAPTER, NOT A SECOND AUTH SYSTEM.** `api/src/auth/emulator.ts` serves
`POST /auth/signup`, `/auth/confirm`, `/auth/signin`, `/auth/refresh` and `/auth/signout` **only in `emulate`
mode**; in the other modes those paths are unrouted (`404`), exactly as any unknown path is, so the handler core
never learns that authentication has a shape. Accounts are items in the same `ItemStore` — `auth#<email>` holding
the `sub`, a salted `scrypt` hash, the confirmation state and the live refresh-token ids — so an account persists
with DynamoDB Local and disappears with the memory store, and no second database appears. `DSQ_AUTH_CONFIRM=1`
makes the confirm step mandatory and prints the code to the console, because there is no mail sender locally; by
default the emulator confirms on signup so the shortest path is one call.

**THE MODE IS DISCOVERED, NOT COMPILED IN, AND IT IS IMPOSSIBLE TO SHIP BY ACCIDENT.** `/health` reports
`auth: dev|emulate|cognito` (with the emulator's sign-in routes beside it, so the endpoint count of §11 does not
inflate); the client reads it once (an anonymous read, `discoverAuth` in `game/src/net/auth.ts`) and picks its
flow — `dev` shows no sign-in UI at all, `emulate` calls the emulator, `cognito` uses Cognito's hosted flow, which
this build does not open yet because there is no pool to open. `VITE_AUTH_MODE` overrides the discovery for a
pinned build, and it is applied BEFORE the request: a build that knows what it was deployed against must not be
told a different mode by whatever answers the base URL (MEASURED as a fetch count in `game/test/auth-client-probe.mjs`,
because "it did not ask" is otherwise invisible). The config refuses
`DSQ_AUTH=dev` when the environment is production or when a real endpoint is configured, in the same shape as
`realServiceWarning` (AGENTS.md §8 trap 21) and pinned by a probe the same way — `authRefusal`, measured by
section 6 of `api/test/auth-probe.mjs`, which also pins that `cognito` without an issuer and audience is refused
rather than started.

**AND A SIGNED-OUT CALLER GETS A DEMO, NOT A WALL.** This is the amendment to decision 6 and to §8's "the Drill is
the funnel": the funnel becomes *try it read-only, then sign in to be ranked*. A signed-out player can fetch the
issued drill and the published challenge and play for real; nothing is submitted, scored or stored, and the app
says so on screen (`paintBalance`/`paintLedger` mark it unranked). Every write is `401`.

---

## 12. Monetisation (Google Ads)

The rule that outranks the rest: **the ads must never come between the player and the lesson, and must never
look like the game.**

- **A banner below the play area** — never over the board, never over the answer buttons, never inside the
  board's clickable area. A mis-click on an ad in a game whose whole interaction is choosing a call is the
  one way this goes wrong for both the player and the account.
- **A unit on the result/review panel**, where the player is between puzzles and the lesson is over.
- **A unit on the leaderboard screen.**
- **No ad during the animation.** `poc/src/player.ts` puts a short call at a few seconds on screen (500 ms
  per beat, with 2 s holds); interrupting that breaks the lesson *and* the policy. The Drill makes this rule
  sharper rather than softer: its options *are* the question, so an ad between an option's replay and the
  answer is an ad inside the question.
- **A certified CMP** with non-personalised ads until consent, for EEA/UK visitors; an `ads.txt` on the site
  root; no ad styled as a control.
- **The audience assumption is recorded as an assumption:** square dancers skew older, so child-directed
  treatment is not the default — but it is a thing to confirm, not a fact to rely on, and the consent flow
  must be right regardless.

**No revenue is claimed.** None of it can be measured from this repository, and a projected number would be
exactly the unmeasured claim AGENTS.md §4.1 forbids.

---

## 13. Architecture and phases

```
game/
  src/
    puzzle/     pure and engine-only: levels, generator, drill options, session state machine (move stack)
    play/       the client sequencer shared by both modes: offered moves, apply, undo/redo, goal test
    render/     the shared stage adapter; 2D and 3D
    ui/         screens, panels, the offering list, the answer buttons, review
    aws/        auth, the API client, the local run ledger
  test/         `*-probe.mjs` — the list is the directory (AGENTS.md §5)
```

**Two shared packages, and the direction of the arrow matters.** The stage package depends on
`dancing-squared-engine` (it imports the engine's `Pose`/`DancerSpec` types, which `scene.ts` already did when
it lived in `poc/src/`), and `game/` depends on both. So:

```
dancing-squared-engine  ──►  packages/stage  ──►  poc/  and  game/
```

**The stage is `packages/stage/` today** — Phase 0 has landed: `scene.ts` and `grid-magnet.ts` live there
under the name `dancing-squared-stage`, `poc/` consumes it by package name, and the four probes that load
`grid-magnet.ts` by path were repointed with it. **The game's `render/` directory above is therefore a thin
adapter over it, not a copy of it**, and Phase 1 adds `dancing-squared-stage` to `game/package.json` the same
way `poc/` does.

**And two of the three exist on the server**, which is the point of §4: the engine (to generate and to
validate) and the game's `puzzle/` module (to generate the identical puzzle from the identical seed). **The
stage does not** — nothing is rendered off-browser (decision 13), so the server has no need of `three` at
all. The server's copy must still be the **same code at the same version** as the client's, which is why the
generator is a package rather than an app-local file: a forked copy would silently produce a different
puzzle, and the design's whole verification story depends on both sides agreeing.

The rules this package inherits rather than re-derives: one concern per file and the rule in the module that
owns it (AGENTS.md §4.3); the engine is consumed by package name and never by reaching into `engine/src`;
probes are self-contained `.mjs` files that end in `process.exit(failures ? 1 : 0)`, each with a **negative
control** — the plausible wrong rule, measured to fail exactly the check that rules it out (AGENTS.md §5).

### Phases — one change, one gate, one commit each (AGENTS.md §0)

**Phase 0 — extract the shared renderer (touches `poc/`). DONE.**
The two files moved to `packages/stage/` (`dancing-squared-stage`) with their bodies unchanged (a move, not a
fork — AGENTS.md §4.5), and the consumers were retargeted. **Retargeted 11, not the "seven" this document
estimated**: 8 import statements across `main.ts`, `browser.ts`, `editor-ui.ts` and `sequencer-ui.ts`, plus
**4 probe files** that load `grid-magnet.ts` by path — three by dynamic import and one that also reads it as
text, which is the one that would have gone red silently if it had been missed. Gate:
`npx tsc -p poc --noEmit` → `node poc/verify.cjs` → `node poc/tools/verify-probes.mjs`, because the change
touches `poc/src/**` (AGENTS.md §3). One measured surprise for Phase 1: the package's root export needs a
barrel, because `scene.ts` is not the only module the app imports from and a root entry pointing at it alone
leaves `grid-magnet`'s names unexported — `tsc` failed on exactly that, and `index.ts` is the fix.

**Phase 1 — the engine's goal test, and the pure game core. DONE.**
`sameBoardById` landed in the engine (`engine/src/sequencer/board.ts`, exported with `SAME_BOARD_TOL`) with the
harness `board-identity` registered `light: true` in `engine/test/verify-suite.mjs` — 3.1 s, and it pins the
property that makes the function necessary (that `boardSig` **accepts** a board whose dancers face the wrong
way). `game/src/puzzle/` now holds `types`, `levels`, `pool` + generated `calls-data`, `rand`, `config`,
`generator`, `schedule` and `session`, with `game/src/engine/applier.ts` as the only file importing an engine
VALUE. The package has **its own gate** — `game/tools/verify-probes.mjs`, the directory-is-the-list runner —
and three probes: `puzzle-core-probe` (34 checks), `session-undo-probe` (40 checks, driven by a stub applier
so the session is proven pure) and `schedule-lint-probe`.

**The measurements §5 and §7.1 demand are taken** (`node game/tools/measure-ladder.mjs 30 3 50000`): all 30
levels generate, worst 4959 ms, largest exploration 194 states — and they **overturned two of the design's
own rules**, which are corrected in §5 and §7.3 above: a 3-option question needs pool ≥ 35, and depth 3 is
capped out for the client's budget.

**What Phase 1's probes found that no amount of reading would have:** the generator's correctness rule was
wrong for every step but the last (a board at distance `i < d − 1` cannot reach the goal in one call), so
depth 2 generated **0/8 at every pool size** until it was fixed; the illegal option is unrepresentable among
"three distinct endings" (see §7.3); the goal is *reached, never played from*, so requiring options from it
broke a working depth 1; and the engine's `dist` must be built before any probe runs, because a stale `dist`
reports `SAME_BOARD_TOL` as a missing export.

**Phase 2 — the stage and the Drill UI, on a locally issued schedule. DONE.**
The mode is playable in a browser on locally generated puzzles, on both views. New: `game/index.html`,
`game/vite.config.ts` (with the POC's engine alias, for one engine instance), `src/data/` (the corpus and the
level runtime), `src/game/` (`schedule-fixture.ts`, `drill.ts`, `tween.ts` — all engine-free and
probe-loadable), `src/render/stage-view.ts`, `src/ui/` (`drill-screen.ts`, `playhead.ts`), `src/main.ts`, and
three new probes (`drill-controller`, `tween`, `schedule-fixture`). **`tween.ts` and its probe were REPLACED
in Phase 3** by the engine's own walk (`game/poses.ts` plus `motion-probe.mjs`) — see that phase below. Four
findings, each with the measurement that produced it:

1. **`import.meta.glob` CANNOT REACH OUTSIDE VITE'S ROOT** — and this is the finding that changed the design.
   `server.fs.allow` governs what may be SERVED, not what may be GLOBBED. With the game's root at `game/` and
   globs written as `../../assets/...`, Vite compiled all three to **empty objects**
   (`const MOVES = /* #__PURE__ */ Object.assign({})`) and the app sat on "Loading the corpus…" forever.
   The intended arrangement — one corpus, globbed where it lives — is therefore not achievable by aliasing or
   by a path alias: `game/src/assets/` is a COPY of `assets/`, and `tools/sync-corpus.mjs --check`
   runs **first in the gate** so the copy cannot drift silently. AGENTS.md §1 still says the corpus lives in
   `assets` and that still holds: what the game ships is a build input with a gate on it.
2. **The stage draws nothing by itself.** `DancerView.update` only writes poses into the scene graph; there is
   no animation loop anywhere in `packages/stage`. The app's first frame loop posed the views and never
   rendered, so the boards were BLACK — and a screenshot of the first screen came back empty, which is how it
   was found. `Stage.render()` was added to the stage (it owns the camera choice: `out.camera`), and the POC
   now calls it instead of reaching for `stage.camera` itself.
3. **Only ONE representation may be visible.** `DancerView` poses the 3D avatar AND the caller moves the flat
   marker, so showing both draws a humanoid seen from directly overhead — which is what the "lines across the
   board" in the first usable screenshot were. `poc/src/browser.ts` gates one on the other
   (`v.group.visible = on && !flat`); `stage-view.ts` does it once for both boards.
4. **The two boards' scale and offsets are arithmetic, not taste.** The stage frames a 10-unit floor, a board
   IS 10 units across, so `2·10s + gutter ≤ 10` fixes `s = 0.42` and centres at ±2.9. The first attempt
   (0.45 at ±2.6) put each board's inner edge INSIDE the other's, so both grids and both sets of dancers
   overlapped in the middle — the one thing two boards must never do. **AND THE CENTRE FOLLOWS THE SCALE**
   (`centreFor(scale) = 5·scale + gutter/2`), which closed a second overlap that one shared grid had hidden: at the
   3D scale 0.68 a board's half-width is 3.4 around a centre of 2.9, so the two 3D boards OVERLAPPED by 1.0 unit.
   The arena is 8.2 in 3D (was 6.3) and 5.6 in 2D — the stage's own default, reached by arithmetic rather than luck.
5. **Each board carries its own floor and grid, and the game draws no axis labels.** The stage built ONE floor for
   the whole scene, so two boards stood on one background and no line was in a board's own coordinates — reported as
   "the background grid looks like it's not aligned with the dancer layout" and "two boards on a single background".
   `buildBoardFloor()` returns a floor in BOARD coordinates and `BoardView` adds it inside the board's group, where
   the dancers already live, so a grid line and a dancer's position are the same coordinate by construction. Its
   axis key (`0°/East`, the four arrows) is OPT-IN and the game does not ask for it: it is the editor's coordinate
   reading, and on a game board it would be noise on every one of two boards.
6. **A waypoint's state is a border, and its colour is one definition.** `OUTLINE_COLOR` in `render/stage-view.ts`
   holds solved/next/locked once; the shell copies them into CSS custom properties for the legend beside the boards,
   so the drawn border and the words cannot drift. The border is a flat square annulus in board coordinates — a
   `LineLoop` would be a hairline, and a state told by a hairline is not one a player can read.
7. **Every board is drawn in FOUR colours, and most of them had none.** The engine knows a dancer's home couple only
   for the formations it can identify — MEASURED at level 1, **6 of the 44** start boards — so the other 38 came back
   with `couple: 0` on every dancer and `coupleColor(0)` is one grey: eight dancers nobody can tell apart. Reported as
   "can the game boards display the dancer couple colours, even if the formations aren't in the start formations
   list". The board view now colours through `displayCouple` (`packages/stage`, the rule the POC already had, moved
   there so both apps import ONE implementation), with `enabled: true` for every board; a couple the engine does know
   wins, because that branch returns it first. **THE NUMBER LABEL IS DRAWN ONLY FOR A KNOWN COUPLE**: `coupleTag`
   spells a couple "1h"/"2s", which claims a head or a side, and a pair derived from the array order has not earned
   that claim — so the game turns the label off for exactly those dancers, which is why `DancerView`'s `labelled` is
   separate from its `couple`. The POC leaves the label on and gates the fallback by formation name instead, because
   its boards are the ones its editor reads couple numbers off.

**And what the browser check could NOT settle:** the 3D view renders the same two boards and the toggle works
(verified: the button flips and the avatars replace the markers), but at the two-board scale a 2-unit avatar
spans ~1.7 units and the set reads as a tangle rather than as eight figures. A per-view scale was added
(0.68 in 3D) and it improved but did not finish the job; the camera framing for two boards in an orbit view
is the open piece. **The 2D view is the verified path** — it is the default, the design asks for it first, and
every check below was made on it.

**Phase 3 — the Daily UI, the hint, and the live animation. DONE.**
Both modes are playable in one shell, and the animation is the ENGINE'S walk rather than a chord. New:
`src/puzzle/daily.ts` (the UTC day and the level-bound seed), `src/puzzle/score.ts` (§6's formula, one
function), `src/puzzle/hints.ts` (the earning and spending ledger), `src/game/clock.ts` (a stopwatch with
injected time), `src/game/daily-run.ts` (the run: move stack, clock, hints, outcome), `src/game/poses.ts`
(`stillBoard`, replacing `src/game/tween.ts` and its probe), `src/ui/dom.ts`, `src/ui/daily-screen.ts`, and
`main.ts` as the shell (one stage, one playhead, one ledger, the mode switch). `GameApplier` gained `motion`
(`SequenceMotion`); `ui/playhead.ts` measures BEATS; `PlaySession`'s allowance became a hard cap; and the
stage gained `Stage.setFrameHalf` so a host whose scene is wider than one floor can be framed. Six new probes
(`daily`, `daily-run`, `hint-ledger`, `motion`, `playhead`, `poses`) and two extended ones.

**Six things this phase measured rather than assumed:**

1. **The replay is the authored path, and the difference is measurable.** `motion-probe` finds that the
   engine's frame at half a call leaves the straight line between the endpoints by **1.727 board units** on
   "Allemande Left in the Alamo Style", and that a chord implementation scores **exactly 0.000** on the same
   check. `at(beats)` is the board a real `PlaySession` reaches by applying the same calls, by the engine's
   own `sameBoardById` — so the picture and the verdict cannot disagree, which is the property the deleted
   `tween-probe` pinned for the chord. The fixture's L2 solution walks in **12.6 beats**, and the worst
   single sampled frame costs **1.457 ms** against a 16 ms frame.
2. **An arm target is a WORLD point.** The 3D view drew every dancer with arms several board-widths long —
   a cat's cradle rather than a set. Two assumptions, one rule: `DancerView.update` converts a target with
   the inverse of `matrixWorld`, so a board-space point is read as a world one; and its IDLE arm was built as
   `toLocal(group.position …)`, which is only the same point when the parent is untransformed. The game's
   board group is scaled (0.42 / 0.68) and offset to ±2.9. Fixed in both places, and the POC never hit either
   because its group is untransformed — which is why a shared component needs a second consumer to find this
   class of bug.
3. **Two boards do not fit one floor.** The arena reaches `centre + halfBoard` = 6.3 units at the 3D scale
   against the stage's 5.6-unit frame, so both boards were cropped. The stage now takes the extent
   (`setFrameHalf`), the game declares its arena per view, and the 2D frame is unchanged **by arithmetic**
   rather than by luck: 2.9 + 2.1 + 0.6 = 5.6, the stage's own default. A dancer is then ~10% of the frame
   height in 3D against ~4% in 2D, so the 3D view is still the one where a figure reads as a figure.
4. **The Daily is a seed, not a puzzle.** FNV-1a over `day#level` in UTC: 12 of 12 sampled days generate and
   regenerate byte-identically, and the level really is in the hash — a day-only hash collided on **1160 of
   1200** sampled pairs. A malformed day throws rather than hashing into a challenge outside the calendar.
5. **A hint is one added minute, not a multiplier.** `score-probe` pins it by EQUALITY: a run with one hint
   and no thinking time scores exactly what a run with no hint and a minute of thinking scores. The ledger's
   cap is on the balance (a success at three held banks nothing), and the grant lands on the tenth success.
6. **A success is one DRILL, not one step** — MEASURED in a browser: an L2 drill's first correct answer left
   the count at 2 of 10 and completing the puzzle took it to 3 of 10.

**And the browser pass is what found the defects.** The dev server on 8089 plus a real browser drove both
modes through play, undo, the allowance cap, the grant on the tenth drill, the hint spend (**+60 s on the
clock, the call marked in the list, the balance spent and not refunded**) and the review lines. It found
three UI defects and one renderer bug that no probe could see: an idempotent mode click that broke the
OPENING call (the shell starts in `drill`, so the guard returned before starting anything — an empty page),
a kept Daily whose header still read "The Drill", a kept Daily whose board caption belonged to the previous
mode, and item 2's arms. §14's claim that the app cannot be checked in a browser was wrong and is corrected
there.

**Still open, and not implied otherwise:** the mobile canvas size, and whether a revealed answer should count
as a ranked success (§15, Q16 — the ledger has to know, and the ledger is the server's from Phase 5).
Gate: `tsc -p game --noEmit` → 0; `node game/tools/verify-probes.mjs` → 13 probes, 0 failed. The POC row was
re-run because `packages/stage` changed, and carries its pre-existing failures (`Circle Left` ×2 in
`verify.cjs`; five probes) — the engine's `dist` was also rebuilt, because it was stale against the editor
work already committed in `poc/`.

**Phase 4 — local persistence and the anonymous run ledger. DONE.**
The issued-drill id, the player's position, the hint balance with its earning progress, the Daily attempt in
flight and every completed run now survive a reload on the device, which is what makes "claim them on login"
(§11) possible at all. New: `src/game/store.ts` (the record, the injected storage, and the rules for reading
one back), `save-probe.mjs` (14 sections), `Stopwatch.resume`, `DailyRun.save`/`DailyRun.resume`, the drill's
resume options, and `main.ts`'s `persist()` plus a `#ledger` readout. DESIGN.md 11's Progress row is what the
drill's part of the record IS, so the local shape is the server's shape rather than a near-miss.

**What the record is, and the four rules in it:**
- **A schema change discards everything; a pool change keeps the HINTS.** An older build's fields may not mean
  what this build means by them; a moved `poolVersion` invalidates the seeds and the runs but not the balance,
  because a hint is earned effort rather than puzzle data (§15 Q4: a season boundary must not reset one).
- **What is read back is clamped, never trusted.** `localStorage` is text the player can edit — a hand-edited
  `hints: 99` would otherwise let the Daily's hint button mint minutes — so every number is range-checked and a
  record that is not the right shape is dropped AND COUNTED (a loader's silence about bad data is itself a bug).
- **The run ledger is a queue, deduped on `runId`** — the key §11's claim is idempotent on — and the OLDEST are
  dropped when it is full, because a claim submits what has not been claimed and a best-of keeps nothing.
- **A store that refuses is not a broken app**: `saving: false`, the footer says so, and the game plays on.

**And two rules the wiring turned up, both of them fairness rather than plumbing:**
1. **A RUN'S CLOCK IS RE-BASED, NOT RESTARTED, and the wall gap is CHARGED.** A reload that resumed a run at
   its saved elapsed would be a pause button in the middle of a timed puzzle. A run whose clock had already
   STOPPED (a solved Daily) gets no gap, because a stopped clock was not counting while the page was away —
   which is why a solved run comes back at exactly the score and time it earned.
2. **ONE SUCCESS PER ISSUED DRILL.** A drill can be re-issued without the player asking — a reload re-issues
   the entry once it is solved — and §11's Progress row keeps "the set of finished ones" precisely so that
   re-solving cannot count twice. The BOARD was never farmable (§6 takes the player's best); the BALANCE was,
   and a hint is a currency (§10).

**MEASURED, and the browser is where the last two came from:**
- a full record — the envelope, both in-flight records and 50 runs of three long call names each — serialises
  to **19505 bytes**, two orders of magnitude inside localStorage; 200 runs recorded keep exactly the newest
  50; 1000 platform-generated ids and 100 fallback ids are all distinct.
- RELOAD resumes the regime (drill 2 of 12, "Hints: 0 of 3 · 1 of 10", "1 run · best 23" — with the run count
  unchanged, so the solve was not re-recorded) and the daily (line, allowance, and a clock at 1:04 = 49 s of
  play + the 15 s away).
- ONE SUCCESS PER DRILL, measured: solving drill 2 took the balance to 2 of 10; reloading re-issued it; solving
  it again left the balance at 2 of 10 while the ledger grew to 3 runs and the best went to 100.
- DEFECTS the browser found that no probe could: `persist()` written from the drill WIPED the Daily's saved
  record before the Daily was ever resumed (the tab opens on the Drill), and the record had no place for a
  run's id, so a resume could not help but mint a second one.

**Still not settled, and not implied otherwise:** §15 Q16 (does an answer given after "show me the answer"
count as a ranked success?) is now a ONE-FIELD change — the run record is the transcript that could carry the
flag — but the decision is the owner's. Nothing persists the MODE: a reload opens on the Drill, which is the
funnel. No network call, no account, no cookie: everything is this device's.

**Phase 4.5 — the saved game's rules left the shell. DONE.**
`src/game/save-state.ts` now owns the live state over `store.ts`'s record and the transitions on it, because
until it did those rules WERE four module-level variables in `main.ts` written from wherever a handler
happened to need them — and the only instrument that could see them was a browser, which is exactly how the
one that had shipped (a drill mutation writing `daily: null` over an un-resumed Daily) was found. The state
is opened once, before anything is issued, and every mutation goes through one of its transitions:
`countSuccess` (one success per issued drill), `addRun` (one entry per `runId`, reporting how many it ADDED),
`spendHint`, and `persist`/`open` around the one write. New: `save-state.ts`, `save-state-probe.mjs` (**7
sections, 47 checks, 5 measured negative controls**), and `hints.ts`'s prose on the spend's call order,
corrected.

**MEASURED, by the probe:** nine distinct successes then four replays of an already-finished position leave
the ledger at 0 held and 9 counted, where the control — the same sequence through the rule with no finished
set — mints a hint on the first replay; the tenth DISTINCT position is the one that grants, and re-solving it
grants nothing more; `addRun` with the same `runId` twice adds 1 then 0, where a plain append adds 2; a spend
with an empty balance is refused and leaves the balance at 0, where an unguarded `hints - 1` goes to -1; a
drill mutation with no Daily in memory keeps the stored Daily across a reload, where a record written with
`daily: null` resumes nothing; and the flag at BOOT is not the answer after a refused write (true at open,
false after), which a boot-only flag would have got wrong.

- **A FRESH RECORD CARRIES NO STAMP, and the probe is what found it.** `SaveState.open` first stamped the
  record it builds for a first-time player with the current time, and `resumed` — which is `savedAtMs > 0` —
  then said a brand new game had been resumed, so the shell would have warned a first-time player that the
  schedule had moved under them. It is opened with the storage and the pool version and no clock.
- **THE KEEP-WHAT-IS-STORED RULE APPLIES TO THE DAILY ALONE**, which is what stops it being over-applied: a
  `drill: null` write CLEARS the drill in flight, so a finished drill is not resumed by the next reload.

**Phase 5.0 — the serving surface, locally runnable and probeable. DONE.**
The API exists as a package (`api/`) with the two Drill endpoints of §11 over three injected ports — an
`ItemStore` with a compare-and-set `put`, a `Clock`, and a `PlayerIdOf` — plus an in-memory store (the same
protocol the DynamoDB adapter will implement), a `node:http` dev server seeded with the game's local schedule
fixture (`npm run dev:api`, port 8090, `x-dev-player: <name>` to be somebody), and `npm run verify:api`. The
rules live in `api/src/drill-regime.ts`, which is pure over a schedule, a progress row and a clock — exactly
the shape §14 asks for — and the handlers only read, validate, decide and conditionally write.

**MEASURED, by `api/test/drill-probe.mjs`** (9 sections, 68 checks, 6 negative controls; **4.4 s** in the gate
run, 10.2 s cold, because it builds three levels' appliers — the last section drives a real socket on an
ephemeral port):
- the regime is served in order and an issued drill is LOCKED — asking again returns the same seed and the same
  issue time, and a resumed read performs **0** writes where an issue performs **1**;
- **a republished schedule cannot rewrite a drill already handed out**: with all-new seeds at that level the
  issued drill still comes back with its own seed, where the wrong rule (reading the seed back out of the
  schedule) would serve the new one;
- **an advance finishes the drill that was ISSUED**: a repeated advance is refused `409 stale_drill` and the
  player stays on the next entry, where the plausible wrong rule — "finish the first unfinished entry" —
  reaches **4 finished with 3 played**;
- a drill whose `poolVersion` the build does not have is RE-ISSUED rather than served (the lock test is exactly
  the pool comparison, demonstrated by feeding the row's own version back);
- a finished regime answers `drill: null` rather than wrapping (the client fixture wraps on purpose; the server
  must not re-serve a season the score table already holds);
- the puzzle the drill carries is the one the same generator produces from that seed, byte for byte, and a
  neighbouring seed produces a different one (so the seed decides, rather than one fixed puzzle being served);
- two concurrent requests agree on ONE issued drill, a lost compare-and-set is retried (2 reads of the row), and
  a writer that never lands is reported `409 contended` after exactly 3 attempts;
- an unreadable progress row is a `503` **and the refusal wrote nothing** to it.

**What this phase did NOT do, and what came next:** the DynamoDB adapter (Phase 5.1, below — the in-memory twin
implemented the same protocol, so the condition expressions were unverified until then) and the other four
endpoints (`GET /puzzle`, `POST /runs`, `POST /me/runs:bulk`, `GET /leaderboard`). No Lambda, no template, no
Cognito, no AWS call: the SAM CLI is installed (1.169.0) and nothing has been deployed.

**The measurement that used to be an open decision, now closed by it.** `GET /drill/current` generates the puzzle,
and that costs **167-230 ms at level 1 and 728-1240 ms at levels 2 and 3** on a warm applier, once per seed
(`puzzleFor` caches, so a resumed read of the same drill is a `Map` lookup and MEASURED at 0.0 ms). The design
originally served only a cross-check's worth of that — the first step's option labels — on the argument that the
client generated the same question anyway. That argument is gone: the client generates nothing, so the whole puzzle
is what the answer has to carry.

**Phase 5.1 — the store is DynamoDB, and ONE contract suite runs against both implementations. DONE.**
`api/src/store/dynamo.ts` implements `ItemStore` over the single table (`PK`/`SK`, DESIGN.md 11) with the
compare-and-set as a `ConditionExpression` — `attribute_not_exists(PK)` to create, `#rev = :rev` to replace —
and a failed condition reported as `false` rather than thrown, because "another writer moved first" is an answer
the caller re-reads on. `api/src/store/open.ts` is the ONE place a store is built, so the dev server and the
future Lambda handler cannot disagree about where the data goes; `api/src/config.ts` reads `DSQ_STORE`,
`DSQ_TABLE`, `DSQ_DDB_ENDPOINT`, `DSQ_REGION` and `DSQ_PORT` with defaults; `api/docker-compose.yml` runs
DynamoDB Local on 127.0.0.1:8000; `npm run api:table` creates the table idempotently; `npm run dev:api:ddb` is
the development run against it, and `npm run verify:api:ddb` is the gate that requires it.

**MEASURED, by `api/test/store-probe.mjs`** — the same functions driven twice, once with the in-memory twin and
once against DynamoDB Local (40 checks, 2 negative controls): a create on an absent key lands and reads back at
revision 1; a second create is refused and changes nothing; a replace expecting the wrong revision is refused
and changes nothing; a replace expecting the current revision lands, advances the revision, and REPLACES the
value rather than merging it; what `get` returns is a copy, so mutating it does not write through; nested
values round-trip exactly; two sort keys under one partition are separate items; and two concurrent creates
leave exactly one winner. The controls are RAW SDK WRITES: with the `ConditionExpression` removed, the same
`PutItem` succeeds and overwrites a row the caller never read.

- **Attribute order is not part of the contract**, and the first version of this suite failed four checks per
  store on order alone: DynamoDB returns an item's attributes in its own order, so a value comparison has to
  sort keys (`stable()` in the probe — the same trap `save-probe.mjs` records).
- **A probe has to be re-runnable against a store that keeps what it is given.** The port has no `delete` (no
  endpoint needs one), so the second run found the first run's rows: "an absent key reads as null" failed with
  the revision already at 3. The probe's keys now carry a run stamp.
- **DynamoDB Local authenticates NOTHING.** MEASURED (a throwaway under `api/tools/`, deleted after it was
  read): it answered `DescribeTable` both with the dummy credential pair and with no credentials at all. That is
  why the compose file binds it to 127.0.0.1 and says the bind address is the security boundary.
- **Persistence, end to end.** `npm run dev:api:ddb` was driven over HTTP (current → advance → current), the
  server was killed and restarted, and the same player came back on drill `1:1` with `resumed: true` and `1/4`
  finished — the Progress row is in DynamoDB, not in the process.

**Still not done from Phase 5:** the other four endpoints, the publishing pipeline, Cognito, the Lambda adapter
and its template. **No AWS call has been made**: everything above is DynamoDB Local in a container on this
machine.

**Phase 5.9 — the Daily's run is submitted, and one fact got one name. DONE.**
`DailyRun.submissionFacts(nowMs)` is the run as a submission carries it (`clockSeconds`, `calls`, `hintsUsed`,
`score`), and `paintDaily`'s existing "a solved run is recorded once" edge now ALSO submits it when an API is
configured — the same edge, so the two records cannot disagree about which run was the first. What the server
answers is adopted: `SaveState.adoptHints` replaces the balance, and the line the player reads is the server's
score and board.

**THE HINT DEBIT IS THE POINT.** Offline a hint is debited when it is TAKEN, because the device is the only record;
with a server the balance is its (`hintsUsed` in the transcript is what it debits from), so a Daily that reaches the
server has its hints debited there. What remains outside the server's knowledge is a Daily that is never submitted
at all — an unsolved run nobody sends — and §15 Q19 now says exactly that, with the half of the question that is
still open.

**AND ONE FACT GOT ONE NAME.** The body's day field was `day` while the design's query parameter is `date`
(`GET /puzzle?…&date=`); the client I wrote for the Daily path had to know both, which is the wart this phase
closes: the body field is `date` now, and the runs probe, the handler, the stored row and §11 all follow. The only
consumer was this repository's own client, which is why the rename was cheap now and would not be later.

**BROWSER-MEASURED, against DynamoDB Local** (the game on `:8089`, the API on `:8090` with
`store: dynamodb dancing-squared-dev at http://127.0.0.1:8000`), with the API's log as the evidence:
```
204 OPTIONS /puzzle (preflight) 0 ms
200 GET /puzzle?mode=daily&level=1&date=2026-10-16 52 ms
204 OPTIONS /runs (preflight) 0 ms
200 POST /runs 392 ms
```
`solutionFacts` was played through the page: the published challenge accepted the one-call line ("Allemande Left in
the Alamo Style — that is the goal board"), and the screen answered **"Recorded — the server scores it 1 points.
Best on this board: 1."** — a score and a board the app cannot compute. The balance line then read
**"Hints: 0 of 3 · 0 of 10 to the next"** where the local value had been "1 of 10": the server's fresh record
replaced this device's, which is the adoption happening on screen rather than in a comment. (The 1-point score is
the resumed clock: the Daily charges the wall gap, so a run resumed after ~18 minutes of being away scores
`MIN_RUN_SCORE` — the same rule Phase 4 measured and DESIGN.md 9 states.)

**MEASURED, by the probes.** `game/test/daily-run-probe.mjs` gained 4b: the view reports the CHARGE while the
submission carries the CLOCK alone, and the two round trip to the number the player is judged on — with the
measured control that sending the charged total would double-charge every hint (both numbers are "a time", and only
their sum is pinned). `game/test/api-client-probe.mjs` is now **56 checks**: the Daily's submission names its
`date`, carries its line and its hints, has no `drillId`, and reports no progress. The api suite is green after the
rename (`bad_day` became `bad_date`).

**Phase 5.8 — a solved Drill is submitted, and the SERVER's numbers are the ones adopted. DONE.**
`game/src/net/api.ts` gained `submitRun` (`POST /runs`, typed, with the run, the balance, the board and the progress),
and `main.ts` submits in `finishDrill`: the transcript is `drillOptions` (the calls committed per step, which the app
has been accumulating since Phase 3), with the run's measured facts — clock seconds, attempts, no hints. What comes
back is ADOPTED: `SaveState.adoptHints` replaces the local balance and its earning progress with the server's, and
the line the player reads last is the server's score and board rather than this app's preview of them. Offline the
local rule runs exactly as before, and a submission that FAILS falls back to it — an outage must not cost the player
a success the device can still remember.

**BROWSER-MEASURED, and the pitfalls are the point.** The API's log tells the whole story:
```
204 OPTIONS /runs (preflight) 0 ms
400 POST /runs 170 ms        <- the first attempt, refused: impossible_elapsed
200 POST /runs 189 ms        <- after the fix
```
- the refusal was `the run claims 421.7 s and the drill was issued 19.8 s ago` — CORRECT, and the client was wrong:
  the local save remembered a drill from 421 s earlier while the server had re-issued that position 19.8 s before
  (its store had been restarted), so the client resumed a clock for a drill the server had just handed out.
  **THE ISSUE TIME IS THE SERVER'S WHEN THERE IS A SERVER** (`showDrill` takes `issuedAtMs` from the drill view), and
  the local `startedAtMs` is the OFFLINE origin. The step and the attempts are still restored from the save either
  way: they are the player's progress, not a clock.
- the accepted run showed **"Recorded — the server scores it 19 points. Board: 19 over 1 run(s)."** — a score and a
  board this app cannot compute (the board is the SERVER's cumulative season), while the footer beside it still read
  "Saved on this device: 3 runs · best 100". **That divergence is now visible on screen and is intended**: the local
  ledger is the offline record, the server's board is the ranking, and `POST /me/runs:bulk` is what will reconcile
  them. Until then a player's two numbers can differ, and the one that ranks is the server's.

**MEASURED, by the probes.** `game/test/api-client-probe.mjs` is now 52 checks, 3 controls: the submission's method
and path, the transcript sent as it happened, the measured facts, the adopted score/balance/board/progress, the
clamp flag carried so the player can be told, a refusal keeping the server's sentence, and a response with no score
or balance REFUSED rather than half-adopted (adopting `undefined` would wipe the local balance while claiming the run
was recorded). `game/test/save-state-probe.mjs` pins `adoptHints`: the server's numbers replace the local ones, a
stated count of 0 is adopted as 0 rather than ignored, and the local earning rule still runs on an adopted balance.

**Phase 5.7 — the Daily comes from the published artefact. DONE.**
`game/src/net/api.ts` gained `dailyChallenge(level, day)` and `main.ts` a `startServerDaily`/`showDaily` split, so the
client reads the PUBLISHED seed instead of deriving one — the seed is the same number either way (the app and the
boundary job both call `dailyEntry`), and what the read buys is that it is the number the boundary job VALIDATED: a
day nobody published is the server's own `no_published_daily` refusal rather than a challenge nobody checked, and a
challenge from another pool is refused with the pool named. The generator still runs in the browser, from the
published seed (§9).

**AND THE DEV SERVER IS NOW THE LOCAL STAND-IN FOR BOTH PUBLISHERS.** The in-memory store is per process, so a
separate `api:publish-daily` run could never reach it: the dev server seeds the fixture's regimes AND publishes
today's challenge for the served levels at boot, which is why a developer gets a playable Daily with no setup.
MEASURED: about 2 s added to the start (levels 1-3 at ~0.1 s, ~1 s, ~1 s — the whole 33-level ladder would be an
hour, per §7.1's census), and a server left running across midnight serves the new day as UNPUBLISHED, which is the
honest behaviour: the boundary is a scheduled job's business.

**BROWSER-MEASURED, and the API's own log is the evidence** (the game on `:8089`, the API on `:8090`, memory store):
```
dev:api published 2026-10-16 for level(s) 1, 2, 3
200 GET /drill/current?level=1 247 ms
204 OPTIONS /puzzle (preflight) 0 ms
200 GET /puzzle?mode=daily&level=1&date=2026-10-16 1 ms
```
— the client's own call, the preflight that CORS-fix exists for, and the page then rendering "Today's Daily —
2026-10-16 (UTC), level 1" with the board, the call list and the clock. Clicking the Daily showed
"Asking the server for today's Daily…" first, so the panel is drawn from the READ seed rather than from a local
derivation that happened to be identical.

**MEASURED, by the probes:** `game/test/api-client-probe.mjs` is now 41 checks (the Daily's request shape — mode,
level and date in the query, a GET and not a POST — the server's `no_published_daily` sentence kept verbatim, the
`playable: false` flag for another pool, and two malformed-body refusals including a body with no challenge in it).
`api/test/drill-probe.mjs` gained the boot-seeding measurement in its socket section: a Daily exists for TODAY the
moment the dev server is up, and `2099-01-01` is `404` — so the seeding is the boundary job's stand-in rather than a
generated-on-demand answer.

**Phase 5.6 — the game reads its Drill from the server, in a browser. DONE.**
`game/src/net/api.ts` is the game's ONE outbound path, opt-in by `VITE_API_BASE`: it mints an anonymous device id
(DESIGN.md 8's device-keyed anonymous player), prefers a token when one is stored, and returns a TYPED result for
every outcome — the server's refusal (its message verbatim), a proxy's HTML error page, an unreachable host and a
timeout are all one answer each, and nothing throws. `main.ts` grew `showDrill` (one path for two seed sources),
the fixture path it already had, and `startServerDrill`, which asks the server for the drill and advances through
it — so THE SERVER OWNS THE ORDER and the header's count is its regime. With no base URL the app is exactly the
offline game it has always been.

**BROWSER-MEASURED, on `:8089` against the API on `:8090` (`npm run dev:api`, memory store):**
- the header read **"The Drill — drill 1 of 4, level 1"**: 4 is the SERVER's regime, where the local fixture's is
  12, so the count is evidence the drill came from the API rather than the fixture;
- answering the served drill ("correct."), then **Next drill** → the client called `POST /drill/advance` and
  `GET /drill/current` and the header became **"drill 2 of 4"** with a fresh question — the whole server-authoritative
  progression, played in a browser;
- with the API KILLED and the page reloaded, the region showed "No drill from the server: the server could not be
  reached (TypeError)" and the local ledger still read "1 run · best 100" — the refusal path is graceful, and the
  app keeps what it had.

**THREE DEFECTS THE BROWSER FOUND, all fixed and pinned:**
1. **`npm run dev:api` REFUSED TO START** with no endpoint: my own real-service guard fired for the MEMORY store,
   which never leaves the process. `devServerRefusal` now asks the narrower question ("would THIS run touch
   DynamoDB"), and `api/test/daily-puzzle-probe.mjs` pins both sides — memory starts, DynamoDB without an endpoint
   is still refused. A probe could not have found this; it was the ordinary local run.
2. **No CORS, so the page could not talk to the API at all**: the fetch failed with a `TypeError` and the app said
   "the server could not be reached". The dev server now answers the preflight and sends the allow headers on every
   answer, with a note that a DEPLOYMENT does this at the gateway (API Gateway's CORS configuration) so the handler
   core stays transport-free. Pinned in `api/test/drill-probe.mjs`'s socket section.
3. **The drill view omitted `levelIndex`** — which §11's row for this endpoint then promised ("the seed, the level,
   the option labels and the issue date"; the row promises the whole puzzle now) — so the client refused the response
   as `bad_response`. Fixed in the handler
   and pinned: the level in the answer is the one to generate from, not the one the client asked with.

**GATE.** `tsc -p game --noEmit` → 0; `node game/tools/verify-probes.mjs` → **16 probes, 0 failed** (the new
`api-client-probe.mjs` 81 ms; puzzle-core 84.8 s, schedule-lint 20.9 s, daily 9.7 s, schedule-fixture 5.9 s) with
the corpus check reporting 68 files identical. `tsc -p api --noEmit` → 0 and the api suite green after the two api
fixes. `npm run check:book` → links, anchors and the encoding check pass; the `animations-index.json` DRIFT is the
pre-existing one from another task's corpus work.
**NOT checked:** the Daily and the run submission are still local-only (the client does not call `GET /puzzle` or
`POST /runs` yet), and no deployment — the whole check above is two dev servers on this machine.

**Phase 5.5 — a level's season is authored, validated and published. DONE.**
`api/src/schedule-publishing.ts` is §7.2's authoring pipeline: `generateSeason` scans seeds upward, GENERATING each
candidate and keeping only the ones that produce a puzzle, and `publishSeason` writes the level's `schedule#<level>`
row as a seed, a level and a pool version and nothing else (§11). `api/tools/publish-schedule.mjs` runs it
(`npm run api:publish-schedule`, `--levels`, `--season`, `--dry-run`), and `publishableLevels()` moved into
`levels.ts` so the two publishing jobs share one answer to "which levels can the corpus fill".

**WHY IT MATTERED: a deployed Drill had nothing to serve.** `schedule#<level>` was written only by the dev server's
fixture, so a real deployment answered `404 no_schedule` to everyone. The Daily's path was already complete; this
completes the Drill's.

**THE ORDER IS THE CONTRACT, AND SO IS THE PREFIX.** Seeds are taken in ascending order, so a season is a
deterministic function of `(poolVersion, level, length)`: re-running the publisher is a no-op, and a LONGER season
has the shorter one as its prefix — which is what stops an extension from rewriting a drill already handed out
(§8).

**MEASURED, by `api/test/schedule-publish-probe.mjs`** (29 checks, 6 controls):
- **the skip rule, with its control**: seeds 1..40 at level 1 ALL generate (0 refusals, 104 ms each), so no
  affordable range holds a refusal to demonstrate with — the probe injects a predicate that refuses seed 3 and
  measures the season becoming `1,2,4` rather than `1,2,3`, while the real generator is measured separately by
  authoring and regenerating a three-entry season. A level that can fill nothing gives up after
  `SCAN_PATIENCE × season` candidates rather than spinning;
- **determinism and the prefix**: the same request authors `1,2,3` twice, and a five-drill season starts
  `1,2,3,4,5`;
- **the design's own lint**, imported: the structural pass is clean and the FULL pass — every seed regenerated — is
  clean on three entries, which is why the probe pays for it and the tool does not pay twice per season. Controls:
  an entry from another pool and a repeated seed are both refused. **And the module records that the lint CANNOT
  refuse a level the corpus cannot fill** — the ladder is total — which is `levelIsPublishable`'s question, asked
  before the lint is;
- **end to end**: publishing a season makes `GET /drill/current` serve its first seed and report its length, so the
  pipeline's output reaches the endpoint with no fixture involved;
- levels 1-3 are publishable and level 77 is not (324 titles wanted, 322 carried), and the version names the season's
  length. (The 76/77 boundary is the shipped ladder's; see the note under §5's decisions for the formula.)

**COST, from the measurements in §5, which is why the default is a handful of levels rather than all 76 the corpus
could fill**: a level-1 Daily is ~0.4 s and a deep level's is ~4.9 s (both MEASURED, 5 seeds per cell), so
publishing every level for every day is minutes of work for shelves nothing plays yet. The ladder itself changed
after this phase (floor 20, +4 a level), so the exact figures here are from that phase's census.

**Phase 5.4 — the Daily's boundary job, and the read that needs it. DONE.**
`api/src/daily-publishing.ts` is the boundary job as a module: which levels a day needs, a challenge per level
(the client's own `dailyEntry`, imported), and a write that happens ONLY when the puzzle regenerates. Beside it
`api/tools/publish-daily.mjs` runs it (`npm run api:publish-daily`, `--day` and `--levels` to narrow it) and
`GET /puzzle?mode=daily&level&date` serves what it wrote.

**THE READ DOES NOT GENERATE, AND IT NO LONGER HOLDS THE REQUEST.** The clause that used to govern this endpoint —
"a read of the published artefact, not a generation per request" — was about the CLIENT not generating, and it is
superseded by §9's reversal: the client generates nothing, so the read has to answer with the boards. It DID generate,
INSIDE the request, and that is a defect measured from the outside: a Daily generation costs **9.4-15.1 s** (§7.1), so
one read held a connection open for that long while every other request queued behind it — reported as *"the Today's
Daily button … the app still hangs"*, then *"it needs an asynchronous mechanism to poll if Todays Daily is available"*.
So the read now answers **`202 Accepted { daily: { …, ready: false, puzzle: null } }`** and starts the generation for
AFTER the response (`levels.ts`'s `preparePuzzle` defers it on a timer); the client POLLS (`waitForDaily`, 1.5 s apart
and bounded), and the answer that carries the puzzle is `200 { ready: true }`. The stored artefact is still the seed,
because `POST /runs` re-derives from it to verify — one derivation, read by every reader.

**IT DOES NOT KEEP THE SERVER RESPONSIVE WHILE THE GENERATION RUNS**, and that is stated rather than implied: the
generator is synchronous CPU work, so the process is busy for those seconds once the work starts. What the 202 buys is
that no REQUEST waits on it — the client's requests are short, the button says what is happening, and the player can
play drills. The next step, if the residual block still bites, is a worker thread; it is not done here, and the 202 is
the shape that would not have to change if it were.

**MEASURED, by `api/test/daily-puzzle-probe.mjs`** (39 checks, 5 controls; no DynamoDB needed, because this
path is a store read and a pure derivation):
- **the published seed IS what the client derives**: for levels 1–3 the row's seed equals
  `dailyEntry(levelAt(n), POOL_VERSION, day).seed` — the CLIENT's function, imported rather than restated
  (1268207204, 1318540061, 1301762442 for 2026-10-15) — and a different level and a different day both give a
  different seed, which is what stops a server that returned one number for everything from passing;
- a level or a day nobody published is `404 no_published_daily`, and **the read creates no row**: the server
  never invents a challenge (§9);
- a challenge published against another pool reads back with `playable: false` rather than as if it were fine;
- the query is strict: no level, level 0, a non-numeric or fractional level, no date, `2026-02-30` and
  `15/10/2026` are all `400`, and `mode=drill` is refused because the Drill's order is `/drill/current`'s;
- **re-publishing a day produces the same seed** and stamps the new write, and a day that does not exist is
  refused rather than hashed;
- **the boundary is the POOL and not the ladder**: `publishableLevels()` returns levels 1..76 on the ladder that
  ships now (floor 20, +4 a level: level 77 asks for 324 titles where the corpus carries 322) — while level 900 is
  still "a level" by `levelSpec` (pool 3616), so a publisher that trusted the ladder alone would publish forever.
  (At this phase the ladder was the 5-every-3-levels formula and the number was 33; the point is the same and the
  count moves with the formula, which is why it is measured by the probe rather than written down here.)
- the setup tools refuse to run without an endpoint: measured on `realServiceWarning`, including the
  `DSQ_ALLOW_REAL_AWS=1` override.

**Phase 5.3 — a completed run, verified by regeneration. DONE.**
`POST /runs` exists for both modes. `api/src/runs.ts` owns what a client may send and what the server refuses;
`api/src/handlers/runs.ts` owns the four effects of accepting one — the run's own ledger row, the player's
progress, the hint balance and the board — written as ONE transaction, so a run cannot half happen. The boards
are §6's keys per mode: `board#drill#<level>#<set>` — the published SET's version, `seasonVersion(poolVersion,
season)` for a season the publisher wrote, and NOT the calendar month this line said until §15 Q17(vii) landed — and
`board#daily#<level>#<YYYY-MM-DD>`, with the Daily's holding the BEST and the Drill's the CUMULATIVE total. The set
travels on the drill the server issued, so a run lands on the board of the set its drill came from.

**MEASURED, by `api/test/runs-probe.mjs`** (63 checks, 3 controls, and the probe answers a REAL puzzle: it asks
for the current drill, regenerates it from the served seed, and submits the correct option at every step):
- a correct Drill run is accepted and does all four things at once — the drill is finished, one success is
  counted, the board holds the run, and the transcript is stored with the drill cleared from flight;
- **the score is the server's**: a claim of 999999 is clamped to 50 and REPORTED, and the STORED board holds 50
  rather than the claim; a claim below the computed score is honoured;
- **a run lands once**: the same `runId` answers `duplicate: true` and moves neither the board nor the success
  count; a submission about a drill no longer in flight is `409 stale_drill` and writes no second run row —
  which is why a replay cannot be farmed (§6) — and the finished set holds an index once even if it is somehow
  handed out twice;
- **the per-step answer is re-derived**: a wrong option is `400 not_solved`, and the refusal NAMES the option
  that was correct;
- **the clock is bounded by the issue time**: an hour claimed a minute after the issue is refused, and 300 s
  claimed 400 s after it is accepted;
- **the hint rules hold from the server side**: the TENTH distinct drill grants, the balance then spends on a
  Daily claim, a claim against an empty balance cannot go below zero, and a claim of four hints is refused;
- **the Daily is walked through the engine**: the whole line is accepted, a line that stops short is refused (at
  level 2, whose solution is two calls — at level 1 `solution[0]` IS the whole solution), an illegal call is
  refused with the engine's own reason, and a SLOW replay of the same challenge scores less while the board keeps
  the best;
- a store whose transaction never lands reports `409 contended` after exactly three attempts and leaves the run
  row, the balance, the board and the progress row ALL untouched.

**And the one thing this phase could not verify, recorded rather than hidden: §15 Q19.** The attempt count and
the hint spend are the client's word, because §11's six endpoints give neither a server-side interaction; both
are bounded and priced instead, and Q19 says what a dishonest client gains and what to do about it.

**Phase 5 — AWS.** Cognito, the six endpoints, the DynamoDB table and its item shapes **including the Hints
row**, the schedule publishing pipeline, the boundary job for the Daily, verification-by-regeneration and
clamping, **the server-owned hint ledger**, and the deployment scripts — which live **outside `game/`**, so
this directory's "DESIGN.md only" instruction stays literally true.

**Phase 6 — ads and consent.**

A note on the order: **the two modes can be built in either order**, because neither is front-loaded with a
pipeline — the shared pieces (the generator, the goal test, the stage, the client sequencer) are built once in
Phases 0–2 and used by both. The Drill goes first only because it is the funnel and because it is what earns
the hints; if the Daily turns out to be the more urgent mode, Phases 2 and 3 swap cleanly, at the cost of the
hint having nothing to spend until the Drill ships.

---

## 14. Testability, and what will not be checked

- **Probeable headless, in Node.** The generator, the level specs, the scoring arithmetic, the hint rule and
  the move stack are pure and take no DOM. The engine's data files are readable from `assets/`
  exactly as `engine/test/mainstream.mjs` does, and Node needs `setParser(DOMParser)` from `@xmldom/xmldom` —
  the pattern that file already follows. **The saved game is probeable the same way**, because storage is an
  INJECTED interface rather than a call to `localStorage`: `game/test/save-probe.mjs` drives the loader with a
  fake, with a store that throws, and with records that are corrupt, from another schema and from another
  pool — which is how the resume rules are pinned without a browser (Phase 4). **The shell's own use of that
  record is pinned the same way** (Phase 4.5): `game/test/save-state-probe.mjs` drives `SaveState` — the one
  success per issued drill, the one entry per `runId`, the spend, the flag, and the Daily that a drill
  mutation must not erase — against a fake storage, so a rule that used to be visible only from a browser is
  now a check that runs in 11 ms.
- **The serving-side rules are probeable too, and should be**, because they are the new fairness surface:
  "everyone at a level gets the same seed at the same position", "an issued drill does not change", and
  **"the hint ledger grants on the tenth success and never on a client's word"** are decisions about plain
  data, so they are tested as a pure function over a schedule, a run history and a fake progress record. The
  scoring probe pins that a hint is **exactly** a 60-second charge — one added term, not a multiplier — and
  that it is charged **once** and never refunded by an undo. **Phase 5.0 put the first half of that in place**
  (`api/src/drill-regime.ts` is the schedule/progress/clock function, with no store, no HTTP and no clock of
  its own) and `api/test/drill-probe.mjs` pins the two rules that exist there, driving the real handlers over
  the in-memory store and then over a real socket — so the transport, the identity and the status codes are
  measured too rather than assumed. **`api/test/store-probe.mjs` is the other half**: the item store's
  compare-and-set contract, run through the SAME functions against both implementations, with the DynamoDB half
  skipped LOUDLY when nothing answers on its endpoint and made mandatory by `npm run verify:api:ddb`. A store
  adapter is exactly the kind of code that cannot be argued into correctness — the condition expression is
  either there or it is not — so it is measured against the real DynamoDB API rather than against a twin.
- **The Drill's question is as probeable as the Daily's**, because both are engine data rather than media:
  which option is correct, that the three options have distinct endings, that the illegal option's reason is
  the engine's own, and that every option applies from the shared start board are all properties of the
  generated puzzle. A probe can therefore **answer a whole Drill** under Node, exactly as it can play a whole
  Daily (§4.4).
- **Not checked, and said so rather than implied.** The ad and consent flow, and no AWS call: the schedule
  pipeline, the boundary job, Cognito and the table are designed here and **unverified until they are deployed
  against a real account**. No live AdSense account is touched.
  **THE RENDERER, THE DOM AND THE 2D/3D SWITCH *WERE* OBSERVED IN A BROWSER, and a claim here that they could
  not be was wrong** — it said the Vite app "cannot be started under the sandbox" (AGENTS.md §8 trap 3). The
  sandbox constrains a Node child whose output is piped; it does not stop `npm run dev:game` from binding a
  port. MEASURED in Phase 3: the dev server on 8089 and a real browser drove the Drill and the Daily through
  play, undo, the allowance cap, a hint, the reviewed line and both views, which is how the phase's three UI
  defects and the arms' frame bug were found rather than shipped. What a browser check still does NOT cover is
  the mobile canvas size, the ad flow, and anything behind a login.
- **Every citation in this document is a path or a relationship, never a drifting count**, per AGENTS.md
  §4.2.

---

## 15. Open questions for the owner

Each has a recommendation and the tradeoff, so this does not need another round to act on.

1. **What question does a Drill ask?** *Recommend "which one gets you to the goal board"* (§8), because
   it is the skill the game exists to teach and it needs no call-name vocabulary. The alternative —
   *"which call is this?"* — drills memory instead of connection, and is the better framing for a later,
   separate drill type.
2. **When is an option danced — on press, or previewed first?** *Recommend on press*, with unlimited
   replays, so the clock is the only cost. The alternative — a short preview of all three before the player
   commits — is friendlier to a beginner but spends the question's tension before it is asked.
3. **The schedule's cadence and length.** *Recommend one new drill per day per level and a season of a fixed
   number of drills*, because a daily cadence is the simplest thing to promise and to operate. The tradeoff
   is that the regime then advances at the speed of real time, so a player who plays twice in one day finds
   nothing new — which is the same as the Daily's shape and makes both modes compete for the same visit.
   **This is also the hint pipeline**: the cadence sets how long ten successes take, and so what a hint is
   worth.
4. **The season boundary.** *Recommend calendar months*, which makes the Drill board's period easy to explain
   and easy to reset. The consequence to accept: a season boundary discards the cumulative board, and the
   schedule and the ladder may only be re-authored there (§6). **Hint balances must not reset with it** —
   they are earned effort, not a season statistic (§10).
5. **Can a player skip a drill they cannot solve? — DECIDED AND IMPLEMENTED.** The design as written did not offer a
   skip, so a stuck player was stuck in the regime — and one hard puzzle blocked the order that decision 10 made the
   whole point. **THE SERVER HALF WAS ALREADY THERE**, which is what made this a control rather than a mechanism:
   `POST /drill/advance` marks the current drill finished, earns no score and no hint, and is recorded as an
   abandonment (A25) so a skipped season is visible to an operator rather than a silent gap (§11's table). What ships
   is the control: **"Skip this drill — no score, no hint"**, whose label carries the cost before the press (the
   Q18/Q20 house rule), offered wherever the drill can actually be left behind (`skipOffered`): a SERVER-issued drill
   needs `mayWrite` — so a demo is not offered it, for Q22's reason — an OFFLINE drill is left behind by the local
   position alone, and a PRACTICE drill is not offered it because the fixture has no server entry to close.
   **THE LOCAL LEDGER MIRRORS THE SERVER'S FINALITY**, or the two would disagree about a drill: `save.markSkipped`
   spends the position without crediting it, exactly as `POST /runs`'s credit rule does for a revealed run, so a later
   local solve of a skipped drill cannot earn — which is also what the server does to it (a closed drill answers a
   submission `stale_drill`). **MEASURED IN A BROWSER, three paths**: (a) a signed-in player presses it and the log
   shows `POST /drill/advance` **200** then `GET /drill/current` **200** — and NO `/runs` at all — with the header
   moving "drill 1 of 4" → "drill 2 of 4", the hint progress unmoved at "1 of 10", the ledger unmoved at "3 runs ·
   best 100", and the verdict reading "Skipped — no score for it, and no hint."; (b) an OFFLINE build (a second dev
   server on 8091 with no `VITE_API_BASE`) offers the control and moves "drill 2 of 12" → "drill 3 of 12" with the
   same sentence on screen and nothing sent anywhere; (c) a DEMO — signed out, and again after an expired token — is
   offered NO skip at all, which is `mayWrite` refusing it for the same reason it refuses a submission. The
   sentence's ORDER is load-bearing and was fixed by the browser check: `showDrill` clears the verdict on its way in
   and the offline drill is painted in the same tick, so the sentence has to be said AFTER the issue (the order Q20's
   practice offer uses) or it is never seen. Pinned by `game/test/save-state-probe.mjs` §1c, whose negative control is
   the plausible wrong rule — a skip that moves the player on without spending the position, which lets the same drill
   pay a hint later.
6. **Practice mode: puzzle generation the player controls?** *Recommend a clearly-labelled unranked "just
   practice" that generates from the player's level pool.* The regime is authoritative and the Daily is
   issued, so a third, unranked source costs no fairness — but it is the one place the client would choose a
   seed, and it must never reach a board. **It grants no hints** (§10), which is what keeps the earning rule
   a reward for the regime rather than for repetition.
7. **What exactly does a hint reveal?** *Recommend one call name, from the player's current board* (§10),
   because a whole remaining solution is just the answer. The alternatives — revealing the *next* move only
   versus revealing the first two calls of the remainder — trade a bigger spend for a bigger nudge, and all
   three are the same look-up, so this is a UI choice rather than an engine one.
8. **Can hints be bought?** *Recommend no at v1*, matching Q11's ads-only stance. Note the reason it is a
   real question rather than an obvious no: a hint is the one paid item that does not sell power in a
   competitive mode, because it costs the *buyer* time and standing, and that is a legitimate model to
   reconsider if ad revenue alone does not hold.
9. **Is the Daily's allowance cushion published?** *Recommend yes, as "moves allowed: 3 of 4 used"*, because
   a hidden budget is a trap; hiding it only helps if the board is also hidden, which it is not.
10. **Is the goal board's formation name shown?** *Recommend yes at first*, then experiment with withholding
    it: naming the goal is a big hint, but an older audience may need the anchor, and the name is only ever a
    display either way (§4.2).
11. **The level-curation order** — the actual first-N list. **DECIDED: the list comes from the CALLERLAB Mainstream
    Teaching Order**, the section at the end of the definitions document the repo already keeps as an untracked oracle
    (`docs/New_Mainstream_Definitions_26-03-29.pdf`, extracted to the also-untracked `callerlab-ms.txt`, §"Teaching
    Order", *Effective September 1, 2026*), **and a level's calls must WORK TOGETHER** rather than merely appear
    consecutively in that list. What that means in the tree, read from both sides while writing this:
      * **THE SOURCE, as it actually is** (read from `callerlab-ms.txt`): **48 top-level entries, M1..M50** (the
        extraction mangles two of the numbers — "M1 2." is M12 and "M4 6." is M46 — so a parser must be tolerant or
        the list must be transcribed by hand), and most entries are FAMILIES with lettered variants: M1 Circle Family
        (Circle Left/Right; Circle of 4; Single Circle), M4 Arm Turn Family (Right/Left Arm Turn; Allemande Left/Right),
        M19 Circulate Family (Couples; Named Dancers; All Eight; Single File/Column; Box/Split), M32 Trade Family
        (Couples; Named; Right/Left Hand; Partner), M49 Tag the Line Family (Tag; Fraction Tag). **IT ALSO CARRIES A
        RULE THE PLAIN TEXT CANNOT CARRY**: "It is suggested that calls in italics be delayed until later in the
        teaching sequence" — italics are a font attribute, so the extracted text has lost which calls those are, and
        recovering them means the PDF (or the Playbook it points to) rather than the text file.
      * **THE ITALIC SET IS RECOVERED (this was HANDOVER.md's third open item, and the answer is a measurement rather
        than a guess).** The font is readable from the PDF even though the text is not: page 70's italic face is
        `/F5` = `BCDIEE+CenturySchoolbook-Italic` in that page's `/Resources /Font` dictionary, so each text run's face
        can be read off the content stream — MEASURED with a throwaway scanner over
        `docs/New_Mainstream_Definitions_26-03-29.pdf` (walk the objects, map each page's font resource names to
        `/BaseFont`, then track the face in force at each `Tj`/`TJ`). **19 sub-entries are wholly italic and one is
        partly**: M3b Single File Promenade, M3c Star Promenade, M3d Wrong Way Promenade; M6b Weave the Ring, M6c Wrong
        Way Grand; M8 Reverse Wheel Around; M12a (Ladies Chain 3/4), M12b (Chain 3/4), M12c Chain Down the Line; M13a
        Half Sashay, M13b Rollaway; M15a Separate, M15c Separate Around 1 or 2 into the middle; M19c All Eight
        Circulate, M19d Single File (Column) Circulate, M19e Box/Split Circulate; M21 Left Square Thru; M31d Dosado to
        a Wave, M31e Single Circle to a Wave; M33 Left Swing Thru; M34 Cross Run — that is 21 runs over 11 entries, and
        the partial is M4's `Allemande Left/Right`, where only the "Right" is italic, so `Allemande Right` is the
        delayed call and `Allemande Left` is not. Three of the POOLED titles are therefore italic: `Box Circulate`
        (M19e), `Half Sashay` (M13a) and `Single Circle to a Wave` (M31e). **WHAT THIS DOES NOT SETTLE**: "delayed
        until later in the teaching sequence" is qualified in the document as "See details in the (New) Mainstream
        Playbook", which this repo does not hold, so the DELAY DESTINATION is still the owner's — the pool order is
        the printed one and no entry has been moved.
      * **THE WORK IS A MAPPING, NOT A SORT — AND THE MAPPING IS NOW HAND-CURATED.** The order's names are
        CALLERLAB's and the game's pool titles are the corpus's (`calls-data.ts`, which WAS generated from
        `assets/ms/*.xml` and is now edited by hand: the owner took the order over, `game/tools/build-pool.mjs`
        is deleted, and `game/test/pool-probe.mjs` is what validates the result), so
        "Circle Left/Right (1/4, 1/2, 3/4, Full)", "Promenade Family", "Star Right/Left" and "Trade Family" have to be
        resolved to titles like `Circle Left Home`, `Promenade Home`, `Left Hand Star`, `Boys Trade` — one to
        one in some cases (Dosado, Bend the Line, Courtesy Turn, Dive Thru, Box the Gnat) and one to several in others.
        That mapping is the curatorial act Q11 always was, and it is now a bounded one because the ORDER is given.
        **AND THE POOL'S VOCABULARY IS NOT THE ENGINE'S**, which a hand edit runs into immediately and is worth
        stating before it is discovered: a POOL TITLE is a raw `<tam title>` attribute, and the level loader
        (`data/corpus-node.ts`) registers ONE call per FILE, named by that file's first tam — so it exposes 62 of the
        corpus's 322 distinct tam titles, while the engine's own identity for a tam is `tamName(tam)`, the title plus
        its starting formation (`"Circle Left 3/4 [Static Square]"`), because 398 of 547 corpus files carry a
        duplicate title and a bare title is therefore not a key. MEASURED on the first hand-curated pool (97 titles):
        every one of the 97 is carried by some tam, and **35 of them are titles the loader does not name** — so a
        curated list can only be drawn from once the loader registers more than one call per file, which is a change
        to `data/corpus-node.ts` and to what a pool title MEANS, and not a data edit here. `game/test/pool-probe.mjs`
        reports both numbers separately for exactly this reason.
      * **"WORK TOGETHER" IS THE HALF THE ORDER DOES NOT SUPPLY**, and it is the reason this entry is not simply
        "sort the pool by the list": a level's pool is the first `poolSize` titles, so if two consecutive entries
        cannot be applied in either order the level's generator loses combinations. MEASURED for the CURRENT
        file-order pool, which is what makes the point concrete: of level 1's ten titles **five are legal from the
        starting board** (Allemande Left in the Alamo Style, Allemande Left, Box the Gnat, Boys Fold, Boys Run) and
        **five are never offered** from a Static Square (Bend the Line, Box Circulate, Boys Trade, California Twirl,
        Cast Off Three Quarters) — ten titles of pool and five titles of questions, because the order is the asset
        directory's, not a teaching sequence. The MEASUREMENT that says whether a candidate order works is the
        distinct-supply count per level — the instrument this session already used once (Q17's note: 4 distinct drills
        at level 1 and 18 at levels 2 and 3 over 120 seeds, measured while the engine's getout family is mid-repair, so
        provisional). A curated order should be judged by that count going UP, per level, once the engine is whole.
      * **WHAT IT COSTS AND WHAT IT MUST NOT DO**: `POOL_VERSION` bumps (`ms-2` -> `ms-3`, and it MUST, because a title
        is an identity and re-ordering renumbers every level's pool — `calls-data.ts`'s header says so); the published
        schedules and saved runs carrying `ms-2` become unplayable by design (rule 2's lock and `isPlayable`'s pool
        check); and the ORDER IS NOW EDITED BY HAND — the generator this bullet described
        (`game/tools/build-pool.mjs`) is deleted, so nothing can overwrite the list and there is no build-time read of
        the PDF or of `docs/` at all. The transcription this bullet asked for is therefore unnecessary: the derived
        order IS `calls-data.ts`, and the attribution CALLERLAB's notice requires travels with the design record
        rather than with a generator.
      * **AND THE UNMATCHED TITLES ARE DROPPED (the owner's decision)**: the pool becomes exactly the CALLERLAB
        Mainstream set, and a corpus title with no teaching-order entry stays in the corpus but is never drawn into a
        level. **THE CONSEQUENCE TO KNOW BEFORE DOING IT IS THE LADDER'S CEILING**: `poolFor` is the first `poolSize`
        entries of the order, so a shorter pool lowers how deep the ladder can go — level 30 asks for
        `poolSize(30) = 55` titles and `poolIsComplete` reports the pool as too short rather than quietly serving fewer
        (`pool.ts` says the ceiling is "a MEASURED property of the ladder" and §5 says not to invent it). The census
        (`game/tools/measure-ladder.mjs`) is what reports the new ceiling, so it is run with the change rather than
        after it. The mapping itself — CALLERLAB entry to game title, one to one and family to several — lands with the
        change as a table, because it is the artefact a reviewer has to read.
      * **MEASURED WHILE DOING IT, AND IT BLOCKS THE RE-ORDER UNTIL THE ENGINE IS WHOLE.** The pool was re-ordered to
        this list on a branch, and the game's own gate caught it. With `ms-3` (53 titles, 62 less the 9 dropped) the
        teaching order generates **15 of 30 levels**: `game/test/puzzle-core-probe.mjs`'s ladder walk fails at L1–L15
        with the generator's own reason *"no board is reachable in exactly N call(s) from a squared set at this
        level"*, against 30/30 for `ms-2`. That reason is the NAMED-GOAL gate (`puzzle/generator.ts`, `attempt`: the
        goal is the board the game draws, so it needs a caption), and across the whole 53-title pool **only 5 calls
        reach a named board in one call from a squared set** — `Allemande Left in the Alamo Style` (M31a → Alamo
        Wave), `Square Thru 2` (M21 → Eight Chain Thru), `Star Thru` (M18 → Double Pass Thru), `Pass the Ocean` and
        `Spin the Top` (M35, M46 → Quarter Tag LH). Swept over every prefix of the order: **no prefix up to 30 titles
        generates at depth 1 or 2**; the 31st (M31, Allemande Left in the Alamo Style) is the first that generates at
        depth 1, and the 32nd (M31c, Step to a Wave) the first at depth 2. L1–L6 of the owner's `poolSize(n) = 4n + 6`
        are pools 10–30, so **the first six levels have no puzzle at all** — the calls CALLERLAB teaches first are
        exactly the return-home basics whose one-call endings the engine cannot name.
      * **AND THE CAUSE IS THE ENGINE, WHICH IS WHY NOTHING WAS CHANGED.** `engine/test/getout-convention.mjs` is red
        on this tree at **0 of 28 alignments resolving** — the repair `HANDOVER.md` records as in flight in another
        session. An unnamed intermediate board is not a defect by the engine's own docs, but the GOAL is drawn, so an
        unnamed goal leaves the level with nothing to ask. Re-measure this item once that instrument is green; the
        mapping itself is still the work, and §5's "do not invent the ladder's ceiling" now has a floor under it too:
        a level needs a pool whose calls can reach a nameable board.
      * **A SECOND, INDEPENDENT DEFECT FOUND WHILE MEASURING, RECORDED RATHER THAN FIXED.** The candidate filter asks
        for the goal's name on `boards.get(sig)` — the FIRST board that reached a positions-only `boardSig` — so an
        unnamed ending SHADOWS a named one at the same signature (AGENTS.md §8 trap 11: `boardSig` is positions-only).
        MEASURED at the 18-title prefix: `Heads Separate` and `Pass Thru` reach the same signature as `Star Thru` and
        are seen first, so `nameOf` is asked about the wrong board, the candidate list comes back empty, and the level
        reports "no board is reachable". Removing `Pass Thru` from that prefix does not help — `Heads Separate` then
        shadows it. This one is the game's, not the engine's, and it is not fixed here.
12. **Sound.** *Recommend none at v1.* Voice or music is a large surface (autoplay policy, accessibility, ad
    interaction) and does not serve the objective.
13. **Ads-only, or an ad-free tier?** *Recommend ads-only at v1*: a paid tier adds store fees, tax and a
    cancellation flow for a game whose audience has to be earned first.
14. **Hosting — THE REQUEST PATH IS WRITTEN, AND THE AWS DECISIONS ARE LISTED BELOW.** *Recommend S3 + CloudFront +
    Route 53 for the static front end and API Gateway in front of the Lambdas* — no asset bucket is needed any more
    (decision 13). This app deliberately lifts the repository's offline-frontend rule (AGENTS.md §6), so the decision
    to make a network call must be recorded in the commit that adds it, with the endpoint named.
    **WHAT IS BUILT**: `api/src/lambda.ts` is the adapter — an API Gateway HTTP API event (payload format 2.0) in,
    `{ statusCode, headers, body }` out — and it holds NO AWS SDK, NO credentials and NO table names, so the whole
    deployed path is driven by fixture events in `api/test/lambda-probe.mjs` (15 checks over routing, identity, the
    body rule, preflight, `/health` and the 500-for-a-throw). It reads the SAME route table the dev server does, which
    is why `POST /drill/reveal` — an endpoint that landed long after the adapter was written — is served with no
    adapter change at all. The decisions a request has to make are shared with the local server in
    `api/src/dispatch.ts` (the emulator's routes first and only where an emulator exists, the 404 body, the
    500-for-a-throw, and the body rule), and the probe drives the same request through BOTH transports and asserts the
    answers match, because a deployment that refuses a body or an unrouted path differently from the local run is a
    difference nobody would see until a user did.
    **THE DECISIONS THE NEXT STEP NEEDS** — each is a real choice with a consequence, and every VALUE belongs in a
    config file with `DSQ_*` overrides rather than a literal (AGENTS.md §6; `api/src/config.ts` is the existing reader
    and `realServiceWarning` is the guard that refuses to CREATE anything without an explicit endpoint):
      1. **Which gateway flavour**: HTTP API (payload 2.0, cheaper, what the adapter reads today) or REST API (1.0,
         and one more mapping function). The adapter's header records this as a choice rather than a fact.
      2. **Where CORS is answered**: the adapter answers preflights itself (and does so correctly for `cognito`,
         advertising `content-type, authorization` and NOT the `dev` header), or the gateway's own CORS configuration
         does it without invoking the function, which is cheaper — `DSQ_CORS_ORIGIN` then narrows the origin, and the
         adapter's `*` default is for the local run only.
      3. **The table and the pool**: table name, region, account — `DSQ_DDB_TABLE`/`DSQ_*` already exist for the local
         DynamoDB run, and the pool's identifiers (user pool id, client id, issuer, audience, JWKS) are the ones
         `config.ts` reads for `cognito`. NO literals, and `api/tools/create-table.mjs` already refuses without an
         explicit endpoint (trap 21).
      4. **The static front end**: bucket, distribution, certificate and the `VITE_API_BASE` the build is made with
         (the client's one switch, `game/src/net/api.ts`), plus the decision that the SPA's routing needs the
         distribution's 404 → `/index.html` behaviour.
      5. **The two boundary jobs** (`api:publish-schedule`, `api:publish-daily`) need a schedule of their own — before
         the first player arrives each UTC day for the Daily, and before a month turns for the schedule (which is Q17's
         season boundary, still the owner's call).
      6. **The operator's signals** (A25): a log group for the refusals the route table counts, and the alarm on the
         refusal rate — `abuse#<playerId>` rows exist, and nothing reads them yet.
    **WHAT IS NOT DONE, AND IS DELIBERATELY NOT**: no AWS resource has been created, by this change or any other
    (AGENTS.md §8 trap 21 records what happened the one time a command defaulted to a real account), and nothing here
    is deployed or deployable by a script yet — the composition root that builds a real `Deps` (DynamoDB store plus the
    Cognito verifier) and wires it to `handleEvent` is the next change, and it is the one that needs the decisions
    above.
15. **The workspace name**, for `game/package.json` when Phase 1 starts. *(Settled: `dancing-squared-game`.)*
19. **CLOSED by A22 and A23 (§11.1) — the attempt count and the hint spend were the client's word.** The Drill's
    `attempts` priced a run (§6's `attemptFactor`) and the Daily's `hintsUsed` debited the balance (§10), and
    neither had a server-side interaction among §11's six endpoints, so the server could only bound them:
    `attempts >= 0`, and the debit clamped at zero. **What a client gained by lying, in numbers** (measured, §11.1):
    reporting zero attempts raised a Drill score from **80 to 100** (+25 %), and hiding one hint at L1 took it from
    **21 to 100** (4.8×). **The recommendation this question carried — make both interactions server-side — is
    A22 and A23**: presses and moves are recorded by the server, so `attempts` is counted and the spend is an
    event; an abandoned Daily is debited at abandonment. What stays open is not the claim but its COMPLETENESS for
    a client that plays the puzzle itself — §11.1's known limits (1)–(3) say so, and none of them is closable
    without changing what the client is served.
20. **When the API is unreachable, should the Drill FALL BACK to the local fixture? — DECIDED AND IMPLEMENTED: no
    silent fallback, and a labelled offer instead.** The fixture's order is not the season's, so serving it quietly
    would ask a different question from everyone else's and record it as if it counted. What ships is the
    recommendation: when `GET /drill/current` fails the app shows the server's own sentence AND reveals a footer
    control labelled "Practice offline — this one will not count"; taking it plays the local fixture, says in the
    verdict line that this is the device's own drill and not the season's, and hides the offer again (it is a choice,
    not a mode). **The standing knows the difference**: `standingOf` takes `practice` as a fact of its own, separate
    from the server's `demo` — the two mean opposite things about the server ("I served this and will not rank it"
    versus "I was never asked") and share one answer — and it is checked BEFORE `dev`, which is what makes the offer
    honest: in `dev` mode a signed-out caller IS ranked, so without that a fixture drill would be marked ranked while
    the app knew it was not the season's. The ledger's unranked clause follows automatically, because the lines are
    painted from the same rule. **The run is still kept on this device, and that is deliberate**: the local ledger is
    what A26 later imports as UNRANKED HISTORY, which is exactly what a practice run is — a run the server never
    issued, buying no standing — while `serverDrill` is null on this path, so `finishDrill` has nothing to submit and
    credits the local rule instead. *The tradeoff is unchanged*: a player on a flaky connection cannot play the regime
    until it returns, which is the price of the order being the server's — and the offer is now the honest thing they
    can do meanwhile. **THE DAILY HAS NO SUCH OFFER**, deliberately: Q20 is about the SEASON's order, and a Daily whose
    published artefact cannot be read is refused with its reason rather than replaced by a locally derived seed, which
    would be a different challenge from everyone else's. Pinned in `game/test/standing-probe.mjs` §4b, whose negative
    control is the plausible wrong rule ("dev always ranks") that passes every other check in that file.
    **THE TWO THINGS THIS ENTRY STILL OWED ARE NOW OBSERVED, in one session.** (1) The offer against a server that
    ANSWERS and refuses, rather than being unreachable: four skips (§15 Q5) finished level 1's season, the next
    `/drill/current` answered `drill: null`, and the app said **"No drill from the server: every drill in this level's
    season has been finished"** — which is the client's wording of a legitimate "the season is over" answer, not a
    server sentence — and revealed the same labelled offer. (2) The practice run's LATER IMPORT: the fixture drill was
    played and solved ("Solved in 49.2 s, first try — 30 points", the ledger reading "4 runs · best 100 — unranked: a
    practice drill, so it is kept here and never submitted"), and signing out and back in produced **"1 run from this
    device imported as history: kept, and not ranked"** — ONE run, not four, because the three earlier runs had already
    been claimed by the previous sign-in: `POST /me/runs:bulk`'s create-only rows showing up as a delta rather than as a
    client remembering. **AND THIS SESSION FOUND A DEFECT IN Q22's OWN FIX, in exactly this path**: on the practice run
    the verdict read *"…That is as far as a signed-out drill goes — the season is the server's, so sign in…"* and "Next
    drill" was HIDDEN, because `serverDrill` was still holding the last SERVER-ISSUED drill while the drill on screen
    was the fixture — a stale shell fact standing in for "this drill came from the server". Filed as §15 Q23 and fixed
    in its own change.
16. **Does an answer given AFTER "show me the answer" count as a ranked success?** Phase 3 made the review
    name and dance the call without answering the step, so a player still presses it — and that press earns a
    score and, on the tenth completed drill, a hint. *Recommend NOT counting a revealed puzzle*, because a
    hint is a currency and "press the button, then press the call you were told" mints it for free; the
    difficulty is that the LEDGER has to know the puzzle was revealed, which means the revealed flag has to
    reach the server with the run. DESIGN.md 11 already puts hint-earning on the server, so the transcript
    needs one more field rather than a new mechanism. Nothing in Phase 3 depends on the answer: the review
    scores what a correct answer scores, and the server clamps it from Phase 5 either way. **DECIDED AND IMPLEMENTED
    (A28, §11.1)**, and the recommendation is the one taken: a revealed drill is kept and counted for nothing — no
    board row, no hint, and the regime still advances. The server half records the reveal as an EVENT
    (`POST /drill/reveal`) and decides the run's standing; the client half records which steps were shown, posts them,
    declares the count on the run and stops crediting a revealed drill against its own offline ledger; and the button
    now carries its cost on its label before it is pressed. **MEASURED IN A BROWSER** (Chrome, `npm run dev:game` on
    8089 with `VITE_API_BASE=http://127.0.0.1:8090`, `DSQ_AUTH=emulate npm run dev:api` on 8090, the dev server's own
    log read): a signed-in player at drill 1 presses "Show me the answer — this drill will not count" (the label,
    before the press), the log gains `200 POST /drill/reveal` and **no** `/drill/answer` until they press the call
    the app named, and the finished run reads *"Recorded — the server scores it 62 points. Not ranked: you were shown
    the answer, so it earns no hint and does not reach the board."* The two consequences are visible beside it and
    both are the rule rather than a sentence about it: the hint progress stays **"0 of 10 to the next"** and the
    board panel says **"Nobody has a score on this board yet."** The NEGATIVE CONTROL IS THE SAME FLOW WITHOUT THE
    REVEAL, run in the same session: drill 2, one wrong press then the right one, reads *"Recorded — the server
    scores it 80 points. Board: 80 over 1 run(s)."*, the progress moves to **"1 of 10 to the next"**, and the board
    panel then reads *"1 player on this board. 1. emu:… (you) — 80 — 1 run"* — so the difference between the two
    runs is the reveal and nothing else. **AND THE REVEAL SURVIVES A RELOAD**, which is the client half's own rule:
    drill 3 was revealed, the page was reloaded mid-drill (the same drill resumed, and only ONE reveal POST in the
    whole session — the restored fact rides on the run's claim), and solving it still answered *"…100 points. Not
    ranked: you were shown the answer…"* with the progress unmoved at **"1 of 10"**. The regime advances as designed:
    after the revealed drill the next issue is drill 2 of 4. A signed-OUT player's press of the same button sends
    NOTHING at all — no `OPTIONS`, no `POST` — which is A20's rule holding from the other side. **What the browser
    also found is NOT part of this rule**: pressing "Next drill" after a recorded run is refused (see Q21), measured
    on BOTH paths above — with and without a reveal — so it is a pre-existing defect in the shell rather than
    anything A28 introduced.
17. **How many drills are in a season, and how does a season end? — DECIDED BY THE OWNER (two rounds; round 2 revised
    two of round 1's answers, and the revisions SIMPLIFIED the design).** The rule, as it now stands, then what it means
    for the code.
    **THE RULE.** (i) **A season is a CALENDAR MONTH** — round 1 said "numbered seasons of 13 entries (28 day seasons)",
        and round 2 revised it: *"it might as well align to the calendar month then. It will make more sense to players
        as well."* Each season publishes **13 new drill entries per level**, and the season is numbered for display.
    (ii) The one-per-day cadence is a GATE **for the Daily Challenge only**; DRILLS ARE NOT RESTRICTED, "as this is
        where the learning happens".
    (iii) The server keeps generating NEW UNIQUE drills per level and ADDING them, "but there will be a limit at which
        point the drills repeat".
    (iv) **NOTHING ROLLS OVER AND NOTHING IS CLOSED**: round 1 said an unfinished drill rolls over a boundary, and round
        2 replaced that — *"an unfinished drill doesnt roll over, it just remains uncompleted and prevents them
        ascending to the next level. All drills must be finished to progress to the next level."*
    (v) **A LEVEL IS 100 DRILLS**, shown as a **10×10 block** with a cell per finished drill, "it doesn't need to be
        fully populated", and more blocks are added as more drills become available — **BUT A LEVEL'S REQUIREMENT IS ITS
        FIRST BLOCK ONLY.** An extra 10×10 array is content added to a level that proves popular, and a player
        ascends when the **first** array's last cell fills, so adding a block never moves the finish line for
        someone already on the level. That corrects the earlier "a block IS a level", which read as one block per
        level; and (iv)'s "all drills must be finished" is then "all 100 drills of the FIRST block", which is the
        only reading under which extra arrays can exist without becoming a retroactive requirement.
    (vi) **The server owns the player's level**: finishing all 100 drills of a level promotes them to the next one.
    (vii) **THE BOARD'S KEY HOLDS THE CHALLENGE'S IDENTITY, NOT A TIME PERIOD** — round 3, prompted by the owner asking
        whether a period is needed at all once progress is a 10×10 block. The answer is that the SLOT stays and the
        PERIOD goes: for the **Daily** it holds the published DAY, which is the same thing as saying which puzzle it
        is (two days are two different puzzles, so a board without the day would rank different questions together and
        crown whoever caught the easiest one); for the **Drill** it holds the published SET — the schedule version —
        instead of the calendar month it holds today. The owner kept the Daily's board rather than dropping it, so the
        day is the Daily's board identity and nothing else; and there is now **no time period anywhere in a board key**.
    **WHAT THE RULE CHANGES, AND WHAT IT DOES NOT — the second list is the interesting one.**
      * **The board's period is UNCHANGED IN SHAPE AND CHANGED IN MEANING (vii) — IMPLEMENTED.** Round 1 would have made
        the period a season NUMBER; the answer is smaller than that and larger than "nothing": `keys.ts`'s
        `boardKey(mode, levelIndex, period, playerId)` keeps its four slots and `boardPk` keeps its shape, so neither the
        partition nor `GSI1` moves — but the DRILL's value is no longer `seasonOf(nowMs)` (`handlers/runs.ts`) and is now
        the published set's identity, which is `seasonVersion(poolVersion, season)` (`schedule-publishing.ts`) — the
        string that has existed since the publisher landed and never had a reader. **WHERE IT COMES FROM MATTERS AS MUCH
        AS WHAT IT IS**: it is the `Schedule` row's own `scheduleVersion`, carried on the ISSUED DRILL
        (`IssuedDrill.scheduleVersion`) and copied into the run row, rather than recomputed from the clock or re-read
        from the schedule at submission time. That is rule 2's argument one field over — a drill already handed out
        keeps its seed across a republish, so it keeps the set it belongs to — and it is why a republish does NOT
        re-issue a locked drill: the drill in flight finishes on the OLD set's board, which is where its score belongs,
        and the next drill is drawn from the new set. Consequences worth stating rather than discovering: the Drill
        board's clock then matches the BLOCK's clock (one unit of progress, one board, no month resetting a score while
        the block keeps filling); a set that is EXTENDED or re-published starts a fresh board rather than moving the
        denominator under existing scores; a RETRY reads the period off the run row it is retrying, so a retry on the far
        side of a republish still answers about the board the first answer named. And `seasonOf` (the calendar month,
        `game/src/puzzle/season.ts`) lost its last two runtime callers (the drill period in `handlers/runs.ts` and the
        client's `boardPeriod()` in `main.ts`) — **so the module was DELETED rather than left as an unused export**,
        because a season NUMBER is now a publisher's argument and a display, and nothing derives one from a clock. The
        DAILY's value is unchanged: the UTC day, which is its puzzle's identity, and `runs-probe.mjs`'s month-boundary
        checks stay valid for the DAILY's dates even though a Drill no longer has a month — §2b of that probe now pins
        the other direction, submitting a Drill run on both sides of a boundary and finding one board.
      * **The Progress row is UNCHANGED and needs no season**, which removes the whole candidate-rule question I had
        written up: nothing is closed at a boundary, so `progressKey(playerId, levelIndex)` with `finished` holding
        schedule indices is exactly the right shape, and a month boundary touches it not at all. Round 1's "the season
        goes in the row (or in the key)" was the answer to a question this rule no longer asks.
      * **The hint balance still does not reset** — `hintsKey(playerId)` has no level and no season, and Q4's rule
        stands. Nothing in this rule changes it.
      * **NEW: a LADDER ROW, because the server owns the level — IMPLEMENTED.** `ladder#<playerId>` / `current`
        (`api/src/keys.ts`'s `ladderKey`) holds `{ levelIndex }`, and `api/src/ladder.ts` owns the rule: an ABSENT row is
        level 1 (a player who has never been promoted has no row), a row this build cannot read is REFUSED rather than
        read as level 1, and a level whose block is full promotes to the next one. `GET /drill/current` reads it and
        serves THAT level instead of the caller's `?level=`, which is now consulted only for a demo — a caller the server
        cannot name has no ladder, so "their level" does not exist for them. `LEVEL_SIZE` (100) lives in
        `game/src/puzzle/levels.ts` and is read by BOTH sides, the publisher's `--season` default and the promotion
        rule, because a second copy of the number is how "the level is full" and "all its drills are finished" come to
        disagree. **THE PROMOTION IS EVALUATED WHERE THE LEVEL IS READ, NOT WHERE A DRILL IS FINISHED**: an advance is
        written on two paths (`POST /drill/advance` and `POST /runs`), so a promotion written on either is a second row
        whose loss leaves a full block with no next drill to finish — nothing would ever retry it. Read-time evaluation
        makes the level DERIVED from the same `finished` set the block draws, so the rule has one home and a lost write
        heals on the next request. It also refuses to promote into an unpublished level: a player whose block is full at
        the top of the published ladder stays there (and is answered `complete`) until the operator publishes the next
        one, rather than being moved to a level whose every read is `404 no_schedule`. Progress is already partitioned
        per level (`progressKey(playerId, levelIndex)`), so nothing is lost — the new row is the one that says which
        level is THE PLAYER'S.
        **WHAT IS NOT DONE, stated rather than implied**: `main.ts`'s rule is still "A LEVEL IS ASKED FOR, NOT
        DECIDED: the player's level comes from the save", so the app keeps sending `?level=<save>` and the server
        ignores it for an identified player. The app ADOPTS the answer's level for the Drill (`useLevel(spec)`), but it
        does not write it back to the save, so the DAILY still asks for the save's level — a signed-in player whose
        ladder has moved can therefore be on level 1 in the Drill and level 3 in the Daily. Closing that is a
        client-side change (persist `drill.levelIndex` into the save and let `/puzzle` follow it) and is not in this
        commit.
      * **the 10×10 block IS BUILT, and the note that used to stand here was WRONG.** It said this was "a `game/src/ui/`
        surface with no new endpoint: the drill answer already carries the regimen's `finished` and `length`, so a cell
        per finished drill out of the level's 100 needs nothing else." The answer carried `finished.length` — a COUNT —
        not the set, and a count can only fill the first N cells, which assumes progress is a prefix that a hand-edited
        row or a republish can break. So the payload was widened to `{ finished: number[], passed: number[], length }`,
        a `passed` set was added to the progress row (a skip and a revealed solve close a position without teaching it),
        and the cell rule moved out of the screen into `puzzle/block.ts` with `block-probe.mjs` — a rule that lives only
        in a screen has no gate (AGENTS.md §8 trap 27). The surface, the five cell states and the browser check are
        recorded as §15 Q25.
      * **The publisher's job becomes a monthly cadence**: 13 entries per level per season, ADDED rather than replaced,
        which it already supports — `publish-schedule --season N` is a deterministic function of
        `(poolVersion, level, N)` and a LONGER season has the shorter one as its PREFIX, so next month's publication
        cannot rewrite a drill already handed out (rule 2's lock). `scanSeason` reports the candidates it skipped
        rather than silently repeating. **The flag's DEFAULT is now `LEVEL_SIZE` (100), not 31**, because Q17(v) fixed
        what a level is: a level published short of its block size is a level no player can be promoted out of, and the
        failure would look like a player who simply stopped progressing.
      * **"Drills unrestricted" needs no change either**: `currentDrill` hands out the next unfinished entry the moment
        the previous one is finished, with no day gate, while the Daily is already published per UTC day.
    **WHY PROMOTION STAYS REACHABLE, WHICH IS THE ONE THING THAT COULD HAVE BROKEN IT.** "There will be a limit at
    which point the drills repeat" and "all drills must be finished to progress" sound like they contradict each other,
    and they would if the 100 were 100 UNIQUE puzzles: a level whose pool cannot supply 100 distinct drills could never
    be finished, so promotion would be impossible rather than slow. It does not break, because the schedule is a list of
    ENTRIES and `finished` holds INDICES — a repeated puzzle published at a NEW index is a new entry, it is finishable,
    and it advances the set. The cost is a player meeting a drill they have seen before, which is the outcome the rule
    accepts. **The number that decides how soon that happens is MEASURABLE and NOT YET MEANINGFUL, because the engine
    is mid-repair**: measured by scanning seeds at level 1 (a scratch script, deleted), the first 120 seeds make
    **4 distinct questions**, and the counting has two causes that must not be confused — `offered()` is the ENGINE's
    list of calls legal from the board, while "which call reaches the goal" is the SOLVER's answer, and the solver's
    getout family is being re-authored right now (`engine/test/getout-convention.mjs` is the red acceptance instrument:
    0 of 28 alignments resolve). So the figure is a SYMPTOM of that repair and not a property of the ladder; the
    instrument for the durable number is the existing ladder census (`game/tools/measure-ladder.mjs`, `engine`'s
    `shape-census`), which is where this belongs when the engine is whole. Nothing in the implementation needs the
    number to be large; the UI must simply never promise "100 new puzzles".
18. **Can a player make the device forget them? — DECIDED AND IMPLEMENTED.** Phase 4 kept the regime, the balance and
    every run in `localStorage` and nothing cleared it, so a player who wanted a fresh start had to find their
    browser's site-data settings. What ships is the recommendation this question carried: a plainly-labelled control
    in the footer ("Start over on this device"), armed by the first press and performed by the second, whose label
    says what the second press will do. **THE BALANCE GOES WITH THE LEDGER**, because it is inside the same record —
    so the reset is honest by construction rather than by remembering to clear two things — and that settles the
    tradeoff this question left open: a reset that kept the hint balance would not be a reset at all. What is
    deliberately NOT touched: the signed-in SESSION (`net/session.ts`'s item, with its own control and its own
    sentence — "Sign out") and the DEVICE ID (`net/api.ts`), which is not the player's data but what lets an
    anonymous regime be resumed, so clearing it would change who the server believes is asking while forgetting
    nothing about the player. Two consequences are stated rather than hidden: the SERVER's rows are not this device's
    to forget, so a signed-in player's next `GET /drill/current` may answer with the same drill from their own
    Progress row; and a device that REFUSES the write (`clearGame` returns false — private mode, a blocked origin)
    is shown as a refusal, never as a fresh board the player has not got. The confirmation is a two-press armed state
    rather than a native `confirm()`, because an armed state is a rule the shell owns and whose text the player
    reads, where a browser dialog is an API no probe can see. Pinned in `game/test/save-probe.mjs` §15, whose checks
    are about SCOPE — exactly one key removed and it is the record — plus the state object's own forgetting, which is
    what stops a reset that clears the key and leaves the in-memory record to be written back on the next `persist`.
    **MEASURED IN A BROWSER** (`npm run dev:game` on 8089, offline build): with one solved drill and its local success
    on the device — "Saved on this device: 1 run · best 100", hint progress "1 of 10" — the first press only ARMS the
    control (its label becomes the erase sentence, the board and the ledger unchanged), and the second press returns
    the ledger to "Saved on this device: nothing yet", the hint progress to "0 of 10 to the next", a fresh drill 1 of
    12 to the board and the label to its unarmed text. **AND THE DISARM IS NOW OBSERVED TOO**, in the session that closed
    the other gaps: the first press arms the control ("Press again — this device's runs and hints will be forgotten",
    with the ledger still reading "3 runs · best 100" — nothing cleared), and a switch to the Daily and back returns
    the label to "Start over on this device" with the ledger untouched, which is `applyMode`'s disarm doing its work.
21. **"Next drill" is refused after a run that was recorded — DECIDED AND IMPLEMENTED** (found by the Q16 browser check).
    A submitted run finishes its drill server-side (`POST /runs` → `finishDrill`, which clears the in-flight lock), and
    the app then advanced before it issued: `startServerDrill('advance')` called `POST /drill/advance` with a drill the
    server no longer had in flight, the server answered **`409 stale_drill`** ("this player has no drill in flight, so
    there is nothing to advance"), and the app showed that and returned with `controller = null` — an empty Drill panel
    whose only way on was a manual reload, which DID issue the next entry, because the regime had advanced. **MEASURED
    IN A BROWSER, ON BOTH PATHS**: the same 409 after the revealed run (Q16) *and* after the ordinary ranked run in one
    session, so it was not A28's doing — the shell was asking the server to advance a drill the server had already
    advanced — and every api-side probe passed over it, because the server was behaving exactly as designed and `main.ts`
    is the layer no probe loads.
    **WHAT SHIPS** is the alternative this entry named, and the choice between them is a measurement rather than a
    preference. The ENDPOINT KEEPS ITS REFUSAL: a repeated advance is refused on purpose — the plausible wrong rule
    ("finish the first unfinished entry") finishes an entry nobody saw, pinned with its own negative control in
    `api/test/drill-probe.mjs` §3 — and every refusal carrying an identity is COUNTED against the player (A25,
    `api/src/abuse.ts`), so a shell that went on asking would add a `stale_drill` to the operator's probing signal on
    every completed drill. So the SHELL stops asking: `serverRecordedRun` is set when a submission is accepted
    (a duplicate included — the server holds the row either way), cleared by `showDrill` and by the reset, and
    `issueCurrentDrill` turns an `advance` into a **read** whenever the run on screen is one the server took. A run the
    server did NOT record still advances, which is the right request for an outage or a refusal: §11 records an advance
    as a skip, so a season with a hole in it is visible rather than silent. **MEASURED IN A BROWSER** (same recipe as
    Q16): after a RANKED run the header moves to "drill 2 of 4" and the log shows `POST /runs` followed by
    **`GET /drill/current?level=1`** with no `advance` at all; after a REVEALED (unranked, but still recorded) run the
    same, to "drill 3 of 4"; and the loading line the player sees is the read's own — "Asking the server for your
    drill…" rather than "…for your next drill…". **NO PROBE CAN PIN THIS** (`main.ts` is not probe-loadable, the same
    reason Q16 was owed a browser check), so the instrument is the browser check and this paragraph is its recipe.
    **AND THE BRANCH THAT WAS ONLY REASONED IS NOW DRIVEN**, in the gaps session: a signed-in player's submission was
    made to fail (the API was stopped mid-run, so the run stayed local — "The server would not record this run: the
    server could not be reached (TypeError)", the ledger going to "5 runs · best 100"), and pressing "Next drill"
    then attempted the **advance**, which the sentence names exactly — "The server would not advance this drill: the
    server could not be reached (TypeError)", where the READ path's failure says "No drill from the server: …". So a
    run the server did NOT record still advances, which is the right request for an outage: §11 records an advance as a
    skip, so the hole a lost submission leaves is visible rather than silent. (No dev-server log line exists for that
    step, because the server was down by definition — the evidence is the sentence's own wording, which is why the two
    failure sentences are distinct in the first place.)
22. **A signed-out player's "Next drill" is a dead button — DECIDED AND IMPLEMENTED.** A demo's solve is
    credited locally and never submitted (A20: the server takes no writes from a caller it served without a Progress
    row), so Q21's rule sends the advance — and a demo has no Progress row to advance, so the server answers
    **`401`** ("this endpoint needs a signed-in player"). MEASURED IN A BROWSER: the demo drill is solved (the ledger
    reads "1 run · best 100 — unranked: the server is not recording this run"), "Next drill" is pressed, and the log
    gains `204 OPTIONS /drill/advance` + **`401 POST /drill/advance`** while the panel loses its drill entirely — no
    question, no options — and the sentence says only what the endpoint wants. Unlike Q21's 409, this 401 is NOT in
    A25's tally (a refusal with no identity is attributed to nobody, which is deliberate), so the cost is entirely the
    player's. There is nothing WRONG on the server side: §11.2 says a signed-out caller gets a demo, and a demo is one
    drill with no memory of them, so no advance can exist.
    **DECIDED AND IMPLEMENTED**, and the recommendation is the one taken: the control is not offered when it cannot
    work. The rule is not a new one — it is `mayWrite`, the predicate the submission, the press and the reveal are
    already guarded by (`net/standing.ts`, pinned in `game/test/standing-probe.mjs`) — consulted at the one call site
    that was missing it, which is why there is no new export and nothing new for a probe to drive: the defect was a
    guard applied three times out of four, and the instrument is a browser check. The verdict carries the guidance in
    the place the player is already reading — "…That is as far as a signed-out drill goes — the season is the server's,
    so sign in to be issued the next one." (§11.2's wall, on the label rather than in a refusal) — and the demo test is
    checked BEFORE the reveal test, because a signed-out run was never going to count and "you were shown the answer"
    would name the smaller reason. **MEASURED IN A BROWSER**: signed out, the solve reads that sentence and there is NO
    "Next drill" control at all, with the log for the whole demo session holding only the boot's `GET /health` and
    `GET /drill/current` — no `OPTIONS /drill/advance`, no `401`, no write of any kind; and as the NEGATIVE CONTROL, a
    signed-in player on the same build still gets the control, which moves the header to "drill 2 of 4" through
    `POST /runs` → `GET /drill/current` (Q21's rule doing its work), so the guard hides it for a demo and for nobody
    else. The alternative this entry weighed — let a demo re-issue the same entry — is rejected: it shows one drill
    forever, which reads as a broken button in a different way.
    **THE PREDICATE WAS TOO WIDE AND A PRACTICE RUN PROVED IT** (filed and fixed as Q23): `demoOnly` asked
    `serverDrill !== null`, and `serverDrill` is shell state that is NOT cleared when the practice offer takes over —
    the last SERVER-ISSUED drill sits in it while the drill on screen is the device's own fixture. So on a practice run
    the verdict said "…as far as a signed-out drill goes — the season is the server's, so sign in…" and "Next drill"
    was hidden, which is wrong twice: the player IS signed in, and a practice run must not be what stops them
    returning to the season.
23. **A practice run is told it is signed out — DECIDED AND IMPLEMENTED.** With Q22's rule as written, the practice
    path (`startPractice` → `startDrill` → `showDrill`) leaves `serverDrill` holding the last server-issued drill, so
    `demoOnly` fired: the practice verdict read "…That is as far as a signed-out drill goes — the season is the
    server's, so sign in to be issued the next one." while the account row said "Signed in as …" and the ledger said
    "unranked: a practice drill, so it is kept here and never submitted", and "Next drill" was suppressed.
    **THE FIX IS A NAMED FACT RATHER THAN A SECOND CONDITION**: `serverIssued()` is
    `serverDrill !== null && !practiceRun` — `practiceRun` is what `startDrill` sets and `startServerDrill` clears —
    and every caller that means "the server's drill" now asks it instead of the variable: Q22's verdict, Q5's
    `skipOffered`, the press and the reveal guards, the submission guard, and `issuedSeed()` (which was reading the
    stale drill's SEED for a fixture run — the same bug one field further on, found by grepping for the variable
    rather than by the browser). It mattered in one more place than the browser showed: `startServerDrill`'s advance
    guard advanced `serverDrill.id` for a practice run's "Next drill", so returning to the season from a practice run
    would have asked the server to advance a stale id and been refused.
    **MEASURED IN A BROWSER** (the API stopped, so the offer is reached by a failed read): the practice run now reads
    the plain **"Solved in 28.0 s, first try — 54 points."** with no signed-out sentence, the ledger keeping its
    "unranked: a practice drill…" clause, and **"Next drill" IS offered**; pressing it shows the READ's failure —
    **"No drill from the server: the server could not be reached (TypeError)"** — rather than the advance's
    ("The server would not advance this drill: …"), which is how the stale advance is shown to be gone. No probe can
    pin any of this (`main.ts` is not probe-loadable), so the instrument is the browser check and this paragraph is
    its recipe.
24. **A failed issue leaves the previous drill's buttons looking live — DECIDED AND IMPLEMENTED.** When `issueDrill`
    fails — the season complete, an outage — `startServerDrill` sets `controller = null` and calls
    `drillScreen.render(null)`, and `render` returned immediately, so the LAST question and its three option buttons
    stayed on screen. They were inert (every handler guards on `!controller`: `answer`, `review` and `skipDrill` were
    each checked rather than assumed), but a control that looks live and silently does nothing is the thing this repo
    calls a defect in its own words — `answer`'s out-of-range branch exists because "surfacing it as a message beats a
    silent no-op on a button that looked live". MEASURED twice in one session: after the season-complete refusal, and
    again after the offer was declined by signing out and back in.
    **WHAT SHIPS** is the recommendation, in the place it named: `DrillScreen.render(null)` — the one call that already
    means "there is no drill" — clears the OPTIONS and says "No drill to play." in the prompt, while leaving the BOARD
    alone (the picture is where the player was, and clearing it is the caller's business) and leaving the VERDICT line
    to the caller, which has already put the reason there. **MEASURED IN A BROWSER** (dev:game 8089 with the API
    stopped, so the offer is reached by a failed read): the panel reads "No drill to play." over the last board, with
    the verdict "No drill from the server: the server could not be reached (TypeError)", NO answer buttons at all, and
    the labelled offer standing; and as the NEGATIVE CONTROL, taking the offer restores the question and three live
    options for the fixture drill. No probe can pin this: `DrillScreen` is DOM, and the game's probe layer does not
    load `src/ui/`.

25. **THE LEVEL SCREEN AND THE 10×10 BLOCK — DECIDED IN TEN PARTS, and two of them were measurements rather than
    preferences.** Requested: "a screen before the game screen that allows the player to see their progress and select
    the next drill to play", plus "only the first 100 are required to finish the level" and "the daily challenge can
    have waypoint formations/arrangements".
    **(a) THE ORDER STAYS THE SERVER'S, AND A SKIPPED CELL IS STILL A WAY BACK IN — CORRECTED.** The grid is a progress
    map, not a menu, and `next` is the server's. **The original decision here said "replay of a finished drill is NOT
    wired — a done cell is a statement", and that was the DEFECT once the block grew a `passed` column (b):** a skip
    closes a position WITHOUT passing it, so a cell drawn as a statement left a drill that could never be passed and a
    column that could never be completed. Report: "the player has to be able to reattempt drills that are skipped,
    currently they are locked off". **`POST /drill/replay` is that route**, and the narrowness is the whole of the fix:
    only a position that is **finished and NOT passed** can be reopened (`replayDrill`, `api/src/drill-regime.ts`), so
    the order still decides what is NEXT — a reattempt never changes `nextIndex`, never names a seed and never earns a
    hint. The cell rule is `isReplayable` in `puzzle/block.ts`, gated by `block-probe.mjs`; the issue carries
    `replay: true` so a reload resumes it (`api/test/drill-probe.mjs` §11).
    **AND THE STATED CONSEQUENCE WAS MEASURED AND DOES NOT HOLD**: promotion reads `finished`, not `passed`
    (`levelComplete`), so a level closed entirely by skips still promotes — MEASURED, a full block with an empty pass
    set is promoted to level 2, which §11's last two checks pin. The defect was the dead cell, not the ladder.
    **(b) `passed` IS A SECOND SET.** A skip and a revealed solve both close a position and neither teaches it, so
    `DrillProgress.passed` (a subset of `finished`, enforced on read) is what lets a cell say "done" against "done and
    passed". The row parser reads an ABSENT set as "finished, pass unknown" — the migration, not a failure.
    **(c) THE WIRE CARRIES THE SETS**: `regime: { finished: number[], passed: number[], length }`. A COUNT can only fill
    the first N cells, and `drill-regime.ts` records that a hand-edited row or a republish can produce a gap.
    **(d) THE SUPPLY IS A FULL BLOCK**: the local fixture bakes `LEVEL_SIZE` level-1 drills (100) plus four each at
    levels 2-3 — MEASURED 108 puzzles, 858 KB of boards, game bundle 2,932 kB (was 2,279).
    **(e) THE POOL GREW SO LEVEL 1 TEACHES WHOLE FAMILIES**: `BASE_POOL` 20 → **57**, because 20 stopped mid-family
    (`Circle Four Left` without `Circle Four Right`). 57 is the boundary of the tenth whole family, the order was
    grouped into contiguous families to make that boundary exist, and `pool-probe.mjs` pins that the shipped boundary
    splits none. MEASURED consequence: a Daily at L1 costs ~5 s where the 20-title L1 was ~0.5 s (§5 finding 4).
    **(f) LEVEL 1 STAYS A TWO-OPTION QUESTION**, pinned rather than derived: with a 57-title pool `optionCountFor`
    would hand it three, and the teaching level's shape is a product decision, not a consequence of the pool.
    **(g) THE DRILLS ARE STORED, ONE ROW PER DRILL** (`drill#<level>` / `<index>`) — 100 puzzles in one item would be
    ~1.1 MB against DynamoDB's 400 KB ceiling. The publisher writes drills BEFORE the schedule (the schedule is what
    publishes them) and stamps `GENERATOR_VERSION`, so a store built by an older generator is REFUSED rather than
    silently served: a stale store would otherwise keep serving yesterday's boards with nothing to notice.
    **(h) THE HINT'S DISTANCE TABLE IS SHARED PER PUZZLE, and that was a defect rather than a refinement.** It lived on
    the `PlaySession`; the server builds a session per hint spend; ONE build is **79-100 s** at the 57-title pool. So a
    hint cost a minute and a half every time, and `hint-event-probe` measured **770 s**. A second hint is now **1 ms**.
    The FIRST build is still ~100 s and is NOT fixed — recorded as the next known cost, whose levers are a
    hint-specific node budget, a smaller move allowance, or making `offered` cheaper per board.
    **(i) THE CELL RULE IS A MODULE, NOT A SCREEN** — `puzzle/block.ts` with `block-probe.mjs`, because a rule that
    lives only in a screen cannot be imported by a probe (AGENTS.md §8 trap 27). Five states, with the precedence
    `unpublished` > `done` > `next` > `published`, so a stale `next` cannot repaint a finished cell.
    **(j) THE BLOCK IS THE DRILL TAB'S HOME** — `drillView: 'level' | 'drill'` beside `mode`, and entering the tab still
    ISSUES a drill so the grid takes `next` as an input rather than deriving the rule.
    MEASURED IN A BROWSER against the dev API: the block reads "Level 1 — 0 of 100 done, 0 passed" with 100 cells;
    entering one shows the question and "Back to the level" returns; skipping a drill and then Next produced "2 of 4
    done, 1 passed" with the skipped cell "done, not passed" and the solved one "solved" (that pair was measured before
    the fixture grew to 100). NOT CHECKED: the offline (no-API) grid was not driven, and a cell is ~28 px in the 340 px
    panel — below the 44 px touch target the rest of the page uses, which is a real cost of ten cells across this panel
    width.

---

## 16. Explicitly not in this change

**THIS SECTION IS THE BOUNDARY OF THE COMMIT THAT FIRST LANDED THIS FILE — a deliberate part of the brief it was
written under, and NOT a description of the tree today.** It is kept, and labelled, because a reader who took it as
state would be wrong on every line; it read:

- No game source, no `package.json`, no lockfile, no `.gitignore`, no CI, no submodule.
- **Nothing is staged or committed.** The brief was "do not put them under source control at this point", so
  this file is left as an untracked working-tree file. The tree also carries mid-edit corpus XML and engine
  sources that belong to someone else's in-flight work and are **not** touched (AGENTS.md §8 trap 16).
- No engine edit: `sameBoardById` and the renderer extraction are designed here and performed in Phases 0
  and 1.

**WHAT IS TRUE NOW**, and each of these is checkable rather than remembered:

- **`game/` is a tracked workspace package**: 133 tracked files, with its own `package.json`, `tsconfig.json` and
  `vite.config.ts`, the Vite app (§13), and 18 probes under `game/test/` that `game/tools/verify-probes.mjs` runs as
  a gate (`AGENTS.md` §1's map row). The lockfile and `.gitignore` are committed, and so is this file.
- **Every phase the boundary listed as future has landed** — the game source, the renderer extraction, the schedule
  and its publisher, the auth surface, the leaderboard — and §13's phase table is the record of what each one added,
  with §11.1's A-numbers as the cheat-resistance record. The engine and API work that followed is in those sections
  rather than here.
- **No CI**, which is the one line that is still true: there is no `.github/` and no CI configuration, so §3's local
  gate is the only gate before a push (`AGENTS.md` §10.6 says exactly that).
- **No engine edit came from this design's commit, and none is wanted**: the engine is still the single source of
  truth, and `game/` imports its VALUES by name (`sameBoardById`, `boardSig`, `makeSquaredSet`, `computeHandholds`)
  while reaching the one mutable engine object only through `src/engine/applier.ts` (`AGENTS.md` §1).
- **The tree really does carry other people's in-flight work**, which was true when the boundary was written and is
  true today: the corpus under `assets` is regularly mid-edit, and an uncommitted corpus change by another
  session is what stops `tools/sync-corpus.mjs --check` from passing while it is there (`AGENTS.md` §8 trap 16). That
  is a fact about the working tree, not about this design.
