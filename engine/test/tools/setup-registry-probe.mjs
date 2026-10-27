// STEP 3 PROBE: the setup registry, checked against every measurement that exists.
//
// A SETUP is a formation plus its couple numbering. The registry says, per formation name, which All8
// code is its zero setup and - the part a code cannot carry, because it admits four boards - which
// couple stands on which spot. This checks the registry three ways:
//
//   1. the CANONICAL selection reproduces all8's own board on all 26 corpus alignments that publish a
//      diagram (the measurement the rule was derived from, re-run through the shipped function);
//   2. `Normal Lines` -> `L1o` is the ZERO LINE by property, not by assertion: in sequence, and every
//      dancer facing a dancer of a corner couple;
//   3. every entry stands up a board that reads back as its own code and carries full identity.
//
// Usage: node engine/test/tools/setup-registry-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer, setParser, setupForFormation, boardsForAlignment, boardFromDiagram, parseAlignmentId,
  arrangementFor, sequenceFor, canonicalBoard, FORMATION_SETUP_CODE, FORMATIONS_FOR_LETTER,
  coupleToSpot, rotationBetweenBoards, letterForFormation,
} from '../../dist/index.js';
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
const templateFor = (name) => seq.boardForFormation(name);
let failures = 0;
const fail = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

// ---------------------------------------------------------------- 1. the canonical selection
console.log('=== 1. canonicalBoard reproduces all8\'s own board on every published diagram ===');
const corpus = JSON.parse(readFileSync(path.join(root, 'engine', 'test', 'fixtures', 'all8-getouts.json'), 'utf8'));
let checked = 0, same = 0;
for (const a of corpus.alignments) {
  const spec = parseAlignmentId(a.id);
  if (!spec) continue;
  const template = (FORMATIONS_FOR_LETTER[spec.letter] ?? []).map(templateFor).find(Boolean);
  if (!template) continue;
  const fromDiagram = boardFromDiagram(template, spec.letter, spec.arrangement, a.diagram);
  if (!fromDiagram.board) continue;
  const res = boardsForAlignment(template, spec);
  if (!res.boards.length) continue;
  // The index all8's own board sits at, and the index the shipped selection picks.
  const listed = res.boards.findIndex((b) => rotationBetweenBoards(b, fromDiagram.board) === 0);
  const canonical = canonicalBoard(res.boards, spec.letter, spec);
  const chosen = res.boards.indexOf(canonical);
  checked++;
  if (listed === chosen && listed >= 0) same++;
  else fail(`${a.id}: all8 is at ${listed}, canonicalBoard picks ${chosen}`);
}
console.log(`  ${same} of ${checked} alignments: the shipped canonical board IS all8's own`);
if (same === checked && checked > 0) ok('the selection rule reproduces every published board it was measured on');

// ---------------------------------------------------------------- 1b. the one code the diagrams miss
console.log('\n=== 1b. which enumeration index is the ZERO LINE for [L]? (L1o is not in the diagram corpus) ===');
{
  const template = seq.boardForFormation('Normal Lines');
  const res = boardsForAlignment(template, parseAlignmentId('L1o'));
  if (!res.boards.length) fail('L1o admits no board at all');
  else {
    const ahead = (b, d) => {
      const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
      let best = null;
      for (const o of b.dancers) {
        if (o.id === d.id) continue;
        const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy);
        if (dist < 0.5 || (dx * hx + dy * hy) / dist < 0.99) continue;
        if (!best || dist < best.dist) best = { o, dist };
      }
      return best?.o ?? null;
    };
    console.log('  NOTE: the zero-line property is the SAME on all four boards - it is rotation-invariant,');
    console.log('  because relabelling couples does not change who faces whom. So the property CONFIRMS that');
    console.log('  a code is a zero line but cannot SELECT among the four, which is exactly why the canonical');
    console.log('  index has to be measured off a diagram and the corpus carries no L1o diagram.');
    res.boards.forEach((b, i) => {
      const s = sequenceFor(b).code;
      const corners = b.dancers.every((d) => {
        const o = ahead(b, d);
        if (!o || d.couple === 0 || o.couple === 0) return false;
        return ((o.couple - d.couple) % 4 + 4) % 4 === 3 || ((d.couple - o.couple) % 4 + 4) % 4 === 3;
      });
      console.log(`  index ${i}: sequence ${s ?? 'null'}, every dancer faces a corner: ${corners}`);
    });

    // AN 'o' BOARD IS A 'p' BOARD WITH THE COUPLES RELABELLED BY +2 (opposite = partner + 2), so the
    // index can be DERIVED from the measured L1p one instead of guessed: the candidate that turns the
    // measured L1p board into a member of the L1o enumeration is the board that sits where L1o's does.
    console.log('\n  deriving the L1o index from the measured L1p index:');
    const corpus = JSON.parse(readFileSync(path.join(root, 'engine', 'test', 'fixtures', 'all8-getouts.json'), 'utf8'));
    const l1p = corpus.alignments.find((a) => a.id === 'L1p');
    const all8L1p = boardFromDiagram(template, 'L', 0, l1p.diagram).board;
    const l1pRes = boardsForAlignment(template, parseAlignmentId('L1p'));
    const l1pIndex = l1pRes.boards.findIndex((b) => rotationBetweenBoards(b, all8L1p) === 0);
    console.log(`    the measured L1p index (all8's own board) is ${l1pIndex}`);
    const all8L1oShape = all8L1p.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}:${((d.couple - 1 + 2) % 4) + 1}`).sort().join(' ');
    res.boards.forEach((b, i) => {
      const shape = b.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}:${d.couple}`).sort().join(' ');
      const isTarget = shape === all8L1oShape;
      const rotatedToL1p = l1pRes.boards.findIndex((x) => rotationBetweenBoards(x, b) === 2);
      console.log(`    L1o index ${i}: equals all8's L1p relabelled by -2? ${isTarget}; rotates to L1p index ${rotatedToL1p}`);
    });
  }
}

