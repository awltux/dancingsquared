// ============================================================================================
// THE CELL CENSUS: how much of what the FSM's transitions reach is ON the declared lattice?
//
// WHY THIS EXISTS. Stage 0 of the modules/FSM plan: before any state set changes, measure what a
// DECLARED node vocabulary would and would not cover. The question it answers is the one that decides
// whether the FSM's node count is bounded or not:
//
//   - how many distinct GEOMETRIES does the corpus declare, and how many of them are STATES? Those
//     used to be the same number (155 = 155), and Stage 0b is what separated them: the state set's
//     named half is scoped to the formations a REGISTERED CALL is used from, so 100 corpus names are
//     declared but are not states at Mainstream. The gap is the level leak, measured.
//   - of every legal application from the FSM's own states, how many end ON the declared lattice and
//     how many land on a geometry nothing declares (a NOVEL geometry)?
//   - which CALLS mint the novel geometries? That is the transient classification: the allemande pose,
//     the grand ring and a `Roll` pivot were already identified that way in PLAN.md section 5.
//   - how many distinct CELLS (geometry + gender arrangement + sequence + relationship) are reached,
//     and how many of them can carry All8's FASR annotation?
//
// THE FASR QUESTION IS THE ONE THAT SHAPED THE PLAN, so it is reported explicitly. `FORMATION_LETTER`
// maps nine engine names to six letters, and FASROO cannot extend it (it refuses a formation with no
// agreed reference pair). The census prints the coverage rather than asserting a hope.
//
// THE SWEEP IS THE NAMED STATES, deliberately. The state set also holds the registered start setups
// that have no name (23 `@embed#N` states at ms), but a state with no name has no `boardForFormation`
// to rebuild from, so they are excluded and REPORTED. The lattice still DECLARES every setup (it is
// one of its two sources), so "declared but not reached from a named state" is reported rather than
// hidden.
// ============================================================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, buildCellLattice, geometryKey, CELL_ROUND, boardForFasrCode, matchFormations } from '../../dist/index.js';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const read = (p) => readFileSync(path.join(assets, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const MS_FILES = readdirSync(path.join(assets, 'ms')).filter((f) => f.endsWith('.xml'));
const tamBlocks = (xml) => xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
const attr = (b, n) => (b.match(new RegExp(`${n}="([^"]*)"`)) ?? [])[1] ?? '';
const isHiddenTam = (b) => {
  const end = b.indexOf('>');
  return /display="(no|none)"/.test(end >= 0 ? b.slice(0, end + 1) : b);
};
const entries = [];
for (const f of MS_FILES) {
  const xml = read(`ms/${f}`);
  const byTitle = new Map();
  for (const b of tamBlocks(xml)) {
    if (isHiddenTam(b)) continue;
    const t = attr(b, 'title') || '?';
    byTitle.set(t, [...(byTitle.get(t) ?? []), b]);
  }
  for (const [title, blocks] of byTitle) entries.push({ name: title, xml: `<calls>\n${blocks.join('\n')}\n</calls>` });
}
const seq = new Sequencer(read('moves.xml'), read('formations.xml'), entries);
seq.setMatchMargin(1.5);
const TITLES = [...seq.library.callNames()];

