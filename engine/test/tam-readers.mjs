// HOW MANY WAYS THIS TREE SLICES A `<tam>` BLOCK, and that the one live reader now goes through the corpus package.
//
// WHY THIS IS A GATE. R7 was proposed as "catalogue construction is three live builders" and went looking for a
// consolidation. The claim was wrong in BOTH directions, and the measurements below are what settled it:
//
//   * TWO of its three builders do not parse at all. `engine/test/lib/engine-calls.mjs` and
//     `book/tools/lib/load.mjs` import `dancing-squared-corpus` (`titlesOf`/`pooledXmlOfTitle`/`tamsOf`); they are
//     POLICY over one reader - the level list, the pooling order, the hidden rule - and both say so in their headers.
//   * Its fourth, `poc-matrix/`, was archived in R5 and is not in the tree.
//   * But the corpus was still sliced by hand in ~40 places, and the corpus package's own header records what an
//     UN-STRIPPED slice costs: 2203 titles by the raw scan against 2191 by the engine's parser, the 12 differing
//     blocks existing only inside `<!-- -->`, and the book pairing a raw index with a DOM parse in those files.
//
// THE READER THAT WAS NOT A HARNESS, AND IS FIXED. Almost every remaining raw scan is probe-local: a probe reads one
// file it chose and counts or compares its blocks. `poc-teacher/src/catalog.ts::buildCatalog` was different - it
// builds the catalogue the TEACHER APP teaches from and the catalogue `scripts/build-fsm-asset.mjs` turns into
// `assets/fsm-ms.json` - and it sliced without stripping comments, so 8 titles pooled a second, AUTHORED-NOWHERE
// authoring from the blocks commented out in `ms/star.xml`. MEASURED then: 1068 pooled setups against the corpus
// package's 1060 under the same hidden rule, and 2 matchable variants where the engine should see 1 for each of the
// eight `Left/Right-Hand Star` titles. THE FIX: the slice moved to `packages/corpus/blocks.ts` (fs-free, so the app may
// import it) and `buildCatalog` projects over it - 1060 setups, one variant each - which emptied section 2's named set
// and took `catalog.ts` out of section 1's no-strip list. The empty set is the point: it fails again if a phantom comes
// back.
//
// STILL NAMED AND STILL SLICING, deliberately: `poc-teacher/scripts/gen-discovered.mjs` is a one-shot generator whose
// output is committed corpus, so converting it without regenerating `assets/discovered/*.xml` would leave a generator
// whose committed output it no longer produces - its own migration.
//
// THE PINS ARE NAMED SETS, not counts of counts: the census fails when a file appears or disappears, when a file
// starts or stops stripping comments, and when the phantom set shrinks OR grows. That is what makes it a gate rather
// than a paragraph - and the records above are what the set change means.
//
// WHAT IT DOES NOT JUDGE. Whether a probe-local raw scan is a defect is a per-harness question (`engine/test/
// tools/*` build XML of their own, and `scripts/tam-blocks.mjs` slices a POSITION-PRESERVING MASK on purpose). This
// file counts them and names them; it does not pretend to know which of them should have used the reader.
//
// Usage: node engine/test/tam-readers.mjs   (engine must be built: it uses `parseCallXml`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCallXml, setParser } from '../dist/index.js';
import { DOMParser } from '@xmldom/xmldom';
import { filesOf, readFile, tamsOf } from 'dancing-squared-corpus';
import { buildCatalog } from '../../poc-teacher/src/catalog.ts';

