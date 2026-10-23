// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// WHICH FIGURE STOPS AT A PROMENADE, AND WHY? The witness hunt for the facing-pair read.
//
// `all8-figures.mjs` reports how many of the 188 published figures run end-to-end and, of those that
// do not, the call they stop at. That histogram moves by one `Promenade` when the ring's couples are
// read from the FLOOR instead of from the stored `couple` labels, and a count moving is not an
// explanation: this names the figure and prints the board and the refusal, so the reason can be read
// rather than inferred.
//
// Usage: node engine/test/tools/promenade-figure-stop-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { ALL8_FIGURE_START, figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const start = seq.boardForFormation(ALL8_FIGURE_START);
const data = loadAll8Figures();
let ran = 0;
const stopped = [];
for (const f of data.figures) {
  const calls = figureEngineCalls(f);
  if (!calls.length) { stopped.push({ id: f.id, at: '(no calls)', calls }); continue; }
  let board = start;
  let at = null;
  for (const name of calls) {
    const r = seq.applyToBoard(board, name);
    if (!r.legal) { at = { name, reason: r.reason, board }; break; }
    board = r.board;
  }
  if (at) stopped.push({ id: f.id, at: at.name, reason: at.reason, board: at.board, calls });
  else ran++;
}
console.log(`${ran} of ${data.figures.length} run end-to-end; ${stopped.length} stop`);
const prom = stopped.filter((s) => /promenade/i.test(String(s.at)));
console.log(`\nfigures that stop at a PROMENADE: ${prom.length}`);
for (const s of prom) {
  console.log(`  ${s.id}  chain: ${s.calls.join(' | ')}`);
  console.log(`      refused: ${s.at}: ${s.reason}`);
  const phys = s.board.dancers.filter((d) => !d.isGhost);
  console.log('      the board it stops on, by stored couple:');
  const by = new Map();
  for (const d of phys) by.set(d.couple, [...(by.get(d.couple) ?? []), d]);
  for (const c of [...by.keys()].sort((a, b) => a - b)) {
    const pair = by.get(c);
    const mid = { x: pair.reduce((t, d) => t + d.x, 0) / pair.length, y: pair.reduce((t, d) => t + d.y, 0) / pair.length };
    const gap = pair.length === 2 ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : NaN;
    console.log(`        couple ${c}: ${pair.map((d) => `#${d.id}(${d.x.toFixed(1)},${d.y.toFixed(1)},${d.gender[0]},h${Math.round((d.heading * 180) / Math.PI)})`).join(' ')}  middle (${mid.x.toFixed(2)},${mid.y.toFixed(2)})  r${Math.hypot(mid.x, mid.y).toFixed(2)}  stored-pair gap ${Number.isNaN(gap) ? '-' : gap.toFixed(2)}`);
  }
  // THE FLOOR PAIRS, which is what the ring test would read if it took the couples from the ring:
  // are they a ring at all (one per side), and in what order?
  const phys2 = s.board.dancers.filter((d) => !d.isGhost);
  const taken = new Set();
  const floor = [];
  for (const d of phys2) {
    if (taken.has(d.id)) continue;
    for (const o of phys2) {
      if (o.id === d.id || taken.has(o.id) || o.gender === d.gender) continue;
      const vx = o.x - d.x;
      const vy = o.y - d.y;
      const dist = Math.hypot(vx, vy);
      const along = vx * Math.cos(d.heading) + vy * Math.sin(d.heading);
      const perp = Math.abs(-vx * Math.sin(d.heading) + vy * Math.cos(d.heading));
      const beside = Math.abs(dist - 2) < 0.35
        && Math.abs(Math.atan2(Math.sin(o.heading - d.heading), Math.cos(o.heading - d.heading))) < 0.2;
      if (!((along > 1.4 && perp < 1.5 && dist >= 1.4 && dist <= 3.6) || beside)) continue;
      taken.add(d.id);
      taken.add(o.id);
      floor.push([d, o]);
      break;
    }
  }
  const anchor = (x, y) => (x >= 0 && y > 0 ? 'N' : x < 0 && y >= 0 ? 'W' : x <= 0 && y < 0 ? 'S' : 'E');
  console.log(`      FLOOR pairs (${floor.length}), each taking the man's couple:`);
  for (const [d, o] of floor) {
    const man = d.gender === 'boy' ? d : o;
    const mx = (d.x + o.x) / 2;
    const my = (d.y + o.y) / 2;
    console.log(`        man c${man.couple}: #${d.id},#${o.id}  middle (${mx.toFixed(2)},${my.toFixed(2)})  r${Math.hypot(mx, my).toFixed(2)}  anchor ${anchor(mx, my)}  at ${Math.round((Math.atan2(my, mx) * 180) / Math.PI)}deg`);
  }
}
