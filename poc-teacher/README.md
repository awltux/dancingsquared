# SQD Teacher

A mobile-first web app for square dance teachers: plan class sessions, mark
attendance and call knowledge, and auto-generate practice tips that start and
finish in the squared set. Tips can be saved as reusable modules.

It is part of a **npm-workspaces monorepo** and depends on the shared
`dancing-squared-engine` package (the call/formation engine and Sequencer used
for tip generation).

## Prerequisites

- **Node.js 20+** for development and building (Vite 5).
- **Node.js 23.6+ (recommended: 26)** for `npm run verify` — the headless test
  imports the TypeScript sources directly via Node's type-stripping.
- npm 9+ (workspaces support).

## Install

From the repository root (this is a workspace, so install once at the root):

```sh
npm install
```

## Build the engine first

The teacher app imports `dancing-squared-engine` from its built output
(`engine/dist`). Rebuild the engine **before** building/running the teacher, and
again after any engine change, or the app will use stale engine code:

```sh
npm run build:engine
```

## Run (development)

```sh
npm run dev:teacher
```

Opens the Vite dev server at **http://localhost:5174**. Changes to the app are
hot-reloaded by Vite.

Note: the catalog XML (moves/formations/calls) lives under the sibling `poc`
directory's assets. The dev server allows serving them via `server.fs.allow`
(this is configured in `vite.config.ts`), so keep the `poc/` folder present.

## Build (production)

```sh
npm run build:teacher
```

Emits a static build to **`poc-teacher/dist/`** (TypeScript check via `tsc`,
then Vite build with `base: './'`, so all asset URLs are relative). The build
injects the current **git commit** into `index.html` (`<meta name="app-version">`)
so the running app can detect a new deploy and reload.

## Test

Run the headless verification suite (catalog, session model, tip generation,
programmes, import/export, etc.):

```sh
npm run verify:teacher
```

Engine tests (Sequencer, formations, mainstream catalog, editor):

```sh
npm run verify:engine
```

Both run through the workspace `verify` scripts. `verify:teacher` requires the
engine to be built first (`npm run build:engine`).

## Preview the production build locally

```sh
npm run preview -w dancing-squared-teacher
```

Serves the contents of `dist/` (default http://localhost:4173) to check the
built app before deploying.

## Host (deploy)

`poc-teacher/dist/` is a fully **static** site — host it on any static file
server / CDN (Netlify, Vercel, GitHub Pages, nginx, S3+CloudFront, etc.).

Because the app is **hash-routed** (`#/class/...`) and uses `base: './'`, there
is **no server-side routing config** needed — every request serves the same
`index.html`.

Notes for hosting:

- **Service worker / offline:** the app ships `public/sw.js` (network-first with
  runtime caching). Service workers require a secure context, so serve over
  **HTTPS** (or `localhost`) for offline support and PWA installability.
- **Deploy/update detection:** the app compares the git-commit version meta tag
  and reloads when a newer build is deployed. Make sure each deploy is a fresh
  `npm run build:teacher` so the commit hash changes.
- **Git is required at build time** to stamp the version (the build reads
  `git rev-parse HEAD`); if git isn't available it falls back to `unknown`.
- **Icons / manifest:** `public/icon.svg`, `public/manifest.webmanifest` and
  `public/robots.txt` are copied into `dist/` automatically.

## Data & storage

All app data (classes, sessions, programmes, tips config, saved modules, tour
state) is stored in the browser's `localStorage` under keys prefixed `dsTeacher`
(e.g. `dsTeacherData`, `dsTeacherProgrammes`, `dsTeacherSavedModules`). There is
no backend. Clearing site data resets the app.

## Project layout

```
poc-teacher/
  index.html            App shell (SEO meta, manifest/icon links)
  vite.config.ts        Vite config (base './', git-commit injection, fs.allow)
  public/
    sw.js               Service worker (offline + reload-on-update)
    manifest.webmanifest
    icon.svg
    robots.txt
  src/
    main.ts             UI + routing + all the wiring
    teacher.ts          Core model & tip generation (headless-testable)
    programme.ts        Programmes / SSD curriculum
    catalog.ts          Call catalog built from the taminations XML
  verify.mjs            Headless test suite (Node type-stripping)
```
