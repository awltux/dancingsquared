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
import { toolsDir, root, loadEngine, loadCall, readAsset } from './lib/load.mjs';
// THE BODY THE MARKER IS DRAWN TO is the engine's (`bodies.ts`), not a book constant: a dancer is
// DANCER_WIDTH across the facing and DANCER_DEPTH along it, and the picture must not disagree with the
// body the contact rules measure.
const { DANCER_WIDTH, DANCER_DEPTH } = loadEngine();
import { loadRoots, makeResolver } from './lib/variants.mjs';
import { corpusRoot, matchesTamQuery, tamQueryMatch, tamsOf } from 'dancing-squared-corpus';
import { encodeGif, decodeGif } from './lib/gif.mjs';
import { Canvas, writePng } from './lib/raster.mjs';
import { PALETTE, C, MARKER_UNITS, NOSE_HALF_OF_SIDE, bodyShapeOf, bodySlot, trailSlot } from './lib/board-style.mjs';

const MAP = join(toolsDir, 'call-map.json');
const ANIM_DIR = join(toolsDir, '..', 'animations');
const CACHE = join(toolsDir, '.cache', 'animations');
const INDEX = join(toolsDir, 'animations-index.json');
/** Start formations the player offers, where the manual lists more than one and the corpus has one. */
const START_FORMATIONS = join(toolsDir, 'start-formations.json');
/** The whole-set instances of calls the corpus authors only as subset units - generated, never edited. */
const VIRTUAL_INDEX = join(corpusRoot(), 'virtual', 'index.json');

/**
 * A corpus site's file, split into the level and the file name the reader wants — `"ms/promenade.xml"` is
 * `['ms', 'promenade.xml']`. The book's table names files this way (`start-formations.json`'s `file`), and the one
 * reader takes them apart because its own argument is a level plus a file.
 */
function levelOf(rel) {
  const at = rel.indexOf('/');
  return at < 0 ? ['', rel] : [rel.slice(0, at), rel.slice(at + 1)];
}

/** Every `<tam>` site of a corpus file named the book's way (`"ms/promenade.xml"`). */
function sitesOfFile(rel) {
  const [level, file] = levelOf(rel);
  return level ? tamsOf(level, file) : [];
}

/**
 * CAN THE ENGINE STAND THIS CALL UP AS A WHOLE-BOARD VIRTUAL CALL from the formation the card names?
 *
 * A START QUERY THAT MATCHES NO TAM is not necessarily a gap: part of the corpus is authored for HALF the set
 * (`Promenade` from `Facing Couples Far` writes two dancers), and the engine can place such an authoring on a
 * whole board — as long as the result STARTS and ENDS on a formation it NAMES (TODO item 39, the owner's
 * constraint). This asks that question for the one query, from the tams of the ONE FILE the query names (the same
 * scope `findTam` uses), and returns either the chosen call in a line a reader can act on, or the engine's own
 * refusal sentence.
 *
 * IT IS A REPORT AND NOT A DATA CHANGE. Drawing a virtual call needs a generated `<tam>` the player can fetch by
 * `(file, tamIndex)`; the player can only load a corpus file, so that is a separate unit with its own artefact.
 * Printing it here is what makes the 12 unresolved queries actionable instead of a number.
 */
function virtualFor(eng, spec, query) {
  const title = query.title ?? '';
  if (!title) return { chosen: null, reason: 'the query names no title' };
  // WHICH BOARD IS THIS START? The table declares `spec.formation` only where the card's own wording needed
  // translating (99 of its start labels carry no `formation` at all), so the query's own tam attribute is the
  // second answer: it is the formation the manual names for this start, spelled as the corpus spells it. A name
  // that stands up no board is reported as such rather than guessed at — `Facing Couples Compact` and
  // `Grand Circle` are exactly that case in the 12 outstanding queries.
  const formation = spec?.formation ?? query.formation ?? query.from ?? null;
  if (!formation) return { chosen: null, reason: 'neither the card nor the query names a formation for this start' };
  const own = sitesOfFile(spec.file ?? query.file ?? '')
    .filter((site) => site.title === title)
    .map((site) => site.xml);
  if (own.length === 0) return { chosen: null, reason: 'no tam in that file carries the title, so there is no authoring to place' };
  let seq;
  try {
    seq = new eng.Sequencer(readAsset('moves.xml'), readAsset('formations.xml'), [{ name: title, xml: `<calls>\n${own.join('\n')}\n</calls>` }]);
  } catch (err) {
    return { chosen: null, reason: `the engine could not load those tams: ${String(err.message ?? err)}` };
  }
  const board = seq.boardForFormation(formation);
  if (!board) return { chosen: null, reason: `the engine stands up no board for "${formation}"` };
  const r = seq.virtualCall(board, title);
  if (!r.legal) return { chosen: null, reason: r.reason };
  const pick = eng.chooseVirtual(r.candidates);
  return pick.chosen
    ? { chosen: `${pick.chosen.startFormation} to ${pick.chosen.endFormation} (${pick.chosen.kind}, ${r.candidates.length} candidate(s))` }
    : { chosen: null, reason: pick.reason };
}

