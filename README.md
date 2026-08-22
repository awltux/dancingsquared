# Dancing Squared

A square-dance project: a standalone **engine** library plus a **3D proof-of-concept**
app, managed as a single npm workspace.

## Workspace layout

| Package | Path | What it is |
|---------|------|------------|
| `dancing-squared-engine` | `engine/` | Standalone, renderer-agnostic engine: taminations XML → `CallBundle`, pose evaluation, hand holds. Ships typed ESM to `dist/`. |
| `dancing-squared-poc` | `poc/` | Three.js app that consumes the engine and renders 3D avatars with the full call catalog. |

`poc` depends on `dancing-squared-engine` (linked as a workspace), so the engine
is the single source of truth for all engine logic.

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
| `npm run verify` | Build the engine, then run the PoC's full verification suite |
| `npm run verify:engine` | Run the engine's own Node smoke test |

Because the poc depends on the engine via the workspace link, rebuild the engine
with `npm run build:engine` whenever the engine source changes.

## Docs

- Engine API: [`engine/README.md`](engine/README.md)
- PoC usage: [`poc/README.md`](poc/README.md)
- Product/architecture: [`prd.md`](prd.md) and [`square-dancing.md`](square-dancing.md)

## Data

The animation data (`moves.xml`, `formations.xml`, per-level call XMLs) is the
GPL/AGPL-licensed taminations data, referenced/copied into `poc/src/assets`.
