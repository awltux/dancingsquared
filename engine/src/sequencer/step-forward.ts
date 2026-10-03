// `Step Forward`: a derived call that walks a designated group forward along its own facing, and the
// RETURN-OR-STAY rule that resolves it when it is danced ALONGSIDE another call.
//
// ASKED FOR, in the words of the request: "Create a Coded Call for 'Step In'. The named dancers step forward 2
// dimensions. This is intended to work in parallel with another Call. It takes on the duration of the other call
// and if at the end of the call nobody is in their original position, they step back 2 dimensions. If there is
// someone in their original position, they remain where they are." Then, on the questions the first reading left
// open: the unit is **2 board units** (the cell the magnets, the spans and the moves editor all use, where a
// `Forward` is 1); "forward" is **the dancer's own facing** (+X in its own frame, which is how every other move
// in this corpus is authored); it is called **`Step Forward`**, not "Step In" - a separate `Step Forward and
// Back` is coming - and CALLED ON ITS OWN it is legal and simply stays where it stepped.
//
// WHY IT IS DERIVED RATHER THAN A CATALOGUE SETUP. There is no such call in the corpus at all (no title, no
// tam, nothing in the call index) - it is a caller's own building block, so there is no authored motion to
// match and no formation to match it against. Like `Fold` and `Trade`, it names a GROUP ("Heads Step Forward"),
// which is why the bare name is refused: there is no whole-set reading of a step that is meant to displace
// some dancers and leave the others exactly where they stand.
//
// WHY THE RETURN IS NOT PART OF THE RULE. `Step Forward` on its own has ONE answer - step, and stay - and the
// return depends on a fact the call itself cannot see: whether somebody has moved onto the spot it left. That
// fact only exists once the OTHER groups in the same "while" step have been applied, which is why the second
// half of the behaviour lives in `resolveStepForward` and why the move is registered as DEFERRED (see
// `CodedMove.deferred`): the "while" step applies it LAST, against what the others left on the floor.
//
// WHY "SOMEBODY IS IN MY SPOT" IS THE BODY MODEL RATHER THAN A DISTANCE. The question is "is there room to
// stand where I came from", and this engine already answers that question - `bodyOverlap`, the same oriented
// 0.95 x 0.45 body the contact rules and the collision guard measure. A dancer standing on the spot overlaps
// it by construction; a dancer on the NEXT spot does not (measured: 0.05 of air at the tightest facing pass),
// so the test separates exactly the two cases the caller cares about without a second tolerance to tune. A
// GHOST does not block the return, for the reason `bodies.ts` gives for excluding ghosts everywhere: it is a
// geometric reference, not a dancer.

import { bodyOverlap } from './bodies.js';
import type { Board } from './types.js';

/** A board dancer, narrowed to what this rule reads. */
type D = Board['dancers'][number];

/**
 * HOW FAR A DESIGNATED DANCER STEPS, in board units.
 *
 * Two, as asked for. `1` would be a single cell (`Forward`), and this is deliberately the same unit: the
 * magnifier, the span readouts and the moves editor all count in these units, so a caller reading "2" off the
 * board and a caller reading it off this file mean the same distance.
 */
export const STEP_FORWARD_UNITS = 2;

/**
 * WHAT `Step Forward` COSTS, in beats - and it is also the length of ONE LEG of the round trip.
 *
 * A step is not a call with a timing of its own here - CALLERLAB times a single step at about two beats, which
 * is what `Fold` and `Sweep a Quarter` are charged too. It is stated so the call can be sequenced alone at all,
 * and it is deliberately NOT what makes a parallel step cost anything: in a "while" step a DEFERRED group
 * contributes NO beats, because the request says such a call "takes on the duration of the other call".
 */
export const STEP_FORWARD_BEATS = 2;

/**
 * AND WHAT `Step Forward and Back if Possible` COSTS: the same two beats OUT and two beats BACK.
 *
 * One number rather than a formula, because the two legs are what the call IS. The animation divides it in half
 * for the two legs, so a two-beat step inside a twelve-beat promenade walks out over two beats, stands for
 * eight, and walks back over the last two - which is the pacing asked for in as many words ("A Step forward
 * should take 2 beats to move the two steps. The rest of it should be stand still").
 */
export const STEP_FORWARD_AND_BACK_BEATS = STEP_FORWARD_BEATS * 2;

/** Which dancers returned to the spot they left, and which stayed where they stepped. */
export interface StepForwardResolution {
  board: Board;
  /** Dancer ids that stepped back, because their own spot was free. */
  returned: number[];
  /** Dancer ids that stayed stepped forward, because somebody is standing on the spot they left. */
  stayed: number[];
}

/**
 * THE FORWARD HALF ON ITS OWN: every designated dancer moved `units` along ITS OWN facing, nobody else touched.
 *
 * ONE DEFINITION, THREE CALLERS, and they have to agree or the two calls would disagree about what a step is:
 *
 *   - `stepForwardRule`, the whole of `Step Forward`;
 *   - `stepForwardAndBackRule`, which is this board and then the return decision;
 *   - `CodedMove.deferredHalf`, which is how the APPLICATOR gets the half-way board of
 *     `Step Forward and Back if Possible` in a "while" step - it needs the stepped board to resolve the return
 *     against the other groups, and calling that call's own `applyToSelection` would hand it the already-decided
 *     board instead.
 *
 * The heading does not change - a step is a translation, not a turn.
 */
export function stepForwardSteps(board: Board, selectedIds: number[], units = STEP_FORWARD_UNITS): Board {
  const picked = new Set(selectedIds);
  const dancers = board.dancers.map((d: D) => {
    if (d.isGhost || !picked.has(d.id)) return d;
    return {
      ...d,
      x: d.x + units * Math.cos(d.heading),
      y: d.y + units * Math.sin(d.heading),
    };
  });
  return { ...board, dancers };
}

