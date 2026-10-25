// THE CORPUS'S CALL INVENTORY, ONE WAY — and the two defects that made it five ways.
//
// WHAT THIS GATES. `packages/corpus` is now the only reader of the corpus directory: one level walk, one parser,
// one place that says what a `<tam>` site is. This harness pins the FACTS that migration rests on, because they
// are also the facts that were wrong before it:
//
//   (1) THE TITLE COUNT. The engine's own parser sees **2191** titles across the 10 levels plus `assets/src`;
//       a raw `<tam title=` scan sees **2203**, and the twelve that differ exist ONLY inside `<!-- -->`. That
//       raw scan was the shared reader 134 harnesses and probes imported, so every one of them was offering
//       twelve calls the corpus does not author. The twelve are pinned as a NAMED SET: the check fails if one
//       is uncommented (the corpus gained an authoring) or if a thirteenth appears (a comment was added), so a
//       corpus edit cannot quietly change the catalogue's size.
//   (2) THE PHANTOM AUTHORINGS. Eight of `ms/star.xml`'s commented titles are ALSO authored live
//       (`Left/Right-Hand Star 1/4`, `1/2`, `3/4`, `a Full Turn`), so the raw reader gave each of them a SECOND
//       authoring inside the pool it handed the engine. Pinned as a NAMED SET with the site count now 1.
//   (3) THE INDEX IS THE PARSER'S ORDER. In the four files that carry commented tams, the old book reader's
//       `tamIndex` (raw scan) and the DOM parse it was paired with disagreed — a look-up by index addressed the
//       wrong `<tam>`. Every site's `index` is now checked against `parseCallXml` AND against
//       `loadCallFromXml(xml, …, index)`, which is the consumer's own reader.
//   (4) THE FILE ORDER, AND WHY IT IS NOT SORTED. A directory's order is a filesystem accident, and the engine
//       resolves an equal match error by array order — but SORTING IS NOT FREE: MEASURED below, it moves the walk
//       order in **7 of the 11** level directories, which would move the pooling offsets `catalogue.mjs` pins. So
//       `filesOf` preserves the directory's order and this harness pins that it does.
//   (5) THE GENERATED INSTANCES ARE NOT AUTHORINGS. `<level>/<family>.virtual.xml` holds the whole-set instances
//       the book's `make-virtual.mjs` places, and the suffix is the exclusion (`packages/corpus/virtual.ts`). This
//       harness pins the split, the layout AND the `parent_vid` each one carries.
//
// WHAT IT DOES NOT CHECK, on purpose: the pooled XML's wrapper (`engine/test/catalogue.mjs` pins the Circulate
// offsets that depend on it), and the per-consumer level lists (each consumer's own gate pins those).
//
// Usage: node engine/test/corpus-inventory.mjs
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMParser } from '@xmldom/xmldom';

import { callVariantId, isCallVariantId, loadCallFromXml, parseFormationTags, parseCallXml, setParser } from '../dist/index.js';
import { corpusRoot, filesOf, isVirtualFile, levelsAvailable, readFile, tamsOf, tamAttrs, titlesOf, sitesOfTitle, VIRTUAL_SUFFIX, virtualFilesOf } from 'dancing-squared-corpus';
import { ASSET_LEVELS } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();

let failures = 0;
const check = (ok, msg) => {
  if (ok) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
};

/** The same level list `engine/test/lib/engine-calls.mjs` walks: the asset levels, then the corpus's `src` index. */
const LEVELS = [...ASSET_LEVELS, 'src'];

