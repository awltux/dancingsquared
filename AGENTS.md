# AGENTS.md — how to change this repo

<!-- mojibake-check:allow — §8 trap 1 quotes the corruption on purpose, as its signature. -->

**What this file is.** The durable rules for working here: the loop, the gates, the house style, and the
traps that have already cost hours. It is deliberately **not** the state of the work — that is `PLAN.md`
(the scoreboard in §2, the work queue in §4, what is refuted in §3). A rule here should still be true in
ten sessions; the moment one is disproved, fix it **in the same commit** that disproved it.

**If you read nothing else:** §0 (the loop), §3 (the gates) and §10 (delivery). Everything else is a reason
for one of them.

---

## 0. The loop — one change, one QA pass, one commit

Every change, without being asked. This is the whole workflow:

1. **Read before you edit.** The authority for what you are touching, from §2. If you are changing
   behaviour, find the harness or probe that already pins it and read it first — it usually names the
   reason the current behaviour is the way it is.
2. **Make ONE change.** One concern, one intent. If you cannot say what it is in a subject line, it is
   two changes.
3. **QA-refactor it before you test it.** Read your own diff top to bottom and apply §4 and §5: dead code
   and scaffolding gone, names that say what the thing is, comments that state the rule and the
   measurement rather than restating the code, the rule in the module that owns it rather than at the call
   site, and a probe that would go red if the change were reverted. **A revert that leaves no test red is
   not finished.**
4. **Run the gate that covers the change** (§3). Not "the gate that is fastest" and not "all of them" —
   the one that would catch this change going wrong, plus the typecheck.
5. **Commit that change, alone** (§7). A multi-line message via `git commit -F`, with the measurement that
   justifies it.
6. **Say what you did not check.** "Not observed in a browser", "not run: the full engine suite", "the
   corpus figure is unchanged because X is out of scope". A claim you did not measure is a claim you must
   not make (§4.1). The repo would rather have a known gap than a confident wrong sentence.
7. **Deliver it** (§10). One branch, rebased onto a freshly fetched `origin/master`, the gate re-run on the
   rebased tree, then a fast-forward push. Delivery is the last step of the change, not a separate change.

**Corollary — never batch.** Do not stack unrelated edits and commit them together at the end, and do not
leave a working tree dirty while starting the next change. A commit that adds a gate whose fix is in the
NEXT commit is not green standalone; if you cannot avoid the pair, say so in both messages.

---

## 1. The map

| Path | What it is | Lives in a gate? |
|---|---|---|
| `engine/` | **The thing under test.** `dancing-squared-engine`, TypeScript → `dist/`, renderer-agnostic. `src/sequencer/` holds matcher, applicator, legality, solver, analyser, FSM, alignment. | yes — `engine/test/verify-suite.mjs` |
| `packages/stage/` | `dancing-squared-stage`: the shared render stage — `scene.ts` (Three.js adapter) and `grid-magnet.ts` (the pure square/radial grid + magnet rule, which is why the probes load it). Exported as **source**, not `dist/`. | yes, via the POC gate |
| `api/` | `dancing-squared-api`: **the server side of DESIGN.md §11** — the endpoints as handler functions over three injected ports (`ItemStore`, `Clock`, `IdentityOf`), with TWO stores behind the port (an in-memory twin and DynamoDB, both measured by one contract suite), the identity modes of §11.2 (`api/src/auth/`: a shared JWT verifier, the local sign-in emulator, and the adapters — of which only `dev` reads a request header), a `node:http` dev server and (later) an AWS Lambda adapter. It is probe-loadable the same way the game is: the probes drive the handlers, not a mock of them. It reads the corpus through the game's Node loader (`dancing-squared-game/corpus-node`), so there is no second `fs` reader. The DynamoDB half needs `docker compose -f api/docker-compose.yml up -d` and `npm run api:table`; `npm run dev:api:ddb` is the dev server against it, `npm run api:publish-daily` is the boundary job that gives `GET /puzzle` something to read, and `npm run api:publish-schedule` authors a level's Drill season. | yes — `api/tools/verify-probes.mjs` |
| `game/` | `dancing-squared-game`: the call game. `src/puzzle/` is the **pure, seeded core** (ladder, pool, generator, daily, schedule, session, hints, score) and `src/game/` the run layer (`drill.ts`, `daily-run.ts`, `clock.ts`, `poses.ts`, `store.ts`, `save-state.ts`, `schedule-fixture.ts`), both probe-loadable; `src/net/` (`api.ts`, `auth.ts`, `session.ts`) is the ONLY outbound path and is probe-loadable too — it takes its `fetch` and its storage as arguments, which is how a refusal, an unreachable server, an expiring session and a pinned auth mode are measured with no browser; the Vite app (`index.html`, `src/main.ts`, `src/render/`, `src/ui/`, `src/data/`) is the layer that is NOT, and `src/assets/` is a CHECKED COPY of `poc/src/assets` (see the gate row). **Engine VALUES are imported where a pure rule is needed** (`sameBoardById`, `boardSig`, `makeSquaredSet`, `computeHandholds`), because a probe imports the same functions and a local copy would be a second implementation; what is reached ONLY through `src/engine/applier.ts` is the **sequencer** — the one mutable engine object. (Until Phase 4.5 this row, and three module headers it was copied from, claimed `applier.ts` was the only file importing an engine value. It was wrong in five files, which is a claim a reader could have trusted.) | yes - `game/tools/verify-probes.mjs` |
| `poc/` | Three.js app **and the canonical corpus** (`src/assets/`). Sequencer panel, call editor, FSM view, browse view. | yes — `poc/verify.cjs` + `poc/tools/*-probe.mjs` |
| `poc-teacher/` | Teacher / session tracker app. | yes — `npm run verify:teacher` |
| `poc-matrix/` | Earlier matrix/graph experiments. | **no** — no `verify` script, not in any gate |
| `features/` | Gherkin specs. | via `engine/test/bind-audit.mjs` |
| `modules/`, `sequences/` | The ceder corpus (tracked); `scripts/translate-sequences.mjs` regenerates the first from the second. | yes |
| `docs/` | The CALLERLAB definitions PDF and downloaded pages — an oracle that lives **outside git**. | **untracked by design** |
| `taminations-flutter/` | **Reference only.** Data and code to *read*, never to port. The authority for the corpus's own conventions. | no |
| `book/` | The published book + its build tools. | `npm run check:book` |

