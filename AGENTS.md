# AGENTS.md — how to change this repo

<!-- mojibake-check:allow — §8 trap 1 quotes the corruption on purpose, as its signature. -->

**What this file is.** The durable rules: the loop, the gates, the house style, and the traps that have already
cost hours. It is deliberately **not** the state of the work — that is `PLAN.md` (§2 scoreboard, §4 work queue,
§3 what is refuted). A rule here should still be true in ten sessions; the moment one is disproved, fix it **in
the same commit** that disproved it. **Keep this file short**: it sits under the workspace loader's 64 KiB budget,
and MEASURED at 65 463 bytes the loader truncated it mid-sentence and said nothing, so the last rules were
invisible to every agent. Compression, not deletion, is the answer.

**If you read nothing else:** §0 (the loop), §3 (the gates), §10 (delivery), §11 (the QA properties).

---

## 0. The loop — one change, one QA pass, one commit

1. **Read before you edit.** The authority from §2, and the harness or probe that already pins the behaviour — it
   usually names why the current behaviour is the way it is.
2. **ONE change, one intent.** If you cannot say it in a subject line, it is two changes.
3. **QA-refactor before you test** (§4, §5): dead code and scaffolding gone, names that say what the thing is,
   comments stating the rule and the measurement, the rule in the module that owns it, and a probe that would go
   red if the change were reverted. **A revert that leaves no test red is not finished.**
4. **Run the gate that covers the change** (§3) — not the fastest one and not all of them — plus the typecheck.
5. **Commit it alone** (§7): multi-line `git commit -F`, with the measurement that justifies it.
6. **Say what you did not check.** "Not observed in a browser", "not run: the full suite". A claim you did not
   measure is a claim you must not make (§4.1).
7. **Deliver it** (§10): rebase onto a freshly fetched `origin/master`, re-run the gate on the rebased tree,
   fast-forward push. Delivery is the last step of the change, not a separate change.

**Never batch.** No stacked unrelated edits, no dirty tree while starting the next change, and a gate whose fix is
in the NEXT commit is not green standalone — say so in both messages.

---

## 1. The map

| Path | What it is | Lives in a gate? |
|---|---|---|
| `engine/` | **The thing under test.** `dancing-squared-engine`, TypeScript → `dist/`, renderer-agnostic. `src/sequencer/` holds matcher, applicator, legality, solver, analyser, FSM, alignment. | `engine/test/suite.mjs` (the registry) → `engine/test/verify-suite.mjs` (the runner) |
| `packages/stage/` | `dancing-squared-stage`: the shared render stage — `scene.ts` (Three adapter) and `grid-magnet.ts` (the pure square/radial grid + magnet rule). Exported as **source**, not `dist/`. | via the POC gate |
| `packages/corpus/` | `dancing-squared-corpus`: the corpus's bytes and call inventory — `files.ts` (where it is, a level's files, one file's text), `virtual.ts` (the generated-instance suffix, **import-free** so a browser can filter a glob's keys) and `index.ts` (`<tam>` blocks, titles, pooled XML). No dependencies, not even the engine: it is a byte reader, and the engine's parser is its judge. Exported as **source**. | `engine/test/corpus-inventory.mjs` (light) |
| `assets/`, `vite.corpus.ts` | **The corpus, ONCE.** Every programme's tamination XML (`ms/`, `plus/`, `a1/`, `a2/`, `c1/`, `c2/`, `c3a/`, `c3b/`, `discovered/`, `src/`), plus `moves.xml`, `formations.xml` and the generated `fsm-ms.json`. A call's generated whole-set instances sit beside it as `<level>/<family>.virtual.xml` — GENERATED GEOMETRY, kept out of every authored count by that suffix alone (`packages/corpus/virtual.ts`: `filesOf` excludes it, `virtualFilesOf` returns it). `vite.corpus.ts` at the root is **the only place its location is written down**: the Vite apps glob it through the `@corpus` alias and every Node reader reaches the same constant through `packages/corpus` (`corpusRoot()`). §8 trap 26 records why the old `game/src/assets/` copy was never needed. | every gate that reads the corpus |
| `api/` | `dancing-squared-api`: the server side of `game/DESIGN.md` §11 — handlers over three injected ports (`ItemStore`, `Clock`, `IdentityOf`) with two stores behind the port (memory + DynamoDB, one contract suite), the identity modes of §11.2 (`api/src/auth/`), a `node:http` dev server and a **Lambda adapter with no AWS SDK in it**, both deciding through `dispatch.ts` so local and deployed cannot disagree. Probes drive the handlers, not a mock. It reads the corpus through the game's Node loader, so there is no second `fs` reader. DynamoDB half: `docker compose -f api/docker-compose.yml up -d` + `npm run api:table`. | `api/tools/verify-probes.mjs` |
| `game/` | `dancing-squared-game`: `src/puzzle/` is the **pure, seeded core** (ladder, pool, generator, daily, schedule, session, hints, score), `src/game/` the run layer, `src/net/` the ONLY outbound path (probe-loadable: it takes its `fetch` and its storage as arguments). The Vite app (`src/main.ts`, `src/render/`, `src/ui/`, `src/data/`) is the layer that is NOT probe-loadable. **Engine VALUES may be imported** where a pure rule is needed; only the **sequencer** is reached solely through `src/engine/applier.ts`. | `game/tools/verify-probes.mjs` |
| `poc/` | Three.js app: sequencer panel, call editor, FSM view, browse view. | `poc/verify.cjs` + `poc/tools/*-probe.mjs` |
| `poc-teacher/` | Teacher / session tracker app. | `npm run verify:teacher` |
| `poc-matrix/` | Earlier matrix/graph experiments. | **no gate** |
| `features/` | Gherkin specs. | `engine/test/bind-audit.mjs` |
| `modules/`, `sequences/` | The ceder corpus (tracked); `scripts/translate-sequences.mjs` regenerates the first from the second. | yes |
| `docs/` | The CALLERLAB PDF and downloaded pages — an oracle that lives **outside git**. | **untracked by design** |
| `taminations-flutter/` | **Reference only.** Read, never port. The authority for the corpus's conventions. | no |
| `book/` | The published book + its build tools. | `npm run check:book` |