/** The titles a RAW regex sees — the reader this package replaces, kept here as the measurement, not as a path. */
function rawTitles() {
  // ENTITIES ARE DECODED BEFORE COMPARING, because the engine's parser decodes them: the corpus spells twenty
  // titles with `&quot;` (e.g. `&quot;O&quot; Wheel Fan Thru`), and a raw scan sees those as different strings
  // rather than as the same title. Without this the difference between the two readers looks like 32 titles when
  // it is 12 real ones plus 20 spellings.
  const decode = (t) => t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const titles = new Set();
  for (const level of LEVELS) {
    const dir = path.join(assets, level);
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.xml'));
    } catch {
      continue;
    }
    for (const file of files) {
      // THE LEGACY READER HAD NO GENERATED FILES TO SEE: they arrived with the `.virtual.xml` convention, and its
      // measurement is of authored tams. Counting them here would compare a scan of authored + generated against a
      // parse of authored, which is a different measurement and not this one.
      if (isVirtualFile(file)) continue;
      const xml = readFileSync(path.join(dir, file), 'utf8');
      for (const m of xml.matchAll(/<tam\b[^>]*\btitle="([^"]*)"/g)) titles.add(decode(m[1]));
    }
  }
  return titles;
}

console.log('== The population ==');
const titles = titlesOf(LEVELS);
const raw = rawTitles();
console.log(`    ${titles.size} titles by the engine's parser; ${raw.size} by a raw <tam> scan over the same files`);
check(titles.size > 0 && raw.size > 0, `both readers see a corpus (${titles.size} parsed, ${raw.size} raw)`);

// (1) THE TWELVE. Pinned by name, because a count alone cannot tell "one uncommented" from "one added".
const COMMENT_ONLY = [
  'Bend the Line and Spread',
  'Heads Start',
  'Left-Hand Star 1/2 and Roll',
  'Left-Hand Star 1/4 and Roll',
  'Left-Hand Star 3/4 and Roll',
  'Left-Hand Star a Full Turn and Roll',
  'Magic Column Right and Left Thru',
  'Right-Hand Star 1/2 and Roll',
  'Right-Hand Star 1/4 and Roll',
  'Right-Hand Star 3/4 and Roll',
  'Right-Hand Star a Full Turn and Roll',
  'Sides Start',
].sort();
const onlyRaw = [...raw].filter((t) => !titles.has(t)).sort();
check(onlyRaw.length === COMMENT_ONLY.length && onlyRaw.every((t, i) => t === COMMENT_ONLY[i]),
  `exactly the ${COMMENT_ONLY.length} known comment-only titles are absent from the catalogue (${onlyRaw.length} absent)`);
check(titles.size === 2191 && raw.size === 2203,
  `and the counts are the MEASURED pair (parsed ${titles.size}, raw ${raw.size}; expected 2191 and 2203 — if either moved, the corpus changed and this pin must be re-measured)`);
for (const t of COMMENT_ONLY) {
  // The title must be gone from EVERY level, not merely from the file the comment is in.
  check(sitesOfTitle(t, LEVELS).length === 0, `"${t}" has no authoring in any level`);
}

// (2) THE EIGHT THAT LOST A PHANTOM AUTHORING. Each is commented AND live in `ms/star.xml`, so the raw reader gave
// it two authorings where the corpus authors one.
console.log('\n== The titles that were counted twice ==');
const DUAL = [
  'Left-Hand Star 1/4', 'Left-Hand Star 1/2', 'Left-Hand Star 3/4', 'Left-Hand Star a Full Turn',
  'Right-Hand Star 1/4', 'Right-Hand Star 1/2', 'Right-Hand Star 3/4', 'Right-Hand Star a Full Turn',
].sort();
const wrong = DUAL.filter((t) => sitesOfTitle(t, LEVELS).length !== 1);
check(wrong.length === 0,
  `all ${DUAL.length} titles that are both commented and live now have exactly ONE authoring (${wrong.length} do not: ${wrong.join(', ') || 'none'})`);

