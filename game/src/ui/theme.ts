// THE GAME'S DESIGN TOKENS: ONE TABLE, IN TYPESCRIPT, INJECTED INTO `:root` AT BOOT.
//
// WHY HERE AND NOT IN `style.css`. Three things need the same numbers: the stylesheet (which draws the interface),
// `render/stage-view.ts` (which colours the waypoint borders IN THE SCENE — a WebGL material cannot read a CSS custom
// property) and any probe that wants to ask "is this pair of colours readable". A hex written in `style.css` and again
// in TypeScript is two definitions of one fact, which is the failure mode AGENTS.md §4.3 names; MEASURED before this
// file existed, the three waypoint states were defined in `stage-view.ts` and COPIED into `style.css` as the
// `--wp-solved`/`--wp-next`/`--wp-locked` custom properties "because a second hex here would be a second definition to
// keep in step" — true, and the copy was still the second definition. Now the table is the definition, `style.css`
// reads `var(--…)` and `main.ts` injects it before the first paint.
//
// THE SCHEME. A near-black stage (the 3D floor's lighting is tuned for it), a single warm accent for "this is the thing
// to press" and a cool one for "the next thing", with the success/danger pair the verdicts have always used. Surfaces
// are a four-step ramp rather than the thirteen ad-hoc hexes the stylesheet had accumulated, so a raised control is a
// decision and not a new colour. Radii and motion are here for the same reason: one place to change them.
//
// WHAT IS NOT HERE YET. Type sizes. The stylesheet still carries its own rem literals because the mobile scale is
// decided in the shell phase, where it is measured on a phone; moving the current sizes into tokens first would be a
// rename with no rule behind it. `game/test/theme-probe.mjs` is the gate for what IS here: every custom property the
// stylesheet asks for must be defined exactly once, no colour literal may escape this table, the scene's outline
// colours must BE three of these tokens, and every text/background pair must clear WCAG AA (4.5:1, or 3:1 for a border
// or a large glyph) — computed, not asserted.
//
// A REFUSAL IS A VALUE, and this module's only refusal-shaped thing is `applyTheme`'s root: it takes the element rather
// than reading `document`, so a probe can call it with a stub and the module itself stays importable under bare Node
// (no DOM, no `three`, no I/O).

import type { WaypointState } from '../puzzle/waypoint-pair.ts';

/** The colour table. Names say the ROLE; the hex is a value that may change without renaming anything. */
export const COLOR = {
  /** The page and the canvas's clear colour: the game is dark because the 3D stage's key light is. */
  bg: '#0b1016',
  /** The floating panel's own surface, laid over the canvas. */
  panel: 'rgba(8, 13, 19, 0.92)',
  /** The four-step surface ramp: page, control, raised control, pressed control. */
  surface: '#121c26',
  control: '#16222e',
  raised: '#1d2b38',
  pressed: '#22303d',
  /** An input's field, one step BELOW a control so a form reads as recessed. */
  field: '#0d1620',

  /** Text. `dim` is the one secondary voice: never a smaller contrast, only a lighter one. */
  ink: '#eef4f8',
  dim: '#9fb2c0',
  /** State: success, danger, attention. */
  ok: '#7fe3a1',
  bad: '#ff8f8f',
  accent: '#ffd166',
  /** "The next thing" — the pending waypoint's border and its legend key. */
  next: '#6fb7ff',

  /**
   * Lines. Three weights: a hairline that merely separates (`lineSoft`), the edge of a real control (`line`), and the
   * edge of something focused or armed (`lineStrong`).
   *
   * THE CONTROL EDGE IS OPAQUE AND LIGHT ON PURPOSE. MEASURED by `theme-probe.mjs` with the compositing the eye does, the
   * previous `rgba(255, 255, 255, 0.18)` edge over a control's fill came to **1.78:1**, and the fill against the panel to
   * **1.19:1** — so a button's boundary, the only thing that said "this is pressable", was below WCAG's 3:1 for a UI
   * component. The token is now a slate that measures 3.55:1 on a control, 3.17:1 on a raised one and 4.20:1 on the
   * panel, and being opaque it is the same number whatever the surface behind it.
   */
  line: '#6d7a87',
  lineSoft: 'rgba(255, 255, 255, 0.08)',
  lineStrong: '#8b98a5',
  /** A published-but-not-handed-out level cell's border: visible as a promise, not as a control, so it is a hairline. */
  lineGhost: 'rgba(255, 255, 255, 0.06)',

  /** The level block's four cell states. */
  donePassed: '#2f6f4f',
  donePassedLine: '#3d8a63',
  doneSkipped: '#2a3b46',
  doneSkippedHover: '#354a58',

  /**
   * TEXT AT TWO STRENGTHS BELOW `dim`, for a caption on top of a picture. MEASURED, the 0.4-alpha form of `inkFaint` came
   * to 3.79:1 over the level block's surface and had to become an opaque slate: quiet is a smaller voice, never a
   * harder-to-read one.
   */
  inkFaint: '#8695a3',
  inkSoft: 'rgba(255, 255, 255, 0.55)',
  /** The two accent tints the waypoint arrows are drawn with, so the accent is not spelled three ways. */
  accentGhost: 'rgba(255, 209, 102, 0.12)',
  accentSoft: 'rgba(255, 209, 102, 0.26)',
  /** A caption's shadow, which is what keeps white text legible over the canvas's own colors. */
  shadowText: 'rgba(0, 0, 0, 0.9)',
} as const;

