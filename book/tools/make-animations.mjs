// The player catalogue for every call in the Mainstream program, and (with `--gifs`) an animated
// GIF of each.
//
//   node book/tools/make-animations.mjs [--gifs] [--check] [--verify] [--preview=<id>]
//
// ONE ANIMATION PER CALL. The book's call pages carry the interactive player, which the site builder
// injects under the `### Animation` heading; the GIF is opt-in and is not placed on a page. Two
// pictures of the same call -- one with controls and one without -- read as a mistake, and the lower
// one is always the worse of the two.
//
// WHAT THIS FILE PRODUCES for the site is `animations-index.json`: which authoring to load for each
// call in the browser, which `<tam>` inside it, how many beats it runs and how to fit the floor. The
// poses themselves are evaluated live by the engine, so no frame data is shipped.
//
// WHAT THE ANIMATION ADDS OVER A STILL PICTURE. A still shows where dancers went; it cannot show
// that the middle dancers move first, or that a call is a smooth continuous motion rather than a
// sequence of poses. That is the whole reason the online version exists.
//
// DETERMINISTIC: `--check` rebuilds the catalogue and compares it with the committed one, so a
// change to the fit or to the authoring a call is drawn from cannot ship unnoticed.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolsDir, root, loadEngine, loadCall } from './lib/load.mjs';
import { encodeGif, decodeGif } from './lib/gif.mjs';
import { Canvas, PALETTE, C, writePng } from './lib/raster.mjs';

const MAP = join(toolsDir, 'call-map.json');
const ANIM_DIR = join(toolsDir, '..', 'animations');
const CACHE = join(toolsDir, '.cache', 'animations');
const INDEX = join(toolsDir, 'animations-index.json');
/** Start formations the player offers, where the manual lists more than one and the corpus has one. */
const START_FORMATIONS = join(toolsDir, 'start-formations.json');

