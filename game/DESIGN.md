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
| 5 | Ladder: L1 is 10 calls and a one-call solution; the solution length rises to 3, then the pool widens by 5 every 3 levels. | `LevelSpec` and the level→spec function in §5. |
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
infrastructure.** A published Drill entry is a **seed**; the client generates its three options and dances
them on the renderer the Daily already needs. The mode that looked like the cheap one and the mode that
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
- **The Mainstream corpus is what the level-1 pool must be carved out of.** `poc/src/assets/` carries
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

**Offered moves** are the level's registered titles intersected with `Sequencer.legalNext()` from the
*current* board. The engine contract this leans on, from the method's own comment
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
it has teeth:

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

1. **A three-option question needs a pool of at least 35 titles.** Below that, the reachable board graph has
   no route from the squared set whose played-from boards all offer three distinct endings. So `optionCount`
   is a **per-level value**, and levels 1–15 ship with **two** options because the alternative is a level
   that cannot make a puzzle at all.
2. **Depth 3 is capped out.** It generates at most pools, but its worst case reaches **7.2 s** (pool 45) and
   it *regresses* to 2 options in places — and the Daily regenerates on the client, where 7 s is not a load
   state, it is a hang. **The ladder ships `depth ≤ 2`.**
3. The measured ladder: `poolSize(1) = 10`, `poolSize(n) = 10 + 5 + 5·floor((n − 4)/3)` for `n ≥ 2`,
   `depth = 1` at L1 and 2 after, `optionCount = 3` once `poolSize ≥ 35` (L16) and 2 before. All **30**
   levels generate; worst level **4959 ms**; largest exploration **194 states**.

So the three bullets below stand as the *design's intent*, and the table above is what the corpus supports.
The gap is recorded rather than papered over: **the design asked for three options at every level and a
depth-3 ceiling, and this ships what the corpus can actually generate.**

- **L1 = `{ poolSize: 10, depth: 1 }`.** That is decision 5's starting point.
- `depth` rises 1 → 2 and stays (design: 1 → 3; capped, see above).
- Once depth has finished rising, `poolSize` grows by **5 every 3 levels**.
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
| Drill | `board#drill#<level>#<season>` | The **cumulative** score over the level's regime: the schedule is a progression (§7.2, §8), not a daily allowance, so the board accumulates across the season |

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
- **A reverse BFS from the goal** produces the distance-to-goal map. This is what gives all three consumers
  what they need: the Daily's shortest-solution figure and move allowance, the Drill's option filtering, and
  **the hint's "does this move make progress?"** best look-up (§10) — so the hint needs no search of its own
  and is deterministic from the seed like everything else. It also makes an *arbitrary* goal cheap, which the
  engine's own `getout` is not — that search is built around returning to `Static Square` and appending a
  standard finish, and its frontier cost is the reason the plan records search shape carefully (AGENTS.md §3,
  the L × C refutation).
- **Quality gates — constraints that reject a seed and retry, never warnings:**
  - the puzzle is solvable, and the shortest solution is exactly `depth`;
  - every board along the intended path is **named** by `recognize` (an unnamed board is legal — the engine
    says an unrecognised board is not a defect — but it is unteachable as a puzzle state, and the Daily
    shows the goal as a picture);
  - the start and goal boards are distinguishable at a glance, so the puzzle is not solvable by "they look
    the same";
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
and no media; the client regenerates the entry from `(seed, level, poolVersion)` with the same call it would
use for the Daily, which is what keeps the two modes on one generator rather than two.

### 7.1 Generation performance — the one real risk, so it is measured

