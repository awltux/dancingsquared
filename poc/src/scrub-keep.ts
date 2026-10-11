// WHERE THE CALL EDITOR'S SCRUB LANDS WHEN THE SETUP PICKER SWAPS THE AUTHORING.
//
// WHY THIS IS ITS OWN MODULE, with no DOM and no `three`: the rule is ARITHMETIC, and a probe that
// restated it would be measuring a copy (§5). `editor-ui.ts` builds DOM, so a rule left inside it could
// only ever be mirrored - the same reason `grid-magnet.ts` and `board-transform.ts` exist. Here
// `poc/tools/editor-setup-scrub-probe.mjs` imports it through node's type stripping and measures it.
//
// ONE CALL HAS SEVERAL AUTHORINGS (`<tam>`, one per setup) AND THEY ARE NOT ALL THE SAME LENGTH.
// Stepping through them is how a caller compares their END FORMATIONS, so the scrub has to survive the
// swap - which is why `loadInstance(true)` does not reset it to 0.
//
// BUT A BEAT IS AN ABSOLUTE POSITION, AND THAT IS THE WRONG THING TO CARRY ACROSS A LENGTH CHANGE.
// Reported as: "Currently it maintains the first calls duration, which doesnt work if the next setup
// opens a call that is longer." Measured against the clamp this replaces (`min(nextBeats, at)`): sitting
// at `beat 4.00 / 4.00` and stepping to an authoring of 8 beats landed on `beat 4.00 / 8.00` - the MIDDLE
// of the new call. So the end formation the caller was stepping through the setups to compare was the
// one thing the step did not show, which is the request inverted.
//
// THE RULE IS THEREFORE ABOUT THE END, NOT ABOUT THE NUMBER. A scrub already at its own maximum means
// "show me the last frame", and the last frame of a longer call is at ITS maximum. Anything else is a
// position, and a position is carried as one, clamped into range.
//
// THE END TEST IS HALF A STEP, and both halves of that are load-bearing. The control's `step` is
// `SCRUB_STEP` (exported below so the bar and this test cannot drift), so ONE STEP BACK from the end is a
// position the arrow keys can genuinely reach and must NOT be read as the end - that sets the bound at
// strictly under a whole step. And a drag to the far right lands on the maximum exactly, so the slack is
// only there to absorb writing the value out through a string; half a step is the most that can be given
// without swallowing the reachable position above.

/** The scrub bar's own step, in beats. The bar sets `step` from this and the end test is derived from it. */
export const SCRUB_STEP = 0.01;

/**
 * Where the scrub lands after the setup picker swaps one authoring of a call for another.
 *
 * @param at        the scrub position in the OUTGOING authoring's beats
 * @param prevBeats the outgoing authoring's length, in beats
 * @param nextBeats the incoming authoring's length, in beats
 */
export function keptScrubBeat(at: number, prevBeats: number, nextBeats: number): number {
  // A call with no beats has no last frame to pin to, so it falls through to the clamp - which is also
  // what an absent previous instance does, and keeps `editBeat <= nextBeats` true on every path.
  if (prevBeats > 0 && at >= prevBeats - SCRUB_STEP / 2) return nextBeats;
  return Math.max(0, Math.min(nextBeats, at));
}