// ---------------------------------------------------------------- 1. the declared lattice
// TWO VOCABULARIES, and Stage 0b is the reason they are now different.
//
//   DECLARED  every shape the corpus declares: all of `formations.xml` plus every registered start
//             setup. This is the answer to "what IS this board", and it is what the namer reads.
//   STATE SET the engine's FSM nodes: the same setups, but the NAMED half scoped to the formations a
//             REGISTERED CALL is used from (`formation="..."`). This is the answer to "where may a
//             caller be standing", and a programme only allows the places its own calls begin.
//
// They agreed exactly (155 = 155) before the scope was applied, and that agreement is what made the
// lattice "the engine's state set made explicit" rather than a second opinion. They no longer agree,
// and the DIFFERENCE is the measurement: 100 of the corpus's whole-set names are referenced by no ms
// tam, so scoping removes them. The declared lattice is still what this census sweeps against - the
// question it answers is "where do the states' legal ends land", and an end is off-lattice when
// nothing in the corpus declares it, which must not depend on the scope.
console.log('== 1. the declared lattice, and the state set the engine uses ==');
const latticeEntries = [
  ...seq.library.getUniqueFormations().map((f) => ({ name: f.name, dancers: f.dancers })),
  ...seq.library.allVariantSetups().map((s, i) => ({ name: `@embed#${i}`, dancers: s })),
];
const lattice = buildCellLattice(latticeEntries);
const scopedEntries = [
  ...seq.library.referencedFormations().map((f) => ({ name: f.name, dancers: f.dancers })),
  ...seq.library.allVariantSetups().map((s, i) => ({ name: `@embed#${i}`, dancers: s })),
];
const scoped = buildCellLattice(scopedEntries);
const asset = JSON.parse(read('fsm-ms.json'));
const assetStates = asset.table.states.length;
console.log(`  geometries DECLARED by the corpus  : ${lattice.geometries.length}`);
console.log(`  the engine's own STATE SET (scoped): ${scoped.geometries.length}`);
console.log(`  built from                        : ${latticeEntries.length} declared shapes (named formations + variant setups)`);
const namedGeos = lattice.geometries.filter((g) => !g.name.startsWith('@embed'));
const embedOnly = lattice.geometries.filter((g) => g.name.startsWith('@embed'));
console.log(`  named geometries / setup-only     : ${namedGeos.length} / ${embedOnly.length}`);
check(lattice.geometries.length >= scoped.geometries.length,
  `the declared lattice covers the engine's state set (${lattice.geometries.length} >= ${scoped.geometries.length})`);
check(scoped.geometries.length >= assetStates,
  `the scoped lattice covers the engine's state set (${scoped.geometries.length} >= ${assetStates}; the ` +
  `${scoped.geometries.length - assetStates} extra are where the lattice's ${CELL_ROUND} key is FINER than the ` +
  `engine's 1.0 match dedupe - near-duplicate registered setups, e.g. a formation and its "Close" variant, that ` +
  `the engine folds together)`);
// THE LEVEL SCOPE, stated as the difference between the two vocabularies. Before Stage 0b the named
// half was the whole corpus and the two numbers above were equal; the gap is the level leak.
{
  const referenced = seq.library.referencedFormationNames();
  const whole = seq.library.getUniqueFormations().map((f) => f.name);
  const outOfScope = whole.filter((n) => !referenced.has(n));
  console.log(`  corpus whole-set names            : ${whole.length}, of which referenced by an ms tam: ${referenced.size}`);
  console.log(`  OUT OF SCOPE for ms               : ${outOfScope.length} names, e.g. ${outOfScope.slice(0, 5).join(', ')}`);
  check(outOfScope.length > 0,
    `${outOfScope.length} declared formations are not states at ms - the level scope bites (it did NOT before Stage 0b)`);
}

// The two halves of an arrangement, and the annotation vocabulary.
let withLetters = [];
{
  const withPatterns = namedGeos.filter((g) => g.patterns.length > 1);
  withLetters = namedGeos.filter((g) => g.letters.length > 0);
  const maxPatterns = Math.max(...namedGeos.map((g) => g.patterns.length));
  console.log(`  geometries with >1 gender pattern : ${withPatterns.length} (max ${maxPatterns} patterns on one)`);
  console.log(`  geometries All8 gives a LETTER    : ${withLetters.length} of ${namedGeos.length}` +
    ` (letters: ${[...new Set(namedGeos.flatMap((g) => g.letters))].sort().join(' ')})`);
  const busiest = [...namedGeos].sort((a, b) => b.names.length - a.names.length).slice(0, 5);
  console.log('  the geometries carrying the most names:');
  for (const g of busiest) console.log(`    ${String(g.names.length).padStart(2)} names / ${g.patterns.length} pattern(s)  -> ${g.names.slice(0, 4).join(', ')}${g.names.length > 4 ? ', ...' : ''}`);
  check(withLetters.length > 0 && withLetters.length < namedGeos.length,
    `All8's letters cover ${withLetters.length} of ${namedGeos.length} named geometries - the vocabulary is a real gap, not a formality`);
}

