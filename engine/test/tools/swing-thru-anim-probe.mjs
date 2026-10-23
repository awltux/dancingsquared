// TIER: none — one-shot diagnostic; nothing runs it. Recorded: engine/src/sequencer/swing-thru.ts.
// DIAGNOSE `Swing Thru` from `Ocean Waves` - the worst combination the usage-filtered survey found
// that real choreography actually uses (0.00 units between two dancers mid-call).
//
// `Swing Thru` is a CODED move, so its frames come from `SequenceAnalyzer.evaluateCodedAt`, which now
// routes EXCHANGING dancers around each other. Whether that applies here depends on the shape of the
// net position permutation, so this prints it rather than assuming.
//
// Usage: node engine/test/tools/swing-thru-anim-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}(${d.x.toFixed(2)},${d.y.toFixed(2)})@${Math.round((d.heading * 180) / Math.PI)}`)
  .join(' ');
const closest = (b) => {
  const ds = b.dancers;
  let m = Infinity, pair = null;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const g = Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y);
      if (g < m) { m = g; pair = [ds[i].id, ds[j].id]; }
    }
  }
  return { m, pair };
};

const CALL = 'Swing Thru';
for (const formation of ['Ocean Waves', 'Eight Chain Thru', 'Normal Lines', 'Static Square', 'Columns']) {
  const start = seq.boardForFormation(formation);
  if (!start) { console.log(`\n${formation}: no such formation`); continue; }
  const r = seq.applyToBoard(start, CALL);
  console.log(`\n=== ${CALL} from ${formation} ===`);
  if (!r.legal) { console.log(`  REFUSED: ${r.reason}`); continue; }
  console.log(`  start [${seq.knownFormation(start)}] ${pose(start)}`);
  console.log(`  end   [${seq.knownFormation(r.board)}] ${pose(r.board)}  end closest ${closest(r.board).m.toFixed(2)}`);

  // ---- the net position permutation, decomposed into cycles
  const starts = start.dancers;
  const map = new Map();
  for (const d of r.board.dancers) {
    const p = starts.find((s) => Math.hypot(s.x - d.x, s.y - d.y) < 0.35);
    if (p) map.set(p.id, d.id);
  }
  const seen = new Set();
  const cycles = [];
  for (const id of map.keys()) {
    if (seen.has(id)) continue;
    const cyc = [];
    let cur = id;
    while (cur !== undefined && !seen.has(cur)) { seen.add(cur); cyc.push(cur); cur = map.get(cur); }
    cycles.push(cyc);
  }
  console.log(`  permutation: ${cycles.map((c) => c.length).join('+')}   ${cycles.map((c) => '(' + c.join('->') + ')').join(' ')}`);

  // ---- the animation
  const total = seq.sequenceBeats([CALL], start);
  let worst = Infinity, worstBeat = 0, worstPair = null;
  for (let k = 0; k <= 60; k++) {
    const b = (total * k) / 60;
    const at = seq.evaluateSequence([CALL], b, start).board;
    const c = closest(at);
    if (c.m < worst) { worst = c.m; worstBeat = b; worstPair = c.pair; }
  }
  console.log(`  ${total.toFixed(1)} beats; closest pair during: ${worst.toFixed(3)} at beat ${worstBeat.toFixed(1)} (#${worstPair?.[0]}/#${worstPair?.[1]})`);
  console.log(`  at that beat: ${pose(seq.evaluateSequence([CALL], worstBeat, start).board)}`);

  // CONVERGENCE, the invariant the old straight-line blend existed to guarantee: the LAST animated
  // frame must BE the board the sequencer stores, or the dancers jump when the call completes. The
  // parts split the beats, so this is where an off-by-one in the leg boundaries would show up.
  const animatedEnd = seq.evaluateSequence([CALL], total, start).board;
  const appliedEnd = r.board;
  const byId = new Map(appliedEnd.dancers.map((d) => [d.id, d]));
  let gap = 0;
  for (const d of animatedEnd.dancers) {
    const a = byId.get(d.id);
    if (a) gap = Math.max(gap, Math.hypot(d.x - a.x, d.y - a.y));
  }
  console.log(`  last frame vs the APPLIED board: worst gap ${gap.toFixed(4)} units${gap > 1e-6 ? '   <-- FAIL' : ''}`);
}
