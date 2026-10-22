// WHICH SOURCE SERVES ONE STEP: the authored tam when it agrees with the derived rule, the rule otherwise.
//
// THE QUESTION, REPORTED FROM USE. Standing in an `Eight Chain Thru`, `All 8` + `Swing Thru` is added as a
// `derived+catalogue` step and "the dancers spin to the initial wave instead of a straight walk as seen in the
// call editor". Both halves are true and they have one cause: the coded registry is consulted BEFORE the
// catalogue (`92a7b29`), and `catalogueFallback` only lets the authored tam serve a board the RULE REFUSES
// (`3932b72`). From an Eight Chain Thru the rule reads the board, so the tam is never asked - and the rule's
// animation is the two Trades, each drawn as a rigid half-turn about the pair's grip midpoint
// (`3a9b1b1`), which is the spin. The board the two reach is the same: MEASURED, worst dancer difference
// **0.000 units**; the paths differ by up to **2.174 units**. The derivation's own validation compared BOARDS
// ("Eight Chain Thru / both calls MATCH the catalogue, 8/8"), which is why nobody saw it.
//
// WHY THE CATALOGUE SHOULD WIN WHERE IT CAN. The authored paths are the reference choreography: a caller
// dances the call, not a formula that lands the same spots. The derived rule exists to EXTEND REACH - it was
// written for the boards no tam covers - so where a tam does cover the board it is the better answer.
//
// AND WHY THAT CANNOT BE A BLANKET RULE. MEASURED over the corpus: 47 of 5424 tams would switch, across 11
// call titles, and only **34 of those 47 agree with the rule on the end board** (1e-6). The 13 that do not
// include ALL FOUR `Fan the Top` authorings - 2.0 to 6.8 units and 180 degrees apart - which is exactly the
// case the derivation was shipped to FIX (`6afbc16`, "fixing a measured wave defect"). Preferring the tam
// there would reinstate the defect the rule removed. Two `Swing Thru` authorings disagreed the same way (the
// `Tidal Wave RH/LH BGGB` pair, 1.0 and 3.0 units) and were recorded here as an open adjudication.
//
// THAT ADJUDICATION IS CLOSED, AND THE RULE WAS THE WRONG SIDE. CALLERLAB's Tidal Wave note is explicit -
// "no dancers cross the center of the Tidal Wave" - and the project owner ruled "The tam is the correct
// version". The rule's fault was mechanical: it read each part off the board as it stood, so after part 1 the
// inner dancers of the two halves stood 1.0 apart facing each other and part 2 paired them ACROSS the seam.
// `swing-thru.ts`'s `waveGroups` now keeps both trades inside the halves, the rule reproduces that tam to
// 0.000 units over 8 dancers, and the two authorings are no longer dissenters: the gate serves them from the
// catalogue, which is what `engine/test/swing-thru.mjs` measures (it also proves the 0.000 against a revert).
// The corpus-wide disagreement counts above were measured before this and were NOT re-swept with it.
//
// SO THE SWITCH IS GATED ON AGREEMENT: the authored paths are used when the two compute the SAME BOARD, and
// the rule keeps every case where they disagree. The gate is a board comparison, which is the same observable
// the derivation's own check used - what makes it honest is that it is now asked per board and its ANSWER
// decides the source, rather than being assumed for the whole call.

import { applyCodedMove, findCodedMove } from './coded-moves.js';
import type { Board } from './types.js';

/** Same eight (or n) dancers, by ID, on position and heading. */
export function sameBoard(a: Board, b: Board, tol = 1e-6): boolean {
  if (a.dancers.length !== b.dancers.length) return false;
  const byId = new Map(b.dancers.map((d) => [d.id, d]));
  for (const d of a.dancers) {
    const o = byId.get(d.id);
    if (!o) return false;
    if (Math.hypot(d.x - o.x, d.y - o.y) > tol) return false;
    if (Math.abs(normalise(d.heading - o.heading)) > tol) return false;
  }
  return true;
}

/**
 * Whether the AUTHORED tam's result wins: both sources reached the same board, so the only difference is the
 * path (and the beats, which are the tam's own).
 *
 * A null on either side is a NO, and each means something different: no authored variant applies (nothing to
 * prefer), or the rule refuses this board (the catalogue already serves it through `catalogueFallback`).
 */
export function authoredTamWins(coded: Board | null, authored: Board | null, tol = 1e-6): boolean {
  if (!coded || !authored) return false;
  return sameBoard(coded, authored, tol);
}

/**
 * THE DECISION ITSELF, with the catalogue lookup injected so the two callers that need it - the Sequencer
 * (apply) and the SequenceAnalyzer (beats and the walk's animation source) - ask ONE rule rather than each
 * keeping a copy of it.
 *
 * `appliedEnd` is the catalogue's end board for this call on this board, or null when no variant applies.
 */
export function authoredStepWins(
  board: Board,
  call: string,
  appliedEnd: () => Board | null,
  tol = 1e-6,
): boolean {
  if (!findCodedMove(call)) return false;
  const derived = applyCodedMove(board, call);
  if (!derived || !derived.legal) return false;
  return authoredTamWins(derived.board, appliedEnd(), tol);
}

function normalise(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
