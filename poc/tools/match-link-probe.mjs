// Probe: THE MATCH LINK - does pressing it actually make the dancer match?
//
// Asked for: "When Select: matching is pressed, the dancers that match are selected. Add a link symbol next to
// the dancers that dont match, that will correct the non-matching coordinates using the matching coodinates.
// Remove the link once they do match and select the now matching dancer."
//
// THE WHOLE FEATURE RESTS ON ONE PROPERTY, and it is checkable rather than arguable: the correction has to make
// the dancer MATCH. The link is drawn on `!matchingDancers(...).includes(i)`, so if the copy does not satisfy
// the same comparison, the link stays on screen after the press and the gesture does nothing the caller can
// see. This probe measures exactly that, for both curves, over the corpus.
//
// THE FACING CASE IS THE ONE WORTH MEASURING, because `rotate ?? translate` is what a facing IS: a dancer with
// no rotation curve faces along its own travel tangent, so copying a NULL copies nothing and leaves the dancer
// facing by its own path. That is measured here as a mutation - the count of dancers the naive copy would fail
// to fix - so the `?? translate` is a number rather than a preference.
//
// Run: node tools/match-link-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const assets = path.join(POC_DIR, 'src', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ============================================================ 1. the wiring
console.log('== 1. Is the link wired to the rule this probe mirrors? ==');
const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
const has = (re, msg) => check(re.test(ui), msg);
has(/private matchDancer\(i: number, curve: CurveKind\)/, 'there is one method that makes a dancer match');
has(/if \(this\.coordinatesAgree\(linkCurve\) && !this\.matchingDancers\(linkCurve\)\.includes\(i\)\)/,
  'the link is offered EXACTLY when the correction is defined: the selection agrees, and this dancer is not in the matching set');
has(/link\.addEventListener\('click', \(\) => this\.matchDancer\(i, linkCurve\)\)/, 'and clicking it calls that method');
has(/this\.selectedDancers\.add\(i\);/, 'which SELECTS the dancer, which is the second half of what was asked for');
has(/const source = curve === 'facing' \? ref\.rotate \?\? ref\.translate : ref\.translate;/,
  'the coordinates come from the selection\'s own curve, and a facing falls back to the travel curve when there is no rotation Bezier');
has(/link\.dataset\.key = `r\$\{i\}:match`/, 'the link carries a key of its own');
// The comparison the link is drawn on is the SAME one the coordinate gate uses, so "matches" cannot mean two
// things. The probe mirrors these two functions below and they are checked to be the ones in the source.
has(/function sameCurve\(a: Seg, b: Seg, curve: CurveKind\): boolean \{\s*\n\s*return curve === 'travel' \? sameTravel\(a, b\) : sameFacingCurve\(a, b\);/, 'and "matches" is the gate\'s own `sameCurve`, not a second definition of the same word');
has(/const SHAPE_WINDOW = 0\.025;/, `the travel window is 0.025 units`);
has(/const FACING_WINDOW_DEG = 0\.5;/, 'and the facing window is half a degree');

// ============================================================ 2. the mirror
//
// Mirrored rather than imported: both are module-private in the controller, and a probe that could not run the
// rule could not measure it. Section 1 pins the constants and the wiring they live in.
const SHAPE_WINDOW = 0.025;
const FACING_WINDOW_DEG = 0.5;
const travelGap = (a, b) => {
  let gap = 0;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const qa = engine.bezierPoint(a.translate, t);
    const qb = engine.bezierPoint(b.translate, t);
    gap = Math.max(gap, Math.hypot(qa.x - qb.x, qa.y - qb.y));
  }
  return gap;
};
const sameTravel = (a, b) => travelGap(a, b) < SHAPE_WINDOW;
const sameFacingCurve = (a, b) => engine.sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, FACING_WINDOW_DEG);
const sameCurve = (a, b, curve) => (curve === 'travel' ? sameTravel(a, b) : sameFacingCurve(a, b));

