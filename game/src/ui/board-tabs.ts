// THE NOW|TARGET SWITCHER'S RULE: which board the stage shows, and what a press of one of the two tabs does.
//
// WHY IT IS A MODULE. The rule is asked from two places that must agree — the tabs' `aria-pressed` state and the stage's
// `setFocus` — and the interesting half is a TOGGLE-OFF that only exists on a wide viewport, which is exactly the kind of
// branch that rots unnoticed when it lives inside a paint function (AGENTS.md §4.3: a rule that lives only in a screen has no
// gate). No DOM here, so `game/test/board-tabs-probe.mjs` can drive every case.
//
// REPORTED: "The Now|Target widget is only on the mobile version, but It would be just as useful in the PC view. Make sure the
// Now|Target widget is shown in both views." On a narrow viewport the pair cannot be shown at all — one board at a time is the
// whole layout — so the tabs are the way between them and there is no third state. On a WIDE one both boards are drawn side by
// side, so the tabs add something different: a press draws that one board at the centre with the other as a ghost on it, and
// pressing the pressed tab again returns to the pair. `null` is that pair state; it is not reachable on a narrow viewport,
// where `focusForLayout` coalesces it to a board rather than leaving the floor empty.

/** Which board the stage is asked to draw: one of the two, or `null` for the pair. */
export type BoardFocus = 'left' | 'right' | null;

/**
 * The focus after a press of `pressed`.
 *
 * A PRESS ALWAYS SCRUBS THE PAIR FIRST — that is the shell's business (`setBoardFocus` clears the paging cursor and the
 * landing hold), because the pair a press acts on must be the solving one rather than whatever page the edge zones left on
 * screen. This function answers only the half a probe can hold: WHICH SIDE, and when the pair comes back.
 *
 * THE PAIR COMES BACK BY PRESSING THE PRESSED TAB, and only where the pair is a thing the layout can draw. On a narrow
 * viewport `pairAvailable` is false, so a second press of the same tab is a no-op rather than a blank floor — the single-board
 * layout has no state in which no board is shown.
 */
export function nextBoardFocus(current: BoardFocus, pressed: 'left' | 'right', pairAvailable: boolean): BoardFocus {
  if (pairAvailable && current === pressed) return null;
  return pressed;
}

/**
 * The focus a layout can actually draw.
 *
 * A SINGLE-BOARD LAYOUT MUST SHOW A BOARD, so the pair state is turned into the left one — the player's own board, which is
 * where the narrow layout starts (`main.ts`'s first `paintBoardTabs`). That also covers a resize: a wide viewport left showing
 * the pair, narrowed, lands on Now rather than on nothing.
 */
export function focusForLayout(focus: BoardFocus, pairAvailable: boolean): BoardFocus {
  if (pairAvailable) return focus;
  return focus ?? 'left';
}