setParser(DOMParser);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- 1. the census of hand slices
console.log('== 1. Every place that slices `<tam>` by hand, and whether it strips comments first ==');
{
  const TREES = ['engine/src', 'engine/test', 'poc/src', 'poc/tools', 'poc-teacher', 'scripts', 'book', 'packages', 'game', 'api'];
  const SKIP_DIRS = new Set(['node_modules', 'dist', 'taminations-flutter', '.git', '_scratch']);
  const walk = (dir) => {
    const out = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|mjs|cjs)$/.test(e.name)) out.push(full);
    }
    return out;
  };
  const files = TREES.flatMap((t) => walk(path.join(root, t)));
  check(files.length > 300, `the walk has a population (${files.length} source files under ${TREES.length} trees)`);

  // A SCAN IS A `<tam` REGEX LITERAL ON A LINE THAT IS NOT A COMMENT. Two things are deliberately NOT judged here:
  // whether the XML being sliced is the corpus or something the file built itself, and whether the slice is a
  // position-preserving mask on purpose. This is a CENSUS - it says where hand slices are, so a new one is looked at;
  // the behavioural question is section 2's. `_*.mjs` is the tree's scratch convention and is skipped.
  const SCAN = '/<tam';
  const STRIP = /stripComments\(|replace\(\/<!--/;
  const found = [];
  for (const file of files) {
    if (path.basename(file).startsWith('_')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const scans = text
      .split('\n')
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith('//') && !t.startsWith('*') && line.includes(SCAN);
      }).length;
    if (!scans) continue;
    const rel = path.relative(root, file).replace(/\\/g, '/');
    found.push({ rel, scans, strips: STRIP.test(text) || rel === 'packages/corpus/blocks.ts' });
  }
  found.sort((a, b) => a.rel.localeCompare(b.rel));
  const noStrip = found.filter((f) => !f.strips).map((f) => f.rel);
  console.log(`     ${found.length} files contain a \`<tam>\` regex literal; ${noStrip.length} of them contain NO comment-strip at all`);
  for (const f of found.filter((x) => !x.strips)) console.log(`       NO-STRIP ${f.rel} (${f.scans} scan site${f.scans === 1 ? '' : 's'})`);

  // THE NAMED SETS. The first is the census of slicers and it fails when a NAME appears or disappears. The second is
  // the mechanical claim that matters - a file that never strips comments cannot be stripping them - and it is the
  // one the teacher's reader has to LEAVE when it is rebuilt on the corpus package.
  const EXPECTED_SLICERS = [
    'engine/test/alignment-boards.mjs',
    'engine/test/behaviour-audit.mjs',
    'engine/test/catalogue.mjs',
    'engine/test/corpus-inventory.mjs',
    'engine/test/editor.mjs',
    'engine/test/formation-order.mjs',
    'engine/test/gender-audit.mjs',
    'engine/test/mainstream.mjs',
    'engine/test/map-tips.mjs',
    'engine/test/reading-census.mjs',
    'engine/test/scircle-instance.mjs',
    'engine/test/scircle-register.mjs',
    'engine/test/sequencer.mjs',
    // ITSELF: this harness quotes the pattern it hunts, so it is in its own census. Recorded rather than special-cased.
    'engine/test/tam-readers.mjs',
    'engine/test/tools/callerlab-diff.mjs',
    'engine/test/tools/cell-census.mjs',
    'engine/test/tools/editor-instance-probe.mjs',
    'engine/test/tools/from-overlap.mjs',
    'engine/test/tools/handoff-2dancer.mjs',
    'engine/test/tools/handoff-facing-pairs.mjs',
    'engine/test/tools/level-census.mjs',
    'engine/test/tools/rlt-probe.mjs',
    'engine/test/tools/scircle-paths.mjs',
    'engine/test/tools/scircle-probe.mjs',
    'engine/test/tools/scircle-shift-probe.mjs',
    'engine/test/tools/trade-whole-set-record-probe.mjs',
    // THE ONE READER. It slices `<tam>` for every caller, and it strips comments first; `index.ts` no longer slices at
    // all, which is why it left this list in the commit that made the block read pure.
    'packages/corpus/blocks.ts',
    'poc-teacher/scripts/gen-discovered.mjs',
    'poc/src/data.ts',
    'poc/src/editor-ui.ts',
    'poc/tools/arm-turn-probe.mjs',
    'poc/tools/clone-refusal-probe.mjs',
    'poc/tools/dosado-facing-fit.mjs',
    'poc/tools/export-all-probe.mjs',
    'poc/tools/formation-shape-probe.mjs',
    'scripts/tag-formations.mjs',
    'scripts/tam-blocks.mjs',
    'scripts/translate-sequences.mjs',
  ];
  const slicers = found.map((f) => f.rel);
  const extra = slicers.filter((n) => !EXPECTED_SLICERS.includes(n));
  const gone = EXPECTED_SLICERS.filter((n) => !slicers.includes(n));
  check(extra.length === 0 && gone.length === 0,
    `the hand slices are exactly the ${EXPECTED_SLICERS.length} named files (${extra.length} new: ${extra.join(', ') || 'none'}; ${gone.length} gone: ${gone.join(', ') || 'none'})`);
  const EXPECTED_NO_STRIP = [
    'engine/test/alignment-boards.mjs',
    'engine/test/behaviour-audit.mjs',
    'engine/test/catalogue.mjs',
    'engine/test/corpus-inventory.mjs',
    'engine/test/editor.mjs',
    'engine/test/formation-order.mjs',
    'engine/test/gender-audit.mjs',
    'engine/test/mainstream.mjs',
    'engine/test/map-tips.mjs',
    'engine/test/reading-census.mjs',
    'engine/test/sequencer.mjs',
    'engine/test/tools/callerlab-diff.mjs',
    'engine/test/tools/cell-census.mjs',
    'engine/test/tools/editor-instance-probe.mjs',
    'engine/test/tools/from-overlap.mjs',
    'engine/test/tools/level-census.mjs',
    'engine/test/tools/rlt-probe.mjs',
    'engine/test/tools/trade-whole-set-record-probe.mjs',
    'poc-teacher/scripts/gen-discovered.mjs',
    'poc/src/editor-ui.ts',
    'poc/tools/arm-turn-probe.mjs',
    'poc/tools/clone-refusal-probe.mjs',
    'poc/tools/dosado-facing-fit.mjs',
    'poc/tools/export-all-probe.mjs',
    'poc/tools/formation-shape-probe.mjs',
    'scripts/translate-sequences.mjs',
  ];
  const extraNoStrip = noStrip.filter((n) => !EXPECTED_NO_STRIP.includes(n));
  const goneNoStrip = EXPECTED_NO_STRIP.filter((n) => !noStrip.includes(n));
  check(extraNoStrip.length === 0 && goneNoStrip.length === 0,
    `and the files that CANNOT be stripping comments are exactly the ${EXPECTED_NO_STRIP.length} named ones (${extraNoStrip.length} new: ${extraNoStrip.join(', ') || 'none'}; ${goneNoStrip.length} gone: ${goneNoStrip.join(', ') || 'none'})`);
}

