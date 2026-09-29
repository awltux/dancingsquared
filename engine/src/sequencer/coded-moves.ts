// Body-relative "coded" calls: Face / Turn / In / Out. Like Face Left and Face
// Right in Taminations, these are the same per-dancer transform regardless of
// formation, so they are applied straight from the geometry rather than matched
// to a catalog <tam>.
//
// This is the SINGLE source of truth for them. The Sequencer applies them to the
// live board, and the SequenceAnalyzer replays and animates them, so a sequence
// containing a coded move has real beats and animates instead of silently
// contributing nothing.
//
// A coded move occupies CODED_MOVE_BEATS on the timeline and animates as a smooth
// rotation from each dancer's current facing to the new one (positions do not
// change: these are pivots and re-facings).
//
// A GEOMETRY-DERIVED call may also carry a PRECONDITION (`applies`): `Promenade`
// is legal only from a set the dancers can wheel home from, and it is not a pivot
// (it moves everybody). It is registered here because it needs exactly what this
// registry provides — one definition shared by the Sequencer and the analyser, with
// a beat count — and its rule lives in promenade.ts.

import { applyMoveToBoard, applyFaceInOutToBoard, FaceLeft, FaceRight, FaceHalf, normAngle } from '../moves.js';
import { promenadeApplies, promenadeFraction, promenadeHome, promenadeProblem, PROMENADE_ALIASES, PROMENADE_BEATS } from './promenade.js';
import { isKnownCouple } from './constants.js';
import { findCouplePairs, type CouplePair } from './couples.js';
import { runRule, tradeRule } from './trade-run.js';
import { foldRule } from './fold.js';
import { sweepBox, sweepProblem, sweepCollision } from './sweep.js';
import { swingThru, swingThruLegs } from './swing-thru.js';
import { fanTheTop, fanTheTopProblem } from './fan-the-top.js';
import type { Board } from './types.js';

/** Timeline length of a coded pivot, in beats. */
export const CODED_MOVE_BEATS = 1;

/** Timeline length of the derived Run / Trade, in beats — the value the authored `Run` and
 * `Trade` tams carry, so the timeline does not shift when the derived call replaces them. */
export const RUN_TRADE_BEATS = 4;

/** Timeline length of `Fold` in beats: CALLERLAB's own `Timing: 2` for the call. */
export const FOLD_BEATS = 2;

/** Timeline length of `Cross Fold` in beats: CALLERLAB's own `Timing: 4` for the call. */
export const CROSS_FOLD_BEATS = 4;

/** Timeline length of `Sweep a Quarter` in beats: CALLERLAB's own `Timing: 2`. */
export const SWEEP_BEATS = 2;

/** Timeline length of `Fan the Top` in beats: CALLERLAB's own `Timing: 4`. */
export const FAN_THE_TOP_BEATS = 4;

/** Timeline length of `Roll`, in beats — the reference's `QuarterLeft`/`QuarterRight` carry
 * `beats: 1.5` (`moves.dart:56-58`), and `Roll` is exactly that move chosen per dancer. */
export const ROLL_BEATS = 1.5;

/** Timeline length of the Mainstream `Swing Your Partner`, in beats: the value the authored
 * `ms/swing.xml` tam carries, so the timeline does not shift when the derived call replaces it —
 * the same reason `RUN_TRADE_BEATS` copies the authored Run/Trade tams. */
export const SWING_BEATS = 9;

/** Timeline length of `Swing Thru`, in beats: CALLERLAB's own `Timing: 6` for the call, and the
 * authored tams agree closely enough that the timeline does not shift materially. */
export const SWING_THRU_BEATS = 6;

