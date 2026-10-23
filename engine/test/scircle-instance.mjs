// ONE TITLE, TWO AUTHORED SETUPS: which one does the engine dance?
//
// `ms/circle.xml` authors `Single Circle Left Full` twice, and the FAR stance comes FIRST in the
// file:
//
//   [0] formation="Facing Dancers Far"   (-3,0) (3,0)   a gap-6 stance
//   [1] formation="Facing Dancers"       (-2,0) (2,0)   a gap-4 stance
//
// `Normal Lines` is pairs at x = +/-2, i.e. the gap-4 shape, so [1] is the correct reading - and the
// interactive apply, the animation, the Call Browser and the Call Editor all have to agree on that.
//
// THE ORDER IS WHAT MAKES IT A TEST. Document order and fit disagree here: [0] is first, [1] fits.
// `parallelApply` used to return on the FIRST variant that tiled and throw `part.error` away, so
// whatever the file listed first won; it now sorts by error and breaks ties on registration order.
// This harness pins the OUTCOME, not the mechanism, so a future rewrite of the selection is free to
// differ as long as the plain stance is the one that dances.
//
// WHAT THIS DOES NOT CLAIM. The reported symptom - the Far stance being used from a Normal Lines
// board - does NOT reproduce at `afaae4a`: at the interactive tolerance Far does not tile at all, so
// first-fit and lowest-error agree and BOTH pick the plain stance. The lowest-error selection is a
// defence against document order deciding a tie, not a cure for a reproduced fault; no board has been
// found on which the two rules disagree about which stance to dance.
//
// THE TOLERANCE IS PART OF THE WITNESS. At the interactive tolerance (DEFAULT_MATCH_MAX + margin,
// 1.5 + 0) only [1] tiles and Far is refused outright. At the search tolerance (6.0) BOTH tile -
// Far at 4.5142, plain at 6.2832 - so a partition run at the wrong tolerance hands Far the win on
// document order. That is why the two tolerance rows below are both asserted.
//
// WHY THIS IS NOT `scircle-probe.mjs`. That file is a DIAGNOSTIC: it prints and never fails. A
// regression needs something that exits non-zero, and it belongs in the gate because the corpus that
// witnesses this is actively edited - if `ms/circle.xml` stops authoring the title twice, or stops
// putting Far first, this harness has lost its subject and should say so rather than pass quietly.
//
// Usage: node engine/test/scircle-instance.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';

const TITLE = 'Single Circle Left Full';
const FROM = 'Normal Lines';
// NOT imported: these two come from `constants.ts` / `config.ts`, and a probe hard-codes them on
// purpose so that moving one fails here loudly instead of being followed silently.
const DEFAULT_MATCH_MAX = 1.5;
const SEARCH_MATCH_MAX = 6.0;

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(corpusRoot(), p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// The two setups, taken from the app's own registration input: the comment-stripped index list that
// `poc/src/data.ts` `registrationXml` indexes with `entry.tamIndices`. The comments are stripped
// because the app strips them (`afaae4a`) - a raw-text read here would be indexing a list the app
// never builds.
const circleXml = read('ms/circle.xml');
const blocks = circleXml.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) || [];
const tams = blocks.filter((b) => new RegExp(`title="${TITLE}"`).test(b));
const formOf = (x) => (x.match(/formation="([^"]*)"/) ?? [])[1];

console.log('== the corpus this pins ==');
console.log(`  ${TITLE}: ${tams.length} authored setup(s) in ms/circle.xml`);
tams.forEach((t, i) => console.log(`    [${i}] formation="${formOf(t)}"`));

