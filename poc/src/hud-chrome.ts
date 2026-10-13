// THE HUD'S TEXT-SIZE BUTTON AND ITS RESIZE GRAB HANDLE - the DOM half of `hud-size.ts`.
//
// See that module for why the two belong to one feature and why the rules are over there. This file owns
// three things and nothing else: reading the stored preferences at startup, writing them back, and turning a
// pointer drag or an arrow key into the one size the rules will accept.
//
// THE SCALE IS APPLIED AS A CSS VARIABLE on the panel, `--hud-text`, and the stylesheet multiplies its own
// px sizes by it. That is why the panel's box does not grow on its own: a reader who scales the text up gets
// more wrapping until they drag the handle, which is exactly the two-step the request describes.
//
// THE HANDLE IS ALSO A KEYBOARD CONTROL. `role="separator"` with a tab stop and arrow keys, because the
// reader this feature is for may not be able to hold a drag steady - and a 10px step (50 with Shift) reaches
// every size the clamps allow without a pointer at all.
import { el } from './dom';
import {
  DEFAULT_HUD_PREFS,
  HUD_PREFS_KEY,
  TEXT_SCALES,
  clampHudSize,
  nextTextScale,
  parseHudPrefs,
  serialiseHudPrefs,
  textScalePercent,
  type HudPrefs,
} from './hud-size';

/** Pixels per arrow-key press, and per press with Shift held. */
const KEY_STEP = 10;
const KEY_STEP_LARGE = 50;

/** The ladder as the button's tooltip spells it - read from the module that owns it, so the two cannot
 *  drift: a tooltip promising a size the button never reaches is worse than no tooltip. */
const SCALE_LABELS = TEXT_SCALES.map(textScalePercent).join(' / ');

export function initHudChrome(): void {
  const hud = el<HTMLDivElement>('hud');
  const button = el<HTMLButtonElement>('hudTextSize');
  const handle = el<HTMLDivElement>('hudResize');

  let prefs: HudPrefs = (() => {
    try {
      return parseHudPrefs(localStorage.getItem(HUD_PREFS_KEY));
    } catch {
      // A browser with storage switched off is not a reason to lose the button: the panel works, it just
      // forgets. `try` rather than a feature test because the throw is on READ in some configurations.
      return { ...DEFAULT_HUD_PREFS };
    }
  })();

  function save(): void {
    try {
      localStorage.setItem(HUD_PREFS_KEY, serialiseHudPrefs(prefs));
    } catch {
      /* not remembering is the acceptable failure here; see above */
    }
  }

  /** Put the current preferences on the panel. The SIZE is applied only when one was stored: with neither
   *  axis set the panel keeps the mode's own content-sized CSS, which is what the app has always done. */
  function apply(): void {
    hud.style.setProperty('--hud-text', String(prefs.scale));
    button.textContent = `Text ${textScalePercent(prefs.scale)}`;
    button.title = `Panel text size: ${textScalePercent(prefs.scale)}. Click to cycle ${SCALE_LABELS}. `
      + 'The panel can be made larger with the grab handle at its bottom-right corner, by dragging it or with '
      + 'the arrow keys.';
    if (prefs.width !== null && prefs.height !== null) {
      hud.style.width = `${prefs.width}px`;
      hud.style.height = `${prefs.height}px`;
      // THE MODE'S OWN LIMITS ARE LIFTED, because they are what the handle is for: `max-width: 420px` (780
      // in the instance editor) and `max-height: calc(100vh - 24px)` are content-sized defaults, and leaving
      // them on would clamp a deliberate drag back to the default.
      hud.style.maxWidth = 'none';
      hud.style.maxHeight = 'none';
    }
  }

  function setSize(width: number, height: number): void {
    const size = clampHudSize(width, height, {
      width: window.innerWidth,
      height: window.innerHeight,
    }, prefs.scale);
    prefs = { ...prefs, ...size };
    apply();
    save();
  }

  /** The size the panel is standing at now - the source for a drag, so a drag that starts from the
   *  content-sized default grows from what the reader can actually see. */
  function currentSize(): { width: number; height: number } {
    const r = hud.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  }

  button.addEventListener('click', () => {
    prefs = { ...prefs, scale: nextTextScale(prefs.scale) };
    // A SCALE CHANGE RE-CLAMPS THE SIZE, because the minimum rises with it: at 200% a panel dragged to the
    // 100% floor is narrower than its own contents, and the reader has no way to know why.
    if (prefs.width !== null && prefs.height !== null) {
      const size = clampHudSize(prefs.width, prefs.height, { width: window.innerWidth, height: window.innerHeight }, prefs.scale);
      prefs = { ...prefs, ...size };
    }
    apply();
    save();
  });

  // ---- the grab handle -------------------------------------------------------------------------------
  let drag: { x: number; y: number; width: number; height: number } | null = null;

  handle.addEventListener('pointerdown', (e) => {
    const size = currentSize();
    drag = { x: e.clientX, y: e.clientY, width: size.width, height: size.height };
    // POINTER CAPTURE, so a fast drag that leaves the panel keeps resizing it instead of dropping the
    // gesture - the handle is 18px and the pointer is not. Guarded because capture throws when the pointer
    // is no longer active (a release that raced the listener, or a synthetic event), and losing capture is
    // not a reason to lose the drag: without it the gesture still works while the pointer stays on the
    // handle, which is better than an exception out of a pointerdown handler.
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* the drag continues without capture; see above */
    }
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    setSize(drag.width + (e.clientX - drag.x), drag.height + (e.clientY - drag.y));
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    try {
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    } catch {
      /* see pointerdown */
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const size = currentSize();
    const moves: Record<string, [number, number]> = {
      ArrowRight: [size.width + step, size.height],
      ArrowLeft: [size.width - step, size.height],
      ArrowDown: [size.width, size.height + step],
      ArrowUp: [size.width, size.height - step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    setSize(move[0], move[1]);
  });

  apply();
}