The engine is the single source of truth for all engine logic; `poc` consumes it as a workspace package
(`import … from 'dancing-squared-engine'`), never by reaching into `engine/src`. Probes are the exception:
they may deep-import `engine/dist/index.js`, because they run outside any bundler.

---

## 2. Authorities, and the order to read them

1. `README.md` — the workspace in five lines.
2. `PLAN.md` — the state: §2 the scoreboard, **§3 what is refuted**, §5 what is blocked. **Read §3 before
   proposing an idea**; several attractive-looking next steps are in that table with the measurement that
   killed them.
3. `square-dancing.md` — the spec (§1–§8) and §9 the open-items log.
4. `engine/test/fixtures/README.md` — where each oracle comes from and how to re-fetch it.

**Do not relitigate a recorded decision without new evidence.** `PLAN.md` §3 and §5 exist so that a settled
question stays settled. New evidence means a measurement, not an argument.

---

## 3. Gates — what to run for what change

Run from the **repo root**. `--prefix engine` is not decoration: from inside `engine/`,
`npm run build --prefix engine` resolves to `engine/engine` and fails with ENOENT.

| The change touches | Run, in this order |
|---|---|
| `engine/src/**` | `npm run build --prefix engine` → `npm run verify:light --prefix engine`. **Before landing behaviour**, `npm run verify --prefix engine` (the whole suite — minutes; run it as a background job). |
| `poc/src/**` (TypeScript) | `npx tsc -p poc --noEmit` → `node poc/verify.cjs` → `node poc/tools/verify-probes.mjs` |
| `packages/stage/**` | `npx tsc -p packages/stage --noEmit`, then the `poc/src/**` row — `poc` is its only consumer today, so its real gate is the app's and the probes that load `grid-magnet.ts` |
| `api/**` | `npx tsc -p api --noEmit` → `node api/tools/verify-probes.mjs` (**plus `npm run verify:api:ddb` when the change touches the store**, which turns the DynamoDB half's skip into a failure). **Rebuild the engine first** (`npm run build:engine`), for the same reason as `game/**`: the api loads the game's Node corpus loader, which imports `dancing-squared-engine` values |
| `game/**` | `npx tsc -p game --noEmit` → `node game/tools/verify-probes.mjs`. **Rebuild the engine first** (`npm run build:engine`): the game's probes import `dancing-squared-engine` values, so a stale `dist` reports a missing export rather than the thing under test. **The runner checks the corpus copy first** (`tools/sync-corpus.mjs --check`), so an edit under `poc/src/assets` that is not re-copied fails the gate rather than reaching a player as a wrong puzzle |
| A rule that a probe pins | that probe by name: `node poc/tools/<name>-probe.mjs` |
| The corpus (`poc/src/assets/**`) | `node engine/test/shape-census.mjs`, then the POC checks above |
| `book/**` | `npm run check:book` |
| Docs only | no gate — but if you cite a number, it must be one you measured (§4.1) |

Rules that go with the table:

- **Rebuild the engine when its source changes.** `poc/verify.cjs` and every POC probe run against
  `engine/dist`, so a stale `dist` silently tests the old engine.
- **Never rebuild `dist` while a suite is running.**
- **Tiers are subsets, not weaker checks.** `light` and the probe suite's default tier both print what they
  skipped; a green fast run is not a green full run. `verify:figures` is a **red target suite by design** —
  the finish line, not a gate. Never "fix" a red gate by weakening it; if a gate pins a defect, read the
  gate before assuming the fix is wrong.
- **A census that fails for a knowingly-stale artefact trains people to skip it.** Report the divergence;
  keep the rules about the engine.
- **The text-encoding gate is repo-wide.** `npm run check:book`'s item 7 walks every `.md`/`.ts`/`.mjs`/
  `.json`/`.html`/`.css`/`.txt` file in the repo — skipping vendored, generated and cached trees — for text
  that has been round-tripped through a single-byte encoding, and it takes seconds. Run it after touching
  any prose or code containing a non-ASCII character. A file whose SUBJECT is that corruption opts out with
  an in-file `mojibake-check:allow` sentinel, never by a name hidden in a list.
- **Do not add a gate whose fix is in another commit** (§0).

---

## 4. Code standards

### 4.1 Measure, do not reason

Every claim in `PLAN.md`, `square-dancing.md` §9 and this repo's comments is a number from a checked-in
harness or a probe. The habits that follow from it are rules:

- **Test an attribution by disabling the suspect**, not by reasoning about it again.
- **Measure BEFORE and AFTER**, and prefer a **reverted** fix to a shipped half-fix.
- **Let the instrument speak**: an instrument's silence is itself a bug — a zero must say whether it is a
  coverage gap or a genuine absence.
- **A corpus count improving is not evidence a change is right**, and **a fix that trades a visible defect
  for a hidden one is not a fix**.
- **Correct the docs when the code disproves them**, including your own earlier commit message. The durable
  record is the harness's own header comment, because commit messages are immutable.

### 4.2 Comments are the durable record — and they have a house style

This codebase's comments are load-bearing and are the reason a stranger can change it safely. Match them:

- **State the rule, then the measurement that pins it, then the reason the alternative was rejected.**
  A comment that restates the code is noise; a comment that explains *why not the obvious thing* is the
  asset.
- **Cite the number and where it came from**, as `engine/test/verify-suite.mjs` does for `bodies`: "the
  four-axis separating-axis answer is exact rather than an axis-aligned approximation, which overstates
  clearance by 0.596 in the case pinned". A number you did not measure is a fabrication — including one
  invented as an illustration.
- **ALL-CAPS lead-in for the load-bearing claim**, in the style already here: `// THE ARRAY ORDER IS THE
  RENDERER'S BINDING…`, `// A DANCER IS NOT A ROUND POINT.`
- **Record the trap you just hit**, in place, so the next reader does not re-hit it. If it cost you an
  hour and the fix is not obvious from the diff, it needs a comment.
- **Do not pin line numbers or counts that drift** in a comment or in this file; pin the relationship and
  name the command that measures it.

### 4.3 Modularity

- **One concern per file, and the rule lives in the module that owns it.** A rule that only exists inside a
  large module cannot be measured — extract it into a small, DOM-free (and `three`-free) module and let the
  probe import it. `grid-magnet.ts`, `bodies.ts` and `board-transform.ts` are the pattern.
- **The engine is pure and renderer-agnostic.** No DOM, no `three`, no I/O, no ambient time or randomness
  in a computation: where nondeterminism is genuinely needed it is an **injectable config default**
  (`config.rand`), and `Date.now()` appears only where the value *is* the answer — a reported search
  duration (`SearchStats.elapsedMs`, gated on `collectStats`) or a stamp on an exported artefact — never
  as an input to what the engine computes.
- **Respect the boundaries.** `poc` imports the engine by package name; `taminations-flutter/` is read,
  never ported; a probe may reach into `engine/dist` because it is not bundled.
- **Identity is data.** Home couple, gender and symmetry are declared or explicitly unknown
  (`UNKNOWN_COUPLE`, phantom) — never invented from an array index. A board rebuilt by any component must
  come back **in the order it was given** (`reorderLike`).
- **A generated artefact needs the gate that fails when it goes stale**, or it will go stale silently.

### 4.4 Efficiency

- **The hot paths are corpus-scale**: 5963 shipped tams and 273 Mainstream calls, sampled at sub-beat
  steps. Do not add a per-sample allocation, a nested scan, or a string rebuild inside a loop over
  dancers/beats/moves.
- **The slow tiers exist because a suite nobody can afford to run is a suite nobody runs.** If your change
  makes a probe slower, say by how much in its header and consider the tier.
- **Measure, do not guess, when optimising** — and never trade a measurable correctness property for an
  unmeasured speed claim.

### 4.5 Nothing speculative

- **No dead code, no commented-out code, no unused export**, no "in case we need it later". A rule that
  exists is a rule that is tested; an unused branch is a claim nobody checked. (`noUnusedLocals` is off in
  the POC, so the compiler will not catch this for you.)
- **`strict` is on in every TypeScript package** (engine, poc, poc-teacher — `poc-matrix` is plain `.mjs`
  and has no tsconfig); keep it clean. `any` is near-absent in the engine — do not add more, and prefer a
  real type or `unknown` plus a narrowing check.
- **No new dependency without a reason that survives review**: it must be workspace-local, licence-clean,
  and justified in the commit message. `package-lock.json` is committed; keep it in step.
- **Comments and docs must describe what the code does now.** A stale comment is worse than none.

---

## 5. Testability — the probes and harnesses are the contract

- **Engine harnesses**: one entry in `engine/test/verify-suite.mjs` — a `light` field and a `why` for
  anything not in `light`. There is nowhere else to register one, and that is deliberate: two lists is how
  a harness gets added to one and forgotten in the other. Add the gate **in the same commit** as the fix.
- **POC probes**: write `poc/tools/<concern>-probe.mjs`. **The list is the directory**, so registration
  cannot be forgotten and deletion cannot leave a dangling entry; `_*.mjs` are scratch and are not picked
  up. Each probe is self-contained, ends in `process.exit(failures ? 1 : 0)`, and prints one line per check.
- **Import the rule; never mirror it.** A probe that restates the arithmetic measures a copy of the rule
  and is one edit away from measuring nothing. If the rule cannot be imported, that is the signal to extract
  a module (§4.3).
- **Every check needs a negative control** — the plausible wrong rule, measured to fail exactly the check
  that rules it out. A check no alternative fails is not testing anything. Say in the comment *which* check
  catches it and *why the others do not*.
- **Pin numbers, not adjectives.** Report the worst error, the count, the tolerance; a tolerance of `1e-9`
  next to a worst error printing as `0` is a real assertion, "looks right" is not.
- **Write probes as `.mjs` files, never `node -e`** (PowerShell mangles the quoting).
- **Distinguish throwaway from durable.** A diagnostic probe that answered a question and then gets deleted
  before the commit is fine — say so in the commit message. A rule that must keep holding becomes a
  registered probe or harness. Never leave an unregistered probe that looks like a gate.
- **A probe nobody runs is already stale.** If you find one, wire it in or delete it.
- **Fixtures stay verbatim**, with their attribution retained.
- **Say when the UI was not observed.** A typecheck and a board measurement cannot see two boxes
  overlapping. If a real-browser check was not possible, write that down instead of implying it happened.

---

## 6. Security, privacy and data

- **No secrets in the repo, ever.** Configuration is a `key = value` file with env-var overrides
  (`scripts/deploy-book.mjs`: `BOOK_S3_*`). No tokens in source, no credentials in a committed config, no
  `.env` in git. Nothing sensitive is currently tracked — keep it that way. The API's AWS identifiers (account,
  region, table, user pool) follow the same rule when its deployment lands: a config file plus `DSQ_*`
  overrides, never a literal.
