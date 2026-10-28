// WHETHER THE SKIP IS OFFERED AT ALL — a rule of the game, in a module a probe can reach.
//
// WHY THIS IS NOT INLINE IN `main.ts` ANY MORE. The rule began as three conditions on shell state (`serverIssued()`,
// `serverDrill.replay`, `apiConfigured()`), which is the layer no probe loads — and the OWNER then added a fourth that is not about
// the server at all:
//
//   "In mobile view, remove the skip and show-me buttons. They are too easy to warrant this. They must solve them. Also, they
//   hide the choices, so very bad UI design."
//
// TWO REASONS, ONE RULE, and both have to be stated where the next reader finds them: the skip is a way past a puzzle the player
// was not asked to solve (a game-design objection, which the desktop keeps on purpose — see below), and on a SHEET it costs a
// 48 px row of the panel's fixed height, which is the row `#answers` needed to be on screen (a layout objection, measured: at
// 500 x 757 the sheet is 348 px and the footer's two rows took 250 of them before the bookkeeping text left it).
//
// THE DESKTOP KEEPS IT DELIBERATELY. The owner scoped this to "mobile view", and the reason the skip exists remains true on a
// desktop: the regime is an ORDER (§15 Q5), so one puzzle a player cannot solve blocks every drill behind it — and a mouse has no
// shortage of room to show the choices beside it. That asymmetry is a decision, so it is written down rather than inferred from a
// media query.

/** The facts the offer is a function of, each supplied by the caller that already knows it. */
export interface SkipFacts {
  /** Whether the drill on screen is one the SERVER issued (DESIGN.md §15 Q23: the fixture's own drill is not the season's). */
  readonly serverIssued: boolean;
  /** Whether the server-issued drill on screen is a REATTEMPT of a closed position. */
  readonly replay: boolean;
  /** Whether the server will accept a write from this caller at all (`standing.ts`'s `mayWrite`). */
  readonly mayWrite: boolean;
  /** Whether an API is configured — the offline game has no server to advance. */
  readonly configured: boolean;
  /** Whether the shell is the narrow layout, i.e. a sheet across the bottom (`ui/layout.ts`'s `panelSide`). */
  readonly sheet: boolean;
}

/**
 * Whether to draw the skip, in the order the answers outrank each other.
 *
 * THE SHEET IS CHECKED FIRST, because it is the one condition that does not care what the server would do: on a phone the control
 * is not in this build, for the two reasons above, whatever the identity mode is.
 *
 * THEN A REATTEMPT IS NOT SKIPPABLE, and the reason is that the control could do nothing: the position is already `finished`, so
 * advancing would close a drill that is already closed and the block would not move. A control whose only outcome is "nothing
 * happened" is worse than no control — the same rule §15 Q20's practice offer and Q21's advance are written to. MEASURED IN A
 * BROWSER: a skipped drill was reattempted, and "Skip this drill" was still offered beside it.
 *
 * THEN THE SERVER, because a skip is a WRITE: it needs an identity the server will accept (§11.1, A20), and a demo would be
 * refused. Offline, there is no server to ask — the local ledger is the whole record and the mark is applied to it.
 */
export function skipOffered(facts: SkipFacts): boolean {
  if (facts.sheet) return false;
  if (facts.serverIssued && facts.replay) return false;
  if (facts.serverIssued) return facts.mayWrite;
  return !facts.configured;
}
