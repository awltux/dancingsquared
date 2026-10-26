// THE OFFER CENSUS: does any level offer a call whose relation the start board cannot answer?
//
// THIS IS THE INSTRUMENT FOR THE REPORTED DEFECT. From a `Right and Left Grand Circle` the Drill offered `Dosado your
// Partner`, which was legal on geometry alone: the call is authored from the two-dancer shape `Adjacent Dancers Close`,
// and a grand circle provides four adjacent pairs — while the board carried `UNKNOWN_COUPLE` for all eight dancers, so
// "your partner" was never a fact. The rule that refuses it is `engine/src/sequencer/relations.ts`; this measures the
// place the player meets it, which is the option list (`applier.offered`).
//
// IT COUNTS THE HOLE, NOT ONLY THE SYMPTOM. The first number is how many of a level's start boards carry NO home
// couples at all — MEASURED, that is the majority (level 1: 7 of 12; level 6: 20 of 25) — because a census that only
// printed the offences would go green if the anonymous boards ever disappeared for the wrong reason, and it would say
// nothing about how much of the drill's world the relation rule has to cover.
//
// THE PIN IS A NAMED SET, NOT A CEILING (`KNOWN_RELATIONAL_OFFERS`): it fails when a new (board, call) pair appears AND
// when one of these disappears, because both are decisions (`AGENTS.md` 11.2 #8). It is empty because the engine refuses
// them; an entry here would be a pair somebody has decided is acceptable, and it would have to say why.
import { carriesCouples, relationNamedBy } from 'dancing-squared-engine';
import { applierFor } from '../src/data/corpus-node.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/**
 * THE PAIRS THAT ARE ACCEPTED ANYWAY — none, and the value is the pin: it fails when it grows (a new offender) and when
 * it shrinks (one of these was fixed without re-deciding). Each entry would have to name its reason.
 */
const KNOWN_RELATIONAL_OFFERS = [];

/** The levels the census walks. Each is a full applier build, so this is the cost of the probe. */
const LEVELS = [1, 2, 3, 6];

const total = { boards: 0, anonymous: 0, offences: 0 };
const found = [];
for (const index of LEVELS) {
  const level = levelSpec(index);
  if (!level) {
    check(false, `level ${index} exists`);
    continue;
  }
  const titles = poolFor(level, MAIN_POOL).slice(0, level.poolSize);
  const { applier } = applierFor(titles, level.poolSize);
  const boards = applier.startBoards();
  const anonymous = boards.filter((b) => !carriesCouples(b));
  let offences = 0;
  // The offered list is the applier's own — the same call the picker and the Drill read, so a pass here is a pass at
  // every place an option is shown.
  for (const board of anonymous) {
    for (const move of applier.offered(board)) {
      if (relationNamedBy(move.call) === null) continue;
      offences++;
      found.push(`L${index}: ${move.call} offered on an anonymous start board`);
    }
  }
  total.boards += boards.length;
  total.anonymous += anonymous.length;
  total.offences += offences;
  console.log(
    `== level ${index}: ${titles.length} pool title(s), ${boards.length} start board(s), ` +
      `${anonymous.length} with NO home couples, ${offences} relational offer(s) ==`,
  );
}

// THE DENOMINATORS ARE THE CLAIM: a probe that walked nothing would otherwise pass, and "0 offences" out of 0 boards is
// not a measurement (`AGENTS.md` 11.2 #2).
check(total.boards > 0, `the census walked some start boards (${total.boards})`);
check(
  total.anonymous > 0,
  `and some of them are ANONYMOUS, so the relation rule is actually exercised (${total.anonymous} of ${total.boards})`,
);
check(
  total.offences === 0,
  `no level offers a partner or corner call from a board with no couples (${total.offences} offer(s))`,
);
for (const line of found) console.log(`  OFFER ${line}`);

// THE NAMED SET, BOTH DIRECTIONS.
const known = new Set(KNOWN_RELATIONAL_OFFERS);
const measured = new Set(found);
const added = [...measured].filter((x) => !known.has(x));
const gone = [...known].filter((x) => !measured.has(x));
check(added.length === 0, `no pair appeared that is not in KNOWN_RELATIONAL_OFFERS (${added.length})`);
check(gone.length === 0, `and none of the accepted pairs vanished (${gone.length})`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