- **Measurements are the server's.** A time, a count, a score or a balance that arrives in a request is an AUDIT
  INPUT, never a fact: the server measures the clock from its own issue stamp, counts attempts from the presses it
  recorded, and debits hints from its own balance (`game/DESIGN.md` §11.1, A21–A24). **Prove it by trying to lie**:
  a probe asserts that a claim BELOW the server's window is not the number that scores, and that a claim the server
  cannot corroborate is refused or flagged rather than believed. MEASURED — `api/test/runs-probe.mjs` scores a
  submission claiming `1 s` on a `60 s` window at **25**, where scoring the claim would have paid **100**, and the
  run row holds both numbers. This is not a hypothetical: the Drill used the client's clock whenever it was BELOW
  the wall time for a whole phase, so a 100-second run could claim par and take the maximum score.
- **Identity is verified, and a header is not an identity.** Every write needs a verified token subject. The
  trusted-header mode exists for local development only, says so in the boot banner, and is refused when the
  environment is production (`game/DESIGN.md` §11.2). **Test the sign-in flow with the EMULATOR, not by trusting a
  header**: it signs and verifies with the same verifier the deployment uses, so it cannot pass while the real
  path is broken.
- **Record what you refuse.** A refused or clamped submission writes what was measured beside what was claimed and
  increments a bounded per-player counter; the refusal rate is the operator's signal that someone is probing. An
  instrument's silence is itself a bug (§4.1) — a check that refuses something and records nothing is a check
  nobody can audit.
