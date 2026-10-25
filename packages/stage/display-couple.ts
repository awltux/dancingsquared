// THE COLOUR A DANCER IS DRAWN IN WHEN THE BOARD HAS NO HOME IDENTITY.
//
// A board is coloured BY HOME COUPLE, which is data: `assignHomeIdentity` stamps it by matching the start formation to
// the home square, so it exists only for a squared set or something a rotation/reflection carries home (six of the
// formations in `assets/formations.xml`, a figure `poc/tools/display-couple-probe.mjs` prints live, and 6 of the 44 a
// level-1 pool offers as start boards). Every other
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
// CALLER'S DECISION rather than this function's, and the callers disagree because their screens claim different
// things.
//
// THE BROWSE/EDIT BOARD AND THE GAME PASS `enabled: true` FOR EVERY BOARD. Neither shows a couple NUMBER for a
// display-only couple (`DancerView`'s `labelled` is false there), so the colour is the only thing said - "these two
// dancers are a pair in this formation's authored order" - and telling eight dancers apart is the whole job the colour
// has. Where the engine DOES know the couples they win, because the first branch returns `d.couple`. The one caller
// that still passes `false` is the POC's sequencer, which gates on its start board's name against `ZERO_FORMATIONS`
// and builds the avatar with couple 0 - one grey, exactly as before - because there a colour that might be the wrong
// couple is worse than no colour.
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
