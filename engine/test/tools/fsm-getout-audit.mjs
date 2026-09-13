// PHASE B ANALYSIS TOOL (not a harness): the FSM's "no getout" nodes, and whether anything can
// falsify them.
//
// The view labels every node with one of four statuses. Two of them are claims that a formation is a
// DEAD END: `dead` (no call at all from here) and `nohome` (calls exist, but no route back to Static
// Square). Both are computed purely from the table's edges, so they are statements about OUR EDGE
// SET, not about square dancing - and that is exactly what the All8 material can test:
//
//   (a) HARD: a `dead` node visited in the middle of a figure CONTRADICTS the table, because the
//       figure's next call is an edge from that very board.
//   (b) HARD: the figures that run end-to-end prove every formation on their path has a route home
//       IN OUR OWN GRAPH - the rest of the figure IS that route. So a `nohome` node on such a path
//       is a genuine bug (a missing edge, or a broken reachability computation).
//   (c) SOFT: a `nohome` node visited by a figure that does NOT run is not proof - but it is a
//       published get-out through that formation, so it is strong evidence the label is too strong.
//   (d) INDEPENDENT: the engine's own get-out SEARCH from that state's board is a second opinion
//       that does not go through the table's edge set at all.
//
// NOTE ON THE FIGURE COUNT THIS PRINTS. The walk here asks `knownFormation` after every call, and
// that is the convention that runs 20 of 188 figures - NOT the 8 that `tools/figure-census.mjs` and
// the target suite report. That difference is Phase 10 in PLAN.md, and a reader comparing the two
// numbers has to know which convention produced them.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { ALL8_FIGURE_START } from '../lib/all8-figures.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const HOME = 'Static Square';

// ---------------------------------------------------------------- the table, exactly as the view uses it
const blob = JSON.parse(readFileSync(path.join(here, '..', '..', '..', 'poc', 'src', 'assets', 'fsm-ms.json'), 'utf8'));
const states = blob.table.states;
const edges = blob.table.edges;
const idx = new Map(states.map((s, i) => [s, i]));
const graph = states.map(() => []);
const outgoing = states.map(() => 0);
for (let i = 0; i < states.length; i++) {
  for (const e of edges[states[i]] ?? []) {
    if (e.endFormation == null) continue;
    const t = idx.get(e.endFormation);
    if (t !== undefined) { graph[i].push(t); outgoing[i]++; }
  }
}
const canHome = new Set([idx.get(HOME)]);
{
  const q = [idx.get(HOME)];
  while (q.length) {
    const cur = q.pop();
    for (let i = 0; i < states.length; i++) if (!canHome.has(i) && graph[i].includes(cur)) { canHome.add(i); q.push(i); }
  }
}
const statusOf = (s) => {
  const i = idx.get(s);
  if (i === undefined) return 'not a state';
  if (s === HOME) return 'home';
  if (outgoing[i] === 0) return 'dead';
  return canHome.has(i) ? 'ok' : 'nohome';
};
const dead = states.filter((s) => statusOf(s) === 'dead');
const nohome = states.filter((s) => statusOf(s) === 'nohome');
console.log(`=== the FSM's own verdicts (asset built ${blob.builtAt}) ===`);
console.log(`  ${states.length} states: ${states.filter((s) => statusOf(s) === 'ok').length} route home, ` +
  `${nohome.length} NO route home, ${dead.length} dead (no call at all)`);
console.log(`  nohome: ${nohome.join(', ') || '(none)'}`);
console.log(`  dead:   ${dead.join(', ') || '(none)'}`);

// ---------------------------------------------------------------- (a)+(b)+(c) against the figures
const data = loadAll8Figures();
const start = seq.boardForFormation(ALL8_FIGURE_START);
const visit = new Map(); // state -> { figures: [], completedAfter: [] }
let completed = 0;
const hardDead = [];
const hardNohome = [];
const softNohome = new Map();
const finishedIds = [];
for (const f of data.figures) {
  const calls = figureEngineCalls(f);
  let board = start;
  const path = [seq.knownFormation(start)];
  const visited = [];
  let finished = true;
  for (const c of calls) {
    const r = seq.applyToBoard(board, c);
    if (!r.legal) { finished = false; break; }
    board = r.board;
    const name = seq.knownFormation(board);
    path.push(name);
    if (name) visited.push(name);
  }
  if (finished) { completed++; finishedIds.push(f.id); }
  for (const name of visited) {
    if (!visit.has(name)) visit.set(name, { figures: [], completedAfter: [] });
    const v = visit.get(name);
    v.figures.push(f.id);
    if (finished) v.completedAfter.push(f.id);
  }
  // (a) a dead node on the path of a figure that continued past it
  for (let i = 0; i < path.length - 1; i++) {
    const name = path[i];
    if (!name) continue;
    if (statusOf(name) === 'dead') hardDead.push({ figure: f.id, state: name, next: path[i + 1] });
    if (finished && statusOf(name) === 'nohome') hardNohome.push({ figure: f.id, state: name });
  }
  // (c) soft: nohome states visited by figures that stop
  if (!finished) {
    for (const name of new Set(visited)) if (statusOf(name) === 'nohome') softNohome.set(name, (softNohome.get(name) ?? 0) + 1);
  }
}
console.log(`\n=== the figures as an oracle (${completed} of ${data.figures.length} run end-to-end) ===`);
console.log(`  ids: ${finishedIds.join(' ')}`);
console.log(`  (a) DEAD states a figure walked straight through: ${hardDead.length}`);
for (const h of hardDead.slice(0, 15)) console.log(`        ${h.figure} at "${h.state}" -> continued to "${h.next}"`);
console.log(`  (b) NOHOME states on a path that REACHES HOME in our own graph: ${hardNohome.length}`);
const hardNohomeStates = new Set(hardNohome.map((h) => h.state));
for (const s of hardNohomeStates) console.log(`        "${s}"  (figures ${hardNohome.filter((h) => h.state === s).map((h) => h.figure).join(', ')})`);
console.log(`  (c) NOHOME states a stopping figure passed through (evidence, not proof): ${softNohome.size}`);
for (const [s, n] of [...softNohome.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`        ${String(n).padStart(3)}x  ${s}`);
}

// ---------------------------------------------------------------- (d) the engine's own search
console.log(`\n=== (d) does the engine's own get-out SEARCH find a route from those states? ===`);
const suspect = [...new Set([...nohome, ...dead])];
let t0 = Date.now();
for (const s of suspect) {
  const b = seq.boardForFormation(s);
  if (!b) { console.log(`  ${s.padEnd(34)} (no board: not a buildable formation)`); continue; }
  seq.setBoard(b);
  const got = seq.getout({ maxCalls: 3, budget: 260 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ${s.padEnd(34)} search -> ${got ? `FOUND ${got.length} calls: ${got.join(' / ')}` : 'none within maxCalls=3'}${got ? '   <-- CONTRADICTS "no getout"' : ''}  [${secs}s]`);
  t0 = Date.now();
}