The engine is the single source of truth for engine logic; `poc` consumes it by package name, never by reaching
into `engine/src`. Probes are the exception — they may deep-import `engine/dist/index.js`.

---

## 2. Authorities, in order

1. `README.md` — the workspace in five lines.
2. `PLAN.md` — the state: §2 scoreboard, **§3 what is refuted**, §5 what is blocked. Read §3 before proposing an
   idea; several attractive next steps are there with the measurement that killed them.
3. `square-dancing.md` — the spec (§1–§8) and the open-items log (§9).
4. `engine/test/fixtures/README.md` — where each oracle comes from and how to re-fetch it.

**Do not relitigate a settled decision without new evidence.** New evidence is a measurement, not an argument.

---

## 3. Gates

Run from the **repo root**. `--prefix engine` is not decoration: from inside `engine/`, `--prefix engine`
resolves to `engine/engine` and fails with ENOENT.

| The change touches | Run, in order |
|---|---|
| `engine/src/**` | `npm run build --prefix engine` → `npm run verify:light --prefix engine`; before landing behaviour, `npm run verify --prefix engine` (minutes — run it detached, §8 trap 33) |
| `poc/src/**`, `packages/stage/**` | `npx tsc -p poc --noEmit` (and `npx tsc -p packages/stage --noEmit` when stage changed) → `node poc/verify.cjs` → `node poc/tools/verify-probes.mjs` |
| `api/**` | `npx tsc -p api --noEmit` → `node api/tools/verify-probes.mjs` (+ `npm run verify:api:ddb` when it touches the store). **Rebuild the engine first** — the api loads the game's loader, which imports engine values |
| `game/**` | `npx tsc -p game --noEmit` → `node game/tools/verify-probes.mjs`. **Rebuild the engine first** (`npm run build:engine`), or a stale `dist` reports a missing export |
| A rule a probe pins | that probe by name: `node poc/tools/<name>-probe.mjs` |
| `assets/**` | `node engine/test/shape-census.mjs`, then the POC checks above |
| `book/**`, prose | `npm run check:book` |
| Docs only | no gate — but every number you cite must be one you measured (§4.1) |

- **Rebuild the engine when its source changes**; a stale `dist` silently tests the old engine.
- **Never rebuild `dist` while a suite is running, and never read it then either** (§8 trap 32).
- **Tiers are subsets, not weaker checks** — each prints what it skipped; green-fast is not green-all.
  `verify:figures` is a **red target suite by design**; never weaken a gate, and read a gate before assuming its
  red means the fix is wrong.
- **A whole-tree check that is always red is a census nobody reads.** When a repo-wide check is red for a reason
  you did not cause, repair it in its own commit first (MEASURED: `engine/test/going.mjs` reported 13 problems on
  every run for 18 commits until `c831625` repaired its bytes and the walk went 13 → 0).
- **The text-encoding gate is repo-wide** and part of `npm run check:book`: every tracked
  `.md/.ts/.mjs/.json/.html/.css/.txt` is walked for single-byte-encoding round-trips **and** for control
  characters below 0x20 (tab, LF, CRLF excepted) and for a CR that is not part of a CRLF (§8 trap 24). A file
  whose subject is that corruption opts out with an in-file `mojibake-check:allow` sentinel, never a name in a
  list; there is no opt-out from the control-character check. Run it after touching any prose.
- **Do not add a gate whose fix is in another commit** (§0).

---

## 4. Code standards

### 4.1 Measure, do not reason

Every claim in `PLAN.md`, `square-dancing.md` §9 and this repo's comments is a number from a checked-in harness
or probe. **Test an attribution by disabling the suspect**, not by reasoning about it again. **Measure BEFORE and
AFTER**, and prefer a reverted fix to a shipped half-fix. **Let the instrument speak** — a zero must say whether
it is a coverage gap or a genuine absence. **A corpus count improving is not evidence a change is right**, and a
fix that trades a visible defect for a hidden one is not a fix. **Correct the docs when the code disproves them**,
including your own earlier commit message: the durable record is the harness header, because commits are
immutable.

### 4.2 Comments are the durable record

- **State the rule, then the measurement that pins it, then the reason the alternative was rejected.** A comment
  that restates the code is noise; one that explains *why not the obvious thing* is the asset.
