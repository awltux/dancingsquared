# Handover

This file is generated at the end of a chat session so that a new chat session can pick up where the other
left off. There is no need to maintain it — it is completely regenerated when a new session is needed.

**Read in this order:**

1. `README.md` — the workspace in five lines.
2. **`AGENTS.md`** — THE RULES: the change loop, the gate matrix, the code and test standards, security, and
   the trap list. It is new this session and it is the authority for *how to work*; do not duplicate it here.
3. **this file** — the orientation: §1 the map, §2 what is measured, §3 how to work, §4 the live threads,
   §5 decisions, §6 traps, §7 the next steps.
4. `PLAN.md` — the state: §2 the scoreboard, **§3 what is refuted**, §5 what is blocked. Read §3 before
   proposing an idea.
5. `square-dancing.md` — the spec (§1–§8) and §9 the open-items log.
6. `engine/test/fixtures/README.md` — where each oracle comes from and how to re-fetch it.

Numbers below are facts about a **closed measurement** or about an authority, and each names the command
that produced it.

---

## 1. What the repo is

| Path | What it is |
|---|---|
| `engine/` | **The thing under test.** TypeScript library. `src/sequencer/` holds matcher, applicator, legality, solver, analyser, FSM, alignment, `grouping.ts` + `selection.ts` (the dancer-selection vocabulary). |
| `poc/` | Three.js app **and the canonical corpus** (`src/assets/`). Sequencer panel (`src/sequencer-ui.ts`), call editor, FSM view, browse view. Probes in `tools/*-probe.mjs`. |
| `poc-teacher/` | Teacher / session-tracker app. |
| `poc-matrix/` | Earlier matrix experiments. **No gate.** |
| `features/` | Gherkin specs, gated by `engine/test/bind-audit.mjs`. |
| `modules/`, `sequences/` | The ceder corpus, tracked. |
| `docs/` | The CALLERLAB PDF and downloaded pages — an oracle **outside git**. |
| `taminations-flutter/` | **Reference only** — read, never port. |
| `book/` | The published book + its tools. **`book/tools/check-links.mjs` item 7 is now the REPO-WIDE text-corruption gate.** |
| `AGENTS.md` | The rules. `HANDOVER.md` (this file) + `PLAN.md` are the pair: orientation and state. |

## 2. Where it stands — measured, each with its command

| Entry point | State |
|---|---|
| `npx tsc -p poc --noEmit` | **clean** (exit 0) |
| `node poc/tools/verify-probes.mjs` | **47 probes, 13 failed** (full run ≈ 11 min). The 13 are the long-standing twelve (`clone-refusal`, `connect-assign`, `coords-gate`, `editor-level`, `facing-end-drag`, `facing-handle`, `formation-ref`, `formation-size`, `move-beats`, `run-circle`, `start-facing`, `wysiwyg-path`) **plus `radial-arc-fit`** |
| `radial-arc-fit-probe.mjs` alone | **PASSES with `poc/src/assets` stashed to HEAD** and fails with the in-flight corpus edits present — the pending corpus work is what turned it red |
| `node poc/verify.cjs` | **exit 1.** Crashes in `selectTam` for `title: 'Circle Left', formation: 'Static Square'`; identical with `poc/src/assets` stashed, so it is pre-existing and NOT the pending corpus work |
| `npm run verify:light --prefix engine` | 27 harnesses, 114.8 s, **FAILED at `catalogue`** (3 checks). PROVEN pre-existing by stashing the changed files: identical 5 FAIL lines and "3 CHECK(S) FAILED" both ways |
| `node book/tools/check-links.mjs` | **GREEN** — 109 pages, links/anchors/coverage pass, and the widened item 7 |
| `npm run check:book` | **exit 1** at `make-animations.mjs --check`: `DRIFT animations-index.json`. Not the changed files (`make-animations` reads none of them — the only name match under `book/tools` is a comment) and unchanged with the assets stashed: `engine/dist` was rebuilt to match HEAD's engine source while the committed index came from the older build. **Do not regenerate it while the corpus is mid-edit** |
| `npm run build -w dancing-squared-poc` | works, ~25 s → `poc/dist` |

**`git status` carries four files that are NOT mine and must not be committed:** `poc/src/assets/formations.xml`,
`poc/src/assets/ms/dosado.xml`, `poc/src/assets/ms/promenade.xml`, `poc/src/assets/ms/swing.xml` (the user's
in-flight corpus work). Also untracked by design: `docs/`, `poc/pnpm-lock.yaml`, `poc/pnpm-workspace.yaml`,
`poc/tools/guard-exclusions-broken.md`.

