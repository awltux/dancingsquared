// THE MAGIC NUMBERS THIS TREE STILL SPELLS, and the five that already decide a rule under a bare literal.
//
// WHY THIS IS A GATE. "Convert the magic numbers to named constants" is not measurable if the answer is "all 751
// decimal literals", and it is wrong if it names data or decoration. So this file states the RULE the refactor runs on
// and then pins what is left after it:
//
//   A NUMBER EARNS A NAME WHEN IT IS A RULE RATHER THAN DATA, AND EITHER DUPLICATED OR DOCUMENTED-BUT-UNNAMED.
//
// Measured against that rule, the class is not the literal population — the engine already names ~40 constants, from
// `DEFAULT_MATCH_MAX` to `DANCER_WIDTH` — it is the tolerance literals spelled INLINE, plus three numbers that decide a
// rule while sitting in the code as a literal:
//
//   * `maxError / 12` — the tolerance that ACTUALLY binds. `constants.ts` documents it ("the effective per-dancer
//     allowance is this value / 12 and the 12 is what actually decides it") and the `12` is written in three places.
//   * `0.48` — the marker size. `book/tools/lib/board-style.mjs` exports `MARKER_UNITS` and its own header says the
//     two-copies defect is why the module exists, yet two other book tools declare their own.
//   * `3.0` — the reference's `minDistance` in `swing-thru.ts`, twice, beside a properly named `DELTA = 0.1`.
//
// WHAT THIS FILE DOES NOT PIN, on purpose, because each was measured and rejected as a candidate:
//   * DATA: `game/src/game/season-data.ts` holds ~350 authored `0.5`/`1.5`/`3.5` literals. That is the corpus's
//     content, not a rule.
//   * DECORATION: the canvas/force/opacity numbers in `poc/src/fsm-view.ts` and `packages/stage/scene.ts`. Each is
//     used once, none is shared, and `scene.ts` already imports the engine's `DANCER_WIDTH`/`DANCER_DEPTH` and names
//     its own `INSET_MAX_FRACTION` — the renderer is not where the magic numbers are. (`fsm-view.ts`'s two tolerances
//     are still COUNTED below, because the census is about where literals are, not about what each one means.)
//   * PROBE FIXTURES: `40.91` px/unit in four probes. A probe is a self-contained instrument that states the view it
//     measured at; sharing the number would share a measurement, not a rule.
//   * TIE EPSILONS are their own rule and stay their own constants: `TIE_EPS`, `MATCH_TIE_EPS`, `REFLECT_TIE_EPS`,
//     `CHOICE_TIE_EPS` all answer "equal enough to tie", which is NOT "this should be zero". The census counts them as
//     named declarations precisely so they are not merged into the zero tolerance by a later tidy-up.
//
// THE PINS ARE NAMED SETS OF `path count`: a refactor that removes a site changes a number in one file and the pin is
// updated in the commit that does it, while a NEW unnamed tolerance shows up as a file that was not in the set. That is
// the same discipline as `test/tam-readers.mjs`.
//
// Usage: node engine/test/tolerances.mjs   (no engine build needed: it reads source text only)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const walk = (dir, exts = ['.ts']) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
};
/** Code lines only: a tolerance quoted in a comment is not a site (AGENTS.md 8 trap 1's lesson, for literals). */
const codeLines = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
/** A DECLARATION is the NAMED side of the question, not an inline site - section 2 pins those by name and value. The
 *  match covers `const X = …`, an indented local, a type annotation, and `private static readonly`. */
const NAMED_DECL = /\b(?:const|readonly)\s+[A-Z][A-Z0-9_]*\s*(?::[^=]+)?=/;
const inlineSites = (text, tol) => codeLines(text).filter((l) => l.includes(tol) && !NAMED_DECL.test(l)).length;

console.log('== 1. The tolerance literals still spelled inline ==');
{
  const TOLS = ['1e-9', '1e-6', '1e-3', '1e-12'];
  const TREES = ['engine/src', 'poc/src'];
  const files = TREES.flatMap((t) => walk(path.join(root, t)));
  check(files.length > 80, `the walk has a population (${files.length} TypeScript files in ${TREES.join(' + ')})`);
  // THE PIN, from the measurement this file prints. A site moved between files is a change; a file with no tolerance
  // in it must not appear. What remains after R8 is the class that CANNOT be named: rule-specific thresholds that are
  // neither duplicated nor documented as a named rule (a half-turn check, a matrix-identity test, a turn-direction
  // test, the POC view's force floor) - plus the POC's copies, which the app-side commit removes.
  const EXPECTED = {
    '1e-9': [
      'poc/src/editor-ui.ts 5',
      'poc/src/sequencer-ui.ts 1',
    ],
    '1e-6': [
      'engine/src/formation-order.ts 1',
      'engine/src/moves.ts 2',
      'engine/src/sequencer/alignment.ts 1',
      'engine/src/sequencer/sequence.ts 1',
      'engine/src/sequencer/solver.ts 2',
      'poc/src/fsm-view.ts 2',
    ],
    '1e-3': [
      'engine/src/matrix.ts 1',
      'engine/src/moves.ts 1',
      'engine/src/sequencer/applicator.ts 1',
      'engine/src/sequencer/fsm-store.ts 1',
      'engine/src/sequencer/solver.ts 2',
      'poc/src/fsm-view.ts 2',
    ],
    '1e-12': ['engine/src/editor.ts 2', 'engine/src/matrix.ts 1'],
  };
  for (const tol of TOLS) {
    const actual = [];
    for (const file of files) {
      const n = inlineSites(fs.readFileSync(file, 'utf8'), tol);
      if (n) actual.push(`${rel(file)} ${n}`);
    }
    actual.sort();
    const sites = actual.reduce((a, c) => a + Number(c.split(' ').pop()), 0);
    console.log(`     ${tol}: ${actual.length} file(s), ${sites} inline site(s)`);
    for (const c of actual) console.log(`       ${c}`);
    check(JSON.stringify(actual) === JSON.stringify(EXPECTED[tol]),
      `${tol} is spelled inline in exactly ${EXPECTED[tol].length} file(s) (${actual.length} found; a named declaration is not a site)`);
  }
}