// (3) THE INDEX IS THE ENGINE'S. The runtime extractor is a comment-stripped slice (MEASURED 128 ms against the
// engine's own parse at 1934 ms for the same 500 files), so THE ENGINE'S PARSER IS THE JUDGE HERE rather than the
// path: every file in the corpus is compared, not the four that happen to carry comments. A future file where the
// two disagree fails here instead of drifting.
console.log('\n== The index and the titles are the engine\'s ==');
const movesXml = readFileSync(path.join(assets, 'moves.xml'), 'utf8');
const formationsXml = readFileSync(path.join(assets, 'formations.xml'), 'utf8');
{
  let files = 0;
  let tams = 0;
  const disagreed = [];
  for (const level of LEVELS) {
    for (const file of filesOf(level)) {
      files++;
      const xml = readFile(level, file);
      const parsed = parseCallXml(xml);
      const ours = tamsOf(level, file);
      tams += parsed.length;
      if (parsed.length !== ours.length) {
        disagreed.push(`${level}/${file}: ${ours.length} blocks vs ${parsed.length} parsed`);
        continue;
      }
      for (let i = 0; i < parsed.length; i++) {
        if ((parsed[i].title ?? '') !== ours[i].title) {
          disagreed.push(`${level}/${file} #${i}: "${ours[i].title}" vs "${parsed[i].title ?? ''}"`);
          break;
        }
      }
    }
  }
  console.log(`    ${files} files, ${tams} tams compared against the engine's parser`);
  check(files > 0 && tams > 0, `the comparison has a population (${files} files, ${tams} tams)`);
  check(disagreed.length === 0,
    `every file's block count, order and DECODED title agree with \`parseCallXml\` (${disagreed.length} disagree: ${disagreed.slice(0, 3).join('; ') || 'none'})`);
}

// (3b) AND THE CONSUMER'S OWN READER: an index into the stripped slice must build the tam it names.
console.log('\n== The index addresses the tam it names ==');
const COMMENT_FILES = [
  ['a1', 'split_square_thru.xml'],
  ['c1', 'magic_column_formation.xml'],
  ['ms', 'star.xml'],
  ['plus', 'anything_and_spread.xml'],
];
let sites = 0;
let disagree = 0;
let built = 0;
let builtWithWrongTitle = 0;
for (const [level, file] of COMMENT_FILES) {
  const xml = readFile(level, file);
  const list = tamsOf(level, file);
  sites += list.length;
  for (const site of list) {
    // THE BOOK'S OWN READER: an index into the slice must build the same tam. A tam that does not build is allowed
    // (registration failures are counted elsewhere) — a tam that builds as a DIFFERENT title is not.
    try {
      const bundle = loadCallFromXml(xml, movesXml, formationsXml, site.index);
      built++;
      if (bundle.title !== site.title) builtWithWrongTitle++;
    } catch {
      /* not every authoring builds; that is `catalogue.mjs`'s population, not this one's */
    }
    if (!tamAttrs(site.xml).title) disagree++;
  }
}
check(sites > 0, `the four comment-carrying files author ${sites} tams between them`);
check(disagree === 0, `every site carries its raw title attribute for the book's queries (${disagree} do not)`);
check(built > 0 && builtWithWrongTitle === 0,
  `and every one of the ${built} that BUILD build the tam their index names (${builtWithWrongTitle} named another)`);

