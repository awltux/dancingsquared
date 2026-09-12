import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// Read the current git state so the built app can display which commit it was
// built from. Falls back to "unknown" when git isn't available (e.g. an export
// without a repo).
function gitInfo(): Record<string, string> {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { encoding: 'utf8', cwd: process.cwd() }).trim();
    } catch {
      return '';
    }
  };
  const commit = run('git rev-parse HEAD');
  const dirty = run('git status --porcelain');
  return {
    commit,
    short: commit ? commit.slice(0, 7) : 'unknown',
    date: run('git log -1 --format=%cI'),
    dirty: dirty ? 'dirty' : 'clean',
  };
}

const g = gitInfo();

export default defineConfig({
  root: '.',
  base: './',
  // Resolve the engine from the WORKSPACE, not from this app's node_modules.
  //
  // `poc/node_modules/dancing-squared-engine` is a pnpm copy of `engine/` built as a HARDLINK FARM:
  // files that already existed are shared with the engine's dist, so rebuilding the engine updates
  // them in place — but a file the engine ADDS (e.g. `dist/sequencer/swing-thru.js`) is not in the
  // farm and never appears, leaving the app importing a module that does not exist. The failure is
  // confusing precisely because most of the engine is current. Pointing at the sibling workspace
  // makes this app always build against the engine it lives beside, which is what the repo's npm
  // workspaces layout intends.
  resolve: {
    alias: { 'dancing-squared-engine': path.resolve(here, '..', 'engine', 'dist', 'index.js') },
  },
  server: {
    port: 5173,
    open: false,
    // The translated ceder modules live in the repo-root `modules/` dir (outside
    // this app's root); allow serving and importing them via import.meta.glob.
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  define: {
    __GIT_COMMIT__: JSON.stringify(g.commit),
    __GIT_COMMIT_SHORT__: JSON.stringify(g.short),
    __GIT_COMMIT_DATE__: JSON.stringify(g.date),
    __GIT_DIRTY__: JSON.stringify(g.dirty),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
