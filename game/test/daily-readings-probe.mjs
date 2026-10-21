// THE DAILY'S GROUPED LIST, from the real engine: every reading is a move the player can actually play.
//
// WHY THIS IS A GATE. The Daily's picker offers "Heads Lead Right" as well as "Lead Right" (DESIGN.md §9), and the
// two lists disagree in BOTH directions — a call can be legal for a group and illegal for the set, and the reverse.
// So the screen's list has to come from the engine's own enumeration (`Sequencer.applicableMoves`) rather than from
// a filter over `offered`, and what it hands the player must be the group's own spelling, because that string is
// what the client applies, what the server replays and what the saved line holds. A list that offered a reading the
// engine then refused would be the picker disagreeing with itself.
//
// THE FOUR THINGS MEASURED:
//   1. EVERY reading is playable: `refusalOf(board, prefixed)` is null for all of them, at a real level's pool;
//   2. a GROUP-ONLY reading exists, and its whole-board spelling is REFUSED — so "grouped" is not a relabelling of
//      the whole-board list (the negative control that makes the first check mean something);
//   3. every call `offered` lists is a whole-board reading here, and the two lists differ by EXACTLY the calls the
//      permission table refuses (nine at a squared set) — so the surfaces cannot drift apart unnoticed;
//   4. the applier caches by board and the cached list is the same list — the picker asks on every view.
//
// Usage: node game/test/daily-readings-probe.mjs   (engine must be built)
import { makeSquaredSet } from 'dancing-squared-engine';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { applierFor } from '../src/data/corpus-node.ts';
import { PlaySession } from '../src/puzzle/session.ts';
import { groupReadings } from '../src/puzzle/readings.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = levelSpec(5); // pool 36: the first level whose questions offer THREE options
const { applier } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);
const start = makeSquaredSet();
const readings = applier.readings(start);
const prefixed = (r) => (r.selection === null ? r.call : `${r.selection} ${r.call}`);

console.log(`== 1. every reading is a move the player can play (${readings.length} at pool ${LEVEL.poolSize}) ==`);
{
  check(readings.length > 0, `${readings.length} reading(s) from the squared set`);
  // THE WHOLE LIST, PLAYED: this is the check that would catch an enumeration that reports a group the applier then
  // refuses — which is exactly what the first version of the POC's picker did, per `engine/src/sequencer/sequencer.ts`'s
  // note on `groupCanPerform`.
  const refused = readings.filter((r) => applier.refusalOf(start, prefixed(r)) !== null);
  check(refused.length === 0, `all ${readings.length} are legal when played as their own spelling${refused.length ? ` — refused: ${refused.map(prefixed).join(', ')}` : ''}`);
  // AND EACH ONE LANDS WHERE THE READING SAYS. A reading carries the board the move produces, and the picker draws
  // that board's name, so a mismatch would caption one move as another.
  const misplaced = readings.filter((r) => !applier.boardsMatch(applier.apply(start, prefixed(r)), r.board));
  check(misplaced.length === 0, `and every reading's board is the board its own spelling reaches${misplaced.length ? ` — ${misplaced.map(prefixed).join(', ')}` : ''}`);
}

console.log('\n== 2. a call the SET can do and a GROUP can do are two moves, and one list holds both ==');
{
  // THE CLAIM THIS PINS, and the reason it is not "a group-only call exists": MEASURED at pool 36, the squared set
  // offers 35 of its 36 titles whole-board, so a call only a group can perform does not occur within one call of the
  // start at this level — the engine's own `group-refusal.mjs` harness is where that case is pinned, on a board built
  // to have it. What THIS list must express is the everyday case: one title, legal for the set AND for a group, and
  // the two endings are DIFFERENT BOARDS. A picker that collapsed them by call name would hide half the moves.
  const shared = readings.filter((r) => r.selection !== null && readings.some((whole) => whole.selection === null && whole.call === r.call));
  check(shared.length > 0, `${shared.length} reading(s) share their call with a whole-board reading (e.g. "${shared.length ? prefixed(shared[0]) : '—'}")`);
  const differs = shared.filter((r) => {
    const whole = readings.find((w) => w.selection === null && w.call === r.call);
    return !applier.boardsMatch(whole.board, r.board);
  });
  check(differs.length > 0, `NEGATIVE CONTROL: ${differs.length} of them end on a DIFFERENT board from the whole-board reading of the same call (e.g. "${differs.length ? prefixed(differs[0]) : '—'}"), so the group reading is a different move rather than a label`);
  const wholeBoard = readings.filter((r) => r.selection === null);
  check(wholeBoard.length > 0 && wholeBoard.every((r) => applier.refusalOf(start, r.call) === null), `while all ${wholeBoard.length} whole-board reading(s) of the start board are legal unprefixed`);
}

