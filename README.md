# Dancing Squared

A square-dance project: a standalone **engine** library plus the apps that consume it,
managed as a single npm workspace.

## Workspace layout

| Package | Path | What it is |
|---------|------|------------|
| `dancing-squared-engine` | `engine/` | Standalone, renderer-agnostic engine: taminations XML → `CallBundle`, pose evaluation, hand holds. Ships typed ESM to `dist/`. **The thing under test.** |
| `dancing-squared-poc` | `poc/` | Three.js app that consumes the engine and renders 3D avatars with the full call catalog. Also holds the canonical corpus (`src/assets/`) and the probe suite (`tools/*-probe.mjs`). |
| `dancing-squared-teacher` | `poc-teacher/` | Teacher / session tracker: class plans, attendance, and practice tips built from the engine's Sequencer. |
| `dancing-squared-matrix-poc` | `poc-matrix/` | Exploratory: whether a call reads as a matrix transformation of (position, heading). **Not in any gate** — its only script is `poc`. |

The first two are the ones under test. All of them depend on the engine (linked as a workspace), so the
engine is the single source of truth for all engine logic.

## Setup

```bash
npm install        # install everything at the root (workspaces)
```

## Commands (from the root)

| Command | Does |
|---------|------|
| `npm run build:engine` | Build the engine (`tsc` → `engine/dist`) |
| `npm run build` | Build engine + poc (Vite) |
| `npm run dev` | Start the PoC Vite dev server |
| `npm run verify` | Build the engine, then run the **PoC** suite: `poc/verify.cjs` plus every `poc/tools/*-probe.mjs` |
| `npm run verify:engine` | Run the **engine** gate: `tsc`, then `engine/test/verify-suite.mjs all` |
| `npm run verify:teacher` | The teacher app's own checks |
| `npm run dev:teacher`, `npm run build:teacher` | The teacher app |
| `npm run check:book` | The book's link, animation and diagram checks |

**There are two `verify` commands and they are not the same thing.** `npm run verify` at the root is the
PoC; the engine gate is `npm run verify:engine`, or `npm run verify --prefix engine`. The engine gate is
minutes rather than seconds, so run it in the background; while iterating on the engine, `npm run
verify:light --prefix engine` runs the fast subset — a subset of one list, not a weaker check, and the
banner says which harnesses it skipped. The PoC probes have a slow tier too: `npm run
verify:probes --prefix poc` runs the default tier and `npm run verify:probes:all --prefix poc` adds
`call-formations-probe`, which is most of the time.

Because the poc depends on the engine via the workspace link, rebuild the engine
with `npm run build:engine` whenever the engine source changes — `poc/verify.cjs`
and every PoC probe run against the built `dist`, so a stale build silently tests
the old engine. Never rebuild `dist` while a suite is running.

## Docs

- **How to work here**: [`AGENTS.md`](AGENTS.md) — the rules, the gates and the traps; [`HANDOVER.md`](HANDOVER.md)
  — the orientation; [`PLAN.md`](PLAN.md) — the state, and what has been refuted.
- Engine API: [`engine/README.md`](engine/README.md)
- PoC usage: [`poc/README.md`](poc/README.md)
- Product/architecture: [`prd.md`](prd.md) and [`square-dancing.md`](square-dancing.md)

## Data

The animation data (`moves.xml`, `formations.xml`, per-level call XMLs) is the
GPL/AGPL-licensed taminations data, referenced/copied into `poc/src/assets`.

Two oracles are deliberately **not** in git, because they are not ours to redistribute: `docs/` (CALLERLAB's
Mainstream definitions PDF and pages downloaded from it) and `callerlab-ms.txt`, the text extracted from
them by `engine/test/tools/extract-pdf-text.mjs`. One gate does depend on the extracted text —
`callerlab-diff`, in the `all` tier — so it cannot pass on a fresh clone until that extraction is re-run.
