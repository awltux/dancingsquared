// Probe: THE BULK DANCER PICKS - `none`, `all`, `boys`, `girls` AND `matching`.
//
// Asked for: "Above the formation table, add dancer selectors for none, all, boys, girls and matching to make
// selecting dancers more efficient. The matching selector will select all dancers that match the currently
// selected Move(s) that can be edited together, if the currently selected Moves are already editable."
//
// `matching` is the only one with a question in it, and the answer has to be the GATE'S OWN: a set is
// editable together when every pair of its curves agrees by `sameCurve` (a half-pixel of movement along the
// travel curve, half a degree of turn for the facing), so `matching` must select exactly a set that passes
// that test - not a second, similar-looking notion of "the same move". This probe measures:
//
//   1. that the equivalence classes `matching` produces ALWAYS pass the gate, pairwise, over the corpus;
//   2. how much the feature is worth: how often the class of a dancer is bigger than the dancer alone;
//   3. and that the panel builds the set from `sameCurve` rather than from its own arithmetic, that the
//      button is refused unless the current selection already agrees, and that the EMPTY selection - which
//      `none` creates - is refused wherever an edit would otherwise silently go nowhere.
//
// Run: node tools/select-row-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
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

// THE PANEL'S GATE, copied in the two numbers that define it (`poc/src/editor-ui.ts`: SHAPE_WINDOW,
// FACING_WINDOW_DEG, travelGap, sameTravel, sameFacingCurve). A copy says so; the point of the measurement
// is what the RULE does to the corpus, and the rule is four lines of arithmetic around the engine's own
// `sameFacing`.
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
const sameCurve = (a, b, curve) =>
  curve === 'travel' ? travelGap(a, b) < SHAPE_WINDOW : engine.sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, FACING_WINDOW_DEG);

// The corpus: every call in the ms level, whole-set only.
const calls = [];
for (const f of fs.readdirSync(path.join(assets, 'ms')).filter((x) => x.endsWith('.xml'))) {
  try {
    const call = engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(assets, 'ms', f), 'utf8'), movesXml, formationsXml, 0));
    if (call.dancers.length === 8) calls.push({ file: f, call });
  } catch {
    /* not a call setup */
  }
}
console.log(`== What is being swept ==`);
console.log(`    ${calls.length} calls in the ms level, every dancer's every move`);

// The classes `matching` computes: the reference is a dancer, the class is everyone whose curve at that
// index is the same by the gate's own comparison. That relation is an EQUIVALENCE only if the comparison is
// transitive, which a tolerance is not in general - so the classes are built the way the PANEL builds them
// (everyone measured against ONE reference) rather than as a transitive closure, and the safety claim is
// checked on exactly those sets.
let groups = 0;
let useful = 0;
let biggest = 0;
let unsafe = 0;
const sizes = { travel: [], facing: [] };
for (const { call } of calls) {
  const maxMoves = Math.max(...call.dancers.map((d) => d.path.length));
  for (let k = 0; k < maxMoves; k++) {
    for (const curve of ['travel', 'facing']) {
      for (let ref = 0; ref < call.dancers.length; ref++) {
        const r = call.dancers[ref].path[k];
        if (!r) continue;
        const set = [];
        for (let j = 0; j < call.dancers.length; j++) {
          const seg = call.dancers[j].path[k];
          if (seg && sameCurve(r, seg, curve)) set.push(j);
        }
        groups++;
        sizes[curve].push(set.length);
        if (set.length > biggest) biggest = set.length;
        if (set.length > 1) useful++;
        // THE SAFETY CLAIM: every pair in the set passes the gate - which is what makes the buttons in the
        // tile live on the set `matching` picks.
        for (const a of set) {
          for (const b of set) {
            if (a < b && !sameCurve(call.dancers[a].path[k], call.dancers[b].path[k], curve)) unsafe++;
          }
        }
      }
    }
  }
}
console.log(`    ${groups} (dancer, move, curve) groups; the biggest class has ${biggest} dancers`);
check(groups > 500, 'the sweep is the whole level, not a witness or two');

// ---------------------------------------------------------------- 1. the sets are editable together
console.log('\n== 1. Every set `matching` picks passes the gate, pairwise ==');
check(unsafe === 0, `no pair inside any class disagrees by the gate's own comparison (${unsafe} did) - so the set a caller lands on is a set the fields accept`);