## 3. How to work here

```powershell
npm run build --prefix engine                 # tsc, from the REPO ROOT
npm run verify:light --prefix engine          # the fast subset while iterating
npm run verify --prefix engine                # the whole engine gate: PRE-COMMIT, background
npx tsc -p poc --noEmit                       # the POC typecheck
node poc/verify.cjs                           # headless POC checks (red, above)
node poc/tools/verify-probes.mjs              # the POC probes (~11 min)
node poc/tools/<name>-probe.mjs               # one probe
node book/tools/check-links.mjs               # the text-corruption gate, seconds
```

**THE UI CAN BE OBSERVED — the sandbox is `danger-full-access` now, and this was used to good effect.**
The recipe is in the old handover and it works: `npm run build -w dancing-squared-poc`, serve `poc/dist`
from a few lines of `node:http` (**not** `vite preview`, which spawns esbuild), then
`PLAYWRIGHT_BROWSERS_PATH=<repo>/.pw-browsers` and `chromium.launch({ args: ['--no-sandbox',
'--enable-unsafe-swiftshader'] })`. Playwright and chromium 1243 are already installed. Screenshots come
back readable.

## 4. The live threads

### 4.1 THE SUBSET LIGHTS, and the group vocabulary (this session's main thread)

**Reported:** "'Subsets present' entries should be links that use the dancer highlight circles from Call
Editor … Pressing a second time disables the highlighted dancers." Then: "Drop the Men, Women and Ladies
links as these are represented by Boy and Girl." Then: "Can you add leaders, trailers and other unique
groups and ids" — answered **(a) the ones already listed, (b) only lights on board**.

**DONE AND VERIFIED IN A BROWSER** (four commits, `c4a08eb`, `ea78dd8`, `8b7c933`, `ba7b170`):

- each name in the composer line is a link; pressing it rings those dancers with the CALL EDITOR's ring
  (`DancerView.setSelected`), a second press takes them out; a SET, so several can be lit at once;
- **the ring is a SCENE CHILD** (`DancerView.selectionRing`), NOT part of `v.group` — so `rebuildViews` must
  `scene.add` it by hand, exactly as `browser.ts:529/548` does. That was the "I don't see the rings" fault:
  `setSelected(true)` was setting `visible` on an object that was never in the scene;
- the ring is gated on `active` alone, **not** on `use2d` — the sequencer OPENS in 2D, so a ring wired to the
  avatar/track gate is invisible exactly when it is wanted;
- **OBSERVED**: the line offers `Heads · Sides · Boys · Girls · Beaus · Belles`; pressing HEADS draws four
  rings on the floor (top and bottom pairs, none on the sides) in the 2D view; canvas 82,721 bytes before,
  89,692 with the rings up, 83,030 after the second press. The Who picker still lists its 28 groups including
  Men/Women/Ladies.

**OPEN — the nine names that are never offered.** `Sequencer.subsetGroups` (`engine/src/sequencer/sequencer.ts`
~767) asks for 18 names: the six above plus `Centers`, `Ends`, `Couples`, `Leaders`, `Trailers`,
`Couple #1`–`#4`, and filters them through `keepProperSubsets(board)` (non-empty, not-everyone, on this
board). MEASURED in the running app across **13 boards** from the panel's own picker — Ocean Waves, Alamo
Wave, Two-Faced Lines, 3/4 Tag, Eight Chain Thru, Completed Double Pass Thru, "3 and 1 lines #1", Columns,
Static Square and more — **not one offered anything beyond the six**.

RULED OUT: the names are spelled correctly and recognised. `selection.ts`'s `SELECTION_GROUP` maps
`'centers'`, `'ends'`, `'couples'`, `'leaders'`, `'trailers'` (plus singular aliases) and `COUPLE_RE =
/^couple #(\d+)$/` matches `Couple #N`.

TWO REMAINING CANDIDATES:

1. **`couples` may have no switch arm.** `grouping.ts`'s switch was read as `centers/ends`, `verycenters`,
   `beaus/belles`, `leaders/trailers`, `default: return null` — no `case 'couples'` was seen. Confirm the
   head of that switch.
