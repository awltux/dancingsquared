// DIFFERENTIAL CAPTURE FOR `CallApplicator.partition`.
//
// `partition` searches for a tiling and returns the FIRST one it finds, so a refactor that preserves
// the SET of valid tilings but changes the ORDER it searches would change which tiling the engine
// uses - a silent behaviour change. This records, for a fixed scenario matrix, the exact partition
// returned and the total error, so a rewrite can be compared against it byte for byte.
//
//   node engine/test/tools/partition-capture.mjs > partition-golden.txt     (before)
//   node engine/test/tools/partition-capture.mjs > partition-after.txt      (after, then diff)
//
// The scenarios are the corpus's own: real calls, on the real named formations, at both tolerances.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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

const FORMATIONS = [
  'Static Square', 'Squared Set', 'Normal Lines', 'Normal Lines Compact', 'Facing Couples',
  'Facing Dancers', 'Facing Dancers Far', 'Circle', 'Ocean Waves', 'Two-Faced Lines',
  'Eight Chain Thru', 'Trade By', 'Double Pass Thru',
];
const CALLS = [
  'Single Circle Left Full', 'Single Circle Right Full', 'Circle Four Left Full', 'Circle Left',
  'Right and Left Thru', 'Swing Thru', 'Pass Thru', 'Box the Gnat', 'Trade', 'Flutterwheel',
  'Square Thru 4', 'Veer Left', 'Double Pass Thru', 'Touch a Quarter', 'Step to a Wave',
  'Partner Trade', 'Wheel and Deal', 'Sweep a Quarter',
];
const TOLS = [1.5, 6.0];

const rows = [];
const key = (groups) =>
  groups.map((g) => g.map((d) => d.id).sort((a, b) => a - b).join('+')).join(' ');

for (const fname of FORMATIONS) {
  const board = seq.boardForFormation(fname);
  if (!board) { rows.push(`${fname}\tNOT A FORMATION`); continue; }
  const phys = board.dancers.filter((d) => !d.isGhost);
  for (const call of CALLS) {
    const variants = seq.library.matchableVariants(call);
    if (variants.length === 0) { rows.push(`${fname}\t${call}\tNO VARIANTS`); continue; }
    for (const [vi, v] of variants.entries()) {
      const setup = v.dancers.map((d) => seq.library.variantMatchable(d));
      for (const tol of TOLS) {
        let full = null;
        let partial = null;
        try { full = seq.applicator.partition(setup, phys, tol); } catch (e) { full = { throw: String(e) }; }
        try { partial = seq.applicator.partitionPartial(setup, phys, tol); } catch (e) { partial = { throw: String(e) }; }
        const fmt = (r) =>
          r === null ? 'null'
            : r.throw ? `THROW ${r.throw}`
              : `${r.error.toFixed(6)} [${key(r.groups)}]`;
        rows.push(`${fname}\t${call}\tv${vi}(${v.formation ?? 'inline'} n=${setup.length})\ttol=${tol}\tfull=${fmt(full)}\tpartial=${fmt(partial)}`);
      }
    }
  }
}

console.log(`# partition-capture: ${rows.length} scenario rows`);
console.log(`# engine build: ${new Date().toISOString()}`);
for (const r of rows) console.log(r);
