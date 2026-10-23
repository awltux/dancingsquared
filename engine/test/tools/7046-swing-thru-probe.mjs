// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// WHY `Swing Thru` HAS NO BEATS ON THE BOARD ceder-7046 REACHES.
//
// ceder-7046 is `Right and Left Thru / Flutterwheel / Star Thru / Swing Thru / Right and Left Grand`
// from home. Step 4 (`Swing Thru`) is charged **0 beats** by `replayWalk`, so the walk-through cannot
// play it, and `evaluateSequence` then aborts the whole animation and returns the board BEFORE step 4
// (`Double Pass Thru`). That is the reported "last frame jumps the board back".
//
// `applyToBoard` applies the same call on the same board happily, so the two disagree. This prints
// every predicate either side of the disagreement.
//
// Usage: node engine/test/tools/7046-swing-thru-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
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

// The two tolerances `matchingVariantInfo` and `parallelApply` use.
const DEFAULT_MATCH_MAX = 1.5;
const SEARCH_MATCH_MAX = 6.0;
const app = seq.applicator;
const lib = seq.library;
const matcher = seq.matcher;

const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}(${d.x.toFixed(1)},${d.y.toFixed(1)})@${Math.round((d.heading * 180) / Math.PI)}`)
  .join(' ');

const mod = JSON.parse(readFileSync(path.join(root, 'modules', 'zero_line', 'static_set', '7046.json'), 'utf8'));
const STEPS = mod.steps;

// Walk the FIRST THREE steps only, to get the board `Swing Thru` starts from.
let board = seq.boardForFormation('Static Square');
for (const s of STEPS.slice(0, 3)) {
  const r = seq.applyToBoard(board, s);
  if (!r.legal) { console.log(`REFUSED at ${s}: ${r.reason}`); process.exit(1); }
  board = r.board;
}
const CALL = STEPS[3];
console.log(`module ${mod.name}, steps: ${STEPS.join(' | ')}`);
console.log(`board entering "${CALL}": [${seq.knownFormation(board)}]\n  ${pose(board)}\n`);

console.log(`is it the LIBRARY's Double Pass Thru?`);
const libDPT = seq.boardForFormation('Double Pass Thru');
console.log(`  library: ${pose(libDPT)}`);
console.log(`  reached: ${pose(board)}`);
{
  const a = board.dancers.map((d) => `${d.id}@${d.x.toFixed(1)},${d.y.toFixed(1)},${d.heading.toFixed(3)}`).sort().join('|');
  const b = libDPT.dancers.map((d) => `${d.id}@${d.x.toFixed(1)},${d.y.toFixed(1)},${d.heading.toFixed(3)}`).sort().join('|');
  console.log(`  identical (id+position+heading): ${a === b ? 'YES' : 'NO'}`);
  const pairs = (bb) => {
    // Which dancers stand as a couple: 2.0 apart AND facing opposite?
    const out = [];
    for (let i = 0; i < bb.dancers.length; i++) {
      for (let j = i + 1; j < bb.dancers.length; j++) {
        const d = Math.hypot(bb.dancers[i].x - bb.dancers[j].x, bb.dancers[i].y - bb.dancers[j].y);
        if (Math.abs(d - 2) < 0.35) out.push(`${bb.dancers[i].id}-${bb.dancers[j].id}`);
      }
    }
    return out.sort().join(' ');
  };
  console.log(`  2.0-apart pairs  library: ${pairs(libDPT)}`);
  console.log(`  2.0-apart pairs  reached: ${pairs(board)}`);
}

const r = seq.applyToBoard(board, CALL);
console.log(`\napplyToBoard("${CALL}") = ${r.legal ? `LEGAL -> [${seq.knownFormation(r.board)}]` : `REFUSED - ${r.reason}`}`);
if (r.legal) {
  console.log(`  its board: ${pose(r.board)}`);
  console.log(`  ApplyResult.parallel: ${r.parallel ? `variant with ${r.parallel.variant.dancers.length} dancers, ${r.parallel.groups.length} group(s) of [${r.parallel.groups.map((g) => g.map((d) => d.id).join('+')).join('] [')}]` : 'NOT SET'}`);
}
const whole = matcher.findMatchingVariant(board, CALL, DEFAULT_MATCH_MAX + seq.config.matchMargin);
console.log(`\nwhole-board findMatchingVariant(DEFAULT ${DEFAULT_MATCH_MAX}) = ${whole ? 'FOUND' : 'none'}`);

console.log(`\nper variant, the four predicates either side uses:`);
console.log(`  variant      k   partition(DEF)  partitionPartial(DEF)  partition(SEARCH)  partitionPartial(SEARCH)  subApplies`);
const phys = board.dancers.filter((d) => !d.isGhost);
const n = phys.length;
let order = 0;
for (const v of lib.matchableVariants(CALL)) {
  const setup = v.dancers.map((d) => lib.variantMatchable(d));
  const k = setup.length;
  if (k <= 1 || k >= n || n % k !== 0) continue;
  order++;
  const pDef = !!app.partition(setup, phys, DEFAULT_MATCH_MAX + seq.config.matchMargin);
  const pDefPart = !!app.partitionPartial(setup, phys, DEFAULT_MATCH_MAX + seq.config.matchMargin);
  const pSearch = !!app.partition(setup, phys, SEARCH_MATCH_MAX + seq.config.matchMargin);
  const pSearchPart = !!app.partitionPartial(setup, phys, SEARCH_MATCH_MAX + seq.config.matchMargin);
  // `parallelApply` ALSO requires every sub-apply to succeed; `matchingVariantInfo` does not.
  let subOk = '-';
  const anyTiling = app.partition(setup, phys, DEFAULT_MATCH_MAX + seq.config.matchMargin)
    ?? app.partitionPartial(setup, phys, DEFAULT_MATCH_MAX + seq.config.matchMargin);
  if (anyTiling) {
    subOk = 'yes';
    for (const g of anyTiling.groups) {
      if (!app.applyToBoardInner({ dancers: g.map((d) => ({ ...d })) }, CALL, [], false, false).legal) { subOk = 'NO'; break; }
    }
  }
  console.log(`  #${String(order).padStart(2)} k=${k}      ${String(pDef).padEnd(14)} ${String(pDefPart).padEnd(22)} ${String(pSearch).padEnd(18)} ${String(pSearchPart).padEnd(25)} ${subOk}`);
}

console.log(`\nthe two implementations, in the order they run:`);
console.log(`  matchingVariantInfo  : whole(DEFAULT) -> first variant with partitionExists(SEARCH)   [FULL tiling only]`);
console.log(`  parallelApply        : whole(DEFAULT) -> first variant with partition(DEF) ?? partitionPartial(DEF)`);
console.log(`                         AND every sub-apply legal`);
console.log(`\nsequenceBeats(["${CALL}"], board) = ${seq.sequenceBeats([CALL], board).toFixed(1)} beats`);