- **The apps are offline.** `poc/` makes no network calls; `poc-teacher/` works against local state
  (`localStorage`) and the local engine. Do not add a remote call, a telemetry beacon or an external font
  without an explicit decision recorded in the commit message. **`api/` is the other side of that boundary** —
  it is the one component that talks to AWS by design, and the game stays offline-first whether or not it is
  ever deployed, because `VITE_API_BASE` unset is today's behaviour.
- **Escape anything that goes into `innerHTML`.** `esc()` from `poc/src/dom.ts` is the one rule, in one
  place, and it exists precisely because authored data — a call's `from` label, a user-defined formation's
  name, a module name — must not become markup. Prefer `textContent`; if you build markup, interpolate only
  through `esc()`. Never `eval`, never `new Function`, never a `srcdoc`/`javascript:` sink.
- **`el()` over `querySelector`** for panel elements: the id is a compile-time contract, and a missing one
  fails loudly at the first property read.
- **Licences are constraints, not paperwork.** The engine is AGPL-3.0; the tamination animation data is
  GPL/AGPL. Do not relicense, do not copy code from `taminations-flutter/` into this repo, and keep
  attribution intact. `docs/` (the CALLERLAB PDF and downloaded pages) and the extracted
  `callerlab-ms.txt` are **deliberately untracked** because they are not ours to redistribute — never add
  them. **One gate already depends on them, and that is the exception rather than the pattern:**
  `callerlab-diff` (registered in the `all` tier) `readFileSync`s `callerlab-ms.txt` with no fallback, so
  it throws rather than skipping when the file is absent, and the `all` tier cannot be green on a fresh
  clone until `engine/test/tools/extract-pdf-text.mjs` has been re-run over `docs/`. Do not add a second
  such dependency; a gate that can report a coverage gap is always better than one that cannot run.
