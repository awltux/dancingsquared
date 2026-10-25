// THE EXPORT SURFACE A PROBE CANNOT SEE: declarations exported to nobody, and modules nothing imports.
//
// THE RULE. An `export` is a promise about who may call a thing; §4.5 forbids an unused one ("no dead code, no
// commented-out code, no unused export"), and a module nothing imports is the same defect one level up. Neither is
// visible from a type check, because `export` on a symbol used only in its own file type-checks exactly as cleanly
// as one used by ten others, and an entry point type-checks like an orphan.
//
// WHY A CENSUS RATHER THAN A CLEANUP. MEASURED at landing, over the seven TypeScript source trees (engine/src,
// packages/corpus, packages/stage, poc/src, poc-teacher/src, api/src, game/src): 202 modules, 1240 exported
// declarations, of which SIX are mentioned in no other file AND used zero further times in their own, and 129 are
// used ONLY inside their own module - the `export` keyword buying nothing, which a de-export fixes by construction.
// Those 129 were de-exported in the commit that followed this census (1111 exported declarations remain), so the
// ceiling below is now ZERO: §4.5's "no unused export" is the rule, not the 129. The six dead exports are still
// pinned BY NAME so this gate fails when one is removed as well as when a seventh appears: a cleanup must come back
// here and take its pin with it.
// FIVE modules have no importer at all, and every one is an ENTRY rather than an orphan: three `src/main.ts` (a
// bundler reaches them; no import names them) and two `vite-env.d.ts` (Vite's ambient types) - so the module pin is
// a NAMED SET of five, and a sixth has to be explained here. Eleven module(s) are reached through a package's
// `main`/`types`/`exports` instead of a path, and twenty-two are public through an `export *` barrel; both are
// excluded by rule rather than by name.
//
// WHAT COUNTS AS A USE, AND WHY THE ERRORS POINT ONE WAY. A use is the identifier in ANY other file, comments
// included, as a whole word - deliberately generous. Being generous means a symbol named only in a comment reads as
// LIVE (a false negative: the gate stays silent when it could have spoken), where being strict would read a symbol
// used in a doc example or a string-keyed table as DEAD and invite its deletion (a false positive: the gate costs
// code). So a mention in a comment is a use, and the pin below is a floor on the debt, never a ceiling on safety.
//
// FOUR KINDS OF MENTION ARE NOT USES BY THIS SCANNER, all in the same direction:
//   * a module PUBLIC THROUGH A BARREL is skipped entirely. `export * from './moves.js'` publishes every export of
//     that module without naming one, so the whole module is treated as public API - which is what it is. MEASURED:
//     six such stars in `engine/src/index.ts` alone, plus `game/src/puzzle/index.ts`'s and the stage's.
//   * a declaration exported through an `export { a, b }` LIST is not scanned: only `export <decl>` forms are. The
//     list form publishes a name that was not declared with `export`, so it is already visible to a reader.
//   * a `.md` file is not a consumer: docs describe the surface, they do not call it.
//   * a dynamic `import()` IS followed, because a probe that loads a module by expression still consumes it - and a
//     false DEAD is the expensive error, so the specifier is resolved wherever it appears.
//
// THE NEGATIVE CONTROLS ARE THE SCANNER RUN ON SYNTHETIC SOURCES, below: each rule is exercised on four lines of
// text a reader can check by eye, so "the census found nothing" cannot be a broken scan (the failure AGENTS §11.2.2
// records: a check whose subject does not exist cannot report honestly).
//
// Run: node engine/test/export-census.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** The trees whose exports are the SUBJECT of the census. An export in one of these needs a consumer. */
const SRC_ROOTS = ['engine/src', 'packages/corpus', 'packages/stage', 'poc/src', 'poc-teacher/src', 'api/src', 'game/src'];
/** Everything that may CONSUME one, including the src trees themselves: harnesses, probes, scripts, features. */
const CONSUMER_ROOTS = [...SRC_ROOTS, 'engine/test', 'poc/tools', 'poc-teacher', 'game/test', 'game/tools', 'api/test', 'api/tools', 'book/tools', 'scripts', 'features'];
const EXTS = new Set(['.ts', '.mjs', '.cjs', '.js', '.feature']);
/** `export <decl>` ONLY - see the header for why the list form is out of scope. */
const EXPORT_DECL = /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const IMPORT_FROM = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const STAR_FROM = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? `  ok   ${msg}` : `  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`);
  if (!cond) failures++;
};

