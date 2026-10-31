// THE KEY THE CATALOGUE STORES A CORPUS FILE UNDER, AND THE LOOKUP THAT HAS TO AGREE WITH IT.
//
// Reported as: "Dancers arent appearing on Call Editor board now. Sequencer seems ok". NOT a board fault and
// not a sequencer fault: the POC's catalogue could not load a single call, so the Call editor had no instance
// to draw. `poc/src/data.ts` globbed the corpus (`@corpus/*/*.xml`, the repository's one copy at `assets/`,
// named in `vite.corpus.ts`) and then looked each file up by `./assets/<level>/<base>.xml` - the key shape the
// glob emitted while the corpus lived inside the app. The alias changed the shape to
// `../assets/<level>/<base>.xml`; the glob still matched (all 500 files, 2094 KB in the bundle) and EVERY
// lookup missed, so `loadCallBase` threw `Missing XML for <file>` for every call while the level lists, which
// are built from the same XML the glob hands over, still filled. That is the shape of the report: the app
// looks alive and only the board is empty.
//
// THE RULE (pinned here, implemented in `poc/src/corpus-key.ts`): a corpus file's identity is its
// CORPUS-RELATIVE name, `<level>/<base>`, and the glob's own key is not an identity - its prefix is whatever
// specifier form the pattern happened to have. `corpusFileOf` takes the last two segments of any key shape and
// the corpus directory's name is deliberately NOT written into it, because that name lives once, in
// `vite.corpus.ts`; section 3 measures that the two agree.
//
// WHAT THIS MEASURES, and the alternative each check rules out:
//   1. the derivation, over EVERY file in the corpus, in four key shapes (a relative `./` key, the alias's
//      `../` key, an absolute `/@fs/...` key, and a bare `assets/...` key) - so a rule that only happens to
//      work for the shape the app ships today is not enough;
//   2. the plausible wrong rule, measured to FAIL: strip a known prefix. That is what the code did before this
//      fix (its "prefix" was in the lookup template, not in the key), and it is wrong for every shape but the
//      one it was written against;
//   3. that the keys are DISTINCT, so no file silently overwrites another in the map `data.ts` builds;
//   4. that `vite.corpus.ts`'s `CORPUS` really is the directory this probe just walked, so the name
//      `corpus-key.ts` omits cannot drift from the name the corpus actually has;
//   5. that `data.ts` calls the rule at every place it used to spell the key out, that no old-shape template
//      is left, and that the map is published BEFORE the walk that reads each file's family - a second,
//      latent defect that made every exported block file under nothing.
//
// Run: node tools/corpus-key-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');

const { corpusFileOf } = await import(pathToFileURL(path.join(POC_DIR, 'src', 'corpus-key.ts')).href);
const { CORPUS } = await import(pathToFileURL(path.join(ROOT, 'vite.corpus.ts')).href);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** One source file, line endings normalised: the app's TypeScript is checked in with CRLF while this file is
 *  LF, so a structural check written with a literal "\n" would never match (AGENTS.md §8 trap 2). */
const readSource = (rel) => fs.readFileSync(path.join(POC_DIR, rel), 'utf8').replace(/\r\n/g, '\n');

