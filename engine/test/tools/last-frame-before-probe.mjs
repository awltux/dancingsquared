// IS MY PROBE'S "before" BOARD THE WALK'S "before" BOARD?
//
// `last-frame-branch-probe.mjs` reported 77 offenders where the animator finds NO whole-board match
// and the apply stored no parallel grouping - which should make the animation follow
// `evaluateParallelAt`, a function that converges BY CONSTRUCTION. A 6.32-unit jump there is
// impossible, so one of the probe's own inputs must be wrong, and the suspect is the board: the probe
// replayed the prefix itself with `Sequencer.applyStep` (which runs the sequencer's own coded-move
// path and its own board bookkeeping), while `SequenceAnalyzer.replayWalk` reaches `s.before` through
// `applicator.applyToBoard`. If those two boards differ at all, every conclusion drawn from
// `findMatchingVariant(probeBefore, call)` is about a board the walk never saw.
//
// This compares them for the last call of every offender, and asks the whole-board-match question on
// BOTH boards.
//
// Usage: node engine/test/tools/last-frame-before-probe.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { DEFAULT_MATCH_MAX } from '../../dist/sequencer/constants.js';
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
const START = { 'static square': null, 'squared set': null, 'zero line': 'L1o', 'zero box': 'B1c' };

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

const gap = (a, b) => {
  const byId = new Map(b.dancers.map((d) => [d.id, d]));
  let m = 0;
  for (const d of a.dancers) {
    const e = byId.get(d.id);
    if (e) m = Math.max(m, Math.hypot(e.x - d.x, e.y - d.y));
  }
  return m;
};

const rows = [];
for (const file of walkJson(path.join(root, 'modules'))) {
  let mod;
  try { mod = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!Array.isArray(mod.steps) || !mod.steps.length) continue;
  const label = mod.startFormation?.trim().toLowerCase();
  const code = START[label];
  const start = code === null
    ? seq.boardForFormation('Static Square')
    : boardForFasrCode(code ?? '', templateForLetter).board;
  const flat = seq.flatten(mod.steps);
  const total = seq.sequenceBeats(flat, start);
  if (total <= 0) continue;
  const pre = seq.evaluateSequence(flat, total - 1e-6, start).board;
  const end = seq.evaluateSequence(flat, total, start).board;
  const jump = gap(pre, end);
  if (jump <= 0.05) continue;

  const prefix = flat.slice(0, -1);
  const prefixBeats = prefix.length ? seq.sequenceBeats(prefix, start) : 0;
  const callBeats = total - prefixBeats;          // 0 => the last step contributed no beats
  const last = flat[flat.length - 1];
  const call = typeof last === 'string' ? last : last.call;

  // (a) the board the WALK used, read out of the walk itself
  const walkBefore = seq.evaluateSequence(flat, prefixBeats - 1e-6, start).board;
  // (b) the board this whole probe family REPLAYED to
  seq.setBoard(start);
  let mine = start;
  for (let i = 0; i < flat.length - 1; i++) mine = seq.applyStep(flat[i]).board ?? mine;

  rows.push({
    rel: path.relative(root, file).replace(/\\/g, '/'),
    call,
    callBeats,
    jump,
    boardDiff: gap(mine, walkBefore),
    wholeMine: !!seq.findMatchingVariant(mine, call, DEFAULT_MATCH_MAX),
    wholeWalk: !!seq.findMatchingVariant(walkBefore, call, DEFAULT_MATCH_MAX),
    lastIsObject: typeof last !== 'string',
  });
}

const n = rows.length;
const boardDiffers = rows.filter((r) => r.boardDiff > 1e-6);
const wholeOnWalk = rows.filter((r) => r.wholeWalk && !r.wholeMine);
const zeroBeats = rows.filter((r) => r.callBeats <= 0);
const objects = rows.filter((r) => r.lastIsObject);
console.log(`${n} offender(s)`);
console.log(`  the probe's replayed board DIFFERS from the walk's: ${boardDiffers.length}  (worst ${Math.max(0, ...rows.map((r) => r.boardDiff)).toFixed(2)})`);
console.log(`  whole-board match found on the WALK's board but not on the probe's: ${wholeOnWalk.length}`);
console.log(`  the last step is charged 0 beats: ${zeroBeats.length}`);
console.log(`  the last step is a CallStep object (selection), not a string: ${objects.length}`);
console.log(`  whole-board match on the probe's board: ${rows.filter((r) => r.wholeMine).length}`);
console.log(`  whole-board match on the walk's board:  ${rows.filter((r) => r.wholeWalk).length}`);
console.log('\n  12 worst jumps:');
for (const r of rows.sort((a, b) => b.jump - a.jump).slice(0, 12)) {
  console.log(`    jump ${r.jump.toFixed(2)}  beats ${r.callBeats.toFixed(1)}  boardDiff ${r.boardDiff.toFixed(2)}  mine:${r.wholeMine ? 'whole' : 'none '} walk:${r.wholeWalk ? 'whole' : 'none '}  "${r.call}"  ${r.rel}`);
}
