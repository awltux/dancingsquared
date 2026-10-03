// `Step Forward`, and the RETURN-OR-STAY rule a parallel step resolves it with, pinned.
//
// ASKED FOR, in the words of the request: "Create a Coded Call for 'Step In'. The named dancers step forward 2
// dimensions. This is intended to work in parallel with another Call. It takes on the duration of the other call
// and if at the end of the call nobody is in their original position, they step back 2 dimensions. If there is
// someone in their original position, they remain where they are."
//
// The four questions that wording left open, and the answers given when asked:
//
//   - the unit is **2 board units** - the cell the magnets, the spans and the moves editor all use, where a
//     `Forward` is 1;
//   - "forward" is **the dancer's own facing**, not towards the set centre (+X in its own frame, which is how
//     every move in the corpus is authored);
//   - the call is **`Step Forward`**, not "Step In" (a separate `Step Forward and Back` is coming);
//   - CALLED ON ITS OWN it is legal and simply stays where it stepped. The return is not part of the call: it
//     depends on a fact the call cannot see, which is why it is resolved by the "while" step instead.
//
// WHAT THIS FILE MEASURES, and why each half could fail on its own:
//
//   1. THE CALL. Two units along each dancer's OWN facing, nobody else moving - asserted per dancer on a board
//      whose dancers face four different ways, so a fixed-direction step fails it.
//   2. THE TWO OUTCOMES, on named witnesses in the corpus's own formations: four girls STEP IN and STAY on a
//      Double Pass Thru (the circulating boys take the spots they left), and four heads STEP AND RETURN on a
//      squared set. Both are needed - a rule that always returned, or never did, would pass with one.
//   3. THE DECISION IS PER DANCER, on a witness where two of the four stay and two return (`Swing Thru` on a
//      Double Pass Thru). An all-or-nothing reading is the other plausible reading of the request, and this is
//      the measurement that separates them.
//   4. THE TIMING. The step "takes on the duration of the other call", so a partner call of ONE beat costs one
//      beat - not the two `Step Forward` is worth on its own. That is the number that fails if the deferred
//      group is left in the beats fold.
//   5. THE REFUSALS. Two dependent groups have no answer, and a dependent group with nothing to depend on is
//      refused rather than silently resolving to a no-op.
//   6. SHOWN TO FAIL: the INDEPENDENT merge - applying both groups to the same original board, which is what
//      the "while" step does for every other pair - does NOT produce the board the rule produces at a witness
//      where a spot is taken. Without that, "deferred" would be a word rather than a mechanism.
//
// Usage: node engine/test/step-forward.mjs   (from anywhere; build the engine first)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer, setParser, stepLabel, isDeferredCall, findCodedMove, CODED_MOVES,
  stepForwardRule, stepForwardAndBackRule, stepForwardSteps, resolveStepForward, STEP_FORWARD_UNITS, overlappingDancers, bodyOverlap,
} from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, '..', '..', 'poc', 'src', 'assets');
const read = (p) => readFileSync(path.join(assets, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(read('moves.xml'), read('formations.xml'), callsByTitle(assets));
const at = (name) => seq.boardForFormation(name);
const pose = (b, id) => b.dancers.find((d) => d.id === id);
const same = (a, b, tol = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) <= tol && Math.abs(a.heading - b.heading) <= tol;
const steppedOf = (d) => ({ x: d.x + STEP_FORWARD_UNITS * Math.cos(d.heading), y: d.y + STEP_FORWARD_UNITS * Math.sin(d.heading) });
/**
 * What one designated dancer did: 'returned' (it is back on the spot it left), 'stayed' (it is on the spot it
 * stepped to), or 'elsewhere' with the pose, which is a FAILURE of the rule rather than a third outcome.
 */
const fate = (start, end) => {
  const s = steppedOf(start);
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-9) return 'returned';
  if (Math.hypot(end.x - s.x, end.y - s.y) < 1e-9) return 'stayed';
  return 'elsewhere';
};

// ------------------------------------------------------------------ 0. the two calls
console.log('== 0. the TWO step calls, and only one of them depends on others ==');
{
  const simple = findCodedMove('Step Forward');
  const round = findCodedMove('Step Forward and Back if Possible');
  check(!!simple && !!round, 'Step Forward and Step Forward and Back if Possible are both coded moves');
  check(simple?.deferred !== true && round?.deferred === true,
    'the plain step is INDEPENDENT and the "and back if possible" one is the DEFERRED one - only its answer depends on the other groups of the step');
  check(simple?.beats === 2 && round?.beats === 4,
    `they cost ${simple?.beats} and ${round?.beats} beats on their own: the step out, and the step out and back`);
  check(simple?.applyToSelection !== undefined && round?.applyToSelection !== undefined,
    'both have a rule for a DESIGNATED GROUP (applyToSelection) and no whole-set reading');
  check(!!round?.deferredHalf && !simple?.deferredHalf,
    'and only the deferred one carries the half-way board the applicator resolves it from');
  check(CODED_MOVES.filter((m) => m.deferred).length === 1,
    'exactly one coded move is deferred, so "at most one dependent group" is a rule about a real singular case');
  check(simple?.precondition?.(null)?.includes('names a group') === true && round?.precondition?.(null)?.includes('names a group') === true,
    'both refuse the bare name with the reason, because a step that displaces some dancers has no whole-set reading');
  check(!callsByTitle(assets)['Step Forward'] && !callsByTitle(assets)['Step Forward and Back if Possible'],
    'the corpus has NEITHER call - both are derived geometry, not a matched catalogue setup');
}

// ------------------------------------------------------------------ 1. the call itself
console.log('\n== 1. the named dancers step 2 along their OWN facing, and nobody else moves ==');
{
  const square = at('Static Square');
  seq.setBoard(square);
  const r = seq.applyToBoard(square, 'Heads Step Forward');
  check(r.legal, `Heads Step Forward is legal on a squared set (${r.reason ?? 'legal'})`);
  const heads = seq.selectionIds(square, 'Heads') ?? [];
  const others = square.dancers.filter((d) => !d.isGhost && !heads.includes(d.id));
  let moved = 0;
  let ownFacing = 0;
  for (const id of heads) {
    const a = pose(square, id);
    const b = pose(r.board, id);
    const want = steppedOf(a);
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) moved++;
    if (Math.hypot(b.x - want.x, b.y - want.y) < 1e-9) ownFacing++;
    if (Math.abs(b.heading - a.heading) > 1e-12) moved = -999; // a step must not turn
  }
  const d0 = pose(square, heads[0]);
  console.log(`    dancer ${heads[0]}: (${d0.x.toFixed(2)},${d0.y.toFixed(2)}) facing ${(d0.heading * 180 / Math.PI).toFixed(0)}deg -> (${pose(r.board, heads[0]).x.toFixed(2)},${pose(r.board, heads[0]).y.toFixed(2)})`);
  check(moved === heads.length, `all ${heads.length} designated dancers moved, and none of them turned`);
  check(ownFacing === heads.length, 'each one landed EXACTLY 2 units along its OWN facing (heads face north and south here, sides east and west, so a fixed direction cannot pass)');
  check(others.every((d) => same(d, pose(r.board, d.id))),
    `and the ${others.length} dancers nobody designated did not move at all`);

  // THE RULE ITSELF is also callable directly, which is what the panel and the gate above use.
  const direct = stepForwardRule(square, heads);
  check('board' in direct && same(pose(direct.board, heads[0]), pose(r.board, heads[0])),
    'the rule the Sequencer reached is the exported `stepForwardRule` - one definition, not a second one behind the name');
  // ...and the FORWARD HALF is one definition shared by both calls, so they cannot disagree about a step.
  const forwardHalf = stepForwardSteps(square, heads);
  check(heads.every((id) => same(pose(forwardHalf, id), pose(r.board, id))),
    'and `stepForwardSteps` - the half the round-trip call is resolved from - is the same board the plain step produces');
  const none = stepForwardRule(square, []);
  check('reason' in none && /at least one designated dancer/.test(none.reason),
    'and an empty designation is refused with the reason rather than returning the board unchanged');
  const round = stepForwardAndBackRule(square, heads);
  check('board' in round && heads.every((id) => same(pose(round.board, id), pose(square, id))),
    'while the round-trip rule danced ALONE brings every designated dancer back to where it started, over its own four beats');
}