// A missing or reshaped witness is a FAILED harness, not a skipped one: this file exists to notice
// exactly that, and skipping would turn the corpus edit into a silent loss of coverage.
check(tams.length === 2, `${TITLE} is authored twice in ms/circle.xml (found ${tams.length})`);
if (tams.length !== 2) {
  console.log(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
check(formOf(tams[0]) === 'Facing Dancers Far', `[0] is the "Facing Dancers Far" stance (got "${formOf(tams[0])}")`);
check(formOf(tams[1]) === 'Facing Dancers', `[1] is the plain "Facing Dancers" stance (got "${formOf(tams[1])}")`);

const mkSeq = (xml) =>
  new Sequencer(read('moves.xml'), read('formations.xml'),
    [{ name: TITLE, xml: `<calls>\n${xml}\n</calls>` }]);

// The app registers BOTH setups under one title, in file order - Far first.
const seq = mkSeq(tams.join('\n'));
const board = seq.boardForFormation(FROM);
const phys = board.dancers.filter((d) => !d.isGhost);
const variants = seq.library.matchableVariants(TITLE);

console.log(`\n== the variants the library holds, in registration order ==`);
variants.forEach((v, i) => console.log(`  [${i}] formation="${v.formation}" built dancers=${v.dancers.length} setup ${v.dancers.map((d) => `(${d.x},${d.y})`).join(' ')}`));
check(variants.length === 2, `both setups are registered under the one title (got ${variants.length})`);
check(variants[0]?.formation === 'Facing Dancers Far', 'the Far setup is registered FIRST (the order that made this a bug)');

const setupOf = (v) => v.dancers.map((d) => seq.library.variantMatchable(d));
const tileOf = (v, tol) => {
  const setup = setupOf(v);
  const k = setup.length;
  if (k <= 1 || k >= phys.length || phys.length % k !== 0) return null;
  const full = seq.applicator.partition(setup, phys, tol) ?? seq.applicator.partitionPartial(setup, phys, tol);
  return full ? { error: full.error, groups: full.groups } : null;
};

console.log(`\n== tiling at the INTERACTIVE tolerance (${DEFAULT_MATCH_MAX} + margin ${seq.config.matchMargin}) ==`);
const tight = variants.map((v) => tileOf(v, DEFAULT_MATCH_MAX + seq.config.matchMargin));
tight.forEach((t, i) => console.log(`  [${i}] "${variants[i].formation}": ${t ? `err=${t.error.toFixed(4)} groups=${t.groups.length}` : 'does NOT tile'}`));
check(tight[0] === null, 'the Far setup does NOT tile a Normal Lines board at the interactive tolerance');
check(tight[1] !== null, 'the plain setup DOES tile it');
check(tight[1] !== null && tight[1].error < 1e-9, `the plain setup tiles it at error 0 (got ${tight[1] ? tight[1].error.toFixed(4) : 'n/a'})`);

console.log(`\n== what the app actually applies ==`);
const res = seq.applyToBoard(board, TITLE);
check(res.legal === true, 'the call applies legally from Normal Lines');
const applied = res.parallel ? variants.indexOf(res.parallel.variant) : -1;
check(applied === 1, `it applies variant [1], the plain "Facing Dancers" stance (got ${applied >= 0 ? `[${applied}] "${variants[applied].formation}"` : 'a whole-board reading'})`);
check(res.parallel?.groups.length === 4, `it tiles the board into 4 pairs (got ${res.parallel?.groups.length ?? 0})`);
const grouping = (res.parallel?.groups ?? []).map((g) => g.map((d) => d.id).sort((a, b) => a - b).join('+')).join(' ');
check(grouping === '1+8 2+7 3+6 4+5', `the pairs are the facing pairs (got "${grouping}")`);

// ---- the selection rule itself, exercised where both setups tile -------------------------------
//
// At `SEARCH_MATCH_MAX` both setups tile this board, so the tolerance can no longer be what picks the
// winner - only the ORDER inside `parallelApply` can. At that tolerance the lowest-error setup is
// also the FIRST one (Far 4.5142 against plain 6.2832), so this row does NOT distinguish lowest-error
// from first-fit: both rules say Far. It is here because it pins that the loose tolerance does not
// silently change the answer, and because the tiling pair it prints is the evidence a future reader
// needs. The weakest of the three rows by construction, and labelled as such rather than dressed up.
console.log(`\n== tiling at the SEARCH tolerance (${SEARCH_MATCH_MAX}) - both setups fit ==`);
const loose = variants.map((v) => tileOf(v, SEARCH_MATCH_MAX));
loose.forEach((t, i) => console.log(`  [${i}] "${variants[i].formation}": ${t ? `err=${t.error.toFixed(4)} groups=${t.groups.length}` : 'does NOT tile'}`));
check(loose[0] !== null && loose[1] !== null, 'at this tolerance BOTH setups tile, so the choice is made inside parallelApply');

const direct = seq.applicator.parallelApply(board, TITLE, true, SEARCH_MATCH_MAX);
check(direct !== null, 'parallelApply returns a tiling at the search tolerance');
if (direct) {
  const chosen = variants.indexOf(direct.parallel.variant);
  const best = loose.map((t, i) => (t ? { i, error: t.error } : null)).filter(Boolean).sort((a, b) => a.error - b.error)[0];
  console.log(`  parallelApply chose [${chosen}] error=${direct.error.toFixed(4)}; lowest error available is [${best.i}] error=${best.error.toFixed(4)}`);
  check(chosen === best.i, `it chose the LOWEST-ERROR tiling (chose [${chosen}], best is [${best.i}])`);
  check(Math.abs(direct.error - best.error) < 1e-9, `the reported error is the chosen tiling's own (${direct.error.toFixed(4)})`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
