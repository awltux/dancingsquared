// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// WHAT THE FLOOR-PAIR READ CHANGES, when it costs no figure: the ROTATION a promenade reads.
//
// `promenadeFraction` ends the ring at the home ring turned by (the ring's own rotation + the
// fraction). The rotation comes from couple 1's ANCHOR, and an anchor is a SNAP of that couple's
// midpoint to one of the four axis points, so the rotation is a whole number of quarter turns. On an
// ALAMO ring the STORED labels put couple 1's two dancers 180 degrees apart and their midpoint at the
// middle of the set (radius 1.13), which snaps to an arbitrary side; the pairs read off the floor put
// couple 1's midpoint in the 1st quadrant at radius 3.00, which snaps to north.
//
// This prints the rotation the call reads, both ways, and what the fraction lands on.
//
// Usage: node engine/test/tools/promenade-rotation-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};

const mod = JSON.parse(readFileSync(path.join(root, 'modules/zero_line/static_set/7046.json'), 'utf8'));
const L1o = boardForFasrCode('L1o', templateForLetter).board;
const ring = seq.evaluateSequence(seq.flatten(mod.steps), seq.sequenceBeats(seq.flatten(mod.steps), L1o), L1o).board;
const home = seq.boardForFormation('Static Square');

/** The angle, in degrees, from the home squared set to a board of the same eight identities: the
 * mean per-dancer turn about the origin, which is the rotation `promenadeFraction` applies.
 *
 * The MEAN IS TAKEN ON THE CIRCLE (the vector sum of the turns), not by averaging the raw angles: a
 * turn of exactly half a turn is +180 for half the dancers and -180 for the other half, so a plain
 * mean cancels to zero and reports "no rotation" for the one angle this probe is about. */
const rotationOf = (b) => {
  const byId = new Map(home.dancers.map((d) => [d.id, d]));
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const d of b.dancers) {
    const h = byId.get(d.id);
    if (!h) continue;
    let da = Math.atan2(d.y, d.x) - Math.atan2(h.y, h.x);
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    sx += Math.cos(da);
    sy += Math.sin(da);
    n++;
  }
  return Math.atan2(sy / n, sx / n) * (180 / Math.PI);
};
const closestTo = (b) => {
  const ds = b.dancers.filter((d) => !d.isGhost);
  let m = Infinity;
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  return m;
};

for (const [name, board] of [['7046 end ring (Alamo)', ring], ['Static Square', home]]) {
  const r = seq.applyToBoard(board, 'Promenade');
  console.log(`\n=== ${name} ===`);
  console.log(`  Promenade: ${r.legal ? 'legal' : `REFUSED: ${r.reason}`}`);
  const half = seq.evaluateSequence(['Promenade 1/2'], seq.sequenceBeats(['Promenade 1/2'], board), board).board;
  console.log(`  Promenade 1/2 ends ${rotationOf(half).toFixed(1)} degrees from home (closest pair ${closestTo(half).toFixed(3)})`);
  // What the home set turned by that angle looks like against the home set itself.
  const turn = rotationOf(half);
  let worst = 0;
  {
    const c = Math.cos((turn * Math.PI) / 180);
    const s = Math.sin((turn * Math.PI) / 180);
    const byId = new Map(half.dancers.map((d) => [d.id, d]));
    for (const h of home.dancers) {
      const e = byId.get(h.id);
      if (!e) continue;
      const want = { x: h.x * c - h.y * s, y: h.x * s + h.y * c };
      worst = Math.max(worst, Math.hypot(e.x - want.x, e.y - want.y));
    }
  }
  console.log(`  ...and that board IS home turned by that angle, to ${worst.toFixed(6)} units`);
}