/** Whether a designation names anybody - the one test both rules refuse on. */
function requireActives(board: Board, selectedIds: number[], call: string): { reason: string } | null {
  const picked = new Set(selectedIds);
  const actives = board.dancers.filter((d) => !d.isGhost && picked.has(d.id));
  if (actives.length === 0) {
    return { reason: `${call} needs at least one designated dancer ("Heads ${call}"), and none is designated` };
  }
  return null;
}

/**
 * `Step Forward`: the designated dancers step, and that is all there is to it - they STAY where they stepped.
 *
 * The destination is NOT checked for another body. A coded rule here reports geometry, and standing on top of
 * somebody is a fact about the pair rather than about this call: the engine's collision guard (`bodyCollisionMode`)
 * and the end-board reads are where that is judged, exactly as they are for every other derived call.
 *
 * ASKED FOR AS ITS OWN CALL, apart from the round trip: "create another Coded call named 'Step Forward', that
 * just steps forward over 2 beats. If its part of parallel calls, it stands still for the remainder of the other
 * call." The standing still is not this rule's business - it is the "while" step's own pacing, which gives each
 * group its own beats and holds it at its end pose once they are up (see `SequenceAnalyzer.evaluateGroupAt`).
 */
export function stepForwardRule(
  board: Board,
  selectedIds: number[],
): { board: Board } | { reason: string } {
  const problem = requireActives(board, selectedIds, 'Step Forward');
  if (problem) return problem;
  return { board: stepForwardSteps(board, selectedIds) };
}

/**
 * `Step Forward and Back if Possible`: step forward, and step BACK when the way back is clear.
 *
 * This is the call that was asked for first, under the name it now carries: "The named dancers step forward 2
 * dimensions ... if at the end of the call nobody is in their original position, they step back 2 dimensions.
 * If there is someone in their original position, they remain where they are." It is the same rule in BOTH
 * places it can run, which is what the name promises:
 *
 *   - DANCED ALONE, "if possible" is always possible, because nobody else has moved onto the spot that was
 *     left - so it steps out and back, ending where it started over `STEP_FORWARD_AND_BACK_BEATS`. There used to
 *     be a special case that left a lone dancer standing where it stepped; asked for in as many words as "Make
 *     it step back too - one rule everywhere", it is gone;
 *   - IN A "WHILE" STEP it is DEFERRED, because the answer depends on what the other groups did: the applicator
 *     resolves it against the board they leave (`resolveStepForward`), which is where a dancer really can find
 *     its spot taken and stay out.
 */
export function stepForwardAndBackRule(
  board: Board,
  selectedIds: number[],
): { board: Board } | { reason: string } {
  const problem = requireActives(board, selectedIds, 'Step Forward and Back if Possible');
  if (problem) return problem;
  const stepped = stepForwardSteps(board, selectedIds);
  // "The end of the call" when it is danced alone: nobody else moved, so the other dancers are where they
  // started - which is the board minus the group.
  const others: Board = { dancers: board.dancers.filter((d) => !selectedIds.includes(d.id)) };
  return { board: resolveStepForward(board, stepped, others, selectedIds).board };
}

/**
 * THE RETURN-OR-STAY RULE: resolve the deferred half of `Step Forward and Back if Possible` against the board
 * the OTHER groups left.
 *
 * For each designated dancer, at the end of the call:
 *
 *   - **its own spot is clear** -> it steps back, and ends where it started;
 *   - **somebody is standing on it** -> it stays where it stepped, because the way back is occupied.
 *
 * PER DANCER, not all-or-nothing. The request reads "if at the end of the call nobody is in their original
 * position, they step back ... if there is someone in their original position, they remain where they are",
 * and the answer is a property of ONE dancer's spot: two dancers of the same group can have different fates
 * (measured on a squared set: the heads step in, the sides circulate onto the head spots, and each head decides
 * for itself).
 *
 * `start` is the board before the step (the original poses), `stepped` is the board after `stepForwardRule`,
 * `others` is every OTHER dancer at the pose it ends the step in. Entries in `others` for the designated
 * dancers themselves are IGNORED, so a caller may pass the whole merged board without it counting the dancers
 * as standing on their own spots.
 */
export function resolveStepForward(
  start: Board,
  stepped: Board,
  others: Board,
  ids: number[],
): StepForwardResolution {
  const picked = new Set(ids);
  const endById = new Map<number, D>(others.dancers.map((d) => [d.id, d]));
  const decided = new Map<number, D>();
  const returned: number[] = [];
  const stayed: number[] = [];

  for (const id of ids) {
    const from = start.dancers.find((d) => d.id === id);
    const to = stepped.dancers.find((d) => d.id === id);
    if (!from || !to) continue;
    // Somebody else's body on the spot this dancer came from. Ghosts are not bodies, and the group's own
    // dancers are not "somebody else" - a dancer cannot keep itself out of its own spot.
    const taken = others.dancers.some(
      (o) => o.id !== id && !o.isGhost && !picked.has(o.id) && bodyOverlap(from, o),
    );
    decided.set(id, taken ? to : from);
    (taken ? stayed : returned).push(id);
  }

  const byId = (a: number, b: number) => a - b;
  return {
    board: {
      dancers: start.dancers.map((d) => {
        if (picked.has(d.id)) return decided.get(d.id) ?? d;
        return endById.get(d.id) ?? d;
      }),
    },
    returned: returned.sort(byId),
    stayed: stayed.sort(byId),
  };
}
