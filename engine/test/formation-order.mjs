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
 * THE PIN. `order` is the compass order of the couples in the formation AS IT STANDS, and it is the one
 * field a conversion changes; `dependents` is the surface that has to follow; `digest` is the geometry that
 * must not move - so it is the SAME before and after a correct conversion, which is the property this pin
 * exists to state.
 *
 * `pending: true` means the formation's order is still the BASELINE and the conversion is a separate commit:
 * the row is then pinning the state that conversion will change, and the negative control below proves the
 * pin is live while it does.
 */
const PINNED = {
  Circle: {
    // The reported defect: couples ordered W,N,E,S where a square set orders them S,E,N,W (FASR's Sequence
    // field, couples 1-4 counter-clockwise, boy then girl within each couple).
    order: 'WNES',
    pending: true,
    written: 4,
    dependents: { total: 22, files: { 'ms/allemande.xml': 1, 'ms/circle.xml': 16, 'ms/promenade.xml': 2, 'ms/sashay.xml': 3 } },
    digest: '1ff72181',
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
      ends.set(`${s.x.toFixed(3)},${s.y.toFixed(3)}`, `${e.x.toFixed(3)},${e.y.toFixed(3)}`);
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
  check(!!compass, `"${name}" writes a whole set whose consecutive pairs sit on the compass`);
  if (compass) {
    check(
      engine.compassLetters(compass.order) === pin.order,
      `"${name}" is ordered ${engine.compassLetters(compass.order)} (worst pairing error ${compass.worst.toFixed(2)} deg), pinned as ${pin.order}`,
      pin.pending ? 'the conversion is still pending: this pin records the baseline' : 'the formation was reordered without this pin - update the block or revert it',
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

  // THE NEGATIVE CONTROL: build the dependents against a formation whose pairs are in a WRONG ORDER and leave
  // their paths where they are - the exact fault a forgotten dependent has, and the one this pin exists to
  // catch. The digest must change, or the pin is measuring nothing.
  //
  // IT IS THE FORMATION ORDER THAT MOVES, not two raw `<path>` blocks: a call from a rotationally symmetric
  // board often writes the same local path for every written dancer (`Allemande Left` from `Circle` does), so
  // swapping two of those is a genuine no-op and would report a false pass.
  const wrongOrder = new Map(formations);
  wrongOrder.set(
    name,
    [...authored.slice(2), ...authored.slice(0, 2)],
  );
  const wrongDigest = geometryDigest(deps, { formationsOverride: wrongOrder }).digest;
  check(
    wrongDigest !== digest,
    `and building the same calls against "${name}" with its pairs rotated changes the digest (${digest} -> ${wrongDigest}), so the pin is live`,
  );
}

// ------------------------------------------------------------------ 2. the rest of the corpus, reported
console.log('\n== 2. the rest of the corpus: how many formations are out of order (reported, not asserted) ==');
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
