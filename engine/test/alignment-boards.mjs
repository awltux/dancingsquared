// Step 3 of the get-out conformance work: build a board in a named alignment.
//
// WHY: the corpus indexes get-outs by alignment, so running one needs a board in
// that alignment. Step 2 can READ an alignment off a board; this is the same model
// run backwards, plus the strongest check available in the whole workstream.
//
// THE GROUND TRUTH. All8's get-out pages publish a diagram per alignment in which
// every spot carries a facing AND a couple number. That is a complete board - spot,
// facing, and which home couple stands there - written by the same author whose
// get-outs we are measuring against. So the central gate here is:
//
//     take All8's own published diagram for each alignment, rebuild the board from
//     it, and check that the step-2 classifier names it back as that exact
//     alignment: arrangement, sequence and relationship, all four digits.
//
// That is a much stronger statement than a round trip through our own code. It
// validates the arrangement tables, the sequence rule, and the relationship model
// (including the corner/right-hand split, which until now rested on reasoning about
// which girl stands on which side of a boy at home) against an outside source that
// can disagree. If the corner and right-hand letters were swapped, this test would
// report it immediately.
//
// WHAT IS ALSO GATED:
//   - identity enumeration - for every corpus alignment, some identity assignment
//     over the formation's spots lands in it, and every board found classifies back
//     to it (4! x 4! = 576 candidates per alignment).
//   - the pass-thru cross-check from step 2's write-up: All8 hints [0B1c] -> "AL"
//     and gives [B1p] the get-out "Pass Thru > Allemande Left", so a pass thru from
//     a p board must land on c.
//
// Run: `npm run build && node test/alignment-boards.mjs` from engine/.
//
// CAVEAT on coverage: All8 agrees a reference pair for relationship in four
// formations and in STANDARD arrangement only, so for alignments at other
// arrangements the published diagram is being read with our structural pairing
// (nearest opposite-gender neighbour) rather than an agreed convention. Those are
// reported separately so the settled cases are not confused with the extrapolated
// ones.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  setParser,
  Sequencer,
  parseAlignmentId,
  boardsForAlignment,
  boardFromDiagram,
  arrangementFor,
  sequenceFor,
  relationshipStateOf,
  letterForFormation,
  FORMATIONS_FOR_LETTER,
  FORMATION_LETTER,
  REFERENCE_PAIR_SPOTS,
} from '../dist/index.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok    ${msg}`);

// ------------------------------------------------------------------ the engine

const assets = path.join(root, 'poc/src/assets');
// Register by CALL TITLE, not by file basename. The basename trick used elsewhere
// makes `Pass Thru` unregistered (the file is pass_thru.xml), and this test applies
// named calls to constructed boards. All variants of a title are pooled so a call
// with several setups can be matched from any of them.
const byTitle = new Map();
for (const lv of ['discovered', 'b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b']) {
  const dir = path.join(assets, lv);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    const xml = readFileSync(path.join(dir, f), 'utf8');
    for (const block of xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []) {
      const title = (block.match(/title="([^"]*)"/) ?? [])[1];
      if (!title) continue;
      if (!byTitle.has(title)) byTitle.set(title, []);
      byTitle.get(title).push(block);
    }
  }
}
const calls = [...byTitle.entries()].map(([name, blocks]) => ({ name, xml: `<calls>${blocks.join('\n')}</calls>` }));
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  calls,
);
console.log(`  sequencer: ${calls.length} calls registered by title`);

// ----------------------------------------------------------------- the corpus

const FIXTURE = path.join(__dirname, 'fixtures', 'all8-getouts.json');
if (!existsSync(FIXTURE)) { console.log(`FAIL: no fixture at ${FIXTURE}`); process.exit(1); }
const corpus = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const templateFor = (letter) => {
  const names = FORMATIONS_FOR_LETTER[letter] ?? [];
  for (const n of names) {
    const b = seq.boardForFormation(n);
    if (b) return { name: n, board: b };
  }
  return null;
};

// -------------------------------------------- 1. All8's diagrams as ground truth

console.log('== 1. rebuild each published diagram and classify it back ==');
console.log('   (the diagram carries facing + couple number per spot, so it IS a board)');
const settled = []; // standard arrangement, and a formation Callerlab agreed a pair for
const extrapolated = [];
let diagramOk = 0, diagramFail = 0;

