// A CONVERTED FORMATION'S DANCER ORDER, AND THE CALLS THAT FOLLOW IT - pinned.
//
// WHY THIS EXISTS. A named formation's `<dancer>` list is paired with a `<tam>`'s `<path>` list BY INDEX
// (`convert.ts`'s `buildCallImpl`), so the order of a formation is data every caller depends on. Reordering
// one without permuting its dependents silently gives each dancer somebody else's track, and nothing in the
// files shows it: the formation still names the same spots, the tams still parse, and the board still looks
// like a ring. There is no local invariant that says "these are the right paths for these dancers" - only
// where each dancer STARTS and where it ENDS - so the pin here is that geometry.
//
// WHAT IS PINNED, per formation:
//   - the compass order of its couples (`formationCompassOrder`), which is the thing being changed
//     (`Circle` was W,N,E,S where a square set is S,E,N,W - the reported defect);
//   - the dependent surface: how many tams name it, and how many in each file, so a new or removed caller is
//     a deliberate edit to this table rather than a silent change of scope;
//   - a DIGEST of every dependent's start-to-end pairs, keyed by the START SPOT. That digest is invariant
//     under a correct reorder - which is the whole point, "the order changed and nobody moved" - and it
//     changes the moment a dependent is left stale, because the dancer on a spot then ends somewhere else.
//
// The digest is computed from POSITIONS rounded to a millimetre, which is finer than the XML's four decimals
// and coarser than the float noise a permutation of existing curves carries (measured 3.23e-15 on the
// `Circle` conversion). See `scripts/reorder-formation.mjs` and `engine/src/formation-order.ts`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const engine = await import(pathToFileURL(path.join(ROOT, 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
// THE BLOCK RULE, imported rather than restated: it is the one the reorder tool edits by (see §2), and a probe
// that mirrored it would be measuring a copy of it (AGENTS.md §5).
const { liveTamBlocks } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'tam-blocks.mjs')).href);

const DEG = Math.PI / 180;
const assets = path.join(ROOT, 'assets');
const formationsXml = fs.readFileSync(path.join(assets, 'formations.xml'), 'utf8');
const movesXml = fs.readFileSync(path.join(assets, 'moves.xml'), 'utf8');
const formations = engine.parseFormations(formationsXml);
const moves = engine.parseMoves(movesXml);

let failures = 0;
const check = (cond, msg, detail = '') => {
  if (cond) console.log('  ok   ' + msg);
  else {
    failures++;
    console.log('  FAIL ' + msg + (detail ? `\n         ${detail}` : ''));
  }
};

/**
 * THE PIN. `spots` is the formation's COMPLETED order, index for index - the thing a conversion changes and
 * the only general way to state it, because `order` (compass letters) only names a board whose couples sit on
 * the compass points. `dependents` is the surface that has to follow; `digest` is the geometry that must not
 * move - so it is the SAME before and after a correct conversion, which is the property this pin exists to
 * state.
 *
 * `order: null` means the formation is NOT compass-class (a line has ends, not quarters), so its order is
 * pinned by `spots` alone - and the null is itself checked, so a formation that becomes compass-class has to
 * be reconsidered rather than silently keeping the label.
 *
 * `pending: true` would mean the order is still the BASELINE and the conversion is a separate commit. Every row
 * here is converted, so every one is `pending: false`.
 *
 * A DIGEST IS RE-RECORDED WHEN THE CALLS ARE RE-AUTHORED, AND ONLY THEN. The invariance above is about a
 * CONVERSION: reordering a formation and permuting its dependents' paths leaves every dancer on the spot it was on,
 * so the number does not move. Editing a CALL - aiming a curve, re-timing a move, moving a dancer - moves it,
 * because that is the geometry changing on purpose. MEASURED every time it has happened here: the `Circle`,
 * `Normal Lines Compact` and `Normal Lines` digests were re-recorded together when the corpus's own allemande and
 * circle authoring moved their callers, and `Inverted Lines Ends Facing In` a commit later as that authoring
 * continued; each re-record was taken from this harness's own output with the rest of the corpus unchanged, and the
 * rows' comments say what the conversion itself measured. A digest that is re-recorded WITHOUT the calls having
 * changed is the one thing this must never be used for - that is a stale dependent, and it is the defect the pin
 * exists to catch.
 */
