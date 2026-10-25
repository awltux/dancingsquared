// Small formation diagrams, drawn from the ENGINE's own formation library.
//
//   node book/tools/make-formations.mjs [--check]
//
// WHERE THE GEOMETRY COMES FROM. `formations.xml` is the engine's named-formation library -- 273
// formations, each carrying `{gender, x, y, angleDeg}`. Nothing here is hand-drawn; the pictures are
// the data.
//
// THE LIBRARY WRITES HALF A SET. This is the documented rule (`square-dancing.md` §7.1.1): a
// formation writes the dancers plus the same dancers turned 180 degrees about the origin, unless it
// already contains both halves. `Squared Set` is written as four dancers and `Wave RH` as two, so
// each is completed here by the same rotation the engine uses -- measured by looking for an
// antipode, not assumed.
//
// NO COUPLE COLOURS AND NO HANDHOLDS. The library carries neither couple numbers nor hand states,
// and inventing either is exactly what this codebase refuses to do. Dancers are drawn by GENDER,
// which the data does have.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolsDir, readAsset, loadEngine } from './lib/load.mjs';
import { Canvas, writePng } from './lib/raster.mjs';
// THE MARKER'S SIZE IS `board-style.mjs`'s, not this file's: this tool declared its own `R_UNITS = 0.48` - the same
// number under a second name - while the module that owns the style exported `MARKER_UNITS`. One owner, imported
// (R8's census, `engine/test/tolerances.mjs`).
import { PALETTE, C, MARKER_UNITS } from './lib/board-style.mjs';
import { completeSet, couples } from './lib/squared-set.mjs';

const OUT_DIR = join(toolsDir, '..', 'formations');
const CACHE = join(toolsDir, '.cache', 'formations');
const INDEX = join(toolsDir, 'formations-index.json');

const SIZE = 200;
/**
 * Marker half-width in BOARD UNITS -- one grid square of the floor, the unit the drawn grid
 * measures. A fixed pixel radius overlapped the dancers wherever the library puts them one unit
 * apart: a tidal wave (`.5` apart in y), a promenade and a bare couple all do, and at the widest
 * fit a 13px radius was 1.3 squares across. A hair under a full square keeps two dancers at that
 * spacing reading as two dancers.
 */
const CENTRE = SIZE / 2;
// THE ENGINE OWNS THE UNIT, so it is BOUND here rather than declared: `core.ts` defines `DEG` and `index.ts`
// re-exports it, and this tool already loads the engine for every other engine answer it draws. MEASURED before the
// change: this file carried its own `const DEG = Math.PI / 180` — a third spelling of a constant the engine exports
// (the other two were `core.ts:8` and `formation-order.ts:57`), kept alive by nothing but having been written first.
// It cannot `import` the CJS `dist` directly, so it goes through `loadEngine()`, whose export-surface assertion is
// what makes the binding safe; `build()` calls the same loader again and Node answers it from cache.
const DEG = loadEngine().DEG;

// THE TOLERANCES THIS TOOL MEASURES WITH, named so a reader can tell the four rules apart. They are the BOOK's, not
// the engine's: each decides whether a drawn arrangement is the shape the prose describes, and nothing here feeds a
// call's legality, so they are pinned by the diagrams `check:book` re-draws rather than by `DEFAULT_MATCH_MAX`.
//
// 0.05 APPEARS TWICE ON PURPOSE, under two names: as a POSITION tolerance (two dancers on the same spot) and as a
// FRACTION OF A RADIUS (how far a ring's markers sit inside the ring). They are the same number and different rules -
// the R8 census's lesson - so merging them would tie a drawing inset to a geometry threshold.
const POSITION_TOL = 0.01;
const SAME_SPOT_TOL = 0.05;
const INSET_FRACTION = 0.05;
// `cos(0) = 1` and `cos(PI) = -1`, and 1e-6 is "the two facings are the same direction, to floating point".
const FACING_COS_TOL = 1e-6;

/**
 * The formations the book's formation page defines, matched to the library's own names.
 *
 * `as` is the name in `formations.xml`. Some concepts the page describes are NOT in the library --
 * "Facing Dancers" and a bare "Couple" among them -- and they are listed with `as: null` so the
 * index can say so instead of the page quietly going without.
 */
