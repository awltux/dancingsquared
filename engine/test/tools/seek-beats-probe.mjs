// VERIFY the sequencer list's SEEK arithmetic (not a harness - a probe for a UI change that
// cannot be exercised here, because the dev server needs esbuild and the sandbox blocks it).
//
// `SequencerUi.seekTo(idx)` moves the playhead to the beat at which history step `idx` BEGINS and
// claims the board there is "the formation at the start of that call". That claim rests on two
// things this file checks directly, with no browser involved:
//
//   1. `beatAtStep(idx)` — flatten PER STEP (a module expands to several flat steps, so a history
//      index is not a flat index), take the total beats of that prefix, and the result must equal
//      the beat where the previous call ends.
//   2. `evaluateSequence(flat, thatBeat, startBoard)` must give the SAME board as applying
//      history[0..idx-1] one step at a time — which is what "as if they had danced from the
//      beginning" has to mean.
//
// Usage: node engine/test/tools/seek-beats-probe.mjs

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

/** The same arithmetic `SequencerUi.beatAtStep` uses. */
const beatAtStep = (history, idx, startBoard) => {
  let flatCount = 0;
  for (let i = 0; i < idx; i++) flatCount += seq.flatten([history[i]]).length;
  if (flatCount === 0) return 0;
  return seq.sequenceBeats(seq.flatten(history).slice(0, flatCount), startBoard);
};

/** Apply the first `idx` steps one at a time from the start board — the reference reading. */
const replayPrefix = (history, idx, startBoard) => {
  seq.setBoard(startBoard);
  for (let i = 0; i < idx; i++) seq.applyStep(history[i]);
  return seq.board;
};

/** Normalise away the two things that made the FIRST cut of this probe report false failures:
 * heading WRAPPING (the same facing can be -1.571 or 4.712 rad, which differ by exactly 2pi) and
 * NEGATIVE ZERO ((-0).toFixed(3) is "-0.000", (0).toFixed(3) is "0.000"). Both are representation,
 * not motion. */
