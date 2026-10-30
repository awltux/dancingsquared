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
//   3. the whole-board readings are exactly `offered(board)` — the engine's enumeration asks the permission layer for
//      the whole-board reading too, which is what makes the two surfaces one rule rather than two;
//   4. the applier caches by board and the cached list is the same list — the picker asks on every view.
//
// Usage: node game/test/daily-readings-probe.mjs   (engine must be built)
import { makeSquaredSet } from 'dancing-squared-engine';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { applierFor } from '../src/data/corpus-node.ts';
import { PlaySession } from '../src/puzzle/session.ts';
import { DEFAULT_FILTER, filterReadings, groupReadings, selectSubset, selectionLabel, subsetOrDefault, WHOLE_BOARD } from '../src/puzzle/readings.ts';

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
  const misplaced = readings.filter((r) => !applier.reachesGoal(applier.apply(start, prefixed(r)), r.board));
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
    return !applier.reachesGoal(whole.board, r.board);
  });
  check(differs.length > 0, `NEGATIVE CONTROL: ${differs.length} of them end on a DIFFERENT board from the whole-board reading of the same call (e.g. "${differs.length ? prefixed(differs[0]) : '—'}"), so the group reading is a different move rather than a label`);
  const wholeBoard = readings.filter((r) => r.selection === null);
  check(wholeBoard.length > 0 && wholeBoard.every((r) => applier.refusalOf(start, r.call) === null), `while all ${wholeBoard.length} whole-board reading(s) of the start board are legal unprefixed`);
}

