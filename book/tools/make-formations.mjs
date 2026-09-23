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

/**
 * Complete a written half-set the way the engine does: add the 180-degree rotation about the origin
 * unless the written dancers already include their own antipodes.
 */
export function completeSet(written) {
  const hasAntipode = written.every((d) => written.some((o) => o !== d && Math.abs(o.x + d.x) < 0.05 && Math.abs(o.y + d.y) < 0.05));
  if (hasAntipode) return { dancers: written.map((d) => ({ ...d })), mirrored: false };
  const mirrored = written.map((d) => ({
    gender: d.gender,
    x: -d.x,
    y: -d.y,
    angleDeg: ((d.angleDeg ?? 0) + 180) % 360,
  }));
  return { dancers: [...written, ...mirrored], mirrored: true };
}

function draw(canvas, dancers, view) {
  const px = (v) => view.ox + v * view.scale;
  const py = (v) => view.oy - v * view.scale;

  canvas.fillRect(0, 0, SIZE, SIZE, C.floor);
  const n = Math.ceil(view.units) + 1;
  for (let i = -n; i <= n; i++) {
    if (i === 0) continue;
    const colour = i % 2 === 0 ? C.gridMajor : C.gridMinor;
    canvas.strokeLine(px(i), 0, px(i), SIZE, 1, colour);
    canvas.strokeLine(0, py(i), SIZE, py(i), 1, colour);
  }
  canvas.strokeLine(px(0), 0, px(0), SIZE, 1, C.axis);
  canvas.strokeLine(0, py(0), SIZE, py(0), 1, C.axis);

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

/** Fit the view to the formation, with the same clamp the animations use. */
function makeView(dancers) {
  let extent = 0;
  for (const d of dancers) extent = Math.max(extent, Math.abs(d.x), Math.abs(d.y));
  const units = Math.max(3.2, Math.min(7, extent + 1.1));
  return { scale: (SIZE / 2 - 10) / units, ox: CENTRE, oy: CENTRE, units };
}

export function build() {
  const eng = loadEngine();
  const lib = eng.parseFormations(readAsset('formations.xml'));
  const files = new Map();
  const index = { drawn: [], notDrawn: [] };

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
