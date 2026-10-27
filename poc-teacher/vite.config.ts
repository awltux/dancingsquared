import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
// THE CORPUS LOCATION IS WRITTEN ONCE, in `vite.corpus.ts` (AGENTS.md §1). This app used to reach it by counting
// `../../`, five times, in `src/main.ts`; it now uses the same `@corpus` alias the POC and the game use — and it
// reads the repository's ONE FSM asset (`assets/fsm-ms.json`) through that alias too, instead of shipping a copy.
import { corpusAlias } from '../vite.corpus.ts';

// Read the current git commit so the build can expose a version. Used both to tag
// the app (so a newer deployed build can be detected and reloaded) and to version
// the service-worker cache.
function gitInfo(): { commit: string; short: string } {
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    return { commit, short: commit.slice(0, 7) };
  } catch {
    return { commit: 'unknown', short: 'unknown' };
  }
}
const g = gitInfo();

// Inject the commit into the built index.html so the running app can detect a
// newly deployed version (by comparing the meta tag) and reload.
function injectVersionMeta(): Plugin {
  return {
    name: 'dsh-version-meta',
    transformIndexHtml(html) {
      return html.replace(
        '<title>',
        `<meta name="app-version" content="${g.commit}" />\n    <title>`,
      );
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  // `@corpus` is the repository's one corpus (`assets/` at the root) AND the one FSM asset, named once in
  // `vite.corpus.ts`. The alias is not a convenience here: a relative path's `../` count is exactly what broke
  // the game's corpus glob (§8 trap 26), and a glob that misses compiles to `{}` in silence.
  resolve: { alias: [...corpusAlias] },
  server: {
    port: 5174,
    open: false,
    // The alias resolves to a directory ABOVE this app's root, so Vite has to be allowed to serve it.
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
  },
  plugins: [injectVersionMeta()],
});