- **The sandbox is not the enemy of the work.** Escalate only after a real denial, with a one-line
  justification, for the exact command that was denied. Do not reach for wider access speculatively, and do
  not "work around" a denial by another route.
- **Untracked-by-design stays untracked**: `docs/`, `callerlab-ms.txt`, `poc/pnpm-lock.yaml`,
  `poc/pnpm-workspace.yaml`, `verify*.log`, the `.npm-cache`/`.pw-browsers` caches, probe scratch
  (`poc/tools/_*.mjs`, `poc/tools/_fsm-view*.html`, `engine/test/tools/_*.txt`). Check `.gitignore` before
  you `git add -A`, and **stage explicit paths** — never commit someone else's in-flight work.

---

## 7. Commits

- **One change per commit**, with a subject in the repo's style — `<area>: <what changed, stated as fact>`:
  `engine:`, `poc:`, `corpus:`, `docs:`, `book:`. Look at `git log --oneline -20` before writing one.
- **Body carries the evidence**: what was reported, the rule, the measurement that proves it, which gates
  ran and how they came out, and what was **not** checked. Multi-line, via `git commit -F` (a here-string or
  a file) — not a stack of `-m` flags.
- **Never amend or rewrite a commit that has been pushed**, and do not "clean up" history to hide a
  correction: add the correction. Commit messages are immutable, which is why the durable record belongs in
  the harness header (§4.2).
- **A local branch is rewritable; a pushed one is not.** The immutability above starts at the first push;
  the task branch is local until delivery, so pre-push fixups are squashed there and never after (§10).
- **Master only ever fast-forwards.** No merge commit on master and no force-push to it (§10).
- **Stage explicit paths.** The tree regularly carries someone else's in-flight work; `git add -A` will
  commit it.

---

## 8. Traps that have already bitten

One line each, and THIS IS THE WHOLE LIST: the two `HANDOVER.md` files that used to carry a longer version
with the measurements were deleted, because an orientation document that is only regenerated when a session
ends was routinely read as current state by the session after it. A trap that costs an hour belongs here,
with its measurement, in the same commit that found it.

1. **Read bytes, not the console, when checking text encoding.** `Get-Content` decodes UTF-8 as
   windows-1252 and prints a genuine `—` as `â€”`, inventing corruption in every file that contains one.
   Use `git grep` or a byte count. `engine/test/tools/callerlab-diff.mjs` quotes mojibake **on purpose** —
   it repairs PDF-extraction artefacts; do not "fix" it.
2. **`git checkout -- <file>` restores CRLF**, so a multi-line literal match in a probe must normalise line
   endings (`readFileSync(...).replace(/\r\n/g, '\n')`) or it silently matches nothing.