// ------------------------------------------------------------------ 2. the two outcomes
console.log('\n== 2. step in and STAY, or step and RETURN - both, on witnesses ==');
{
  // (a) STAY: on a Double Pass Thru the girls step in, and the boys' own call moves onto the spots they left.
  const dpt = at('Double Pass Thru');
  seq.setBoard(dpt);
  const girls = seq.selectionIds(dpt, 'Girls') ?? [];
  const stepA = { groups: [{ selection: 'Girls', call: 'Step Forward and Back if Possible' }, { selection: 'All Except Girls', call: 'Wheel Around' }] };
  const stay = seq.applyStep(stepA);
  check(stay.legal, `"${stepLabel(stepA)}" applies on a Double Pass Thru (${stay.reason ?? 'legal'})`);
  const fates = girls.map((id) => fate(pose(dpt, id), pose(stay.board, id)));
  console.log(`    ${stepLabel(stepA)}: girls ${girls.join(',')} -> ${fates.join(', ')}`);
  check(fates.every((f) => f === 'stayed'), `every designated dancer STAYED where it stepped (${fates.join(', ')})`);

  // (b) RETURN: on a squared set the heads step in, and nobody takes the spots they left, so they come back.
  const square = at('Static Square');
  seq.setBoard(square);
  const heads = seq.selectionIds(square, 'Heads') ?? [];
  const stepB = { groups: [{ selection: 'Heads', call: 'Step Forward and Back if Possible' }, { selection: 'All Except Heads', call: 'Right and Left Thru' }] };
  const back = seq.applyStep(stepB);
  check(back.legal, `"${stepLabel(stepB)}" applies on a squared set (${back.reason ?? 'legal'})`);
  const fatesB = heads.map((id) => fate(pose(square, id), pose(back.board, id)));
  console.log(`    ${stepLabel(stepB)}: heads ${heads.join(',')} -> ${fatesB.join(', ')}`);
  check(fatesB.every((f) => f === 'returned'), `and every designated dancer came BACK to the spot it left (${fatesB.join(', ')})`);

  // The partner's own motion is untouched either way: the rule is about the STEP, not about the other group.
  seq.setBoard(square);
  const sidesSolo = seq.applyToBoard(square, 'Sides Right and Left Thru');
  const sides = square.dancers.filter((d) => !d.isGhost && !heads.includes(d.id)).map((d) => d.id);
  check(sides.every((id) => same(pose(sidesSolo.board, id), pose(back.board, id))),
    'and the other group ends exactly where its own call alone put it - the deferral moves nobody but the steppers');

  // THE DECISION IS THE BODY MODEL'S: a dancer stayed exactly when somebody else's body overlaps the spot it left.
  const endBoard = back.board;
  let agree = 0;
  for (const id of heads) {
    const start = pose(square, id);
    const taken = endBoard.dancers.some((o) => o.id !== id && !o.isGhost && bodyOverlap(start, o));
    const stayed = fate(start, pose(endBoard, id)) === 'stayed';
    if (taken === stayed) agree++;
  }
  check(agree === heads.length, 'and each dancer\'s outcome is exactly whether a body is standing on the spot it left (the 0.95 x 0.45 body the contact rules use, not a second tolerance)');
}