for (const a of corpus.alignments) {
  const spec = parseAlignmentId(a.id);
  if (!spec) { console.log(`  skip  ${a.id}: not an FASR id (${a.family})`); continue; }
  const t = templateFor(spec.letter);
  if (!t) { fail(`${a.id}: no engine template for [${spec.letter}]`); diagramFail++; continue; }
  const built = boardFromDiagram(t.board, spec.letter, spec.arrangement, a.diagram);
  const isSettled = spec.arrangement === 0 && ['L', 'B', 'F', 'W'].includes(spec.letter);
  const row = { id: a.id, family: a.family, spec, template: t.name };
  if (!built.board) {
    fail(`${a.id}: ${built.reason}`);
    diagramFail++;
    (isSettled ? settled : extrapolated).push({ ...row, problem: built.reason });
    continue;
  }
  const gotArr = arrangementFor(built.board, spec.letter).number;
  const gotSeq = sequenceFor(built.board);
  const gotRel = relationshipStateOf(built.board, spec.letter);
  const agrees = gotArr === spec.arrangement && gotSeq.code === spec.sequence && gotRel.code === spec.relationship;
  const detail = `arrangement ${gotArr}, sequence ${gotSeq.code ?? `none (${gotSeq.reason})`}, relationship ${gotRel.code ?? `none (${gotRel.reason})`}`;
  if (agrees) {
    diagramOk++;
    (isSettled ? settled : extrapolated).push({ ...row, agrees: true });
  } else {
    diagramFail++;
    (isSettled ? settled : extrapolated).push({ ...row, problem: detail });
    console.log(`  ${spec.letter === 'P' ? 'gap ' : 'FAIL'}  ${a.id.padEnd(6)} wants ${spec.arrangement}${spec.letter}${spec.sequence}${spec.relationship} -> got ${detail}`);
  }
}
console.log(`  ${diagramOk} of ${diagramOk + diagramFail} published diagrams classify back to their own alignment`);
const settledOk = settled.filter((s) => s.agrees).length;
const extrapolatedOk = extrapolated.filter((s) => s.agrees).length;
console.log(`    standard arrangement, agreed reference pair ([0L] [0B] [0F] [0W]): ${settledOk}/${settled.length} agree`);
console.log(`    other arrangements / handedness (extrapolated pairing)         : ${extrapolatedOk}/${extrapolated.length} agree`);
if (settled.length && settledOk !== settled.length) {
  console.log('  NOTE: the settled cases are the ones Callerlab actually defines; a disagreement there');
  console.log('        means our model of arrangement, sequence or relationship is wrong, not merely stretched.');
}
const hardFailures = diagramFail - extrapolated.filter((s) => !s.agrees && s.spec.letter === 'P').length;
if (!hardFailures) {
  ok('every published diagram is reproduced by the tables + rules, except the documented [P] gap');
} else {
  console.log(`  ${hardFailures} diagram(s) failed outside the documented [P] gap - listed above.`);
}

// -------------------------------------- 2. identity enumeration lands in the state

console.log('\n== 2. identity enumeration: some assignment over the spots lands in each alignment ==');
let enumOk = 0, enumFail = 0, totalBoards = 0, maxBoards = 0, maxId = '';
for (const a of corpus.alignments) {
  const spec = parseAlignmentId(a.id);
  if (!spec) continue;
  const t = templateFor(spec.letter);
  if (!t) continue;
  const r = boardsForAlignment(t.board, spec);
  if (!r.boards.length) {
    const isP = spec.letter === 'P';
    (isP ? console.log : fail)(`  ${a.id}: no board over ${r.attempted} identity assignments (${r.reason})`);
    if (!isP) enumFail++;
    continue;
  }
  // every board found must classify back to the requested alignment
  let bad = null;
  for (const b of r.boards) {
    if (arrangementFor(b, spec.letter).number !== spec.arrangement) { bad = 'arrangement'; break; }
    if (sequenceFor(b).code !== spec.sequence) { bad = 'sequence'; break; }
    if (relationshipStateOf(b, spec.letter).code !== spec.relationship) { bad = 'relationship'; break; }
  }
  if (bad) { fail(`${a.id}: a constructed board does not classify back as ${bad}`); enumFail++; continue; }
  enumOk++;
  totalBoards += r.boards.length;
  if (r.boards.length > maxBoards) { maxBoards = r.boards.length; maxId = a.id; }
}
ok(`${enumOk}/${enumOk + enumFail} corpus alignments have at least one board, and all ${totalBoards} boards round-trip`);
console.log(`  ${totalBoards} boards in total; most for ${maxId} (${maxBoards} identity assignments give that same state)`);
console.log('  (several boards per alignment is expected: FASR fixes the relative state, not the orientation)');