export const FORMATIONS = [
  { slug: 'squared-set', title: 'Squared Set', as: 'Squared Set' },
  {
    slug: 'circle',
    title: 'Circle',
    as: 'Circle',
    /**
     * The manual's name for this is an "Infacing Circle of 8", and the page calls it "a ring of
     * dancers all facing the centre". Both halves of that are measured: one radius for all eight (a
     * ring, not a lumpy blob), and every nose pointing at the middle (which is the word "infacing",
     * and is the one a reader is most likely to get wrong -- the Alamo is the same ring with the
     * dancers facing alternate ways).
     */
    assert: (dancers) => {
      const radii = dancers.map((d) => Math.hypot(d.x, d.y));
      if (Math.max(...radii) - Math.min(...radii) > POSITION_TOL) {
        throw new Error(`the library's Circle is not a ring: radii ${radii.join(', ')}`);
      }
      for (const d of dancers) {
        const inward = (Math.cos(d.angleDeg * DEG) * -d.x + Math.sin(d.angleDeg * DEG) * -d.y) / Math.hypot(d.x, d.y);
        if (inward < 0.999) {
          throw new Error(`the dancer at (${d.x}, ${d.y}) faces ${d.angleDeg}, which is not the centre of the Circle`);
        }
      }
    },
  },
  // No separate diagram for a Static Square: it is the same geometry as the Squared Set, and the
  // page already says the difference between them is sequence, not shape. Two identical pictures
  // either side of that sentence would argue the opposite.
  { slug: 'facing-couples', title: 'Facing Couples', as: 'Facing Couples' },
  {
    slug: 'facing-dancers',
    title: 'Facing Dancers',
    derivedFrom: 'one dancer from each side of the library\'s "Facing Couples"',
    /**
     * NOT A NAMED FORMATION in `formations.xml` -- the manual draws it in its pictograms and the library
     * has no entry -- so it is TAKEN FROM ONE THAT IS NAMED rather than hand-placed. The page singles out
     * "a Boy facing a Girl" for Star Thru, so that is the pair drawn, and the two things a facing pair
     * must be are asserted: facing each other, and on the same line.
     */
    from: (lib) => {
      const written = lib.get('Facing Couples');
      if (!written?.length) throw new Error('the library has no "Facing Couples" to take a facing pair from');
      const { dancers } = completeSet(written);
      const boy = dancers.find((d) => d.gender === 'boy');
      const girl = boy ? facingPartner(boy, dancers) : null;
      // The page singles out "a Boy facing a Girl" for Star Thru, and the library's Facing Couples
      // holds exactly that: each dancer stares at a dancer of the other gender. Both halves are
      // asserted, so a library change that paired a Boy with a Boy would fail the build here.
      if (!girl) throw new Error('nobody stares back at the first Boy in the library\'s Facing Couples');
      if (girl.gender !== 'girl') throw new Error(`the dancer facing the first Boy is a ${girl.gender}, not a Girl`);
      return [boy, girl];
    },
  },
  {
    slug: 'couple',
    title: 'Couple',
    derivedFrom: 'the south couple of the library\'s "Squared Set", numbered by the manual\'s rule',
    /**
     * Also not a named formation in the library. A couple is "two adjacent dancers facing the same way",
     * and the library's Squared Set contains four of them: this takes the one the manual calls Couple 1.
     * `couples()` has already asserted that its Boy is the dancer on the couple's own left, against the
     * gender the library records; the two remaining properties are checked here.
     */
    from: () => {
      const south = couples().find((c) => c.couple === 1);
      if (!south) throw new Error('couples() gave no Couple 1');
      const pair = [south.boy, south.girl].map((d) => ({
        gender: d.gender,
        x: d.x,
        y: d.y,
        angleDeg: d.angleDeg,
      }));
      if (Math.abs(pair[0].y - pair[1].y) > POSITION_TOL || Math.abs(Math.abs(pair[0].x - pair[1].x) - 2) > POSITION_TOL) {
        throw new Error('the couple taken from the Squared Set is not two dancers side by side');
      }
      if (pair[0].angleDeg !== pair[1].angleDeg) throw new Error('the couple does not share a facing');
      return pair;
    },
  },
  {
    slug: 'eight-chain-thru',
    title: 'Eight Chain Thru',
    as: 'Eight Chain Thru',
    /**
     * The page's sentence is that in an Eight Chain Thru "each dancer looks at a dancer of the
     * opposite role -- Boys at Girls -- instead of at their opposite number". That is a statement
     * about the pairing, so it is measured: every dancer has somebody staring back, and that somebody
     * is always the other gender. The library holds four such pairs, which is what makes it two
     * facing couples and not some other arrangement of eight.
     */
    assert: (dancers) => {
      const pairs = new Map();
      for (const d of dancers) {
        const other = facingPartner(d, dancers);
        if (!other) throw new Error(`the dancer at (${d.x}, ${d.y}) faces nobody in the library's Eight Chain Thru`);
        if (other.gender === d.gender) {
          throw new Error(`the library's Eight Chain Thru has a ${d.gender} looking at a ${other.gender}`);
        }
        pairs.set([d, other].map((p) => `${p.x},${p.y}`).sort().join('|'), true);
      }
      if (pairs.size !== dancers.length / 2) {
        throw new Error(`the library's Eight Chain Thru has ${pairs.size} facing pairs, not ${dancers.length / 2}`);
      }
    },
  },
  {
    slug: 'tandem',
    title: 'Tandem',
    derivedFrom: 'one of the tandems the library\'s "Double Pass Thru" is made of',
    /**
     * A Tandem is not a named formation in the library either. It is not hand-placed: the manual says
     * the eight-dancer Double Pass Thru IS two side-by-side Facing Tandems, so a tandem is already in
     * that data, and `tandemBehind` measures one out -- same facing, two units back, which is single
     * file rather than side by side. The pair taken is same-gender, because a Boy with a Girl in
     * single file is the Tandem Couple the page's next paragraph is about.
     */
    from: (lib) => {
      const written = lib.get('Double Pass Thru');
      if (!written?.length) throw new Error('the library has no "Double Pass Thru" to take a Tandem from');
      const { dancers } = completeSet(written);
      for (const front of dancers) {
        const back = tandemBehind(front, dancers);
        if (back && back.gender === front.gender) return [front, back];
      }
      throw new Error('no same-gender pair in the library\'s Double Pass Thru stand one behind the other');
    },
  },
  {
    slug: 'back-to-back-couples',
    title: 'Back-to-Back Couples',
    derivedFrom: 'the two middle couples of the library\'s "Completed Double Pass Thru"',
    /**
     * Not a named formation in the library, but a named SHAPE in the manual: from a Two-Faced Line a
     * Veer Left or Veer Right finishes "in Back-to-Back Couples", and a Lead Right from Facing Couples
     * ends there too -- two couples that have turned away from each other.
     *
     * The Completed Double Pass Thru holds four couples, and the two middle ones ARE that shape, so
     * this measures them out rather than inventing anything: `beside` pairs each dancer with the
     * dancer alongside (a couple), and the pair taken is the two couples facing opposite ways whose
     * backs are to each other -- the CLOSEST such pair, because the outer couple of that formation is
     * also back to back with the far one, twice as far away, and is not what the page means.
     */
    from: (lib) => {
      const written = lib.get('Completed Double Pass Thru');
      if (!written?.length) {
        throw new Error('the library has no "Completed Double Pass Thru" to take Back-to-Back Couples from');
      }
      const { dancers } = completeSet(written);
      const couples = [];
      for (const d of dancers) {
        const mate = beside(d, dancers);
        if (!mate || couples.some((c) => c.people.includes(d))) continue;
        couples.push({ people: [d, mate], x: (d.x + mate.x) / 2, y: (d.y + mate.y) / 2, facing: d.angleDeg });
      }
      if (couples.length !== dancers.length / 2) {
        throw new Error(
          `the library's Completed Double Pass Thru does not pair up into couples: ${couples.length} found, ${dancers.length / 2} expected`,
        );
      }
      let best = null;
      for (const a of couples) {
        for (const b of couples) {
          if (a === b || !oppositeFacing(a.facing, b.facing)) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          // Back to back means each couple faces AWAY from the other: the line joining the two
          // couples runs opposite to the way they are looking.
          const away = (dx * Math.cos(a.facing * DEG) + dy * Math.sin(a.facing * DEG)) / dist;
          if (away > -0.99) continue;
          if (!best || dist < best.dist) best = { dist, people: [...a.people, ...b.people] };
        }
      }
      if (!best) {
        throw new Error('no two couples in the library\'s Completed Double Pass Thru stand back to back');
      }
      return best.people;
    },
  },
  {
    slug: 'double-pass-thru',
    title: 'Double Pass Thru',
    as: 'Double Pass Thru',
    /**
     * The manual's own words for the eight-dancer formation are "two side-by-side Facing Tandems", so
     * that is what is checked: four tandems (every dancer with somebody in single file behind or in
     * front), and each tandem's front dancer looking at another tandem's front dancer -- two facing
     * pairs of tandems, side by side.
     */
    assert: (dancers) => {
      const tandems = dancers.map((d) => ({ front: d, back: tandemBehind(d, dancers) })).filter((t) => t.back);
      if (tandems.length !== dancers.length / 2) {
        throw new Error(`the library's Double Pass Thru holds ${tandems.length} tandems, not ${dancers.length / 2}`);
      }
      for (const t of tandems) {
        const other = facingPartner(t.front, dancers);
        if (!other || !tandems.some((o) => o.front === other)) {
          throw new Error(`the tandem led by the dancer at (${t.front.x}, ${t.front.y}) does not face another tandem`);
        }
      }
    },
  },
  {
    slug: 'completed-double-pass-thru',
    title: 'Completed Double Pass Thru',
    as: 'Completed Double Pass Thru',
    // The same four tandems, and the one difference that gives the formation its name: they are back to
    // back, so no front dancer has anybody staring back at them at all.
    assert: (dancers) => {
      const tandems = dancers.map((d) => ({ front: d, back: tandemBehind(d, dancers) })).filter((t) => t.back);
      if (tandems.length !== dancers.length / 2) {
        throw new Error(`the library's Completed Double Pass Thru holds ${tandems.length} tandems, not ${dancers.length / 2}`);
      }
      for (const t of tandems) {
        if (facingPartner(t.front, dancers)) {
          throw new Error(`the tandem led by the dancer at (${t.front.x}, ${t.front.y}) faces another tandem, so it is not back to back`);
        }
      }
    },
  },
  { slug: 'normal-lines', title: 'Normal Lines', as: 'Normal Lines' },
  { slug: 'lines-facing-out', title: 'Lines Facing Out', as: 'Lines Facing Out' },
  { slug: 'inverted-lines', title: 'Inverted Lines', as: 'Inverted Lines Ends Facing Out' },
  { slug: 'two-faced-lines', title: 'Two-Faced Lines', as: 'Two-Faced Lines' },
  { slug: 'tidal-wave', title: 'Tidal Wave', as: 'Tidal Wave' },
  // A mini-wave is illustrated as the two-dancer unit it is. Completing the library's written pair
  // by rotation would draw FOUR dancers -- two parallel mini-waves -- which is the right answer to
  // "what is the rest of the set" and the wrong answer to "what is a mini-wave".
  { slug: 'mini-wave', title: 'Mini-Wave (right-hand)', as: 'Wave RH', noMirror: true },
  { slug: 'ocean-wave', title: 'Ocean Wave (right-hand)', as: 'Ocean Waves RH BGGB' },
  { slug: 'column', title: 'Column', as: 'Column RH GBGB' },
  { slug: 'box', title: 'Box', as: 'Box RH' },
  { slug: 'diamond', title: 'Diamond', as: 'Diamond RH' },
  { slug: 'alamo', title: 'Alamo Style', as: 'Alamo Wave' },
  { slug: 'thar', title: 'Thar', as: 'Thar RH Boys' },
  { slug: 'quarter-tag', title: 'Quarter Tag', as: 'Quarter Tag' },
  { slug: 'three-quarter-tag', title: '3/4 Tag', as: '3/4 Tag' },
  { slug: 'promenade', title: 'Promenade', as: 'Promenade' },
];