// ------------------------------------------------------------------ 3. the decision is per dancer
console.log('\n== 3. the decision is PER DANCER, not all-or-nothing ==');
{
  // A witness where the two readings disagree: on this board two of the four girls have their spot taken.
  const dpt = at('Double Pass Thru');
  seq.setBoard(dpt);
  const girls = seq.selectionIds(dpt, 'Girls') ?? [];
  const step = { groups: [{ selection: 'Girls', call: 'Step Forward and Back if Possible' }, { selection: 'All Except Girls', call: 'Swing Thru' }] };
  const r = seq.applyStep(step);
  check(r.legal, `"${stepLabel(step)}" applies (${r.reason ?? 'legal'})`);
  const fates = girls.map((id) => fate(pose(dpt, id), pose(r.board, id)));
  console.log(`    ${stepLabel(step)}: ${girls.map((id, i) => `girl ${id} ${fates[i]}`).join(', ')}`);
  check(fates.includes('stayed') && fates.includes('returned'),
    `the SAME group both stayed and returned (${fates.join(', ')}), so a single all-or-nothing answer would be wrong here`);
  let agree = 0;
  for (const id of girls) {
    const start = pose(dpt, id);
    const taken = r.board.dancers.some((o) => o.id !== id && !o.isGhost && bodyOverlap(start, o));
    if (taken === (fate(start, pose(r.board, id)) === 'stayed')) agree++;
  }
  check(agree === girls.length, 'and each of the four still agrees with its OWN spot being occupied or not');
  check(resolveStepForward.length === 4, 'the exported resolver takes (start, stepped, others, ids) - the four facts the decision needs');
}

