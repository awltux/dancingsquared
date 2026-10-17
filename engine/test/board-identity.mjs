// THE GOAL TEST, pinned: are these two boards THE SAME BOARD?
//
// `sameBoardById` compares every dancer by IDENTITY — same id, position within `SAME_BOARD_TOL`, and
// heading within the same tolerance. It exists because the two helpers beside it answer different
// questions: `boardSig` is positions-only and order-free (it answers "are these shapes congruent", for
// search dedup) and `reorderLike` fixes an array ORDER rather than testing equality. A goal test built
// on either one is wrong in a way this file measures.
//
// The measurement that makes the tolerance a RANGE rather than a taste:
//   * the two board populations being compared are both computed by applying the SAME calls to the SAME
//     start board, so a correct arrival is bit-identical — measured below, worst error 0.
//   * the smallest difference that must be REJECTED is a dancer moved one grid cell (1.0 unit) or turned
//     by an authored step (45 deg = 0.785 rad) — six to eight orders of magnitude above the tolerance.
//   So there is no population near the boundary, on either side.
//
// Usage: node engine/test/board-identity.mjs   (engine must be built: npm run build --prefix engine)
//
// WHAT EACH CHECK RULES OUT, and which check catches it rather than the others (AGENTS.md §5):
//   1. reordering              — caught by check 1 only. Checks 2-5 build their own boards in a fixed
//                                order, so none of them can see an index-keyed comparison.
//   2. a heading-only change   — caught by check 2 only. `boardSig` ACCEPTS this board (it is
//                                positions-only), so if `sameBoardById` were implemented over the
//                                signature this is the check that would go red and the others would not.
//   3. positions beyond tol    — caught by check 3. A comparison with no tolerance at all would pass
//                                this and fail the "inside the tolerance is accepted" half.
//   4. the id: 0 board         — caught by check 4 only. Without the duplicate-id refusal, two
//                                identity-less boards compare equal because every id maps to 0.
//   5. length mismatch         — caught by check 5 only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer, makeSquaredSet, cloneBoard, boardSig, sameBoardById, callMeta, SAME_BOARD_TOL } from '../dist/index.js';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A dancer with the fields the comparison reads, plus the ones it must ignore. */
const dancer = (id, x, y, deg, extra = {}) => ({
  id, couple: 1, gender: 'boy', x, y, heading: (deg * Math.PI) / 180, ...extra,
});
const board = (...ds) => ({ dancers: ds });

console.log('== 1. identity is the key, and the array order is not ==');
{
  const a = board(dancer(1, 1, 1, 0), dancer(2, -1, 1, 180), dancer(3, -1, -1, 180));
  const reordered = board(dancer(3, -1, -1, 180), dancer(1, 1, 1, 0), dancer(2, -1, 1, 180));
  check(sameBoardById(a, a), 'a board is the same board as itself');
  check(sameBoardById(a, reordered), 'and as a copy whose dancers are in a different ORDER — matched by id, not by index');
  check(boardSig(a) === boardSig(reordered), 'negative control: `boardSig` also passes this, so check 1 is not measuring what the signature already measures');
}

console.log('== 2. a dancer facing the wrong way is NOT the same board ==');
{
  const a = board(dancer(1, 1, 1, 0), dancer(2, -1, 1, 180));
  const turned = board(dancer(1, 1, 1, 0), dancer(2, -1, 1, 90));
  check(!sameBoardById(a, turned), 'a board with one dancer turned 90 deg is refused');
  check(boardSig(a) === boardSig(turned), 'negative control: `boardSig` ACCEPTS it, because it is positions-only — so a goal test built on the signature would score a wrong arrival as correct, and this is the check that would catch it');
  // The smallest rejectable turn is an authored step, and the tolerance is orders below it.
  check(!sameBoardById(a, board(dancer(1, 1, 1, 0), dancer(2, -1, 1, 135))), 'and a 45 deg turn is refused too, which is the smallest step the corpus authors');
  check(SAME_BOARD_TOL < 0.785 / 1e5, `the tolerance (${SAME_BOARD_TOL}) is at least five orders below the smallest authored turn (0.785 rad)`);
}

console.log('== 3. the tolerance is a boundary, not an adjective ==');
{
  const a = board(dancer(1, 1, 1, 0));
  check(!sameBoardById(a, board(dancer(1, 1 + SAME_BOARD_TOL * 10, 1, 0))), 'a dancer moved beyond the tolerance is refused');
  check(sameBoardById(a, board(dancer(1, 1 + SAME_BOARD_TOL / 2, 1, 0))), 'and one moved inside it is accepted');
  check(sameBoardById(a, board(dancer(1, 1, 1, SAME_BOARD_TOL / 2))), 'a heading inside the tolerance is accepted');
  check(!sameBoardById(a, board(dancer(1, 1, 1, Math.PI * 2 + 0.5))), 'and 0.5 rad past a full turn is still 0.5 rad — the heading difference is WRAPPED, so a circle cannot be reported as an almost-full turn');
}