- **Cite the number and where it came from** ("the four-axis separating-axis answer is exact rather than an
  axis-aligned approximation, which overstates clearance by 0.596 in the case pinned"). A number you did not
  measure is a fabrication, including one invented as an illustration.
- **ALL-CAPS lead-in for the load-bearing claim**: `// THE ARRAY ORDER IS THE RENDERER'S BINDING…`,
  `// A DANCER IS NOT A ROUND POINT.`
- **Record the trap you just hit, in place**, so the next reader does not re-hit it.
- **Do not pin line numbers or counts that drift**; pin the relationship and name the command that measures it.

### 4.3 Modularity

- **One concern per file, and the rule lives in the module that owns it.** A rule that exists only inside a large
  module cannot be measured — extract it into a small, DOM-free (and `three`-free) module and let a probe import
  it. `grid-magnet.ts`, `bodies.ts`, `board-transform.ts` and `arming.ts` are the pattern.
- **The engine is pure and renderer-agnostic.** No DOM, no `three`, no I/O, no ambient time or randomness in a
  computation: where nondeterminism is genuinely needed it is an **injectable config default** (`config.rand`), and
  `Date.now()` appears only where the value *is* the answer — a reported search duration (`SearchStats.elapsedMs`,
  gated on `collectStats`) or a stamp on an exported artefact — never as an input to what the engine computes.
- **Respect the boundaries.** `poc` imports the engine by package name; `taminations-flutter/` is read, never
  ported; a probe may reach into `engine/dist` because it is not bundled.
- **Identity is data.** Home couple, gender and symmetry are declared or explicitly unknown (`UNKNOWN_COUPLE`,
  phantom) — never invented from an array index. A board rebuilt by any component comes back **in the order it was
  given** (`reorderLike`).
- **A generated artefact needs the gate that fails when it goes stale**, or it will go stale silently.

### 4.4 Efficiency

**The hot paths are corpus-scale** (5963 shipped tams, 273 Mainstream calls, sampled at sub-beat steps): no
per-sample allocation, nested scan or string rebuild inside a loop over dancers/beats/moves. The slow tiers exist
because a suite nobody can afford to run is a suite nobody runs — if your change makes a probe slower, say by how
much in its header and consider the tier. **Measure, do not guess, when optimising**, and never trade a measurable
correctness property for an unmeasured speed claim.

### 4.5 Nothing speculative

**No dead code, no commented-out code, no unused export**, no "in case we need it later" — a rule that exists is a
rule that is tested; an unused branch is a claim nobody checked. **`strict` is on in every TypeScript package**
(engine, poc, poc-teacher; `poc-matrix` is plain `.mjs`); keep it clean, and `any` is near-absent in the engine —
prefer a real type or `unknown` plus a narrowing check. **No new dependency without a reason that survives
review**: workspace-local, licence-clean, justified in the commit message, with `package-lock.json` in step.
**Comments and docs must describe what the code does now.** A stale comment is worse than none.

---

## 5. Testability — the probes and harnesses are the contract

- **Engine harnesses**: one entry in `engine/test/suite.mjs` — the ONE registry (the runner imports it; the list
  used to sit inside `verify-suite.mjs`, where importing it to read the list would have run the suite) — a `light`
  field and a `why` for anything not in `light`. There is nowhere else to register one, deliberately: two lists is
  how a harness gets added to one and forgotten in the other. Add the gate **in the same commit** as the fix.
- **An analysis tool is not a gate, and says so**: `engine/test/tools/` is the measurement archive, and every file
  there is either registered (above) or starts on line 1 with
  `// TIER: none — one-shot diagnostic; nothing runs it. Recorded: <path>.` — a real path that NAMES the tool.
  `engine/test/harness-registry.mjs` enforces it both ways (see `tools/README.md`), so a new instrument cannot land
  silently. A tool that can fail is a gate: register it, or retire it — do not leave it unrun.
- **POC probes**: `poc/tools/<concern>-probe.mjs`. **The list is the directory**, so registration cannot be
  forgotten and deletion cannot leave a dangling entry; `_*.mjs` are scratch. Each probe is self-contained, ends
  in `process.exit(failures ? 1 : 0)`, and prints one line per check.
- **Import the rule; never mirror it.** A probe that restates the arithmetic measures a copy of the rule and is one
  edit away from measuring nothing. If the rule cannot be imported, that is the signal to extract a module (§4.3).
- **Every check needs a negative control** — the plausible wrong rule, measured to fail exactly the check that
  rules it out; say in the comment *which* check catches it and *why the others do not*.
- **Pin numbers, not adjectives** — the worst error, the count, the tolerance. "Looks right" is not a check.
- **Write probes as `.mjs` files, never `node -e`** (PowerShell mangles the quoting).
- **Distinguish throwaway from durable.** A diagnostic probe that answered its question and is deleted before the
  commit is fine — say so in the message. A rule that must keep holding becomes a registered probe. Never leave an
  unregistered probe that looks like a gate, and never leave a probe nobody runs.
- **Fixtures stay verbatim**, attribution intact. **Say when the UI was not observed.**

---

## 6. Security, privacy and data

- **No secrets in the repo, ever.** Configuration is a `key = value` file with env-var overrides (`BOOK_S3_*`,
  `DSQ_*`). No tokens in source, no credentials in a committed config, no `.env`.
- **Measurements are the server's.** A time, count, score or balance arriving in a request is an AUDIT INPUT,
  never a fact: the server measures the clock from its own issue stamp, counts attempts from the presses it
  recorded, and debits hints from its own balance (`game/DESIGN.md` §11.1, A21–A24). **Prove it by trying to lie**:
  MEASURED, `api/test/runs-probe.mjs` scores a submission claiming `1 s` on a `60 s` window at **25** where scoring
  the claim would have paid **100**, and the run row keeps both numbers. Before the fix, a 100-second run could
  claim par and take **100 instead of 15**, and one hidden hint was worth **21 → 100**.
- **Identity is verified, and a header is not an identity.** Every write needs a verified token subject. The
  trusted-header mode exists for local development only, says so in the boot banner, and is refused when the
  environment is production. **Test the sign-in flow with the EMULATOR, not by trusting a header** — it signs and
  verifies with the same verifier the deployment uses.
- **Record what you refuse.** A refused or clamped submission writes what was measured beside what was claimed and
  increments a bounded per-player counter; the refusal rate is the operator's signal that someone is probing. A
  check that refuses something and records nothing is a check nobody can audit.
- **The apps are offline.** `poc/` makes no network calls; `poc-teacher/` works against `localStorage` and the
  local engine. No remote call, telemetry beacon or external font without an explicit decision in the commit
  message. **`api/` is the other side of that boundary** — the one component that talks to AWS by design; the game
  stays offline-first because `VITE_API_BASE` unset is today's behaviour.
- **Escape anything that goes into `innerHTML`.** There are TWO rules, one per TARGET, and one implementation of
  each: **HTML** is `esc()` in `poc/src/dom.ts` (`& < > " '` — the teacher re-exports it, the book's tools import
  `book/tools/lib/escape.mjs`, and `book/assets/player.js` is the one copy that ships as text because it runs in a
  browser with no bundler), and **XML** is `esc()` in `engine/src/convert.ts` (`& < "` — double-quoted attributes,
  `>` legal raw). They differ ON PURPOSE and must not be merged; `poc/tools/escape-probe.mjs` pins both sets,
  requires exactly four files in the tree to contain an escaper, and fails if the two rules ever agree on `>`. The
  invariant is that authored data — a call's `from` label, a formation's name, a module name — must not become
  markup. Prefer `textContent`; never `eval`, `new Function`, `srcdoc` or `javascript:`. **`el()` over
  `querySelector`** for panel elements: the id is a compile-time contract.
- **Licences are constraints.** The engine is AGPL-3.0, the tamination animation data GPL/AGPL: do not relicense,
  do not copy code from `taminations-flutter/`, keep attribution. `docs/` and the extracted `callerlab-ms.txt` are
  **deliberately untracked** — never add them. **One gate already depends on them** (`callerlab-diff`, `all` tier,
  no fallback, so a fresh clone is not green until `engine/test/tools/extract-pdf-text.mjs` has run over `docs/`);
  do not add a second such dependency.
- **The sandbox is not the enemy of the work.** Escalate only after a real denial, for that exact command, with a
  one-line justification; never work around a denial by another route.
- **Untracked-by-design stays untracked**: `docs/`, `callerlab-ms.txt`, `poc/pnpm-*.yaml`, `verify*.log`, the
  `.npm-cache`/`.pw-browsers` caches, probe scratch (`poc/tools/_*.mjs`, `engine/test/tools/_*.txt`). Check
  `.gitignore` before `git add -A`, and **stage explicit paths** — never commit someone else's in-flight work.

---

## 7. Commits

- **One change per commit**, subject `<area>: <what changed, stated as fact>` (`engine:`, `poc:`, `corpus:`,
  `docs:`, `book:`). Run `git log --oneline -20` first.
- **The body carries the evidence**: what was reported, the rule, the measurement that proves it, which gates ran
  and how they came out, and what was **not** checked. Multi-line via `git commit -F`, never a stack of `-m`.
- **Never amend or rewrite a pushed commit**, and do not "clean up" history to hide a correction: add the
  correction. Commit messages are immutable, which is why the durable record is the harness header (§4.2).
- **A local branch is rewritable; a pushed one is not.** Pre-push fixups are squashed on the branch, never after.
- **Master only ever fast-forwards.** No merge commit on it, and no force-push to it.
- **Stage explicit paths** — the tree regularly carries someone else's in-flight work.

---

## 8. Traps that have already bitten

**This is the whole list**: a trap that costs an hour belongs here, with its measurement, in the same commit that
found it. (The two `HANDOVER.md` files that carried a longer version were deleted — an orientation document that
is only regenerated when a session ends gets read as current state by the session after it.)

1. **Read bytes, not the console, when checking text encoding.** `Get-Content` decodes UTF-8 as windows-1252 and
   prints a genuine `—` as `â€”`, inventing corruption in every file that holds one. Use `git grep` or a byte
   count. `engine/test/tools/callerlab-diff.mjs` quotes mojibake **on purpose**; do not "fix" it.
2. **`git checkout -- <file>` restores CRLF**, so a multi-line literal match in a probe must normalise line endings
   or it silently matches nothing.
3. **A Node child spawned with piped stdio fails with EPERM under the file sandbox** — which is why the runners use
   `stdio: 'inherit'` and run probes in-process. **The Vite app is not affected**: MEASURED, `npm run dev:game`
   binds 8089 and a real browser drives the page. What the sandbox constrains is PIPED output, not a dev server.
4. **PowerShell truncation looks like a failure**: `... | Select-Object -First N` can make a success report
   `[exit code: 1]`.
5. **`write`/`edit` intermittently fail** with `ReplaceFileW EIO`; retrying the identical edit succeeds.
6. **There are two `verify` commands**: root `npm run verify` is the POC; the engine gate is
   `npm run verify --prefix engine`.
7. **A position into an authored list is not an identity.** Pick a tam by `from`/`formation`, never by index — a
   hand-added tam once put three checks on a two-dancer pair and they read as an engine defect for months. Register
   calls by **title**, not file basename.
8. **A gate can pin a defect** — read the gate before assuming a fix is wrong.
9. **A generated artefact with no gate goes stale silently**; add the gate. But do not regenerate one while what it
   encodes is being adjudicated.
10. **`knownFormation` will name a board that matches nothing**, and on a tie the winner is library scan order;
    `recognize` refuses the same board — the two namers disagree on purpose.
11. **`boardSig` is positions-only**; anything facing-dependent must key on the full pose.
12. **`parallel.groups` holds dancer OBJECTS, not ids** — comparing them against `d.id` invented 18 false cases.
13. **`Sequencer.getout()`/`fixIt()` search the Sequencer's OWN board** — call `setBoard(board)` first; the failure
    is silent.
14. **`snapMaxError` bounds the MEAN match error, not a dancer.**
15. **A module's last flat step is often charged 0 beats** — the owner is the last step whose own beats are
    non-zero.
16. **Never leave the tree dirty with someone else's work in it**, including the corpus XML, which is regularly
    mid-edit.
17. **Isolation between agents is a separate CLONE, never a `git worktree`** — the junction that makes a worktree a
    second engine instance is measured in §10.
18. **The format has no `cy3`, so a facing curve cannot be mirrored about a line that is not a quarter turn away.**
    MEASURED: a dip control leaves **444 of 444** diagonal facings unrepresentable, where a flip about one of the
    dancer's own axes (`cy1` stays exactly 0) leaves none — which is why the Call editor's mirror takes quarter
    turns and nothing else. Mirror the TURN, which is all `poseFor` reads from a facing curve.
19. **A Vite dev server watching `game/src` fights the editor's atomic write.** MEASURED: `EBUSY … main.ts.tmp`
    killed the server (exit 1) and the next three edits failed with `EIO` — trap 5's error, here the watcher
    holding the file. Retrying does not clear it: stop the dev server, confirm the port is free, then edit.
20. **Never kill every `node` process (`Stop-Process -Name node`, `taskkill /IM node.exe`).** The harness, the
    subprocess runners, dev servers and the probes are all `node`: MEASURED, a smoke test ending in
    `Stop-Process -Name node` killed the session that issued it. Stop by id (`job_kill`, the `$PID` you captured),
    and confirm with a port check (`Test-NetConnection`).
21. **A tool that says "the real service" when no endpoint is set WILL use the real service.** MEASURED: it created
    `dancing-squared-dev` in the account the ambient credentials belong to, and the table had to be deleted by
    hand. Any command that CREATEs or SEEDs must refuse without an explicit endpoint or opt-in
    (`api/src/config.ts`'s `realServiceWarning`), because a developer's default is a local container while a
    credential chain's default is production.
22. **An editing helper must never write a variable it has not proved non-null.** MEASURED: `WriteAllText(path,
    $null)` emptied `game/DESIGN.md` to 0 bytes. Assert non-null AND non-empty before writing, or use the editor
    tools, which fail loudly on a missing anchor.
23. **A request header is not an identity, and a client's clock is not a measurement** — both were true here at
    once, and both are measured (§6): the dev adapter accepted `x-dev-player: <anyone>` as that player, and
    `POST /runs` used the client's `elapsedSeconds` whenever it was BELOW the wall time. Anything a score depends
    on is measured server-side.
24. **PowerShell eats backticks inside a DOUBLE-quoted string, and the damage is silent and legal.** `` `a `` is
    BEL, `` `r `` is a CR, `` `n `` is a CRLF, and a bare backtick before a space is an escape for it. MEASURED: a
    source comment became `ttempts` and the file still parsed. Use SINGLE-quoted strings for any pattern containing
    a backtick (doubling an inner `''`), or the editor tools. **Both halves are now gates for the bytes** (control
    characters and stray CR, tracked files only) **and the shape**: `` `n `` inserts a LEGAL CRLF, so **the
    signature is a comment line that does not start with its file's prefix** — searchable with
    `git grep -n '^[a-z][a-z0-9]*_[a-z]' -- '*.ts' '*.mjs'`, which found the one site and nothing else. Read the
    shape of the line, not only its bytes.
25. **A request header a mode does not ADVERTISE is not merely refused — the request is never sent**, and the
    failure looks like a dead server. MEASURED: the game sent `x-dev-player` in every mode, so against
    `DSQ_AUTH=emulate` the demo drill came back as `TypeError — the server could not be reached`, with a lone
    `204 OPTIONS` and nothing behind it in the server's own log. The identity header is now a function of the mode
    `/health` reported. **When a cross-origin call fails as `TypeError`, look for an `OPTIONS` with no request
    after it.**
26. **A glob that matches NOTHING compiles to `{}` in silence, and the usual cause is a `../` too few.** MEASURED:
    the corpus was duplicated into `game/src/assets/` for a year on a comment claiming `import.meta.glob` cannot
    reach outside Vite's root — it can (`poc/src/ceder-modules.ts` has always globbed the root `modules/`). **The
    two directions are told apart by the build output, not the exit code**: the correct path gave a 2094 KB bundle
    containing `ms/circle.xml`, the one-short path 731 KB without it. One corpus at `assets/`, its location written
    once, reached through the `@corpus` alias so it cannot be one `../` short.
27. **A RULE THAT LIVES ONLY IN THE SCREEN HAS NO GATE — and its own prose will not catch it.** MEASURED: a Daily
    `choose()` armed on every click and never called `play`, so the puzzle could not be played past its first move;
    every probe was green because they measured the composer, not the click — and the commit said "no browser was
    driven" while its message and `DESIGN.md` §9.2 both asserted the interaction worked (the prose was even
    self-contradictory). The rule now lives in `game/src/puzzle/arming.ts`, pinned by
    `game/test/picker-interaction-probe.mjs` and MEASURED to go red on a revert (4 checks, no others). **A claim
    about an interaction the commit also says was never driven is a hope; the fix is to move the rule where a probe
    can reach it, not to drive the browser once more.** A modifier click is the one thing the DSH browser tools
    cannot send.
28. **`npm run dev:game` binds `localhost` (`::1`) — `http://127.0.0.1:8089` is REFUSED.** MEASURED as
    `ERR_CONNECTION_REFUSED` while Vite served happily on `http://localhost:8089/`. The api dev server binds
    `127.0.0.1:8090` and accepts that spelling, so the two halves of one browser check do not share a host name:
    `localhost` for the app, `127.0.0.1` for `VITE_API_BASE`.
29. **A GLOB'S KEY IS NOT THE FILE'S IDENTITY, and pointing the glob at an ALIAS changes the prefix in silence.**
    MEASURED: the glob still matched every file (2094 KB in the bundle) and EVERY lookup missed, so every call
    threw `Missing XML` while the level lists still filled — the app looked alive because the lists came from a
    parse that had already succeeded (reported as "Dancers arent appearing on Call Editor board now"). Identity is
    `corpusFileOf()` (the last two segments of ANY key shape, so no call site spells a prefix), pinned by
    `poc/tools/corpus-key-probe.mjs` over four key shapes and every file. **The same walk read each file's FAMILY
    out of a map published AFTER it**, so `family` had been empty since the field was added; a latent defect found
    in the same read is fixed in the same commit.
30. **A FORMATION'S DANCER ORDER IS DATA EVERY CALLER PAIRS ITS PATHS AGAINST, and a diff of `formations.xml`
    cannot see the callers.** `<path>` lists pair with dancers BY INDEX, and nothing in the files shows the damage
    afterwards: same spots, tams parse, board still looks like a ring. MEASURED: `Circle`'s authored order was
    W,N,E,S where a square set is S,E,N,W; the path permutation is **[2,3,0,1]**, not the `[3,2,1,0]` a
    couple-order reading suggests — that one rotates the dance and moves dancers by up to **3.68** units, where the
    right one reproduces all **22** dependents to **3.23e-15**. Use the `formation-reorder` skill and
    `scripts/reorder-formation.mjs` (it refuses on a dirty tree and writes nothing unless every dependent's
    geometry is preserved); `engine/test/formation-order.mjs` pins the order plus a digest that changes when one
    dependent is left stale. **Do not hand-permute the paths.**
31. **`Tee-Object -FilePath` writes the log as UTF-16LE here, so a script reading it back matches NOTHING — which
    reads as "no failures".** MEASURED: a summary reported **0 failing harnesses** against a log holding **14**,
    every character NUL-separated. Read it as `utf16le`, or skip the tee and let stdout carry it. "The summary said
    zero" is a claim about the log's ENCODING until that is ruled out (§4.1).
32. **A PROBE THAT RUNS WHILE `tsc` IS REWRITING `engine/dist` FAILS AS A MISSING EXPORT**, not as a build in
    flight. MEASURED: a probe died with `does not provide an export named 'buildCall'` — the engine's own entry
    point — from a tree whose source was untouched. Wait for the gate's process to exit, or rebuild and re-run
    before believing the error.
33. **A GATE RUN UNDER THE JOB RUNNER IS KILLED AT ROUGHLY TEN MINUTES, AND IT LEAVES ITS CHILDREN RUNNING.**
    MEASURED: `node game/tools/verify-probes.mjs` (974 s) was killed twice at the same point with `exit=-1`, and
    each time its `puzzle-core-probe` child survived — so the NEXT run shared the CPU with a second copy of an
    8-minute probe, which makes a 457 s probe look hung. Run anything past ten minutes as a detached process
    writing to a log (`Start-Process … -File script.ps1`, then poll the log); after killing a job, find orphans
    with `Get-CimInstance Win32_Process` and stop them BY ID (trap 20). This shell is Windows PowerShell 5.1
    whatever the tool is called, so `Out-File -Encoding utf8` must be spelled out (trap 31).

---

## 9. Done means

- [ ] One change, one intent; the diff contains nothing else.
- [ ] QA pass done: dead code gone, names and comments true, rule in its owning module, negative control present.
- [ ] The gate that covers the change ran, and its result is in the commit message.
- [ ] A revert of this change would turn a check red.
- [ ] Every name this change renames or removes was followed to its consumers (harness witnesses, the game pool,
      the FSM asset, the book indexes, the `KNOWN_*` lists).
- [ ] The gate's own prose was read against the rule it judges, and claims no stronger rule than the code.
- [ ] The claim names its sample and its denominator; MEASURED sentences and inferred ones are visibly different.
- [ ] Committed alone with a multi-line message carrying the measurement.
- [ ] What was not checked is stated, in the message and to the user.
- [ ] No secret, no generated artefact, no untracked oracle, no other person's work in it.
- [ ] Worked on a branch in this clone — never on `master`, never in a shared worktree.
- [ ] Rebased onto the current `origin/master`, and the gate ran on the rebased tree.
- [ ] Pushed fast-forward: no force, no merge commit.

---

## 10. Delivery — one branch, one clone, rebase, gate, fast-forward

**Why a clone and not a `git worktree`.** A worktree isolates the corpus but not the run:
`node_modules/dancing-squared-engine` is a junction into the main tree's `engine/dist`, so the four harnesses that
import `poc-teacher/src/catalog.ts` load a SECOND engine instance and fail (MEASURED: `matrix-getout` passes in the
main tree, crashed in the worktree). Own clone, own `npm install`, own branch.

1. **Provision once per clone**: `npm install` at the root, then re-create the untracked oracle —
   `node engine/test/tools/extract-pdf-text.mjs docs/New_Mainstream_Definitions_26-03-29.pdf callerlab-ms.txt`.
   Without it `callerlab-diff` throws rather than skips, and an un-provisioned clone reports someone else's red as
   yours. Then assert the tree is clean: a dirty start is work you did not do.
2. **Branch before the first edit**, `<area>/<slug>`, from the current `origin/master`. Never commit to `master`
   locally.
3. **Commit as you go** (§7). The branch is local, so fixups are squashed here, never after a push.
4. **Integrate by rebase, not merge**: `git fetch origin master`, then `git rebase origin/master`. Do not merge
   master into the branch first — the rebase re-hits the same conflicts and discards the merge. Do not `git pull`
   on master: the host config has `pull.rebase=false`, so a diverged pull fabricates a merge commit, and
   `git pull --ff-only` failing loudly is the wanted behaviour. A `package-lock.json` conflict is regenerated with
   `npm install --package-lock-only`, never hand-merged.
5. **Gate the FINAL tree, then push.** A suite that ran before the rebase proves nothing, and a build before it is
   thrown away. `core.autocrlf=true` is host-wide, so resolve conflicts by editing (trap 2) and re-run the encoding
   gate if you touched prose.
6. **`git push origin HEAD:refs/heads/master`**, fast-forward only. There is no CI behind master, so step 5 is the
   only gate. `--force-with-lease` is for your own `task/<slug>` branch while it is yours alone — never for master.
7. **A rejected push means master moved**: fetch, rebase, re-gate, push. Bound the retries (three) and report the
   state rather than looping.
8. **Master is not fully green.** Known reds and pin drift live in `TODO.md` (P0/P1) and `verify:figures` is red by
   design. A red you did not cause is reported, never "fixed" by weakening a gate or re-pinning to go green — and
   never adjudicate a corpus number another task is mid-decision on.
9. **One branch, one intent.** The delivery unit is the intent, so normally one commit and no squash. If it carries
   two intents, split it; if it carries fixups, squash them before step 5.
10. **After landing**: `git log --oneline -3`, report the pushed SHA, delete the pushed `task/` branch. Cite a
    landed SHA only after it has landed — any rebase rewrites it.

**Rejected shape:** *pull → merge into the branch → rebuild → rebase → squash → push.* The merge is redundant with
the rebase; the rebuild precedes the rebase, so the tree that ships is the one never tested; `pull` is the wrong
verb on this host's config; and the squash discards the per-change evidence §7 requires. A pull-request flow was
rejected too: with no CI and no reviewer it adds a waiting state and no check.

---

## 11. QA — the five properties, and the failure modes that bit

### 11.1 The properties, and what enforces each

| Property | What it means here | Mechanism | Stated in |
|---|---|---|---|
| **Testability** | a rule is callable from a probe, in process, no browser, no network, no ambient state | the pure core and the extraction pattern (`board-transform.ts`, `bodies.ts`, `arming.ts`) | §5, §4.3 |
| **Reliability** | a refusal is a VALUE, and a degradation is LOUD | `{ legal, reason }` on every entry point; ports not globals; the server owns its measurements; tiers print what they skipped | §5, §6 |
| **Understandability** | the header is the specification and the gate is its proof | headers state rule, measurement and rejected alternative; §1 names ONE authority per concern | §4.2, §1 |
| **Extensibility** | a new case arrives as DATA and is derived | one corpus path; names derived from the corpus; the word lists that ARE the vocabulary; one gate registry per tier | §4.3, §1 |
| **Implementation quality** | one mechanism per concern, in the module that owns it | the extraction pattern; the `KNOWN_*` lists, which make every exception visible and countable | §4.3, §4.5 |

**The order is a dependency:** testable, then reliable, then understandable, then extensible, then fast. Losing
measurability costs everything under it — which is why "it is only a comment" is not a defence (§11.4).

### 11.2 The failure modes

1. **A GATE THAT THROWS HAS MEASURED NOTHING BELOW THE THROW.** A harness died on a `TypeError` with **five
   failures invisible** behind it. A harness always reaches its summary; a missing witness is a FAIL line that
   NAMES it — never a crash, never a `continue`.
2. **A CHECK WHOSE SUBJECT DOES NOT EXIST CANNOT REPORT HONESTLY, EITHER WAY.** A witness asserted a name the
   corpus never carried, so it was red for ever and the two checks under it never ran; a filter made empty by a
   retitle passed while measuring nothing. Every check proves its subject EXISTS, and a sweep whose sample is empty
   reports `0 of 0` as a FAILURE.
3. **THE JUDGE MUST NOT BE A SECOND CALL TO THE PREDICATE UNDER TEST.** A harness verified "reaches Static Square"
   with the very predicate that chose the path, so it passed for as long as the defect existed. Judge with an
   INDEPENDENT observable (identity, FASR, geometry by id); if the rule can only be checked by re-asking it, it
   needs an inspection seam.
4. **A HARNESS'S PROSE IS NOT THE SPECIFICATION.** A header described a safety property stronger than the code,
   the solver was rewritten to it, and the search then found **no get-out for 7 alignments**. A gate IMPORTS the
   rule the engine owns; a header claiming a stronger rule is a trap, not a bonus.
5. **A SWEEP THAT SILENTLY SKIPS ITS INPUT MEASURES LESS THAN IT CLAIMS.** A named call resolved to nothing, so
   the sweep skipped it and **two real faults were invisible**. A sweep reports what it skipped, by name, and
   asserts every name RESOLVES.
6. **A TITLE IS AN API, AND A RENAME IS A MIGRATION.** One retitle broke consumers that had TYPED the name and left
   **8 of 13 `STANDARD_FINISHES` entries naming nothing**. Derive names from the corpus, gate the derivation
   (`CALL_TITLE` + `engine/test/call-titles.mjs`), and USE it — a retitle then breaks the call site at COMPILE time
   and the errors are the migration list. Trap 30 is the same law for formation order.
7. **TWO CONVENTIONS IN ONE TREE IS WORSE THAN A WRONG ONE.** A retitling landed twice with opposite meanings,
   leaving a constant expanding to a name nothing authors. Decide a convention once, where the DATA lives;
   reconciling two that landed is its own commit, never a merge resolution.
8. **A STALE PIN IS A DECISION DEFERRED, AND THERE ARE ONLY THREE KINDS**: exact equality (a FACT), a CEILING (may
   only fall, except when the sweep WIDENS), a NAMED SET (`KNOWN_*`: fails when it shrinks AND grows). Each pin says
   which it is, and re-pinning happens in the commit that re-measures, with the direction stated.
9. **A COPY OF A FACT WITH NO GATE GOES STALE IN SILENCE, and the copy is the one somebody reads.** A generated FSM
   asset sat a schema behind, so four harnesses were red against it. One fact, one place; where a copy is
   unavoidable, ship the gate that compares it, in a tier a change actually runs.
10. **A SUMMARY THAT DOES NOT NAME ITS DENOMINATOR CANNOT BE COMPARED, AND THE COMPARISON IS THE CLAIM.** Two
    reports of the same harness were read first as a catastrophe and then as progress because the samples differed.
    Print the denominator and the sample.
11. **AN UNMEASURED CLAIM IN A COMMIT MESSAGE IS A GUESS WITH AUTHORITY, AND IT WILL BE BELIEVED.** Split MEASURED
    from NOT CHECKED; an inference never sits in the measured voice; a claim about an interaction the message also
    says was never driven is a hope.
12. **A HALF-APPLIED CHANGE IS WORSE THAN NONE, AND IT IS THE NORMAL FAILURE MODE HERE.** A corpus retitled
    without its derived artefacts; a generated file dirty blocking a merge; a list naming eight non-existent
    titles. The unit of a change is data + derived artefacts + consumers + gate, landing together — and if the
    parts cannot land together, both messages say which is missing.

### 11.3 The patterns, and where the risk still is

**A pure core and thin shells** — no DOM, no `three`, no I/O, no ambient time; every app, probe and handler is a
shell around it: testability, portability and understandability in one decision. **Ports over globals**
(`ItemStore`, `Clock`, `IdentityOf`) are why two stores are measured by one contract suite. **One identity for a
file, not a prefix** (`corpusFileOf()` reads the last two segments of ANY key). **A refusal is data** — a consumer
that reads `.board` without checking `.legal` is a crash waiting to happen. **The tier is a cost decision, not a
coverage decision**: every `light: false` carries a `why`, and a gate that only runs in `all` cannot catch a
change-time regression. **A rule in the smallest module that can hold it.**

**Where the risk still is.** Title-keyed facts are spread across six kinds of artefact, each maintained by hand;
prose can outrank code because the headers are good enough to be read as the spec; self-confirming judges pass, so
nobody looks; generated artefacts sit outside the change-time gate; and dead assertions are indistinguishable from
live ones in a green run.

### 11.4 The overarching rules

1. **ADD THE GATE IN THE SAME COMMIT AS THE RULE.** If you cannot write the gate, you have not specified the rule.
2. **A CHANGE IS A MIGRATION** — data, derived artefacts, consumers and the gate move together.
3. **NAME THE SAMPLE, STATE THE DIRECTION, SPLIT MEASURED FROM INFERRED.**
4. **ONE MECHANISM PER CONCERN — SEARCH BEFORE YOU ADD.** A second way to do the same thing is a defect even when
   both work, because the first one fixed is the one nobody is looking at.
5. **A RULE THAT LIVES WHERE A PROBE CANNOT IMPORT IT IS NOT A RULE.** Extract it, or state that it is unmeasured.
6. **NOTHING IN THIS TREE IS "JUST DOCUMENTATION".** A cited path, a pinned number, a stated convention, a comment
   describing a check — all load-bearing, and a stale one is worse than a missing one.
7. **WHEN A GATE AND THE ORACLE DISAGREE, THE ORACLE WINS AND THE GATE IS FIXED.** `docs/` is not ours to
   redistribute, and it outranks this file, a header comment and a green run.