console.log('\n== 3. the whole-board readings ARE `offered()`, so the two surfaces cannot drift ==');
{
  // ONE PREDICATE, TWO SURFACES. `offered` (the DRILL's source) and `readings` (the DAILY's, from the engine's
  // `applicableMoves`) both ask `mayOffer` about the whole-board reading now. Before the enumeration asked, this list
  // carried the nine calls the table refuses at a squared set that `offered` had already dropped — the divergence
  // this check was written to catch, and what it caught. The two counts are PRINTED by the checks below rather than
  // pinned here: they move with the pool (this comment said 33 whole-board and 369 in all at pool 36, and at pool 73
  // the same board gives 25 and 279), so a number written down here is a number that goes stale in silence.
  const offered = applier.offered(start).map((m) => m.call).sort();
  const whole = readings.filter((r) => r.selection === null).map((r) => r.call).sort();
  check(JSON.stringify(offered) === JSON.stringify(whole), `\`offered\` and the whole-board readings name the same ${whole.length} call(s)`);
  // NEGATIVE CONTROL: the comparison must be able to fail, or it is a statement about `JSON.stringify`. One call
  // removed stands in for the drift the two surfaces had.
  check(whole.length > 1 && JSON.stringify(whole.slice(1)) !== JSON.stringify(whole), 'NEGATIVE CONTROL: a list missing one call is caught by the same comparison');
  // AND `offered` IS A STRICT SUBSET OF THE READINGS, or the group pass found nothing and section 2's control would
  // be doing all the work.
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
  check(sections[0].label === WHOLE_BOARD, `the whole-board reading is the FIRST section (${sections[0].label})`);
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

console.log('\n== 8. the FILTER is ALWAYS one subset, and the query narrows within it ==');
{
  // REPORTED, first as "there are a large number of calls available to the player. Implement a search feature and make the
  // calls easier to navigate", then as the rule this section now pins: "The call lists in the HUD should always use a single
  // call filter, defaulting to 'All 8'. Selecting another filter deselects the currently selected filter."
  // MEASURED at this level (pool 73): the squared set offers 279 readings over 14 subsets, so the list is a page of scrolling
  // without a narrowing, and it was previously EVERY subset at once as a stack of sections.
  const sections = groupReadings(readings);
  check(sections[0].label === WHOLE_BOARD, `the whole board is the first label, which is the default (${sections[0].label})`);
  check(DEFAULT_FILTER.selection === WHOLE_BOARD && DEFAULT_FILTER.query === '',
    `DEFAULT_FILTER is the whole board with nothing typed (${DEFAULT_FILTER.selection}, "${DEFAULT_FILTER.query}")`);

  // THE DEFAULT SHOWS THE WHOLE BOARD'S OWN READINGS, not everything: one subset, always.
  const shown = filterReadings(readings, DEFAULT_FILTER);
  check(shown.length === sections[0].readings.length && shown.every((r) => selectionLabel(r) === WHOLE_BOARD),
    `the default filter shows exactly the whole board's readings (${shown.length} of ${readings.length})`);
  check(JSON.stringify(shown.map(prefixed)) === JSON.stringify(sections[0].readings.map(prefixed)),
    'in the engine\'s own order, because a filter that re-sorted would move a call among names the player already knows');
  // NEGATIVE CONTROL: the check above only means something if the whole-board subset is SMALLER than the whole list — a
  // filter that compared the wrong field (say the call) would return everything.
  check(shown.length < readings.length, `NEGATIVE CONTROL: the default subset is smaller than the whole list (${shown.length} < ${readings.length})`);

  // AND EVERY SUBSET IS EXACTLY ITS OWN SECTION, which is what makes the pills a partition of the list rather than a
  // narrowing that leaks one group's calls into another's.
  const wrong = sections.filter((section) => {
    const visible = filterReadings(readings, { selection: section.label, query: '' });
    return visible.length !== section.readings.length || !visible.every((r) => selectionLabel(r) === section.label);
  });
  check(wrong.length === 0, `every one of the ${sections.length} subsets shows its own section and nothing else (${wrong.map((s) => s.label).join(', ') || 'none wrong'})`);

  // THE QUERY IS CASE-INSENSITIVE AND MATCHES THE READING'S OWN SPELLING, so the group word is searchable too — WITHIN the
  // selected subset, which is the half that changed: a query does not escape the filter above it.
  const sample = shown[0];
  const upper = filterReadings(readings, { ...DEFAULT_FILTER, query: sample.call.toUpperCase() });
  const lower = filterReadings(readings, { ...DEFAULT_FILTER, query: sample.call.toLowerCase() });
  check(upper.length > 0 && JSON.stringify(upper.map(prefixed)) === JSON.stringify(lower.map(prefixed)), `a query is case-insensitive (${upper.length} match "${sample.call}")`);
  check(upper.every((r) => selectionLabel(r) === WHOLE_BOARD), 'and it never reaches outside the selected subset');

  const groupWord = readings.find((r) => r.selection !== null && r.selection !== WHOLE_BOARD);
  const byGroup = filterReadings(readings, { selection: groupWord.selection, query: groupWord.selection.toLowerCase() });
  check(byGroup.length > 0 && byGroup.includes(groupWord), `and it matches the GROUP's word too, because the spelling is "${prefixed(groupWord)}" (${byGroup.length} match "${groupWord.selection}")`);

  // TWO TERMS, IN ANY ORDER: a filter that required them in the typed order would fail on the likeliest typo.
  const terms = [groupWord.selection.toLowerCase(), groupWord.call.split(' ')[0].toLowerCase()];
  const forward = filterReadings(readings, { selection: groupWord.selection, query: terms.join(' ') });
  const backward = filterReadings(readings, { selection: groupWord.selection, query: [...terms].reverse().join(' ') });
  check(forward.length > 0 && JSON.stringify(forward.map(prefixed)) === JSON.stringify(backward.map(prefixed)), `two terms match in either order (${forward.length} match "${terms.join(' ')}")`);

  // A ZERO IS AN ANSWER, and this one is checked to be a genuine absence rather than a broken sample.
  const nothing = filterReadings(readings, { ...DEFAULT_FILTER, query: 'zzzz-no-such-call' });
  check(nothing.length === 0 && readings.length > 0, `a query no spelling contains matches nothing (${nothing.length} of ${readings.length})`);

  // AND THE TWO NARROWINGS COMPOSE (subset AND query), which is what the picker shows: never a union of them.
  const composed = filterReadings(readings, { selection: groupWord.selection, query: groupWord.call.split(' ')[0].toLowerCase() });
  const own = filterReadings(readings, { selection: groupWord.selection, query: '' });
  check(composed.length <= own.length && composed.every((r) => own.includes(r)), `a subset and a query compose (${composed.length} of the subset's ${own.length})`);

  // ONE AT A TIME, AND NO WAY TO TURN IT OFF. This is the reported rule, and the check below is the negative control for
  // the rule it replaced: `toggleSelection` (pressing the pressed pill again showed EVERY subset) is gone, so pressing the
  // selected pill must leave the selection exactly where it was.
  check(selectSubset(DEFAULT_FILTER, 'Heads').selection === 'Heads', 'pressing a subset selects it');
  check(selectSubset(selectSubset(DEFAULT_FILTER, 'Heads'), 'Heads').selection === 'Heads',
    'pressing the selected one again keeps it — there is no "show everything" state to fall back to');
  const switched = selectSubset(selectSubset(DEFAULT_FILTER, 'Heads'), 'Sides');
  check(switched.selection === 'Sides' && switched.selection !== 'Heads', `pressing another one replaces the selection, so one is always selected (${switched.selection})`);
  check(selectSubset({ ...DEFAULT_FILTER, query: 'do' }, 'Sides').query === 'do', 'and a subset press keeps the query, so the two narrowings stay independent');
  // THE FALLBACK: a subset that has disappeared from the board (no legal call for that group) falls back to the whole board,
  // never to "nothing selected" — which is the state this screen can no longer draw.
  check(subsetOrDefault(['Heads', 'Sides'], WHOLE_BOARD) === 'Heads', 'a vanished selection falls back to the board\'s first label');
  check(subsetOrDefault([WHOLE_BOARD, 'Heads'], 'Gone') === WHOLE_BOARD, 'and to the whole board where it is on offer');
  check(subsetOrDefault(['Heads', 'Sides'], 'Sides') === 'Sides', 'while a selection that is still on offer is kept');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
