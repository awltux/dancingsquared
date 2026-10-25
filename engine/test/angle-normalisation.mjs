// ONE RADIAN NORMALISER IN THE ENGINE, AND THE FOUR SITES THAT ARE DELIBERATELY NOT IT — plus the one
// degrees-per-radian constant, which is the same "one spelling" rule one order of magnitude simpler (§5).
//
// THE RULE. An angle is normalised into (-PI, PI] by `normAngle` in `src/moves.ts`, and every other radian
// normalisation in `engine/src` goes through it. `moves.ts` owns it because that module is where body-relative
// angle arithmetic lives (`turn` is the net heading change), because it is already the import path for seven
// sequencer modules, and because it is the public surface (`index.ts` re-exports `moves.js`).
//
// WHAT THIS REPLACED, MEASURED. Before the consolidation `engine/src` carried 21 angle-normalising expressions
// in SEVEN interval conventions, so the same call could differ in the last bits depending on which copy ran:
//   * (-PI, PI] spelled with a while loop — 6 sites (`editor.normAngleSafe`, `editor.ts` twice,
//     `apply-source.normalise`, `arm-turn.normalise`, `sequencer.ts`), and spelled `% (2 * PI)` — 1
//     (`moves.normAngle`);
//   * [-PI, PI]                          — 2 (`identity.normAngle`, `matcher.normAngleWrap`);
//   * `atan2(sin, cos)`                  — 5 (`core.ts`, `formation-order.norm`, `editor.ts`, `couples.ts`,
//     `progression.ts` — the last of which has itself since been deleted as dead code, so the count is the
//     pre-consolidation one and four of the five files survive);
//   * `abs(normalised difference)` as a named helper — 3 (`match.ts`, `fan-the-top.ts`, `swing-thru.ts`), and the
//     same composition folded in one place — 1 (`matrix.ts`);
//   * [0, 2PI)                           — 1 (`cells.ts`);
//   * distance from PI                   — 1 (`alignment.ts`);
//   * 2PI-congruent NEAREST a turn       — 1 (`editor.ts`'s sweep for a known turn).
// 16 of those now call this one. The endpoint is what the two closed-interval copies disagreed about: THIS RULE
// MAPS -PI TO +PI, and section 2 rules out the other interval by exactly that one check.
//
// FOUR SITES KEEP THEIR OWN SPELLING, and each says why in place, because "consolidate every angle expression"
// would change what they compute rather than which copy runs:
//   * `core.ts`'s mirrored-half heading is `atan2(sin(h + PI), cos(h + PI))`, and IT IS THE ONE THAT MEASURED
//     ITS WAY OUT. Replacing it with `normAngle` moved a GEOMETRIC TIE-BREAK: the 45-degree alignment in
//     `test/behaviour-audit.mjs` went from the identity mapping to a two-step cyclic shift, because the mirrored
//     dancers' headings differ in the last bit and two alignments of a squared set are equally exact. BISECTED
//     file by file — `core.ts` alone, restored, restores the mapping. A consolidation may not re-decide a
//     tie-break, so the spelling stays and the tie-break's fragility is on the record instead;
//   * `sequencer/cells.ts` folds to [0, 2PI) and then QUANTISES to CELL_ROUND for a sort key — a bucket, not an
//     angle anybody reads back;
//   * `editor.ts`'s `circleThrough` picks the 2PI-CONGRUENT VALUE NEAREST a turn, which is how a 3/4 turn stays
//     270 degrees instead of collapsing to -90;
//   * `matrix.ts`'s fold is `Math.abs(normAngle(...))` SPELLED OUT, because `moves.ts` imports `matrix.ts` and
//     `matrix.ts` imports nothing: importing the normaliser back would make `matrix -> moves -> matrix`, and
//     `moves`'s top-level `const`s would be read from `matrix` before they are initialised. Section 3 proves the
//     two are the same arithmetic, so the survivor cannot drift from the rule unnoticed.
//
// THE LAST SECTION IS THE GATE THAT KEEPS IT AT ONE: it reads `engine/src` and fails if a second normaliser
// appears. A structural check is the only way to test "there is no copy of this rule", and it is what makes a
// revert of any single deletion go red. §5 applies the same check to `DEG`, the engine's degrees-per-radian
// constant, and to the one book tool that used to declare a copy of it.
//
// Run: node test/angle-normalisation.mjs   (from engine/; needs `engine/dist`, no corpus and no parser)
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEG, normAngle } from '../dist/index.js';

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`);
  }
};

const TAU = 2 * Math.PI;
// `DEG` is IMPORTED from the package now — this harness printed degrees with its own copy until §5 became a census of
// copies, and a census that declares the constant it counts would be measuring itself.

// THE SAMPLE IS DETERMINISTIC: the awkward points spelled out, then an LCG over [-50PI, 50PI] so it reaches inputs
// a while-loop spelling would have re-subtracted many times. No `Math.random` anywhere.
const lcg = (() => {
  let s = 12345;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
})();
const SAMPLE = [
  0, -0, 1e-9, -1e-9, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2,
  Math.PI - 1e-12, -(Math.PI - 1e-12), Math.PI, -Math.PI, Math.PI + 1e-12, -(Math.PI + 1e-12),
  (3 * Math.PI) / 4, -(3 * Math.PI) / 4, TAU, -TAU, 3 * Math.PI, -3 * Math.PI,
  10 * Math.PI, -10 * Math.PI, 1234.5678, -1234.5678, 180 * DEG, -180 * DEG, 270 * DEG, 630 * DEG,
];
for (let i = 0; i < 200; i++) SAMPLE.push((lcg() * 2 - 1) * 50 * Math.PI);

console.log('== 1. the rule, over ' + SAMPLE.length + ' sampled angles ==');

const outOfInterval = SAMPLE.filter((a) => !(normAngle(a) > -Math.PI && normAngle(a) <= Math.PI));
check(outOfInterval.length === 0, `every output is in (-PI, PI] — ${outOfInterval.length} of ${SAMPLE.length} outside`);

// THE ENDPOINT IS THE WHOLE POINT. (-PI, PI] and [-PI, PI] agree everywhere else, so this is the one check that
// tells the rule from the interval two of the deleted copies used.
check(normAngle(-Math.PI) === Math.PI, 'and -PI normalises to +PI, not to -PI (the (-PI, PI] endpoint)');
check(normAngle(Math.PI) === Math.PI, 'and +PI stays +PI');

const notIdempotent = SAMPLE.filter((a) => normAngle(normAngle(a)) !== normAngle(a));
check(notIdempotent.length === 0, `normalising twice is normalising once — ${notIdempotent.length} exceptions`);

// THE SEAM IS A FULL TURN WIDE, AND THAT IS A PROPERTY, NOT NOISE: (+PI and -PI name the same direction, and this
// rule keeps only +PI, so an answer that lands ON the seam can come back as -PI+eps and differ from +PI by a whole
// turn.) Every comparison of two normalised angles below measures the gap BETWEEN THE DIRECTIONS, and the worst
// witness is printed so the seam case is visible rather than averaged away.
const seamGap = (x, y) => {
  const d = Math.abs(x - y);
  return Math.min(d, TAU - d);
};

// 2PI-PERIODIC, MEASURED RATHER THAN ASSERTED AS EXACTNESS: `a + 2PI` itself rounds and the seam is a full turn
// wide, so exact equality is not a claim the arithmetic can meet. The gap between the DIRECTIONS is pinned; exact
// equality IS asserted at 0, where the sum is exact.
const periods = [1, -1, 3, -3, 7];
let worstPeriod = 0;
let periodWitness = '';
for (const a of SAMPLE) {
  for (const k of periods) {
    const gap = seamGap(normAngle(a + k * TAU), normAngle(a));
    if (gap > worstPeriod) {
      worstPeriod = gap;
      periodWitness = `${a} + ${k}*2PI: ${normAngle(a + k * TAU)} vs ${normAngle(a)}`;
    }
  }
}
// MEASURED 7.82e-14 over a sample reaching 50PI; 1e-13 is the next round number above it. A CEILING: it may only
// fall. The drift is the rounding of `a + k*2PI`, not of the normaliser.
const PERIOD_CEILING = 1e-13;
check(worstPeriod <= PERIOD_CEILING,
  `adding whole turns moves the DIRECTION by at most ${worstPeriod.toExponential(2)} (ceiling ${PERIOD_CEILING.toExponential(0)}), because \`a + 2PI\` itself rounds`,
  worstPeriod > PERIOD_CEILING ? periodWitness : '');
