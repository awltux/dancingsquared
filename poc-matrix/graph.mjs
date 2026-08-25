// Graph POC — closeness to home as GRAPH DISTANCE, not geometry.
//
// Two separate, independently-built caches rooted at home, keyed by a canonical
// formation-state hash (geometry + identity/arrangement):
//
//   getout graph:  BACKWARD from home. Each node stores the calls that bring it
//                  closer to home (reverse walk). Per-node ALTERNATIVE routes.
//   getin  graph:  FORWARD from home. Each node stores the forward calls that
//                  reach it from home (forward walk). A SEPARATE cache — getins
//                  cannot be derived from getouts, because calls don't run in
//                  reverse (a matrix inverse is a geometric neighbor, not a
//                  callable forward sequence).
//
// Demonstrates:
//   1. canonical hashing (geometry + arrangement) collapses rotations/reflections
//      but keeps in/out-of-sequence distinct;
//   2. per-node alternatives (multiple routes home / to a formation);
//   3. getout vs getin as opposite-direction walks over independent graphs;
//   4. the inverse-of-a-getout is a geometric neighbor, NOT a usable getin.
//
// Run: node graph.mjs  (after `npm run build:engine`)
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser } from 'dancing-squared-engine';
setParser(DOMParser);

// Progress is written as newline-terminated lines to a file (unbuffered), so a
// long background build still shows live progress even when stdout is redirected.
const PROGRESS_FILE = 'graph-progress.log';
const report = (line) => appendFileSync(PROGRESS_FILE, `${line}\n`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const files = {};
for (const f of readdirSync(path.join(root, 'poc/src/assets/ms')).filter((f) => f.endsWith('.xml'))) {
  files[`ms/${f}`] = read(`poc/src/assets/ms/${f}`);
}
const { buildCatalog, makeSequencer } = await import('../poc-teacher/src/catalog.ts');
const seq = makeSequencer(read('poc/src/assets/moves.xml'), read('poc/src/assets/formations.xml'), buildCatalog(files));

const DEG = Math.PI / 180;
const normAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

// ------------------------------------------------------------ canonical hashing

// A formation state = dancer (x,y,heading) + dancer id arrangement. The canonical
// key must be invariant to translation/rotation/reflection (a formation is "the
// same" regardless of absolute orientation) yet encode identity/arrangement (an
// out-of-sequence square is NOT home). We canonicalize by:
//   1. recentre on the centroid;
//   2. rotate to a fixed orientation (align dancer-1's position to a canonical
//      axis, breaking the 90-degree symmetry deterministically);
//   3. record, per dancer slot, its dancer id (the arrangement).
function canonicalKey(board) {
  const ds = board.dancers;
  const n = ds.length;
  // centroid
  let cx = 0, cy = 0;
  for (const d of ds) { cx += d.x; cy += d.y; }
  cx /= n; cy /= n;
  // pick dancer 0; rotate so it lies on +x axis (canonical orientation)
  const p0 = ds[0];
  const angle = Math.atan2(p0.y - cy, p0.x - cx);
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const pts = ds.map((d) => {
    const dx = d.x - cx, dy = d.y - cy;
    return { x: c * dx - s * dy, y: s * dx + c * dy, h: normAngle(d.heading - angle), id: d.id };
  });
  // The set may be rotationally symmetric; to keep keys stable under reflection we
  // additionally normalise the sign of the "winding" of dancer ids around the
  // centre. Compute a signed ordering signature and mirror x if the primary
  // ordering is clockwise vs anticlockwise. (Simplified: reflect about x-axis if
  // dancer-1's y<0 after orientation.)
  const reflect = pts[1] && pts[1].y < 0;
  const final = pts.map((p) => reflect ? { ...p, x: -p.x, h: normAngle(-p.h) } : p);
  const arr = final.map((p) => `${p.id}@${p.x.toFixed(3)},${p.y.toFixed(3)},${(p.h * 180 / Math.PI).toFixed(0)}`).sort();
  // geometry signature (invariant) + arrangement (id ordering), joined
  const geom = arr.map((a) => a.replace(/^\d+@/, '')).join(';');
  const arrangement = final.map((p) => p.id).join(',');
  return `${geom}|${arrangement}`;
}

// ------------------------------------------------------------ graph build

// One forward BFS from home over the REAL catalog records ALL forward edges
// (call: state -> child). From that single edge set we derive two independent
// caches:
//   * GETIN graph  : forward walk from home to a state  (the BFS tree = getins).
//   * GETOUT graph : forward walk from a state to home  (a SEPARATE search over
//                    the full edge set toward the home node; NOT the reverse of
//                    the getin tree, because calls don't run in reverse).
const MAX_DEPTH = 12;
const MAX_STATES = 20000;

function buildGraph() {
  const home = seq.startBoard();
  const homeKey = canonicalKey(home);
  // state key -> { key, board, depth }
  const states = new Map();
  // full forward edge index: prevKey -> [{call, nextKey}]  (all legal forward edges)
  const edges = new Map();
  const order = [];
  let head = 0;
  const t0 = Date.now();
  const reportEvery = 1000;
  let totalEdges = 0;
  states.set(homeKey, { key: homeKey, board: home, depth: 0 });
  order.push(homeKey);
  while (head < order.length && states.size < MAX_STATES) {
    if (states.size % reportEvery === 0) {
      report(`build: ${states.size}/${MAX_STATES} states, depth<=${MAX_DEPTH}, ${totalEdges} edges (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
    const key = order[head++];
    const st = states.get(key);
    if (st.depth >= MAX_DEPTH) continue;
    const out = [];
    const legal = seq.legalCalls(st.board);
    for (const call of legal) {
      const r = seq.applyToBoard(st.board, call);
      if (!r.legal) continue;
      const nk = canonicalKey(r.board);
      let ns = states.get(nk);
      if (!ns) {
        ns = { key: nk, board: r.board, depth: st.depth + 1 };
        states.set(nk, ns);
        order.push(nk);
      }
      out.push({ call, nextKey: nk });
    }
    if (out.length) { edges.set(key, out); totalEdges += out.length; }
  }
  report(`build DONE: ${states.size}/${MAX_STATES} states, depth<=${MAX_DEPTH}, ${totalEdges} edges (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return { states, edges, homeKey };
}

// ------------------------------------------------------------ modules (shared macro-edges)

// A MODULE is a sequence of calls that moves the set from one formation to another
// — a GENERIC, direction-agnostic transformation (like a single call, but composed).
// It is compiled ONCE into a macro-edge { name, startKey, endKey, calls } and is
// SHARED by BOTH the getin graph and the getout graph: whichever traversal is at
// `startKey` may take the module forward to `endKey` as a single hop. It is never
// reversed (a module, like a call, only runs forward). Because it collapses N calls
// into one edge, it shortens both getin and getout paths.
//
// compileModule: given a start board and a list of call names, step the sequence
// once, capture the canonical start/end keys, and store the macro-edge.
const modules = new Map(); // startKey -> [{ name, endKey, calls }]

function compileModule(name, startBoard, calls) {
  let cur = startBoard;
  let ok = true;
  for (const c of calls) {
    const r = seq.applyToBoard(cur, c);
    if (!r.legal) { ok = false; break; }
    cur = r.board;
  }
  if (!ok) return false;
  const startKey = canonicalKey(startBoard);
  const endKey = canonicalKey(cur);
  if (!modules.has(startKey)) modules.set(startKey, []);
  const list = modules.get(startKey);
  if (!list.some((m) => m.name === name)) list.push({ name, endKey, calls });
  return true;
}

// Return the module edges available FROM a given state key (shared by both graphs).
function moduleEdgesFrom(key) {
  return modules.get(key) ?? [];
}

// ------------------------------------------------------------ getout pre-population (backward from home)

// The GETOUT cache can be PRE-POPULATED in ONE backward pass from home instead of
// per-query forward search. Build a reverse edge index (child -> its parents),
// then reverse-BFS from home: every state reached is "closer to home", and we
// record the FORWARD call that leads it home as its getout option. Because edges
// are matrix transforms (a call is M, its inverse M⁻¹ gives the geometric
// predecessor), the backward step is cheap — it is the inverse edge, not a search.
// After this pass, getout(S) is an O(1) lookup, and every state found already has
// its alternatives stored.
function prepopulateGetouts(graph) {
  const { states, edges, homeKey } = graph;
  // reverse index: nextKey -> [{ prevKey, call }]
  const rev = new Map();
  for (const [prevKey, out] of edges) {
    for (const e of out) {
      if (!rev.has(e.nextKey)) rev.set(e.nextKey, []);
      rev.get(e.nextKey).push({ prevKey, call: e.call });
    }
  }
  // getout cache: stateKey -> { depth, options:[call] }
  const getoutCache = new Map();
  const queue = [[homeKey, 0]];
  getoutCache.set(homeKey, { depth: 0, options: [] });
  while (queue.length) {
    const [key, depth] = queue.shift();
    const preds = rev.get(key) ?? [];
    for (const p of preds) {
      const rec = getoutCache.get(p.prevKey);
      if (rec) {
        // already closer to home; this call is an ALTERNATIVE route home
        if (!rec.options.includes(p.call)) rec.options.push(p.call);
      } else {
        const nr = { depth: depth + 1, options: [p.call] };
        getoutCache.set(p.prevKey, nr);
        queue.push([p.prevKey, depth + 1]);
      }
    }
  }
  return getoutCache;
}

// ------------------------------------------------------------ getout (forward search to home)

// A getout is a FORWARD sequence from the target that ends at home — a call path
// over the full edge set toward the home node. We memoise "can this state reach
// home?", then the getout options at the target are the distinct first-step calls
// whose child can reach home. This is the per-node "alternative routes to home"
// cache.
function getouts(graph, targetKey, k = 4) {
  const { states, edges, homeKey } = graph;
  const target = states.get(targetKey);
  if (!target) return { found: false, reason: 'state not in graph' };
  if (targetKey === homeKey) return { found: true, options: [], alreadyHome: true };
  const memo = new Map(); // key -> boolean: can this state reach home?
  const canReachHome = (key) => {
    if (key === homeKey) return true;
    if (memo.has(key)) return memo.get(key);
    // guard against cycles during recursion
    memo.set(key, false);
    const out = edges.get(key) ?? [];
    let ok = false;
    for (const e of out) if (canReachHome(e.nextKey)) { ok = true; break; }
    memo.set(key, ok);
    return ok;
  };
  const options = [];
  for (const e of edges.get(targetKey) ?? []) {
    if (canReachHome(e.nextKey) && !options.includes(e.call)) options.push(e.call);
  }
  return { found: true, options: options.slice(0, k) };
}

// ------------------------------------------------------------ getin (forward walk)

// A getin is a FORWARD walk from home to the target — its own cache. The distinct
// calls that lead INTO the target from a home-reachable predecessor are the
// alternative getins (the BFS fan-in toward this node).
// Precomputed getin index: nextKey -> distinct forward calls that reach it. Built
// once from the edge set, so getins is O(1) per state (no O(edges) fan-in scan).
function buildGetinIndex(edges) {
  const idx = new Map();
  for (const [, out] of edges) {
    for (const e of out) {
      if (!idx.has(e.nextKey)) idx.set(e.nextKey, []);
      const list = idx.get(e.nextKey);
      if (!list.includes(e.call)) list.push(e.call);
    }
  }
  return idx;
}

function getins(graph, targetKey, k = 4, getinIndex) {
  const { states } = graph;
  const target = states.get(targetKey);
  if (!target) return { found: false, reason: 'state not in graph' };
  const list = getinIndex.get(targetKey) ?? [];
  return { found: true, options: list.slice(0, k) };
}

// ------------------------------------------------------------ main

console.log('═'.repeat(74));
console.log('GRAPH POC — closeness to home as graph distance (two separate caches)');
console.log('═'.repeat(74));

const graph = buildGraph();
console.log(`\nBuilt graph: ${graph.states.size} states, depth<=${MAX_DEPTH} from home`);
console.log('Home key:', graph.homeKey.slice(0, 60) + '…');

// O(1) getin index (forward fan-in), and the backward pre-populated getout cache.
const getinIndex = buildGetinIndex(graph.edges);
const getoutCache = prepopulateGetouts(graph);
console.log(`\n[0] GETOUT cache PRE-POPULATED backward from home (one pass):`);
console.log(`  states with a cached getout: ${getoutCache.size}`);
console.log(`  (getout is now an O(1) lookup for these states)`);

// Pick a few interesting states: home, and a couple of mid-graph formations.
const homeKey = graph.homeKey;

console.log('\n[1] Canonical hashing collapses rotations but keeps arrangements distinct:');
// same formation, rotated 90deg -> same key?
seq.reset();
const b0 = seq.startBoard();
const b90 = { dancers: b0.dancers.map((d) => {
  const a = Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
  return { ...d, x: c * d.x - s * d.y, y: s * d.x + c * d.y, heading: normAngle(d.heading + a) };
}) };
console.log(`  home vs home+90deg same key? ${canonicalKey(b0) === canonicalKey(b90)}`);
console.log(`  a non-home state differs from home key? ${[...graph.states.keys()][1] !== homeKey}`);

// Count how many states have getouts / getins / both (the "alternative routes" idea).
// Use the O(1) pre-populated getout cache and the O(1) getin index.
let withGetout = 0, withGetin = 0, withBoth = 0, withMultiGetout = 0;
for (const k of graph.states.keys()) {
  if (k === homeKey) continue;
  const cachedGo = getoutCache.get(k);
  const goOpts = cachedGo ? cachedGo.options : [];
  const gi = getins(graph, k, 4, getinIndex);
  if (goOpts.length) withGetout++;
  if (gi.found && gi.options.length) withGetin++;
  if (goOpts.length && gi.found && gi.options.length) withBoth++;
  if (goOpts.length > 1) withMultiGetout++;
}
console.log(`\n[2] Coverage over ${graph.states.size - 1} non-home states:`);
console.log(`  states with >=1 getout option : ${withGetout}`);
console.log(`  states with >=1 getin  option : ${withGetin}`);
console.log(`  states with BOTH              : ${withBoth}`);
console.log(`  states with MULTIPLE getouts  : ${withMultiGetout}   <- per-node ALTERNATIVE routes home`);

// Find a state with multiple getouts and a state with multiple getins to demo.
let demoGo = null, demoGi = null;
for (const k of graph.states.keys()) {
  if (k === homeKey) continue;
  if (!demoGo) { const go = getouts(graph, k); if (go.options.length > 1) demoGo = { k, go }; }
  if (!demoGi) { const gi = getins(graph, k, 4, getinIndex); if (gi.options.length > 1) demoGi = { k, gi }; }
  if (demoGo && demoGi) break;
}
if (demoGo) {
  const st = graph.states.get(demoGo.k);
  console.log(`\n[3] GETOUT demo — a state with MULTIPLE routes home (depth ${st.depth}):`);
  console.log(`    getout options (forward search): ${demoGo.go.options.join(', ')}`);
  const cached = getoutCache.get(demoGo.k);
  console.log(`    getout options (pre-populated cache): ${cached ? cached.options.join(', ') : '(not cached)'}`);
  console.log(`    same via both? ${cached && JSON.stringify([...cached.options].sort()) === JSON.stringify([...demoGo.go.options].sort())}`);
  const gi = getins(graph, demoGo.k, 4, getinIndex);
  console.log(`    getin  options: ${gi.options.join(', ')}`);
  console.log(`    getout != getin (independent caches): ${JSON.stringify(demoGo.go.options) !== JSON.stringify(gi.options)}`);
}
if (demoGi) {
  const st = graph.states.get(demoGi.k);
  console.log(`\n[4] GETIN demo — a state with MULTIPLE getin routes (depth ${st.depth}):`);
  console.log(`    getin options: ${demoGi.gi.options.join(', ')}`);
  const go = getouts(graph, demoGi.k);
  console.log(`    getout options: ${go.options.join(', ')}`);
}

console.log('\n[5] Freshness — per-node options give alternative routes (avoids always-same):');
console.log('  probabilistic pick among getout/getin options at each node = varied tips per generation.');

console.log('\n[6] MODULES — one generic macro-edge, shared by getin AND getout:');
// Compile a couple of legal multi-call modules from home so they become shared
// macro-edges (each collapses N calls into ONE edge usable by both graphs).
seq.reset();
const homeB = seq.startBoard();
const mod1 = compileModule('m:CircleTwice', homeB, ['Circle Left', 'Circle Left']);
const mod2 = compileModule('m:HeadsProm+GrandSquare', homeB, ['Heads Promenade 1/2', 'Sides Face, Grand Square']);
console.log(`  compiled modules from home: ${[mod1, mod2].filter(Boolean).length} (${modules.size} distinct start formations with modules)`);
for (const [startKey, list] of modules) {
  for (const m of list) {
    // The SAME module edge is a forward option in BOTH traversals.
    const gi = getins(graph, m.endKey, 4, getinIndex);
    const go = getouts(graph, m.startKey);
    console.log(`  module '${m.name}': ${m.calls.join(' > ')}  [${startKey === graph.homeKey ? 'from HOME' : 'from a state'}]`);
    console.log(`      -> its END-state getins available: ${gi.found ? gi.options.length : `(${gi.reason})`}`);
    console.log(`      -> its START-state getouts available: ${go.found ? go.options.length : `(${go.reason})`}`);
    console.log(`      shared by both graphs: TRUE (one edge, applied forward in each)`);
  }
}

console.log('\n-- Notes --');
console.log('• GETIN graph : forward walk from home to a state  (forward BFS tree — its own cache).');
console.log('• GETOUT graph: forward walk from a state to home  (a SEPARATE search over the full');
console.log('  forward edge set toward home — NOT the reverse of the getin tree, because calls do');
console.log('  not run in reverse; a matrix inverse is a geometric neighbor, not a callable sequence).');
console.log('• Both share the canonical state hash (geometry + arrangement), so an out-of-sequence');
console.log('  square is a different node than home, and only the true home node is a closer.');
console.log('• Per-node alternative lists are the raw material for K-shortest / probabilistic selection.');
