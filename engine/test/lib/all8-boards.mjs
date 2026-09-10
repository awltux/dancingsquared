// Building the start board for each of All8's published alignments.
//
// The corpus indexes its get-outs by ALIGNMENT, not by formation, so every harness
// that RUNS them starts the same way: take the engine template for the formation
// letter, and lay All8's own diagram (spot, facing and couple layout) onto it at the
// engine's metric. That is step 3's `boardFromDiagram`, and it is the only supported
// way to get a start board - so the two harnesses that need one share this helper
// rather than each re-deriving it (a second copy is how the two would drift).
//
// Run: used by test/getout-behaviour.mjs and test/promenade.mjs.

import { parseAlignmentId, boardFromDiagram, FORMATIONS_FOR_LETTER } from '../../dist/index.js';

/** The engine template board for an All8 formation letter (the first name that
 * exists), or null when the letter has no template. */
export function templateForLetter(seq, letter) {
  for (const name of FORMATIONS_FOR_LETTER[letter] ?? []) {
    const board = seq.boardForFormation(name);
    if (board) return board;
  }
  return null;
}

/**
 * The start board for one corpus alignment, built from All8's own diagram.
 * Returns `{ board }` on success, or `{ reason }` when the alignment has no FASR id,
 * no template, or a diagram that cannot be laid onto it.
 */
export function startBoardFor(seq, alignment) {
  const spec = parseAlignmentId(alignment.id);
  if (!spec) return { reason: `${alignment.id} is not an FASR id` };
  const template = templateForLetter(seq, spec.letter);
  if (!template) return { reason: `no engine template for [${spec.letter}]` };
  const built = boardFromDiagram(template, spec.letter, spec.arrangement, alignment.diagram);
  if (!built.board) return { reason: built.reason };
  return { board: built.board, spec };
}