/** The panel's copy, exactly: the tab's curve, taken from the reference, into this dancer's move. */
const applyMatch = (seg, ref, curve) => {
  const source = curve === 'facing' ? ref.rotate ?? ref.translate : ref.translate;
  return curve === 'facing' ? { ...seg, rotate: { ...source } } : { ...seg, translate: { ...source } };
};
/** The OTHER reading, for the mutation: copy the tab's own field and nothing else. */
const applyNaive = (seg, ref, curve) => (curve === 'facing' ? { ...seg, rotate: ref.rotate ? { ...ref.rotate } : null } : { ...seg, translate: { ...ref.translate } });

// ============================================================ 3. the correction matches, always
console.log('\n== 2. Does the copy make the dancer match? ==');
const files = [];
for (const lvl of ['ms', 'b1', 'b2', 'a1', 'a2', 'plus']) {
  for (const f of fs.readdirSync(path.join(assets, lvl)).filter((x) => x.endsWith('.xml'))) files.push([lvl, f]);
}
let pairs = 0;
let travelOk = 0;
let facingOk = 0;
let naiveFacingFails = 0;
const naiveWitness = [];
for (const [lvl, f] of files) {
  let tams = [];
  try { tams = engine.parseCallXml(asset(`${lvl}/${f}`)); } catch { continue; }
  for (const tam of tams.slice(0, 2)) {
    let call;
    try { call = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true)); } catch { continue; }
    if (call.dancers.length !== 8) continue;
    const n = call.dancers[0].path.length;
    for (let k = 0; k < n; k++) {
      const ref = call.dancers[0]?.path[k];
      if (!ref) continue;
      for (let j = 1; j < 8; j++) {
        const seg = call.dancers[j]?.path[k];
        if (!seg) continue;
        pairs++;
        if (sameCurve(ref, applyMatch(seg, ref, 'travel'), 'travel')) travelOk++;
        if (sameCurve(ref, applyMatch(seg, ref, 'facing'), 'facing')) facingOk++;
        // The mutation, counted rather than asserted in the abstract.
        if (!sameCurve(ref, applyNaive(seg, ref, 'facing'), 'facing')) {
          naiveFacingFails++;
          if (naiveWitness.length < 3) naiveWitness.push(`${lvl}/${f} move ${k + 1} dancer ${j + 1}`);
        }
      }
    }
  }
}
console.log(`    ${pairs} (reference move, other dancer) pairs over ${files.length} files`);
check(pairs > 1000, 'the sample is the corpus, not a witness');
check(travelOk === pairs, `the TRAVEL copy matches in ${travelOk} of ${pairs} - so the link always goes`);
check(facingOk === pairs, `and the FACING copy matches in ${facingOk} of ${pairs}`);
check(naiveFacingFails > 0,
  `and copying the rotation Bezier ALONE would leave ${naiveFacingFails} of them still not matching (${((100 * naiveFacingFails) / pairs).toFixed(1)}%) - the \`?? translate\` is what closes those, e.g. ${naiveWitness.join(', ')}`);
// A CONTROL on the mirror itself: the same comparison has to say NO to two genuinely different curves, or the
// "matches in every case" above would be a comparison that always says yes.
let refusals = 0;
for (const [lvl, f] of files.slice(0, 40)) {
  let tams = [];
  try { tams = engine.parseCallXml(asset(`${lvl}/${f}`)); } catch { continue; }
  for (const tam of tams.slice(0, 1)) {
    let call;
    try { call = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true)); } catch { continue; }
    if (call.dancers.length !== 8) continue;
    const a = call.dancers[0]?.path[0];
    const b = call.dancers[1]?.path[0];
    if (!a || !b) continue;
    if (!sameCurve(a, b, 'travel')) refusals++;
    break;
  }
}
check(refusals > 0, `and the same comparison REFUSES a genuinely different pair (${refusals} of the first 40 files), so "matches" is not a function that always returns true`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
