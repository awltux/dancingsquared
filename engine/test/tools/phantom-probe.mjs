// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// ONE PHANTOM, CHECKED BY HAND.
//
// `anim-convergence.mjs` reports 2466 (board, call) pairs where `applyToBoard` REFUSES the call but
// `sequenceBeats` charges it beats. That is a real disagreement - the walk says time passed and the
// applicator says nothing happened - but 2466 is a large number and the blast radius of changing the
// walk's predicate is unknown, so this checks a couple of them by hand before anyone acts on it.
//
// The suspected cause: `matchingVariantInfo` partitions at SEARCH tolerance, while `applyToBoardInner`
// hands `parallelApply` the DEFAULT tolerance. The walk's predicate is the LOOSER of the two, which is
// the opposite direction from the grouping bug fixed in `parallel-group-probe.mjs`.
//
// Usage: node engine/test/tools/phantom-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const SAMPLES = [
  ['Columns', 'Square Thru 4'],
  ['T-Bone LRDU', 'Square Thru 4'],
  ['3/4 Lines RH', 'Bend the Line'],
  ['Normal Lines', 'Square Thru 4'],
  ['Eight Chain Thru', 'Square Thru 4'],
];

for (const [formation, call] of SAMPLES) {
  const b = seq.boardForFormation(formation);
  if (!b) { console.log(`${formation}: no such formation`); continue; }
  const r = seq.applyToBoard(b, call);
  const beats = seq.sequenceBeats([call], b);
  console.log(`\n${call} from ${formation}`);
  console.log(`  applyToBoard : ${r.legal ? 'LEGAL' : `REFUSED - ${r.reason}`}`);
  console.log(`  sequenceBeats: ${beats.toFixed(1)} beats`);
  console.log(`  ${!r.legal && beats > 0 ? '*** PHANTOM: beats charged for a refused call ***' : r.legal && beats > 0 ? 'consistent' : 'consistent (both refuse / both zero)'}`);
}
