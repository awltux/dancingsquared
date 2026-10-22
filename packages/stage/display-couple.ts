// THE COLOUR A DANCER IS DRAWN IN WHEN THE BOARD HAS NO HOME IDENTITY.
//
// A board is coloured BY HOME COUPLE, which is data: `assignHomeIdentity` stamps it by matching the start formation to
// the home square, so it exists only for a squared set or something a rotation/reflection carries home (MEASURED: 6 of
// the 291 formations in `assets/formations.xml`, and 6 of the 44 a level-1 pool offers as start boards). Every other
// setup - a Zero Line, a Zero Box, a column, a line of 6 - comes back with `UNKNOWN_COUPLE` on every dancer, and
// `coupleColor(0)` is one grey for all of them. That is right for the ENGINE (a placeholder must never be readable as
// an identity) and wrong for the SCREEN: eight grey dancers cannot be told apart, which is what was reported - "How can
// I get the dancer colour coding to appear for the formations in the zero setup? ... e.g. zero lines, zero colums etc",
// and again, for the game's own boards, as "can the game boards display the dancer couple colours, even if the
// formations aren't in the start formations list".
//
// THE FALLBACK IS A PAIR NUMBER: a dancer with no home couple is drawn in the colour of the pair it sits in in the
// board's own order - `floor(index / 2) + 1` - which is a couple exactly when the formation is authored in square-set
// order. That is not readable off the geometry (four identities share one set of spots), which is why `enabled` is a
// CALLER'S DECISION rather than this function's: the POC gates it on the formation's NAME against `ZERO_FORMATIONS`
// (the setups whose order has been put through the reorder process), and when `enabled` is false the avatar is built
// with couple 0 - one grey, exactly as before - because a colour that might be the wrong couple is worse than no
// colour on a board a caller is READING COUPLE NUMBERS OFF.
//
// THE GAME PASSES `enabled: true` FOR EVERY BOARD, and the difference is what its screen claims. Nothing there shows a
// couple NUMBER or a head/side letter (`DancerView`'s label is suppressed for a display-only couple), so the colour is
// the only thing said - "these two dancers are a pair in this formation's authored order" - and telling eight dancers
// apart is the whole job the colour has. Where the engine DOES know the couples they win, because the first branch
// returns `d.couple`.
//
// HALF THE SET COMES FREE. The corpus authors a formation as half a set and the reader completes it by turning each
// dancer 180 degrees about the centre, which takes the south pair to the north pair and the east pair to the west - so
// a written `1,1,2,2` completes to `1,1,2,2,3,3,4,4`. `poc/tools/display-couple-probe.mjs` measures that against the
// engine's own squared set rather than restating it.
//
// WHAT IT IS NOT. This value never reaches the engine board and is never written to a file: `sequence`, `corner` and
// `fasrKey` still read the board's `couple`, which stays UNKNOWN, and the editor's own table still prints "-" for it -
// which is why the editor's info line says out loud that the colours follow the list order.
export function displayCouple(d: { couple?: number | null }, index: number, enabled: boolean): number {
  const couple = d.couple ?? 0;
  if (couple > 0) return couple;
  return enabled ? (Math.floor(index / 2) % 4) + 1 : 0;
}