const PINNED = {
  Circle: {
    // The square set's own order: couples 1-4 = south, east, north, west (FASR's Sequence field), boy then
    // girl within each couple. `Circle` was W,N,E,S before this conversion, which was the reported defect.
    order: 'SENW',
    pending: false,
    written: 4,
    spots: [
      [-1, -2.414], [1, -2.414], [2.414, -1], [2.414, 1],
      [1, 2.414], [-1, 2.414], [-2.414, 1], [-2.414, -1],
    ],
    dependents: { total: 23, files: { 'ms/allemande.xml': 2, 'ms/circle.xml': 16, 'ms/promenade.xml': 2, 'ms/sashay.xml': 3 } },
    digest: 'ef540042',
  },
  'Normal Lines Compact': {
    // A TWO-FACED LINE HAS NO COMPASS ORDER, so its order is the spot list: index 0-3 are the EAST line from
    // its SOUTH end northwards (each dancer facing west into the line), and 4-7 the WEST line from its NORTH
    // end southwards (facing east) - the completion turns each written dancer to its antipode and lists them in
    // that order. It was west-line-north-first before this conversion, so the order changed and no dancer moved
    // (the permutation was the IDENTITY: every path stayed on the spot that already had it).
    order: null,
    pending: false,
    written: 4,
    spots: [
      [1.5, -3], [1.5, -1], [1.5, 1], [1.5, 3],
      [-1.5, 3], [-1.5, 1], [-1.5, -1], [-1.5, -3],
    ],
    dependents: {
      total: 27,
      files: {
        'c1/cross_and_turn.xml': 1,
        'c2/circle_to_a_wave.xml': 2,
        'c2/once_removed_concept.xml': 4,
        'ms/circle.xml': 16,
        'ms/sweep_a_quarter.xml': 2,
        'plus/grand_swing_thru.xml': 2,
      },
    },
    digest: '8ad7af92',
  },
  'Normal Lines': {
    // A LINE HAS NO COMPASS ORDER, so the order is the spot list: index 0-3 are the EAST line from its SOUTH end
    // northwards (each dancer facing west into the line), and 4-7 the WEST line from its NORTH end southwards. It
    // was the west line in N->S order before this conversion, and the new written four are the OLD four's
    // antipodes index for index - so a half-set tam pairs every path with the same dancer and the permutation is
    // the IDENTITY. MEASURED by scripts/reorder-formation.mjs: 272 of 273 tams need no edit at all, the 273rd
    // being the one `actives` tam it will not touch, and the worst sampled geometry difference over all of them
    // is 2.66e-15. The digest below is therefore the same before and after, which is what it is for.
    order: null,
    pending: false,
    written: 4,
    spots: [
      [2, -3], [2, -1], [2, 1], [2, 3],
      [-2, 3], [-2, 1], [-2, -1], [-2, -3],
    ],
    dependents: {
      total: 273,
      files: {
        'a1/anything_and_cross.xml': 2,
        'a1/as_couples.xml': 8,
        'a1/cross_over_circulate.xml': 1,
        'a1/cross_trail_thru.xml': 2,
        'a1/double_star_thru.xml': 1,
        'a1/ends_bend.xml': 1,
        'a1/explode_the_line.xml': 2,
        'a1/mix.xml': 1,
        'a1/pass_in.xml': 4,
        'a1/quarter_in.xml': 4,
        'a1/reverse.xml': 1,
        'a1/square_chain_thru.xml': 4,
        'a1/step_and_slide.xml': 1,
        'a1/swap_around.xml': 4,
        'a1/turn_and_deal.xml': 1,
        'a1/wheel_thru.xml': 4,
        'a2/box_counter_rotate.xml': 1,
        'a2/recycle.xml': 4,
        'a2/spin_the_windmill.xml': 1,
        'a2/swing_and_mix.xml': 3,
        'c1/anything_and_spread.xml': 1,
        'c1/anything_chain_thru.xml': 1,
        'c1/anything_to_a_wave.xml': 3,
        'c1/circle_by.xml': 16,
        'c1/concentric_concept.xml': 7,
        'c1/counter_rotate.xml': 1,
        'c1/cross_and_turn.xml': 3,
        'c1/cross_roll.xml': 1,
        'c1/dixie_diamond.xml': 3,
        'c1/dixie_sashay.xml': 1,
        'c1/finish.xml': 1,
        'c1/interrupt.xml': 1,
        'c1/percolate.xml': 1,
        'c1/prefer.xml': 1,
        'c1/regroup.xml': 1,
        'c1/relay_the_shadow.xml': 1,
        'c1/square_chain_the_top.xml': 3,
        'c1/square_the_bases.xml': 1,
        'c1/stretch_concept.xml': 6,
        'c1/switch_to_a_diamond.xml': 1,
        'c1/tagging_calls_back_to_a_wave.xml': 1,
        'c1/twist_the_line.xml': 2,
        'c1/wheel_fan_thru.xml': 6,
        'c2/crazy_concept.xml': 3,
        'c2/cross_and_wheel.xml': 1,
        'c2/cross_concentric_concept.xml': 1,
        'c2/cross_the_k.xml': 2,
        'c2/disconnected_concept.xml': 1,
        'c2/hocus_pocus.xml': 1,
        'c2/lines_anything_thru.xml': 1,
        'c2/once_removed_concept.xml': 1,
        'c2/reverse_rotate.xml': 1,
        'c2/reverse_single_rotate.xml': 1,
        'c2/rims_trade_anything.xml': 1,
        'c2/rotate.xml': 8,
        'c2/sock_it_to_me.xml': 2,
        'c2/split_swap_around.xml': 4,
        'c2/turn_to_a_line.xml': 1,
        'c3a/anyone_hop.xml': 1,
        'c3a/central_concept.xml': 1,
        'c3a/drift_apart.xml': 1,
        'c3a/eight_by_anything.xml': 3,
        'c3a/finally_concept.xml': 1,
        'c3a/grand_mix.xml': 1,
        'c3a/scatter_circulate.xml': 1,
        'c3a/snap_the_lock.xml': 1,
        'c3a/stable_concept.xml': 1,
        'c3a/trade_the_deucey.xml': 1,
        'c3b/reverse_order.xml': 1,
        'c3b/trapezoid_formation.xml': 1,
        'ms/allemande.xml': 1,
        'ms/bend_the_line.xml': 1,
        'ms/allemande.xml': 1,
        'ms/cast_off_three_quarters.xml': 1,
        'ms/circle.xml': 22,
        'ms/circulate.xml': 3,
        'ms/dive_thru.xml': 1,
        'ms/dixie_style.xml': 2,
        'ms/dosado.xml': 1,
        'ms/flutterwheel.xml': 2,
        'ms/forward_and_back.xml': 1,
        'ms/fraction_tag.xml': 1,
        'ms/hinge.xml': 1,
        'ms/ladies_chain.xml': 4,
        'ms/ocean_wave.xml': 2,
        'ms/pass_the_ocean.xml': 1,
        'ms/pass_thru.xml': 1,
        'ms/right_and_left_thru.xml': 2,
        'ms/run.xml': 4,
        'ms/sashay.xml': 2,
        'ms/single_circle_to_a_wave.xml': 4,
        'ms/slide_thru.xml': 1,
        'ms/spin_the_top.xml': 2,
        'ms/square_thru.xml': 15,
        'ms/star_thru.xml': 1,
        'ms/sweep_a_quarter.xml': 1,
        'ms/swing_thru.xml': 2,
        'ms/tag.xml': 1,
        'ms/touch_a_quarter.xml': 2,
        'ms/trade.xml': 4,
        'ms/turn_back.xml': 1,
        'ms/veer.xml': 2,
        'ms/wheel_and_deal.xml': 1,
        'ms/wheel_around.xml': 2,
        'plus/acey_deucey.xml': 1,
        'plus/anything_and_roll.xml': 7,
        'plus/anything_and_spread.xml': 1,
        'plus/coordinate.xml': 1,
        'plus/crossfire.xml': 1,
        'plus/fan_the_top.xml': 2,
        'plus/load_the_boat.xml': 1,
        'plus/pair_off.xml': 2,
        'plus/partner_hinge.xml': 2,
        'plus/partner_tag.xml': 1,
        'plus/pass_the_sea.xml': 2,
        'plus/teacup_chain.xml': 1,
        'plus/turn_thru.xml': 1,
        'plus/walk_and_dodge.xml': 2,
      },
    },
    digest: '5f2b8bd5',
  },
  'Inverted Lines Ends Facing In': {
    // A LINE HAS NO COMPASS ORDER, so the order is the completed spot list: index 0-3 are the EAST line from its
    // SOUTH end northwards, and 4-7 the WEST line from its NORTH end southwards - the completion turns each written
    // dancer to its antipode and lists them in that order. It was the WEST line south-first before this conversion,
    // and the new written four are the old four's antipodes INDEX FOR INDEX, so a half-set tam gives every path back
    // to the dancer that already had it: the permutation is the IDENTITY and no caller is edited at all.
    // THE CONVERSION MEASURED, at the corpus as it stood then (scripts/reorder-formation.mjs): 39 tams in 33 files,
    // 0 change and 39 already read the same, worst sampled geometry difference 1.40e-15; the one tam it will not
    // touch is the actives one (a1/ends_bend.xml "Ends Bend"), measured by hand and identical under both blocks
    // (worst 4.97e-16, 0 of 8 dancers differ).
    // THE SURFACE IS NOW 41 tams in 35 files AND THE DIGEST HAS BEEN RE-RECORDED - not by a conversion, which moves
    // nobody, but because ms/allemande.xml gained a caller and the corpus's own authoring moved the geometry. The
    // same authoring moved Circle, Normal Lines Compact and Normal Lines in the next commit, and all four numbers
    // were re-taken together from this harness's own output - see the note on `PINNED` for when that is allowed.
    order: null,
    pending: false,
    written: 4,
    spots: [
      [2, -3], [2, -1], [2, 1], [2, 3],
      [-2, 3], [-2, 1], [-2, -1], [-2, -3],
    ],
    dependents: {
      total: 41,
      files: {
        'a1/any_hand_concept.xml': 3,
        'a1/cross_over_circulate.xml': 1,
        'a1/cycle_and_wheel.xml': 1,
        'a1/ends_bend.xml': 1,
        'a1/explode_and_anything.xml': 1,
        'a1/explode_the_line.xml': 2,
        'a1/linear_cycle.xml': 1,
        'a1/mix.xml': 1,
        'a1/right_roll_to_a_wave.xml': 2,
        'a1/step_and_slide.xml': 1,
        'a1/turn_and_deal.xml': 1,
        'a2/remake.xml': 1,
        'a2/swing_and_mix.xml': 1,
        'c1/counter_rotate.xml': 1,
        'c1/cross_roll.xml': 1,
        'c1/start.xml': 1,
        'c1/step_and_flip.xml': 2,
        'c1/step_and_fold.xml': 1,
        'c1/tally_ho.xml': 1,
        'c1/twist_the_line.xml': 1,
        'c2/sets_in_motion.xml': 1,
        'c2/sock_it_to_me.xml': 2,
        'c2/solid_concept.xml': 1,
        'c2/split_trade_circulate.xml': 1,
        'c2/turn_to_a_line.xml': 1,
        'c3a/drift_apart.xml': 1,
        'c3a/single_concept.xml': 1,
        'c3b/change_your_image.xml': 1,
        'ms/allemande.xml': 1,
        'ms/cast_off_three_quarters.xml': 1,
        'ms/circulate.xml': 1,
        'ms/fraction_tag.xml': 1,
        'ms/hinge.xml': 1,
        'plus/acey_deucey.xml': 1,
        'plus/crossfire.xml': 1,
      },
    },
    digest: '2bc851bd',
  },
};

