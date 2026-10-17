// NO PUZZLE IS GENERATED ON THE CLIENT — pinned by walking the app's IMPORT GRAPH, not by reading a comment.
//
// WHY A WALK RATHER THAN A GREP FOR `generatePuzzle`. The rule the design now rests on (DESIGN.md §9) is "the
// serving layer generates, the client applies", and the way a codebase breaks that rule is not by calling
// `generatePuzzle` in `main.ts` — it is by importing a module that imports it, three files away, or by re-exporting
// a barrel that does. A grep finds today's call sites; the graph finds tomorrow's, because the browser ships
// whatever is reachable from the entry point.
//
// WHAT IT DOES NOT COVER, stated rather than implied: it follows RELATIVE imports only, so a package that generated
// puzzles would be invisible to it (`dancing-squared-engine` does not, and the engine is renderer-agnostic — the
// generator is the game's). It also says nothing about what the SERVER imports, which is the point: the API is
// allowed to generate, and `game/src/puzzle/generator.ts` stays in the package for it.
//
// THE NEGATIVE CONTROL IS THE WALKER ITSELF: it is run from a module that DOES reach the generator (the puzzle
// barrel), and it must find it there. Without that check, a walker whose import regex matched nothing would report
// a clean graph for the whole codebase and look exactly like success — the failure mode AGENTS.md 4.1 is about.
//
// Usage: node game/test/client-generation-probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const ENTRY = path.join(SRC, 'main.ts');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** Every `from '…'` and `import('…')` a file names, as written. */
function importsOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const found = new Set();
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) found.add(match[1]);
  return [...found];
}

/** The file a RELATIVE specifier names, or null when it is a package or names nothing on disk. */
function resolveRelative(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file reachable from `entry` through relative imports, including the entry. */
function walk(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const resolved = resolveRelative(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

const rel = (file) => path.relative(path.join(HERE, '..'), file).replace(/\\/g, '/');
const GENERATOR = path.join(SRC, 'puzzle', 'generator.ts');

console.log('== 1. the walker can see the generator when it is there ==');
{
  // THE NEGATIVE CONTROL, and it is the check that makes the rest of this probe mean anything: the barrel re-exports
  // the generator, so a walk from it MUST reach it.
  const barrel = walk(path.join(SRC, 'puzzle', 'index.ts'));
  check(barrel.has(GENERATOR), `a walk from the puzzle barrel reaches ${rel(GENERATOR)} (${barrel.size} files) — so a clean result below is a finding, not a blind spot`);
  // AND IT RESOLVES THE `./x` FORM RATHER THAN ONLY `./x.ts`, which is how most of this package writes it.
  check(barrel.size > 8, `and it followed ${barrel.size} files, so the import regex is matching more than one shape`);
}

console.log('\n== 2. the app the browser ships cannot reach it ==');
{
  const app = walk(ENTRY);
  check(app.size > 10, `main.ts reaches ${app.size} source file(s)`);
  check(!app.has(GENERATOR), `and NONE of them is ${rel(GENERATOR)} — the client cannot generate a puzzle because it does not contain the generator`);
  // THE OTHER HALF, so "found nothing" cannot masquerade as "found no generator": the walk must reach the modules the
  // app actually uses to draw one.
  for (const required of ['game/season-data.ts', 'game/season.ts', 'puzzle/parse.ts', 'engine/applier.ts', 'net/api.ts']) {
    const file = path.join(SRC, ...required.split('/'));
    check(app.has(file), `the walk does reach ${required}, which the app needs`);
  }
  // A puzzle still ARRIVES from somewhere, so the two sources must be in the graph: the baked season and the wire.
  check(app.has(path.join(SRC, 'game', 'season.ts')) && app.has(path.join(SRC, 'net', 'api.ts')), 'both suppliers of a puzzle (the baked season, the server) are in the app graph');
}

console.log('\n== 3. nothing in `src/puzzle` is reached that generates, transitively ==');
{
  // A SECOND ENTRY, because the app's graph is not the only way in: `src/puzzle/index.ts` is the package's public
  // surface, and a client module importing the barrel would pull the generator in through the back door. It does not
  // today, and this is the check that would notice.
  const app = walk(ENTRY);
  const barrel = path.join(SRC, 'puzzle', 'index.ts');
  check(!app.has(barrel), 'the app imports the modules it needs rather than the barrel, which is why the generator stays out');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
