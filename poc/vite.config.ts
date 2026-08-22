import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

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
  server: {
    port: 5173,
    open: false,
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
