// THE CORPUS LOCATION IS WRITTEN ONCE — and this is the gate that keeps it that way.
//
// THE RULE. `vite.corpus.ts` at the repository root is the one place the corpus's location exists. A Node
// reader learns it from `corpusRoot()` in `dancing-squared-corpus` (which imports that constant); a Vite app
// reaches it through the `@corpus` alias the same file builds. Nothing else may spell it.
//
// THE SAME LAW ONE LEVEL DOWN lives here as §6: a level's FILE LIST is enumerated once, by `filesOf`. The
// location and the listing were both spelled by hand in dozens of files, and both fail the same way — silently,
// by reading a different corpus than the reader beside them.
//
// WHY A GATE RATHER THAN A CONVENTION. A hand-built path is a `../` count, and one `../` too few is SILENT:
// MEASURED (AGENTS.md §8 trap 26), the corpus was duplicated into `game/src/assets/` for a year because a glob
// one short compiled to `{}` and nothing failed. The failure mode is not a wrong answer — it is an EMPTY
// answer, which every check downstream reads as "nothing to do".
//
// MEASURED when this landed. A census over the tracked source tree found 211 files spelling a corpus path in
// code (engine/test, poc/tools 49+, poc-matrix, scripts, poc-teacher, book/tools, poc 1); a second pass with
// the broader literal rule below found 21 MORE that carried the path only as a `../`-chained call-site literal
// (`read('../../assets/moves.xml')`), which the construction shapes could not see. The change touched 222
// files: engine/test 155, poc/tools 55, scripts 3, poc-matrix 3, book/tools 2, poc-teacher 3, game/test 1.
// It leaves 309 `corpusRoot()` call sites and this list of 12 files that may still spell an `assets`
// directory. The set is EXACT: it fails when it grows (a new hand-built path) and when it shrinks (a pin that
// has silently stopped matching is worse than none — §11.2.8).

