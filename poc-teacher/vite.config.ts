import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';

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
  server: {
    port: 5174,
    open: false,
    // The catalog/moves/formations XML live under the sibling poc's src/assets;
    // allow serving them (and reading them via ?raw / import.meta.glob).
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
