// DOES THE LAST FRAME'S BOARD HAVE A DIFFERENT `dancers` ARRAY ORDER?
//
// Reported: "the sequence keeps them in the danced sequence, but then they flip to what seems like the
// formation/arrangement sequence". The POC's dancer VIEWS are positional - the pose list is built in
// `board.dancers` order - so if the board the last frame is drawn from carries the same eight dancers
// in a different ARRAY ORDER, the set visually scrambles while every position is unchanged.
//
// This walks ceder-7046 the POC's way and prints, at every stage, the array order (by dancer id)
// alongside the positions, for:
//   - the LIVE path (`applyStep`, what the sequencer's board is), and
//   - the WALK path (`evaluateSequence`, what the frame is drawn from), at mid-call beats and at the end.
//
// Usage: node engine/test/tools/sequence-dancer-order-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};
const order = (b) => b.dancers.map((d) => d.id).join(',');
const spots = (b) => [...b.dancers].sort((a, c) => a.id - c.id)
  .map((d) => `#${d.id}(${d.x.toFixed(1)},${d.y.toFixed(1)})`).join(' ');

const mod = JSON.parse(readFileSync(path.join(root, 'modules', 'zero_line', 'static_set', '7046.json'), 'utf8'));
const start = boardForFasrCode('L1o', templateForLetter).board;
const flat = seq.flatten(mod.steps);
console.log(`module ${mod.name}  steps: ${mod.steps.join(' | ')}`);
console.log(`start array order: ${order(start)}`);

console.log('\n=== the LIVE path (what the sequencer board is) ===');
seq.setBoard(start);
console.log(`  0. (start)                          order ${order(seq.board)}`);
for (const h of flat) {
  const r = seq.applyStep(h);
  console.log(`     ${String(typeof h === 'string' ? h : h.call).padEnd(24)} ${r.legal ? 'ok ' : 'FAIL'} order ${order(seq.board)}`);
}

console.log('\n=== the WALK path (what the frame is drawn from) ===');
const total = seq.sequenceBeats(flat, start);
// mid-call samples, then the end
for (const beat of [0, 1, total / 2, total - 0.5, total]) {
  const b = seq.evaluateSequence(flat, beat, start).board;
  console.log(`  beat ${beat.toFixed(2).padStart(6)}  order ${order(b)}`);
}
console.log('\n=== positions are the same board? (sorted by id) ===');
const live = seq.evaluateSequence(flat, 0, start).board; // placeholder to keep the shape
void live;
seq.setBoard(start);
for (const h of flat) seq.applyStep(h);
const liveEnd = { dancers: seq.board.dancers.map((d) => ({ ...d })) };
const walkEnd = seq.evaluateSequence(flat, total, start).board;
console.log(`  live end order: ${order(liveEnd)}`);
console.log(`  walk end order: ${order(walkEnd)}`);
console.log(`  live end spots: ${spots(liveEnd)}`);
console.log(`  walk end spots: ${spots(walkEnd)}`);
console.log(`  same positions, different array order: ${order(liveEnd) !== order(walkEnd) && spots(liveEnd) === spots(walkEnd) ? 'YES  <- this is the visual flip' : 'no'}`);

// The COUPLE field per dancer is the "order" in square-dance terms (which couple each dancer belongs
// to) and it is what a re-based board can re-derive from the formation/arrangement while the ids stay
// put - so it is checked separately from the ids.
const couples = (b) => [...b.dancers].sort((a, c) => a.id - c.id).map((d) => `#${d.id}c${d.couple}`).join(' ');
console.log('\n=== the COUPLE field per dancer (id -> couple) ===');
console.log(`  start   : ${couples(start)}`);
console.log(`  live end: ${couples(liveEnd)}`);
console.log(`  walk end: ${couples(walkEnd)}`);
console.log(`  SAME couple mapping: ${couples(liveEnd) === couples(walkEnd) ? 'yes' : 'NO  <- the identity/order differs between the two paths'}`);
// per-call, so the call where they part is named
seq.setBoard(start);
for (const h of flat) {
  const r = seq.applyStep(h);
  if (!r.legal) break;
  const nm = typeof h === 'string' ? h : h.call;
  const walked = seq.sequenceBeats(flat.slice(0, flat.indexOf(h) + 1), start);
  const walkBoard = seq.evaluateSequence(flat, walked, start).board;
  const liveCouples = couples(seq.board);
  const walkCouples = couples(walkBoard);
  console.log(`  after ${nm.padEnd(24)} live ${liveCouples}${liveCouples === walkCouples ? '' : `\n      walk ${walkCouples}   <- DIFFERS`}`);
}