//
// WHAT THIS GATE IS NOT. It is a SPELLING census, not a resolution proof: it shows the location is not
// written twice, not that every path built from it points somewhere real. The two are different
// measurements, and the second one belongs to the harnesses that actually read the bytes.
//
// THE ALTERNATIVE REJECTED: a `git grep` one-liner cannot express "comment lines excluded, and exactly this
// file set", and a per-line allowlist would let a real spelling hide behind a file that also names an
// unrelated `assets/` directory (the book's published one, the teacher's deleted FSM copy).
//
// Usage: node engine/test/corpus-location.mjs   (from anywhere; reads source text, no engine build needed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// ONE SPELLING SHAPE, deliberately: a string or template LITERAL whose path begins with an optional `../`
// chain and then `assets` as a directory (`'assets'`, `'assets/ms/circle.xml'`, `'../assets/moves.xml'`,
// `` `assets/${level}` ``, `'../../assets/'`). That is the common form of all six shapes the sweeps found —
// a hand-built join, a chained argument, a call-site prefix, a template, a URL base and a bare segment — and
// a pattern per construction would have to be extended every time a new one appears. The one-`../`-short trap
// (AGENTS.md §8 trap 26) is this shape with a shorter chain, which is why the chain is a `*`.
const PATTERNS = [
  ['path-literal', /['"`](?:\.\.\/)*assets(?:\/|['"`])/],
];

// THE PIN. Every entry is a file that may name an `assets` directory, with the reason it is not the corpus.
// A `..`-chain to a file under `book/assets/` is the published book's own directory; `poc-teacher/src/assets`
// was the deleted second FSM copy; the exported `filepath="assets/…"` is DATA inside an XML block, not a
// location on disk. A pin that covers a whole mixed file is a real cost — a new corpus path could hide in it
// — so each one names what the file is allowed to spell.
const PINNED = new Map([
  ['vite.corpus.ts', 'the one place the location is written — this gate exists to keep the list at this'],
  ['book/assets/player.js', "the published book site's OWN assets/ directory (browser fetch of ../assets/calls/…)"],
  ['poc/tools/escape-probe.mjs', 'reads book/assets/player.js, the book escaper copy'],
  ['poc/verify.cjs', 'CommonJS: the corpus package exports no require condition (MEASURED ERR_PACKAGE_PATH_NOT_EXPORTED)'],
  ['book/tools/build-site.mjs', "writes and refers to the site's own assets/; its corpus reads go through corpusRoot()"],
  ['poc/tools/corpus-key-probe.mjs', 'its SUBJECT is the corpus key shapes (./assets/…, ../assets/…, bare assets/…)'],
  ['poc/tools/export-all-probe.mjs', 'writes a corpus-RELATIVE filepath="assets/…" into exported XML (data, not a location)'],
  ['engine/test/fsm-asset-freshness.mjs', 'asserts the deleted poc-teacher/src/assets/fsm-table.json stays deleted'],
  ['poc/src/browser.ts', 'PROSE in a user-facing template literal that begins with the path (not a construction)'],
  ['poc/src/editor-ui.ts', 'the corpus-RELATIVE filepath `assets/<file>.xml` written into exported XML (data)'],
  ['scripts/reorder-formation.mjs', 'git pathspecs (HEAD:assets/…) and messages RELATIVE TO THE ROOT; the root itself is corpusRoot()'],
  ['game/test/config-probe.mjs', "a directory NAME in the probe's own walk skip-list, not the corpus location"],
]);


// THE ONE ACCESSOR. `CORPUS` from `vite.corpus.ts` may be imported by the package that wraps it, by the two
// Vite configs the alias exists for, and by the probe whose subject is that agreement — nowhere else.
const IMPORT_PINNED = new Map([
  ['packages/corpus/files.ts', 'imports CORPUS; this is the one module that reads the constant'],
  ['poc/vite.config.ts', 'builds the @corpus alias from corpusAlias'],
  ['game/vite.config.ts', 'builds the @corpus alias from corpusAlias'],
  ['poc-teacher/vite.config.ts', 'builds the @corpus alias from corpusAlias'],
  ['poc/tools/corpus-key-probe.mjs', 'measures that CORPUS and corpusRoot() are the same directory'],
]);

const ROOTS = [
  'engine/src', 'engine/test', 'poc', 'poc-teacher', 'poc-matrix', 'book/tools', 'book/assets',
  'scripts', 'game/src', 'game/test', 'game/tools', 'game/vite.config.ts', 'api', 'packages',
  'features', 'vite.corpus.ts',
];
const SOURCE = /\.(ts|mjs|cjs|js)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite', 'coverage']);
// SCRATCH IS NOT SOURCE. `_*.mjs` is the repo's own scratch convention (`poc/tools/verify-probes.mjs` skips
// the same names, and AGENTS.md §5 says a scratch probe is throwaway), and those files are untracked. The one
// other exclusion is THIS file: its subject is spelling shapes, so its samples and patterns are spellings —
// gating them would make the census report itself. The `check` below keeps that exclusion honest.
const SKIP_FILES = new Set(['engine/test/corpus-location.mjs']);
const isScratch = (rel) => path.posix.basename(rel).startsWith('_');

function walk(target, out) {
  const abs = path.join(REPO, target);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return out; // a root that does not exist is reported by the caller, not silently skipped
  }
  if (stat.isFile()) {
    if (SOURCE.test(target) && !SKIP_FILES.has(target) && !isScratch(target)) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.posix.join(target, entry.name), out);
    } else if (SOURCE.test(entry.name)) {
      const rel = path.posix.join(target, entry.name);
      if (!SKIP_FILES.has(rel) && !isScratch(rel)) out.push(rel);
    }
  }
  return out;
}

const scanned = ROOTS.flatMap((root) => walk(root, []));
const text = new Map();
for (const rel of scanned) {
  try {
    text.set(rel, fs.readFileSync(path.join(REPO, rel), 'utf8'));
  } catch {
    text.set(rel, '');
  }
}