const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const sameSpot = (a, b) => Math.abs(a.x - b.x) < SAME_SPOT_TOL && Math.abs(a.y - b.y) < SAME_SPOT_TOL;
const sameFacing = (a, b) => Math.abs(Math.cos((a - b) * DEG) - 1) < FACING_COS_TOL;
const oppositeFacing = (a, b) => Math.abs(Math.cos((a - b) * DEG) + 1) < FACING_COS_TOL;

/**
 * THE TWO-DANCER MEASURES. A facing pair and a tandem are the two ways two dancers line up, and both
 * are used twice: to take a figure out of the library that has no entry of its own, and to check the
 * structure of a figure that has one. They measure, so they can be wrong out loud.
 *
 * `facingPartner` is "the dancer staring back at me": the nearest dancer on the ray I face, on the
 * line I am on, facing the other way. It does not insist on a distance, because the library spaces
 * facing couples four units apart and an Eight Chain Thru two, and both are still a facing pair.
 *
 * `tandemBehind` is "the dancer whose nose is in my back": same facing, two units behind me. This one
 * DOES insist on the two units, because that spacing is what makes it single file rather than a
 * couple standing side by side.
 */
function facingPartner(d, dancers) {
  const dx = Math.cos(d.angleDeg * DEG);
  const dy = Math.sin(d.angleDeg * DEG);
  let best = null;
  for (const o of dancers) {
    if (o === d) continue;
    const ax = o.x - d.x;
    const ay = o.y - d.y;
    const ahead = ax * dx + ay * dy;
    const across = Math.abs(ax * -dy + ay * dx);
    if (ahead <= 0 || across > POSITION_TOL || !oppositeFacing(o.angleDeg, d.angleDeg)) continue;
    if (!best || ahead < best.ahead) best = { dancer: o, ahead };
  }
  return best?.dancer ?? null;
}

