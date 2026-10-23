// DOES A PROMENADE WHEEL THE PAIRS THAT ARE ACTUALLY THERE? The item-2 instrument.
//
// The report: "they travel in different directions". On MS ceder-7046's end ring the dancers are in an
// ALAMO RING - boys on the outside at radius 3.45, girls inside at 2.93, each pair FACING at 2.3 units
// with a side-offset of 0.01-0.05 - while the board's stored `couple` labels pair dancers 180 degrees
// apart with the SAME heading (the FASR `o` reading). `promenadeHome` groups by those labels, so the
// two dancers of a stored couple are sent round the ring independently.
//
// This measures the thing the eye sees, over every board the call applies to plus the two module boards
// the workstream's own records name: for the pairs read OFF THE FLOOR (an opposite-gender dancer either
// directly in front, the Alamo/promenade-facing arrangement, or dead beside with the same heading, the
// squared-set/promenade-position arrangement), does each pair wheel TOGETHER - one signed sweep and a
// partner separation that stays put - or does it come apart?
//
// THE PAIRING HERE IS INDEPENDENT OF THE ENGINE'S. It is re-derived from geometry so that a probe of
// the engine cannot agree with the engine's own bug.
//
// Usage: node engine/test/tools/promenade-pair-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { startBoardFor } from '../lib/all8-boards.mjs';
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

/**
 * The pairs read off the FLOOR: each dancer's partner is the nearest opposite-gender dancer that is
 * either
 *   - IN FRONT of it (`along` positive, `perp` small): an Alamo ring or a promenade-facing ring, where
 *     partners face each other, or
 *   - BESIDE it (`along` ~0, `perp` ~2, same heading): a squared set or a formed promenade position,
 *     where partners stand shoulder to shoulder facing the same way.
 * Greedy nearest-first, and a dancer with no such partner is reported as unpaired rather than invented.
 */
function pairsOf(board) {
  const phys = board.dancers.filter((d) => !d.isGhost);
  const taken = new Set();
  const pairs = [];
  const unpaired = [];
  const bearing = (d, o) => {
    const vx = o.x - d.x;
    const vy = o.y - d.y;
    return {
      dist: Math.hypot(vx, vy),
      along: vx * Math.cos(d.heading) + vy * Math.sin(d.heading),
      perp: Math.abs(-vx * Math.sin(d.heading) + vy * Math.cos(d.heading)),
      dHeading: Math.abs(Math.atan2(Math.sin(o.heading - d.heading), Math.cos(o.heading - d.heading))),
    };
  };
  const isPair = (d, o) => {
    if (d.gender === o.gender || d.gender === 'phantom' || o.gender === 'phantom') return false;
    const b = bearing(d, o);
    if (b.dist < 1.4 || b.dist > 3.6) return false;
    const facing = b.along > 1.4 && b.perp < 1.5;
    const beside = Math.abs(b.along) < 0.6 && Math.abs(b.perp - 2) < 0.5 && b.dHeading < 0.2;
    return facing || beside;
  };
  // Nearest-first so a contest is settled by geometry rather than by array order.
  const candidates = [];
  for (const d of phys) for (const o of phys) {
    if (d.id >= o.id || !isPair(d, o)) continue;
    candidates.push({ a: d, b: o, dist: bearing(d, o).dist });
  }
  candidates.sort((x, y) => Math.abs(x.dist - 2) - Math.abs(y.dist - 2));
  for (const c of candidates) {
    if (taken.has(c.a.id) || taken.has(c.b.id)) continue;
    taken.add(c.a.id);
    taken.add(c.b.id);
    pairs.push([c.a, c.b]);
  }
  for (const d of phys) if (!taken.has(d.id)) unpaired.push(d.id);
  return { pairs, unpaired };
}

const closest = (b) => {
  const ds = b.dancers.filter((d) => !d.isGhost);
  let m = Infinity;
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  return m;
};

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
// The two module boards the workstream's records name, built by replaying the published chains.
{
  const mod = JSON.parse(readFileSync(path.join(root, 'modules/zero_line/static_set/7046.json'), 'utf8'));
  const L1o = boardForFasrCode('L1o', templateForLetter).board;
  const ring = seq.evaluateSequence(seq.flatten(mod.steps), seq.sequenceBeats(seq.flatten(mod.steps), L1o), L1o).board;
  add('7046 end ring', ring);
}
{
  const MODULE = ['Heads Pass the Ocean', 'Extend', 'Centers Trade', 'Swing Thru', 'All 8 Circulate', 'Right and Left Grand'];
  const square = seq.boardForFormation('Static Square');
  add('ceder-10530 body', seq.evaluateSequence(MODULE, seq.sequenceBeats(MODULE, square), square).board);
}

