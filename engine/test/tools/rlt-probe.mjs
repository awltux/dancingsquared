// DIAGNOSE `Right and Left Thru` from a Static Square: the sequencer reports dancers walking all
// over each other in the middle.
//
// Usage: node engine/test/tools/rlt-probe.mjs

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, poseFor, dancerBeats } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'assets');
const movesXml = readFileSync(path.join(assets, 'moves.xml'), 'utf8');
const formsXml = readFileSync(path.join(assets, 'formations.xml'), 'utf8');
const seq = new Sequencer(movesXml, formsXml, callsByTitle(assets));

const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}${d.gender ? d.gender[0].toUpperCase() : '?'}(${d.x.toFixed(2)},${d.y.toFixed(2)})@${Math.round((d.heading * 180) / Math.PI)}`)
  .join(' ');

const CALL = 'Right and Left Thru';
const square = seq.boardForFormation('Static Square');
console.log('=== Static Square ===');
console.log(`  [${seq.knownFormation(square)}] ${pose(square)}`);

const r = seq.applyToBoard(square, CALL);
console.log(`\n=== ${CALL} from a Static Square ===`);
if (!r.legal) {
  console.log(`  REFUSED: ${r.reason}`);
} else {
  console.log(`  -> [${seq.knownFormation(r.board)}] ${pose(r.board)}`);
  const col = seq.collisions(r.board, 1.0);
  console.log(`  COLLISIONS closer than 1.0: ${col.length ? col.map((c) => `#${c.id1}/#${c.id2}`).join(' ') : 'none'}`);
  // The tightest gap on the board, so "all on top of each other" has a number.
  const ds = r.board.dancers;
  let min = Infinity;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      min = Math.min(min, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
    }
  }
  console.log(`  closest pair: ${min.toFixed(3)}`);
}

// THE ANIMATION, not just the end. The applied board above is correct, so the complaint must be
// about the frames in between - and `blendToAppliedEnd` moves each dancer in a STRAIGHT LINE from
// where it started to where it ended. A call that swaps two couples across the centre therefore
// sends them through each other. Sweeping the beats measures that rather than assuming it.
console.log('\n=== the frames in between ===');
const flat = ['Right and Left Thru'];
const total = seq.sequenceBeats(flat, square);
console.log(`  ${total.toFixed(1)} beats`);
let worst = Infinity;
let worstBeat = 0;
for (let b = 0; b <= total + 1e-9; b += total / 40) {
  const at = seq.evaluateSequence(flat, b, square).board;
  const ds = at.dancers;
  let min = Infinity;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) min = Math.min(min, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  }
  if (min < worst) { worst = min; worstBeat = b; }
}
console.log(`  closest two dancers at ANY point: ${worst.toFixed(3)} at beat ${worstBeat.toFixed(1)}`);
console.log(`  (the end board's closest pair is 2.000, so anything below that is dancers converging)`);
{
  const at = seq.evaluateSequence(flat, worstBeat, square).board;
  console.log(`  at that beat: ${pose(at)}`);
}

// CONVERGENCE, which is the property the OLD straight-line blend existed to guarantee: the last
// animated frame must BE the board the sequencer stores, or the dancers visibly jump when the call
// completes. The residual correction in `evaluateParallelAt` is what buys that back while the frames
// follow the authored path, so it is checked rather than assumed.
{
  const animatedEnd = seq.evaluateSequence(flat, total, square).board;
  const appliedEnd = seq.applyToBoard(square, CALL).board;
  const byId = new Map(appliedEnd.dancers.map((d) => [d.id, d]));
  let worstGap = 0;
  for (const d of animatedEnd.dancers) {
    const a = byId.get(d.id);
    if (!a) continue;
    worstGap = Math.max(worstGap, Math.hypot(d.x - a.x, d.y - a.y));
  }
  console.log(`  last animated frame vs the APPLIED board: worst gap ${worstGap.toFixed(4)} units`);
  if (worstGap > 1e-6) { console.log('  FAIL: the animation does not land on the applied board'); process.exitCode = 1; }
}
const m = seq.findMatchingVariant(square, CALL, 6.0);
console.log(`\n=== matcher ===`);
console.log(m
  ? `  matched "${m.variant.title}" ${m.variant.dancers.length} dancer(s), error ${m.error.toFixed(3)}, reflect=${m.reflect}`
  : '  no whole-board match');

const variants = seq.matchableVariants(CALL);
const bySize = new Map();
for (const v of variants) bySize.set(v.dancers.length, (bySize.get(v.dancers.length) ?? 0) + 1);
console.log(`  ${variants.length} matchable variant(s): ${[...bySize].map(([k, n]) => `${n}x${k}-dancer`).join(', ')}`);
for (const v of variants) {
  console.log(`    ${String(v.dancers.length).padStart(2)}-dancer  from="${v.from}"${v.genderSpecific ? '  gender-specific' : ''}`);
}

// WHOSE FAULT: the move definitions, or the animation route?
//
// The claim to test is "the call starts and ends correctly, so the move definitions must be at
// fault". That is sound ONLY IF the authored definitions are what runs between the endpoints. Two
// placements are compared: one where NO whole-board variant matches (a Static Square, which takes
// the parallel route through `blendToAppliedEnd`), and one where a whole-board variant DOES match
// (an Eight Chain Thru, which takes the authored path through `evaluateVariantAt`). If the authored
// definitions were at fault, BOTH would break.
console.log('\n=== the same call, on a placement that DOES whole-board match ===');
for (const formation of ['Eight Chain Thru', 'Normal Lines']) {
  const b = seq.boardForFormation(formation);
  if (!b) { console.log(`  ${formation}: no such formation`); continue; }
  const m = seq.findMatchingVariant(b, CALL, 1.5 + 0.0);
  const total2 = seq.sequenceBeats([CALL], b);
  let min2 = Infinity;
  let at2 = 0;
  for (let t = 0; t <= total2 + 1e-9; t += total2 / 40) {
    const ds = seq.evaluateSequence([CALL], t, b).board.dancers;
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const d = Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y);
        if (d < min2) { min2 = d; at2 = t; }
      }
    }
  }
  console.log(`  [${formation}] whole-board match: ${m ? `yes (error ${m.error.toFixed(3)})` : 'NO -> parallel/blend route'}`);
  console.log(`      animation closest pair: ${min2.toFixed(3)} at beat ${at2.toFixed(1)}`);
}
// CALLERLAB'S OWN TABLE, from the teaching site's "Analysis" page
// (docs/downloads/teaching.callerlab.org/mainstream/right-and-left-thru-definition). It lists the
// ENDING formation for each STANDARD starting formation and arrangement, which makes it a small,
// authoritative oracle the engine can be checked against directly:
//
//   a) Static Square, Normal Couples, Heads Right and Left Thru -> Static Square, Normal Couples
//   b) Facing Lines, Normal Couples, Right and Left Thru        -> Facing Lines
//   c) Eight Chain Thru, Normal Couples, Right and Left Thru    -> Eight Chain Thru
//   d) Right-Hand Parallel Waves, Boys on Ends, RLT            -> Eight Chain Thru formation
//   e) Right-Hand Tidal Wave, Girls in Center of each four, RLT -> Facing Lines
console.log('\n=== CALLERLAB\'s ending-formation table vs the engine ===');
const TABLE = [
  ['Static Square', 'Heads Right and Left Thru', 'Static Square'],
  ['Normal Lines', 'Right and Left Thru', 'Normal Lines'],
  ['Eight Chain Thru', 'Right and Left Thru', 'Eight Chain Thru'],
  ['Ocean Waves', 'Right and Left Thru', 'Eight Chain Thru'],
  ['Tidal Wave', 'Right and Left Thru', 'Normal Lines'],
];
let tblFail = 0;
for (const [start, call, want] of TABLE) {
  const b = seq.boardForFormation(start);
  if (!b) { console.log(`  ?    ${start}: no such formation`); continue; }
  const r = seq.applyToBoard(b, call);
  const got = r.legal ? seq.knownFormation(r.board) : `REFUSED (${r.reason})`;
  const ok = got === want;
  if (!ok) tblFail++;
  console.log(`  ${ok ? 'ok  ' : 'DIFF'} ${call} from ${start}: engine says [${got}], CALLERLAB says [${want}]`);
}
console.log(`  ${TABLE.length - tblFail} of ${TABLE.length} agree with CALLERLAB`);