/**
 * `Swing Your Partner` — the Mainstream swing — as a DERIVED call, because its authored motion is
 * the IDENTITY TRANSFORM. Measured on the shipped `ms/swing.xml` tam from `Facing Couples`:
 * **0 of 8 dancers moved and 0 of 8 facings changed**. A partner swing is a full turn taken around
 * your partner, so every dancer finishes on its own spot facing its own way, which in this engine's
 * net model (a position and a heading) is a no-op. `Swing Your Corner` is NOT this call — it moves
 * 8 of 8 — and stays an ordinary authored tam.
 *
 * WHY IT IS DERIVED RATHER THAN AUTHORED PER FORMATION. The Mainstream `Swing` is the singing-call
 * ending ("Swing and Promenade") and stops **65 of All8's 188 published figures** at the tail, but
 * the catalogue authors it from `Facing Couples` alone — so the engine cannot swing from a squared
 * set, the allemande-left pose, `Eight Chain Thru`, `Trade By` or `Lines Facing Out`, which is
 * where it is actually called. The net effect being the identity makes the call formation-
 * INDEPENDENT, so no per-formation authoring is needed and none is invented.
 *
 * THE PRECONDITION IS THE CALL'S OWN DEFINITION, not a heuristic: you can only swing your PARTNER,
 * so the board has to carry identity (home couples) and each couple has to be a man and a woman.
 * What it is NOT is a requirement that the two are already standing together — a swing is what brings
 * them together. Until Phase 11 it required the pair to be 1.0..3.0 apart (`Promenade`'s own
 * "standing as a couple" band), which refused 48 of the 188 published figures, every one of them from
 * a wave, a line or an Eight Chain Thru. A board with no home identity still refuses, exactly as
 * Promenade does: "your partner" is a fact about identity, not about geometry (§8.2).
 *
 * WHERE THE NAME LIVES, and why the bridge is here rather than in `CALL_SYNONYMS`: the engine's
 * call named `Swing` is a DIFFERENT call — the A2 `Swing` from `a2/slip.xml` (waves, tidals,
 * inverted lines, `Swing Left`/`Swing Right`). A `CALL_SYNONYMS` entry would collide in the
 * registry (one of the two would silently overwrite the other), so All8's own reading — its key
 * says `Swing  Swing (your partner or your corner, etc.)`, the Mainstream call — is emitted as
 * `Swing Your Partner` by the token table instead, leaving the A2 family untouched.
 */
/**
 * The current pairs, grouped by the number the pair carries (the boy's). Shaped as a Map so it can be
 * checked by the same rule the home grouping is checked by.
 */
function pairUp(pairs: CouplePair[]): Map<number, Board['dancers'][number][]> {
  const out = new Map<number, Board['dancers'][number][]>();
  for (const { boy, girl } of pairs) {
    const list = out.get(boy.couple) ?? [];
    list.push(boy, girl);
    out.set(boy.couple, list);
  }
  return out;
}

function swingProblem(board: Board): string | null {
  const phys = board.dancers.filter((d) => !d.isGhost);
  if (phys.length === 0) return 'Swing needs dancers to swing';

  // THE PAIRING IS THE PRECONDITION; THE SEPARATION IS NOT.
  //
  // A swing brings you and your partner TOGETHER, so where the two of you are standing when the call
  // is made cannot be a requirement of making it. CALLERLAB starts `Swing` from Facing Dancers (Man
  // and Woman), ends it in a Normal Couple, and applies the Ocean Wave Rule; `Swing your Partner` is
  // shorthand for "Face Your Partner; Swing". The old band here (partners 1.0..3.0 apart) refused 48
  // of the 188 published figures, every one of them from an Ocean Wave (18), Lines Facing Out (15),
  // an Eight Chain Thru (11) or an unnamed board (4) - i.e. it refused the call's most common use,
  // because in a wave nobody is holding their partner.
  //
  // The transform is still the identity, which means the couple's END POSE is not modelled - only the
  // pairing is. That is the fidelity gap 9e-1 recorded, and it is why this call is paired with
  // `Promenade`: every one of the 48 figures calls Promenade next, and Promenade forms the ring and
  // normalises the square, so the pairing is enough to get them there. A figure that swings and then
  // continues elsewhere would still see the pre-swing board, and that is recorded in PLAN.md rather
  // than hidden here.

  // WHICH PAIRING? THE CURRENT ONE, and this is a correction. The pairs used to be collected by
  // `d.couple`, which is the dancer's HOME couple - so after any call that changes partners the
  // precondition was asking about a partnership that no longer stands. `Square Thru 2` from a squared
  // set is the measured witness: `#6` ends beside `#1` and `#2` beside `#5`, so the current couples
  // are (5,2) (1,6) (3,4) (7,8) while the home couples still read (5,6) (1,2) (3,4) (7,8). "You swing
  // your PARTNER" is a fact about the dancers who are standing together NOW.
  //
  // THE HOME READING IS KEPT AS A FALLBACK, which makes this strictly more permissive and never less:
  // wherever the home pairing was usable it still is, and a board whose current pairing does not
  // resolve (a wave, where nobody is holding a partner) falls back rather than refusing.
  const current = pairUp(findCouplePairs(board));
  const byIdentity = new Map<number, Board['dancers'][number][]>();
  for (const d of phys) {
    if (!isKnownCouple(d.couple)) {
      return 'Swing needs dancers with a known home couple: you swing your PARTNER, and this board carries no identity';
    }
    const list = byIdentity.get(d.couple) ?? [];
    list.push(d);
    byIdentity.set(d.couple, list);
  }
  // A pairing is usable when every pair is exactly two dancers, a man and a woman. The current
  // pairing is preferred and the home pairing is the fallback, BUT ONLY WHERE THE CURRENT PAIRING
  // ACTUALLY COVERS THE BOARD: `findCouplePairs` leaves a same-gender pair out entirely, so a square
  // of two-girl couples would otherwise report "no pairs" and slip through as legal. An incomplete
  // pairing is not a permissive answer, it is an unresolved one - fall back and let the home reading
  // report the real problem.
  const problems = (pairs: Iterable<Board['dancers'][number][]>): string[] => {
    const out: string[] = [];
    for (const list of pairs) {
      if (list.length !== 2) out.push(`a pair does not have exactly two dancers, so there is no partner to swing (${list.length})`);
      else if (list[0].gender === list[1].gender) out.push(`a pair is not a man and a woman, so there is no partner to swing (${list[0].gender}/${list[1].gender})`);
    }
    return out;
  };
  const currentCovered = [...current.values()].reduce((n, list) => n + list.length, 0);
  if (currentCovered === phys.length) {
    const currentProblems = problems(current.values());
    if (currentProblems.length === 0) return null;
    // The current pairing covers everyone and is still not swingable: say why, rather than falling
    // back to a home pairing that no longer describes who is standing together.
    return currentProblems[0];
  }
  const homeProblems = problems(byIdentity.values());
  return homeProblems.length === 0 ? null : homeProblems[0];
}

