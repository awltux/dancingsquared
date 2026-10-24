// THE EXPORT PRECISION: the four-decimal rule for a written number and the `[0, 360)` rule for a written facing.
//
// WHY THIS IS A GATE, and it is a COPY that went unmeasured rather than a function that was wrong. The same
// `Math.round(n * 1e4) / 1e4` lambda was written three times — `convert.ts`'s local `r` (one call site),
// `editor.ts`'s `rf` (ten) and `poc/src/editor-ui.ts`'s `show` (thirty-one, under a comment saying it rounds "the
// way the engine's XML export does") — and none of the three was exported, so no probe could import the rule: the
// engine's copies were only ever measured THROUGH a whole export round trip and the panel's copy by nothing at all.
// A copy of a fact with no gate goes stale in silence (AGENTS.md 11.2.9), and the panel's copy is the one a caller
// reads back out of a field.
//
// THE RULE ITSELF has its measurement in `engine/src/export-format.ts`'s header (two decimals is 0.0672 units out on
// an edited `ms/circle.xml`, four is 0.0008, pinned by `editor.mjs`). This file pins the three things a reader of
// that header needs, and the last one is why it is a GATE rather than a test:
//
//   - the four-decimal shape itself, including `-0` and a value below the last place;
//   - that the ANGLE rule is not the number rule (`-90` is written `270` for a dancer and `-90` for a geometry), which
//     is the plausible wrong rule: unifying them rewrites the 15 negative angles the corpus authors;
//   - a CENSUS that the lambda now occurs in exactly ONE file, so a fourth copy cannot land silently. That is the
//     same instrument `angle-normalisation.mjs` uses for `DEG` and `normAngle`.
//
// Usage: node engine/test/export-format.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportAngleDeg, exportNumber } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== 1. the number: four decimals, and the rounding is not a formatting preference ==');
{
  check(exportNumber(1 / 3) === '0.3333', `a third is written to four places (${exportNumber(1 / 3)})`);
  check(exportNumber(1.00004) === '1', `a value below the last place is dropped, not padded (${exportNumber(1.00004)})`);
  check(exportNumber(1.00006) === '1.0001', `and one above it rounds up (${exportNumber(1.00006)})`);
  check(exportNumber(0) === '0' && exportNumber(-0) === '0', `zero and negative zero both write "0" (${exportNumber(0)}, ${exportNumber(-0)})`);
  // MEASURED, and it is the reason the width is a rule rather than a taste: at TWO decimals this same value is '0.07' and
  // the edited path in the header came back 0.0672 units out, 13 times the rounding of any one coordinate.
  check(exportNumber(0.0672) === '0.0672' && (Math.round(0.0672 * 1e2) / 1e2).toString() === '0.07',
    `four places keeps the 0.0672 the two-place rule collapses to 0.07 (${exportNumber(0.0672)} vs ${(Math.round(0.0672 * 1e2) / 1e2).toString()})`);
  check(exportNumber(123456789) === '123456789', 'a large integer is written whole, not in exponent form');
}

console.log('\n== 2. the facing: canonical in [0, 360), and NOT the same rule as the number ==');
{
  check(exportAngleDeg(-90) === '270', `a negative facing writes its positive equivalent (${exportAngleDeg(-90)})`);
  check(exportAngleDeg(270) === '270', 'and the positive spelling is unchanged, so both spellings of one facing agree');
  check(exportAngleDeg(360) === '0' && exportAngleDeg(-360) === '0' && exportAngleDeg(0) === '0', 'a whole turn wraps to 0 in either direction');
  check(exportAngleDeg(359.99999) === '0',
    `a value within the export's own precision of 360 folds to 0 rather than writing "360", which is out of range for a half-open reader (${exportAngleDeg(359.99999)})`);
  check(exportAngleDeg(359.9) === '359.9', `while a value that is NOT that close stays as it is (${exportAngleDeg(359.9)})`);
  // THE NEGATIVE CONTROL, and it is the whole reason the two functions are separate: run a FACING through the number rule
  // and the file is dirtied on a no-op edit (the `ms/alamo_style.xml` witness in `export-format.ts`), because the SAME
  // facing then has two spellings depending on which code path built the bundle.
  check(exportNumber(-90) === '-90' && exportNumber(-90) !== exportAngleDeg(-90),
    `CONTROL: the number rule writes -90 as "-90", so it is NOT the angle rule (${exportNumber(-90)} vs ${exportAngleDeg(-90)})`);
  check(exportNumber(359.99999) === '359.9999' || exportNumber(359.99999) === '360',
    `and it does not fold a near-360 either (${exportNumber(359.99999)})`);
}

console.log('\n== 3. the census: one implementation, and the consumers import it ==');
{
  // THE FILES THAT MAY HOLD THE LAMBDA. A walk over the source trees rather than a grep of the whole repo: the rule is
  // engine code, and a hit anywhere else is a copy of it (the panel's was; `book/tools` has none today).
  const trees = ['engine/src', 'poc/src', 'poc-teacher/src', 'book/tools', 'game/src', 'api/src'];
  const ROUNDING = /Math\.round\([^)]*1e4/;
  const DEFINES = /(?:function|const)\s+(exportNumber|exportAngleDeg)\b/;
  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  };
  const files = [];
  for (const t of trees) {
    const dir = path.join(root, t);
    check(fs.existsSync(dir), `${t} exists, so the census is not silently empty`);
    if (fs.existsSync(dir)) files.push(...walk(dir));
  }
  const withRounding = files.filter((f) => ROUNDING.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
  check(files.length > 100, `the census has a population (${files.length} TypeScript files under ${trees.length} trees)`);
  check(withRounding.length === 1 && withRounding[0].replace(/\\/g, '/') === 'engine/src/export-format.ts',
    `the four-decimal lambda occurs in exactly ONE file, and it is the module that owns it (${withRounding.length}: ${withRounding.join(', ') || 'none'})`);
  const definitions = files.filter((f) => DEFINES.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f).replace(/\\/g, '/'));
  check(definitions.length === 1 && definitions[0] === 'engine/src/export-format.ts',
    `and the two functions are DEFINED once (${definitions.length}: ${definitions.join(', ') || 'none'})`);
  // THE CONSUMERS, by name: the two engine modules that used to carry a copy, and the panel.
  for (const [file, needle] of [
    ['engine/src/convert.ts', "from './export-format.js'"],
    ['engine/src/editor.ts', "from './export-format.js'"],
    ['engine/src/index.ts', "from './export-format.js'"],
    ['poc/src/editor-ui.ts', 'exportNumber'],
  ]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    check(text.includes(needle), `${file} reaches the rule instead of restating it (${needle})`);
  }
  // AND THE PANEL HAS NO LAMBDA OF ITS OWN, which is the check that would have caught the copy: the census above
  // already fails on one, and this says the panel's value came from the engine rather than from a kept alias to a
  // local function. `const show = exportNumber` is the one allowed form.
  const panel = fs.readFileSync(path.join(root, 'poc/src/editor-ui.ts'), 'utf8');
  check(/const show = exportNumber;/.test(panel), 'and the panel binds its own word to that function (`const show = exportNumber`)');
  check(!/const show = \(n: number\)/.test(panel), 'rather than defining a second one, which is what the copy was');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