/** The attributes of every `<tam>` in a corpus file, in order. */
function tamsOf(file) {
  const xml = readFileSync(join(root, 'poc', 'src', 'assets', file), 'utf8');
  return [...xml.matchAll(/<tam\b[^>]*>/g)].map((m) => {
    const attrs = {};
    for (const a of m[0].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    return attrs;
  });
}

/**
 * The index of the first `<tam>` a query names, or -1.
 *
 * A query matches when EVERY attribute it carries matches; a query that carries neither `from` nor
 * `formation` is rejected by the caller, because `title` alone spans every formation the authoring
 * was written for and would pin nothing.
 */
function findTam(tams, query) {
  return tams.findIndex((t) => Object.entries(query).every(([k, v]) => (t[k] ?? '') === v));
}

/**
 * The start formations for one card, as the flat list the index and the player use:
 * `[{ label, file, tamIndex, from, beats, view }]`, in the table's own order.
 *
 * A label resolves to the first query that both matches a tam AND builds. A label whose formations
 * the corpus cannot animate is dropped -- the table keeps it for the next person to fill in, but the
 * player is not offered a start it cannot draw.
 */
function resolveStarts(eng, id, curated, cache) {
  if (!curated?.starts) return null;
  const out = [];
  for (const [label, spec] of Object.entries(curated.starts)) {
    let found = null;
    for (const call of spec.calls ?? []) {
      const tams = cache.get(call.file) ?? tamsOf(call.file);
      cache.set(call.file, tams);
      for (const query of call.tam_xml_queries ?? []) {
        if (!query.from && !query.formation) {
          throw new Error(`${id} / ${label}: a tam query names neither "from" nor "formation"`);
        }
        const tamIndex = findTam(tams, query);
        if (tamIndex < 0) continue;
        let bundle;
        try {
          bundle = loadCall(eng, { file: call.file, tamIndex });
        } catch {
          continue; // this authoring does not build; try the next query
        }
        const view = viewFor(eng, bundle);
        found = {
          label,
          file: call.file,
          tamIndex,
          from: bundle.from ?? null,
          beats: bundle.beats,
          view: { scale: Number(view.scale.toFixed(3)), units: Number(view.units.toFixed(3)) },
        };
        break;
      }
      if (found) break;
    }
    if (found) out.push(found);
  }
  return out.length ? out : null;
}

const SIZE = 340;
/**
 * Marker width: ONE GRID SQUARE of the board, which is the unit the background grid measures.
 *
 * A FIXED PIXEL RADIUS WAS WRONG TWICE OVER. The board puts dancers two units apart in a squared
 * set, an ocean wave or a column -- but only ONE unit apart in a tidal wave, a promenade and a
 * couple, and transiently closer than that whenever two dancers pass (Dosado reaches 1.0 units,
 * Star Thru 0.9). And because a call that travels far is fitted to a wider floor, a fixed radius
 * grew relative to the dancers exactly when the view zoomed out: at radius 21 px a call fitted to
 * 9.5 units drew markers 2.5 squares wide, which is the overlap that could be seen in the waves.
 *
 * Sizing it in units fixes both: the marker is a square of floor, and it shrinks with the zoom
 * instead of swallowing its neighbours. A hair under a full square, so the tightest spacing in the
 * program -- a tidal wave's one unit -- still reads as two dancers rather than one blob.
 */
const MARKER_UNITS = 0.48;
const HOLD_START = 3;
const STEPS = 18;
const HOLD_END = 10;
// 150ms a frame, not 70. At 70ms a call is over in under two seconds and cannot be followed, and a
// GIF has no speed control of its own -- the pace has to be built in.
const DELAY_MS = 150;
const SAMPLES = 60;

/**
 * Fit the view to the call's own motion.
 *
 * A fixed +-10 unit view draws a squared set as a speck in the middle of an empty floor: most
 * calls happen inside about four units, and a learner watching a 340px animation needs the dancers
 * to fill it. The view is clamped so a small call cannot zoom absurdly far in and a wide one --
 * a promenade, say -- still fits.
 */
function makeView(points) {
  let extent = 0;
  for (const p of points) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
  const units = Math.max(3.6, Math.min(9.5, extent + 1.3));
  const scale = (SIZE / 2 - 14) / units;
  return { scale, ox: SIZE / 2, oy: SIZE / 2, units };
}

const px = (view, v) => view.ox + v * view.scale;
const py = (view, v) => view.oy - v * view.scale; // screen y grows downward; board +y is up

function coupleIndex(d) {
  if (d.couple && C.trail[d.couple]) return 3 + d.couple;
  return d.gender === 'girl' ? 9 : 8;
}
function trailIndex(d) {
  if (d.couple && C.trail[d.couple]) return C.trail[d.couple];
  return C.axis;
}

function drawGrid(canvas, view) {
  const n = Math.ceil(view.units) + 1;
  for (let i = -n; i <= n; i++) {
    if (i === 0) continue;
    const colour = i % 2 === 0 ? C.gridMajor : C.gridMinor;
    canvas.strokeLine(px(view, i), 0, px(view, i), SIZE, 1, colour);
    canvas.strokeLine(0, py(view, i), SIZE, py(view, i), 1, colour);
  }
  canvas.strokeLine(px(view, 0), 0, px(view, 0), SIZE, 1.5, C.axis);
  canvas.strokeLine(0, py(view, 0), SIZE, py(view, 0), 1.5, C.axis);
}

/** The trail grows with the call, so the animation shows progress and not just motion. */
function drawTrails(canvas, view, trails, dancers, fraction) {
  for (let i = 0; i < trails.length; i++) {
    const pts = trails[i];
    const upTo = Math.max(1, Math.round(pts.length * fraction));
    const colour = trailIndex(dancers[i]);
    for (let k = 0; k + 1 < upTo; k++) {
      canvas.strokeLine(px(view, pts[k].x), py(view, pts[k].y), px(view, pts[k + 1].x), py(view, pts[k + 1].y), 1.8, colour);
    }
  }
}

/**
 * The number drawn on a dancer.
 *
 * TAKEN FROM COUPLE AND GENDER, not from `dancer.id`. Measured: the engine's `HOME_DANCERS` ids
 * run 1,2 on the NORTH couple (which it calls couple 3), 5,6 on the SOUTH couple (couple 1) -- a
 * rotation of the scheme a dancer reads off the floor, where the couple with their backs to the
 * caller is Couple 1 and is numbered first. Couple and gender are the engine's own data, so this is
 * a re-labelling of two declared facts and not an invented identity; `probe-identity.mjs` records
 * the measurement.
 */
const displayId = (d) =>
  d.couple && (d.gender === 'boy' || d.gender === 'girl')
    ? (d.couple - 1) * 2 + (d.gender === 'boy' ? 1 : 2)
    : null;

/**
 * Trim a line back to the edges of two markers, so a handhold is not a pair of very long arms.
 * `r` is in BOARD UNITS, the same as the positions.
 *
 * The guard is two radii, not "some margin": once the markers touch there is no gap left to fill,
 * and a line through them would be hidden under the bodies anyway. Above that, the line is drawn
 * across exactly the visible gap, at every zoom.
 */
function betweenEdges(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = (dx / len) * r;
  const uy = (dy / len) * r;
  if (len <= r * 2) return [[a.x, a.y], [b.x, b.y]];
  return [
    [a.x + ux, a.y + uy],
    [b.x - ux, b.y - uy],
  ];
}

function drawHold(canvas, view, holds, poses) {
  for (const h of holds ?? []) {
    const a = poses[h.i];
    const b = poses[h.j];
    if (!a || !b) continue;
    const [p, q] = betweenEdges(a, b, MARKER_UNITS);
    canvas.strokeLine(px(view, p[0]), py(view, p[1]), px(view, q[0]), py(view, q[1]), 2.4, C.ink);
  }
}

/**
 * The facing nose alone, in INK.
 *
 * Ink rather than the dancer's own colour: a same-coloured bump on a coloured body over a pale floor
 * cannot be read at a glance, which is the whole job of this mark, and white would be worse because
 * the part that shows is the part over the floor. Proportional to the marker, so it cannot span the
 * gap to a neighbouring square: 0.77 of a unit against a 2-unit wave spacing.
 */
function drawNose(canvas, view, pose, r) {
  const cx = px(view, pose.x);
  const cy = py(view, pose.y);
  const hx = Math.cos(pose.heading);
  const hy = -Math.sin(pose.heading);
  canvas.fillPolygon(
    [
      [cx + hx * (r * 1.6), cy + hy * (r * 1.6)],
      [cx + hx * (r * 0.85) - hy * (r * 0.5), cy + hy * (r * 0.85) + hx * (r * 0.5)],
      [cx + hx * (r * 0.85) + hy * (r * 0.5), cy + hy * (r * 0.85) - hx * (r * 0.5)],
    ],
    C.ink,
  );
}

/**
 * The bodies and the numbers: one pass AFTER every nose has been drawn.
 *
 * THE TWO PASSES MATTER. Drawn per dancer, one dancer's nose is painted after the previous dancer's
 * body, so wherever two dancers pass close the nose lands on the neighbour and they look like they
 * are stabbing one another. With the noses first, an intruding nose is covered by the body it
 * intrudes on -- which reads as one dancer behind another, and can never cover a number.
 */
function drawDancers(canvas, view, dancers, poses) {
  const r = MARKER_UNITS * view.scale;
  dancers.forEach((d, i) => {
    if (poses[i]) drawNose(canvas, view, poses[i], r);
  });
  dancers.forEach((d, i) => drawMarker(canvas, view, d, poses[i], r));
}

function drawMarker(canvas, view, dancer, pose, r) {
  if (!pose) return;
  const colour = coupleIndex(dancer);
  const cx = px(view, pose.x);
  const cy = py(view, pose.y);
  const ink = Math.max(1, Math.min(1.4, r / 13));
  const inset = Math.max(1, r * 0.05);
  if (dancer.gender === 'girl') {
    canvas.fillCircle(cx, cy, r, colour);
    canvas.strokeCircle(cx, cy, r, ink, C.ink);
  } else {
    // The square TURNS WITH THE DANCER. Axis-aligned it stayed put while the dancer turned, so a
    // Boy read as sliding round the floor rather than travelling; the Girl's circle has no
    // orientation to show. The number is drawn afterwards, upright.
    canvas.orientedSquare(cx, cy, r - inset, pose.heading, { colour, outline: C.ink, width: ink });
  }
  const num = displayId(dancer);
  // The digit is a 3x5 bitmap, so its height is 5 x scale and must stay inside the marker's
  // diameter. 0.21r makes it about as tall as the marker's radius, at every zoom.
  if (num) {
    const s = Math.max(1, Math.min(8, Math.round(r * 0.21)));
    canvas.digit(num, Math.round(cx - 1.5 * s), Math.round(cy - 2.5 * s), s, C.white);
  }
}

/** Render one call to a list of index frames. */
function framesFor(eng, bundle, site) {
  const dancers = eng.assignHomeIdentity(bundle.dancers);
  const trails = bundle.dancers.map((d) => eng.sampleTrail(d, SAMPLES));
  const beats = bundle.beats > 0 ? bundle.beats : 1;
  const frames = [];

  // The view fits the whole motion, so every frame of one call shares a scale and the dancers do
  // not appear to change size between calls only because the floor did.
  const view = makeView([...trails.flat(), ...eng.allPoses(bundle, 0), ...eng.allPoses(bundle, beats)]);

  const pose = (t) => {
    const poses = eng.allPoses(bundle, t);
    const holds = eng.computeHandholds(poses, 'static');
    return { poses, holds };
  };

  const render = (t, fraction) => {
    const canvas = new Canvas(SIZE, SIZE, C.floor);
    const { poses, holds } = pose(t);
    drawGrid(canvas, view);
    drawTrails(canvas, view, trails, dancers, fraction);
    drawHold(canvas, view, holds, poses);
    drawDancers(canvas, view, dancers, poses);
    return canvas.px;
  };

  for (let i = 0; i < HOLD_START; i++) frames.push(render(0, 0));
  for (let i = 1; i <= STEPS; i++) {
    const f = i / STEPS;
    frames.push(render(beats * f, f));
  }
  const end = pose(beats);
  for (let i = 0; i < HOLD_END; i++) {
    const canvas = new Canvas(SIZE, SIZE, C.floor);
    drawGrid(canvas, view);
    drawTrails(canvas, view, trails, dancers, 1);
    drawHold(canvas, view, end.holds, end.poses);
    drawDancers(canvas, view, dancers, end.poses);
    frames.push(canvas.px);
  }
  void site;
  return frames;
}

/**
 * The fitted view for a call. The ONLINE PLAYER draws the same floor, so it is shipped in the index
 * (`view.scale`, `view.units`) rather than recomputed in the browser -- computing the fit in two
 * places is how the two would drift apart.
 */
function viewFor(eng, bundle) {
  const trails = bundle.dancers.map((d) => eng.sampleTrail(d, SAMPLES));
  const beats = bundle.beats > 0 ? bundle.beats : 1;
  return makeView([...trails.flat(), ...eng.allPoses(bundle, 0), ...eng.allPoses(bundle, beats)]);
}

/**
 * Build the player catalogue, and (only when asked) the GIFs.
 *
 * `figures` is what the SITE depends on: which authoring to load for a call, and how to fit the
 * floor. The GIF is no longer part of the book -- the page carries one animation, the interactive
 * player -- so encoding one is opt-in via `--gifs`, for sharing a call with somebody who has no
 * browser open.
 */
export function build({ gifs = false } = {}) {
  const map = JSON.parse(readFileSync(MAP, 'utf8'));
  const startTable = existsSync(START_FORMATIONS) ? JSON.parse(readFileSync(START_FORMATIONS, 'utf8')) : {};
  // Every entry is named: the file is keyed by codes like m01a, which say nothing on their own.
  for (const [k, v] of Object.entries(startTable)) {
    if (k.startsWith('$')) continue;
    if (!v?.name) throw new Error(`start-formations.json: "${k}" has no "name"`);
  }
  const tamCache = new Map();
  const eng = loadEngine();
  const files = new Map();
  const index = { figures: [], noAnimation: [] };

  for (const unit of map.units) {
    for (const e of unit.entries) {
      const id = `m${String(unit.n).padStart(2, '0')}${e.letter ?? ''}`;
      if (!e.sites.length) {
        index.noAnimation.push({ id, call: e.title, reason: 'no corpus title' });
        continue;
      }
      // THE START TABLE'S FIRST ENTRY DEFINES THE ANIMATION THE PAGE SHOWS.
      //
      // The book's terminology is the manual's, so no start is ever labelled with the engine's name
      // for an authoring. Where the manual's own first start is not the authoring the corpus happened
      // to list first, the page plays the manual's -- so the picker always agrees with what is on
      // screen before anyone touches it. A card with no start list is unchanged: e.sites[0].
      const curated = startTable[id];
      const starts = curated ? resolveStarts(eng, id, curated, tamCache) : null;
      const site = starts ? { file: starts[0].file, tamIndex: starts[0].tamIndex } : e.sites[0];

      let bundle = null;
      const failures = [];
      for (const candidate of [site, ...e.sites]) {
        try {
          const c = loadCall(eng, candidate);
          if (!c || !c.dancers.length) throw new Error('built no dancers');
          bundle = c;
          break;
        } catch (err) {
          failures.push(`${candidate.file}#${candidate.tamIndex}: ${err.message}`);
        }
      }
      if (!bundle) {
        index.noAnimation.push({ id, call: e.title, reason: `corpus authoring does not build: ${failures[0] ?? ''}` });
        continue;
      }
      let frameCount = 0;
      if (gifs) {
        const frames = framesFor(eng, bundle, site);
        frameCount = frames.length;
        files.set(`${id}.gif`, encodeGif({ width: SIZE, height: SIZE, palette: PALETTE, frames, delayMs: DELAY_MS, loop: 0 }));
      }

      // The site needs to know WHICH authoring to load in the browser, and at what fit.
      const view = viewFor(eng, bundle);
      const [level, ...rest] = site.file.split('/');
      index.figures.push({
        id,
        call: e.title,
        corpusTitle: e.corpusTitle,
        file: site.file,
        level,
        fileName: rest.join('/'),
        tamIndex: site.tamIndex,
        from: bundle.from ?? null,
        beats: bundle.beats,
        frames: frameCount,
        view: { scale: Number(view.scale.toFixed(3)), units: Number(view.units.toFixed(3)) },
        ...(starts && starts.length > 1 ? { starts } : {}),
      });
    }
  }
  index.figures.sort((a, b) => a.id.localeCompare(b.id));
  index.noAnimation.sort((a, b) => a.id.localeCompare(b.id));
  return { files, index };
}

function writeAll(dir, files, index) {
  // Only the catalogue is written by default. The GIF directory is rebuilt only when GIFs were
  // actually produced, so a plain run cannot delete animations somebody asked for.
  if (files.size) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [name, buf] of [...files.entries()].sort()) writeFileSync(join(dir, name), buf);
  }
  if (index) writeFileSync(INDEX, JSON.stringify(index, null, 2), 'utf8');
}

