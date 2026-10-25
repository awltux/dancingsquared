// A SETUP'S IDENTITY: THE ARRANGEMENT **AND** THE ORDER THE CALL LISTS ITS DANCERS IN - AT ANY SIZE.
//
// WHAT THIS ADDS TO ITS NEIGHBOURS. A formation id drops gender, position, rotation AND array order. An arrangement
// id puts the genders back on their spots and still drops the order, deliberately (`test/arrangement-id.mjs` pins
// that a reversed array keeps the `aid`). Neither says WHICH TWO DANCERS ARE COUPLE 1, and that order is
// load-bearing in two places the tree already depends on:
//
//   * `convert.ts` pairs the authored `<path>` list with the dancers BY INDEX, and replays ONE path for a pair -
//     `path = resolvedPaths[Math.floor(i / 2)]` - so the array order decides which dancer dances which path and
//     which pairs share one;
//   * a board the engine cannot stamp is drawn a colour per INDEX PAIR (`displayCouple`, in `packages/stage`), and
//     the zero-setup convention is "indices 0,1 are couple 1, 2,3 couple 2, ...".
//
// So a setup is (arrangement, index -> spot order), and two calls at two levels with the same starting arrangement
// and order share one setup id. It is NOT All8's FASR `FormationSetup`/`setupForFormation` (`alignment.ts`), NOT
// the corpus's authored-setup identity `variantIdentity` (`library.ts`, which also holds the paths, the title and
// the `from`/`formation` names), and NOT a call variant (`V1-`).
//
// ANY SIZE, AND PHANTOMS ARE IGNORED. The first version of this scheme refused anything that was not EIGHT physical
// dancers, because a call variant and a sequence start from a whole eight-dancer board. That guard is gone: a
// formation DEFINITION writes whatever size it writes - two, three, four, six or eight - and the corpus tags every
// definition with the setup id it has, so the generator must name the size it is given. The count is already in the
// key (`canonicalOf`'s `${n}|` prefix, with the dancers re-indexed 0..n-1), so a four-dancer setup can never
// collide with an eight-dancer one, and the eight-dancer rule now lives where it belongs: as a rule about what a
// CALL or a SEQUENCE acts on, not as a refusal here. `isPhysicalDancer` is unchanged - not a ghost (`isGhost`) and
// not `gender: 'phantom'` - so a phantom's position in the array changes neither the numbering nor the geometry,
// and the only refusal left is a board with NO physical dancers (an id over nothing names nothing). That still
// DIVERGES from the two schemes beside it on purpose: `formation-id.ts` keeps ghosts in the shape ("GHOSTS ARE
// PART OF THE SHAPE" - a phantom occupies a spot the dancers are avoiding) and `arrangement-id.ts` gives them the
// symbol `p`; a setup is about where the people stand and how they are numbered, and a phantom is the scaffolding
// the engine surrounds them with (`bodies.ts`: it "does not occupy collision space"). NO DEFINITION CARRIES ONE
// TODAY, MEASURED: `git grep 'gender="phantom"' assets/` finds none, so the rule costs the corpus nothing.
//
// THE CANONICALISATION is the arrangement's, then `#`, then the SAME canonicaliser with the array index as the
// per-dancer extra symbol:
//
//   `${arrangementCanonical(physical)}#${canonicalOf(physical, (_d, i) => String(i))}`
//
// WHY THE INDEX AND NOT A RANK SEQUENCE. A rank (each dancer's place among the sorted spots) carries the same
// information, but it needs a TOTAL ORDER over the spots - and two dancers that quantise onto one spot, facing and
// gender have no defined rank, so the id would lean on an invented tie-break. The index is already a total order.
// The price is that two co-located, same-gender dancers SWAPPED are not distinguished (no scheme here reads dancer
// `id`), and the sort's tie-break among them is the index itself, so the four turns' keys differ unless every
// record is rotation-invariant. No second tie-break is needed on top of `canonicalOf`'s "first minimum".
//
// WHAT IT IS INVARIANT TO, and what it must not be. Rotation and translation drop out exactly as they do for the
// other two schemes (the four candidate keys are a cyclic permutation of the same set, so a rotated input has the
// same minimum), which is what lets a squared set and its quarter turn be one setup. The ARRAY ORDER is the
// content and must change it. A REFLECTION must change it - the chirality rule `formation-id.ts` states - and so
// must a gender relabelling, which arrives through the arrangement half.
//
// HALF SETS. The corpus writes half a formation and `reconstituteWholeSet` supplies the other half, in the same
// order (written dancers, then their 180-degree antipodes). The input here is a COMPLETE board - a four-dancer
// board can legitimately be whole (a two-couple set), so no size heuristic can tell the two apart - and the
// completion is the caller's: `test/setup-id.mjs` pins that a half and its COMPLEMENTARY half (the whole set turned
// 180 degrees) mint one id, and `scripts/tag-formations.mjs` tags a definition from its completed geometry, exactly
// as it does for `fid` and `aid`.
//
// WHAT IT DOES NOT DO: it does not enumerate the finite set of VALID setups the symmetry and partner rules permit.
// It names whatever order it is given, and the count of valid setups is a separate question with its own
// measurement.
//
// WHY `S1-` AND EIGHT CHARACTERS. Eight is the tree's one payload width (`id-code.ts` owns it), and the version
// marker follows the family's rule: a change to the canonicalisation or the encoding must produce a string that
// cannot be mistaken for an old one. The input string is the arrangement CANONICALISATION, not its rendered `A1-`
// id, so a future encoding bump does not cascade into setup ids.
//
// POPULATION AND COST, MEASURED by `test/identity-census.mjs` over ms+plus and pinned there, in the commit that
// measures them, because they move with the corpus: **250 distinct setups over 1,776 boards** - every board the
// corpus builds, 1,769 authoring starts plus the 7 generated instances, with 0 refused - over **242 distinct
// arrangements, 8 of which carry more than one setup**. The birthday risk over 250 ids in a 36^8 =
// 2,821,109,907,456 space is 250^2 / (2 * 36^8) = 1.1e-8. The cost of canonicalising twice, over the same 200-board
// sample x10: `arrangementId` 32.4 us/board and `setupId` 62.2 us/board - a second canonicalisation, paid when an
// id is MINTED; no hot path calls it. THE TAGGED CORPUS is a larger sample than that census and is pinned where the
// tags live: 292 named definitions + 636 inline blocks mint **640 distinct setups**, of which **288 definitions are
// duplicates** (the same stored `sid`), recorded in `DuplicateFormations.md` by `scripts/tag-formations.mjs`.

