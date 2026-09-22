// ============================================================================================
// THE CELL CENSUS: how much of what the FSM's transitions reach is ON the declared lattice?
//
// WHY THIS EXISTS. Stage 0 of the modules/FSM plan: before any state set changes, measure what a
// DECLARED node vocabulary would and would not cover. The question it answers is the one that decides
// whether the FSM's node count is bounded or not:
//
//   - how many distinct GEOMETRIES does the lattice declare, and does that match the engine's own
//     state set (`poc/src/assets/fsm-ms.json`)? If it does, the lattice is the state set made
//     explicit rather than a second opinion about what a formation is.
//   - of every legal application from the FSM's own named states, how many end ON the lattice and how
//     many land on a geometry nothing declares (a NOVEL geometry)?
//   - which CALLS mint the novel geometries? That is the transient classification: the allemande pose,
//     the grand ring and a `Roll` pivot were already identified that way in PLAN.md section 5.
//   - how many distinct CELLS (geometry + gender arrangement + sequence + relationship) are reached,
//     and how many of them can carry All8's FASR annotation?
//
// THE FASR QUESTION IS THE ONE THAT SHAPED THE PLAN, so it is reported explicitly. `FORMATION_LETTER`
// maps nine engine names to six letters, and FASROO cannot extend it (it refuses a formation with no
// agreed reference pair). The census prints the coverage rather than asserting a hope.
//
// THE SWEEP IS THE NAMED STATES, deliberately. The FSM's state set also holds ~880 embedded (inline)
// variant setups, but they dedupe into about 23 geometries beyond the named ones - sweeping all 880
// as starting boards would cost ~240k applies to explore those 23, which is not what the census is
// for. The lattice still DECLARES them (they are one of its two sources), so "declared but not
// reached from a named state" is reported rather than hidden.
// ============================================================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, buildCellLattice, geometryKey } from '../../dist/index.js';

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
console.log('== 1. the declared lattice ==');
const latticeEntries = [
  ...seq.library.getUniqueFormations().map((f) => ({ name: f.name, dancers: f.dancers })),
  ...seq.library.allVariantSetups().map((s, i) => ({ name: `@embed#${i}`, dancers: s })),
];
const lattice = buildCellLattice(latticeEntries);
const asset = JSON.parse(read('fsm-ms.json'));
const assetStates = asset.table.states.length;
console.log(`  geometries declared              : ${lattice.geometries.length}`);
console.log(`  the engine's own state set       : ${assetStates}`);
console.log(`  built from                       : ${latticeEntries.length} declared shapes (named formations + variant setups)`);
const namedGeos = lattice.geometries.filter((g) => !g.name.startsWith('@embed'));
const embedOnly = lattice.geometries.filter((g) => g.name.startsWith('@embed'));
console.log(`  named geometries / setup-only     : ${namedGeos.length} / ${embedOnly.length}`);
check(lattice.geometries.length >= assetStates,
  `the declared lattice covers the engine's own state set (${lattice.geometries.length} >= ${assetStates}; the difference is the exact-key vs 1.0-dedupe tolerance)`);

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
// direction is a fact about the vocabulary and has to be decided, not noticed: if the LATTICE moves, a
// state appeared or vanished; if the OFF-LATTICE count moves, a call started or stopped minting a
// geometry nothing declares.
//
// The 155/155 agreement is the load-bearing one - it says the lattice IS the engine's state set made
// explicit, which is what makes "a state exists because it is declared" true rather than aspirational.
console.log('\n== 5. the pinned numbers (re-pin with the reason) ==');
{
  const PINNED = {
    geometries: 155,
    namedGeometries: 129,
    setupOnlyGeometries: 26,
    letteredGeometries: 9,
    applications: 4416,
    onLattice: 1414,
    offLattice: 3002,
    novelGeometries: 1923,
    cells: 396,
    letteredCells: 57,
    fullCells: 22,
  };
  const measured = {
    geometries: lattice.geometries.length,
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
      ? `all ${Object.keys(PINNED).length} pinned numbers hold (lattice ${PINNED.geometries} = the engine's own state set)`
      : `${moved} pinned number(s) moved - decide and re-pin`);
  // The structural claim, stated as a ratio so it survives a catalogue change without re-pinning.
  const offShare = offLattice / apps;
  console.log(`  the vocabulary gap: ${(offShare * 100).toFixed(1)}% of legal applications end on a geometry nothing declares`);
  check(offShare > 0.5,
    `more than half of every legal application ends OFF the declared lattice - the node set is bounded by DECLARATION, not by reachability`);
}

console.log(`\ncell-census: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);