// THE HUD'S OWN TEXT SIZE, and the panel's own size, as DATA.
//
// Asked for as: "Add a button at the top of the HUD to increase text size for the sight-impaired. This will
// likely require a larger HUD, so add a resize grab handle to the hud area."
//
// WHY THE TWO GO TOGETHER, and why neither is a stylesheet change. Every size in `style.css` is an absolute
// px, so "make the text bigger" is a multiplier over all of them - `--hud-text`, applied at the panel's own
// declaration of each size - and a bigger multiplier means MORE WRAPPING in the same box. The panel cannot
// guess how much room a reader needs, so the second half of the feature is the reader's: a grab handle that
// sets the panel's width and height by hand, which the `ResizeObserver` in `main.ts` already picks up when
// it re-frames the floor around it.
//
// THE RULES LIVE HERE, DOM-FREE, so `poc/tools/hud-size-probe.mjs` can call them with the real ladder and
// the real clamps instead of reading this file's source (§4.3). The DOM half - the button, the drag, the
// `localStorage` write - is `hud-chrome.ts`.
//
// STORED VALUES ARE PARSED, NOT TRUSTED, for the same reason `stored-modules.ts` parses modules: the value
// is `localStorage`, which the caller, another tab or an interrupted write can all change, and it is read
// during startup. An unreadable blob falls back to the defaults rather than taking the app down.

/** The sizes the button cycles, as multipliers over the stylesheet's own px. 100% is the app as it was. */
export const TEXT_SCALES: readonly number[] = [1, 1.25, 1.5, 2];

/** The smallest panel the grab handle will make. The stylesheet's own `min-width` is 320px, and this is
 *  the FLOOR rather than a preference: below it the row of a label and a control no longer fits on one
 *  line at any scale. */
export const HUD_MIN_WIDTH = 320;
/** The shortest panel: the mode row plus a couple of controls, which is what any mode needs to be usable. */
export const HUD_MIN_HEIGHT = 200;
/** Breathing room between the panel's edge and the window's, matching the stylesheet's own 12px offsets -
 *  a panel flush to the edge has no grab handle to aim at and no visible border. */
export const HUD_EDGE_GAP = 24;

export interface HudPrefs {
  /** One of `TEXT_SCALES`. */
  scale: number;
  /** The panel's size, or null for "whatever this mode's own CSS says" - which is the default, so the
   *  panel keeps its content-sized width until somebody actually drags the handle. */
  width: number | null;
  height: number | null;
}

export const HUD_PREFS_KEY = 'dsq-hud-chrome';

export const DEFAULT_HUD_PREFS: HudPrefs = { scale: 1, width: null, height: null };

/** The next scale up, wrapping back to 100% at the top - so one button reaches every size and there is no
 *  second control to find. */
export function nextTextScale(current: number): number {
  const i = TEXT_SCALES.indexOf(current);
  return TEXT_SCALES[i < 0 ? 0 : (i + 1) % TEXT_SCALES.length];
}

/** The label's percentage, as an integer: the multipliers are steps, not measurements, so 1.25 -> "125%". */
export function textScalePercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/**
 * `width`/`height` clamped so the panel always stays on screen and always has a handle to grab.
 *
 * `max` is the VIEWPORT less the edge gap, not a constant, because the panel is `position: absolute` on the
 * board: a size remembered on a large window must not put the grab handle off the edge of a small one. The
 * minimum also rises with the text scale, because a floor measured at 100% is not a floor at 200% - the
 * same 320px holds roughly half the characters.
 */
export function clampHudSize(
  width: number,
  height: number,
  viewport: { width: number; height: number },
  scale = 1,
): { width: number; height: number } {
  const minW = Math.round(HUD_MIN_WIDTH * scale);
  const minH = Math.round(HUD_MIN_HEIGHT * scale);
  const maxW = Math.max(minW, Math.floor(viewport.width - HUD_EDGE_GAP));
  const maxH = Math.max(minH, Math.floor(viewport.height - HUD_EDGE_GAP));
  const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo);
  return { width: clamp(width, minW, maxW), height: clamp(height, minH, maxH) };
}

/**
 * The stored preferences, with every field that is not one of them DROPPED rather than repaired - a scale
 * that is not on the ladder is not a size this app offered, and a size is only kept when it is a finite
 * positive number (the clamps are applied where the viewport is known, which is not here).
 */
export function parseHudPrefs(raw: string | null): HudPrefs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || 'null');
  } catch {
    return { ...DEFAULT_HUD_PREFS };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_HUD_PREFS };
  const { scale, width, height } = parsed as { scale?: unknown; width?: unknown; height?: unknown };
  const size = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  return {
    scale: typeof scale === 'number' && TEXT_SCALES.includes(scale) ? scale : 1,
    // A HALF-RESIZED PANEL IS NOT HALF A PREFERENCE: one axis alone is what a caller who dragged only
    // sideways would store, and the other axis keeps the mode's own CSS.
    width: size(width),
    height: size(height),
  };
}

export function serialiseHudPrefs(prefs: HudPrefs): string {
  return JSON.stringify({ scale: prefs.scale, width: prefs.width, height: prefs.height });
}