2. **`centers`/`ends`/`leaders`/`trailers` are arrangement-gated** by `splitLine(board)` and
   `leadersTrailers(ds, role)` — and the SMOKING GUN is that `grouping.ts:222` documents its own measured
   case as "`Leaders Trade` from a Completed Double Pass Thru", yet `Leaders` was not offered on exactly that
   board. Either those preconditions are stricter than the boards tried, or `keepProperSubsets` drops the
   answer. A shape hypothesis worth testing first: `leadersTrailers` returns `number[][]` (a LIST of groups)
   where the others return `number[]`, and `keepProperSubsets` compares `ids.length` against the board size.

**THE NEXT COMMAND (do this first):** a throwaway probe that builds a `Sequencer`, loads Completed Double
Pass Thru / Alamo Wave / Two-Faced Lines, and prints `this.grouping.resolveSelection(board, name)` **raw** for
all 18 names — `null` vs `[]` vs ids. That separates "unresolvable here" (arrangement) from "resolved but
dropped" (`keepProperSubsets`). `engine/test/couples.mjs` and `poc/tools/clone-refusal-probe.mjs` have the
shortest preambles for building a board (`new engine.Sequencer(movesXml, formationsXml, callsByTitle(assets))`).

**THE DOMAIN RULE, from the user, verbatim in substance:** the couple id is carried by the **Boy and his
current Girl partner**. The Girl keeps a memory of her **original** couple — to check whether original couples
are back together after a tip, how far round they are, or whether the board is in FASR sequence — **but for
this purpose we need the Boy and his current Girl partner.** The engine already implements exactly that:
`engine/test/couples.mjs` pins "a couple is a boy and a girl standing as a couple (2.0 apart, co-facing), the
couple's NUMBER is the boy's, and a girl adopts the number of the boy she is beside", with `SeqDancer.couple`
being the **HOME** couple ("assigned once … never changed"), and a geometry-only board staying
`UNKNOWN_COUPLE` rather than acquiring a number from an index. So `Couples`/`Couple #N` lights must come from
`couples.ts`'s board derivation, **never** from the stored home field — that field is the wrong answer the
moment anyone changes partners.

**SCOPE, decided by the user:** lights on the board only. The vocabulary the ENGINE accepts must not be
widened for calls — the resolver is shared with matching, so a name that stops resolving changes what may be
applied. The same reasoning is why the Men/Women/Ladies filter is a **display filter** in the panel
(`SYNONYM_SUBSETS`) and nowhere else. And: "All of these terms will be needed in the sequencer at some point
as they are valid identities and roles" — keep them first-class names, not panel-local strings.

### 4.2 The shape / symmetry thread, and the FSM reading thread

Unchanged this session. `PLAN.md` §2 is the scoreboard and §4.2 of the previous revision records the
ordering constraint for the FSM work: the namer must refuse a π-off/tied board, `legalWithResults` must admit
an unnamed end, `buildFsmTable` must close over those ends, and **then** `poc/src/assets/fsm-ms.json` is
regenerated with the gate that fails when the asset no longer matches a rebuild. Do not regenerate a
generated artefact while the thing it encodes is being adjudicated.

## 5. Decisions already made — do not relitigate without new evidence

**Earlier, unchanged:** the caller convention (a get-out succeeds by reaching a state a standard finish
closes); index independence; **identity is data** (never invented from an array position); the dancer ARRAY
ORDER is the renderer's binding (`reorderLike`); a written shape is half the set unless it says otherwise;
a two-dancer pair is authored with both dancers and `asymmetric="true"`; `formations.xml` cannot declare
symmetry; an exported tam declares the whole set it wrote — **in EMBED mode only**; a board that matches
nothing must be refused, not named; `KNOWN_FORMATION_MAX`'s binding tolerance is `maxError / 12`, not 6.0;
`DEFAULT_MATCH_MAX = 1.5` interactive vs `SEARCH_MATCH_MAX = 6.0` search; All8 is the authority over
Taminations for notation and FASR, CALLERLAB over All8 for definitions.

**New this session:**

- **The text-corruption gate is REPO-WIDE** (`book/tools/check-links.mjs` item 7), with an in-file
  `mojibake-check:allow` sentinel for a file whose SUBJECT is the corruption. The pattern stays narrow on
  purpose: a general CP1252 round-trip test cries wolf (`poc/README.md`'s "(0.2x–20x)" zoom range decodes
  cleanly to Hebrew).
- **A call's export names the setup it starts from** — `formation="<name>"` and no `<formation>` element when
  the name describes the call; the half-set rule completes the named formation at EVERY authored size (a
  2-dancer formation plays as 4), and the name chain consults `call.formation`.
