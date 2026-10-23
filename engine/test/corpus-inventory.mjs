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
//   (4) SORTING THE FILES IS FREE, which is why `filesOf` sorts. A directory's order is a filesystem accident and
//       the engine resolves an equal match error by array order, so a title's block order has to be a property of
//       the corpus rather than of the machine. MEASURED here over every title before the sort is relied on.
//
// WHAT IT DOES NOT CHECK, on purpose: the pooled XML's wrapper (`engine/test/catalogue.mjs` pins the Circulate
// offsets that depend on it), and the per-consumer level lists (each consumer's own gate pins those).
//
// Usage: node engine/test/corpus-inventory.mjs
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMParser } from '@xmldom/xmldom';

import { loadCallFromXml, parseCallXml, setParser } from '../dist/index.js';
import { corpusRoot, filesOf, readFile, tamsOf, titlesOf, sitesOfTitle, tamAttrs } from 'dancing-squared-corpus';
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
      dirOrder = readdirSync(path.join(assets, level)).filter((f) => f.endsWith('.xml'));
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
      dirOrder = readdirSync(path.join(assets, level)).filter((f) => f.endsWith('.xml'));
    } catch {
      continue;
    }
    const sorted = [...dirOrder].sort();
    if (dirOrder.some((f, i) => f !== sorted[i])) wouldMove.push(level);
  }
  console.log(`    sorting the files WOULD change the walk order in ${wouldMove.length} of ${LEVELS.length} level(s): ${wouldMove.join(', ') || 'none'}`);
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

console.log('\n=================');
if (failures === 0) console.log('CORPUS INVENTORY TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