function tandemBehind(d, dancers) {
  const dx = Math.cos(d.angleDeg * DEG);
  const dy = Math.sin(d.angleDeg * DEG);
  return (
    dancers.find(
      (o) =>
        o !== d &&
        sameFacing(o.angleDeg, d.angleDeg) &&
        Math.abs(o.x - (d.x - 2 * dx)) < POSITION_TOL &&
        Math.abs(o.y - (d.y - 2 * dy)) < POSITION_TOL,
    ) ?? null
  );
}

/**
 * The third two-dancer measure: "the dancer beside me" -- same facing, nothing along the facing
 * between us, two units across it. That is a COUPLE, and it is how a formation built out of couples
 * (rather than out of tandems) can be taken apart to see which couples are in it.
 */
function beside(d, dancers) {
  const dx = Math.cos(d.angleDeg * DEG);
  const dy = Math.sin(d.angleDeg * DEG);
  const found = dancers.find(
    (o) =>
      o !== d &&
      sameFacing(o.angleDeg, d.angleDeg) &&
      Math.abs((o.x - d.x) * dx + (o.y - d.y) * dy) < POSITION_TOL &&
      Math.abs(Math.abs((o.x - d.x) * -dy + (o.y - d.y) * dx) - 2) < POSITION_TOL,
  );
  return found ?? null;
}

/** The floor every diagram stands on: pale ground, a one-unit grid, and the two centre lines. */
function drawFloor(canvas, view, bounds = null) {
  const px = (v) => view.ox + v * view.scale;
  const py = (v) => view.oy - v * view.scale;

  // A PANEL IS A RECTANGLE OF THE CANVAS. Every figure in this family is one square to a canvas, so
  // with no bounds this draws the whole of it -- byte for byte as it always has. The panel form is
  // for the one figure that is six squares at once (the arrangements of a squared set): there the
  // floor, the grid and the axes must stop at the panel's edge instead of running across its
  // neighbours.
  const x0 = bounds ? bounds.x : 0;
  const y0 = bounds ? bounds.y : 0;
  const x1 = bounds ? bounds.x + bounds.w : canvas.width;
  const y1 = bounds ? bounds.y + bounds.h : canvas.height;

  canvas.fillRect(x0, y0, x1 - x0, y1 - y0, C.floor);
  const n = Math.ceil(view.units) + 1;
  for (let i = -n; i <= n; i++) {
    if (i === 0) continue;
    const colour = i % 2 === 0 ? C.gridMajor : C.gridMinor;
    if (px(i) >= x0 && px(i) <= x1) canvas.strokeLine(px(i), y0, px(i), y1, 1, colour);
    if (py(i) >= y0 && py(i) <= y1) canvas.strokeLine(x0, py(i), x1, py(i), 1, colour);
  }
  if (px(0) >= x0 && px(0) <= x1) canvas.strokeLine(px(0), y0, px(0), y1, 1, C.axis);
  if (py(0) >= y0 && py(0) <= y1) canvas.strokeLine(x0, py(0), x1, py(0), 1, C.axis);
}

function draw(canvas, dancers, view, bounds = null) {
  const px = (v) => view.ox + v * view.scale;
  const py = (v) => view.oy - v * view.scale;

  drawFloor(canvas, view, bounds);
  
  const r = MARKER_UNITS * view.scale;
  const ink = Math.max(1, Math.min(1.2, r / 11));
  const inset = Math.max(1, r * INSET_FRACTION);

  // EVERY FACING NOSE FIRST, THEN EVERY BODY -- the same two passes the player uses. Drawn per
  // dancer, a nose is painted after the previous dancer's body and lands on top of it wherever two
  // dancers sit close, which reads as stabbing. Noses first means an intruding nose is covered by the
  // body it intrudes on.
  //
  // INK rather than the dancer's colour: a same-coloured bump on a coloured body on a pale floor
  // cannot be read at a glance, and white would be worse, since the part that shows is the part over
  // the floor.
  for (const d of dancers) {
    const cx = px(d.x);
    const cy = py(d.y);
    const h = (d.angleDeg ?? 0) * DEG;
    const hx = Math.cos(h);
    const hy = -Math.sin(h);
    canvas.fillPolygon(
      [
        [cx + hx * (r * 1.6), cy + hy * (r * 1.6)],
        [cx + hx * (r * 0.85) - hy * (r * 0.5), cy + hy * (r * 0.85) + hx * (r * 0.5)],
        [cx + hx * (r * 0.85) + hy * (r * 0.5), cy + hy * (r * 0.85) - hx * (r * 0.5)],
      ],
      C.ink,
    );
  }

  for (const d of dancers) {
    const cx = px(d.x);
    const cy = py(d.y);
    const colour = d.gender === 'girl' ? 9 : 8;
    if (d.gender === 'girl') {
      canvas.fillCircle(cx, cy, r, colour);
      canvas.strokeCircle(cx, cy, r, ink, C.ink);
    } else {
      // The square turns with the dancer -- see Canvas.squareCorners. A circle has no orientation,
      // so only the Boy's marker changes. NOTE the property: a formation dancer carries `angleDeg`
      // (degrees), where an animation POSE carries `heading` (radians). Passing the wrong one gave
      // every square a zero rotation and looked like the fix had not worked.
      canvas.orientedSquare(cx, cy, r - inset, (d.angleDeg ?? 0) * DEG, { colour, outline: C.ink, width: ink });
    }
  }
}

