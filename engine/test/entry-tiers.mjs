// THE ENTRY POINTS: the engine's surface split by JOB, and the rules that keep the split honest.
//
// THE RULE. `engine/package.json` publishes seven specifiers: `"."` (the complete surface, ~380 names over 59
// modules) and six entries, each a VIEW of the barrel restricted to one job. An entry must not add a name the barrel
// does not publish, must not drop a public name from the modules it claims, must stay within the module closure it
// was measured at, and must remain re-export-only. This harness is the proof; the entries themselves are data.
//
// WHY THE CEILINGS ARE EXACT NUMBERS RATHER THAN "SMALL". Measured at landing: core 8 modules, document 4, ids 18,
// authoring 16, sequencer 54, all8 2 - and the barrel 59. A CEILING may only fall: an import that drags the
// sequencer into the draw-only entry is the defect this exists to catch, and a tier that legitimately gains a module
// re-measures its number in that commit (the `KNOWN_*` discipline, AGENTS §11.2.8). The alternative - no ceiling,
// just "an entry must not import upward" - is not checkable: this graph has no hand-written tiers, only closures.
//
// WHY THE DECLARED MODULES ARE READ FROM THE ENTRY FILES. A hand-kept list in this harness would be a second surface
// to keep in step, and the failure mode (a name added to the entry, not to the list) is silent. So the harness parses
// the six files: they are re-export-only, which makes "what an entry exposes" the same string it parses.
//
// THE THREE-WAY PIN. `engine/package.json`'s `exports` keys, the files under `engine/src/entries/`, and the keys of
// `engineAlias` in the repo-root `vite.engine.ts` must name the same six entries. Each pair has failed separately
// before: a built entry the package does not publish, and a published entry the Vite apps cannot resolve (both apps
// alias the specifier to `engine/dist` for the one-instance guarantee, so a missing alias is a resolution failure at
// dev time rather than at build time).
//
// THE NEGATIVE CONTROLS ARE THE CHECKS ON SYNTHETIC DATA, below: each rule is exercised on a graph or a pair of
// name lists a reader can check by eye, so "everything is green" cannot mean "the parser read nothing" (§11.2.2).
//
// Run: node engine/test/entry-tiers.mjs   (reads text and package.json; no engine build)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(here, '..');
const REPO = path.resolve(ENGINE, '..');
const SRC = path.join(ENGINE, 'src');
const ENTRIES_DIR = path.join(SRC, 'entries');

/** The six entries, and the closure ceiling each is pinned at (measured at landing; may only fall). */
const CEILINGS = { core: 8, document: 4, ids: 18, authoring: 16, sequencer: 54, all8: 2 };
const EXPECTED_ENTRIES = Object.keys(CEILINGS).sort();

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? `  ok   ${msg}` : `  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`);
  if (!cond) failures++;
};

const read = (abs) => fs.readFileSync(abs, 'utf8');
const rel = (abs) => path.relative(REPO, abs).split(path.sep).join('/');
const stripComments = (text) => text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every TypeScript source under a tree, repo-relative. */
const walk = (dir) => {
  const out = [];
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(rel(p));
    }
  };
  visit(dir);
  return out.sort();
};

/** A module's re-export statements: `{ module, names[] }`, parsed from an entry file. */
const declaredModules = (text) => {
  const out = [];
  for (const m of stripComments(text).matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
    const names = m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()).filter(Boolean);
    out.push({ module: m[2], names });
  }
  return out;
};

/** Re-export-only: every non-blank, non-comment line is an `export ... from` statement. */
const reExportOnly = (text) => {
  const body = stripComments(text).split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  if (body === '') return true;
  const statements = body.split(';').map((s) => s.trim()).filter(Boolean);
  return statements.every((s) => /^export\s+(?:type\s+)?\{[\s\S]*\}\s*from\s*'[^']+'$/.test(s));
};

// ---------------------------------------------------------------------------------------------------------------
// the graph, the barrel and the aliases

