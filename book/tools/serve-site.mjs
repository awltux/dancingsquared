// Serve the built site locally, so the online edition can be opened over http rather than from the
// filesystem. Dependency-free, like the rest of the toolchain: node:http and a MIME lookup.
//
//   node book/tools/serve-site.mjs [--port 8099]
//
// Opening `book/dancingsquared_book/index.html` directly works too; a server is here because relative
// links behave slightly differently under `file:` in some browsers, and because a phone on the same
// network can read the book this way -- which is how a learner actually uses it at a dance.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolsDir } from './lib/load.mjs';

/** The build output directory. Must match the `SITE` constant in `build-site.mjs`. */
const SITE = join(toolsDir, '..', 'dancingsquared_book');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // JavaScript MUST be served as JavaScript. A browser refuses to execute an ES module whose
  // response has any other type, so `application/octet-stream` here meant the player would never
  // run -- and it failed silently, because the import simply does not happen.
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  // The manifest has its own registered type; some browsers ignore the manifest link otherwise,
  // which is the difference between an installable app and a bookmark.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function main() {
  const portArg = process.argv.indexOf('--port');
  const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 8099;

  if (!existsSync(SITE)) {
    console.error(`${SITE} does not exist. Run: node book/tools/build-site.mjs`);
    return 1;
  }

  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    // Normalise and re-anchor: a request must never escape the site directory.
    const target = join(SITE, normalize(rel).replace(/^(\.\.[\\/])+/, ''));
    if (!target.startsWith(SITE) || !existsSync(target) || statSync(target).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`not found: ${rel}\n`);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(readFileSync(target));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Dancing Squared — online edition: http://127.0.0.1:${port}/`);
    console.log('Ctrl+C to stop.');
  });
  return 0;
}

// `pathToFileURL` resolves a RELATIVE argv[1] against the working directory. Comparing
// `import.meta.url` to a hand-built `file://${argv[1]}` silently fails when the script is invoked
// by a relative path -- which is how a background job invokes it -- and the process then exits 0
// having done nothing at all.
// NOTE the absent `process.exit` on the success path. `server.listen()` is asynchronous, so
// `process.exit(main())` terminated the process before the listening callback ever ran: the server
// appeared to start and then exited 0 in silence. Only a FAILURE exits; success leaves the event
// loop alive, which is what keeps the server up.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = main();
  if (code !== 0) process.exit(code);
}