/**
 * The index of the first `<tam>` a query names, or -1.
 *
 * A query matches when EVERY attribute it carries matches; a query that carries neither `from` nor
 * `formation` is rejected by the caller, because `title` alone spans every formation the authoring
 * was written for and would pin nothing.
 *
 * THE TWO FORMATION ATTRIBUTES ARE ONE QUESTION, and that rule now lives in `packages/corpus`
 * (`tamQueryMatch`) rather than here: a tam declares the formation it is written for in `from`, in
 * `formation`, or -- as every tam in `ms/circle.xml` now does -- in `formation` alone, with `from` left
 * empty, so a query naming `from` would find nothing even though the authoring is plainly written for
 * that formation. Both keys are matched against either declaration, and the caller COUNTS how often the
 * fallback was needed, so a corpus that has quietly dropped an attribute shows up in the build output
 * instead of being absorbed in silence. The reader hands raw attributes, and `tamQueryMatch` says WHICH
 * way it matched so that count survives the move.
 */
function findTam(sites, query, tally = null) {
  const at = sites.findIndex((s) => matchesTamQuery(s.attrs, query));
  if (at >= 0 && tally && tamQueryMatch(sites[at].attrs, query) === 'declared-formation') tally.declared++;
  return at;
}

/**
 * The start formations for one card, as the index and the player use them:
 * `[{ label, calls: [{ title, file, tamIndex, from, beats, view }] }]`, in the table's own order.
 *
 * EVERY CALL THE TABLE LISTS FOR A LABEL IS RESOLVED, not just the first. The table is the manual's
 * own list of what starts from each formation, and for a card like Circle Left/Right that list is
 * where the variants live -- Circle Left, Circle Left 1/8, 1/4, 1/2, 3/4, Circle Right, ... -- which
 * are different calls to watch from the same formation. Resolving only the first threw all of them
 * away and left the player offering one animation under a formation that has ten.
 *
 * A query whose authoring does not build is skipped, and a label with no building call at all is
 * dropped: the table keeps it for the next person to fill in, but the player is not offered a start
 * it cannot draw. (The caller of this function keeps that label as the call's home formation, so a
 * card animated from a stand-in formation is still filed under the manual's name for it.)
 */