// ------------------------------------------------------------------ 4. the duration
console.log('\n== 4. the step costs the OTHER call, not its own timing ==');
{
  const square = at('Static Square');
  const partner = (call) => ({ groups: [{ selection: 'Heads', call: 'Step Forward and Back if Possible' }, { selection: 'All Except Heads', call }] });
  const faces = partner('Face Right');   // 1 beat, SHORTER than the step's own 2
  const rl = partner('Right and Left Thru'); // 6 beats, longer
  const b1 = seq.stepBeats(square, faces);
  const b2 = seq.stepBeats(square, rl);
  console.log(`    "Face Right" partner: ${b1} beat(s); "Right and Left Thru" partner: ${b2} beat(s); Step Forward alone: ${findCodedMove('Step Forward and Back if Possible')?.beats}`);
  check(b1 === 1, `a ONE-beat partner call costs one beat, not the step's own ${findCodedMove('Step Forward and Back if Possible')?.beats} - so the deferred group is out of the beats fold`);
  check(b2 === 6, 'and a six-beat partner costs six, so the step is not capped at its own number either');
  check(b1 !== Math.max(1, findCodedMove('Step Forward and Back if Possible')?.beats ?? 0),
    `the number that would come out if the deferred group were still counted (${Math.max(1, findCodedMove('Step Forward and Back if Possible')?.beats ?? 0)}) is not what it reports`);
}

// ------------------------------------------------------------------ 5. the refusals
console.log('\n== 5. a dependency that cannot be resolved is refused, with the reason ==');
{
  const square = at('Static Square');
  seq.setBoard(square);
  const two = { groups: [{ selection: 'Heads', call: 'Step Forward and Back if Possible' }, { selection: 'Sides', call: 'Step Forward and Back if Possible' }] };
  const r2 = seq.applyStep(two);
  check(!r2.legal && /at most ONE group that depends on the others/.test(r2.reason ?? ''),
    `two dependent groups are refused - neither can be resolved after the other ("${r2.reason}")`);
  const alone = { groups: [{ selection: 'Heads', call: 'Step Forward and Back if Possible' }] };
  const r1 = seq.applyStep(alone);
  check(!r1.legal && /needs a partner call/.test(r1.reason ?? ''),
    `and a dependent group with no partner call is refused rather than resolving to a no-op ("${r1.reason}")`);
  check(isDeferredCall('Step Forward and Back if Possible') && !isDeferredCall('Trade') && !isDeferredCall('Not A Call At All'),
    'the flag is read from the registry: Step Forward is deferred, Trade is not, and an unknown name is not');
}