check(normAngle(TAU) === normAngle(0) && normAngle(3 * TAU) === normAngle(0),
  'and where the sum IS exact — whole turns of zero — the periodicity is exact');

console.log('\n== 2. the conventions this rules out, each by exactly one check ==');

// THE [-PI, PI] FORM the deleted `identity`/`matcher` copies used. It passes the interval, idempotence and
// periodicity checks above; ONLY the -PI endpoint fact catches it, which is why that fact is asserted separately
// rather than folded into the interval.
const closedInterval = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
check(closedInterval(-Math.PI) === -Math.PI && normAngle(-Math.PI) === Math.PI,
  '[-PI, PI] differs from the rule at exactly -PI, and section 1\'s endpoint fact is what rules it out (nothing else does)',
  `closed(${-Math.PI}) = ${closedInterval(-Math.PI)}, normAngle(${-Math.PI}) = ${normAngle(-Math.PI)}`);

// THE [0, 2PI) FORM — the one `cells.ts` keeps — fails the interval check on its own, which is why the two are
// different functions rather than two spellings of one.
const zeroTo2Pi = (a) => ((a % TAU) + TAU) % TAU;
check(SAMPLE.some((a) => !(zeroTo2Pi(a) > -Math.PI && zeroTo2Pi(a) <= Math.PI)),
  '[0, 2PI) fails the interval check, so it cannot be substituted for the rule',
  `[0,2PI) of -0.5 = ${zeroTo2Pi(-0.5)}, the rule's = ${normAngle(-0.5)}`);

