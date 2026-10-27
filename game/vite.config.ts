import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { corpusAlias } from '../vite.corpus.ts';
import { engineAlias } from '../vite.engine.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

// CARRIED OVER FROM `poc/vite.config.ts` — AND THE REASON NOW LIVES WHERE THE MAP DOES (`vite.engine.ts`).
//
// The alias is not (only) about resolution: it is about there being ONE INSTANCE of the engine. The
// engine injects a global DOMParser (`setParser`) and keeps module-level state, so a bundle that ends up
// with two copies — one resolved from this package's `node_modules`, one from the workspace's — can
// behave as two engines that agree on nothing. Pointing the specifier at the sibling workspace's built
// `dist` makes every importer, including `dancing-squared-stage`, share one module instance. The map
// carries the six subpath entries as well as the bare specifier, so a consumer can import a tier.
export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: { ...engineAlias, ...corpusAlias },
  },
  server: {
    port: 8089,
    open: false,
    // SERVING FILES FROM ABOVE THIS APP'S ROOT. Vite refuses to serve anything outside `root` unless it is
    // told otherwise, and this app imports three things that live above it: `dancing-squared-engine` (aliased
    // to `engine/dist`), `dancing-squared-stage` (a source-exporting workspace package under `packages/`) and
    // the corpus at the repository root (`@corpus`). The POC's config carries the same setting.
    //
    // THE CORPUS IS THE ONE THAT USED TO HAVE A COPY INSTEAD, because a comment here claimed
    // `import.meta.glob` cannot reach outside the root. MEASURED false — see `vite.corpus.ts`, which traces the
    // empty glob that made it look true to one `../` too few. `server.fs.allow` is what the DEV server needs to
    // serve those bytes; the build resolves the glob from the filesystem and never asks.
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