// pose - which is what "analyse the other instances to figure out how to do it" needs. The end
// pose is taken from a ONE-TAM sequencer so each authoring is read on its own setup.
console.log('\n=== every authored Right and Left Thru, by file and setup ===');
const levelOf = (f) => path.basename(path.dirname(f));
const blocks = [];
for (const lv of ['ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2']) {
  const dir = path.join(assets, lv);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f === 'right_and_left_thru.xml'); } catch { continue; }
  for (const f of files) {
    const xml = readFileSync(path.join(dir, f), 'utf8');
    for (const b of xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []) {
      const title = (b.match(/\btitle="([^"]*)"/) ?? [])[1] ?? '?';
      if (!/^Right and Left Thru$|^Left Right and Left Thru$/i.test(title)) continue;
      blocks.push({ level: lv, title, from: (b.match(/\bfrom="([^"]*)"/) ?? [])[1] ?? '', formation: (b.match(/\bformation="([^"]*)"/) ?? [])[1] ?? '', block: b });
    }
  }
}
for (const bl of blocks) {
  const s = new Sequencer(movesXml, formsXml, [{ name: bl.title, xml: `<calls>${bl.block}</calls>` }]);
  // Does the tam REGISTER? `sequencerVariants` excludes `sequencer="no"`; `matchableVariants`
  // includes it. If both are empty the tam failed to BUILD, and the reason is in
  // `registrationFailures` - which is the question of whether these move definitions are at fault.
  const forSeq = s.sequencerVariants(bl.title).length;
  const matchable = s.matchableVariants(bl.title).length;
  const fails = s.registrationFailures().map((f) => `${f.call}: ${f.reason}`);
  const v = s.sequencerVariants(bl.title)[0];
  let end = '?';
  if (v) {
    end = v.dancers.map((d) => {
      const p = poseFor(d, dancerBeats(d));
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    }).join(' ');
  }
  console.log(`  [${bl.level}] from="${bl.from}" formation="${bl.formation}"`);
  console.log(`        variants: forSequencer=${forSeq} matchable=${matchable}${v ? '' : '   <- NO VARIANT'}`);
  if (fails.length) for (const f of fails) console.log(`        BUILD FAILURE: ${f}`);
  console.log(`        end: ${end}`);
}