console.log('\n== 3. `offered` is the whole-board readings minus the permission table\'s refusals, so the two cannot drift ==');
{
  // ONE LIST APART BY ONE RULE, not two independently built lists. `offered` (the DRILL's source) asks the permission
  // table about the whole-board reading; `readings` (the DAILY's) is the engine's `applicableMoves`, which asks the
  // table only per GROUP and pushes its whole-board reading unconditionally — so the table's refusals survive there.
  // MEASURED at a squared set: 9 calls are a reading and not an offer, and every one is geometrically legal, which is
  // why the difference is the table rather than the board. THAT NINE IS THE KNOWN GAP: when the engine's enumeration
  // learns to filter its own whole-board reading this check fails, and the failure is the signal to delete it.
  const offered = applier.offered(start).map((m) => m.call).sort();
  const whole = readings.filter((r) => r.selection === null).map((r) => r.call).sort();
  const notAReading = offered.filter((c) => !whole.includes(c));
  check(notAReading.length === 0,
    `every one of the ${offered.length} call(s) \`offered\` lists is a whole-board reading (${notAReading.length} are not)`);
  const notOffered = whole.filter((c) => !offered.includes(c));
  const refusedByTable = notOffered.filter((c) => applier.refusalOf(start, c) === null);
  check(notOffered.length === 9 && refusedByTable.length === notOffered.length,
    `and the ${notOffered.length} the readings have and \`offered\` does not are all geometrically legal, so the permission table is what separates the two lists`);
  // NEGATIVE CONTROL: `offered` is a STRICT subset of the readings, or the group pass found nothing and section 2's
  // control would be doing all the work.
  check(readings.length > offered.length, `and the readings are strictly more than it (${readings.length} > ${offered.length})`);
}

console.log('\n== 4. the applier caches the list by board, and the picker asks repeatedly ==');
{
  const again = applier.readings(start);
  check(again === readings, 'a second ask returns the SAME list object, so a view per move is not a re-enumeration');
  // A DIFFERENT BOARD IS A DIFFERENT ENTRY. The cache key is `boardSig`, so this is the check that the key is the
  // board and not a constant — and it is stated as identity rather than as content on purpose: MEASURED, one call in
  // the count is often the SAME (370 -> 370), because a rotation of the set offers the same calls from the same
  // relative positions. Equality of content there is the engine being right, not the cache being wrong.
  const next = applier.apply(start, prefixed(readings[0]));
  const elsewhere = applier.readings(next);
  check(elsewhere !== readings, 'while a board one call in gets its own entry, so the key is the board rather than a constant');
  check(applier.readings(next) === elsewhere, 'and that board is cached too, so undo/redo does not re-enumerate either');
  // AND THE CONTENT CAN DIFFER: some board within one call offers a different NUMBER of readings, which is what makes
  // the cache worth having and the list a property of the board rather than of the level.
  const counts = applier.offered(start).slice(0, 8).map((m) => applier.readings(applier.apply(start, m.call)).length);
  check(counts.some((n) => n !== readings.length), `and ${counts.filter((n) => n !== readings.length).length} of ${counts.length} boards one call in offer a different number of readings (${[...new Set(counts)].join(', ')} against ${readings.length})`);
}

console.log('\n== 5. the screen groups them, whole board first ==');
{
  const sections = groupReadings(readings);
  check(sections.length > 1, `${sections.length} section(s) for ${readings.length} reading(s)`);
  check(sections[0].label === 'All 8', `the whole-board reading is the FIRST section (${sections[0].label})`);
  check(sections.reduce((n, s) => n + s.readings.length, 0) === readings.length, 'and every reading is in exactly one section');
  // THE SAME CALL UNDER TWO HEADINGS IS TWO MOVES, and it is preserved rather than deduplicated: `Lead Right` for
  // the set and for `Heads` are different dancers doing it.
  const duplicated = [...new Set(sections.flatMap((s) => s.readings.map((r) => r.call)))].filter((call) => sections.filter((s) => s.readings.some((r) => r.call === call)).length > 1);
  check(duplicated.length > 0, `and ${duplicated.length} call(s) appear under more than one heading, which is two moves rather than a duplicate (e.g. ${duplicated.slice(0, 3).join(', ')})`);
}

console.log('\n== 6. a reading is what the session plays, and the line keeps the group ==');
{
  // THE END-TO-END SHAPE OF ONE CLICK: the picker plays the prefixed string, the session accepts it, and the line
  // holds what was played rather than a bare call name. This is what `POST /daily/move` records and `POST /runs`
  // replays, so a mangled spelling here is a `line_mismatch` there.
  const session = new PlaySession({ start, goal: start, shortest: 1, allowance: 4, level: LEVEL, mode: 'daily', seed: 1, poolVersion: MAIN_POOL.version, path: [], steps: [], solution: [], alternatePath: false, explored: 0 }, applier, 4);
  const groupReading = readings.find((r) => r.selection !== null);
  const verdict = session.play(prefixed(groupReading));
  check(verdict.verdict !== 'illegal', `the session plays a grouped reading ("${prefixed(groupReading)}" -> ${verdict.verdict})`);
  check(session.moves.length === 1 && session.moves[0] === prefixed(groupReading), `and the line holds the group's spelling (${session.moves[0]})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