3. **Under the file sandbox a Node child spawned with piped stdio fails with `EPERM`** — which is why
   `verify-suite.mjs` and `verify-probes.mjs` run children with `stdio: 'inherit'` and run probes
   in-process. **THE VITE APP IS NOT AFFECTED BY THIS and a later sentence here claiming "the app cannot be
   started here" was WRONG — MEASURED in Phase 3: `npm run dev:game` binds port 8089 and a real browser
   drives the page, which is how the Daily's UI and the 3D view were checked. What the sandbox constrains is
   a Node child whose output is PIPED, not a dev server started as a background job.**
4. **PowerShell truncation looks like a failure**: `... | Select-Object -First N` can make a successful
   command report `[exit code: 1]`.
5. **`write`/`edit` intermittently fail** with `ReplaceFileW EIO (Win32 32)`; retrying the identical edit
   succeeds.
6. **There are two `verify` commands.** The root `npm run verify` is the POC; the engine gate is
   `npm run verify --prefix engine`.
7. **A position into an authored list is not an identity.** Select a tam by `from`/`formation`, never by
   index — a hand-added tam once shifted three checks onto a two-dancer pair and they read as an engine
   defect for months. Register calls by **title**, not file basename.
8. **A gate can pin a defect.** When a gate goes red on a fix, read the gate before assuming the fix is
   wrong.
9. **A generated artefact with no gate goes stale silently.** When you find one, add the gate that would
   have caught it. But **do not regenerate a generated artefact while the thing it encodes is being
   adjudicated**.
10. **`knownFormation` will name a board that matches nothing**, and on a tie the winner is library scan
    order. `recognize` refuses the same board — the two namers disagree on purpose.
11. **`boardSig` is positions-only**; anything facing-dependent must key on the full pose.
12. **`parallel.groups` holds dancer OBJECTS, not ids.** Comparing them against `d.id` invented 18 false
    "declined tiling" cases.
13. **`Sequencer.getout()`/`fixIt()` search the Sequencer's OWN board** — call `setBoard(board)` first, and
    the failure is silent.
14. **`snapMaxError` bounds the MEAN match error, not a dancer.**
15. **A module's last flat step is often charged 0 beats** — identify the owner as the last step whose own
    beats are non-zero.
16. **Never leave the tree dirty with someone else's work in it** — including the corpus XML, which is
    regularly mid-edit when a session starts.
17. **Isolation between agents is a separate CLONE, never a `git worktree`** — the junction that makes a
    worktree a second engine instance is measured in §10.
18. **The format has no `cy3`, so a facing curve cannot be mirrored about a line that is not a quarter turn
    away.** Reflecting a `<rotate>` about the local line at `beta` writes `cy1 = sin(2*beta) * cx1`, which
    `bezRotAttr` has nowhere to put — the curve keeps it in memory and the file loses it. MEASURED: the control
    in `poc/tools/mirror-moves-probe.mjs` leaves **444 of 444** diagonal facings unrepresentable, where a flip
    of the same curve about one of the dancer's own axes (`cy1` stays exactly 0) leaves none — which is why the
    Call editor's mirror takes quarter turns and nothing else. Mirror the TURN, which is the only thing `poseFor`
    reads from a facing curve, rather than the curve itself.
19. **A Vite dev server watching `game/src` fights the editor's atomic write.** The editor writes
    `game/src/.main.ts.<pid>.<guid>.tmpdir/main.ts.tmp` and renames it over the target; Vite's file watcher
    picks the temporary file up and, MEASURED, crashed with `EBUSY: resource busy or locked, watch '…main.ts.tmp'`
    (exit 1, dev server dead) while the next three edits to the same file failed with `ReplaceFileW EIO` — the
    same `EIO` this file's trap 5 records, which here is the watcher holding the file rather than a disk
    hiccup. Retrying does not clear it: stop the dev server (`job_kill`, then confirm the port is free) before
    editing under a watched tree, and restart it after.
20. **Never kill every `node` process (`Stop-Process -Name node`, `taskkill /IM node.exe`).** The harness, every
    agent's subprocess runner, a Vite dev server and the probes themselves are all `node`, so a blanket kill
    takes out the session that issued it: MEASURED, a smoke test whose last statement was
    `Stop-Process -Name node` was **interrupted with no result durably recorded**, and a runner from another
    clone was live at the time. Stop a process by id (`job_kill` for a job you started, or the `$PID` you
    captured), never by image name — and a port check afterwards (`Test-NetConnection`) is how to confirm it
    actually went.