const DEG = 180 / Math.PI;
const STEP = 0.25;

/** The angle of a pair's midpoint about the set centre at beat `b`, and the members' angles. */
const angleOf = (x, y, cx, cy) => Math.atan2(y - cy, x - cx);
const unwrap = (d) => {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

const rows = [];
for (const call of ['Promenade', 'Promenade 1/2']) {
  for (const { name, b } of boards) {
    const r = seq.applyToBoard(b, call);
    if (!r.legal) continue;
    const total = seq.sequenceBeats([call], b);
    if (total <= 0) continue;
    const { pairs, unpaired } = pairsOf(b);
    if (pairs.length === 0) continue;

    // Walk the call, tracking each pair's midpoint sweep and the separation of its members.
    const sweep = new Map();          // pair index -> accumulated midpoint angle
    const memberSweep = new Map();    // dancer id -> accumulated own angle
    let prevMid = new Map();
    let prevOwn = new Map();
    const sep = new Map();            // pair index -> {min, max}
    let closestPair = Infinity;
    for (let t = 0; t <= total + 1e-9; t += STEP) {
      const board = seq.evaluateSequence([call], Math.min(t, total), b).board;
      const phys = board.dancers.filter((d) => !d.isGhost);
      const cx = phys.reduce((s, d) => s + d.x, 0) / phys.length;
      const cy = phys.reduce((s, d) => s + d.y, 0) / phys.length;
      closestPair = Math.min(closestPair, closest(board));
      pairs.forEach(([a, c], i) => {
        const ma = board.dancers.find((d) => d.id === a.id);
        const mc = board.dancers.find((d) => d.id === c.id);
        if (!ma || !mc) return;
        const mx = (ma.x + mc.x) / 2;
        const my = (ma.y + mc.y) / 2;
        const mid = angleOf(mx, my, cx, cy);
        if (prevMid.has(i)) sweep.set(i, (sweep.get(i) ?? 0) + unwrap(mid - prevMid.get(i)));
        prevMid.set(i, mid);
        for (const m of [ma, mc]) {
          const own = angleOf(m.x, m.y, cx, cy);
          if (prevOwn.has(m.id)) memberSweep.set(m.id, (memberSweep.get(m.id) ?? 0) + unwrap(own - prevOwn.get(m.id)));
          prevOwn.set(m.id, own);
        }
        const d = Math.hypot(ma.x - mc.x, ma.y - mc.y);
        const s = sep.get(i) ?? { min: Infinity, max: -Infinity };
        s.min = Math.min(s.min, d);
        s.max = Math.max(s.max, d);
        sep.set(i, s);
      });
    }

    // PER-PAIR DIRECTION AGREEMENT: do the two members take the same signed sweep?
    let reversals = 0;
    let worstMemberSpread = 0;
    let worstSepSpread = 0;
    pairs.forEach(([a, c], i) => {
      const sa = memberSweep.get(a.id) ?? 0;
      const sc = memberSweep.get(c.id) ?? 0;
      if (Math.sign(sa) !== Math.sign(sc) && Math.abs(sa) > 0.05 && Math.abs(sc) > 0.05) reversals++;
      worstMemberSpread = Math.max(worstMemberSpread, Math.abs(sa - sc) * DEG);
      const s = sep.get(i);
      if (s) worstSepSpread = Math.max(worstSepSpread, s.max - s.min);
    });

    rows.push({
      call, name, pairs: pairs.length, unpaired: unpaired.length,
      reversals, worstMemberSpread, worstSepSpread, closestPair,
      midSweep: [...sweep.values()].map((v) => v * DEG),
    });
  }
}

for (const call of ['Promenade', 'Promenade 1/2']) {
  const rs = rows.filter((r) => r.call === call);
  if (!rs.length) continue;
  const rev = rs.filter((r) => r.reversals > 0);
  const apart = rs.filter((r) => r.worstSepSpread > 0.5);
  const unmatched = rs.filter((r) => r.unpaired > 0);
  console.log(`\n=== ${call}, over the ${rs.length} boards it applies to that have floor pairs ===`);
  console.log(`  boards where a PAIR takes two different directions:      ${rev.length}`);
  console.log(`  boards where a partner separation moves > 0.5 units:     ${apart.length}`);
  console.log(`  boards with a dancer that pairs with nobody:             ${unmatched.length}`);
  console.log(`  worst within-pair travel disagreement:                   ${Math.max(...rs.map((r) => r.worstMemberSpread)).toFixed(1)} deg`);
  console.log(`  worst partner separation swing:                          ${Math.max(...rs.map((r) => r.worstSepSpread)).toFixed(2)} units`);
  console.log(`  worst closest pair during the call:                      ${Math.min(...rs.map((r) => r.closestPair)).toFixed(3)}`);
  console.log('  the ten worst by separation swing:');
  for (const r of [...rs].sort((a, c) => c.worstSepSpread - a.worstSepSpread).slice(0, 10)) {
    console.log(`      ${r.worstSepSpread.toFixed(2)}  rev ${r.reversals}  disagree ${r.worstMemberSpread.toFixed(0).padStart(3)}deg  unpaired ${r.unpaired}  ${r.name}`);
  }
}

// The two named module boards, in full.
console.log('\n=== the two named module boards ===');
for (const nm of ['7046 end ring', 'ceder-10530 body']) {
  const r = rows.find((x) => x.name === nm && x.call === 'Promenade');
  if (!r) { console.log(`  ${nm}: Promenade does not apply`); continue; }
  console.log(`  ${nm}: ${r.pairs} pair(s), ${r.unpaired} unpaired, reversals ${r.reversals}, within-pair disagreement ${r.worstMemberSpread.toFixed(1)} deg, separation swing ${r.worstSepSpread.toFixed(2)} units, closest pair ${r.closestPair.toFixed(3)}`);
  console.log(`      pair midpoint sweeps (deg): ${r.midSweep.map((v) => v.toFixed(0)).join(', ')}`);
}

// THE QUESTION THE FIX TURNS ON: do the FLOOR pairs form a ring in couple order, and where does each
// pair's midpoint sit? `promenadeHome` anchors a couple by the quadrant its midpoint is in and then
// requires the four anchors to run 1 -> 2 -> 3 -> 4 counter-clockwise. If the floor pairs (each taking
// the MAN's stored couple, which is what "she takes on his identity" means) satisfy that, then reading
// them is the same ring the engine already tests for; if they do not, the floor pairing is not the ring
// this call should be read from and the pairing is not the fix.
console.log('\n=== the ring order, read BOTH ways, on the two named boards ===');
const AXIS = [[0, 2], [-2, 0], [0, -2], [2, 0]];
const anchorOf = (x, y) => {
  if (x >= 0 && y > 0) return 'N';
  if (x < 0 && y >= 0) return 'W';
  if (x <= 0 && y < 0) return 'S';
  return 'E';
};
const ccwTurn = (from, to) => {
  let d = ((to - from) * 180) / Math.PI;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
};
for (const nm of ['7046 end ring', 'ceder-10530 body']) {
  const entry = boards.find((x) => x.name === nm);
  if (!entry) { console.log(`  ${nm}: no board`); continue; }
  const b = entry.b;
  const { pairs } = pairsOf(b);
  const phys = b.dancers.filter((d) => !d.isGhost);
  const cx = phys.reduce((s, d) => s + d.x, 0) / phys.length;
  const cy = phys.reduce((s, d) => s + d.y, 0) / phys.length;
  const describe = (label, groups) => {
    const rows2 = [];
    for (const [num, ids] of groups) {
      const ms = ids.map((id) => phys.find((d) => d.id === id));
      const mx = ms.reduce((s, d) => s + d.x, 0) / ms.length;
      const my = ms.reduce((s, d) => s + d.y, 0) / ms.length;
      rows2.push({ num, ids, mx, my, anchor: anchorOf(mx, my), angle: Math.atan2(my - cy, mx - cx) });
    }
    rows2.sort((a, c) => a.num - c.num);
    const anchors = rows2.map((r2) => r2.anchor);
    const turns = rows2.map((r2, i) => {
      const next = rows2[(i + 1) % rows2.length];
      return ccwTurn(r2.angle, next.angle);
    });
    console.log(`  ${nm} - ${label}:`);
    for (const r2 of rows2) {
      console.log(`      couple ${r2.num}: #${r2.ids.join(',#')}  midpoint (${r2.mx.toFixed(2)},${r2.my.toFixed(2)})  anchor ${r2.anchor} at ${(r2.angle * DEG).toFixed(0)}deg`);
    }
    console.log(`      anchors ${anchors.join(',')} (${new Set(anchors).size} distinct)  CCW turns ${turns.map((t) => t.toFixed(0)).join(',')}  in-sequence ${turns.every((t) => Math.abs(t - 90) < 1e-6)}`);
  };
  const stored = new Map();
  for (const d of phys) stored.set(d.couple, [...(stored.get(d.couple) ?? []), d.id]);
  describe('STORED couple labels', [...stored.entries()]);
  const floor = new Map();
  for (const [a, c] of pairs) {
    const man = a.gender === 'boy' ? a : c;
    floor.set(man.couple, [a.id, c.id]);
  }
  describe('FLOOR pairs, each taking the MAN\'s couple', [...floor.entries()]);
}
