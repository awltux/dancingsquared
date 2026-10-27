// THE SHAPE OF THE SHELL, AS A PURE FUNCTION OF THE VIEWPORT.
//
// WHY THIS IS NOT A MEDIA QUERY. Three things have to agree about one breakpoint: the stylesheet (which moves the panel
// from the left edge to the bottom), the stage (which is told how much of the canvas floating UI covers, and on which
// side) and the board pair (one board at a time on a narrow screen). A breakpoint written in a media query AND in
// `main.ts` is the second definition this tree keeps paying for — MEASURED, `applyInsets` hard-coded `left: rect.right +
// 8`, which is not merely a duplicated number but an answer that cannot express a bottom sheet at all. So the numbers
// live here, `main.ts` writes them onto the document as custom properties, and `layout-probe.mjs` pins them; the one
// media query in `style.css` is checked against this module rather than trusted.
//
// THE BREAKPOINTS, and why those numbers.
//   * 900 px. Below it the two boards side by side are each under ~400 px of a panel-less canvas, and the panel is a
//     column of text that has nowhere to go but across the bottom. Above it there is room for both, and the desktop
//     layout the game has always had is unchanged.
//   * 600 px is the phone/tablet split for TYPE, not for furniture: a phone gets the compact voice, a tablet the
//     desktop one. Nothing structural depends on it, which is why it is the one number no layout rule reads.
//   * The sheet's height is 46 % of the viewport, clamped to 260–460 px. MEASURED at 393 × 852 that is 392 px — enough
//     for the question, three answers and the verdict (which is what a drill question is), and it leaves 460 px of
//     board, where the side-by-side pair had 196 px each.
//
// SINGLE VS PAIR IS A BOARD-LEGIBILITY DECISION, NOT A FURNITURE ONE. A waypoint pair is a COMPARISON — the left board is
// where the player stands, the right is what they must reach — so hiding one is only acceptable when it is replaced by
// something that keeps the comparison visible (the ghost layer, its own change). Until then a narrow screen keeps both
// boards side by side and this module says `pair`; the `single` answer exists here because the shell has to be told
// which it is, and a probe can pin the choice at the boundary.

/** The viewport width below which the panel goes to the bottom and the boards lose their side-by-side room. */
export const NARROW_MAX_WIDTH = 900;

/** The viewport width at which the left panel may take its widest form. */
export const WIDE_MIN_WIDTH = 1280;

/** The panel's height as a fraction of the viewport when it is a bottom sheet, and the clamp it is held in. */
export const SHEET_FRACTION = 0.46;
export const SHEET_MIN = 260;
export const SHEET_MAX = 460;

/** The two sizes a left panel takes. */
export const PANEL_WIDE = 340;
export const PANEL_NARROW = 300;

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

/** Everything the shell needs to know about the viewport, in one value. */
export interface Layout {
  /** The type scale's mode, from the viewport's SMALLEST side: a tablet in portrait is a big phone, not a small desktop. */
  mode: LayoutMode;
  /** Where the panel sits, which is also where the stage must inset itself. */
  panelSide: 'bottom' | 'left';
  /** The panel's size along its side: a HEIGHT when it is at the bottom, a WIDTH when it is on the left. */
  panelSize: number;
  /** Whether the stage draws the waypoint pair or one board at a time. */
  boards: 'pair' | 'single';
}

/**
 * The layout for a viewport.
 *
 * IT TAKES THE NUMBERS RATHER THAN READING THEM, so the rule is drivable from a probe with no window, no DOM and no
 * resize event — and so the caller cannot accidentally measure a different viewport than the one it applies.
 */
export function layoutFor(width: number, height: number): Layout {
  const shortSide = Math.min(width, height);
  // THE WIDTH DECIDES DESKTOP, THE SHORT SIDE DECIDES PHONE VS TABLET. A 1440 x 900 laptop has a 900 px short side and
  // is not a tablet; a 768 x 1024 tablet in portrait has a 600+ short side and is not a phone.
  const mode: LayoutMode = width >= 1024 ? 'desktop' : shortSide >= 600 ? 'tablet' : 'phone';
  if (width < NARROW_MAX_WIDTH) {
    const size = Math.round(height * SHEET_FRACTION);
    return {
      mode,
      panelSide: 'bottom',
      panelSize: Math.min(SHEET_MAX, Math.max(SHEET_MIN, size)),
      boards: 'pair',
    };
  }
  return {
    mode,
    panelSide: 'left',
    panelSize: width >= WIDE_MIN_WIDTH ? PANEL_WIDE : PANEL_NARROW,
    boards: 'pair',
  };
}
