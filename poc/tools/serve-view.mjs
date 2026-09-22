// A local origin for the EMITTED FSM view document, and nothing else.
//
// WHY IT EXISTS. `renderFsmHtml` produces a self-contained document, which is what makes it checkable at
// all — but this environment's browser tool refuses `file://` URLs, so an http origin is the only way to
// put it in front of a real browser. `poc/tools/fsm-open-probe.mjs` can only regex the emitted STRING, and
// a document whose inline script throws before it builds the sidebar passes that and fails a browser.
//
// Loopback only, one file, no directory traversal: it serves `_fsm-view.html` from its own directory and
// answers 404 to everything else.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = { '/': '_fsm-view.html', '/_fsm-view.html': '_fsm-view.html', '/probe': '_fsm-view-probe.html', '/_fsm-view-probe.html': '_fsm-view-probe.html' };
const PORT = Number(process.argv[2] ?? 8791);

createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const name = DOCS[url];
  if (!name) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const file = path.join(here, name);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving the emitted FSM view from ${here}`);
  console.log(`  http://127.0.0.1:${PORT}/         the document the app frames`);
  console.log(`  http://127.0.0.1:${PORT}/probe    the same, plus an auto-select script (harness)`);
});