// (4) THE FILE ORDER IS THE DIRECTORY'S, AND SORTING IT IS NOT FREE. The engine resolves an equal match error by
// array order, so a title's block order decides which authoring runs when two match the same board. Sorting is
// more deterministic across machines and it MOVES the order on the shipped corpus, so this records the measurement
// and pins the current behaviour rather than changing it in a refactor.
console.log('\n== The file order, and why it is not sorted ==');
{
  let same = 0;
  const moved = [];
  for (const level of LEVELS) {
    let dirOrder;
    try {
      // THE SAME POPULATION `filesOf` RETURNS, read raw: the generated instances are not authored files, and
      // this measurement is of the AUTHORED walk order (the reader it compares against never saw them).
      dirOrder = readdirSync(path.join(assets, level)).filter((f) => f.endsWith('.xml') && !isVirtualFile(f));
    } catch {
      dirOrder = [];
    }
    const ours = filesOf(level);
    if (dirOrder.length === ours.length && dirOrder.every((f, i) => f === ours[i])) same++;
    else moved.push(level);
  }
  check(same + moved.length > 0, `compared ${same + moved.length} level(s)`);
  check(moved.length === 0, `filesOf returns each directory's own order, as the reader it replaces did (${moved.join(', ') || 'all agree'})`);
  // REPORTED, NOT ASSERTED: what sorting WOULD change. Six of eleven when this was written; a change here is a
  // behavioural change and needs its own re-measurement of `catalogue.mjs`'s pooling offsets.
  const wouldMove = [];
  for (const level of LEVELS) {
    let dirOrder;
    try {
      dirOrder = readdirSync(path.join(assets, level)).filter((f) => f.endsWith('.xml') && !isVirtualFile(f));
    } catch {
      continue;
    }
    const sorted = [...dirOrder].sort();
    if (dirOrder.some((f, i) => f !== sorted[i])) wouldMove.push(level);
  }
  console.log(`    sorting the files WOULD change the walk order in ${wouldMove.length} of ${LEVELS.length} level(s): ${wouldMove.join(', ') || 'none'}`);
  // THE LIST `filesOf` RETURNS IS THE CACHED ONE, so a caller that sorted it IN PLACE would reorder the walk for
  // every later reader in the same process — and the walk order is exactly what the check above pins. MEASURED
  // when the reader gained its last callers: `poc/tools/named-setup-probe.mjs` did `filesOf(level).sort()`. The
  // list is frozen now, so a recurrence THROWS at the mutation rather than moving a pooling offset silently.
  const before = [...filesOf('ms')];
  check(Object.isFrozen(filesOf('ms')), 'filesOf returns a frozen list (no caller can reorder the cache in place)');
  let sortThrew = false;
  try {
    filesOf('ms').sort();
  } catch {
    sortThrew = true;
  }
  check(sortThrew && before.every((f, i) => filesOf('ms')[i] === f),
    'sorting the returned list throws, and leaves the cached order unchanged');
  check(filesOf('b1').length === 0 && Array.isArray(filesOf('b1')),
    'a level with no directory is an empty list, not an error (a RETIRED level: `b1` has no assets and the ladder no longer names it)');
}