/** A caller's identity in the pin: the file and the tam's title (a position is not an identity). */
const tamKey = (file, tam) => `${file}|${tam.title}`;

/** Every tam that names a formation, by canonical name, with the file it lives in. */
function dependentsOf(name) {
  const wanted = engine.canonicalName(name);
  const out = [];
  for (const dir of fs.readdirSync(assets, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    for (const file of fs.readdirSync(path.join(assets, dir)).filter((f) => f.endsWith('.xml'))) {
      const rel = `${dir}/${file}`;
      let tams;
      try {
        tams = engine.parseCallXml(fs.readFileSync(path.join(assets, rel), 'utf8'));
      } catch {
        continue;
      }
      for (const tam of tams) if (tam.formationAttr && engine.canonicalName(tam.formationAttr) === wanted) out.push({ rel, tam });
    }
  }
  return out;
}

/**
 * A POSITION AS MILLIMETRES, WITH THE SIGN OF A ZERO NORMALISED.
 *
 * `-0.000` AND `0.000` ARE THE SAME MILLIMETRE, but `toFixed(3)` prints them differently for a residue as small as
 * 1e-17 - and the digest is a hash OF STRINGS, so the sign of nothing changes it. MEASURED on the `Normal Lines`
 * conversion, whose new written four are the old four's antipodes index for index: the geometry is identical to
 * 2.66e-15 (the tool's own comparison), yet 25 of the 273 dependents read differently - every one of them
 * `0.000` against `-0.000` - and the digest moved. With this rounding applied, 0 of the 273 differ. A pin that
 * reports a movement where a dancer moved 1e-17 is a pin people learn to re-record instead of read.
 */
const mm = (v) => {
  const s = v.toFixed(3);
  return s === '-0.000' ? '0.000' : s;
};

/**
 * The geometry digest: for every dependent, every dancer's START spot and END spot, as millimetres, sorted
 * so the board's ORDER does not enter it - the order is pinned separately, and mixing the two would make the
 * digest fail for the very change it is supposed to survive.
 *
 * `formationsOverride` swaps the formation registry (the negative control builds with a deliberately WRONG
 * order), and `callOverride` replaces one dependent's built call.
 */
function geometryDigest(deps, opts = {}) {
  const map = opts.formationsOverride ?? formations;
  const override = opts.callOverride ?? new Map();
  const pairs = [];
  for (const [i, { rel, tam }] of deps.entries()) {
    let call;
    try {
      call = override.get(i) ?? engine.buildCall(tam, map, moves, true);
    } catch (err) {
      pairs.push(`${tamKey(rel, tam)}|BUILD-FAILED:${err.message}`);
      continue;
    }
    const ends = new Map();
    for (const d of call.dancers) {
      const s = engine.poseFor(d, 0);
      const e = engine.poseFor(d, call.beats);
      ends.set(`${mm(s.x)},${mm(s.y)}`, `${mm(e.x)},${mm(e.y)}`);
    }
    pairs.push(`${tamKey(rel, tam)}|${[...ends.entries()].map(([s, e]) => `${s}>${e}`).sort().join(';')}`);
  }
  // FNV-1a, 32 bits: a short stable digest for a long string. Nothing here is security-sensitive.
  let hash = 0x811c9dc5;
  for (const ch of pairs.sort().join('\n')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { digest: hash.toString(16).padStart(8, '0'), count: pairs.length };
}

// ------------------------------------------------------------------ 1. the pinned formations
console.log('\n== 1. a converted formation\'s order, and the calls that follow it ==');
for (const [name, pin] of Object.entries(PINNED)) {
  const authored = (formations.get(name) ?? []).map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }));
  const completed = engine.completedFormation(authored);
  const compass = engine.formationCompassOrder(completed);

  // THE ORDER ITSELF, which is what a conversion changes: the completed board, index for index, as
  // millimetres. This is the general pin - the compass letters below only name a board the compass can name.
  const observed = completed.map((p) => [Number(p.x.toFixed(3)), Number(p.y.toFixed(3))]);
  check(
    JSON.stringify(observed) === JSON.stringify(pin.spots),
    `"${name}" is ordered ${JSON.stringify(observed)}, pinned as ${JSON.stringify(pin.spots)}`,
    'the block was reordered without this pin - update the row, or revert the block',
  );

  // THE COMPASS LABEL IS FOR THE BOARDS THE COMPASS CAN NAME, and `null` is a claim too: a two-faced line has
  // ENDS rather than quarters, so its order is pinned by the spot list alone. A null that becomes compass-class
  // has to be reconsidered rather than silently keeping the label.
  if (pin.order === null) {
    check(
      compass === null,
      `"${name}" is not compass-class, pinned as none`,
      compass ? `the compass now reads ${engine.compassLetters(compass.order)} - decide what order it should have and pin the letters` : '',
    );
  } else {
    check(
      compass !== null && engine.compassLetters(compass.order) === pin.order,
      `"${name}" is ordered ${compass ? engine.compassLetters(compass.order) : 'off the compass'} (worst pairing error ${compass ? compass.worst.toFixed(2) : '-'} deg), pinned as ${pin.order}`,
      'the formation was reordered without this pin - update the block or revert it',
    );
  }
  check(authored.length === pin.written, `"${name}" writes ${authored.length} dancers, pinned as ${pin.written}`);

  const deps = dependentsOf(name);
  const files = {};
  for (const { rel } of deps) files[rel] = (files[rel] ?? 0) + 1;
  check(deps.length === pin.dependents.total, `${deps.length} tams name "${name}" by reference, pinned as ${pin.dependents.total}`);
  check(
    JSON.stringify(Object.entries(files).sort()) === JSON.stringify(Object.entries(pin.dependents.files).sort()),
    `and they are spread exactly as pinned: ${JSON.stringify(files)}`,
  );

  // EVERY DEPENDENT MUST BE WRITTEN IN A MODE A REORDER CAN FOLLOW: one path per written dancer (the
  // mirrored half reuses the local path) or one per completed dancer. Anything else pairs by a rule this
  // pin cannot speak for.
  const oddShape = deps.filter(({ tam }) => tam.paths.length !== authored.length && tam.paths.length !== 2 * authored.length);
  check(oddShape.length === 0, `every dependent writes either ${authored.length} paths (half set) or ${2 * authored.length} (whole set)`, oddShape.map(({ rel, tam }) => `${tamKey(rel, tam)}: ${tam.paths.length} paths`).join(', '));

  const { digest, count } = geometryDigest(deps);
  check(count === deps.length, `every dependent builds (${count}/${deps.length})`);
  check(
    digest === pin.digest,
    `the dependents' start-to-end geometry digest is ${digest}, pinned as ${pin.digest}` +
      (pin.pending ? '' : ' - a stale dependent moves its dancer and changes this'),
  );

  // THE TWO PAIRING MODES ARE NOT THE SAME RULE, and the whole-set one has no dependent to exercise it
  // today (every `Circle` caller writes the half set), so it is pinned here on the completed board. A
  // half-set tam may take its ANTIPODE's local path; a whole-set tam writes one path per completed dancer,
  // so the antipode's path is somebody else's track.
  //
  // THE WITNESS IS THE COMPLETED LIST TURNED BY HALF, which is the case that tells them apart: a new dancer
  // whose spot is the antipode of an old one matches that antipode FIRST under the half-turn rule, and only
  // its own spot under the exact rule. (Constructing the witness from the WRITTEN half cannot show this -
  // `Circle` writes S and E, whose antipodes are the unwritten N and W, so any rotation of the written four
  // has both rules agreeing. That is how the first version of this control passed a wrong rule.)
  const completedOld = engine.completedFormation(authored);
  const completedTurned = [...completedOld.slice(4), ...completedOld.slice(0, 4)];
  const loose = engine.formationReorderPermutation(completedOld, completedTurned);
  const exact = engine.formationReorderPermutation(completedOld, completedTurned, { halfTurn: false });
  check(
    loose.ok && exact.ok && JSON.stringify(loose.permutation) !== JSON.stringify(exact.permutation),
    'the half-turn rule and the exact rule give DIFFERENT permutations when a dancer moves to its antipode\'s spot, which is why a tam\'s path count picks one',
    `half-turn ${loose.ok ? JSON.stringify(loose.permutation) : loose.reason}, exact ${exact.ok ? JSON.stringify(exact.permutation) : exact.reason}`,
  );
  check(
    exact.ok && engine.permuteBy(completedOld, exact.permutation).every((p, i) => engine.sameSpotExact(p, completedTurned[i])),
    'and only the EXACT one maps every dancer onto its own spot, which is what a whole-set tam writes',
  );

  // THE NEGATIVE CONTROL: move ONE spot of the formation and leave the dependents' paths alone - the exact
  // fault a forgotten dependent has, and the one this pin exists to catch. The digest must change, or the pin
  // is measuring nothing.
  //
  // A MOVE RATHER THAN A REORDER, and the reason is measured: a call from a rotationally symmetric board often
  // writes the SAME local path for several written dancers (`Allemande Left` from `Circle` does), so rotating
  // the formation's order is a genuine no-op for those dependents and a rotation control would report a false
  // pass. Moving a spot changes where a dancer starts and therefore where it ends, whatever the call.
  //
  // AND IT IS BUILT FROM THE PARSED DANCERS, not from this file's poses: a formation handed to `buildCall` in
  // `{x, y, heading}` shape has no `angleDeg`, so every heading becomes NaN - a control that "changes the
  // digest" by breaking the geometry rather than by moving it.
  const movedFormation = new Map(formations);
  movedFormation.set(
    name,
    formations.get(name).map((d, i) => (i === 0 ? { ...d, x: d.x + 0.5 } : d)),
  );
  const movedDigest = geometryDigest(deps, { formationsOverride: movedFormation }).digest;
  check(
    movedDigest !== digest,
    `and moving one spot of "${name}" half a unit changes the digest (${digest} -> ${movedDigest}), so the pin is live`,
  );
}