// A line that is ENTIRELY a comment cannot spell a path in code. This is deliberately crude and deliberately
// stated: prose about `assets/formations.xml` is not a path, and a trailing comment on a code line is left to
// the patterns above, which want the construction rather than the word.
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
const stripComments = (src) => src.split(/\r?\n/).map((line) => (COMMENT_LINE.test(line) ? '' : line)).join('\n');

function spellingsOf(src) {
  const hits = [];
  const stripped = stripComments(src);
  for (const [label, re] of PATTERNS) {
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(stripped))) {
      hits.push({ label, text: m[0].replace(/\s+/g, ' ') });
      if (m.index === g.lastIndex) g.lastIndex++;
    }
  }
  return hits;
}

console.log('corpus-location: the corpus directory is spelled once\n');
console.log(`== 1. every scanned root exists (a missing root would make the census vacuous) ==`);
for (const root of ROOTS) {
  check(fs.existsSync(path.join(REPO, root)), `root ${root} exists`);
}

console.log(`\n== 2. the files carrying an \`assets\` spelling are exactly the pinned set ==`);
const found = new Map();
for (const [rel, src] of text) {
  const hits = spellingsOf(src);
  if (hits.length) found.set(rel, hits);
}
console.log(`  measured over ${scanned.length} source files; ${found.size} carry a spelling, ${PINNED.size} are pinned`);
const unexpected = [...found.keys()].filter((rel) => !PINNED.has(rel)).sort();
const vanished = [...PINNED.keys()].filter((rel) => !found.has(rel)).sort();
check(scanned.length > 400, `the walk found the tree (${scanned.length} source files; a zero here is a FAILURE, not a pass)`);
check(fs.existsSync(path.join(REPO, 'engine/test/corpus-location.mjs')),
  'the one excluded file is this gate itself, and it exists (an exclusion that names nothing excludes nothing)');
check(found.size > 0, `the census is not vacuous (${found.size} files)`);
for (const rel of unexpected) {
  console.log(`     NEW SPELLING ${rel}`);
  for (const h of found.get(rel).slice(0, 4)) console.log(`       [${h.label}] ${h.text.slice(0, 130)}`);
}
for (const rel of vanished) console.log(`     PIN NO LONGER MATCHES ${rel} — fix the pin in the commit that removed it`);
check(unexpected.length === 0, `no new file spells the corpus directory (${unexpected.length} unexpected)`);
check(vanished.length === 0, `every pin still matches something (${vanished.length} stale)`);

// The file the one spelling SHOULD be in, and the exact shape it should have: if `vite.corpus.ts` ever stops
// spelling it, the location has moved rather than been consolidated, and every pin above is measuring a
// location nothing reads.
const viteCorpus = text.get('vite.corpus.ts') ?? '';
check(/export const CORPUS = path\.join\(here, 'assets'\);/.test(viteCorpus),
  "vite.corpus.ts still defines CORPUS as path.join(here, 'assets') — the one spelling");

console.log(`\n== 3. CORPUS is imported from vite.corpus.ts by exactly the pinned files ==`);
const importers = new Set();
for (const [rel, src] of text) {
  const stripped = stripComments(src);
  if (/from\s+['"][^'"]*vite\.corpus\.ts['"]|import\([^)]*vite\.corpus\.ts/.test(stripped)) importers.add(rel);
}
const badImporters = [...importers].filter((rel) => !IMPORT_PINNED.has(rel)).sort();
const missingImporters = [...IMPORT_PINNED.keys()].filter((rel) => !importers.has(rel)).sort();
for (const rel of badImporters) console.log(`     UNPINNED IMPORTER ${rel} — read corpusRoot() instead`);
for (const rel of missingImporters) console.log(`     PIN NO LONGER IMPORTS ${rel}`);
check(badImporters.length === 0, `nothing outside the pinned set imports CORPUS directly (${importers.size} importers)`);
check(missingImporters.length === 0, 'every pinned importer still imports it');