// ---------------------------------------------------------------- 2. the zero line by property
console.log('\n=== 2. Normal Lines -> L1o is a ZERO LINE by property ===');
{
  const setup = setupForFormation('Normal Lines', templateFor);
  if (!setup) fail('no setup for Normal Lines');
  else {
    const f = sequenceFor(setup.board);
    const ahead = (b, d) => {
      const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
      let best = null;
      for (const o of b.dancers) {
        if (o.id === d.id) continue;
        const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy);
        if (dist < 0.5 || (dx * hx + dy * hy) / dist < 0.99) continue;
        if (!best || dist < best.dist) best = { o, dist };
      }
      return best?.o ?? null;
    };
    // A zero line: in sequence, and every dancer facing a dancer of a CORNER couple (offset +3).
    const corners = setup.board.dancers.every((d) => {
      const o = ahead(setup.board, d);
      if (!o || d.couple === 0 || o.couple === 0) return false;
      return ((o.couple - d.couple) % 4 + 4) % 4 === 3 || ((d.couple - o.couple) % 4 + 4) % 4 === 3;
    });
    console.log(`  setup code ${setup.code}, sequence ${f.code} (${f.boys?.join('')}/${f.girls?.join('')})`);
    console.log(`  every dancer faces a corner couple: ${corners}`);
    if (f.code === 1 && corners) ok('L1o is in sequence AND every dancer faces a corner - the zero-line property');
    else fail(`L1o is not a zero line by property (sequence ${f.code}, corners ${corners})`);
  }
}

// ---------------------------------------------------------------- 3. every registry entry
console.log('\n=== 3. every registry entry stands up a board that reads back as its own code ===');
for (const [formation, code] of Object.entries(FORMATION_SETUP_CODE)) {
  const setup = setupForFormation(formation, templateFor);
  const spec = parseAlignmentId(code);
  if (!setup) {
    // Say WHICH precondition failed rather than one opaque message.
    const template = templateFor(formation);
    const why = !letterForFormation(formation) ? 'no All8 letter'
      : !template ? 'no template from boardForFormation'
        : !boardsForAlignment(template, parseAlignmentId(code)).boards.length ? `no board is in the state ${code}` : 'unknown';
    fail(`${formation}: no setup stood up (${why})`);
    continue;
  }
  if (!spec) { fail(`${formation}: "${code}" is not a parseable code`); continue; }
  const readArr = arrangementFor(setup.board, setup.letter);
  const seqCode = sequenceFor(setup.board).code;
  const known = setup.board.dancers.filter((d) => d.couple !== 0).length;
  const assignmentSize = Object.keys(coupleToSpot(setup.board)).length;
  const notes = [];
  const problems = [];
  if (readArr.number === spec.arrangement || readArr.candidates.includes(spec.arrangement)) notes.push('arrangement ok');
  else { notes.push(`ARRANGEMENT ${readArr.number ?? readArr.candidates.join('/') ?? 'null'} != ${spec.arrangement}`); problems.push('arrangement'); }
  if (spec.sequence === undefined || seqCode === spec.sequence) notes.push(`sequence ${seqCode ?? '?'} ok`);
  else { notes.push(`SEQUENCE ${seqCode ?? 'null'} != ${spec.sequence}`); problems.push('sequence'); }
  if (known === 8) notes.push('identity 8/8');
  else { notes.push(`IDENTITY ${known}/8`); problems.push('identity'); }
  if (assignmentSize === 8) notes.push('assignment 8 spots');
  else { notes.push(`ASSIGNMENT ${assignmentSize} spots`); problems.push('assignment'); }
  console.log(`  ${formation.padEnd(26)} ${code.padEnd(7)} ${notes.join(', ')}`);
  if (problems.length) fail(`${formation}: ${problems.join(', ')}`);
  if (setup.formation !== formation) fail(`${formation}: setup reports formation ${setup.formation}`);
}

// (section 4 - the compliance levels - went with `compliesWithSetup`, which had no production caller.)

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