import type { Board, SeqDancer } from './types.js';
import type { Gender } from '../types.js';
import { arrangementCanonical } from './arrangement-id.js';
import { canonicalOf } from './formation-id.js';
import { encodeId, fnv1a64, isIdOf, ID_SCHEMES } from './id-code.js';

/** The scheme marker every setup id starts with. `id-code.ts` owns the table; a change to the canonicalisation
 *  or the encoding bumps it there. */
export const SETUP_ID_VERSION = ID_SCHEMES.setup;

/**
 * Whether a board's entry is one of the people the setup is about: not a ghost, and not a dancer whose gender is
 * `phantom`. The one rule, shared by the id and by every census that counts the population.
 */
export function isPhysicalDancer(d: { readonly isGhost?: boolean; readonly gender?: Gender }): boolean {
  return !d.isGhost && d.gender !== 'phantom';
}

/** The physical dancers, in board order: what the canonicalisation is taken over. */
function physical(board: Board): SeqDancer[] {
  return board.dancers.filter(isPhysicalDancer);
}

/**
 * THE SETUP'S CANONICAL SERIALISATION, or `null` when the board has NO physical dancers.
 *
 * A REFUSAL IS A VALUE, like `recognize` and `setupForFormation`: a corpus walk skips the row and reports the
 * count. An EMPTY physical set is the only thing refused - see the header for why the eight-dancer guard this
 * function used to carry is gone.
 */
export function setupCanonical(board: Board): string | null {
  const dancers = physical(board);
  if (dancers.length === 0) return null;
  const placed: Board = { ...board, dancers };
  return `${arrangementCanonical(placed)}#${canonicalOf(placed, (_d, index) => String(index))}`;
}

/**
 * The board's setup id: the scheme's prefix and the tree's one eight-character payload, or `null` when the board
 * has no physical dancers.
 */
export function setupId(board: Board): string | null {
  const canonical = setupCanonical(board);
  return canonical === null ? null : encodeId('setup', fnv1a64(canonical));
}

/** Whether a string is a setup id this module produced. Case-insensitive, like its siblings. */
export function isSetupId(s: string): boolean {
  return isIdOf('setup', s);
}