/** Fit the view to the formation, with the same clamp the animations use. `also` are points that
 *  must be in shot without being dancers -- the caller, in the Heads and Sides figure. */
function makeView(dancers, also = []) {
  let extent = 0;
  for (const d of [...dancers, ...also]) extent = Math.max(extent, Math.abs(d.x), Math.abs(d.y));
  const units = Math.max(3.2, Math.min(7, extent + 1.1));
  return { scale: (SIZE / 2 - 10) / units, ox: CENTRE, oy: CENTRE, units };
}

/**
 * AN ANNOTATED SQUARED SET: the figures in this family that are ABOUT some of the dancers rather than
 * about a shape. There are two of them -- Heads and Sides, and Partner and Corner -- and they are
 * drawn by this one function so they cannot drift apart.
 *
 * IT IS DRAWN LIKE EVERY OTHER DIAGRAM HERE -- same floor, same grid, same markers, same facing
 * wedges -- and picks dancers out with two devices the page's caption names:
 *
 *   * `fillOf(dancer)` returns the palette entry for a body. A dancer the figure is not asking about
 *     is drawn MUTED, the same grey the annotated position diagrams use, so the difference is one of
 *     WEIGHT and not only of hue: the figure still reads when printed in black and white. It is the
 *     one place in this family that colours by COUPLE, because `couples()` derives the couple and the
 *     number from the library and asserts them, where the other diagrams have only gender.
 *   * `ring` is a list of dancer NUMBERS to draw an ink ring around. The ring is what says "this one
 *     is YOU" when the dancer you are related to is in your own couple and therefore shares your
 *     colour. It is drawn at 1.9 marker radii, clear of the facing wedge (which reaches 1.6), so the
 *     ring never crosses the mark that shows which way the dancer faces.
 *
 * NO NUMBERS, deliberately: no other diagram in this family carries them, and both pages name their
 * dancers in words. The numbering has its own picture - `make-diagrams.mjs`'s `couple-numbers.svg`.
 */
function drawAnnotated(canvas, people, view, { fillOf, ring = [], caller = null }) {
  const px = (v) => view.ox + v * view.scale;
  const py = (v) => view.oy - v * view.scale;

  drawFloor(canvas, view);

  const r = MARKER_UNITS * view.scale;
  const ink = Math.max(1, Math.min(1.2, r / 11));
  const inset = Math.max(1, r * INSET_FRACTION);

  // Noses first, then bodies -- the same two passes the player uses, so a nose can never be painted
  // over the body it is passing.
  for (const d of people) {
    const cx = px(d.x);
    const cy = py(d.y);
    const h = (d.angleDeg ?? 0) * DEG;
    const hx = Math.cos(h);
    const hy = -Math.sin(h);
    canvas.fillPolygon(
      [
        [cx + hx * (r * 1.6), cy + hy * (r * 1.6)],
        [cx + hx * (r * 0.85) - hy * (r * 0.5), cy + hy * (r * 0.85) + hx * (r * 0.5)],
        [cx + hx * (r * 0.85) + hy * (r * 0.5), cy + hy * (r * 0.85) - hx * (r * 0.5)],
      ],
      C.ink,
    );
  }

  for (const d of people) {
    const cx = px(d.x);
    const cy = py(d.y);
    const colour = fillOf(d);
    if (d.gender === 'girl') {
      canvas.fillCircle(cx, cy, r, colour);
      canvas.strokeCircle(cx, cy, r, ink, C.ink);
    } else {
      canvas.orientedSquare(cx, cy, r - inset, (d.angleDeg ?? 0) * DEG, { colour, outline: C.ink, width: ink });
    }
  }

  for (const n of ring) {
    const d = people.find((p) => p.number === n);
    if (!d) throw new Error(`no dancer numbered ${n} to ring`);
    canvas.strokeCircle(px(d.x), py(d.y), r * 1.9, Math.max(1, r * 0.16), C.ink);
  }

  if (caller) {
    // The caller, at the south and outside the set: a solid arrowhead pointing north, at the square.
    const cx = px(caller.x);
    const cy = py(caller.y);
    const w = r * 1.15;
    const h = r * 1.5;
    canvas.fillPolygon(
      [
        [cx, cy - h],
        [cx - w, cy + h * 0.55],
        [cx + w, cy + h * 0.55],
      ],
      C.ink,
    );
  }
}

/**
 * THE SIX ARRANGEMENTS OF A SQUARED SET -- the one figure here that is more than one square.
 *
 * WHERE THE SIX PATTERNS COME FROM. Not from this file and not from a transcription: the engine's own
 * `ARRANGEMENT_TABLES.S` is the table `arrangementFor()` classifies a board against, and it is the
 * thing that says which of the six numbers a squared set is in. The table is four rows of four columns
 * with a hole at the middle of every row and column (a squared set is a ring), so a cell becomes a
 * dancer at `x = -3 + 2*column`, `y = 3 - 2*row`, facing the way the cell's facing character says.
 *
 * THAT MAPPING IS THE ONE THING THAT COULD BE WRONG, SO IT IS CHECKED rather than assumed: the engine's
 * arrangement 0 has to come out as the library's own "Squared Set", dancer for dancer. It does -- and
 * arrangement 0 is home, which is why a reader can recognise it.
 *
 * SIX, AND DISTINCT. Each of the six numbers is drawn, and no two of them may produce the same
 * pattern of genders round the ring: that is what makes "there are six arrangements of a squared set"
 * a measurement instead of a claim, and it is asserted before anything is drawn.
 *
 * ONE FIGURE, SIX PANELS. `draw` is the same function every other formation picture uses, called once
 * per panel with the panel's own view and bounds, so the panels are at the same scale and in the same
 * style as the single-square figures -- a reader can hold `squared-set.png` next to arrangement 0 and
 * see the same picture.
 */