/**
 * Verify what the SITE depends on: every call the index offers must load from the authoring it
 * names and must evaluate poses for all of its dancers at the start, the middle and the end.
 *
 * This replaces decoding the GIFs, which stopped being the shipped artefact. A player that throws
 * halfway through a call is invisible in a link check -- the page is fine, the animation is not --
 * so it is checked here, against the same engine the browser gets.
 */
function verifyCatalogue() {
  const index = JSON.parse(readFileSync(INDEX, 'utf8'));
  const eng = loadEngine();
  const problems = [];
  let poses = 0;

  for (const f of index.figures) {
    let bundle;
    try {
      bundle = loadCall(eng, { file: f.file, tamIndex: f.tamIndex });
    } catch (err) {
      problems.push(`${f.id}: cannot load ${f.file}#${f.tamIndex}: ${err.message}`);
      continue;
    }
    const beats = bundle.beats > 0 ? bundle.beats : 1;
    for (const t of [0, beats / 2, beats]) {
      let ps = null;
      try {
        ps = eng.allPoses(bundle, t);
      } catch (err) {
        problems.push(`${f.id}: allPoses(${t}) threw: ${err.message}`);
        break;
      }
      if (!ps || ps.length !== bundle.dancers.length) {
        problems.push(`${f.id}: allPoses(${t}) gave ${ps ? ps.length : 'nothing'} poses for ${bundle.dancers.length} dancers`);
        break;
      }
      if (ps.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.heading))) {
        problems.push(`${f.id}: non-finite pose at beat ${t}`);
        break;
      }
      poses++;
    }
    if (!(f.view?.scale > 0) || !(f.view?.units > 0)) problems.push(`${f.id}: the index carries no usable view`);

    // The alternative start formations are shipped too, so each one has to load and pose like the
    // default -- a selector entry that throws in the browser is invisible to a link check.
    for (const [i, s] of (f.starts ?? []).entries()) {
      if (i === 0 && (s.file !== f.file || s.tamIndex !== f.tamIndex)) {
        problems.push(`${f.id}: the first start formation is not the default authoring`);
      }
      let alt;
      try {
        alt = loadCall(eng, { file: s.file, tamIndex: s.tamIndex });
      } catch (err) {
        problems.push(`${f.id}: start "${s.label}" cannot load ${s.file}#${s.tamIndex}: ${err.message}`);
        continue;
      }
      const b = alt.beats > 0 ? alt.beats : 1;
      for (const t of [0, b / 2, b]) {
        let ps = null;
        try {
          ps = eng.allPoses(alt, t);
        } catch (err) {
          problems.push(`${f.id}: start "${s.label}" allPoses(${t}) threw: ${err.message}`);
          break;
        }
        if (!ps || ps.length !== alt.dancers.length) {
          problems.push(`${f.id}: start "${s.label}" gave ${ps ? ps.length : 'nothing'} poses for ${alt.dancers.length} dancers`);
          break;
        }
        poses++;
      }
      if (!(s.view?.scale > 0) || !(s.view?.units > 0)) problems.push(`${f.id}: start "${s.label}" carries no usable view`);
    }
  }

  // The GIFs are optional, but if any are present they must still be readable files.
  let decoded = 0;
  if (existsSync(ANIM_DIR)) {
    for (const name of readdirSync(ANIM_DIR).filter((n) => n.endsWith('.gif'))) {
      try {
        const d = decodeGif(readFileSync(join(ANIM_DIR, name)));
        if (d.width !== SIZE || d.height !== SIZE) throw new Error(`size ${d.width}x${d.height}`);
        if (d.palette.length < PALETTE.length) throw new Error('palette truncated');
        decoded++;
      } catch (err) {
        problems.push(`${name}: ${err.message}`);
      }
    }
  }

  for (const p of problems) console.error(`  ${p}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s).`);
    return 1;
  }
  console.log(
    `${index.figures.length} playable calls verified (${poses} pose evaluations, ` +
      `${index.noAnimation.length} with a recorded reason)` +
      (decoded ? `; ${decoded} GIF(s) decode cleanly.` : '.'),
  );
  return 0;
}

