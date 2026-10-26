// A PARTNER CALL NEEDS A BOARD THAT KNOWS ITS COUPLES.
//
// REPORTED: "Drill: From 'Right and Left Grande Circle' I'm offered 'Dosado your partner' as the valid answer. I'm not
// sure that is a legal call from that position."
//
// It was legal by the only test the applicator made — a call applies by tiling the board with one of its authored
// formations, and `Dosado your Partner` is authored from `Adjacent Dancers Close`, a shape a grand circle provides four
// times over (MEASURED: four groups, 1+2 3+4 5+6 7+8, each 2.00 units apart). Nothing read the word "Partner", and the
// board could not have supplied it: a formation the couple registry covers stands up with home couples, every other one
// stands up ANONYMOUS with `UNKNOWN_COUPLE` for all eight — which `constants.ts` says nothing may treat as a couple.
//
// THE RULE IS IN `relations.ts` AND THIS IS ITS GATE: the title decides (not the formation), a board that carries home
// couples is unaffected, and the refusal is a VALUE with a sentence rather than a silent "no".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, setParser, relationNamedBy, carriesCouples } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const assets = corpusRoot();

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
// The two boards the report is about: a grand circle (no registry entry, so anonymous) and a squared set (covered).
const circle = seq.boardForFormation('Right and Left Grand Circle');
const square = seq.boardForSetup('Static Square');
check(!!circle && !!square, `both boards stand up (circle ${!!circle}, square ${!!square})`);

console.log('\n== 1. the TITLE decides, not the formation ==');
{
  // The two tams share a formation; only one of them names a relation.
  check(relationNamedBy('Dosado your Partner') === 'your partner', 'Dosado your Partner names your partner');
  check(relationNamedBy('Dosado your Corner') === 'your corner', 'Dosado your Corner names your corner');
  // A CALL, not a formation: `Partner Trade` is a partner call whose title does not spell out "your".
  check(relationNamedBy('Partner Trade') === 'your partner', 'Partner Trade names your partner');
  check(relationNamedBy('Dosado') === null, 'plain Dosado names no relation');
  check(relationNamedBy('Bend the Line') === null, 'and neither does an ordinary call');
}

console.log('\n== 2. the two boards differ in identity, which is the whole premise ==');
{
  check(carriesCouples(square) === true, 'a squared set carries home couples');
  check(carriesCouples(circle) === false, 'a Right and Left Grand Circle carries none (every dancer UNKNOWN_COUPLE)');
}

console.log('\n== 3. the partner call is REFUSED on the anonymous board, and legal on the identified one ==');
{
  const refused = seq.applyToBoard(circle, 'Dosado your Partner');
  check(refused.legal === false, 'Dosado your Partner is refused on the grand circle');
  check(/no home couples/.test(refused.reason ?? ''), `and the reason says why (${JSON.stringify(refused.reason)})`);
  // NEGATIVE CONTROL, MEASURED, and it is the reported defect: with `relationRefusal` removed this reports
  // `legal=true` with four tiled groups (1+2, 3+4, 5+6, 7+8, 2.00 apart) — legal on geometry alone.
  const allowed = seq.applyToBoard(square, 'Dosado your Partner');
  check(allowed.legal === true, 'while the same call is legal from a squared set, where the couples are declared');
  check((allowed.parallel?.groups.length ?? 0) > 0, `and it tiles real groups there (${allowed.parallel?.groups.length ?? 0})`);
}

console.log('\n== 4. an ordinary call on the anonymous board is untouched ==');
{
  // THE GUARD IS ABOUT THE RELATION, not about anonymous boards: a call that names none is applied exactly as before, so
  // the refusal cannot be a blanket ban on the formations most drills start from.
  const plain = seq.applyToBoard(circle, 'Dosado');
  console.log(`  Dosado from the grand circle: legal=${plain.legal} ${plain.reason ?? ''}`);
  check(plain.legal === true, 'plain Dosado still applies from the grand circle');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