function buildArrangements(eng, lib, files, index) {
  const table = eng.ARRANGEMENT_TABLES?.S;
  if (!table) throw new Error('engine/dist has no arrangement table for [S] (the squared set)');
  const numbers = [...eng.ARRANGEMENT_NUMBER_ORDER].sort((a, b) => a - b);
  if (numbers.join(',') !== '0,1,2,3,4,5') {
    throw new Error(`the engine's squared-set arrangements are numbered ${numbers.join(', ')}, not 0-5`);
  }

  const FACING = { '>': 0, '^': 90, '<': 180, v: 270 };
  const dancersFor = (number) => {
    const k = eng.ARRANGEMENT_NUMBER_ORDER.indexOf(number);
    if (k < 0) throw new Error(`the engine's squared-set table has no arrangement ${number} column`);
    const dancers = [];
    for (let r = 0; r < table.length; r++) {
      const genders = table[r].genders[k];
      const facing = table[r].facing;
      if (genders.length !== facing.length) {
        throw new Error(`[S] arrangement ${number} row ${r}: ${genders.length} genders for ${facing.length} columns`);
      }
      for (let c = 0; c < facing.length; c++) {
        const g = genders[c];
        const f = facing[c];
        if (g === eng.EMPTY_CELL || f === eng.EMPTY_CELL) continue;
        if (g !== 'B' && g !== 'g') throw new Error(`[S] arrangement ${number} row ${r}: unreadable gender "${g}"`);
        if (FACING[f] === undefined) throw new Error(`[S] arrangement ${number} row ${r}: unreadable facing "${f}"`);
        dancers.push({ gender: g === 'B' ? 'boy' : 'girl', x: -3 + 2 * c, y: 3 - 2 * r, angleDeg: FACING[f] });
      }
    }
    if (dancers.length !== 8) throw new Error(`[S] arrangement ${number} holds ${dancers.length} dancers, not 8`);
    return dancers;
  };

  const spotKey = (d) => `${d.gender}@${d.x},${d.y}`;
  const patternOf = (dancers) => dancers.map(spotKey).sort().join(' ');
  const home = patternOf(dancersFor(0));

  if (patternOf(completeSet(lib.get('Squared Set')).dancers) !== home) {
    throw new Error('the engine\'s arrangement 0 of [S] is not the library\'s own Squared Set');
  }

  const byPattern = new Map();
  for (const n of numbers) {
    const pattern = patternOf(dancersFor(n));
    if (byPattern.has(pattern)) {
      throw new Error(`[S] arrangements ${byPattern.get(pattern)} and ${n} are the same pattern, so there are not six`);
    }
    byPattern.set(pattern, n);
  }

  // A 3 x 2 grid of panels. PANEL is the size of a whole single-square figure, so each panel is drawn
  // at exactly the scale of the standalone squared set; the gap carries the canvas background and a
  // thin border, which is what keeps six squares from reading as one wide grid.
  const PANEL = SIZE;
  const GAP = 12;
  const PAD = 12;
  const COLS = 3;
  const canvas = new Canvas(PAD * 2 + COLS * PANEL + (COLS - 1) * GAP, PAD * 2 + 2 * PANEL + GAP, C.white);

  numbers.forEach((number, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (PANEL + GAP);
    const y = PAD + row * (PANEL + GAP);
    const bounds = { x, y, w: PANEL, h: PANEL };
    const dancers = dancersFor(number);
    const view = makeView(dancers);
    draw(canvas, dancers, { ...view, ox: x + PANEL / 2, oy: y + PANEL / 2 }, bounds);
    for (const [ax, ay, bx, by] of [
      [x, y, x + PANEL, y],
      [x + PANEL, y, x + PANEL, y + PANEL],
      [x + PANEL, y + PANEL, x, y + PANEL],
      [x, y + PANEL, x, y],
    ]) {
      canvas.strokeLine(ax, ay, bx, by, 1, C.gridMajor);
    }
    // The panel's own number, so a reader matches a square to the page without counting panels.
    canvas.digit(number, x + 8, y + 8, 4, C.ink);
  });

  files.set('arrangements.png', writePng(canvas, PALETTE));
  index.arrangements.push({
    source: 'engine arrangement table for [S] (All8 arrangement diagrams, 6 states)',
    drawn: numbers.length,
    // The pattern each panel shows, so the index says what was drawn and not only how many.
    panels: numbers.map((n) => ({ number: n, pattern: patternOf(dancersFor(n)) })),
    bytes: files.get('arrangements.png').length,
  });
  return numbers;
}

/**
 * THE FOUR SEQUENCE STATES OF A SQUARED SET -- 1 both in sequence, 2 both out, 3 the Boys in and the
 * Girls out, 4 the other way round.
 *
 * WHERE THE BOARDS COME FROM. The engine's own Sequencer stands a squared set up
 * (`boardForFormation('Static Square')`), and `boardsForAlignment` enumerates every board that is in
 * each sequence state at arrangement 0 -- 16 of them, which are the couple-relabelling variants. The
 * one drawn is the first in the engine's own enumeration, and it is asserted to really be in the
 * state it is drawn for: `sequenceFor` must read the code back, and `arrangementFor` must read 0, so
 * the figure cannot show a board the engine would not classify that way.
 *
 * SEQUENCE IS READ OFF COUPLE NUMBERS, so that is what each marker carries: callers go round the ring
 * counter-clockwise from the #1 Boy and note the couple numbers they meet. 1,2,3,4 means those dancers
 * are in sequence; 1,4,3,2 means they are out. The same reading is taken for the Girls from the #1
 * Girl, and the two answers make the code.
 *
 * THE HALF-AND-HALF STATES SEPARATE PARTNERS, AND THAT IS MEASURED, not asserted from theory: across
 * EVERY board in each state (not only the drawn one) states 1 and 2 put each dancer beside their
 * partner, and states 3 and 4 put nobody beside their partner. It is forced -- a girl standing beside
 * her own partner means the Girls' ring order follows the Boys', so the two states agree -- but the
 * figure is allowed to say so only because the enumeration was walked and counted.
 */