// ------------------------------------------- 2. a tam's block is addressable by the index the parser gives it
console.log('\n== 2. every tam a reorder must edit is addressable by the index the parser gives it ==');
{
  // THE REORDER TOOL REWRITES THE BLOCK AT THE INDEX `parseCallXml` RETURNED, so a scan that counts blocks the
  // parser SKIPS edits the wrong call. The skip is a commented-out tam, and a sweep of the corpus is what says
  // whether that is hypothetical: the naive `<tam ...>...</tam>` regex found **5515** blocks where the parser
  // returns **5495**, and masking comments out closes the gap EXACTLY - which is the rule
  // `scripts/tam-blocks.mjs` implements and both this pin and the tool import.
  const mismatched = [];
  const overCounted = [];
  const census = { files: 0, raw: 0, live: 0, parsed: 0 };
  for (const dir of fs.readdirSync(assets, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    for (const file of fs.readdirSync(path.join(assets, dir)).filter((f) => f.endsWith('.xml'))) {
      const rel = `${dir}/${file}`;
      const text = fs.readFileSync(path.join(assets, rel), 'utf8');
      let tams;
      try {
        tams = engine.parseCallXml(text);
      } catch {
        continue;
      }
      census.files++;
      const live = liveTamBlocks(text).length;
      const raw = [...text.matchAll(/<tam\b[^>]*>[\s\S]*?<\/tam>/g)].length;
      census.live += live;
      census.raw += raw;
      census.parsed += tams.length;
      if (live !== tams.length) mismatched.push(`${rel}: ${live} live blocks, ${tams.length} parsed`);
      if (raw !== tams.length) overCounted.push(`${rel} +${raw - tams.length}`);
    }
  }
  check(
    mismatched.length === 0 && census.live === census.parsed,
    `${census.live} live <tam> blocks = the ${census.parsed} the parser returns, across ${census.files} call files`,
    mismatched.slice(0, 6).join('; '),
  );
  check(
    census.raw > census.live && overCounted.length > 0,
    `NEGATIVE CONTROL: without the mask the same scan finds ${census.raw}, i.e. ${census.raw - census.live} blocks that are not tams, in ${overCounted.length} files (${overCounted.join(', ')})`,
    'if this goes green with no excess, the mask has nothing to do and this section has stopped measuring',
  );

  // THE WITNESS, by name: the file that made the tool refuse. Its commented `Bend the Line and Spread` sat at
  // index 1, so every later block was one out - `"Pass the Ocean and Spread"` is index 9 in the live list and
  // index 10 in the raw one, which is why the tool answered the parser's index with `"Hinge and Spread"`. Both
  // halves are pinned, so a revert of the mask breaks a check that names the call it broke.
  const witness = fs.readFileSync(path.join(assets, 'plus', 'anything_and_spread.xml'), 'utf8');
  const liveWitness = liveTamBlocks(witness);
  const rawWitness = [...witness.matchAll(/<tam\b[^>]*>[\s\S]*?<\/tam>/g)];
  const titleAt = (blocks, i) => (blocks[i] ? (blocks[i].text.match(/title="([^"]*)"/) ?? [, '(none)'])[1] : '(missing)');
  const rawTitleAt = (blocks, i) => (blocks[i] ? (blocks[i][0].match(/title="([^"]*)"/) ?? [, '(none)'])[1] : '(missing)');
  check(
    titleAt(liveWitness, 9) === 'Pass the Ocean and Spread' && liveWitness.length === 15,
    `plus/anything_and_spread.xml: the live list's own index 9 is "Pass the Ocean and Spread" (${liveWitness.length} live blocks)`,
    `found "${titleAt(liveWitness, 9)}"`,
  );
  check(
    rawTitleAt(rawWitness, 9) === 'Hinge and Spread' && rawTitleAt(rawWitness, 10) === 'Pass the Ocean and Spread' && rawWitness.length === 16,
    `and the UNMASKED scan of the same file has "Hinge and Spread" at 9 and the same call at 10, one block out (${rawWitness.length} raw blocks) - the refusal this rule removed`,
    `found "${rawTitleAt(rawWitness, 9)}" / "${rawTitleAt(rawWitness, 10)}"`,
  );

  // THE BLOCK A CALLER GETS IS THE FILE'S OWN BYTES, COMMENTS INCLUDED. `matchAll` returns the substring it
  // matched IN THE STRING IT MATCHED, so the obvious implementation hands back the MASKED block - and a reorder
  // that wrote that back turned comments inside tams into runs of spaces while every geometry check stayed green
  // (a comment has no geometry). MEASURED, and this is the file it happened to: `c1/interrupt.xml` carries a
  // `<!--  Scoot and Little  -->` inside each of its paths.
  const bytesWitness = fs.readFileSync(path.join(assets, 'c1', 'interrupt.xml'), 'utf8');
  const bytesBlocks = liveTamBlocks(bytesWitness);
  const commentsInside = bytesBlocks.filter((b) => /<!--/.test(b.text)).length;
  check(
    bytesBlocks.every((b) => bytesWitness.slice(b.index, b.index + b.text.length) === b.text) && commentsInside > 0,
    `every live block is the file's own bytes, comments intact (c1/interrupt.xml: ${commentsInside} of ${bytesBlocks.length} blocks carry one)`,
    'a masked block would be spaces where a comment was - the corruption the write path must not be able to cause',
  );
}

// ------------------------------------------------------------------ 3. the rest of the corpus, reported
console.log('\n== 3. the rest of the corpus: how many formations are out of order (reported, not asserted) ==');
{
  // Every formation whose couples sit on the compass points is one a square-set order could name. The pin
  // above covers the converted ones; this line exists so a reader can see how much is deliberately NOT
  // converted rather than reading silence as "all in order".
  const compass = [];
  for (const name of formations.keys()) {
    const authored = formations.get(name).map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender }));
    const order = engine.formationCompassOrder(engine.completedFormation(authored));
    if (order) compass.push({ name, letters: engine.compassLetters(order.order) });
  }
  const canonical = compass.filter((f) => f.letters === 'SENW');
  console.log(`    ${compass.length} named formations have their couples on the compass points`);
  console.log(`    ${canonical.length} are in the square set's own order (SENW): ${canonical.map((f) => f.name).join(', ') || '(none)'}`);
  console.log(`    ${compass.length - canonical.length} are not, and each is a separate decision - one formation per conversion`);
  check(compass.length > 0, `the compass classification found formations (${compass.length}), so the reported zero above is not a coverage gap`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