// ---------------------------------------------------------------- 2. the phantom authorings
console.log('\n== 2. What the teacher\'s un-stripped reader teaches that the corpus does not ==');
{
  // THE TEACHER'S OWN LEVEL AND ITS OWN HIDDEN RULE, restated here because the harness is asking what THAT READER
  // produces - the corpus package deliberately does not own `display="no"` filtering.
  const level = 'ms';
  const files = {};
  for (const file of filesOf(level)) files[`${level}/${file}`] = readFile(level, file);
  const hidden = (block) => /display="(no|none)"/.test(block.slice(0, block.indexOf('>') + 1));

  const teacher = new Map();
  for (const call of buildCatalog(files)) teacher.set(call.title, (teacher.get(call.title) ?? 0) + call.setups.length);

  const corpus = new Map();
  for (const file of filesOf(level)) {
    for (const site of tamsOf(level, file)) {
      if (hidden(site.xml)) continue;
      corpus.set(site.title, (corpus.get(site.title) ?? 0) + 1);
    }
  }
  const teacherTotal = [...teacher.values()].reduce((a, b) => a + b, 0);
  const corpusTotal = [...corpus.values()].reduce((a, b) => a + b, 0);
  console.log(`     ${teacherTotal} pooled setups against ${corpusTotal} corpus sites under the same hidden rule`);

  const onlyTeacher = [...teacher.keys()].filter((t) => !corpus.has(t)).sort();
  check(onlyTeacher.length === 0,
    `the teacher invents no TITLE the corpus does not have (${onlyTeacher.length}: ${onlyTeacher.join(', ') || 'none'})`);

  // THE NAMED SET, AND IT IS NOW EMPTY ON PURPOSE. It held the eight `Left/Right-Hand Star` titles while the teacher's
  // reader sliced the raw text; the shared reader empties it, and an EMPTY set is the strongest form of the pin here:
  // one phantom authoring reappearing fails. It fails symmetrically too - a title that stops matching means the two
  // readers stopped agreeing about a title, which is the direction a merge would produce.
  const phantom = [...teacher.entries()]
    .filter(([title, n]) => n !== (corpus.get(title) ?? 0))
    .map(([title, n]) => `${title} ${n - (corpus.get(title) ?? 0)}`)
    .sort();
  const EXPECTED_PHANTOM = [];
  check(JSON.stringify(phantom) === JSON.stringify(EXPECTED_PHANTOM),
    `no title carries a COMMENTED-OUT authoring: the two readers agree title for title (${phantom.length} disagree${phantom.length ? ': ' + phantom.join(', ') : ''})`);
  // AND THE SOURCE OF THE DIFFERENCE IS STILL NAMED, so a reader can see WHERE the phantom used to come from and that the
  // file has not changed: the strips happen in the reader now, not in the file.
  const star = readFile(level, 'star.xml');
  const rawBlocks = (star.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []).length;
  const strippedBlocks = (star.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) ?? []).length;
  check(rawBlocks - strippedBlocks === 16,
    `\`ms/star.xml\` still carries ${rawBlocks - strippedBlocks} tam blocks inside comments (${rawBlocks} by a raw scan, ${strippedBlocks} after stripping) - the file the 8 phantoms came from, and the reader ignores them`);
}

// ---------------------------------------------------------------- 3. the judge: the engine's own parser
console.log('\n== 3. The cheap slice against the engine\'s parser, on the files that carry comments ==');
{
  // THE WHOLE-CORPUS equality is `corpus-inventory`'s (every file, `tamsOf` against `parseCallXml`); what is pinned
  // HERE is the four files the corpus package's header names, because those are the ones where a raw scan differs and
  // the ones whose difference has been paid for twice already (the book's index, the harnesses' title list).
  const COMMENTED = ['a1/split_square_thru.xml', 'c1/magic_column_formation.xml', 'ms/star.xml', 'plus/anything_and_spread.xml'];
  let total = 0;
  for (const site of COMMENTED) {
    const [level, file] = site.split('/');
    const xml = readFile(level, file);
    const raw = (xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? []).length;
    const stripped = (xml.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) ?? []).length;
    const sites = tamsOf(level, file).length;
    const parsed = parseCallXml(xml).length;
    total += raw - stripped;
    check(sites === parsed && parsed === stripped,
      `${site}: the corpus slice, the stripped count and the engine's parser agree (${sites} / ${stripped} / ${parsed}) while a raw scan finds ${raw}`);
  }
  check(total === 20, `and the four files hold all ${total} of the corpus's commented-out tam blocks (the header's 16+2+1+1)`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
