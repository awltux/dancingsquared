// THE BOOK'S BOARD STYLE: the palette, the marker size, and WHICH COLOUR a dancer is drawn in.
//
// WHY THIS MODULE EXISTS. The book draws the same board in two places - `book/assets/player.js` on a canvas in
// the reader's browser, and the Node tools (`book/tools/lib/raster.mjs`'s indexed-colour surface, driven by
// `make-animations.mjs` and `make-formations.mjs`) for the PNG and GIF figures - and the STYLE was stated twice:
// the same sixteen colours as `#rrggbb` strings in one file and as RGB triples in the other, and the same
// `MARKER_UNITS = 0.48` with the same measurement beside it. Two copies of a rule is a defect even when both
// work (AGENTS.md §11.4.4): the first one corrected is the one nobody is looking at, and the picture on the page
// and the picture in the figure would then disagree with nothing to catch it.
//
// IT IS DELIBERATELY NOT `dancing-squared-stage`. That package's `scene.ts` is the shared THREE.js renderer for
// the POC and the game, and it is the wrong tool here for two measured reasons: it is exported as TypeScript
// SOURCE with no build (so the book, which ships plain ES modules and copies the engine's compiled `dist` into
// `lib/`, cannot load it), and it draws avatars in a lit 3D scene - `three.module.js` alone is 1,304,820 bytes,
// against a 5.1 MB offline edition whose pages are print-like. Nor are the stage's two pure modules a fit:
// `grid-magnet.ts` is the EDITOR's snap rule (the book has no dragging), and `display-couple.ts` answers WHICH
// COUPLE a dancer is drawn as, where this book draws an anonymous dancer by GENDER - a different question with a
// different answer. What the two renderers genuinely share is the palette and the marker, and that is here.
//
// THE PALETTE IS THE BOOK'S LIGHT ONE, not the POC's dark one: those colours are tuned for a lit 3D scene, and on
// a page of white HTML the same board in the same colours as the SVG figures is what makes an animation look like
// it belongs to the chapter it illustrates.
//
// THE MODULE IS ENVIRONMENT-FREE: no DOM, no `three`, no `fs`. That is what lets the browser and the Node
// rasteriser import the same file.
//
// 0 floor, 1 grid minor, 2 grid major, 3 axes, 4-7 the four couples, 8-9 an anonymous boy and girl, 10 ink,
// 11 white, 12-15 the couples' trails, 16 muted (a dancer the figure is not asking about - the grey the annotated
// position diagrams use for the couples they are not asking about).
export const PALETTE = [
  [0xf7, 0xf9, 0xfa], // 0  floor
  [0xe4, 0xe9, 0xec], // 1  grid, minor
  [0xcd, 0xd6, 0xdb], // 2  grid, major
  [0x9f, 0xad, 0xb5], // 3  axes
  [0xb2, 0x18, 0x2b], // 4  couple 1
  [0x21, 0x66, 0xac], // 5  couple 2
  [0x1b, 0x78, 0x37], // 6  couple 3
  [0x8c, 0x6d, 0x1f], // 7  couple 4
  [0x1f, 0x6f, 0x8b], // 8  anonymous boy
  [0x8a, 0x3f, 0x6b], // 9  anonymous girl
  [0x22, 0x30, 0x3a], // 10 ink
  [0xff, 0xff, 0xff], // 11 white
  [0xea, 0xc2, 0xc8], // 12 trail, couple 1
  [0xb8, 0xd0, 0xe2], // 13 trail, couple 2
  [0xba, 0xd9, 0xc0], // 14 trail, couple 3
  [0xde, 0xd2, 0xac], // 15 trail, couple 4
  [0xc3, 0xcc, 0xd2], // 16 muted
];

export const C = {
  floor: 0,
  gridMinor: 1,
  gridMajor: 2,
  axis: 3,
  boy: 8,
  girl: 9,
  ink: 10,
  white: 11,
  muted: 16,
  trail: { 1: 12, 2: 13, 3: 14, 4: 15 },
  couple: { 1: 4, 2: 5, 3: 6, 4: 7 },
};

/**
 * Marker width: ONE GRID SQUARE of the board, which is the unit the background grid measures.
 *
 * A FIXED PIXEL RADIUS WAS WRONG TWICE OVER. The board puts dancers two units apart in a squared set, an ocean
 * wave or a column - but only ONE unit apart in a tidal wave, a promenade and a couple, and transiently closer
 * than that whenever two dancers pass (Dosado reaches 1.0 units, Star Thru 0.9). And because a call that travels
 * far is fitted to a wider floor, a fixed radius grew relative to the dancers exactly when the view zoomed out: at
 * radius 21 px a call fitted to 9.5 units drew markers 2.5 squares wide, which is the overlap that could be seen
 * in the waves.
 *
 * Sizing it in units fixes both: the marker is a square of floor, and it shrinks with the zoom instead of
 * swallowing its neighbours. A hair under a full square, so the tightest spacing in the program - a tidal wave's
 * one unit - still reads as two dancers rather than one blob.
 */
export const MARKER_UNITS = 0.48;

/** A palette entry as the CSS colour the canvas wants. */
export function hexOf(index) {
  const [r, g, b] = PALETTE[index] ?? PALETTE[0];
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * WHICH COLOUR a dancer's body is drawn in: its home couple where the board has one, and otherwise its gender.
 *
 * THE GENDER FALLBACK IS THE BOOK'S, NOT THE STAGE'S. `display-couple.ts` answers a pair number for a board with
 * no home identity, which is right for an app you are reading couple numbers off. A teaching page is not: on a
 * board the engine cannot name couples for, "this one is a boy" is the fact the page is about, so that is what
 * the colour says.
 */
export function bodySlot(d) {
  if (d.couple && C.couple[d.couple]) return C.couple[d.couple];
  return d.gender === 'girl' ? C.girl : C.boy;
}

/** The trail a dancer leaves: its couple's trail where it has one, the axis colour otherwise. */
export function trailSlot(d) {
  if (d.couple && C.trail[d.couple]) return C.trail[d.couple];
  return C.axis;
}