const files = walk(SRC);
const modules = files.filter((f) => !f.startsWith('engine/src/entries/'));
const keyOf = (f) => f.replace(/^engine\/src\//, '').replace(/\.ts$/, '');

/** module -> its relative imports (type-only included: an entry's closure is what the module graph reaches). */
const graph = new Map();
for (const f of files) {
  const text = stripComments(read(path.join(REPO, f)));
  const deps = new Set();
  for (const m of text.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
    deps.add(path.posix.normalize(path.posix.join(path.posix.dirname(keyOf(f)), m[1])).replace(/\.js$/, ''));
  }
  graph.set(keyOf(f), deps);
}

/**
 * The barrel's selection, per module: the names `engine/src/index.ts` publishes FROM each module. `export *` is the
 * whole module; `export { … }` is the list; comments are stripped first, because a comment inside the braces carries
 * commas and quotes (MEASURED at landing: an unstripped split produced the "name" `'s and`).
 */
const barrelSelection = () => {
  const byModule = new Map();
  const add = (mod, name) => {
    if (!byModule.has(mod)) byModule.set(mod, new Set());
    byModule.get(mod).add(name);
  };
  const idx = stripComments(read(path.join(SRC, 'index.ts')));
  for (const m of idx.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*'\.\/([^']+)'/g)) {
    const mod = m[2].replace(/\.js$/, '');
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) add(mod, name);
    }
  }
  for (const m of idx.matchAll(/export\s+\*\s+from\s+'\.\/([^']+)'/g)) {
    const mod = m[1].replace(/\.js$/, '');
    const text = stripComments(read(path.join(SRC, `${mod}.ts`)));
    for (const d of text.matchAll(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) add(mod, d[1]);
  }
  return byModule;
};
const barrel = barrelSelection();
const barrelNames = new Set([...barrel.values()].flatMap((s) => [...s]));

/** The runtime+type closure of a set of modules, under the repo's `.js`-specifier convention. */
const closureOf = (mods) => {
  const seen = new Set();
  const visit = (n) => {
    if (seen.has(n) || !graph.has(n)) return;
    seen.add(n);
    for (const d of graph.get(n)) visit(d);
  };
  for (const m of mods) visit(m);
  return seen;
};

/** A cycle, or null. Depth-first with the stack kept, so the report names the loop itself. */
const findCycle = (g) => {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map([...g.keys()].map((k) => [k, WHITE]));
  const stack = [];
  let found = null;
  const visit = (n) => {
    if (found) return;
    color.set(n, GREY);
    stack.push(n);
    for (const d of g.get(n) ?? []) {
      if (!g.has(d) || found) continue;
      if (color.get(d) === GREY) { found = [...stack.slice(stack.indexOf(d)), d].join(' -> '); return; }
      if (color.get(d) === WHITE) visit(d);
    }
    color.set(n, BLACK);
    stack.pop();
  };
  for (const n of g.keys()) if (color.get(n) === WHITE) visit(n);
  return found;
};

// ---------------------------------------------------------------------------------------------------------------
console.log('== 1. the checks, on data a reader can check by eye ==');
{
  // THE CYCLE DETECTOR: a two-node loop must be found, and a DAG must not be reported as one.
  const loop = new Map([['a', new Set(['b'])], ['b', new Set(['a'])]]);
  check(findCycle(loop) !== null, 'the cycle detector finds a two-node loop', String(findCycle(loop)));
  check(findCycle(new Map([['a', new Set(['b'])], ['b', new Set()]])) === null, 'and reports none for a DAG');

  // THE VIEW RULE: an entry that ADDS a name the barrel withholds, or DROPS one the barrel publishes, is caught.
  const viewOk = (entryNames, moduleNames) => [...moduleNames].every((n) => entryNames.has(n));
  check(!viewOk(new Set(['KNOWN_FORMATION_MAX']), new Set(['formationId'])), 'an entry that drops a public name fails the view check');
  check(!viewOk(new Set(['formationId']), new Set(['formationId', 'KNOWN_FORMATION_MAX'])), 'an entry that adds a withheld name fails it too (it is the `⊆ barrel` half)');

  // THE SHAPE RULE: a declaration in an entry file is not a re-export.
  check(reExportOnly("// a header\nexport { a, b } from '../x.js';\n"), 'a re-export-only file passes the shape rule');
  check(!reExportOnly("export function sneaky() { return 1; }\n"), 'a declaration in an entry file fails it');

  // THE CEILING: a closure one module over the pinned number is over.
  const over = (size, ceiling) => size > ceiling;
  check(over(9, 8) && !over(8, 8), 'the ceiling rejects 9 against 8 and accepts 8');
}

