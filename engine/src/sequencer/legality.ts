// LegalityChecker: enumerates which calls are legal from a board (for the picker
// and for the getout/getin search). Depends on the CallApplicator (to apply) and
// the FormationMatcher (to find variants and check the result is a known
// formation), and reads the shared config for tolerances.

import { CallApplicator } from './applicator.js';
import { FormationMatcher } from './matcher.js';
import { CallLibrary } from './library.js';
import { SequencerConfig } from './config.js';
import { DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX } from './constants.js';
import { CODED_MOVES, applyCodedMove } from './coded-moves.js';
import { matchFormations } from './match.js';
import type { Board } from './types.js';

export class LegalityChecker {
  constructor(
    private readonly library: CallLibrary,
    private readonly matcher: FormationMatcher,
    private readonly applicator: CallApplicator,
    private readonly config: SequencerConfig,
  ) {}

  /** Calls legal from a given board (does not mutate state). A call counts as a
   * valid *next* call only if it both (a) starts in a setup that matches the
   * current board AND (b) ends in a known formation. */
  legalCalls(board: Board): string[] {
    return this.legalWithResults(board).map((x) => x.name);
  }

  /**
   * THE MODULES THAT BEGIN HERE, which is the same question a call's start answers.
   *
   * MEASURED WHY IT IS A GATE. A module is a sequence, and 168 of the 294 corpus modules are written for a Zero Line or
   * a Zero Box; the picker offered every one of them from every board because all it did was try the steps. From home,
   * 126 of the 294 applied - and the ones that applied often did so only for their first call or two, so the caller
   * found out the board was wrong by a refusal in the middle of the module (`ceder-7046` reaches its fourth call and
   * then `Right and Left Grand` refuses from the `T-Bone RDRD` a square set produces).
   *
   * A CALL IS MATCHED THIS WAY ALREADY - `findMatchingVariant` tests its authored start against the board within the
   * interactive tolerance - so a module with a declared start is matched by the same `matchFormations` at the same
   * tolerance. The gate is on the START BOARD only because the END needs no gate: applying the steps THAT FOLLOW from a
   * module is what `legalWithResults` already enumerates from the board the module leaves behind.
   *
   * A MODULE THAT DECLARED NO START IS NOT GATED. `moduleStart` returning null is "no declaration", not "home": those
   * modules keep the pre-existing behaviour (their own first step decides), which is what a caller who saved one before
   * the field existed gets.
   */
  private moduleStartsHere(name: string, board: Board): boolean {
    const start = this.library.moduleStart(name);
    if (!start || start.length === 0) return true;
    const src = this.matcher.matchables(board);
    // A DIFFERENT DANCER COUNT CANNOT BE THE SAME SETUP, and asking `matchFormations` would spend the scan to say so.
    if (src.length !== start.length) return false;
    const tol = DEFAULT_MATCH_MAX + this.config.matchMargin;
    return matchFormations(src, start, tol) !== null;
  }

  /**
   * Calls legal from `board` for DISPLAY/enumeration. Uses the TIGHT interactive apply — the same
   * path the UI runs — so it only lists calls that genuinely apply.
   *
   * AN UNNAMED END IS AN END. This used to also require `knownFormation(result) !== null`, which
   * conflated LEGALITY with CONTINUITY: a call that applies and leaves a board the namer cannot
   * identify was dropped from the list entirely, as though it had never been performable. Measured
   * over the named FSM states, that dropped 2169 of 4416 legal applications (49%), including 1048
   * where a sub-eight variant covered ALL EIGHT dancers — the call was performed by everyone and the
   * engine recorded nothing at all.
   *
   * The two questions are now separate, and the separation is what makes the namer's refusal safe:
   * `knownFormation` may refuse a board it cannot identify (a tied best match, or one with a dancer
   * outside the effective allowance), and the application stays HERE, legal — its end simply has no
   * name, which the FSM records as a null end rather than losing the edge. See `knownFormation` for
   * the measurement behind the refusal.
   */
  private legalWithResults(board: Board): { name: string; res: { board: Board; legal: boolean } }[] {
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    for (const name of this.library.callNames()) {
      const res = this.applicator.applyToBoard(board, name);
      if (res.legal) out.push({ name, res });
    }
    for (const mname of this.library.moduleNames()) {
      if (!this.moduleStartsHere(mname, board)) continue;
      const res = this.applicator.applyToBoard(board, mname);
      if (res.legal) out.push({ name: mname, res });
    }
    return out;
  }

  /** Candidates for the getout/getin SEARCH, reconciled with the matrix model.
   * Each candidate must match under the tight interactive tolerance so force-fits
   * are pruned at search time rather than surfacing as a getout that fails on
   * apply. Chaining still uses the pure-relative search apply. */
  searchLegalCalls(board: Board): { name: string; res: { board: Board; legal: boolean } }[] {
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    const tight = DEFAULT_MATCH_MAX + this.config.matchMargin;
    for (const name of this.library.callNames()) {
      if (!this.matcher.findMatchingVariant(board, name, tight)) continue;
      const res = this.applicator.applySearch(board, name);
      if (res.legal && this.matcher.knownFormation(res.board) !== null) out.push({ name, res });
    }
    for (const mname of this.library.moduleNames()) {
      // THE SAME START GATE AS THE INTERACTIVE LIST: a search that could reach a module from a board it was not written
      // for would return a getout the picker refuses to play.
      if (!this.moduleStartsHere(mname, board)) continue;
      const tightApply = this.applicator.applyToBoard(board, mname);
      if (!tightApply.legal || this.matcher.knownFormation(tightApply.board) === null) continue;
      const res = this.applicator.applySearch(board, mname);
      if (res.legal && this.matcher.knownFormation(res.board) !== null) out.push({ name: mname, res });
    }
    // Geometry-derived calls are callable, so the search must be able to use them —
    // otherwise a get-out whose last call is `Promenade` is unreachable by search
    // even though the Sequencer can play it.
    //
    // Only the ones that carry a PRECONDITION are added. A coded pivot (`Face Left`,
    // `U-Turn Back`, ...) is legal from every board and moves nobody, so its result
    // has the same position signature as the board it came from: the search's
    // seen-set prunes it immediately, and it can never reach home. Adding it would be
    // pure cost - the honest place for a pivot in a get-out is the caller's hands,
    // not the search's edge set (see the open item on selecting pivots in search).
    for (const move of CODED_MOVES) {
      if (!move.precondition) continue;
      const res = applyCodedMove(board, move.name);
      if (res?.legal && this.matcher.knownFormation(res.board) !== null) out.push({ name: move.name, res });
    }
    return out;
  }

  /** Calls applicable to `board` in PARALLEL across disjoint subsets — i.e. calls
   * whose whole-board match fails but which can be applied to two or more
   * separate copies of their start setup at once. */
  parallelLegalCalls(board: Board): { name: string; board: Board }[] {
    const out: { name: string; board: Board }[] = [];
    const tol = SEARCH_MATCH_MAX + this.config.matchMargin;
    for (const name of this.library.callNames()) {
      if (this.matcher.findMatchingVariant(board, name, tol)) continue;
      const res = this.applicator.parallelApply(board, name, false, tol);
      if (res && res.legal) out.push({ name, board: res.board });
    }
    return out;
  }
}
