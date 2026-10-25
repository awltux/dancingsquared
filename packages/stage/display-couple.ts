// THE COLOUR A DANCER IS DRAWN IN, AND THE ONE RULE ALL THREE SCREENS USE.
//
// A board is coloured BY HOME COUPLE where the engine has one, which is data: `assignHomeIdentity` stamps it by
// matching the start formation to the home square, so it exists only for a squared set or something a rotation or
// reflection carries home. MEASURED by `poc/tools/display-couple-probe.mjs` against the shipped corpus: 6 of the 292
// formations in `assets/formations.xml`. Every other setup - a Zero Line, a Zero Box, a column, a line of 6 - comes
// back with `UNKNOWN_COUPLE` on every dancer, and `coupleColor(0)` is one grey for all of them. That is right for the
// ENGINE (a placeholder must never be readable as an identity) and wrong for the SCREEN: eight grey dancers cannot be
// told apart, which is what was reported - "How can I get the dancer colour coding to appear for the formations in
// the zero setup? ... e.g. zero lines, zero colums etc", and again, for the game's own boards, as "can the game boards
// display the dancer couple colours, even if the formations aren't in the start formations list".
//
// SO THE FALLBACK IS THE PAIR, AND IT IS NOT A GUESS. A dancer with no home couple is drawn in the colour of the pair
// it sits in in the board's own order - `floor(index / 2) + 1` - and the board's order is the FORMATION ELEMENT's order:
// the board is built from an element (the sequencer's setup picker hands over `row.dancers`, a call variant hands over
// its own start `<formation>`, the game hands over a start board), and `sid` (`engine/src/sequencer/setup-id.ts`) is
// exactly the identity that says "this arrangement, in this order". The colour therefore says one thing - "these two
// are a pair in this element's authored order" - which is true by construction, and never "these two are couple 2 in
// the square".
//
// WHAT WAS RETIRED, AND WHY. This function used to take an `enabled` flag and the POC's sequencer passed `false` unless
// the start board's NAME was in a 24-entry list (`poc/src/zero-formations.ts`, the setups whose authored order the
// reorder process had verified as square-set order). The list answered a real question - for the other 286 formations
// nobody had established that consecutive dancers are partners - but it gated the COLOUR on a NAME, so a setup reached
// through the setup picker was grey unless its own name happened to be listed, and the 274 setups that exist only as a
// call's inline `<formation>` block were never listed at all. Once every defined formation element has a `sid`, every
// one of them IS a setup whose order is its own data, so there is nothing left to approve: the pair colour is the
// default on every board, and the list, `isZeroSetup`, `startIsZeroOrder` and the flag are gone. The probe that prints
// the 6-of-292 figure is also the one that goes red if a gate comes back.
//
// THE COUPLE **NUMBER** IS STILL A PER-SCREEN DECISION, and `DancerView` keeps it separate (`labelled`). The POC's
// sequencer draws it on every setup - "which pair is this" is what a caller reads off that board - while the browse/edit
// board and the game draw the colour only: `coupleTag` spells a number "1h"/"2s", which claims a head or a side, so a
// pair derived from the authored order is given a colour worth drawing and no letter worth believing.
//
// HALF THE SET COMES FREE. The corpus authors a formation as half a set and the reader completes it by turning each
// dancer 180 degrees about the centre, which takes the south pair to the north pair and the east pair to the west - so
// a written `1,1,2,2` completes to `1,1,2,2,3,3,4,4`. `poc/tools/display-couple-probe.mjs` measures that against the
// engine's own squared set rather than restating it.
//
// WHAT IT IS NOT. This value never reaches the engine board and is never written to a file: `sequence`, `corner` and
// `fasrKey` still read the board's `couple`, which stays UNKNOWN, and the editor's own table still prints "-" for it -
// which is why the editor's info line says out loud that the colours follow the list order.
export function displayCouple(d: { couple?: number | null }, index: number): number {
  const couple = d.couple ?? 0;
  if (couple > 0) return couple;
  return (Math.floor(index / 2) % 4) + 1;
}