function resolveStarts(eng, id, curated, cache, tally = { declared: 0, unresolved: 0, skipped: [] }) {
  if (!curated?.starts) return null;
  const out = [];
  for (const [label, spec] of Object.entries(curated.starts)) {
    const calls = [];
    const seen = new Set();
    for (const call of spec.calls ?? []) {
      const tams = cache.get(call.file) ?? sitesOfFile(call.file);
      cache.set(call.file, tams);
      for (const query of call.tam_xml_queries ?? []) {
        if (!query.from && !query.formation) {
          throw new Error(`${id} / ${label}: a tam query names neither "from" nor "formation"`);
        }
        const tamIndex = findTam(tams, query, tally);
        if (tamIndex < 0) {
          tally.unresolved++;
          // NAMED, NOT ONLY COUNTED. A bare `12 resolved to nothing` cannot be acted on and cannot be
          // argued with - and this table is maintained by hand against a corpus that is retitled, so the
          // count is the only thing that would ever move. MEASURED when this was added: 40 of them, 28 of
          // which were one rename (`Circle * - Stop at Home` -> `Circle * Home` and the three `... Full`
          // titles) and the other 12 still outstanding.
          const virtual = virtualFor(eng, { ...spec, file: call.file }, query);
          tally.skipped.push(
            `${id} / ${label}: "${query.title ?? ''}" from "${query.formation ?? query.from ?? ''}" in ${call.file}`
            + (virtual.chosen
              ? `\n               VIRTUAL ${virtual.chosen}`
              : virtual.reason
                ? `\n               and no virtual variant: ${virtual.reason}`
                : ''),
          );
          continue;
        }
        const key = `${call.file}#${tamIndex}`;
        if (seen.has(key)) continue; // two queries can land on the same authoring
        let bundle;
        try {
          bundle = loadCall(eng, { file: call.file, tamIndex });
        } catch {
          continue; // this authoring does not build; try the next query
        }
        // THE PICKER OFFERS WHOLE-SET INSTANCES ONLY, for the reason `WHOLE_SET` records below: a half-set
        // authoring is a legitimate corpus unit and not a picture of what the reader is being taught.
        if (!isWholeSet(bundle)) continue;
        seen.add(key);
        const view = viewFor(eng, bundle);
        calls.push({
          // The manual's name for what is being watched, which is what the chooser shows.
          title: tams[tamIndex]?.title ?? query.title ?? '',
          file: call.file,
          tamIndex,
          from: bundle.from ?? null,
          beats: bundle.beats,
          view: { scale: Number(view.scale.toFixed(3)), units: Number(view.units.toFixed(3)) },
        });
      }
    }
    if (calls.length) out.push({ label, calls });
  }
  return out.length ? out : null;
}

const SIZE = 340;
/**
 * THE BOOK PLAYS WHOLE-SET INSTANCES ONLY.
 *
 * MEASURED before this rule was applied: 48 of the book's 75 animations loaded an authoring that builds FEWER
 * than eight dancers - two for `Single Circle Left`, `Swing Your Partner`, `Single File Promenade` and `Dosado`,
 * four for most of the rest - because the corpus routinely authors a call for PART of the set and lets the
 * sequencer mirror it onto the whole board. A half-set authoring is a legitimate corpus unit and a legitimate
 * thing to SEQUENCE; it is not what a reader watching a call on a board expects, and a two-dancer `Single File
 * Promenade` is indistinguishable from a broken picture.
 *
 * SO A CANDIDATE MUST BUILD THE WHOLE SET, and a call whose authorings are ALL subsets is not drawn at all
 * rather than drawn as a fragment. The engine's answer to those is the VIRTUAL call - `placeVirtual` places a
 * subwhole authoring on a whole board, and `resolveVirtual`/`chooseVirtual` search the formations for one whose
 * start and end are NAMED (`engine/src/sequencer/virtual-call.ts`). Playing one needs a generated `<tam>` the
 * player can fetch by `(file, tamIndex)` - a separate artefact with its own generator, which is why this filter
 * NAMES the calls it cannot draw instead of manufacturing one. There is NO cached map from a subset call to a
 * virtual call: the module is deliberately cache-free, and the search is exactly what the owner warned could
 * explode on a call as unconstrained as `Dancer Turn Right`.
 */
const WHOLE_SET = 8;
const isWholeSet = (bundle) => bundle.dancers.length === WHOLE_SET;
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
    const colour = trailSlot(dancers[i]);
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
 * The bodies and the numbers: one pass AFTER every nose has been drawn.
 *
 * THE TWO PASSES MATTER. Drawn per dancer, one dancer's nose is painted after the previous dancer's
 * body, so wherever two dancers pass close the nose lands on the neighbour and they look like they
 * are stabbing one another. With the noses first, an intruding nose is covered by the body it
 * intrudes on -- which reads as one dancer behind another, and can never cover a number.
 */