console.log('== 4. a board with no identity is not a match — including its own copy ==');
{
  // `boardAtBeat` documents this: a board synthesised from geometry alone reports id: 0 for every
  // dancer rather than inventing one from the array index. Two such boards are two unrelated boards,
  // and only the id-uniqueness refusal distinguishes them.
  const noIdentity = board(dancer(0, 1, 1, 0), dancer(0, -1, -1, 0));
  check(!sameBoardById(noIdentity, board(dancer(0, 1, 1, 0), dancer(0, -1, -1, 0))), 'two boards whose dancers all share id 0 are refused rather than compared id-for-id');
  // THE REFUSAL IS TOTAL, and this is the check that caught it being one-sided: the first version
  // tested the duplicate ids of `b` only, so `sameBoardById(x, x)` was TRUE for an identity-less
  // board while `sameBoardById(x, x-copy)` was FALSE — an answer that depended on argument order.
  check(!sameBoardById(noIdentity, noIdentity), 'and such a board is not even equal to ITSELF, so the answer cannot depend on which argument is which');
  const single = board(dancer(1, 1, 1, 0), dancer(2, -1, -1, 0));
  const dup = board(dancer(1, 1, 1, 0), dancer(1, 1, 1, 0));
  check(!sameBoardById(single, dup), 'a duplicate id in the OTHER board is refused (so the id map cannot silently collapse two dancers into one)');
  check(!sameBoardById(dup, single), 'and in THIS board too — the refusal is symmetric, which is what "total" means');
}

console.log('== 5. boards of different sizes are not compared ==');
{
  const two = board(dancer(1, 1, 1, 0), dancer(2, -1, -1, 0));
  const three = board(dancer(1, 1, 1, 0), dancer(2, -1, -1, 0), dancer(3, 0, 0, 0));
  check(!sameBoardById(two, three), 'a two-dancer board and a three-dancer board are refused');
  check(!sameBoardById(three, two), 'and the refusal is symmetric');
}

console.log('== 6. the whole thing against REAL boards from the engine ==');
{
  // The engine's own output, so the test cannot pass on nothing but hand-built literals. Which calls
  // are legal from a squared set is a fact about the catalogue that shifts with corpus work, so the
  // witness is DISCOVERED rather than named (AGENTS.md §8 trap 7: never pin a position or a basename
  // where the property you need is what matters — the property here is "some legal call moves someone").
  // Registration is by TITLE, taken from `callMeta`, which is the same registry the app builds.
  const movesXml = read('../../assets/moves.xml');
  const formationsXml = read('../../assets/formations.xml');
  const msDir = path.join(__dirname, '../../assets/ms');
  const calls = [];
  for (const f of fs.readdirSync(msDir).filter((f) => f.endsWith('.xml'))) {
    const xml = read(`../../assets/ms/${f}`);
    const title = callMeta(xml).title;
    if (title) calls.push({ name: title, xml });
  }

  const seq = new Sequencer(movesXml, formationsXml, calls);
  const start = makeSquaredSet();
  let legal = 0;
  let moved = null;
  for (const c of calls) {
    const r = seq.applyToBoard(start, c.name);
    if (!r.legal) continue;
    legal++;
    if (moved === null && !sameBoardById(start, r.board)) moved = { name: c.name, board: r.board };
  }
  // TWO FACTS, TWO CHECKS: that the sequencer came up at all, and that a witness exists. Folded into
  // one line, "no witness" could not be told from "the level registered nothing".
  check(calls.length > 0, `${calls.length} Mainstream call(s) registered by TITLE from the corpus (so the witness search below is searching something)`);
  check(legal > 0, `at least one of them is legal from a squared set (${legal})`);
  check(moved !== null, `and at least one legal call MOVES someone, so there is a witness for the comparison (${moved ? moved.name : 'none'})`);
  if (moved) {
    // The property the game's goal test rests on: replaying the same call from the same board twice
    // gives a board the comparison calls identical. MEASURED, and it is the reason the tolerance has
    // no population near it: the answer is bit-identical, not merely close.
    const again = seq.applyToBoard(cloneBoard(start), moved.name).board;
    check(sameBoardById(moved.board, again), `replaying ${moved.name} from the same board gives a board that compares IDENTICAL (so a correct arrival carries no residue at all)`);
    let worst = 0;
    for (const d of moved.board.dancers) {
      const o = again.dancers.find((x) => x.id === d.id);
      worst = Math.max(worst, Math.hypot(d.x - o.x, d.y - o.y), Math.abs(d.heading - o.heading));
    }
    check(worst === 0, `and the worst per-dancer difference is exactly ${worst}, which is what "any positive tolerance is already slack" means`);
    check(!sameBoardById(start, moved.board), 'while the moved board is NOT the start board — so the test can tell "arrived" from "never left"');
    check(sameBoardById(start, makeSquaredSet()), 'and two independent squared sets are the same board');
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
