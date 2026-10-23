// WHICH GROUPING DOES THE ANIMATOR THINK IT IS FOLLOWING, AND IS IT THE ONE THAT WAS APPLIED?
//
// `evaluateParallelAt` animates the board GROUP BY GROUP, following each group's authored path. The
// grouping it uses comes from `matchingVariantInfo`, which is a SECOND implementation of the same
// question `parallelApply` answers:
//
//   matchingVariantInfo   first variant where `partitionExists(setup, phys, tol)`   <- FULL tiling
//   parallelApply         first variant where `partition(...) ?? partitionPartial(...)` and every
//                         sub-apply is legal                                        <- either
//
// Two ways they diverge, and both would make the animator run a grouping that was not applied (the
// residual then drags the board back, so the frames lurch):
//   (a) only a PARTIAL tiling exists - `matchingVariantInfo` returns null, so the animator skips
//       group animation entirely and falls back to the pure linear blend, which is the very
//       catastrophe `evaluateParallelAt` exists to prevent;
//   (b) a full tiling exists for variant A but A's sub-apply fails, so `parallelApply` uses B.
//
// This probe reports, for the survey's failing pairs, which of those happened.
//
// Usage: node engine/test/tools/parallel-group-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

// The two tolerances the grouping predicates use. The engine does not re-export them, and hard-coding
// them here is deliberate: a probe must fail loudly if they move, not silently follow.
const DEFAULT_MATCH_MAX = 1.5;
const SEARCH_MATCH_MAX = 6.0;

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

// The Sequencer keeps its collaborators as constructor properties; they are private in the type but
// present at runtime, and this is a diagnostic tool rather than part of the engine.
const app = seq.applicator;
const lib = seq.library;
const matcher = seq.matcher;
if (!app || !lib || !matcher) { console.log('cannot reach the engine internals'); process.exit(1); }

const PAIRS = [
  ['Double Pass Thru', 'Right and Left Thru'],
  ['Double Pass Thru', 'Veer Left'],
  ['Double Pass Thru', 'Box the Gnat'],
  ['Double Pass Thru', 'Square Thru 3'],
  ['Eight Chain Thru', 'Box the Gnat'],
  ['Trade By', 'Box the Gnat'],
  ['Normal Lines', 'Box the Gnat'],
  ['Eight Chain Thru', 'Rollaway'],
  ['Double Pass Thru', 'Flutterwheel'],
  ['Normal Lines', 'Flutterwheel'],
  ['Double Pass Thru', 'Square Thru 4'],
  ['3 and 1 lines #1', 'Right and Left Thru'],
  ['Galaxy 8', 'Right and Left Thru'],
];

for (const [formation, call] of PAIRS) {
  const board = seq.boardForFormation(formation);
  if (!board) { console.log(`${formation}: no such formation`); continue; }
  const r = seq.applyToBoard(board, call);
  if (!r.legal) { console.log(`${call} from ${formation}: REFUSED`); continue; }

  const tol = SEARCH_MATCH_MAX + seq.config.matchMargin;
  const whole = matcher.findMatchingVariant(board, call, DEFAULT_MATCH_MAX + seq.config.matchMargin);
  const phys = board.dancers.filter((d) => !d.isGhost);
  const n = phys.length;
  const variants = lib.matchableVariants(call);

  const rows = [];
  for (const v of variants) {
    const setup = v.dancers.map((d) => lib.variantMatchable(d));
    const k = setup.length;
    if (k <= 1 || k >= n || n % k !== 0) continue;
    const full = app.partition(setup, phys, tol);
    const part = full ?? app.partitionPartial(setup, phys, tol);
    if (!part) continue;
    // Did the applicator's own sub-apply succeed for this variant's grouping?
    let subOk = true;
    for (const g of part.groups) {
      const sub = { dancers: g.map((d) => ({ ...d })) };
      if (!app.applyToBoardInner(sub, call, [], false, false).legal) { subOk = false; break; }
    }
    rows.push({ v, full: !!full, groups: part.groups.length, size: k, subOk });
  }

  // What the ANIMATOR would pick: the first variant with a FULL tiling.
  const anim = rows.find((x) => x.full);
  // What the APPLICATOR picks: the first with any tiling whose sub-applies succeed.
  const applied = rows.find((x) => x.subOk);

  const label = (x) => (x ? `${x.size}-dancer x${x.groups} ${x.full ? 'FULL' : 'partial'}${x.subOk ? '' : ' SUBFAIL'}` : 'none');
  const same = anim?.v === applied?.v;
  console.log(`\n${call} from ${formation}   whole-board match: ${whole ? 'YES' : 'no'}`);
  console.log(`  variants offering a tiling: ${rows.length}`);
  console.log(`  animator (full tiling only): ${label(anim)}`);
  console.log(`  applicator (partial ok)    : ${label(applied)}`);
  console.log(`  ${same ? 'AGREE' : '*** DISAGREE ***'}${anim === undefined && applied !== undefined ? '   <- animator has NO variant, so it falls back to the linear blend' : ''}`);
}
