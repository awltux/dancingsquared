# AGENTS.md — how to change this repo

<!-- mojibake-check:allow — §8 trap 1 quotes the corruption on purpose, as its signature. -->

**What this file is.** The durable rules for working here: the loop, the gates, the house style, and the
traps that have already cost hours. It is deliberately **not** the state of the work — that is `PLAN.md`
(the scoreboard in §2, the work queue in §4, what is refuted in §3). A rule here should still be true in
ten sessions; the moment one is disproved, fix it **in the same commit** that disproved it.

**If you read nothing else:** §0 (the loop) and §3 (the gates). Everything else is a reason for one of them.

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

**Corollary — never batch.** Do not stack unrelated edits and commit them together at the end, and do not
leave a working tree dirty while starting the next change. A commit that adds a gate whose fix is in the
NEXT commit is not green standalone; if you cannot avoid the pair, say so in both messages.

---

## 1. The map

| Path | What it is | Lives in a gate? |
|---|---|---|
| `engine/` | **The thing under test.** `dancing-squared-engine`, TypeScript → `dist/`, renderer-agnostic. `src/sequencer/` holds matcher, applicator, legality, solver, analyser, FSM, alignment. | yes — `engine/test/verify-suite.mjs` |
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
  `.env` in git. Nothing sensitive is currently tracked — keep it that way.
- **The apps are offline.** `poc/` makes no network calls; `poc-teacher/` works against local state
  (`localStorage`) and the local engine. Do not add a remote call, a telemetry beacon or an external font
  without an explicit decision recorded in the commit message.
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
   in-process. It is also why the Vite app cannot be started here.
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