// ---------------------------------------------------------------- 2. the sweep
console.log('\n== 2. every legal application from the FSM\'s named states ==');
const namedStates = asset.table.states.filter((s) => !s.startsWith('@embed#'));
const knownCells = new Set();
const unknownGeo = new Map();      // geometryKey -> { count, calls: Map }
let apps = 0;
let onLattice = 0;
let offLattice = 0;
const cellParts = { full: 0, noRelationship: 0, noSequence: 0, noArrangement: 0 };
const letteredCells = new Set();
for (const state of namedStates) {
  const board = seq.boardForFormation(state);
  if (!board) continue;
  for (const title of TITLES) {
    const res = seq.applyToBoard(board, title);
    if (!res.legal) continue;
    apps++;
    const cell = lattice.cellOf(res.board);
    if (cell.geometryId === null) {
      offLattice++;
      const key = geometryKey(res.board.dancers);
      const e = unknownGeo.get(key) ?? { count: 0, calls: new Map() };
      e.count++;
      e.calls.set(title, (e.calls.get(title) ?? 0) + 1);
      unknownGeo.set(key, e);
      continue;
    }
    onLattice++;
    if (cell.key) knownCells.add(cell.key);
    if (cell.letter) letteredCells.add(cell.key);
    if (cell.arrangement === null) cellParts.noArrangement++;
    else if (cell.sequence === null) cellParts.noSequence++;
    else if (cell.relationship === null) cellParts.noRelationship++;
    else cellParts.full++;
  }
}
console.log(`  ${apps} legal applications`);
console.log(`  end ON the declared lattice   : ${onLattice} (${((onLattice / apps) * 100).toFixed(1)}%)`);
console.log(`  end OFF it (NOVEL geometry)   : ${offLattice} (${((offLattice / apps) * 100).toFixed(1)}%) in ${unknownGeo.size} distinct geometries`);
check(apps > 0, `${apps} applications swept over ${namedStates.length} named states x ${TITLES.length} calls`);

// ---------------------------------------------------------------- 3. the cells reached
console.log('\n== 3. the cells reached ==');
console.log(`  distinct CELLS (geometry|pattern|sequence|relationship): ${knownCells.size}`);
console.log(`  of those carrying an All8 letter                       : ${letteredCells.size}`);
console.log(`  how much of a cell is readable: full ${cellParts.full}, no relationship ${cellParts.noRelationship}, ` +
  `no sequence ${cellParts.noSequence}, no arrangement ${cellParts.noArrangement}`);
check(knownCells.size > 0, `${knownCells.size} cells are reached - the vocabulary is finite and populated`);

// ---------------------------------------------------------------- 4. the transient classification
console.log('\n== 4. which calls mint the novel geometries ==');
{
  const byCall = new Map();
  for (const e of unknownGeo.values()) for (const [c, n] of e.calls) byCall.set(c, (byCall.get(c) ?? 0) + n);
  const ranked = [...byCall].sort((a, b) => b[1] - a[1]);
  console.log(`  ${ranked.length} distinct calls mint all ${unknownGeo.size} novel geometries`);
  for (const [c, n] of ranked.slice(0, 16)) console.log(`    ${String(n).padStart(4)}  ${c}`);
  check(ranked.length > 0 && ranked.length < TITLES.length,
    `only ${ranked.length} of ${TITLES.length} calls mint a novel geometry - the novel class is narrow, not the catalogue`);
}