- **The subset-line synonym filter is display-only.** Men/Women/Ladies are the same dancers as Boys/Girls, but
  the engine keeps them because calls name them ("Ladies Chain").
- **The selection ring is a scene child**, gated on `active`, shown in BOTH views.
- **The couple id for anything "now" is the boy's + his current girl's** (`couples.ts`), not
  `SeqDancer.couple`.

## 6. Traps that have already bitten

1. **A source-level probe can be green while the feature draws NOTHING.** Every check passed for the subset
   ring while `visible` was being set on an object never added to the scene. **Run the UI.**
2. **`git stash push -- <path>` with an UNTRACKED path fails and stashes NOTHING**, printing only a
   "did not match any file(s) known to git" line — so a "before" measurement silently runs the "after" tree.
   Check `git stash list` after stashing, or stash tracked paths only.
3. **The formation picker lives in a collapsed `<details>`**, and a `<select>` inside a closed one is not
   visible to Playwright: open it (`el.closest('details').open = true`) before `selectOption`.
4. **Two copies of one table drift.** `applyView` and `setActive` each carried the per-view visibility; the
   ring gate had to go in both. It is now ONE method (`applyViewVisibility`) and the probe COUNTS the copies.
5. **`write`/`edit` intermittently fail with `ReplaceFileW EIO (Win32 32)`** — pause ~2 s and retry the
   identical edit; it is not a bad match.
6. **A gate can pin a defect.** `run-circle-probe` asserted the MOJIBAKE form of a string the source had
   right, so the check could never pass; and a probe can assert "no such loop remains" where the unified
   method legitimately contains one. Read the gate before assuming the fix is wrong.
7. **Read BYTES, not the console.** `Get-Content` decodes UTF-8 as windows-1252 and invents corruption in
   every file containing an em dash. Use `git grep` or a byte count.
8. **CRLF.** The app's `.ts`/`.html` are CRLF in the working tree, so a multi-line literal match in a probe
   needs `.replace(/\r\n/g, '\n')` — including for reads of `engine/src`.
9. **Piped stdio is refused under the file sandbox** (`spawnSync git EPERM`) — a probe must not shell out;
   and PowerShell's `>` writes UTF-16 while `Out-File -Encoding utf8` does not.
10. **`... | Select-Object -First N` can make a successful command report exit 1.**
11. **Select a tam by `from`/`formation`, never by index; register calls by TITLE, not file basename.**
12. **An engine id is NOT an array position** — `boardFromMatchables` stamps `id: i + 1` for a board with no
    home identity. Map back through the board's own `id`.
13. **`parallel.groups` holds dancer OBJECTS, not ids.**
14. **`knownFormation` will name a board that matches nothing**, and on a tie the winner is library scan
    order; `recognize` refuses the same board.
15. **A generated artefact with no gate goes stale silently** — and must not be regenerated while its subject
    is being adjudicated (the animations index, the FSM asset).
16. **The corpus XML in the tree is the user's in-flight work.** Never commit it, and remember it changes
    probe results (`radial-arc-fit`).
17. **A fabricated number in a doc is a defect.** `0.419` was invented as an illustration in `AGENTS.md` and
    had to be removed; `config.now` and "`strict` is on in every package" were the same class of error.

## 7. If you have one afternoon

In the order the evidence supports:

1. **The one measurement** in §4.1: print `resolveSelection` raw for the 18 names on Completed Double Pass
   Thru, Alamo Wave and Two-Faced Lines. It costs one throwaway probe and it decides everything below.
2. **Fix what it shows, lights only** — a missing `case 'couples'` arm and/or how `keepProperSubsets` reads a
   `number[][]` answer. Do NOT widen what calls may be applied to.
3. **Re-run the sweep in the browser** (Ends/Centers on two facing lines, Leaders/Trailers on a Completed
   Double Pass Thru, Couples on a squared set), plus `npx tsc -p poc --noEmit` and
   `node poc/tools/verify-probes.mjs` (baseline: 47 probes, the same 13).
4. **Extend `poc/tools/subset-highlight-probe.mjs`** with the new checks and their negative controls, and
   record the observation in its header the way the last three commits did.
5. **Then `Couples`/`Couple #N`**, if the sequencer's board turns out to carry no couple identity: resolve
   from `couples.ts`'s derivation — the boy's number and the girl beside him — and add a witness with a real
   partner change, never `SeqDancer.couple`.
