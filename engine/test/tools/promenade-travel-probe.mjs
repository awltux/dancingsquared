// WHAT DOES THE CALL'S OWN TRAVEL DO TO THE ANIMATION? Measured over every board the coded ring
// move APPLIES to, because the corpus-wide collision scan cannot see this change.
//
// WHY THE CORPUS SCAN IS NOT THE INSTRUMENT HERE: of the 113 modules that carry a promenade step,
// only 4 animate one and all four are QUALIFIED CATALOGUE calls (`Heads Promenade 1/2`,
// `Sides Promenade 3/4`, `Heads Promenade 3/4`); the rest are Ceder prose that fails to parse, and
// the bare coded `Promenade` is reached by NO module. So `sequence-anim-collision-scan.mjs` returns
// identical numbers before and after this change, which is a fact about the probe and NOT evidence
// that the change is free. See `promenade-corpus-play-probe.mjs` for that measurement.
//
// The real surface of the coded ring move is the set of boards the call is LEGAL on - a caller can
// append `Promenade` to any of them - so this sweeps those, and reports the two numbers the corpus
// scan reports: the closest pair of dancers at any instant, and the largest move in one sample. It
// adds the one that matters for a ring, because that is the shape of the change: whether the FOUR
// COUPLES wheel together. A promenade that is a rigid rotation of the set cannot collide anyone; a
// promenade whose couples sweep by different angles can, and that is what the "non-rigid" count is.
//
// Usage: node engine/test/tools/promenade-travel-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { startBoardFor } from '../lib/all8-boards.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const closest = (b) => {
  const ds = b.dancers.filter((d) => !d.isGhost);
  let m = Infinity;
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  return m;
};

// Every named 8-dancer formation, deduplicated by board content - the same list `anim-convergence`
// sweeps, so "which boards is the call legal on" is answered by the library and not by me. Then
// every All8 get-out page's own start board, because that is where the corpus actually calls a
// promenade FROM (facing lines, waves, a rotated squared set) - the named formations are only the
// tidy half of the surface.
const boards = [];
const seen = new Set();
const add = (name, b) => {
  if (!b || b.dancers.length !== 8) return;
  const k = b.dancers.map((d) => `${d.id}@${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}`).join('|');
  if (seen.has(k)) return;
  seen.add(k);
  boards.push({ name, b });
};
for (const name of seq.listFormations()) add(name, seq.boardForFormation(name));
{
  const corpus = JSON.parse(readFileSync(path.resolve(here, '..', 'fixtures', 'all8-getouts.json'), 'utf8'));
  for (const a of corpus.alignments ?? []) {
    const s = startBoardFor(seq, a);
    if (s.board) add(`[${a.id}]`, s.board);
  }
}

const DEG = 180 / Math.PI;
const STEP = 0.25;

for (const call of ['Promenade', 'Promenade 1/2']) {
  const rows = [];
  for (const { name, b } of boards) {
    const r = seq.applyToBoard(b, call);
    if (!r.legal) continue;
    const total = seq.sequenceBeats([call], b);
    if (total <= 0) continue;

    let prev = null;
    let minPair = Infinity;
    let worstMove = 0;
    const travel = new Map();
    let prevAngle = new Map();
    for (let t = 0; t <= total + 1e-9; t += STEP) {
      const board = seq.evaluateSequence([call], Math.min(t, total), b).board;
      const phys = board.dancers.filter((d) => !d.isGhost);
      const cx = phys.reduce((s, d) => s + d.x, 0) / phys.length;
      const cy = phys.reduce((s, d) => s + d.y, 0) / phys.length;
      minPair = Math.min(minPair, closest(board));
      const angle = new Map();
      for (const d of phys) angle.set(d.id, Math.atan2(d.y - cy, d.x - cx));
      if (prev) {
        const by = new Map(board.dancers.map((d) => [d.id, d]));
        for (const d of prev.dancers) {
          const e = by.get(d.id);
          if (!e) continue;
          worstMove = Math.max(worstMove, Math.hypot(e.x - d.x, e.y - d.y));
          let da = angle.get(d.id) - prevAngle.get(d.id);
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          travel.set(d.id, (travel.get(d.id) ?? 0) + da);
        }
      }
      prev = board;
      prevAngle = angle;
    }

    // NON-RIGID: two dancers of the SAME stored couple whose net travel differs. A rigid ring wheels
    // every dancer by the same angle (within the couple, the two travel together), so this is the
    // direct measure of "the couples do not wheel together".
    const byCouple = new Map();
    for (const d of b.dancers) {
      if (d.isGhost) continue;
      const c = d.couple > 0 ? d.couple : 0;
      byCouple.set(c, [...(byCouple.get(c) ?? []), travel.get(d.id) ?? 0]);
    }
    const spread = Math.max(0, ...[...byCouple.values()].map((v) => Math.max(...v) - Math.min(...v)));

    rows.push({ name, minPair, worstMove, spreadDeg: spread * DEG, travel });
  }

  rows.sort((a, c) => a.minPair - c.minPair);
  const inside = rows.filter((r) => r.minPair < 1.0);
  const nonRigid = rows.filter((r) => r.spreadDeg > 5);
  console.log(`\n=== ${call} from every board it applies to ===`);
  console.log(`  boards it applies to:                    ${rows.length}`);
  console.log(`  closest pair of dancers at any instant:  ${rows.length ? rows[0].minPair.toFixed(3) : '-'}   (${rows.length ? rows[0].name : '-'})`);
  console.log(`  largest move in a ${STEP}-beat sample:       ${rows.length ? Math.max(...rows.map((r) => r.worstMove)).toFixed(3) : '-'}`);
  console.log(`  boards where a pair comes inside 1.0:    ${inside.length}`);
  console.log(`  boards whose couples do NOT wheel together (net travel spread > 5deg): ${nonRigid.length}`);
  console.log(`  the whole band, tightest first:`);
  for (const r of inside) {
    console.log(`      ${r.minPair.toFixed(3)}  spread ${r.spreadDeg.toFixed(0).padStart(4)}deg  ${r.name}`);
  }
  console.log('  every board, tightest first:');
  for (const r of rows) {
    console.log(`      ${r.minPair.toFixed(3)}  spread ${r.spreadDeg.toFixed(0).padStart(4)}deg  ${r.name}`);
  }
}