/** Repo-relative, forward slashes: one spelling for a path, whatever the platform. */
const rel = (abs) => path.relative(REPO, abs).split(path.sep).join('/');
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const walk = (root, out = []) => {
  if (!isDir(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(entry.name))) out.push(rel(full));
  }
  return out;
};

/** The identifier as a WHOLE WORD, counted. `$` is escaped because a few engine names use it. */
const countWord = (text, name) => (text.match(new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`, 'g')) ?? []).length;

/**
 * Resolve an import specifier to the module key of this repo's own file, or null for a package import.
 * `.js` in a specifier names a `.ts` source (the TS module convention), and a directory specifier names its
 * `index`; both spellings are in this tree, so both are followed.
 */
const resolveSpecifier = (fromFile, spec) => {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const key = base.replace(/\.(ts|mjs|cjs|js)$/, '');
  return key;
};

/**
 * The census itself, over a map of `path -> text`. Pure: every check below, including the real run, calls this.
 * `srcRoots` is a parameter so the negative controls can scan a synthetic tree with the same rules.
 * Returns the three populations plus the set of modules that are public through a wholesale re-export.
 */
const census = (files, srcRoots, entries = new Set()) => {
  const paths = [...files.keys()].sort();
  const starModules = new Set();
  for (const p of paths) {
    const text = files.get(p);
    for (const m of text.matchAll(STAR_FROM)) {
      const key = resolveSpecifier(p, m[1]);
      if (key) starModules.add(key);
    }
  }
  const srcPaths = paths.filter((p) => srcRoots.some((r) => p.startsWith(`${r}/`)));
  const mentionedBy = (name, self) =>
    paths.filter((p) => p !== self && countWord(files.get(p), name) > 0);
  const dead = [];
  const internalOnly = [];
  const seen = new Set();
  for (const p of srcPaths) {
    const text = files.get(p);
    const key = p.replace(/\.(ts|mjs|cjs|js)$/, '');
    for (const m of text.matchAll(EXPORT_DECL)) {
      const name = m[1];
      const id = `${p}: ${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (starModules.has(key)) continue; // public through a barrel: see the header
      if (mentionedBy(name, p).length > 0) continue;
      if (countWord(text, name) > 1) internalOnly.push(id);
      else dead.push(id);
    }
  }
  // A module is an ORPHAN when no other file's import specifier resolves to it AND no package declares it as a
  // target. The second half matters: `packages/corpus/index.ts` is reached as `dancing-squared-corpus` and
  // `game/src/puzzle/index.ts` as `dancing-squared-game/puzzle`, neither of which names a path.
  const importedKeys = new Set();
  for (const p of paths) {
    for (const m of files.get(p).matchAll(IMPORT_FROM)) {
      const key = resolveSpecifier(p, m[1]);
      if (!key) continue;
      importedKeys.add(key);
      importedKeys.add(`${key}/index`);
      importedKeys.add(key.replace(/\/index$/, ''));
    }
  }
  const orphans = srcPaths.filter((p) => {
    const key = p.replace(/\.(ts|mjs|cjs|js)$/, '');
    return !importedKeys.has(key) && !entries.has(key);
  });
  return { dead: dead.sort(), internalOnly: internalOnly.sort(), orphans: orphans.sort(), starModules, scanned: srcPaths.length, exports: seen.size };
};

// ---------------------------------------------------------------------------------------------------------------
if (!isDir(REPO) || !isDir(path.join(REPO, 'engine'))) {
  console.log(`  FAIL the scan could not find the repo at ${REPO}`);
  process.exit(1);
}