// ---------------------------------------------------------------- 5. the pinned numbers
//
// PINNED EXACTLY, and re-pinned DELIBERATELY with a reason rather than absorbed. A movement in either
// ---------------------------------------------------------------- 5. would ARRANGEMENT-keyed nodes help?
//
// REFUTED, AND THE NUMBERS ARE HERE SO IT IS NOT RE-PROPOSED. Stage 3's architectural piece was going to be
// re-keying the FSM's nodes from GEOMETRY to CELL (geometry x gender pattern), on the reasoning that a ceder
// module's start is a formation AND AN ARRANGEMENT - `Zero Box` being All8's `[B1c]` - so a geometry-keyed node
// cannot represent where the module begins. The motivating pair says otherwise.
//
// WHAT SEPARATES `[B1c]` FROM THE `Eight Chain Thru` NODE IS IDENTITY, NOT ARRANGEMENT. The two boards are the
// same geometry, at error 0.0000, AND carry the same gender pattern; their CELL KEYS differ only in `sequence`
// and `relationship`, both of which are unreadable on the FSM's state boards because those boards carry no home
// identity at all (every couple is UNKNOWN_COUPLE). So re-keying the states as they stand would mint nodes
// distinguished only by "identity unknown" versus "identity known" - noise, not structure - and would not let a
// single arrangement-specific module attach.
//
// AND IT WOULD COST: the scoped vocabulary declares 70 geometries and 105 cells, so nodes multiply 1.50x, and a
// sixth of the edges that HAVE a target land on a gender pattern no declared shape realises - those become
// transients under a cell key. The blocker is CANONICAL IDENTITY on the state boards, which is a different and
// harder piece: a geometry admits four relabellings and only six All8 letter families have an authority-picked
// canonical board (`CANONICAL_INDEX`, measured against 26 published diagrams), while `relationship` needs an
// agreed reference pair that Callerlab records for `[L] [B] [F] [W]` only. That is the same limit this census
// already reports - 22 of 396 cells are fully readable.
console.log('\n== 5. would ARRANGEMENT-keyed nodes help? (REFUTED - see the comment) ==');
{
  // THE SCOPED LATTICE, not the declared one: the question is what re-keying the STATE SET would cost, and
  // the state set is the scoped vocabulary (section 1 builds both). Using `lattice` here would answer a
  // question about the corpus instead - 155 geometries -> 194 cells - which is not the change on the table.
  const LETTER_TEMPLATE = { B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru', F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH', S: 'Static Square' };
  const fasr = boardForFasrCode('B1c', (l) => (LETTER_TEMPLATE[l] ? seq.boardForFormation(LETTER_TEMPLATE[l]) : null)).board;
  const node = seq.boardForFormation('Eight Chain Thru');
  const cf = scoped.cellOf(fasr);
  const cn = scoped.cellOf(node);
  const m = matchFormations(fasr.dancers, node.dancers, 1.0);
  console.log(`  [B1c] vs the Eight Chain Thru node: same geometry ${cf.geometryId === cn.geometryId}, ` +
    `same pattern ${cf.pattern === cn.pattern}, geometry error ${m ? m.error.toFixed(4) : 'NULL'}`);
  console.log(`    [B1c] cell key ${cf.key}`);
  console.log(`    node  cell key ${cn.key}`);
  console.log(`    couples: [B1c] ${fasr.dancers.map((d) => d.couple ?? 0).join(',')} vs node ${node.dancers.map((d) => d.couple ?? 0).join(',')}`);
  check(cf.geometryId === cn.geometryId && cf.pattern === cn.pattern,
    'the motivating pair shares BOTH its geometry and its gender pattern - ARRANGEMENT does not separate them');
  check(cn.sequence === null && cf.sequence !== null,
    'the FSM state reads no sequence (no home identity: couples all 0) while the corpus board reads one - so the keys differ in IDENTITY, not arrangement');
  check(cf.key !== cn.key && cf.arrangement === cn.arrangement,
    'their cell keys differ in sequence/relationship ONLY, which is exactly what IDENTITY would make readable');

  const patternsPer = scoped.geometries.map((g) => g.patterns.length);
  const cells = patternsPer.reduce((a, b) => a + b, 0);
  const dist = patternsPer.reduce((mm, n) => mm.set(n, (mm.get(n) ?? 0) + 1), new Map());
  console.log(`  re-keying would take ${scoped.geometries.length} geometries to ${cells} cells (${(cells / scoped.geometries.length).toFixed(2)}x): ` +
    `${[...dist].sort((a, b) => a[0] - b[0]).map(([n, geos]) => `${n} pattern(s): ${geos}`).join(', ')}`);
  // AND THE PRICE. Every targeted edge whose END pattern no declared shape realises becomes a transient under a
  // cell key, so this is the count of edges the change would COST rather than gain.
  let targeted = 0, declaredPattern = 0, newPattern = 0;
  for (const state of namedStates) {
    const board = seq.boardForFormation(state);
    if (!board) continue;
    const legal = new Set(seq.legalCalls(board));
    for (const e of asset.table.edges?.[state] ?? []) {
      if (e.endFormation === null) continue;
      targeted++;
      const res = legal.has(e.call) ? seq.applyToBoard(board, { call: e.call }) : seq.applyToBoard(board, e.call);
      if (!res.legal) continue;
      const cell = scoped.cellOf(res.board);
      if (cell.geometryId === null) continue;
      if (cell.arrangement !== null) declaredPattern++; else newPattern++;
    }
  }
  console.log(`  and it would cost: of ${targeted} edges with a target, ${declaredPattern} end on a declared pattern and ` +
    `${newPattern} (${((newPattern / targeted) * 100).toFixed(1)}%) on one no declared shape realises, so those become transients`);
  check(scoped.geometries.length === 70 && cells === 105,
    `the sizes are pinned (${scoped.geometries.length} geometries -> ${cells} cells, the SCOPED vocabulary)`);
  check(newPattern === 219 && declaredPattern === 548,
    `and so is the price (${declaredPattern} kept, ${newPattern} lost of ${targeted} targeted edges)`);
}

