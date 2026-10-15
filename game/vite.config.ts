import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// CARRIED OVER FROM `poc/vite.config.ts`, AND FOR THE SAME REASON IT IS THERE.
//
// The alias is not (only) about resolution: it is about there being ONE INSTANCE of the engine. The
// engine injects a global DOMParser (`setParser`) and keeps module-level state, so a bundle that ends up
// with two copies — one resolved from this package's `node_modules`, one from the workspace's — can
// behave as two engines that agree on nothing. Pointing the specifier at the sibling workspace's built
// `dist` makes every importer, including `dancing-squared-stage`, share one module instance.
export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: { 'dancing-squared-engine': path.resolve(here, '..', 'engine', 'dist', 'index.js') },
  },
  server: {
    port: 8089,
    open: false,
    // SERVING FILES FROM ABOVE THIS APP'S ROOT. Vite refuses to serve anything outside `root` unless it is
    // told otherwise, and this app imports two things that live above it: `dancing-squared-engine` (aliased
    // to `engine/dist`) and `dancing-squared-stage` (a source-exporting workspace package under
    // `packages/`). The POC's config carries the same setting for the same reason.
    //
    // IT IS NOT FOR THE CORPUS, which is what an earlier version of this comment claimed. The corpus IS
    // inside the root, at `game/src/assets/` - a copy of `poc/src/assets`, because `import.meta.glob` cannot
    // reach outside the root at all and `server.fs.allow` does not change that (measured; see
    // `tools/sync-corpus.mjs`, which is why the copy exists and what keeps it identical).
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