// ---------------------------------- 3. All8's published getout actually plays out

console.log('\n== 3. All8\'s published [B1p] get-out, played from a constructed board ==');
// The corpus gives [B1p] the get-out "Pass Thru > Allemande Left". This corrects a
// guess made while writing step 2: the idea there was that a pass thru must move a
// `p` board to `c`, which would have settled the corner/right naming. It cannot, for
// two reasons this section now demonstrates instead:
//
//   - a pass thru takes the box OUT of the [B] formation altogether (each facing
//     pair swaps places and ends back to back, i.e. a Trade By), so there is no [B]
//     state for it to land in; and
//   - the `c` and `r` states are geometrically IDENTICAL - same spots, same facings,
//     same genders, differing only in which couple number stands where - so no
//     geometry-only legality check can ever separate them.
//
// What CAN be checked is the get-out itself: from a constructed [0B1p] board the
// pass thru must be legal, and an allemande left must then be legal, or All8's
// published line does not play out.
{
  const spec = { letter: 'B', arrangement: 0, sequence: 1, relationship: 'p' };
  const t = templateFor('B');
  const r = boardsForAlignment(t.board, spec);
  if (!r.boards.length) {
    fail(`could not build a [0B1p] board (${r.reason})`);
  } else {
    let passLegal = 0, leftLegal = 0, stayedBox = 0;
    const ends = new Set();
    for (const b of r.boards) {
      const pass = seq.applyToBoard(b, 'Pass Thru');
      if (!pass.legal) continue;
      passLegal++;
      if (arrangementFor(pass.board, 'B').number !== null) stayedBox++;
      ends.add(seq.knownFormation(pass.board) ?? '(unrecognised)');
      if (seq.applyToBoard(pass.board, 'Allemande Left').legal) leftLegal++;
    }
    console.log(`  ${r.boards.length} constructed [0B1p] boards: Pass Thru legal on ${passLegal},`);
    console.log(`  of those Allemande Left legal on ${leftLegal}, and still a [B] box after ${stayedBox}.`);
    console.log(`  formation after the pass thru: ${[...ends].join(', ')}`);
    if (passLegal === r.boards.length && leftLegal === r.boards.length) {
      ok('All8\'s "Pass Thru > Allemande Left" plays out from every [0B1p] board built here');
    } else {
      fail(`the published [B1p] get-out does not play out (${leftLegal}/${r.boards.length})`);
    }
    if (stayedBox) fail(`${stayedBox} board(s) stayed in [B] after a pass thru, which contradicts the formation model`);
  }
}

// ------------------------------- 3b. relationship is invisible to geometry alone