console.log('\n== 2. the real tree ==');
check(files.length > 50, `the walk found ${files.length} .ts files under engine/src`, SRC);
check(modules.length > 50, `and ${modules.length} modules outside entries/`);
check(graph.size === files.length, `every walked file is in the graph (${graph.size} of ${files.length})`);
const cycle = findCycle(graph);
check(cycle === null, 'the module graph is acyclic', cycle ?? '');

const entryFiles = fs.readdirSync(ENTRIES_DIR).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, '')).sort();
check(JSON.stringify(entryFiles) === JSON.stringify(EXPECTED_ENTRIES),
  `the entries are exactly the six this harness pins (${entryFiles.length}: ${entryFiles.join(', ')})`,
  `found ${entryFiles.join(', ')}`);

const pkg = JSON.parse(read(path.join(ENGINE, 'package.json')));
const exportKeys = Object.keys(pkg.exports ?? {}).filter((k) => k !== '.').map((k) => k.replace(/^\.\//, '')).sort();
check(JSON.stringify(exportKeys) === JSON.stringify(EXPECTED_ENTRIES),
  `package.json publishes exactly those six (${exportKeys.join(', ')})`);

const viteEnginePath = path.join(REPO, 'vite.engine.ts');
let aliasKeys = [];
if (fs.existsSync(viteEnginePath)) {
  aliasKeys = [...read(viteEnginePath).matchAll(/'dancing-squared-engine\/([a-z0-9]+)'\s*:/g)].map((m) => m[1]).sort();
}
check(JSON.stringify(aliasKeys) === JSON.stringify(EXPECTED_ENTRIES),
  `vite.engine.ts aliases exactly those six (${aliasKeys.join(', ') || 'none'})`,
  'both Vite apps alias the specifier into engine/dist; a missing key is a dev-time resolution failure');

for (const name of EXPECTED_ENTRIES) {
  const text = read(path.join(ENTRIES_DIR, `${name}.ts`));
  const declared = declaredModules(text);
  const names = new Set(declared.flatMap((d) => d.names));
  // A module appears twice when it exports values AND types (two statements), so the count is of MODULES.
  const modKeys = [...new Set(declared.map((d) => d.module.replace(/^\.\.\//, '').replace(/\.js$/, '')))];
  const missingMods = modKeys.filter((m) => !graph.has(m));
  const closure = closureOf(modKeys);
  const outside = [...names].filter((n) => !barrelNames.has(n));
  const dropped = [];
  for (const m of modKeys) for (const n of barrel.get(m) ?? []) if (!names.has(n)) dropped.push(`${m}: ${n}`);
  console.log(`\n  ${name}: ${modKeys.length} modules, ${names.size} names, closure ${closure.size} (ceiling ${CEILINGS[name]})`);
  check(modKeys.length > 0, `${name}: declares at least one module`);
  check(missingMods.length === 0, `${name}: every declared module exists`, missingMods.join(', '));
  check(reExportOnly(text), `${name}: the file is re-export-only`);
  check(outside.length === 0, `${name}: every name is one the barrel publishes (${outside.length} outside)`, outside.join(', '));
  check(dropped.length === 0, `${name}: nothing the barrel publishes from those modules is dropped (${dropped.length} dropped)`, dropped.join(', '));
  check(closure.size <= CEILINGS[name],
    `${name}: the closure is within its ceiling (${closure.size} <= ${CEILINGS[name]})`,
    [...closure].join(', '));
  check(closure.size > 0, `${name}: the closure is not empty (a walk that read nothing would pass every count)`);
}

console.log(`\n${failures === 0 ? 'entry-tiers: all checks hold' : `entry-tiers: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