// ------------------------------------------------------------------ 6. SHOWN TO FAIL
//
// THE INDEPENDENT MERGE IS THE OLD BEHAVIOUR, and it is what every other "while" step still does: apply each
// group to the same original board and merge the results by dancer id. For a deferred group that merge is the
// "nobody ever steps back" reading, and the three measurements below are what make the deferral a mechanism
// rather than a label: the rule agrees with the merge where no spot is taken, disagrees with it exactly where one
// is, and the disagreement is what keeps two bodies off one spot.
console.log('\n== 6. the negative control: merging the groups independently is the "never step back" reading ==');
{
  // THE "NEVER STEP BACK" READING, built from the FORWARD HALF of the deferred call rather than from the call
  // itself: the call now INCLUDES the decision (that is what its name says), so applying it here would apply the
  // same rule twice and the comparison would be against itself. `deferredHalf` is exactly the board a group is
  // on before the decision - which is what the applicator resolves from, and what this control is about.
  const merge = (board, groups) => {
    const merged = new Map();
    for (const g of groups) {
      const ids = seq.selectionIds(board, g.selection) ?? [];
      const forward = findCodedMove(g.call)?.deferredHalf;
      if (forward) {
        const f = forward(board, ids);
        for (const id of ids) merged.set(id, pose(f, id));
        continue;
      }
      const r = seq.applyToBoard(board, `${g.selection} ${g.call}`);
      if (!r.legal) return null;
      for (const id of ids) merged.set(id, pose(r.board, id));
    }
    return { dancers: board.dancers.map((d) => merged.get(d.id) ?? d) };
  };
  const differ = (a, b) => a.dancers.reduce((n, d) => {
    const o = b?.dancers.find((x) => x.id === d.id);
    return n + (!o || Math.hypot(o.x - d.x, o.y - d.y) > 1e-9 ? 1 : 0);
  }, 0);

  // (a) no spot taken -> the two readings are the SAME board, so the rule invents no motion.
  const dpt = at('Double Pass Thru');
  const stayStep = [{ selection: 'Girls', call: 'Step Forward and Back if Possible' }, { selection: 'All Except Girls', call: 'Wheel Around' }];
  seq.setBoard(dpt);
  const stay = seq.applyStep({ groups: stayStep });
  const stayPlain = merge(dpt, stayStep);
  console.log(`    every stepper stays (Double Pass Thru): the plain merge differs on ${differ(stay.board, stayPlain)} of 8 dancers`);
  check(stay.legal && differ(stay.board, stayPlain) === 0,
    'where nobody takes a spot the rule is invisible: the plain merge already has everybody where the rule leaves them');

  // (b) spots taken -> the boards differ by exactly the dancers that came back.
  const square = at('Static Square');
  const backStep = [{ selection: 'Heads', call: 'Step Forward and Back if Possible' }, { selection: 'All Except Heads', call: 'Touch a Quarter' }];
  seq.setBoard(square);
  const back = seq.applyStep({ groups: backStep });
  const heads = seq.selectionIds(square, 'Heads') ?? [];
  const returned = heads.filter((id) => fate(pose(square, id), pose(back.board, id)) === 'returned').length;
  const backPlain = merge(square, backStep);
  console.log(`    ${returned} of 4 steppers return (Static Square, Touch a Quarter): the plain merge differs on ${differ(back.board, backPlain)} of 8 dancers`);
  check(back.legal && returned === 4 && differ(back.board, backPlain) === 4,
    'and where a spot is taken the two differ by EXACTLY the dancers that came back - the deferral is the mechanism');

  // (c) and the difference is the POINT of the rule: it is what keeps two bodies off one spot. The sides' own
  // call walks them into the centre, which is where the stepped-forward heads would have been.
  const overlapsRule = overlappingDancers(back.board).length;
  const overlapsPlain = backPlain ? overlappingDancers(backPlain).length : -1;
  console.log(`    overlapping bodies: the rule's board ${overlapsRule}, the plain merge ${overlapsPlain}`);
  check(overlapsRule === 0 && overlapsPlain === 4,
    `the rule leaves NO two dancers on one spot where the plain merge leaves ${overlapsPlain} - which is what "if there is someone in their original position, they remain where they are" is for`);
}

