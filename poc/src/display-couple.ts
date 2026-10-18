// THE COLOUR A DANCER IS DRAWN IN WHEN THE BOARD HAS NO HOME IDENTITY.
//
// A board is coloured BY HOME COUPLE, which is data: `assignHomeIdentity` stamps it by matching the start
// formation to the home square, so it exists only for a squared set or something a rotation/reflection carries
// home (MEASURED: 6 of the 291 formations in `assets/formations.xml`). Every other setup - a Zero Line, a Zero
// Box, a column, a line of 6 - comes back with `UNKNOWN_COUPLE` on every dancer, and `coupleColor(0)` is one
// grey for all of them. That is right for the ENGINE (a placeholder must never be readable as an identity) and
// wrong for the SCREEN: eight grey dancers cannot be told apart, which is what was reported - "How can I get the
// dancer colour coding to appear for the formations in the zero setup? ... e.g. zero lines, zero colums etc".
//
// THE FALLBACK IS A PAIR NUMBER, AND ONLY WHERE THE PAIRING IS A DECISION. A dancer with no home couple is drawn
// in the colour of the pair it sits in in the board's own order - `floor(index / 2) + 1` - which is a couple
// exactly when the formation is authored in square-set order. That is not readable off the geometry (four
// identities share one set of spots), so it is asked about the formation's NAME against `ZERO_FORMATIONS`, the
// list of setups whose order has been put through the reorder process. `enabled` is false for every other
// setup, and then the avatar is built with couple 0 - one grey, exactly as before - because a colour that might
// be the wrong couple is worse than no colour on a board a caller is reading couple numbers off.
//
// HALF THE SET COMES FREE. The corpus authors a formation as half a set and the reader completes it by turning
// each dancer 180 degrees about the centre, which takes the south pair to the north pair and the east pair to the
// west - so a written `1,1,2,2` completes to `1,1,2,2,3,3,4,4`. `poc/tools/display-couple-probe.mjs` measures
// that against the engine's own squared set rather than restating it.
//
// WHAT IT IS NOT. This value never reaches the engine board and is never written to a file: `sequence`, `corner`
// and `fasrKey` still read the board's `couple`, which stays UNKNOWN, and the editor's own table still prints
// "-" for it - which is why the editor's info line says out loud that the colours follow the list order.
export function displayCouple(d: { couple?: number | null }, index: number, enabled: boolean): number {
  const couple = d.couple ?? 0;
  if (couple > 0) return couple;
  return enabled ? (Math.floor(index / 2) % 4) + 1 : 0;
}
