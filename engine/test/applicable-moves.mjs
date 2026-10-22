// THE MOVES A BOARD OFFERS, WITH THEIR READING — the surface the game has never had.
//
// `legalCalls` is PRE-GROUP: it answers "is there SOME reading of this call", and the group-aware list has until
// now been assembled by the app (see the note on `legalNext`). The game's `offered()` only ever asks the
// WHOLE-BOARD question, which is why every `actives` authoring in the corpus — 28 shipped tams declare one — has
// been unreachable from the game however the pool was built. `applicableMoves` enumerates both readings with the
// group that carries them, so a consumer no longer has to rebuild the rule.
//
// THE CHECKS ARE ABOUT THE SELECTION BEING REAL, not merely present: a group reading whose `selection` does not
// resolve to dancers, or that selects everyone, would satisfy "there is a selection" while meaning nothing. So
// each one is checked against `selectionIds` and against the board's own size.
//
// EVERY ENTRY IS A READING THE PICKER MAY OFFER, and section 1 is written to that now. The whole-board pass used to
// push whatever applied and ask nobody while the group pass asked `groupCanPerform`, so this list carried
// `Circle Four Left 3/4` for eight dancers — a reading `PERMISSION_RULES` refuses — and that asymmetry is how an
// illegal option reached a drill. MEASURED at the board below: 263 whole-board readings legal-and-applying, 247
// permitted. Section 1 therefore asserts both halves, and the control proves the sixteen are a distinction rather
// than an empty set.
//
// Run: node test/applicable-moves.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '..', '..', 'assets');
const read = (p) => fs.readFileSync(path.join(ASSETS, p), 'utf8');
const seq = new Sequencer(read('moves.xml'), read('formations.xml'), callsByTitle(ASSETS));
if (!seq.setFormation('Static Square')) throw new Error('the corpus no longer declares Static Square');
const board = seq.boardForFormation('Static Square');

// ONE BOARD IS ENOUGH AND KEEPS THIS IN THE LIGHT TIER: the cost is `legalCalls x subsetGroups` applicator runs,
// and the corpus-scale question ("does every board offer both readings?") is a census, not a gate.
const moves = seq.applicableMoves(board);
const whole = moves.filter((m) => m.selection === null);
const grouped = moves.filter((m) => m.selection !== null);

console.log('\n== 1. the whole-board readings are the legal ones the permission layer permits ==');
{
  const legal = seq.legalCalls(board).filter((c) => seq.applyToBoard(board, c).legal);
  // THE PICKER'S OWN PREDICATE, imported rather than restated: `mayOffer` is what this list now asks, so a probe
  // that re-derived the rule would be measuring a copy of it.
  const permitted = legal.filter((c) => seq.mayOffer(c, null, board).allowed);
  const refused = legal.filter((c) => !seq.mayOffer(c, null, board).allowed);
  const named = new Set(whole.map((m) => m.call));
  check(permitted.every((c) => named.has(c)), `every legal call the table permits appears (${permitted.length} permitted, ${named.size} listed)`);
  check(named.size === permitted.length, 'and nothing is listed that the engine did not call legal and permit');
  // NEGATIVE CONTROL: if the table refused nothing here, the two halves above would be one statement about
  // `legalCalls` and the permission ask could be deleted without a check going red.
  check(refused.length > 0, `NEGATIVE CONTROL: the table refuses ${refused.length} call(s) the engine calls legal (e.g. ${refused[0]}), so this is a distinction`);
  check(whole.every((m) => m.board !== null), 'each carries the board it produces');
}

console.log('\n== 2. every group reading names a selection that RESOLVES to a proper subset ==');
{
  check(grouped.length > 0, `there are group readings at all (${grouped.length})`);
  let unresolved = 0;
  let everyone = 0;
  let empty = 0;
  for (const m of grouped) {
    const ids = seq.selectionIds(board, m.selection);
    if (!ids) {
      unresolved++;
      continue;
    }
    if (ids.length === 0) empty++;
    if (ids.length === board.dancers.length) everyone++;
  }
  check(unresolved === 0, `every ${'selection'} resolves through selectionIds (${unresolved} did not)`);
  check(empty === 0, `none selects nobody (${empty})`);
  check(everyone === 0, `and none selects the whole board — a "group" reading that means everyone is the whole-board reading (${everyone})`);
}

console.log('\n== 3. CONTROL: the two readings are genuinely different questions ==');
{
  // A call reachable BOTH ways from one board: the group reading must name that group, and it exists only because
  // `groupCanPerform` said so — the whole-board reading of the same call is a separate entry, not the same one.
  const byCall = new Map();
  for (const m of moves) byCall.set(m.call, (byCall.get(m.call) ?? 0) + 1);
  const both = [...byCall].filter(([, n]) => n > 1).slice(0, 3).map(([c]) => c);
  check(both.length > 0, `some call is offered under more than one reading (${both.join(', ') || 'none'})`);
  for (const c of both.slice(0, 1)) {
    const entries = moves.filter((m) => m.call === c);
    check(entries.some((m) => m.selection === null), `${c}: one of them is the whole-board reading`);
    check(entries.some((m) => m.selection !== null), `${c}: and one names a group`);
    check(new Set(entries.map((m) => m.selection)).size === entries.length, `${c}: the readings are distinct entries, not one repeated`);
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