21. **A tool that says "the real service" when no endpoint is set WILL use the real service.** MEASURED, and it
    cost a real table: `npm run api:table` with no `DSQ_DDB_ENDPOINT` created `dancing-squared-dev` in the
    account this machine's ambient credentials belong to (root, `eu-west-2`) — the command said so in its own
    output and did it, and the table had to be deleted by hand. Any command that CREATEs or SEEDs must refuse
    without an explicit endpoint or opt-in (`api/src/config.ts`'s `realServiceWarning`), because a developer's
    default is a local container while a credential chain's default is production.
22. **An editing helper must never write a variable it has not proved non-null.** The workaround traps 5 and 19
    push you towards is `[System.IO.File]::ReadAllText(...)` → `.Replace(...)` → `WriteAllText(...)`, and a
    `.Replace` call that THROWS (a five-character search string binds to the `char, char` overload) leaves the
    result unassigned — MEASURED: `WriteAllText(path, $null)` **emptied `game/DESIGN.md` to 0 bytes** and the
    uncommitted edits in it were lost (`git checkout --` restored the committed content and they were rewritten
    by hand). Assert the result is non-null AND non-empty before writing, or use the editor tools, which fail
    loudly on a missing anchor instead of silently writing nothing.
23. **A request header is not an identity, and a client's clock is not a measurement.** Both were true here at
    once, and both are MEASURED rather than hypothetical (the review that produced `game/DESIGN.md` §11.1): the
    dev adapter accepted `x-dev-player: <anyone>` as that player, so any caller who could reach the port owned
    another player's progress, hints and board; and `POST /runs` used the client's `elapsedSeconds` whenever it was
    BELOW the wall time since issue, so a 100-second run could claim par and score **100 instead of 15** (6.7×),
    and one hidden hint was worth **21 → 100** (4.8×). The fix is direction as much as code: the trusted header is
    now a named development mode refused in production (§6, §11.2 of the design), and the clock is the server's own
    issue stamp. The general rule is the §6 bullet — anything a score depends on is measured server-side, and "the
    client said so" is not a measurement.
24. **PowerShell eats backticks inside a DOUBLE-quoted string, and the damage is silent and legal.** `` `` `` is a
    literal backtick, but `` `a `` is the BEL control character and a bare backtick before a space is an escape for
    that space — so `$t.Replace("... `` `attempts` `` ...", ...)`, the helper trap 22 recommends for edits whose
    anchor is awkward, rewrote a source comment to `ttempts` and dropped a closing backtick. MEASURED: the file
    still parsed, the line printed as `FIELD. ttempts is a SCORE FACTOR (ttemptFactor)`, and only a byte dump
    (`[int]$_` over the line's characters — the corruption was `0x07`, not a missing character) showed what had
    happened. Use SINGLE-quoted strings for any pattern containing a backtick (doubling an inner `''`), or the
    editor tools, which take literal text.
25. **A request header a mode does not ADVERTISE is not merely refused — the request is never sent, and the failure
    looks like a dead server.** `api/src/dev-server.ts` puts `x-dev-player` in `access-control-allow-headers` only
    when `DSQ_AUTH=dev` (a deliberate omission, pinned as a NEGATIVE CONTROL in `api/test/auth-probe.mjs`), and a
    custom header makes a request non-simple, so the browser preflights it first. MEASURED: the game sent
    `x-dev-player` for a signed-out caller in every mode, and against `DSQ_AUTH=emulate` the demo drill — the ONE
    read §11.2 promises a signed-out player — came back as `TypeError — the server could not be reached`, with a
    lone `204 OPTIONS /drill/current` and no request behind it in the dev server's own log. No status code, no
    `401`, nothing to read. The identity header is now a function of the mode the server reported and the boot asks
    `/health` BEFORE its first request; `game/src/net/standing.ts` and `game/test/standing-probe.mjs` pin the
    rule. **When a cross-origin call fails as `TypeError`, read the dev server's log for an `OPTIONS` with no
    request after it before believing anything about the server.**

---

## 9. Done means

- [ ] One change, one intent, and the diff contains nothing else.
- [ ] QA pass done: dead code gone, names and comments true, rule in its owning module, negative control
      present.
- [ ] The gate that covers the change ran, and its result is in the commit message.
- [ ] A revert of this change would turn a check red.
- [ ] Committed alone with a multi-line message carrying the measurement.
- [ ] What was not checked is stated, in the message and to the user.
- [ ] No secret, no generated artefact, no untracked oracle, and no other person's work in the commit.
- [ ] Worked on a branch in this clone — never on master, never in a shared worktree (§10).
- [ ] Rebased onto the current `origin/master`, and the §3 gate ran on the rebased tree.
- [ ] Pushed as a fast-forward; no force, no merge commit, no untracked oracle in the push.

---

## 10. Delivery — one branch, one clone, rebase, gate, fast-forward

§0–§9 produce a change in ONE checkout. This section is how it reaches `origin`. Every agent has its own
clone and its own branch; the only thing shared is `origin`, and master is a single lane.

**WHY A CLONE AND NOT A `git worktree`.** A worktree isolates the corpus but is not an isolation for a run:
`node_modules/dancing-squared-engine` is a junction into the main tree's `engine/dist`, so the four harnesses
that import `poc-teacher/src/catalog.ts` (`fsm-asset`, `matrix`, `matrix-getout`, `level-census`) load a
SECOND engine instance and fail — measured: `matrix-getout` passes in the main tree and crashed in the
worktree (TODO.md item 5). Own clone, own `npm install`, own branch.

1. **Provision once per clone.** `npm install` at the root (README's Setup), then re-create the untracked
   oracle: put `docs/` back and run `node engine/test/tools/extract-pdf-text.mjs
   docs/New_Mainstream_Definitions_26-03-29.pdf callerlab-ms.txt`. Without it `callerlab-diff` throws rather
   than skips (§6) and the `all` tier cannot be green with or without your change — an un-provisioned clone
   reports someone else's red as yours. Then assert the tree is clean (`git status --short` empty): a dirty
   start is someone else's work, and even in your own clone it is work you did not do (trap 16).
2. **Branch before the first edit**, `<area>/<slug>`, cut from the current `origin/master`. Never commit to
   `master` locally.
3. **Commit as you go, per §7** — one intent, one commit, evidence in the body. The branch is local and
   unpushed, so §7's immutability does not bite yet; the moment it is pushed, it does.
4. **Integrate by rebase, not by merge.** `git fetch origin master`, then `git rebase origin/master`;
   resolve conflicts here, once. **Do not merge master into the branch first:** the rebase re-hits the same
   conflicts and discards the merge commit, so the merge buys a second resolution and nothing else. **Do not
   `git pull` on master:** the host global config has `pull.rebase=false`, so a diverged `git pull`
   fabricates a merge commit; `git pull --ff-only` fails loudly instead, which is the wanted behaviour. A
   `package-lock.json` conflict is regenerated (`npm install --package-lock-only`), never hand-merged.
5. **Gate the rebased tree, then push it.** Build first, then the §3 row for what you touched — on the FINAL
   tree, after the rebase. A suite that ran before the rebase proves nothing about what you push, and a build
   before the rebase is thrown away. `core.autocrlf=true` is set host-wide, so a conflict resolved with
   `git checkout -- <file>` restores CRLF and can make a probe's multi-line literal match nothing (trap 2):
   resolve by editing, and re-run the encoding gate if you touched prose.
6. **Push fast-forward, and only fast-forward:** `git push origin HEAD:refs/heads/master`. There is no CI
   behind master, so step 5 is the only gate — **never `--force` or `--force-with-lease` to master, and never
   push a merge commit to it.** `--force-with-lease` is for your own `task/<slug>` branch while it is yours
   alone.
7. **A rejected push means master moved: go back to step 4 and repeat** — fetch, rebase, **re-run the gate**,
   push. Two agents can rebase onto the same master and both be green; only the first push wins, and the
   rejection is the race being caught, not a failure. Bound the retries (three) and report the state rather
   than looping.
8. **Master is not fully green today.** The `all` tier carries known reds and pin drift (TODO.md items 5 and
   6; `verify:figures` is a red target by design, §3). A red you did not cause is reported, never "fixed" by
   weakening a gate or re-pinning a number to make your branch green — and never adjudicate a corpus number
   another task is mid-decision on.
9. **One branch, one intent.** The delivery unit is the task's intent, so the branch is normally one commit
   and no squash is wanted: a squashed message cannot carry the per-change measurements §7 requires. If the
   branch carries two intents, split it; if it carries fixups for one intent, squash them BEFORE step 5,
   while they are still unpushed.
10. **After landing**, `git log --oneline -3` and report the pushed SHA; delete any pushed `task/<slug>`
    branch. A SHA written into a doc is a reference to a commit, valid only while that commit is reachable on
    master, and any rebase rewrites it — 33 SHAs are cited across these docs and all 33 resolved at
    `f693ee1`, so the hazard is the next rebase: cite a landed SHA only after it has landed, never one that
    has not.

**THE SHAPE THIS REPLACES, AND WHY.** *pull master → merge into the branch → rebuild → rebase onto master as
a single commit → push.* The merge is redundant with the rebase (step 4); the rebuild precedes the rebase, so
the tree that ships is the one tree never tested (step 5); `pull` is the wrong verb on this host's config
(step 4); and the squash discards the per-change evidence §7 exists to carry (step 9). A
branch-and-pull-request flow was considered and rejected: with no CI and no reviewer in the loop it adds a
waiting state and no check, so the local §3 gate is the only gate either way.