// ---------------------------------------------------------------- 6. the pinned numbers
//
// direction is a fact about the vocabulary and has to be decided, not noticed: if the LATTICE moves, a
// state appeared or vanished; if the OFF-LATTICE count moves, a call started or stopped minting a
// geometry nothing declares.
//
// The 155/155 agreement is the load-bearing one - it says the lattice IS the engine's state set made
// explicit, which is what makes "a state exists because it is declared" true rather than aspirational.
console.log('\n== 6. the pinned numbers (re-pin with the reason) ==');
{
  // RE-PINNED FOR STAGE 0b, and every movement is the level scope rather than a change in behaviour.
  // The sweep starts from the FSM's named states, and there are now 42 of them, not 133: the named
  // half of the state set is the formations ms calls are used from. So applications fall 4416 -> 1885
  // and everything downstream with them. The RATIOS are the part that carries meaning and both hold:
  // 55.2% of legal applications still end on a geometry nothing declares (it was 68.0%), and the
  // novel-geometry class is still narrow (134 of 273 calls, against 141 of 273).
  const PINNED = {
    declaredGeometries: 155,
    stateSet: 70,
    namedGeometries: 129,
    setupOnlyGeometries: 26,
    letteredGeometries: 9,
    applications: 1885,
    onLattice: 844,
    offLattice: 1041,
    novelGeometries: 643,
    cells: 216,
    letteredCells: 50,
    fullCells: 22,
  };
  const measured = {
    declaredGeometries: lattice.geometries.length,
    stateSet: scoped.geometries.length,
    namedGeometries: namedGeos.length,
    setupOnlyGeometries: embedOnly.length,
    letteredGeometries: withLetters.length,
    applications: apps,
    onLattice,
    offLattice,
    novelGeometries: unknownGeo.size,
    cells: knownCells.size,
    letteredCells: letteredCells.size,
    fullCells: cellParts.full,
  };
  let moved = 0;
  for (const [k, want] of Object.entries(PINNED)) {
    const got = measured[k];
    if (got !== want) { moved++; console.log(`    ${k}: pinned ${want}, measured ${got}`); }
  }
  check(moved === 0,
    moved === 0
      ? `all ${Object.keys(PINNED).length} pinned numbers hold (declared lattice ${PINNED.declaredGeometries}, state set ${PINNED.stateSet})`
      : `${moved} pinned number(s) moved - decide and re-pin`);
  // The structural claims, stated as ratios so they survive a catalogue or scope change without
  // re-pinning.
  const offShare = offLattice / apps;
  console.log(`  the vocabulary gap: ${(offShare * 100).toFixed(1)}% of legal applications end on a geometry nothing declares`);
  check(offShare > 0.5,
    `more than half of every legal application ends OFF the declared lattice - the node set is bounded by DECLARATION, not by reachability`);
  const scopeShare = 1 - scoped.geometries.length / lattice.geometries.length;
  console.log(`  the level scope: ${(scopeShare * 100).toFixed(1)}% of the declared lattice is not a state at ms`);
  check(scopeShare > 0.25,
    `the level scope removes ${(scopeShare * 100).toFixed(1)}% of the declared lattice - a level-blind state set is most of its nodes`);
}

console.log(`\ncell-census: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);