console.log('\n== 2. The tolerance constants: one declaration each, and the value written down once ==');
{
  // THE NAMED SIDE OF THE SAME QUESTION. `GRID_SNAP_EPS` is module-private and `END_BOARD_TOL` is an object, so the
  // declaration is matched with an optional type annotation and the RHS pinned as TEXT.
  const DECLARED = {
    // THE CROSS-CUTTING TWO, and the divisor, from the R8 refactor. Their VALUES are pinned here as well as in their
    // own headers, so a silent re-pin is a red line rather than a one-word diff.
    EXACT_TOL: '1e-9',
    XML_ROUND_TRIP_TOL: '1e-3',
    SIGNATURE_DIVISOR: '12',
    DEFAULT_MATCH_MAX: '1.5',
    SEARCH_MATCH_MAX: '6.0',
    KNOWN_FORMATION_MAX: '6.0',
    SAME_BOARD_TOL: '1e-6',
    ARC_TOL: '1e-3',
    ARC_FIT_TOL: '0.02',
    ARC_ANGLE_TOL: '(0.5 * Math.PI) / 180',
    BODY_OVERLAP_EPS: '1e-3',
    END_BOARD_TOL: '{ position: 5e-2, heading: 7.5e-2 }',
    CELL_ROUND: '0.05',
    MIRROR_EPS: '0.01',
    GRID_SNAP_EPS: '(10 * Math.PI) / 180',
    RUN_FIT_MAX_DEV: '0.05',
  };
  const files = walk(path.join(root, 'engine/src'));
  const declared = new Map();
  for (const file of files) {
    for (const line of codeLines(fs.readFileSync(file, 'utf8'))) {
      const m = /^(?:export )?const ([A-Z][A-Z0-9_]*)(?:: [^=]+)? = (.+);\s*$/.exec(line);
      if (!m) continue;
      const list = declared.get(m[1]) ?? [];
      list.push(`${rel(file)} = ${m[2]}`);
      declared.set(m[1], list);
    }
  }
  for (const [name, value] of Object.entries(DECLARED)) {
    const list = declared.get(name) ?? [];
    check(list.length === 1, `${name} is declared exactly once (${list.length}: ${list.join(' | ') || 'none'})`);
    const found = list.map((l) => l.split(' = ').slice(1).join(' = '));
    check(found.length === 1 && found[0] === value,
      `and it is ${value} (found ${JSON.stringify(found)}) — the corpus's behaviour rests on this number`);
  }
}

console.log('\n== 3. The numbers that decide a rule under a bare literal ==');
{
  // (a) `maxError / 12`: constants.ts documents it and names it nowhere — so the sites are now `SIGNATURE_DIVISOR`.
  const div12 = [];
  for (const file of walk(path.join(root, 'engine/src'))) {
    const n = codeLines(fs.readFileSync(file, 'utf8')).filter((l) => /[/] 12\b/.test(l)).length;
    if (n) div12.push(`${rel(file)} ${n}`);
  }
  div12.sort();
  console.log(`     "/ 12" sites: ${div12.join(', ') || 'none'}`);
  check(div12.length === 0,
    `the per-dancer divisor is a bare 12 in 0 place(s) — it is SIGNATURE_DIVISOR (${div12.length} found)`);

  // (b) `0.48`: the marker size has one owner, `board-style.mjs`, and every figure tool imports it.
  const markers = [];
  for (const file of walk(path.join(root, 'book/tools'), ['.mjs'])) {
    const n = codeLines(fs.readFileSync(file, 'utf8')).filter((l) => l.includes('0.48')).length;
    if (n) markers.push(`${rel(file)} ${n}`);
  }
  markers.sort();
  console.log(`     "0.48" sites: ${markers.join(', ') || 'none'}`);
  check(JSON.stringify(markers) === JSON.stringify([
    'book/tools/lib/board-style.mjs 1',
    'book/tools/make-diagrams.mjs 1',
    'book/tools/make-formations.mjs 1',
  ]), `the marker size is declared in exactly 3 file(s) today: its owner and the two copies the book commit removes (${markers.length} found)`);

  // (c) `swing-thru.ts`'s `3.0`: the reference's `minDistance`, now owned by `MIN_DISTANCE`. The DECLARATION is the
  // named side and is pinned separately from the uses.
  const swing = fs.readFileSync(path.join(root, 'engine/src/sequencer/swing-thru.ts'), 'utf8');
  const named = codeLines(swing).filter((l) => /\bMIN_DISTANCE\b/.test(l)).length;
  const bare = codeLines(swing).filter((l) => /\b3\.0\b/.test(l) && !/const MIN_DISTANCE = 3\.0;/.test(l)).length;
  console.log(`     swing-thru: MIN_DISTANCE on ${named} line(s), bare 3.0 on ${bare}`);
  check(named === 3, `the reference's minDistance has a name (declaration + 2 uses, ${named} found)`);
  check(bare === 0, `and is not a bare 3.0 anywhere else (${bare} found)`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