console.log(`\n== 4. the reader is used, not merely declared ==`);
let callSites = 0;
for (const src of text.values()) {
  const stripped = stripComments(src);
  callSites += (stripped.match(/\bcorpusRoot\(\)/g) ?? []).length;
}
console.log(`  corpusRoot() call sites in the tree: ${callSites}`);
check(callSites > 150, `the consolidation is in place (${callSites} call sites; MEASURED 200+ when it landed)`);

console.log(`\n== 5. the pattern itself, and the negative controls ==`);
// POSITIVE: every historical shape must still be caught, INCLUDING the one-`../`-short form, which is the
// trap this rule exists for (§8 trap 26). A sample here that stopped matching would be the gate going blind
// while staying green.
const SAMPLES = [
  "path.join(root, 'assets')",
  "path.resolve(here, '..', '..', 'assets')",
  "path.resolve(here, '..', 'assets')", // ONE SHORT — the trap
  "path.join(POC_DIR, '../assets', p)",
  "path.join(__dirname, '../../assets/ms')",
  "read('assets/ms/circle.xml')",
  "read('../../assets/moves.xml')",
  'path.join(root, `assets/${level}`)',
  "new URL('../../assets/', import.meta.url)",
];
for (const sample of SAMPLES) {
  check(spellingsOf(sample).length > 0, `catches ${sample}`);
}
// NEGATIVE: a path built from the package's own constant is NOT a spelling (that is the fix, not the defect),
// and a mention of the directory mid-sentence is not one either. What the rule CANNOT tell apart is a path
// literal from a data string that happens to begin with one (`filepath="assets/…"`, a bare `'assets'` in a
// skip-list): those are the four prose/data pins above, each excluded by a reason rather than by a pattern.
check(spellingsOf('path.join(CORPUS, level)').length === 0, 'does not flag the package API join(CORPUS, level)');
check(spellingsOf("console.log('use the package, not a ../ count, for assets')").length === 0,
  'does not flag the directory named mid-sentence');
check(spellingsOf("const assets = corpusRoot();").length === 0, 'does not flag the fix itself');

// -----------------------------------------------------------------------------------------------------------
// THE SECOND RULE THIS GATE OWNS: a level's FILE LIST is enumerated once, by `filesOf`.
//
// WHY IT IS A RULE. `filesOf` is where the order a level's files are walked is decided, and that order is
// load-bearing — it pools a multi-authoring title's `<tam>` blocks, and the engine resolves an EQUAL match error
// by array order (`FormationMatcher.findMatchingVariant`). MEASURED when this census landed: **61 files carried
// 79 private walks** of a level's `.xml` list (`fs.readdirSync(path.join(assets, lv)).filter((f) =>
// f.endsWith('.xml'))`, and the unfiltered `readdirSync(dir)` whose loop then skipped non-XML). Each was a
// second opinion about which files exist, invisible to any change made to `filesOf` — including the one that
// could have hidden a file from every reader at once. They are now `filesOf(lv)`; five remain, below.
//
// A LEVEL ENUMERATION IS NOT ONE: `readdirSync(assets, { withFileTypes: true }).filter((d) => d.isDirectory())`
// asks which DIRECTORIES exist (`levelsAvailable` owns that question and is not what this census measures), so
// the shape test below excludes it. That exclusion is a measurement, not a convenience: without it the census
// reports the six level walks in this tree, whose statement runs on into the file walk beneath them.
const WALK_PINNED = new Map([
  ['packages/corpus/files.ts', { count: 1, why: 'the one reader itself — this IS `filesOf`, and the census is of its callers' }],
  ['engine/test/corpus-inventory.mjs', { count: 3, why: 'its SUBJECT is each level directory\'s order and contents, so it must list them itself: it is the judge of `filesOf`, not a caller' }],
  ['poc/verify.cjs', { count: 1, why: 'CommonJS: the corpus package exports no `require` condition (MEASURED ERR_PACKAGE_PATH_NOT_EXPORTED, pinned above), so it cannot reach `filesOf`' }],
]);