// ------------------------------------------------------------------ the corpus, as the glob sees it
//
// THE FILES ARE ENUMERATED FROM THE FILESYSTEM, not from a list written down here: `import.meta.glob` cannot
// run under plain node, and a hand-kept list of file names is the drift this probe exists to catch. The
// directory comes from `vite.corpus.ts`, which section 3 checks is the repo-root `assets/`.
const LEVEL_DIRS = fs.readdirSync(CORPUS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const FILES = LEVEL_DIRS.flatMap((level) => filesOf(level)
  .filter((f) => f.endsWith('.xml'))
  .map((f) => ({ level, base: f.slice(0, -'.xml'.length) })));

/** The four key shapes Vite can emit for the same file. The first is what the app ships (the `@corpus`
 *  alias); the rest are the shapes a different specifier form - or a future one - produces, and the rule has
 *  to be right for all of them because the prefix is not part of the file's identity. */
const KEY_SHAPES = [
  (f) => `../assets/${f.level}/${f.base}.xml`,
  (f) => `./assets/${f.level}/${f.base}.xml`,
  (f) => `assets/${f.level}/${f.base}.xml`,
  (f) => `/@fs/${CORPUS.replace(/\\/g, '/')}/${f.level}/${f.base}.xml`,
];
const SHAPE_NAMES = ['alias ../assets/', 'relative ./assets/', 'bare assets/', 'absolute /@fs/...'];

// ------------------------------------------------------------------ 1. the derivation, over the corpus
console.log(`\n== 1. corpusFileOf over the corpus (${FILES.length} files in ${LEVEL_DIRS.length} level directories)`);

check(FILES.length > 400, `the corpus was found at vite.corpus.ts's CORPUS: ${FILES.length} XML files - a zero here would make every check below vacuous`);
check(LEVEL_DIRS.length === 10, `all ten level directories are walked (${LEVEL_DIRS.join(', ')})`);
check(FILES.every((f) => f.base.length > 0), 'and every file has a name, so no key is `<level>/.xml`');

KEY_SHAPES.forEach((shape, i) => {
  const wrong = FILES.filter((f) => corpusFileOf(shape(f)) !== `${f.level}/${f.base}`);
  check(wrong.length === 0,
    `${SHAPE_NAMES[i]} keys derive \`level/base\` for all ${FILES.length} files` +
    (wrong.length ? ` - ${wrong.length} wrong, first: ${JSON.stringify(corpusFileOf(shape(wrong[0])))} for ${shape(wrong[0])}` : ''));
});

// The prefix really does differ between the shapes - otherwise the four checks above would be one check
// repeated, and the regression that prompted this probe could not have happened.
const shipped = KEY_SHAPES[0](FILES[0]);
const relative = KEY_SHAPES[1](FILES[0]);
check(shipped !== relative && shipped.endsWith(relative.slice(1)),
  `the alias key (${shipped}) is NOT the key the old lookup spelled (${relative}), which is the whole regression`);

// A key that is not a corpus file at all is REFUSED rather than guessed at: `null` is what makes `data.ts`
// skip a match instead of storing it under a nonsense name.
check(corpusFileOf('moves.xml') === null, 'a top-level corpus file (`moves.xml`) is refused - it has no level directory');
check(corpusFileOf('ms/circle.xml') === null,
  'and a bare two-segment `ms/circle.xml` is refused too: nothing in it says it is under the corpus, and the rule takes the last two segments of a path that has a directory above them');
check(corpusFileOf('/@fs/F:/clone/poc/src/assets/ms/circle.xml') === 'ms/circle',
  'a path from a tree where the corpus was nested (`poc/src/assets/`) derives the same name');
check(corpusFileOf('') === null && corpusFileOf('/') === null && corpusFileOf('assets/ms/') === null,
  'and empty, root and directory-only paths are all refused');

// ------------------------------------------------------------------ 2. the rule that was rejected
console.log('\n== 2. the rejected rule: strip a known prefix');

/** THE PLAUSIBLE WRONG RULE, and the one this fix replaced: assume the key is a fixed prefix plus the
 *  corpus-relative path, and strip that prefix. It is right for exactly the shape it was written against. */
const stripPrefix = (key) => {
  const stripped = key.startsWith('./assets/') ? key.slice('./assets/'.length) : key;
  return stripped.endsWith('.xml') ? stripped.slice(0, -'.xml'.length) : stripped;
};

KEY_SHAPES.forEach((shape, i) => {
  const right = FILES.filter((f) => stripPrefix(shape(f)) === `${f.level}/${f.base}`).length;
  const expected = i === 1 ? FILES.length : 0;
  check(right === expected,
    `the prefix-strip rule is right for ${right} of ${FILES.length} ${SHAPE_NAMES[i]} keys` +
    ` (it can only be right for the ${SHAPE_NAMES[1]} shape) - so check 1 is not vacuous`);
});
check(FILES.every((f) => stripPrefix(KEY_SHAPES[0](f)) !== `${f.level}/${f.base}`),
  `and on the shape the app ACTUALLY emits (${KEY_SHAPES[0](FILES[0])}) it is wrong for every one of the ${FILES.length} files - which is the "Missing XML for <file>" throw the report came from`);

// ------------------------------------------------------------------ 3. the keys are distinct
console.log('\n== 3. no file hides another');

const keys = FILES.map((f) => corpusFileOf(KEY_SHAPES[0](f)));
const distinct = new Set(keys);
check(distinct.size === FILES.length,
  `${distinct.size} distinct keys for ${FILES.length} files, so the map \`data.ts\` builds cannot overwrite a file`);

// THE OTHER DIRECTION: two corpus directories would collide if a level directory were ever nested, because the
// name is the LAST TWO segments. Nothing in the corpus is nested today, and this is what would say so on the
// day it is.
const colliding = FILES.filter((f, i) => keys.indexOf(keys[i]) !== i).map((f) => `${f.level}/${f.base}`);
check(colliding.length === 0, `and no two files derive the same key${colliding.length ? `: ${colliding.join(', ')}` : ''}`);

// ------------------------------------------------------------------ 4. vite.corpus.ts owns the location
console.log('\n== 4. the corpus directory is named once, in vite.corpus.ts');

check(path.basename(CORPUS) === 'assets',
  `CORPUS is named \`${path.basename(CORPUS)}\`, which is the directory this probe walked - the one thing \`corpus-key.ts\` needs and must not restate`);
check(fs.realpathSync(CORPUS) === fs.realpathSync(path.join(corpusRoot())),
  'and it IS the repository-root `assets/`, so the corpus the app globs is the corpus measured here');
check(!/assets/.test(fs.readFileSync(path.join(POC_DIR, 'src', 'corpus-key.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')),
  'and `corpus-key.ts`\'s CODE does not name it - only its comment may, or there would be two places to drift');

// ------------------------------------------------------------------ 5. data.ts uses it, and publishes the map first
console.log('\n== 5. data.ts: the rule at every lookup, and the family map published before it is read');

const dataSrc = readSource('src/data.ts');

/** The `loadCatalog` method's body, so the order check reads that method rather than the whole file (the
 *  facade at the bottom exports a `loadCatalog` too, and the class body is where the order matters). */
const loadCatalogBody = (src) => {
  const start = src.indexOf('\n  loadCatalog(');
  const end = src.indexOf('\n  availableCalls(');
  return start > 0 && end > start ? src.slice(start, end) : '';
};
check(loadCatalogBody(dataSrc).length > 0,
  'the `loadCatalog` method was located in data.ts - a locator that matched nothing would make the order check vacuous');

check(/^import \{ corpusFileOf \} from '\.\/corpus-key';$/m.test(dataSrc),
  'data.ts imports the rule from `corpus-key.ts` rather than spelling a key out');

// THE FIVE PROPERTIES, each a predicate over the SOURCE TEXT, so the negative controls below can be the same
// predicates applied to a deliberately reverted file rather than a second description of what to look for.
const keysByRule = (src) => /const file = corpusFileOf\(p\);/.test(src) &&
  /xmlMap\.set\(file, await levelLoaders\[p\]\(\)\);/.test(src);
const noOldShape = (src) => !/`\.\/assets\/\$\{/.test(src) && !/'\.\/assets\//.test(src);
const lookupByEntry = (src) => (src.match(/this\.levelXml\.get\(entry\.file\)/g) || []).length === 2;
/** THE SECOND DEFECT: `parseCatalogFile` reads the file's `<tamination title>` out of `levelXml`, so the map
 *  has to be published BEFORE the walk. It used to be assigned after it, which left every `family` empty and
 *  filed every exported block under nothing. */
const publishesMapFirst = (src) => {
  const body = loadCatalogBody(src);
  const published = body.indexOf('this.levelXml = xmlMap;');
  // THE WALK IS LOCATED BY THE CALL THAT DOES THE READING, not by its loop header: the walk was chunked into
  // `entries.slice(...)` groups when the parse started reporting progress, and a header-shaped locator would have gone
  // quietly vacuous instead of failing.
  const walk = body.indexOf('this.parseCatalogFile(xml, file)');
  return published > 0 && walk > published;
};

check(keysByRule(dataSrc), 'and keys every globbed file by the derived name when it builds the map');
check(noOldShape(dataSrc),
  'NO old-shape template is left anywhere in data.ts - the four lookups that missed were two `levelXml.get` calls, the alias check that existed then, and the key the map was built with');
check(lookupByEntry(dataSrc),
  'and both lookups that load a call\'s XML (`loadCallBase`, `registrationXml`) read it by `entry.file`');
check(publishesMapFirst(dataSrc),
  'and `levelXml` is published BEFORE the catalogue walk that reads each file\'s family');

{
  // AND THE CHECKS FAIL ON THE FAULTS THEY WERE WRITTEN FOR - each control is the SAME predicate over a source
  // with one thing put back the way it was, so a revert turns exactly one check red.
  const swapAll = (src, from, to) => src.split(from).join(to);

  const oldLookups = swapAll(dataSrc, 'this.levelXml.get(entry.file)', 'this.levelXml.get(`./assets/${entry.file}.xml`)');
  check(oldLookups !== dataSrc && !lookupByEntry(oldLookups),
    'spelling the old lookup key back into BOTH sites fails the lookup check');
  check(noOldShape(oldLookups) === false,
    'and also fails the no-old-shape check, which is the check that reads for the template rather than the call');

  const oldKeys = swapAll(dataSrc, 'const file = corpusFileOf(p);', 'const file = p;');
  check(oldKeys !== dataSrc && !keysByRule(oldKeys), 'using the glob key as the map key fails the keying check');

  // The reverted ORDER, built by moving the assignment after the walk: the control differs from the shipped
  // code in exactly one thing, which is where the map is published.
  const lateMap = dataSrc.replace('this.levelXml = xmlMap;', '')
    .replace('catalog.sort(', 'this.levelXml = xmlMap;\n        catalog.sort(');
  check(lateMap !== dataSrc && !publishesMapFirst(lateMap),
    'and publishing the map AFTER the walk - the state that left every family empty - fails the order check');
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