// THE while-loop (-PI, PI] FORM the six deleted copies used. Same RULE, different NUMBERS: repeated subtraction
// re-rounds where `%` is exact, so for |a| >= 2PI the two differ, and the difference is pinned as a CEILING so the
// substitution's error is a number rather than a claim. (That difference is also why the six sites were replaced
// and the rule itself was not rewritten: the rule keeps the exact spelling.)
const whileForm = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
};
let worstWhile = 0;
for (const a of SAMPLE) worstWhile = Math.max(worstWhile, Math.abs(whileForm(a) - normAngle(a)));
// MEASURED 3.08e-12 over a sample reaching 50PI, where the loop re-subtracts up to 25 turns and each subtraction
// rounds; 4e-12 is the next round number above that. A CEILING: it may only fall.
const WHILE_CEILING = 4e-12;
check(worstWhile <= WHILE_CEILING, `the while-loop spelling of the same interval agrees to ${worstWhile.toExponential(2)} (ceiling ${WHILE_CEILING.toExponential(0)})`);
check(whileForm(-Math.PI) === normAngle(-Math.PI), 'and the two agree at the -PI endpoint, which is why they are ONE rule');
// THE ONE CASE THE LOOP CANNOT BE ASKED ABOUT: `while (a > PI) a -= 2PI` never terminates on Infinity, so this
// check must not CALL it — that is why the rule keeps the modulo spelling, whose answer is NaN. (MEASURED the hard
// way while writing this: the harness hung for two minutes on the loop form.)

// THE atan2 FORM. It survives in ONE place (`core.ts`, section 3) for a measured reason, and this is what it costs:
// it is the CLOSED [-PI, PI] interval in disguise — `sin(-PI)` is NEGATIVE (-1.22e-16), so `atan2` returns -PI
// where the rule returns +PI — and it drifts as |a| grows, because `sin`/`cos` lose precision where the modulo is
// exact. Section 1's endpoint fact and this bound are the two checks that rule it out everywhere else.
const atan2Form = (a) => Math.atan2(Math.sin(a), Math.cos(a));
check(atan2Form(-Math.PI) === -Math.PI && normAngle(-Math.PI) === Math.PI,
  'atan2(sin, cos) is the CLOSED [-PI, PI] interval in disguise: it returns -PI for -PI, so the endpoint fact rules it out',
  `atan2(${-Math.PI}) = ${atan2Form(-Math.PI)}, the rule's = ${normAngle(-Math.PI)}`);