// -----------------------------------------------------------------------------------------------------------
// THE GENERATED INSTANCES, AND THE SUFFIX THAT KEEPS THEM OUT OF EVERY CENSUS.
//
// `<level>/<family>.virtual.xml` holds the whole-set instances `book/tools/make-virtual.mjs` places for calls the
// corpus authors only as subset units; `packages/corpus/virtual.ts` states the convention and the measurement
// that moved them beside their family (three gates counted the old `assets/virtual/` directory that was not a
// level). FOUR things must hold here, and each is a different failure:
//
//   (a) THE READER SPLITS THEM: `filesOf` does not return them and `virtualFilesOf` does. Without that, every
//       count in this file — and every consumer that walks a level — sees invented geometry as an authoring.
//       MEASURED when the files first landed: `make-virtual.mjs`'s own dead-row check read its SEVEN tams as new
//       eight-dancer authorings and declared every placement row obsolete.
//   (b) EACH SITS BESIDE ITS FAMILY: `ms/circle.virtual.xml` is only beside its family if `ms/circle.xml` is in
//       the same level, which is the whole reason for the layout.
//   (c) EACH CARRIES ONE `parent_vid` THAT IS A CALL-VARIANT ID.
//   (d) THAT ID IS ONE THE CORPUS MINTS — the variant of the authoring the instance was placed FROM, judged by
//       building every authoring of that call and re-deriving its id, not by asking the tool that wrote the file
//       (AGENTS §11.2.3). "Generated from" is the SOURCE authoring — `Dosado` written for two dancers — so the
//       board a generated instance STARTS from is the placement board and is deliberately not what is checked.
console.log('\n== The generated instances: excluded from the census, and naming the authoring they came from ==');
{
  const EXPECTED = [
    'ms/box_the_gnat.virtual.xml',
    'ms/circle.virtual.xml',
    'ms/circulate.virtual.xml',
    'ms/dosado.virtual.xml',
    'ms/lead_right.virtual.xml',
    'ms/promenade.virtual.xml',
    'ms/swing.virtual.xml',
  ];
  const movesXml = readFileSync(path.join(assets, 'moves.xml'), 'utf8');
  const formationsXml = readFileSync(path.join(assets, 'formations.xml'), 'utf8');
  /** THE DEFINITIONS' STORED TAGS, by formation name: a variant id's third input is one of these. */
  const formationTags = parseFormationTags(formationsXml);
  /** Every call-variant id the corpus mints for a title, against the site that minted it. One build per title. */
  const byTitle = new Map();
  const variantsOf = (title) => {
    if (byTitle.has(title)) return byTitle.get(title);
    const out = new Map();
    for (const site of sitesOfTitle(title, LEVELS)) {
      let call;
      try {
        call = loadCallFromXml(readFile(site.level, site.file), movesXml, formationsXml, site.index, true);
      } catch {
        continue; // an authoring that does not build mints no id (`identity-census` counts those by name)
      }
      if (!call?.dancers?.length) continue;
      // THE SAME INPUT THE BOOK AND `placeVirtual` USE: the tag stored on the start definition.
      const fid = call.formation ? formationTags.get(call.formation)?.fid ?? null : call.formationTag?.fid ?? null;
      if (!fid) continue; // an untagged start definition mints no reference (formation-tags names it)
      out.set(callVariantId(site.level, title, fid), site);
    }
    byTitle.set(title, out);
    return out;
  };
  const seen = [];
  const wrong = [];
  const provenance = [];
  for (const level of LEVELS) {
    for (const file of virtualFilesOf(level)) {
      seen.push(`${level}/${file}`);
      if (filesOf(level).includes(file)) {
        wrong.push(`${level}/${file}: \`filesOf\` returns it — the exclusion is gone`);
        continue;
      }
      const family = `${path.posix.basename(file).slice(0, -VIRTUAL_SUFFIX.length)}.xml`;
      if (!filesOf(level).includes(family)) wrong.push(`${level}/${file}: its family ${family} is not in ${level}`);
      const xml = readFile(level, file);
      // THE ENGINE'S PARSER COUNTS THE TAMS, and the corpus reader supplies the attributes it keeps RAW — the two
      // readers this harness already compares for every file in the population section above.
      const count = parseCallXml(xml).length;
      if (count !== 1) {
        wrong.push(`${level}/${file}: carries ${count} <tam>(s), and one file holds one instance`);
        continue;
      }
      const [site] = tamsOf(level, file);
      const parentVid = site.attrs.parent_vid ?? '';
      if (!isCallVariantId(parentVid)) {
        wrong.push(`${level}/${file}: parent_vid "${parentVid}" is not a call-variant id`);
        continue;
      }
      const options = variantsOf(site.title);
      const from = options.get(parentVid);
      if (!from) {
        wrong.push(`${level}/${file}: parent_vid "${parentVid}" is not minted by any corpus authoring of "${site.title}" (${options.size} candidate id(s) over ${LEVELS.length} levels)`);
        continue;
      }
      provenance.push(`${level}/${file}  <-  ${from.level}/${from.file}#${from.index}  (${site.title})`);
    }
  }
  const extra = seen.filter((f) => !EXPECTED.includes(f)).sort();
  const missing = EXPECTED.filter((f) => !seen.includes(f)).sort();
  for (const f of extra) console.log(`     NEW INSTANCE ${f} — add it to this pin, or delete the file`);
  for (const f of missing) console.log(`     INSTANCE GONE ${f} — delete its pin, or regenerate it`);
  for (const w of wrong) console.log(`     ${w}`);
  for (const p of provenance) console.log(`     ${p}`);
  console.log(`    ${seen.length} generated instance(s) in ${new Set(seen.map((f) => f.split('/')[0])).size} level(s)`);
  check(missing.length === 0 && extra.length === 0,
    `the generated instances are exactly the ${EXPECTED.length} files this pin names (${extra.length} new, ${missing.length} gone)`);
  check(wrong.length === 0, `every one carries the variant id of a corpus authoring of its own call (${wrong.length} wrong)`);
  check(provenance.length === EXPECTED.length,
    `every generated instance resolved to the authoring it came from (${provenance.length} of ${EXPECTED.length})`);
}

