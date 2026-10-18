// THE SETUPS WHOSE DANCER ORDER IS A SQUARE-SET ORDER, and so the only ones drawn a colour per pair.
//
// WHY A LIST AND NOT A RULE. A board is coloured by home couple, and home couple is data: `assignHomeIdentity`
// can only name a board that IS a squared set up to a rotation/reflection (MEASURED: **6 of the 291** formations
// in `assets/formations.xml`), so everything else - a Zero Line, a Zero Box, a column, a line of 6, a circle -
// comes back `UNKNOWN_COUPLE` and is drawn one grey. Drawing those by their order instead is only truthful where
// the ORDER really is square-set order - `[0,1]` the south couple, `[2,3]` the east - and whether a given
// formation is authored that way is NOT readable from its geometry: the same eight spots are four couplings
// under four different identities, which is the canonical-identity problem `PLAN.md` §3 records as unsolved. So
// the answer is a decision, written down: this array IS the decision, one formation name per line, in the
// corpus's own spelling.
//
// HOW A NAME GETS HERE, and it is the opposite of guessing. Reordering a formation's dancer index is done by
// `.dsh/skills/formation-reorder` (driver `scripts/reorder-formation.mjs`), which refuses to write anything
// unless every call that names the formation reproduces its geometry, and `engine/test/formation-order.mjs` then
// pins the new order, so "the pairs in this order are the couples" is a measurement with a gate behind it before
// it is a name in this list. `Circle` is the worked example: its four written dancers are the south pair then
// the east pair, and the reader's 180-degree completion turns those into the north and west pairs, so the
// completed board reads 1,1,2,2,3,3,4,4.
//
// WHAT IS DELIBERATELY NOT HERE. `Static Square` and the five other formations the engine already identifies
// need no entry - their own couples win over any order, so an entry would be dead weight (and the probe says so
// if one is added). Everything else in the corpus is absent because its order has not been put through the
// reorder process, and colouring it by position would be a guess dressed as a couple number.
//
// SCOPE: THE SETUP ONLY. A sequence's FIRST formation, or the call on the Call editor's board. A mid-sequence
// board's array order is a leftover of the setup, not a statement about where the dancers stand, which is why
// the sequencer asks this question about its START board (`SequencerController.startIsZeroOrder`) and never
// about the board under the playhead.
export const ZERO_FORMATIONS: readonly string[] = [
  'Circle',
  'Normal Lines',
  'Normal Lines Compact',
  'Lines Facing Out',
  'Lines Facing Out Compact',
  'Sashayed Lines',
  'Star Promenade',
  'Reverse Star Promenade',
  'Static Facing Out',
  'Two-Faced Line LH',
  'Two-Faced Lines',
  'Two-Faced Lines LH',
  'Two-Faced Lines RH',
  'Two-Faced Lines RH Compact',
  'Quarter Lines LH',
  '3/4 Lines LH',
  'T-Bone Couples 1',
  'T-Bone Couples 2',
  'T-Bone LUUR',
  'T-Bone RUUL',
  'T-Bone LDDR',
  'T-Bone RDDL',
  'Phantom Two-Faced RH',
  'Phantom Snap Formation 2',
];

/** Whether any of `names` - a setup's `formation` attribute, its `from` label - is a formation in the list.
 *
 * ANY, not the first, because a call declares the two independently: an exported tam carries `formation`, a
 * still frame the editor builds carries only `from`, and a call re-based onto a named formation carries both
 * with the formation attribute authoritative. Asking about every name it has avoids the "authoritative one is
 * the empty one" trap, and a `null` simply contributes nothing. */
export function isZeroSetup(...names: (string | null | undefined)[]): boolean {
  for (const name of names) {
    const trimmed = (name ?? '').trim().toLowerCase();
    if (trimmed === '') continue;
    if (ZERO_FORMATIONS.some((z) => z.toLowerCase() === trimmed)) return true;
  }
  return false;
}