const n = (v) => (v === 0 ? 0 : v).toFixed(3);
const ang = (h) => n(((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `${d.id}(${n(d.x)},${n(d.y)},${ang(d.heading)})`).join(' ');

// Captured ONCE, before any replay: `replayPrefix` below drives the shared Sequencer, so reading
// the start board per sequence would read the PREVIOUS sequence's end state. (It did, and that is
// what made the second sequence report every step beginning at beat 0.)
const HOME = seq.startBoard();

const SEQUENCES = [
  ['Heads Square Thru 4', 'Swing Thru', 'Boys Run'],
  ['Heads Promenade 1/2', 'Heads Lead Right', 'Circle to a Line', 'Forward and Back', 'Pass the Ocean'],
];

let failures = 0;
for (const history of SEQUENCES) {
  const startBoard = HOME;
  const flat = seq.flatten(history);
  const total = seq.sequenceBeats(flat, startBoard);
  console.log(`\n=== ${history.join(' | ')} ===`);
  console.log(`  ${history.length} history step(s), ${flat.length} flat step(s), ${total.toFixed(1)} beats`);
  for (let idx = 0; idx < history.length; idx++) {
    const beat = beatAtStep(history, idx, startBoard);
    const viaEvaluate = seq.evaluateSequence(flat, beat, startBoard).board;
    const viaReplay = replayPrefix(history, idx, startBoard);
    const same = pose(viaEvaluate) === pose(viaReplay);
    if (!same) failures++;
    console.log(
      `  ${same ? 'ok  ' : 'FAIL'} step ${idx + 1} "${history[idx]}" begins at beat ${beat.toFixed(1)}` +
        `  -> [${seq.knownFormation(viaEvaluate)}]${same ? '' : '  MISMATCH vs replay'}`,
    );
    if (!same) {
      console.log(`        evaluateSequence : ${pose(viaEvaluate)}`);
      console.log(`        replay(applyStep): ${pose(viaReplay)}`);
    }
  }
  // The end of the sequence must be the total, so a seek to the last step is inside the range.
  const end = beatAtStep(history, history.length, startBoard);
  const endOk = Math.abs(end - total) < 1e-6;
  if (!endOk) failures++;
  console.log(`  ${endOk ? 'ok  ' : 'FAIL'} one past the last step == total beats (${end.toFixed(1)} vs ${total.toFixed(1)})`);
}

console.log(failures === 0 ? '\nSEEK BEATS PASSED' : `\nSEEK BEATS FAILED: ${failures}`);

// ---------------------------------------------------------------------------------------------
// MEMO TRANSPARENCY. `SequenceAnalyzer.replayWalk` memoises the replay on the CONTENT of the
// (flat, start board) pair, so a caller can never be served a result for different input. What is
// still worth checking is that a HIT and a MISS agree: the memo is single-entry, so asking about a
// different sequence in between evicts it and forces the next ask to recompute.
//
// If the two ever disagreed, the animation would change depending on what was asked before it -
// the classic cache-staleness bug - so this is checked over a fine beat sweep rather than at a few
// points.
{
  let memoFailures = 0;
  let checks = 0;
  const A = SEQUENCES[0];
  const B = SEQUENCES[1];
  const flatA = seq.flatten(A);
  const totalA = seq.sequenceBeats(flatA, HOME);
  for (let beat = 0; beat <= totalA + 1; beat += 0.25) {
    const hot = seq.evaluateSequence(flatA, beat, HOME);
    seq.evaluateSequence(seq.flatten(B), beat, HOME); // evict: single-entry memo
    const cold = seq.evaluateSequence(flatA, beat, HOME);
    checks++;
    if (pose(hot.board) !== pose(cold.board) || hot.beats !== cold.beats) {
      memoFailures++;
      if (memoFailures <= 3) console.log(`  FAIL beat ${beat}: hot != cold`);
    }
  }
  // The beat total must not depend on which sequence was asked about last either.
  const totalCold = (() => { seq.sequenceBeats(seq.flatten(B), HOME); return seq.sequenceBeats(flatA, HOME); })();
  checks++;
  if (Math.abs(totalCold - totalA) > 1e-9) { memoFailures++; console.log(`  FAIL sequenceBeats ${totalA} != ${totalCold} after eviction`); }
  console.log(
    memoFailures === 0
      ? `\nMEMO TRANSPARENCY PASSED: ${checks} hot/cold comparison(s), all identical`
      : `\nMEMO TRANSPARENCY FAILED: ${memoFailures} of ${checks}`,
  );
  failures += memoFailures;
}

// WHAT THE MEMO BUYS. A cache that changes no answer is only worth having if it changes the COST,
// so the same beat sweep is run twice: once normally (memo warm - the UI's case, which asks about
// the same sequence every animation frame), and once asking about a DIFFERENT sequence immediately
// before each query, which evicts the single entry and forces a full replay every time.
{
  const flatA = seq.flatten(SEQUENCES[0]);
  const flatB = seq.flatten(SEQUENCES[1]);
  const N = 3000;
  const sweep = (evict) => {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      if (evict) seq.evaluateSequence(flatB, 0, HOME);
      seq.evaluateSequence(flatA, (i % 120) * 0.25, HOME);
    }
    return performance.now() - t0;
  };
  sweep(false); // warm up the matcher's own caches so the comparison is about the replay memo
  const hot = sweep(false);
  const cold = sweep(true);
  console.log(`\nMEMO COST over ${N} queries:`);
  console.log(`  warm (same sequence, the UI's case) : ${hot.toFixed(1)} ms`);
  console.log(`  cold (evicted before every query)   : ${cold.toFixed(1)} ms`);
  console.log(`  speedup                             : ${(cold / hot).toFixed(1)}x`);
}

process.exit(failures === 0 ? 0 : 1);
