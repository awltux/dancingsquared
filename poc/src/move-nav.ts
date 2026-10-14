// THE CALL EDITOR'S MOVE STRIP, STEPPED ONE SLOT AT A TIME - the rule behind the A and F keys.
//
// WHY THIS IS ITS OWN MODULE, with no DOM and no `three`: the rule is ARITHMETIC, and `editor-ui.ts` builds
// DOM, so a rule left inside it could only ever be MIRRORED by a probe rather than measured - the same reason
// `scrub-keep.ts`, `grid-magnet.ts` and `board-transform.ts` exist. `poc/tools/move-nav-probe.mjs` imports
// this through node's type stripping and drives it.
//
// THE WRAP IS THE WHOLE POINT, and it is what was asked for: "Use A-KEY to select the previous move (lower
// index), rotating to the end after it reaches 0 index. Similarly use F-KEY to select the next move (higher
// index), rotating to the start after last index." A CLAMP is the obvious alternative and is dead at both
// ends of the strip - it is the probe's negative control, and the two wrap checks are the ones that rule it
// out while every mid-strip check passes under both rules.
//
// `null` IS NOT 0. A dancer with no moves has nowhere to step to; slot 0 is a slot. The caller has to tell
// them apart, and returning 0 here would send the strip to slot 0 of nothing.
//
// `current` IS EXPECTED TO BE A LIVE SLOT, not a copy of the strip's own clamp: `renderMoveStrip` already
// pulls `moveIndex` back into range when a path shrinks, and a second clamp here would be a second rule about
// the same thing.

/**
 * The move slot `direction` lands on from `current`, wrapping at both ends - or `null` when there is no slot
 * to step to, i.e. the selected dancer has no moves at all.
 *
 * @param current   the selected slot, expected to be in `[0, count)`
 * @param direction `-1` for the previous move, `1` for the next
 * @param count     how many slots the strip has
 */
export function stepMoveIndex(current: number, direction: -1 | 1, count: number): number | null {
  if (count <= 0) return null;
  return (current + direction + count) % count;
}