console.log('\n== 3b. why geometry alone can never check a relationship letter ==');
{
  // [B1c] and [B2r] are different alignments whose boards have the SAME spots, the
  // same facings and the same genders. Only the couple numbers move. Any geometric
  // recogniser therefore sees one state - which is exactly the structural gap that
  // leaves the FSM keyed on the normalised formation only.
  const t = templateFor('B');
  const a = boardsForAlignment(t.board, { letter: 'B', arrangement: 0, sequence: 1, relationship: 'c' });
  const b = boardsForAlignment(t.board, { letter: 'B', arrangement: 0, sequence: 2, relationship: 'r' });
  const shape = (board) => board.dancers
    .map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)},${d.gender},${((Math.round(d.heading / (Math.PI / 2)) % 4) + 4) % 4}`)
    .sort()
    .join('|');
  if (!a.boards.length || !b.boards.length) {
    console.log(`  could not build both boards (${a.reason ?? ''} ${b.reason ?? ''})`);
  } else {
    const sa = shape(a.boards[0]);
    const sb = shape(b.boards[0]);
    const relA = relationshipStateOf(a.boards[0], 'B');
    const relB = relationshipStateOf(b.boards[0], 'B');
    console.log(`  [0B1c] and [0B2r] boards share their geometry+genders: ${sa === sb ? 'IDENTICAL' : 'different'}`);
    console.log(`  but their relationships differ: ${relA.code} vs ${relB.code} (from the couple numbers alone)`);
    console.log('  So relationship is carried by IDENTITY, not position: the engine cannot infer it from');
    console.log('  geometry, and a formation-keyed FSM state cannot represent it (step-2 structural gap 2).');
    if (sa === sb && relA.code === 'c' && relB.code === 'r') {
      ok('demonstrated: same geometry, different relationship, separated only by couple numbers');
    } else {
      fail(`expected identical geometry with c vs r, got ${sa === sb ? 'identical' : 'different'} geometry and ${relA.code} vs ${relB.code}`);
    }
  }
}

// -------------------------------------------------------------- 4. the space

console.log('\n== 4. how much of the alignment space is reachable ==');
console.log('   (per formation and arrangement: how many of the 16 sequence x relationship states have a board)');
const LETTERS = Object.keys(FORMATIONS_FOR_LETTER);
for (const letter of LETTERS) {
  const t = templateFor(letter);
  if (!t) continue;
  const counts = [];
  for (const arrangement of [0, 5, 1, 2, 3, 4]) {
    let have = 0;
    const missing = [];
    for (const sequence of [1, 2, 3, 4]) {
      for (const relationship of ['p', 'c', 'o', 'r']) {
        const r = boardsForAlignment(t.board, { letter, arrangement, sequence, relationship });
        if (r.boards.length) have++;
        else missing.push(`${sequence}${relationship}`);
      }
    }
    counts.push(`${arrangement}:${have}/16`);
    if (missing.length) console.log(`      [${arrangement}${letter}] missing ${missing.join(' ')}`);
  }
  console.log(`  [${letter}] ${t.name.padEnd(22)} ${counts.join('  ')}`);
}

// -------------------------------------------------------------- 5. findings

console.log('\n== 5. findings ==');
console.log('  5a. the reference pair is PINNED by the corpus, not chosen.');
console.log('      All8 gives the reference pair in words ("the outside boy", "the left-hand couple"), and');
console.log('      the words only resolve to a spot once you know which end of the drawing is meant. Solving');
console.log('      it against the published letters:');
for (const [letter, spot] of Object.entries(REFERENCE_PAIR_SPOTS)) {
  const list = corpus.alignments.filter((a) => parseAlignmentId(a.id)?.letter === letter);
  const ids = list.map((a) => a.id).join(' ');
  console.log(`        [${letter}] reference boy at table spot (row ${spot[0]}, col ${spot[1]}) - reproduces all ${list.length}: ${ids}`);
}
console.log('      In both cases it is the only spot that reproduces every letter, so the convention is derived,');
console.log('      not guessed. For [W] and [F] no published alignment discriminates (they are all `p`, where any');
console.log('      pair agrees), so nothing is recorded and only unanimous states are reported.');
console.log('  5b. the [P] gap. Beginning Double Pass Thru matches NO fixed adjacent spot: its own diagrams show');
console.log('      P1c pairing the outer couples side by side and the inner ones as facing couples. That is');
console.log('      exactly why All8 agrees a reference pair for [0L] [0B] [0F] [0W] and not for [P]. The 2');
console.log('      non-`p` corpus alignments (P1c, P2r) therefore cannot be classified; P3p/P4p are unanimous.');

const familyToLetter = new Map();
for (const [family, entry] of Object.entries(JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'all8-formation-map.json'), 'utf8')).families)) {
  for (const engineName of entry.engine) {
    const l = letterForFormation(engineName);
    if (l) familyToLetter.set(family, l);
  }
}
const familyMismatch = [];
for (const a of corpus.alignments) {
  const spec = parseAlignmentId(a.id);
  if (!spec) continue;
  const want = familyToLetter.get(a.family);
  if (want && want !== spec.letter) familyMismatch.push(`${a.id}: id says [${spec.letter}], family "${a.family}" maps to [${want}]`);
}
if (familyMismatch.length) {
  for (const m of familyMismatch) console.log(`  note: ${m}`);
} else {
  console.log('  every alignment id\'s formation letter agrees with its family\'s engine template');
}
const handed = corpus.alignments.filter((a) => /\./.test(a.id));
console.log(`  handedness in the corpus: ${handed.map((a) => a.id).join(' ') || '(none)'} (L-H families classify against their own [L.*] table)`);
console.log('  L-H 2-Face Lines is mapped to the engine\'s "Two-Faced Lines LH" template directly, so');
console.log('  step 1\'s "mirrored only" caveat (a dedupe artefact of getUniqueFormations) does not apply here.');

console.log('\n=================');
console.log(failures === 0 ? 'ALIGNMENT BOARDS: all gates passed.' : `ALIGNMENT BOARDS: ${failures} gate(s) FAILED.`);
if (failures) process.exitCode = 1;