/**
 * The swing itself: the identity transform, because the authored motion returns every dancer to
 * its own spot and facing (see `swingProblem`).
 *
 * A FIRST ATTEMPT AT MODELLING THE CLOSURE IS REFUTED, and the measurement is worth keeping so it is
 * not retried: closing every co-oriented couple up to the standard two-unit separation about its own
 * midpoint — the one case CALLERLAB's silence still leaves unambiguous — measures **103 → 95
 * figures**, while the get-out corpus gains one line. The end pose is therefore NOT derivable from
 * the local pairing: moving the pairs changes the anchors `Promenade` reads, and eight figures that
 * used to reach a legal promenade no longer do. A correct model has to be pinned by the corpus (or
 * by the reference), not by a local closure rule; until then the identity stands, which is right
 * wherever the partners already stand together. */
function swingRule(board: Board): Board {
  return board;
}

/**
 * `Do Sa Do` / `Dosado` — a DERIVED call whose net motion is the IDENTITY, for the same reason and by
 * the same measurement as the swing above, except that here the authored tams AGREE.
 *
 * CALLERLAB: "Starting formation - Facing Dancers. Each dancer steps forward, around the other
 * dancer, and back to their own position, ending facing the other dancer." So every dancer finishes
 * on its own spot facing its own way — measured on the authored tams: from `Normal Lines` and from an
 * `Eight Chain Thru`, worst position change **0.000** and worst heading change **0.00 degrees**. The
 * derived call reproduces that exactly, and extends it to boards the authored setups do not cover,
 * which is the point: the census's three `Do Sa Do` stops are all "no setup in this call matches"
 * (`figm203`/`figm204` on the allemande pose and one unnamed board), not a wrong motion.
 *
 * THE PRECONDITION IS THE CALL'S OWN STARTING FORMATION: every dancer must have exactly one other
 * dancer directly in front of it, facing back. A board where someone faces nobody (a line facing out,
 * a column) is not a `Do Sa Do` board and is refused with that reason. `catalogueFallback` keeps the
 * authored tams in play beyond that — a board this rule declines cannot lose capability, and a board
 * it accepts gets the identical net motion the tams were measured to produce.
 *
 * Beats are the authored tams' own 4, so the timeline does not move.
 */
export const DOSADO_BEATS = 4;

/** How far a "facing dancer" may stand, and the bearing tolerance on "directly in front". The
 * corpus's `Do Sa Do` boards put the pairs 2 apart (waves, an Eight Chain Thru, the allemande pose)
 * and 4 apart (Normal Lines), so the limit has to clear 4 while still refusing a diagonal body. */
const DOSADO_MAX_FACING_DIST = 4.5;
const DOSADO_FACING_TOL = 0.2;

function facingPartnerOf(d: Board['dancers'][number], others: Board['dancers'][number][]) {
  let best: (typeof others)[number] | null = null;
  let bestDist = Infinity;
  for (const o of others) {
    if (o.id === d.id) continue;
    const dx = o.x - d.x;
    const dy = o.y - d.y;
    const dist = Math.hypot(dx, dy);
    if (dist > DOSADO_MAX_FACING_DIST) continue;
    const bearing = Math.atan2(-dx * Math.sin(d.heading) + dy * Math.cos(d.heading), dx * Math.cos(d.heading) + dy * Math.sin(d.heading));
    if (Math.abs(bearing) > DOSADO_FACING_TOL) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = o;
    }
  }
  return best;
}