console.log('== 1. the scanner, on sources a reader can check by eye ==');
const CONTROL = new Map([
  ['t/live.ts', "export function used() { return 1; }\n"],
  ['t/consumer.ts', "import { used } from './live.js';\nused();\n"],
  ['t/dead.ts', "export function spoken() { return 1; }\n"],
  ['t/internal.ts', "export function helper() { return helper.name.length; }\n"],
  ['t/commented.ts', "export function example() { return 1; }\n"],
  ['t/mentions.ts', "// see `example` in the docs\n"],
  ['t/star.ts', "export function starred() { return 1; }\n"],
  ['t/barrel.ts', "export * from './star.js';\n"],
]);
{
  const c = census(CONTROL, ['t']);
  check(JSON.stringify(c.dead) === JSON.stringify(['t/dead.ts: spoken']),
    'a name no other file mentions and its own file does not use is DEAD, and nothing else is',
    c.dead.join('; '));
  check(c.internalOnly.includes('t/internal.ts: helper'), 'a name used only in its own file is INTERNAL-ONLY, not dead');
  check(!c.dead.some((d) => d.includes('example')), 'a name mentioned only in a COMMENT is live, and that is the intended direction of error', c.dead.join('; '));
  check(!c.dead.some((d) => d.includes('starred')) && !c.internalOnly.some((d) => d.includes('starred')),
    'a module re-exported wholesale (`export *`) is public API and is skipped entirely');
  check(!c.dead.some((d) => d.includes('used')) && !c.internalOnly.some((d) => d.includes('used')),
    'a name another file imports is neither dead nor internal-only');
  check(JSON.stringify(c.orphans) === JSON.stringify(['t/barrel.ts', 't/commented.ts', 't/consumer.ts', 't/dead.ts', 't/internal.ts', 't/mentions.ts']),
    `an unimported module is an ORPHAN, and a module reached by a specifier is not (found ${c.orphans.length}: ${c.orphans.join(', ') || 'none'})`);
}

console.log('\n== 2. the real tree ==');

/**
 * The modules a PACKAGE declares as an entry, so "no importer" does not read as "dead". Derived from the workspace's
 * own `package.json`s rather than from a list in this file, so a new package entry does not need a gate edit.
 *
 * A package whose `main` is `dist/index.js` is BUILT from `src/index.ts`, and a bundler-plus-tsc build reaches that
 * source module without any import naming it, so the `dist` target is mapped back onto its `src` sibling.
 */
const packageEntries = (sourceFiles) => {
  const keys = new Set();
  const addTarget = (value, pkgDir) => {
    if (typeof value === 'string') {
      if (!value.startsWith('./')) return;
      const target = rel(path.resolve(pkgDir, value)).replace(/\.(ts|mjs|cjs|js)$/, '').replace(/\.d$/, '');
      keys.add(target);
      if (target.includes('/dist/')) {
        const fromSource = target.replace('/dist/', '/src/');
        if (sourceFiles.has(`${fromSource}.ts`)) keys.add(fromSource);
      }
    } else if (value && typeof value === 'object') {
      for (const inner of Object.values(value)) addTarget(inner, pkgDir);
    }
  };
  for (const pkg of ['package.json', 'engine/package.json', 'packages/corpus/package.json', 'packages/stage/package.json', 'poc/package.json', 'poc-teacher/package.json', 'api/package.json', 'game/package.json']) {
    const abs = path.join(REPO, pkg);
    if (!statSync(path.dirname(abs)).isDirectory()) continue;
    const json = JSON.parse(readFileSync(abs, 'utf8'));
    // A TARGET IS RELATIVE TO ITS OWN PACKAGE, not to the repo root: `game/package.json`'s `./src/puzzle/index.ts`
    // is `game/src/puzzle/index.ts`. MEASURED while writing this: resolving from the root left every barrel an
    // orphan, which is the same silent-empty failure the negative controls exist for.
    for (const field of [json.main, json.types, json.module, json.exports]) addTarget(field, path.dirname(abs));
  }
  return keys;
};