/** Corner radii, so a card and a pill cannot disagree about the language. */
export const RADIUS = {
  cell: '4px',
  field: '8px',
  control: '10px',
  card: '14px',
  pill: '999px',
} as const;

/**
 * Durations. `press` is the acknowledgement of a tap, `enter` what a card takes to arrive, `slide` is the board
 * transition `slide-math.ts` already animates, and `celebrate` is `render/celebrate.ts`'s `CELEBRATE_MS` — the one
 * number here that is also a physics bound, so `theme-probe.mjs` checks the two agree (520 ms is 1.9 flashes/s, under
 * the three-per-second guidance the celebration module cites).
 */
export const MOTION = {
  press: '120ms',
  enter: '240ms',
  slide: '320ms',
  celebrate: '520ms',
  /** The busy spinner's turn. Not a state transition, but it is a duration and one place is enough. */
  spin: '800ms',
  ease: 'ease',
} as const;

/**
 * THE WAYPOINT BORDERS, by state — what the stage paints a board's outline and what the legend's keys are coloured.
 *
 * A NUMBER, not a CSS string, because `THREE.Color` and a `<span>` want different types and the values must not be able
 * to drift; `#hexOf` renders the CSS side from the same token. The mapping state→role is the design: a solved waypoint
 * is the success colour, the pending one is "the next thing", and a locked one is danger only in the sense that it
 * cannot be reached yet.
 */
export const OUTLINE_COLOR: Record<WaypointState, number> = {
  solved: hexOf(COLOR.ok),
  next: hexOf(COLOR.next),
  locked: hexOf(COLOR.bad),
};

/** `#rrggbb` (or an `rgba(...)`) as the number a `THREE.Color` takes. Only `#rrggbb` is a number; anything else refuses. */
export function hexOf(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) throw new Error(`theme: ${color} is not a #rrggbb colour, so it has no numeric form`);
  return parseInt(match[1], 16);
}

/**
 * Every token, as custom properties, in the one shape `applyTheme` writes. Derived from the tables above so a new token
 * cannot be added to this list and forgotten in the stylesheet, or the other way round: the probe compares the two.
 */
export const CSS_VARS: Readonly<Record<string, string>> = {
  '--bg': COLOR.bg,
  '--panel-bg': COLOR.panel,
  '--surface': COLOR.surface,
  '--control': COLOR.control,
  '--raised': COLOR.raised,
  '--pressed': COLOR.pressed,
  '--field': COLOR.field,
  '--ink': COLOR.ink,
  '--dim': COLOR.dim,
  '--ok': COLOR.ok,
  '--bad': COLOR.bad,
  '--accent': COLOR.accent,
  '--next': COLOR.next,
  '--line': COLOR.line,
  '--line-soft': COLOR.lineSoft,
  '--line-strong': COLOR.lineStrong,
  '--line-ghost': COLOR.lineGhost,
  '--done-passed': COLOR.donePassed,
  '--done-passed-line': COLOR.donePassedLine,
  '--done-skipped': COLOR.doneSkipped,
  '--done-skipped-hover': COLOR.doneSkippedHover,
  '--ink-faint': COLOR.inkFaint,
  '--ink-soft': COLOR.inkSoft,
  '--accent-ghost': COLOR.accentGhost,
  '--accent-soft': COLOR.accentSoft,
  '--shadow-text': COLOR.shadowText,
  '--r-cell': RADIUS.cell,
  '--r-field': RADIUS.field,
  '--r-control': RADIUS.control,
  '--r-card': RADIUS.card,
  '--r-pill': RADIUS.pill,
  '--t-press': MOTION.press,
  '--t-enter': MOTION.enter,
  '--t-slide': MOTION.slide,
  '--t-celebrate': MOTION.celebrate,
  '--t-spin': MOTION.spin,
  '--ease': MOTION.ease,
  '--wp-solved': `#${OUTLINE_COLOR.solved.toString(16).padStart(6, '0')}`,
  '--wp-next': `#${OUTLINE_COLOR.next.toString(16).padStart(6, '0')}`,
  '--wp-locked': `#${OUTLINE_COLOR.locked.toString(16).padStart(6, '0')}`,
};

/** Anything with the one method this needs, so a probe can pass a stub instead of an element. */
export interface StyleTarget {
  style: { setProperty(name: string, value: string): void };
}

/**
 * Write every token onto an element's inline style — `document.documentElement` at boot, a stub in a probe.
 *
 * INLINE RATHER THAN A STYLESHEET because the values are the app's own; a generated `<style>` element would need its
 * own insert/update story and would be a second place the cascade could be edited from.
 */
export function applyTheme(root: StyleTarget = document.documentElement): void {
  for (const [name, value] of Object.entries(CSS_VARS)) root.style.setProperty(name, value);
}
