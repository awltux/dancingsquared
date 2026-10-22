// THE PERMISSION TABLE IS WHAT A DRILL OFFERS FROM.
//
// WHAT WAS REPORTED. `Circle Four Left 3/4` was offered as a drill option for the whole square, which the
// engine's own table refuses: `Circle Four` is danced by four dancers - the heads or the sides - so `All 8` is not
// a reading it can be called from (`PERMISSION_RULES`' first entry).
//
// WHY IT HAPPENED. The table is consulted by `mayOffer`, `groupCanPerform` and `legalNext`, and the drill drew its
// options from `applier.offered`, which asked NONE of them: it walked `applyToBoard` and kept every call the engine
// did not refuse GEOMETRICALLY. MEASURED at the level-1 pool from a squared set, `legalCalls` answers 40 with the
// table installed and 40 without it, so no amount of wiring would have changed it - the question was never asked.
// `offered` now asks `mayOffer(name, null, board)` first, and MEASURED the same list is 31: the eight `Circle Four`
// authorings and `Dosado`, every one of them geometrically legal from that board.
//
// WHAT THIS PROBE PINS. The squared set's list exactly (31), and that each of the nine ABSENT titles is one the
// engine does not refuse there - which is the whole point: the drop is a RULE, not a measurement, and a probe that
// only counted 31 could be satisfied by a list that had shrunk for any reason. It also pins that the DAILY's own
// list agrees (`readings`, which is the engine's `applicableMoves`): that surface used to carry the same nine as
// whole-board readings, because its whole-board pass asked nobody while its group pass asked `groupCanPerform`.
// The engine now asks `mayOffer` there too, and this probe checks the two lists agree so the two modes cannot
// disagree about what a square set may call.
//
// Usage: node game/test/permission-probe.mjs   (engine must be built)
import { makeSquaredSet } from 'dancing-squared-engine';
import { applierFor } from '../src/data/corpus-node.ts';
import { poolFor } from '../src/puzzle/pool.ts';
import { levelSpec } from '../src/puzzle/levels.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const pool = poolFor(levelSpec(1));
const { applier } = applierFor(pool, pool.length);
const sq = makeSquaredSet();
const offeredAt = (board) => applier.offered(board).map((m) => m.call);

console.log(`== the drill's options at level 1's pool (${pool.length} titles) ==`);

// THE NINE, BY NAME. A title is an API (AGENTS.md 11.2.6): a retitle has to arrive here as well, which is the
// honest cost of pinning a set rather than a count.
const REFUSED_AT_ALL_EIGHT = [
  'Circle Four Left', 'Circle Four Left 1/4', 'Circle Four Left 1/2', 'Circle Four Left 3/4',
  'Circle Four Right', 'Circle Four Right 1/4', 'Circle Four Right 1/2', 'Circle Four Right 3/4',
  'Dosado',
];

const offered = offeredAt(sq);
check(offered.length === 31, `the squared set offers 31 of the ${pool.length} titles (was 40 before the filter)`);
for (const name of REFUSED_AT_ALL_EIGHT) {
  check(!offered.includes(name), `${JSON.stringify(name)} is not offered for the whole square`);
}
// THE REASON IT IS ABSENT, SEPARATELY FROM THE FACT. `refusalOf` is the geometry; it says yes to all nine, so a
// revert that removed the permission ask would put every one of them back and the checks above catch that, while a
// board that genuinely could not dance them would be caught HERE instead.
for (const name of REFUSED_AT_ALL_EIGHT) {
  check(applier.refusalOf(sq, name) === null, `${JSON.stringify(name)} is geometrically legal from this board - the table is what refused it`);
}

// NEGATIVE CONTROL FOR THE NINE. If `refusalOf` answered `null` for everything, the checks above would be
// satisfied by a board nothing refuses. It refuses 17 of the 57 titles here (40 - 31 + 8 geometric are offered).
const geometricallyRefused = applier.candidateCalls().filter((c) => applier.refusalOf(sq, c) !== null);
check(geometricallyRefused.length === 17, `and \`refusalOf\` still refuses ${geometricallyRefused.length} other titles here, so its \`null\` is a distinction`);

// NEGATIVE CONTROL FOR THE FILTER: a CIRCLE call that is not a Circle Four survives it. A filter keyed on the word
// "Circle" would empty this, and the check above would not notice.
const circleSurvivors = offered.filter((c) => c.startsWith('Circle') && !c.startsWith('Circle Four'));
check(circleSurvivors.length > 0, `other Circle calls survive the same filter (${circleSurvivors.length}: ${circleSurvivors.slice(0, 3).join(', ')}...)`);

console.log('\n== the DAILY\'s list agrees, because the engine\'s enumeration asks too ==');
// THE OTHER MODE'S SOURCE. `readings` is `Sequencer.applicableMoves`, which the Daily's picker draws from; its
// whole-board pass asked nobody until this change, so the same nine were offered there while the drill had dropped
// them. Both halves are checked: the nine are absent, and the list is not merely empty.
const readings = applier.readings(sq);
const wholeReadings = readings.filter((r) => r.selection === null).map((r) => r.call);
const leaked = REFUSED_AT_ALL_EIGHT.filter((name) => wholeReadings.includes(name));
check(leaked.length === 0, `none of the nine is a whole-board reading of the DAILY's list either (${leaked.length} leaked)`);
check(readings.length > 0 && wholeReadings.length === offered.length,
  `and it still carries ${readings.length} reading(s), ${wholeReadings.length} whole-board — the same count as \`offered\``);

console.log('\n== the rule\'s SCOPE, over the level\'s own start boards ==');
const starts = applier.startBoards();
check(starts.length === 44, `a sample of ${starts.length} start board(s)`);

// `Dosado`'s rule NAMES the Static Square, so it must not become a ban on the call. MEASURED: 20 of the 44.
const dosadoBoards = starts.filter((b) => offeredAt(b).includes('Dosado'));
check(dosadoBoards.length === 20, `\`Dosado\` is still offered from ${dosadoBoards.length} of the ${starts.length} start boards (its rule names one formation, not the call)`);

// `Circle Four`'s rule names NO formation, so it must hold on every board. MEASURED: 0 of the 44.
const circleBoards = starts.filter((b) => offeredAt(b).some((c) => c.startsWith('Circle Four')));
check(circleBoards.length === 0, `and no start board offers a \`Circle Four\` authoring (${circleBoards.length} of ${starts.length})`);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