function buildSequences(eng, files, index) {
  const sequencer = new eng.Sequencer(readAsset('moves.xml'), readAsset('formations.xml'), []);
  const home = sequencer.boardForFormation('Static Square');
  if (!home) throw new Error('the engine stands up no board for "Static Square"');

  // The board's headings are radians and the library's are degrees; the rest is the same shape of
  // record the other figures are drawn from, so the same `draw` renders it.
  const asDancers = (board) =>
    board.dancers
      .filter((d) => !d.isGhost)
      .map((d) => ({ gender: d.gender, x: d.x, y: d.y, angleDeg: (d.heading * 180) / Math.PI, couple: d.couple }));

  const codes = [1, 2, 3, 4];
  const reading = {};
  const chosen = {};
  const withPartner = {};

  for (const code of codes) {
    const built = eng.boardsForAlignment(home, { letter: 'S', arrangement: 0, sequence: code });
    const boards = built.boards ?? [];
    if (!boards.length) throw new Error(`no squared-set board in sequence ${code} (${built.reason ?? 'no reason given'})`);

    // Every board in the state, walked for the partner claim below.
    withPartner[code] = boards.filter((b) => {
      const dancers = asDancers(b);
      return dancers.every((d) => beside(d, dancers)?.couple === d.couple);
    }).length;

    const board = boards[0];
    const read = eng.sequenceFor(board);
    if (read.code !== code) throw new Error(`the board drawn for sequence ${code} reads back as ${read.code}`);
    if (eng.arrangementFor(board, 'S').number !== 0) throw new Error(`the board drawn for sequence ${code} is not arrangement 0`);

    // TWO CLAIMS, BOTH MEASURED. When the two halves disagree (states 3 and 4), NO board in the state
    // can keep partners together: a girl beside her own partner makes the Girls' order follow the
    // Boys', so the two halves would agree. When they agree (states 1 and 2) partners may or may not
    // stand together -- only 4 of the 16 do -- so the figure draws one that does, which is the
    // familiar square with whole couples in the wrong places, and says so.
    if (code >= 3 && withPartner[code] !== 0) {
      throw new Error(`sequence ${code}: ${withPartner[code]} of ${boards.length} boards stand partners together, which cannot happen`);
    }
    if (code <= 2) {
      const dancers = asDancers(board);
      if (!dancers.every((d) => beside(d, dancers)?.couple === d.couple)) {
        throw new Error(`the board drawn for sequence ${code} does not keep whole couples together, so it is not the familiar case`);
      }
    }
    reading[code] = { boys: read.boys.join(''), girls: read.girls.join(''), boards: boards.length };
    chosen[code] = asDancers(board);
  }

  const PANEL = SIZE;
  const GAP = 12;
  const PAD = 12;
  const COLS = 2;
  const canvas = new Canvas(PAD * 2 + COLS * PANEL + GAP, PAD * 2 + 2 * PANEL + GAP, C.white);

  codes.forEach((code, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (PANEL + GAP);
    const y = PAD + row * (PANEL + GAP);
    const dancers = chosen[code];
    const view = makeView(dancers);
    const panelView = { ...view, ox: x + PANEL / 2, oy: y + PANEL / 2 };
    draw(canvas, dancers, panelView, { x, y, w: PANEL, h: PANEL });

    // The couple number each dancer is (their HOME couple), inside the marker: reading them round the
    // ring is the whole point of the figure, so they are drawn after the markers, in white, at the
    // same size the animation player uses.
    const r = MARKER_UNITS * view.scale;
    const s = Math.max(1, Math.min(8, Math.round(r * 0.21)));
    for (const d of dancers) {
      const cx = panelView.ox + d.x * view.scale;
      const cy = panelView.oy - d.y * view.scale;
      canvas.digit(d.couple, Math.round(cx - 1.5 * s), Math.round(cy - 2.5 * s), s, C.white);
    }

    for (const [ax, ay, bx, by] of [
      [x, y, x + PANEL, y],
      [x + PANEL, y, x + PANEL, y + PANEL],
      [x + PANEL, y + PANEL, x, y + PANEL],
      [x, y + PANEL, x, y],
    ]) {
      canvas.strokeLine(ax, ay, bx, by, 1, C.gridMajor);
    }
    canvas.digit(code, x + 8, y + 8, 4, C.ink);
  });

  files.set('sequences.png', writePng(canvas, PALETTE));
  index.sequences.push({
    source: 'engine boardsForAlignment over the Static Square template, arrangement 0',
    drawn: codes.length,
    panels: codes.map((code) => ({ code, ...reading[code], partnersTogether: withPartner[code] })),
    bytes: files.get('sequences.png').length,
  });
  return codes;
}

