// AN ARRANGEMENT'S IDENTITY: THE SHAPE **AND** WHERE THE GENDERS STAND.
//
// WHY THIS EXISTS. A formation id deliberately ignores gender - "Static Square is one name whatever gender
// stands on which spot" - and that is right for a SHAPE. It is wrong for every question a gender-specific call
// asks, and those questions are not a corner of the corpus: MEASURED over the 1,771 ms+plus authoring start
// boards, **157 tams are `sequencer="gender-specific"` (8.9%)**, and **18 `(title, shape)` groups carry more
// than one gender layout** - `Boys Run`, `Girls Run`, `Slide Thru`, `Star Thru` - so the formation id calls two
// different setups one thing.
//
// THE ARGUMENT THAT ACTUALLY SIZES IT IS ABOUT ENDS, NOT STARTS. MEASURED over the same 1,771 tams: **1,488
// end in a different arrangement from the one they started in, and 1,374 of those are NOT gender-specific**;
// 1,373 change shape. So **115 calls return to the same formation in a different gender arrangement**. A
// formation-id-only state model calls those unchanged, and the next gender-specific call is then applied to a
// board it does not fit.
//
// WHAT IT IS. The formation canonicalisation with one extra symbol per dancer - `B` boy, `g` girl, `p` phantom -
// appended to that dancer's record, digested to the same eight-character payload every scheme in this tree uses
// (`id-code.ts` owns the width and the hash). Rotation, translation, array order and the dancer count all drop
// out exactly as they do for the formation id, and for the same reason: one mechanism, two schemes.
//
// WHAT IT MUST NOT DO: NORMALISE GENDER AWAY. `Facing Couples` and `Sashayed Couples` are ONE shape and TWO
// arrangements, and that pair is the negative control in `test/arrangement-id.mjs` - an id invariant under a
// global gender swap collapses exactly the distinction a gender-specific call depends on. Nor may it sort the
// genders independently of their positions: that collapses every permutation of the same gender multiset.
//
// IT IS NOT THE FASR ARRANGEMENT NUMBER. `arrangementFor` reads a PUBLISHED per-formation table and answers
// All8's 0-5 for the seven formations transcribed so far; the number is meaningless without its formation, and
// the tables are an oracle, not a key. This id is computed from the board alone and works on any board,
// including the embedded setups no formation file names. The two are joined where the oracle is useful - the
// number stays a display and a get-out index beside the id, never inside it.
//
// WHY `A1-` AND WHY IT IS NOT PART OF THE VARIANT ID. A call variant is (level, call title, start formation)
// and is gender-free - the manual does not list "Swing, boys on the left" as a separate call. Arrangement is a
// property of a BOARD, so it qualifies the binding between a variant and an authoring, not the variant's name.
// The version marker follows `formation-id.ts`'s rule: a change to the quantisation, the canonicalisation or the
// encoding must produce a string that cannot be mistaken for an old one.

import type { Board } from './types.js';
import type { Gender } from '../types.js';
import { canonicalOf } from './formation-id.js';
import { encodeId, fnv1a64, isIdOf, ID_SCHEMES } from './id-code.js';

/** The scheme marker every arrangement id starts with. `id-code.ts` owns the table; a change to the
 *  canonicalisation or the encoding bumps it there. */
export const ARRANGEMENT_ID_VERSION = ID_SCHEMES.arrangement;

/**
 * The symbol a dancer contributes to the key. Upper `B` and lower `g`/`p` is All8's own convention in the
 * arrangement tables, so a canonical string reads the way the oracle prints it.
 */
const GENDER_SYMBOL: Record<Gender, string> = { boy: 'B', girl: 'g', phantom: 'p' };

/**
 * The canonical serialisation the arrangement digest is taken over: the formation's, with each dancer carrying
 * its gender symbol. Exported for the same reason `formationCanonical` is - so the harness pins the thing the
 * id is a function of, and so "the arrangement with gender stripped IS the formation" can be checked rather
 * than asserted.
 */
export function arrangementCanonical(board: Board): string {
  return canonicalOf(board, (d) => GENDER_SYMBOL[d.gender] ?? '?');
}

/**
 * The board's arrangement id: the scheme's prefix and the tree's one eight-character payload.
 *
 * A dancer whose gender is not one of the union's three gets `?`, which is a value no real arrangement can
 * produce, so an unknown gender is visible in the key rather than silently equal to a boy.
 */
export function arrangementId(board: Board): string {
  return encodeId('arrangement', fnv1a64(arrangementCanonical(board)));
}

/** Whether a string is an arrangement id this module produced. Case-insensitive, like `isFormationId`. */
export function isArrangementId(s: string): boolean {
  return isIdOf('arrangement', s);
}