// The pooling fact `catalogue.mjs` pins by offset: Circulate pools the HIGHER level first.
console.log('\n== The pool order is the caller\'s, and it is still highest-first ==');
{
  const HIGHEST_FIRST = [...ASSET_LEVELS].reverse().concat(['src']);
  const sitesByTitle = sitesOfTitle('Circulate', HIGHEST_FIRST);
  const levels = sitesByTitle.map((s) => s.level);
  const firstMs = levels.indexOf('ms');
  check(sitesByTitle.length > 0 && firstMs > 0 && levels.slice(0, firstMs).every((l) => l === 'c1') && levels.slice(firstMs).every((l) => l === 'ms'),
    `Circulate pools ${sitesByTitle.length} authorings with every c1 before the first ms (got ${levels.join(', ') || 'none'})`);
}

// A LEVEL LIST IS POLICY IN EXACTLY ONE PLACE, AND THE CORPUS'S FOLDERS ARE THE OTHER HALF OF THE FACT.
// `ASSET_LEVELS` is the engine's `PERMISSION_LEVELS` (see `lib/engine-calls.mjs`), so a level added to the ladder
// reaches every harness at once - but nothing tied the ladder to the FOLDERS that exist. This is a ONE-WAY check,
// because the two can disagree in one direction:
//
//   * every folder the corpus HAS must be named by the ladder. That is the dangerous direction: a new programme's
//     calls would be invisible to every harness that pools through `callsByTitle`, and no gate would say so.
//   * a ladder entry with NO folder is a NAMED SET, and it is EMPTY now: `ssd` was the one entry and it was retired
//     with the 2026 CALLERLAB replacement. An entry joins the set only by being added here, with its reason.
console.log('\n== The level ladder names every folder the corpus has ==');
{
  const folders = levelsAvailable().sort();
  const declared = [...new Set(LEVELS)].sort();
  const unnamed = folders.filter((l) => !declared.includes(l));
  // A NAMED SET, and one-directional: grows when a ladder level gains no authorings without being explained here.
  const NO_FOLDER = [];
  const noFolder = declared.filter((l) => !folders.includes(l));
  // THE NEGATIVE CONTROL: the same comparison against a ladder with a real folder removed must fail AND name it, so
  // this check cannot pass by comparing a list with itself.
  const withoutMs = declared.filter((l) => l !== 'ms');
  const controlUnnamed = folders.filter((l) => !withoutMs.includes(l));
  check(controlUnnamed.length === 1 && controlUnnamed[0] === 'ms',
    'the comparison catches a corpus folder the ladder does not name (a ladder with `ms` removed fails on exactly `ms`)');
  check(unnamed.length === 0,
    `every one of the ${folders.length} folders under assets/ is named by the level list (${unnamed.length} unnamed: ${unnamed.join(', ') || 'none'})`);
  check(noFolder.join(',') === NO_FOLDER.join(','),
    `no ladder entry lacks a folder, so the ladder and the corpus are the same set (${noFolder.length}: ${noFolder.join(', ') || 'none'})`);
}

console.log('\n=================');
if (failures === 0) console.log('CORPUS INVENTORY TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
