// Emit the REAL FSM view document to a file, so it can be opened in an actual browser.
//
// Stage 2's view change was verified only as a STRING (`fsm-open-probe.mjs` regexes the emitted HTML and
// parses the `nodedata` blob). That cannot tell a document that RENDERS the transient list from one whose
// script throws before it builds the sidebar. This writes the document the app would frame, using the
// shipped asset, so a real browser can be the judge.
//
// `--probe` derives a SECOND document: the same bytes plus one appended `<script>` that selects the first
// node carrying a transient. This environment's browser tool cannot run page JavaScript (evaluate is
// disabled) and the SVG nodes are not in the accessibility tree, so a node cannot be clicked from outside
// — and the sidebar's `showNode` is the branch under test. Appending to the emitted document exercises the
// REAL `showNode` rather than a copy of it, and the file is a harness, never shipped.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'assets');
const { renderFsmHtml } = await import('./../src/fsm-view.ts');

const fsm = JSON.parse(readFileSync(path.join(assets, 'fsm-ms.json'), 'utf8'));
const html = renderFsmHtml({ states: fsm.table.states, edges: fsm.table.edges }, 'FSM · ms', 'ms');
const out = path.join(here, '_fsm-view.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB, ${fsm.table.states.length} states)`);

if (process.argv.includes('--probe')) {
  // `select` and `showNode` are top-level declarations of the document's own classic script, so a later
  // script in the same document can call them - that is the whole reason this works without touching the
  // product code.
  //
  // THE SMALLEST NODE WITH A TRANSIENT, deliberately. `Static Square` has 94 calls and 57 incoming, and a
  // snapshot of its panel truncates before it reaches the section under test - the harness must pick the
  // node that makes the thing it is testing VISIBLE, not the first one that happens to qualify.
  const probe = html.replace(
    '</body>',
    `<script>
addEventListener('load', () => {
  const d = JSON.parse(document.getElementById('nodedata').textContent);
  const withLeaves = d.filter((n) => (n.leaves || []).length > 0);
  const pick = withLeaves.slice().sort((a, b) => a.calls.length - b.calls.length || a.name.localeCompare(b.name))[0];
  const i = d.indexOf(pick);
  window.__probe = { smallestWithLeaves: pick.name };
  // DIAGNOSTICS IN THE TITLE, because this environment cannot run page JavaScript on demand
  // (browser_evaluate is disabled), so the document has to report its own geometry.
  //
  // SAMPLED TWICE, AND THE SECOND SAMPLE IS THE ONE THAT MATTERS. The document has a PRERENDER (baked
  // transforms) and a LIVE SIMULATION that reflows on requestAnimationFrame - and the simulation used to
  // start only from a node pointerdown. A reading taken synchronously on load measures the PRERENDER, which
  // is the blob; that is exactly the mistake an earlier version of this probe made and reported as "the
  // layout is collapsed". The delayed reading is the layout the reader actually ends up with.
  const spread = (pts) => {
    const n = pts.length;
    const nn = pts.map((p, i) => Math.min(...pts.filter((_, j) => j !== i).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))).sort((a, b) => a - b);
    const cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
    const rad = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)).sort((a, b) => a - b);
    return { medianNN: +nn[Math.floor(n / 2)].toFixed(1), overlapping: nn.filter((x) => x < 40).length,
      middle90PctOfFrame: +(((rad[Math.floor(0.95 * n)] * 2) / 1800 * 100)).toFixed(0), maxRadius: Math.round(rad[n - 1]) };
  };
  const readPos = () => [...document.querySelectorAll('.node')].map((g) => {
    const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform') || '');
    return m ? [+m[1], +m[2]] : [0, 0];
  });
  try {
    const baked = JSON.parse(document.getElementById('topo').textContent);
    const report = { baked: spread(baked), autoSelected: document.querySelector('.node .nd[stroke="#111"]') !== null,
      sidebar: (document.getElementById('nodedisp').textContent || '').slice(0, 60) };
    document.title = 'loading ' + JSON.stringify(report);
    setTimeout(() => {
      const settled = spread(readPos());
      document.title = JSON.stringify({ ...report, settled });
    }, 1500);
  } catch (e) { document.title = 'probe failed: ' + e.message; }
});
</script></body>`,
  );
  const probeOut = path.join(here, '_fsm-view-probe.html');
  writeFileSync(probeOut, probe);
  console.log(`wrote ${probeOut} (the same document plus one auto-select script)`);
}