// ---------------------------------------------------------------- 2. what it is worth
console.log('\n== 2. How often does matching find more than the dancer you started from? ==');
for (const curve of ['travel', 'facing']) {
  const s = sizes[curve];
  const more = s.filter((n) => n > 1).length;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const full = s.filter((n) => n === 8).length;
  console.log(`    ${curve}: ${more} of ${s.length} groups have more than one dancer (${((100 * more) / s.length).toFixed(1)}%), mean class size ${mean.toFixed(2)}, and ${full} are the whole set of 8`);
}
check(useful > groups / 4, 'the pick is worth having: for a large share of the corpus it selects a set rather than a dancer');

// ---------------------------------------------------------------- 3. the wiring
console.log('\n== 3. The panel asks the gate, refuses the disagreement, and refuses the empty set ==');
const src = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
check(/private matchingDancers\(curve: CurveKind\)[\s\S]*?sameCurve\(ref, seg, curve\)/.test(src),
  'the matching set is built with `sameCurve` - the gate itself - so "the same move" has ONE definition in this file');
check(!/private matchingDancers\(curve: CurveKind\)[\s\S]{0,600}?(SHAPE_WINDOW|FACING_WINDOW_DEG|bezierPoint)/.test(src),
  'and it does not re-derive the comparison: no window and no Bezier arithmetic of its own');
check(/const agrees = sel\.length > 0 && this\.coordinatesAgree\(this\.tabCurve\(\)\);/.test(src) && /this\.selMatchBtn\.disabled = !agrees;/.test(src),
  'and `matching` is refused unless the current selection ALREADY agrees, which is the rule as asked for');
check(/if \(this\.selectedDancers\.size === 0\) \{\s*this\.statusEl\.textContent = 'no dancers selected/.test(src),
  'a write with nothing selected is refused out loud rather than quietly doing nothing');
check(/if \(this\.selectedDancers\.size === 0\) \{\s*host\.innerHTML = '<i class="small">no dancers selected/.test(src),
  'and the strip says so where the moves would be, instead of showing one dancer\'s moves as if they were the target');
check(/if \(sel\.length === 0\) return false;/.test(src), 'and the coordinate gate refuses an empty selection, which locks the fields rather than leaving them live');
check(/sel\.size > 0 \? ' focus' : ''/.test(src), 'and no dancer is drawn as the focus of a selection that does not exist');
// AND THE EXPLANATION IS A HOVER, NOT A LINE OF TEXT: a sentence between the buttons and the table is read
// once and read past afterwards, so it belongs on the button it is about.
const html = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
check(/this\.selMatchBtn\.title = /.test(src), 'what `matching` would pick is written into the button\'s TOOLTIP');
check(!/selInfoEl/.test(src) && !/edSelInfo/.test(html) && !/id="edSelInfo"/.test(html),
  'and the row carries no prose element of its own: the span the sentence used to live in is gone, not hidden');

// SHOWN TO FAIL, or it is decoration.
console.log('\n== the checks fail on the faults they were written for ==');
{
  const emptyGuard = src.replace(
    /if \(this\.selectedDancers\.size === 0\) \{\s*this\.statusEl\.textContent = 'no dancers selected/,
    "if (false) {\n      this.statusEl.textContent = 'no dancers selected",
  );
  check(emptyGuard !== src, 'the negative control really is a different file (the edit applied)');
  check(!/if \(this\.selectedDancers\.size === 0\) \{\s*this\.statusEl/.test(emptyGuard), 'with the empty-selection guard removed from the write path, the check fails - so it is not decoration');

  // And the claim in section 1 is about THIS comparison: widened past its window, the same sweep finds
  // pairs that the gate would refuse, so the classes would no longer be editable together.
  const WIDE = 4;
  let wideUnsafe = 0;
  for (const { call } of calls.slice(0, 3)) {
    for (let k = 0; k < Math.max(...call.dancers.map((d) => d.path.length)); k++) {
      const ref = call.dancers[0].path[k];
      if (!ref) continue;
      const set = call.dancers.map((d, j) => (d.path[k] ? j : -1)).filter((j) => j >= 0).filter((j) => travelGap(ref, call.dancers[j].path[k]) < WIDE);
      for (const a of set) for (const b of set) if (a < b && !sameCurve(call.dancers[a].path[k], call.dancers[b].path[k], 'travel')) wideUnsafe++;
    }
  }
  console.log(`    with the travel window widened to ${WIDE} units instead of ${SHAPE_WINDOW}: ${wideUnsafe} pairs inside a class would be REFUSED by the gate`);
  check(wideUnsafe > 0, 'the safety claim is a property of the gate\'s own window: loosen it and the sets stop being editable together');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
