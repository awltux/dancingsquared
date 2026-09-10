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

  /** Calls legal from `board` for DISPLAY/enumeration. Uses the TIGHT interactive
   * apply — the same path the UI runs — so it only lists calls that genuinely
   * apply and end in a known formation. */
  private legalWithResults(board: Board): { name: string; res: { board: Board; legal: boolean } }[] {
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    for (const name of this.library.callNames()) {
      const res = this.applicator.applyToBoard(board, name);
      if (res.legal && this.matcher.knownFormation(res.board) !== null) out.push({ name, res });
    }
    for (const mname of this.library.moduleNames()) {
      const res = this.applicator.applyToBoard(board, mname);
      if (res.legal && this.matcher.knownFormation(res.board) !== null) out.push({ name: mname, res });
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
