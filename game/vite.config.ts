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
    port: 5174,
    open: false,
    // THE CORPUS LIVES IN `poc/src/assets`, OUTSIDE THIS APP'S ROOT, and `src/data/assets.ts` globs it
    // from there rather than keeping a second copy (AGENTS.md §1: the corpus has one home). Vite refuses
    // to serve files above the root unless it is told, which is what `allow` is for. The same setting
    // appears in the POC's config for the repo-root `modules/` directory.
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