// ------------------------------------------------------------------ 7. the SCRUB
//
// REPORTED FROM USE, after the call worked: "When adding this Step forward call as a separate call, It isnt
// animated using the scrub." It was applied, legal and charged - and the scrub froze on the step's own start
// board. The cause was the WALK, not the geometry: `replayWalk` records a scoped step's walkability from the
// CATALOGUE variant, and `Step Forward` has no tams at all, so the step was recorded unwalkable with 0 beats -
// and `evaluateSequence` returns `s.before` for any unwalkable step. So the board never moved.
//
// The walk must agree with the APPLICATOR, which is the invariant this walk exists to keep (the module says so
// in as many words: a call that is legal, moves the dancers and animates nothing is the failure to avoid). The
// measurements below are that agreement, and the mid-step board is the one that fails if it is broken again:
// with the step unwalkable, EVERY beat returns the start board.
console.log('\n== 7. the scrub animates it: the walk charges it and the board MOVES ==');
{
  const square = at('Static Square');
  const heads = seq.selectionIds(square, 'Heads') ?? [];
  const sides = square.dancers.filter((d) => !d.isGhost && !heads.includes(d.id)).map((d) => d.id);
  const flat = ['Heads Step Forward']; // the form the picker stores: the group prefix is IN the name
  // ...and the same step written with the selection as a FIELD (`CallStep`), which the walk used to read as
  // whole-board and mark unwalkable. Both forms are the same step.
  const flatFields = [{ selection: 'Heads', call: 'Step Forward' }];
  const midKey = (f) => seq.evaluateSequence(f, 1, square).board.dancers
    .map((d) => `${d.id}:${d.x.toFixed(6)},${d.y.toFixed(6)},${d.heading.toFixed(6)}`).join(';');
  check(midKey(flat) === midKey(flatFields),
    'a step written as "Heads Step Forward" and as {selection, call} walk IDENTICALLY (the walk used to drop the field form\'s selection and record it unwalkable)');

  const stop = seq.sequenceStop(flat, square);
  check(stop === null, `a lone "Heads Step Forward" does not stop the walk (${stop ? stop.reason : 'no stop'})`);
  const beats = seq.sequenceBeats(flat, square);
  check(beats === 2, `and it is charged the call's own ${beats} beats, so the scrub has a span to run over`);

  const dist = (board, id) => {
    const a = pose(square, id);
    const b = pose(board, id);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const half = seq.evaluateSequence(flat, 1, square).board;
  const end = seq.evaluateSequence(flat, 2, square).board;
  const halfMoved = heads.map((id) => dist(half, id));
  console.log(`    at beat 1 of 2 the heads have travelled ${halfMoved.map((d) => d.toFixed(3)).join(', ')} units; at beat 2: ${heads.map((id) => dist(end, id).toFixed(3)).join(', ')}`);
  check(halfMoved.every((d) => Math.abs(d - 1) < 1e-9),
    'at HALF the call each designated dancer is exactly HALF way - so the scrub shows the step, rather than freezing on the start board (which is what an unwalkable step returned at EVERY beat)');
  check(heads.every((id) => Math.abs(dist(end, id) - 2) < 1e-9), 'and by the end of it they are the full 2 units along');
  check(sides.every((id) => dist(half, id) < 1e-12 && dist(end, id) < 1e-12),
    'with the dancers nobody designated standing exactly still for the whole of it');

  // The same agreement, one level up: the walk's own end board IS what the evaluator ends on.
  seq.setBoard(square);
  const applied = seq.applyToBoard(square, 'Heads Step Forward');
  check(heads.every((id) => same(pose(end, id), pose(applied.board, id))),
    'and the board the SCRUB ends on is the board the APPLY produces - one reading, not two');

  // AND THE ROUND-TRIP CALL DANCED ALONE, whose two ends are the SAME board: it is walkable too, and its scrub
  // shows the step out and the step back rather than nothing at all.
  const round = ['Heads Step Forward and Back if Possible'];
  const roundBeats = seq.sequenceBeats(round, square);
  const roundTrace = Array.from({ length: roundBeats + 1 }, (_, b) => dist(seq.evaluateSequence(round, b, square).board, heads[0]));
  console.log(`    a lone round trip over ${roundBeats} beats: ${roundTrace.map((d) => d.toFixed(2)).join(', ')}`);
  check(roundBeats === 4 && seq.sequenceStop(round, square) === null,
    `danced alone it is walkable and costs its own ${roundBeats} beats`);
  check(Math.abs(roundTrace[1] - 1) < 1e-9 && Math.abs(roundTrace[2] - 2) < 1e-9 && Math.abs(roundTrace[3] - 1) < 1e-9 && roundTrace[4] === 0,
    'and the scrub shows 1.00, 2.00, 1.00, 0.00 - out over two beats and back over the next two, where a straight line between its two (identical) ends would show no movement at all');
}

// ------------------------------------------------------------------ 8. the "while" ANIMATION
//
// REPORTED FROM USE, on the pair this call made worth composing: "When I apply Sides Promenade 3/4 to Home in
// parallel with Step Forward, the dancers move in parallel, but the sides seem to take a direct shortcut
// between the start and end formation and the parallel call only lasts as long as the Step Forward." Then, on
// the pacing: "A Step forward should take 2 beats to move the two steps. The rest of it should be stand still."
//
// Both were ONE defect in `evaluateGroupAt`, which blended every dancer STRAIGHT from `before` to `after` over
// the step's beats: the promenade group walked a chord through the middle of the set instead of wheeling round
// the ring, and every group was drawn at the same pace. The fix animates each group with the SAME function a
// lone scoped step uses (so a group in a "while" step animates exactly as it would alone) and gives each group
// its OWN clock, holding at its end pose once its own call is over.
console.log('\n== 8. a "while" group walks its OWN path at its OWN pace ==');
{
  const square = at('Static Square');
  const sides = seq.selectionIds(square, 'Sides') ?? [];
  const heads = seq.selectionIds(square, 'Heads') ?? [];
  const step = { groups: [{ selection: 'Sides', call: 'Promenade 3/4 to Home' }, { selection: 'All Except Sides', call: 'Step Forward and Back if Possible' }] };
  const alone = [{ selection: 'Sides', call: 'Promenade 3/4 to Home' }];
  const atBeat = (flat, b) => seq.evaluateSequence(flat, b, square).board;
  const total = seq.sequenceBeats([step], square);
  console.log(`    ${stepLabel(step)} - ${total} beats`);
  check(total === 12, `the pair costs the PROMENADE's ${total} beats, not the step's 2`);

  // (a) THE PATH IS THE CALL'S OWN. Sampled at the same beat, a promenading dancer is in the same place in the
  // pair as it is when the call is danced alone - which is the invariant, and it is exact rather than close.
  let worst = 0;
  for (let b = 0; b <= 12; b++) {
    const solo = atBeat(alone, b);
    const pair = atBeat([step], b);
    for (const id of sides) {
      const a = pose(solo, id);
      const c = pose(pair, id);
      worst = Math.max(worst, Math.hypot(a.x - c.x, a.y - c.y));
    }
  }
  check(worst < 1e-9, `a group in a "while" step is at EXACTLY the pose it would be at alone, at every beat of the call (worst difference ${worst.toExponential(2)} units)`);

  // (b) SHOWN TO FAIL - the shortcut. The straight line from where a side starts to where the step leaves it
  // passes through the middle of the set; the call does not.
  seq.setBoard(square);
  const appliedPair = seq.applyStep(step);
  check(appliedPair.legal, `the pair applies (${appliedPair.reason ?? 'legal'})`);
  const mid = atBeat([step], 6);
  let worstChord = 0;
  for (const id of sides) {
    const a = pose(square, id);
    const e = pose(appliedPair.board, id);
    const z = pose(mid, id);
    const chord = { x: a.x + (e.x - a.x) / 2, y: a.y + (e.y - a.y) / 2 };
    worstChord = Math.max(worstChord, Math.hypot(z.x - chord.x, z.y - chord.y));
  }
  console.log(`    at the halfway beat the promenading dancers are ${worstChord.toFixed(2)} units off the straight line from start to end`);
  check(worstChord > 1,
    `they are NOWHERE NEAR the straight line between the two formations (${worstChord.toFixed(2)} units off it at the halfway beat) - the reported "direct shortcut"`);

  // (c) THE PACING. Step Forward moves over its own 2 beats and then STANDS STILL for the rest of the call.
  const dist = (board, ref, id) => Math.hypot(pose(board, id).x - pose(ref, id).x, pose(board, id).y - pose(ref, id).y);
  const moved = [0, 1, 2, 3, 6, 12].map((b) => dist(atBeat([step], b), square, heads[0]));
  console.log(`    the stepping dancer's distance from its start at beats 0,1,2,3,6,12: ${moved.map((d) => d.toFixed(3)).join(', ')}`);
  check(Math.abs(moved[1] - 1) < 1e-9 && Math.abs(moved[2] - 2) < 1e-9,
    'it travels 1 unit at beat 1 and the full 2 at beat 2 of the pair - its own two beats, not the promenade\'s twelve');
  check(moved[3] === moved[2] && moved[4] === moved[2] && moved[5] === moved[2],
    'and from beat 2 onwards it does not move at all: the rest of the call is STAND STILL, as asked for');
  check(heads.every((id) => dist(atBeat([step], 12), appliedPair.board, id) < 1e-9),
    'while the last frame is still the board the step APPLIED - the animation converges on the applied board');

  // ...and the other group is not held: the promenade is still travelling at beat 6.
  const sideMove = dist(atBeat([step], 6), square, sides[0]);
  check(sideMove > 2, `and the promenade has NOT finished by then (${sideMove.toFixed(2)} units travelled), so the hold belongs to the short call and not to the step`);
}

// ------------------------------------------------------------------ 9. the ROUND TRIP
//
// REPORTED FROM USE, on the same feature one fraction later: "if I apply Sides Promenade 1/2 to Home in parallel
// with Step Forward, the sequencer suggests they have been applied, but the step forward dancers dont move. I
// suspect it is because they start an end that the same place." The guess is exactly right, and the rule is
// right too: `Promenade 1/2 to Home` brings the sides back to their OWN four spots, so nobody is standing on the
// spots the heads left, so the heads step back - the pair nets to the promenade alone, which is what the request
// asks for ("if nobody is in their original position, they step back").
//
// WHAT WAS WRONG WAS THE ANIMATION: the group's start and end boards were the SAME board, and a two-point
// interpolation between identical boards draws nothing - so the caller could not see that the step happened at
// all. The call has TWO moves in it, and the request says where they go: the step at the start, and the step
// BACK "at the end of the call". So a deferred group now walks forward over its own beats, HOLDS, and walks back
// over the last of them.
console.log('\n== 9. a deferred group that RETURNS is shown stepping in and back out ==');
{
  const square = at('Static Square');
  const heads = seq.selectionIds(square, 'Heads') ?? [];
  const sides = seq.selectionIds(square, 'Sides') ?? [];
  const step = { groups: [{ selection: 'Sides', call: 'Promenade 1/2 to Home' }, { selection: 'All Except Sides', call: 'Step Forward and Back if Possible' }] };
  const total = seq.sequenceBeats([step], square);
  const atBeat = (b) => seq.evaluateSequence([step], b, square).board;
  const dist = (board, ref, id) => Math.hypot(pose(board, id).x - pose(ref, id).x, pose(board, id).y - pose(ref, id).y);
  const trace = Array.from({ length: total + 1 }, (_, b) => dist(atBeat(b), square, heads[0]));
  console.log(`    ${stepLabel(step)} - ${total} beats`);
  console.log(`    the stepping dancer's distance from its start at each beat: ${trace.map((d) => d.toFixed(2)).join(', ')}`);
  check(total === 8, `the pair costs the promenade's ${total} beats`);

  // The end board is the start board for those dancers - which is the rule, and why the round trip is invisible
  // to a two-point interpolation.
  seq.setBoard(square);
  const applied = seq.applyStep(step);
  check(applied.legal, `the pair applies (${applied.reason ?? 'legal'})`);
  check(heads.every((id) => dist(applied.board, square, id) < 1e-9),
    'the stepping dancers END where they started, because the promenade brought the others home and their spots were never taken');
  check(heads.every((id) => dist(atBeat(total), applied.board, id) < 1e-9),
    'and the last frame of the scrub is still the applied board');

  // THE ROUND TRIP ITSELF: out, still, back.
  const forward = trace.findIndex((d) => d > 1.9);
  const back = trace.length - 1 - [...trace].reverse().findIndex((d) => d > 1.9);
  const still = trace.filter((d) => d > 1.9).length;
  check(Math.abs(trace[1] - 1) < 1e-9 && Math.abs(trace[2] - 2) < 1e-9,
    'it steps OUT over its own two beats (1.000 at beat 1, 2.000 at beat 2)');
  check(forward === 2 && still === 5,
    `it then STANDS STILL for ${still} beats (the middle of the call)`);
  check(Math.abs(trace[total - 1] - 1) < 1e-9 && trace[total] === 0,
    'and steps BACK over the last two beats, finishing home - the step in and the step out are both visible, which is what a two-point interpolation could not show');
  check(back === total - 2, `with the step back starting exactly two beats before the end (beat ${back} of ${total}), as the request says ("at the end of the call ... they step back")`);
  check(trace.some((d) => d > 1.9), 'SHOWN TO FAIL: the dancers DO move through the middle of this step - the reported "dont move" is the absence of the round trip, not a step that was never taken');

  // The other group is on its own path at the same time: the sides are promenading, not standing.
  const sideMove = sides.map((id) => dist(atBeat(4), square, id));
  check(sideMove.every((d) => d > 2), `and the promenading dancers are well away from their own start at the halfway beat (${sideMove.map((d) => d.toFixed(2)).join(', ')} units)`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