const PRIVATE_WALK = /readdirSync\(/;
/** Every `readdirSync(` whose OWN statement (`;`-terminated) then tests for `.xml`. */
function privateWalksOf(stripped) {
  const out = [];
  const g = new RegExp(PRIVATE_WALK.source, 'g');
  let m;
  while ((m = g.exec(stripped))) {
    const rest = stripped.slice(m.index, m.index + 400);
    const end = rest.search(/;\s*\r?\n/);
    const statement = end === -1 ? rest.slice(0, 200) : rest.slice(0, end + 1);
    if (/\.xml/.test(statement) && !/withFileTypes|isDirectory\(\)/.test(statement)) {
      out.push({ line: stripped.slice(0, m.index).split('\n').length, statement: statement.replace(/\s+/g, ' ') });
    }
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

console.log(`\n== 6. a level's file list is enumerated once, by filesOf ==`);
const walks = new Map();
for (const [rel, src] of text) {
  const found = privateWalksOf(stripComments(src));
  if (found.length) walks.set(rel, found);
}
const walkTotal = [...walks.values()].reduce((n, list) => n + list.length, 0);
const unpinnedWalks = [...walks.keys()].filter((rel) => !WALK_PINNED.has(rel)).sort();
const staleWalkPins = [...WALK_PINNED.keys()].filter((rel) => (walks.get(rel)?.length ?? 0) !== WALK_PINNED.get(rel).count).sort();
console.log(`  measured over ${scanned.length} source files: ${walkTotal} private level-file walks in ${walks.size} files, ${WALK_PINNED.size} pinned (exact counts)`);
for (const rel of unpinnedWalks) {
  console.log(`     NEW PRIVATE WALK ${rel} — read it with filesOf(level)`);
  for (const w of walks.get(rel).slice(0, 4)) console.log(`       :${w.line} ${w.statement.slice(0, 130)}`);
}
for (const rel of staleWalkPins) {
  console.log(`     PIN COUNT MOVED ${rel}: pinned ${WALK_PINNED.get(rel).count}, measured ${walks.get(rel)?.length ?? 0}`);
}
check(unpinnedWalks.length === 0, `no unpinned private level-file walk (${unpinnedWalks.length} unpinned)`);
check(staleWalkPins.length === 0, `every pinned count still matches (${staleWalkPins.length} moved)`);

let reads = 0;
for (const src of text.values()) reads += (stripComments(src).match(/\bfilesOf\(/g) ?? []).length;
console.log(`  filesOf() call sites in the tree: ${reads}`);
check(reads > 60, `the one reader is USED, not merely declared (${reads} call sites; MEASURED 91 when this census landed, 79 of them from the sweep)`);

// POSITIVE: both historical forms, which is every shape the sweep found.
check(privateWalksOf("const files = readdirSync(dir).filter((f) => f.endsWith('.xml'));").length === 1,
  "catches the filter form: readdirSync(dir).filter((f) => f.endsWith('.xml'))");
check(privateWalksOf('for (const f of readdirSync(dir)) {\n  if (!f.endsWith(\'.xml\')) continue;\n}').length === 1,
  'catches the loop form: readdirSync(dir) then a per-file .xml skip');
// NEGATIVE: the fix itself, and the level enumeration that is a different question.
check(privateWalksOf("for (const f of filesOf(lv).filter((x) => x.endsWith('.xml'))) {\n}").length === 0,
  'does not flag the reader that replaces it');
check(privateWalksOf("const levels = readdirSync(assets, { withFileTypes: true }).filter((d) => d.isDirectory());").length === 0,
  'does not flag a LEVEL enumeration (which directories exist, not which files)');

console.log(`\ncorpus-location: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures ? 1 : 0);