function dosadoProblem(board: Board): string | null {
  const phys = board.dancers.filter((d) => !d.isGhost);
  if (phys.length === 0) return 'Do Sa Do needs dancers to do sa do';
  for (const d of phys) {
    const p = facingPartnerOf(d, phys);
    if (!p) return `Do Sa Do starts from Facing Dancers; #${d.id} has no dancer directly in front of it`;
    if (facingPartnerOf(p, phys)?.id !== d.id) {
      return `Do Sa Do starts from Facing Dancers; #${d.id} faces #${p.id} but #${p.id} does not face back`;
    }
  }
  return null;
}

/**
 * `Roll`: each dancer turns a quarter in the direction they were ALREADY turning, and a dancer
 * who was not turning does not move at all.
 *
 * This is the reference's rule verbatim (`taminations-flutter/lib/sequencer/calls/plus/roll.dart`):
 *
 *     final roll = ctx.roll(d);
 *     final move = {Rolling.LEFT: QuarterLeft, Rolling.RIGHT: QuarterRight, Rolling.NONE: Stand}[roll]!;
 *
 * which is also why the call's own help text says "The sequencer calculates Roll based on the
 * turning motion at the end of the previous call", and why `performCall` refuses when it does not
 * follow another call: without a previous turn there is no direction to continue.
 *
 * OUR SOURCE FOR THE DIRECTION is `SeqDancer.lastTurnDir`, the remembered turn direction the
 * engine records as it applies a call. Two honest limitations, both recorded rather than hidden:
 *
 *  - the reference reads the tangent at the END of the previous call's path (`bezier.dart`
 *    `rolling()`, which special-cases a 180-degree turn to the halfway tangent). We record the
 *    NET heading delta, which is a coarser quantity: for a call where dancers curve one way and
 *    finish facing another, the two can disagree. A net 180 degrees is the same number for left
 *    and right, so that case keeps the previous direction instead of inventing one;
 *  - `lastTurnDir` is only meaningful for the most recent turning call, which is the same
 *    scope the reference gives `ctx.roll`.
 *
 * It REFUSES when no dancer has a remembered direction, which is the reference's own refusal
 * ("and Roll" must follow another call) expressed over the board rather than over a call stack.
 */
function rollRule(board: Board): Board {
  return {
    dancers: board.dancers.map((d) => {
      if (d.isGhost || !d.lastTurnDir) return d;
      // A quarter turn in the remembered direction, with the position unchanged. `turn` is
      // "+ = left / CCW" (moves.ts), so left adds and right subtracts.
      const turn = d.lastTurnDir === 'left' ? Math.PI / 2 : -Math.PI / 2;
      return { ...d, heading: normAngle(d.heading + turn) };
    }),
  };
}

/** Why `Roll` cannot apply: nothing remembers a direction, so there is nothing to continue. */
function rollProblem(board: Board): string | null {
  const physical = board.dancers.filter((d) => !d.isGhost);
  if (physical.length === 0) return 'Roll needs dancers to roll';
  if (!physical.some((d) => d.lastTurnDir)) {
    return 'Roll continues the direction the dancers were already turning, and nothing has turned them yet';
  }
  return null;
}

