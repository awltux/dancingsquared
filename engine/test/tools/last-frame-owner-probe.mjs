// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// WHO ACTUALLY OWNS THE LAST-FRAME JUMP? NOT THE LAST CALL.
//
// This probe exists because the previous three asked the wrong question. They took the LAST flat step
// as the owner of the jump. MEASURED: on 81 of the 86 offenders the last step is charged ZERO BEATS -
// `sequenceBeats` skips a catalogue step with no matching variant - so the final call never plays at
// all, `evaluateSequence(flat, total)` returns that step's `before` (an early return), and the jump
// being measured is the convergence residual of the LAST STEP THAT DOES PLAY. Asking
// `findMatchingVariant(lastCall, ...)` therefore asked about a call that contributes nothing, which is
// why 77 of the 86 came back "no whole-board match and no parallel grouping" - a contradiction only
// because the question was aimed one step too late.
//
// This identifies the OWNER step properly - the last step that contributes beats, i.e. the one playing
// at `total - 1e-6` - and reports the owner's call, its branch, and whether the last call played.
//
// Usage: node engine/test/tools/last-frame-owner-probe.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { DEFAULT_MATCH_MAX } from '../../dist/sequencer/constants.js';
import { findCodedMove } from '../../dist/sequencer/coded-moves.js';
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
  for (const d of a.dancers) { const e = byId.get(d.id); if (e) m = Math.max(m, Math.hypot(e.x - d.x, e.y - d.y)); }
  return m;
};
const nameOf = (f) => (typeof f === 'string' ? f : f.call);

const byBranch = new Map(), byCall = new Map();
const rows = [];
let offenders = 0, lastPlayed = 0, lastUnplayed = 0, lastCodedRefusal = 0, selectionSteps = 0, applyDiffers = 0;

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
  offenders++;

  // Cumulative beats, so the step PLAYING at total - 1e-6 can be identified: the last step whose own
  // beats are non-zero. (`sequenceBeats` charges a catalogue step with no matching variant 0 and
  // carries on, and a coded refusal breaks.)
  let acc = 0;
  let owner = -1;
  for (let i = 0; i < flat.length; i++) {
    const b = seq.sequenceBeats(flat.slice(0, i + 1), start) - acc;
    if (b > 0) owner = i;
    acc += b;
  }
  const lastIdx = flat.length - 1;
  const lastCall = nameOf(flat[lastIdx]);
  const lastBeats = total - (lastIdx > 0 ? seq.sequenceBeats(flat.slice(0, lastIdx), start) : 0);
  if (lastBeats > 0) lastPlayed++; else lastUnplayed++;
  if (lastBeats <= 0 && findCodedMove(lastCall)) lastCodedRefusal++;

  const ownerCall = owner >= 0 ? nameOf(flat[owner]) : '(none)';
  const ownerStart = owner > 0 ? seq.sequenceBeats(flat.slice(0, owner), start) : 0;
  // The owner's `before` board, read out of the walk itself.
  const ownerBefore = seq.evaluateSequence(flat, Math.max(0, ownerStart - 1e-6), start).board;
  const ownerBeats = seq.sequenceBeats(flat.slice(0, owner + 1), start) - ownerStart;
  const coded = findCodedMove(ownerCall);
  const whole = coded ? null : seq.findMatchingVariant(ownerBefore, ownerCall, DEFAULT_MATCH_MAX);
  const res = seq.applyToBoard(ownerBefore, ownerCall);
  const branch = coded ? 'CODED' : whole ? 'whole-board' : res.parallel ? 'parallel (stored)' : res.legal ? 'parallel (no grouping)' : 'apply refused';
  byBranch.set(branch, (byBranch.get(branch) ?? 0) + 1);
  byCall.set(ownerCall, (byCall.get(ownerCall) ?? 0) + 1);

  // DOES THE ANIMATOR APPLY THE CALL THE WALK APPLIED? `evaluateSequence` hands the animator the bare
  // NAME (`raw.call`), dropping any selection, while `replayWalk` hands the applicator the RAW step.
  // If the raw step carries a selection, the two animate/apply different calls on the same board.
  const raw = flat[owner];
  const hasSelection = typeof raw !== 'string' && !!raw.selection;
  const resRaw = typeof raw === 'string' ? res : seq.applyToBoard(ownerBefore, raw);
  const applyDiff = gap(resRaw.board, res.board);
  if (hasSelection) selectionSteps++;
  if (applyDiff > 1e-9) applyDiffers++;

  rows.push({ rel: path.relative(root, file).replace(/\\/g, '/'), ownerCall, ownerBeats, lastCall, lastBeats, jump, branch, hasSelection, applyDiff });
}

console.log(`${offenders} offender(s)   [the last-frame jump > 0.05]`);
console.log(`  the LAST flat step is charged 0 beats (the module's final call never plays): ${lastUnplayed}`);
console.log(`     ... of those, a CODED call the walk refused:                              ${lastCodedRefusal}`);
console.log(`  the last step does play:                                                     ${lastPlayed}`);
console.log(`  the owner step carries a SELECTION (the animator would apply a different call): ${selectionSteps}`);
console.log(`     ... and a raw-vs-NAME apply really differs on those boards:               ${applyDiffers}`);
console.log('\n  THE OWNER (the last step that contributes beats), by branch:');
for (const [k, n] of [...byBranch.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
console.log('\n  the owner call:');
for (const [k, n] of [...byCall.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`    ${String(n).padStart(4)}  ${k}`);
console.log('\n  10 worst:');
for (const r of rows.sort((a, b) => b.jump - a.jump).slice(0, 10)) {
  console.log(`    jump ${r.jump.toFixed(2)}  owner "${r.ownerCall}" (${r.ownerBeats.toFixed(1)}b, ${r.branch})  selection:${r.hasSelection ? 'YES' : 'no '} raw-vs-name diff ${r.applyDiff.toFixed(2)}  final call "${r.lastCall}" (${r.lastBeats.toFixed(1)}b)  ${r.rel}`);
}