export function main() {
  const wantGifs = process.argv.includes('--gifs');
  const check = process.argv.includes('--check');
  const verify = process.argv.includes('--verify');
  const previewArg = process.argv.find((a) => a.startsWith('--preview'));

  if (previewArg) {
    // Dump one frame as a PNG so the board can actually be LOOKED AT. A renderer that runs without
    // error is not evidence that the picture is right.
    const id = previewArg.includes('=') ? previewArg.split('=')[1] : 'm18';
    const map = JSON.parse(readFileSync(MAP, 'utf8'));
    const eng = loadEngine();
    const entry = map.units.flatMap((u) => u.entries.map((e) => ({ u, e }))).find((x) => `m${String(x.u.n).padStart(2, '0')}${x.e.letter ?? ''}` === id);
    if (!entry || !entry.e.sites.length) throw new Error(`no corpus data for ${id}`);
    const bundle = loadCall(eng, entry.e.sites[0]);
    const frames = framesFor(eng, bundle, entry.e.sites[0]);
    const at = Math.floor(frames.length / 2);
    const canvas = new Canvas(SIZE, SIZE);
    canvas.px.set(frames[at]);
    const png = writePng(canvas, PALETTE);
    const outPath = join(toolsDir, '.cache', `preview-${id}.png`);
    mkdirSync(join(toolsDir, '.cache'), { recursive: true });
    writeFileSync(outPath, png);
    console.log(`${id}: frame ${at + 1} of ${frames.length} -> ${outPath}`);
    return 0;
  }

  if (verify) return verifyCatalogue();

  const { files, index } = build({ gifs: wantGifs });

  if (check) {
    // The committed catalogue must match what the tools would produce now. A stale index is not a
    // crash: it silently loads the wrong authoring, or fits the floor wrongly, on a page that
    // otherwise passes every link check.
    let drift = 0;
    if (!existsSync(INDEX) || readFileSync(INDEX, 'utf8') !== JSON.stringify(index, null, 2)) {
      console.error('DRIFT animations-index.json');
      drift++;
    }
    for (const [name, buf] of files) {
      const p = join(ANIM_DIR, name);
      if (!existsSync(p) || !readFileSync(p).equals(buf)) {
        console.error(`DRIFT ${name}`);
        drift++;
      }
    }
    if (drift) {
      console.error(`\n${drift} file(s) differ. Re-run without --check.`);
      return 1;
    }
    console.log(`${index.figures.length} playable calls reproduce exactly${files.size ? `, and ${files.size} GIFs` : ''}.`);
    return 0;
  }

  const before = existsSync(ANIM_DIR) ? readdirSync(ANIM_DIR).filter((f) => f.endsWith('.gif')).length : 0;
  writeAll(ANIM_DIR, files, index);
  if (wantGifs) {
    const total = [...files.values()].reduce((a, b) => a + b.length, 0);
    console.log(
      `${files.size} GIFs -> ${ANIM_DIR} (${(total / 1024 / 1024).toFixed(1)} MB, avg ${Math.round(total / files.size / 1024)} KB)`,
    );
  } else if (before) {
    console.log(`note: ${before} GIF(s) are still in ${ANIM_DIR}; pass --gifs to rebuild them.`);
  }
  console.log(`${index.figures.length} playable calls, ${index.noAnimation.length} with no animation -> ${INDEX}`);
  return 0;
}

// `pathToFileURL` resolves a RELATIVE argv[1] against the working directory. Comparing
// `import.meta.url` to a hand-built `file://${argv[1]}` silently fails when a script is invoked by a
// relative path -- which is how a background job invokes it -- and the process then exits 0 having
// done nothing at all.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

void CACHE;
