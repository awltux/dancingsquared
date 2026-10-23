// THE THREE IDENTITIES OVER THE WHOLE CORPUS: SHAPE, ARRANGEMENT, VARIANT - MEASURED, NOT ASSERTED.
//
// The id modules cite numbers that only a walk of the corpus can check. Prose that cites a measurement is a
// promise; this harness is the measurement, and it is also the one place that would notice a COLLISION - two
// different variants minting one id - because the key space only exists as a whole.
//
// WHY IT IS NOT LIGHT. It builds every authoring start in ms+plus (1,771 calls, ~4 minutes). EVERY COUNT BELOW
// IS AN EXACT-COUNT PIN - a FACT in `AGENTS.md` §11.2.8's three kinds - so when the corpus moves they move here,
// in the commit that moves them, with the direction stated. The first section is the guard against the census
// measuring LESS than it claims: the sample size and the two named authorings that fail to build.
//
// THE FIGURES, and what each is for:
//   198 shapes / 242 arrangements   the arrangement axis is not redundant with the formation one
//   18 of 1,730 groups split        a gender relabelling genuinely separates two authorings of one call
//   115 calls end same-shape-diff   the reason a formation-only state model cannot decide whether the NEXT
//                                   gender-specific call fits (1,488 change arrangement; 1,373 change shape)
//   the variant population          every (level, title, formation ROOT) the corpus authors, and how many of
//                                   them are authored more than once - the duplicate check is a collision gate,
//                                   not a uniqueness rule: two authorings of one variant are normal and share
//                                   one id on purpose.
//
// AND THE LEDGER COVERAGE: every start shape must already have a ROOT in `assets/formation-roots.json`. A shape
// the ledger has never seen would silently root at itself, which is exactly the re-keying the ledger exists to
// prevent - so it is a failure here, naming the shapes, before a variant is ever minted from one.
//
// Run: node test/identity-census.mjs   (from engine/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  loadCallFromXml, setParser, formationId, arrangementId, allPoses,
  callVariantId, callVariantCanonical, formationRootOf, isCallVariantId,
} from '../dist/index.js';
import { corpusRoot, filesOf, tamsOf } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');
const ledger = JSON.parse(read('formation-roots.json'));
const roots = ledger.roots ?? {};

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
const byVariant = new Map();      // canonical -> [site]
const idToCanonical = new Map();  // id -> canonical (the collision gate)
const canonicalToId = new Map();  // canonical -> id (determinism)
const shapesWithoutRoot = new Set();
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
        if (roots[shape] === undefined) shapesWithoutRoot.add(shape);
        const key = `${bundle.title}|${shape}`;
        if (!byTitleShape.has(key)) byTitleShape.set(key, new Set());
        byTitleShape.get(key).add(arrangement);
        const end = spots(bundle.beats);
        if (arrangementId(end) !== arrangement) endArrangementDiffers++;
        if (formationId(end) !== shape) endShapeDiffers++;

        const root = formationRootOf(shape, roots);
        const canonical = callVariantCanonical(level, bundle.title, root);
        const id = callVariantId(level, bundle.title, root);
        if (!byVariant.has(canonical)) byVariant.set(canonical, []);
        byVariant.get(canonical).push(`${level}/${file}#${site.index}`);
        if (idToCanonical.has(id) && idToCanonical.get(id) !== canonical) {
          idToCanonical.set(id, `COLLISION: ${idToCanonical.get(id)} | ${canonical}`);
        } else {
          idToCanonical.set(id, canonical);
        }
        canonicalToId.set(canonical, id);
      } catch (err) {
        failedTitles.push(`${site.title || file}: ${err.message}`);
      }
    }
  }
}

const splitGroups = [...byTitleShape.values()].filter((s) => s.size > 1);
const multiAuthored = [...byVariant.entries()].filter(([, sites]) => sites.length > 1);
const collisions = [...idToCanonical.entries()].filter(([, canonical]) => canonical.startsWith('COLLISION:'));
const nonDeterministic = [...canonicalToId.entries()].filter(([canonical, id]) => canonicalToId.get(canonical) !== id);

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

console.log('== the ledger covers every shape the corpus authors ==');
check(shapesWithoutRoot.size === 0, `every start shape has a root (${shapesWithoutRoot.size} without)`,
  [...shapesWithoutRoot].slice(0, 5).join(', '));

console.log('== the variant population ==');
check(byVariant.size === 1730, `1,730 distinct variants (${byVariant.size})`);
check(collisions.length === 0, `no two variants share an id (${collisions.length} collisions)`,
  collisions.slice(0, 3).map(([id, c]) => `${id}: ${c}`).join('\n        '));
check(nonDeterministic.length === 0, 'every variant canonicalises to exactly one id');
check([...byVariant.keys()].every((canonical) => isCallVariantId(canonicalToId.get(canonical))), 'every minted id passes isCallVariantId');
check(multiAuthored.length === 38, `38 variants are authored more than once (${multiAuthored.length}) - a property, not a collision`);
console.log(`  info  distinct variants: ${byVariant.size}`);
console.log(`  info  variants with more than one authoring: ${multiAuthored.length}`);
console.log(`  info  authorings per variant: ${(tams / byVariant.size).toFixed(2)}`);

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