const files = new Map();
for (const root of CONSUMER_ROOTS) for (const p of walk(path.join(REPO, root))) files.set(p, readFileSync(path.join(REPO, p), 'utf8'));
// THE CENSUS DOES NOT COUNT ITSELF, and that is not a tidy-up: the pin below NAMES every dead symbol, so a scan that
// counted this file as a consumer would report every one of them as live. MEASURED on the first run: 0 of 6 dead,
// because `engine/test/export-census.mjs` was the file that mentioned them.
files.delete('engine/test/export-census.mjs');
const entries = packageEntries(files);
const result = census(files, SRC_ROOTS, entries);
console.log(`    ${result.scanned} source module(s) under ${SRC_ROOTS.length} tree(s), ${files.size} file(s) read as consumers`);
console.log(`    ${result.exports} exported declaration(s) scanned, ${result.starModules.size} module(s) public through \`export *\`, ${entries.size} package entr(y|ies)`);
check(result.scanned > 150 && result.exports > 800,
  `the walk saw a source tree rather than a handful of files (${result.scanned} modules, ${result.exports} exports)`);

// A NAMED SET: fails when the debt GROWS (a new export nobody calls) and when it SHRINKS (one was removed, so this
// pin is now wrong - the cleanup brings its own edit here).
const DEAD = [
  'api/src/levels.ts: registeredFor',
  'api/src/press-log.ts: currentStep',
  'engine/src/sequencer/selection.ts: isCombinedSelection',
  'game/src/game/season.ts: seasonLength',
  'poc-teacher/src/formation-table.ts: isHome',
  'poc/src/call-order.ts: compareCallsByTitle',
].sort();
check(JSON.stringify(result.dead) === JSON.stringify(DEAD),
  `the ${DEAD.length} exported declaration(s) nobody calls are exactly the ones this pin names (${result.dead.length} found)`,
  `found: ${result.dead.join('; ') || 'none'}\n        pinned: ${DEAD.join('; ')}`);

// ENTRY POINTS ARE ORPHANS BY CONSTRUCTION. A bundler reaches `main.ts` and no import names it; `vite-env.d.ts` is
// Vite's own ambient file. Pinned by name rather than excused by a pattern, so a genuinely new orphan fails.
const ENTRY_ONLY = [
  'game/src/main.ts',
  'poc-teacher/src/main.ts',
  'poc-teacher/src/vite-env.d.ts',
  'poc/src/main.ts',
  'poc/src/vite-env.d.ts',
].sort();
check(JSON.stringify(result.orphans) === JSON.stringify(ENTRY_ONLY),
  `the only modules nothing imports are the ${ENTRY_ONLY.length} entry points and Vite typings (${result.orphans.length} found)`,
  `found: ${result.orphans.join('; ') || 'none'}`);

// THE EXPORT-ONLY SURFACE: a CEILING of ZERO, because §4.5 states the rule rather than a budget - an `export` no
// other file names is dead surface. MEASURED at landing: 129 (69 files, game/src 32, api/src 31, poc/src 29,
// engine/src 23, poc-teacher/src 14), all de-exported in the commit that followed; a count rather than a named set
// because the direction that matters is a NEW unnecessary export, and that is what a ceiling of zero catches.
const INTERNAL_ONLY_MAX = 0;
check(result.internalOnly.length <= INTERNAL_ONLY_MAX,
  `the export-only surface is at most ${INTERNAL_ONLY_MAX} declarations (${result.internalOnly.length} today; a CEILING, it may only fall)`,
  result.internalOnly.length > INTERNAL_ONLY_MAX ? result.internalOnly.slice(INTERNAL_ONLY_MAX).join('; ') : '');

console.log(`\n${failures === 0 ? 'export-census: all checks hold' : `export-census: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
