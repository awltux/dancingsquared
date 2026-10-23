// THE ARRANGEMENT POPULATION, MEASURED, NOT ASSERTED.
//
// `arrangement-id.ts` cites numbers that only a walk of the corpus can check: how far the arrangement universe
// sits above the formation one, how often a gender relabelling splits a call's shape, and how often a call
// ENDS on the shape it started from in a different arrangement. Prose that cites a measurement is a promise;
// this harness is the measurement.
//
// WHY IT IS NOT LIGHT. It builds every authoring start in ms+plus (1,771 calls, ~4 minutes). The numbers are
// FACTS about the corpus: when the corpus moves they must move here, in the commit that moves them, and the
// direction has to be stated.
//
// EVERY COUNT BELOW IS AN EXACT-COUNT PIN - a FACT, in `AGENTS.md` §11.2.8's three kinds - and not a ceiling.
// The check that guards against the census measuring LESS than it claims is the first section: the sample size
// and the two named authorings that fail to build.
//
// THE FIGURES, and what each one is for:
//   198 shapes / 242 arrangements   the arrangement axis is not redundant with the formation one
//   18 of 1,730 groups split        a gender relabelling genuinely separates two authorings of one call
//   115 calls end same-shape-diff   the reason a formation-only state model cannot decide whether the NEXT
//                                   gender-specific call fits (1,488 change arrangement; 1,373 change shape)
//
// Run: node test/arrangement-census.mjs   (from engine/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { loadCallFromXml, setParser, formationId, arrangementId, allPoses } from '../dist/index.js';
import { filesOf, tamsOf } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'assets');
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

/** The two levels the book draws from; the census's population is stated, not implied. */
const LEVELS = ['ms', 'plus'];

const shapes = new Set();
const arrangements = new Set();
const byTitleShape = new Map();
const failedTitles = [];
let tams = 0;
let genderSpecific = 0;
let endArrangementDiffers = 0;
let endShapeDiffers = 0;

for (const level of LEVELS) {
  for (const file of filesOf(level)) {
    const xml = read(`${level}/${file}`);
    for (const site of tamsOf(level, file)) {
      tams++;
      try {
        const bundle = loadCallFromXml(xml, movesXml, formationsXml, site.index, true);
        if (bundle.genderSpecific) genderSpecific++;
        const spots = (t) => ({
          dancers: allPoses(bundle, t).map((p, i) => ({ ...p, gender: bundle.dancers[i].gender })),
        });
        const start = spots(0);
        const shape = formationId(start);
        const arrangement = arrangementId(start);
        shapes.add(shape);
        arrangements.add(arrangement);
        const key = `${bundle.title}|${shape}`;
        if (!byTitleShape.has(key)) byTitleShape.set(key, new Set());
        byTitleShape.get(key).add(arrangement);
        const end = spots(bundle.beats);
        if (arrangementId(end) !== arrangement) endArrangementDiffers++;
        if (formationId(end) !== shape) endShapeDiffers++;
      } catch (err) {
        failedTitles.push(`${site.title || file}: ${err.message}`);
      }
    }
  }
}

const splitGroups = [...byTitleShape.values()].filter((s) => s.size > 1);

console.log('== the sample ==');
check(tams === 1771, `ms+plus holds 1,771 tams (${tams})`);
check(failedTitles.length === 2, `exactly the 2 known authorings fail to build (${failedTitles.length})`, failedTitles.join('; '));
check(shapes.size > 0, 'the sweep measured something (a zero would be a coverage gap, not an absence)');

console.log('== the arrangement axis is not the formation axis ==');
check(shapes.size === 198, `198 distinct start shapes (${shapes.size})`);
check(arrangements.size === 242, `242 distinct start arrangements (${arrangements.size})`);
check(arrangements.size > shapes.size, 'the arrangement universe is strictly larger than the shape universe');

console.log('== a gender relabelling splits a call ==');
check(byTitleShape.size === 1730, `1,730 (title, shape) groups (${byTitleShape.size})`);
check(splitGroups.length === 18, `18 of them carry more than one arrangement (${splitGroups.length})`);

console.log('== and a call can end where it started, in another arrangement ==');
check(genderSpecific === 157, `157 authorings are gender-specific (${genderSpecific})`);
check(endArrangementDiffers === 1488, `1,488 authorings end in a different arrangement (${endArrangementDiffers})`);
check(endShapeDiffers === 1373, `1,373 end in a different shape (${endShapeDiffers})`);
check(endArrangementDiffers - endShapeDiffers === 115, `115 end in the SAME shape in a different arrangement (${endArrangementDiffers - endShapeDiffers})`);

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