export interface CodedMove {
  /** Canonical display name (the first alias). */
  name: string;
  /** Every authored alias that resolves to this move. */
  aliases: string[];
  /** Timeline length of the pivot, in beats. */
  beats: number;
  /** Whether the move applies to this board. Absent means always: a pure pivot
   * applies from any board, whereas a whole-set resolve has preconditions. Returns
   * null when it applies, otherwise the reason it does not. */
  precondition?: (board: Board) => string | null;
  /** Whole-board transform at completion. Only called when it applies. */
  apply(board: Board): Board;
  /** Transform for a DESIGNATED SUBSET, for a call whose non-designated dancers must also
   * move. `Run` and `Trade` are the cases: a Run's walker steps into the vacated place, and a
   * Trade's intervening dancers must be kept in place while the traders pass. The generic
   * "apply the whole-board transform, then keep only the designated dancers' results" that
   * `Sequencer.tryCodedMove` uses for the pivots cannot express either — it would throw away
   * the walker's motion and leave two dancers on one spot.
   *
   * A move that defines this is still refused for the BARE name (a `precondition` that
   * rejects it), because `Trade` and `Run` have no whole-set reading: they always name a
   * subset ("Boys Trade", "Centers Run"). */
  applyToSelection?(board: Board, selectedIds: number[]): { board: Board } | { reason: string };
  /** Whether the CATALOGUE may handle this call when the derived rule declines it.
   *
   * This exists for a call that is being ported IN PIECES, and it is a deliberate, temporary
   * property rather than a convenience: a coded move shadows the catalogue, so without it a
   * partially ported call REFUSES boards the catalogue handles correctly, and a refusal is not
   * free when the call is legal there. `Swing Thru` is the case — its wave and Facing Couples arms
   * are derived and validated, and a board of facing LINES still needs the catalogue until that
   * arm lands (CALLERLAB generalizes the Facing Couples Rule to "Facing Lines step to a
   * Right-Hand Tidal Wave").
   *
   * A move WITHOUT this flag refuses as before, which is the right default: `Swing Your Partner`
   * declining is a real answer about the call, not a missing arm. The gate for this is
   * `selection.mjs`, which lists exactly which formations still fall through, so removing an arm
   * from the list is a deliberate edit. */
  catalogueFallback?: boolean;
  /** A call that acts on each BOX of a named call's 4-dancer setup rather than on the whole board.
   *
   * `Sweep a Quarter` is the case: CALLERLAB's starting formation is "Facing Couples ONLY", so on an
   * 8-dancer board the call is danced independently by each facing-couple box, rotating each box a
   * quarter turn about its own centre. That is not "apply this call to that subset" and cannot be
   * expressed by `applyToSelection`, which is why the tiling is a separate idea.
   *
   * WHEN THIS IS SET, `precondition` and `apply` are evaluated on each BOX and not on the whole
   * board — the board-level precondition is never consulted, because a boxed call applies to any
   * board that decomposes. The decomposition comes from `CallApplicator.boxGroups`, i.e. from the
   * engine's own matcher, for the reason recorded there. */
  boxedBy?: string;
  /** A POSTCONDITION on the whole board after a BOXED call has run, for a failure only the whole
   * board can see — neighbouring boxes overlapping once each rotates about its own centre. See
   * `sweepCollision`. */
  collisionCheck?: (b: Board) => string | null;
  /** A move that WHEELS THE WHOLE SET around the ring (`Promenade` and its fractions). Such a move
   * must be ANIMATED as an arc about the set centre, not as a straight line - see
   * `SequenceAnalyzer.evaluateCodedAt`, where the linear form made every dancer cut through the
   * middle of the square. */
  ringMove?: boolean;
  /** A ring move whose travel is TO HOME rather than to the board its fraction names, so its arc
   * cannot be read off the start->end difference: `Promenade` / `Promenade Home`. See
   * `promenadeSweep`, which also carries CALLERLAB's "add a full Promenade" rule for a trip of a
   * quarter turn or less - the case that matters, because from home the trip is zero and the end
   * board is the start board. */
  ringHome?: boolean;
  /**
   * The INTERMEDIATE boards a multi-part coded move passes through, for the ANIMATION only.
   *
   * A call composed of parts has a NET position permutation that is an artefact of composing them,
   * and the animation can only route it well if it is given the parts. `Swing Thru` is the case that
   * forced this: its net on a wave is two 4-CYCLES, not swaps, so the exchange routing never fired and
   * two dancers walked the same segment in opposite directions (measured closest pair 0.000). Each
   * PART is a pair trade, which routes cleanly.
   *
   * Returns the boards after each part, ending with the move's own end board, or null when the move
   * does not apply. Returning null must leave the animation no worse than before.
   */
  legs?: (b: Board) => Board[] | null;
}

