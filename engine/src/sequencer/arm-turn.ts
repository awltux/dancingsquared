// THE ARM TURN FAMILY AS A RULE: one hand, one fraction, from the board's own forearm grips.
//
// CALLERLAB Mainstream, `Arm Turn Family / a. Right/Left Arm Turn`: "Starting formations: Facing Dancers,
// Mini-Wave. Dance action: Dancers join indicated forearms and walk forward around each other. The amount of
// turn can be specified as a fraction (for example, Half (180 degrees), Three-Quarters (270 degrees), Full
// (360 degrees)) or implicitly by the next call." The command examples are `Left Arm Turn Three-Quarters`,
// `All Arm Turn Half` and `Centers Arm Turn Three-Quarters`.
//
// WHY A RULE AND NOT MORE TAMS. The corpus authored two fractions of two hands - `Left Arm Turn 3/4` and
// `Right Arm Turn 3/4` - and every other combination the definitions describe (`All Arm Turn Half`, the full
// turn, either hand at the half) had no authoring at all, so the family was mostly unreachable. The motion is
// ONE RIGID ROTATION PER GRIP, which is exactly the shape a derived rule can carry, and the two authored tams
// stay as the reference the rule is checked against - MEASURED in `engine/test/arm-turn.mjs`: from the corpus's
// own start boards the rule reproduces both shipped tams to **0.000 units and 0.00 degrees, every dancer**.
//
// THE PAIRING IS THE ENGINE'S OWN HOLD SOLVER, not a second reading of who holds whom: `computeHandholds` in
// `static` mode gives at most one grip per hand per dancer, and the arm-turn partner is the grip in the named
// hand. That is deliberate - the same solver already decides handholds for the render and for the bodies
// checks, so the call and the picture cannot disagree about who is holding whom.
//
// THE SIGN IS THE DANCE'S, MEASURED OFF THE AUTHORED TAMS RATHER THAN DERIVED FROM THE PICTURE: a LEFT arm turn
// is +theta in this frame and a RIGHT one -theta. `Left Arm Turn 3/4` changes every dancer's heading by -90
// degrees (+270 = three quarters counter-clockwise) and `Right Arm Turn 3/4` by +90. Written the other way
// round the rule produces the MIRRORED pair - every position right, every identity swapped within its pair -
// which is the mistake the cross-check against the tams exists to catch. (It caught it: the first version had
// the sign this way round and failed the per-id comparison by exactly one pair's width.)
//
// WHAT IT DOES NOT READ. The other documented starting formation, FACING DANCERS, is not derived here: the hold
// solver refuses a partner directly in front by design (its side-hold rule keeps facing pairs from grabbing each
// other), and the corpus authors that form as `Turn Partner by the Right` / `Turn Partner by the Left`, which
// are the tams a Facing Dancers board reaches. A board that is neither is refused with a reason that says so,
// rather than being turned about a grip that is not there.
//
// BEATS ARE CALLERLAB'S OWN TIMING for the family - "Half: 4, Three-Quarter: 4 to 6, Full: 6 to 8" - taken at
// the middle of each range where the range is not a single number, so the timeline is a stated reading of the
// document rather than an invented value.

import { computeHandholds } from '../handholds.js';
import { normAngle } from '../moves.js';
import type { Board, SeqDancer } from './types.js';

export type ArmTurnHand = 'left' | 'right';

/** One fraction of the family: the labels it is written with, the angle, and CALLERLAB's timing. */
export interface ArmTurnFraction {
  /** How the fraction is spelled in a call name, first spelling canonical (`3/4`). */
  readonly spellings: readonly string[];
  readonly radians: number;
  readonly beats: number;
}

/** CALLERLAB lists Half, Three-Quarters and Full; a quarter turn by the forearm is `Hinge`, not this family. */
export const ARM_TURN_FRACTIONS: readonly ArmTurnFraction[] = [
  { spellings: ['1/2', 'Half'], radians: Math.PI, beats: 4 },
  // 4.5 IS THE CORPUS'S OWN BEATS for `Left Arm Turn 3/4`, and it is inside CALLERLAB's `4 to 6`; taking the
  // middle (5) would have moved a shipped call's timeline for no gain. The other two have no authored beats, so
  // they take the middle of their range.
  { spellings: ['3/4', 'Three-Quarters', 'Three Quarters'], radians: (3 * Math.PI) / 2, beats: 4.5 },
  { spellings: ['Full'], radians: 2 * Math.PI, beats: 7 },
];

/** The hand spellings, and which way each turns. `Arm Turn` alone is by the RIGHT - CALLERLAB spells the pair
 *  `Right/Left Arm Turn` and every `Arm Turn` command example it gives is a right-arm turn. */
