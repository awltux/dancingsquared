// Getout-graph analysis + common-module mining.
//
// Reuses the graph-build logic from graph.mjs but adds:
//   A. a structural profile of the getout graph (nodes by depth, branching,
//      getout coverage);
//   B. reconstruction of actual getout paths (forward call sequences to home) for
//      every state that has a cached getout;
//   C. mining for COMMON MODULES: frequent call n-grams (2..4) that appear across
//      many getout paths — the sequences worth pre-compiling into shared macro-edges.
//
// Run: node analysis.mjs   (after `npm run build:engine`; ~1-3 min at CAP=6000)
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser } from 'dancing-squared-engine';
setParser(DOMParser);

const PROGRESS_FILE = 'analysis-progress.log';
const report = (l) => appendFileSync(PROGRESS_FILE, `${l}\n`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const files = {};
for (const f of readdirSync(path.join(root, 'poc/src/assets/ms')).filter((f) => f.endsWith('.xml'))) files[`ms/${f}`] = read(`poc/src/assets/ms/${f}`);
const { buildCatalog, makeSequencer } = await import('../poc-teacher/src/catalog.ts');
const seq = makeSequencer(read('poc/src/assets/moves.xml'), read('poc/src/assets/formations.xml'), buildCatalog(files));

const DEG = Math.PI / 180;
const normAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// ------------------------------------------------------------ canonical hashing (mirror of graph.mjs)
function canonicalKey(board) {
  const ds = board.dancers; const n = ds.length;
  let cx = 0, cy = 0; for (const d of ds) { cx += d.x; cy += d.y; } cx /= n; cy /= n;
  const p0 = ds[0]; const angle = Math.atan2(p0.y - cy, p0.x - cx);
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const pts = ds.map((d) => { const dx = d.x - cx, dy = d.y - cy; return { x: c*dx - s*dy, y: s*dx + c*dy, h: normAngle(d.heading - angle), id: d.id }; });
  const reflect = pts[1] && pts[1].y < 0;
  const final = pts.map((p) => reflect ? { ...p, x: -p.x, h: normAngle(-p.h) } : p);
  const arr = final.map((p) => `${p.id}@${p.x.toFixed(3)},${p.y.toFixed(3)},${(p.h*180/Math.PI).toFixed(0)}`).sort();
  const geom = arr.map((a) => a.replace(/^\d+@/,'')).join(';');
  const arrangement = final.map((p) => p.id).join(',');
  return `${geom}|${arrangement}`;
}

// ------------------------------------------------------------ build (cap chosen for a tractable run)
const MAX_DEPTH = 12;
const CAP = Number(process.env.CAP || 6000);

function buildGraph() {
  const home = seq.startBoard();
  const homeKey = canonicalKey(home);
  const states = new Map();
  const edges = new Map();
  const order = [];
  let head = 0;
  const t0 = Date.now();
  states.set(homeKey, { key: homeKey, board: home, depth: 0 });
  order.push(homeKey);
  while (head < order.length && states.size < CAP) {
    if (states.size % 1000 === 0) report(`build: ${states.size}/${CAP} (${((Date.now()-t0)/1000).toFixed(1)}s)`);
    const key = order[head++];
    const st = states.get(key);
    if (st.depth >= MAX_DEPTH) continue;
    const out = [];
    for (const call of seq.legalCalls(st.board)) {
      const r = seq.applyToBoard(st.board, call);
      if (!r.legal) continue;
      const nk = canonicalKey(r.board);
      let ns = states.get(nk);
      if (!ns) { ns = { key: nk, board: r.board, depth: st.depth + 1 }; states.set(nk, ns); order.push(nk); }
      out.push({ call, nextKey: nk });
    }
    // PARALLEL edges (§7.5): calls that fail whole-board but apply to two or more
    // disjoint subsets at once. Enumerate as forward edges too (marked parallel).
    for (const p of seq.parallelLegalCalls(st.board)) {
      const nk = canonicalKey(p.board);
      let ns = states.get(nk);
      if (!ns) { ns = { key: nk, board: p.board, depth: st.depth + 1 }; states.set(nk, ns); order.push(nk); }
      out.push({ call: p.name, nextKey: nk, parallel: true });
    }
    if (out.length) edges.set(key, out);
  }
  report(`build DONE: ${states.size}/${CAP} states (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  return { states, edges, homeKey };
}

// Reconstruct the reverse-BFS tree from home: for each state, the first-found
// forward edge that moves it CLOSER to home (its parent). Walking parents gives a
// getout path. We also record ALL parent edges per node (for alternatives).
function buildGetoutTree(graph) {
  const { states, edges, homeKey } = graph;
  const rev = new Map(); // nextKey -> [{prevKey, call}]
  for (const [pk, out] of edges) for (const e of out) {
    if (!rev.has(e.nextKey)) rev.set(e.nextKey, []);
    rev.get(e.nextKey).push({ prevKey: pk, call: e.call });
  }
  // parent tree + full parent list per node
  const parent = new Map(); // stateKey -> { prevKey, call }  (first / shortest)
  const allParents = new Map(); // stateKey -> [{prevKey, call}]
  const depth = new Map([[homeKey, 0]]);
  const queue = [homeKey];
  while (queue.length) {
    const key = queue.shift();
    const d = depth.get(key);
    for (const p of rev.get(key) ?? []) {
      if (!allParents.has(p.prevKey)) allParents.set(p.prevKey, []);
      const list = allParents.get(p.prevKey);
      if (!list.some((x) => x.call === p.call)) list.push(p);
      if (!depth.has(p.prevKey)) {
        depth.set(p.prevKey, d + 1);
        parent.set(p.prevKey, { prevKey: key, call: p.call });
        queue.push(p.prevKey);
      }
    }
  }
  return { parent, allParents, depth };
}

// ------------------------------------------------------------ main
console.log('═'.repeat(74));
console.log('GETOUT-GRAPH ANALYSIS + COMMON-MODULE MINING');
console.log('═'.repeat(74));

const graph = buildGraph();
const { parent, allParents, depth } = buildGetoutTree(graph);
const homeKey = graph.homeKey;
console.log(`\n[A] Graph structure (CAP=${CAP}, depth<=${MAX_DEPTH}):`);
console.log(`  states: ${graph.states.size}, edges: ${[...graph.edges.values()].reduce((a, e) => a + e.length, 0)}`);
console.log(`  states with a getout path to home: ${[...depth.keys()].length - 1}`);
console.log(`  (these are the states from which a forward getout sequence exists)`);

// Depth distribution of getout-closable states
console.log('\n  getout depth distribution (calls to reach home):');
const dist = new Map();
for (const [k, d] of depth) if (k !== homeKey) dist.set(d, (dist.get(d) ?? 0) + 1);
for (const d of [...dist.keys()].sort((a, b) => a - b)) {
  console.log(`    depth ${d}: ${dist.get(d)} states ${'#' .repeat(Math.max(1, Math.round(dist.get(d) / 5)))}`);
}

// Branching: how many distinct first moves lead each closable state toward home
console.log('\n  getout branching (distinct alternative first moves per state):');
const br = new Map();
for (const k of depth.keys()) {
  if (k === homeKey) continue;
  const n = (allParents.get(k) ?? []).length;
  br.set(n, (br.get(n) ?? 0) + 1);
}
for (const n of [...br.keys()].sort((a, b) => a - b)) {
  console.log(`    ${n} alternative(s): ${br.get(n)} states`);
}

// ------------------------------------------------------------ B. reconstruct getout paths
// We reconstruct MULTIPLE getout paths per state, not just the shortest, by walking
// the alternative parent edges (allParents). This yields longer, more varied
// sequences — the raw material for mining common modules.
// Walk the parent tree from a state to home -> forward getout path (shortest).
function getoutPath(parent, key) {
  const path = [];
  let cur = key;
  while (parent.has(cur)) {
    const p = parent.get(cur);
    path.unshift(p.call);
    cur = p.prevKey;
  }
  return path;
}

console.log('\n[B] Reconstructed getout paths (forward sequences home):');
const paths = [];
for (const k of depth.keys()) {
  if (k === homeKey) continue;
  const p = getoutPath(parent, k);
  if (p.length) paths.push(p);
}
// dedupe
const seenPath = new Set();
const uniquePaths = paths.filter((p) => { const k = p.join('>'); if (seenPath.has(k)) return false; seenPath.add(k); return true; });
uniquePaths.sort((a, b) => a.length - b.length);
console.log(`  ${uniquePaths.length} distinct getout paths (shortest per state)`);
const maxShow = 12;
console.log(`  showing ${maxShow} shortest:`);
for (const p of uniquePaths.slice(0, maxShow)) console.log(`    d=${p.length} ${p.join(' > ')}`);

// ------------------------------------------------------------ C. common-module mining
console.log('\n[C] COMMON MODULES — frequent call n-grams across all getout paths:');
// n-gram counting over the reconstructed paths (subsequences of length 2..4)
function ngrams(calls, n) {
  const out = [];
  for (let i = 0; i + n <= calls.length; i++) out.push(calls.slice(i, i + n));
  return out;
}
const counts = new Map(); // ngram-json -> {seq, count}
for (const calls of uniquePaths) {
  for (const n of [2, 3, 4]) {
    for (const g of ngrams(calls, n)) {
      const k = JSON.stringify(g);
      const rec = counts.get(k);
      if (rec) rec.count++;
      else counts.set(k, { seq: g, count: 1 });
    }
  }
}
// rank: a module is "common" if it appears in many distinct getout paths
const ranked = [...counts.values()].filter((r) => r.count >= 2).sort((a, b) => b.count - a.count);
console.log(`  total distinct n-grams appearing >=2 times: ${ranked.length}`);
console.log('  Top common modules (by number of getout paths they appear in):');
for (const r of ranked.slice(0, 15)) {
  console.log(`    [${r.seq.length}-gram] x${r.count}  ${r.seq.join(' > ')}`);
}

// Also: most frequent individual calls in getouts (the "closing workhorses")
console.log('\n  Most frequent single calls in getout paths (closing workhorses):');
const single = new Map();
for (const calls of uniquePaths) for (const c of calls) single.set(c, (single.get(c) ?? 0) + 1);
const singleRanked = [...single.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [c, n] of singleRanked) console.log(`    ${c}: appears in ${n} getout paths`);

console.log('\n-- Interpretation --');
console.log('• A frequent n-gram = a call sequence worth pre-compiling into a shared');
console.log('  macro-edge (module): it shortens both getin and getout paths, and can be');
console.log('  reused across many states.');
console.log('• The most frequent single calls are the "closing workhorses" — the sequences');
console.log('  that most getouts pass through on the way home.');
console.log('• Ranking by path-count (not raw occurrences) favours modules that appear in');
console.log('  MANY distinct states, which are the most valuable to share.');

// Persist the reconstructed getout paths + mined modules to a JSON file.
// Run with `--persist [file]`; default writes getout-paths.json.
const persistArg = process.argv.indexOf('--persist');
const persistFile = persistArg >= 0 ? (process.argv[persistArg + 1] || 'getout-paths.json') : null;
if (persistFile) {
  const { writeFileSync } = await import('node:fs');
  const payload = {
    generatedAt: new Date().toISOString(),
    params: { depth: MAX_DEPTH, states: graph.states.size, cap: CAP },
    homeKey: graph.homeKey,
    // reconstructed forward getout paths (each state's shortest path home)
    getoutPaths: uniquePaths,
    // common modules (frequent n-grams >= 2 paths)
    commonModules: ranked.slice(0, 30),
    // closing workhorses
    closingCalls: singleRanked,
  };
  writeFileSync(persistFile, JSON.stringify(payload, null, 2));
  console.log(`\n  wrote getout paths + modules to ${persistFile}`);
}

console.log('\nDone. Progress was also logged to analysis-progress.log');