const DEFS: {
  aliases: string[];
  fn?: (b: Board) => Board;
  beats?: number;
  precondition?: (b: Board) => string | null;
  applyToSelection?: (b: Board, ids: number[]) => { board: Board } | { reason: string };
  catalogueFallback?: boolean;
  boxedBy?: string;
  collisionCheck?: (b: Board) => string | null;
  ringMove?: boolean;
  ringHome?: boolean;
  legs?: (b: Board) => Board[] | null;
}[] = [
  // `Join Hands` IS NOT A CALL WITH A BODY, and implementing it as one would be wrong. CALLERLAB
  // uses it only as a PROMPT inside command examples - "From a Squared Set: 'Join Hands, Circle
  // Left; Heads Up to the Middle and Back; Heads Square Thru 4.'" (Mainstream definitions, Squared
  // Set Convention) - where it tells the dancers to take the circle handhold that the NEXT call
  // (`Circle Left`) is about to use. It has no starting formation, no ending formation and no
  // timing, and it moves nobody. All8 nevertheless prints it as a call cell with its own
  // abbreviation (`JoinH`), which is why it arrived in the corpus as a call name at all, and it was
  // carried in `all8-notation.ts`'s KNOWN_CATALOGUE_GAPS as "absent from the catalogue entirely" -
  // a correct statement about the catalogue and a wrong conclusion about the work: the fix is a
  // NO-OP, not a new call.
  //
  // Measured: 2 figures (`figm197`, `figm224`), and `figm224`'s chain is CALLERLAB's own pattern
  // exactly (`... Star Thru | Join Hands | Circle Left | ...`). Zero beats, because it costs no
  // time - it is the prompt that precedes the call that does.
  //
  // The board is returned UNCHANGED (not cloned) on purpose: nothing reads it, and a clone would
  // hide the identity from the caller's own mutation checks.
  { aliases: ['Join Hands'], beats: 0, fn: (b) => b },
  { aliases: ['Face Right', 'Turn Right', 'Right Face'], fn: (b) => applyMoveToBoard(b, FaceRight) },
  { aliases: ['Face Left', 'Turn Left', 'Left Face'], fn: (b) => applyMoveToBoard(b, FaceLeft) },
  { aliases: ['Face Half', 'U-Turn Back', 'Face Back'], fn: (b) => applyMoveToBoard(b, FaceHalf) },
  { aliases: ['Face In', 'Turn In'], fn: (b) => applyFaceInOutToBoard(b, true) },
  { aliases: ['Face Out', 'Turn Out'], fn: (b) => applyFaceInOutToBoard(b, false) },
  // Promenade: the standard finish. Unlike the pivots above it is NOT always
  // legal, so it carries its precondition and reports the reason it fails.
  { aliases: PROMENADE_ALIASES, beats: PROMENADE_BEATS, precondition: promenadeProblem, fn: (b) => promenadeHome(b).board, ringMove: true, ringHome: true },
  // `Promenade 1/2` — the ring turned half way round instead of home (All8's `Pr1/2`). Only the half
  // is registered, because only the half has a witness: `All Promenade 1/2` is `figm86`'s first call
  // and the figure then runs end-to-end from the rotated square, while `Promenade 3/4` and
  // `Promenade Full` (which `all8-notation.ts` also decodes) are reached by no figure, bare. The same
  // rule serves all three — `promenadeFraction(board, fraction)` — so registering them is a one-line
  // change the day a witness appears, and not before.
  { aliases: ['Promenade 1/2'], beats: PROMENADE_BEATS / 2, precondition: promenadeProblem, fn: (b) => promenadeFraction(b, 0.5).board, ringMove: true },
  // Run and Trade: derived because Taminations implements them in code and marks every
  // authored `Run` tam (32) and bare `Trade` not-for-sequencer — see trade-run.ts for the rule
  // and for the measurement that settled the facing half of it. Both REFUSE without a
  // designation, which is correct rather than a placeholder: "Trade" and "Run" on their own
  // name no subset, so there is nothing to apply them to.
  {
    aliases: ['Run'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Run names a group to run ("Boys Run", "Centers Run"); it has no whole-set reading',
    applyToSelection: runRule,
  },
  // DIRECTION-SPECIFIED RUNS. All8 writes them `G-RunL` / `B-RunR` and the corpus uses them
  // (Run Left 4 lines, Run Right 3, both previously reported as "not legal for selected dancers").
  // They are the SAME derived Run with the side constrained, not a second choreography: runRule
  // already computes which side the dancer to be run around is on, so a direction selects one of
  // those sets and refuses when it is empty. That is the same footing as the separation fixes -
  // the constraint comes from geometry already in hand - which is why this is authored here
  // rather than inferred like a facing would have to be.
  {
    aliases: ['Run Left'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Run Left names a group to run ("Girls Run Left"); it has no whole-set reading',
    applyToSelection: (b, ids) => runRule(b, ids, 'left'),
  },
  {
    aliases: ['Run Right'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Run Right names a group to run ("Boys Run Right"); it has no whole-set reading',
    applyToSelection: (b, ids) => runRule(b, ids, 'right'),
  },
  //   `Trade` FROM A WAVE, with no designation, is NOT DERIVED - see the record below. All8 authors
  //   the bare `Trade` tam `from="Right-Hand Waves"` with FOUR paths, all `Swing Right`, so a whole-set
  //   reading looked as available as `Run`'s; but the only rule the engine has for pairing traders
  //   (`tradeRule`'s parity rule) applies it from 126 of 134 named formations once every dancer is
  //   designated, which is not a reading of the call. Left refusing, with the shape of a correct
  //   derivation recorded in PLAN.
  //   `Trade` WITH NO DESIGNATION IS *NOT* DERIVED, and the attempt is recorded rather than left as a
  //   mystery. The evidence looked sufficient - All8 authors the bare `Trade` tam `from="Right-Hand
  //   Waves"` with four `Swing Right` paths, and a bare `Trade` stops 22 modules of the `Zero Box`
  //   corpus - and it was not. Measured afterwards
  //   (`test/tools/trade-whole-set-revert-probe.mjs`): a whole-set reading built from `tradeRule` with
  //   every dancer designated APPLIES FROM 126 OF 134 NAMED FORMATIONS, including `Static Square`,
  //   because "every dancer has someone beside them" is true nearly everywhere. It also pairs dancers
  //   of DIFFERENT GENDERS 2 apart on a wave, where a wave trade pairs same-gender dancers across the
  //   wave. The corpus number improved (76 -> 83 modules) for the wrong reason: more calls applied.
  //
  //   The cheap fix - "every dancer has a partner beside them" - is what fails, and the right shape is
  //   recorded in PLAN so the next attempt starts from it rather than repeating this one.
  //   `test/tools/trade-whole-set-probe.mjs` and `trade-pairing-board-probe.mjs` hold the measurements.
  {
    aliases: ['Trade'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Trade names a group to trade ("Boys Trade", "Centers Trade"); it has no whole-set reading',
    applyToSelection: tradeRule,
  },
  // Fold and Cross Fold: derived for the same reason as Run and Trade - Taminations implements both
  // in code and marks the `Boys Fold`/`Girls Fold` tams `sequencer="no"`, and matching a
  // demonstration as a setup is designation-blind, so `Boys Fold` moved two girls and two boys. See
  // fold.ts for the rule, transcribed from `fold.dart`/`cross_fold.dart`, and for why the two calls
  // are the SAME rule with a different `d2`.
  //
  // Both REFUSE the bare name, which is correct rather than a placeholder: CALLERLAB's command
  // examples are all designated ("Boys Fold", "Ends Fold", "Leaders Fold") and `Everyone Fold` is
  // documented as a GIMMICK, so there is no whole-set reading of the name to fall back on.
  {
    aliases: ['Fold'],
    beats: FOLD_BEATS,
    precondition: () => 'Fold names a group to fold ("Boys Fold", "Ends Fold"); it has no whole-set reading',
    applyToSelection: (b, ids) => foldRule(b, ids, false),
  },
  {
    aliases: ['Cross Fold'],
    beats: CROSS_FOLD_BEATS,
    precondition: () => 'Cross Fold names a group to cross fold ("Girls Cross Fold", "Ends Cross Fold"); it has no whole-set reading',
    applyToSelection: (b, ids) => foldRule(b, ids, true),
  },
  // `Sweep a Quarter`: derived because the catalogue has no such call at all, and BOXED because
  // CALLERLAB's starting formation is "Facing Couples only" — each facing-couple box sweeps
  // independently. See sweep.ts for the definition, the per-box direction reading, and the two of
  // the eight corpus cases that have no direction to read.
  //
  // `boxedBy` names `Touch a Quarter` because that call's authored setups ARE two facing couples, at
  // three separations (3, 4 and 6), so the engine already trusts them as the box template. It is the
  // TEMPLATE only: nothing about `Touch a Quarter` is applied, and `boxGroups` reads the setup and
  // matches it — the motion comes from sweep.ts.
  {
    aliases: ['Sweep a Quarter', 'Sweep 1/4'],
    beats: SWEEP_BEATS,
    boxedBy: 'Touch a Quarter',
    precondition: sweepProblem,
    fn: sweepBox,
    collisionCheck: sweepCollision,
  },
  // Roll: derived because the engine has NO `Roll` of any kind - no title, no tam, not even in the
  // call index - while All8 writes it as a modifier on the preceding call (`--SqTh3 --PtTrd --&Roll`,
  // 30 published lines, the single largest token in the corpus). The reference implements it in
  // code for the same reason. It is registered under the bare name because All8's `&Roll` composes
  // with whatever came before rather than naming a group.
  {
    aliases: ['Roll'],
    beats: ROLL_BEATS,
    precondition: rollProblem,
    fn: rollRule,
  },
  // The Mainstream swing: derived because its authored motion is the identity transform, which
  // makes it formation-independent (see `swingProblem` for the measurement and the precondition).
  {
    aliases: ['Swing Your Partner'],
    beats: SWING_BEATS,
    precondition: swingProblem,
    fn: swingRule,
  },
  // `Do Sa Do`: derived for the same reason — the authored motion IS the identity (measured 0.000
  // position and 0.00 degrees of heading change) — so the call is formation-independent and the
  // authored setups were only ever limiting WHICH boards it could be reached from. See
  // `dosadoProblem`.
  {
    aliases: ['Do Sa Do', 'Dosado'],
    beats: DOSADO_BEATS,
    precondition: dosadoProblem,
    fn: (b) => b,
    catalogueFallback: true,
  },
  // `Swing Thru`: derived because the reference never matches it positionally - it asks relationship
  // questions and applies `Trade` twice - and CALLERLAB's definition says the same ("those who can
  // turn 1/2 by the right; then ... by the left", from a wave, with the Facing Couples Rule
  // generalising it to facing couples). See swing-thru.ts for the two validated arms.
  {
    aliases: ['Swing Thru'],
    beats: SWING_THRU_BEATS,
    precondition: (b) => swingThru(b, false).reason ?? null,
    fn: (b) => swingThru(b, false).board,
    legs: (b) => swingThruLegs(b, false),
    // PARTIALLY PORTED: the wave and Facing Couples arms are derived and validated, but a board of
    // facing LINES still needs the catalogue (the arm for it is the next step). Measured before this
    // flag existed: without it the derived call refuses those boards and costs 1 figure and 3
    // published get-out lines, which is not an honest gap - the call is legal there.
    catalogueFallback: true,
  },
  {
    aliases: ['Left Swing Thru'],
    beats: SWING_THRU_BEATS,
    precondition: (b) => swingThru(b, true).reason ?? null,
    fn: (b) => swingThru(b, true).board,
    legs: (b) => swingThruLegs(b, true),
    catalogueFallback: true,
  },
  // `Fan the Top`: derived because the catalogue's tams are DEMONSTRATIONS (the reference implements
  // the call in code as a SplitCall) and reading them as setups is MEASURED wrong from BOTH canonical
  // boards -- from `Ocean Waves` it collapses two waves into one line at half spacing, and from
  // `Tidal Wave` it produces Ocean Waves, when the call must stay in its own formation. See
  // fan-the-top.ts for CALLERLAB's definition, the derivation, and the two boards it was validated on.
  //
  // PARTIALLY PORTED, like the Swing Thrus: the derived rule covers boards that divide into waves of
  // four joined by hand, which is the case the tams get wrong. Everything the catalogue reaches and
  // this does not -- diamonds, facing couples, Eight Chain Thru, lines -- still goes to the catalogue,
  // and that is what `catalogueFallback` means here: the derived rule never REPLACES a board the
  // catalogue handles, it only replaces the boards the catalogue handles wrongly.
  {
    aliases: ['Fan the Top'],
    beats: FAN_THE_TOP_BEATS,
    precondition: fanTheTopProblem,
    fn: (b) => fanTheTop(b).board,
    catalogueFallback: true,
  },
];

export const CODED_MOVES: CodedMove[] = DEFS.map((d) => ({
  name: d.aliases[0],
  aliases: d.aliases,
  beats: d.beats ?? CODED_MOVE_BEATS,
  ...(d.precondition ? { precondition: d.precondition } : {}),
  ...(d.fn ? { apply: d.fn } : {}),
  ...(d.applyToSelection ? { applyToSelection: d.applyToSelection } : {}),
  ...(d.catalogueFallback ? { catalogueFallback: true } : {}),
  ...(d.boxedBy ? { boxedBy: d.boxedBy } : {}),
  ...(d.collisionCheck ? { collisionCheck: d.collisionCheck } : {}),
  ...(d.ringMove ? { ringMove: true } : {}),
  ...(d.ringHome ? { ringHome: true } : {}),
  ...(d.legs ? { legs: d.legs } : {}),
})) as CodedMove[];

/** Canonical display names of the coded moves, in registration order. */
export const CODED_MOVE_NAMES: string[] = CODED_MOVES.map((m) => m.name);

const byAlias = new Map<string, CodedMove>();
for (const m of CODED_MOVES) {
  for (const a of m.aliases) byAlias.set(a.trim().toLowerCase(), m);
}

/** The coded move a call name refers to (by any alias), or undefined when the
 * name is not a coded move. */
export function findCodedMove(name: string): CodedMove | undefined {
  return byAlias.get(name.trim().toLowerCase());
}

/** Whether a coded move applies to `board` (always true for a pure pivot). */
export function codedMoveApplies(move: CodedMove, board: Board): boolean {
  return move.precondition ? move.precondition(board) === null : true;
}

/**
 * Apply the coded move named `name` to `board`: its result when it applies, the
 * board unchanged plus the reason when it does not, and null when `name` is not a
 * coded move at all (so the catalogue must handle it).
 *
 * The Sequencer (which layers dancer-selection handling on top) and the getout/fixIt
 * search both go through this, so a call cannot be legal in one and unknown in the
 * other - which is what makes a geometry-derived resolve usable as a search edge.
 */
export function applyCodedMove(board: Board, name: string): { board: Board; legal: boolean; reason?: string } | null {
  const move = findCodedMove(name);
  if (!move) return null;
  const problem = move.precondition?.(board) ?? null;
  return problem ? { board, legal: false, reason: problem } : { board: move.apply(board), legal: true };
}