let worstAtan2 = 0;
let atan2Witness = '';
for (const a of SAMPLE) {
  const gap = seamGap(atan2Form(a), normAngle(a));
  if (gap > worstAtan2) {
    worstAtan2 = gap;
    atan2Witness = `${a} rad: atan2 ${atan2Form(a)} vs rule ${normAngle(a)}`;
  }
}
// MEASURED 4.80e-14 (the witness is ~50PI, where the transcendental pair has lost most of its precision); 1e-13 is
// the next round number above it. A CEILING: it may only fall.
const ATAN2_CEILING = 1e-13;
check(worstAtan2 <= ATAN2_CEILING, `away from that endpoint it agrees to only ${worstAtan2.toExponential(2)} (ceiling ${ATAN2_CEILING.toExponential(0)}), and the drift GROWS with |a|`, worstAtan2 > ATAN2_CEILING ? atan2Witness : '');

// A NON-FINITE INPUT normalises to NaN (`a % 2PI` of +-Infinity is NaN), which is the honest "this is not an
// angle" answer and reaches the refusal machinery. No caller produces one: every heading in the corpus is finite.
check(Number.isNaN(normAngle(Infinity)) && Number.isNaN(normAngle(-Infinity)) && Number.isNaN(normAngle(NaN)),
  'a non-finite input normalises to NaN rather than pretending to be an angle');

console.log('\n== 3. the survivors are different rules (or a measured exception), not copies ==');

// `core.ts`'s mirrored-half heading, transcribed with its site named. It is the SAME RULE up to the last bits — and
// that last bit is the whole reason it survives: BISECTED, restoring `core.ts` alone restored behaviour-audit's
// 45-degree alignment to the identity mapping, so replacing it re-decides a geometric tie-break. Stated as a bound.
const mirrorHeading = (h) => Math.atan2(Math.sin(h + Math.PI), Math.cos(h + Math.PI));
let worstMirror = 0;
for (const a of SAMPLE) worstMirror = Math.max(worstMirror, seamGap(mirrorHeading(a), normAngle(a + Math.PI)));
check(worstMirror <= ATAN2_CEILING,
  `core.ts's mirrored heading agrees with normAngle(h + PI) to ${worstMirror.toExponential(2)}, and it is kept because that gap moves a tie-break`);

// `matrix.ts`'s fold, transcribed with its site named: `moves.ts` imports `matrix.ts`, so it cannot import back.
const matrixFold = (d) => {
  let dh = Math.abs(d) % TAU;
  if (dh > Math.PI) dh = TAU - dh;
  return dh;
};
let worstFold = 0;
for (const a of SAMPLE) worstFold = Math.max(worstFold, Math.abs(matrixFold(a) - Math.abs(normAngle(a))));
check(worstFold === 0,
  `matrix.ts's fold IS abs(normAngle(...)) exactly — worst difference ${worstFold}, so the cycle-bound spelling cannot drift from the rule`);

// `cells.ts`'s fold, transcribed from its line: a BUCKET KEY, quantised to CELL_ROUND after this.
check(zeroTo2Pi(-0.5) !== normAngle(-0.5),
  `cells.ts's bucket key is a different number for the same heading (-0.5 keys as ${zeroTo2Pi(-0.5).toFixed(3)}, the rule gives ${normAngle(-0.5).toFixed(3)}) — replacing it would move a heading to another cell`);

// `editor.ts`'s nearest-congruent selection, transcribed from its line: the base sweep of a 3/4 turn is -90deg, and
// the answer must stay 270 — the case the editor's own comment calls the one that proves the wrap is needed.
const nearestCongruent = (base, turn) => base + Math.round((turn - base) / TAU) * TAU;
check(Math.abs(nearestCongruent(-Math.PI / 2, (3 * Math.PI) / 2) - (3 * Math.PI) / 2) < 1e-12,
  `editor.ts's congruent-nearest rule keeps a 3/4 turn at ${(nearestCongruent(-Math.PI / 2, (3 * Math.PI) / 2) / DEG).toFixed(0)} degrees where normAngle gives ${(normAngle((3 * Math.PI) / 2) / DEG).toFixed(0)} — it is not a normaliser`);

