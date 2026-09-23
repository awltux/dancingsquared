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
import { Canvas, PALETTE, C, writePng } from './lib/raster.mjs';
import { completeSet, couples } from './lib/squared-set.mjs';

// Re-exported because `make-positions.mjs` used to import it from here; the two tools now share the
// one implementation in `lib/squared-set.mjs`.
export { completeSet };

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
const R_UNITS = 0.48;
const CENTRE = SIZE / 2;
const DEG = Math.PI / 180;

/**
 * The formations the book's formation page defines, matched to the library's own names.
 *
 * `as` is the name in `formations.xml`. Some concepts the page describes are NOT in the library --
 * "Facing Dancers" and a bare "Couple" among them -- and they are listed with `as: null` so the
 * index can say so instead of the page quietly going without.
 */
export const FORMATIONS = [
  { slug: 'squared-set', title: 'Squared Set', as: 'Squared Set' },
  // No separate diagram for a Static Square: it is the same geometry as the Squared Set, and the
  // page already says the difference between them is sequence, not shape. Two identical pictures
  // either side of that sentence would argue the opposite.
  { slug: 'facing-couples', title: 'Facing Couples', as: 'Facing Couples' },
  { slug: 'facing-dancers', title: 'Facing Dancers', as: null },
  { slug: 'couple', title: 'Couple', as: null },
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
const sameSpot = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;

/** The floor every diagram stands on: pale ground, a one-unit grid, and the two centre lines. */
function drawFloor(canvas, view) {
  const px = (v) => view.ox + v * view.scale;
  const py = (v) => view.oy - v * view.scale;

  canvas.fillRect(0, 0, canvas.width, canvas.height, C.floor);
  const n = Math.ceil(view.units) + 1;
  for (let i = -n; i <= n; i++) {
    if (i === 0) continue;
    const colour = i % 2 === 0 ? C.gridMajor : C.gridMinor;
    canvas.strokeLine(px(i), 0, px(i), canvas.height, 1, colour);
    canvas.strokeLine(0, py(i), canvas.width, py(i), 1, colour);
  }
  canvas.strokeLine(px(0), 0, px(0), canvas.height, 1, C.axis);
  canvas.strokeLine(0, py(0), canvas.width, py(0), 1, C.axis);
}

function draw(canvas, dancers, view) {
  const px = (v) => view.ox + v * view.scale;
  const py = (v) => view.oy - v * view.scale;

  drawFloor(canvas, view);
  
  const r = R_UNITS * view.scale;
  const ink = Math.max(1, Math.min(1.2, r / 11));
  const inset = Math.max(1, r * 0.05);

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
 * dancers in words. The numbering has its own picture (`make-positions.mjs`).
 */
function drawAnnotated(canvas, people, view, { fillOf, ring = [], caller = null }) {
  const px = (v) => view.ox + v * view.scale;
  const py = (v) => view.oy - v * view.scale;

  drawFloor(canvas, view);

  const r = R_UNITS * view.scale;
  const ink = Math.max(1, Math.min(1.2, r / 11));
  const inset = Math.max(1, r * 0.05);

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

export function build() {
  const eng = loadEngine();
  const lib = eng.parseFormations(readAsset('formations.xml'));
  const files = new Map();
  const index = { drawn: [], notDrawn: [] };

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
    if (!spec.as) {
      index.notDrawn.push({
        slug: spec.slug,
        title: spec.title,
        reason: 'not a named formation in formations.xml (it is a shape the manual describes in words)',
      });
      continue;
    }
    const written = lib.get(spec.as);
    if (!written || !written.length) {
      index.notDrawn.push({ slug: spec.slug, title: spec.title, reason: `no library formation named "${spec.as}"` });
      continue;
    }
    const { dancers, mirrored } = spec.noMirror
      ? { dancers: written.map((d) => ({ ...d })), mirrored: false }
      : completeSet(written);
    const canvas = new Canvas(SIZE, SIZE, C.floor);
    draw(canvas, dancers, makeView(dancers));
    files.set(`${spec.slug}.png`, writePng(canvas, PALETTE));
    index.drawn.push({
      slug: spec.slug,
      title: spec.title,
      libraryName: spec.as,
      written: written.length,
      drawn: dancers.length,
      mirrored,
      bytes: files.get(`${spec.slug}.png`).length,
    });
  }
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
    console.log(`${files.size} formation diagrams reproduce exactly; ${index.notDrawn.length} with a recorded reason.`);
    return 0;
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, buf] of [...files.entries()].sort()) writeFileSync(join(OUT_DIR, name), buf);
  writeFileSync(INDEX, JSON.stringify(index, null, 2), 'utf8');

  console.log(`${files.size} formation diagrams -> ${OUT_DIR}`);
  for (const d of index.drawn) {
    console.log(`  ${d.slug}: ${d.libraryName} -> ${d.drawn} dancers (written ${d.written}${d.mirrored ? ', completed by rotation' : ', already whole'})`);
  }
  for (const n of index.notDrawn) console.log(`  no diagram: ${n.title} (${n.reason})`);
  void CACHE;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