The call pool is small by construction (it is the level), and a published entry is a seed rather than a
pre-built puzzle. The generator therefore runs **on both sides** — the server to create and to validate, the
client to play — and the budget that matters most is the client's, because it runs in a browser. Phase 1
must **measure generation time per level** and pin the node budget so the worst level generates within a
stated time **on the client**; the server's copy can afford more, and the design must not assume they are the
same number. No unmeasured budget ships.

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
- **The illegal option's reason is the engine's own string**, displayed verbatim.

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
- **The option order is shuffled per issue and stored nowhere**, because the client regenerates the entry
  from the seed: the shuffle is part of what the seed determines, so it is reproducible without a published
  index. (An earlier revision had to publish a `correctIndex` because the answer had to survive a video
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
a seed; the client generates the board and the three options and animates them with the stage it already
needs. Nothing is pre-rendered, so the presentation is data rather than media (§7.4) and the answers cannot
drift between the client and the server, because both derive them from the same seed with the same code.

- **Two boards on screen — "you are here" and "get here" — and three answer buttons.** Pressing one *dances*
  that option, then gives its verdict. The player can replay an option as often as they like before
  committing, which is the presentation room the engine buys (§7.4): a replay, a caption, a slow pass and a
  side-by-side are all the same data.
- **The framing of the question is a teaching decision with two readings,** and both use the same three
  options: *"which call is this?"* (name the motion) and *"which one gets you there?"* (choose the motion
  that reaches the goal board). **Recommended for v1: the second**, because it is the skill the game exists
  to teach and it needs no call-name vocabulary the player may not have.
- **The illegal option is the lesson.** It stops part-way, and the engine's own refusal reason is shown
  verbatim — the same reason string the Daily shows, from the same `applyToBoard` result (§4.1).
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
  drill I am on"; the serving layer answers with **the seed, the level and the option labels**. Which entry is
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

---

## 9. Mode B — the Daily Challenge (once a day)

**The Daily needs the engine and a sequencer on the client** (§4), because the player adds and removes calls
and must see the consequences. Every board the player sees is computed in the browser from the level's own
call set, with no round trip; the API is touched only to fetch the day's challenge and to submit the run.

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
| `GET /drill/current?level` | Drill | **The drill this player is on** — the seed, the level, the option labels and the issue date. The server decides which entry: the first schedule entry the player has not finished, or their locked part-finished one. Not a `GET /puzzle` by seed for this mode, even though the client *could* apply one: the player does not choose their seed, and which entry is next is the server's fact (§8). |
| `POST /drill/advance` | Drill | Mark the current drill finished, so the next request for `/drill/current` returns the next schedule entry. **It earns nothing** — no score, no hint — and it is recorded as an abandonment (A25) so a skipped season is visible to the operator rather than a silent gap. |
| `GET /puzzle?mode=daily&level&date` | Daily | The published challenge for that level and UTC date — a read of the published artefact, not a generation per request (§9). **An identified read also records WHEN this player looked at it** (the attempt row that starts the Daily's clock, A21); a signed-out one records nothing. |
| `POST /drill/answer` | Drill | One press, recorded as it happens (§11.1 A22): the step and the call the player chose. **The server derives the verdict** from the puzzle it issued and answers with the wrong-try count so far; nothing about the press is taken on trust, and it scores nothing. |
| `POST /daily/move` | Daily | One move, undo or redo, recorded for the same reason (A22): the Daily's line and its length become the server's record rather than the submission's claim. |
| `POST /me/hints` | Daily | Spend a hint (§11.1 A23): the server debits the balance and records the spend against the challenge's attempt row, answering with the balance. **The spend is the anti-cheat part and it is the server's**; the call the hint names is still computed by the client until the recorded line exists (`POST /daily/move`), because §10's look-up runs over the board the player is standing on. |
| `POST /daily/abandon` | Daily | Give up today's challenge (A25's accounting): the attempt is stamped as abandoned, ONCE (a second call keeps the first stamp), and it does NOT bar a later submission — the app lets a player replay both lines, and an abandonment is a fact about the attempt. The hint an abandoned run owes is no longer debited here: A23 moved the debit to the moment a hint is taken, which is strictly better. |
| `POST /runs` | both | One completed run. **Drill**: the issued-drill id and the `runId`; the calls chosen — one per step — and, under A22 (§11.1), they are the transcript of presses the SERVER recorded rather than a claim. **Daily**: the level, the date and the `runId`; the line the server recorded. `elapsed`, `attempts` and `hintsUsed` appear in the body only as AUDIT inputs — the server measures the first (A21), counts the second (A22) and debits the third (A23). The server re-derives which option was correct at each step rather than trusting the client's claim about it. |
| `POST /me/runs:bulk` | both | Import a device's local ledger as **unranked history** (A26): one `history#<playerId>` row per run, marked `unverified`, and NOTHING ELSE — no board, no hints, no progress, and no row in the results partition. A run already imported is SKIPPED rather than rewritten, so a second import claiming a better score for the same id changes no number. |
| `GET /leaderboard?mode&level&period` | both | The board for one mode, level and period |

`GET /drill/current` works **without an account, and then it is a demo**: the server answers the level's first
entry from the schedule, writes no Progress row for that caller, and reports it as a demo (§11.2). A signed-out
player therefore follows the same order as everyone else without a progression of their own, and the moment they
sign in, their progress is a Progress row keyed on their `sub` — which is why the Progress row's key includes the
player rather than the level alone.

**The three endpoints as they are implemented (Phase 5.0 and 5.3), so the client can be written against them.**
`GET /drill/current?level=<n>` → `200 { drill: { id, index, levelIndex, seed, poolVersion, issuedAtMs,
optionLabels, resumed }, regime: { finished, length } }`, where `drill` is `null` once every entry of that
level is finished. `id` is `"<level>:<index>"` — meaningful rather than opaque, because the only check that
matters ("is this the drill I issued you?") is an exact comparison against the player's Progress row, and an
opaque token would need a row or an index to resolve. `POST /drill/advance { drillId }` → `200 { regime }`.
Refusals are `{ error: { code, message } }` with a status: `400 bad_level`/`bad_drill_id`, `401
unauthenticated`, `404 no_schedule` (that level has no published regime — the normal state of a fresh
deployment), `409 stale_drill` (the id is not the one issued) and `409 contended` (three compare-and-set
attempts lost), `503 unreadable_progress`/`unreadable_schedule`/`unplayable_drill` (a stored row this build
cannot read, or a published seed that no longer generates — both operator findings rather than client errors).
**A refusal never writes**, which is what makes a retry safe.

`GET /puzzle?mode=daily&level=<n>&date=<YYYY-MM-DD>` answers `{ daily: { day, levelIndex, seed, poolVersion,
publishedAtMs, playable } }` — the PUBLISHED artefact and nothing more: no board, no option labels, no
generation, because the client derives the puzzle from the seed (§9) and `POST /runs` regenerates it to verify.
`playable` is false when the row was published against a pool this build does not serve, which is the same rule
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
`404 no_published_daily`, and `409 stale_drill`/`stale_pool`.

**The `Schedule` item as it is published (Phase 5.5).** `schedule#<level>` / `current` holds `{ scheduleVersion,
entries: [{ seed, levelIndex, poolVersion }] }` — a seed, a level and a pool version, no puzzle, no board, no media
(§11, decision 13). The order is ascending and the season is a PREFIX of any longer season, so extending one cannot
rewrite a drill already handed out. `scheduleVersion` is `ms-1-season<N>`: it names the pool and the length, which
is what an operator needs to see that a republish changed the regime. It deliberately does NOT encode the
generator's version, because a change there is caught by `lintSchedule` re-running the generator rather than by a
string comparison.
**DynamoDB, one table**, `PK`/`SK`, with a `GSI1 (GSI1PK, GSI1SK)` for the two leaderboard partitions and a
`seed#playerId` dedup index so a replay does not spam a board with duplicate entries. The item shapes below
are the storage form of decisions 10, 11 and 15, and of the two published sources of a puzzle:

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
| **A23 — the hint spend is an event, not a field.** | `POST /me/hints` debits the balance and records the spend against the challenge's attempt row at the moment the hint is taken, so the run is charged 60 seconds per RECORDED spend and a submission claiming more than the record is refused (`unrecorded_hints`). The balance and the event move in one transaction. **The call it names is still the client's** (see the status table): §10's look-up runs over the board the player is standing on, and for the Daily that board is the recorded line — `POST /daily/move` is what records it. `POST /daily/abandon` is what debits the hint an abandoned run owes. |
| **A24 — scoring is a function of server facts only.** | Measured elapsed, counted attempts, server-debited hints, the regenerated `shortest` and the recorded line. The answer reports measured against claimed, so a disagreement is visible rather than silent. |
| **A25 — accountability is recorded.** | Every accepted or refused run stores what was measured and what was claimed plus its flags, and increments a bounded `abuse#<playerId>` counter. The gateway throttles per player, and a refusal-rate alarm is the operator's signal that someone is probing. |
| **A26 — the bulk claim is HISTORY, not rank.** | A device's local ledger may be imported only as `unverified` rows that count for nothing — no board, no hints, no progress — because a run the server never issued cannot be verified. This amends decision 6: the anonymous ledger is kept, and it buys no standing. |
| **A27 — local development never needs a provider, and never reaches production.** | Three identity modes (§11.2). `dev` is refused when the environment is production. |

**Known limits, stated rather than dressed up as defences.** (1) Automation that plays correctly earns at most a
**par** score — but it earns it every time, and no submission can prove a human made it. (2) The information a
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

| Not yet enforced | Today | Lands in |
|---|---|---|
| A22's Daily half | the Drill's presses are recorded and counted; the Daily still submits a line the server walks rather than a log of moves, and its `attempts` is 0 by design (§6) | `POST /daily/move` |
| A23's naming | the spend is the server's and an abandoned challenge is recorded (`POST /daily/abandon`); the CALL a hint names is still computed by the client | `POST /daily/move` |
| A25's remainder | EVERY endpoint's refusals increment the bounded `abuse#<playerId>` tally (the count is applied at the route table, so coverage is a property of the table); no structured log and no alarm yet | logging, the alarm, per-player throttling at the gateway |
| the `cognito` flow | the surface offers a form only where `/health` advertises sign-in routes, which is `dev` (none) and `emulate` (the emulator's five); a deployed pool's hosted flow is not opened by this build | stage 7, with the pool |

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
   globs written as `../../poc/src/assets/...`, Vite compiled all three to **empty objects**
   (`const MOVES = /* #__PURE__ */ Object.assign({})`) and the app sat on "Loading the corpus…" forever.
   The intended arrangement — one corpus, globbed where it lives — is therefore not achievable by aliasing or
   by a path alias: `game/src/assets/` is a COPY of `poc/src/assets/`, and `tools/sync-corpus.mjs --check`
   runs **first in the gate** so the copy cannot drift silently. AGENTS.md §1 still says the corpus lives in
   `poc/src/assets` and that still holds: what the game ships is a build input with a gate on it.
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
   overlapped in the middle — the one thing "you are here" and "get here" must never do.

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
- the option labels are the ones the same generator produces from that seed (2 of them at level 1, where the
  solution is 1 call — so "return the solution instead" fails the count check);
- two concurrent requests agree on ONE issued drill, a lost compare-and-set is retried (2 reads of the row), and
  a writer that never lands is reported `409 contended` after exactly 3 attempts;
- an unreadable progress row is a `503` **and the refusal wrote nothing** to it.

**What this phase did NOT do, and what came next:** the DynamoDB adapter (Phase 5.1, below — the in-memory twin
implemented the same protocol, so the condition expressions were unverified until then) and the other four
endpoints (`GET /puzzle`, `POST /runs`, `POST /me/runs:bulk`, `GET /leaderboard`). No Lambda, no template, no
Cognito, no AWS call: the SAM CLI is installed (1.169.0) and nothing has been deployed.

**One open decision with a number.** `GET /drill/current` generates the puzzle to return `optionLabels` as
§11 says it should, and that costs **167-230 ms at level 1 and 728-1240 ms at levels 2 and 3** on a warm
applier, per request — including a resumed read, which is the common case. The client derives the same labels
from the same seed anyway (§8), so returning only the seed would make every request a data read. The labels are
served for now because they are the cross-check that the two sides generated the same question.

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
3. **The drill view omitted `levelIndex`** — which §11's row for this endpoint promises ("the seed, the level, the
   option labels and the issue date") — so the client refused the response as `bad_response`. Fixed in the handler
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
- levels 1-3 are publishable and level 34 is not (65 titles wanted, 62 carried), and the version names the season's
  length.

**COST, from §7.1's own census, which is why the default is levels 1-3 and not all 33 the corpus could fill**: a
31-drill season is ~3.2 s at level 1 (MEASURED: 40 seeds at 104 ms) but ~2.5 minutes at each deep level (L25-L30
are 3.3-4.9 s per generation), so "publish every level" is an hour of work for shelves nothing plays yet.

**Phase 5.4 — the Daily's boundary job, and the read that needs it. DONE.**
`api/src/daily-publishing.ts` is the boundary job as a module: which levels a day needs, a challenge per level
(the client's own `dailyEntry`, imported), and a write that happens ONLY when the puzzle regenerates. Beside it
`api/tools/publish-daily.mjs` runs it (`npm run api:publish-daily`, `--day` and `--levels` to narrow it) and
`GET /puzzle?mode=daily&level&date` serves what it wrote.

**THE READ DOES NOT GENERATE.** DESIGN.md 11's clause is the whole design of this endpoint — "a read of the
published artefact, not a generation per request" — so the response is the stored seed, level and pool version
plus a `playable` flag for this build's pool, and no applier is touched. The client derives the board from the
seed with the same generator the server will use to verify it, which is what makes everyone's challenge the
same (§9).

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
- **the boundary is the POOL and not the ladder**: `publishableLevels()` returns levels 1..33, and level 34 asks
  for 65 titles where the corpus carries 62 — while level 900 is still "a level" by `levelSpec` (pool 1505),
  so a publisher that trusted the ladder alone would publish forever. (This corrected an arithmetic guess of
  "31 levels" made while writing the code; the probe printed 33.)
- the setup tools refuse to run without an endpoint: measured on `realServiceWarning`, including the
  `DSQ_ALLOW_REAL_AWS=1` override.

**Phase 5.3 — a completed run, verified by regeneration. DONE.**
`POST /runs` exists for both modes. `api/src/runs.ts` owns what a client may send and what the server refuses;
`api/src/handlers/runs.ts` owns the four effects of accepting one — the run's own ledger row, the player's
progress, the hint balance and the board — written as ONE transaction, so a run cannot half happen. The boards
are §6's keys per mode: `board#drill#<level>#<YYYY-MM>` (a season, §15 Q4's calendar month) and
`board#daily#<level>#<YYYY-MM-DD>`, with the Daily's holding the BEST and the Drill's the CUMULATIVE total.

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
  the move stack are pure and take no DOM. The engine's data files are readable from `poc/src/assets/`
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
5. **Can a player skip a drill they cannot solve?** The design as written does not offer a skip, so a stuck
   player is stuck in the regime. *Recommend allowing a mark-and-continue with no score for that drill*:
   without it, one hard puzzle blocks the order that decision 10 made the whole point. Note the interaction
   with §10: a skip grants no hint, so skipping is not a shortcut to tips.
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
11. **The level-curation order** — the actual first-N list. *Recommend authoring it with a teaching caller*,
    because it is the one input the engine cannot supply.
12. **Sound.** *Recommend none at v1.* Voice or music is a large surface (autoplay policy, accessibility, ad
    interaction) and does not serve the objective.
13. **Ads-only, or an ad-free tier?** *Recommend ads-only at v1*: a paid tier adds store fees, tax and a
    cancellation flow for a game whose audience has to be earned first.
14. **Hosting.** *Recommend S3 + CloudFront + Route 53 for the static front end and API Gateway in front of
    the Lambdas* — no asset bucket is needed any more (decision 13). This app deliberately lifts the
    repository's offline-frontend rule (AGENTS.md §6), so the decision to make a network call must be recorded
    in the commit that adds it, with the endpoint named.
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
20. **When the API is unreachable, should the Drill FALL BACK to the local fixture?** As shipped it refuses, showing
    the server's failure ("the server could not be reached") and keeping the local ledger. *Recommend NO silent
    fallback, and a LABELLED one instead*: the fixture's order is not the season's, so serving it quietly would ask
    a different question from everyone else's and record it as if it counted. The honest version is Q6's unranked
    practice mode, offered explicitly ("practice offline — this one will not count"), which is a screen decision
    and a few lines of state, not a change to the serving rules. *The tradeoff*: a player on a flaky connection
    cannot play the regime at all until it returns, which is the price of the order being the server's.
16. **Does an answer given AFTER "show me the answer" count as a ranked success?** Phase 3 made the review
    name and dance the call without answering the step, so a player still presses it — and that press earns a
    score and, on the tenth completed drill, a hint. *Recommend NOT counting a revealed puzzle*, because a
    hint is a currency and "press the button, then press the call you were told" mints it for free; the
    difficulty is that the LEDGER has to know the puzzle was revealed, which means the revealed flag has to
    reach the server with the run. DESIGN.md 11 already puts hint-earning on the server, so the transcript
    needs one more field rather than a new mechanism. Nothing in Phase 3 depends on the answer: the review
    scores what a correct answer scores, and the server clamps it from Phase 5 either way.
17. **How many drills are in a season, and how does a season end?** Unchanged from Q4/Q3 above; Phase 3 left
    the fixture's twelve drills wrapping round, which is a demo of a regime rather than a regime.
18. **Can a player make the device forget them?** Phase 4 keeps the regime, the balance and every run in
    `localStorage`, which is the player's own machine and nobody else's — but there is no control that clears
    it, and a player who wants a fresh start has to find their browser's site-data settings. *Recommend a
    plainly-labelled "start over on this device" in the footer, behind a confirmation*, because the ledger is
    unclaimed until login (§11) and losing it silently is worse than a two-tap reset. The tradeoff to decide:
    a reset that also clears the HINT BALANCE is the honest reading ("forget this device"), while a reset that
    keeps the balance is not a reset at all. Phase 4 deliberately ships neither, because it is a UI and privacy
    decision rather than a persistence mechanism.

---

## 16. Explicitly not in this change

- No game source, no `package.json`, no lockfile, no `.gitignore`, no CI, no submodule.
- **Nothing is staged or committed.** The brief was "do not put them under source control at this point", so
  this file is left as an untracked working-tree file. The tree also carries mid-edit corpus XML and engine
  sources that belong to someone else's in-flight work and are **not** touched (AGENTS.md §8 trap 16).
- No engine edit: `sameBoardById` and the renderer extraction are designed here and performed in Phases 0
  and 1.