const HANDS: readonly { hand: ArmTurnHand; spellings: readonly string[] }[] = [
  { hand: 'right', spellings: ['Arm Turn', 'Right Arm Turn'] },
  { hand: 'left', spellings: ['Left Arm Turn'] },
];

/** The shape `coded-moves.ts` registers; kept structural so this module never imports the registry. */
export interface ArmTurnDef {
  aliases: string[];
  beats: number;
  precondition: (b: Board) => string | null;
  fn: (b: Board) => Board;
}

/** The dancers in the named hand's forearm grips, as id pairs. */
function gripPairs(board: Board, hand: ArmTurnHand): [number, number][] {
  const phys = board.dancers.filter((d) => !d.isGhost);
  if (phys.length === 0) return [];
  // `static` mode gives every dancer both hands available, which is what an arm turn needs: the CALL does not
  // care which hand a previous call left free, it asks who is holding forearms NOW.
  const poses = phys.map((d) => ({ x: d.x, y: d.y, heading: d.heading, hands: 'both' as const }));
  return computeHandholds(poses, 'static')
    .filter((e) => e.hi === hand && e.hj === hand)
    .map((e) => [phys[e.i].id, phys[e.j].id] as [number, number]);
}

/**
 * Whether the board can take an arm turn by this hand, or why it cannot.
 *
 * EVERY dancer must be in exactly one grip of that hand: a dancer with no such grip has no forearm to walk
 * around, and a dancer in two would be turning in two pairs at once. Naming the dancer is the point - "the
 * board is not a wave" would leave a caller to guess which one broke it.
 */
export function armTurnProblem(board: Board, hand: ArmTurnHand): string | null {
  const phys = board.dancers.filter((d) => !d.isGhost);
  if (phys.length === 0) return `${hand === 'left' ? 'Left' : 'Right'} Arm Turn needs dancers to turn`;
  const pairs = gripPairs(board, hand);
  const seen = new Map<number, number>();
  for (const [a, b] of pairs) {
    seen.set(a, (seen.get(a) ?? 0) + 1);
    seen.set(b, (seen.get(b) ?? 0) + 1);
  }
  const unpaired = phys.filter((d) => !seen.has(d.id));
  if (unpaired.length) {
    return `${hand === 'left' ? 'Left' : 'Right'} Arm Turn starts from a Mini-Wave with that forearm held, and #${unpaired[0].id} holds no ${hand} forearm`;
  }
  const doubled = phys.filter((d) => (seen.get(d.id) ?? 0) > 1);
  if (doubled.length) {
    return `${hand === 'left' ? 'Left' : 'Right'} Arm Turn needs one forearm per dancer, and #${doubled[0].id} is in ${seen.get(doubled[0].id)} ${hand} grips at once`;
  }
  return null;
}

/**
 * The turn itself: each pair rotates RIGIDLY about the midpoint of its grip, and both headings turn with it.
 *
 * The midpoint is the grip - two forearms meeting halfway - so the pair walks around that point rather than
 * around either dancer, which is what makes a 3/4 turn leave the two of them swapped about it.
 */
export function armTurn(board: Board, hand: ArmTurnHand, radians: number): { board: Board } | { reason: string } {
  const problem = armTurnProblem(board, hand);
  if (problem) return { reason: problem };
  const pairs = gripPairs(board, hand);
  // MEASURED SIGN: left is positive in this frame, right negative. See the header.
  const theta = hand === 'left' ? radians : -radians;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const byId = new Map<number, SeqDancer>(board.dancers.map((d) => [d.id, { ...d }]));
  for (const [a, b] of pairs) {
    const da = byId.get(a);
    const db = byId.get(b);
    if (!da || !db) continue;
    const mx = (da.x + db.x) / 2;
    const my = (da.y + db.y) / 2;
    for (const d of [da, db]) {
      const dx = d.x - mx;
      const dy = d.y - my;
      d.x = mx + dx * cos - dy * sin;
      d.y = my + dx * sin + dy * cos;
      d.heading = normAngle(d.heading + theta);
    }
  }
  return { board: { dancers: board.dancers.map((d) => byId.get(d.id) ?? d) } };
}

/** Every (hand, fraction) combination as a registry entry: `Right Arm Turn 1/2`, `All`-selectable like any call. */
export function armTurnDefs(): ArmTurnDef[] {
  const defs: ArmTurnDef[] = [];
  for (const frac of ARM_TURN_FRACTIONS) {
    for (const spelling of frac.spellings) {
      for (const h of HANDS) {
        const aliases = h.spellings.map((s) => `${s} ${spelling}`);
        defs.push({
          aliases,
          beats: frac.beats,
          precondition: (b) => armTurnProblem(b, h.hand),
          fn: (b) => {
            const r = armTurn(b, h.hand, frac.radians);
            return 'board' in r ? r.board : b;
          },
        });
      }
    }
  }
  return defs;
}