function drawDancers(canvas, view, dancers, poses) {
  // THE BODY IS THE ENGINE'S: DANCER_WIDTH across the facing and DANCER_DEPTH along it, a rectangle for a
  // boy and an ellipse for a girl, with a white half-disc nose - the marker `packages/stage/scene.ts` draws.
  const halfW = (DANCER_WIDTH / 2) * view.scale;
  const halfD = (DANCER_DEPTH / 2) * view.scale;
  const ink = Math.max(1, Math.min(1.4, halfW / 13));
  dancers.forEach((d, i) => {
    const pose = poses[i];
    if (!pose) return;
    const cx = px(view, pose.x);
    const cy = py(view, pose.y);
    canvas.orientedBody(cx, cy, halfW, halfD, -pose.heading, {
      shape: bodyShapeOf(d.gender),
      colour: bodySlot(d),
      outline: C.ink,
      width: ink,
      nose: halfW * NOSE_HALF_OF_SIDE,
    });
    const num = displayId(d);
    // The number stands OUTSIDE the body, because a body 0.45 deep has no room for a legible digit.
    if (num) {
      const s = Math.max(1, Math.min(8, Math.round(halfW * 0.2)));
      canvas.digit(num, Math.round(cx - 1.5 * s), Math.round(cy + halfW * 0.95), s, C.ink);
    }
  });
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
  /**
   * HOW THE START QUERIES FARED, reported at the end of the build rather than left to be inferred from
   * a shorter list of animations. A corpus that has dropped an attribute, or a table that has drifted
   * from one, shows up as a start list that has quietly gone empty -- which is a page with no chooser
   * on it and nothing anywhere saying why.
   */
  const startTally = { declared: 0, unresolved: 0, skipped: [] };
  const eng = loadEngine();
  // A BINDING NAMES A VARIANT, NOT A POSITION. See `lib/variants.mjs` for why the id replaced `{file, tamIndex}`
  // and why the title travels beside it as a hint.
  const roots = loadRoots();
  const bindings = makeResolver(eng, roots);
  const unresolvedBindings = [];
  /** Every candidate skipped because it is a half-set authoring, named so the count can be acted on. */
  const subsetSkipped = [];
  /**
   * THE VIRTUAL PLACEMENTS. Generated by `make-virtual.mjs` from `virtual-placements.json`; absent until that
   * tool has run, and the build then names the cards it cannot draw rather than failing on a missing file.
   */
  const virtualIndex = existsSync(VIRTUAL_INDEX)
    ? JSON.parse(readFileSync(VIRTUAL_INDEX, 'utf8'))
    : { placements: {}, refusals: {} };
  const virtualFailures = [];
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
      // screen before anyone touches it. A card with no start list is the map's first binding.
      const curated = startTable[id];
      const starts = curated ? resolveStarts(eng, id, curated, tamCache, startTally) : null;
      // THE MAP'S BINDING IS A VARIANT ID, AND IT IS RESOLVED RATHER THAN TRUSTED. When it does not resolve, the
      // card is NAMED and gets no animation: substituting another authoring because the named one is gone is
      // exactly how a wrong call reached a reader (MEASURED, 7 of 75 cards before `e199c42`), and the map is
      // regenerated from the corpus anyway, so an unresolved binding means the corpus moved under a stale map.
      const resolved = e.sites.map((binding) => ({ binding, site: bindings.resolve(binding) }));
      for (const r of resolved) {
        if (!r.site) {
          unresolvedBindings.push(`${id}: ${r.binding.variantId} (${r.binding.level} "${r.binding.title}")`);
        }
      }
      // THE CANDIDATES, in order: the manual's own first start, then the map's bindings. THE FIRST ONE THAT
      // BUILDS THE WHOLE SET WINS; a subset authoring is skipped rather than drawn (`WHOLE_SET` above), and if
      // every candidate is a subset the card is NAMED instead of shown as a fragment.
      const candidates = [];
      if (starts?.[0]?.calls?.length) {
        candidates.push({ file: starts[0].calls[0].file, tamIndex: starts[0].calls[0].tamIndex });
      }
      for (const r of resolved) if (r.site) candidates.push(r.site);

      let site = null;
      let bundle = null;
      const failures = [];
      for (const candidate of candidates) {
        if (candidate.file === undefined) continue;
        if (site && candidate.file === site.file && candidate.tamIndex === site.tamIndex) continue;
        try {
          const c = loadCall(eng, candidate);
          if (!c || !c.dancers.length) throw new Error('built no dancers');
          if (!isWholeSet(c)) {
            subsetSkipped.push(`${id}: ${candidate.file}#${candidate.tamIndex} builds ${c.dancers.length} dancers ("${c.title}")`);
            continue;
          }
          site = candidate;
          bundle = c;
          break;
        } catch (err) {
          failures.push(`${candidate.file}#${candidate.tamIndex}: ${err.message}`);
        }
      }
      // A VIRTUAL CALL IS THE LAST CANDIDATE, and it is the only one that comes from outside the corpus: the
      // eight calls that have no eight-dancer authoring get one PLACED (`make-virtual.mjs`), and the artefact it
      // writes is what plays. The board is declared there, not searched here, for the reason the placements file
      // records - a search over every formation is the explosion, and a cache of it would pin an arbitrary pick.
      const virtualRow = virtualIndex.placements?.[id] ?? null;
      const virtualRefusal = virtualIndex.refusals?.[id] ?? null;
      if (!site && virtualRow) {
        try {
          const c = loadCall(eng, { file: virtualRow.file, tamIndex: virtualRow.tamIndex });
          if (!c || !c.dancers.length) throw new Error('built no dancers');
          if (!isWholeSet(c)) throw new Error(`builds ${c.dancers.length} dancers, not the whole set`);
          site = { file: virtualRow.file, tamIndex: virtualRow.tamIndex };
          bundle = c;
        } catch (err) {
          virtualFailures.push(`${id}: ${virtualRow.file}#${virtualRow.tamIndex}: ${err.message}`);
        }
      }
      if (!site) {
        index.noAnimation.push({
          id,
          call: e.title,
          reason: !e.sites.length
            ? 'no corpus title'
            : failures.length
              ? `no authoring builds: ${failures[0]}`
              : virtualFailures.length
                ? `the declared virtual placement does not play: ${virtualFailures[virtualFailures.length - 1]}`
                : virtualRefusal
                  ? `no legal whole-set placement: ${virtualRefusal}`
                  : `every authoring of this call is a subset of the set; a whole-set instance needs a virtual call`,
        });
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
      /**
       * THE MANUAL'S OWN START TABLE IS CARRIED THROUGH, per formation and with its calls.
       *
       * `starts` is `[{ label, calls: [...] }]` from the manual's table: which formations the manual
       * starts this call from, and which of its calls it lists from each -- Circle Left, Circle Left
       * 1/8, 1/2, 3/4, Circle Right, ... for a ring. The player shows one formation chooser and one
       * call chooser from it, so the reader can watch any of the calls the manual names from any of
       * the formations it names, which is the whole of what the table knows.
       *
       * WHERE NOTHING CAN BE DRAWN. A label whose calls the corpus cannot animate is kept as the
       * card's home formation with the authoring there is, so a card shown from a stand-in formation
       * is still filed under the manual's name for it -- the substitution the page warns about.
       */
      const curatedLabels = Object.keys(curated?.starts ?? {});
      // A VIRTUAL CARD GETS NO CHOOSER. The manual's start label for these calls is a SUBSET ("Facing Dancers",
      // "Couple"); the animation starts on the whole-set board the placement chose, and a chooser naming one
      // formation while the player shows another is the lie this line of work exists to remove. The card's own
      // At-a-glance table still states the manual's start.
      const shownStart = virtualRow
        ? null
        : starts && starts.length
          ? starts
          : curatedLabels.length && bundle.from
            ? [
                {
                  label: curatedLabels[0],
                  calls: [
                    {
                      title: e.title,
                      file: site.file,
                      tamIndex: site.tamIndex,
                      from: bundle.from,
                      beats: bundle.beats,
                      view: { scale: Number(view.scale.toFixed(3)), units: Number(view.units.toFixed(3)) },
                    },
                  ],
                },
              ]
            : null;
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
        ...(virtualRow
          ? {
              virtual: {
                board: virtualRow.board,
                kind: virtualRow.kind,
                // THE READING the permission layer was asked about, so the catalogue says which dancers dance
                // and not only which board they stand on.
                reading: virtualRow.reading,
                startFormation: virtualRow.startFormation,
                endFormation: virtualRow.endFormation,
              },
            }
          : {}),
        ...(shownStart ? { starts: shownStart } : {}),
      });
    }
  }
  index.figures.sort((a, b) => a.id.localeCompare(b.id));
  index.noAnimation.sort((a, b) => a.id.localeCompare(b.id));
  if (startTally.declared || startTally.unresolved) {
    console.log(
      `  start queries: ${startTally.declared} matched on a tam's own declared formation (its "from" is empty)` +
        `${startTally.unresolved ? `; ${startTally.unresolved} resolved to nothing` : ''}`,
    );
    for (const line of startTally.skipped) console.log(`    NOT DRAWN  ${line}`);
  }
  // WHAT WAS SKIPPED FOR BEING A FRAGMENT, named rather than counted: a card with no animation because its only
  // authorings are half-set is a card waiting for a virtual-call artefact, and that is a work item, not a gap.
  if (subsetSkipped.length) {
    console.log(`  subset authorings skipped (the book plays whole-set instances only): ${subsetSkipped.length}`);
    for (const line of subsetSkipped.slice(0, 12)) console.log(`    NOT PLAYED  ${line}`);
    if (subsetSkipped.length > 12) console.log(`    ... and ${subsetSkipped.length - 12} more`);
  }
  // A REFERENCE THAT NO LONGER RESOLVES IS A FAILURE, not a card that quietly loses its animation. The map names
  // variants; when one is gone, either the corpus moved under a stale map (regenerate it) or the call was
  // retired (decide what the card should show). Both are decisions a person makes, so the build stops here and
  // prints every one rather than picking a stand-in.
  if (unresolvedBindings.length) {
    throw new Error(
      `${unresolvedBindings.length} binding(s) name a variant the corpus does not author:\n`
        + unresolvedBindings.map((line) => `  ${line}`).join('\n')
        + '\n  regenerate with: node book/tools/map-calls.mjs',
    );
  }
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

    // EVERY call the start table lists is shipped too, so each one has to load and pose like the
    // default -- a selector entry that throws in the browser is invisible to a link check.
    for (const [i, s] of (f.starts ?? []).entries()) {
      const first = s.calls?.[0];
      if (i === 0 && first && (first.file !== f.file || first.tamIndex !== f.tamIndex)) {
        problems.push(`${f.id}: the first call of the first start formation is not the default authoring`);
      }
      for (const c of s.calls ?? []) {
        let alt;
        try {
          alt = loadCall(eng, { file: c.file, tamIndex: c.tamIndex });
        } catch (err) {
          problems.push(`${f.id}: start "${s.label}" / "${c.title}" cannot load ${c.file}#${c.tamIndex}: ${err.message}`);
          continue;
        }
        const b = alt.beats > 0 ? alt.beats : 1;
        for (const t of [0, b / 2, b]) {
          let ps = null;
          try {
            ps = eng.allPoses(alt, t);
          } catch (err) {
            problems.push(`${f.id}: start "${s.label}" / "${c.title}" allPoses(${t}) threw: ${err.message}`);
            break;
          }
          if (!ps || ps.length !== alt.dancers.length) {
            problems.push(
              `${f.id}: start "${s.label}" / "${c.title}" gave ${ps ? ps.length : 'nothing'} poses for ${alt.dancers.length} dancers`,
            );
            break;
          }
          poses++;
        }
        if (!(c.view?.scale > 0) || !(c.view?.units > 0)) {
          problems.push(`${f.id}: start "${s.label}" / "${c.title}" carries no usable view`);
        }
      }
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
    // A VIRTUAL CARD PREVIEWS ITS PLACEMENT, not the fragment the map binds: the fragment is what the card used
    // to play, and looking at it would tell you nothing about the picture that ships. Then, for a corpus card,
    // the map's site is a VARIANT ID, resolved exactly as the build resolves it.
    const virtuals = existsSync(VIRTUAL_INDEX) ? JSON.parse(readFileSync(VIRTUAL_INDEX, 'utf8')) : {};
    let resolved = virtuals.placements?.[id] ? { file: virtuals.placements[id].file, tamIndex: virtuals.placements[id].tamIndex } : null;
    if (!resolved) resolved = makeResolver(eng, loadRoots()).resolve(entry.e.sites[0]);
    if (!resolved) throw new Error(`the map's binding for ${id} does not resolve against the corpus`);
    const bundle = loadCall(eng, resolved);
    const frames = framesFor(eng, bundle, resolved);
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
    //
    // THE COMPARISON IS ON TEXT, NOT ON LINE ENDINGS. `core.autocrlf=true` is set host-wide here, so a
    // checkout hands this a CRLF file while the writer above produces LF - MEASURED, the check then
    // reported DRIFT for `animations-index.json` on a tree whose blob was identical, and the same
    // defect in `make-diagrams.mjs` did it for 5 of 6 SVGs. A gate that is red on every Windows clone
    // is a gate nobody reads (AGENTS.md §3), so both sides are normalised before comparing.
    const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
    let drift = 0;
    if (!existsSync(INDEX) || !sameText(readFileSync(INDEX, 'utf8'), JSON.stringify(index, null, 2))) {
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