export function build() {
  const eng = loadEngine();
  const lib = eng.parseFormations(readAsset('formations.xml'));
  const files = new Map();
  const index = { drawn: [], notDrawn: [], arrangements: [], sequences: [] };

  // ------------------------------------------------- the two figures that pick dancers out
  // Everything they draw, they draw with the same floor, markers and ink as the rest of the family.
  const people = couples().flatMap((c) => [c.boy, c.girl]);
  // Two units south of the south couple's markers, so the arrowhead reads as standing outside the
  // square rather than as another dancer in it. The caller is at the south in both figures, which is
  // the convention every picture in this book uses; without her the Heads cannot be identified at
  // all, because "in line with her" is the whole definition.
  const caller = { x: 0, y: -4.7 };

  const headsAndSides = new Canvas(SIZE, SIZE, C.floor);
  drawAnnotated(headsAndSides, people, makeView(people, [caller]), {
    // Couples 1 and 3 face toward and away from the caller: the Heads.
    fillOf: (p) => (p.couple === 1 || p.couple === 3 ? C.couple[p.couple] : C.muted),
    caller,
  });
  files.set('heads-and-sides.png', writePng(headsAndSides, PALETTE));
  index.drawn.push({
    slug: 'heads-and-sides',
    title: 'Heads and Sides',
    libraryName: 'Squared Set (couple numbers from the manual, asserted against the library)',
    written: 4,
    drawn: people.length,
    mirrored: true,
    bytes: files.get('heads-and-sides.png').length,
  });

  const partnerAndCorner = new Canvas(SIZE, SIZE, C.floor);
  drawAnnotated(partnerAndCorner, people, makeView(people, [caller]), {
    // The #1 Boy is ringed -- he is the one the page is speaking to -- and the two dancers the caller
    // can name from him are drawn in colour: his Partner, who is the #2 beside him in his own couple,
    // and his Corner, who is the #8 round the nearest corner of the square. Everyone else is muted.
    // `couples()` has already asserted that the #1 is a Boy and the #2 the Girl beside him.
    fillOf: (p) => (p.number === 1 || p.number === 2 ? C.couple[1] : p.number === 8 ? C.couple[4] : C.muted),
    ring: [1],
    caller,
  });
  files.set('partner-and-corner.png', writePng(partnerAndCorner, PALETTE));
  index.drawn.push({
    slug: 'partner-and-corner',
    title: 'Partner and Corner',
    libraryName: 'Squared Set (couple numbers from the manual, asserted against the library)',
    written: 4,
    drawn: people.length,
    mirrored: true,
    bytes: files.get('partner-and-corner.png').length,
  });

  for (const spec of FORMATIONS) {
    let dancers;
    let mirrored = false;
    let written = 0;
    if (spec.from) {
      // A shape the manual draws but the library does not name: taken from a formation that IS named,
      // by a derivation that asserts the properties the page claims for it.
      dancers = spec.from(lib);
      if (!dancers || !dancers.length) throw new Error(`${spec.slug}: the derivation produced no dancers`);
    } else {
      if (!spec.as) {
        index.notDrawn.push({
          slug: spec.slug,
          title: spec.title,
          reason: 'not a named formation in formations.xml (it is a shape the manual describes in words)',
        });
        continue;
      }
      const found = lib.get(spec.as);
      if (!found || !found.length) {
        index.notDrawn.push({ slug: spec.slug, title: spec.title, reason: `no library formation named "${spec.as}"` });
        continue;
      }
      written = found.length;
      ({ dancers, mirrored } = spec.noMirror
        ? { dancers: found.map((d) => ({ ...d })), mirrored: false }
        : completeSet(found));
    }
    // A figure that comes straight from a named library entry has no derivation to assert, but the
    // page still says something about its shape; `assert` is where that claim gets measured, so a
    // library change that contradicts the page fails the build instead of redrawing the picture.
    if (spec.assert) spec.assert(dancers);
    const canvas = new Canvas(SIZE, SIZE, C.floor);
    draw(canvas, dancers, makeView(dancers));
    files.set(`${spec.slug}.png`, writePng(canvas, PALETTE));
    index.drawn.push({
      slug: spec.slug,
      title: spec.title,
      ...(spec.from
        ? { derivedFrom: spec.derivedFrom }
        : { libraryName: spec.as, written, mirrored }),
      drawn: dancers.length,
      bytes: files.get(`${spec.slug}.png`).length,
    });
  }

  buildArrangements(eng, lib, files, index);
  buildSequences(eng, files, index);
  return { files, index };
}

export function main() {
  const check = process.argv.includes('--check');
  const { files, index } = build();

  if (check) {
    let drift = 0;
    for (const [name, buf] of files) {
      const p = join(OUT_DIR, name);
      if (!existsSync(p) || !readFileSync(p).equals(buf)) {
        console.error(`DRIFT ${name}`);
        drift++;
      }
    }
    for (const f of existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []) {
      if (f.endsWith('.png') && !files.has(f)) {
        console.error(`ORPHAN ${f}`);
        drift++;
      }
    }
    if (drift) {
      console.error(`\n${drift} formation diagram(s) differ. Re-run without --check.`);
      return 1;
    }
    const undrawn = index.notDrawn.length;
    console.log(
      `${index.drawn.length} formation diagrams, ${index.arrangements[0]?.drawn ?? 0} arrangements and ` +
        `${index.sequences[0]?.drawn ?? 0} sequences reproduce exactly${undrawn ? `; ${undrawn} with a recorded reason` : ''}.`,
    );
    return 0;
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, buf] of [...files.entries()].sort()) writeFileSync(join(OUT_DIR, name), buf);
  writeFileSync(INDEX, JSON.stringify(index, null, 2), 'utf8');

  console.log(`${index.drawn.length} formation diagrams -> ${OUT_DIR}`);
  for (const d of index.drawn) {
    console.log(
      d.derivedFrom
        ? `  ${d.slug}: derived from ${d.derivedFrom} -> ${d.drawn} dancers`
        : `  ${d.slug}: ${d.libraryName} -> ${d.drawn} dancers (written ${d.written}${d.mirrored ? ', completed by rotation' : ', already whole'})`,
    );
  }
  for (const n of index.notDrawn) console.log(`  no diagram: ${n.title} (${n.reason})`);
  for (const a of index.arrangements) {
    console.log(`  arrangements: ${a.drawn} panels -> arrangements.png (${a.source})`);
    for (const p of a.panels) console.log(`    ${p.number}: ${p.pattern}`);
  }
  for (const s of index.sequences) {
    console.log(`  sequences: ${s.drawn} panels -> sequences.png (${s.source})`);
    for (const p of s.panels) {
      console.log(`    ${p.code}: boys ${p.boys} girls ${p.girls} (${p.partnersTogether}/${p.boards} boards keep partners together)`);
    }
  }
  void CACHE;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
