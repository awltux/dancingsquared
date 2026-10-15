# Dancing Squared

A square-dance project: a standalone **engine** library plus the apps that consume it,
managed as a single npm workspace.

## Workspace layout

| Package | Path | What it is |
|---------|------|------------|
| `dancing-squared-engine` | `engine/` | Standalone, renderer-agnostic engine: taminations XML → `CallBundle`, pose evaluation, hand holds. Ships typed ESM to `dist/`. **The thing under test.** |
| `dancing-squared-poc` | `poc/` | Three.js app that consumes the engine and renders 3D avatars with the full call catalog. Also holds the canonical corpus (`src/assets/`) and the probe suite (`tools/*-probe.mjs`). |
| `dancing-squared-teacher` | `poc-teacher/` | Teacher / session tracker: class plans, attendance, and practice tips built from the engine's Sequencer. |
| `dancing-squared-stage` | `packages/stage/` | The shared Three.js render stage the apps draw through (`scene.ts`, `grid-magnet.ts`), exported as **source** so both apps render through one implementation rather than two. It has no gate of its own: its consumers' gates are its gate, and the probes that load `grid-magnet.ts` are the closest thing to a unit test it has. |
| `dancing-squared-game` | `game/` | The call game: a seeded puzzle core, the Drill and the Daily, playable offline and (from Phase 5) account-backed. Its design of record is `game/DESIGN.md`, and it has **its own gate** — see `npm run verify:game` below. |
| `dancing-squared-api` | `api/` | The game's server: the endpoints of `game/DESIGN.md` §11 as handler functions over injected ports, with a local dev server (port **8090**) and an in-memory store. It is the one component that will talk to AWS. **Its own gate** — `npm run verify:api`. |
| `dancing-squared-matrix-poc` | `poc-matrix/` | Exploratory: whether a call reads as a matrix transformation of (position, heading). **Not in any gate** — its only script is `poc`. |

The engine is what all the others consume (linked as a workspace), so it is the single source of truth for
all engine logic; the packages with a gate of their own are `engine/`, `poc/`, `poc-teacher/`, `game/` and `api/`,
and why each one runs what it runs is `AGENTS.md` §3.

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
| `npm run verify:game` | The game's probe suite: every `game/test/*-probe.mjs`, checking first that the game's copy of the corpus still matches `poc/src/assets`. **Its typecheck is a separate command** (`npx tsc -p game --noEmit`), as the POC's is; `AGENTS.md` §3 is the gate, and this script is the half of it that can be one |
| `npm run dev:game`, `npm run build:game`, `npm run preview:game` | The game's Vite dev server (port **8089**, set in `game/vite.config.ts`), its build, and a preview of the build |
| `npm run build:pool` | Regenerate the game's level pool from the corpus (`game/tools/build-pool.mjs`) |
| `npm run measure:ladder` | The ladder census: what every level actually costs to generate (`game/tools/measure-ladder.mjs`) |
| `npm run verify:api` | The API's probe suite: every `api/test/*-probe.mjs` (its typecheck is `npx tsc -p api --noEmit`, for the same reason as the game's) |
| `npm run dev:api` | The API's local dev server (port **8090**, `DSQ_PORT` to move it), seeded with the game's local schedule fixture and backed by an in-memory store. `x-dev-player: <name>` (or `Authorization: Bearer dev:<name>`) is the development identity |
| `npm run dev:api:ddb` | The same server backed by **DynamoDB Local** — start it first (`docker compose -f api/docker-compose.yml up -d`) and create the table (`npm run api:table`) |
| `npm run api:table` | Create the API's single DynamoDB table, idempotently, at `DSQ_DDB_ENDPOINT` or in the configured region |
| `npm run verify:api:ddb` | The API's suite with the DynamoDB half MANDATORY: without it, a probe whose endpoint does not answer reports a skip rather than a failure |
| `npm run dev:teacher`, `npm run build:teacher` | The teacher app |
| `npm run check:book` | The book's link, animation and diagram checks |

**There are two `verify` commands and they are not the same thing.** `npm run verify` at the root is the
PoC; the engine gate is `npm run verify:engine`, or `npm run verify --prefix engine`. The engine gate is
minutes rather than seconds, so run it in the background; while iterating on the engine, `npm run
verify:light --prefix engine` runs the fast subset — a subset of one list, not a weaker check, and the
banner says which harnesses it skipped. The PoC probes have a slow tier too: `npm run
verify:probes --prefix poc` runs the default tier and `npm run verify:probes:all --prefix poc` adds
`call-formations-probe`, which is most of the time.

### Local DynamoDB (the API's real store)

The API runs against an in-memory twin by default, so nothing is needed to start it. To exercise the actual
store — the same adapter the deployment will use — run DynamoDB Local in a container, create the table once, and
start the server against it:

```bash
docker compose -f api/docker-compose.yml up -d   # DynamoDB Local on 127.0.0.1:8000, in memory
npm run api:table                               # create the table (idempotent)
npm run dev:api:ddb                             # the dev server, store: dynamodb … at http://127.0.0.1:8000
npm run verify:api:ddb                          # the store contract, with the DynamoDB half required
docker compose -f api/docker-compose.yml down   # stop it (nothing is kept: the container runs -inMemory)
```

Configuration is `DSQ_*` environment variables with working defaults (`DSQ_STORE`, `DSQ_TABLE`,
`DSQ_DDB_ENDPOINT`, `DSQ_REGION`, `DSQ_PORT`). **No secret is involved**: DynamoDB Local authenticates nothing
and is bound to `127.0.0.1` for that reason, while a real deployment takes its credentials from the Lambda
role.

**`api:table` and `dev:api:ddb` REFUSE to run without `DSQ_DDB_ENDPOINT`** unless `DSQ_ALLOW_REAL_AWS=1` is set
as well: with no endpoint the SDK resolves the real service for the region, so the default would be to create a
table and seed a schedule in whatever account the ambient credentials belong to. That happened once, while this
tool was being written (AGENTS.md §8 trap 21), and the guard is what came of it.

Because the poc depends on the engine via the workspace link, rebuild the engine
with `npm run build:engine` whenever the engine source changes — `poc/verify.cjs`
and every PoC probe run against the built `dist`, so a stale build silently tests
the old engine. Never rebuild `dist` while a suite is running.

## Docs

- **How to work here**: [`AGENTS.md`](AGENTS.md) — the rules, the gates and the traps; [`PLAN.md`](PLAN.md)
  — the state, and what has been refuted.
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