console.log('\n== 4. there is ONE normaliser in engine/src, and this is the gate that keeps it that way ==');

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..', 'src');
const files = readdirSync(srcDir, { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.ts'))
  .map((f) => f.split(path.sep).join('/'))
  .sort();
// A ZERO FROM A WALK THAT READ NOTHING IS NOT A PASS, so the population is asserted against the tree's size and
// printed. (It was 51 files when this gate landed; the check is "not empty", not "exactly 51", because adding a
// module must not redden a gate about angles.)
check(files.length > 40, `the walk found ${files.length} .ts files under engine/src`, srcDir);

// COMMENTS ARE STRIPPED BEFORE MATCHING, and that is not tidiness: the rule's own header QUOTES the interval and the
// code comments name the alternatives, so a raw scan reports the rule as a survivor of itself. LINE COMMENTS GO
// FIRST, and that ordering is the whole subtlety: `core.ts`'s header says "taminations' lib/math/*.dart", and a
// block-comment strip applied first started a block at THAT `/*` and swallowed 7.8 KB of real code — MEASURED while
// writing this, as the atan2 scan reporting zero hits in a file that has one.
const stripComments = (text) =>
  text.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
const hits = (pattern) => {
  const found = [];
  for (const f of files) {
    const text = stripComments(readFileSync(path.join(srcDir, f), 'utf8'));
    text.split('\n').forEach((line, i) => {
      if (pattern.test(line)) found.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
};

// THE while-LOOP SPELLINGS ARE GONE. A NAMED SET of zero files: the rule itself uses `%`, so any file normalising
// with a loop on PI is a new copy. The pattern matches a standalone `PI` as well as `Math.PI`, so an alias does not
// walk past it.
const whileLoopFiles = [...new Set(hits(/while \([^)]*\bPI\b/).map((h) => h.split(':')[0]))].sort();
check(whileLoopFiles.length === 0,
  `no file normalises with a while loop on PI — was 11 sites across 9 files, now ${whileLoopFiles.length}`,
  whileLoopFiles.join(', '));

// THE atan2 SPELLING SURVIVES IN EXACTLY ONE FILE, and it is the one section 3 measured its way out of. A NAMED SET:
// it fails when the set grows (a new copy) and when it shrinks (a survivor was converted without re-running the
// audit's 45-degree alignment).
const atan2Files = [...new Set(hits(/atan2\(Math\.sin/).map((h) => h.split(':')[0]))].sort();
check(JSON.stringify(atan2Files) === JSON.stringify(['core.ts']),
  `the only atan2(sin, cos) left is core.ts's mirrored half: ${atan2Files.join(', ') || '(none)'}`,
  'was 6 sites across 5 files');

// THE 2PI FOLDS LEFT ARE THE RULE AND THE TWO DOCUMENTED SURVIVORS THAT FOLD. A NAMED SET, so it fails when the set
// GROWS (a new copy, which is the defect) and when it SHRINKS (a survivor was quietly converted and its comment
// now lies).
const foldFiles = [...new Set(hits(/% ?\(2 \* (?:Math\.)?PI\)/).map((h) => h.split(':')[0]))].sort();
const EXPECTED_FOLDS = ['matrix.ts', 'moves.ts', 'sequencer/cells.ts'];
check(JSON.stringify(foldFiles) === JSON.stringify(EXPECTED_FOLDS),
  `the only 2PI folds left are the rule and its two folding survivors (${foldFiles.length}): ${foldFiles.join(', ')}`,
  `expected ${EXPECTED_FOLDS.join(', ')}`);

// AND `normAngle` ITSELF IS DEFINED EXACTLY ONCE, in moves.ts.
const definitions = hits(/function normAngle|const normAngle\b|export const normAngle/);
check(definitions.length === 1 && definitions[0].startsWith('moves.ts:'),
  `normAngle is defined exactly once, in moves.ts — ${definitions.length} definition(s)`, definitions.join('; '));

// ---------------------------------------------------------------------------------------------------------------
// 5. THE SAME RULE FOR `DEG`, one order of magnitude simpler.
//
// `DEG` is `Math.PI / 180`, the factor that takes a degree measure to radians, and `core.ts` owns it because that is
// the module that reads dancer angles. It is on the public surface (`index.ts` re-exports `core.js`), so the way to
// use it is to import it — `poc/tools/end-spin-probe.mjs` has always done exactly that (`const DEG = engine.DEG`).
//
// WHAT THIS REPLACED, MEASURED when §5 landed: `engine/src` held TWO declarations — `core.ts:8` and a bare copy in
// `formation-order.ts:57`, four lines below a comment listing the module's imports — and `book/tools` held a third, in
// `make-formations.mjs`, which loads the engine already for every other answer it draws.
//
// THE CENSUS STOPS AT THE PACKAGES THAT OWN THE UNIT, on purpose. Outside them a local `DEG` is not automatically a
// copy of this value: MEASURED tree-wide, 25 further declarations exist in the probes, and **13 of them are
// `180 / Math.PI` — the RECIPROCAL — under the same name** (`rotation-tiebreak`, `arc-centre-probe`, `arm-turn-probe`,
// `call-formations-probe`, `clone-refusal-probe`, `connect-assign-probe`, `end-pair-probe`, `facing-chain-probe`,
// `move-end-probe`, `run-circle-probe`, `wysiwyg-path-probe`, `promenade-pair-probe`, `promenade-travel-probe`).
// Re-pointing one of those at the engine would INVERT its factor, so converting them is a rename, not an import, and
// it is recorded in `TODO.md` rather than smuggled in here. What this section does pin is the thing that was wrong:
// no package that owns the unit may spell it twice.
console.log('\n== 5. `DEG` is declared once, in core.ts, and the book takes it from the engine ==');

// THE VALUE ITSELF, so the spelling checks below are about a constant that is really pi/180.
check(DEG === Math.PI / 180, `the exported DEG is Math.PI / 180 (${DEG})`);

// (a) THE ENGINE'S POPULATION IS A FACT: exactly one declaration, and it is core.ts's.
const degDefinitions = hits(/const DEG = Math\.PI \/ 180/);
check(degDefinitions.length === 1 && degDefinitions[0].startsWith('core.ts:'),
  `DEG is declared exactly once under engine/src, in core.ts — ${degDefinitions.length} definition(s)`,
  degDefinitions.join('; '));

// (b) THE RECIPROCAL IS NOT THIS CONSTANT. A NAMED SET of zero files: `180 / Math.PI` under the name `DEG` is the
// other unit wearing this one's name, and `engine/src` writes the reciprocal as `rad / DEG` (`formation-order.ts`).
const degReciprocal = hits(/const DEG = 180 \/ Math\.PI/);
check(degReciprocal.length === 0,
  `no file under engine/src calls the reciprocal DEG (${degReciprocal.length} do)`, degReciprocal.join('; '));

// (c) THE BOOK DRAWS FROM THE SAME UNIT, and loads the engine for every other engine value it needs, so it declares
// none of its own. A NAMED SET of zero files — a declaration BOUND to the engine (`= loadEngine().DEG`) is not
// matched, because it is not a copy. MEASURED when this landed: `make-formations.mjs` was the only copy there.
const bookTools = path.resolve(here, '..', '..', 'book', 'tools');
const bookFiles = readdirSync(bookTools, { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.mjs'))
  .map((f) => f.split(path.sep).join('/'))
  .sort();
check(bookFiles.length > 15, `the book walk found ${bookFiles.length} .mjs files under book/tools`, bookTools);
const bookDegs = [];
for (const f of bookFiles) {
  const text = stripComments(readFileSync(path.join(bookTools, f), 'utf8'));
  text.split('\n').forEach((line, i) => {
    if (/const DEG = Math\.PI \/ 180/.test(line)) bookDegs.push(`book/tools/${f}:${i + 1}: ${line.trim()}`);
  });
}
check(bookDegs.length === 0,
  `no book tool declares its own DEG — the engine's is loaded (${bookDegs.length} do)`, bookDegs.join('; '));

console.log(`\n${failures === 0 ? 'angle-normalisation: all checks hold' : `angle-normalisation: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);